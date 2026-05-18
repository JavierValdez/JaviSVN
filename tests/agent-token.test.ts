import assert from 'node:assert/strict'
import { test } from 'node:test'
import { generateAgentToken } from '../src/main/agent/token'

test('agent tokens are random 256-bit hexadecimal strings', () => {
  const first = generateAgentToken()
  const second = generateAgentToken()

  assert.match(first, /^[a-f0-9]{64}$/)
  assert.match(second, /^[a-f0-9]{64}$/)
  assert.notEqual(first, second)
})
