/**
 * The client-quirk rule catalog. Every rule encodes one documented,
 * long-stable rendering limitation of a major mail client — most of
 * them Outlook on Windows, which renders HTML with the Word engine and
 * ignores large parts of CSS. Severity semantics: `error` means the
 * construct visibly breaks or is stripped in an affected client;
 * `warn` means it silently degrades (a rounded corner turns square).
 *
 * Rules are deliberately conservative: each anchors on a concrete
 * construct, never on heuristics, so a finding is always actionable.
 */
import type { Declaration, ElementNode, EmailMessage, HtmlDocument, Severity } from "./types.js";

/** Where a CSS declaration was found. */
export interface DeclarationSite {
  declaration: Declaration;
  line: number;
  /** "inline" for a style attribute, otherwise the <style> selector. */
  where: string;
}

/** Everything a rule may inspect; built once per lint run. */
export interface LintContext {
  document: HtmlDocument;
  rawHtml: string;
  elements: ElementNode[];
  declarations: DeclarationSite[];
  imports: { url: string; line: number }[];
  /** Present when linting an `.eml`; enables message-level rules. */
  message: EmailMessage | null;
}

export interface RuleHit {
  line: number;
  message: string;
}

export interface Rule {
  id: string;
  severity: Severity;
  clients: string[];
  summary: string;
  check(ctx: LintContext): RuleHit[];
}

/** Gmail clips messages larger than this many bytes. */
export const GMAIL_CLIP_BYTES = 102 * 1024;

function attr(el: ElementNode, name: string): string | null | undefined {
  const found = el.attrs.find((a) => a.name === name);
  return found === undefined ? undefined : found.value;
}

/** Build a rule that fires on matching CSS declarations anywhere. */
function cssRule(
  id: string,
  severity: Severity,
  clients: string[],
  summary: string,
  test: (d: Declaration) => string | null,
): Rule {
  return {
    id,
    severity,
    clients,
    summary,
    check(ctx) {
      const hits: RuleHit[] = [];
      for (const site of ctx.declarations) {
        const detail = test(site.declaration);
        if (detail !== null) {
          const where = site.where === "inline" ? "" : ` (in <style> rule \`${site.where}\`)`;
          hits.push({ line: site.line, message: `${detail}${where}` });
        }
      }
      return hits;
    },
  };
}

/** Build a rule that fires on elements with a given tag. */
function tagRule(
  id: string,
  severity: Severity,
  clients: string[],
  summary: string,
  tags: string[],
  message: (el: ElementNode) => string | null,
): Rule {
  return {
    id,
    severity,
    clients,
    summary,
    check(ctx) {
      const hits: RuleHit[] = [];
      for (const el of ctx.elements) {
        if (!tags.includes(el.tag)) continue;
        const detail = message(el);
        if (detail !== null) hits.push({ line: el.line, message: detail });
      }
      return hits;
    },
  };
}

