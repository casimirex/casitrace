import { afterAll, describe, expect, test } from "bun:test";
import { withPlatformAccess } from "../src/platform/tenant";
import {
  client,
  createOrg,
  lastEmail,
  PASSWORD,
  pathOf,
  signIn,
  signUp,
  totpFor,
  uniqueEmail,
  verifiedUser,
} from "./auth-helpers";
import { buildApp, db } from "./helpers";

afterAll(() => db.$disconnect());
const app = buildApp();

const auditActions = async (where: { actorId?: string; requestIds?: string[] }) =>
  withPlatformAccess(db, (tx) =>
    tx.auditLog.findMany({ where: where.actorId ? { actorId: where.actorId } : {}, orderBy: { id: "asc" } }),
  ).then((rows) => rows.map((r) => r.action));

describe("registration and email verification", () => {
  test("a new account cannot sign in until its email is verified", async () => {
    const c = client(app);
    const email = uniqueEmail();
    expect((await signUp(c, email)).status).toBe(200);
    expect(c.cookies.size).toBe(0);

    const blocked = await signIn(c, email);
    expect(blocked.status).toBe(403);

    const mail = await lastEmail(email, "verify-email");
    expect(mail.data.url).toStartWith("http://localhost:5173/api/v1/auth/verify-email?token=");
    await c.call("GET", pathOf(mail.data.url));
    const me = await c.call("GET", "/api/v1/me");
    expect(me.status).toBe(200);
    expect(((await me.json()) as { user: { emailVerified: boolean } }).user.emailVerified).toBe(true);
  });

  test("passwords shorter than 12 characters are rejected", async () => {
    const res = await signUp(client(app), uniqueEmail(), "Short", "short-pass1");
    expect(res.status).toBe(400);
  });

  test("session cookies are HttpOnly, Secure and SameSite=Lax", async () => {
    const { email } = await verifiedUser(app);
    const res = await signIn(client(app), email);
    const session = res.headers.getSetCookie().find((c) => c.includes("session_token"));
    expect(session).toBeDefined();
    expect(session).toMatch(/^__Secure-/);
    expect(session).toMatch(/HttpOnly/i);
    expect(session).toMatch(/Secure/);
    expect(session).toMatch(/SameSite=Lax/i);
  });

  test("registration and sign-in are audited", async () => {
    const { userId } = await verifiedUser(app);
    const actions = await auditActions({ actorId: userId });
    expect(actions).toContain("user.registered");
    expect(actions).toContain("user.email_verified");
  });
});

describe("sign-in protection", () => {
  test("five wrong passwords lock the account for 15 minutes, even with the right password after", async () => {
    const { email } = await verifiedUser(app);
    const c = client(app);
    for (let i = 0; i < 5; i++) expect((await signIn(c, email, "wrong password!!")).status).toBe(401);

    const locked = await signIn(c, email);
    expect(locked.status).toBe(429);
    expect(await locked.text()).toContain("ACCOUNT_LOCKED");
    const rows = await withPlatformAccess(db, (tx) =>
      tx.auditLog.findMany({ where: { action: "user.locked_out" }, orderBy: { id: "desc" }, take: 1 }),
    );
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0]?.data)).not.toContain(email);
  });

  test("an unknown email is locked out the same way (no account enumeration)", async () => {
    const c = client(app);
    const email = uniqueEmail("ghost");
    for (let i = 0; i < 5; i++) expect((await signIn(c, email)).status).toBe(401);
    expect((await signIn(c, email)).status).toBe(429);
  });

  test("more than 10 sign-in attempts a minute from one IP are rate limited", async () => {
    const c = client(app);
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await signIn(c, uniqueEmail("rl"))).status);
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  });
});

describe("password reset", () => {
  test("reset by emailed link revokes old sessions and sets the new password", async () => {
    const { client: old, email } = await verifiedUser(app);
    const c = client(app);
    const req = await c.call("POST", "/api/v1/auth/request-password-reset", {
      email,
      redirectTo: "http://localhost:5173/reset-password",
    });
    expect(req.status).toBe(200);

    const mail = await lastEmail(email, "reset-password");
    const link = await c.call("GET", pathOf(mail.data.url));
    const token = new URL(link.headers.get("location") ?? "", "http://x").searchParams.get("token");
    expect(token).toBeTruthy();

    const newPassword = "a brand new long password";
    expect((await c.call("POST", "/api/v1/auth/reset-password", { token, newPassword })).status).toBe(200);
    expect((await old.call("GET", "/api/v1/me")).status).toBe(401);
    expect((await signIn(client(app), email, PASSWORD)).status).toBe(401);
    expect((await signIn(client(app), email, newPassword)).status).toBe(200);
  });

  test("requesting a reset for an unknown email looks the same as for a real one", async () => {
    const res = await client(app).call("POST", "/api/v1/auth/request-password-reset", {
      email: uniqueEmail("nobody"),
      redirectTo: "http://localhost:5173/reset-password",
    });
    expect(res.status).toBe(200);
  });
});

