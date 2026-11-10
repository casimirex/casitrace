// Pilot KPI report (roadmap-v2 P9). Measured from the production data, not estimated.
//
//   bun --env-file=../../.env scripts/pilot-kpis.ts --orgs <id,id,...> [--since 2026-12-01] [--out report.md]
//
// Runs as the runtime role with platform access (an operator action, audited as
// `platform.kpi_report`). Reads aggregates only; the report names organisations, never people.
// KPIs that cannot come from the data (willingness to pay) are listed for manual entry.
import { createDb } from "@casitrace/db";
import { newId } from "@casitrace/shared";
import { loadEnv } from "../src/config/env";
import { traceAcross } from "../src/modules/exchange/application/cross-trace";
import { partnerCompliance } from "../src/modules/exchange/application/suppliers";
import { writeAudit } from "../src/platform/audit";
import { withPlatformAccess } from "../src/platform/tenant";

const args = process.argv.slice(2);
const opt = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const orgIds = (opt("orgs") ?? "").split(",").filter(Boolean);
if (!orgIds.length) {
  console.error("usage: pilot-kpis.ts --orgs <id,id,...> [--since YYYY-MM-DD] [--out file.md]");
  process.exit(2);
}
const since = new Date(opt("since") ?? "1970-01-01");
const env = loadEnv();
const db = createDb({ url: env.DATABASE_URL });

const pct = (a: number, b: number) => (b ? Math.round((1000 * a) / b) / 10 : null);
const quantile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)] ?? null) : null;
};
const hours = (ms: number) => Math.round(ms / 360_000) / 10;

const data = await withPlatformAccess(db, async (tx) => {
  const orgs = await tx.organization.findMany({
    where: { id: { in: orgIds } },
    select: { id: true, name: true, createdAt: true },
  });
  const firstEvents = await tx.$queryRaw<{ org_id: string; first: Date }[]>`
    SELECT e.org_id, min(e.recorded_at) AS first FROM trace_event e
    WHERE e.org_id = ANY(${orgIds}::uuid[]) AND e.type <> 'VOID'
      AND NOT EXISTS (SELECT 1 FROM trace_event v WHERE v.voids_event_id = e.id)
    GROUP BY e.org_id`;
  const captures = await tx.$queryRaw<{ device: string; ms: number }[]>`
    SELECT data->'capture'->>'device' AS device, (data->'capture'->>'ms')::int AS ms FROM audit_log
    WHERE action = 'trace.event_recorded' AND org_id = ANY(${orgIds}::uuid[]) AND data ? 'capture' AND occurred_at >= ${since}`;
  const lots = await tx.$queryRaw<{ id: string; org_id: string }[]>`
    SELECT l.id, l.org_id FROM lot l
    WHERE l.org_id = ANY(${orgIds}::uuid[]) AND l.created_at >= ${since}
      AND NOT EXISTS (SELECT 1 FROM trace_event v WHERE v.voids_event_id = l.created_by_event_id)`;
  const drills = await tx.recallCase.findMany({
    where: { orgId: { in: orgIds }, mode: "drill", startedAt: { gte: since } },
    select: { orgId: true, startedAt: true, exportedAt: true },
  });
  const suppliers = await tx.tradingPartner.findMany({
    where: { orgId: { in: orgIds }, kind: { in: ["supplier", "both"] } },
    select: { id: true, orgId: true },
  });
  const views = await tx.$queryRaw<{ source: string; views: bigint }[]>`
    SELECT source, sum(views) AS views FROM passport_view_daily
    WHERE org_id = ANY(${orgIds}::uuid[]) AND day >= ${since}::date GROUP BY source`;
  await writeAudit(tx, { actor: { type: "system", id: null }, orgId: null, requestId: newId() }, [
    {
      action: "platform.kpi_report",
      resourceType: "report",
      resourceId: null,
      data: { orgIds, since: since.toISOString() },
    },
  ]);
  return { orgs, firstEvents, captures, lots, drills, suppliers, views };
});

// KPI 1: invite → first lot (organisation created → first recorded event).
const onboarding = data.orgs.map((o) => {
  const first = data.firstEvents.find((f) => f.org_id === o.id)?.first;
  return { org: o.name, hours: first ? hours(first.getTime() - o.createdAt.getTime()) : null };
});

// KPI 2: time to record an event on a phone (touch devices), from the form's first input to submit.
const touch = data.captures.filter((c) => c.device === "touch").map((c) => c.ms / 1000);

