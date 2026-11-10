import type { EvidenceRequestDto, EvidenceRequestInput } from "@casitrace/contracts";
import type { Db, Tx } from "@casitrace/db";
import { AppError, newId, type ObjectStorage } from "@casitrace/shared";
import type { z } from "zod";
import type { CommandContext } from "../../../platform/audit";
import { writeAudit } from "../../../platform/audit";
import { runCommand } from "../../../platform/command";
import { notifyOrg } from "../../../platform/notify";
import { withTenant } from "../../../platform/tenant";
import { downloadLink, getEvidence } from "../../evidence/application/evidence";
import { createEvidenceGrantTx, logSharedAccess } from "./grants";
import { orgIdentities } from "./orgs";

type Ctx = CommandContext & { orgId: string };
type RequestOut = z.infer<typeof EvidenceRequestDto>;
const typeLabel = (t: string) => t.replaceAll("_", " ");

const dtos = async (
  db: Db,
  orgId: string,
  rows: Awaited<ReturnType<Tx["evidenceRequest"]["findMany"]>>,
): Promise<RequestOut[]> => {
  const orgs = await orgIdentities(
    db,
    rows.flatMap((r) => [r.requesterOrgId, r.supplierOrgId]),
  );
  const out: RequestOut[] = [];
  for (const r of rows) {
    const outgoing = r.requesterOrgId === orgId;
    const other = orgs.get(outgoing ? r.supplierOrgId : r.requesterOrgId);
    // The fulfilled evidence's title belongs to the supplier; the requester may see it through the grant.
    const title = r.fulfilledEvidenceId
      ? await withTenant(
          db,
          r.supplierOrgId,
          async (tx) =>
            (
              await tx.evidence.findUnique({
                where: { id: r.fulfilledEvidenceId as string },
                select: { title: true },
              })
            )?.title ?? "",
        )
      : null;
    out.push({
      id: r.id,
      direction: outgoing ? "outgoing" : "incoming",
      counterparty: { id: other?.id ?? "", name: other?.name ?? "" },
      evidenceType: r.evidenceType as RequestOut["evidenceType"],
      scheme: r.scheme,
      note: r.note,
      dueDate: r.dueDate?.toISOString().slice(0, 10) ?? null,
      status: r.status as RequestOut["status"],
      declineReason: r.declineReason,
      fulfilledEvidence: r.fulfilledEvidenceId ? { id: r.fulfilledEvidenceId, title: title ?? "" } : null,
      createdAt: r.createdAt.toISOString(),
      decidedAt: r.decidedAt?.toISOString() ?? null,
    });
  }
  return out;
};

export const listEvidenceRequests = async (db: Db, orgId: string) => {
  const rows = await withTenant(db, orgId, (tx) =>
    tx.evidenceRequest.findMany({ orderBy: { createdAt: "desc" }, take: 500 }),
  );
  return dtos(db, orgId, rows);
};

