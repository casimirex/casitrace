import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { Alert, Button, Card, PageTitle, SelectField } from "../../components/ui";
import { api, unwrap } from "../../lib/api";
import { useMe } from "../orgs/queries";

export function ClaimPage() {
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const me = useMe();
  const info = useQuery({
    queryKey: ["claim", token],
    retry: false,
    queryFn: async () => unwrap(await api.GET("/v1/claims/{token}", { params: { path: { token } } })),
  });
  const owned = me.data?.memberships.filter((m) => m.role === "owner" || m.role === "admin") ?? [];
  const [orgId, setOrgId] = useState("");
  const accept = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST("/v1/claims/{token}/accept", {
          params: { path: { token } },
          body: { organizationId: orgId || (owned[0]?.organization.id ?? "") },
        }),
      ),
    onSuccess: () => navigate(`/orgs/${orgId || owned[0]?.organization.id}/shipments`),
  });
  return (
    <div className="max-w-lg">
      <PageTitle title="Link your organisation" />
      {info.isError && <Alert>{info.error.message}</Alert>}
      {info.data && (
        <Card>
          <p className="text-sm">
            <strong>{info.data.inviterName}</strong> records <strong>{info.data.partnerName}</strong> as a
            trading partner and invites you to link your Casitrace organisation. Earlier shipments from them
            will appear for you to book in. Your own records stay private.
          </p>
          {info.data.claimed ? (
            <div className="mt-3">
              <Alert tone="info">This invitation was already used.</Alert>
            </div>
          ) : owned.length === 0 ? (
            <div className="mt-3">
              <Alert tone="info">
                Create your organisation first (home page), then open this link again.
              </Alert>
            </div>
          ) : (
            <div className="mt-4 grid gap-3">
              <SelectField
                label="Your organisation"
                value={orgId || owned[0]?.organization.id}
                onChange={(e) => setOrgId(e.target.value)}
              >
                {owned.map((m) => (
                  <option key={m.organization.id} value={m.organization.id}>
                    {m.organization.name}
                  </option>
                ))}
              </SelectField>
              <Button busy={accept.isPending} onClick={() => accept.mutate()} className="justify-self-start">
                Link organisation
              </Button>
              {accept.isError && <Alert>{accept.error.message}</Alert>}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
