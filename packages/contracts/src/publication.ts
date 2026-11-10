import { z } from "@hono/zod-openapi";

/**
 * Disclosure policy (roadmap-v2 P7): which optional sections a passport may show publicly.
 * Never public, whatever the policy: quantities, prices, customers, internal notes, partner contacts,
 * registration/VAT numbers, raw key data elements, documents other than certificates.
 */
export const DISCLOSURE_DEFAULTS = {
  producerAddress: true,
  harvestDates: true,
  processDetails: true,
  originArea: true,
  certificates: true,
  supplierNames: false,
} as const;
export type Disclosure = { [K in keyof typeof DISCLOSURE_DEFAULTS]: boolean };
export const DisclosureSchema = z
  .object({
    producerAddress: z.boolean().default(true),
    harvestDates: z.boolean().default(true),
    processDetails: z.boolean().default(true),
    originArea: z.boolean().default(true),
    certificates: z.boolean().default(true),
    supplierNames: z.boolean().default(false),
  })
  .strict()
  .openapi("Disclosure");

const isoDate = z.iso.date();
const optStr = z.string().optional();

/** The signed public content. Strict: an unexpected field is a bug (and a potential leak). */
export const PassportSnapshot = z
  .object({
    schema: z.literal("casitrace.passport@1"),
    publicId: z.string(),
    version: z.number().int().positive(),
    publishedAt: z.iso.datetime(),
    scope: z.enum(["product", "lot"]),
    product: z
      .object({
        name: z.string(),
        category: z.string(),
        grade: optStr,
        cultivars: z.array(z.string()),
        netVolumeMl: z.number().optional(),
        container: optStr,
        organicDeclared: z.boolean().optional(),
        gtin: optStr,
        originCountry: optStr,
        originRegion: optStr,
        storage: optStr,
        shelfLifeDays: z.number().optional(),
      })
      .strict(),
    producer: z
      .object({ name: z.string(), verified: z.boolean(), country: optStr, region: optStr, city: optStr })
      .strict(),
    lot: z
      .object({
        lotCode: z.string(),
        bestBefore: isoDate.optional(),
        harvest: z.object({ from: isoDate, to: isoDate }).strict().optional(),
        milling: z
          .object({
            date: isoDate.optional(),
            extractionMethod: optStr,
            coldExtracted: z.boolean().optional(),
          })
          .strict()
          .optional(),
        originAreas: z
          .array(
            z
              .object({
                country: optStr,
                region: optStr,
                approxLat: z.number().optional(),
                approxLon: z.number().optional(),
              })
              .strict(),
          )
          .optional(),
      })
      .strict()
      .optional(),
    journey: z.array(
      z
        .object({
          step: z.enum(["harvest", "receipt", "milling", "blending", "bottling", "processing"]),
          date: isoDate.optional(),
          place: optStr,
          by: optStr,
        })
        .strict(),
    ),
    certificates: z.array(
      z
        .object({
          evidenceId: z.uuid(),
          title: z.string(),
          scheme: optStr,
          issuer: optStr,
          validUntil: isoDate.optional(),
          statusAtPublication: z.enum(["checked", "verified", "expired"]),
          sha256: z.string(),
        })
        .strict(),
    ),
    disclosure: DisclosureSchema,
  })
  .strict()
  .openapi("PassportSnapshot");
export type PassportSnapshot = z.infer<typeof PassportSnapshot>;

export const SignatureInfo = z.object({ alg: z.literal("EdDSA"), kid: z.string(), value: z.string() });

export const PublicPassport = z
  .object({
    snapshot: PassportSnapshot,
    canonical: z.string().openapi({ description: "The exact signed bytes (UTF-8 canonical JSON)" }),
    digest: z.string(),
    signature: SignatureInfo,
    live: z.object({
      latestVersion: z.number().int(),
      isLatest: z.boolean(),
      status: z.enum(["published", "withdrawn"]),
      recall: z.boolean(),
      certificates: z.array(z.object({ evidenceId: z.uuid(), status: z.string() })),
    }),
  })
  .openapi("PublicPassport");

export const VerifyResult = z
  .object({
    publicId: z.string(),
    version: z.number().int(),
    valid: z.boolean(),
    kid: z.string(),
    digest: z.string(),
    digestMatches: z.boolean(),
    latestVersion: z.number().int(),
    status: z.enum(["published", "withdrawn"]),
    recall: z.boolean(),
    explanation: z.string(),
  })
  .openapi("VerifyResult");

export const PublicKeys = z
  .object({
    keys: z.array(
      z.object({
        kid: z.string(),
        kty: z.literal("OKP"),
        crv: z.literal("Ed25519"),
        alg: z.literal("EdDSA"),
        x: z.string(),
        status: z.enum(["current", "previous"]),
      }),
    ),
  })
  .openapi("PublicKeys");

export const DirectoryEntry = z
  .object({
    id: z.uuid(),
    name: z.string(),
    city: z.string().nullable(),
    region: z.string().nullable(),
    countryCode: z.string().nullable(),
    businessRoles: z.array(z.string()),
    website: z.string().nullable(),
    description: z.string().nullable(),
    verified: z.boolean(),
  })
  .strict()
  .openapi("DirectoryEntry");

export const PassportInput = z
  .object({
    scope: z.enum(["product", "lot"]),
    productId: z.uuid().optional(),
    lotId: z.uuid().optional(),
    disclosure: DisclosureSchema.default(DISCLOSURE_DEFAULTS),
  })
  .refine((v) => (v.scope === "lot" ? !!v.lotId : !!v.productId), {
    message: "Give the lot (lot scope) or product (product scope)",
    path: ["lotId"],
  })
  .openapi("PassportInput");

export const PassportDto = z
  .object({
    id: z.uuid(),
    publicId: z.string(),
    scope: z.enum(["product", "lot"]),
    product: z.object({ id: z.uuid(), sku: z.string(), name: z.string() }),
    lot: z.object({ id: z.uuid(), lotCode: z.string() }).nullable(),
    disclosure: DisclosureSchema,
    status: z.enum(["draft", "published", "withdrawn"]),
    currentVersion: z.number().int(),
    publicUrl: z.string(),
    qrPayload: z.string(),
    versions: z.array(
      z.object({
        version: z.number().int(),
        publishedAt: z.iso.datetime(),
        digest: z.string(),
        keyId: z.string(),
      }),
    ),
    /** Anonymous page views in the last 30 days (lower bound: CDN-cached views are not counted). */
    views30d: z.object({ qr: z.number().int(), page: z.number().int() }),
    updatedAt: z.iso.datetime(),
  })
  .openapi("Passport");
