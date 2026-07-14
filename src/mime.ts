/**
 * A minimal RFC 5322 / MIME reader for `.eml` files: enough to pull the
 * `text/html` and `text/plain` parts out of a real transactional
 * message. Handles folded headers, nested multiparts
 * (`alternative`/`mixed`/`related`), quoted-printable and base64
 * transfer encodings, UTF-8 and Latin-1 charsets, and RFC 2047 encoded
 * words in the subject. It is a reader, not a validator: unknown
 * structures are skipped, never fatal.
 */
import type { EmailMessage } from "./types.js";

interface Header {
  name: string;
  value: string;
}

/** Split a raw message into headers and body at the first blank line. */
function splitHeadersBody(raw: string): { headerText: string; body: string } {
  const match = /\r?\n\r?\n/.exec(raw);
  if (!match) return { headerText: raw, body: "" };
  return {
    headerText: raw.slice(0, match.index),
    body: raw.slice(match.index + match[0].length),
  };
}

/** Parse headers, unfolding continuation lines (RFC 5322 §2.2.3). */
export function parseHeaders(headerText: string): Header[] {
  const headers: Header[] = [];
  for (const line of headerText.split(/\r?\n/)) {
    if (line === "") continue;
    if ((line.startsWith(" ") || line.startsWith("\t")) && headers.length > 0) {
      headers[headers.length - 1]!.value += " " + line.trim();
      continue;
    }
    const colon = line.indexOf(":");
    if (colon === -1) continue; // tolerate junk lines
    headers.push({
      name: line.slice(0, colon).trim().toLowerCase(),
      value: line.slice(colon + 1).trim(),
    });
  }
  return headers;
}

function getHeader(headers: Header[], name: string): string | null {
  const found = headers.find((h) => h.name === name.toLowerCase());
  return found ? found.value : null;
}

/** Parse `Content-Type` into media type + parameters (quoted or bare). */
export function parseContentType(value: string): { type: string; params: Record<string, string> } {
  const parts = value.split(";");
  const type = (parts[0] ?? "").trim().toLowerCase();
  const params: Record<string, string> = {};
  for (const part of parts.slice(1)) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim().toLowerCase();
    let val = part.slice(eq + 1).trim();
    if (val.startsWith('"') && val.endsWith('"') && val.length >= 2) {
      val = val.slice(1, -1);
    }
    if (name !== "") params[name] = val;
  }
  return { type, params };
}

function normalizeCharset(charset: string | undefined): "utf8" | "latin1" {
  const c = (charset ?? "utf-8").toLowerCase();
  if (c === "iso-8859-1" || c === "latin1" || c === "us-ascii" || c === "ascii") {
    return "latin1";
  }
  return "utf8";
}

/** Decode quoted-printable to a byte string (each char = one byte). */
export function decodeQuotedPrintable(text: string): string {
  return text
    .replace(/=\r?\n/g, "") // soft line breaks
    .replace(/=([0-9A-Fa-f]{2})/g, (_whole, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)));
}

/** Interpret a byte string (chars 0–255) in the given charset. */
function bytesToString(byteString: string, charset: "utf8" | "latin1"): string {
  if (charset === "latin1") return byteString;
  return Buffer.from(byteString, "latin1").toString("utf8");
}

function decodeBody(body: string, encoding: string | null, charset: "utf8" | "latin1"): string {
  const enc = (encoding ?? "7bit").toLowerCase().trim();
  if (enc === "base64") {
    return Buffer.from(body.replace(/[^A-Za-z0-9+/=]/g, ""), "base64")
      .toString(charset === "latin1" ? "latin1" : "utf8");
  }
  if (enc === "quoted-printable") {
    return bytesToString(decodeQuotedPrintable(body), charset);
  }
  return body; // 7bit / 8bit / binary — already text
}

/** Decode RFC 2047 encoded words, e.g. `=?UTF-8?B?...?=` in Subject. */
export function decodeEncodedWords(value: string): string {
  // Whitespace between two encoded words is not rendered (RFC 2047 §6.2).
  const joined = value.replace(/(\?=)[ \t]+(=\?)/g, "$1$2");
  return joined.replace(
    /=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g,
    (_whole, charsetName: string, kind: string, payload: string) => {
      const charset = normalizeCharset(charsetName);
      if (kind === "b" || kind === "B") {
        return Buffer.from(payload, "base64").toString(charset === "latin1" ? "latin1" : "utf8");
      }
      const bytes = decodeQuotedPrintable(payload.replace(/_/g, " "));
      return bytesToString(bytes, charset);
    },
  );
}

/** Split a multipart body into its parts at `--boundary` markers. */
export function splitMultipart(body: string, boundary: string): string[] {
  const lines = body.split(/\r?\n/);
  const open = `--${boundary}`;
  const close = `--${boundary}--`;
  const parts: string[] = [];
  let current: string[] | null = null;
  for (const line of lines) {
    const trimmed = line.trimEnd();
    if (trimmed === close) {
      if (current) parts.push(current.join("\n"));
      current = null;
      break;
    }
    if (trimmed === open) {
      if (current) parts.push(current.join("\n"));
      current = [];
      continue;
    }
    if (current) current.push(line);
  }
  if (current) parts.push(current.join("\n"));
  return parts;
}

interface Collected {
  html: string | null;
  text: string | null;
  partTypes: string[];
}

function walkEntity(headers: Header[], body: string, into: Collected, depth: number): void {
  if (depth > 10) return; // refuse pathological nesting
  const ct = parseContentType(getHeader(headers, "content-type") ?? "text/plain");
  if (ct.type.startsWith("multipart/")) {
    const boundary = ct.params["boundary"];
    if (boundary === undefined || boundary === "") return;
    for (const part of splitMultipart(body, boundary)) {
      const { headerText, body: partBody } = splitHeadersBody(part);
      walkEntity(parseHeaders(headerText), partBody, into, depth + 1);
    }
    return;
  }
  into.partTypes.push(ct.type);
  const charset = normalizeCharset(ct.params["charset"]);
  const encoding = getHeader(headers, "content-transfer-encoding");
  if (ct.type === "text/html" && into.html === null) {
    into.html = decodeBody(body, encoding, charset);
  } else if (ct.type === "text/plain" && into.text === null) {
    into.text = decodeBody(body, encoding, charset);
  }
}

/** Parse a raw `.eml` string into the parts mailgold snapshots. */
export function parseEml(raw: string): EmailMessage {
  const { headerText, body } = splitHeadersBody(raw);
  const headers = parseHeaders(headerText);
  const into: Collected = { html: null, text: null, partTypes: [] };
  walkEntity(headers, body, into, 0);
  const subjectRaw = getHeader(headers, "subject");
  return {
    headers,
    subject: subjectRaw === null ? null : decodeEncodedWords(subjectRaw),
    html: into.html,
    text: into.text,
    partTypes: into.partTypes,
  };
}
