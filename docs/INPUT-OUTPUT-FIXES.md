# Input ordering and initial display-overflow fixes

Reviewed baseline: `ff828cba0ef09a506a4d0ddda4fd3ac2b9629f8d`.

## Whole-message input ordering

`Remote.input` now reserves a bounded per-view queue position before its first await.
A complete keyboard/paste event finishes before a later event for that view starts,
so an Enter cannot be placed between the 512-byte fragments of a long paste.
Other panes retain independent queues and can share the SSH control channel.

The queue admits at most 256 pending messages and 2 MiB of pending bytes per view,
including the active message. The existing 1 MiB per-event limit remains in force.
Messages are bound to their view, snapshot generation and control channel.
`Control.request` can check an input guard at actual dispatch, not merely enqueue,
so closing a view also invalidates input waiting behind another pane's command.

A failed/partial paste invalidates already-queued events, including Enter. A new,
deliberate event can proceed in a new input generation. Already-transmitted bytes
cannot be undone; no part of a failed message is automatically resent. Disconnect,
view replacement and snapshot changes discard obsolete input without terminating
remote processes. Normal Ctrl+C remains keyboard input, ordered like other events.

## Display recovery without an impossible acknowledgement

Display buffering is extracted into the dependency-free `OutputBuffer` component
and used directly by the main process. A first burst exceeding 4 MiB, or accumulated
pre-flush data exceeding the limit, initiates recovery without needing an ack for
an event that was never sent. Overflow with an existing in-flight event still waits
for that event's matching generation/sequence acknowledgement.

Only one recovery request is allowed per overflow episode. Stale or duplicate acks,
closed views and late failed recoveries cannot affect a replacement state. The
renderer disables input, invalidates pending renders and displays a refreshing
status. A failed/no-op snapshot is visibly reported; output is not silently resumed
and recovery is not retried in a tight loop. Reopening the view is the explicit
retry path. Successful snapshot delivery resets the old buffer state.

Recovered content is limited to the server's retained history. This is not a promise
of lossless history, and an indefinitely stalled renderer with an outstanding ack
still needs recovery outside this specific first-event fix.

## Verification

The application source extracted from the existing Windows artifact was matched to
the baseline's Git blob hashes before modification. Two regression assertions were
run against that unchanged source and both failed: long-paste/Enter ordering, and
main-process initial-output recovery. Both pass with this patch.

`test/input-output.test.cjs` adds 24 deterministic tests covering ordering, Unicode,
ordinary interrupts, sibling panes, disconnect/view/snapshot races, failed delivery,
queue budgets, guarded dispatch, recovery/no-op/error/ack races, and actual main
and renderer wiring. All 24 and `npm run check` passed in the local authoring
container. No Windows binary was executed and no production SSH server was used.

`test/input-order.integration.test.cjs` adds a real shell regression to the existing
loopback-only CI fixture: two long ASCII/Unicode commands and their Enter events are
submitted concurrently; the output file must contain both payloads exactly once.
The full existing test suite, this new regression file, real SSH integration,
security workflows and Windows packaging are required on the pull request. Actual
run IDs/results are recorded in the PR, rather than inferred from workflow files.

Dependencies, lockfile, credentials, trust checks, persistence semantics, repository
visibility/access and installed application are unchanged. These focused fixes do
not close the other public-release gates in `PUBLIC-RELEASE.md`.
