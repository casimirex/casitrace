import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { NavLink, useParams } from "react-router";
import { Alert, Button, Card, Field, SelectField } from "../../components/ui";
import { ApiError, api, unwrap } from "../../lib/api";
import { formValues, useCan, useOrgContext } from "../masterdata/common";
import { discardQueued, flushQueue, queued, submitEvent } from "./offline-queue";

const nowLocal = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};
const toIso = (local: string | null | undefined) => new Date(local ?? Date.now()).toISOString();

const useMasterData = (orgId: string) => {
  const products = useQuery({
    queryKey: ["org", orgId, "products", ""],
    queryFn: async () =>
      unwrap(await api.GET("/v1/orgs/{orgId}/products", { params: { path: { orgId }, query: {} } })).items,
  });
  const locations = useQuery({
    queryKey: ["org", orgId, "locations"],
    queryFn: async () =>
      unwrap(await api.GET("/v1/orgs/{orgId}/locations", { params: { path: { orgId }, query: {} } })).items,
  });
  const partners = useQuery({
    queryKey: ["org", orgId, "partners"],
    queryFn: async () =>
      unwrap(await api.GET("/v1/orgs/{orgId}/partners", { params: { path: { orgId }, query: {} } })).items,
  });
  const lots = useQuery({
    queryKey: ["org", orgId, "lots", "active"],
    queryFn: async () =>
      unwrap(
        await api.GET("/v1/orgs/{orgId}/lots", {
          params: { path: { orgId }, query: { status: "active", limit: 200 } },
        }),
      ).items,
  });
  return {
    products: products.data ?? [],
    locations: locations.data ?? [],
    partners: partners.data ?? [],
    lots: lots.data ?? [],
  };
};

function QueueBanner({ orgId }: { orgId: string }) {
  const [items, setItems] = useState(queued(orgId));
  useEffect(() => {
    const update = () => setItems(queued(orgId));
    window.addEventListener("casitrace-queue", update);
    return () => window.removeEventListener("casitrace-queue", update);
  }, [orgId]);
  if (!items.length) return null;
  return (
    <div className="mb-4 rounded border border-warn px-3 py-2 text-sm" role="status">
      <p className="font-medium text-warn">
        {items.length} event(s) saved on this device, waiting to be sent
      </p>
      <ul className="mt-1 grid gap-1">
        {items.map((q) => (
          <li key={q.body.idempotencyKey} className="flex flex-wrap justify-between gap-2">
            <span>
              {q.label} {q.lastError && <span className="text-fail">— {q.lastError}</span>}
            </span>
            {q.lastError && q.lastError !== "Still offline" && (
              <button
                type="button"
                className="text-muted underline"
                onClick={() => discardQueued(q.body.idempotencyKey)}
              >
                Discard
              </button>
            )}
          </li>
        ))}
      </ul>
      <Button variant="secondary" className="mt-2" onClick={() => void flushQueue()}>
        Send now
      </Button>
    </div>
  );
}

function Result({ state }: { state: { kind: "sent" | "queued" | "error"; message: string } | null }) {
  if (!state) return null;
  return (
    <Alert tone={state.kind === "error" ? "error" : state.kind === "queued" ? "info" : "success"}>
      {state.message}
    </Alert>
  );
}

