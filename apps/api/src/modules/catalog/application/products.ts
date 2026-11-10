import type {
  Product,
  ProductCreateInput,
  ProductSummary,
  ProductVersion,
  ProductVersionInput,
} from "@casitrace/contracts";
import type { Db, Prisma, Tx } from "@casitrace/db";
import { AppError, newId } from "@casitrace/shared";
import type { z } from "zod";
import type { CommandContext } from "../../../platform/audit";
import { runCommand } from "../../../platform/command";
import { iso, isUniqueViolation, num } from "../../../platform/dto";
import { withTenant } from "../../../platform/tenant";
import {
  type NormalizedVersion,
  normalizeVersion,
  sameDefinition,
  type UOM_DIMENSION,
} from "../domain/product-rules";

type Ctx = CommandContext & { orgId: string };
type VersionDto = z.infer<typeof ProductVersion>;

const versionInclude = { components: { orderBy: { ordinal: "asc" } }, conversions: true } as const;
type VersionRow = Prisma.ProductVersionGetPayload<{ include: typeof versionInclude }>;

export const versionDto = (v: VersionRow): VersionDto => ({
  id: v.id,
  version: v.version,
  name: v.name,
  category: v.category as VersionDto["category"],
  uomCode: v.uomCode,
  description: v.description,
  gtin: v.gtin,
  originCountry: v.originCountry,
  originRegion: v.originRegion,
  allergens: v.allergens,
  storageConditions: v.storageConditions,
  shelfLifeDays: v.shelfLifeDays,
  attributes: v.attributes as Record<string, unknown>,
  attributesSchema: v.attributesSchema,
  components: v.components.map((c) => ({
    componentProductId: c.componentProductId,
    name: c.name,
    percentage: num(c.percentage),
  })),
  conversions: v.conversions.map((c) => ({ fromUom: c.fromUom, toUom: c.toUom, factor: num(c.factor) ?? 0 })),
  changeNote: v.changeNote,
  createdAt: v.createdAt.toISOString(),
});

/** The stored version in the same normalised shape the domain produces, for change detection. */
export const asNormalized = (v: VersionRow): NormalizedVersion => ({
  name: v.name,
  category: v.category as NormalizedVersion["category"],
  uomCode: v.uomCode as keyof typeof UOM_DIMENSION,
  description: v.description,
  gtin: v.gtin,
  originCountry: v.originCountry,
  originRegion: v.originRegion,
  allergens: [...v.allergens].sort(),
  storageConditions: v.storageConditions,
  shelfLifeDays: v.shelfLifeDays,
  attributes: v.attributes as Record<string, unknown>,
  attributesSchema: v.attributesSchema,
  components: v.components.map((c) => ({
    componentProductId: c.componentProductId,
    name: c.name,
    percentage: num(c.percentage),
  })),
  conversions: v.conversions
    .map((c) => ({
      fromUom: c.fromUom as keyof typeof UOM_DIMENSION,
      toUom: c.toUom as keyof typeof UOM_DIMENSION,
      factor: num(c.factor) ?? 0,
    }))
    .sort((a, b) => `${a.fromUom}${a.toUom}`.localeCompare(`${b.fromUom}${b.toUom}`)),
});

const checkComponents = async (tx: Tx, productId: string | null, v: NormalizedVersion) => {
  const ids = v.components.map((c) => c.componentProductId).filter((x): x is string => !!x);
  if (productId && ids.includes(productId)) {
    throw new AppError("VALIDATION_FAILED", "A product cannot contain itself.", [
      { path: "components", message: "self reference" },
    ]);
  }
  if (ids.length && (await tx.product.count({ where: { id: { in: ids } } })) !== new Set(ids).size) {
    throw new AppError("VALIDATION_FAILED", "A component product was not found in this organisation.", [
      { path: "components", message: "not found" },
    ]);
  }
};

