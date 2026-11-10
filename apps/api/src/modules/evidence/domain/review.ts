import type { EvidenceStatus } from "@casitrace/contracts";
import { AppError } from "@casitrace/shared";

/**
 * Evidence review state machine (roadmap-v2 §4.4).
 *
 *   submitted ──scan clean──▶ checked ──verify──▶ verified ──revoke──▶ revoked (final)
 *       │                        │                   │
 *       └──scan infected/reject──┴──reject──▶ rejected│
 *   checked/verified ──validity ends──▶ expired       │
 *   any non-final ──new file uploaded──▶ submitted ◀──┘
 */
export type ReviewAction = "verify" | "reject" | "revoke";

const ALLOWED: Record<ReviewAction, readonly EvidenceStatus[]> = {
  verify: ["checked"],
  reject: ["submitted", "checked"],
  revoke: ["verified"],
};
const TARGET: Record<ReviewAction, EvidenceStatus> = {
  verify: "verified",
  reject: "rejected",
  revoke: "revoked",
};

export interface ReviewInput {
  action: ReviewAction;
  reason?: string | undefined;
  status: EvidenceStatus;
  reviewerId: string;
  uploaderId: string | null;
  validUntil: Date | null;
  today: Date;
}

/** Returns the new status or throws with the reason the action is not allowed. */
export const decideReview = (r: ReviewInput): EvidenceStatus => {
  if (!ALLOWED[r.action].includes(r.status)) {
    const hint =
      r.action === "verify" && r.status === "submitted" ? " Wait for the virus scan to finish." : "";
    throw new AppError("CONFLICT", `Cannot ${r.action} evidence that is ${r.status}.${hint}`);
  }
  if ((r.action === "reject" || r.action === "revoke") && !r.reason?.trim()) {
    throw new AppError("VALIDATION_FAILED", `Give a reason to ${r.action}.`, [
      { path: "reason", message: "required" },
    ]);
  }
  if (r.action === "verify") {
    // Four-eyes rule: whoever uploaded the current file cannot also verify it.
    if (r.uploaderId && r.uploaderId === r.reviewerId) {
      throw new AppError("FORBIDDEN", "Someone other than the uploader must verify this evidence.");
    }
    if (r.validUntil && r.validUntil < startOfDay(r.today)) {
      throw new AppError("CONFLICT", "The certificate has already expired and cannot be verified.");
    }
  }
  return TARGET[r.action];
};

export const startOfDay = (d: Date) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/** Whole days from today (UTC) until the end of validity; negative once expired. */
export const daysUntil = (validUntil: Date | null, today: Date): number | null =>
  validUntil
    ? Math.round((startOfDay(validUntil).getTime() - startOfDay(today).getTime()) / 86_400_000)
    : null;

/** A new file replaces the evidence content, so earlier checks no longer apply. */
export const canUploadNewVersion = (status: EvidenceStatus) => status !== "revoked";

/** Certificate details can only change before a reviewer has relied on them. */
export const canEditDetails = (status: EvidenceStatus) =>
  status === "submitted" || status === "checked" || status === "rejected";
