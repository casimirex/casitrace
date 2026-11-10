/**
 * Tenant isolation gate (roadmap-v2 P2, NFR "0 cross-tenant reads or writes").
 *
 * Reads every operation from the published OpenAPI document. Each must declare `x-access`; then each
 * is called as the wrong actor and must refuse. Adding a route therefore adds it to this suite
 * automatically, and a route without a declaration fails CI.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { newId } from "@casitrace/shared";
import { addMember, type Client, client, createOrg, PASSWORD, totpFor, verifiedUser } from "./auth-helpers";
import { buildApp, db } from "./helpers";

afterAll(() => db.$disconnect());
const app = buildApp();

interface Operation {
  method: string;
  path: string;
  access: string | undefined;
}

const ACCESS_FORMAT = /^(public|user|org(:[a-z]+:[a-z]+)?|platform:[a-z_|]+)$/;
/** Values used for path parameters. orgId is the organisation under attack; others are plausible but random. */
const PARAM_VALUES: Record<string, (orgId: string) => string> = {
  orgId: (orgId) => orgId,
  organizationId: (orgId) => orgId,
  locationId: () => newId(),
  partnerId: () => newId(),
  productId: () => newId(),
  version: () => "1",
  kind: () => "products",
  evidenceId: () => newId(),
  linkId: () => newId(),
  notificationId: () => newId(),
};
/** Operations whose only path parameters are these can be called successfully by a member. */
const LISTING_PARAMS = new Set(["orgId", "kind"]);

const operations = async (): Promise<Operation[]> => {
  const doc = (await (await app.request("/api/openapi.json")).json()) as {
    servers: { url: string }[];
    paths: Record<string, Record<string, { "x-access"?: string }>>;
  };
  const base = doc.servers[0]?.url ?? "";
  return Object.entries(doc.paths).flatMap(([path, ops]) =>
    Object.entries(ops).map(([method, op]) => ({
      method: method.toUpperCase(),
      path: `${base}${path}`,
      access: op["x-access"],
    })),
  );
};

const fill = (path: string, orgId: string) =>
  path.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = PARAM_VALUES[name];
    if (!value)
      throw new Error(`isolation suite does not know path parameter {${name}}; add it to PARAM_VALUES`);
    return value(orgId);
  });

const send = (c: Client | null, op: Operation, orgId: string) => {
  const body = op.method === "GET" || op.method === "DELETE" ? undefined : {};
  const path = fill(op.path, orgId);
  // Anonymous requests look like a browser on the web origin, so they pass CSRF and reach the auth check.
  return c ? c.call(op.method, path, body) : client(app).call(op.method, path, body);
};

let ops: Operation[] = [];
let alice: Awaited<ReturnType<typeof verifiedUser>>; // owner of org A
let bob: Awaited<ReturnType<typeof verifiedUser>>; // owner of org B only
let orgA = "";
let orgB = "";

beforeAll(async () => {
  ops = await operations();
  alice = await verifiedUser(app, "alice");
  bob = await verifiedUser(app, "bob");
  orgA = await createOrg(alice.client, "Org A");
  orgB = await createOrg(bob.client, "Org B");
});

describe("route coverage", () => {
  test("every operation declares a valid x-access", () => {
    expect(ops.length).toBeGreaterThan(0);
    const missing = ops.filter((o) => !o.access || !ACCESS_FORMAT.test(o.access));
    expect(missing).toEqual([]);
  });

  test("organisation routes take {orgId} and only organisation routes do", () => {
    for (const op of ops) {
      expect(op.access?.startsWith("org")).toBe(op.path.includes("{orgId}"));
    }
  });
});

describe("anonymous callers", () => {
  test("every non-public operation returns 401", async () => {
    const results = await Promise.all(
      ops
        .filter((o) => o.access !== "public")
        .map(async (o) => [`${o.method} ${o.path}`, (await send(null, o, orgA)).status]),
    );
    expect(results.filter(([, s]) => s !== 401)).toEqual([]);
  });
});

describe("cross-tenant access", () => {
  test("a member of another organisation gets 404 on every organisation route", async () => {
    const orgOps = ops.filter((o) => o.access?.startsWith("org"));
    expect(orgOps.length).toBeGreaterThan(0);
    const results = await Promise.all(
      orgOps.map(async (o) => [`${o.method} ${o.path}`, (await send(bob.client, o, orgA)).status]),
    );
    expect(results.filter(([, s]) => s !== 404)).toEqual([]);
  });

  test("an organisation ID that does not exist also gets 404 (no probing)", async () => {
    const orgOps = ops.filter((o) => o.access?.startsWith("org"));
    const results = await Promise.all(
      orgOps.map(async (o) => [`${o.method} ${o.path}`, (await send(bob.client, o, newId())).status]),
    );
    expect(results.filter(([, s]) => s !== 404)).toEqual([]);
  });

  test("the owner of each organisation can use its routes (the guard is not just denying everyone)", async () => {
    const listings = ops.filter(
      (x) =>
        x.access?.startsWith("org") &&
        x.method === "GET" &&
        [...x.path.matchAll(/\{(\w+)\}/g)].every((m) => LISTING_PARAMS.has(m[1] ?? "")),
    );
    expect(listings.length).toBeGreaterThan(3);
    for (const o of listings) {
      expect((await send(alice.client, o, orgA)).status).toBe(200);
      expect((await send(bob.client, o, orgB)).status).toBe(200);
    }
  });

  test("audit entries of one organisation never appear in another's audit log", async () => {
    const page = (await (
      await bob.client.call("GET", `/api/v1/orgs/${orgB}/audit-log?limit=100`)
    ).json()) as {
      items: { resourceId: string | null }[];
    };
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items.some((i) => i.resourceId === orgA)).toBe(false);
  });
});

