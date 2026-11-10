import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { Alert, Button, Card } from "../../components/ui";
import { api, unwrap } from "../../lib/api";
import { useCan, useOrgContext } from "../masterdata/common";

const when = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const STATUS: Record<string, string> = {
  pending: "border-warn text-warn",
  accepted: "border-ok text-ok",
  disputed: "border-fail text-fail",
  cancelled: "border-line text-muted",
};

const useHandoffs = (orgId: string) =>
  useQuery({
    queryKey: ["org", orgId, "handoffs"],
    queryFn: async () =>
      unwrap(await api.GET("/v1/orgs/{orgId}/handoffs", { params: { path: { orgId }, query: {} } })).items,
  });
type Handoff = NonNullable<ReturnType<typeof useHandoffs>["data"]>[number];

function Incoming({ h, orgId }: { h: Handoff; orgId: string }) {
  const can = useCan();
  const queryClient = useQueryClient();
  const products = useQuery({
    queryKey: ["org", orgId, "products", ""],
    queryFn: async () =>
      unwrap(await api.GET("/v1/orgs/{orgId}/products", { params: { path: { orgId }, query: {} } })).items,
  });
  // Suggest the product with the same GTIN, else the first of the same category.
  const suggest = (l: Handoff["lines"][number]) =>
    products.data?.find((p) => l.gtin && p.gtin === l.gtin)?.id ??
    products.data?.find((p) => p.category === l.category)?.id ??
    "";
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["org", orgId] });
  const accept = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST("/v1/orgs/{orgId}/handoffs/{handoffId}/accept", {
          params: { path: { orgId, handoffId: h.id } },
          body: {
            lines: h.lines.map((l) => ({
              senderLotId: l.senderLotId,
              productId: mapping[l.senderLotId] ?? suggest(l),
            })),
          },
        }),
      ),
    onSuccess: refresh,
  });
  const dispute = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST("/v1/orgs/{orgId}/handoffs/{handoffId}/dispute", {
          params: { path: { orgId, handoffId: h.id } },
          body: { reason },
        }),
      ),
    onSuccess: refresh,
  });
  const open = h.status === "pending" || h.status === "disputed";
  return (
    <li className="grid gap-2 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <strong>
          From {h.counterparty.name}{" "}
          {h.counterparty.verified && <span className="text-xs text-ok">(verified business)</span>}
        </strong>
        <span className={`rounded-full border px-2 py-0.5 text-xs ${STATUS[h.status]}`}>{h.status}</span>
      </div>
      <p className="text-sm text-muted">
        Shipped {when.format(new Date(h.shippedAt))}
        {h.shipmentRef ? ` · ref ${h.shipmentRef}` : ""}
        {h.sharedHistory ? " · history shared with you" : " · history not shared"}
      </p>
      {h.disputeReason && <p className="text-sm text-fail">Disputed: {h.disputeReason}</p>}
      <table className="w-full text-sm" aria-label={`Lines from ${h.counterparty.name}`}>
        <tbody className="divide-y divide-line">
          {h.lines.map((l) => {
            const received = h.receivedLots.find((r) => r.senderLotId === l.senderLotId);
            return (
              <tr key={l.senderLotId}>
                <td className="py-1.5 pr-3 font-mono text-xs">{l.lotCode}</td>
                <td className="py-1.5 pr-3">{l.productName}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">
                  {l.quantity} {l.uomCode}
                </td>
                <td className="py-1.5">
                  {received ? (
                    <Link to={`/orgs/${orgId}/lots/${received.lotId}`} className="text-brand hover:underline">
                      Booked in as {received.lotCode}
                    </Link>
                  ) : (
                    open &&
                    can("handoff:accept") && (
                      <select
                        aria-label={`Book ${l.lotCode} as`}
                        className="w-full rounded border border-line bg-surface px-2 py-1 text-sm"
                        value={mapping[l.senderLotId] ?? suggest(l)}
                        onChange={(e) => setMapping({ ...mapping, [l.senderLotId]: e.target.value })}
                      >
                        <option value="">Choose your product</option>
                        {products.data?.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.sku} · {p.name}
                          </option>
                        ))}
                      </select>
                    )
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {open && can("handoff:accept") && (
        <div className="grid gap-2 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center">
          <Button busy={accept.isPending} onClick={() => accept.mutate()}>
            Accept and book in
          </Button>
          {h.status === "pending" && (
            <>
              <input
                aria-label="Dispute reason"
                placeholder="What is wrong? (to dispute)"
                className="rounded border border-line bg-surface px-3 py-2 text-sm"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <Button variant="danger" disabled={reason.trim().length < 5} onClick={() => dispute.mutate()}>
                Dispute
              </Button>
            </>
          )}
        </div>
      )}
      {(accept.isError || dispute.isError) && <Alert>{(accept.error ?? dispute.error)?.message}</Alert>}
    </li>
  );
}

export function ShipmentsPage() {
  const org = useOrgContext();
  const list = useHandoffs(org.id);
  const incoming = list.data?.filter((h) => h.direction === "incoming") ?? [];
  const outgoing = list.data?.filter((h) => h.direction === "outgoing") ?? [];
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card title="Incoming from Casitrace suppliers">
        {incoming.length === 0 && (
          <p className="text-muted">No shipments from organisations on Casitrace yet.</p>
        )}
        <ul className="divide-y divide-line" aria-label="Incoming shipments">
          {incoming.map((h) => (
            <Incoming key={h.id} h={h} orgId={org.id} />
          ))}
        </ul>
      </Card>
      <Card title="Outgoing to Casitrace customers">
        {outgoing.length === 0 && (
          <p className="text-muted">Shipments to customers on Casitrace appear here.</p>
        )}
        <ul className="divide-y divide-line" aria-label="Outgoing shipments">
          {outgoing.map((h) => (
            <li key={h.id} className="grid gap-1 py-3 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <strong>To {h.counterparty.name}</strong>
                <span className={`rounded-full border px-2 py-0.5 text-xs ${STATUS[h.status]}`}>
                  {h.status}
                </span>
              </div>
              <p className="text-muted">
                {when.format(new Date(h.shippedAt))} ·{" "}
                {h.lines.map((l) => `${l.lotCode} (${l.quantity} ${l.uomCode})`).join(", ")}
                {h.sharedHistory ? " · history shared" : ""}
              </p>
              {h.disputeReason && (
                <p className="text-fail">
                  Disputed: {h.disputeReason}. Void the shipment and send it again if needed.
                </p>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
