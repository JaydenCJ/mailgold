#!/usr/bin/env node
/**
 * The mailgold CLI. Thin dispatch over the pure modules: every command
 * is a few reads, one pipeline call and formatted output. Exit codes
 * are part of the contract: 0 ok, 1 snapshot mismatch or lint gate
 * failure, 2 usage/input error.
 */
import { existsSync, readFileSync } from "node:fs";
import { parseArgs, splitList, UsageError } from "./cliargs.js";
import { lintHtml } from "./lint.js";
import { parseEml } from "./mime.js";
import { normalizeHtml } from "./normalize.js";
import { normalizeTextPart } from "./textpart.js";
import { countFindings, formatFindings, formatSummary, toJsonReport } from "./report.js";
import { RULES } from "./rules.js";
import { DEFAULT_SCRUB_PARAMS } from "./scrub.js";
import {
  buildSnapshot, compareSnapshots, DEFAULT_STORE_DIR,
  SnapshotError, SnapshotStore, SourceError,
} from "./snapshot.js";
import type { Finding } from "./types.js";
import { VERSION } from "./version.js";

const HELP = `mailgold ${VERSION} — snapshot testing for transactional email

Usage:
  mailgold record <file...> [--name n] [--dir d] [--text f] [--scrub list] [--keep-query] [--keep-comments]
  mailgold check [name...] [--dir d] [--update]
  mailgold lint <file...> [--strict] [--disable ids] [--client list] [--json]
  mailgold normalize <file> [--part html|text] [--scrub list] [--keep-query] [--keep-comments]
  mailgold list [--dir d]
  mailgold rm <name...> [--dir d]
  mailgold rules [--json]

Commands:
  record      Normalize a .html or .eml file and store it as a snapshot
  check       Re-normalize each snapshot's source and diff against the store
  lint        Run the client-quirk rules (Outlook, Gmail, ...) over a file
  normalize   Print the canonical form of a file to stdout
  list        List stored snapshots
  rm          Remove stored snapshots
  rules       Print the lint rule catalog

Options:
  --dir d           Snapshot directory (default: ${DEFAULT_STORE_DIR})
  --name n          Snapshot name (default: source basename)
  --text f          Pair a text/plain file with an HTML source
  --scrub list      Volatile query params to scrub (default: built-in list)
  --keep-query      Do not scrub any query parameters
  --keep-comments   Keep non-conditional HTML comments
  --update          Rewrite snapshots that fail the check
  --strict          Lint: warnings also fail (exit 1)
  --disable ids     Lint: comma-separated rule ids to skip
  --client list     Lint: only rules affecting these clients
                    (all, gmail, outlook, outlook-web, windows-mail)
  --json            Machine-readable output
  --part html|text  Which part normalize prints for .eml input (default html)

Exit codes: 0 ok, 1 mismatch or lint errors, 2 usage or input error.`;

function out(line: string): void {
  process.stdout.write(line + "\n");
}

function err(line: string): void {
  process.stderr.write(line + "\n");
}

function scrubFrom(values: Record<string, string>, booleans: Set<string>): string[] {
  if (booleans.has("keep-query")) return [];
  const scrub = values["scrub"];
  return scrub === undefined ? DEFAULT_SCRUB_PARAMS : splitList(scrub);
}

function requireFile(path: string): void {
  if (!existsSync(path)) throw new SourceError(`${path}: no such file`);
}

function cmdRecord(argv: string[]): number {
  const args = parseArgs(argv, {
    value: ["--dir", "--name", "--text", "--scrub"],
    boolean: ["--keep-query", "--keep-comments"],
  });
  if (args.positional.length === 0) throw new UsageError("record needs at least one file");
  if (args.values["name"] !== undefined && args.positional.length > 1) {
    throw new UsageError("--name only makes sense with a single file");
  }
  const store = new SnapshotStore(args.values["dir"] ?? DEFAULT_STORE_DIR);
  const scrub = scrubFrom(args.values, args.booleans);
  for (const source of args.positional) {
    requireFile(source);
    const snapshot = buildSnapshot(source, {
      name: args.values["name"],
      scrub,
      textFile: args.values["text"],
      keepComments: args.booleans.has("keep-comments"),
    });
    const file = store.write(snapshot);
    const lines = (n: number): string => `${n} line${n === 1 ? "" : "s"}`;
    const textNote = snapshot.textLines === null
      ? "no text part"
      : `text ${lines(snapshot.textLines.length)}`;
    out(`recorded ${snapshot.name} -> ${file} (html ${lines(snapshot.htmlLines.length)}, ${textNote})`);
  }
  return 0;
}

