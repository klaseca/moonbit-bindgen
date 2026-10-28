import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname, basename } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parseCHeadersWithRegex } from '../src/bindings/c/sources/regex/c-regex-parser.ts'
import { normalizeConfig } from '../src/bindings/c/c-config.ts'
import { createBindingEmitters, lowerBindings } from '../src/bindings/c/index.ts'
import { generateFiles } from '../src/core/index.ts'
import type { NamedTypeInput } from '../src/bindings/c/c-types.ts'

const header = `
#include <stdbool.h>
#include <stdint.h>
typedef struct child_t { int windowID; } child_t;
typedef child_t child_alias_t;
typedef struct middle_t { int prefix; child_alias_t child; } middle_t;
typedef struct parent_t { int prefix; middle_t middle; } parent_t;
typedef union event_t { unsigned int type; parent_t payload; unsigned char padding[128]; } event_t;
typedef struct output_t { const char *text; const int fixed; } output_t;
typedef struct keywords_t { int async; int readonly; int derive; int package; } keywords_t;
typedef uint16_t narrow_t;
typedef narrow_t narrow_alias_t;
#pragma pack(push, 1)
typedef struct packed_t {
  unsigned char before;
  narrow_alias_t narrow;
  unsigned char after;
  int16_t signed_value;
  float value;
  double wide;
  uint64_t large;
  bool enabled;
  uint16_t tail;
} packed_t;
#pragma pack(pop)
typedef enum fixture_mode_t { NEGATIVE_MODE = -2, POSITIVE_MODE = 3 } fixture_mode_t;
typedef enum fixture_flags_t { HIGH_FLAG = 0xf0000000u } fixture_flags_t;
typedef struct modes_t { fixture_mode_t mode; fixture_flags_t flags; } modes_t;
typedef struct token_t token_t;
struct token_t { int number; };
typedef struct pointers_t { token_t *token; const char *text; } pointers_t;
typedef volatile int volatile_int_t;
typedef struct special_t { volatile_int_t status; } special_t;
typedef int16_t float_input_t;
typedef float integer_input_t;
typedef int64_t large_float_input_t;
typedef bool bool_number_t;
typedef uint64_t double_output_t;
typedef struct conversions_t {
  float_input_t narrow;
  integer_input_t real;
  large_float_input_t large;
  bool_number_t enabled;
  double_output_t double_integer;
} conversions_t;
static void fill_conversions(conversions_t *value) {
  value->narrow = -1234;
  value->real = -15.75f;
  value->large = 9007199791611905LL;
  value->enabled = false;
  value->double_integer = UINT64_MAX;
}
static float large_as_float(conversions_t *value) { return value->large; }
static double large_as_double(conversions_t *value) { return value->double_integer; }
typedef int16_t wide_unsigned_t;
typedef uint16_t wide_signed_t;
typedef struct wide_t { int64_t signed_value; wide_unsigned_t negative; wide_signed_t positive; } wide_t;
typedef uint32_t int_view_t;
typedef int32_t uint_view_t;
typedef struct signedness_t { int_view_t signed_value; uint_view_t unsigned_value; } signedness_t;
static token_t sample_token = { 31 };
static void fill_pointers(pointers_t *output) {
  output->token = &sample_token;
  output->text = "shared pointer reader";
}
static int token_number(token_t *token) { return token->number; }
static int reserved_argument(int async) { return async; }
static void bump_child(child_t *child) { child->windowID += 1; }
static void bump_alias(child_alias_t *child) { child->windowID += 1; }
static bool optional_child(const child_t *child) { return child == 0; }
static void fill_output(output_t *output) { output->text = "native output"; }
`
function binding() {
  const valueStructs = {
    child_t: { setters: true as const },
    middle_t: { setters: true as const },
    parent_t: { setters: true as const },
    event_t: { setters: true as const },
    output_t: { init: 'zero' as const, setters: true as const },
    keywords_t: { setters: true as const },
    packed_t: { setters: true as const },
    modes_t: { setters: true as const },
    pointers_t: { init: 'zero' as const },
    special_t: { setters: true as const },
    conversions_t: { setters: true as const },
    wide_t: { setters: true as const },
    signedness_t: { setters: true as const },
  }
  const model = parseCHeadersWithRegex({
    headers: [{ path: 'fixture.h', outputBase: 'fixture', source: header }],
    valueStructs,
    constantPrefixes: ['HIGH_FLAG'],
    constantType: () => 'UInt32',
    functionPattern: /static\s+([^;{}]*?)\s+([A-Za-z_]\w*)\((.*?)\)\s*\{/g,
  })
  const config = normalizeConfig({
    namespace: 'fixture',
    valueStructs,
    typeOverrides: {
      float_input_t: { moonbit: 'Float', abiC: 'float' },
      integer_input_t: { moonbit: 'Int32', abiC: 'int32_t' },
      large_float_input_t: { moonbit: 'Float', abiC: 'float' },
      bool_number_t: { moonbit: 'Int32', abiC: 'int32_t' },
      double_output_t: { moonbit: 'Double', abiC: 'double' },
      wide_unsigned_t: { moonbit: 'UInt64', abiC: 'uint64_t' },
      wide_signed_t: { moonbit: 'Int64', abiC: 'int64_t' },
      int_view_t: { moonbit: 'Int32', abiC: 'int32_t' },
      uint_view_t: { moonbit: 'UInt32', abiC: 'uint32_t' },
    },
    functions: [
      'bump_child',
      'bump_alias',
      'fill_output',
      'reserved_argument',
      'fill_pointers',
      'token_number',
      'fill_conversions',
      'large_as_float',
      'large_as_double',
      { name: 'optional_child', params: { child: { nullable: true } } },
    ],
  })
  return generateFiles(lowerBindings(model, config), createBindingEmitters())
}

test('nested value fields lower once and emit buffer views with native offsets', () => {
  const files = binding()
  const mbt = files.get('fixture_gen.mbt')!
  const c = files.get('fixture_stub_gen.c')!
  assert.match(mbt, /fn Parent::middle\(self : Self\) -> Middle/)
  assert.match(mbt, /offset: self.offset \+ parent_layout\[4\]/)
  assert.match(mbt, /fn Child::window_id\(self : Self\) -> Int32/)
  assert.match(mbt, /bump_child_ffi\(child.bytes, child.offset\)/)
  assert.match(c, /offsetof\(middle_t, child\)/)
  assert.match(
    files.get('value_stub_gen.c')!,
    /memmove\(bytes \+ offset, value \+ value_offset, size\)/,
  )
  assert.doesNotMatch(
    c,
    /moonbit_fixture_(child_window_id|middle_child_offset|child_size|child_copy_bytes)\(/,
  )
  const readers = files.get('value_gen.mbt')!
  assert.equal(
    (readers.match(/fn\[T : NativeWord \+ Shl \+ BitOr\] read_integer\(/g) ?? []).length,
    1,
  )
  assert.doesNotMatch(readers, /fn value_read_(bits|int32|uint32|int64|uint64)\(/)
  assert.doesNotMatch(files.get('value_stub_gen.c')!, /_as_|fixture\.h/)
  assert.match(c, /event_t value = \{ 0 \};/)
  assert.match(mbt, /fn Event::Event\(\)/)
  assert.match(mbt, /fn Event::set_type\(/)
  assert.doesNotMatch(mbt, /fn Output::set_text|fn Output::set_fixed/)
  assert.match(c, /moonbit_fixture_special_status\(/)
  assert.match(c, /moonbit_fixture_special_set_status\(/)
})

test('unregistered nested structs and const aggregate views fail during lowering', () => {
  const source =
    'typedef struct child_t { int value; } child_t; typedef struct outer_t { const child_t child; } outer_t;'
  for (const child of [false, true]) {
    const valueStructs: Record<string, NamedTypeInput> = { outer_t: { init: 'zero' } }
    if (child) valueStructs['child_t'] = {}
    const model = parseCHeadersWithRegex({
      headers: [{ path: 'fixture.h', outputBase: 'fixture', source }],
      valueStructs,
    })
    assert.throws(
      () => lowerBindings(model, normalizeConfig({ namespace: 'fixture', valueStructs })),
      child ? /const aggregate views are unsupported/ : /unsupported accessor type/,
    )
  }
})

test('aggregate setters cannot overwrite const subfields', () => {
  const source =
    'typedef struct child_t { const int fixed; } child_t; typedef struct parent_t { child_t child; } parent_t;'
  const valueStructs = {
    child_t: { init: 'zero' as const },
    parent_t: { init: 'zero' as const, setters: { child: 'set_child' } },
  }
  const model = parseCHeadersWithRegex({
    headers: [{ path: 'fixture.h', outputBase: 'fixture', source }],
    valueStructs,
  })
  assert.throws(
    () => lowerBindings(model, normalizeConfig({ namespace: 'fixture', valueStructs })),
    /setters require writable scalar fields or configured value structs/,
  )
})

// Compute expectations independently of the emitted decoder, using exact integers.
function integerReadAssertions(): string {
  const assertions: string[] = []
  for (const size of [1, 2, 4, 8]) {
    const bits = BigInt(size * 8)
    const limit = 1n << bits
    const high = limit >> 1n
    const samples = new Set([
      0n,
      1n,
      high - 1n,
      high,
      high + 1n,
      limit - 1n,
      0xf0debc9a78563412n % limit,
    ])
    for (const raw of samples) {
      const littleBytes = Array.from({ length: size }, (_, i) =>
        Number((raw >> BigInt(i * 8)) & 255n),
      )
      for (const little of [true, false]) {
        const bytes = little ? littleBytes : [...littleBytes].reverse()
        const literal = [0xaa, ...bytes, 0xbb]
          .map((byte) => `\\x${byte.toString(16).padStart(2, '0')}`)
          .join('')
        for (const signed of [true, false]) {
          const value = signed && raw >= high ? raw - limit : raw
          for (const [width, unsigned, suffix] of [
            [32, false, ''],
            [32, true, 'U'],
            [64, false, 'L'],
            [64, true, 'UL'],
          ] as const) {
            const expected = unsigned ? BigInt.asUintN(width, value) : BigInt.asIntN(width, value)
            const minimum = -(1n << BigInt(width - 1))
            const result =
              expected === minimum
                ? `(${minimum + 1n}${suffix} - 1${suffix})`
                : `${expected}${suffix}`
            assertions.push(
              `  assert_eq(read_integer(b"${literal}", 1, ${size}, ${signed}, ${little}), ${result})`,
            )
          }
        }
      }
    }
  }
  return assertions.join('\n')
}

test(
  'scalar-only packages emit only needed readers and check without warnings',
  { skip: spawnSync('moon', ['version'], { encoding: 'utf8' }).status !== 0 },
  () => {
    const root = resolve(tmpdir())
    const taskDir = mkdtempSync(join(root, 'moonbit-bindgen-scalars-'))
    try {
      writeFileSync(
        join(taskDir, 'moon.mod'),
        'name = "test/scalars"\npreferred_target = "native"\n',
      )
      for (const type of [
        'int32_t',
        'uint32_t',
        'int64_t',
        'uint64_t',
        'unsigned char',
        'bool',
        'float',
        'double',
      ]) {
        const source = `#include <stdbool.h>\n#include <stdint.h>\ntypedef struct scalar_t { ${type} value; } scalar_t;`
        const valueStructs = { scalar_t: {} }
        const model = parseCHeadersWithRegex({
          headers: [{ path: 'scalar.h', outputBase: 'scalar', source }],
          valueStructs,
        })
        const files = generateFiles(
          lowerBindings(model, normalizeConfig({ namespace: 'scalar', valueStructs })),
          createBindingEmitters(),
        )
        const helpers = files.get('value_gen.mbt')!
        const integers = /int\d+_t$/.test(type)
        assert.equal(helpers.includes('priv trait NativeWord'), integers)
        assert.equal((helpers.match(/with fn from_i32\(/g) ?? []).length, integers ? 1 : 0)
        assert.equal(helpers.includes('value_little_endian_ffi'), type !== 'bool')
        writeFileSync(join(taskDir, 'scalar.h'), source)
        for (const [name, text] of files) writeFileSync(join(taskDir, name), text)
        const stubs = [...files.keys()]
          .filter((name) => name.endsWith('.c'))
          .map((name) => `"${name}"`)
        writeFileSync(join(taskDir, 'moon.pkg'), `options("native-stub": [${stubs.join(', ')}])\n`)
        const result = spawnSync('moon', ['check', '--target', 'native', '--deny-warn'], {
          cwd: taskDir,
          encoding: 'utf8',
          timeout: 120000,
        })
        assert.equal(result.status, 0, `${type}: ${result.stdout}\n${result.stderr}`)
      }
    } finally {
      assert.equal(dirname(taskDir), root)
      assert.ok(basename(taskDir).startsWith('moonbit-bindgen-scalars-'))
      rmSync(taskDir, { recursive: true, force: true })
    }
  },
)

test(
  'nested getters, setters, copies and native calls share the correct buffer',
  { skip: spawnSync('moon', ['version'], { encoding: 'utf8' }).status !== 0 },
  () => {
    const root = resolve(tmpdir())
    const taskDir = mkdtempSync(join(root, 'moonbit-bindgen-nested-'))
    try {
      const files = binding()
      writeFileSync(join(taskDir, 'fixture.h'), header)
      for (const [name, text] of files) writeFileSync(join(taskDir, name), text)
      writeFileSync(
        join(taskDir, 'moon.mod'),
        'name = "test/nested"\npreferred_target = "native"\n',
      )
      const stubs = [...files.keys()]
        .filter((name) => name.endsWith('.c'))
        .map((name) => `"${name}"`)
        .join(', ')
      writeFileSync(join(taskDir, 'moon.pkg'), `options("native-stub": [${stubs}])\n`)
      writeFileSync(
        join(taskDir, 'nested_wbtest.mbt'),
        `
///|
test "views preserve offsets and ownership, constructors and copy isolate bytes" {
  let child = Child(7)
  let parent = Parent(1, Middle(2, child))
  child.set_window_id(99)
  assert_eq(parent.middle().child().window_id(), 7)
  let view = parent.middle().child()
  view.set_window_id(10)
  assert_eq(parent.middle().child().window_id(), 10)
  bump_child(view)
  assert_eq(parent.middle().child().window_id(), 11)
  assert_false(optional_child(view, true))
  assert_true(optional_child(view, false))
  let copy = parent.middle().child().copy()
  copy.set_window_id(50)
  assert_eq(view.window_id(), 11)
  let bytes = view.as_bytes()
  assert_eq(bytes.length(), Child(0).as_bytes().length())
  assert_true(bytes.start_offset() > 0)
  assert_true(bytes.length() < parent.as_bytes().length())
  assert_eq(parent.as_bytes().start_offset(), 0)
  assert_eq(bytes, Child(11).as_bytes())
  let shared : Child = { bytes: bytes.data(), offset: bytes.start_offset() }
  assert_eq(shared.window_id(), 11)
  shared.set_window_id(88)
  assert_eq(view.window_id(), 88)
  assert_eq(bytes, Child(88).as_bytes())
  assert_eq(copy.as_bytes(), Child(50).as_bytes())
  parent.middle().set_child(copy)
  assert_eq(view.window_id(), 50)
  assert_eq(bytes, Child(50).as_bytes())
  copy.set_window_id(60)
  assert_eq(view.window_id(), 50)
  let event = Event()
  event.set_payload(parent)
  event.payload().middle().child().set_window_id(70)
  assert_eq(event.payload().middle().child().window_id(), 70)
  assert_eq(parent.middle().child().window_id(), 50)
  event.set_payload(event.payload())
  assert_eq(event.payload().middle().child().window_id(), 70)
  let snapshot = event.copy()
  event.payload().middle().child().set_window_id(80)
  assert_eq(snapshot.payload().middle().child().window_id(), 70)
  let retained = { let owner = Parent(0, Middle(0, Child(123))); owner.middle().child() }
  bump_child(retained)
  assert_eq(retained.window_id(), 124)
  bump_alias(retained)
  assert_eq(retained.window_id(), 125)
  let retained_bytes = { let owner = Parent(0, Middle(0, Child(456))); owner.middle().child().as_bytes() }
  assert_eq(retained_bytes, Child(456).as_bytes())
  let output = Output()
  fill_output(output)
  assert_eq(output.text(), b"native output")
  assert_eq(output.fixed(), 0)
  let keywords = Keywords(1, 2, 3, 4)
  assert_eq(keywords.async_(), 1)
  assert_eq(keywords.readonly_(), 2)
  assert_eq(keywords.derive_(), 3)
  assert_eq(keywords.package_(), 4)
  keywords.set_async(5)
  assert_eq(keywords.async_(), 5)
  assert_eq(reserved_argument(6), 6)
  let packed = Packed(0xab, 60000U, 0xcd, -12345, 1.25, -3.5, 18000000000UL, true, 0x9876U)
  assert_eq(packed.before(), 0xab)
  assert_eq(packed.narrow(), 60000U)
  assert_eq(packed.after(), 0xcd)
  assert_eq(packed.signed_value(), -12345)
  assert_eq(packed.value(), 1.25)
  assert_eq(packed.wide(), -3.5)
  assert_eq(packed.large(), 18000000000UL)
  assert_true(packed.enabled())
  packed.set_narrow(65535U)
  assert_eq(packed.narrow(), 65535U)
  assert_eq(packed.before(), 0xab)
  assert_eq(packed.after(), 0xcd)
  packed.set_signed_value(-32768)
  packed.set_value(-0.5)
  packed.set_wide(123.25)
  packed.set_large(0xffffffffffffffffUL)
  packed.set_enabled(false)
  assert_eq(packed.signed_value(), -32768)
  assert_eq(packed.value(), -0.5)
  assert_eq(packed.wide(), 123.25)
  assert_eq(packed.large(), 0xffffffffffffffffUL)
  assert_false(packed.enabled())
  assert_eq(packed.tail(), 0x9876U)
  packed.set_value(Float::reinterpret_from_uint(0x80000000U))
  assert_eq(packed.value().reinterpret_as_uint(), 0x80000000U)
  packed.set_wide(0x7ff8000000000001UL.reinterpret_as_double())
  assert_eq(packed.wide().reinterpret_as_uint64(), 0x7ff8000000000001UL)
  let modes = Modes(-2, 0xf0000000U)
  assert_eq(modes.mode(), -2)
  assert_eq(modes.flags(), 0xf0000000U)
  modes.set_mode(3)
  modes.set_flags(0U)
  assert_eq(modes.mode(), 3)
  assert_eq(modes.flags(), 0U)
  let pointers = Pointers()
  assert_true(pointers.token().is_null())
  assert_eq(pointers.text(), b"")
  fill_pointers(pointers)
  assert_false(pointers.token().is_null())
  assert_eq(token_number(pointers.token()), 31)
  assert_eq(pointers.text(), b"shared pointer reader")
  let special = Special(5)
  special.set_status(6)
  assert_eq(special.status(), 6)
  let conversions = Conversions(1.0, 2, 3.0, 1, 4.0)
  assert_eq(conversions.narrow(), 1.0)
  assert_eq(conversions.real(), 2)
  assert_eq(conversions.large(), 3.0)
  assert_eq(conversions.enabled(), 1)
  assert_eq(conversions.double_integer(), 4.0)
  fill_conversions(conversions)
  assert_eq(conversions.narrow(), -1234.0)
  assert_eq(conversions.real(), -15)
  assert_eq(conversions.large(), large_as_float(conversions))
  assert_eq(conversions.enabled(), 0)
  assert_eq(conversions.double_integer(), large_as_double(conversions))
  conversions.set_narrow(-23.75)
  conversions.set_real(-42)
  conversions.set_large(-27.5)
  conversions.set_enabled(-5)
  conversions.set_double_integer(42.75)
  assert_eq(conversions.narrow(), -23.0)
  assert_eq(conversions.real(), -42)
  assert_eq(conversions.large(), -27.0)
  assert_eq(conversions.enabled(), 1)
  assert_eq(conversions.double_integer(), 42.0)
  let wide = Wide(-9223372036854775807L - 1L, 0xffffffffffffffffUL, 65535L)
  assert_eq(wide.signed_value(), -9223372036854775807L - 1L)
  assert_eq(wide.negative(), 0xffffffffffffffffUL)
  assert_eq(wide.positive(), 65535L)
  wide.set_signed_value(9223372036854775807L)
  assert_eq(wide.signed_value(), 9223372036854775807L)
  let signedness = Signedness(-1, 0xffffffffU)
  assert_eq(signedness.signed_value(), -1)
  assert_eq(signedness.unsigned_value(), 0xffffffffU)
}

///|
test "numeric bit reads handle both byte orders and exact unaligned slices" {
  let bytes = b"\\xAA\\x12\\x34\\x56\\x78\\x9A\\xBC\\xDE\\xF0\\xBB"
  assert_eq(value_read_byte(bytes, 1, 1, true), 0x12)
  assert_eq(value_read_byte(bytes, 1, 1, false), 0x12)
  assert_eq(read_integer(bytes, 1, 2, false, true), 0x3412U)
  assert_eq(read_integer(bytes, 1, 2, false, false), 0x1234U)
  assert_eq(read_integer(bytes, 1, 4, false, true), 0x78563412U)
  assert_eq(read_integer(bytes, 1, 4, false, false), 0x12345678U)
  assert_eq(read_integer(bytes, 1, 8, false, true), 0xf0debc9a78563412UL)
  assert_eq(read_integer(bytes, 1, 8, false, false), 0x123456789abcdef0UL)
  let negative = b"\\xfe\\xff"
  assert_eq(read_integer(negative, 0, 1, true, true), -2)
  assert_eq(read_integer(negative, 0, 1, false, true), 254)
  assert_eq(read_integer(negative, 0, 2, true, true), -2)
  assert_eq(read_integer(negative, 0, 1, true, true), 0xfffffffeU)
  assert_eq(read_integer(negative, 0, 1, false, true), 254U)
  assert_eq(read_integer(negative, 0, 1, true, true), -2L)
  assert_eq(read_integer(negative, 0, 1, false, true), 254L)
  assert_eq(read_integer(negative, 0, 1, true, true), 0xfffffffffffffffeUL)
  assert_true(value_read_bool(b"\\x00\\x01", 0, 2))
  assert_true(value_read_bool(b"\\x01\\x00", 0, 2))
  assert_false(value_read_bool(b"\\x00\\x00", 0, 2))
  assert_eq(value_read_float(b"\\x00\\x00\\x80\\x3f", 0, 4, true), 1.0)
  assert_eq(value_read_float(b"\\x3f\\x80\\x00\\x00", 0, 4, false), 1.0)
  assert_eq(value_read_double(b"\\x3f\\xf0\\x00\\x00\\x00\\x00\\x00\\x00", 0, 8, false), 1.0)
}

///|
test "integer destinations preserve signedness and width in either byte order" {
${integerReadAssertions()}
}

///|
test "bitstring reads observe native writes through a retained byte view" {
  let child = Child(0)
  let bytes = child.as_bytes()
  let native_little_endian = match Child(1).as_bytes() {
    [1, ..] => true
    _ => false
  }
  fn read() -> Int32 {
    if native_little_endian {
      match bytes {
        [i32le(value)] => value
        _ => abort("invalid child layout")
      }
    } else {
      match bytes {
        [i32be(value)] => value
        _ => abort("invalid child layout")
      }
    }
  }
  for i in 0..<10000 {
    child.set_window_id(-i)
    assert_eq(read(), -i)
    bump_child(child)
    assert_eq(read(), -i + 1)
    assert_eq(child.window_id(), -i + 1)
  }
}
`,
      )
      for (const mode of [[], ['--release']]) {
        const result = spawnSync('moon', ['test', '--target', 'native', '--deny-warn', ...mode], {
          cwd: taskDir,
          encoding: 'utf8',
          timeout: 120000,
        })
        assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
      }
    } finally {
      // Remove only the freshly created test directory under the resolved temp root.
      assert.equal(dirname(taskDir), root)
      assert.ok(basename(taskDir).startsWith('moonbit-bindgen-nested-'))
      rmSync(taskDir, { recursive: true, force: true })
    }
  },
)
