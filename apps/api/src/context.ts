import type { Db } from "@casitrace/db";
import type { Logger } from "./infrastructure/logger";
import type { ObjectStorage } from "./infrastructure/storage";
import type { Auth } from "./modules/identity/auth";

/** Process-wide dependencies, created once in main.ts (or in tests) and injected into the app. */
export interface Deps {
  db: Db;
  storage: ObjectStorage;
  logger: Logger;
  auth: Auth;
  version: string;
  /** Public origin of the web app (CSRF origin check). */
  webOrigin: string;
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
