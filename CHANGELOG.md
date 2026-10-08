# Changelog

## Unreleased — Connection controls and recovery

- Add an advanced saved Standard SSH terminal baud rate and independent new-window override. Request both SSH PTY speed modes only when creating the terminal; preserve the server default, existing profiles and inherited task settings. Explain tmux/local restrictions and new-terminal/reconnect requirements.
- Present app-owned confirmations, including multiline paste and session/quit consequences, in one serialized themed dialog. Keep Continue/Paste and Cancel mouse/keyboard accessible, preserve response IDs and caller ownership checks, and keep the Windows parent enabled. Guard trailing double-clicks, reload/destruction and queue limits.
- Serialize first-use host-key approval through the existing in-app prompt with explicit Trust and connect, Cancel focused and stale-target cancellation. Keep changed/revoked-key blocking and Windows-protected password consent intact.
- Dismiss About on completed backdrop clicks while preserving inside clicks, selection, Close/Escape, focus return and background-control isolation.
- Cancel disconnected sign-in prompts and pending command collectors; release retired transport/view references and temporary listeners. Preserve Persistent work, ordered input and Standard SSH's explicit new-shell requirement.
- Add bounded runtime/operation diagnostics and 120 synthetic plus 100 real loopback lifecycle cycles. The original lengthy-session lag report and tester's exact mouse failure remain unreproduced; no speculative Electron change.
- Establish the current official development checkout and owner-requested recovery checkpoints. Existing v1.0.3 release, tag and assets remain unchanged; the owner will choose the next version after review.
- Measured validation and pending limitations are recorded in [development progress](DEVELOPMENT-PROGRESS.md).

## 1.0.3 — Remember SSH passwords

- Add an opt-in **Remember password on this Windows account** preference in saved connections and SSH password sign-in prompts.
- Encrypt remembered login passwords with Windows account protection in a separate bounded credential file. Keep plaintext passwords out of profiles, ordinary settings/backups, renderer state and diagnostics.
- Reuse remembered passwords after app restart while preserving host verification. Save only passwords accepted during a successful verified sign-in; never save private-key passphrases or interactive one-time responses.
- Add **Forget password** without disconnecting active sessions. Remove stored credentials when the server, port, username or authentication method changes, remembering is disabled, the profile is deleted, or remembered authentication is rejected.
- Guard canceled prompts, stale sign-in results, concurrent Forget/profile edits, unavailable encryption and failed storage writes. Add adversarial regressions and packaged Windows restart/readback acceptance.

## 1.0.2 — Documentation, Help and resource limits

- Open the Wiki manual, connection guide, troubleshooting, repository, issues and releases from **Help and about**, using validated fixed browser destinations.
- Bound discovery to 1,024 panes per server and terminal views to 64 across the application. Preserve existing view identities and remote work; additional sessions remain available in the sidebar.
- Keep a Standard connection's reserved first view available without a transient overflow warning.
- Refresh the README, manual, support and contributor guides, bug/feature forms and pull-request template. Welcome focused contributions through the maintainer's review process.
- Remove obsolete working notes from the documentation and retain current technical guides and release validation.
- Remove the vulnerable optional build logging dependency by selecting compatible `global-agent` 4.1.3. Require audits of both supported and complete dependency graphs; test proxy forwarding, cache, exclusions and checksum rejection.
- Require Node.js 22.12.0 or newer for source builds; synchronize package, application, installer and dependency inventory metadata.
- Bound abandoned SSH transport cleanup after graceful disconnect; cleanup remains tied to the original socket and leaves persistent work running.
- Bundle the project license and third-party notices in the application and verify their exact bytes during packaging.
- See [validation](docs/VALIDATION.md) for measured checks and distribution status.

## 1.0.1 — Compatible application identity

- Use package `nerdsshell`, Windows app ID `app.nerdsshell.desktop`, the `nerdsshell` UI/IPC protocol and the NerdSSHell native bridge.
- Preserve the installer GUID and existing settings directory for upgrades; use the current directory for new installations. Keep explicitly isolated profiles separate and reject unsafe paths.
- Retain persistent-session tokens and keys across compatible clients. Discovery and reconnect do not launch jobs.

## 1.0.0 — NerdSSHell desktop workspace

- Combine persistent tmux sessions, Standard SSH, local PowerShell and Command Prompt in tabs and resizable split panes.
- Include per-pane File SFTP, Actions and Favorites, a separate command workbench, and configurable terminal/application colors.
- Add background waiting alerts and a Scratchpad with local spelling, syntax highlighting, word wrap and explicit text-file saving.
- Use Electron 44.5.1 and hardened packaged resources. Installers are unsigned unless the specific artifact is identified as signed.
- Include source-available license terms and third-party notices. Source use and distribution are governed by [LICENSE](LICENSE).
