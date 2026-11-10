import { AppError } from "@casitrace/shared";
import { swaggerUI } from "@hono/swagger-ui";
import { OpenAPIHono } from "@hono/zod-openapi";
import { bodyLimit } from "hono/body-limit";
import { csrf } from "hono/csrf";
import { secureHeaders } from "hono/secure-headers";
import type { AppEnv, Deps } from "./context";
import { fromZodError, onError, onNotFound } from "./middleware/errors";
import { requestContext } from "./middleware/request-context";
import { accessRoutes } from "./modules/access/routes";
import { catalogRoutes } from "./modules/catalog/presentation/routes";
import { evidenceRoutes } from "./modules/evidence/presentation/routes";
import { exchangeRoutes } from "./modules/exchange/presentation/routes";
import { AUTH_BASE_PATH } from "./modules/identity/auth";
import { partiesRoutes } from "./modules/parties/presentation/routes";
import { publicationRoutes } from "./modules/publication/presentation/routes";
import { systemRoutes } from "./modules/system/routes";
import { traceabilityRoutes } from "./modules/traceability/presentation/routes";

export const API_INFO: {
  openapi: "3.1.0";
  servers: { url: string; description: string }[];
  info: { title: string; version: string; description: string };
} = {
  openapi: "3.1.0",
  servers: [{ url: "/api", description: "Same origin as the web app" }],
  info: {
    title: "Casitrace API",
    version: "v1",
    description:
      "Food traceability and evidence API, served under /api. Business routes are versioned under /api/v1. " +
      "Authentication endpoints (Better Auth) live under /api/v1/auth. Each operation's `x-access` states who may call it.",
  },
};

/** Builds the HTTP app from injected dependencies. No I/O happens at construction time. */
export const createApp = (deps: Deps) => {
  const newRouter = () =>
    new OpenAPIHono<AppEnv>({
      // Route-level Zod validation failures use the standard error envelope.
      defaultHook: (result) => {
        if (!result.success) throw fromZodError(result.error);
      },
    });

  const v1 = newRouter();
  // Mutations must come from the web origin (cookie-authenticated CSRF defence; no CORS is enabled).
  v1.use("*", csrf({ origin: deps.webOrigin }));
  // JSON bodies up to 3 MB (CSV imports); evidence uploads up to 25 MB plus multipart overhead.
  const tooLarge = () => {
    throw new AppError("VALIDATION_FAILED", "Request body is too large.");
  };
  const jsonLimit = bodyLimit({ maxSize: 3 * 1024 * 1024, onError: tooLarge });
  const uploadLimit = bodyLimit({ maxSize: 26 * 1024 * 1024, onError: tooLarge });
  const isUpload = (path: string) => /\/evidence(\/[0-9a-f-]+\/files)?$/.test(path);
  v1.use("*", (c, next) =>
    c.req.method === "POST" && isUpload(c.req.path) ? uploadLimit(c, next) : jsonLimit(c, next),
  );
  v1.route("/", accessRoutes(deps));
  v1.route("/", partiesRoutes(deps));
  v1.route("/", catalogRoutes(deps));
  v1.route("/", evidenceRoutes(deps));
  v1.route("/", traceabilityRoutes(deps));
  v1.route("/", exchangeRoutes(deps));
  v1.route("/", publicationRoutes(deps));

  const api = newRouter();
  api.route("/", systemRoutes(deps));
  // Better Auth handles its own CSRF (trusted origins), rate limits and validation.
  api.on(["GET", "POST"], `${AUTH_BASE_PATH.replace(/^\/api/, "")}/*`, (c) => deps.auth.handler(c.req.raw));
  api.route("/v1", v1);
  api.doc31("/openapi.json", API_INFO);
  api.get("/docs", swaggerUI({ url: "/api/openapi.json" }));

  const app = newRouter();
  app.use("*", requestContext(deps.logger));
  app.use("*", secureHeaders());
  app.onError(onError);
  app.notFound(onNotFound);
  app.route("/api", api);
  return app;
};

export type App = ReturnType<typeof createApp>;
