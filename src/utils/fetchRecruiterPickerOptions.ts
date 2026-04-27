import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase';

export type RecruiterPickerOption = { id: string; displayName: string; email?: string };

/** `users/{uid}.recruiter` or `users/{uid}.tenantIds.{tenantId}.recruiter` must be boolean `true`. */
export function userIsRecruiterForTenant(
  userData: Record<string, unknown>,
  tenantId: string,
): boolean {
  if (userData.recruiter === true) return true;
  const tenantData = userData.tenantIds && typeof userData.tenantIds === 'object'
    ? (userData.tenantIds as Record<string, unknown>)[tenantId]
    : undefined;
  if (tenantData && typeof tenantData === 'object' && (tenantData as { recruiter?: boolean }).recruiter === true) {
    return true;
  }
  return false;
}

const RECRUITER_EMAIL_SUFFIX = '@c1staffing.com';

/**
 * Users eligible to be assigned as recruiters: `recruiter: true` on the user doc or
 * `tenantIds.{tenantId}.recruiter`, and a work email ending in `@c1staffing.com`.
 */
export async function fetchRecruiterPickerOptions(tenantId: string): Promise<RecruiterPickerOption[]> {
  const usersSnapshot = await getDocs(collection(db, 'users'));
  const recruiters: RecruiterPickerOption[] = [];

  usersSnapshot.docs.forEach((docSnap) => {
    const userData = docSnap.data() as Record<string, unknown>;
    if (!userData.tenantIds || !(userData.tenantIds as Record<string, unknown>)[tenantId]) return;

    if (!userIsRecruiterForTenant(userData, tenantId)) return;

    const emailRaw = userData.email;
    if (typeof emailRaw !== 'string' || !emailRaw.trim()) return;
    const emailNorm = emailRaw.trim().toLowerCase();
    if (!emailNorm.endsWith(RECRUITER_EMAIL_SUFFIX)) return;

    const displayName =
      (userData.firstName && userData.lastName ? `${userData.firstName} ${userData.lastName}`.trim() : '') ||
      (userData.displayName as string | undefined) ||
      (userData.email ? String(userData.email).split('@')[0] : 'Recruiter');

    recruiters.push({
      id: docSnap.id,
      displayName,
      email: emailNorm,
    });
  });

  recruiters.sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' }));
  return recruiters;
}
