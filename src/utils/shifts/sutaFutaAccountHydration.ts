/**
 * On shift drawer load, when SUTA/FUTA are missing on the job order and the
 * worksite state + C1 hiring entity match `EditShiftForm` display rules, persist
 * estimated rates to:
 *   - `positions[]` / `gigPositions[]` (or legacy top-level fields)
 *   - matching rows in `accounts/{recruiterAccountId}.pricing.positions` by job title
 */

import { doc, getDoc, serverTimestamp, updateDoc } from 'firebase/firestore';

import { db } from '../../firebase';
import { p } from '../../data/firestorePaths';
import { getFutaRateByState, getSutaRateByState, normalizeStateCode } from '../unemploymentRates';

/** Same gate as `EditShiftForm` — estimated unemployment rates apply for these entities. */
export function isC1UnemploymentPricingEntity(entityName: string | null | undefined): boolean {
  return /C1 Workforce|C1 Select/i.test(entityName || '');
}

export function getWorksiteStateCodeFromJobOrder(jobOrder: Record<string, unknown> | null | undefined): string {
  if (!jobOrder) return '';
  const candidates: unknown[] = [
    (jobOrder.worksiteAddress as Record<string, unknown> | undefined)?.state,
    jobOrder.worksiteState,
    jobOrder.locationState,
    (jobOrder.address as Record<string, unknown> | undefined)?.state,
  ];
  for (const c of candidates) {
    const code = normalizeStateCode(typeof c === 'string' ? c : '')
      .trim()
      .toUpperCase();
    if (code) return code;
  }
  return '';
}

function isRateMissing(v: unknown): boolean {
  if (v == null) return true;
  const s = String(v).trim();
  if (!s) return true;
  const n = parseFloat(s);
  return !Number.isFinite(n);
}

function parseFiniteNumber(v: unknown): number | undefined {
  if (v == null) return undefined;
  const n = typeof v === 'number' ? v : parseFloat(String(v).trim());
  return Number.isFinite(n) ? n : undefined;
}

/** Align with `EditShiftForm.mapPos` pay/bill reconciliation. */
function effectivePayBill(pos: Record<string, unknown>): { pay: number; bill: number } | null {
  const pay = parseFiniteNumber(pos.payRate);
  let bill = parseFiniteNumber(pos.billRate);
  const markupRaw = pos.markup ?? pos.markupPercent ?? pos.markupPercentage;
  const markup = parseFiniteNumber(markupRaw);
  if (pay != null && pay > 0 && (bill == null || bill <= 0) && markup != null && markup > 0) {
    bill = Number((pay * (1 + markup / 100)).toFixed(2));
  }
  if (pay == null || pay <= 0 || bill == null || bill <= 0) return null;
  return { pay, bill };
}

function pickPositionsArray(jobOrder: Record<string, unknown>): {
  field: 'positions' | 'gigPositions' | null;
  rows: Record<string, unknown>[];
} {
  if (Array.isArray(jobOrder.positions) && jobOrder.positions.length > 0) {
    return { field: 'positions', rows: jobOrder.positions as Record<string, unknown>[] };
  }
  if (
    jobOrder.jobType === 'gig' &&
    Array.isArray(jobOrder.gigPositions) &&
    (jobOrder.gigPositions as unknown[]).length > 0
  ) {
    return { field: 'gigPositions', rows: jobOrder.gigPositions as Record<string, unknown>[] };
  }
  return { field: null, rows: [] };
}

export function collectJobTitlesFromJobOrder(jobOrder: Record<string, unknown>): Set<string> {
  const titles = new Set<string>();
  const { rows } = pickPositionsArray(jobOrder);
  if (rows.length > 0) {
    for (const r of rows) {
      const t = String(r.jobTitle ?? '').trim().toLowerCase();
      if (t) titles.add(t);
    }
  } else {
    const t = String(jobOrder.jobTitle ?? '').trim().toLowerCase();
    if (t) titles.add(t);
  }
  return titles;
}

