/**
 * Fill-empty merge: national account `orderDefaults`, `defaults.billing`,
 * `defaults.rules`, and a few top-level fields onto child account docs. Used by
 * `syncNationalCascadingDefaultsToChildrenCallable`.
 */

import cloneDeep from 'lodash/cloneDeep';
import isEqual from 'lodash/isEqual';

import { decideHiringEntitySyncForDoc } from '../jobOrders/syncHiringEntityFromNationalAccount';

/** Treat NBSP / BOM / zero-width chars as empty so fill-empty sync still copies national copy. */
export function isBlankDefaultString(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v !== 'string') return true;
  const stripped = v.replace(/[\u200b-\u200d\ufeff\u00a0]/g, '').trim();
  return stripped === '';
}

export interface ChildCascadeMergePatch {
  hiringEntityId?: string;
  orderDefaults?: Record<string, unknown>;
  defaultGigJobTitle?: string;
  defaultGigJobDescription?: string;
  /** Full merged `defaults` object (preserves child's eVerify; updates billing/rules fill-empty). */
  defaults?: Record<string, unknown>;
  /** Self-heal: legacy auto-created children created before `accountType: 'child'` stamp. */
  accountType?: 'child';
}

/** Merge parent `defaults.rules` (customer rules & policies) — fill-empty only. Exported for tests. */
export function mergeRulesDefaultsFillEmpty(
  childRules: Record<string, unknown> | undefined,
  parentRules: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!parentRules || typeof parentRules !== 'object') {
    return childRules && typeof childRules === 'object' ? cloneDeep(childRules) : undefined;
  }

  const base =
    childRules && typeof childRules === 'object' ? cloneDeep(childRules) : {};

  const boolKeys = ['replacingExistingAgency', 'rolloverExistingStaff'] as const;
  for (const k of boolKeys) {
    if (!(k in parentRules) || typeof parentRules[k] !== 'boolean') continue;
    if (!(k in base)) {
      base[k] = parentRules[k];
    }
  }

  const stringKeys = [
    'timeclockSystem',
    'attendancePolicy',
    'noShowPolicy',
    'overtimePolicy',
    'callOffPolicy',
    'injuryHandlingPolicy',
    'disciplinePolicy',
  ] as const;
  for (const k of stringKeys) {
    if (!(k in parentRules)) continue;
    const pv = parentRules[k];
    if (typeof pv !== 'string' || isBlankDefaultString(pv)) continue;
    const cv = base[k];
    if (isBlankDefaultString(cv)) base[k] = pv;
  }

  return base;
}

/** Merge parent `defaults.billing` into child's billing slice — fill-empty only. Exported for tests. */
export function mergeBillingDefaultsFillEmpty(
  childBilling: Record<string, unknown> | undefined,
  parentBilling: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!parentBilling || typeof parentBilling !== 'object') {
    return childBilling && typeof childBilling === 'object' ? cloneDeep(childBilling) : undefined;
  }

  const base =
    childBilling && typeof childBilling === 'object' ? cloneDeep(childBilling) : {};

  if ('poRequired' in parentBilling && typeof parentBilling.poRequired === 'boolean') {
    if (!('poRequired' in base)) {
      base.poRequired = parentBilling.poRequired;
    }
  }

  const stringKeys = ['paymentTerms', 'invoiceDeliveryMethod', 'invoiceFrequency', 'billingNotes'] as const;
  for (const k of stringKeys) {
    if (!(k in parentBilling)) continue;
    const pv = parentBilling[k];
    if (typeof pv !== 'string' || isBlankDefaultString(pv)) continue;
    const cv = base[k];
    if (isBlankDefaultString(cv)) base[k] = pv;
  }

  const pSend = parentBilling.sendInvoicesTo;
  const cSend = base.sendInvoicesTo;
  const childSendEmpty = !Array.isArray(cSend) || cSend.length === 0;
  if (childSendEmpty && Array.isArray(pSend) && pSend.length > 0) {
    base.sendInvoicesTo = [...pSend];
  }

  return base;
}

