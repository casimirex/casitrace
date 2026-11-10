import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";
import { authClient } from "../../lib/auth";

export function RequireAuth({ children }: { children: ReactNode }) {
  const { data, isPending } = authClient.useSession();
  const location = useLocation();
  if (isPending) return <p className="p-8 text-muted">Loading…</p>;
  if (!data)
    return (
      <Navigate to={`/sign-in?next=${encodeURIComponent(location.pathname + location.search)}`} replace />
    );
  return <>{children}</>;
}
