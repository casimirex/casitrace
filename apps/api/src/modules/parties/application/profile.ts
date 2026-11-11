import type { Profile, ProfileInput, VerificationDecision } from "@casitrace/contracts";
import type { Db, Tx } from "@casitrace/db";
import { AppError } from "@casitrace/shared";
import type { z } from "zod";
import type { CommandContext } from "../../../platform/audit";
import { runCommand } from "../../../platform/command";
import { iso } from "../../../platform/dto";
import { notifyOrg } from "../../../platform/notify";
import { withPlatformAccess, withTenant } from "../../../platform/tenant";

type ProfileDto = z.infer<typeof Profile>;
type Row = NonNullable<Awaited<ReturnType<Tx["organizationProfile"]["findUnique"]>>>;

export const profileDto = (r: Row): ProfileDto => ({
  orgId: r.orgId,
  legalName: r.legalName,
  registrationNumber: r.registrationNumber,
  vatNumber: r.vatNumber,
  countryCode: r.countryCode,
  addressLine1: r.addressLine1,
  addressLine2: r.addressLine2,
  city: r.city,
  postalCode: r.postalCode,
  region: r.region,
  businessRoles: r.businessRoles as ProfileDto["businessRoles"],
  website: r.website,
  description: r.description,
  publicListing: r.publicListing,
  verificationStatus: r.verificationStatus as ProfileDto["verificationStatus"],
  verificationNote: r.verificationNote,
  verificationRequestedAt: iso(r.verificationRequestedAt),
  verifiedAt: iso(r.verifiedAt),
  updatedAt: r.updatedAt.toISOString(),
});

/** Fields that, when changed on a verified profile, send it back to "unverified". */
const IDENTITY_FIELDS = ["legalName", "registrationNumber", "vatNumber", "countryCode"] as const;

export const getProfile = (db: Db, orgId: string) =>
  withTenant(db, orgId, async (tx) => {
    const r = await tx.organizationProfile.findUnique({ where: { orgId } });
    return r ? profileDto(r) : null;
  });

export const saveProfile = (
  db: Db,
  ctx: CommandContext & { orgId: string },
  input: z.infer<typeof ProfileInput>,
) =>
  runCommand(db, ctx, async (tx) => {
    const before = await tx.organizationProfile.findUnique({ where: { orgId: ctx.orgId } });
    const identityChanged =
      before !== null && IDENTITY_FIELDS.some((f) => (before[f] ?? null) !== (input[f] ?? null));
    const resetVerification = identityChanged && before.verificationStatus !== "unverified";
    const data = {
      legalName: input.legalName,
      registrationNumber: input.registrationNumber ?? null,
      vatNumber: input.vatNumber ?? null,
      countryCode: input.countryCode,
      addressLine1: input.addressLine1 ?? null,
      addressLine2: input.addressLine2 ?? null,
      city: input.city ?? null,
      postalCode: input.postalCode ?? null,
      region: input.region ?? null,
      businessRoles: [...new Set(input.businessRoles)],
      website: input.website ?? null,
      description: input.description ?? null,
      publicListing: input.publicListing ?? false,
      ...(resetVerification
        ? {
            verificationStatus: "unverified",
            verifiedAt: null,
            verificationRequestedAt: null,
            verificationNote: "Legal details changed; verify again.",
          }
        : {}),
    };
    const row = await tx.organizationProfile.upsert({
      where: { orgId: ctx.orgId },
      create: { orgId: ctx.orgId, ...data },
      update: data,
    });
    return {
      result: profileDto(row),
      audit: [
        {
          action: before ? "organisation.profile_updated" : "organisation.profile_created",
          resourceType: "organisation",
          resourceId: ctx.orgId,
          data: { identityChanged, verificationReset: resetVerification },
        },
      ],
    };
  });

export const requestVerification = (db: Db, ctx: CommandContext & { orgId: string }) =>
  runCommand(db, ctx, async (tx) => {
    const p = await tx.organizationProfile.findUnique({ where: { orgId: ctx.orgId } });
    if (!p) throw new AppError("CONFLICT", "Complete the business profile before requesting verification.");
    if (!p.registrationNumber) {
      throw new AppError(
        "VALIDATION_FAILED",
        "Add the business registration number before requesting verification.",
        [{ path: "registrationNumber", message: "required for verification" }],
      );
    }
    if (p.verificationStatus !== "unverified")
      throw new AppError("CONFLICT", `Profile is already ${p.verificationStatus}.`);
    const row = await tx.organizationProfile.update({
      where: { orgId: ctx.orgId },
      data: { verificationStatus: "pending", verificationRequestedAt: new Date(), verificationNote: null },
    });
    return {
      result: profileDto(row),
      audit: [
        {
          action: "organisation.verification_requested",
          resourceType: "organisation",
          resourceId: ctx.orgId,
        },
      ],
      events: [
        {
          type: "organisation.verification_requested",
          aggregateType: "organisation",
          aggregateId: ctx.orgId,
          payload: {},
        },
      ],
    };
  });

/** Platform review queue: profiles waiting for a decision, oldest first. */
export const listPendingVerifications = (db: Db) =>
  withPlatformAccess(db, async (tx) => {
    const rows = await tx.organizationProfile.findMany({
      where: { verificationStatus: "pending" },
      orderBy: { verificationRequestedAt: "asc" },
      take: 200,
    });
    return rows.map(profileDto);
  });

export const decideVerification = (
  db: Db,
  ctx: CommandContext,
  organizationId: string,
  decision: z.infer<typeof VerificationDecision>,
  webOrigin: string,
) =>
  // A platform staff decision about one organisation: run as a command scoped to that organisation,
  // so it is audited there and its owners/admins are told the outcome (audit F-3).
  runCommand(db, { ...ctx, orgId: organizationId }, async (tx) => {
    const p = await tx.organizationProfile.findUnique({ where: { orgId: organizationId } });
    if (!p) throw new AppError("NOT_FOUND", "Organisation profile not found.");
    if (p.verificationStatus !== "pending")
      throw new AppError("CONFLICT", `Profile is ${p.verificationStatus}, not pending.`);
    if (decision.decision === "reject" && !decision.note) {
      throw new AppError("VALIDATION_FAILED", "Say why the verification was rejected.", [
        { path: "note", message: "required" },
      ]);
    }
    const approved = decision.decision === "approve";
    const row = await tx.organizationProfile.update({
      where: { orgId: organizationId },
      data: {
        verificationStatus: approved ? "verified" : "unverified",
        verifiedAt: approved ? new Date() : null,
        verificationNote: decision.note ?? null,
      },
    });
    await notifyOrg(
      tx,
      organizationId,
      "organization:update",
      {
        kind: approved ? "organisation.verified" : "organisation.verification_rejected",
        title: approved ? "Your business is verified" : "Verification not approved",
        body: approved
          ? "Casitrace checked your registration documents. Partners and public pages now show your business as verified."
          : `Casitrace could not verify your business: ${decision.note ?? ""} Update your profile or documents and ask again.`,
        link: `/orgs/${organizationId}/profile`,
        dedupeKey: `verification:${organizationId}:${row.updatedAt.getTime()}`,
      },
      webOrigin,
    );
    return {
      result: profileDto(row),
      audit: [
        {
          action: approved ? "organisation.verified" : "organisation.verification_rejected",
          resourceType: "organisation",
          resourceId: organizationId,
          data: { note: decision.note ?? null },
        },
      ],
    };
  });
