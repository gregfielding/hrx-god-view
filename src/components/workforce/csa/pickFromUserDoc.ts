/**
 * RD.1 — tiny helpers for safely pulling display-relevant fields off a
 * raw user doc returned by `useUserDocsByUids`. Kept in their own file so
 * each section component doesn't reinvent the same `typeof === 'string'`
 * dance.
 *
 * The user doc shape is intentionally typed as `Record<string, unknown>`
 * upstream — `users` is a wide grab-bag of fields written by many code
 * paths over the years, and locking it down to a strict interface here
 * would either be a lie or block future fields. Defensive reads are the
 * established pattern (see `loadWorkerNames.ts` for the same approach).
 */

function asString(raw: unknown): string {
  return typeof raw === 'string' ? raw : '';
}

/** Avatar URL — accepts either `avatar` (HRX convention) or `photoURL`. */
export function pickAvatarFromUserDoc(doc: Record<string, unknown> | undefined): string {
  if (!doc) return '';
  return asString(doc.avatar) || asString(doc.photoURL);
}

/** Worker's CSA uid (`primaryRecruiterId` per RECRUITING_ROLE_MODEL §4.5). */
export function pickPrimaryRecruiterIdFromUserDoc(
  doc: Record<string, unknown> | undefined,
): string {
  if (!doc) return '';
  return asString(doc.primaryRecruiterId);
}

/**
 * Convenience for assembling a display name from a user doc when the
 * upstream row doesn't have one denormalized. Falls back through email
 * local-part to keep something readable on screen.
 */
export function pickDisplayNameFromUserDoc(
  doc: Record<string, unknown> | undefined,
): { firstName: string; lastName: string; email: string } {
  if (!doc) return { firstName: '', lastName: '', email: '' };
  return {
    firstName: asString(doc.firstName),
    lastName: asString(doc.lastName),
    email: asString(doc.email),
  };
}