export async function persistMissingSutaFutaForJobOrderAndAccount(params: {
  tenantId: string;
  jobOrderId: string;
  jobOrder: Record<string, unknown>;
  hiringEntityName: string | null | undefined;
  userId: string | null | undefined;
  /**
   * When true, bypass the C1 hiring-entity gate. Use for explicit
   * recruiter-initiated "Apply state default" actions where the
   * recruiter has decided unemployment rates apply regardless of the
   * entity classification.
   */
  force?: boolean;
}): Promise<{ wroteJobOrder: boolean; wroteAccount: boolean }> {
  const { tenantId, jobOrderId, jobOrder, hiringEntityName, userId, force } = params;

  if (!force && !isC1UnemploymentPricingEntity(hiringEntityName ?? undefined)) {
    return { wroteJobOrder: false, wroteAccount: false };
  }

  const state = getWorksiteStateCodeFromJobOrder(jobOrder);
  if (!state) return { wroteJobOrder: false, wroteAccount: false };

  const sutaForState = getSutaRateByState(state);
  const futaForState = getFutaRateByState(state);

  const { field: arrayField, rows } = pickPositionsArray(jobOrder);

  const patchPositionRow = (pos: Record<string, unknown>): Record<string, unknown> => {
    if (!effectivePayBill(pos)) return pos;
    const needsSuta = isRateMissing(pos.sutaRate ?? pos.suta);
    const needsFuta = isRateMissing(pos.futaRate ?? pos.futa);
    if (!needsSuta && !needsFuta) return pos;
    if (needsSuta && sutaForState == null) {
      if (!needsFuta) return pos;
    }
    const out = { ...pos };
    if (needsSuta && sutaForState != null) out.sutaRate = sutaForState;
    if (needsFuta) out.futaRate = futaForState;
    return out;
  };

  let wroteJobOrder = false;
  const joRef = doc(db, p.jobOrder(tenantId, jobOrderId));

  if (arrayField && rows.length > 0) {
    const nextRows = rows.map((row) => patchPositionRow(row));
    const changed = nextRows.some((r, i) => r !== rows[i]);
    if (changed) {
      await updateDoc(joRef, {
        [arrayField]: nextRows,
        updatedAt: serverTimestamp(),
        ...(userId ? { updatedBy: userId } : {}),
      });
      wroteJobOrder = true;
    }
  } else if (jobOrder.jobTitle) {
    const synthetic: Record<string, unknown> = {
      jobTitle: jobOrder.jobTitle,
      payRate: jobOrder.payRate,
      billRate: jobOrder.billRate,
      markup: jobOrder.markup ?? jobOrder.markupPercent ?? jobOrder.markupPercentage,
      sutaRate: jobOrder.sutaRate ?? jobOrder.suta,
      futaRate: jobOrder.futaRate ?? jobOrder.futa,
    };
    if (effectivePayBill(synthetic)) {
      const needsSuta = isRateMissing(jobOrder.sutaRate ?? jobOrder.suta);
      const needsFuta = isRateMissing(jobOrder.futaRate ?? jobOrder.futa);
      const canPatchSuta = needsSuta && sutaForState != null;
      if (canPatchSuta || needsFuta) {
        await updateDoc(joRef, {
          ...(canPatchSuta ? { sutaRate: sutaForState } : {}),
          ...(needsFuta ? { futaRate: futaForState } : {}),
          updatedAt: serverTimestamp(),
          ...(userId ? { updatedBy: userId } : {}),
        });
        wroteJobOrder = true;
      }
    }
  }

  let wroteAccount = false;
  const recruiterAccountId = String(jobOrder.recruiterAccountId ?? jobOrder.accountId ?? '').trim();
  const titlesFromJo = collectJobTitlesFromJobOrder(jobOrder);

  if (!recruiterAccountId || titlesFromJo.size === 0) {
    return { wroteJobOrder, wroteAccount };
  }

  const accRef = doc(db, p.recruiterAccount(tenantId, recruiterAccountId));
  const accSnap = await getDoc(accRef);
  if (!accSnap.exists()) return { wroteJobOrder, wroteAccount };

  const accData = accSnap.data() as Record<string, unknown>;
  const pricing = (accData.pricing as Record<string, unknown> | undefined) ?? {};
  const accPositions = Array.isArray(pricing.positions)
    ? ([...pricing.positions] as Record<string, unknown>[])
    : [];

  let accChanged = false;
  for (let i = 0; i < accPositions.length; i++) {
    const row = accPositions[i];
    const title = String(row.jobTitle ?? '').trim().toLowerCase();
    if (!title || !titlesFromJo.has(title)) continue;

    const pay = parseFiniteNumber(row.payRate);
    let bill = parseFiniteNumber(row.billRate);
    const markup = parseFiniteNumber(row.markupPercent);
    if (pay != null && pay > 0 && (bill == null || bill <= 0) && markup != null && markup > 0) {
      bill = Number((pay * (1 + markup / 100)).toFixed(2));
    }
    if (pay == null || pay <= 0 || bill == null || bill <= 0) continue;

    const needsSuta = isRateMissing(row.sutaRate);
    const needsFuta = isRateMissing(row.futaRate);
    if (!needsSuta && !needsFuta) continue;
    if (needsSuta && sutaForState == null && !needsFuta) continue;

    const nextRow = { ...row };
    if (needsSuta && sutaForState != null) nextRow.sutaRate = sutaForState;
    if (needsFuta) nextRow.futaRate = futaForState;
    accPositions[i] = nextRow;
    accChanged = true;
  }

  if (accChanged) {
    await updateDoc(accRef, {
      'pricing.positions': accPositions,
      updatedAt: serverTimestamp(),
      ...(userId ? { updatedBy: userId } : {}),
    });
    wroteAccount = true;
  }

  return { wroteJobOrder, wroteAccount };
}
