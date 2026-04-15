/**
 * Client-side worker search for `/staff-onboarding` tables (name, email, phone).
 */

export type OnboardingWorkerSearchableRow = {
  workerDisplayName: string;
  workerEmail?: string;
  workerPhone?: string;
};

/** Multi-token AND across a combined haystack; phone tokens match on digits only. */
export function rowMatchesOnboardingWorkerSearch(
  query: string,
  row: OnboardingWorkerSearchableRow,
): boolean {
  const raw = query.trim().toLowerCase();
  if (!raw) return true;

  const name = row.workerDisplayName.toLowerCase();
  const email = String(row.workerEmail || '').toLowerCase();
  const phoneDigits = String(row.workerPhone || '').replace(/\D/g, '');
  const blob = `${name} ${email} ${phoneDigits}`;

  const tokens = raw.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;

  return tokens.every((tok) => {
    const td = tok.replace(/\D/g, '');
    if (td.length >= 3 && /^\d+$/.test(td)) {
      return phoneDigits.includes(td);
    }
    return blob.includes(tok);
  });
}
