import { can } from "@casitrace/contracts";
import type { Db } from "@casitrace/db";
import { AppError, newId } from "@casitrace/shared";
import type { CommandContext } from "../../../platform/audit";
import { runCommand } from "../../../platform/command";
import { requestEmail } from "../../../platform/email";
import { withPlatformAccess } from "../../../platform/tenant";
import { createHandoffForShipTx } from "./handoffs";
import { orgIdentities } from "./orgs";

type Ctx = CommandContext & { orgId: string };
const CLAIM_DAYS = 14;
const RETRO_DAYS = 365;
const hash = (token: string) => new Bun.CryptoHasher("sha256").update(token).digest("hex");

/**
 * Invites an off-platform partner to claim its record (roadmap-v2 P6). The token is single-use, bound
 * to the invited email address, and expires after 14 days; only its hash is stored.
 */
export const inviteClaim = async (db: Db, ctx: Ctx, partnerId: string, email: string, webOrigin: string) => {
  const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
  const result = await runCommand(db, ctx, async (tx) => {
    const p = await tx.tradingPartner.findUnique({ where: { id: partnerId } });
    if (!p) throw new AppError("NOT_FOUND", "Trading partner not found.");
    if (p.linkedOrgId)
      throw new AppError("CONFLICT", "This partner is already linked to a Casitrace organisation.");
    const id = newId();
    await tx.partnerClaim.create({
      data: {
        id,
        orgId: ctx.orgId,
        partnerId,
        email: email.toLowerCase(),
        tokenHash: hash(token),
        expiresAt: new Date(Date.now() + CLAIM_DAYS * 86_400_000),
        createdById: ctx.actor.id,
      },
    });
    return {
      result: { id, partnerName: p.name },
      audit: [
        {
          action: "partner.claim_invited",
          resourceType: "partner",
          resourceId: partnerId,
          data: { claimId: id },
        },
      ],
    };
  });
  const inviter = (await orgIdentities(db, [ctx.orgId])).get(ctx.orgId)?.name ?? "A Casitrace user";
  await requestEmail(db, {
    template: "partner-claim",
    to: email,
    data: { inviterName: inviter, partnerName: result.partnerName, url: `${webOrigin}/claim/${token}` },
  });
  return { id: result.id };
};

/** Reads a claim by token. Claim rows belong to the inviter; the token holder reads only this one. */
const findClaim = (db: Db, token: string) =>
  withPlatformAccess(db, async (tx) => {
    const c = await tx.partnerClaim.findUnique({ where: { tokenHash: hash(token) } });
    if (!c) throw new AppError("NOT_FOUND", "This invitation link is not valid.");
    const partner = await tx.tradingPartner.findUniqueOrThrow({ where: { id: c.partnerId } });
    return { c, partner };
  });

export const claimInfo = async (db: Db, token: string) => {
  const { c, partner } = await findClaim(db, token);
  const inviter = (await orgIdentities(db, [c.orgId])).get(c.orgId)?.name ?? "";
  return {
    inviterName: inviter,
    partnerName: partner.name,
    email: c.email,
    expiresAt: c.expiresAt.toISOString(),
    claimed: !!c.claimedAt,
  };
};

/**
 * The invited company links its own organisation to the inviter's partner record. Earlier shipments
 * from the inviter to this partner (last 12 months) become incoming shipments it can book in.
 */
export const acceptClaim = async (
  db: Db,
  user: { id: string; email: string; emailVerified: boolean },
  token: string,
  organizationId: string,
  requestId: string | null,
) => {
  const { c, partner } = await findClaim(db, token);
  if (c.claimedAt) throw new AppError("CONFLICT", "This invitation was already used.");
  if (c.expiresAt < new Date())
    throw new AppError("CONFLICT", "This invitation has expired. Ask for a new one.");
  if (!user.emailVerified || user.email.toLowerCase() !== c.email) {
    throw new AppError(
      "FORBIDDEN",
      `This invitation was sent to ${c.email}. Sign in with that address to accept it.`,
    );
  }
  if (organizationId === c.orgId)
    throw new AppError("VALIDATION_FAILED", "You cannot claim a partner record of your own organisation.");
  const member = await db.member.findFirst({ where: { organizationId, userId: user.id } });
  if (!member || !can(member.role, "partner:approve")) {
    throw new AppError("FORBIDDEN", "Only an owner or admin of the organisation can link it.");
  }

  // Runs in the inviter's scope: it updates the inviter's partner record and creates handoffs from it.
  const ctx: Ctx & { role: string } = {
    actor: { type: "user", id: user.id },
    orgId: c.orgId,
    requestId,
    role: "system",
  };
  return runCommand(db, ctx, async (tx) => {
    const fresh = await tx.partnerClaim.updateMany({
      where: { id: c.id, claimedAt: null },
      data: { claimedAt: new Date(), claimedOrgId: organizationId, claimedById: user.id },
    });
    if (fresh.count !== 1) throw new AppError("CONFLICT", "This invitation was already used.");
    if (await tx.tradingPartner.count({ where: { linkedOrgId: organizationId } })) {
      throw new AppError(
        "CONFLICT",
        "Your organisation is already linked to another partner record of this company.",
      );
    }
    await tx.tradingPartner.update({ where: { id: partner.id }, data: { linkedOrgId: organizationId } });
    const ships = await tx.traceEvent.findMany({
      where: {
        type: "SHIP",
        partnerId: partner.id,
        occurredAt: { gte: new Date(Date.now() - RETRO_DAYS * 86_400_000) },
      },
    });
    let created = 0;
    for (const s of ships) {
      const voided = await tx.traceEvent.count({ where: { voidsEventId: s.id } });
      const existing = await tx.handoff.count({ where: { shipEventId: s.id } });
      if (voided || existing) continue;
      await createHandoffForShipTx(tx, ctx, s.id, organizationId, s.occurredAt, undefined);
      created++;
    }
    return {
      result: { partnerId: partner.id, shipmentsLinked: created },
      audit: [
        {
          action: "partner.claimed",
          resourceType: "partner",
          resourceId: partner.id,
          data: { claimedOrgId: organizationId, shipmentsLinked: created },
        },
      ],
    };
  });
};
