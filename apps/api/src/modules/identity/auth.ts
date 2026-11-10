import { ac, roles } from "@casitrace/contracts";
import type { Db } from "@casitrace/db";
import { newId } from "@casitrace/shared";
import { APIError, betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { organization, twoFactor } from "better-auth/plugins";
import type { Logger } from "../../infrastructure/logger";
import { type AuditEntry, writeAudit } from "../../platform/audit";
import { requestEmail } from "../../platform/email";
import { emailHash, LOCKOUT_MINUTES, lockedUntil, recordFailure, recordSuccess } from "./login-throttle";

export const AUTH_BASE_PATH = "/api/v1/auth";

export interface AuthConfig {
  db: Db;
  logger: Logger;
  secret: string;
  /** Public origin of the web app; the API is served under `${webOrigin}/api`. */
  webOrigin: string;
  /** Rate limiting is on everywhere except where a test explicitly turns it off. */
  rateLimit?: boolean;
}

type Body = Record<string, unknown> | undefined;
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

/** Maps successful Better Auth endpoints to audit actions (NFR: every state change is audited). */
const AUDITED: Record<string, { action: string; resourceType: string }> = {
  "/sign-up/email": { action: "user.registered", resourceType: "user" },
  "/sign-in/email": { action: "user.signed_in", resourceType: "user" },
  "/sign-out": { action: "user.signed_out", resourceType: "user" },
  "/verify-email": { action: "user.email_verified", resourceType: "user" },
  "/request-password-reset": { action: "user.password_reset_requested", resourceType: "user" },
  "/reset-password": { action: "user.password_reset", resourceType: "user" },
  "/change-password": { action: "user.password_changed", resourceType: "user" },
  "/update-user": { action: "user.updated", resourceType: "user" },
  "/delete-user": { action: "user.deleted", resourceType: "user" },
  "/revoke-session": { action: "user.session_revoked", resourceType: "session" },
  "/revoke-other-sessions": { action: "user.sessions_revoked", resourceType: "session" },
  "/two-factor/enable": { action: "user.mfa_enrolment_started", resourceType: "user" },
  "/two-factor/verify-totp": { action: "user.mfa_verified", resourceType: "user" },
  "/two-factor/disable": { action: "user.mfa_disabled", resourceType: "user" },
  "/organization/create": { action: "organisation.created", resourceType: "organisation" },
  "/organization/update": { action: "organisation.updated", resourceType: "organisation" },
  "/organization/delete": { action: "organisation.deleted", resourceType: "organisation" },
  "/organization/invite-member": { action: "invitation.created", resourceType: "invitation" },
  "/organization/cancel-invitation": { action: "invitation.cancelled", resourceType: "invitation" },
  "/organization/accept-invitation": { action: "invitation.accepted", resourceType: "invitation" },
  "/organization/reject-invitation": { action: "invitation.rejected", resourceType: "invitation" },
  "/organization/remove-member": { action: "member.removed", resourceType: "member" },
  "/organization/update-member-role": { action: "member.role_changed", resourceType: "member" },
  "/organization/leave": { action: "member.left", resourceType: "member" },
};

const SENSITIVE_KEYS = /password|token|secret|code|otp|backup/i;
/** Audit data keeps non-sensitive request fields only. */
const safeBody = (body: Body): Record<string, string | number | boolean> => {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(body ?? {})) {
    if (SENSITIVE_KEYS.test(k) || k === "email") continue;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[k] = v;
  }
  return out;
};

const idOf = (v: unknown): string | null => {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  return str(o.id) ?? idOf(o.user) ?? idOf(o.member) ?? idOf(o.invitation) ?? null;
};

