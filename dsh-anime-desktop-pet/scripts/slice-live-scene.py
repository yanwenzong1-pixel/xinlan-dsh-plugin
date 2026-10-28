#!/usr/bin/env python
"""Slice the live-room sprite sheet into independent @1x/@2x transparent assets.

- Manual crops capture the recognizable banner, badge, plaque, speech bubbles,
  fish pets, big girl and book/mug props.
- Remaining alpha connected components become fx-sprinkle-* assets.
- Outputs assets/slices/@1x, @2x, manifest.json and a QA contact sheet.
Idempotent: rerunning replaces the generated slice directories and manifest.
"""
from __future__ import annotations

import json
import shutil
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "assets" / "source" / "sprite-sheet.png"
OUT = ROOT / "assets" / "slices"
ONE_X = OUT / "@1x"
TWO_X = OUT / "@2x"
QA = ROOT / "assets" / "raw" / "preview-scene-slices.png"

# id, layer, tags, pivot, source crop (left, top, right, bottom)
MANUAL = [
    ("ui-banner-main", "L4", ["loop", "float", "sway"], (0.5, 0.55), (232, 25, 1345, 370)),
    ("ui-badge-live", "L4", ["loop", "float"], (0.5, 0.5), (28, 40, 252, 165)),
    ("ui-plaque-cheer", "L4", ["loop", "sway"], (0.5, 0.5), (20, 170, 170, 830)),
    ("ui-bubble-01", "L4", ["loop", "float"], (0.5, 0.5), (560, 350, 920, 460)),
    ("ui-bubble-02", "L4", ["loop", "float"], (0.5, 0.5), (560, 460, 920, 558)),
    ("ui-bubble-03", "L4", ["loop", "float"], (0.5, 0.5), (560, 558, 920, 655)),
    ("ui-bubble-04", "L4", ["loop", "float"], (0.5, 0.5), (560, 655, 920, 770)),
    ("pet-fish-idle-01", "L2", ["loop", "float", "blink"], (0.5, 0.9), (1330, 195, 1505, 355)),
    ("pet-fish-idle-02", "L2", ["loop", "float", "blink"], (0.5, 0.9), (1330, 355, 1505, 495)),
    ("pet-fish-idle-03", "L2", ["loop", "float", "blink"], (0.5, 0.9), (1330, 490, 1505, 650)),
    ("pet-fish-idle-04", "L2", ["loop", "float", "blink"], (0.5, 0.9), (1330, 650, 1505, 790)),
    ("pet-girl-main", "L2", ["loop", "float", "blink", "hover", "drag"], (0.5, 0.95), (60, 675, 530, 1024)),
    ("prop-books-mug", "L1", ["loop", "float"], (0.5, 0.95), (1230, 820, 1536, 1024)),
    ("ui-bottom-strip", "L1", ["loop"], (0.5, 1.0), (560, 800, 1536, 1024)),
    ("fx-bubble-large", "L3", ["loop", "fx", "bubble"], (0.5, 0.5), (1034, 632, 1125, 716)),
]


def trim_alpha(image: Image.Image, pad: int = 2) -> Image.Image:
    alpha = np.array(image.getchannel("A"))
    ys, xs = np.where(alpha > 0)
    if len(xs) == 0:
        return image
    box = (max(0, int(xs.min()) - pad), max(0, int(ys.min()) - pad),
           min(image.width, int(xs.max()) + pad + 1), min(image.height, int(ys.max()) + pad + 1))
    return image.crop(box)


def even_pad(image: Image.Image) -> Image.Image:
    width = image.width + (image.width % 2)
    height = image.height + (image.height % 2)
    if (width, height) == image.size:
        return image
    canvas = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    canvas.alpha_composite(image, (0, 0))
    return canvas


def overlaps_any(box: tuple[int, int, int, int], rects: list[tuple[int, int, int, int]]) -> bool:
    x0, y0, x1, y1 = box
    for rx0, ry0, rx1, ry1 in rects:
        if not (x1 < rx0 or x0 > rx1 or y1 < ry0 or y0 > ry1):
            return True
    return False