function cmdCheck(argv: string[]): number {
  const args = parseArgs(argv, { value: ["--dir"], boolean: ["--update"] });
  const store = new SnapshotStore(args.values["dir"] ?? DEFAULT_STORE_DIR);
  const names = args.positional.length > 0 ? args.positional : store.list();
  if (names.length === 0) {
    err(`no snapshots in ${store.dir}; record one first`);
    return 1;
  }
  let okCount = 0;
  let failCount = 0;
  let updated = 0;
  for (const name of names) {
    if (!store.has(name)) throw new SourceError(`no snapshot named ${name} in ${store.dir}`);
    const stored = store.read(name);
    requireFile(stored.source);
    // Re-apply every record-time option the snapshot header carries, so
    // `--text` pairings and `--keep-comments` survive the round trip.
    const fresh = buildSnapshot(stored.source, {
      name: stored.name,
      scrub: stored.scrub,
      textFile: stored.textSource,
      keepComments: stored.keepComments,
    });
    const result = compareSnapshots(stored, fresh);
    if (result.ok) {
      out(`ok      ${name}`);
      okCount++;
      continue;
    }
    if (args.booleans.has("update")) {
      store.write(fresh);
      out(`updated ${name}`);
      updated++;
      continue;
    }
    const parts: string[] = [];
    if (result.htmlDiff !== "") parts.push("html");
    if (result.textDiff !== "") parts.push("text");
    out(`FAIL    ${name} (${parts.join(", ")})`);
    if (result.htmlDiff !== "") out(result.htmlDiff);
    if (result.textDiff !== "") out(result.textDiff);
    failCount++;
  }
  const bits = [`${okCount} ok`];
  if (updated > 0) bits.push(`${updated} updated`);
  if (failCount > 0) bits.push(`${failCount} failed`);
  out(`${names.length} snapshot${names.length === 1 ? "" : "s"}: ${bits.join(", ")}`);
  return failCount > 0 ? 1 : 0;
}

function lintOneFile(path: string, disable: string[], clients: string[] | undefined): Finding[] {
  requireFile(path);
  const raw = readFileSync(path, "utf8");
  if (path.toLowerCase().endsWith(".eml")) {
    const message = parseEml(raw);
    if (message.html === null) throw new SourceError(`${path}: message has no text/html part to lint`);
    return lintHtml(message.html, { disable, clients, message });
  }
  return lintHtml(raw, { disable, clients });
}

function cmdLint(argv: string[]): number {
  const args = parseArgs(argv, {
    value: ["--disable", "--client"],
    boolean: ["--strict", "--json"],
  });
  if (args.positional.length === 0) throw new UsageError("lint needs at least one file");
  const disable = args.values["disable"] === undefined ? [] : splitList(args.values["disable"]);
  for (const id of disable) {
    if (!RULES.some((r) => r.id === id)) throw new UsageError(`--disable: unknown rule id ${id}`);
  }
  const clients = args.values["client"] === undefined ? undefined : splitList(args.values["client"]);
  if (clients !== undefined) {
    // A typo here would silently disable most of the catalog.
    const known = [...new Set(RULES.flatMap((r) => r.clients))].sort();
    for (const client of clients) {
      if (!known.includes(client)) {
        throw new UsageError(`--client: unknown client ${client} (known: ${known.join(", ")})`);
      }
    }
  }
  const results = args.positional.map((file) => ({
    file,
    findings: lintOneFile(file, disable, clients),
  }));
  const all = results.flatMap((r) => r.findings);
  const counts = countFindings(all);
  if (args.booleans.has("json")) {
    out(toJsonReport(results));
  } else {
    for (const { file, findings } of results) {
      for (const line of formatFindings(file, findings)) out(line);
    }
    out(formatSummary(counts));
  }
  if (counts.errors > 0) return 1;
  if (args.booleans.has("strict") && counts.warnings > 0) return 1;
  return 0;
}

