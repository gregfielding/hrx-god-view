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

  // Day-of logistics (fetchDayOfLogistics, resolved at dispatch time) —
  // consumed by the T-2h instructions message only.
  onsiteContactName?: string;
  onsiteContactPhone?: string;
  onsiteContactRole?: string;
  parkingText?: string;
  checkInText?: string;

  // Open-shift track: enabled days as { dowIndex: "HH:MM–HH:MM" }
  // (0=Sun..6=Sat), rendered per-language by the welcome / digest bodies.
  weeklySchedule?: Record<string, string>;
}

export type CadenceReminderType =
  | 'assignment_reminder_2h_instructions'
  | 'assignment_reminder_15m_clockin'
  | 'assignment_checkin_0h';

export type OpenShiftReminderType = 'openshift_welcome' | 'openshift_weekly_digest';

const DOW_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DOW_ES = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

/**
 * "Mon–Fri 09:00–17:00" (grouping contiguous runs that share a time) from
 * the compact { dowIndex: "HH:MM–HH:MM" } map the scheduler stores.
 */
export function renderWeeklyScheduleSummary(
  weeklySchedule: Record<string, string> | undefined,
  lang: 'en' | 'es' = 'en',
): string {
  if (!weeklySchedule) return '';
  const names = lang === 'es' ? DOW_ES : DOW_EN;
  const entries = Object.entries(weeklySchedule)
    .map(([d, t]) => ({ d: Number(d), t: String(t ?? '').trim() }))
    .filter((e) => Number.isInteger(e.d) && e.d >= 0 && e.d <= 6 && e.t)
    .sort((a, b) => a.d - b.d);
  if (entries.length === 0) return '';
  const parts: string[] = [];
  let i = 0;
  while (i < entries.length) {
    let j = i;
    while (j + 1 < entries.length && entries[j + 1].d === entries[j].d + 1 && entries[j + 1].t === entries[i].t) {
      j += 1;
    }
    const label = i === j ? names[entries[i].d] : `${names[entries[i].d]}–${names[entries[j].d]}`;
    parts.push(`${label} ${entries[i].t}`);
    i = j + 1;
  }
  return parts.join(', ');
}

/**
 * Open-shift track bodies. On-call model (Greg 2026-09-03 v2): open shifts
 * mean the CLIENT manages the schedule on-site — HRX never states hours.
 * Welcome at creation says exactly that; the recurring message is a light
 * bi-weekly CHECK-IN (career-adjacent voice), not a schedule digest. The
 * reminder doc keeps its `openshift_weekly_digest` type/id for continuity;
 * only copy + interval changed.
 */
