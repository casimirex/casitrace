import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router";
import { Alert, Button, Field } from "../../components/ui";
import { authClient, errorMessage } from "../../lib/auth";

export function SignUpPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email"));
    setBusy(true);
    setError(undefined);
    const { error } = await authClient.signUp.email({
      name: String(form.get("name")),
      email,
      password: String(form.get("password")),
      callbackURL: "/",
    });
    setBusy(false);
    if (error) return setError(errorMessage(error, "Could not create the account."));
    navigate(`/check-email?email=${encodeURIComponent(email)}`);
  };

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate={false}>
      <h1 className="text-xl font-semibold">Create your account</h1>
      {error && <Alert>{error}</Alert>}
      <Field label="Full name" name="name" autoComplete="name" required />
      <Field label="Work email" name="email" type="email" autoComplete="email" required />
      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete="new-password"
        minLength={12}
        required
        hint="At least 12 characters. A short phrase works well."
      />
      <Button type="submit" busy={busy}>
        Create account
      </Button>
      <p className="text-sm text-muted">
        Already registered?{" "}
        <Link to="/sign-in" className="text-brand underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}
