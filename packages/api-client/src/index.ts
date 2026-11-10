import createClient from "openapi-fetch";
import type { components, paths } from "./schema";

export type { components, paths };
export type ErrorEnvelope = components["schemas"]["ErrorEnvelope"];

/** Typed client generated from the API's OpenAPI document. Regenerate with `bun run openapi`. */
export const createApiClient = (baseUrl: string) => createClient<paths>({ baseUrl, credentials: "include" });
export type ApiClient = ReturnType<typeof createApiClient>;
