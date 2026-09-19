# Agent instructions

## Effect

- Follow [`EFFECT.md`](EFFECT.md) for TypeScript and Effect implementation conventions.
- This project uses Effect v4 release candidates. Verify APIs against the exact versions pinned in `package.json`.
- Use `effect/unstable/cli` for the CLI and `@effect/ai-typesafe` through Effect's provider-neutral `DecisionModel`.

## Product invariants

- Rules are repository-authored artifacts under `.neuralint/rules/`.
- Review is read-only: never modify the target repository.
- Compare the merge base of the selected base ref with `HEAD`.
- Findings are candidates, not proofs. Preserve probabilities and inconclusive states in structured output.
- Keep Git, rule loading, diff parsing, decision evaluation, and rendering as separate boundaries.
