import { z } from "@hono/zod-openapi";
import { CountryCode, Gln, Gtin } from "./identifiers";

const optText = (max: number) => z.string().trim().max(max).optional().nullable();
const name = z.string().trim().min(1).max(200);
const code = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[A-Za-z0-9._-]+$/, "Use letters, digits, dot, dash or underscore");

// ─── organisation profile ────────────────────────────────────────────────────

export const BUSINESS_ROLES = [
  "grower",
  "mill",
  "bottler",
  "blender",
  "distributor",
  "retailer",
  "other",
] as const;
export const VERIFICATION_STATUSES = ["unverified", "pending", "verified"] as const;

export const ProfileInput = z
  .object({
    legalName: name,
    registrationNumber: optText(60),
    vatNumber: optText(30),
    countryCode: CountryCode,
    addressLine1: optText(200),
    addressLine2: optText(200),
    city: optText(100),
    postalCode: optText(20),
    region: optText(100),
    businessRoles: z.array(z.enum(BUSINESS_ROLES)).min(1).max(BUSINESS_ROLES.length),
    website: z.url().max(300).optional().nullable(),
    description: optText(2000),
  })
  .openapi("ProfileInput");

export const Profile = ProfileInput.extend({
  orgId: z.uuid(),
  countryCode: z.string(),
  verificationStatus: z.enum(VERIFICATION_STATUSES),
  verificationNote: z.string().nullable(),
  verificationRequestedAt: z.iso.datetime().nullable(),
  verifiedAt: z.iso.datetime().nullable(),
  updatedAt: z.iso.datetime(),
}).openapi("Profile");

export const VerificationDecision = z
  .object({ decision: z.enum(["approve", "reject"]), note: z.string().trim().max(1000).optional() })
  .openapi("VerificationDecision");

// ─── locations ───────────────────────────────────────────────────────────────

export const LOCATION_TYPES = ["farm", "plot", "facility", "storage", "warehouse", "store", "other"] as const;

const Position = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]).rest(z.number());
const Ring = z.array(Position).min(4);
export const GeoJsonPolygon = z.object({
  type: z.literal("Polygon"),
  coordinates: z.array(Ring).min(1).max(50),
});
export const GeoJsonMultiPolygon = z.object({
  type: z.literal("MultiPolygon"),
  coordinates: z.array(z.array(Ring).min(1).max(50)).min(1).max(200),
});
export const Boundary = z
  .discriminatedUnion("type", [GeoJsonPolygon, GeoJsonMultiPolygon])
  .openapi("Boundary", { description: "GeoJSON Polygon or MultiPolygon, WGS 84 [longitude, latitude]" });
export type Boundary = z.infer<typeof Boundary>;

export const LocationInput = z
  .object({
    code,
    name,
    type: z.enum(LOCATION_TYPES),
    parentId: z.uuid().optional().nullable(),
    gln: Gln.optional().nullable(),
    countryCode: CountryCode.optional().nullable(),
    addressLine1: optText(200),
    city: optText(100),
    postalCode: optText(20),
    region: optText(100),
    latitude: z.number().min(-90).max(90).optional().nullable(),
    longitude: z.number().min(-180).max(180).optional().nullable(),
    boundary: Boundary.optional().nullable(),
  })
  .refine((v) => (v.latitude == null) === (v.longitude == null), {
    message: "Give both latitude and longitude, or neither",
    path: ["latitude"],
  })
  .openapi("LocationInput");
export type LocationInput = z.infer<typeof LocationInput>;

export const Location = z
  .object({
    id: z.uuid(),
    code: z.string(),
    name: z.string(),
    type: z.enum(LOCATION_TYPES),
    parentId: z.uuid().nullable(),
    gln: z.string().nullable(),
    countryCode: z.string().nullable(),
    addressLine1: z.string().nullable(),
    city: z.string().nullable(),
    postalCode: z.string().nullable(),
    region: z.string().nullable(),
    latitude: z.number().nullable(),
    longitude: z.number().nullable(),
    boundary: Boundary.nullable(),
    areaHa: z.number().nullable(),
    archivedAt: z.iso.datetime().nullable(),
    updatedAt: z.iso.datetime(),
  })
  .openapi("Location");

