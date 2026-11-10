import {
  type Disclosure,
  type PassportDto,
  type PassportInput,
  PassportSnapshot,
} from "@casitrace/contracts";
import type { Db, Prisma, Tx } from "@casitrace/db";
import { AppError, newId } from "@casitrace/shared";
import type { z } from "zod";
import type { CommandContext } from "../../../platform/audit";
import { runCommand } from "../../../platform/command";
import { withTenant } from "../../../platform/tenant";
import { traceAcross } from "../../exchange/application/cross-trace";
import { orgIdentities } from "../../exchange/application/orgs";
import { canonicalize, type Json, type Signer, sha256Hex } from "../domain/signing";

type Ctx = CommandContext & { orgId: string };
type PassportOut = z.infer<typeof PassportDto>;

export interface PublicationConfig {
  signer: Signer;
  publicOrigin: string;
}

const PUBLIC_ID_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
const newPublicId = () =>
  Array.from(
    crypto.getRandomValues(new Uint8Array(10)),
    (b) => PUBLIC_ID_ALPHABET[b % PUBLIC_ID_ALPHABET.length],
  ).join("");
const day = (d: Date) => d.toISOString().slice(0, 10);
/** Coordinates rounded to 0.1° (~11 km): enough to show a region, not a farm. */
const approx = (n: number | null | undefined) => (n == null ? undefined : Math.round(n * 10) / 10);
const gtin14 = (g: string | null | undefined) => (g ? g.padStart(14, "0") : null);

/** GS1 Digital Link URL (ADR 0005) when the product has a GTIN, else the Casitrace fallback. */
export const publicUrls = (
  origin: string,
  publicId: string,
  gtin: string | null,
  lotCode: string | null,
) => ({
  page: `${origin}/p/${publicId}`,
  qr: gtin
    ? `${origin}/01/${gtin14(gtin)}${lotCode ? `/10/${encodeURIComponent(lotCode)}` : ""}`
    : `${origin}/p/${publicId}`,
});

const EVENT_STEP: Record<string, PassportSnapshot["journey"][number]["step"]> = {
  harvest: "harvest",
  milling: "milling",
  blending: "blending",
  bottling: "bottling",
};

const centroid = (boundary: unknown): { lat: number; lon: number } | null => {
  const b = boundary as { type?: string; coordinates?: number[][][] | number[][][][] } | null;
  const ring =
    b?.type === "Polygon"
      ? (b.coordinates as number[][][])[0]
      : b?.type === "MultiPolygon"
        ? (b.coordinates as number[][][][])[0]?.[0]
        : null;
  if (!ring?.length) return null;
  const pts = ring.slice(0, -1);
  return {
    lon: pts.reduce((s, p) => s + (p[0] ?? 0), 0) / pts.length,
    lat: pts.reduce((s, p) => s + (p[1] ?? 0), 0) / pts.length,
  };
};

/**
 * Builds the public content of a passport from the publisher's records and the parts of the chain
 * other organisations shared with it (with key data elements). Applies the disclosure policy and
 * validates the result strictly before anything is signed.
 */
