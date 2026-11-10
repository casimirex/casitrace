import type { components } from "@casitrace/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router";
import { Alert, Button, Card } from "../../components/ui";
import { api, unwrap } from "../../lib/api";
import { useCan, useOrgContext } from "../masterdata/common";

type Disclosure = components["schemas"]["Disclosure"];
const OPTIONS: { key: keyof Disclosure; label: string; hint: string }[] = [
  { key: "producerAddress", label: "Producer town and region", hint: "Your city, region and country" },
  { key: "harvestDates", label: "Dates", hint: "Harvest period, milling and other step dates" },
  {
    key: "processDetails",
    label: "Process details",
    hint: "Extraction method and whether it was cold extracted",
  },
  {
    key: "originArea",
    label: "Origin area",
    hint: "Region and coordinates rounded to about 10 km, never the exact plot",
  },
  {
    key: "certificates",
    label: "Certificates",
    hint: "Title, scheme, issuer, validity and status of linked certificates",
  },
  {
    key: "supplierNames",
    label: "Supplier names",
    hint: "Names of other organisations in the chain (off by default)",
  },
];
const when = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

export function PassportsPage() {
  const org = useOrgContext();
  const list = useQuery({
    queryKey: ["org", org.id, "passports"],
    queryFn: async () =>
      unwrap(await api.GET("/v1/orgs/{orgId}/passports", { params: { path: { orgId: org.id } } })).items,
  });
  return (
    <Card title="Public pages">
      <p className="mb-3 text-sm text-muted">
        Create a public page from a lot or a product page. Consumers reach it by scanning the QR code on the
        label.
      </p>
      {list.data?.length === 0 && <p className="text-muted">No public pages yet.</p>}
      <ul className="divide-y divide-line" aria-label="Public pages">
        {list.data?.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
            <Link to={p.id} className="font-medium text-brand hover:underline">
              {p.product.name}
              {p.lot ? ` · lot ${p.lot.lotCode}` : ""}
            </Link>
            <span className="capitalize text-muted">
              {p.status}
              {p.currentVersion ? ` · v${p.currentVersion}` : ""}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** "Create public page" for a lot or product; opens the new draft. */
export function CreatePassportButton({ scope, id }: { scope: "lot" | "product"; id: string }) {
  const org = useOrgContext();
  const can = useCan();
  const navigate = useNavigate();
  const create = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST("/v1/orgs/{orgId}/passports", {
          params: { path: { orgId: org.id } },
          body: scope === "lot" ? { scope, lotId: id } : { scope, productId: id },
        }),
      ),
    onSuccess: (p) => navigate(`/orgs/${org.id}/passports/${p.id}`),
  });
  if (!can("passport:publish")) return null;
  return (
    <div className="grid gap-1">
      <Button variant="secondary" busy={create.isPending} onClick={() => create.mutate()}>
        Create public page
      </Button>
      {create.isError && <Alert>{create.error.message}</Alert>}
    </div>
  );
}

