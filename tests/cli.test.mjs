// CLI integration: the built binary against real files in fresh temp
// dirs — record/check/update lifecycle, lint gating, exit codes.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { makeDir, makeEml, runCli, ROOT } from "./helpers.mjs";
import { VERSION } from "../dist/version.js";

const GOOD_HTML = '<table role="presentation" width="600"><tr><td style="padding:8px;">' +
  '<a href="https://x.example.test/go?token=abc">Go</a></td></tr></table>';

test("--version matches package.json; --help documents every command", () => {
  const version = runCli(["--version"]);
  assert.equal(version.status, 0);
  assert.equal(version.stdout.trim(), VERSION);
  assert.equal(version.stdout.trim(),
    JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version);
  const help = runCli(["--help"]);
  assert.equal(help.status, 0);
  for (const word of ["record", "check", "lint", "normalize", "list", "rm", "rules", "Exit codes"]) {
    assert.ok(help.stdout.includes(word), `help missing ${word}`);
  }
});

test("record then check passes even when the volatile token changes", () => {
  const { dir, cleanup } = makeDir({ "welcome.eml": makeEml({ html: GOOD_HTML, text: "Go now" }) });
  try {
    const record = runCli(["record", "welcome.eml"], { cwd: dir });
    assert.equal(record.status, 0);
    assert.match(record.stdout, /recorded welcome -> /);
    // Simulate the next send: a different token in the same template.
    writeFileSync(join(dir, "welcome.eml"),
      makeEml({ html: GOOD_HTML.replace("token=abc", "token=zzz9"), text: "Go now" }));
    const check = runCli(["check"], { cwd: dir });
    assert.equal(check.status, 0);
    assert.match(check.stdout, /ok {6}welcome/);
    assert.match(check.stdout, /1 snapshot: 1 ok/); // singular, not "1 snapshot(s)"
  } finally {
    cleanup();
  }
});

test("check fails with a unified diff when the copy changes, exit 1", () => {
  const { dir, cleanup } = makeDir({ "w.eml": makeEml({ html: "<p>Pay within 30 days</p>", text: null }) });
  try {
    assert.equal(runCli(["record", "w.eml"], { cwd: dir }).status, 0);
    writeFileSync(join(dir, "w.eml"), makeEml({ html: "<p>Pay within 14 days</p>", text: null }));
    const check = runCli(["check"], { cwd: dir });
    assert.equal(check.status, 1);
    assert.match(check.stdout, /FAIL {4}w \(html\)/);
    assert.ok(check.stdout.includes("-  Pay within 30 days"));
    assert.ok(check.stdout.includes("+  Pay within 14 days"));
  } finally {
    cleanup();
  }
});

test("check --update re-blesses failing snapshots, then check passes", () => {
  const { dir, cleanup } = makeDir({ "w.html": "<p>old copy</p>" });
  try {
    runCli(["record", "w.html"], { cwd: dir });
    writeFileSync(join(dir, "w.html"), "<p>new copy</p>");
    const update = runCli(["check", "--update"], { cwd: dir });
    assert.equal(update.status, 0);
    assert.match(update.stdout, /updated w/);
    assert.equal(runCli(["check"], { cwd: dir }).status, 0);
  } finally {
    cleanup();
  }
});

test("a dropped text part fails the check — html alone is not enough", () => {
  const { dir, cleanup } = makeDir({ "w.eml": makeEml({ html: "<p>x</p>", text: "x" }) });
  try {
    runCli(["record", "w.eml"], { cwd: dir });
    writeFileSync(join(dir, "w.eml"), makeEml({ html: "<p>x</p>", text: null }));
    const check = runCli(["check"], { cwd: dir });
    assert.equal(check.status, 1);
    assert.match(check.stdout, /FAIL {4}w \(text\)/);
    assert.ok(check.stdout.includes("(no text part)"));
  } finally {
    cleanup();
  }
});

test("check re-applies a --text pairing recorded in the snapshot", () => {
  const { dir, cleanup } = makeDir({
    "w.html": GOOD_HTML,
    "w.txt": "Go now\n",
    "w.eml": makeEml({ html: GOOD_HTML, text: "Go now" }),
  });
  try {
    // .eml messages carry their own text part; pairing one is an error.
    const conflict = runCli(["record", "w.eml", "--text", "w.txt"], { cwd: dir });
    assert.equal(conflict.status, 2);
    assert.match(conflict.stderr, /--text cannot be paired with an \.eml/);
    const record = runCli(["record", "w.html", "--text", "w.txt"], { cwd: dir });
    assert.equal(record.status, 0);
    assert.match(record.stdout, /text 1 line\)/); // singular, not "1 lines"
    // Without the pairing persisted, this check would diff against
    // "(no text part)" and fail forever.
    assert.equal(runCli(["check"], { cwd: dir }).status, 0);
    // A real change in the paired text file must still fail — and
    // --update must re-bless it without dropping the pairing.
    writeFileSync(join(dir, "w.txt"), "Go later\n");
    assert.equal(runCli(["check"], { cwd: dir }).status, 1);
    assert.equal(runCli(["check", "--update"], { cwd: dir }).status, 0);
    assert.equal(runCli(["check"], { cwd: dir }).status, 0);
  } finally {
    cleanup();
  }
});

