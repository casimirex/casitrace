import {
  LOT_STATUSES,
  LotDetail,
  LotDto,
  OrgIdParam,
  RecordEvent,
  TraceEventDto,
  TraceResult,
  VoidEvent,
} from "@casitrace/contracts";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppEnv, Deps } from "../../../context";
import { withAccess } from "../../../platform/access";
import { errorResponses as E, json, orgCommand } from "../../../platform/http";
import { type Ctx, recordEvent, setHold, voidEvent } from "../application/events";
import { getEvent, getLot, listEvents, listLots, trace, traceReport } from "../application/queries";

const LotParams = OrgIdParam.extend({ lotId: z.uuid().openapi({ param: { name: "lotId", in: "path" } }) });
const EventParams = OrgIdParam.extend({
  eventId: z.uuid().openapi({ param: { name: "eventId", in: "path" } }),
});
const jsonBody = <T>(schema: T) => ({
  body: { content: { "application/json": { schema } }, required: true },
});
const Page = { limit: z.coerce.number().int().min(1).max(200).default(50), cursor: z.uuid().optional() };

type C = Parameters<Parameters<OpenAPIHono<AppEnv>["openapi"]>[1]>[0];
const valid = <T>(c: C, target: "param" | "json" | "query") =>
  (c.req as unknown as { valid(t: string): T }).valid(target);
const eventCtx = (c: C): Ctx => ({ ...orgCommand(c), role: c.get("membership").role });

