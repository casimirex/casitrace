import { createApiClient } from "@casitrace/api-client";

/** Single typed API client. The API is served under /api on the same origin (dev: Vite proxy). */
export const api = createApiClient(import.meta.env.VITE_API_BASE_URL ?? "/api");

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

/** Unwraps an openapi-fetch result, throwing ApiError with the server's message on failure. */
export const unwrap = <T>(r: { data?: T; error?: unknown; response: Response }): T => {
  if (r.data !== undefined && r.response.ok) return r.data;
  const env = r.error as { error?: { message?: string; code?: string } } | undefined;
  throw new ApiError(
    env?.error?.message ?? `Request failed (${r.response.status})`,
    r.response.status,
    env?.error?.code,
  );
};
