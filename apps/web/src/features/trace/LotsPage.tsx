import { LOT_STATUSES } from "@casitrace/contracts";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { Card } from "../../components/ui";
import { api, unwrap } from "../../lib/api";
import { useCan, useOrgContext } from "../masterdata/common";

export const LOT_STATUS_STYLE: Record<string, string> = {
  active: "border-brand text-brand",
  consumed: "border-line text-muted",
  shipped: "border-line text-muted",
  on_hold: "border-warn text-warn",
  recalled: "border-fail bg-fail text-canvas",
  voided: "border-line text-muted line-through",
};
export const LotStatus = ({ status }: { status: string }) => (
  <span className={`rounded-full border px-2 py-0.5 text-xs ${LOT_STATUS_STYLE[status] ?? ""}`}>
    {status.replace("_", " ")}
  </span>
);

export function LotsPage() {
  const org = useOrgContext();
  const can = useCan();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const list = useQuery({
    queryKey: ["org", org.id, "lots", "list", q, status],
    queryFn: async () =>
      unwrap(
        await api.GET("/v1/orgs/{orgId}/lots", {
          params: {
            path: { orgId: org.id },
            query: { limit: 200, ...(q ? { q } : {}), ...(status ? { status: status as "active" } : {}) },
          },
        }),
      ).items,
  });
  return (
    <Card
      title="Lots"
      actions={
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <input
            type="search"
            aria-label="Search lot code"
            placeholder="Lot code"
            className="w-40 rounded border border-line bg-surface px-2 py-1"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <select
            aria-label="Filter lots by status"
            className="rounded border border-line bg-surface px-2 py-1"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">All but voided</option>
            {LOT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace("_", " ")}
              </option>
            ))}
          </select>
          {can("event:record") && (
            <Link to="../record/harvest" className="rounded bg-brand px-3 py-1.5 font-medium text-canvas">
              Record event
            </Link>
          )}
        </div>
      }
    >
      {list.data?.length === 0 && (
        <p className="text-muted">No lots yet. Record a harvest or a receipt to create the first one.</p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm" aria-label="Lots">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted">
              <th className="py-2 pr-3 font-medium">Lot</th>
              <th className="py-2 pr-3 font-medium">Product</th>
              <th className="py-2 pr-3 text-right font-medium">Quantity</th>
              <th className="py-2 pr-3 font-medium">Where</th>
              <th className="py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {list.data?.map((l) => (
              <tr key={l.id}>
                <td className="py-2 pr-3 font-mono text-xs">
                  <Link to={l.id} className="text-brand hover:underline">
                    {l.lotCode}
                  </Link>
                </td>
                <td className="py-2 pr-3">
                  {l.product.name} <span className="text-muted">v{l.product.version}</span>
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {l.quantity} {l.uomCode}
                </td>
                <td className="py-2 pr-3 text-muted">{l.location?.code ?? "—"}</td>
                <td className="py-2">
                  <LotStatus status={l.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
