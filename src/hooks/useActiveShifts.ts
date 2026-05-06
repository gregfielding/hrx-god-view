/**
 * useActiveShifts — fan-out fetch of shifts across the tenant (all job order
 * statuses). Row inclusion for dated gigs uses toolbar date range and
 * buildActiveRowMeta (past dated gigs remain in the dataset for filtering).
 *
 * Lives at the parent (`Shifts.tsx`) level so List and Calendar tabs share
 * the same dataset — switching tabs doesn't refetch.
 *
 * Fetch strategy: pull job orders (no status filter — shifts must appear
 * for every JO state including on_hold / cancelled), then load each JO's
 * `shifts` subcollection in parallel. There's no `collectionGroup('shifts')`
 * index in the project today, and going through the JO list keeps JO context
 * (jobTitle, company, location, jobType) on every row without a second join.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';

import { db } from '../firebase';
import { p } from '../data/firestorePaths';
import {
  buildActiveRowMeta,
  todayIsoLocal,
  type JobOrderLite,
  type ShiftDoc,
  type ShiftRow,
} from '../utils/shifts/shiftRow';
import {
  getEffectiveJobOrderPositionField,
  type JobOrderForEffectiveRead,
} from '../shared/jobOrder/getEffectiveJobOrderField';
import {
  getFutaRateByState,
  getSutaRateByState,
  normalizeStateCode,
} from '../utils/unemploymentRates';
import { isExcludedFromPlacementsApplicantPool } from '../utils/applicationStatusNormalize';

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
 *  top-level fields where appropriate.
 *
 *  R.16.2a — per-position rate reads (`p0?.payRate`, `p0?.billRate`,
 *  `p0?.markupPercent`, `p0?.workersCompRate`) flow through the
 *  snapshot-aware helper so the activation snapshot wins for non-draft
 *  JOs. The flat top-level reads (`data.payRate`, `data.billRate`,
 *  `data.workersCompRate`) stay unwrapped per L5 — flat defaults are
 *  not a registry entry. SUTA / FUTA aren't in the R.16.2a scope
 *  (deferred to R.16.2b per the brief's Deferred Items table).
 */
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
  // Prefer `positions[]` (canonical, snapshot-aware) and fall back to
  // `gigPositions[]` for gig JOs which historically use that field
  // exclusively. Going forward, `EditShiftForm` snapshots the chosen
  // position's rates onto the shift doc itself, so this per-JO fallback
  // exists primarily for the JO-level table summary and for legacy
  // shifts that pre-date the snapshot fix.
  const positions = Array.isArray(data.positions) && data.positions.length > 0
    ? data.positions
    : Array.isArray(data.gigPositions)
      ? data.gigPositions
      : [];
  const p0: Record<string, any> | undefined = positions[0];
  const positionId =
    typeof p0?.positionId === 'string' ? (p0.positionId as string) : '';
  const joForRead = data as JobOrderForEffectiveRead;

  // Helper: the snapshot-aware read for a per-position rate. Falls back
  // through the legacy `p0` chain when the snapshot has no entry for
  // this `positionId` (drafts, pre-§16.1 active JOs, or positions added
  // after activation — see helper docstring).
  const readPositionRate = (
    subField: 'payRate' | 'billRate' | 'workersCompRate' | 'markupPercentage',
    legacyP0Read: number | undefined,
  ): number | undefined => {
    if (!positionId) return legacyP0Read;
    const { value } = getEffectiveJobOrderPositionField<number>(
      joForRead,
      positionId,
      subField,
      { fallback: legacyP0Read },
    );
    const n =
      typeof value === 'number'
        ? value
        : toFiniteNumber(value as unknown);
    return Number.isFinite(n as number) ? (n as number) : undefined;
  };

  const payRate =
    toFiniteNumber(data.payRate) ??
    readPositionRate('payRate', toFiniteNumber(p0?.payRate));
  const billRate =
    toFiniteNumber(data.billRate) ??
    readPositionRate('billRate', toFiniteNumber(p0?.billRate));

  // Markup is persisted under three different names in the wild:
  //   - `data.markup` / `data.markupPercent`            top-level (older flow)
  //   - `gigPositions[].markup`                         JO form's gig-position UI write key
  //   - `positions[].markupPercent`                     position-array convention
  //   - `positions[].markupPercentage`                  cascade-engine canonical
  // Read all of them, snapshot-aware first, then per-position, then top-level.
  const explicitMarkup =
    toFiniteNumber(data.markup) ??
    toFiniteNumber(data.markupPercent) ??
    readPositionRate(
      'markupPercentage',
      toFiniteNumber(p0?.markupPercent ?? p0?.markup ?? p0?.markupPercentage),
    );
  // Derived markup when both rates are present and pay > 0.
  const derivedMarkup =
    payRate && billRate && payRate > 0
      ? ((billRate - payRate) / payRate) * 100
      : undefined;

  // Fall back to the worksite-state new-employer estimate when neither
  // the position nor the JO doc has SUTA/FUTA stored explicitly. Mirrors
  // the `Estimated from <ST>` line the user sees inside `EditShiftForm`'s
  // SUTA/FUTA inputs — without this fallback the shifts list table and
  // the placements drawer header showed "—" while the same shift's
  // Settings tab body showed live computed values, which read as a bug
  // ("FUTA/SUTA show in the drawer body but not the heading or table").
  // Stored values still win — recruiters who explicitly save a rate on
  // the JO/position keep that exact value (no estimate override).
  const storedSuta = toFiniteNumber(p0?.sutaRate) ?? toFiniteNumber(data.sutaRate);
  const storedFuta = toFiniteNumber(p0?.futaRate) ?? toFiniteNumber(data.futaRate);
  const worksiteStateCode = readJoWorksiteStateCode(data);
  const estimatedSuta =
    worksiteStateCode ? getSutaRateByState(worksiteStateCode) : null;
  const estimatedFuta =
    worksiteStateCode ? getFutaRateByState(worksiteStateCode) : null;
  return {
    payRate,
    billRate,
    markupPercent: explicitMarkup ?? derivedMarkup,
    wcRate:
      readPositionRate('workersCompRate', toFiniteNumber(p0?.workersCompRate)) ??
      toFiniteNumber(data.workersCompRate),
    sutaRate:
      storedSuta ??
      (estimatedSuta != null && Number.isFinite(estimatedSuta) ? estimatedSuta : undefined),
    futaRate:
      storedFuta ??
      (estimatedFuta != null && Number.isFinite(estimatedFuta) ? estimatedFuta : undefined),
  };
};

