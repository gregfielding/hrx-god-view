/**
 * **Indeed Flex inbound — event hash (Slice 1).**
 *
 * Stable dedupe key for an inbound Indeed Flex email. The hash is used
 * as the Firestore doc ID in `tenants/{tid}/external_ingest_events/{eventHash}`,
 * so the webhook is naturally idempotent — re-deliveries of the same
 * email collide on the doc ID and skip.
 *
 * Strategy:
 *
 *   1. Prefer the RFC5322 **Message-ID** header. Every well-formed
 *      email has one, and the spec guarantees it's globally unique
 *      per message.
 *   2. When Message-ID is missing or malformed (forwarded mail
 *      sometimes drops it), fall back to a hash of stable content —
 *      `from + subject + date + first 256 chars of body`. Collisions
 *      are possible in theory but vanishingly rare for transactional
 *      notifications like Indeed Flex's.
 *
 * Both paths produce a sha256 hex string so callers don't need to
 * branch on which strategy was used.
 *
 * Kept pure (no Firestore, no logging) so it can be unit-tested with
 * `npm test` and so future providers (Fieldglass, partner APIs) can
 * reuse it without inheriting Firebase dependencies.
 */

import { createHash } from 'crypto';

/**
 * Inputs to {@link computeEventHash}. All fields are optional; the
 * function picks the strongest available signal.
 */
export interface EventHashInput {
  /**
   * RFC5322 Message-ID, exactly as it appears on the wire — angle
   * brackets included (e.g. `'<abc.def@indeedflex.com>'`). Whitespace
   * is trimmed. Malformed values are ignored and the function falls
   * back to the content hash.
   */
  messageId?: string;
  /** RFC5322 From header value. */
  from?: string;
  /** Subject line. */
  subject?: string;
  /** RFC5322 Date header value, in whatever string form the email uses. */
  date?: string;
  /**
   * Up to 256 characters of body content for the fallback hash. The
   * caller is expected to slice before passing in.
   */
  bodyPreview?: string;
}

/**
 * Pattern a valid Message-ID must match. RFC5322 §3.6.4 defines
 * Message-ID as `'<' msg-id '>'` where `msg-id` is `local-part "@" domain`.
 * We accept anything with at least one `@` inside the angle brackets;
 * stricter validation would reject perfectly usable malformed-but-stable
 * IDs from misbehaving mail servers.
 */
const MESSAGE_ID_RE = /^<[^<>\s]+@[^<>\s]+>$/;

/** Body chars considered for the fallback content hash. Capped to keep
 *  the hash function's input bounded — large emails don't make the hash
 *  more unique past this point. */
export const BODY_PREVIEW_HASH_CAP = 256;

/**
 * Compute a stable sha256-hex event hash for an inbound email.
 *
 * Same email → same hash, every time. Different emails → essentially
 * never the same hash. Suitable as a Firestore doc ID for dedupe.
 */
export function computeEventHash(input: EventHashInput): string {
  const messageId = (input.messageId ?? '').trim();
  if (MESSAGE_ID_RE.test(messageId)) {
    return sha256Hex(`mid:${messageId}`);
  }
  const parts = [
    `from:${(input.from ?? '').trim().toLowerCase()}`,
    `subject:${(input.subject ?? '').trim()}`,
    `date:${(input.date ?? '').trim()}`,
    `body:${(input.bodyPreview ?? '').slice(0, BODY_PREVIEW_HASH_CAP)}`,
  ].join('|');
  return sha256Hex(`fallback:${parts}`);
}

/**
 * Extract the Message-ID value from a raw headers blob, returning
 * `undefined` if not present.
 *
 * Header parsing is intentionally loose — we read line-by-line, find
 * the first `Message-ID:` (case-insensitive), and return everything
 * after the colon trimmed. The {@link MESSAGE_ID_RE} check in
 * `computeEventHash` is what decides whether the value is usable.
 *
 * Folded headers (continuation lines starting with whitespace, RFC5322
 * §2.2.3) are unfolded into the value before return.
 */
export function extractMessageId(headersBlob: string | undefined | null): string | undefined {
  if (!headersBlob) return undefined;
  const lines = headersBlob.split(/\r?\n/);
  let collecting = false;
  let buf = '';
  for (const line of lines) {
    if (collecting) {
      if (/^[ \t]/.test(line)) {
        buf += ' ' + line.trim();
        continue;
      }
      break;
    }
    if (/^message-id\s*:/i.test(line)) {
      collecting = true;
      buf = line.replace(/^message-id\s*:\s*/i, '').trim();
    }
  }
  return buf ? buf : undefined;
}

/**
 * Extract the Date header from a raw headers blob, returning the raw
 * string value (NOT a parsed Date object — the content hash treats it
 * opaquely). Same folding rules as {@link extractMessageId}.
 */
export function extractDateHeader(headersBlob: string | undefined | null): string | undefined {
  if (!headersBlob) return undefined;
  const lines = headersBlob.split(/\r?\n/);
  let collecting = false;
  let buf = '';
  for (const line of lines) {
    if (collecting) {
      if (/^[ \t]/.test(line)) {
        buf += ' ' + line.trim();
        continue;
      }
      break;
    }
    if (/^date\s*:/i.test(line)) {
      collecting = true;
      buf = line.replace(/^date\s*:\s*/i, '').trim();
    }
  }
  return buf ? buf : undefined;
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}