describe("change password (audit F-6)", () => {
  test("needs the current password; is audited; signs out other devices; the old password stops working", async () => {
    const u = await verifiedUser(app, "pw-change");
    const other = client(app);
    expect((await signIn(other, u.email)).status).toBe(200);
    const newPassword = "a different long passphrase";

    const wrong = await u.client.call("POST", "/api/v1/auth/change-password", {
      currentPassword: "not my password at all",
      newPassword,
      revokeOtherSessions: true,
    });
    expect(wrong.status).toBeGreaterThanOrEqual(400);

    const ok = await u.client.call("POST", "/api/v1/auth/change-password", {
      currentPassword: PASSWORD,
      newPassword,
      revokeOtherSessions: true,
    });
    expect(ok.status).toBe(200);
    expect((await u.client.call("GET", "/api/v1/me")).status).toBe(200);
    expect((await other.call("GET", "/api/v1/me")).status).toBe(401);
    expect((await signIn(client(app), u.email)).status).toBe(401);
    expect((await signIn(client(app), u.email, newPassword)).status).toBe(200);
    expect(await auditActions({ actorId: u.userId })).toContain("user.password_changed");
  });
});

describe("sessions and CSRF", () => {
  test("sign-out ends the session", async () => {
    const { client: c } = await verifiedUser(app);
    expect((await c.call("POST", "/api/v1/auth/sign-out", {})).status).toBe(200);
    expect((await c.call("GET", "/api/v1/me")).status).toBe(401);
  });

  test("auth mutations from another origin are refused", async () => {
    const { client: c } = await verifiedUser(app);
    const res = await c.call(
      "POST",
      "/api/v1/auth/organization/create",
      { name: "x", slug: "x-evil" },
      {
        origin: "https://evil.example",
      },
    );
    expect(res.status).toBe(403);
  });

  test("cross-origin form posts to /api/v1 are refused", async () => {
    const res = await app.request("/api/v1/me", {
      method: "POST",
      headers: { origin: "https://evil.example", "content-type": "application/x-www-form-urlencoded" },
      body: "a=1",
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("FORBIDDEN");
  });
});

describe("two-factor authentication (TOTP)", () => {
  test("after enrolment, sign-in requires a valid TOTP code", async () => {
    const { client: c, email, userId } = await verifiedUser(app);
    const enable = await c.call("POST", "/api/v1/auth/two-factor/enable", { password: PASSWORD });
    expect(enable.status).toBe(200);
    const { totpURI, backupCodes } = (await enable.json()) as { totpURI: string; backupCodes: string[] };
    expect(backupCodes.length).toBeGreaterThan(0);
    const totp = totpFor(totpURI);
    expect(
      (await c.call("POST", "/api/v1/auth/two-factor/verify-totp", { code: totp.generate() })).status,
    ).toBe(200);
    expect((await db.user.findUniqueOrThrow({ where: { id: userId } })).twoFactorEnabled).toBe(true);

    const fresh = client(app);
    const first = await signIn(fresh, email);
    expect(((await first.json()) as { twoFactorRedirect?: boolean }).twoFactorRedirect).toBe(true);
    expect((await fresh.call("GET", "/api/v1/me")).status).toBe(401);
    expect((await fresh.call("POST", "/api/v1/auth/two-factor/verify-totp", { code: "000000" })).status).toBe(
      401,
    );
    expect(
      (await fresh.call("POST", "/api/v1/auth/two-factor/verify-totp", { code: totp.generate() })).status,
    ).toBe(200);
    expect((await fresh.call("GET", "/api/v1/me")).status).toBe(200);
  });
});

describe("personal data (GDPR)", () => {
  test("export includes the user's data and activity but no secrets", async () => {
    const { client: c, email, userId } = await verifiedUser(app, "export");
    await createOrg(c, "Export Farm");
    const res = await c.call("GET", "/api/v1/me/export");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain("attachment");
    const text = await res.text();
    const body = JSON.parse(text) as {
      user: { email: string };
      memberships: { organisationName: string; role: string }[];
      activity: { action: string }[];
    };
    expect(body.user.email).toBe(email);
    expect(body.memberships).toEqual([
      expect.objectContaining({ organisationName: "Export Farm", role: "owner" }),
    ]);
    expect(body.activity.map((a) => a.action)).toContain("organisation.created");
    expect(text).not.toMatch(/"password"|scrypt|\$argon/);
    expect(await auditActions({ actorId: userId })).toContain("user.data_exported");
  });

  test("the sole owner of an organisation cannot delete their account", async () => {
    const { client: c } = await verifiedUser(app, "owner");
    await createOrg(c, "Only Owner Ltd");
    const res = await c.call("POST", "/api/v1/auth/delete-user", { password: PASSWORD });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("only owner");
  });

  test("a user without sole ownership can delete their account", async () => {
    const { client: c, userId } = await verifiedUser(app, "leaver");
    const res = await c.call("POST", "/api/v1/auth/delete-user", { password: PASSWORD });
    expect(res.status).toBe(200);
    expect(await db.user.findUnique({ where: { id: userId } })).toBeNull();
  });
});
