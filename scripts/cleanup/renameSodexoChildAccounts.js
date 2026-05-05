/*
  Strip "Sodexo National" → "Sodexo" from CHILD account names.

  The National account itself (accountType === 'national') is left alone — the
  word "National" is meaningful there. Only `accountType === 'child'` docs are
  candidates.

  Account docs don't carry denormed search-key fields, and JO / shift / placement
  reads resolve `recruiterAccountName` live from `accounts.{id}.name` — so a
  rename here is the only write needed; downstream views pick it up on next read.

  Use:
    # dry-run (default), every child whose name contains "Sodexo National"
    node scripts/cleanup/renameSodexoChildAccounts.js --tenant <tenantId>

    # scope to children of one specific National
    node scripts/cleanup/renameSodexoChildAccounts.js --tenant <tenantId> --national <nationalAccountId>

    # actually write
    node scripts/cleanup/renameSodexoChildAccounts.js --tenant <tenantId> --apply
*/

/* eslint-disable no-console */
const admin = require('firebase-admin');

function parseArgs() {
  const argv = process.argv.slice(2);
  const out = { apply: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') out.apply = true;
    else if (a === '--tenant') out.tenantId = argv[++i];
    else if (a === '--national') out.nationalAccountId = argv[++i];
    else if (a === '--match') out.matchRaw = argv[++i];
  }
  if (!out.tenantId) {
    console.error('❌ Missing required --tenant <tenantId>');
    process.exit(1);
  }
  return out;
}

/**
 * Build the new name. Strips the literal token sequence `Sodexo National` and
 * collapses any whitespace ripple (so "Sodexo National  Foo" → "Sodexo Foo",
 * not "Sodexo  Foo"). Word boundaries on both sides keep us from mangling
 * things like "SodexoNationalCorp" (which shouldn't exist, but be safe).
 *
 * Rule of thumb: idempotent. Running twice on an already-renamed name returns
 * the same string. Any name without the token returns unchanged.
 */
function computeNewName(oldName, matchRegex) {
  if (typeof oldName !== 'string') return null;
  const trimmed = oldName.trim();
  if (!trimmed) return null;
  const replaced = trimmed.replace(matchRegex, 'Sodexo');
  const collapsed = replaced.replace(/\s+/g, ' ').trim();
  return collapsed === trimmed ? null : collapsed;
}

async function main() {
  const { tenantId, nationalAccountId, apply, matchRaw } = parseArgs();

  // Default match is the literal "Sodexo National" with word boundaries on
  // each side. Override via --match for ad-hoc reruns (e.g., "ACME Group" → "ACME").
  const tokenStripped = (matchRaw || 'Sodexo National').trim();
  if (!tokenStripped) {
    console.error('❌ --match must be a non-empty string');
    process.exit(1);
  }
  const escaped = tokenStripped.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matchRegex = new RegExp(`\\b${escaped}\\b`, 'g');

  if (!admin.apps.length) admin.initializeApp();
  const db = admin.firestore();

  const accountsRef = db.collection(`tenants/${tenantId}/accounts`);

  // We can't push the regex into Firestore, so the cheapest scope is "all
  // children of this national" when --national is given (a single equality
  // filter, fast). Without --national we walk every child in the tenant. The
  // accountType filter alone is cheap enough at recruiter scale (hundreds,
  // not millions).
  let query = accountsRef.where('accountType', '==', 'child');
  if (nationalAccountId) {
    query = query.where('parentAccountId', '==', nationalAccountId);
  }

  const snap = await query.get();
  console.log(
    `Scanning ${snap.size} child account(s) in tenant ${tenantId}` +
      (nationalAccountId ? ` under national ${nationalAccountId}` : '') +
      ` for match "${tokenStripped}"`,
  );

  /** @type {Array<{ id: string; oldName: string; newName: string }>} */
  const planned = [];
  for (const docSnap of snap.docs) {
    const data = docSnap.data() || {};
    const oldName = typeof data.name === 'string' ? data.name : '';
    const newName = computeNewName(oldName, matchRegex);
    if (!newName) continue;
    planned.push({ id: docSnap.id, oldName, newName });
  }

  if (planned.length === 0) {
    console.log('✓ No child accounts need renaming. Done.');
    return;
  }

  console.log(`\nProposed renames (${planned.length}):`);
  for (const row of planned) {
    console.log(`  ${row.id}  "${row.oldName}"  →  "${row.newName}"`);
  }

  if (!apply) {
    console.log(
      `\nDry-run only. Re-run with --apply to write ${planned.length} rename(s).`,
    );
    return;
  }

  // Firestore batch cap is 500 ops; chunk to be safe even though recruiter
  // tenants don't come close.
  const CHUNK = 400;
  let written = 0;
  for (let i = 0; i < planned.length; i += CHUNK) {
    const chunk = planned.slice(i, i + CHUNK);
    const batch = db.batch();
    for (const row of chunk) {
      batch.update(accountsRef.doc(row.id), {
        name: row.newName,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: 'script_renameSodexoChildAccounts',
      });
    }
    await batch.commit();
    written += chunk.length;
    console.log(`Committed ${written}/${planned.length}...`);
  }
  console.log(`\n✓ Renamed ${written} child account(s).`);
}

main().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});
