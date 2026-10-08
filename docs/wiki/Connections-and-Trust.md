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
| Standard SSH terminal baud rate (Advanced) | Speed reported by new Standard pseudo-terminals; server default preserves existing behavior |
| Sign in with | Windows SSH agent, private-key file or password |
| Remember password on this PC | Optional for password sign-in; saves the next successfully authenticated password encrypted for your Windows account |
| On connection | Open all running sessions, restore previous views, or show sessions without opening them |
| Connect when NerdSSHell starts | Whether the app attempts to connect automatically |

Use **History and file settings** to configure scrollback, recording, archive retention, the default upload directory and an advanced tmux socket. Leave the socket blank unless you intentionally use a nondefault tmux socket. A custom socket changes which server-side sessions can be found; it is not a network port.

Choose **Save and connect**. In **Verify server identity**, compare the server address and fingerprint independently before selecting **Trust and connect**. Cancel is initially focused; Cancel or Escape stops the attempt. Clicking outside this security prompt does not accept the key. Unknown hosts are reviewed one at a time; changed or revoked identities remain blocked.

## Standard terminal baud rate

Open **Advanced terminal settings** in a saved connection to choose a rate for its new Standard SSH shells, including nonpersistent workbench tasks. **Server default (unchanged)** omits speed modes. In **New session**, uncheck persistence to choose an independent rate for that new window or inherit the saved connection setting. Each Standard window owns a separate pseudo-terminal.

The input/output speed is sent when the PTY is created. Existing terminals retain their rate; create a new Standard window or save and reconnect to use a new setting. Editing a connection closes its Standard shells after consequence confirmation, so finish that work first. Persistent tmux panes manage their own terminal settings; the override is disabled for them and hidden for local Windows consoles.

This advanced compatibility setting changes the speed reported to remote terminal programs. It does not throttle SSH traffic, repair network lag, or configure a physical serial port. Servers may ignore unsupported speeds. Linux OpenSSH acceptance verified independent 9600/115200 PTYs and unchanged tmux pane speed; other appliances need their own acceptance. The parameters are defined by [RFC 4254](https://www.rfc-editor.org/rfc/rfc4254#section-8) and exposed by [ssh2](https://github.com/mscdex/ssh2/tree/v1.17.0).

## Authentication choices

**Windows SSH agent:** NerdSSHell connects to the Windows OpenSSH agent named pipe. The agent must already be available and contain an appropriate key. Agent configuration is a separate Windows/SSH setup task. WSL's agent is not automatically the Windows agent, and this option is not a promise of Pageant or every third-party agent's compatibility. If unavailable, choose a protected private-key file or password instead of disabling authentication checks.

**Private-key file:** Browse to the local private key. NerdSSHell stores its path in the profile, not the private-key file contents. Protect the file with Windows permissions and preferably a passphrase. Encrypted keys prompt for a passphrase; it is held in memory for the active connection/reconnection, not saved into settings.

**Password:** NerdSSHell prompts when needed and keeps it in memory for the active connection/intentional recovery. Select **Remember password on this PC** in the connection form or password prompt to reuse it after disconnecting or restarting the app. Remembering is off by default. The password is saved only after the server's host key is verified and authentication succeeds. It is encrypted using Windows account protection and kept separately from ordinary connection settings; the edit form never displays a saved password.

Use **Forget password** in the connection controls to remove the saved password and turn remembering off. This clears the app's reconnect password cache and leaves an already authenticated session running. You can also turn remembering off while editing the connection. A rejected saved password is removed so you can enter a replacement. Changing the server, port, username or authentication method, or removing the profile, removes its saved password.

Saved passwords are intended for the same Windows account on this PC. Other software running as your Windows user may be able to decrypt them; account protection does not defend against same-user malware or a compromised operating system. If Windows encryption is unavailable, NerdSSHell does not fall back to plaintext password storage. See [security and privacy](Security-and-Privacy.md).

Keyboard-interactive challenges can also prompt during sign-in, but their answers and private-key passphrases cannot be remembered. Actual server authentication policy still applies; choosing a method in the UI cannot make the server accept it.

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

## Quick Connect (1.2.0 and later)

The bar above saved connections opens a temporary Standard SSH terminal. Enter an IP or DNS name and press Enter or Connect. Ctrl+Alt+Q expands the sidebar and focuses the bar. Use its settings button to keep a username, port (22 by default), sign-in method and optional key path; a missing username is prompted. Passwords and interactive MFA answers are entered in the existing trusted dialogs and stay in memory for that transport.

Accepted forms include `192.0.2.10`, `core-r1.site.example`, `netops@core-r1:2222`, bare IPv6 and `[2001:db8::10]:2222`. A port embedded in the address overrides the default. Commands, multiline destinations and passwords embedded in URLs are rejected.

Quick connections appear separately from saved entries. The last 50 successful destinations can autocomplete addresses; history contains host, port and username, can be cleared, and can be disabled. Host pins are separate from recent history: first-use approval saves the verified endpoint identity, while changed/revoked keys still block connection. No saved profile is required for this trust.

Quick Connect opens plain interactive network-device SSH without Linux/tmux discovery, automatic startup commands or OS inspection. Linux Actions/Favorites and Persistent/task launch controls are unavailable for this mode. SFTP is contacted only when explicitly opened. Save connection retains this mode, endpoint and live terminal; passwords are not implicitly saved by promotion.

Closing or disconnecting a live Standard shell keeps the existing consequence confirmation. Network loss never silently replaces it. Ended output remains readable until its tab is closed; transports and secrets are released, and temporary connections are excluded from app-restart restoration. Pending attempts and terminal tabs are bounded so hundreds of sequential devices do not accumulate connections.
