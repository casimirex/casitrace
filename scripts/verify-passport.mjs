#!/usr/bin/env node
// Independent verification of a Casitrace public passport. Uses only Node.js built-ins and the
// published public keys: no Casitrace code, no account.
//
//   node scripts/verify-passport.mjs <passport JSON URL or file> <keys JSON URL or file>
//   e.g. node scripts/verify-passport.mjs https://example.org/api/public/passports/abc123 https://example.org/api/public/keys
//
// Exit code 0 = valid, 1 = invalid, 2 = usage or fetch error.
import { createHash, createPublicKey, verify } from "node:crypto";
import { readFile } from "node:fs/promises";

const load = async (src) =>
  JSON.parse(/^https?:\/\//.test(src) ? await (await fetch(src)).text() : await readFile(src, "utf8"));

// Canonical JSON as documented: keys sorted by code point, no whitespace, standard JSON escapes.
const canonical = (v) => {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  return `{${Object.keys(v)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
    .join(",")}}`;
};

const [, , passportSrc, keysSrc] = process.argv;
if (!passportSrc || !keysSrc) {
  console.error("usage: verify-passport.mjs <passport JSON URL|file> <keys JSON URL|file>");
  process.exit(2);
}
try {
  const p = await load(passportSrc);
  const { keys } = await load(keysSrc);
  const key = keys.find((k) => k.kid === p.signature.kid);
  const checks = {
    canonicalForm: canonical(JSON.parse(p.canonical)) === p.canonical,
    snapshotMatches: canonical(p.snapshot) === p.canonical,
    digest: createHash("sha256").update(p.canonical, "utf8").digest("hex") === p.digest,
    keyKnown: !!key,
    signature:
      !!key &&
      verify(
        null,
        Buffer.from(p.canonical, "utf8"),
        createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: key.x }, format: "jwk" }),
        Buffer.from(p.signature.value, "base64url"),
      ),
  };
  const valid = Object.values(checks).every(Boolean);
  console.log(JSON.stringify({ valid, kid: p.signature.kid, version: p.snapshot?.version, checks }, null, 2));
  process.exit(valid ? 0 : 1);
} catch (e) {
  console.error(`error: ${e.message}`);
  process.exit(2);
}
