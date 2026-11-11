import {
  LOCATION_TYPES,
  Location,
  LocationInput,
  OrgIdParam,
  PARTNER_KINDS,
  Partner,
  PartnerInput,
  Profile,
  ProfileInput,
  VerificationDecision,
} from "@casitrace/contracts";
import { AppError } from "@casitrace/shared";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppEnv, Deps } from "../../../context";
import { withAccess } from "../../../platform/access";
import { errorResponses as E, json, orgCommand, userCommand } from "../../../platform/http";
import {
  archiveLocation,
  createLocation,
  getLocation,
  listLocations,
  updateLocation,
} from "../application/locations";
import {
  archivePartner,
  createPartner,
  getPartner,
  listPartners,
  updatePartner,
} from "../application/partners";
import {
  decideVerification,
  getProfile,
  listPendingVerifications,
  requestVerification,
  saveProfile,
} from "../application/profile";

const LocationParams = OrgIdParam.extend({
  locationId: z.uuid().openapi({ param: { name: "locationId", in: "path" } }),
});
const PartnerParams = OrgIdParam.extend({
  partnerId: z.uuid().openapi({ param: { name: "partnerId", in: "path" } }),
});
const OrganizationParam = z.object({
  organizationId: z.uuid().openapi({ param: { name: "organizationId", in: "path" } }),
});
const includeArchived = z
  .enum(["true", "false"])
  .default("false")
  .transform((v) => v === "true")
  .openapi({ param: { name: "includeArchived", in: "query" } });
const body = <T>(schema: T) => ({ body: { content: { "application/json": { schema } }, required: true } });

