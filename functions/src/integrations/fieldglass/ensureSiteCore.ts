/**
 * **ensureSiteCore — the shared site → CRM location → child account engine
 * (FG Slices 3+4).**
 *
 * One implementation, two callers:
 *   - `fieldglassEnsureSite` callable (recruiter button on /shifts/log —
 *     dry-run preview, explicit siteCode picks, client-geocoded street).
 *   - `onFieldglassIngestEventCreatedParse` trigger (auto mode — Greg,
 *     2026-07-06: "we want this to happen. Everything short of a job
 *     order."). Auto mode pre-stages the chain the minute an order email
 *     lands, BUT only creates new records on an EXACT site-directory match
 *     (`requireDirectoryMatchForCreate`) — ambiguous or unknown site names
 *     park as needs-review for the button. Reuse of existing records is
 *     always allowed. No browser in the loop means no street address (the
 *     Maps key is browser-restricted; verified REQUEST_DENIED server-side
 *     2026-07-06) — locations are created with directory city/state/zip and
 *     the street is backfilled on first human touch via the dialog.
 *
 * Every layer checks for an existing record before creating, so re-runs
 * are always safe. Child creation delegates to
 * `tryCreateChildAccountForNationalParent` with the parent toggle
 * deliberately bypassed — Sodexo keeps `autoCreateChildAccountsForLocations:
 * false`, so manually-added locations still don't spawn accounts.
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';

import {
  deterministicAutoChildAccountDocId,
  tryCreateChildAccountForNationalParent,
} from '../../autoChildAccountFromCompanyLocation';
import { serverGeocodeSite, type ServerGeocodeHit } from './serverGeocode';
import {
  lookupSiteByCode,
  lookupSitesByName,
  normalizeSiteName,
  SodexoSiteRow,
} from './siteDirectory';

const FieldValue = admin.firestore.FieldValue;

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

export class EnsureSiteError extends Error {
  constructor(
    public code: 'failed_precondition' | 'internal',
    message: string,
  ) {
    super(message);
  }
}

export interface EnsureSiteAddress {
  street?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  lat?: number;
  lng?: number;
}

export interface EnsureSiteParams {
  tenantId: string;
  siteName: string;
  siteCode?: string;
  requestId?: string;
  execute: boolean;
  address?: EnsureSiteAddress;
  /** Audit tag — a uid for the callable, a system tag for the trigger. */
  actor: string;
  /** Auto mode: refuse to CREATE anything unless the site directory match
   *  is exact. Reusing existing records still proceeds. */
  requireDirectoryMatchForCreate?: boolean;
}

export type EnsureSiteLayerStatus =
  | 'exists'
  | 'would_create'
  | 'created'
  | 'would_link'
  | 'linked';

