"""Local JPG object detection; pixel boxes are never converted into invented metres."""
import argparse
import hashlib
import json
import math
from pathlib import Path

CATEGORIES = {"couch": "sofa", "chair": "chair", "bed": "bed", "dining table": "table"}


def make_detection(label, score, box, width, height, index):
    if not all(math.isfinite(v) and v > 0 for v in (width, height)):
        raise ValueError("Invalid image dimensions")
    if not math.isfinite(score) or not 0 <= score <= 1:
        raise ValueError("Invalid detector score")
    if len(box) != 4 or not all(math.isfinite(v) for v in box):
        raise ValueError("Invalid pixel box")
    x1, y1, x2, y2 = box
    x1, x2 = max(0, min(width, x1)), max(0, min(width, x2))
    y1, y2 = max(0, min(height, y1)), max(0, min(height, y2))
    if x2 <= x1 or y2 <= y1:
        raise ValueError("Empty pixel box")
    return {"id": f"object-{index}", "rawLabel": label,
            "category": CATEGORIES.get(label, "unknown"), "score": score,
            "pixelBox": [x1, y1, x2, y2],
            "normalizedBox": [x1 / width, y1 / height, x2 / width, y2 / height],
            "dimensionsMetres": None, "placement": None, "reviewRequired": True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("photos", nargs="+", type=Path)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--threshold", type=float, default=0.5)
    parser.add_argument("--model", choices=["accurate", "fast"], default="fast")
    args = parser.parse_args()
    if not math.isfinite(args.threshold) or not 0 < args.threshold <= 1:
        parser.error("threshold must be in (0,1]")
    import torch
    import torchvision
    from PIL import Image, ImageDraw, ImageOps
    from torchvision.models.detection import (
        ssdlite320_mobilenet_v3_large, SSDLite320_MobileNet_V3_Large_Weights,
        fasterrcnn_resnet50_fpn_v2, FasterRCNN_ResNet50_FPN_V2_Weights)
    if args.model == "fast":
        weights = SSDLite320_MobileNet_V3_Large_Weights.COCO_V1
        model = ssdlite320_mobilenet_v3_large(weights=weights).eval()
        model_name = "torchvision/ssdlite320_mobilenet_v3_large/COCO_V1"
    else:
        weights = FasterRCNN_ResNet50_FPN_V2_Weights.COCO_V1
        model = fasterrcnn_resnet50_fpn_v2(weights=weights).eval()
        model_name = "torchvision/fasterrcnn_resnet50_fpn_v2/COCO_V1"
    torch.set_num_threads(min(4, torch.get_num_threads()))
    args.out.mkdir(parents=True, exist_ok=True)
    for path in args.photos:
        if path.stat().st_size > 30 * 1024 * 1024:
            raise ValueError("Photo exceeds 30 MB")
        with Image.open(path) as source:
            if source.format not in ("JPEG", "PNG", "WEBP") or source.width * source.height > 25_000_000:
                raise ValueError("Expected JPEG/PNG/WebP up to 25 megapixels")
            photo = ImageOps.exif_transpose(source).convert("RGB")
        # Bound inference memory; output coordinates are mapped back to oriented original pixels.
        inference = photo.copy()
        inference.thumbnail((1600, 1600))
        with torch.inference_mode():
            prediction = model([weights.transforms()(inference)])[0]
        detections = []
        for label, score, box in zip(prediction["labels"].tolist(), prediction["scores"].tolist(), prediction["boxes"].tolist()):
            if score < args.threshold:
                continue
            box = [v * (photo.width / inference.width if i % 2 == 0 else photo.height / inference.height) for i, v in enumerate(box)]
            detections.append(make_detection(weights.meta["categories"][label], score, box,
                                             photo.width, photo.height, len(detections) + 1))
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        stem = f"{path.stem}-{digest[:8]}-{args.model}"
        report = {"version": 1, "image": {"name": path.name, "sha256": digest,
                  "width": photo.width, "height": photo.height, "exifOriented": True},
                  "model": model_name, "torchvision": torchvision.__version__,
                  "threshold": args.threshold, "detections": detections,
                  "warnings": ["Model scores are not calibrated accuracy estimates.",
                               "No depth, real-world scale, object yaw, or 3D placement is inferred.",
                               "Detections can be missed or duplicated; review before catalog matching."]}
        (args.out / f"{stem}.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
        draw = ImageDraw.Draw(photo)
        for obj in detections:
            draw.rectangle(obj["pixelBox"], outline="#ed7926", width=3)
            x, y = obj["pixelBox"][:2]
            text = f'{obj["rawLabel"]} {obj["score"]:.2f}'
            bounds = draw.textbbox((x, y), text)
            draw.rectangle(bounds, fill="white")
            draw.text((x, y), text, fill="black")
        photo.save(args.out / f"{stem}-annotated.jpg", quality=90)
        print(json.dumps({"image": path.name, "objects": len(detections),
                          "labels": [o["rawLabel"] for o in detections], "report": str(args.out / f"{stem}.json")}))


if __name__ == "__main__":
    main()
