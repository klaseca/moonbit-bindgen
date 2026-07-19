import assert from 'node:assert/strict'
import test from 'node:test'

import { renderCType } from '../src/bindings/c/c-type.ts'
import { normalizeCType, parseCType } from '../src/bindings/c/sources/regex/c-regex-type.ts'

test('normalizes and parses qualified pointers', () => {
  assert.equal(normalizeCType(' const  SDL_Rect  * '), 'const SDL_Rect *')
  assert.deepEqual(parseCType(' const  SDL_Rect  * '), {
    name: 'SDL_Rect',
    qualifiers: ['const'],
    pointers: [{ qualifiers: [] }],
  })
})

test('keeps multi-word primitive names', () => {
  assert.equal(parseCType('unsigned long').name, 'unsigned long')
})

test('preserves qualifiers on separate pointer levels', () => {
  const type = parseCType('const char * const * restrict')
  assert.deepEqual(type, {
    name: 'char',
    qualifiers: ['const'],
    pointers: [{ qualifiers: ['const'] }, { qualifiers: ['restrict'] }],
  })
  assert.equal(renderCType(type), 'const char * const * restrict')
})
