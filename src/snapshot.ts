/**
 * Snapshot format and store. Snapshots are line-prefixed plain text —
 * designed to be committed and read in code review, not a serialized
 * blob. The header records which scrub patterns produced the body, so
 * a check re-applies exactly the same normalization forever, and the
 * parser is strict: a corrupt file fails with a positioned error
 * instead of comparing garbage.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { normalizeHtml } from "./normalize.js";
import { normalizeTextPart } from "./textpart.js";
import { parseEml } from "./mime.js";
import { DEFAULT_SCRUB_PARAMS } from "./scrub.js";
import { unifiedDiff } from "./diff.js";
import type { Snapshot } from "./types.js";

export const SNAPSHOT_HEADER = "mailgold snapshot v1";
export const DEFAULT_STORE_DIR = ".mailgold";

/** Raised for malformed snapshot files, with the offending line. */
export class SnapshotError extends Error {
  constructor(message: string, readonly file: string, readonly line: number) {
    super(`${file}:${line}: ${message}`);
    this.name = "SnapshotError";
  }
}

/** Serialize a snapshot to its on-disk text form. */
export function formatSnapshot(snapshot: Snapshot): string {
  const out: string[] = [];
  out.push(SNAPSHOT_HEADER);
  out.push(`name: ${snapshot.name}`);
  out.push(`source: ${snapshot.source}`);
  out.push(`kind: ${snapshot.kind}`);
  out.push(`scrub: ${snapshot.scrub.length === 0 ? "(none)" : snapshot.scrub.join(",")}`);
  // Record-time options are part of the contract: a check must re-apply
  // exactly the normalization that produced the body, forever.
  if (snapshot.textSource !== undefined) out.push(`text-source: ${snapshot.textSource}`);
  if (snapshot.keepComments === true) out.push("keep-comments: yes");
  out.push(`--- html: ${snapshot.htmlLines.length} lines ---`);
  for (const line of snapshot.htmlLines) out.push(`|${line}`);
  if (snapshot.textLines === null) {
    out.push("--- text: none ---");
  } else {
    out.push(`--- text: ${snapshot.textLines.length} lines ---`);
    for (const line of snapshot.textLines) out.push(`|${line}`);
  }
  return out.join("\n") + "\n";
}

function expectPrefix(lines: string[], index: number, prefix: string, file: string): string {
  const line = lines[index];
  if (line === undefined || !line.startsWith(prefix)) {
    throw new SnapshotError(`expected \`${prefix}...\``, file, index + 1);
  }
  return line.slice(prefix.length);
}

function readBody(lines: string[], start: number, count: number, file: string): string[] {
  const body: string[] = [];
  for (let k = 0; k < count; k++) {
    const line = lines[start + k];
    if (line === undefined || !line.startsWith("|")) {
      throw new SnapshotError("expected a `|`-prefixed body line", file, start + k + 1);
    }
    body.push(line.slice(1));
  }
  return body;
}

/** Parse a snapshot file; throws SnapshotError on any malformation. */
export function parseSnapshot(content: string, file: string): Snapshot {
  const lines = content.replace(/\n$/, "").split("\n");
  if (lines[0] !== SNAPSHOT_HEADER) {
    throw new SnapshotError(`not a mailgold snapshot (expected \`${SNAPSHOT_HEADER}\`)`, file, 1);
  }
  const name = expectPrefix(lines, 1, "name: ", file);
  const source = expectPrefix(lines, 2, "source: ", file);
  const kind = expectPrefix(lines, 3, "kind: ", file);
  if (kind !== "html" && kind !== "eml") {
    throw new SnapshotError(`unknown kind \`${kind}\``, file, 4);
  }
  const scrubRaw = expectPrefix(lines, 4, "scrub: ", file);
  const scrub = scrubRaw === "(none)" ? [] : scrubRaw.split(",").map((s) => s.trim()).filter((s) => s !== "");

  // Optional record-time options, written only when they were used.
  let index = 5;
  let textSource: string | undefined;
  let keepComments = false;
  while (index < lines.length) {
    const line = lines[index]!;
    if (line.startsWith("text-source: ")) {
      textSource = line.slice("text-source: ".length);
      index++;
    } else if (line === "keep-comments: yes") {
      keepComments = true;
      index++;
    } else {
      break;
    }
  }

  const htmlHeader = expectPrefix(lines, index, "--- html: ", file);
  const htmlMatch = /^(\d+) lines ---$/.exec(htmlHeader);
  if (!htmlMatch) throw new SnapshotError("malformed html section header", file, index + 1);
  const htmlCount = Number.parseInt(htmlMatch[1]!, 10);
  const htmlLines = readBody(lines, index + 1, htmlCount, file);

  const textIndex = index + 1 + htmlCount;
  const textHeader = expectPrefix(lines, textIndex, "--- text: ", file);
  let textLines: string[] | null;
  let end: number;
  if (textHeader === "none ---") {
    textLines = null;
    end = textIndex + 1;
  } else {
    const textMatch = /^(\d+) lines ---$/.exec(textHeader);
    if (!textMatch) throw new SnapshotError("malformed text section header", file, textIndex + 1);
    const textCount = Number.parseInt(textMatch[1]!, 10);
    textLines = readBody(lines, textIndex + 1, textCount, file);
    end = textIndex + 1 + textCount;
  }
  if (end !== lines.length) {
    throw new SnapshotError("trailing content after snapshot body", file, end + 1);
  }
  const snapshot: Snapshot = { name, source, kind, scrub, htmlLines, textLines };
  if (textSource !== undefined) snapshot.textSource = textSource;
  if (keepComments) snapshot.keepComments = true;
  return snapshot;
}

