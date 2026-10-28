import { AbiKind } from '../c-lower.ts'
import { valueLayoutFields } from './c-value-common.ts'
import {
  cReturnType,
  cStringHelperSymbol,
  cSymbol,
  generatedHeader,
  hasValueStructParams,
  isMoonBitParam,
  isResourceRelease,
  resourceIsNullName,
  resourcePrefix,
  resourceStructName,
  valueStructBaseName,
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
  OutParameterType,
  Resource,
  ResourceType,
} from '../c-types.ts'

type ResourceUsage = {
  ptr: boolean
  ownedMake: boolean
  retainedMake: boolean
  dependentMake: boolean
  unmanagedMake: boolean
  nativeOps: boolean
}

function cParamDeclarations(param: LoweredParam): string[] {
  if (!isMoonBitParam(param)) return []
  if (param.lowered.kind === AbiKind.ValueStruct) {
    const result = [`moonbit_bytes_t ${param.name}`, `int32_t ${param.name}_offset`]
    if (param.lowered.nullable) result.push(`int32_t has_${param.name}`)
    return result
  }
  return [`${param.lowered.cType} ${param.name}`]
}

function outParamLocal(param: LoweredParam): string | undefined {
  if (param.lowered.kind !== AbiKind.OutParameter) return undefined
  return `  ${param.lowered.nativeValueCType} ${param.name}_value = ${param.lowered.value.init ?? '0'};`
}

function callArgument(param: LoweredParam): string {
  switch (param.lowered.kind) {
    case AbiKind.ImplicitNull:
      return 'NULL'
    case AbiKind.CStringParameter:
      return param.lowered.emptyAsNull
        ? `(Moonbit_array_length(${param.name}) == 0 ? NULL : (const char *)${param.name})`
        : `(const char *)${param.name}`
    case AbiKind.BytesParameter:
      return `((${param.lowered.nativeCType})${param.name})`
    case AbiKind.ValueStruct:
      if (param.lowered.nullable) {
        return `has_${param.name} ? ((${param.lowered.nativeCType})(${param.name} + ${param.name}_offset)) : NULL`
      }
      return `((${param.lowered.nativeCType})(${param.name} + ${param.name}_offset))`
    case AbiKind.OutParameter:
      return `&${param.name}_value`
    default:
      return param.name
  }
}

function copyOutParam(param: LoweredParam): string {
  return `  if (${param.name} != NULL) *${param.name} = ${param.name}_value;`
}

function resourceFactoryCall(
  binding: Binding,
  fn: LoweredFunction,
  type: ResourceType,
  expression: string,
): string {
  const prefix = resourcePrefix(binding, type.resource)
  switch (type.lifetime.kind) {
    case 'owned':
      return `${prefix}_make_owned(${expression})`
    case 'retained':
      return `${prefix}_make_retained(${expression})`
    case 'unmanaged':
      return `${prefix}_make_unmanaged(${expression})`
    case 'dependent': {
      const owner = fn.params[type.lifetime.ownerArg]
      if (owner?.lowered.kind !== AbiKind.Resource) {
        throw new Error(`${fn.cName}: dependent resource owner was not lowered`)
      }
      const ownerPrefix = resourcePrefix(binding, owner.lowered.resource)
      return `${prefix}_make_dependent(${expression}, ${ownerPrefix}_ptr(${owner.name}), ${ownerPrefix}_retain, ${ownerPrefix}_release)`
    }
  }
}

function emitReturnWithOutParams(
  lines: string[],
  binding: Binding,
  fn: LoweredFunction,
  call: string,
  outParams: readonly (LoweredParam & Readonly<{ lowered: OutParameterType }>)[],
): void {
  if (fn.returnType.moonbit === 'Unit') {
    lines.push(`  ${call};`)
    for (const param of outParams) lines.push(copyOutParam(param))
    return
  }

  if (fn.returnType.kind === AbiKind.CStringReturn) {
    lines.push(`  const char *result = ${call};`)
    for (const param of outParams) lines.push(copyOutParam(param))
    lines.push(`  return ${cStringHelperSymbol(binding)}(result);`)
    return
  }

  if (fn.returnType.kind === AbiKind.Resource) {
    lines.push(`  ${fn.returnType.nativeCType} result = ${call};`)
    for (const param of outParams) lines.push(copyOutParam(param))
    lines.push(`  return ${resourceFactoryCall(binding, fn, fn.returnType, 'result')};`)
    return
  }

  lines.push(`  ${cReturnType(fn.returnType)} result = ${call};`)
  for (const param of outParams) lines.push(copyOutParam(param))
  lines.push('  return result;')
}

