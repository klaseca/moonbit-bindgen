import { AbiKind } from '../c-lower.ts'
import { stripNamePrefix } from '../c-naming.ts'
import { valueLayoutIndex, valueNumericRead, valueNumericWrite } from './c-value-common.ts'
import {
  cSymbol,
  directExternParam,
  externReturn,
  generatedHeader,
  hasValueStructParams,
  isMoonBitParam,
  needsBorrow,
  publicParam,
  resourceIsNullName,
  resourceTypeName,
  valueStructBaseName,
  valueStructTypeName,
} from './c-common.ts'
import type {
  Binding,
  Emitter,
  EmitterOptions,
  LoweredFunction,
  LoweredHeader,
  LoweredParam,
  LoweredType,
  LoweredValueStruct,
  OpaqueTypeDeclaration,
} from '../c-types.ts'

function emitBlock(lines: string[], body: () => void): void {
  lines.push('///|')
  body()
  lines.push('')
}

function emitBorrow(lines: string[], params: readonly LoweredParam[]): void {
  const borrowed = params.filter((param) => isMoonBitParam(param) && needsBorrow(param.lowered))
  if (borrowed.length > 0) {
    lines.push(`#borrow(${borrowed.map((param) => param.name).join(', ')})`)
  }
}

function emitExtern(
  lines: string[],
  visibility: string,
  name: string,
  params: readonly LoweredParam[],
  returnType: LoweredType,
  symbol: string,
): void {
  emitBlock(lines, () => {
    emitBorrow(lines, params)
    const paramsText = params.filter(isMoonBitParam).flatMap(directExternParam).join(', ')
    lines.push(
      `${visibility}extern "c" fn ${name}(${paramsText})${externReturn(returnType)} = "${symbol}"`,
    )
  })
}

function emitValueStruct(lines: string[], declaration: LoweredValueStruct, binding: Binding): void {
  const typeName = valueStructTypeName(binding, declaration)
  const base = valueStructBaseName(binding, declaration)
  const nested = (field: LoweredValueStruct['accessors'][number]) =>
    field.kind === AbiKind.ValueStruct
  const fields = declaration.constructorFields
  const params = fields.map((field) => `${field.name} : ${field.moonbit}`).join(', ')
  const ffiParams = fields
    .flatMap((field) =>
      nested(field)
        ? [`${field.name} : Bytes`, `${field.name}_offset : Int32`]
        : [`${field.name} : ${field.moonbit}`],
    )
    .join(', ')
  const args = fields
    .flatMap((field) =>
      nested(field) ? [`${field.name}.bytes`, `${field.name}.offset`] : [field.name],
    )
    .join(', ')
  emitBlock(lines, () => {
    lines.push(`struct ${typeName} {`, '  bytes : Bytes', '  offset : Int32', '}')
  })
  emitBlock(lines, () => {
    const borrowed = fields.filter(nested).map((field) => field.name)
    if (borrowed.length) lines.push(`#borrow(${borrowed.join(', ')})`)
    lines.push(
      `extern "c" fn ${base}_make(${ffiParams}) -> Bytes = "${cSymbol(binding, `${base}_make`)}"`,
    )
  })
  emitBlock(lines, () => {
    lines.push(
      `pub fn ${typeName}::${typeName}(${params}) -> ${typeName} {`,
      `  { bytes: ${base}_make(${args}), offset: 0 }`,
      '}',
    )
  })
  emitBlock(lines, () => {
    lines.push(
      `extern "c" fn ${base}_layout_ffi() -> FixedArray[Int32] = "${cSymbol(binding, `${base}_layout`)}"`,
    )
  })
  emitBlock(lines, () => {
    lines.push(`let ${base}_layout : FixedArray[Int32] = ${base}_layout_ffi()`)
  })
  emitBlock(lines, () => {
    lines.push(
      '/// View exactly the structure bytes without copying; writes and native buffer reuse are shared.',
      `pub fn ${typeName}::as_bytes(self : Self) -> BytesView {`,
      `  self.bytes.exact_view(start=self.offset, end=self.offset + ${base}_layout[0])`,
      '}',
    )
  })
  emitBlock(lines, () => {
    lines.push(
      '/// Copy the structure bytes into independent storage. Native pointers remain shallow copies.',
      `pub fn ${typeName}::copy(self : Self) -> Self {`,
      `  { bytes: value_copy_bytes(self.bytes, self.offset, ${base}_layout[0]), offset: 0 }`,
      '}',
    )
  })
  for (const field of declaration.accessors) {
    const name = `${base}_${field.name}`
    const index = valueLayoutIndex(declaration, field)
    const offset = `self.offset + ${base}_layout[${index}]`
    if (nested(field)) {
      emitBlock(lines, () => {
        lines.push(
          '/// A view into the original buffer; writes and native buffer reuse are shared.',
          `pub fn ${typeName}::${field.name}(self : Self) -> ${field.moonbit} {`,
          `  { bytes: self.bytes, offset: ${offset} }`,
          '}',
        )
      })
    } else {
      if (field.nativeAccess) {
        emitBlock(lines, () => {
          lines.push(
            '#borrow(bytes)',
            `extern "c" fn ${name}(bytes : Bytes, offset : Int32) -> ${field.moonbit} = "${cSymbol(binding, name)}"`,
          )
        })
      }
      const expression = field.nativeAccess
        ? `${name}(self.bytes, self.offset)`
        : field.kind === AbiKind.CStringReturn
          ? `value_read_cstring(self.bytes, ${offset})`
          : field.kind === AbiKind.OpaquePointer
            ? `${field.moonbit}::from_pointer(value_read_pointer(self.bytes, ${offset}))`
            : valueNumericRead(
                field,
                'self.bytes',
                offset,
                `${base}_layout[${index + 1}]`,
                `${base}_layout[${index + 2}] != 0`,
              )
      emitBlock(lines, () => {
        lines.push(
          `pub fn ${typeName}::${field.name}(self : Self) -> ${field.moonbit} {`,
          `  ${expression}`,
          '}',
        )
      })
    }
  }
  for (const field of declaration.setters) {
    const name = `${base}_${field.name}`
    const index = valueLayoutIndex(declaration, field)
    const offset = `self.offset + ${base}_layout[${index}]`
    if (field.nativeAccess) {
      emitBlock(lines, () => {
        lines.push(nested(field) ? '#borrow(bytes, value)' : '#borrow(bytes)')
        const value = nested(field)
          ? 'value : Bytes, value_offset : Int32'
          : `value : ${field.moonbit}`
        lines.push(
          `extern "c" fn ${name}(bytes : Bytes, offset : Int32, ${value}) -> Unit = "${cSymbol(binding, name)}"`,
        )
      })
    }
    emitBlock(lines, () => {
      const size = `${base}_layout[${index + 1}]`
      const args = nested(field) ? 'value.bytes, value.offset' : 'value'
      const expression = field.nativeAccess
        ? `${name}(self.bytes, self.offset, ${args})`
        : nested(field)
          ? `value_write_bytes(self.bytes, ${offset}, ${args}, ${size})`
          : `value_write_bits(self.bytes, ${offset}, ${size}, ${valueNumericWrite(field, 'value', `${base}_layout[${index + 2}] != 0`)})`
      lines.push(
        `pub fn ${typeName}::${field.name}(self : Self, value : ${field.moonbit}) -> Unit {`,
        `  ${expression}`,
        '}',
      )
    })
  }
}

