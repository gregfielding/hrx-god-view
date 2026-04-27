# HRX Digital Signatures (HRX-Uploaded PDFs) — Provider-Agnostic Spec (Dropbox Sign Phase 1)
**Audience:** Cursor / HRX engineering  
**Goal:** Build a complete, provider-agnostic e-sign system that works for **Web + Flutter**, uses **HRX-uploaded PDFs** as the document source of truth, and integrates **Dropbox Sign (HelloSign)** first—without locking HRX into any one vendor.

**Design principles**
1. **HRX owns the workflow**: documents, bundles, signer roles, onboarding blocking, reminders, audit, reporting.
2. **Provider is an adapter**: create request, embedded signing, webhook events, download signed artifacts.
3. **Backend-only credentials**: provider API keys/secrets never ship to clients.
4. **Tenant-scoped + lookup fields everywhere**: every document/envelope includes `tenantId`, `entityId`, `userId`, etc.
5. **No sensitive payroll data here**: signatures are about agreements/acknowledgements/contracts—not payroll onboarding.

---

## 0) Glossary
- **Document Template**: HRX-managed document definition + PDF file (versioned).
- **Document Bundle**: a set of document templates + signer requirements used for a workflow (e.g., onboarding W2).
- **Envelope**: a single signature transaction (one or more docs) tracked by HRX; mapped to provider request.
- **Signing Session**: short-lived session that produces an embedded signing URL for a given signer.
- **Provider**: Dropbox Sign now; DocuSign later.

---

## 1) Architecture Overview
### 1.1 Core idea
- HRX stores **canonical PDFs** in Storage and document metadata in Firestore.
- When a signature is required, HRX:
  1) resolves a bundle (entity/worker type/job order)
  2) creates an envelope record in Firestore
  3) provider adapter uploads PDFs + creates signature request
  4) HRX generates an embedded signing flow link
  5) user signs via **HRX-hosted signer page** (works for Web + Flutter)
  6) provider webhook updates envelope status
  7) HRX downloads final signed PDF + audit trail and stores them in Storage

### 1.2 Why HRX-hosted signer page
For mobile (Flutter), embedded signing should happen in a webview on a domain HRX controls.  
**Plan:** `https://sign.hrxone.com/s/{signingSessionId}` (or `app.hrxone.com/sign/...` if you prefer).  
Both Web and Flutter open the same URL.

---

## 2) Firestore Data Model (Tenant-Scoped)
> All collections are under `tenants/{tenantId}/...`

### 2.1 Document Templates (HRX-managed PDFs)
**Path**
- `tenants/{tenantId}/document_templates/{docTemplateId}`

**Fields**
- Lookup: `tenantId`, `entityId?` (optional; null=global for tenant), `createdBy`
- Identity: `name`, `category` (`employment`, `handbook`, `wc_ack`, `client_contract`, etc.)
- Applicability:
  - `appliesTo.workerType`: `w2 | 1099 | both`
  - `appliesTo.entityIds`: string[] (optional)
  - `appliesTo.jobOrderTypes`: string[] (optional)
- Versioning:
  - `version`: integer (monotonic)
  - `effectiveAt`, `retiredAt?`
  - `supersedesDocTemplateId?`
- Storage:
  - `pdfRef`: Storage path (string)
  - `pdfSha256`: string (to detect changes)
  - `pdfFileName`: string
- Provider mapping (optional; generally not needed for HRX PDFs):
  - `providerHints`: object (reserved)
- Status: `active: boolean`
- Timestamps: `createdAt`, `updatedAt`

**Storage path**
- `tenants/{tenantId}/documents/templates/{entityIdOrGlobal}/{docTemplateId}/v{version}.pdf`

---

### 2.2 Document Bundles (workflow packs)
**Path**
- `tenants/{tenantId}/document_bundles/{bundleId}`

**Fields**
- Lookup: `tenantId`, `entityId?` (optional)
- Identity: `name`, `description`, `active`
- Applicability rules (same shape as templates; bundle-level gating):
  - `appliesTo.workerType`, `appliesTo.entityIds`, etc.
- Contents:
  - `items[]`: array of:
    - `docTemplateId`
    - `titleOverride?`
    - `required: boolean`
    - `signers[]`:
      - `{ role: 'worker'|'client'|'internal', order: number, requiresEmail: boolean }`
    - `blocking: boolean` (must sign to proceed)
- Timestamps: `createdAt`, `updatedAt`

---

