import { newId } from "@casitrace/shared";
import * as OTPAuth from "otpauth";
import { type buildApp, db, env } from "./helpers";

export type TestApp = ReturnType<typeof buildApp>;
export const PASSWORD = "correct horse battery staple";

const randomIp = () =>
  `10.${(Math.random() * 255) | 0}.${(Math.random() * 255) | 0}.${(Math.random() * 255) | 0}`;

export interface Client {
  ip: string;
  cookies: Map<string, string>;
  cookieHeader(): string;
  call(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<Response>;
}

/** A cookie-keeping client for one simulated browser, sending the web origin like a real browser would. */
export const client = (app: TestApp, ip = randomIp()): Client => {
  const cookies = new Map<string, string>();
  const self: Client = {
    ip,
    cookies,
    cookieHeader: () => [...cookies].map(([k, v]) => `${k}=${v}`).join("; "),
    async call(method, path, body, headers = {}) {
      const res = await app.request(path, {
        method,
        headers: {
          origin: env.WEB_ORIGIN,
          "x-forwarded-for": ip,
          // FormData sets its own multipart boundary header.
          ...(body !== undefined && !(body instanceof FormData)
            ? { "content-type": "application/json" }
            : {}),
          ...(cookies.size ? { cookie: self.cookieHeader() } : {}),
          ...headers,
        },
        ...(body !== undefined ? { body: body instanceof FormData ? body : JSON.stringify(body) } : {}),
      });
      for (const c of res.headers.getSetCookie()) {
        const [pair] = c.split(";");
        const [name, ...rest] = (pair ?? "").split("=");
        const value = rest.join("=");
        if (!name) continue;
        if (value === "" || /max-age=0/i.test(c)) cookies.delete(name);
        else cookies.set(name, value);
      }
      return res;
    },
  };
  return self;
};

export const uniqueEmail = (tag = "user") => `${tag}-${newId()}@example.test`;

/** The most recent queued email of a template to an address (emails go through the outbox). */
export const lastEmail = async (to: string, template: string) => {
  const rows = await db.outboxEvent.findMany({
    where: { type: "email.requested", payload: { path: ["to"], equals: to } },
    orderBy: { id: "desc" },
  });
  const row = rows.find((r) => (r.payload as { template?: string }).template === template);
  if (!row) throw new Error(`no ${template} email to ${to}`);
  return row.payload as { template: string; to: string; data: { url: string } & Record<string, string> };
};

/** Turns an absolute link from an email into an in-app path. */
export const pathOf = (url: string) => {
  const u = new URL(url);
  return `${u.pathname}${u.search}`;
};

export const signUp = (c: Client, email: string, name = "Test User", password = PASSWORD) =>
  c.call("POST", "/api/v1/auth/sign-up/email", { email, name, password });

export const signIn = (c: Client, email: string, password = PASSWORD) =>
  c.call("POST", "/api/v1/auth/sign-in/email", { email, password });

/** Registers, follows the verification link from the queued email, and returns a signed-in client. */
export const verifiedUser = async (app: TestApp, tag = "user") => {
  const c = client(app);
  const email = uniqueEmail(tag);
  const res = await signUp(c, email, `${tag} person`);
  if (res.status !== 200) throw new Error(`sign-up failed: ${res.status} ${await res.text()}`);
  const mail = await lastEmail(email, "verify-email");
  const verify = await c.call("GET", pathOf(mail.data.url));
  if (verify.status >= 400) throw new Error(`verify failed: ${verify.status} ${await verify.text()}`);
  if (!c.cookies.size) {
    const s = await signIn(c, email);
    if (s.status !== 200) throw new Error(`sign-in failed: ${s.status}`);
  }
  const me = (await (await c.call("GET", "/api/v1/me")).json()) as { user: { id: string } };
  return { client: c, email, userId: me.user.id };
};

export const createOrg = async (c: Client, name = "Org") => {
  const slug = `org-${newId()}`;
  const res = await c.call("POST", "/api/v1/auth/organization/create", { name, slug });
  if (res.status !== 200) throw new Error(`create org failed: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { id: string }).id;
};

/** Invites `invitee` to the org with a role and accepts the invitation as them. */
export const addMember = async (
  owner: Client,
  orgId: string,
  invitee: { client: Client; email: string },
  role: string,
) => {
  const inv = await owner.call("POST", "/api/v1/auth/organization/invite-member", {
    organizationId: orgId,
    email: invitee.email,
    role,
  });
  if (inv.status !== 200) throw new Error(`invite failed: ${inv.status} ${await inv.text()}`);
  const { id } = (await inv.json()) as { id: string };
  const acc = await invitee.client.call("POST", "/api/v1/auth/organization/accept-invitation", {
    invitationId: id,
  });
  if (acc.status !== 200) throw new Error(`accept failed: ${acc.status} ${await acc.text()}`);
  return id;
};

export const totpFor = (totpURI: string) => OTPAuth.URI.parse(totpURI) as OTPAuth.TOTP;
