# Cross-System Mentions & Dashboard Post Composer
**Version:** v1  
**Context:** HRX / C1 internal app  
**Author:** ChatGPT (spec for Cursor implementation)  
**Scope:**  
- Internal `@`-mention system for users + CRM entities  
- Typed autocomplete in message inputs (chat, DMs, dashboard post composer)  
- Storing structured mention metadata in Firestore  
- Parsing + rendering mentions in UI  
- New “Post to Slack” style composer on Dashboard Feed  
- API + security rules for mentions + feed posts

---

## 1. Concepts & Goals

### 1.1 Goals

1. Allow users to **reference people and CRM entities** directly in messages and feed posts.  
2. Make mentions **clickable links** to:
   - Internal user profiles  
   - Contacts  
   - Companies  
   - Deals (future: jobs, candidates, etc.)  
3. Add a **Dashboard Post Composer** that posts to:
   - A linked Slack channel (e.g. `#general` by default)  
   - Internal `feed_posts` collection  
4. Build this **independent of Slack’s mention system** so:
   - No per-user Slack auth needed  
   - System works even if Slack changes / disappears  
5. Provide a strong foundation for:
   - Search (“all posts mentioning Bob Smith”)  
   - Notifications (“you were mentioned”)  
   - AI usage (structured context)

### 1.2 Mention Syntax (Initial)

We’ll treat mentions as plain text in the message but track them as structured metadata:

- `@` – **Internal User** (HRX user)  
  - Example: `@donna` or `@Donna Persson`  
- `#` – **Contact**  
  - Example: `#Bob Smith`  
- `&` – **Company**  
  - Example: `&Arcil`  
- `%` – **Deal**  
  - Example: `%Arcil Expansion`  

> NOTE: Prefixes are subject to change; keep them centralized in a const for easy updates.

---

## 2. Data Models

### 2.1 Mention Types

```ts
// src/types/mentions.ts

export type MentionType = 'user' | 'contact' | 'company' | 'deal';

export interface BaseMention {
  type: MentionType;
  id: string;           // Firestore doc ID
  label: string;        // Display label rendered in the UI
  slug?: string;        // Optional short slug (e.g., "donna")
}

export interface UserMention extends BaseMention {
  type: 'user';
  userId: string;       // Alias for id, if useful
}

export interface ContactMention extends BaseMention {
  type: 'contact';
  contactId: string;    // Alias for id
}

export interface CompanyMention extends BaseMention {
  type: 'company';
  companyId: string;
}

export interface DealMention extends BaseMention {
  type: 'deal';
  dealId: string;
}

export type Mention = UserMention | ContactMention | CompanyMention | DealMention;
```

### 2.2 Message / Feed Models

We’ll reuse one base interface for any “message-like” content that supports mentions.

```ts
// src/types/messageBase.ts

import type { Mention } from './mentions';

export interface MessageBase {
  id: string;
  tenantId: string;
  authorId: string;
  body: string;          // raw text with @/#/&/% tokens
  mentions: Mention[];   // structured mentions
  createdAt: Date;
  updatedAt?: Date;
}
```

#### 2.2.1 Slack-Bridged Chat Message

```ts
// src/types/chat.ts

import type { MessageBase } from './messageBase';

export interface ChatMessage extends MessageBase {
  channelId: string;      // internal Slack channel id or local channel id
  slackTs?: string;       // Slack timestamp ref (if posted to Slack)
  source: 'slack' | 'internal';
}
```

#### 2.2.2 Dashboard Feed Post

```ts
// src/types/feed.ts

import type { MessageBase } from './messageBase';

export type FeedPostVisibility = 'tenant' | 'team' | 'private';

export interface FeedPost extends MessageBase {
  // For routing / filtering
  targetChannelId?: string;     // Slack channel or internal channel id
  visibility: FeedPostVisibility;
  // For referencing a Slack message if posted
  slackChannelId?: string;
  slackTs?: string;
}
```

---

## 3. Firestore Schema

### 3.1 Collections

At the **tenant** level (multi-tenant safe):

```text
tenants/{tenantId}/
  feed_posts/{postId}
  messages/{messageId}        // optional; if we persist chat vs. Slack-only
  mentions_index/{mentionRefId}
```

