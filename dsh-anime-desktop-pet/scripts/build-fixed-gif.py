#!/usr/bin/env python
"""Generate assets/blue-fat-fish-working.gif from the 25-panel fixed-character grid.

Pipeline (deterministic, no network):
  1. split assets/raw/grid.png into 4x4 cells in reading order -> assets/raw/frames/frame-01..16.png
  2. trim each cell to its visible content, fit onto a unified transparent square canvas
  3. binarize the alpha channel (GIF has 1-bit transparency) and erode 1px to drop the
     semi-transparent white fringe left by background removal
  4. quantize each frame to a local 255-colour palette, keep palette index 255 as the
     transparent entry, save an infinite-loop GIF with a fixed per-frame delay
  5. read the GIF back and assert frames/size/transparency/loop/playability

The raw grid and raw frames are never overwritten.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage as ndi

ROOT = Path(__file__).resolve().parent.parent
GRID = ROOT / "assets" / "raw" / "fixed-character-grid.png"
FRAMES_DIR = ROOT / "assets" / "raw" / "fixed-frames"
GIF = ROOT / "assets" / "animated" / "blue-fat-fish-eating.gif"
PREVIEW = ROOT / "assets" / "raw" / "preview-fixed-gif.png"

GRID_SIDE = 5                # 5x5 fixed-character grid
CANVAS = 256                 # unified GIF canvas (square)
MARGIN = 4                   # transparent margin inside the canvas
FRAME_MS = 300               # single source of truth for the animation tempo
TRIM_ALPHA = 32              # ignore near-invisible grid seams while trimming
OPAQUE_ALPHA = 128           # GIF is 1-bit alpha: >= half opaque
ERODE_PX = 1                 # strip the semi-transparent fringe ring
TRANSPARENT_INDEX = 255      # reserved palette slot (frames are quantized to 255 colours)


def load_grid() -> Image.Image:
    if not GRID.is_file():
        sys.exit(f"missing storyboard grid: {GRID}")
    grid = Image.open(GRID).convert("RGBA")
    if grid.width != grid.height:
        sys.exit(f"storyboard grid must be square, got {grid.size}")
    return grid


def detect_hair_boxes(grid: Image.Image) -> list[list[dict]]:
    """Find the 25 blue-hair components (one per panel) and group them 5x5.

    The supplied sheet is a collage whose rows/columns are NOT on a uniform
    image/5 grid: a plain equal split bleeds strips of neighbouring panels into
    every frame. The blue hair is a reliable per-character anchor, so we use it
    to derive real gutters and per-cell crop rectangles.
    """
    arr = np.array(grid).astype(np.int16)
    r, g, b, al = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2], arr[:, :, 3]
    hair = (al > 200) & (b > r + 25) & (b > g + 10) & (b > 120)
    hair = ndi.binary_closing(hair, structure=np.ones((5, 5)))
    hair = ndi.binary_opening(hair, structure=np.ones((3, 3)))
    labels, count = ndi.label(hair)
    sizes = ndi.sum(hair, labels, range(1, count + 1))
    boxes = []
    for index in range(1, count + 1):
        if sizes[index - 1] < 1500:
            continue
        ys, xs = np.where(labels == index)
        boxes.append({
            "x0": int(xs.min()), "x1": int(xs.max()),
            "y0": int(ys.min()), "y1": int(ys.max()),
            "cx": float(xs.mean()), "cy": float(ys.mean()),
        })
    if len(boxes) != GRID_SIDE * GRID_SIDE:
        sys.exit(f"expected {GRID_SIDE * GRID_SIDE} hair anchors, found {len(boxes)}")
    boxes.sort(key=lambda box: box["cy"])
    rows = [boxes[i * GRID_SIDE:(i + 1) * GRID_SIDE] for i in range(GRID_SIDE)]
    for row in rows:
        row.sort(key=lambda box: box["cx"])
    return rows


def content_mask(grid: Image.Image) -> np.ndarray:
    """Foreground mask used only to locate gutters (white/transparent bg excluded)."""
    arr = np.array(grid).astype(np.int16)
    r, g, b, al = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2], arr[:, :, 3]
    maximum = np.maximum(np.maximum(r, g), b)
    minimum = np.minimum(np.minimum(r, g), b)
    chroma = maximum - minimum
    mask = (al > 64) & ((chroma > 14) | (maximum < 225))
    mask = ndi.binary_opening(mask, structure=np.ones((2, 2)))
    mask = ndi.binary_closing(mask, structure=np.ones((5, 5)))
    return ndi.binary_fill_holes(mask)


def _argmin_near(profile: np.ndarray, low: int, high: int, fallback: int) -> int:
    low = max(0, low)
    high = min(len(profile) - 1, high)
    if high <= low:
        return int(fallback)
    window = profile[low:high + 1]
    floor = float(window.min())
    candidates = [low + offset for offset, value in enumerate(window) if value <= floor + 1e-6]
    return int(min(candidates, key=lambda position: abs(position - fallback)))


def _strip_border_components(cell: Image.Image) -> Image.Image:
    """Drop leftover neighbour fragments that touch the crop border.

    Gutters are chosen inside real gaps, so genuine own content never touches a
    border; detached strips from the adjacent panel do. Large components are kept
    to avoid deleting the character if a boundary is tight.
    """
    arr = np.array(cell)
    foreground = arr[:, :, 3] > 8
    labels, count = ndi.label(foreground)
    height, width = foreground.shape
    for index in range(1, count + 1):
        ys, xs = np.where(labels == index)
        touches = xs.min() <= 0 or ys.min() <= 0 or xs.max() >= width - 1 or ys.max() >= height - 1
        area = len(xs)
        if touches and area < 0.25 * height * width:
            arr[labels == index] = 0
    return Image.fromarray(arr, "RGBA")


def split_cells(grid: Image.Image) -> list[Image.Image]:
    """Crop the 25 real panels using per-row/column gutters, then strip bleed."""
    rows = detect_hair_boxes(grid)
    foreground = content_mask(grid)
    width, height = grid.size
    frame_cells: list[Image.Image] = []
    FRAMES_DIR.mkdir(parents=True, exist_ok=True)
    for row_index, row in enumerate(rows):
        for col_index, box in enumerate(row):
            if col_index == 0:
                left = 0
            else:
                previous = row[col_index - 1]
                fallback = (previous["x1"] + box["x0"]) // 2
                y0 = max(0, min(previous["y0"], box["y0"]) - 40)
                y1 = min(height, max(previous["y1"], box["y1"]) + 40)
                left = _argmin_near(foreground[y0:y1].mean(axis=0), fallback - 35, fallback + 35, fallback)
            if col_index == GRID_SIDE - 1:
                right = width
            else:
                following = row[col_index + 1]
                fallback = (box["x1"] + following["x0"]) // 2
                y0 = max(0, min(box["y0"], following["y0"]) - 40)
                y1 = min(height, max(box["y1"], following["y1"]) + 40)
                right = _argmin_near(foreground[y0:y1].mean(axis=0), fallback - 35, fallback + 35, fallback)
            if row_index == 0:
                top = 0
            else:
                previous = rows[row_index - 1][col_index]
                fallback = (previous["y1"] + box["y0"]) // 2
                x0 = max(0, min(previous["x0"], box["x0"]) - 40)
                x1 = min(width, max(previous["x1"], box["x1"]) + 40)
                top = _argmin_near(foreground[:, x0:x1].mean(axis=1), fallback - 30, fallback + 30, fallback)
            if row_index == GRID_SIDE - 1:
                bottom = height
            else:
                following = rows[row_index + 1][col_index]
                fallback = (box["y1"] + following["y0"]) // 2
                x0 = max(0, min(box["x0"], following["x0"]) - 40)
                x1 = min(width, max(box["x1"], following["x1"]) + 40)
                bottom = _argmin_near(foreground[:, x0:x1].mean(axis=1), fallback - 30, fallback + 30, fallback)
            cell = grid.crop((left, top, right, bottom))
            cell = _strip_border_components(cell)
            frame_cells.append(cell)
            cell.save(FRAMES_DIR / f"frame-{len(frame_cells):02d}.png")
    return frame_cells


def fit_canvas(cell: Image.Image, scale: float) -> Image.Image:
    """Fit the whole cell with one shared scale so the animation never jitters.

    Every cell is a same-composition storyboard panel; trimming each frame to its
    own content bbox would make the mascot breathe/scale between frames, so the
    crop keeps the panel geometry and only alpha-thresholds the background.
    """
    size = (max(1, round(cell.width * scale)), max(1, round(cell.height * scale)))
    content = cell.resize(size, Image.Resampling.LANCZOS)

    canvas = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    left = (CANVAS - size[0]) // 2
    top = (CANVAS - size[1]) // 2
    canvas.alpha_composite(content, (left, top))

    # GIF only keeps 1-bit alpha: threshold, then erode the fringe ring so the
    # white background halo never shows up as a solid outline on dark themes.
    mask = canvas.getchannel("A").point(lambda a: 255 if a >= OPAQUE_ALPHA else 0)
    if ERODE_PX:
        mask = mask.filter(ImageFilter.MinFilter(2 * ERODE_PX + 1))
    canvas.putalpha(mask)
    # Clear RGB under transparent pixels: keeps the quantizer away from seam colours.
    arr = np.array(canvas)
    arr[arr[:, :, 3] == 0, :3] = 0
    return Image.fromarray(arr, "RGBA")


def to_gif_frame(frame: Image.Image) -> Image.Image:
    """Quantize to 255 colours and reserve index 255 for transparency."""
    rgb = frame.convert("RGB")
    quantized = rgb.quantize(colors=TRANSPARENT_INDEX, method=Image.Quantize.MEDIANCUT,
                             dither=Image.Dither.FLOYDSTEINBERG)
    palette = quantized.getpalette()[: 3 * TRANSPARENT_INDEX]
    palette += [0, 0, 0]  # index 255 = transparent slot
    indices = np.array(quantized)
    transparent = np.array(frame.getchannel("A")) < OPAQUE_ALPHA
    indices[transparent] = TRANSPARENT_INDEX
    out = Image.fromarray(indices.astype(np.uint8), "P")
    out.putpalette(palette)
    out.info["transparency"] = TRANSPARENT_INDEX
    return out


def read_gif_structure(path: Path) -> dict:
    """Minimal GIF parser: frame count, per-frame GCE transparency/delay, NETSCAPE loop."""
    data = path.read_bytes()
    if data[:6] != b"GIF89a":
        sys.exit("not a GIF89a file")
    width = int.from_bytes(data[6:8], "little")
    height = int.from_bytes(data[8:10], "little")
    packed = data[10]
    i = 13 + (3 * 2 ** ((packed & 7) + 1) if packed & 0x80 else 0)
    frames = 0
    delays: list[int] = []
    transparent: list[int | None] = []
    loop = None
    pending_delay = pending_transparency = None
    while i < len(data):
        lead = data[i]
        if lead == 0x3B:
            break
        if lead == 0x21:
            label = data[i + 1]
            if label == 0xF9:
                flags = data[i + 3]
                pending_delay = int.from_bytes(data[i + 4:i + 6], "little") * 10
                pending_transparency = data[i + 6] if flags & 1 else None
            elif label == 0xFF:
                size = data[i + 2]
                if data[i + 3:i + 3 + size] == b"NETSCAPE2.0":
                    sub = i + 3 + size
                    loop = int.from_bytes(data[sub + 2:sub + 4], "little")
            i += 2
            while i < len(data):
                block = data[i]
                i += 1
                if block == 0:
                    break
                i += block
            continue
        if lead == 0x2C:
            frames += 1
            delays.append(pending_delay)
            transparent.append(pending_transparency)
            pending_delay = pending_transparency = None
            img_packed = data[i + 9]
            i += 10 + (3 * 2 ** ((img_packed & 7) + 1) if img_packed & 0x80 else 0)
            i += 1  # LZW minimum code size
            while i < len(data):
                block = data[i]
                i += 1
                if block == 0:
                    break
                i += block
            continue
        sys.exit(f"unknown GIF block 0x{lead:02x} at {i}")
    return {"width": width, "height": height, "frames": frames, "delays": delays,
            "transparent": transparent, "loop": loop}


def validate(path: Path) -> dict:
    structure = read_gif_structure(path)
    img = Image.open(path)
    img.seek(0)
    rgba = img.convert("RGBA")
    corner = rgba.getpixel((0, 0))
    opaque = sum(1 for pixel in rgba.getdata() if pixel[3] > 0)
    # Neighbour-bleed guard: every frame border must stay transparent; an equal
    # image/5 split used to leave strips of the adjacent panel on these borders.
    edge_opaque = 0
    for index in range(structure["frames"]):
        img.seek(index)
        frame = np.array(img.convert("RGBA"))
        edges = np.concatenate([frame[0, :, 3], frame[-1, :, 3], frame[:, 0, 3], frame[:, -1, 3]])
        edge_opaque += int((edges > 0).sum())
    report = {
        "path": str(path),
        "frames": structure["frames"],
        "size": [structure["width"], structure["height"]],
        "loop": structure["loop"],
        "frame_delay_ms": sorted(set(structure["delays"])),
        "transparent_frames": sum(1 for value in structure["transparent"] if value is not None),
        "corner_rgba": list(corner),
        "opaque_pixels": opaque,
        "edge_opaque_pixels": edge_opaque,
        "bytes": path.stat().st_size,
    }
    problems = []
    if edge_opaque:
        problems.append(f"{edge_opaque} opaque pixels on frame borders (neighbour bleed)")
    if structure["frames"] != GRID_SIDE * GRID_SIDE:
        problems.append(f"expected {GRID_SIDE * GRID_SIDE} frames, got {structure['frames']}")
    if (structure["width"], structure["height"]) != (CANVAS, CANVAS):
        problems.append(f"expected {CANVAS}x{CANVAS}, got {structure['width']}x{structure['height']}")
    if structure["loop"] != 0:
        problems.append(f"loop must be 0 (forever), got {structure['loop']}")
    if report["transparent_frames"] != structure["frames"]:
        problems.append(f"only {report['transparent_frames']}/{structure['frames']} frames declare transparency")
    if set(structure["delays"]) != {FRAME_MS}:
        problems.append(f"frame delays must all be {FRAME_MS}ms, got {sorted(set(structure['delays']))}")
    if corner[3] != 0:
        problems.append(f"canvas corner must be transparent, got {corner}")
    if opaque == 0:
        problems.append("no opaque pixels decoded")
    if problems:
        sys.exit("GIF validation failed:\n  - " + "\n  - ".join(problems))
    return report


def main() -> None:
    grid = load_grid()
    cells = split_cells(grid)
    inner = CANVAS - 2 * MARGIN
    # One shared scale for every panel: identical geometry => no frame-to-frame jitter.
    scale = inner / max(max(cell.width, cell.height) for cell in cells)
    frames = [to_gif_frame(fit_canvas(cell, scale)) for cell in cells]
    GIF.parent.mkdir(parents=True, exist_ok=True)
    frames[0].save(
        GIF, save_all=True, append_images=frames[1:], duration=FRAME_MS, loop=0,
        disposal=2, transparency=TRANSPARENT_INDEX, optimize=False,
    )
    report = validate(GIF)
    print(json.dumps(report, ensure_ascii=False, indent=2))

    # Contact sheet for manual QA (transparent pixels shown on a checkerboard).
    sheet = Image.new("RGBA", (CANVAS * GRID_SIDE, CANVAS * GRID_SIDE), (0, 0, 0, 0))
    gif = Image.open(GIF)
    for index in range(gif.n_frames):
        gif.seek(index)
        sheet.alpha_composite(gif.convert("RGBA"), ((index % GRID_SIDE) * CANVAS, (index // GRID_SIDE) * CANVAS))
    checker = Image.new("RGBA", sheet.size, (60, 60, 60, 255))
    for y in range(0, sheet.height, 16):
        for x in range(0, sheet.width, 16):
            if (x // 16 + y // 16) % 2:
                checker.alpha_composite(Image.new("RGBA", (16, 16), (90, 90, 90, 255)), (x, y))
    checker.alpha_composite(sheet)
    checker.convert("RGB").save(PREVIEW)


if __name__ == "__main__":
    main()

