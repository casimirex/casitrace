import { z } from "@hono/zod-openapi";

/** Standard error envelope returned by every failing request. */
export const ErrorEnvelope = z
  .object({
    error: z.object({
      code: z.string().openapi({ example: "VALIDATION_FAILED" }),
      message: z.string(),
      details: z.array(z.object({ path: z.string().optional(), message: z.string() })),
      requestId: z.string(),
    }),
  })
  .openapi("ErrorEnvelope");
export type ErrorEnvelope = z.infer<typeof ErrorEnvelope>;
