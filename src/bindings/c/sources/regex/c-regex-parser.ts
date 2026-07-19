import { parseCType, normalizeCType } from './c-regex-type.ts'
import { createApiModel } from '../../c-model.ts'
import type { CType } from '../../c-type.ts'
import type {
  AccessorDeclaration,
  ApiDeclarationInput,
  ApiModel,
  CField,
  NamedTypeInput,
} from '../../c-types.ts'

export type NormalizeCType = (type: string) => string

type AccessorEntry = string | Readonly<{ name?: string; type?: string }>

type StructInfo = Readonly<{
  kind: string
  cName: string
  fields: readonly CField[]
  fieldsByName: Map<string, CField>
}>

type HeaderInput = Readonly<{
  path: string
  include?: string
  outputBase: string
  source: string
  emit?: boolean
}>

export type RegexParserInput = Readonly<{
  headers: readonly HeaderInput[]
  normalizeType?: NormalizeCType
  functionGroups?: Readonly<{ returnType: number; name: number; params: number }>
  functions?: readonly string[]
  valueStructs?: Readonly<Record<string, NamedTypeInput>>
  constantPrefixes?: readonly string[]
  constantType?: (name: string) => string
  accessorName?: (cName: string, field: string) => string
  functionPattern?: RegExp
  enumAliasType?: (name: string, body: string) => string
  prepareFunctionSource?: (source: string) => string
}>

type ParserOptions = Required<Omit<RegexParserInput, 'headers' | 'functions'>> & {
  functions: Set<string>
}

function capture(match: RegExpMatchArray, index: number): string {
  const value = match[index]
  if (value === undefined) {
    throw new Error(`regular expression did not provide capture group ${index}`)
  }
  return value
}

export function stripCComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, ' ')
}

function parseFieldStatement(text: string, normalizeType: NormalizeCType) {
  // Function pointers need a dedicated CType variant. They are not value
  // fields supported by the current binding pipeline, so do not misparse them
  // as ordinary pointer declarators.
  if (text.includes('(') || text.includes(')')) return undefined
  const parts = text
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
  if (parts.length === 0) return undefined
  const first = parts[0]
  if (first === undefined) return undefined
  const match = first.match(/^(.+?)\s*(\*+\s*)?([A-Za-z_]\w*(?:\s*\[[^\]]*\])?)$/)
  if (!match) return undefined
  return {
    baseType: normalizeType(capture(match, 1)),
    declarators: [`${match[2] ?? ''}${capture(match, 3)}`, ...parts.slice(1)],
  }
}

function parseFieldDeclarator(
  baseType: string,
  rawName: string,
  normalizeType: NormalizeCType,
): CField | undefined {
  let text = rawName.trim()
  let pointer = ''
  while (text.startsWith('*')) {
    pointer += ' *'
    text = text.slice(1).trim()
  }
  const name = text.replace(/\[[^\]]*\]/g, '').trim()
  if (!/^[A-Za-z_]\w*$/.test(name)) return undefined
  return { name, type: parseCType(normalizeType(`${baseType}${pointer}`)) }
}

function parseFields(body: string, normalizeType: NormalizeCType): CField[] {
  const fields: CField[] = []
  for (const statement of body.split(';')) {
    const parsed = parseFieldStatement(statement.trim(), normalizeType)
    if (!parsed) continue
    for (const rawName of parsed.declarators) {
      const field = parseFieldDeclarator(parsed.baseType, rawName, normalizeType)
      if (field) fields.push(field)
    }
  }
  return fields
}

function parseStructs(source: string, normalizeType: NormalizeCType): Map<string, StructInfo> {
  const structs = new Map<string, StructInfo>()
  const pattern =
    /typedef\s+(struct|union)(?:\s+([A-Za-z_]\w*))?\s*\{([\s\S]*?)\}\s*([A-Za-z_]\w*)\s*;/g
  for (const match of source.matchAll(pattern)) {
    const kind = capture(match, 1)
    const body = capture(match, 3)
    const cName = capture(match, 4)
    const fields = parseFields(body, normalizeType)
    structs.set(cName, {
      kind,
      cName,
      fields,
      fieldsByName: new Map(fields.map((field) => [field.name, field])),
    })
  }
  return structs
}

function enumAliasType(name: string, body: string, options: ParserOptions): string {
  for (const rawEntry of body.split(',')) {
    const match = rawEntry.trim().match(/^([A-Z_][A-Z0-9_]*)(?:\s*=.*)?$/)
    if (!match) continue
    const constant = capture(match, 1)
    if (!selectedConstant(constant, options.constantPrefixes)) continue
    return options.constantType(constant)
  }
  return options.enumAliasType(name, body)
}

