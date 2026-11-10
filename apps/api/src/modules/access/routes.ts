import {
  AccountExport,
  AuditPage,
  can,
  ErrorEnvelope,
  MeResponse,
  OrganisationResponse,
  OrgIdParam,
  PageQuery,
  type Permission,
  PlatformOrganisationList,
  statements,
} from "@casitrace/contracts";
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv, Deps } from "../../context";
import { requireSession, withAccess } from "../../platform/access";
import { writeAudit } from "../../platform/audit";
import { withPlatformAccess, withTenant } from "../../platform/tenant";

const json = <T>(schema: T) => ({ content: { "application/json": { schema } } });
const errors = {
  401: { description: "Not signed in", ...json(ErrorEnvelope) },
  404: { description: "Not found", ...json(ErrorEnvelope) },
};

const ALL_PERMISSIONS = Object.entries(statements).flatMap(([r, actions]) =>
  actions.map((a) => `${r}:${a}` as Permission),
);

type AuditRow = {
  id: string;
  occurredAt: Date;
  action: string;
  actorType: string;
  actorId: string | null;
  resourceType: string;
  resourceId: string | null;
  requestId: string | null;
  data: unknown;
};
const auditDto = (r: AuditRow) => ({ ...r, occurredAt: r.occurredAt.toISOString() });