// ─── trading partners ────────────────────────────────────────────────────────

export const PARTNER_KINDS = ["supplier", "customer", "both"] as const;

export const PartnerInput = z
  .object({
    name,
    kind: z.enum(PARTNER_KINDS),
    linkedOrgId: z.uuid().optional().nullable(),
    email: z.email().max(200).optional().nullable(),
    countryCode: CountryCode.optional().nullable(),
    registrationNumber: optText(60),
    gln: Gln.optional().nullable(),
    addressLine1: optText(200),
    city: optText(100),
    postalCode: optText(20),
    notes: optText(2000),
  })
  .openapi("PartnerInput");
export type PartnerInput = z.infer<typeof PartnerInput>;

export const Partner = z
  .object({
    id: z.uuid(),
    name: z.string(),
    kind: z.enum(PARTNER_KINDS),
    linkedOrgId: z.uuid().nullable(),
    linkedOrgName: z.string().nullable(),
    onPlatform: z.boolean(),
    approvalStatus: z.enum(["pending", "approved", "suspended"]),
    email: z.string().nullable(),
    countryCode: z.string().nullable(),
    registrationNumber: z.string().nullable(),
    gln: z.string().nullable(),
    addressLine1: z.string().nullable(),
    city: z.string().nullable(),
    postalCode: z.string().nullable(),
    notes: z.string().nullable(),
    archivedAt: z.iso.datetime().nullable(),
    updatedAt: z.iso.datetime(),
  })
  .openapi("Partner");

// ─── products ────────────────────────────────────────────────────────────────

export const PRODUCT_CATEGORIES = [
  "olives",
  "olive_oil_bulk",
  "olive_oil_packaged",
  "olive_pomace",
  "other",
] as const;
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

/** EU olive-oil categories (Reg. (EU) 2022/2104; verify per docs/compliance/regulatory-facts.md). */
export const OLIVE_OIL_GRADES = [
  "extra_virgin",
  "virgin",
  "lampante",
  "refined",
  "olive_oil", // composed of refined and virgin olive oils
  "crude_pomace",
  "refined_pomace",
  "olive_pomace_oil",
] as const;

const cultivars = z.array(z.string().trim().min(1).max(60)).max(20).default([]);

/**
 * Category attribute schemas. Each has a version label stored with the product version, so old
 * versions stay interpretable when a schema changes (bump the label, never edit a released one).
 */
export const ATTRIBUTE_SCHEMAS = {
  olives: {
    version: "olives@1",
    schema: z.object({ cultivars, intendedUse: z.enum(["oil", "table"]).default("oil") }).strict(),
  },
  olive_oil_bulk: {
    version: "olive_oil_bulk@1",
    schema: z
      .object({
        grade: z.enum(OLIVE_OIL_GRADES),
        cultivars,
        monovarietal: z.boolean().default(false),
        extractionMethod: z.enum(["two_phase", "three_phase", "press", "other"]).optional(),
        organic: z.boolean().default(false),
      })
      .strict(),
  },
  olive_oil_packaged: {
    version: "olive_oil_packaged@1",
    schema: z
      .object({
        grade: z.enum(OLIVE_OIL_GRADES),
        netVolumeMl: z.number().int().positive().max(25_000),
        container: z.enum(["glass", "tin", "pet", "bag_in_box", "other"]),
        cultivars,
        organic: z.boolean().default(false),
        unitsPerCase: z.number().int().positive().max(1000).optional(),
      })
      .strict(),
  },
  olive_pomace: {
    version: "olive_pomace@1",
    schema: z.object({ moisturePercent: z.number().min(0).max(100).optional() }).strict(),
  },
  other: { version: "other@1", schema: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])) },
} as const satisfies Record<ProductCategory, { version: string; schema: z.ZodType }>;

/** EU Regulation 1169/2011 Annex II allergen groups. */
export const ALLERGENS = [
  "gluten",
  "crustaceans",
  "eggs",
  "fish",
  "peanuts",
  "soybeans",
  "milk",
  "nuts",
  "celery",
  "mustard",
  "sesame",
  "sulphites",
  "lupin",
  "molluscs",
] as const;

export const UomCode = z.enum(["kg", "g", "t", "l", "ml", "unit"]);

