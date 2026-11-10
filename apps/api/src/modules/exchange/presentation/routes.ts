import {
  AcceptHandoff,
  ClaimAccept,
  ClaimInfo,
  ClaimInvite,
  DisputeHandoff,
  DownloadLink,
  Evidence,
  EvidenceRequestDto,
  EvidenceRequestInput,
  GrantDto,
  GrantInput,
  HANDOFF_STATUSES,
  HandoffDto,
  OrgIdParam,
  PartnerCompliance,
  SupplierRequirementDto,
  SupplierRequirementInput,
} from "@casitrace/contracts";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppEnv, Deps } from "../../../context";
import { requireSession, withAccess } from "../../../platform/access";
import { errorResponses as E, json, orgCommand } from "../../../platform/http";
import { acceptClaim, claimInfo, inviteClaim } from "../application/claims";
import {
  cancelEvidenceRequest,
  createEvidenceRequest,
  declineEvidenceRequest,
  fulfilEvidenceRequest,
  getSharedEvidence,
  listEvidenceRequests,
  sharedEvidenceDownload,
} from "../application/evidence-requests";
import { createLotGrant, grantAccessLog, listGrants, revokeGrant } from "../application/grants";
import { acceptHandoff, disputeHandoff, getHandoff, listHandoffs } from "../application/handoffs";
import {
  addRequirement,
  listRequirements,
  partnerCompliance,
  removeRequirement,
  setApproval,
} from "../application/suppliers";

const p = (name: string) => z.uuid().openapi({ param: { name, in: "path" } });
const HandoffParams = OrgIdParam.extend({ handoffId: p("handoffId") });
const GrantParams = OrgIdParam.extend({ grantId: p("grantId") });
const RequestParams = OrgIdParam.extend({ requestId: p("requestId") });
const SharedParams = OrgIdParam.extend({ evidenceId: p("evidenceId") });
const SharedFileParams = SharedParams.extend({
  version: z.coerce
    .number()
    .int()
    .positive()
    .openapi({ param: { name: "version", in: "path" } }),
});
const RequirementParams = OrgIdParam.extend({ requirementId: p("requirementId") });
const PartnerParams = OrgIdParam.extend({ partnerId: p("partnerId") });
const TokenParam = z.object({
  token: z
    .string()
    .min(20)
    .max(100)
    .openapi({ param: { name: "token", in: "path" } }),
});
const jsonBody = <T>(schema: T) => ({
  body: { content: { "application/json": { schema } }, required: true },
});
const Ok = z.object({ ok: z.literal(true) });

type C = Parameters<Parameters<OpenAPIHono<AppEnv>["openapi"]>[1]>[0];
const valid = <T>(c: C, target: "param" | "json" | "query") =>
  (c.req as unknown as { valid(t: string): T }).valid(target);
const eventCtx = (c: C) => ({ ...orgCommand(c), role: c.get("membership").role });
const viewer = (c: C) => ({ orgId: orgCommand(c).orgId, actorId: orgCommand(c).actor.id });

