# Change Log

This file tracks internal repo changes by area.

- The `v0001`, `v0002`, `v0003` style numbers are internal change-log versions.
- Each section keeps its own independent version sequence.
- Only increment the section that actually changed.

android:

## v0001 - 2026-04-07
- Removed archive checkboxes from the Android client surfaces.

## v0002 - 2026-04-07
- Fixed Android tab refresh behavior so the current tab stays selected after reload.
- Prevented tab rename input taps from selecting the tab and closing the drawer.

## v0003 - 2026-04-08
- Updated Android PocketBase sync to distinguish personal `checklists` from `shared_checklists`.
- Added collection-aware checklist references, assigned shared checklist resolution, and mixed accessible checklist browsing.

## v0004 - 2026-04-08
- Updated the shared web runtime to support hosted Checky cookie sessions without storing PocketBase passwords or auth tokens in browser storage.

## v0005 - 2026-04-08
- Fixed hosted web sign-in in the shared Android/web frontend so it creates and verifies the hosted session before unlocking the app.
- Stopped hosted login from overwriting the submitted email with stale hidden Advanced form values.

## v0006 - 2026-04-08
- Aligned Android server URL normalization with desktop so bare hostnames like `checky.example.com` default to `https://` in both the web source and checked-in native asset copy.

## v0007 - 2026-04-08
- Renamed the Android app branding to `Checky's List`, updated the checked-in native asset copy to match, and moved the tracked project folder to `checkys-android`.

## v0008 - 2026-04-08
- Removed UTF-8 BOM bytes from the Android Gradle and source files that were breaking Gradle script parsing after the rename pass.
- Updated Android APK output naming to use the current `androidComponents` API and escaped the app-name apostrophe correctly in `strings.xml` so `:app:assembleDebug` succeeds again.

## v0009 - 2026-04-09
- Removed the dead Android storage-picker file-path code and unused FileProvider scaffolding so the native export plugin only keeps the JSON export flow the app still uses.
- Refactored Android `www/mobile-storage.js` into clearer runtime-context, auth, and remote-sync helper boundaries and extracted the manual sync flow into a dedicated function without changing the public storage API shape.

## v0010 - 2026-04-09
- Removed the old CasaOS wording from the Android Advanced PocketBase sync settings copy.

## v0011 - 2026-04-10
- Ignored the local Android build-home directory so debug keystore lock and analytics files stay out of Git.

## v0012 - 2026-04-10
- Allowed Android cleartext HTTP traffic so local PocketBase testing can use plain `http://` URLs.

## v0013 - 2026-04-10
- Replaced raw Android PocketBase network fetch failures with a clearer server URL, LAN IP, same-network, and firewall hint.

## v0014 - 2026-07-16
- Prevented manual sync conflicts from pulling an older server checklist over unsent local tasks.
- Refreshed active PocketBase sessions during normal sync operations so connected devices do not silently age out after several days.

## v0015 - 2026-07-16
- Preserved stable tab and task IDs in the Android fallback client so it remains compatible with PWA merge metadata.

## v0016 - 2026-07-18
- Removed the end-of-life Android application from the repository.

base:

## v0001 - 2026-04-07
- Added hosted login overrides for `checkys-base`.

## v0002 - 2026-04-07
- Fixed Checky Base API proxy routing.

## v0003 - 2026-04-07
- Hardened the hosted Checky Base auth flow.

## v0004 - 2026-04-07
- Cleaned up hosted Checky Base docs and environment setup.

## v0005 - 2026-04-07
- Refreshed hosted login branding, favicon usage, default hosted port `17760`, and related docs.

## v0006 - 2026-04-07
- Fixed hosted sign-in persistence and current-origin sync after the hosted port change.

## v0007 - 2026-04-08
- Documented hosted storage preset fields and how to manage them from the PocketBase admin dashboard.

## v0008 - 2026-04-08
- Switched hosted Checky sign-in to a base-managed session cookie flow and added hosted sign-out UI that avoids saving PocketBase passwords or auth tokens in browser storage.

## v0009 - 2026-04-08
- Added hosted login throttling requirements for the new base-managed sign-in flow with progressive retry waits.

## v0010 - 2026-04-08
- Made the hosted `checkys-base` sign-in override confirm the session cookie before reloading into the app.

## v0011 - 2026-04-08
- Documented that hosted `checkys-base` sign-in now uses an opaque server-backed session cookie instead of exposing a PocketBase auth token in the browser cookie.

## v0012 - 2026-04-08
- Added anti-framing and basic browser hardening headers to the hosted `checkys-base` web entrypoint.

## v0013 - 2026-04-08
- Scoped hosted `checkys-base` browser hardening headers to the web app surface so `/api/*` stays a clean app-facing PocketBase proxy for Android and desktop clients.

## v0014 - 2026-04-08
- Blocked hosted `checkys-base` requests to `/_/` on the web entrypoint so PocketBase admin stays direct on `8090` instead of falling into the app shell.

## v0015 - 2026-04-08
- Removed the hosted web entrypoint SPA catch-all fallback so unknown `checkys-base` paths now return `404` instead of loading the app shell.

## v0016 - 2026-04-08
- Renamed the hosted deployment package branding and tracked folder to `checkys-base`, including the hosted override asset filenames and Docker references.

## v0017 - 2026-04-08
- Moved the hosted `checkys-base` override bootstrap ahead of the shared web runtime so refreshes keep the app shell hidden until hosted session state is known.
- Hid the hosted checklist UI whenever the sign-in overlay is active so refresh and sign-out no longer expose stale app content behind the login gate.

