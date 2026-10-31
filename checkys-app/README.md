# Checky's List Desktop

`checkys-app/` is the Electron desktop version of Checky's List.

The folder name is `checkys-app`. The packaged desktop app now uses the display name `Checky's List`, while Windows build artifacts use the safe slug `checkys-list`.

## What It Does

- Opens a desktop checklist window
- Supports an always-on-top widget-style workflow
- Can be shown or hidden with a global hotkey
- Adds a system tray icon for quick access
- Stores checklist data and settings locally
- Keeps a small rolling set of local JSON backups
- Optionally syncs personal and shared checklists through Checky Base/PocketBase
- Checks the connected Checky Base server for verified desktop installer updates

## Quick Start

From `checkys-app/`:

```powershell
npm install
npm run start
```

To build Windows packages:

```powershell
npm run pack:win
```

## Project Layout

- `main.js` Electron main-process logic, storage, tray behavior, and window setup
- `preload.js` IPC bridge between Electron and the renderer
- `renderer/` desktop UI files
- `build/` packaging resources for Windows builds

## Notes

- The desktop app is local-first and continues working without a server.
- When connected, it uses the same personal/shared checklist model as Checky Base.
- Personal and Shared are collapsible folder rows in the tab colors, with the active checklist's tabs nested inside. Opening a folder with one checklist loads it; folders with several checklists let you choose which one to open. Drag folders or use their arrow buttons to reorder them, and use existing tab drag handles to reorder tabs within their checklist.
- Choose **Edit > Always show** on a tab to keep it above collapsed folders and available when another checklist is open. Folder order and always-shown tabs are saved for this account on this desktop. Connection settings remain in Settings.
- Update checks and installation are user initiated. The app re-reads `desktop-updates/latest.json`, downloads only from the connected Base origin, enforces a 500 MB limit, verifies the published SHA-256 checksum, opens the verified Windows installer, and then closes itself.
- The app checks quietly at startup and whenever its window is opened from the tray, hotkey, or another launch. When Base advertises a newer version, an `Update` button appears in the top-right window controls; Settings retains the manual `Check for updates` and install controls.



## Security and updates (1.0.7)

Electron is updated to 45.2.1. Native PocketBase login supports MFA with an emailed verification-code prompt. Personal/shared sync, local data, and per-device checklist selection remain compatible with Checky Base.

Automatic updates now require HTTPS, an Ed25519 signature from the pinned release key, and a matching SHA-256 installer checksum. Redirects and oversized downloads are rejected. Local HTTP checklist sync is still supported. Install 1.0.7 directly from a trusted installer to establish the signature policy; older versions cannot verify it. Release manifests are prepared with the signing publisher under `checkys-base/scripts`.

Development uses Node.js 22 or later. `npm test` exercises authentication/signing boundaries; `../checkys-base/test/test-security.ps1` runs actual Base/desktop sync code against an isolated backend. Dependency overrides keep packaging tools off vulnerable transitive releases and are covered by the Windows EXE/MSI package build.
