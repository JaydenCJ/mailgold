// The argv parser: declared flags parse, typos are hard errors.
import test from "node:test";
import assert from "node:assert/strict";

import { parseArgs, splitList, UsageError } from "../dist/cliargs.js";

const SPEC = { value: ["--dir", "--name"], boolean: ["--update", "--json"] };

test("positionals, value flags and boolean flags parse together", () => {
  const args = parseArgs(["check", "welcome", "--dir", ".snaps", "--update"], SPEC);
  assert.deepEqual(args.positional, ["check", "welcome"]);
  assert.equal(args.values.dir, ".snaps");
  assert.ok(args.booleans.has("update"));
  // --flag=value form works, and -- ends flag parsing.
  const eq = parseArgs(["--dir=.s", "--", "--update"], SPEC);
  assert.equal(eq.values.dir, ".s");
  assert.deepEqual(eq.positional, ["--update"]); // after --, literal
});

test("unknown flags are a UsageError, never silently ignored", () => {
  assert.throws(() => parseArgs(["--updtae"], SPEC), UsageError);
});

test("a value flag without a value is a UsageError", () => {
  assert.throws(() => parseArgs(["--dir"], SPEC), UsageError);
  assert.throws(() => parseArgs(["--update=yes"], SPEC), UsageError);
});

test("splitList trims entries and drops empties", () => {
  assert.deepEqual(splitList("a, b,,c "), ["a", "b", "c"]);
});
