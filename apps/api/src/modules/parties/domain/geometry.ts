import type { Boundary } from "@casitrace/contracts";

/**
 * Topology checks for plot boundaries (GeoJSON, WGS 84). Zod has already checked the structure and
 * coordinate ranges. Pure functions, no I/O.
 */
export interface GeometryIssue {
  path: string;
  message: string;
}

type Pos = readonly number[];
const MAX_VERTICES = 5000;
const EARTH_RADIUS_M = 6_378_137;

const same = (a: Pos, b: Pos) => a[0] === b[0] && a[1] === b[1];

const orient = (a: Pos, b: Pos, c: Pos) => {
  const v =
    ((b[1] ?? 0) - (a[1] ?? 0)) * ((c[0] ?? 0) - (b[0] ?? 0)) -
    ((b[0] ?? 0) - (a[0] ?? 0)) * ((c[1] ?? 0) - (b[1] ?? 0));
  return Math.abs(v) < 1e-15 ? 0 : v > 0 ? 1 : 2;
};
const onSegment = (a: Pos, b: Pos, c: Pos) =>
  (b[0] ?? 0) <= Math.max(a[0] ?? 0, c[0] ?? 0) &&
  (b[0] ?? 0) >= Math.min(a[0] ?? 0, c[0] ?? 0) &&
  (b[1] ?? 0) <= Math.max(a[1] ?? 0, c[1] ?? 0) &&
  (b[1] ?? 0) >= Math.min(a[1] ?? 0, c[1] ?? 0);

export const segmentsIntersect = (p1: Pos, q1: Pos, p2: Pos, q2: Pos): boolean => {
  const o1 = orient(p1, q1, p2);
  const o2 = orient(p1, q1, q2);
  const o3 = orient(p2, q2, p1);
  const o4 = orient(p2, q2, q1);
  if (o1 !== o2 && o3 !== o4) return true;
  return (
    (o1 === 0 && onSegment(p1, p2, q1)) ||
    (o2 === 0 && onSegment(p1, q2, q1)) ||
    (o3 === 0 && onSegment(p2, p1, q2)) ||
    (o4 === 0 && onSegment(p2, q1, q2))
  );
};

/** Signed spherical area of a closed ring in m² (same method as d3-geo / Turf). */
const ringAreaM2 = (ring: Pos[]): number => {
  let total = 0;
  const rad = Math.PI / 180;
  for (let i = 0; i < ring.length - 1; i++) {
    const [lon1 = 0, lat1 = 0] = ring[i] ?? [];
    const [lon2 = 0, lat2 = 0] = ring[i + 1] ?? [];
    total += (lon2 - lon1) * rad * (2 + Math.sin(lat1 * rad) + Math.sin(lat2 * rad));
  }
  return Math.abs((total * EARTH_RADIUS_M * EARTH_RADIUS_M) / 2);
};

const ringIssues = (ring: Pos[], path: string): GeometryIssue[] => {
  const issues: GeometryIssue[] = [];
  const first = ring[0];
  const last = ring.at(-1);
  if (!first || !last || !same(first, last))
    issues.push({ path, message: "Ring is not closed (first and last points differ)" });
  const distinct = new Set(ring.slice(0, -1).map((p) => `${p[0]},${p[1]}`));
  if (distinct.size < 3) issues.push({ path, message: "Ring needs at least 3 distinct points" });
  if (issues.length) return issues;

  const n = ring.length - 1; // segments
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const adjacent = j === i + 1 || (i === 0 && j === n - 1);
      if (adjacent) continue;
      if (segmentsIntersect(ring[i] as Pos, ring[i + 1] as Pos, ring[j] as Pos, ring[j + 1] as Pos)) {
        return [{ path, message: `Boundary crosses itself (segments ${i + 1} and ${j + 1})` }];
      }
    }
  }
  if (ringAreaM2(ring) < 1) issues.push({ path, message: "Ring has no area" });
  return issues;
};

const ringsCross = (a: Pos[], b: Pos[]) => {
  for (let i = 0; i < a.length - 1; i++)
    for (let j = 0; j < b.length - 1; j++)
      if (segmentsIntersect(a[i] as Pos, a[i + 1] as Pos, b[j] as Pos, b[j + 1] as Pos)) return true;
  return false;
};

const polygonIssues = (rings: Pos[][], path: string): GeometryIssue[] => {
  const issues = rings.flatMap((r, i) => ringIssues(r, `${path}[${i}]`));
  if (issues.length) return issues;
  for (let i = 0; i < rings.length; i++)
    for (let j = i + 1; j < rings.length; j++)
      if (ringsCross(rings[i] as Pos[], rings[j] as Pos[]))
        issues.push({ path: `${path}[${j}]`, message: `Ring ${j} crosses ring ${i}` });
  return issues;
};

export interface ValidatedBoundary {
  issues: GeometryIssue[];
  areaHa: number | null;
}

/** Validates a boundary and returns its area in hectares (outer rings minus holes). */
export const validateBoundary = (b: Boundary): ValidatedBoundary => {
  const polygons: Pos[][][] = b.type === "Polygon" ? [b.coordinates] : b.coordinates;
  const vertices = polygons.flat(2).length;
  if (vertices > MAX_VERTICES) {
    return {
      issues: [
        { path: "boundary", message: `Boundary has ${vertices} points; the limit is ${MAX_VERTICES}` },
      ],
      areaHa: null,
    };
  }
  const issues = polygons.flatMap((rings, i) =>
    polygonIssues(rings, b.type === "Polygon" ? "boundary.coordinates" : `boundary.coordinates[${i}]`),
  );
  if (issues.length) return { issues, areaHa: null };
  const m2 = polygons.reduce(
    (sum, [outer, ...holes]) =>
      sum + ringAreaM2(outer as Pos[]) - holes.reduce((h, r) => h + ringAreaM2(r), 0),
    0,
  );
  if (m2 <= 0) return { issues: [{ path: "boundary", message: "Boundary has no area" }], areaHa: null };
  return { issues: [], areaHa: Math.round((m2 / 10_000) * 10_000) / 10_000 };
};
