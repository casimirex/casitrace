// Writes the OpenAPI document to packages/api-client/openapi.json without touching the network.
import path from "node:path";
import type { Db } from "@casitrace/db";
import type { ObjectStorage } from "@casitrace/shared";
import pino from "pino";
import { API_INFO, createApp } from "../src/app";
import type { Deps } from "../src/context";

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
  auth: unused as Deps["auth"],
  logger: pino({ level: "silent" }),
  version: "0.0.0",
  webOrigin: "http://localhost:5173",
  publication: unused as Deps["publication"],
});
const res = await app.request("/api/openapi.json");
const doc = await res.json();
const out = path.resolve(import.meta.dirname, "../../../packages/api-client/openapi.json");
await Bun.write(out, `${JSON.stringify(doc, null, 2)}\n`);
console.log(`wrote ${out} (${API_INFO.info.title})`);
