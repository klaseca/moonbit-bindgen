import { AbiKind } from '../c-lower.ts'
import { cStringHelperSymbol, cSymbol, generatedHeader } from './c-common.ts'
import type { Emitter } from '../c-types.ts'
import { emitNumericReaders, numericReader, readerUsesEndianness } from './c-value-numeric.ts'

export function createValueHelperEmitter(): Emitter {
  return Object.freeze({
    name: 'value-helper',
    emitHeader(header, binding) {
      if (header !== binding.headers[0]) return []
      const structs = binding.headers.flatMap((entry) => entry.valueStructs)
      if (!structs.length) return []
      const readers = structs
        .flatMap((entry) => entry.accessors)
        .filter((field) => !field.nativeAccess)
      const writers = structs
        .flatMap((entry) => entry.setters)
        .filter((field) => !field.nativeAccess)
      const numericRead = readers.some((field) => field.kind === AbiKind.Direct)
      const numericReaders = readers.filter((field) => field.kind === AbiKind.Direct)
      const endianRead = numericReaders.some((field) => readerUsesEndianness(numericReader(field)))
      const numericWrite = writers.some((field) => field.kind === AbiKind.Direct)
      const pointerRead = readers.some((field) => field.kind === AbiKind.OpaquePointer)
      const cstringRead = readers.some((field) => field.kind === AbiKind.CStringReturn)
      const aggregateWrite = writers.some((field) => field.kind === AbiKind.ValueStruct)
      const mbt = generatedHeader()
      const c = generatedHeader()
      c.push('#include <moonbit.h>', '#include <stdint.h>', '#include <string.h>')
      if (numericWrite) c.push('#include <stdlib.h>')
      c.push('')

      if (endianRead) {
        mbt.push(
          '///|',
          `extern "c" fn value_little_endian_ffi() -> Bool = "${cSymbol(binding, 'value_little_endian')}"`,
          '',
          '///|',
          'let value_little_endian : Bool = value_little_endian_ffi()',
          '',
        )
        c.push(
          'MOONBIT_FFI_EXPORT',
          `int32_t ${cSymbol(binding, 'value_little_endian')}(void) {`,
          '  const uint16_t value = 1;',
          '  return ((const uint8_t *)&value)[0] == 1;',
          '}',
          '',
        )
      }
      if (numericRead) emitNumericReaders(mbt, numericReaders)
      if (numericWrite) {
        mbt.push(
          '///|',
          '#borrow(bytes)',
          `extern "c" fn value_write_bits(bytes : Bytes, offset : Int32, size : Int32, bits : UInt64) -> Unit = "${cSymbol(binding, 'value_write_bits')}"`,
          '',
        )
        c.push(
          'MOONBIT_FFI_EXPORT',
          `void ${cSymbol(binding, 'value_write_bits')}(moonbit_bytes_t bytes, int32_t offset, int32_t size, uint64_t bits) {`,
          '  switch (size) {',
        )
        for (const size of [1, 2, 4, 8])
          c.push(
            `    case ${size}: {`,
            `      uint${size * 8}_t value = (uint${size * 8}_t)bits;`,
            '      memcpy(bytes + offset, &value, sizeof(value));',
            '      return;',
            '    }',
          )
        c.push('    default: abort();', '  }', '}', '')
      }
      if (pointerRead) {
        mbt.push(
          '///|',
          '#borrow(bytes)',
          `extern "c" fn value_read_pointer(bytes : Bytes, offset : Int32) -> Pointer = "${cSymbol(binding, 'value_read_pointer')}"`,
          '',
        )
        c.push(
          'MOONBIT_FFI_EXPORT',
          `void *${cSymbol(binding, 'value_read_pointer')}(moonbit_bytes_t bytes, int32_t offset) {`,
          '  void *value;',
          '  memcpy(&value, bytes + offset, sizeof(value));',
          '  return value;',
          '}',
          '',
        )
      }
      if (cstringRead) {
        mbt.push(
          '///|',
          '#borrow(bytes)',
          `extern "c" fn value_read_cstring(bytes : Bytes, offset : Int32) -> Bytes = "${cSymbol(binding, 'value_read_cstring')}"`,
          '',
        )
        c.push(
          `moonbit_bytes_t ${cStringHelperSymbol(binding)}(const char *str);`,
          '',
          'MOONBIT_FFI_EXPORT',
          `moonbit_bytes_t ${cSymbol(binding, 'value_read_cstring')}(moonbit_bytes_t bytes, int32_t offset) {`,
          '  const char *value;',
          '  memcpy(&value, bytes + offset, sizeof(value));',
          `  return ${cStringHelperSymbol(binding)}(value);`,
          '}',
          '',
        )
      }
      mbt.push(
        '///|',
        '#borrow(bytes)',
        `extern "c" fn value_copy_bytes(bytes : Bytes, offset : Int32, size : Int32) -> Bytes = "${cSymbol(binding, 'value_copy_bytes')}"`,
        '',
      )
      c.push(
        'MOONBIT_FFI_EXPORT',
        `moonbit_bytes_t ${cSymbol(binding, 'value_copy_bytes')}(moonbit_bytes_t bytes, int32_t offset, int32_t size) {`,
        '  moonbit_bytes_t result = moonbit_make_bytes(size, 0);',
        '  memcpy(result, bytes + offset, size);',
        '  return result;',
        '}',
        '',
      )
      if (aggregateWrite) {
        mbt.push(
          '///|',
          '#borrow(bytes, value)',
          `extern "c" fn value_write_bytes(bytes : Bytes, offset : Int32, value : Bytes, value_offset : Int32, size : Int32) -> Unit = "${cSymbol(binding, 'value_write_bytes')}"`,
          '',
        )
        c.push(
          'MOONBIT_FFI_EXPORT',
          `void ${cSymbol(binding, 'value_write_bytes')}(moonbit_bytes_t bytes, int32_t offset, moonbit_bytes_t value, int32_t value_offset, int32_t size) {`,
          '  memmove(bytes + offset, value + value_offset, size);',
          '}',
          '',
        )
      }
      return [
        { path: 'value_gen.mbt', content: `${mbt.join('\n').trimEnd()}\n` },
        { path: 'value_stub_gen.c', content: `${c.join('\n').trimEnd()}\n` },
      ]
    },
  })
}