function mergeAccountDefaultsBillingAndRulesFillEmpty(
  child: Record<string, unknown>,
  parent: Record<string, unknown>,
): Record<string, unknown> | null {
  const childDefaultsRaw = child.defaults;
  const childDefaults =
    childDefaultsRaw && typeof childDefaultsRaw === 'object'
      ? cloneDeep(childDefaultsRaw as Record<string, unknown>)
      : {};

  const parentDefaults =
    parent.defaults && typeof parent.defaults === 'object'
      ? (parent.defaults as Record<string, unknown>)
      : undefined;

  let touched = false;

  const mergedBilling = mergeBillingDefaultsFillEmpty(
    childDefaults.billing as Record<string, unknown> | undefined,
    parentDefaults?.billing as Record<string, unknown> | undefined,
  );
  const prevBillingRaw = childDefaults.billing ?? {};
  const prevBilling =
    prevBillingRaw && typeof prevBillingRaw === 'object'
      ? prevBillingRaw
      : ({} as Record<string, unknown>);
  if (mergedBilling !== undefined && !isEqual(mergedBilling, prevBilling)) {
    childDefaults.billing = mergedBilling;
    touched = true;
  }

  const mergedRules = mergeRulesDefaultsFillEmpty(
    childDefaults.rules as Record<string, unknown> | undefined,
    parentDefaults?.rules as Record<string, unknown> | undefined,
  );
  const prevRulesRaw = childDefaults.rules ?? {};
  const prevRules =
    prevRulesRaw && typeof prevRulesRaw === 'object'
      ? prevRulesRaw
      : ({} as Record<string, unknown>);
  if (mergedRules !== undefined && !isEqual(mergedRules, prevRules)) {
    childDefaults.rules = mergedRules;
    touched = true;
  }

  if (!touched) return null;
  return childDefaults;
}

function mergeStaffInstructionsSections(
  childStaff: Record<string, unknown> | undefined,
  parentStaff: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> =
    childStaff && typeof childStaff === 'object' ? cloneDeep(childStaff) : {};

  for (const key of Object.keys(parentStaff)) {
    const pSec = parentStaff[key];
    if (!pSec || typeof pSec !== 'object') continue;
    const p = pSec as Record<string, unknown>;
    const cRaw = out[key];
    const c: Record<string, unknown> =
      cRaw && typeof cRaw === 'object' ? cloneDeep(cRaw as Record<string, unknown>) : {};

    const pText = typeof p.text === 'string' ? p.text : '';
    const cText = typeof c.text === 'string' ? c.text : '';
    const childTextEmpty = cText.trim() === '';
    if (childTextEmpty && pText.trim() !== '') {
      c.text = pText;
    }

    const pFiles = Array.isArray(p.files) ? p.files : [];
    const cFiles = Array.isArray(c.files) ? c.files : [];
    const childFilesEmpty = cFiles.length === 0;
    if (childFilesEmpty && pFiles.length > 0) {
      c.files = pFiles;
    }

    if (Object.keys(c).length > 0) {
      out[key] = c;
    }
  }

  return out;
}

function mergeOrderDetailsFillEmpty(
  child: Record<string, unknown>,
  parent: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...child };
  for (const key of Object.keys(parent)) {
    const pv = parent[key];
    const cv = out[key];

    if (Array.isArray(pv)) {
      const childEmpty = !Array.isArray(cv) || cv.length === 0;
      if (childEmpty && pv.length > 0) {
        out[key] = [...pv];
      }
      continue;
    }

    if (typeof pv === 'string') {
      const childEmpty = isBlankDefaultString(cv);
      if (childEmpty && !isBlankDefaultString(pv)) {
        out[key] = pv;
      }
      continue;
    }

    if (typeof pv === 'number') {
      if (cv === undefined || cv === null) {
        out[key] = pv;
      }
      continue;
    }

    if (pv === null || pv === undefined) {
      continue;
    }

    if (typeof pv === 'boolean') {
      if (cv === undefined || cv === null) {
        out[key] = pv;
      }
    }
  }
  return out;
}

