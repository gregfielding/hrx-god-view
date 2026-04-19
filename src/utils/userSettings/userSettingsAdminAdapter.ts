/**
 * Admin user-record settings — single normalization layer for Firestore `users/{uid}` ↔ admin UI ↔ worker UI.
 *
 * -----------------------------------------------------------------------------
 * CANONICAL EDITABLE (user / worker-facing, persisted on user doc)
 * -----------------------------------------------------------------------------
 * - `preferredLanguage` — `'en' | 'es'`
 * - `notificationSettings.emailNotifications` — boolean
 * - `notificationSettings.pushNotifications` — boolean
 * - `notificationSettings.smsNotifications` — boolean (mirror of “SMS on” in UI; kept in sync with opt-in when saving)
 * - `notificationSettings.marketingEmails` — boolean
 * - `smsOptIn` — compliance / explicit opt-in for SMS (worker + admin saves align this with the SMS toggle)
 *
 * All worker-preference writes MUST go through `buildWorkerPreferenceUpdatePayload` — do not hand-build Firestore
 * payloads in `SystemAccessTab` or elsewhere.
 *
 * -----------------------------------------------------------------------------
 * CANONICAL SYSTEM-MANAGED / READ-ONLY (not toggled as “preferences” here)
 * -----------------------------------------------------------------------------
 * - `phoneVerified` — verification pipeline
 * - `smsBlockedSystem` — Twilio STOP, compliance hard block; never set `true` from admin preference saves
 * - Push tokens — `users/{uid}/pushTokens/*` subcollection (FCM web); optional legacy `pushTokens` array on user doc
 * - `tenants/{tenantId}/notificationSettings/{uid}` — tenant-level channel overrides (messaging orchestrator)
 *
 * -----------------------------------------------------------------------------
 * SEMANTICS (SMS — do not collapse to one field)
 * -----------------------------------------------------------------------------
 * - `notificationSettings.smsNotifications` — **user preference** (“I want SMS”) stored on the doc.
 * - `smsOptIn` — **compliance / opt-in state** aligned with preference when users save via worker or admin adapter.
 * - `smsBlockedSystem` — **hard block** (STOP, compliance); delivery is suppressed regardless of preference until cleared.
 * - **Effective SMS deliverability** is derived from preference + opt-in + block + routing; not from a single boolean.
 *
 * Email/push: user preferences exist on the doc; **unified messaging** may also apply tenant overrides and server
 * rules. Diagnostics below state this honestly where enforcement is incomplete.
 */

import type { Firestore } from 'firebase/firestore';
import { collection, doc, getDoc, getDocs, limit, query, serverTimestamp } from 'firebase/firestore';

// --- Types: editable preferences (worker ↔ admin) ---

export type EditableWorkerPreferences = {
  preferredLanguage: 'en' | 'es';
  emailNotifications: boolean;
  pushNotifications: boolean;
  smsNotifications: boolean;
  marketingEmails: boolean;
};

export type PhoneVerificationLabel = 'verified' | 'unverified' | 'unknown';

export type PushTokenPresence = 'present' | 'none' | 'unknown';

/** Normalized effective channel outcome for read-only admin diagnostics. */
export type EffectiveChannelState = {
  state: 'enabled' | 'disabled' | 'blocked' | 'unknown';
  /** Short label for the row, e.g. "Enabled", "Blocked" */
  headline: string;
  /** Human-readable detail (no raw field dumps). */
  reason: string;
};

function notificationSettingsMap(data: Record<string, unknown>): Record<string, unknown> {
  const ns = data.notificationSettings;
  if (ns && typeof ns === 'object') return ns as Record<string, unknown>;
  return {};
}

// --- Phone ---

export function getPhoneVerificationStatus(data: Record<string, unknown>): PhoneVerificationLabel {
  if (data.phoneVerified === true) return 'verified';
  if (data.phoneVerified === false) return 'unverified';
  return 'unknown';
}

// --- Effective delivery (diagnostics only; not persisted) ---

