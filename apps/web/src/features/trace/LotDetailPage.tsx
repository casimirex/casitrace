import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { Alert, Button, Card } from "../../components/ui";
import { api, unwrap } from "../../lib/api";
import { kdeEntries } from "../../lib/labels";
import { LinkedEvidence } from "../evidence/EvidenceDetailPage";
import { useCan, useOrgContext } from "../masterdata/common";
import { CreatePassportButton } from "../passports/PassportsPage";
import { StartRecallForm } from "../recalls/RecallsPage";
import { LotStatus } from "./LotsPage";
import { TraceGraph } from "./TraceGraph";

const when = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const EVENT_LABEL: Record<string, string> = {
  ORIGINATE: "Harvest / origin",
  RECEIVE: "Received",
  TRANSFORM: "Transformed",
  SHIP: "Shipped",
  ADJUST: "Adjusted",
  VOID: "Voided",
};

export function LotDetailPage() {
  const org = useOrgContext();
  const can = useCan();
  const { lotId = "" } = useParams();
  const queryClient = useQueryClient();
  const [direction, setDirection] = useState<"both" | "backward" | "forward">("both");
  const [reason, setReason] = useState("");
  const params = { params: { path: { orgId: org.id, lotId } } };
  const lot = useQuery({
    queryKey: ["org", org.id, "lots", lotId],
    queryFn: async () => unwrap(await api.GET("/v1/orgs/{orgId}/lots/{lotId}", params)),
  });
  const trace = useQuery({
    queryKey: ["org", org.id, "lots", lotId, "trace", direction],
    queryFn: async () =>
      unwrap(
        await api.GET("/v1/orgs/{orgId}/lots/{lotId}/trace", {
          params: { path: { orgId: org.id, lotId }, query: { direction } },
        }),
      ),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["org", org.id, "lots"] });
  const voidEvent = useMutation({
    mutationFn: async (eventId: string) =>
      unwrap(
        await api.POST("/v1/orgs/{orgId}/events/{eventId}/void", {
          params: { path: { orgId: org.id, eventId } },
          body: { reason },
        }),
      ),
    onSuccess: () => {
      setReason("");
      void refresh();
    },
  });
  const hold = useMutation({
    mutationFn: async (on: boolean) =>
      on
        ? unwrap(await api.POST("/v1/orgs/{orgId}/lots/{lotId}/hold", { ...params, body: { reason } }))
        : unwrap(await api.POST("/v1/orgs/{orgId}/lots/{lotId}/release", params)),
    onSuccess: () => {
      setReason("");
      void refresh();
    },
  });
  const downloadReport = async () => {
    const res = await fetch(`/api/v1/orgs/${org.id}/lots/${lotId}/trace-report`, { credentials: "include" });
    const url = URL.createObjectURL(await res.blob());
    Object.assign(document.createElement("a"), {
      href: url,
      download: `trace-${lot.data?.lotCode ?? lotId}.csv`,
    }).click();
    URL.revokeObjectURL(url);
  };

  if (lot.isPending) return <p className="text-muted">Loading…</p>;
  if (lot.isError) return <Alert>{lot.error.message}</Alert>;
  const l = lot.data;
  const t = trace.data;
  return (
    <div className="grid gap-6">
      {l.recallCaseId && (
        <Alert>
          This lot is under recall. It cannot be used or shipped.{" "}
          <Link to={`/orgs/${org.id}/recalls/${l.recallCaseId}`} className="underline">
            Open the recall
          </Link>
        </Alert>
      )}
      <Card title={`Lot ${l.lotCode}`} actions={<LotStatus status={l.status} />}>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1.5 text-sm sm:grid-cols-[max-content_1fr_max-content_1fr]">
          <dt className="text-muted">Product</dt>
          <dd>
            {l.product.name}{" "}
            <span className="text-muted">
              ({l.product.sku} v{l.product.version})
            </span>
          </dd>
          <dt className="text-muted">Quantity now</dt>
          <dd className="tabular-nums" data-testid="lot-quantity">
            {l.quantity} {l.uomCode} <span className="text-muted">of {l.initialQuantity}</span>
          </dd>
          <dt className="text-muted">Where</dt>
          <dd>{l.location ? `${l.location.code} · ${l.location.name}` : "—"}</dd>
          {l.holdReason && (
            <>
              <dt className="text-muted">On hold</dt>
              <dd>{l.holdReason}</dd>
            </>
          )}
        </dl>
        <div className="mt-3">
          <CreatePassportButton scope="lot" id={l.id} />
        </div>
        {(can("lot:hold") || can("event:void")) && (
          <div className="mt-4 grid gap-2 border-t border-line pt-3 sm:grid-cols-[minmax(0,1fr)_auto]">
            <input
              aria-label="Reason"
              placeholder="Reason (to hold the lot or void an event)"
              className="rounded border border-line bg-surface px-3 py-2 text-sm"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            {can("lot:hold") && l.status === "active" && (
              <Button variant="secondary" onClick={() => hold.mutate(true)}>
                Put on hold
              </Button>
            )}
            {can("lot:hold") && l.status === "on_hold" && (
              <Button variant="secondary" onClick={() => hold.mutate(false)}>
                Release
              </Button>
            )}
          </div>
        )}
        {(hold.isError || voidEvent.isError) && (
          <div className="mt-2">
            <Alert>{(hold.error ?? voidEvent.error)?.message}</Alert>
          </div>
        )}
      </Card>

      <Card
        title="Trace"
        actions={
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {(["backward", "both", "forward"] as const).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDirection(d)}
                className={`rounded border px-2 py-1 ${direction === d ? "border-brand bg-brand text-canvas" : "border-line"}`}
              >
                {d === "backward" ? "Where it came from" : d === "forward" ? "Where it went" : "Both"}
              </button>
            ))}
            <Button variant="secondary" onClick={downloadReport}>
              Download trace report (CSV)
            </Button>
          </div>
        }
      >
        {trace.isError && <Alert>{trace.error.message}</Alert>}
        {t && (
          <div className="grid gap-4">
            <TraceGraph trace={t} orgId={org.id} />
            <p className="text-xs text-muted" data-testid="trace-summary">
              {t.nodes.length} lots · {t.suppliers.length} supplier deliveries · {t.shipments.length}{" "}
              shipments · {t.elapsedMs} ms
              {t.truncated && " · truncated"}
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm" aria-label="Trace">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-muted">
                    <th className="py-1.5 pr-3 font-medium">Step</th>
                    <th className="py-1.5 pr-3 font-medium">Lot</th>
                    <th className="py-1.5 pr-3 font-medium">Product</th>
                    <th className="py-1.5 pr-3 font-medium">Origin</th>
                    <th className="py-1.5 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {t.nodes.map((n) => (
                    <tr key={n.lotId}>
                      <td className="py-1.5 pr-3 tabular-nums">
                        {n.depth === 0 ? "this lot" : n.depth < 0 ? `${-n.depth} up` : `${n.depth} down`}
                      </td>
                      <td className="py-1.5 pr-3 font-mono text-xs">
                        {n.redacted ? (
                          <span className="font-sans text-muted">Not shared by {n.org.name}</span>
                        ) : n.org.id === org.id ? (
                          <Link to={`/orgs/${org.id}/lots/${n.lotId}`} className="text-brand hover:underline">
                            {n.lotCode}
                          </Link>
                        ) : (
                          <span title={`Shared by ${n.org.name}`}>{n.lotCode}</span>
                        )}
                      </td>
                      <td className="py-1.5 pr-3">
                        {n.productName}
                        {n.org.id !== org.id && !n.redacted && (
                          <span className="text-muted"> · {n.org.name}</span>
                        )}
                      </td>
                      <td className="py-1.5 pr-3 text-muted">
                        {n.origin
                          ? `${EVENT_LABEL[n.origin.eventType] ?? n.origin.eventType}${n.origin.partner ? ` from ${n.origin.partner}` : ""}${n.origin.location ? ` at ${n.origin.location}` : ""}`
                          : ""}
                      </td>
                      <td className="py-1.5">{n.status && <LotStatus status={n.status} />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {t.shipments.length > 0 && (
              <div>
                <h3 className="mb-1 text-sm font-semibold">Customers who received product</h3>
                <ul className="text-sm" aria-label="Customers">
                  {t.shipments.map((s) => (
                    <li key={s.eventId + s.lotId}>
                      {s.partnerName} — {s.quantity} {s.uomCode} on {when.format(new Date(s.occurredAt))}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card title="Events">
          <ol className="grid gap-3" aria-label="Events">
            {l.events.map((e) => (
              <li
                key={e.id}
                className={`rounded border border-line p-3 text-sm ${e.voidedBy ? "opacity-60" : ""}`}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <strong className={e.voidedBy ? "line-through" : ""}>
                    {EVENT_LABEL[e.type]}
                    {e.process && e.process !== "harvest" ? ` · ${e.process}` : ""}
                  </strong>
                  <span className="tabular-nums text-muted">{when.format(new Date(e.occurredAt))}</span>
                </div>
                <p className="text-muted">
                  {[
                    e.location && `at ${e.location.code}`,
                    e.partner && (e.type === "SHIP" ? `to ${e.partner.name}` : `from ${e.partner.name}`),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                <ul className="mt-1">
                  {e.lines.map((ln) => (
                    <li key={ln.lot.id + ln.role}>
                      {ln.role === "input" ? "−" : ln.role === "output" ? "+" : "±"} {ln.quantity}{" "}
                      {ln.uomCode}{" "}
                      <Link
                        to={`/orgs/${org.id}/lots/${ln.lot.id}`}
                        className="font-mono text-xs text-brand hover:underline"
                      >
                        {ln.lot.lotCode}
                      </Link>
                    </li>
                  ))}
                </ul>
                {Object.keys(e.kdes).length > 0 && (
                  <dl
                    className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 text-xs"
                    aria-label="Recorded details"
                  >
                    {kdeEntries(e.kdes as Record<string, unknown>).map((k) => (
                      <div key={k.key} className="contents">
                        <dt className="text-muted">{k.label}</dt>
                        <dd>{k.value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                {e.overrideReason && (
                  <p className="mt-1 text-warn">Mass balance accepted: {e.overrideReason}</p>
                )}
                {e.voidedBy && <p className="mt-1 text-fail">Voided: {e.voidedBy.reason}</p>}
                {!e.voidedBy && can("event:void") && (
                  <button
                    type="button"
                    className="mt-1 text-xs text-muted underline hover:text-fail"
                    onClick={() => voidEvent.mutate(e.id)}
                    disabled={reason.trim().length < 5}
                  >
                    {reason.trim().length < 5 ? "Void (write a reason above first)" : "Void this event"}
                  </button>
                )}
              </li>
            ))}
          </ol>
        </Card>
        <div className="grid content-start gap-6">
          <LinkedEvidence orgId={org.id} targetType="lot" targetId={l.id} />
          {l.status !== "voided" && (
            <Card title="Recall">
              <StartRecallForm lotId={l.id} />
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
