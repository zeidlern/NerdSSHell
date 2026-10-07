# Changelog

## 1.0.2 — Documentation, Help and resource limits

- Open the Wiki manual, connection guide, troubleshooting, repository, issues and releases from **Help and about**, using validated fixed browser destinations.
- Bound discovery to 1,024 panes per server and terminal views to 64 across the application. Preserve existing view identities and remote work; additional sessions remain available in the sidebar.
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
