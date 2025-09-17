# Phase 2 — Auth, Roles & Security Levels (Cursor Spec)

**Goal:** Move role/security enforcement to **Firebase custom claims**, make roles **tenant-scoped**, and harden Firestore rules + UI guards so your in‑house team and external workers can safely log in to the same app with different visibility.

---

## 0) Terminology & Scope

- **Tenants collection**: `tenants/{tenantId}` (you already use this).
- **Users collection**: `users/{uid}` stores profile data only; **not** a source of truth for authorization.
- **Authorization source of truth**: **Firebase custom claims** on the ID token.
- **Tenant‑scoped roles**: A user can have different roles per tenant (e.g., `C1` = `Recruiter`, `ClientA` = `Viewer`).

We do **not** remove your existing `role`/`securityLevel` fields in user docs yet; we simply stop trusting them for access control. We’ll keep them as display-only / fallback for now.

---

## 1) Claims Schema

We will encode roles + security levels per tenant into a single `tenants` map claim, plus an optional `hrx` flag for first‑party HRX superusers.

```jsonc
// Example of auth token claims (decoded)
{
  "uid": "abc123",
  "email": "recruiter@c1staffing.com",
  "hrx": false,                 // true = HRX platform staff (platform-wide access)
  "tenants": {
    "BCiP2bQ9CgVOCTfV6MhD": {   // tenantId
      "role": "Recruiter",      // one of: HRXAdmin | AgencyAdmin | Recruiter | Manager | Customer | Worker | Viewer
      "sec": 5                  // SecurityLevel as an integer 1–5 (5 = most privileged in-tenant)
    },
    "clientTenant123": {
      "role": "Customer",
      "sec": 3
    }
  },
  "ver": 1                      // bump to invalidate tokens after breaking changes
}
```

### Role vocabulary (recommended)
- `HRXAdmin` (platform staff)
- `AgencyAdmin` (C1 leadership / admins at the staffing agency)
- `Recruiter` (core recruiting privileges)
- `Manager` (hiring manager at a client)
- `Customer` (general customer user)
- `Worker` (flex worker / employee)
- `Viewer` (read‑only collaborator)

> Keep using your `AccessRoles` helper, but pivot it to read **claims** rather than Firestore user doc fields.

---

## 2) Cloud Function — `setTenantRole` (secure, idempotent)

Create a **callable** function (Gen2) that:
- Checks the **caller** has `hrx: true` **or** is `AgencyAdmin` in the target tenant.
- Sets **custom claims** for the target user in the specified tenant.
- Optionally writes a soft mirror into `users/{uid}.tenantIds[tenantId]` for UI hints (not used for auth).

**File:** `functions/src/auth/setTenantRole.ts`

```ts
import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';

// Callable input type
type SetTenantRoleInput = {
  targetUid: string;
  tenantId: string;
  role: 'HRXAdmin' | 'AgencyAdmin' | 'Recruiter' | 'Manager' | 'Customer' | 'Worker' | 'Viewer';
  sec?: number; // 1–5, default 3
};

export const setTenantRole = functions
  .region('us-central1')
  .https.onCall(async (data: SetTenantRoleInput, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Auth required.');
    }

    const callerUid = context.auth.uid;
    const callerToken = await admin.auth().verifyIdToken(context.auth.token, true);
    const callerIsHRX = !!callerToken.hrx;
    const { tenantId, targetUid, role, sec = 3 } = data;

    if (!tenantId || !targetUid || !role) {
      throw new functions.https.HttpsError('invalid-argument', 'tenantId, targetUid, role required.');
    }

    // If not HRX, require AgencyAdmin in the same tenant
    if (!callerIsHRX) {
      const callerTenants = (callerToken.tenants || {}) as Record<string, { role: string; sec: number }>;
      const callerInTenant = callerTenants[tenantId];
      if (!callerInTenant || callerInTenant.role !== 'AgencyAdmin') {
        throw new functions.https.HttpsError('permission-denied', 'Requires HRX or AgencyAdmin in tenant.');
      }
    }

    const user = await admin.auth().getUser(targetUid);
    const existing = (user.customClaims || {}) as any;

    const nextClaims = {
      ...existing,
      tenants: {
        ...(existing.tenants || {}),
        [tenantId]: { role, sec }
      },
      ver: typeof existing.ver === 'number' ? existing.ver : 1
    };

    await admin.auth().setCustomUserClaims(targetUid, nextClaims);

    // Optional: reflect to Firestore (display-only, not for auth decisions)
    await admin.firestore().collection('users').doc(targetUid).set({
      tenantIds: {
        [tenantId]: { role, securityLevel: String(sec) as any }
      }
    }, { merge: true });

    return { ok: true };
  });
```