export const RULES: Rule[] = [
  tagRule(
    "no-script", "error", ["all"],
    "<script> is stripped by every mail client",
    ["script"],
    () => "<script> is removed by all mail clients; move logic to the click-through page",
  ),
  tagRule(
    "no-form-elements", "error", ["outlook", "gmail"],
    "form controls are stripped or inert in most clients",
    ["form", "input", "textarea", "select"],
    (el) => `<${el.tag}> is stripped or non-functional in Outlook and Gmail; link to a hosted form instead`,
  ),
  tagRule(
    "no-button", "error", ["outlook"],
    "<button> does not render in Outlook",
    ["button"],
    () => "<button> is not rendered by Outlook; use a padded <a> inside a table cell (a \"bulletproof button\")",
  ),
  tagRule(
    "no-external-stylesheet", "error", ["gmail", "outlook"],
    "linked stylesheets are never fetched",
    ["link"],
    (el) => {
      const rel = (attr(el, "rel") ?? "").toLowerCase();
      return rel === "stylesheet"
        ? "<link rel=\"stylesheet\"> is ignored by Gmail and Outlook; inline the CSS"
        : null;
    },
  ),
  {
    id: "no-external-stylesheet-import",
    severity: "error",
    clients: ["gmail", "outlook"],
    summary: "@import in <style> is never fetched",
    check(ctx) {
      return ctx.imports.map((imp) => ({
        line: imp.line,
        message: `@import "${imp.url}" is ignored by Gmail and Outlook; inline the CSS`,
      }));
    },
  },
  {
    id: "no-javascript-url",
    severity: "error",
    clients: ["all"],
    summary: "javascript: URLs are blocked and flag spam filters",
    check(ctx) {
      const hits: RuleHit[] = [];
      for (const el of ctx.elements) {
        for (const a of el.attrs) {
          if ((a.name === "href" || a.name === "src") &&
            a.value !== null && /^\s*javascript:/i.test(a.value)) {
            hits.push({ line: a.line, message: `${a.name}="javascript:..." is blocked by mail clients and trips spam filters` });
          }
        }
      }
      return hits;
    },
  },
  cssRule(
    "no-css-flexbox", "error", ["outlook", "windows-mail"],
    "flexbox and grid do not exist in the Word rendering engine",
    (d) => d.property === "display" && /\b(flex|inline-flex|grid|inline-grid)\b/.test(d.value)
      ? `display: ${d.value} is ignored by Outlook (Word engine); build the layout with nested tables`
      : null,
  ),
  cssRule(
    "no-css-position", "error", ["outlook", "gmail"],
    "positioned layout is unsupported",
    (d) => d.property === "position" && /\b(absolute|fixed|sticky)\b/i.test(d.value)
      ? `position: ${d.value} is unsupported in Outlook and stripped by Gmail; content will render in flow`
      : null,
  ),
  cssRule(
    "no-css-variables", "error", ["outlook", "gmail"],
    "CSS custom properties are unsupported",
    (d) => d.value.includes("var(--") || d.property.startsWith("--")
      ? "CSS variables are unsupported in Outlook and Gmail; resolve them to literal values at build time"
      : null,
  ),
  cssRule(
    "no-viewport-units", "error", ["outlook"],
    "vw/vh units are unsupported",
    (d) => /(^|[\s(,])-?[\d.]+v(w|h|min|max)\b/i.test(d.value)
      ? `viewport units in "${d.property}: ${d.value}" are unsupported in Outlook; use percentages or fixed pixels`
      : null,
  ),
  {
    id: "gmail-size-clip",
    severity: "error",
    clients: ["gmail"],
    summary: "Gmail clips messages over 102 KB",
    check(ctx) {
      const size = Buffer.byteLength(ctx.rawHtml, "utf8");
      return size > GMAIL_CLIP_BYTES
        ? [{ line: 1, message: `HTML part is ${size} bytes; Gmail clips messages over ${GMAIL_CLIP_BYTES} (hiding content and the unsubscribe link)` }]
        : [];
    },
  },
  tagRule(
    "img-missing-dimensions", "error", ["outlook"],
    "images without width/height render at natural size in Outlook",
    ["img"],
    (el) => {
      const width = attr(el, "width");
      const height = attr(el, "height");
      if (width !== undefined && height !== undefined) return null;
      const missing = width === undefined && height === undefined
        ? "width and height attributes"
        : width === undefined ? "a width attribute" : "a height attribute";
      return `<img> without ${missing} renders at natural size in Outlook and breaks the layout when the image is blocked`;
    },
  ),
  cssRule(
    "no-background-image", "warn", ["outlook"],
    "CSS background images need a VML fallback in Outlook",
    (d) => (d.property === "background-image" && d.value.includes("url(")) ||
      (d.property === "background" && d.value.includes("url("))
      ? "CSS background images are not painted by Outlook; provide a VML fallback or a solid background-color"
      : null,
  ),
  cssRule(
    "no-max-width", "warn", ["outlook"],
    "max-width has no effect in Outlook desktop",
    (d) => d.property === "max-width"
      ? "max-width has no effect in Outlook desktop; constrain width with a fixed-width table (optionally inside [if mso])"
      : null,
  ),
  cssRule(
    "no-border-radius", "warn", ["outlook"],
    "border-radius is ignored by Outlook",
    (d) => d.property.startsWith("border") && d.property.includes("radius")
      ? "border-radius is ignored by Outlook; corners render square there"
      : null,
  ),
  cssRule(
    "no-css-float", "warn", ["outlook"],
    "float is unsupported in Outlook",
    (d) => d.property === "float"
      ? `float: ${d.value} is unsupported in Outlook; use align attributes or table columns`
      : null,
  ),
  cssRule(
    "outlook-com-margin", "warn", ["outlook-web"],
    "Outlook.com strips margin properties",
    // A pure `margin: 0` reset is safe — there is nothing to strip.
    (d) => (d.property === "margin" || d.property.startsWith("margin-")) && /[1-9]/.test(d.value)
      ? `${d.property}: ${d.value} is stripped by Outlook.com; use padding on a wrapping table cell for spacing that must survive`
      : null,
  ),
  {
    id: "padding-on-div",
    severity: "warn",
    clients: ["outlook"],
    summary: "padding on div/p is unreliable in Outlook",
    check(ctx) {
      const hits: RuleHit[] = [];
      for (const el of ctx.elements) {
        if (el.tag !== "div" && el.tag !== "p") continue;
        const style = attr(el, "style");
        if (typeof style !== "string") continue;
        if (/(^|;)\s*padding(-[a-z]+)?\s*:/i.test(style)) {
          hits.push({ line: el.line, message: `padding on <${el.tag}> is applied inconsistently by Outlook; pad a <td> instead` });
        }
      }
      return hits;
    },
  },
  tagRule(
    "img-missing-alt", "warn", ["all"],
    "images need alt text for blocked-image and screen-reader rendering",
    ["img"],
    (el) => attr(el, "alt") === undefined
      ? "<img> without alt text shows a broken box while images are blocked (the default in Outlook) and is invisible to screen readers"
      : null,
  ),
  tagRule(
    "no-srcset", "warn", ["outlook", "gmail"],
    "srcset/sizes are ignored; only src is fetched",
    ["img", "source"],
    (el) => attr(el, "srcset") !== undefined
      ? "srcset is ignored by Outlook and most Gmail surfaces; make src the universally correct image"
      : null,
  ),
  {
    id: "style-in-body",
    severity: "warn",
    clients: ["gmail"],
    summary: "<style> outside <head> is dropped by some Gmail surfaces",
    check(ctx) {
      const hits: RuleHit[] = [];
      let inBody = false;
      const visit = (nodes: typeof ctx.document.children): void => {
        for (const node of nodes) {
          if (node.kind !== "element") continue;
          if (node.tag === "body") {
            inBody = true;
            visit(node.children);
            inBody = false;
            continue;
          }
          if (node.tag === "style" && inBody) {
            hits.push({ line: node.line, message: "<style> inside <body> is dropped by some Gmail surfaces; move it to <head> and inline critical CSS" });
          }
          visit(node.children);
        }
      };
      visit(ctx.document.children);
      return hits;
    },
  },
  {
    id: "shorthand-hex-color",
    severity: "warn",
    clients: ["outlook"],
    summary: "3-digit hex colors misrender in older Outlook versions",
    check(ctx) {
      const hits: RuleHit[] = [];
      for (const site of ctx.declarations) {
        const match = /#([0-9a-fA-F]{3})(?![0-9a-fA-F])/.exec(site.declaration.value);
        if (match) {
          hits.push({ line: site.line, message: `shorthand hex color #${match[1]} misrenders in older Outlook versions; write the six-digit form` });
        }
      }
      for (const el of ctx.elements) {
        for (const a of el.attrs) {
          if (a.name !== "bgcolor" && a.name !== "color") continue;
          if (a.value !== null && /^#[0-9a-fA-F]{3}$/.test(a.value.trim())) {
            hits.push({ line: a.line, message: `shorthand hex color ${a.value.trim()} misrenders in older Outlook versions; write the six-digit form` });
          }
        }
      }
      return hits;
    },
  },
  cssRule(
    "no-rem-units", "warn", ["outlook"],
    "rem units are unsupported in Outlook",
    (d) => /(^|[\s(,])-?[\d.]+rem\b/i.test(d.value)
      ? `rem units in "${d.property}: ${d.value}" are unsupported in Outlook; use px`
      : null,
  ),
  tagRule(
    "table-missing-presentation-role", "warn", ["all"],
    "layout tables should declare role=\"presentation\"",
    ["table"],
    (el) => attr(el, "role") === undefined
      ? "layout <table> without role=\"presentation\" is announced as a data table by screen readers"
      : null,
  ),
  {
    id: "missing-text-part",
    severity: "warn",
    clients: ["all"],
    summary: "HTML-only messages hurt deliverability and accessibility",
    check(ctx) {
      if (ctx.message === null) return [];
      if (ctx.message.html !== null && ctx.message.text === null) {
        return [{ line: 1, message: "message has a text/html part but no text/plain alternative; spam filters and text-only clients penalize this" }];
      }
      return [];
    },
  },
];

/** Look up a rule by id. */
export function getRule(id: string): Rule | undefined {
  return RULES.find((r) => r.id === id);
}
