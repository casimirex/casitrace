import {
  IMPORT_KINDS,
  ImportPreview,
  ImportRequest,
  ImportResult,
  OrgIdParam,
  PRODUCT_CATEGORIES,
  Product,
  ProductCreateInput,
  ProductSummary,
  ProductVersion,
  ProductVersionInput,
  Uom,
} from "@casitrace/contracts";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppEnv, Deps } from "../../../context";
import { withAccess } from "../../../platform/access";
import { errorResponses as E, json, orgCommand } from "../../../platform/http";
import { COLUMNS, commitImport, previewImport } from "../../imports/importers";
import {
  createProduct,
  getProduct,
  getProductVersion,
  listProducts,
  listProductVersions,
  listUoms,
  reviseProduct,
  setProductArchived,
} from "../application/products";

const ProductParams = OrgIdParam.extend({
  productId: z.uuid().openapi({ param: { name: "productId", in: "path" } }),
});
const VersionParams = ProductParams.extend({
  version: z.coerce
    .number()
    .int()
    .positive()
    .openapi({ param: { name: "version", in: "path" } }),
});
const KindParams = OrgIdParam.extend({
  kind: z.enum(IMPORT_KINDS).openapi({ param: { name: "kind", in: "path" } }),
});
const body = <T>(schema: T) => ({ body: { content: { "application/json": { schema } }, required: true } });

type C = Parameters<Parameters<OpenAPIHono<AppEnv>["openapi"]>[1]>[0];
const valid = <T>(c: C, target: "param" | "json" | "query") =>
  (c.req as unknown as { valid(t: string): T }).valid(target);

