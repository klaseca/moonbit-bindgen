# MoonBit binding code generator

`moonbit-bindgen` is a toolkit for generating MoonBit bindings. Its core is
independent of the source and target binding languages: it combines generated
files, checks their paths, writes changed files, and removes stale generated
files recorded in its manifest.

The package currently includes a C binding implementation under
`moonbit-bindgen/c`. It receives structured C declarations, applies binding and
lifetime policies, and emits MoonBit declarations and C stubs. Support for
another binding language can be added without making it part of the C pipeline.

## Configuration

A binding project owns its generator entry point and configuration. The shared
package contains reusable machinery, not SDL-, Skia-, or another
library-specific adapter.

The configuration describes the input headers, generated output, selected
functions, and policies that cannot be inferred reliably from C declarations:

```json
{
  "projectRoot": "..",
  "includeDir": "externals/include",
  "outputDir": "modules/example-sys/src",
  "headers": ["example.h"],
  "functionMode": "explicit",
  "unsupportedPolicy": "error",
  "functions": [
    "example_create",
    {
      "name": "example_get_default",
      "return": { "lifetime": "unmanaged" }
    }
  ],
  "resources": {
    "example_t": {
      "release": "example_destroy",
      "defaultLifetime": "owned"
    }
  },
  "valueStructs": {
    "example_point_t": {}
  }
}
```

The main options are:

- `projectRoot`, `includeDir`, and `outputDir` locate the C headers and generated
  files. Relative paths are resolved from the adapter's `baseDir`.
- `headers` selects headers that produce output. `typeHeaders` adds headers used
  only to resolve referenced declarations.
- `functions` selects functions and defines per-parameter or return policies.
- `functionMode: "explicit"` generates only configured functions;
  `functionMode: "discover"` attempts every parsed function.
- `unsupportedPolicy: "error"` makes unsupported declarations fail generation;
  `unsupportedPolicy: "report"` records them as diagnostics.
- `resources` describes opaque native resources, their release/retain functions,
  and ordinary return lifetime.
- `valueStructs` selects C structs represented as MoonBit value wrappers and may
  configure field accessors.
- `renames` applies explicit function or type names after ordinary prefix
  removal.
- `typeOverrides` is the escape hatch for a library- or target-specific scalar
  that the declaration source cannot represent correctly.
- `constantPrefixes` selects constants when the declaration source supports
  them.

A resource `defaultLifetime` can be `owned`, `retained`, or `unmanaged`. A
particular function may override it with `return.lifetime`. A dependent view is
written as `{ "kind": "dependent", "ownerArg": 0 }`, where `ownerArg` is the
zero-based C parameter index. The generated wrapper keeps that owner alive.
`return.ownership` is separate and applies to copied C strings.

Fundamental C scalar types are handled by the C lowering implementation. A
declaration source should emit aliases for typedefs; aliases are resolved
recursively before `typeOverrides` is considered.

### JSON configuration

JSON can be imported directly by the generator entry point:

```js
import config from './example.config.json' with { type: 'json' }
```

No configuration-loading CLI or file path is required by the shared package.

### TypeScript configuration

For editor completion and compile-time validation, use `defineConfig`:

```ts
import { defineConfig } from 'moonbit-bindgen/c'

export default defineConfig({
  projectRoot: '..',
  includeDir: 'externals/include',
  outputDir: 'modules/example-sys/src',
  headers: ['example.h'],
  functionMode: 'explicit',
  unsupportedPolicy: 'error',
  functions: ['example_create'],
  resources: {
    example_t: {
      release: 'example_destroy',
      defaultLifetime: 'owned',
    },
  },
})
```

`defineConfig` is an identity function: it preserves the object unchanged at
runtime while checking its C generator configuration type. Binding identity and
parser-specific rules remain in the adapter rather than in this configuration.

## Generating C bindings

Run a TypeScript generator entry point with the package's Node registration
module:

```sh
node --import moonbit-bindgen/register ./bindgen_example.ts
```

The registration module enables Node to load the erasable TypeScript sources
shipped by `moonbit-bindgen`.

The project adapter connects a declaration source, project configuration, and
standard emitters:

```js
import { basename } from 'node:path'

import { generateFiles, syncGeneratedFiles } from 'moonbit-bindgen'
import {
  createBindingEmitters,
  createSourceCRegex,
  formatGenerationSummary,
  loadBindingC,
  lowerBindings,
} from 'moonbit-bindgen/c'

import config from './example.config.json' with { type: 'json' }

const source = createSourceCRegex({
  headerOutputBase: (file) => basename(file, '.h').toLowerCase(),
  prepareType: (type) => type.replace(/\bEXAMPLE_API\b/g, ''),
  functionPattern: /EXAMPLE_API\s+(.*?)\s+(example_\w+)\((.*?)\);/g,
})

const {
  api,
  config: normalizedConfig,
  outputDir,
} = loadBindingC({
  bindingName: 'example',
  config,
  source,
  baseDir: import.meta.dirname,
  namePrefixes: ['example_'],
})

const binding = lowerBindings(api, normalizedConfig)
const files = generateFiles(binding, createBindingEmitters())
const result = syncGeneratedFiles({ outputDir, files })

console.log(formatGenerationSummary(binding, files))
if (result.changed.length > 0) {
  console.log(`updated: ${result.changed.join(', ')}`)
}
```

The regular-expression parser is a replaceable declaration source. Naming and
macro cleanup in this example are library-specific and therefore belong to the
binding project rather than `moonbit-bindgen`.

`headerInclude` may override the complete C include operand:

```ts
headerInclude: (file) => `<library/${file}>`
```

Without it, the source emits a quoted path relative to the generated C file.

The standard emitters generate per-header `*_gen.mbt` declarations and matching
`*_stub_gen.c` files. They also add shared C-string and pointer helpers when the
lowered API needs them; these helpers are ABI dependencies, not configuration
options. Resource helpers are placed with the configured native release
function.

`syncGeneratedFiles` writes changed files and removes only stale files listed in
its generated-file manifest. Diagnostics report unsupported declarations
separately from textual output changes.

## Custom declaration sources

Use a custom source when regular expressions are no longer sufficient. A
source may invoke Clang, read a JSON API description, extract macros, or return
hand-written declarations. It implements the `ApiSource` contract and returns
structured headers and declarations from `load(context)`:

```ts
import { createApiSource } from 'moonbit-bindgen/c'

const source = createApiSource({
  name: 'clang',
  load(context) {
    return readClangDeclarations(context.includeDir)
  },
})
```

Supported declaration kinds are `opaque-type`, `value-struct`, `alias`,
`constant`, and `function`. `loadBindingC` treats all sources identically, so
changing the parser does not change binding policies or emitters.

`loadApiSources` is available for advanced sources that combine several API
fragments. It merges declarations per header and rejects conflicts. Most
project adapters only need to pass one source to `loadBindingC`.

## Custom emitters

Custom emitters can be passed to `generateFiles` alongside or instead of the
standard C binding emitters. An emitter implements
`emitHeader(header, binding)` and returns `{ path, content }` files.
`generateFiles` combines their output and rejects duplicate paths or paths that
escape the output directory.
