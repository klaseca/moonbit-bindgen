import type { CPointer, CQualifier, CType } from '../../c-type.ts'

const qualifierNames = new Set<CQualifier>(['const', 'restrict', 'volatile'])

function qualifier(word: string): CQualifier | undefined {
  return qualifierNames.has(word as CQualifier) ? (word as CQualifier) : undefined
}

function words(source: string): string[] {
  return source.trim().split(/\s+/).filter(Boolean)
}

export function normalizeCType(source: string): string {
  return source
    .replace(/\s+/g, ' ')
    .replace(/\s*\*\s*/g, ' * ')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/ \*(?= |$)/g, ' *')
}

export function parseCType(source: string): CType {
  const segments = normalizeCType(source).split('*')
  const baseWords = words(segments[0] ?? '')
  const qualifiers = baseWords.flatMap((word) => {
    const value = qualifier(word)
    return value === undefined ? [] : [value]
  })
  const name = baseWords.filter((word) => qualifier(word) === undefined).join(' ')
  if (name.length === 0) {
    throw new Error(`invalid C type: ${source}`)
  }

  const pointers: CPointer[] = segments.slice(1).map((segment) => {
    const pointerQualifiers = words(segment).map((word) => {
      const value = qualifier(word)
      if (value === undefined) {
        throw new Error(`unsupported pointer qualifier ${word} in C type: ${source}`)
      }
      return value
    })
    return Object.freeze({ qualifiers: Object.freeze(pointerQualifiers) })
  })

  return Object.freeze({
    name,
    qualifiers: Object.freeze(qualifiers),
    pointers: Object.freeze(pointers),
  })
}
