# Lint Rules

Most checks come from established presets. The local rules cover what no preset knows about this code. General style and test shape stay with the presets, not another local metrics framework.

## Custom ESLint rules

Each rule sits beside its reason in [`eslint.config.mts`](../../eslint.config.mts):

- **script identity:** compare whole scripts, never field by field.
- **cell reads:** go through the one uncached paging loop of the SDK, never the cached iterators or paged scans of CCC.
- **untyped input:** parse it into a declared type at its boundary.
- **type assertions:** each one needs a local disable with its reason.
- **`@__PURE__` in a class static block:** banned. The bundler deletes the annotated call there while keeping the class, which drops the codec initialization.
- **mock seams:** production code bans dependency bags, optional `typeof` slots and parameters defaulting to a real implementation. They exist only for a test double.
- **error classes:** production code bans `Error` subclasses. An expected outcome returns as a value, a defect throws a plain `Error` ([error model](../../AGENTS.md#correctness-and-change)).
- **`Promise.withResolvers`:** production code bans it, since bundlers still target Safari 16.4 to 17.3, which lack it, and a send that then throws leaves its hash pending. The SDK build also checks its source against the ES2023 library.

A mistyped selector matches nothing, so it reports nothing. [`lint-rules.ts`](../test/lint-rules.ts) catches that: for each rule it lints a snippet the rule must leave alone. It also lints one the rule must report once, for each branch of its selector and each cell-read method it bans.

## Boundaries

[`dependency-cruiser`](../../.dependency-cruiser.jsonc) enforces the browser / Node boundaries. It also keeps the contract oracle independent of the implementation it judges. That one import rule doesn't need a separate ESLint plugin or a graph repeating every SDK directory.

## Dead members

knip sees exports, not class members. [`dead-members.ts`](../tooling/dead-members.ts) fills that gap: `pnpm lint:knip` runs it. A reference from a test doesn't keep a production member alive. A TypeScript program supplies the references, without the heavier language-service machinery.
