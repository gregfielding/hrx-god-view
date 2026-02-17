# HRX / C1 Onboarding Backbone Integration (Phase 1A)
## Cursor Upload — Complete Implementation Guide

Owner: Greg Fielding / HRX One  
Date: 2026-02-17  
Scope: Integrate onboarding backbone into existing assignment creation flow  
Status: Ready for implementation

---

# 0. Purpose

This document provides a **complete, copy‑paste‑ready implementation plan** for integrating
tenant‑scoped onboarding into the existing assignment creation flow.

It is designed to work with your current Firestore structure:

```
tenants/{tenantId}/job_orders/{jobOrderId}
tenants/{tenantId}/applications/{applicationId}
tenants/{tenantId}/assignments/{assignmentId}
```

We will add onboarding using **minimal changes** to your existing logic.

---

# 1. New Tenant‑Scoped Collections

Create (implicitly via writes):

```
tenants/{tenantId}/entities/{entityId}
tenants/{tenantId}/requirement_packages/{packageId}
tenants/{tenantId}/onboarding_instances/{assignmentId}
```

Optional (later):
```
tenants/{tenantId}/user_employments/{employmentId}
tenants/{tenantId}/signature_envelopes/{envelopeId}
```

---

# 2. New Fields

## 2.1 Job Orders

Path:
```
tenants/{tenantId}/job_orders/{jobOrderId}
```

Add:

```ts
entityId: string            // REQUIRED (after migration)
requirementPackageId?: string
```

---

## 2.2 Assignments

Path:
```
tenants/{tenantId}/assignments/{assignmentId}
```

Add:

```ts
entityId: string | null
requirementPackageId: string | null
onboardingInstanceId: string | null
onboardingStatus: "not_started" | "in_progress" | "completed" | "blocked"
onboardingPercent: number
```

⚠️ Do NOT overload `status`. Keep onboarding separate from placement lifecycle.

---

# 3. Integration Point (Confirmed)

Primary assignment creation path:

```
functions/src/placementsApi.ts
→ placementsCreateAssignments
```

Assignment ID format:
```
${shiftId}__${userId}
```

We will hook onboarding here.

---

# 4. Helper Functions (Add to placementsApi.ts)

Add these near the top of the file.

---

## 4.1 resolveOnboardingConfigForJobOrder

```ts
type OnboardingConfig = {
  entityId: string | null;
  requirementPackageId: string | null;
  packageData: any | null;
  blockedReason?: string;
};

async function resolveOnboardingConfigForJobOrder(params: {
  tenantId: string;
  jobOrderId: string;
  jobOrder: any;
}): Promise<OnboardingConfig> {
  const { tenantId, jobOrder } = params;

  const entityId = jobOrder?.entityId || null;
  if (!entityId) {
    return {
      entityId: null,
      requirementPackageId: null,
      packageData: null,
      blockedReason: 'Job order missing entityId',
    };
  }

  const entitySnap = await db.doc(`tenants/${tenantId}/entities/${entityId}`).get();
  if (!entitySnap.exists) {
    return {
      entityId,
      requirementPackageId: null,
      packageData: null,
      blockedReason: `Entity not found: ${entityId}`,
    };
  }

  const entity = entitySnap.data() || {};
  const requirementPackageId =
    jobOrder?.requirementPackageId ||
    entity?.defaultRequirementPackageId ||
    null;

  if (!requirementPackageId) {
    return {
      entityId,
      requirementPackageId: null,
      packageData: null,
      blockedReason: 'No requirementPackageId on job order and no defaultRequirementPackageId on entity',
    };
  }

  const pkgSnap = await db
    .doc(`tenants/${tenantId}/requirement_packages/${requirementPackageId}`)
    .get();

  if (!pkgSnap.exists) {
    return {
      entityId,
      requirementPackageId,
      packageData: null,
      blockedReason: `Requirement package not found: ${requirementPackageId}`,
    };
  }

  return {
    entityId,
    requirementPackageId,
    packageData: pkgSnap.data() || {},
  };
}
```

---

## 4.2 ensureOnboardingInstance

