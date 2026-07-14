// Volatile-value scrubbing: per-send tokens become `*` while the
// parameter names — the part a snapshot should assert — survive.
import test from "node:test";
import assert from "node:assert/strict";

import { scrubUrl, scrubTextUrls, DEFAULT_SCRUB_PARAMS } from "../dist/scrub.js";

test("scrubs listed parameter values, keeps names and order", () => {
  assert.equal(
    scrubUrl("https://x.example.test/a?token=abc&page=2&sig=zzz", ["token", "sig"]),
    "https://x.example.test/a?token=*&page=2&sig=*");
  // Matching is case-insensitive, like real query handling.
  assert.equal(scrubUrl("https://x.example.test/?TOKEN=abc", ["token"]),
    "https://x.example.test/?TOKEN=*");
});

test("prefix globs match utm_* family parameters", () => {
  assert.equal(
    scrubUrl("https://x.example.test/?utm_source=e&utm_campaign=w&q=1", DEFAULT_SCRUB_PARAMS),
    "https://x.example.test/?utm_source=*&utm_campaign=*&q=1");
});

test("cid: URLs collapse entirely — content-IDs are per-send", () => {
  assert.equal(scrubUrl("cid:part1.ABC123@mailer", ["token"]), "cid:*");
});

test("URLs without a query, fragments and relative paths survive", () => {
  assert.equal(scrubUrl("https://x.example.test/logo.png", ["token"]),
    "https://x.example.test/logo.png");
  assert.equal(scrubUrl("/local/path?token=a#sec", ["token"]), "/local/path?token=*#sec");
  assert.equal(scrubUrl("https://x.example.test/?flag", ["flag"]),
    "https://x.example.test/?flag"); // valueless param: nothing to scrub
});

test("scrubTextUrls rewrites every URL inside prose", () => {
  const text = "Confirm: https://a.example.test/c?token=t1 or https://b.example.test/c?token=t2 today";
  assert.equal(
    scrubTextUrls(text, ["token"]),
    "Confirm: https://a.example.test/c?token=* or https://b.example.test/c?token=* today");
});
