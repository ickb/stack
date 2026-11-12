# Working in This Repository

## Keep information with its owner

The package READMEs and their focused documents describe behavior and its rationale. A comment at the code explains a surprising branch or constant. The root [README](README.md) introduces the project; this file owns contributor procedure.

- Put each material decision at the narrowest owner that covers its consumers. Keep the choice, decisive reason, useful rejected alternatives and accepted tradeoff together. Link from other readers rather than maintaining another account of the same decision.
- Do not require a README entry, a central record and a code comment for every decision. Add the local explanation where someone changing the implementation would otherwise miss it.
- Keep current rules in the tree. Git history preserves superseded plans and experiments; retain a rejected alternative only while it explains a choice that still matters.
- Keep `CLAUDE.md` a relative symlink to this file.

## Correctness and change

The deployed contracts and CKB consensus constrain every implementation choice. The owning documentation states the intended behavior; code and tests are evidence of what is implemented. When they disagree, establish which is wrong: fix an implementation regression rather than documenting it as intended behavior, and update documentation when behavior changes deliberately.

- Reopen a settled decision for a contradiction, infeasibility or previously unweighed risk, not merely because a test passes.
- A finding earns new code for an observed or reproduced failure. Otherwise delete, narrow or leave it. Prefer deletion and inlining to abstractions without an evidenced shared reason to change.
- A fix for a bug a test can observe lands with the fewest tests that fail on its base commit for the bug's own reason, at the lowest layer that fails; its commit message names that failing run.
- Do not change a dependency or runtime pin just to make something resolve: [`pnpm-workspace.yaml`](pnpm-workspace.yaml) holds the dependency policy and its reasons. Inside the checkout run npm as `pnpm exec npm`, since npm 11 refuses a host Node that differs from the pin. The gate doesn't exercise the CCC connector, so a CCC update that moves it needs a live wallet test.
- Treat every node answer as untrusted; [node trust](sdk/docs/node_trust.md) and [signing and broadcast](sdk/docs/signing_and_broadcast.md) list what a lie can still cost. The bot recovers from any error by exiting for systemd to restart it; the [bot loop](sdk/node/docs/loop.md) bounds the stalls it accepts.
- Classify each failure as [Effect's error model](https://effect.website/docs/v3/error-management/two-error-types) does, without its library, so a signature shows every outcome its caller must handle and nothing else. An expected outcome, one a caller anticipates and has its own next step for, returns as a value with `ok: false` and a `reason`. A defect, which no business logic recovers from (a node that cannot answer a read, a node answer that fails verification, misuse), throws. When an expected outcome arrives as an outside call's rejection, catch it at the step whose meaning the code knows and return that step's `reason` with the error as `cause`. A cancellation the caller requested stops the code after it, kept apart from both as Effect keeps interruption: a generator stops on the caller's `break`, a signal throws its reason. After a broadcast, a failed read is reported as `pending` with its cause and retried, since the outcome exists on chain.
- Before writing a helper, use what CCC or the platform already provides when it behaves the same on every input the code passes; keep an own version only with its reason stated at the code.

For a material revision:

1. Pin the evidence and identify the behavior being changed.
2. Trace every affected consumer: the bot, generator, app and public SDK surface. For transaction changes, follow build, completion, signing, send, confirmation and the next rebuild. Compare against the change's base what it touches only indirectly, such as state that outlives a turn, event meanings, timings and defaults: a change made for one reason may have silently changed others.
3. Update the owning explanation with the implementation. Remove superseded rules and repair or delete pointers to them.
4. Run the gate and check its exit code.

## The gate

Run the [whole gate](scripts/README.md#what-the-gate-enforces), `CI=true pnpm check`, and check its exit code. A pull request's head must pass it: a green result on that tree, with the full mutation run below, makes the change mergeable. Gating each commit on its own tree is recommended, so that a revert or `git bisect` lands on a working tree, but not required: a rebase that rewrites many commits needs only its head gated. Pull requests also run `pnpm fresh`, whose result depends on the date, and `pnpm mutate:changed`, which fails on any mutant lying within the added lines that no test kills ([mutation testing](scripts/docs/mutation_testing.md)); run both before opening or updating one. Once the owner says to merge, run the full `pnpm mutate` on the head being merged, as the last check before the merge, and check its exit code ([mutation testing](scripts/docs/mutation_testing.md)).

Keep each commit small and scoped to one concern. Its message explains the concern and what it prevents. Changes share a commit only when they share that reason to change.

Every package keeps the same version. A release sets every workspace package's `version` to the new one in one commit, sized by [Epoch Semantic Versioning](https://antfu.me/posts/epoch-semver): a breaking change to the SDK takes the next major. Merging it to `master` publishes the SDK and deploys [ickb.org](https://ickb.org).

## Running units

The testnet units may run from the working checkout. Before changing a checkout file a unit loads (its code, configuration or dependencies), stop every unit that runs from that checkout, and start them again only when those files are clean at a gated commit; a turn must never run a half-edited tree. Those units follow whatever branch the working checkout is on, while a deployment moves only to a reviewed revision ([deployment](sdk/node/docs/deployment.md#operate)).

## Keys and secrets

- Signing keys live in mode `0600` files outside the checkout, named by the unit. Never read the operator's key files.
- Keys are for signing only. Never pass a key, signer or secret-bearing context to a logger, event, error, test hook, formatter, redaction or masking helper, guard, or command text. Stop at the boundary; masking does not make the transfer safe.
- The tests use a canary from outside the production path. Never copy its value into a command, report or written file.
- If a secret appears in evidence, name only its location. Deployment's host-isolation assumption is documented with the [unit setup](sdk/node/docs/deployment.md#host-isolation).
