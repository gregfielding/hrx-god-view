/**
 * **PI-4 (2026-07-21) — dress Flex-born shifts at birth.**
 *
 * Shifts created by `applyNewRequest` carried no payRate / billRate /
 * wcCode / worksite — the same hole that produced the CORT −10% margin
 * on the money view. Greg's point: the rates already exist — the
 * national-account cascade fills `pricing` (flatMarkupPercent +
 * per-position rates) onto every child account, and inbox JOs carry
 * `gigPositions`. This module resolves a shift's money fields from
 * those sources, in order:
 *
 *   payRate:  email (`payRateUsd`) → JO gigPosition (role-matched) →
 *             account pricing position (role-matched)
 *   billRate: position billRate — but ONLY when the position's pay is
 *             the pay we're using; otherwise derived from the markup
 *             (position markupPercent → account flatMarkupPercent) so
 *             bill always tracks the actual pay.
 *   wcCode:   role-matched position's workersCompCode (JO → account).
 *
 * Role matching is deliberately loose (exact → contains → single
 * shared-token candidate) because Indeed's role names differ from
 * HRX position titles ("Warehouse Operative" vs "Warehouse
 * Associate").
 *
 * Pure module — no Firestore — so the resolution order is unit-tested
 * directly.
 */

export interface PricedPosition {
  jobTitle?: string;
  payRate?: unknown;
  billRate?: unknown;
  markupPercent?: unknown;
  workersCompCode?: unknown;
}

export interface ShiftDressingInput {
  roleName?: string;
  /** Pay parsed off the email, when present. Wins for payRate. */
  emailPayRate?: number;
  joGigPositions?: PricedPosition[];
  accountPricing?: {
    flatMarkupPercent?: unknown;
    positions?: PricedPosition[];
  };
}

export interface ShiftDressing {
  payRate?: number;
  billRate?: number;
  wcCode?: string;
  /** Which source supplied the pay — stamped for transparency. */
  paySource?: 'email' | 'jo_position' | 'account_position';
}

function num(v: unknown): number | undefined {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function tokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 3),
  );
}

/** Best position for a role: exact title → contains → the single
 *  position sharing ≥1 token. Null when nothing matches confidently. */
export function matchPosition(
  roleName: string,
  positions: PricedPosition[],
): PricedPosition | null {
  const role = roleName.trim().toLowerCase();
  if (!role || positions.length === 0) return null;
  const titled = positions.filter((p) => String(p.jobTitle ?? '').trim());
  const exact = titled.find((p) => String(p.jobTitle).trim().toLowerCase() === role);
  if (exact) return exact;
  // Containment and token overlap must both be UNIQUE — "Associate"
  // is contained in several titles and proves nothing.
  const contains = titled.filter((p) => {
    const t = String(p.jobTitle).trim().toLowerCase();
    return t.includes(role) || role.includes(t);
  });
  if (contains.length === 1) return contains[0];
  const roleToks = tokens(role);
  const sharing = titled.filter((p) =>
    [...tokens(String(p.jobTitle))].some((t) => roleToks.has(t)),
  );
  return sharing.length === 1 ? sharing[0] : null;
}

export function resolveShiftDressing(input: ShiftDressingInput): ShiftDressing {
  const role = String(input.roleName ?? '').trim();
  const joPos = role ? matchPosition(role, input.joGigPositions ?? []) : null;
  const acctPos = role ? matchPosition(role, input.accountPricing?.positions ?? []) : null;
  const pos = joPos ?? acctPos;

  const posPay = num(pos?.payRate);
  const payRate = input.emailPayRate ?? posPay;
  const paySource: ShiftDressing['paySource'] =
    input.emailPayRate !== undefined
      ? 'email'
      : joPos && num(joPos.payRate) !== undefined
        ? 'jo_position'
        : acctPos && num(acctPos.payRate) !== undefined
          ? 'account_position'
          : undefined;

  const markup =
    num(pos?.markupPercent) ?? num(input.accountPricing?.flatMarkupPercent);
  let billRate: number | undefined;
  const posBill = num(pos?.billRate);
  if (posBill !== undefined && payRate !== undefined && posPay === payRate) {
    // The position's bill corresponds to the pay we're actually using.
    billRate = posBill;
  } else if (payRate !== undefined && markup !== undefined) {
    billRate = Math.round(payRate * (1 + markup / 100) * 100) / 100;
  } else if (posBill !== undefined && payRate === undefined) {
    billRate = posBill;
  }

  const wcCode =
    String(joPos?.workersCompCode ?? '').trim() ||
    String(acctPos?.workersCompCode ?? '').trim() ||
    undefined;

  const out: ShiftDressing = {};
  if (payRate !== undefined) {
    out.payRate = payRate;
    out.paySource = paySource;
  }
  if (billRate !== undefined) out.billRate = billRate;
  if (wcCode) out.wcCode = wcCode;
  return out;
}
