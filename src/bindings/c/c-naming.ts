// Source: MoonBit Lexical Conventions, checked 2026-10-26.
// https://docs.moonbitlang.com/en/latest/language/lexical-conventions.html#keywords
// Keep future reserved words too: generated code must also pass --deny-warn.
const reservedIdentifiers = new Set([
  'as',
  'else',
  'extern',
  'fn',
  'if',
  'let',
  'const',
  'match',
  'using',
  'mut',
  'type',
  'struct',
  'enum',
  'extenum',
  'trait',
  'derive',
  'while',
  'break',
  'continue',
  'import',
  'return',
  'throw',
  'raise',
  'try',
  'catch',
  'pub',
  'priv',
  'proof_assert',
  'proof_let',
  'readonly',
  'true',
  'false',
  '_',
  'test',
  'loop',
  'for',
  'in',
  'impl',
  'with',
  'guard',
  'async',
  'is',
  'suberror',
  'and',
  'letrec',
  'enumview',
  'noraise',
  'nocancel',
  'defer',
  'lexscan',
  'lexmatch',
  'where',
  'declare',
  'nobreak',
  'extend',
  'module',
  'move',
  'ref',
  'static',
  'super',
  'unsafe',
  'use',
  'await',
  'dyn',
  'abstract',
  'do',
  'final',
  'macro',
  'override',
  'typeof',
  'virtual',
  'yield',
  'local',
  'method',
  'alias',
  'assert',
  'package',
  'recur',
  'isnot',
  'define',
  'downcast',
  'inherit',
  'member',
  'namespace',
  'upcast',
  'void',
  'lazy',
  'include',
  'mixin',
  'protected',
  'sealed',
  'constructor',
  'atomic',
  'volatile',
  'anyframe',
  'anytype',
  'asm',
  'comptime',
  'errdefer',
  'export',
  'opaque',
  'orelse',
  'resume',
  'threadlocal',
  'unreachable',
  'dynclass',
  'dynobj',
  'dynrec',
  'var',
  'finally',
  'noasync',
  'assume',
  // Compatibility spellings still recognized by supported older toolchains.
  'fnalias',
  'typealias',
  'traitalias',
])

export function escapeIdentifier(name: string): string {
  // `self` is legal MoonBit, but is the receiver name used by generated methods.
  return reservedIdentifiers.has(name) || name === 'self' ? `${name}_` : name
}

export function toMoonBitFieldName(name: string): string {
  return escapeIdentifier(
    name
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .toLowerCase(),
  )
}

export function stripNamePrefix(name: string, prefixes: readonly string[]): string {
  const prefix = [...prefixes]
    .sort((left, right) => right.length - left.length)
    .find((candidate) => name.startsWith(candidate))
  return prefix ? name.slice(prefix.length) : name
}

export function toMoonBitTypeName(cName: string, prefixes: readonly string[] = []): string {
  return stripNamePrefix(cName, prefixes)
    .replace(/_t$/, '')
    .split('_')
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join('')
}

export function toMoonBitFunctionName(cName: string, prefixes: readonly string[] = []): string {
  return toMoonBitFieldName(stripNamePrefix(cName, prefixes))
}

export function toCSymbolPart(cName: string): string {
  return cName
    .replace(/_t$/, '')
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .toLowerCase()
}
