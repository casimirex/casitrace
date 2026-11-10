import type { Db, Tx } from "@casitrace/db";

/**
 * Public identity of other organisations: name and whether Casitrace verified the business.
 * Reads only these two facts (the profile itself stays private to its organisation).
 */
export const orgIdentities = async (db: Db | Tx, ids: string[]) => {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Map<string, { id: string; name: string; verified: boolean }>();
  const rows = await db.$queryRaw<{ id: string; name: string; verified: boolean }[]>`
    SELECT o.id, o.name, COALESCE(p.verification_status = 'verified', false) AS verified
    FROM organization o
    LEFT JOIN LATERAL (
      SELECT verification_status FROM organization_profile_public WHERE org_id = o.id
    ) p ON true
    WHERE o.id = ANY(${unique}::uuid[])`;
  return new Map(rows.map((r) => [r.id, r]));
};