function parseAliases(source: string, options: ParserOptions): ApiDeclarationInput[] {
  const aliases: ApiDeclarationInput[] = []
  const enumPattern = /typedef\s+enum(?:\s+[A-Za-z_]\w*)?\s*\{([\s\S]*?)\}\s*([A-Za-z_]\w*)\s*;/g
  for (const match of source.matchAll(enumPattern)) {
    const body = capture(match, 1)
    const cName = capture(match, 2)
    aliases.push({
      kind: 'alias',
      cName,
      moonbit: enumAliasType(cName, body, options),
    })
  }

  const simplePattern = /typedef\s+([^;{}()]+?)\s+([A-Za-z_]\w*)\s*;/g
  for (const match of source.matchAll(simplePattern)) {
    const typeSource = options.normalizeType(capture(match, 1))
    if (/^(?:struct|union|enum)\b/.test(typeSource)) continue
    aliases.push({
      kind: 'alias',
      cName: capture(match, 2),
      type: parseCType(typeSource),
    })
  }
  return aliases
}

function resolveFieldPathType(
  structs: Map<string, StructInfo>,
  cName: string,
  fieldPath: readonly string[],
): CType | undefined {
  let currentType = cName
  for (let index = 0; index < fieldPath.length; index += 1) {
    const segment = fieldPath[index]
    if (segment === undefined) return undefined
    const field = structs.get(currentType)?.fieldsByName.get(segment)
    if (!field) return undefined
    if (index === fieldPath.length - 1) return field.type
    currentType = field.type.name
  }
  return undefined
}

function accessorName(
  cName: string,
  field: string,
  entry: AccessorEntry,
  defaultName: (cName: string, field: string) => string,
): string {
  if (typeof entry === 'string') return entry
  if (entry && typeof entry === 'object' && typeof entry.name === 'string') {
    return entry.name
  }
  return defaultName(cName, field)
}

function buildAccessors(
  structs: Map<string, StructInfo>,
  valueStructs: Readonly<Record<string, NamedTypeInput>>,
  normalizeType: NormalizeCType,
  defaultName: (cName: string, field: string) => string,
): Map<string, readonly AccessorDeclaration[]> {
  const result = new Map<string, readonly AccessorDeclaration[]>()
  for (const [cName, config] of Object.entries(valueStructs)) {
    const accessors: AccessorDeclaration[] = []
    for (const [field, entry] of Object.entries(config.accessors ?? {})) {
      const fieldPath = field.split('.')
      const type =
        entry && typeof entry === 'object' && typeof entry.type === 'string'
          ? parseCType(normalizeType(entry.type))
          : resolveFieldPathType(structs, cName, fieldPath)
      if (!type) {
        throw new Error(`${cName}.${field}: cannot resolve accessor type`)
      }
      accessors.push({
        fieldPath,
        name: accessorName(cName, field, entry, defaultName),
        type,
      })
    }
    result.set(cName, accessors)
  }
  return result
}

function parseNumericLiteral(value: string): string | undefined {
  let text = value.trim()
  while (true) {
    const wrapper = text.match(/^[A-Za-z_]\w*\((.*)\)$/)
    if (!wrapper) break
    text = capture(wrapper, 1).trim()
  }
  text = text.replace(/[uUlL]+$/g, '')
  if (/^\(-?\d+\)$/.test(text)) text = text.slice(1, -1)
  return /^0x[0-9a-fA-F]+$/.test(text) || /^-?\d+$/.test(text) ? text : undefined
}

function parseLiteral(value: string) {
  const firstToken = value.split(/\s+/)[0]
  const numeric = firstToken === undefined ? undefined : parseNumericLiteral(firstToken)
  if (numeric !== undefined) return { literal: numeric, string: false }
  const string = value.trim().match(/^"((?:\\.|[^"\\])*)"/)
  return string ? { literal: `b"${string[1]}"`, string: true } : undefined
}

function selectedConstant(name: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => name.startsWith(prefix))
}

