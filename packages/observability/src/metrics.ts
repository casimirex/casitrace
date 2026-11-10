import { timingSafeEqual } from "node:crypto";

/**
 * Minimal Prometheus metrics (text exposition format 0.0.4). Labels must be low-cardinality
 * (route patterns, status classes, queue names), never IDs or user input.
 */
type Labels = Record<string, string>;
const key = (l: Labels) =>
  Object.keys(l)
    .sort()
    .map((k) => `${k}="${String(l[k]).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`)
    .join(",");
const fmt = (name: string, labels: string, v: number) =>
  `${name}${labels ? `{${labels}}` : ""} ${Number.isFinite(v) ? v : 0}`;

interface Metric {
  render(): string[];
}

export class Counter implements Metric {
  private values = new Map<string, number>();
  constructor(
    readonly name: string,
    readonly help: string,
  ) {}
  inc(labels: Labels = {}, by = 1) {
    const k = key(labels);
    this.values.set(k, (this.values.get(k) ?? 0) + by);
  }
  render() {
    return [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} counter`,
      ...[...this.values].map(([k, v]) => fmt(this.name, k, v)),
    ];
  }
}

export class Gauge implements Metric {
  private values = new Map<string, number>();
  constructor(
    readonly name: string,
    readonly help: string,
  ) {}
  set(labels: Labels, v: number) {
    this.values.set(key(labels), v);
  }
  render() {
    return [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} gauge`,
      ...[...this.values].map(([k, v]) => fmt(this.name, k, v)),
    ];
  }
}

export class Histogram implements Metric {
  private series = new Map<string, { buckets: number[]; sum: number; count: number }>();
  constructor(
    readonly name: string,
    readonly help: string,
    readonly bounds: number[] = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
  ) {}
  observe(labels: Labels, v: number) {
    const k = key(labels);
    let s = this.series.get(k);
    if (!s) {
      s = { buckets: this.bounds.map(() => 0), sum: 0, count: 0 };
      this.series.set(k, s);
    }
    this.bounds.forEach((b, i) => {
      if (v <= b && s) s.buckets[i] = (s.buckets[i] ?? 0) + 1;
    });
    s.sum += v;
    s.count += 1;
  }
  render() {
    const out = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`];
    for (const [k, s] of this.series) {
      const sep = k ? `${k},` : "";
      this.bounds.forEach((b, i) => {
        out.push(`${this.name}_bucket{${sep}le="${b}"} ${s.buckets[i]}`);
      });
      out.push(`${this.name}_bucket{${sep}le="+Inf"} ${s.count}`);
      out.push(fmt(`${this.name}_sum`, k, s.sum), fmt(`${this.name}_count`, k, s.count));
    }
    return out;
  }
}

export class Registry {
  private metrics: Metric[] = [];
  private collectors: (() => Promise<void>)[] = [];
  counter(name: string, help: string) {
    return this.add(new Counter(name, help));
  }
  gauge(name: string, help: string) {
    return this.add(new Gauge(name, help));
  }
  histogram(name: string, help: string, bounds?: number[]) {
    return this.add(new Histogram(name, help, bounds));
  }
  /** Runs before each scrape (e.g. to read queue depths). */
  onCollect(fn: () => Promise<void>) {
    this.collectors.push(fn);
  }
  async render() {
    await Promise.all(this.collectors.map((c) => c()));
    return `${this.metrics.flatMap((m) => m.render()).join("\n")}\n`;
  }
  private add<M extends Metric>(m: M) {
    this.metrics.push(m);
    return m;
  }
}

/** Constant-time bearer token check for the /metrics endpoints. */
export const metricsAuthorized = (header: string | null | undefined, token: string | undefined) => {
  if (!token) return false;
  const given = Buffer.from(header?.replace(/^Bearer /, "") ?? "");
  const want = Buffer.from(token);
  return given.length === want.length && timingSafeEqual(given, want);
};
