import { type PassportSnapshot, PassportSnapshot as SnapshotSchema } from "@casitrace/contracts";
import type { Db } from "@casitrace/db";
import { AppError } from "@casitrace/shared";
import { withTenant } from "../../../platform/tenant";
import { type Signer, sha256Hex } from "../domain/signing";

interface PublicRow {
  public_id: string;
  status: "published" | "withdrawn";
  current_version: number;
  org_id: string;
  version: number;
  digest: string;
  signature: string;
  key_id: string;
  lot_id: string | null;
}

/** Reads only the public view: published (or withdrawn) versions of passports. No snapshot body. */
const row = async (db: Db, publicId: string, version?: number) => {
  const rows = await db.$queryRaw<PublicRow[]>`
    SELECT public_id, status, current_version, org_id, version, digest, signature, key_id, lot_id
    FROM public_passport_version
    WHERE public_id = ${publicId} AND version = COALESCE(${version ?? null}::int, current_version)
    LIMIT 1`;
  const r = rows[0];
  if (!r) throw new AppError("NOT_FOUND", "No public page with this address.");
  return r;
};

interface Verified {
  canonical: string;
  snapshot: PassportSnapshot;
  digestMatches: boolean;
  valid: boolean;
  at: number;
}

/**
 * Published versions are immutable, so their parsed snapshot and signature check are computed once
 * per signer and kept briefly in memory (P9 load test: parsing and verifying large snapshots on every
 * view capped the page at 5 requests/s). Keyed by digest, so a different body can never hit the cache.
 * The TTL bounds how long a key withdrawn from the signer's list would still count as valid.
 */
const VERIFIED_TTL_MS = 10 * 60_000;
const VERIFIED_MAX = 500;
const verifiedCache = new WeakMap<Signer, Map<string, Verified>>();

