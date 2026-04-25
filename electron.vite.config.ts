import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// Fix for Electron 32: `import __cjs_mod__ from 'node:module'` fails
// because node:module has no default export in Electron's ESM loader.
// Replace with namespace import which exposes named exports.
function fixCjsShimPlugin() {
  return {
    name: 'fix-cjs-shim',
    generateBundle(_: any, bundle: any) {
      for (const chunk of Object.values(bundle) as any[]) {
        if (chunk.type === 'chunk' && chunk.code) {
          // Replace default import with namespace import
          chunk.code = chunk.code.replace(
            `import __cjs_mod__ from "node:module";`,
            `import * as __cjs_mod__ from "node:module";`
          )
        }
      }
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(), fixCjsShimPlugin()],
  },
  preload: {
    plugins: [externalizeDepsPlugin(), fixCjsShimPlugin()],
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react()],
    optimizeDeps: {
      include: ['jszip']
    }
  }
})
