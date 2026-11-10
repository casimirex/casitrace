/**
 * RFC 4180 CSV parser: quoted fields, escaped quotes (""), commas and newlines inside quotes,
 * CRLF or LF line endings, optional UTF-8 BOM. Also accepts semicolon-separated files (common in
 * EU spreadsheet exports) when the header line contains more semicolons than commas.
 */
export interface CsvTable {
  header: string[];
  rows: { line: number; values: Record<string, string> }[];
}

export class CsvError extends Error {}

export const parseCsv = (input: string, maxRows = 5000): CsvTable => {
  const text = input.replace(/^﻿/, "");
  const firstLine = text.slice(0, text.search(/\r?\n|$/));
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";

  const records: { line: number; fields: string[] }[] = [];
  let field = "";
  let fields: string[] = [];
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else {
        if (ch === "\n") line++;
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field === "") inQuotes = true;
    else if (ch === delimiter) {
      fields.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      fields.push(field);
      records.push({ line: recordLine, fields });
      fields = [];
      field = "";
      line++;
      recordLine = line;
    } else field += ch;
  }
  if (inQuotes) throw new CsvError(`Unclosed quote starting on line ${recordLine}`);
  if (field !== "" || fields.length) {
    fields.push(field);
    records.push({ line: recordLine, fields });
  }

  const nonEmpty = records.filter((r) => r.fields.some((f) => f.trim() !== ""));
  const [head, ...body] = nonEmpty;
  if (!head) throw new CsvError("The file is empty");
  const header = head.fields.map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const dupes = header.filter((h, i) => h && header.indexOf(h) !== i);
  if (dupes.length) throw new CsvError(`Duplicate column(s): ${[...new Set(dupes)].join(", ")}`);
  if (body.length > maxRows) throw new CsvError(`The file has ${body.length} rows; the limit is ${maxRows}`);

  return {
    header,
    rows: body.map((r) => {
      if (r.fields.length > header.length)
        throw new CsvError(
          `Line ${r.line} has ${r.fields.length} values but the header has ${header.length} columns`,
        );
      const values: Record<string, string> = {};
      header.forEach((h, i) => {
        values[h] = (r.fields[i] ?? "").trim();
      });
      return { line: r.line, values };
    }),
  };
};
