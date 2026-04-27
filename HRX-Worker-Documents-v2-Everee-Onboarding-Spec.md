
# HRX Worker Documents v2 Spec
## Everee Integration + Expiration Tracking + Onboarding Journeys

---

# 1. Purpose

Redesign the Worker Documents section to support:

1. Dual document sources:
   - HRX-hosted (non-sensitive uploads)
   - Everee-hosted (sensitive payroll/compliance docs)

2. Expiration tracking + automated renewal workflows

3. Shared onboarding checklist model used by:
   - Worker portal
   - Admin onboarding view
   - Future automation (reminders, blocking, compliance alerts)

This spec does NOT change admin routes. It introduces a unified data model that both worker and admin views will consume.

---

# 2. Core Architecture Principle

HRX is the control panel.
Everee is the vault.

HRX does NOT store sensitive files (I-9s, tax forms, IDs, etc.).  
HRX stores:

- Document metadata
- Status
- Expiration date
- External ID
- View link (or external ID used to generate link)
- Checklist state

---

# 3. Firestore Data Model

## users/{uid}.onboarding

```ts
onboarding: {
  journey: "employee" | "contractor",
  status: "not_started" | "in_progress" | "complete",
  templateId: string,

  checklist: {
    everee_identity: {
      status: "missing" | "submitted" | "verified" | "expired",
      provider: "everee",
      externalId: string,
      viewUrl?: string,
      expiresAt?: Timestamp,
      renewalRequestedAt?: Timestamp
    },

    everee_i9: {
      status,
      provider: "everee",
      externalId,
      viewUrl
    },

    direct_deposit: {
      status,
      provider: "everee",
      externalId,
      viewUrl
    },

    driver_license: {
      status,
      provider: "everee",
      externalId,
      viewUrl,
      expiresAt
    },

    resume: {
      status,
      provider: "hrx",
      fileUrl,
      updatedAt
    },

    certifications: {
      status,
      provider: "hrx",
      count,
      nextExpiringAt?
    }
  },

  lastSyncedAtEveree: Timestamp,
  updatedAt: Timestamp
}
```

---

# 4. Onboarding Templates

## onboardingTemplates/{templateId}

```ts
{
  journeyType: "employee" | "contractor",
  requiredItems: string[],
  optionalItems: string[],
  expirationTrackedItems: string[]
}
```

Users reference templateId to determine which checklist items apply.

This allows:
- Contractor vs Employee flow
- State-specific variations later
- Client-specific onboarding flows

---

# 5. Worker Documents Page v2 Layout

Route:
/c1/workers/documents

Layout:
Container maxWidth="lg"
Stack spacing={4}

## Tabs

1. Onboarding
2. Work Documents
3. Assignment Files

---

## Tab 1: Onboarding

Displays checklist items from users/{uid}.onboarding.checklist.

Each item rendered via:

### <DocRecordCard />

Props:
- label
- provider (Everee / HRX)
- status
- expiresAt
- viewUrl
- CTA label
- CTA action

Status chips:
- Missing (warning)
- Submitted (info)
- Verified (success)
- Expiring Soon (warning)
- Expired (error)

CTAs:
- Complete in Everee
- View in Everee
- Sign in HRX
- Upload
- Replace

---

## Tab 2: Work Documents

HRX-hosted files:
- Resume
- Certifications
- Training certificates

Uses existing upload component built by Cursor.
Adds expiration badge support for certifications.

---

## Tab 3: Assignment Files

Read-only display of:
- Attachments from job order
- Staff instructions uploads

Source:
Job Order → Staff Instructions tab → attachments

These are not worker-uploaded.

---

# 6. Expiration System

For documents with expiresAt:

Derived states:
- expiringSoon (<= 30 days)
- expired

Automations:
- 30 days before expiration → notify worker + create recruiter task
- 7 days before → escalate
- expired → mark checklist item as expired
- optionally block assignment eligibility

Future:
Cloud Function to scan expiring documents daily.

---

# 7. Everee Sync Plan

Function: syncEvereeDocuments(uid)

Responsibilities:
- Pull documents from Everee API
- Update checklist status
- Store externalId
- Store expiresAt if provided
- Update lastSyncedAtEveree

Security Note:
Do NOT permanently store signed URLs.
Prefer:
- Store externalId
- Generate temporary view URL via callable function

---

# 8. Admin Alignment (Future)

Admin onboarding checklist will use the same onboarding.checklist object.

Admin features:
- Send reminder
- Request renewal
- Override status (logged)
- See expiration warnings
- Block placement if required item missing

Single source of truth = users/{uid}.onboarding.checklist

---

# 9. What Cursor Should Build Now

1. Rebuild Worker Documents page with 3 tabs.
2. Create <DocRecordCard /> reusable component.
3. Replace placeholder UI with checklist-driven rendering.
4. Add expiration badge logic.
5. Mock Everee checklist items for now.
6. Do NOT implement Everee API yet — use stubbed data.

---

# 10. Non-Goals (Important)

- Do NOT store sensitive identity docs in HRX storage.
- Do NOT duplicate Everee documents.
- Do NOT compute onboarding completion from UI only — derive from checklist state.
- Do NOT create separate worker/admin checklist objects.

---

# 11. Future Enhancements

- Onboarding progress % derived from checklist requiredItems completion
- Job-specific document requirements
- Automated renewal workflow dashboard
- Compliance alerts panel for recruiters
- Expiration heatmap per tenant

---

# Summary

This system creates:

- One onboarding checklist model
- Dual-source document handling (HRX + Everee)
- Expiration intelligence
- Contractor vs Employee journey support
- Future-proof admin + automation alignment

This becomes the foundation for compliance, onboarding, and placement readiness.