export const accessRoutes = (deps: Deps) => {
  const { db } = deps;

  const me = createRoute(
    withAccess(
      deps,
      { kind: "user" },
      {
        method: "get",
        path: "/me",
        tags: ["Account"],
        summary: "The signed-in user and their organisations",
        responses: { 200: { description: "OK", ...json(MeResponse) }, ...errors },
      },
    ),
  );

  const exportMe = createRoute(
    withAccess(
      deps,
      { kind: "user" },
      {
        method: "get",
        path: "/me/export",
        tags: ["Account"],
        summary: "Download all personal data held about the signed-in user (GDPR access)",
        responses: { 200: { description: "OK", ...json(AccountExport) }, ...errors },
      },
    ),
  );

  const getOrg = createRoute(
    withAccess(
      deps,
      { kind: "org" },
      {
        method: "get",
        path: "/orgs/{orgId}",
        tags: ["Organisations"],
        summary: "An organisation the user belongs to, with their role and permissions",
        request: { params: OrgIdParam },
        responses: { 200: { description: "OK", ...json(OrganisationResponse) }, ...errors },
      },
    ),
  );

  const orgAudit = createRoute(
    withAccess(
      deps,
      { kind: "org", permission: "audit:read" },
      {
        method: "get",
        path: "/orgs/{orgId}/audit-log",
        tags: ["Organisations"],
        summary: "The organisation's audit log, newest first",
        request: { params: OrgIdParam, query: PageQuery },
        responses: {
          200: { description: "OK", ...json(AuditPage) },
          403: { description: "Role lacks audit:read", ...json(ErrorEnvelope) },
          ...errors,
        },
      },
    ),
  );

  const platformOrgs = createRoute(
    withAccess(
      deps,
      { kind: "platform", roles: ["super_admin", "support"] },
      {
        method: "get",
        path: "/platform/organizations",
        tags: ["Platform"],
        summary: "All organisations (platform staff; two-factor required; access is audited)",
        responses: {
          200: { description: "OK", ...json(PlatformOrganisationList) },
          403: { description: "Two-factor authentication not enabled", ...json(ErrorEnvelope) },
          ...errors,
        },
      },
    ),
  );

  return new OpenAPIHono<AppEnv>()
    .openapi(me, async (c) => {
      const { user } = await requireSession(c, deps);
      const memberships = await db.member.findMany({
        where: { userId: user.id },
        include: { organization: { select: { id: true, name: true, slug: true } } },
        orderBy: { createdAt: "asc" },
      });
      return c.json(
        {
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            emailVerified: user.emailVerified,
            twoFactorEnabled: Boolean(user.twoFactorEnabled),
            platformRole: user.platformRole ?? null,
          },
          memberships: memberships.map((m) => ({ organization: m.organization, role: m.role })),
        },
        200,
      );
    })
    .openapi(exportMe, async (c) => {
      const { user } = await requireSession(c, deps);
      const [record, accounts, sessions, memberships] = await Promise.all([
        db.user.findUniqueOrThrow({ where: { id: user.id } }),
        db.account.findMany({ where: { userId: user.id }, select: { providerId: true, createdAt: true } }),
        db.session.findMany({
          where: { userId: user.id },
          select: { createdAt: true, expiresAt: true, ipAddress: true, userAgent: true },
        }),
        db.member.findMany({
          where: { userId: user.id },
          include: { organization: { select: { name: true } } },
        }),
      ]);
      // The user's own actions across organisations; read with platform scope, filtered to this actor.
      const activity = await withPlatformAccess(db, (tx) =>
        tx.auditLog.findMany({ where: { actorId: user.id }, orderBy: { id: "desc" }, take: 5000 }),
      );
      await writeAudit(
        db,
        { actor: { type: "user", id: user.id }, orgId: null, requestId: c.get("requestId") },
        [{ action: "user.data_exported", resourceType: "user", resourceId: user.id }],
      );
      c.header("content-disposition", `attachment; filename="casitrace-account-${user.id}.json"`);
      return c.json(
        {
          exportedAt: new Date().toISOString(),
          user: {
            ...record,
            createdAt: record.createdAt.toISOString(),
            updatedAt: record.updatedAt.toISOString(),
          },
          signInMethods: accounts.map((a) => ({
            providerId: a.providerId,
            createdAt: a.createdAt.toISOString(),
          })),
          sessions: sessions.map((s) => ({
            ...s,
            createdAt: s.createdAt.toISOString(),
            expiresAt: s.expiresAt.toISOString(),
          })),
          memberships: memberships.map((m) => ({
            organisationId: m.organizationId,
            organisationName: m.organization.name,
            role: m.role,
            since: m.createdAt.toISOString(),
          })),
          activity: activity.map(auditDto),
        },
        200,
      );
    })
    .openapi(getOrg, async (c) => {
      const { orgId } = c.req.valid("param");
      const { role } = c.get("membership");
      const org = await db.organization.findUniqueOrThrow({ where: { id: orgId } });
      return c.json(
        {
          id: org.id,
          name: org.name,
          slug: org.slug,
          createdAt: org.createdAt.toISOString(),
          myRole: role,
          myPermissions: ALL_PERMISSIONS.filter((p) => can(role, p)),
        },
        200,
      );
    })
    .openapi(orgAudit, async (c) => {
      const { orgId } = c.req.valid("param");
      const { limit, cursor } = c.req.valid("query");
      const rows = await withTenant(db, orgId, (tx) =>
        tx.auditLog.findMany({
          where: cursor ? { id: { lt: cursor } } : {},
          orderBy: { id: "desc" },
          take: limit + 1,
        }),
      );
      const page = rows.slice(0, limit);
      return c.json(
        { items: page.map(auditDto), nextCursor: rows.length > limit ? (page.at(-1)?.id ?? null) : null },
        200,
      );
    })
    .openapi(platformOrgs, async (c) => {
      const { user } = await requireSession(c, deps);
      const orgs = await db.organization.findMany({
        orderBy: { createdAt: "desc" },
        take: 500,
        include: { _count: { select: { members: true } } },
      });
      await writeAudit(
        db,
        { actor: { type: "user", id: user.id }, orgId: null, requestId: c.get("requestId") },
        [
          {
            action: "platform.organisations_listed",
            resourceType: "organisation",
            resourceId: null,
            data: { count: orgs.length },
          },
        ],
      );
      return c.json(
        {
          items: orgs.map((o) => ({
            id: o.id,
            name: o.name,
            slug: o.slug,
            createdAt: o.createdAt.toISOString(),
            memberCount: o._count.members,
          })),
        },
        200,
      );
    });
};
