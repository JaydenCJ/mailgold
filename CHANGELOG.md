# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-07-13

### Added

- Email-specific HTML normalization: lowercased tags/attributes, sorted
  attributes and class lists, canonicalized inline `style` and `<style>`
  blocks, entity unification (`&#160;` == `&nbsp;`), one-node-per-line
  canonical serialization — regular comments dropped, MSO `[if mso]`
  conditional comments kept verbatim as the Outlook markup they are.
- Volatile-value scrubbing so snapshots survive per-send values: query
  parameters (`utm_*`, `token`, `sig`, `uid`, ... — configurable via
  `--scrub`, disabled via `--keep-query`) rewritten to `name=*` in
  `href`/`src`/`background`/`action` and in text-part URLs; `cid:`
  attachment references collapsed to `cid:*`.
- `.eml` (MIME) input: folded headers, nested multiparts
  (`alternative`/`mixed`/`related`), quoted-printable and base64
  transfer encodings, UTF-8 / Latin-1 charsets, RFC 2047 subjects —
  snapshots capture the HTML part and the text part together.
- Text-part normalization that compares logical lines: wrapped
  paragraphs unwrap, list items / quotes / separators / the `--`
  signature delimiter keep their own lines, so a diff means the words
  changed, not the wrap width.
- Client-quirk lint: 25 rules covering the Outlook Word engine (no
  flexbox/grid/float/position, unsized images, `<button>`, background
  images, `max-width`, `border-radius`, rem/viewport units), Gmail
  (102 KB clipping, `<style>` in body, stripped external CSS), Outlook.com
  margin stripping, `javascript:` URLs, accessibility (`alt`,
  `role="presentation"`), and message-level checks (missing text/plain
  part) — each finding with severity, source line and affected clients.
- Snapshot workflow CLI: `record`, `check` (unified diffs, `--update`),
  `lint` (`--strict`, `--disable`, `--client`, `--json`), `normalize`,
  `list`, `rm`, `rules`; exit codes 0 ok / 1 mismatch or lint errors /
  2 usage or input error.
- Reviewable snapshot format: line-prefixed plain text with a versioned
  header that records the scrub configuration and other record-time
  options (`--text` pairing, `--keep-comments`), so every later check
  re-applies exactly the normalization that produced the body; corrupt
  files fail with positioned parse errors instead of comparing garbage.
- Public programmatic API (`normalizeHtml`, `normalizeTextPart`,
  `lintHtml`, `parseEml`, `buildSnapshot`, `compareSnapshots`,
  `unifiedDiff`, ...) with full type declarations.
- Zero runtime dependencies; fully offline; deterministic output.
- Test suite: 93 node:test tests (unit + CLI integration in fresh temp
  dirs) and an end-to-end `scripts/smoke.sh` against the bundled
  example messages.

[0.1.0]: https://github.com/JaydenCJ/mailgold/releases/tag/v0.1.0