## v0018 - 2026-04-09
- Documented that the first hosted Checky's List user becomes the hosted app admin on a fresh stack while PocketBase superusers stay separate and manual.

## v0019 - 2026-04-09
- Updated the hosted `checkys-base` docs so the first hosted bootstrap user is documented as both the initial hosted app admin and the initial PocketBase superuser.

## v0020 - 2026-04-09
- Reworked the root GitHub README into an app overview with Android, sync, and Checky Base quick-start guidance.

## v0021 - 2026-04-09
- Simplified the Checky Base first-admin setup screen copy, removed the PocketBase admin shortcut buttons, and centered the larger hosted setup form.

## v0022 - 2026-04-10
- Renamed the Checky Base first-admin setup button to `Create` and reinforced the centered setup-only form styling.

## v0023 - 2026-04-10
- Made `checkys-base/` self-contained by bundling the hosted web asset snapshot and PocketBase Dockerfile, hooks, and migrations inside the base folder.
- Updated the hosted Docker build contexts so CasaOS can build from only `checkys-base/`.

## v0024 - 2026-07-16
- Turned the hosted web app into an installable PWA with square icons and an offline application-shell cache.
- Added safe authenticated startup and reconnect sync.
- Added stable tab/task IDs, last-synced base snapshots, and a confirmation preview that merges only newly created offline tasks into a newer server checklist.

## v0025 - 2026-07-16
- Moved the PWA checklist selector into the main Settings view and made accessible personal/shared lists load automatically when Settings opens.

## v0026 - 2026-07-18
- Made `checkys-base/web/` the canonical hosted frontend source instead of a copied Android snapshot.
- Added container health checks, graceful PocketBase shutdown, and a safe stopped-volume backup helper.
- Added a hosted desktop-update manifest and publishing helper so Base can serve versioned Windows installers and checksums.
- Updated project direction and operations documentation for the Base-first, Android-EOL product direction.

## v0027 - 2026-07-18
- Fixed the Compose project and PocketBase volume names so Base updates keep using the existing database even when the deployment folder is renamed.
- Added a guarded Base updater that creates a pre-update backup, rebuilds without deleting the data volume, and waits for both services to become healthy.
- Fixed updater backup handling when a data volume exists but no PocketBase container has been created yet.
- Removed remaining Android-source dependencies and updated repository documentation after deleting the end-of-life client.

## v0028 - 2026-07-18
- Documented the successfully tested Base backup, rebuild, named-volume reuse, health-check, and endpoint verification workflow.
- Documented the Base-hosted desktop installer contract, including same-origin delivery, size limits, and SHA-256 verification.
- Made the desktop update publisher write strict UTF-8 JSON without a BOM so Electron can parse hosted release manifests reliably.
- Published and verified the hosted `1.0.0` Windows installer baseline against its generated SHA-256 manifest.

## v0029 - 2026-07-18
- Documented desktop release checks at startup/window opening, the manual Settings check, and the conditional top-right update control backed by the Base release manifest.

## v0030 - 2026-07-19
- Remembered each hosted PWA user's last opened checklist across sign-out and sign-in instead of falling back to the personal checklist.
- Bumped the PWA application-shell cache so installed clients receive the corrected checklist-selection behavior.

## v0031 - 2026-07-19
- Tightened public-repository ignore rules for local environment files, credentials, signing keys, PocketBase data and SQLite sidecars, logs, backups, installers, and generated release archives while preserving publishable environment examples.

## v0032 - 2026-07-19
- Added Linux Bash equivalents for safe PocketBase backups, guarded Base updates with database-volume preservation and health checks, and publishing Windows desktop installers from a Linux Base host.
- Documented the Linux and Windows maintenance commands side by side.

## v0033 - 2026-07-22
- Saved checkbox toggles immediately so a refresh cannot discard the checked state before it reaches local storage and the Base sync queue.

## v0034 - 2026-07-22
- Published the Checky's List desktop `1.0.2` installer through the Base update channel with a fresh SHA-256 manifest and checkbox-sync release notes.

## v0035 - 2026-07-22
- Packaged the verified desktop `1.0.2` installer and update manifest as an offline transfer bundle for deployment to an isolated Checky Base host.

## v0036 - 2026-07-22
- Published the Checky's List desktop `1.0.3` installer through the Base update channel with a fresh SHA-256 manifest and release notes for the updater and Instructions fixes.

## v0037 - 2026-07-23
- Made Base updates discover and reuse legacy PocketBase volumes containing `data.db`, with explicit volume overrides and an ambiguity stop so upgrades cannot silently attach an empty database and hide existing admin/user credentials.

## v0038 - 2026-07-23
- Made PocketBase volume inspection fail closed when the Docker helper cannot run, including offline missing-image failures.
- Rejected explicit Base data-volume overrides unless the named volume already exists and contains a non-empty `data.db`.
- Kept the Linux updater in BOM-free UTF-8 so its executable shebang remains valid.

## v0039 - 2026-07-23
- Documented the PocketBase built-in rate limiting enabled for hosted and desktop API authentication.

## v0040 - 2026-07-23
- Replaced raw hosted login and first-user exception details with fixed client-safe messages while retaining server-side bootstrap logging.

## v0041 - 2026-07-23
- Published the rebuilt Checky's List desktop `1.0.4` EXE through the Base update channel so installed `1.0.3` clients can receive the reconnect, authenticated-update, Done-archive restore, and backup validation fixes.
- Packaged the 1.0.4 installer and manifest as a private offline transfer bundle for deployment to the Checky Base host.

