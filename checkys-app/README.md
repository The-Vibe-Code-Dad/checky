# Checky Desktop

Checky Desktop 2 wraps Checky Base in a Rust/Tauri window on Windows, macOS and Linux. Choose your hosted Checky address on first launch to use the same sign-in, shared lists, add-ons, reminders and web updates as your browser. For a standalone checklist, choose **Local checklist on this computer**. That interface is built from `checkys-base/web` and opens without a server.

Use **Settings → Checky Desktop** or the tray menu to change the server, switch workspaces, or change the global show/hide shortcut. Checky initially tries Ctrl+Space (Command+Space on Mac). The tray menu also works when the OS already uses the shortcut. On a Wayland desktop that reserves global hotkeys, assign `checky-desktop --toggle` to a system shortcut.

Enable **Settings → Event reminders → Notification settings** in the wrapper for native notifications from the open checklist, including while hidden in the tray. Set **Repeat until checked (minutes)** on a reminder or in **Edit week**. Quit exits the native reminder scheduler. Browser Web Push subscriptions remain separately configurable on each browser.

### Upgrading from Electron

Quit the earlier app to release its global shortcut. When Local checklist is opened for the first time, Checky looks for the old desktop data/checkTabs.json in the standard Electron profile and copies its checklist into the new webview. For a custom storage location, use Export JSON in the old app and Import JSON in the new one. Hosted accounts sign in again using their Checky server. The local checklist and each hosted origin have separate storage.

### Development and packaging

Install stable Rust, Node and the Tauri 2 system prerequisites for the target OS. From `checkys-app/` run `npm ci` and `npm start`. Use `npm run build -- --bundles nsis` on Windows, `--bundles dmg --target universal-apple-darwin` on macOS (install both Apple Rust targets), or `--bundles deb,appimage` on Linux. Build outputs are under `src-tauri/target`. The Desktop workflow builds and tests each platform and publishes all installers together for a new version. Older Windows clients consume the separately signed Checky update manifest.

The original Electron sources remain for compatibility tests and migration reference. New interface features belong in `checkys-base/web/`.
