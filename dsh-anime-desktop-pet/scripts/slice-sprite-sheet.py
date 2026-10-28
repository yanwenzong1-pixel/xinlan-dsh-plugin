#!/usr/bin/env python
"""Compatibility entry point for the documented `scripts/slice-sprite-sheet.*` name."""
from pathlib import Path
import runpy

runpy.run_path(str(Path(__file__).with_name("slice-live-scene.py")), run_name="__main__")