export const createEvidenceRequest = (
  db: Db,
  ctx: Ctx,
  input: z.infer<typeof EvidenceRequestInput>,
  webOrigin: string,
) =>
  runCommand(db, ctx, async (tx) => {
    const partner = await tx.tradingPartner.findUnique({ where: { id: input.partnerId } });
    if (!partner) throw new AppError("NOT_FOUND", "Trading partner not found.");
    if (!partner.linkedOrgId) {
      throw new AppError(
        "CONFLICT",
        "This supplier is not on Casitrace yet. Invite them to claim their record, or upload their documents yourself.",
      );
    }
    const id = newId();
    await tx.evidenceRequest.create({
      data: {
        id,
        requesterOrgId: ctx.orgId,
        supplierOrgId: partner.linkedOrgId,
        requesterPartnerId: partner.id,
        evidenceType: input.evidenceType,
        scheme: input.scheme ?? null,
        note: input.note ?? null,
        dueDate: input.dueDate ? new Date(`${input.dueDate}T00:00:00Z`) : null,
        createdById: ctx.actor.id,
      },
    });
    const requester = (await orgIdentities(tx, [ctx.orgId])).get(ctx.orgId)?.name ?? "A customer";
    await notifyOrg(
      tx,
      partner.linkedOrgId,
      "evidence:create",
      {
        kind: "evidence.requested",
        title: `${requester} requests a ${typeLabel(input.evidenceType)}`,
        body: `${requester} asks for a ${typeLabel(input.evidenceType)}${input.scheme ? ` (${input.scheme})` : ""}${input.dueDate ? ` by ${input.dueDate}` : ""}.${input.note ? ` Note: ${input.note}` : ""}`,
        link: `/orgs/${partner.linkedOrgId}/sharing`,
        dedupeKey: `evidence-request:${id}`,
      },
      webOrigin,
    );
    const [dto] = await dtos(db, ctx.orgId, await tx.evidenceRequest.findMany({ where: { id } }));
    return {
      result: dto as RequestOut,
      audit: [{ action: "evidence_request.created", resourceType: "evidence_request", resourceId: id }],
    };
  });

const loadIncoming = async (tx: Tx, ctx: Ctx, id: string) => {
  const r = await tx.evidenceRequest.findUnique({ where: { id } });
  if (!r || r.supplierOrgId !== ctx.orgId) throw new AppError("NOT_FOUND", "Request not found.");
  if (r.status !== "open") throw new AppError("CONFLICT", `This request is ${r.status}.`);
  return r;
};

/** The supplier answers with one of its own evidence records, shared with the requester only. */
export const fulfilEvidenceRequest = (db: Db, ctx: Ctx, id: string, evidenceId: string, webOrigin: string) =>
  runCommand(db, ctx, async (tx) => {
    const r = await loadIncoming(tx, ctx, id);
    const e = await tx.evidence.findUnique({ where: { id: evidenceId } });
    if (!e)
      throw new AppError("VALIDATION_FAILED", "Evidence not found.", [
        { path: "evidenceId", message: "not found" },
      ]);
    if (["rejected", "revoked", "expired"].includes(e.status))
      throw new AppError("CONFLICT", `This evidence is ${e.status} and cannot be shared.`);
    const grantId = await createEvidenceGrantTx(
      tx,
      ctx,
      evidenceId,
      r.requesterOrgId,
      `Answer to request ${id}`,
    );
    await tx.evidenceRequest.update({
      where: { id },
      data: {
        status: "fulfilled",
        fulfilledEvidenceId: evidenceId,
        grantId,
        decidedById: ctx.actor.id,
        decidedAt: new Date(),
      },
    });
    const supplier = (await orgIdentities(tx, [ctx.orgId])).get(ctx.orgId)?.name ?? "Your supplier";
    await notifyOrg(
      tx,
      r.requesterOrgId,
      "evidence:verify",
      {
        kind: "evidence.request_fulfilled",
        title: `${supplier} shared “${e.title}”`,
        body: `${supplier} answered your request for a ${typeLabel(r.evidenceType)}.`,
        link: `/orgs/${r.requesterOrgId}/sharing`,
        dedupeKey: `evidence-request-fulfilled:${id}`,
      },
      webOrigin,
    );
    return {
      result: { ok: true as const, grantId },
      audit: [
        {
          action: "evidence_request.fulfilled",
          resourceType: "evidence_request",
          resourceId: id,
          data: { evidenceId, grantId },
        },
      ],
    };
  });

export const declineEvidenceRequest = (db: Db, ctx: Ctx, id: string, reason: string) =>
  runCommand(db, ctx, async (tx) => {
    await loadIncoming(tx, ctx, id);
    await tx.evidenceRequest.update({
      where: { id },
      data: { status: "declined", declineReason: reason, decidedById: ctx.actor.id, decidedAt: new Date() },
    });
    return {
      result: { ok: true as const },
      audit: [
        {
          action: "evidence_request.declined",
          resourceType: "evidence_request",
          resourceId: id,
          data: { reason },
        },
      ],
    };
  });

