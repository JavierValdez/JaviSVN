import { runSvn } from './svn-runtime'
export { filterSslNoise } from './update-contract'
import { filterSslNoise } from './update-contract'

export interface UpdateLocalRepoOptions {
  onData?: (chunk: string) => void
  onErrorData?: (chunk: string) => void
}

export interface UpdateLocalRepoResult {
  success: true
  output: string
}

export async function updateLocalRepo(
  repoPath: string,
  options: UpdateLocalRepoOptions = {}
): Promise<UpdateLocalRepoResult> {
  try {
    const { stdout, stderr } = await runSvn(
      ['update'],
      {
        cwd: repoPath,
        timeoutMs: 10 * 60 * 1000,
        onData: options.onData,
        onErrorData: (chunk) => {
          const filtered = filterSslNoise(chunk)
          if (filtered.trim()) options.onErrorData?.(filtered)
        }
      }
    )
    return { success: true, output: stdout || stderr }
  } catch (error) {
    const message = error instanceof Error ? String(error.message || '').trim() : ''
    throw new Error(message || 'Error al actualizar el repositorio')
  }
}
