import { hasCQualifier, renderCType } from './c-type.ts'
import type { CType } from './c-type.ts'
import type {
  AbiKindValue,
  ApiModel,
  Binding,
  Diagnostic,
  FunctionDeclaration,
  FunctionConfig,
  LoweredFunction,
  LoweredType,
  LoweredValueStruct,
  LoweredField,
  AccessorDeclaration,
  LoweringContext,
  NamedType,
  NormalizedConfig,
  ParamPolicy,
  Resource,
  ResourceLifetime,
  ScalarType,
  TypePosition,
  ValueStructDeclaration,
} from './c-types.ts'
import {
  escapeIdentifier,
  toCSymbolPart,
  toMoonBitFieldName,
  toMoonBitFunctionName,
  toMoonBitTypeName,
} from './c-naming.ts'

export const AbiKind: Readonly<{
  BytesParameter: 'bytes-parameter'
  CStringParameter: 'cstring-parameter'
  CStringReturn: 'cstring-return'
  Direct: 'direct'
  ImplicitNull: 'implicit-null'
  OpaquePointer: 'opaque-pointer'
  OutParameter: 'out-parameter'
  Resource: 'resource'
  ValueStruct: 'value-struct'
}> = Object.freeze({
  BytesParameter: 'bytes-parameter',
  CStringParameter: 'cstring-parameter',
  CStringReturn: 'cstring-return',
  Direct: 'direct',
  ImplicitNull: 'implicit-null',
  OpaquePointer: 'opaque-pointer',
  OutParameter: 'out-parameter',
  Resource: 'resource',
  ValueStruct: 'value-struct',
})

const builtinScalarTypes = new Map(
  Object.entries({
    bool: { moonbit: 'Bool', c: 'int32_t' },
    char: { moonbit: 'Byte', c: 'char' },
    double: { moonbit: 'Double', c: 'double' },
    float: { moonbit: 'Float', c: 'float' },
    int: { moonbit: 'Int32', c: 'int32_t' },
    'signed char': { moonbit: 'Byte', c: 'int8_t' },
    short: { moonbit: 'Int32', c: 'int32_t' },
    'unsigned char': { moonbit: 'Byte', c: 'uint8_t' },
    'unsigned int': { moonbit: 'UInt32', c: 'uint32_t' },
    'unsigned short': { moonbit: 'UInt32', c: 'uint32_t' },
    'long long': { moonbit: 'Int64', c: 'int64_t' },
    'unsigned long long': { moonbit: 'UInt64', c: 'uint64_t' },
    int8_t: { moonbit: 'Byte', c: 'int8_t' },
    int16_t: { moonbit: 'Int32', c: 'int32_t' },
    int32_t: { moonbit: 'Int32', c: 'int32_t' },
    int64_t: { moonbit: 'Int64', c: 'int64_t' },
    size_t: { moonbit: 'UInt64', c: 'uint64_t' },
    uint8_t: { moonbit: 'Byte', c: 'uint8_t' },
    uint16_t: { moonbit: 'UInt32', c: 'uint32_t' },
    uint32_t: { moonbit: 'UInt32', c: 'uint32_t' },
    uint64_t: { moonbit: 'UInt64', c: 'uint64_t' },
    uintptr_t: { moonbit: 'UInt64', c: 'uint64_t' },
    void: { moonbit: 'Unit', c: 'void' },
  }),
)

const numericValueTypes = new Set([
  'Int',
  'Int32',
  'UInt',
  'UInt32',
  'Int64',
  'UInt64',
  'Byte',
  'Bool',
  'Float',
  'Double',
])

function mapped<K extends AbiKindValue, const T extends object>(kind: K, fields: T) {
  return Object.freeze({ kind, ...fields })
}

function configuredTypeName(
  cName: string,
  entry: NamedType | Resource,
  config: Pick<NormalizedConfig, 'typeNamePrefixes' | 'typeRenames'>,
) {
  return (
    entry.moonbit ??
    config.typeRenames.get(cName) ??
    toMoonBitTypeName(cName, config.typeNamePrefixes)
  )
}