## v0042 - 2026-07-23
- Made hosted sync infer unsynced local changes from the last-synced checklist snapshot instead of trusting only the dirty flag.
- Kept the just-pushed local checklist on screen instead of immediately pulling a potentially older server response over it.
- Saved hosted task text immediately on edit and bumped the PWA cache so installed clients receive the correction.
## v0043 - 2026-07-24
- Published the Checky's List desktop `1.0.5` EXE through the Base update channel with a fresh SHA-256 manifest and sync-versioning release notes.

## v0044 - 2026-08-06
- Published the Checky's List desktop `1.0.6` EXE through the Base update channel with a fresh SHA-256 manifest and release notes for startup reconnect and connection-loss notifications.

## v0045 - 2026-10-30
- Moved checklist selection from Settings into a folder dropdown above Tabs, grouped into Personal and Shared with the current checklist marked Open.
- Opened checklists directly when selected, refreshed available lists from navigation and successful syncs, and kept the current checklist and choices intact when opening or refreshing fails.
- Bumped the PWA application-shell cache for the updated navigation.

## v0046 - 2026-10-30
- Updated the hosted stack to PocketBase 0.41.1, Caddy 2.11.7, and Alpine 3.24.3, including the upstream PocketBase download location and backup helper images.
- Routed hosted login through native PocketBase password/MFA authentication and bound opaque cookies to the user's credentials and auth policy, so password changes and policy changes revoke old sessions.
- Enforced checklist format and combined storage quotas in record transactions, including collection-ID and batch writes; fixed shared assignment revocation and repaired missing schema fields without merging personal/shared collections.
- Preserved client IPs through an explicitly trusted proxy chain, replacing the shared-proxy login lockout path. Added HTTPS-only, Ed25519-signed desktop update publishing with bounded downloads.
- Verified fresh installation, an upgrade preserving 0.36.8 checklist data, full password/OTP authentication, quota races, proxy isolation, and real Base/desktop sync and conflict handling. Added a disposable backend regression runner and updated deployment/release instructions.

## v0047 - 2026-10-30
- Made Personal and Shared independently collapsible folders in the checklist dropdown, with the current checklist's folder expanded initially and folder choices preserved through refreshes and switches.
- Added keyboard-accessible folder controls and bumped the PWA application-shell cache.

## v0048 - 2026-10-30
- Replaced the separate checklist dropdown with Personal and Shared folder rows in the tab colors, using disclosure triangles and placing the active checklist's actual tabs underneath.
- Added folder reordering by dragging or arrow buttons and retained tab dragging within each checklist.
- Added Edit > Always show to keep chosen tabs above the folders and reopen their checklist when needed; saved navigation preferences per account on this device.
- Bumped the PWA application-shell cache and verified folder navigation, keyboard controls, reordering, pin/unpin, reload persistence, and failed-switch recovery.

## v0049 - 2026-10-30
- Prepared the canonical Base sources and deployment scripts for a clean public source repository, excluding local data, secrets, installers, and generated release manifests.
- Clarified that a hosted desktop update channel is prepared separately with the signing publisher.

## v0050 - 2026-10-30
- Added GitHub Actions to validate security and real Base/desktop sync before publishing paired web and PocketBase images for AMD64 and ARM64 on updates to main.
- Added a reusable CasaOS installer that pulls published GHCR images, persists data under /DATA/AppData/checkys-base/pb_data, and keeps the direct admin port on loopback.
- Restricted Docker build contexts to required app/backend files and documented graphical installation, matched image updates, backups, and migration from older named volumes.

## v0051 - 2026-10-30
- Added optional `CHECKY_PUBLIC_ORIGIN` for Cloudflare Tunnel and HTTPS proxies so hosted sessions validate the public browser origin and issue Secure cookies even when the internal connection uses HTTP or a different host.
- Kept exact cross-origin rejection, local HTTP defaults, and desktop bearer sync; documented deployment configuration using generic example domains only.
- Added disposable regression checks for public origins, cookie flags, forged headers, logout, and invalid configuration; verified the existing backend security and Base/desktop sync suite.

## v0052 - 2026-10-31
- Declared an explicit shared bridge network and PocketBase alias in the CasaOS and source Compose files so imported multi-container installs retain backend name resolution.
- Made web health check the proxied backend as well as the app page, and added CI coverage for fresh first-user creation, browser/native authentication, and a disconnected backend using the CasaOS topology.
- Documented applying the networking correction to an existing CasaOS app while retaining its database directory and public-origin setting.

## v0053 - 2026-10-31
- Added the `latestwapp` web image variant with a verified Windows installer and signed update manifest, while keeping `latest` free of generated desktop release files; both variants use the same PocketBase image.
- Added a pinned GitHub Release selection and bounded HTTPS downloader with signature, version, filename, redirect-host, and SHA-256 validation; private signing keys remain local.
- Extended CI to test both CasaOS image variants and verify the installer served through Base before publishing all images. Documented CasaOS tag selection and an optional source-build download/mount step after git pull.

## v0054 - 2026-11-04
- Added a persistent `pb_data/checky-config.json` for Docker public-origin and reminder settings, with existing environment overrides and immediate file reloads; documented Compose, plain Docker and CasaOS setup.
- Added per-item event dates, per-browser notification opt-in, and server-sent Web Push for closed tabs/PWAs. The PocketBase image now includes a private Node transport with persistent VAPID keys, access checks, retry/backoff, expired-subscription cleanup and delivery records.
- Preserved existing reminder dates when older clients omit the new field on save, while allowing explicit removal and task deletion.
- Added service-worker notification handling and checklist links, mobile-friendly reminder editing, timezone validation, and explicit permission/HTTPS feedback. Updated the PWA cache and dependency notices.
- Verified real PocketBase scheduling, authorization, revocation, public-origin configuration, security/MFA and Base/desktop sync; added unit, integration and browser regressions and CI checks. Live browser-provider delivery and a Docker image build still require deployment verification on a Docker host.

