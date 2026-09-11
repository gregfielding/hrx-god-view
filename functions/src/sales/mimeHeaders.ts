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

import { randomBytes } from 'crypto';

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
  /** RFC 5322 threading — the parent's Message-ID, e.g. `<abc@mail.gmail.com>`. */
  inReplyTo?: string;
  references?: string;
  /**
   * HTML alternative. When set the message is multipart/alternative
   * (`body` becomes the text/plain part); omitted = plain text as before.
   */
  html?: string;
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
  const inReplyTo = sanitizeHeaderValue(args.inReplyTo ?? '');
  const references = sanitizeHeaderValue(args.references ?? '');
  if (inReplyTo) headers.push(`In-Reply-To: ${inReplyTo}`);
  if (references) headers.push(`References: ${references}`);
  headers.push('MIME-Version: 1.0');

  const body = String(args.body ?? '').replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
  let msg: string;
  if (args.html) {
    // Parts are base64: Gmail signature HTML is routinely one line far past
    // RFC 5322's 998-octet limit, which 8bit can't carry.
    const boundary = `hrx_alt_${randomBytes(12).toString('hex')}`;
    const base64Lines = (s: string) => (Buffer.from(s, 'utf8').toString('base64').match(/.{1,76}/g) ?? []).join('\r\n');
    const part = (type: string, content: string) =>
      `--${boundary}\r\nContent-Type: ${type}; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n${base64Lines(content)}\r\n`;
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    msg = `${headers.join('\r\n')}\r\n\r\n${part('text/plain', body)}${part('text/html', args.html)}--${boundary}--\r\n`;
  } else {
    headers.push('Content-Type: text/plain; charset="UTF-8"');
    headers.push('Content-Transfer-Encoding: 8bit');
    msg = `${headers.join('\r\n')}\r\n\r\n${body}`;
  }

  return Buffer.from(msg, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Windows-1252 characters that stand in for bytes 0x80-0x9F when mojibake passed through that code page.
 * Written as escapes on purpose: literal C1/control characters are invisible in review (see
 * docs/claude/feedback_invisible_uf8ff_literal.md).
 */
const CP1252_TO_BYTE: Record<string, number> = { '\u20ac': 0x80, '\u201a': 0x82, '\u0192': 0x83, '\u201e': 0x84, '\u2026': 0x85, '\u2020': 0x86, '\u2021': 0x87, '\u02c6': 0x88, '\u2030': 0x89, '\u0160': 0x8a, '\u2039': 0x8b, '\u0152': 0x8c, '\u017d': 0x8e, '\u2018': 0x91, '\u2019': 0x92, '\u201c': 0x93, '\u201d': 0x94, '\u2022': 0x95, '\u2013': 0x96, '\u2014': 0x97, '\u02dc': 0x98, '\u2122': 0x99, '\u0161': 0x9a, '\u203a': 0x9b, '\u0153': 0x9c, '\u017e': 0x9e, '\u0178': 0x9f };
/** A lead byte of UTF-8 read as Latin-1 (Ã Â â) followed by a continuation-byte stand-in. */
const MOJIBAKE_HINT = /[\u00c3\u00c2\u00e2][\u0080-\u00bf\u20ac\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\u017d\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\u017e\u0178]/;

/**
 * Undo UTF-8-read-as-Latin-1 (or Windows-1252) mojibake, layer by layer (2026-09-11: Natalie's reply subjects
 * compounded "Resume text \u2014 Brandon Wilson" into a wall of mojibake because every Re: re-garbled the last
 * one). Each pass maps the string back to bytes and decodes them as UTF-8; it stops as soon as that isn't a
 * clean decode (a replacement character, or a code point no single byte stands for), so legitimate accented
 * text is returned unchanged.
 */
export function repairMojibake(input: string): string {
  let cur = String(input ?? '');
  for (let pass = 0; pass < 8 && MOJIBAKE_HINT.test(cur); pass += 1) {
    const bytes: number[] = [];
    for (const ch of Array.from(cur)) {
      const cp = ch.codePointAt(0) ?? 0;
      if (cp <= 0xff) bytes.push(cp);
      else if (CP1252_TO_BYTE[ch] !== undefined) bytes.push(CP1252_TO_BYTE[ch]);
      else return cur;
    }
    const next = Buffer.from(bytes).toString('utf8');
    if (next.includes('\ufffd') || next === cur) return cur;
    cur = next;
  }
  return cur;
}

/** Reply subject: repaired, stacked "Re:/Fwd:" prefixes collapsed, exactly one "Re: ". */
export function normalizeReplySubject(subject: string): string {
  const clean = repairMojibake(subject).replace(/^\s*((re|fwd?|rv)\s*:\s*)+/i, '').trim();
  return `Re: ${clean || '(no subject)'}`;
}
