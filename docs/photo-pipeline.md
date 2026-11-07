# Local JPG analysis prototype

This is a pretrained object detector plus a geometry-safe catalog adapter, not a trained-from-scratch model or deployed website integration.

## Run

Use standard CPython 3.12 (not MSYS Python on Windows):

```powershell
python -m venv .venv-photo
.\.venv-photo\Scripts\python -m pip install -r requirements-photo.txt
.\.venv-photo\Scripts\python scripts/analyze_photos.py room.jpg --out photo-results
python -m unittest discover -s tests -p "test_*.py"
npm test
node scripts/match-photo.mjs photo-results/PHOTO-HASH.json examples/catalog.json
```

The first run downloads official Torchvision pretrained weights (~13.4 MB). Images stay local; there is no inference API or paid service. Reports include the source hash, model identifier, EXIF-oriented dimensions and detector threshold. Keep photos/results out of Git.

The default `--model fast` uses SSDLite. Optional `--model accurate` selects Faster R-CNN ResNet50 FPN V2 (larger download and slower CPU inference). That option has not been validated locally: the weight download failed its checksum on November 7. Checksum enforcement was retained; no partial weights were loaded.

## Pipeline

1. Decode JPEG/PNG/WebP, apply EXIF orientation, convert RGB, cap inference image to 1600 pixels on the longest side.
2. Run SSDLite320 MobileNetV3 with COCO_V1 weights. This is a small CPU baseline. Its internal transform resizes the image for the network.
3. Keep scores >=0.5 and map rectangles back to original oriented pixels. Scores are not calibrated probabilities. No detections does not establish that a room is empty.
4. Map couch→sofa, chair→chair, bed→bed, dining table→table. Preserve other labels as unknown catalog categories. No LLM is used; COCO does not cover every furniture category/style.
5. `suggestFromPhoto`, exported from the package's `/photo` subpath, returns unranked category IDs for scores >=0.6. Without measured geometry it returns `needs-measurement` and no scale or placement.
6. A reviewer may explicitly associate a detection with a measured Y-up metre box from a scan or user measurement. The existing catalog algorithm can then rank dimensions and return reviewable transforms. Automatic photo-to-scan registration is not implemented.

The optional third CLI argument is a JSON file with `imageSha256` matching the report and an `objects` map keyed by detection ID. Each value has `{box: {center, dimensions, yaw}, source: "linked-scan" | "user-measured", associationConfirmed: true}`. Only create it after reviewing the association. Otherwise omit it and all detections retain unknown metric scale.

## Formula and scale ambiguity

Pinhole projection: `u = fx * X/Z + cx`, `v = fy * Y/Z + cy`. Multiplying X,Y,Z by the same factor leaves the photo unchanged. A single JPG does not determine absolute scale. Perspective and occlusion also mean a detector rectangle is not a 3D object's proportions.

With independently measured dimensions d and catalog dimensions m:

```
s[i] = d[i] / m[i]
l[i] = log(s[i])
cost = std(l) + 0.25 * abs(mean(l))
shapeScore = exp(-3 * cost)
```

Evaluate 0° and 90° yaw, reject axis scales outside [0.5,2], warn when max(s)/min(s)>1.35. Constants are initial heuristics. User acceptance remains required. This JPG path has no appearance embeddings, so same-category suggestions do not imply visual resemblance.

## Remaining work

Benchmark against manually annotated indoor photos; a few example images are only smoke tests. Add crop-based appearance encoding and catalog reference renders for similarity ranking. Add reviewed photo-to-scan associations and a website review UI. Multi-view reconstruction needs camera registration and duplicate/occlusion handling; this prototype does not reconstruct a room from JPGs.

Primary documentation: https://docs.pytorch.org/vision/stable/models/generated/torchvision.models.detection.ssdlite320_mobilenet_v3_large.html