## v0055 - 2026-11-04
- Moved Remind from the checklist row into its press-and-hold/right-click menu and kept the expanded menu inside the viewport.
- Added non-repeating, daily, weekly, monthly and yearly reminder options with saved timezones. Calendar repeats retain their original date/time, clamp shorter months, skip nonexistent spring-forward times and avoid duplicate fall-back occurrences or missed-series backlogs.
- Preserved repeat metadata across web storage, sync, older-client saves and explicit removal; included timezone data in the Docker backend and bumped the PWA cache.
- Verified hold-menu behavior and repeat editing at desktop/phone sizes, 16 real PocketBase calendar cases, delivery/access controls, security/MFA, and Base/desktop sync. Live-device push delivery and Docker image builds remain deployment checks.

## v0056 - 2026-11-04
- Added a Sunday–Saturday picker to weekly reminders, supporting one or several selected days at the saved local time from the start date onward.
- Preserved weekday selections through web storage, import/export, desktop sync and older-client updates; retained the original weekday for existing weekly schedules.
- Versioned PWA scripts/styles and revalidated app entrypoints to prevent stale cached reminder modules from being mixed with new controls. Kept menu buttons in place during viewport resizing and focused the reminder heading so phone keyboards/date pickers do not cover the options on entry; added visible failure feedback.
- Verified selected-day scheduling and DST boundaries with real PocketBase, browser touch-hold/tap behavior, stale PWA cache recovery, mobile layout, validation and Base/desktop sync. Physical installed-device behavior and provider delivery still require confirmation on the affected phone.

## v0057 - 2026-11-04
- Added installed-web update checks on opening, foregrounding and reconnecting, plus Settings > App updates > Check for app updates and an Update now banner after a complete download.
- Saved current checklist edits and settings before the requested reload; blocked reload during sync, unfinished reminder/tab edits or failed local saves. Updates retain sign-in, preferences and notification opt-in and leave other open windows alone.
- Generated Docker web versions from runtime contents automatically, stamped scripts/styles/service-worker metadata and served uncached version checks. The Windows-app image inherits the same generated web build.
- Kept versioned cache assets immutable, activated only complete downloads, retained the previous offline shell after failed downloads, and limited cleanup to Checky's own shell caches. API data and desktop downloads bypass the shell cache.
- Added build/cache unit coverage, real browser tests across three deployments and container checks for generated versions; included these checks in image publishing and documented the one-time transition from older installed builds.

## v0058 - 2026-11-05
- Made checking a repeating item complete one occurrence, automatically clearing the visible check and resuming reminders at the next scheduled time; retained permanent completion for one-time items and explicit Mark done.
- Calculated reset timestamps on the server using the saved calendar/timezone, including selected weekdays, DST changes and month/year boundaries. Resets do not write checklist data or bump sync versions in the background.
- Preserved completion metadata across storage, import/export, older clients and sync; applied server reset times without overwriting newer edits, and excluded derived reset times from dirty-state comparisons.
- Made Mark done work with the Done archive disabled and added explanatory reminder text and migration guidance for previously checked items.
- Verified actual browser checks and live resets, permanent completion, server scheduling/delivery/deduplication, calendar boundaries, sync/security and installed-app updates.

## v0059 - 2026-11-05
- Added an optional Baby tracker add-on inside Base, off by default. Enable it in Settings to show it under the selected list's tabs; the account/device preference can hide it again without deleting entries.
- Added a newest-first feeding and diaper log with automatic editable date/time, breast milk and formula amounts in ml or US fluid oz, feeding notes, and separate pee/poop checkboxes and notes. Unit changes preserve the stored ml amount.
- Reused Base sign-in and personal/shared list access with separate PocketBase entry records, version checks for concurrent edits, retry-safe creation, pagination and explicit deletion. Saving needs a connection; failed saves keep the open form.
- Included the add-on in versioned web builds/PWA caching, documented deployment and full-database backups, and added real PocketBase/browser checks to CI. Verified permissions, revocation, persistence, conversion, phone layout, conflicts and offline failure handling.

## v0060 - 2026-11-05
- Removed the “Optional add-on” label above the Baby tracker title. The tracker remains off by default and can be enabled in Settings.

## v0061 - 2026-11-05
- Repackaged Baby tracker as a separately installed extension under `checkys-base/addons/baby-tracker`, following the optional Windows app-hosting image pattern. Standard Base and standalone PocketBase images no longer contain its UI, routes or migration.
- Added optional `latestbaby` web/backend variants and `latestwappbaby` for combined Windows app hosting, a CasaOS installer and a source-build overlay. All variants keep the existing services, database, accounts, sharing and data mount.
- Replaced the built-in enable switch with installed-add-on discovery in list navigation. The link appears only when both the add-on web package and backend are present; tracker assets are versioned separately from the normal PWA cache.
- Verified fresh core installs have no tracker collection, and installing/removing/reinstalling the extension preserves accounts, lists and baby entries in one real database. Updated browser/packaging tests and added standard/optional Docker image checks to publishing. Docker builds still require the CI/Docker host; this machine has no Docker engine.
- Core app-update browser checks passed, but the broader runner currently stops at the Done archive assertion after those checks; that separate regression remains unresolved. Add-on browser/install tests and all eight packaging/auth unit tests passed.

