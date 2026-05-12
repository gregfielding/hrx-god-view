/**
 * adminCreateWorker — recruiter/admin creates a worker's HRX account on
 * their behalf, then optionally hires them to an entity in the same call.
 *
 * Use case (May 2026): workers who don't have a phone, can't navigate
 * the public apply wizard, or are sitting in front of an Onboarding
 * Specialist who has all their info. Existing invite stacks (`inviteUser`,
 * `inviteUserV2`) both require the worker to receive a setup link and
 * complete password setup themselves — that's the wrong UX for this
 * scenario. This callable instead:
 *
 *   1. Creates the Firebase Auth user with a recruiter-provided OR
 *      auto-generated password (returned to the caller so they can hand
 *      it to the worker on the spot).
 *   2. Writes a fully-formed `users/{uid}` doc shaped to match what
 *      `inviteUserV2` writes PLUS the extras a manual hire needs
 *      (dateOfBirth, addressInfo, preferredLanguage, manualCreation
 *      audit fields).
 *   3. Mirrors the tenant role into custom claims (`setTenantRole`
 *      pattern), so claim-gated callables work for the new account
 *      immediately — without a second sync hop.
 *   4. (Optional) If `entityId` is provided, runs the canonical
 *      `runStartOnCallEmploymentFlow` with `suppressNotifications:true`
 *      to create `entity_employments` + `worker_onboarding` and (for
 *      Everee-enabled entities) provision the Everee worker shell. We
 *      suppress notifications because the admin is doing this in person
 *      — the worker doesn't need an SMS that says "you've been hired"
 *      while the admin is literally talking to them.
 *
 * Permission gate: reuses `canManageEveree` (HRX OR tenant Admin /
 * Manager / Recruiter via custom claims OR `securityLevel >= 5` via
 * Firestore). Same band that gates Everee admin actions, AccuSource,
 * payroll-adjacent surfaces. See `evereeAccessGate.ts` for the rationale.
 *
 * Email is REQUIRED — Firebase Auth uses email as the unique sign-in
 * identifier and the rest of the app keys on it (login form,
 * `/setup-password`, every recruiter query). We chose to require a real
 * email rather than mint placeholders because a placeholder breaks
 * password recovery, future notifications, and worker self-service.
 *
 * Idempotency / "already exists":
 *   - `getUserByEmail` first. If a user already exists, we DO NOT
 *     silently overwrite their data. By default we return
 *     `{ alreadyExists: true, uid, displayName, email, profileSnapshot }`
 *     so the wizard can ask the recruiter "open profile, or load into
 *     wizard to fill missing fields?".
 *   - If the recruiter chooses the "fill missing fields" path, they
 *     re-call with `mergeMode: 'fill_missing_only'` (only writes fields
 *     that are currently absent on the user doc) or
 *     `mergeMode: 'overwrite_provided'` (writes every provided field,
 *     overwriting existing). The audit trail records the chosen mode.
 *
 * Companion callable note: `setTenantRole` separately also exists for
 * post-hoc claim updates. We deliberately inline the
 * `setCustomUserClaims` write here so a single callable round-trip
 * leaves the new account ready to use for the recruiter's session.
 */

import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { z } from 'zod';

import { canManageEveree } from '../integrations/everee/evereeAccessGate';
import { runStartOnCallEmploymentFlow } from '../onboarding/startOnCallEmployment';
import {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_MESSAGING_PHONE_NUMBER,
  TWILIO_A2P_CAMPAIGN,
} from '../messaging/twilioSecrets';
import { sendGridFromEmail, sendGridFromName } from '../messaging/emailProviderFactory';

if (!admin.apps.length) {
  admin.initializeApp();
}

const SECURITY_LEVELS = ['1', '2', '3', '4', '5', '6', '7'] as const;

/**
 * Recruiter input schema. Most fields are optional to support partial
 * "fill in what we have, finish the rest in Everee embed" flows.
 */
