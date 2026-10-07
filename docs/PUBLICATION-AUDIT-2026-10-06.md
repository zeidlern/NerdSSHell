# NerdSSHell publication audit — October 6, 2026 (US Central)

## Decision

**Do not treat this review as approval to make all development history public or to recommend an unsigned installer to general users.** The manual and publication checks are prepared; source/privacy decisions, repository administration, actual CodeQL execution, signing and remaining native acceptance are not completed by a documentation commit.

This is a targeted source/packaging-policy review and automated triage, not an independent penetration test, legal review, or guarantee that every vulnerability or personal detail was found.

## Reviewed baseline and provenance

- Main baseline: `ba76676386eec76ca0417cb29caa1369fab274cd`.
- Source tree: `e46a08e3e212aa82d7162ebe2138709cf5fab22a`, identical to the final PR #16 candidate tree.
- Final candidate: `d4547c9b1f22d2701cc41fb7d15f8d00f1f7cf9e`.
- Source artifact: `11454104784` from build `37555176717`; downloaded ZIP SHA-256 `23d7704d3bc8c356f22f0ebd6138a97887445d453a7c5fef9c9ab2a9e380df18`.
- Reconstructing the extracted Git tree produced the exact source-tree SHA above. The download contains a source snapshot, not the full development history.
- The new manual/audit work is in PR #17. Its final check results must be read on its exact head; a baseline pass is not silently reused for changed tooling.

## Findings and disposition

| Finding | Evidence / risk | Action or remaining requirement |
| --- | --- | --- |
| Personal email in commit metadata | The live main commit exposes a personal author email, even though current tracked application files do not contain that address | Owner must approve retained reviewed history or authorize backed-up cleanup. New noreply settings do not sanitize old commits |
| Source repository still private; main unprotected at inspection | Live repository/branch metadata, not inferred from a warning | Configure and verify actual GitHub access/rules; do not confuse this document with enforcement |
| No published GitHub Release established; installers unsigned | Existing release/CI records and signing configuration | Keep source version distinct from published release. Sign/verify exact assets before general consumer recommendation |
| CodeQL public-visibility condition used an undocumented property | `github.repository_visibility` is not a documented context property; missing properties evaluate to an empty string | Corrected to event repository visibility; added public event trigger. Private skipped runs remain skipped, not clean analyses |
| Optional dependency audit has residual findings | The full-lock report flags the optional `sprintf-js` chain through global-agent/roarr; scoped gate omits optional packages | No advisory suppression added in this review. Added installed-graph assertions after supported CI/signing dependency installation. Full-lock findings remain visible/nonblocking and must be disclosed |
| Legacy signing variable compatibility was incomplete in workflow | Helper accepted old/new names but workflow provided only the new variable | Workflow now falls back to the legacy variable; no secrets accessed and no signing run performed |
| Previous manual draft mentioned a nonexistent Data folder button | Backend exposes the path, but current UI has no such visible control | Corrected manual to standard `%APPDATA%\betterssh` with verification and no blind deletion; no new UI capability claimed |
| Declared Node minimum is broader than dependency minimum | Root says Node >=22; locked Electron/@electron/get require >=22.12.0 | Manual specifies current Node 22 x64 >=22.12.0. Root/toolchain enforcement remains a follow-up; no dependency version changed here |
| Artwork/legal clearance is not established | Mascot incorporates recognizable Windows/Tux concepts; custom source-available LICENSE is not third-party clearance | Owner review of artwork rights, attribution and license terms; do not imply endorsement |
| Native/manual acceptance still has gaps | Existing records explicitly exclude genuine UAC/alternate-account consent, native pickers and several real-user scenarios | Test the exact signed build on a clean Windows user/VM with disposable server accounts before broad release |

The optional vulnerability report is not a claim that eight independently exploitable runtime defects were found. It represents npm's propagated dependency findings in the recorded optional build graph. Excluding packages from a supported installation is not patching them. New assertions fail if a package marked optional in the lockfile is unexpectedly installed; actual CI results are needed to establish that condition for each build.

## Current-source privacy scan

The exact baseline snapshot contained **209 files**, of which **175 were UTF-8 text**, totaling **16,106,289 bytes**. Targeted scans found no private-key PEM blocks, common GitHub token patterns, AWS access-key patterns, maintainer personal-email markers, selected personal environment markers, or old `github.com/zeidlern/BetterSSH` URLs in those current text files.

Three Windows-user-path matches were in synthetic/CI test fixtures; the sole private-IPv4 match was the generic connection placeholder in `ui/index.html`. These are not evidence of a bundled personal connection profile. PNG metadata inspection returned no metadata keys.

This is limited pattern-based coverage. It does not prove absence of credentials in unusual formats, images, binary files, previously deleted code, branches not fetched, PR text, comments, logs or downloadable artifacts. A clean current tree is insufficient to clear public history.

