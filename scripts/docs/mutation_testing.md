# Mutation Testing

`pnpm mutate` runs [StrykerJS](https://stryker-mutator.io/) over the source of the four workspaces, as [`stryker.config.json`](../../stryker.config.json) sets it up. It makes one small edit to the code at a time, then reports every edit no test notices. Full coverage only proves the code ran: a guard could still go without a test failing.

The `break` threshold of 100 fails a run on any mutant that survives or that no test covers.

## Full run

A full run takes far longer than the gate, so it runs outside `pnpm check`, when [the gate](../../AGENTS.md#the-gate) says. `--mutate <globs>` narrows it.

`--incremental` retests only what changed. After an edit to the tests alone it can keep a stale survivor, such as a module-level constant the new test now pins. Final numbers come from a run without it or with `--force`.

## Diff-scoped run

`pnpm mutate:changed [base]` ([`mutate-changed.ts`](../tooling/mutate-changed.ts)) mutates only the lines added since `base`. The default base is where the branch left `origin/master`.

- Whitespace-only changes count as unchanged, so a reformat or reindent doesn't demand tests for logic it didn't touch.
- It keeps the changed files the `mutate` globs of the config select, exclusions included, since a `--mutate` list replaces those globs. Each added hunk goes to Stryker as a line range.
- With nothing left it exits 0 without starting Stryker. Otherwise it runs without `--incremental`.

Run it locally before opening or updating a pull request. CI runs it on every pull request against the base tip, as a step of the required `build` job.

A local rule alone was tried first: [pull request #67](https://github.com/ickb/stack/pull/67) was updated without the run, so its six survivors surfaced only before the merge. The cost of the run follows the diff: all of #67 took about 3 minutes on the CI runner (2026-11-01). A large pull request pays a slower required check, capped at 30 minutes.

The full `pnpm mutate` isn't a CI step (owner decision, 2026-11-11). Its cost doesn't follow the diff, so every push of every pull request would pay it. The accepted tradeoff: a merge can land without it, as #67 was once updated without the diff-scoped run.

## Accepted gaps of the diff-scoped run

- A pull request that changes only tests mutates nothing, though its tests may have stopped killing mutants of unchanged code. A full run catches that.
- A deleted line produces no mutant, so the run says nothing about code whose guard was removed.
- Stryker makes a mutant only for code lying wholly inside one range. A condition or block that also spans an unchanged line isn't mutated, even where it joins an added guard to existing code.
- The [sandbox gap](#the-sandbox) applies to it as to a full run.

## Survivors

A surviving mutant earns the smallest test that kills it, or the deletion of the code it proves dead.

An equivalent mutant, one no input can tell apart from the original, is marked where it occurs with `// Stryker disable next-line <Mutator>: <reason>`. Stryker reads the comment only when it leads the node that starts on the line of the mutant. So a comment placed before `} catch` or `} else if` is ignored: put it inside the condition, or restructure.

The TypeScript checker was tried and left out. On a sample it found the same survivors. It only relabeled as compile errors mutants the tests already killed, while making the run slower.

## The sandbox

The config names the vitest runner plugin. Stryker looks for plugins beside its own package, where the isolated layout of pnpm puts none.

The bot and generator entrypoints are left out: their tests spawn a process the mutant switch doesn't reach. The sampler test imports its entrypoint, so the sampler is mutated.

In the sandbox the workspace package links still lead to the checkout. A test importing `@ickb/sdk` or `@ickb/testkit` runs the unmutated package. So an SDK mutant meets only the tests that import the SDK by path (its own and those of the Node actors). A test kit mutant meets only its own tests. Such a survivor may still be caught elsewhere.