function resourceCallArgument(binding: Binding, param: LoweredParam): string {
  if (param.lowered.kind !== AbiKind.Resource) return callArgument(param)
  return `${resourcePrefix(binding, param.lowered.resource)}_ptr(${param.name})`
}

function returnLines(
  binding: Binding,
  fn: LoweredFunction,
  type: LoweredType,
  expression: string,
): string[] {
  if (type.moonbit === 'Unit') return [`  ${expression};`]
  if (type.kind === AbiKind.CStringReturn) {
    if (type.ownership === 'owned') {
      const free = type.free ?? 'free'
      return [
        `  char *result = ${expression};`,
        `  moonbit_bytes_t bytes = ${cStringHelperSymbol(binding)}(result);`,
        `  ${free}(result);`,
        '  return bytes;',
      ]
    }
    return [`  return ${cStringHelperSymbol(binding)}(${expression});`]
  }
  if (type.kind === AbiKind.Resource) {
    return [`  return ${resourceFactoryCall(binding, fn, type, expression)};`]
  }
  return [`  return ${expression};`]
}

function usedResources(header: LoweredHeader, binding: Binding): Map<string, ResourceUsage> {
  const resources = new Map<string, ResourceUsage>()
  const getUsage = (cName: string): ResourceUsage => {
    const usage = resources.get(cName) ?? {
      ptr: false,
      ownedMake: false,
      retainedMake: false,
      dependentMake: false,
      unmanagedMake: false,
      nativeOps: false,
    }
    resources.set(cName, usage)
    return usage
  }
  for (const fn of header.functions) {
    if (isResourceRelease(binding, fn)) continue
    for (const param of fn.params) {
      if (param.lowered.kind === AbiKind.Resource) {
        getUsage(param.lowered.resource).ptr = true
      }
    }
    if (fn.returnType.kind === AbiKind.Resource) {
      const usage = getUsage(fn.returnType.resource)
      switch (fn.returnType.lifetime.kind) {
        case 'owned':
          usage.ownedMake = true
          break
        case 'retained':
          usage.retainedMake = true
          break
        case 'unmanaged':
          usage.unmanagedMake = true
          break
        case 'dependent': {
          usage.dependentMake = true
          const owner = fn.params[fn.returnType.lifetime.ownerArg]
          if (owner?.lowered.kind === AbiKind.Resource) {
            const ownerUsage = getUsage(owner.lowered.resource)
            ownerUsage.ptr = true
            ownerUsage.nativeOps = true
          }
          break
        }
      }
    }
  }
  return resources
}

function usedResourcesInBinding(binding: Binding): Map<string, ResourceUsage> {
  const resources = new Map<string, ResourceUsage>()
  for (const header of binding.headers) {
    for (const [cName, usage] of usedResources(header, binding)) {
      const aggregate = resources.get(cName) ?? {
        ptr: false,
        ownedMake: false,
        retainedMake: false,
        dependentMake: false,
        unmanagedMake: false,
        nativeOps: false,
      }
      aggregate.ptr ||= usage.ptr
      aggregate.ownedMake ||= usage.ownedMake
      aggregate.retainedMake ||= usage.retainedMake
      aggregate.dependentMake ||= usage.dependentMake
      aggregate.unmanagedMake ||= usage.unmanagedMake
      aggregate.nativeOps ||= usage.nativeOps
      resources.set(cName, aggregate)
    }
  }
  return resources
}

