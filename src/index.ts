export type Vec3 = [number, number, number];
export type Unit = "m" | "cm" | "mm" | "ft";
export type Category =
  "bed" | "sofa" | "chair" | "table" | "storage" | "unknown";
export type Label = {
  category: Category;
  confidence: number;
  source: "scanner" | "vision" | "user";
  model?: string;
};
/** Canonical right-handed coordinates: metres, Y up. Rotation about +Y in radians. */
export type Box = { center: Vec3; dimensions: Vec3; yaw: number };
export type Observation = {
  id: string;
  points?: Vec3[];
  box?: Box;
  label?: Label;
  embedding?: number[];
};
export type CatalogItem = {
  id: string;
  category: Exclude<Category, "unknown">;
  dimensions: Vec3;
  embedding?: number[];
  assetId?: string;
};
export type Scan = {
  version: 1;
  unit: Unit;
  upAxis: "y" | "z";
  objects: Observation[];
  embeddingSpace?: string;
};
export type Catalog = {
  version: 1;
  items: CatalogItem[];
  embeddingSpace?: string;
};
export type Match = {
  catalogId: string;
  assetId?: string;
  score: number;
  shapeScore: number;
  appearanceScore: number | null;
  transform: { position: Vec3; yaw: number; scale: Vec3 };
  warnings: string[];
};
export type MeasuredObject = {
  id: string;
  box: Box;
  measurementSource: "scanner-box" | "point-estimate";
  label: Label | null;
  candidates: Match[];
  reviewRequired: true;
  warnings: string[];
};
const units = { m: 1, cm: 0.01, mm: 0.001, ft: 0.3048 };
const categories = new Set([
  "bed",
  "sofa",
  "chair",
  "table",
  "storage",
  "unknown",
]);
const MAX_POINTS = 100_000;
function fail(message: string): never {
  throw new Error(message);
}
function finite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}
function vector(value: unknown, positive = false): asserts value is Vec3 {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    !value.every((v) => finite(v) && Math.abs(v) <= 1e9 && (!positive || v > 0))
  )
    fail(
      "Expected three finite coordinates within +/-1e9" +
        (positive ? " greater than zero" : ""),
    );
}
function embedding(value: unknown) {
  if (value === undefined) return;
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > 4096 ||
    !value.every(finite) ||
    !Number.isFinite(Math.hypot(...value)) ||
    Math.hypot(...value) === 0
  )
    fail("Invalid embedding");
}
function validateBox(box: Box) {
  if (!box) fail("Missing box");
  vector(box.center);
  vector(box.dimensions, true);
  if (!finite(box.yaw)) fail("Box yaw must be finite radians");
}
function validateLabel(label: Label | undefined) {
  if (!label) return;
  if (
    !categories.has(label.category) ||
    !finite(label.confidence) ||
    label.confidence < 0 ||
    label.confidence > 1 ||
    !["scanner", "vision", "user"].includes(label.source)
  )
    fail("Invalid category evidence");
}
function ids(items: { id: string }[]) {
  const used = new Set<string>();
  for (const item of items) {
    if (
      !item ||
      typeof item.id !== "string" ||
      !item.id.trim() ||
      used.has(item.id)
    )
      fail("IDs must be nonempty and unique");
    used.add(item.id);
  }
}
export function validateScan(scan: Scan): void {
  if (
    !scan ||
    scan.version !== 1 ||
    !Object.hasOwn(units, scan.unit) ||
    !["y", "z"].includes(scan.upAxis) ||
    !Array.isArray(scan.objects) ||
    scan.objects.length > 1000
  )
    fail("Invalid scan header");
  ids(scan.objects);
  let total = 0;
  for (const object of scan.objects) {
    if (Boolean(object.points) === Boolean(object.box))
      fail("Each object requires exactly one of points or box");
    if (object.box) {
      validateBox(object.box);
      if (scan.upAxis !== "y")
        fail(
          "Structured boxes require Y-up; convert their full transform first",
        );
    }
    if (object.points) {
      total += object.points.length;
      if (object.points.length < 4 || total > MAX_POINTS)
        fail("Point budget exceeded or insufficient points");
      object.points.forEach((p) => vector(p));
    }
    validateLabel(object.label);
    embedding(object.embedding);
  }
}
export function validateCatalog(catalog: Catalog): void {
  if (
    !catalog ||
    catalog.version !== 1 ||
    !Array.isArray(catalog.items) ||
    catalog.items.length > 10000
  )
    fail("Invalid catalog");
  ids(catalog.items);
  for (const item of catalog.items) {
    if (!categories.has(item.category) || String(item.category) === "unknown")
      fail("Catalog item requires a supported category");
    vector(item.dimensions, true);
    embedding(item.embedding);
  }
}
export function normalizePoint(
  point: Vec3,
  unit: Unit,
  upAxis: "y" | "z",
): Vec3 {
  vector(point);
  if (!Object.hasOwn(units, unit) || !["y", "z"].includes(upAxis))
    fail("Unsupported coordinate convention");
  const f = units[unit];
  return upAxis === "y"
    ? [point[0] * f, point[1] * f, point[2] * f]
    : [point[0] * f, point[2] * f, -point[1] * f];
}
/** PCA orientation in the ground plane; enclosing extents include all supplied points. */
export function estimateBox(points: Vec3[]): Box {
  if (points.length < 4 || points.length > MAX_POINTS)
    fail("Point cloud must contain 4–100000 points");
  points.forEach((p) => vector(p));
  let mx = 0,
    mz = 0;
  for (const p of points) {
    mx += p[0] / points.length;
    mz += p[2] / points.length;
  }
  let xx = 0,
    zz = 0,
    xz = 0;
  for (const p of points) {
    const x = p[0] - mx,
      z = p[2] - mz;
    xx += x * x;
    zz += z * z;
    xz += x * z;
  }
  // Local +X maps to [cos(yaw),0,-sin(yaw)].
  const yaw = -0.5 * Math.atan2(2 * xz, xx - zz),
    c = Math.cos(yaw),
    s = Math.sin(yaw);
  const low = [Infinity, Infinity, Infinity],
    high = [-Infinity, -Infinity, -Infinity];
  for (const p of points) {
    const local = [
      c * (p[0] - mx) - s * (p[2] - mz),
      p[1],
      s * (p[0] - mx) + c * (p[2] - mz),
    ];
    for (let j = 0; j < 3; j++) {
      low[j] = Math.min(low[j]!, local[j]!);
      high[j] = Math.max(high[j]!, local[j]!);
    }
  }
  const dims = high.map((v, i) => v - low[i]!) as Vec3;
  if (dims.some((d) => d < 0.001))
    fail("Degenerate object: cannot measure three dimensions");
  const x = (low[0]! + high[0]!) / 2,
    z = (low[2]! + high[2]!) / 2;
  return {
    center: [mx + c * x + s * z, (low[1]! + high[1]!) / 2, mz - s * x + c * z],
    dimensions: dims,
    yaw,
  };
}
function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length)
    fail("Embeddings in the same space must have equal dimensions");
  const normA = Math.hypot(...a),
    normB = Math.hypot(...b);
  const value = a.reduce((sum, v, i) => sum + (v / normA) * (b[i]! / normB), 0);
  return Math.max(-1, Math.min(1, value));
}
/** Scores are ranking heuristics, not calibrated recognition probabilities. */
export function matchCatalog(
  box: Box,
  label: Label | undefined,
  features: number[] | undefined,
  catalog: Catalog,
  space?: string,
  topK = 3,
): Match[] {
  validateBox(box);
  validateLabel(label);
  embedding(features);
  validateCatalog(catalog);
  if (!Number.isInteger(topK) || topK < 1 || topK > 20)
    fail("topK must be 1–20");
  if (!label || label.category === "unknown" || label.confidence < 0.6)
    return [];
  const matches: Match[] = [];
  for (const item of catalog.items.filter(
    (i) => i.category === label.category,
  )) {
    const fits = [0, 1]
      .map((turn) => {
        const target: Vec3 = turn
          ? [box.dimensions[2], box.dimensions[1], box.dimensions[0]]
          : box.dimensions;
        const scale = target.map((v, i) => v / item.dimensions[i]!) as Vec3;
        const logs = scale.map(Math.log),
          mean = logs.reduce((a, b) => a + b, 0) / 3;
        const distortion = Math.sqrt(
          logs.reduce((a, v) => a + (v - mean) ** 2, 0) / 3,
        );
        return {
          scale,
          turn,
          distortion,
          cost: distortion + Math.abs(mean) * 0.25,
        };
      })
      .sort((a, b) => a.cost - b.cost);
    const fit = fits[0]!;
    if (fit.scale.some((s) => s < 0.5 || s > 2)) continue;
    const shapeScore = Math.exp(-3 * fit.cost);
    const comparable =
      !!space &&
      space === catalog.embeddingSpace &&
      !!features &&
      !!item.embedding;
    const appearanceScore = comparable
      ? (cosine(features!, item.embedding!) + 1) / 2
      : null;
    const score =
      appearanceScore === null
        ? shapeScore
        : 0.65 * shapeScore + 0.35 * appearanceScore;
    const warnings: string[] = [];
    if (Math.max(...fit.scale) / Math.min(...fit.scale) > 1.35)
      warnings.push("Nonuniform scaling may distort this model");
    if (appearanceScore === null)
      warnings.push(
        "Appearance not compared; ranked by category and dimensions only",
      );
    matches.push({
      catalogId: item.id,
      assetId: item.assetId,
      score,
      shapeScore,
      appearanceScore,
      transform: {
        position: [
          box.center[0],
          box.center[1] - box.dimensions[1] / 2,
          box.center[2],
        ],
        yaw: box.yaw + (fit.turn * Math.PI) / 2,
        scale: fit.scale,
      },
      warnings,
    });
  }
  return matches
    .sort((a, b) => b.score - a.score || a.catalogId.localeCompare(b.catalogId))
    .slice(0, topK);
}
export function analyze(
  scan: Scan,
  catalog: Catalog,
): { version: 1; objects: MeasuredObject[] } {
  validateScan(scan);
  validateCatalog(catalog);
  return {
    version: 1,
    objects: scan.objects.map((object) => {
      const factor = units[scan.unit];
      const box = object.box
        ? {
            center: object.box.center.map((v) => v * factor) as Vec3,
            dimensions: object.box.dimensions.map((v) => v * factor) as Vec3,
            yaw: object.box.yaw,
          }
        : estimateBox(
            object.points!.map((p) =>
              normalizePoint(p, scan.unit, scan.upAxis),
            ),
          );
      const warnings = object.points
        ? [
            "Point-cloud dimensions are estimates; occlusion and outliers can change the fit",
          ]
        : [];
      const candidates = matchCatalog(
        box,
        object.label,
        object.embedding,
        catalog,
        scan.embeddingSpace,
      );
      if (!candidates.length)
        warnings.push(
          "No reliable category or acceptable catalog fit; keep the original object",
        );
      return {
        id: object.id,
        box,
        measurementSource: object.box ? "scanner-box" : "point-estimate",
        label: object.label ?? null,
        candidates,
        reviewRequired: true,
        warnings,
      };
    }),
  };
}
/** Explicit acceptance, never automatic replacement. Model origin must be bottom center. */
export function acceptCandidate(object: MeasuredObject, catalogId: string) {
  const match = object.candidates.find((c) => c.catalogId === catalogId);
  if (!match) fail("Candidate was not offered for this object");
  return {
    objectId: object.id,
    catalogId,
    assetId: match.assetId,
    transform: match.transform,
    measuredBox: object.box,
    acceptedBy: "user" as const,
  };
}
/** Adapter to the studio's X/Y floor plane (world Z is negated). Preserve yaw for a future rotation-aware editor. */
export function toStudioSuggestion(object: MeasuredObject) {
  return {
    id: object.id,
    x: object.box.center[0],
    y: -object.box.center[2],
    width: object.box.dimensions[0],
    depth: object.box.dimensions[2],
    height: object.box.dimensions[1],
    yaw: object.box.yaw,
    candidates: object.candidates,
    reviewRequired: true,
  };
}

