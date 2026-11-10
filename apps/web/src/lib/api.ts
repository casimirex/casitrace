import { createApiClient } from "@casitrace/api-client";

/** Single typed API client. The API is served under /api on the same origin (dev: Vite proxy). */
export const api = createApiClient(import.meta.env.VITE_API_BASE_URL ?? "/api");

export interface ApiErrorDetail {
  path?: string;
  message: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly details: ApiErrorDetail[] = [],
  ) {
    super(message);
  }
}

/** Unwraps an openapi-fetch result, throwing ApiError with the server's message on failure. */
export const unwrap = <T>(r: { data?: T; error?: unknown; response: Response }): T => {
  if (r.data !== undefined && r.response.ok) return r.data;
  const env = r.error as
    | { error?: { message?: string; code?: string; details?: ApiErrorDetail[] } }
    | undefined;
  throw new ApiError(
    env?.error?.message ?? `Request failed (${r.response.status})`,
    r.response.status,
    env?.error?.code,
    env?.error?.details ?? [],
  );
};

/** Multipart upload (openapi-fetch serialises JSON only). Throws ApiError like unwrap. */
export const postForm = async <T>(path: string, form: FormData): Promise<T> => {
  const res = await fetch(`/api${path}`, { method: "POST", body: form, credentials: "include" });
  const body = (await res.json().catch(() => ({}))) as T & {
    error?: { message?: string; code?: string; details?: ApiErrorDetail[] };
  };
  if (res.ok) return body;
  throw new ApiError(
    body.error?.message ?? `Upload failed (${res.status})`,
    res.status,
    body.error?.code,
    body.error?.details ?? [],
  );
};
