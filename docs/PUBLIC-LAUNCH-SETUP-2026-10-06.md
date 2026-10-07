# Public launch setup checkpoint — October 6, 2026 (America/Chicago)

**Historical record:** this checkpoint describes the old repository, now private `NerdSSHell-Historical` (ID `1393960699`). The owner subsequently selected an independent clean public repository (ID `1408217850`). Use [the clean migration checkpoint](CLEAN-PUBLIC-MIGRATION-2026-10-06.md) for current controls. Support requests and owner recovery downloads below were part of the superseded plan, not requirements for the new public source repository.

The existing repository is still private and the 1.0.0 release is still a draft. Source/history privacy clearance and trusted Windows binary distribution remain separate gates.

## Applied and verified

| Control | Actual result |
| --- | --- |
| Clean local source | New clone of parentless `98f7baac6c85c069d3fee13c766b78f3a8c7b0f7`; tree `afb33fc0e2f285dc9a03aae11cd8762a3743251e` |
| Main ruleset | [24626779](https://github.com/zeidlern/NerdSSHell-Historical/rules/24626779), active, exact main target, no bypass, PR and resolved threads, no force pushes/deletion |
| Required checks | `tests`, `windows`, `dependencies`, `secrets`, bound to GitHub Actions integration 15368; strict up-to-date policy; actual successful checks confirmed |
| Independent approval | Zero for the owner's current solo workflow; this does not enforce another person's review |
| Release tag immutability | [24626780](https://github.com/zeidlern/NerdSSHell-Historical/rules/24626780), active, `refs/tags/v*`, no updates/deletion and no bypass |
| Release tag creation | [24626781](https://github.com/zeidlern/NerdSSHell-Historical/rules/24626781), active, only the owner user can bypass its creation restriction |
| Merge defaults | Delete merged feature branches enabled; automatic merging off |
| Actions policy | GitHub-owned actions only, full SHA pinning required, default token read-only, workflow PR approval disabled |
| Dependency security | Vulnerability alerts enabled; automatic security-update PRs enabled and unpaused |
| Email privacy | Account privacy enabled; command-line private-email push blocking verified; local identity configured only in fresh source/Wiki clones |
| Wiki | [Live manual](https://github.com/zeidlern/NerdSSHell/wiki), 14 pages plus sidebar/footer, commit `b898c4516df6c8f47f722888406b4b375e9ab2c6`; collaborators-only editing verified |
| Maintenance record | Run `37565273898` deleted after its receipt was saved privately; read-back 404 |
| Draft assets | All seven asset digests verified; all six checksum-manifest entries verified; installer Authenticode status `NotSigned` |

No destructive main/tag push was used to test protection. GitHub's effective main-branch rules API returned the configured requirements and `current_user_can_bypass=never`.

## Actual validation

- Fresh supported `npm ci --omit=optional` completed. Installed-graph validation confirmed the omitted optional placement is absent.
- `npm run check` passed, including five publication regressions.
- `npm test`: **726 passed**, no failures, cancellations or skips, on Windows.
- Fresh supported advisory audit: **0** findings. Full lockfile: **8 moderate**, zero high/critical. This does not clear the full graph; supported installation deliberately omits the documented optional graph.
- Existing clean-baseline [build 37564930494](https://github.com/zeidlern/NerdSSHell-Historical/actions/runs/37564930494) and [security 37564932084](https://github.com/zeidlern/NerdSSHell-Historical/actions/runs/37564932084) completed successfully. They remain evidence for that baseline, not acceptance of a future signed installer.
- Downloaded draft installer SHA-256: `25ddba8acbd15b41f838d6e0ea66faff0615b4c7e7ecd0f629cc0bb7aa2b8551`. It was inspected and hashed, not installed into the owner's profile.

This checkpoint changes documentation/configuration only; application version 1.0.0, runtime source, compatibility identifiers and installed data are unchanged.

## Publication blockers and next sequence

1. **Retained private history:** closed PRs 1–17 still expose superseded head/base/merge references through the authenticated API. Normal branch/tag cleanup does not prove GitHub deleted those objects. Send a precise [GitHub Support removal request](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository) and obtain a written outcome. Support's eligibility is limited; do not claim that personal email alone guarantees assistance. If sensitive operational details remain and Support declines, use a separately approved fresh repository from the clean snapshot and keep this one private. Do not perform another blind rewrite.
2. **Private recovery:** retain the original private recovery archive, including its key, in owner-controlled protected storage. The ChatGPT download buttons were attempted but no local download could be verified. Never attach the recovery archive/key to a release, public issue or public Support discussion. Preserve collaborators' uncommitted work privately and require fresh clones; reviewed file changes can be reapplied without merging old ancestry.
3. **Owner account:** verify passkey/strong MFA and privately retained recovery codes. Account credential setup and recovery material require the owner. Inspect necessary app/token permissions without removing an active integration blindly.
4. **Source visibility:** only after the history/rights decisions are resolved, approve the specific private-to-public transition. It exposes PR discussions, history, Actions logs/artifacts and the Wiki, not merely current source.
5. **Immediately after public visibility:** apply `all_external_contributors` Actions approval, enable public secret scanning and push protection, enable/verify private vulnerability reporting and its signed-out reporting route, dispatch the existing advanced CodeQL workflow on main, inspect both JavaScript/Actions analyses and alerts, and add the successful actual check names to main protection. Remove the two test collaborators as approved by the owner. These are automatable setup tasks once public; they are not inherently owner-only tasks. Do not enable a second/default CodeQL configuration alongside the existing workflow.
6. **Publisher signing:** enroll an appropriate publisher identity through an explicitly approved provider. The owner must handle identity documents, binding terms and spending authorization. Configure the existing fail-closed `windows-signing` workflow with a main-only environment and workable independent reviewer before adding certificate secrets. Required environment reviewers are plan/visibility-dependent. Self-review prevention needs another reviewer. The current workflow expects certificate-based credentials; a cloud signing service needs a separately reviewed integration.
7. **Real Windows acceptance:** use a clean Windows 11 x64 user/VM and disposable SSH hosts. Record ordinary install/upgrade/uninstall and backup preservation; real UAC approve/cancel/alternate-account cases; native dialogs and GUI-driven transfer hashes; first-use/changed-key/cancel trust; all local shells/layouts and persistence behavior; storage ACLs; physical toast/audio/taskbar delivery. An automated elevated runner or this development profile does not establish these observations. The recording-deletion limitation remains documented.
8. **Final artifact:** verify Authenticode publisher/timestamp, package hardening, exact notices/SBOM/checksums and actual candidate acceptance. The existing v1.0.0 tag is immutable. Use a new sequential version/tag for changed signed bytes; do not quietly replace this draft with a different build under the same identity. Publish only after those gates and the owner's publication decision.

Brand artwork remains the owner's existing choice. Its Windows-logo motif has a separate rights question; technical validation and signing do not establish permission or endorsement. See [Microsoft's trademark guidance](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks).

## Owner-controlled evidence

Local verification logs, downloaded draft assets, cleanup/static/history receipts, API read-backs and the prepared Support request are kept outside tracked source. They are not consumer release assets and may include diagnostics. The clean source checkpoint intentionally does not commit them.
