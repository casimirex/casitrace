import { describe, expect, test } from "bun:test";
import { loadEnv } from "../src/config/env";

describe("configuration", () => {
  test("rejects invalid configuration with a readable message", () => {
    expect(() => loadEnv({ DATABASE_URL: "not-a-url" })).toThrow(/DATABASE_URL/);
  });
});
