import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { generateFiles, syncGeneratedFiles } from '../src/core/index.ts'

const binding = {
  headers: [
    { outputBase: 'video', functions: [{ moonbit: 'create_window' }] },
    { outputBase: 'rect', functions: [{ moonbit: 'get_rect' }] },
  ],
}

test('emitters consume the stable per-header plan', () => {
  const files = generateFiles(binding, [
    {
      name: 'names',
      emitHeader(header) {
        return [
          {
            path: `${header.outputBase}_gen.txt`,
            content: `${header.functions.map((fn) => fn.moonbit).join('\n')}\n`,
          },
        ]
      },
    },
  ])

  assert.deepEqual([...files.keys()], ['video_gen.txt', 'rect_gen.txt'])
  assert.equal(files.get('video_gen.txt'), 'create_window\n')
})

test('generated files use manifest-based stale cleanup', () => {
  const outputDir = mkdtempSync(join(tmpdir(), 'binding-codegen-'))
  try {
    const initial = new Map([
      ['video_gen.txt', 'first\n'],
      ['stale_gen.txt', 'stale\n'],
    ])
    assert.equal(syncGeneratedFiles({ outputDir, files: initial }).clean, false)
    assert.equal(syncGeneratedFiles({ outputDir, files: initial }).clean, true)

    writeFileSync(join(outputDir, 'video_gen.txt'), 'changed by hand\n')
    const next = new Map([['video_gen.txt', 'second\n']])
    assert.deepEqual(syncGeneratedFiles({ outputDir, files: next }).changed, [
      '.bindgen.json',
      'stale_gen.txt',
      'video_gen.txt',
    ])

    assert.equal(readFileSync(join(outputDir, 'video_gen.txt'), 'utf8'), 'second\n')
    assert.equal(syncGeneratedFiles({ outputDir, files: next }).clean, true)
  } finally {
    rmSync(outputDir, { recursive: true, force: true })
  }
})

test('emitters cannot write outside the output directory', () => {
  assert.throws(
    () =>
      generateFiles(binding, [
        {
          name: 'unsafe',
          emitHeader() {
            return [{ path: '../outside', content: '' }]
          },
        },
      ]),
    /outside the output directory/,
  )
})
