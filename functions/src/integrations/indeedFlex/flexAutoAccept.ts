/**
 * Natalie's auto-accept for Indeed Flex NEW job requests (2026-09-07).
 *
 * When a `new_request` row resolves to an HRX account with `exact`
 * confidence (recruiter-linked venue alias or an unambiguous fuzzy hit),
 * queue an `accept_job_request` portal action so the always-on worker
 * clicks Respond → Confirm in the agency portal as Natalie Brooks. Until
 * now these requests sat in the /shifts/log inbox and expired ("Booking
 * deadline passed") whenever nobody clicked in time — three OnTrac Denver
 * orders were lost that way on 2026-09-06/07.
 *
 * Policy lives in `tenants/{t}/app_config/indeed_flex`:
 *
 *   autoAcceptNewRequests: boolean          // master switch (default OFF)
 *   autoAcceptAccountIds?: string[]         // allow-list; empty/absent = every exact-matched account
 *   autoAcceptExcludeAccountIds?: string[]  // never for these accounts
 *   autoAcceptDryRun?: boolean              // walk the flow + screenshot, never click Confirm
 *   autoAcceptMaxHeadcount?: number         // leave for a human above this many workers/day
 *
 * The action id keys on the Flex job id, so the onCreate trigger, a
 * recruiter's "Link to account" re-match and a manual enqueue all collapse
 * onto one row. The request doc gets `portalAccept` stamped for the log UI.
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';

import { enqueuePortalAction } from '../portalActions/enqueuePortalAction';

export interface FlexAutoAcceptConfig {
  autoAcceptNewRequests?: boolean;
  autoAcceptAccountIds?: string[];
  autoAcceptExcludeAccountIds?: string[];
  autoAcceptDryRun?: boolean;
  autoAcceptMaxHeadcount?: number;
}

export interface FlexAutoAcceptCandidate {
  requestId: string;
  eventType?: string;
  status?: string;
  matchConfidence?: string;
  matchedAccountId?: string;
  matchedAccountName?: string;
  event?: { jobId?: string; headcount?: number; workDate?: string; endDate?: string; venueName?: string };
}

export type FlexAutoAcceptDecision =
  | { accept: true; dryRun: boolean; flexJobId: string; headcount: number | null }
  | { accept: false; reason: string };

/** Pure policy — unit-tested; `todayIso` is YYYY-MM-DD (UTC is fine: the date gate is coarse). */
export function decideFlexAutoAccept(
  cfg: FlexAutoAcceptConfig | null | undefined,
  row: FlexAutoAcceptCandidate,
  todayIso: string,
): FlexAutoAcceptDecision {
  if (!cfg?.autoAcceptNewRequests) {
    return { accept: false, reason: 'auto-accept is off (app_config/indeed_flex.autoAcceptNewRequests)' };
  }
  if (row.eventType !== 'new_request') {
    return { accept: false, reason: `eventType ${row.eventType ?? 'unknown'} is not new_request` };
  }
  if (row.status && row.status !== 'needs_review') {
    return { accept: false, reason: `status ${row.status} already decided` };
  }
  if (row.matchConfidence !== 'exact') {
    return { accept: false, reason: `match confidence ${row.matchConfidence ?? 'none'} is not exact` };
  }
  const accountId = String(row.matchedAccountId ?? '').trim();
  if (!accountId) return { accept: false, reason: 'no matched account' };
  if ((cfg.autoAcceptExcludeAccountIds ?? []).includes(accountId)) {
    return { accept: false, reason: `account ${accountId} is excluded` };
  }
  const allow = cfg.autoAcceptAccountIds ?? [];
  if (allow.length > 0 && !allow.includes(accountId)) {
    return { accept: false, reason: `account ${accountId} is not on the allow-list` };
  }
  const flexJobId = String(row.event?.jobId ?? '').trim();
  if (!/^\d+$/.test(flexJobId)) return { accept: false, reason: 'the email carried no numeric Indeed job id' };
  const end = (row.event?.endDate || row.event?.workDate || '').slice(0, 10);
  if (end && end < todayIso) return { accept: false, reason: `shift ended ${end} — stale request` };
  const hc = Number(row.event?.headcount);
  const headcount = Number.isFinite(hc) && hc > 0 ? hc : null;
  if (cfg.autoAcceptMaxHeadcount != null && headcount != null && headcount > cfg.autoAcceptMaxHeadcount) {
    return {
      accept: false,
      reason: `headcount ${headcount} exceeds autoAcceptMaxHeadcount ${cfg.autoAcceptMaxHeadcount}`,
    };
  }
  return { accept: true, dryRun: cfg.autoAcceptDryRun === true, flexJobId, headcount };
}

export async function loadFlexAutoAcceptConfig(
  db: admin.firestore.Firestore,
  tenantId: string,
): Promise<FlexAutoAcceptConfig | null> {
  const snap = await db.doc(`tenants/${tenantId}/app_config/indeed_flex`).get();
  return snap.exists ? (snap.data() as FlexAutoAcceptConfig) : null;
}

/**
 * Evaluate the policy for one request row and enqueue the portal action
 * when it passes. Never throws — a producer failure must not break the
 * matcher that called it. Returns what happened for the caller's logs.
 */
export async function maybeEnqueueFlexAccept(
  db: admin.firestore.Firestore,
  tenantId: string,
  row: FlexAutoAcceptCandidate,
  source: string,
): Promise<{ enqueued: boolean; actionId?: string; reason?: string }> {
  try {
    const cfg = await loadFlexAutoAcceptConfig(db, tenantId);
    const decision = decideFlexAutoAccept(cfg, row, new Date().toISOString().slice(0, 10));
    if (!decision.accept) {
      logger.info('[flexAutoAccept] skipped', { tenantId, requestId: row.requestId, reason: decision.reason });
      return { enqueued: false, reason: decision.reason };
    }
    const res = await enqueuePortalAction(db, {
      tenantId,
      action: 'accept_job_request',
      payload: {
        flexJobId: decision.flexJobId,
        ...(decision.headcount != null ? { acceptHeadcount: decision.headcount } : {}),
        ...(decision.dryRun ? { dryRun: true } : {}),
        externalShiftRequestId: row.requestId,
        reason: 'auto_accept',
      },
      refs: { externalShiftRequestId: row.requestId },
      createdBy: { kind: 'system', id: source },
      priority: 10,
      maxAttempts: 3,
    });
    await db.doc(`tenants/${tenantId}/external_shift_requests/${row.requestId}`).set(
      {
        portalAccept: {
          actionId: res.id,
          enqueuedAt: new Date().toISOString(),
          created: res.created,
          dryRun: decision.dryRun,
          accountId: row.matchedAccountId ?? null,
          accountName: row.matchedAccountName ?? null,
        },
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    logger.info('[flexAutoAccept] enqueued', {
      tenantId,
      requestId: row.requestId,
      actionId: res.id,
      created: res.created,
      dryRun: decision.dryRun,
    });
    return { enqueued: true, actionId: res.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('[flexAutoAccept] failed', { tenantId, requestId: row.requestId, err: message });
    return { enqueued: false, reason: `error: ${message}` };
  }
}
