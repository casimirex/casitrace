import type { components } from "@casitrace/api-client";
import { EVIDENCE_TYPES, PARTNER_KINDS } from "@casitrace/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Link } from "react-router";
import { Alert, Button, Card, Field, SelectField } from "../../components/ui";
import { api, unwrap } from "../../lib/api";
import { fieldErrors, formValues, useCan, useOrgContext } from "./common";

type PartnerInput = components["schemas"]["PartnerInput"];

export function PartnersPage() {
  const org = useOrgContext();
  const can = useCan();
  const queryClient = useQueryClient();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formKey, setFormKey] = useState(0);
  const list = useQuery({
    queryKey: ["org", org.id, "partners"],
    queryFn: async () =>
      unwrap(await api.GET("/v1/orgs/{orgId}/partners", { params: { path: { orgId: org.id }, query: {} } }))
        .items,
  });
  const create = useMutation({
    mutationFn: async (body: PartnerInput) =>
      unwrap(await api.POST("/v1/orgs/{orgId}/partners", { params: { path: { orgId: org.id } }, body })),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["org", org.id, "partners"] });
      setErrors({});
      setFormKey((k) => k + 1);
    },
    onError: (e) => setErrors(fieldErrors(e)),
  });

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const v = formValues(e.currentTarget);
    create.mutate({
      name: v.name ?? "",
      kind: (v.kind ?? "supplier") as PartnerInput["kind"],
      email: v.email,
      countryCode: v.countryCode,
      registrationNumber: v.registrationNumber,
      city: v.city,
      linkedOrgId: v.linkedOrgId,
      notes: v.notes,
    });
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <Card title="Suppliers and customers">
        {list.data?.length === 0 && <p className="text-muted">No trading partners yet.</p>}
        <ul className="divide-y divide-line" aria-label="Trading partners">
          {list.data?.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <Link to={p.id} className="font-medium text-brand hover:underline">
                  {p.name}
                </Link>
                {p.kind !== "customer" && (
                  <span className="ml-2 text-xs capitalize text-muted">{p.approvalStatus}</span>
                )}
                <p className="text-sm text-muted">
                  {[p.city, p.countryCode, p.registrationNumber].filter(Boolean).join(" · ") || "No details"}
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="rounded-full border border-line px-2 py-0.5 capitalize">{p.kind}</span>
                <span
                  className={`rounded-full px-2 py-0.5 ${p.onPlatform ? "bg-brand text-canvas" : "border border-line text-muted"}`}
                >
                  {p.onPlatform ? "On Casitrace" : "External"}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </Card>
      <SupplierRequirements orgId={org.id} canEdit={can("partner:approve")} />
      {can("partner:create") && (
        <Card title="Add a partner">
          <form key={formKey} onSubmit={submit} className="grid gap-3">
            {create.isError && <Alert>{create.error.message}</Alert>}
            <Field label="Name" name="name" required error={errors.name} />
            <SelectField label="Kind" name="kind" defaultValue="supplier">
              {PARTNER_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k === "both" ? "Supplier and customer" : k[0]?.toUpperCase() + k.slice(1)}
                </option>
              ))}
            </SelectField>
            <Field label="Email" name="email" type="email" error={errors.email} />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Country (ISO)" name="countryCode" maxLength={2} error={errors.countryCode} />
              <Field label="City" name="city" />
            </div>
            <Field label="Registration number" name="registrationNumber" />
            <Field
              label="Casitrace organisation ID"
              name="linkedOrgId"
              hint="Optional. Ask the partner for it if they use Casitrace."
              error={errors.linkedOrgId}
            />
            <Button type="submit" busy={create.isPending}>
              Add partner
            </Button>
          </form>
        </Card>
      )}
    </div>
  );
}

function SupplierRequirements({ orgId, canEdit }: { orgId: string; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const key = ["org", orgId, "supplier-requirements"];
  const list = useQuery({
    queryKey: key,
    queryFn: async () =>
      unwrap(await api.GET("/v1/orgs/{orgId}/supplier-requirements", { params: { path: { orgId } } })).items,
  });
  const [label, setLabel] = useState("");
  const [type, setType] = useState<(typeof EVIDENCE_TYPES)[number]>("certificate");
  const [scheme, setScheme] = useState("");
  const add = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST("/v1/orgs/{orgId}/supplier-requirements", {
          params: { path: { orgId } },
          body: { label, evidenceType: type, ...(scheme ? { scheme } : {}) },
        }),
      ),
    onSuccess: () => {
      setLabel("");
      setScheme("");
      void queryClient.invalidateQueries({ queryKey: key });
    },
  });
  const remove = useMutation({
    mutationFn: async (requirementId: string) =>
      unwrap(
        await api.DELETE("/v1/orgs/{orgId}/supplier-requirements/{requirementId}", {
          params: { path: { orgId, requirementId } },
        }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  });
  return (
    <Card title="Supplier requirements">
      <p className="mb-2 text-sm text-muted">
        A supplier can be approved only when each of these is present, verified and in date.
      </p>
      <ul className="divide-y divide-line text-sm" aria-label="Supplier requirements">
        {list.data?.map((r) => (
          <li key={r.id} className="flex justify-between gap-2 py-1.5">
            <span>
              {r.label}{" "}
              <span className="text-muted">
                ({r.evidenceType.replaceAll("_", " ")}
                {r.scheme ? `, ${r.scheme}` : ""})
              </span>
            </span>
            {canEdit && (
              <button type="button" className="text-muted underline" onClick={() => remove.mutate(r.id)}>
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>
      {canEdit && (
        <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_150px_120px_auto] sm:items-end">
          <Field
            label="Requirement"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Organic certificate"
          />
          <SelectField
            label="Type"
            value={type}
            onChange={(e) => setType(e.target.value as (typeof EVIDENCE_TYPES)[number])}
          >
            {EVIDENCE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replaceAll("_", " ")}
              </option>
            ))}
          </SelectField>
          <Field
            label="Scheme"
            value={scheme}
            onChange={(e) => setScheme(e.target.value)}
            placeholder="organic"
          />
          <Button variant="secondary" disabled={label.trim().length < 2} onClick={() => add.mutate()}>
            Add
          </Button>
        </div>
      )}
    </Card>
  );
}
