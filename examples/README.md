# mailgold examples

Two inputs that exercise the whole pipeline. Run everything from the
repository root after `npm install && npm run build`.

## `welcome.eml` — a well-built transactional message

A real multipart/alternative message: quoted-printable HTML and text
parts, a base64 subject, per-send `token`/`sig`/`uid` values in every
link. Record it, then check it — the check passes even though the
tokens would differ on the next send, because volatile query values are
scrubbed to `*` at normalization time:

```bash
node dist/cli.js record examples/welcome.eml
node dist/cli.js check
```

Its HTML part also passes lint with zero findings — it is written the
way Outlook wants: table layout, `role="presentation"`, sized images,
an `[if mso]` conditional wrapper and a bulletproof button:

```bash
node dist/cli.js lint examples/welcome.eml
```

## `newsletter.html` — a template that breaks in Outlook

A bare HTML part written like a web page: flexbox, `max-width`,
`border-radius`, a CSS background image, a `<button>`, a linked
stylesheet, `position: absolute` and an unsized image. Lint flags each
one with the affected client family:

```bash
node dist/cli.js lint examples/newsletter.html
node dist/cli.js lint examples/newsletter.html --client outlook
node dist/cli.js lint examples/newsletter.html --json
```

Print the canonical snapshot form (what actually gets stored):

```bash
node dist/cli.js normalize examples/newsletter.html
node dist/cli.js normalize examples/welcome.eml --part text
```
