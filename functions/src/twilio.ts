import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
import twilio from 'twilio';
import cors from 'cors';

// Initialize Firebase Admin (guarded like other working callables)
if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

// Get Twilio configuration from environment variables
import { defineSecret } from 'firebase-functions/params';
import {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_MESSAGING_PHONE_NUMBER,
  TWILIO_A2P_CAMPAIGN,
} from './messaging/twilioSecrets';
import { maybeEmitPhoneVerifiedCategoryScore } from './categoryScoreEvolution/activityCategoryScoreEmit';
import { shortenUrlsInBody } from './messaging/linkShortener';

// Twilio Verify is only used here (kept local)
const verifyServiceSid = defineSecret('TWILIO_VERIFY_SERVICE_SID');

// Helper to get Twilio client (lazy initialization)
function getTwilioClient() {
  return twilio(TWILIO_ACCOUNT_SID.value(), TWILIO_AUTH_TOKEN.value());
}

function getVerifyServiceSid() {
  return verifyServiceSid.value();
}

function getMessagingPhoneNumber() {
  return TWILIO_MESSAGING_PHONE_NUMBER.value() || process.env.TWILIO_MESSAGING_PHONE_NUMBER;
}

function getA2PCampaign() {
  return TWILIO_A2P_CAMPAIGN.value() || process.env.TWILIO_A2P_CAMPAIGN;
}

// Initialize CORS middleware
const corsHandler = cors({ origin: true });

/**
 * Send OTP via Twilio Verify (HTTP version with CORS)
 */
export const sendOtpHttp = onRequest(
  {
    secrets: [TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, verifyServiceSid],
    invoker: 'public',
  },
  async (request, response) => {
    // Use cors middleware
    return corsHandler(request, response, async () => {
      if (request.method === 'OPTIONS') {
        response.status(204).send('');
        return;
      }

      if (request.method !== 'POST') {
        response.status(405).send('Method Not Allowed');
        return;
      }

      try {
        const { phoneE164 } = request.body;

        // Validate phone format (E.164)
        if (!phoneE164 || !/^\+[1-9]\d{7,14}$/.test(phoneE164)) {
          response.status(400).json({ error: 'Invalid phone number format. Use E.164 format (e.g., +17025550147)' });
          return;
        }

        const client = getTwilioClient();
        const verifyServiceSid = getVerifyServiceSid();
        
        // Send OTP via Twilio Verify
        await client.verify.v2.services(verifyServiceSid).verifications.create({
          to: phoneE164,
          channel: 'sms',
        });

        logger.info(`OTP sent to ${phoneE164}`);
        response.status(200).json({ success: true });
      } catch (error: any) {
        logger.error('Failed to send OTP:', error);
        
        // Handle specific Twilio errors
        if (error.code === 60200) {
          response.status(400).json({ error: 'Invalid phone number. Please check and try again.' });
        } else if (error.code === 60203) {
          response.status(429).json({ error: 'Maximum verification attempts reached. Please try again later.' });
        } else if (error.code === 60212) {
          response.status(429).json({ error: 'Too many verification attempts. Please try again later.' });
        } else {
          response.status(500).json({ error: 'Failed to send verification code. Please try again.' });
        }
      }
    });
  }
);

/**
 * Send OTP via Twilio Verify (Callable version - keeping for compatibility)
 */
/**
 * Config-gated TEST phone numbers (Greg 2026-08-25): fictional numbers in
 * `app_config/phone_auth.testPhones` ({"+1925555xxxx": "123456"}) skip
 * Twilio entirely — sendOtp no-ops, checkOtp accepts the fixed code. Used
 * for autonomous signup-flow testing now and Apple App Review later.
 * Real numbers are unaffected; empty the config doc to disable.
 */
async function testPhoneFixedCode(phoneE164: string): Promise<string | null> {
  try {
    const cfg = await db.doc('app_config/phone_auth').get();
    const map = (cfg.get('testPhones') ?? null) as Record<string, string> | null;
    const code = map && typeof map === 'object' ? map[phoneE164] : null;
    return typeof code === 'string' && /^\d{6}$/.test(code) ? code : null;
  } catch {
    return null;
  }
}

