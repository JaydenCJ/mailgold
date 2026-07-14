/**
 * A tolerant CSS reader: inline `style` declarations and `<style>` block
 * rules. It exists for two jobs — canonicalizing declarations so
 * snapshots are stable, and feeding the lint rules property/value pairs
 * with source lines. It respects quotes and parentheses (so a `;` inside
 * `url(data:...)` does not split a declaration) and flattens at-rule
 * blocks by prefixing selectors, which is all email lint needs.
 */
import type { Declaration, Stylesheet, StyleRule } from "./types.js";

/** Collapse runs of whitespace to single spaces and trim. */
function collapse(text: string): string {
  return text.replace(/[ \t\r\n\f]+/g, " ").trim();
}

/**
 * Canonicalize comma spacing in a declaration value so that
 * `Arial,sans-serif`, `Arial , sans-serif` and `Arial, sans-serif` all
 * serialize identically — a purely cosmetic difference that otherwise
 * leaks into snapshots. Quoted strings and `url(...)` payloads are left
 * byte-for-byte intact because commas are data there (font names with
 * commas, `data:` URIs).
 */
function canonicalizeCommas(value: string): string {
  let out = "";
  let quote: string | null = null;
  let urlDepth = 0;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]!;
    if (quote !== null) {
      out += ch;
      if (ch === quote && value[i - 1] !== "\\") quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; out += ch; continue; }
    if (urlDepth > 0) {
      out += ch;
      if (ch === "(") urlDepth++;
      else if (ch === ")") urlDepth--;
      continue;
    }
    if (ch === "(" && /(?:^|[^-a-z0-9_])url$/i.test(out)) {
      urlDepth = 1;
      out += ch;
      continue;
    }
    if (ch === ",") {
      out = out.replace(/ +$/, "") + ", ";
      while (i + 1 < value.length && value[i + 1] === " ") i++;
      continue;
    }
    out += ch;
  }
  return out;
}

/**
 * Split `text` on `separator` at depth zero — outside quotes and
 * parentheses. Used for `;` between declarations.
 */
function splitTop(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quote !== null) {
      if (ch === quote && text[i - 1] !== "\\") quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === "(") { depth++; continue; }
    if (ch === ")") { if (depth > 0) depth--; continue; }
    if (ch === separator && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

/**
 * Parse a declaration list (the content of a `style` attribute or rule
 * body). Malformed chunks are skipped rather than aborting the list.
 */
export function parseDeclarations(text: string): Declaration[] {
  const out: Declaration[] = [];
  for (const chunk of splitTop(text, ";")) {
    const colon = chunk.indexOf(":");
    if (colon === -1) continue;
    const property = collapse(chunk.slice(0, colon)).toLowerCase();
    if (property === "" || !/^[-a-z]+$/.test(property)) continue;
    let value = canonicalizeCommas(collapse(chunk.slice(colon + 1)));
    if (value === "") continue;
    let important = false;
    const bang = value.replace(/\s*!\s*important\s*$/i, "");
    if (bang !== value) { important = true; value = bang; }
    out.push({ property, value, important });
  }
  return out;
}

/**
 * Serialize declarations in canonical form: sorted by property (stable
 * for equal names), single spacing, lowercase property, no trailing `;`.
 */
export function serializeDeclarations(decls: Declaration[]): string {
  const sorted = [...decls].sort((a, b) =>
    a.property < b.property ? -1 : a.property > b.property ? 1 : 0);
  return sorted
    .map((d) => `${d.property}: ${d.value}${d.important ? " !important" : ""}`)
    .join("; ");
}

/** Canonicalize a `style` attribute value; "" when nothing parses. */
export function normalizeStyleAttr(text: string): string {
  return serializeDeclarations(parseDeclarations(text));
}

function lineAt(text: string, index: number, baseLine: number): number {
  let line = baseLine;
  for (let i = 0; i < index && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) line++;
  }
  return line;
}

/**
 * Parse a `<style>` block. At-rules with bodies (`@media`, `@supports`)
 * are flattened: inner selectors are prefixed with the at-rule prelude.
 * `@import` lines are surfaced separately because mail clients drop them.
 */
export function parseStylesheet(text: string, baseLine = 1): Stylesheet {
  const rules: StyleRule[] = [];
  const imports: { url: string; line: number }[] = [];

  const scan = (chunk: string, offset: number, prefix: string): void => {
    let i = 0;
    while (i < chunk.length) {
      // Skip whitespace and comments between rules.
      while (i < chunk.length && /[ \t\r\n\f]/.test(chunk[i]!)) i++;
      if (chunk.startsWith("/*", i)) {
        const end = chunk.indexOf("*/", i + 2);
        i = end === -1 ? chunk.length : end + 2;
        continue;
      }
      if (i >= chunk.length) break;

      // Statement at-rules end at `;` (e.g. @import, @charset).
      if (chunk[i] === "@") {
        const semi = chunk.indexOf(";", i);
        const brace = chunk.indexOf("{", i);
        if (brace === -1 || (semi !== -1 && semi < brace)) {
          const end = semi === -1 ? chunk.length : semi;
          const statement = collapse(chunk.slice(i, end));
          const match = /^@import\s+(?:url\(\s*)?["']?([^"')]+)/i.exec(statement);
          if (match) {
            imports.push({ url: match[1]!.trim(), line: lineAt(text, offset + i, baseLine) });
          }
          i = end + 1;
          continue;
        }
      }

      const brace = chunk.indexOf("{", i);
      if (brace === -1) break; // trailing garbage without a body
      const selector = collapse(chunk.slice(i, brace));
      const selectorLine = lineAt(text, offset + i, baseLine);

      // Find the matching close brace, tracking nesting for at-rules.
      let depth = 1;
      let j = brace + 1;
      while (j < chunk.length && depth > 0) {
        if (chunk[j] === "{") depth++;
        else if (chunk[j] === "}") depth--;
        j++;
      }
      const body = chunk.slice(brace + 1, depth === 0 ? j - 1 : j);
      if (selector.startsWith("@")) {
        const qualified = prefix === "" ? selector : `${prefix} ${selector}`;
        scan(body, offset + brace + 1, qualified);
      } else if (selector !== "") {
        const full = prefix === "" ? selector : `${prefix} :: ${selector}`;
        const declarations = parseDeclarations(body.replace(/\/\*[\s\S]*?\*\//g, " "));
        rules.push({ selector: full, declarations, line: selectorLine });
      }
      i = j;
    }
  };

  scan(text, 0, "");
  return { rules, imports };
}

/**
 * Serialize a stylesheet in canonical one-rule-per-line form, used when
 * normalizing `<style>` blocks for snapshots.
 */
export function serializeStylesheet(sheet: Stylesheet): string[] {
  const lines: string[] = [];
  for (const imp of sheet.imports) {
    lines.push(`@import "${imp.url}";`);
  }
  for (const rule of sheet.rules) {
    lines.push(`${rule.selector} { ${serializeDeclarations(rule.declarations)} }`);
  }
  return lines;
}
