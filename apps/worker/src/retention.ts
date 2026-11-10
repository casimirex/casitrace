import type { Db } from "@casitrace/db";

/**
 * Deletes data whose retention period has ended (docs/compliance/data-retention.md, "automatic" rows).
 * Business records (events, lots, evidence, audit, recalls, passports) are NOT touched here: they are
 * kept for the legal record-keeping period and removed only by the documented off-boarding procedure.
 */
export const RETENTION = {
  /** Expired sessions: kept 30 days after expiry for security investigations. */
  sessionDaysAfterExpiry: 30,
  /** Read notifications. */
  readNotificationDays: 180,
  /** Unread notifications (a reminder nobody opened is not a record). */
  unreadNotificationDays: 365,
} as const;

export const runRetention = async (db: Db, now = new Date()) => {
  const days = (n: number) => new Date(now.getTime() - n * 86_400_000);
  const [rateBuckets, authRate, verifications, sessions, readNotes, oldNotes] = await db.$transaction([
    db.rateLimitBucket.deleteMany({ where: { resetAt: { lt: days(1 / 24) } } }),
    // Better Auth's own limiter rows (last_request is epoch milliseconds).
    db.rateLimit.deleteMany({ where: { lastRequest: { lt: BigInt(now.getTime() - 86_400_000) } } }),
    db.verification.deleteMany({ where: { expiresAt: { lt: days(1) } } }),
    db.session.deleteMany({ where: { expiresAt: { lt: days(RETENTION.sessionDaysAfterExpiry) } } }),
    db.notification.deleteMany({ where: { readAt: { lt: days(RETENTION.readNotificationDays) } } }),
    db.notification.deleteMany({
      where: { readAt: null, createdAt: { lt: days(RETENTION.unreadNotificationDays) } },
    }),
  ]);
  return {
    rateLimitBuckets: rateBuckets.count,
    authRateLimits: authRate.count,
    verifications: verifications.count,
    sessions: sessions.count,
    notifications: readNotes.count + oldNotes.count,
  };
};
