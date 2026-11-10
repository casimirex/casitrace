import { ErrorEnvelope } from "@casitrace/contracts";
import { AppError } from "@casitrace/shared";
import type { Context } from "hono";
import type { AppEnv } from "../context";
import type { CommandContext } from "./audit";

export const json = <T>(schema: T) => ({ content: { "application/json": { schema } } });

export const errorResponses = {
  401: { description: "Not signed in", ...json(ErrorEnvelope) },
  403: { description: "Role does not allow this", ...json(ErrorEnvelope) },
  404: { description: "Not found", ...json(ErrorEnvelope) },
  409: { description: "Conflicts with existing data", ...json(ErrorEnvelope) },
  422: { description: "Invalid input", ...json(ErrorEnvelope) },
};

/** Command context for the signed-in user acting in the organisation of an /orgs/{orgId} route. */
export const orgCommand = (c: Context<AppEnv>): CommandContext & { orgId: string } => {
  const session = c.get("session");
  const membership = c.get("membership");
  if (!session || !membership) throw new AppError("UNAUTHENTICATED", "Sign in to continue.");
  return {
    actor: { type: "user", id: session.user.id },
    orgId: membership.organizationId,
    requestId: c.get("requestId"),
  };
};

export const userCommand = (c: Context<AppEnv>): CommandContext => {
  const session = c.get("session");
  if (!session) throw new AppError("UNAUTHENTICATED", "Sign in to continue.");
  return { actor: { type: "user", id: session.user.id }, orgId: null, requestId: c.get("requestId") };
};
