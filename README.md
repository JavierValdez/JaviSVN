# JaviSVN

Cliente de escritorio SVN para macOS y Windows inspirado en GitHub Desktop.

Permite explorar repositorios SVN remotos, clonarlos localmente, ver cambios, hacer commits y revisar el historial — todo sin necesidad de usar la línea de comandos.

---

## Características

- **Explorador remoto** — navega los repositorios del servidor SVN antes de hacer checkout
- **Checkout con progreso** — clona repositorios remotos con barra de progreso en tiempo real
- **Vista de cambios** — lista archivos modificados, diff coloreado línea a línea y commit con mensaje
- **Historial** — log de revisiones con detalle de archivos afectados por cada commit
- **Blame** — muestra qué revisión y autor modificó cada línea de un archivo
- **Resolución de conflictos** — interfaz visual para resolver conflictos de merge
- **Revertir archivos** — deshace cambios locales con un clic
- **Auto-add** — los archivos nuevos (sin versionar) se agregan automáticamente al hacer commit
- **Autenticación** — guarda credenciales y URL del servidor entre sesiones

---

## Requisitos

- macOS (Apple Silicon o Intel)
- Windows 10/11

> SVN viene incluido dentro de la app. No necesitas instalarlo por separado.

---

## Instalación

### macOS

1. Descarga el instalador `.dmg` desde la [última release](https://github.com/JavierValdez/JaviSVN/releases/latest)
2. Abre el `.dmg` y lee el archivo `LEER_ANTES_DE_ABRIR.txt` que aparece en la ventana
3. Arrastra **JaviSVN** a la carpeta **Aplicaciones**
4. Si macOS muestra *"JaviSVN está dañado y no puede abrirse"*, ejecuta en Terminal:
    ```bash
    xattr -cr /Applications/JaviSVN.app
    ```
5. Abre JaviSVN normalmente desde Launchpad o Finder

> Este mensaje aparece porque la app no está firmada con una cuenta de desarrollador de Apple. El comando `xattr -cr` elimina la cuarentena de macOS. Solo necesitas hacerlo una vez tras cada instalación.

### Windows

1. Descarga el instalador `.exe` desde la [última release](https://github.com/JavierValdez/JaviSVN/releases/latest)
2. Ejecuta el instalador NSIS y sigue el asistente
3. Abre JaviSVN desde el acceso directo de escritorio o desde Inicio

---

## Primeros pasos

1. Al abrir la app por primera vez, se muestra el diálogo de conexión
2. Ingresa la URL de tu servidor SVN, usuario y contraseña
3. Usa la pestaña **Explorar** para navegar los repositorios del servidor
4. Haz clic en **Checkout** para clonar un repositorio localmente
5. El repositorio aparecerá en la barra lateral izquierda

---

## Stack tecnológico

| Capa | Tecnología |
|---|---|
| Framework de escritorio | Electron 32 |
| Build tool | electron-vite 5 |
| UI | React 18 + TypeScript |
| Backend SVN | CLI de Subversion vía `child_process.spawn` |
| Comunicación | IPC Electron (`ipcMain.handle` / `contextBridge`) |
| Módulos | ESM (`"type": "module"`) |

---

## Desarrollo

### Requisitos previos

- Node.js 20+
- npm
- SVN instalado en el sistema:
    - macOS: `brew install subversion`
    - Windows: TortoiseSVN con command line tools

> El build final empaqueta sus propios binarios SVN para cada plataforma.

### Iniciar en modo desarrollo

```bash
git clone https://github.com/JavierValdez/JaviSVN.git
cd JaviSVN
npm install
./start.sh
```

> Usar `./start.sh` en lugar de `npm run dev` directamente para evitar conflictos con la variable de entorno `ELECTRON_RUN_AS_NODE`.

> En Windows, usar `npm run dev` (el script ya limpia `ELECTRON_RUN_AS_NODE` con `cross-env`).

### Compilar el instalador

```bash
npm run dist
# macOS: dist/JaviSVN-X.Y.Z-arm64.dmg
# Windows: dist/JaviSVN Setup X.Y.Z.exe
```

### Checklist de release Windows (NSIS)

1. Verifica versión en `package.json` y `package-lock.json`
2. Ejecuta `npm run build` (incluye bundle de `svn.exe` + DLLs)
3. Ejecuta `npm run dist`
4. Comprueba artefacto `dist/JaviSVN Setup X.Y.Z.exe`
5. Prueba instalación en Windows limpio:
    - la app abre
    - detecta SVN bundleado (`svn:version` devuelve versión)
    - checkout, status y commit funcionan
6. Publica release en GitHub adjuntando el `.exe` (y `.dmg` si aplica)

### Verificar TypeScript

```bash
npx tsc --noEmit
```

---

## Estructura del proyecto

```
src/
├── main/index.ts          # Proceso principal: IPC handlers, invocación SVN CLI
├── preload/index.ts       # Bridge: expone window.svn al renderer via contextBridge
└── renderer/src/
    ├── App.tsx            # Root: estado global, pestañas, toasts
    └── components/
        ├── Sidebar.tsx        # Lista de repositorios locales
        ├── ExplorerView.tsx   # Explorador de repos remotos + checkout
        ├── ChangesView.tsx    # Archivos modificados + diff + commit
        ├── HistoryView.tsx    # Log SVN con detalle por revisión
        ├── DiffViewer.tsx     # Renderer de diffs unificados
        ├── BlameView.tsx      # Vista blame por línea
        └── ConflictResolver.tsx  # Resolución de conflictos
```

---

## Notas

- Las credenciales se guardan localmente en:
    - macOS: `~/Library/Application Support/javisvn/javisvn-config.json`
    - Windows: `%APPDATA%/javisvn/javisvn-config.json`
- Los repositorios clonados se guardan en:
    - macOS: `~/Documents/JaviSvn/`
    - Windows: `%USERPROFILE%/Documents/JaviSvn/`

---

## Licencia

Uso personal / interno. Sin licencia de distribución pública.
