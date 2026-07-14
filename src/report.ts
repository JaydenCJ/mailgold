/**
 * Human- and machine-readable output for lint runs. Text output is one
 * finding per line in `file:line  severity  rule  message  [clients]`
 * form (grep-able, editor-clickable); `--json` emits a stable structure
 * for CI annotation.
 */
import type { Finding } from "./types.js";

export interface LintCounts {
  errors: number;
  warnings: number;
}

export function countFindings(findings: Finding[]): LintCounts {
  let errors = 0;
  let warnings = 0;
  for (const f of findings) {
    if (f.severity === "error") errors++;
    else warnings++;
  }
  return { errors, warnings };
}

/** Format findings for one file as text lines. */
export function formatFindings(file: string, findings: Finding[]): string[] {
  const out: string[] = [];
  for (const f of findings) {
    const sev = f.severity === "error" ? "error" : "warn ";
    out.push(`${file}:${f.line}  ${sev}  ${f.rule}  ${f.message}  [${f.clients.join(", ")}]`);
  }
  return out;
}

/** One-line summary, e.g. `2 errors, 3 warnings`. */
export function formatSummary(counts: LintCounts): string {
  const parts: string[] = [];
  parts.push(`${counts.errors} error${counts.errors === 1 ? "" : "s"}`);
  parts.push(`${counts.warnings} warning${counts.warnings === 1 ? "" : "s"}`);
  return parts.join(", ");
}

/** Stable JSON payload for `lint --json`. */
export function toJsonReport(results: { file: string; findings: Finding[] }[]): string {
  const files = results.map(({ file, findings }) => ({
    file,
    counts: countFindings(findings),
    findings: findings.map((f) => ({
      rule: f.rule,
      severity: f.severity,
      line: f.line,
      message: f.message,
      clients: f.clients,
    })),
  }));
  const total = countFindings(results.flatMap((r) => r.findings));
  return JSON.stringify({ files, total }, null, 2);
}
