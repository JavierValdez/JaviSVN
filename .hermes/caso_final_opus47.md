# ANALISIS COMPLETO: MCP stdio en Windows - JaviSVN + JaviServer

## Cronologia de intentos fallidos

### Intento 1 (v1.9.6 / v1.0.10)
Fix: `if (isMcpStdioMode) return` en `window-all-closed`
Resultado QA: FALLO. El flag --mcp-stdio nunca llega a process.argv. El Electron abre GUI normal.

### Intento 2 (v1.9.7 / v1.0.12)  
Fix: Detectar MCP via env var `JAVISVN_MCP_STDIO=1` + client-config actualizado
Resultado QA: FALLO. El QA uso el mcp.json VIEJO (sin la nueva env var). El flag --mcp-stdio seguia sin llegar.

### Intento 3 (v1.9.8 / v1.0.13) - ACTUAL
Fix: `isMcpStdioMode` detecta MCP por presencia de `JAVISVN_MCP_TOKEN` en env
Resultado QA: PENDIENTE

## Estado actual del codigo (AMBOS proyectos identicos en logica)

### index.ts / main.ts
```ts
const isMcpStdioMode = process.argv.includes('--mcp-stdio') 
  || process.env.JAVISVN_MCP_STDIO === '1' 
  || !!process.env.JAVISVN_MCP_TOKEN;

// MCP mode: disable GPU, skip window creation
if (isMcpStdioMode) {
  app.disableHardwareAcceleration()
  app.commandLine.appendSwitch('disable-gpu')
  app.commandLine.appendSwitch('disable-software-rasterizer')
}

app.whenReady().then(() => {
  if (isMcpStdioMode) return  // skip GUI init
  // ... normal GUI startup
})

if (isMcpStdioMode) {
  void runMcpServerMode().catch((error) => {
    process.stderr.write(error.message + '\n')
    app.exit(1)
  })
}

app.on('window-all-closed', () => {
  cleanupPreviewTempDirs()
  if (isMcpStdioMode) return     // guard
  if (process.platform !== 'darwin') app.quit()
})
```

### mcp-server.ts
```ts
function spawnVisibleApp(): void {
  // Filtra ELECTRON_RUN_AS_NODE, MCP_STDIO, MCP_TOKEN del hijo
  const child = spawn(process.execPath, args, {
    detached: true, stdio: 'ignore',
    env: Object.fromEntries(
      Object.entries(process.env).filter(([key]) =>
        key !== 'ELECTRON_RUN_AS_NODE' 
        && key !== 'JAVISVN_MCP_STDIO' 
        && key !== 'JAVISVN_MCP_TOKEN'
      )
    )
  })
}

async function connectBroker(token): Promise<AgentBrokerClient> {
  const client = new AgentBrokerClient({ endpoint, token, ... })
  try { await client.connect(); return client }
  catch { spawnVisibleApp() }  // lanza GUI si broker no disponible
  // retry 15s
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) { ... retry ... }
  throw new Error('No se pudo conectar...')
}

export async function runMcpServerMode(): Promise<void> {
  const token = process.env.JAVISVN_MCP_TOKEN  // o JAVISERVER
  if (!token) throw ... 
  await app.whenReady()
  const broker = await connectBroker(token)
  const server = new McpServer(...)
  registerTools(server, broker)
  registerResources(server, broker)
  const transport = new StdioServerTransport()
  await server.connect(transport)
  
  // shutdown handlers
  transport.onclose = () => shutdown(0, 'transport closed')
  broker.onClose(() => shutdown(1, 'broker connection closed'))
  process.stdin.once('end', () => shutdown(0, 'stdin ended'))
  process.stdin.once('close', () => shutdown(0, 'stdin closed'))
}
```

