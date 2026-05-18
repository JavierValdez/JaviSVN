import { app } from 'electron'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { AgentBrokerClient } from './broker-client'
import { getAgentBrokerEndpoint } from './integration'
import { registerResources, registerTools } from './mcp-surface'

function logMcp(event: string): void {
  if (process.env.JAVISVN_MCP_DEBUG !== '1') return
  process.stderr.write(`[JaviSVN MCP] ${new Date().toISOString()} ${event}\n`)
}

function spawnVisibleApp(): void {
  const args = app.isPackaged ? [] : [app.getAppPath()]
  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: 'ignore',
    env: Object.fromEntries(
      Object.entries(process.env).filter(([key]) => key !== 'ELECTRON_RUN_AS_NODE')
    )
  })
  child.unref()
}

async function connectBroker(token: string): Promise<AgentBrokerClient> {
  const client = new AgentBrokerClient({
    endpoint: getAgentBrokerEndpoint(),
    token,
    clientId: process.env.JAVISVN_MCP_CLIENT_ID || randomUUID(),
    clientName: process.env.JAVISVN_MCP_CLIENT_NAME || 'MCP client',
    clientVersion: process.env.JAVISVN_MCP_CLIENT_VERSION
  })

  try {
    await client.connect()
    logMcp('broker connected')
    return client
  } catch {
    logMcp('broker unavailable; opening visible app')
    spawnVisibleApp()
  }

  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500))
    try {
      await client.connect()
      logMcp('broker connected after visible app launch')
      return client
    } catch {
      // wait until visible app starts broker
    }
  }
  throw new Error('No se pudo conectar con JaviSVN. Abre la app y habilita la integración IA.')
}

export async function runMcpServerMode(): Promise<void> {
  const token = process.env.JAVISVN_MCP_TOKEN
  if (!token) throw new Error('Falta JAVISVN_MCP_TOKEN para autenticar el MCP de JaviSVN.')

  await app.whenReady()
  const broker = await connectBroker(token)
  const server = new McpServer({ name: 'javisvn', version: app.getVersion() })
  registerTools(server, broker)
  registerResources(server, broker)

  const transport = new StdioServerTransport()
  await server.connect(transport)

  let shuttingDown = false
  const shutdown = async (exitCode: number, reason: string): Promise<void> => {
    if (shuttingDown) return
    shuttingDown = true
    logMcp(`shutdown requested: ${reason}`)
    try {
      await broker.close()
      await server.close()
    } finally {
      app.exit(exitCode)
    }
  }

  transport.onclose = () => {
    void shutdown(0, 'transport closed')
  }
  broker.onClose(() => {
    void shutdown(1, 'broker connection closed')
  })
  process.stdin.once('end', () => {
    void shutdown(0, 'stdin ended')
  })
  process.stdin.once('close', () => {
    void shutdown(0, 'stdin closed')
  })
  logMcp('stdio server ready')
}
