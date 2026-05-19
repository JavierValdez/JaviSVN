# QA Analysis: Windows MCP still broken with env var approach

## Critical finding

QA tested with builds 1.9.7/1.0.12 (OLD - have stdin.once bug AND cmd.exe wrapper).

Case A (cmd.exe wrapper): Node tries to load .exe as script ("MZ" binary header → SyntaxError)
Case B (direct exe, no cmd.exe): Node enters eval_stdin mode, tries to parse JSON-RPC as JavaScript

## Root cause

cmd.exe `/s /c` with `\"` JSON escaping corrupts the command. The `set "ELECTRON_RUN_AS_NODE="` never actually clears the variable because the backslash escapes break cmd.exe's parser. The variable name becomes `\ELECTRON_RUN_AS_NODE\` (with literal backslashes).

Result: `ELECTRON_RUN_AS_NODE` remains set → Electron enters Node.js mode → process reads stdin as JS code → fails.

## The real fix

ELIMINATE cmd.exe entirely on Windows. Use direct .exe launch with env vars.

Instead of:
```
cmd.exe /d /s /c "set ELECTRON_RUN_AS_NODE= && set JAVISVN_MCP_STDIO=1 && JaviSVN.exe"
```

Use:
```
JaviSVN.exe
```
with env:
```
JAVISVN_MCP_STDIO=1
JAVISVN_MCP_TOKEN=...
```
No ELECTRON_RUN_AS_NODE in env at all.

This requires:
1. client-config.ts: when stdioEnvKey is set on Windows, return command=execPath with NO cmd.exe wrapper
2. isMcpStdioMode check: already supports MCP_STDIO=1 (no change needed)
3. spawnVisibleApp: already filters correctly (no change needed)
4. stdin.once handlers: already removed in v1.9.9/v1.0.14

The risk of NOT clearing ELECTRON_RUN_AS_NODE: if the user/system has it set globally, Electron enters Node mode. But this is an edge case. The MCP config from VS Code doesn't set it.

## Task for Opus 4.7

Lee el QA report y confirma:
1. El cmd.exe wrapper es el problema? 
2. Usar .exe directo con env vars es seguro en Windows?
3. Que pasa si ELECTRON_RUN_AS_NODE esta en el environment del sistema?
4. El approach de "sin cmd.exe, solo env vars" es el correcto?

Responde: SI este es el fix correcto, o NO y por que.
