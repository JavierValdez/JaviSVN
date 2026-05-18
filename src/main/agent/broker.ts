import { randomUUID, timingSafeEqual } from 'node:crypto'
import { existsSync, rmSync } from 'node:fs'
import { createServer, Socket, Server } from 'node:net'
import { AgentSession, BrokerHello, BrokerHelloResponse, BrokerProgress, BrokerRequest, BrokerResponse } from './protocol'

export interface BrokerServerOptions {
  endpoint: string
  getToken: () => string | null
  handleRequest: (
    session: AgentSession,
    request: BrokerRequest,
    emitProgress: (progress: unknown) => void
  ) => Promise<unknown>
  onSessionConnected?: (session: AgentSession) => void
  onSessionDisconnected?: (session: AgentSession) => void
}

interface SessionConnection {
  session: AgentSession
  socket: Socket
}

function safeTokenEquals(left: string | null, right: string): boolean {
  if (!left) return false
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  if (leftBuffer.length !== rightBuffer.length) return false
  return timingSafeEqual(leftBuffer, rightBuffer)
}

export class AgentBrokerServer {
  private server: Server | null = null
  private readonly sessions = new Map<string, SessionConnection>()

  constructor(private readonly options: BrokerServerOptions) {}

  async start(): Promise<void> {
    if (this.server) return
    if (process.platform !== 'win32' && existsSync(this.options.endpoint)) {
      rmSync(this.options.endpoint, { force: true })
    }

    this.server = createServer((socket) => this.accept(socket))
    await new Promise<void>((resolvePromise, reject) => {
      this.server?.once('error', reject)
      this.server?.listen(this.options.endpoint, () => {
        this.server?.off('error', reject)
        resolvePromise()
      })
    })
  }

  async stop(): Promise<void> {
    for (const { socket } of this.sessions.values()) {
      socket.destroy()
    }
    this.sessions.clear()

    if (!this.server) return
    await new Promise<void>((resolvePromise) => this.server?.close(() => resolvePromise()))
    this.server = null
    if (process.platform !== 'win32' && existsSync(this.options.endpoint)) {
      rmSync(this.options.endpoint, { force: true })
    }
  }

  listSessions(): AgentSession[] {
    return Array.from(this.sessions.values()).map(({ session }) => session)
  }

  isRunning(): boolean {
    return Boolean(this.server)
  }

  disconnectAll(): void {
    for (const { socket } of this.sessions.values()) socket.destroy()
    this.sessions.clear()
  }

  private accept(socket: Socket): void {
    let buffer = ''
    let authenticatedSession: AgentSession | null = null

    const send = (payload: BrokerHelloResponse | BrokerResponse | BrokerProgress) => {
      socket.write(`${JSON.stringify(payload)}\n`)
    }

    socket.on('data', async (chunk) => {
      buffer += chunk.toString('utf-8')
      while (buffer.includes('\n')) {
        const newlineIndex = buffer.indexOf('\n')
        const raw = buffer.slice(0, newlineIndex)
        buffer = buffer.slice(newlineIndex + 1)
        if (!raw.trim()) continue

        let message: unknown
        try {
          message = JSON.parse(raw)
        } catch {
          socket.destroy()
          return
        }

        if (!authenticatedSession) {
          const hello = message as BrokerHello
          if (hello?.type !== 'hello' || !safeTokenEquals(this.options.getToken(), String(hello.token || ''))) {
            send({ type: 'hello', ok: false, error: 'Token MCP inválido' })
            socket.destroy()
            return
          }

          authenticatedSession = {
            id: randomUUID(),
            clientId: String(hello.clientId || randomUUID()),
            clientName: String(hello.clientName || 'MCP client'),
            clientVersion: hello.clientVersion ? String(hello.clientVersion) : undefined,
            connectedAt: new Date().toISOString()
          }
          this.sessions.set(authenticatedSession.id, { session: authenticatedSession, socket })
          send({ type: 'hello', ok: true, sessionId: authenticatedSession.id })
          this.options.onSessionConnected?.(authenticatedSession)
          continue
        }

        const request = message as BrokerRequest
        if (!request?.id || !request?.method) {
          socket.destroy()
          return
        }

        try {
          const result = await this.options.handleRequest(authenticatedSession, request, (progress) => {
            send({ type: 'progress', requestId: request.id, progress })
          })
          send({ id: request.id, ok: true, result })
        } catch (error) {
          send({
            id: request.id,
            ok: false,
            error: error instanceof Error ? error.message : 'Error interno del broker'
          })
        }
      }
    })

    socket.on('close', () => {
      if (!authenticatedSession) return
      this.sessions.delete(authenticatedSession.id)
      this.options.onSessionDisconnected?.(authenticatedSession)
    })
  }
}
