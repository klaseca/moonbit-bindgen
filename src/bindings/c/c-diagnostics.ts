import type { GeneratedFiles } from '../../core/types.ts'
import type { Binding } from './c-types.ts'

export type GenerationReport = Readonly<{
  generated: number
  skipped: number
  files: number | undefined
  functions: Binding['diagnostics']['skipped']
}>

export function generationReport(binding: Binding, files?: GeneratedFiles): GenerationReport {
  const skipped = binding.diagnostics?.skipped ?? []
  return Object.freeze({
    generated: binding.functions.length,
    skipped: skipped.length,
    files: files instanceof Map ? files.size : undefined,
    functions: skipped,
  })
}

export function formatGenerationSummary(binding: Binding, files?: GeneratedFiles): string {
  const report = generationReport(binding, files)
  const fileText = report.files === undefined ? '' : `, ${report.files} files`
  return `${binding.namespace}: generated ${report.generated} functions${fileText}, skipped ${report.skipped}`
}
