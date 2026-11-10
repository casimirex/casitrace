import { can } from "@casitrace/contracts";
import type { Db, Tx } from "@casitrace/db";
import { newId } from "@casitrace/shared";

export const EXPIRY_THRESHOLDS = [30, 7, 0] as const;
const DAY = 86_400_000;
const startOfDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

export interface ExpiryRunResult {
  warned: number;
  expired: number;
  notifications: number;
}

/** Members who should hear about evidence: anyone allowed to verify it (owners, admins, reviewers). */
const recipients = async (tx: Tx, orgId: string) => {
  const members = await tx.member.findMany({
    where: { organizationId: orgId },
    include: { user: { select: { id: true, email: true, name: true } } },
  });
  return members.filter((m) => can(m.role, "evidence:verify")).map((m) => m.user);
};

const notify = async (
  tx: Tx,
  orgId: string,
  evidence: { id: string; title: string },
  days: number,
  expired: boolean,
  webOrigin: string,
): Promise<number> => {
  const people = await recipients(tx, orgId);
  const org = await tx.organization.findUnique({ where: { id: orgId }, select: { name: true } });
  const link = `/orgs/${orgId}/evidence/${evidence.id}`;
  const orgName = org?.name ?? "your organisation";
  const when = days === 0 ? "today" : `in ${days} days`;
  const title = expired
    ? `Certificate expired: ${evidence.title}`
    : `Certificate expires ${when}: ${evidence.title}`;
  const body = expired
    ? `“${evidence.title}” (${orgName}) has expired and no longer counts as valid evidence. Upload the renewed certificate.`
    : `“${evidence.title}” (${orgName}) expires ${when}. Upload the renewed certificate before then.`;
  const dedupe = `evidence-expiry:${evidence.id}:${expired ? "expired" : days}`;
  let sent = 0;
  for (const u of people) {
    const created = await tx.notification.createMany({
      data: [
        { id: newId(), userId: u.id, orgId, kind: "evidence.expiry", title, body, link, dedupeKey: dedupe },
      ],
      skipDuplicates: true,
    });
    if (created.count === 0) continue;
    sent++;
    const emailId = newId();
    await tx.outboxEvent.create({
      data: {
        id: emailId,
        orgId,
        type: "email.requested",
        aggregateType: "email",
        aggregateId: emailId,
        payload: {
          template: "evidence-expiry",
          to: u.email,
          data: {
            name: u.name,
            title: evidence.title,
            organisationName: orgName,
            days: expired ? "expired" : String(days),
            url: `${webOrigin}${link}`,
          },
        },
      },
    });
  }
  return sent;
};

/**
 * Daily job: warns at 30, 7 and 0 days before a certificate's end date and marks it expired once
 * its validity has ended. Idempotent (expiry_notice_days + notification dedupe keys).
 */
export const runExpiryCheck = (db: Db, now: Date, webOrigin: string): Promise<ExpiryRunResult> =>
  db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.platform_access', 'on', true)`;
      const today = startOfDay(now);
      const horizon = new Date(today.getTime() + EXPIRY_THRESHOLDS[0] * DAY);
      const due = await tx.evidence.findMany({
        where: {
          validUntil: { not: null, lte: horizon },
          status: { in: ["submitted", "checked", "verified"] },
        },
        select: {
          id: true,
          orgId: true,
          title: true,
          status: true,
          validUntil: true,
          expiryNoticeDays: true,
          currentFileVersion: true,
        },
      });
      const result: ExpiryRunResult = { warned: 0, expired: 0, notifications: 0 };

      for (const e of due) {
        const days = Math.round((startOfDay(e.validUntil as Date).getTime() - today.getTime()) / DAY);
        if (days < 0) {
          // Validity ended yesterday or earlier: expire it.
          const moved = await tx.evidence.updateMany({
            where: { id: e.id, status: e.status },
            data: { status: "expired", expiryNoticeDays: 0 },
          });
          if (moved.count !== 1) continue;
          await tx.evidenceStatusChange.create({
            data: {
              id: newId(),
              orgId: e.orgId,
              evidenceId: e.id,
              fromStatus: e.status,
              toStatus: "expired",
              reason: `Validity ended on ${(e.validUntil as Date).toISOString().slice(0, 10)}`,
              actorType: "system",
              actorId: null,
              fileVersion: e.currentFileVersion,
            },
          });
          await tx.auditLog.create({
            data: {
              id: newId(),
              orgId: e.orgId,
              actorType: "system",
              actorId: null,
              action: "evidence.expired",
              resourceType: "evidence",
              resourceId: e.id,
            },
          });
          result.expired++;
          result.notifications += await notify(tx, e.orgId, e, 0, true, webOrigin);
          continue;
        }
        // The smallest threshold reached (30, 7 or 0 days); a certificate first seen at 5 days left gets the 7-day notice once.
        const reached = Math.min(...EXPIRY_THRESHOLDS.filter((t) => days <= t));
        if (e.expiryNoticeDays !== null && reached >= e.expiryNoticeDays) continue;
        await tx.evidence.update({ where: { id: e.id }, data: { expiryNoticeDays: reached } });
        result.warned++;
        result.notifications += await notify(tx, e.orgId, e, days, false, webOrigin);
      }
      return result;
    },
    { timeout: 120_000 },
  );
