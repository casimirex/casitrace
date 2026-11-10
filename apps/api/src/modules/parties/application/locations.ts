import type { Location, LocationInput } from "@casitrace/contracts";
import { type Db, Prisma, type Tx } from "@casitrace/db";
import { AppError, newId } from "@casitrace/shared";
import type { z } from "zod";
import type { CommandContext } from "../../../platform/audit";
import { runCommand } from "../../../platform/command";
import { iso, isUniqueViolation, num } from "../../../platform/dto";
import { withTenant } from "../../../platform/tenant";
import { validateBoundary } from "../domain/geometry";

type LocationDto = z.infer<typeof Location>;
type Row = NonNullable<Awaited<ReturnType<Tx["location"]["findUnique"]>>>;
type Ctx = CommandContext & { orgId: string };

export const locationDto = (r: Row): LocationDto => ({
  id: r.id,
  code: r.code,
  name: r.name,
  type: r.type as LocationDto["type"],
  parentId: r.parentId,
  gln: r.gln,
  countryCode: r.countryCode,
  addressLine1: r.addressLine1,
  city: r.city,
  postalCode: r.postalCode,
  region: r.region,
  latitude: num(r.latitude),
  longitude: num(r.longitude),
  boundary: (r.boundary as LocationDto["boundary"]) ?? null,
  areaHa: num(r.areaHa),
  archivedAt: iso(r.archivedAt),
  updatedAt: r.updatedAt.toISOString(),
});

/** Validates the boundary and the parent link; returns the row data to write. */
export const prepareLocation = async (tx: Tx, input: LocationInput, selfId: string | null) => {
  let areaHa: number | null = null;
  if (input.boundary) {
    const v = validateBoundary(input.boundary);
    if (v.issues.length)
      throw new AppError("VALIDATION_FAILED", "The boundary is not a valid area.", v.issues);
    areaHa = v.areaHa;
  }
  if (input.parentId) {
    // RLS limits the lookup to this organisation; walk up to reject cycles.
    let cursor: string | null = input.parentId;
    for (let depth = 0; cursor; depth++) {
      if (cursor === selfId || depth > 20) {
        throw new AppError("VALIDATION_FAILED", "A location cannot be inside itself.", [
          { path: "parentId", message: "cycle" },
        ]);
      }
      const parent: { parentId: string | null } | null = await tx.location.findUnique({
        where: { id: cursor },
        select: { parentId: true },
      });
      if (!parent)
        throw new AppError("VALIDATION_FAILED", "Parent location not found.", [
          { path: "parentId", message: "not found" },
        ]);
      cursor = parent.parentId;
    }
  }
  return {
    code: input.code,
    name: input.name,
    type: input.type,
    parentId: input.parentId ?? null,
    gln: input.gln ?? null,
    countryCode: input.countryCode ?? null,
    addressLine1: input.addressLine1 ?? null,
    city: input.city ?? null,
    postalCode: input.postalCode ?? null,
    region: input.region ?? null,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    boundary: input.boundary ? (input.boundary as Prisma.InputJsonValue) : Prisma.DbNull,
    areaHa,
  };
};

const conflict = (e: unknown, code: string): never => {
  if (isUniqueViolation(e))
    throw new AppError("CONFLICT", `A location with code "${code}" already exists.`, [
      { path: "code", message: "already used" },
    ]);
  throw e;
};

export const listLocations = (db: Db, orgId: string, opts: { type?: string; includeArchived: boolean }) =>
  withTenant(db, orgId, async (tx) =>
    (
      await tx.location.findMany({
        where: {
          ...(opts.type ? { type: opts.type } : {}),
          ...(opts.includeArchived ? {} : { archivedAt: null }),
        },
        orderBy: [{ type: "asc" }, { code: "asc" }],
        take: 2000,
      })
    ).map(locationDto),
  );

export const getLocation = (db: Db, orgId: string, id: string) =>
  withTenant(db, orgId, async (tx) => {
    const r = await tx.location.findUnique({ where: { id } });
    if (!r) throw new AppError("NOT_FOUND", "Location not found.");
    return locationDto(r);
  });

export const createLocation = (db: Db, ctx: Ctx, input: LocationInput) =>
  runCommand(db, ctx, async (tx) => {
    const data = await prepareLocation(tx, input, null);
    const row = await tx.location
      .create({ data: { id: newId(), orgId: ctx.orgId, ...data } })
      .catch((e) => conflict(e, input.code));
    return {
      result: locationDto(row),
      audit: [
        {
          action: "location.created",
          resourceType: "location",
          resourceId: row.id,
          data: { code: row.code, type: row.type },
        },
      ],
    };
  });

export const updateLocation = (db: Db, ctx: Ctx, id: string, input: LocationInput) =>
  runCommand(db, ctx, async (tx) => {
    const existing = await tx.location.findUnique({ where: { id } });
    if (!existing) throw new AppError("NOT_FOUND", "Location not found.");
    const data = await prepareLocation(tx, input, id);
    const row = await tx.location.update({ where: { id }, data }).catch((e) => conflict(e, input.code));
    return {
      result: locationDto(row),
      audit: [
        { action: "location.updated", resourceType: "location", resourceId: id, data: { code: row.code } },
      ],
    };
  });

export const archiveLocation = (db: Db, ctx: Ctx, id: string) =>
  runCommand(db, ctx, async (tx) => {
    const existing = await tx.location.findUnique({ where: { id } });
    if (!existing) throw new AppError("NOT_FOUND", "Location not found.");
    const activeChildren = await tx.location.count({ where: { parentId: id, archivedAt: null } });
    if (activeChildren)
      throw new AppError("CONFLICT", `Archive the ${activeChildren} location(s) inside it first.`);
    const row = await tx.location.update({
      where: { id },
      data: { archivedAt: existing.archivedAt ?? new Date() },
    });
    return {
      result: locationDto(row),
      audit: [{ action: "location.archived", resourceType: "location", resourceId: id }],
    };
  });