const AdminCreateWorkerInputSchema = z.object({
  tenantId: z.string().min(1, 'tenantId is required'),

  // Identity (required for any usable HRX account)
  email: z.string().email('email must be a valid address'),
  firstName: z.string().min(1, 'firstName is required').max(80),
  lastName: z.string().min(1, 'lastName is required').max(80),

  // Identity (optional; recommended)
  phone: z.string().max(40).optional(),
  dateOfBirth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/u, 'dateOfBirth must be ISO YYYY-MM-DD')
    .optional(),
  preferredLanguage: z.enum(['en', 'es']).optional(),

  // Address (optional but written when present; same shape Everee + workforce expect)
  address: z
    .object({
      addressLine1: z.string().min(1).max(200),
      addressLine2: z.string().max(200).optional(),
      city: z.string().min(1).max(120),
      state: z.string().min(2).max(80),
      postalCode: z.string().min(3).max(20),
      country: z.string().max(80).optional(),
    })
    .optional(),

  // Account
  password: z.string().min(8).max(128).optional(),
  /**
   * 'generate' = server creates a 12-char random password and returns it.
   * 'recruiter' = caller-provided `password` is used.
   */
  passwordMode: z.enum(['generate', 'recruiter']).default('generate'),

  // Tenant role / security level for the new user
  role: z.enum(['Tenant', 'HRX']).default('Tenant'),
  securityLevel: z.enum(SECURITY_LEVELS).default('5'),

  // Optional immediate hire to entity
  entityId: z.string().optional(),
  workerType: z.enum(['w2', '1099', 'entity_default']).optional(),

  /**
   * How to handle a pre-existing user with this email.
   *  - 'fail'                 — return `alreadyExists: true` and do nothing else (default).
   *  - 'fill_missing_only'    — only write fields the existing doc lacks; never overwrite.
   *  - 'overwrite_provided'   — write every provided field, overwriting current values.
   *
   * The wizard surfaces this as a 2-step prompt: first call hits 'fail',
   * recruiter picks "fill gaps" → second call passes the chosen mode.
   */
  mergeMode: z.enum(['fail', 'fill_missing_only', 'overwrite_provided']).default('fail'),
});

type AdminCreateWorkerInput = z.infer<typeof AdminCreateWorkerInputSchema>;

interface AdminCreateWorkerResult {
  ok: boolean;
  /** Firebase Auth uid of the (created or existing) user. */
  uid: string;
  /** True when we found an existing user with this email and didn't create a new one. */
  alreadyExists: boolean;
  /** Generated password — ONLY returned when `passwordMode === 'generate'` and the auth user was newly created. */
  generatedPassword?: string;
  /** True when this call wrote to `users/{uid}` (either create or merge). */
  userDocWritten: boolean;
  /** True when custom claims were set/refreshed for this tenant. */
  claimsWritten: boolean;
  /** Pipeline id from `runStartOnCallEmploymentFlow` if hire-to-entity ran. */
  pipelineId?: string;
  /** Hint from the on-call flow when Everee auto-provision didn't complete (recruiter can sync from Employment later). */
  evereeProvisionWarning?: string | null;
  /** When `mergeMode !== 'fail'` and we already had a doc, snapshot of pre-merge fields so the UI can diff. */
  preMergeProfile?: Record<string, unknown> | null;
  /** Light-weight summary for the result screen. */
  summary: {
    displayName: string;
    email: string;
    phoneE164: string | null;
    tenantRoleApplied: { role: string; securityLevel: string };
    entityHired: { entityId: string; entityName: string } | null;
  };
}

/**
 * Cryptographically-random password generator that always emits chars
 * from sets Firebase Auth accepts and humans can read off a screen
 * (no `0/O`, `1/l/I`, etc.). Length 12 → ~70 bits entropy, well above
 * Firebase's 6-char minimum.
 */
