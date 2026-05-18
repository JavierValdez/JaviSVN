import assert from 'node:assert/strict'
import { test } from 'node:test'
import { filterSslNoise } from '../src/main/services/update-contract'

test('update service filters transient SSL noise from progress output', () => {
  const filtered = filterSslNoise(
    'Actualizando...\nsvn: E120171: Error running context\nA    archivo.txt\n'
  )
  assert.match(filtered, /Actualizando/)
  assert.match(filtered, /archivo\.txt/)
  assert.doesNotMatch(filtered, /E120171/)
})