export const ProductVersionInput = z
  .object({
    name,
    category: z.enum(PRODUCT_CATEGORIES),
    uomCode: UomCode,
    description: optText(4000),
    gtin: Gtin.optional().nullable(),
    originCountry: CountryCode.optional().nullable(),
    originRegion: optText(100),
    allergens: z.array(z.enum(ALLERGENS)).max(ALLERGENS.length).default([]),
    storageConditions: optText(500),
    shelfLifeDays: z.number().int().positive().max(3650).optional().nullable(),
    attributes: z.record(z.string(), z.unknown()).default({}),
    components: z
      .array(
        z.object({
          componentProductId: z.uuid().optional().nullable(),
          name: z.string().trim().min(1).max(200),
          percentage: z.number().positive().max(100).optional().nullable(),
        }),
      )
      .max(50)
      .default([]),
    conversions: z
      .array(z.object({ fromUom: UomCode, toUom: UomCode, factor: z.number().positive().max(1e9) }))
      .max(10)
      .default([]),
    changeNote: optText(500),
  })
  .openapi("ProductVersionInput");
export type ProductVersionInput = z.infer<typeof ProductVersionInput>;

export const ProductCreateInput = ProductVersionInput.extend({ sku: code }).openapi("ProductCreateInput");

export const ProductVersion = z
  .object({
    id: z.uuid(),
    version: z.number().int(),
    name: z.string(),
    category: z.enum(PRODUCT_CATEGORIES),
    uomCode: z.string(),
    description: z.string().nullable(),
    gtin: z.string().nullable(),
    originCountry: z.string().nullable(),
    originRegion: z.string().nullable(),
    allergens: z.array(z.string()),
    storageConditions: z.string().nullable(),
    shelfLifeDays: z.number().nullable(),
    attributes: z.record(z.string(), z.unknown()),
    attributesSchema: z.string(),
    components: z.array(
      z.object({
        componentProductId: z.uuid().nullable(),
        name: z.string(),
        percentage: z.number().nullable(),
      }),
    ),
    conversions: z.array(z.object({ fromUom: z.string(), toUom: z.string(), factor: z.number() })),
    changeNote: z.string().nullable(),
    createdAt: z.iso.datetime(),
  })
  .openapi("ProductVersion");

export const Product = z
  .object({
    id: z.uuid(),
    sku: z.string(),
    currentVersion: z.number().int(),
    archivedAt: z.iso.datetime().nullable(),
    current: ProductVersion,
  })
  .openapi("Product");

export const ProductSummary = z
  .object({
    id: z.uuid(),
    sku: z.string(),
    name: z.string(),
    category: z.enum(PRODUCT_CATEGORIES),
    gtin: z.string().nullable(),
    uomCode: z.string(),
    currentVersion: z.number().int(),
    archivedAt: z.iso.datetime().nullable(),
  })
  .openapi("ProductSummary");

export const Uom = z
  .object({
    code: z.string(),
    name: z.string(),
    dimension: z.enum(["mass", "volume", "count"]),
    toBase: z.number(),
  })
  .openapi("Uom");

// ─── CSV import ──────────────────────────────────────────────────────────────

export const IMPORT_KINDS = ["products", "locations", "partners"] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

export const ImportRequest = z
  .object({ csv: z.string().min(1).max(2_000_000) })
  .openapi("ImportRequest", { description: "UTF-8 CSV text with a header row; max 2 MB and 5,000 rows." });

export const ImportPreview = z
  .object({
    kind: z.enum(IMPORT_KINDS),
    totalRows: z.number().int(),
    validRows: z.number().int(),
    rows: z.array(
      z.object({
        line: z.number().int(),
        action: z.enum(["create", "update", "unchanged", "error"]),
        key: z.string(),
        errors: z.array(z.object({ column: z.string(), message: z.string() })),
      }),
    ),
    unknownColumns: z.array(z.string()),
  })
  .openapi("ImportPreview");
export type ImportPreview = z.infer<typeof ImportPreview>;

export const ImportResult = z
  .object({
    kind: z.enum(IMPORT_KINDS),
    created: z.number().int(),
    updated: z.number().int(),
    unchanged: z.number().int(),
  })
  .openapi("ImportResult");
