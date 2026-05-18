import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtempSync, rmSync } from 'node:fs'
import { AgentActivityLog } from '../src/main/agent/activity-log'
import { createActivityEntry } from '../src/main/agent/protocol'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('activity log keeps only the configured retention window', () => {
  const dir = mkdtempSync(join(tmpdir(), 'javisvn-activity-test-'))
  tempDirs.push(dir)
  const log = new AgentActivityLog(join(dir, 'activity.json'), 3)

  for (let index = 0; index < 5; index += 1) {
    log.append(createActivityEntry({
      kind: 'tool',
      clientId: 'client',
      clientName: 'Client',
      action: `tool-${index}`,
      ok: true
    }))
  }

  assert.deepEqual(log.list().map((entry) => entry.action), ['tool-2', 'tool-3', 'tool-4'])
  log.clear()
  assert.deepEqual(log.list(), [])
})