/** Returns merged child `orderDefaults` (fill-empty from parent). */
export function mergeOrderDefaultsFillEmpty(
  childOd: Record<string, unknown> | undefined,
  parentOd: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!parentOd || typeof parentOd !== 'object') {
    return childOd && typeof childOd === 'object' ? cloneDeep(childOd) : undefined;
  }

  const base: Record<string, unknown> =
    childOd && typeof childOd === 'object' ? cloneDeep(childOd) : {};

  const pidParent =
    typeof parentOd.screeningPackageId === 'string' ? parentOd.screeningPackageId.trim() : '';
  const pidChild =
    typeof base.screeningPackageId === 'string' ? base.screeningPackageId.trim() : '';
  if (!pidChild && pidParent) {
    base.screeningPackageId = parentOd.screeningPackageId;
    base.screeningPackageName =
      typeof parentOd.screeningPackageName === 'string' ? parentOd.screeningPackageName : '';
  }

  if (
    (base.screeningValidityDays === undefined || base.screeningValidityDays === null) &&
    parentOd.screeningValidityDays !== undefined &&
    parentOd.screeningValidityDays !== null
  ) {
    base.screeningValidityDays = parentOd.screeningValidityDays;
  }

  if (parentOd.staffInstructions && typeof parentOd.staffInstructions === 'object') {
    base.staffInstructions = mergeStaffInstructionsSections(
      base.staffInstructions as Record<string, unknown> | undefined,
      parentOd.staffInstructions as Record<string, unknown>,
    );
  }

  if (parentOd.orderDetails && typeof parentOd.orderDetails === 'object') {
    const childDetails =
      base.orderDetails && typeof base.orderDetails === 'object'
        ? cloneDeep(base.orderDetails as Record<string, unknown>)
        : {};
    base.orderDetails = mergeOrderDetailsFillEmpty(
      childDetails,
      parentOd.orderDetails as Record<string, unknown>,
    );
  }

  return base;
}

/** Patch object to apply to a child account, or null if nothing would change. */
export function buildChildCascadePatch(args: {
  child: Record<string, unknown>;
  parent: Record<string, unknown>;
}): ChildCascadeMergePatch | null {
  const { child, parent } = args;
  const patch: ChildCascadeMergePatch = {};

  const nationalHe =
    typeof parent.hiringEntityId === 'string' ? parent.hiringEntityId.trim() : '';
  if (nationalHe) {
    const decision = decideHiringEntitySyncForDoc({
      currentValue: child.hiringEntityId,
      nationalHiringEntityId: nationalHe,
    });
    if (decision.kind === 'update') {
      patch.hiringEntityId = nationalHe;
    }
  }

  const prevOd =
    child.orderDefaults && typeof child.orderDefaults === 'object'
      ? (child.orderDefaults as Record<string, unknown>)
      : undefined;
  const mergedOd = mergeOrderDefaultsFillEmpty(
    prevOd,
    parent.orderDefaults as Record<string, unknown> | undefined,
  );
  const normalizedPrev = prevOd ?? {};
  if (mergedOd !== undefined && !isEqual(mergedOd, normalizedPrev)) {
    patch.orderDefaults = mergedOd;
  }

  for (const field of ['defaultGigJobTitle', 'defaultGigJobDescription'] as const) {
    const pv = parent[field];
    const cv = child[field];
    if (typeof pv === 'string' && pv.trim() !== '') {
      const empty = typeof cv !== 'string' || cv.trim() === '';
      if (empty) {
        patch[field] = pv;
      }
    }
  }

  const mergedDefaults = mergeAccountDefaultsBillingAndRulesFillEmpty(child, parent);
  if (mergedDefaults !== null) {
    patch.defaults = mergedDefaults;
  }

  // Backfill `accountType` on legacy children that pre-date the auto-create stamp.
  if (child.accountType !== 'child' && typeof child.parentAccountId === 'string' && child.parentAccountId.trim()) {
    patch.accountType = 'child';
  }

  if (Object.keys(patch).length === 0) return null;
  return patch;
}