function emitOpaqueType(
  lines: string[],
  declaration: OpaqueTypeDeclaration,
  binding: Binding,
): void {
  const typeName = resourceTypeName(binding, declaration.cName)
  if (binding.resources.has(declaration.cName)) {
    const isNull = resourceIsNullName(binding, declaration.cName)
    emitBlock(lines, () => {
      lines.push(`pub type ${typeName}`)
    })
    emitBlock(lines, () => {
      lines.push('#borrow(resource)')
      lines.push(
        `extern "c" fn ${isNull}(resource : ${typeName}) -> Bool = "${cSymbol(binding, isNull)}"`,
      )
    })
    emitBlock(lines, () => {
      lines.push(`pub fn ${typeName}::is_null(self : Self) -> Bool {`)
      lines.push(`  ${isNull}(self)`)
      lines.push('}')
    })
    return
  }

  emitBlock(lines, () => {
    lines.push('#external')
    lines.push(`pub type ${typeName}`)
  })
  emitBlock(lines, () => {
    lines.push(`pub fn ${typeName}::to_pointer(self : Self) -> Pointer = "%identity"`)
  })
  if (
    binding.headers.some((header) =>
      header.valueStructs.some((entry) =>
        entry.accessors.some(
          (field) =>
            field.kind === AbiKind.OpaquePointer &&
            field.moonbit === typeName &&
            !field.nativeAccess,
        ),
      ),
    )
  ) {
    emitBlock(lines, () => {
      lines.push(`fn ${typeName}::from_pointer(pointer : Pointer) -> Self = "%identity"`)
    })
  }
  emitBlock(lines, () => {
    lines.push(`pub fn ${typeName}::is_null(self : Self) -> Bool {`)
    lines.push('  self.to_pointer().is_null()')
    lines.push('}')
  })
}

function emitFunction(lines: string[], fn: LoweredFunction): void {
  if (!hasValueStructParams(fn)) {
    emitExtern(lines, 'pub ', fn.moonbit, fn.params, fn.returnType, fn.symbol)
    return
  }

  const ffiName = `${fn.moonbit}_ffi`
  emitExtern(lines, '', ffiName, fn.params, fn.returnType, `${fn.symbol}_ffi`)
  emitBlock(lines, () => {
    const params = fn.params.filter(isMoonBitParam).flatMap(publicParam).join(', ')
    const args = fn.params
      .filter(isMoonBitParam)
      .flatMap((param) => {
        if (param.lowered.kind !== AbiKind.ValueStruct) return [param.name]
        const result = [`${param.name}.bytes`, `${param.name}.offset`]
        if (param.lowered.nullable) result.push(`has_${param.name}`)
        return result
      })
      .join(', ')
    lines.push(`pub fn ${fn.moonbit}(${params}) -> ${fn.returnType.moonbit} {`)
    lines.push(`  ${ffiName}(${args})`)
    lines.push('}')
  })
}

export function createMoonBitEmitter(options: EmitterOptions = {}): Emitter {
  const suffix = options.suffix ?? '_gen.mbt'
  return Object.freeze({
    name: 'moonbit',
    emitHeader(header: LoweredHeader, binding: Binding) {
      const lines = generatedHeader(options.comment)
      for (const declaration of header.opaqueTypes) emitOpaqueType(lines, declaration, binding)
      for (const declaration of header.valueStructs) emitValueStruct(lines, declaration, binding)
      for (const constant of header.constants ?? []) {
        emitBlock(lines, () => {
          lines.push(
            `pub const ${constant.moonbit ?? stripNamePrefix(constant.cName, binding.namePrefixes)} : ${constant.type} = ${constant.literal}`,
          )
        })
      }
      for (const fn of header.functions) emitFunction(lines, fn)
      if (lines.length === 2) return []
      return [{ path: `${header.outputBase}${suffix}`, content: `${lines.join('\n').trimEnd()}\n` }]
    },
  })
}