// KPI 3: lots whose upstream trace is complete: nothing redacted, and every origin is a harvest.
let complete = 0;
const incomplete: { orgId: string; lotId: string; reason: string }[] = [];
for (const l of data.lots) {
  const t = await traceAcross(db, { orgId: l.org_id, actorId: null }, l.id, "backward", 50);
  // A leaf has no inputs in the trace: it must be a harvest (ORIGINATE) for the trace to be complete.
  const hasInputs = new Set(t.edges.map((e) => e.childLotId));
  const leaves = t.nodes.filter((n) => !hasInputs.has(n.lotId));
  const redacted = t.nodes.some((n) => n.redacted);
  const badLeaf = leaves.find((n) => !n.redacted && n.origin?.eventType !== "ORIGINATE");
  if (!redacted && !badLeaf) complete++;
  else
    incomplete.push({
      orgId: l.org_id,
      lotId: l.id,
      reason: redacted
        ? "part of the chain not shared"
        : "starts at a delivery from a supplier without records",
    });
}

// KPI 4: required evidence present and verified (supplier requirements × suppliers).
let reqTotal = 0;
let reqMet = 0;
for (const s of data.suppliers) {
  const c = await partnerCompliance(db, s.orgId, s.id);
  reqTotal += c.requirements.length;
  reqMet += c.requirements.filter((r) => r.met).length;
}

// KPI 5: mock recall time (drill start → first export).
const drillMinutes = data.drills
  .filter((d) => d.exportedAt)
  .map((d) => ((d.exportedAt as Date).getTime() - d.startedAt.getTime()) / 60_000);

const kpis = [
  [
    "Time to onboard an org (created → first lot)",
    "< 1 day",
    onboarding.map((o) => `${o.org}: ${o.hours ?? "no lot yet"} h`).join("; "),
    onboarding.every((o) => o.hours !== null && o.hours < 24),
  ],
  [
    "Time to record a lot event on a phone",
    "< 2 min",
    touch.length
      ? `median ${quantile(touch, 0.5)} s, p90 ${quantile(touch, 0.9)} s (n=${touch.length})`
      : "no phone captures yet",
    touch.length > 0 && (quantile(touch, 0.5) ?? 999) < 120,
  ],
  [
    "% of pilot lots with complete upstream trace",
    "≥ 90 %",
    `${pct(complete, data.lots.length) ?? "–"} % (${complete}/${data.lots.length})`,
    (pct(complete, data.lots.length) ?? 0) >= 90,
  ],
  [
    "% of required evidence present and VERIFIED",
    "≥ 80 %",
    `${pct(reqMet, reqTotal) ?? "–"} % (${reqMet}/${reqTotal})`,
    (pct(reqMet, reqTotal) ?? 0) >= 80,
  ],
  [
    "Mock recall time",
    "< 15 min",
    drillMinutes.length
      ? `median ${Math.round((quantile(drillMinutes, 0.5) ?? 0) * 10) / 10} min, max ${Math.round(Math.max(...drillMinutes) * 10) / 10} min (n=${drillMinutes.length})`
      : "no drill yet",
    drillMinutes.length > 0 && Math.max(...drillMinutes) < 15,
  ],
  [
    "QR scans / passport views",
    "tracked",
    data.views.map((v) => `${v.source === "qr" ? "QR scans" : "page views"} ${v.views}`).join(", ") ||
      "none yet",
    true,
  ],
  [
    "Partners willing to pay (signed quote or LOI with a price)",
    "≥ 2",
    "MANUAL: count signed documents",
    null,
  ],
] as const;

const md = [
  `# Pilot KPI report — ${new Date().toISOString().slice(0, 10)}`,
  "",
  `Organisations: ${data.orgs.map((o) => o.name).join(", ")} · data since ${since.toISOString().slice(0, 10)}`,
  "",
  "| KPI | Target | Measured | Met |",
  "|---|---|---|---|",
  ...kpis.map(([k, t, m, ok]) => `| ${k} | ${t} | ${m} | ${ok === null ? "manual" : ok ? "yes" : "no"} |`),
  "",
  incomplete.length
    ? `Incomplete traces (first 20): ${incomplete
        .slice(0, 20)
        .map((i) => `${i.lotId} (${i.reason})`)
        .join("; ")}`
    : "",
].join("\n");
console.log(md);
const out = opt("out");
if (out) await Bun.write(out, md);
await db.$disconnect();
