# Design History

> Status: Historical rationale. These documents explain how the rewrite reached its current shape; they do not override the current decision record.

The design developed through five passes:

1. [Repository review](repository-review.md): correctness findings, test blind spots, and the largest sources of repository complexity.
2. [Rewrite design](rewrite-design.md): the first consumer-oriented SDK and runtime proposal.
3. [Maintainer decisions](maintainer-decisions.md): initial decisions on API shape, packaging, type safety, runtime, testing, and tooling.
4. [Simplification review](simplification-review.md): a second pass focused on removing operational, validation, package, interface, and tooling overhead.
5. [Selected architecture](selected-architecture.md): the final historical synthesis before the current decision record.

Some conclusions changed between passes. Each document states its own evidence boundary, and the [current decision record](../decisions.md) wins where they differ.