export const buildSnapshot = async (
  db: Db,
  orgId: string,
  passportId: string,
  version: number,
  publishedAt: Date,
): Promise<PassportSnapshot> => {
  const { passport, product, pv, lot, profile } = await withTenant(db, orgId, async (tx) => {
    const passport = await tx.passport.findUniqueOrThrow({ where: { id: passportId } });
    const lot = passport.lotId ? await tx.lot.findUniqueOrThrow({ where: { id: passport.lotId } }) : null;
    const product = await tx.product.findUniqueOrThrow({ where: { id: passport.productId } });
    // A lot passport describes the version the lot was made with; a product passport the current one.
    const pv = await tx.productVersion.findUniqueOrThrow({
      where: lot
        ? { id: lot.productVersionId }
        : { productId_version: { productId: product.id, version: product.currentVersion } },
    });
    const profile = await tx.organizationProfile.findUnique({ where: { orgId } });
    return { passport, product, pv, lot, profile };
  });
  const disclosure = passport.disclosure as Disclosure;
  const me = (await orgIdentities(db, [orgId])).get(orgId);
  const attrs = pv.attributes as {
    grade?: string;
    cultivars?: string[];
    netVolumeMl?: number;
    container?: string;
    organic?: boolean;
  };

  const journey: PassportSnapshot["journey"] = [];
  let lotSection: PassportSnapshot["lot"];
  if (lot) {
    const t = await traceAcross(db, { orgId, actorId: null }, lot.id, "backward", 20);
    const harvestDates: string[] = [];
    const areas: NonNullable<NonNullable<PassportSnapshot["lot"]>["originAreas"]> = [];
    let milling: NonNullable<PassportSnapshot["lot"]>["milling"];
    let bestBefore: string | undefined;
    for (const seg of t.segments) {
      const own = seg.orgId === orgId;
      if (!seg.lotIds.length || (!own && !seg.grant?.includeKdes)) continue;
      const holder = t.nodes.find((n) => n.org.id === seg.orgId)?.org.name;
      await withTenant(db, seg.orgId, async (tx) => {
        const lots = await tx.lot.findMany({
          where: { id: { in: seg.lotIds } },
          select: { createdByEventId: true },
        });
        const events = await tx.traceEvent.findMany({
          where: {
            id: { in: lots.map((l) => l.createdByEventId) },
            type: { in: ["ORIGINATE", "RECEIVE", "TRANSFORM"] },
          },
          orderBy: { occurredAt: "asc" },
        });
        const locs = new Map(
          (
            await tx.location.findMany({
              where: { id: { in: events.map((e) => e.locationId).filter((x): x is string => !!x) } },
            })
          ).map((l) => [l.id, l]),
        );
        for (const e of events) {
          if (await tx.traceEvent.count({ where: { voidsEventId: e.id } })) continue;
          const loc = e.locationId ? locs.get(e.locationId) : undefined;
          const place = [loc?.city, loc?.region, loc?.countryCode].filter(Boolean).join(", ") || undefined;
          const by = own || disclosure.supplierNames ? holder : undefined;
          const kdes = e.kdes as {
            extractionMethod?: string;
            malaxationMaxTempC?: number;
            bestBefore?: string;
          };
          if (e.type === "ORIGINATE" && e.process === "harvest") {
            harvestDates.push(day(e.occurredAt));
            const c =
              loc?.latitude != null && loc.longitude != null
                ? { lat: loc.latitude.toNumber(), lon: loc.longitude.toNumber() }
                : centroid(loc?.boundary);
            if (disclosure.originArea)
              areas.push({
                country: loc?.countryCode ?? undefined,
                region: loc?.region ?? undefined,
                approxLat: approx(c?.lat),
                approxLon: approx(c?.lon),
              });
            journey.push({
              step: "harvest",
              ...(disclosure.harvestDates ? { date: day(e.occurredAt) } : {}),
              ...(place ? { place } : {}),
              ...(by ? { by } : {}),
            });
          } else if (e.type === "RECEIVE") {
            // Receipts from shared upstream are already represented by the upstream steps.
            if (own && !t.segments.some((s) => s.orgId !== orgId))
              journey.push({
                step: "receipt",
                ...(disclosure.harvestDates ? { date: day(e.occurredAt) } : {}),
                ...(by ? { by } : {}),
              });
          } else if (e.type === "TRANSFORM") {
            const step = EVENT_STEP[e.process ?? ""] ?? "processing";
            if (step === "milling") {
              milling = {
                ...(disclosure.harvestDates ? { date: day(e.occurredAt) } : {}),
                ...(disclosure.processDetails && kdes.extractionMethod
                  ? { extractionMethod: kdes.extractionMethod }
                  : {}),
                // EU marketing rules: "cold extraction" ≤ 27 °C (verify, docs/compliance/regulatory-facts.md).
                ...(disclosure.processDetails && typeof kdes.malaxationMaxTempC === "number"
                  ? { coldExtracted: kdes.malaxationMaxTempC <= 27 }
                  : {}),
              };
            }
            if (step === "bottling" && kdes.bestBefore && own) bestBefore = kdes.bestBefore;
            journey.push({
              step,
              ...(disclosure.harvestDates ? { date: day(e.occurredAt) } : {}),
              ...(place ? { place } : {}),
              ...(by ? { by } : {}),
            });
          }
        }
      });
    }
    harvestDates.sort();
    lotSection = {
      lotCode: lot.lotCode,
      ...(bestBefore ? { bestBefore } : {}),
      ...(disclosure.harvestDates && harvestDates.length
        ? { harvest: { from: harvestDates[0] as string, to: harvestDates.at(-1) as string } }
        : {}),
      ...(milling && Object.keys(milling).length ? { milling } : {}),
      ...(disclosure.originArea && areas.length ? { originAreas: areas } : {}),
    };
    journey.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  }

  // Certificates: linked to the organisation, the product, its version or the lot; never other documents.
  const certificates = disclosure.certificates
    ? await withTenant(db, orgId, async (tx) => {
        const targets = [
          { targetType: "organisation", targetId: orgId },
          { targetType: "product", targetId: product.id },
          { targetType: "product_version", targetId: pv.id },
          ...(lot ? [{ targetType: "lot", targetId: lot.id }] : []),
        ];
        const evidence = await tx.evidence.findMany({
          where: {
            type: "certificate",
            status: { in: ["checked", "verified", "expired"] },
            links: { some: { OR: targets } },
          },
          include: { files: true },
          orderBy: { createdAt: "asc" },
        });
        return evidence.map((e) => ({
          evidenceId: e.id,
          title: e.title,
          ...(e.scheme ? { scheme: e.scheme } : {}),
          ...(e.issuerName ? { issuer: e.issuerName } : {}),
          ...(e.validUntil ? { validUntil: day(e.validUntil) } : {}),
          statusAtPublication: e.status as "checked" | "verified" | "expired",
          sha256: e.files.find((f) => f.version === e.currentFileVersion)?.sha256 ?? "",
        }));
      })
    : [];

  const snapshot = {
    schema: "casitrace.passport@1" as const,
    publicId: passport.publicId,
    version,
    publishedAt: publishedAt.toISOString(),
    scope: passport.scope as "product" | "lot",
    product: {
      name: pv.name,
      category: pv.category,
      ...(attrs.grade ? { grade: attrs.grade } : {}),
      cultivars: attrs.cultivars ?? [],
      ...(attrs.netVolumeMl ? { netVolumeMl: attrs.netVolumeMl } : {}),
      ...(attrs.container ? { container: attrs.container } : {}),
      ...(typeof attrs.organic === "boolean" ? { organicDeclared: attrs.organic } : {}),
      ...(pv.gtin ? { gtin: pv.gtin } : {}),
      ...(pv.originCountry ? { originCountry: pv.originCountry } : {}),
      ...(pv.originRegion ? { originRegion: pv.originRegion } : {}),
      ...(pv.storageConditions ? { storage: pv.storageConditions } : {}),
      ...(pv.shelfLifeDays ? { shelfLifeDays: pv.shelfLifeDays } : {}),
    },
    producer: {
      name: me?.name ?? "",
      verified: me?.verified ?? false,
      ...(disclosure.producerAddress && profile?.countryCode ? { country: profile.countryCode } : {}),
      ...(disclosure.producerAddress && profile?.region ? { region: profile.region } : {}),
      ...(disclosure.producerAddress && profile?.city ? { city: profile.city } : {}),
    },
    ...(lotSection ? { lot: lotSection } : {}),
    journey,
    certificates,
    disclosure,
  };
  // Strict validation: any field outside the public schema is refused before signing.
  return PassportSnapshot.parse(snapshot);
};

