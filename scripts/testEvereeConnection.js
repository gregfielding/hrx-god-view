#!/usr/bin/env node
/**
 * Test Everee API connection using the same auth pattern as
 * functions/src/integrations/everee/evereeAuth.ts + evereeHttp.ts.
 *
 * Reads from functions/.env:
 *   - EVEREE_API_TOKEN_<tenantId>  (multi-tenant: e.g. EVEREE_API_TOKEN_2320)
 *   - EVEREE_BASE_URL              (sandbox or production base)
 *
 * Usage:
 *   node scripts/testEvereeConnection.js [tenantId]
 *
 * If tenantId is omitted, defaults to 2320 (C1 Staffing sandbox).
 *
 * Hits GET /v2/tenants/me — the canonical "is auth working" endpoint
 * recognized by evereeHttp.ts:40.
 *
 * Does NOT write anything. Read-only.
 */

const path = require('path');
const fs = require('fs');

// Load functions/.env (the file that contains the Everee secrets)
const envPath = path.join(__dirname, '..', 'functions', '.env');
if (!fs.existsSync(envPath)) {
  console.error(`✗ functions/.env not found at ${envPath}`);
  process.exit(1);
}

const envContent = fs.readFileSync(envPath, 'utf8');
const envVars = {};
for (const line of envContent.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eq = trimmed.indexOf('=');
  if (eq === -1) continue;
  const key = trimmed.slice(0, eq).trim();
  let value = trimmed.slice(eq + 1).trim();
  // Strip surrounding quotes if present
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  envVars[key] = value;
}

const tenantId = (process.argv[2] || '2320').trim();
const tokenKey = `EVEREE_API_TOKEN_${tenantId}`;
const token = envVars[tokenKey];
const baseUrl = envVars.EVEREE_BASE_URL;

console.log('─────────────────────────────────────────');
console.log('Everee Connection Test');
console.log('─────────────────────────────────────────');
console.log(`Tenant ID:  ${tenantId}`);
console.log(`Token key:  ${tokenKey}`);
console.log(`Token set:  ${token ? `yes (length: ${token.length})` : 'NO'}`);
console.log(`Base URL:   ${baseUrl || '(not set)'}`);
console.log('─────────────────────────────────────────');

if (!token) {
  console.error(`\n✗ ${tokenKey} is not set in functions/.env`);
  console.error(`  Add a line: ${tokenKey}=<your-token>`);
  process.exit(1);
}
if (!baseUrl) {
  console.error('\n✗ EVEREE_BASE_URL is not set in functions/.env');
  process.exit(1);
}

// Build auth headers per evereeAuth.ts pattern
const encoded = Buffer.from(token, 'utf8').toString('base64');
const headers = {
  authorization: `Basic ${encoded}`,
  'x-everee-tenant-id': tenantId,
  'content-type': 'application/json',
};

const endpoint = '/v2/tenants/me';
const url = `${baseUrl.replace(/\/$/, '')}${endpoint}`;

console.log(`\n→ GET ${url}`);
console.log(`  Headers:`);
console.log(`    authorization: Basic <redacted>`);
console.log(`    x-everee-tenant-id: ${tenantId}`);
console.log(`    content-type: application/json`);

(async () => {
  try {
    const res = await fetch(url, { method: 'GET', headers });
    console.log(`\n← Response: ${res.status} ${res.statusText}`);

    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
      console.log('  Body (parsed JSON):');
      console.log(JSON.stringify(body, null, 2).split('\n').map((l) => `    ${l}`).join('\n'));
    } catch {
      console.log('  Body (raw text):');
      console.log(text.split('\n').map((l) => `    ${l}`).join('\n'));
    }

    console.log('─────────────────────────────────────────');
    if (res.ok) {
      console.log('✓ Connection successful');
      process.exit(0);
    } else {
      console.log('✗ Connection failed (non-2xx response)');
      console.log('\nCommon causes:');
      console.log('  - 401: token invalid or expired');
      console.log('  - 403: token valid but lacks permission for this tenant');
      console.log('  - 404: wrong base URL or endpoint path');
      console.log('  - 400: malformed headers (check x-everee-tenant-id format)');
      process.exit(1);
    }
  } catch (err) {
    console.error('\n✗ Network error:');
    console.error(`  ${err.message}`);
    if (err.cause) {
      console.error(`  Cause: ${err.cause.message || err.cause}`);
    }
    console.log('\nCommon causes:');
    console.log('  - DNS resolution failure (check base URL spelling)');
    console.log('  - SSL/TLS error (uncommon)');
    console.log('  - Firewall blocking outbound HTTPS');
    process.exit(2);
  }
})();
