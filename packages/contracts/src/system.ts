import { z } from "@hono/zod-openapi";

export const HealthResponse = z
  .object({ status: z.literal("ok"), service: z.string(), version: z.string() })
  .openapi("HealthResponse");

export const DependencyCheck = z.object({
  status: z.enum(["ok", "fail"]),
  latencyMs: z.number(),
  error: z.string().optional(),
});

export const ReadinessResponse = z
  .object({
    status: z.enum(["ok", "fail"]),
    checks: z.object({ database: DependencyCheck, storage: DependencyCheck }),
  })
  .openapi("ReadinessResponse");
export type ReadinessResponse = z.infer<typeof ReadinessResponse>;