export const cancelEvidenceRequest = (db: Db, ctx: Ctx, id: string) =>
  runCommand(db, ctx, async (tx) => {
    const r = await tx.evidenceRequest.findUnique({ where: { id } });
    if (!r || r.requesterOrgId !== ctx.orgId) throw new AppError("NOT_FOUND", "Request not found.");
    if (r.status !== "open") throw new AppError("CONFLICT", `This request is ${r.status}.`);
    await tx.evidenceRequest.update({
      where: { id },
      data: { status: "cancelled", decidedById: ctx.actor.id, decidedAt: new Date() },
    });
    return {
      result: { ok: true as const },
      audit: [{ action: "evidence_request.cancelled", resourceType: "evidence_request", resourceId: id }],
    };
  });

// ─── reading shared evidence ────────────────────────────────────────────────

/** The active evidence grant to the viewer for this evidence, checked in the viewer's own scope. */
const evidenceGrant = async (db: Db, viewerOrgId: string, evidenceId: string) => {
  const g = await withTenant(db, viewerOrgId, (tx) =>
    tx.sharingGrant.findFirst({
      where: { kind: "evidence", evidenceId, granteeOrgId: viewerOrgId, revokedAt: null },
    }),
  );
  if (!g) throw new AppError("NOT_FOUND", "Evidence not found.");
  return g;
};

export const getSharedEvidence = async (
  db: Db,
  viewer: { orgId: string; actorId: string | null },
  evidenceId: string,
) => {
  const g = await evidenceGrant(db, viewer.orgId, evidenceId);
  const e = await getEvidence(db, g.grantorOrgId, evidenceId);
  await logSharedAccess(db, g, viewer, "evidence", evidenceId);
  const grantor = (await orgIdentities(db, [g.grantorOrgId])).get(g.grantorOrgId);
  // Links point at the supplier's own records; they mean nothing to the viewer and are not shared.
  return {
    ...e,
    links: [],
    sharedBy: { id: g.grantorOrgId, name: grantor?.name ?? "", verified: grantor?.verified ?? false },
  };
};

export const sharedEvidenceDownload = async (
  db: Db,
  storage: ObjectStorage,
  viewer: { orgId: string; actorId: string | null },
  evidenceId: string,
  version: number,
) => {
  const g = await evidenceGrant(db, viewer.orgId, evidenceId);
  const link = await downloadLink(
    db,
    storage,
    { actor: { type: "user", id: viewer.actorId }, orgId: g.grantorOrgId, requestId: null },
    evidenceId,
    version,
  );
  await logSharedAccess(db, g, viewer, "evidence_download", evidenceId);
  await withTenant(db, viewer.orgId, (tx) =>
    writeAudit(tx, { actor: { type: "user", id: viewer.actorId }, orgId: viewer.orgId, requestId: null }, [
      {
        action: "shared_evidence.downloaded",
        resourceType: "evidence",
        resourceId: evidenceId,
        data: { grantorOrgId: g.grantorOrgId, version },
      },
    ]),
  );
  return link;
};

/** Evidence shared with the viewer (for supplier compliance): grantor, status, type, validity. */
export const sharedEvidenceFrom = async (db: Db, viewerOrgId: string, grantorOrgId: string) => {
  const grants = await withTenant(db, viewerOrgId, (tx) =>
    tx.sharingGrant.findMany({
      where: { kind: "evidence", granteeOrgId: viewerOrgId, grantorOrgId, revokedAt: null },
    }),
  );
  if (!grants.length) return [];
  return withTenant(db, grantorOrgId, (tx) =>
    tx.evidence.findMany({
      where: { id: { in: grants.map((g) => g.evidenceId as string) } },
      select: { id: true, title: true, type: true, scheme: true, status: true, validUntil: true },
    }),
  );
};
