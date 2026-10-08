# Working in This Repository

## Keep information with its owner

The package READMEs and their focused documents describe behavior and its rationale. A comment at the code explains a surprising branch or constant. Repository-wide boundaries and release behavior live in the root [README](README.md); this file owns contributor procedure.

- Put each material decision at the narrowest owner that covers its consumers. Keep the choice, decisive reason, useful rejected alternatives and accepted tradeoff together. Link from other readers rather than maintaining another account of the same decision.
- Do not require a README entry, a central record and a code comment for every decision. Add the local explanation where someone changing the implementation would otherwise miss it.
- Keep current rules in the tree. Git history preserves superseded plans and experiments; retain a rejected alternative only while it explains a choice that still matters.
- Keep `CLAUDE.md` a relative symlink to this file.

## Correctness and change

The deployed contracts and CKB consensus constrain every implementation choice. The owning documentation states the intended behavior; code and tests are evidence of what is implemented. When they disagree, establish which is wrong: fix an implementation regression rather than documenting it as intended behavior, and update documentation when behavior changes deliberately.

- Reopen a settled decision for a contradiction, infeasibility or previously unweighed risk, not merely because a test passes.
- A finding earns new code for an observed or reproduced failure. Otherwise delete, narrow or leave it. Prefer deletion and inlining to abstractions without an evidenced shared reason to change.
- Follow the [workspace boundaries](README.md#workspace-boundaries) and [dependency policy](README.md#dependencies-and-checks). Do not change a dependency or runtime pin just to make something resolve.

For a material revision:

1. Pin the evidence and identify the behavior being changed.
2. Trace every affected consumer: the bot, generator, app and public SDK surface. For transaction changes, follow build, completion, signing, send, confirmation and the next rebuild.
3. Update the owning explanation with the implementation. Remove superseded rules and repair or delete pointers to them.
4. Run the gate and check its exit code.

## The gate

Run the [whole gate](README.md#dependencies-and-checks), `CI=true pnpm check`, once per commit and check its exit code. A green result on that tree makes the commit publishable.

Keep each commit small and scoped to one concern. Its message explains the concern and what it prevents. Changes share a commit only when they share that reason to change.

## Keys and secrets

- Signing keys live in mode `0600` files outside the checkout, named by the unit. Never read the operator's key files.
- Keys are for signing only. Never pass a key, signer or secret-bearing context to a logger, event, error, test hook, formatter, redaction or masking helper, guard, or command text. Stop at the boundary; masking does not make the transfer safe.
- The tests use a canary from outside the production path. Never copy its value into a command, report or written file.
- If a secret appears in evidence, name only its location. Deployment's host-isolation assumption is documented with the [unit setup](sdk/node/README.md#systemd-deployment).
