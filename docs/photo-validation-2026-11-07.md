# JPG smoke test — November 7, 2026

Ran the actual local SSDLite COCO_V1 model on the three previously downloaded room JPGs, threshold 0.5. This is not an accuracy benchmark; no exhaustive human labels exist.

| Input | Returned detections | Visual review |
| --- | --- | --- |
| living-room-1.jpg | chair (~0.97 model score) | Chair rectangle corresponds to yellow armchair. Other visible objects were missed. |
| living-room-2.jpg | chair (~0.68) | Left chair detected; central sofa and right chairs missed. |
| empty-room.jpg | none | Filename is misleading: image contains shelving, seating and appliances. Zero detections is a miss, not proof of an empty room. |

Annotated JPGs and JSON are local in ignored `photo-results/`. Raw photos/results were not published. Node CLI consumed the first report and the example catalog, returning `armchair` as an unranked category suggestion, `needs-measurement`, and null measured geometry. No automatic visual similarity, 3D conversion, placement, or photo-to-LiDAR association occurred.

24 TypeScript tests and 3 Python tests passed, including metric-scale withholding, confirmed geometry associations, category gating, box validation and clipping. Scores are uncalibrated model outputs.

Attempted larger Faster R-CNN ResNet50 FPN V2 comparison, but the official weight download ended incomplete and failed its expected hash. No results were produced for that model. The validated fast detector remains the default; larger-model evaluation is pending.

This prototype is local to workspace-geometry and has not been pushed or connected to the website.
