# User settings & notifications — schema-first audit

**Repo:** `hrx-god-view`  
**Date:** 2026-04-19  
**Scope:** Read-only audit of worker-facing UI, Firestore fields, admin **Settings** tab (`SystemAccessTab`), and Cloud Functions messaging behavior. **No UI or migration changes** are part of this document.

---

## Executive summary

- **Worker-facing “truth” for day-to-day preferences** is split across two surfaces: the **C1 worker profile “App language” section** (`profileSection.tsx`) and the standalone **`/privacy-settings`** page (`PrivacySettings.tsx`). They do not expose the same fields.
- The **admin user-record Settings tab** (`SystemAccessTab.tsx`) edits a **large superset** of fields (location precision, notification “types,” per-user quiet hours, AI/analytics toggles, plus tenant security level / module access). Much of this **does not appear on the worker’s narrower “App language” screen** and **does not align** with how **unified messaging** resolves channels in Cloud Functions.
- **`notificationSettings` on `users/{uid}` has competing shapes**: workers save a **flat** object (`emailNotifications`, `pushNotifications`, …); `functions/src/utils/notificationSettings.ts` expects a **nested** `{ sms, push, inApp }` model for orchestrator defaults. The orchestrator **does not** read `notificationSettings.emailNotifications` for email gating (see §3).
- **Per-user quiet hours** stored under `users/{uid}.notificationSettings.quietHours` are **not referenced** under `functions/src/messaging/`. **Tenant** quiet hours (`tenants/{tenantId}/messagingConfig/quietHours`) **are** used by `isQuietHours()`.
- **`PrivacySettingsTab.tsx`** duplicates a similar UI to `SystemAccessTab`’s privacy blocks but appears **unused** in the app (no imports found outside the file and docs).

---

## 1. Worker-facing settings UI

### 1.1 C1 worker profile — “App language” (`src/pages/c1/workers/profileSection.tsx`)

| Area | Route / section | UI label (via i18n) | Backing field(s) on `users/{uid}` | Worker edit? | Notes |
|------|-----------------|---------------------|-------------------------------------|----------------|-------|
| App language | `/c1/workers/profile/app-language` (also `/c1/workers/profile/settings` → redirect) | `profile.sectionAppLanguageTitle` / English · Spanish | `preferredLanguage` (`en` \| `es`) | Yes | `Select` → `handlePreferredLanguageChange` → `updateDoc` |
| Email notifications | same | `workerSettings.emailNotifications` | `notificationSettings.emailNotifications` | Yes | Flat under `notificationSettings` |
| Push notifications | same | `workerSettings.pushNotifications` | `notificationSettings.pushNotifications` | Yes | Flat |
| SMS notifications | same | `workerSettings.smsNotifications` | **Derived read:** `smsOptIn !== false && smsBlockedSystem !== true`; **write:** `notificationSettings.*`, `smsOptIn`, `smsBlockedSystem` | Yes | Toggle persists `smsOptIn` / clears `smsBlockedSystem` when enabling |
| Marketing emails | same | `workerSettings.marketingEmails` | `notificationSettings.marketingEmails` | Yes | |
| Phone verification | same | `profile.phoneVerification` | `phoneVerified` (display only) | **Read-only** | Copy explains SMS; not a toggle |

**Save path:** `updateAccountSettings` → `updateDoc(users/{uid}, { notificationSettings, preferredLanguage?, smsOptIn, smsBlockedSystem?, updatedAt })`.

### 1.2 Standalone privacy & notifications page (`src/pages/PrivacySettings.tsx`)

| Area | UI label (i18n) | Backing field(s) | Worker edit? | Notes |
|------|-----------------|------------------|--------------|-------|
| Preferred message language | `workerSettings.preferredMessageLanguage` | `preferredLanguage` | Yes | Same root field as §1.1 |
| Email / Push / SMS | `workerSettings.emailNotifications` etc. | `notificationSettings` + SMS derived as above | Yes | Loads `userData.notificationSettings`, overrides SMS from `smsOptIn` / `smsBlockedSystem` |
| Marketing emails | `workerSettings.marketingEmails` | `notificationSettings.marketingEmails` | Yes | |
| Privacy card | Profile visibility, show contact, show schedule, data analytics, location sharing | `privacySettings` (nested) | Yes | **Comment in file (lines 330–331):** stored in Firestore; **“for future use (not yet enforced everywhere)”** |
| Schedule/Assignment/System toggles | *(removed from UI)* | `scheduleUpdates`, `assignmentUpdates`, `systemUpdates` in local TS interface | N/A | Comment: **not wired to messaging backend**; still part of type/default merge risk if saved |

