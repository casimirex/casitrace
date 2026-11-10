import { type FormEvent, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Alert, Button, Field } from "../../components/ui";
import { authClient, errorMessage } from "../../lib/auth";

export const safeNext = (next: string | null) =>
  next?.startsWith("/") && !next.startsWith("//") ? next : "/";

export function SignInPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email"));
    setBusy(true);
    setError(undefined);
    const { data, error } = await authClient.signIn.email({ email, password: String(form.get("password")) });
    setBusy(false);
    if (error) {
      if (error.status === 403) return navigate(`/check-email?email=${encodeURIComponent(email)}`);
      return setError(errorMessage(error, "Email or password is incorrect."));
    }
    if (data && "twoFactorRedirect" in data && data.twoFactorRedirect) return; // handled by the client plugin
    navigate(safeNext(params.get("next")));
  };

  return (
    <form onSubmit={submit} className="grid gap-4">
      <h1 className="text-xl font-semibold">Sign in</h1>
      {error && <Alert>{error}</Alert>}
      <Field label="Email" name="email" type="email" autoComplete="email" required />
      <Field label="Password" name="password" type="password" autoComplete="current-password" required />
      <Button type="submit" busy={busy}>
        Sign in
      </Button>
      <div className="flex justify-between text-sm">
        <Link to="/forgot-password" className="text-brand underline">
          Forgot password?
        </Link>
        <Link to="/sign-up" className="text-brand underline">
          Create account
        </Link>
      </div>
    </form>
  );
}

export function TwoFactorPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [useBackup, setUseBackup] = useState(false);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const code = String(new FormData(e.currentTarget).get("code")).trim();
    setBusy(true);
    setError(undefined);
    const { error } = useBackup
      ? await authClient.twoFactor.verifyBackupCode({ code })
      : await authClient.twoFactor.verifyTotp({ code });
    setBusy(false);
    if (error) return setError(errorMessage(error, "That code is not valid."));
    navigate(safeNext(params.get("next")));
  };

  return (
    <form onSubmit={submit} className="grid gap-4">
      <h1 className="text-xl font-semibold">Two-factor check</h1>
      <p className="text-sm text-muted">
        {useBackup
          ? "Enter one of your backup codes."
          : "Enter the 6-digit code from your authenticator app."}
      </p>
      {error && <Alert>{error}</Alert>}
      <Field
        label={useBackup ? "Backup code" : "Code"}
        name="code"
        autoComplete="one-time-code"
        inputMode={useBackup ? "text" : "numeric"}
        required
      />
      <Button type="submit" busy={busy}>
        Verify
      </Button>
      <button
        type="button"
        className="text-left text-sm text-brand underline"
        onClick={() => setUseBackup(!useBackup)}
      >
        {useBackup ? "Use the authenticator app instead" : "Use a backup code"}
      </button>
    </form>
  );
}
