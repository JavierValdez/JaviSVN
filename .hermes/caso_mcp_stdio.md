# Caso: JaviSVN MCP stdio exits with code 0 on Windows

## Sintoma
Al ejecutar `JaviSVN.exe --mcp-stdio` con `JAVISVN_MCP_TOKEN` valido, el proceso termina inmediatamente con codigo 0, sin escribir nada en stdout ni stderr.

## Flujo actual

1. `src/main/index.ts:665-670`: `runMcpServerMode()` llamado sincronicamente
2. `src/main/agent/mcp-server.ts:59-98`: `runMcpServerMode()`:
   - Verifica token (OK)
   - `await app.whenReady()` → OK
   - `await connectBroker(token)` → conecta via named pipe `\\.\pipe\javisvn-agent-broker` (Windows)
   - Si no hay broker → `spawnVisibleApp()` → lanza GUI → reintenta 15s
   - Crea `McpServer` + `StdioServerTransport` → `server.connect(transport)`
   - Shutdown handlers:
     - `transport.onclose` → `exit(0)`
     - `broker.onClose` → `exit(1)`
     - `process.stdin.once('end')` → `exit(0)`
     - `process.stdin.once('close')` → `exit(0)`

3. `connectBroker()` en mcp-server.ts:27-57:
   - Intenta `client.connect()` via TCP a named pipe
   - Si falla → `spawnVisibleApp()` → reintenta 15s cada 500ms
   - Si exito → `return client`

4. Broker usa `net.connect()` a `\\.\pipe\javisvn-agent-broker` (broker-client.ts:33)

## Hipotesis del bug

**Hipotesis principal:** En Windows, Electron apps lanzadas desde consola/VS Code tienen stdin que se cierra inmediatamente. El handler `process.stdin.once('close')` → `shutdown(0, ...)` → `app.exit(0)` mata el proceso apenas arranca.

Posibles causas de stdin cerrado:
- Electron en Windows desconecta stdin al iniciar el event loop
- VS Code/Copilot cierra el pipe de stdin si no recibe respuesta rapido
- `cmd.exe /c` wrapper cierra stdin del hijo al terminar

**Hipotesis secundaria:** `connectBroker` lanza `spawnVisibleApp()` que hereda `JAVISVN_MCP_TOKEN`. El proceso hijo tambien detecta `--mcp-stdio`? NO - se lanza sin args en modo empaquetado. OK.

**Hipotesis terciaria:** `app.on('window-all-closed')` en index.ts:672 dispara `app.quit()` en Windows porque nunca se creo ninguna ventana.

## Preguntas para kiro

1. Lee index.ts, mcp-server.ts, broker-client.ts, integration.ts COMPLETOS
2. Traza el flujo exacto para el caso "con token valido en Windows"  
3. Por que el proceso sale con codigo 0 y sin output?
4. Que shutdown handler se esta disparando?
5. El `StdioServerTransport` tiene algun problema conocido en Windows con Electron?
6. `ELECTRON_RUN_AS_NODE=` (vacio) causa que Electron se comporte como Node y cierre stdin?
7. `app.on('window-all-closed')` puede dispararse si nunca se creo ventana?

Responde en espanol. Propone fix concreto. NO uses write_file.
