import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { Alert, Button } from "../../components/ui";
import { authClient } from "../../lib/auth";

export function CheckEmailPage() {
  const [params] = useSearchParams();
  const email = params.get("email") ?? "";
  const [sent, setSent] = useState(false);

  const resend = async () => {
    await authClient.sendVerificationEmail({ email, callbackURL: "/" });
    setSent(true);
  };

  return (
    <div className="grid gap-4">
      <h1 className="text-xl font-semibold">Check your email</h1>
      <p className="text-sm">
        We sent a confirmation link to <strong>{email || "your email address"}</strong>. Open it to finish
        setting up your account. The link expires in 24 hours.
      </p>
      {sent && <Alert tone="success">A new link is on its way.</Alert>}
      {email && (
        <Button variant="secondary" onClick={resend}>
          Send the link again
        </Button>
      )}
      <Link to="/sign-in" className="text-sm text-brand underline">
        Back to sign in
      </Link>
    </div>
  );
}
