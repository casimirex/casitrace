import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";

export type { AuditLog, OutboxEvent } from "./generated/prisma/client";
export { Prisma, PrismaClient } from "./generated/prisma/client";

export type Db = PrismaClient;
/** A Prisma interactive-transaction client. Repositories accept this so they compose inside one transaction. */
export type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

export interface DbOptions {
  url: string;
  /** Max pool size; defaults to the pg default (10). */
  max?: number;
}

export const createDb = ({ url, max }: DbOptions): Db =>
  new PrismaClient({ adapter: new PrismaPg({ connectionString: url, ...(max ? { max } : {}) }) });
