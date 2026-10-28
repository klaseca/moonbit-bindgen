import type { LoweredField, LoweredValueStruct } from '../c-types.ts'
import {
  numericApi,
  numericReader,
  readerUsesSignedness,
  readerUsesEndianness,
} from './c-value-numeric.ts'

export function valueLayoutFields(declaration: LoweredValueStruct): readonly LoweredField[] {
  const fields = new Map<string, LoweredField>()
  for (const field of [...declaration.accessors, ...declaration.setters]) {
    const path = field.fieldPath.join('.')
    if (!fields.has(path)) fields.set(path, field)
  }
  return [...fields.values()]
}

export function valueLayoutIndex(declaration: LoweredValueStruct, field: LoweredField): number {
  const path = field.fieldPath.join('.')
  // size of struct; then offset, size and signedness for each field.
  return (
    1 + 3 * valueLayoutFields(declaration).findIndex((entry) => entry.fieldPath.join('.') === path)
  )
}

function toFloat(value: string, api: string): string {
  switch (api) {
    case 'Float':
      return value
    case 'Double':
      return `Float::from_double(${value})`
    case 'Int32':
      return `Float::from_int(${value})`
    case 'UInt32':
      return `Float::from_uint(${value})`
    case 'Int64':
      return `Float::from_int64(${value})`
    case 'UInt64':
      return `Float::from_uint64(${value})`
    case 'Byte':
      return `Float::from_byte(${value})`
    case 'Bool':
      return `Float::from_int(if ${value} { 1 } else { 0 })`
    default:
      throw new Error(`unsupported numeric API ${api}`)
  }
}

function toDouble(value: string, api: string): string {
  switch (api) {
    case 'Double':
      return value
    case 'Float':
    case 'Int64':
    case 'UInt64':
    case 'UInt32':
      return `(${value}).to_double()`
    case 'Int32':
      return `Double::from_int(${value})`
    case 'Byte':
      return `(${value}).to_uint().to_double()`
    case 'Bool':
      return `(if ${value} { 1.0 } else { 0.0 })`
    default:
      throw new Error(`unsupported numeric API ${api}`)
  }
}

function fromReal(value: string, source: 'Float' | 'Double', target: string): string {
  if (source === target) return value
  if (target === 'Float') return `Float::from_double(${value})`
  if (target === 'Double') return `(${value}).to_double()`
  if (target === 'Bool') return `(${value}) != 0.0`
  if (target === 'Byte') return `(${value}).to_int().to_byte()`
  if (target === 'Int32') return `(${value}).to_int()`
  const real = source === 'Float' ? `(${value}).to_double()` : value
  const method = target === 'Int64' ? 'to_int64' : target === 'UInt64' ? 'to_uint64' : 'to_uint'
  return `(${real}).${method}()`
}

export function valueNumericRead(
  field: LoweredField,
  bytes: string,
  offset: string,
  size: string,
  signed: string,
): string {
  const api = numericApi(field)
  const reader = numericReader(field)
  const args = [bytes, offset, size]
  if (readerUsesSignedness(reader)) args.push(signed)
  if (readerUsesEndianness(reader)) args.push('value_little_endian')
  const value = `${reader === 'integer' ? 'read_integer' : `value_read_${reader}`}(${args.join(', ')})`
  return reader === 'float' || reader === 'double'
    ? fromReal(value, reader === 'float' ? 'Float' : 'Double', api)
    : value
}

export function valueNumericWrite(field: LoweredField, value: string, signed: string): string {
  const api = numericApi(field)
  if (field.storageKind === 'float')
    return `${toFloat(value, api)}.reinterpret_as_uint().to_uint64()`
  if (field.storageKind === 'double') return `${toDouble(value, api)}.reinterpret_as_uint64()`
  if (field.storageKind === 'bool') {
    const condition =
      api === 'Bool'
        ? value
        : `(${value}) != ${api === 'Float' || api === 'Double' ? '0.0' : api === 'UInt64' ? '0UL' : api === 'Int64' ? '0L' : '0'}`
    return `if ${condition} { 1UL } else { 0UL }`
  }
  switch (api) {
    case 'Int32':
      return `Int64::from_int(${value}).reinterpret_as_uint64()`
    case 'UInt32':
      return `${value}.to_uint64()`
    case 'Int64':
      return `${value}.reinterpret_as_uint64()`
    case 'UInt64':
      return value
    case 'Byte':
      return `${value}.to_uint().to_uint64()`
    case 'Bool':
      return `if ${value} { 1UL } else { 0UL }`
    case 'Float':
    case 'Double': {
      const real = toDouble(value, api)
      return `if ${signed} { (${real}).to_int64().reinterpret_as_uint64() } else { (${real}).to_uint64() }`
    }
    default:
      throw new Error(`unsupported numeric API ${api}`)
  }
}
