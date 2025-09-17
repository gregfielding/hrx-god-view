# Phase 1 — Groundwork: Firestore Types, Collections, and Rules

This spec covers the **data model cleanup and hardening** needed before we continue building Job Orders, Recruiter flows, and Job Board logic.  
We will align Firestore collections, remove duplicates, and standardize naming so Cursor can safely build on a strong foundation.

---

## 🔑 Goals of Phase 1
1. **Normalize core collections**: Ensure tenants, companies, contacts, jobOrders, applications, and userGroups are consistently structured.  
2. **Eliminate duplicates**: Remove test/legacy collections like `locations` at the wrong levels.  
3. **Add missing references**: Make sure all records include `tenantId`, `companyId`, `jobOrderId` where appropriate.  
4. **Define Firestore rules**: Basic read/write security so only tenant-level users can access their own data.  
5. **Prepare for ATS workflow**: Ensure data can flow from CRM → Job Order → Job Posting → Application → Candidate → Employee.

---

## 🗂️ Firestore Collection Layout (Target)
At the root of **each tenant document**:

```plaintext
tenants/{tenantId}
  crm_companies/{companyId}
    locations/{locationId}
    crm_contacts/{contactId}
    crm_deals/{dealId}
  jobOrders/{jobOrderId}
  jobBoardPosts/{postId}
  applications/{applicationId}
  userGroups/{groupId}
  users/{userId}
```

### Notes
- **crm_companies** → Accounts/Prospects (not always active customers).  
- **jobOrders** → Belongs directly to tenant (NOT a legacy top-level collection).  
- **applications** → Can reference `jobOrderId` or be standalone (for generic pipelines like “Las Vegas Forklift Drivers”).  
- **jobBoardPosts** → Optional postings, may or may not link to a job order.  
- **userGroups** → Recruiter-defined manual groups of applicants/candidates.  
- **users** → All people associated with tenant (workers, recruiters, admins, etc).

---

## ✅ Cleanup Tasks
### Step 1 — Remove Duplicates
- Identify and delete **legacy `jobOrders` collections** at the wrong level.  
- Remove stray `locations` collections outside of `crm_companies/{companyId}`.  
- Keep **only one source of truth** for each entity.

### Step 2 — Normalize `jobOrders`
- Create `tenants/{tenantId}/jobOrders/{jobOrderId}`.  
- Required fields:  
  ```json
  {
    "tenantId": "abc123",
    "jobOrderNumber": 2006,
    "jobOrderName": "Forklift Operator - Vegas",
    "status": "Open", // Open, On-Hold, Cancelled, Filled, Completed
    "companyId": "xyz789",
    "locationId": "loc123",
    "dateOpened": "timestamp",
    "startDate": "date",
    "endDate": "date|null",
    "recruiterId": "user123",
    "userGroups": ["group1", "group2"]
  }
  ```

### Step 3 — Normalize `applications`
- Create `tenants/{tenantId}/applications/{applicationId}`.  
- Required fields:  
  ```json
  {
    "tenantId": "abc123",
    "candidateId": "user123",
    "jobOrderId": "2006", // optional
    "jobBoardPostId": "post789", // optional
    "status": "applied", // applied, interviewing, background, drug, onboarded, rejected
    "createdAt": "timestamp"
  }
  ```

### Step 4 — Normalize `userGroups`
- `tenants/{tenantId}/userGroups/{groupId}`.  
- Recruiter-defined groups of candidates.  
- Document:  
  ```json
  {
    "tenantId": "abc123",
    "groupName": "Vegas Forklift Drivers",
    "members": ["user1", "user2", "user3"],
    "createdBy": "recruiter123",
    "createdAt": "timestamp"
  }
  ```

---

## 🔒 Firestore Rules (Phase 1)
```javascript
match /tenants/{tenantId} {
  allow read, write: if request.auth != null && request.auth.token.tenantId == tenantId;

  match /{document=**} {
    allow read, write: if request.auth != null && request.auth.token.tenantId == tenantId;
  }
}
```

This ensures no tenant can read/write data from another tenant.

---

## 🚀 Cursor Step Plan
1. Audit and **list all existing collections** under `tenants/{tenantId}`.  
2. Delete/merge legacy `jobOrders` and duplicate `locations`.  
3. Implement new **jobOrders subcollection** with required fields.  
4. Update any code (cloud functions, UI) that references old `jobOrders`.  
5. Implement **applications subcollection** with optional jobOrder link.  
6. Implement **userGroups subcollection** with manual add/remove.  
7. Harden with Firestore rules.  
8. Test: Create new job order → create job board post → add applications → group applicants.  

---

## ✅ Acceptance Criteria
- No duplicate `locations` or `jobOrders`.  
- New Job Orders save correctly with `tenantId`.  
- Applications can exist standalone or tied to jobOrder.  
- UserGroups can be created and populated manually.  
- Firestore rules enforce tenant isolation.  
- UI can reference the new structure without breaking.

---

End of **Phase 1 Groundwork Spec**.