/** Shared submit flow: sends, or queues when offline; shows server errors with their details. */
const useSubmit = (orgId: string) => {
  const queryClient = useQueryClient();
  const [state, setState] = useState<{ kind: "sent" | "queued" | "error"; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  // Time from the first input in a form to submitting it (pilot KPI); one form is shown at a time.
  const startedAt = useRef<number | null>(null);
  useEffect(() => {
    const onInput = () => {
      startedAt.current ??= performance.now();
    };
    document.addEventListener("input", onInput, true);
    return () => document.removeEventListener("input", onInput, true);
  }, []);
  const submit = async (body: Parameters<typeof submitEvent>[1], label: string, form?: HTMLFormElement) => {
    setBusy(true);
    setState(null);
    const capture =
      startedAt.current === null
        ? undefined
        : {
            ms: performance.now() - startedAt.current,
            device: window.matchMedia("(pointer: coarse)").matches
              ? ("touch" as const)
              : ("desktop" as const),
          };
    try {
      const r = await submitEvent(orgId, body, label, capture);
      startedAt.current = null;
      setState(
        r === "sent"
          ? { kind: "sent", message: `${label} recorded.` }
          : {
              kind: "queued",
              message: `No connection. ${label} is saved on this device and will be sent automatically.`,
            },
      );
      form?.reset();
      await queryClient.invalidateQueries({ queryKey: ["org", orgId, "lots"] });
    } catch (e) {
      const details =
        e instanceof ApiError && e.details.length
          ? `: ${e.details.map((d) => `${d.path ?? ""} ${d.message}`).join("; ")}`
          : "";
      setState({ kind: "error", message: `${(e as Error).message}${details}` });
    } finally {
      setBusy(false);
    }
  };
  return { state, busy, submit };
};

function HarvestForm({ orgId }: { orgId: string }) {
  const md = useMasterData(orgId);
  const { state, busy, submit } = useSubmit(orgId);
  const plots = md.locations.filter((l) => l.type === "plot" || l.type === "farm");
  const olives = md.products.filter((p) => p.category === "olives");
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const v = formValues(e.currentTarget);
    void submit(
      {
        type: "ORIGINATE",
        process: "harvest",
        occurredAt: toIso(v.occurredAt),
        locationId: v.locationId ?? undefined,
        kdes: {
          cultivars: (v.cultivars ?? "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          ...(v.harvestMethod ? { harvestMethod: v.harvestMethod } : {}),
        },
        outputs: [
          {
            productId: v.productId ?? "",
            quantity: v.quantity ?? "0",
            ...(v.lotCode ? { lotCode: v.lotCode } : {}),
          },
        ],
        inputs: [],
      },
      `Harvest of ${v.quantity} kg`,
      e.currentTarget,
    );
  };
  return (
    <form onSubmit={onSubmit} className="grid gap-3">
      <Result state={state} />
      <SelectField label="Plot" name="locationId" required>
        {plots.map((l) => (
          <option key={l.id} value={l.id}>
            {l.code} · {l.name}
          </option>
        ))}
      </SelectField>
      <SelectField label="Olives" name="productId" required>
        {olives.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </SelectField>
      <Field label="Quantity (kg)" name="quantity" inputMode="decimal" required />
      <Field label="Cultivars" name="cultivars" required placeholder="Coratina" />
      <SelectField label="Harvest method" name="harvestMethod" defaultValue="">
        <option value="">—</option>
        <option value="hand">By hand</option>
        <option value="mechanical">Mechanical</option>
        <option value="net">Nets</option>
      </SelectField>
      <Field
        label="Harvested at"
        name="occurredAt"
        type="datetime-local"
        defaultValue={nowLocal()}
        required
      />
      <Field label="Lot code (optional)" name="lotCode" hint="Leave empty to generate one" />
      <Button type="submit" busy={busy}>
        Record harvest
      </Button>
    </form>
  );
}

function ReceiveForm({ orgId }: { orgId: string }) {
  const md = useMasterData(orgId);
  const { state, busy, submit } = useSubmit(orgId);
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const v = formValues(e.currentTarget);
    void submit(
      {
        type: "RECEIVE",
        occurredAt: toIso(v.occurredAt),
        partnerId: v.partnerId ?? undefined,
        locationId: v.locationId ?? undefined,
        kdes: {
          ...(v.supplierLotCode ? { supplierLotCode: v.supplierLotCode } : {}),
          ...(v.deliveryNote ? { deliveryNote: v.deliveryNote } : {}),
        },
        outputs: [
          {
            productId: v.productId ?? "",
            quantity: v.quantity ?? "0",
            ...(v.lotCode ? { lotCode: v.lotCode } : {}),
          },
        ],
        inputs: [],
      },
      `Receipt of ${v.quantity}`,
      e.currentTarget,
    );
  };
  return (
    <form onSubmit={onSubmit} className="grid gap-3">
      <Result state={state} />
      <SelectField label="From supplier" name="partnerId" required>
        {md.partners
          .filter((p) => p.kind !== "customer")
          .map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
      </SelectField>
      <SelectField label="Product" name="productId" required>
        {md.products.map((p) => (
          <option key={p.id} value={p.id}>
            {p.sku} · {p.name} ({p.uomCode})
          </option>
        ))}
      </SelectField>
      <Field label="Quantity" name="quantity" inputMode="decimal" required hint="In the product's unit" />
      <Field label="Supplier's lot code" name="supplierLotCode" />
      <Field label="Delivery note" name="deliveryNote" />
      <SelectField label="Received at" name="locationId" defaultValue="">
        <option value="">—</option>
        {md.locations
          .filter((l) => l.type !== "plot")
          .map((l) => (
            <option key={l.id} value={l.id}>
              {l.code} · {l.name}
            </option>
          ))}
      </SelectField>
      <Field
        label="Date and time"
        name="occurredAt"
        type="datetime-local"
        defaultValue={nowLocal()}
        required
      />
      <Field label="Our lot code (optional)" name="lotCode" />
      <Button type="submit" busy={busy}>
        Record receipt
      </Button>
    </form>
  );
}

function ShipForm({ orgId }: { orgId: string }) {
  const md = useMasterData(orgId);
  const { state, busy, submit } = useSubmit(orgId);
  const customers = md.partners.filter((p) => p.kind !== "supplier");
  const [customerId, setCustomerId] = useState("");
  const customer = customers.find((p) => p.id === (customerId || customers[0]?.id));
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const v = formValues(e.currentTarget);
    const share =
      customer?.onPlatform && v.share === "on"
        ? { upstreamDepth: 5, includeKdes: v.shareDetails === "on", includeEvidence: false }
        : undefined;
    void submit(
      {
        type: "SHIP",
        occurredAt: toIso(v.occurredAt),
        partnerId: v.partnerId ?? undefined,
        kdes: {
          ...(v.shipmentRef ? { shipmentRef: v.shipmentRef } : {}),
          ...(v.sscc ? { sscc: v.sscc } : {}),
        },
        inputs: [{ lotId: v.lotId ?? "", quantity: v.quantity ?? "0" }],
        outputs: [],
        ...(share ? { share } : {}),
      },
      `Shipment of ${v.quantity}`,
      e.currentTarget,
    );
  };
  return (
    <form onSubmit={onSubmit} className="grid gap-3">
      <Result state={state} />
      <SelectField
        label="To customer"
        name="partnerId"
        required
        value={customer?.id ?? ""}
        onChange={(e) => setCustomerId(e.target.value)}
      >
        {customers.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
            {p.onPlatform ? " (on Casitrace)" : ""}
          </option>
        ))}
      </SelectField>
      {customer?.onPlatform && (
        <fieldset className="grid gap-1 rounded border border-line p-3 text-sm">
          <legend className="px-1 font-medium">They use Casitrace</legend>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="share" defaultChecked /> Share this lot's history with them (5 steps
            back)
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="shareDetails" defaultChecked /> Include process details
            (temperatures, dates…)
          </label>
          <p className="text-xs text-muted">You can stop sharing at any time on the Sharing page.</p>
        </fieldset>
      )}
      <SelectField label="Lot" name="lotId" required>
        {md.lots.map((l) => (
          <option key={l.id} value={l.id}>
            {l.lotCode} · {l.product.name} · {l.quantity} {l.uomCode}
          </option>
        ))}
      </SelectField>
      <Field label="Quantity" name="quantity" inputMode="decimal" required />
      <Field label="Order / shipment reference" name="shipmentRef" />
      <Field label="SSCC (pallet code)" name="sscc" inputMode="numeric" />
      <Field label="Shipped at" name="occurredAt" type="datetime-local" defaultValue={nowLocal()} required />
      <Button type="submit" busy={busy}>
        Record shipment
      </Button>
    </form>
  );
}