function resourceCType() {
  return 'void *'
}

function resolveScalarType(
  name: string,
  context: LoweringContext,
  seen: Set<string> = new Set(),
): ScalarType | undefined {
  const override = context.config.typeOverrides?.get(name)
  if (override) return override

  const builtin = builtinScalarTypes.get(name)
  if (builtin) return builtin

  const declaration = context.model.declarations.get(name)
  if (declaration?.kind !== 'alias' || seen.has(name)) return undefined
  if (typeof declaration.moonbit === 'string') {
    return Object.freeze({ moonbit: declaration.moonbit, c: name })
  }

  seen.add(name)
  if (!declaration.type) return undefined
  const target = declaration.type
  if (target.pointers.length !== 0) return undefined
  const resolved = resolveScalarType(target.name, context, seen)
  if (!resolved) return undefined
  return Object.freeze({
    moonbit: resolved.moonbit,
    c: resolved.c,
    init: resolved.init,
  })
}

function resolveValueStruct(name: string, context: LoweringContext): NamedType | undefined {
  const seen = new Set<string>()
  while (!seen.has(name)) {
    seen.add(name)
    const entry = context.config.valueStructs.get(name)
    if (entry) return entry
    const declaration = context.model.declarations.get(name)
    if (
      declaration?.kind !== 'alias' ||
      !declaration.type ||
      declaration.type.pointers.length !== 0
    )
      return undefined
    name = declaration.type.name
  }
  return undefined
}

function lowerPointer(
  type: CType,
  position: TypePosition,
  context: LoweringContext,
  override: ParamPolicy & FunctionConfig['return'],
): LoweredType | undefined {
  const { config, model } = context
  const pointerDepth = type.pointers.length
  const isConst = hasCQualifier(type, 'const')
  const resource = config.resources.get(type.name)
  if (pointerDepth === 1 && resource) {
    const lifetime: ResourceLifetime =
      position === 'return'
        ? (override.lifetime ?? { kind: resource.defaultLifetime })
        : { kind: 'unmanaged' }
    return mapped(AbiKind.Resource, {
      cType: resourceCType(),
      nativeCType: renderCType(type),
      moonbit: configuredTypeName(type.name, resource, config),
      resource: type.name,
      lifetime,
    })
  }

  const valueStruct = resolveValueStruct(type.name, context)
  if (pointerDepth === 1 && valueStruct) {
    const moonbit = configuredTypeName(valueStruct.cName, valueStruct, config)
    return mapped(AbiKind.ValueStruct, {
      cType: 'moonbit_bytes_t',
      nativeCType: renderCType(type),
      moonbit,
      nullable: override.nullable === true,
    })
  }

  if (type.name === 'char' && pointerDepth === 1 && isConst) {
    if (position === 'return') {
      return mapped(AbiKind.CStringReturn, {
        cType: 'moonbit_bytes_t',
        nativeCType: 'const char *',
        moonbit: 'Bytes',
        ownership: 'borrowed',
      })
    }
    return mapped(AbiKind.CStringParameter, {
      cType: 'moonbit_bytes_t',
      nativeCType: 'const char *',
      moonbit: override.nullable === true ? 'Bytes?' : 'Bytes',
      ownership: 'borrowed',
    })
  }

  if (
    type.name === 'char' &&
    pointerDepth === 1 &&
    position === 'return' &&
    override.ownership === 'owned'
  ) {
    return mapped(AbiKind.CStringReturn, {
      cType: 'moonbit_bytes_t',
      nativeCType: 'char *',
      moonbit: 'Bytes',
      ownership: 'owned',
      free: override.free,
    })
  }

  if (type.name === 'void' && pointerDepth === 1 && position === 'param') {
    return mapped(AbiKind.BytesParameter, {
      cType: 'moonbit_bytes_t',
      nativeCType: renderCType(type),
      moonbit: 'Bytes',
    })
  }

  if (type.name === 'void' && pointerDepth === 2 && position === 'param') {
    return mapped(AbiKind.OutParameter, {
      cType: 'void **',
      nativeCType: 'void **',
      moonbit: 'Ref[Pointer]',
      value: { c: 'void *', moonbit: 'Pointer', init: 'NULL' },
      nativeValueCType: 'void *',
    })
  }

  if (pointerDepth === 1) {
    const declaration = model.declarations.get(type.name)
    if (declaration?.kind === 'opaque-type') {
      return mapped(AbiKind.OpaquePointer, {
        cType: renderCType(type),
        nativeCType: renderCType(type),
        moonbit:
          declaration.moonbit ??
          config.typeRenames.get(type.name) ??
          toMoonBitTypeName(type.name, config.typeNamePrefixes),
      })
    }
  }

  if (position === 'param' && pointerDepth === 1) {
    const scalar = resolveScalarType(type.name, context)
    if (scalar && scalar.moonbit !== 'Unit' && !isConst) {
      return mapped(AbiKind.OutParameter, {
        cType: `${scalar.c} *`,
        nativeCType: renderCType(type),
        moonbit: `Ref[${scalar.moonbit}]`,
        value: scalar,
        nativeValueCType: type.name,
      })
    }
  }

  return undefined
}

