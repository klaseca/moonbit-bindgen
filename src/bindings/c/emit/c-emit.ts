import type { Emitter, EmitterOptions } from '../c-types.ts'
import { createMoonBitEmitter } from './c-moonbit.ts'
import { createPointerHelperEmitter } from './c-pointer.ts'
import { createCStringHelperEmitter } from './c-string.ts'
import { createCStubEmitter } from './c-stub.ts'

export function createBindingEmitters(
  options: Readonly<{ moonbit?: EmitterOptions; cStub?: EmitterOptions }> = {},
): Emitter[] {
  return [
    createMoonBitEmitter(options.moonbit),
    createCStubEmitter(options.cStub),
    createCStringHelperEmitter(),
    createPointerHelperEmitter(),
  ]
}
