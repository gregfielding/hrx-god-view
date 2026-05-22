/**
 * **Bulk-invite Indeed/external job-applicant CSV to a user group.**
 *
 * Recruiter uploads an Indeed-style applicant CSV from the user-group
 * detail page (the "Bulk invite from CSV" icon next to the copy-
 * application-link button). The client parses the CSV, normalizes
 * phones, and sends the structured candidate list here. This callable
 * loops the candidates, sends a single SMS each via Twilio with the
 * user group's apply link, and stamps per-recipient idempotency so
 * a re-upload of the same CSV is a no-op.
 *
 * Mirrors the established user-group callable pattern
 * (`userGroupInterviewInviteSend`):
 *   - canManageOnboarding gate
 *   - Twilio secrets bound at the function level
 *   - `sendWorkerMessageInternal` so STOP enforcement + unified
 *     logging happen for free
 *   - per-recipient hard cap + idempotency stamp
 *   - per-row results returned so the dialog can show successes/errors
 *
 * **Idempotency** lives at
 * `tenants/{tid}/bulk_invite_log/{phoneHash}__{groupId}`. The phone is
 * hashed (sha256 truncated to 16 chars) so Firestore listings don't
 * surface raw PII in the doc id.
 *
 * **Compliance**: every SMS includes "Reply STOP to opt out". The
 * Twilio number already auto-honors STOP replies; the explicit
 * call-out keeps the message TCPA-defensible for a cohort that's
 * applied to a C1 posting but hasn't otherwise opted in to SMS.
 *
 * **Hard caps**:
 *   - per-call: 500 candidates (raise via config if a future use
 *     case needs more; today the largest Indeed export we've seen
 *     was 79 rows)
 *   - per-tenant: enforced via auth gate only — no global rate cap
 */

import * as crypto from 'crypto';
import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';

import { canManageOnboarding } from '../onboarding/workerOnboardingPipeline';
import {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_MESSAGING_PHONE_NUMBER,
  TWILIO_A2P_CAMPAIGN,
} from '../messaging/twilioSecrets';
import { sendWorkerMessageInternal } from '../twilio';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

const HARD_CAP_CANDIDATES = 500;

// ─────────────────────────────────────────────────────────────────────
// Input / output types
// ─────────────────────────────────────────────────────────────────────

export interface BulkInviteCandidateInput {
  /** Display name from the CSV. We extract the first name for the
   *  SMS opener. Empty/missing → "there". */
  name: string;
  /** E.164 phone (the client normalized; server re-validates). */
  phone: string;
  /** Optional external id (e.g. Indeed candidate hash) for audit. */
  externalId?: string;
}

export interface BulkInviteRequest {
  tenantId: string;
  groupId: string;
  /** The user-group's public apply URL. Client passes this so this
   *  callable doesn't have to know the routing convention. Validated
   *  against a permitted-host whitelist below. */
  applyUrl: string;
  candidates: BulkInviteCandidateInput[];
  /** When true, the callable validates input + reports what WOULD
   *  happen without sending any SMS. The client uses this for the
   *  dialog's preview / before-send screen. */
  dryRun?: boolean;
}

export type BulkInviteRowStatus =
  | 'sent'
  | 'skipped_already_sent'
  | 'skipped_bad_phone'
  | 'skipped_no_phone'
  | 'skipped_no_name'
  | 'twilio_error'
  | 'preview';

export interface BulkInviteRowResult {
  name: string;
  phone: string;
  status: BulkInviteRowStatus;
  /** Twilio message SID when status='sent'. */
  twilioSid?: string;
  /** Free-form error from Twilio or validation. */
  error?: string;
}

