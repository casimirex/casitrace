import type { components } from "@casitrace/api-client";
import { CERTIFICATE_SCHEMES, EVIDENCE_STATUSES, EVIDENCE_TYPES } from "@casitrace/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router";
import { Alert, Button, Card, Field, SelectField } from "../../components/ui";
import { api, postForm, unwrap } from "../../lib/api";
import { fieldErrors, formValues, useCan, useOrgContext } from "../masterdata/common";
import { expiryText, StatusBadge } from "./StatusBadge";

type Evidence = components["schemas"]["Evidence"];
export const typeLabel = (t: string) => (t[0]?.toUpperCase() ?? "") + t.slice(1).replaceAll("_", " ");

function UploadForm({ orgId }: { orgId: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [type, setType] = useState<string>("certificate");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const products = useQuery({
    queryKey: ["org", orgId, "products", ""],
    queryFn: async () =>
      unwrap(await api.GET("/v1/orgs/{orgId}/products", { params: { path: { orgId }, query: {} } })).items,
  });
  const locations = useQuery({
    queryKey: ["org", orgId, "locations"],
    queryFn: async () =>
      unwrap(await api.GET("/v1/orgs/{orgId}/locations", { params: { path: { orgId }, query: {} } })).items,
  });
  const upload = useMutation({
    mutationFn: (form: FormData) => postForm<Evidence>(`/v1/orgs/${orgId}/evidence`, form),
    onSuccess: async (e) => {
      // Lists of linked evidence (product, lot and location pages) must show the new upload.
      await queryClient.invalidateQueries({ queryKey: ["org", orgId, "evidence"] });
      navigate(e.id);
    },
    onError: (e) => setErrors(fieldErrors(e)),
  });

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const el = e.currentTarget;
    const v = formValues(el);
    const file = (el.elements.namedItem("file") as HTMLInputElement).files?.[0];
    if (!file) return setErrors({ file: "Choose a file" });
    const links = [
      ...(v.productId ? [{ targetType: "product", targetId: v.productId }] : []),
      ...(v.locationId ? [{ targetType: "location", targetId: v.locationId }] : []),
      ...(v.linkOrg ? [{ targetType: "organisation", targetId: orgId }] : []),
    ];
    const metadata = {
      type,
      title: v.title,
      description: v.description,
      links,
      ...(type === "certificate"
        ? {
            scheme: v.scheme,
            issuerName: v.issuerName,
            certificateNumber: v.certificateNumber,
            validFrom: v.validFrom,
            validUntil: v.validUntil,
            scope: v.scope,
          }
        : {}),
    };
    const form = new FormData();
    form.append("file", file);
    form.append("metadata", JSON.stringify(metadata));
    upload.mutate(form);
  };

  return (
    <form onSubmit={submit} className="grid gap-3">
      {upload.isError && <Alert>{upload.error.message}</Alert>}
      <div className="grid gap-1.5">
        <label htmlFor="evidence-file" className="text-sm font-medium">
          File
        </label>
        <input
          id="evidence-file"
          name="file"
          type="file"
          className="text-sm"
          accept=".pdf,.png,.jpg,.jpeg,.webp,.heic,.tif,.tiff,.docx,.xlsx,.csv,.txt"
        />
        <p className={`text-xs ${errors.file ? "text-fail" : "text-muted"}`}>
          {errors.file ?? "PDF, image, Word, Excel, CSV or text; up to 25 MB."}
        </p>
      </div>
      <SelectField
        label="Kind of evidence"
        name="type"
        value={type}
        onChange={(e) => setType(e.target.value)}
      >
        {EVIDENCE_TYPES.map((t) => (
          <option key={t} value={t}>
            {typeLabel(t)}
          </option>
        ))}
      </SelectField>
      <Field
        label="Title"
        name="title"
        required
        placeholder={type === "certificate" ? "Organic certificate 2026" : "Lab analysis lot 12"}
        error={errors.title}
      />
      {type === "certificate" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Scheme" name="scheme" list="schemes" required error={errors.scheme} />
          <datalist id="schemes">
            {CERTIFICATE_SCHEMES.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          <Field
            label="Issued by"
            name="issuerName"
            required
            placeholder="Certification body"
            error={errors.issuerName}
          />
          <Field label="Certificate number" name="certificateNumber" />
          <Field label="Scope" name="scope" placeholder="Extra virgin olive oil" />
          <Field label="Valid from" name="validFrom" type="date" error={errors.validFrom} />
          <Field label="Valid until" name="validUntil" type="date" required error={errors.validUntil} />
        </div>
      )}
      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="mb-1 text-sm font-medium">Supports</legend>
        <SelectField label="Product" name="productId" defaultValue="">
          <option value="">— none —</option>
          {products.data?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.sku} · {p.name}
            </option>
          ))}
        </SelectField>
        <SelectField label="Location" name="locationId" defaultValue="">
          <option value="">— none —</option>
          {locations.data?.map((l) => (
            <option key={l.id} value={l.id}>
              {l.code} · {l.name}
            </option>
          ))}
        </SelectField>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" name="linkOrg" /> The organisation itself
        </label>
      </fieldset>
      <Button type="submit" busy={upload.isPending} className="justify-self-start">
        Upload
      </Button>
    </form>
  );
}

export function EvidencePage() {
  const org = useOrgContext();
  const can = useCan();
  const [status, setStatus] = useState("");
  const [expiring, setExpiring] = useState(false);
  const list = useQuery({
    queryKey: ["org", org.id, "evidence", status, expiring],
    queryFn: async () =>
      unwrap(
        await api.GET("/v1/orgs/{orgId}/evidence", {
          params: {
            path: { orgId: org.id },
            query: {
              ...(status ? { status: status as (typeof EVIDENCE_STATUSES)[number] } : {}),
              ...(expiring ? { expiringWithinDays: 30 } : {}),
            },
          },
        }),
      ).items,
  });

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_440px]">
      <Card
        title="Evidence"
        actions={
          <div className="flex items-center gap-3 text-sm">
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={expiring} onChange={(e) => setExpiring(e.target.checked)} />{" "}
              Expiring in 30 days
            </label>
            <select
              aria-label="Filter by status"
              className="rounded border border-line bg-surface px-2 py-1"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="">All statuses</option>
              {EVIDENCE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        }
      >
        {list.data?.length === 0 && (
          <p className="text-muted">No evidence yet. Upload certificates, lab reports and declarations.</p>
        )}
        <ul className="divide-y divide-line" aria-label="Evidence">
          {list.data?.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <Link to={e.id} className="font-medium text-brand hover:underline">
                  {e.title}
                </Link>
                <p className="text-sm text-muted">
                  {[typeLabel(e.type), e.scheme, e.issuerName, expiryText(e.daysUntilExpiry)]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <StatusBadge status={e.status} />
            </li>
          ))}
        </ul>
      </Card>
      {can("evidence:create") && (
        <Card title="Upload evidence">
          <UploadForm orgId={org.id} />
        </Card>
      )}
    </div>
  );
}
