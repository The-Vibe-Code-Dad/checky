# PocketBase Stack

This folder contains the Docker setup and migrations for Checky's PocketBase backend.

It now supports a separated sync model:

- each auth user has their own personal checklist in `checklists`
- shared collaboration lists live separately in `shared_checklists`
- checklist writes use a `version` field for optimistic conflict detection

## Collections

- `users` auth collection
- `checklists` base collection for personal checklists
- `shared_checklists` base collection for shared checklists

### `users`

The important app-facing field is:

- `defaultChecklist` relation to the user's personal record in `checklists`
- `assignedSharedChecklist` optional relation to the user's assigned shared record in `shared_checklists`

The apps now resolve the current sync target like this:

1. device-selected checklist override if present
2. assigned shared checklist if present
3. otherwise the user's personal checklist

### `checklists`

Each personal checklist record stores:

- `shareKey` unique text key
- `name` display label
- `data` JSON checklist document
- `owner` relation to `users`
- `updatedBy` relation to `users`
- `version` integer used for sync conflict checks

The personal collection is owner-only. It is no longer used for shared records.

### `shared_checklists`

Each shared checklist record stores:

- `shareKey` unique text key
- `name` display label
- `data` JSON checklist document
- `owner` relation to `users`
- `sharedWith` multi-relation to `users`
- `updatedBy` relation to `users`
- `version` integer used for sync conflict checks

## How Sharing Works

- Private use: the user works against their personal record in `checklists`.
- Shared use: the user is assigned a record from `shared_checklists`.

The shared collection rules allow read/write access only when the logged-in user is the `owner` or is present in `sharedWith`.
When an admin assigns a shared checklist to a user through `users.assignedSharedChecklist`, a server-side hook also makes sure that user is added to the shared checklist access list automatically.

## Migration Behavior

The migrations now do five things:

1. Keep `checklists` as the personal-only collection.
2. Rebuild `shared_checklists` as the active shared-only collection.
3. Move any older shared records out of `checklists` into `shared_checklists`.
4. Add `users.assignedSharedChecklist` for default shared assignment.
5. Make sure every user has a personal checklist in `users.defaultChecklist`.

Fresh installs stay personal-first. The seeded shared `main` checklist is available for admins to assign manually, but users are not auto-added to it until an admin assigns it.

New `users` records get a personal checklist automatically from a PocketBase server-side hook at creation time.

## Run With Docker Compose

From this folder:

```powershell
Copy-Item .env.example .env
docker compose up -d --build
```

The PocketBase dashboard will then be available at:

```text
http://YOUR_HOST:8090/_/
```

## Persistence

The important persistence rule is:

- keep `/pb/pb_data` on persistent storage

The included `docker-compose.yml` stores PocketBase data in the named Docker volume `pocketbase_data`.

## What Bootstraps Automatically

On first container start, PocketBase will apply the migrations in `pb_migrations/` and create:

- the `users` auth collection
- the `checklists` personal collection
- the `shared_checklists` shared collection
- the `checky_base_sessions` hosted session collection
- the seeded `shared_checklists/main` record
- the `users.defaultChecklist` relation field
- the `users.assignedSharedChecklist` relation field
- the server-side hook files in `pb_hooks/`

## Manual Steps After First Boot

1. Create or sign in to a PocketBase superuser.
2. Open the dashboard.
3. Create `users` auth records for the people who should sign in from the apps.
4. Point the app at `http://YOUR_HOST:8090`.
5. Sign in from the app.

### To Keep A User Private

- Do nothing special.
- New users get a personal checklist automatically when their PocketBase auth record is created.

### To Share One Checklist Between Multiple Users

1. Pick or create a checklist record in `shared_checklists`.
2. Set one user as the `owner` if you want.
3. Set each participant's `assignedSharedChecklist` relation to that same shared checklist record.
4. The user-assignment hook will add assigned non-owner users to `sharedWith` automatically if they are not already present.

The important rule is:

- shared records live in `shared_checklists`, while personal records stay in `checklists`

If you prefer the CLI for the first superuser, run:

```powershell
docker compose exec pocketbase /pb/pocketbase superuser create you@example.com your-password
```

## Notes

- The image defaults to PocketBase `0.41.1`. Change `PB_VERSION` in `.env` when you want to test a different release.
- The Dockerfile uses a multi-stage build so `unzip` is only present during image build and is not kept in the runtime container.
- The apps now sync against the checklist assigned to the logged-in user, not a single hardcoded shared record.
- Hosted browser sign-in now uses an opaque server-backed session cookie stored in `checky_base_sessions` instead of putting a PocketBase auth token directly in the browser cookie.


## Security upgrade

The default runtime is PocketBase 0.41.1 on Alpine 3.24.3. Back up the data volume and update existing `.env` version overrides before rebuilding. Hooks and the security migration mirror canonical Checky Base, including native MFA sign-in, password-bound hosted cookies, transactional payload quotas, and shared-access revocation. Existing hosted sessions must sign in once after upgrading. The direct server is loopback-bound by default. Forwarded client-IP headers are trusted only when `CHECKY_TRUST_PROXY=true` is explicitly supplied behind a proxy that overwrites `X-Checky-Client-IP`; the bundled Base stack handles this automatically.
