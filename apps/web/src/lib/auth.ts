import { ac, roles } from "@casitrace/contracts";
import { organizationClient, twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/** Better Auth client. The API serves auth under /api/v1/auth on the web origin (ADR 0009). */
export const authClient = createAuthClient({
  baseURL: window.location.origin,
  basePath: "/api/v1/auth",
  plugins: [
    organizationClient({ ac, roles }),
    twoFactorClient({
      onTwoFactorRedirect: () => {
        window.location.assign(`/sign-in/two-factor${window.location.search}`);
      },
    }),
  ],
});

export const errorMessage = (
  error: { message?: string; status?: number } | null | undefined,
  fallback: string,
) => error?.message || fallback;
