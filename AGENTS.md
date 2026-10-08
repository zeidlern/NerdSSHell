# NerdSSHell contributor instructions

Read README.md, SECURITY.md, docs/ARCHITECTURE.md, docs/SECURITY-REVIEW.md and docs/PUBLIC-RELEASE.md first. This is an implemented app; make focused fixes rather than replacing it with a scaffold or another product.

Safety invariants: Persistent close-view/disconnect/quit must not terminate remote work; Persistent reconnect/discovery must never launch jobs. Standard SSH channel closure needs explicit consequence confirmation and network loss must not silently replace shells. Disconnected keystrokes must not be replayed; session termination needs explicit confirmation and stable identity. Never weaken host verification to make a test pass. Never commit credentials, private keys, profiles or terminal archives. Do not change global server configuration, system security controls, or unrelated repositories.

Pane Actions and Favorites execute in the originating terminal. The separate command workbench reviews commands and runs them in a newly selected console. Preserve both behaviors and their destination/review identity checks.

Run npm run check and npm test before committing. Use disposable loopback fixtures or new isolated sessions for destructive tests; see docs/TESTING.md. Record actual results, not merely configured workflows. New authentication, IPC, terminal-protocol, storage or packaging changes require adversarial regression tests and appropriate Windows acceptance. Do not claim Windows acceptance from a Linux run or reuse older evidence for changed code.

Do not change repository visibility, rewrite shared history, choose a license, release unsigned builds as trusted, or configure paid signing services without the owner's explicit approval. Preserve existing settings, stable session tokens, the installer GUID and data-directory compatibility described in docs/IDENTITY-COMPATIBILITY.md.

Use focused branches and coherent commits during sustained work. Keep recovery notes outside tracked source; user documentation should describe current behavior. The repository owner controls acceptance and official releases.

## Versioning

Use semantic versioning: patch releases for compatible fixes, minor releases for backward-compatible features, and major releases for intentional breaking changes. Documentation-only maintenance does not require a bump. Keep package.json, the root and package entries of package-lock.json, application-visible version, build/installer version and current release notes synchronized. package.json is the canonical version source; runtime About/header and packaging must derive from it. Record each version's changes and validation in CHANGELOG.md. Preserve exact versions in historical evidence instead of globally replacing them. Never reuse an existing release/tag for changed bytes.
## Active development and recovery

Use the official NerdSSHell repository at https://github.com/zeidlern/NerdSSHell.git. The maintainer's active local checkout is D:\Dev\NerdSSHell; D:\Dev\BetterSSH is a retired redirect, not a source tree. Do not import source, tests, dependencies, installers or Git history from retired development copies. Read DEVELOPMENT-PROGRESS.md before resuming this feature branch; the owner explicitly requested tracked checkpoints for recovery. Official merging, publication and installation require the owner's authorization; 1.0.4 is authorized in the current recovery record. Preserve all existing releases/tags/assets, including v1.0.3. Create fresh version tags only from validated main. Keep feature-branch installer uploads disabled.
