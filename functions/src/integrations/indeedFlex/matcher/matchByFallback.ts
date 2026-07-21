/**
 * **Slice 3 matcher — venue + role + date + time fallback.**
 *
 * Used when the parsed event has NO `jobId` (Indeed Flex's
 * `cancel_booking` and `change_headcount` notifications today
 * unfortunately omit it). Resolves to a shift by:
 *
 *   1. Lookup the worksite by `event.venueName` (case-insensitive
 *      contains against `tenants/{tid}/locations`) and list its
 *      shifts on `event.workDate`.
 *   2. **Account leg (2026-07-20):** when the worksite path finds
 *      nothing — the common case, since cancel-email venue strings
 *      ("Domino's, Colorado, 10252 E. 51st Ave…") rarely match a
 *      location doc by name — resolve venue → account through
 *      `matchByVenue` (alias short-circuit + IDF fuzzy) and list
 *      shifts on that date across the ACCOUNT's job orders.
 *   3. Narrow by start/end time when both sides have them (within a
 *      30-minute window in either direction to tolerate Indeed/HRX
 *      timezone or rounding drift).
 *   4. If exactly one shift survives → `fuzzy`. If multiple →
 *      `multiple`. If zero → `none`.
 *
 * The result also stamps `matchedJobOrderId` whenever we resolved a
 * unique shift (from the shift's `jobOrderId` field), and the
 * matched account when the account leg supplied the candidates.
 */

import { matchByVenue, tokenizeVenueName } from './matchByVenue';
import type { MatchResult, Reader, ReaderDoc } from './types';

/**
 * Cancel/change venue strings open with the CLIENT name:
 * "CORT, WBI (Hanover, MD) - …", "Domino's, Colorado, 10252 …".
 * Return the first comma-segment's tokens — but only when the string
 * really has that shape (≥3 segments and a street-address tail), so
 * new_request-style strings ("CHI (IN) - JW MARRIOTT…") never
 * produce a bogus client. Used to veto fuzzy account matches that
 * landed on the WRONG client via a shared rare token (observed:
 * "CORT … Maryland Warehouse" → "Domino's Distribution Center
 * Maryland" on the token 'maryland' alone).
 */
function clientTokensOf(rawVenueName: string): Set<string> | null {
  const segs = rawVenueName.split(',');
  if (segs.length < 3) return null;
  if (!segs.some((seg, i) => i > 0 && /^\s*\d+\s+\S/.test(seg))) return null;
  const tokens = tokenizeVenueName(segs[0]);
  return tokens.size > 0 ? tokens : null;
}

interface FallbackInput {
  tenantId: string;
  venueName?: string;
  workDate?: string;
  startTime?: string;
  endTime?: string;
  /** Role / position to disambiguate when one venue has multiple
   *  concurrent shifts. Optional. */
  roleName?: string;
}

/** Match window when comparing event start/end against shift
 *  defaultStartTime/defaultEndTime, in minutes. */
const TIME_TOLERANCE_MIN = 30;

