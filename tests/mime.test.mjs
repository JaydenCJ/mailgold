// The MIME reader: real-world .eml structure — folded headers, nested
// multiparts, quoted-printable, base64, charsets, RFC 2047 subjects.
import test from "node:test";
import assert from "node:assert/strict";

import {
  parseEml, parseHeaders, parseContentType, decodeQuotedPrintable,
  decodeEncodedWords, splitMultipart,
} from "../dist/mime.js";
import { makeEml } from "./helpers.mjs";

test("extracts html and text parts from multipart/alternative", () => {
  const eml = makeEml({ html: "<p>Hello</p>", text: "Hello" });
  const message = parseEml(eml);
  assert.equal(message.html, "<p>Hello</p>");
  assert.equal(message.text, "Hello");
  assert.deepEqual(message.partTypes, ["text/plain", "text/html"]);
});

test("a bare non-multipart html message still works", () => {
  const raw = [
    "From: a@example.test",
    "Content-Type: text/html; charset=UTF-8",
    "",
    "<p>Bare</p>",
  ].join("\r\n");
  const message = parseEml(raw);
  assert.equal(message.html, "<p>Bare</p>");
  assert.equal(message.text, null);
});

test("folded headers unfold; content-type params may be quoted or bare", () => {
  const headers = parseHeaders(
    'Content-Type: multipart/alternative;\r\n boundary="abc";\r\n\tcharset=UTF-8');
  assert.equal(headers.length, 1);
  const ct = parseContentType(headers[0].value);
  assert.equal(ct.type, "multipart/alternative");
  assert.equal(ct.params.boundary, "abc");
  const quoted = parseContentType('text/html; charset="UTF-8"');
  const bare = parseContentType("TEXT/HTML; CHARSET=utf-8");
  assert.equal(quoted.type, "text/html");
  assert.equal(quoted.params.charset, "UTF-8");
  assert.equal(bare.type, "text/html");
  assert.equal(bare.params.charset, "utf-8");
});

test("quoted-printable soft breaks and =XX escapes decode", () => {
  assert.equal(decodeQuotedPrintable("pay=20now"), "pay now");
  assert.equal(decodeQuotedPrintable("one=\r\nline"), "oneline");
  // UTF-8 em dash through the full body path:
  const eml = makeEml({ html: null, text: null }).replace(
    "--=_test_boundary_1--",
    "--=_test_boundary_1\r\nContent-Type: text/plain; charset=UTF-8\r\n" +
    "Content-Transfer-Encoding: quoted-printable\r\n\r\na =E2=80=94 b\r\n--=_test_boundary_1--");
  assert.equal(parseEml(eml).text.trim(), "a — b");
});

test("base64 bodies decode with the declared charset", () => {
  const b64 = Buffer.from("<p>Café</p>", "utf8").toString("base64");
  const raw = [
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    b64,
  ].join("\r\n");
  assert.equal(parseEml(raw).html, "<p>Café</p>");
});

test("latin-1 quoted-printable decodes without mangling", () => {
  const raw = [
    "Content-Type: text/plain; charset=ISO-8859-1",
    "Content-Transfer-Encoding: quoted-printable",
    "",
    "caf=E9",
  ].join("\r\n");
  assert.equal(parseEml(raw).text, "café");
});

test("RFC 2047 encoded words decode in B and Q forms", () => {
  assert.equal(decodeEncodedWords("=?UTF-8?B?SGVsbG8gLSBXb3JsZA==?="), "Hello - World");
  assert.equal(decodeEncodedWords("=?UTF-8?Q?caf=C3=A9_time?="), "café time");
  // Whitespace between adjacent encoded words is not rendered.
  assert.equal(decodeEncodedWords("=?UTF-8?Q?one?= =?UTF-8?Q?two?="), "onetwo");
});

test("nested multipart/mixed > multipart/alternative resolves parts", () => {
  const inner = "=_inner";
  const outer = "=_outer";
  const raw = [
    `Content-Type: multipart/mixed; boundary="${outer}"`,
    "",
    `--${outer}`,
    `Content-Type: multipart/alternative; boundary="${inner}"`,
    "",
    `--${inner}`,
    "Content-Type: text/plain",
    "",
    "plain body",
    `--${inner}`,
    "Content-Type: text/html",
    "",
    "<p>html body</p>",
    `--${inner}--`,
    `--${outer}`,
    "Content-Type: application/pdf",
    "Content-Transfer-Encoding: base64",
    "",
    "AAAA",
    `--${outer}--`,
    "",
  ].join("\r\n");
  const message = parseEml(raw);
  assert.equal(message.text, "plain body");
  assert.equal(message.html, "<p>html body</p>");
  assert.deepEqual(message.partTypes, ["text/plain", "text/html", "application/pdf"]);
  // splitMultipart ignores the preamble and epilogue around markers.
  const body = ["preamble junk", "--b", "part one", "--b", "part two", "--b--", "epilogue"].join("\n");
  assert.deepEqual(splitMultipart(body, "b"), ["part one", "part two"]);
});

test("subject decodes; missing parts are null, never undefined", () => {
  const eml = makeEml({ html: "<p>x</p>", text: null, subject: "=?UTF-8?B?4pyT?= done" });
  const message = parseEml(eml);
  assert.equal(message.subject, "✓ done");
  assert.equal(message.text, null);
});
