// Text-part normalization: re-wrapped paragraphs must compare equal;
// list structure, separators and real word changes must not.
import test from "node:test";
import assert from "node:assert/strict";

import { normalizeTextPart, extractUrls } from "../dist/textpart.js";

test("the same paragraph wrapped at different widths compares equal", () => {
  const narrow = "Thanks for signing up.\nPlease confirm your\nemail address today.";
  const wide = "Thanks for signing up. Please confirm\nyour email address today.";
  assert.deepEqual(normalizeTextPart(narrow), normalizeTextPart(wide));
});

test("paragraph breaks are preserved and blank runs collapse", () => {
  const lines = normalizeTextPart("First para.\n\n\n\nSecond para.");
  assert.deepEqual(lines, ["First para.", "", "Second para."]);
});

test("list items keep their own lines instead of merging", () => {
  const lines = normalizeTextPart("Your order:\n- 2x Widget\n- 1x Gadget\n1. first\n2) second");
  assert.deepEqual(lines,
    ["Your order:", "- 2x Widget", "- 1x Gadget", "1. first", "2) second"]);
});

test("separator rules and the -- signature delimiter stay intact", () => {
  const lines = normalizeTextPart("above\n-----\nbelow\n\n--\nThe Team");
  assert.deepEqual(lines, ["above", "-----", "below", "", "--", "The Team"]);
});

test("volatile URL parameters are scrubbed inside prose", () => {
  const lines = normalizeTextPart(
    "Confirm here:\n\nhttps://app.example.test/c?uid=42&token=abc123\n",
    { scrubParams: ["uid", "token"] });
  assert.deepEqual(lines, ["Confirm here:", "", "https://app.example.test/c?uid=*&token=*"]);
  // extractUrls finds every link in order, stopping at parens.
  assert.deepEqual(
    extractUrls("See https://a.example.test/x and (https://b.example.test/y)."),
    ["https://a.example.test/x", "https://b.example.test/y"]);
});

test("normalization is idempotent and trims edge blanks", () => {
  const input = "\n\n  Hello there\n  friend.\n\n";
  const once = normalizeTextPart(input);
  assert.deepEqual(normalizeTextPart(once.join("\n")), once);
  assert.equal(once[0], "Hello there friend.");
});