export function lowerType(
  type: CType,
  position: TypePosition,
  context: LoweringContext,
  override: ParamPolicy & FunctionConfig['return'] = {},
): LoweredType | undefined {
  if (override.passing === 'null') {
    return mapped(AbiKind.ImplicitNull, {
      cType: 'void *',
      nativeCType: renderCType(type),
      moonbit: undefined,
    })
  }

  if (type.pointers.length > 0) {
    return lowerPointer(type, position, context, override)
  }

  const scalar = resolveScalarType(type.name, context)
  if (scalar) {
    return mapped(AbiKind.Direct, {
      cType: scalar.c,
      nativeCType: renderCType(type),
      moonbit: scalar.moonbit,
    })
  }

  return undefined
}

function validateResources(model: ApiModel, config: NormalizedConfig, errors: string[]) {
  for (const [cName, resource] of config.resources) {
    const declaration = model.declarations.get(cName)
    if (declaration?.kind !== 'opaque-type') {
      errors.push(`resources.${cName} does not reference an opaque type`)
    }
    for (const [operation, functionName] of [
      ['release', resource.release],
      ['retain', resource.retain],
    ] as const) {
      if (functionName === undefined) continue
      const fn = model.declarations.get(functionName)
      if (fn?.kind !== 'function') {
        errors.push(`resources.${cName}.${operation} references unknown function ${functionName}`)
        continue
      }
      const firstParam = fn.params[0]
      if (
        fn.returnType.name !== 'void' ||
        fn.returnType.pointers.length !== 0 ||
        fn.params.length !== 1 ||
        !firstParam ||
        firstParam.type.pointers.length !== 1
      ) {
        errors.push(`resources.${cName}.${operation} must return void and accept one pointer`)
      }
    }
    if (resource.defaultLifetime !== 'unmanaged' && resource.release === undefined) {
      errors.push(`resources.${cName}.${resource.defaultLifetime} requires release`)
    }
    if (resource.defaultLifetime === 'retained' && resource.retain === undefined) {
      errors.push(`resources.${cName}.retained requires retain`)
    }
  }
}

function validateValueStructs(model: ApiModel, config: NormalizedConfig, errors: string[]) {
  for (const cName of config.valueStructs.keys()) {
    if (model.declarations.get(cName)?.kind !== 'value-struct') {
      errors.push(`valueStructs.${cName} does not reference a value struct`)
    }
  }
}