function resourceOperationFunction(binding: Binding, name: string): LoweredFunction {
  const fn = binding.functions.find((candidate) => candidate.cName === name)
  if (!fn) throw new Error(`resource operation function was not lowered: ${name}`)
  return fn
}

function resourceHomePath(binding: Binding, resource: Resource): string | undefined {
  const path = resource.release
    ? resourceOperationFunction(binding, resource.release).header
    : binding.model.declarations.get(resource.cName)?.header
  return path && binding.headers.some((header) => header.path === path)
    ? path
    : binding.headers[0]?.path
}

function resourcesHostedByHeader(header: LoweredHeader, binding: Binding) {
  return [...binding.resources].filter(
    ([, resource]) => resourceHomePath(binding, resource) === header.path,
  )
}

function emitResourceHelpers(lines: string[], header: LoweredHeader, binding: Binding): void {
  const usedResources = usedResourcesInBinding(binding)
  for (const [cName, resource] of resourcesHostedByHeader(header, binding)) {
    const prefix = resourcePrefix(binding, cName)
    const structName = resourceStructName(binding, cName)
    const usage = usedResources.get(cName)
    const usesRetain = usage?.retainedMake === true || usage?.nativeOps === true
    const usesFactory =
      usage?.ownedMake === true ||
      usage?.retainedMake === true ||
      usage?.unmanagedMake === true ||
      usage?.dependentMake === true
    if (resource.retain && usesRetain) {
      const retain = resourceOperationFunction(binding, resource.retain)
      if (retain.header !== header.path) {
        const params = retain.params.flatMap(cParamDeclarations).join(', ')
        lines.push(`${cReturnType(retain.returnType)} ${retain.symbol}(${params || 'void'});`)
        lines.push('')
      }
    }
    lines.push('typedef struct {')
    lines.push(`  ${cName} *ptr;`)
    lines.push('  int32_t owns_ptr;')
    lines.push('  void *native_owner;')
    lines.push('  void (*release_native_owner)(void *);')
    lines.push(`} ${structName};`)
    lines.push('')
    if (resource.release) {
      const release = resourceOperationFunction(binding, resource.release)
      const releaseType = release.params[0]!.lowered.nativeCType
      const linkage = usage?.nativeOps === true ? '' : 'static '
      lines.push(`${linkage}void ${prefix}_release(void *ptr) {`)
      lines.push(`  if (ptr != NULL) ${resource.release}((${releaseType})ptr);`)
      lines.push('}')
      lines.push('')
    }
    if (resource.retain && usesRetain) {
      const retain = resourceOperationFunction(binding, resource.retain)
      const retainType = retain.params[0]!.lowered.nativeCType
      const linkage = usage?.nativeOps === true ? '' : 'static '
      lines.push(`${linkage}void ${prefix}_retain(void *ptr) {`)
      lines.push(`  if (ptr != NULL) ${retain.symbol}((${retainType})ptr);`)
      lines.push('}')
      lines.push('')
    }
    lines.push(`static void ${prefix}_finalize(void *self) {`)
    lines.push(`  ${structName} *resource = (${structName} *)self;`)
    lines.push('  if (resource == NULL) return;')
    if (resource.release) {
      lines.push(
        `  if (resource->owns_ptr && resource->ptr != NULL) ${prefix}_release(resource->ptr);`,
      )
    }
    lines.push('  resource->ptr = NULL;')
    lines.push('  resource->owns_ptr = 0;')
    lines.push('  if (resource->native_owner != NULL && resource->release_native_owner != NULL) {')
    lines.push('    resource->release_native_owner(resource->native_owner);')
    lines.push('  }')
    lines.push('  resource->native_owner = NULL;')
    lines.push('  resource->release_native_owner = NULL;')
    lines.push('}')
    lines.push('')
    if (resource.release) {
      const release = resourceOperationFunction(binding, resource.release)
      lines.push('MOONBIT_FFI_EXPORT')
      lines.push(`void ${release.symbol}(void *self) {`)
      lines.push(`  ${prefix}_finalize(self);`)
      lines.push('}')
      lines.push('')
    }
    lines.push(`${cName} *${prefix}_ptr(void *self) {`)
    lines.push(`  ${structName} *resource = (${structName} *)self;`)
    lines.push('  return resource == NULL ? NULL : resource->ptr;')
    lines.push('}')
    lines.push('')
    if (usesFactory) {
      lines.push(`static void *${prefix}_make(${cName} *ptr, int32_t owns_ptr) {`)
      lines.push(`  ${structName} *resource = (${structName} *)moonbit_make_external_object(`)
      lines.push(`    ${prefix}_finalize, sizeof(${structName})`)
      lines.push('  );')
      lines.push('  resource->ptr = ptr;')
      lines.push('  resource->owns_ptr = owns_ptr;')
      lines.push('  resource->native_owner = NULL;')
      lines.push('  resource->release_native_owner = NULL;')
      lines.push('  return resource;')
      lines.push('}')
      lines.push('')
    }
    if (usage?.ownedMake && resource.release) {
      lines.push(`void *${prefix}_make_owned(${cName} *ptr) {`)
      lines.push(`  return ${prefix}_make(ptr, 1);`)
      lines.push('}')
      lines.push('')
    }
    if (usage?.retainedMake && resource.retain && resource.release) {
      lines.push(`void *${prefix}_make_retained(${cName} *ptr) {`)
      lines.push(`  ${prefix}_retain(ptr);`)
      lines.push(`  return ${prefix}_make(ptr, 1);`)
      lines.push('}')
      lines.push('')
    }
    if (usage?.unmanagedMake) {
      lines.push(`void *${prefix}_make_unmanaged(${cName} *ptr) {`)
      lines.push(`  return ${prefix}_make(ptr, 0);`)
      lines.push('}')
      lines.push('')
    }
    if (usage?.dependentMake) {
      lines.push(
        `void *${prefix}_make_dependent(${cName} *ptr, void *owner, void (*retain_owner)(void *), void (*release_owner)(void *)) {`,
      )
      lines.push(`  ${structName} *resource = (${structName} *)${prefix}_make(ptr, 0);`)
      lines.push('  if (ptr != NULL && owner != NULL) {')
      lines.push('    retain_owner(owner);')
      lines.push('    resource->native_owner = owner;')
      lines.push('    resource->release_native_owner = release_owner;')
      lines.push('  }')
      lines.push('  return resource;')
      lines.push('}')
      lines.push('')
    }
    lines.push('MOONBIT_FFI_EXPORT')
    lines.push(`int32_t ${cSymbol(binding, resourceIsNullName(binding, cName))}(void *self) {`)
    lines.push(`  return ${prefix}_ptr(self) == NULL;`)
    lines.push('}')
    lines.push('')
  }
}