/** Writes version N of a product with its components and conversions (all immutable). */
export const writeVersion = async (
  tx: Tx,
  ctx: Ctx,
  productId: string,
  version: number,
  v: NormalizedVersion,
  changeNote: string | null,
) => {
  const id = newId();
  await tx.productVersion.create({
    data: {
      id,
      orgId: ctx.orgId,
      productId,
      version,
      name: v.name,
      category: v.category,
      uomCode: v.uomCode,
      description: v.description,
      gtin: v.gtin,
      originCountry: v.originCountry,
      originRegion: v.originRegion,
      allergens: v.allergens,
      storageConditions: v.storageConditions,
      shelfLifeDays: v.shelfLifeDays,
      attributes: v.attributes as Prisma.InputJsonValue,
      attributesSchema: v.attributesSchema,
      changeNote,
      createdById: ctx.actor.id,
    },
  });
  if (v.components.length) {
    await tx.productComponent.createMany({
      data: v.components.map((c, i) => ({
        id: newId(),
        orgId: ctx.orgId,
        productVersionId: id,
        ordinal: i,
        ...c,
      })),
    });
  }
  if (v.conversions.length) {
    await tx.productUnitConversion.createMany({
      data: v.conversions.map((c) => ({ id: newId(), orgId: ctx.orgId, productVersionId: id, ...c })),
    });
  }
  return id;
};

const gtinConflict = (e: unknown, gtin: string | null): never => {
  if (isUniqueViolation(e)) {
    const target = JSON.stringify(e.meta ?? {}); // Prisma 7 adapters report the index name under driverAdapterError
    if (target.includes("gtin"))
      throw new AppError("CONFLICT", `Another product already uses GTIN ${gtin}.`, [
        { path: "gtin", message: "already used" },
      ]);
    throw new AppError("CONFLICT", "A product with that SKU already exists.", [
      { path: "sku", message: "already used" },
    ]);
  }
  throw e;
};

export const createProductTx = async (tx: Tx, ctx: Ctx, input: z.infer<typeof ProductCreateInput>) => {
  const v = normalizeVersion(input);
  await checkComponents(tx, null, v);
  const id = newId();
  await tx.product
    .create({ data: { id, orgId: ctx.orgId, sku: input.sku, gtin: v.gtin, currentVersion: 1 } })
    .catch((e) => gtinConflict(e, v.gtin));
  await writeVersion(tx, ctx, id, 1, v, input.changeNote ?? null);
  return id;
};

/** Creates version N+1 unless nothing changed. Returns null when the definition is identical. */
export const reviseProductTx = async (tx: Tx, ctx: Ctx, productId: string, input: ProductVersionInput) => {
  const product = await tx.product.findUnique({ where: { id: productId } });
  if (!product) throw new AppError("NOT_FOUND", "Product not found.");
  if (product.archivedAt) throw new AppError("CONFLICT", "Restore the product before changing it.");
  const current = await tx.productVersion.findUniqueOrThrow({
    where: { productId_version: { productId, version: product.currentVersion } },
    include: versionInclude,
  });
  const v = normalizeVersion(input);
  if (sameDefinition(v, asNormalized(current))) return null;
  await checkComponents(tx, productId, v);
  const next = product.currentVersion + 1;
  await tx.product
    .update({ where: { id: productId }, data: { currentVersion: next, gtin: v.gtin } })
    .catch((e) => gtinConflict(e, v.gtin));
  await writeVersion(tx, ctx, productId, next, v, input.changeNote ?? null);
  return next;
};

const loadProduct = async (tx: Tx, id: string): Promise<z.infer<typeof Product>> => {
  const p = await tx.product.findUnique({ where: { id } });
  if (!p) throw new AppError("NOT_FOUND", "Product not found.");
  const current = await tx.productVersion.findUniqueOrThrow({
    where: { productId_version: { productId: id, version: p.currentVersion } },
    include: versionInclude,
  });
  return {
    id: p.id,
    sku: p.sku,
    currentVersion: p.currentVersion,
    archivedAt: iso(p.archivedAt),
    current: versionDto(current),
  };
};

