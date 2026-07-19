import assert from 'node:assert/strict'
import test from 'node:test'

import { normalizeConfig } from '../src/bindings/c/c-config.ts'
import { AbiKind, createApiModel, lowerBindings } from '../src/bindings/c/index.ts'
import { parseCType } from '../src/bindings/c/sources/regex/c-regex-type.ts'

const c = parseCType

function fixture() {
  return createApiModel({
    headers: [
      {
        path: 'SDL_video.h',
        outputBase: 'video',
        declarations: [
          { kind: 'opaque-type', cName: 'SDL_Window' },
          {
            kind: 'function',
            cName: 'SDL_CreateWindow',
            returnType: c('SDL_Window *'),
            params: [
              { name: 'title', type: c('const char *') },
              { name: 'width', type: c('int') },
              { name: 'height', type: c('int') },
            ],
          },
          {
            kind: 'function',
            cName: 'SDL_GetWindowFromID',
            returnType: c('SDL_Window *'),
            params: [{ name: 'id', type: c('uint32_t') }],
          },
          {
            kind: 'function',
            cName: 'SDL_DestroyWindow',
            returnType: c('void'),
            params: [{ name: 'window', type: c('SDL_Window *') }],
          },
        ],
      },
      {
        path: 'SDL_rect.h',
        outputBase: 'rect',
        declarations: [
          {
            kind: 'value-struct',
            cName: 'SDL_Rect',
            fields: [
              { name: 'x', type: c('int') },
              { name: 'y', type: c('int') },
              { name: 'w', type: c('int') },
              { name: 'h', type: c('int') },
            ],
          },
          {
            kind: 'function',
            cName: 'SDL_GetRect',
            returnType: c('bool'),
            params: [{ name: 'rect', type: c('SDL_Rect *') }],
          },
        ],
      },
    ],
  })
}

test('resources are canonical types in generated signatures', () => {
  const config = normalizeConfig({
    namespace: 'sdl',
    namePrefixes: ['SDL_'],
    resources: {
      SDL_Window: { release: 'SDL_DestroyWindow', defaultLifetime: 'owned' },
    },
    valueStructs: {
      SDL_Rect: {},
    },
    functions: [
      'SDL_CreateWindow',
      {
        name: 'SDL_GetWindowFromID',
        return: { lifetime: 'unmanaged' },
      },
      'SDL_GetRect',
    ],
  })
  const binding = lowerBindings(fixture(), config)

  const create = binding.functions.find((fn) => fn.cName === 'SDL_CreateWindow')
  assert.ok(create)
  assert(create.returnType.kind === AbiKind.Resource)
  assert.equal(create.returnType.moonbit, 'Window')
  assert.equal(create.returnType.lifetime.kind, 'owned')
  const createTitle = create.params[0]
  assert.ok(createTitle)
  assert.equal(createTitle.lowered.kind, AbiKind.CStringParameter)

  const lookup = binding.functions.find((fn) => fn.cName === 'SDL_GetWindowFromID')
  assert.ok(lookup)
  assert(lookup.returnType.kind === AbiKind.Resource)
  assert.equal(lookup.returnType.moonbit, 'Window')
  assert.equal(lookup.returnType.lifetime.kind, 'unmanaged')

  const getRect = binding.functions.find((fn) => fn.cName === 'SDL_GetRect')
  assert.ok(getRect)
  const rect = getRect.params[0]
  assert.ok(rect)
  assert.equal(rect.lowered.kind, AbiKind.ValueStruct)
  assert.equal(rect.lowered.moonbit, 'Rect')
})

test('generation plan stays grouped by source header', () => {
  const config = normalizeConfig({
    namespace: 'sdl',
    namePrefixes: ['SDL_'],
    resources: {
      SDL_Window: { release: 'SDL_DestroyWindow', defaultLifetime: 'owned' },
    },
    valueStructs: {
      SDL_Rect: {},
    },
    functions: ['SDL_CreateWindow', 'SDL_GetRect'],
  })
  const binding = lowerBindings(fixture(), config)

  assert.deepEqual(
    binding.headers.map((header) => [header.outputBase, header.functions.map((fn) => fn.moonbit)]),
    [
      ['video', ['create_window', 'destroy_window']],
      ['rect', ['get_rect']],
    ],
  )
})

test('explicit type renames override generated names', () => {
  const config = normalizeConfig({
    namespace: 'sdl',
    namePrefixes: ['SDL_'],
    typeRenames: {
      SDL_Window: 'NativeWindow',
      SDL_Rect: 'NativeRect',
    },
    resources: {
      SDL_Window: { release: 'SDL_DestroyWindow', defaultLifetime: 'owned' },
    },
    valueStructs: {
      SDL_Rect: {},
    },
    functions: ['SDL_CreateWindow', 'SDL_GetRect'],
  })
  const binding = lowerBindings(fixture(), config)

  assert.equal(
    binding.functions.find((fn) => fn.cName === 'SDL_CreateWindow')?.returnType.moonbit,
    'NativeWindow',
  )
  assert.equal(
    binding.functions.find((fn) => fn.cName === 'SDL_GetRect')?.params[0]?.lowered.moonbit,
    'NativeRect',
  )
})
