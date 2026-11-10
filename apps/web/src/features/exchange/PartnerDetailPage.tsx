import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useParams } from "react-router";
import { Alert, Button, Card, Field } from "../../components/ui";
import { api, unwrap } from "../../lib/api";
import { useCan, useOrgContext } from "../masterdata/common";

export function PartnerDetailPage() {
  const org = useOrgContext();
  const can = useCan();
  const { partnerId = "" } = useParams();
  const queryClient = useQueryClient();
  const params = { params: { path: { orgId: org.id, partnerId } } };
  const [email, setEmail] = useState("");
  const [notice, setNotice] = useState<string>();
  const partner = useQuery({
    queryKey: ["org", org.id, "partner", partnerId],
    queryFn: async () => unwrap(await api.GET("/v1/orgs/{orgId}/partners/{partnerId}", params)),
  });
  const compliance = useQuery({
    queryKey: ["org", org.id, "partner", partnerId, "compliance"],
    queryFn: async () => unwrap(await api.GET("/v1/orgs/{orgId}/partners/{partnerId}/compliance", params)),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["org", org.id, "partner", partnerId] });
  const approve = useMutation({
    mutationFn: async () => unwrap(await api.POST("/v1/orgs/{orgId}/partners/{partnerId}/approve", params)),
    onSuccess: refresh,
  });
  const suspend = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST("/v1/orgs/{orgId}/partners/{partnerId}/suspend", {
          ...params,
          body: { reason: "Suspended from partner page" },
        }),
      ),
    onSuccess: refresh,
  });
  const invite = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST("/v1/orgs/{orgId}/partners/{partnerId}/claim-invite", { ...params, body: { email } }),
      ),
    onSuccess: () => setNotice(`Invitation sent to ${email}.`),
  });
  if (!partner.data) return <p className="text-muted">Loading…</p>;
  const p = partner.data;
  const c = compliance.data;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card
        title={p.name}
        actions={<span className="text-sm capitalize text-muted">{c?.approvalStatus}</span>}
      >
        <p className="text-sm">
          {p.onPlatform ? `On Casitrace as ${p.linkedOrgName}.` : "Not on Casitrace."}
        </p>
        {!p.onPlatform && can("partner:update") && (
          <div className="mt-4 grid gap-2 border-t border-line pt-3">
            <p className="text-sm">
              Invite them to link their own organisation, so shipments between you can be traced end to end.
            </p>
            <Field
              label="Their email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Button
              variant="secondary"
              disabled={!email.includes("@")}
              onClick={() => invite.mutate()}
              className="justify-self-start"
            >
              Send invitation
            </Button>
            {notice && <Alert tone="success">{notice}</Alert>}
            {invite.isError && <Alert>{invite.error.message}</Alert>}
          </div>
        )}
      </Card>
      {p.kind !== "customer" && (
        <Card title="Supplier requirements">
          {c && c.requirements.length === 0 && (
            <p className="text-sm text-muted">
              Your organisation has no supplier requirements yet (Partners page).
            </p>
          )}
          <ul className="grid gap-2 text-sm" aria-label="Requirements">
            {c?.requirements.map((r) => (
              <li key={r.requirement.id}>
                <span className={r.met ? "text-ok" : "text-fail"}>{r.met ? "✓" : "✗"}</span>{" "}
                {r.requirement.label}
                <ul className="ml-5 text-muted">
                  {r.evidence.map((e) => (
                    <li key={e.id}>
                      {e.title} — {e.status}
                      {e.validUntil ? `, until ${e.validUntil}` : ""} (
                      {e.source === "shared_by_supplier" ? "shared by supplier" : "uploaded by you"})
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          {can("partner:approve") && (
            <div className="mt-4 flex gap-2">
              <Button
                disabled={!c?.requirementsMet || c.approvalStatus === "approved"}
                onClick={() => approve.mutate()}
              >
                Approve supplier
              </Button>
              {c?.approvalStatus === "approved" && (
                <Button variant="danger" onClick={() => suspend.mutate()}>
                  Suspend
                </Button>
              )}
            </div>
          )}
          {(approve.isError || suspend.isError) && <Alert>{(approve.error ?? suspend.error)?.message}</Alert>}
        </Card>
      )}
    </div>
  );
}
