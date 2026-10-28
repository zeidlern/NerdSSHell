# Changelog

## 1.2.8 — Embedded runtime and dependency security maintenance

- Update Electron from 44.9.3 to 44.10.0, incorporating Node 24.22.1 and Chromium 152.0.7977.169. This closes the embedded-Node security follow-up recorded for 1.2.6 and 1.2.7 and includes upstream malformed-ASAR, archive-path and File System Access fixes.
- Update node-pty from 1.2.0-beta.15 to 1.2.0-beta.18 and pin the reviewed native module bytes. The ConPTY DLL and OpenConsole executable are byte-identical; preserve elevated-provider integrity, session ownership and shutdown protections.
- Update electron-builder from 26.15.3 to 26.18.1, including ASAR path-containment and NSIS extraction fixes. Refresh the lockfile, dependency inventories and runtime notices while retaining the scoped optional build-proxy override.
- Update the full-SHA pins for setup-node 7.1.0, upload-artifact 7.0.2 and CodeQL 4.39.1. Retain required Linux/Windows, dependency, secret and code-analysis gates; repeat exact Windows package and real-installer acceptance for the new dependencies.
- Preserve user data, installer identity, host verification, persistent sessions and the 1.2.7 updater shutdown repair. Versions through 1.2.6 may need one manual installation of the latest official installer. Release artifacts remain unsigned; current evidence and acceptance limits are recorded in [validation results](docs/VALIDATION.md).

## 1.2.7 — Updater shutdown handoff

- Fix a shutdown race where the app's update-control pipe closes just before the original app process exits, cancelling an already approved upgrade and leaving the app closed. After acknowledged release, allow up to five seconds for that same pinned process to exit before continuing the verified installation.
- Preserve explicit cancellation, bounded refusal when the app remains alive, process and installation identity checks, and protection against installing after a later unrelated quit. Add native Windows regressions for pipe closure before/after release, a parent that remains alive, and cancellation during the shutdown grace.
- An affected 1.2.4–1.2.6 client may need one manual installation of the latest official installer to receive this handoff repair. Older clients through 1.2.3 also require a manual upgrade for the earlier download repair.

## 1.2.6 — October dependency security updates

- Update Electron from 44.5.1 to 44.9.3, including the compromised eMudhra certificate mitigation and Chromium security backports. Preserve the existing installer identity, user data, SSH trust checks and session behavior.
- Update the locked build dependencies fast-uri to 3.1.9 and Undici to 6.29.1/7.30.1. Both supported and complete npm dependency audits report zero advisories at this review.
- Pin CI to Node 22.23.4 and require patched Node 22.23.4+ or 24.22.1+ within those supported major lines for source builds. Reject older build runtimes before dependency installation. Update the optional branding exporter to Pillow 13.0.0 on Python 3.11+.
- Keep Windows confirmation acceptance tied to the exact Electron version selected by the source, and refresh dependency inventories.
- Direct manual upgrades to the latest official Windows x64 installer, including the updater repair introduced in 1.2.4.
- Known remaining upstream dependency: Electron 44.9.3 still embeds Node 24.22.0. This update does not claim to incorporate every October 21 Node.js fix; see [dependency maintenance and exposure assessment](docs/DEPENDENCIES.md). Current validation and publication status are recorded in [validation results](docs/VALIDATION.md).

## 1.2.5 — GNU GPL v3 licensing

- License the project-owned NerdSSHell source in this release under GNU General Public License version 3.0 only (`GPL-3.0-only`), replacing the custom source-available license for this revision. Full license text is packaged with the Windows installer and published with the release assets.
- Permit personal and corporate use, modification and redistribution under GPLv3, including commercial redistribution subject to GPL source and notice obligations. Keep pre-1.2.5 release licensing unchanged.
- Align package metadata, source-build guidance, contributor guidance and public documentation. No application-runtime behavior or user-data format changes; Windows artifacts remain unsigned unless a particular asset states otherwise.

## 1.2.4 — Verified update downloads and installation

- Handle GitHub installer redirects through Electron's request API so the updater can validate each destination and stream the installer. Preserve credential omission, cancellation, download bounds and published size/SHA-256 checks.
- Wait for the original application's child processes to finish normal shutdown before the final running-app check. Keep the wait bounded and refuse unrelated or reopened instances; never terminate a process to install an update.
- Add real public download and disposable Windows installation/restart acceptance, alongside adversarial transport and consent regressions. Validation results are recorded in DEVELOPMENT-PROGRESS.md.
- Install 1.2.4 manually using its Windows installer once. Versions through 1.2.3 cannot download this repair through their existing updater. Future upgrades still require Upgrade approval and normal work/notes confirmations.

## Maintenance — Draft release discovery

- Discover existing drafts through GitHub's authenticated paginated release list when the published-tag endpoint returns 404. Reject ambiguous drafts and conflicting source metadata, retain existing release/asset identities and keep public verification credentialless.
- This publisher-only repair does not change application version 1.2.3 or any published tag or asset. Actual validation and publication recovery are recorded in DEVELOPMENT-PROGRESS.md.

## 1.2.3 — Persistent editing-key latency

- Batch adjacent pending Backspace and arrow-key events with typing in Persistent sessions, including normal/application cursor sequences and Shift/Alt/Ctrl arrow combinations. Preserve the first-key dispatch, exact input order, 512-byte request limit and per-event queue accounting.
- Keep Enter, Tab, other control/unknown escape events and multi-chunk pastes as separate acknowledgement barriers. Failures, input locking, snapshots, view/control replacement and disconnect still discard queued input rather than replay it.
- At 150 ms simulated RTT, 30 editing-key events over 957 ms finish echoing at 1,200 ms instead of 4,500 ms. This is a deterministic transport reproduction, not a measurement on the reporter's server. Actual validation and acceptance scope are recorded in DEVELOPMENT-PROGRESS.md.
- Install this update manually using the release's Windows installer. The existing automatic-download problem remains under separate investigation; this release does not include the unfinished updater experiment.