/** Geometry-only connected components. Touching furniture may merge; no semantic label is inferred. */
export function clusterPoints(
  input: Vec3[],
  options: {
    radius: number;
    minPoints?: number;
    floorY?: number;
    floorTolerance?: number;
    maxComparisons?: number;
  },
): { clusters: Vec3[][]; discarded: number } {
  if (!Array.isArray(input) || input.length > MAX_POINTS)
    fail("Point budget exceeded");
  input.forEach((p) => vector(p));
  const {
    radius,
    minPoints = 4,
    floorY,
    floorTolerance = 0.04,
    maxComparisons = 2_000_000,
  } = options;
  if (
    !finite(radius) ||
    radius <= 0 ||
    !Number.isInteger(minPoints) ||
    minPoints < 1 ||
    !finite(floorTolerance) ||
    floorTolerance < 0 ||
    !Number.isInteger(maxComparisons) ||
    maxComparisons < 1 ||
    (floorY !== undefined && !finite(floorY))
  )
    fail("Invalid clustering options");
  const points = input.filter(
    (p) => floorY === undefined || Math.abs(p[1] - floorY) > floorTolerance,
  );
  const cells = new Map<string, number[]>();
  const cell = (p: Vec3) => p.map((v) => Math.floor(v / radius));
  points.forEach((p, i) => {
    const key = cell(p).join(",");
    const bucket = cells.get(key) ?? [];
    bucket.push(i);
    cells.set(key, bucket);
  });
  const seen = new Set<number>(),
    clusters: Vec3[][] = [];
  let comparisons = 0,
    discarded = input.length - points.length;
  for (let seed = 0; seed < points.length; seed++) {
    if (seen.has(seed)) continue;
    const queue = [seed];
    seen.add(seed);
    for (let head = 0; head < queue.length; head++) {
      const point = points[queue[head]!]!,
        base = cell(point);
      for (let x = -1; x <= 1; x++)
        for (let y = -1; y <= 1; y++)
          for (let z = -1; z <= 1; z++) {
            for (const index of cells.get(
              [base[0]! + x, base[1]! + y, base[2]! + z].join(","),
            ) ?? []) {
              if (++comparisons > maxComparisons)
                fail(
                  "Clustering work budget exceeded; voxel-downsample the input first",
                );
              if (seen.has(index)) continue;
              const p = points[index]!;
              if (
                Math.hypot(point[0] - p[0], point[1] - p[1], point[2] - p[2]) <=
                radius
              ) {
                seen.add(index);
                queue.push(index);
              }
            }
          }
    }
    if (queue.length >= minPoints) clusters.push(queue.map((i) => points[i]!));
    else discarded += queue.length;
  }
  return { clusters, discarded };
}

/** Contract for a native capture bridge; NOT a parser for arbitrary Apple USDZ/JSON exports. */
export type RoomPlanBridge = {
  objects: {
    id: string;
    category: Category;
    center: Vec3;
    dimensions: Vec3;
    yaw: number;
    confidence: number;
  }[];
};
export function fromRoomPlanBridge(input: RoomPlanBridge): Scan {
  if (!input || !Array.isArray(input.objects))
    fail("Expected RoomPlan bridge objects");
  const scan: Scan = {
    version: 1,
    unit: "m",
    upAxis: "y",
    objects: input.objects.map((o) => ({
      id: o.id,
      box: { center: o.center, dimensions: o.dimensions, yaw: o.yaw },
      label: {
        category: o.category,
        confidence: o.confidence,
        source: "scanner",
      },
    })),
  };
  validateScan(scan);
  return scan;
}
