/**
 * Plain-text part normalization. The `text/plain` alternative is
 * usually generated, and generators re-wrap paragraphs at slightly
 * different widths from run to run (a name two characters longer moves
 * every subsequent line break). Snapshots therefore compare *logical*
 * lines: paragraph lines are unwrapped, list items and separator rules
 * keep their own lines, volatile URLs are scrubbed — so a text-part
 * diff means the words changed, not the wrapping.
 */
import { scrubTextUrls } from "./scrub.js";

/** Lines that must never be merged into the previous line. */
function startsNewLogicalLine(line: string): boolean {
  // List items and quotes: "- x", "* x", "1. x", "1) x", "> quoted".
  if (/^\s*([-*+•]|>|\d+[.)])\s/.test(line)) return true;
  // Deep indentation signals preformatted content (addresses, codes).
  if (/^\s{4,}\S/.test(line)) return true;
  return false;
}

/** Horizontal rules ("-----") and the `--` signature delimiter. */
function isSeparator(line: string): boolean {
  return /^\s*[-=_*~]{3,}\s*$/.test(line) || /^--\s*$/.test(line);
}

export interface TextNormalizeOptions {
  /** Query parameter patterns to scrub inside URLs; [] disables. */
  scrubParams?: string[];
}

/**
 * Normalize a text part to logical lines. Deterministic and idempotent:
 * normalizing the output again yields the same lines.
 */
export function normalizeTextPart(text: string, options: TextNormalizeOptions = {}): string[] {
  const scrub = options.scrubParams ?? [];
  const scrubbed = scrub.length > 0 ? scrubTextUrls(text, scrub) : text;
  const rawLines = scrubbed.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");

  const logical: string[] = [];
  let paragraphOpen = false;
  for (const rawLine of rawLines) {
    const line = rawLine.replace(/[ \t]+$/, "");
    if (line.trim() === "") {
      // Paragraph break; collapse runs of blanks to one.
      if (logical.length > 0 && logical[logical.length - 1] !== "") logical.push("");
      paragraphOpen = false;
      continue;
    }
    if (isSeparator(line)) {
      logical.push(line.trim());
      paragraphOpen = false;
      continue;
    }
    if (startsNewLogicalLine(line) || !paragraphOpen) {
      logical.push(line.replace(/^[ \t]+/, (m) => (/^\s{4,}\S/.test(line) ? m : "")));
      paragraphOpen = !startsNewLogicalLine(line);
      continue;
    }
    // Continuation of a wrapped paragraph: join with a single space.
    const previous = logical[logical.length - 1]!;
    logical[logical.length - 1] = `${previous} ${line.trim()}`;
  }

  // Collapse internal whitespace on non-preformatted lines, trim edges.
  const cleaned = logical.map((line) =>
    /^\s{4,}\S/.test(line) ? line : line.replace(/[ \t]+/g, " "));
  while (cleaned.length > 0 && cleaned[0] === "") cleaned.shift();
  while (cleaned.length > 0 && cleaned[cleaned.length - 1] === "") cleaned.pop();
  return cleaned;
}

/** Extract every http(s) URL from a block of text, in order. */
export function extractUrls(text: string): string[] {
  return text.match(/https?:\/\/[^\s<>"')\]]+/g) ?? [];
}
