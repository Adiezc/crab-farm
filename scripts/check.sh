#!/usr/bin/env bash
# Crab Farm's checks, the ones CI runs: the manifest, the tests, the model and renderers kept pure, the promise kept
# (no model calls, no tools for the model, no network, no sound, no toasts), and the generated art up to date.
# Usage: scripts/check.sh   (CLAUDE=/path/to/claude to use another binary)
set -euo pipefail
cd "$(dirname "$0")/.."
CLAUDE="${CLAUDE:-claude}"
failed=0
fail() { echo "check: $*" >&2; failed=1; }

"$CLAUDE" plugin validate --strict .
"$CLAUDE" plugin test .

# hooks/model and hooks/render are pure: time comes in as an argument, and they never touch the engine.
impure=$(grep -rnE 'Date\.now\(|new Date\(\)|Math\.random\(|setTimeout\(|(^|[^A-Za-z0-9_$])\$\.[a-z]' hooks/model hooks/render \
  --include='*.ts' | grep -v '\.test\.ts:' || true)
[ -z "$impure" ] || fail "impure code in hooks/model or hooks/render:"$'\n'"$impure"
runtime=$(grep -rn "from 'claude-code'" hooks/model hooks/render | grep -v 'import type' || true)
[ -z "$runtime" ] || fail "a runtime import from 'claude-code' in hooks/model or hooks/render:"$'\n'"$runtime"

# The promise: nothing that calls a model, gives the model a tool, reaches the network, plays sound or pops a toast.
forbidden=$(grep -rnE '\$\.model\.|\$\.tool\.register|\$\.http\.|\$\.audio\.|\$\.ui\.toast|\$\.ui\.notify' hooks \
  --include='*.ts' --include='*.tsx' | grep -vE '\.test\.tsx?:' || true)
[ -z "$forbidden" ] || fail "a forbidden API in hooks/:"$'\n'"$forbidden"

python3 scripts/build_art.py --check || fail 'the generated art is out of date: run python3 scripts/build_art.py'

[ "$failed" = 0 ] && echo 'check: all good'
exit "$failed"