#### 3.1.1 `feed_posts` Document

```ts
// tenants/{tenantId}/feed_posts/{postId}

{
  authorId: string,
  body: string,
  mentions: Mention[],      // serialized as plain objects
  visibility: 'tenant' | 'team' | 'private',
  targetChannelId?: string,
  slackChannelId?: string,
  slackTs?: string,

  createdAt: Timestamp,
  updatedAt: Timestamp,
}
```

#### 3.1.2 `mentions_index` (Optional, but recommended later)

Used to quickly query “all items where X was mentioned.”

```ts
// tenants/{tenantId}/mentions_index/{mentionRefId}

{
  mentionType: 'user' | 'contact' | 'company' | 'deal',
  mentionId: string,                 // points to entity (user/contact/company/deal)
  refType: 'feed_post' | 'message',  // or other
  refId: string,
  createdAt: Timestamp,
}
```

> This index can be generated in Cloud Functions on create/update of messages and posts.

---

## 4. React Autocomplete Input Behavior

### 4.1 Component: `RichTextInputWithMentions`

**File:** `src/components/common/RichTextInputWithMentions.tsx`

**Responsibility:**  
- Wrap MUI `TextField` (or textarea)  
- Detect mention prefixes as user types  
- Show dropdown suggestions  
- Insert selected mention as plain text (e.g., `@Donna`)  
- Emit raw text + associated mention metadata

```tsx
export interface MentionableEntity {
  id: string;
  type: MentionType;
  label: string;
  slug?: string;
}

export interface RichTextValue {
  text: string;
  mentions: Mention[];   // fully resolved mentions
}

interface Props {
  value: string;
  onChange: (value: RichTextValue) => void;
  placeholder?: string;
  autoFocus?: boolean;
}
```

### 4.2 Behavior Rules

1. User types any text.  
2. When they type `@`, `#`, `&`, or `%` followed by **at least 1 character**, we:  
   - Detect the trigger + search term via regex from the current caret position.  
   - Query an internal hook for suggestions.

3. Show suggestion list (MUI `Popper` + `List`) below the input:  
   - For `@` → search users  
   - For `#` → search contacts  
   - For `&` → search companies  
   - For `%` → search deals  

4. Arrow keys / Enter / Click to select.  
5. On selection:  
   - Replace the typed pattern with a cleaned label:  
     - e.g., user typed `@don` → input becomes `@Donna Persson`  
   - Add a `Mention` object to the `mentions` array in emitted `RichTextValue`.

6. On any text edit:  
   - Keep the `mentions` array in sync by:  
     - Option A (simple): Always re-run parsing from scratch on blur/submit.  
     - Option B: Track mention positions. *(Start with A to ship faster.)*

> Use **Option A**: For v1, treat `mentions` as derived from `text` on submit.

### 4.3 Hooks for Search

```ts
// src/hooks/useMentionSearch.ts

export const useMentionSearch = () => {
  const searchUsers = async (query: string) => { /* Firestore / API query */ };
  const searchContacts = async (query: string) => { /* ... */ };
  const searchCompanies = async (query: string) => { /* ... */ };
  const searchDeals = async (query: string) => { /* ... */ };

  return {
    searchUsers,
    searchContacts,
    searchCompanies,
    searchDeals,
  };
};
```

---

## 5. Parsing Rules

### 5.1 Parsing on Submit

On submit (e.g., creating a feed post or sending a chat message), we derive mentions from the plain text.

**Regex approach:**

```ts
// src/utils/mentions/parseMentions.ts

const MENTION_REGEX = /([@#&%])([^\s.,!?]+)/g;
// Group 1: prefix; Group 2: token (until space or basic punctuation)
```

**Flow:**

1. Scan text with `MENTION_REGEX`.  
2. For each match, call a **resolver** that maps prefix + token → entity.

```ts
// Pseudo-code
resolveMention(prefix: '@' | '#' | '&' | '%', token: string): Promise<Mention | null>
```

3. Build `mentions: Mention[]` from successful resolutions.  
4. Save text **as-is** plus `mentions` array to Firestore.

> If an entity can’t be found (e.g., token typo), we still keep the raw text but **no Mention object** is created.

