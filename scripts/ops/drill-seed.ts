// Seeds a small, realistic organisation for the restore drill (P9): an account, a harvest lot, an
// evidence file scanned by the worker, and a published passport. Prints the IDs as JSON.
//   bun scripts/ops/drill-seed.ts <api base> <mailpit base> <web origin>
const [API = "http://api:3000", MAILPIT = "http://mailpit:8025", ORIGIN = "http://localhost:8080"] =
  process.argv.slice(2);
const cookies = new Map<string, string>();
const call = async (method: string, path: string, body?: unknown) => {
  const isForm = body instanceof FormData;
  const res = await fetch(`${API}${path}`, {
    method,
    redirect: "manual",
    headers: {
      origin: ORIGIN,
      "x-forwarded-for": "10.250.0.1",
      ...(body === undefined || isForm ? {} : { "content-type": "application/json" }),
      cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; "),
    },
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  });
  for (const c of res.headers.getSetCookie()) {
    const [kv] = c.split(";");
    const i = kv?.indexOf("=") ?? -1;
    if (kv && i > 0) cookies.set(kv.slice(0, i), kv.slice(i + 1));
  }
  if (res.status >= 300 && res.status !== 302)
    throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  return res;
};
const json = async <T>(r: Response) => (await r.json()) as T;

const email = `drill-${Date.now()}@drill.local`;
const password = "drill-Password-1";
await call("POST", "/api/v1/auth/sign-up/email", { email, name: "Drill Owner", password });
let url = "";
for (let i = 0; i < 60 && !url; i++) {
  const s = await json<{ messages: { ID: string }[] }>(
    await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`),
  );
  const id = s.messages[0]?.ID;
  if (id)
    url =
      /https?:\/\/\S+verify-email\S+/.exec(
        (await json<{ Text: string }>(await fetch(`${MAILPIT}/api/v1/message/${id}`))).Text,
      )?.[0] ?? "";
  if (!url) await Bun.sleep(500);
}
if (!url) throw new Error("verification email did not arrive");
const u = new URL(url);
await call("GET", `${u.pathname}${u.search}`);
if (!cookies.size) await call("POST", "/api/v1/auth/sign-in/email", { email, password });
const org = await json<{ id: string }>(
  await call("POST", "/api/v1/auth/organization/create", {
    name: "Frantoio Drill",
    slug: `drill-${Date.now()}`,
  }),
);
const base = `/api/v1/orgs/${org.id}`;
const product = await json<{ id: string }>(
  await call("POST", `${base}/products`, {
    sku: "OLV",
    name: "Coratina olives",
    category: "olives",
    uomCode: "kg",
  }),
);
const plot = await json<{ id: string }>(
  await call("POST", `${base}/locations`, { code: "P1", name: "North grove", type: "plot" }),
);
const harvest = await json<{ lines: { role: string; lot: { id: string } }[] }>(
  await call("POST", `${base}/events`, {
    type: "ORIGINATE",
    process: "harvest",
    occurredAt: new Date(Date.now() - 3_600_000).toISOString(),
    locationId: plot.id,
    kdes: { cultivars: ["Coratina"] },
    outputs: [{ productId: product.id, lotCode: "DRILL-H1", quantity: "1200" }],
  }),
);
const lotId = harvest.lines.find((l) => l.role === "output")?.lot.id ?? "";

const PDF =
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 0/Kids[]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n";
const form = new FormData();
form.append("file", new File([PDF], "lab.pdf"));
form.append("metadata", JSON.stringify({ type: "lab_report", title: "Drill lab analysis" }));
const ev = await json<{ id: string }>(await call("POST", `${base}/evidence`, form));
let scan = "";
for (let i = 0; i < 120 && scan !== "clean"; i++) {
  const e = await json<{ files: { scanStatus: string }[] }>(await call("GET", `${base}/evidence/${ev.id}`));
  scan = e.files[0]?.scanStatus ?? "";
  if (scan !== "clean") await Bun.sleep(1000);
}
if (scan !== "clean") throw new Error(`evidence scan did not finish (status ${scan})`);

const passport = await json<{ id: string; publicId: string }>(
  await call("POST", `${base}/passports`, { scope: "lot", lotId }),
);
await call("POST", `${base}/passports/${passport.id}/publish`);
console.log(JSON.stringify({ orgId: org.id, email, lotId, evidenceId: ev.id, publicId: passport.publicId }));
