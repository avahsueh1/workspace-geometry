import { analyze, validateCatalog, type Box, type Catalog, type Category } from './index.js';

export type PhotoDetection = {
  id: string;
  category: Category;
  score: number;
  /** EXIF-oriented image pixels, [left, top, right, bottom]. */
  pixelBox: [number, number, number, number];
};

/** A reviewer must explicitly associate the detected object with measured geometry.
 * A 2D detector box cannot supply depth, world location, yaw or metric scale. */
export function suggestFromPhoto(
  detection: PhotoDetection,
  catalog: Catalog,
  measurement?: { box: Box; source: 'linked-scan' | 'user-measured'; associationConfirmed: true },
) {
  validateCatalog(catalog);
  if (!detection.id?.trim() || !['bed', 'sofa', 'chair', 'table', 'storage', 'unknown'].includes(detection.category)
    || !Number.isFinite(detection.score) || detection.score < 0 || detection.score > 1
    || detection.pixelBox.length !== 4 || !detection.pixelBox.every(v => Number.isFinite(v) && v >= 0)
    || detection.pixelBox[2] <= detection.pixelBox[0] || detection.pixelBox[3] <= detection.pixelBox[1]) {
    throw new Error('Invalid photo detection');
  }
  if (measurement && (measurement.associationConfirmed !== true
    || !['linked-scan', 'user-measured'].includes(measurement.source))) {
    throw new Error('Measured geometry requires an explicitly confirmed association');
  }
  const categoryIds = detection.category !== 'unknown' && detection.score >= 0.6
    ? catalog.items.filter(item => item.category === detection.category).map(item => item.id) : [];
  if (!measurement) return {
    id: detection.id, status: 'needs-measurement' as const,
    // Category suggestions are deliberately unranked: no appearance or size evidence exists.
    categoryIds, measured: null, reviewRequired: true as const,
  };
  const result = analyze({ version: 1, unit: 'm', upAxis: 'y', objects: [{
    id: detection.id, box: measurement.box,
    label: { category: detection.category, confidence: detection.score, source: 'vision' },
  }] }, catalog);
  return { id: detection.id, status: 'measured-candidates' as const, categoryIds,
    measured: result.objects[0]!, measurementSource: measurement.source, reviewRequired: true as const };
}