## Branding and packaging inventory

Verified the hashes of **25 generated branding outputs**, **three production masters**, **nine ICO PNG frames**, and all **10 original concept blobs** against their committed manifests. The ICO frames matched their corresponding production PNG bytes. Inspected the actual light-mode application mascot. No re-export or font/source-artwork distribution was required.

Current product/URL identity is NerdSSHell. The package name `betterssh`, app ID `cc.zeidler.betterssh`, protocol/IPC namespaces, existing data behavior and tmux identities intentionally remain unchanged. These compatibility strings are not personal networking dependencies and must not be globally replaced.

Checked committed SPDX package checksums against the matching lockfile entries; no mismatches were found in that comparison. CI still regenerates the supply-chain inventories and verifies packaged notices for the exact artifact. This review did not independently extract/retest a newly signed installer.

## Security boundaries inspected

Reviewed the implemented renderer isolation/sandbox configuration, constrained application resource protocol, sender/frame/URL checks for IPC, navigation/window/permission denials, trust-pin and known-host handling, credential/data retention policies, clipboard checks, SFTP publication/cancellation boundaries and command-execution workflows.

Existing protections were retained. Pane Actions/Favorites execute text plus Enter in the originating terminal's current program; only the separate workbench has the reviewed new-console workflow. The manual highlights that distinction instead of promising a review prompt before every Action. Passwords/passphrases stay in process memory rather than settings, but secure erasure is not guaranteed. Recordings, exports, saved notes and backups are plaintext and can contain sensitive output.

No new confirmed application-runtime exploit was demonstrated during this targeted pass. That does not imply that no exploit exists. Skipped CodeQL, unsigned delivery and remaining manual checks prevent a blanket security clearance.

## Validation performed during preparation

- Parsed **109 baseline JavaScript/CommonJS files** with Node's syntax checker; all passed.
- **41 focused existing tests passed**: preferences, selection copy and color preferences on Linux Node 22.16.0.
- **Five publication-tool regressions passed**: local Wiki link conversion/anchors, unknown-target rejection, exclusive export/no overwrite, rejection of installed optional packages, and refusal to interpret missing node_modules as a compliant build.
- A disposable one-commit Git fixture verified that history triage detects email/private-address markers without emitting their literal values. The fixture was isolated and removed afterward.
- Verified the complete **16-page** manual's local links and required page set through the publication checker. This does not establish that GitHub's separate Wiki has been pushed or visually reviewed live.
- No production SSH host, existing terminal, user's clipboard, installed application or real settings/backup was used as a fixture. No repository visibility, collaborator settings, paid service, branch protection, tag or release was changed by these edits.

The full dependency installation, full project test suite and Windows GUI/native tests were not run locally in this Linux audit container. The repository's existing GitHub Windows/Linux CI runs those gates; inspect PR #17's final-head results rather than treating these focused local tests as a replacement.

## Repeatable checks added

`Prepare-Wiki.cjs` exports a checked, extension-corrected Wiki copy to a new directory without authentication or pushing. `Verify-Publication.cjs` checks required pages, link targets, renamed workflow identity and CodeQL's visibility condition. Its `--installed` mode verifies optional lockfile placements are absent after the supported install. The normal source checker runs publication regressions as well.

`Review-Publication-History.cjs` requires a nonshallow Git checkout, traverses fetched reachable text blobs up to 2 MiB, and emits counts plus blob IDs/categories/line numbers rather than email/IP/path values. A synthetic redaction test passed. The CI security workflow stores its redacted report separately from source. Findings still require human classification; upstream license emails, version-number-like addresses and test fixtures can match. Large/binary blobs, images, PR metadata, logs, artifacts and unfetched refs remain separate review surfaces. Gitleaks remains a distinct full-reachable-history secret-pattern check.

Final CI and history-report observations are recorded on PR #17 so evidence is tied to the checked commit, not fabricated in advance. Do not mark any checklist item complete merely because a scanner or workflow has been configured.

## Owner publication sequence

Follow [Maintainer publication](wiki/Maintainer-Publication.md): approve the history/privacy policy, secure account identity/access, enforce active main rules, review actual scan outcomes and native acceptance, sign the installer, then intentionally change visibility and verify public security reporting/CodeQL. Publish only the tested installer and reviewed consumer documentation, not a whole diagnostics artifact.

The Wiki still requires the separate authenticated publication step in [Publishing the Wiki](wiki/Publishing-the-Wiki.md). The source manual is complete independently of that UI operation.

## Primary references

- GitHub contexts: https://docs.github.com/en/actions/reference/workflows-and-actions/contexts
- Visibility effects: https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility
- Rulesets: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets
- Removing sensitive history: https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository
- Electron security: https://www.electronjs.org/docs/latest/tutorial/security
- Residual optional advisory: https://github.com/advisories/GHSA-hp3w-g68c-fv3c
