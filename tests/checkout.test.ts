import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  deriveCheckoutTargetName,
  getInvalidLocalEntryNameReason,
  getInvalidLocalPathReason,
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

test('checkout service detects Windows-only invalid SVN entry names', () => {
  assert.equal(getInvalidLocalEntryNameReason('normal.txt', 'win32'), null)
  assert.match(getInvalidLocalEntryNameReason('archivo.', 'win32') || '', /punto/)
  assert.match(getInvalidLocalEntryNameReason('archivo ', 'win32') || '', /espacio/)
  assert.match(getInvalidLocalEntryNameReason('CON.txt', 'win32') || '', /reservado/)
  assert.match(getInvalidLocalEntryNameReason('a?b.txt', 'win32') || '', /Windows/)
  assert.match(getInvalidLocalEntryNameReason('a'.repeat(256), 'win32') || '', /255/)
  assert.equal(getInvalidLocalEntryNameReason('archivo.', 'darwin'), null)
})

test('checkout service detects invalid path segments without trimming names', () => {
  assert.match(getInvalidLocalPathReason('dir/archivo.', 'win32') || '', /archivo\./)
  assert.match(getInvalidLocalPathReason('dir con espacio /ok.txt', 'win32') || '', /dir con espacio /)
  assert.equal(getInvalidLocalPathReason('dir/ok.txt', 'win32'), null)
})
