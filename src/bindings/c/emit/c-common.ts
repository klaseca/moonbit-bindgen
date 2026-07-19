import { AbiKind } from '../c-lower.ts'
import { toCSymbolPart, toMoonBitTypeName } from '../c-naming.ts'
import type {
  Binding,
  LoweredFunction,
  LoweredParam,
  LoweredType,
  LoweredValueStruct,
  ValueStructDeclaration,
} from '../c-types.ts'

export function generatedHeader(comment = 'Generated file. Do not edit by hand.'): string[] {
  return [`// ${comment}`, '']
}

export function cSymbol(binding: Binding, name: string): string {
  return `${binding.symbolPrefix}_${toCSymbolPart(name)}`
}

export function cStringHelperSymbol(binding: Binding): string {
  return `moonbit_cstring_to_bytes_${toCSymbolPart(binding.namespace)}`
}

export function resourceTypeName(binding: Binding, cName: string): string {
  const resource = binding.resources.get(cName)
  return (
    resource?.moonbit ??
    binding.typeRenames.get(cName) ??
    toMoonBitTypeName(cName, binding.typeNamePrefixes)
  )
}

export function resourcePrefix(binding: Binding, cName: string): string {
  return `${binding.symbolPrefix}_${toCSymbolPart(resourceTypeName(binding, cName))}`
}

export function resourceStructName(binding: Binding, cName: string): string {
  return `${binding.symbolPrefix}_${toCSymbolPart(resourceTypeName(binding, cName))}_resource_t`
}

export function valueStructTypeName(
  binding: Binding,
  declaration: ValueStructDeclaration | LoweredValueStruct,
): string {
  const entry = binding.valueStructs?.get(declaration.cName)
  return (
    entry?.moonbit ??
    binding.typeRenames.get(declaration.cName) ??
    toMoonBitTypeName(declaration.cName, binding.typeNamePrefixes)
  )
}

export function valueStructBaseName(
  binding: Binding,
  declaration: ValueStructDeclaration | LoweredValueStruct,
): string {
  return toCSymbolPart(valueStructTypeName(binding, declaration))
}

export function isMoonBitParam(param: LoweredParam): boolean {
  return param.lowered.kind !== AbiKind.ImplicitNull
}

export function needsBorrow(type: LoweredType): boolean {
  switch (type.kind) {
    case AbiKind.BytesParameter:
    case AbiKind.CStringParameter:
    case AbiKind.OutParameter:
    case AbiKind.Resource:
    case AbiKind.ValueStruct:
      return true
    default:
      return false
  }
}

export function externReturn(type: LoweredType): string {
  return type.moonbit === 'Unit' ? '' : ` -> ${type.moonbit}`
}

export function cReturnType(type: LoweredType): string {
  if (type.kind === AbiKind.CStringReturn) return 'moonbit_bytes_t'
  return type.cType
}

export function wrapperNeedsBytesParam(param: LoweredParam): boolean {
  return param.lowered.kind === AbiKind.ValueStruct
}

export function directExternParam(param: LoweredParam): string[] {
  const type = wrapperNeedsBytesParam(param) ? 'Bytes' : param.lowered.moonbit
  const result = [`${param.name} : ${type}`]
  if (param.lowered.kind === AbiKind.ValueStruct && param.lowered.nullable) {
    result.push(`has_${param.name} : Bool`)
  }
  return result
}

export function publicParam(param: LoweredParam): string[] {
  const result = [`${param.name} : ${param.lowered.moonbit}`]
  if (param.lowered.kind === AbiKind.ValueStruct && param.lowered.nullable) {
    result.push(`has_${param.name} : Bool`)
  }
  return result
}

export function hasValueStructParams(fn: LoweredFunction): boolean {
  return fn.params.some(wrapperNeedsBytesParam)
}

export function isResourceRelease(binding: Binding, fn: LoweredFunction): boolean {
  if (fn.returnType.moonbit !== 'Unit' || fn.params.length !== 1) return false
  const param = fn.params[0]?.lowered
  return (
    param?.kind === AbiKind.Resource && binding.resources.get(param.resource)?.release === fn.cName
  )
}

export function toMoonBitFunctionPart(name: string): string {
  return name
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
}

export function resourceIsNullName(binding: Binding, cName: string): string {
  return `${toMoonBitFunctionPart(resourceTypeName(binding, cName))}_is_null`
}
