// The unified diff: edit scripts, hunk headers, context grouping —
// snapshot failures must read like git output.
import test from "node:test";
import assert from "node:assert/strict";

import { diffLines, unifiedDiff } from "../dist/diff.js";

test("identical inputs produce an all-same script and empty diff", () => {
  const lines = ["a", "b", "c"];
  assert.ok(diffLines(lines, lines).every((op) => op.kind === "same"));
  assert.equal(unifiedDiff(lines, lines), "");
});

test("changes, insertions and deletions produce minimal edit scripts", () => {
  const ops = diffLines(["a", "b", "c"], ["a", "X", "c"]);
  assert.deepEqual(ops.map((o) => o.kind), ["same", "del", "add", "same"]);
  assert.equal(ops[1].text, "b");
  assert.equal(ops[2].text, "X");
  const ins = diffLines(["a", "c"], ["a", "b", "c"]);
  assert.deepEqual(ins.map((o) => o.kind), ["same", "add", "same"]);
  const del = diffLines(["a", "b", "c"], ["a", "c"]);
  assert.deepEqual(del.map((o) => o.kind), ["same", "del", "same"]);
});

test("unified diff carries labels, hunk header and +/- lines", () => {
  const a = ["one", "two", "three", "four", "five"];
  const b = ["one", "two", "CHANGED", "four", "five"];
  const diff = unifiedDiff(a, b, { aLabel: "expected", bLabel: "actual" });
  const lines = diff.split("\n");
  assert.equal(lines[0], "--- expected");
  assert.equal(lines[1], "+++ actual");
  assert.match(lines[2], /^@@ -\d+,\d+ \+\d+,\d+ @@$/);
  assert.ok(lines.includes("-three"));
  assert.ok(lines.includes("+CHANGED"));
  // Hunk header line numbers point at the right region: a change at
  // line 10 with 2 context lines means the hunk starts at line 8.
  const bigA = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
  const bigB = [...bigA];
  bigB[9] = "edited";
  const big = unifiedDiff(bigA, bigB, { context: 2 });
  assert.match(big, /@@ -8,5 \+8,5 @@/);
  assert.ok(big.includes("-line 10"));
  assert.ok(big.includes("+edited"));
});

test("distant changes split into separate hunks", () => {
  const a = Array.from({ length: 30 }, (_, i) => `l${i}`);
  const b = [...a];
  b[2] = "first";
  b[27] = "second";
  const diff = unifiedDiff(a, b, { context: 2 });
  const hunks = diff.split("\n").filter((l) => l.startsWith("@@"));
  assert.equal(hunks.length, 2);
});

test("nearby changes merge into one hunk", () => {
  const a = ["a", "b", "c", "d", "e", "f"];
  const b = ["a", "X", "c", "d", "Y", "f"];
  const diff = unifiedDiff(a, b, { context: 2 });
  const hunks = diff.split("\n").filter((l) => l.startsWith("@@"));
  assert.equal(hunks.length, 1);
});
