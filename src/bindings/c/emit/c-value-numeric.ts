import type { LoweredField } from '../c-types.ts'

export type NumericReader =
  'integer' | 'byte' | 'bool' | 'float' | 'double' | 'float_integer' | 'double_integer'

export function numericApi(field: LoweredField): string {
  return field.moonbit === 'Int' ? 'Int32' : field.moonbit === 'UInt' ? 'UInt32' : field.moonbit
}

export function numericReader(field: LoweredField): NumericReader {
  if (field.storageKind === 'float' || field.storageKind === 'double') return field.storageKind
  switch (numericApi(field)) {
    case 'Int32':
    case 'UInt32':
    case 'Int64':
    case 'UInt64':
      return 'integer'
    case 'Byte':
      return 'byte'
    case 'Bool':
      return 'bool'
    case 'Float':
      return 'float_integer'
    case 'Double':
      return 'double_integer'
    default:
      throw new Error(`unsupported numeric API ${field.moonbit}`)
  }
}

export function readerUsesSignedness(reader: NumericReader): boolean {
  return reader === 'integer' || reader === 'float_integer' || reader === 'double_integer'
}

export function readerUsesEndianness(reader: NumericReader): boolean {
  return reader !== 'bool'
}

const wordConversions = new Map<string, readonly [string, string]>([
  ['Int32', ['value', 'value.reinterpret_as_int()']],
  ['UInt32', ['value.reinterpret_as_uint()', 'value']],
  ['Int64', ['Int64::from_int(value)', 'value.to_int64()']],
  ['UInt64', ['Int64::from_int(value).reinterpret_as_uint64()', 'value.to_uint64()']],
])

function emitIntegerReader(lines: string[], types: ReadonlySet<string>): void {
  lines.push(
    '///|',
    'priv trait NativeWord {',
    '  fn from_i32(Int32) -> Self',
    '  fn from_u32(UInt32) -> Self',
    '}',
    '',
  )
  for (const type of types) {
    const conversions = wordConversions.get(type)
    if (!conversions) throw new Error(`unsupported integer API ${type}`)
    for (const [index, source] of ['i32', 'u32'].entries())
      lines.push(
        '///|',
        `impl NativeWord for ${type} with fn from_${source}(value) {`,
        `  ${conversions[index]}`,
        '}',
        '',
      )
  }
  lines.push(
    '///|',
    '// Two half-word shifts also discard the high word for 32-bit result types.',
    'fn[T : Shl + BitOr] join_words(high : T, low : T) -> T {',
    '  (high << 16 << 16) | low',
    '}',
    '',
  )
  lines.push(
    '///|',
    'fn[T : NativeWord + Shl + BitOr] read_integer(',
    '  bytes : Bytes,',
    '  offset : Int32,',
    '  size : Int32,',
    '  signed : Bool,',
    '  little_endian : Bool,',
    ') -> T {',
    '  let view = bytes.exact_view(start=offset, end=offset + size)',
    '  match (little_endian, signed, view) {',
  )
  for (const endian of ['le', 'be']) {
    const little = endian === 'le'
    for (const signed of [true, false]) {
      const prefix = signed ? 'i' : 'u'
      const patterns = [8, 16, 32].map(
        (bits) => `(${little}, ${signed}, [${prefix}${bits}${endian}(value)])`,
      )
      lines.push(`    ${patterns.join(' | ')} => NativeWord::from_${prefix}32(value)`)
      const words = little ? `u32le(low), ${prefix}32le(high)` : `${prefix}32be(high), u32be(low)`
      lines.push(
        `    (${little}, ${signed}, [${words}]) => join_words(NativeWord::from_${prefix}32(high), NativeWord::from_u32(low))`,
      )
    }
  }
  lines.push('    _ => abort("unsupported native scalar size")', '  }', '}', '')
}

function emitByteReader(lines: string[]): void {
  lines.push(
    '///|',
    'fn value_read_byte(bytes : Bytes, offset : Int32, size : Int32, little_endian : Bool) -> Byte {',
    '  guard size == 1 || size == 2 || size == 4 || size == 8 else {',
    '    abort("unsupported native scalar size")',
    '  }',
    '  let view = bytes.exact_view(start=offset, end=offset + size)',
    '  view[if little_endian { 0 } else { size - 1 }]',
    '}',
    '',
  )
}

function emitBoolReader(lines: string[]): void {
  lines.push(
    '///|',
    'fn value_read_bool(bytes : Bytes, offset : Int32, size : Int32) -> Bool {',
    '  guard size == 1 || size == 2 || size == 4 || size == 8 else {',
    '    abort("unsupported native scalar size")',
    '  }',
    '  let view = bytes.exact_view(start=offset, end=offset + size)',
    '  for index in 0..<size {',
    '    if view[index] != 0 { return true }',
    '  }',
    '  false',
    '}',
    '',
  )
}

function emitRealReader(lines: string[], reader: 'float' | 'double'): void {
  const floating = reader === 'float'
  lines.push(
    '///|',
    `fn value_read_${reader}(bytes : Bytes, offset : Int32, size : Int32, little_endian : Bool) -> ${floating ? 'Float' : 'Double'} {`,
    '  let view = bytes.exact_view(start=offset, end=offset + size)',
    '  match (little_endian, view) {',
  )
  for (const endian of ['le', 'be'])
    lines.push(
      `    (${endian === 'le'}, [u${floating ? 32 : 64}${endian}(value)]) => ${floating ? 'Float::reinterpret_from_uint(value)' : 'value.reinterpret_as_double()'}`,
    )
  lines.push('    _ => abort("unsupported native scalar size")', '  }', '}', '')
}

function emitIntegerToRealReader(
  lines: string[],
  reader: 'float_integer' | 'double_integer',
): void {
  const floating = reader === 'float_integer'
  lines.push(
    '///|',
    `fn value_read_${reader}(bytes : Bytes, offset : Int32, size : Int32, signed : Bool, little_endian : Bool) -> ${floating ? 'Float' : 'Double'} {`,
    '  if signed {',
  )
  if (floating)
    lines.push('    Float::from_int64(read_integer(bytes, offset, size, true, little_endian))')
  else
    lines.push(
      '    let value : Int64 = read_integer(bytes, offset, size, true, little_endian)',
      '    value.to_double()',
    )
  lines.push('  } else {')
  if (floating)
    lines.push('    Float::from_uint64(read_integer(bytes, offset, size, false, little_endian))')
  else
    lines.push(
      '    let value : UInt64 = read_integer(bytes, offset, size, false, little_endian)',
      '    value.to_double()',
    )
  lines.push('  }', '}', '')
}

export function emitNumericReaders(lines: string[], fields: readonly LoweredField[]): void {
  const readers = new Set(fields.map(numericReader))
  const integers = new Set(
    fields.filter((field) => numericReader(field) === 'integer').map(numericApi),
  )
  if (readers.has('float_integer') || readers.has('double_integer')) {
    integers.add('Int64')
    integers.add('UInt64')
  }
  if (integers.size) emitIntegerReader(lines, integers)
  for (const reader of readers) {
    switch (reader) {
      case 'integer':
        break
      case 'byte':
        emitByteReader(lines)
        break
      case 'bool':
        emitBoolReader(lines)
        break
      case 'float':
      case 'double':
        emitRealReader(lines, reader)
        break
      case 'float_integer':
      case 'double_integer':
        emitIntegerToRealReader(lines, reader)
        break
    }
  }
}
