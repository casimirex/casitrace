import type { components } from "@casitrace/api-client";
import { IMPORT_KINDS } from "@casitrace/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Alert, Button, Card, SelectField } from "../../components/ui";
import { api, unwrap } from "../../lib/api";
import { useCan, useOrgContext } from "./common";

type Kind = (typeof IMPORT_KINDS)[number];
type Preview = components["schemas"]["ImportPreview"];
const KIND_LABEL: Record<Kind, string> = {
  products: "Products",
  locations: "Locations",
  partners: "Trading partners",
};
const ACTION_STYLE: Record<string, string> = {
  create: "text-ok",
  update: "text-ink",
  unchanged: "text-muted",
  error: "text-fail font-medium",
};

export function ImportPage() {
  const org = useOrgContext();
  const can = useCan();
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<Kind>("products");
  const [csv, setCsv] = useState<string>();
  const [fileName, setFileName] = useState<string>();
  const [preview, setPreview] = useState<Preview>();
  const [done, setDone] = useState<string>();
  const params = { params: { path: { orgId: org.id, kind } } };

  const check = useMutation({
    mutationFn: async (text: string) =>
      unwrap(await api.POST("/v1/orgs/{orgId}/imports/{kind}/preview", { ...params, body: { csv: text } })),
    onSuccess: setPreview,
  });
  const commit = useMutation({
    mutationFn: async () =>
      unwrap(await api.POST("/v1/orgs/{orgId}/imports/{kind}", { ...params, body: { csv: csv ?? "" } })),
    onSuccess: async (r) => {
      setDone(`Imported: ${r.created} created, ${r.updated} updated, ${r.unchanged} unchanged.`);
      setPreview(undefined);
      setCsv(undefined);
      await queryClient.invalidateQueries({ queryKey: ["org", org.id] });
    },
  });

  const downloadTemplate = async () => {
    const res = await fetch(`/api/v1/orgs/${org.id}/imports/${kind}/template`, { credentials: "include" });
    const url = URL.createObjectURL(await res.blob());
    Object.assign(document.createElement("a"), { href: url, download: `casitrace-${kind}.csv` }).click();
    URL.revokeObjectURL(url);
  };

  if (!can("import:run"))
    return <Alert tone="info">Your role cannot import data. Ask an owner, admin or operator.</Alert>;
  const errorsCount = preview ? preview.totalRows - preview.validRows : 0;
  return (
    <div className="grid gap-6">
      <Card title="Import from a spreadsheet">
        <div className="grid gap-4 sm:grid-cols-[200px_minmax(0,1fr)_auto] sm:items-end">
          <SelectField
            label="What to import"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as Kind);
              setPreview(undefined);
              setCsv(undefined);
            }}
          >
            {IMPORT_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </SelectField>
          <div className="grid gap-1.5">
            <label htmlFor="csv-file" className="text-sm font-medium">
              CSV file
            </label>
            <input
              id="csv-file"
              type="file"
              accept=".csv,text/csv"
              className="text-sm"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const text = await file.text();
                setFileName(file.name);
                setCsv(text);
                setDone(undefined);
                check.mutate(text);
              }}
            />
          </div>
          <Button variant="secondary" onClick={downloadTemplate}>
            Download template
          </Button>
        </div>
        <p className="mt-3 text-sm text-muted">
          Files are checked first and nothing changes until you confirm. Rows are matched by SKU, location
          code or partner name; a changed product becomes a new version.
        </p>
        <div className="mt-3 grid gap-2">
          {check.isError && <Alert>{check.error.message}</Alert>}
          {commit.isError && <Alert>{commit.error.message}</Alert>}
          {done && <Alert tone="success">{done}</Alert>}
        </div>
      </Card>
      {preview && (
        <Card
          title={`Check of ${fileName ?? "file"}`}
          actions={
            <Button disabled={errorsCount > 0} busy={commit.isPending} onClick={() => commit.mutate()}>
              {errorsCount > 0 ? `Fix ${errorsCount} row(s) to import` : `Import ${preview.totalRows} row(s)`}
            </Button>
          }
        >
          {preview.unknownColumns.length > 0 && (
            <div className="mb-3">
              <Alert tone="info">Ignored columns: {preview.unknownColumns.join(", ")}</Alert>
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm" aria-label="Import check">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted">
                  <th className="py-2 pr-3 font-medium">Line</th>
                  <th className="py-2 pr-3 font-medium">Key</th>
                  <th className="py-2 pr-3 font-medium">Result</th>
                  <th className="py-2 font-medium">Problems</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {preview.rows.map((r) => (
                  <tr key={r.line}>
                    <td className="py-1.5 pr-3 tabular-nums">{r.line}</td>
                    <td className="py-1.5 pr-3 font-mono text-xs">{r.key || "—"}</td>
                    <td className={`py-1.5 pr-3 capitalize ${ACTION_STYLE[r.action]}`}>{r.action}</td>
                    <td className="py-1.5 text-fail">
                      {r.errors.map((e) => `${e.column}: ${e.message}`).join("; ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
