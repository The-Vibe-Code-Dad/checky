# Third-Party Licenses

Checky's List current stack does not require a paid runtime or database license for normal use, but it does rely on open-source software that carries notice and attribution obligations when you distribute the app, installers, or hosted images.

This file is a practical inventory of the main direct dependencies and runtime components currently used in this repo.

## Main Dependencies

| Component | Used In | Version | License |
| --- | --- | --- | --- |
| `electron` | `checkys-app/` | `45.2.1` | `MIT` |
| `electron-builder` | `checkys-app/` packaging | `26.18.0` | `MIT` |
| PocketBase | `checkys-base/` and `pocketbase/` | `0.41.1` | `MIT` |
| Caddy | `checkys-base/` web image | `2.11.7-alpine` | `Apache-2.0` |
| `web-push` | Base and standalone PocketBase notification transport | `3.6.7` | `MIT` |
| Node.js | PocketBase image, private notification transport | Alpine `nodejs` package | `MIT` and bundled third-party notices |

## Practical Use Notes

- You do not need to buy a separate commercial license for the current desktop, PocketBase, or Caddy stack just to run or distribute Checky's List.
- If you distribute Checky's List installers, APKs, containers, or a hosted appliance image, keep the relevant upstream license notices available to users.
- If you publish customer-facing binaries or images, it is a good idea to ship this file alongside them so the major runtime dependencies are disclosed in one place.
- This file is a summary, not a substitute for the upstream license texts.

## Where These Values Came From

- Electron and `electron-builder` versions/licenses were read from the installed package metadata in `checkys-app/node_modules/`.
- PocketBase version comes from `checkys-base/.env.example` and `checkys-base/docker-compose.yml`.
- Caddy comes from `checkys-base/web.Dockerfile`.
- The Web Push dependency and its transitive package licenses are recorded in `checkys-base/pocketbase/push/package-lock.json` and mirrored under `pocketbase/push/`. Their upstream license files remain in the installed image dependencies.
