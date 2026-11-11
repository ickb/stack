/**
 * Public SDK for one iCKB conversion workflow: read the sampled state, quote, build and
 * complete a conversion, sign, send, and wait.
 *
 * @remarks Every name is reached through the one `ickb` namespace,
 * `import { ickb } from "@ickb/sdk"`, so a call site always says which library it uses.
 *
 * @packageDocumentation
 */

export * as ickb from "./barrel.ts";
