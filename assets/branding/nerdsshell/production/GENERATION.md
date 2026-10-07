# Production image generation

The three transparent raster masters were produced with the built-in imagegen tool on October 3, 2026, from the approved NerdSSHell concepts in commit `69f86f1fc5444263fe805791054461a238cfbec3`. Original concept PNGs remain unchanged. These recorded prompts document the edits; regenerating with an image model is not expected to reproduce identical pixels.

The exact approved master bytes are committed under `production/`. `scripts/Generate-Branding.py` performs deterministic exports from those bytes. It scales directly from each master, keeps the generated alpha, packages PNG frames into the Windows ICO, and creates SVG wordmark typography. It does not repaint or remove backgrounds. Output and master SHA-256 hashes are in `manifest.json`.

## Dark

```text
Use case: background-extraction / precise-object-edit. Asset type: NerdSSHell desktop and small in-app icon master, dark-interface variant. Edit target: attached dark emoji/avatar concept. Make a production-ready transparent-background cutout of THIS SAME nerd-face terminal mascot. Preserve the distinctive white swooping hair silhouette, broad white-edged dark navy nerd glasses, cyan four-pane Windows mark in the LEFT lens, simplified dark Tux/penguin in the RIGHT lens, dark terminal-shaped lower face, and cyan >_ prompt. Preserve the character's personality and relative arrangement closely. Remove the charcoal full-canvas background completely, leaving real alpha transparency outside the mascot. Keep solid off-white lens interiors and the dark navy filled terminal lower face; those interior shapes should remain opaque. Make line weights clean and bold for 32–64 pixel usage, smooth flat fills and crisp vector-like edges; remove photographic grain and gradients. Center a single mascot on a square 1024px canvas, filling about 90% of its width/height with a modest transparent safe margin so no hair or glasses touch the edge. No wordmark, text beyond >_, labels, border tile, shadows, glows, mockup background, extra variants or contact sheet.
```

## Light

```text
Use case: precise-object-edit. Asset type: NerdSSHell light-interface app icon master. Image 1 is the edit target: the new transparent dark mascot production icon. Image 2 is the original light avatar concept and supplies the LIGHT COLOR TREATMENT ONLY. Create one matched light-interface production mascot: preserve Image 1's exact centered silhouette, framing, glasses geometry, terminal-face shape, >_ prompt, cyan Windows four-pane mark in left lens, and Tux/penguin in right lens. Change the HAIR to dark navy (#142636) and remove the bright outer outline around the glasses/terminal so the silhouette reads naturally on white/light backgrounds, following Image 2. Keep opaque white lens interiors, dark navy glasses/terminal body, cyan Windows and >_ accents. Same square canvas size and subject scale as Image 1, clean flat bold edges for app icon use. True alpha transparency outside the character, no white background rectangle, no tile, no shadows/glow/grain, no wordmark or extra text, one icon only.
```

## Micro

```text
Use case: precise-object-edit. Asset type: purpose-built MICRO icon for NerdSSHell, intended 16–24px Windows title bars and tray-sized UI. Edit target: the attached transparent NerdSSHell mascot. Preserve recognizable nerd FACE plus GLASSES, with the cyan Windows four-pane shape in the LEFT lens and a simple Tux/penguin silhouette in the RIGHT lens. Redraw ONLY as a bolder simpler small-scale icon: glasses and large light lens interiors dominate at least half the character height, very short single hair tuft at top instead of tall detailed hair, shallow dark terminal chin with one broad cyan > and underscore. Keep image front-facing and same brand personality, navy filled frame/body, ivory hair and lens interiors, cyan accents. White outer keyline with a fine navy outermost edge so it is recognizable on light or charcoal surfaces. Reduce facial/lens detail to a few bold shapes that survive 16px; no pupils/feather details or frame rivets. Square single icon centered, fill 92% of canvas with only a modest transparent safe margin, genuine alpha transparency outside it. No wordmark, letters, tile, border rectangle, glow, shadow, gradient, contact sheet, or multiple variants. Make every outline strong and crisp.
```
