import type { components } from "@casitrace/api-client";
import { OLIVE_OIL_GRADES, PRODUCT_CATEGORIES } from "@casitrace/contracts";
import { type FormEvent, useState } from "react";
import { Alert, Button, Field, SelectField } from "../../components/ui";
import { formValues, numberOrNull } from "./common";

type VersionInput = components["schemas"]["ProductVersionInput"];
type Version = components["schemas"]["ProductVersion"];
type Category = (typeof PRODUCT_CATEGORIES)[number];

const CATEGORY_LABEL: Record<Category, string> = {
  olives: "Olives",
  olive_oil_bulk: "Bulk olive oil",
  olive_oil_packaged: "Packaged olive oil",
  olive_pomace: "Olive pomace",
  other: "Other",
};
const UNITS: Record<Category, string[]> = {
  olives: ["kg", "t"],
  olive_oil_bulk: ["kg", "l", "t"],
  olive_oil_packaged: ["unit"],
  olive_pomace: ["kg", "t"],
  other: ["kg", "l", "unit"],
};
export const categoryLabel = (c: string) => CATEGORY_LABEL[c as Category] ?? c;
const gradeLabel = (g: string) => g.replaceAll("_", " ");

interface Props {
  initial?: Version;
  withSku: boolean;
  busy: boolean;
  error?: string;
  fieldErrors: Record<string, string>;
  submitLabel: string;
  onSubmit: (input: VersionInput & { sku?: string }) => void;
}

/** One form for creating a product and for changing it (which creates the next version). */
export function ProductForm({
  initial,
  withSku,
  busy,
  error,
  fieldErrors: errors,
  submitLabel,
  onSubmit,
}: Props) {
  const [category, setCategory] = useState<Category>((initial?.category as Category) ?? "olive_oil_packaged");
  const a = (initial?.attributes ?? {}) as Record<string, unknown>;
  const density = initial?.conversions.find((c) => c.fromUom === "l" && c.toUom === "kg")?.factor;

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const v = formValues(e.currentTarget);
    const cultivars = (v.cultivars ?? "")
      .split(/[,|;]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const attributes: Record<string, unknown> = {};
    if (category === "olives") Object.assign(attributes, { cultivars });
    if (category === "olive_oil_bulk")
      Object.assign(attributes, { grade: v.grade, cultivars, organic: v.organic === "on" });
    if (category === "olive_oil_packaged") {
      Object.assign(attributes, {
        grade: v.grade,
        cultivars,
        organic: v.organic === "on",
        netVolumeMl: numberOrNull(v.netVolumeMl ?? null),
        container: v.container,
      });
    }
    const d = numberOrNull(v.density ?? null);
    onSubmit({
      ...(withSku ? { sku: v.sku ?? "" } : {}),
      name: v.name ?? "",
      category,
      uomCode: (v.uomCode ?? "kg") as VersionInput["uomCode"],
      gtin: v.gtin,
      originCountry: v.originCountry,
      originRegion: v.originRegion,
      shelfLifeDays: numberOrNull(v.shelfLifeDays ?? null),
      storageConditions: v.storageConditions,
      description: v.description,
      attributes,
      allergens: [],
      components: initial?.components ?? [],
      conversions: d ? [{ fromUom: "l", toUom: "kg", factor: d }] : [],
      changeNote: v.changeNote,
    });
  };

  const err = (k: string) => errors[k];
  return (
    <form onSubmit={submit} className="grid gap-3">
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        {withSku && <Field label="SKU" name="sku" required placeholder="EVO-750-GL" error={err("sku")} />}
        <SelectField
          label="Category"
          name="category"
          value={category}
          onChange={(e) => setCategory(e.target.value as Category)}
        >
          {PRODUCT_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABEL[c]}
            </option>
          ))}
        </SelectField>
        <div className="sm:col-span-2">
          <Field label="Name" name="name" defaultValue={initial?.name} required error={err("name")} />
        </div>
        <SelectField
          key={category}
          label="Counted in"
          name="uomCode"
          defaultValue={initial?.uomCode ?? UNITS[category][0]}
        >
          {UNITS[category].map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </SelectField>
        <Field
          label="GTIN (barcode)"
          name="gtin"
          defaultValue={initial?.gtin ?? ""}
          inputMode="numeric"
          error={err("gtin")}
        />
        {(category === "olive_oil_bulk" || category === "olive_oil_packaged") && (
          <SelectField label="Grade" name="grade" defaultValue={(a.grade as string) ?? "extra_virgin"}>
            {OLIVE_OIL_GRADES.map((g) => (
              <option key={g} value={g}>
                {gradeLabel(g)}
              </option>
            ))}
          </SelectField>
        )}
        {category !== "olive_pomace" && category !== "other" && (
          <Field
            label="Cultivars"
            name="cultivars"
            defaultValue={((a.cultivars as string[]) ?? []).join(", ")}
            placeholder="Coratina, Ogliarola Barese"
            error={err("attributes.cultivars")}
          />
        )}
        {category === "olive_oil_packaged" && (
          <>
            <Field
              label="Net volume (ml)"
              name="netVolumeMl"
              inputMode="numeric"
              defaultValue={(a.netVolumeMl as number) ?? 750}
              required
              error={err("attributes.netVolumeMl")}
            />
            <SelectField label="Container" name="container" defaultValue={(a.container as string) ?? "glass"}>
              {["glass", "tin", "pet", "bag_in_box", "other"].map((c) => (
                <option key={c} value={c}>
                  {c.replaceAll("_", " ")}
                </option>
              ))}
            </SelectField>
          </>
        )}
        {(category === "olive_oil_bulk" || category === "olive_oil_packaged") && (
          <>
            <Field
              label="Density (kg per litre)"
              name="density"
              inputMode="decimal"
              defaultValue={density ?? 0.916}
              hint="Used to convert litres to kilograms"
              error={err("conversions")}
            />
            <label className="flex items-center gap-2 self-end pb-2 text-sm">
              <input type="checkbox" name="organic" defaultChecked={Boolean(a.organic)} /> Organic (declared)
            </label>
          </>
        )}
        <Field
          label="Origin country (ISO)"
          name="originCountry"
          defaultValue={initial?.originCountry ?? ""}
          maxLength={2}
          error={err("originCountry")}
        />
        <Field label="Origin region" name="originRegion" defaultValue={initial?.originRegion ?? ""} />
        <Field
          label="Shelf life (days)"
          name="shelfLifeDays"
          inputMode="numeric"
          defaultValue={initial?.shelfLifeDays ?? ""}
          error={err("shelfLifeDays")}
        />
        <Field
          label="Storage conditions"
          name="storageConditions"
          defaultValue={initial?.storageConditions ?? ""}
        />
        {!withSku && (
          <div className="sm:col-span-2">
            <Field label="What changed" name="changeNote" placeholder="New label design" />
          </div>
        )}
      </div>
      {Object.keys(errors).some((k) => k.startsWith("attributes")) && (
        <Alert>
          {Object.entries(errors)
            .filter(([k]) => k.startsWith("attributes"))
            .map(([k, m]) => `${k.replace("attributes.", "")}: ${m}`)
            .join("; ")}
        </Alert>
      )}
      <Button type="submit" busy={busy} className="justify-self-start">
        {submitLabel}
      </Button>
    </form>
  );
}