export interface EnsureSiteResult {
  ok: true;
  dryRun: boolean;
  /** Set when auto mode declined to create (ambiguous/unknown site). */
  skipped?: 'needs_directory_pick' | 'not_in_directory';
  directory: {
    status: 'exact' | 'ambiguous' | 'not_in_directory';
    row?: SodexoSiteRow;
    candidates?: SodexoSiteRow[];
  };
  location: {
    status: EnsureSiteLayerStatus;
    id?: string;
    name: string;
    codeBackfilled?: boolean;
    /** Existing location has no street — the dialog offers a backfill. */
    missingStreet?: boolean;
    /** Street was patched onto an existing location this run. */
    streetBackfilled?: boolean;
    address?: { street: string; city: string; state: string; zipCode: string };
  };
  childAccount: {
    status: EnsureSiteLayerStatus;
    id?: string;
    name: string;
    matchedBy?: 'location_meta' | 'deterministic_id' | 'name';
  };
  stampedRequest: boolean;
  alreadyResolved?: { locationId: string; childAccountId: string };
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

/**
 * Find the location this Fieldglass site already maps to.
 *
 * Site CODE is the only globally-unique key, so a code hit is authoritative.
 * The name fallback exists because a location may predate its first FG order
 * and therefore carry no code yet — but a name alone is NOT identifying:
 * Sodexo reuses site names across the country, and HRX also holds
 * manually-created locations (CRM prospects) that share a client's name.
 *
 * **Guard (2026-07-15)**: a name match must AGREE with the directory's
 * city/state for the code before we reuse it. Without this, FG order
 * SDXOJP00188954 for GRIFOLS (0037445001 = CLAYTON, NC) matched a
 * hand-created "Grifols" location at Grifols' corporate HQ in Emeryville CA,
 * then stamped the NC site code onto it — cementing the wrong mapping for
 * every future GRIFOLS order and publishing an NC job as a Bay Area job.
 * A conflicting name match now returns null, so the caller creates the
 * correct location instead of hijacking an unrelated one.
 */
function findExistingLocation(
  locations: LocationDocLite[],
  siteCode: string | null,
  siteName: string,
  expected?: { city?: string | null; state?: string | null } | null,
): LocationDocLite | null {
  if (siteCode) {
    const byCode = locations.find((l) => locationCode(l.data) === siteCode);
    if (byCode) return byCode;
  }
  const wanted = normalizeSiteName(siteName);
  if (!wanted) return null;
  const byName = locations.find(
    (l) =>
      normalizeSiteName(String(l.data.name ?? '')) === wanted ||
      normalizeSiteName(String(l.data.nickname ?? '')) === wanted,
  );
  if (!byName) return null;

  // Only trust the name when geography doesn't contradict it. STATE is the
  // discriminator; city is deliberately NOT checked.
  //
  // A city difference is routinely legitimate: Sodexo's site record is an
  // org/billing unit whose city can differ from the order's actual Work
  // Location. Real example — site 0059008001 is "ADP - SAN DIMAS" in the
  // directory, but posting SDXOJP00184639 sends its workers to ADP's campus
  // at 5355 Orangethorpe Dr, La Palma (40 mi away). Blocking on city there
  // would reject a correct location and duplicate it. A STATE mismatch has
  // no such innocent reading — that's the Grifols hijack (an NC job matched
  // to a CA office).
  //
  // A location with no state recorded can't contradict, so it stays reusable
  // (the pre-code case this fallback was written for).
  const expState = String(expected?.state ?? '').trim().toUpperCase();
  const gotState = String(byName.data.state ?? '').trim().toUpperCase();
  if (expState && gotState && expState !== gotState) return null;
  return byName;
}

// ─────────────────────────────────────────────────────────────────────
// Child-account matching
// ─────────────────────────────────────────────────────────────────────

interface ChildMatch {
  id: string;
  name: string;
  matchedBy: 'location_meta' | 'deterministic_id' | 'name';
  needsLocationLink: boolean;
}

async function findExistingChildAccount(params: {
  db: FirebaseFirestore.Firestore;
  tenantId: string;
  parentAccountId: string;
  parentName: string;
  companyId: string;
  locationId: string | null;
  siteName: string;
  locationDisplayName: string | null;
}): Promise<ChildMatch | null> {
  const {
    db,
    tenantId,
    parentAccountId,
    parentName,
    companyId,
    locationId,
    siteName,
    locationDisplayName,
  } = params;
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

    // Meta query — children created before/outside the deterministic-id
    // scheme that still carry the linkage fields.
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
      // to a different location needs re-pointing (visible as "will link"
      // in the preview either way).
      needsLocationLink:
        linkedLocationId === '' || (locationId !== null && linkedLocationId !== locationId),
    };
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────
// Core flow
// ─────────────────────────────────────────────────────────────────────

export async function ensureSiteCore(
  db: FirebaseFirestore.Firestore,
  params: EnsureSiteParams,
): Promise<EnsureSiteResult> {
  const {
    tenantId,
    siteName,
    siteCode,
    requestId,
    execute,
    address,
    actor,
    requireDirectoryMatchForCreate = false,
  } = params;

  if (!tenantId || !siteName?.trim()) {
    throw new EnsureSiteError('failed_precondition', 'tenantId and siteName are required');
  }

  // ── Config: which CRM company + national account is "Sodexo"?
  const configSnap = await db.doc(`tenants/${tenantId}/integrations/fieldglass`).get();
  const config = (configSnap.data() ?? {}) as Record<string, unknown>;
  const companyId = String(config.crmCompanyId ?? '').trim();
  const parentAccountId = String(config.nationalAccountId ?? '').trim();
  if (!companyId || !parentAccountId) {
    throw new EnsureSiteError(
      'failed_precondition',
      `Set crmCompanyId and nationalAccountId on tenants/${tenantId}/integrations/fieldglass first`,
    );
  }
  const parentSnap = await db.doc(`tenants/${tenantId}/accounts/${parentAccountId}`).get();
  if (!parentSnap.exists) {
    throw new EnsureSiteError('failed_precondition', `National account ${parentAccountId} not found`);
  }
  const parentData = parentSnap.data() as Record<string, unknown>;
  if (parentData.accountType !== 'national') {
    throw new EnsureSiteError(
      'failed_precondition',
      `Account ${parentAccountId} is not a national account`,
    );
  }
  const parentName = String(parentData.name ?? '').trim() || 'Account';

  // ── Prior stamp? (idempotency shortcut for the UI)
  let requestRef: FirebaseFirestore.DocumentReference | null = null;
  let alreadyResolved: EnsureSiteResult['alreadyResolved'];
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
  let directory: EnsureSiteResult['directory'];
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
      if (execute && !requireDirectoryMatchForCreate) {
        throw new EnsureSiteError(
          'failed_precondition',
          `"${siteName}" matches ${candidates.length} directory sites — pass siteCode to pick one`,
        );
      }
    } else {
      directory = { status: 'not_in_directory' };
    }
  }
  const resolvedSiteCode = directoryRow?.siteCode ?? siteCode?.trim() ?? null;

  // ── Step 2: location
  const locationsRef = db.collection(`tenants/${tenantId}/crm_companies/${companyId}/locations`);
  const locationsSnap = await locationsRef.get();
  const locations: LocationDocLite[] = locationsSnap.docs.map((d) => ({
    id: d.id,
    data: d.data() as Record<string, unknown>,
  }));

  // Pass the directory's authoritative city/state (falling back to the
  // order's own work-location address) so a name-only match in the wrong
  // geography is rejected rather than hijacked — see findExistingLocation.
  const existingLocation = findExistingLocation(locations, resolvedSiteCode, siteName, {
    city: directoryRow?.city ?? address?.city ?? null,
    state: directoryRow?.state ?? address?.state ?? null,
  });

  // Auto mode guard: creating a NEW location demands an exact directory
  // match. Reusing an existing one (already human-vetted) is fine.
  if (requireDirectoryMatchForCreate && directory.status !== 'exact' && !existingLocation) {
    return {
      ok: true,
      dryRun: !execute,
      skipped: directory.status === 'ambiguous' ? 'needs_directory_pick' : 'not_in_directory',
      directory,
      location: { status: 'would_create', name: siteName.trim() },
      childAccount: { status: 'would_create', name: `${parentName} ${siteName.trim()}` },
      stampedRequest: false,
      ...(alreadyResolved ? { alreadyResolved } : {}),
    };
  }

  const newLocationAddress = {
    street: String(address?.street ?? '').trim(),
    city: String(address?.city ?? directoryRow?.city ?? '').trim(),
    state: String(address?.state ?? directoryRow?.state ?? '').trim(),
    zipCode: String(address?.zipCode ?? directoryRow?.zip ?? '').trim(),
  };

  // Server-side geocoding (FG Slice 4b) — execute mode only (the dialog
  // geocodes client-side for previews). Two needs, one call:
  //   - needStreet: no street from any source → resolve by SITE NAME.
  //   - needCoords: street known but no lat/lng anywhere (the extension
  //     path supplies the street from the detail page WITHOUT coords —
  //     first live run left PSH Lancaster's location coordinate-less,
  //     which silently killed the radius blast) → geocode the ADDRESS.
  // Fail-open: a null hit keeps whatever we have.
  let serverHit: ServerGeocodeHit | null = null;
  const targetLacksStreet = existingLocation
    ? !String(existingLocation.data.address ?? '').trim()
    : true;
  const needStreet = !newLocationAddress.street && targetLacksStreet;
  const haveClientCoords = address?.lat != null && address?.lng != null;
  const targetLacksCoords = existingLocation
    ? !(existingLocation.data.coordinates as Record<string, unknown> | null | undefined)
    : true;
  const needCoords = !haveClientCoords && targetLacksCoords;
  if (execute && (needStreet || needCoords)) {
    const knownStreet =
      newLocationAddress.street || String(existingLocation?.data.address ?? '').trim();
    serverHit = await serverGeocodeSite({
      // Street-precise when we have one; site-name lookup otherwise.
      siteName: needStreet ? siteName.trim() : knownStreet || siteName.trim(),
      city: newLocationAddress.city || undefined,
      state: newLocationAddress.state || undefined,
      zip: newLocationAddress.zipCode || undefined,
      expectedState: directoryRow?.state ?? newLocationAddress.state ?? undefined,
    });
    if (serverHit && needStreet) {
      newLocationAddress.street = serverHit.street;
      if (!newLocationAddress.zipCode && serverHit.zipCode) {
        newLocationAddress.zipCode = serverHit.zipCode;
      }
    }
  }

  let location: EnsureSiteResult['location'];
  let locationId: string | null = existingLocation?.id ?? null;
  const locationDisplayNameForChild: string | null = existingLocation
    ? locationDisplay(existingLocation.data) || siteName.trim()
    : siteName.trim();
  const wouldBackfillCode = Boolean(
    existingLocation && resolvedSiteCode && !locationCode(existingLocation.data),
  );
  const existingStreet = existingLocation
    ? String(existingLocation.data.address ?? '').trim()
    : '';
  const canBackfillStreet = Boolean(
    existingLocation && !existingStreet && newLocationAddress.street,
  );

  if (existingLocation) {
    location = {
      status: 'exists',
      id: existingLocation.id,
      name: locationDisplay(existingLocation.data) || existingLocation.id,
      codeBackfilled: wouldBackfillCode,
      missingStreet: !existingStreet && !canBackfillStreet,
      streetBackfilled: false,
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
      const patch: Record<string, unknown> = {};
      if (wouldBackfillCode) {
        patch.code = resolvedSiteCode;
        patch.externalIds = { fieldglassSiteCode: resolvedSiteCode };
      }
      if (canBackfillStreet) {
        patch.address = newLocationAddress.street;
        location.streetBackfilled = true;
        location.missingStreet = false;
      }
      // Coordinates backfill is independent of the street: an existing
      // location with a street but no lat/lng still gets coords (radius
      // blast depends on them).
      const coords =
        address?.lat != null && address?.lng != null
          ? { lat: address.lat, lng: address.lng }
          : serverHit
            ? { lat: serverHit.lat, lng: serverHit.lng }
            : null;
      if (coords && !(existingLocation.data.coordinates as Record<string, unknown> | null)) {
        patch.coordinates = coords;
      }
      if (Object.keys(patch).length > 0) {
        patch.updatedAt = FieldValue.serverTimestamp();
        await locationsRef.doc(existingLocation.id).set(patch, { merge: true });
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
            : serverHit
              ? { lat: serverHit.lat, lng: serverHit.lng }
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
      logger.info('[ensureSiteCore] location created', {
        tenantId,
        companyId,
        locationId: newRef.id,
        siteName: siteName.trim(),
        siteCode: resolvedSiteCode,
        actor,
      });
    }
  }

  // ── Step 3: child account
  const childMatch = await findExistingChildAccount({
    db,
    tenantId,
    parentAccountId,
    parentName,
    companyId,
    locationId,
    siteName,
    locationDisplayName: locationDisplayNameForChild,
  });

  let childAccount: EnsureSiteResult['childAccount'];
  if (childMatch) {
    if (childMatch.needsLocationLink) {
      // Legacy child found by name but not wired to this location — the
      // "connect" step of the manual process.
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
            updatedBy: `fieldglass_ensure_site:${actor}`,
          },
          { merge: true },
        );
        logger.info('[ensureSiteCore] legacy child linked to location', {
          tenantId,
          childAccountId: childMatch.id,
          locationId,
          actor,
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
      name: `${parentName} ${locationDisplayNameForChild ?? siteName.trim()}`
        .replace(/\s+/g, ' ')
        .trim(),
    };
  } else {
    if (!locationId) {
      throw new EnsureSiteError('internal', 'Location id missing after create — cannot create child');
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
      actorUid: actor,
    });
    if (
      outcome !== 'created' &&
      outcome !== 'skipped_duplicate' &&
      outcome !== 'skipped_idempotent'
    ) {
      throw new EnsureSiteError('internal', `Child account creation failed: ${outcome}`);
    }
    const childId = deterministicAutoChildAccountDocId(parentAccountId, companyId, locationId);
    const childSnap = await db.doc(`tenants/${tenantId}/accounts/${childId}`).get();
    childAccount = {
      status: outcome === 'created' ? 'created' : 'exists',
      id: childSnap.exists ? childId : undefined,
      name: childSnap.exists
        ? String((childSnap.data() as Record<string, unknown>).name ?? childId)
        : `${parentName} ${locationDisplayNameForChild ?? siteName.trim()}`,
    };
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
          resolvedBy: actor,
        },
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    stampedRequest = true;
  }

  const out: EnsureSiteResult = {
    ok: true,
    dryRun: !execute,
    directory,
    location,
    childAccount,
    stampedRequest,
  };
  if (alreadyResolved) out.alreadyResolved = alreadyResolved;

  logger.info('[ensureSiteCore] done', {
    tenantId,
    execute,
    siteName: siteName.trim(),
    siteCode: resolvedSiteCode,
    locationStatus: location.status,
    locationId: location.id ?? null,
    childStatus: childAccount.status,
    childAccountId: childAccount.id ?? null,
    actor,
  });
  return out;
}
