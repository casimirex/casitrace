import { NavLink, Outlet, useParams } from "react-router";
import { Alert, RoleBadge } from "../components/ui";
import { useOrg } from "../features/orgs/queries";

const tabs = [
  { to: "", label: "Overview", end: true },
  { to: "lots", label: "Lots" },
  { to: "record/harvest", label: "Record" },
  { to: "shipments", label: "Shipments" },
  { to: "sharing", label: "Sharing" },
  { to: "profile", label: "Profile" },
  { to: "locations", label: "Locations" },
  { to: "partners", label: "Partners" },
  { to: "products", label: "Products" },
  { to: "evidence", label: "Evidence" },
  { to: "import", label: "Import" },
];

export function OrgLayout() {
  const { orgId = "" } = useParams();
  const org = useOrg(orgId);
  if (org.isPending) return <p className="text-muted">Loading…</p>;
  if (org.isError) return <Alert>{org.error.message}</Alert>;
  return (
    <>
      <div className="mb-4 flex flex-wrap items-baseline gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{org.data.name}</h1>
        <RoleBadge role={org.data.myRole} />
      </div>
      <nav aria-label="Organisation" className="mb-6 flex gap-1 overflow-x-auto border-b border-line">
        {tabs.map((t) => (
          <NavLink
            key={t.label}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              `-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm ${isActive ? "border-brand font-medium text-ink" : "border-transparent text-muted hover:text-ink"}`
            }
          >
            {t.label}
          </NavLink>
        ))}
      </nav>
      <Outlet context={org.data} />
    </>
  );
}
