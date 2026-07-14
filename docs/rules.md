# Lint rule catalog

Every rule encodes one documented, long-stable rendering limitation of
a major mail client. Severity semantics are strict:

- **error** — the construct visibly breaks, is stripped, or hides
  content in an affected client.
- **warn** — the construct silently degrades (a rounded corner renders
  square) or hurts deliverability/accessibility.

`mailgold lint` exits `1` when any error fires; add `--strict` to gate
on warnings too. Skip individual rules with `--disable id,id` and
narrow the catalog to the clients you care about with
`--client outlook,gmail`. Rules with clients `all` always apply.

Findings carry the source line of the offending element, attribute or
`<style>` rule, and `<style>`-block findings name the selector.

## Errors

| Rule | Clients | Fires on |
| --- | --- | --- |
| `no-script` | all | any `<script>` element — removed by every client |
| `no-form-elements` | outlook, gmail | `<form>`, `<input>`, `<textarea>`, `<select>` |
| `no-button` | outlook | `<button>` — use a padded `<a>` in a table cell |
| `no-external-stylesheet` | gmail, outlook | `<link rel="stylesheet">` — never fetched |
| `no-external-stylesheet-import` | gmail, outlook | `@import` inside `<style>` |
| `no-javascript-url` | all | `href`/`src` starting with `javascript:` |
| `no-css-flexbox` | outlook, windows-mail | `display: flex \| inline-flex \| grid \| inline-grid` |
| `no-css-position` | outlook, gmail | `position: absolute \| fixed \| sticky` |
| `no-css-variables` | outlook, gmail | `var(--x)` values or `--x:` custom properties |
| `no-viewport-units` | outlook | `vw` / `vh` / `vmin` / `vmax` lengths |
| `gmail-size-clip` | gmail | HTML part larger than 102 KB (Gmail clips it) |
| `img-missing-dimensions` | outlook | `<img>` without `width` and/or `height` attributes |

## Warnings

| Rule | Clients | Fires on |
| --- | --- | --- |
| `no-background-image` | outlook | `background-image: url(...)` / `background: ... url(...)` |
| `no-max-width` | outlook | any `max-width` declaration |
| `no-border-radius` | outlook | `border-radius` and its longhands |
| `no-css-float` | outlook | any `float` declaration |
| `outlook-com-margin` | outlook-web | non-zero `margin` values (`margin: 0` resets are fine) |
| `padding-on-div` | outlook | inline `padding` on `<div>` or `<p>` |
| `img-missing-alt` | all | `<img>` without an `alt` attribute |
| `no-srcset` | outlook, gmail | `srcset` on `<img>` / `<source>` |
| `style-in-body` | gmail | `<style>` elements inside `<body>` |
| `shorthand-hex-color` | outlook | 3-digit hex colors in CSS or `bgcolor`/`color` attributes |
| `no-rem-units` | outlook | `rem` lengths |
| `table-missing-presentation-role` | all | `<table>` without a `role` attribute |
| `missing-text-part` | all | `.eml` with a `text/html` part but no `text/plain` |

## Adding a rule

Rules live in `src/rules.ts` as data plus a small `check` function over
a shared context (parsed document, every CSS declaration with source
line and origin, `@import` targets, the parsed message when linting an
`.eml`). A new rule must cite a documented client limitation and anchor
on a concrete construct — see the severity discipline note in
[CONTRIBUTING.md](../CONTRIBUTING.md).