function isConstType(type: CType, model: ApiModel, seen = new Set<string>()): boolean {
  if (type.pointers.length > 0)
    return type.pointers[type.pointers.length - 1]!.qualifiers.includes('const')
  if (hasCQualifier(type, 'const')) return true
  const alias = model.declarations.get(type.name)
  if (alias?.kind !== 'alias' || !alias.type || seen.has(type.name)) return false
  seen.add(type.name)
  return isConstType(alias.type, model, seen)
}

function containsConstFields(
  type: CType,
  context: LoweringContext,
  seen = new Set<string>(),
): boolean {
  if (isConstType(type, context.model)) return true
  if (type.pointers.length > 0) return false
  const entry = resolveValueStruct(type.name, context)
  if (!entry || seen.has(entry.cName)) return false
  seen.add(entry.cName)
  const declaration = context.model.declarations.get(entry.cName)
  return (
    declaration?.kind === 'value-struct' &&
    declaration.fields.some((field) => containsConstFields(field.type, context, seen))
  )
}

function lowerFieldType(type: CType, context: LoweringContext): LoweredType | undefined {
  const entry = type.pointers.length === 0 ? resolveValueStruct(type.name, context) : undefined
  if (entry)
    return mapped(AbiKind.ValueStruct, {
      cType: 'moonbit_bytes_t',
      nativeCType: type.name,
      moonbit: configuredTypeName(entry.cName, entry, context.config),
      nullable: false,
    })
  return lowerType(type, 'return', context)
}

// Resolve typedefs without substituting the wider FFI scalar type. Enum aliases
// without an underlying CType keep their native name for the C compiler.
function fieldStorageType(type: CType, model: ApiModel, seen = new Set<string>()): CType {
  // Keep portable C scalar names even when parsed system headers contain the
  // generating host's typedef (e.g. uint32_t -> unsigned __int32 on Windows).
  if (builtinScalarTypes.has(type.name)) return type
  const alias = model.declarations.get(type.name)
  if (type.pointers.length === 0 && alias?.kind === 'alias' && alias.type && !seen.has(type.name)) {
    seen.add(type.name)
    const target = fieldStorageType(alias.type, model, seen)
    return { ...target, qualifiers: [...type.qualifiers, ...target.qualifiers] }
  }
  return type
}

function fieldNeedsNativeAccess(
  declaration: ValueStructDeclaration,
  field: AccessorDeclaration,
  model: ApiModel,
): boolean {
  let current = declaration
  for (const segment of field.fieldPath) {
    const member = current.fields.find((entry) => entry.name === segment)
    if (!member) break
    const storage = fieldStorageType(member.type, model)
    const qualifiers = storage.pointers.at(-1)?.qualifiers ?? storage.qualifiers
    if (qualifiers.includes('volatile')) return true
    const next = model.declarations.get(storage.name)
    if (next?.kind === 'value-struct') current = next
  }
  return false
}

