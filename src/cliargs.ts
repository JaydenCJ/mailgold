/**
 * Tiny declarative argv parser. Flags are declared per command so a
 * typo (`--updtae`) is a hard usage error (exit 2), never silently
 * ignored — snapshot tools that ignore flags re-bless bad output.
 */

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

export interface FlagSpec {
  /** Flags that take a value, e.g. `--dir`. */
  value: string[];
  /** Boolean flags, e.g. `--update`. */
  boolean: string[];
}

export interface ParsedArgs {
  positional: string[];
  values: Record<string, string>;
  booleans: Set<string>;
}

/** Parse argv (already stripped of node + script) against a spec. */
export function parseArgs(argv: string[], spec: FlagSpec): ParsedArgs {
  const positional: string[] = [];
  const values: Record<string, string> = {};
  const booleans = new Set<string>();
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i]!;
    if (arg === "--") {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (!arg.startsWith("--")) {
      positional.push(arg);
      i++;
      continue;
    }
    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg : arg.slice(0, eq);
    if (spec.boolean.includes(name)) {
      if (eq !== -1) throw new UsageError(`${name} does not take a value`);
      booleans.add(name.slice(2));
      i++;
      continue;
    }
    if (spec.value.includes(name)) {
      let value: string;
      if (eq !== -1) {
        value = arg.slice(eq + 1);
      } else {
        const next = argv[i + 1];
        if (next === undefined) throw new UsageError(`${name} requires a value`);
        value = next;
        i++;
      }
      values[name.slice(2)] = value;
      i++;
      continue;
    }
    throw new UsageError(`unknown flag ${name}`);
  }
  return { positional, values, booleans };
}

/** Split a comma-separated list flag, dropping empty entries. */
export function splitList(value: string): string[] {
  return value.split(",").map((s) => s.trim()).filter((s) => s !== "");
}
