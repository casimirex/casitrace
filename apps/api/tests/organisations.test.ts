import { afterAll, describe, expect, test } from "bun:test";
import { addMember, createOrg, lastEmail, verifiedUser } from "./auth-helpers";
import { buildApp, db } from "./helpers";

afterAll(() => db.$disconnect());
const app = buildApp();

describe("organisations and membership", () => {
  test("the creator becomes owner and sees owner permissions", async () => {
    const { client: c } = await verifiedUser(app, "founder");
    const orgId = await createOrg(c, "Green Valley Farm");
    const res = await c.call("GET", `/api/v1/orgs/${orgId}`);
    expect(res.status).toBe(200);
    const org = (await res.json()) as { name: string; myRole: string; myPermissions: string[] };
    expect(org).toMatchObject({ name: "Green Valley Farm", myRole: "owner" });
    expect(org.myPermissions).toEqual(
      expect.arrayContaining(["organization:delete", "member:create", "audit:read"]),
    );
  });

  test("a user can belong to several organisations", async () => {
    const owner1 = await verifiedUser(app, "o1");
    const owner2 = await verifiedUser(app, "o2");
    const both = await verifiedUser(app, "both");
    const a = await createOrg(owner1.client, "Alpha Mill");
    const b = await createOrg(owner2.client, "Beta Dairy");
    await addMember(owner1.client, a, both, "operator");
    await addMember(owner2.client, b, both, "viewer");

    const me = (await (await both.client.call("GET", "/api/v1/me")).json()) as {
      memberships: { organization: { name: string }; role: string }[];
    };
    expect(me.memberships.map((m) => [m.organization.name, m.role]).sort()).toEqual([
      ["Alpha Mill", "operator"],
      ["Beta Dairy", "viewer"],
    ]);
  });

  test("an invitation emails a link and grants the invited role on acceptance", async () => {
    const owner = await verifiedUser(app, "inviter");
    const invitee = await verifiedUser(app, "invitee");
    const orgId = await createOrg(owner.client, "Invite Co");
    const invitationId = await addMember(owner.client, orgId, invitee, "reviewer");

    const mail = await lastEmail(invitee.email, "invitation");
    expect(mail.data.url).toBe(`http://localhost:5173/invitations/${invitationId}`);
    expect(mail.data).toMatchObject({ organisationName: "Invite Co", role: "reviewer" });
    const member = await db.member.findFirstOrThrow({
      where: { organizationId: orgId, userId: invitee.userId },
    });
    expect(member.role).toBe("reviewer");
  });

  test("an invitation cannot be accepted by a different user", async () => {
    const owner = await verifiedUser(app, "inv-owner");
    const intended = await verifiedUser(app, "intended");
    const intruder = await verifiedUser(app, "intruder");
    const orgId = await createOrg(owner.client, "Private Co");
    const inv = await owner.client.call("POST", "/api/v1/auth/organization/invite-member", {
      organizationId: orgId,
      email: intended.email,
      role: "admin",
    });
    const { id } = (await inv.json()) as { id: string };
    const res = await intruder.client.call("POST", "/api/v1/auth/organization/accept-invitation", {
      invitationId: id,
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await db.member.count({ where: { organizationId: orgId, userId: intruder.userId } })).toBe(0);
  });
});

describe("role templates are enforced", () => {
  test("viewers and operators cannot invite or change roles; admins can", async () => {
    const owner = await verifiedUser(app, "rt-owner");
    const viewer = await verifiedUser(app, "rt-viewer");
    const operator = await verifiedUser(app, "rt-operator");
    const admin = await verifiedUser(app, "rt-admin");
    const orgId = await createOrg(owner.client, "Roles Ltd");
    await addMember(owner.client, orgId, viewer, "viewer");
    await addMember(owner.client, orgId, operator, "operator");
    await addMember(owner.client, orgId, admin, "admin");

    for (const weak of [viewer, operator]) {
      const res = await weak.client.call("POST", "/api/v1/auth/organization/invite-member", {
        organizationId: orgId,
        email: "someone@example.test",
        role: "viewer",
      });
      expect(res.status).toBe(403);
    }
    const ok = await admin.client.call("POST", "/api/v1/auth/organization/invite-member", {
      organizationId: orgId,
      email: "new-hire@example.test",
      role: "operator",
    });
    expect(ok.status).toBe(200);

    const viewerMember = await db.member.findFirstOrThrow({
      where: { organizationId: orgId, userId: viewer.userId },
    });
    const promote = await operator.client.call("POST", "/api/v1/auth/organization/update-member-role", {
      organizationId: orgId,
      memberId: viewerMember.id,
      role: "admin",
    });
    expect(promote.status).toBe(403);
  });

  test("only roles with audit:read can see the audit log, which records membership changes", async () => {
    const owner = await verifiedUser(app, "al-owner");
    const viewer = await verifiedUser(app, "al-viewer");
    const orgId = await createOrg(owner.client, "Audit Farm");
    await addMember(owner.client, orgId, viewer, "viewer");

    expect((await viewer.client.call("GET", `/api/v1/orgs/${orgId}/audit-log`)).status).toBe(403);
    const res = await owner.client.call("GET", `/api/v1/orgs/${orgId}/audit-log?limit=50`);
    expect(res.status).toBe(200);
    const page = (await res.json()) as { items: { action: string; actorId: string | null }[] };
    const actions = page.items.map((i) => i.action);
    expect(actions).toEqual(
      expect.arrayContaining(["organisation.created", "invitation.created", "invitation.accepted"]),
    );
    expect(page.items.find((i) => i.action === "organisation.created")?.actorId).toBe(owner.userId);
  });

  test("audit log pages with a cursor", async () => {
    const owner = await verifiedUser(app, "pg-owner");
    const orgId = await createOrg(owner.client, "Paging Farm");
    for (let i = 0; i < 3; i++)
      await addMember(owner.client, orgId, await verifiedUser(app, `pg-${i}`), "viewer");
    const first = (await (
      await owner.client.call("GET", `/api/v1/orgs/${orgId}/audit-log?limit=2`)
    ).json()) as {
      items: { id: string }[];
      nextCursor: string | null;
    };
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toBeTruthy();
    const second = (await (
      await owner.client.call("GET", `/api/v1/orgs/${orgId}/audit-log?limit=2&cursor=${first.nextCursor}`)
    ).json()) as { items: { id: string }[] };
    expect(second.items).toHaveLength(2);
    expect(second.items.map((i) => i.id)).not.toContain(first.items[0]?.id);
  });

  test("the last owner cannot leave the organisation", async () => {
    const owner = await verifiedUser(app, "last-owner");
    const orgId = await createOrg(owner.client, "Solo Farm");
    const res = await owner.client.call("POST", "/api/v1/auth/organization/leave", { organizationId: orgId });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await db.member.count({ where: { organizationId: orgId, role: "owner" } })).toBe(1);
  });
});
