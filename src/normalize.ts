/**
 * Email-specific HTML normalization. The goal is a canonical text form
 * that is byte-identical across template-engine runs and cosmetic edits,
 * yet changes whenever the rendered email would actually change:
 *
 * - tags and attributes lowercased, attributes sorted, values quoted
 * - inline `style` and `<style>` blocks canonicalized (sorted, respaced)
 * - `class` lists sorted; whitespace in text collapsed
 * - entities decoded and minimally re-encoded (`&#160;` == `&nbsp;`)
 * - volatile query parameters and `cid:` URLs scrubbed to `*`
 * - regular comments dropped; MSO conditional comments KEPT verbatim —
 *   in email they are real markup that only Outlook renders
 */
import { parseHtml, VOID_ELEMENTS } from "./html.js";
import { normalizeStyleAttr, parseStylesheet, serializeStylesheet } from "./css.js";
import { decodeEntities, encodeAttr, encodeText } from "./entities.js";
import { DEFAULT_SCRUB_PARAMS, scrubUrl } from "./scrub.js";
import type { ElementNode, HtmlNode } from "./types.js";

export interface NormalizeOptions {
  /** Query parameter patterns to scrub; [] disables scrubbing. */
  scrubParams?: string[];
  /** Keep non-conditional comments (default: drop them). */
  keepComments?: boolean;
}

/** Attributes whose values are URLs and therefore scrub targets. */
const URL_ATTRS = new Set(["href", "src", "background", "poster", "action"]);

/** True for `[if mso]`-style conditional comments, which are markup. */
export function isConditionalComment(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.startsWith("[if") || trimmed.startsWith("<![endif]") ||
    trimmed.startsWith("[endif]") || trimmed.endsWith("<![endif]");
}

function collapseText(text: string): string {
  // Deliberately NOT \s: JS \s matches U+00A0, which must survive.
  return text.replace(/[ \t\r\n\f]+/g, " ").trim();
}

/**
 * Normalize an HTML email body to canonical lines. One node per line,
 * two-space indentation — a shape chosen so unified diffs point at the
 * exact element that changed.
 */
export function normalizeHtml(html: string, options: NormalizeOptions = {}): string[] {
  const scrub = options.scrubParams ?? DEFAULT_SCRUB_PARAMS;
  const doc = parseHtml(html);
  const out: string[] = [];

  const emitAttrs = (el: ElementNode): string => {
    const parts: string[] = [];
    const seen = new Set<string>();
    const sorted = [...el.attrs].sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    for (const attr of sorted) {
      if (seen.has(attr.name)) continue; // duplicate attrs: first one wins
      seen.add(attr.name);
      if (attr.value === null) {
        parts.push(attr.name);
        continue;
      }
      let value = decodeEntities(attr.value);
      if (attr.name === "style") {
        value = normalizeStyleAttr(value);
      } else if (attr.name === "class") {
        value = value.split(/[ \t\r\n\f]+/).filter((c) => c !== "").sort().join(" ");
      } else if (URL_ATTRS.has(attr.name)) {
        value = scrubUrl(collapseText(value), scrub);
      } else {
        value = collapseText(value);
      }
      parts.push(`${attr.name}="${encodeAttr(value)}"`);
    }
    return parts.length === 0 ? "" : " " + parts.join(" ");
  };

  const emit = (node: HtmlNode, depth: number): void => {
    const indent = "  ".repeat(depth);
    switch (node.kind) {
      case "doctype": {
        const body = collapseText(node.text).replace(/^doctype/i, "DOCTYPE");
        out.push(`${indent}<!${body}>`);
        return;
      }
      case "comment": {
        if (isConditionalComment(node.text)) {
          out.push(`${indent}<!--${collapseText(node.text)}-->`);
        } else if (options.keepComments) {
          out.push(`${indent}<!-- ${collapseText(node.text)} -->`);
        }
        return;
      }
      case "text": {
        const text = collapseText(decodeEntities(node.text));
        if (text !== "") out.push(`${indent}${encodeText(text)}`);
        return;
      }
      case "element": {
        const attrs = emitAttrs(node);
        if (VOID_ELEMENTS.has(node.tag) || node.selfClosing) {
          out.push(`${indent}<${node.tag}${attrs} />`);
          return;
        }
        if (node.tag === "style") {
          out.push(`${indent}<style${attrs}>`);
          const raw = node.children.map((c) => (c.kind === "text" ? c.text : "")).join("");
          for (const line of serializeStylesheet(parseStylesheet(raw))) {
            out.push(`${indent}  ${line}`);
          }
          out.push(`${indent}</style>`);
          return;
        }
        if (node.tag === "script") {
          // Scripts never execute in mail clients (and lint flags them);
          // keep the content verbatim so its presence stays visible.
          out.push(`${indent}<script${attrs}>`);
          const raw = node.children.map((c) => (c.kind === "text" ? c.text : "")).join("");
          const trimmed = raw.trim();
          if (trimmed !== "") out.push(`${indent}  ${trimmed.replace(/\r?\n/g, " ")}`);
          out.push(`${indent}</script>`);
          return;
        }
        if (node.children.length === 0) {
          out.push(`${indent}<${node.tag}${attrs}></${node.tag}>`);
          return;
        }
        out.push(`${indent}<${node.tag}${attrs}>`);
        for (const child of node.children) emit(child, depth + 1);
        out.push(`${indent}</${node.tag}>`);
        return;
      }
    }
  };

  for (const node of doc.children) emit(node, 0);
  return out;
}
