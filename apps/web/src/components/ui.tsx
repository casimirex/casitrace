import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { useId } from "react";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export function Button({
  variant = "primary",
  busy,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger";
  busy?: boolean;
}) {
  return (
    <button
      {...props}
      disabled={props.disabled || busy}
      aria-busy={busy || undefined}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded px-3.5 py-2 text-sm font-medium transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-60",
        variant === "primary" && "bg-brand text-canvas hover:opacity-90",
        variant === "secondary" && "border border-line bg-surface text-ink hover:bg-canvas",
        variant === "danger" && "border border-fail text-fail hover:bg-fail hover:text-canvas",
        className,
      )}
    >
      {busy ? "Working…" : children}
    </button>
  );
}

const inputClass =
  "w-full rounded border border-line bg-surface px-3 py-2 text-sm text-ink focus-visible:outline-2 focus-visible:outline-brand";

export function Field({
  label,
  hint,
  error,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string }) {
  const id = useId();
  return (
    <div className="grid gap-1.5">
      <label htmlFor={props.id ?? id} className="text-sm font-medium">
        {label}
      </label>
      <input id={props.id ?? id} className={inputClass} aria-invalid={error ? true : undefined} {...props} />
      {hint && !error && <p className="text-xs text-muted">{hint}</p>}
      {error && <p className="text-xs text-fail">{error}</p>}
    </div>
  );
}

export function SelectField({
  label,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <div className="grid gap-1.5">
      <label htmlFor={props.id ?? id} className="text-sm font-medium">
        {label}
      </label>
      <select id={props.id ?? id} className={inputClass} {...props}>
        {children}
      </select>
    </div>
  );
}

export function Alert({
  tone = "error",
  children,
}: {
  tone?: "error" | "info" | "success";
  children: ReactNode;
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cx(
        "rounded border px-3 py-2 text-sm",
        tone === "error" && "border-fail text-fail",
        tone === "info" && "border-line bg-canvas text-ink",
        tone === "success" && "border-ok text-ok",
      )}
    >
      {children}
    </div>
  );
}

export function Card({
  title,
  children,
  actions,
}: {
  title?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="rounded border border-line bg-surface">
      {(title || actions) && (
        <header className="flex items-center justify-between gap-4 border-b border-line px-4 py-3">
          {title && <h2 className="font-semibold">{title}</h2>}
          {actions}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function PageTitle({ title, subtitle }: { title: string; subtitle?: ReactNode }) {
  return (
    <div className="mb-6">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {subtitle && <p className="mt-1 text-muted">{subtitle}</p>}
    </div>
  );
}

export function RoleBadge({ role }: { role: string }) {
  return (
    <span className="rounded-full border border-line px-2 py-0.5 font-mono text-xs capitalize text-muted">
      {role}
    </span>
  );
}
