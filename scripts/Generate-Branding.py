#!/usr/bin/env python3
"""Export NerdSSHell's approved raster masters without repainting the artwork.

Requires Pillow; ordinary app/installer builds use the committed outputs and do
not run this script. Every size comes directly from its large approved master.
"""

from __future__ import annotations

import base64
import hashlib
import io
import json
from pathlib import Path
import struct

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
PRODUCTION = ROOT / "assets/branding/nerdsshell/production"
UI = ROOT / "ui/branding"
SIZES = (16, 20, 24, 32, 40, 48, 64, 128, 256, 512)
ICO_SIZES = tuple(size for size in SIZES if size <= 256)
TAGLINE = "Built for Windows nerds with Linux problems"


def read_master(name: str) -> Image.Image:
    image = Image.open(PRODUCTION / name)
    image.load()
    if image.mode != "RGBA" or image.width != image.height or image.width < 512:
        raise ValueError(f"{name}: expected a square RGBA master of at least 512px")
    if image.getchannel("A").getextrema() != (0, 255):
        raise ValueError(f"{name}: transparent exterior and opaque artwork required")
    return image


def png_bytes(master: Image.Image, size: int) -> bytes:
    output = io.BytesIO()
    master.resize((size, size), Image.Resampling.LANCZOS).save(
        output, format="PNG", optimize=True, compress_level=9
    )
    return output.getvalue()


def write_ico(images: dict[int, bytes]) -> bytes:
    # Modern Windows accepts PNG-backed ICO frames. 0 in the width/height byte
    # denotes 256, never 512; the separate 512px PNG is the high-resolution asset.
    offset = 6 + 16 * len(images)
    directory = bytearray(struct.pack("<HHH", 0, 1, len(images)))
    payload = bytearray()
    for size, content in sorted(images.items()):
        directory.extend(struct.pack("<BBBBHHII", size % 256, size % 256, 0, 0,
                                     1, 32, len(content), offset))
        payload.extend(content)
        offset += len(content)
    return bytes(directory + payload)


def wordmark(theme: str, icon: bytes, tagline: bool) -> str:
    # Typography is kept as exact SVG text rather than asking a raster generator
    # to spell the product name. The only raster component is the approved icon.
    foreground = "#f4f7fb" if theme == "dark" else "#142636"
    secondary = "#b5c1cf" if theme == "dark" else "#526174"
    baseline = 127 if tagline else 144
    subline = (f'    <text x="235" y="173" font-size="29" fill="{secondary}" '
               f'textLength="775" lengthAdjust="spacingAndGlyphs">{TAGLINE}</text>\n'
               if tagline else "")
    encoded = base64.b64encode(icon).decode("ascii")
    description = f"NerdSSHell — {TAGLINE}" if tagline else "NerdSSHell"
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="1040" height="220" viewBox="0 0 1040 220" role="img" aria-labelledby="title">
  <title id="title">{description}</title>
  <image x="0" y="0" width="220" height="220" href="data:image/png;base64,{encoded}"/>
  <g font-family="Segoe UI, Arial, sans-serif">
    <text x="235" y="{baseline}" font-size="100" font-weight="700" fill="{foreground}" textLength="775" lengthAdjust="spacingAndGlyphs">Nerd<tspan fill="#00aaf0">SSH</tspan>ell</text>
{subline}  </g>
</svg>
'''


def main() -> None:
    UI.mkdir(parents=True, exist_ok=True)
    masters = {theme: read_master(f"app-{theme}-master.png")
               for theme in ("light", "dark", "micro")}
    frames: dict[str, dict[int, bytes]] = {}
    outputs: list[Path] = []
    for theme in ("light", "dark"):
        frames[theme] = {}
        for size in SIZES:
            master = masters["micro"] if size <= 24 else masters[theme]
            content = png_bytes(master, size)
            destination = UI / f"app-{theme}-{size}.png"
            destination.write_bytes(content)
            outputs.append(destination)
            frames[theme][size] = content
        for tagline in (False, True):
            suffix = "-tagline" if tagline else ""
            destination = PRODUCTION / f"wordmark-{theme}{suffix}.svg"
            destination.write_text(wordmark(theme, frames[theme][256], tagline), encoding="utf-8", newline="\n")
            outputs.append(destination)
    # The desktop icon has one durable identity. Theme-specific PNGs apply only
    # inside the app; Windows does not switch executable resources with UI theme.
    ico = UI / "nerdsshell.ico"
    ico.write_bytes(write_ico({size: frames["dark"][size] for size in ICO_SIZES}))
    outputs.append(ico)
    manifest = {
        "productName": "NerdSSHell",
        "tagline": TAGLINE,
        "sourceCommit": "69f86f1fc5444263fe805791054461a238cfbec3",
        "pngSizes": SIZES,
        "icoSizes": ICO_SIZES,
        "microSizes": [16, 20, 24],
        "masterSha256": {f"app-{theme}-master.png": hashlib.sha256(
            (PRODUCTION / f"app-{theme}-master.png").read_bytes()).hexdigest()
            for theme in masters},
        "outputs": {str(path.relative_to(ROOT)).replace("\\", "/"):
                    hashlib.sha256(path.read_bytes()).hexdigest() for path in sorted(outputs)},
    }
    (PRODUCTION / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(f"Generated {len(outputs)} NerdSSHell assets and their SHA-256 manifest.")


if __name__ == "__main__":
    main()
