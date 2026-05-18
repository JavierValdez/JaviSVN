import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { AgentActivityEntry } from './protocol'

export class AgentActivityLog {
  constructor(
    private readonly filePath: string,
    private readonly maxEntries = 500
  ) {}

  list(): AgentActivityEntry[] {
    try {
      if (!existsSync(this.filePath)) return []
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf-8'))
      return Array.isArray(parsed) ? parsed as AgentActivityEntry[] : []
    } catch {
      return []
    }
  }

  append(entry: AgentActivityEntry): AgentActivityEntry[] {
    const next = [...this.list(), entry].slice(-this.maxEntries)
    writeFileSync(this.filePath, JSON.stringify(next, null, 2), 'utf-8')
    return next
  }

  clear(): void {
    writeFileSync(this.filePath, '[]', 'utf-8')
  }
}
