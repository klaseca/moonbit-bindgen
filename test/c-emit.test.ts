import assert from 'node:assert/strict'
import test from 'node:test'

import { createApiModel, createBindingEmitters, lowerBindings } from '../src/bindings/c/index.ts'
import { normalizeConfig } from '../src/bindings/c/c-config.ts'
import { generateFiles } from '../src/core/index.ts'
import { parseCType } from '../src/bindings/c/sources/regex/c-regex-type.ts'

const c = parseCType

test('built-in emitters generate MoonBit externs and C stubs', () => {
  const model = createApiModel({
    headers: [
      {
        path: 'SDL_video.h',
        include: '<SDL3/SDL_video.h>',
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
            cName: 'SDL_DestroyWindow',
            returnType: c('void'),
            params: [{ name: 'window', type: c('SDL_Window *') }],
          },
          {
            kind: 'function',
            cName: 'SDL_GetWindowSize',
            returnType: c('bool'),
            params: [
              { name: 'window', type: c('SDL_Window *') },
              { name: 'w', type: c('int *') },
              { name: 'h', type: c('int *') },
            ],
          },
          {
            kind: 'function',
            cName: 'SDL_UseRect',
            returnType: c('bool'),
            params: [{ name: 'rect', type: c('SDL_Rect *') }],
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
        ],
      },
    ],
  })
  const config = normalizeConfig({
    namespace: 'sdl',
    symbolPrefix: 'moonbit_sdl',
    namePrefixes: ['SDL_'],
    resources: {
      SDL_Window: { release: 'SDL_DestroyWindow', defaultLifetime: 'owned' },
    },
    valueStructs: {
      SDL_Rect: {},
    },
    functions: ['SDL_CreateWindow', 'SDL_DestroyWindow', 'SDL_GetWindowSize', 'SDL_UseRect'],
  })

  const files = generateFiles(lowerBindings(model, config), createBindingEmitters())

  assert.deepEqual(
    [...files.keys()],
    ['video_gen.mbt', 'video_stub_gen.c', 'rect_gen.mbt', 'rect_stub_gen.c'],
  )
  assert.match(files.get('video_gen.mbt')!, /pub type Window/)
  assert.match(
    files.get('video_gen.mbt')!,
    /pub extern "c" fn create_window\(title : Bytes, width : Int, height : Int\) -> Window = "moonbit_sdl_create_window"/,
  )
  assert.match(files.get('video_stub_gen.c')!, /moonbit_make_external_object/)
  assert.match(files.get('video_stub_gen.c')!, /#include <SDL3\/SDL_video\.h>/)
  assert.match(files.get('video_stub_gen.c')!, /moonbit_sdl_window_resource_t/)
  assert.match(
    files.get('video_stub_gen.c')!,
    /SDL_CreateWindow\(\(const char \*\)title, width, height\)/,
  )
  assert.match(files.get('video_stub_gen.c')!, /int w_value = 0;/)
  assert.match(files.get('video_stub_gen.c')!, /if \(w != NULL\) \*w = w_value;/)
  assert.match(files.get('video_gen.mbt')!, /extern "c" fn use_rect_ffi\(rect : Bytes\) -> Bool/)
  assert.match(files.get('video_gen.mbt')!, /pub fn use_rect\(rect : Rect\) -> Bool/)
  assert.match(
    files.get('rect_gen.mbt')!,
    /pub fn Rect::Rect\(x : Int, y : Int, w : Int, h : Int\)/,
  )
  assert.match(files.get('rect_stub_gen.c')!, /moonbit_sdl_rect_make/)
  assert.match(files.get('rect_stub_gen.c')!, /#include "SDL_rect\.h"/)
})
