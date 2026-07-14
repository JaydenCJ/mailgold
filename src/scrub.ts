/**
 * Volatile-value scrubbing. Transactional email embeds per-send values —
 * signed unsubscribe tokens, campaign IDs, tracking parameters, inline
 * attachment content-IDs — that change on every render and would make a
 * naive snapshot fail forever. Scrubbing rewrites the *value* to `*`
 * while keeping the parameter name, so a snapshot still asserts that the
 * unsubscribe link carries a token without pinning which token.
 */

/**
 * Query parameters whose values are scrubbed by default. `*` at the end
 * of a name is a prefix glob (`utm_*` matches `utm_source`).
 */
export const DEFAULT_SCRUB_PARAMS: string[] = [
  "utm_*",
  "mc_cid",
  "mc_eid",
  "token",
  "sig",
  "signature",
  "hash",
  "code",
  "nonce",
  "ts",
  "timestamp",
  "mid",
  "uid",
  "eid",
  "email",
];

function matchesParam(name: string, patterns: string[]): boolean {
  const lower = name.toLowerCase();
  for (const pattern of patterns) {
    if (pattern.endsWith("*")) {
      if (lower.startsWith(pattern.slice(0, -1).toLowerCase())) return true;
    } else if (lower === pattern.toLowerCase()) {
      return true;
    }
  }
  return false;
}

/**
 * Scrub one URL by string surgery — no URL constructor, so relative and
 * scheme-less values survive unchanged. `cid:` URLs (inline attachments)
 * are per-send and collapse to `cid:*` entirely.
 */
export function scrubUrl(url: string, patterns: string[]): string {
  if (patterns.length === 0) return url;
  if (/^cid:/i.test(url)) return "cid:*";
  const hashIndex = url.indexOf("#");
  const fragment = hashIndex === -1 ? "" : url.slice(hashIndex);
  const base = hashIndex === -1 ? url : url.slice(0, hashIndex);
  const qIndex = base.indexOf("?");
  if (qIndex === -1) return url;
  const path = base.slice(0, qIndex);
  const query = base.slice(qIndex + 1);
  const scrubbed = query.split("&").map((pair) => {
    const eq = pair.indexOf("=");
    if (eq === -1) return pair;
    const name = pair.slice(0, eq);
    return matchesParam(name, patterns) ? `${name}=*` : pair;
  });
  return `${path}?${scrubbed.join("&")}${fragment}`;
}

/** Scrub every http(s) URL found in a block of plain text. */
export function scrubTextUrls(text: string, patterns: string[]): string {
  if (patterns.length === 0) return text;
  return text.replace(/https?:\/\/[^\s<>"')\]]+/g, (url) => scrubUrl(url, patterns));
}
