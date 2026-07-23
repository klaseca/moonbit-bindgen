import type { GeneratedFile } from '../../core/types.ts'
import type { CType } from './c-type.ts'

export type CParam = Readonly<{
  name: string
  type: CType
}>

export type CField = CParam

export type AccessorDeclaration = Readonly<{
  fieldPath: readonly string[]
  name: string
  type: CType
  cType?: string
  moonbit?: string
  kind?: AbiKindValue
}>

type DeclarationBase = Readonly<{
  cName: string
  header: string
  source?: string
}>

export type AliasDeclaration = DeclarationBase &
  Readonly<{
    kind: 'alias'
    type?: CType
    moonbit?: string
  }>

export type ConstantDeclaration = DeclarationBase &
  Readonly<{
    kind: 'constant'
    literal: string
    type: string
    moonbit?: string
  }>

export type FunctionDeclaration = DeclarationBase &
  Readonly<{
    kind: 'function'
    returnType: CType
    params: readonly CParam[]
  }>

export type OpaqueTypeDeclaration = DeclarationBase &
  Readonly<{
    kind: 'opaque-type'
    moonbit?: string
  }>

export type ValueStructDeclaration = DeclarationBase &
  Readonly<{
    kind: 'value-struct'
    fields: readonly CField[]
    accessors?: readonly AccessorDeclaration[]
  }>

export type ApiDeclaration =
  | AliasDeclaration
  | ConstantDeclaration
  | FunctionDeclaration
  | OpaqueTypeDeclaration
  | ValueStructDeclaration

export type ApiDeclarationInput =
  | Omit<AliasDeclaration, 'header'>
  | Omit<ConstantDeclaration, 'header'>
  | Omit<FunctionDeclaration, 'header'>
  | Omit<OpaqueTypeDeclaration, 'header'>
  | Omit<ValueStructDeclaration, 'header'>

export type HeaderInclude = `<${string}>` | `"${string}"`

export type ApiHeader = Readonly<{
  path: string
  include: HeaderInclude
  outputBase: string
  emit: boolean
  declarations: readonly ApiDeclaration[]
}>

export type ApiHeaderInput = Readonly<{
  path: string
  include?: HeaderInclude
  outputBase: string
  emit?: boolean
  declarations: readonly ApiDeclarationInput[]
}>

export type ApiModel = Readonly<{
  headers: readonly ApiHeader[]
  declarations: Map<string, ApiDeclaration>
}>

export type ApiModelInput = Readonly<{
  headers: readonly ApiHeaderInput[]
  onConflict?: 'error' | 'first'
}>

export type TypeOverrideInput = Readonly<{
  moonbit: string
  abiC?: string
  init?: string
}>

export type ScalarType = Readonly<{
  moonbit: string
  c: string
  init?: string
}>

export type NamedTypeInput = Readonly<{
  moonbit?: string
  accessors?: Readonly<Record<string, string | Readonly<{ name?: string; type?: string }>>>
}>

export type NamedType = NamedTypeInput & Readonly<{ cName: string }>

export type DefaultResourceLifetime = 'owned' | 'retained' | 'unmanaged'

export type ResourceLifetimeInput =
  | DefaultResourceLifetime
  | Readonly<{
      kind: 'dependent'
      ownerArg: number
    }>

export type ResourceLifetime =
  | Readonly<{ kind: DefaultResourceLifetime }>
  | Readonly<{
      kind: 'dependent'
      ownerArg: number
    }>

export type ResourceInput = Readonly<{
  moonbit?: string
  release?: string
  retain?: string
  defaultLifetime: DefaultResourceLifetime
}>

export type Resource = ResourceInput & Readonly<{ cName: string }>

export type ParamPolicy = Readonly<{
  emptyAsNull?: boolean
  nullable?: boolean
  passing?: 'null'
}>

export type ReturnPolicy = Readonly<{
  free?: string
  ownership?: 'borrowed' | 'owned'
  lifetime?: ResourceLifetimeInput
}>

export type FunctionConfigInput =
  | string
  | Readonly<{
      name: string
      rename?: string
      params?: Readonly<Record<string, ParamPolicy>>
      return?: ReturnPolicy
    }>

export type FunctionConfig = Readonly<{
  name: string
  rename?: string
  params: Map<string, ParamPolicy>
  return: Omit<ReturnPolicy, 'lifetime'> & Readonly<{ lifetime?: ResourceLifetime }>
}>

export type BindingPolicyInput = Readonly<
  Partial<{
    typeOverrides: Readonly<Record<string, TypeOverrideInput>>
    resources: Readonly<Record<string, ResourceInput>>
    valueStructs: Readonly<Record<string, NamedTypeInput>>
    functionMode: 'discover' | 'explicit'
    unsupportedPolicy: 'error' | 'report'
    functions: readonly FunctionConfigInput[]
  }>
>

export type GeneratorConfigInput = BindingPolicyInput &
  Readonly<{
    projectRoot: string
    includeDir: string
    outputDir: string
    headers?: readonly string[]
    typeHeaders?: readonly string[]
    constantPrefixes?: readonly string[]
    renames?: Readonly<{
      functions?: Readonly<Record<string, string>>
      types?: Readonly<Record<string, string>>
    }>
  }>

