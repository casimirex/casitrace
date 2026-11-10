import type { PartnerCompliance, SupplierRequirementInput } from "@casitrace/contracts";
import type { Db } from "@casitrace/db";
import { AppError, newId } from "@casitrace/shared";
import type { z } from "zod";
import type { CommandContext } from "../../../platform/audit";
import { runCommand } from "../../../platform/command";
import { withTenant } from "../../../platform/tenant";
import { sharedEvidenceFrom } from "./evidence-requests";

type Ctx = CommandContext & { orgId: string };
type ComplianceOut = z.infer<typeof PartnerCompliance>;

const today = () => new Date(new Date().toISOString().slice(0, 10));
const matches = (
  req: { evidenceType: string; scheme: string | null },
  e: { type: string; scheme: string | null },
) =>
  e.type === req.evidenceType &&
  (!req.scheme || (e.scheme ?? "").toLowerCase().includes(req.scheme.toLowerCase()));
/** Counts toward a requirement: verified and still valid. */
const valid = (e: { status: string; validUntil: Date | null }) =>
  e.status === "verified" && (!e.validUntil || e.validUntil >= today());

export const listRequirements = (db: Db, orgId: string) =>
  withTenant(db, orgId, async (tx) =>
    (await tx.supplierRequirement.findMany({ orderBy: { createdAt: "asc" } })).map((r) => ({
      id: r.id,
      evidenceType: r.evidenceType as z.infer<typeof SupplierRequirementInput>["evidenceType"],
      scheme: r.scheme,
      label: r.label,
    })),
  );

export const addRequirement = (db: Db, ctx: Ctx, input: z.infer<typeof SupplierRequirementInput>) =>
  runCommand(db, ctx, async (tx) => {
    const id = newId();
    await tx.supplierRequirement.create({
      data: {
        id,
        orgId: ctx.orgId,
        evidenceType: input.evidenceType,
        scheme: input.scheme ?? null,
        label: input.label,
      },
    });
    return {
      result: { id, evidenceType: input.evidenceType, scheme: input.scheme ?? null, label: input.label },
      audit: [
        {
          action: "supplier_requirement.added",
          resourceType: "supplier_requirement",
          resourceId: id,
          data: { label: input.label },
        },
      ],
    };
  });

export const removeRequirement = (db: Db, ctx: Ctx, id: string) =>
  runCommand(db, ctx, async (tx) => {
    const r = await tx.supplierRequirement.findUnique({ where: { id } });
    if (!r) throw new AppError("NOT_FOUND", "Requirement not found.");
    await tx.supplierRequirement.delete({ where: { id } });
    return {
      result: { ok: true as const },
      audit: [
        {
          action: "supplier_requirement.removed",
          resourceType: "supplier_requirement",
          resourceId: id,
          data: { label: r.label },
        },
      ],
    };
  });

/**
 * Whether a supplier meets every requirement: evidence we uploaded and linked to the supplier, or
 * evidence the supplier shared with us. Only verified, unexpired evidence counts. "Verified" on shared
 * evidence means verified by the supplier's own reviewer.
 */
export const partnerCompliance = async (db: Db, orgId: string, partnerId: string): Promise<ComplianceOut> => {
  const { partner, requirements, own } = await withTenant(db, orgId, async (tx) => {
    const partner = await tx.tradingPartner.findUnique({ where: { id: partnerId } });
    if (!partner) throw new AppError("NOT_FOUND", "Trading partner not found.");
    const requirements = await tx.supplierRequirement.findMany({ orderBy: { createdAt: "asc" } });
    const own = await tx.evidence.findMany({
      where: { links: { some: { targetType: "partner", targetId: partnerId } } },
      select: { id: true, title: true, type: true, scheme: true, status: true, validUntil: true },
    });
    return { partner, requirements, own };
  });
  const shared = partner.linkedOrgId ? await sharedEvidenceFrom(db, orgId, partner.linkedOrgId) : [];
  const candidates = [
    ...own.map((e) => ({ ...e, source: "uploaded_by_us" as const })),
    ...shared.map((e) => ({ ...e, source: "shared_by_supplier" as const })),
  ];
  const rows = requirements.map((r) => {
    const evidence = candidates.filter((e) => matches(r, e));
    return {
      requirement: {
        id: r.id,
        evidenceType: r.evidenceType as ComplianceOut["requirements"][number]["requirement"]["evidenceType"],
        scheme: r.scheme,
        label: r.label,
      },
      met: evidence.some(valid),
      evidence: evidence.map((e) => ({
        id: e.id,
        title: e.title,
        status: e.status,
        validUntil: e.validUntil?.toISOString().slice(0, 10) ?? null,
        source: e.source,
      })),
    };
  });
  return {
    partnerId,
    approvalStatus: partner.approvalStatus as ComplianceOut["approvalStatus"],
    approvedAt: partner.approvedAt?.toISOString() ?? null,
    requirementsMet: rows.every((r) => r.met),
    requirements: rows,
  };
};

/** A supplier is approved only while every requirement is met (roadmap-v2 P6). */
export const setApproval = async (db: Db, ctx: Ctx, partnerId: string, approve: boolean, reason?: string) => {
  if (approve) {
    const c = await partnerCompliance(db, ctx.orgId, partnerId);
    const missing = c.requirements.filter((r) => !r.met).map((r) => r.requirement.label);
    if (missing.length) {
      throw new AppError(
        "CONFLICT",
        `Missing verified evidence: ${missing.join(", ")}.`,
        missing.map((m) => ({ path: "requirements", message: m })),
      );
    }
  }
  return runCommand(db, ctx, async (tx) => {
    await tx.tradingPartner.update({
      where: { id: partnerId },
      data: approve
        ? { approvalStatus: "approved", approvedAt: new Date(), approvedById: ctx.actor.id }
        : { approvalStatus: "suspended", approvedAt: null, approvedById: null },
    });
    return {
      result: { ok: true as const },
      audit: [
        {
          action: approve ? "partner.approved" : "partner.suspended",
          resourceType: "partner",
          resourceId: partnerId,
          data: { reason: reason ?? null },
        },
      ],
    };
  });
};