export function buildOpenShiftMessage(
  reminderType: OpenShiftReminderType,
  payload: CadenceMessagePayload,
  lang: 'en' | 'es' = 'en',
  brand: string = 'C1 Staffing',
  assignmentUrl: string = '',
): BuiltMessage {
  const es = lang === 'es';
  const location = payload.locationName || (es ? 'tu lugar de trabajo' : 'your worksite');
  const address = truncate(payload.locationAddress || '', 120);
  const details = assignmentUrl
    ? (es ? ` Detalles: ${assignmentUrl}` : ` Details: ${assignmentUrl}`)
    : '';

  if (reminderType === 'openshift_welcome') {
    const parts = [
      es
        ? `${brand}: ¡Estás en el equipo de ${location}!`
        : `${brand}: You're on the crew at ${location}!`,
      es
        ? 'Tus horas de turno se coordinan en el sitio.'
        : 'Your shift hours are managed on-site.',
    ];
    if (address) parts.push(es ? `Dirección: ${address}.` : `Address: ${address}.`);
    if (details) parts.push(details.trim());
    parts.push(es ? 'Responde HELP si necesitas algo.' : 'Reply HELP if you need anything.');
    return {
      title: es ? '¡Estás en el equipo!' : "You're on the crew!",
      body: es
        ? `${location} — tus horas se coordinan en el sitio.${address ? ` ${address}.` : ''}`
        : `${location} — your hours are managed on-site.${address ? ` ${address}.` : ''}`,
      sms: parts.join(' ').trim(),
    };
  }

  // Bi-weekly check-in (doc type still 'openshift_weekly_digest'). Doubles
  // as roster hygiene: a reply from someone who quietly stopped working
  // surfaces through the normal reply desk.
  const checkInLine = es
    ? `Sigues en nuestro equipo de guardia en ${location}. ¿Todo bien?`
    : `You're still on our on-call crew at ${location}. Everything going OK?`;
  const parts = [`${brand}: ${checkInLine}`];
  if (details) parts.push(details.trim());
  parts.push(
    es
      ? 'Responde HELP si algo cambió.'
      : 'Reply HELP if anything has changed.',
  );
  return {
    title: es ? `¿Todo bien en ${location}?` : `Checking in — ${location}`,
    body: checkInLine,
    sms: parts.join(' ').trim(),
  };
}

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
  lang: 'en' | 'es' = 'en',
  brand: string = 'C1 Staffing',
): BuiltMessage {
  const es = lang === 'es';
  const startLabel = formatStartInTimezone(payload.startTime, payload.timezone);
  const job = payload.shiftTitle || payload.jobTitle || (es ? 'turno' : 'shift');
  const location = payload.locationName || (es ? 'tu lugar de trabajo' : 'your worksite');
  const address = truncate(payload.locationAddress || '', 120);
  const detail = pickDetailText(payload);
  const clockInUrl = normalizeUrl(payload.clockInUrl);

  switch (reminderType) {
    case 'assignment_reminder_2h_instructions': {
      // Day-of logistics (2026-09-03): structured check-in / parking /
      // on-site contact beat the free-text detail blob — the blob only
      // rides when no structured snippet exists, so the SMS stays inside
      // its ~2-segment budget.
      const checkIn = truncate(payload.checkInText || '', 90);
      const parking = truncate(payload.parkingText || '', 90);
      const contactName = truncate(payload.onsiteContactName || '', 40);
      const contactRole = truncate(payload.onsiteContactRole || '', 40);
      const contactPhone = String(payload.onsiteContactPhone ?? '').trim();
      const contactLine = contactName
        ? (es
            ? `Busca a ${contactName}${contactRole ? ` (${contactRole})` : ''}${contactPhone ? `: ${contactPhone}` : ''}.`
            : `Find ${contactName}${contactRole ? ` (${contactRole})` : ''}${contactPhone ? `: ${contactPhone}` : ''}.`)
        : '';

      const parts = [
        es
          ? `${brand}: Tu turno de ${job} en ${location} empieza el ${startLabel}.`
          : `${brand}: Your ${job} shift at ${location} starts at ${startLabel}.`,
      ];
      if (address) parts.push(es ? `Dirección: ${address}.` : `Address: ${address}.`);
      if (checkIn) parts.push(es ? `Registro: ${checkIn}` : `Check-in: ${checkIn}`);
      if (parking) parts.push(es ? `Estacionamiento: ${parking}` : `Parking: ${parking}`);
      if (contactLine) parts.push(contactLine);
      if (!checkIn && !parking && detail) parts.push(detail);
      parts.push(es ? 'Responde HELP si necesitas algo.' : 'Reply HELP if you need anything.');

      const bodyBits = [
        es ? `${job} empieza el ${startLabel}.` : `${job} starts at ${startLabel}.`,
        address ? `${address}.` : '',
        contactLine,
        checkIn ? (es ? `Registro: ${truncate(checkIn, 70)}` : `Check-in: ${truncate(checkIn, 70)}`) : '',
        parking ? (es ? `Estacionamiento: ${truncate(parking, 70)}` : `Parking: ${truncate(parking, 70)}`) : '',
        !checkIn && !parking && detail ? detail : '',
      ].filter(Boolean);
      return {
        title: es ? 'Detalles del lugar de trabajo' : 'Worksite details for today',
        body: bodyBits.join(' ').trim(),
        sms: parts.join(' ').trim(),
      };
    }

    case 'assignment_reminder_15m_clockin': {
      const parts = [
        es ? `${brand}: ${job} empieza el ${startLabel}.` : `${brand}: ${job} starts at ${startLabel}.`,
      ];
      if (clockInUrl) {
        parts.push(es ? `Marca tu entrada aquí: ${clockInUrl}` : `Clock in here: ${clockInUrl}`);
      } else {
        parts.push(
          es
            ? 'Abre la app para marcar tu entrada cuando llegues.'
            : 'Open the app to clock in when you arrive.',
        );
      }
      parts.push(
        es
          ? 'Mantén este chat abierto — podemos enviarte instrucciones cuando llegues.'
          : 'Keep this thread open — we may send you instructions when you arrive.',
      );
      return {
        title: es ? 'Marca tu entrada pronto' : 'Clock in soon',
        body: es
          ? `${job} empieza el ${startLabel}. ${clockInUrl ? `Entrada: ${clockInUrl}` : 'Abre la app para marcar tu entrada.'}`
          : `${job} starts at ${startLabel}. ${clockInUrl ? `Clock-in: ${clockInUrl}` : 'Open the app to clock in.'}`,
        sms: parts.join(' ').trim(),
      };
    }

    case 'assignment_checkin_0h': {
      const parts = es
        ? [
            `${brand}: Tu turno de ${job} ya empezó.`,
            '¿Ya estás en el lugar? Responde AQUÍ cuando llegues, o HELP si necesitas ayuda.',
          ]
        : [
            `${brand}: Your ${job} shift has started.`,
            'Are you on site? Reply HERE once you arrive, or reply HELP if you need assistance.',
          ];
      if (location && location.toLowerCase() !== 'your worksite' && location !== 'tu lugar de trabajo') {
        parts.splice(1, 0, es ? `Lugar: ${location}.` : `Location: ${location}.`);
      }
      return {
        title: es ? 'Regístrate ahora' : 'Check in now',
        body: es
          ? `${job} acaba de empezar en ${location}. Responde AQUÍ cuando llegues.`
          : `${job} just started at ${location}. Reply HERE when you arrive.`,
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
        sms: `${brand}: ${job} starts at ${startLabel}.`,
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
