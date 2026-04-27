# Phase 1C — Documents + E‑Sign Infrastructure (Provider‑Agnostic)
## Cursor Upload — Storage, Data Model, UI, and Signature Service Abstraction (Triggers Deferred)

Owner: Greg Fielding / HRX One  
Date: 2026-02-17  
Project: Entity + Onboarding (Tenant-scoped)  
Objective: Build the **document storage + e‑signature infrastructure** so that **future triggers** can send docs flexibly.

> **Important:** We are **NOT** defining “when to send” in this phase.  
> We are building the **systems** that make sending possible:
> - Document repository (upload/version/activate)
> - Mapping docs to onboarding requirements
> - Signature “envelopes” + provider abstraction + webhook handling
> - Worker + Admin surfaces to view status
> - A clean API for future triggers to call

---

# 0) What “Done” Looks Like

✅ Admin can upload & version onboarding documents (PDFs) per tenant  
✅ Documents can be mapped to onboarding requirement items (docKey) and/or requirement packages  
✅ System can create a “signature envelope” record with a placeholder provider (even if not sent yet)  
✅ If provider is configured later, the same envelope can be sent + tracked via webhooks  
✅ Onboarding instances can show document requirements and current status (not_started/sent/signed/declined/failed)  
✅ No business logic coupling: any trigger can call `startSignatureEnvelope(...)` later

---

# 1) Canonical Firestore Paths (Tenant-Scoped)

### Document Repository
```
tenants/{tenantId}/onboarding_documents/{docId}
```

### Signature Envelopes (transactions/logs)
```
tenants/{tenantId}/signature_envelopes/{envelopeId}
tenants/{tenantId}/signature_envelopes/{envelopeId}/events/{eventId}
```

### Onboarding Instances reference documents (snapshots)
```
tenants/{tenantId}/onboarding_instances/{assignmentId}
```

### Storage (PDF assets)
```
tenants/{tenantId}/onboarding_docs/{docKey}/{version}/{fileName}
```

---

# 2) Data Model

## 2.1 OnboardingDocument (Repository + Versioning)
Path: `tenants/{tenantId}/onboarding_documents/{docId}`

**docId**: auto ID OR deterministic `${docKey}__${version}`

```ts
export type OnboardingDocumentMode = "acknowledge" | "upload" | "esign";

export type OnboardingDocument = {
  docId: string;
  tenantId: string;

  // Stable identifier used by onboarding items/packages
  docKey: string;                 // "handbook_employee", "handbook_contractor", "ic_agreement", "wc_info"
  title: string;                  // human readable

  // Versioning
  version: string;                // "2026.02" or "v3"
  status: "draft" | "active" | "archived";
  effectiveDate?: string;         // ISO date

  mode: OnboardingDocumentMode;   // preferred interaction
  appliesTo?: Array<"W2"|"1099"|"BOTH">;   // optional filter

  file: {
    storagePath: string;          // "tenants/{tenantId}/onboarding_docs/..."
    fileName: string;
    contentType: string;          // "application/pdf"
    size: number;
    sha256?: string;              // optional integrity/hash
  };

  // Phase 2: provider template mapping (optional)
  signatureTemplate?: {
    provider: "docusign" | "dropboxsign" | "adobe" | "other";
    templateId?: string;
  };

  createdAt: FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.Timestamp;
};
```

### Rule: One active version per docKey
Enforce in UI + optionally in a Cloud Function (Phase 1C.2).

---

## 2.2 SignatureEnvelope (Provider-Agnostic Transaction)
Path: `tenants/{tenantId}/signature_envelopes/{envelopeId}`

**envelopeId suggestion**
- Deterministic: `${assignmentId}__${docKey}__${version}`
- Or auto ID. Deterministic helps idempotency and avoids duplicates when triggers replay.

