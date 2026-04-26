/**
 * useActiveShifts — fan-out fetch of every shift across the tenant that is
 * "active right now" (today/future single-day, in-window multi-day, or
 * recurring career shifts).
 *
 * Lives at the parent (`Shifts.tsx`) level so List and Calendar tabs share
 * the same dataset — switching tabs doesn't refetch.
 *
 * Fetch strategy: pull non-terminal JOs once, then load each JO's `shifts`
 * subcollection in parallel. There's no `collectionGroup('shifts')` index
 * in the project today, and going through the JO list lets us keep JO
 * context (jobTitle, company, location, jobType) on every row without a
 * second join.
 */

import { useCallback, useEffect, useState } from 'react';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';

import { db } from '../firebase';
import { p } from '../data/firestorePaths';
import {
  buildActiveRowMeta,
  todayIsoLocal,
  type JobOrderLite,
  type ShiftDoc,
  type ShiftRow,
} from '../utils/shifts/shiftRow';

interface AddressParts {
  street?: string;
  city?: string;
  state?: string;
  zipCode?: string;
}

const trimOrUndef = (v: unknown): string | undefined => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s ? s : undefined;
};

/**
 * Coerce a raw Firestore value into a finite number. JOs in this code
 * base store rates as either numbers or strings (the form always casts
 * to string before save). Undefined / NaN / non-finite values return
 * undefined so callers can short-circuit.
 */
const toFiniteNumber = (v: unknown): number | undefined => {
  if (v == null || v === '') return undefined;
  const n = typeof v === 'string' ? parseFloat(v) : (v as number);
  return Number.isFinite(n) ? n : undefined;
};

/** Pull pay/bill/markup/WC/SUTA/FUTA out of a JO doc, normalizing
 *  string-vs-number storage and falling back from `positions[0]` to
 *  top-level fields where appropriate. */
const readJoFinancials = (
  data: Record<string, any>,
): {
  payRate?: number;
  billRate?: number;
  markupPercent?: number;
  wcRate?: number;
  sutaRate?: number;
  futaRate?: number;
} => {
  const positions = Array.isArray(data.positions) ? data.positions : [];
  const p0: Record<string, any> | undefined = positions[0];

  const payRate =
    toFiniteNumber(data.payRate) ?? toFiniteNumber(p0?.payRate);
  const billRate =
    toFiniteNumber(data.billRate) ?? toFiniteNumber(p0?.billRate);

  const explicitMarkup =
    toFiniteNumber(data.markup) ??
    toFiniteNumber(data.markupPercent) ??
    toFiniteNumber(p0?.markupPercent);
  // Derived markup when both rates are present and pay > 0.
  const derivedMarkup =
    payRate && billRate && payRate > 0
      ? ((billRate - payRate) / payRate) * 100
      : undefined;

  return {
    payRate,
    billRate,
    markupPercent: explicitMarkup ?? derivedMarkup,
    wcRate:
      toFiniteNumber(p0?.workersCompRate) ?? toFiniteNumber(data.workersCompRate),
    sutaRate: toFiniteNumber(p0?.sutaRate) ?? toFiniteNumber(data.sutaRate),
    futaRate: toFiniteNumber(p0?.futaRate) ?? toFiniteNumber(data.futaRate),
  };
};

/**
 * Pulls whatever address pieces are on the JO doc itself. Job orders in
 * this codebase historically store the address in three different shapes:
 *   - flat `worksiteAddress: { street, city, state, zipCode|zip }`
 *   - nested `worksiteAddress: { address: { ... } }` (older imports)
 *   - top-level `city` / `state` / `zipCode` / `zip` (very old)
 * This helper normalizes all three.
 */
const readJoAddress = (data: Record<string, any>): AddressParts => {
  const wa = data.worksiteAddress as Record<string, any> | undefined;
  const waInner =
    wa && typeof wa === 'object'
      ? (wa.address as Record<string, any> | undefined)
      : undefined;
  return {
    street: trimOrUndef(wa?.street ?? waInner?.street),
    city: trimOrUndef(wa?.city ?? waInner?.city ?? data.city),
    state: trimOrUndef(wa?.state ?? waInner?.state ?? data.state),
    zipCode: trimOrUndef(
      wa?.zipCode ?? wa?.zip ?? waInner?.zipCode ?? waInner?.zip ?? data.zipCode ?? data.zip,
    ),
  };
};

export interface UseActiveShiftsResult {
  rows: ShiftRow[];
  loading: boolean;
  error: string | null;
  /** Manually re-run the fetch (e.g. after a placement action that mutates a shift). */
  refetch: () => Promise<void>;
}

