/**
 * Line diff for snapshot failures. A plain LCS diff with common
 * prefix/suffix trimming — snapshot bodies are at most a few thousand
 * lines, so quadratic-in-the-middle is fine and the implementation
 * stays obviously correct. Output is a git-style unified diff so
 * reviewers read failures with muscle memory.
 */

export type DiffOp =
  | { kind: "same"; text: string }
  | { kind: "del"; text: string }
  | { kind: "add"; text: string };

/** Compute the edit script turning `a` into `b`. */
export function diffLines(a: string[], b: string[]): DiffOp[] {
  // Trim common prefix and suffix — the typical snapshot failure is a
  // handful of changed lines in a large identical body.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const n = midA.length;
  const m = midB.length;

  // LCS lengths table (n+1 x m+1), flattened.
  const width = m + 1;
  const table = new Array<number>((n + 1) * width).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * width + j] = midA[i] === midB[j]
        ? table[(i + 1) * width + j + 1]! + 1
        : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!);
    }
  }

  const ops: DiffOp[] = [];
  for (let k = 0; k < start; k++) ops.push({ kind: "same", text: a[k]! });
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (midA[i] === midB[j]) {
      ops.push({ kind: "same", text: midA[i]! });
      i++;
      j++;
    } else if (table[(i + 1) * width + j]! >= table[i * width + j + 1]!) {
      ops.push({ kind: "del", text: midA[i]! });
      i++;
    } else {
      ops.push({ kind: "add", text: midB[j]! });
      j++;
    }
  }
  while (i < n) { ops.push({ kind: "del", text: midA[i]! }); i++; }
  while (j < m) { ops.push({ kind: "add", text: midB[j]! }); j++; }
  for (let k = endA; k < a.length; k++) ops.push({ kind: "same", text: a[k]! });
  return ops;
}

export interface UnifiedDiffOptions {
  context?: number;
  aLabel?: string;
  bLabel?: string;
}

/**
 * Render a unified diff with hunk headers. Returns "" when the inputs
 * are identical, so callers can gate on truthiness.
 */
export function unifiedDiff(a: string[], b: string[], options: UnifiedDiffOptions = {}): string {
  const context = options.context ?? 3;
  const ops = diffLines(a, b);

  // Absolute 1-based line numbers each op starts at, in a and b.
  const positions: { aLine: number; bLine: number }[] = [];
  let aLine = 1;
  let bLine = 1;
  for (const op of ops) {
    positions.push({ aLine, bLine });
    if (op.kind === "same") { aLine++; bLine++; }
    else if (op.kind === "del") aLine++;
    else bLine++;
  }

  const changeIndexes: number[] = [];
  for (let k = 0; k < ops.length; k++) {
    if (ops[k]!.kind !== "same") changeIndexes.push(k);
  }
  if (changeIndexes.length === 0) return "";

  // Group changes whose context windows would touch into one hunk.
  const groups: [number, number][] = [];
  let groupStart = changeIndexes[0]!;
  let groupEnd = changeIndexes[0]!;
  for (const idx of changeIndexes.slice(1)) {
    if (idx - groupEnd <= context * 2) {
      groupEnd = idx;
    } else {
      groups.push([groupStart, groupEnd]);
      groupStart = idx;
      groupEnd = idx;
    }
  }
  groups.push([groupStart, groupEnd]);

  const out: string[] = [];
  out.push(`--- ${options.aLabel ?? "expected"}`);
  out.push(`+++ ${options.bLabel ?? "actual"}`);
  for (const [first, last] of groups) {
    const from = Math.max(0, first - context);
    const to = Math.min(ops.length - 1, last + context);
    let aCount = 0;
    let bCount = 0;
    const lines: string[] = [];
    for (let k = from; k <= to; k++) {
      const op = ops[k]!;
      if (op.kind === "same") {
        lines.push(` ${op.text}`);
        aCount++;
        bCount++;
      } else if (op.kind === "del") {
        lines.push(`-${op.text}`);
        aCount++;
      } else {
        lines.push(`+${op.text}`);
        bCount++;
      }
    }
    const pos = positions[from]!;
    out.push(`@@ -${pos.aLine},${aCount} +${pos.bLine},${bCount} @@`);
    out.push(...lines);
  }
  return out.join("\n");
}
