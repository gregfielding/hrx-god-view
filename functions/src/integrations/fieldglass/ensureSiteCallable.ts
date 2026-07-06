/**
 * **fieldglassEnsureSite — idempotent site → location → child-account chain
 * (FG Slice 3).**
 *
 * Automates the manual sequence Greg described (2026-07-06): "add the
 * location to the CRM company Sodexo, then create the child account, then
 * connect the child account to that location" — with existence checks at
 * every layer so re-running is always safe.
 *
 * Resolution chain:
 *   1. Site name (from the Fieldglass email) → Sodexo site directory
 *      (bundled export; see siteDirectory.ts) → Site Code + city/state/zip.
 *      Duplicate names (~5% of the export) return candidates; execute then
 *      requires an explicit siteCode pick.
 *   2. Location existence: fetch the CRM company's `locations` subcollection
 *      once and scan in memory — by `code`/`externalIds.fieldglassSiteCode`
 *      first (durable key), normalized name second. Missing → create, with
 *      the client-resolved street address (the browser geocodes
 *      "{site}, {city}, {state} {zip}" via the existing Maps key; the
 *      server deliberately has no Maps credential yet).
 *   3. Child account existence: deterministic autoLoc_ id + the
 *      (parentAccountId, companyId, companyLocationId) meta query + a
 *      normalized-name match for legacy hand-made children. Missing →
 *      `tryCreateChildAccountForNationalParent(requireAutoCreateToggle:false)`
 *      — the same engine behind Hyatt/CORT/Domino's auto-children, bypassing
 *      the parent toggle ON PURPOSE: Sodexo keeps
 *      `autoCreateChildAccountsForLocations: false` so manually-added
 *      locations don't spawn accounts; only this Fieldglass path does.
 *      A legacy child found by name but missing location linkage gets the
 *      linkage patched on (the "connect" step).
 *   4. Stamp `siteResolution` onto the `external_shift_requests` row so the
 *      review UI shows the resolved ids and later slices (JO creation) can
 *      read them.
 *
 * No job orders are created here — Sodexo's `autoCreateGigJobOrders` is
 * unset, so the child-account write triggers nothing downstream. That's the
 * next slice, deliberately.
 *
 * Parent/company ids come from the `tenants/{tid}/integrations/fieldglass`
 * config doc (`crmCompanyId`, `nationalAccountId`) — no prod doc ids in code.
 */

import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';

import {
  deterministicAutoChildAccountDocId,
  tryCreateChildAccountForNationalParent,
} from '../../autoChildAccountFromCompanyLocation';
import { lookupSiteByCode, lookupSitesByName, normalizeSiteName, SodexoSiteRow } from './siteDirectory';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

// ─────────────────────────────────────────────────────────────────────
// IO shapes
// ─────────────────────────────────────────────────────────────────────

interface InputAddress {
  street?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  lat?: number;
  lng?: number;
}

interface Input {
  tenantId: string;
  /** Site name as printed on the email (or corrected by the recruiter). */
  siteName: string;
  /** Explicit directory pick — required on execute when the name is
   *  ambiguous in the directory. */
  siteCode?: string;
  /** external_shift_requests doc to stamp with the resolved ids. */
  requestId?: string;
  /** false/absent = dry-run: report the plan, write nothing. */
  execute?: boolean;
  /** Client-side geocoded street address for a location we're creating. */
  address?: InputAddress;
}

type LayerStatus = 'exists' | 'would_create' | 'created' | 'would_link' | 'linked';

interface Output {
  ok: true;
  dryRun: boolean;
  directory: {
    status: 'exact' | 'ambiguous' | 'not_in_directory';
    row?: SodexoSiteRow;
    candidates?: SodexoSiteRow[];
  };
  location: {
    status: LayerStatus;
    id?: string;
    name: string;
    /** True when an existing location was missing its Site Code and we
     *  backfilled it (execute) / would backfill it (dry-run). */
    codeBackfilled?: boolean;
    address?: { street: string; city: string; state: string; zipCode: string };
  };
  childAccount: {
    status: LayerStatus;
    id?: string;
    name: string;
    matchedBy?: 'location_meta' | 'deterministic_id' | 'name';
  };
  stampedRequest: boolean;
  /** Resolution already stamped on the request by a prior run. */
  alreadyResolved?: { locationId: string; childAccountId: string };
}