function lowerValueStruct(
  declaration: ValueStructDeclaration,
  context: LoweringContext,
  errors: string[],
): LoweredValueStruct {
  const settings = context.config.valueStructs.get(declaration.cName)
  const union = declaration.aggregateKind === 'union'
  const lower = (field: AccessorDeclaration): LoweredField | undefined => {
    const type = lowerFieldType(field.type, context)
    if (!type || !type.moonbit) return undefined
    if (
      type.kind !== AbiKind.Direct &&
      type.kind !== AbiKind.OpaquePointer &&
      type.kind !== AbiKind.CStringReturn &&
      type.kind !== AbiKind.ValueStruct
    )
      return undefined
    const storage = fieldStorageType(field.type, context.model)
    // Top-level qualifiers do not belong on the local scalar used by memcpy.
    // Preserve pointee qualifiers (e.g. const char *).
    const storageCType = renderCType({
      ...storage,
      qualifiers: storage.pointers.length === 0 ? [] : storage.qualifiers,
      pointers: storage.pointers.map((pointer, index) =>
        index === storage.pointers.length - 1 ? { qualifiers: [] } : pointer,
      ),
    })
    const alias = context.model.declarations.get(storage.name)
    const storageKind =
      type.kind !== AbiKind.Direct
        ? undefined
        : storage.name === 'float' || storage.name === 'double' || storage.name === 'bool'
          ? storage.name
          : builtinScalarTypes.has(storage.name) || (alias?.kind === 'alias' && !alias.type)
            ? 'integer'
            : undefined
    return {
      ...field,
      cType: type.cType,
      moonbit: type.moonbit,
      kind: type.kind,
      nativeCType: type.nativeCType,
      storageCType,
      storageKind,
      nativeAccess:
        fieldNeedsNativeAccess(declaration, field, context.model) ||
        (type.kind === AbiKind.Direct && (!storageKind || !numericValueTypes.has(type.moonbit))),
    }
  }
  const overrides = new Map(
    (declaration.accessors ?? []).map((field) => [field.fieldPath.join('.'), field]),
  )
  const accessors: LoweredField[] = []
  const constructorFields: LoweredField[] = []
  const methodNames = new Set(['as_bytes', 'copy', 'make'])
  const addAccessor = (field: AccessorDeclaration, explicit: boolean) => {
    field = { ...field, name: escapeIdentifier(field.name) }
    const lowered = lower(field)
    if (!lowered) {
      if (explicit || !union)
        errors.push(
          `${declaration.cName}.${field.fieldPath.join('.')}: unsupported accessor type ${renderCType(field.type)}`,
        )
      return
    }
    if (lowered.kind === AbiKind.ValueStruct && isConstType(field.type, context.model)) {
      errors.push(
        `${declaration.cName}.${field.fieldPath.join('.')}: const aggregate views are unsupported`,
      )
      return
    }
    if (methodNames.has(field.name))
      errors.push(`${declaration.cName}: duplicate value struct method ${field.name}`)
    methodNames.add(field.name)
    accessors.push(lowered)
  }
  for (const field of declaration.fields) {
    const accessor = {
      fieldPath: [field.name],
      name: toMoonBitFieldName(field.name),
      type: field.type,
    }
    if (!union && settings?.init !== 'zero') {
      const lowered =
        field.array || containsConstFields(field.type, context) ? undefined : lower(accessor)
      if (!lowered || lowered.kind === AbiKind.CStringReturn)
        errors.push(
          `${declaration.cName}.${field.name}: unsupported constructor field; use init: "zero" for output structs`,
        )
      else constructorFields.push(lowered)
    }
    const override = overrides.get(field.name)
    if (override) {
      addAccessor(override, true)
      overrides.delete(field.name)
    } else if (!field.array) addAccessor(accessor, false)
  }
  for (const field of overrides.values()) addAccessor(field, true)
  const setters: LoweredField[] = []
  const declarations: AccessorDeclaration[] = [...(declaration.setters ?? [])]
  if (settings?.setters === true) {
    for (const field of declaration.fields) {
      if (field.array || containsConstFields(field.type, context)) continue
      const lowered = lower({
        fieldPath: [field.name],
        name: toMoonBitFieldName(`set_${field.name}`),
        type: field.type,
      })
      if (lowered && (lowered.kind === AbiKind.Direct || lowered.kind === AbiKind.ValueStruct))
        declarations.push(lowered)
    }
  }
  for (const field of declarations) {
    const lowered = lower({ ...field, name: escapeIdentifier(field.name) })
    if (
      !lowered ||
      (lowered.kind !== AbiKind.Direct && lowered.kind !== AbiKind.ValueStruct) ||
      lowered.moonbit === 'Unit' ||
      containsConstFields(field.type, context)
    ) {
      errors.push(
        `${declaration.cName}.${field.fieldPath.join('.')}: setters require writable scalar fields or configured value structs (${renderCType(field.type)})`,
      )
      continue
    }
    if (methodNames.has(lowered.name))
      errors.push(`${declaration.cName}: duplicate value struct method ${lowered.name}`)
    methodNames.add(lowered.name)
    setters.push(lowered)
  }
  return Object.freeze({
    ...declaration,
    constructorFields: Object.freeze(constructorFields),
    accessors: Object.freeze(accessors),
    setters: Object.freeze(setters),
  })
}

