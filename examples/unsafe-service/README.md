# Unsafe service example

This fixture constructs a small Git repository with a two-commit, PR-shaped history:

```text
main: safe template rendering and redacted authentication logging
  └─ feature/unsafe-rendering: dynamic JavaScript execution and credential logging
```

Two repository-owned policies under `.neuralint/rules/` target the respective source files.

From the neuralint repository root:

```sh
pnpm build
repo=$(./examples/unsafe-service/create-pr.sh)
direnv exec . node dist/Main.js check --root "$repo" --base main --format json
```

neuralint should issue four Jev requests—one screening and one localization request per changed file—and report `SECURITY001` and `SECURITY002` as candidate violations. Exit code `1` means candidate violations were found.

The setup script uses a fresh directory under `/tmp` by default. Pass an empty destination directory as its first argument if you want to retain the generated repository elsewhere.
