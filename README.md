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
  configure field accessors and explicit scalar setters.
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

Selected value structs expose their fields with snake_case getters. Registered
struct/union fields return views into the same backing buffer:

```ts
valueStructs: {
  example_event_t: {
    accessors: { type: 'event_type' },
    setters: { type: 'set_event_type' },
  },
  example_payload_t: { setters: true },
}
```

This supports `event.payload().code()` and
`event.payload().set_code(42)`. A view retains its backing bytes and carries its
native offset; offsets and sizes come from the C compiler. Native functions
receive the viewed address, including when they write to it. Reusing the backing
buffer changes existing views. `copy()` makes an independent copy of the struct
bytes; native pointers in those bytes are still shallow copies. `as_bytes()`
returns a `BytesView` of exactly the structure's bytes without copying, including
for nested views. The byte view retains the backing buffer and reflects subsequent
writes. Use `copy().as_bytes()` when an independent snapshot is needed.

Each struct emits a constructor and one layout function. The layout contains the
native size and each selected field's offset, size and integer signedness.
MoonBit loads it once at package initialization, along with the native byte order.
Numeric getters read the buffer in MoonBit using bitstring patterns, without a C
call or an intermediate byte copy. One generic `read_integer[T]` handles all
integer widths and byte orders. Its private `NativeWord` trait has two
constructors, from `Int32` and `UInt32`; implementations are emitted only for
integer result types used by the package. The getter's return type determines
`T`, without an intermediate `UInt64`. Signed patterns handle sign extension;
unsigned patterns handle zero extension. 64-bit fields combine two 32-bit words.
Small adapters handle `Byte`, `Bool`, `Float` and `Double`; floating-point readers
reinterpret the corresponding 32/64 bits. The C compiler determines enum widths
and signedness. Numeric conversions remain for explicit `typeOverrides` whose
API type differs from native storage.

Numeric setters encode the value in MoonBit and use one shared C bit writer.
Its `UInt64` parameter is a bit container at the FFI boundary; the writer copies
only the native field width. Pointer and C-string reads, explicit
`copy()` and aggregate assignment also use a fixed set of shared helpers in
`value_gen.mbt` / `value_stub_gen.c`. Adding a typedef or enum does not create a
new C helper. C-string getters copy the string into owned MoonBit bytes while
retaining the source buffer for the entire call. Scalar `volatile` fields and
custom scalar mappings outside the supported numeric types retain native field
accessors. Aggregate assignment uses `memmove` to support overlapping views.
Bit-fields remain unsupported.

Add `value_stub_gen.c` to the package's `native-stub` list. Custom emitter
configurations should include `createValueHelperEmitter()`;
`createBindingEmitters()` already includes it.

Ordinary struct constructors accept fields and copy nested structs into their
own buffer. Unions have zero-initializing constructors; only their scalar and
registered aggregate members get automatic getters. Arrays are not exposed.
Use `init: "zero"` for output structs that should be initialized by native code,
including structs containing borrowed strings. Const aggregate views are
currently rejected; scalar const fields remain readable.

Setters remain opt-in: `setters: true` emits setters for writable scalar and
registered aggregate fields. Aggregate assignment copies the bytes, including
overlapping views. Pointer setters require a separate ownership policy and are
not generated. Getter renames and explicit field-path accessors/setters are also
supported:

```ts
valueStructs: {
  example_event_t: {
    accessors: { 'user.code': 'user_code' },
    setters: { 'user.code': 'set_user_code' },
  },
}
```

This emits a `set_user_code(value)` method that calls a borrowed shared C helper.
Field types come from the headers; sizes and offsets remain the
C compiler's responsibility. Setters support writable scalar fields and registered
value structs; pointers, arrays, and `const` fields are rejected. Callers must
select the appropriate union case before assigning its payload.

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