export const createAuth = (cfg: AuthConfig) => {
  const { db, logger } = cfg;

  return betterAuth({
    appName: "Casitrace",
    logger: {
      log: (level, message, ...args) => logger[level]({ args }, `better-auth: ${message}`),
    },
    telemetry: { enabled: false },
    secret: cfg.secret,
    baseURL: cfg.webOrigin,
    basePath: AUTH_BASE_PATH,
    trustedOrigins: [cfg.webOrigin],
    database: prismaAdapter(db, { provider: "postgresql" }),
    advanced: {
      database: { generateId: () => newId() },
      useSecureCookies: true,
      // Explicit, so tests run the same CSRF/origin checks as production (Better Auth skips them when NODE_ENV=test).
      disableOriginCheck: false,
      disableCSRFCheck: false,
      ipAddress: { ipAddressHeaders: ["x-forwarded-for", "x-real-ip"] },
    },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24, freshAge: 60 * 15 },
    rateLimit: {
      enabled: cfg.rateLimit ?? true,
      storage: "database",
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 60, max: 10 },
        "/sign-up/email": { window: 60, max: 5 },
        "/request-password-reset": { window: 60, max: 3 },
        "/two-factor/verify-totp": { window: 60, max: 10 },
      },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 60 * 30,
      sendResetPassword: async ({ user, url }) => {
        await requestEmail(db, {
          template: "reset-password",
          to: user.email,
          data: { name: user.name, url },
        });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      expiresIn: 60 * 60 * 24,
      sendVerificationEmail: async ({ user, url }) => {
        await requestEmail(db, { template: "verify-email", to: user.email, data: { name: user.name, url } });
      },
    },
    user: {
      additionalFields: { platformRole: { type: "string", required: false, input: false } },
      deleteUser: {
        enabled: true,
        beforeDelete: async (user) => {
          // An organisation must never be left without an owner.
          const owned = await db.member.findMany({ where: { userId: user.id, role: "owner" } });
          for (const m of owned) {
            const owners = await db.member.count({
              where: { organizationId: m.organizationId, role: "owner" },
            });
            if (owners <= 1) {
              throw new APIError("BAD_REQUEST", {
                message: "You are the only owner of an organisation. Transfer ownership or delete it first.",
              });
            }
          }
        },
      },
    },
    plugins: [
      twoFactor({ issuer: "Casitrace" }),
      organization({
        ac,
        roles,
        creatorRole: "owner",
        allowUserToCreateOrganization: true,
        invitationExpiresIn: 60 * 60 * 24 * 7,
        cancelPendingInvitationsOnReInvite: true,
        requireEmailVerificationOnInvitation: true,
        sendInvitationEmail: async ({ id, email, role, organization: org, inviter }) => {
          await requestEmail(db, {
            template: "invitation",
            to: email,
            data: {
              organisationName: org.name,
              inviterName: inviter.user.name,
              role,
              url: `${cfg.webOrigin}/invitations/${id}`,
            },
          });
        },
      }),
    ],
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/sign-in/email") return;
        const email = str((ctx.body as Body)?.email);
        if (!email) return;
        const until = await lockedUntil(db, email);
        if (until) {
          throw new APIError("TOO_MANY_REQUESTS", {
            message: `Too many failed sign-in attempts. Try again after ${until.toISOString()}.`,
            code: "ACCOUNT_LOCKED",
          });
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        const body = ctx.body as Body;
        const returned = ctx.context.returned;
        const failed = returned instanceof APIError;
        const requestId = ctx.request?.headers.get("x-request-id") ?? null;

        try {
          if (ctx.path === "/sign-in/email") {
            const email = str(body?.email);
            if (email && failed && returned.status === "UNAUTHORIZED") {
              const { locked } = await recordFailure(db, email);
              await writeAudit(db, { actor: { type: "user", id: null }, orgId: null, requestId }, [
                {
                  action: locked ? "user.locked_out" : "user.sign_in_failed",
                  resourceType: "user",
                  resourceId: null,
                  data: { emailHash: emailHash(email), ...(locked ? { minutes: LOCKOUT_MINUTES } : {}) },
                },
              ]);
              return;
            }
            if (email && !failed) await recordSuccess(db, email);
          }

          const audited = AUDITED[ctx.path];
          if (!audited || failed) return;
          // Organisation endpoints don't expose the session to after-hooks; read it from the request.
          const session =
            ctx.context.session ??
            ctx.context.newSession ??
            (ctx.path === "/sign-out" ? null : await getSessionFromCtx(ctx).catch(() => null));
          const actorId = session?.user.id ?? (ctx.path === "/sign-up/email" ? idOf(returned) : null);
          const orgId =
            str(body?.organizationId) ??
            (ctx.path === "/organization/create" ? idOf(returned) : null) ??
            str((returned as { member?: { organizationId?: unknown } } | null)?.member?.organizationId) ??
            (ctx.path.startsWith("/organization/") ? (session?.session.activeOrganizationId ?? null) : null);
          const entry: AuditEntry = {
            action: audited.action,
            resourceType: audited.resourceType,
            resourceId: idOf(returned) ?? actorId,
            data: safeBody(body),
          };
          await writeAudit(db, { actor: { type: "user", id: actorId }, orgId, requestId }, [entry]);
        } catch (err) {
          // Auditing must not be silently skipped: log loudly. (Better Auth writes outside our transaction.)
          logger.error({ err, path: ctx.path }, "auth audit write failed");
        }
      }),
    },
  });
};

export type Auth = ReturnType<typeof createAuth>;