**Route:** `src/App.tsx` → `/privacy-settings` behind `PrivacySettingsAdminShellGate`.

### 1.3 Other worker-adjacent surfaces (not a full “settings” hub)

| Location | What it does |
|----------|----------------|
| `src/components/Layout.tsx` | Internal shell: message language EN/ES for **current user** via `updateDoc` on `preferredLanguage` (not the full worker profile). Comment notes worker privacy/notifications are not for internal shell levels 5–7. |
| `src/pages/c1/workers/profileSection.tsx` — other sections | Preferences for industries/schedules (`buildReadinessIntentWritePatch`), languages array, etc. — **not** the same as notification prefs; out of scope for “notifications” but part of “what workers configure.” |

---

## 2. Admin-facing Settings tab (`src/pages/UserProfile/components/SystemAccessTab.tsx`)

Rendered when **User profile → Settings** tab is selected (`src/pages/UserProfile/index.tsx`).

### 2.1 System Access (tenant-scoped + account)

| Control | Label | Backing field(s) | In worker “App language” UI? | Assessment |
|---------|-------|------------------|------------------------------|------------|
| User ID display | “User ID” | — | N/A | Display |
| Security Level | “Security Level” (0–7 menu) | `tenantIds.{tenantId}.securityLevel` (fallback `securityLevel`) | No | **System / tenant access** — legitimate admin concern |
| Recruiter Access | “Recruiter Access” | `tenantIds.{tenantId}.recruiter` | No | Admin |
| CRM/Sales Access | “CRM/Sales Access” | `tenantIds.{tenantId}.crm_sales` | No | Admin |
| Password reset | “Send Password Reset Email” | Firebase Auth `sendPasswordResetEmail` | No (worker has reset in profile) | Admin convenience |
| Delete User | “Delete User” | Callable `deleteUserCompletely` | No | Destructive admin |

### 2.2 Location Sharing (card)

| Control | Label | Backing field(s) | Worker parity | Assessment |
|---------|-------|------------------|---------------|------------|
| Master toggle | “Enable Location Sharing” | `locationSettings.locationSharingEnabled` | **Partial:** `PrivacySettings.tsx` uses `privacySettings.allowLocationSharing` (different field family) for a **privacy** toggle; not the same UX as admin’s `locationSettings` block | Same **Firestore area** exists on user doc from signup defaults (`AuthContext`), but **worker-facing pages disagree on model** (location under `locationSettings` vs `allowLocationSharing` under `privacySettings`) |
| Precision | “Location Precision” (coarse/fine/precise) | `locationSettings.locationGranularity` | No in §1.1 | Stored; **enforcement not verified** in this audit |
| Update frequency | “Update Frequency” (manual/hourly/realtime) | `locationSettings.locationUpdateFrequency` | No in §1.1 | Stored; **enforcement not verified** |
| Last update | “Last location update: …” | `locationSettings.lastLocationUpdate` | Read-only info | **Derived / telemetry** if present |

### 2.3 Notification Preferences (card)

| Control | Label | Backing field(s) | Worker “App language” parity | Assessment |
|---------|-------|------------------|-------------------------------|------------|
| Push / Email / SMS | “Push / Email / SMS Notifications” | `notificationSettings.pushNotifications`, `emailNotifications`, `smsNotifications` | **Yes** for three channels | Admin can overwrite worker prefs **without** syncing `smsOptIn` / `smsBlockedSystem` when toggling SMS (worker flows **do** sync those) — **behavior mismatch risk** |
| AI Companion / Shift / Safety / Performance | “AI Companion Messages,” “Shift Reminders,” “Safety Alerts,” “Performance Updates” | `notificationSettings.companionMessages`, `shiftReminders`, `safetyAlerts`, `performanceUpdates` | **No** on `profileSection` app-language | **Speculative / productized in Firestore** (defaults in `AuthContext`) but **not** part of worker’s minimal notification UI |
| Quiet hours | “Enable Quiet Hours” + start/end time | `notificationSettings.quietHours.{enabled,startTime,endTime}` | **No** | **Not used** by `functions/src/messaging/quietHours.ts` (tenant config is). Treat as **SPECULATIVE_UI_ONLY** for delivery |

