import { AbiKind, lowerType } from '../c-lower.ts'
import { stripNamePrefix } from '../c-naming.ts'
import { renderCType } from '../c-type.ts'
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
  CField,
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

function fieldType(field: CField, declaration: LoweredValueStruct, binding: Binding): string {
  const lowered = lowerType(field.type, 'return', {
    model: binding.model,
    config: {
      typeOverrides: binding.typeOverrides,
      resources: binding.resources,
      valueStructs: binding.valueStructs,
      namePrefixes: binding.namePrefixes,
      typeNamePrefixes: binding.typeNamePrefixes,
      typeRenames: binding.typeRenames,
      symbolPrefix: binding.symbolPrefix,
    },
  })
  if (!lowered || (lowered.kind !== AbiKind.Direct && lowered.kind !== AbiKind.OpaquePointer)) {
    throw new Error(
      `${declaration.cName}.${field.name}: unsupported value struct field type ${renderCType(field.type)}`,
    )
  }
  return lowered.moonbit
}

function emitValueStruct(lines: string[], declaration: LoweredValueStruct, binding: Binding): void {
  const typeName = valueStructTypeName(binding, declaration)
  const baseName = valueStructBaseName(binding, declaration)
  const fields = declaration.fields.map((field) => ({
    ...field,
    moonbit: fieldType(field, declaration, binding),
  }))
  const params = fields.map((field) => `${field.name} : ${field.moonbit}`).join(', ')
  const args = fields.map((field) => field.name).join(', ')

  emitBlock(lines, () => {
    lines.push(`struct ${typeName} {`)
    lines.push('  bytes : Bytes')
    lines.push('}')
  })
  emitBlock(lines, () => {
    lines.push(
      `extern "c" fn ${baseName}_make(${params}) -> Bytes = "${cSymbol(binding, `${baseName}_make`)}"`,
    )
  })
  emitBlock(lines, () => {
    lines.push(`pub fn ${typeName}::${typeName}(${params}) -> ${typeName} {`)
    lines.push(`  { bytes: ${baseName}_make(${args}) }`)
    lines.push('}')
  })
  emitBlock(lines, () => {
    lines.push(`pub fn ${typeName}::to_bytes(self : Self) -> Bytes {`)
    lines.push('  self.bytes')
    lines.push('}')
  })

  const accessors = [
    ...fields.map((field) => ({
      fieldPath: [field.name],
      name: field.name,
      moonbit: field.moonbit,
    })),
    ...(declaration.accessors ?? []),
  ]
  for (const accessor of accessors) {
    const accessorName = `${baseName}_${accessor.name}`
    emitBlock(lines, () => {
      lines.push('#borrow(bytes)')
      lines.push(
        `extern "c" fn ${accessorName}(bytes : Bytes) -> ${accessor.moonbit} = "${cSymbol(binding, accessorName)}"`,
      )
    })
    emitBlock(lines, () => {
      lines.push(`pub fn ${typeName}::${accessor.name}(self : Self) -> ${accessor.moonbit} {`)
      lines.push(`  ${accessorName}(self.to_bytes())`)
      lines.push('}')
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
        const result = [`${param.name}.to_bytes()`]
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
