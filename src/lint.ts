/**
 * The lint engine: builds one context (parsed document, flattened
 * elements, every CSS declaration with its source line) and runs the
 * rule catalog over it. Rules never re-parse; they read the context.
 */
import { allElements, parseHtml } from "./html.js";
import { parseDeclarations, parseStylesheet } from "./css.js";
import { RULES } from "./rules.js";
import type { DeclarationSite, LintContext, Rule } from "./rules.js";
import type { EmailMessage, Finding } from "./types.js";

export interface LintOptions {
  /** Rule ids to skip. */
  disable?: string[];
  /** When set, only findings affecting one of these clients are kept. */
  clients?: string[];
  /** Provided when linting an .eml, enables message-level rules. */
  message?: EmailMessage | null;
}

/** Build the shared lint context for one HTML part. */
export function buildContext(html: string, message: EmailMessage | null = null): LintContext {
  const document = parseHtml(html);
  const elements = allElements(document);
  const declarations: DeclarationSite[] = [];
  const imports: { url: string; line: number }[] = [];

  for (const el of elements) {
    const style = el.attrs.find((a) => a.name === "style");
    if (style !== undefined && style.value !== null) {
      for (const declaration of parseDeclarations(style.value)) {
        declarations.push({ declaration, line: style.line, where: "inline" });
      }
    }
    if (el.tag === "style") {
      const raw = el.children.map((c) => (c.kind === "text" ? c.text : "")).join("");
      const sheet = parseStylesheet(raw, el.line);
      for (const rule of sheet.rules) {
        for (const declaration of rule.declarations) {
          declarations.push({ declaration, line: rule.line, where: rule.selector });
        }
      }
      imports.push(...sheet.imports);
    }
  }
  return { document, rawHtml: html, elements, declarations, imports, message };
}

function clientMatches(rule: Rule, wanted: string[]): boolean {
  if (rule.clients.includes("all")) return true;
  return rule.clients.some((c) => wanted.includes(c));
}

/** Run every enabled rule over the HTML; findings sorted by line. */
export function lintHtml(html: string, options: LintOptions = {}): Finding[] {
  const disable = new Set(options.disable ?? []);
  const ctx = buildContext(html, options.message ?? null);
  const findings: Finding[] = [];
  for (const rule of RULES) {
    if (disable.has(rule.id)) continue;
    if (options.clients !== undefined && options.clients.length > 0 &&
      !clientMatches(rule, options.clients)) continue;
    for (const hit of rule.check(ctx)) {
      findings.push({
        rule: rule.id,
        severity: rule.severity,
        line: hit.line,
        message: hit.message,
        clients: rule.clients,
      });
    }
  }
  findings.sort((a, b) => a.line - b.line || (a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0));
  return findings;
}