### 2.4 Privacy Controls (card)

| Control | Label | Backing field(s) | Worker parity | Assessment |
|---------|-------|------------------|---------------|------------|
| Show performance metrics | “Show Performance Metrics” | `privacySettings.showPerformanceMetrics` | No in §1.1 | Stored |
| Data analytics | “Allow Data Analytics” | `privacySettings.allowDataAnalytics` | Shown on `/privacy-settings` | **Partial** overlap with worker |
| AI insights | “Allow AI Insights Generation” | `privacySettings.allowAIInsights` | No in §1.1 | Stored |

**Note:** On save, `SystemAccessTab` **forces** `profileVisibility: 'managers'`, `showContactInfo: true`, `showLocation: true` — so **profile visibility / contact / location** are **not** actually free-form in admin despite other components suggesting those fields exist elsewhere.

### 2.5 Email signature (`EmailSignatureTab`)

| Area | File | Assessment |
|------|------|------------|
| Recruiter email signature | `src/pages/UserProfile/components/EmailSignatureTab.tsx` | **Admin/recruiter** feature; **not** worker settings |

### 2.6 Duplicate / orphaned admin component

| File | Assessment |
|------|------------|
| `src/pages/UserProfile/components/PrivacySettingsTab.tsx` | **Orphaned UI** (no route import found). Mirrors location + notifications + privacy. **Do not treat as current admin surface** unless wired later. |

---

## 3. Firestore / data model audit

### 3.1 `users/{uid}` — primary fields

| Domain | Field path | Source of truth | Worker UI? | Admin UI? | Status |
|--------|------------|-----------------|------------|-----------|--------|
| Language | `preferredLanguage` | User doc | Yes (`profileSection`, `PrivacySettings`, `Layout` for self) | No on Settings tab | **ACTIVE_CANONICAL** |
| Notifications (flat) | `notificationSettings.emailNotifications` | User doc | Yes | Yes (`SystemAccessTab`) | **ACTIVE_CANONICAL** (storage) — **email gating in orchestrator not found** (see below) |
| | `notificationSettings.pushNotifications` | User doc | Yes | Yes | **ACTIVE_DERIVED** in functions: nested `push.enabled` defaults from **presence of push tokens** if nested shape missing; flat keys may not map 1:1 |
| | `notificationSettings.smsNotifications` | User doc (display) | Yes (as computed SMS on) | Yes | **ACTIVE_CANONICAL** for display name only; **delivery** uses `smsOptIn` + `smsBlockedSystem` + nested `notificationSettings.sms` in CF helper |
| | `notificationSettings.marketingEmails` | User doc | Yes | **No** on `SystemAccessTab` | **ACTIVE_CANONICAL** (worker/marketing) — **not referenced** in messaging orchestrator grep |
| | `notificationSettings.{companionMessages,shiftReminders,safetyAlerts,performanceUpdates}` | User doc | No (minimal worker UI) | Yes | **SPECULATIVE_UI_ONLY** or **LEGACY** product flags unless a consumer is found outside storage |
| | `notificationSettings.quietHours` | User doc | No (worker app-language) | Yes | **SPECULATIVE_UI_ONLY** vs messaging (tenant quiet hours win) |
| SMS compliance | `smsOptIn` | User doc (+ tenant consent in orchestrator) | Yes (via toggles) | **Not explicitly** on admin SMS switch | **ACTIVE_CANONICAL** |
| | `smsBlockedSystem` | User doc (Twilio STOP) | Reflected in SMS toggle state | No | **SYSTEM_MANAGED** (with worker override to clear when re-enabling) |
| Phone | `phoneVerified`, `phoneVerifiedAt?` | User doc | Read-only in worker UI | Not on Settings tab | **SYSTEM_MANAGED** / verification pipeline |
| Location | `locationSettings.*` | User doc | Partial / conflicting with `privacySettings.allowLocationSharing` | Yes | **ACTIVE_CANONICAL** (storage) — **enforcement UNKNOWN** without mobile/app audit |
| Privacy | `privacySettings.*` | User doc | Yes on `/privacy-settings` | Yes (subset + forced fields on save) | **ACTIVE_CANONICAL** (storage) — **enforcement** per UI comment: **not everywhere** |
| Push tokens | `users/{uid}/pushTokens` subcollection (per orchestrator comment) and/or legacy `pushTokens` array | User / subcollection | N/A for toggles | N/A | **SYSTEM_MANAGED** tokens |

