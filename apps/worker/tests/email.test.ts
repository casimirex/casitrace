import { afterAll, describe, expect, test } from "bun:test";
import { createDb } from "@casitrace/db";
import { newId } from "@casitrace/shared";
import { createEmailHandler } from "../src/email/sender";
import { render } from "../src/email/templates";

const MAILPIT = "http://localhost:8025/api/v1";
const db = createDb({ url: process.env.DATABASE_URL ?? "", max: 2 });
afterAll(() => db.$disconnect());

describe("emails", () => {
  test("templates escape user-controlled text in HTML", () => {
    const out = render({
      template: "invitation",
      to: "a@example.test",
      data: {
        organisationName: "<script>x</script>",
        inviterName: "Eve",
        role: "viewer",
        url: "https://x.test/i/1",
      },
    });
    expect(out.html).not.toContain("<script>");
    expect(out.html).toContain("&lt;script&gt;");
  });

  test("the handler delivers over SMTP (Mailpit)", async () => {
    const to = `mail-${newId()}@example.test`;
    const send = createEmailHandler({
      host: "localhost",
      port: 1025,
      from: "Casitrace <no-reply@casitrace.local>",
    });
    await send({
      eventId: newId(),
      type: "email.requested",
      orgId: null,
      aggregateType: "email",
      aggregateId: newId(),
      occurredAt: new Date().toISOString(),
      payload: {
        template: "verify-email",
        to,
        data: { name: "Ana", url: "http://localhost:5173/verify?t=1" },
      },
    });
    const search = (await (
      await fetch(`${MAILPIT}/search?query=${encodeURIComponent(`to:"${to}"`)}`)
    ).json()) as {
      messages: { Subject: string }[];
    };
    expect(search.messages.map((m) => m.Subject)).toEqual(["Confirm your email address"]);
  });
});

describe("email links do not stay in the database", () => {
  test("the outbox payload is redacted after sending", async () => {
    const id = newId();
    const payload = {
      template: "reset-password",
      to: `r-${id}@example.test`,
      data: { name: "R", url: "http://x/reset?token=SECRET" },
    };
    await db.outboxEvent.create({
      data: { id, type: "email.requested", aggregateType: "email", aggregateId: id, payload },
    });
    const send = createEmailHandler(
      { host: "localhost", port: 1025, from: "Casitrace <no-reply@casitrace.local>" },
      db,
    );
    await send({
      eventId: id,
      type: "email.requested",
      orgId: null,
      aggregateType: "email",
      aggregateId: id,
      occurredAt: new Date().toISOString(),
      payload,
    });
    const row = await db.outboxEvent.findUniqueOrThrow({ where: { id } });
    expect(JSON.stringify(row.payload)).not.toContain("SECRET");
    expect(row.payload).toEqual({ template: "reset-password", to: payload.to, redacted: true });
  });
});
