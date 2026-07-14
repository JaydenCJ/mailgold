/**
 * A small, forgiving HTML parser tuned for email markup. Email HTML is
 * table soup with unclosed cells, uppercase tags and conditional
 * comments; a spec-complete parser is overkill and a strict one would
 * reject half of production templates. This one never throws: it
 * tokenizes what it can, auto-closes the table/list elements that email
 * templates habitually leave open, and tracks the source line of every
 * node so lint findings and diffs can point at real lines.
 */
import type { Attr, ElementNode, HtmlDocument, HtmlNode } from "./types.js";

/** Elements that never have children (HTML void elements). */
export const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

/** Elements whose content is raw text until the matching close tag. */
const RAW_TEXT_ELEMENTS = new Set(["style", "script", "textarea", "title"]);

/**
 * Opening one of these implicitly closes any of the listed open tags.
 * Covers the omissions that real templates actually contain.
 */
const AUTO_CLOSE: Record<string, string[]> = {
  p: ["p"],
  li: ["li"],
  option: ["option"],
  td: ["td", "th"],
  th: ["td", "th"],
  tr: ["tr", "td", "th"],
  tbody: ["tr", "td", "th", "tbody", "thead", "tfoot"],
  thead: ["tr", "td", "th", "tbody", "thead", "tfoot"],
  tfoot: ["tr", "td", "th", "tbody", "thead", "tfoot"],
};

interface Cursor {
  input: string;
  pos: number;
  line: number;
}

function countLines(cur: Cursor, from: number): void {
  for (let i = from; i < cur.pos; i++) {
    if (cur.input.charCodeAt(i) === 10) cur.line++;
  }
}

/** Advance to `index`, updating the line counter. */
function advanceTo(cur: Cursor, index: number): void {
  const from = cur.pos;
  cur.pos = index;
  countLines(cur, from);
}

function isSpace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f";
}

function isNameStart(ch: string): boolean {
  return /[a-zA-Z]/.test(ch);
}

/** Parse the attribute list of an open tag; leaves `cur` just past `>`. */
function parseAttrs(cur: Cursor): { attrs: Attr[]; selfClosing: boolean } {
  const { input } = cur;
  const attrs: Attr[] = [];
  let selfClosing = false;
  while (cur.pos < input.length) {
    while (cur.pos < input.length && isSpace(input[cur.pos]!)) {
      if (input[cur.pos] === "\n") cur.line++;
      cur.pos++;
    }
    const ch = input[cur.pos];
    if (ch === undefined) break;
    if (ch === ">") {
      cur.pos++;
      break;
    }
    if (ch === "/") {
      cur.pos++;
      if (input[cur.pos] === ">") {
        cur.pos++;
        selfClosing = true;
        break;
      }
      continue; // stray slash — skip it, like browsers do
    }
    // Attribute name: everything up to whitespace, `=`, `/` or `>`.
    const nameStart = cur.pos;
    const nameLine = cur.line;
    while (cur.pos < input.length && !isSpace(input[cur.pos]!) &&
      input[cur.pos] !== "=" && input[cur.pos] !== ">" && input[cur.pos] !== "/") {
      cur.pos++;
    }
    const name = input.slice(nameStart, cur.pos).toLowerCase();
    if (name === "") { cur.pos++; continue; }
    while (cur.pos < input.length && isSpace(input[cur.pos]!)) {
      if (input[cur.pos] === "\n") cur.line++;
      cur.pos++;
    }
    if (input[cur.pos] !== "=") {
      attrs.push({ name, value: null, line: nameLine });
      continue;
    }
    cur.pos++; // consume '='
    while (cur.pos < input.length && isSpace(input[cur.pos]!)) {
      if (input[cur.pos] === "\n") cur.line++;
      cur.pos++;
    }
    const quote = input[cur.pos];
    let value: string;
    if (quote === '"' || quote === "'") {
      cur.pos++;
      const valStart = cur.pos;
      const end = input.indexOf(quote, cur.pos);
      const valEnd = end === -1 ? input.length : end;
      advanceTo(cur, valEnd);
      value = input.slice(valStart, valEnd);
      if (end !== -1) cur.pos++;
    } else {
      const valStart = cur.pos;
      while (cur.pos < input.length && !isSpace(input[cur.pos]!) && input[cur.pos] !== ">") {
        cur.pos++;
      }
      value = input.slice(valStart, cur.pos);
    }
    attrs.push({ name, value, line: nameLine });
  }
  return { attrs, selfClosing };
}

/**
 * Parse an HTML string into a document tree. Never throws; unparseable
 * constructs degrade to text nodes rather than aborting the document.
 */
