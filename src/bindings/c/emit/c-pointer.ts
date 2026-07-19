import { cSymbol, generatedHeader } from './c-common.ts'
import { AbiKind } from '../c-lower.ts'
import type { Binding, Emitter, LoweredType } from '../c-types.ts'

function loweredTypeNeedsPointer(type: LoweredType): boolean {
  return (
    type.moonbit === 'Pointer' ||
    (type.kind === AbiKind.OutParameter && type.value.moonbit === 'Pointer')
  )
}

function bindingNeedsPointer(binding: Binding): boolean {
  if (
    binding.headers.some((header) =>
      header.opaqueTypes.some((type) => !binding.resources.has(type.cName)),
    )
  ) {
    return true
  }
  return binding.functions.some(
    (fn) =>
      loweredTypeNeedsPointer(fn.returnType) ||
      fn.params.some((param) => loweredTypeNeedsPointer(param.lowered)),
  )
}

export function createPointerHelperEmitter(): Emitter {
  return Object.freeze({
    name: 'pointer-helper',
    emitHeader(header, binding: Binding) {
      if (header !== binding.headers[0] || !bindingNeedsPointer(binding)) return []

      const symbol = cSymbol(binding, 'pointer_is_null')
      const moonbit = generatedHeader()
      moonbit.push('///|')
      moonbit.push('#external')
      moonbit.push('pub type Pointer')
      moonbit.push('')
      moonbit.push('///|')
      moonbit.push('#borrow(pointer)')
      moonbit.push(`extern "c" fn pointer_is_null(pointer : Pointer) -> Bool = "${symbol}"`)
      moonbit.push('')
      moonbit.push('///|')
      moonbit.push('pub fn Pointer::is_null(self : Self) -> Bool {')
      moonbit.push('  pointer_is_null(self)')
      moonbit.push('}')

      const c = generatedHeader()
      c.push('#include <moonbit.h>')
      c.push('#include <stddef.h>')
      c.push('#include <stdint.h>')
      c.push('')
      c.push('MOONBIT_FFI_EXPORT')
      c.push(`int32_t ${symbol}(void *pointer) {`)
      c.push('  return pointer == NULL;')
      c.push('}')

      return [
        { path: 'pointer_gen.mbt', content: `${moonbit.join('\n').trimEnd()}\n` },
        { path: 'pointer_stub_gen.c', content: `${c.join('\n').trimEnd()}\n` },
      ]
    },
  })
}
