import assert from 'node:assert/strict'
import test from 'node:test'

import { toMoonBitTypeName } from '../src/bindings/c/c-naming.ts'

test('type prefixes are removed without language-specific exceptions', () => {
  assert.equal(toMoonBitTypeName('sk_surface_t', ['sk_']), 'Surface')
  assert.equal(toMoonBitTypeName('sk_string_t', ['sk_']), 'String')
})