```ts
export type SignatureProvider =
  | "none"
  | "docusign"
  | "dropboxsign"
  | "adobe";

export type SignatureEnvelopeStatus =
  | "not_sent"
  | "queued"
  | "sent"
  | "viewed"
  | "signed"
  | "declined"
  | "expired"
  | "canceled"
  | "failed";

export type SignatureEnvelope = {
  envelopeId: string;
  tenantId: string;

  // Who/what this envelope is for
  userId: string;
  assignmentId?: string;          // common case
  jobOrderId?: string;
  entityId?: string;

  // Document reference
  docKey: string;
  docVersion: string;
  onboardingDocumentId?: string;  // docId

  // Provider
  provider: SignatureProvider;
  providerEnvelopeId?: string;    // returned by provider after sending
  providerStatus?: string;        // raw provider status string

  // URLs (stored after sending)
  signingUrl?: string;            // short-lived; optional
  viewUrl?: string;
  downloadUrl?: string;           // final signed PDF or provider file

  // Status
  status: SignatureEnvelopeStatus;
  statusReason?: string;

  // Audit / metadata
  createdBy?: { uid: string; name?: string } | null;
  createdAt: FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.Timestamp;

  // Optional: template variables used when sending
  mergeFields?: Record<string, any>;

  // Optional: store a copy of the file reference used at send time
  fileSnapshot?: {
    storagePath: string;
    sha256?: string;
  };
};
```

### Events Subcollection (append-only)
Path: `tenants/{tenantId}/signature_envelopes/{envelopeId}/events/{eventId}`

```ts
export type SignatureEnvelopeEvent = {
  type:
    | "created"
    | "queued"
    | "sent"
    | "viewed"
    | "signed"
    | "declined"
    | "expired"
    | "canceled"
    | "failed"
    | "provider_webhook";
  at: FirebaseFirestore.Timestamp;
  message?: string;
  data?: any;                    // raw webhook payload (sanitized)
};
```

---

# 3) How Onboarding Instances Reference Documents

In `requirement_packages`, documents should store **docKey** and optionally a preferred version:
- If version is omitted, resolver uses the **active** document version for that docKey.

Example package documents entry:
```ts
{
  itemKey: "handbook_employee_ack",
  docKey: "handbook_employee",
  mode: "acknowledge",           // or "esign"
  required: true,
  blocking: true
}
```

Then onboarding_instances snapshot stores resolved:
- docKey
- docVersion (selected/active at time of snapshot)
- requirement flags
- status fields (from envelope or worker acknowledgement record)

**Phase 1C approach**
- Keep onboarding_instances as the canonical “what is required” snapshot.
- signature_envelopes are the canonical “transaction status.”

---

# 4) UI Build (Settings + Admin Views)

## 4.1 Settings → Onboarding Library → Documents Tab
Route already exists (placeholder): `OnboardingLibraryPage`

Build:
- List grouped by docKey
- Expand group to show versions
- Upload new version (PDF)
- Mark Active / Archive
- Set mode (acknowledge / upload / esign)
- Show effective date

**Suggested layout**
- Left: docKey groups
- Right: version detail panel

## 4.2 Entity → Documents Tab
Purpose:
- Let entity pick which documents apply (handbooks, IC agreement, WC info).
- This is **mapping** not sending.

Fields:
- Employee handbook docKey
- Contractor handbook docKey
- IC agreement docKey
- Workers comp info docKey
- Optional: override version per entity (rare; keep for later)

Store as simple keys on entity doc:
```ts
documents?: {
  handbookEmployeeDocKey?: string;
  handbookContractorDocKey?: string;
  icAgreementDocKey?: string;
  workersCompInfoDocKey?: string;
}
```

## 4.3 Onboarding Instance UI (Admin + Worker)
Admin view (existing onboarding tab) should display:
- Required documents with status chip:
  - Not sent / Sent / Signed / Declined / Failed
- For acknowledge-mode docs: show “Acknowledged” status (not envelope)

Worker view (Flutter later):
- List docs, open PDF, acknowledge, or sign via provider URL

---

# 5) Cloud Functions (Infrastructure Only)

All functions should be designed to be callable by **future triggers**. No trigger logic in this phase.

## 5.1 Document “active version” enforcement (optional)
`onboardingDocumentsSetActiveVersion`
- When a doc version is set to `active`, archive other versions with same docKey.

This can be:
- Client-only (write batch in UI)
- OR server enforced via Firestore trigger

## 5.2 Signature Service Abstraction (Core)
Create a provider-agnostic service layer:

### Files
- `functions/src/signatures/signatureProviders.ts`
- `functions/src/signatures/signatureService.ts`
- `functions/src/signatures/webhooks.ts`

