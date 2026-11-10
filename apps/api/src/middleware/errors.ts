import type { ErrorEnvelope } from "@casitrace/contracts";
import { AppError, isAppError } from "@casitrace/shared";
import type { Context, ErrorHandler, NotFoundHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { ZodError } from "zod";
import type { AppEnv } from "../context";

const envelope = (c: Context<AppEnv>, err: AppError): ErrorEnvelope => ({
  error: { code: err.code, message: err.message, details: err.details, requestId: c.get("requestId") ?? "" },
});

export const fromZodError = (error: ZodError): AppError =>
  new AppError(
    "VALIDATION_FAILED",
    "The request is invalid.",
    error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
  );

export const onError: ErrorHandler<AppEnv> = (err, c) => {
  let appErr: AppError;
  if (isAppError(err)) {
    appErr = err;
  } else if (err instanceof HTTPException) {
    appErr = new AppError(
      err.status === 404 ? "NOT_FOUND" : "VALIDATION_FAILED",
      err.message || "Bad request",
    );
  } else {
    c.get("logger")?.error({ err }, "unhandled error");
    appErr = new AppError("INTERNAL", "Something went wrong. Quote the request ID when reporting it.");
  }
  return c.json(envelope(c, appErr), appErr.status as ContentfulStatusCode);
};

export const onNotFound: NotFoundHandler<AppEnv> = (c) =>
  c.json(envelope(c, new AppError("NOT_FOUND", `No route for ${c.req.method} ${c.req.path}`)), 404);
