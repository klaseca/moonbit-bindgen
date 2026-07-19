import assert from 'node:assert/strict'
import test from 'node:test'

import { defineConfig } from '../src/bindings/c/index.ts'

test('defineConfig preserves the typed generator JSON config', () => {
  const config = defineConfig({
    projectRoot: '..',
    includeDir: 'externals/include',
    outputDir: 'modules/example-sys/src',
    headers: ['example.h'],
    functionMode: 'explicit',
    unsupportedPolicy: 'error',
    functions: ['example_create'],
    resources: {
      example_t: { release: 'example_destroy', defaultLifetime: 'owned' },
    },
    renames: {
      types: { example_string_t: 'NativeString' },
    },
  })
  const mode: 'explicit' = config.functionMode

  assert.equal(mode, 'explicit')
  assert.equal(config.headers?.[0], 'example.h')
  assert.equal(config.renames?.types?.['example_string_t'], 'NativeString')
})
