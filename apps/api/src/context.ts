import type { Db } from "@casitrace/db";
import type { Logger } from "./infrastructure/logger";
import type { ObjectStorage } from "./infrastructure/storage";

/** Process-wide dependencies, created once in main.ts (or in tests) and injected into the app. */
export interface Deps {
  db: Db;
  storage: ObjectStorage;
  logger: Logger;
  version: string;
}

/** Hono environment: per-request variables set by middleware. */
export interface AppEnv {
  Variables: {
    requestId: string;
    logger: Logger;
  };
}
