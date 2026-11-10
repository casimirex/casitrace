import type { components } from "@casitrace/api-client";
import { PARTNER_KINDS } from "@casitrace/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
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
                <p className="font-medium">{p.name}</p>
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
