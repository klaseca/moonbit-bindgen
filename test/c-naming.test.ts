import assert from 'node:assert/strict'
import test from 'node:test'

import {
  escapeIdentifier,
  toMoonBitFieldName,
  toMoonBitFunctionName,
  toMoonBitTypeName,
} from '../src/bindings/c/c-naming.ts'

test('type prefixes are removed without language-specific exceptions', () => {
  assert.equal(toMoonBitTypeName('sk_surface_t', ['sk_']), 'Surface')
  assert.equal(toMoonBitTypeName('sk_string_t', ['sk_']), 'String')
})

test('C binding escapes keywords, reserved words and compatibility spellings', () => {
  for (const name of [
    'derive',
    'readonly',
    'async',
    'nocancel',
    'where',
    'declare',
    'nobreak',
    'extend',
    'package',
    'opaque',
    'constructor',
    'enumview',
    'typealias',
    '_',
  ]) {
    assert.equal(escapeIdentifier(name), `${name}_`)
  }
  assert.equal(escapeIdentifier('window_id'), 'window_id')
  assert.equal(toMoonBitFieldName('windowID'), 'window_id')
  assert.equal(toMoonBitFieldName('Readonly'), 'readonly_')
  assert.equal(toMoonBitFunctionName('api_derive', ['api_']), 'derive_')
})
