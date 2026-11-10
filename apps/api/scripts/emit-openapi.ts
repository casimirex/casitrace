// Writes the OpenAPI document to packages/api-client/openapi.json without touching the network.
import path from "node:path";
import type { Db } from "@casitrace/db";
import pino from "pino";
import { API_INFO, createApp } from "../src/app";
import type { ObjectStorage } from "../src/infrastructure/storage";

const unused = new Proxy(
  {},
  {
    get: () => {
      throw new Error("not available while emitting OpenAPI");
    },
  },
);
const app = createApp({
  db: unused as Db,
  storage: unused as ObjectStorage,
  logger: pino({ level: "silent" }),
  version: "0.0.0",
});
const doc = app.getOpenAPI31Document(API_INFO);
const out = path.resolve(import.meta.dirname, "../../../packages/api-client/openapi.json");
await Bun.write(out, `${JSON.stringify(doc, null, 2)}\n`);
console.log(`wrote ${out}`);
