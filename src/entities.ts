/**
 * HTML entity handling for the normalizer. Templates encode the same
 * character three ways (`&nbsp;`, `&#160;`, `&#xA0;`); snapshots must
 * not diff on which spelling a template engine chose. Decode everything
 * to code points, then re-encode only the characters that must be
 * escaped — plus non-breaking space, which is kept visible as `&nbsp;`
 * so an invisible-but-meaningful character never hides in a diff.
 */

/** Named entities that appear in real email templates. */
const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
  copy: "©",
  reg: "®",
  trade: "™",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  bull: "•",
  middot: "·",
  times: "×",
  shy: "\u00ad",
  zwnj: "\u200c",
  zwj: "\u200d",
  euro: "€",
  pound: "£",
  yen: "¥",
  cent: "¢",
  sect: "§",
  deg: "°",
  laquo: "«",
  raquo: "»",
};

/** Decode named and numeric entities; unknown ones pass through intact. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isNaN(code) ? whole : safeFromCodePoint(code, whole);
    }
    if (body.startsWith("#")) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isNaN(code) ? whole : safeFromCodePoint(code, whole);
    }
    const named = NAMED[body];
    return named === undefined ? whole : named;
  });
}

function safeFromCodePoint(code: number, fallback: string): string {
  if (code <= 0 || code > 0x10ffff) return fallback;
  return String.fromCodePoint(code);
}

/** Encode text content: the minimum plus visible `&nbsp;`. */
export function encodeText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\u00a0/g, "&nbsp;");
}

/** Encode a double-quoted attribute value. */
export function encodeAttr(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\u00a0/g, "&nbsp;");
}
