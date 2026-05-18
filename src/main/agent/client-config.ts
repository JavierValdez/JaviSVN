export interface AgentClientLaunchConfig {
  command: string
  args: string[]
}

function quoteCmdArg(value: string): string {
  return `"${String(value).replace(/"/g, '""')}"`
}

export function buildAgentClientLaunchConfig(input: {
  platform: NodeJS.Platform
  execPath: string
  launchArgs: string[]
  comSpec?: string
}): AgentClientLaunchConfig {
  if (input.platform === 'darwin') {
    return {
      command: '/usr/bin/env',
      args: ['-u', 'ELECTRON_RUN_AS_NODE', input.execPath, ...input.launchArgs]
    }
  }

  if (input.platform === 'win32') {
    const commandLine = [
      'set "ELECTRON_RUN_AS_NODE="',
      '&&',
      quoteCmdArg(input.execPath),
      ...input.launchArgs.map(quoteCmdArg)
    ].join(' ')
    return {
      command: input.comSpec || 'cmd.exe',
      args: ['/d', '/s', '/c', commandLine]
    }
  }

  return {
    command: input.execPath,
    args: input.launchArgs
  }
}
