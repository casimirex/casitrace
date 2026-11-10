import { swaggerUI } from "@hono/swagger-ui";
import { OpenAPIHono } from "@hono/zod-openapi";
import { secureHeaders } from "hono/secure-headers";
import type { AppEnv, Deps } from "./context";
import { fromZodError, onError, onNotFound } from "./middleware/errors";
import { requestContext } from "./middleware/request-context";
import { systemRoutes } from "./modules/system/routes";

export const API_INFO = {
  openapi: "3.1.0",
  info: {
    title: "Casitrace API",
    version: "v1",
    description:
      "Food traceability and evidence API. Versioned under /v1; /health and /ready are unversioned.",
  },
} as const;

/** Builds the HTTP app from injected dependencies. No I/O happens at construction time. */
export const createApp = (deps: Deps) => {
  const app = new OpenAPIHono<AppEnv>({
    // Route-level Zod validation failures use the standard error envelope.
    defaultHook: (result) => {
      if (!result.success) throw fromZodError(result.error);
    },
  });

  app.use("*", requestContext(deps.logger));
  app.use("*", secureHeaders());
  app.onError(onError);
  app.notFound(onNotFound);

  app.route("/", systemRoutes(deps));
  // Versioned business routes are mounted here from P2 onward: app.route("/v1", ...)

  app.doc31("/openapi.json", API_INFO);
  app.get("/docs", swaggerUI({ url: "/openapi.json" }));
  return app;
};

export type App = ReturnType<typeof createApp>;
