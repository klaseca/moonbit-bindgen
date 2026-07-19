import { AbiKind } from '../c-lower.ts'
import { cStringHelperSymbol, generatedHeader } from './c-common.ts'
import type { Binding, Emitter, LoweredValueStruct } from '../c-types.ts'

function valueStructNeedsHelper(declaration: LoweredValueStruct): boolean {
  return (declaration.accessors ?? []).some((accessor) => accessor.kind === AbiKind.CStringReturn)
}

function bindingNeedsHelper(binding: Binding): boolean {
  return binding.headers.some(
    (header) =>
      header.functions.some((fn) => fn.returnType.kind === AbiKind.CStringReturn) ||
      header.valueStructs.some(valueStructNeedsHelper),
  )
}

export function createCStringHelperEmitter(): Emitter {
  return Object.freeze({
    name: 'cstring-helper',
    emitHeader(header, binding) {
      if (header !== binding.headers[0] || !bindingNeedsHelper(binding)) {
        return []
      }

      const symbol = cStringHelperSymbol(binding)
      const lines = generatedHeader()
      lines.push('#include <moonbit.h>')
      lines.push('#include <stddef.h>')
      lines.push('#include <stdint.h>')
      lines.push('#include <string.h>')
      lines.push('')
      lines.push(`moonbit_bytes_t ${symbol}(const char *str) {`)
      lines.push('  if (str == NULL) {')
      lines.push('    return moonbit_make_bytes(0, 0);')
      lines.push('  }')
      lines.push('  int32_t len = (int32_t)strlen(str);')
      lines.push('  moonbit_bytes_t bytes = moonbit_make_bytes(len, 0);')
      lines.push('  memcpy(bytes, str, len);')
      lines.push('  return bytes;')
      lines.push('}')
      return [
        {
          path: 'cstring_stub_gen.c',
          content: `${lines.join('\n').trimEnd()}\n`,
        },
      ]
    },
  })
}
