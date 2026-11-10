import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";

type CheckStatus = "ok" | "fail" | "unknown";

function StatusRow({ label, status, detail }: { label: string; status: CheckStatus; detail?: string }) {
  const tone = status === "ok" ? "text-ok" : status === "fail" ? "text-fail" : "text-muted";
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line py-3 last:border-b-0">
      <dt className="font-medium">{label}</dt>
      <dd className="flex items-baseline gap-3 font-mono text-sm tabular-nums">
        {detail && <span className="text-muted">{detail}</span>}
        <span className={tone} data-testid={`status-${label.toLowerCase()}`}>
          {status}
        </span>
      </dd>
    </div>
  );
}

export function StatusPage() {
  const health = useQuery({
    queryKey: ["system", "health"],
    queryFn: async () => {
      const { data, error } = await api.GET("/health");
      if (error || !data) throw new Error("API unreachable");
      return data;
    },
    refetchInterval: 10_000,
  });
  const ready = useQuery({
    queryKey: ["system", "ready"],
    queryFn: async () => {
      const { data, error, response } = await api.GET("/ready");
      // 503 still carries a readiness body describing which dependency failed.
      if (data) return data;
      if (response.status === 503 && error && "checks" in error) return error;
      throw new Error("Readiness check failed");
    },
    refetchInterval: 10_000,
  });

  const apiStatus: CheckStatus = health.isSuccess ? "ok" : health.isError ? "fail" : "unknown";
  const db = ready.data?.checks.database;
  const storage = ready.data?.checks.storage;

  return (
    <section aria-labelledby="status-heading" className="max-w-xl">
      <h1 id="status-heading" className="text-2xl font-semibold tracking-tight">
        System status
      </h1>
      <p className="mt-1 text-muted">
        Live checks of the services this workspace depends on. Refreshes every 10 seconds.
      </p>
      <dl className="mt-6 rounded border border-line bg-surface px-4">
        <StatusRow
          label="API"
          status={apiStatus}
          detail={health.data ? `v${health.data.version}` : undefined}
        />
        <StatusRow
          label="Database"
          status={db?.status ?? (ready.isError ? "fail" : "unknown")}
          detail={db ? `${db.latencyMs} ms` : undefined}
        />
        <StatusRow
          label="Storage"
          status={storage?.status ?? (ready.isError ? "fail" : "unknown")}
          detail={storage ? `${storage.latencyMs} ms` : undefined}
        />
      </dl>
    </section>
  );
}
