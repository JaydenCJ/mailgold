// Entity round-tripping: three spellings of the same character must
// normalize to one form, and re-encoding must keep markup-safe output.
import test from "node:test";
import assert from "node:assert/strict";

import { decodeEntities, encodeText, encodeAttr } from "../dist/entities.js";

test("named, decimal and hex entities decode to the same character", () => {
  assert.equal(decodeEntities("&nbsp;"), "\u00a0");
  assert.equal(decodeEntities("&#160;"), "\u00a0");
  assert.equal(decodeEntities("&#xA0;"), "\u00a0");
  assert.equal(decodeEntities("&mdash;"), "—");
  assert.equal(decodeEntities("&#8212;"), "—");
  // Unknown and malformed entities pass through untouched.
  assert.equal(decodeEntities("&nosuch;"), "&nosuch;");
  assert.equal(decodeEntities("AT&T"), "AT&T");
  assert.equal(decodeEntities("&#xZZ;"), "&#xZZ;");
  assert.equal(decodeEntities("&#0;"), "&#0;"); // out of range → verbatim
});

test("encodeText escapes markup and keeps nbsp visible", () => {
  assert.equal(encodeText("a < b & c > d"), "a &lt; b &amp; c &gt; d");
  assert.equal(encodeText("x\u00a0y"), "x&nbsp;y");
});

test("encodeAttr additionally escapes double quotes", () => {
  assert.equal(encodeAttr('say "hi" & go'), "say &quot;hi&quot; &amp; go");
});

test("decode then encode is stable for typical email text", () => {
  const original = "Tom &amp; Jerry &mdash; 50&nbsp;% &copy; Example";
  const once = encodeText(decodeEntities(original));
  const twice = encodeText(decodeEntities(once));
  assert.equal(once, twice);
});
