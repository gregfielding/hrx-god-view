/**
 * Per-service-line adjudication model.
 *
 * Each AccuSource service line carries an `adjudication` sub-object with:
 *   - autoVerdict:  system-derived from `status` + `decision` on every webhook merge
 *   - verdict:      optional recruiter override (`null` = use autoVerdict); reversible
 *   - history:      audit trail for override / revert / auto-verdict changes
 *
 * Contract is intentionally narrow so the classifier stays pure and testable —
 * callers pass in only the status / decision fields, never the full line doc.
 */
import * as admin from 'firebase-admin';

/** Aggregate verdict used for SCREENING header + adjudication column. */
export type AccusourceLineVerdict = 'PASSED' | 'FAILED' | 'NEEDS_REVIEW' | 'PENDING';

/** `null` on the stored verdict means "use autoVerdict" — never written as 'AUTO'. */
export type AccusourceManualVerdict = 'PASSED' | 'FAILED' | 'NEEDS_REVIEW' | null;

/** Identifies what kind of change produced a history entry. */
export type AccusourceAdjudicationHistoryKind =
  | 'auto_verdict_changed'
  | 'manual_override_set'
  | 'manual_override_cleared';

export interface AccusourceAdjudicationHistoryEntry {
  at: admin.firestore.Timestamp | admin.firestore.FieldValue;
  kind: AccusourceAdjudicationHistoryKind;
  /** What the verdict moved **to** (null when override cleared — revert to auto). */
  verdict: AccusourceManualVerdict | AccusourceLineVerdict;
  /** What the verdict moved **from** (nullable for the first auto-verdict). */
  fromVerdict?: AccusourceManualVerdict | AccusourceLineVerdict | null;
  /** Recruiter uid for manual changes; 'system' for auto changes. */
  by: string;
  /** Optional free-text reason captured from the override modal. */
  reason?: string | null;
  /** Auto-classifier rationale snippet (only on `auto_verdict_changed`). */
  autoReason?: string | null;
}

export interface AccusourceLineAdjudication {
  autoVerdict: AccusourceLineVerdict;
  autoVerdictReason: string;
  autoVerdictAt: admin.firestore.Timestamp | admin.firestore.FieldValue;
  /** null = use autoVerdict (no manual override active). */
  verdict: AccusourceManualVerdict;
  overriddenBy?: string | null;
  overriddenAt?: admin.firestore.Timestamp | admin.firestore.FieldValue | null;
  overrideReason?: string | null;
  history?: AccusourceAdjudicationHistoryEntry[];
}

/** Effective verdict — manual override wins when set. */
export function resolveEffectiveVerdict(
  adjudication: AccusourceLineAdjudication | null | undefined,
): AccusourceLineVerdict {
  if (!adjudication) return 'PENDING';
  if (adjudication.verdict != null) return adjudication.verdict;
  return adjudication.autoVerdict ?? 'PENDING';
}

/** Lowercase text helper — null-safe. */
function norm(s: string | null | undefined): string {
  return String(s ?? '').trim().toLowerCase();
}

/** Status synonyms that mean "the service is on its way — no verdict yet". */
function statusIsPending(s: string): boolean {
  return (
    s === '' ||
    s === 'pending' ||
    s.includes('ordered') ||
    s.includes('scheduled') ||
    s.includes('awaiting') ||
    s.includes('in_progress') ||
    s.includes('in progress') ||
    s.includes('initiated') ||
    s.includes('requested') ||
    s.includes('submitted')
  );
}

/** Status synonyms that suggest a line is closed without a clear pass/fail call. */
function statusIsReview(s: string): boolean {
  return (
    s.includes('review') ||
    s.includes('adjudication') ||
    s.includes('needs_review') ||
    s.includes('needs review') ||
    s.includes('consider') ||
    s.includes('verification') ||
    s.includes('records_found') ||
    s.includes('record found') ||
    s.includes('alert')
  );
}

