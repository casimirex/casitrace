import type { components } from "@casitrace/api-client";
import { BUSINESS_ROLES } from "@casitrace/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Alert, Button, Card, Field } from "../../components/ui";
import { api, unwrap } from "../../lib/api";
import { fieldErrors, formValues, useCan, useOrgContext } from "./common";

type ProfileInput = components["schemas"]["ProfileInput"];

const STATUS_TEXT = {
  unverified: "Not verified",
  pending: "Verification requested — Casitrace staff will review it",
  verified: "Verified by Casitrace",
} as const;

export function ProfilePage() {
  const org = useOrgContext();
  const can = useCan();
  const queryClient = useQueryClient();
  const editable = can("organization:update");
  const key = ["org", org.id, "profile"];
  const profile = useQuery({
    queryKey: key,
    queryFn: async () =>
      unwrap(await api.GET("/v1/orgs/{orgId}/profile", { params: { path: { orgId: org.id } } })),
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);

  const save = useMutation({
    mutationFn: async (body: ProfileInput) =>
      unwrap(await api.PUT("/v1/orgs/{orgId}/profile", { params: { path: { orgId: org.id } }, body })),
    onSuccess: (data) => {
      queryClient.setQueryData(key, data);
      setErrors({});
      setSaved(true);
    },
    onError: (e) => setErrors(fieldErrors(e)),
  });
  const requestVerification = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST("/v1/orgs/{orgId}/profile/verification-request", {
          params: { path: { orgId: org.id } },
        }),
      ),
    onSuccess: (data) => queryClient.setQueryData(key, data),
  });

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaved(false);
    const v = formValues(e.currentTarget);
    const roles = new FormData(e.currentTarget)
      .getAll("businessRoles")
      .map(String) as ProfileInput["businessRoles"];
    save.mutate({
      legalName: v.legalName ?? "",
      registrationNumber: v.registrationNumber,
      vatNumber: v.vatNumber,
      countryCode: v.countryCode ?? "",
      addressLine1: v.addressLine1,
      addressLine2: v.addressLine2,
      city: v.city,
      postalCode: v.postalCode,
      region: v.region,
      businessRoles: roles,
      website: v.website,
      description: v.description,
      publicListing: v.publicListing === "on",
    });
  };

  if (profile.isPending) return <p className="text-muted">Loading…</p>;
  const p = profile.data;
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Card title="Business details">
        <form onSubmit={submit} className="grid gap-4">
          {save.isError && <Alert>{save.error.message}</Alert>}
          {saved && <Alert tone="success">Profile saved.</Alert>}
          <fieldset disabled={!editable} className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field
                label="Legal name"
                name="legalName"
                defaultValue={p?.legalName ?? org.name}
                required
                error={errors.legalName}
              />
            </div>
            <Field
              label="Registration number"
              name="registrationNumber"
              defaultValue={p?.registrationNumber ?? ""}
              hint="Needed for verification"
              error={errors.registrationNumber}
            />
            <Field
              label="VAT number"
              name="vatNumber"
              defaultValue={p?.vatNumber ?? ""}
              error={errors.vatNumber}
            />
            <Field
              label="Country (ISO code)"
              name="countryCode"
              defaultValue={p?.countryCode ?? ""}
              placeholder="IT"
              maxLength={2}
              required
              error={errors.countryCode}
            />
            <Field label="Region" name="region" defaultValue={p?.region ?? ""} />
            <Field label="Address" name="addressLine1" defaultValue={p?.addressLine1 ?? ""} />
            <Field label="Address line 2" name="addressLine2" defaultValue={p?.addressLine2 ?? ""} />
            <Field label="City" name="city" defaultValue={p?.city ?? ""} />
            <Field label="Postal code" name="postalCode" defaultValue={p?.postalCode ?? ""} />
            <div className="sm:col-span-2">
              <Field
                label="Website"
                name="website"
                type="url"
                defaultValue={p?.website ?? ""}
                error={errors.website}
              />
            </div>
            <fieldset className="sm:col-span-2">
              <legend className="mb-1.5 text-sm font-medium">What the business does</legend>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {BUSINESS_ROLES.map((r) => (
                  <label key={r} className="flex items-center gap-2 text-sm capitalize">
                    <input
                      type="checkbox"
                      name="businessRoles"
                      value={r}
                      defaultChecked={p?.businessRoles.includes(r)}
                    />
                    {r}
                  </label>
                ))}
              </div>
              {errors.businessRoles && <p className="mt-1 text-xs text-fail">Choose at least one.</p>}
            </fieldset>
            <label className="flex items-start gap-2 text-sm sm:col-span-2">
              <input
                type="checkbox"
                name="publicListing"
                className="mt-1"
                defaultChecked={p?.publicListing ?? false}
              />
              <span>
                List this business in the public producer directory
                <span className="block text-xs text-muted">
                  Shows name, town, region, website and description. Nothing else.
                </span>
              </span>
            </label>
          </fieldset>
          {editable && (
            <Button type="submit" busy={save.isPending} className="justify-self-start">
              Save profile
            </Button>
          )}
        </form>
      </Card>
      <Card title="Verification">
        <div className="grid gap-3 text-sm">
          <p data-testid="verification-status">{STATUS_TEXT[p?.verificationStatus ?? "unverified"]}</p>
          {p?.verificationNote && <p className="text-muted">Note: {p.verificationNote}</p>}
          <p className="text-muted">
            Verification confirms the legal business behind this organisation. It does not certify products or
            claims.
          </p>
          {requestVerification.isError && <Alert>{requestVerification.error.message}</Alert>}
          {editable && p?.verificationStatus === "unverified" && (
            <Button
              variant="secondary"
              busy={requestVerification.isPending}
              onClick={() => requestVerification.mutate()}
            >
              Request verification
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}