**Index export** in `functions/src/index.ts`:
```ts
export { setTenantRole } from './auth/setTenantRole';
```

Deploy (Gen2):
```bash
firebase deploy --only functions:setTenantRole
```

---

## 3) Admin script (optional) — batch assign roles

For one-off migrations or seeding dev data.

**File:** `scripts/seed-claims.ts`

```ts
import * as admin from 'firebase-admin';
admin.initializeApp();

async function main() {
  const tenantId = 'BCiP2bQ9CgVOCTfV6MhD'; // your tenant
  const seeds = [
    { uid: 'UID_RECRUITER', role: 'Recruiter', sec: 5 },
    { uid: 'UID_MANAGER', role: 'Manager', sec: 4 },
    { uid: 'UID_WORKER', role: 'Worker', sec: 2 },
  ];

  for (const s of seeds) {
    const u = await admin.auth().getUser(s.uid);
    const claims = (u.customClaims || {}) as any;
    const next = {
      ...claims,
      tenants: { ...(claims.tenants || {}), [tenantId]: { role: s.role, sec: s.sec } },
      ver: typeof claims.ver === 'number' ? claims.ver : 1
    };
    await admin.auth().setCustomUserClaims(s.uid, next);
    console.log('Updated', s.uid);
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
```

Run:
```bash
ts-node scripts/seed-claims.ts
```

---

## 4) Firestore Security Rules (claims‑driven)

**File:** `firestore.rules` (excerpt; merge with your existing where noted)

```firestore
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Helper functions
    function isSignedIn() { return request.auth != null; }
    function claims() { return request.auth.token; }
    function isHRX() { return isSignedIn() && (claims().hrx == true); }
    function inTenant(tenantId) { return isSignedIn() && (tenantId in claims().tenants); }
    function role(tenantId) { return isSignedIn() ? claims().tenants[tenantId].role : null; }
    function sec(tenantId)  { return isSignedIn() ? claims().tenants[tenantId].sec : 0; }

    // Tenants
    match /tenants/{tenantId} {
      allow read: if isHRX() || inTenant(tenantId);
      allow write: if isHRX() || (inTenant(tenantId) && role(tenantId) in ['AgencyAdmin']);

      // job_orders
      match /job_orders/{jobId} {
        allow read: if isHRX() || inTenant(tenantId);
        allow create, update, delete:
          if isHRX() ||
             (inTenant(tenantId) && role(tenantId) in ['AgencyAdmin', 'Recruiter']);
      }

      // applications
      match /applications/{appId} {
        allow read: if isHRX() || inTenant(tenantId);
        allow create, update:
          if isHRX() ||
             (inTenant(tenantId) && role(tenantId) in ['Recruiter', 'AgencyAdmin', 'Manager']);
        allow delete:
          if isHRX() || (inTenant(tenantId) && role(tenantId) in ['AgencyAdmin']);
      }

      // userGroups
      match /userGroups/{groupId} {
        allow read: if isHRX() || inTenant(tenantId);
        allow write:
          if isHRX() || (inTenant(tenantId) && role(tenantId) in ['AgencyAdmin', 'Recruiter']);
      }
    }

    // Users (profile only; never trust for auth)
    match /users/{uid} {
      allow read: if isSignedIn() && (request.auth.uid == uid || isHRX());
      allow write: if isSignedIn() && request.auth.uid == uid;
    }
  }
}
```

> **Tip:** If you keep some legacy locations (e.g., `recruiter_*` collections), include read‑only rules to avoid breakage during migration, but steer all **writes** to the new paths.

---

## 5) Frontend — AuthProvider changes (trust claims)

- Continue fetching `/users/{uid}` for profile data, avatar, etc., **but** compute `role/securityLevel/tenantIds` from **ID token** claims.
- When the app starts, **force a token refresh** to pick up new claims after admin changes:
  ```ts
  await auth.currentUser?.getIdToken(true);
  ```

**Key changes in your `AuthProvider`:**

- Replace places that read `userDoc.role` / `userDoc.securityLevel` with a helper that reads from `idTokenResult.claims.tenants[activeTenantId]`.
- If user is `hrx: true`, set `orgType='HRX'` and `accessRole='hrx_admin'` (or your mapping).
- Maintain `activeTenant` from:
  - `userDoc.activeTenantId` if present, else
  - the first tenant in `claims.tenants`, else
  - `null` if HRX user without a tenant.

Example helper:
```ts
import { auth } from '../firebase';

export async function readClaims() {
  const u = auth.currentUser;
  if (!u) return null;
  const res = await u.getIdTokenResult(true);
  return res.claims as any; // { hrx?: boolean, tenants?: {...}, ver?: number }
}
```