/** Status synonyms that suggest the line terminated in a failure / disqualification. */
function statusIsFail(s: string): boolean {
  return (
    s.includes('fail') ||
    s.includes('positive') ||
    s.includes('hit') ||
    s.includes('non-compliant') ||
    s.includes('noncompliant') ||
    s.includes('non_compliant') ||
    s.includes('ineligible') ||
    s.includes('disqualified') ||
    s.includes('rejected') ||
    s.includes('failed')
  );
}

/** Status synonyms that suggest a clean pass (Completed *without* flags). */
function statusIsCleanPass(s: string): boolean {
  return (
    s === 'pass' ||
    s.includes('cleared') ||
    s.includes('clear') ||
    s === 'negative' ||
    s.includes('no_records') ||
    s.includes('no records') ||
    s.includes('no hit') ||
    s.includes('no_hit')
  );
}

function statusIsError(s: string): boolean {
  return (
    s.includes('error') ||
    s.includes('cancel') ||
    s.includes('void') ||
    s.includes('expired') ||
    s.includes('abandoned')
  );
}

function statusIsCompleted(s: string): boolean {
  return s.includes('complete') || s.includes('closed') || s.includes('finished');
}

/** Vendor decision synonyms → verdict. `null` when the decision isn't decisive. */
function decisionToVerdict(d: string): AccusourceLineVerdict | null {
  if (!d) return null;
  if (d === 'pass' || d.includes('clear') || d.includes('eligible') || d.includes('approved')) {
    return 'PASSED';
  }
  if (d.includes('fail') || d.includes('ineligible') || d.includes('reject') || d.includes('disqualif')) {
    return 'FAILED';
  }
  if (d.includes('review') || d.includes('consider') || d.includes('further') || d.includes('records')) {
    return 'NEEDS_REVIEW';
  }
  return null;
}

export interface AutoVerdictInput {
  /** Vendor status string on the line (e.g. "Completed", "In Progress"). */
  status: string | null | undefined;
  /** Vendor decision / disposition when the service line has one set. */
  decision?: string | null | undefined;
  /**
   * Optional screen kind — drives the "what counts as a clean pass" rule:
   *   - `lab`          : drug screens; "Success" or "Completed" with no decision ⇒ PASSED.
   *   - `ssn_locator`  : Social Security Locator is a routing/staging service; once the vendor
   *                      closes it, the `Results/Special Notes` section contains
   *                      "The list of possible names and addresses returned … have been
   *                      reviewed …". Any actual hits generate SEPARATE downstream orders.
   *                      So a bare "Completed" status on an SSN Locator line is a clean pass —
   *                      treating it as NEEDS_REVIEW just creates noise for the recruiter.
   *   - `background`   : everything else (county/national criminal, MVR, etc.). Strict:
   *                      explicit clear language is required for an auto-pass; otherwise we
   *                      route to NEEDS_REVIEW so a recruiter reads the report.
   */
  kind?: 'lab' | 'ssn_locator' | 'background' | null | undefined;
}

export interface AutoVerdictResult {
  verdict: AccusourceLineVerdict;
  reason: string;
}

/**
 * Auto-verdict classifier (pure). Errs toward NEEDS_REVIEW when ambiguous so a
 * recruiter has a chance to adjudicate before a blocker clears.
 */
