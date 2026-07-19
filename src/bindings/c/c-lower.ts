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
import { toCSymbolPart, toMoonBitFunctionName, toMoonBitTypeName } from './c-naming.ts'

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
    int: { moonbit: 'Int', c: 'int32_t' },
    'signed char': { moonbit: 'Byte', c: 'int8_t' },
    short: { moonbit: 'Int', c: 'int16_t' },
    'unsigned char': { moonbit: 'Byte', c: 'uint8_t' },
    'unsigned int': { moonbit: 'UInt', c: 'uint32_t' },
    'unsigned short': { moonbit: 'UInt', c: 'uint16_t' },
    'long long': { moonbit: 'Int64', c: 'int64_t' },
    'unsigned long long': { moonbit: 'UInt64', c: 'uint64_t' },
    int8_t: { moonbit: 'Byte', c: 'int8_t' },
    int16_t: { moonbit: 'Int', c: 'int16_t' },
    int32_t: { moonbit: 'Int', c: 'int32_t' },
    int64_t: { moonbit: 'Int64', c: 'int64_t' },
    size_t: { moonbit: 'UInt64', c: 'uint64_t' },
    uint8_t: { moonbit: 'Byte', c: 'uint8_t' },
    uint16_t: { moonbit: 'UInt16', c: 'uint16_t' },
    uint32_t: { moonbit: 'UInt', c: 'uint32_t' },
    uint64_t: { moonbit: 'UInt64', c: 'uint64_t' },
    uintptr_t: { moonbit: 'UInt64', c: 'uint64_t' },
    void: { moonbit: 'Unit', c: 'void' },
  }),
)

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
    c: name,
    init: resolved.init,
  })
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

  const valueStruct = config.valueStructs.get(type.name)
  if (pointerDepth === 1 && valueStruct) {
    const moonbit = configuredTypeName(type.name, valueStruct, config)
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
      moonbit: 'Bytes',
      ownership: 'borrowed',
      emptyAsNull: override.emptyAsNull === true,
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

function lowerValueStruct(
  declaration: ValueStructDeclaration,
  context: LoweringContext,
  errors: string[],
): LoweredValueStruct {
  const accessors: LoweredValueStruct['accessors'][number][] = []
  for (const accessor of declaration.accessors ?? []) {
    const lowered = lowerType(accessor.type, 'return', context)
    if (!lowered || lowered.moonbit === undefined) {
      errors.push(
        `${declaration.cName}.${accessor.fieldPath.join('.')}: unsupported accessor type ${renderCType(accessor.type)}`,
      )
      continue
    }
    accessors.push(
      Object.freeze({
        ...accessor,
        cType: lowered.cType,
        moonbit: lowered.moonbit,
        kind: lowered.kind,
      }),
    )
  }
  return Object.freeze({ ...declaration, accessors: Object.freeze(accessors) })
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
      params.push(Object.freeze({ ...param, lowered }))
    }
    if (unsupportedReason) {
      unsupported(declaration, unsupportedReason)
      continue
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
      functionConfig.rename ?? toMoonBitFunctionName(declaration.cName, config.functionNamePrefixes)
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
      .filter((entry) => entry.kind === 'value-struct')
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
