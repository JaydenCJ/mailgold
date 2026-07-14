# Contributing to mailgold

Issues, discussions and pull requests are all welcome — this project
aims to stay small, zero-dependency at runtime, and honest about what
mail clients actually do.

## Getting started

Requirements: Node.js >= 22.13 (for the stable `node:test` runner used by the suite).

```bash
git clone https://github.com/JaydenCJ/mailgold.git
cd mailgold
npm install            # installs typescript, the only devDependency
npm run build          # compile TypeScript to dist/
npm test               # build + 93 node:test tests
bash scripts/smoke.sh  # end-to-end CLI check against examples/
```

`scripts/smoke.sh` exercises the real CLI (record/check/update on the
bundled `.eml`, volatile-token stability, lint gating and exit codes,
`--json` reports, normalize, list/rm/rules) and must print `SMOKE OK`.

## Before you open a pull request

1. `npx tsc -p tsconfig.json --noEmit` — the tree must type-check clean (strict mode is enforced).
2. `npm test` — all tests must pass.
3. `bash scripts/smoke.sh` — must print `SMOKE OK`.
4. Add tests for behavior changes; keep logic in pure, unit-testable
   modules (the engine takes strings, not file handles — only `cli.ts`
   and the snapshot store touch the filesystem).
5. Changes to the normalizer are compatibility-relevant: anything that
   alters canonical output invalidates every user's stored snapshots,
   so explain the migration story in the PR.

## Ground rules

- **No runtime dependencies.** The zero-dependency install is a core
  feature; adding one needs justification in the PR and will usually be
  declined.
- No network calls, ever — mailgold reads and writes local files only.
- Determinism is API: same input, same options, byte-identical output —
  no clocks, no randomness, no locale-dependent comparisons.
- New lint rules must cite a documented, long-stable client limitation
  and anchor on a concrete construct — heuristic rules generate noise
  that trains people to ignore the gate.
- Severity discipline: `error` = visibly breaks or is stripped in an
  affected client; `warn` = silently degrades. Do not inflate.
- Code comments and doc comments are written in English.

## Reporting bugs

Please include: `mailgold --version` output, the exact command line,
and a minimal `.html` or `.eml` input that reproduces the problem —
strip real recipient data first; the built-in scrubbing patterns are a
good checklist for what to remove.

## Security

Do not open public issues for security problems (e.g. a crafted MIME
input that hangs the parser); use GitHub private vulnerability
reporting on this repository instead.
