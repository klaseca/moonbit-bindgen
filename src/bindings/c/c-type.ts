export type CQualifier = 'const' | 'restrict' | 'volatile'

export type CPointer = Readonly<{
  qualifiers: readonly CQualifier[]
}>

export type CType = Readonly<{
  name: string
  qualifiers: readonly CQualifier[]
  pointers: readonly CPointer[]
}>

function isCQualifier(value: unknown): value is CQualifier {
  return value === 'const' || value === 'restrict' || value === 'volatile'
}

export function isCType(value: unknown): value is CType {
  if (value === null || typeof value !== 'object') return false
  const type = value as Partial<CType>
  return (
    typeof type.name === 'string' &&
    type.name.length > 0 &&
    Array.isArray(type.qualifiers) &&
    type.qualifiers.every(isCQualifier) &&
    Array.isArray(type.pointers) &&
    type.pointers.every(
      (pointer) =>
        pointer !== null &&
        typeof pointer === 'object' &&
        Array.isArray(pointer.qualifiers) &&
        pointer.qualifiers.every(isCQualifier),
    )
  )
}

export function hasCQualifier(type: CType, qualifier: CQualifier): boolean {
  return type.qualifiers.includes(qualifier)
}

export function renderCType(type: CType): string {
  const base = [...type.qualifiers, type.name].join(' ')
  const pointers = type.pointers
    .map((pointer) =>
      pointer.qualifiers.length === 0 ? ' *' : ` * ${pointer.qualifiers.join(' ')}`,
    )
    .join('')
  return `${base}${pointers}`
}