const verified = async (db: Db, signer: Signer, r: PublicRow): Promise<Verified> => {
  let cache = verifiedCache.get(signer);
  if (!cache) {
    cache = new Map();
    verifiedCache.set(signer, cache);
  }
  const key = `${r.public_id}:${r.version}:${r.digest}:${r.key_id}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < VERIFIED_TTL_MS) return hit;
  const [body] = await db.$queryRaw<{ canonical: string }[]>`
    SELECT canonical FROM public_passport_version WHERE public_id = ${r.public_id} AND version = ${r.version}`;
  if (!body) throw new AppError("NOT_FOUND", "No public page with this address.");
  const digestMatches = sha256Hex(body.canonical) === r.digest;
  const v: Verified = {
    canonical: body.canonical,
    snapshot: SnapshotSchema.parse(JSON.parse(body.canonical)),
    digestMatches,
    valid: digestMatches && (await signer.verify(body.canonical, r.signature, r.key_id)),
    at: Date.now(),
  };
  // Only valid content is cached; an invalid row is re-checked on every request.
  if (v.valid) {
    if (cache.size >= VERIFIED_MAX) cache.delete(cache.keys().next().value as string);
    cache.set(key, v);
  }
  return v;
};

/** Live facts that can change after publication: recall and current certificate status. */
const liveFacts = (db: Db, r: PublicRow, snapshot: PassportSnapshot) =>
  withTenant(db, r.org_id, async (tx) => {
    const lot = r.lot_id
      ? await tx.lot.findUnique({ where: { id: r.lot_id }, select: { status: true, recallCaseId: true } })
      : null;
    const ids = snapshot.certificates.map((c) => c.evidenceId);
    const ev = ids.length
      ? await tx.evidence.findMany({ where: { id: { in: ids } }, select: { id: true, status: true } })
      : [];
    return {
      recall: lot?.status === "recalled" || !!lot?.recallCaseId,
      certificates: snapshot.certificates.map((c) => ({
        evidenceId: c.evidenceId,
        status: ev.find((e) => e.id === c.evidenceId)?.status ?? "removed",
      })),
    };
  });

/** One read of everything a public page needs: the signed version, its check and the live facts. */
export const loadPublicPassport = async (db: Db, signer: Signer, publicId: string, version?: number) => {
  const r = await row(db, publicId, version);
  const v = await verified(db, signer, r);
  const live = await liveFacts(db, r, v.snapshot);
  return {
    passport: {
      snapshot: v.snapshot,
      canonical: v.canonical,
      digest: r.digest,
      signature: { alg: "EdDSA" as const, kid: r.key_id, value: r.signature },
      live: {
        latestVersion: r.current_version,
        isLatest: r.version === r.current_version,
        status: r.status,
        ...live,
      },
    },
    check: {
      publicId,
      version: r.version,
      valid: v.valid,
      kid: r.key_id,
      digest: r.digest,
      digestMatches: v.digestMatches,
      latestVersion: r.current_version,
      status: r.status,
      recall: live.recall,
      explanation: v.valid
        ? "Casitrace published exactly this content and it has not changed since. The signature does not prove that the producer's claims are true; certificate statuses show what has been checked."
        : "The signature does not match this content. Do not rely on it.",
    },
  };
};

export const getPublicPassport = async (db: Db, signer: Signer, publicId: string, version?: number) =>
  (await loadPublicPassport(db, signer, publicId, version)).passport;

export const verifyPublicPassport = async (db: Db, signer: Signer, publicId: string, version?: number) =>
  (await loadPublicPassport(db, signer, publicId, version)).check;

/** GS1 Digital Link resolution (ADR 0005): /01/{gtin}[/10/{lot}] → the newest matching public page. */
export const resolveDigitalLink = async (db: Db, gtin: string, lotCode?: string): Promise<string> => {
  const g = gtin.padStart(14, "0");
  const rows = await db.$queryRaw<{ public_id: string; version: number }[]>`
    SELECT public_id, current_version AS version FROM public_passport_version
    WHERE gtin = ${g} AND version = current_version
      AND (${lotCode ?? null}::text IS NULL OR lot_code = ${lotCode ?? null}::text)
    ORDER BY (lot_code IS NOT NULL AND lot_code = ${lotCode ?? null}::text) DESC, published_at DESC
    LIMIT 1`;
  if (!rows[0] && lotCode) return resolveDigitalLink(db, gtin); // fall back to the product page
  if (!rows[0]) throw new AppError("NOT_FOUND", "No public page for this product code.");
  return rows[0].public_id;
};

export interface DirectoryRow {
  id: string;
  name: string;
  city: string | null;
  region: string | null;
  country_code: string | null;
  business_roles: string[];
  website: string | null;
  description: string | null;
  verified: boolean;
}
const entry = (r: DirectoryRow) => ({
  id: r.id,
  name: r.name,
  city: r.city,
  region: r.region,
  countryCode: r.country_code,
  businessRoles: r.business_roles,
  website: r.website,
  description: r.description,
  verified: r.verified,
});

/** Directory search: opt-in organisations only, a query is required, at most 50 results. */
export const searchDirectory = async (db: Db, q: string) => {
  const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  const rows = await db.$queryRaw<DirectoryRow[]>`
    SELECT id, name, city, region, country_code, business_roles, website, description, verified
    FROM public_directory
    WHERE name ILIKE ${like} OR city ILIKE ${like} OR region ILIKE ${like}
    ORDER BY verified DESC, name LIMIT 50`;
  return rows.map(entry);
};

export const publicOrganisation = async (db: Db, orgId: string) => {
  const rows = await db.$queryRaw<DirectoryRow[]>`
    SELECT id, name, city, region, country_code, business_roles, website, description, verified FROM public_directory WHERE id = ${orgId}::uuid`;
  const r = rows[0];
  if (!r) throw new AppError("NOT_FOUND", "This organisation has no public profile.");
  const pages = await db.$queryRaw<{ public_id: string; canonical: string }[]>`
    SELECT public_id, canonical FROM public_passport_version
    WHERE org_id = ${orgId}::uuid AND status = 'published' AND version = current_version
    ORDER BY published_at DESC LIMIT 100`;
  return {
    ...entry(r),
    passports: pages.map((p) => {
      const s = JSON.parse(p.canonical) as PassportSnapshot;
      return { publicId: p.public_id, productName: s.product.name, lotCode: s.lot?.lotCode ?? null };
    }),
  };
};

/** Adds one anonymous view to today's count (no personal data is stored; see casitrace_count_passport_view). */
export const countPassportView = async (db: Db, publicId: string, source: "qr" | "page") => {
  await db.$executeRaw`SELECT casitrace_count_passport_view(${publicId}, ${source})`;
};
