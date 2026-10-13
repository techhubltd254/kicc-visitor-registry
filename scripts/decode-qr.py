#!/usr/bin/env python3
"""
Independent QR round-trip check.

Reads the module matrix emitted by scripts/build.mjs (.build/qr-check.ppm),
rasterises it, and decodes it with OpenCV — a completely different code path
from qrcode-generator — then compares the decoded string with the site URL in
config/event.config.json.

    python3 scripts/decode-qr.py

Exits non-zero if the QR does not decode back to the configured URL.
"""
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
PPM = ROOT / ".build" / "qr-check.ppm"
CONFIG = ROOT / "config" / "event.config.json"

if not PPM.exists():
    sys.exit(f"missing {PPM} — run `npm run build` first")

expected = json.loads(CONFIG.read_text(encoding="utf-8"))["site"]["url"]

try:
    import cv2
except ImportError:
    sys.exit('missing dependency — run: pip install opencv-python-headless')

img = cv2.imread(str(PPM))
if img is None:
    sys.exit(f"could not read {PPM}")

decoded, _points, _straight = cv2.QRCodeDetector().detectAndDecode(img)
decoded = decoded or None

print(f"  expected : {expected}")
print(f"  decoded  : {decoded}")

if decoded == expected:
    print("  PASS — the generated QR decodes back to the configured site URL\n")
    sys.exit(0)

print("  FAIL — the generated QR does not decode to the configured site URL\n")
sys.exit(1)
