/**
 * linkVenueToAccount — admin callable for the /shifts/log "Link to
 * account" UI.
 *
 * Writes a recruiter-confirmed alias at
 * `tenants/{tid}/venue_aliases/{aliasDocId}` so the next Indeed Flex
 * email carrying the same normalized venue routes automatically. When
 * `requestId` is provided, also re-runs the matcher on that specific
 * `external_shift_requests` entry so the log row flips from
 * NEEDS REVIEW → MATCHED in the same click.
 *
 * The match status flips, but `status` stays `needs_review` — the
 * recruiter still has to click "Mark applied" to actually apply the
 * shift. That extra confirmation is intentional for the first time a
 * new alias kicks in.
 *
 * Permissions: HRX or securityLevel >= 5 (recruiter/manager/admin) on
 * the tenant — same gate as the rest of the shift-log surface.
 */

import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';

import type { IndeedFlexEvent, IndeedFlexEventType } from '../../shared/indeedFlex/types';
import { createFirestoreReader } from './matcher/firestoreReader';
import { matchShiftRequest } from './matcher/matchShiftRequest';
import { recommendedActionFor } from './matcher/recommendedAction';
import { aliasDocIdFor, aliasKeyFor } from './matcher/venueAliases';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

interface Input {
  tenantId: string;
  /** The raw venueName as it appears on the email / log entry. */
  venueName: string;
  /** Target child account doc id. */
  accountId: string;
  /** Optional — when set, re-run the matcher on this specific log entry
   *  so it flips from NEEDS REVIEW → MATCHED in the same call. */
  requestId?: string;
}

interface Output {
  ok: true;
  aliasDocId: string;
  aliasKey: string;
  accountName: string;
  /** Set when `requestId` was provided AND the re-match returned a
   *  resolution (typically `'exact'` via the alias short-circuit). */
  rematchConfidence?: 'exact' | 'multiple' | 'none' | 'fuzzy';
  /** Set when the re-match found an inbox Gig JO for the account so
   *  the UI can render the resolved breakdown immediately. */
  rematchedJobOrderId?: string;
}

async function assertCallerCanEdit(callerUid: string, tenantId: string): Promise<void> {
  const snap = await db.collection('users').doc(callerUid).get();
  if (!snap.exists) throw new HttpsError('permission-denied', 'User not found');
  const data = snap.data() as Record<string, unknown>;
  if (data.isHRX === true || data.hrx === true) return;
  const tenantMeta = (data.tenantIds as Record<string, unknown> | undefined)?.[tenantId] as
    | Record<string, unknown>
    | undefined;
  if (!tenantMeta) {
    throw new HttpsError('permission-denied', 'No access to this tenant');
  }
  const role = String(tenantMeta.role || '').trim().toLowerCase();
  if (['recruiter', 'manager', 'admin'].includes(role)) return;
  const secRaw = tenantMeta.securityLevel ?? data.securityLevel ?? '0';
  const sec = parseInt(String(secRaw), 10);
  if (!Number.isNaN(sec) && sec >= 5) return;
  throw new HttpsError('permission-denied', 'Not authorized to link venue aliases');
}

export const linkVenueToAccount = onCall<Input, Promise<Output>>(
  {
    enforceAppCheck: false,
    cors: true,
    memory: '512MiB',
    timeoutSeconds: 60,
  },
  async (req): Promise<Output> => {
    if (!req.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Authentication required');
    }
    const { tenantId, venueName, accountId, requestId } = req.data || ({} as Input);
    if (!tenantId || !venueName?.trim() || !accountId?.trim()) {
      throw new HttpsError(
        'invalid-argument',
        'tenantId, venueName, accountId are required',
      );
    }
    await assertCallerCanEdit(req.auth.uid, tenantId);

    const aliasKey = aliasKeyFor(venueName);
    if (!aliasKey) {
      throw new HttpsError(
        'invalid-argument',
        `venueName "${venueName}" normalizes to empty — cannot key an alias on it`,
      );
    }
    const aliasDocId = aliasDocIdFor(venueName);

    // Look up the target account so we can snapshot its name onto the
    // alias doc. Also a useful permission cross-check — if the account
    // doesn't exist, the alias would be useless.
    const accountSnap = await db
      .collection('tenants')
      .doc(tenantId)
      .collection('accounts')
      .doc(accountId)
      .get();
    if (!accountSnap.exists) {
      throw new HttpsError('not-found', `Account ${accountId} not found on tenant`);
    }
    const accountName =
      String((accountSnap.data() as Record<string, unknown>).name ?? '').trim() || accountId;

    // Write (or overwrite) the alias.
    await db
      .collection('tenants')
      .doc(tenantId)
      .collection('venue_aliases')
      .doc(aliasDocId)
      .set(
        {
          tenantId,
          aliasKey,
          venueNameRaw: venueName.trim(),
          accountId,
          accountName,
          createdBy: req.auth.uid,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

    logger.info('[linkVenueToAccount] alias written', {
      tenantId,
      aliasDocId,
      aliasKey,
      accountId,
      callerUid: req.auth.uid,
      requestId: requestId ?? null,
    });

    const result: Output = { ok: true, aliasDocId, aliasKey, accountName };

    // Optionally re-run the matcher on the originating log entry so
    // the row flips to MATCHED immediately.
    if (requestId) {
      const reqRef = db
        .collection('tenants')
        .doc(tenantId)
        .collection('external_shift_requests')
        .doc(requestId);
      const reqSnap = await reqRef.get();
      if (reqSnap.exists) {
        const reqData = reqSnap.data() as Record<string, unknown>;
        const event = reqData.event as IndeedFlexEvent | undefined;
        if (event) {
          const reader = createFirestoreReader(db);
          try {
            const matched = await matchShiftRequest(reader, { tenantId, event });
            const updates: Record<string, unknown> = {
              matchConfidence: matched.matchConfidence,
              matchedAt: new Date().toISOString(),
              recommendedAction: recommendedActionFor(
                reqData.eventType as IndeedFlexEventType,
                matched.matchConfidence,
              ),
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            };
            if (matched.matchedShiftId) updates.matchedShiftId = matched.matchedShiftId;
            if (matched.matchedJobOrderId) updates.matchedJobOrderId = matched.matchedJobOrderId;
            if (matched.matchedAssignmentIds && matched.matchedAssignmentIds.length > 0) {
              updates.matchedAssignmentIds = matched.matchedAssignmentIds;
            }
            if (matched.matchNotes) updates.matchNotes = matched.matchNotes;
            if (matched.matchedAccountId) updates.matchedAccountId = matched.matchedAccountId;
            if (matched.matchedAccountName) updates.matchedAccountName = matched.matchedAccountName;
            if (matched.venueKey) updates.venueKey = matched.venueKey;
            if (matched.candidateAccounts && matched.candidateAccounts.length > 0) {
              updates.candidateAccounts = matched.candidateAccounts;
            }
            if (matched.wouldCreateNewJobOrder !== undefined) {
              updates.wouldCreateNewJobOrder = matched.wouldCreateNewJobOrder;
            }
            await reqRef.update(updates);
            result.rematchConfidence = matched.matchConfidence;
            if (matched.matchedJobOrderId) {
              result.rematchedJobOrderId = matched.matchedJobOrderId;
            }
          } catch (err) {
            logger.warn('[linkVenueToAccount] re-match failed (alias still written)', {
              tenantId,
              requestId,
              err: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }
    }

    return result;
  },
);
