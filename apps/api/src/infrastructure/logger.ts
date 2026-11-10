import pino from "pino";

export type Logger = pino.Logger;

export const createLogger = (level: string, base: Record<string, unknown> = {}): Logger =>
  pino({
    level,
    base: { service: "casitrace-api", ...base },
    redact: {
      paths: ["req.headers.authorization", "req.headers.cookie", "*.password", "*.token", "*.secret"],
      censor: "[redacted]",
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