type Line = { key: string; lotId: string; quantity: string };
type OutLine = { key: string; productId: string; quantity: string; lotCode: string };
const rowKey = () => crypto.randomUUID();

function TransformForm({ orgId }: { orgId: string }) {
  const md = useMasterData(orgId);
  const { state, busy, submit } = useSubmit(orgId);
  const [process, setProcess] = useState("milling");
  const [inputs, setInputs] = useState<Line[]>([{ key: rowKey(), lotId: "", quantity: "" }]);
  const [outputs, setOutputs] = useState<OutLine[]>([
    { key: rowKey(), productId: "", quantity: "", lotCode: "" },
  ]);
  const [override, setOverride] = useState("");
  const can = useCan();

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const v = formValues(e.currentTarget);
    const kdes: Record<string, unknown> =
      process === "milling"
        ? {
            extractionMethod: v.extractionMethod,
            malaxationMaxTempC: Number(v.malaxationMaxTempC),
            ...(v.storageTank ? { storageTank: v.storageTank } : {}),
          }
        : process === "bottling"
          ? { bestBefore: v.bestBefore }
          : process === "other"
            ? { description: v.description }
            : {};
    void submit(
      {
        type: "TRANSFORM",
        process: process as "milling",
        occurredAt: toIso(v.occurredAt),
        locationId: v.locationId ?? undefined,
        kdes,
        inputs: inputs.filter((i) => i.lotId).map((i) => ({ lotId: i.lotId, quantity: i.quantity })),
        outputs: outputs
          .filter((o) => o.productId)
          .map((o) => ({
            productId: o.productId,
            quantity: o.quantity,
            ...(o.lotCode ? { lotCode: o.lotCode } : {}),
          })),
        ...(override ? { overrideMassBalance: { reason: override } } : {}),
      },
      `${process[0]?.toUpperCase()}${process.slice(1)}`,
    );
  };
  const cell = "rounded border border-line bg-surface px-2 py-1.5 text-sm";
  return (
    <form onSubmit={onSubmit} className="grid gap-3">
      <Result state={state} />
      <SelectField label="Process" value={process} onChange={(e) => setProcess(e.target.value)}>
        <option value="milling">Milling (olives → oil)</option>
        <option value="blending">Blending</option>
        <option value="bottling">Bottling</option>
        <option value="split">Split a lot</option>
        <option value="other">Other</option>
      </SelectField>
      <fieldset className="grid gap-2">
        <legend className="text-sm font-medium">Used (inputs)</legend>
        {inputs.map((l, i) => (
          <div key={l.key} className="grid grid-cols-[minmax(0,1fr)_110px] gap-2">
            <select
              aria-label={`Input lot ${i + 1}`}
              className={cell}
              value={l.lotId}
              onChange={(e) =>
                setInputs(inputs.map((x, j) => (j === i ? { ...x, lotId: e.target.value } : x)))
              }
            >
              <option value="">Choose a lot</option>
              {md.lots.map((lot) => (
                <option key={lot.id} value={lot.id}>
                  {lot.lotCode} · {lot.product.name} · {lot.quantity} {lot.uomCode}
                </option>
              ))}
            </select>
            <input
              aria-label={`Input quantity ${i + 1}`}
              className={cell}
              inputMode="decimal"
              value={l.quantity}
              onChange={(e) =>
                setInputs(inputs.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))
              }
            />
          </div>
        ))}
        <button
          type="button"
          className="justify-self-start text-sm text-brand underline"
          onClick={() => setInputs([...inputs, { key: rowKey(), lotId: "", quantity: "" }])}
        >
          Add input
        </button>
      </fieldset>
      <fieldset className="grid gap-2">
        <legend className="text-sm font-medium">Produced (outputs)</legend>
        {outputs.map((o, i) => (
          <div
            key={o.key}
            className="grid grid-cols-[minmax(0,1fr)_110px] gap-2 sm:grid-cols-[minmax(0,1fr)_110px_140px]"
          >
            <select
              aria-label={`Output product ${i + 1}`}
              className={cell}
              value={o.productId}
              onChange={(e) =>
                setOutputs(outputs.map((x, j) => (j === i ? { ...x, productId: e.target.value } : x)))
              }
            >
              <option value="">Choose a product</option>
              {md.products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.sku} · {p.name} ({p.uomCode})
                </option>
              ))}
            </select>
            <input
              aria-label={`Output quantity ${i + 1}`}
              className={cell}
              inputMode="decimal"
              value={o.quantity}
              onChange={(e) =>
                setOutputs(outputs.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))
              }
            />
            <input
              aria-label={`Output lot code ${i + 1}`}
              placeholder="Lot code (optional)"
              className={cell}
              value={o.lotCode}
              onChange={(e) =>
                setOutputs(outputs.map((x, j) => (j === i ? { ...x, lotCode: e.target.value } : x)))
              }
            />
          </div>
        ))}
        <button
          type="button"
          className="justify-self-start text-sm text-brand underline"
          onClick={() =>
            setOutputs([...outputs, { key: rowKey(), productId: "", quantity: "", lotCode: "" }])
          }
        >
          Add output
        </button>
      </fieldset>
      {process === "milling" && (
        <div className="grid gap-3 sm:grid-cols-3">
          <SelectField label="Extraction" name="extractionMethod" defaultValue="two_phase">
            <option value="two_phase">Two-phase</option>
            <option value="three_phase">Three-phase</option>
            <option value="press">Press</option>
            <option value="other">Other</option>
          </SelectField>
          <Field label="Max malaxation temp (°C)" name="malaxationMaxTempC" inputMode="decimal" required />
          <Field label="Storage tank" name="storageTank" />
        </div>
      )}
      {process === "bottling" && <Field label="Best before" name="bestBefore" type="date" required />}
      {process === "other" && <Field label="What was done" name="description" required />}
      <SelectField label="Where" name="locationId" defaultValue="">
        <option value="">—</option>
        {md.locations
          .filter((l) => l.type !== "plot")
          .map((l) => (
            <option key={l.id} value={l.id}>
              {l.code} · {l.name}
            </option>
          ))}
      </SelectField>
      <Field
        label="Date and time"
        name="occurredAt"
        type="datetime-local"
        defaultValue={nowLocal()}
        required
      />
      {can("event:override") && (
        <Field
          label="Accept despite mass balance (reason)"
          value={override}
          onChange={(e) => setOverride(e.target.value)}
          hint="Only if outputs really exceed inputs, e.g. an intake scale was wrong"
        />
      )}
      <Button type="submit" busy={busy}>
        Record transformation
      </Button>
    </form>
  );
}

