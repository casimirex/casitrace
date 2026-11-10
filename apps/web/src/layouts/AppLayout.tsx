import { useQueryClient } from "@tanstack/react-query";
import { NavLink, Outlet, useMatch, useNavigate } from "react-router";
import { useMe } from "../features/orgs/queries";
import { authClient } from "../lib/auth";

const navClass = ({ isActive }: { isActive: boolean }) =>
  isActive ? "font-medium text-brand" : "text-muted hover:text-ink";

export function AppLayout() {
  const me = useMe();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const orgMatch = useMatch("/orgs/:orgId/*");
  const currentOrg = orgMatch?.params.orgId ?? "";

  const signOut = async () => {
    await authClient.signOut();
    queryClient.clear();
    navigate("/sign-in");
  };

  return (
    <div className="min-h-dvh">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <NavLink to="/" className="font-semibold tracking-tight">
            Casitrace
          </NavLink>
          {me.data && me.data.memberships.length > 0 && (
            <label className="flex items-center gap-2 text-sm">
              <span className="sr-only">Organisation</span>
              <select
                aria-label="Switch organisation"
                className="max-w-56 rounded border border-line bg-surface px-2 py-1 text-sm"
                value={currentOrg}
                onChange={(e) => navigate(e.target.value ? `/orgs/${e.target.value}` : "/")}
              >
                <option value="">All organisations</option>
                {me.data.memberships.map((m) => (
                  <option key={m.organization.id} value={m.organization.id}>
                    {m.organization.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <nav aria-label="Main" className="ml-auto flex items-center gap-4 text-sm">
            <NavLink to="/account" className={navClass}>
              {me.data?.user.name ?? "Account"}
            </NavLink>
            <NavLink to="/status" className={navClass}>
              Status
            </NavLink>
            <button type="button" onClick={signOut} className="text-muted hover:text-ink">
              Sign out
            </button>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
