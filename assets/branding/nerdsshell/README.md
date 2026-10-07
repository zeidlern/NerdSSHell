# NerdSSHell branding

**Official product name:** NerdSSHell

**Tagline:** Built for Windows nerds with Linux problems

The approved Windows/Linux glasses concept is now integrated into the product. The original `light/` and `dark/` PNGs remain concept masters, unchanged from commit `69f86f1`. Use the production assets below for new product surfaces. See [the full branding guide](../../../docs/BRANDING.md) for integration and reproduction details.

## Canonical production assets

| Purpose | Path |
| --- | --- |
| App header and small interface icon | `ui/branding/app-light-64.png` or `ui/branding/app-dark-64.png` (repository-relative) |
| About/high-DPI interface | `ui/branding/app-{light,dark}-{128,256,512}.png` |
| Windows executable, taskbar, Start Menu and installer | `ui/branding/nerdsshell.ico` |
| README/website logo | `production/wordmark-light.svg` or `production/wordmark-dark.svg` |
| README/website logo plus exact tagline | `production/wordmark-light-tagline.svg` or `production/wordmark-dark-tagline.svg` |
| Approved transparent raster masters | `production/app-light-master.png`, `production/app-dark-master.png`, `production/app-micro-master.png` |
| Hashes and generation record | `production/manifest.json`, `production/GENERATION.md` |

All production raster icons use real alpha transparency. Light variants use dark hair/frames; dark variants use bright hair and keylines. The 16, 20 and 24px files use the same more prominent glasses treatment in both themes to retain contrast at tiny sizes. Larger images use their matching light/dark master. The Windows icon has nine frames from 16 through 256px; 512px is provided separately as PNG.

Regenerate production exports with `python scripts/Generate-Branding.py` from the repository root after installing the optional Pillow requirement in `scripts/Generate-Branding.requirements.txt`. Normal app builds use the committed outputs and do not require Python or image generation. Verify them with `node scripts/Verify-Branding.cjs`.

## Core visual idea

The mascot is a nerd face built around the terminal:

- glasses are the defining feature;
- the left lens carries the Windows mark;
- the right lens carries the Linux/Tux mark;
- the lower face is a terminal with a `>_` prompt;
- `SSH` is emphasized in blue/cyan in the wordmark.

For small icons, preserve the **face + glasses + Windows/Linux lenses** whenever they remain legible. Those elements are the clever, recognizable part of the identity.

## Light set

- `light/desktop-icon.png` — square desktop/taskbar/app-icon concept.
- `light/emoji-avatar.png` — compact mascot/avatar treatment for small UI placements.
- `light/mascot.png` — standalone mascot/terminal mark.
- `light/website-logo.png` — horizontal NerdSSHell wordmark.
- `light/website-logo-tagline.png` — horizontal brand lockup with tagline.

## Dark set

Designed for the application's charcoal/gray background.

- `dark/desktop-icon.png` — dark desktop/taskbar/app-icon concept.
- `dark/emoji-avatar.png` — compact dark-mode mascot.
- `dark/badge.png` — circular/badge treatment.
- `dark/website-logo.png` — dark-background horizontal wordmark.
- `dark/website-logo-tagline.png` — dark-background brand lockup with tagline.

## Source preservation and compatibility

`source-manifest.json` records the original concept PNG Git blob hashes and byte lengths. Original raster concepts remain available for design reference; the production package removes their opaque backdrop and large display margins through separately saved image edits. Generated exports are never used as the source for another resize.

The visible product name is NerdSSHell. Retained legacy data-directory, installer-process detection and remote-session aliases preserve upgrades; see [identity compatibility](../../../docs/IDENTITY-COMPATIBILITY.md). Changes to stored identities require an explicit compatibility design.

## Branding rights

The approved artwork references Windows and Linux/Tux. Third-party names and marks retain their owners' rights; use does not imply endorsement. The project license grants no general right to use NerdSSHell branding for third-party distributions. See [LICENSE](../../../LICENSE).
