import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { newId } from "@casitrace/shared";
import {
  canonicalize,
  createSigner,
  generateKeyPkcs8,
  sha256Hex,
} from "../src/modules/publication/domain/signing";
import { createTransitSigner } from "../src/modules/publication/infrastructure/transit-signer";

/**
 * The production signer (ADR 0015) against a real OpenBao Transit engine (docker compose service `openbao`).
 * Covers: signatures verify independently, rotation keeps old signatures valid, the local-key era stays
 * verifiable after moving to the KMS, and the production AppRole policy can sign but not export or delete.
 */
const ADDR = process.env.KMS_TEST_ADDR ?? "http://localhost:8200";
const ROOT = process.env.KMS_TEST_ROOT_TOKEN ?? "dev-root-token";
const VERIFY_SCRIPT = path.resolve(import.meta.dir, "../../../scripts/verify-passport.mjs");

const bao = async (method: string, p: string, body?: unknown, token = ROOT) => {
  const res = await fetch(`${ADDR}/v1${p}`, {
    method,
    headers: { "x-vault-token": token, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: res.status,
    body: res.status === 204 ? {} : ((await res.json()) as Record<string, unknown>),
  };
};

const keyName = `passport-test-${newId()}`;
beforeAll(async () => {
  const mounts = await bao("GET", "/sys/mounts");
  if (!(mounts.body as Record<string, unknown>)["transit/"])
    await bao("POST", "/sys/mounts/transit", { type: "transit" });
  const created = await bao("POST", `/transit/keys/${keyName}`, { type: "ed25519", exportable: false });
  expect(created.status).toBeLessThan(300);
});

/** Runs the independent Node verifier on a passport-shaped document. */
const verifyIndependently = async (
  signed: { signature: string; kid: string },
  canonical: string,
  keys: unknown,
) => {
  const dir = await mkdtemp(path.join(tmpdir(), "kms-"));
  const passport = path.join(dir, "p.json");
  const keyFile = path.join(dir, "k.json");
  await writeFile(
    passport,
    JSON.stringify({
      canonical,
      snapshot: JSON.parse(canonical),
      digest: sha256Hex(canonical),
      signature: { alg: "EdDSA", kid: signed.kid, value: signed.signature },
    }),
  );
  await writeFile(keyFile, JSON.stringify({ keys }));
  const proc = Bun.spawn(["node", VERIFY_SCRIPT, passport, keyFile], { stdout: "pipe", stderr: "pipe" });
  return proc.exited;
};

describe("KMS (Transit) passport signer", () => {
  test("signs; the signature verifies in the API and with the independent Node verifier", async () => {
    const signer = await createTransitSigner({ addr: ADDR, keyName, auth: { token: ROOT } });
    const canonical = canonicalize({ product: { name: "Olio" }, version: 1 });
    const signed = await signer.sign(canonical);
    expect(signed.kid).toBe(signer.kid);
    expect(signed.kid).toMatch(/^ed25519-[0-9a-f]{16}$/);
    expect(await signer.verify(canonical, signed.signature, signed.kid)).toBe(true);
    expect(await signer.verify(`${canonical} `, signed.signature, signed.kid)).toBe(false);
    expect(await verifyIndependently(signed, canonical, signer.publicKeys)).toBe(0);
  });

  test("rotation: new signatures use the new version; signatures from before still verify", async () => {
    const signer = await createTransitSigner({ addr: ADDR, keyName, auth: { token: ROOT } });
    const before = canonicalize({ v: "before rotation" });
    const old = await signer.sign(before);

    expect((await bao("POST", `/transit/keys/${keyName}/rotate`)).status).toBeLessThan(300);
    // The running API has not refreshed yet: the KMS signs with v2 and the signer learns v2 on the spot.
    const after = canonicalize({ v: "after rotation" });
    const fresh = await signer.sign(after);
    expect(fresh.kid).not.toBe(old.kid);
    expect(signer.kid).toBe(fresh.kid);

    expect(await signer.verify(before, old.signature, old.kid)).toBe(true);
    expect(await signer.verify(after, fresh.signature, fresh.kid)).toBe(true);
    const statuses = Object.fromEntries(signer.publicKeys.map((k) => [k.kid, k.status]));
    expect(statuses).toMatchObject({ [fresh.kid]: "current", [old.kid]: "previous" });
    // A verifier that only has the published key list checks both.
    expect(await verifyIndependently(old, before, signer.publicKeys)).toBe(0);
    expect(await verifyIndependently(fresh, after, signer.publicKeys)).toBe(0);
  });

  test("moving from a local key to the KMS keeps local-era passports verifiable", async () => {
    const local = await createSigner(await generateKeyPkcs8());
    const canonical = canonicalize({ era: "local key" });
    const signed = await local.sign(canonical);
    const kms = await createTransitSigner({
      addr: ADDR,
      keyName,
      auth: { token: ROOT },
      previous: [{ kid: local.kid, x: local.publicKeys[0]?.x ?? "" }],
    });
    expect(kms.kid).not.toBe(local.kid);
    expect(await kms.verify(canonical, signed.signature, signed.kid)).toBe(true);
    expect(kms.publicKeys.find((k) => k.kid === local.kid)?.status).toBe("previous");
  });

  test("production AppRole: can sign and read public keys, cannot export, delete, rotate or reconfigure", async () => {
    const auths = await bao("GET", "/sys/auth");
    if (!(auths.body as Record<string, unknown>)["approle/"])
      await bao("POST", "/sys/auth/approle", { type: "approle" });
    const policy = await Bun.file(
      path.resolve(import.meta.dir, "../../../infrastructure/production/kms/api-signer-policy.hcl"),
    ).text();
    const policyName = `api-signer-${keyName}`;
    await bao("PUT", `/sys/policies/acl/${policyName}`, {
      policy: policy.replaceAll("passport-signing", keyName),
    });
    await bao("POST", `/auth/approle/role/${policyName}`, { token_policies: [policyName], token_ttl: "1h" });
    const roleId = (
      (await bao("GET", `/auth/approle/role/${policyName}/role-id`)).body.data as { role_id: string }
    ).role_id;
    const secretId = (
      (await bao("POST", `/auth/approle/role/${policyName}/secret-id`)).body.data as { secret_id: string }
    ).secret_id;

    const signer = await createTransitSigner({ addr: ADDR, keyName, auth: { roleId, secretId } });
    const canonical = canonicalize({ via: "approle" });
    const signed = await signer.sign(canonical);
    expect(await signer.verify(canonical, signed.signature, signed.kid)).toBe(true);

    const login = await bao("POST", "/auth/approle/login", { role_id: roleId, secret_id: secretId });
    const token = (login.body.auth as { client_token: string }).client_token;
    for (const [method, p, body] of [
      ["GET", `/transit/export/signing-key/${keyName}`, undefined],
      ["POST", `/transit/keys/${keyName}/rotate`, {}],
      ["POST", `/transit/keys/${keyName}/config`, { deletion_allowed: true, exportable: true }],
      ["DELETE", `/transit/keys/${keyName}`, undefined],
      ["POST", "/transit/keys/another-key", { type: "ed25519" }],
    ] as const) {
      expect({ p, status: (await bao(method, p, body, token)).status }).toEqual({ p, status: 403 });
    }
  });

  test("an unreachable KMS fails loudly at start-up instead of signing with something else", async () => {
    await expect(
      createTransitSigner({ addr: "http://127.0.0.1:1", keyName, auth: { token: ROOT } }),
    ).rejects.toThrow();
  });
});
