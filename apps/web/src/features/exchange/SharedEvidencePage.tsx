import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router";
import { Alert, Button, Card } from "../../components/ui";
import { api, unwrap } from "../../lib/api";
import { STATUS_MEANING, StatusBadge } from "../evidence/StatusBadge";
import { useOrgContext } from "../masterdata/common";

export function SharedEvidencePage() {
  const org = useOrgContext();
  const { evidenceId = "" } = useParams();
  const ev = useQuery({
    queryKey: ["org", org.id, "shared", evidenceId],
    retry: false,
    queryFn: async () =>
      unwrap(
        await api.GET("/v1/orgs/{orgId}/shared/evidence/{evidenceId}", {
          params: { path: { orgId: org.id, evidenceId } },
        }),
      ),
  });
  if (ev.isPending) return <p className="text-muted">Loading…</p>;
  if (ev.isError) return <Alert>This document is not shared with you (any more).</Alert>;
  const e = ev.data;
  const download = async (version: number) => {
    const l = unwrap(
      await api.POST("/v1/orgs/{orgId}/shared/evidence/{evidenceId}/files/{version}/download", {
        params: { path: { orgId: org.id, evidenceId, version } },
      }),
    );
    window.open(l.url, "_blank", "noopener");
  };
  return (
    <Card title={e.title} actions={<StatusBadge status={e.status} />}>
      <p className="text-sm">
        Shared by <strong>{e.sharedBy.name}</strong>
        {e.sharedBy.verified ? " (verified business)" : ""}. Its status is set by {e.sharedBy.name}:{" "}
        {STATUS_MEANING[e.status]}
      </p>
      <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
        {e.scheme && (
          <>
            <dt className="text-muted">Scheme</dt>
            <dd>{e.scheme}</dd>
          </>
        )}
        {e.issuerName && (
          <>
            <dt className="text-muted">Issued by</dt>
            <dd>{e.issuerName}</dd>
          </>
        )}
        {e.validUntil && (
          <>
            <dt className="text-muted">Valid until</dt>
            <dd>{e.validUntil}</dd>
          </>
        )}
      </dl>
      <ul className="mt-3 grid gap-2 text-sm">
        {e.files.map((f) => (
          <li key={f.version} className="flex flex-wrap items-center justify-between gap-2">
            <span>
              v{f.version} · {f.originalName}{" "}
              <code className="font-mono text-xs text-muted">{f.sha256.slice(0, 16)}…</code>
            </span>
            {f.scanStatus === "clean" && (
              <Button variant="secondary" onClick={() => download(f.version)}>
                Download
              </Button>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted">
        {e.sharedBy.name} can see when you open or download this document.
      </p>
    </Card>
  );
}