function parseDefineConstants(source: string, options: ParserOptions): ApiDeclarationInput[] {
  const constants: ApiDeclarationInput[] = []
  for (const match of source.matchAll(/^\s*#define\s+([A-Z_][A-Z0-9_]*)\s+([^\r\n]+)/gm)) {
    const cName = capture(match, 1)
    if (!selectedConstant(cName, options.constantPrefixes)) continue
    const value = parseLiteral(capture(match, 2))
    if (!value) continue
    constants.push({
      kind: 'constant',
      cName,
      literal: value.literal,
      type: value.string ? 'Bytes' : options.constantType(cName),
    })
  }
  return constants
}

function parseEnumConstants(source: string, options: ParserOptions): ApiDeclarationInput[] {
  const constants: ApiDeclarationInput[] = []
  const pattern = /typedef\s+enum(?:\s+[A-Za-z_]\w*)?\s*\{([\s\S]*?)\}\s*[A-Za-z_]\w*\s*;/g
  for (const enumMatch of source.matchAll(pattern)) {
    let nextValue = 0
    for (const rawEntry of capture(enumMatch, 1).split(',')) {
      const match = rawEntry.trim().match(/^([A-Z_][A-Z0-9_]*)(?:\s*=\s*([^,]+))?$/)
      if (!match) continue
      const cName = capture(match, 1)
      if (!selectedConstant(cName, options.constantPrefixes)) continue
      const literal = match[2] ? parseNumericLiteral(match[2]) : String(nextValue)
      if (literal === undefined) continue
      nextValue = Number.parseInt(literal) + 1
      constants.push({
        kind: 'constant',
        cName,
        literal,
        type: options.constantType(cName),
      })
    }
  }
  return constants
}

function splitParams(params: string, normalizeType: NormalizeCType): CField[] {
  const text = params.trim()
  if (text === '' || text === 'void') return []
  return text.split(',').map((param, index) => {
    const normalized = normalizeType(param)
    const match = normalized.match(/^(.*?)([A-Za-z_]\w*)$/)
    if (!match || capture(match, 1).trim() === '') {
      return { name: `arg${index}`, type: parseCType(normalized) }
    }
    return {
      name: capture(match, 2),
      type: parseCType(normalizeType(capture(match, 1))),
    }
  })
}

function parseFunctions(source: string, options: ParserOptions): ApiDeclarationInput[] {
  const declarations: ApiDeclarationInput[] = []
  const compact = options.prepareFunctionSource(source).replace(/\s+/g, ' ')
  for (const match of compact.matchAll(options.functionPattern)) {
    const cName = capture(match, options.functionGroups.name)
    if (options.functions.size > 0 && !options.functions.has(cName)) continue
    declarations.push({
      kind: 'function',
      cName,
      returnType: parseCType(
        options.normalizeType(capture(match, options.functionGroups.returnType)),
      ),
      params: splitParams(capture(match, options.functionGroups.params), options.normalizeType),
    })
  }
  return declarations
}

export function parseCHeadersWithRegex(input: RegexParserInput): ApiModel {
  const options: ParserOptions = {
    normalizeType: input.normalizeType ?? normalizeCType,
    functionGroups: input.functionGroups ?? {
      returnType: 1,
      name: 2,
      params: 3,
    },
    functions: new Set(input.functions ?? []),
    valueStructs: input.valueStructs ?? {},
    constantPrefixes: input.constantPrefixes ?? [],
    constantType: input.constantType ?? (() => 'UInt'),
    accessorName:
      input.accessorName ??
      ((cName, field) => `${cName.toLowerCase()}_${field.replaceAll('.', '_')}`),
    functionPattern: input.functionPattern ?? /extern\s+(.*?)\s+([A-Za-z_]\w*)\s*\((.*?)\)\s*;/g,
    enumAliasType: input.enumAliasType ?? (() => 'Int'),
    prepareFunctionSource: input.prepareFunctionSource ?? stripCComments,
  }
  const headers = input.headers.map((header) => ({
    ...header,
    stripped: stripCComments(header.source),
  }))
  const structs = new Map(
    headers.flatMap((header) => [...parseStructs(header.stripped, options.normalizeType)]),
  )
  const accessors = buildAccessors(
    structs,
    options.valueStructs,
    options.normalizeType,
    options.accessorName,
  )
  const selectedStructs = new Set(Object.keys(options.valueStructs))

  return createApiModel({
    headers: headers.map((header) => ({
      path: header.path,
      include: header.include,
      outputBase: header.outputBase,
      emit: header.emit,
      declarations: [
        ...parseAliases(header.stripped, options),
        ...[
          ...header.stripped.matchAll(/typedef\s+struct\s+[A-Za-z_]\w*\s+([A-Za-z_]\w*)\s*;/g),
        ].map((match) => ({ kind: 'opaque-type' as const, cName: capture(match, 1) })),
        ...[...parseStructs(header.stripped, options.normalizeType).values()]
          .filter((declaration) => selectedStructs.has(declaration.cName))
          .map((declaration) => ({
            kind: 'value-struct' as const,
            cName: declaration.cName,
            fields: declaration.kind === 'struct' ? declaration.fields : [],
            accessors: accessors.get(declaration.cName) ?? [],
          })),
        ...parseDefineConstants(header.source, options),
        ...parseEnumConstants(header.stripped, options),
        ...parseFunctions(header.source, options),
      ],
    })),
  })
}
