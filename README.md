# JaviSVN

Cliente de escritorio SVN para macOS y Windows inspirado en GitHub Desktop.

Permite explorar repositorios SVN remotos, clonarlos localmente, revisar cambios, hacer commits, navegar historial, resolver conflictos y generar releases sin depender de la línea de comandos para el uso diario.

---

## Características

- **Explorador remoto** con árbol expandible, gestión de servidores remotos guardados y estado `✓ Local` basado en la URL real del checkout.
- **Búsqueda remota** por nombre, contenido y comentarios de revisión, con navegación directa desde el resultado hasta la rama encontrada en el árbol.
- **Historial remoto y local** con diff por archivo y señal visual para cambios fuera del scope del `show log`.
- **Checkout y export** con progreso en tiempo real.
- **Vista de cambios** con diff coloreado, commit selectivo, revert y auto-add de archivos sin versionar.
- **Blame** por línea y **resolución de conflictos** usando `svn resolve`.
- **Descarga/preview** de archivos remotos y apertura rápida en Finder o editor externo.
- **Actualización de app** consultando la última release publicada en GitHub.

---

## Requisitos

- macOS (Apple Silicon o Intel) o Windows 10/11
- Node.js 20+
- npm

Para desarrollo:

- macOS: `brew install subversion`
- Windows: normalmente basta el bundle versionado en `resources/bin/`; si necesitas regenerarlo, instala SlikSVN o TortoiseSVN con herramientas de línea de comandos

> La app distribuida ya incluye SVN. El requisito de instalar Subversion aplica al entorno de desarrollo y a CI cuando se regenera el bundle.

---

## Instalación

### macOS

1. Descarga el `.dmg` desde la [última release](https://github.com/JavierValdez/JaviSVN/releases/latest).
2. Abre el instalador y lee `LEER_ANTES_DE_ABRIR.txt`.
3. Arrastra **JaviSVN** a **Aplicaciones**.
4. Si macOS muestra que la app está dañada o bloqueada, ejecuta:
```bash
xattr -cr /Applications/JaviSVN.app
```

### Windows

1. Descarga el `.exe` desde la [última release](https://github.com/JavierValdez/JaviSVN/releases/latest).
2. Ejecuta el instalador NSIS.
3. Abre JaviSVN desde el acceso directo o el menú Inicio.

---

## Primeros pasos

1. Configura URL, usuario y contraseña en el diálogo inicial.
2. Guarda el servidor remoto para reutilizarlo después.
3. En la pestaña **Explorar**, navega el árbol remoto o usa búsqueda profunda.
4. Haz checkout o export de la carpeta que te interese.
5. Desde **Cambios** o **Historial**, revisa diffs, blame, conflictos y commits.

---

## Integración IA por MCP

JaviSVN incluye una integración MCP local opcional para que agentes de IA puedan consultar remotos y working copies usando la configuración ya guardada en la app, sin compartir credenciales con el agente.

1. Abre **Integración IA** desde el pie de la barra lateral.
2. Activa la integración.
3. Copia la configuración MCP generada por la app en tu cliente compatible.
4. Mantén JaviSVN disponible; si el cliente inicia el MCP con la app cerrada, JaviSVN se abrirá automáticamente.

La integración expone operaciones de lectura y una operación local controlada:

- catálogo de remotos y repos locales
- `status`, `diff`, `log`, `blame` e `info` locales
- listado, búsqueda, contenido, historial, root URL e `info` remoto, con lectura histórica opcional por revisión
- `checkout_remote` para crear una working copy local bajo confirmación visible del usuario
- `update_local_repo` para actualizar una working copy local bajo confirmación visible del usuario
- resources MCP para remotos, repos y estado de repos locales

Las URLs remotas libres usan la credencial actualmente configurada en JaviSVN y no aceptan credenciales embebidas.

---

## Comandos útiles

```bash
# Desarrollo
./start.sh
npm run dev

# Build local
npm run build
npm run dist

# Publicación local manual a GitHub Releases
npm run release

# Validación TypeScript real
npx tsc -p tsconfig.web.json --noEmit
npx tsc -p tsconfig.node.json --noEmit
```

> `ELECTRON_RUN_AS_NODE` no debe estar seteado al iniciar la app. `./start.sh`, los scripts del proyecto y la configuración MCP generada lo limpian antes de arrancar JaviSVN.

---

## Arquitectura

```text
src/
├── main/
│   ├── index.ts        # IPC handlers, flujos mutables y arranque Electron
│   ├── agent/          # broker local, modo MCP stdio y auditoría
│   ├── services/       # store, runtime SVN y operaciones de lectura reutilizables
│   └── updater.ts      # Consulta de releases de GitHub y estado de actualización
├── preload/
│   └── index.ts        # Bridges seguros: window.svn, window.appUpdate y window.agentIntegration
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

## Despliegue

### Flujo automático actual

El despliegue ahora está automatizado en `.github/workflows/release.yml`.

1. Actualiza la versión en `package.json` y `package-lock.json`.
2. Haz commit y push a `main`.
3. Crea un tag con el mismo número de versión, por ejemplo `v1.6.2`.
4. Empuja el tag:

```bash
git push origin main
git tag v1.6.2
git push origin v1.6.2
```

5. GitHub Actions ejecuta la workflow `Release`:
   - `macos-latest`: instala `subversion`, genera `.dmg` y `.zip`
   - `windows-latest`: instala `sliksvn`, regenera el bundle si hace falta y genera `.exe` NSIS x64
6. `electron-builder --publish always` publica los artefactos en GitHub Releases usando el tag.

Secrets opcionales para firma/notarización:

- `CSC_LINK`
- `CSC_KEY_PASSWORD`
- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_TEAM_ID`

### Flujo manual de respaldo

Si necesitas publicar sin GitHub Actions:

```bash
npm run dist
gh release create vX.Y.Z dist/* --title "JaviSVN vX.Y.Z"
```

---

## Notas de desarrollo

- `package.json` usa ESM obligatorio (`"type": "module"`).
- `xml2js` se importa en `main` usando `createRequire`.
- El store es un JSON simple en:
  - macOS: `~/Library/Application Support/javisvn/javisvn-config.json`
  - Windows: `%APPDATA%/javisvn/javisvn-config.json`
- Los repositorios locales se guardan en:
  - macOS: `~/Documents/JaviSvn/`
  - Windows: `%USERPROFILE%/Documents/JaviSvn/`
- `resources/bin/` y `resources/lib/` forman parte del repo y se usan para empaquetar SVN en las builds.

---

## Licencia

Uso personal / interno. Sin licencia de distribución pública.
