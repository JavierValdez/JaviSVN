// Build del bridge MCP standalone para Windows.
//
// Pipeline:
//   1. esbuild bundle  -> dist-mcp-bridge/bridge.cjs (todas las deps inline)
//   2. Si --sea, crear binario standalone con Node SEA (Single Executable Apps).
//      Resultado: dist-mcp-bridge/JaviSvnMcp.exe (CONSOLE subsystem).
//
// El .exe resultante es lo que el instalador de Windows shipea. La app GUI
// (JaviSVN.exe) NO cambia.

import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const SRC_ENTRY = resolve(ROOT, 'mcp-bridge/src/index.ts')
const OUT_DIR = resolve(ROOT, 'dist-mcp-bridge')
const BUNDLE_PATH = resolve(OUT_DIR, 'bridge.cjs')
const SEA_BLOB_PATH = resolve(OUT_DIR, 'sea-prep.blob')
const SEA_CONFIG_PATH = resolve(OUT_DIR, 'sea-config.json')
const EXE_NAME = 'JaviSvnMcp.exe'
const EXE_PATH = resolve(OUT_DIR, EXE_NAME)

const args = new Set(process.argv.slice(2))
const buildSea = args.has('--sea')

async function bundle() {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8'))
  const version = pkg.version || '0.0.0'

  if (!existsSync(OUT_DIR)) {
    mkdirSync(OUT_DIR, { recursive: true })
  }

  await build({
    entryPoints: [SRC_ENTRY],
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    outfile: BUNDLE_PATH,
    sourcemap: false,
    minify: false,
    legalComments: 'none',
    define: {
      'process.env.JAVISVN_BRIDGE_VERSION': JSON.stringify(version)
    },
    external: [],
    logLevel: 'info'
  })

  console.log(`[bundle] OK -> ${BUNDLE_PATH}`)
}

function buildSeaExe() {
  console.log('[sea] preparando blob...')
  const seaConfig = {
    main: BUNDLE_PATH,
    output: SEA_BLOB_PATH,
    disableExperimentalSEAWarning: true,
    useSnapshot: false,
    useCodeCache: true
  }
  writeFileSync(SEA_CONFIG_PATH, JSON.stringify(seaConfig, null, 2))

  const genBlob = spawnSync(
    process.execPath,
    ['--experimental-sea-config', SEA_CONFIG_PATH],
    { stdio: 'inherit' }
  )
  if (genBlob.status !== 0) {
    throw new Error(`[sea] generacion del blob fallo (exit ${genBlob.status})`)
  }

  console.log(`[sea] copiando node.exe (${process.execPath}) -> ${EXE_PATH}`)
  if (existsSync(EXE_PATH)) {
    rmSync(EXE_PATH, { force: true, maxRetries: 3, retryDelay: 200 })
  }
  copyFileSync(process.execPath, EXE_PATH)

  console.log('[sea] inyectando blob con postject...')
  const postjectMain = require.resolve('postject/dist/cli.js', {
    paths: [ROOT, join(ROOT, 'node_modules')]
  })
  const inject = spawnSync(
    process.execPath,
    [
      postjectMain,
      EXE_PATH,
      'NODE_SEA_BLOB',
      SEA_BLOB_PATH,
      '--sentinel-fuse',
      'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'
    ],
    { stdio: 'inherit' }
  )
  if (inject.status !== 0) {
    throw new Error(`[sea] postject fallo (exit ${inject.status})`)
  }

  console.log(`[sea] OK -> ${EXE_PATH}`)
}

;(async () => {
  await bundle()
  if (buildSea) {
    if (process.platform !== 'win32') {
      console.log('[sea] saltando: SEA solo se construye en Windows.')
      return
    }
    buildSeaExe()
  } else {
    console.log('[sea] saltando: pasa --sea para empaquetar como .exe.')
  }
})().catch((error) => {
  console.error(error)
  process.exit(1)
})
