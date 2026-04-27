/**
 * Cadence Messages
 *
 * Message-body builders for the new shift-cadence reminder types added in
 * Phase 1:
 *
 *   - assignment_reminder_2h_instructions   → worksite address + shift details
 *   - assignment_reminder_15m_clockin       → clock-in URL + quick location nudge
 *   - assignment_checkin_0h                 → "are you on site?" check-in ping
 *
 * The existing assignment_reminder_24h and assignment_reminder_2h message
 * bodies still live in workerShiftRemindersV2.ts#buildReminderMessage — this
 * module is only called for the new types so it can hold CORT-specific copy
 * without polluting the production reminder dispatcher.
 *
 * Design notes:
 *   - All outputs are plain SMS-safe strings. Keep under ~300 chars (Twilio
 *     A2P segment boundary at 306 chars for GSM-7).
 *   - Templates reference `payload.shiftDescription` / `payload.emailIntro`
 *     conservatively — they are MARKDOWN-ish free text the recruiter may have
 *     stuffed with newlines or emoji. We truncate aggressively to keep SMS
 *     deliverability predictable.
 *   - The T-24h reminder message still comes from the original file; we will
 *     switch *that* message to a YES/CANCEL-oriented body in Phase 2 once the
 *     inbound reply classifier is wired.
 */

import * as admin from 'firebase-admin';

export interface CadenceMessagePayload {
  jobTitle: string;
  companyName: string;
  locationName: string;
  locationAddress?: string;
  startTime: admin.firestore.Timestamp;
  endTime?: admin.firestore.Timestamp;
  timezone?: string;

  // Shift-level extras populated by enrichShiftPayload.
  clockInUrl?: string;
  shiftTitle?: string;
  shiftDescription?: string;
  emailIntro?: string;
  shiftId?: string;
  jobOrderId?: string;
}

export type CadenceReminderType =
  | 'assignment_reminder_2h_instructions'
  | 'assignment_reminder_15m_clockin'
  | 'assignment_checkin_0h';

export interface BuiltMessage {
  title: string;
  body: string;
  sms: string;
}

const MAX_DETAIL_CHARS = 180;

function formatStartInTimezone(start: admin.firestore.Timestamp, timezone?: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: timezone || 'UTC',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(start.toDate());
  } catch {
    return start.toDate().toISOString();
  }
}

function squash(value: string): string {
  return value
    .replace(/\r\n|\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n+/g, ' ')
    .trim();
}

function truncate(value: string, limit = MAX_DETAIL_CHARS): string {
  if (!value) return '';
  const s = squash(value);
  if (s.length <= limit) return s;
  return `${s.slice(0, limit - 1).trimEnd()}…`;
}

function pickDetailText(payload: CadenceMessagePayload): string {
  // Prefer shiftDescription — that's where parking / site entry / what-to-bring
  // usually live. Fall back to emailIntro as a softer welcome note.
  const desc = truncate(payload.shiftDescription || '');
  if (desc) return desc;
  const intro = truncate(payload.emailIntro || '');
  return intro;
}

function normalizeUrl(raw?: string): string {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  return `https://${s}`;
}

export function buildCadenceMessage(
  reminderType: CadenceReminderType,
  payload: CadenceMessagePayload,
): BuiltMessage {
  const startLabel = formatStartInTimezone(payload.startTime, payload.timezone);
  const job = payload.shiftTitle || payload.jobTitle || 'shift';
  const location = payload.locationName || 'your worksite';
  const address = truncate(payload.locationAddress || '', 120);
  const detail = pickDetailText(payload);
  const clockInUrl = normalizeUrl(payload.clockInUrl);

  switch (reminderType) {
    case 'assignment_reminder_2h_instructions': {
      const parts = [
        `C1 Staffing: Your ${job} shift at ${location} starts at ${startLabel}.`,
      ];
      if (address) parts.push(`Address: ${address}.`);
      if (detail) parts.push(detail);
      parts.push('Reply HELP if you need anything.');
      return {
        title: 'Worksite details for today',
        body: `${job} starts at ${startLabel}.${address ? ` ${address}.` : ''}${detail ? ` ${detail}` : ''}`,
        sms: parts.join(' ').trim(),
      };
    }

    case 'assignment_reminder_15m_clockin': {
      const parts = [
        `C1 Staffing: ${job} starts at ${startLabel}.`,
      ];
      if (clockInUrl) {
        parts.push(`Clock in here: ${clockInUrl}`);
      } else {
        parts.push('Open the app to clock in when you arrive.');
      }
      parts.push('Keep this thread open — we may send you instructions when you arrive.');
      return {
        title: 'Clock in soon',
        body: `${job} starts at ${startLabel}. ${clockInUrl ? `Clock-in: ${clockInUrl}` : 'Open the app to clock in.'}`,
        sms: parts.join(' ').trim(),
      };
    }

    case 'assignment_checkin_0h': {
      const parts = [
        `C1 Staffing: Your ${job} shift has started.`,
        'Are you on site? Reply HERE once you arrive, or reply HELP if you need assistance.',
      ];
      if (location && location.toLowerCase() !== 'your worksite') {
        parts.splice(1, 0, `Location: ${location}.`);
      }
      return {
        title: 'Check in now',
        body: `${job} just started at ${location}. Reply HERE when you arrive.`,
        sms: parts.join(' ').trim(),
      };
    }

    default: {
      // Exhaustiveness — TS will complain if a new reminder type is added
      // without a case above.
      const _exhaustive: never = reminderType;
      void _exhaustive;
      return {
        title: 'Shift reminder',
        body: `${job} starts at ${startLabel}.`,
        sms: `C1 Staffing: ${job} starts at ${startLabel}.`,
      };
    }
  }
}

export function isCadenceReminderType(value: string): value is CadenceReminderType {
  return (
    value === 'assignment_reminder_2h_instructions' ||
    value === 'assignment_reminder_15m_clockin' ||
    value === 'assignment_checkin_0h'
  );
}
