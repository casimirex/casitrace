import type { components } from "@casitrace/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useParams } from "react-router";
import { Alert, Button, Card } from "../../components/ui";
import { api, postForm, unwrap } from "../../lib/api";
import { useCan, useOrgContext } from "../masterdata/common";
import { typeLabel } from "./EvidencePage";
import { expiryText, STATUS_MEANING, StatusBadge } from "./StatusBadge";

type Evidence = components["schemas"]["Evidence"];
const when = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const size = (n: number) =>
  n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`;

export function EvidenceDetailPage() {
  const org = useOrgContext();
  const can = useCan();
  const { evidenceId = "" } = useParams();
  const queryClient = useQueryClient();
  const key = ["org", org.id, "evidence", evidenceId];
  const [reason, setReason] = useState("");
  const [integrity, setIntegrity] = useState<Record<number, string>>({});
  const params = { params: { path: { orgId: org.id, evidenceId } } };

  const ev = useQuery({
    queryKey: key,
    queryFn: async () => unwrap(await api.GET("/v1/orgs/{orgId}/evidence/{evidenceId}", params)),
    // Refresh while the virus scan is running.
    refetchInterval: (q) => (q.state.data?.status === "submitted" ? 2000 : false),
  });
  const set = (data: Evidence) => queryClient.setQueryData(key, data);
  const review = useMutation({
    mutationFn: async (action: "verify" | "reject" | "revoke") =>
      unwrap(
        await api.POST("/v1/orgs/{orgId}/evidence/{evidenceId}/review", {
          ...params,
          body: { action, reason: reason || undefined },
        }),
      ),
    onSuccess: (d) => {
      set(d);
      setReason("");
    },
  });
  const newVersion = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return postForm<Evidence>(`/v1/orgs/${org.id}/evidence/${evidenceId}/files`, form);
    },
    onSuccess: set,
  });
  const download = async (version: number) => {
    const link = unwrap(
      await api.POST("/v1/orgs/{orgId}/evidence/{evidenceId}/files/{version}/download", {
        params: { path: { orgId: org.id, evidenceId, version } },
      }),
    );
    window.open(link.url, "_blank", "noopener");
  };
  const check = async (version: number) => {
    const r = unwrap(
      await api.POST("/v1/orgs/{orgId}/evidence/{evidenceId}/files/{version}/integrity", {
        params: { path: { orgId: org.id, evidenceId, version } },
      }),
    );
    setIntegrity({
      ...integrity,
      [version]: r.match ? "Unchanged since upload" : "CHANGED — the stored file no longer matches its hash",
    });
  };

  if (ev.isPending) return <p className="text-muted">Loading…</p>;
  if (ev.isError) return <Alert>{ev.error.message}</Alert>;
  const e = ev.data;
  const status = e.status;
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="grid content-start gap-6">
        <Card title={e.title} actions={<StatusBadge status={status} />}>
          <p className="mb-3 text-sm" data-testid="status-meaning">
            {STATUS_MEANING[status]}
          </p>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1.5 text-sm">
            <dt className="text-muted">Kind</dt>
            <dd>{typeLabel(e.type)}</dd>
            {e.type === "certificate" && (
              <>
                <dt className="text-muted">Scheme</dt>
                <dd>{e.scheme}</dd>
                <dt className="text-muted">Issued by</dt>
                <dd>{e.issuerName}</dd>
                <dt className="text-muted">Number</dt>
                <dd className="font-mono">{e.certificateNumber ?? "—"}</dd>
                <dt className="text-muted">Valid</dt>
                <dd>
                  {e.validFrom ?? "…"} → {e.validUntil}{" "}
                  <span className="text-muted">({expiryText(e.daysUntilExpiry)})</span>
                </dd>
              </>
            )}
            <dt className="text-muted">Supports</dt>
            <dd>
              {e.links
                .map((l) => `${typeLabel(l.targetType)}: ${l.label ?? l.targetId.slice(0, 8)}`)
                .join(" · ") || "—"}
            </dd>
          </dl>
        </Card>
        <Card title="Files">
          <p className="mb-3 text-sm text-muted">
            The SHA-256 fingerprint proves a file has not changed since upload. It does not prove the content
            is true.
          </p>
          <ul className="divide-y divide-line" aria-label="Files">
            {e.files.map((f) => (
              <li key={f.version} className="grid gap-1 py-2.5 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    <strong>v{f.version}</strong> · {f.originalName} · {size(f.sizeBytes)}
                  </span>
                  <span
                    className={
                      f.scanStatus === "clean"
                        ? "text-ok"
                        : f.scanStatus === "infected"
                          ? "text-fail"
                          : "text-muted"
                    }
                  >
                    scan: {f.scanStatus}
                  </span>
                </div>
                <code className="break-all font-mono text-xs text-muted" title="SHA-256">
                  {f.sha256}
                </code>
                <div className="flex flex-wrap gap-3">
                  {f.scanStatus === "clean" && (
                    <>
                      <button
                        type="button"
                        className="text-brand hover:underline"
                        onClick={() => download(f.version)}
                      >
                        Download
                      </button>
                      <button
                        type="button"
                        className="text-brand hover:underline"
                        onClick={() => check(f.version)}
                      >
                        Check integrity
                      </button>
                    </>
                  )}
                  {integrity[f.version] && (
                    <span data-testid={`integrity-${f.version}`}>{integrity[f.version]}</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {can("evidence:update") && status !== "revoked" && (
            <div className="mt-3 grid gap-1.5 border-t border-line pt-3">
              <label htmlFor="new-version" className="text-sm font-medium">
                Replace with a new file
              </label>
              <input
                id="new-version"
                type="file"
                className="text-sm"
                onChange={(ev2) => ev2.target.files?.[0] && newVersion.mutate(ev2.target.files[0])}
              />
              {newVersion.isError && <Alert>{newVersion.error.message}</Alert>}
            </div>
          )}
        </Card>
      </div>
      <div className="grid content-start gap-6">
        {can("evidence:verify") && ["checked", "submitted", "verified"].includes(status) && (
          <Card title="Review">
            <div className="grid gap-3">
              {review.isError && <Alert>{review.error.message}</Alert>}
              <textarea
                aria-label="Reason"
                placeholder="Reason (required to reject or revoke)"
                className="rounded border border-line bg-surface px-3 py-2 text-sm"
                rows={2}
                value={reason}
                onChange={(x) => setReason(x.target.value)}
              />
              <div className="flex flex-wrap gap-2">
                {status === "checked" && <Button onClick={() => review.mutate("verify")}>Verify</Button>}
                {status !== "verified" && (
                  <Button variant="danger" onClick={() => review.mutate("reject")}>
                    Reject
                  </Button>
                )}
                {status === "verified" && (
                  <Button variant="danger" onClick={() => review.mutate("revoke")}>
                    Revoke
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted">
                Someone other than the person who uploaded the file must verify it.
              </p>
            </div>
          </Card>
        )}
        <Card title="History">
          <ol className="grid gap-2 text-sm" aria-label="History">
            {e.history.map((h) => (
              <li key={h.occurredAt + h.toStatus}>
                <span className="tabular-nums text-muted">{when.format(new Date(h.occurredAt))}</span> ·{" "}
                <strong className="capitalize">{h.toStatus}</strong>
                {h.actorType === "system" && <span className="text-muted"> (system)</span>}
                {h.reason && <span className="block text-muted">{h.reason}</span>}
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </div>
  );
}

/** Evidence linked to one record, for product and location pages. */
export function LinkedEvidence({
  orgId,
  targetType,
  targetId,
}: {
  orgId: string;
  targetType: "product" | "location";
  targetId: string;
}) {
  const list = useQuery({
    queryKey: ["org", orgId, "evidence", targetType, targetId],
    queryFn: async () =>
      unwrap(
        await api.GET("/v1/orgs/{orgId}/evidence", {
          params: { path: { orgId }, query: { targetType, targetId } },
        }),
      ).items,
  });
  return (
    <Card title="Evidence">
      {list.data?.length === 0 && <p className="text-sm text-muted">No evidence linked yet.</p>}
      <ul className="divide-y divide-line text-sm">
        {list.data?.map((e) => (
          <li key={e.id} className="flex items-center justify-between gap-2 py-2">
            <a href={`/orgs/${orgId}/evidence/${e.id}`} className="text-brand hover:underline">
              {e.title}
            </a>
            <StatusBadge status={e.status} />
          </li>
        ))}
      </ul>
    </Card>
  );
}
