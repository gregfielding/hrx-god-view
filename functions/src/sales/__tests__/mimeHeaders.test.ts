/**
 * Regression tests for the outbound-subject mojibake found 2026-08-31.
 *
 * "One shift, zero risk — Bethune Cookman University" reached prospects'
 * inboxes as "One shift, zero risk Ã¢Â€Â” Bethune Cookman University" because
 * the raw UTF-8 em dash was written straight into the Subject header.
 */

import { encodeMimeHeaderValue, buildMimeMessage } from '../mimeHeaders';

/** Decode an RFC 2047 encoded-word run the way a mail client would. */
function decodeEncodedWords(header: string): string {
  return header
    .split(/\r\n /)
    .map((word) => {
      const m = word.match(/^=\?UTF-8\?B\?(.*)\?=$/);
      return m ? Buffer.from(m[1], 'base64').toString('utf8') : word;
    })
    .join('');
}

function headersOf(raw: string): Record<string, string> {
  const msg = Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  const [head] = msg.split('\r\n\r\n');
  const out: Record<string, string> = {};
  // Unfold only at a real header boundary (CRLF + non-space).
  head.split(/\r\n(?=\S)/).forEach((line) => {
    const i = line.indexOf(': ');
    if (i > 0) out[line.slice(0, i)] = line.slice(i + 2);
  });
  return out;
}

describe('encodeMimeHeaderValue', () => {
  it('leaves pure-ASCII subjects untouched and readable', () => {
    expect(encodeMimeHeaderValue('One shift, zero risk')).toBe('One shift, zero risk');
    expect(encodeMimeHeaderValue('Hourly staffing backup for Acme')).toBe(
      'Hourly staffing backup for Acme',
    );
  });

  it('encodes the em dash that caused the incident, and round-trips exactly', () => {
    const subject = 'One shift, zero risk — Bethune Cookman University';
    const encoded = encodeMimeHeaderValue(subject);

    expect(encoded).not.toContain('—');
    expect(encoded).toMatch(/^=\?UTF-8\?B\?/);
    expect(decodeEncodedWords(encoded)).toBe(subject);
  });

  it('round-trips accented and non-Latin text', () => {
    for (const s of ['Café Group — fall coverage', 'Peña Nieto', '東京 — shifts', 'Ünal']) {
      expect(decodeEncodedWords(encodeMimeHeaderValue(s))).toBe(s);
    }
  });

  it('keeps every encoded-word within the RFC 2047 75-char limit', () => {
    const long = 'Fall ramp-up coverage — ' + 'Bethune Cookman University '.repeat(6);
    const encoded = encodeMimeHeaderValue(long);
    for (const word of encoded.split(/\r\n /)) {
      expect(word.length).toBeLessThanOrEqual(75);
    }
    expect(decodeEncodedWords(encoded)).toBe(long.trim());
  });

  it('never splits a multi-byte character across two encoded-words', () => {
    // All 3-byte characters, long enough to force several words.
    const s = '—'.repeat(80);
    const encoded = encodeMimeHeaderValue(s);
    expect(encoded.split(/\r\n /).length).toBeGreaterThan(1);
    // A severed character would decode to U+FFFD.
    const decoded = decodeEncodedWords(encoded);
    expect(decoded).not.toContain('�');
    expect(decoded).toBe(s);
  });

  it('strips CR/LF so CRM-sourced text cannot inject headers', () => {
    const injected = 'Coverage\r\nBcc: attacker@example.com';
    expect(encodeMimeHeaderValue(injected)).not.toMatch(/[\r\n]/);

    const raw = buildMimeMessage({
      fromName: 'Greg Fielding',
      fromEmail: 'g.fielding@c1staffing.com',
      to: 'jolene.lovehubbard@example.edu',
      subject: injected,
      body: 'hi',
    });
    expect(headersOf(raw)).not.toHaveProperty('Bcc');
  });
});

describe('buildMimeMessage', () => {
  const raw = buildMimeMessage({
    fromName: 'Greg Fielding',
    fromEmail: 'g.fielding@c1staffing.com',
    to: 'jolene.lovehubbard@example.edu',
    subject: 'One shift, zero risk — Bethune Cookman University',
    body: 'Hi Jolene — following up.\n\n—\nGreg Fielding · C1 Staffing',
  });

  it('emits base64url with no padding, as the Gmail API requires', () => {
    expect(raw).not.toMatch(/[+/=]/);
  });

  it('writes a Subject header containing no raw non-ASCII bytes', () => {
    const subject = headersOf(raw).Subject;
    // eslint-disable-next-line no-control-regex
    expect(subject).not.toMatch(/[^\x00-\x7F]/);
    expect(decodeEncodedWords(subject)).toBe('One shift, zero risk — Bethune Cookman University');
  });

  it('preserves the body verbatim — the body was never the broken part', () => {
    const msg = Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    expect(msg).toContain('Hi Jolene — following up.');
    expect(msg).toContain('Greg Fielding · C1 Staffing');
  });

  it('declares UTF-8 and 8bit for the body', () => {
    const h = headersOf(raw);
    expect(h['Content-Type']).toBe('text/plain; charset="UTF-8"');
    expect(h['Content-Transfer-Encoding']).toBe('8bit');
  });
});
