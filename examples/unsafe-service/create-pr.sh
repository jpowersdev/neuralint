#!/usr/bin/env bash
set -euo pipefail

example_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
destination=${1:-$(mktemp -d "${TMPDIR:-/tmp}/neuralint-demo.XXXXXX")}

if [[ -e "$destination/.git" || -n "$(find "$destination" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]]; then
  printf 'destination must be empty: %s\n' "$destination" >&2
  exit 2
fi

mkdir -p "$destination/src"
cp -R "$example_dir/.neuralint" "$destination/.neuralint"
cp "$example_dir/base/src/"*.ts "$destination/src/"

git -C "$destination" init -b main --quiet
git -C "$destination" config user.email demo@neuralint.local
git -C "$destination" config user.name "neuralint Demo"
git -C "$destination" add .
git -C "$destination" commit --quiet -m "safe baseline"
git -C "$destination" switch --quiet -c feature/unsafe-rendering

cp "$example_dir/proposed/src/"*.ts "$destination/src/"
git -C "$destination" add src
git -C "$destination" commit --quiet -m "add flexible templates and auth diagnostics"

printf '%s\n' "$destination"
