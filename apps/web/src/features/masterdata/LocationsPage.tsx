import type { components } from "@casitrace/api-client";
import { LOCATION_TYPES } from "@casitrace/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Alert, Button, Card, Field, SelectField } from "../../components/ui";
import { api, unwrap } from "../../lib/api";
import { fieldErrors, fmtHa, formValues, numberOrNull, useCan, useOrgContext } from "./common";

const useLocations = (orgId: string) =>
  useQuery({
    queryKey: ["org", orgId, "locations"],
    queryFn: async () =>
      unwrap(await api.GET("/v1/orgs/{orgId}/locations", { params: { path: { orgId }, query: {} } })).items,
  });
type Location = NonNullable<ReturnType<typeof useLocations>["data"]>[number];
type LocationInput = components["schemas"]["LocationInput"];

function LocationForm({
  orgId,
  all,
  editing,
  onDone,
}: {
  orgId: string;
  all: Location[];
  editing: Location | null;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: async (body: LocationInput) =>
      editing
        ? unwrap(
            await api.PUT("/v1/orgs/{orgId}/locations/{locationId}", {
              params: { path: { orgId, locationId: editing.id } },
              body,
            }),
          )
        : unwrap(await api.POST("/v1/orgs/{orgId}/locations", { params: { path: { orgId } }, body })),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["org", orgId, "locations"] });
      setErrors({});
      onDone();
    },
    onError: (e) => setErrors(fieldErrors(e)),
  });

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const v = formValues(e.currentTarget);
    let boundary: LocationInput["boundary"] = null;
    if (v.boundary) {
      try {
        boundary = JSON.parse(v.boundary);
      } catch {
        return setErrors({ boundary: "Not valid JSON. Paste a GeoJSON Polygon or MultiPolygon." });
      }
    }
    save.mutate({
      code: v.code ?? "",
      name: v.name ?? "",
      type: (v.type ?? "other") as LocationInput["type"],
      parentId: v.parentId,
      gln: v.gln,
      countryCode: v.countryCode,
      addressLine1: v.addressLine1,
      city: v.city,
      postalCode: v.postalCode,
      region: v.region,
      latitude: numberOrNull(v.latitude ?? null),
      longitude: numberOrNull(v.longitude ?? null),
      boundary,
    });
  };

  const boundaryError = Object.entries(errors).find(([k]) => k.startsWith("boundary"))?.[1];
  return (
    <form key={editing?.id ?? "new"} onSubmit={submit} className="grid gap-3">
      {save.isError && <Alert>{save.error.message}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Code"
          name="code"
          defaultValue={editing?.code}
          required
          placeholder="PLOT-N-01"
          error={errors.code}
        />
        <Field label="Name" name="name" defaultValue={editing?.name} required error={errors.name} />
        <SelectField label="Type" name="type" defaultValue={editing?.type ?? "plot"}>
          {LOCATION_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </SelectField>
        <SelectField label="Inside" name="parentId" defaultValue={editing?.parentId ?? ""}>
          <option value="">— none —</option>
          {all
            .filter((l) => l.id !== editing?.id && !l.archivedAt)
            .map((l) => (
              <option key={l.id} value={l.id}>
                {l.code} · {l.name}
              </option>
            ))}
        </SelectField>
        <Field
          label="Country (ISO)"
          name="countryCode"
          defaultValue={editing?.countryCode ?? ""}
          maxLength={2}
          error={errors.countryCode}
        />
        <Field label="GLN" name="gln" defaultValue={editing?.gln ?? ""} error={errors.gln} />
        <Field label="Address" name="addressLine1" defaultValue={editing?.addressLine1 ?? ""} />
        <Field label="City" name="city" defaultValue={editing?.city ?? ""} />
        <Field
          label="Latitude"
          name="latitude"
          inputMode="decimal"
          defaultValue={editing?.latitude ?? ""}
          error={errors.latitude}
        />
        <Field
          label="Longitude"
          name="longitude"
          inputMode="decimal"
          defaultValue={editing?.longitude ?? ""}
          error={errors.longitude}
        />
      </div>
      <div className="grid gap-1.5">
        <label htmlFor="boundary" className="text-sm font-medium">
          Boundary (GeoJSON)
        </label>
        <textarea
          id="boundary"
          name="boundary"
          rows={4}
          defaultValue={editing?.boundary ? JSON.stringify(editing.boundary) : ""}
          placeholder='{"type":"Polygon","coordinates":[[[16.287,41.233],[16.290,41.233],[16.290,41.2345],[16.287,41.2345],[16.287,41.233]]]}'
          className="w-full rounded border border-line bg-surface px-3 py-2 font-mono text-xs"
        />
        <p className={`text-xs ${boundaryError ? "text-fail" : "text-muted"}`}>
          {boundaryError ?? "Optional. Plot outline as [longitude, latitude] points; the area is calculated."}
        </p>
      </div>
      <div className="flex gap-3">
        <Button type="submit" busy={save.isPending}>
          {editing ? "Save location" : "Add location"}
        </Button>
        {editing && (
          <Button type="button" variant="secondary" onClick={onDone}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

export function LocationsPage() {
  const org = useOrgContext();
  const can = useCan();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Location | null>(null);
  const list = useLocations(org.id);
  const archive = useMutation({
    mutationFn: async (id: string) =>
      unwrap(
        await api.POST("/v1/orgs/{orgId}/locations/{locationId}/archive", {
          params: { path: { orgId: org.id, locationId: id } },
        }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["org", org.id, "locations"] }),
  });
  const byId = new Map((list.data ?? []).map((l) => [l.id, l]));

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
      <Card title="Locations">
        {archive.isError && <Alert>{archive.error.message}</Alert>}
        {list.data?.length === 0 && (
          <p className="text-muted">No locations yet. Add farms, plots, mills and stores, or import a CSV.</p>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm" aria-label="Locations">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted">
                <th className="py-2 pr-3 font-medium">Code</th>
                <th className="py-2 pr-3 font-medium">Name</th>
                <th className="py-2 pr-3 font-medium">Type</th>
                <th className="py-2 pr-3 font-medium">Inside</th>
                <th className="py-2 pr-3 text-right font-medium">Area</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {list.data?.map((l) => (
                <tr key={l.id}>
                  <td className="py-2 pr-3 font-mono text-xs">{l.code}</td>
                  <td className="py-2 pr-3">{l.name}</td>
                  <td className="py-2 pr-3 capitalize">{l.type}</td>
                  <td className="py-2 pr-3 text-muted">
                    {l.parentId ? (byId.get(l.parentId)?.code ?? "—") : "—"}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{fmtHa(l.areaHa)}</td>
                  <td className="py-2 text-right whitespace-nowrap">
                    {can("location:update") && (
                      <button
                        type="button"
                        className="text-brand hover:underline"
                        onClick={() => setEditing(l)}
                      >
                        Edit
                      </button>
                    )}
                    {can("location:archive") && (
                      <button
                        type="button"
                        className="ml-3 text-muted hover:text-fail"
                        onClick={() => archive.mutate(l.id)}
                      >
                        Archive
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {(can("location:create") || editing) && (
        <Card title={editing ? `Edit ${editing.code}` : "Add a location"}>
          <LocationForm
            orgId={org.id}
            all={list.data ?? []}
            editing={editing}
            onDone={() => setEditing(null)}
          />
        </Card>
      )}
    </div>
  );
}
