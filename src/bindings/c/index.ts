export { loadBindingC } from './c-loader.ts'
export { createSourceCRegex } from './sources/regex/c-regex-source.ts'
export { defineConfig } from './c-config.ts'
export { createBindingEmitters } from './emit/c-emit.ts'
export { createCStubEmitter } from './emit/c-stub.ts'
export { createCStringHelperEmitter } from './emit/c-string.ts'
export { createMoonBitEmitter } from './emit/c-moonbit.ts'
export { createPointerHelperEmitter } from './emit/c-pointer.ts'
export { formatGenerationSummary } from './c-diagnostics.ts'
export { AbiKind, lowerBindings } from './c-lower.ts'
export { createApiModel } from './c-model.ts'
export { createApiSource, loadApiSources } from './c-source-plugin.ts'

export type { BindingInputs, LoadBindingCOptions } from './c-loader.ts'
export type { RegexCSourceOptions } from './sources/regex/c-regex-source.ts'
export type { CPointer, CQualifier, CType } from './c-type.ts'
export type {
  ApiDeclaration,
  ApiDeclarationInput,
  ApiHeader,
  ApiHeaderInput,
  ApiModel,
  ApiModelInput,
  ApiSource,
  Binding,
  BindingPolicyInput,
  ConfigInput,
  DefaultResourceLifetime,
  Diagnostic,
  Emitter,
  EmitterOptions,
  FunctionConfigInput,
  GeneratorConfigInput,
  LoweredFunction,
  LoweredHeader,
  LoweredType,
  NormalizedConfig,
  ParamPolicy,
  ResourceInput,
  ResourceLifetime,
  ResourceLifetimeInput,
  ReturnPolicy,
  SourceContext,
} from './c-types.ts'