/**
 * Resolve the JO's worksite state for SUTA/FUTA estimation purposes.
 * Mirrors the candidate chain in EditShiftForm.worksiteStateForJo so the
 * drawer header / table / Settings tab all converge on the same state
 * code. We look at:
 *   1. `worksiteAddress.{state, stateCode}`        (canonical)
 *   2. `worksiteAddress.address.{state, stateCode}` (older nested shape)
 *   3. top-level `worksiteState` / `state` / `locationState` (legacy)
 * Anything found is normalized through `normalizeStateCode` (handles
 * "California" → "CA", lowercase codes, two-letter spellings).
 */
const readJoWorksiteStateCode = (data: Record<string, any>): string => {
  const wa = data.worksiteAddress as Record<string, any> | undefined;
  const addr = (key: string): Record<string, any> | undefined =>
    (data[key] as Record<string, any> | undefined) ?? undefined;
  const candidates: Array<unknown> = [
    wa?.state,
    wa?.stateCode,
    wa?.address?.state,
    wa?.address?.stateCode,
    data.worksiteState,
    data.locationState,
    addr('address')?.state,
    addr('address')?.stateCode,
    data.companyState,
    data.accountState,
    data.state,
  ];
  for (const c of candidates) {
    const code = normalizeStateCode(typeof c === 'string' ? c : '')
      .trim()
      .toUpperCase();
    if (code) return code;
  }
  return '';
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

export interface UseActiveShiftsOptions {
  /**
   * When set, only job orders whose `recruiterAccountId` matches one of these
   * ids are loaded (parallel equality queries — supports national + children).
   * Omit for tenant-wide active shifts (same as legacy behavior).
   */
  recruiterAccountIds?: string[] | null;
}

const useActiveShifts = (
  tenantId: string | null | undefined,
  options?: UseActiveShiftsOptions | null,
): UseActiveShiftsResult => {
  const [rows, setRows] = useState<ShiftRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const scopeKey =
    options?.recruiterAccountIds?.map((id) => String(id || '').trim()).filter(Boolean).join('|') ??
    '';

  const fetchActiveShifts = useCallback(async () => {
    if (!tenantId) {
      setRows([]);
      setLoading(false);
      return;
    }
    const scopedIds =
      options?.recruiterAccountIds?.map((id) => String(id || '').trim()).filter(Boolean) ?? [];
    const useAccountScope = options?.recruiterAccountIds != null;
    if (useAccountScope && scopedIds.length === 0) {
      setRows([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    const todayIso = todayIsoLocal();
    try {
      const jobOrdersRef = collection(db, p.jobOrders(tenantId));
      let joDocs: QueryDocumentSnapshot<DocumentData>[];

      if (useAccountScope) {
        const byId = new Map<string, QueryDocumentSnapshot<DocumentData>>();
        await Promise.all(
          scopedIds.map(async (accId) => {
            try {
              const q = query(jobOrdersRef, where('recruiterAccountId', '==', accId));
              const snap = await getDocs(q);
              snap.docs.forEach((d) => byId.set(d.id, d));
            } catch (err) {
              console.warn(
                `useActiveShifts: failed account-scoped job order query for ${accId}:`,
                err,
              );
            }
          }),
        );
        joDocs = Array.from(byId.values());
      } else {
        const joSnap = await getDocs(query(jobOrdersRef));
        joDocs = joSnap.docs;
      }

      // Each entry pairs the public JobOrderLite the rest of the app sees
      // with the private companyId/worksiteId we need to hydrate the
      // address from `crm_companies/{cid}/locations/{lid}`.
      const entries: Array<{
        jo: JobOrderLite;
        companyId: string | null;
        worksiteId: string | null;
      }> = joDocs.map((d) => {
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
            accountName: trimOrUndef(data.accountName),
            recruiterAccountId: trimOrUndef(
              typeof data.recruiterAccountId === 'string'
                ? data.recruiterAccountId
                : typeof data.accountId === 'string'
                  ? data.accountId
                  : undefined,
            ),
            worksiteName: data.worksiteName,
            worksiteAddress: readJoAddress(data),
            startDate: trimOrUndef(data.startDate),
            endDate: trimOrUndef(data.endDate),
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

      // Child / standalone recruiter account display name (`accounts/{id}.name`).
      // JO denormalized `accountName` is often the parent national label;
      // prefer the linked account doc so Shifts shows e.g. "CORT Baltimore
      // Warehouse" instead of "CORT".
      const recruiterAccountNameCache = new Map<string, Promise<string | undefined>>();
      const fetchRecruiterAccountName = (accountId: string) => {
        let pending = recruiterAccountNameCache.get(accountId);
        if (!pending) {
          pending = (async (): Promise<string | undefined> => {
            try {
              const accSnap = await getDoc(
                doc(db, p.recruiterAccount(tenantId, accountId)),
              );
              if (!accSnap.exists()) return undefined;
              const ad = accSnap.data() as Record<string, any>;
              return trimOrUndef(ad?.name);
            } catch (err) {
              console.warn(
                `Failed to hydrate recruiter account name ${accountId}:`,
                err,
              );
              return undefined;
            }
          })();
          recruiterAccountNameCache.set(accountId, pending);
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

      // Per-shift applicant tallies. Built by the applications fan-out batch
      // below from `tenants/{tid}/applications`, then merged onto each
      // `ShiftRow` during assembly. Deduped by userId/candidateId so a
      // worker applying to several shifts in the same JO is counted
      // once per shift.
      type ApplicantTally = {
        confirmed: Set<string>;
        total: Set<string>;
      };
      const tallyByShift = new Map<string, ApplicantTally>();
      const ensureShiftTally = (shiftId: string): ApplicantTally => {
        let t = tallyByShift.get(shiftId);
        if (!t) {
          t = { confirmed: new Set(), total: new Set() };
          tallyByShift.set(shiftId, t);
        }
        return t;
      };
      // Parallel JO-level tally for **career** rows. Career applications
      // are job-level (no shiftId), so the per-shift bucketing above
      // would only count the rare app that happened to write a shiftId
      // back — that's why the table used to show e.g. `Total Applicants: 2`
      // while the drawer's `Applicants` filter showed 67. The drawer
      // returns the full JO pool for career, so the row should too.
      // (Greg, 2026-04-30)
      const tallyByJo = new Map<string, ApplicantTally>();
      const ensureJoTally = (jobOrderId: string): ApplicantTally => {
        let t = tallyByJo.get(jobOrderId);
        if (!t) {
          t = { confirmed: new Set(), total: new Set() };
          tallyByJo.set(jobOrderId, t);
        }
        return t;
      };

      // Fan-out six independent batches in parallel:
      //  1. Address hydration       (mutates entries[i].jo.worksiteAddress)
      //  2. Company-logo hydration  (mutates entries[i].jo.companyLogoUrl)
      //  3. Hiring-entity name      (mutates entries[i].jo.hiringEntityName)
      //  4. Recruiter account name   (mutates entries[i].jo.accountName from accounts/{id})
      //  5. Applicant tallies       (populates `tallyByShift` above)
      //  6. The per-JO shifts subcollection load.
      // Then assemble the final rows.
      const [, , , , , shiftLists] = await Promise.all([
        Promise.all(
          entries.map(async (entry) => {
            const wa = entry.jo.worksiteAddress ?? {};
            const fullyHydrated = wa.street && wa.city && wa.state && wa.zipCode;
            if (!fullyHydrated && entry.companyId && entry.worksiteId) {
              const loc = await fetchLocationAddress(entry.companyId, entry.worksiteId);
              entry.jo.worksiteAddress = {
                street: wa.street || loc.street,
                city: wa.city || loc.city,
                state: wa.state || loc.state,
                zipCode: wa.zipCode || loc.zipCode,
              };
            }
            // Post-address-hydration SUTA/FUTA estimate. `readJoFinancials`
            // ran during the initial JO sync (before `worksiteAddress` was
            // hydrated from the location doc), so cross-account worksites
            // miss the state-based estimate the first time around. Re-run
            // the estimate now that the state is reliable, but keep stored
            // values intact — recruiters who saved an explicit JO/position
            // SUTA/FUTA always win over the new-employer estimate.
            const stateCode = normalizeStateCode(
              typeof entry.jo.worksiteAddress?.state === 'string'
                ? entry.jo.worksiteAddress.state
                : '',
            )
              .trim()
              .toUpperCase();
            if (!stateCode) return;
            if (entry.jo.sutaRate == null) {
              const est = getSutaRateByState(stateCode);
              if (est != null && Number.isFinite(est)) {
                entry.jo.sutaRate = est;
              }
            }
            if (entry.jo.futaRate == null) {
              const est = getFutaRateByState(stateCode);
              if (est != null && Number.isFinite(est)) {
                entry.jo.futaRate = est;
              }
            }
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
        Promise.all(
          entries.map(async (entry) => {
            const aid = entry.jo.recruiterAccountId;
            if (!aid) return;
            const name = await fetchRecruiterAccountName(aid);
            if (name) entry.jo.accountName = name;
          }),
        ),
        // Applicant counts. Queried by `jobOrderId in [...]` chunks
        // (Firestore `in` cap = 30) over the visible JO set.
        //
        // Two parallel tallies:
        //   - tallyByShift  → for **gig** rows. Buckets by an app's
        //                     `shiftId` / `shiftIds`; apps without
        //                     shift metadata are NOT counted here
        //                     because gig applicants pick shifts.
        //   - tallyByJo     → for **career** rows. Career apps are
        //                     job-level, so we count every non-excluded
        //                     applicant against the JO and apply that
        //                     count to all of the JO's shifts when we
        //                     build the row below.
        //
        // Both tallies apply parity with the Placements drawer's
        // `Applicants` filter: skip `candidate === true` (those are
        // candidates, not applicants) and skip statuses the drawer
        // already drops (withdrawn / rejected / waitlisted / deleted),
        // so the table number now matches the drawer number for the
        // same row. Status `'confirmed'` (worker accepted) feeds the
        // confirmed count.
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
                  jobOrderId?: unknown;
                  shiftId?: unknown;
                  shiftIds?: unknown;
                  status?: unknown;
                  userId?: unknown;
                  candidateId?: unknown;
                  candidate?: unknown;
                };
                if (data.candidate === true) return;
                if (
                  typeof data.status === 'string' &&
                  isExcludedFromPlacementsApplicantPool(data.status)
                ) {
                  return;
                }
                const isConfirmed = data.status === 'confirmed';
                const key = dedupKey(data, d.id);

                // JO-level tally — feeds the row count for career JOs.
                const joId =
                  typeof data.jobOrderId === 'string' ? data.jobOrderId.trim() : '';
                if (joId) {
                  const jt = ensureJoTally(joId);
                  jt.total.add(key);
                  if (isConfirmed) jt.confirmed.add(key);
                }

                // Per-shift tally — feeds the row count for gig JOs.
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
                  const t = ensureShiftTally(sid);
                  t.total.add(key);
                  if (isConfirmed) t.confirmed.add(key);
                });
              });
            } catch (err) {
              console.warn('Failed to load applicant counts:', err);
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
        // Career applications are job-level — see the tally fan-out
        // above. Gig applications carry an explicit shiftId. So:
        //   career → use tallyByJo[jobOrderId] for every shift row
        //   gig    → use tallyByShift[shiftId] (shift-specific)
        const isCareerJo =
          String((entry.jo as { jobType?: unknown }).jobType ?? '')
            .trim()
            .toLowerCase() === 'career';
        const joTally = isCareerJo ? tallyByJo.get(entry.jo.id) : null;
        for (const shift of list) {
          const meta = buildActiveRowMeta(shift, entry.jo, todayIso);
          if (!meta) continue;
          const tally = isCareerJo ? joTally : tallyByShift.get(shift.id);
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
  }, [tenantId, scopeKey]);

  useEffect(() => {
    void fetchActiveShifts();
  }, [fetchActiveShifts]);

  return { rows, loading, error, refetch: fetchActiveShifts };
};

export default useActiveShifts;
