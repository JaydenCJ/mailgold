// The heart of mailgold: two renders that differ only cosmetically must
// normalize to identical lines, and anything that changes the rendered
// email must change the output.
import test from "node:test";
import assert from "node:assert/strict";

import { normalizeHtml, isConditionalComment } from "../dist/normalize.js";

const norm = (html, options) => normalizeHtml(html, options).join("\n");

test("attribute order, quoting and case never affect the snapshot", () => {
  const a = norm('<TD WIDTH="600" align=center>x</TD>');
  const b = norm("<td align='center' width=600>x</td>");
  assert.equal(a, b);
  // Duplicate attributes keep the first value, like browsers.
  const dup = norm('<td width="600" width="300">x</td>');
  assert.ok(dup.includes('width="600"'));
  assert.ok(!dup.includes("300"));
});

test("inline style declaration order and spacing never affect it", () => {
  const a = norm('<td style="color:red;padding:0 10px">x</td>');
  const b = norm('<td style="padding: 0   10px; COLOR: red;">x</td>');
  assert.equal(a, b);
});

test("insignificant whitespace and entity spelling never affect it", () => {
  const a = norm("<table><tr><td>hi there</td></tr></table>");
  const b = norm("<table>\n  <tr>\n    <td>\n      hi\n      there\n    </td>\n  </tr>\n</table>");
  assert.equal(a, b);
  assert.equal(norm("<p>A&nbsp;B &mdash; C</p>"), norm("<p>A&#160;B &#8212; C</p>"));
});

test("class list order is canonicalized", () => {
  assert.equal(norm('<td class="b a  c">x</td>'), norm('<td class="c a b">x</td>'));
  assert.ok(norm('<td class="b a">x</td>').includes('class="a b"'));
});

test("a real change — new copy, changed attribute — changes the output", () => {
  assert.notEqual(norm("<td>Pay now</td>"), norm("<td>Pay later</td>"));
  assert.notEqual(norm('<td width="600">x</td>'), norm('<td width="640">x</td>'));
});

test("volatile query parameters are scrubbed in href and src", () => {
  const out = norm('<a href="https://x.example.test/v?token=abc&plan=pro">Go</a>' +
    '<img src="https://cdn.example.test/p.png?utm_source=mail">');
  assert.ok(out.includes("token=*"));
  assert.ok(out.includes("plan=pro"));
  assert.ok(out.includes("utm_source=*"));
  // The scrub list is configurable and can be disabled outright.
  const custom = norm('<a href="https://x.example.test/?sid=1&token=2">x</a>',
    { scrubParams: ["sid"] });
  assert.ok(custom.includes("sid=*"));
  assert.ok(custom.includes("token=2"));
  const off = norm('<a href="https://x.example.test/?token=2">x</a>', { scrubParams: [] });
  assert.ok(off.includes("token=2"));
});

test("regular comments are dropped, MSO conditional comments kept", () => {
  const out = norm("<!-- build 4821 --><!--[if mso]><table><tr><td><![endif]--><p>x</p>");
  assert.ok(!out.includes("build 4821"));
  assert.ok(out.includes("[if mso]"));
  assert.ok(isConditionalComment("[if mso]><table><![endif]"));
  assert.ok(!isConditionalComment(" just a note "));
});

test("<style> blocks are canonicalized rule by rule", () => {
  const a = norm("<style>a{color:red;text-decoration:none}</style>");
  const b = norm("<style>\n  a {\n    text-decoration: none;\n    color: red;\n  }\n</style>");
  assert.equal(a, b);
});

test("normalization is idempotent; doctype is case-normalized", () => {
  const once = normalizeHtml('<TABLE width=600><tr><td style="b:2;a:1">A&nbsp;B</td></TABLE>');
  const twice = normalizeHtml(once.join("\n"));
  assert.deepEqual(twice, once);
  const out = normalizeHtml("<!doctype html>\n<html><body>x</body></html>");
  assert.equal(out[0], "<!DOCTYPE html>");
});
