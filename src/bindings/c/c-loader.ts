import { resolve } from 'node:path'

import { normalizeConfig } from './c-config.ts'
import { loadApiSources } from './c-source-plugin.ts'
import type {
  ApiDeclaration,
  ApiModel,
  FunctionConfigInput,
  GeneratorConfigInput,
  NormalizedConfig,
  ParamPolicy,
  ReturnPolicy,
  ApiSource,
} from './c-types.ts'

export type LoadBindingCOptions = Readonly<{
  bindingName: string
  config: GeneratorConfigInput
  source: ApiSource
  baseDir?: string
  namePrefixes?: readonly string[]
  typeNamePrefixes?: readonly string[]
  ownedCStringFree?: string
}>

export type BindingInputs = Readonly<{
  api: ApiModel
  config: NormalizedConfig
  projectRoot: string
  includeDir: string
  outputDir: string
  rawConfig: GeneratorConfigInput
}>

type MutableFunctionConfig = {
  name: string
  rename?: string
  params?: Readonly<Record<string, ParamPolicy>>
  return?: ReturnPolicy
}

function configuredFunction(
  entry: FunctionConfigInput,
  rawConfig: GeneratorConfigInput,
  declarations: Map<string, ApiDeclaration>,
  ownedCStringFree: string | undefined,
): MutableFunctionConfig {
  const config: MutableFunctionConfig = typeof entry === 'string' ? { name: entry } : { ...entry }
  const rename = rawConfig.renames?.functions?.[config.name] ?? config.rename
  if (rename !== undefined) config.rename = rename
  const declaration = declarations.get(config.name)
  if (
    declaration?.kind === 'function' &&
    ownedCStringFree !== undefined &&
    declaration.returnType.name === 'char' &&
    declaration.returnType.pointers.length === 1 &&
    config.return?.ownership === undefined
  ) {
    config.return = {
      ...(config.return ?? {}),
      ownership: 'owned',
      free: ownedCStringFree,
    }
  }
  return config
}

export function loadBindingC(options: LoadBindingCOptions): BindingInputs {
  const baseDir = resolve(options.baseDir ?? process.cwd())
  const rawConfig = options.config
  const projectRoot = resolve(baseDir, rawConfig.projectRoot)
  const includeDir = resolve(projectRoot, rawConfig.includeDir)
  const outputDir = resolve(projectRoot, rawConfig.outputDir)
  const api = loadApiSources([options.source], {
    projectRoot,
    includeDir,
    outputDir,
    rawConfig,
  })
  const config = normalizeConfig({
    namespace: options.bindingName,
    namePrefixes: options.namePrefixes ?? [],
    typeOverrides: rawConfig.typeOverrides ?? {},
    functions: (rawConfig.functions ?? []).map((entry) =>
      configuredFunction(entry, rawConfig, api.declarations, options.ownedCStringFree),
    ),
    typeNamePrefixes: options.typeNamePrefixes,
    typeRenames: rawConfig.renames?.types,
    resources: rawConfig.resources,
    valueStructs: rawConfig.valueStructs,
    functionMode: rawConfig.functionMode,
    unsupportedPolicy: rawConfig.unsupportedPolicy,
  })

  return Object.freeze({ api, config, projectRoot, includeDir, outputDir, rawConfig })
}
