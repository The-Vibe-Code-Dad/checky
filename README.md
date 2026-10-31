# Checky's List

Checky's List is a hosted, local-first checklist app with an Electron desktop companion.

Checky Base is the primary product and canonical web source. The Electron desktop app remains a local-first companion with optional Checky Base/PocketBase sync.

## What You Get

- Canonical hosted web app and PocketBase stack in `checkys-base/`
- Installable offline-capable PWA
- Electron desktop companion with optional hosted sync

## Repo Map

- `checkys-base/` - canonical web source, hosted app, PocketBase backend, and Docker Compose stack
- `checkys-app/` - Electron desktop companion
- `pocketbase/` - PocketBase Dockerfile, hooks, and migrations
- `1-dont not share/` - private build output folder for APKs, installers, ZIPs, and other release artifacts

## Checky Base Quick Start

For a graphical CasaOS install with prebuilt AMD64/ARM64 images, download [docker-compose.casaos.yml](https://raw.githubusercontent.com/The-Vibe-Code-Dad/checky/main/checkys-base/docker-compose.casaos.yml) and import it into CasaOS. See the [CasaOS installation and update guide](checkys-base/README.md#casaos-install-without-building).

Checky Base runs the hosted web app and PocketBase together. From `checkys-base/`:

```powershell
Copy-Item .env.example .env
docker compose up -d --build
```

Then open:

- hosted app: `http://localhost:17760`
- direct PocketBase API/admin port: `http://localhost:8090`
- PocketBase admin dashboard: `http://localhost:8090/_/`

On a fresh Checky Base stack, open the hosted app and create the first hosted user. That first user becomes the initial Checky's List app admin and initial PocketBase superuser for the stack.

For public deployment, put the hosted app behind HTTPS and expose only the hosted web entrypoint. Keep direct PocketBase/admin access private or loopback-bound.

## Sync Model

PocketBase stores personal and shared checklist data separately:

- `checklists` stores personal checklists
- `shared_checklists` stores shared checklists
- `users.defaultChecklist` points to the user's personal checklist
- `users.assignedSharedChecklist` points to the user's assigned shared checklist, when one is assigned

The clients resolve the active synced checklist in this order:

1. device-selected checklist override
2. assigned shared checklist
3. personal checklist

## Desktop Quick Start

From `checkys-app/`:

```powershell
npm install
npm run start
```

The desktop app stores data locally first and can optionally connect to the same personal or shared checklists hosted by Checky Base. It checks the connected Base server for updates, verifies its signed manifest and installer checksum over HTTPS, and launches the Windows installer.

This repository contains source and required build assets. Installers, generated update manifests, database contents, environment secrets, and private signing keys are excluded. Build desktop locally and use the signing publisher described in `checkys-base/README.md` to prepare a hosted update channel.

## More Docs

- Checky Base: `checkys-base/README.md`
- PocketBase backend: `pocketbase/README.md`
- Desktop: `checkys-app/README.md`
- Third-party notices: `THIRD_PARTY_LICENSES.md`
- License notes: `LICENSING.md`
