# Licensing Notes

## Third-Party Software

Checky's List currently uses a permissive stack for its main direct dependencies:

- Capacitor: `MIT`
- `serve`: `MIT`
- Electron: `MIT`
- `electron-builder`: `MIT`
- PocketBase: `MIT`
- Caddy: `Apache-2.0`

That means the current stack does not appear to require a paid commercial runtime or database license for normal use. See `THIRD_PARTY_LICENSES.md` for the project-level dependency summary.

## Checky's List Source License Status

There is not currently a repo-wide top-level `LICENSE` file in this repository.

That means:

- third-party dependencies have their own licenses
- the Checky's List source code itself does not yet have a single declared public reuse license at the repo root
- until a root project license is added, others should not assume they may copy, redistribute, or modify the full repo beyond what applicable law allows

## Important Detail

`checkys-app/package.json` currently declares `MIT`, but that package metadata does not automatically replace a clear top-level repository license for the whole project.

If you want Checky's List to be publicly reusable, the next step is to choose and add a root `LICENSE` file for the project itself.


