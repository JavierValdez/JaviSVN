export function formatClipboardText(text: string): string {
  return String(text || '').replace(/%20/gi, ' ')
}