## v0062 - 2026-11-05
- Fixed Base deleting the Done archive when this device's Show Done archive preference was off. Hidden archives now retain their tabs, completed items and IDs through edits, reloads and sync, matching desktop's existing data-preservation behavior.
- Stopped delayed checklist-folder refreshes from reverting newer local settings, which could turn Done off shortly after enabling it.
- Returned to an ordinary checklist when hiding the active archive, preserved the selected checklist when moving the archive to the end, and handled imports containing only an archive. Mark done still completes items in place while archiving is disabled.
- Added and passed a browser regression in the existing PWA suite covering delayed folder responses, a fresh second device with Done hidden, real PocketBase saves/sync, hide/show toggles and archive-only imports. The complete PWA browser suite and web build/cache checks passed, resolving the Done regression noted in v0061.

## v0063 - 2026-11-05
- Grouped Baby tracker entries by month and local calendar day, matching the Done archive's date headings. Newest days and entries appear first, with each entry showing its time.
- Kept the full date in accessible Edit labels and timestamp tooltips. Changing an entry's date moves it to the matching day; loading earlier entries continues existing day groups.
- Verified local midnight/month/year boundaries, date edits, reloads, pagination and phone layout against real PocketBase in Chromium. Existing tracker integration and web build/cache checks passed.

## v0064 - 2026-11-05
- Integrated the optional Baby tracker into the main Checky screen. Baby appears beside Personal and Shared; selecting its lists keeps the normal navigation available, restores the selection on reload and guards unfinished entries when switching views or updating the app.
- Added admin controls to create/rename baby lists and assign or remove existing Checky users. Baby access is independent of ordinary checklist ownership/sharing and is enforced on every backend request; regular users cannot grant themselves access.
- Migrated earlier baby logs into separate `checky_baby_lists`, preserving entry IDs, timestamps, versions and content. Existing logs remain visible to the admin, who explicitly assigns caregivers; ordinary checklist deletions no longer delete baby logs.
- Verified upgrades, permissions, revocation, membership conflicts, integrated admin/caregiver workflows, phone layout and retained day grouping with real PocketBase/Chromium. Web update/Done regressions, build/auth unit checks and actual Caddy framing-header checks passed.

## v0065 - 2026-11-05
- Moved baby-list administration to the PocketBase superuser dashboard: admins create/rename `checky_baby_lists` records and choose caregivers in `members`.
- Removed the in-app management screen, membership/user-directory endpoints and Checky app-admin access bypass. Every app account needs explicit membership; Baby stays integrated beside Personal and Shared with the existing day-grouped log.
- Added a migration that preserves lists/members/entries while removing the retired membership-editor version field. Verified native PocketBase create/rename/assign/revoke with two superusers, denied access for regular and first-user accounts, preserved upgrades and integrated navigation; all tracker integration and eight build/auth unit checks passed.

## v0066 - 2026-11-05
- Hide the Baby navigation category when the signed-in user has no assigned baby lists, matching Shared. It appears after a PocketBase admin assigns a list and disappears when access to the last baby list is removed.

## v0067 - 2026-11-05
- Replaced tab hold-to-delete with a dropdown containing Rename, Move up/down, Always show/remove shortcut and explicit Delete confirmation. Right-click and the keyboard context-menu shortcut open the same menu; dedicated drag handles still reorder tabs.
- Fixed bottom-of-list touch menus by placing them within the visible viewport and flipping above the press when needed. Keyboard/browser resizing and duplicate native context-menu events keep the existing buttons in place, and releasing a hold cannot accidentally activate a menu action.
- Preserved the Done archive when deleting the final ordinary tab. Added browser coverage for tab actions, last-item holds at three phone sizes, gesture cancellation, dragging and archive preservation, and included the shared menu helper in versioned PWA caching.
- Verified the Base/desktop menu regression, complete installed-web update/Done sync suite, three web build/cache checks and five desktop security checks. Physical phone behavior and published deployments/installers remain outside these local checks.

## v0068 - 2026-11-05
- Added Always show / Remove shortcut to Baby list hold, right-click and keyboard menus. Pinned lists stay above collapsed navigation folders, with preferences saved per account in this browser.
- Resolve shortcuts against currently installed, assigned lists so labels follow renames and unavailable lists disappear. Preserved unfinished-entry protection when opening a pinned Baby list.
- Verified touch release, pin/unpin, reload persistence, collapsed folders, renames, access removal and add-on reinstall with real PocketBase/Chromium. The existing Base/desktop menu regressions and three web build/cache checks also passed.

desktop:

## v0001 - 2026-04-07
- Removed archive checkboxes from the desktop client surfaces.

## v0002 - 2026-04-08
- Updated desktop PocketBase sync to support separate personal and shared checklist collections.
- Added collection-aware checklist references and assigned shared checklist resolution for desktop sync.

## v0003 - 2026-04-08
- Renamed the desktop app branding to `Checky's List`, switched the tracked project folder to `checkys-app`, and updated the Windows packaging identifiers and artifact naming to the new scheme.

## v0004 - 2026-04-08
- Renamed the desktop packaging output folder from `checky-package` to `checkys-package` so future packaged builds follow the `checkys-*` naming scheme too.

## v0005 - 2026-04-08
- Reset the desktop package version to `1.0.0` for the Checky's List Windows build and kept the packaged artifact naming on the `checkys-list-*` scheme.

## v0006 - 2026-04-08
- Restored Electron single-instance locking so launching Checky's List again now focuses the existing desktop window instead of opening a second app instance.

## v0007 - 2026-07-16
- Prevented manual sync conflicts from pulling an older server checklist over unsent local tasks.
- Refreshed active PocketBase sessions during normal sync operations so connected desktops do not silently age out after several days.

