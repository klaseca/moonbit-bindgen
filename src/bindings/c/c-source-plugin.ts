// Parser-independent source plugin contract. Implementations return API model
// fragments; this module only validates and merges them.
import { createApiModel } from './c-model.ts'
import type {
  ApiDeclarationInput,
  ApiHeaderInput,
  ApiModel,
  ApiModelInput,
  ApiSource,
  SourceContext,
} from './c-types.ts'

function sourceName(source: ApiSource | undefined, index: number): string {
  return source?.name ?? `source-${index + 1}`
}

function apiHeaders(
  result: ApiModel | ApiModelInput,
  name: string,
): readonly (ApiModel['headers'][number] | ApiHeaderInput)[] {
  if (!result || !Array.isArray(result.headers)) {
    throw new Error(`${name}.load() must return an API model or { headers } fragment`)
  }
  return result.headers
}

/**
 * Defines a declaration source. A source may parse headers with regular
 * expressions, invoke Clang, read a JSON description, or combine another tool's
 * output. The shared pipeline only depends on the returned API fragment.
 */
export function createApiSource({ name, load }: ApiSource): ApiSource {
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error('source.name is required')
  }
  if (typeof load !== 'function') {
    throw new Error(`${name}.load must be a function`)
  }
  return Object.freeze({ name, load })
}

/**
 * Loads and merges declarations from several independent source plugins.
 * Headers with the same path are combined, which allows (for example) a Clang
 * source and a macro source to contribute to the same generated file.
 */
export function loadApiSources(sources: readonly ApiSource[], context: SourceContext): ApiModel {
  if (!Array.isArray(sources) || sources.length === 0) {
    throw new Error('at least one API source is required')
  }

  const headers = new Map<
    string,
    {
      path: string
      include: string
      outputBase: string
      emit: boolean
      declarations: (ApiDeclarationInput & { source?: string })[]
    }
  >()
  for (let index = 0; index < sources.length; index += 1) {
    const source = sources[index]
    const name = sourceName(source, index)
    if (!source || typeof source.load !== 'function') {
      throw new Error(`${name} must define load(context)`)
    }
    const result = source.load(Object.freeze({ ...context, source: name }))
    for (const header of apiHeaders(result, name)) {
      const current = headers.get(header.path)
      if (!current) {
        headers.set(header.path, {
          path: header.path,
          include: header.include ?? header.path,
          outputBase: header.outputBase,
          emit: header.emit ?? true,
          declarations: header.declarations.map((declaration) => ({
            ...declaration,
            source: declaration.source ?? name,
          })),
        })
        continue
      }
      if (header.include !== undefined && current.include !== header.include) {
        throw new Error(
          `${header.path}: sources disagree on include (${current.include} vs ${header.include})`,
        )
      }
      if (
        current.outputBase !== undefined &&
        header.outputBase !== undefined &&
        current.outputBase !== header.outputBase
      ) {
        throw new Error(
          `${header.path}: sources disagree on outputBase (${current.outputBase} vs ${header.outputBase})`,
        )
      }
      current.outputBase ??= header.outputBase
      current.emit = current.emit !== false || header.emit !== false
      current.declarations.push(
        ...header.declarations.map((declaration) => ({
          ...declaration,
          source: declaration.source ?? name,
        })),
      )
    }
  }

  return createApiModel({ headers: [...headers.values()], onConflict: 'error' })
}
