/**
 * One-shot C1 Events setup check for the post-apply redirect (Greg,
 * 2026-09-11): a C1 Events applicant who isn't fully set up — profile photo,
 * direct deposit, 1099 tax form — lands on the setup checklist on the payroll
 * page; a set-up worker stays on the posting. Same reads, rules and helpers as
 * `useClaimReadiness`. Any failure reads as "not set up" (the checklist page
 * shows "You're all set" if that was wrong).
 */
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';

import { db } from '../../firebase';
import {
  C1_EVENTS_ENTITY_ID,
  eventsSetupSteps,
  isEventsSetupComplete,
  isHeadshotReadyForClaim,
  isPayrollReadyForClaim,
} from './claimReadiness';

type Row = Record<string, unknown>;

export async function fetchEventsSetupComplete(tenantId: string, uid: string): Promise<boolean> {
  try {
    const [rowsSnap, link, userSnap] = await Promise.all([
      getDocs(query(collection(db, 'tenants', tenantId, 'entity_employments'), where('userId', '==', uid))),
      // A missing link can be permission-denied — that's "no link".
      getDoc(doc(db, 'tenants', tenantId, 'everee_workers', `${C1_EVENTS_ENTITY_ID}__${uid}`)).then(
        (snap) => (snap.exists() ? (snap.data() as Row) : null),
        () => null,
      ),
      getDoc(doc(db, 'users', uid)),
    ]);
    const rows = rowsSnap.docs
      .map((d) => d.data() as Row)
      .filter((r) => String(r.entityId || '') === C1_EVENTS_ENTITY_ID);
    const steps = eventsSetupSteps({
      photoReady: isHeadshotReadyForClaim(userSnap.exists() ? (userSnap.data() as Row) : null),
      payrollReady: isPayrollReadyForClaim(rows, link),
      link,
    });
    return isEventsSetupComplete(steps);
  } catch {
    return false;
  }
}