### 5.2 Rendering Mentions

We render text by splitting on the same regex and mapping to React nodes.

```tsx
// src/components/common/RenderedTextWithMentions.tsx

// props: { text: string; mentions: Mention[] }

// Step 1: Build a map from label or slug → Mention
// Step 2: When you see `@Donna` token, look up mention and wrap with <Link>
```

**Link targets:**
- `user` → `/users/{id}`  
- `contact` → `/crm/contacts/{id}`  
- `company` → `/crm/companies/{id}`  
- `deal` → `/crm/deals/{id}`  

---

## 6. Dashboard Feed Post Composer

### 6.1 UI Wireframe (Text)

**Location:** Top of Dashboard Feed page.

```
+-----------------------------------------------------------+
| [ Avatar ]  What’s happening, Greg?                      |
|                                                           |
| [ RichTextInputWithMentions .......................... ] |
|                                                           |
| Channel: [ #general ▼ ]     Visibility: [ Tenant ▼ ]     |
| [ Cancel ]                        [ Post ]               |
+-----------------------------------------------------------+
```

### 6.2 Component Structure

- `DashboardFeedComposer.tsx`
  - Uses `RichTextInputWithMentions`
  - Channel selector (MUI `Select`) – initial options:  
    - `#general`  
    - `#sales`  
    - `#dev`  
  - Visibility selector – initial options:  
    - `Tenant` (everyone)  
    - `Team` (future: teams)  
    - `Private` (just self + admins)  
  - Buttons: `Cancel`, `Post`

### 6.3 Submission Flow

1. User enters text with mentions.  
2. On `Post`:
   - Disable button, show loading.  
   - Call `/feedCreatePost` Cloud Function:
     - Pass `tenantId`, `authorId`, `body`, `targetChannelId`, `visibility`.  
   - On server, run **parsing & resolution** again (server is source of truth).  
   - Save `feed_posts` document (includes `mentions`).  
   - Push to Slack (if `targetChannelId` maps to Slack).  
   - Optionally create `mentions_index` docs for each mention.

3. Frontend listens to `feed_posts` changes via `useDashboardFeed` and renders the new post.

---

## 7. API Endpoints (Cloud Functions)

> All endpoints are **callable functions** scoped per tenant.

### 7.1 `feedCreatePost`

**Path:** `feedCreatePost`  
**Type:** `httpsCallable`

**Request:**

```ts
interface FeedCreatePostRequest {
  tenantId: string;
  body: string;
  targetChannelId?: string;          // e.g., 'slack-#general' or internal id
  visibility: FeedPostVisibility;
}
```

**Response:**

```ts
interface FeedCreatePostResponse {
  postId: string;
}
```

**Server Flow:**

1. Verify auth + tenant access.  
2. Parse mentions (`parseMentions` backend version).  
3. Build `FeedPost` object and write to Firestore.  
4. If `targetChannelId` is Slack-backed:
   - Compose Slack text (optionally with simplified mentions like plain text).
   - Send via Slack API using app-level token.  
   - Save `slackChannelId` + `slackTs`.  
5. Create `mentions_index` docs.  
6. Return `postId`.

### 7.2 `mentionsSearchEntities` (optional helper)

If we want the backend to handle autocomplete:

**Request:**

```ts
interface MentionsSearchRequest {
  tenantId: string;
  prefix: '@' | '#' | '&' | '%';
  query: string;
  limit?: number;
}
```

**Response:**

```ts
interface MentionsSearchResponse {
  results: MentionableEntity[];   // { id, type, label, slug? }
}
```

For v1 we can implement search directly via Firestore from the client, but this endpoint is cleaner for permission logic.

---

## 8. Security Rules (Firestore)

> Pseudo rules, to be translated into actual `firestore.rules` syntax.

Assume we have context:

```js
request.auth.uid           // current user id
request.auth.token.tenantId
request.auth.token.role    // e.g., 'Admin', 'Manager', 'User'
```

### 8.1 `feed_posts`

