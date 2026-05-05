/*
  Repair saved smart groups whose `filters` blob is missing the
  `filterMode` / `residenceSubMode` discriminators (the pre-2026-05-05 bug
  in `SmartGroupsPage.handleSaveSmartSearch`). Without those fields, the
  runner falls through to "Residence area" with no filters set and matches
  every applicant in the tenant — typical symptom: a 10-mile radius group
  shows 1500+ members instead of 50.

  What this script does, per saved group doc:
    1. Normalise discriminators in `filters` (cheap, all groups).
    2. For radius-mode groups: re-run the search using Haversine + user
       residence coords, write fresh `memberIds` + `memberStatusById`.
    3. Leave non-radius groups (area / city / metro / application) alone
       beyond the discriminator fix — those filters depend on the geo
       hierarchy schema in `src/data/metroSubareaSchema.ts` which lives in
       the React bundle, not here.

  Use:
    # dry-run, scoped to one tenant (default behaviour)
    node scripts/cleanup/repairSavedSmartGroupRadiusMembers.js --tenant <tenantId>

    # actually write
    node scripts/cleanup/repairSavedSmartGroupRadiusMembers.js --tenant <tenantId> --apply

    # only normalise discriminators, skip the expensive re-run loop
    node scripts/cleanup/repairSavedSmartGroupRadiusMembers.js --tenant <tenantId> --normalize-only
*/

/* eslint-disable no-console */
const admin = require('firebase-admin');

function parseArgs() {
  const argv = process.argv.slice(2);
  const out = { apply: false, normalizeOnly: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') out.apply = true;
    else if (a === '--normalize-only') out.normalizeOnly = true;
    else if (a === '--tenant') out.tenantId = argv[++i];
  }
  if (!out.tenantId) {
    console.error('Missing required --tenant <tenantId>');
    process.exit(1);
  }
  return out;
}

/**
 * Haversine distance in miles. Inlined here so the script doesn't depend
 * on `src/utils/locationUtils.ts` (TypeScript, lives in the React bundle).
 * Implementation matches `calculateDistance` in that file at the time of
 * writing — same formula, same earth radius, same units.
 */
