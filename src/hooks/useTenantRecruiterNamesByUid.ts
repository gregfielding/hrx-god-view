/**
 * Tenant-wide map of recruiter uid -> display name.
 *
 * Backs the "Recruiter: <name>" line on the recruiter Users / group members /
 * applicants tables. The Recruiter scalar lives on
 * `users.{uid}.primaryRecruiterId` (per `docs/RECRUITING_ROLE_MODEL.md` §5.1),
 * but rows only carry the uid; tables need a name to render. Rather than each
 * row issuing its own getDoc, we fetch the full recruiter picker list once
 * per tenant and reuse it.
 *
 * Module-level promise cache keeps multiple tables (Users + group/smart group
 * details + applicants) from re-fetching the same list when they mount in
 * sequence within the same session.
 */
import { useEffect, useState } from 'react';
import {
  fetchRecruiterPickerOptions,
  type RecruiterPickerOption,
} from '../utils/fetchRecruiterPickerOptions';

const cache = new Map<string, Promise<RecruiterPickerOption[]>>();

function getOrFetch(tenantId: string): Promise<RecruiterPickerOption[]> {
  let inFlight = cache.get(tenantId);
  if (!inFlight) {
    inFlight = fetchRecruiterPickerOptions(tenantId).catch((err) => {
      // Drop failed fetches from cache so a transient error doesn't poison the
      // map for the rest of the session.
      cache.delete(tenantId);
      throw err;
    });
    cache.set(tenantId, inFlight);
  }
  return inFlight;
}

/**
 * Returns a `Map<uid, displayName>` for every recruiter eligible to be a
 * worker's `primaryRecruiterId` in the given tenant. Empty until the
 * underlying fetch resolves.
 */
export function useTenantRecruiterNamesByUid(tenantId: string | null | undefined): Map<string, string> {
  const [names, setNames] = useState<Map<string, string>>(() => new Map());

  useEffect(() => {
    if (!tenantId) {
      setNames(new Map());
      return;
    }
    let cancelled = false;
    getOrFetch(tenantId)
      .then((opts) => {
        if (cancelled) return;
        const next = new Map<string, string>();
        for (const o of opts) {
          if (o?.id && o?.displayName) next.set(o.id, o.displayName);
        }
        setNames(next);
      })
      .catch(() => {
        if (!cancelled) setNames(new Map());
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  return names;
}