const FORMS: Record<string, { title: string; render: (orgId: string) => ReactNode }> = {
  harvest: { title: "Harvest", render: (o) => <HarvestForm orgId={o} /> },
  receive: { title: "Receive", render: (o) => <ReceiveForm orgId={o} /> },
  transform: { title: "Transform", render: (o) => <TransformForm orgId={o} /> },
  ship: { title: "Ship", render: (o) => <ShipForm orgId={o} /> },
};

export function CapturePage() {
  const org = useOrgContext();
  const can = useCan();
  const { kind = "harvest" } = useParams();
  const form = FORMS[kind] ?? FORMS.harvest;
  if (!can("event:record")) return <Alert tone="info">Your role cannot record events.</Alert>;
  return (
    <div className="mx-auto max-w-xl">
      <QueueBanner orgId={org.id} />
      <nav aria-label="Record" className="mb-4 grid grid-cols-4 gap-1">
        {Object.entries(FORMS).map(([k, f]) => (
          <NavLink
            key={k}
            to={`../record/${k}`}
            className={({ isActive }) =>
              `rounded border px-2 py-2.5 text-center text-sm ${isActive ? "border-brand bg-brand text-canvas" : "border-line bg-surface"}`
            }
          >
            {f.title}
          </NavLink>
        ))}
      </nav>
      <Card title={form?.title}>{form?.render(org.id)}</Card>
    </div>
  );
}