### 2.3 Signature Envelopes (canonical transaction record)
**Path**
- `tenants/{tenantId}/signature_envelopes/{envelopeId}`

**Required lookup fields**
- `tenantId`
- `entityId`
- `purpose`: `worker_onboarding | client_contract | policy_update | other`
- Subject linking (as applicable):
  - `userId` (worker signer)
  - `userEmploymentId?`
  - `assignmentId?`
  - `jobOrderId?`
  - `companyId?` (for client docs)
  - `contactId?` (for client signer)
  - `locationId?`

**Provider**
- `provider`: `'dropbox_sign' | 'docusign' | 'stub'`
- `providerRequestId?` (Dropbox Sign signature_request_id)
- `providerEnv`: `stage | prod`
- `providerStatus?` (raw provider status string)

**HRX status**
- `status`: `draft | sent | viewed | signed | completed | declined | voided | error`
- `statusDisplay?`: string (human friendly)

**Documents**
- `documents[]`:
  - `{ docTemplateId, version, name, pdfRef, pdfSha256 }`

**Signers**
- `signers[]`:
  - `{ signerId, role, name, email, userId?, contactId?, order, status, signedAt? }`

**Workflow**
- `bundleId?`
- `blocking: boolean`
- `onboardingInstanceId?` (optional integration point)
- `resolvedFrom`: object snapshot (entity/bundle/jobOrder resolution for audit)

**Artifacts**
- `files`:
  - `signedPdfRef?`
  - `auditRef?`
  - `providerFiles[]?` (optional)
- `webhook`:
  - `lastEventAt?`
  - `lastEventType?`
  - `deliveryCount?`

**Idempotency**
- `requestHash`: sha256 of stable inputs (tenantId, entityId, subject, bundleId, doc hashes, signer emails)

**Timestamps**
- `createdAt`, `updatedAt`, `sentAt?`, `completedAt?`, `voidedAt?`, `declinedAt?`

---

### 2.4 Envelope Events (append-only)
**Path**
- `tenants/{tenantId}/signature_envelopes/{envelopeId}/events/{eventId}`

**Fields**
- `type`: `CREATED | SENT | VIEWED | SIGNED | COMPLETED | DECLINED | VOIDED | ERROR | WEBHOOK_RECEIVED | FILES_DOWNLOADED`
- `at`: timestamp
- `actorType`: `system | user | admin | provider`
- `actorId?`: uid / admin id / provider id
- `data`: **whitelisted** provider payload fields only

---

### 2.5 Signing Sessions (short-lived embedded flow)
**Path**
- `tenants/{tenantId}/signature_sessions/{sessionId}`

**Fields**
- Lookup: `tenantId`, `envelopeId`, `signerId`, `userId?`, `contactId?`
- `provider`: `'dropbox_sign' | ...`
- `providerSigningUrl?` (short-lived; store only if necessary)
- `returnUrl`: where to go back after signing
- `expiresAt`: timestamp
- `status`: `created | opened | completed | expired | error`
- `createdAt`, `updatedAt`

**Note:** You can avoid storing the provider URL and instead regenerate it on demand; either is fine. If stored, set short TTL.

---

## 3) Security Rules (client access)
### 3.1 Document templates/bundles
- Read: tenant admins/recruiters/managers (and HRX)
- Write: tenant admins/HRX only

### 3.2 Envelopes
- Workers:
  - may read envelopes where `userId == auth.uid` **only if** you want them to see status/history.
  - may not read provider metadata beyond safe status fields (recommend storing safe `public` subobject if needed).
- Tenant admins/recruiters:
  - can read/write envelopes
- HRX:
  - full

**Recommended worker-safe pattern (optional but consistent with E-Verify):**
- Add `signature_envelopes_public/{envelopeId}` mirror containing only status + links.
- For Phase 1, you can keep envelopes readable to worker if fields are sanitized.

### 3.3 Signing sessions
- Read: only the signer (worker/contact) and tenant admins
- Write: backend/admin only (clients should not create sessions directly)

---

## 4) Backend Modules (Cloud Functions)
### 4.1 Folder structure
- `functions/src/integrations/signatures/`
  - `signatureSchemas.ts` (zod types, enums)
  - `signatureConfig.ts` (env/secrets, base urls)
  - `signatureService.ts` (provider-agnostic orchestration)
  - `providers/`
    - `dropboxSignProvider.ts`
    - `stubProvider.ts` (dev/testing)
  - `signatureWebhooks.ts` (HTTP endpoint(s))
  - `signatureSessions.ts` (create session + resolve url)
  - `signatureFiles.ts` (download signed pdf/audit)
  - `signatureTriggers.ts` (future: onboarding triggers)

