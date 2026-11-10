// Load test against the roadmap §3 NFRs, over HTTP against a running deployment (P9).
//
//   bun scripts/load-test.ts <api base> [--mailpit <url>] [--origin <web origin>]
//
// Staging (from inside the Docker network, so each simulated visitor has its own client address):
//   infrastructure/production/load-test.sh
//
// 1. Signs up (email verified via Mailpit), creates an organisation and seeds 10 levels × 500 lots
//    through the real write path (POST /events: validation, balances, mass balance, audit, outbox).
//    Each lot above level 0 consumes 25 kg from 4 lots of the level below with strides that grow per
//    level, so one trace reaches thousands of lots.
// 2. Trace NFR: backward and forward traces of sampled lots, p95 < 2 s.
// 3. Public page NFR: TTFB of /p/{publicId} under concurrent load, p95 < 500 ms, distinct visitors.
// Prints a JSON report (also written to load-test-report.json in the current directory).

const args = process.argv.slice(2);
const API = (args[0] ?? "http://localhost:3000").replace(/\/$/, "");
const opt = (name: string, def: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? def) : def;
};
const MAILPIT = opt("mailpit", "http://localhost:8025");
const ORIGIN = opt("origin", "http://localhost:8080");
const LEVELS = Number(opt("levels", "10"));
const PER_LEVEL = Number(opt("per-level", "500"));
const PAGE_REQUESTS = Number(opt("page-requests", "2000"));
const PAGE_CONCURRENCY = Number(opt("page-concurrency", "20"));
const TRACE_SAMPLES = Number(opt("trace-samples", "40"));
/** Re-measure only the public page of an existing passport (no seeding). */
const PAGE_ONLY = opt("page-only", "");

const cookies = new Map<string, string>();
const userIp = `10.200.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
const call = async (method: string, path: string, body?: unknown) => {
  const res = await fetch(`${API}${path}`, {
    method,
    redirect: "manual",
    headers: {
      origin: ORIGIN,
      "x-forwarded-for": userIp,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; "),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  for (const c of res.headers.getSetCookie()) {
    const [kv] = c.split(";");
    const i = kv?.indexOf("=") ?? -1;
    if (kv && i > 0) cookies.set(kv.slice(0, i), kv.slice(i + 1));
  }
  return res;
};
const ok = async <T>(res: Response, what: string): Promise<T> => {
  if (res.status >= 300) throw new Error(`${what}: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
};
const pool = async <T>(items: T[], n: number, fn: (t: T, i: number) => Promise<void>) => {
  let next = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (next < items.length) {
        const i = next++;
        await fn(items[i] as T, i);
      }
    }),
  );
};
const p = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)] ?? 0;
};
const stats = (xs: number[]) => ({
  n: xs.length,
  p50: Math.round(p(xs, 0.5)),
  p95: Math.round(p(xs, 0.95)),
  p99: Math.round(p(xs, 0.99)),
  max: Math.round(Math.max(...xs)),
});