describe("cross-tenant access through Better Auth's organisation endpoints", () => {
  test("a non-member cannot list members, invite, change roles, remove members or update the organisation", async () => {
    const victim = await verifiedUser(app, "victim");
    await addMember(alice.client, orgA, victim, "viewer");
    const victimMember = await db.member.findFirstOrThrow({
      where: { organizationId: orgA, userId: victim.userId },
    });
    const b = bob.client;

    const attempts: [string, Promise<Response>][] = [
      ["list members", b.call("GET", `/api/v1/auth/organization/list-members?organizationId=${orgA}`)],
      [
        "full organisation",
        b.call("GET", `/api/v1/auth/organization/get-full-organization?organizationId=${orgA}`),
      ],
      [
        "list invitations",
        b.call("GET", `/api/v1/auth/organization/list-invitations?organizationId=${orgA}`),
      ],
      [
        "invite",
        b.call("POST", "/api/v1/auth/organization/invite-member", {
          organizationId: orgA,
          email: "x@example.test",
          role: "admin",
        }),
      ],
      [
        "change role",
        b.call("POST", "/api/v1/auth/organization/update-member-role", {
          organizationId: orgA,
          memberId: victimMember.id,
          role: "owner",
        }),
      ],
      [
        "remove member",
        b.call("POST", "/api/v1/auth/organization/remove-member", {
          organizationId: orgA,
          memberIdOrEmail: victimMember.id,
        }),
      ],
      [
        "update org",
        b.call("POST", "/api/v1/auth/organization/update", { organizationId: orgA, data: { name: "pwned" } }),
      ],
      ["delete org", b.call("POST", "/api/v1/auth/organization/delete", { organizationId: orgA })],
      ["set active", b.call("POST", "/api/v1/auth/organization/set-active", { organizationId: orgA })],
    ];
    const results = await Promise.all(attempts.map(async ([name, p]) => [name, (await p).status] as const));
    expect(results.filter(([, s]) => s < 400)).toEqual([]);

    const after = await db.organization.findUniqueOrThrow({ where: { id: orgA } });
    expect(after.name).toBe("Org A");
    expect((await db.member.findUniqueOrThrow({ where: { id: victimMember.id } })).role).toBe("viewer");
    expect(await db.member.count({ where: { organizationId: orgA, userId: bob.userId } })).toBe(0);
  });
});

describe("platform routes", () => {
  const platformOps = () => ops.filter((o) => o.access?.startsWith("platform"));

  test("customer users get 404", async () => {
    for (const o of platformOps()) expect((await send(alice.client, o, orgA)).status).toBe(404);
  });

  test("platform staff without two-factor get 403 MFA_REQUIRED; with it, access works", async () => {
    const staff = await verifiedUser(app, "staff");
    await db.user.update({ where: { id: staff.userId }, data: { platformRole: "super_admin" } });
    for (const o of platformOps()) {
      const res = await send(staff.client, o, orgA);
      expect(res.status).toBe(403);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("MFA_REQUIRED");
    }

    const enable = await staff.client.call("POST", "/api/v1/auth/two-factor/enable", { password: PASSWORD });
    const totp = totpFor(((await enable.json()) as { totpURI: string }).totpURI);
    await staff.client.call("POST", "/api/v1/auth/two-factor/verify-totp", { code: totp.generate() });
    for (const o of platformOps().filter((x) => x.method === "GET")) {
      expect((await send(staff.client, o, orgA)).status).toBe(200);
    }
  });

  test("support staff cannot use super-admin-only routes", async () => {
    const support = await verifiedUser(app, "support");
    await db.user.update({ where: { id: support.userId }, data: { platformRole: "support" } });
    const enable = await support.client.call("POST", "/api/v1/auth/two-factor/enable", {
      password: PASSWORD,
    });
    const totp = totpFor(((await enable.json()) as { totpURI: string }).totpURI);
    await support.client.call("POST", "/api/v1/auth/two-factor/verify-totp", { code: totp.generate() });
    for (const o of platformOps().filter((x) => x.access === "platform:super_admin")) {
      expect((await send(support.client, o, orgA)).status).toBe(404);
    }
  });

  test("a user cannot grant themselves a platform role", async () => {
    const { client: c, userId } = await verifiedUser(app, "climber");
    await c.call("POST", "/api/v1/auth/update-user", { platformRole: "super_admin", name: "Climber" });
    expect((await db.user.findUniqueOrThrow({ where: { id: userId } })).platformRole).toBeNull();
  });
});

describe("unauthenticated clients", () => {
  test("a fresh client with no cookies is not signed in", async () => {
    expect((await client(app).call("GET", "/api/v1/me")).status).toBe(401);
  });
});
