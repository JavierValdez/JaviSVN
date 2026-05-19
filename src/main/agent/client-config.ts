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
  stdioEnvKey?: string
}): AgentClientLaunchConfig {
  if (input.platform === 'darwin') {
    return {
      command: '/usr/bin/env',
      args: ['-u', 'ELECTRON_RUN_AS_NODE', input.execPath, ...input.launchArgs]
    }
  }

  if (input.platform === 'win32') {
    // On Windows, use env var instead of CLI flag for MCP stdio mode.
    // This avoids cmd.exe quoting hell and Electron argument parsing issues.
    const setEnv = input.stdioEnvKey
      ? `set "ELECTRON_RUN_AS_NODE=" && set "${input.stdioEnvKey}=1" && ${quoteCmdArg(input.execPath)}`
      : `set "ELECTRON_RUN_AS_NODE=" && ${quoteCmdArg(input.execPath)} ${input.launchArgs.map(quoteCmdArg).join(' ')}`;
    return {
      command: input.comSpec || 'cmd.exe',
      args: ['/d', '/s', '/c', setEnv]
    }
  }

  return {
    command: input.execPath,
    args: input.launchArgs
  }
}