type SeedResult = Awaited<ReturnType<typeof seedAndTrace>>;
async function seedAndTrace() {
  // ── 1. account, organisation, seed ────────────────────────────────────────────────────────────
  const email = `load-${Date.now()}@loadtest.local`;
  await ok(
    await call("POST", "/api/v1/auth/sign-up/email", {
      email,
      name: "Load Test",
      password: "load-test-Password-1",
    }),
    "sign-up",
  );
  let verifyUrl = "";
  for (let i = 0; i < 60 && !verifyUrl; i++) {
    const s = (await (
      await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)
    ).json()) as {
      messages: { ID: string }[];
    };
    const id = s.messages[0]?.ID;
    if (id) {
      const m = (await (await fetch(`${MAILPIT}/api/v1/message/${id}`)).json()) as { Text: string };
      verifyUrl = /https?:\/\/\S+verify-email\S+/.exec(m.Text)?.[0] ?? "";
    }
    if (!verifyUrl) await Bun.sleep(500);
  }
  if (!verifyUrl) throw new Error("verification email did not arrive");
  const vu = new URL(verifyUrl);
  await call("GET", `${vu.pathname}${vu.search}`);
  if (!cookies.size)
    await ok(
      await call("POST", "/api/v1/auth/sign-in/email", { email, password: "load-test-Password-1" }),
      "sign-in",
    );
  const org = await ok<{ id: string }>(
    await call("POST", "/api/v1/auth/organization/create", {
      name: "Load Test Mill",
      slug: `load-${Date.now()}`,
    }),
    "org",
  );
  const base = `/api/v1/orgs/${org.id}`;
  const product = await ok<{ id: string }>(
    await call("POST", `${base}/products`, {
      sku: "LT-OLV",
      name: "Load test olives",
      category: "olives",
      uomCode: "kg",
    }),
    "product",
  );

  const plot = await ok<{ id: string }>(
    await call("POST", `${base}/locations`, { code: "LT-PLOT", name: "Load test grove", type: "plot" }),
    "location",
  );

  type EventOut = { lines: { role: string; lot: { id: string } }[] };
  const levels: string[][] = [];
  const writeMs: number[] = [];
  const seedStart = performance.now();
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
  for (let level = 0; level < LEVELS; level++) {
    const ids: string[] = new Array(PER_LEVEL);
    const stride = level === 0 ? 0 : 7 ** level % PER_LEVEL || 1;
    await pool(
      Array.from({ length: PER_LEVEL }, (_, i) => i),
      8,
      async (i) => {
        const body =
          level === 0
            ? {
                type: "ORIGINATE",
                process: "harvest",
                occurredAt: hoursAgo(LEVELS + 1),
                locationId: plot.id,
                kdes: { cultivars: ["Coratina"] },
                outputs: [{ productId: product.id, lotCode: `LT${level}-${i}`, quantity: "100" }],
              }
            : {
                type: "TRANSFORM",
                process: "other",
                occurredAt: hoursAgo(LEVELS - level),
                kdes: { description: "load test" },
                // Each parent j·stride away: every lot of the level below is consumed exactly 4 × 25 kg.
                inputs: [0, 1, 2, 3].map((j) => ({
                  lotId: levels[level - 1]?.[(i + j * stride) % PER_LEVEL],
                  quantity: "25",
                })),
                outputs: [{ productId: product.id, lotCode: `LT${level}-${i}`, quantity: "100" }],
              };
        const t = performance.now();
        const e = await ok<EventOut>(await call("POST", `${base}/events`, body), `event L${level}-${i}`);
        writeMs.push(performance.now() - t);
        ids[i] = e.lines.find((l) => l.role === "output")?.lot.id ?? "";
      },
    );
    levels.push(ids);
    console.error(`seeded level ${level + 1}/${LEVELS}`);
  }
  const seedSeconds = (performance.now() - seedStart) / 1000;

  // ── 2. trace NFR ──────────────────────────────────────────────────────────────────────────────
  const top = levels[LEVELS - 1] ?? [];
  const bottom = levels[0] ?? [];
  const traceRun = async (direction: "backward" | "forward", lots: string[]) => {
    const ms: number[] = [];
    let maxNodes = 0;
    await pool(lots, 4, async (lotId) => {
      const t = performance.now();
      const r = await ok<{ nodes?: unknown[]; lots?: unknown[] }>(
        await call("GET", `${base}/lots/${lotId}/trace?direction=${direction}&depth=20`),
        "trace",
      );
      ms.push(performance.now() - t);
      maxNodes = Math.max(maxNodes, (r.nodes ?? r.lots ?? []).length);
    });
    return { ...stats(ms), maxLotsReached: maxNodes };
  };
  const sample = (xs: string[], n: number) =>
    Array.from({ length: n }, (_, i) => xs[(i * 37) % xs.length] as string);
  const backward = await traceRun("backward", sample(top, TRACE_SAMPLES));
  const forward = await traceRun("forward", sample(bottom, TRACE_SAMPLES));

  // ── the passport measured in step 3  ────────────────────────────────────────────────────────────────────────
  const passport = await ok<{ id: string; publicId: string }>(
    await call("POST", `${base}/passports`, { scope: "lot", lotId: top[0] }),
    "passport",
  );
  await ok(await call("POST", `${base}/passports/${passport.id}/publish`), "publish");
  return {
    publicId: passport.publicId,
    seed: {
      lots: LEVELS * PER_LEVEL,
      levels: LEVELS,
      seconds: Math.round(seedSeconds),
      eventWriteMs: stats(writeMs),
    },
    trace: { backward, forward, nfr: "p95 < 2000 ms", pass: backward.p95 < 2000 && forward.p95 < 2000 },
  };
}
const seeded: SeedResult | null = PAGE_ONLY ? null : await seedAndTrace();
const publicId = PAGE_ONLY || seeded?.publicId || "";
const ttfb: number[] = [];
const statuses: Record<string, number> = {};
const pageStart = performance.now();
await pool(
  Array.from({ length: PAGE_REQUESTS }, (_, i) => i),
  PAGE_CONCURRENCY,
  async (i) => {
    const t = performance.now();
    const res = await fetch(`${API}/api/v1/public/p/${publicId}`, {
      headers: {
        "x-forwarded-for": `10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`,
        "accept-language": "it",
      },
    });
    ttfb.push(performance.now() - t); // fetch resolves when the headers arrive
    statuses[res.status] = (statuses[res.status] ?? 0) + 1;
    await res.arrayBuffer();
  },
);
const pageSeconds = (performance.now() - pageStart) / 1000;

const report = {
  target: API,
  at: new Date().toISOString(),
  seed: seeded?.seed ?? null,
  trace: seeded?.trace ?? null,
  publicPage: {
    requests: PAGE_REQUESTS,
    concurrency: PAGE_CONCURRENCY,
    requestsPerSecond: Math.round(PAGE_REQUESTS / pageSeconds),
    statuses,
    ttfbMs: stats(ttfb),
    nfr: "TTFB p95 < 500 ms",
    pass: p(ttfb, 0.95) < 500 && Object.keys(statuses).every((s) => s === "200"),
  },
};
console.log(JSON.stringify(report, null, 2));
await Bun.write("load-test-report.json", `${JSON.stringify(report, null, 2)}\n`);
process.exit((report.trace?.pass ?? true) && report.publicPage.pass ? 0 : 1);