test("check re-applies --keep-comments recorded in the snapshot", () => {
  const { dir, cleanup } = makeDir({ "w.html": "<!-- build 7 --><p>hi</p>" });
  try {
    assert.equal(runCli(["record", "w.html", "--keep-comments"], { cwd: dir }).status, 0);
    const snap = readFileSync(join(dir, ".mailgold", "w.snap"), "utf8");
    assert.ok(snap.includes("keep-comments: yes"));
    assert.ok(snap.includes("build 7"));
    // Re-normalizing without the flag would drop the comment and fail.
    assert.equal(runCli(["check"], { cwd: dir }).status, 0);
  } finally {
    cleanup();
  }
});

test("lint exits 1 on errors, 0 on warnings, 1 with --strict", () => {
  const { dir, cleanup } = makeDir({
    "err.html": '<div style="display:flex">x</div>',
    "warn.html": '<td style="max-width:600px">x</td>',
    "m.eml": makeEml({ html: "<p>x</p>", text: null }),
  });
  try {
    assert.equal(runCli(["lint", "err.html"], { cwd: dir }).status, 1);
    assert.equal(runCli(["lint", "warn.html"], { cwd: dir }).status, 0);
    assert.equal(runCli(["lint", "warn.html", "--strict"], { cwd: dir }).status, 1);
    assert.equal(runCli(["lint", "err.html", "--disable", "no-css-flexbox"], { cwd: dir }).status, 0);
    // Linting an .eml adds message-level rules like missing-text-part.
    assert.ok(runCli(["lint", "m.eml"], { cwd: dir }).stdout.includes("missing-text-part"));
  } finally {
    cleanup();
  }
});

test("lint --json emits per-file findings and totals", () => {
  const { dir, cleanup } = makeDir({ "e.html": "<button>x</button>" });
  try {
    const result = runCli(["lint", "e.html", "--json"], { cwd: dir });
    assert.equal(result.status, 1);
    const report = JSON.parse(result.stdout);
    assert.equal(report.files.length, 1);
    assert.equal(report.files[0].file, "e.html");
    assert.ok(report.files[0].findings.some((f) => f.rule === "no-button"));
    assert.equal(report.total.errors >= 1, true);
  } finally {
    cleanup();
  }
});

test("normalize prints canonical html and the text part of an eml", () => {
  const { dir, cleanup } = makeDir({
    "m.eml": makeEml({ html: "<TD  Width=600>hi</TD>", text: "line one\nline two" }),
  });
  try {
    const html = runCli(["normalize", "m.eml"], { cwd: dir });
    assert.equal(html.status, 0);
    assert.ok(html.stdout.includes('<td width="600">'));
    const text = runCli(["normalize", "m.eml", "--part", "text"], { cwd: dir });
    assert.equal(text.status, 0);
    assert.equal(text.stdout.trim(), "line one line two"); // unwrapped
  } finally {
    cleanup();
  }
});

test("list and rm manage the store; rules prints the catalog", () => {
  const { dir, cleanup } = makeDir({ "a.html": "<p>a</p>", "b.html": "<p>b</p>" });
  try {
    runCli(["record", "a.html", "b.html"], { cwd: dir });
    const list = runCli(["list"], { cwd: dir });
    assert.match(list.stdout, /a {2}html {2}a\.html/);
    assert.match(list.stdout, /b {2}html {2}b\.html/);
    assert.equal(runCli(["rm", "a"], { cwd: dir }).status, 0);
    assert.ok(!runCli(["list"], { cwd: dir }).stdout.includes("a  html"));
    const rules = runCli(["rules"]);
    assert.equal(rules.status, 0);
    assert.ok(rules.stdout.includes("no-css-flexbox"));
    assert.ok(rules.stdout.includes("gmail-size-clip"));
  } finally {
    cleanup();
  }
});

test("usage and input errors exit 2 with a helpful message", () => {
  const bad = runCli(["check", "--updtae"]);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /unknown flag --updtae/);
  const missing = runCli(["record", "no-such-file.html"]);
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /no such file/);
  const unknown = runCli(["frobnicate"]);
  assert.equal(unknown.status, 2);
  const noHtml = runCli(["lint", "-"]);
  assert.equal(noHtml.status, 2);
  // A typo'd client would otherwise silently disable most rules.
  const badClient = runCli(["lint", "x.html", "--client", "outlok"]);
  assert.equal(badClient.status, 2);
  assert.match(badClient.stderr, /unknown client outlok/);
});

test("record honors --name, --dir and --keep-query", () => {
  const { dir, cleanup } = makeDir({ "w.html": '<a href="https://x.example.test/?token=abc">x</a>' });
  try {
    const result = runCli(
      ["record", "w.html", "--name", "custom", "--dir", "snaps", "--keep-query"],
      { cwd: dir });
    assert.equal(result.status, 0);
    const snap = readFileSync(join(dir, "snaps", "custom.snap"), "utf8");
    assert.ok(snap.includes("scrub: (none)"));
    assert.ok(snap.includes("token=abc")); // kept verbatim
  } finally {
    cleanup();
  }
});
