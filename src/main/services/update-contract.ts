const SSL_TRANSIENT_RE = /svn:\s+E1[12]\d{4}:.*(?:SSL|Unable to connect|Error running context)/i

export function filterSslNoise(chunk: string): string {
  return chunk
    .split('\n')
    .filter((line) => !SSL_TRANSIENT_RE.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
}
