// The tolerant CSS reader: declaration parsing (including url() with
// semicolons), canonical serialization, and <style> block flattening
// with line tracking.
import test from "node:test";
import assert from "node:assert/strict";

import {
  parseDeclarations, serializeDeclarations, normalizeStyleAttr, parseStylesheet,
} from "../dist/css.js";

test("parses declarations, lowercasing properties, skipping garbage", () => {
  const decls = parseDeclarations("COLOR: Red; Padding: 0 10px;");
  assert.deepEqual(decls.map((d) => d.property), ["color", "padding"]);
  assert.equal(decls[0].value, "Red"); // values keep their case (fonts, urls)
  // Malformed chunks are skipped, not fatal.
  const messy = parseDeclarations("color red; ; font-size: 14px; :bare");
  assert.deepEqual(messy.map((d) => d.property), ["font-size"]);
});

test("a semicolon inside url(...) does not split the declaration", () => {
  const decls = parseDeclarations(
    "background-image: url(data:image/png;base64,AAAA); color: red");
  assert.equal(decls.length, 2);
  assert.ok(decls[0].value.includes(";base64,"));
});

test("!important is stripped into a flag and re-serialized", () => {
  const decls = parseDeclarations("color: red !important");
  assert.equal(decls[0].important, true);
  assert.equal(decls[0].value, "red");
  assert.equal(serializeDeclarations(decls), "color: red !important");
});

test("normalizeStyleAttr sorts properties and normalizes spacing", () => {
  assert.equal(
    normalizeStyleAttr("padding:0   10px;COLOR:red;"),
    "color: red; padding: 0 10px");
  // Same declarations in any order canonicalize identically.
  assert.equal(
    normalizeStyleAttr("color:red;padding:0 10px"),
    normalizeStyleAttr("padding: 0 10px ; color: red ;"));
  // Comma spacing in values is cosmetic and must not leak into snapshots.
  assert.equal(
    normalizeStyleAttr("font-family:Arial,sans-serif"),
    "font-family: Arial, sans-serif");
  assert.equal(
    normalizeStyleAttr("font-family: Arial ,  sans-serif"),
    "font-family: Arial, sans-serif");
  // ...but commas inside quoted strings and url() payloads are data.
  assert.equal(
    normalizeStyleAttr('font-family: "Foo,Bar", serif'),
    'font-family: "Foo,Bar", serif');
  assert.equal(
    normalizeStyleAttr("background: url(data:image/png;base64,AA,BB) red"),
    "background: url(data:image/png;base64,AA,BB) red");
});

test("parses stylesheet rules with selectors and source lines", () => {
  const sheet = parseStylesheet("a { color: blue }\n.btn { padding: 4px }", 10);
  assert.equal(sheet.rules.length, 2);
  assert.equal(sheet.rules[0].selector, "a");
  assert.equal(sheet.rules[0].line, 10);
  assert.equal(sheet.rules[1].selector, ".btn");
  assert.equal(sheet.rules[1].line, 11);
});

test("@media blocks are flattened with a prefixed selector", () => {
  const sheet = parseStylesheet(
    "@media (max-width: 600px) { .stack { width: 100% } }");
  assert.equal(sheet.rules.length, 1);
  assert.ok(sheet.rules[0].selector.startsWith("@media"));
  assert.ok(sheet.rules[0].selector.includes(".stack"));
  assert.equal(sheet.rules[0].declarations[0].property, "width");
});

test("@import statements are surfaced separately", () => {
  const sheet = parseStylesheet(
    '@import url("https://cdn.example.test/f.css");\nbody { margin: 0 }');
  assert.equal(sheet.imports.length, 1);
  assert.equal(sheet.imports[0].url, "https://cdn.example.test/f.css");
  assert.equal(sheet.rules.length, 1);
});

test("comments between and inside rules are ignored", () => {
  const sheet = parseStylesheet(
    "/* head */ a { /* inner */ color: red } /* tail */");
  assert.equal(sheet.rules.length, 1);
  assert.deepEqual(sheet.rules[0].declarations.map((d) => d.property), ["color"]);
});