export const partiesRoutes = (deps: Deps) => {
  const { db } = deps;
  const r = (access: Parameters<typeof withAccess>[1], route: Parameters<typeof createRoute>[0]) =>
    createRoute(withAccess(deps, access, route));

  const getProfileR = r(
    { kind: "org" },
    {
      method: "get",
      path: "/orgs/{orgId}/profile",
      tags: ["Organisation profile"],
      summary: "Business profile and verification status",
      request: { params: OrgIdParam },
      responses: { 200: { description: "OK", ...json(Profile.nullable()) }, ...E },
    },
  );
  const putProfileR = r(
    { kind: "org", permission: "organization:update" },
    {
      method: "put",
      path: "/orgs/{orgId}/profile",
      tags: ["Organisation profile"],
      summary: "Create or update the business profile (changing legal identity resets verification)",
      request: { params: OrgIdParam, ...body(ProfileInput) },
      responses: { 200: { description: "Saved", ...json(Profile) }, ...E },
    },
  );
  const requestVerificationR = r(
    { kind: "org", permission: "organization:update" },
    {
      method: "post",
      path: "/orgs/{orgId}/profile/verification-request",
      tags: ["Organisation profile"],
      summary: "Ask Casitrace staff to verify the business",
      request: { params: OrgIdParam },
      responses: { 200: { description: "Pending", ...json(Profile) }, ...E },
    },
  );
  const pendingR = r(
    { kind: "platform", roles: ["super_admin", "support"] },
    {
      method: "get",
      path: "/platform/verifications",
      tags: ["Platform"],
      summary: "Businesses waiting for verification",
      responses: { 200: { description: "OK", ...json(z.object({ items: z.array(Profile) })) }, ...E },
    },
  );
  const decideR = r(
    { kind: "platform", roles: ["super_admin"] },
    {
      method: "post",
      path: "/platform/verifications/{organizationId}",
      tags: ["Platform"],
      summary: "Approve or reject a verification request",
      request: { params: OrganizationParam, ...body(VerificationDecision) },
      responses: { 200: { description: "Decided", ...json(Profile) }, ...E },
    },
  );

  const listLocationsR = r(
    { kind: "org" },
    {
      method: "get",
      path: "/orgs/{orgId}/locations",
      tags: ["Locations"],
      summary: "Farms, plots, facilities and other locations",
      request: {
        params: OrgIdParam,
        query: z.object({ type: z.enum(LOCATION_TYPES).optional(), includeArchived }),
      },
      responses: { 200: { description: "OK", ...json(z.object({ items: z.array(Location) })) }, ...E },
    },
  );
  const createLocationR = r(
    { kind: "org", permission: "location:create" },
    {
      method: "post",
      path: "/orgs/{orgId}/locations",
      tags: ["Locations"],
      summary: "Add a location",
      request: { params: OrgIdParam, ...body(LocationInput) },
      responses: { 201: { description: "Created", ...json(Location) }, ...E },
    },
  );
  const getLocationR = r(
    { kind: "org" },
    {
      method: "get",
      path: "/orgs/{orgId}/locations/{locationId}",
      tags: ["Locations"],
      summary: "One location",
      request: { params: LocationParams },
      responses: { 200: { description: "OK", ...json(Location) }, ...E },
    },
  );
  const updateLocationR = r(
    { kind: "org", permission: "location:update" },
    {
      method: "put",
      path: "/orgs/{orgId}/locations/{locationId}",
      tags: ["Locations"],
      summary: "Replace a location's details",
      request: { params: LocationParams, ...body(LocationInput) },
      responses: { 200: { description: "Saved", ...json(Location) }, ...E },
    },
  );
  const archiveLocationR = r(
    { kind: "org", permission: "location:archive" },
    {
      method: "post",
      path: "/orgs/{orgId}/locations/{locationId}/archive",
      tags: ["Locations"],
      summary: "Archive a location",
      request: { params: LocationParams },
      responses: { 200: { description: "Archived", ...json(Location) }, ...E },
    },
  );

  const listPartnersR = r(
    { kind: "org" },
    {
      method: "get",
      path: "/orgs/{orgId}/partners",
      tags: ["Trading partners"],
      summary: "Suppliers and customers",
      request: {
        params: OrgIdParam,
        query: z.object({ kind: z.enum(PARTNER_KINDS).optional(), includeArchived }),
      },
      responses: { 200: { description: "OK", ...json(z.object({ items: z.array(Partner) })) }, ...E },
    },
  );
  const createPartnerR = r(
    { kind: "org", permission: "partner:create" },
    {
      method: "post",
      path: "/orgs/{orgId}/partners",
      tags: ["Trading partners"],
      summary: "Add a supplier or customer (on Casitrace or external)",
      request: { params: OrgIdParam, ...body(PartnerInput) },
      responses: { 201: { description: "Created", ...json(Partner) }, ...E },
    },
  );
  const getPartnerR = r(
    { kind: "org" },
    {
      method: "get",
      path: "/orgs/{orgId}/partners/{partnerId}",
      tags: ["Trading partners"],
      summary: "One trading partner",
      request: { params: PartnerParams },
      responses: { 200: { description: "OK", ...json(Partner) }, ...E },
    },
  );
  const updatePartnerR = r(
    { kind: "org", permission: "partner:update" },
    {
      method: "put",
      path: "/orgs/{orgId}/partners/{partnerId}",
      tags: ["Trading partners"],
      summary: "Replace a partner's details",
      request: { params: PartnerParams, ...body(PartnerInput) },
      responses: { 200: { description: "Saved", ...json(Partner) }, ...E },
    },
  );
  const archivePartnerR = r(
    { kind: "org", permission: "partner:archive" },
    {
      method: "post",
      path: "/orgs/{orgId}/partners/{partnerId}/archive",
      tags: ["Trading partners"],
      summary: "Archive a partner",
      request: { params: PartnerParams },
      responses: { 200: { description: "Archived", ...json(Partner) }, ...E },
    },
  );

  type C = Parameters<Parameters<OpenAPIHono<AppEnv>["openapi"]>[1]>[0];
  const p = <T>(c: C) => (c.req as unknown as { valid(t: string): T }).valid("param");
  const b = <T>(c: C) => (c.req as unknown as { valid(t: string): T }).valid("json");
  const q = <T>(c: C) => (c.req as unknown as { valid(t: string): T }).valid("query");

  return new OpenAPIHono<AppEnv>()
    .openapi(getProfileR, async (c) => c.json(await getProfile(db, p<{ orgId: string }>(c).orgId), 200))
    .openapi(putProfileR, async (c) => c.json(await saveProfile(db, orgCommand(c), b(c)), 200))
    .openapi(requestVerificationR, async (c) => c.json(await requestVerification(db, orgCommand(c)), 200))
    .openapi(pendingR, async (c) => c.json({ items: await listPendingVerifications(db) }, 200))
    .openapi(decideR, async (c) => {
      const { organizationId } = p<{ organizationId: string }>(c);
      return c.json(await decideVerification(db, userCommand(c), organizationId, b(c), deps.webOrigin), 200);
    })
    .openapi(listLocationsR, async (c) => {
      const { type, includeArchived: inc } = q<{ type?: string; includeArchived: boolean }>(c);
      return c.json(
        { items: await listLocations(db, p<{ orgId: string }>(c).orgId, { type, includeArchived: inc }) },
        200,
      );
    })
    .openapi(createLocationR, async (c) => c.json(await createLocation(db, orgCommand(c), b(c)), 201))
    .openapi(getLocationR, async (c) => {
      const { orgId, locationId } = p<{ orgId: string; locationId: string }>(c);
      return c.json(await getLocation(db, orgId, locationId), 200);
    })
    .openapi(updateLocationR, async (c) =>
      c.json(await updateLocation(db, orgCommand(c), p<{ locationId: string }>(c).locationId, b(c)), 200),
    )
    .openapi(archiveLocationR, async (c) =>
      c.json(await archiveLocation(db, orgCommand(c), p<{ locationId: string }>(c).locationId), 200),
    )
    .openapi(listPartnersR, async (c) => {
      const { kind, includeArchived: inc } = q<{ kind?: string; includeArchived: boolean }>(c);
      return c.json(
        { items: await listPartners(db, p<{ orgId: string }>(c).orgId, { kind, includeArchived: inc }) },
        200,
      );
    })
    .openapi(createPartnerR, async (c) => c.json(await createPartner(db, orgCommand(c), b(c)), 201))
    .openapi(getPartnerR, async (c) => {
      const { orgId, partnerId } = p<{ orgId: string; partnerId: string }>(c);
      return c.json(await getPartner(db, orgId, partnerId), 200);
    })
    .openapi(updatePartnerR, async (c) =>
      c.json(await updatePartner(db, orgCommand(c), p<{ partnerId: string }>(c).partnerId, b(c)), 200),
    )
    .openapi(archivePartnerR, async (c) => {
      const { partnerId } = p<{ partnerId: string }>(c);
      if (!partnerId) throw new AppError("NOT_FOUND", "Trading partner not found.");
      return c.json(await archivePartner(db, orgCommand(c), partnerId), 200);
    });
};