def main() -> None:
    if not SOURCE.is_file():
        raise SystemExit(f"missing source sprite sheet: {SOURCE}")
    source = Image.open(SOURCE).convert("RGBA")
    if ONE_X.exists():
        shutil.rmtree(ONE_X)
    if TWO_X.exists():
        shutil.rmtree(TWO_X)
    ONE_X.mkdir(parents=True, exist_ok=True)
    TWO_X.mkdir(parents=True, exist_ok=True)

    entries = []
    crop_rects = []
    for element_id, layer, tags, pivot, rect in MANUAL:
        crop = trim_alpha(source.crop(rect))
        crop = even_pad(crop)
        crop_rects.append(rect)
        two = crop
        one = crop.resize((crop.width // 2, crop.height // 2), Image.Resampling.LANCZOS)
        file2 = f"assets/slices/@2x/{element_id}@2x.png"
        file1 = f"assets/slices/@1x/{element_id}@1x.png"
        two.save(ROOT / file2)
        one.save(ROOT / file1)
        entries.append({
            "id": element_id, "layer": layer, "tags": tags, "pivot": {"x": pivot[0], "y": pivot[1]},
            "file": file2, "file1x": file1,
            "width": crop.width, "height": crop.height,
            "source": {"x": rect[0], "y": rect[1], "width": rect[2] - rect[0], "height": rect[3] - rect[1]},
        })

    # Remaining meaningful alpha components become independent fx sprites.
    alpha = np.array(source.getchannel("A"))
    foreground = alpha > 16
    labels, count = ndi.label(foreground, structure=np.ones((3, 3)))
    sizes = ndi.sum(foreground, labels, range(1, count + 1))
    fx_index = 0
    for index in range(1, count + 1):
        area = int(sizes[index - 1])
        if area < 90:
            continue
        ys, xs = np.where(labels == index)
        box = (int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max()))
        if overlaps_any(box, crop_rects):
            continue
        fx_index += 1
        pad = 2
        crop_box = (max(0, box[0] - pad), max(0, box[1] - pad),
                    min(source.width, box[2] + pad + 1), min(source.height, box[3] + pad + 1))
        crop = even_pad(trim_alpha(source.crop(crop_box)))
        element_id = f"fx-sprinkle-{fx_index:03d}"
        two = crop
        one = crop.resize((crop.width // 2, crop.height // 2), Image.Resampling.LANCZOS)
        file2 = f"assets/slices/@2x/{element_id}@2x.png"
        file1 = f"assets/slices/@1x/{element_id}@1x.png"
        two.save(ROOT / file2)
        one.save(ROOT / file1)
        entries.append({
            "id": element_id, "layer": "L3", "tags": ["loop", "fx"], "pivot": {"x": 0.5, "y": 0.5},
            "file": file2, "file1x": file1,
            "width": crop.width, "height": crop.height,
            "source": {"x": box[0], "y": box[1], "width": box[2] - box[0] + 1, "height": box[3] - box[1] + 1},
        })

    manifest = {
        "version": 1,
        "source": "assets/source/sprite-sheet.png",
        "stage": {"width": source.width, "height": source.height},
        "slices": entries,
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    # QA contact sheet with all slices on a checkerboard.
    thumbs = []
    for entry in entries:
        image = Image.open(ROOT / entry["file1x"]).convert("RGBA")
        image.thumbnail((110, 110))
        thumbs.append(image)
    columns = 8
    rows = (len(thumbs) + columns - 1) // columns
    cell = 122
    sheet = Image.new("RGBA", (columns * cell, rows * cell), (232, 232, 232, 255))
    draw = ImageDraw.Draw(sheet)
    for y in range(0, sheet.height, 12):
        for x in range(0, sheet.width, 12):
            if (x // 12 + y // 12) % 2:
                draw.rectangle([x, y, x + 11, y + 11], fill=(205, 205, 205, 255))
    for index, thumb in enumerate(thumbs):
        cx = (index % columns) * cell + (cell - thumb.width) // 2
        cy = (index // columns) * cell + (cell - thumb.height) // 2
        sheet.alpha_composite(thumb, (cx, cy))
    QA.parent.mkdir(parents=True, exist_ok=True)
    sheet.convert("RGB").save(QA)
    print(json.dumps({
        "elements": len(entries),
        "manual": len(MANUAL),
        "fx": fx_index,
        "manifest": str(OUT / "manifest.json"),
        "preview": str(QA),
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