```ts
async function ensureOnboardingInstance(params: {
  tenantId: string;
  assignmentId: string;
  userId: string;
  jobOrderId: string;
  shiftId: string;
  entityId: string | null;
  requirementPackageId: string | null;
  packageData: any | null;
  createdBy: any;
  blockedReason?: string;
}) {
  const {
    tenantId,
    assignmentId,
    userId,
    jobOrderId,
    shiftId,
    entityId,
    requirementPackageId,
    packageData,
    createdBy,
    blockedReason,
  } = params;

  const instRef = db.doc(`tenants/${tenantId}/onboarding_instances/${assignmentId}`);
  const instSnap = await instRef.get();
  if (instSnap.exists) return; // idempotent

  const resolvedSteps = Array.isArray(packageData?.steps) ? packageData.steps : [];
  const resolvedDocuments = Array.isArray(packageData?.documents) ? packageData.documents : [];
  const resolvedChecks = Array.isArray(packageData?.checks) ? packageData.checks : [];

  const status =
    entityId && requirementPackageId && packageData
      ? 'not_started'
      : 'blocked';

  await instRef.set(
    {
      tenantId,
      assignmentId,
      userId,
      jobOrderId,
      shiftId,
      entityId,
      requirementPackageId,

      status,
      percentComplete: 0,

      resolvedSteps,
      resolvedDocuments,
      resolvedChecks,

      blockedReason:
        status === 'blocked'
          ? blockedReason || 'Missing onboarding configuration'
          : null,

      createdBy: createdBy ? { ...createdBy } : null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: false },
  );
}
```

---

# 5. Modify placementsCreateAssignments

## 5.1 Resolve onboarding config once

Add immediately after:

```ts
const jobOrder = jobOrderSnap.data() || {};
const shift = shiftSnap.data() || {};
```

Add:

```ts
const onboardingConfig = await resolveOnboardingConfigForJobOrder({
  tenantId,
  jobOrderId,
  jobOrder,
});
```

---

## 5.2 Add fields to assignmentData

Inside the `else` branch where `assignmentData` is created:

```ts
const assignmentData: any = {
  // existing fields...

  entityId: onboardingConfig.entityId,
  requirementPackageId: onboardingConfig.requirementPackageId,
  onboardingInstanceId: assignmentRef.id,
  onboardingStatus:
    onboardingConfig.entityId &&
    onboardingConfig.requirementPackageId &&
    onboardingConfig.packageData
      ? 'not_started'
      : 'blocked',
  onboardingPercent: 0,
};
```

---

## 5.3 Create onboarding instance after assignment write

After:

```ts
await assignmentRef.set(assignmentData, { merge: false });
```

Add:

```ts
await ensureOnboardingInstance({
  tenantId,
  assignmentId: assignmentRef.id,
  userId,
  jobOrderId,
  shiftId,
  entityId: onboardingConfig.entityId,
  requirementPackageId: onboardingConfig.requirementPackageId,
  packageData: onboardingConfig.packageData,
  createdBy,
  blockedReason: onboardingConfig.blockedReason,
});
```

---

## 5.4 Also handle reactivation branch

After `assignmentRef.set(...)` in the `isReactivating` branch, add the same call:

```ts
await ensureOnboardingInstance({
  tenantId,
  assignmentId: assignmentRef.id,
  userId,
  jobOrderId,
  shiftId,
  entityId: onboardingConfig.entityId,
  requirementPackageId: onboardingConfig.requirementPackageId,
  packageData: onboardingConfig.packageData,
  createdBy,
  blockedReason: onboardingConfig.blockedReason,
});
```

---

# 6. Firestore Rules (Minimal)

Add collection rules similar to settings/CRM collections.

Collections:
- entities
- requirement_packages
- onboarding_instances

Start permissive for admin/system writes, tighten later.

---

# 7. UI Follow‑Up (Next Step)

## Settings
Add tabs:
- Entities CRUD
- Requirement Packages CRUD

## Job Order UI
Add:
- Entity selector
- Requirement package selector

## Onboarding Tab
Load:
```
assignment.onboardingInstanceId
→ tenants/{tenantId}/onboarding_instances/{id}
```

Render:
- status
- percent
- documents
- steps
- checks

---

# 8. Safety Behavior (Production Safe)

If job order lacks onboarding config:

Assignment still created ✔  
Onboarding instance created ✔  
Status = `"blocked"` ✔  
Reason stored ✔  

This prevents production breakage during migration.

---

# 9. Phase 2 (Later)

### E‑Verify
- Add `everify` check template
- Store status in onboarding instance or user_employments

### Background Checks
- Add provider-backed checks in `resolvedChecks`

### Everee Payroll
- Use `entity.entityCode` for payroll export
- Use assignment.entityId for grouping

---

# 10. Done Criteria (Phase 1A)

✔ Assignment writes include onboarding fields  
✔ Onboarding instance created for every assignment  
✔ UI can read onboarding snapshot  
✔ No production flows broken  

---

**Upload this file to Cursor and implement in order.**
