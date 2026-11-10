/** Small helpers for turning Prisma rows into API DTOs. */
export const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);
export const num = (d: { toNumber(): number } | null | undefined): number | null =>
  d == null ? null : d.toNumber();
export const isUniqueViolation = (e: unknown): e is { code: "P2002"; meta?: Record<string, unknown> } =>
  typeof e === "object" && e !== null && (e as { code?: unknown }).code === "P2002";