### 3.2 Tenant-scoped notification overrides

| Field path | Source of truth | Worker UI? | Admin UI? | Status |
|------------|-----------------|------------|-----------|--------|
| `tenants/{tenantId}/notificationSettings/{userId}` (`emailEnabled`, `smsEnabled`, `pushEnabled`, `channelsAllowedPerType`) | Tenant subcollection | **No** direct worker editor in audited files | Possibly other admin tools | **ACTIVE_CANONICAL** for **Phase 4** orchestrator (`tenantNotificationSettings.ts`) |

### 3.3 Tenant quiet hours (messaging)

| Field path | Used by | Status |
|------------|---------|--------|
| `tenants/{tenantId}/messagingConfig/quietHours` | `functions/src/messaging/quietHours.ts` → `isQuietHours()` | **ACTIVE_CANONICAL** for **delivery** timing |

### 3.4 Cloud Functions: two `notificationSettings` models

| Location | Model | Status |
|----------|--------|--------|
| `functions/src/utils/notificationSettings.ts` | Nested `NotificationSettings` (`sms` / `push` / `inApp` with per–message-type keys) | **ACTIVE_CANONICAL** for **orchestrator** `getUserNotificationSettings` |
| Worker/admin UIs above | Flat booleans on `users/{uid}.notificationSettings` | **ACTIVE_CANONICAL** for **Firestore document as edited by apps** — **merge behavior**: if nested keys absent, CF derives SMS from `smsOptIn`, push from tokens |

**Email channel:** `routingOrchestrator.ts` does **not** check `notificationSettings.emailNotifications` before allowing email; it checks tenant `emailEnabled` and presence of `userData.email`. So the **worker email toggle is not clearly enforced** by unified messaging in the audited path.

---

## 4. Canonical schema proposal (v1 — practical)

Align **names** with what workers already set, and **separate** “channel prefs,” “compliance,” “marketing,” and “tenant overrides.”

```ts
// Proposed v1 shape (documentation only — not implemented here)
interface UserSettingsV1 {
  language: {
    /** UI + templated messaging */
    preferredLanguage: 'en' | 'es';
  };

  notifications: {
    /** Channel intents persisted from worker UI */
    channels: {
      emailEnabled: boolean;
      pushEnabled: boolean;
      /** Logical “SMS on”; see compliance for actual send eligibility */
      smsEnabled: boolean;
    };
    marketingEmailEnabled: boolean;
  };

  /** SMS legal / Twilio STOP — not duplicated as “preferences” */
  smsCompliance: {
    smsOptIn: boolean;
    smsBlockedSystem: boolean;
  };

  /** Read-only in worker UI; set by verification flow */
  phoneVerification: {
    status: 'verified' | 'unverified';
    verifiedAt?: Timestamp | null;
  };

  /**
   * Optional product flags — only if/when enforced by backend.
   * Consider omitting from admin until enforced.
   */
  extendedNotificationToggles?: {
    companionMessages?: boolean;
    shiftReminders?: boolean;
    safetyAlerts?: boolean;
    performanceUpdates?: boolean;
  };

  /**
   * Tenant-scoped delivery rules (canonical for orchestrator).
   * Lives in subcollection, not necessarily embedded on user doc.
   */
  tenantOverrides?: Record<
    string /** tenantId */,
    {
      emailEnabled: boolean;
      smsEnabled: boolean;
      pushEnabled: boolean;
      channelsAllowedPerType?: Record<string, { email?: boolean; sms?: boolean; push?: boolean }>;
    }
  >;
}
```

**Notification preferences — canonical rule of thumb:**

