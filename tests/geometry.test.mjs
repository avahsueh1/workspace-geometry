import test from "node:test";
import assert from "node:assert/strict";
import {
  estimateBox,
  normalizePoint,
  analyze,
  matchCatalog,
  clusterPoints,
  fromRoomPlanBridge,
  acceptCandidate,
  toStudioSuggestion,
} from "../dist/index.js";
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
const box = { center: [2, 1, -3], dimensions: [2, 1, 0.8], yaw: 0 };
const label = { category: "sofa", confidence: 0.9, source: "scanner" };
const catalog = {
  version: 1,
  items: [
    { id: "fit", category: "sofa", dimensions: [2, 1, 0.8], assetId: "sofa" },
    { id: "chair", category: "chair", dimensions: [2, 1, 0.8] },
    { id: "wide", category: "sofa", dimensions: [3, 1, 1] },
  ],
};
const scan = {
  version: 1,
  unit: "m",
  upAxis: "y",
  objects: [{ id: "object-1", box, label }],
};
function corners(dims, center, yaw) {
  const c = Math.cos(yaw),
    s = Math.sin(yaw);
  return [-1, 1].flatMap((x) =>
    [-1, 1].flatMap((y) =>
      [-1, 1].map((z) => {
        const u = (x * dims[0]) / 2,
          v = (z * dims[2]) / 2;
        return [
          center[0] + c * u + s * v,
          center[1] + (y * dims[1]) / 2,
          center[2] - s * u + c * v,
        ];
      }),
    ),
  );
}
test("centimetres and Z up normalize with preserved handedness", () =>
  assert.deepEqual(normalizePoint([100, 200, 300], "cm", "z"), [1, 3, -2]));
test("rotated point cloud gets an enclosing oriented box", () => {
  const b = estimateBox(corners([4, 2, 1], [10, 3, -5], 0.42));
  b.center.forEach((n, i) => close(n, [10, 3, -5][i]));
  b.dimensions.forEach((n, i) => close(n, [4, 2, 1][i]));
  close(b.yaw, 0.42);
});
test("PCA orientation handles a depth-dominant object via quarter-turn fit", () => {
  const b = estimateBox(corners([1, 2, 4], [0, 1, 0], 0.2));
  const m = matchCatalog(b, { ...label, category: "bed" }, undefined, {
    version: 1,
    items: [{ id: "bed", category: "bed", dimensions: [1, 2, 4] }],
  });
  m[0].transform.scale.forEach((v) => close(v, 1));
});
test("flat clouds and nonfinite coordinates are rejected", () => {
  assert.throws(
    () =>
      estimateBox([
        [0, 0, 0],
        [1, 0, 0],
        [0, 0, 1],
        [1, 0, 1],
      ]),
    /Degenerate/,
  );
  assert.throws(() => normalizePoint([NaN, 0, 0], "m", "y"), /finite/);
});
test("known dimensions are preserved in unit conversion", () => {
  const result = analyze(
    {
      ...scan,
      unit: "cm",
      objects: [
        {
          ...scan.objects[0],
          box: { ...box, dimensions: [200, 100, 80], center: [200, 100, -300] },
        },
      ],
    },
    catalog,
  ).objects[0];
  assert.deepEqual(result.box, box);
  assert.equal(result.measurementSource, "scanner-box");
});
test("category gating excludes wrong types and selects closest proportions", () =>
  assert.deepEqual(
    analyze(scan, catalog).objects[0].candidates.map((c) => c.catalogId),
    ["fit", "wide"],
  ));
test("unknown or low-confidence labels never receive speculative suggestions", () => {
  for (const evidence of [
    undefined,
    { ...label, category: "unknown" },
    { ...label, confidence: 0.3 },
  ])
    assert.deepEqual(matchCatalog(box, evidence, undefined, catalog), []);
});
test("catalog matching evaluates 90 degree orientation", () => {
  const m = matchCatalog(box, label, undefined, {
    version: 1,
    items: [{ id: "turned", category: "sofa", dimensions: [0.8, 1, 2] }],
  })[0];
  m.transform.scale.forEach((v) => close(v, 1));
  close(m.transform.yaw, Math.PI / 2);
});
test("bottom-center model placement uses measured floor height", () =>
  assert.deepEqual(
    analyze(scan, catalog).objects[0].candidates[0].transform.position,
    [2, 0.5, -3],
  ));
test("scale limits exclude implausible asset fits", () =>
  assert.deepEqual(
    matchCatalog(box, label, undefined, {
      version: 1,
      items: [{ id: "toy", category: "sofa", dimensions: [0.1, 0.1, 0.1] }],
    }),
    [],
  ));