export function parseHtml(input: string): HtmlDocument {
  const cur: Cursor = { input, pos: 0, line: 1 };
  const doc: HtmlDocument = { kind: "document", children: [] };
  const stack: ElementNode[] = [];

  const append = (node: HtmlNode): void => {
    const parent = stack[stack.length - 1];
    (parent ? parent.children : doc.children).push(node);
  };

  const flushText = (from: number, to: number, line: number): void => {
    if (to > from) append({ kind: "text", text: input.slice(from, to), line });
  };

  while (cur.pos < input.length) {
    const textStart = cur.pos;
    const textLine = cur.line;
    let lt = input.indexOf("<", cur.pos);
    if (lt === -1) lt = input.length;
    advanceTo(cur, lt);
    flushText(textStart, lt, textLine);
    if (cur.pos >= input.length) break;

    const nodeLine = cur.line;
    if (input.startsWith("<!--", cur.pos)) {
      const end = input.indexOf("-->", cur.pos + 4);
      const contentEnd = end === -1 ? input.length : end;
      const text = input.slice(cur.pos + 4, contentEnd);
      advanceTo(cur, end === -1 ? input.length : end + 3);
      append({ kind: "comment", text, line: nodeLine });
      continue;
    }
    if (input.startsWith("<!", cur.pos)) {
      const end = input.indexOf(">", cur.pos + 2);
      const contentEnd = end === -1 ? input.length : end;
      const text = input.slice(cur.pos + 2, contentEnd);
      advanceTo(cur, end === -1 ? input.length : end + 1);
      append({ kind: "doctype", text, line: nodeLine });
      continue;
    }
    if (input.startsWith("</", cur.pos)) {
      const end = input.indexOf(">", cur.pos + 2);
      const contentEnd = end === -1 ? input.length : end;
      const name = input.slice(cur.pos + 2, contentEnd).trim().toLowerCase();
      advanceTo(cur, end === -1 ? input.length : end + 1);
      // Pop to the matching open element; ignore stray close tags.
      let matchIndex = -1;
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i]!.tag === name) { matchIndex = i; break; }
      }
      if (matchIndex !== -1) stack.length = matchIndex;
      continue;
    }
    const next = input[cur.pos + 1];
    if (next === undefined || !isNameStart(next)) {
      // A bare `<` (e.g. "1 < 2") — treat it as text.
      append({ kind: "text", text: "<", line: nodeLine });
      cur.pos++;
      continue;
    }

    // Open tag.
    cur.pos++;
    const nameStart = cur.pos;
    while (cur.pos < input.length && !isSpace(input[cur.pos]!) &&
      input[cur.pos] !== ">" && input[cur.pos] !== "/") {
      cur.pos++;
    }
    const tag = input.slice(nameStart, cur.pos).toLowerCase();
    const { attrs, selfClosing } = parseAttrs(cur);

    const closers = AUTO_CLOSE[tag];
    if (closers) {
      while (stack.length > 0 && closers.includes(stack[stack.length - 1]!.tag)) {
        stack.pop();
      }
    }

    const element: ElementNode = {
      kind: "element", tag, attrs, children: [], line: nodeLine, selfClosing,
    };
    append(element);

    if (VOID_ELEMENTS.has(tag) || selfClosing) continue;

    if (RAW_TEXT_ELEMENTS.has(tag)) {
      // Consume raw text up to the matching close tag, case-insensitively.
      const closeRe = new RegExp(`</${tag}\\s*>`, "gi");
      closeRe.lastIndex = cur.pos;
      const match = closeRe.exec(input);
      const rawEnd = match ? match.index : input.length;
      const rawLine = cur.line;
      const raw = input.slice(cur.pos, rawEnd);
      advanceTo(cur, match ? match.index + match[0].length : input.length);
      if (raw !== "") element.children.push({ kind: "text", text: raw, line: rawLine });
      continue;
    }
    stack.push(element);
  }
  return doc;
}

/** Depth-first walk over every node in the document. */
export function walk(doc: HtmlDocument, visit: (node: HtmlNode, parent: ElementNode | null) => void): void {
  const descend = (nodes: HtmlNode[], parent: ElementNode | null): void => {
    for (const node of nodes) {
      visit(node, parent);
      if (node.kind === "element") descend(node.children, node);
    }
  };
  descend(doc.children, null);
}

/** All element nodes in document order. */
export function allElements(doc: HtmlDocument): ElementNode[] {
  const out: ElementNode[] = [];
  walk(doc, (node) => {
    if (node.kind === "element") out.push(node);
  });
  return out;
}

/**
 * Attribute lookup; `null` for valueless attributes, `undefined` when
 * absent. Names are lowercased at parse time, so pass a lowercase name.
 */
export function getAttr(el: ElementNode, name: string): string | null | undefined {
  const attr = el.attrs.find((a) => a.name === name);
  return attr === undefined ? undefined : attr.value;
}