function validateResourceReturnLifetime(
  fn: FunctionDeclaration,
  returnType: Extract<LoweredType, { kind: 'resource' }>,
  params: readonly LoweredFunction['params'][number][],
  config: NormalizedConfig,
  functionConfig: FunctionConfig,
  errors: string[],
): void {
  const resource = config.resources.get(returnType.resource)!
  if (functionConfig.return.ownership !== undefined) {
    errors.push(`${fn.cName}: resource returns use return.lifetime instead of return.ownership`)
  }
  switch (returnType.lifetime.kind) {
    case 'owned':
      if (resource.release === undefined) {
        errors.push(`${fn.cName}: owned ${returnType.resource} return requires release`)
      }
      return
    case 'retained':
      if (resource.retain === undefined || resource.release === undefined) {
        errors.push(
          `${fn.cName}: retained ${returnType.resource} return requires retain and release`,
        )
      }
      return
    case 'unmanaged':
      return
    case 'dependent': {
      const ownerArg = returnType.lifetime.ownerArg
      const owner = params[ownerArg]
      if (owner?.lowered.kind !== 'resource') {
        errors.push(
          `${fn.cName}: dependent ownerArg ${ownerArg} must reference a resource parameter`,
        )
        return
      }
      const ownerResource = config.resources.get(owner.lowered.resource)!
      if (ownerResource.retain === undefined || ownerResource.release === undefined) {
        errors.push(
          `${fn.cName}: dependent owner ${owner.lowered.resource} requires retain and release`,
        )
      }
    }
  }
}

