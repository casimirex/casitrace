import { createApiClient } from "@casitrace/api-client";

/** Single typed API client. The dev server proxies /api to the API (vite.config.ts). */
export const api = createApiClient(import.meta.env.VITE_API_BASE_URL ?? "/api");
