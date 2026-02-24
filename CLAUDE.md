# JaviSVN — CLAUDE.md

Guía de referencia para el agente Claude Code al trabajar en este proyecto.

---

## Descripción del proyecto

**JaviSVN** es un cliente de escritorio SVN para macOS inspirado en GitHub Desktop. Permite explorar repositorios SVN remotos, clonarlos localmente, ver cambios, hacer commits y revisar el historial, todo sin necesidad de línea de comandos.

- **Stack**: Electron 32 + electron-vite 5 + React 18 + TypeScript (ESM)
- **Backend SVN**: CLI de Subversion (`/opt/homebrew/bin/svn`) invocado via `child_process.spawn`
- **Comunicación**: IPC Electron (`ipcMain.handle` / `ipcRenderer.invoke` vía `contextBridge`)
- **Servidor SVN objetivo**: `REMOVED_SERVER_URL/` (red interna, puede no estar accesible fuera)
- **Repos locales**: `~/Documents/JaviSvn/`
- **Configuración**: `~/Library/Application Support/javisvn/javisvn-config.json` (store JSON simple)

---

## Comandos esenciales

```bash
# Iniciar en desarrollo
./start.sh          # Recomendado: unseta ELECTRON_RUN_AS_NODE y lanza npm run dev

npm run dev         # Alternativa directa (requiere que ELECTRON_RUN_AS_NODE no esté seteado)

# Build para distribución
npm run build       # Compila con electron-vite
npm run dist        # Build + empaqueta como .dmg (requiere resources/icon.icns)

# Verificar TypeScript sin compilar
npx tsc --noEmit
```

> **CRITICO**: `ELECTRON_RUN_AS_NODE` **NUNCA debe estar seteado** al lanzar la app.
> Claude Code lo setea internamente; `start.sh` y los scripts `npm run dev/start` lo
> desactivan con `env -u ELECTRON_RUN_AS_NODE`. Si la app no abre o falla al importar
> módulos de Electron, este es el primer lugar a revisar.

---

## Arquitectura de archivos

```
JaviSVN/
├── CLAUDE.md                      # Este archivo
├── package.json                   # "type": "module" — ESM obligatorio
├── electron.vite.config.ts        # Config de electron-vite con fixCjsShimPlugin
├── tsconfig.json / tsconfig.node.json / tsconfig.web.json
├── start.sh                       # Script de inicio recomendado
├── resources/                     # Iconos para el build (.icns, .ico, .png)
└── src/
    ├── main/
    │   └── index.ts               # Proceso principal: IPC handlers, SVN CLI
    ├── preload/
    │   └── index.ts               # Bridge: expone window.svn via contextBridge
    └── renderer/
        ├── index.html
        └── src/
            ├── main.tsx           # Entry point React
            ├── App.tsx            # Root: estado global, tabs, toasts
            ├── App.css            # Estilos completos (GitHub Desktop inspired)
            ├── types/
            │   └── svn.ts         # Interfaces TypeScript compartidas
            └── components/
                ├── Sidebar.tsx        # Lista de repos locales
                ├── ChangesView.tsx    # Archivos modificados + diff + commit
                ├── DiffViewer.tsx     # Parser y renderer de diffs unificados
                ├── HistoryView.tsx    # Log SVN con detalle por revisión
                ├── ExplorerView.tsx   # Explorador de repos remotos + checkout
                └── AuthDialog.tsx     # Login (usuario, contraseña, URL servidor)
```

---

## Decisiones técnicas críticas

### 1. ESM obligatorio (`"type": "module"`)
El proceso main usa ESM. Sin esto, `require('electron')` devuelve la ruta del binario en
lugar del módulo, rompiendo todo.

### 2. fixCjsShimPlugin en electron.vite.config.ts
electron-vite genera `import __cjs_mod__ from "node:module"` que falla en Electron 32
porque `node:module` no tiene export default. El plugin lo reemplaza por
`import * as __cjs_mod__ from "node:module"`.

### 3. xml2js via createRequire
`xml2js` es un módulo CJS. En ESM se importa así:
```typescript
const _require = createRequire(import.meta.url)
const xml2js = _require('xml2js')
```

