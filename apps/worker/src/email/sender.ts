import type { Db } from "@casitrace/db";
import nodemailer from "nodemailer";
import type { RelayedEvent } from "../events";
import { type EmailRequest, render } from "./templates";

export interface SmtpConfig {
  host: string;
  port: number;
  from: string;
  user?: string;
  pass?: string;
}

/**
 * Sends queued emails. After a successful send, the outbox payload is replaced with a redacted copy,
 * so verification and reset links do not stay readable in the database.
 */
export const createEmailHandler = (cfg: SmtpConfig, db?: Db) => {
  const transport = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.port === 465,
    ...(cfg.user ? { auth: { user: cfg.user, pass: cfg.pass ?? "" } } : {}),
  });
  return async (event: RelayedEvent) => {
    const req = event.payload as EmailRequest;
    const email = render(req);
    // The outbox event ID doubles as Message-ID, so a redelivered job is recognisable downstream.
    await transport.sendMail({
      from: cfg.from,
      to: req.to,
      subject: email.subject,
      text: email.text,
      html: email.html,
      messageId: `<${event.eventId}@casitrace>`,
    });
    await db?.outboxEvent.update({
      where: { id: event.eventId },
      data: { payload: { template: req.template, to: req.to, redacted: true } },
    });
  };
};