export type ConfigInput = BindingPolicyInput &
  Readonly<{
    namespace: string
    symbolPrefix?: string
    namePrefixes?: readonly string[]
    typeNamePrefixes?: readonly string[]
    functionNamePrefixes?: readonly string[]
    typeRenames?: Readonly<Record<string, string>>
  }>

export type NormalizedConfig = Readonly<{
  namespace: string
  symbolPrefix: string
  namePrefixes: readonly string[]
  typeNamePrefixes: readonly string[]
  functionNamePrefixes: readonly string[]
  typeRenames: Map<string, string>
  typeOverrides: Map<string, ScalarType>
  resources: Map<string, Resource>
  valueStructs: Map<string, NamedType>
  functionMode: 'discover' | 'explicit'
  unsupportedPolicy: 'error' | 'report'
  functions: readonly FunctionConfig[]
  functionsByName: Map<string, FunctionConfig>
}>

export const abiKindValues = [
  'bytes-parameter',
  'cstring-parameter',
  'cstring-return',
  'direct',
  'implicit-null',
  'opaque-pointer',
  'out-parameter',
  'resource',
  'value-struct',
] as const

export type AbiKindValue = (typeof abiKindValues)[number]

export type TypePosition = 'param' | 'return'

type LoweredBase = Readonly<{
  cType: string
  nativeCType: string
}>

export type DirectType = LoweredBase & Readonly<{ kind: 'direct'; moonbit: string }>

export type OpaquePointerType = LoweredBase & Readonly<{ kind: 'opaque-pointer'; moonbit: string }>

export type BytesParameterType = LoweredBase &
  Readonly<{ kind: 'bytes-parameter'; moonbit: 'Bytes' }>

export type CStringParameterType = LoweredBase &
  Readonly<{
    kind: 'cstring-parameter'
    moonbit: 'Bytes'
    ownership: 'borrowed'
    emptyAsNull: boolean
  }>

export type CStringReturnType = LoweredBase &
  Readonly<{
    kind: 'cstring-return'
    moonbit: 'Bytes'
    ownership: 'borrowed' | 'owned'
    free?: string
  }>

export type ImplicitNullType = LoweredBase & Readonly<{ kind: 'implicit-null'; moonbit: undefined }>

export type OutParameterType = LoweredBase &
  Readonly<{
    kind: 'out-parameter'
    moonbit: string
    value: ScalarType
    nativeValueCType: string
  }>

export type ResourceType = LoweredBase &
  Readonly<{
    kind: 'resource'
    moonbit: string
    resource: string
    lifetime: ResourceLifetime
  }>

export type ValueStructType = LoweredBase &
  Readonly<{
    kind: 'value-struct'
    moonbit: string
    nullable: boolean
  }>

export type LoweredType =
  | BytesParameterType
  | CStringParameterType
  | CStringReturnType
  | DirectType
  | ImplicitNullType
  | OpaquePointerType
  | OutParameterType
  | ResourceType
  | ValueStructType

export type LoweringContext = Readonly<{
  model: ApiModel
  config: Pick<
    NormalizedConfig,
    | 'namePrefixes'
    | 'resources'
    | 'symbolPrefix'
    | 'typeNamePrefixes'
    | 'typeRenames'
    | 'typeOverrides'
    | 'valueStructs'
  >
}>

export type LoweredParam = CParam & Readonly<{ lowered: LoweredType }>

export type LoweredFunction = Readonly<{
  cName: string
  moonbit: string
  symbol: string
  header: string
  params: readonly LoweredParam[]
  returnType: LoweredType
}>

export type LoweredValueStruct = ValueStructDeclaration &
  Readonly<{
    accessors: readonly (AccessorDeclaration &
      Readonly<{ cType: string; moonbit: string; kind: AbiKindValue }>)[]
  }>

export type LoweredHeader = Readonly<{
  path: string
  include: HeaderInclude
  outputBase: string
  constants: readonly ConstantDeclaration[]
  functions: readonly LoweredFunction[]
  opaqueTypes: readonly OpaqueTypeDeclaration[]
  resources: readonly OpaqueTypeDeclaration[]
  valueStructs: readonly LoweredValueStruct[]
}>

export type Diagnostic = Readonly<{
  header: string
  name: string
  reason: string
}>

export type Binding = Readonly<{
  model: ApiModel
  namespace: string
  symbolPrefix: string
  namePrefixes: readonly string[]
  typeNamePrefixes: readonly string[]
  functionNamePrefixes: readonly string[]
  typeRenames: Map<string, string>
  typeOverrides: Map<string, ScalarType>
  resources: Map<string, Resource>
  valueStructs: Map<string, NamedType>
  headers: readonly LoweredHeader[]
  functions: readonly LoweredFunction[]
  diagnostics: Readonly<{
    generated: number
    skipped: readonly Diagnostic[]
  }>
}>

export type Emitter = Readonly<{
  name: string
  emitHeader(header: LoweredHeader, binding: Binding): readonly GeneratedFile[]
}>

export type EmitterOptions = Readonly<{
  suffix?: string
  comment?: string
}>

export type SourceContext = Readonly<{
  projectRoot: string
  includeDir: string
  outputDir: string
  rawConfig: GeneratorConfigInput
  source?: string
}>

export type ApiSource = Readonly<{
  name: string
  load(context: SourceContext): ApiModel | ApiModelInput
}>
