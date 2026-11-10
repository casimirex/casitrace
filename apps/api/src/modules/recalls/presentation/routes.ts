import { can, IncomingRecallNotice, OrgIdParam, RecallDto, StartRecall } from "@casitrace/contracts";
import { AppError } from "@casitrace/shared";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppEnv, Deps } from "../../../context";
import { withAccess } from "../../../platform/access";
import { errorResponses as E, json, orgCommand } from "../../../platform/http";
import {
  acknowledgeIncoming,
  closeRecall,
  exportRecall,
  getRecall,
  incomingNotices,
  listRecalls,
  recordAcknowledgement,
  startRecall,
} from "../application/recalls";

const p = (name: string) => z.uuid().openapi({ param: { name, in: "path" } });
const RecallParams = OrgIdParam.extend({ recallId: p("recallId") });
const NoticeParams = RecallParams.extend({ noticeId: p("noticeId") });
const IncomingParams = OrgIdParam.extend({ noticeId: p("noticeId") });
const jsonBody = <T>(schema: T) => ({
  body: { content: { "application/json": { schema } }, required: true },
});
const Note = z.object({ note: z.string().trim().min(3).max(1000) });
const Ok = z.object({ ok: z.literal(true) });

type C = Parameters<Parameters<OpenAPIHono<AppEnv>["openapi"]>[1]>[0];
const valid = <T>(c: C, target: "param" | "json" | "query") =>
  (c.req as unknown as { valid(t: string): T }).valid(target);
/** Drills need recall:drill (quality staff can run them); real recalls also need recall:start. */
const requireRealPermission = (c: C, mode: string) => {
  if (mode === "real" && !can(c.get("membership").role, "recall:start")) {
    throw new AppError(
      "FORBIDDEN",
      "Only an owner or admin can start or close a real recall. Run a mock recall instead.",
    );
  }
};

