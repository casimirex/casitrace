/** Email templates. Must stay in sync with EmailRequest in apps/api/src/platform/email.ts. */
export type EmailRequest =
  | { template: "notice"; to: string; data: { name: string; title: string; body: string; url: string } }
  | { template: "partner-claim"; to: string; data: { inviterName: string; partnerName: string; url: string } }
  | { template: "verify-email"; to: string; data: { name: string; url: string } }
  | { template: "reset-password"; to: string; data: { name: string; url: string } }
  | {
      template: "invitation";
      to: string;
      data: { organisationName: string; inviterName: string; role: string; url: string };
    }
  | {
      template: "evidence-expiry";
      to: string;
      data: { name: string; title: string; organisationName: string; days: string; url: string };
    };

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );

const layout = (
  paragraphs: string[],
  action: { label: string; url: string },
  footer: string,
) => `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f6f8f6;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#16201b">
<div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #d9e0db;border-radius:4px;padding:24px">
<p style="margin:0 0 16px;font-weight:600">Casitrace</p>
${paragraphs.map((p) => `<p style="margin:0 0 12px;line-height:1.5">${p}</p>`).join("\n")}
<p style="margin:20px 0"><a href="${esc(action.url)}" style="background:#1d6b51;color:#fff;padding:10px 16px;border-radius:3px;text-decoration:none;display:inline-block">${esc(action.label)}</a></p>
<p style="margin:0;font-size:13px;color:#5a675f;line-height:1.5">${footer}<br>If the button does not work, copy this link: ${esc(action.url)}</p>
</div></body></html>`;

export const render = (req: EmailRequest): RenderedEmail => {
  switch (req.template) {
    case "verify-email": {
      const { name, url } = req.data;
      return {
        subject: "Confirm your email address",
        text: `Hi ${name},\n\nConfirm your email address to finish setting up your Casitrace account:\n${url}\n\nThe link expires in 24 hours. If you did not sign up, ignore this email.`,
        html: layout(
          [`Hi ${esc(name)},`, "Confirm your email address to finish setting up your Casitrace account."],
          { label: "Confirm email", url },
          "The link expires in 24 hours. If you did not sign up, ignore this email.",
        ),
      };
    }
    case "reset-password": {
      const { name, url } = req.data;
      return {
        subject: "Reset your Casitrace password",
        text: `Hi ${name},\n\nReset your password with this link:\n${url}\n\nThe link expires in 30 minutes. If you did not ask for this, ignore this email; your password stays the same.`,
        html: layout(
          [`Hi ${esc(name)},`, "Someone asked to reset the password for your Casitrace account."],
          { label: "Choose a new password", url },
          "The link expires in 30 minutes. If you did not ask for this, ignore this email; your password stays the same.",
        ),
      };
    }
    case "invitation": {
      const { organisationName, inviterName, role, url } = req.data;
      return {
        subject: `${inviterName} invited you to ${organisationName} on Casitrace`,
        text: `${inviterName} invited you to join ${organisationName} on Casitrace as ${role}.\n\nAccept the invitation:\n${url}\n\nThe invitation expires in 7 days.`,
        html: layout(
          [
            `${esc(inviterName)} invited you to join <strong>${esc(organisationName)}</strong> on Casitrace as <strong>${esc(role)}</strong>.`,
          ],
          { label: "View invitation", url },
          "The invitation expires in 7 days.",
        ),
      };
    }
    case "evidence-expiry": {
      const { name, title, organisationName, days, url } = req.data;
      const expired = days === "expired";
      const what = expired ? "has expired" : days === "0" ? "expires today" : `expires in ${days} days`;
      return {
        subject: expired ? `Certificate expired: ${title}` : `Certificate ${what}: ${title}`,
        text: `Hi ${name},\n\n"${title}" for ${organisationName} ${what}. Upload the renewed certificate:\n${url}`,
        html: layout(
          [`Hi ${esc(name)},`, `<strong>${esc(title)}</strong> for ${esc(organisationName)} ${what}.`],
          { label: "Open the certificate", url },
          expired
            ? "Expired certificates no longer count as valid evidence."
            : "Upload the renewed certificate before it expires.",
        ),
      };
    }
    case "notice": {
      const { name, title, body, url } = req.data;
      return {
        subject: title,
        text: `Hi ${name},\n\n${body}\n\n${url}`,
        html: layout(
          [`Hi ${esc(name)},`, esc(body)],
          { label: "Open in Casitrace", url },
          "You receive this because of your role in the organisation.",
        ),
      };
    }
    case "partner-claim": {
      const { inviterName, partnerName, url } = req.data;
      return {
        subject: `${inviterName} invites ${partnerName} to Casitrace`,
        text: `${inviterName} records ${partnerName} as a trading partner on Casitrace and invites you to link your own organisation, so shipments between you can be traced end to end.\n\n${url}\n\nThe invitation expires in 14 days.`,
        html: layout(
          [
            `<strong>${esc(inviterName)}</strong> records <strong>${esc(partnerName)}</strong> as a trading partner on Casitrace and invites you to link your own organisation, so shipments between you can be traced end to end.`,
          ],
          { label: "Link your organisation", url },
          "The invitation expires in 14 days. Your records stay private unless you choose to share them.",
        ),
      };
    }
  }
};
