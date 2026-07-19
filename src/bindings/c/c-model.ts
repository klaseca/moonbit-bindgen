import { isCType } from './c-type.ts'
import type {
  ApiDeclaration,
  ApiDeclarationInput,
  ApiHeader,
  ApiModel,
  ApiModelInput,
} from './c-types.ts'

const declarationKinds = new Set(['alias', 'constant', 'function', 'opaque-type', 'value-struct'])

function validateDeclaration(declaration: ApiDeclarationInput, header: string): void {
  if (!declaration || !declarationKinds.has(declaration.kind)) {
    throw new Error(`${header}: unsupported declaration kind ${declaration?.kind}`)
  }
  if (typeof declaration.cName !== 'string' || declaration.cName.length === 0) {
    throw new Error(`${header}: declaration is missing cName`)
  }
  if (declaration.kind === 'function') {
    if (!isCType(declaration.returnType)) {
      throw new Error(`${header}:${declaration.cName}: function is missing returnType`)
    }
    if (!Array.isArray(declaration.params)) {
      throw new Error(`${header}:${declaration.cName}: function is missing params`)
    }
    for (const param of declaration.params) {
      if (typeof param.name !== 'string' || !isCType(param.type)) {
        throw new Error(`${header}:${declaration.cName}: function has an invalid parameter`)
      }
    }
  }
  if (declaration.kind === 'value-struct') {
    if (!Array.isArray(declaration.fields)) {
      throw new Error(`${header}:${declaration.cName}: value struct is missing fields`)
    }
    for (const field of declaration.fields) {
      if (typeof field.name !== 'string' || !isCType(field.type)) {
        throw new Error(`${header}:${declaration.cName}: value struct has an invalid field`)
      }
    }
  }
  if (
    declaration.kind === 'alias' &&
    !isCType(declaration.type) &&
    typeof declaration.moonbit !== 'string'
  ) {
    throw new Error(`${header}:${declaration.cName}: alias is missing type`)
  }
}

function declarationSignature(declaration: ApiDeclaration | ApiDeclarationInput): string {
  const { source: _source, ...withoutSource } = declaration
  if ('header' in withoutSource) {
    const { header: _header, ...value } = withoutSource
    return JSON.stringify(value)
  }
  return JSON.stringify(withoutSource)
}

export function createApiModel(input: ApiModelInput): ApiModel {
  if (!input || !Array.isArray(input.headers)) {
    throw new Error('API model must contain headers')
  }

  const declarations = new Map<string, ApiDeclaration>()
  const onConflict = input.onConflict ?? 'first'
  if (!new Set(['error', 'first']).has(onConflict)) {
    throw new Error('API model onConflict must be "error" or "first"')
  }
  const headers: ApiHeader[] = input.headers.map((header) => {
    if (typeof header.path !== 'string' || header.path.length === 0) {
      throw new Error('header.path is required')
    }
    if (!Array.isArray(header.declarations)) {
      throw new Error(`${header.path}: declarations must be an array`)
    }
    if (typeof header.outputBase !== 'string' || header.outputBase.length === 0) {
      throw new Error(`${header.path}: header.outputBase is required`)
    }

    const normalizedDeclarations: ApiDeclaration[] = []
    for (const declaration of header.declarations) {
      validateDeclaration(declaration, header.path)
      if (declarations.has(declaration.cName)) {
        const previous = declarations.get(declaration.cName)!
        if (
          onConflict === 'error' &&
          declarationSignature(previous) !== declarationSignature(declaration)
        ) {
          throw new Error(
            `${header.path}:${declaration.cName}: conflicts with declaration from ${previous.header}`,
          )
        }
        continue
      }
      const normalized = Object.freeze({
        ...declaration,
        header: header.path,
      }) as ApiDeclaration
      declarations.set(normalized.cName, normalized)
      normalizedDeclarations.push(normalized)
    }

    return Object.freeze({
      path: header.path,
      include: header.include ?? header.path,
      outputBase: header.outputBase,
      emit: header.emit ?? true,
      declarations: Object.freeze(normalizedDeclarations),
    })
  })

  return Object.freeze({
    headers: Object.freeze(headers),
    declarations,
  })
}