### Interface
```ts
export type StartEnvelopeInput = {
  tenantId: string;
  envelopeId: string;         // deterministic or provided
  userId: string;
  assignmentId?: string;
  docKey: string;
  docVersion: string;
  onboardingDocumentId: string;
  mergeFields?: Record<string, any>;
};

export type StartEnvelopeResult = {
  provider: SignatureProvider;
  providerEnvelopeId?: string;
  signingUrl?: string;
  status: SignatureEnvelopeStatus;
};
```

### Callable Function (for future triggers to call)
`signaturesStartEnvelope` (httpsCallable or https endpoint)
- Validates permissions
- Resolves active document by docKey/version
- Creates signature_envelopes doc with status `not_sent` or `queued`
- If provider configured, sends to provider and updates to `sent`
- If provider not configured, remains `not_sent` (still useful for UI/testing)

### Worker action function (optional)
`signaturesGetSigningUrl`
- Returns a short-lived signing URL if provider supports it

## 5.3 Webhook Receiver (Phase 1C scaffolding)
`signaturesWebhookReceiver`
- Provider will post events to this endpoint later
- For now: accept payload, log, update envelope status if mapping exists

**Mapping**
- Identify envelope via `providerEnvelopeId` or metadata stored in provider.
- Append an event doc in `events/`
- Update `signature_envelopes.status` accordingly

---

# 6) Storage + Security Rules

## 6.1 Storage Rules
Allow PDF uploads only for authorized tenant admins (align with existing role pattern).

Path prefix:
`tenants/{tenantId}/onboarding_docs/**`

Rules:
- Read: authenticated tenant members (or admins only if you prefer)
- Write: tenant admins / HRX only

## 6.2 Firestore Rules
Collections:
- `onboarding_documents` — read for tenant members, write for admins
- `signature_envelopes` — read for admins + the user (owner); write only functions/admin
- `signature_envelopes/*/events` — same as parent

**Owner read**
Allow worker to read only their own envelope(s) if/when worker app uses Firestore:
- Match on `resource.data.userId == request.auth.uid`

---

# 7) How Triggers Will Use This Later (Not Implemented Now)

Future triggers will call one of these functions:
- `signaturesStartEnvelope({ assignmentId, docKey })`
- `signaturesStartEnvelope({ userId, docKey })`
- `signaturesStartEnvelope({ ...mergeFields })`

Examples of future triggers (not in this phase):
- Assignment created → send handbook + agreement
- Status changed to “hired” → send W‑4 + I‑9 acknowledgement
- Recruiter clicks “Send docs” → send selected doc bundle
- Reminder scheduler → resend if not signed by due date

**Key requirement met:** triggers only need to call the service; they don't manage provider logic.

---

# 8) Recommended Provider Choices (Phase 2 Decision Later)

We will keep provider-agnostic, but choose one soon.

Practical options:
- **Dropbox Sign (HelloSign)**: simple API, good embedded signing
- **DocuSign**: enterprise, heavier setup
- **Adobe Sign**: enterprise, good compliance

**Phase 1C**: implement provider interface with `provider="none"` default.

---

# 9) Build Order (Phase 1C)

1) Implement Firestore types for `OnboardingDocument` + `SignatureEnvelope`
2) Build Documents Tab CRUD + Storage upload
3) Build Entity Documents mapping tab (docKey selectors)
4) Add UI status list in onboarding instance view (read envelope statuses)
5) Implement Cloud Functions:
   - signaturesStartEnvelope (provider=none works)
   - webhook receiver scaffold + events logging
6) Add rules for onboarding_docs storage + collections

---

# 10) Acceptance Criteria

✅ Can upload PDF docs, version them, set active version per docKey  
✅ Can map entity handbooks/agreements via docKey  
✅ Can create signature envelope records (provider=none) without breaking flows  
✅ UI can display envelope status per document requirement  
✅ Webhook receiver exists (no provider yet) and can update envelope if called  
✅ Triggers can be added later without redesign

---

# 11) Notes (PII + Payroll)

- Never store SSN/bank info in Firestore.
- Signed docs may contain sensitive info; control Storage reads appropriately.
- Everee onboarding remains out of scope.

---

## Appendix A — Suggested Seed docKeys

- `handbook_employee`
- `handbook_contractor`
- `ic_agreement`
- `workers_comp_info`
- `safety_policy`
- `drug_policy`

---

## Appendix B — Minimal Status Chips

- Not sent (gray)
- Queued (yellow)
- Sent (blue)
- Viewed (purple)
- Signed (green)
- Declined (red)
- Failed (red)

---
