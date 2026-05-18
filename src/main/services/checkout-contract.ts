import { basename } from 'node:path'

export function sanitizeLocalRepoName(targetName: string): string {
  const safeName = String(targetName || '').trim()
  if (!safeName) throw new Error('El nombre del directorio local es requerido')
  if (safeName === '.' || safeName === '..') {
    throw new Error('Nombre de directorio inválido')
  }
  if (/[<>:"/\\|?*\u0000-\u001f]/.test(safeName)) {
    throw new Error('El nombre del directorio local contiene caracteres no permitidos')
  }
  return safeName
}

export function deriveCheckoutTargetName(url: string): string {
  try {
    const parsed = new URL(url)
    const raw = decodeURIComponent(parsed.pathname.replace(/\/+$/g, ''))
    return sanitizeLocalRepoName(basename(raw) || 'repositorio')
  } catch {
    const raw = String(url || '').trim().replace(/\/+$/g, '')
    return sanitizeLocalRepoName(basename(raw) || 'repositorio')
  }
}
