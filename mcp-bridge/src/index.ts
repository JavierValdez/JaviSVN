// Bridge MCP standalone para Windows.
// Este binario se ejecuta en CONSOLE subsystem (vía Node SEA o node.exe directo)
// y actúa como puente entre el cliente MCP (Kiro CLI, Claude Desktop, VS Code Copilot, etc.)
// y la app GUI JaviSVN corriendo localmente, conectándose a su broker via named pipe.
//
// La app GUI principal sigue funcionando exactamente igual; solo se cambia el binario
// que se invoca desde mcp.json en Windows.

import { randomUUID } from 'node:crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { AgentBrokerClient } from '../../src/main/agent/broker-client'
import { registerResources, registerTools } from '../../src/main/agent/mcp-surface'

const SERVER_NAME = 'javisvn'
const PIPE_ENDPOINT = '\\\\.\\pipe\\javisvn-agent-broker'
const TOKEN_ENV = 'JAVISVN_MCP_TOKEN'
const DEBUG_ENV = 'JAVISVN_MCP_DEBUG'
const VERSION = process.env.JAVISVN_BRIDGE_VERSION || '0.0.0'

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

  const transport = new StdioServerTransport()
  await server.connect(transport)
  logDebug('stdio server ready')

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

  transport.onclose = () => {
    void shutdown(0, 'transport closed')
  }
  broker.onClose(() => {
    void shutdown(1, 'broker closed')
  })
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Error desconocido'}\n`)
  process.exit(1)
})
