import type { Db } from "@casitrace/db";
import type { ObjectStorage } from "@casitrace/shared";
import type { Logger } from "./infrastructure/logger";
import type { Auth } from "./modules/identity/auth";
import type { PublicationConfig } from "./modules/publication/application/passports";

/** Process-wide dependencies, created once in main.ts (or in tests) and injected into the app. */
export interface Deps {
  db: Db;
  storage: ObjectStorage;
  logger: Logger;
  auth: Auth;
  version: string;
  /** Public origin of the web app (CSRF origin check). */
  webOrigin: string;
  /** Passport signing and public URLs (P7). */
  publication: PublicationConfig;
}

export type AuthSession = NonNullable<Awaited<ReturnType<Auth["api"]["getSession"]>>>;

export interface Membership {
  organizationId: string;
  role: string;
}

/** Hono environment: per-request variables set by middleware. */
export interface AppEnv {
  Variables: {
    requestId: string;
    logger: Logger;
    /** Loaded lazily by access guards; undefined until then, null when signed out. */
    session: AuthSession | null | undefined;
    /** Set by the org guard on /orgs/{orgId} routes. */
    membership: Membership;
  };
}
