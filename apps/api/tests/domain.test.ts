import { describe, expect, test } from "bun:test";
import { Gtin, gs1CheckDigitValid, ProductCreateInput } from "@casitrace/contracts";
import { normalizeVersion } from "../src/modules/catalog/domain/product-rules";
import { validateBoundary } from "../src/modules/parties/domain/geometry";
import { CsvError, parseCsv } from "../src/platform/csv";

type P = [number, number];
const ring = (lon: number, lat: number, d: number): P[] => [
  [lon, lat],
  [lon + d, lat],
  [lon + d, lat + d],
  [lon, lat + d],
  [lon, lat],
];
const square = (lon: number, lat: number, d: number) => ({
  type: "Polygon" as const,
  coordinates: [ring(lon, lat, d)],
});

describe("boundary validation", () => {
  test("a ~100 m square in Puglia is about 0.93 ha", () => {
    // 0.001° lat ≈ 111 m; 0.0012° lon at 41.2° ≈ 100 m
    const r = validateBoundary({
      type: "Polygon",
      coordinates: [
        [
          [16.287, 41.233],
          [16.2882, 41.233],
          [16.2882, 41.2338],
          [16.287, 41.2338],
          [16.287, 41.233],
        ],
      ],
    });
    expect(r.issues).toEqual([]);
    expect(r.areaHa).toBeGreaterThan(0.8);
    expect(r.areaHa).toBeLessThan(0.9);
  });

  test("rejects a self-intersecting (bow-tie) ring", () => {
    const r = validateBoundary({
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [1, 1],
          [1, 0],
          [0, 1],
          [0, 0],
        ],
      ],
    });
    expect(r.issues[0]?.message).toContain("crosses itself");
  });

  test("rejects an unclosed ring", () => {
    const r = validateBoundary({
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
        ],
      ],
    });
    expect(r.issues[0]?.message).toContain("not closed");
  });

  test("rejects a ring with no area (all points on a line)", () => {
    const r = validateBoundary({
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [2, 0],
          [0, 0],
        ],
      ],
    });
    expect(r.issues.length).toBeGreaterThan(0);
  });

  test("subtracts holes and rejects a hole crossing the outer ring", () => {
    const outer = ring(10, 45, 0.01);
    const hole = ring(10.002, 45.002, 0.002);
    const withHole = validateBoundary({ type: "Polygon", coordinates: [outer, hole] });
    const without = validateBoundary({ type: "Polygon", coordinates: [outer] });
    expect(withHole.areaHa).toBeLessThan(without.areaHa ?? 0);
    const crossing = ring(10.008, 45.002, 0.004);
    expect(
      validateBoundary({ type: "Polygon", coordinates: [outer, crossing] }).issues[0]?.message,
    ).toContain("crosses");
  });

  test("accepts a MultiPolygon and adds the parts", () => {
    const a = validateBoundary(square(10, 45, 0.01));
    const m = validateBoundary({
      type: "MultiPolygon",
      coordinates: [square(10, 45, 0.01).coordinates, square(11, 45, 0.01).coordinates],
    });
    expect(m.issues).toEqual([]);
    expect(m.areaHa).toBeGreaterThan((a.areaHa ?? 0) * 1.9);
  });
});

describe("GS1 identifiers", () => {
  test("check digits", () => {
    expect(gs1CheckDigitValid("8001234560010")).toBe(true);
    expect(gs1CheckDigitValid("8001234560011")).toBe(false);
    expect(Gtin.safeParse("4006381333931").success).toBe(true);
    expect(Gtin.safeParse("400638133393").success).toBe(false);
  });
});

describe("CSV parsing", () => {
  test("quotes, escaped quotes, embedded newlines, CRLF and BOM", () => {
    const t = parseCsv('﻿Name,Notes\r\n"Oil, extra","He said ""hi""\nsecond line"\r\nPlain,x\r\n');
    expect(t.header).toEqual(["name", "notes"]);
    expect(t.rows.map((r) => r.values)).toEqual([
      { name: "Oil, extra", notes: 'He said "hi"\nsecond line' },
      { name: "Plain", notes: "x" },
    ]);
    expect(t.rows[1]?.line).toBe(4);
  });

  test("semicolon-separated files (EU spreadsheets)", () => {
    expect(parseCsv("sku;name\nA;Olio, buono").rows[0]?.values).toEqual({ sku: "A", name: "Olio, buono" });
  });

  test("errors: unclosed quote, too many values, duplicate columns, row limit", () => {
    expect(() => parseCsv('a,b\n"x,y')).toThrow(CsvError);
    expect(() => parseCsv("a,b\n1,2,3")).toThrow(/3 values/);
    expect(() => parseCsv("a,A\n1,2")).toThrow(/Duplicate/);
    expect(() => parseCsv("a\n1\n2\n3", 2)).toThrow(/limit/);
  });
});

describe("product rules", () => {
  const base = ProductCreateInput.parse({
    sku: "EVO-750",
    name: "EVO 750 ml",
    category: "olive_oil_packaged",
    uomCode: "unit",
    attributes: { grade: "extra_virgin", netVolumeMl: 750, container: "glass" },
  });

  test("a bottle's unit → litre conversion comes from its net volume", () => {
    expect(normalizeVersion(base).conversions).toEqual([{ fromUom: "unit", toUom: "l", factor: 0.75 }]);
    expect(normalizeVersion(base).attributesSchema).toBe("olive_oil_packaged@1");
  });

  test("rejects a conflicting unit → litre factor, wrong unit for the category and unknown attributes", () => {
    expect(() =>
      normalizeVersion({ ...base, conversions: [{ fromUom: "unit", toUom: "l", factor: 1 }] }),
    ).toThrow();
    expect(() => normalizeVersion({ ...base, uomCode: "kg" })).toThrow();
    expect(() =>
      normalizeVersion({ ...base, attributes: { ...base.attributes, colour: "green" } }),
    ).toThrow();
  });

  test("bulk oil needs a grade; same-dimension conversions are refused", () => {
    const bulk = { ...base, category: "olive_oil_bulk" as const, uomCode: "kg" as const, attributes: {} };
    expect(() => normalizeVersion(bulk)).toThrow();
    expect(() =>
      normalizeVersion({
        ...bulk,
        attributes: { grade: "virgin" },
        conversions: [{ fromUom: "kg", toUom: "g", factor: 1000 }],
      }),
    ).toThrow();
  });
});
