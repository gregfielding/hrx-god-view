/**
 * Call deployed testCreateAccusourceBackgroundCheck callable from local CLI.
 *
 * Usage:
 * npm --prefix functions run run:accusource:create-test -- \
 *   --apiKey=<WEB_API_KEY> \
 *   --email=<ADMIN_EMAIL> \
 *   --password=<ADMIN_PASSWORD> \
 *   --projectId=hrx1-d3beb \
 *   --tenantId=BCiP2bQ9CgVOCTfV6MhD
 */

type Args = {
  apiKey?: string;
  email?: string;
  password?: string;
  projectId: string;
  region: string;
  tenantId?: string;
  accountId?: string;
  accountName?: string;
  candidateId?: string;
  candidateName?: string;
  jobOrderId?: string;
  worksiteId?: string;
};

function parseArgs(argv: string[]): Args {
  const out: Args = {
    projectId: 'hrx1-d3beb',
    region: 'us-central1',
  };
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const [rawKey, ...rest] = arg.slice(2).split('=');
    const value = rest.join('=');
    if (!rawKey) continue;
    (out as Record<string, unknown>)[rawKey] = value;
  }
  return out;
}

async function signInWithPassword(apiKey: string, email: string, password: string): Promise<string> {
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password,
      returnSecureToken: true,
    }),
  });
  const json = await response.json();
  if (!response.ok || !json?.idToken) {
    throw new Error(`signInWithPassword failed: ${JSON.stringify(json)}`);
  }
  return String(json.idToken);
}

async function callTestCallable(args: Args, idToken: string) {
  const url = `https://${args.region}-${args.projectId}.cloudfunctions.net/testCreateAccusourceBackgroundCheck`;
  const now = Date.now();
  const payload = {
    tenantId: args.tenantId || '',
    accountId: args.accountId || 'acc-test-001',
    accountName: args.accountName || 'Test Account',
    candidateId: args.candidateId || `cand-test-${now}`,
    candidateName: args.candidateName || 'Test Candidate',
    jobOrderId: args.jobOrderId || 'job-test-001',
    worksiteId: args.worksiteId || 'worksite-test-001',
    requestedServices: ['background_check'],
    candidate: {
      firstName: 'Test',
      lastName: 'Worker',
      email: `test.worker.${now}@example.com`,
      phone: '5555551212',
      dateOfBirth: '1990-01-01',
    },
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ data: payload }),
  });
  const json = await response.json();

  if (!response.ok) {
    throw new Error(`Callable HTTP error ${response.status}: ${JSON.stringify(json)}`);
  }
  if (json?.error) {
    throw new Error(`Callable returned error: ${JSON.stringify(json.error)}`);
  }
  return json?.result ?? json;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const apiKey = args.apiKey || process.env.FIREBASE_WEB_API_KEY || process.env.REACT_APP_FIREBASE_API_KEY;
  const email = args.email || process.env.FIREBASE_ADMIN_EMAIL;
  const password = args.password || process.env.FIREBASE_ADMIN_PASSWORD;

  if (!apiKey || !email || !password) {
    console.error('Missing required auth args. Provide:');
    console.error('--apiKey, --email, --password (or env FIREBASE_WEB_API_KEY/REACT_APP_FIREBASE_API_KEY, FIREBASE_ADMIN_EMAIL, FIREBASE_ADMIN_PASSWORD)');
    process.exit(1);
  }

  const idToken = await signInWithPassword(apiKey, email, password);
  const result = await callTestCallable(args, idToken);

  const r = result?.result || result;
  console.log('\nCallable result (sanity fields):');
  console.log(JSON.stringify({
    backgroundCheckId: r?.backgroundCheckId ?? null,
    clientId: r?.clientId ?? null,
    providerProfileId: r?.providerProfileId ?? null,
    hrxStatus: r?.hrxStatus ?? null,
    applicantPortalLink: r?.applicantPortalLink ?? null,
    providerStatus: r?.providerStatus ?? null,
    raw: result,
  }, null, 2));
}

main().catch((error) => {
  console.error('runAccusourceCreateTest failed:', error?.message || error);
  process.exit(1);
});