export function lowerBindings(model: ApiModel, config: NormalizedConfig): Binding {
  const errors: string[] = []
  const skipped: Diagnostic[] = []
  validateResources(model, config, errors)
  validateValueStructs(model, config, errors)
  for (const cName of config.typeRenames.keys()) {
    if (!model.declarations.has(cName)) {
      errors.push(`renames.types references unknown type ${cName}`)
    }
  }
  const context = { model, config }
  const configuredFunctionNames = new Set(config.functions.map((entry) => entry.name))
  for (const resource of config.resources.values()) {
    if (resource.release) configuredFunctionNames.add(resource.release)
    if (resource.retain) configuredFunctionNames.add(resource.retain)
  }
  const selectedFunctions = [...model.declarations.values()].filter(
    (entry): entry is FunctionDeclaration =>
      entry.kind === 'function' &&
      (config.functionMode === 'discover' || configuredFunctionNames.has(entry.cName)),
  )

  function unsupported(declaration: FunctionDeclaration, reason: string) {
    const diagnostic = Object.freeze({
      header: declaration.header,
      name: declaration.cName,
      reason,
    })
    if (config.unsupportedPolicy === 'report') {
      skipped.push(diagnostic)
    } else {
      errors.push(`${declaration.cName}: ${reason}`)
    }
  }

  for (const functionConfig of config.functions) {
    if (!model.declarations.has(functionConfig.name)) {
      errors.push(`functions references unknown function ${functionConfig.name}`)
    }
  }

  const functions: LoweredFunction[] = []
  for (const declaration of selectedFunctions) {
    const functionConfig: FunctionConfig = config.functionsByName.get(declaration.cName) ?? {
      name: declaration.cName,
      params: new Map(),
      return: {},
    }
    const parameterNames = new Set(declaration.params.map((param) => param.name))
    for (const parameterName of functionConfig.params.keys()) {
      if (!parameterNames.has(parameterName)) {
        errors.push(`${declaration.cName}: config references unknown parameter ${parameterName}`)
      }
    }
    const returnType = lowerType(declaration.returnType, 'return', context, functionConfig.return)
    if (!returnType) {
      unsupported(declaration, `unsupported return type ${renderCType(declaration.returnType)}`)
      continue
    }

    const params: LoweredFunction['params'][number][] = []
    let unsupportedReason: string | undefined
    for (const param of declaration.params) {
      const lowered = lowerType(
        param.type,
        'param',
        context,
        functionConfig.params.get(param.name) ?? {},
      )
      if (!lowered) {
        unsupportedReason ??= `parameter ${param.name} has unsupported type ${renderCType(param.type)}`
        continue
      }
      params.push(Object.freeze({ ...param, name: escapeIdentifier(param.name), lowered }))
    }
    if (unsupportedReason) {
      unsupported(declaration, unsupportedReason)
      continue
    }
    const generatedNames = new Set<string>()
    for (const param of params) {
      if (generatedNames.has(param.name))
        errors.push(`${declaration.cName}: duplicate MoonBit parameter ${param.name}`)
      generatedNames.add(param.name)
    }

    if (returnType.kind === AbiKind.Resource) {
      validateResourceReturnLifetime(
        declaration,
        returnType,
        params,
        config,
        functionConfig,
        errors,
      )
    }

    const moonbit =
      functionConfig.rename === undefined
        ? toMoonBitFunctionName(declaration.cName, config.functionNamePrefixes)
        : escapeIdentifier(functionConfig.rename)
    functions.push(
      Object.freeze({
        cName: declaration.cName,
        moonbit,
        symbol: `${config.symbolPrefix}_${toCSymbolPart(moonbit)}`,
        header: declaration.header,
        params: Object.freeze(params),
        returnType,
      }),
    )
  }

  for (const property of ['moonbit', 'symbol'] as const) {
    const seen = new Map<string, string>()
    for (const fn of functions) {
      const name = fn[property]
      if (seen.has(name)) {
        errors.push(`${fn.cName} and ${seen.get(name)} generate duplicate ${property} name ${name}`)
      } else {
        seen.set(name, fn.cName)
      }
    }
  }

  const valueStructs = new Map<string, LoweredValueStruct>(
    [...model.declarations.values()]
      .filter(
        (entry): entry is ValueStructDeclaration =>
          entry.kind === 'value-struct' && config.valueStructs.has(entry.cName),
      )
      .map((entry) => [entry.cName, lowerValueStruct(entry, context, errors)]),
  )

  if (errors.length > 0) {
    throw new Error(`binding configuration is invalid:\n- ${errors.join('\n- ')}`)
  }

  const headers = model.headers
    .filter((header) => header.emit !== false)
    .map((header) =>
      Object.freeze({
        path: header.path,
        include: header.include,
        outputBase: header.outputBase,
        constants: Object.freeze(header.declarations.filter((entry) => entry.kind === 'constant')),
        functions: Object.freeze(functions.filter((fn) => fn.header === header.path)),
        opaqueTypes: Object.freeze(
          header.declarations.filter((entry) => entry.kind === 'opaque-type'),
        ),
        resources: Object.freeze(
          header.declarations.filter(
            (entry): entry is Extract<typeof entry, { kind: 'opaque-type' }> =>
              entry.kind === 'opaque-type' && config.resources.has(entry.cName),
          ),
        ),
        valueStructs: Object.freeze(
          header.declarations
            .filter(
              (entry) => entry.kind === 'value-struct' && config.valueStructs.has(entry.cName),
            )
            .map((entry) => valueStructs.get(entry.cName)!),
        ),
      }),
    )

  return Object.freeze({
    model,
    namespace: config.namespace,
    symbolPrefix: config.symbolPrefix,
    namePrefixes: config.namePrefixes,
    typeNamePrefixes: config.typeNamePrefixes,
    functionNamePrefixes: config.functionNamePrefixes,
    typeRenames: config.typeRenames,
    typeOverrides: config.typeOverrides,
    resources: config.resources,
    valueStructs: config.valueStructs,
    headers: Object.freeze(headers),
    functions: Object.freeze(functions),
    diagnostics: Object.freeze({
      generated: functions.length,
      skipped: Object.freeze(skipped),
    }),
  })
}
