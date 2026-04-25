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

> `ELECTRON_RUN_AS_NODE` no debe estar seteado al iniciar la app. `./start.sh` y los scripts del proyecto lo limpian.

---

## Arquitectura

```text
src/
├── main/
│   ├── index.ts        # IPC handlers, integración SVN CLI, búsquedas, release/update helpers
│   └── updater.ts      # Consulta de releases de GitHub y estado de actualización
├── preload/
│   └── index.ts        # Bridge seguro: window.svn y window.appUpdate
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
