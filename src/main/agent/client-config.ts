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
    // On Windows, when stdioEnvKey is set, launch the exe directly with env vars.
    // This avoids cmd.exe quoting hell, parser corruption from JSON backslash
    // escaping, and the ELECTRON_RUN_AS_NODE orphan problem.
    // The env vars (MCP_STDIO=1, MCP_TOKEN, etc.) are passed via the
    // mcp.json "env" section, not via cmd.exe set commands.
    if (input.stdioEnvKey) {
      return {
        command: input.execPath,
        args: []
      }
    }
    // Legacy: without stdioEnvKey, use cmd.exe wrapper with --mcp-stdio flag
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