export interface BuildOptions {
  name?: string;
  /** Query parameter patterns to scrub; defaults to the built-in list. */
  scrub?: string[];
  /** Pair a plain-text file with an HTML source. */
  textFile?: string;
  keepComments?: boolean;
}

/** Raised when a source file cannot become a snapshot. */
export class SourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceError";
  }
}

/** Derive a snapshot name from the source path. */
export function nameForSource(source: string): string {
  return basename(source, extname(source));
}

/**
 * Build a fresh (unstored) snapshot from a source file. `.eml` files
 * are parsed as MIME; anything else is treated as a bare HTML part.
 */
export function buildSnapshot(source: string, options: BuildOptions = {}): Snapshot {
  const scrub = options.scrub ?? DEFAULT_SCRUB_PARAMS;
  const raw = readFileSync(source, "utf8");
  const kind = extname(source).toLowerCase() === ".eml" ? "eml" : "html";
  let html: string;
  let text: string | null = null;
  if (kind === "eml") {
    if (options.textFile !== undefined) {
      throw new SourceError(`${source}: --text cannot be paired with an .eml (the message carries its own text part)`);
    }
    const message = parseEml(raw);
    if (message.html === null) {
      throw new SourceError(`${source}: message has no text/html part to snapshot`);
    }
    html = message.html;
    text = message.text;
  } else {
    html = raw;
    if (options.textFile !== undefined) {
      if (!existsSync(options.textFile)) {
        throw new SourceError(`${options.textFile}: no such file`);
      }
      text = readFileSync(options.textFile, "utf8");
    }
  }
  const snapshot: Snapshot = {
    name: options.name ?? nameForSource(source),
    source,
    kind,
    scrub,
    htmlLines: normalizeHtml(html, { scrubParams: scrub, keepComments: options.keepComments }),
    textLines: text === null ? null : normalizeTextPart(text, { scrubParams: scrub }),
  };
  if (options.textFile !== undefined) snapshot.textSource = options.textFile;
  if (options.keepComments === true) snapshot.keepComments = true;
  return snapshot;
}

/** Result of comparing a stored snapshot against a fresh build. */
export interface CheckResult {
  /** "" when the HTML matches. */
  htmlDiff: string;
  /** "" when the text matches (missing-vs-present counts as a diff). */
  textDiff: string;
  ok: boolean;
}

/** Compare stored vs fresh; diffs are unified and review-ready. */
export function compareSnapshots(stored: Snapshot, fresh: Snapshot): CheckResult {
  const htmlDiff = unifiedDiff(stored.htmlLines, fresh.htmlLines, {
    aLabel: `${stored.name} (snapshot html)`,
    bLabel: `${stored.name} (current html)`,
  });
  let textDiff = "";
  if (stored.textLines !== null || fresh.textLines !== null) {
    textDiff = unifiedDiff(stored.textLines ?? ["(no text part)"], fresh.textLines ?? ["(no text part)"], {
      aLabel: `${stored.name} (snapshot text)`,
      bLabel: `${stored.name} (current text)`,
    });
  }
  return { htmlDiff, textDiff, ok: htmlDiff === "" && textDiff === "" };
}

/** Filesystem-backed store of `.snap` files under one directory. */
export class SnapshotStore {
  constructor(readonly dir: string) {}

  pathFor(name: string): string {
    return join(this.dir, `${name}.snap`);
  }

  list(): string[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir)
      .filter((f) => f.endsWith(".snap"))
      .map((f) => f.slice(0, -".snap".length))
      .sort();
  }

  has(name: string): boolean {
    return existsSync(this.pathFor(name));
  }

  read(name: string): Snapshot {
    const file = this.pathFor(name);
    return parseSnapshot(readFileSync(file, "utf8"), file);
  }

  write(snapshot: Snapshot): string {
    mkdirSync(this.dir, { recursive: true });
    const file = this.pathFor(snapshot.name);
    writeFileSync(file, formatSnapshot(snapshot));
    return file;
  }

  remove(name: string): boolean {
    const file = this.pathFor(name);
    if (!existsSync(file)) return false;
    unlinkSync(file);
    return true;
  }
}
