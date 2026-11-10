import {
  DownloadLink,
  EVIDENCE_STATUSES,
  EVIDENCE_TARGETS,
  EVIDENCE_TYPES,
  Evidence,
  EvidenceMetadata,
  EvidenceNewVersion,
  EvidenceSummary,
  EvidenceUpdate,
  EvidenceUpload,
  IntegrityCheck,
  NotificationDto,
  OrgIdParam,
  ReviewAction,
} from "@casitrace/contracts";
import { AppError } from "@casitrace/shared";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppEnv, Deps } from "../../../context";
import { fromZodError } from "../../../middleware/errors";
import { requireSession, withAccess } from "../../../platform/access";
import { errorResponses as E, json, orgCommand } from "../../../platform/http";
import {
  addLinks,
  checkIntegrity,
  downloadLink,
  getEvidence,
  listEvidence,
  removeLink,
  reviewEvidence,
  updateEvidence,
  uploadEvidence,
  uploadNewVersion,
} from "../application/evidence";
import { listNotifications, markAllRead, markRead } from "../application/notifications";

const EvidenceParams = OrgIdParam.extend({
  evidenceId: z.uuid().openapi({ param: { name: "evidenceId", in: "path" } }),
});
const FileParams = EvidenceParams.extend({
  version: z.coerce
    .number()
    .int()
    .positive()
    .openapi({ param: { name: "version", in: "path" } }),
});
const LinkParams = EvidenceParams.extend({
  linkId: z.uuid().openapi({ param: { name: "linkId", in: "path" } }),
});
const NotificationParam = z.object({
  notificationId: z.uuid().openapi({ param: { name: "notificationId", in: "path" } }),
});
const jsonBody = <T>(schema: T) => ({
  body: { content: { "application/json": { schema } }, required: true },
});
const formBody = <T>(schema: T) => ({
  body: { content: { "multipart/form-data": { schema } }, required: true },
});
const LinksBody = z.object({
  links: z
    .array(z.object({ targetType: z.enum(EVIDENCE_TARGETS), targetId: z.uuid() }))
    .min(1)
    .max(50),
});

type C = Parameters<Parameters<OpenAPIHono<AppEnv>["openapi"]>[1]>[0];
const valid = <T>(c: C, target: "param" | "json" | "query" | "form") =>
  (c.req as unknown as { valid(t: string): T }).valid(target);

/** Multipart field "metadata" carries JSON; validate it like any JSON body. */
const parseMetadata = (raw: string) => {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new AppError("VALIDATION_FAILED", "metadata must be JSON.", [
      { path: "metadata", message: "invalid JSON" },
    ]);
  }
  const parsed = EvidenceMetadata.safeParse(data);
  if (!parsed.success) throw fromZodError(parsed.error);
  return parsed.data;
};

