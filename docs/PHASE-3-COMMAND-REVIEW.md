# Phase 3 checkpoint: command review and input protection

Baseline: `be04be51ae40b096a28d6733d65efb02c7683e7e`, on draft PR #9. This is a bounded review of command staging, approval lifetime, destination ownership and input locks. It does not finish OS-specific action recipes or the public-release/security gates.

## Phase 2 results confirmed before continuing

Run `37071450237` completed successfully: Linux checks/full tests/real SSH integration and Windows checks/full tests/installer/package verification plus the nested SSH, SFTP, workbench and expanded local PowerShell smoke. Security workflow `37071450272` dependency and Gitleaks jobs both succeeded. This checkpoint checked step results, not the log's individual counts/findings; it does not claim a clean all-history privacy audit. CodeQL remains skipped.

The downloaded source artifact `11254138875` has SHA-256 `b920512a3f03c815dafe0bf491e95f46c982f180136846560d5f833aea350082`. It records PR merge ref `ef96ad7d2421e97f47d57f8437c5a00144231c67`. Reconstructing the extracted Git tree produced `ed41ebefe7f6f325dfe0e71e6c5d848e71d754c2`, exactly the source tree of the phase baseline. No newer code was discarded.

## Reproduced gaps and changes

1. **Review lifetime through native confirmation.** Previously `take()` deleted the review before the native confirmation opened. Cancellation/disconnect could no longer revoke that reserved approval, expiry was not rechecked afterward, and in-flight dialogs no longer counted toward the review limit. Synthetic tests reproduced these cases. Reserved approvals now remain tracked, single-use and revocable through confirmation, with expiry/ownership checks after confirmation and immediately before task creation is submitted. Both pending reviews and in-flight confirmations count toward the limit of 16, even when an open dialog outlives its expiry. Completion, cancellation and failure release review slots. Native confirmations are independently capped at 16 until their handlers finish, so revoking tickets cannot accumulate an unbounded number of still-open dialogs. Duplicate Run does not invalidate the original in-flight operation.
2. **Renderer invalidation on connection change.** The selected connection's connecting/disconnected event now invalidates completed and outstanding review responses and cancels a token awaiting native confirmation. A rapid reconnect cannot revive that approval. Unrelated connections do not invalidate it. Editing, importing another block, clearing, closing and target changes continue to require a new review.
3. **Honest partial-outcome messages.** If a destination changes after launch submission, the message now says that the console/task may have started on its original target and was not retried. It no longer falsely says nothing ran. Revoking approval does not undo already-submitted actions or kill remote tasks.

These are safety/consent-lifetime defects, not demonstrations of arbitrary remote code execution. The old implementation still displayed a native confirmation and checked captured connection ownership. This is a review workflow, not a command sandbox: custom scripts run with the selected account's actual permissions.

## Verified tests in this phase

`test/command-review.test.cjs` adds 19 backend regressions: cancellation/expiry during confirmation, concurrent-review bounds (including expired open dialogs), duplicate Run, immutable script/target, native-dialog failure, replaced connections, uncertainty after submission, expiry boundary, edited templates, exact fenced-block extraction, confirmation cancellation, and per-view locks. Persistent and Standard transport tests exercise actual ordered input methods with synthetic streams; a lock discards the unsubmitted paste tail and queued Enter while leaving the already-submitted chunk alone.

`test/command-review-ui.test.cjs` adds 8 renderer-controller tests with synthetic DOM/IPC, covering edits, delayed replies, target switches, disconnect/reconnect, pending native confirmation, double Run, exact one-block import and clear/close. These execute the actual controller, not a reimplementation, but are not real browser/native GUI tests.

Local targeted command:

```
node --test test/workbench.test.cjs test/workbench-catalog.test.cjs test/local-powershell.test.cjs test/command-review.test.cjs test/command-review-ui.test.cjs
```

Result: **88 passed, zero failures/skips** (61 existing plus 27 new). `node scripts/check.cjs` and `git diff --check` passed. The initial persistent-lock test fixture omitted the admitted control-channel identity; it was corrected to supply the actual required identity, not to relax the assertion. On the corrected initial 17-test backend regression set, the unchanged baseline had 12 passes and 5 failures across the three approval/lifecycle concerns above. Two later regressions cover capacity after expiry and after ticket revocation, bringing the final backend count to 19. The revocation-cap test also failed before the independent native-dialog counter was added.

A full local `npm test` attempt before dependencies were installed reported 331 passes and five failures caused by unavailable `ssh2` (one file could not load; four loopback cases failed). This is an incomplete full-suite run, not five confirmed application defects or a full-suite pass. No tests were skipped, disabled or removed to hide these failures. Full locked-install/integration/Windows results must be read from CI for the new commit.

## Packaged acceptance added, not predeclared passed

`scripts/Packaged-CommandReview-Smoke.cjs` adds nine assertions to the existing packaged harness. It checks one-block chat import, exact target/code preview, edit/block/close invalidation, backend rejection of a cancelled token, backend enforcement of a remote input lock, per-pane lock isolation and preservation of all four fixture console banners. It runs before the Phase 2 PowerShell extension, with existing assertions retained. No reviewed action is executed by these added UI checks. The existing real SSH workbench integration exercises new-task execution in Persistent and Standard modes.

Native confirmation timing/cancellation and expiry are simulated in unit tests, not tested by clicking native Run dialogs. Administrative update/restart actions are not executed on a user's machines. All new scripts use synthetic content and the existing isolated fixture only.

## Next checkpoint

Read CI for this commit at the start of the next turn; fix a failure before continuing. Do not keep the turn alive polling. Phase 4 is read-only Quick Actions: menu/search/favorites, explicit OS/tool discovery and read-only command recipes. Keep PR #9 draft, main and installed apps unchanged. No dependencies, lockfile, permissions, project license, signing or public-release settings were changed.
