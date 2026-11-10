import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Alert, Button, Card, PageTitle } from "../../components/ui";
import { api, unwrap } from "../../lib/api";

/** Platform staff review queue for business verification requests. */
export function VerificationsPage() {
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const queue = useQuery({
    queryKey: ["platform", "verifications"],
    queryFn: async () => unwrap(await api.GET("/v1/platform/verifications")).items,
    retry: false,
  });
  const decide = useMutation({
    mutationFn: async ({ orgId, decision }: { orgId: string; decision: "approve" | "reject" }) =>
      unwrap(
        await api.POST("/v1/platform/verifications/{organizationId}", {
          params: { path: { organizationId: orgId } },
          body: { decision, note: notes[orgId] || undefined },
        }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["platform", "verifications"] }),
  });

  return (
    <>
      <PageTitle
        title="Verification requests"
        subtitle="Check each business against its official registry entry before approving."
      />
      {queue.isError && <Alert>{queue.error.message}</Alert>}
      {decide.isError && <Alert>{decide.error.message}</Alert>}
      {queue.data?.length === 0 && <p className="text-muted">No requests waiting.</p>}
      <div className="grid gap-4">
        {queue.data?.map((p) => (
          <Card key={p.orgId} title={p.legalName}>
            <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
              <dt className="text-muted">Registration</dt>
              <dd className="font-mono">{p.registrationNumber}</dd>
              <dt className="text-muted">VAT</dt>
              <dd className="font-mono">{p.vatNumber ?? "—"}</dd>
              <dt className="text-muted">Address</dt>
              <dd>{[p.addressLine1, p.postalCode, p.city, p.countryCode].filter(Boolean).join(", ")}</dd>
              <dt className="text-muted">Requested</dt>
              <dd>
                {p.verificationRequestedAt ? new Date(p.verificationRequestedAt).toLocaleString() : "—"}
              </dd>
            </dl>
            <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center">
              <input
                aria-label="Note"
                placeholder="Note (required to reject)"
                className="rounded border border-line bg-surface px-3 py-2 text-sm"
                value={notes[p.orgId] ?? ""}
                onChange={(e) => setNotes({ ...notes, [p.orgId]: e.target.value })}
              />
              <Button onClick={() => decide.mutate({ orgId: p.orgId, decision: "approve" })}>Approve</Button>
              <Button variant="danger" onClick={() => decide.mutate({ orgId: p.orgId, decision: "reject" })}>
                Reject
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}