export const evidenceRoutes = (deps: Deps) => {
  const { db, storage } = deps;
  const r = (access: Parameters<typeof withAccess>[1], route: Parameters<typeof createRoute>[0]) =>
    createRoute(withAccess(deps, access, route));

  const listR = r(
    { kind: "org" },
    {
      method: "get",
      path: "/orgs/{orgId}/evidence",
      tags: ["Evidence"],
      summary: "Evidence, newest first, with filters",
      request: {
        params: OrgIdParam,
        query: z.object({
          status: z.enum(EVIDENCE_STATUSES).optional(),
          type: z.enum(EVIDENCE_TYPES).optional(),
          targetType: z.enum(EVIDENCE_TARGETS).optional(),
          targetId: z.uuid().optional(),
          expiringWithinDays: z.coerce.number().int().min(0).max(3650).optional(),
        }),
      },
      responses: { 200: { description: "OK", ...json(z.object({ items: z.array(EvidenceSummary) })) }, ...E },
    },
  );
  const uploadR = r(
    { kind: "org", permission: "evidence:create" },
    {
      method: "post",
      path: "/orgs/{orgId}/evidence",
      tags: ["Evidence"],
      summary:
        "Upload evidence (max 25 MB). The file is hashed, type-checked and virus-scanned before anyone can download it.",
      request: { params: OrgIdParam, ...formBody(EvidenceUpload) },
      responses: { 201: { description: "Submitted", ...json(Evidence) }, ...E },
    },
  );
  const getR = r(
    { kind: "org" },
    {
      method: "get",
      path: "/orgs/{orgId}/evidence/{evidenceId}",
      tags: ["Evidence"],
      summary: "Evidence with files, links and status history",
      request: { params: EvidenceParams },
      responses: { 200: { description: "OK", ...json(Evidence) }, ...E },
    },
  );
  const updateR = r(
    { kind: "org", permission: "evidence:update" },
    {
      method: "put",
      path: "/orgs/{orgId}/evidence/{evidenceId}",
      tags: ["Evidence"],
      summary: "Change title and certificate details (only before verification)",
      request: { params: EvidenceParams, ...jsonBody(EvidenceUpdate) },
      responses: { 200: { description: "Saved", ...json(Evidence) }, ...E },
    },
  );
  const versionR = r(
    { kind: "org", permission: "evidence:update" },
    {
      method: "post",
      path: "/orgs/{orgId}/evidence/{evidenceId}/files",
      tags: ["Evidence"],
      summary: "Upload a new file version (sends the evidence back to review)",
      request: { params: EvidenceParams, ...formBody(EvidenceNewVersion) },
      responses: { 201: { description: "Submitted", ...json(Evidence) }, ...E },
    },
  );
  const reviewR = r(
    { kind: "org", permission: "evidence:verify" },
    {
      method: "post",
      path: "/orgs/{orgId}/evidence/{evidenceId}/review",
      tags: ["Evidence"],
      summary:
        "Verify, reject or revoke. Reject and revoke need a reason; the uploader cannot verify their own file.",
      request: { params: EvidenceParams, ...jsonBody(ReviewAction) },
      responses: { 200: { description: "Reviewed", ...json(Evidence) }, ...E },
    },
  );
  const linkR = r(
    { kind: "org", permission: "evidence:update" },
    {
      method: "post",
      path: "/orgs/{orgId}/evidence/{evidenceId}/links",
      tags: ["Evidence"],
      summary: "Link evidence to records it supports",
      request: { params: EvidenceParams, ...jsonBody(LinksBody) },
      responses: { 200: { description: "Linked", ...json(Evidence) }, ...E },
    },
  );
  const unlinkR = r(
    { kind: "org", permission: "evidence:update" },
    {
      method: "delete",
      path: "/orgs/{orgId}/evidence/{evidenceId}/links/{linkId}",
      tags: ["Evidence"],
      summary: "Remove a link",
      request: { params: LinkParams },
      responses: { 200: { description: "Unlinked", ...json(Evidence) }, ...E },
    },
  );
  const downloadR = r(
    { kind: "org" },
    {
      method: "post",
      path: "/orgs/{orgId}/evidence/{evidenceId}/files/{version}/download",
      tags: ["Evidence"],
      summary: "A 5-minute download link for a scanned, clean file (access is audited)",
      request: { params: FileParams },
      responses: { 200: { description: "OK", ...json(DownloadLink) }, ...E },
    },
  );
  const integrityR = r(
    { kind: "org" },
    {
      method: "post",
      path: "/orgs/{orgId}/evidence/{evidenceId}/files/{version}/integrity",
      tags: ["Evidence"],
      summary: "Re-hash the stored file and compare with the SHA-256 recorded at upload",
      request: { params: FileParams },
      responses: { 200: { description: "OK", ...json(IntegrityCheck) }, ...E },
    },
  );

  const notificationsR = r(
    { kind: "user" },
    {
      method: "get",
      path: "/me/notifications",
      tags: ["Account"],
      summary: "Your notifications, unread first",
      request: {
        query: z.object({
          unread: z
            .enum(["true", "false"])
            .default("false")
            .transform((v) => v === "true"),
        }),
      },
      responses: {
        200: {
          description: "OK",
          ...json(z.object({ items: z.array(NotificationDto), unread: z.number().int() })),
        },
        ...E,
      },
    },
  );
  const readR = r(
    { kind: "user" },
    {
      method: "post",
      path: "/me/notifications/{notificationId}/read",
      tags: ["Account"],
      summary: "Mark one notification read",
      request: { params: NotificationParam },
      responses: { 200: { description: "OK", ...json(z.object({ ok: z.literal(true) })) }, ...E },
    },
  );
  const readAllR = r(
    { kind: "user" },
    {
      method: "post",
      path: "/me/notifications/read-all",
      tags: ["Account"],
      summary: "Mark all notifications read",
      responses: { 200: { description: "OK", ...json(z.object({ updated: z.number().int() })) }, ...E },
    },
  );

  return new OpenAPIHono<AppEnv>()
    .openapi(listR, async (c) => {
      const { orgId } = valid<{ orgId: string }>(c, "param");
      return c.json({ items: await listEvidence(db, orgId, valid(c, "query")) }, 200);
    })
    .openapi(uploadR, async (c) => {
      const form = valid<{ file: File; metadata: string }>(c, "form");
      return c.json(
        await uploadEvidence(db, storage, orgCommand(c), form.file, parseMetadata(form.metadata)),
        201,
      );
    })
    .openapi(getR, async (c) => {
      const { orgId, evidenceId } = valid<{ orgId: string; evidenceId: string }>(c, "param");
      return c.json(await getEvidence(db, orgId, evidenceId), 200);
    })
    .openapi(updateR, async (c) => {
      const { evidenceId } = valid<{ evidenceId: string }>(c, "param");
      return c.json(await updateEvidence(db, orgCommand(c), evidenceId, valid(c, "json")), 200);
    })
    .openapi(versionR, async (c) => {
      const { evidenceId } = valid<{ evidenceId: string }>(c, "param");
      return c.json(
        await uploadNewVersion(db, storage, orgCommand(c), evidenceId, valid<{ file: File }>(c, "form").file),
        201,
      );
    })
    .openapi(reviewR, async (c) => {
      const { evidenceId } = valid<{ evidenceId: string }>(c, "param");
      const { action, reason } = valid<{ action: "verify" | "reject" | "revoke"; reason?: string }>(
        c,
        "json",
      );
      return c.json(await reviewEvidence(db, orgCommand(c), evidenceId, action, reason), 200);
    })
    .openapi(linkR, async (c) => {
      const { evidenceId } = valid<{ evidenceId: string }>(c, "param");
      return c.json(
        await addLinks(db, orgCommand(c), evidenceId, valid<z.infer<typeof LinksBody>>(c, "json").links),
        200,
      );
    })
    .openapi(unlinkR, async (c) => {
      const { evidenceId, linkId } = valid<{ evidenceId: string; linkId: string }>(c, "param");
      return c.json(await removeLink(db, orgCommand(c), evidenceId, linkId), 200);
    })
    .openapi(downloadR, async (c) => {
      const { evidenceId, version } = valid<{ evidenceId: string; version: number }>(c, "param");
      return c.json(await downloadLink(db, storage, orgCommand(c), evidenceId, version), 200);
    })
    .openapi(integrityR, async (c) => {
      const { evidenceId, version } = valid<{ evidenceId: string; version: number }>(c, "param");
      return c.json(await checkIntegrity(db, storage, orgCommand(c), evidenceId, version), 200);
    })
    .openapi(notificationsR, async (c) => {
      const { user } = await requireSession(c, deps);
      return c.json(await listNotifications(db, user.id, valid<{ unread: boolean }>(c, "query").unread), 200);
    })
    .openapi(readR, async (c) => {
      const { user } = await requireSession(c, deps);
      await markRead(db, user.id, valid<{ notificationId: string }>(c, "param").notificationId);
      return c.json({ ok: true as const }, 200);
    })
    .openapi(readAllR, async (c) => {
      const { user } = await requireSession(c, deps);
      return c.json({ updated: await markAllRead(db, user.id) }, 200);
    });
};