function emitResourceDeclarations(lines: string[], header: LoweredHeader, binding: Binding): void {
  const hostedResources = new Set(resourcesHostedByHeader(header, binding).map(([cName]) => cName))
  for (const [cName, usage] of [...usedResources(header, binding)].sort()) {
    if (hostedResources.has(cName)) continue
    const prefix = resourcePrefix(binding, cName)
    if (usage.ptr) lines.push(`${cName} *${prefix}_ptr(void *self);`)
    if (usage.ownedMake) lines.push(`void *${prefix}_make_owned(${cName} *ptr);`)
    if (usage.retainedMake) lines.push(`void *${prefix}_make_retained(${cName} *ptr);`)
    if (usage.unmanagedMake) lines.push(`void *${prefix}_make_unmanaged(${cName} *ptr);`)
    if (usage.dependentMake) {
      lines.push(
        `void *${prefix}_make_dependent(${cName} *ptr, void *owner, void (*retain_owner)(void *), void (*release_owner)(void *));`,
      )
    }
    if (usage.nativeOps) {
      lines.push(`void ${prefix}_retain(void *ptr);`)
      lines.push(`void ${prefix}_release(void *ptr);`)
    }
    lines.push('')
  }
}

function emitCStringHelper(lines: string[], binding: Binding): void {
  lines.push(`moonbit_bytes_t ${cStringHelperSymbol(binding)}(const char *str);`)
  lines.push('')
}

