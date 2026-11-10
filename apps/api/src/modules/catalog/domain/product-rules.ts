import { ATTRIBUTE_SCHEMAS, type ProductCategory, type ProductVersionInput } from "@casitrace/contracts";
import { AppError, type ErrorDetail } from "@casitrace/shared";

/** Mirrors the seeded uom table (ADR 0006). */
export const UOM_DIMENSION = {
  kg: "mass",
  g: "mass",
  t: "mass",
  l: "volume",
  ml: "volume",
  unit: "count",
} as const;
type UomCode = keyof typeof UOM_DIMENSION;

const ALLOWED_DIMENSIONS: Record<ProductCategory, readonly string[]> = {
  olives: ["mass"],
  olive_oil_bulk: ["mass", "volume"],
  olive_oil_packaged: ["count"],
  olive_pomace: ["mass"],
  other: ["mass", "volume", "count"],
};

export interface NormalizedVersion {
  name: string;
  category: ProductCategory;
  uomCode: UomCode;
  description: string | null;
  gtin: string | null;
  originCountry: string | null;
  originRegion: string | null;
  allergens: string[];
  storageConditions: string | null;
  shelfLifeDays: number | null;
  attributes: Record<string, unknown>;
  attributesSchema: string;
  components: { componentProductId: string | null; name: string; percentage: number | null }[];
  conversions: { fromUom: UomCode; toUom: UomCode; factor: number }[];
}

/**
 * Validates and normalises a product definition. Throws VALIDATION_FAILED with every problem found,
 * so a form or an import row can show them all at once.
 */
export const normalizeVersion = (input: ProductVersionInput): NormalizedVersion => {
  const issues: ErrorDetail[] = [];
  const { schema, version } = ATTRIBUTE_SCHEMAS[input.category];
  const parsed = schema.safeParse(input.attributes ?? {});
  if (!parsed.success) {
    for (const i of parsed.error.issues)
      issues.push({ path: ["attributes", ...i.path].join("."), message: i.message });
  }

  const dimension = UOM_DIMENSION[input.uomCode];
  if (!ALLOWED_DIMENSIONS[input.category].includes(dimension)) {
    issues.push({
      path: "uomCode",
      message: `${input.category} is counted by ${ALLOWED_DIMENSIONS[input.category].join(" or ")}, not ${dimension}`,
    });
  }

  const conversions = new Map<string, { fromUom: UomCode; toUom: UomCode; factor: number }>();
  input.conversions.forEach((c, i) => {
    if (UOM_DIMENSION[c.fromUom] === UOM_DIMENSION[c.toUom]) {
      issues.push({
        path: `conversions.${i}`,
        message: `${c.fromUom} → ${c.toUom} is a standard conversion; only cross-dimension conversions are stored`,
      });
    }
    const key = `${c.fromUom}>${c.toUom}`;
    if (conversions.has(key))
      issues.push({ path: `conversions.${i}`, message: `Duplicate conversion ${key}` });
    conversions.set(key, { ...c });
  });

  const attributes = (parsed.success ? parsed.data : {}) as Record<string, unknown>;
  if (input.category === "olive_oil_packaged" && typeof attributes.netVolumeMl === "number") {
    // A bottle's volume is part of its definition: derive unit → l and check any given value against it.
    const litres = attributes.netVolumeMl / 1000;
    const given = conversions.get("unit>l");
    if (given && Math.abs(given.factor - litres) > 1e-9) {
      issues.push({
        path: "conversions",
        message: `unit → l must be ${litres} to match the net volume of ${attributes.netVolumeMl} ml`,
      });
    }
    conversions.set("unit>l", { fromUom: "unit", toUom: "l", factor: litres });
  }

  const pct = input.components.reduce((s, c) => s + (c.percentage ?? 0), 0);
  if (pct > 100.0001)
    issues.push({ path: "components", message: `Component percentages add up to ${pct}%, more than 100%` });

  if (issues.length) throw new AppError("VALIDATION_FAILED", "The product definition is invalid.", issues);

  return {
    name: input.name,
    category: input.category,
    uomCode: input.uomCode,
    description: input.description ?? null,
    gtin: input.gtin ?? null,
    originCountry: input.originCountry ?? null,
    originRegion: input.originRegion ?? null,
    allergens: [...new Set(input.allergens)].sort(),
    storageConditions: input.storageConditions ?? null,
    shelfLifeDays: input.shelfLifeDays ?? null,
    attributes,
    attributesSchema: version,
    components: input.components.map((c) => ({
      componentProductId: c.componentProductId ?? null,
      name: c.name,
      percentage: c.percentage ?? null,
    })),
    conversions: [...conversions.values()].sort((a, b) =>
      `${a.fromUom}${a.toUom}`.localeCompare(`${b.fromUom}${b.toUom}`),
    ),
  };
};

/** Stable JSON for "has anything changed?" (key order independent). */
const stable = (v: unknown): string =>
  Array.isArray(v)
    ? `[${v.map(stable).join(",")}]`
    : v && typeof v === "object"
      ? `{${Object.keys(v)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`)
          .join(",")}}`
      : JSON.stringify(v ?? null);

export const sameDefinition = (a: NormalizedVersion, b: NormalizedVersion) => stable(a) === stable(b);
