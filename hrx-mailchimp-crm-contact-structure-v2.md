# HRX ↔ Mailchimp: CRM Contact Structure + Marketing Header UI (v2)

## 1. Goals

1. Make every `crm_contact` “Mailchimp-ready” with:
   - Clean identity fields (email, name, company, role).
   - Structured **industry segment** (Healthcare, Hospitality, Industrial, None).
   - Reusable **marketing tags** for targeting and Mailchimp segments.

2. Surface this clearly in the **CRM contact header**:
   - New **“Marketing”** line directly under the email line.
   - Chips showing:
     - Auto-assigned tags (e.g. company + job title).
     - Optional manual tags.
   - A dropdown to choose **industry segment**.

3. Use the same data for:
   - On-demand exports (CSV).
   - Direct Mailchimp API sync.

---

## 2. Data Model: `crm_contacts`

### 2.1 Core Fields (existing / unchanged)

```ts
type CrmContactIndustrySegment = 'healthcare' | 'hospitality' | 'industrial' | 'none';

interface CrmContact {
  id: string;

  // Identity
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;

  // Company / role
  companyId?: string;         // FK → companies/{id}
  companyName?: string;       // denormalized for fast display / export
  jobTitle?: string;

  // Status / metadata
  createdAt: FirebaseTimestamp;
  updatedAt: FirebaseTimestamp;
  isActive?: boolean;

  // --- NEW marketing fields ---
  /**
   * High-level segment for targeting + Mailchimp interest groups.
   * Selected via dropdown in the contact header.
   */
  industrySegment: CrmContactIndustrySegment;

  /**
   * All marketing tags applied to this contact.
   *
   * Includes:
   * - Auto tags (prefixed, e.g. "company:Sodexo", "role:Catering Services Coordinator")
   * - Manual tags chosen by user (e.g. "Sodexo Pilot", "Decision Maker")
   *
   * UI will visually differentiate auto vs manual.
   */
  marketingTags: string[];

  /**
   * Optional notes about why this contact is on marketing lists
   * (for compliance / future audits).
   */
  marketingNotes?: string;

  /**
   * Whether this contact is currently eligible for marketing campaigns.
   * (Can be set to false if they unsubscribe or bounce in Mailchimp.)
   */
  marketingEnabled: boolean;

  /**
   * Mailchimp metadata (if synced)
   */
  mailchimp?: {
    subscriberId?: string;         // Mailchimp contact ID
    lastSyncedAt?: FirebaseTimestamp;
    lastStatus?: 'subscribed' | 'unsubscribed' | 'cleaned' | 'pending' | 'archived';
    lastError?: string;            // last sync error message (for debugging)
  };
}
```

### 2.2 Auto-assigned marketing tags

When a contact has `companyName` and/or `jobTitle`, we generate **auto tags**:

```ts
function getAutoMarketingTags(contact: CrmContact): string[] {
  const tags: string[] = [];
  if (contact.companyName) {
    tags.push(`company:${contact.companyName}`); // e.g. "company:Sodexo"
  }
  if (contact.jobTitle) {
    tags.push(`role:${contact.jobTitle}`);       // e.g. "role:Catering Services Coordinator"
  }
  return tags;
}
```

These **auto tags are not stored separately**; they are re-derived on the fly.  
`marketingTags` stores **all tags** actually synced to Mailchimp. The UI will:

- Ensure that all `getAutoMarketingTags(contact)` values are present in `marketingTags`.
- Mark those chips as **non-removable / “auto”**.
- Allow user to add/remove **manual** tags.

---

## 3. New CRM Contact Header UI

### 3.1 Location

On the CRM contact page header:

- Current lines:

  - Line 1: Contact name (e.g. `Billie Sneed`)
  - Line 2: Email + ID + created date

- **Add a new line directly below email line:**

  ```text
  Marketing  [ Sodexo ] [ Catering Services Coordinator ]  |  Segment: [ Hospitality ▼ ]
  ```

### 3.2 Component structure

File suggestion:

- `src/components/crm/contacts/ContactHeaderMarketing.tsx`

```tsx
interface ContactHeaderMarketingProps {
  contact: CrmContact;
  onUpdateMarketing: (update: {
    industrySegment?: CrmContactIndustrySegment;
    marketingTags?: string[];
  }) => void;
}
```

**Behavior:**

1. **Auto-tags chips**

   - Compute `autoTags = getAutoMarketingTags(contact)`.
   - Compute `manualTags = contact.marketingTags.filter(t => !autoTags.includes(t))`.

2. **Visual layout (MUI):**

   ```tsx
   <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
     {autoTags.map(tag => (
       <Chip
         key={tag}
         label={formatTagLabel(tag)}
         size="small"
         color="default"
         variant="outlined"
       />
     ))}

     {manualTags.map(tag => (
       <Chip
         key={tag}
         label={tag}
         size="small"
         color="primary"
         onDelete={() => handleRemoveManualTag(tag)}
       />
     ))}
   </Stack>
   ```

3. **Industry segment dropdown**

```ts
const INDUSTRY_OPTIONS: { value: CrmContactIndustrySegment; label: string }[] = [
  { value: 'none',         label: 'None' },
  { value: 'healthcare',   label: 'Healthcare' },
  { value: 'hospitality',  label: 'Hospitality' },
  { value: 'industrial',   label: 'Industrial' },
];
```

### 3.3 Formatting helper

```ts
function formatTagLabel(tag: string): string {
  if (tag.startsWith('company:')) return tag.replace(/^company:/, '');
  if (tag.startsWith('role:')) return tag.replace(/^role:/, '');
  return tag;
}
```

---

## 4. Firestore Schema & Updates

### 4.1 Firestore path

```
/tenants/{tenantId}/crm_contacts/{contactId}
```

### 4.2 Example document

```json
{
  "firstName": "Billie",
  "lastName": "Sneed",
  "email": "Billie.sneed@sodexo.com",
  "phone": "3256701453",
  "companyId": "sodexo-id",
  "companyName": "Sodexo",
  "jobTitle": "Catering Services Coordinator",
  "industrySegment": "hospitality",
  "marketingTags": [
    "company:Sodexo",
    "role:Catering Services Coordinator",
    "sodexo-pilot"
  ],
  "marketingNotes": "Key contact at Sodexo Arlington site",
  "marketingEnabled": true
}
```

---

## 5. Mailchimp Mapping

1. **Email** → `email_address`
2. **Name** → `merge_fields.FNAME` / `LNAME`
3. **Company** → `merge_fields.COMPANY`
4. **Job Title** → `merge_fields.TITLE`
5. **Industry segment** → `merge_fields.INDUSTRY`
6. **Marketing tags** → Mailchimp tag array

---

## 6. Implementation Steps

1. Add fields to `CrmContact`
2. Add header UI
3. Add dropdown + chip logic
4. Wire updates to Firestore
5. Sync to Mailchimp later