function emitValueStruct(lines: string[], declaration: LoweredValueStruct, binding: Binding): void {
  const base = valueStructBaseName(binding, declaration)
  const fields = declaration.constructorFields
  const nested = (field: LoweredValueStruct['accessors'][number]) =>
    field.kind === AbiKind.ValueStruct
  const params = fields
    .flatMap((field) =>
      nested(field)
        ? [`moonbit_bytes_t arg_${field.name}`, `int32_t arg_${field.name}_offset`]
        : [`${field.cType} arg_${field.name}`],
    )
    .join(', ')
  lines.push(
    'MOONBIT_FFI_EXPORT',
    `moonbit_bytes_t ${cSymbol(binding, `${base}_make`)}(${params || 'void'}) {`,
  )
  lines.push(`  ${declaration.cName} value = { 0 };`)
  for (const field of fields) {
    const target = `value.${field.fieldPath.join('.')}`
    if (nested(field))
      lines.push(
        `  memcpy(&${target}, arg_${field.name} + arg_${field.name}_offset, sizeof(${target}));`,
      )
    else lines.push(`  ${target} = arg_${field.name};`)
  }
  lines.push(
    `  moonbit_bytes_t bytes = moonbit_make_bytes(sizeof(${declaration.cName}), 0);`,
    `  memcpy(bytes, &value, sizeof(${declaration.cName}));`,
    '  return bytes;',
    '}',
    '',
  )
  const layout = [`(int32_t)sizeof(${declaration.cName})`]
  for (const field of valueLayoutFields(declaration)) {
    const path = field.fieldPath.join('.')
    layout.push(`(int32_t)offsetof(${declaration.cName}, ${path})`)
    layout.push(`(int32_t)sizeof(((${declaration.cName} *)0)->${path})`)
    layout.push(
      field.storageKind === 'integer'
        ? `((${field.storageCType})-1 < (${field.storageCType})0)`
        : '0',
    )
  }
  lines.push(
    'MOONBIT_FFI_EXPORT',
    `int32_t *${cSymbol(binding, `${base}_layout`)}(void) {`,
    '  static const int32_t layout[] = {',
    ...layout.map((entry) => `    ${entry},`),
    '  };',
    `  int32_t *result = moonbit_make_int32_array(${layout.length}, 0);`,
    '  memcpy(result, layout, sizeof(layout));',
    '  return result;',
    '}',
    '',
  )
  for (const field of declaration.accessors) {
    if (!field.nativeAccess || nested(field)) continue
    const name = `${base}_${field.name}`
    const path = field.fieldPath.join('.')
    const resultType = field.kind === AbiKind.CStringReturn ? 'moonbit_bytes_t' : field.cType
    const expression = `((${declaration.cName} *)(self + offset))->${path}`
    const result =
      field.kind === AbiKind.CStringReturn
        ? `${cStringHelperSymbol(binding)}(${expression})`
        : expression
    lines.push(
      'MOONBIT_FFI_EXPORT',
      `${resultType} ${cSymbol(binding, name)}(moonbit_bytes_t self, int32_t offset) {`,
      `  return ${result};`,
      '}',
      '',
    )
  }
  for (const field of declaration.setters) {
    if (!field.nativeAccess) continue
    const name = `${base}_${field.name}`
    const target = `((${declaration.cName} *)(self + offset))->${field.fieldPath.join('.')}`
    const param = nested(field)
      ? 'moonbit_bytes_t value, int32_t value_offset'
      : `${field.cType} value`
    lines.push(
      'MOONBIT_FFI_EXPORT',
      `void ${cSymbol(binding, name)}(moonbit_bytes_t self, int32_t offset, ${param}) {`,
    )
    if (nested(field)) lines.push(`  memmove(&${target}, value + value_offset, sizeof(${target}));`)
    else lines.push(`  ${target} = value;`)
    lines.push('}', '')
  }
}

function valueStructNeedsCStringHelper(declaration: LoweredValueStruct): boolean {
  return declaration.accessors.some(
    (accessor) => accessor.nativeAccess && accessor.kind === AbiKind.CStringReturn,
  )
}

