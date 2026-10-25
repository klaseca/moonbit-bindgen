import assert from 'node:assert/strict'
import test from 'node:test'

import { createBindingEmitters, lowerBindings } from '../src/bindings/c/index.ts'
import { normalizeConfig } from '../src/bindings/c/c-config.ts'
import { parseCHeadersWithRegex } from '../src/bindings/c/sources/regex/c-regex-parser.ts'
import { generateFiles } from '../src/core/index.ts'

const header = `
typedef unsigned int app_type_t;
typedef const int locked_t;
typedef struct app_payload_t {
  unsigned int window_id;
  int code;
  bool enabled;
  const int fixed;
  void *data;
  char bytes[16];
} app_payload_t;
typedef union app_event_t {
  app_type_t type;
  app_payload_t user;
  app_payload_t *ptr;
  const app_payload_t readonly;
  locked_t locked;
  unsigned char padding[128];
} app_event_t;
`

function generate(setters: Readonly<Record<string, string>> = {}) {
  const valueStructs = {
    app_event_t: {
      accessors: { type: 'event_type', 'user.code': 'user_code' },
      setters,
    },
  }
  const model = parseCHeadersWithRegex({
    headers: [{ path: 'app.h', outputBase: 'events', source: header }],
    valueStructs,
  })
  const config = normalizeConfig({ namespace: 'app', namePrefixes: ['app_'], valueStructs })
  return generateFiles(lowerBindings(model, config), createBindingEmitters())
}

test('scalar union setters resolve typedefs and nested fields in both emitters', () => {
  const files = generate({
    type: 'set_event_type',
    'user.window_id': 'set_user_window_id',
    'user.code': 'set_user_code',
    'user.enabled': 'set_user_enabled',
  })
  const mbt = files.get('events_gen.mbt')!
  const stub = files.get('events_stub_gen.c')!
  assert.match(
    mbt,
    /#borrow\(bytes\)\nextern "c" fn event_set_user_code\(bytes : Bytes, value : Int32\) -> Unit/,
  )
  assert.match(mbt, /pub fn Event::set_user_code\(self : Self, value : Int32\) -> Unit/)
  assert.match(mbt, /pub fn Event::set_event_type\(self : Self, value : UInt32\)/)
  assert.match(mbt, /pub fn Event::set_user_enabled\(self : Self, value : Bool\)/)
  assert.match(
    stub,
    /void moonbit_app_event_set_event_type\(moonbit_bytes_t self, uint32_t value\)/,
  )
  assert.match(stub, /\(\(app_event_t \*\)self\)->user\.window_id = value;/)
  assert.match(stub, /\(\(app_event_t \*\)self\)->user\.code = value;/)
  assert.match(
    stub,
    /void moonbit_app_event_set_user_enabled\(moonbit_bytes_t self, int32_t value\)/,
  )
  assert.match(stub, /app_event_t value = \{ 0 \};/)
})

test('setters are opt-in and preserve existing getter output', () => {
  const without = generate()
  const withSetter = generate({ 'user.code': 'set_user_code' })
  assert.doesNotMatch(without.get('events_gen.mbt')!, /set_user_code/)
  assert.doesNotMatch(without.get('events_stub_gen.c')!, /set_user_code/)
  assert.ok(withSetter.get('events_gen.mbt')!.startsWith(without.get('events_gen.mbt')!))
  assert.ok(withSetter.get('events_stub_gen.c')!.startsWith(without.get('events_stub_gen.c')!))
})

test('setters reject pointers, arrays, aggregates, and const members or typedefs', () => {
  for (const field of [
    'user.data',
    'user.bytes',
    'user',
    'user.fixed',
    'readonly.code',
    'locked',
  ]) {
    assert.throws(
      () => generate({ [field]: 'set_field' }),
      /setters require writable scalar fields/,
    )
  }
})

test('setters reject unknown paths and pointer traversal', () => {
  for (const field of ['unknown', 'user.missing', 'ptr.code']) {
    assert.throws(() => generate({ [field]: 'set_field' }), /cannot resolve setter type/)
  }
  assert.throws(() => generate({ 'user.code;': 'set_field' }), /invalid setter field path/)
})

test('setters reject duplicate methods including getter collisions', () => {
  assert.throws(
    () => generate({ 'user.code': 'user_code' }),
    /duplicate value struct method user_code/,
  )
  assert.throws(
    () => generate({ type: 'set_field', 'user.code': 'set_field' }),
    /duplicate value struct method set_field/,
  )
  assert.throws(() => generate({ 'user.code': 'make' }), /duplicate value struct method make/)
})

test('setter configuration rejects invalid names and shapes', () => {
  assert.throws(
    () =>
      normalizeConfig({
        namespace: 'app',
        valueStructs: { app_event_t: { setters: { type: '' } } },
      }),
    /must be a method name/,
  )
  assert.throws(
    // @ts-expect-error invalid runtime configuration must fail too
    () => normalizeConfig({ namespace: 'app', valueStructs: { app_event_t: { setters: [] } } }),
    /setters must be an object/,
  )
})
