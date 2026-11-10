import {
  type Evidence,
  type EvidenceMetadata,
  type EvidenceStatus,
  type EvidenceSummary,
  type EvidenceTarget,
  type EvidenceUpdate,
  MAX_EVIDENCE_BYTES,
} from "@casitrace/contracts";
import type { Db, Prisma, Tx } from "@casitrace/db";
import { AppError, newId, type ObjectStorage } from "@casitrace/shared";
import type { z } from "zod";
import { type CommandContext, writeAudit } from "../../../platform/audit";
import { runCommand } from "../../../platform/command";
import { iso } from "../../../platform/dto";
import { withTenant } from "../../../platform/tenant";
import { ACCEPTED_DESCRIPTION, detectFileType } from "../domain/file-type";
import {
  canEditDetails,
  canUploadNewVersion,
  daysUntil,
  decideReview,
  type ReviewAction,
} from "../domain/review";

type Ctx = CommandContext & { orgId: string };
type EvidenceDto = z.infer<typeof Evidence>;
type SummaryDto = z.infer<typeof EvidenceSummary>;

const DOWNLOAD_SECONDS = 300;
const dateOnly = (s: string | null | undefined) => (s ? new Date(`${s}T00:00:00Z`) : null);
const isoDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

// ─── files ──────────────────────────────────────────────────────────────────

export interface PreparedFile {
  bytes: Uint8Array;
  sha256: string;
  mediaType: string;
  extension: string;
  originalName: string;
}

