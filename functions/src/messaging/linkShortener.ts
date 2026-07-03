/**
 * Self-hosted SMS link shortener — replaces Twilio Link Shortening.
 *
 * Twilio's `shortenUrls: true` (their "Engagement Suite" feature) billed
 * ~1.4¢ per message on top of the SMS itself — $525 in May 2026, $285 in
 * June — to swap long URLs for `go.hrxone.com/xxx` links held in Twilio's
 * database. This module does the same swap in our own code just before the
 * message leaves: each URL in the outgoing body becomes
 * `https://hrxone.com/l/{slug}`, backed by a `short_links` Firestore doc
 * that the `linkRedirect` function (hosting rewrite `/l/**`) resolves with
 * a 302. Click counts land on the doc, so we keep click tracking — which
 * nothing ever read from Twilio's version anyway.
 *
 * Sits in the two low-level senders (`sendWorkerMessageInternal` in
 * twilio.ts and `TwilioSmsProvider.sendSms`), so all ~33 SMS trigger
 * points get it without per-call-site changes — mirroring exactly where
 * Twilio's edge shortening used to apply.
 *
 * Fail-open by design: any Firestore hiccup returns the original body so
 * an SMS is never blocked (worst case a worker gets a long link).
 *
 * Note: old `go.hrxone.com/…` links in already-delivered texts live in
 * Twilio's system — the Twilio domain config stays in place until those
 * age out; nothing here touches it.
 */

import * as crypto from 'crypto';

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';

if (!admin.apps.length) {
  admin.initializeApp();
}

export const SHORT_LINKS_COLLECTION = 'short_links';
export const SHORT_LINK_BASE = 'https://hrxone.com/l/';

const SLUG_LENGTH = 10;
const SLUG_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** Matches http(s) URLs in a message body. Trailing sentence punctuation is
 *  trimmed after matching (a URL at the end of "…apply here: {url}." should
 *  not capture the period). */
const URL_REGEX = /https?:\/\/[^\s<>"']+/g;

/** Skip URLs that are already at-or-below the shortened length — swapping
 *  them would gain nothing (and could even lengthen the message). */
const MIN_LENGTH_TO_SHORTEN = SHORT_LINK_BASE.length + SLUG_LENGTH + 5;

function randomSlug(): string {
  const bytes = crypto.randomBytes(SLUG_LENGTH);
  let slug = '';
  for (let i = 0; i < SLUG_LENGTH; i++) {
    slug += SLUG_ALPHABET[bytes[i] % SLUG_ALPHABET.length];
  }
  return slug;
}

function trimTrailingPunctuation(url: string): string {
  return url.replace(/[.,;:!?)\]}>]+$/, '');
}

/**
 * Create one short link and return its full short URL.
 * Uses `.create()` (fails on existing doc) with a single retry so a slug
 * collision — already ~2^-60 unlikely — can never silently repoint an
 * existing link.
 */
export async function createShortLink(
  url: string,
  context?: { tenantId?: string; userId?: string; messageTypeId?: string },
): Promise<string> {
  const db = admin.firestore();
  for (let attempt = 0; attempt < 2; attempt++) {
    const slug = randomSlug();
    try {
      await db.collection(SHORT_LINKS_COLLECTION).doc(slug).create({
        url,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        clickCount: 0,
        ...(context?.tenantId ? { tenantId: context.tenantId } : {}),
        ...(context?.userId ? { userId: context.userId } : {}),
        ...(context?.messageTypeId ? { messageTypeId: context.messageTypeId } : {}),
      });
      return `${SHORT_LINK_BASE}${slug}`;
    } catch (err: unknown) {
      // ALREADY_EXISTS → retry once with a fresh slug; anything else bubbles.
      const code = (err as { code?: number }).code;
      if (code !== 6 /* gRPC ALREADY_EXISTS */) throw err;
    }
  }
  throw new Error('short-link slug collision persisted across retries');
}

/**
 * Replace every long URL in an outgoing SMS body with a self-hosted short
 * link. Returns the body unchanged when there's nothing to shorten or on
 * any error (fail-open — never block a send on the shortener).
 */
export async function shortenUrlsInBody(
  body: string,
  context?: { tenantId?: string; userId?: string; messageTypeId?: string },
): Promise<string> {
  try {
    const rawMatches = body.match(URL_REGEX);
    if (!rawMatches || rawMatches.length === 0) return body;

    // Dedupe — the same URL twice in one body gets one slug.
    const urls = [...new Set(rawMatches.map(trimTrailingPunctuation))].filter(
      (u) => u.length >= MIN_LENGTH_TO_SHORTEN && !u.startsWith(SHORT_LINK_BASE),
    );
    if (urls.length === 0) return body;

    let result = body;
    for (const url of urls) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const shortUrl = await createShortLink(url, context);
        result = result.split(url).join(shortUrl);
      } catch (err) {
        logger.warn('[linkShortener] failed to shorten one URL — leaving it long', {
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return result;
  } catch (err) {
    logger.warn('[linkShortener] shortenUrlsInBody failed — sending original body', {
      err: err instanceof Error ? err.message : String(err),
    });
    return body;
  }
}
