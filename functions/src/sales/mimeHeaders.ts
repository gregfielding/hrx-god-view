/**
 * RFC 2047 / RFC 5322 correct MIME message construction for outbound sales mail.
 *
 * Why this exists (2026-08-31): both outreach senders wrote
 * `Subject: ${subject}` with raw UTF-8 bytes. A `Content-Type: charset="UTF-8"`
 * line declares the BODY's charset only — headers are governed separately by
 * RFC 5322 and must be pure ASCII. Receiving clients that met a raw high byte
 * in the Subject guessed a charset (ISO-8859-1 in the wild), so the em dash in
 * "One shift, zero risk — Bethune Cookman University" reached prospects as
 * "Ã¢Â€Â”": the UTF-8 bytes E2 80 94 read as Latin-1 and re-encoded.
 *
 * Non-ASCII header text must be sent as an RFC 2047 "encoded-word".
 */

/** `=?UTF-8?B?` + `?=` framing, and the 75-char encoded-word limit. */
const ENCODED_WORD_LIMIT = 75;
const PREFIX = '=?UTF-8?B?';
const SUFFIX = '?=';
/** Base64 chars we can spend per word, rounded down to a whole 4-char group. */
const B64_BUDGET = ENCODED_WORD_LIMIT - PREFIX.length - SUFFIX.length;
const B64_PER_WORD = B64_BUDGET - (B64_BUDGET % 4);
/** 4 base64 chars encode 3 bytes. */
const BYTES_PER_WORD = (B64_PER_WORD / 4) * 3;

/**
 * Strip CR/LF from a value destined for a header.
 *
 * These fields interpolate CRM-sourced text (campus, company, contact name).
 * A newline in that data would let the remainder be read as additional
 * headers — the classic email header-injection hole (an injected `Bcc:`
 * silently CCs a third party on every send).
 */
function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

function isAscii(value: string): boolean {
  // eslint-disable-next-line no-control-regex
  return !/[^\x00-\x7F]/.test(value);
}

/**
 * Encode a header value as RFC 2047 encoded-word(s) when it contains
 * non-ASCII; return it unchanged (but CRLF-sanitized) when it doesn't, so
 * plain-ASCII subjects stay human-readable on the wire.
 *
 * Splits on CODE POINT boundaries — never mid-character — so a multi-byte
 * character can't be severed across two encoded-words (which would decode to
 * replacement characters, i.e. a subtler version of the bug this fixes).
 */
export function encodeMimeHeaderValue(raw: string): string {
  const value = sanitizeHeaderValue(raw);
  if (value === '' || isAscii(value)) return value;

  const words: string[] = [];
  let chunk: string[] = [];
  let chunkBytes = 0;

  const flush = () => {
    if (chunk.length === 0) return;
    words.push(PREFIX + Buffer.from(chunk.join(''), 'utf8').toString('base64') + SUFFIX);
    chunk = [];
    chunkBytes = 0;
  };

  // Array.from iterates by code point, so surrogate pairs stay intact.
  for (const char of Array.from(value)) {
    const size = Buffer.byteLength(char, 'utf8');
    if (chunkBytes + size > BYTES_PER_WORD) flush();
    chunk.push(char);
    chunkBytes += size;
  }
  flush();

  // Continuation lines are folded with CRLF + a single space (RFC 5322 §2.2.3);
  // a decoder drops the whitespace between adjacent encoded-words.
  return words.join('\r\n ');
}

/**
 * Build a base64url-encoded RFC 5322 message for the Gmail API's `raw` field.
 *
 * `fromName` is encoded the same way as the subject — a display name is header
 * text and has exactly the same constraint. Omit the from fields entirely to
 * let Gmail stamp the authenticated mailbox as sender.
 *
 * Line endings are CRLF throughout, as RFC 5322 requires; body newlines are
 * normalized so a `\n`-joined body can't leave a bare LF in the message.
 */
export function buildMimeMessage(args: {
  fromName?: string;
  fromEmail?: string;
  to: string;
  subject: string;
  body: string;
}): string {
  const to = sanitizeHeaderValue(args.to);
  const subject = encodeMimeHeaderValue(args.subject);

  const headers: string[] = [];
  if (args.fromEmail) {
    const fromName = encodeMimeHeaderValue(args.fromName ?? '');
    headers.push(
      fromName
        ? `From: ${fromName} <${sanitizeHeaderValue(args.fromEmail)}>`
        : `From: ${sanitizeHeaderValue(args.fromEmail)}`,
    );
  }
  headers.push(`To: ${to}`);
  headers.push(`Subject: ${subject}`);
  headers.push('MIME-Version: 1.0');
  headers.push('Content-Type: text/plain; charset="UTF-8"');
  headers.push('Content-Transfer-Encoding: 8bit');

  const body = String(args.body ?? '').replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
  const msg = `${headers.join('\r\n')}\r\n\r\n${body}`;

  return Buffer.from(msg, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
