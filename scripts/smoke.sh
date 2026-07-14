#!/usr/bin/env bash
# Smoke test for mailgold: exercises the real CLI end to end against the
# bundled examples. No network, idempotent, runs from a clean checkout
# (after `npm install`). This script plus `npm test` is the whole
# verification story — the repository intentionally ships no CI.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
ROOT="$(pwd)"

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

fail() {
  echo "SMOKE FAIL: $1" >&2
  exit 1
}

CLI="node $ROOT/dist/cli.js"
STORE="$WORKDIR/.mailgold"

echo "[1/9] build"
npm run build >/dev/null 2>&1 || fail "npm run build failed"

echo "[2/9] --version matches package.json; --help documents every command"
PKG_VERSION="$(node -p "require('$ROOT/package.json').version")"
CLI_VERSION="$($CLI --version)"
[ "$CLI_VERSION" = "$PKG_VERSION" ] || fail "--version mismatch: $CLI_VERSION != $PKG_VERSION"
HELP="$($CLI --help)"
for word in record check lint normalize list rm rules --update --strict; do
  echo "$HELP" | grep -q -- "$word" || fail "--help missing $word"
done

echo "[3/9] record the example .eml (MIME, quoted-printable, both parts)"
$CLI record examples/welcome.eml --dir "$STORE" | grep -q "recorded welcome" \
  || fail "record did not confirm"
grep -q "mailgold snapshot v1" "$STORE/welcome.snap" || fail "snapshot header missing"
grep -q "token=\*" "$STORE/welcome.snap" || fail "volatile token not scrubbed"
grep -q -- "--- text: " "$STORE/welcome.snap" || fail "text part missing from snapshot"

echo "[4/9] check passes although the per-send token would differ"
sed 's/token=3DAAAAAAAAAAAAAAAA/token=3D0000000000000000/' examples/welcome.eml \
  > "$WORKDIR/welcome.eml"
mkdir -p "$WORKDIR/examples"
cp "$WORKDIR/welcome.eml" "$WORKDIR/examples/welcome.eml"
(cd "$WORKDIR" && $CLI check --dir "$STORE") | grep -q "ok      welcome" \
  || fail "token change should not fail the check"

echo "[5/9] check fails with a unified diff when the copy changes"
sed 's/within 24 hours/within 48 hours/' examples/welcome.eml > "$WORKDIR/examples/welcome.eml"
set +e
CHECK_OUT="$(cd "$WORKDIR" && $CLI check --dir "$STORE" 2>&1)"
CHECK_CODE=$?
set -e
[ "$CHECK_CODE" -eq 1 ] || fail "expected exit 1 on mismatch, got $CHECK_CODE"
echo "$CHECK_OUT" | grep -q "FAIL    welcome" || fail "check did not report FAIL"
echo "$CHECK_OUT" | grep -q -- "-.*24 hours" || fail "diff missing old line"
echo "$CHECK_OUT" | grep -q -- "+.*48 hours" || fail "diff missing new line"

echo "[6/9] check --update re-blesses, then check passes"
(cd "$WORKDIR" && $CLI check --dir "$STORE" --update) | grep -q "updated welcome" \
  || fail "update did not rewrite"
(cd "$WORKDIR" && $CLI check --dir "$STORE") | grep -q "ok      welcome" \
  || fail "post-update check failed"

echo "[7/9] lint: the good template is clean, the bad one gates with exit 1"
$CLI lint examples/welcome.eml | grep -q "0 errors, 0 warnings" \
  || fail "welcome.eml should lint clean"
set +e
LINT_OUT="$($CLI lint examples/newsletter.html 2>&1)"
LINT_CODE=$?
set -e
[ "$LINT_CODE" -eq 1 ] || fail "newsletter.html should exit 1, got $LINT_CODE"
for rule in no-css-flexbox no-button img-missing-dimensions no-external-stylesheet; do
  echo "$LINT_OUT" | grep -q "$rule" || fail "lint missing $rule"
done
JSON_OUT="$($CLI lint examples/newsletter.html --json || true)"
echo "$JSON_OUT" | node -e \
  "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const r=JSON.parse(s);if(r.total.errors<1)process.exit(1)})" \
  || fail "--json report malformed"

echo "[8/9] normalize prints canonical html and the unwrapped text part"
$CLI normalize examples/welcome.eml | grep -q '<!--\[if mso\]>' \
  || fail "conditional comment lost in normalization"
$CLI normalize examples/welcome.eml | grep -q 'uid=\*' || fail "normalize html not scrubbed"
$CLI normalize examples/welcome.eml --part text | grep -q "confirm your email address by opening the link" \
  || fail "text part not unwrapped"

echo "[9/9] list / rm / rules"
$CLI list --dir "$STORE" | grep -q "welcome  eml" || fail "list missing snapshot"
$CLI rules | grep -q "gmail-size-clip" || fail "rules catalog incomplete"
$CLI rm welcome --dir "$STORE" | grep -q "removed welcome" || fail "rm did not confirm"
[ ! -e "$STORE/welcome.snap" ] || fail "snapshot file still present"

echo "SMOKE OK"