### client-config.ts
```ts
export function buildAgentClientLaunchConfig(input: {
  platform, execPath, launchArgs, comSpec?, stdioEnvKey?
}): AgentClientLaunchConfig {
  if (platform === 'darwin') {
    return {
      command: '/usr/bin/env',
      args: ['-u', 'ELECTRON_RUN_AS_NODE', execPath, ...launchArgs]
    }
  }
  if (platform === 'win32') {
    // Si hay stdioEnvKey, usar env var en vez de flag CLI
    const setEnv = input.stdioEnvKey
      ? `set "ELECTRON_RUN_AS_NODE=" && set "${input.stdioEnvKey}=1" && ${quoteCmdArg(execPath)}`
      : `set "ELECTRON_RUN_AS_NODE=" && ${quoteCmdArg(execPath)} ${launchArgs.map(quoteCmdArg).join(' ')}`;
    return { command: 'cmd.exe', args: ['/d', '/s', '/c', setEnv] }
  }
  return { command: execPath, args: launchArgs }
}
```

### integration.ts (getAgentClientConfig)
```ts
export function getAgentClientConfig() {
  const token = ensureAgentIntegrationToken()
  const launchArgs = app.isPackaged 
    ? ['--mcp-stdio'] 
    : [app.getAppPath(), '--mcp-stdio']
  const launchConfig = buildAgentClientLaunchConfig({
    platform: process.platform,
    execPath: process.execPath,
    launchArgs,
    comSpec: process.env.ComSpec,
    stdioEnvKey: 'JAVISVN_MCP_STDIO'  // o JAVISERVER
  })
  return {
    ...launchConfig,
    env: { 
      JAVISVN_MCP_TOKEN: token,       // o JAVISERVER
      JAVISVN_MCP_STDIO: '1'          // o JAVISERVER
    }
  }
}
```

## Config mcp.json del USUARIO (VIEJO - con el que prueba QA)
```json
{
  "mcpServers": {
    "javisvn": {
      "command": "C:\\WINDOWS\\system32\\cmd.exe",
      "args": ["/d", "/s", "/c", "set \"ELECTRON_RUN_AS_NODE=\" && \"...JaviSVN.exe\" \"--mcp-stdio\""],
      "env": {
        "JAVISVN_MCP_TOKEN": "81bda3ceabc..."
      }
    }
  }
}
```

## Lo que el QA confirmo 3 veces

1. cmd.exe /c wrapper: el prompt regresa inmediatamente. Process GUI abierto (GPU, renderer, utility).
2. --mcp-stdio NO aparece en el CommandLine del proceso (Get-WmiObject Win32_Process).
3. ELECTRON_RUN_AS_NODE=1 directo: "bad option: --mcp-stdio" exit 9.
4. Proceso principal NO conserva --mcp-stdio visible en su CommandLine.

## Preguntas para Opus 4.7

Analiza TODO el codigo y el QA report. Responde en espanol:

1. Con el fix v1.9.8/v1.0.13 (detectar MCP via JAVISVN_MCP_TOKEN), el mcp.json VIEJO del usuario deberia funcionar? El token SI esta en el env del mcp.json.

2. Hay ALGUN problema restante que impida que funcione? Analiza:
   - El flujo de stdin/stdout en Windows con cmd.exe /c wrapper
   - Si Electron GUI subsystem rompe los pipes stdio aunque el proceso siga vivo
   - Si `process.stdin` emite 'end'/'close' cuando cmd.exe padre termina
   - Si `StdioServerTransport` del MCP SDK funciona en Windows con Electron
   - Si `connectBroker` puede fallar silenciosamente (sin stderr porque JAVISVN_MCP_DEBUG no esta seteado)

3. El client-config.ts de macOS tiene codigo muerto (envArgs ternario redundante). Corregir?

4. Que pasa si el usuario NO tiene la app JaviSVN/JaviServer abierta? connectBroker lanza spawnVisibleApp. Pero spawnVisibleApp hereda el environment sin MCP_TOKEN (lo filtramos). El hijo arranca GUI normalmente. Pero tarda en iniciar el broker. Los 15s de retry son suficientes?

5. Propone mejoras o cambios adicionales. Se especifico. Se brutalmente honesto si ves algo mal.
