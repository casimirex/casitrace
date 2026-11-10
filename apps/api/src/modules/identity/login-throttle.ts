import type { Db } from "@casitrace/db";

/** Account lockout after repeated sign-in failures (roadmap-v2 P2). Applies whether or not the email exists. */
export const LOCKOUT_THRESHOLD = 5;
export const LOCKOUT_MINUTES = 15;

export const emailHash = (email: string) =>
  new Bun.CryptoHasher("sha256").update(email.trim().toLowerCase()).digest("hex");

export const lockedUntil = async (db: Db, email: string): Promise<Date | null> => {
  const row = await db.loginThrottle.findUnique({ where: { emailHash: emailHash(email) } });
  return row?.lockedUntil && row.lockedUntil > new Date() ? row.lockedUntil : null;
};

export const recordFailure = async (db: Db, email: string): Promise<{ locked: boolean }> => {
  const key = emailHash(email);
  const row = await db.loginThrottle.upsert({
    where: { emailHash: key },
    create: { emailHash: key, failures: 1 },
    update: { failures: { increment: 1 } },
  });
  if (row.failures < LOCKOUT_THRESHOLD) return { locked: false };
  await db.loginThrottle.update({
    where: { emailHash: key },
    data: { failures: 0, lockedUntil: new Date(Date.now() + LOCKOUT_MINUTES * 60_000) },
  });
  return { locked: true };
};

export const recordSuccess = async (db: Db, email: string): Promise<void> => {
  await db.loginThrottle.deleteMany({ where: { emailHash: emailHash(email) } });
};
