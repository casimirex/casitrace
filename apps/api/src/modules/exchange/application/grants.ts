import type { GrantDto, GrantInput } from "@casitrace/contracts";
import type { Db, Tx } from "@casitrace/db";
import { AppError, newId } from "@casitrace/shared";
import type { z } from "zod";
import type { CommandContext } from "../../../platform/audit";
import { runCommand } from "../../../platform/command";
import { withTenant } from "../../../platform/tenant";
import { orgIdentities } from "./orgs";

type Ctx = CommandContext & { orgId: string };
type GrantOut = z.infer<typeof GrantDto>;

export interface LotGrant {
  id: string;
  grantorOrgId: string;
  upstreamDepth: number;
  downstreamDepth: number;
  includeKdes: boolean;
  includeEvidence: boolean;
}

/**
 * The active lot grant from `grantorOrgId` that lets `viewerOrgId` see beyond `lotId`, if any.
 * Read under the grantor's scope because grants to "all downstream holders" (grantee null) are not
 * visible to the viewer's own scope. Callers only reach a lot by walking handoffs from the viewer's
 * own lots, which is what makes the viewer a downstream holder.
 */
export const findLotGrant = (db: Db, grantorOrgId: string, viewerOrgId: string, lotId: string) =>
  withTenant(db, grantorOrgId, async (tx): Promise<LotGrant | null> => {
    const grants = await tx.sharingGrant.findMany({
      where: {
        kind: "lot",
        lotId,
        revokedAt: null,
        OR: [{ granteeOrgId: viewerOrgId }, { granteeOrgId: null }],
      },
    });
    if (!grants.length) return null;
    // Widest scope wins when several grants apply.
    return grants.reduce<LotGrant>(
      (best, g) => ({
        id: best.id || g.id,
        grantorOrgId,
        upstreamDepth: Math.max(best.upstreamDepth, g.upstreamDepth),
        downstreamDepth: Math.max(best.downstreamDepth, g.downstreamDepth),
        includeKdes: best.includeKdes || g.includeKdes,
        includeEvidence: best.includeEvidence || g.includeEvidence,
      }),
      {
        id: "",
        grantorOrgId,
        upstreamDepth: 0,
        downstreamDepth: 0,
        includeKdes: false,
        includeEvidence: false,
      },
    );
  });

/** Records that a grant was used (visible to both sides). */
export const logSharedAccess = (
  db: Db,
  grant: { id: string; grantorOrgId: string },
  viewer: { orgId: string; actorId: string | null },
  action: "trace" | "trace_report" | "evidence" | "evidence_download",
  resourceId: string | null,
) =>
  withTenant(db, viewer.orgId, (tx) =>
    tx.sharedAccess.create({
      data: {
        id: newId(),
        grantId: grant.id,
        grantorOrgId: grant.grantorOrgId,
        granteeOrgId: viewer.orgId,
        actorId: viewer.actorId,
        action,
        resourceId,
      },
    }),
  );

const grantDtos = async (
  tx: Tx,
  rows: Awaited<ReturnType<Tx["sharingGrant"]["findMany"]>>,
): Promise<GrantOut[]> => {
  const orgs = await orgIdentities(
    tx,
    rows.flatMap((g) => [g.grantorOrgId, ...(g.granteeOrgId ? [g.granteeOrgId] : [])]),
  );
  const lots = new Map(
    (
      await tx.lot.findMany({
        where: { id: { in: rows.map((g) => g.lotId).filter((x): x is string => !!x) } },
        select: { id: true, lotCode: true },
      })
    ).map((l) => [l.id, l]),
  );
  const evidence = new Map(
    (
      await tx.evidence.findMany({
        where: { id: { in: rows.map((g) => g.evidenceId).filter((x): x is string => !!x) } },
        select: { id: true, title: true },
      })
    ).map((e) => [e.id, e]),
  );
  const usage = await tx.sharedAccess.groupBy({
    by: ["grantId"],
    where: { grantId: { in: rows.map((g) => g.id) } },
    _count: { _all: true },
    _max: { occurredAt: true },
  });
  const use = new Map(usage.map((u) => [u.grantId, u]));
  return rows.map((g) => ({
    id: g.id,
    kind: g.kind as GrantOut["kind"],
    grantor: { id: g.grantorOrgId, name: orgs.get(g.grantorOrgId)?.name ?? "" },
    grantee: g.granteeOrgId ? { id: g.granteeOrgId, name: orgs.get(g.granteeOrgId)?.name ?? "" } : null,
    // A grantee sees the grantor's lot code only for lots shared with it (that is the point of the grant).
    lot: g.lotId ? { id: g.lotId, lotCode: lots.get(g.lotId)?.lotCode ?? "(shared lot)" } : null,
    evidence: g.evidenceId
      ? { id: g.evidenceId, title: evidence.get(g.evidenceId)?.title ?? "(shared evidence)" }
      : null,
    upstreamDepth: g.upstreamDepth,
    downstreamDepth: g.downstreamDepth,
    includeKdes: g.includeKdes,
    includeEvidence: g.includeEvidence,
    note: g.note,
    createdAt: g.createdAt.toISOString(),
    revokedAt: g.revokedAt?.toISOString() ?? null,
    accessCount: use.get(g.id)?._count._all ?? 0,
    lastAccessAt: use.get(g.id)?._max.occurredAt?.toISOString() ?? null,
  }));
};

