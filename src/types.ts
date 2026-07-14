/**
 * Shared types for the mailgold pipeline. Every stage is a pure function
 * over these structures; only the CLI touches the filesystem.
 */

/** One attribute on an element, with the source line it starts on. */
export interface Attr {
  name: string;
  /** `null` for boolean attributes written without a value. */
  value: string | null;
  line: number;
}

export interface ElementNode {
  kind: "element";
  /** Lowercased tag name. */
  tag: string;
  attrs: Attr[];
  children: HtmlNode[];
  line: number;
  /** True when the source wrote `<tag ... />`. */
  selfClosing: boolean;
}

export interface TextNode {
  kind: "text";
  /** Raw text, entities still encoded. */
  text: string;
  line: number;
}

export interface CommentNode {
  kind: "comment";
  /** Content between `<!--` and `-->`, verbatim. */
  text: string;
  line: number;
}

export interface DoctypeNode {
  kind: "doctype";
  /** Content between `<!` and `>`, verbatim. */
  text: string;
  line: number;
}

export type HtmlNode = ElementNode | TextNode | CommentNode | DoctypeNode;

export interface HtmlDocument {
  kind: "document";
  children: HtmlNode[];
}

/** One CSS declaration, e.g. `padding: 0 10px`. */
export interface Declaration {
  /** Lowercased property name. */
  property: string;
  /** Value with collapsed whitespace; `!important` stripped into the flag. */
  value: string;
  important: boolean;
}

/** One rule from a `<style>` block. */
export interface StyleRule {
  /** Selector with collapsed whitespace; nested at-rules are prefixed. */
  selector: string;
  declarations: Declaration[];
  line: number;
}

export interface Stylesheet {
  rules: StyleRule[];
  /** `@import` targets, which most mail clients ignore. */
  imports: { url: string; line: number }[];
}

/** Severity of a lint rule: `error` breaks rendering, `warn` degrades it. */
export type Severity = "error" | "warn";

/** One lint finding, anchored to a source line. */
export interface Finding {
  rule: string;
  severity: Severity;
  line: number;
  message: string;
  /** Client families affected, e.g. `["outlook"]`. */
  clients: string[];
}

/** A parsed RFC 5322 message (only the parts mailgold cares about). */
export interface EmailMessage {
  headers: { name: string; value: string }[];
  subject: string | null;
  /** Decoded `text/html` part, if present. */
  html: string | null;
  /** Decoded `text/plain` part, if present. */
  text: string | null;
  /** Content types of every leaf part, in document order. */
  partTypes: string[];
}

/** A stored snapshot: the normalized HTML and text parts of one message. */
export interface Snapshot {
  name: string;
  /** Source path as given at record time, relative to the working directory. */
  source: string;
  kind: "html" | "eml";
  /** Volatile query parameters scrubbed at record time (empty = keep all). */
  scrub: string[];
  /** For html-kind snapshots, the text file paired via `--text` at record time. */
  textSource?: string;
  /** True when recorded with `--keep-comments`. */
  keepComments?: boolean;
  htmlLines: string[];
  /** `null` when the message has no text part. */
  textLines: string[] | null;
}
