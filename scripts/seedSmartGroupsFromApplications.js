/**
 * Backfill script: Seed smartGroupData on user docs from existing applications.
 * Runs all non-withdrawn applications through the Smart Groups logic and writes
 * smartGroupData to each user document.
 *
 * Run with: node scripts/seedSmartGroupsFromApplications.js
 * Optional: TENANT_ID=xxx node scripts/seedSmartGroupsFromApplications.js  (single tenant)
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

let credential;
const possibleKeyPaths = [
  path.join(__dirname, '..', 'serviceAccountKey.json'),
  path.join(__dirname, '..', 'firebase-adminsdk.json'),
  process.env.GOOGLE_APPLICATION_CREDENTIALS
].filter(Boolean);

for (const keyPath of possibleKeyPaths) {
  if (fs.existsSync(keyPath)) {
    console.log('Using service account key:', keyPath);
    const serviceAccount = require(keyPath);
    credential = admin.credential.cert(serviceAccount);
    break;
  }
}

if (!credential) {
  credential = admin.credential.applicationDefault();
}

try {
  admin.initializeApp({ credential, projectId: 'hrx1-d3beb' });
} catch (e) {
  // already initialized
}

const db = admin.firestore();

// Inlined from src/data/metroSubareaSchema (toCityKey, toStateKey, getGeoHierarchy)
function toCityKey(city, state) {
  const c = (city || '').trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
  const s = (state || '').trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
  return s ? `${c}_${s}` : c || 'unknown';
}

const STATE_NAMES = {
  AL: 'alabama', AK: 'alaska', AZ: 'arizona', AR: 'arkansas', CA: 'california',
  CO: 'colorado', CT: 'connecticut', DE: 'delaware', FL: 'florida', GA: 'georgia',
  HI: 'hawaii', ID: 'idaho', IL: 'illinois', IN: 'indiana', IA: 'iowa',
  KS: 'kansas', KY: 'kentucky', LA: 'louisiana', ME: 'maine', MD: 'maryland',
  MA: 'massachusetts', MI: 'michigan', MN: 'minnesota', MS: 'mississippi', MO: 'missouri',
  MT: 'montana', NE: 'nebraska', NV: 'nevada', NH: 'new_hampshire', NJ: 'new_jersey',
  NM: 'new_mexico', NY: 'new_york', NC: 'north_carolina', ND: 'north_dakota', OH: 'ohio',
  OK: 'oklahoma', OR: 'oregon', PA: 'pennsylvania', RI: 'rhode_island', SC: 'south_carolina',
  SD: 'south_dakota', TN: 'tennessee', TX: 'texas', UT: 'utah', VT: 'vermont',
  VA: 'virginia', WA: 'washington', WV: 'west_virginia', WI: 'wisconsin', WY: 'wyoming',
};

function toStateKey(state) {
  const s = (state || '').trim().toUpperCase();
  return STATE_NAMES[s] || (s && s.toLowerCase().replace(/\s+/g, '_')) || 'unknown';
}

const CITY_TO_SUBAREA_AND_METRO = {
  plano_tx: { subareaKey: 'north_dfw', metroKey: 'dallas_fort_worth' },
  mckinney_tx: { subareaKey: 'north_dfw', metroKey: 'dallas_fort_worth' },
  frisco_tx: { subareaKey: 'north_dfw', metroKey: 'dallas_fort_worth' },
  allen_tx: { subareaKey: 'north_dfw', metroKey: 'dallas_fort_worth' },
  prosper_tx: { subareaKey: 'north_dfw', metroKey: 'dallas_fort_worth' },
  carrollton_tx: { subareaKey: 'north_dfw', metroKey: 'dallas_fort_worth' },
  denton_tx: { subareaKey: 'north_dfw', metroKey: 'dallas_fort_worth' },
  lewisville_tx: { subareaKey: 'north_dfw', metroKey: 'dallas_fort_worth' },
  flower_mound_tx: { subareaKey: 'north_dfw', metroKey: 'dallas_fort_worth' },
  the_colony_tx: { subareaKey: 'north_dfw', metroKey: 'dallas_fort_worth' },
  little_elm_tx: { subareaKey: 'north_dfw', metroKey: 'dallas_fort_worth' },
  duncanville_tx: { subareaKey: 'south_dfw', metroKey: 'dallas_fort_worth' },
  lancaster_tx: { subareaKey: 'south_dfw', metroKey: 'dallas_fort_worth' },
  cedar_hill_tx: { subareaKey: 'south_dfw', metroKey: 'dallas_fort_worth' },
  desoto_tx: { subareaKey: 'south_dfw', metroKey: 'dallas_fort_worth' },
  waxahachie_tx: { subareaKey: 'south_dfw', metroKey: 'dallas_fort_worth' },
  midlothian_tx: { subareaKey: 'south_dfw', metroKey: 'dallas_fort_worth' },
  mansfield_tx: { subareaKey: 'south_dfw', metroKey: 'dallas_fort_worth' },
  arlington_tx: { subareaKey: 'south_dfw', metroKey: 'dallas_fort_worth' },
  grand_prairie_tx: { subareaKey: 'south_dfw', metroKey: 'dallas_fort_worth' },
  irving_tx: { subareaKey: 'mid_cities', metroKey: 'dallas_fort_worth' },
  euless_tx: { subareaKey: 'mid_cities', metroKey: 'dallas_fort_worth' },
  bedford_tx: { subareaKey: 'mid_cities', metroKey: 'dallas_fort_worth' },
  hurst_tx: { subareaKey: 'mid_cities', metroKey: 'dallas_fort_worth' },
  grapevine_tx: { subareaKey: 'mid_cities', metroKey: 'dallas_fort_worth' },
  richardson_tx: { subareaKey: 'mid_cities', metroKey: 'dallas_fort_worth' },
  garland_tx: { subareaKey: 'mid_cities', metroKey: 'dallas_fort_worth' },
  mesquite_tx: { subareaKey: 'mid_cities', metroKey: 'dallas_fort_worth' },
  dallas_tx: { subareaKey: 'dallas', metroKey: 'dallas_fort_worth' },
  fort_worth_tx: { subareaKey: 'fort_worth', metroKey: 'dallas_fort_worth' },
  austin_tx: { subareaKey: 'austin', metroKey: 'austin' },
  round_rock_tx: { subareaKey: 'austin', metroKey: 'austin' },
  cedar_park_tx: { subareaKey: 'austin', metroKey: 'austin' },
  pflugerville_tx: { subareaKey: 'austin', metroKey: 'austin' },
  del_valle_tx: { subareaKey: 'austin', metroKey: 'austin' },
};

function getGeoHierarchy(worksite) {
  const city = worksite?.city ?? '';
  const state = worksite?.state ?? '';
  const cityKey = toCityKey(city, state);
  const stateKey = toStateKey(state);
  const entry = CITY_TO_SUBAREA_AND_METRO[cityKey];
  if (entry) {
    return { cityKey, subareaKeys: [entry.subareaKey], metroKey: entry.metroKey, stateKey };
  }
  return {
    cityKey: cityKey || 'unknown',
    subareaKeys: [],
    metroKey: cityKey ? `${cityKey}_metro` : 'unknown',
    stateKey,
  };
}

// Inlined from src/services/smartGroupService (resolveIndustryCategory)
const JANITORIAL = ['janitor', 'cleaner', 'custodial', 'housekeeping', 'cleaning', 'sanitation', 'maintenance'];
const HOSPITALITY = ['hospitality', 'hotel', 'restaurant', 'food service', 'server', 'bartender', 'cook', 'chef', 'banquet', 'catering', 'front desk'];
const INDUSTRIAL = ['industrial', 'warehouse', 'manufacturing', 'production', 'assembly', 'forklift', 'distribution', 'logistics', 'factory'];

function resolveIndustryCategory(jobTitle) {
  const t = (jobTitle || '').toLowerCase();
  if (JANITORIAL.some((k) => t.includes(k))) return 'janitorial';
  if (HOSPITALITY.some((k) => t.includes(k))) return 'hospitality';
  if (INDUSTRIAL.some((k) => t.includes(k))) return 'industrial';
  return 'other';
}

function collectUnique(entries, getKeys) {
  const set = new Set();
  entries.forEach((e) => getKeys(e).forEach((k) => set.add(k)));
  return Array.from(set);
}

function collectCategories(entries) {
  return Array.from(new Set(entries.map((e) => e.jobCategory)));
}

async function run() {
  const singleTenantId = process.env.TENANT_ID;
  console.log('Smart Groups seed: backfill smartGroupData from existing applications\n');

  let tenantIds = [];
  if (singleTenantId) {
    const t = await db.collection('tenants').doc(singleTenantId).get();
    if (!t.exists) {
      console.error('Tenant not found:', singleTenantId);
      process.exit(1);
    }
    tenantIds = [singleTenantId];
    console.log('Single tenant mode:', singleTenantId);
  } else {
    const tenantsSnap = await db.collection('tenants').get();
    tenantIds = tenantsSnap.docs.map((d) => d.id);
    console.log('Tenants to process:', tenantIds.length);
  }

  let totalApps = 0;
  let totalUsersUpdated = 0;
  let errors = 0;

  for (const tenantId of tenantIds) {
    const applicationsRef = db.collection('tenants').doc(tenantId).collection('applications');
    const applicationsSnap = await applicationsRef.get();

    const applicationsByUser = new Map();
    for (const docSnap of applicationsSnap.docs) {
      const data = docSnap.data();
      const status = (data.status || '').toLowerCase();
      if (status === 'withdrawn' || status === 'deleted') continue;

      const userId = data.userId || data.uid;
      if (!userId) continue;

      if (!applicationsByUser.has(userId)) applicationsByUser.set(userId, []);
      applicationsByUser.get(userId).push({ id: docSnap.id, data });
    }

    totalApps += applicationsSnap.docs.length;

    for (const [userId, apps] of applicationsByUser) {
      try {
        const userRef = db.collection('users').doc(userId);
        const userSnap = await userRef.get();
        if (!userSnap.exists) continue;

        const userData = userSnap.data();
        const address = userData.address || userData.addressInfo || {};
        const userCity = userData.city || address.city || '';
        const userCoords = userData.homeLat != null && userData.homeLng != null
          ? { lat: userData.homeLat, lng: userData.homeLng }
          : address.coordinates
            ? { lat: address.coordinates.lat, lng: address.coordinates.lng }
            : undefined;
        const skills = Array.isArray(userData.skills) ? userData.skills : [];

        const byApplication = {};
        for (const app of apps) {
          const applicationId = app.id;
          const appData = app.data;
          let worksite = { city: '', state: '', zipCode: '' };
          let jobTitle = appData.jobTitle || appData.postTitle || '';
          let companyName = appData.companyName;
          let companyId = appData.companyId;
          let worksiteName = appData.worksiteName || appData.location;
          let worksiteId = appData.worksiteId;
          let worksiteAddress;
          let worksiteGeocoordinates;

          if (appData.jobId) {
            try {
              const postRef = db.collection('tenants').doc(tenantId).collection('job_postings').doc(appData.jobId);
              const postSnap = await postRef.get();
              if (postSnap.exists) {
                const p = postSnap.data();
                const ws = p.worksiteAddress || {};
                worksite = { city: ws.city || p.city, state: ws.state || p.state, zipCode: ws.zipCode };
                jobTitle = p.jobTitle || p.postTitle || jobTitle;
                companyName = p.companyName || companyName;
                companyId = p.companyId || companyId;
                worksiteName = p.worksiteName || worksiteName;
                worksiteId = p.worksiteId || worksiteId;
                if (p.worksiteAddress) {
                  worksiteAddress = {
                    street: p.worksiteAddress.street,
                    city: p.worksiteAddress.city,
                    state: p.worksiteAddress.state,
                    zipCode: p.worksiteAddress.zipCode,
                  };
                  if (p.worksiteAddress.coordinates) {
                    worksiteGeocoordinates = {
                      lat: p.worksiteAddress.coordinates.lat,
                      lng: p.worksiteAddress.coordinates.lng,
                    };
                  }
                }
              }
            } catch (err) {
              // keep defaults
            }
          }

          const geo = getGeoHierarchy(worksite);
          const jobCategory = resolveIndustryCategory(jobTitle);

          byApplication[applicationId] = {
            jobTitle,
            worksiteCity: worksite.city || '',
            userAddressCity: userCity,
            userGeocoordinates: userCoords,
            skills,
            jobCategory,
            timestamp: appData.submittedAt || appData.appliedAt || appData.createdAt || admin.firestore.FieldValue.serverTimestamp(),
            cityKey: geo.cityKey,
            subareaKeys: geo.subareaKeys,
            metroKey: geo.metroKey,
            stateKey: geo.stateKey,
            companyName: companyName || undefined,
            companyId: companyId || undefined,
            worksiteName: worksiteName || undefined,
            worksiteId: worksiteId || undefined,
            worksiteAddress: worksiteAddress || undefined,
            worksiteGeocoordinates: worksiteGeocoordinates || undefined,
          };
        }

        const entries = Object.values(byApplication);
        const cityKeys = collectUnique(entries, (e) => [e.cityKey]);
        const subareaKeys = collectUnique(entries, (e) => e.subareaKeys);
        const metroKeys = collectUnique(entries, (e) => [e.metroKey]);
        const stateKeys = collectUnique(entries, (e) => [e.stateKey]);
        const industryCategories = collectCategories(entries);

        await userRef.set({
          smartGroupData: {
            cityKeys,
            subareaKeys,
            metroKeys,
            stateKeys,
            industryCategories,
            byApplication,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });

        totalUsersUpdated++;
      } catch (err) {
        errors++;
        console.error('Error user', userId, err.message);
      }
    }
  }

  console.log('\nDone.');
  console.log('Applications processed:', totalApps);
  console.log('Users updated (smartGroupData):', totalUsersUpdated);
  console.log('Errors:', errors);
  process.exit(errors > 0 ? 1 : 0);
}

run();