/**
 * Effective SMS: preference + opt-in + system block. Order: block → opt-out → preference off → ready.
 */
export function getEffectiveSmsDeliveryState(data: Record<string, unknown>): EffectiveChannelState {
  const ns = notificationSettingsMap(data);
  const prefOn = ns.smsNotifications !== false;
  const blocked = data.smsBlockedSystem === true;
  const optedOut = data.smsOptIn === false;

  if (blocked) {
    return {
      state: 'blocked',
      headline: 'Blocked',
      reason: 'System block active (e.g. STOP / compliance). Delivery suppressed until cleared.',
    };
  }
  if (optedOut) {
    return {
      state: 'disabled',
      headline: 'Disabled',
      reason: 'User opted out (smsOptIn).',
    };
  }
  if (!prefOn) {
    return {
      state: 'disabled',
      headline: 'Disabled',
      reason: 'Preference off in notification settings.',
    };
  }
  return {
    state: 'enabled',
    headline: 'Enabled',
    reason: 'Ready to receive SMS — preference on, not blocked, opted in. Routing still follows server rules.',
  };
}

export type TenantOverrideDoc = Record<string, unknown> | null;

/**
 * Email: user preference + optional tenant override. Messaging backend may not gate purely on `emailNotifications`;
 * we surface that honestly in `reason` when relevant.
 */
export function getEffectiveEmailDeliveryState(
  data: Record<string, unknown>,
  tenantOverride: TenantOverrideDoc,
): EffectiveChannelState {
  const ns = notificationSettingsMap(data);
  const prefOn = ns.emailNotifications !== false;

  if (!prefOn) {
    return {
      state: 'disabled',
      headline: 'Disabled',
      reason: 'Preference off in notification settings.',
    };
  }

  if (tenantOverride && tenantOverride.emailEnabled === false) {
    return {
      state: 'disabled',
      headline: 'Disabled',
      reason: 'Tenant override turns email off for this user. Preference alone does not guarantee delivery.',
    };
  }

  if (tenantOverride) {
    return {
      state: 'enabled',
      headline: 'Enabled',
      reason:
        'Preference enabled; tenant override document present — delivery also follows tenant rules and messaging backend (server may not gate solely on this user flag).',
    };
  }

  return {
    state: 'enabled',
    headline: 'Enabled',
    reason:
      'Preference enabled; delivery also depends on tenant rules and messaging backend (full enforcement may vary by message type).',
  };
}

export type PushDiagnosticsInput = {
  /** Result of `fetchPushTokenPresence` (subcollection probe). */
  subcollectionState: PushTokenPresence;
  legacyUserDocArray: boolean;
};

/**
 * Push: preference + device token presence + optional tenant override. Unknown if subcollection read failed.
 */
export function getEffectivePushDeliveryState(
  data: Record<string, unknown>,
  input: PushDiagnosticsInput,
  tenantOverride: TenantOverrideDoc,
): EffectiveChannelState {
  const ns = notificationSettingsMap(data);
  const prefOn = ns.pushNotifications !== false;
  const hasToken = input.subcollectionState === 'present' || input.legacyUserDocArray;

  if (input.subcollectionState === 'unknown') {
    return {
      state: 'unknown',
      headline: 'Unknown',
      reason: 'Could not read push token storage. Check permissions or network.',
    };
  }

  if (!prefOn) {
    return {
      state: 'disabled',
      headline: 'Disabled',
      reason: 'Preference off in notification settings.',
    };
  }

  if (!hasToken) {
    return {
      state: 'disabled',
      headline: 'No device token',
      reason: 'Preference on but no FCM token registered (subcollection empty; legacy array absent).',
    };
  }

  if (tenantOverride && tenantOverride.pushEnabled === false) {
    return {
      state: 'disabled',
      headline: 'Disabled',
      reason: 'Tenant override turns push off for this user.',
    };
  }

  return {
    state: 'enabled',
    headline: 'Enabled',
    reason: input.legacyUserDocArray && input.subcollectionState === 'none'
      ? 'Preference on; legacy user doc token list present (subcollection empty). Delivery follows routing rules.'
      : 'Preference on with at least one device token. Delivery follows routing rules.',
  };
}

