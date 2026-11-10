import type { components } from "@casitrace/api-client";
import { Link } from "react-router";

type Trace = components["schemas"]["TraceResult"];

const W = 176;
const H = 52;
const GAP_X = 64;
const GAP_Y = 14;

/**
 * Layered genealogy: one column per distance from the traced lot (inputs left, outputs right),
 * suppliers before the first column and customers after the last.
 */
export function TraceGraph({ trace, orgId }: { trace: Trace; orgId: string }) {
  if (trace.nodes.length > 150) {
    return (
      <p className="text-sm text-muted">
        This chain has {trace.nodes.length} lots; the table below lists them all.
      </p>
    );
  }
  const depths = [...new Set(trace.nodes.map((n) => n.depth))].sort((a, b) => a - b);
  const hasSuppliers = trace.suppliers.length > 0;
  const hasCustomers = trace.shipments.length > 0;
  const colOf = (depth: number) => depths.indexOf(depth) + (hasSuppliers ? 1 : 0);
  const pos = new Map<string, { x: number; y: number }>();
  const byCol = new Map<number, number>();
  for (const n of trace.nodes) {
    const col = colOf(n.depth);
    const row = byCol.get(col) ?? 0;
    byCol.set(col, row + 1);
    pos.set(n.lotId, { x: col * (W + GAP_X), y: row * (H + GAP_Y) });
  }
  const supplierCol = 0;
  const customerCol = depths.length + (hasSuppliers ? 1 : 0);
  const suppliers = [...new Map(trace.suppliers.map((s) => [`${s.partnerName}|${s.lotId}`, s])).values()];
  const customers = [...new Map(trace.shipments.map((s) => [`${s.partnerName}|${s.lotId}`, s])).values()];
  const rows = Math.max(...[...byCol.values()], suppliers.length, customers.length, 1);
  const cols = depths.length + (hasSuppliers ? 1 : 0) + (hasCustomers ? 1 : 0);
  const width = cols * (W + GAP_X) - GAP_X;
  const height = rows * (H + GAP_Y) - GAP_Y;
  const curve = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    `M${a.x + W},${a.y + H / 2} C${a.x + W + GAP_X / 2},${a.y + H / 2} ${b.x - GAP_X / 2},${b.y + H / 2} ${b.x},${b.y + H / 2}`;

  return (
    <div className="overflow-x-auto rounded border border-line bg-canvas p-3">
      <svg width={width} height={height} role="img" aria-label="Lot genealogy" className="font-sans">
        {trace.edges.map((e) => {
          const a = pos.get(e.parentLotId);
          const b = pos.get(e.childLotId);
          return a && b ? (
            <path
              key={`${e.parentLotId}-${e.childLotId}-${e.eventId}`}
              d={curve(a, b)}
              fill="none"
              stroke="var(--color-line)"
              strokeWidth={2}
            />
          ) : null;
        })}
        {suppliers.map((s, i) => {
          const at = { x: supplierCol * (W + GAP_X), y: i * (H + GAP_Y) };
          const to = pos.get(s.lotId);
          return (
            <g key={`s-${s.partnerName}-${s.lotId}`}>
              {to && (
                <path
                  d={curve(at, to)}
                  fill="none"
                  stroke="var(--color-line)"
                  strokeDasharray="4 3"
                  strokeWidth={2}
                />
              )}
              <rect
                x={at.x}
                y={at.y}
                width={W}
                height={H}
                rx={4}
                fill="var(--color-surface)"
                stroke="var(--color-muted)"
                strokeDasharray="4 3"
              />
              <text x={at.x + 10} y={at.y + 21} fontSize={12} fill="var(--color-muted)">
                Supplier
              </text>
              <text x={at.x + 10} y={at.y + 39} fontSize={13} fontWeight={600} fill="var(--color-ink)">
                {(s.partnerName ?? "?").slice(0, 22)}
              </text>
            </g>
          );
        })}
        {trace.nodes.map((n) => {
          const p = pos.get(n.lotId);
          if (!p) return null;
          const root = n.depth === 0;
          return (
            <Link key={n.lotId} to={`/orgs/${orgId}/lots/${n.lotId}`}>
              <rect
                x={p.x}
                y={p.y}
                width={W}
                height={H}
                rx={4}
                fill={root ? "var(--color-brand)" : "var(--color-surface)"}
                stroke="var(--color-brand)"
              />
              <text
                x={p.x + 10}
                y={p.y + 20}
                fontSize={12}
                fontFamily="var(--font-mono)"
                fill={root ? "var(--color-canvas)" : "var(--color-ink)"}
              >
                {n.lotCode.slice(0, 22)}
              </text>
              <text
                x={p.x + 10}
                y={p.y + 38}
                fontSize={11}
                fill={root ? "var(--color-canvas)" : "var(--color-muted)"}
              >
                {n.productName.slice(0, 18)} · {n.initialQuantity} {n.uomCode}
              </text>
            </Link>
          );
        })}
        {customers.map((s, i) => {
          const at = { x: customerCol * (W + GAP_X), y: i * (H + GAP_Y) };
          const from = pos.get(s.lotId);
          return (
            <g key={`c-${s.partnerName}-${s.lotId}`}>
              {from && (
                <path
                  d={curve(from, at)}
                  fill="none"
                  stroke="var(--color-line)"
                  strokeDasharray="4 3"
                  strokeWidth={2}
                />
              )}
              <rect
                x={at.x}
                y={at.y}
                width={W}
                height={H}
                rx={4}
                fill="var(--color-surface)"
                stroke="var(--color-muted)"
                strokeDasharray="4 3"
              />
              <text x={at.x + 10} y={at.y + 21} fontSize={12} fill="var(--color-muted)">
                Shipped to
              </text>
              <text x={at.x + 10} y={at.y + 39} fontSize={13} fontWeight={600} fill="var(--color-ink)">
                {(s.partnerName ?? "?").slice(0, 22)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