export function PassportDetailPage() {
  const org = useOrgContext();
  const can = useCan();
  const { passportId = "" } = useParams();
  const queryClient = useQueryClient();
  const params = { params: { path: { orgId: org.id, passportId } } };
  const key = ["org", org.id, "passports", passportId];
  const passport = useQuery({
    queryKey: key,
    queryFn: async () => unwrap(await api.GET("/v1/orgs/{orgId}/passports/{passportId}", params)),
  });
  const preview = useQuery({
    queryKey: [...key, "preview"],
    queryFn: async () => unwrap(await api.GET("/v1/orgs/{orgId}/passports/{passportId}/preview", params)),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: key });
  const setDisclosure = useMutation({
    mutationFn: async (d: Disclosure) =>
      unwrap(await api.PUT("/v1/orgs/{orgId}/passports/{passportId}/disclosure", { ...params, body: d })),
    onSuccess: refresh,
  });
  const publish = useMutation({
    mutationFn: async () => unwrap(await api.POST("/v1/orgs/{orgId}/passports/{passportId}/publish", params)),
    onSuccess: refresh,
  });
  const withdraw = useMutation({
    mutationFn: async () =>
      unwrap(await api.POST("/v1/orgs/{orgId}/passports/{passportId}/withdraw", params)),
    onSuccess: refresh,
  });
  if (!passport.data) return <p className="text-muted">Loading…</p>;
  const p = passport.data;
  const s = preview.data;
  const qrUrl = `/api/v1/orgs/${org.id}/passports/${p.id}/qr.svg`;
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="grid content-start gap-6">
        <Card
          title={`${p.product.name}${p.lot ? ` · lot ${p.lot.lotCode}` : ""}`}
          actions={
            <span className="text-sm capitalize text-muted" data-testid="passport-status">
              {p.status}
            </span>
          }
        >
          <fieldset disabled={!can("passport:publish")} className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">What the public page may show</legend>
            {OPTIONS.map((o) => (
              <label key={o.key} className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={p.disclosure[o.key]}
                  onChange={(e) => setDisclosure.mutate({ ...p.disclosure, [o.key]: e.target.checked })}
                />
                <span>
                  {o.label}
                  <span className="block text-xs text-muted">{o.hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <p className="mt-3 text-xs text-muted">
            Never public: quantities, prices, customers, internal notes, contact details, registration numbers
            and documents other than certificates.
          </p>
          {can("passport:publish") && (
            <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-3">
              <Button busy={publish.isPending} onClick={() => publish.mutate()}>
                {p.currentVersion ? `Publish version ${p.currentVersion + 1}` : "Publish"}
              </Button>
              {p.status === "published" && (
                <Button variant="danger" onClick={() => withdraw.mutate()}>
                  Withdraw page
                </Button>
              )}
            </div>
          )}
          {(publish.isError || withdraw.isError || setDisclosure.isError) && (
            <Alert>{(publish.error ?? withdraw.error ?? setDisclosure.error)?.message}</Alert>
          )}
        </Card>
        <Card title="Preview of the next version">
          {preview.isError && <Alert>{preview.error.message}</Alert>}
          {s && (
            <dl
              className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm"
              data-testid="passport-preview"
            >
              <dt className="text-muted">Producer</dt>
              <dd>{[s.producer.name, s.producer.city, s.producer.region].filter(Boolean).join(", ")}</dd>
              {s.lot?.harvest && (
                <>
                  <dt className="text-muted">Harvest</dt>
                  <dd>
                    {s.lot.harvest.from} – {s.lot.harvest.to}
                  </dd>
                </>
              )}
              {s.lot?.milling && (
                <>
                  <dt className="text-muted">Milling</dt>
                  <dd>
                    {[
                      s.lot.milling.date,
                      s.lot.milling.extractionMethod,
                      s.lot.milling.coldExtracted ? "cold extracted" : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </dd>
                </>
              )}
              <dt className="text-muted">Journey</dt>
              <dd>{s.journey.map((j) => j.step).join(" → ") || "—"}</dd>
              <dt className="text-muted">Certificates</dt>
              <dd>{s.certificates.map((c) => `${c.title} (${c.statusAtPublication})`).join(", ") || "—"}</dd>
            </dl>
          )}
        </Card>
      </div>
      <div className="grid content-start gap-6">
        <Card title="QR code">
          {p.currentVersion > 0 ? (
            <div className="grid gap-2 text-sm">
              <img
                src={qrUrl}
                alt={`QR code linking to ${p.qrPayload}`}
                className="w-full max-w-60 bg-white p-2"
              />
              <code className="break-all font-mono text-xs" data-testid="qr-payload">
                {p.qrPayload}
              </code>
              <a href={qrUrl} download={`qr-${p.publicId}.svg`} className="text-brand underline">
                Download QR (SVG, for print)
              </a>
              <a href={p.publicUrl} target="_blank" rel="noopener" className="text-brand underline">
                Open the public page
              </a>
            </div>
          ) : (
            <p className="text-sm text-muted">Publish first; the QR code then never changes.</p>
          )}
        </Card>
        <Card title="Versions">
          <ol className="grid gap-1 text-sm" aria-label="Versions">
            {p.versions.map((v) => (
              <li key={v.version}>
                v{v.version} · {when.format(new Date(v.publishedAt))}{" "}
                <code className="font-mono text-xs text-muted">{v.digest.slice(0, 12)}…</code>
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </div>
  );
}