## v0008 - 2026-07-16
- Preserved stable tab and task IDs in the desktop client so it remains compatible with PWA merge metadata.

## v0009 - 2026-07-18
- Added a confirmation preview that safely merges only newly created offline desktop tasks into a newer server checklist.
- Added a manual desktop update checker that reads release information and opens downloads from the connected Checky Base server.
- Updated desktop documentation to describe its current hosted sync and update behavior.

## v0010 - 2026-07-18
- Upgraded the Base-backed desktop updater to download installers inside Electron, enforce same-origin hosting and a 500 MB limit, verify SHA-256, launch the verified Windows installer, and close the app for installation.
- Verified that the updater-enabled desktop application packages successfully as both NSIS and MSI.

## v0011 - 2026-07-18
- Added quiet desktop update checks at startup and whenever the window is opened, without periodic background polling.
- Kept an explicit `Check for updates` button in Settings for immediate on-demand checks.
- Added a compact top-right `Update` button that appears only when the connected Base server advertises a newer desktop version and reuses the verified installer flow.

## v0012 - 2026-07-19
- Bumped the Windows desktop application version to `1.0.1` for the new packaged installer.

## v0013 - 2026-07-22
- Saved checkbox toggles immediately to keep desktop behavior compatible with the corrected Base sync flow.

## v0014 - 2026-07-22
- Bumped the Windows desktop application to `1.0.2` and built fresh NSIS and MSI installers.

## v0015 - 2026-07-22
- Fixed desktop update installation when Electron omits the final response URL, while preserving the same-origin redirect check against the already validated Base installer URL.
- Rebuilt the Windows NSIS and MSI `1.0.2` installers with the corrected updater flow.

## v0016 - 2026-07-22
- Packaged the desktop instructions README with installed builds and fixed the Instructions button to open that deployed resource.
- Bumped the Windows desktop application to `1.0.3` for the corrected instructions build.

## v0017 - 2026-07-23
- Made the desktop Connect action clear stale saved authentication and checklist-selection state before signing in again, so reconnecting no longer requires a separate Disconnect step.

## v0018 - 2026-07-23
- Required a successful authenticated Checky Base user request before desktop update manifests can be checked or installers downloaded.
- Made checklist backup restore automatically re-enable the Done archive when the restored backup contains completed items.

## v0019 - 2026-07-23
- Bumped the Windows desktop application to `1.0.4` and built fresh NSIS EXE and MSI installers containing the reconnect, authenticated-update, and Done-archive restore fixes.

## v0020 - 2026-07-23
- Routed Connect through one protected reconnect path so a pending checklist selection cannot bypass the fresh authentication reset.
- Added an explicit confirmation before Connect clears sync state when local checklist changes have not reached Checky Base.

## v0021 - 2026-07-23
- Rebuilt the Windows desktop `1.0.4` NSIS EXE and MSI installers so they include the protected Connect flow and unsynced-work warning.

## v0022 - 2026-07-23
- Restricted checklist backup restore to existing JSON files returned by the desktop backup list, blocking invalid names and paths outside the backup folder.
- Rebuilt the Windows desktop 1.0.4 NSIS EXE and MSI installers with the backup restore protection.

## v0023 - 2026-07-23
- Made sync infer unsynced local edits from the last-synced checklist snapshot when the dirty flag is stale.
- Kept the successfully pushed local checklist on screen instead of immediately pulling an older server copy over freshly edited task text.
## v0024 - 2026-07-24
- Bumped the Windows desktop application to `1.0.5` and built fresh NSIS EXE and MSI installers containing the sync-versioning fix.

## v0025 - 2026-08-06
- Reconnected desktop sync automatically at app startup by refreshing the saved Checky Base session and reopening the previously selected checklist.
- Kept the cached checklist open when refresh cannot reach the server and added a clear connection-loss popup for user-requested refreshes.

## v0026 - 2026-08-06
- Bumped the Windows desktop application to `1.0.6` for the startup reconnect and connection-loss notification build.

## v0027 - 2026-10-30
- Moved the connected checklist picker from Advanced settings to a folder dropdown above the tabs, matching Base's Personal and Shared groups and direct opening behavior.
- Loaded checklist choices after successful syncs and preserved the current checklist when switching or refreshing fails.

## v0028 - 2026-10-30
- Updated Electron to 45.2.1 and electron-builder to 26.18.0, pinned patched transitive build dependencies, and bumped the desktop release to 1.0.7. npm audit reports zero known vulnerabilities.
- Added native PocketBase MFA verification-code prompts using the same authentication flow as Base.
- Required a pinned Ed25519 release signature, HTTPS, same-origin installers, bounded response sizes, and matching SHA-256 before launching automatic updates; rejected redirects and unsigned metadata.
- Built Windows EXE/MSI installers and verified personal/shared sync, device overrides, assignment changes, and protection against stale writes with the real client sync implementations.

## v0029 - 2026-10-30
- Matched Base's independently collapsible Personal and Shared folders, preserving expansion choices through refreshes and checklist switches and supporting keyboard activation.

## v0030 - 2026-10-30
- Matched Base's tab-colored Personal and Shared folder navigation with nested tabs, folder reordering, and Edit > Always show for persistent shortcuts above collapsed folders.
- Preserved tab dragging across the folder and always-shown areas, and kept tab editing open while interacting with its Always show checkbox.

## v0031 - 2026-10-30
- Included the desktop icon and NSIS installer source in the public source package so a fresh checkout can build installers; kept generated binaries and private signing keys excluded.

