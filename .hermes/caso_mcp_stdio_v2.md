# Caso: MCP stdio Windows - fix real

## QA Report (nuevo, 2026-05-19)

Problemas confirmados en Windows para JaviSVN y JaviServer:

1. **cmd.exe /c wrapper no funciona**: El prompt regresa inmediatamente. Electron es GUI subsystem y se desacopla. Los pipes stdin/stdout se rompen.

2. **--mcp-stdio no llega a process.argv**: Con `ELECTRON_RUN_AS_NODE=` (limpio), el Electron app arranca en modo GUI normal. GPU/renderer processes visibles → `isMcpStdioMode` es false → el flag no llega.

3. **ELECTRON_RUN_AS_NODE=1**: `bad option: --mcp-stdio` con exit 9. Node.js rechaza flags desconocidos.

## Diagnostico

La causa raiz NO es `window-all-closed` (aunque ese fix es correcto y necesario). El problema es que `--mcp-stdio` nunca llega a `process.argv` en Windows cuando se usa el wrapper `cmd.exe /c`. Posibles razones:
- cmd.exe quote escaping daña el argumento
- Electron GUI subsystem se desacopla antes de procesar argv
- `/s` flag de cmd.exe modifica el parsing

## Solucion propuesta

**Usar variable de entorno en vez de CLI flag.** `JAVISVN_MCP_STDIO=1` / `JAVISERVER_MCP_STDIO=1` evita TODOS los problemas de:
- cmd.exe quoting y escaping
- Electron argument parsing
- Node.js `bad option` rejection
- Windows GUI subsystem detachment

## Cambios necesarios

### En index.ts / main.ts (ambos proyectos)
```diff
-const isMcpStdioMode = process.argv.includes('--mcp-stdio')
+const isMcpStdioMode = process.argv.includes('--mcp-stdio') || process.env.JAVISVN_MCP_STDIO === '1'
```

### En client-config.ts (ambos proyectos)
Cambiar el launch config para Windows: usar env var en vez de flag CLI.
En vez de pasar `--mcp-stdio` como argumento, setear la env var.

### En mcp-server.ts (ambos)
El `connectBroker` lanza `spawnVisibleApp()`. Asegurar que el hijo NO herede `JAVISVN_MCP_STDIO`.

## Tarea para kiro

Lee estos archivos en AMBOS proyectos (JaviSVN y JaviServer):
- src/main/index.ts (o electron/main.ts) - lineas de isMcpStdioMode y window-all-closed
- src/main/agent/mcp-server.ts (o electron/agent/mcp-server.ts) - connectBroker y spawnVisibleApp
- src/main/agent/client-config.ts (o electron/agent/client-config.ts) - buildAgentClientLaunchConfig
- src/main/agent/integration.ts (o electron/agent/integration.ts) - getAgentClientConfig

Para cada proyecto, implementa:
1. Deteccion MCP via env var JAVISVN_MCP_STDIO / JAVISERVER_MCP_STDIO (manteniendo compatibilidad con --mcp-stdio)
2. Client config en Windows: usar env var en vez de flag CLI
3. spawnVisibleApp: filtrar la env var MCP_STDIO para que el hijo no entre en modo MCP
4. Si hay que modificar el mcp.json de ejemplo, hazlo

Usa patch(). Responde en espanol con resumen de cambios.
