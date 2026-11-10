import {
  importVerifyKey,
  keyIdFor,
  type PublicKeyInfo,
  publicKeyInfo,
  type Signer,
  verifyWith,
} from "../domain/signing";

/**
 * Passport signer backed by the Transit engine of OpenBao / HashiCorp Vault (ADR 0015).
 * The private key never leaves the KMS (created non-exportable); the API only asks it to sign.
 * Public keys of every key version are cached locally, so verification needs no KMS call and
 * passports signed with older versions keep verifying after `rotate`.
 */
export interface TransitConfig {
  /** e.g. https://kms.internal:8200 */
  addr: string;
  /** Transit mount path, default "transit". */
  mount?: string;
  keyName: string;
  /** Either a token (development) or AppRole credentials (production). */
  auth: { token: string } | { roleId: string; secretId: string };
  /** Keys used before moving to the KMS (local-key era), still published for verification. */
  previous?: { kid: string; x: string }[];
  /** How often to re-read the key versions (picks up a rotation). Default 5 minutes. */
  refreshMs?: number;
  fetch?: typeof fetch;
}

interface KeyVersion {
  version: number;
  kid: string;
  x: string;
  key: CryptoKey;
}

export class TransitError extends Error {}

export const createTransitSigner = async (
  cfg: TransitConfig,
): Promise<Signer & { refresh(): Promise<void> }> => {
  const f = cfg.fetch ?? fetch;
  const base = `${cfg.addr.replace(/\/$/, "")}/v1`;
  const mount = cfg.mount ?? "transit";
  let token = "token" in cfg.auth ? cfg.auth.token : "";

  const login = async () => {
    if ("token" in cfg.auth) return;
    const res = await f(`${base}/auth/approle/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role_id: cfg.auth.roleId, secret_id: cfg.auth.secretId }),
    });
    if (!res.ok) throw new TransitError(`KMS login failed (${res.status})`);
    const body = (await res.json()) as { auth?: { client_token?: string } };
    token = body.auth?.client_token ?? "";
    if (!token) throw new TransitError("KMS login returned no token");
  };

  /** Calls the KMS; logs in again once when the token has expired. */
  const call = async (path: string, init: RequestInit = {}, retried = false): Promise<unknown> => {
    if (!token) await login();
    const res = await f(`${base}${path}`, {
      ...init,
      headers: { "content-type": "application/json", "x-vault-token": token, ...init.headers },
      signal: AbortSignal.timeout(5_000),
    });
    if (res.status === 403 && !retried && !("token" in cfg.auth)) {
      token = "";
      return call(path, init, true);
    }
    if (!res.ok) throw new TransitError(`KMS ${init.method ?? "GET"} ${path} failed (${res.status})`);
    return res.json();
  };

  let versions: KeyVersion[] = [];
  let latest = 0;
  let lastRefresh = 0;
  const previous = new Map<string, { x: string; key: CryptoKey }>();
  for (const p of cfg.previous ?? [])
    previous.set(p.kid, { x: p.x, key: await importVerifyKey(Buffer.from(p.x, "base64url")) });

  const refresh = async () => {
    const body = (await call(`/${mount}/keys/${encodeURIComponent(cfg.keyName)}`)) as {
      data: { type: string; latest_version: number; keys: Record<string, { public_key: string }> };
    };
    if (body.data.type !== "ed25519") throw new TransitError(`KMS key ${cfg.keyName} is not ed25519`);
    const next: KeyVersion[] = [];
    for (const [v, k] of Object.entries(body.data.keys)) {
      const raw = Buffer.from(k.public_key, "base64");
      next.push({
        version: Number(v),
        kid: keyIdFor(raw),
        x: raw.toString("base64url"),
        key: await importVerifyKey(raw),
      });
    }
    versions = next.sort((a, b) => b.version - a.version);
    latest = body.data.latest_version;
    lastRefresh = Date.now();
  };
  await refresh();
  const timer = setInterval(() => void refresh().catch(() => undefined), cfg.refreshMs ?? 300_000);
  timer.unref?.();

  const byVersion = async (v: number) => {
    let kv = versions.find((x) => x.version === v);
    if (!kv) {
      await refresh();
      kv = versions.find((x) => x.version === v);
    }
    if (!kv) throw new TransitError(`KMS signed with unknown key version ${v}`);
    return kv;
  };

  const current = () => {
    const kv = versions.find((x) => x.version === latest);
    if (!kv) throw new TransitError("KMS key has no current version");
    return kv;
  };

  return {
    get kid() {
      return current().kid;
    },
    get publicKeys(): PublicKeyInfo[] {
      return [
        ...versions.map((v) => publicKeyInfo(v.kid, v.x, v.version === latest ? "current" : "previous")),
        ...[...previous].map(([kid, p]) => publicKeyInfo(kid, p.x, "previous")),
      ];
    },
    refresh,
    sign: async (canonical) => {
      const body = (await call(`/${mount}/sign/${encodeURIComponent(cfg.keyName)}`, {
        method: "POST",
        body: JSON.stringify({ input: Buffer.from(canonical, "utf8").toString("base64") }),
      })) as { data: { signature: string; key_version: number } };
      const m = /^vault:v(\d+):(.+)$/.exec(body.data.signature);
      if (!m?.[1] || !m[2]) throw new TransitError("KMS returned an unexpected signature format");
      const kv = await byVersion(Number(m[1]));
      const signature = Buffer.from(m[2], "base64").toString("base64url");
      // Never publish a signature that does not verify with the key we will advertise.
      if (!(await verifyWith(kv.key, canonical, signature)))
        throw new TransitError("KMS signature does not verify with its public key");
      return { signature, kid: kv.kid };
    },
    verify: async (canonical, signature, kid) => {
      let key = versions.find((v) => v.kid === kid)?.key ?? previous.get(kid)?.key;
      // Unknown key: re-read the KMS at most every 30 s (a rotation may have happened elsewhere).
      if (!key && Date.now() - lastRefresh > 30_000) {
        await refresh().catch(() => undefined);
        key = versions.find((v) => v.kid === kid)?.key;
      }
      return key ? verifyWith(key, canonical, signature) : false;
    },
  };
};
