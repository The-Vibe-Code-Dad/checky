# Checky's List Base

`checkys-base/` is the canonical home for the Checky's List web application and bundled hosted stack.

The goal of this package is to deploy the public-facing web app and PocketBase together as one installable unit so the hosted app can run from a single domain and route `/api` requests to PocketBase.

## Current Stack

The hosted package currently includes:

- `docker-compose.yml` for the hosted web app + PocketBase
- `Caddyfile` for same-origin routing
- `web/` with the canonical hosted frontend source
- `web.Dockerfile` to serve the bundled hosted frontend assets
- `pocketbase/` with the PocketBase Dockerfile, migrations, and hooks needed by the hosted backend
- `scripts/` with safe operational backup and desktop-update publishing helpers
- `.env.example` for basic port, PocketBase version, and timezone settings

## How It Works

- `/` serves the hosted Checky's List frontend
- `/api/*` proxies to PocketBase
- PocketBase stays directly available on `8090` for local admin access

The web container serves the complete canonical `web/` tree directly. The PocketBase container builds from the bundled `pocketbase/` folder, including the migrations and hooks used by the hosted backend.

In the navigation menu, **Personal** and **Shared** are folder rows in the tab colors. Use their disclosure triangles to reveal the tabs underneath. Opening a folder with one checklist loads that checklist; if it has several, choose the checklist to reveal its tabs. Drag a folder or use its arrow button to reorder it; existing tab drag handles reorder tabs within their checklist.

Choose **Edit > Always show** on a tab to keep it above the folders, even when its folder is collapsed or another checklist is open. Folder order and always-shown tabs are saved for this account on this device. The refresh button beside **Tabs** reloads accessible checklists. The app keeps Personal and Shared data separate.

This folder is intended to be self-contained for CasaOS-style deploys. You can copy `checkys-base/` by itself and build the stack without also copying the repo-level `pocketbase/` folder.

The hosted web app currently:

- locks hosted web to same-origin API usage
- replaces settings-first access with a hosted sign-in screen
- supports first-user bootstrap for a fresh hosted PocketBase stack
- makes the first hosted Checky's List user the app admin and initial PocketBase superuser on a fresh stack
- applies hosted-only login styling and branding
- relies on a server-backed opaque session cookie instead of storing PocketBase auth tokens in the browser

## Quick Start

From `checkys-base/`:

Linux:

```bash
cp .env.example .env
docker compose up -d --build
```

Windows:

```powershell
Copy-Item .env.example .env
docker compose up -d --build
```

Then open locally:

- app: `http://localhost:17760`
- direct PocketBase: `http://localhost:8090`
- direct PocketBase admin: `http://localhost:8090/_/`

On first boot, PocketBase may log an install link using `0.0.0.0`. For local use, open the same path through your actual browser host instead, for example:

- `http://localhost:8090/_/`
- `http://YOUR-LAN-IP:8090/_/`

## CasaOS Install Without Building