function cmdNormalize(argv: string[]): number {
  const args = parseArgs(argv, {
    value: ["--part", "--scrub"],
    boolean: ["--keep-query", "--keep-comments"],
  });
  if (args.positional.length !== 1) throw new UsageError("normalize takes exactly one file");
  const part = args.values["part"] ?? "html";
  if (part !== "html" && part !== "text") throw new UsageError("--part must be html or text");
  const source = args.positional[0]!;
  requireFile(source);
  const raw = readFileSync(source, "utf8");
  const scrub = scrubFrom(args.values, args.booleans);
  let html: string | null;
  let text: string | null;
  if (source.toLowerCase().endsWith(".eml")) {
    const message = parseEml(raw);
    html = message.html;
    text = message.text;
  } else {
    html = raw;
    text = null;
  }
  if (part === "html") {
    if (html === null) throw new SourceError(`${source}: no text/html part`);
    const lines = normalizeHtml(html, {
      scrubParams: scrub,
      keepComments: args.booleans.has("keep-comments"),
    });
    for (const line of lines) out(line);
  } else {
    if (text === null) throw new SourceError(`${source}: no text/plain part`);
    for (const line of normalizeTextPart(text, { scrubParams: scrub })) out(line);
  }
  return 0;
}

function cmdList(argv: string[]): number {
  const args = parseArgs(argv, { value: ["--dir"], boolean: [] });
  if (args.positional.length > 0) throw new UsageError("list takes no positional arguments");
  const store = new SnapshotStore(args.values["dir"] ?? DEFAULT_STORE_DIR);
  for (const name of store.list()) {
    const snapshot = store.read(name);
    out(`${name}  ${snapshot.kind}  ${snapshot.source}`);
  }
  return 0;
}

function cmdRm(argv: string[]): number {
  const args = parseArgs(argv, { value: ["--dir"], boolean: [] });
  if (args.positional.length === 0) throw new UsageError("rm needs at least one snapshot name");
  const store = new SnapshotStore(args.values["dir"] ?? DEFAULT_STORE_DIR);
  for (const name of args.positional) {
    if (!store.remove(name)) throw new SourceError(`no snapshot named ${name} in ${store.dir}`);
    out(`removed ${name}`);
  }
  return 0;
}

function cmdRules(argv: string[]): number {
  const args = parseArgs(argv, { value: [], boolean: ["--json"] });
  if (args.positional.length > 0) throw new UsageError("rules takes no positional arguments");
  if (args.booleans.has("json")) {
    out(JSON.stringify(RULES.map((r) => ({
      id: r.id, severity: r.severity, clients: r.clients, summary: r.summary,
    })), null, 2));
    return 0;
  }
  const idWidth = Math.max(...RULES.map((r) => r.id.length));
  for (const rule of RULES) {
    out(`${rule.id.padEnd(idWidth)}  ${rule.severity.padEnd(5)}  [${rule.clients.join(", ")}]  ${rule.summary}`);
  }
  return 0;
}

export function main(argv: string[]): number {
  const [command, ...rest] = argv;
  try {
    switch (command) {
      case undefined:
      case "--help":
      case "help":
        out(HELP);
        return command === undefined ? 2 : 0;
      case "--version":
        out(VERSION);
        return 0;
      case "record": return cmdRecord(rest);
      case "check": return cmdCheck(rest);
      case "lint": return cmdLint(rest);
      case "normalize": return cmdNormalize(rest);
      case "list": return cmdList(rest);
      case "rm": return cmdRm(rest);
      case "rules": return cmdRules(rest);
      default:
        throw new UsageError(`unknown command ${command}`);
    }
  } catch (error) {
    if (error instanceof UsageError) {
      err(`mailgold: ${error.message} (run \`mailgold --help\`)`);
      return 2;
    }
    if (error instanceof SourceError || error instanceof SnapshotError) {
      err(`mailgold: ${error.message}`);
      return 2;
    }
    throw error;
  }
}

process.exit(main(process.argv.slice(2)));