export const recallRoutes = (deps: Deps) => {
  const { db, webOrigin } = deps;
  const r = (access: Parameters<typeof withAccess>[1], route: Parameters<typeof createRoute>[0]) =>
    createRoute(withAccess(deps, access, route));
  const T = ["Recalls"];
  const routes = {
    list: r(
      { kind: "org" },
      {
        method: "get",
        path: "/orgs/{orgId}/recalls",
        tags: T,
        summary: "Recalls and mock-recall drills",
        request: { params: OrgIdParam },
        responses: {
          200: {
            description: "OK",
            ...json(
              z.object({
                items: z.array(
                  z.object({
                    id: z.uuid(),
                    code: z.string(),
                    mode: z.enum(["real", "drill"]),
                    status: z.enum(["open", "closed"]),
                    reason: z.string(),
                    startedAt: z.iso.datetime(),
                    secondsToExport: z.number().nullable(),
                  }),
                ),
              }),
            ),
          },
          ...E,
        },
      },
    ),
    start: r(
      { kind: "org", permission: "recall:drill" },
      {
        method: "post",
        path: "/orgs/{orgId}/recalls",
        tags: T,
        summary:
          "Start a recall (owners/admins) or a mock-recall drill from one or more lots: computes the impact and notifies customers",
        request: { params: OrgIdParam, ...jsonBody(StartRecall) },
        responses: { 201: { description: "Started", ...json(RecallDto) }, ...E },
      },
    ),
    get: r(
      { kind: "org" },
      {
        method: "get",
        path: "/orgs/{orgId}/recalls/{recallId}",
        tags: T,
        summary: "A recall with its impact and customer notices",
        request: { params: RecallParams },
        responses: { 200: { description: "OK", ...json(RecallDto) }, ...E },
      },
    ),
    export: r(
      { kind: "org", permission: "recall:drill" },
      {
        method: "get",
        path: "/orgs/{orgId}/recalls/{recallId}/export",
        tags: T,
        summary: "CSV of affected lots and the customer contact list (first export stops the drill clock)",
        request: { params: RecallParams },
        responses: { 200: { description: "CSV", content: { "text/csv": { schema: z.string() } } }, ...E },
      },
    ),
    ack: r(
      { kind: "org", permission: "recall:drill" },
      {
        method: "post",
        path: "/orgs/{orgId}/recalls/{recallId}/notices/{noticeId}/acknowledge",
        tags: T,
        summary: "Record that a customer confirmed the notice (e.g. by phone)",
        request: { params: NoticeParams, ...jsonBody(Note) },
        responses: { 200: { description: "Recorded", ...json(Ok) }, ...E },
      },
    ),
    close: r(
      { kind: "org", permission: "recall:drill" },
      {
        method: "post",
        path: "/orgs/{orgId}/recalls/{recallId}/close",
        tags: T,
        summary: "Close a recall or drill (recalled lots stay flagged)",
        request: { params: RecallParams, ...jsonBody(Note) },
        responses: { 200: { description: "Closed", ...json(Ok) }, ...E },
      },
    ),
    incoming: r(
      { kind: "org" },
      {
        method: "get",
        path: "/orgs/{orgId}/recall-notices",
        tags: T,
        summary: "Recalls by suppliers that affect product you received",
        request: { params: OrgIdParam },
        responses: {
          200: { description: "OK", ...json(z.object({ items: z.array(IncomingRecallNotice) })) },
          ...E,
        },
      },
    ),
    incomingAck: r(
      { kind: "org", permission: "recall:acknowledge" },
      {
        method: "post",
        path: "/orgs/{orgId}/recall-notices/{noticeId}/acknowledge",
        tags: T,
        summary: "Acknowledge a supplier's recall notice",
        request: { params: IncomingParams, ...jsonBody(Note) },
        responses: { 200: { description: "Acknowledged", ...json(Ok) }, ...E },
      },
    ),
  };

  return new OpenAPIHono<AppEnv>()
    .openapi(routes.list, async (c) =>
      c.json({ items: await listRecalls(db, valid<{ orgId: string }>(c, "param").orgId) }, 200),
    )
    .openapi(routes.start, async (c) => {
      const body = valid<z.infer<typeof StartRecall>>(c, "json");
      requireRealPermission(c, body.mode);
      return c.json(await startRecall(db, orgCommand(c), body, webOrigin), 201);
    })
    .openapi(routes.get, async (c) => {
      const { orgId, recallId } = valid<{ orgId: string; recallId: string }>(c, "param");
      return c.json(await getRecall(db, orgId, recallId), 200);
    })
    .openapi(routes.export, async (c) => {
      const { recallId } = valid<{ recallId: string }>(c, "param");
      const { csv, code } = await exportRecall(db, orgCommand(c), recallId);
      c.header("content-disposition", `attachment; filename="${code}.csv"`);
      return c.body(csv, 200, { "content-type": "text/csv; charset=utf-8" });
    })
    .openapi(routes.ack, async (c) => {
      const { recallId, noticeId } = valid<{ recallId: string; noticeId: string }>(c, "param");
      return c.json(
        await recordAcknowledgement(
          db,
          orgCommand(c),
          recallId,
          noticeId,
          valid<{ note: string }>(c, "json").note,
        ),
        200,
      );
    })
    .openapi(routes.close, async (c) => {
      const { orgId, recallId } = valid<{ orgId: string; recallId: string }>(c, "param");
      requireRealPermission(c, (await getRecall(db, orgId, recallId)).mode);
      return c.json(
        await closeRecall(db, orgCommand(c), recallId, valid<{ note: string }>(c, "json").note),
        200,
      );
    })
    .openapi(routes.incoming, async (c) =>
      c.json({ items: await incomingNotices(db, valid<{ orgId: string }>(c, "param").orgId) }, 200),
    )
    .openapi(routes.incomingAck, async (c) => {
      const { noticeId } = valid<{ noticeId: string }>(c, "param");
      return c.json(
        await acknowledgeIncoming(
          db,
          orgCommand(c),
          noticeId,
          valid<{ note: string }>(c, "json").note,
          webOrigin,
        ),
        200,
      );
    });
};
