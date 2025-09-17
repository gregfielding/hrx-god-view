# Phase 2 · Packet 2.1 — Applications UI (Create → Review → Stage)

## 🎯 Goals
- Recruiters can **create applications** (linked to a Job Order or standalone in talent pool).
- Review applications: resume, contact info, tags, notes, activity history.
- Move applications across **pipeline stages** (Applied → Screening → Interview → Offer → Hired/Rejected).
- Keep everything **multi-tenant**, **role-based**, and aligned to Phase-1.5 Firestore structure.

---

## 1. Data Model

**Canonical Firestore Paths**

- Job-linked apps  
  `tenants/{tenantId}/job_orders/{jobOrderId}/applications/{applicationId}`

- Standalone apps (talent pool)  
  `tenants/{tenantId}/applications/{applicationId}`

```ts
// src/types/phase2.ts
export type Application = {
  id: string
  tenantId: string

  // Optional linkage
  jobOrderId?: string | null

  // Candidate core
  candidate: {
    firstName: string
    lastName: string
    email?: string
    phone?: string
    city?: string
    state?: string
    country?: string
    resumeUrl?: string
  }

  // Pipeline
  status: 'applied' | 'screening' | 'interview' | 'offer' | 'hired' | 'rejected' | 'withdrawn'
  stageChangedAt: FirebaseFirestore.Timestamp

  // Meta
  createdAt: FirebaseFirestore.Timestamp
  createdBy: string
  updatedAt: FirebaseFirestore.Timestamp
  updatedBy?: string

  // Scoring / labels
  rating?: 1|2|3|4|5
  tags?: string[]
  notes?: string

  // Compliance snapshot
  requires: {
    backgroundCheck?: boolean
    drugScreen?: boolean
    licenses?: string[]
  }

  // Audit
  source?: 'job_board' | 'manual' | 'referral' | 'import' | 'career_page'
}
```

---

## 2. Firestore Security Rules

Append to `firestore.rules`:

```rules
match /databases/{database}/documents {
  function isTenantUser(tid) {
    return request.auth != null &&
      request.auth.token.tenantId == tid;
  }
  function isRecruiterOrAdmin() {
    return request.auth != null &&
      (request.auth.token.role in ['recruiter','admin']);
  }

  // Standalone applications
  match /tenants/{tenantId}/applications/{appId} {
    allow read: if isTenantUser(tenantId);
    allow create, update, delete: if isTenantUser(tenantId) && isRecruiterOrAdmin()
      && request.resource.data.tenantId == tenantId;
  }

  // Job-linked applications
  match /tenants/{tenantId}/job_orders/{jobOrderId}/applications/{appId} {
    allow read: if isTenantUser(tenantId);
    allow create, update, delete: if isTenantUser(tenantId) && isRecruiterOrAdmin()
      && request.resource.data.tenantId == tenantId
      && request.resource.data.jobOrderId == jobOrderId;
  }
}
```

---

## 3. Firestore Indexes

Add to `firestore.indexes.json`:

```json
{
  "indexes": [
    {
      "collectionGroup": "applications",
      "queryScope": "COLLECTION_GROUP",
      "fields": [
        { "fieldPath": "tenantId", "order": "ASCENDING" },
        { "fieldPath": "jobOrderId", "order": "ASCENDING" },
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "stageChangedAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "applications",
      "queryScope": "COLLECTION_GROUP",
      "fields": [
        { "fieldPath": "tenantId", "order": "ASCENDING" },
        { "fieldPath": "status", "order": "ASCENDING" }
      ]
    }
  ]
}
```
