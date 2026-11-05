# Baby tracker add-on

Baby tracker is a **separately installed extension** of Checky Base. The normal web/PocketBase images, including the `latestwapp` app-hosting option, contain no tracker UI, API hooks or database migration. The optional images add those files to the existing services, following the app-hosting image-variant pattern.

It uses the **same PocketBase database, accounts and sessions**, with independent baby-list membership controlled by PocketBase administrators (superusers). It adds `checky_baby_lists` and `checky_baby_entries` to the current database. **Baby** appears beside **Personal** and **Shared** in the normal navigation when both add-on packages are installed. Selecting a baby list opens its log inside the Checky screen; the same navigation switches to other lists without a Back to lists step. The tracker remains a separately installed package, not part of the standard images.

## CasaOS installation

These tags are built and published by the repository workflow. They become downloadable only after a successful publish containing this add-on; local source changes do not update the registry.

| Installed features | Web image tag | PocketBase image tag |
| --- | --- | --- |
| Checky Base | `latest` | `latest` |
| Base + Windows app hosting | `latestwapp` | `latest` |
| Base + Baby tracker | `latestbaby` | `latestbaby` |
| Base + Windows app hosting + Baby tracker | `latestwappbaby` | `latestbaby` |

The image repositories are `ghcr.io/the-vibe-code-dad/checky-web` and `ghcr.io/the-vibe-code-dad/checky-pocketbase`. All variants are published for AMD64 and ARM64. For a fixed release, use matching `sha-<commit>-baby` tags on both services, or `sha-<commit>-wappbaby` on web for the combined variant.

For an **existing CasaOS Checky installation**:

1. Stop both Checky services and back up the complete existing PocketBase data folder (normally `/DATA/AppData/checkys-base/pb_data`).
2. Edit that existing app's web image tag to `latestbaby`, or `latestwappbaby` if you also want Windows app hosting.
3. Edit its PocketBase image tag to `latestbaby`.
4. Keep the same data-folder mapping, network, ports and public-origin settings. Pull the selected images and recreate both services.
5. Reopen Checky, apply any available Base web update, and open **Baby** in navigation. Have a PocketBase admin assign caregivers to `checky_baby_lists` records as described below. Your accounts and lists stay in the same database.

Do not install a second Base instance or choose a new empty data folder to add this to an existing installation.

For a **fresh installation**, import [`docker-compose.casaos-baby.yml`](../../docker-compose.casaos-baby.yml) in CasaOS's custom installer. It selects the optional image pair and uses the same topology and data path as the normal installer. Open `http://YOUR-CASAOS-IP:17760` and complete the normal first-user setup.

## Removing or updating the add-on

To remove the installed add-on code, stop and back up as above, then return web to `latest` (or `latestwapp`) and PocketBase to `latest`, keeping the data folder. Recreate both services and reload Checky. The tracker navigation and API disappear; its stored entries stay in PocketBase. Reinstalling the optional images reconnects them. Do not roll back the migration or delete the collection just to remove the add-on.

To update an installed add-on, update both optional images together. Updating to the plain image tags removes the extension code. A web-only installation does not show a broken navigation link if its backend extension is absent.

## Tracking and sharing

The integrated baby log groups entries under month and day headings like the Done tab, with the newest days and times first. Dates use this device's local time; editing an entry's date moves it to the matching day. The log refreshes every 30 seconds while no entry form is open. Add entry fills in the current date/time, which can be edited. Entries have breast milk and formula amounts, feeding notes, and separate pee/poop checkboxes with notes. Display amounts in ml or **US fluid ounces**; stored ml values retain their precision when switching units.

Manage access in the **PocketBase admin dashboard** with a PocketBase superuser account:

1. Open the `checky_baby_lists` collection.
2. Create a record (or edit an existing baby list) and set its **name**.
3. In **members**, select the Checky user accounts allowed to use this list, then save.
4. Those users reopen Checky's navigation or press its refresh button. Their list appears under **Baby**.

To revoke access, remove the user from **members** in PocketBase and save. Renaming and membership changes use PocketBase's normal record editor. No technical version field needs to be filled in. The dashboard stays on its existing private admin endpoint (normally `http://localhost:8090/_/` on the server); the public Checky app does not expose it.

Assigned caregivers can view, add, edit and delete entries. All app accounts require explicit membership, including the first Checky user. The Checky app-admin role does not grant baby-list management or automatic access. Only PocketBase superusers can create/rename baby lists or change members; these controls are not present in Checky. Ordinary Shared checklist membership and ownership do not grant baby access. Users without an assignment see “No lists assigned”.

Separate additions do not replace one another; editing/deleting an entry uses its current version to reject conflicting edits. Saving needs a connection, and a failed save retains the open form. Switching to another list prompts before discarding an unfinished entry. The add-on's assets are versioned independently and are not downloaded into the standard Base offline cache.

When upgrading an earlier Baby tracker installation, its existing logs are moved into independent baby lists, preserving entry IDs, timestamps, versions and notes. **A PocketBase admin must assign caregivers to the migrated lists**; permissions are deliberately not copied from Personal/Shared checklists. A PocketBase superuser can find and rename those lists in `checky_baby_lists`. Upgrading from the earlier in-app management version preserves existing explicit members; it removes that app-role bypass. Removing ordinary checklist sharing or deleting an ordinary checklist does not change these baby logs.

Baby lists and entries live outside checklist JSON in the same database. Ordinary checklist edits, old desktop clients and checklist JSON imports/resets do not replace them. Checklist JSON exports and checklist-JSON storage quotas do not include add-on records; full PocketBase data-directory backups do. The tracker UI runs in Base; the desktop app continues its existing checklist sync. Direct `/baby/` links remain available, but the normal workflow uses the integrated Checky navigation.

## Building from local source

From `checkys-base/`, build core images first, then extend them:

```bash
docker build -t checky-web-core:local -f web.Dockerfile .
docker build -t checky-pocketbase-core:local ./pocketbase
docker compose -f docker-compose.yml -f docker-compose.baby.yml up -d --build
```

This source Compose stack uses the existing named `pocketbase_data` volume, whereas the CasaOS installer uses a host directory. Use the correct stack for the existing installation; the source commands do not migrate a CasaOS directory automatically. Back up the active data before upgrading. Continue using both Compose files for subsequent source updates; the plain `update-base.sh` updater builds only core images.

To combine source-built Windows app hosting, also use `docker-compose.desktop-updates.yml` after preparing its verified release directory. The add-on's `web.Dockerfile` can also extend an existing app-hosting image through `BASE_WEB_IMAGE`. Its `pocketbase.Dockerfile` extends the current backend through `BASE_POCKETBASE_IMAGE`, including the standalone backend if desired.

The real install/remove/reinstall regression starts an isolated PocketBase instance and Chromium:

```bash
CHECKY_POCKETBASE_BINARY=/path/to/pocketbase CHECKY_PLAYWRIGHT_MODULE=/path/to/playwright node test/baby-tracker.cjs
```

Set temporary, cache, profile and optional screenshot locations on the intended development drive before launching tests. CI also checks the real standard and optional Docker images, including absence of the add-on collection on a fresh standard installation.
