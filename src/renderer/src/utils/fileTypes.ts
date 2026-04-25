const PDF_RE = /\.pdf$/i
const DOCX_RE = /\.docx$/i

export function isPdfFile(path: string): boolean {
  return PDF_RE.test(path)
}

export function isWordFile(path: string): boolean {
  return DOCX_RE.test(path)
}

export function isPreviewableFile(path: string): boolean {
  return isPdfFile(path) || isWordFile(path)
}
