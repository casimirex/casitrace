import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { Alert, Button, Card, PageTitle } from "../../components/ui";
import { authClient, errorMessage } from "../../lib/auth";

export function InvitationPage() {
  const { invitationId = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const invitation = useQuery({
    queryKey: ["invitation", invitationId],
    retry: false,
    queryFn: async () => {
      const { data, error } = await authClient.organization.getInvitation({ query: { id: invitationId } });
      if (error || !data)
        throw new Error(errorMessage(error, "This invitation is not valid for your account."));
      return data;
    },
  });

  const respond = async (accept: boolean) => {
    setBusy(true);
    setError(undefined);
    const { data, error } = accept
      ? await authClient.organization.acceptInvitation({ invitationId })
      : await authClient.organization.rejectInvitation({ invitationId });
    setBusy(false);
    if (error) return setError(errorMessage(error, "Could not respond to the invitation."));
    await queryClient.invalidateQueries({ queryKey: ["me"] });
    const orgId = accept && data && "member" in data && data.member ? data.member.organizationId : null;
    navigate(orgId ? `/orgs/${orgId}` : "/");
  };

  return (
    <div className="max-w-lg">
      <PageTitle title="Invitation" />
      {invitation.isPending && <p className="text-muted">Loading…</p>}
      {invitation.isError && <Alert>{invitation.error.message}</Alert>}
      {invitation.data && (
        <Card>
          <p>
            <strong>{invitation.data.inviterEmail}</strong> invited you to join{" "}
            <strong>{invitation.data.organizationName}</strong> as{" "}
            <strong className="capitalize">{invitation.data.role}</strong>.
          </p>
          {error && (
            <div className="mt-3">
              <Alert>{error}</Alert>
            </div>
          )}
          <div className="mt-4 flex gap-3">
            <Button busy={busy} onClick={() => respond(true)}>
              Accept and join
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => respond(false)}>
              Decline
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
