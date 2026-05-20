# MCP bridge (Windows)

Standalone Node.js binary that exposes the JaviSVN MCP surface over stdio.

## Why this exists

`JaviSVN.exe` is an Electron GUI app (Windows subsystem `WINDOWS_GUI`). On
Windows that has two consequences for MCP stdio:

1. The exe **does not propagate stdin/stdout** functionally to the parent
   process when invoked from a console MCP client.
2. Many MCP clients (Kiro CLI, Claude Desktop, VS Code Copilot) are themselves
   Electron-based and inherit `ELECTRON_RUN_AS_NODE=1` to child processes. The
   `mcp.json` config can only override env vars, not delete them, and on Windows
   an empty value (`""`) leaves the variable defined — so Electron starts in
   Node mode and stdin gets parsed as JavaScript. SyntaxError.

On macOS neither problem applies: there is no GUI/Console subsystem split, and
`/usr/bin/env -u ELECTRON_RUN_AS_NODE` actually unsets the variable.

## What this bridge does

A small Node.js program that:

1. Connects to the broker named pipe (`\\.\pipe\javisvn-agent-broker`) that
   the GUI app already exposes when "Integracion IA" is enabled.
2. Implements an MCP stdio server reusing `src/main/agent/broker-client.ts`
   and `src/main/agent/mcp-surface.ts`. Same protocol, same tools/resources.
3. Is packaged as a single Windows console executable (`JaviSvnMcp.exe`) using
   Node SEA (Single Executable Applications). The exe is installed alongside
   `JaviSVN.exe` by the NSIS installer (via `extraFiles` in
   `electron-builder.win`).

The GUI app (`JaviSVN.exe`) is **unchanged**. It still starts the broker.
Only the binary that the MCP client invokes from `mcp.json` changes.

## Build

```bash
# Bundle only (no .exe; works on any platform):
npm run build:mcp-bridge:bundle

# Bundle + Node SEA executable (Windows only):
npm run build:mcp-bridge
```

Outputs go to `dist-mcp-bridge/`:
- `bridge.cjs` — bundled JS (esbuild)
- `JaviSvnMcp.exe` — standalone Windows binary (only when run on Windows)

The full `npm run build` chain is:

```
node scripts/bundle-svn.mjs
electron-vite build
npm run build:mcp-bridge   # generates JaviSvnMcp.exe on Windows
electron-builder            # NSIS picks it up via win.extraFiles
```

## Test locally

```powershell
# Make sure JaviSVN.exe is running and "Integracion IA" is enabled.
$env:JAVISVN_MCP_TOKEN = "<token from the app's Integracion IA settings>"
node mcp-bridge\test-client.cjs dist-mcp-bridge\JaviSvnMcp.exe
```

Expected output: `INITIALIZE OK`, `TOOLS LIST OK`, 18 tools listed.

## mcp.json sample (Windows)

After installation the bridge is at `<install-dir>\JaviSvnMcp.exe`. The sample
emitted by the app (`getAgentClientConfig`) already points there.

```json
{
  "mcpServers": {
    "javisvn": {
      "command": "C:\\Users\\<user>\\AppData\\Local\\Programs\\javisvn\\JaviSvnMcp.exe",
      "args": [],
      "env": {
        "JAVISVN_MCP_TOKEN": "<token>"
      }
    }
  }
}
```

No `ELECTRON_RUN_AS_NODE` is needed because the bridge is plain Node, not
Electron.

## Architecture

```
+------------------+         stdio (JSON-RPC)        +-----------------+
| MCP client       | <---------------------------->  | JaviSvnMcp.exe  |
| (Kiro, Claude…)  |                                 |  (Node SEA, CUI)|
+------------------+                                 +--------+--------+
                                                              |
                                              named pipe      |
                                              (broker)        v
                                                     +---------------------+
                                                     |  JaviSVN.exe (GUI)  |
                                                     | broker + tools impl |
                                                     +---------------------+
```
