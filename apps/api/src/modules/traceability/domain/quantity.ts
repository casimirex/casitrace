import Decimal from "decimal.js";

/** Exact decimal arithmetic for quantities (ADR 0006). Never use floating point for stock. */
export { Decimal };
export const D = (v: string | number | Decimal | { toString(): string }) => new Decimal(v.toString());

const DIMENSION = { kg: "mass", g: "mass", t: "mass", l: "volume", ml: "volume", unit: "count" } as const;
const TO_BASE: Record<keyof typeof DIMENSION, string> = {
  kg: "1",
  g: "0.001",
  t: "1000",
  l: "1",
  ml: "0.001",
  unit: "1",
};
export type Uom = keyof typeof DIMENSION;
export const isUom = (u: string): u is Uom => u in DIMENSION;
export const dimensionOf = (u: Uom) => DIMENSION[u];

export interface Conversion {
  fromUom: string;
  toUom: string;
  factor: string | number | { toString(): string };
}

export class ConversionError extends Error {}

/** Converts between units of the same dimension (kg ↔ t, l ↔ ml). */
export const convertSameDimension = (q: Decimal, from: Uom, to: Uom): Decimal => {
  if (DIMENSION[from] !== DIMENSION[to])
    throw new ConversionError(`Cannot convert ${from} to ${to} without a product conversion`);
  return q.mul(TO_BASE[from]).div(TO_BASE[to]);
};

/**
 * Converts a quantity to kilograms using the product version's conversions
 * (e.g. unit → l from the bottle size, l → kg from the oil's density).
 */
export const toKg = (q: Decimal, uom: Uom, conversions: Conversion[]): Decimal => {
  const dim = DIMENSION[uom];
  const base = q.mul(TO_BASE[uom]); // kg, l or unit
  const factor = (from: string, to: string) => {
    const direct = conversions.find((c) => c.fromUom === from && c.toUom === to);
    if (direct) return D(direct.factor);
    const inverse = conversions.find((c) => c.fromUom === to && c.toUom === from);
    return inverse ? new Decimal(1).div(D(inverse.factor)) : null;
  };
  if (dim === "mass") return base;
  if (dim === "volume") {
    const lKg = factor("l", "kg");
    if (!lKg) throw new ConversionError("No litre → kg conversion (density) for this product");
    return base.mul(lKg);
  }
  const unitKg = factor("unit", "kg");
  if (unitKg) return base.mul(unitKg);
  const unitL = factor("unit", "l");
  const lKg = factor("l", "kg");
  if (unitL && lKg) return base.mul(unitL).mul(lKg);
  throw new ConversionError("No unit → kg conversion (or unit → l and density) for this product");
};

/** Quantities are stored with 6 decimals. */
export const fixed = (q: Decimal) =>
  q
    .toDecimalPlaces(6, Decimal.ROUND_HALF_EVEN)
    .toFixed(6)
    .replace(/\.?0+$/, "") || "0";