// ─────────────────────────────────────────────────────────────────────
// Auth — same gate as the rest of the shift-log surface
// (linkVenueToAccountCallable.ts).
// ─────────────────────────────────────────────────────────────────────

async function assertCallerCanEdit(callerUid: string, tenantId: string): Promise<void> {
  const snap = await db.collection('users').doc(callerUid).get();
  if (!snap.exists) throw new HttpsError('permission-denied', 'User not found');
  const data = snap.data() as Record<string, unknown>;
  if (data.isHRX === true || data.hrx === true) return;
  const tenantMeta = (data.tenantIds as Record<string, unknown> | undefined)?.[tenantId] as
    | Record<string, unknown>
    | undefined;
  if (!tenantMeta) throw new HttpsError('permission-denied', 'No access to this tenant');
  const role = String(tenantMeta.role || '').trim().toLowerCase();
  if (['recruiter', 'manager', 'admin'].includes(role)) return;
  const secRaw = tenantMeta.securityLevel ?? data.securityLevel ?? '0';
  const sec = parseInt(String(secRaw), 10);
  if (!Number.isNaN(sec) && sec >= 5) return;
  throw new HttpsError('permission-denied', 'Not authorized to manage Fieldglass sites');
}

// ─────────────────────────────────────────────────────────────────────
// Location matching
// ─────────────────────────────────────────────────────────────────────

interface LocationDocLite {
  id: string;
  data: Record<string, unknown>;
}

function locationCode(loc: Record<string, unknown>): string {
  const direct = String(loc.code ?? '').trim();
  if (direct) return direct;
  const ext = loc.externalIds as Record<string, unknown> | undefined;
  return String(ext?.fieldglassSiteCode ?? '').trim();
}

function locationDisplay(loc: Record<string, unknown>): string {
  const nick = String(loc.nickname ?? '').trim();
  if (nick) return nick;
  return String(loc.name ?? '').trim();
}

function findExistingLocation(
  locations: LocationDocLite[],
  siteCode: string | null,
  siteName: string,
): LocationDocLite | null {
  if (siteCode) {
    const byCode = locations.find((l) => locationCode(l.data) === siteCode);
    if (byCode) return byCode;
  }
  const wanted = normalizeSiteName(siteName);
  if (!wanted) return null;
  return (
    locations.find(
      (l) =>
        normalizeSiteName(String(l.data.name ?? '')) === wanted ||
        normalizeSiteName(String(l.data.nickname ?? '')) === wanted,
    ) ?? null
  );
}

// ─────────────────────────────────────────────────────────────────────
// Child-account matching
// ─────────────────────────────────────────────────────────────────────

interface ChildMatch {
  id: string;
  name: string;
  matchedBy: 'location_meta' | 'deterministic_id' | 'name';
  /** True when the child doc lacks companyLocationId/associations.locations
   *  linkage to this location (legacy hand-made children). */
  needsLocationLink: boolean;
}

