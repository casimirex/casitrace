import { RECALL_SEVERITIES } from "@casitrace/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Alert, Button, Card, Field, SelectField } from "../../components/ui";
import { api, unwrap } from "../../lib/api";
import { formValues, useCan, useOrgContext } from "../masterdata/common";

const when = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const SEVERITY: Record<string, string> = {
  health_risk: "Health risk",
  quality: "Quality",
  regulatory: "Regulatory",
  other: "Other",
};
const duration = (s: number) =>
  s < 60 ? `${s.toFixed(1)} s` : `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;

export function RecallsPage() {
  const org = useOrgContext();
  const can = useCan();
  const queryClient = useQueryClient();
  const recalls = useQuery({
    queryKey: ["org", org.id, "recalls"],
    queryFn: async () =>
      unwrap(await api.GET("/v1/orgs/{orgId}/recalls", { params: { path: { orgId: org.id } } })).items,
  });
  const incoming = useQuery({
    queryKey: ["org", org.id, "recall-notices"],
    queryFn: async () =>
      unwrap(await api.GET("/v1/orgs/{orgId}/recall-notices", { params: { path: { orgId: org.id } } })).items,
  });
  const [notes, setNotes] = useState<Record<string, string>>({});
  const ack = useMutation({
    mutationFn: async (id: string) =>
      unwrap(
        await api.POST("/v1/orgs/{orgId}/recall-notices/{noticeId}/acknowledge", {
          params: { path: { orgId: org.id, noticeId: id } },
          body: { note: notes[id] ?? "" },
        }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["org", org.id, "recall-notices"] }),
  });
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card title="Recalls from your suppliers">
        {incoming.data?.length === 0 && <p className="text-muted">None.</p>}
        {ack.isError && <Alert>{ack.error.message}</Alert>}
        <ul className="divide-y divide-line" aria-label="Incoming recalls">
          {incoming.data?.map((n) => (
            <li key={n.id} className="grid gap-1 py-3 text-sm">
              <p className="font-semibold text-fail">
                {n.from.name} · {n.caseCode} · {SEVERITY[n.severity]}
              </p>
              <p>{n.reason}</p>
              {n.instructions && <p className="font-medium">Instructions: {n.instructions}</p>}
              <p className="text-muted">
                Shipments: {n.shipments.map((s) => `${s.lotCode} (${s.quantity} ${s.uomCode})`).join(", ")}
              </p>
              <p>
                Your affected lots:{" "}
                {n.yourLots.length
                  ? n.yourLots.map((l) => (
                      <Link
                        key={l.lotId}
                        to={`/orgs/${org.id}/lots/${l.lotId}`}
                        className="mr-2 font-mono text-xs text-brand underline"
                      >
                        {l.lotCode}
                      </Link>
                    ))
                  : "none booked in"}
              </p>
              {n.acknowledgedAt ? (
                <p className="text-ok">Acknowledged {when.format(new Date(n.acknowledgedAt))}</p>
              ) : (
                can("recall:acknowledge") && (
                  <div className="flex flex-wrap gap-2">
                    <input
                      aria-label="What you did"
                      placeholder="What you did (e.g. removed from sale)"
                      className="min-w-0 flex-1 rounded border border-line bg-surface px-3 py-1.5"
                      value={notes[n.id] ?? ""}
                      onChange={(e) => setNotes({ ...notes, [n.id]: e.target.value })}
                    />
                    <Button disabled={(notes[n.id] ?? "").trim().length < 3} onClick={() => ack.mutate(n.id)}>
                      Acknowledge
                    </Button>
                  </div>
                )
              )}
            </li>
          ))}
        </ul>
      </Card>
      <Card title="Your recalls and drills">
        <p className="mb-2 text-sm text-muted">Start a recall or a mock recall from a lot's page.</p>
        <ul className="divide-y divide-line" aria-label="Recalls">
          {recalls.data?.map((r) => (
            <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-sm">
              <Link to={r.id} className="font-medium text-brand hover:underline">
                {r.code}
              </Link>
              <span className="text-muted">
                {r.mode === "drill" ? "drill" : "recall"} · {r.status}
                {r.secondsToExport !== null ? ` · impact exported in ${duration(r.secondsToExport)}` : ""}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

/** Start a recall or a drill from a lot. */
export function StartRecallForm({ lotId }: { lotId: string }) {
  const org = useOrgContext();
  const can = useCan();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"drill" | "real">("drill");
  const start = useMutation({
    mutationFn: async (v: Record<string, string | null>) =>
      unwrap(
        await api.POST("/v1/orgs/{orgId}/recalls", {
          params: { path: { orgId: org.id } },
          body: {
            mode,
            lotIds: [lotId],
            reason: v.reason ?? "",
            severity: (v.severity ?? "quality") as (typeof RECALL_SEVERITIES)[number],
            ...(v.instructions ? { instructions: v.instructions } : {}),
          },
        }),
      ),
    onSuccess: (r) => navigate(`/orgs/${org.id}/recalls/${r.id}`),
  });
  if (!can("recall:drill")) return null;
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    start.mutate(formValues(e.currentTarget));
  };
  return (
    <form onSubmit={submit} className="grid gap-3">
      <fieldset className="flex flex-wrap gap-4 text-sm">
        <legend className="sr-only">Kind</legend>
        <label className="flex items-center gap-2">
          <input type="radio" name="mode" checked={mode === "drill"} onChange={() => setMode("drill")} /> Mock
          recall (drill)
        </label>
        {can("recall:start") && (
          <label className="flex items-center gap-2 text-fail">
            <input type="radio" name="mode" checked={mode === "real"} onChange={() => setMode("real")} /> Real
            recall
          </label>
        )}
      </fieldset>
      <Field
        label="Recall reason"
        name="reason"
        required
        minLength={5}
        placeholder={mode === "drill" ? "Quarterly mock recall" : "Lab result above the legal limit"}
      />
      <SelectField label="Severity" name="severity" defaultValue="quality">
        {RECALL_SEVERITIES.map((s) => (
          <option key={s} value={s}>
            {SEVERITY[s]}
          </option>
        ))}
      </SelectField>
      {mode === "real" && (
        <Field
          label="Instructions for customers"
          name="instructions"
          placeholder="Remove from sale and return"
        />
      )}
      {mode === "real" && (
        <Alert>
          A real recall blocks the lots and everything made from them, shows a recall notice on their public
          pages and notifies your customers on Casitrace.
        </Alert>
      )}
      <Button type="submit" variant={mode === "real" ? "danger" : "primary"} busy={start.isPending}>
        {mode === "real" ? "Start recall" : "Start mock recall"}
      </Button>
      {start.isError && <Alert>{start.error.message}</Alert>}
    </form>
  );
}

export function RecallCasePage() {
  const org = useOrgContext();
  const can = useCan();
  const { recallId = "" } = useParams();
  const queryClient = useQueryClient();
  const params = { params: { path: { orgId: org.id, recallId } } };
  const key = ["org", org.id, "recalls", recallId];
  const r = useQuery({
    queryKey: key,
    queryFn: async () => unwrap(await api.GET("/v1/orgs/{orgId}/recalls/{recallId}", params)),
  });
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const [closeNote, setCloseNote] = useState("");
  const [ackNotes, setAckNotes] = useState<Record<string, string>>({});
  const refresh = () => queryClient.invalidateQueries({ queryKey: key });
  const close = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST("/v1/orgs/{orgId}/recalls/{recallId}/close", { ...params, body: { note: closeNote } }),
      ),
    onSuccess: refresh,
  });
  const ack = useMutation({
    mutationFn: async (noticeId: string) =>
      unwrap(
        await api.POST("/v1/orgs/{orgId}/recalls/{recallId}/notices/{noticeId}/acknowledge", {
          params: { path: { orgId: org.id, recallId, noticeId } },
          body: { note: ackNotes[noticeId] ?? "" },
        }),
      ),
    onSuccess: refresh,
  });
  const exportCsv = async () => {
    const res = await fetch(`/api/v1/orgs/${org.id}/recalls/${recallId}/export`, { credentials: "include" });
    const url = URL.createObjectURL(await res.blob());
    Object.assign(document.createElement("a"), {
      href: url,
      download: `${r.data?.code ?? "recall"}.csv`,
    }).click();
    URL.revokeObjectURL(url);
    await refresh();
  };
  if (!r.data) return <p className="text-muted">Loading…</p>;
  const c = r.data;
  const elapsed = c.secondsToExport ?? (now - Date.parse(c.startedAt)) / 1000;
  return (
    <div className="grid gap-6">
      <Card
        title={`${c.mode === "drill" ? "Mock recall" : "Recall"} ${c.code}`}
        actions={
          <span className={`text-sm ${c.mode === "real" ? "text-fail" : "text-muted"}`}>{c.status}</span>
        }
      >
        <p className="text-sm">{c.reason}</p>
        {c.instructions && <p className="text-sm font-medium">Instructions: {c.instructions}</p>}
        <p className="mt-2 text-sm" data-testid="recall-clock">
          {c.secondsToExport !== null
            ? `Impact identified and exported in ${duration(c.secondsToExport)}`
            : `Running for ${duration(elapsed)}. Export the impact to stop the clock.`}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={exportCsv}>Export impact and contact list (CSV)</Button>
          {c.status === "open" && can(c.mode === "real" ? "recall:start" : "recall:drill") && (
            <>
              <input
                aria-label="Closing note"
                placeholder="Closing note"
                className="rounded border border-line bg-surface px-3 py-1.5 text-sm"
                value={closeNote}
                onChange={(e) => setCloseNote(e.target.value)}
              />
              <Button
                variant="secondary"
                disabled={closeNote.trim().length < 3}
                onClick={() => close.mutate()}
              >
                Close
              </Button>
            </>
          )}
        </div>
      </Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={`Affected lots (${c.impact?.lots.length ?? 0})`}>
          {c.impact && c.impact.redactedOrganisations.length > 0 && (
            <p className="mb-2 text-sm text-warn">
              Not shared with you: {c.impact.redactedOrganisations.join(", ")}. Their customers are notified
              by them.
            </p>
          )}
          <table className="w-full text-sm" aria-label="Affected lots">
            <tbody className="divide-y divide-line">
              {c.impact?.lots.map((l) => (
                <tr key={l.lotId}>
                  <td className="py-1.5 pr-3 font-mono text-xs">{l.redacted ? "—" : l.lotCode}</td>
                  <td className="py-1.5 pr-3">{l.redacted ? "not shared" : l.productName}</td>
                  <td className="py-1.5 pr-3 text-muted">{l.org.name}</td>
                  <td className="py-1.5 text-right tabular-nums">
                    {l.redacted ? "" : `${l.quantity} ${l.uomCode}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title={`Customers (${c.notices.length})`}>
          <ul className="divide-y divide-line text-sm" aria-label="Customers">
            {c.notices.map((n) => (
              <li key={n.id} className="grid gap-1 py-2">
                <span className="font-medium">
                  {n.partner.name}{" "}
                  <span className="text-xs text-muted">
                    (
                    {n.channel === "platform"
                      ? "notified on Casitrace"
                      : c.mode === "drill"
                        ? "would be contacted"
                        : "contact directly"}
                    )
                  </span>
                </span>
                <span className="text-muted">
                  {[n.partner.email, n.partner.city].filter(Boolean).join(" · ")}
                </span>
                <span className="text-muted">
                  {n.shipments.map((s) => `${s.lotCode}: ${s.quantity} ${s.uomCode}`).join(", ")}
                </span>
                {n.acknowledgedAt ? (
                  <span className="text-ok">Acknowledged{n.ackNote ? `: ${n.ackNote}` : ""}</span>
                ) : (
                  n.channel === "external" &&
                  can("recall:drill") && (
                    <span className="flex gap-2">
                      <input
                        aria-label={`Confirmation from ${n.partner.name}`}
                        placeholder="How they confirmed"
                        className="min-w-0 flex-1 rounded border border-line bg-surface px-2 py-1"
                        value={ackNotes[n.id] ?? ""}
                        onChange={(e) => setAckNotes({ ...ackNotes, [n.id]: e.target.value })}
                      />
                      <Button
                        variant="secondary"
                        disabled={(ackNotes[n.id] ?? "").trim().length < 3}
                        onClick={() => ack.mutate(n.id)}
                      >
                        Record
                      </Button>
                    </span>
                  )
                )}
              </li>
            ))}
          </ul>
        </Card>
      </div>
      {(close.isError || ack.isError) && <Alert>{(close.error ?? ack.error)?.message}</Alert>}
    </div>
  );
}
