import { type FormEvent, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { Alert, Button, Field } from "../../components/ui";
import { authClient, errorMessage } from "../../lib/auth";

export function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    await authClient.requestPasswordReset({
      email: String(new FormData(e.currentTarget).get("email")),
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setBusy(false);
    setSent(true);
  };

  if (sent) {
    return (
      <div className="grid gap-4">
        <h1 className="text-xl font-semibold">Check your email</h1>
        <p className="text-sm">
          If an account exists for that address, a reset link is on its way. It expires in 30 minutes.
        </p>
        <Link to="/sign-in" className="text-sm text-brand underline">
          Back to sign in
        </Link>
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="grid gap-4">
      <h1 className="text-xl font-semibold">Reset your password</h1>
      <Field label="Email" name="email" type="email" autoComplete="email" required />
      <Button type="submit" busy={busy}>
        Send reset link
      </Button>
      <Link to="/sign-in" className="text-sm text-brand underline">
        Back to sign in
      </Link>
    </form>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const [error, setError] = useState<string>();
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!token || params.get("error")) {
    return (
      <div className="grid gap-4">
        <Alert>This reset link is invalid or has expired.</Alert>
        <Link to="/forgot-password" className="text-sm text-brand underline">
          Request a new link
        </Link>
      </div>
    );
  }

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    const { error } = await authClient.resetPassword({
      token,
      newPassword: String(new FormData(e.currentTarget).get("password")),
    });
    setBusy(false);
    if (error) return setError(errorMessage(error, "Could not reset the password."));
    setDone(true);
  };

  if (done) {
    return (
      <div className="grid gap-4">
        <Alert tone="success">Password changed. You were signed out everywhere else.</Alert>
        <Link to="/sign-in" className="text-sm text-brand underline">
          Sign in
        </Link>
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="grid gap-4">
      <h1 className="text-xl font-semibold">Choose a new password</h1>
      {error && <Alert>{error}</Alert>}
      <Field
        label="New password"
        name="password"
        type="password"
        autoComplete="new-password"
        minLength={12}
        required
        hint="At least 12 characters."
      />
      <Button type="submit" busy={busy}>
        Save password
      </Button>
    </form>
  );
}
