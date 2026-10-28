#!/usr/bin/env python
"""Prepare the transparent desktop banner from the live image.

The delivered asset arrived as an RGB PNG with the transparency checkerboard
baked in. Reconstruct transparency by flood-filling the low-chroma bright
background from the image border; the banner's white cloth stays opaque because
colored outlines enclose it.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "assets" / "raw" / "banner-source.png"
OUTPUT = ROOT / "assets" / "banner" / "blue-fat-fish-live-banner.png"
PREVIEW = ROOT / "assets" / "raw" / "preview-banner.png"


def main() -> None:
    if not SOURCE.is_file():
        sys.exit(f"missing banner source: {SOURCE}")
    source = Image.open(SOURCE)
    rgba = np.array(source.convert("RGBA")).astype(np.int16)
    # A true transparent upload already carries usable alpha: keep it instead of
    # keying colors (the delivered checkerboard RGB fallback needs the flood fill).
    if (rgba[:, :, 3] < 8).mean() > 0.05:
        pass
    else:
        arr = rgba[:, :, :3]
        high = arr.max(axis=2)
        low = arr.min(axis=2)
        chroma = high - low
        # Checkerboard squares and the soft outer shadow are near-gray and bright.
        background_like = (chroma <= 12) & (low >= 160)
        labels, count = ndi.label(background_like)
        border = np.concatenate([labels[0, :], labels[-1, :], labels[:, 0], labels[:, -1]])
        border_labels = [int(label) for label in np.unique(border) if label != 0]
        background = np.isin(labels, border_labels)
        rgba[:, :, 3] = np.where(background, 0, 255)
        rgba[background, :3] = 0
    rgba = rgba.astype(np.uint8)
    rgba[rgba[:, :, 3] == 0, :3] = 0
    output = Image.fromarray(rgba, "RGBA")
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    if OUTPUT.exists():
        OUTPUT.chmod(0o666)
    output.save(OUTPUT, optimize=True)

    transparent = float((np.array(output)[:, :, 3] == 0).mean())
    if transparent <= 0.2:
        sys.exit(f"background removal failed: transparent fraction {transparent:.2%}")

    # QA contact sheet on a checkerboard.
    sheet = Image.new("RGBA", (1086, 362), (235, 235, 235, 255))
    draw = ImageDraw.Draw(sheet)
    for y in range(0, sheet.height, 16):
        for x in range(0, sheet.width, 16):
            if (x // 16 + y // 16) % 2:
                draw.rectangle([x, y, x + 15, y + 15], fill=(200, 200, 200, 255))
    sheet.alpha_composite(output.resize((1086, 362), Image.Resampling.LANCZOS), (0, 0))
    sheet.convert("RGB").save(PREVIEW)
    print(f"wrote {OUTPUT} size={output.size} transparent={transparent:.1%} bytes={OUTPUT.stat().st_size}")
    print(f"preview {PREVIEW}")


if __name__ == "__main__":
    main()
