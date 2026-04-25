# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**JaviSVN** is a desktop SVN client for macOS and Windows, inspired by GitHub Desktop. It wraps the SVN CLI in an Electron + React UI.

---

## Commands

```bash
# Development (also bundles SVN on first run)
./start.sh
npm run dev

# TypeScript validation (required — root tsconfig uses project references)
npx tsc -p tsconfig.web.json --noEmit
npx tsc -p tsconfig.node.json --noEmit

# Build and package
npm run build        # bundle SVN + electron-vite build
npm run dist         # build + electron-builder
npm run release      # build + publish to GitHub Releases
```

> Never set `ELECTRON_RUN_AS_NODE` when starting the app. `./start.sh` unsets it automatically.

---

## Architecture

### Three-process Electron model

- **Main** (`src/main/index.ts`) — All SVN CLI invocations, file I/O, config store, and IPC handlers live here. It is a single large file (~2000+ lines) organized by IPC channel groups.
- **Preload** (`src/preload/index.ts`) — Exposes two APIs via `contextBridge`: `window.svn` (all IPC wrappers) and `window.appUpdate` (update state). No business logic.
- **Renderer** (`src/renderer/src/`) — React 18 SPA. `App.tsx` holds global state (credentials, selected repo, changes, toasts) and passes data down to view components. Types are in `types/svn.ts`.

### SVN CLI abstraction: `runSvn()`

Every SVN operation goes through `runSvn(args, options?)` in `src/main/index.ts`. It is the only place that spawns the SVN binary. Key behaviors:

- Injects `--username`/`--password` from stored credentials unless `skipAuth: true`.
- Sets `OPENSSL_CONF` to a legacy TLS config by default for compatibility with old internal servers. Tries legacy first, falls back to standard TLS on certain errors.
- Sets `LANG=en_US.UTF-8` and extends `PATH` with common SVN install locations.
- Supports `onData`/`onErrorData` callbacks for streaming output (checkout, update, export progress).
- **Never call `spawn('svn', ...)` directly** — always use `runSvn()` so auth, TLS, and env are consistent.

### Config store

Configuration is a simple JSON file at `app.getPath('userData')/javisvn-config.json` (not `electron-store`). Passwords are encrypted with `safeStorage` when available. The store holds credentials, saved remote servers, and the active server URL.

### Remote search architecture

`svn:searchRemote` performs a recursive remote listing, then optionally searches file contents and revision comments. It streams results back to the renderer via `mainWindow.webContents.send('svn:searchResult', ...)` rather than returning a single large payload. The renderer registers listeners with `window.svn.onSearchResult()` etc.

### URL normalization is load-bearing

Tree navigation, local-checkout detection, and search result linking all depend on consistent URL formats. The main normalization functions are in `src/main/index.ts`:

- `normalizeRepoUrl()` — trims trailing slashes
- `normalizeSvnRepoPath()` — ensures leading `/`, no trailing `/`
- `getRepoPathFromSvnUrl()` — extracts repo-scoped path from full URL

Inconsistent URLs are a common cause of "search result doesn't navigate to tree node" bugs.

### Local repo detection

The `✓ Local` badge in the explorer is computed from the **actual checkout URL** (`svn info --xml`), not folder names. A URL-to-path cache (`localRepoUrlIndexCache`) avoids repeated `svn info` calls; it is invalidated after checkout/update/delete.

---

## Critical technical constraints

1. **ESM required** — `package.json` has `"type": "module"`. Breaking this causes Electron to resolve `electron` as a binary path instead of the module.
2. **`fixCjsShimPlugin`** in `electron.vite.config.ts` — `electron-vite` generates an invalid default import from `node:module` on Electron 32. The plugin rewrites it to a namespace import.
3. **`xml2js` via `createRequire`** — `xml2js` is still CommonJS. In ESM main:
   ```ts
   const _require = createRequire(import.meta.url)
   const xml2js = _require('xml2js')
   ```
4. **SVN bundle is versioned** — `resources/bin/` and `resources/lib/` are committed. macOS copies from Homebrew; Windows uses SlikSVN/TortoiseSVN if `JAVISVN_ALLOW_SYSTEM_SVN_FOR_BUNDLE=1` is set.
5. **TypeScript project references** — The root `tsconfig.json` only references `tsconfig.node.json` (main/preload) and `tsconfig.web.json` (renderer). Running `npx tsc --noEmit` at the root will not catch errors in the referenced projects.

---

## Release workflow

Automated via `.github/workflows/release.yml` on tags matching `v*`:

1. Bump `version` in `package.json` and `package-lock.json`.
2. Commit, push to `main`.
3. Create and push a matching tag:
   ```bash
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```
4. GitHub Actions builds on `macos-latest` (dmg + zip) and `windows-latest` (nsis x64), then publishes to GitHub Releases.

Fallback manual:
```bash
npm run dist
gh release create vX.Y.Z dist/* --title "JaviSVN vX.Y.Z"
```

---

## Known issues

| Problem | Cause | Fix |
|---|---|---|
| Electron won't start or imports fail | `ELECTRON_RUN_AS_NODE=1` | Use `./start.sh` or unset the variable |
| `svn --version` fails in UI | Auth flags incompatible with `--version` | Keep `skipAuth: true` in the `svn:version` handler |
| Remote search fails on legacy servers | Missing `OPENSSL_CONF` or bypassing `runSvn()` | Route new SVN ops through `runSvn()` |
| Search results don't navigate tree | `entryUrl` inconsistent with tree node URLs | Ensure `svn:searchRemote` returns normalized URLs |
| `npx tsc --noEmit` is clean but real errors exist | Root tsconfig only references sub-projects | Always validate `tsconfig.web.json` and `tsconfig.node.json` separately |

---

## Development notes

- Local repos live at `~/Documents/JaviSvn/` (macOS) or `%USERPROFILE%\Documents\JaviSvn\` (Windows).
- On commit, unversioned selected files are auto-added with `svn add --force --parents` before `svn commit`.
- Remote log entries may reference paths outside the current scope; the UI dims these with a `Fuera` badge.
- There are no SVN branches in the Git sense — the target server typically uses a folder hierarchy.