### 4.2 Secrets / config (Phase 1: Dropbox Sign)
- `DROPBOXSIGN_API_KEY` (secret)
- `DROPBOXSIGN_CLIENT_ID` (for embedded signing, if required)
- `DROPBOXSIGN_APP_SECRET` (for webhook signature validation)
- `SIGN_PROVIDER_DEFAULT=dropbox_sign`
- `SIGN_ENV=stage|prod`
- `SIGN_SIGNER_BASE_URL=https://sign.hrxone.com` (or app domain)
- Optional:
  - `SIGN_FAKE_PROVIDER=true` (stub mode)

---

## 5) Provider-Agnostic Interface
Define an internal interface:

```ts
interface SignatureProvider {
  createEnvelope(req: CreateEnvelopeRequest): Promise<CreateEnvelopeResult>;
  getEmbeddedSigningUrl(req: GetSigningUrlRequest): Promise<{ url: string; expiresAt?: Date }>;
  cancelEnvelope(req: CancelEnvelopeRequest): Promise<void>;
  fetchEnvelopeStatus(req: FetchStatusRequest): Promise<ProviderStatusResult>;
  downloadCompletedFiles(req: DownloadFilesRequest): Promise<{ signedPdf: Buffer; auditPdf?: Buffer }>;
  verifyWebhook(req: VerifyWebhookRequest): boolean;
  parseWebhookEvent(req: ParseWebhookEventRequest): NormalizedWebhookEvent;
}
```

HRX uses `signatureService` to:
- resolve docs + signers
- persist canonical Firestore envelope
- call provider adapter
- update status + events
- handle webhooks + file downloads

---

## 6) Dropbox Sign (HelloSign) Adapter — HRX PDFs
### 6.1 Create signature request with file upload
Conceptually:
- Provide PDFs as file uploads (from Storage) to provider
- Create a signature request with:
  - title + subject
  - signers (name/email)
  - embedded signing enabled
  - metadata (custom_fields if available; otherwise map in HRX doc)

**Important:** HRX uses Firebase UID as canonical identity.  
Dropbox Sign generally keys signers by email; HRX stores the linkage (`userId`) in its own envelope doc.

### 6.2 Embedded signing URL
- Request an embedded signing URL for a signer
- Return URL points back to HRX signer page return handler:
  - `https://sign.hrxone.com/return/{sessionId}` or a deep-link back to app

### 6.3 Webhooks
- Verify webhook authenticity using provider’s HMAC header + app secret
- Parse event type(s) and map to normalized events:
  - viewed/signed/completed/declined/voided
- Update Firestore envelope + append `WEBHOOK_RECEIVED` and mapped event(s)
- On completed:
  - enqueue Cloud Task to download signed files

### 6.4 Download files
- Use provider API to fetch signed PDF and audit trail/certificate
- Store in Storage under signature artifacts path
- Update envelope `files.signedPdfRef` + `files.auditRef`
- Append `FILES_DOWNLOADED` event

---

## 7) Signing Session UX (Web + Flutter)
### 7.1 Flow
1) HRX client requests “Sign now”
2) Client calls callable: `signatureCreateSigningSession({ tenantId, envelopeId, signerId, returnUrl })`
3) Callable writes `signature_sessions/{sessionId}` and returns a URL:
   - `{ signerPageUrl: https://sign.hrxone.com/s/{sessionId} }`
4) Web app:
   - opens signer page in modal/new route
5) Flutter app:
   - opens signer page in in-app WebView

### 7.2 Signer page behavior (hosted web route)
Route: `/s/{sessionId}`
- Loads session doc (backend endpoint or callable)
- If expired → show message
- Calls backend endpoint to fetch (or regenerate) embedded signing URL
- Renders provider’s embedded signing (iframe) in the page
- On completion, redirects to `returnUrl` or shows “Done”

**Note:** For Dropbox Sign, ensure the signer page domain is configured/verified as required.

---

## 8) Public/Worker Views (Recommended)
To minimize risk of exposing provider metadata, create a mirror:
- `tenants/{tenantId}/signature_envelopes_public/{envelopeId}`
  - `{ tenantId, userId, envelopeId, public: { status, statusDisplay, signedPdfDownloadUrl? }, updatedAt }`

Worker UI reads only from the public mirror, similar to E-Verify.

---

