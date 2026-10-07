# NerdSSHell copy and color preferences

## Preferences navigation

Open **Preferences** from the main toolbar. Choose a category in the left pane to view its settings on the right. Copy behavior lives in **Copy & Paste**, the terminal palette in **Terminal Colors**, and app/default text colors in **System Colors**. Configure Actions, Configure Favorites, Notifications & Alerts, and Sessions & History share the same settings window. Layout controls remain on the main toolbar.

Switching categories keeps your unsaved changes. **Save** applies all staged settings together; **Cancel** discards them and restores the saved color preview. A failed save keeps Preferences open so you can correct the problem or cancel. Copy behavior changes only after a successful Save.

## Copy & paste

Under **Preferences → Copy & Paste**, **Copy highlighted terminal text automatically** enables PuTTY-style copying. It is on by default, including when older settings have no stored choice. Turn it off and Save to retain manual copying. The choice applies to existing and new terminal views and survives restarting the app. For compatibility it remains a validated boolean in the existing appearance settings.

Finish a mouse selection to copy it, including double/triple-click and Shift-click. Text stays highlighted. Ctrl+C with a selection still copies; without a selection it keeps the normal terminal interrupt. Existing right-click copy/paste and multiline confirmation are unchanged. This applies to terminal text, not SFTP rows or settings fields. Keyboard-driven selections can still be copied with Ctrl+C.

Only completed trusted mouse gestures initiate automatic copying. Programmatic selections (including search), remote output and snapshot refreshes do not initiate clipboard writes. Remote OSC52 remains blocked. A view-generation change, hide/close, cancellation, or window blur invalidates a deferred copy. The helper removes its listeners when its view closes. Clipboard writes use the existing validated main-process copy action and size limit. Automatic copy never types or pastes into a session and never clears a selection.

Selecting text replaces your clipboard. Windows clipboard history, cloud sync or other clipboard software may retain copied secrets. This feature does not control those OS features; disable automatic copying for sensitive workflows.

## Color labels

**Terminal Colors** contains the terminal background, palette presets, the 16 main color controls, and the collapsed **Advanced: numbered colors (16–255)** section. The main colors are paired as Normal and Bright, with readable labels, slot numbers and current hex values. The BrightBlack slot is shown as **Gray (bright black)**.

**System Colors** contains the app background, shared accent/cursor color, and shared app/default terminal text color. Its Dark theme and Light theme buttons set app and terminal backgrounds and default text; they preserve the accent and numbered palette. The NerdSSHell logo follows the app background, including during previews. Terminal palette presets replace numbered colors, including advanced slots, while preserving the background, accent, default text and copy setting.

Select a colored word in the example to focus the palette control used by that example: comments, keywords, function names, strings, variables, numbers, errors, success and warnings. Those labels describe the example only. NerdSSHell does not parse terminal output into syntax categories or reconfigure remote editors. Programs choose their palette slots; exact RGB output bypasses the palette. Changing a slot can affect foreground or background wherever a program uses it. Normal and Bright are independent slots, not computed lightness controls.

Color changes preview immediately in existing terminal views. Save keeps them for existing and future views; Cancel restores saved colors and leaves the saved copy setting unchanged. **Reset colors**, available in the color categories, restores the original backgrounds, accent, text and numbered palette without changing copy behavior or other preference categories. It remains a preview until Save. Existing palettes and indexed overrides are preserved when loading older settings.

## Verification

Coverage includes `test/selection-copy.test.cjs`, `test/clipboard-shortcut.test.cjs`, `test/color-preferences.test.cjs` and `test/preferences-ui.test.cjs`. These exercise trusted gestures, per-view ownership, cancelled deferred copies, draft retention, shared Save/Cancel, failed saves and preserved connection defaults. The Chromium fixture uses the real HTML/CSS/xterm UI with an in-memory bridge. Native Windows clipboard and exact-package behavior require their own acceptance; see [testing](TESTING.md) and [validation results](LAUNCH-VALIDATION.md).
