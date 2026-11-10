import { expect } from "@playwright/test";

const MAILPIT = "http://localhost:8025/api/v1";

/** Waits for the newest email to `to` whose subject matches, and returns the first link in it. */
export const linkFromEmail = async (to: string, subject: RegExp): Promise<string> => {
  let link = "";
  await expect
    .poll(
      async () => {
        const q = encodeURIComponent(`to:"${to}"`);
        const res = (await (await fetch(`${MAILPIT}/search?query=${q}`)).json()) as {
          messages: { ID: string; Subject: string }[];
        };
        const msg = res.messages.find((m) => subject.test(m.Subject));
        if (!msg) return "";
        const full = (await (await fetch(`${MAILPIT}/message/${msg.ID}`)).json()) as { Text: string };
        link = full.Text.match(/https?:\/\/\S+/)?.[0] ?? "";
        return link;
      },
      { timeout: 30_000, message: `email "${subject}" to ${to}` },
    )
    .not.toBe("");
  return link;
};

export const uniqueEmail = (tag: string) =>
  `${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
