import { existsSync, readFileSync } from 'node:fs'
import { basename, relative, resolve } from 'node:path'

import { normalizeCType } from './c-regex-type.ts'
import { parseCHeadersWithRegex, stripCComments } from './c-regex-parser.ts'
import { createApiSource } from '../../c-source-plugin.ts'
import type { NormalizeCType, RegexParserInput } from './c-regex-parser.ts'
import type { ApiSource, GeneratorConfigInput } from '../../c-types.ts'

type LoadedHeader = Readonly<{
  path: string
  include: string
  outputBase: string
  source: string
  emit: boolean
}>

export type RegexCSourceOptions = Readonly<{
  headerOutputBase: (file: string) => string
  prepareType?: (type: string) => string
  constantType?: RegexParserInput['constantType']
  functionPattern?: RegExp
  prepareFunctionSource?: RegexParserInput['prepareFunctionSource']
}>

type ResolvedOptions = RegexCSourceOptions & Readonly<{ normalizeType: NormalizeCType }>

function includedHeaders(source: string): string[] {
  return [...source.matchAll(/^\s*#include\s+[<"]([^>"]+)[>"]/gm)].flatMap((match) => {
    const header = match[1]
    return header === undefined ? [] : [header]
  })
}

function resolveIncludedHeader(includeDir: string, header: string): string | undefined {
  const includePrefix = `${basename(includeDir)}/`
  const candidates = [
    header,
    ...(header.startsWith(includePrefix) ? [header.slice(includePrefix.length)] : []),
  ].map((file) => resolve(includeDir, file))
  return candidates.find((candidate) => existsSync(candidate))
}

function loadHeaders(
  rawConfig: GeneratorConfigInput,
  includeDir: string,
  outputDir: string,
  options: ResolvedOptions,
): LoadedHeader[] {
  const headers = new Map<string, LoadedHeader>()
  const pendingIncludes: string[] = []

  function addHeader(file: string, emit: boolean): void {
    const current = headers.get(file)
    if (current) {
      if (emit && !current.emit) headers.set(file, { ...current, emit: true })
      return
    }

    const path = resolve(includeDir, file)
    const source = readFileSync(path, 'utf8')
    headers.set(file, {
      path: file,
      include: relative(outputDir, path).replaceAll('\\', '/'),
      outputBase: options.headerOutputBase(file),
      source,
      emit,
    })
    pendingIncludes.push(...includedHeaders(source))
  }

  for (const file of rawConfig.headers ?? []) addHeader(file, true)
  for (const file of rawConfig.typeHeaders ?? []) addHeader(file, false)

  for (let index = 0; index < pendingIncludes.length; index += 1) {
    const include = pendingIncludes[index]
    if (include === undefined) continue
    const resolved = resolveIncludedHeader(includeDir, include)
    if (!resolved) continue
    addHeader(resolved.slice(includeDir.length + 1).replaceAll('\\', '/'), false)
  }

  return [...headers.values()]
}

export function createSourceCRegex(input: RegexCSourceOptions): ApiSource {
  const options: ResolvedOptions = {
    ...input,
    normalizeType: (type) => normalizeCType(input.prepareType?.(type) ?? type),
    prepareFunctionSource:
      input.prepareFunctionSource === undefined
        ? undefined
        : (source) => input.prepareFunctionSource!(stripCComments(source)),
  }
  return createApiSource({
    name: 'regex',
    load(context) {
      const { rawConfig, includeDir, outputDir } = context
      const functions =
        rawConfig.functionMode === 'explicit'
          ? (rawConfig.functions ?? []).map((entry) =>
              typeof entry === 'string' ? entry : entry.name,
            )
          : []
      return parseCHeadersWithRegex({
        headers: loadHeaders(rawConfig, includeDir, outputDir, options),
        functions,
        normalizeType: options.normalizeType,
        valueStructs: rawConfig.valueStructs,
        constantPrefixes: rawConfig.constantPrefixes,
        constantType: options.constantType,
        functionPattern: options.functionPattern,
        prepareFunctionSource: options.prepareFunctionSource,
      })
    },
  })
}
