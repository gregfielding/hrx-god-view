/**
 * Shared builder for the "you've been offered a shift" SMS.
 *
 * Replaces the old hardcoded body
 *   `Hi {firstName}, your application has been accepted for {jobTitle}…
 *    View details and respond: {jobUrl}`
 * with two explicit verbs:
 *   ACCEPT: {assignmentAcceptUrl}
 *   DECLINE: {assignmentDeclineUrl}
 *
 * Why: managers reported click-through on the single combined link was
 * poor — workers got the SMS, opened the page, and bailed before
 * finding the Accept button. Two named actions in the SMS body and
 * one-click handlers on the destination pages closes that gap.
 *
 * Two call sites use this helper:
 *   - `placementsCreateAssignments` — first offer when a placement is
 *     promoted to an assignment via the recruiter Hire button.
 *   - `resendAssignmentOffer` — recruiter clicks the refresh icon next
 *     to "Offer sent" on the placement tile to re-send.
 * Keeping the body in one place ensures the resend behaves identically
 * to the original send.
 *
 * Language: resolves to `'es'` only when explicitly marked Spanish on
 * the user doc — `preferredLanguage` / `languagePreference` / `language`
 * (mirroring `workerHiredDispatch.normalizeLang`). Anything else is
 * treated as English so we don't accidentally Spanish-ify workers
 * whose language is missing or set to something we don't speak.
 */
export type AssignmentOfferLanguage = 'en' | 'es';

export interface AssignmentOfferSmsInput {
  firstName: string;
  jobTitle: string;
  /** Pre-formatted date phrase, EN style: " on Sat 6/8, Sun 6/9". Empty string if no dates. */
  dateTimeInfo?: string;
  /** Pre-formatted location phrase, EN style: " at Legends Global". Empty string if no location. */
  locationText?: string;
  /** Pre-formatted check-in instructions, EN style: " Check-in: meet at the lobby". Empty string if none. */
  instructionsText?: string;
  /** Optional ES-localized variants of the three phrase fragments — if absent, we localize the EN form. */
  dateTimeInfoEs?: string;
  locationTextEs?: string;
  instructionsTextEs?: string;
  /** Where ACCEPT lands — built via `buildWorkerAssignmentAcceptUrl(assignmentId)`. */
  acceptUrl: string;
  /** Where DECLINE lands — built via `buildWorkerAssignmentDeclineUrl({assignmentId, jobPostId})`. */
  declineUrl: string;
  language: AssignmentOfferLanguage;
}

export function buildAssignmentOfferSms(input: AssignmentOfferSmsInput): string {
  const firstName = (input.firstName || '').trim() || (input.language === 'es' ? 'hola' : 'there');
  const jobTitle = (input.jobTitle || '').trim() || (input.language === 'es' ? 'un turno' : 'a shift');
  const acceptUrl = input.acceptUrl;
  const declineUrl = input.declineUrl;

  // Sentinel marker for the visual gap between ACCEPT and DECLINE. We
  // build the body as a string[] for clarity, then join with '\n', then
  // replace the sentinel with a blank line (`\n\n`) so the two links
  // are visually separated in the SMS thread. Workers were occasionally
  // tapping DECLINE thinking it was ACCEPT (the links rendered
  // back-to-back); the gap halves that error rate without adding
  // another GSM segment in most cases.
  const GAP = '__OFFER_SMS_GAP__';

  if (input.language === 'es') {
    const dt = input.dateTimeInfoEs ?? localizeDateTimeToEs(input.dateTimeInfo);
    const loc = input.locationTextEs ?? localizeLocationToEs(input.locationText);
    const ins = input.instructionsTextEs ?? localizeInstructionsToEs(input.instructionsText);
    return [
      `Hola ${firstName}, te ofrecemos ${jobTitle}${dt}${loc}.`,
      `ACEPTAR: ${acceptUrl}`,
      GAP,
      `RECHAZAR: ${declineUrl}`,
      ins ? `${ins.trim()}` : '',
    ]
      .filter(Boolean)
      .join('\n')
      .replace(`${GAP}\n`, '\n');
  }

  const dt = input.dateTimeInfo || '';
  const loc = input.locationText || '';
  const ins = input.instructionsText || '';
  return [
    `Hi ${firstName}, you've been offered ${jobTitle}${dt}${loc}.`,
    `ACCEPT: ${acceptUrl}`,
    GAP,
    `DECLINE: ${declineUrl}`,
    ins ? ins.trim() : '',
  ]
    .filter(Boolean)
    .join('\n')
    .replace(`${GAP}\n`, '\n');
}

/**
 * Treat anything other than an explicit Spanish marker as English so we
 * don't accidentally translate based on browser locale headers or stale
 * data. Mirrors the normalizer in `workerHiredDispatch.ts`.
 */
export function resolveOfferLanguage(userData: Record<string, unknown> | null | undefined): AssignmentOfferLanguage {
  if (!userData) return 'en';
  const candidates = [userData.preferredLanguage, userData.languagePreference, userData.language];
  for (const raw of candidates) {
    const s = String(raw || '').trim().toLowerCase();
    if (!s) continue;
    if (s === 'es' || s === 'es-mx' || s === 'es-us' || s === 'spanish' || s.startsWith('es-')) return 'es';
  }
  return 'en';
}

// --- Lightweight EN→ES fragment localizers ---------------------------------
// These are intentionally narrow string translators for the specific phrase
// shapes the two call sites currently produce. If a call site provides an
// explicit `*Es` fragment we use that instead. The goal is to avoid the
// "Hi Maria, te ofrecemos…on Sat 6/8" mixed-language SMS that would result
// from naively skipping localization.

function localizeDateTimeToEs(en: string | undefined): string {
  if (!en) return '';
  // Pattern: " on Sat 6/8, Sun 6/9"
  return en.replace(/^ on /i, ' el ');
}

function localizeLocationToEs(en: string | undefined): string {
  if (!en) return '';
  // Pattern: " at Legends Global"
  return en.replace(/^ at /i, ' en ');
}

function localizeInstructionsToEs(en: string | undefined): string {
  if (!en) return '';
  // Pattern: " Check-in: meet at the lobby"
  return en.replace(/^\s*Check-in:/i, 'Instrucciones de llegada:');
}
