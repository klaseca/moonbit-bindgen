import assert from 'node:assert/strict'
import test from 'node:test'
import { parseCHeadersWithRegex } from '../src/bindings/c/sources/regex/c-regex-parser.ts'
import { normalizeConfig } from '../src/bindings/c/c-config.ts'
import { createBindingEmitters, lowerBindings } from '../src/bindings/c/index.ts'
import { generateFiles } from '../src/core/index.ts'

test('selected enum constants preserve values of preceding unselected entries', () => {
  const model = parseCHeadersWithRegex({
    headers: [
      {
        path: 'fixture.h',
        outputBase: 'fixture',
        source: `
        typedef enum {
          OTHER_ZERO, OTHER_ONE, SELECT_TWO,
          OTHER_TEN = 0x0a, SELECT_ELEVEN,
          OTHER_NEGATIVE = -3, SELECT_NEGATIVE_TWO
        } fixture_t;
      `,
      },
    ],
    constantPrefixes: ['SELECT_'],
    constantType: () => 'Int32',
  })
  const files = generateFiles(
    lowerBindings(model, normalizeConfig({ namespace: 'fixture' })),
    createBindingEmitters(),
  )
  const output = files.get('fixture_gen.mbt')!
  assert.match(output, /SELECT_TWO : Int32 = 2\b/)
  assert.match(output, /SELECT_ELEVEN : Int32 = 11\b/)
  assert.match(output, /SELECT_NEGATIVE_TWO : Int32 = -2\b/)
})
