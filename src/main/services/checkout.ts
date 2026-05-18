import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { runSvn } from './svn-runtime'
import { BASE_REPO_PATH } from './local-paths'
import { buildHistoricalRemoteTarget } from './read-contract'
export {
  deriveCheckoutTargetName,
  sanitizeLocalRepoName
} from './checkout-contract'
import { sanitizeLocalRepoName } from './checkout-contract'

export interface CheckoutRemoteOptions {
  revision?: number
  onData?: (chunk: string) => void
  onErrorData?: (chunk: string) => void
}

export interface CheckoutRemoteResult {
  success: true
  path: string
  targetName: string
}

export async function checkoutRemoteToLocalRepo(
  url: string,
  targetName: string,
  options: CheckoutRemoteOptions = {}
): Promise<CheckoutRemoteResult> {
  const target = buildHistoricalRemoteTarget(url, options.revision)
  const safeTargetName = sanitizeLocalRepoName(targetName)
  const targetPath = join(BASE_REPO_PATH, safeTargetName)

  if (existsSync(targetPath)) {
    throw new Error(`Ya existe un directorio con el nombre "${safeTargetName}"`)
  }

  try {
    await runSvn(
      ['checkout', ...target.revisionArgs, target.targetUrl, targetPath],
      {
        timeoutMs: 10 * 60 * 1000,
        onData: options.onData,
        onErrorData: options.onErrorData
      }
    )
    return { success: true, path: targetPath, targetName: safeTargetName }
  } catch (error) {
    const message = error instanceof Error ? String(error.message || '').trim() : ''
    throw new Error(message || 'Error al descargar el repositorio')
  }
}
