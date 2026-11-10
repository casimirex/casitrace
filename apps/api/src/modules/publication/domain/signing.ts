/**
 * Passport signing (ADR 0013): Ed25519 over canonical JSON. Anyone can verify a published passport
 * with the public key from /api/public/keys; no Casitrace code is needed (scripts/verify-passport.mjs).
 */
export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

/** Canonical JSON: object keys sorted by code point, no whitespace, standard JSON escaping and numbers. */
export const canonicalize = (v: Json): string => {
  if (v === null || typeof v === "boolean" || typeof v === "string") return JSON.stringify(v);
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error("non-finite number");
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) return `[${v.map(canonicalize).join(",")}]`;
  return `{${Object.keys(v)
    .filter((k) => v[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalize(v[k] as Json)}`)
    .join(",")}}`;
};

const b64url = (b: Uint8Array) => Buffer.from(b).toString("base64url");
export const sha256Hex = (s: string) => new Bun.CryptoHasher("sha256").update(s).digest("hex");

export interface PublicKeyInfo {
  kid: string;
  kty: "OKP";
  crv: "Ed25519";
  alg: "EdDSA";
  /** Raw public key, base64url (JWK "x"). */
  x: string;
  status: "current" | "previous";
}

export interface Signer {
  kid: string;
  sign(canonical: string): Promise<string>;
  publicKeys: PublicKeyInfo[];
  verify(canonical: string, signature: string, kid: string): Promise<boolean>;
}

export const keyIdFor = (rawPublic: Uint8Array) =>
  `ed25519-${new Bun.CryptoHasher("sha256").update(rawPublic).digest("hex").slice(0, 16)}`;

/**
 * Loads the signing key (PKCS#8, base64url) and optional previous public keys, so passports signed
 * before a key rotation still verify.
 */
export const createSigner = async (
  pkcs8B64url: string,
  previous: { kid: string; x: string }[] = [],
): Promise<Signer> => {
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    Buffer.from(pkcs8B64url, "base64url"),
    { name: "Ed25519" },
    true,
    ["sign"],
  );
  // Derive the public key from the private JWK (d → x).
  const jwk = (await crypto.subtle.exportKey("jwk", privateKey)) as { x?: string };
  const x = jwk.x as string;
  const raw = Buffer.from(x, "base64url");
  const kid = keyIdFor(raw);
  const keys = new Map<string, CryptoKey>([
    [kid, await crypto.subtle.importKey("raw", raw, { name: "Ed25519" }, true, ["verify"])],
  ]);
  for (const p of previous) {
    keys.set(
      p.kid,
      await crypto.subtle.importKey("raw", Buffer.from(p.x, "base64url"), { name: "Ed25519" }, true, [
        "verify",
      ]),
    );
  }
  return {
    kid,
    publicKeys: [
      { kid, kty: "OKP", crv: "Ed25519", alg: "EdDSA", x, status: "current" },
      ...previous.map((p) => ({
        kid: p.kid,
        kty: "OKP" as const,
        crv: "Ed25519" as const,
        alg: "EdDSA" as const,
        x: p.x,
        status: "previous" as const,
      })),
    ],
    sign: async (canonical) =>
      b64url(
        new Uint8Array(await crypto.subtle.sign("Ed25519", privateKey, new TextEncoder().encode(canonical))),
      ),
    verify: async (canonical, signature, k) => {
      const key = keys.get(k);
      if (!key) return false;
      return crypto.subtle.verify(
        "Ed25519",
        key,
        Buffer.from(signature, "base64url"),
        new TextEncoder().encode(canonical),
      );
    },
  };
};

/** Generates a new key (for `bun run keys:generate`). */
export const generateKeyPkcs8 = async () => {
  const k = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as unknown as CryptoKeyPair;
  return b64url(new Uint8Array(await crypto.subtle.exportKey("pkcs8", k.privateKey)));
};
