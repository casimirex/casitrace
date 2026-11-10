import type { components } from "@casitrace/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Alert, Button, Card } from "../../components/ui";
import { api, unwrap } from "../../lib/api";
import { LinkedEvidence } from "../evidence/EvidenceDetailPage";
import { fieldErrors, useCan, useOrgContext } from "./common";
import { categoryLabel, ProductForm } from "./ProductForm";

type CreateInput = components["schemas"]["ProductCreateInput"];
type VersionInput = components["schemas"]["ProductVersionInput"];
const date = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

export function ProductsPage() {
  const org = useOrgContext();
  const can = useCan();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const list = useQuery({
    queryKey: ["org", org.id, "products", q],
    queryFn: async () =>
      unwrap(
        await api.GET("/v1/orgs/{orgId}/products", {
          params: { path: { orgId: org.id }, query: q ? { q } : {} },
        }),
      ).items,
  });
  const create = useMutation({
    mutationFn: async (body: CreateInput) =>
      unwrap(await api.POST("/v1/orgs/{orgId}/products", { params: { path: { orgId: org.id } }, body })),
    onSuccess: async (p) => {
      // Product lists elsewhere (evidence links, imports) must see the new product.
      await queryClient.invalidateQueries({ queryKey: ["org", org.id, "products"] });
      navigate(p.id);
    },
    onError: (e) => setErrors(fieldErrors(e)),
  });

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_460px]">
      <Card
        title="Products"
        actions={
          <input
            type="search"
            aria-label="Search products"
            placeholder="Search name or SKU"
            className="w-48 rounded border border-line bg-surface px-2 py-1 text-sm"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        }
      >
        {list.data?.length === 0 && <p className="text-muted">No products yet.</p>}
        <div className="overflow-x-auto">
          <table className="w-full text-sm" aria-label="Products">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted">
                <th className="py-2 pr-3 font-medium">SKU</th>
                <th className="py-2 pr-3 font-medium">Name</th>
                <th className="py-2 pr-3 font-medium">Category</th>
                <th className="py-2 pr-3 font-medium">GTIN</th>
                <th className="py-2 text-right font-medium">Version</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {list.data?.map((p) => (
                <tr key={p.id}>
                  <td className="py-2 pr-3 font-mono text-xs">{p.sku}</td>
                  <td className="py-2 pr-3">
                    <Link to={p.id} className="text-brand hover:underline">
                      {p.name}
                    </Link>
                  </td>
                  <td className="py-2 pr-3">{categoryLabel(p.category)}</td>
                  <td className="py-2 pr-3 font-mono text-xs">{p.gtin ?? "—"}</td>
                  <td className="py-2 text-right tabular-nums">v{p.currentVersion}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {can("product:create") && (
        <Card title="New product">
          <ProductForm
            withSku
            busy={create.isPending}
            error={create.isError ? create.error.message : undefined}
            fieldErrors={errors}
            submitLabel="Create product"
            onSubmit={(input) => create.mutate(input as CreateInput)}
          />
        </Card>
      )}
    </div>
  );
}

export function ProductDetailPage() {
  const org = useOrgContext();
  const can = useCan();
  const { productId = "" } = useParams();
  const queryClient = useQueryClient();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string>();
  const params = { params: { path: { orgId: org.id, productId } } };
  const product = useQuery({
    queryKey: ["org", org.id, "product", productId],
    queryFn: async () => unwrap(await api.GET("/v1/orgs/{orgId}/products/{productId}", params)),
  });
  const history = useQuery({
    queryKey: ["org", org.id, "product", productId, "versions"],
    queryFn: async () =>
      unwrap(await api.GET("/v1/orgs/{orgId}/products/{productId}/versions", params)).items,
  });
  const revise = useMutation({
    mutationFn: async (body: VersionInput) =>
      unwrap(await api.POST("/v1/orgs/{orgId}/products/{productId}/versions", { ...params, body })),
    onSuccess: async (r) => {
      setErrors({});
      setNotice(
        r.changed
          ? `Saved as version ${r.product.currentVersion}.`
          : "Nothing changed, so no new version was created.",
      );
      await queryClient.invalidateQueries({ queryKey: ["org", org.id, "product", productId] });
    },
    onError: (e) => setErrors(fieldErrors(e)),
  });

  if (product.isPending) return <p className="text-muted">Loading…</p>;
  if (product.isError) return <Alert>{product.error.message}</Alert>;
  const p = product.data;
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_460px]">
      <div className="grid content-start gap-6">
        <Card title={`${p.current.name}`}>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1.5 text-sm">
            <dt className="text-muted">SKU</dt>
            <dd className="font-mono">{p.sku}</dd>
            <dt className="text-muted">Category</dt>
            <dd>{categoryLabel(p.current.category)}</dd>
            <dt className="text-muted">Counted in</dt>
            <dd>{p.current.uomCode}</dd>
            <dt className="text-muted">GTIN</dt>
            <dd className="font-mono">{p.current.gtin ?? "—"}</dd>
            <dt className="text-muted">Origin</dt>
            <dd>{[p.current.originRegion, p.current.originCountry].filter(Boolean).join(", ") || "—"}</dd>
            <dt className="text-muted">Attributes</dt>
            <dd className="font-mono text-xs">{JSON.stringify(p.current.attributes)}</dd>
            <dt className="text-muted">Conversions</dt>
            <dd>
              {p.current.conversions.map((c) => `1 ${c.fromUom} = ${c.factor} ${c.toUom}`).join(" · ") || "—"}
            </dd>
            <dt className="text-muted">Current version</dt>
            <dd>v{p.currentVersion}</dd>
          </dl>
        </Card>
        <LinkedEvidence orgId={org.id} targetType="product" targetId={p.id} />
        <Card title="Version history">
          <p className="mb-3 text-sm text-muted">
            Versions never change once saved. Lots record the version they were made with.
          </p>
          <ol className="divide-y divide-line text-sm" aria-label="Versions">
            {history.data?.map((v) => (
              <li key={v.id} className="flex flex-wrap justify-between gap-2 py-2">
                <span>
                  <strong>v{v.version}</strong> · {v.name}
                  {v.changeNote && <span className="text-muted"> — {v.changeNote}</span>}
                </span>
                <span className="tabular-nums text-muted">{date.format(new Date(v.createdAt))}</span>
              </li>
            ))}
          </ol>
        </Card>
      </div>
      {can("product:update") && !p.archivedAt && (
        <Card title="Change product">
          {notice && (
            <div className="mb-3">
              <Alert tone="success">{notice}</Alert>
            </div>
          )}
          <ProductForm
            key={p.currentVersion}
            initial={p.current}
            withSku={false}
            busy={revise.isPending}
            error={revise.isError ? revise.error.message : undefined}
            fieldErrors={errors}
            submitLabel="Save as new version"
            onSubmit={(input) => revise.mutate(input)}
          />
          {can("product:archive") && (
            <div className="mt-4 border-t border-line pt-4">
              <Button
                variant="danger"
                onClick={async () => {
                  unwrap(await api.POST("/v1/orgs/{orgId}/products/{productId}/archive", params));
                  await queryClient.invalidateQueries({ queryKey: ["org", org.id] });
                }}
              >
                Archive product
              </Button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
