import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import type { GeneratedFile, GeneratedFiles } from './types.ts'

type GeneratorEmitter<B, H> = Readonly<{
  name: string
  emitHeader(header: H, binding: B): readonly GeneratedFile[]
}>

export type SyncGeneratedFilesResult = Readonly<{
  changed: readonly string[]
  clean: boolean
}>

function normalizedFile(file: GeneratedFile, source: string): GeneratedFile {
  if (!file || typeof file.path !== 'string' || typeof file.content !== 'string') {
    throw new Error(`${source} must return { path, content } files`)
  }
  const path = file.path.replaceAll('\\', '/')
  if (isAbsolute(path) || path === '..' || path.startsWith('../')) {
    throw new Error(`${source} returned a path outside the output directory: ${path}`)
  }
  return Object.freeze({ path, content: file.content })
}

export function generateFiles<B extends Readonly<{ headers: readonly unknown[] }>>(
  binding: B,
  emitters: readonly GeneratorEmitter<B, B['headers'][number]>[],
): GeneratedFiles {
  if (!Array.isArray(emitters) || emitters.length === 0) {
    throw new Error('at least one emitter is required')
  }

  const files: GeneratedFiles = new Map()
  for (const header of binding.headers) {
    for (const emitter of emitters) {
      if (!emitter || typeof emitter.emitHeader !== 'function') {
        throw new Error('emitters must define emitHeader(header, binding)')
      }
      const source = emitter.name ?? 'emitter'
      const emitted = emitter.emitHeader(header, binding) ?? []
      if (!Array.isArray(emitted)) {
        throw new Error(`${source}.emitHeader must return an array`)
      }
      for (const candidate of emitted) {
        const file = normalizedFile(candidate, source)
        if (files.has(file.path)) {
          throw new Error(`multiple emitters produced ${file.path}`)
        }
        files.set(file.path, file.content)
      }
    }
  }
  return files
}

function outputPath(outputDir: string, file: string): string {
  const root = resolve(outputDir)
  const path = resolve(root, file)
  const pathFromRoot = relative(root, path)
  if (pathFromRoot === '..' || pathFromRoot.startsWith(`..\\`) || isAbsolute(pathFromRoot)) {
    throw new Error(`generated path escapes output directory: ${file}`)
  }
  return path
}

function readManifest(path: string): string[] {
  if (!existsSync(path)) return []
  const parsed = JSON.parse(readFileSync(path, 'utf8'))
  if (
    !Array.isArray(parsed.files) ||
    parsed.files.some((file: unknown) => typeof file !== 'string')
  ) {
    throw new Error(`invalid generated file manifest: ${path}`)
  }
  return parsed.files as string[]
}

export function syncGeneratedFiles({
  outputDir,
  files,
  manifest = '.bindgen.json',
}: Readonly<{
  outputDir: string
  files: GeneratedFiles
  manifest?: string
}>): SyncGeneratedFilesResult {
  if (!(files instanceof Map)) {
    throw new Error('files must be the Map returned by generateFiles')
  }

  const manifestPath = outputPath(outputDir, manifest)
  const expectedNames = [...files.keys()].sort()
  const expectedManifest = `${JSON.stringify({ files: expectedNames }, null, 2)}\n`
  const staleNames = readManifest(manifestPath).filter((file) => !files.has(file))
  const changed: string[] = []

  for (const [file, content] of files) {
    const path = outputPath(outputDir, file)
    if (!existsSync(path) || readFileSync(path, 'utf8') !== content) {
      changed.push(file)
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, content, 'utf8')
    }
  }

  for (const file of staleNames) {
    const path = outputPath(outputDir, file)
    if (!existsSync(path)) continue
    changed.push(file)
    rmSync(path)
  }

  if (!existsSync(manifestPath) || readFileSync(manifestPath, 'utf8') !== expectedManifest) {
    changed.push(manifest)
    mkdirSync(dirname(manifestPath), { recursive: true })
    writeFileSync(manifestPath, expectedManifest, 'utf8')
  }

  return Object.freeze({
    changed: Object.freeze([...new Set(changed)].sort()),
    clean: changed.length === 0,
  })
}
