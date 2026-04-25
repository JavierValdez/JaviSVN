# JaviSVN — AGENTS.md

Guía de referencia para Codex al trabajar en este proyecto.

---

## Descripción del proyecto

**JaviSVN** es un cliente de escritorio SVN para macOS y Windows inspirado en GitHub Desktop.

Capacidades principales:

- explorar repositorios SVN remotos antes de hacer checkout
- buscar por nombre, contenido y comentarios de revisión
- navegar desde un resultado de búsqueda hasta la rama encontrada en el árbol
- revisar historial local y remoto con diff por archivo
- hacer checkout, export, commit, revert, blame y resolución de conflictos
- descargar archivos remotos y abrir repos en editor externo
- consultar actualizaciones desde GitHub Releases

Stack actual:

- **Electron 32**
- **electron-vite 5**
- **React 18 + TypeScript**
- **ESM obligatorio**
- **SVN CLI** invocado con `child_process.spawn`

Rutas importantes:

- **Repos locales**: `~/Documents/JaviSvn/`
- **Config**: `~/Library/Application Support/javisvn/javisvn-config.json`
- **Workflow de release**: `.github/workflows/release.yml`

---

## Comandos esenciales

```bash
# Desarrollo
./start.sh
npm run dev

# Build local
npm run build
npm run dist

# Publicación local manual a GitHub Releases
npm run release

# Validación TypeScript correcta
npx tsc -p tsconfig.web.json --noEmit
npx tsc -p tsconfig.node.json --noEmit
```

> `npx tsc --noEmit` no valida correctamente los subproyectos referenciados; usa los dos comandos anteriores.

> `ELECTRON_RUN_AS_NODE` nunca debe estar seteado al arrancar la app.

---

## Arquitectura de archivos

```text
JaviSVN/
├── AGENTS.md
├── CLAUDE.md
├── README.md
├── package.json
├── electron.vite.config.ts
├── tsconfig.json / tsconfig.node.json / tsconfig.web.json
├── start.sh
├── resources/
│   ├── bin/                     # Bundle SVN Windows + binario macOS generado
│   ├── lib/                     # dylibs macOS para SVN bundleado
│   ├── icon.icns / icon.ico
│   └── LEER_ANTES_DE_ABRIR.txt
├── scripts/
│   ├── bundle-svn.mjs
│   ├── bundle-svn.sh
│   └── bundle-svn.ps1
└── src/
    ├── main/
    │   ├── index.ts             # IPC principal, búsquedas, checkout, log, blame, conflictos
    │   └── updater.ts           # Estado de actualización basado en GitHub Releases
    ├── preload/
    │   └── index.ts             # window.svn y window.appUpdate
    └── renderer/src/
        ├── App.tsx
        ├── App.css
        ├── types/svn.ts
        └── components/
            ├── Sidebar.tsx
            ├── ExplorerView.tsx
            ├── ChangesView.tsx
            ├── HistoryView.tsx
            ├── DiffViewer.tsx
            ├── BlameView.tsx
            ├── ConflictResolver.tsx
            └── AuthDialog.tsx
```

---

## Decisiones técnicas críticas

### 1. ESM obligatorio

El proceso main usa ESM. Si se rompe `"type": "module"`, Electron puede resolver `electron` como ruta binaria en lugar del módulo.

### 2. `fixCjsShimPlugin`

`electron-vite` genera un import inválido a `node:module` en Electron 32. El plugin en `electron.vite.config.ts` lo corrige.

### 3. `xml2js` via `createRequire`

`xml2js` sigue siendo CommonJS. En `main` debe usarse:

```ts
const _require = createRequire(import.meta.url)
const xml2js = _require('xml2js')
```

### 4. Store JSON propio

No se usa `electron-store` para persistencia de configuración operativa. La app guarda JSON simple en `userData/javisvn-config.json`.

### 5. Bundle SVN por plataforma

- macOS: `scripts/bundle-svn.sh` copia `svn` y sus `dylib` desde Homebrew a `resources/bin` y `resources/lib`
- Windows: `scripts/bundle-svn.ps1` valida el bundle interno y, si `JAVISVN_ALLOW_SYSTEM_SVN_FOR_BUNDLE=1`, puede regenerarlo desde SlikSVN/TortoiseSVN

### 6. Compatibilidad TLS legacy

Los comandos SVN pasan por `runSvn()`, que puede inyectar `OPENSSL_CONF` para servidores internos antiguos. Si agregas nuevas operaciones SVN, no llames `spawn` directo salvo que repliques ese entorno.

### 7. Detección de checkouts locales por URL

El badge `✓ Local` ya no se basa en nombres de carpeta sino en la URL real de `svn info`, para evitar falsos positivos.

---

## IPC API expuesta en `window.svn`

### Credenciales y remotos

| Canal | Argumentos | Descripción |
|---|---|---|
| `creds:get` | — | Credenciales guardadas |
| `creds:set` | `{ username, password, serverUrl }` | Guarda credenciales |
| `creds:clear` | — | Limpia credenciales |
| `creds:getServerUrl` | — | URL activa |
| `creds:setServerUrl` | `serverUrl` | Cambia URL activa |
| `remotes:list` | — | Lista remotos guardados |
| `remotes:save` | `{ name, url }` | Guarda remoto |
| `remotes:select` | `remoteId` | Activa remoto |
| `remotes:delete` | `remoteId` | Elimina remoto |
| `remotes:rename` | `remoteId, name, url?` | Renombra o corrige URL |

### Repos locales

| Canal | Argumentos | Descripción |
|---|---|---|
| `repos:list` | — | Repos SVN locales |
| `repos:basePath` | — | Ruta base local |
| `repos:delete` | `repoPath` | Elimina working copy |

### Exploración remota

