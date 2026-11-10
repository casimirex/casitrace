import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router";
import { Alert, Button, Card, Field, PageTitle, RoleBadge } from "../../components/ui";
import { authClient, errorMessage } from "../../lib/auth";
import { useMe } from "./queries";

const slugify = (name: string) =>
  `${
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "org"
  }-${crypto.randomUUID().slice(0, 6)}`;

export function HomePage() {
  const me = useMe();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const create = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const name = String(new FormData(e.currentTarget).get("name")).trim();
    setBusy(true);
    setError(undefined);
    const { data, error } = await authClient.organization.create({ name, slug: slugify(name) });
    setBusy(false);
    if (error || !data) return setError(errorMessage(error, "Could not create the organisation."));
    await queryClient.invalidateQueries({ queryKey: ["me"] });
    navigate(`/orgs/${data.id}`);
  };

  const memberships = me.data?.memberships ?? [];
  return (
    <>
      <PageTitle
        title={me.data ? `Welcome, ${me.data.user.name.split(" ")[0]}` : "Welcome"}
        subtitle="Your organisations. Each one keeps its products, lots and evidence separate."
      />
      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_320px]">
        <Card title="Your organisations">
          {me.isPending ? (
            <p className="text-muted">Loading…</p>
          ) : memberships.length === 0 ? (
            <p className="text-muted">
              You are not in an organisation yet. Create one, or ask a colleague to invite you.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {memberships.map((m) => (
                <li key={m.organization.id} className="flex items-center justify-between gap-4 py-2.5">
                  <Link to={`/orgs/${m.organization.id}`} className="font-medium text-brand hover:underline">
                    {m.organization.name}
                  </Link>
                  <RoleBadge role={m.role} />
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="New organisation">
          <form onSubmit={create} className="grid gap-3">
            {error && <Alert>{error}</Alert>}
            <Field
              label="Business name"
              name="name"
              required
              minLength={2}
              maxLength={120}
              placeholder="Green Valley Farm"
            />
            <Button type="submit" busy={busy}>
              Create organisation
            </Button>
            <p className="text-xs text-muted">You become its owner and can invite your team.</p>
          </form>
        </Card>
      </div>
    </>
  );
}