1. **Transactional messaging** should respect **channel toggles + compliance + tenant overrides** in one documented order (today: tenant subcollection + `smsOptIn` / STOP + nested CF defaults).
2. **Marketing** should be a **separate** boolean (already `marketingEmails`) and never implied by transactional toggles.

---

## 5. Recommendations (four buckets)

### A. Keep in admin (and align with worker truth)

- **Tenant/system access:** `securityLevel`, `recruiter`, `crm_sales` (as today), password reset, delete user — **not** “worker preferences,” but belong on admin record.
- **Mirror worker notification prefs** in a **single** admin subsection: **email / push / SMS / marketing** with the **same** persistence rules as `profileSection` / `PrivacySettings` (including **`smsOptIn` / `smsBlockedSystem`** for SMS).
- **`preferredLanguage`:** show (and optionally allow) to match worker, or read-only if policy requires workers to self-serve.

### B. Show read-only in admin

- **`phoneVerified` / `phoneVerifiedAt`** — verification status for support.
- **Push token presence** (count / last seen) if available from `pushTokens` — helps diagnose “push disabled.”
- **Tenant-scoped** `tenants/.../notificationSettings/{uid}` — read-only or link to whatever admin tool edits Phase 4 settings.

### C. Remove from admin UI (or hide until enforced)

- **Per-user quiet hours** on user doc — **not** used by messaging quiet-hours implementation (tenant config is). **Remove** or replace with a clear “not enforced” disclaimer only if product insists on keeping.
- **Location precision / update frequency / share toggles** — unless product confirms end-to-end enforcement; worker-facing model is **inconsistent** (`locationSettings` vs `privacySettings.allowLocationSharing`).
- **Companion / shift / safety / performance** toggles — **remove** from admin unless mapped to a **single** backend consumer; otherwise they are **noise** relative to worker UI.
- **Privacy: analytics / AI insights / performance metrics visibility** — **remove** from admin **or** match exactly what `/privacy-settings` exposes and document enforcement.

### D. Future / deferred

- **Per-message-type channel matrix** (`channelsAllowedPerType`) — powerful but belongs in **dedicated** messaging consent UX, not duplicated as fake booleans on user record.
- **Nested CF `notificationSettings` (sms/push/inApp)** — reconcile explicitly with flat worker doc (migration or adapter layer) so orchestrator and apps **cannot drift**.

---

## 6. Suggested next steps (implementation — not done in this audit)

1. **Pick one worker “source of truth” screen** for notifications: either consolidate on **`profileSection` app-language** + link to `/privacy-settings` for privacy, or merge flows — **reduce duplicate** `PrivacySettings` vs `profileSection` behavior.
2. **Redesign `SystemAccessTab`** into **System access** (security, modules, destructive actions) vs **Worker-visible preferences** (mirror worker fields only) vs **Read-only diagnostics** (phone verify, tokens, tenant overrides).
3. **Backend pass:** wire **`notificationSettings.emailNotifications`** (and marketing separation) into orchestrator **or** stop exposing toggles; document actual behavior.
4. **Resolve `notificationSettings` shape** (flat vs nested) with an adapter in Cloud Functions or a one-time migration.
5. **Delete or wire `PrivacySettingsTab.tsx`** to avoid three competing implementations.

---

## References (key files)

| Purpose | Path |
|---------|------|
| Worker app-language + notifications | `src/pages/c1/workers/profileSection.tsx` |
| Worker `/privacy-settings` | `src/pages/PrivacySettings.tsx` |
| Admin Settings tab | `src/pages/UserProfile/components/SystemAccessTab.tsx` |
| Orphan duplicate | `src/pages/UserProfile/components/PrivacySettingsTab.tsx` |
| Signup defaults (large `notificationSettings`) | `src/contexts/AuthContext.tsx` |
| CF nested notification merge | `functions/src/utils/notificationSettings.ts` |
| Orchestrator channel checks | `functions/src/messaging/routingOrchestrator.ts` |
| Tenant per-user overrides | `functions/src/messaging/tenantNotificationSettings.ts` |
| Tenant quiet hours | `functions/src/messaging/quietHours.ts` |
| Legacy type (flat + extra keys) | `src/types/UserProfile.ts` |