### 4. Store propio (no electron-store)
`electron-store` es incompatible con ESM. Se usa un store JSON simple con
`readFileSync`/`writeFileSync` en `getStorePath()` → `~/Library/Application Support/javisvn/javisvn-config.json`.

### 5. SVN binary: findSvnBin()
Electron no hereda el PATH completo del shell. La función `findSvnBin()` busca
en candidatos hardcodeados:
```
/opt/homebrew/bin/svn  ← Apple Silicon Mac con Homebrew
/usr/local/bin/svn     ← Intel Mac con Homebrew
/usr/bin/svn           ← SVN del sistema
```
Además, todos los `spawn` inyectan `/opt/homebrew/bin` en el PATH del proceso hijo.

### 6. skipAuth en svn:version
`svn --version --quiet` **no acepta** los flags `--non-interactive --trust-server-cert-failures=...`.
El handler `svn:version` usa `runSvn(['--version', '--quiet'], { skipAuth: true })`.
Sin esto, la app siempre muestra "SVN no encontrado" aunque esté instalado.

---

## IPC API (window.svn en el renderer)

| Canal IPC | Argumentos | Descripción |
|---|---|---|
| `creds:get` | — | Obtiene credenciales guardadas |
| `creds:set` | `{username, password, serverUrl}` | Guarda credenciales |
| `creds:clear` | — | Borra credenciales |
| `creds:getServerUrl` | — | URL del servidor SVN |
| `repos:list` | — | Lista repos locales en `~/Documents/JaviSvn/` |
| `repos:basePath` | — | Ruta base de repos locales |
| `svn:list` | `url` | Lista entradas remotas de un directorio SVN |
| `svn:checkout` | `url, targetName` | Clona repo remoto localmente |
| `svn:update` | `repoPath` | `svn update` en repo local |
| `svn:status` | `repoPath` | Archivos modificados (XML → array) |
| `svn:diff` | `repoPath, filePath` | Diff de un archivo |
| `svn:commit` | `repoPath, files[], message` | Commit (auto-add archivos nuevos) |
| `svn:revert` | `repoPath, files[]` | Revertir archivos |
| `svn:log` | `repoPath, limit?` | Historial de revisiones |
| `svn:info` | `path` | Info SVN de un path |
| `svn:ping` | `url` | Prueba conexión al servidor |
| `svn:version` | — | Versión de SVN instalado |
| `dialog:openFile` | `repoPath, filePath` | Abre archivo en Finder/editor |
| `dialog:openFolder` | `path` | Abre carpeta en Finder |

Eventos push (main → renderer via `webContents.send`):
- `svn:checkout-progress` — progreso de checkout línea a línea
- `svn:update-progress` — progreso de update

---

## Errores conocidos y sus soluciones

| Error | Causa | Solución |
|---|---|---|
| `TypeError: Cannot read properties of undefined (reading 'exports')` al importar electron | `ELECTRON_RUN_AS_NODE=1` seteado | `unset ELECTRON_RUN_AS_NODE` o usar `start.sh` |
| `import __cjs_mod__ from "node:module"` falla | electron-vite genera default import inválido | `fixCjsShimPlugin` en `electron.vite.config.ts` |
| `require('electron')` devuelve string con ruta binaria | `"type"` no es `"module"` en package.json | Mantener `"type": "module"` |
| "⚠️ SVN no encontrado" aunque SVN esté instalado | `svn --version` falla con flags de auth | `skipAuth: true` en `svn:version` handler |
| electron-store falla en ESM | CJS incompatible | Usar store JSON propio (`readStore`/`writeStore`) |

---

## Notas de desarrollo

- No hay branches SVN. El servidor solo usa trunk/main.
- Las credenciales se guardan en texto plano en el config JSON (uso interno/local).
- El usuario conecta desde Windows con TortoiseSVN; esta app es solo para macOS.
- No se necesita git para nada — es una app 100% SVN.
- Al hacer commit, los archivos `?` (unversioned) seleccionados se agregan
  automáticamente con `svn add --force` antes del commit.