// ─── commands ───────────────────────────────────────────────────────────────

const dto = async (tx: Tx, cfg: PublicationConfig, id: string): Promise<PassportOut> => {
  const p = await tx.passport.findUniqueOrThrow({
    where: { id },
    include: { versions: { orderBy: { version: "desc" } } },
  });
  const product = await tx.product.findUniqueOrThrow({ where: { id: p.productId } });
  const pv = await tx.productVersion.findUniqueOrThrow({
    where: { productId_version: { productId: product.id, version: product.currentVersion } },
  });
  const lot = p.lotId ? await tx.lot.findUnique({ where: { id: p.lotId } }) : null;
  const latest = p.versions[0];
  const urls = publicUrls(cfg.publicOrigin, p.publicId, latest?.gtin ?? pv.gtin, lot?.lotCode ?? null);
  const since = new Date(Date.now() - 30 * 86_400_000);
  const views = await tx.passportViewDaily.groupBy({
    by: ["source"],
    where: { passportId: id, day: { gte: since } },
    _sum: { views: true },
  });
  const viewCount = (s: string) => views.find((v) => v.source === s)?._sum.views ?? 0;
  return {
    id: p.id,
    publicId: p.publicId,
    scope: p.scope as "product" | "lot",
    product: { id: product.id, sku: product.sku, name: pv.name },
    lot: lot ? { id: lot.id, lotCode: lot.lotCode } : null,
    disclosure: p.disclosure as Disclosure,
    status: p.status as PassportOut["status"],
    currentVersion: p.currentVersion,
    publicUrl: urls.page,
    qrPayload: urls.qr,
    versions: p.versions.map((v) => ({
      version: v.version,
      publishedAt: v.publishedAt.toISOString(),
      digest: v.digest,
      keyId: v.keyId,
    })),
    views30d: { qr: viewCount("qr"), page: viewCount("page") },
    updatedAt: p.updatedAt.toISOString(),
  };
};