export const traceabilityRoutes = (deps: Deps) => {
  const { db } = deps;
  const r = (access: Parameters<typeof withAccess>[1], route: Parameters<typeof createRoute>[0]) =>
    createRoute(withAccess(deps, access, route));

  const recordR = r(
    { kind: "org", permission: "event:record" },
    {
      method: "post",
      path: "/orgs/{orgId}/events",
      tags: ["Traceability"],
      summary:
        "Record a harvest, receipt, transformation, shipment or adjustment. Send idempotencyKey to make retries safe.",
      request: { params: OrgIdParam, ...jsonBody(RecordEvent) },
      responses: {
        201: { description: "Recorded", ...json(TraceEventDto) },
        200: { description: "Already recorded with this idempotency key", ...json(TraceEventDto) },
        ...E,
      },
    },
  );
  const listEventsR = r(
    { kind: "org" },
    {
      method: "get",
      path: "/orgs/{orgId}/events",
      tags: ["Traceability"],
      summary: "Events, newest first",
      request: {
        params: OrgIdParam,
        query: z.object({
          type: z.enum(["ORIGINATE", "RECEIVE", "TRANSFORM", "SHIP", "ADJUST", "VOID"]).optional(),
          ...Page,
        }),
      },
      responses: {
        200: {
          description: "OK",
          ...json(z.object({ items: z.array(TraceEventDto), nextCursor: z.uuid().nullable() })),
        },
        ...E,
      },
    },
  );
  const getEventR = r(
    { kind: "org" },
    {
      method: "get",
      path: "/orgs/{orgId}/events/{eventId}",
      tags: ["Traceability"],
      summary: "One event with its lines",
      request: { params: EventParams },
      responses: { 200: { description: "OK", ...json(TraceEventDto) }, ...E },
    },
  );
  const voidR = r(
    { kind: "org", permission: "event:void" },
    {
      method: "post",
      path: "/orgs/{orgId}/events/{eventId}/void",
      tags: ["Traceability"],
      summary: "Void an event (it stays in the record) and optionally record its correction",
      request: { params: EventParams, ...jsonBody(VoidEvent) },
      responses: {
        200: {
          description: "Voided",
          ...json(z.object({ voidEventId: z.uuid(), replacementEventId: z.uuid().nullable() })),
        },
        ...E,
      },
    },
  );
  const listLotsR = r(
    { kind: "org" },
    {
      method: "get",
      path: "/orgs/{orgId}/lots",
      tags: ["Traceability"],
      summary: "Lots, newest first (voided lots only when asked)",
      request: {
        params: OrgIdParam,
        query: z.object({
          productId: z.uuid().optional(),
          status: z.enum(LOT_STATUSES).optional(),
          q: z.string().max(60).optional(),
          ...Page,
        }),
      },
      responses: {
        200: {
          description: "OK",
          ...json(z.object({ items: z.array(LotDto), nextCursor: z.uuid().nullable() })),
        },
        ...E,
      },
    },
  );
  const getLotR = r(
    { kind: "org" },
    {
      method: "get",
      path: "/orgs/{orgId}/lots/{lotId}",
      tags: ["Traceability"],
      summary: "A lot with its event timeline",
      request: { params: LotParams },
      responses: { 200: { description: "OK", ...json(LotDetail) }, ...E },
    },
  );
  const holdR = r(
    { kind: "org", permission: "lot:hold" },
    {
      method: "post",
      path: "/orgs/{orgId}/lots/{lotId}/hold",
      tags: ["Traceability"],
      summary: "Put a lot on hold (it cannot be used or shipped)",
      request: { params: LotParams, ...jsonBody(z.object({ reason: z.string().trim().min(3).max(500) })) },
      responses: { 200: { description: "Held", ...json(z.object({ ok: z.literal(true) })) }, ...E },
    },
  );
  const releaseR = r(
    { kind: "org", permission: "lot:hold" },
    {
      method: "post",
      path: "/orgs/{orgId}/lots/{lotId}/release",
      tags: ["Traceability"],
      summary: "Release a held lot",
      request: { params: LotParams },
      responses: { 200: { description: "Released", ...json(z.object({ ok: z.literal(true) })) }, ...E },
    },
  );
  const traceR = r(
    { kind: "org" },
    {
      method: "get",
      path: "/orgs/{orgId}/lots/{lotId}/trace",
      tags: ["Traceability"],
      summary: "Backward (inputs, suppliers) and/or forward (products made, customers) trace",
      request: {
        params: LotParams,
        query: z.object({
          direction: z.enum(["backward", "forward", "both"]).default("both"),
          depth: z.coerce.number().int().min(1).max(50).default(20),
        }),
      },
      responses: { 200: { description: "OK", ...json(TraceResult) }, ...E },
    },
  );
  const reportR = r(
    { kind: "org" },
    {
      method: "get",
      path: "/orgs/{orgId}/lots/{lotId}/trace-report",
      tags: ["Traceability"],
      summary: "Sortable CSV of every key data element in the lot's chain (upstream and downstream)",
      request: { params: LotParams },
      responses: { 200: { description: "CSV", content: { "text/csv": { schema: z.string() } } }, ...E },
    },
  );

  return new OpenAPIHono<AppEnv>()
    .openapi(recordR, async (c) => {
      const ctx = eventCtx(c);
      const { eventId, replayed } = await recordEvent(db, ctx, valid<RecordEvent>(c, "json"));
      return c.json(await getEvent(db, ctx.orgId, eventId), replayed ? 200 : 201);
    })
    .openapi(listEventsR, async (c) => {
      const { orgId } = valid<{ orgId: string }>(c, "param");
      return c.json(await listEvents(db, orgId, valid(c, "query")), 200);
    })
    .openapi(getEventR, async (c) => {
      const { orgId, eventId } = valid<{ orgId: string; eventId: string }>(c, "param");
      return c.json(await getEvent(db, orgId, eventId), 200);
    })
    .openapi(voidR, async (c) => {
      const { eventId } = valid<{ eventId: string }>(c, "param");
      const body = valid<z.infer<typeof VoidEvent>>(c, "json");
      return c.json(await voidEvent(db, eventCtx(c), eventId, body.reason, body.replacement), 200);
    })
    .openapi(listLotsR, async (c) => {
      const { orgId } = valid<{ orgId: string }>(c, "param");
      return c.json(await listLots(db, orgId, valid(c, "query")), 200);
    })
    .openapi(getLotR, async (c) => {
      const { orgId, lotId } = valid<{ orgId: string; lotId: string }>(c, "param");
      return c.json(await getLot(db, orgId, lotId), 200);
    })
    .openapi(holdR, async (c) => {
      const { lotId } = valid<{ lotId: string }>(c, "param");
      await setHold(db, eventCtx(c), lotId, true, valid<{ reason: string }>(c, "json").reason);
      return c.json({ ok: true as const }, 200);
    })
    .openapi(releaseR, async (c) => {
      const { lotId } = valid<{ lotId: string }>(c, "param");
      await setHold(db, eventCtx(c), lotId, false);
      return c.json({ ok: true as const }, 200);
    })
    .openapi(traceR, async (c) => {
      const { orgId, lotId } = valid<{ orgId: string; lotId: string }>(c, "param");
      const { direction, depth } = valid<{ direction: "backward" | "forward" | "both"; depth: number }>(
        c,
        "query",
      );
      return c.json(await trace(db, orgId, lotId, direction, depth), 200);
    })
    .openapi(reportR, async (c) => {
      const { orgId, lotId } = valid<{ orgId: string; lotId: string }>(c, "param");
      const report = await traceReport(db, orgId, lotId);
      c.header(
        "content-disposition",
        `attachment; filename="trace-${report.lotCode.replace(/[^A-Za-z0-9._-]/g, "_")}.csv"`,
      );
      return c.body(report.csv, 200, { "content-type": "text/csv; charset=utf-8" });
    });
};
