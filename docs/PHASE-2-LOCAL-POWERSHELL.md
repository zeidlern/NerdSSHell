# Phase 2 checkpoint: local PowerShell

Scope: validate the recovered local-console implementation on PR #9. No Tauri migration, WSL/CMD, local persistence, new admin actions or source-history rewrite in this chunk. Baseline: `76108bc77a4645845d41936e3613bf7e5a77e8ce`.

## Important correction to the recovery inventory

The existing `scripts/Packaged-PerPane-Smoke.cjs` already calls `Packaged-Workbench-Smoke.cjs` internally. The absence of a separately named workflow step did NOT mean that the workbench smoke was absent. The successful baseline run `37067382964` therefore covered its nested basic local-console test. This phase adds deeper local PowerShell acceptance rather than removing/replacing previous assertions.

## Reviewed behavior

Fixed-path Windows PowerShell and PowerShell 7 discovery; reserved local identity; no profile loading, execution-policy bypass or elevation request; native ConPTY DLL packaging/integrity; per-launch working directory; ordered/rate-limited input; shared terminal copying and resizing; local/remote isolation; output draining and explicit nonpersistent closure. No production-code defect was reproduced in these bounded checks, so the existing application implementation is preserved.

Local processes inherit the application's user token and environment. Do not describe them as guaranteed unelevated when the app itself is elevated. No local process survives a Windows reboot; this release provides no detached local broker. Keys and remote server profiles are not needed to open local PowerShell.

## Tests saved in this checkpoint

`test/local-powershell.test.cjs` adds 16 regressions. These cover discovery, launch arguments, cancelled/native-folder-result handling, spaces/apostrophes/Unicode in folders, concurrent folder ownership, removed shells, invalid folders/targets, a full 64 KiB mixed-Unicode paste followed by Enter, Ctrl+C/resize routing, discard-on-close, natural output tail/listener cleanup, 16-console bounds, lack of local SFTP/profile persistence, and main-process local close/disconnect/quit confirmations.

Actual local result: `node --test test/workbench.test.cjs test/local-powershell.test.cjs` passed **41 tests**, zero failures/skips. `node scripts/check.cjs` passed. These tests inject PTYs and dialogs; they are not Windows GUI evidence. A concurrent-launch test checks the returned pane's folder ownership, not incidental spawn scheduling.

`Packaged-LocalPowerShell-Smoke.cjs` is called by the existing nested workbench smoke, and therefore by the packaged Windows CI step. It exercises each discovered local PowerShell version through the actual packaged application: version/home/Unicode, LOCAL and nonpersistent labels, no SFTP, split-layout dimensions, synthetic clipboard copying/paste, explicit Enter, Ctrl+C, output on natural exit and unaffected existing remote fixture consoles. It does not install PowerShell 7; absence is reported as untested. Clipboard use is limited to the isolated GitHub runner or an explicit `--clipboard-fixture` opt-in.

Native folder-picker interaction and clicking native closure/quit dialogs still need manual Windows acceptance. Backend ownership and cancellation are tested automatically with injected dialog responses. No user's server, files, clipboard or installed BetterSSH was used here.

## Status boundary and next chunk

The new native checks and full-suite results must be read from the CI run for this checkpoint; this document does not predeclare them passed. The local environment's full dependency install did not finish within its bounded attempt; full installation/build testing is delegated to CI. A green earlier revision is not proof of a new one.

Keep PR #9 draft and `main` unchanged. Record exact commit/run/results in the PR conversation. On the next turn, check this checkpoint's CI first and fix any failure within local-console scope before starting Phase 3 (command review/input protection). Do not keep a conversation alive by repeatedly polling.

## Primary references

- Microsoft ConPTY lifecycle/resizing and termination: https://learn.microsoft.com/en-us/windows/console/creating-a-pseudoconsole-session
- PowerShell executable options: https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_powershell_exe?view=powershell-5.1