const NON_TERMINAL_JO_STATUSES = ['open', 'on-hold', 'on_hold', 'filled'] as const;

const useActiveShifts = (tenantId: string | null | undefined): UseActiveShiftsResult => {
  const [rows, setRows] = useState<ShiftRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchActiveShifts = useCallback(async () => {
    if (!tenantId) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const todayIso = todayIsoLocal();
    try {
      const jobOrdersRef = collection(db, p.jobOrders(tenantId));
      const joSnap = await getDocs(
        query(jobOrdersRef, where('status', 'in', [...NON_TERMINAL_JO_STATUSES])),
      );

      // Each entry pairs the public JobOrderLite the rest of the app sees
      // with the private companyId/worksiteId we need to hydrate the
      // address from `crm_companies/{cid}/locations/{lid}`.
      const entries: Array<{
        jo: JobOrderLite;
        companyId: string | null;
        worksiteId: string | null;
      }> = joSnap.docs.map((d) => {
        const data = d.data() as Record<string, any>;
        const derivedJobTitle =
          data.jobTitle ||
          (Array.isArray(data.gigPositions) && data.gigPositions[0]?.jobTitle) ||
          undefined;
        const companyId =
          (data.companyId as string | undefined) ||
          (data.deal?.companyId as string | undefined) ||
          null;
        const worksiteId =
          (data.worksiteId as string | undefined) ||
          (data.deal?.locationId as string | undefined) ||
          null;
        const financials = readJoFinancials(data);
        return {
          jo: {
            id: d.id,
            jobOrderNumber: data.jobOrderNumber,
            jobTitle: derivedJobTitle,
            jobType: data.jobType,
            status: data.status,
            poNumber: trimOrUndef(data.poNumber),
            // JOs in this codebase persist the description under
            // multiple keys depending on age and code path:
            //   - `jobDescriptionFromClient` — current `JobOrderForm` write target
            //   - `jobOrderDescription`      — legacy intermediate
            //   - `jobDescription`           — original / typed-schema field
            // Mirror the resolution chain `jobsBoardService.ts` uses.
            jobDescription: trimOrUndef(
              data.jobDescriptionFromClient ??
                data.jobOrderDescription ??
                data.jobDescription,
            ),
            hiringEntityId:
              typeof data.hiringEntityId === 'string'
                ? data.hiringEntityId
                : null,
            screeningPackageName: trimOrUndef(data.screeningPackageName),
            additionalScreenings: Array.isArray(data.additionalScreenings)
              ? data.additionalScreenings
                  .map((s: unknown) => (typeof s === 'string' ? s.trim() : ''))
                  .filter((s: string): s is string => !!s)
              : undefined,
            uniformRequirements: trimOrUndef(data.uniformRequirements),
            companyId: companyId ?? undefined,
            companyName: data.companyName,
            companyLogoUrl: trimOrUndef(
              data.companyLogo ?? data.companyLogoUrl,
            ),
            worksiteName: data.worksiteName,
            worksiteAddress: readJoAddress(data),
            ...financials,
          },
          companyId,
          worksiteId,
        };
      });

      // Cache company-logo lookups by companyId so a tenant with 50 JOs
      // for the same client only does one `crm_companies/{id}` read.
      const companyLogoCache = new Map<string, Promise<string | undefined>>();
      const fetchCompanyLogo = (companyId: string) => {
        let pending = companyLogoCache.get(companyId);
        if (!pending) {
          pending = (async (): Promise<string | undefined> => {
            try {
              const compSnap = await getDoc(
                doc(db, 'tenants', tenantId, 'crm_companies', companyId),
              );
              if (!compSnap.exists()) return undefined;
              const cd = compSnap.data() as Record<string, any>;
              // Mirror the fallback chain DealDetails / CompanyDetails
              // already use — `logo` is the primary write target,
              // `logoUrl` / `logo_url` show up on Apollo-enriched docs,
              // `avatar` is older.
              return trimOrUndef(cd.logo ?? cd.logoUrl ?? cd.logo_url ?? cd.avatar);
            } catch (err) {
              console.warn(
                `Failed to hydrate company logo for ${companyId}:`,
                err,
              );
              return undefined;
            }
          })();
          companyLogoCache.set(companyId, pending);
        }
        return pending;
      };

      // Cache hiring-entity name lookups by entityId. Tenants typically
      // have <10 entities, so a tenant of any reasonable size collapses
      // to a handful of `entities/{id}` reads.
      const entityNameCache = new Map<string, Promise<string | undefined>>();
      const fetchHiringEntityName = (entityId: string) => {
        let pending = entityNameCache.get(entityId);
        if (!pending) {
          pending = (async (): Promise<string | undefined> => {
            try {
              const entSnap = await getDoc(
                doc(db, 'tenants', tenantId, 'entities', entityId),
              );
              if (!entSnap.exists()) return undefined;
              const ed = entSnap.data() as Record<string, any>;
              // Mirror `useEntity` resolution — `name` may be empty
              // while `legalName` holds "C1 Select LLC".
              return (
                trimOrUndef(ed?.name) ??
                trimOrUndef(ed?.legalName) ??
                trimOrUndef(ed?.title)
              );
            } catch (err) {
              console.warn(
                `Failed to hydrate hiring entity ${entityId}:`,
                err,
              );
              return undefined;
            }
          })();
          entityNameCache.set(entityId, pending);
        }
        return pending;
      };

      // Cache by `${companyId}:${worksiteId}` so JOs sharing a worksite
      // re-use the same fetch (a tenant with 50 JOs at one big convention
      // center should only do one location lookup, not 50).
      const locationCache = new Map<string, Promise<AddressParts>>();
      const fetchLocationAddress = (companyId: string, worksiteId: string) => {
        const key = `${companyId}:${worksiteId}`;
        let pending = locationCache.get(key);
        if (!pending) {
          pending = (async (): Promise<AddressParts> => {
            try {
              const locSnap = await getDoc(
                doc(
                  db,
                  'tenants',
                  tenantId,
                  'crm_companies',
                  companyId,
                  'locations',
                  worksiteId,
                ),
              );
              if (!locSnap.exists()) return {};
              const ld = locSnap.data() as Record<string, any>;
              // `location.address` is split-shape across the codebase:
              //   - Some locations store it as a STRING (the literal
              //     street line, with city/state/zip at the top level).
              //   - Some store it as an OBJECT { street, city, state,
              //     zipCode|zip } (newer shape).
              //   - Some store nothing under `address` at all and rely
              //     on top-level `street`/`city`/`state`/`zipCode|zip`.
              // Mirror the resolution `RecruiterAccountDetails.tsx` does
              // when hydrating worksite addresses.
              const addrField = ld.address;
              const addrAsString =
                typeof addrField === 'string' ? addrField : undefined;
              const addrAsObject =
                addrField && typeof addrField === 'object'
                  ? (addrField as Record<string, any>)
                  : {};
              return {
                street: trimOrUndef(
                  ld.street ??
                    addrAsObject.street ??
                    ld.streetAddress ??
                    ld.address1 ??
                    addrAsObject.address1 ??
                    addrAsString,
                ),
                city: trimOrUndef(ld.city ?? addrAsObject.city),
                state: trimOrUndef(ld.state ?? addrAsObject.state),
                zipCode: trimOrUndef(
                  ld.zipCode ??
                    ld.zip ??
                    addrAsObject.zipCode ??
                    addrAsObject.zip,
                ),
              };
            } catch (err) {
              console.warn(
                `Failed to hydrate location ${companyId}/${worksiteId} for shifts:`,
                err,
              );
              return {};
            }
          })();
          locationCache.set(key, pending);
        }
        return pending;
      };

      // Per-shift applicant tallies. Built by the 5th fan-out batch
      // below from `tenants/{tid}/applications`, then merged onto each
      // `ShiftRow` during assembly. Deduped by userId/candidateId so a
      // worker applying to several shifts in the same JO is counted
      // once per shift.
      type ShiftApplicantTally = {
        confirmed: Set<string>;
        total: Set<string>;
      };
      const tallyByShift = new Map<string, ShiftApplicantTally>();
      const ensureTally = (shiftId: string): ShiftApplicantTally => {
        let t = tallyByShift.get(shiftId);
        if (!t) {
          t = { confirmed: new Set(), total: new Set() };
          tallyByShift.set(shiftId, t);
        }
        return t;
      };

      // Fan-out five independent batches in parallel:
      //  1. Address hydration       (mutates entries[i].jo.worksiteAddress)
      //  2. Company-logo hydration  (mutates entries[i].jo.companyLogoUrl)
      //  3. Hiring-entity name      (mutates entries[i].jo.hiringEntityName)
      //  4. Applicant tallies       (populates `tallyByShift` above)
      //  5. The per-JO shifts subcollection load.
      // Then assemble the final rows.
      const [, , , , shiftLists] = await Promise.all([
        Promise.all(
          entries.map(async (entry) => {
            const wa = entry.jo.worksiteAddress ?? {};
            const fullyHydrated = wa.street && wa.city && wa.state && wa.zipCode;
            if (fullyHydrated) return;
            if (!entry.companyId || !entry.worksiteId) return;
            const loc = await fetchLocationAddress(entry.companyId, entry.worksiteId);
            entry.jo.worksiteAddress = {
              street: wa.street || loc.street,
              city: wa.city || loc.city,
              state: wa.state || loc.state,
              zipCode: wa.zipCode || loc.zipCode,
            };
          }),
        ),
        Promise.all(
          entries.map(async (entry) => {
            if (entry.jo.companyLogoUrl) return;
            if (!entry.companyId) return;
            const logo = await fetchCompanyLogo(entry.companyId);
            if (logo) entry.jo.companyLogoUrl = logo;
          }),
        ),
        Promise.all(
          entries.map(async (entry) => {
            const eid = entry.jo.hiringEntityId;
            if (!eid) return;
            const name = await fetchHiringEntityName(eid);
            if (name) entry.jo.hiringEntityName = name;
          }),
        ),
        // Per-shift applicant counts. Queried by `jobOrderId in [...]`
        // chunks (Firestore `in` cap = 30) over the visible JO set,
        // then bucketed by `shiftId` / `shiftIds`. We deliberately
        // ignore applications that have a `jobOrderId` but no
        // shift reference — those are JO-level applicants, not
        // shift-level. Status `'confirmed'` (worker accepted) feeds
        // the confirmed count; everything counts toward total.
        (async () => {
          const joIds = entries.map((e) => e.jo.id);
          if (joIds.length === 0) return;
          const APPS_CHUNK = 30;
          const applicationsRef = collection(
            db,
            'tenants',
            tenantId,
            'applications',
          );
          const dedupKey = (
            d: { userId?: unknown; candidateId?: unknown },
            docId: string,
          ): string => {
            if (typeof d.userId === 'string' && d.userId.trim()) return d.userId.trim();
            if (typeof d.candidateId === 'string' && d.candidateId.trim()) {
              return d.candidateId.trim();
            }
            return docId;
          };
          for (let i = 0; i < joIds.length; i += APPS_CHUNK) {
            const chunk = joIds.slice(i, i + APPS_CHUNK);
            try {
              const snap = await getDocs(
                query(applicationsRef, where('jobOrderId', 'in', chunk)),
              );
              snap.docs.forEach((d) => {
                const data = d.data() as {
                  shiftId?: unknown;
                  shiftIds?: unknown;
                  status?: unknown;
                  userId?: unknown;
                  candidateId?: unknown;
                };
                const isConfirmed = data.status === 'confirmed';
                const key = dedupKey(data, d.id);
                const ids = new Set<string>();
                if (typeof data.shiftId === 'string' && data.shiftId.trim()) {
                  ids.add(data.shiftId.trim());
                }
                if (Array.isArray(data.shiftIds)) {
                  for (const s of data.shiftIds) {
                    if (typeof s === 'string' && s.trim()) ids.add(s.trim());
                  }
                }
                ids.forEach((sid) => {
                  const t = ensureTally(sid);
                  t.total.add(key);
                  if (isConfirmed) t.confirmed.add(key);
                });
              });
            } catch (err) {
              console.warn('Failed to load shift applicant counts:', err);
            }
          }
        })(),
        Promise.all(
          entries.map(async ({ jo }) => {
            try {
              const shiftsSnap = await getDocs(
                collection(db, 'tenants', tenantId, 'job_orders', jo.id, 'shifts'),
              );
              return shiftsSnap.docs.map(
                (s) => ({ id: s.id, ...(s.data() as Omit<ShiftDoc, 'id'>) }),
              );
            } catch (err) {
              console.warn(`Failed to load shifts for JO ${jo.id}:`, err);
              return [] as ShiftDoc[];
            }
          }),
        ),
      ]);

      const built: ShiftRow[] = [];
      entries.forEach((entry, idx) => {
        const list = shiftLists[idx];
        for (const shift of list) {
          const meta = buildActiveRowMeta(shift, entry.jo, todayIso);
          if (!meta) continue;
          const tally = tallyByShift.get(shift.id);
          built.push({
            shift,
            jobOrder: entry.jo,
            ...meta,
            confirmedCount: tally?.confirmed.size ?? 0,
            applicantsCount: tally?.total.size ?? 0,
          });
        }
      });

      built.sort((a, b) => a.sortKey - b.sortKey);
      setRows(built);
    } catch (err) {
      console.error('Error loading active shifts:', err);
      setError(err instanceof Error ? err.message : 'Failed to load active shifts');
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void fetchActiveShifts();
  }, [fetchActiveShifts]);

  return { rows, loading, error, refetch: fetchActiveShifts };
};

export default useActiveShifts;
