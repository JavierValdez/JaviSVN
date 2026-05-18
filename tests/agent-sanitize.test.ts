import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sanitizeLocalRepo, sanitizeRemoteEntry } from '../src/main/agent/sanitize'

test('agent sanitizers omit filesystem paths from MCP payloads', () => {
  assert.deepEqual(sanitizeLocalRepo({
    id: 'repo-1',
    name: 'Repo',
    path: '/Users/example/Documents/JaviSvn/Repo',
    url: 'https://svn.example.com/repo',
    revision: 10,
    lastUpdated: '2026-05-18T00:00:00.000Z',
    changesCount: 2,
    author: 'javier'
  }), {
    id: 'repo-1',
    name: 'Repo',
    url: 'https://svn.example.com/repo',
    revision: 10,
    lastUpdated: '2026-05-18T00:00:00.000Z',
    changesCount: 2,
    author: 'javier'
  })

  assert.deepEqual(sanitizeRemoteEntry({
    name: 'trunk',
    url: 'https://svn.example.com/repo/trunk',
    kind: 'dir',
    revision: 10,
    author: 'javier',
    date: '2026-05-18T00:00:00.000Z',
    isCheckedOut: true,
    localPath: '/Users/example/Documents/JaviSvn/Repo'
  }), {
    name: 'trunk',
    url: 'https://svn.example.com/repo/trunk',
    kind: 'dir',
    revision: 10,
    author: 'javier',
    date: '2026-05-18T00:00:00.000Z',
    isCheckedOut: true
  })
})
