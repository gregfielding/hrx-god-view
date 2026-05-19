/**
 * **Indeed Flex parser — body normalization.**
 *
 * Slice 1 persists both `text` and `html` from the SendGrid Inbound
 * Parse payload. Indeed Flex's notification emails carry the meaningful
 * content in BOTH parts, but the HTML part is the canonical one — the
 * plain-text part is sometimes truncated or stripped of crucial fields
 * (table cells in particular).
 *
 * This module produces a single canonical normalized text body the
 * downstream extractors operate on:
 *
 *   1. Prefer HTML when present. Strip tags via a conservative
 *      tag-walk (no `htmlparser2` dep; performance + audit-ability).
 *   2. Decode the common HTML entities (`&amp;`, `&nbsp;`, `&lt;`, etc.).
 *   3. Collapse run-length whitespace; preserve line breaks where they
 *      look structural (after a `</td>`, `<br>`, or `</p>`).
 *   4. Trim quoted reply chains (`-----Original Message-----`, `>` lines)
 *      and Indeed Flex's footer block ("Indeed Flex Limited, Registered
 *      Office, ...") so the extractor only sees the message proper.
 *
 * Pure: no Firestore reads, no network. Safe to unit-test against
 * captured email samples without any mocks.
 */

/**
 * The set of HTML entities that show up in Indeed Flex emails. There's
 * no full entity table here intentionally — adding new ones is cheap,
 * but most emails only use these. `&apos;` is the one weird case (only
 * legal in XHTML proper, but Indeed templates emit it).
 */
const HTML_ENTITY_TABLE: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&#39;': "'",
  '&nbsp;': ' ',
  '&ndash;': '–',
  '&mdash;': '—',
  '&hellip;': '…',
  '&copy;': '©',
  '&reg;': '®',
};

/**
 * The "remove from this line down" markers Indeed Flex includes in
 * their notification footer. The first match wins — anything below
 * that line gets dropped from the normalized text. Case-insensitive
 * substring match.
 */
const FOOTER_TRIM_MARKERS = [
  'Indeed Flex Limited',
  'unsubscribe from these notifications',
  'View this email in your browser',
  'This email and any attachments',
  '-----Original Message-----',
  'On behalf of Indeed Flex',
];

/** Decode the HTML entities we care about. Numeric entities (`&#123;`)
 *  are decoded; named entities outside our table are left as-is so an
 *  audit can spot anything unexpected. */
export function decodeEntities(input: string): string {
  return input
    .replace(/&#(\d+);/g, (_match, code) => {
      const n = Number(code);
      return Number.isFinite(n) ? String.fromCharCode(n) : _match;
    })
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => {
      const n = parseInt(hex, 16);
      return Number.isFinite(n) ? String.fromCharCode(n) : _match;
    })
    .replace(/&[a-z#0-9]+;/gi, (entity) => HTML_ENTITY_TABLE[entity] ?? entity);
}

/**
 * Strip HTML tags. Conservative — drops everything between `<` and `>`
 * inclusive, replacing structural tags (`<br>`, `<p>`, `</td>`, `</tr>`,
 * `<hr>`, `</div>`) with a newline first so paragraph boundaries
 * survive.
 *
 * Won't choke on malformed HTML (Indeed's emails are usually clean,
 * but we've seen mailer-gateway rewrites with broken `<style>` blocks).
 */
export function stripHtml(html: string): string {
  // Drop `<style>` and `<script>` blocks entirely — they're useless
  // here and any selectors in `<style>` look like text noise to the
  // regex extractors.
  let stripped = html
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');

  // Replace structural tags with a newline before stripping.
  stripped = stripped
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|td|li|h[1-6])\s*>/gi, '\n')
    .replace(/<hr\s*\/?>/gi, '\n');

  // Now drop every remaining tag.
  return stripped.replace(/<[^>]*>/g, '');
}

/**
 * Trim Indeed Flex's email footer. Walks line-by-line; once any
 * `FOOTER_TRIM_MARKERS` substring appears, everything from that line
 * onward is dropped.
 */
export function trimFooter(text: string): string {
  const lines = text.split('\n');
  const cutIdx = lines.findIndex((line) =>
    FOOTER_TRIM_MARKERS.some((m) => line.toLowerCase().includes(m.toLowerCase())),
  );
  return cutIdx >= 0 ? lines.slice(0, cutIdx).join('\n') : text;
}

/**
 * Trim quoted-reply chains (`> ...` lines and `On <date> ... wrote:` headers).
 * Indeed Flex's bare notifications rarely have reply chains, but
 * recruiters occasionally forward an email and the forward wrapper
 * starts with `From: ...` blocks we don't want extracted.
 */
export function trimQuotedReplies(text: string): string {
  const lines = text.split('\n');
  const cutIdx = lines.findIndex((line) =>
    /^\s*(>|From:|Sent:|On\b.*wrote:|Begin forwarded message:)/i.test(line),
  );
  return cutIdx >= 0 ? lines.slice(0, cutIdx).join('\n') : text;
}

/**
 * Collapse run-length whitespace. Preserves single line breaks but
 * folds 3+ consecutive newlines down to 2, and collapses runs of
 * spaces/tabs to a single space. The extractors are line-oriented
 * for some fields and inline-oriented for others; this keeps both
 * happy.
 */
export function collapseWhitespace(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}

/**
 * Full normalization pipeline. Pass the raw `text` and `html` strings
 * from the persisted ingest event; this module picks the better of
 * the two, strips HTML, decodes entities, trims footers + replies,
 * and collapses whitespace.
 */
export function normalizeEmailBody(input: { text?: string; html?: string }): string {
  // Prefer HTML when available — Indeed's plain-text part sometimes
  // drops table cells that the HTML keeps.
  const source = input.html && input.html.length > 0 ? stripHtml(input.html) : input.text ?? '';
  const decoded = decodeEntities(source);
  const noFooter = trimFooter(decoded);
  const noReplies = trimQuotedReplies(noFooter);
  return collapseWhitespace(noReplies);
}
