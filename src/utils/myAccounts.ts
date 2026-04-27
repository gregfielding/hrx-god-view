/**
 * App-wide definition of "My Accounts".
 *
 * An account is considered "mine" for the current user if the user is listed as an
 * **assigned salesperson** OR an **assigned recruiter** on that account. This rule
 * is used for the Accounts list "My Accounts" tab, to-do lists, and any other
 * features that scope by "My Accounts". Use this module everywhere so behavior
 * stays consistent.
 */

/** Minimal account shape needed to determine assignment (avoids coupling to full RecruiterAccount). */
export interface AccountWithAssignments {
  associations?: {
    salespersonIds?: string[] | null;
    recruiterIds?: string[] | null;
  } | null;
}

/**
 * Returns true if the given user is assigned to the account as a salesperson or recruiter.
 * Use this app-wide whenever you need to test "is this one of my accounts?".
 *
 * @param account - Account (or partial) with at least associations.salespersonIds / recruiterIds
 * @param userId - Current user's UID (null/undefined = not signed in → false)
 */
export function isAccountAssignedToUser(
  account: AccountWithAssignments | null | undefined,
  userId: string | null | undefined
): boolean {
  if (!userId || !account?.associations) return false;
  const { salespersonIds, recruiterIds } = account.associations;
  const sales = Array.isArray(salespersonIds) ? salespersonIds : [];
  const recs = Array.isArray(recruiterIds) ? recruiterIds : [];
  return sales.includes(userId) || recs.includes(userId);
}

/**
 * Filter a list of accounts to only those assigned to the current user.
 * Convenience when you already have a full list and want "my" subset.
 */
export function filterMyAccounts<T extends AccountWithAssignments>(
  accounts: T[],
  userId: string | null | undefined
): T[] {
  if (!userId) return [];
  return accounts.filter((a) => isAccountAssignedToUser(a, userId));
}