Download [docker-compose.casaos.yml](https://raw.githubusercontent.com/The-Vibe-Code-Dad/checky/main/checkys-base/docker-compose.casaos.yml). In CasaOS, open the App Store's custom installation/import option, import the downloaded Compose YAML, and install it. The file contains both services and needs no registry login or local image build. It supports x86-64 (`amd64`) and 64-bit ARM (`arm64`), including a Raspberry Pi running a 64-bit OS.

Open the installed app, or visit `http://YOUR-CASAOS-IP:17760`, then create the first user. That user becomes the initial Checky's List app admin and PocketBase superuser. In the desktop app, connect to this same Base URL and sign in to sync personal and shared checklists.

The installation uses:

- `ghcr.io/the-vibe-code-dad/checky-web:latest`
- `ghcr.io/the-vibe-code-dad/checky-pocketbase:latest`
- `/DATA/AppData/checkys-base/pb_data` on the CasaOS host for persistent database and uploaded files
- port `17760` for the app; PocketBase port `8090` is bound only to the host's loopback interface

### Choose `latest` or `latestwapp`

The web image has two rolling variants:

| Web image tag | Contents |
| --- | --- |
| `ghcr.io/the-vibe-code-dad/checky-web:latest` | Base web app only |
| `ghcr.io/the-vibe-code-dad/checky-web:latestwapp` | The same Base web app plus the selected Windows x64 installer and signed `latest.json` |

In CasaOS, edit the **web** container's image tag to `latestwapp`, then pull and recreate that container. Keep the **pocketbase** image on `latest`; the backend and sync model are identical for both variants. Both web variants support AMD64 and ARM64 servers; the included desktop installer is for Windows x64.

Docker downloads the EXE inside the `latestwapp` image. Each Base server then serves it at `/desktop-updates/` on its own HTTPS origin, preserving existing desktop signature, checksum, origin, and size checks. Installing a new web image also replaces its bundled desktop release. A desktop already on the bundled version will not offer a redundant update.

### Downloading the installer after `git pull`

Git tracks source and the release selection in `desktop-release.json`. Installers are GitHub Release assets, so a plain `git pull` does not download them. From `checkys-base/`, after pulling the source, run:

```bash
node scripts/download-desktop-release.cjs
```

The helper downloads the selected release into the ignored `.desktop-release/` directory and verifies its Ed25519 signature, expected version, file name, and installer SHA-256 before staging the files. It allows bounded HTTPS downloads only from GitHub's release asset hosts and does not use a private signing key.

For a source-built stack, mount that directory using the supplied override:

```bash
docker compose -f docker-compose.yml -f docker-compose.desktop-updates.yml up -d --build
```

Keep using both Compose files when recreating this source-built variant. CasaOS users can simply select `latestwapp`; they do not need this source-build override or Node.js on their server.

For internet access, put the web entrypoint behind your HTTPS reverse proxy. If that proxy forwards real client addresses, set the web service's `TRUSTED_PROXY_CIDRS` to its specific trusted address or subnet. Keep direct PocketBase/admin private. The `latestwapp` web variant includes the desktop release files; the `latest` web variant contains only the web app.

### Updating a CasaOS installation

After a successful publish, `latest` points to the new images. Existing installations keep running their current images until you update them. Stop both Checky services and back up the entire `/DATA/AppData/checkys-base/pb_data` directory before upgrading. Then use CasaOS's image update/recreate controls for **both** services, keeping the same data-directory mapping. Do not delete that directory when replacing containers.

The source-build updater scripts below manage Docker named volumes, not this CasaOS bind-mounted directory. If migrating from an older source-build installation, first stop it and back up its complete PocketBase data volume. Copy that volume's contents into the chosen CasaOS data directory before starting the new stack; do not run two PocketBase processes against the same database. An empty directory starts a fresh installation and does not import an old volume automatically.

### Fixing a CasaOS 502 / missing first-user screen

If the web logs say `lookup pocketbase on 8.8.8.8:53: no such host`, the web container cannot resolve the backend's Docker name. Both services must use the same **custom bridge network**, with `pocketbase` as the backend's network alias. Docker's built-in network named `bridge` does not provide this service discovery. The installer now declares a shared `checky` network explicitly, following the [multi-container CasaOS pattern](https://github.com/IceWhaleTech/CasaOS-AppStore/blob/main/Apps/Docmost/docker-compose.yml) and [Docker networking guidance](https://docs.docker.com/engine/network/#dns-services).

Update the installed application's Compose configuration from the current `docker-compose.casaos.yml` and recreate both services. Preserve the existing `/DATA/AppData/checkys-base/pb_data` mapping and any public-origin setting. Remove an old `network_mode: bridge` override if the installer added one; it conflicts with the explicit `networks` configuration. Pulling images or restarting alone does not apply a Compose networking change.

Open `/api/health` through the app's port `17760`, then `/api/checkys-base/session`. Both must return JSON successfully; an empty database reports `setupRequired: true` and the app shows first-user creation. The web health check now verifies the app page and proxied backend health so a broken connection is visible as an unhealthy container. No database reset is needed to fix this DNS error.

### Automatic image publishing

[Publish Docker images](https://github.com/The-Vibe-Code-Dad/checky/actions/workflows/publish-images.yml) runs on every push to `main` and can also be started manually from GitHub Actions on `main`. Pull requests run validation only. Publishing waits for the backend security tests, real Base/desktop sync tests, desktop security tests, Compose validation, and web-image configuration check.

The workflow builds both architectures for each image and publishes `sha-<full-commit-sha>` tags, plus `sha-<full-commit-sha>-wapp` for the web variant with the installer. It promotes the completed images to `latest` and `latestwapp` only after all three builds have succeeded. Both web variants are tested through a fresh CasaOS stack before publication; the bundled installer is fetched through Base and checked against its signed manifest. Use matching commit tags for a fixed deployment. Database migrations may require restoring the corresponding backup when rolling back; switching image tags alone does not undo migrations.

Publishing uses the repository's short-lived `GITHUB_TOKEN` with package-write permission; no personal access token or signing key is required. Action versions are pinned to commit hashes. New GHCR packages default to private, so their owner must set each package's visibility to public once before users can pull without logging in. Fork maintainers must also update the workflow's repository guard, image prefix, and installer image names for their own account.

## Common Commands

### Cloudflare Tunnel and other HTTPS proxies

If the browser uses HTTPS but the tunnel connects to Base over HTTP, set the public browser URL in `checkys-base/.env`:

```dotenv
CHECKY_PUBLIC_ORIGIN=https://checky.example.com
```

Use your actual domain, including a port only if the browser URL uses a nonstandard port. Keep the tunnel pointed at the **web** service on port `17760` (or `web:80` on its Docker network), so the app and `/api` share one origin. Deploy the updated sources with `bash scripts/update-base.sh` or the Windows updater below. If only changing this environment setting after deploying the updated code, run `docker compose up -d pocketbase` to recreate the backend with it.

For CasaOS or another container UI, add `CHECKY_PUBLIC_ORIGIN` to the **PocketBase container's environment**, then update/recreate it using an image built from these sources. Merely restarting an old image does not install the fix.

This setting prevents `Cross-origin session request rejected.` when an HTTPS tunnel changes the protocol or host seen by PocketBase. It pins browser session writes to that exact public origin and makes session cookies Secure for HTTPS. After setting it, use the public URL for browser sign-in; local HTTP browser sign-in is intentionally no longer accepted. Leave it blank for a local HTTP-only installation. Desktop bearer-token sync remains compatible.

`TRUSTED_PROXY_CIDRS` still controls forwarded client IPs for rate limiting. Set it only to the tunnel connector/proxy source addresses actually seen by Caddy; for a local Cloudflare Tunnel connector, these are not Cloudflare's public edge ranges. The public-origin setting does not broaden proxy trust.

### Start or update

Start or rebuild the stack:

```powershell
docker compose up -d --build
```

Update an existing stack after replacing or pulling the newer `checkys-base/` source files:

Linux:

```bash
bash scripts/update-base.sh
```

Windows:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\update-base.ps1
```

The updater:

1. verifies Docker and discovers the existing PocketBase volume that contains `data.db`
2. stops instead of guessing when multiple data-bearing PocketBase volumes exist
3. creates a timestamped stopped-volume backup when an existing database volume is present
4. builds the new images
5. recreates the containers with the selected PocketBase volume
6. waits for PocketBase and the web app to report healthy

The Compose project and default data volume have fixed names. The updater also detects a legacy Compose volume that already contains PocketBase `data.db` and reuses it, preventing an upgrade from attaching a new empty database and making admin/user credentials appear lost. If a volume cannot be inspected—for example, because the Alpine helper image is unavailable on an offline host—the update stops instead of treating the volume as empty. If more than one populated candidate exists, select it explicitly with `--data-volume NAME` on Linux or `-DataVolumeName NAME` on Windows; explicit overrides must already exist and contain a non-empty `data.db`. Never use `docker compose down -v`; the `-v` option intentionally deletes the database volume.

On Linux, use `--no-pull` when updating without internet access and `--skip-backup` only in exceptional cases. The equivalent Windows options are `-NoPull` and `-SkipBackup`.

### Verified update workflow

The complete updater was tested on Windows with Docker Desktop `29.6.1` against an existing stopped `checkys-base_pocketbase_data` volume and no pre-existing containers. It successfully:

- created a timestamped pre-update archive under `checkys-base/backups/`
- built the PocketBase and web images
- recreated both containers with the existing named volume
- reached `healthy` status for both services
- returned HTTP `200` from the hosted app and PocketBase health endpoint
- served `desktop-updates/latest.json` from the Base web entrypoint

The PocketBase container mount was verified as:

```text
checkys-base_pocketbase_data -> /pb/pb_data
```

Stop the stack:

```powershell
docker compose down
```

Follow logs:

```powershell
docker compose logs -f
```

Check service health:

```powershell
docker compose ps
```

Create a transactionally safe local archive of the complete PocketBase data volume:

Linux:

```bash
bash scripts/backup-pocketbase.sh
```

Windows:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\backup-pocketbase.ps1
```

The backup helper briefly stops PocketBase, archives the named data volume into `checkys-base/backups/`, and starts PocketBase again. Copy important archives off the host. Do not use `docker compose down -v`, because `-v` deletes the database volume.

PocketBase also provides authenticated backups through its admin dashboard under **Settings > Backups**.

Create an additional PocketBase superuser for admin dashboard access:

```powershell
docker compose exec pocketbase /pb/pocketbase superuser create you@example.com your-password
```

Reset a PocketBase superuser password:

```powershell
docker compose exec pocketbase /pb/pocketbase superuser update you@example.com your-new-password
```

Reset a Checky's List app user's password:

- Open the PocketBase admin dashboard at `http://localhost:8090/_/`
- Open the `users` auth collection
- Edit the matching user record
- Set a new password there for the hosted Checky's List sign-in

## Storage Preset

- Hosted checklist saves are enforced in PocketBase, not just in the UI.
- There are now two separate hosted storage settings in PocketBase admin:
- `perUserChecklistSizePreset`: `small = 1 MB`, `medium = 5 MB`, `large = 10 MB`
- `databaseChecklistSizePreset`: `small = 25 MB`, `medium = 50 MB`, `large = 100 MB`
- The default `default` record starts with both settings at `small`.
- To change them, open the PocketBase admin dashboard at `http://localhost:8090/_/`, open the `checky_base_settings` collection, and edit the `default` record.
- Checklist data is already stored in PocketBase as a `json` field, and the backend now rejects non-Checky's List checklist payloads that do not match the usual checklist object shape.
- The enforced limits are based on stored Checky's List checklist JSON, not the raw SQLite file size including database overhead.

## Notes

- The hosted app on `17760` is the Checky's List web app, not the PocketBase admin dashboard.
- The PocketBase admin dashboard stays direct on `8090` in local use.
- The hosted sign-in screen is for Checky's List app users. On a fresh install, the first hosted user becomes the Checky's List app admin and the initial PocketBase superuser.
- After that first bootstrap, the hosted app admin role and PocketBase superuser account are still separate records even if they started with the same email and password.
- Hosted app sign-in now uses an opaque server-backed session cookie with explicit expiry and server-side logout revocation.
- `checkys-base` signs in with `/api/collections/users/auth-with-password`, so if you later change a PocketBase superuser password it does not automatically change the hosted app login password.
- PocketBase's built-in rate limiter is enabled by migration. Existing custom rules are preserved, and missing standard auth, create, batch, and general API rules are added automatically.
- For public deployment, expose only the web entrypoint and keep PocketBase on loopback/private access.
- In this Docker setup, PocketBase is already bound to `127.0.0.1:${POCKETBASE_PORT}` instead of being opened publicly.
- For public deployment, put the web entrypoint behind HTTPS rather than exposing plain HTTP directly.

## Publishing Desktop Updates

After building a Windows installer, prepare a signed update manifest in the Base web tree. Node.js 22 or later and the private Ed25519 update-signing key are required. Set `CHECKY_UPDATE_SIGNING_KEY` to that private key's absolute path before running either publisher:

On the Linux Base host:

```bash
bash scripts/publish-desktop-update.sh \
  /path/to/checkys-list-1.1.0-x64.exe \
  1.1.0 \
  "What changed in this release."
```

Keep the private key outside the web tree, Docker build contexts, and Git. The publisher verifies it against the public key pinned in the desktop app before writing release files. This repository's private key is stored locally in `1-dont not share/update-signing/desktop-update-private.pem`; back it up securely. Losing it prevents signing updates trusted by installed desktops. Replacing the pinned public key requires distributing a new trusted desktop installer.

On Windows:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\publish-desktop-update.ps1 `
  -InstallerPath "..\1-dont not share\checkys-list-1.1.0-x64.exe" `
  -Version "1.1.0" `
  -ReleaseNotes "What changed in this release."
```

The helper prepares the installer and `latest.json` in `web/desktop-updates/`, calculating SHA-256 and signing the release metadata with Ed25519. Upload only those two files as assets of a `desktop-v<VERSION>` GitHub Release. Update `desktop-release.json` to select that published version, then push to `main` to build the new `latestwapp` image. This selection deliberately stays pinned until changed; an unrelated release cannot silently replace the bundled updater.

Installer binaries and generated manifests remain ignored by Git and excluded from the regular web Docker context. Only the verified staging directory enters the with-app image. Keep the existing signing key private and reuse it for future releases. This update signature is independent of Windows Authenticode; a Windows signing certificate is not configured in this repository.

Desktop 1.0.7 and later require a valid signature and HTTPS on both the manifest and same-origin installer, reject redirects, limit the manifest to 64 KB and the installer to 500 MB while reading, and verify SHA-256 before opening the installer. HTTP remains available for local checklist sync; it cannot deliver automatic updates. For the first upgrade from a desktop older than 1.0.7, install the [current trusted release](https://github.com/The-Vibe-Code-Dad/checky/releases/latest) directly: older clients cannot enforce the new signature policy.

Connected desktop apps check this manifest quietly at startup and whenever their window is opened. A compact `Update` button appears in the desktop top-right controls only when the Base manifest advertises a version newer than the installed desktop version. Users can also run an immediate manual check from the desktop Settings page.

## Canonical Source

Make hosted web changes directly under `checkys-base/web/`.

## Ongoing Direction

1. Keep Checky Base as the primary and canonical product surface.
2. Keep desktop local-first while maintaining sync compatibility with Base.
3. Keep PocketBase as the current auth and database layer for hosted deployments.



## Headless administration

PocketBase `:8090` is intentionally bound to the headless server's loopback address, so it cannot be opened remotely. Use an SSH tunnel from your computer:

```text
ssh -L 18090:127.0.0.1:8090 YOUR_USER@SERVER_IP
```

Keep that terminal open, then visit:

`http://localhost:18090/_/`




## Security upgrade (2026-10-30)

The bundled versions are PocketBase 0.41.1, Caddy 2.11.7, Alpine 3.24.3, and Electron 45.2.1. Back up the PocketBase data volume before upgrading, keep that backup until validation finishes, and update any existing `.env` override to `PB_VERSION=0.41.1`. Rebuild both Base containers. The existing update-base scripts create a stopped-database backup; do not reuse a newer database with an older binary when rolling back—restore the matching backup instead.

Hosted sign-in now uses PocketBase's native password/MFA flow before exchanging its completed auth token for an HttpOnly cookie. Enabling MFA requires PocketBase OTP/email delivery to be configured. Both Base and desktop prompt for the verification code. Existing hosted sessions must sign in once after this upgrade; password changes, token-key rotation, auth-policy changes, and logout revoke old cookies. Personal/shared checklist collections, record references, optimistic versions, local caches, and device selection order remain compatible.

Caddy supplies the client IP to PocketBase and overwrites user-supplied forwarding headers. If another HTTPS proxy sits in front of Caddy, set `TRUSTED_PROXY_CIDRS` to its exact source IP or network; do not trust the entire internet. The proxy must overwrite forwarded headers. Without this setting, users behind that proxy share its rate-limit identity. Keep port 8090 private or loopback-bound. The standalone PocketBase package does not enable trusted proxy headers automatically.

Checklist payload validation and combined personal/shared storage quotas run inside record-save transactions, including collection-ID URLs and batch requests. Shared assignment changes update access in the same transaction. Schema repairs preserve existing records and restore missing relation/limit fields left by older migrations.

Run `powershell -NoProfile -ExecutionPolicy Bypass -File test/test-security.ps1` from this directory to build a disposable backend and run backend security plus actual Base/desktop sync regression tests. It uses isolated data and a dynamically allocated loopback port. Run `npm test` and `npm audit` in `checkys-app` for signing/auth protocol checks and the dependency audit.

Run `powershell -NoProfile -ExecutionPolicy Bypass -File test/test-session-origin.ps1` for disposable HTTP/HTTPS public-origin regressions, including tunnel-style internal HTTP, Secure cookies, rejected foreign origins, malformed configuration, and desktop bearer-token compatibility.