Then in your `onAuthStateChanged` effect, after obtaining the user:
```ts
const claims = await readClaims();
const isHRX = !!claims?.hrx;
const tenantsMap = (claims?.tenants || {}) as Record<string, { role: string; sec: number }>;
const tenantIds = Object.keys(tenantsMap);

setOrgType(isHRX ? 'HRX' : 'Tenant');
setTenantIds(tenantIds);
const activeTenantId = userDoc.activeTenantId || tenantIds[0];
setActiveTenant(activeTenantId ? { id: activeTenantId } : null);

if (activeTenantId && tenantsMap[activeTenantId]) {
  setRole(tenantsMap[activeTenantId].role as any);
  setSecurityLevel(String(tenantsMap[activeTenantId].sec) as any);
} else if (isHRX) {
  setRole('HRXAdmin' as any);
  setSecurityLevel('5' as any);
}
```

> Keep your `getAccessRole(role, securityLevel)` but ensure it maps the **new role names** as above.

---

## 6) UI Guards & Menu Visibility

- **Menu:** Show/hide top‑level items by `accessRole` or explicit role checks:
  - `Recruiter | AgencyAdmin | HRXAdmin` → show `Recruiter`, `Job Orders`, `Applications`, `Pipeline`.
  - `Customer | Manager` → limited: maybe `Job Orders (read)`, `Candidates (masked)`.
  - `Worker` → only `Workforce / My Jobs / Timesheets`.
- **Routes:** Add a `RequireRoles` wrapper:
  ```tsx
  <RequireRoles anyOf={['Recruiter','AgencyAdmin','HRXAdmin']}>
    <RecruiterArea />
  </RequireRoles>
  ```
- **Record visibility:** Gate editing controls (buttons, inline forms) using the same role checks so your UI matches rules.

---

## 7) Invite / Convert Flow (Workers & Internal Staff)

### A) Invite worker (from Workforce → Add Worker)
1. Recruiter/Manager fills the “Add Worker” form.
2. Backend (or callable) creates:
   - `users/{uid}` doc with profile fields.
   - Assigns claims for the **current tenant**: `{ role: 'Worker', sec: 2 }` via `setTenantRole`.
   - Sends a sign‑in link or password reset email.
3. Worker signs in → token contains the right claims → sees “Worker” UI only.

### B) Invite internal staff (C1 team)
- Use the **same** flow but assign `AgencyAdmin` or `Recruiter` in **C1 tenant**.
- If they also support a client on‑site, grant an additional `tenantId` in claims with `Manager` or `Viewer` role.

---

## 8) Testing Checklist

1. **Rules unit test** (use Firebase Emulator):
   - User with `Recruiter` in `tenantA` can create `tenants/tenantA/job_orders/*`.
   - Same user **cannot** write into `tenantB`.
   - `Worker` in `tenantA` can read basic data but cannot write job orders or userGroups.
2. **Token refresh** after role change:
   - Call `setTenantRole` for a user, then sign in as that user and ensure `getIdToken(true)` updates UI visibility.
3. **Multi‑tenant switch**:
   - User with two tenants → switch `activeTenant` and verify role/security updates in context.
4. **HRX user**:
   - `hrx: true` without tenant → can view admin dashboards, no tenant writes unless intended.
5. **Backfill** (optional):
   - Mirror `users/{uid}.tenantIds` to help quick UI lists (not used for auth).

---

## 9) Rollback Plan

- Claims are additive: revert by clearing the tenant entry and bumping `ver` (forces logout on next token refresh):
  ```ts
  const u = await admin.auth().getUser(uid);
  const cc = (u.customClaims || {}) as any;
  delete cc.tenants[tenantId];
  cc.ver = (cc.ver || 1) + 1;
  await admin.auth().setCustomUserClaims(uid, cc);
  ```
- Keep your current rules file as a backup branch. You can temporarily relax write checks to debug—just revert immediately after.

---

## 10) What Cursor Should Do (copy/paste)

1. **Create function** `functions/src/auth/setTenantRole.ts` as above; export in `functions/src/index.ts` and deploy.
2. **Add** `scripts/seed-claims.ts` for batch role assignment (optional for dev).
3. **Update** `firestore.rules` with the claims‑driven rules (merge carefully).
4. **Modify** `src/context/AuthContext.tsx` (AuthProvider):
   - Read roles/security **from claims**.
   - Maintain `activeTenant` as before, but default to the first tenant in claims.
   - Keep profile data from `/users/{uid}` (avatar, name) but do **not** trust role/security there.
5. **Add** simple `RequireRoles` HOC for routes/buttons and wire menus accordingly.
6. **Implement** the invite path to call `setTenantRole` when adding a worker/internal staff.

That’s it—this locks authorization to tokens, unifies your multi‑tenant model, and keeps the UI in sync.