export const createPassport = (
  db: Db,
  cfg: PublicationConfig,
  ctx: Ctx,
  input: z.infer<typeof PassportInput>,
) =>
  runCommand(db, ctx, async (tx) => {
    let productId = input.productId;
    if (input.scope === "lot") {
      const lot = await tx.lot.findUnique({ where: { id: input.lotId as string } });
      if (!lot || lot.status === "voided") throw new AppError("NOT_FOUND", "Lot not found.");
      productId = lot.productId;
      if (await tx.passport.count({ where: { lotId: lot.id, status: { not: "withdrawn" } } })) {
        throw new AppError("CONFLICT", "This lot already has a public page.");
      }
    } else if (!(await tx.product.count({ where: { id: productId as string } }))) {
      throw new AppError("NOT_FOUND", "Product not found.");
    }
    const id = newId();
    await tx.passport.create({
      data: {
        id,
        orgId: ctx.orgId,
        publicId: newPublicId(),
        scope: input.scope,
        productId: productId as string,
        lotId: input.scope === "lot" ? (input.lotId as string) : null,
        template: "olive-oil@1",
        disclosure: input.disclosure as unknown as Prisma.InputJsonValue,
        createdById: ctx.actor.id,
      },
    });
    return {
      result: await dto(tx, cfg, id),
      audit: [
        {
          action: "passport.created",
          resourceType: "passport",
          resourceId: id,
          data: { scope: input.scope },
        },
      ],
    };
  });

export const updateDisclosure = (
  db: Db,
  cfg: PublicationConfig,
  ctx: Ctx,
  id: string,
  disclosure: Disclosure,
) =>
  runCommand(db, ctx, async (tx) => {
    if (!(await tx.passport.count({ where: { id } }))) throw new AppError("NOT_FOUND", "Passport not found.");
    await tx.passport.update({
      where: { id },
      data: { disclosure: disclosure as unknown as Prisma.InputJsonValue },
    });
    return {
      result: await dto(tx, cfg, id),
      audit: [
        {
          action: "passport.disclosure_changed",
          resourceType: "passport",
          resourceId: id,
          data: disclosure as unknown as Prisma.InputJsonValue,
        },
      ],
    };
  });

export const previewPassport = async (db: Db, orgId: string, id: string) => {
  const p = await withTenant(db, orgId, (tx) => tx.passport.findUnique({ where: { id } }));
  if (!p) throw new AppError("NOT_FOUND", "Passport not found.");
  return buildSnapshot(db, orgId, id, p.currentVersion + 1, new Date());
};

/** Publishes the next version: build → canonical JSON → SHA-256 → Ed25519 signature → immutable row. */
export const publishPassport = async (db: Db, cfg: PublicationConfig, ctx: Ctx, id: string) => {
  const p = await withTenant(db, ctx.orgId, (tx) => tx.passport.findUnique({ where: { id } }));
  if (!p) throw new AppError("NOT_FOUND", "Passport not found.");
  const version = p.currentVersion + 1;
  const snapshot = await buildSnapshot(db, ctx.orgId, id, version, new Date());
  const canonical = canonicalize(snapshot as unknown as Json);
  const { signature, kid } = await cfg.signer.sign(canonical);
  return runCommand(db, ctx, async (tx) => {
    const moved = await tx.passport.updateMany({
      where: { id, currentVersion: p.currentVersion },
      data: { currentVersion: version, status: "published" },
    });
    if (moved.count !== 1)
      throw new AppError("CONFLICT", "Someone published this page at the same time. Reload and try again.");
    await tx.passportVersion.create({
      data: {
        id: newId(),
        orgId: ctx.orgId,
        passportId: id,
        version,
        canonical,
        digest: sha256Hex(canonical),
        signature,
        keyId: kid,
        gtin: gtin14(snapshot.product.gtin),
        lotCode: snapshot.lot?.lotCode ?? null,
        publishedById: ctx.actor.id,
      },
    });
    return {
      result: await dto(tx, cfg, id),
      audit: [
        {
          action: "passport.published",
          resourceType: "passport",
          resourceId: id,
          data: { version, digest: sha256Hex(canonical), keyId: kid },
        },
      ],
    };
  });
};

export const withdrawPassport = (db: Db, cfg: PublicationConfig, ctx: Ctx, id: string) =>
  runCommand(db, ctx, async (tx) => {
    const p = await tx.passport.findUnique({ where: { id } });
    if (!p) throw new AppError("NOT_FOUND", "Passport not found.");
    if (p.status !== "published") throw new AppError("CONFLICT", "Only a published page can be withdrawn.");
    await tx.passport.update({ where: { id }, data: { status: "withdrawn" } });
    return {
      result: await dto(tx, cfg, id),
      audit: [{ action: "passport.withdrawn", resourceType: "passport", resourceId: id }],
    };
  });

export const listPassports = (db: Db, cfg: PublicationConfig, orgId: string) =>
  withTenant(db, orgId, async (tx) => {
    const rows = await tx.passport.findMany({
      orderBy: { createdAt: "desc" },
      take: 500,
      select: { id: true },
    });
    const out: PassportOut[] = [];
    for (const r of rows) out.push(await dto(tx, cfg, r.id));
    return out;
  });

export const getPassport = (db: Db, cfg: PublicationConfig, orgId: string, id: string) =>
  withTenant(db, orgId, async (tx) => {
    if (!(await tx.passport.count({ where: { id } }))) throw new AppError("NOT_FOUND", "Passport not found.");
    return dto(tx, cfg, id);
  });
