import type { Partner, PartnerInput } from "@casitrace/contracts";
import type { Db, Tx } from "@casitrace/db";
import { AppError, newId } from "@casitrace/shared";
import type { z } from "zod";
import type { CommandContext } from "../../../platform/audit";
import { runCommand } from "../../../platform/command";
import { iso, isUniqueViolation } from "../../../platform/dto";
import { withTenant } from "../../../platform/tenant";

type PartnerDto = z.infer<typeof Partner>;
type Row = NonNullable<Awaited<ReturnType<Tx["tradingPartner"]["findUnique"]>>>;
type Ctx = CommandContext & { orgId: string };

/** Names of linked on-platform organisations (the organisation table is identity data, not under RLS). */
const linkedNames = async (tx: Tx, rows: Row[]) => {
  const ids = [...new Set(rows.map((r) => r.linkedOrgId).filter((x): x is string => !!x))];
  if (!ids.length) return new Map<string, string>();
  const orgs = await tx.organization.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true },
  });
  return new Map(orgs.map((o) => [o.id, o.name]));
};

const dto = (r: Row, names: Map<string, string>): PartnerDto => ({
  id: r.id,
  name: r.name,
  kind: r.kind as PartnerDto["kind"],
  linkedOrgId: r.linkedOrgId,
  linkedOrgName: r.linkedOrgId ? (names.get(r.linkedOrgId) ?? null) : null,
  onPlatform: r.linkedOrgId !== null,
  email: r.email,
  countryCode: r.countryCode,
  registrationNumber: r.registrationNumber,
  gln: r.gln,
  addressLine1: r.addressLine1,
  city: r.city,
  postalCode: r.postalCode,
  notes: r.notes,
  archivedAt: iso(r.archivedAt),
  updatedAt: r.updatedAt.toISOString(),
});

export const preparePartner = async (tx: Tx, orgId: string, input: PartnerInput) => {
  if (input.linkedOrgId) {
    if (input.linkedOrgId === orgId) {
      throw new AppError("VALIDATION_FAILED", "An organisation cannot be its own trading partner.", [
        { path: "linkedOrgId", message: "self" },
      ]);
    }
    const exists = await tx.organization.count({ where: { id: input.linkedOrgId } });
    if (!exists) {
      throw new AppError("VALIDATION_FAILED", "No Casitrace organisation has that ID.", [
        { path: "linkedOrgId", message: "not found" },
      ]);
    }
  }
  return {
    name: input.name,
    kind: input.kind,
    linkedOrgId: input.linkedOrgId ?? null,
    email: input.email ?? null,
    countryCode: input.countryCode ?? null,
    registrationNumber: input.registrationNumber ?? null,
    gln: input.gln ?? null,
    addressLine1: input.addressLine1 ?? null,
    city: input.city ?? null,
    postalCode: input.postalCode ?? null,
    notes: input.notes ?? null,
  };
};

const conflict = (e: unknown): never => {
  if (isUniqueViolation(e))
    throw new AppError("CONFLICT", "That organisation is already one of your trading partners.", [
      { path: "linkedOrgId", message: "already linked" },
    ]);
  throw e;
};

export const listPartners = (db: Db, orgId: string, opts: { kind?: string; includeArchived: boolean }) =>
  withTenant(db, orgId, async (tx) => {
    const kindFilter =
      opts.kind === "supplier" || opts.kind === "customer" ? { kind: { in: [opts.kind, "both"] } } : {};
    const rows = await tx.tradingPartner.findMany({
      where: { ...kindFilter, ...(opts.includeArchived ? {} : { archivedAt: null }) },
      orderBy: { name: "asc" },
      take: 2000,
    });
    const names = await linkedNames(tx, rows);
    return rows.map((r) => dto(r, names));
  });

export const getPartner = (db: Db, orgId: string, id: string) =>
  withTenant(db, orgId, async (tx) => {
    const r = await tx.tradingPartner.findUnique({ where: { id } });
    if (!r) throw new AppError("NOT_FOUND", "Trading partner not found.");
    return dto(r, await linkedNames(tx, [r]));
  });

export const createPartner = (db: Db, ctx: Ctx, input: PartnerInput) =>
  runCommand(db, ctx, async (tx) => {
    const data = await preparePartner(tx, ctx.orgId, input);
    const row = await tx.tradingPartner
      .create({ data: { id: newId(), orgId: ctx.orgId, ...data } })
      .catch(conflict);
    return {
      result: dto(row, await linkedNames(tx, [row])),
      audit: [
        {
          action: "partner.created",
          resourceType: "partner",
          resourceId: row.id,
          data: { kind: row.kind, onPlatform: !!row.linkedOrgId },
        },
      ],
    };
  });

export const updatePartner = (db: Db, ctx: Ctx, id: string, input: PartnerInput) =>
  runCommand(db, ctx, async (tx) => {
    if (!(await tx.tradingPartner.findUnique({ where: { id } })))
      throw new AppError("NOT_FOUND", "Trading partner not found.");
    const data = await preparePartner(tx, ctx.orgId, input);
    const row = await tx.tradingPartner.update({ where: { id }, data }).catch(conflict);
    return {
      result: dto(row, await linkedNames(tx, [row])),
      audit: [{ action: "partner.updated", resourceType: "partner", resourceId: id }],
    };
  });

export const archivePartner = (db: Db, ctx: Ctx, id: string) =>
  runCommand(db, ctx, async (tx) => {
    const existing = await tx.tradingPartner.findUnique({ where: { id } });
    if (!existing) throw new AppError("NOT_FOUND", "Trading partner not found.");
    const row = await tx.tradingPartner.update({
      where: { id },
      data: { archivedAt: existing.archivedAt ?? new Date() },
    });
    return {
      result: dto(row, await linkedNames(tx, [row])),
      audit: [{ action: "partner.archived", resourceType: "partner", resourceId: id }],
    };
  });
