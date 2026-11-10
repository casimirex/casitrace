import {
  type ImportKind,
  type ImportPreview,
  LocationInput,
  PartnerInput,
  ProductCreateInput,
} from "@casitrace/contracts";
import type { Db, Tx } from "@casitrace/db";
import { AppError, isAppError, newId } from "@casitrace/shared";
import type { ZodError, z } from "zod";
import type { AuditEntry, CommandContext } from "../../platform/audit";
import { runCommand } from "../../platform/command";
import { CsvError, type CsvTable, parseCsv } from "../../platform/csv";
import { withTenant } from "../../platform/tenant";
import { asNormalized, createProductTx, reviseProductTx } from "../catalog/application/products";
import { normalizeVersion, sameDefinition } from "../catalog/domain/product-rules";
import { prepareLocation } from "../parties/application/locations";
import { preparePartner } from "../parties/application/partners";

type Ctx = CommandContext & { orgId: string };
type RowError = { column: string; message: string };
type PreviewRow = ImportPreview["rows"][number];

// ─── column definitions ─────────────────────────────────────────────────────

export const COLUMNS: Record<ImportKind, readonly string[]> = {
  products: [
    "sku",
    "name",
    "category",
    "uom",
    "gtin",
    "origin_country",
    "origin_region",
    "grade",
    "cultivars",
    "monovarietal",
    "extraction_method",
    "organic",
    "net_volume_ml",
    "container",
    "units_per_case",
    "intended_use",
    "density_kg_per_l",
    "shelf_life_days",
    "storage",
    "allergens",
    "description",
  ],
  locations: [
    "code",
    "name",
    "type",
    "parent_code",
    "gln",
    "country",
    "address_line1",
    "city",
    "postal_code",
    "region",
    "latitude",
    "longitude",
    "boundary_geojson",
  ],
  partners: [
    "name",
    "kind",
    "email",
    "country",
    "registration_number",
    "gln",
    "address_line1",
    "city",
    "postal_code",
    "notes",
    "casitrace_org_id",
  ],
};
const REQUIRED: Record<ImportKind, readonly string[]> = {
  products: ["sku", "name", "category", "uom"],
  locations: ["code", "name", "type"],
  partners: ["name", "kind"],
};

