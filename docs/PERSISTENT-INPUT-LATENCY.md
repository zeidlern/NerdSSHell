# Persistent input latency investigation — 1.2.2

Investigated October 14, 2026 against the published 1.2.1 source, commit
`085b1997ff937c723bb519c36bb964bb9d481cee`.

## Validated cause

`Remote.input` chained each keyboard event onto `view.inputTail` and awaited
`Control.request` for every 512-byte chunk. `Control.pump` allowed one active
command until its matching `%end` or `%error`. For ordinary single-character
input, this imposed approximately one network round trip per character. The
1.2.1 output-flush fix did not change either input path.

This confirms a client-side bottleneck consistent with the supplied report:
Standard SSH can be responsive to the same server while Persistent typing backs
up. It does not establish that every server, network, rendering or application
factor has been excluded. Shared output can delay replies, but neither the
report nor the deterministic test measures congestion on the reporter's link.

## Fix and safety boundaries

Coalesce adjacent pending printable events for the same view, input serial,
snapshot generation and control instance, up to the existing 512-byte request
size. The first event has no new timer or deliberate debounce. Each original
event retains its byte/message reservation and resolves only after its batch is
acknowledged.

Enter, other control events and multi-chunk pastes stay separate acknowledgement
barriers. A failed/partial paste cannot release a later Enter or queued command.
Input locking, snapshot invalidation, close/replacement/disconnect checks,
per-pane fairness, hexadecimal encoding and 256-event/2-MiB budgets remain in
place. No server configuration, tmux version, authentication, Standard SSH,
output protocol, persistent-session identity or session lifetime is changed.

General command pipelining was not introduced. Reply numbering makes it possible
to design a pipelined protocol, but it does not undo bytes already sent or preserve
the existing failed-paste/queued-Enter safety boundary by itself. This focused
fix removes the per-printable-key backlog without changing response ownership.

Batching is still bounded by RTT and request size; it does not make a remote
connection instantaneous. Individually submitted control events and chunks of a
large paste still require acknowledgements. Severe output congestion remains a
separate possible bottleneck.

## Deterministic reproduction

`node --test test/input-latency.test.cjs` executes the actual Remote and Control
classes against an explicitly simulated delayed-reply transport. The sustained
case admits 80 one-character events at 10-ms intervals; the last key is at 790 ms.
Times below are simulated time from the first key, not wall-clock EC2 or Windows
end-to-end measurements.

| Simulated RTT | 1.2.1 final echo | Fixed final echo | Requests before → after |
| --- | --- | --- | --- |
| 1 ms | 791 ms | 791 ms | 80 → 80 |
| 75 ms | 6,000 ms | 900 ms | 80 → 12 |
| 150 ms | 12,000 ms | 1,050 ms | 80 → 7 |
| 300 ms | 24,000 ms | 1,200 ms | 80 → 4 |

The high-latency assertions fail against the original source and pass with the
fix. Twelve added cases cover delayed delivery, first-key dispatch, per-event
acknowledgement, UTF-8/chunk boundaries, control barriers, failed batches/pastes,
snapshot generations, closing and interleaved output. The focused suite also
runs the existing input/output, isolation, session-command and workbench tests:
**100 passed, zero failed or skipped** on Linux / Node.js 22.16.0.

## Real integration and release validation

`test/input-order.integration.test.cjs` adds an owned loopback OpenSSH/tmux test
with 150 ms of injected control-reply delay. It checks exact Unicode command
execution, three input requests (first key, queued text, Enter), and reattachment
to the same persistent session. It never contacts the reported EC2 server or
modifies a user's SSH/tmux configuration. A fixture-less run skips this test;
only a configured CI result establishes that it ran.

The editing sandbox could run the dependency-free focused suite, but its npm
registry DNS resolution failed. Local full `npm run check` and `npm test` were
therefore not passes: installed dependencies were unavailable. Required Linux
source/integration, Windows/package and security checks must run on the exact
PR and merged source before release. Their actual receipts belong in the PR,
Actions runs and release notes; no older release's native results are reused.

The affected EC2 connection and physical Windows typing experience still need a
reporter retest. Automated Windows package checks are not that acceptance.

## Protocol references

- [tmux control mode](https://github.com/tmux/tmux/wiki/Control-Mode): guarded command replies, asynchronous output and flow control.
- [tmux manual](https://man.openbsd.org/tmux): hexadecimal `send-keys -H` and persistent sessions.
