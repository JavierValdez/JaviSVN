import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildAgentClientLaunchConfig } from '../src/main/agent/client-config'

test('client config clears ELECTRON_RUN_AS_NODE on macOS', () => {
  assert.deepEqual(buildAgentClientLaunchConfig({
    platform: 'darwin',
    execPath: '/Applications/JaviSVN.app/Contents/MacOS/JaviSVN',
    launchArgs: ['--mcp-stdio']
  }), {
    command: '/usr/bin/env',
    args: [
      '-u',
      'ELECTRON_RUN_AS_NODE',
      '/Applications/JaviSVN.app/Contents/MacOS/JaviSVN',
      '--mcp-stdio'
    ]
  })
})

test('client config clears ELECTRON_RUN_AS_NODE on Windows through cmd.exe', () => {
  assert.deepEqual(buildAgentClientLaunchConfig({
    platform: 'win32',
    execPath: 'D:\\Users\\cmmorale\\AppData\\Local\\Programs\\javisvn\\JaviSVN.exe',
    launchArgs: ['--mcp-stdio'],
    comSpec: 'C:\\Windows\\System32\\cmd.exe'
  }), {
    command: 'C:\\Windows\\System32\\cmd.exe',
    args: [
      '/d',
      '/s',
      '/c',
      'set "ELECTRON_RUN_AS_NODE=" && "D:\\Users\\cmmorale\\AppData\\Local\\Programs\\javisvn\\JaviSVN.exe" "--mcp-stdio"'
    ]
  })
})

test('client config uses direct launch on other platforms', () => {
  assert.deepEqual(buildAgentClientLaunchConfig({
    platform: 'linux',
    execPath: '/opt/JaviSVN/javisvn',
    launchArgs: ['--mcp-stdio']
  }), {
    command: '/opt/JaviSVN/javisvn',
    args: ['--mcp-stdio']
  })
})
