// Shared test helpers: temp dirs with cleanup, an .eml factory and a
// runner for the built CLI. Everything is deterministic — fresh mkdtemp
// directories, fixed fixture values, no network, no clocks.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "dist", "cli.js");

/** Create a temp dir with the given files; returns { dir, cleanup }. */
export function makeDir(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), "mailgold-test-"));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content);
  }
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/**
 * Build a multipart/alternative .eml with 7bit parts (CRLF line ends,
 * like a real message on the wire). Pass html: null / text: null to
 * drop a part.
 */
export function makeEml({ html, text, subject = "Test message" } = {}) {
  const boundary = "=_test_boundary_1";
  const lines = [
    "From: Sender <sender@example.test>",
    "To: Recipient <recipient@example.test>",
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
  ];
  if (text !== null && text !== undefined) {
    lines.push(`--${boundary}`, "Content-Type: text/plain; charset=UTF-8", "", text);
  }
  if (html !== null && html !== undefined) {
    lines.push(`--${boundary}`, "Content-Type: text/html; charset=UTF-8", "", html);
  }
  lines.push(`--${boundary}--`, "");
  return lines.join("\r\n");
}

/**
 * Run the built CLI synchronously. Returns { status, stdout, stderr }.
 * Pass `cwd` to control where the snapshot store lands.
 */
export function runCli(args, { cwd } = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: cwd ?? ROOT,
    encoding: "utf8",
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}