async function findExistingChildAccount(params: {
  tenantId: string;
  parentAccountId: string;
  parentName: string;
  companyId: string;
  locationId: string | null;
  siteName: string;
  locationDisplayName: string | null;
}): Promise<ChildMatch | null> {
  const { tenantId, parentAccountId, parentName, companyId, locationId, siteName, locationDisplayName } = params;
  const accountsCol = db.collection(`tenants/${tenantId}/accounts`);

  if (locationId) {
    // Fast path: the deterministic id every auto-created child uses.
    const detId = deterministicAutoChildAccountDocId(parentAccountId, companyId, locationId);
    const detSnap = await accountsCol.doc(detId).get();
    if (detSnap.exists) {
      return {
        id: detId,
        name: String((detSnap.data() as Record<string, unknown>).name ?? detId),
        matchedBy: 'deterministic_id',
        needsLocationLink: false,
      };
    }

    // Meta query — catches children created before/outside the
    // deterministic-id scheme that still carry the linkage fields.
    const byMeta = await accountsCol
      .where('parentAccountId', '==', parentAccountId)
      .where('companyId', '==', companyId)
      .where('companyLocationId', '==', locationId)
      .limit(1)
      .get();
    if (!byMeta.empty) {
      const d = byMeta.docs[0];
      return {
        id: d.id,
        name: String((d.data() as Record<string, unknown>).name ?? d.id),
        matchedBy: 'location_meta',
        needsLocationLink: false,
      };
    }
  }

  // Legacy name match — hand-made children like "Sodexo Beaver Dam Wayland
  // Academy" predate the linkage fields. Compare normalized
  // "{parent} {site}" (punctuation-insensitive, so "Sodexo - X" matches too).
  const nameTargets = new Set<string>();
  const site = normalizeSiteName(siteName);
  if (site) nameTargets.add(normalizeSiteName(`${parentName} ${site}`));
  if (locationDisplayName) {
    nameTargets.add(normalizeSiteName(`${parentName} ${locationDisplayName}`));
  }
  if (nameTargets.size === 0) return null;

  const children = await accountsCol.where('parentAccountId', '==', parentAccountId).get();
  for (const d of children.docs) {
    const data = d.data() as Record<string, unknown>;
    const childNorm = normalizeSiteName(String(data.name ?? ''));
    if (!childNorm || !nameTargets.has(childNorm)) continue;
    const linkedLocationId = String(data.companyLocationId ?? '').trim();
    return {
      id: d.id,
      name: String(data.name ?? d.id),
      matchedBy: 'name',
      // Unlinked legacy child always needs the connect step; a child linked
      // to a different location needs re-pointing (recruiter sees "will
      // link" in the preview either way).
      needsLocationLink:
        linkedLocationId === '' || (locationId !== null && linkedLocationId !== locationId),
    };
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────
// Callable
// ─────────────────────────────────────────────────────────────────────

export const fieldglassEnsureSite = onCall<Input, Promise<Output>>(
  {
    enforceAppCheck: false,
    cors: true,
    memory: '512MiB',
    timeoutSeconds: 120,
  },
  async (req): Promise<Output> => {
    if (!req.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
    const { tenantId, siteName, siteCode, requestId, execute = false, address } =
      req.data || ({} as Input);
    if (!tenantId || !siteName?.trim()) {
      throw new HttpsError('invalid-argument', 'tenantId and siteName are required');
    }
    await assertCallerCanEdit(req.auth.uid, tenantId);
    const actorUid = req.auth.uid;

    // ── Config: which CRM company + national account is "Sodexo"?
    const configSnap = await db.doc(`tenants/${tenantId}/integrations/fieldglass`).get();
    const config = (configSnap.data() ?? {}) as Record<string, unknown>;
    const companyId = String(config.crmCompanyId ?? '').trim();
    const parentAccountId = String(config.nationalAccountId ?? '').trim();
    if (!companyId || !parentAccountId) {
      throw new HttpsError(
        'failed-precondition',
        `Set crmCompanyId and nationalAccountId on tenants/${tenantId}/integrations/fieldglass first`,
      );
    }
    const parentSnap = await db.doc(`tenants/${tenantId}/accounts/${parentAccountId}`).get();
    if (!parentSnap.exists) {
      throw new HttpsError('failed-precondition', `National account ${parentAccountId} not found`);
    }
    const parentData = parentSnap.data() as Record<string, unknown>;
    if (parentData.accountType !== 'national') {
      throw new HttpsError(
        'failed-precondition',
        `Account ${parentAccountId} is not a national account`,
      );
    }
    const parentName = String(parentData.name ?? '').trim() || 'Account';

    // ── Prior stamp? (idempotency shortcut for the UI)
    let requestRef: FirebaseFirestore.DocumentReference | null = null;
    let alreadyResolved: Output['alreadyResolved'];
    if (requestId) {
      requestRef = db.doc(`tenants/${tenantId}/external_shift_requests/${requestId}`);
      const reqSnap = await requestRef.get();
      if (reqSnap.exists) {
        const prior = (reqSnap.data() as Record<string, unknown>).siteResolution as
          | Record<string, unknown>
          | undefined;
        if (prior?.locationId && prior?.childAccountId) {
          alreadyResolved = {
            locationId: String(prior.locationId),
            childAccountId: String(prior.childAccountId),
          };
        }
      } else {
        requestRef = null;
      }
    }

    // ── Step 1: site directory
    let directory: Output['directory'];
    let directoryRow: SodexoSiteRow | null = null;
    if (siteCode?.trim()) {
      directoryRow = lookupSiteByCode(siteCode.trim());
      directory = directoryRow
        ? { status: 'exact', row: directoryRow }
        : { status: 'not_in_directory' };
    } else {
      const candidates = lookupSitesByName(siteName);
      if (candidates.length === 1) {
        directoryRow = candidates[0];
        directory = { status: 'exact', row: directoryRow };
      } else if (candidates.length > 1) {
        directory = { status: 'ambiguous', candidates: candidates.slice(0, 10) };
        if (execute) {
          throw new HttpsError(
            'failed-precondition',
            `"${siteName}" matches ${candidates.length} directory sites — pass siteCode to pick one`,
          );
        }
      } else {
        directory = { status: 'not_in_directory' };
      }
    }
    const resolvedSiteCode = directoryRow?.siteCode ?? siteCode?.trim() ?? null;

    // ── Step 2: location
    const locationsRef = db.collection(
      `tenants/${tenantId}/crm_companies/${companyId}/locations`,
    );
    const locationsSnap = await locationsRef.get();
    const locations: LocationDocLite[] = locationsSnap.docs.map((d) => ({
      id: d.id,
      data: d.data() as Record<string, unknown>,
    }));

    const existingLocation = findExistingLocation(locations, resolvedSiteCode, siteName);

    const newLocationAddress = {
      street: String(address?.street ?? '').trim(),
      city: String(address?.city ?? directoryRow?.city ?? '').trim(),
      state: String(address?.state ?? directoryRow?.state ?? '').trim(),
      zipCode: String(address?.zipCode ?? directoryRow?.zip ?? '').trim(),
    };

    let location: Output['location'];
    let locationId: string | null = existingLocation?.id ?? null;
    let locationDisplayNameForChild: string | null = existingLocation
      ? locationDisplay(existingLocation.data) || siteName.trim()
      : siteName.trim();
    const wouldBackfillCode = Boolean(
      existingLocation && resolvedSiteCode && !locationCode(existingLocation.data),
    );

    if (existingLocation) {
      location = {
        status: 'exists',
        id: existingLocation.id,
        name: locationDisplay(existingLocation.data) || existingLocation.id,
        codeBackfilled: wouldBackfillCode,
      };
    } else {
      location = {
        status: execute ? 'created' : 'would_create',
        name: siteName.trim(),
        address: newLocationAddress,
      };
    }

    // ── Execute: create/patch the location first (the child's deterministic
    // id and linkage need a real locationId).
    if (execute) {
      if (existingLocation) {
        if (wouldBackfillCode) {
          await locationsRef.doc(existingLocation.id).set(
            {
              code: resolvedSiteCode,
              externalIds: { fieldglassSiteCode: resolvedSiteCode },
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true },
          );
        }
      } else {
        // Field shape mirrors the existing manual/Apollo location docs so
        // every downstream reader (mirror trigger, worksite hydration,
        // CompanyDetails UI) sees a normal location.
        const newRef = locationsRef.doc();
        const payload: Record<string, unknown> = {
          name: siteName.trim(),
          code: resolvedSiteCode ?? '',
          address: newLocationAddress.street,
          city: newLocationAddress.city,
          state: newLocationAddress.state,
          zipCode: newLocationAddress.zipCode,
          country: 'US',
          type: 'Worksite',
          division: '',
          phone: '',
          coordinates:
            address?.lat != null && address?.lng != null
              ? { lat: address.lat, lng: address.lng }
              : null,
          discoveredBy: 'Fieldglass',
          discoveredAt: new Date().toISOString(),
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          contactCount: 0,
          dealCount: 0,
          salespersonCount: 0,
        };
        if (resolvedSiteCode) {
          payload.externalIds = { fieldglassSiteCode: resolvedSiteCode };
        }
        await newRef.set(payload);
        locationId = newRef.id;
        location.id = newRef.id;
        logger.info('[fieldglassEnsureSite] location created', {
          tenantId,
          companyId,
          locationId: newRef.id,
          siteName: siteName.trim(),
          siteCode: resolvedSiteCode,
          actorUid,
        });
      }
    }

    // ── Step 3: child account
    const childMatch = await findExistingChildAccount({
      tenantId,
      parentAccountId,
      parentName,
      companyId,
      locationId,
      siteName,
      locationDisplayName: locationDisplayNameForChild,
    });

    let childAccount: Output['childAccount'];
    if (childMatch) {
      if (childMatch.needsLocationLink) {
        // Legacy child found by name but not wired to this location — the
        // "connect" step of Greg's manual process.
        childAccount = {
          status: execute ? 'linked' : 'would_link',
          id: childMatch.id,
          name: childMatch.name,
          matchedBy: childMatch.matchedBy,
        };
        if (execute && locationId) {
          await db.doc(`tenants/${tenantId}/accounts/${childMatch.id}`).set(
            {
              companyId,
              companyLocationId: locationId,
              associations: {
                companyIds: FieldValue.arrayUnion(companyId),
                locations: FieldValue.arrayUnion({ companyId, locationId }),
              },
              updatedAt: FieldValue.serverTimestamp(),
              updatedBy: `fieldglass_ensure_site:${actorUid}`,
            },
            { merge: true },
          );
          logger.info('[fieldglassEnsureSite] legacy child linked to location', {
            tenantId,
            childAccountId: childMatch.id,
            locationId,
            actorUid,
          });
        }
      } else {
        childAccount = {
          status: 'exists',
          id: childMatch.id,
          name: childMatch.name,
          matchedBy: childMatch.matchedBy,
        };
      }
    } else if (!execute) {
      childAccount = {
        status: 'would_create',
        name: `${parentName} ${locationDisplayNameForChild ?? siteName.trim()}`.replace(/\s+/g, ' ').trim(),
      };
    } else {
      if (!locationId) {
        throw new HttpsError('internal', 'Location id missing after create — cannot create child');
      }
      const locSnap = await locationsRef.doc(locationId).get();
      const outcome = await tryCreateChildAccountForNationalParent({
        db,
        tenantId,
        parentAccountId,
        companyId,
        locationId,
        locationData: (locSnap.data() ?? {}) as Record<string, unknown>,
        requireAutoCreateToggle: false,
        actorUid,
      });
      if (outcome !== 'created' && outcome !== 'skipped_duplicate' && outcome !== 'skipped_idempotent') {
        throw new HttpsError('internal', `Child account creation failed: ${outcome}`);
      }
      const childId = deterministicAutoChildAccountDocId(parentAccountId, companyId, locationId);
      const childSnap = await db.doc(`tenants/${tenantId}/accounts/${childId}`).get();
      childAccount = {
        status: 'created',
        id: childSnap.exists ? childId : undefined,
        name: childSnap.exists
          ? String((childSnap.data() as Record<string, unknown>).name ?? childId)
          : `${parentName} ${locationDisplayNameForChild ?? siteName.trim()}`,
      };
      // Duplicate outcomes mean a concurrent/prior create won — treat as exists.
      if (outcome !== 'created') childAccount.status = 'exists';
    }

    // ── Step 4: stamp the review-queue row
    let stampedRequest = false;
    if (execute && requestRef && locationId && childAccount.id) {
      await requestRef.set(
        {
          siteResolution: {
            siteName: siteName.trim(),
            siteCode: resolvedSiteCode,
            companyId,
            locationId,
            childAccountId: childAccount.id,
            resolvedAt: new Date().toISOString(),
            resolvedBy: actorUid,
          },
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      stampedRequest = true;
    }

    const out: Output = {
      ok: true,
      dryRun: !execute,
      directory,
      location,
      childAccount,
      stampedRequest,
    };
    if (alreadyResolved) out.alreadyResolved = alreadyResolved;

    logger.info('[fieldglassEnsureSite] done', {
      tenantId,
      execute,
      siteName: siteName.trim(),
      siteCode: resolvedSiteCode,
      locationStatus: location.status,
      locationId: location.id ?? null,
      childStatus: childAccount.status,
      childAccountId: childAccount.id ?? null,
      actorUid,
    });
    return out;
  },
);
