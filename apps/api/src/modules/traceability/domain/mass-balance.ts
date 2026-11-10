import { D, type Decimal, fixed } from "./quantity";

/**
 * A transformation cannot create mass (roadmap-v2 §4.2): Σ outputs ≤ Σ inputs × (1 + tolerance).
 * Yield losses (olives → oil is typically 12–22 %) and waste are fine; gains beyond the measurement
 * tolerance are not.
 */
export const DEFAULT_TOLERANCE = "0.02";

export interface MassBalance {
  inputKg: string;
  outputKg: string;
  /** outputs / inputs, e.g. "0.175" for an 17.5 % oil yield. */
  ratio: string | null;
  tolerance: string;
  ok: boolean;
}

export const checkMassBalance = (
  inputsKg: Decimal[],
  outputsKg: Decimal[],
  tolerance = DEFAULT_TOLERANCE,
): MassBalance => {
  const input = inputsKg.reduce((s, q) => s.add(q), D(0));
  const output = outputsKg.reduce((s, q) => s.add(q), D(0));
  const limit = input.mul(D(1).add(tolerance));
  return {
    inputKg: fixed(input),
    outputKg: fixed(output),
    ratio: input.isZero() ? null : output.div(input).toDecimalPlaces(4).toString(),
    tolerance,
    ok: output.lte(limit),
  };
};
