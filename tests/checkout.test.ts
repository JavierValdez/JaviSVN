import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  deriveCheckoutTargetName,
  sanitizeLocalRepoName
} from '../src/main/services/checkout-contract'

test('checkout service validates local repo names', () => {
  assert.equal(sanitizeLocalRepoName('repo-local'), 'repo-local')
  assert.throws(() => sanitizeLocalRepoName(''), /requerido/)
  assert.throws(() => sanitizeLocalRepoName('..'), /inválido/)
  assert.throws(() => sanitizeLocalRepoName('repo/name'), /caracteres/)
})

test('checkout service derives target names from remote URLs', () => {
  assert.equal(
    deriveCheckoutTargetName('https://svn.example.com/repos/proyecto/trunk/'),
    'trunk'
  )
  assert.equal(
    deriveCheckoutTargetName('https://svn.example.com/repos/proyecto/mi%20rama'),
    'mi rama'
  )
})
