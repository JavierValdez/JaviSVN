// bundle-svn.mjs
// Cross-platform runner: ejecuta el script de bundling SVN según la plataforma.
// En macOS/Linux -> bash scripts/bundle-svn.sh
// En Windows     -> powershell scripts/bundle-svn.ps1

import { spawnSync } from 'child_process'
import { platform } from 'process'

let result

if (platform === 'win32') {
  result = spawnSync(
    'powershell.exe',
    ['-ExecutionPolicy', 'Bypass', '-File', 'scripts/bundle-svn.ps1'],
    { stdio: 'inherit', shell: false }
  )
} else {
  result = spawnSync('bash', ['scripts/bundle-svn.sh'], { stdio: 'inherit' })
}

process.exit(result.status ?? 1)
