import assert from 'node:assert/strict'
import test from 'node:test'

import { createApiModel, createBindingEmitters, lowerBindings } from '../src/bindings/c/index.ts'
import { normalizeConfig } from '../src/bindings/c/c-config.ts'
import { generateFiles } from '../src/core/index.ts'
import { parseCHeadersWithRegex } from '../src/bindings/c/sources/regex/c-regex-parser.ts'
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
          { kind: 'opaque-type', cName: 'SDL_Unmanaged' },
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
    [
      'video_gen.mbt',
      'video_stub_gen.c',
      'pointer_gen.mbt',
      'pointer_stub_gen.c',
      'value_gen.mbt',
      'value_stub_gen.c',
      'rect_gen.mbt',
      'rect_stub_gen.c',
    ],
  )
  assert.match(files.get('pointer_gen.mbt')!, /pub fn Pointer::null\(\) -> Pointer/)
  assert.match(files.get('pointer_stub_gen.c')!, /void \*moonbit_sdl_pointer_null\(void\)/)
  assert.match(files.get('video_gen.mbt')!, /pub type Window/)
  assert.match(
    files.get('video_gen.mbt')!,
    /pub extern "c" fn create_window\(title : Bytes, width : Int32, height : Int32\) -> Window = "moonbit_sdl_create_window"/,
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
  assert.match(
    files.get('video_gen.mbt')!,
    /extern "c" fn use_rect_ffi\(rect : Bytes, rect_offset : Int32\) -> Bool/,
  )
  assert.match(files.get('video_gen.mbt')!, /pub fn use_rect\(rect : Rect\) -> Bool/)
  assert.match(
    files.get('rect_gen.mbt')!,
    /pub fn Rect::Rect\(x : Int32, y : Int32, w : Int32, h : Int32\)/,
  )
  assert.match(files.get('rect_stub_gen.c')!, /moonbit_sdl_rect_make/)
  assert.match(files.get('rect_stub_gen.c')!, /#include "SDL_rect\.h"/)
})

test('16-bit scalars use 32-bit FFI types through typedefs and output parameters', () => {
  const valueStructs = {
    app_sample_t: { setters: { signed_value: 'set_signed', unsigned_value: 'set_unsigned' } },
  }
  const model = parseCHeadersWithRegex({
    headers: [
      {
        path: 'app.h',
        outputBase: 'scalars',
        source: `
typedef signed __int16 int16_t;
typedef unsigned __int16 uint16_t;
typedef int16_t app_signed_t;
typedef uint16_t app_unsigned_t;
typedef app_signed_t app_signed_alias_t;
typedef app_unsigned_t app_unsigned_alias_t;
typedef struct app_sample_t {
  app_signed_alias_t signed_value;
  app_unsigned_alias_t unsigned_value;
} app_sample_t;
extern short app_echo_short(short value);
extern unsigned short app_echo_ushort(unsigned short value);
extern int16_t app_echo_int16(int16_t value);
extern uint16_t app_echo_uint16(uint16_t value);
extern app_signed_alias_t app_echo_signed_alias(app_signed_alias_t value);
extern app_unsigned_alias_t app_echo_unsigned_alias(app_unsigned_alias_t value);
extern void app_read16(app_signed_alias_t *signed_value, app_unsigned_alias_t *unsigned_value);
`,
      },
    ],
    valueStructs,
  })
  const config = normalizeConfig({
    namespace: 'app',
    namePrefixes: ['app_'],
    functionMode: 'discover',
    valueStructs,
  })
  const files = generateFiles(lowerBindings(model, config), createBindingEmitters())
  const mbt = files.get('scalars_gen.mbt')!
  const stub = files.get('scalars_stub_gen.c')!

  for (const [name, moonbit, abi] of [
    ['echo_short', 'Int32', 'int32_t'],
    ['echo_ushort', 'UInt32', 'uint32_t'],
    ['echo_int16', 'Int32', 'int32_t'],
    ['echo_uint16', 'UInt32', 'uint32_t'],
    ['echo_signed_alias', 'Int32', 'int32_t'],
    ['echo_unsigned_alias', 'UInt32', 'uint32_t'],
  ]) {
    assert.ok(mbt.includes(`pub extern "c" fn ${name}(value : ${moonbit}) -> ${moonbit}`))
    assert.ok(stub.includes(`${abi} moonbit_app_${name}(${abi} value)`))
  }
  assert.match(mbt, /fn read16\(signed_value : Ref\[Int32\], unsigned_value : Ref\[UInt32\]\)/)
  assert.match(
    stub,
    /void moonbit_app_read16\(int32_t \* signed_value, uint32_t \* unsigned_value\)/,
  )
  assert.match(stub, /app_signed_alias_t signed_value_value = 0;/)
  assert.match(stub, /app_unsigned_alias_t unsigned_value_value = 0;/)
  assert.match(stub, /app_read16\(&signed_value_value, &unsigned_value_value\);/)
  assert.match(stub, /if \(signed_value != NULL\) \*signed_value = signed_value_value;/)
  assert.match(stub, /if \(unsigned_value != NULL\) \*unsigned_value = unsigned_value_value;/)
  assert.match(mbt, /fn Sample::Sample\(signed_value : Int32, unsigned_value : UInt32\)/)
  assert.match(
    stub,
    /moonbit_app_sample_make\(int32_t arg_signed_value, uint32_t arg_unsigned_value\)/,
  )
  const helpers = files.get('value_stub_gen.c')!
  assert.match(files.get('value_gen.mbt')!, /\[u16le\(value\)\]/)
  assert.match(helpers, /moonbit_app_value_write_bits\(/)
  assert.match(helpers, /uint16_t value = \(uint16_t\)bits;/)
  assert.doesNotMatch(helpers, /_as_/)
  assert.doesNotMatch(helpers, /__int16/)
  assert.doesNotMatch(
    stub,
    /moonbit_app_sample_(signed_value|unsigned_value|set_signed|set_unsigned)\(/,
  )
})
