import { basename } from 'node:path'

export function getInvalidLocalEntryNameReason(
  entryName: string,
  platform: NodeJS.Platform = process.platform
): string | null {
  const name = String(entryName ?? '')
  if (!name) return 'nombre vacío'
  if (name.length > 255) return 'supera 255 caracteres'
  if (name === '.' || name === '..') return 'nombre reservado'
  if (/[\u0000-\u001f]/.test(name)) return 'caracteres de control'
  if (/[\\/]/.test(name)) return 'separadores de ruta'

  if (platform === 'win32') {
    if (/[<>:"|?*]/.test(name)) return 'caracteres no permitidos en Windows'
    if (/[. ]$/.test(name)) return 'termina en punto o espacio'

    const baseName = name.split('.')[0]
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(baseName)) {
      return 'nombre reservado en Windows'
    }
  }

  return null
}

export function getInvalidLocalPathReason(
  relativePath: string,
  platform: NodeJS.Platform = process.platform
): string | null {
  const parts = String(relativePath || '').split('/').filter(Boolean)
  if (parts.length === 0) return 'ruta vacía'

  for (const part of parts) {
    const reason = getInvalidLocalEntryNameReason(part, platform)
    if (reason) return `${part}: ${reason}`
  }

  return null
}

export function sanitizeLocalRepoName(targetName: string): string {
  const safeName = String(targetName || '').trim()
  if (!safeName) throw new Error('El nombre del directorio local es requerido')
  if (safeName === '.' || safeName === '..') {
    throw new Error('Nombre de directorio inválido')
  }
  const invalidReason = getInvalidLocalEntryNameReason(safeName)
  if (invalidReason) {
    throw new Error(`El nombre del directorio local contiene caracteres no permitidos (${invalidReason})`)
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