test("large anisotropic changes are flagged", () => {
  const result = matchCatalog(box, label, undefined, {
    version: 1,
    items: [{ id: "stretch", category: "sofa", dimensions: [1, 1, 0.8] }],
  });
  assert.ok(result[0].warnings.some((w) => w.includes("distort")));
});
test("appearance vectors rank candidates only in the same named model space", () => {
  const c = {
    version: 1,
    embeddingSpace: "fixture-v1",
    items: [
      {
        id: "a",
        category: "sofa",
        dimensions: box.dimensions,
        embedding: [1, 0],
      },
      {
        id: "b",
        category: "sofa",
        dimensions: box.dimensions,
        embedding: [0, 1],
      },
    ],
  };
  assert.equal(
    matchCatalog(box, label, [0, 1], c, "fixture-v1")[0].catalogId,
    "b",
  );
  assert.equal(
    matchCatalog(box, label, [0, 1], c, "different")[0].appearanceScore,
    null,
  );
});
test("incompatible same-space embeddings fail loudly", () =>
  assert.throws(
    () =>
      matchCatalog(
        box,
        label,
        [1, 0],
        {
          version: 1,
          embeddingSpace: "x",
          items: [
            {
              id: "x",
              category: "sofa",
              dimensions: box.dimensions,
              embedding: [1],
            },
          ],
        },
        "x",
      ),
    /equal dimensions/,
  ));
test("missing units, ambiguous observations, duplicate IDs and negative dimensions fail", () => {
  assert.throws(() => analyze({ ...scan, unit: undefined }, catalog));
  assert.throws(() =>
    analyze(
      {
        ...scan,
        objects: [
          { ...scan.objects[0], points: corners([1, 1, 1], [0, 0, 0], 0) },
        ],
      },
      catalog,
    ),
  );
  assert.throws(
    () =>
      analyze(
        { ...scan, objects: [scan.objects[0], scan.objects[0]] },
        catalog,
      ),
    /unique/,
  );
  assert.throws(() =>
    analyze(scan, {
      version: 1,
      items: [{ id: "x", category: "bed", dimensions: [-1, 1, 1] }],
    }),
  );
});
test("acceptance must reference an offered candidate and never mutates scan", () => {
  const before = JSON.stringify(scan),
    object = analyze(scan, catalog).objects[0];
  assert.equal(object.reviewRequired, true);
  assert.equal(acceptCandidate(object, "fit").acceptedBy, "user");
  assert.throws(() => acceptCandidate(object, "chair"), /not offered/);
  assert.equal(JSON.stringify(scan), before);
});
test("studio adapter maps canonical world Z to negative floor Y and keeps yaw", () => {
  const obj = analyze(scan, catalog).objects[0],
    s = toStudioSuggestion(obj);
  assert.equal(s.y, 3);
  assert.equal(s.depth, 0.8);
  assert.equal(s.yaw, 0);
});
test("cluster candidates separate disconnected groups, leave labels to a model", () => {
  const points = [
    [0, 1, 0],
    [0.01, 1, 0],
    [2, 1, 0],
    [2.01, 1, 0],
    [3, 0, 0],
  ];
  const r = clusterPoints(points, { radius: 0.1, minPoints: 2, floorY: 0 });
  assert.deepEqual(
    r.clusters.map((c) => c.length),
    [2, 2],
  );
  assert.equal(r.discarded, 1);
});
test("clustering rejects excessive work and invalid radii", () => {
  assert.throws(() => clusterPoints([[0, 0, 0]], { radius: 0 }));
  assert.throws(
    () =>
      clusterPoints(
        Array.from({ length: 20 }, () => [0, 0, 0]),
        { radius: 1, maxComparisons: 10 },
      ),
    /budget/,
  );
});
test("RoomPlan bridge preserves native labels and measurements", () => {
  const r = fromRoomPlanBridge({
    objects: [{ id: "native", category: "sofa", ...box, confidence: 0.9 }],
  });
  assert.equal(r.objects[0].label.source, "scanner");
  assert.deepEqual(r.objects[0].box, box);
});
test("extreme geometry is rejected and large finite embeddings do not overflow", () => {
  assert.throws(() => normalizePoint([1e308, 0, 0], "m", "y"));
  const c = {
    version: 1,
    embeddingSpace: "large",
    items: [
      {
        id: "large",
        category: "sofa",
        dimensions: box.dimensions,
        embedding: [1e200, 0],
      },
    ],
  };
  close(matchCatalog(box, label, [1e200, 0], c, "large")[0].appearanceScore, 1);
});
