# Baby tracker add-on

Baby tracker is a **separately installed extension** of Checky Base. The normal web/PocketBase images, including the `latestwapp` app-hosting option, contain no tracker UI, API hooks or database migration. The optional images add those files to the existing services, following the app-hosting image-variant pattern.

It uses the **same PocketBase database, accounts, sessions and personal/shared checklist permissions**. There is no second database, account system, public port or separately running Base installation. Installing it adds `checky_baby_entries` to the current database. Baby tracker appears automatically under the current list's tabs when both its web files and backend extension are installed; there is no built-in Settings switch that installs it.

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
5. Reopen Checky, apply any available Base web update, and open **Baby tracker** from the current list's navigation. Your accounts and lists stay in the same database.

Do not install a second Base instance or choose a new empty data folder to add this to an existing installation.

For a **fresh installation**, import [`docker-compose.casaos-baby.yml`](../../docker-compose.casaos-baby.yml) in CasaOS's custom installer. It selects the optional image pair and uses the same topology and data path as the normal installer. Open `http://YOUR-CASAOS-IP:17760` and complete the normal first-user setup.

## Removing or updating the add-on

To remove the installed add-on code, stop and back up as above, then return web to `latest` (or `latestwapp`) and PocketBase to `latest`, keeping the data folder. Recreate both services and reload Checky. The tracker navigation and API disappear; its stored entries stay in PocketBase. Reinstalling the optional images reconnects them. Do not roll back the migration or delete the collection just to remove the add-on.

To update an installed add-on, update both optional images together. Updating to the plain image tags removes the extension code. A web-only installation does not show a broken navigation link if its backend extension is absent.

## Tracking and sharing

The log at `/baby/` groups entries under month and day headings like the Done tab, with the newest days and times first. Dates use this device's local time; editing an entry's date moves it to the matching day. The log refreshes every 30 seconds while no entry form is open. Add entry fills in the current date/time, which can be edited. Entries have breast milk and formula amounts, feeding notes, and separate pee/poop checkboxes with notes. Display amounts in ml or **US fluid ounces**; stored ml values retain their precision when switching units.

Choose the current personal/shared list in the tracker. Shared caregivers use Base's existing owner/member access. Separate additions do not replace one another; editing/deleting an entry uses its current version to reject conflicting edits. Saving needs a connection, and a failed save retains the open form. The add-on's assets are versioned independently and are not downloaded into the standard Base offline cache.

Baby entries live outside checklist JSON in the same database. Ordinary checklist edits, old desktop clients and checklist JSON imports/resets do not replace them. Deleting the parent checklist deletes its log. Checklist JSON exports and checklist-JSON storage quotas do not include add-on records; full PocketBase data-directory backups do. The tracker UI runs in Base; the desktop app continues its existing checklist sync.

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
