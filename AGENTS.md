# NerdSSHell contributor instructions

Read README.md, SECURITY.md, docs/SECURITY-REVIEW.md and docs/PUBLIC-RELEASE.md first. This is an implemented app; make focused fixes rather than replacing it with a scaffold or another product.

Safety invariants: Persistent close-view/disconnect/quit must not terminate remote work; Persistent reconnect/discovery must never launch jobs. Standard SSH channel closure needs explicit consequence confirmation and network loss must not silently replace shells. Disconnected keystrokes must not be replayed; session termination needs explicit confirmation and stable identity. Never weaken host verification to make a test pass. Never commit credentials, private keys, profiles or terminal archives. Do not change global server configuration, system security controls, or unrelated repositories.

Run npm run check and npm test before committing. Use the disposable loopback fixture or new isolated sessions for destructive tests. Record actual results, not merely configured workflows. New authentication, IPC, terminal-protocol, storage or packaging changes require adversarial regression tests and appropriate Windows acceptance.

Do not change repository visibility, rewrite shared history, choose a license, release unsigned builds as trusted, or configure paid signing services without the owner's explicit approval. Preserve compatibility with existing settings and the application identifier.

## Current product mission and recovery

The product is NerdSSHell — Built for Windows nerds with Linux problems. Read `docs/NERDSSHELL-IMPLEMENTATION.md` for the current mission, checkpoints, ownership boundaries and actual validation. The owner has authorized its implementation and GitHub checkpoints. Pane Actions and Favorites execute in the originating terminal; historical documents describing a mandatory new-console review apply only to the separate command workbench, not these session menus.

Keep useful, coherent checkpoints on the working GitHub branch during sustained work. Update the implementation log with completed sections, files, tests, unresolved issues and the next concrete step. Do not claim a Windows acceptance result from a Linux run or reuse older evidence as acceptance for changed code. Codex's concurrent PowerShell fixes remain on their own branch until completed; integrate by normal merge with target-specific conflict review.

## Versioning

Starting with 1.0.0, use semantic versioning: patch releases for compatible fixes, minor releases for backward-compatible features, and major releases for intentional breaking changes. Pure planning/checkpoint documentation does not require a bump. Keep `package.json`, the root and package entries of `package-lock.json`, application-visible version, build/installer version and current release notes synchronized. `package.json` is the canonical version source; runtime About/header and packaging must derive from it. Record each version's changes and validation in `CHANGELOG.md` and the implementation log. Preserve historical evidence versions instead of globally replacing them. Never reuse an existing release/tag for changed bytes, and do not change the legacy compatibility identifiers without an explicit migration design.