```js
match /tenants/{tenantId}/feed_posts/{postId} {
  allow read: if isTenantMember(tenantId);

  allow create: if isTenantMember(tenantId)
                && request.resource.data.authorId == request.auth.uid;

  allow update: if (
      isAdmin(tenantId)
      || (request.auth.uid == resource.data.authorId
          && isReasonableUpdate(request.resource.data, resource.data))
  );

  allow delete: if isAdmin(tenantId);
}
```

**Helper Ideas:**

```js
function isTenantMember(tenantId) {
  return request.auth != null && request.auth.token.tenantId == tenantId;
}

function isAdmin(tenantId) {
  return isTenantMember(tenantId) && request.auth.token.securityLevel >= 7;
}

function isReasonableUpdate(newData, oldData) {
  // enforce immutable fields: tenantId, authorId, createdAt
  return newData.tenantId == oldData.tenantId
      && newData.authorId == oldData.authorId;
}
```

### 8.2 `mentions_index`

```js
match /tenants/{tenantId}/mentions_index/{mentionRefId} {
  allow read: if isTenantMember(tenantId);
  allow write: if false; // only backend (Cloud Functions) writes here
}
```

### 8.3 Entity Collections (for search & linking)

We must ensure that when searching users/contacts/companies for mentions, the client only reads entities they’re allowed to see. That’s mostly **existing CRM / Users rules**; we’re just reusing them.

For example:

```js
match /tenants/{tenantId}/contacts/{contactId} {
  allow read: if canViewContact(tenantId, contactId);
}
```

**Important:** The Mentions search endpoint (if implemented as a callable function) should also check permissions server-side when returning candidates.

---

## 9. UI Integration Points

### 9.1 Where to Use `RichTextInputWithMentions`

- Dashboard Feed Composer (`DashboardFeedComposer`)  
- Slack-like Message Composer (channel view)  
- Direct Message composer (DM modal)  
- [Future] Comments on Deals, Contacts, Jobs, etc.

### 9.2 Where to Use `RenderedTextWithMentions`

- Dashboard feed rows  
- Message bubbles in chat / DMs  
- Activity logs / timeline entries that contain mentions  

---

## 10. Implementation Steps (for Cursor)

### Step 1 — Core Mention Utilities
- [ ] Add `src/types/mentions.ts` and `src/types/messageBase.ts`.  
- [ ] Add `src/utils/mentions/parseMentions.ts`.  
- [ ] Add `src/components/common/RenderedTextWithMentions.tsx`.

### Step 2 — Autocomplete Input
- [ ] Implement `RichTextInputWithMentions` component with MUI + Popper.  
- [ ] Implement `useMentionSearch` (client-side Firestore search for now).

### Step 3 — Dashboard Composer
- [ ] Create `DashboardFeedComposer.tsx` using `RichTextInputWithMentions`.  
- [ ] Wire into Dashboard feed page above master feed table.  
- [ ] Save posts via `feedCreatePost` (mocked first).

### Step 4 — Backend API
- [ ] Implement `feedCreatePost` callable function.  
- [ ] Implement server-side `parseMentions` + resolver.  
- [ ] Persist `feed_posts` + optional `mentions_index`.  
- [ ] Integrate Slack posting, if channel mapped.

### Step 5 — Security & Permissions
- [ ] Update Firestore security rules to include `feed_posts` and `mentions_index`.  
- [ ] Add tests to ensure only tenant members can write posts.

### Step 6 — Rollout to Chat / DMs
- [ ] Replace existing text areas with `RichTextInputWithMentions`.  
- [ ] Reuse parsing + rendering there.  
- [ ] Optionally add “Mentions” filter in feed (`source: 'mentions'`).

---

## 11. Notes & Future Enhancements

- Add **notifications** when a user is mentioned:  
  - Create `notifications` doc per mention (Cloud Function).  
  - Surface a bell icon in the top nav.  

- Support **hover cards** on mentions:  
  - e.g., hover `@Donna` → small card with role, contact info, quick links.

- Add **AI-level usage**:  
  - Summaries per contact/company/deal based on mention history.  

- Extend mention prefixes/types:  
  - Candidates, Jobs, Locations, etc.  

This spec should give you everything you need in Cursor to implement cross-system mentions and the Dashboard feed composer with type-safe autocomplete, structured data, and secure Firestore storage.
