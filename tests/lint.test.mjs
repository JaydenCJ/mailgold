// The client-quirk rules: each rule fires on the construct it names,
// with the right severity, client list and source line — and stays
// quiet on markup that renders fine.
import test from "node:test";
import assert from "node:assert/strict";

import { lintHtml } from "../dist/lint.js";
import { RULES, GMAIL_CLIP_BYTES } from "../dist/rules.js";
import { parseEml } from "../dist/mime.js";
import { makeEml } from "./helpers.mjs";

const ids = (findings) => findings.map((f) => f.rule);

test("a bulletproof table layout lints completely clean", () => {
  const html = `<!DOCTYPE html><html><body style="margin:0; padding:0;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0">
<tr><td style="padding:16px; color:#333333;">
<img src="https://cdn.example.test/logo.png" width="120" height="40" alt="Logo">
<a href="https://example.test/go">Go</a>
</td></tr></table></body></html>`;
  assert.deepEqual(lintHtml(html), []);
});

test("display:flex and grid are errors attributed to Outlook", () => {
  const findings = lintHtml('<div style="display:flex">x</div><div style="display: grid">y</div>');
  const flex = findings.filter((f) => f.rule === "no-css-flexbox");
  assert.equal(flex.length, 2);
  assert.equal(flex[0].severity, "error");
  assert.ok(flex[0].clients.includes("outlook"));
});

test("declarations inside <style> blocks are linted with selector context", () => {
  const findings = lintHtml("<style>\n.hero {\n  position: absolute;\n}\n</style>");
  const hit = findings.find((f) => f.rule === "no-css-position");
  assert.ok(hit);
  assert.equal(hit.line, 2); // the .hero rule starts on line 2
  assert.ok(hit.message.includes(".hero"));
});

test("images: missing dimensions is an error, missing alt a warning", () => {
  const findings = lintHtml('<img src="https://cdn.example.test/x.png">');
  const dims = findings.find((f) => f.rule === "img-missing-dimensions");
  const alt = findings.find((f) => f.rule === "img-missing-alt");
  assert.equal(dims.severity, "error");
  assert.equal(alt.severity, "warn");
  // Partially sized images name the missing attribute.
  const partial = lintHtml('<img src="x.png" width="100" alt="x">');
  assert.match(partial.find((f) => f.rule === "img-missing-dimensions").message, /height/);
});

test("button, form controls, script and js: URLs are hard errors", () => {
  const findings = lintHtml("<form><input type=text><button>Go</button></form><script>1</script>");
  for (const rule of ["no-button", "no-form-elements", "no-script"]) {
    assert.ok(ids(findings).includes(rule), `missing ${rule}`);
  }
  assert.ok(findings.every((f) => ["no-button", "no-form-elements", "no-script"].includes(f.rule)
    ? f.severity === "error" : true));
  assert.ok(ids(lintHtml('<a href="javascript:void(0)">x</a>')).includes("no-javascript-url"));
  assert.equal(lintHtml('<a href="https://example.test">x</a>')
    .filter((f) => f.rule === "no-javascript-url").length, 0);
});

test("external CSS via <link> and @import are both flagged", () => {
  const findings = lintHtml(
    '<link rel="stylesheet" href="https://cdn.example.test/a.css">' +
    '<style>@import url("https://cdn.example.test/b.css");</style>');
  assert.ok(ids(findings).includes("no-external-stylesheet"));
  assert.ok(ids(findings).includes("no-external-stylesheet-import"));
  // A canonical <link> (e.g. rel="icon") is not a stylesheet problem.
  const ok = lintHtml('<link rel="icon" href="https://example.test/i.png">');
  assert.ok(!ids(ok).includes("no-external-stylesheet"));
});

test("margin: 0 reset is fine; spacing margins warn for Outlook.com", () => {
  assert.ok(!ids(lintHtml('<p style="margin:0">x</p>')).includes("outlook-com-margin"));
  const findings = lintHtml('<p style="margin:0 0 16px 0">x</p>');
  const hit = findings.find((f) => f.rule === "outlook-com-margin");
  assert.equal(hit.severity, "warn");
  assert.deepEqual(hit.clients, ["outlook-web"]);
});

test("style in body warns for Gmail, style in head does not", () => {
  const bad = lintHtml("<html><body><style>a{color:red}</style></body></html>");
  assert.ok(ids(bad).includes("style-in-body"));
  const good = lintHtml("<html><head><style>a{color:red}</style></head><body>x</body></html>");
  assert.ok(!ids(good).includes("style-in-body"));
});

test("shorthand hex colors are caught in CSS and bgcolor attributes", () => {
  const findings = lintHtml('<td bgcolor="#fff" style="color:#a1b">x</td>');
  assert.equal(findings.filter((f) => f.rule === "shorthand-hex-color").length, 2);
  const ok = lintHtml('<td bgcolor="#ffffff" style="color:#a1b2c3">x</td>');
  assert.equal(ok.filter((f) => f.rule === "shorthand-hex-color").length, 0);
});

test("gmail-size-clip fires only past the 102 KB threshold", () => {
  const small = lintHtml("<p>tiny</p>");
  assert.ok(!ids(small).includes("gmail-size-clip"));
  const big = "<p>" + "x".repeat(GMAIL_CLIP_BYTES) + "</p>";
  assert.ok(ids(lintHtml(big)).includes("gmail-size-clip"));
});

test("missing-text-part fires only when linting a message context", () => {
  const htmlOnly = parseEml(makeEml({ html: "<p>x</p>", text: null }));
  const withText = parseEml(makeEml({ html: "<p>x</p>", text: "x" }));
  assert.ok(ids(lintHtml(htmlOnly.html, { message: htmlOnly })).includes("missing-text-part"));
  assert.ok(!ids(lintHtml(withText.html, { message: withText })).includes("missing-text-part"));
  assert.ok(!ids(lintHtml("<p>x</p>")).includes("missing-text-part"));
});

test("disable skips a rule; client filter narrows the catalog", () => {
  const html = '<div style="display:flex">x</div><style>a{color:red}</style>';
  const disabled = lintHtml(html, { disable: ["no-css-flexbox"] });
  assert.ok(!ids(disabled).includes("no-css-flexbox"));
  // Filtering to gmail keeps "all"-client rules but drops outlook-only ones.
  const gmailOnly = lintHtml('<div style="display:flex; max-width:600px">x</div>',
    { clients: ["gmail"] });
  assert.ok(!ids(gmailOnly).includes("no-css-flexbox"));
  assert.ok(!ids(gmailOnly).includes("no-max-width"));
  // Findings come back sorted by line for stable, readable reports.
  const findings = lintHtml('<button>a</button>\n<div style="display:flex">b</div>');
  const lines = findings.map((f) => f.line);
  assert.deepEqual(lines, [...lines].sort((a, b) => a - b));
});

test("every rule has a unique id, severity, clients and summary", () => {
  const seen = new Set();
  for (const rule of RULES) {
    assert.ok(!seen.has(rule.id), `duplicate rule id ${rule.id}`);
    seen.add(rule.id);
    assert.ok(["error", "warn"].includes(rule.severity));
    assert.ok(rule.clients.length > 0);
    assert.ok(rule.summary.length > 10);
  }
  assert.ok(RULES.length >= 20, `expected a real catalog, got ${RULES.length}`);
});
