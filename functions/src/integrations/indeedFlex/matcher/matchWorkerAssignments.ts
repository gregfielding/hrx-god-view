/**
 * **Slice 3 matcher — worker name → assignment id.**
 *
 * Used by `cancel_booking` (one or more workers) and `no_show` (one
 * worker). Given a resolved shiftId from the upstream matcher,
 * lists the shift's assignments and matches each Indeed worker name
 * against the assignment's denormalized `workerName` field.
 *
 * **Name matching is loose** — Indeed's email body uses the worker's
 * display name as Indeed records it. HRX records may have an
 * alias, a hyphenated last name, or initials. Strategy:
 *
 *   1. Case-fold both sides; strip middle initials and punctuation.
 *   2. Exact match wins.
 *   3. Otherwise: tokenize and require first + last token to match
 *      (handles "John P. Smith" ↔ "John Smith").
 *   4. Otherwise: substring-fallback (handles "John Smith" ↔
 *      "Johnny Smith" — same surname + first-name prefix).
 *
 * Returns assignment ids in the same order as the input names.
 * Names with no match get a placeholder empty string so the caller
 * can correlate misses by position.
 */

import type { Reader, ReaderDoc } from './types';

export interface MatchWorkerAssignmentsResult {
  /** Same length as `workerNames` — empty string for unmatched names. */
  assignmentIds: string[];
  /** Subset of `workerNames` that didn't match anything. */
  unmatched: string[];
}

export async function matchWorkerAssignments(
  reader: Reader,
  args: {
    tenantId: string;
    shiftId: string;
    workerNames: string[];
  },
): Promise<MatchWorkerAssignmentsResult> {
  const assignments = await reader.listAssignmentsForShift({
    tenantId: args.tenantId,
    shiftId: args.shiftId,
  });
  const assignmentIds: string[] = [];
  const unmatched: string[] = [];
  for (const name of args.workerNames) {
    const match = findBestNameMatch(name, assignments);
    if (match) {
      assignmentIds.push(match.id);
    } else {
      assignmentIds.push('');
      unmatched.push(name);
    }
  }
  return { assignmentIds, unmatched };
}

// ─────────────────────────────────────────────────────────────────────
// Name matching
// ─────────────────────────────────────────────────────────────────────

export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    // Strip ASCII + Unicode quote forms (U+2018/19 ‘ ’, U+201C/D " ").
    .replace(/[.,'"`‘’“”]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenize(s: string): string[] {
  return normalizeName(s)
    .split(' ')
    // Drop empty fragments and single-letter "initials" left after the
    // period gets stripped (e.g. "p." → "p"). Real first names are at
    // least 2 chars in practice.
    .filter((t) => t.length >= 2);
}

function findBestNameMatch(name: string, assignments: ReaderDoc[]): ReaderDoc | null {
  const target = normalizeName(name);
  const targetTokens = tokenize(name);
  if (!target) return null;

  // 1. Exact match
  for (const a of assignments) {
    if (normalizeName(extractAssignmentName(a)) === target) return a;
  }
  // 2. First + last token match
  if (targetTokens.length >= 2) {
    const first = targetTokens[0];
    const last = targetTokens[targetTokens.length - 1];
    for (const a of assignments) {
      const candTokens = tokenize(extractAssignmentName(a));
      if (
        candTokens.length >= 2 &&
        candTokens[0] === first &&
        candTokens[candTokens.length - 1] === last
      ) {
        return a;
      }
    }
  }
  // 3. Substring fallback: same surname + first-name prefix match
  if (targetTokens.length >= 2) {
    const first = targetTokens[0];
    const last = targetTokens[targetTokens.length - 1];
    for (const a of assignments) {
      const candTokens = tokenize(extractAssignmentName(a));
      if (candTokens.length < 2) continue;
      const candFirst = candTokens[0];
      const candLast = candTokens[candTokens.length - 1];
      if (candLast !== last) continue;
      // first-name prefix on either side
      if (candFirst.startsWith(first) || first.startsWith(candFirst)) {
        return a;
      }
    }
  }
  return null;
}

function extractAssignmentName(a: ReaderDoc): string {
  // Different code paths denorm the worker name onto different
  // fields. Try the canonical ones in order.
  const candidates = [
    a.data.workerName,
    a.data.userName,
    a.data.candidateName,
    a.data.displayName,
    [a.data.firstName, a.data.lastName].filter(Boolean).join(' '),
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
    if (Array.isArray(c) && c.length > 0) return c.join(' ');
  }
  return '';
}
