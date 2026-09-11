/**
 * Compose an automated email so it looks like it was written in Gmail by
 * the mailbox owner: plain-text template body + their real Gmail signature
 * (HTML from users.settings.sendAs). Gmail only auto-inserts signatures in
 * its compose UI — API sends must append it themselves (Greg 2026-09-11).
 *
 * Pure — no IO.
 */

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Template body → Gmail-style HTML (escaped, newlines as <br>). */
export function plainTextToHtml(text: string): string {
  return escapeHtml(text.replace(/\r\n/g, '\n')).replace(/\n/g, '<br>');
}

const ENTITIES: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" };

/** Signature HTML → readable text for the text/plain alternative. */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p|tr|li|h[1-6]|table)>/gi, '\n')
    .replace(/<\/t[dh]>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z0-9]+);/gi, (m, code: string) => {
      const key = code.toLowerCase();
      if (ENTITIES[key] !== undefined) return ENTITIES[key];
      if (key.startsWith('#x')) return String.fromCodePoint(parseInt(key.slice(2), 16));
      if (key.startsWith('#')) return String.fromCodePoint(Number(key.slice(1)));
      return m;
    })
    .split('\n')
    .map((line) => line.replace(/[ \t ]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Body + signature as both alternatives. The HTML mirrors Gmail's own
 * compose markup (dir="ltr" wrapper, blank line, gmail_signature div) so
 * the message renders like a hand-written one; no "--" separator, matching
 * how the team's signatures show today.
 */
export function composeEmailWithSignature(body: string, signatureHtml: string | null | undefined): { text: string; html: string } {
  const bodyText = body.replace(/\r\n/g, '\n').trim();
  const sig = String(signatureHtml ?? '').trim();
  const sigText = sig ? htmlToPlainText(sig) : '';
  return {
    text: sigText ? `${bodyText}\n\n${sigText}` : bodyText,
    html:
      `<div dir="ltr">${plainTextToHtml(bodyText)}` +
      (sig ? `<br><br><div dir="ltr" class="gmail_signature" data-smartmail="gmail_signature">${sig}</div>` : '') +
      '</div>',
  };
}
