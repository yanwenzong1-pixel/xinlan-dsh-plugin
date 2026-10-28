#!/usr/bin/env python
"""Generate assets/animated/blue-fat-fish-tired.gif from the 16-panel "tired" storyboard grid.

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

ROOT = Path(__file__).resolve().parent.parent
GRID = ROOT / "assets" / "raw" / "tired-grid.png"
FRAMES_DIR = ROOT / "assets" / "raw" / "tired-frames"
GIF = ROOT / "assets" / "animated" / "blue-fat-fish-tired.gif"
PREVIEW = ROOT / "assets" / "raw" / "preview-tired-gif.png"

GRID_SIDE = 4                # 4x4 storyboard grid
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
    return grid


def split_cells(grid: Image.Image) -> list[Image.Image]:
    """Split the collage using alpha-projection gutters (the rows are not equal)."""
    arr = np.array(grid)
    foreground = arr[:, :, 3] > OPAQUE_ALPHA

    def low_runs(profile) -> list[tuple[int, int]]:
        runs: list[tuple[int, int]] = []
        start = None
        for index, value in enumerate(profile):
            low = value < 0.005
            if low and start is None:
                start = index
            elif not low and start is not None:
                if index - start >= 2:
                    runs.append((start, index))
                start = None
        if start is not None and len(profile) - start >= 2:
            runs.append((start, len(profile)))
        return runs

    def boundaries(profile, fallback: list[int]) -> list[int]:
        inner = [(start, end) for start, end in low_runs(profile) if start > 0 and end < len(profile)]
        if len(inner) != GRID_SIDE - 1:
            return fallback
        return [0] + [round((start + end - 1) / 2) for start, end in inner] + [len(profile)]

    w, h = grid.size
    xs = boundaries(foreground.mean(axis=0), [round(w * i / GRID_SIDE) for i in range(GRID_SIDE + 1)])
    ys = boundaries(foreground.mean(axis=1), [round(h * i / GRID_SIDE) for i in range(GRID_SIDE + 1)])
    frames: list[Image.Image] = []
    FRAMES_DIR.mkdir(parents=True, exist_ok=True)
    for row in range(GRID_SIDE):
        for col in range(GRID_SIDE):
            cell = grid.crop((xs[col], ys[row], xs[col + 1], ys[row + 1]))
            frames.append(cell)
            cell.save(FRAMES_DIR / f"frame-{len(frames):02d}.png")
    return frames


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
    report = {
        "path": str(path),
        "frames": structure["frames"],
        "size": [structure["width"], structure["height"]],
        "loop": structure["loop"],
        "frame_delay_ms": sorted(set(structure["delays"])),
        "transparent_frames": sum(1 for value in structure["transparent"] if value is not None),
        "corner_rgba": list(corner),
        "opaque_pixels": opaque,
        "bytes": path.stat().st_size,
    }
    problems = []
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