| Canal | Argumentos | Descripción |
|---|---|---|
| `svn:list` | `url` | Lista árbol remoto |
| `svn:searchRemote` | `url, query, deepSearch` | Búsqueda remota por nombre/contenido/comentario |
| `svn:remoteLog` | `url, limit?` | Historial remoto |
| `svn:cat` | `url` | Contenido remoto |
| `svn:getRepoRoot` | `url` | Root URL SVN |
| `svn:remoteRevisionDiff` | `baseUrl, svnPath, revision` | Diff remoto por revisión |
| `svn:remoteMkdir` | `parentUrl, name, message?` | Crea carpeta remota |
| `svn:remoteCreateFile` | `parentUrl, name, content?, message?` | Crea archivo remoto |
| `svn:export` | `url, targetPath` | Exporta carpeta remota |
| `svn:downloadFile` | `url, defaultName` | Descarga archivo remoto |
| `dialog:pickExportFolder` | — | Selector de carpeta destino |

### Operaciones locales SVN

| Canal | Argumentos | Descripción |
|---|---|---|
| `svn:checkout` | `url, targetName` | Checkout local seguro |
| `svn:update` | `repoPath` | Update con progreso |
| `svn:status` | `repoPath` | Estado XML normalizado |
| `svn:diff` | `repoPath, filePath` | Diff local |
| `svn:fileContent` | `repoPath, filePath` | Preview local |
| `svn:getConflictContent` | `repoPath, filePath` | Carga `.mine` / `.r*` |
| `svn:revisionFileDiff` | `repoPath, revision, svnPath` | Diff por revisión local |
| `svn:blame` | `repoPath, filePath` | Blame XML normalizado |
| `svn:commit` | `repoPath, files, message` | Commit con `svn add --force` previo si hace falta |
| `svn:revert` | `repoPath, files` | Revert recursivo |
| `svn:resolve` | `repoPath, filePath, accept` | Resolve (`mine-full`, `theirs-full`, `working`) |
| `svn:log` | `repoPath, limit?, fromRevision?` | Historial local |
| `svn:info` | `path` | `svn info --xml` normalizado |

### Diálogo / sistema / diagnóstico

| Canal | Argumentos | Descripción |
|---|---|---|
| `dialog:openFile` | `repoPath, filePath` | Abre archivo |
| `dialog:openFolder` | `path` | Abre carpeta |
| `dialog:listEditors` | — | Lista editores soportados |
| `dialog:openInEditor` | `editorId, repoPath` | Abre repo en editor |
| `svn:ping` | `url` | Ping usando credenciales guardadas |
| `svn:pingWithCreds` | `{ url, username, password }` | Ping con credenciales temporales |
| `svn:version` | — | Versión SVN |
| `svn:getBinPath` | — | Binario actual/configurado |
| `svn:setBinPath` | `binPath` | Override de binario |
| `svn:install` | — | Instalación guiada en macOS |

### Eventos push

- `svn:checkout-progress`
- `svn:update-progress`
- `svn:install-progress`
- `svn:searchResult`
- `svn:searchProgress`
- `svn:searchDone`
- `svn:export-progress`
- `appUpdate:state`

### `window.appUpdate`

API separada:

- `appUpdate.getState()`
- `appUpdate.check()`
- `appUpdate.download()`
- `appUpdate.onState(cb)`

---

## Release y despliegue

### Flujo automático actual

El despliegue ahora se hace por tag con `.github/workflows/release.yml`.

1. Actualiza `version` en `package.json` y `package-lock.json`.
2. Commit y push a `main`.
3. Crea un tag `vX.Y.Z` que coincida exactamente con `package.json`.
4. Haz push del tag.

```bash
git push origin main
git tag vX.Y.Z
git push origin vX.Y.Z
```

5. La workflow `Release` corre una matriz:
   - `macos-latest` con `brew install subversion` y `electron-builder --mac dmg zip`
   - `windows-latest` con `choco install sliksvn` y `electron-builder --win nsis --x64`
6. El job ejecuta `npm run release -- ...`, que publica a GitHub Releases usando `GH_TOKEN`.

Secrets opcionales:

- `CSC_LINK`
- `CSC_KEY_PASSWORD`
- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_TEAM_ID`

### Fallback manual

Si GitHub Actions falla o no está disponible:

```bash
npm run dist
gh release create vX.Y.Z dist/* --title "JaviSVN vX.Y.Z"
```

---

## Errores conocidos y recordatorios

| Problema | Causa habitual | Acción |
|---|---|---|
| Electron no abre o importa mal | `ELECTRON_RUN_AS_NODE=1` | usar `./start.sh` o limpiar variable |
| `svn --version` falla en UI | flags de auth incompatibles | mantener `skipAuth: true` en `svn:version` |
| búsqueda remota falla en servers legacy | no pasar por `runSvn()` o faltar `OPENSSL_CONF` | reutilizar `runSvn()` |
| resultados de búsqueda no navegan árbol | `entryUrl` inconsistente | mantener URLs normalizadas desde `svn:searchRemote` |
| `npx tsc --noEmit` sale limpio pero hay errores reales | tsconfig raíz usa `references` | validar `tsconfig.web.json` y `tsconfig.node.json` |

---

## Notas de desarrollo

- No hay ramas SVN tipo Git; el servidor objetivo normalmente usa una jerarquía de carpetas.
- Las credenciales se guardan localmente y el password puede cifrarse con `safeStorage` cuando está disponible.
- `resources/bin/` y `resources/lib/` están versionados en este repo; no documentes lo contrario.
- Al hacer commit, los archivos sin versionar seleccionados se agregan automáticamente con `svn add --force --parents`.
- El historial remoto puede mostrar cambios fuera del scope consultado; la UI los atenúa con badge `Fuera`.