/** Size limit, content sniffing against the allow-list, and SHA-256 of the exact bytes stored. */
export const prepareFile = async (file: File): Promise<PreparedFile> => {
  if (file.size === 0)
    throw new AppError("VALIDATION_FAILED", "The file is empty.", [{ path: "file", message: "empty" }]);
  if (file.size > MAX_EVIDENCE_BYTES) {
    throw new AppError("VALIDATION_FAILED", `Files can be up to ${MAX_EVIDENCE_BYTES / 1024 / 1024} MB.`, [
      { path: "file", message: "too large" },
    ]);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const originalName = (file.name || "upload").replace(/[\\/\r\n"]/g, "_").slice(0, 200);
  const type = detectFileType(bytes, originalName);
  if (!type) {
    throw new AppError("VALIDATION_FAILED", `This file type is not accepted. Use ${ACCEPTED_DESCRIPTION}.`, [
      { path: "file", message: "unsupported type" },
    ]);
  }
  const sha256 = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
  return { bytes, sha256, mediaType: type.mediaType, extension: type.extension, originalName };
};

const storageKey = (orgId: string, evidenceId: string, version: number, f: PreparedFile) =>
  `orgs/${orgId}/evidence/${evidenceId}/v${version}-${f.sha256}.${f.extension}`;

// ─── links ──────────────────────────────────────────────────────────────────

/** Confirms every link target exists in this organisation (RLS scopes the lookups). */
const checkTargets = async (
  tx: Tx,
  orgId: string,
  links: { targetType: EvidenceTarget; targetId: string }[],
) => {
  for (const [i, l] of links.entries()) {
    const path = `links.${i}`;
    let found = false;
    switch (l.targetType) {
      case "organisation":
        found = l.targetId === orgId;
        break;
      case "location":
        found = (await tx.location.count({ where: { id: l.targetId } })) > 0;
        break;
      case "partner":
        found = (await tx.tradingPartner.count({ where: { id: l.targetId } })) > 0;
        break;
      case "product":
        found = (await tx.product.count({ where: { id: l.targetId } })) > 0;
        break;
      case "product_version":
        found = (await tx.productVersion.count({ where: { id: l.targetId } })) > 0;
        break;
      case "lot":
        found = (await tx.lot.count({ where: { id: l.targetId } })) > 0;
        break;
      case "event":
        found = (await tx.traceEvent.count({ where: { id: l.targetId } })) > 0;
        break;
    }
    if (!found)
      throw new AppError("VALIDATION_FAILED", `Linked ${l.targetType} not found.`, [
        { path, message: "not found" },
      ]);
  }
};

const linkLabels = async (tx: Tx, links: { targetType: string; targetId: string }[]) => {
  const ids = (t: string) => links.filter((l) => l.targetType === t).map((l) => l.targetId);
  const labels = new Map<string, string>();
  const [orgs, locations, partners, products, versions, lots, events] = await Promise.all([
    tx.organization.findMany({
      where: { id: { in: ids("organisation") } },
      select: { id: true, name: true },
    }),
    tx.location.findMany({
      where: { id: { in: ids("location") } },
      select: { id: true, code: true, name: true },
    }),
    tx.tradingPartner.findMany({ where: { id: { in: ids("partner") } }, select: { id: true, name: true } }),
    tx.product.findMany({ where: { id: { in: ids("product") } }, select: { id: true, sku: true } }),
    tx.productVersion.findMany({
      where: { id: { in: ids("product_version") } },
      select: { id: true, name: true, version: true },
    }),
    tx.lot.findMany({ where: { id: { in: ids("lot") } }, select: { id: true, lotCode: true } }),
    tx.traceEvent.findMany({
      where: { id: { in: ids("event") } },
      select: { id: true, type: true, occurredAt: true },
    }),
  ]);
  for (const l of lots) labels.set(l.id, `Lot ${l.lotCode}`);
  for (const e of events) labels.set(e.id, `${e.type} ${e.occurredAt.toISOString().slice(0, 10)}`);
  for (const o of orgs) labels.set(o.id, o.name);
  for (const l of locations) labels.set(l.id, `${l.code} · ${l.name}`);
  for (const p of partners) labels.set(p.id, p.name);
  for (const p of products) labels.set(p.id, p.sku);
  for (const v of versions) labels.set(v.id, `${v.name} (v${v.version})`);
  return labels;
};

const checkIssuer = async (tx: Tx, issuerPartnerId: string | null | undefined) => {
  if (issuerPartnerId && !(await tx.tradingPartner.count({ where: { id: issuerPartnerId } }))) {
    throw new AppError("VALIDATION_FAILED", "Issuer partner not found.", [
      { path: "issuerPartnerId", message: "not found" },
    ]);
  }
};

// ─── DTOs ───────────────────────────────────────────────────────────────────

type EvidenceRow = Prisma.EvidenceGetPayload<{ include: { _count: { select: { links: true } } } }>;

const summaryDto = (e: EvidenceRow, today: Date): SummaryDto => ({
  id: e.id,
  type: e.type as SummaryDto["type"],
  title: e.title,
  status: e.status as EvidenceStatus,
  currentFileVersion: e.currentFileVersion,
  scheme: e.scheme,
  issuerName: e.issuerName,
  certificateNumber: e.certificateNumber,
  validUntil: isoDate(e.validUntil),
  daysUntilExpiry: daysUntil(e.validUntil, today),
  linkCount: e._count.links,
  updatedAt: e.updatedAt.toISOString(),
});

const loadEvidence = async (tx: Tx, id: string, today = new Date()): Promise<EvidenceDto> => {
  const e = await tx.evidence.findUnique({
    where: { id },
    include: {
      _count: { select: { links: true } },
      files: { orderBy: { version: "desc" } },
      links: { orderBy: { createdAt: "asc" } },
      changes: { orderBy: { occurredAt: "asc" } },
    },
  });
  if (!e) throw new AppError("NOT_FOUND", "Evidence not found.");
  const labels = await linkLabels(tx, e.links);
  return {
    ...summaryDto(e, today),
    description: e.description,
    issuerPartnerId: e.issuerPartnerId,
    scope: e.scope,
    validFrom: isoDate(e.validFrom),
    createdById: e.createdById,
    createdAt: e.createdAt.toISOString(),
    files: e.files.map((f) => ({
      version: f.version,
      sha256: f.sha256,
      sizeBytes: f.sizeBytes,
      mediaType: f.mediaType,
      originalName: f.originalName,
      uploadedById: f.uploadedById,
      uploadedAt: f.uploadedAt.toISOString(),
      scanStatus: f.scanStatus as EvidenceDto["files"][number]["scanStatus"],
      scannedAt: iso(f.scannedAt),
    })),
    links: e.links.map((l) => ({
      id: l.id,
      targetType: l.targetType as EvidenceTarget,
      targetId: l.targetId,
      label: labels.get(l.targetId) ?? null,
    })),
    history: e.changes.map((c) => ({
      fromStatus: c.fromStatus,
      toStatus: c.toStatus,
      reason: c.reason,
      actorType: c.actorType,
      actorId: c.actorId,
      fileVersion: c.fileVersion,
      occurredAt: c.occurredAt.toISOString(),
    })),
  };
};

const recordChange = (
  tx: Tx,
  ctx: Ctx,
  evidenceId: string,
  from: string | null,
  to: string,
  reason: string | null,
  fileVersion: number | null,
) =>
  tx.evidenceStatusChange.create({
    data: {
      id: newId(),
      orgId: ctx.orgId,
      evidenceId,
      fromStatus: from,
      toStatus: to,
      reason,
      actorType: ctx.actor.type,
      actorId: ctx.actor.id,
      fileVersion,
    },
  });

const certificateData = (m: z.infer<typeof EvidenceUpdate> | EvidenceMetadata) => ({
  scheme: m.scheme ?? null,
  issuerName: m.issuerName ?? null,
  issuerPartnerId: m.issuerPartnerId ?? null,
  certificateNumber: m.certificateNumber ?? null,
  scope: m.scope ?? null,
  validFrom: dateOnly(m.validFrom),
  validUntil: dateOnly(m.validUntil),
});

// ─── commands ───────────────────────────────────────────────────────────────

export const uploadEvidence = async (
  db: Db,
  storage: ObjectStorage,
  ctx: Ctx,
  file: File,
  meta: EvidenceMetadata,
) => {
  const prepared = await prepareFile(file);
  const evidenceId = newId();
  const key = storageKey(ctx.orgId, evidenceId, 1, prepared);
  // Validate references before storing anything.
  await withTenant(db, ctx.orgId, async (tx) => {
    await checkTargets(tx, ctx.orgId, meta.links);
    await checkIssuer(tx, meta.issuerPartnerId);
  });
  // Store first: if the transaction then fails, an unreferenced object remains (harmless, private);
  // the reverse order could leave a database record pointing at nothing.
  await storage.put(key, prepared.bytes, prepared.mediaType);

  return runCommand(db, ctx, async (tx) => {
    await checkTargets(tx, ctx.orgId, meta.links);
    const fileId = newId();
    await tx.evidence.create({
      data: {
        id: evidenceId,
        orgId: ctx.orgId,
        type: meta.type,
        title: meta.title,
        description: meta.description ?? null,
        currentFileVersion: 1,
        createdById: ctx.actor.id,
        ...certificateData(meta),
      },
    });
    await tx.evidenceFile.create({
      data: {
        id: fileId,
        orgId: ctx.orgId,
        evidenceId,
        version: 1,
        storageKey: key,
        sha256: prepared.sha256,
        sizeBytes: prepared.bytes.length,
        mediaType: prepared.mediaType,
        originalName: prepared.originalName,
        uploadedById: ctx.actor.id,
      },
    });
    if (meta.links.length) {
      await tx.evidenceLink.createMany({
        data: meta.links.map((l) => ({
          id: newId(),
          orgId: ctx.orgId,
          evidenceId,
          ...l,
          createdById: ctx.actor.id,
        })),
        skipDuplicates: true,
      });
    }
    await recordChange(tx, ctx, evidenceId, null, "submitted", null, 1);
    return {
      result: await loadEvidence(tx, evidenceId),
      audit: [
        {
          action: "evidence.uploaded",
          resourceType: "evidence",
          resourceId: evidenceId,
          data: {
            type: meta.type,
            version: 1,
            sha256: prepared.sha256,
            sizeBytes: prepared.bytes.length,
            mediaType: prepared.mediaType,
          },
        },
      ],
      events: [
        {
          type: "evidence.file_uploaded",
          aggregateType: "evidence",
          aggregateId: evidenceId,
          payload: { fileId, version: 1, storageKey: key, sha256: prepared.sha256 },
        },
      ],
    };
  });
};

export const uploadNewVersion = async (
  db: Db,
  storage: ObjectStorage,
  ctx: Ctx,
  evidenceId: string,
  file: File,
) => {
  const prepared = await prepareFile(file);
  const current = await withTenant(db, ctx.orgId, (tx) =>
    tx.evidence.findUnique({ where: { id: evidenceId } }),
  );
  if (!current) throw new AppError("NOT_FOUND", "Evidence not found.");
  if (!canUploadNewVersion(current.status as EvidenceStatus)) {
    throw new AppError("CONFLICT", "Revoked evidence cannot get new files. Upload it as new evidence.");
  }
  const version = current.currentFileVersion + 1;
  const key = storageKey(ctx.orgId, evidenceId, version, prepared);
  await storage.put(key, prepared.bytes, prepared.mediaType);

  return runCommand(db, ctx, async (tx) => {
    // Optimistic check: a concurrent upload would have taken this version number.
    const updated = await tx.evidence.updateMany({
      where: { id: evidenceId, currentFileVersion: current.currentFileVersion },
      data: { currentFileVersion: version, status: "submitted", expiryNoticeDays: null },
    });
    if (updated.count !== 1)
      throw new AppError("CONFLICT", "Another file was uploaded at the same time. Reload and try again.");
    const fileId = newId();
    await tx.evidenceFile.create({
      data: {
        id: fileId,
        orgId: ctx.orgId,
        evidenceId,
        version,
        storageKey: key,
        sha256: prepared.sha256,
        sizeBytes: prepared.bytes.length,
        mediaType: prepared.mediaType,
        originalName: prepared.originalName,
        uploadedById: ctx.actor.id,
      },
    });
    await recordChange(tx, ctx, evidenceId, current.status, "submitted", "New file uploaded", version);
    return {
      result: await loadEvidence(tx, evidenceId),
      audit: [
        {
          action: "evidence.file_replaced",
          resourceType: "evidence",
          resourceId: evidenceId,
          data: { version, sha256: prepared.sha256 },
        },
      ],
      events: [
        {
          type: "evidence.file_uploaded",
          aggregateType: "evidence",
          aggregateId: evidenceId,
          payload: { fileId, version, storageKey: key, sha256: prepared.sha256 },
        },
      ],
    };
  });
};

export const updateEvidence = (db: Db, ctx: Ctx, id: string, input: z.infer<typeof EvidenceUpdate>) =>
  runCommand(db, ctx, async (tx) => {
    const e = await tx.evidence.findUnique({ where: { id } });
    if (!e) throw new AppError("NOT_FOUND", "Evidence not found.");
    if (!canEditDetails(e.status as EvidenceStatus)) {
      throw new AppError(
        "CONFLICT",
        `Details of ${e.status} evidence cannot change. Upload a new file instead.`,
      );
    }
    if (e.type === "certificate" && (!input.scheme || !input.issuerName || !input.validUntil)) {
      throw new AppError("VALIDATION_FAILED", "A certificate needs a scheme, issuer and expiry date.");
    }
    if (input.validFrom && input.validUntil && input.validFrom > input.validUntil) {
      throw new AppError("VALIDATION_FAILED", "Expiry must be on or after the start date.", [
        { path: "validUntil", message: "before start" },
      ]);
    }
    await checkIssuer(tx, input.issuerPartnerId);
    await tx.evidence.update({
      where: { id },
      data: {
        title: input.title,
        description: input.description ?? null,
        ...certificateData(input),
        expiryNoticeDays: null,
      },
    });
    return {
      result: await loadEvidence(tx, id),
      audit: [{ action: "evidence.updated", resourceType: "evidence", resourceId: id }],
    };
  });

export const reviewEvidence = (db: Db, ctx: Ctx, id: string, action: ReviewAction, reason?: string) =>
  runCommand(db, ctx, async (tx) => {
    const e = await tx.evidence.findUnique({ where: { id } });
    if (!e) throw new AppError("NOT_FOUND", "Evidence not found.");
    const file = await tx.evidenceFile.findUniqueOrThrow({
      where: { evidenceId_version: { evidenceId: id, version: e.currentFileVersion } },
    });
    const to = decideReview({
      action,
      reason,
      status: e.status as EvidenceStatus,
      reviewerId: ctx.actor.id ?? "",
      uploaderId: file.uploadedById,
      validUntil: e.validUntil,
      today: new Date(),
    });
    // Guard against a concurrent transition (e.g. the scan or expiry job).
    const updated = await tx.evidence.updateMany({ where: { id, status: e.status }, data: { status: to } });
    if (updated.count !== 1)
      throw new AppError(
        "CONFLICT",
        "The evidence changed while you were reviewing it. Reload and try again.",
      );
    await recordChange(tx, ctx, id, e.status, to, reason?.trim() || null, e.currentFileVersion);
    return {
      result: await loadEvidence(tx, id),
      audit: [
        {
          action: `evidence.${to}`,
          resourceType: "evidence",
          resourceId: id,
          data: { from: e.status, reason: reason ?? null },
        },
      ],
      events: [
        { type: `evidence.${to}`, aggregateType: "evidence", aggregateId: id, payload: { from: e.status } },
      ],
    };
  });

export const addLinks = (
  db: Db,
  ctx: Ctx,
  id: string,
  links: { targetType: EvidenceTarget; targetId: string }[],
) =>
  runCommand(db, ctx, async (tx) => {
    if (!(await tx.evidence.count({ where: { id } }))) throw new AppError("NOT_FOUND", "Evidence not found.");
    await checkTargets(tx, ctx.orgId, links);
    await tx.evidenceLink.createMany({
      data: links.map((l) => ({
        id: newId(),
        orgId: ctx.orgId,
        evidenceId: id,
        ...l,
        createdById: ctx.actor.id,
      })),
      skipDuplicates: true,
    });
    return {
      result: await loadEvidence(tx, id),
      audit: [{ action: "evidence.linked", resourceType: "evidence", resourceId: id, data: { links } }],
    };
  });

export const removeLink = (db: Db, ctx: Ctx, id: string, linkId: string) =>
  runCommand(db, ctx, async (tx) => {
    const link = await tx.evidenceLink.findFirst({ where: { id: linkId, evidenceId: id } });
    if (!link) throw new AppError("NOT_FOUND", "Link not found.");
    await tx.evidenceLink.delete({ where: { id: linkId } });
    return {
      result: await loadEvidence(tx, id),
      audit: [
        {
          action: "evidence.unlinked",
          resourceType: "evidence",
          resourceId: id,
          data: { targetType: link.targetType, targetId: link.targetId },
        },
      ],
    };
  });

// ─── queries ────────────────────────────────────────────────────────────────

export interface EvidenceFilter {
  status?: EvidenceStatus;
  type?: string;
  targetType?: EvidenceTarget;
  targetId?: string;
  expiringWithinDays?: number;
}

export const listEvidence = (db: Db, orgId: string, f: EvidenceFilter) =>
  withTenant(db, orgId, async (tx) => {
    const today = new Date();
    const where: Prisma.EvidenceWhereInput = {
      ...(f.status ? { status: f.status } : {}),
      ...(f.type ? { type: f.type } : {}),
      ...(f.targetType && f.targetId
        ? { links: { some: { targetType: f.targetType, targetId: f.targetId } } }
        : {}),
      ...(f.expiringWithinDays !== undefined
        ? { validUntil: { not: null, lte: new Date(today.getTime() + f.expiringWithinDays * 86_400_000) } }
        : {}),
    };
    const rows = await tx.evidence.findMany({
      where,
      include: { _count: { select: { links: true } } },
      orderBy: [{ updatedAt: "desc" }],
      take: 1000,
    });
    return rows.map((r) => summaryDto(r, today));
  });

export const getEvidence = (db: Db, orgId: string, id: string) =>
  withTenant(db, orgId, (tx) => loadEvidence(tx, id));

const loadFile = async (tx: Tx, evidenceId: string, version: number) => {
  const file = await tx.evidenceFile.findUnique({ where: { evidenceId_version: { evidenceId, version } } });
  if (!file) throw new AppError("NOT_FOUND", "File version not found.");
  return file;
};

/** Short-lived download link, only for files that passed the virus scan. The access is audited. */
export const downloadLink = (db: Db, storage: ObjectStorage, ctx: Ctx, evidenceId: string, version: number) =>
  withTenant(db, ctx.orgId, async (tx) => {
    const file = await loadFile(tx, evidenceId, version);
    if (file.scanStatus !== "clean") {
      throw new AppError(
        "CONFLICT",
        file.scanStatus === "pending"
          ? "The file is still being scanned. Try again shortly."
          : "This file failed the virus scan and cannot be downloaded.",
      );
    }
    await writeAudit(tx, ctx, [
      { action: "evidence.downloaded", resourceType: "evidence", resourceId: evidenceId, data: { version } },
    ]);
    return {
      url: storage.presign(file.storageKey, { method: "GET", expiresInSeconds: DOWNLOAD_SECONDS }),
      expiresAt: new Date(Date.now() + DOWNLOAD_SECONDS * 1000).toISOString(),
      sha256: file.sha256,
      fileName: file.originalName,
    };
  });

/** Re-reads the stored object and compares its SHA-256 with the recorded one. */
export const checkIntegrity = (
  db: Db,
  storage: ObjectStorage,
  ctx: Ctx,
  evidenceId: string,
  version: number,
) =>
  withTenant(db, ctx.orgId, async (tx) => {
    const file = await loadFile(tx, evidenceId, version);
    if (file.scanStatus === "infected")
      throw new AppError("CONFLICT", "This file failed the virus scan and was removed.");
    const bytes = await storage.read(file.storageKey);
    const actual = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
    const match = actual === file.sha256;
    await writeAudit(tx, ctx, [
      {
        action: "evidence.integrity_checked",
        resourceType: "evidence",
        resourceId: evidenceId,
        data: { version, match },
      },
    ]);
    return {
      version,
      storedSha256: file.sha256,
      actualSha256: actual,
      match,
      checkedAt: new Date().toISOString(),
    };
  });