## Maintenance — Release publication

- Require an owner-created protected stable tag before automated publication; reuse the exact validated main Windows build and verify consumer asset checksums. Retire the one-off 1.2.2 publisher and preserve published release/tag bytes on retries.
- Document release recovery and the separate authorization needed for unattended tag creation. Application version and the published 1.2.2 installer remain unchanged; measured results are recorded in DEVELOPMENT-PROGRESS.md.

## 1.2.2 — Persistent-session typing latency

- Combine adjacent queued printable input into acknowledged batches of at most 512 bytes. The first key sends without an added timer; high-latency links no longer build a separate round-trip backlog for every printable key.
- Keep Enter, other control events and multi-chunk pastes as separate acknowledgement barriers. Preserve event/byte limits, Unicode byte order, per-view/control/snapshot identity checks, input-lock invalidation and discard-after-failure behavior. Standard SSH is unchanged.
- Add twelve deterministic latency/lifecycle regressions and a disposable real SSH/tmux delayed-reply test. At 150 ms simulated RTT, 80 keys typed over 790 ms finish echoing at 1,050 ms instead of 12,000 ms. This is not an EC2 or Windows end-to-end latency measurement. See [investigation and validation scope](docs/PERSISTENT-INPUT-LATENCY.md).

## 1.2.1 — Bounded display flush latency

- Preserve the first pending output chunk’s flush deadline instead of restarting it on every arrival. Continuous small output can no longer wait for a quiet gap or the 32 KiB threshold before display delivery.
- Keep renderer acknowledgements, byte limits, epoch/sequence validation and disconnect/recovery guards intact; chunks received during an outstanding frame wait for its acknowledgement.
- Add deterministic steady-stream, delayed/stale acknowledgement, threshold and discard regression coverage. This repairs a reproduced app buffering issue; the reported EC2/tmux lag and physical mouse failure are not yet attributed or certified fixed.

## 1.2.0 — Quick Connect for network devices

- Add an inline Quick Connect bar above saved connections, Enter/Connect and Ctrl+Alt+Q, reusable nonsecret login defaults, IP/DNS/IPv6 and account/port overrides.
- Open temporary Standard SSH terminals without saved profiles. Keep a bounded successful-destination history with clear/disable controls; promote a live connection to saved without replacing its terminal.
- Preserve host fingerprint approval and changed/revoked-key blocking. Temporary passwords/challenge answers stay in transport memory and never create remembered-password records.
- Add explicit generic/network-device mode that suppresses automatic Linux/tmux inspection, startup/task commands and persistence, including after Save and reload. SFTP remains an explicit user action.
- Bound pending attempts and live/retained views; retire temporary transport, secrets, prompts and workspace metadata safely on cancellation, loss and final closure. Preserve normal Standard close confirmations.
- Add appliance and lifecycle regressions, 300-cycle stress, and exact Windows pointer/keyboard acceptance. Actual measured results are recorded in the development progress and PR.

## 1.1.0 — Approved startup upgrades

- Check the official latest published stable Windows release at startup and offer Upgrade or Not now. No installer is fetched or launched until approval.
- Verify fixed repository/asset identity, bounded HTTPS downloads, declared size and SHA-256 before using a hidden, cancellable parent-exit handoff. Preserve normal Standard/local work and unsaved-note quit confirmations, exact install directory, data identity and Windows permission controls.
- Refuse ambiguous install registrations, canceled/stale approvals, corrupt downloads and reopened apps. New installers and uninstallers refuse running apps instead of terminating them.
- Existing 1.0.4 installations need the new version installed once before startup checks are available. Published 1.0.4 remains unchanged.
- This feature does not establish publisher signing or suppress Windows security/UAC policy.


## 1.0.4 — Interactive confirmations and connection recovery

- Add an advanced saved Standard SSH terminal baud rate and independent new-window override. Request both SSH PTY speed modes only when creating the terminal; preserve the server default, existing profiles and inherited task settings. Explain tmux/local restrictions and new-terminal/reconnect requirements.
- Present app-owned confirmations, including multiline paste and session/quit consequences, in one serialized themed dialog. Keep Continue/Paste and Cancel mouse/keyboard accessible, preserve response IDs and caller ownership checks, and keep the Windows parent enabled. Guard trailing double-clicks, reload/destruction and queue limits.
- Serialize first-use host-key approval through the existing in-app prompt with explicit Trust and connect, Cancel focused and stale-target cancellation. Keep changed/revoked-key blocking and Windows-protected password consent intact.
- Dismiss About on completed backdrop clicks while preserving inside clicks, selection, Close/Escape, focus return and background-control isolation.
- Cancel disconnected sign-in prompts and pending command collectors; release retired transport/view references and temporary listeners. Preserve Persistent work, ordered input and Standard SSH's explicit new-shell requirement.
- Add bounded runtime/operation diagnostics and 120 synthetic plus 100 real loopback lifecycle cycles. The original lengthy-session lag report and exact Win32 cursor/capture mechanism remain unverified; no speculative Electron change.
- Establish the current official development checkout and owner-requested recovery checkpoints. Existing v1.0.3 release, tag and assets remain unchanged. The owner authorized publication and local upgrade as 1.0.4.
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