## 9) Integration Points with HRX Onboarding
### 9.1 Entity-level mapping
In `entities/{entityId}` add:
- `defaultDocumentBundleId`
- optional bundle overrides by workerType/jobType

### 9.2 Resolution hierarchy
- Job Order may specify `documentBundleId`
- Else entity default
- Else tenant default

### 9.3 Onboarding steps
- When onboarding instance is created/resolved, include signature steps like:
  - `SIGN: employment agreement`
  - `SIGN: handbook acknowledgement`
- Step completion occurs when envelope reaches `completed`

**Important:** Triggering/sending can stay flexible—this spec focuses on the signature infra.

---

## 10) Implementation Plan
### Phase S0 — Foundation now (no provider creds required)
1) Firestore collections + types + rules
2) Storage structure for templates + signed artifacts
3) Admin UI for:
   - Document Templates (upload PDF, set metadata, version)
   - Document Bundles (assemble templates + signer roles)
4) Envelope model + events + basic admin list view
5) Signing sessions model + signer page route scaffold
6) Provider abstraction + `stubProvider` for local testing
7) Webhook endpoint scaffold (verification can be stubbed)

**Acceptance**
- Can create envelopes in stub mode
- Can generate signer sessions and view signer page (shows placeholder)
- Events append correctly

### Phase S1 — Dropbox Sign sandbox integration (when creds arrive)
1) Implement `dropboxSignProvider.createEnvelope()`:
   - download PDFs from Storage to temp
   - upload to provider + create signature request
2) Implement `getEmbeddedSigningUrl()`
3) Implement webhook verification + event parsing
4) Implement file downloads + Storage writes
5) End-to-end tests:
   - web flow
   - flutter webview flow
   - completed doc stored + envelope updated

**Acceptance**
- Completed envelope has `files.signedPdfRef` and audit ref
- Worker sees public status + (optional) download link

### Phase S2 — Production hardening
1) Task/reminder hooks (optional)
2) Rate limits + retry policy for downloads
3) Better admin ops: resend, void, reissue, bulk sends
4) Add DocuSign provider later without schema changes

---

## 11) Minimal Required Callables / HTTP Endpoints
### Callables
- `signatureCreateEnvelope` (admin/recruiter): creates HRX envelope + provider request
- `signatureCreateSigningSession` (signer/admin): returns signer page URL
- `signatureGetSession` (for signer page): returns session info (safe)
- `signatureAdminListEnvelopes` (admin): server-side list/filter
- `signatureAdminVoidEnvelope` (admin): cancel/void provider + update HRX

### HTTP endpoints
- `POST /webhooks/signatures/dropboxsign` (provider webhook)
- `GET /signing/session/{sessionId}/url` (returns embedded signing URL; signer-page-only)

---

## 12) Notes on Identity (Email vs UID)
- Providers often key signers by **email**.
- HRX canonical identity is `userId` (Firebase UID).
- HRX stores signer linkage: `{ userId, email }`.
- If a user changes email:
  - HRX updates user profile
  - Future envelopes use new email
  - Old envelopes remain tied to original email in signers[] for audit

---

## 13) “Done for Now” Checklist (pre-credentials)
This signature system is considered “done for now” when:
- Document templates + bundles can be managed in Settings
- Envelopes can be created (stub mode) and sessions generated
- Signer page exists and works in Web + Flutter (stub)
- Webhook endpoint exists (verification stubbed if needed)
- Data model + rules are stable and provider-agnostic

Once creds arrive, only the Dropbox Sign adapter + webhook verification + file downloads are needed.

---

## 14) Future Provider: DocuSign (Enterprise add-on)
Because HRX uses a provider interface, DocuSign becomes:
- Implement `docusignProvider.ts`
- No Firestore schema changes
- Tenant setting chooses provider per tenant/entity if needed

---

## Appendix A — Suggested UI (Settings)
- **Settings → Documents**
  - Templates tab (upload/manage PDFs, versioning, activate/retire)
  - Bundles tab (assemble workflow packs)
- **Entity Detail → Documents**
  - default bundle selector
  - entity-specific overrides (optional)
- **User Profile → Compliance**
  - signature status card (reads public mirror)
- **Admin Ops → Signatures**
  - list/search/filter envelopes
  - view events
  - download signed artifacts

---

## Appendix B — Storage Rule Notes
- Templates readable to tenant admins/recruiters
- Signed artifacts readable:
  - admin/tenant roles
  - optionally workers for their own artifacts (via signed URL or public mirror download callable)

**Recommended:** Provide downloads via callable that checks authorization and returns a short-lived signed URL.
