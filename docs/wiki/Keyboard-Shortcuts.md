# Keyboard shortcuts

[Manual home](Home.md) · [Workspace](Sessions-and-Workspace.md)

These shortcuts apply to the 1.0.x workspace. Focus and modal dialogs matter; ordinary text-entry fields keep their normal editing behavior.

| Shortcut or gesture | Result |
| --- | --- |
| Ctrl+Tab | Next open session tab |
| Ctrl+Shift+Tab | Previous open session tab |
| Ctrl+Alt+1 | One pane |
| Ctrl+Alt+2 | Two panes, side by side |
| Ctrl+Alt+3 | Two panes, stacked |
| Ctrl+Alt+4 | Four quadrants |
| Ctrl+Shift+T | New session workflow for the selected context |
| Ctrl+Shift+W | Close the active view; local/Standard work may stop |
| Ctrl+Shift+P | Open the separate command workbench |
| F11 | Toggle full screen |
| Select terminal text | Copy when copy-on-selection is enabled |
| Ctrl+C | Copy a selection; otherwise interrupt the terminal program |
| Ctrl+Shift+C | Request terminal-selection copy |
| Ctrl+V | Paste into the focused terminal with the app's paste checks |
| Right-click terminal with selection | Copy selected text |
| Right-click terminal without selection | Paste |
| Ctrl+F | Find in the current terminal buffer |
| Enter in the find field | Next match |
| Shift+Enter in the find field | Previous match |
| Ctrl+Shift+F in a remote terminal | Search recorded output |
| Mouse wheel | Scroll local terminal history |
| Alt+mouse wheel | Pass wheel input to the terminal program |
| Drop file onto a remote terminal | Start the confirmed upload workflow |
| Shift+drop file onto a terminal | Insert the local path; no upload |
| Drag terminal grip | Swap/move pane placement |
| Drag divider | Resize panes/panels |

Closing a view is not the same as **End**. Ending persistent work uses the explicit End control and confirmation. Multiline paste confirmation is not a substitute for reading the command or checking the host.

The About dialog also closes on a completed backdrop click, its Close button or Escape. Inside clicks and text-selection drags keep it open; dismissal returns focus and does not activate the control beneath the backdrop. Security trust prompts require their explicit Trust button or cancellation.