function distanceMiles(lat1, lng1, lat2, lng2) {
  const R = 3958.8;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Mirrors `getUserResidenceData` in `src/services/runSavedSmartGroupSearch.ts`
 * — same precedence order across `addressInfo` → `address` → top-level
 * fallbacks. We deliberately do NOT include the city-centroid fallback here
 * because that requires the geo hierarchy schema; users without explicit
 * coords are skipped from the radius match (consistent with the runner's
 * `if (typeof lat !== 'number') continue` guard).
 */
function readUserCoords(userData) {
  const addressInfo = userData?.addressInfo || {};
  const address = userData?.address || {};
  const addressCoords = address?.coordinates || {};
  const addressInfoCoords = addressInfo?.coordinates || {};
  const lat =
    addressInfo.homeLat ??
    address.homeLat ??
    addressInfoCoords.lat ??
    addressInfoCoords.latitude ??
    addressCoords.lat ??
    addressCoords.latitude ??
    userData?.homeLat ??
    null;
  const lng =
    addressInfo.homeLng ??
    address.homeLng ??
    addressInfoCoords.lng ??
    addressInfoCoords.longitude ??
    addressCoords.lng ??
    addressCoords.longitude ??
    userData?.homeLng ??
    null;
  return { lat, lng };
}

/**
 * Decide if a filters blob looks like a radius search. Radius is flagged
 * either by an explicit `residenceSubMode === 'radius'` (post-fix shape) or
 * by the legacy "has `radiusAddress` + lat/lng" smell (pre-fix shape).
 */
function isRadiusFilter(filters) {
  if (filters?.residenceSubMode === 'radius') return true;
  if (
    filters?.radiusAddress &&
    typeof filters?.radiusLat === 'number' &&
    typeof filters?.radiusLng === 'number'
  ) {
    return true;
  }
  return false;
}

/**
 * Apply the same discriminator inference the runtime now does in
 * `runSavedSmartGroupSearch.normalizeFilters`. Returns the normalized blob
 * AND a flag indicating whether anything changed (so we can skip writes
 * for already-clean docs).
 */
function normalizeFilters(filters) {
  const next = { ...(filters || {}) };
  let changed = false;
  if (!next.filterMode) {
    next.filterMode = 'residence';
    changed = true;
  }
  if (next.filterMode === 'residence' && !next.residenceSubMode) {
    next.residenceSubMode =
      typeof next.radiusAddress === 'string' && next.radiusAddress.trim()
        ? 'radius'
        : 'area';
    changed = true;
  }
  return { filters: next, changed };
}

async function loadCandidateUserIds(db, tenantId) {
  // Mirrors the runner's universe: any non-withdrawn / non-deleted application
  // in this tenant contributes its applicant uid. We project distinct uids so
  // we don't re-read the same user 50 times.
  const snap = await db.collection(`tenants/${tenantId}/applications`).get();
  const ids = new Set();
  for (const d of snap.docs) {
    const data = d.data() || {};
    const status = String(data.status || '').toLowerCase();
    if (status === 'withdrawn' || status === 'deleted') continue;
    const uid = data.userId || data.uid;
    if (uid) ids.add(uid);
  }
  return Array.from(ids);
}

/** Read every user doc once, keyed by uid. */
/**
 * Read each user's residence coords + skills + certs in one pass. Mirrors
 * the runner's `getUserResidenceData` precedence and the same skill/cert
 * extraction logic at lines 190-195 of `runSavedSmartGroupSearch.ts`.
 */
async function loadUserMatchDataMap(db, uids) {
  const out = new Map();
  const POOL = 30;
  let cursor = 0;
  async function next() {
    while (cursor < uids.length) {
      const i = cursor++;
      const uid = uids[i];
      try {
        const snap = await db.doc(`users/${uid}`).get();
        if (!snap.exists) continue;
        const data = snap.data() || {};
        const coords = readUserCoords(data);
        const skills = Array.isArray(data.skills) ? data.skills : [];
        const certifications = Array.isArray(data.certifications)
          ? data.certifications
              .map((c) => (typeof c === 'string' ? c : c && c.name ? c.name : ''))
              .filter(Boolean)
          : [];
        out.set(uid, { coords, skills, certifications });
      } catch (err) {
        console.warn(`  user ${uid}: read failed (${err && err.message ? err.message : err})`);
      }
    }
  }
  await Promise.all(Array.from({ length: POOL }, () => next()));
  return out;
}

function computeRadiusMembers(filters, userMatchDataMap) {
  const centerLat = filters.radiusLat;
  const centerLng = filters.radiusLng;
  const miles = typeof filters.radiusMiles === 'number' ? filters.radiusMiles : 10;
  if (typeof centerLat !== 'number' || typeof centerLng !== 'number') {
    return null; // can't compute without saved coords
  }
  const selectedSkills = Array.isArray(filters.selectedSkills) ? filters.selectedSkills : [];
  const selectedCerts = Array.isArray(filters.selectedCertifications)
    ? filters.selectedCertifications
    : [];
  const out = [];
  for (const [uid, info] of userMatchDataMap) {
    const { coords, skills, certifications } = info;
    if (typeof coords.lat !== 'number' || typeof coords.lng !== 'number') continue;
    if (distanceMiles(centerLat, centerLng, coords.lat, coords.lng) > miles) continue;
    const matchSkills =
      selectedSkills.length === 0 || selectedSkills.some((s) => skills.includes(s));
    const matchCerts =
      selectedCerts.length === 0 || selectedCerts.some((c) => certifications.includes(c));
    if (matchSkills && matchCerts) out.push(uid);
  }
  return out;
}

async function main() {
  const { tenantId, apply, normalizeOnly } = parseArgs();
  if (!admin.apps.length) admin.initializeApp();
  const db = admin.firestore();

  const groupsRef = db.collection(`tenants/${tenantId}/savedSmartGroups`);
  const snap = await groupsRef.get();
  console.log(`Found ${snap.size} saved smart group(s) in tenant ${tenantId}`);
  if (snap.empty) return;

  // Pre-load applicant universe + user match data once. Reused across every
  // radius group so we don't re-walk Firestore per group.
  let userMatchDataMap = null;
  if (!normalizeOnly) {
    console.log('Loading applicant universe + user match data (once for all groups)...');
    const uids = await loadCandidateUserIds(db, tenantId);
    console.log(`  ${uids.length} candidate applicant uid(s)`);
    userMatchDataMap = await loadUserMatchDataMap(db, uids);
    console.log(`  ${userMatchDataMap.size} user docs loaded`);
  }

  /** @type {Array<{ id: string; name: string; action: string; before?: number; after?: number; reason?: string }>} */
  const audit = [];
  let changedDocs = 0;

  for (const docSnap of snap.docs) {
    const data = docSnap.data() || {};
    const name = data.name || docSnap.id;
    const filtersIn = data.filters || {};

    const { filters: filtersNormalized, changed: discriminatorChanged } =
      normalizeFilters(filtersIn);

    /** @type {Record<string, unknown>} */
    const update = {};
    let action = 'skipped_clean';
    const beforeCount = Array.isArray(data.memberIds) ? data.memberIds.length : 0;
    let afterCount = beforeCount;

    if (discriminatorChanged) {
      update.filters = filtersNormalized;
      action = 'normalized_only';
    }

    if (!normalizeOnly && isRadiusFilter(filtersNormalized) && userMatchDataMap) {
      const memberIds = computeRadiusMembers(filtersNormalized, userMatchDataMap);
      if (memberIds === null) {
        // Missing saved center coords — same error the runtime throws.
        action = 'skipped_no_center_coords';
        audit.push({
          id: docSnap.id,
          name,
          action,
          reason: 'filters.radiusLat / radiusLng missing',
        });
        continue;
      }

      const memberStatusById = {};
      for (const id of memberIds) memberStatusById[id] = 'member';
      // Preserve any explicit non-default status the recruiter set previously
      // (preferred / not_preferred) for users still in the new member set.
      if (data.memberStatusById && typeof data.memberStatusById === 'object') {
        for (const [id, status] of Object.entries(data.memberStatusById)) {
          if (
            memberStatusById[id] !== undefined &&
            (status === 'preferred' || status === 'not_preferred')
          ) {
            memberStatusById[id] = status;
          }
        }
      }

      update.memberIds = memberIds;
      update.memberStatusById = memberStatusById;
      // Use server timestamp on apply, sentinel on dry-run for log clarity.
      if (apply) {
        update.updatedAt = admin.firestore.FieldValue.serverTimestamp();
      }
      afterCount = memberIds.length;
      action = beforeCount === afterCount ? 'rerun_no_change' : 'rerun_changed';
    }

    if (Object.keys(update).length > 0) changedDocs += 1;
    audit.push({
      id: docSnap.id,
      name,
      action,
      before: beforeCount,
      after: afterCount,
    });

    if (apply && Object.keys(update).length > 0) {
      await docSnap.ref.update(update);
    }
  }

  console.log('\nPer-group plan:');
  for (const row of audit) {
    const delta =
      row.before != null && row.after != null && row.before !== row.after
        ? `  (${row.before} -> ${row.after})`
        : '';
    console.log(`  ${row.action.padEnd(28)} ${row.id}  "${row.name}"${delta}${row.reason ? `  [${row.reason}]` : ''}`);
  }

  console.log(`\n${changedDocs} of ${snap.size} group(s) ${apply ? 'updated' : 'would change'}.`);
  if (!apply) {
    console.log('Dry-run only. Re-run with --apply to write.');
  }
}

main().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});
