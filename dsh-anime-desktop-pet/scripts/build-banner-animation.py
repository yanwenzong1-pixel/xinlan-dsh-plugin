#!/usr/bin/env python
"""Cut banner elements out of the provided sprite sheet and compose an animated banner GIF.

The delivered banner is a transparent PNG; this script:
  1. extracts every meaningful sprite (balloons / ribbons / stars) into
     assets/banner/elements/<kind>/ with a manifest;
  2. overlays deterministic star drift, balloon sway and ribbon flutter on top
     of the static banner;
  3. writes assets/banner/blue-fat-fish-live-banner.gif plus QA previews.
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

ROOT = Path(__file__).resolve().parent.parent
BASE = ROOT / "assets" / "banner" / "blue-fat-fish-live-banner.png"
SHEET = ROOT / "assets" / "raw" / "banner-elements.png"
ELEMENTS = ROOT / "assets" / "banner" / "elements"
OUTPUT = ROOT / "assets" / "banner" / "blue-fat-fish-live-banner.gif"
PREVIEW = ROOT / "assets" / "raw" / "preview-banner-animation.png"
ELEMENT_PREVIEW = ROOT / "assets" / "raw" / "preview-banner-elements.png"

SCALE = 0.5                    # work at half source resolution for a sane GIF size
FRAMES = 24
FRAME_MS = 80                  # 1.92s loop
ALPHA_THRESHOLD = 128
MIN_AREA = 24


def checker(size: tuple[int, int], cell: int = 16) -> Image.Image:
    canvas = Image.new("RGBA", size, (235, 235, 235, 255))
    draw = ImageDraw.Draw(canvas)
    for y in range(0, size[1], cell):
        for x in range(0, size[0], cell):
            if (x // cell + y // cell) % 2:
                draw.rectangle([x, y, x + cell - 1, y + cell - 1], fill=(205, 205, 205, 255))
    return canvas


def load_elements() -> tuple[list[dict], list[dict], list[dict], list[dict]]:
    sheet = Image.open(SHEET).convert("RGBA")
    alpha = np.array(sheet)[:, :, 3]
    foreground = alpha > 16
    labels, count = ndi.label(foreground, structure=np.ones((3, 3)))
    sizes = ndi.sum(foreground, labels, range(1, count + 1))
    all_parts: list[dict] = []
    for index in range(1, count + 1):
        area = int(sizes[index - 1])
        if area < MIN_AREA:
            continue
        ys, xs = np.where(labels == index)
        x0, x1, y0, y1 = int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max())
        cy = (y0 + y1) / 2
        kind = "balloon" if cy < 380 else "ribbon" if cy < 600 else "star"
        sprite = sheet.crop((max(0, x0 - 4), max(0, y0 - 4), min(sheet.width, x1 + 4), min(sheet.height, y1 + 4)))
        all_parts.append({
            "kind": kind,
            "area": area,
            "bbox": [x0, y0, x1, y1],
            "sprite": sprite,
        })
    # Biggest sprites first within each category; the animation picks representatives.
    for part in all_parts:
        part["kind_order"] = {"balloon": 0, "ribbon": 1, "star": 2}[part["kind"]]
    all_parts.sort(key=lambda part: (part["kind_order"], -part["area"], part["bbox"][1], part["bbox"][0]))

    for folder in ("balloon", "ribbon", "star"):
        (ELEMENTS / folder).mkdir(parents=True, exist_ok=True)
    manifest = []
    counters = {"balloon": 0, "ribbon": 0, "star": 0}
    for part in all_parts:
        counters[part["kind"]] += 1
        name = f"{part['kind']}-{counters[part['kind']]:03d}.png"
        relative = f"assets/banner/elements/{part['kind']}/{name}"
        part["sprite"].save(ROOT / relative)
        manifest.append({
            "file": relative,
            "kind": part["kind"],
            "area": part["area"],
            "bbox": part["bbox"],
        })
    (ELEMENTS / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    balloons = [part for part in all_parts if part["kind"] == "balloon" and part["area"] > 5000]
    ribbons = [part for part in all_parts if part["kind"] == "ribbon" and part["area"] > 1800]
    stars = [part for part in all_parts if part["kind"] == "star" and part["area"] > 700]
    return all_parts, balloons, ribbons, stars


def paste(canvas: Image.Image, sprite: Image.Image, center: tuple[float, float], scale: float,
          angle: float = 0.0, opacity: float = 1.0) -> None:
    if scale <= 0:
        return
    width = max(1, round(sprite.width * scale))
    height = max(1, round(sprite.height * scale))
    layer = sprite.resize((width, height), Image.Resampling.LANCZOS)
    if angle % 360:
        layer = layer.rotate(angle, resample=Image.Resampling.BICUBIC, expand=True)
    if opacity < 1:
        alpha = layer.getchannel("A").point(lambda value: round(value * opacity))
        layer.putalpha(alpha)
    left = round(center[0] - layer.width / 2)
    top = round(center[1] - layer.height / 2)
    canvas.alpha_composite(layer, (left, top))


def render_frame(base: Image.Image, balloons: list[dict], ribbons: list[dict], stars: list[dict],
                 frame: int) -> Image.Image:
    width, height = base.size
    t = frame / FRAMES * math.tau
    canvas = base.copy()

    # 1) Stars drift / twinkle across the top and bottom margins.
    star_specs = [
        (0.055, 0.06, 0.8, 0.0), (0.16, 0.025, -0.7, 1.2), (0.29, 0.015, 0.9, 2.4),
        (0.43, 0.02, -0.9, 3.1), (0.58, 0.015, 0.8, 4.2), (0.72, 0.025, -0.8, 5.0),
        (0.85, 0.05, 0.7, 0.8), (0.95, 0.10, -0.6, 2.0), (0.08, 0.94, 0.8, 3.6),
        (0.92, 0.92, -0.7, 4.7),
    ]
    for index, (nx, ny, phase, speed) in enumerate(star_specs):
        sprite = stars[index % len(stars)]["sprite"]
        sway = math.sin(t * 1.0 + phase) * 8
        lift = math.cos(t * 1.35 + phase) * 6
        twinkle = 0.55 + 0.45 * (0.5 + 0.5 * math.sin(t * 2.1 + phase))
        angle = math.sin(t + phase) * 14
        paste(canvas, sprite, (nx * width + sway, ny * height + lift), 0.24, angle, twinkle)

    # 2) Two small balloon clusters float above the banner with a gentle sway.
    balloon_specs = [
        (0.28, 0.10, 0.28, 0.0), (0.72, 0.11, 0.25, 1.4),
    ]
    for index, (nx, ny, scale, phase) in enumerate(balloon_specs):
        sprite = balloons[index % len(balloons)]["sprite"]
        sway = math.sin(t + phase) * 7
        lift = math.cos(t * 0.8 + phase) * 5
        angle = math.sin(t + phase) * 5
        paste(canvas, sprite, (nx * width + sway, ny * height + lift), scale, angle, 0.9)

    # 3) Two ribbons flutter across the very top/bottom edges.
    ribbon_specs = [
        (0.42, 0.06, 0.30, 0.2), (0.55, 0.94, 0.28, 3.9),
    ]
    for index, (nx, ny, scale, phase) in enumerate(ribbon_specs):
        sprite = ribbons[index % len(ribbons)]["sprite"]
        sway = math.sin(t * 1.2 + phase) * 12
        lift = math.cos(t * 1.1 + phase) * 4
        angle = math.sin(t + phase) * 8
        paste(canvas, sprite, (nx * width + sway, ny * height + lift), scale, angle, 0.8)

    return canvas


def to_gif_frame(image: Image.Image) -> Image.Image:
    rgb = image.convert("RGB").quantize(colors=255, method=Image.Quantize.MEDIANCUT,
                                        dither=Image.Dither.FLOYDSTEINBERG)
    alpha = np.array(image.getchannel("A"))
    indices = np.array(rgb)
    indices[alpha < ALPHA_THRESHOLD] = 255
    palette = rgb.getpalette()[: 255 * 3] + [0, 0, 0]
    out = Image.fromarray(indices.astype(np.uint8), "P")
    out.putpalette(palette)
    out.info["transparency"] = 255
    return out


def main() -> None:
    if not BASE.is_file() or not SHEET.is_file():
        sys.exit("missing banner base or element sprite sheet")
    all_parts, balloons, ribbons, stars = load_elements()
    base = Image.open(BASE).convert("RGBA")
    base = base.resize((round(base.width * SCALE), round(base.height * SCALE)), Image.Resampling.LANCZOS)

    frames = [to_gif_frame(render_frame(base, balloons, ribbons, stars, index)) for index in range(FRAMES)]
    frames[0].save(OUTPUT, save_all=True, append_images=frames[1:], duration=FRAME_MS, loop=0,
                   disposal=2, transparency=255, optimize=True)

    # QA sheet: 4 sample frames over a checkerboard, plus the cut-out element sheet.
    sheet = checker((base.width * 2, base.height * 4))
    for row, index in enumerate((0, 6, 12, 18)):
        sheet.alpha_composite(frames[index].convert("RGBA"), (0, row * base.height))
        sheet.alpha_composite(frames[index].convert("RGBA"), (base.width, row * base.height))
    sheet.convert("RGB").save(PREVIEW)

    thumbs = []
    for part in all_parts:
        thumb = part["sprite"].copy()
        thumb.thumbnail((90, 90))
        thumbs.append(thumb)
    columns = 10
    rows = (len(thumbs) + columns - 1) // columns
    element_sheet = checker((columns * 100, rows * 100))
    for index, thumb in enumerate(thumbs):
        element_sheet.alpha_composite(thumb, ((index % columns) * 100 + (100 - thumb.width) // 2,
                                              (index // columns) * 100 + (100 - thumb.height) // 2))
    element_sheet.convert("RGB").save(ELEMENT_PREVIEW)

    print(json.dumps({
        "frames": FRAMES,
        "size": list(frames[0].size),
        "delay_ms": FRAME_MS,
        "bytes": OUTPUT.stat().st_size,
        "elements": len(all_parts),
        "balloons": len(balloons),
        "ribbons": len(ribbons),
        "stars": len(stars),
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()

