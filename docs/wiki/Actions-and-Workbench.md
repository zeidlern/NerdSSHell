# Actions, Favorites and the command workbench

[Manual home](Home.md) · [Security](Security-and-Privacy.md)

NerdSSHell has **two different command workflows**. Do not confuse them.

## 1. Pane Actions and Favorites: execute in this terminal

An **Action** selected from a pane's dropdown, or a **Favorite** button, inserts its configured command into that exact terminal and **sends Enter**. It does not open a new console or show the separate workbench's script-review page.

Before clicking, confirm the REMOTE/LOCAL badge, server/session, current account, working directory and program accepting input. If a shell has been replaced by an editor, nested SSH connection, root shell or password prompt, that is the context receiving the text. Destination binding prevents a command from jumping into a different application pane; it cannot make the program inside the current pane safe.

Do not click an Action while a terminal is waiting for a password or while a partial command is already on its input line. Read unfamiliar commands and their arguments before use. Built-in update/restart/administrative recipes are not automatically harmless.

## Configure Actions

Open **Preferences > Configure Actions**. Choose the relevant operating-system family and, for Windows, **PowerShell** or **Command Prompt**. These syntaxes are different; a PowerShell command is not automatically valid CMD input.

Use **New custom action**, give it a clear name and enter its command. **Keep custom action** retains the edit in the Preferences draft; the outer **Save** commits the draft to settings. **Cancel** discards the draft. Use **Remove custom action** deliberately and save afterward. Never place passwords, API keys or tokens inside saved commands: custom Actions are persistent settings.

Available built-in recipes depend on detected platform/tools. A disabled recipe is not permission to guess a replacement target or install tools silently. Some commands need an argument in an inline field before execution. Validate it against the intended server resource.

## Configure Favorites

Open **Preferences > Configure Favorites**, or use the pane's separate **Configure Favorites...** button. Choose the relevant OS/shell, select the commands to display and arrange their order. Save the Preferences draft. Favorite buttons appear in a horizontal row that scrolls when necessary.

Unavailable commands remain disabled; changing a transport or session invalidates stale targets. Input locks also apply. A Favorite is a shortcut to a command, not a separate stored SSH login or a saved running session.

## 2. Command workbench: review and run in a new console

Open the workbench with **Ctrl+Shift+P**. Select the actual local or remote destination before preparing a task. Inspect the detected platform and available tools. The workbench provides built-in tasks and custom-script review, including source inspection and warnings where supported.

Review the exact script, destination, account, expected effects and any argument fields. Warnings are pattern-based aids, not a proof of safety. Approving a review starts a **new console** for that task rather than pasting into an already active editor/password prompt. Remote tasks use the account's default starting directory unless the script explicitly changes directory; the SFTP folder is not an execution authority.

Cancelling, changing the destination or replacing a connection invalidates the prior approval. Approve the final version for the final destination, not an earlier preview. A failed or timed-out task may have partially executed: inspect state before retrying, especially updates, restarts and destructive commands.

### Importing commands from chat

Expand **Import code blocks from chat** and choose one fenced code block, or paste directly into the workbench editor. Blocks are not automatically concatenated, translated or executed, and prose/shell prompts are not safely stripped for you. Remote scripts use POSIX `/bin/sh`; Bash-only syntax needs a deliberate, reviewed Bash invocation.

Choose **Review command**, inspect the exact destination/code and warnings, then **Run in new console** and its native confirmation. Built-in disruptive actions can require typing the exact remote hostname. Reviews expire after five minutes; editing or changing a destination requires a fresh review. Cancel before submission prevents the task from starting; cancellation after submission cannot undo work already sent.

Interactive CMD syntax is not equivalent to an arbitrary batch file: labels, `goto` and batch-only `for %%i` constructs need the appropriate explicitly reviewed file/script execution rather than being pasted as if they were ordinary interactive commands.

## Privilege and shell boundaries

Ordinary commands run with the selected account's permissions. An Administrator local-shell launch uses UAC for the new shell; it does not grant remote root access. A remote `sudo` request is governed by that remote server. Encoded PowerShell command text is an encoding, not encryption. Commands can appear in arguments, process listings, remote logs, terminal output or shell history.

Reviewed remote scripts are bounded to 32 KiB and reviewed local scripts to 8 KiB. Large local pasted submissions are also bounded. Limits are explicit safeguards; splitting destructive work into many uncontrolled submissions is not a safe workaround.

## Diagnostics

Workbench diagnostics can gather useful system/output information, but may include hostnames, usernames, paths and commands. Review before copying or sharing. Do not paste a complete diagnostic transcript into a public GitHub issue or an AI chat without redaction. No diagnostic collection is a substitute for host-key verification.

Source references: `ui/pane-actions.js`, `ui/workbench.js`, `ui/command-review.js`, `src/session-commands.cjs`, `src/action-settings.cjs`, `src/action-catalog.cjs`, `src/workbench.cjs`, `src/diagnostics.cjs`.
