import type { Context } from "hono";

const IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/;
const IPV6 = /^[0-9a-f:.]+$/i;
const isIp = (s: string) =>
  (IPV4.test(s) && s.split(".").every((n) => Number(n) <= 255)) || (s.includes(":") && IPV6.test(s));

/**
 * The client IP as set by our reverse proxy (threat model T-2). The proxy (Caddy) replaces
 * X-Forwarded-For with the connecting address, so a trustworthy value is exactly one IP. A list or a
 * malformed value means the header came from the client: it is not trusted and such requests share one
 * bucket ("untrusted"), the same rule Better Auth applies to sign-in limits. The API must only be
 * reachable through the proxy (infrastructure/production).
 */
export const clientIp = (c: Context): string => {
  const xff = c.req.header("x-forwarded-for");
  if (xff !== undefined) {
    const v = xff.trim();
    return isIp(v) ? v.toLowerCase() : "untrusted";
  }
  return "local";
};
