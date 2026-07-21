import { readFileSync } from 'node:fs'
import { registerHooks, stripTypeScriptTypes } from 'node:module'
import { fileURLToPath } from 'node:url'
import { sep } from 'node:path'

const IS_LOCATED_IN_NODE_MODULES = import.meta.dirname.includes(`${sep}node_modules${sep}`)

const getTsFilename = (url) => {
  if (url.startsWith('file:')) {
    const filename = fileURLToPath(url)

    if (filename.startsWith(import.meta.dirname) && filename.endsWith('.ts')) {
      return filename
    }
  }

  return null
}

if (IS_LOCATED_IN_NODE_MODULES) {
  registerHooks({
    load(url, context, nextLoad) {
      const filename = getTsFilename(url)

      if (filename != null) {
        return {
          format: 'module',
          source: stripTypeScriptTypes(readFileSync(filename, 'utf8'), { sourceUrl: url }),
          shortCircuit: true,
        }
      }

      return nextLoad(url, context)
    },
  })
}
