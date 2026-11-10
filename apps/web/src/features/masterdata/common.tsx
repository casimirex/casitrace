import type { components } from "@casitrace/api-client";
import { useOutletContext } from "react-router";
import { ApiError } from "../../lib/api";

export type Org = components["schemas"]["Organisation"];
export const useOrgContext = () => useOutletContext<Org>();
export const useCan = () => {
  const org = useOrgContext();
  return (permission: string) => org.myPermissions.includes(permission);
};

/** Turns an API validation error into per-field messages keyed by the field path. */
export const fieldErrors = (e: unknown): Record<string, string> => {
  if (!(e instanceof ApiError) || !e.details) return {};
  return Object.fromEntries(e.details.filter((d) => d.path).map((d) => [d.path as string, d.message]));
};

/** Reads a form into a plain object, turning empty strings into null. */
export const formValues = (form: HTMLFormElement) => {
  const out: Record<string, string | null> = {};
  for (const [k, v] of new FormData(form))
    out[k] = typeof v === "string" && v.trim() !== "" ? v.trim() : null;
  return out;
};

export const numberOrNull = (v: string | null) => (v === null ? null : Number(v.replace(",", ".")));
export const fmtHa = (n: number | null) =>
  n == null ? "—" : `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })} ha`;
