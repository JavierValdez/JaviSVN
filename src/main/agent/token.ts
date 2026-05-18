import { randomBytes } from 'node:crypto'

export function generateAgentToken(): string {
  return randomBytes(32).toString('hex')
}