/** @deprecated Use `getEffectiveSmsDeliveryState` for SMS row; kept for any legacy imports. */
export type ReadOnlyNotificationDiagnosticsSync = {
  phoneVerification: PhoneVerificationLabel;
  smsComplianceLabel: string;
  smsComplianceDescription: string;
};

export function getReadOnlyNotificationDiagnosticsSync(data: Record<string, unknown>): ReadOnlyNotificationDiagnosticsSync {
  const sms = getEffectiveSmsDeliveryState(data);
  return {
    phoneVerification: getPhoneVerificationStatus(data),
    smsComplianceLabel: sms.headline,
    smsComplianceDescription: sms.reason,
  };
}

export const getReadOnlyNotificationDiagnosticsFromUserDoc = getReadOnlyNotificationDiagnosticsSync;

/**
 * Same derivation as worker `profileSection` / `PrivacySettings` for **editable** form state (SMS toggle reflects
 * effective opt-in ∧ ¬block, not raw `notificationSettings.smsNotifications` alone).
 */
export function getEditableWorkerPreferencesFromUserDoc(data: Record<string, unknown>): EditableWorkerPreferences {
  const ns = notificationSettingsMap(data);
  const smsEnabled = data.smsOptIn !== false && data.smsBlockedSystem !== true;
  return {
    preferredLanguage: String(data.preferredLanguage || '').toLowerCase() === 'es' ? 'es' : 'en',
    emailNotifications: typeof ns.emailNotifications === 'boolean' ? ns.emailNotifications : true,
    pushNotifications: typeof ns.pushNotifications === 'boolean' ? ns.pushNotifications : true,
    smsNotifications: smsEnabled,
    marketingEmails: typeof ns.marketingEmails === 'boolean' ? ns.marketingEmails : false,
  };
}

/**
 * Single write path for worker preference saves (admin Settings tab). Merges `notificationSettings` so legacy keys
 * are not wiped.
 */
export function buildWorkerPreferenceUpdatePayload(
  existingUserDoc: Record<string, unknown>,
  next: EditableWorkerPreferences,
): Record<string, unknown> {
  const existingNs =
    existingUserDoc.notificationSettings && typeof existingUserDoc.notificationSettings === 'object'
      ? { ...(existingUserDoc.notificationSettings as Record<string, unknown>) }
      : {};
  const mergedNotificationSettings = {
    ...existingNs,
    emailNotifications: next.emailNotifications,
    pushNotifications: next.pushNotifications,
    marketingEmails: next.marketingEmails,
    smsNotifications: next.smsNotifications,
  };
  const payload: Record<string, unknown> = {
    preferredLanguage: next.preferredLanguage,
    notificationSettings: mergedNotificationSettings,
    updatedAt: serverTimestamp(),
    smsOptIn: next.smsNotifications,
  };
  if (next.smsNotifications) {
    payload.smsBlockedSystem = false;
  }
  return payload;
}

export async function fetchPushTokenPresence(db: Firestore, uid: string): Promise<PushTokenPresence> {
  try {
    const q = query(collection(db, 'users', uid, 'pushTokens'), limit(1));
    const snap = await getDocs(q);
    return snap.empty ? 'none' : 'present';
  } catch {
    return 'unknown';
  }
}

export type TenantOverrideSummary = {
  present: boolean;
  /** One line for admin UI */
  summaryLine: string;
  rawData: Record<string, unknown> | null;
};

/**
 * Inspects `tenants/{tenantId}/notificationSettings/{uid}` when present — cheap summary only.
 */
