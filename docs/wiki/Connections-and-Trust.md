# Connections, authentication and trust

[Manual home](Home.md) · [Sessions](Sessions-and-Workspace.md)

## Prepare the connection

Obtain the server hostname/address, SSH port, username, authentication method and host-key fingerprint from its administrator or trusted console. The fingerprint identifies the server, not your login key. Learn the expected fingerprint through an independent trusted channel before accepting an unknown host.

The server needs SSH enabled and reachable through the intended LAN/VPN/firewall path. NerdSSHell does not configure routers, expose ports, install VPN software or change server firewalls for you. Use a least-privilege server account rather than root for routine work.

## Add a saved connection

Select **Add a connection** on the welcome screen or the **+** beside the connection list. Fill in:

| Field | Meaning |
| --- | --- |
| Name | Your label, such as `Lab server` |
| Server | Hostname or address; the UI's sample address is not a configured server |
| Port | Usually 22; use the administrator's actual value |
| Username | The server account, not necessarily your Windows username |
| Sign in with | Windows SSH agent, private-key file or password |
| On connection | Open all running sessions, restore previous views, or show sessions without opening them |
| Connect when NerdSSHell starts | Whether the app attempts to connect automatically |

Use **History and file settings** to configure scrollback, recording, archive retention, the default upload directory and an advanced tmux socket. Leave the socket blank unless you intentionally use a nondefault tmux socket. A custom socket changes which server-side sessions can be found; it is not a network port.

Choose **Save and connect**. Inspect the trust prompt, compare the host fingerprint independently, then authenticate. Cancelling an authentication or trust prompt should stop that attempt; do not approve an unexpected prompt just to clear an error.

## Authentication choices

**Windows SSH agent:** NerdSSHell connects to the Windows OpenSSH agent named pipe. The agent must already be available and contain an appropriate key. Agent configuration is a separate Windows/SSH setup task. WSL's agent is not automatically the Windows agent, and this option is not a promise of Pageant or every third-party agent's compatibility. If unavailable, choose a protected private-key file or password instead of disabling authentication checks.

**Private-key file:** Browse to the local private key. NerdSSHell stores its path in the profile, not the private-key file contents. Protect the file with Windows permissions and preferably a passphrase. Encrypted keys prompt for a passphrase; it is held in memory for the active connection/reconnection, not saved into settings.

**Password:** NerdSSHell prompts when needed and keeps it in memory for the active connection/intentional recovery. It does not save it to settings. Keyboard-interactive challenges can also prompt during sign-in. Actual server authentication policy still applies; choosing a method in the UI cannot make the server accept it.

## Host trust: stop on changes

NerdSSHell reads the user's OpenSSH `known_hosts` and keeps its own approved fingerprint pins. It does not silently rewrite `known_hosts`. Changed pinned keys and revoked keys are blocked. A legitimate server rebuild can change its key, but so can connecting to the wrong host or an interception attempt.

When blocked, record only the nonsensitive error needed for investigation, contact the server administrator and independently verify the replacement fingerprint. Do not delete all known hosts, all settings or all pins. There is no documented one-click global trust reset; any deliberate trust maintenance needs a backup and precise identification of the affected host.

## Persistent support

Persistent sessions require tmux 3.2 or newer. The application may offer a support-installation step when tmux is absent. Treat that as a server change: approve it only on a machine you administer and understand. Cancelling is valid. Standard SSH does not require the tmux installation step.

Connecting/discovering must not silently start your application or replay old keystrokes. Creating a **new** session is a separate deliberate action. If you expect an existing tmux session, verify that you used the same server, username and socket.

## Edit, reconnect and delete profiles

Edit a saved connection from its connection controls. Changing a profile disconnects it; persistent work remains on the server, while nonpersistent work can end and must be handled first. Removing a connection from the saved list is not equivalent to deleting its historical local recordings. It also is not a command to terminate all remote tmux sessions.

There are three separate concepts: saved connection settings, a live SSH transport, and a terminal session. Keeping them separate helps diagnose why a server is disconnected while its persistent jobs are still alive.

## First safe test

Create a disposable persistent session named `persistence-test`, run a harmless command, disconnect through the UI and reconnect. Confirm that you reattach to the same session rather than a newly launched shell. Then use **End** on that disposable session and confirm it disappears. Never use a production task to learn the difference between Disconnect and End.

Source references: `ui/index.html`, `src/core.cjs`, `src/remote.cjs`, `src/standard-remote.cjs`, `src/main.cjs`.