## v0032 - 2026-10-31
- Bumped the Windows desktop release to 1.0.8 and rebuilt EXE/MSI installers to include the later folder navigation and tab changes that were absent from the earlier 1.0.7 package.
- Retained the existing signed HTTPS updater and personal/shared Base sync protocol.

## v0033 - 2026-11-04
- Preserved event reminder timestamps through desktop normalization, storage and sync so desktop edits do not remove reminders created in Base; verified real Base/desktop round trips. Native desktop reminder controls and the public release version are unchanged.

## v0034 - 2026-11-04
- Preserved reminder repeat frequency and timezone in desktop normalization, local storage and sync; verified round trips with Base without adding desktop notification controls or changing the public release version.

## v0035 - 2026-11-04
- Preserved selected reminder weekdays in desktop normalization, storage and Base sync; verified round trips without changing the desktop public release version.

## v0036 - 2026-11-05
- Kept repeating-item completion timestamps through desktop storage/sync and added source support for checking one occurrence, displaying its scheduled reset, and permanent Mark done with or without the archive. The public desktop installer version is unchanged.
- Applied server reset metadata to the open window without overwriting newer edits; ignored derived reset times when checking for unsynced changes.

## v0037 - 2026-11-05
- Added the same tab hold/right-click menu as Base, including rename, reordering, shortcut toggling and confirmed deletion. Deleting the final ordinary tab now preserves the Done archive.
- Shared Base's press-release protection and viewport-aware menu placement; resizing no longer rebuilds menu buttons. Verified the desktop renderer's menu interactions in Chromium; the packaged desktop version/installers are unchanged.

pocketbase:

## v0001 - 2026-04-08
- Added hosted checklist size settings storage through the `checky_base_settings` collection.

## v0002 - 2026-04-08
- Split hosted storage settings into `perUserChecklistSizePreset` and `databaseChecklistSizePreset`.
- Kept legacy preset fallback handling for older installs.

## v0003 - 2026-04-08
- Separated personal and shared checklist storage between `checklists` and `shared_checklists`.
- Added `users.assignedSharedChecklist` for shared checklist assignment.

## v0004 - 2026-04-08
- Enforced Checky checklist JSON validation plus per-user and total hosted checklist size limits in PocketBase hooks.
- Added the shared-checklist access sync hook and updated PocketBase backend docs for the new model.

## v0005 - 2026-04-08
- Added a repair migration to backfill `perUserChecklistSizePreset` and `databaseChecklistSizePreset` when a PocketBase install still only has the legacy `checklistSizePreset` field.

## v0006 - 2026-04-08
- Added hosted session cookie routes and cookie-backed auth loading for `checkys-base` so hosted web requests can authenticate without browser-stored PocketBase tokens.

## v0007 - 2026-04-08
- Added persistent hosted login guard storage and progressive failed-sign-in backoff handling with 1, 5, 10, 30, and 60 minute waits.

## v0008 - 2026-04-08
- Hardened hosted session cookie auth middleware path detection so signed-in browser requests are recognized more reliably across request URL shapes.

## v0009 - 2026-04-08
- Fixed hosted session cookie reads in the PocketBase hook to use the request cookie API so sign-in confirmation can see the browser session.

## v0010 - 2026-04-08
- Replaced hosted browser cookies that stored raw PocketBase auth tokens with opaque server-backed sessions in `checky_base_sessions`.
- Added explicit hosted session expiry, `SameSite=Lax` cookies, session refresh, logout revocation, and legacy-cookie migration into the new session store.

## v0011 - 2026-04-08
- Fixed hosted session request-state caching to use PocketBase's request store instead of attaching custom properties to the request event, which was breaking hosted session routes.

## v0012 - 2026-04-08
- Hardened hosted session routes to return normal JSON failures instead of generic PocketBase 400 errors when hosted session state breaks.
- Added runtime self-healing for missing `checky_base_login_guards` and `checky_base_sessions` collections so hosted sign-in can recover more gracefully after partial deploys.

## v0013 - 2026-04-08
- Reworked hosted auth middleware and hosted session routes to use self-contained PocketBase callbacks after the route runtime failed to resolve outer helper bindings.
- Fixed hosted `/api/checkys-base/session`, `/session/login`, and `/session/logout` to return normal JSON responses instead of crashing with generic `400` errors.

## v0014 - 2026-04-08
- Exempted loopback localhost IPs from the hosted login IP backoff key so local hosted testing does not lock out every retry on the same machine.

## v0015 - 2026-04-08
- Disabled hosted login throttling for loopback or localhost-hosted clients so local sign-in testing is not blocked by stale identity backoff entries during development.

## v0016 - 2026-04-08
- Changed hosted login throttling so the first three failed sign-in attempts return a normal incorrect-password message and timeout backoff starts on the fourth failure.

## v0017 - 2026-04-08
- Removed the hosted login throttle bypass based on localhost host headers so public `checkys-base` deployments always enforce login backoff.

## v0018 - 2026-04-08
- Locked `users.assignedSharedChecklist` against self-service updates so shared checklist assignment stays admin-controlled while personal checklist creation remains automatic.

## v0019 - 2026-04-08
- Blocked normal users from creating extra shared checklists and limited direct personal checklist creation to the single automatic personal record bootstrap case.
- Updated shared checklist assignment syncing so moving or clearing an assigned shared checklist removes the prior assignment-driven access entry.

## v0020 - 2026-04-08
- Refactored PocketBase checklist/user hooks to use self-contained runtime callbacks after helper-scope failures were breaking user bootstrap and shared-access sync.
- Fixed shared checklist assignment updates to read the previous user record with `originalCopy()`.
- Normalized checklist payload validation so request-time JSON values can be validated when PocketBase exposes them as objects, strings, or byte arrays.

