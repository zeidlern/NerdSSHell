# Scratchpad and waiting-for-input alerts

[Manual home](Home.md) · [Preferences and data](Preferences-and-Data.md)

## Scratchpad

Select **Scratchpad** at the top of the sidebar. This is one shared notes panel, not a different note for each terminal. Drag the divider to resize it; the divider also supports keyboard resizing. Collapse hides the panel without discarding its current text.

Type plain text, paste a snippet or select **Open...** to load a file. The highlight selector offers Auto, Plain text, Markdown, Code and PowerShell. Highlighting is a bounded lexical preview, not a complete language parser or executable editor. Markdown images, links and code are not executed or fetched merely because they are in a note.

| Control | Behavior |
| --- | --- |
| Open... | Load a deliberately selected UTF-8 text file, subject to size/content checks |
| Save As... | Save to a new file; do not overwrite an existing destination |
| Copy | Put note text on the Windows clipboard |
| Bold | Insert Markdown bold markers into the plain text |
| Word wrap | Toggle soft wrapping versus horizontal scrolling |
| Collapse | Hide the panel without clearing its in-memory notes |

**Word wrap** starts off. It wraps both prose and long unbroken tokens to the panel width, without inserting newline characters into the note. The choice survives collapse/reopen within the current app run; do not assume that it persists across application restarts. In wrapped mode, a screen line and a literal text line are not necessarily the same thing.

Typed text appears immediately. Syntax highlighting may update after typing pauses; large or dense notes fall back to native plain text rather than delaying keystrokes. Highlight colors do not transform the file's contents.

## Saving and privacy

Notes are memory-only until **Save As**. There is no automatic recovery file or cloud sync promised. Explicitly save important notes before exiting. Quitting or replacing unsaved notes requires confirmation, but a crash/power failure can still lose memory-only text.

Open/Save support bounded UTF-8 text up to 1 MiB without NUL characters. Save As requires a new destination: if a file appears while the dialog is open, the application should refuse to overwrite it. Choose a fresh filename. Edits made while a dialog is pending are protected by revision checks and may require another save/review.

Saved notes are plaintext. The clipboard may retain copied content through Windows history/sync. Do not store passwords, private keys or recovery codes here expecting a password vault. A JavaScript/OS process cannot promise secure erasure of all memory copies.

## Local spelling

Scratchpad uses local English spelling support with underlines and right-click correction suggestions, retaining native undo behavior. Dictionary-download fallback is blocked; note text is not intentionally sent to an external spelling service. Availability and suggestions depend on local Windows language services. If suggestions are absent, use Plain text or continue editing; do not enable network dictionary downloads or weaken network restrictions merely to satisfy a test.

## Waiting-for-input alerts

Recognized background questions can mark a tab/sidebar row/terminal header **WAITING FOR INPUT** and trigger a sound, Windows notification or taskbar attention. Examples include supported confirmation choices, authentication input and interactive selections.

Ordinary idle time and a quiet shell are not enough to trigger an alert. Detection examines bounded prompt/screen evidence and can miss unfamiliar languages/programs. It is an aid, not a guarantee that every agent/server request will be noticed.

A new prompt normally alerts once rather than repeatedly sounding on every redraw. Sessions track their own waiting state. Selecting a notification brings the relevant still-current terminal forward; it does **not** approve the request, type an answer or execute a command. Read the question yourself before responding.

Open **Preferences > Notifications & Alerts** to independently control detection, sound, Windows notifications and visual indicators. Defaults are on. The terminal already active in the focused application stays quiet. Windows notification settings and Do Not Disturb can suppress desktop delivery even when the application's setting is on.

For a safe test, use a disposable background session with a simple confirmation prompt, then verify that an ordinary idle terminal stays quiet. Do not test alerts by launching a destructive administrative command that is waiting for approval.
