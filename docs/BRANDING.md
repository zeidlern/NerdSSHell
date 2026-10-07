# NerdSSHell brand and production assets

The product name is **NerdSSHell**. Preserve its capitalization, especially `SSH`.

The tagline is **Built for Windows nerds with Linux problems**. The application renders the name prominently and the tagline as subordinate text. The tagline is not a button or navigation item.

## Established identity

The original concept set entered the repository in commit `69f86f1fc5444263fe805791054461a238cfbec3`. Its recognizable idea is a nerd face whose glasses bridge Windows and Linux: a cyan four-pane mark in the left lens, a Tux/penguin figure in the right lens, and a terminal-shaped lower face with a cyan `>_` prompt. The production set retains this concept.

Original PNGs live in `assets/branding/nerdsshell/light/` and `dark/`. Their original Git blob hashes and sizes are recorded in `assets/branding/nerdsshell/source-manifest.json`. They are presentation/concept images with opaque backgrounds and substantial margins. Use the transparent production assets for application surfaces.

## Canonical files

All paths in this table are relative to the repository root.

| Surface | Canonical asset | Use |
| --- | --- | --- |
| Light app header | `ui/branding/app-light-64.png` | Dark hair/frame on a light interface; suitable for a 32px slot at 2× scale |
| Dark app header | `ui/branding/app-dark-64.png` | White hair/keyline against charcoal interface colors |
| About or larger interface placement | `ui/branding/app-light-128.png` / `app-dark-128.png` | Use the theme matching the surrounding UI |
| Higher-resolution app/avatar export | `ui/branding/app-{light,dark}-{256,512}.png` | Transparent standalone mascot |
| Windows window/executable/taskbar/Start Menu/installer | `ui/branding/nerdsshell.ico` | One stable Windows identity with nine embedded PNG frames |
| README or website without tagline | `assets/branding/nerdsshell/production/wordmark-{light,dark}.svg` | Exact SVG product text with an embedded approved mascot |
| README or website with tagline | `assets/branding/nerdsshell/production/wordmark-{light,dark}-tagline.svg` | Preferred documentation lockup |
| Full-size production design masters | `assets/branding/nerdsshell/production/app-{light,dark,micro}-master.png` | 1254px square RGBA images; starting point for every export |

The UI icon set includes **16, 20, 24, 32, 40, 48, 64, 128, 256 and 512px** for each theme. Choose the closest image at or above the physical pixel size; do not repeatedly enlarge small icons.

The ICO includes **16, 20, 24, 32, 40, 48, 64, 128 and 256px**. ICO directory entries encode 256 as a zero byte; they cannot encode a distinct 512px frame. The separate 512px PNG supplies the high-resolution desktop/avatar export.

## Themes and small sizes

Light/dark refers to the background the artwork is designed to sit on, rather than the color of the icon itself. The dark asset has bright hair and borders, while the light asset has dark hair and frames. Select using the application's actual UI background brightness so custom color preferences also receive the appropriate icon. Retain the saved palette; changing an icon must not reset user colors.

Use **transparent RGBA** images directly. Do not paint a rectangle behind them, apply a blanket CSS invert filter, or remove the opaque white lens interiors. Those interiors are part of the mascot. Wordmark SVGs embed their icon, use no remote resources, and preserve exact product/tagline text.

The 16, 20 and 24px exports use a dedicated micro master with larger glasses, heavier outlines and fewer frame details. The same small treatment is used in both themes; the pale keyline and navy edge support both light and dark surfaces. At 16px the lens glyphs are recognizable shapes rather than detailed illustrations. Prefer the full 32px-and-up variants where space permits.

The Windows icon remains constant across app theme changes. Its bright/keylined treatment is readable in typical taskbars and desktop contexts. In-app PNGs switch theme with the interface. This avoids claiming that Windows changes executable resources when the application's palette changes.

## Reproduce the exports

Normal app and installer builds consume the committed assets. They do not call an image service or require Python.

For an intentional artwork update, retain the original concepts and save a new approved full-size master before changing any generated output. The built-in imagegen prompts used for this set are recorded in `assets/branding/nerdsshell/production/GENERATION.md`. Image-model regeneration is not deterministic; the committed master bytes are the approved source of truth.

Re-export from the repository root:

```powershell
python -m pip install -r scripts/Generate-Branding.requirements.txt
python scripts/Generate-Branding.py
node scripts/Verify-Branding.cjs
```

The exporter uses Pillow 12.3.0 and resizes directly from the large masters with Lanczos sampling. It preserves alpha, writes PNG files, packages the selected PNG frames into ICO, and composes exact SVG wordmark text. It does not repaint artwork, crop the source, change colors, or chain resizes. `production/manifest.json` records SHA-256 values for the masters and all 25 generated outputs.

Generated SVGs and their manifest use canonical UTF-8/LF bytes. The exporter writes LF explicitly on every platform, and the narrow `.gitattributes` rules preserve these files during Windows checkout even with `core.autocrlf=true`. Do not normalize line endings inside the hash verifier: a changed asset must still fail verification.

Inspect the intended physical sizes against both charcoal and light backgrounds after changing a master. Check the Windows and penguin lenses, `>_` prompt, outer edges, small-size silhouette and tagline spelling. Regenerate all exports together so the manifest, desktop icon and interface images stay synchronized.

## Windows packaging and verification

Use `ui/branding/nerdsshell.ico` for Electron's native window icon, `build.win.icon`, and the NSIS installer/uninstaller icons. The native BrowserWindow icon is separate from the icon embedded into the built executable; configure both.

The pinned electron-builder 26.15.3 separates executable resource editing from Authenticode signing. `win.signExecutable: false` permits icon/name/version resource editing during an unsigned test build. `win.signAndEditExecutable: false` skips both resource editing and signing, leaving Electron's default icon and version metadata; it must not be retained for the branded package. The existing signed-build helper explicitly re-enables signing under its established certificate and verification gates.

Do not add a resource mutation after signing. Keep the existing Electron fuse and embedded ASAR-integrity checks. `scripts/Verify-Branding.cjs` additionally compares the actual executable's primary icon resources byte-for-byte with the canonical ICO frames and checks its product name, file description and file/product versions against `package.json`.

The verifier can inspect an unpacked build directly:

```powershell
node scripts/Verify-Branding.cjs dist/win-unpacked/NerdSSHell.exe
```

These checks verify branding resources; they do not substitute for the existing package, native Windows or Authenticode acceptance checks. `test/branding.test.cjs` covers missing/changed icon frames and stale product/version metadata using synthetic Windows resource entries.

## Identity compatibility

`src/branding.cjs` centralizes the visible name, tagline, icon, `nerdsshell` package, `app.nerdsshell.desktop` app ID and pinned installer GUID. NerdSSHell naming is used for renderer, IPC/protocol and native bridge. [Identity compatibility](IDENTITY-COMPATIBILITY.md) defines retained legacy data-directory, installer-process detection and remote-session aliases.

Changing these internal identities can affect saved profiles, preferences, archives, installer upgrades and taskbar/notification association. Any future change needs an explicit compatibility design, rather than a global search-and-replace.

## README light/dark selection

The following lockup works for GitHub theme selection:

```html
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/branding/nerdsshell/production/wordmark-dark-tagline.svg">
  <img alt="NerdSSHell — Built for Windows nerds with Linux problems" src="assets/branding/nerdsshell/production/wordmark-light-tagline.svg" width="760">
</picture>
```
