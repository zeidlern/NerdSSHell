# Coding standards

Use these rules when writing and reviewing NerdSSHell code. Each rule names a behavior to check in the diff and links to the relevant implementation, tests, or policy. [Contributor workflow](CONTRIBUTING.md)

The rule-by-rule format and the approach to interface design and testing draw on [Matt Pocock’s coding standards for Course Video Manager](https://github.com/mattpocock/course-video-manager/blob/main/CODING_STANDARDS.md).

## Interface design

### Give each operation a clear owner

Expose the intent at the call site and keep validation, ordering, and cleanup with the module that owns the operation. `ViewBudget.launch()` reserves a new terminal and `ViewBudget.open()` can reuse an existing one. Both use the same capacity accounting. Native dialogs and File SFTP copy arrows likewise use one transfer lifecycle. [View budget](src/session-limits.cjs) · [File operations](src/file-operations.cjs)

### Name the identity that matters

Use distinct names for a profile ID, a live connection, a stable session token, a pane key, and a file-browser instance. Use the identity with the lifetime the operation needs. A saved profile can outlive its current connection, and one connection can own several panes. Explain an ordering constraint in a comment when the call sequence alone cannot show why it matters. [Architecture](docs/ARCHITECTURE.md) · [Identity compatibility](docs/IDENTITY-COMPATIBILITY.md)

## Privileged operations

### Authorize IPC in main before doing work

Expose named operations through the preload and use main’s common IPC registration and sender checks. Validate arguments and resolve the allowed target in main before network, filesystem, or process work. Keep SSH output, filenames, and other untrusted display values as text. [Security policy](SECURITY.md) · [IPC regression tests](test/ux-security.test.cjs)

### Carry the same target through a prompt or review

Capture the identities the operation depends on before opening a prompt, picker, or review. Recheck them immediately before acting. A replacement connection, view, selection, or review invalidates the old approval. Pane Actions and Favorites submit to the originating terminal. The command workbench uses the reviewed command and destination to launch a new console. [Contributor instructions](AGENTS.md) · [Selection and transfer tests](test/ux-sftp.test.cjs)

## SSH and terminal lifecycle

### Keep discovery, launch, detach, and End distinct

Persistent discovery and reconnect find or reattach to existing work. Only explicit creation starts a job. Close View, Disconnect, and Quit leave Persistent work running. End requires explicit confirmation followed by a server-side check of the approved stable session identity in the same operation that ends it. [Identity compatibility](docs/IDENTITY-COMPATIBILITY.md) · [Session lifecycle tests](test/session-lifecycle.test.cjs)

### Make channel closure and lost input explicit

Confirm the consequence before an app action closes a running Standard SSH or local console. Discard disconnected keystrokes. When a Standard SSH channel is lost, require a user action before creating a new shell. Surface an uncertain send outcome so the user can decide whether to retry. [Architecture](docs/ARCHITECTURE.md#connection-modes)

### Verify the SSH host before authentication

Use the shared host verification path and keep pinning and changed-key refusal in place for every SSH connection mode. Scope approval to the endpoint and observed key. Tests should establish trust for a generated peer through the normal verification path. [Security policy](SECURITY.md#trust-boundaries) · [Host verification tests](test/host-verification-state.test.cjs)

## Files and resource lifetime

### Publish files using the reviewed source and destination

For uploads, verify the opened local handle against the reviewed file identity and stage remote writes before publication. Confirm replacement of an existing remote file separately. Publish downloads exclusively to a new local path. Keep browser-based selections tied to the grants and listings required by their entry point. [File transfer safeguards](docs/SECURITY-REVIEW.md#file-transfer-and-local-storage) · [Transfer tests](test/transfer.test.cjs)

### Keep pending resources charged through cleanup

Reserve capacity before opening a shell, channel, or other bounded resource. Cancellation can finish the caller’s request while the underlying work still holds resources. Release the reservation when that work settles or its owning transport is confirmed closed. A late callback may clean up its own resource and must leave a replacement alone. [View budget](src/session-limits.cjs) · [SFTP resource tests](test/sftp-resource.test.cjs)

## Compatibility

### Preserve identities that survive an upgrade

Preserve the installer GUID, existing data-directory selection, stable tmux tokens, and their compatibility aliases. Test changed behavior against representative older state as well as fresh state. Derive the displayed and packaged version from `package.json`. [Identity and upgrade compatibility](docs/IDENTITY-COMPATIBILITY.md) · [Versioning](AGENTS.md#versioning)

## Testing

### Test the behavior through its normal entry point

Write tests that can fail for a specific observable bug. Call the same operation production uses and assert its result, side effects, or refusal. Use synthetic dialog answers, loopback SSH peers, and temporary files to control external effects while running the real identity checks and lifecycle code. For a race, hold the operation at the relevant await, change the target, and check that it cancels or acts only on the original target as required. [Per-pane file tests](test/per-pane-files.test.cjs) · [Disposable fixture guidance](docs/TESTING.md)

### Match the evidence to the changed behavior

Use disposable sessions and profiles. Cover the requested behavior and a relevant refusal, cancellation, or recovery case when a change affects a safety invariant. Use Windows acceptance for behavior that depends on the native app or packaged artifact and record the cases it actually exercised. [Development and acceptance checks](docs/TESTING.md)
