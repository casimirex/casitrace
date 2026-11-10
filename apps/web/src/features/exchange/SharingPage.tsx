import { EVIDENCE_TYPES } from "@casitrace/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Link } from "react-router";
import { Alert, Button, Card, Field, SelectField } from "../../components/ui";
import { api, unwrap } from "../../lib/api";
import { typeLabel } from "../evidence/EvidencePage";
import { formValues, useCan, useOrgContext } from "../masterdata/common";

const day = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

function Requests({ orgId }: { orgId: string }) {
  const can = useCan();
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["org", orgId, "requests"] });
  const list = useQuery({
    queryKey: ["org", orgId, "requests"],
    queryFn: async () =>
      unwrap(await api.GET("/v1/orgs/{orgId}/evidence-requests", { params: { path: { orgId } } })).items,
  });
  const partners = useQuery({
    queryKey: ["org", orgId, "partners"],
    queryFn: async () =>
      unwrap(await api.GET("/v1/orgs/{orgId}/partners", { params: { path: { orgId }, query: {} } })).items,
  });
  const ownEvidence = useQuery({
    queryKey: ["org", orgId, "evidence", "", false],
    queryFn: async () =>
      unwrap(await api.GET("/v1/orgs/{orgId}/evidence", { params: { path: { orgId }, query: {} } })).items,
  });
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [formKey, setFormKey] = useState(0);
  const create = useMutation({
    mutationFn: async (body: {
      partnerId: string;
      evidenceType: (typeof EVIDENCE_TYPES)[number];
      scheme?: string;
      note?: string;
    }) => unwrap(await api.POST("/v1/orgs/{orgId}/evidence-requests", { params: { path: { orgId } }, body })),
    onSuccess: () => {
      setFormKey((k) => k + 1);
      void refresh();
    },
  });
  const act = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: "fulfil" | "decline" | "cancel" }) => {
      const params = { params: { path: { orgId, requestId: id } } };
      if (action === "fulfil")
        return unwrap(
          await api.POST("/v1/orgs/{orgId}/evidence-requests/{requestId}/fulfil", {
            ...params,
            body: { evidenceId: choice[id] ?? "" },
          }),
        );
      if (action === "decline")
        return unwrap(
          await api.POST("/v1/orgs/{orgId}/evidence-requests/{requestId}/decline", {
            ...params,
            body: { reason: "Not available" },
          }),
        );
      return unwrap(await api.POST("/v1/orgs/{orgId}/evidence-requests/{requestId}/cancel", params));
    },
    onSuccess: refresh,
  });
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const v = formValues(e.currentTarget);
    create.mutate({
      partnerId: v.partnerId ?? "",
      evidenceType: (v.evidenceType ?? "certificate") as (typeof EVIDENCE_TYPES)[number],
      ...(v.scheme ? { scheme: v.scheme } : {}),
      ...(v.note ? { note: v.note } : {}),
    });
  };
  const suppliers = partners.data?.filter((p) => p.onPlatform && p.kind !== "customer") ?? [];
  return (
    <Card title="Document requests">
      {(create.isError || act.isError) && <Alert>{(create.error ?? act.error)?.message}</Alert>}
      <ul className="divide-y divide-line" aria-label="Document requests">
        {list.data?.map((r) => (
          <li key={r.id} className="grid gap-1 py-2.5 text-sm">
            <div className="flex flex-wrap justify-between gap-2">
              <span>
                <strong>
                  {r.direction === "incoming"
                    ? `${r.counterparty.name} asks you`
                    : `You asked ${r.counterparty.name}`}
                </strong>{" "}
                for a {typeLabel(r.evidenceType).toLowerCase()}
                {r.scheme ? ` (${r.scheme})` : ""}
              </span>
              <span className="capitalize text-muted">{r.status}</span>
            </div>
            {r.note && <p className="text-muted">{r.note}</p>}
            {r.fulfilledEvidence && r.direction === "outgoing" && (
              <Link
                to={`/orgs/${orgId}/shared/evidence/${r.fulfilledEvidence.id}`}
                className="text-brand hover:underline"
              >
                View shared document: {r.fulfilledEvidence.title}
              </Link>
            )}
            {r.declineReason && <p className="text-fail">Declined: {r.declineReason}</p>}
            {r.status === "open" && r.direction === "incoming" && can("evidence:update") && (
              <div className="flex flex-wrap gap-2">
                <select
                  aria-label="Document to share"
                  className="rounded border border-line bg-surface px-2 py-1"
                  value={choice[r.id] ?? ""}
                  onChange={(e) => setChoice({ ...choice, [r.id]: e.target.value })}
                >
                  <option value="">Choose one of your documents</option>
                  {ownEvidence.data
                    ?.filter(
                      (e) =>
                        e.type === r.evidenceType && !["rejected", "revoked", "expired"].includes(e.status),
                    )
                    .map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.title} ({e.status})
                      </option>
                    ))}
                </select>
                <Button disabled={!choice[r.id]} onClick={() => act.mutate({ id: r.id, action: "fulfil" })}>
                  Share it
                </Button>
                <Button variant="secondary" onClick={() => act.mutate({ id: r.id, action: "decline" })}>
                  Decline
                </Button>
              </div>
            )}
            {r.status === "open" && r.direction === "outgoing" && can("evidence:create") && (
              <button
                type="button"
                className="justify-self-start text-muted underline"
                onClick={() => act.mutate({ id: r.id, action: "cancel" })}
              >
                Withdraw request
              </button>
            )}
          </li>
        ))}
      </ul>
      {can("evidence:create") && (
        <form
          key={formKey}
          onSubmit={submit}
          className="mt-4 grid gap-3 border-t border-line pt-4 sm:grid-cols-2"
        >
          <SelectField label="Ask supplier" name="partnerId" required>
            {suppliers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </SelectField>
          <SelectField label="For a" name="evidenceType" defaultValue="certificate">
            {EVIDENCE_TYPES.map((t) => (
              <option key={t} value={t}>
                {typeLabel(t)}
              </option>
            ))}
          </SelectField>
          <Field label="Scheme (optional)" name="scheme" placeholder="EU organic" />
          <Field label="Note (optional)" name="note" />
          <Button type="submit" disabled={!suppliers.length} className="justify-self-start">
            Send request
          </Button>
          {!suppliers.length && (
            <p className="self-center text-xs text-muted">
              Only suppliers on Casitrace can receive requests.
            </p>
          )}
        </form>
      )}
    </Card>
  );
}

