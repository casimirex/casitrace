import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router";
import { Alert, Button, Card, Field, PageTitle } from "../../components/ui";
import { api, unwrap } from "../../lib/api";
import { authClient, errorMessage } from "../../lib/auth";
import { useMe } from "../orgs/queries";

function TwoFactor({ enabled }: { enabled: boolean }) {
  const queryClient = useQueryClient();
  const [setup, setSetup] = useState<{ totpURI: string; backupCodes: string[] }>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const start = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    const { data, error } = await authClient.twoFactor.enable({
      password: String(new FormData(e.currentTarget).get("password")),
    });
    setBusy(false);
    if (error || !data || !("totpURI" in data))
      return setError(errorMessage(error, "Could not start two-factor setup."));
    setSetup(data);
  };

  const confirm = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    const { error } = await authClient.twoFactor.verifyTotp({
      code: String(new FormData(e.currentTarget).get("code")).trim(),
    });
    setBusy(false);
    if (error) return setError(errorMessage(error, "That code is not valid."));
    setSetup(undefined);
    await queryClient.invalidateQueries({ queryKey: ["me"] });
  };

  const disable = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await authClient.twoFactor.disable({
      password: String(new FormData(e.currentTarget).get("password")),
    });
    setBusy(false);
    if (error) return setError(errorMessage(error, "Could not turn off two-factor."));
    await queryClient.invalidateQueries({ queryKey: ["me"] });
  };

  const secret = setup ? new URL(setup.totpURI).searchParams.get("secret") : null;
  return (
    <Card title="Two-factor authentication">
      <div className="grid gap-3">
        {error && <Alert>{error}</Alert>}
        {enabled ? (
          <form onSubmit={disable} className="grid gap-3">
            <Alert tone="success">Two-factor authentication is on.</Alert>
            <Field
              label="Password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
            <Button variant="danger" type="submit" busy={busy}>
              Turn off two-factor
            </Button>
          </form>
        ) : setup ? (
          <form onSubmit={confirm} className="grid gap-3">
            <p className="text-sm">
              Add this key to your authenticator app, then enter the 6-digit code it shows.
            </p>
            <code
              className="block break-all rounded bg-canvas p-2 font-mono text-sm"
              data-testid="totp-secret"
            >
              {secret}
            </code>
            <a href={setup.totpURI} className="text-sm text-brand underline">
              Open in authenticator app
            </a>
            <details className="text-sm">
              <summary className="cursor-pointer">Backup codes (store them somewhere safe)</summary>
              <ul className="mt-2 grid grid-cols-2 gap-1 font-mono">
                {setup.backupCodes.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </details>
            <Field label="Code" name="code" inputMode="numeric" autoComplete="one-time-code" required />
            <Button type="submit" busy={busy}>
              Confirm and turn on
            </Button>
          </form>
        ) : (
          <form onSubmit={start} className="grid gap-3">
            <p className="text-sm text-muted">
              Protect your account with a code from an authenticator app at sign-in.
            </p>
            <Field
              label="Password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
            <Button type="submit" busy={busy}>
              Set up two-factor
            </Button>
          </form>
        )}
      </div>
    </Card>
  );
}

function YourData() {
  const navigate = useNavigate();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const download = async () => {
    const data = unwrap(await api.GET("/v1/me/export"));
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: "casitrace-account.json" });
    a.click();
    URL.revokeObjectURL(url);
  };

  const remove = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    const { error } = await authClient.deleteUser({
      password: String(new FormData(e.currentTarget).get("password")),
    });
    setBusy(false);
    if (error) return setError(errorMessage(error, "Could not delete the account."));
    navigate("/sign-in");
  };

  return (
    <Card title="Your data">
      <div className="grid gap-4">
        <div className="grid gap-2">
          <p className="text-sm text-muted">Download everything Casitrace holds about you as a JSON file.</p>
          <Button variant="secondary" onClick={download}>
            Download my data
          </Button>
        </div>
        <form onSubmit={remove} className="grid gap-2 border-t border-line pt-4">
          <p className="text-sm">
            Delete your account. Organisation records you created stay with the organisation. If you are the
            only owner of an organisation, transfer ownership first.
          </p>
          {error && <Alert>{error}</Alert>}
          <Field label="Password" name="password" type="password" autoComplete="current-password" required />
          <Button variant="danger" type="submit" busy={busy}>
            Delete my account
          </Button>
        </form>
      </div>
    </Card>
  );
}

export function AccountPage() {
  const me = useMe();
  if (!me.data) return <p className="text-muted">Loading…</p>;
  return (
    <>
      <PageTitle title="Account" subtitle={`${me.data.user.name} · ${me.data.user.email}`} />
      <div className="grid gap-6 lg:grid-cols-2">
        <TwoFactor enabled={me.data.user.twoFactorEnabled} />
        <YourData />
      </div>
    </>
  );
}