export const exchangeRoutes = (deps: Deps) => {
  const { db, storage, webOrigin } = deps;
  const r = (access: Parameters<typeof withAccess>[1], route: Parameters<typeof createRoute>[0]) =>
    createRoute(withAccess(deps, access, route));
  const T = ["Exchange"];

  const routes = {
    handoffs: r(
      { kind: "org" },
      {
        method: "get",
        path: "/orgs/{orgId}/handoffs",
        tags: T,
        summary: "Shipments between this organisation and others on Casitrace",
        request: {
          params: OrgIdParam,
          query: z.object({
            direction: z.enum(["incoming", "outgoing"]).optional(),
            status: z.enum(HANDOFF_STATUSES).optional(),
          }),
        },
        responses: { 200: { description: "OK", ...json(z.object({ items: z.array(HandoffDto) })) }, ...E },
      },
    ),
    handoff: r(
      { kind: "org" },
      {
        method: "get",
        path: "/orgs/{orgId}/handoffs/{handoffId}",
        tags: T,
        summary: "One shipment",
        request: { params: HandoffParams },
        responses: { 200: { description: "OK", ...json(HandoffDto) }, ...E },
      },
    ),
    accept: r(
      { kind: "org", permission: "handoff:accept" },
      {
        method: "post",
        path: "/orgs/{orgId}/handoffs/{handoffId}/accept",
        tags: T,
        summary: "Book an incoming shipment in: creates the receipt and links your lots to the sender's",
        request: { params: HandoffParams, ...jsonBody(AcceptHandoff) },
        responses: {
          200: {
            description: "Accepted",
            ...json(z.object({ receiveEventId: z.uuid(), handoff: HandoffDto })),
          },
          ...E,
        },
      },
    ),
    dispute: r(
      { kind: "org", permission: "handoff:accept" },
      {
        method: "post",
        path: "/orgs/{orgId}/handoffs/{handoffId}/dispute",
        tags: T,
        summary: "Dispute an incoming shipment (wrong product or quantity)",
        request: { params: HandoffParams, ...jsonBody(DisputeHandoff) },
        responses: { 200: { description: "Disputed", ...json(Ok) }, ...E },
      },
    ),
    grants: r(
      { kind: "org" },
      {
        method: "get",
        path: "/orgs/{orgId}/grants",
        tags: T,
        summary: "What this organisation shares, and what is shared with it",
        request: { params: OrgIdParam },
        responses: {
          200: {
            description: "OK",
            ...json(z.object({ given: z.array(GrantDto), received: z.array(GrantDto) })),
          },
          ...E,
        },
      },
    ),
    grant: r(
      { kind: "org", permission: "share:manage" },
      {
        method: "post",
        path: "/orgs/{orgId}/grants",
        tags: T,
        summary: "Share a lot's history with an organisation (or every downstream holder)",
        request: { params: OrgIdParam, ...jsonBody(GrantInput) },
        responses: { 201: { description: "Shared", ...json(GrantDto) }, ...E },
      },
    ),
    revoke: r(
      { kind: "org", permission: "share:manage" },
      {
        method: "post",
        path: "/orgs/{orgId}/grants/{grantId}/revoke",
        tags: T,
        summary: "Stop sharing (takes effect immediately)",
        request: { params: GrantParams },
        responses: { 200: { description: "Revoked", ...json(Ok) }, ...E },
      },
    ),
    access: r(
      { kind: "org" },
      {
        method: "get",
        path: "/orgs/{orgId}/grants/{grantId}/access",
        tags: T,
        summary: "Who used a grant, and when",
        request: { params: GrantParams },
        responses: {
          200: {
            description: "OK",
            ...json(
              z.object({
                items: z.array(
                  z.object({
                    action: z.string(),
                    actorId: z.uuid().nullable(),
                    granteeOrgId: z.uuid(),
                    resourceId: z.uuid().nullable(),
                    occurredAt: z.iso.datetime(),
                  }),
                ),
              }),
            ),
          },
          ...E,
        },
      },
    ),
    requests: r(
      { kind: "org" },
      {
        method: "get",
        path: "/orgs/{orgId}/evidence-requests",
        tags: T,
        summary: "Document requests sent and received",
        request: { params: OrgIdParam },
        responses: {
          200: { description: "OK", ...json(z.object({ items: z.array(EvidenceRequestDto) })) },
          ...E,
        },
      },
    ),
    request: r(
      { kind: "org", permission: "evidence:create" },
      {
        method: "post",
        path: "/orgs/{orgId}/evidence-requests",
        tags: T,
        summary: "Ask a supplier on Casitrace for a document",
        request: { params: OrgIdParam, ...jsonBody(EvidenceRequestInput) },
        responses: { 201: { description: "Requested", ...json(EvidenceRequestDto) }, ...E },
      },
    ),
    fulfil: r(
      { kind: "org", permission: "evidence:update" },
      {
        method: "post",
        path: "/orgs/{orgId}/evidence-requests/{requestId}/fulfil",
        tags: T,
        summary: "Answer a request by sharing one of your documents",
        request: { params: RequestParams, ...jsonBody(z.object({ evidenceId: z.uuid() })) },
        responses: {
          200: { description: "Shared", ...json(z.object({ ok: z.literal(true), grantId: z.uuid() })) },
          ...E,
        },
      },
    ),
    decline: r(
      { kind: "org", permission: "evidence:update" },
      {
        method: "post",
        path: "/orgs/{orgId}/evidence-requests/{requestId}/decline",
        tags: T,
        summary: "Decline a request",
        request: {
          params: RequestParams,
          ...jsonBody(z.object({ reason: z.string().trim().min(3).max(1000) })),
        },
        responses: { 200: { description: "Declined", ...json(Ok) }, ...E },
      },
    ),
    cancel: r(
      { kind: "org", permission: "evidence:create" },
      {
        method: "post",
        path: "/orgs/{orgId}/evidence-requests/{requestId}/cancel",
        tags: T,
        summary: "Withdraw a request you sent",
        request: { params: RequestParams },
        responses: { 200: { description: "Cancelled", ...json(Ok) }, ...E },
      },
    ),
    shared: r(
      { kind: "org" },
      {
        method: "get",
        path: "/orgs/{orgId}/shared/evidence/{evidenceId}",
        tags: T,
        summary: "Evidence another organisation shared with you",
        request: { params: SharedParams },
        responses: {
          200: {
            description: "OK",
            ...json(
              Evidence.extend({
                sharedBy: z.object({ id: z.uuid(), name: z.string(), verified: z.boolean() }),
              }),
            ),
          },
          ...E,
        },
      },
    ),
    sharedDownload: r(
      { kind: "org" },
      {
        method: "post",
        path: "/orgs/{orgId}/shared/evidence/{evidenceId}/files/{version}/download",
        tags: T,
        summary: "Download shared evidence (logged for both organisations)",
        request: { params: SharedFileParams },
        responses: { 200: { description: "OK", ...json(DownloadLink) }, ...E },
      },
    ),
    requirements: r(
      { kind: "org" },
      {
        method: "get",
        path: "/orgs/{orgId}/supplier-requirements",
        tags: T,
        summary: "Documents every supplier must have",
        request: { params: OrgIdParam },
        responses: {
          200: { description: "OK", ...json(z.object({ items: z.array(SupplierRequirementDto) })) },
          ...E,
        },
      },
    ),
    addRequirement: r(
      { kind: "org", permission: "partner:approve" },
      {
        method: "post",
        path: "/orgs/{orgId}/supplier-requirements",
        tags: T,
        summary: "Add a supplier requirement",
        request: { params: OrgIdParam, ...jsonBody(SupplierRequirementInput) },
        responses: { 201: { description: "Added", ...json(SupplierRequirementDto) }, ...E },
      },
    ),
    removeRequirement: r(
      { kind: "org", permission: "partner:approve" },
      {
        method: "delete",
        path: "/orgs/{orgId}/supplier-requirements/{requirementId}",
        tags: T,
        summary: "Remove a supplier requirement",
        request: { params: RequirementParams },
        responses: { 200: { description: "Removed", ...json(Ok) }, ...E },
      },
    ),
    compliance: r(
      { kind: "org" },
      {
        method: "get",
        path: "/orgs/{orgId}/partners/{partnerId}/compliance",
        tags: T,
        summary: "Which supplier requirements are met, with the evidence",
        request: { params: PartnerParams },
        responses: { 200: { description: "OK", ...json(PartnerCompliance) }, ...E },
      },
    ),
    approve: r(
      { kind: "org", permission: "partner:approve" },
      {
        method: "post",
        path: "/orgs/{orgId}/partners/{partnerId}/approve",
        tags: T,
        summary: "Approve a supplier (only when every requirement is met)",
        request: { params: PartnerParams },
        responses: { 200: { description: "Approved", ...json(Ok) }, ...E },
      },
    ),
    suspend: r(
      { kind: "org", permission: "partner:approve" },
      {
        method: "post",
        path: "/orgs/{orgId}/partners/{partnerId}/suspend",
        tags: T,
        summary: "Suspend a supplier",
        request: {
          params: PartnerParams,
          ...jsonBody(z.object({ reason: z.string().trim().min(3).max(500) })),
        },
        responses: { 200: { description: "Suspended", ...json(Ok) }, ...E },
      },
    ),
    invite: r(
      { kind: "org", permission: "partner:update" },
      {
        method: "post",
        path: "/orgs/{orgId}/partners/{partnerId}/claim-invite",
        tags: T,
        summary: "Invite an off-platform partner to link its own Casitrace organisation",
        request: { params: PartnerParams, ...jsonBody(ClaimInvite) },
        responses: { 201: { description: "Invited", ...json(z.object({ id: z.uuid() })) }, ...E },
      },
    ),
    claim: r(
      { kind: "user" },
      {
        method: "get",
        path: "/claims/{token}",
        tags: T,
        summary: "An invitation to link your organisation to a partner record",
        request: { params: TokenParam },
        responses: { 200: { description: "OK", ...json(ClaimInfo) }, ...E },
      },
    ),
    claimAccept: r(
      { kind: "user" },
      {
        method: "post",
        path: "/claims/{token}/accept",
        tags: T,
        summary: "Link your organisation (owner/admin; invited email address only)",
        request: { params: TokenParam, ...jsonBody(ClaimAccept) },
        responses: {
          200: {
            description: "Linked",
            ...json(z.object({ partnerId: z.uuid(), shipmentsLinked: z.number().int() })),
          },
          ...E,
        },
      },
    ),
  };

  return new OpenAPIHono<AppEnv>()
    .openapi(routes.handoffs, async (c) => {
      const { orgId } = valid<{ orgId: string }>(c, "param");
      return c.json({ items: await listHandoffs(db, orgId, valid(c, "query")) }, 200);
    })
    .openapi(routes.handoff, async (c) => {
      const { orgId, handoffId } = valid<{ orgId: string; handoffId: string }>(c, "param");
      return c.json(await getHandoff(db, orgId, handoffId), 200);
    })
    .openapi(routes.accept, async (c) => {
      const { handoffId } = valid<{ handoffId: string }>(c, "param");
      return c.json(await acceptHandoff(db, eventCtx(c), handoffId, valid(c, "json")), 200);
    })
    .openapi(routes.dispute, async (c) => {
      const { handoffId } = valid<{ handoffId: string }>(c, "param");
      return c.json(
        await disputeHandoff(db, eventCtx(c), handoffId, valid<{ reason: string }>(c, "json").reason),
        200,
      );
    })
    .openapi(routes.grants, async (c) =>
      c.json(await listGrants(db, valid<{ orgId: string }>(c, "param").orgId), 200),
    )
    .openapi(routes.grant, async (c) =>
      c.json(await createLotGrant(db, orgCommand(c), valid(c, "json")), 201),
    )
    .openapi(routes.revoke, async (c) =>
      c.json(await revokeGrant(db, orgCommand(c), valid<{ grantId: string }>(c, "param").grantId), 200),
    )
    .openapi(routes.access, async (c) => {
      const { orgId, grantId } = valid<{ orgId: string; grantId: string }>(c, "param");
      return c.json({ items: await grantAccessLog(db, orgId, grantId) }, 200);
    })
    .openapi(routes.requests, async (c) =>
      c.json({ items: await listEvidenceRequests(db, valid<{ orgId: string }>(c, "param").orgId) }, 200),
    )
    .openapi(routes.request, async (c) =>
      c.json(await createEvidenceRequest(db, orgCommand(c), valid(c, "json"), webOrigin), 201),
    )
    .openapi(routes.fulfil, async (c) => {
      const { requestId } = valid<{ requestId: string }>(c, "param");
      return c.json(
        await fulfilEvidenceRequest(
          db,
          orgCommand(c),
          requestId,
          valid<{ evidenceId: string }>(c, "json").evidenceId,
          webOrigin,
        ),
        200,
      );
    })
    .openapi(routes.decline, async (c) => {
      const { requestId } = valid<{ requestId: string }>(c, "param");
      return c.json(
        await declineEvidenceRequest(
          db,
          orgCommand(c),
          requestId,
          valid<{ reason: string }>(c, "json").reason,
        ),
        200,
      );
    })
    .openapi(routes.cancel, async (c) =>
      c.json(
        await cancelEvidenceRequest(db, orgCommand(c), valid<{ requestId: string }>(c, "param").requestId),
        200,
      ),
    )
    .openapi(routes.shared, async (c) =>
      c.json(
        await getSharedEvidence(db, viewer(c), valid<{ evidenceId: string }>(c, "param").evidenceId),
        200,
      ),
    )
    .openapi(routes.sharedDownload, async (c) => {
      const { evidenceId, version } = valid<{ evidenceId: string; version: number }>(c, "param");
      return c.json(await sharedEvidenceDownload(db, storage, viewer(c), evidenceId, version), 200);
    })
    .openapi(routes.requirements, async (c) =>
      c.json({ items: await listRequirements(db, valid<{ orgId: string }>(c, "param").orgId) }, 200),
    )
    .openapi(routes.addRequirement, async (c) =>
      c.json(await addRequirement(db, orgCommand(c), valid(c, "json")), 201),
    )
    .openapi(routes.removeRequirement, async (c) =>
      c.json(
        await removeRequirement(
          db,
          orgCommand(c),
          valid<{ requirementId: string }>(c, "param").requirementId,
        ),
        200,
      ),
    )
    .openapi(routes.compliance, async (c) => {
      const { orgId, partnerId } = valid<{ orgId: string; partnerId: string }>(c, "param");
      return c.json(await partnerCompliance(db, orgId, partnerId), 200);
    })
    .openapi(routes.approve, async (c) =>
      c.json(
        await setApproval(db, orgCommand(c), valid<{ partnerId: string }>(c, "param").partnerId, true),
        200,
      ),
    )
    .openapi(routes.suspend, async (c) => {
      const { partnerId } = valid<{ partnerId: string }>(c, "param");
      return c.json(
        await setApproval(db, orgCommand(c), partnerId, false, valid<{ reason: string }>(c, "json").reason),
        200,
      );
    })
    .openapi(routes.invite, async (c) => {
      const { partnerId } = valid<{ partnerId: string }>(c, "param");
      return c.json(
        await inviteClaim(db, orgCommand(c), partnerId, valid<{ email: string }>(c, "json").email, webOrigin),
        201,
      );
    })
    .openapi(routes.claim, async (c) =>
      c.json(await claimInfo(db, valid<{ token: string }>(c, "param").token), 200),
    )
    .openapi(routes.claimAccept, async (c) => {
      const { user } = await requireSession(c, deps);
      const { token } = valid<{ token: string }>(c, "param");
      return c.json(
        await acceptClaim(
          db,
          { id: user.id, email: user.email, emailVerified: user.emailVerified },
          token,
          valid<{ organizationId: string }>(c, "json").organizationId,
          c.get("requestId"),
        ),
        200,
      );
    });
};