export const catalogRoutes = (deps: Deps) => {
  const { db } = deps;
  const r = (access: Parameters<typeof withAccess>[1], route: Parameters<typeof createRoute>[0]) =>
    createRoute(withAccess(deps, access, route));

  const uomsR = r(
    { kind: "user" },
    {
      method: "get",
      path: "/uoms",
      tags: ["Products"],
      summary: "Units of measure",
      responses: { 200: { description: "OK", ...json(z.object({ items: z.array(Uom) })) }, ...E },
    },
  );
  const listR = r(
    { kind: "org" },
    {
      method: "get",
      path: "/orgs/{orgId}/products",
      tags: ["Products"],
      summary: "Products (current versions)",
      request: {
        params: OrgIdParam,
        query: z.object({
          category: z.enum(PRODUCT_CATEGORIES).optional(),
          q: z.string().max(100).optional(),
          includeArchived: z
            .enum(["true", "false"])
            .default("false")
            .transform((v) => v === "true"),
        }),
      },
      responses: { 200: { description: "OK", ...json(z.object({ items: z.array(ProductSummary) })) }, ...E },
    },
  );
  const createR = r(
    { kind: "org", permission: "product:create" },
    {
      method: "post",
      path: "/orgs/{orgId}/products",
      tags: ["Products"],
      summary: "Register a product (version 1)",
      request: { params: OrgIdParam, ...body(ProductCreateInput) },
      responses: { 201: { description: "Created", ...json(Product) }, ...E },
    },
  );
  const getR = r(
    { kind: "org" },
    {
      method: "get",
      path: "/orgs/{orgId}/products/{productId}",
      tags: ["Products"],
      summary: "A product and its current version",
      request: { params: ProductParams },
      responses: { 200: { description: "OK", ...json(Product) }, ...E },
    },
  );
  const reviseR = r(
    { kind: "org", permission: "product:update" },
    {
      method: "post",
      path: "/orgs/{orgId}/products/{productId}/versions",
      tags: ["Products"],
      summary: "Change a product: creates the next immutable version (no-op when nothing changed)",
      request: { params: ProductParams, ...body(ProductVersionInput) },
      responses: {
        200: { description: "OK", ...json(z.object({ changed: z.boolean(), product: Product })) },
        ...E,
      },
    },
  );
  const versionsR = r(
    { kind: "org" },
    {
      method: "get",
      path: "/orgs/{orgId}/products/{productId}/versions",
      tags: ["Products"],
      summary: "Version history, newest first",
      request: { params: ProductParams },
      responses: { 200: { description: "OK", ...json(z.object({ items: z.array(ProductVersion) })) }, ...E },
    },
  );
  const versionR = r(
    { kind: "org" },
    {
      method: "get",
      path: "/orgs/{orgId}/products/{productId}/versions/{version}",
      tags: ["Products"],
      summary: "One product version",
      request: { params: VersionParams },
      responses: { 200: { description: "OK", ...json(ProductVersion) }, ...E },
    },
  );
  const archiveR = r(
    { kind: "org", permission: "product:archive" },
    {
      method: "post",
      path: "/orgs/{orgId}/products/{productId}/archive",
      tags: ["Products"],
      summary: "Archive a product",
      request: { params: ProductParams },
      responses: { 200: { description: "Archived", ...json(Product) }, ...E },
    },
  );
  const restoreR = r(
    { kind: "org", permission: "product:archive" },
    {
      method: "post",
      path: "/orgs/{orgId}/products/{productId}/restore",
      tags: ["Products"],
      summary: "Restore an archived product",
      request: { params: ProductParams },
      responses: { 200: { description: "Restored", ...json(Product) }, ...E },
    },
  );

  const templateR = r(
    { kind: "org" },
    {
      method: "get",
      path: "/orgs/{orgId}/imports/{kind}/template",
      tags: ["Imports"],
      summary: "Empty CSV with the expected columns",
      request: { params: KindParams },
      responses: {
        200: { description: "CSV header row", content: { "text/csv": { schema: z.string() } } },
        ...E,
      },
    },
  );
  const previewR = r(
    { kind: "org", permission: "import:run" },
    {
      method: "post",
      path: "/orgs/{orgId}/imports/{kind}/preview",
      tags: ["Imports"],
      summary: "Check a CSV file and show what importing it would do (changes nothing)",
      request: { params: KindParams, ...body(ImportRequest) },
      responses: { 200: { description: "Preview", ...json(ImportPreview) }, ...E },
    },
  );
  const commitR = r(
    { kind: "org", permission: "import:run" },
    {
      method: "post",
      path: "/orgs/{orgId}/imports/{kind}",
      tags: ["Imports"],
      summary: "Import a CSV file, all rows or none",
      request: { params: KindParams, ...body(ImportRequest) },
      responses: { 200: { description: "Imported", ...json(ImportResult) }, ...E },
    },
  );

  return new OpenAPIHono<AppEnv>()
    .openapi(uomsR, async (c) => c.json({ items: await listUoms(db) }, 200))
    .openapi(listR, async (c) => {
      const { orgId } = valid<{ orgId: string }>(c, "param");
      return c.json({ items: await listProducts(db, orgId, valid(c, "query")) }, 200);
    })
    .openapi(createR, async (c) => c.json(await createProduct(db, orgCommand(c), valid(c, "json")), 201))
    .openapi(getR, async (c) => {
      const { orgId, productId } = valid<{ orgId: string; productId: string }>(c, "param");
      return c.json(await getProduct(db, orgId, productId), 200);
    })
    .openapi(reviseR, async (c) => {
      const { productId } = valid<{ productId: string }>(c, "param");
      return c.json(await reviseProduct(db, orgCommand(c), productId, valid(c, "json")), 200);
    })
    .openapi(versionsR, async (c) => {
      const { orgId, productId } = valid<{ orgId: string; productId: string }>(c, "param");
      return c.json({ items: await listProductVersions(db, orgId, productId) }, 200);
    })
    .openapi(versionR, async (c) => {
      const { orgId, productId, version } = valid<{ orgId: string; productId: string; version: number }>(
        c,
        "param",
      );
      return c.json(await getProductVersion(db, orgId, productId, version), 200);
    })
    .openapi(archiveR, async (c) => {
      const { productId } = valid<{ productId: string }>(c, "param");
      return c.json(await setProductArchived(db, orgCommand(c), productId, true), 200);
    })
    .openapi(restoreR, async (c) => {
      const { productId } = valid<{ productId: string }>(c, "param");
      return c.json(await setProductArchived(db, orgCommand(c), productId, false), 200);
    })
    .openapi(templateR, (c) => {
      const { kind } = valid<{ kind: keyof typeof COLUMNS }>(c, "param");
      c.header("content-disposition", `attachment; filename="casitrace-${kind}.csv"`);
      return c.body(`${COLUMNS[kind].join(",")}\n`, 200, { "content-type": "text/csv; charset=utf-8" });
    })
    .openapi(previewR, async (c) => {
      const { orgId, kind } = valid<{ orgId: string; kind: keyof typeof COLUMNS }>(c, "param");
      return c.json(await previewImport(db, orgId, kind, valid<{ csv: string }>(c, "json").csv), 200);
    })
    .openapi(commitR, async (c) => {
      const { kind } = valid<{ kind: keyof typeof COLUMNS }>(c, "param");
      return c.json(await commitImport(db, orgCommand(c), kind, valid<{ csv: string }>(c, "json").csv), 200);
    });
};