export async function fetchTenantNotificationOverrideSummary(
  db: Firestore,
  tenantId: string | null | undefined,
  uid: string,
): Promise<TenantOverrideSummary> {
  if (!tenantId) {
    return { present: false, summaryLine: 'N/A — no tenant context', rawData: null };
  }
  try {
    const ref = doc(db, 'tenants', tenantId, 'notificationSettings', uid);
    const d = await getDoc(ref);
    if (!d.exists()) {
      return { present: false, summaryLine: 'No tenant-scoped override document', rawData: null };
    }
    const data = d.data() as Record<string, unknown>;
    const emailOn = data.emailEnabled !== false;
    const smsOn = data.smsEnabled !== false;
    const pushOn = data.pushEnabled !== false;
    const perType = data.channelsAllowedPerType;
    const hasPerType =
      perType && typeof perType === 'object' && Object.keys(perType as Record<string, unknown>).length > 0;

    if (hasPerType) {
      return {
        present: true,
        summaryLine: 'Tenant override present (per–message-type routing)',
        rawData: data,
      };
    }
    if (!emailOn || !smsOn || !pushOn) {
      return {
        present: true,
        summaryLine: 'Tenant override present (some channels off or restricted)',
        rawData: data,
      };
    }
    return {
      present: true,
      summaryLine: 'Tenant override present (channel toggles at defaults)',
      rawData: data,
    };
  } catch {
    return { present: false, summaryLine: 'Could not load tenant override', rawData: null };
  }
}

/** @deprecated Prefer `fetchTenantNotificationOverrideSummary`. */
export async function fetchTenantNotificationOverridePresent(
  db: Firestore,
  tenantId: string | null | undefined,
  uid: string,
): Promise<boolean> {
  const s = await fetchTenantNotificationOverrideSummary(db, tenantId, uid);
  return s.present;
}

export function getLegacyPushTokensArrayPresence(data: Record<string, unknown>): boolean {
  return Array.isArray(data.pushTokens) && data.pushTokens.length > 0;
}

/**
 * Dev-only: log suspicious combinations that indicate doc drift or confusing state. Never show to end users.
 */
export function warnAdminSettingsDriftInDev(params: {
  userDoc: Record<string, unknown>;
  tenantSummary: TenantOverrideSummary;
  pushSubcollection: PushTokenPresence;
  legacyPushArray: boolean;
}): void {
  if (process.env.NODE_ENV !== 'development') return;
  const { userDoc, tenantSummary, pushSubcollection, legacyPushArray } = params;
  const ns = notificationSettingsMap(userDoc);
  const smsPref = ns.smsNotifications !== false;

  if (userDoc.smsBlockedSystem === true && smsPref) {
    // eslint-disable-next-line no-console
    console.warn(
      '[hrx admin settings drift] notificationSettings.smsNotifications suggests on but smsBlockedSystem is true — delivery blocked until STOP cleared.',
    );
  }
  if (userDoc.smsOptIn === false && smsPref) {
    // eslint-disable-next-line no-console
    console.warn('[hrx admin settings drift] smsNotifications true but smsOptIn false — inconsistent doc.');
  }
  if (ns.pushNotifications !== false && pushSubcollection === 'none' && !legacyPushArray) {
    // eslint-disable-next-line no-console
    console.warn('[hrx admin settings drift] push preference on but no FCM tokens found (subcollection + legacy).');
  }

  const raw = tenantSummary.rawData;
  if (raw) {
    if (raw.emailEnabled === false && ns.emailNotifications !== false) {
      // eslint-disable-next-line no-console
      console.warn(
        '[hrx admin settings drift] user email preference on but tenant override has emailEnabled false — tenant may suppress email.',
      );
    }
    if (raw.pushEnabled === false && ns.pushNotifications !== false) {
      // eslint-disable-next-line no-console
      console.warn(
        '[hrx admin settings drift] user push preference on but tenant override has pushEnabled false — tenant may suppress push.',
      );
    }
    if (raw.smsEnabled === false && ns.smsNotifications !== false && userDoc.smsBlockedSystem !== true) {
      // eslint-disable-next-line no-console
      console.warn(
        '[hrx admin settings drift] user SMS preference on but tenant override has smsEnabled false — tenant may suppress SMS.',
      );
    }
  }
}