## v0021 - 2026-04-08
- Removed the unused hosted `/api/checkys-base/setup` route after the web client switched to the session endpoint for setup state.
- Deleted the dead top-level hosted-session helper block from the PocketBase bridge hook and documented why the remaining session helpers stay route-local in PocketBase JSVM.

## v0022 - 2026-04-08
- Restored hosted session refresh on active requests by extending `expiresAt`, updating `lastSeenAt`, and reissuing the session cookie when a hosted session nears expiry.
- Replaced the duplicated hosted checklist size hook with one shared validation path and a UTF-8-safe byte-array decoder so larger valid payloads no longer fail before the configured size limits.

## v0023 - 2026-04-08
- Renamed the hosted PocketBase bridge hook and public hosted route namespace to `checkys-base` so the backend matches the new app and folder naming scheme.

## v0024 - 2026-04-09
- Replaced the hosted checklist size guard request hooks with self-contained PocketBase middleware after JSVM hook rejections were returning silent `200` no-op writes instead of normal API validation errors.
- Restored explicit `400` JSON validation failures for invalid or oversized checklist writes while keeping normal user, personal checklist, and shared checklist writes working.

## v0025 - 2026-04-09
- Added a private `checky_base_admins` app-admin collection so the first hosted user becomes the hosted app admin without relying on a mutable `users` auth field.
- Updated hosted session, hosted login, first-user bootstrap, and shared-checklist create checks to use the new app-admin assignment.
- Narrowed the hosted checklist-size middleware so it no longer rewrites unrelated user-management request failures into checklist validation errors.

## v0026 - 2026-04-09
- Changed the hosted first-user bootstrap to create the first PocketBase `_superusers` account with the same starting email and password as the first hosted app user.
- Updated hosted setup detection so the first-user screen is driven by the Checky Base app-admin assignment.

## v0027 - 2026-04-09
- Removed the CasaOS-specific PocketBase Docker Compose files, CasaOS compose metadata, and CasaOS setup docs.
- Fixed the hosted bootstrap override so `_superusers` records no longer suppress the first-user Checky Base admin bootstrap.
- Made the first-user bootstrap app-admin assignment prefer the newly created hosted user so the starting Checky Base admin and PocketBase superuser stay aligned.

## v0028 - 2026-07-23
- Enabled PocketBase's built-in rate limiter while preserving administrator-defined rules and adding missing standard limits for authentication, record creation, batch requests, and general API traffic.

## v0029 - 2026-07-23
- Stopped hosted authentication and first-user routes from returning internal PocketBase exception details to public clients.


## v0030 - 2026-10-30
- Updated the standalone image to PocketBase 0.41.1 and Alpine 3.24.3, and bound its direct port to loopback by default.
- Mirrored Base's native-auth cookie bridge, credential/policy session revocation, transactional checklist quotas, shared-access revocation, schema repair, and standard rate-limit migration.
- Verified an isolated 0.36.8-to-0.41.1 upgrade retains personal/shared checklist JSON, versions, assignments, and authentication; retained backup-and-restore rollback guidance.

## v0031 - 2026-10-30
- Made the standalone and canonical PocketBase Dockerfiles select the correct AMD64 or ARM64 binary and added build-context allowlists to exclude runtime data and unrelated files.

## v0032 - 2026-10-30
- Mirrored Base's optional fixed public-origin session validation and Secure-cookie handling for HTTPS tunnels, with Compose environment configuration and standalone deployment guidance.

## v0033 - 2026-11-04
- Mirrored persistent Docker public-origin configuration, locked push-subscription/delivery collections, account-aware reminder scheduling and the private Web Push transport from Base.
- Included persistent signing keys in the existing data-directory backup model and documented standalone Docker/binary startup for notifications.

## v0034 - 2026-11-04
- Mirrored timezone-aware daily/weekly/monthly/yearly reminder scheduling, original-date month-end handling and preservation of repeat fields omitted by older clients.
- Added Docker timezone data and documented calendar-repeat behavior and cancellation.

## v0035 - 2026-11-04
- Mirrored selected-weekday recurrence, saved-timezone/DST behavior, legacy weekly fallback and preservation of weekdays omitted by older clients; documented the weekday field.

## v0036 - 2026-11-05
- Mirrored per-occurrence checkbox completion, authoritative next-occurrence timestamps, backward-compatible completion preservation and recurring delivery after a checked occurrence, without background checklist version changes.

## v0037 - 2026-11-05
- Mirrored the Baby tracker collection migration and authenticated add-on routes from Base. Personal/shared permissions are checked through the existing parent checklist rules; direct collection access is locked.
- Kept baby logs outside checklist JSON so older clients and ordinary checklist imports/resets do not overwrite them. Added per-entry conflict checks, retry-safe creation, bounded notes/amount validation and stable log pagination; documented full-data backup coverage.

## v0038 - 2026-11-05
- Removed Baby tracker code/migration from the default standalone backend. The separately installed Base add-on package can extend that backend image while reusing its current database and accounts.
- Documented that removing extension code retains existing log records, and that a full database backup includes add-on data.

## v0039 - 2026-11-05
- Updated standalone backend add-on guidance for independent, admin-assigned baby lists and the migration of existing logs. The standard standalone backend still excludes Baby tracker code; optional installs retain the same database and accounts.

## v0040 - 2026-11-05
- Clarified that PocketBase superusers administer the optional Baby tracker through `checky_baby_lists.members`; Checky app-admin status grants no automatic baby access. Existing explicit assignments and database entries are retained.