function headerNeedsCStringHelper(header: LoweredHeader): boolean {
  return (
    header.functions.some((fn) => fn.returnType.kind === AbiKind.CStringReturn) ||
    header.valueStructs.some(valueStructNeedsCStringHelper)
  )
}

function functionUsesNull(fn: LoweredFunction): boolean {
  return fn.params.some((param) => {
    switch (param.lowered.kind) {
      case AbiKind.ImplicitNull:
      case AbiKind.OutParameter:
        return true
      case AbiKind.CStringParameter:
        return param.lowered.emptyAsNull === true
      case AbiKind.ValueStruct:
        return param.lowered.nullable === true
      default:
        return false
    }
  })
}

function headerNeedsStddef(header: LoweredHeader): boolean {
  return header.functions.some(functionUsesNull)
}

function usesStdint(lines: readonly string[]): boolean {
  return lines.some((line) => /\b(?:u?int(?:8|16|32|64)_t|intptr_t|uintptr_t)\b/.test(line))
}

function usesStddef(lines: readonly string[]): boolean {
  return lines.some((line) => /\b(?:NULL|offsetof)\b/.test(line))
}

function usesString(lines: readonly string[]): boolean {
  return lines.some((line) => /\b(?:memcpy|memmove|strlen)\s*\(/.test(line))
}

function emitFunction(lines: string[], fn: LoweredFunction, binding: Binding): void {
  if (isResourceRelease(binding, fn)) {
    return
  }

  const symbol = hasValueStructParams(fn) ? `${fn.symbol}_ffi` : fn.symbol
  const params = fn.params.flatMap(cParamDeclarations).join(', ')
  lines.push('MOONBIT_FFI_EXPORT')
  lines.push(`${cReturnType(fn.returnType)} ${symbol}(${params || 'void'}) {`)
  for (const param of fn.params) {
    const local = outParamLocal(param)
    if (local) lines.push(local)
  }
  const callArgs = fn.params.map((param) => resourceCallArgument(binding, param)).join(', ')
  const call = `${fn.cName}(${callArgs})`
  const outParams = fn.params.filter(
    (param): param is LoweredParam & Readonly<{ lowered: OutParameterType }> =>
      param.lowered.kind === AbiKind.OutParameter,
  )
  if (outParams.length === 0) {
    lines.push(...returnLines(binding, fn, fn.returnType, call))
  } else {
    emitReturnWithOutParams(lines, binding, fn, call, outParams)
  }
  lines.push('}')
  lines.push('')
}

export function createCStubEmitter(options: EmitterOptions = {}): Emitter {
  const suffix = options.suffix ?? '_stub_gen.c'
  return Object.freeze({
    name: 'c-stub',
    emitHeader(header: LoweredHeader, binding: Binding) {
      const hasFunctions = header.functions.some((fn) => !isResourceRelease(binding, fn))
      const hasValueStructs = header.valueStructs.length > 0
      const hasResources =
        resourcesHostedByHeader(header, binding).length > 0 ||
        usedResources(header, binding).size > 0
      if (!hasFunctions && !hasValueStructs && !hasResources) return []

      const body: string[] = []
      if (headerNeedsCStringHelper(header)) {
        emitCStringHelper(body, binding)
      }
      emitResourceHelpers(body, header, binding)
      emitResourceDeclarations(body, header, binding)
      for (const declaration of header.valueStructs) emitValueStruct(body, declaration, binding)
      for (const fn of header.functions) emitFunction(body, fn, binding)

      const lines = generatedHeader(options.comment)
      lines.push(`#include ${header.include}`)
      lines.push('#include <moonbit.h>')
      if (usesStdint(body)) lines.push('#include <stdint.h>')
      if (usesStddef(body) || headerNeedsStddef(header)) lines.push('#include <stddef.h>')
      if (usesString(body)) lines.push('#include <string.h>')
      lines.push('')
      lines.push(...body)
      return [{ path: `${header.outputBase}${suffix}`, content: `${lines.join('\n').trimEnd()}\n` }]
    },
  })
}
