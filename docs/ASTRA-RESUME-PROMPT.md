# Prompt for the new Astra chat

Copy the text below into a new Astra chat attached to this repository. Use the uploaded paused checkpoint on `feat/windows-command-workbench`; the delivering chat supplies its exact commit/link.

---

Continue BetterSSH from the paused October 3, 2026 checkpoint on `feat/windows-command-workbench`. Read `AGENTS.md`, `README.md`, `SECURITY.md`, `docs/SECURITY-REVIEW.md`, `docs/PUBLIC-RELEASE.md`, and especially `docs/ASTRA-HANDOFF-2026-10-03.md` first. Inspect the pending resize implementation rather than assuming its inferred native model or passing unit tests are correct.

The PSReadLine protected-module/SaveNothing compatibility correction is saved. The remaining blocker is LOCAL PowerShell ConPTY/xterm cursor correspondence during narrow/wide resizing and the next edit before Enter. Windows PowerShell passes three strict cycles; default PowerShell 7 still fails a later editing cycle. A test-only process-local prediction-off run passed 140 checks, but that is not default acceptance. Removing partial-top handling in that probe failed. Production prediction settings remain unchanged.

Give a fresh, evidence-based diagnosis before making more speculative viewport adjustments. Keep the original prompt/Ctrl+C/no-sleep-completion/fresh-input/Unicode/remote-identity assertions and the added before-Enter placement gates. Preserve fragment-safe terminal parsing, history limits, saved cursor, alternate/origin/custom-region behavior, serialized output, final-only backend geometry, host verification, session identity and no replay/automatic job launch. The new xterm tests contain inferred expected native behavior that needs scrutiny.

Use only disposable owned LOCAL shells and loopback fixtures. Do not touch installed/user sessions or production hosts. On this Windows checkout put `.local/bin` first on PATH, and use the normal Windows account for native tests through tool escalation; do not elevate BetterSSH itself. Do not run multiple packaged harnesses concurrently.

Once the root cause is fixed, run:

```text
npm.cmd run check
npm.cmd test
npm.cmd run dist
npm.cmd run verify:package
node scripts/Verify-Notices.cjs
node scripts/Elevated-Console-Smoke.cjs --asar dist/win-unpacked/resources/app.asar
node scripts/Packaged-PerPane-Smoke.cjs
```

Use no smoke override variables for the final default UI pass. Verify packaged source correspondence and inspect screenshots; record actual results for the exact revision. Final paused unit evidence is 551/551, but default native editing acceptance is failing. The currently built installer is unsigned, uninstalled and not a verified upgrade.

Stay on the candidate branch. No main merge, shared-history rewrite, release, visibility/license/signing change, global module/profile/security change or production administrative command. Preserve private data and exclude logs/profiles/backups/terminal archives from commits. Keep the dependency audit's eight high build-chain findings and real UAC/clean Windows gaps explicit. Before eventual installation, verify the exact candidate and have the owner close the installed app normally after preserving nonpersistent work and notes.

---
