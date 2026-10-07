# File SFTP

[Manual home](Home.md) · [Troubleshooting](Troubleshooting.md)

File SFTP is the per-terminal file-transfer panel. It uses the verified SSH connection's SFTP subsystem. A local Windows shell has no remote File SFTP browser.

## Understand the two sides

**Local** is a folder on your Windows PC. **Remote** is a folder on the selected SSH server under the selected account's permissions. Each remote terminal owns its own browser state, even when several terminals connect to the same server.

The Remote browser is not a live mirror of the terminal's current directory. Typing `cd` in a shell does not automatically change the SFTP directory; SFTP navigation does not change the shell directory either. A nested `ssh`, `sudo` or container command in the terminal does not redirect the SFTP connection. Check the panel's owner and path before every transfer.

## Open, navigate and arrange

Open **File SFTP** from the remote terminal's controls. Choose **Right** or **Below** docking, drag its divider to resize, or collapse it to regain terminal space. Folder state stays attached to that pane, not whichever terminal is focused next.

Use the side's path field/navigation controls to browse folders, go up, return through navigation history or refresh. A local folder picker selects a Windows directory. Double-click/select directory rows through the browser's normal navigation. The hidden-files option changes visibility; the text filter narrows the current listing, not the entire remote filesystem. Refresh when another program has changed the directory.

A remote `~` refers to the connected account's home, not your Windows home. Permissions and directory-listing limits may prevent a listing. Do not change permissions broadly merely to make the file panel look complete.

## Upload a file

Select the intended local file and remote destination directory, then use the upload arrow/control or supported drag-and-drop between the panel's Local and Remote sides. Review the confirmation, target server and exact path. A file dropped onto a terminal also uses the application's upload path and confirmation; it is not automatically executed remotely.

**Shift+drop onto a terminal inserts the local path instead of uploading.** A Windows path pasted into a Linux terminal is not a file on that Linux host.

Uploads use temporary remote files and publish to the final path. Replacing an existing remote file needs explicit confirmation. That reduces accidental overwrite but is not a guarantee against another server-side writer racing with the transfer. Back up important destination files independently.

## Download a file

Select a remote file and choose the download control or supported Remote-to-Local drag. Confirm the local destination. Downloads publish to a **new local filename**; they do not silently overwrite an existing local file. Choose a different filename when the destination already exists.

Opening a remote file in the browser is not an instruction to execute it. Treat downloaded scripts and executables as untrusted until reviewed. Nothing should be launched simply because transfer completed.

## Progress, cancellation and isolation

Transfers remain bound to the original pane, server and paths captured when they began. Switching tabs or collapsing the panel does not retarget them. Cancelling a transfer stops its managed transfer path; check the final status rather than assuming a half-finished file is complete. A hard connection failure can leave temporary files on the server. Cleanup must target only files known to belong to that transfer, never arbitrary similarly named files.

There are limits and timeouts for listings, transfers and SFTP channels. A limit warning is a reason to finish/cancel outstanding work, not open unlimited replacement connections. Reconnection invalidates stale selections; refresh and choose again when asked.

## Not a full Explorer replacement

This version does not provide recursive folder transfer, synchronization, resumed/interrupted-file recovery, destructive move semantics, or complete remote file-management parity with Explorer. The documented drag-and-drop workflow is a copy/transfer operation, not an assurance that Windows Explorer or another external app can consume every internal drag payload.

SFTP v3 does not provide a portable way to prevent every symlink/path replacement race on an actively changing or malicious server. Use dedicated directories and avoid transferring sensitive data through an account or server you do not trust.
