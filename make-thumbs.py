#!/usr/bin/env python3
"""Generate small thumbnails for the template strip.

The strip used to load the full-size template images (7.4 MB total) as
thumbnails. Thumbs are 240px wide JPEGs (~10-20 KB each) written to
assets/thumbs/<stem>.jpg. Requires Pillow. Run once whenever templates
change; the generated thumbs are committed to the repo so build.mjs
stays dependency-free.
"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).parent
SRC = ROOT / "assets" / "templates"
DST = ROOT / "assets" / "thumbs"
DST.mkdir(parents=True, exist_ok=True)

count = 0
for f in sorted(SRC.iterdir()):
    if f.suffix.lower() not in (".jpg", ".jpeg", ".png", ".webp"):
        continue
    img = Image.open(f).convert("RGB")
    img.thumbnail((240, 240))
    out = DST / (f.stem + ".jpg")
    img.save(out, "JPEG", quality=72, optimize=True)
    count += 1
print(f"wrote {count} thumbs to {DST}")
