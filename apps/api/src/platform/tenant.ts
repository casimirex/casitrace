import type { Db, Tx } from "@casitrace/db";

/**
 * Runs fn in a transaction whose row-level-security scope is one organisation (ADR 0008).
 * Every read or write of tenant-owned data goes through this (or runCommand, which calls it).
 */
export const withTenant = <T>(db: Db, orgId: string, fn: (tx: Tx) => Promise<T>): Promise<T> =>
  db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.org_id', ${orgId}, true)`;
    return fn(tx);
  });

/** Platform-staff reads across organisations. Callers must have checked platform permissions and audit the access. */
export const withPlatformAccess = <T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> =>
  db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.platform_access', 'on', true)`;
    return fn(tx);
  });