export function classifyAutoVerdict(input: AutoVerdictInput): AutoVerdictResult {
  const status = norm(input.status);
  const decision = norm(input.decision);

  // 1. Vendor decision wins outright when it's decisive.
  const decisionVerdict = decisionToVerdict(decision);
  if (decisionVerdict) {
    return {
      verdict: decisionVerdict,
      reason: `Vendor decision: ${input.decision}`,
    };
  }

  // 2. Review / flag states -> NEEDS_REVIEW.
  if (statusIsReview(status)) {
    return { verdict: 'NEEDS_REVIEW', reason: `Status: ${input.status ?? ''}` };
  }

  // 3. Explicit failure.
  if (statusIsFail(status)) {
    return { verdict: 'FAILED', reason: `Status: ${input.status ?? ''}` };
  }

  // 4. Clean pass synonyms.
  if (statusIsCleanPass(status)) {
    return { verdict: 'PASSED', reason: `Status: ${input.status ?? ''}` };
  }

  // 5. Lab screens reporting a plain "Success" / "Completed" with no decision set
  //    — treat the negative result as PASSED (lab workflows send the `decision`
  //    separately only when positive).
  if (input.kind === 'lab' && (status === 'success' || statusIsCompleted(status))) {
    return { verdict: 'PASSED', reason: `Lab screen closed: ${input.status ?? ''}` };
  }

  // 5a. Social Security Locator is a name/address lookup that spawns downstream
  // orders when hits exist. A bare "Completed" status is the vendor's way of
  // saying "we reviewed and there's nothing that requires your attention". Any
  // real hits would have either (a) set `decision` to something decisive, or
  // (b) created a separate per-jurisdiction criminal order which has its OWN
  // verdict on its OWN row. So: SSN Locator + Completed ⇒ PASSED.
  if (input.kind === 'ssn_locator' && statusIsCompleted(status)) {
    return {
      verdict: 'PASSED',
      reason: `SSN Locator closed — downstream orders carry verdicts (${input.status ?? ''})`,
    };
  }

  // 6. Generic "Completed" without a decision — let a recruiter read the report.
  if (statusIsCompleted(status)) {
    return {
      verdict: 'NEEDS_REVIEW',
      reason: `Completed without explicit decision — verify report (${input.status ?? ''})`,
    };
  }

  // 7. Error / canceled — route to review queue rather than silent pass.
  if (statusIsError(status)) {
    return { verdict: 'NEEDS_REVIEW', reason: `Status: ${input.status ?? ''}` };
  }

  // 8. Pending work in progress.
  if (statusIsPending(status)) {
    return { verdict: 'PENDING', reason: `Status: ${input.status ?? ''}` };
  }

  // 9. Unknown — safest default.
  return {
    verdict: 'NEEDS_REVIEW',
    reason: `Unrecognized status "${input.status ?? ''}" — manual review`,
  };
}

/**
 * Returns true when every line's effective verdict is PASSED.
 * Used for the per-job screening blocker release.
 */
export function allLinesPassed(
  lines: Array<{ adjudication?: AccusourceLineAdjudication | null | undefined }>,
): boolean {
  if (lines.length === 0) return false;
  return lines.every((ln) => resolveEffectiveVerdict(ln.adjudication ?? null) === 'PASSED');
}

/**
 * Merge an incoming autoVerdict result into an existing adjudication doc.
 *
 *   - Preserves the manual `verdict` + override metadata (never auto-cleared).
 *   - Appends an `auto_verdict_changed` history entry only when autoVerdict moved.
 *   - Initializes the history array on first classification.
 */
export function applyAutoVerdictToAdjudication(
  existing: AccusourceLineAdjudication | null | undefined,
  next: AutoVerdictResult,
  now: admin.firestore.Timestamp | admin.firestore.FieldValue,
): AccusourceLineAdjudication {
  const prevAuto = existing?.autoVerdict ?? null;
  const historyInput = existing?.history ?? [];
  const changed = prevAuto !== next.verdict;
  const history: AccusourceAdjudicationHistoryEntry[] = changed
    ? [
        ...historyInput,
        {
          at: now,
          kind: 'auto_verdict_changed',
          verdict: next.verdict,
          fromVerdict: prevAuto,
          by: 'system',
          autoReason: next.reason,
        },
      ]
    : historyInput;

  return {
    autoVerdict: next.verdict,
    autoVerdictReason: next.reason,
    autoVerdictAt: now,
    verdict: existing?.verdict ?? null,
    overriddenBy: existing?.overriddenBy ?? null,
    overriddenAt: existing?.overriddenAt ?? null,
    overrideReason: existing?.overrideReason ?? null,
    history,
  };
}
