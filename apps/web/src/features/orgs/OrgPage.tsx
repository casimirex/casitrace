import { ROLE_NAMES } from "@casitrace/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { useParams } from "react-router";
import { Alert, Button, Card, Field, RoleBadge, SelectField } from "../../components/ui";
import { api, unwrap } from "../../lib/api";
import { authClient, errorMessage } from "../../lib/auth";
import { actionLabel } from "../../lib/labels";
import { useOrg } from "./queries";

const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

function Members({ orgId, canManage }: { orgId: string; canManage: boolean }) {
  const queryClient = useQueryClient();
  const members = useQuery({
    queryKey: ["org", orgId, "members"],
    queryFn: async () => {
      const { data, error } = await authClient.organization.listMembers({ query: { organizationId: orgId } });
      if (error) throw new Error(errorMessage(error, "Could not load members."));
      return data.members;
    },
  });
  const invitations = useQuery({
    queryKey: ["org", orgId, "invitations"],
    enabled: canManage,
    queryFn: async () => {
      const { data, error } = await authClient.organization.listInvitations({
        query: { organizationId: orgId },
      });
      if (error) throw new Error(errorMessage(error, "Could not load invitations."));
      return data.filter((i) => i.status === "pending");
    },
  });
  const [error, setError] = useState<string>();
  const [sent, setSent] = useState<string>();
  const [busy, setBusy] = useState(false);

  const invite = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formEl = e.currentTarget;
    const form = new FormData(formEl);
    const email = String(form.get("email"));
    setBusy(true);
    setError(undefined);
    setSent(undefined);
    const { error } = await authClient.organization.inviteMember({
      organizationId: orgId,
      email,
      role: String(form.get("role")) as (typeof ROLE_NAMES)[number],
    });
    setBusy(false);
    if (error) return setError(errorMessage(error, "Could not send the invitation."));
    setSent(email);
    formEl.reset();
    await queryClient.invalidateQueries({ queryKey: ["org", orgId, "invitations"] });
  };

  const cancel = async (invitationId: string) => {
    await authClient.organization.cancelInvitation({ invitationId });
    await queryClient.invalidateQueries({ queryKey: ["org", orgId, "invitations"] });
  };

  return (
    <div className="grid gap-6">
      <Card title="Members">
        {members.isError && <Alert>{members.error.message}</Alert>}
        <ul className="divide-y divide-line" aria-label="Members">
          {members.data?.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-4 py-2.5">
              <div className="min-w-0">
                <p className="truncate font-medium">{m.user.name}</p>
                <p className="truncate text-sm text-muted">{m.user.email}</p>
              </div>
              <RoleBadge role={m.role} />
            </li>
          ))}
        </ul>
      </Card>
      {canManage && (
        <Card title="Invite someone">
          <form onSubmit={invite} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_160px_auto] sm:items-end">
            <Field label="Email" name="email" type="email" required />
            <SelectField label="Role" name="role" defaultValue="viewer">
              {ROLE_NAMES.filter((r) => r !== "owner").map((r) => (
                <option key={r} value={r}>
                  {r[0]?.toUpperCase() + r.slice(1)}
                </option>
              ))}
            </SelectField>
            <Button type="submit" busy={busy}>
              Send invitation
            </Button>
          </form>
          <div className="mt-3 grid gap-2">
            {error && <Alert>{error}</Alert>}
            {sent && <Alert tone="success">Invitation sent to {sent}.</Alert>}
          </div>
          {invitations.data && invitations.data.length > 0 && (
            <>
              <h3 className="mt-5 mb-2 text-sm font-semibold">Pending invitations</h3>
              <ul className="divide-y divide-line" aria-label="Pending invitations">
                {invitations.data.map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-4 py-2 text-sm">
                    <span className="min-w-0 truncate">
                      {i.email} · <span className="capitalize">{i.role}</span>
                    </span>
                    <Button variant="secondary" onClick={() => cancel(i.id)}>
                      Cancel
                    </Button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      )}
    </div>
  );
}

function AuditLog({ orgId }: { orgId: string }) {
  const log = useQuery({
    queryKey: ["org", orgId, "audit"],
    queryFn: async () =>
      unwrap(
        await api.GET("/v1/orgs/{orgId}/audit-log", { params: { path: { orgId }, query: { limit: 50 } } }),
      ),
  });
  return (
    <Card title="Recent activity">
      {log.isError && <Alert>{log.error.message}</Alert>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted">
              <th className="py-2 pr-4 font-medium">When</th>
              <th className="py-2 pr-4 font-medium">What happened</th>
              <th className="py-2 font-medium">Who</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {log.data?.items.map((e) => (
              <tr key={e.id}>
                <td className="py-2 pr-4 whitespace-nowrap tabular-nums">
                  {dateTime.format(new Date(e.occurredAt))}
                </td>
                <td className="py-2 pr-4">{actionLabel(e.action)}</td>
                <td className="py-2 text-muted">{e.actorName}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export function OrgPage() {
  const { orgId = "" } = useParams();
  const org = useOrg(orgId);
  if (org.isPending) return <p className="text-muted">Loading…</p>;
  if (org.isError) return <Alert>{org.error.message}</Alert>;
  const perms = new Set(org.data.myPermissions);
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Members orgId={orgId} canManage={perms.has("invitation:create")} />
      {perms.has("audit:read") && <AuditLog orgId={orgId} />}
    </div>
  );
}
