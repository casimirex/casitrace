const STYLE: Record<string, string> = {
  submitted: "border-line text-muted",
  checked: "border-brand text-brand",
  verified: "border-ok bg-ok text-canvas",
  rejected: "border-fail text-fail",
  revoked: "border-fail bg-fail text-canvas",
  expired: "border-warn text-warn",
};

/** What each state means, shown next to the badge so "verified" is never read as "true". */
export const STATUS_MEANING: Record<string, string> = {
  submitted: "Uploaded. Waiting for the virus scan and file checks.",
  checked: "File passed the virus scan; its hash is recorded. Nobody has reviewed the content yet.",
  verified: "A reviewer in this organisation checked the content. This is not a third-party certification.",
  rejected: "Rejected by a reviewer or by the virus scan.",
  revoked: "Was verified, then withdrawn. Cannot be used.",
  expired: "The certificate's validity has ended.",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${STYLE[status] ?? "border-line"}`}
      title={STATUS_MEANING[status]}
    >
      {status}
    </span>
  );
}

export const expiryText = (days: number | null) =>
  days === null
    ? ""
    : days < 0
      ? `expired ${-days} d ago`
      : days === 0
        ? "expires today"
        : `expires in ${days} d`;
