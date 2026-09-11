/**
 * Send-time EN→ES translation for recruiter-typed worker-facing text
 * (Greg 2026-09-03): one Claude call per BLAST (not per worker), result
 * stored on the notification docs as body_i18n.es. Never machine-translate
 * at read time — offline gaps, cost, and mistranslated job terms.
 *
 * Fail-open: any error returns null and the caller simply omits the ES
 * variant (workers see the recruiter's original text).
 */
import { logger } from 'firebase-functions/v2';

import { getClaudeChat } from '../utils/claudeChat';

/**
 * Long-form variant for job-posting descriptions (markdown-ish recruiter
 * text). Same fail-open contract; preserves structure, bullets, numbers,
 * pay rates, addresses, and proper nouns.
 */
export async function translateJobTextToSpanish(text: string): Promise<string | null> {
  const source = String(text ?? '').trim();
  if (!source) return null;
  try {
    const chat = getClaudeChat();
    const completion = await chat.chat.completions.create({
      model: 'claude-opus-5',
      messages: [
        {
          role: 'system',
          content:
            'You translate staffing job descriptions from English to neutral Latin-American Spanish for hourly workers. ' +
            'Preserve the original structure exactly: line breaks, markdown, bullet characters, headings. ' +
            'Keep company names, venue/site names, addresses, dollar amounts, dates, and times EXACTLY as written. ' +
            'Reply with ONLY the translation — no commentary.',
        },
        { role: 'user', content: source },
      ],
    });
    const out = completion.choices?.[0]?.message?.content?.trim();
    return out || null;
  } catch (err) {
    logger.warn('translateJobTextToSpanish_failed', {
      error: (err as Error)?.message || String(err),
    });
    return null;
  }
}

export async function translateWorkerTextToSpanish(text: string): Promise<string | null> {
  const source = String(text ?? '').trim();
  if (!source) return null;
  try {
    const chat = getClaudeChat();
    const completion = await chat.chat.completions.create({
      model: 'claude-opus-5',
      messages: [
        {
          role: 'system',
          content:
            'You translate short staffing-app notifications from English to neutral Latin-American Spanish for hourly workers. ' +
            'Keep URLs, names, dates, times, dollar amounts, and venue/job names EXACTLY as written. ' +
            'Match the original tone and length. Reply with ONLY the translation — no quotes, no commentary.',
        },
        { role: 'user', content: source },
      ],
    });
    const out = completion.choices?.[0]?.message?.content?.trim();
    if (!out) return null;
    // A refusal/commentary reply would be longer or bracketed — basic sanity:
    // translations land within ~3x the source length.
    if (out.length > Math.max(80, source.length * 3)) return null;
    return out;
  } catch (err) {
    logger.warn('translateWorkerTextToSpanish_failed', {
      error: (err as Error)?.message || String(err),
    });
    return null;
  }
}
