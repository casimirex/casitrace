import { z } from "@hono/zod-openapi";

export const Uuid = z.uuid().openapi({ example: "019a6f3e-5b7d-7e8a-9c21-7d4e5f6a8b90" });

export const OrgIdParam = z.object({
  orgId: Uuid.openapi({ param: { name: "orgId", in: "path" } }),
});

export const MeResponse = z
  .object({
    user: z.object({
      id: Uuid,
      name: z.string(),
      email: z.email(),
      emailVerified: z.boolean(),
      twoFactorEnabled: z.boolean(),
      platformRole: z.string().nullable(),
    }),
    memberships: z.array(
      z.object({
        organization: z.object({ id: Uuid, name: z.string(), slug: z.string() }),
        role: z.string(),
      }),
    ),
  })
  .openapi("Me");

export const OrganisationResponse = z
  .object({
    id: Uuid,
    name: z.string(),
    slug: z.string(),
    createdAt: z.iso.datetime(),
    myRole: z.string(),
    myPermissions: z.array(z.string()),
  })
  .openapi("Organisation");

export const PageQuery = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(50)
    .openapi({ param: { name: "limit", in: "query" } }),
  cursor: Uuid.optional().openapi({ param: { name: "cursor", in: "query" } }),
});

export const AuditEntryDto = z
  .object({
    id: Uuid,
    occurredAt: z.iso.datetime(),
    action: z.string(),
    actorType: z.string(),
    actorId: Uuid.nullable(),
    /** Display name: the member's name, "Casitrace staff", "Casitrace (automatic)" or "Former member". */
    actorName: z.string(),
    resourceType: z.string(),
    resourceId: Uuid.nullable(),
    requestId: z.string().nullable(),
    data: z.unknown(),
  })
  .openapi("AuditEntry");

export const AuditPage = z
  .object({ items: z.array(AuditEntryDto), nextCursor: Uuid.nullable() })
  .openapi("AuditPage");

export const PlatformOrganisationList = z
  .object({
    items: z.array(
      z.object({
        id: Uuid,
        name: z.string(),
        slug: z.string(),
        createdAt: z.iso.datetime(),
        memberCount: z.number().int(),
      }),
    ),
  })
  .openapi("PlatformOrganisationList");

export const AccountExport = z
  .object({
    exportedAt: z.iso.datetime(),
    user: z.record(z.string(), z.unknown()),
    signInMethods: z.array(z.object({ providerId: z.string(), createdAt: z.iso.datetime() })),
    sessions: z.array(
      z.object({
        createdAt: z.iso.datetime(),
        expiresAt: z.iso.datetime(),
        ipAddress: z.string().nullable(),
        userAgent: z.string().nullable(),
      }),
    ),
    memberships: z.array(
      z.object({
        organisationId: Uuid,
        organisationName: z.string(),
        role: z.string(),
        since: z.iso.datetime(),
      }),
    ),
    activity: z.array(AuditEntryDto),
  })
  .openapi("AccountExport");