export const createProduct = (db: Db, ctx: Ctx, input: z.infer<typeof ProductCreateInput>) =>
  runCommand(db, ctx, async (tx) => {
    const id = await createProductTx(tx, ctx, input);
    return {
      result: await loadProduct(tx, id),
      audit: [
        {
          action: "product.created",
          resourceType: "product",
          resourceId: id,
          data: { sku: input.sku, version: 1 },
        },
      ],
    };
  });

export const reviseProduct = (db: Db, ctx: Ctx, productId: string, input: ProductVersionInput) =>
  runCommand(db, ctx, async (tx) => {
    const version = await reviseProductTx(tx, ctx, productId, input);
    return {
      result: { changed: version !== null, product: await loadProduct(tx, productId) },
      audit: [
        version === null
          ? { action: "product.revision_unchanged", resourceType: "product", resourceId: productId }
          : { action: "product.revised", resourceType: "product", resourceId: productId, data: { version } },
      ],
    };
  });

export const setProductArchived = (db: Db, ctx: Ctx, productId: string, archived: boolean) =>
  runCommand(db, ctx, async (tx) => {
    const p = await tx.product.findUnique({ where: { id: productId } });
    if (!p) throw new AppError("NOT_FOUND", "Product not found.");
    await tx.product.update({
      where: { id: productId },
      data: { archivedAt: archived ? (p.archivedAt ?? new Date()) : null },
    });
    return {
      result: await loadProduct(tx, productId),
      audit: [
        {
          action: archived ? "product.archived" : "product.restored",
          resourceType: "product",
          resourceId: productId,
        },
      ],
    };
  });

export const getProduct = (db: Db, orgId: string, id: string) =>
  withTenant(db, orgId, (tx) => loadProduct(tx, id));

export const listProductVersions = (db: Db, orgId: string, productId: string) =>
  withTenant(db, orgId, async (tx) => {
    if (!(await tx.product.count({ where: { id: productId } })))
      throw new AppError("NOT_FOUND", "Product not found.");
    const rows = await tx.productVersion.findMany({
      where: { productId },
      orderBy: { version: "desc" },
      include: versionInclude,
    });
    return rows.map(versionDto);
  });

export const getProductVersion = (db: Db, orgId: string, productId: string, version: number) =>
  withTenant(db, orgId, async (tx) => {
    const v = await tx.productVersion.findUnique({
      where: { productId_version: { productId, version } },
      include: versionInclude,
    });
    if (!v) throw new AppError("NOT_FOUND", "Product version not found.");
    return versionDto(v);
  });

export const listProducts = (
  db: Db,
  orgId: string,
  opts: { category?: string; q?: string; includeArchived: boolean },
) =>
  withTenant(db, orgId, async (tx): Promise<z.infer<typeof ProductSummary>[]> => {
    const products = await tx.product.findMany({
      where: opts.includeArchived ? {} : { archivedAt: null },
      orderBy: { sku: "asc" },
      take: 2000,
    });
    if (!products.length) return [];
    const versions = await tx.productVersion.findMany({
      where: { OR: products.map((p) => ({ productId: p.id, version: p.currentVersion })) },
      select: { productId: true, name: true, category: true, uomCode: true },
    });
    const byId = new Map(versions.map((v) => [v.productId, v]));
    const q = opts.q?.toLowerCase();
    return products
      .map((p) => {
        const v = byId.get(p.id);
        return {
          id: p.id,
          sku: p.sku,
          name: v?.name ?? p.sku,
          category: (v?.category ?? "other") as z.infer<typeof ProductSummary>["category"],
          gtin: p.gtin,
          uomCode: v?.uomCode ?? "unit",
          currentVersion: p.currentVersion,
          archivedAt: iso(p.archivedAt),
        };
      })
      .filter(
        (p) =>
          (!opts.category || p.category === opts.category) &&
          (!q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)),
      );
  });

export const listUoms = (db: Db) =>
  db.uom.findMany({ orderBy: [{ dimension: "asc" }, { toBase: "desc" }] }).then((rows) =>
    rows.map((u) => ({
      code: u.code,
      name: u.name,
      dimension: u.dimension as "mass" | "volume" | "count",
      toBase: u.toBase.toNumber(),
    })),
  );
