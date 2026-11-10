import {
  DirectoryEntry,
  DisclosureSchema,
  OrgIdParam,
  PassportDto,
  PassportInput,
  PassportSnapshot,
  PublicKeys,
  PublicPassport,
  VerifyResult,
} from "@casitrace/contracts";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import QRCode from "qrcode";
import type { AppEnv, Deps } from "../../../context";
import { withAccess } from "../../../platform/access";
import { errorResponses as E, json, orgCommand } from "../../../platform/http";
import { rateLimit } from "../../../platform/rate-limit";
import {
  createPassport,
  getPassport,
  listPassports,
  previewPassport,
  publishPassport,
  updateDisclosure,
  withdrawPassport,
} from "../application/passports";
import {
  getPublicPassport,
  publicOrganisation,
  resolveDigitalLink,
  searchDirectory,
  verifyPublicPassport,
} from "../application/public";
import { pickLang, renderDirectory, renderOrganisation, renderPassport } from "./html";

const PassportParams = OrgIdParam.extend({
  passportId: z.uuid().openapi({ param: { name: "passportId", in: "path" } }),
});
const PublicIdParam = z.object({
  publicId: z
    .string()
    .regex(/^[a-z0-9]{6,20}$/)
    .openapi({ param: { name: "publicId", in: "path" } }),
});
const VersionQuery = z.object({ version: z.coerce.number().int().positive().optional() });
const LangQuery = z.object({
  lang: z.enum(["en", "it"]).optional(),
  v: z.coerce.number().int().positive().optional(),
});
const jsonBody = <T>(schema: T) => ({
  body: { content: { "application/json": { schema } }, required: true },
});
const html = { content: { "text/html": { schema: z.string() } } };

type C = Parameters<Parameters<OpenAPIHono<AppEnv>["openapi"]>[1]>[0];
const valid = <T>(c: C, target: "param" | "json" | "query") =>
  (c.req as unknown as { valid(t: string): T }).valid(target);