/** Grants this organisation gave, and grants addressed to it. */
export const listGrants = (db: Db, orgId: string) =>
  withTenant(db, orgId, async (tx) => {
    const given = await tx.sharingGrant.findMany({
      where: { grantorOrgId: orgId },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    const received = await tx.sharingGrant.findMany({
      where: { granteeOrgId: orgId, revokedAt: null },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    const givenDtos = await grantDtos(tx, given);
    // Lot codes / evidence titles of received grants belong to the grantor: read them in its scope.
    const receivedDtos: GrantOut[] = [];
    for (const g of received) {
      const [dto] = await withTenant(db, g.grantorOrgId, (gtx) => grantDtos(gtx, [g]));
      if (dto) receivedDtos.push(dto);
    }
    return { given: givenDtos, received: receivedDtos };
  });

export const createLotGrantTx = async (tx: Tx, ctx: Ctx, input: z.infer<typeof GrantInput>) => {
  if (!(await tx.lot.count({ where: { id: input.lotId } })))
    throw new AppError("NOT_FOUND", "Lot not found.");
  if (input.granteeOrgId) {
    if (input.granteeOrgId === ctx.orgId)
      throw new AppError("VALIDATION_FAILED", "You cannot share with your own organisation.");
    if (!(await tx.organization.count({ where: { id: input.granteeOrgId } }))) {
      throw new AppError("VALIDATION_FAILED", "No Casitrace organisation has that ID.", [
        { path: "granteeOrgId", message: "not found" },
      ]);
    }
  }
  const id = newId();
  await tx.sharingGrant.create({
    data: {
      id,
      grantorOrgId: ctx.orgId,
      granteeOrgId: input.granteeOrgId,
      kind: "lot",
      lotId: input.lotId,
      upstreamDepth: input.upstreamDepth,
      downstreamDepth: input.downstreamDepth,
      includeKdes: input.includeKdes,
      includeEvidence: input.includeEvidence,
      note: input.note ?? null,
      createdById: ctx.actor.id,
    },
  });
  return id;
};

export const createLotGrant = (db: Db, ctx: Ctx, input: z.infer<typeof GrantInput>) =>
  runCommand(db, ctx, async (tx) => {
    const id = await createLotGrantTx(tx, ctx, input);
    const [dto] = await grantDtos(tx, await tx.sharingGrant.findMany({ where: { id } }));
    return {
      result: dto as GrantOut,
      audit: [
        {
          action: "share.granted",
          resourceType: "grant",
          resourceId: id,
          data: { lotId: input.lotId, granteeOrgId: input.granteeOrgId },
        },
      ],
    };
  });

export const createEvidenceGrantTx = async (
  tx: Tx,
  ctx: Ctx,
  evidenceId: string,
  granteeOrgId: string,
  note: string | null,
) => {
  const id = newId();
  await tx.sharingGrant.create({
    data: {
      id,
      grantorOrgId: ctx.orgId,
      granteeOrgId,
      kind: "evidence",
      evidenceId,
      note,
      createdById: ctx.actor.id,
    },
  });
  return id;
};

/** Revocation takes effect immediately: every cross-organisation read checks for an active grant. */
export const revokeGrant = (db: Db, ctx: Ctx, grantId: string) =>
  runCommand(db, ctx, async (tx) => {
    const g = await tx.sharingGrant.findFirst({ where: { id: grantId, grantorOrgId: ctx.orgId } });
    if (!g) throw new AppError("NOT_FOUND", "Grant not found.");
    if (g.revokedAt) throw new AppError("CONFLICT", "This grant is already revoked.");
    await tx.sharingGrant.update({
      where: { id: grantId },
      data: { revokedAt: new Date(), revokedById: ctx.actor.id },
    });
    return {
      result: { ok: true as const },
      audit: [{ action: "share.revoked", resourceType: "grant", resourceId: grantId }],
    };
  });

/** Access log of a grant, for the grantor or the grantee. */
export const grantAccessLog = (db: Db, orgId: string, grantId: string) =>
  withTenant(db, orgId, async (tx) => {
    const g = await tx.sharingGrant.findFirst({ where: { id: grantId } });
    if (!g) throw new AppError("NOT_FOUND", "Grant not found.");
    const rows = await tx.sharedAccess.findMany({
      where: { grantId },
      orderBy: { occurredAt: "desc" },
      take: 200,
    });
    return rows.map((r) => ({
      action: r.action,
      actorId: r.actorId,
      granteeOrgId: r.granteeOrgId,
      resourceId: r.resourceId,
      occurredAt: r.occurredAt.toISOString(),
    }));
  });
