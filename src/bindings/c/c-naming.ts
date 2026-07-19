export function stripNamePrefix(name: string, prefixes: readonly string[]): string {
  const prefix = [...prefixes]
    .sort((left, right) => right.length - left.length)
    .find((candidate) => name.startsWith(candidate))
  return prefix ? name.slice(prefix.length) : name
}

function titleCaseCTypeName(name: string): string {
  return name
    .replace(/_t$/, '')
    .split('_')
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join('')
}

export function toMoonBitTypeName(cName: string, prefixes: readonly string[] = []): string {
  return titleCaseCTypeName(stripNamePrefix(cName, prefixes))
}

export function toMoonBitFunctionName(cName: string, prefixes: readonly string[] = []): string {
  const name = stripNamePrefix(cName, prefixes)
  return name
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
}

export function toCSymbolPart(cName: string): string {
  return cName
    .replace(/_t$/, '')
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .toLowerCase()
}
