// The forgiving HTML parser: email markup with unclosed cells,
// uppercase tags, conditional comments and raw-text elements must all
// produce a usable tree with correct source lines.
import test from "node:test";
import assert from "node:assert/strict";

import { parseHtml, allElements, getAttr } from "../dist/html.js";

test("parses nested elements, lowercasing tags and attribute names", () => {
  const doc = parseHtml('<TABLE Width="600"><TR><TD>hi</TD></TR></TABLE>');
  const [table, tr, td] = allElements(doc);
  assert.equal(table.tag, "table");
  assert.equal(getAttr(table, "width"), "600");
  assert.equal(tr.tag, "tr");
  assert.equal(td.tag, "td");
  assert.equal(td.children[0].text, "hi");
  // Single-quoted, unquoted and valueless attribute forms all parse.
  const [img] = allElements(parseHtml("<img src='a.png' width=120 hidden>"));
  assert.equal(getAttr(img, "src"), "a.png");
  assert.equal(getAttr(img, "width"), "120");
  assert.equal(getAttr(img, "hidden"), null); // present, valueless
  assert.equal(getAttr(img, "nope"), undefined); // absent
});

test("void elements never swallow following content", () => {
  const doc = parseHtml("<div><br><img src=x.png><span>after</span></div>");
  const [div] = allElements(doc);
  assert.deepEqual(div.children.map((c) => c.tag ?? "text"),
    ["br", "img", "span"]);
});

test("auto-closes unclosed table cells, the classic email omission", () => {
  const doc = parseHtml("<table><tr><td>one<td>two<tr><td>three</table>");
  const [table] = allElements(doc);
  const rows = table.children.filter((c) => c.kind === "element");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].children.length, 2); // both cells siblings, not nested
  assert.equal(rows[1].children.length, 1);
});

test("auto-closes consecutive <p> and <li> elements", () => {
  const doc = parseHtml("<ul><li>a<li>b</ul><p>x<p>y");
  const tags = allElements(doc).map((e) => e.tag);
  assert.deepEqual(tags, ["ul", "li", "li", "p", "p"]);
});

test("conditional comments and raw-text style content stay verbatim", () => {
  const doc = parseHtml("<!--[if mso]><table><tr><td><![endif]-->body");
  const comment = doc.children[0];
  assert.equal(comment.kind, "comment");
  assert.ok(comment.text.includes("[if mso]"));
  assert.ok(comment.text.includes("<![endif]"));
  // <style> content is raw text, not parsed as markup.
  const [style] = allElements(parseHtml("<style>td > a { color: red }</style>"));
  assert.equal(style.children.length, 1);
  assert.equal(style.children[0].kind, "text");
  assert.ok(style.children[0].text.includes("td > a"));
});

test("tracks the source line of every element", () => {
  const doc = parseHtml("<div>\n  <span>a</span>\n  <img src=x>\n</div>");
  const byTag = Object.fromEntries(allElements(doc).map((e) => [e.tag, e.line]));
  assert.equal(byTag.div, 1);
  assert.equal(byTag.span, 2);
  assert.equal(byTag.img, 3);
});

test("a bare < in text does not derail parsing", () => {
  const doc = parseHtml("<p>1 < 2 and 3 > 2</p>");
  const [p] = allElements(doc);
  const text = p.children.map((c) => c.text).join("");
  assert.ok(text.includes("<"));
  assert.ok(text.includes("2 and 3"));
});

test("stray close tags and unterminated tags never throw", () => {
  assert.doesNotThrow(() => parseHtml("</td></table><b>ok"));
  assert.doesNotThrow(() => parseHtml("<div><span class='x"));
  assert.doesNotThrow(() => parseHtml("<!-- never closed"));
  const doc = parseHtml("</td>text");
  assert.equal(doc.children.some((n) => n.kind === "text"), true);
});
