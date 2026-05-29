// Bridge MCP standalone cross-plataforma.
// En Windows se conecta vía named pipe; en macOS/Linux vía Unix socket.
// Actúa como puente entre el cliente MCP (Kiro CLI, Claude Desktop, VS Code Copilot, etc.)
// y la app GUI corriendo localmente, conectándose a su broker.

import { randomUUID } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { AgentBrokerClient } from '../../src/main/agent/broker-client'
import { resolveAgentBrokerEndpoint } from '../../src/main/agent/endpoint'
import { registerResources, registerTools } from '../../src/main/agent/mcp-surface'

const SERVER_NAME = 'javisvn'
const TOKEN_ENV = 'JAVISVN_MCP_TOKEN'
const DEBUG_ENV = 'JAVISVN_MCP_DEBUG'
const VERSION = process.env.JAVISVN_BRIDGE_VERSION || '0.0.0'

function resolveBrokerEndpoint(): string {
  if (process.platform === 'win32') {
    return resolveAgentBrokerEndpoint({ platform: process.platform, userDataPath: '' })
  }
  const userData = process.platform === 'darwin'
    ? path.join(os.homedir(), 'Library', 'Application Support', 'javisvn')
    : path.join(process.env.XDG_DATA_HOME ?? path.join(os.homedir(), '.local', 'share'), 'javisvn')
  return resolveAgentBrokerEndpoint({
    platform: process.platform,
    userDataPath: userData,
    tempDir: os.tmpdir()
  })
}

const PIPE_ENDPOINT = resolveBrokerEndpoint()

function logDebug(message: string): void {
  if (process.env[DEBUG_ENV] !== '1') return
  process.stderr.write(`[JaviSVN MCP bridge] ${new Date().toISOString()} ${message}\n`)
}

async function connectBroker(token: string): Promise<AgentBrokerClient> {
  const client = new AgentBrokerClient({
    endpoint: PIPE_ENDPOINT,
    token,
    clientId: process.env.JAVISVN_MCP_CLIENT_ID || randomUUID(),
    clientName: process.env.JAVISVN_MCP_CLIENT_NAME || 'MCP client',
    clientVersion: process.env.JAVISVN_MCP_CLIENT_VERSION
  })

  // Reintenta varias veces por si la app GUI todavía está arrancando el broker.
  const deadline = Date.now() + 20_000
  let lastError: Error | null = null
  while (Date.now() < deadline) {
    try {
      await client.connect()
      logDebug('broker connected')
      return client
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }

  throw lastError ?? new Error(
    `No se pudo conectar al broker de ${SERVER_NAME}. Asegurate de que la app GUI esta abierta y la integracion IA esta habilitada.`
  )
}

async function main(): Promise<void> {
  const token = process.env[TOKEN_ENV]
  if (!token) {
    process.stderr.write(`Falta ${TOKEN_ENV} para autenticar el MCP de ${SERVER_NAME}.\n`)
    process.exit(1)
  }

  const broker = await connectBroker(token)
  const server = new McpServer({ name: SERVER_NAME, version: VERSION })
  registerTools(server, broker)
  registerResources(server, broker)

  let shuttingDown = false
  const shutdown = async (exitCode: number, reason: string): Promise<void> => {
    if (shuttingDown) return
    shuttingDown = true
    logDebug(`shutdown: ${reason}`)
    try {
      await broker.close()
      await server.close()
    } finally {
      process.exit(exitCode)
    }
  }

  // ── Triggers defensivos ──────────────────────────────────────────
  process.stdin.on('end', () => { void shutdown(0, 'stdin end') })
  process.stdin.on('close', () => { void shutdown(0, 'stdin close') })
  process.stdin.on('error', (err) => {
    void shutdown(1, `stdin error: ${err instanceof Error ? err.message : String(err)}`)
  })

  for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) {
    process.on(sig, () => { void shutdown(0, sig) })
  }

  if (process.platform !== 'win32') {
    const initialPpid = process.ppid
    const ppidWatcher = setInterval(() => {
      const current = process.ppid
      if (current !== initialPpid || current === 1) {
        void shutdown(0, `parent changed: ${initialPpid} -> ${current}`)
      }
    }, 2000)
    ppidWatcher.unref()
  }
  // ──────────────────────────────────────────────────────────────────

  const transport = new StdioServerTransport()
  transport.onclose = () => { void shutdown(0, 'transport closed') }
  await server.connect(transport)
  logDebug('stdio server ready')

  broker.onClose(() => { void shutdown(1, 'broker closed') })
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Error desconocido'}\n`)
  process.exit(1)
})
