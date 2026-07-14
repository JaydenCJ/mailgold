// Snapshot format, store and comparison: round-trips, strict parsing
// with positioned errors, and the record→check contract on disk.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildSnapshot, compareSnapshots, formatSnapshot, parseSnapshot,
  nameForSource, SnapshotStore, SnapshotError,
} from "../dist/snapshot.js";
import { makeDir, makeEml } from "./helpers.mjs";

const HTML = '<table width="600"><tr><td>Hello Dana</td></tr></table>';

test("format then parse round-trips every field", () => {
  const snapshot = {
    name: "welcome",
    source: "emails/welcome.eml",
    kind: "eml",
    scrub: ["token", "utm_*"],
    htmlLines: ["<table>", "  <tr>", "</table>"],
    textLines: ["Hello", "", "Bye"],
  };
  assert.deepEqual(parseSnapshot(formatSnapshot(snapshot), "x.snap"), snapshot);
});

test("a snapshot without a text part round-trips as null", () => {
  const snapshot = {
    name: "n", source: "n.html", kind: "html", scrub: [],
    htmlLines: ["<p>", "</p>"], textLines: null,
  };
  const text = formatSnapshot(snapshot);
  assert.ok(text.includes("--- text: none ---"));
  assert.deepEqual(parseSnapshot(text, "n.snap"), snapshot);
});

test("corrupt snapshots fail with a positioned SnapshotError", () => {
  assert.throws(() => parseSnapshot("not a snapshot\n", "bad.snap"),
    (e) => e instanceof SnapshotError && e.line === 1);
  const good = formatSnapshot({
    name: "n", source: "s", kind: "html", scrub: [],
    htmlLines: ["a", "b"], textLines: null,
  });
  // Truncate the body: declared 2 lines, provide 1.
  const truncated = good.replace("\n|b", "");
  assert.throws(() => parseSnapshot(truncated, "bad.snap"),
    (e) => e instanceof SnapshotError && /`\|`-prefixed/.test(e.message));
  assert.throws(() => parseSnapshot(good + "extra\n", "bad.snap"),
    (e) => e instanceof SnapshotError && /trailing/.test(e.message));
});

test("buildSnapshot on .eml captures both parts and scrubs tokens", () => {
  const { dir, cleanup } = makeDir({
    "welcome.eml": makeEml({
      html: '<a href="https://x.example.test/c?token=abc">Confirm</a>',
      text: "Confirm: https://x.example.test/c?token=abc",
    }),
  });
  try {
    const snapshot = buildSnapshot(join(dir, "welcome.eml"), { scrub: ["token"] });
    assert.equal(snapshot.kind, "eml");
    assert.equal(snapshot.name, "welcome"); // derived from the basename
    assert.ok(snapshot.htmlLines.some((l) => l.includes("token=*")));
    assert.ok(snapshot.textLines.some((l) => l.includes("token=*")));
    assert.equal(nameForSource("emails/receipt.html"), "receipt");
  } finally {
    cleanup();
  }
});

test("buildSnapshot on .html can pair an external text file", () => {
  const { dir, cleanup } = makeDir({ "r.html": HTML, "r.txt": "Hello Dana\n" });
  try {
    const bare = buildSnapshot(join(dir, "r.html"));
    assert.equal(bare.kind, "html");
    assert.equal(bare.textLines, null);
    const paired = buildSnapshot(join(dir, "r.html"), { textFile: join(dir, "r.txt") });
    assert.deepEqual(paired.textLines, ["Hello Dana"]);
  } finally {
    cleanup();
  }
});

test("record-time options round-trip through the snapshot header", () => {
  // If --text pairing or --keep-comments were lost on parse, every
  // later check would rebuild without them and fail forever.
  const { dir, cleanup } = makeDir({
    "r.html": "<!-- draft note -->" + HTML,
    "r.txt": "Hello Dana\n",
  });
  try {
    const snapshot = buildSnapshot(join(dir, "r.html"), {
      textFile: join(dir, "r.txt"),
      keepComments: true,
    });
    assert.equal(snapshot.textSource, join(dir, "r.txt"));
    assert.equal(snapshot.keepComments, true);
    assert.ok(snapshot.htmlLines.some((l) => l.includes("draft note")));
    const reparsed = parseSnapshot(formatSnapshot(snapshot), "r.snap");
    assert.deepEqual(reparsed, snapshot);
    // Plain snapshots must not grow the optional header lines.
    const plain = buildSnapshot(join(dir, "r.html"));
    assert.ok(!formatSnapshot(plain).includes("text-source:"));
    assert.ok(!formatSnapshot(plain).includes("keep-comments:"));
  } finally {
    cleanup();
  }
});

test("compareSnapshots: ok when equal, labelled diffs when not", () => {
  const { dir, cleanup } = makeDir({ "a.html": HTML });
  try {
    const stored = buildSnapshot(join(dir, "a.html"));
    assert.equal(compareSnapshots(stored, stored).ok, true);
    const fresh = { ...stored, htmlLines: stored.htmlLines.map((l) => l.replace("Dana", "Alex")) };
    const result = compareSnapshots(stored, fresh);
    assert.equal(result.ok, false);
    assert.ok(result.htmlDiff.includes("-"));
    assert.ok(result.htmlDiff.includes("snapshot html"));
  } finally {
    cleanup();
  }
});

test("a text part that appears or disappears is a diff, not a pass", () => {
  const base = {
    name: "n", source: "s", kind: "html", scrub: [],
    htmlLines: ["<p>x</p>"], textLines: null,
  };
  const withText = { ...base, textLines: ["hello"] };
  const result = compareSnapshots(base, withText);
  assert.equal(result.ok, false);
  assert.ok(result.textDiff.includes("(no text part)"));
});

test("the store lists, reads, writes and removes .snap files", () => {
  const { dir, cleanup } = makeDir({});
  try {
    const store = new SnapshotStore(join(dir, ".mailgold"));
    assert.deepEqual(store.list(), []);
    const snapshot = {
      name: "welcome", source: "w.html", kind: "html", scrub: [],
      htmlLines: ["<p>hi</p>"], textLines: null,
    };
    const file = store.write(snapshot);
    assert.ok(readFileSync(file, "utf8").startsWith("mailgold snapshot v1"));
    assert.deepEqual(store.list(), ["welcome"]);
    assert.deepEqual(store.read("welcome"), snapshot);
    assert.equal(store.remove("welcome"), true);
    assert.equal(store.remove("welcome"), false);
    assert.deepEqual(store.list(), []);
  } finally {
    cleanup();
  }
});
