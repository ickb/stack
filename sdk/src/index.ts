/**
 * Public SDK for one iCKB conversion workflow: read the sampled state, quote, build and
 * complete a conversion, sign, send, and wait.
 *
 * @remarks Every name is exported twice, as CCC does with `ccc`: flat, and as the `ickb`
 * namespace, so `import { ickb } from "@ickb/sdk"` reaches the whole surface.
 *
 * @packageDocumentation
 */

export * from "./barrel.ts";
export * as ickb from "./barrel.ts";