export const sendOtp = onCall(
  {
    secrets: [TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, verifyServiceSid],
    cors: true,
    invoker: 'public', // Allow unauthenticated calls for now
  },
  async (request) => {
  // For now, allow unauthenticated calls for testing
  // TODO: Add proper authentication back
  // if (!request.auth) {
  //   throw new HttpsError('unauthenticated', 'Must be signed in to verify phone');
  // }

  const { phoneE164 } = request.data as { phoneE164: string };
  const uid = request.auth?.uid; // Get uid from request auth if available

  // Validate phone format (E.164)
  if (!phoneE164 || !/^\+[1-9]\d{7,14}$/.test(phoneE164)) {
    throw new HttpsError('invalid-argument', 'Invalid phone number format. Use E.164 format (e.g., +17025550147)');
  }

  // Test numbers: no Twilio call (fictional numbers would error), the
  // fixed code in config is the "sent" code.
  if (await testPhoneFixedCode(phoneE164)) {
    logger.info(`OTP send skipped for test phone ${phoneE164}`);
    return { success: true, test: true };
  }

  try {
    const client = getTwilioClient();
    const verifyServiceSid = getVerifyServiceSid();
    
    // Send OTP via Twilio Verify
    await client.verify.v2.services(verifyServiceSid).verifications.create({
      to: phoneE164,
      channel: 'sms',
    });

    // Store phone number in user profile when sending OTP
    if (uid) {
      await db.doc(`users/${uid}`).set({
        phoneE164,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      logger.info(`Stored phone number for user ${uid}: ${phoneE164}`);
    }

    logger.info(`OTP sent to ${phoneE164}`);
    return { success: true };
  } catch (error: any) {
    logger.error('Failed to send OTP:', error);
    
    // Handle specific Twilio errors
    if (error.code === 60200) {
      throw new HttpsError('invalid-argument', 'Invalid phone number. Please check and try again.');
    } else if (error.code === 60203) {
      throw new HttpsError('resource-exhausted', 'Maximum verification attempts reached. Please try again later.');
    } else if (error.code === 60212) {
      throw new HttpsError('resource-exhausted', 'Too many verification attempts. Please try again later.');
    }
    
    throw new HttpsError('internal', 'Failed to send verification code. Please try again.');
  }
});


// ─────────────────────────────────────────────────────────────────────
// Phone sign-in (Greg 2026-08-21 — phone number is the worker's identity)
//
// `checkOtp({ signIn: true })` turns a Twilio-Verify-approved code into a
// Firebase custom token for the EXISTING account(s) on that phone. No
// reCAPTCHA, no Firebase phone provider, no password. Rules (see
// docs/claude/project_phone_auth.md):
//   - one account on the phone                → sign in as it
//   - several accounts, same person (dupes)   → sign in as the SURVIVOR
//       (Everee-complete + most recent pay wins; the worker never picks)
//   - several accounts, different people      → return a picker; the
//       second call carries `selectionToken` + `pick`
//   - no account                              → { status: 'no_account' }
// Staff (securityLevel ≥ 5) are only phone-eligible when their Auth user
// already carries that phoneNumber (explicit opt-in — SMS OTP alone is
// too weak for admin accounts by default).
// ─────────────────────────────────────────────────────────────────────
const TENANT_C1 = 'BCiP2bQ9CgVOCTfV6MhD';
const normName = (v: unknown): string =>
  String(v ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
const phoneVariants = (e164: string): string[] => {
  const ten = e164.replace(/\D/g, '').slice(-10);
  return [e164, ten, `1${ten}`, `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`, `${ten.slice(0, 3)}-${ten.slice(3, 6)}-${ten.slice(6)}`, `${ten.slice(0, 3)}.${ten.slice(3, 6)}.${ten.slice(6)}`];
};
type PhoneAccount = { uid: string; firstName: string; lastName: string; email: string; securityLevel: number; evereeComplete: boolean; lastPaidAt: number; updatedAt: number };

async function findAccountsByPhone(phoneE164: string): Promise<PhoneAccount[]> {
  const variants = phoneVariants(phoneE164);
  const found = new Map<string, admin.firestore.DocumentSnapshot>();
  for (const field of ['phoneE164', 'phone', 'phoneNumber']) {
    const snap = await db.collection('users').where(field, 'in', variants).limit(20).get();
    snap.forEach((d) => found.set(d.id, d));
  }
  const out: PhoneAccount[] = [];
  for (const d of found.values()) {
    const u = d.data() as Record<string, any>;
    if (u.accountStatus === 'merged' || u.mergedInto) continue;
    const lvl = Number(u.tenantIds?.[TENANT_C1]?.securityLevel ?? u.securityLevel ?? 0) || 0;
    const links = await db.collection(`tenants/${TENANT_C1}/everee_workers`).where('userId', '==', d.id).get();
    const evereeComplete = links.docs.some((l) => l.get('status') === 'onboarding_complete');
    const paid = await db.collection(`tenants/${TENANT_C1}/timesheet_entries`).where('workerId', '==', d.id).orderBy('workDate', 'desc').limit(1).get().catch(() => null);
    const lastPaidAt = paid && !paid.empty ? Date.parse(String(paid.docs[0].get('workDate') || '')) || 0 : 0;
    const updatedAt = u.updatedAt?.toMillis?.() ?? u.createdAt?.toMillis?.() ?? 0;
    out.push({ uid: d.id, firstName: String(u.firstName ?? ''), lastName: String(u.lastName ?? ''), email: String(u.email ?? ''), securityLevel: lvl, evereeComplete, lastPaidAt, updatedAt });
  }
  return out;
}

/** Same person = first AND last name agree on their first 3 letters (accent/case-insensitive). */
function samePerson(a: PhoneAccount, b: PhoneAccount): boolean {
  const fa = normName(a.firstName), fb = normName(b.firstName), la = normName(a.lastName), lb = normName(b.lastName);
  return fa.length >= 2 && la.length >= 2 && fa.slice(0, 3) === fb.slice(0, 3) && la.slice(0, 3) === lb.slice(0, 3);
}
/** Survivor = Everee-complete first, then most recent pay, then most recently updated. */
function pickSurvivor(accs: PhoneAccount[]): PhoneAccount {
  return accs.slice().sort((a, b) => Number(b.evereeComplete) - Number(a.evereeComplete) || b.lastPaidAt - a.lastPaidAt || b.updatedAt - a.updatedAt)[0];
}

async function staffPhoneOptedIn(uid: string, phoneE164: string): Promise<boolean> {
  try {
    const u = await admin.auth().getUser(uid);
    return u.phoneNumber === phoneE164;
  } catch {
    return false;
  }
}

async function mintPhoneSignIn(acc: PhoneAccount, phoneE164: string, meta: { cluster: string[]; mode: string; ip: string }): Promise<{ status: 'signed_in'; token: string; uid: string }> {
  const token = await admin.auth().createCustomToken(acc.uid, { phoneSignIn: true });
  await db.collection('phone_signin_audit').add({
    uid: acc.uid,
    phoneE164,
    mode: meta.mode,
    cluster: meta.cluster,
    ip: meta.ip,
    at: admin.firestore.FieldValue.serverTimestamp(),
  });
  await db.doc(`users/${acc.uid}`).set(
    { phoneE164, phoneVerified: true, lastPhoneSignInAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true },
  );
  return { status: 'signed_in', token, uid: acc.uid };
}

/**
 * Sign-in resolution after Twilio approved the code (or a valid selection
 * token proves an earlier approval). Returns one of:
 *   { status: 'signed_in', token, uid } | { status: 'choose', selectionToken, candidates }
 *   | { status: 'no_account' }
 */
/**
 * Single-use, 10-minute proof that THIS device just OTP-verified a phone that
 * has no account — lets the phone-change recovery leg (Slice 3) run without a
 * second SMS. Stored in phone_signin_pending alongside selection tokens;
 * `purpose: 'recovery'` keeps the two legs from accepting each other's tokens.
 */
async function mintRecoveryToken(phoneE164: string): Promise<string> {
  const token = crypto.randomBytes(24).toString('hex');
  await db.doc(`phone_signin_pending/${token}`).set({
    phoneE164,
    purpose: 'recovery',
    attempts: 0,
    expiresAt: Date.now() + 10 * 60 * 1000,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return token;
}

async function resolvePhoneSignIn(
  phoneE164: string,
  opts: { selectionToken?: string; pick?: string; ip: string; withRecoveryToken?: boolean },
): Promise<Record<string, unknown>> {
  // Second leg of the household picker: prove the earlier approval via the selection token.
  if (opts.selectionToken && opts.pick) {
    const ref = db.doc(`phone_signin_pending/${opts.selectionToken}`);
    const snap = await ref.get();
    const data = snap.data() as { phoneE164?: string; candidates?: string[]; expiresAt?: number } | undefined;
    if (!snap.exists || data?.phoneE164 !== phoneE164 || !(data?.candidates ?? []).includes(opts.pick) || (data?.expiresAt ?? 0) < Date.now()) {
      throw new HttpsError('permission-denied', 'That selection expired. Start over.');
    }
    await ref.delete();
    const accs = await findAccountsByPhone(phoneE164);
    const acc = accs.find((a) => a.uid === opts.pick);
    if (!acc) throw new HttpsError('not-found', 'Account not found.');
    return mintPhoneSignIn(acc, phoneE164, { cluster: accs.map((a) => a.uid), mode: 'picked', ip: opts.ip });
  }

  let accs = await findAccountsByPhone(phoneE164);
  // Staff: only when explicitly opted in (Auth user already carries the phone).
  const filtered: PhoneAccount[] = [];
  for (const a of accs) {
    if (a.securityLevel >= 5 && !(await staffPhoneOptedIn(a.uid, phoneE164))) continue;
    filtered.push(a);
  }
  accs = filtered;
  if (accs.length === 0) {
    // Sign-in mode hands back a recovery token so "my number changed" can
    // proceed without a second OTP; signup mode doesn't need one.
    return opts.withRecoveryToken
      ? { status: 'no_account', recoveryToken: await mintRecoveryToken(phoneE164) }
      : { status: 'no_account' };
  }
  if (accs.length === 1) return mintPhoneSignIn(accs[0], phoneE164, { cluster: [accs[0].uid], mode: 'single', ip: opts.ip });

  // Cluster same-person duplicates; each cluster collapses to its survivor.
  const clusters: PhoneAccount[][] = [];
  for (const a of accs) {
    const c = clusters.find((cl) => samePerson(cl[0], a));
    if (c) c.push(a);
    else clusters.push([a]);
  }
  const survivors = clusters.map(pickSurvivor);
  if (survivors.length === 1) {
    return mintPhoneSignIn(survivors[0], phoneE164, { cluster: accs.map((a) => a.uid), mode: 'survivor', ip: opts.ip });
  }
  // Different people on one phone (household): let them pick. Never disable anyone.
  const selectionToken = crypto.randomBytes(24).toString('hex');
  await db.doc(`phone_signin_pending/${selectionToken}`).set({
    phoneE164,
    candidates: survivors.map((a) => a.uid),
    expiresAt: Date.now() + 5 * 60 * 1000,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return {
    status: 'choose',
    selectionToken,
    candidates: survivors.map((a) => ({ uid: a.uid, firstName: a.firstName, lastInitial: a.lastName.slice(0, 1).toUpperCase(), email: a.email })),
  };
}


/**
 * Phone-first SIGNUP resolution (Slice 2, Greg approved 2026-08-25) — the
 * one shared account-creation path. After Twilio approves the code:
 *   - phone already has account(s) → NEVER create a second: same claim
 *     behavior as sign-in (single/survivor mint, household picker) with
 *     `existing: true` so the UI can say "welcome back".
 *   - no account → rehire gate (exact-phone match on rehireEligible:false,
 *     generic denial) → mint Auth user with the VERIFIED phone (no
 *     password) + users doc (wizard base-profile shape, email null) →
 *     custom token. Kills duplicate accounts at the source.
 */
/** MM/DD/YYYY or YYYY-MM-DD → YYYY-MM-DD; '' when unparseable. */
function normalizeDobIso(raw: unknown): string {
  const s = String(raw ?? '').trim();
  const mdY = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const iso = mdY ? `${mdY[3]}-${mdY[1].padStart(2, '0')}-${mdY[2].padStart(2, '0')}` : s;
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : '';
}

async function resolvePhoneSignup(
  phoneE164: string,
  opts: {
    firstName?: string;
    lastName?: string;
    dob?: string;
    preferredLanguage?: string;
    signupSource?: string;
    signupGroupId?: string | null;
    jobContext?: { tenantId?: string | null; tenantSlug?: string | null; jobId?: string | null } | null;
    ip: string;
  },
): Promise<Record<string, unknown>> {
  const existing = await resolvePhoneSignIn(phoneE164, { ip: opts.ip });
  if (existing.status !== 'no_account') {
    return { ...existing, existing: true };
  }

  // Rehire-ineligibility gate — exact phone match, generic message
  // (mirrors separation/checkRehireEligibility; never reveal the flag).
  const tenDigit = phoneE164.replace(/\D/g, '').slice(-10);
  for (const [field, value] of [
    ['phoneE164', phoneE164],
    ['phone', tenDigit],
  ] as const) {
    const flagged = await db
      .collection('users')
      .where(field, '==', value)
      .where('rehireEligible', '==', false)
      .limit(1)
      .get()
      .catch(() => null);
    if (flagged && !flagged.empty) {
      throw new HttpsError(
        'failed-precondition',
        'We are unable to create an account with this information. Please contact C1 Staffing for assistance.',
      );
    }
  }

  const firstName = String(opts.firstName ?? '').trim().slice(0, 60);
  const lastName = String(opts.lastName ?? '').trim().slice(0, 60);
  const displayName = [firstName, lastName].filter(Boolean).join(' ');
  const preferredLanguage = String(opts.preferredLanguage ?? '').toLowerCase() === 'es' ? 'es' : 'en';
  // DOB must persist HERE: step 0 auto-filters once the worker is authed, so
  // its save-on-Next never runs — without this the typed DOB died in
  // localStorage (found 2026-08-25 during the Slice 3 E2E).
  const dobIso = normalizeDobIso(opts.dob);
  // 18+ (W-2 staffing, Greg 2026-08-25) — the wizard blocks this client-side;
  // this is the authoritative check. Only enforced when a DOB was provided
  // (AuthDialog's gate doesn't collect one).
  if (dobIso) {
    const m = dobIso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) {
      const dobDate = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      const now = new Date();
      let age = now.getFullYear() - dobDate.getFullYear();
      if (
        now.getMonth() < dobDate.getMonth() ||
        (now.getMonth() === dobDate.getMonth() && now.getDate() < dobDate.getDate())
      ) {
        age -= 1;
      }
      if (age < 18) {
        throw new HttpsError(
          'failed-precondition',
          'You must be at least 18 years old to work with C1 Staffing.',
        );
      }
    }
  }

  // Mint the Auth user with the verified phone. A same-phone Auth user can
  // exist without a users doc (throwaway from old experiments) — reuse it.
  let uid: string;
  try {
    const created = await admin.auth().createUser({
      phoneNumber: phoneE164,
      ...(displayName ? { displayName } : {}),
    });
    uid = created.uid;
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code ?? '';
    if (code === 'auth/phone-number-already-exists') {
      const holder = await admin.auth().getUserByPhoneNumber(phoneE164);
      uid = holder.uid;
    } else {
      throw new HttpsError('internal', 'Could not create your account. Please try again.');
    }
  }

  const now = admin.firestore.FieldValue.serverTimestamp();
  const jobId = String(opts.jobContext?.jobId ?? '').trim();
  const signupGroupId = String(opts.signupGroupId ?? '').trim() || null;
  const resumePath = jobId ? 'job' : signupGroupId ? 'c1_group' : 'c1_general';
  const agreementStamp = { agreed: true, version: '2025-10-21', timestamp: new Date().toISOString() };
  // Wizard base-profile shape (apply/Wizard.tsx step 0) — email is null and
  // OPTIONAL now; Everee's flow collects it later when payroll needs it.
  await db.doc(`users/${uid}`).set(
    {
      uid,
      email: null,
      displayName,
      firstName,
      lastName,
      ...(dobIso ? { dob: dobIso } : {}),
      phone: tenDigit,
      phoneE164,
      phoneVerified: true,
      phoneVerifiedAt: now,
      phoneVerification: {
        verified: true,
        phoneNumber: phoneE164,
        verifiedAt: new Date().toISOString(),
        method: 'twilio_verify_signup',
      },
      createdAt: now,
      updatedAt: now,
      source: 'phone_signup',
      signupSource: String(opts.signupSource ?? 'phone_signup').slice(0, 40),
      signupGroupId,
      applyResumeSnapshot: {
        path: resumePath,
        tenantId: String(opts.jobContext?.tenantId ?? '').trim() || null,
        tenantSlug: String(opts.jobContext?.tenantSlug ?? '').trim() || null,
        jobId: jobId || null,
        signupGroupId,
      },
      applyWizardReminderPending: true,
      profileComplete: false,
      onboarded: false,
      role: 'Tenant',
      // ☠️ Must be stamped at signup: AuthContext's last-resort fallback treats
      // a users doc with role but NO securityLevel as STAFF ('5'), which
      // bounced fresh phone signups to the admin /dashboard and crashed
      // (found 2026-08-25). '2' = applicant, same as the legacy signup path.
      securityLevel: '2',
      orgType: 'Tenant',
      preferredLanguage,
      isActive: true,
      skills: [],
      certifications: [],
      languages: [],
      education: [],
      workHistory: [],
      applications: [],
      favorites: [],
      crm_sales: false,
      recruiter: false,
      jobsBoard: false,
      userGroupIds: [],
      userAgreements: {
        termsOfUse: agreementStamp,
        smsConsent: agreementStamp,
        privacyPolicy: { acknowledged: true, version: '2025-10-21', timestamp: agreementStamp.timestamp },
      },
    },
    { merge: true },
  );

  await db.collection('phone_signin_audit').add({
    uid,
    phoneE164,
    mode: 'signup_created',
    cluster: [uid],
    ip: opts.ip,
    signupSource: String(opts.signupSource ?? 'phone_signup').slice(0, 40),
    at: now,
  });
  const token = await admin.auth().createCustomToken(uid, { phoneSignIn: true });
  logger.info('phone signup created', { uid, signupSource: opts.signupSource ?? null });
  return { status: 'signed_in', token, uid, created: true };
}

/**
 * Phone-change recovery (Slice 3, 2026-08-25). Entered from the sign-in
 * no_account screen: the worker OTP-verified a NEW number (possession proven
 * by the recovery token minted alongside that no_account), then claims their
 * existing account by name + DOB. We NEVER auto-switch — knowing a name and
 * birthday is weak proof — so matches land in `phone_change_requests` for
 * staff approval (/users/phone-changes; approve/reject actions live on
 * workerSupportAssistant, see phoneChangeCore.ts).
 */
async function resolvePhoneChange(
  newPhoneE164: string,
  opts: { recoveryToken: string; firstName: string; lastName: string; dob: string; ip: string },
): Promise<Record<string, unknown>> {
  const tokenRef = db.doc(`phone_signin_pending/${opts.recoveryToken}`);
  const tokenSnap = await tokenRef.get();
  const tok = tokenSnap.data() as { phoneE164?: string; purpose?: string; attempts?: number; expiresAt?: number } | undefined;
  if (!tokenSnap.exists || tok?.purpose !== 'recovery' || tok?.phoneE164 !== newPhoneE164 || (tok?.expiresAt ?? 0) < Date.now()) {
    throw new HttpsError('permission-denied', 'That session expired. Start over.');
  }
  if ((tok?.attempts ?? 0) >= 5) {
    await tokenRef.delete();
    throw new HttpsError('resource-exhausted', 'Too many attempts. Start over.');
  }
  await tokenRef.set({ attempts: (tok?.attempts ?? 0) + 1 }, { merge: true });

  // DOB → YYYY-MM-DD (accept MM/DD/YYYY from the form).
  const rawDob = String(opts.dob ?? '').trim();
  const mdY = rawDob.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const dobIso = mdY ? `${mdY[3]}-${mdY[1].padStart(2, '0')}-${mdY[2].padStart(2, '0')}` : rawDob;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dobIso)) throw new HttpsError('invalid-argument', 'Invalid date of birth.');
  const first = normName(opts.firstName);
  const last = normName(opts.lastName);
  if (first.length < 2 || last.length < 2) throw new HttpsError('invalid-argument', 'Name is required.');

  // Candidates: DOB equality on the canonical `dob` string (wizard/signup) and
  // legacy `dateOfBirth` where it's the same string form, then in-memory name
  // match — first name on its first 3 letters (nicknames), last name exact,
  // both accent/case-insensitive. Staff and merged accounts never match.
  const cand = new Map<string, Record<string, any>>();
  for (const field of ['dob', 'dateOfBirth']) {
    const q = await db.collection('users').where(field, '==', dobIso).limit(25).get().catch(() => null);
    q?.forEach((d) => cand.set(d.id, d.data() as Record<string, any>));
  }
  const matches: Array<{ uid: string; u: Record<string, any> }> = [];
  for (const [uid, u] of cand) {
    if (u.accountStatus === 'merged' || u.mergedInto) continue;
    const lvl = Number(u.tenantIds?.[TENANT_C1]?.securityLevel ?? u.securityLevel ?? 0) || 0;
    if (lvl >= 5) continue;
    if (normName(u.firstName).slice(0, 3) !== first.slice(0, 3)) continue;
    if (normName(u.lastName) !== last) continue;
    matches.push({ uid, u });
  }

  if (matches.length === 0) {
    await db.collection('phone_signin_audit').add({
      phoneE164: newPhoneE164,
      mode: 'phone_change_no_match',
      claimedDob: dobIso,
      ip: opts.ip,
      at: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { status: 'not_found' };
  }

  // One live request per new number — a resubmit returns the existing one.
  const dup = await db
    .collection('phone_change_requests')
    .where('newPhoneE164', '==', newPhoneE164)
    .where('status', '==', 'pending')
    .limit(1)
    .get();
  if (!dup.empty) {
    await tokenRef.delete();
    return { status: 'pending_approval', requestId: dup.docs[0].id };
  }

  const reqRef = await db.collection('phone_change_requests').add({
    tenantId: TENANT_C1,
    newPhoneE164,
    newPhone: newPhoneE164.replace(/\D/g, '').slice(-10),
    claimedFirstName: String(opts.firstName).trim().slice(0, 60),
    claimedLastName: String(opts.lastName).trim().slice(0, 60),
    claimedDob: dobIso,
    candidateUids: matches.map((m) => m.uid),
    candidates: matches.map((m) => ({
      uid: m.uid,
      firstName: String(m.u.firstName ?? ''),
      lastName: String(m.u.lastName ?? ''),
      email: String(m.u.email ?? '') || null,
      oldPhoneE164: String(m.u.phoneE164 ?? '') || null,
      oldPhone: String(m.u.phone ?? '') || null,
    })),
    status: 'pending',
    requestedAt: admin.firestore.FieldValue.serverTimestamp(),
    ip: opts.ip,
  });
  await db.collection('phone_signin_audit').add({
    phoneE164: newPhoneE164,
    mode: 'phone_change_requested',
    requestId: reqRef.id,
    candidateUids: matches.map((m) => m.uid),
    ip: opts.ip,
    at: admin.firestore.FieldValue.serverTimestamp(),
  });
  await tokenRef.delete();
  logger.info('phone change requested', { requestId: reqRef.id, candidates: matches.length });
  return { status: 'pending_approval', requestId: reqRef.id };
}

/**
 * Verify OTP code via Twilio Verify
 */
export const checkOtp = onCall(
  {
    secrets: [TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, verifyServiceSid],
    cors: true,
    invoker: 'public', // Allow unauthenticated calls for now
  },
  async (request) => {
  // For now, allow unauthenticated calls for testing
  // TODO: Add proper authentication back
  // if (!request.auth) {
  //   throw new HttpsError('unauthenticated', 'Must be signed in to verify phone');
  // }

  const { phoneE164, code, signIn, signup, selectionToken, pick, phoneChange, recoveryToken } = request.data as {
    phoneE164: string; code?: string; signIn?: boolean; signup?: boolean; selectionToken?: string; pick?: string;
    phoneChange?: boolean; recoveryToken?: string;
  };
  const uid = request.auth?.uid; // Get uid from request auth if available
  const callerIp = String(request.rawRequest?.headers?.['x-forwarded-for'] ?? request.rawRequest?.ip ?? '').split(',')[0].trim();

  // Validate inputs
  if (!phoneE164 || !/^\+[1-9]\d{7,14}$/.test(phoneE164)) {
    throw new HttpsError('invalid-argument', 'Invalid phone number format');
  }

  // Household picker second leg: the selection token proves the earlier approval — no new code needed.
  if (signIn === true && selectionToken && pick) {
    return resolvePhoneSignIn(phoneE164, { selectionToken, pick, ip: callerIp });
  }

  // Phone-change recovery leg (Slice 3): the recovery token minted with the
  // no_account response proves the NEW number was just OTP-verified here.
  if (phoneChange === true && recoveryToken) {
    const d = request.data as Record<string, unknown>;
    return resolvePhoneChange(phoneE164, {
      recoveryToken: String(recoveryToken),
      firstName: String(d.firstName ?? ''),
      lastName: String(d.lastName ?? ''),
      dob: String(d.dob ?? ''),
      ip: callerIp,
    });
  }

  if (!code || !/^\d{6}$/.test(code)) {
    throw new HttpsError('invalid-argument', 'Invalid code format. Please enter a 6-digit code.');
  }

  // Test numbers: the config's fixed code stands in for Twilio approval.
  const fixedCode = await testPhoneFixedCode(phoneE164);
  if (fixedCode) {
    if (code !== fixedCode) {
      throw new HttpsError('permission-denied', 'Invalid verification code. Please try again.');
    }
    if (signIn === true) return resolvePhoneSignIn(phoneE164, { ip: callerIp, withRecoveryToken: true });
    if (signup === true) {
      const d = request.data as Record<string, unknown>;
      return resolvePhoneSignup(phoneE164, {
        firstName: String(d.firstName ?? ''),
        lastName: String(d.lastName ?? ''),
        dob: String(d.dob ?? ''),
        preferredLanguage: String(d.preferredLanguage ?? ''),
        signupSource: String(d.signupSource ?? ''),
        signupGroupId: (d.signupGroupId as string) ?? null,
        jobContext: (d.jobContext as { tenantId?: string; tenantSlug?: string; jobId?: string } | null) ?? null,
        ip: callerIp,
      });
    }
    return { success: true, status: 'approved', test: true };
  }

  try {
    const client = getTwilioClient();
    const verifyServiceSid = getVerifyServiceSid();
    
    // Verify OTP via Twilio Verify
    const verificationCheck = await client.verify.v2.services(verifyServiceSid)
      .verificationChecks.create({
        to: phoneE164,
        code: code,
      });

    if (verificationCheck.status !== 'approved') {
      throw new HttpsError('permission-denied', 'Invalid verification code. Please try again.');
    }

    // Phone SIGN-IN mode: turn the approved code into a session for the existing account.
    if (signIn === true) {
      return resolvePhoneSignIn(phoneE164, { ip: callerIp, withRecoveryToken: true });
    }

    // Phone SIGNUP mode (Slice 2): claim the existing account or create one.
    if (signup === true) {
      const d = request.data as Record<string, unknown>;
      return resolvePhoneSignup(phoneE164, {
        firstName: String(d.firstName ?? ''),
        lastName: String(d.lastName ?? ''),
        dob: String(d.dob ?? ''),
        preferredLanguage: String(d.preferredLanguage ?? ''),
        signupSource: String(d.signupSource ?? ''),
        signupGroupId: (d.signupGroupId as string) ?? null,
        jobContext: (d.jobContext as { tenantId?: string; tenantSlug?: string; jobId?: string } | null) ?? null,
        ip: callerIp,
      });
    }

    // Update user profile with verified phone
    if (uid) {
      const prevSnap = await db.doc(`users/${uid}`).get();
      const wasVerified =
        prevSnap.exists && (prevSnap.data() as Record<string, unknown>)?.phoneVerified === true;
      await db.doc(`users/${uid}`).set({
        phoneE164,
        phoneVerified: true,
        phoneVerifiedAt: admin.firestore.FieldValue.serverTimestamp(),
        phoneVerification: {
          verified: true,
          phoneNumber: phoneE164,
          verifiedAt: admin.firestore.FieldValue.serverTimestamp(),
          method: 'firebase_auth_phone',
        },
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      logger.info(`Updated user ${uid} with verified phone: ${phoneE164}`);
      if (!wasVerified) {
        try {
          await maybeEmitPhoneVerifiedCategoryScore(db, { uid });
        } catch (e) {
          logger.warn('checkOtp.activity_category_score_failed', {
            uid,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    } else {
      // If no UID available, try to find user by phone number
      const usersQuery = await db.collection('users')
        .where('phoneE164', '==', phoneE164)
        .limit(1)
        .get();
      
      if (!usersQuery.empty) {
        const userDoc = usersQuery.docs[0];
        const wasVerified = (userDoc.data() as Record<string, unknown>)?.phoneVerified === true;
        await userDoc.ref.update({
          phoneVerified: true,
          phoneVerifiedAt: admin.firestore.FieldValue.serverTimestamp(),
          phoneVerification: {
            verified: true,
            phoneNumber: phoneE164,
            verifiedAt: admin.firestore.FieldValue.serverTimestamp(),
            method: 'firebase_auth_phone',
          },
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        logger.info(`Updated user ${userDoc.id} with verified phone: ${phoneE164}`);
        if (!wasVerified) {
          try {
            await maybeEmitPhoneVerifiedCategoryScore(db, { uid: userDoc.id });
          } catch (e) {
            logger.warn('checkOtp.activity_category_score_failed', {
              uid: userDoc.id,
              error: e instanceof Error ? e.message : String(e),
            });
          }
        }
      } else {
        logger.warn(`Phone verified but no user found for ${phoneE164}`);
      }
    }

    logger.info(`Phone verified: ${phoneE164}`);
    return { success: true };
  } catch (error: any) {
    logger.error('Failed to verify OTP:', error);
    
    // Handle specific Twilio errors
    if (error.code === 60202) {
      throw new HttpsError('invalid-argument', 'Invalid verification code. Please try again.');
    } else if (error.code === 60203) {
      throw new HttpsError('resource-exhausted', 'Maximum verification attempts reached. Please try again later.');
    } else if (error.code === 60204) {
      throw new HttpsError('deadline-exceeded', 'Verification code expired. Please request a new one.');
    }
    
    // If it's already an HttpsError, re-throw it
    if (error instanceof HttpsError) {
      throw error;
    }
    
    throw new HttpsError('internal', 'Failed to verify code. Please try again.');
  }
});

/**
 * Internal helper to send SMS via Twilio (for use in Firestore triggers and scheduled functions)
 * This version doesn't require authentication context
 * 
 * ⚠️ LEGACY FUNCTION - PATCHED FOR COMPLIANCE
 * This function now enforces STOP/HELP compliance and uses unified logging.
 * Prefer using routingOrchestrator.sendMessage() for new code.
 * 
 * Phase 1.1 Migration: Added STOP enforcement, unified logging, removed /sms_messages writes
 */
export async function sendWorkerMessageInternal(
  to: string,
  messageContent: string,
  context?: {
    systemContext?: boolean;
    source?: string;
    sourceId?: string;
    tenantId?: string;        // NEW: Tenant ID for proper logging
    messageTypeId?: string;   // NEW: Message type for unified framework
    userId?: string;          // NEW: User ID if known
  }
): Promise<{ success: boolean; messageId: string | null; status: string; error?: string; errorCode?: string }> {
  // Validate inputs
  if (!to || !/^\+[1-9]\d{7,14}$/.test(to)) {
    logger.error('Invalid recipient phone number format:', to);
    return {
      success: false,
      messageId: null,
      status: 'failed',
      error: 'Invalid recipient phone number format'
    };
  }

  if (!messageContent || messageContent.trim() === '') {
    logger.error('Message content is required');
    return {
      success: false,
      messageId: null,
      status: 'failed',
      error: 'Message content is required'
    };
  }

  try {
    // Check SMS opt-in for recipient and get userId for activity log
    const usersQuery = await db.collection('users')
      .where('phoneE164', '==', to)
      .limit(1)
      .get();
    
    let recipientUserId: string | null = context?.userId || null;
    let recipientUserData: any = null;
    let tenantId: string | null = context?.tenantId || null;
    
    if (!usersQuery.empty) {
      const recipientUserDoc = usersQuery.docs[0];
      recipientUserId = recipientUserId || recipientUserDoc.id;
      recipientUserData = recipientUserDoc.data();
      
      // Get tenantId from user if not provided
      if (!tenantId && recipientUserData?.tenantId) {
        tenantId = recipientUserData.tenantId;
      }
      
      // PHASE 1.1: Check BOTH smsOptIn AND smsBlockedSystem (STOP enforcement)
      // This ensures STOP keyword always works, even in legacy code paths
      if (recipientUserData?.smsOptIn === false) {
        logger.info(`Skipping SMS to ${to} - user has opted out (smsOptIn=false)`);
        
        // Log the blocked attempt if we have tenantId
        if (tenantId && recipientUserId) {
          try {
            const { logMessage } = await import('./messaging/messageLogging');
            await logMessage({
              tenantId,
              userId: recipientUserId,
              messageTypeId: context?.messageTypeId || 'legacy_sms',
              channel: 'sms',
              direction: 'outbound',
              fromIdentity: context?.source === 'recruiter' ? 'recruiter' : 'system',
              fromUserId: context?.sourceId || undefined,
              contentSent: messageContent,
              language: (recipientUserData?.preferredLanguage || 'en') as 'en' | 'es' | null,
              status: 'not_sent',
              failureReason: 'User opted out (smsOptIn=false)',
            });
          } catch (logError: any) {
            logger.warn(`Failed to log blocked SMS attempt: ${logError.message}`);
          }
        }
        
        return {
          success: false,
          messageId: null,
          status: 'skipped',
          error: 'Recipient has opted out of SMS messages'
        };
      }
      
      // PHASE 1.1: Check smsBlockedSystem (STOP keyword enforcement)
      if (recipientUserData?.smsBlockedSystem === true) {
        logger.info(`Skipping SMS to ${to} - user has sent STOP keyword (smsBlockedSystem=true)`);
        
        // Log the blocked attempt if we have tenantId
        if (tenantId && recipientUserId) {
          try {
            const { logMessage } = await import('./messaging/messageLogging');
            await logMessage({
              tenantId,
              userId: recipientUserId,
              messageTypeId: context?.messageTypeId || 'legacy_sms',
              channel: 'sms',
              direction: 'outbound',
              fromIdentity: context?.source === 'recruiter' ? 'recruiter' : 'system',
              fromUserId: context?.sourceId || undefined,
              contentSent: messageContent,
              language: (recipientUserData?.preferredLanguage || 'en') as 'en' | 'es' | null,
              status: 'not_sent',
              failureReason: 'User sent STOP keyword (smsBlockedSystem=true)',
            });
          } catch (logError: any) {
            logger.warn(`Failed to log blocked SMS attempt: ${logError.message}`);
          }
        }
        
        return {
          success: false,
          messageId: null,
          status: 'skipped',
          error: 'Recipient has blocked SMS messages (STOP keyword)'
        };
      }
      
      // Check if phone is verified (preferred but not required)
      if (!recipientUserData?.phoneVerified) {
        logger.warn(`Sending SMS to unverified phone: ${to}`);
      }
    }

    // Early-funnel SMS coordination (same policy as routingOrchestrator deliverSms).
    // Runs even when phone lookup failed, as long as context carries tenantId + userId.
    if (tenantId && recipientUserId && context?.messageTypeId) {
      const { checkEarlyFunnelSmsGate } = await import('./messaging/earlyFunnelSmsPolicy');
      const gate = await checkEarlyFunnelSmsGate({
        tenantId,
        userId: recipientUserId,
        messageTypeId: context.messageTypeId,
      });
      if (gate.allowed === false) {
        logger.info('sendWorkerMessageInternal: early_funnel_suppressed', {
          tenantId,
          userId: recipientUserId,
          messageTypeId: context.messageTypeId,
          reason: gate.reason,
          lastMessageTypeId: gate.lastMessageTypeId,
        });
        try {
          const { logMessage } = await import('./messaging/messageLogging');
          const lang = (recipientUserData?.preferredLanguage || 'en') as 'en' | 'es' | null;
          await logMessage({
            tenantId,
            userId: recipientUserId,
            messageTypeId: context.messageTypeId,
            channel: 'sms',
            direction: 'outbound',
            fromIdentity: context?.source === 'recruiter' ? 'recruiter' : 'system',
            fromUserId: context?.sourceId || undefined,
            contentSent: messageContent,
            language: lang,
            status: 'suppressed_early_funnel',
            failureReason: JSON.stringify({
              reason: gate.reason,
              lastMessageTypeId: gate.lastMessageTypeId,
              elapsedMs: gate.elapsedMs,
            }),
          });
        } catch (logErr: any) {
          logger.warn(`Failed to log suppressed early-funnel SMS: ${logErr.message}`);
        }
        return {
          success: false,
          messageId: null,
          status: 'skipped',
          error: 'early_funnel_cooldown',
        };
      }
    }

    // Same messageTypeId + same user within 60s (last-line defense; orchestrator uses deliverSms).
    if (tenantId && recipientUserId && context?.messageTypeId) {
      const { checkSmsDuplicateMessageTypeGuard } = await import('./messaging/smsDuplicateMessageGuard');
      const dup = await checkSmsDuplicateMessageTypeGuard({
        tenantId,
        userId: recipientUserId,
        messageTypeId: context.messageTypeId,
      });
      if (dup.allowed === false) {
        logger.info('duplicate_message_guard', {
          tenantId,
          userId: recipientUserId,
          messageTypeId: context.messageTypeId,
          elapsedMs: dup.elapsedMs,
        });
        try {
          const { logMessage } = await import('./messaging/messageLogging');
          const lang = (recipientUserData?.preferredLanguage || 'en') as 'en' | 'es' | null;
          await logMessage({
            tenantId,
            userId: recipientUserId,
            messageTypeId: context.messageTypeId,
            channel: 'sms',
            direction: 'outbound',
            fromIdentity: context?.source === 'recruiter' ? 'recruiter' : 'system',
            fromUserId: context?.sourceId || undefined,
            contentSent: messageContent,
            language: lang,
            status: 'suppressed_duplicate_message_guard',
            failureReason: JSON.stringify({
              reason: 'duplicate_message_guard',
              elapsedMs: dup.elapsedMs,
            }),
          });
        } catch (logErr: any) {
          logger.warn(`Failed to log suppressed duplicate-guard SMS: ${logErr.message}`);
        }
        return {
          success: false,
          messageId: null,
          status: 'skipped',
          error: 'duplicate_message_guard',
        };
      }
    }

    // Get Twilio configuration
    let client;
    let messagingPhoneNumber;
    let a2pCampaign;
    
    try {
      client = getTwilioClient();
      messagingPhoneNumber = getMessagingPhoneNumber();
      a2pCampaign = getA2PCampaign();
    } catch (configError: any) {
      logger.error('Failed to load Twilio configuration:', configError);
      return {
        success: false,
        messageId: null,
        status: 'failed',
        error: `Twilio configuration error: ${configError.message}`
      };
    }
    
    // Self-hosted link shortening (hrxone.com/l/…) — replaces Twilio's
    // per-message-billed `shortenUrls` feature. Fail-open: on any error the
    // original body (long links) goes out unchanged.
    const outboundBody = await shortenUrlsInBody(messageContent, {
      tenantId: context?.tenantId,
      userId: context?.userId,
      messageTypeId: context?.messageTypeId,
    });

    // Send SMS via Twilio
    const messageParams: any = {
      to: to,
      body: outboundBody,
    };

    // Prefer Messaging Service when configured (sticky sender, throughput)
    if (a2pCampaign && a2pCampaign.trim() !== '') {
      messageParams.messagingServiceSid = a2pCampaign;
      logger.info(`Using A2P messaging service: ${a2pCampaign}`);
    } else if (messagingPhoneNumber && messagingPhoneNumber.trim() !== '') {
      messageParams.from = messagingPhoneNumber;
      logger.info(`Using direct phone number: ${messagingPhoneNumber}`);
    } else {
      logger.error('Twilio messaging configuration is missing');
      return {
        success: false,
        messageId: null,
        status: 'failed',
        error: 'Twilio messaging configuration is missing'
      };
    }

    let messageResult;
    try {
      messageResult = await client.messages.create(messageParams);
    } catch (twilioError: any) {
      // When using Messaging Service, fall back to direct number on invalid SID (21705) or A2P (30034)
      if ((twilioError.code === 21705 || twilioError.code === 30034) && messageParams.messagingServiceSid && messagingPhoneNumber && messagingPhoneNumber.trim() !== '') {
        logger.warn(`Messaging Service failed (${twilioError.code}), falling back to direct number ${messagingPhoneNumber}. Error: ${twilioError.message}`);
        try {
          messageResult = await client.messages.create({
            to: to,
            body: outboundBody,
            from: messagingPhoneNumber,
          });
        } catch (fallbackError: any) {
          logger.error(`Fallback to direct number also failed: ${fallbackError.message}`);
          return {
            success: false,
            messageId: null,
            status: 'failed',
            error: twilioError.code === 30034
              ? 'SMS delivery failed: A2P 10DLC registration required'
              : `SMS delivery failed: ${fallbackError.message}`,
            errorCode: String(twilioError.code ?? fallbackError.code),
          };
        }
      } else if (twilioError.code === 30034) {
        logger.error(`A2P 10DLC registration required. SMS not sent to ${to}. Error: ${twilioError.message}`);
        return {
          success: false,
          messageId: null,
          status: 'failed',
          error: 'SMS delivery failed: A2P 10DLC registration required',
          errorCode: '30034'
        };
      } else {
        throw twilioError;
      }
    }

    // PHASE 1.1: Use unified logger instead of legacy /sms_messages collection
    // This ensures all messages are logged to /tenants/{tenantId}/messageLogs
    if (tenantId && recipientUserId) {
      try {
        const { logMessage, updateMessageLogStatus } = await import('./messaging/messageLogging');
        const logId = await logMessage({
          tenantId,
          userId: recipientUserId,
          messageTypeId: context?.messageTypeId || 'legacy_sms',
          channel: 'sms',
          direction: 'outbound',
          fromIdentity: context?.source === 'recruiter' ? 'recruiter' : 'system',
          fromUserId: context?.sourceId || undefined,
          contentSent: messageContent,
          language: (recipientUserData?.preferredLanguage || 'en') as 'en' | 'es' | null,
          status: 'queued',
          providerMessageId: messageResult.sid,
        });
        
        // Update log with final status
        if (logId) {
          const finalStatus: 'sent' | 'failed' | 'not_sent' = 
            messageResult.status === 'failed' || messageResult.status === 'undelivered' ? 'failed' :
            messageResult.status === 'sent' || messageResult.status === 'delivered' ? 'sent' : 'sent';
          
          await updateMessageLogStatus(logId, finalStatus, {
            tenantId,
            providerMessageId: messageResult.sid,
            failureReason: messageResult.errorMessage || messageResult.errorCode || undefined,
          });
        }
      } catch (logError: any) {
        // Don't fail SMS send if logging fails, but log the error
        logger.warn(`Failed to log SMS to unified logger: ${logError.message}`);
        
        // PHASE 1.1: DEPRECATED - Only write to legacy collection if unified logging fails
        // This is a fallback during migration period
        logger.warn('Falling back to legacy /sms_messages collection (should not happen in production)');
        await db.collection('sms_messages').add({
          messageId: messageResult.sid,
          from: context?.source || 'system',
          sourceId: context?.sourceId || null,
          to: to,
          content: messageContent,
          template: null,
          status: messageResult.status,
          errorCode: messageResult.errorCode || null,
          errorMessage: messageResult.errorMessage || null,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          sentAt: admin.firestore.FieldValue.serverTimestamp(),
          systemContext: context?.systemContext || false,
          _deprecated: true, // Mark as deprecated
          _migrationNote: 'Legacy collection - should use /tenants/{tenantId}/messageLogs',
        });
      }
    } else {
      // If we don't have tenantId/userId, log warning but still send SMS
      // This should be rare and indicates a data issue
      logger.warn(`SMS sent but cannot log to unified system - missing tenantId or userId for ${to}`);
      
      // PHASE 1.1: DEPRECATED - Only write to legacy collection if we can't determine tenant/user
      // This is a fallback during migration period
      await db.collection('sms_messages').add({
        messageId: messageResult.sid,
        from: context?.source || 'system',
        sourceId: context?.sourceId || null,
        to: to,
        content: messageContent,
        template: null,
        status: messageResult.status,
        errorCode: messageResult.errorCode || null,
        errorMessage: messageResult.errorMessage || null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
        systemContext: context?.systemContext || false,
        _deprecated: true, // Mark as deprecated
        _migrationNote: 'Legacy collection - missing tenantId/userId for unified logging',
      });
    }

    // Activity log: mirrored from messageLogs when status moves queued → sent (messageLogging.updateMessageLogStatus).

    logger.info(`SMS sent internally: ${messageResult.sid} to ${to}`);

    if (tenantId && recipientUserId && context?.messageTypeId) {
      try {
        const { recordEarlyFunnelSmsSent } = await import('./messaging/earlyFunnelSmsPolicy');
        await recordEarlyFunnelSmsSent({
          tenantId,
          userId: recipientUserId,
          messageTypeId: context.messageTypeId,
        });
      } catch (recErr: any) {
        logger.warn(`recordEarlyFunnelSmsSent failed: ${recErr?.message || recErr}`);
      }
      try {
        const { recordSmsDuplicateMessageGuardSent } = await import('./messaging/smsDuplicateMessageGuard');
        await recordSmsDuplicateMessageGuardSent({
          tenantId,
          userId: recipientUserId,
          messageTypeId: context.messageTypeId,
        });
      } catch (recErr: any) {
        logger.warn(`recordSmsDuplicateMessageGuardSent failed: ${recErr?.message || recErr}`);
      }
    }

    return { 
      success: true, 
      messageId: messageResult.sid,
      status: messageResult.status 
    };
  } catch (error: any) {
    logger.error('Failed to send SMS internally:', error);
    
    // Handle specific Twilio errors
    if (error.code === 21211 || error.code === 21614) {
      return {
        success: false,
        messageId: null,
        status: 'failed',
        error: 'Invalid phone number format or not SMS capable'
      };
    } else if (error.code === 21617) {
      return {
        success: false,
        messageId: null,
        status: 'failed',
        error: 'Recipient has opted out of SMS messages'
      };
    }
    
    return {
      success: false,
      messageId: null,
      status: 'failed',
      error: error.message || 'Unknown error'
    };
  }
}

/**
 * Send worker message via Twilio Programmable Messaging (Callable function with auth)
 */
export const sendWorkerMessage = onCall(
  {
    secrets: [TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_MESSAGING_PHONE_NUMBER, TWILIO_A2P_CAMPAIGN],
    // Explicitly allow all ingress (Firebase callable functions handle auth automatically)
    // This ensures Cloud Run doesn't block requests before Firebase can process them
  },
  async (request) => {
  // Log function invocation for debugging
  logger.info('sendWorkerMessage function invoked', {
    hasAuth: !!request.auth,
    authUid: request.auth?.uid || 'none',
    hasData: !!request.data,
    dataKeys: request.data ? Object.keys(request.data as any) : []
  });

  // Validate authentication
  if (!request.auth) {
    logger.error('sendWorkerMessage: No authentication provided');
    throw new HttpsError('unauthenticated', 'Must be signed in to send messages');
  }

  const { to, message, template } = request.data as { 
    to: string; 
    message?: string; 
    template?: 'shift_reminder' | 'onboarding' | 'status_update' | 'custom';
  };
  const senderUid = request.auth.uid;

  // Validate inputs
  if (!to || !/^\+[1-9]\d{7,14}$/.test(to)) {
    throw new HttpsError('invalid-argument', 'Invalid recipient phone number format');
  }

  if (!message && !template) {
    throw new HttpsError('invalid-argument', 'Message content or template is required');
  }

  try {
    // Check if sender has permission to send worker messages
    const senderDoc = await db.doc(`users/${senderUid}`).get();
    const senderData = senderDoc.data();
    
    if (!senderData) {
      throw new HttpsError('not-found', 'Sender profile not found');
    }

    // Check if sender has appropriate permissions (Admin, Manager, or Recruiter)
    const securityLevel = parseInt(senderData.securityLevel || '0');
    const isAdmin = securityLevel >= 5;
    const isManager = senderData.role === 'Manager' || senderData.managerId;
    const isRecruiter = senderData.recruiter === true;
    
    if (!isAdmin && !isManager && !isRecruiter) {
      throw new HttpsError('permission-denied', 'Insufficient permissions to send worker messages');
    }

    // Find recipient by phone number (phoneE164 field)
    const usersQuery = await db.collection('users')
      .where('phoneE164', '==', to)
      .limit(1)
      .get();
    
    if (usersQuery.empty) {
      // If user not found by phone, log warning but allow SMS to proceed
      // (user might be external or phone might be stored differently)
      logger.warn(`Recipient not found in system for phone ${to}, but allowing SMS to proceed`);
    } else {
      const recipientUserDoc = usersQuery.docs[0];
      const recipientUserData = recipientUserDoc.data();
      
      // Check SMS opt-in - if field exists and is false, block SMS
      // If field doesn't exist, default to allowing SMS (for verified phones)
      if (recipientUserData.smsOptIn === false) {
        throw new HttpsError('permission-denied', 'Recipient has opted out of SMS messages');
      }
      // If smsOptIn is true or undefined, allow SMS to proceed
    }

    // Prepare message content
    let messageContent = message;
    
    if (template && !message) {
      // Use template
      const templates = {
        shift_reminder: 'Hi! This is a reminder about your upcoming shift. Please confirm your availability.',
        onboarding: 'Welcome to the team! Please check your email for onboarding details and next steps.',
        status_update: 'Your application status has been updated. Please check your account for details.',
        custom: 'You have a new message from HRX. Please check your account for details.'
      };
      
      messageContent = templates[template];
    }

    if (!messageContent) {
      throw new HttpsError('invalid-argument', 'Message content is required');
    }

    // Get Twilio configuration with error handling
    let client;
    let messagingPhoneNumber;
    let a2pCampaign;
    
    try {
      client = getTwilioClient();
      messagingPhoneNumber = getMessagingPhoneNumber();
      a2pCampaign = getA2PCampaign();
    } catch (configError: any) {
      logger.error('Failed to load Twilio configuration:', configError);
      throw new HttpsError('internal', `Twilio configuration error: ${configError.message}. Please ensure all required secrets are set: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_MESSAGING_PHONE_NUMBER or TWILIO_A2P_CAMPAIGN.`);
    }
    
    // Self-hosted link shortening — see sendWorkerMessageInternal above.
    const outboundBody = await shortenUrlsInBody(messageContent);

    // Send SMS via Twilio
    // Use direct phone number to avoid A2P 10DLC registration requirements
    // (A2P 10DLC requires brand/campaign registration which can take time)
    const messageParams: any = {
      to: to,
      body: outboundBody,
    };

    // Prefer Messaging Service when configured (sticky sender, throughput)
    if (a2pCampaign && a2pCampaign.trim() !== '') {
      messageParams.messagingServiceSid = a2pCampaign;
      logger.info(`Using A2P messaging service: ${a2pCampaign}`);
    } else if (messagingPhoneNumber && messagingPhoneNumber.trim() !== '') {
      messageParams.from = messagingPhoneNumber;
      logger.info(`Using direct phone number: ${messagingPhoneNumber}`);
    } else {
      throw new HttpsError('internal', 'Twilio messaging configuration is missing. Please configure TWILIO_MESSAGING_PHONE_NUMBER or TWILIO_A2P_CAMPAIGN.');
    }
    
    logger.info(`Attempting to send SMS to ${to} with params:`, { to, hasMessagingService: !!messageParams.messagingServiceSid, hasFrom: !!messageParams.from });
    
    let messageResult;
    try {
      messageResult = await client.messages.create(messageParams);
    } catch (twilioError: any) {
      // Handle A2P 10DLC registration errors (30034) - try fallback if using Messaging Service
      if (twilioError.code === 30034 && messageParams.messagingServiceSid && messagingPhoneNumber) {
        logger.warn(`A2P 10DLC registration required for Messaging Service, falling back to direct phone number ${messagingPhoneNumber}`);
        const fallbackParams: any = {
          to: to,
          body: outboundBody,
          from: messagingPhoneNumber,
        };
        try {
          messageResult = await client.messages.create(fallbackParams);
        } catch (fallbackError: any) {
          // If fallback also fails with 30034, log warning but don't fail the assignment
          if (fallbackError.code === 30034) {
            logger.error(`Both Messaging Service and direct phone number require A2P 10DLC registration. Assignment created but SMS not sent. Error: ${fallbackError.message}`);
            // Return success but indicate SMS was not sent
            return {
              success: false,
              messageId: null,
              status: 'failed',
              error: 'SMS delivery failed: A2P 10DLC registration required. Please notify worker manually.',
              errorCode: '30034'
            };
          }
          throw fallbackError;
        }
      } else if (twilioError.code === 21705 && messageParams.messagingServiceSid && messagingPhoneNumber) {
        // If Messaging Service SID is invalid (error 21705), fall back to direct phone number
        logger.warn(`Messaging Service SID ${messageParams.messagingServiceSid} is invalid, falling back to direct phone number ${messagingPhoneNumber}`);
        const fallbackParams: any = {
          to: to,
          body: outboundBody,
          from: messagingPhoneNumber,
        };
        messageResult = await client.messages.create(fallbackParams);
      } else if (twilioError.code === 30034) {
        // Direct phone number also requires A2P 10DLC registration
        logger.error(`A2P 10DLC registration required for phone number ${messagingPhoneNumber}. Assignment created but SMS not sent. Error: ${twilioError.message}`);
        // Return success but indicate SMS was not sent
        return {
          success: false,
          messageId: null,
          status: 'failed',
          error: 'SMS delivery failed: A2P 10DLC registration required. Please notify worker manually.',
          errorCode: '30034'
        };
      } else {
        // Re-throw other errors
        throw twilioError;
      }
    }

    // Log message to Firestore for audit trail
    await db.collection('sms_messages').add({
      messageId: messageResult.sid,
      from: senderUid,
      to: to,
      content: messageContent,
      template: template || null,
      status: messageResult.status,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    logger.info(`Worker message sent: ${messageResult.sid} from ${senderUid} to ${to}`);
    return { 
      success: true, 
      messageId: messageResult.sid,
      status: messageResult.status 
    };
  } catch (error: any) {
    logger.error('Failed to send worker message:', error);
    logger.error('Error details:', {
      code: error.code,
      message: error.message,
      status: error.status,
      moreInfo: error.moreInfo,
      stack: error.stack
    });
    
    // Handle specific Twilio errors
    if (error.code === 21211) {
      throw new HttpsError('invalid-argument', 'Invalid phone number format');
    } else if (error.code === 21614) {
      throw new HttpsError('invalid-argument', 'Phone number is not SMS capable');
    } else if (error.code === 21617) {
      throw new HttpsError('permission-denied', 'Recipient has opted out of SMS messages');
    } else if (error.code === 20003) {
      throw new HttpsError('permission-denied', 'Twilio authentication failed. Please check credentials.');
    } else if (error.code === 20429) {
      throw new HttpsError('resource-exhausted', 'Too many requests to Twilio. Please try again later.');
    } else if (error.code === 21608) {
      throw new HttpsError('invalid-argument', 'Invalid messaging service SID or phone number configuration.');
    }
    
    // If it's already an HttpsError, re-throw it with more context
    if (error instanceof HttpsError) {
      throw error;
    }
    
    // Provide more specific error message for debugging
    const errorMessage = error.message || 'Unknown error';
    const errorCode = error.code || 'unknown';
    logger.error(`Twilio error: ${errorCode} - ${errorMessage}`);
    
    throw new HttpsError('internal', `Failed to send SMS: ${errorMessage} (Code: ${errorCode}). Check Firebase function logs for details.`);
  }
});