export async function matchByFallback(
  reader: Reader,
  args: FallbackInput,
): Promise<MatchResult> {
  if (!args.venueName || !args.workDate) {
    return {
      matchConfidence: 'none',
      matchNotes: 'fallback requires venueName + workDate',
    };
  }

  // Leg 1 — worksite by literal name.
  const worksite = await reader.findWorksiteByName({
    tenantId: args.tenantId,
    venueName: args.venueName,
  });
  let shifts: ReaderDoc[] = [];
  let via = '';
  if (worksite) {
    shifts = await reader.listShiftsByWorksiteDate({
      tenantId: args.tenantId,
      worksiteId: worksite.id,
      workDate: args.workDate,
    });
    via = `worksite '${worksite.id}'`;
  }

  // Leg 2 — venue → account (alias + fuzzy), then the account's JOs.
  let account: { id: string; name: string } | null = null;
  let venueDiag = '';
  let venueCandidates: Array<{ id: string; name: string }> = [];
  if (shifts.length === 0) {
    const venue = await matchByVenue(reader, {
      tenantId: args.tenantId,
      venueName: args.venueName,
    });
    venueDiag = venue.notes;
    venueCandidates = venue.candidates;
    if (venue.confidence === 'exact' && venue.accountId) {
      account = { id: venue.accountId, name: venue.accountName ?? venue.accountId };
      // Client-consistency veto: the account the fuzzy pass picked
      // must share a token with the venue string's leading client
      // segment. Alias matches are recruiter-confirmed — never veto.
      const client = venue.viaAlias ? null : clientTokensOf(args.venueName);
      if (client) {
        const acctTokens = tokenizeVenueName(account.name);
        const consistent = Array.from(client).some((t) => acctTokens.has(t));
        if (!consistent) {
          venueDiag = `vetoed '${account.name}' — no overlap with client segment of '${args.venueName}'`;
          account = null;
        }
      }
    }
    if (account) {
      shifts = await reader.listShiftsForAccountDate({
        tenantId: args.tenantId,
        accountId: account.id,
        workDate: args.workDate,
      });
      via = `account '${account.name}'`;
    }
  }
  const accountStamp = account
    ? { matchedAccountId: account.id, matchedAccountName: account.name }
    : {};

  if (shifts.length === 0) {
    return {
      matchConfidence: 'none',
      ...accountStamp,
      ...(venueCandidates.length > 0 ? { candidateAccounts: venueCandidates } : {}),
      matchNotes: via
        ? `${via} has no shifts on ${args.workDate}`
        : `no worksite/account for venue '${args.venueName}'${venueDiag ? ` | ${venueDiag}` : ''}`,
    };
  }

  // Narrow by time window if both sides have one.
  let candidates = shifts;
  if (args.startTime || args.endTime) {
    candidates = shifts.filter((s) => timeWithin(s, args.startTime, args.endTime, TIME_TOLERANCE_MIN));
    if (candidates.length === 0) {
      // No shift matched the time window — but we did find shifts on
      // that worksite/date. Surface as multiple so the recruiter picks.
      return {
        matchConfidence: 'multiple',
        ...accountStamp,
        matchNotes: `${shifts.length} shift(s) via ${via} on ${args.workDate} but none within ${TIME_TOLERANCE_MIN}min of ${args.startTime ?? '?'}-${args.endTime ?? '?'}`,
      };
    }
  }

  // Optionally narrow by role.
  if (args.roleName && candidates.length > 1) {
    const roleLower = args.roleName.toLowerCase();
    const byRole = candidates.filter((s) => {
      const title = String((s.data.jobTitle as string) ?? (s.data.role as string) ?? '').toLowerCase();
      return title.length > 0 && (title === roleLower || title.includes(roleLower));
    });
    if (byRole.length > 0) candidates = byRole;
  }

  if (candidates.length === 1) {
    return {
      matchedShiftId: candidates[0].id,
      matchedJobOrderId: String(candidates[0].data.jobOrderId ?? '') || undefined,
      matchConfidence: 'fuzzy',
      ...accountStamp,
      matchNotes: `via ${via}: venue+date+time narrowed ${shifts.length} → 1`,
    };
  }
  return {
    matchConfidence: 'multiple',
    ...accountStamp,
    matchNotes: `${candidates.length} candidate shifts via ${via} on ${args.workDate}`,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function timeWithin(
  shift: ReaderDoc,
  startWanted: string | undefined,
  endWanted: string | undefined,
  toleranceMin: number,
): boolean {
  const startActual = String(
    (shift.data.defaultStartTime as string) ?? (shift.data.startTime as string) ?? '',
  );
  const endActual = String(
    (shift.data.defaultEndTime as string) ?? (shift.data.endTime as string) ?? '',
  );

  const startOk = !startWanted || withinTolerance(startActual, startWanted, toleranceMin);
  const endOk = !endWanted || withinTolerance(endActual, endWanted, toleranceMin);
  return startOk && endOk;
}

function withinTolerance(actual: string, wanted: string, toleranceMin: number): boolean {
  const a = parseHHmm(actual);
  const w = parseHHmm(wanted);
  if (a === null || w === null) return false;
  return Math.abs(a - w) <= toleranceMin;
}

function parseHHmm(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return null;
  return h * 60 + mm;
}
