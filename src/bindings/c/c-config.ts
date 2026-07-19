import type {
  ConfigInput,
  FunctionConfig,
  FunctionConfigInput,
  GeneratorConfigInput,
  NamedType,
  NamedTypeInput,
  NormalizedConfig,
  ParamPolicy,
  Resource,
  ResourceInput,
  ResourceLifetime,
  ResourceLifetimeInput,
  ScalarType,
  TypeOverrideInput,
} from './c-types.ts'

type WithoutUnknownOptions<Config, Shape> = Config &
  Record<Exclude<keyof Config, keyof Shape>, never>

export function defineConfig<const Config extends GeneratorConfigInput>(
  config: WithoutUnknownOptions<Config, GeneratorConfigInput>,
): Config {
  return config
}

function objectEntries<T>(
  value: Readonly<Record<string, T>> | undefined,
  path: string,
): [string, T][] {
  if (value === undefined) return []
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path} must be an object`)
  }
  return Object.entries(value)
}

function normalizeTypeOverrides(
  entries: Readonly<Record<string, TypeOverrideInput>> | undefined,
): Map<string, ScalarType> {
  return new Map<string, ScalarType>(
    objectEntries(entries, 'typeOverrides').map(([cName, entry]) => {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new Error(`typeOverrides.${cName} must be an object`)
      }
      for (const option of Object.keys(entry)) {
        if (!new Set(['abiC', 'init', 'moonbit']).has(option)) {
          throw new Error(`typeOverrides.${cName} uses unknown option ${option}`)
        }
      }
      if (typeof entry.moonbit !== 'string' || entry.moonbit.length === 0) {
        throw new Error(`typeOverrides.${cName}.moonbit is required`)
      }
      if (entry.abiC !== undefined && typeof entry.abiC !== 'string') {
        throw new Error(`typeOverrides.${cName}.abiC must be a string`)
      }
      const scalar: ScalarType = Object.freeze({
        moonbit: entry.moonbit,
        c: entry.abiC ?? cName,
        init: entry.init,
      })
      return [cName, scalar]
    }),
  )
}

function normalizeNamedTypes(
  entries: Readonly<Record<string, NamedTypeInput>> | undefined,
  path: string,
): Map<string, NamedType> {
  return new Map<string, NamedType>(
    objectEntries(entries, path).map(([cName, entry]) => {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new Error(`${path}.${cName} must be an object`)
      }
      return [cName, Object.freeze({ ...entry, cName })]
    }),
  )
}

function normalizeResourceLifetime(input: ResourceLifetimeInput, path: string): ResourceLifetime {
  if (typeof input === 'string') {
    if (!new Set(['owned', 'retained', 'unmanaged']).has(input)) {
      throw new Error(`${path} must be "owned", "retained", "unmanaged", or dependent`)
    }
    return Object.freeze({ kind: input }) as ResourceLifetime
  }
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error(`${path} must be a resource lifetime`)
  }
  for (const option of Object.keys(input)) {
    if (!new Set(['kind', 'ownerArg']).has(option)) {
      throw new Error(`${path} uses unknown option ${option}`)
    }
  }
  if (input.kind !== 'dependent') {
    throw new Error(`${path}.kind must be "dependent"`)
  }
  if (!Number.isInteger(input.ownerArg) || input.ownerArg < 0) {
    throw new Error(`${path}.ownerArg must be a non-negative integer`)
  }
  return Object.freeze({ kind: 'dependent', ownerArg: input.ownerArg })
}

function normalizeResources(
  entries: Readonly<Record<string, ResourceInput>> | undefined,
): Map<string, Resource> {
  return new Map(
    objectEntries(entries, 'resources').map(([cName, entry]) => {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new Error(`resources.${cName} must be an object`)
      }
      for (const option of Object.keys(entry)) {
        if (!new Set(['defaultLifetime', 'moonbit', 'release', 'retain']).has(option)) {
          throw new Error(`resources.${cName} uses unknown option ${option}`)
        }
      }
      if (!new Set(['owned', 'retained', 'unmanaged']).has(entry.defaultLifetime)) {
        throw new Error(
          `resources.${cName}.defaultLifetime must be "owned", "retained", or "unmanaged"`,
        )
      }
      if (entry.release !== undefined && typeof entry.release !== 'string') {
        throw new Error(`resources.${cName}.release must be a string`)
      }
      if (entry.retain !== undefined && typeof entry.retain !== 'string') {
        throw new Error(`resources.${cName}.retain must be a string`)
      }
      return [cName, Object.freeze({ ...entry, cName })]
    }),
  )
}

function normalizeTypeRenames(
  entries: Readonly<Record<string, string>> | undefined,
): Map<string, string> {
  return new Map(
    objectEntries(entries, 'renames.types').map(([cName, moonbit]) => {
      if (typeof moonbit !== 'string' || moonbit.length === 0) {
        throw new Error(`renames.types.${cName} must be a non-empty string`)
      }
      return [cName, moonbit]
    }),
  )
}

function normalizeFunction(entry: FunctionConfigInput): FunctionConfig {
  if (typeof entry === 'string') {
    return Object.freeze({
      name: entry,
      params: new Map<string, ParamPolicy>(),
      return: {},
    })
  }
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new Error('functions entries must be strings or objects')
  }
  if (typeof entry.name !== 'string' || entry.name.length === 0) {
    throw new Error('functions entries must have a name')
  }
  const params = new Map<string, ParamPolicy>(
    objectEntries(entry.params, `functions.${entry.name}.params`),
  )
  for (const [name, policy] of params) {
    if (policy === null || typeof policy !== 'object' || Array.isArray(policy)) {
      throw new Error(`functions.${entry.name}.params.${name} must be an object`)
    }
    for (const option of Object.keys(policy)) {
      if (!new Set(['emptyAsNull', 'nullable', 'passing']).has(option)) {
        throw new Error(`functions.${entry.name}.params.${name} uses unknown option ${option}`)
      }
    }
  }
  const returnPolicy = entry.return ?? {}
  if (returnPolicy === null || typeof returnPolicy !== 'object' || Array.isArray(returnPolicy)) {
    throw new Error(`functions.${entry.name}.return must be an object`)
  }
  for (const option of Object.keys(returnPolicy)) {
    if (!new Set(['free', 'lifetime', 'ownership']).has(option)) {
      throw new Error(`functions.${entry.name}.return uses unknown option ${option}`)
    }
  }
  if (
    returnPolicy.ownership !== undefined &&
    !new Set(['borrowed', 'owned']).has(returnPolicy.ownership)
  ) {
    throw new Error(`functions.${entry.name}.return.ownership must be "borrowed" or "owned"`)
  }
  const lifetime =
    returnPolicy.lifetime === undefined
      ? undefined
      : normalizeResourceLifetime(returnPolicy.lifetime, `functions.${entry.name}.return.lifetime`)
  return Object.freeze({
    ...entry,
    params,
    return: Object.freeze({ ...returnPolicy, lifetime }),
  })
}

export function normalizeConfig(input: ConfigInput): NormalizedConfig {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('config must be an object')
  }
  if (typeof input.namespace !== 'string' || input.namespace.length === 0) {
    throw new Error('config.namespace is required')
  }

  const functions = (input.functions ?? []).map(normalizeFunction)
  const functionsByName = new Map(functions.map((entry) => [entry.name, entry]))
  if (functionsByName.size !== functions.length) {
    throw new Error('config.functions contains duplicate names')
  }
  const functionMode = input.functionMode ?? (functions.length > 0 ? 'explicit' : 'discover')
  if (!new Set(['discover', 'explicit']).has(functionMode)) {
    throw new Error('config.functionMode must be "explicit" or "discover"')
  }
  const unsupportedPolicy =
    input.unsupportedPolicy ?? (functionMode === 'explicit' ? 'error' : 'report')
  if (!new Set(['error', 'report']).has(unsupportedPolicy)) {
    throw new Error('config.unsupportedPolicy must be "error" or "report"')
  }

  const namePrefixes = Object.freeze([...(input.namePrefixes ?? [])])
  return Object.freeze({
    namespace: input.namespace,
    symbolPrefix: input.symbolPrefix ?? `moonbit_${input.namespace}`,
    namePrefixes,
    typeNamePrefixes: Object.freeze([...(input.typeNamePrefixes ?? namePrefixes)]),
    functionNamePrefixes: Object.freeze([...(input.functionNamePrefixes ?? namePrefixes)]),
    typeRenames: normalizeTypeRenames(input.typeRenames),
    typeOverrides: normalizeTypeOverrides(input.typeOverrides),
    resources: normalizeResources(input.resources),
    valueStructs: normalizeNamedTypes(input.valueStructs, 'valueStructs'),
    functionMode,
    unsupportedPolicy,
    functions: Object.freeze(functions),
    functionsByName,
  })
}