function generateRecruiterFriendlyPassword(): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const digits = '23456789';
  const symbols = '!#$%-_';
  const all = upper + lower + digits + symbols;
  const cryptoObj = require('crypto');
  const pickFrom = (set: string): string => set[cryptoObj.randomInt(0, set.length)];
  const out: string[] = [
    pickFrom(upper),
    pickFrom(lower),
    pickFrom(digits),
    pickFrom(symbols),
  ];
  while (out.length < 12) out.push(pickFrom(all));
  // Fisher-Yates shuffle so the required-set chars aren't always at the front.
  for (let i = out.length - 1; i > 0; i--) {
    const j = cryptoObj.randomInt(0, i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.join('');
}

/** Normalize a user-supplied phone string to E.164 (US default). */
function normalizePhoneToE164(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.startsWith('+')) {
    const digits = trimmed.slice(1).replace(/\D+/g, '');
    return digits.length >= 10 && digits.length <= 15 ? `+${digits}` : null;
  }
  const digits = trimmed.replace(/\D+/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

/**
 * Build the `users/{uid}` patch from validated input. Caller decides
 * whether to set or merge it — this just constructs the field bag.
 *
 * Field layout matches `inviteUserV2`'s shape PLUS:
 *   - `dateOfBirth` (ISO date string)
 *   - `addressInfo` (Everee-compatible shape via `extractEvereeHomeAddressFromUserDoc`)
 *   - `preferredLanguage`
 *   - `phoneE164` (normalized)
 *   - `manualCreationByUid` / `manualCreationAt`
 *   - `inviteStatus: 'completed'` (no email-link step)
 *   - `orgType: 'Tenant'` (matches AuthDialog signup defaults)
 */
function buildUserDocPatch(args: {
  input: AdminCreateWorkerInput;
  callerUid: string;
  isNewAccount: boolean;
  mergeMode: AdminCreateWorkerInput['mergeMode'];
  existingDoc: Record<string, unknown> | null;
}): Record<string, unknown> {
  const { input, callerUid, isNewAccount, mergeMode, existingDoc } = args;
  const phoneE164 = normalizePhoneToE164(input.phone ?? null);
  const displayName = `${input.firstName} ${input.lastName}`.trim();

  const fullPatch: Record<string, unknown> = {
    email: input.email,
    displayName,
    firstName: input.firstName,
    lastName: input.lastName,
    role: input.role,
    securityLevel: input.securityLevel,
    orgType: input.role === 'HRX' ? 'HRX' : 'Tenant',
    tenantId: input.tenantId,
    [`tenantIds.${input.tenantId}`]: {
      role: input.role,
      securityLevel: input.securityLevel,
      addedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    inviteStatus: 'completed',
    isActive: true,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    manualCreationByUid: callerUid,
    manualCreationAt: admin.firestore.FieldValue.serverTimestamp(),
    manualCreationMergeMode: mergeMode,
  };

  if (isNewAccount) {
    fullPatch.createdAt = admin.firestore.FieldValue.serverTimestamp();
    fullPatch.signupSource = 'admin_create_worker';
  }

  if (input.phone) fullPatch.phone = input.phone;
  if (phoneE164) fullPatch.phoneE164 = phoneE164;
  if (input.dateOfBirth) fullPatch.dateOfBirth = input.dateOfBirth;
  if (input.preferredLanguage) fullPatch.preferredLanguage = input.preferredLanguage;

  if (input.address) {
    fullPatch.addressInfo = {
      addressLine1: input.address.addressLine1,
      ...(input.address.addressLine2 ? { addressLine2: input.address.addressLine2 } : {}),
      city: input.address.city,
      state: input.address.state,
      postalCode: input.address.postalCode,
      country: input.address.country || 'US',
    };
  }

  if (mergeMode === 'fill_missing_only' && existingDoc) {
    // Drop any field the existing doc already has a non-empty value for.
    // We keep `updatedAt` / `manualCreation*` always so the audit trail
    // records this call. Tenant-map dot-path is special: only write if
    // the exact tenant block is missing.
    const tenantMapPath = `tenantIds.${input.tenantId}`;
    const existingTenantBlock =
      ((existingDoc.tenantIds as Record<string, unknown> | undefined) ?? {})[input.tenantId];
    const filtered: Record<string, unknown> = {
      updatedAt: fullPatch.updatedAt,
      manualCreationByUid: fullPatch.manualCreationByUid,
      manualCreationAt: fullPatch.manualCreationAt,
      manualCreationMergeMode: fullPatch.manualCreationMergeMode,
    };
    for (const [k, v] of Object.entries(fullPatch)) {
      if (k.startsWith('manualCreation') || k === 'updatedAt') continue;
      if (k === tenantMapPath) {
        if (!existingTenantBlock) filtered[k] = v;
        continue;
      }
      const existingVal = existingDoc[k];
      const existingHasValue =
        existingVal !== undefined &&
        existingVal !== null &&
        existingVal !== '' &&
        !(Array.isArray(existingVal) && existingVal.length === 0);
      if (!existingHasValue) filtered[k] = v;
    }
    return filtered;
  }

  return fullPatch;
}

async function applyTenantClaims(args: {
  uid: string;
  tenantId: string;
  role: AdminCreateWorkerInput['role'];
  securityLevel: AdminCreateWorkerInput['securityLevel'];
}): Promise<void> {
  const { uid, tenantId, role, securityLevel } = args;
  const targetUser = await admin.auth().getUser(uid);
  const currentClaims = (targetUser.customClaims || {}) as {
    hrx?: boolean;
    roles?: Record<string, { role?: string; securityLevel?: string }>;
    ver?: number;
  };
  const newClaims = {
    ...currentClaims,
    roles: {
      ...(currentClaims.roles || {}),
      [tenantId]: { role, securityLevel },
    },
    ver: (currentClaims.ver || 1) + 1,
  };
  await admin.auth().setCustomUserClaims(uid, newClaims);
}

export const adminCreateWorker = onCall(
  {
    cors: true,
    region: 'us-central1',
    memory: '512MiB',
    timeoutSeconds: 240,
    /**
     * `runStartOnCallEmploymentFlow` chains into messaging dispatchers
     * even when `suppressNotifications` is true (audit log writes still
     * happen, and the SendGrid / Twilio modules are imported eagerly at
     * the top of the dispatcher file). Bind the same secret bag those
     * dispatchers expect so a cold start doesn't fail mid-hire.
     */
    secrets: [
      TWILIO_ACCOUNT_SID,
      TWILIO_AUTH_TOKEN,
      TWILIO_MESSAGING_PHONE_NUMBER,
      TWILIO_A2P_CAMPAIGN,
      sendGridFromEmail,
      sendGridFromName,
    ],
  },
  async (request): Promise<AdminCreateWorkerResult> => {
    const start = Date.now();
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentication required');
    }
    const callerUid = request.auth.uid;

    // Validate
    let input: AdminCreateWorkerInput;
    try {
      input = AdminCreateWorkerInputSchema.parse(request.data);
    } catch (err) {
      if (err instanceof z.ZodError) {
        throw new HttpsError(
          'invalid-argument',
          err.issues.map((i) => i.message).join('; '),
        );
      }
      throw new HttpsError('invalid-argument', 'Invalid input');
    }

    // Permission gate (HRX OR Admin/Manager/Recruiter OR securityLevel >= 5)
    const allowed = await canManageEveree(request.auth as any, input.tenantId);
    if (!allowed) {
      throw new HttpsError(
        'permission-denied',
        'You do not have permission to create workers in this tenant.',
      );
    }

    if (input.passwordMode === 'recruiter' && !input.password) {
      throw new HttpsError(
        'invalid-argument',
        'passwordMode=recruiter requires a `password` value (min 8 chars).',
      );
    }

    const db = admin.firestore();

    // Step 1 — locate or create Firebase Auth user.
    let userRecord: admin.auth.UserRecord;
    let isNewAccount = false;
    let generatedPassword: string | undefined;
    let alreadyExists = false;

    try {
      userRecord = await admin.auth().getUserByEmail(input.email);
      alreadyExists = true;
    } catch (e: unknown) {
      const err = e as { code?: string };
      if (err?.code !== 'auth/user-not-found') {
        logger.error('[adminCreateWorker] getUserByEmail failed', {
          tenantId: input.tenantId,
          email: input.email,
          error: e instanceof Error ? e.message : String(e),
        });
        throw new HttpsError('internal', 'Failed to look up user by email.');
      }
      // No user → create one
      const password =
        input.passwordMode === 'recruiter'
          ? input.password!
          : generateRecruiterFriendlyPassword();
      try {
        userRecord = await admin.auth().createUser({
          email: input.email,
          emailVerified: false,
          password,
          displayName: `${input.firstName} ${input.lastName}`.trim(),
          ...(normalizePhoneToE164(input.phone ?? null)
            ? { phoneNumber: normalizePhoneToE164(input.phone ?? null)! }
            : {}),
          disabled: false,
        });
      } catch (createErr: unknown) {
        const c = createErr as { code?: string; message?: string };
        // Phone uniqueness conflict — retry without phone, surface a soft warning
        // so the recruiter can fix it on the user profile after creation.
        if (c?.code === 'auth/phone-number-already-exists') {
          userRecord = await admin.auth().createUser({
            email: input.email,
            emailVerified: false,
            password,
            displayName: `${input.firstName} ${input.lastName}`.trim(),
            disabled: false,
          });
          logger.warn('[adminCreateWorker] phone collision — created without phone', {
            tenantId: input.tenantId,
            email: input.email,
          });
        } else {
          logger.error('[adminCreateWorker] createUser failed', {
            tenantId: input.tenantId,
            email: input.email,
            code: c?.code,
            message: c?.message,
          });
          throw new HttpsError('internal', `Failed to create Firebase Auth user: ${c?.message || 'unknown error'}`);
        }
      }
      isNewAccount = true;
      if (input.passwordMode === 'generate') {
        generatedPassword = password;
      }
    }

    // Step 2 — short-circuit when the email already had a user and the
    // recruiter hasn't opted into a merge yet.
    if (alreadyExists && input.mergeMode === 'fail') {
      const snap = await db.doc(`users/${userRecord.uid}`).get();
      const existing = snap.exists ? (snap.data() as Record<string, unknown>) : null;
      logger.info('[adminCreateWorker] alreadyExists short-circuit', {
        tenantId: input.tenantId,
        uid: userRecord.uid,
        callerUid,
      });
      return {
        ok: true,
        uid: userRecord.uid,
        alreadyExists: true,
        userDocWritten: false,
        claimsWritten: false,
        preMergeProfile: existing,
        summary: {
          displayName:
            (existing?.displayName as string | undefined) ||
            userRecord.displayName ||
            input.email,
          email: input.email,
          phoneE164: normalizePhoneToE164(input.phone ?? null),
          tenantRoleApplied: { role: input.role, securityLevel: input.securityLevel },
          entityHired: null,
        },
      };
    }

    // Step 3 — write users/{uid}
    const existingSnap = alreadyExists ? await db.doc(`users/${userRecord.uid}`).get() : null;
    const existingDoc =
      existingSnap && existingSnap.exists ? (existingSnap.data() as Record<string, unknown>) : null;
    const patch = buildUserDocPatch({
      input,
      callerUid,
      isNewAccount,
      mergeMode: input.mergeMode,
      existingDoc,
    });
    await db.doc(`users/${userRecord.uid}`).set(patch, { merge: true });

    // Step 4 — apply custom claims for the tenant role.
    let claimsWritten = false;
    try {
      await applyTenantClaims({
        uid: userRecord.uid,
        tenantId: input.tenantId,
        role: input.role,
        securityLevel: input.securityLevel,
      });
      claimsWritten = true;
    } catch (e: unknown) {
      // Non-blocking: Firestore-first surfaces (everee, accusource, recruiter
      // tools) all read tenantIds[tid] from Firestore as a fallback when claims
      // aren't synced. Log and continue so the rest of provisioning still happens.
      logger.warn('[adminCreateWorker] setCustomUserClaims failed', {
        tenantId: input.tenantId,
        uid: userRecord.uid,
        error: e instanceof Error ? e.message : String(e),
      });
    }

    // Step 5 — optional hire to entity (writes entity_employments +
    // worker_onboarding, provisions Everee for Everee-enabled entities).
    let pipelineId: string | undefined;
    let entityHired: AdminCreateWorkerResult['summary']['entityHired'] = null;
    let evereeProvisionWarning: string | null | undefined;

    if (input.entityId) {
      try {
        const result = await runStartOnCallEmploymentFlow({
          tenantId: input.tenantId,
          userId: userRecord.uid,
          entityId: input.entityId,
          workerType: input.workerType ?? null,
          initiatedByUid: callerUid,
          triggerSource: 'on_call',
          note: 'admin_create_worker_manual_hire',
          // Admin is doing this in person — no SMS/email auto-send to the worker.
          // The Everee embed step in the wizard handles payroll setup live.
          suppressNotifications: true,
          // We just wrote tenantIds for this user, so `assertWorkerTenantMembership`
          // in the on-call flow will pass. Asserting on-call eligibility is the
          // right safety check for a manual hire too — same data model.
          enforceOnCallOnboardingPolicy: true,
        });
        pipelineId = result.pipelineId;
        entityHired = { entityId: input.entityId, entityName: result.entityName };
        evereeProvisionWarning = result.evereeProvisionWarning ?? null;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.error('[adminCreateWorker] runStartOnCallEmploymentFlow failed', {
          tenantId: input.tenantId,
          uid: userRecord.uid,
          entityId: input.entityId,
          error: msg,
        });
        // Surface as a warning so the recruiter can retry from the wizard
        // without losing the just-created HRX account. Don't let a hire
        // failure roll back the user creation.
        evereeProvisionWarning = `Could not hire to entity: ${msg}`;
      }
    }

    logger.info('[adminCreateWorker] complete', {
      tenantId: input.tenantId,
      uid: userRecord.uid,
      callerUid,
      isNewAccount,
      alreadyExists,
      mergeMode: input.mergeMode,
      pipelineId: pipelineId ?? null,
      claimsWritten,
      durationMs: Date.now() - start,
    });

    return {
      ok: true,
      uid: userRecord.uid,
      alreadyExists,
      ...(generatedPassword ? { generatedPassword } : {}),
      userDocWritten: true,
      claimsWritten,
      ...(pipelineId ? { pipelineId } : {}),
      ...(evereeProvisionWarning !== undefined ? { evereeProvisionWarning } : {}),
      preMergeProfile: existingDoc,
      summary: {
        displayName: `${input.firstName} ${input.lastName}`.trim(),
        email: input.email,
        phoneE164: normalizePhoneToE164(input.phone ?? null),
        tenantRoleApplied: { role: input.role, securityLevel: input.securityLevel },
        entityHired,
      },
    };
  },
);