export interface BulkInviteResponse {
  /** Counts grouped by terminal status. Sums to `candidates.length`. */
  aggregate: {
    rowsReceived: number;
    sent: number;
    skippedAlreadySent: number;
    skippedBadPhone: number;
    skippedNoPhone: number;
    skippedNoName: number;
    twilioError: number;
    previewed: number;
  };
  results: BulkInviteRowResult[];
  /** Echoed back so the dialog can show what was actually used. */
  appliedUrl: string;
  dryRun: boolean;
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

const ALLOWED_APPLY_HOST_SUFFIXES = ['.hrxone.com', 'hrxone.com'];

function validateApplyUrl(rawUrl: string, groupId: string): string {
  const trimmed = (rawUrl ?? '').trim();
  if (!trimmed) {
    throw new HttpsError('invalid-argument', 'applyUrl is required');
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new HttpsError('invalid-argument', `applyUrl is not a valid URL: ${trimmed}`);
  }
  if (parsed.protocol !== 'https:') {
    throw new HttpsError('invalid-argument', 'applyUrl must use https');
  }
  const hostOk = ALLOWED_APPLY_HOST_SUFFIXES.some(
    (h) => parsed.host === h || parsed.host.endsWith(h),
  );
  if (!hostOk) {
    throw new HttpsError(
      'invalid-argument',
      `applyUrl host '${parsed.host}' not in allowlist`,
    );
  }
  // Loose check that the groupId is referenced — guards against typos
  // sending the cohort to the wrong group's link.
  if (!parsed.pathname.includes(groupId)) {
    throw new HttpsError(
      'invalid-argument',
      `applyUrl path '${parsed.pathname}' does not contain the target groupId`,
    );
  }
  return trimmed;
}

function normalizeE164(raw: string): string | null {
  if (!raw) return null;
  const cleaned = String(raw)
    .replace(/^'/, '')
    .replace(/[\s()\-.]/g, '')
    .trim();
  let digits = cleaned;
  if (digits.startsWith('+')) digits = digits.slice(1);
  if (digits.length === 10) digits = '1' + digits;
  if (digits.length !== 11 || !digits.startsWith('1')) return null;
  if (!/^\d+$/.test(digits)) return null;
  return `+${digits}`;
}

function firstNameOf(fullName: string): string {
  const trimmed = (fullName ?? '').trim();
  if (!trimmed) return 'there';
  const first = trimmed.split(/\s+/)[0];
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

function buildSmsBody(firstName: string, applyUrl: string, groupLabel?: string): string {
  // Group label included when present (set by client from the group
  // doc title); generic when absent.
  const role = groupLabel ? `the ${groupLabel} role` : 'one of our open roles';
  return (
    `Hi ${firstName}, it's C1 Staffing. Thanks for applying to ${role}. ` +
    `To stay on our list for upcoming shifts, sign up here (takes ~3 min): ${applyUrl} ` +
    `— Reply STOP to opt out.`
  );
}

function idempotencyDocId(phoneE164: string, groupId: string): string {
  const h = crypto.createHash('sha256').update(phoneE164).digest('hex').slice(0, 16);
  return `${h}__${groupId}`;
}

// ─────────────────────────────────────────────────────────────────────
// Group label lookup — best-effort
// ─────────────────────────────────────────────────────────────────────

async function readGroupLabel(tenantId: string, groupId: string): Promise<string | undefined> {
  try {
    const snap = await db
      .collection('tenants').doc(tenantId)
      .collection('userGroups').doc(groupId)
      .get();
    if (!snap.exists) return undefined;
    const data = snap.data() as Record<string, unknown> | undefined;
    const candidates = [data?.title, data?.name, data?.label];
    for (const c of candidates) {
      if (typeof c === 'string' && c.trim()) return c.trim();
    }
    return undefined;
  } catch {
    return undefined;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Callable
// ─────────────────────────────────────────────────────────────────────

export const userGroupBulkInviteCandidates = onCall(
  {
    enforceAppCheck: false,
    cors: true,
    memory: '512MiB',
    timeoutSeconds: 540,
    secrets: [
      TWILIO_ACCOUNT_SID,
      TWILIO_AUTH_TOKEN,
      TWILIO_MESSAGING_PHONE_NUMBER,
      TWILIO_A2P_CAMPAIGN,
    ],
  },
  async (request): Promise<BulkInviteResponse> => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Authentication required');
    }
    const raw = (request.data ?? {}) as Partial<BulkInviteRequest>;
    const tenantId = String(raw.tenantId ?? '').trim();
    const groupId = String(raw.groupId ?? '').trim();
    const applyUrlInput = String(raw.applyUrl ?? '').trim();
    const dryRun = raw.dryRun === true;
    const candidates = Array.isArray(raw.candidates) ? raw.candidates : [];

    if (!tenantId || !groupId) {
      throw new HttpsError('invalid-argument', 'tenantId and groupId are required');
    }
    if (candidates.length === 0) {
      throw new HttpsError('invalid-argument', 'candidates[] is required and non-empty');
    }
    if (candidates.length > HARD_CAP_CANDIDATES) {
      throw new HttpsError(
        'invalid-argument',
        `candidates[] exceeds hard cap (${HARD_CAP_CANDIDATES}). Got ${candidates.length}.`,
      );
    }
    if (!(await canManageOnboarding(request.auth, tenantId, request.auth.uid))) {
      throw new HttpsError('permission-denied', 'Not authorized for this tenant');
    }

    const appliedUrl = validateApplyUrl(applyUrlInput, groupId);
    const groupLabel = await readGroupLabel(tenantId, groupId);

    const aggregate = {
      rowsReceived: candidates.length,
      sent: 0,
      skippedAlreadySent: 0,
      skippedBadPhone: 0,
      skippedNoPhone: 0,
      skippedNoName: 0,
      twilioError: 0,
      previewed: 0,
    };
    const results: BulkInviteRowResult[] = [];

    for (const c of candidates) {
      const name = String(c?.name ?? '').trim();
      const rawPhone = String(c?.phone ?? '').trim();

      if (!rawPhone) {
        aggregate.skippedNoPhone += 1;
        results.push({ name, phone: '', status: 'skipped_no_phone' });
        continue;
      }
      const phone = normalizeE164(rawPhone);
      if (!phone) {
        aggregate.skippedBadPhone += 1;
        results.push({ name, phone: rawPhone, status: 'skipped_bad_phone' });
        continue;
      }
      // Name is nice-to-have, not required — message falls back to "there".
      if (!name) {
        aggregate.skippedNoName += 1;
        // Continue rather than skip — we'll send with the generic opener.
      }

      const docId = idempotencyDocId(phone, groupId);
      const stampRef = db
        .collection('tenants').doc(tenantId)
        .collection('bulk_invite_log').doc(docId);

      // Idempotency check — skip already-sent recipients regardless of
      // dryRun (so the preview accurately reflects what will happen).
      const existing = await stampRef.get();
      if (existing.exists) {
        aggregate.skippedAlreadySent += 1;
        results.push({ name, phone, status: 'skipped_already_sent' });
        continue;
      }

      if (dryRun) {
        aggregate.previewed += 1;
        results.push({ name, phone, status: 'preview' });
        continue;
      }

      // Real send via the unified helper — handles STOP enforcement
      // and unified logging. Errors come back as { success: false, ... }
      // rather than throwing.
      const body = buildSmsBody(firstNameOf(name), appliedUrl, groupLabel);
      const result = await sendWorkerMessageInternal(phone, body, {
        systemContext: true,
        source: 'userGroupBulkInviteCandidates',
        sourceId: groupId,
        tenantId,
        messageTypeId: 'bulk_invite_group',
      });

      if (!result.success) {
        aggregate.twilioError += 1;
        results.push({
          name,
          phone,
          status: 'twilio_error',
          error: result.errorCode
            ? `${result.errorCode}: ${result.error ?? ''}`
            : result.error ?? 'unknown_twilio_error',
        });
        continue;
      }

      // Stamp idempotency — only on confirmed send.
      try {
        await stampRef.set({
          name,
          phone,
          groupId,
          applyUrl: appliedUrl,
          source: 'csv_bulk_invite',
          externalId: c?.externalId ?? null,
          twilioSid: result.messageId,
          sentAt: admin.firestore.FieldValue.serverTimestamp(),
          sentByUid: request.auth.uid,
        });
      } catch (e) {
        // Don't fail the row on a stamp error — the SMS already went
        // out. Log so ops can spot persistent stamp failures.
        logger.warn('[userGroupBulkInvite] idempotency stamp failed', {
          tenantId,
          groupId,
          phone,
          err: e instanceof Error ? e.message : String(e),
        });
      }

      aggregate.sent += 1;
      results.push({
        name,
        phone,
        status: 'sent',
        twilioSid: result.messageId ?? undefined,
      });
    }

    logger.info('[userGroupBulkInvite] done', {
      tenantId,
      groupId,
      dryRun,
      ...aggregate,
    });

    return {
      aggregate,
      results,
      appliedUrl,
      dryRun,
    };
  },
);