/** Field path (as zod/domain report it) → CSV column, for pointing errors at the right cell. */
const FIELD_TO_COLUMN: Record<string, string> = {
  uomCode: "uom",
  originCountry: "origin_country",
  originRegion: "origin_region",
  shelfLifeDays: "shelf_life_days",
  storageConditions: "storage",
  "attributes.grade": "grade",
  "attributes.cultivars": "cultivars",
  "attributes.netVolumeMl": "net_volume_ml",
  "attributes.container": "container",
  "attributes.organic": "organic",
  "attributes.monovarietal": "monovarietal",
  "attributes.extractionMethod": "extraction_method",
  "attributes.unitsPerCase": "units_per_case",
  "attributes.intendedUse": "intended_use",
  conversions: "density_kg_per_l",
  parentId: "parent_code",
  countryCode: "country",
  addressLine1: "address_line1",
  postalCode: "postal_code",
  boundary: "boundary_geojson",
  registrationNumber: "registration_number",
  linkedOrgId: "casitrace_org_id",
};
const columnFor = (path: string) => {
  if (FIELD_TO_COLUMN[path]) return FIELD_TO_COLUMN[path];
  const prefix = Object.keys(FIELD_TO_COLUMN).find(
    (k) => path.startsWith(`${k}.`) || path.startsWith(`${k}[`),
  );
  return prefix ? (FIELD_TO_COLUMN[prefix] as string) : path.split(/[.[]/)[0] || "row";
};
const zodErrors = (e: ZodError): RowError[] =>
  e.issues.map((i) => ({ column: columnFor(i.path.join(".")), message: i.message }));
const appErrors = (e: AppError): RowError[] =>
  e.details.length
    ? e.details.map((d) => ({ column: columnFor(d.path ?? "row"), message: d.message }))
    : [{ column: "row", message: e.message }];

// ─── cell parsing helpers ───────────────────────────────────────────────────

const opt = (v: string | undefined) => (v === undefined || v === "" ? undefined : v);
const list = (v: string | undefined) =>
  opt(v)
    ? (v as string)
        .split(/[|;]/)
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;
const numberCell = (errors: RowError[], column: string, v: string | undefined) => {
  if (!opt(v)) return undefined;
  const n = Number((v as string).replace(",", "."));
  if (!Number.isFinite(n)) errors.push({ column, message: `"${v}" is not a number` });
  return n;
};
const boolCell = (errors: RowError[], column: string, v: string | undefined) => {
  if (!opt(v)) return undefined;
  const s = (v as string).toLowerCase();
  if (["yes", "y", "true", "1", "si", "sí", "oui", "ja"].includes(s)) return true;
  if (["no", "n", "false", "0", "non", "nein"].includes(s)) return false;
  errors.push({ column, message: `"${v}" is not yes/no` });
  return undefined;
};

// ─── row → input mappers ────────────────────────────────────────────────────

const mapProduct = (r: Record<string, string>, errors: RowError[]) => {
  const category = r.category ?? "";
  const attributes: Record<string, unknown> = {};
  const set = (k: string, v: unknown) => {
    if (v !== undefined) attributes[k] = v;
  };
  if (category === "olives") {
    set("cultivars", list(r.cultivars));
    set("intendedUse", opt(r.intended_use));
  } else if (category === "olive_oil_bulk") {
    set("grade", opt(r.grade));
    set("cultivars", list(r.cultivars));
    set("monovarietal", boolCell(errors, "monovarietal", r.monovarietal));
    set("extractionMethod", opt(r.extraction_method));
    set("organic", boolCell(errors, "organic", r.organic));
  } else if (category === "olive_oil_packaged") {
    set("grade", opt(r.grade));
    set("netVolumeMl", numberCell(errors, "net_volume_ml", r.net_volume_ml));
    set("container", opt(r.container));
    set("cultivars", list(r.cultivars));
    set("organic", boolCell(errors, "organic", r.organic));
    set("unitsPerCase", numberCell(errors, "units_per_case", r.units_per_case));
  }
  const density = numberCell(errors, "density_kg_per_l", r.density_kg_per_l);
  return {
    sku: r.sku,
    name: r.name,
    category,
    uomCode: r.uom,
    gtin: opt(r.gtin),
    originCountry: opt(r.origin_country),
    originRegion: opt(r.origin_region),
    allergens: list(r.allergens) ?? [],
    storageConditions: opt(r.storage),
    shelfLifeDays: numberCell(errors, "shelf_life_days", r.shelf_life_days),
    description: opt(r.description),
    attributes,
    components: [],
    conversions: density ? [{ fromUom: "l", toUom: "kg", factor: density }] : [],
  };
};

const mapLocation = (r: Record<string, string>, errors: RowError[]) => {
  let boundary: unknown;
  if (opt(r.boundary_geojson)) {
    try {
      boundary = JSON.parse(r.boundary_geojson as string);
    } catch {
      errors.push({ column: "boundary_geojson", message: "Not valid JSON" });
    }
  }
  return {
    code: r.code,
    name: r.name,
    type: r.type,
    gln: opt(r.gln),
    countryCode: opt(r.country),
    addressLine1: opt(r.address_line1),
    city: opt(r.city),
    postalCode: opt(r.postal_code),
    region: opt(r.region),
    latitude: numberCell(errors, "latitude", r.latitude),
    longitude: numberCell(errors, "longitude", r.longitude),
    boundary,
  };
};

const mapPartner = (r: Record<string, string>) => ({
  name: r.name,
  kind: r.kind,
  email: opt(r.email),
  countryCode: opt(r.country),
  registrationNumber: opt(r.registration_number),
  gln: opt(r.gln),
  addressLine1: opt(r.address_line1),
  city: opt(r.city),
  postalCode: opt(r.postal_code),
  notes: opt(r.notes),
  linkedOrgId: opt(r.casitrace_org_id),
});

// ─── planning (shared by preview and commit) ────────────────────────────────

type Plan =
  | {
      kind: "products";
      line: number;
      key: string;
      input: z.infer<typeof ProductCreateInput>;
      existingId: string | null;
    }
  | {
      kind: "locations";
      line: number;
      key: string;
      input: z.infer<typeof LocationInput>;
      parentCode: string | null;
      existingId: string | null;
    }
  | {
      kind: "partners";
      line: number;
      key: string;
      input: z.infer<typeof PartnerInput>;
      existingId: string | null;
    };

interface Planned {
  preview: ImportPreview;
  plans: Plan[];
}

const plan = async (tx: Tx, orgId: string, kind: ImportKind, table: CsvTable): Promise<Planned> => {
  const known = new Set(COLUMNS[kind]);
  const unknownColumns = table.header.filter((h) => h && !known.has(h));
  const missing = REQUIRED[kind].filter((c) => !table.header.includes(c));
  if (missing.length) {
    throw new AppError(
      "VALIDATION_FAILED",
      `Missing required column(s): ${missing.join(", ")}`,
      missing.map((m) => ({ path: m, message: "required column" })),
    );
  }

  const rows: PreviewRow[] = [];
  const plans: Plan[] = [];
  const seen = new Map<string, number>();

  // Existing records by key, fetched once.
  const existing =
    kind === "products"
      ? new Map((await tx.product.findMany({ select: { id: true, sku: true } })).map((p) => [p.sku, p.id]))
      : kind === "locations"
        ? new Map(
            (await tx.location.findMany({ select: { id: true, code: true } })).map((l) => [l.code, l.id]),
          )
        : new Map(
            (await tx.tradingPartner.findMany({ select: { id: true, name: true } })).map((p) => [
              p.name.toLowerCase(),
              p.id,
            ]),
          );
  const fileLocationCodes = new Set(kind === "locations" ? table.rows.map((r) => r.values.code ?? "") : []);

  for (const { line, values } of table.rows) {
    const errors: RowError[] = [];
    const rawKey = kind === "products" ? values.sku : kind === "locations" ? values.code : values.name;
    const key = (rawKey ?? "").trim();
    const mapKey = kind === "partners" ? key.toLowerCase() : key;
    if (!key) errors.push({ column: REQUIRED[kind][0] as string, message: "required" });
    const dup = seen.get(mapKey);
    if (key && dup) errors.push({ column: REQUIRED[kind][0] as string, message: `duplicate of line ${dup}` });
    seen.set(mapKey, line);
    const existingId = existing.get(mapKey) ?? null;
    let action: PreviewRow["action"] = existingId ? "update" : "create";

    try {
      if (kind === "products") {
        const parsed = ProductCreateInput.safeParse(mapProduct(values, errors));
        if (!parsed.success) errors.push(...zodErrors(parsed.error));
        else {
          const v = normalizeVersion(parsed.data);
          if (existingId) {
            const p = await tx.product.findUniqueOrThrow({ where: { id: existingId } });
            const cur = await tx.productVersion.findUniqueOrThrow({
              where: { productId_version: { productId: existingId, version: p.currentVersion } },
              include: { components: { orderBy: { ordinal: "asc" } }, conversions: true },
            });
            if (sameDefinition(v, asNormalized(cur))) action = "unchanged";
          }
          if (!errors.length) plans.push({ kind, line, key, input: parsed.data, existingId });
        }
      } else if (kind === "locations") {
        const parentCode = opt(values.parent_code) ?? null;
        if (parentCode && !fileLocationCodes.has(parentCode) && !existing.has(parentCode)) {
          errors.push({ column: "parent_code", message: `No location with code "${parentCode}"` });
        }
        if (parentCode === key)
          errors.push({ column: "parent_code", message: "A location cannot be inside itself" });
        const parsed = LocationInput.safeParse(mapLocation(values, errors));
        if (!parsed.success) errors.push(...zodErrors(parsed.error));
        else {
          // Validate geometry now; the parent is resolved at commit time.
          const prepared = await prepareLocation(tx, { ...parsed.data, parentId: null }, existingId);
          if (existingId) {
            const cur = await tx.location.findUniqueOrThrow({ where: { id: existingId } });
            const parentId = parentCode ? (existing.get(parentCode) ?? "new") : null;
            const same =
              cur.name === prepared.name &&
              cur.type === prepared.type &&
              cur.parentId === parentId &&
              cur.gln === prepared.gln &&
              cur.countryCode === prepared.countryCode &&
              cur.addressLine1 === prepared.addressLine1 &&
              cur.city === prepared.city &&
              cur.postalCode === prepared.postalCode &&
              cur.region === prepared.region &&
              (cur.latitude?.toNumber() ?? null) === prepared.latitude &&
              (cur.longitude?.toNumber() ?? null) === prepared.longitude &&
              JSON.stringify(cur.boundary ?? null) === JSON.stringify(parsed.data.boundary ?? null);
            if (same) action = "unchanged";
          }
          if (!errors.length) plans.push({ kind, line, key, input: parsed.data, parentCode, existingId });
        }
      } else {
        const parsed = PartnerInput.safeParse(mapPartner(values));
        if (!parsed.success) errors.push(...zodErrors(parsed.error));
        else {
          const prepared = await preparePartner(tx, orgId, parsed.data);
          if (existingId) {
            const cur = await tx.tradingPartner.findUniqueOrThrow({ where: { id: existingId } });
            const same = (Object.keys(prepared) as (keyof typeof prepared)[]).every(
              (k) => (cur[k] ?? null) === (prepared[k] ?? null),
            );
            if (same) action = "unchanged";
          }
          if (!errors.length) plans.push({ kind, line, key, input: parsed.data, existingId });
        }
      }
    } catch (e) {
      if (!isAppError(e)) throw e;
      errors.push(...appErrors(e));
    }

    rows.push({ line, key, action: errors.length ? "error" : action, errors });
  }

  return {
    preview: {
      kind,
      totalRows: rows.length,
      validRows: rows.filter((r) => r.action !== "error").length,
      rows,
      unknownColumns,
    },
    plans,
  };
};

const parse = (csv: string) => {
  try {
    return parseCsv(csv);
  } catch (e) {
    if (e instanceof CsvError) throw new AppError("VALIDATION_FAILED", e.message);
    throw e;
  }
};

/** Validates a CSV file and reports what importing it would do, without changing anything. */
export const previewImport = (db: Db, orgId: string, kind: ImportKind, csv: string) =>
  withTenant(db, orgId, async (tx) => (await plan(tx, orgId, kind, parse(csv))).preview);

/** Applies a CSV file all-or-nothing. Refuses if any row has an error. */
export const commitImport = (db: Db, ctx: Ctx, kind: ImportKind, csv: string) =>
  runCommand(
    db,
    ctx,
    async (tx) => {
      const table = parse(csv);
      const { preview, plans } = await plan(tx, ctx.orgId, kind, table);
      if (preview.validRows !== preview.totalRows) {
        throw new AppError(
          "VALIDATION_FAILED",
          `${preview.totalRows - preview.validRows} row(s) have errors; nothing was imported.`,
          preview.rows
            .flatMap((r) =>
              r.errors.map((e) => ({ path: `line ${r.line}: ${e.column}`, message: e.message })),
            )
            .slice(0, 200),
        );
      }
      const action = new Map(preview.rows.map((r) => [r.line, r.action]));
      const audit: AuditEntry[] = [];
      let created = 0;
      let updated = 0;

      if (kind === "locations") {
        // Parents before children.
        const ids = new Map(
          (await tx.location.findMany({ select: { id: true, code: true } })).map((l) => [l.code, l.id]),
        );
        const pending = plans.filter(
          (p): p is Extract<Plan, { kind: "locations" }> => p.kind === "locations",
        );
        let progressed = true;
        while (pending.length && progressed) {
          progressed = false;
          for (let i = 0; i < pending.length; i++) {
            const p = pending[i] as (typeof pending)[number];
            if (p.parentCode && !ids.has(p.parentCode)) continue;
            pending.splice(i--, 1);
            progressed = true;
            if (action.get(p.line) === "unchanged") continue;
            const data = await prepareLocation(
              tx,
              { ...p.input, parentId: p.parentCode ? (ids.get(p.parentCode) ?? null) : null },
              p.existingId,
            );
            if (p.existingId) {
              await tx.location.update({ where: { id: p.existingId }, data });
              updated++;
              audit.push({
                action: "location.updated",
                resourceType: "location",
                resourceId: p.existingId,
                data: { via: "import" },
              });
            } else {
              const id = newId();
              await tx.location.create({ data: { id, orgId: ctx.orgId, ...data } });
              ids.set(p.key, id);
              created++;
              audit.push({
                action: "location.created",
                resourceType: "location",
                resourceId: id,
                data: { via: "import" },
              });
            }
          }
        }
        if (pending.length)
          throw new AppError(
            "VALIDATION_FAILED",
            `Parent codes form a cycle: ${pending.map((p) => p.key).join(", ")}`,
          );
      } else {
        for (const p of plans) {
          if (action.get(p.line) === "unchanged") continue;
          if (p.kind === "products") {
            if (p.existingId) {
              const v = await reviseProductTx(tx, ctx, p.existingId, p.input);
              if (v !== null) {
                updated++;
                audit.push({
                  action: "product.revised",
                  resourceType: "product",
                  resourceId: p.existingId,
                  data: { version: v, via: "import" },
                });
              }
            } else {
              const id = await createProductTx(tx, ctx, p.input);
              created++;
              audit.push({
                action: "product.created",
                resourceType: "product",
                resourceId: id,
                data: { version: 1, via: "import" },
              });
            }
          } else if (p.kind === "partners") {
            const data = await preparePartner(tx, ctx.orgId, p.input);
            if (p.existingId) {
              await tx.tradingPartner.update({ where: { id: p.existingId }, data });
              updated++;
              audit.push({
                action: "partner.updated",
                resourceType: "partner",
                resourceId: p.existingId,
                data: { via: "import" },
              });
            } else {
              const id = newId();
              await tx.tradingPartner.create({ data: { id, orgId: ctx.orgId, ...data } });
              created++;
              audit.push({
                action: "partner.created",
                resourceType: "partner",
                resourceId: id,
                data: { via: "import" },
              });
            }
          }
        }
      }

      const summary = { kind, created, updated, unchanged: preview.totalRows - created - updated };
      return {
        result: summary,
        audit: [
          { action: "import.completed", resourceType: "import", resourceId: null, data: summary },
          ...audit,
        ],
      };
    },
    { timeoutMs: 120_000 },
  );