export const publicationRoutes = (deps: Deps) => {
  const { db } = deps;
  const cfg = deps.publication;
  const r = (access: Parameters<typeof withAccess>[1], route: Parameters<typeof createRoute>[0]) =>
    createRoute(withAccess(deps, access, route));
  const Tag = ["Passports"];
  const Pub = ["Public"];
  const pages = rateLimit("public-pages", 240);
  const api = rateLimit("public-api", 120);
  const search = rateLimit("directory-search", 30);

  const routes = {
    list: r(
      { kind: "org" },
      {
        method: "get",
        path: "/orgs/{orgId}/passports",
        tags: Tag,
        summary: "Public product and lot pages of this organisation",
        request: { params: OrgIdParam },
        responses: { 200: { description: "OK", ...json(z.object({ items: z.array(PassportDto) })) }, ...E },
      },
    ),
    create: r(
      { kind: "org", permission: "passport:publish" },
      {
        method: "post",
        path: "/orgs/{orgId}/passports",
        tags: Tag,
        summary: "Start a public page for a product or a lot (draft)",
        request: { params: OrgIdParam, ...jsonBody(PassportInput) },
        responses: { 201: { description: "Created", ...json(PassportDto) }, ...E },
      },
    ),
    get: r(
      { kind: "org" },
      {
        method: "get",
        path: "/orgs/{orgId}/passports/{passportId}",
        tags: Tag,
        summary: "A passport with its versions",
        request: { params: PassportParams },
        responses: { 200: { description: "OK", ...json(PassportDto) }, ...E },
      },
    ),
    preview: r(
      { kind: "org" },
      {
        method: "get",
        path: "/orgs/{orgId}/passports/{passportId}/preview",
        tags: Tag,
        summary: "Exactly what would be published now (not signed)",
        request: { params: PassportParams },
        responses: { 200: { description: "OK", ...json(PassportSnapshot) }, ...E },
      },
    ),
    disclosure: r(
      { kind: "org", permission: "passport:publish" },
      {
        method: "put",
        path: "/orgs/{orgId}/passports/{passportId}/disclosure",
        tags: Tag,
        summary: "Choose what may be public (applies from the next publication)",
        request: { params: PassportParams, ...jsonBody(DisclosureSchema) },
        responses: { 200: { description: "Saved", ...json(PassportDto) }, ...E },
      },
    ),
    publish: r(
      { kind: "org", permission: "passport:publish" },
      {
        method: "post",
        path: "/orgs/{orgId}/passports/{passportId}/publish",
        tags: Tag,
        summary: "Publish a new signed version",
        request: { params: PassportParams },
        responses: { 200: { description: "Published", ...json(PassportDto) }, ...E },
      },
    ),
    withdraw: r(
      { kind: "org", permission: "passport:publish" },
      {
        method: "post",
        path: "/orgs/{orgId}/passports/{passportId}/withdraw",
        tags: Tag,
        summary: "Withdraw the public page (it shows a notice)",
        request: { params: PassportParams },
        responses: { 200: { description: "Withdrawn", ...json(PassportDto) }, ...E },
      },
    ),
    qr: r(
      { kind: "org" },
      {
        method: "get",
        path: "/orgs/{orgId}/passports/{passportId}/qr.svg",
        tags: Tag,
        summary: "QR code (SVG) for the page's GS1 Digital Link URL",
        request: { params: PassportParams },
        responses: {
          200: { description: "SVG", content: { "image/svg+xml": { schema: z.string() } } },
          ...E,
        },
      },
    ),
    keys: r(
      { kind: "public" },
      {
        method: "get",
        path: "/public/keys",
        tags: Pub,
        summary: "Public keys that sign passports (current and previous)",
        responses: { 200: { description: "OK", ...json(PublicKeys) } },
      },
    ),
    passport: r(
      { kind: "public" },
      {
        method: "get",
        path: "/public/passports/{publicId}",
        tags: Pub,
        summary: "A public page's signed data and live status",
        request: { params: PublicIdParam, query: VersionQuery },
        responses: {
          200: { description: "OK", ...json(PublicPassport) },
          404: E[404],
          429: { description: "Too many requests", ...json(z.object({})) },
        },
      },
    ),
    verify: r(
      { kind: "public" },
      {
        method: "get",
        path: "/public/verify/{publicId}",
        tags: Pub,
        summary: "Check a public page's signature",
        request: { params: PublicIdParam, query: VersionQuery },
        responses: { 200: { description: "OK", ...json(VerifyResult) }, 404: E[404] },
      },
    ),
    directory: r(
      { kind: "public" },
      {
        method: "get",
        path: "/public/directory",
        tags: Pub,
        summary: "Search organisations that chose to be listed (query of 2+ characters, 50 results max)",
        request: { query: z.object({ q: z.string().trim().min(2).max(80) }) },
        responses: {
          200: { description: "OK", ...json(z.object({ items: z.array(DirectoryEntry) })) },
          422: E[422],
        },
      },
    ),
    organisation: r(
      { kind: "public" },
      {
        method: "get",
        path: "/public/organisations/{organizationId}",
        tags: Pub,
        summary: "A listed organisation and its public pages",
        request: {
          params: z.object({
            organizationId: z.uuid().openapi({ param: { name: "organizationId", in: "path" } }),
          }),
        },
        responses: {
          200: {
            description: "OK",
            ...json(
              DirectoryEntry.extend({
                passports: z.array(
                  z.object({ publicId: z.string(), productName: z.string(), lotCode: z.string().nullable() }),
                ),
              }).strict(),
            ),
          },
          404: E[404],
        },
      },
    ),
    page: r(
      { kind: "public" },
      {
        method: "get",
        path: "/public/p/{publicId}",
        tags: Pub,
        summary: "The public product page (HTML, works without JavaScript)",
        request: { params: PublicIdParam, query: LangQuery },
        responses: { 200: { description: "HTML", ...html }, 404: { description: "Not found", ...html } },
      },
    ),
    directoryPage: r(
      { kind: "public" },
      {
        method: "get",
        path: "/public/directory-page",
        tags: Pub,
        summary: "Directory search page (HTML)",
        request: {
          query: z.object({ q: z.string().max(80).optional(), lang: z.enum(["en", "it"]).optional() }),
        },
        responses: { 200: { description: "HTML", ...html } },
      },
    ),
    orgPage: r(
      { kind: "public" },
      {
        method: "get",
        path: "/public/o/{organizationId}",
        tags: Pub,
        summary: "Public organisation page (HTML)",
        request: {
          params: z.object({
            organizationId: z.uuid().openapi({ param: { name: "organizationId", in: "path" } }),
          }),
          query: LangQuery,
        },
        responses: { 200: { description: "HTML", ...html }, 404: { description: "Not found", ...html } },
      },
    ),
    resolveLot: r(
      { kind: "public" },
      {
        method: "get",
        path: "/r/01/{gtin}/10/{lotCode}",
        tags: Pub,
        summary: "GS1 Digital Link resolver: product + lot → public page",
        request: {
          params: z.object({
            gtin: z
              .string()
              .regex(/^\d{8,14}$/)
              .openapi({ param: { name: "gtin", in: "path" } }),
            lotCode: z
              .string()
              .max(60)
              .openapi({ param: { name: "lotCode", in: "path" } }),
          }),
        },
        responses: { 302: { description: "Redirect to the page" }, 404: E[404] },
      },
    ),
    resolveProduct: r(
      { kind: "public" },
      {
        method: "get",
        path: "/r/01/{gtin}",
        tags: Pub,
        summary: "GS1 Digital Link resolver: product → public page",
        request: {
          params: z.object({
            gtin: z
              .string()
              .regex(/^\d{8,14}$/)
              .openapi({ param: { name: "gtin", in: "path" } }),
          }),
        },
        responses: { 302: { description: "Redirect to the page" }, 404: E[404] },
      },
    ),
  };

  const app = new OpenAPIHono<AppEnv>();
  for (const path of ["/public/passports/*", "/public/verify/*", "/public/keys", "/public/organisations/*"])
    app.use(path, api);
  app.use("/public/directory", search);
  for (const path of ["/public/p/*", "/public/directory-page", "/public/o/*", "/r/*"]) app.use(path, pages);
  // Public responses may be cached briefly by browsers and CDNs; signed content never changes per version.
  app.use("/public/*", async (c, next) => {
    await next();
    if (c.res.status === 200 && !c.res.headers.get("cache-control"))
      c.header("cache-control", "public, max-age=60");
  });

  return app
    .openapi(routes.list, async (c) =>
      c.json({ items: await listPassports(db, cfg, valid<{ orgId: string }>(c, "param").orgId) }, 200),
    )
    .openapi(routes.create, async (c) =>
      c.json(await createPassport(db, cfg, orgCommand(c), valid(c, "json")), 201),
    )
    .openapi(routes.get, async (c) => {
      const { orgId, passportId } = valid<{ orgId: string; passportId: string }>(c, "param");
      return c.json(await getPassport(db, cfg, orgId, passportId), 200);
    })
    .openapi(routes.preview, async (c) => {
      const { orgId, passportId } = valid<{ orgId: string; passportId: string }>(c, "param");
      return c.json(await previewPassport(db, orgId, passportId), 200);
    })
    .openapi(routes.disclosure, async (c) =>
      c.json(
        await updateDisclosure(
          db,
          cfg,
          orgCommand(c),
          valid<{ passportId: string }>(c, "param").passportId,
          valid(c, "json"),
        ),
        200,
      ),
    )
    .openapi(routes.publish, async (c) =>
      c.json(
        await publishPassport(db, cfg, orgCommand(c), valid<{ passportId: string }>(c, "param").passportId),
        200,
      ),
    )
    .openapi(routes.withdraw, async (c) =>
      c.json(
        await withdrawPassport(db, cfg, orgCommand(c), valid<{ passportId: string }>(c, "param").passportId),
        200,
      ),
    )
    .openapi(routes.qr, async (c) => {
      const { orgId, passportId } = valid<{ orgId: string; passportId: string }>(c, "param");
      const p = await getPassport(db, cfg, orgId, passportId);
      // Error correction M: survives smudges on a bottle label; quiet zone 4 modules per ISO/IEC 18004.
      const svg = await QRCode.toString(p.qrPayload, { type: "svg", errorCorrectionLevel: "M", margin: 4 });
      c.header("x-qr-payload", p.qrPayload);
      return c.body(svg, 200, { "content-type": "image/svg+xml" });
    })
    .openapi(routes.keys, (c) => c.json({ keys: cfg.signer.publicKeys }, 200))
    .openapi(routes.passport, async (c) => {
      const { publicId } = valid<{ publicId: string }>(c, "param");
      return c.json(
        await getPublicPassport(db, publicId, valid<{ version?: number }>(c, "query").version),
        200,
      );
    })
    .openapi(routes.verify, async (c) => {
      const { publicId } = valid<{ publicId: string }>(c, "param");
      return c.json(
        await verifyPublicPassport(db, cfg.signer, publicId, valid<{ version?: number }>(c, "query").version),
        200,
      );
    })
    .openapi(routes.directory, async (c) =>
      c.json({ items: await searchDirectory(db, valid<{ q: string }>(c, "query").q) }, 200),
    )
    .openapi(routes.organisation, async (c) =>
      c.json(await publicOrganisation(db, valid<{ organizationId: string }>(c, "param").organizationId), 200),
    )
    .openapi(routes.page, async (c) => {
      const { publicId } = valid<{ publicId: string }>(c, "param");
      const { lang: l, v } = valid<{ lang?: "en" | "it"; v?: number }>(c, "query");
      const lang = pickLang(l, c.req.header("accept-language"));
      const p = await getPublicPassport(db, publicId, v);
      const check = await verifyPublicPassport(db, cfg.signer, publicId, v);
      return c.html(renderPassport({ ...p, signatureValid: check.valid }, lang), 200);
    })
    .openapi(routes.directoryPage, async (c) => {
      const { q, lang: l } = valid<{ q?: string; lang?: "en" | "it" }>(c, "query");
      const lang = pickLang(l, c.req.header("accept-language"));
      const query = q?.trim() ?? "";
      const results = query.length >= 2 ? await searchDirectory(db, query) : null;
      return c.html(renderDirectory(query, results, lang), 200);
    })
    .openapi(routes.orgPage, async (c) => {
      const { organizationId } = valid<{ organizationId: string }>(c, "param");
      const lang = pickLang(valid<{ lang?: "en" | "it" }>(c, "query").lang, c.req.header("accept-language"));
      return c.html(renderOrganisation(await publicOrganisation(db, organizationId), lang), 200);
    })
    .openapi(routes.resolveLot, async (c) => {
      const { gtin, lotCode } = valid<{ gtin: string; lotCode: string }>(c, "param");
      return c.redirect(`/p/${await resolveDigitalLink(db, gtin, decodeURIComponent(lotCode))}`, 302);
    })
    .openapi(routes.resolveProduct, async (c) =>
      c.redirect(`/p/${await resolveDigitalLink(db, valid<{ gtin: string }>(c, "param").gtin)}`, 302),
    );
};