export function SharingPage() {
  const org = useOrgContext();
  const can = useCan();
  const queryClient = useQueryClient();
  const grants = useQuery({
    queryKey: ["org", org.id, "grants"],
    queryFn: async () =>
      unwrap(await api.GET("/v1/orgs/{orgId}/grants", { params: { path: { orgId: org.id } } })),
  });
  const revoke = useMutation({
    mutationFn: async (grantId: string) =>
      unwrap(
        await api.POST("/v1/orgs/{orgId}/grants/{grantId}/revoke", {
          params: { path: { orgId: org.id, grantId } },
        }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["org", org.id, "grants"] }),
  });
  const what = (g: NonNullable<typeof grants.data>["given"][number]) =>
    g.kind === "evidence"
      ? `document “${g.evidence?.title}”`
      : `history of lot ${g.lot?.lotCode} (${g.upstreamDepth} steps back${g.includeKdes ? ", with details" : ""})`;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="grid content-start gap-6">
        <Card title="You share">
          {grants.data?.given.length === 0 && (
            <p className="text-muted">Nothing shared. Your records are private until you share them.</p>
          )}
          <ul className="divide-y divide-line text-sm" aria-label="Shared by you">
            {grants.data?.given.map((g) => (
              <li key={g.id} className={`grid gap-0.5 py-2 ${g.revokedAt ? "opacity-60" : ""}`}>
                <span>
                  {what(g)} with <strong>{g.grantee?.name ?? "every organisation downstream"}</strong>
                </span>
                <span className="text-muted">
                  Since {day.format(new Date(g.createdAt))} · used {g.accessCount} times
                  {g.revokedAt ? ` · revoked ${day.format(new Date(g.revokedAt))}` : ""}
                </span>
                {!g.revokedAt && can("share:manage") && (
                  <button
                    type="button"
                    className="justify-self-start text-fail underline"
                    onClick={() => revoke.mutate(g.id)}
                  >
                    Stop sharing
                  </button>
                )}
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Shared with you">
          {grants.data?.received.length === 0 && <p className="text-muted">Nothing shared with you yet.</p>}
          <ul className="divide-y divide-line text-sm" aria-label="Shared with you">
            {grants.data?.received.map((g) => (
              <li key={g.id} className="py-2">
                <strong>{g.grantor.name}</strong> shares{" "}
                {g.kind === "evidence" ? (
                  <Link
                    to={`/orgs/${org.id}/shared/evidence/${g.evidence?.id}`}
                    className="text-brand hover:underline"
                  >
                    “{g.evidence?.title}”
                  </Link>
                ) : (
                  what(g)
                )}
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <Requests orgId={org.id} />
    </div>
  );
}
