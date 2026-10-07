# Clean public repository migration — October 6, 2026 (America/Chicago)

The owner selected a new independent public repository instead of requesting deletion of cached development history. The previous repository remains private. Source publication and trusted Windows installer distribution are separate decisions.

## Identity and transfer boundary

| Repository | ID | State |
| --- | --- | --- |
| `zeidlern/NerdSSHell` | `1408217850` | New, independent, public; initially no branches/tags/releases/PRs/forks |
| `zeidlern/NerdSSHell-Historical` | `1393960699` | Existing development repository, private |

The new source history starts only at the reviewed parentless `98f7baac6c85c069d3fee13c766b78f3a8c7b0f7`, with tree `afb33fc0e2f285dc9a03aae11cd8762a3743251e`. The unchanged `v1.0.0` tag points at that exact root. The migration branch contains documentation changes and the latest reviewed setup documentation; it does not import its former ancestry.

No old PRs/comments, workflow runs/diagnostics, retained old refs, local `.git`/`.local`, profiles, terminal archives, credentials or private recovery material is copied. Historical source/run/PR/rules links explicitly identify their private provenance. A hash in a dated evidence document does not import the referenced old Git object.

A separate snapshot review covered 231 tracked files, 197 text and 34 binary files. Targeted matches were third-party notice contacts, synthetic runner/example paths/addresses and intentional author attribution. No targeted personal server/login/workstation details, private-key PEM blocks or common GitHub/AWS tokens were identified; PNG ancillary personal metadata was absent. This is bounded pattern-based review, not exhaustive secret detection or application security certification. Fresh reachable-history secret scanning and public CodeQL results remain tied to their actual new-repository runs.

## New repository controls

- [Main ruleset 24627923](https://github.com/zeidlern/NerdSSHell/rules/24627923): active exact main target, PRs, resolved review threads, strict `tests`, `windows`, `dependencies`, `secrets` checks bound to GitHub Actions; zero solo-owner approvals; no bypass, force pushes or deletion.
- [Immutable version tags 24627925](https://github.com/zeidlern/NerdSSHell/rules/24627925): active `v*` update/deletion restriction with no bypass. [Owner-only tag creation 24627926](https://github.com/zeidlern/NerdSSHell/rules/24627926) permits the owner's creation through a separate rule without bypassing immutability.
- GitHub-owned full-SHA-pinned actions, read-only default token and no workflow PR approval; all external contributors require Actions approval.
- Secret scanning and push protection enabled; private vulnerability reporting enabled; free Dependabot vulnerability alerts and automatic security-update PRs enabled/unpaused. These were read back from the new repository rather than assumed from workflow text.
- Wiki enabled with collaborators-only editing verified. Only the owner has direct collaborator access; the former test collaborators were not copied. Auto-merge is off and merged feature branches delete automatically.
- Existing account email privacy/noreply identity remains in use. The clean source checkout is separate from the retired local clones, whose push URLs are disabled.

The existing advanced CodeQL JavaScript/Actions workflow runs on this public repository. After both matrix checks actually succeed and their alerts are reviewed, add their actual names to required main checks. Do not configure an overlapping default setup or call a skipped job a pass. No signing credentials, paid service, repository visibility change or new personal account credential was configured during migration.

## Candidate release and manual

Draft release `405369065` contains exactly the seven previously verified consumer assets: installer, user-manual ZIP, checksum manifest, full/runtime SPDX inventories, license and third-party notices. Uploaded SHA-256 digests and sizes match the originals; no diagnostic/evidence/recovery ZIP is a consumer asset. The installer hash remains `25ddba8acbd15b41f838d6e0ea66faff0615b4c7e7ecd0f629cc0bb7aa2b8551` and Authenticode remains unsigned. This is an unpublished candidate, not a newly signed/rebuilt release. The original manual ZIP remains byte-for-byte provenance for that candidate; live source/Wiki documentation records the current migration.

The reviewed 14-page manual plus sidebar/footer is exported from `docs/wiki/` into the newly initialized Wiki, using ordinary commits with verified noreply identity. Do not import the old Wiki Git history. Verify the actual public Home/sidebar, Installation and Codex page links after the push.

The application version remains 1.0.0. Runtime source, installer bytes, compatibility identifiers and installed user data are unchanged. Use a new sequential version/tag for later changed signed bytes rather than moving this immutable tag or replacing its published identity.

## Completion evidence and remaining distribution gates

Fresh local `npm run check` and `npm test` must pass before committing this migration. The new repository's source/SSH integration, Windows build/package/native/spelling/UI/notices, supported/full dependency audits, reachable-history secret check and both CodeQL languages must be read on the exact migration head. The PR record and final local migration receipt hold actual run IDs/results; earlier historical evidence is not relabeled as new acceptance.

No GitHub Support contact or owner-operated recovery download is required for this independent source migration. Keep the historical repository private, use clean local clones and do not merge old development ancestry into the public repository.

Trusted binary distribution still needs enrolled publisher signing, a protected signing workflow/environment with a workable reviewer, exact signed-artifact/package/notice verification and genuine clean-user/UAC/alternate-account/native-dialog/transfer/physical-notification acceptance. The existing artwork and source-available license are preserved; technical checks do not establish third-party trademark permission. Public source visibility is not a vulnerability-free certification or a trusted unsigned installer recommendation.
