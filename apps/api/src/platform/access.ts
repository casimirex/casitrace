import { can, type Permission, type PlatformRole } from "@casitrace/contracts";
import { AppError } from "@casitrace/shared";
import type { RouteConfig } from "@hono/zod-openapi";
import type { Context, MiddlewareHandler } from "hono";
import type { AppEnv, AuthSession, Deps } from "../context";

/**
 * Who may call a route (roadmap-v2 §4.3). Every /api/v1 route declares one; the declaration both
 * installs the guard and is published as `x-access` in the OpenAPI document, where the isolation
 * suite reads it (a route without it fails CI).
 */
export type Access =
  | { kind: "public" }
  | { kind: "user" }
  | { kind: "org"; permission?: Permission }
  | { kind: "platform"; roles: readonly PlatformRole[] };

export const accessLabel = (a: Access): string => {
  switch (a.kind) {
    case "public":
    case "user":
      return a.kind;
    case "org":
      return a.permission ? `org:${a.permission}` : "org";
    case "platform":
      return `platform:${a.roles.join("|")}`;
  }
};

export const loadSession = async (c: Context<AppEnv>, deps: Deps): Promise<AuthSession | null> => {
  const cached = c.get("session");
  if (cached !== undefined) return cached;
  const session = await deps.auth.api.getSession({ headers: c.req.raw.headers });
  c.set("session", session);
  return session;
};

export const requireSession = async (c: Context<AppEnv>, deps: Deps): Promise<AuthSession> => {
  const session = await loadSession(c, deps);
  if (!session) throw new AppError("UNAUTHENTICATED", "Sign in to continue.");
  return session;
};

const guard =
  (deps: Deps, access: Access): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    if (access.kind === "public") return next();
    const session = await requireSession(c, deps);

    if (access.kind === "org") {
      const orgId = c.req.param("orgId");
      // Non-members get 404, not 403, so organisation IDs cannot be probed.
      const member = orgId
        ? await deps.db.member.findFirst({
            where: { organizationId: orgId, userId: session.user.id },
            select: { organizationId: true, role: true },
          })
        : null;
      if (!member) throw new AppError("NOT_FOUND", "Organisation not found.");
      if (access.permission && !can(member.role, access.permission)) {
        throw new AppError("FORBIDDEN", "Your role does not allow this action.", [
          { message: `requires ${access.permission}` },
        ]);
      }
      c.set("membership", member);
    }

    if (access.kind === "platform") {
      const role = session.user.platformRole;
      if (!role || !(access.roles as readonly string[]).includes(role)) {
        throw new AppError("NOT_FOUND", `No route for ${c.req.method} ${c.req.path}`);
      }
      if (!session.user.twoFactorEnabled) {
        throw new AppError("MFA_REQUIRED", "Platform staff must enable two-factor authentication.");
      }
    }
    return next();
  };

/** Adds the access guard and the `x-access` label to a route definition. */
export const withAccess = <R extends RouteConfig>(deps: Deps, access: Access, route: R) =>
  ({
    ...route,
    "x-access": accessLabel(access),
    middleware: [guard(deps, access)],
  }) as R & { "x-access": string; middleware: MiddlewareHandler<AppEnv>[] };
