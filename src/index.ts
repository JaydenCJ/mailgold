/**
 * Public programmatic API. Everything the CLI does is reachable here as
 * pure functions over strings — drop mailgold into any test runner:
 *
 *   import { normalizeHtml, lintHtml } from "mailgold";
 *   assert.deepEqual(normalizeHtml(render()), snapshotLines);
 */
export { parseHtml, allElements, walk, getAttr, VOID_ELEMENTS } from "./html.js";
export {
  parseDeclarations, serializeDeclarations, normalizeStyleAttr,
  parseStylesheet, serializeStylesheet,
} from "./css.js";
export { decodeEntities, encodeText, encodeAttr } from "./entities.js";
export { normalizeHtml, isConditionalComment } from "./normalize.js";
export type { NormalizeOptions } from "./normalize.js";
export { normalizeTextPart, extractUrls } from "./textpart.js";
export type { TextNormalizeOptions } from "./textpart.js";
export { scrubUrl, scrubTextUrls, DEFAULT_SCRUB_PARAMS } from "./scrub.js";
export { parseEml, parseHeaders, parseContentType, decodeQuotedPrintable, decodeEncodedWords, splitMultipart } from "./mime.js";
export { lintHtml, buildContext } from "./lint.js";
export type { LintOptions } from "./lint.js";
export { RULES, getRule, GMAIL_CLIP_BYTES } from "./rules.js";
export type { Rule, RuleHit, LintContext, DeclarationSite } from "./rules.js";
export { diffLines, unifiedDiff } from "./diff.js";
export type { DiffOp, UnifiedDiffOptions } from "./diff.js";
export {
  buildSnapshot, compareSnapshots, formatSnapshot, parseSnapshot,
  nameForSource, SnapshotStore, SnapshotError, SourceError,
  SNAPSHOT_HEADER, DEFAULT_STORE_DIR,
} from "./snapshot.js";
export type { BuildOptions, CheckResult } from "./snapshot.js";
export { countFindings, formatFindings, formatSummary, toJsonReport } from "./report.js";
export type { LintCounts } from "./report.js";
export type {
  Attr, ElementNode, TextNode, CommentNode, DoctypeNode, HtmlNode,
  HtmlDocument, Declaration, StyleRule, Stylesheet, Severity, Finding,
  EmailMessage, Snapshot,
} from "./types.js";
export { VERSION } from "./version.js";
