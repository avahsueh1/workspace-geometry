import { readFile } from 'node:fs/promises';
import { suggestFromPhoto } from '../dist/photo.js';

const [reportPath, catalogPath, associationsPath] = process.argv.slice(2);
if (!reportPath || !catalogPath) {
  console.error('Usage: node scripts/match-photo.mjs photo-report.json catalog.json [confirmed-associations.json]');
  process.exit(1);
}
const report = JSON.parse(await readFile(reportPath, 'utf8'));
const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
const associations = associationsPath ? JSON.parse(await readFile(associationsPath, 'utf8')) : {};
if (report.version !== 1 || !Array.isArray(report.detections) || report.detections.length > 1000)
  throw new Error('Invalid photo report');
// Association files are scoped to exactly this photo, never matched by object index alone.
if (associationsPath && associations.imageSha256 !== report.image?.sha256)
  throw new Error('Association image hash does not match this photo');
const results = report.detections.map(detection =>
  suggestFromPhoto(detection, catalog, associations.objects?.[detection.id]));
console.log(JSON.stringify({image: report.image, results}, null, 2));
