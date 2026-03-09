# JaviSVN — CLAUDE.md

Guía de referencia para el agente Claude Code al trabajar en este proyecto.

---

## Descripción del proyecto

**JaviSVN** es un cliente de escritorio SVN para macOS y Windows inspirado en GitHub Desktop. Permite explorar repositorios SVN remotos, clonarlos localmente, ver cambios, hacer commits y revisar el historial, todo sin necesidad de línea de comandos.

- **Stack**: Electron 32 + electron-vite 5 + React 18 + TypeScript (ESM)
- **Backend SVN**: CLI de Subversion (bundleado o del sistema) invocado via `child_process.spawn`
- **Comunicación**: IPC Electron (`ipcMain.handle` / `ipcRenderer.invoke` vía `contextBridge`)
- **Servidor SVN objetivo**: configurado por el usuario al iniciar la app (red interna, no hardcodeado en el código)
- **Repos locales**: `~/Documents/JaviSvn/`
- **Configuración**: `~/Library/Application Support/javisvn/javisvn-config.json` (store JSON simple)

---

## Comandos esenciales

```bash
# Iniciar en desarrollo
./start.sh          # Recomendado: unseta ELECTRON_RUN_AS_NODE y lanza npm run dev

npm run dev         # Alternativa directa (requiere que ELECTRON_RUN_AS_NODE no esté seteado)

# Build para distribución
npm run build       # Bundle SVN por plataforma + compila con electron-vite
npm run dist        # Build + empaqueta instaladores (.dmg macOS / .exe NSIS Windows)

# Verificar TypeScript sin compilar
npx tsc --noEmit
```

> **CRITICO**: `ELECTRON_RUN_AS_NODE` **NUNCA debe estar seteado** al lanzar la app.
> Los scripts `npm run dev/start` lo limpian con `cross-env ELECTRON_RUN_AS_NODE=`.
> Si la app no abre o falla al importar módulos de Electron, este es el primer lugar a revisar.

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
/Program Files/TortoiseSVN/bin/svn.exe (Windows)
/Program Files (x86)/TortoiseSVN/bin/svn.exe (Windows)
/opt/homebrew/bin/svn  ← Apple Silicon Mac con Homebrew
/usr/local/bin/svn     ← Intel Mac con Homebrew
/usr/bin/svn           ← SVN del sistema
```
Además, todos los `spawn` inyectan rutas extra en el PATH del proceso hijo según la plataforma:
- macOS: `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`
- Windows: rutas de TortoiseSVN en `Program Files` / `Program Files (x86)`

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

## Proceso de release

### Pasos para generar una nueva versión y release en GitHub

```bash
# 1. Bump de versión en package.json (campo "version")
#    Seguir semver: MAJOR.MINOR.PATCH
#    Ejemplo: 1.1.0 → 1.2.0

# 2. Commit y push de los cambios
git add src/ package.json package-lock.json resources/LEER_ANTES_DE_ABRIR.txt
git commit -m "vX.Y.Z — Descripción breve de cambios"
git push origin main

# 3. Compilar instaladores
npm run dist
# Genera:
# - macOS:   dist/JaviSVN-X.Y.Z-arm64.dmg
# - Windows: dist/JaviSVN Setup X.Y.Z.exe

# 4. Crear release en GitHub con artefactos adjuntos
gh release create vX.Y.Z \
  "dist/JaviSVN-X.Y.Z-arm64.dmg" \
  "dist/JaviSVN Setup X.Y.Z.exe" \
  --title "JaviSVN vX.Y.Z" \
  --notes "$(cat <<'EOF'
## Novedades
- Cambio 1
- Cambio 2

## Instalación
1. Descargar `JaviSVN-X.Y.Z-arm64.dmg`
2. Leer `LEER_ANTES_DE_ABRIR.txt` dentro del instalador
3. Arrastrar JaviSVN a la carpeta Aplicaciones
4. Si macOS bloquea la app: `xattr -cr /Applications/JaviSVN.app`
EOF
)"
```

### Checklist específico de release Windows

1. Tener `resources/icon.ico` presente
2. Ejecutar `npm run build` en Windows (bundlea `svn.exe` + DLLs desde TortoiseSVN/PATH)
3. Ejecutar `npm run dist` y validar `dist/JaviSVN Setup X.Y.Z.exe`
4. Probar instalación en Windows limpio:
  - abre la app
  - muestra versión SVN válida en diagnóstico
  - checkout/status/commit operativos
5. Adjuntar `.exe` a la release de GitHub

### Contenido del DMG (configurado en package.json → `build.dmg`)

El instalador `.dmg` incluye tres elementos en su ventana:
- **JaviSVN.app** (x:130, y:220) — la aplicación
- **Acceso directo a /Applications** (x:410, y:220) — para arrastrar e instalar
- **LEER_ANTES_DE_ABRIR.txt** (x:130, y:360) — instrucciones de instalación visibles antes de instalar

El `.txt` también se copia dentro del bundle en `extraResources` para que esté disponible en `Resources/LEER_ANTES_DE_ABRIR.txt` una vez instalada la app.

### Configuración Windows (configurada en package.json → `build.win` y `build.nsis`)

- Target: `nsis`
- Icono app/installer/uninstaller: `resources/icon.ico`
- Instalación one-click con atajos en escritorio e inicio

### Archivos a NO incluir en git (ya en .gitignore)
- `resources/bin/` — binarios SVN empaquetados (svn, libsvn, etc.)
- `resources/lib/` — librerías dinámicas de SVN
- `dist/` — output del build

### Archivos que SÍ deben incluirse en git antes del release
- `resources/LEER_ANTES_DE_ABRIR.txt` — instrucciones macOS
- `src/main/updater.ts` — módulo de auto-actualización
- `src/renderer/src/components/BlameView.tsx` — vista blame
- `src/renderer/src/components/ConflictResolver.tsx` — resolución de conflictos

---

## Notas de desarrollo

- No hay branches SVN. El servidor solo usa trunk/main.
- Las credenciales se guardan en texto plano en el config JSON (uso interno/local).
- El usuario conecta también desde Windows; la app soporta empaquetado NSIS con SVN bundleado.
- No se necesita git para nada — es una app 100% SVN.
- Al hacer commit, los archivos `?` (unversioned) seleccionados se agregan
  automáticamente con `svn add --force` antes del commit.
