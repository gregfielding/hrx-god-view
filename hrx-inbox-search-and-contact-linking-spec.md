# HRX Inbox Search and Contact Linking Specification

## Overview

This specification defines the implementation of **search functionality** and **contact linking** for the HRX unified inbox system. These features enable users to quickly find emails and automatically link email participants to CRM contacts, providing context and relationship intelligence.

---

## 1. Search Functionality

### 1.1 Requirements

**Goal**: Enable fast, intuitive search across email threads, messages, and participants.

**User Stories**:
- As a user, I want to search emails by subject, sender, or content so I can quickly find specific conversations
- As a user, I want to see search suggestions as I type so I can discover relevant emails faster
- As a user, I want to filter search results by date, category, and read status so I can narrow down results
- As a user, I want to search within a specific thread so I can find specific messages in long conversations

### 1.2 Search Scope

**Searchable Fields**:
- **Subject** (exact match, partial match, case-insensitive)
- **Sender/From** (email address, display name)
- **Recipients/To** (email addresses)
- **Message Body** (plain text, HTML stripped)
- **Thread Participants** (all email addresses in thread)
- **Attachment Names** (if attachments exist)

**Search Modes**:
1. **Quick Search** (default): Searches subject, sender, and snippet only (fast, client-side or simple query)
2. **Full Search**: Searches all fields including message body (requires backend, may be slower)
3. **Thread Search**: Search within a specific thread's messages (when thread drawer is open)

### 1.3 UI/UX Design

#### 1.3.1 Search Bar Placement

**Location**: Top of inbox, above the email table, right-aligned or centered

**Design**:
```
┌─────────────────────────────────────────────────────────────┐
│ [📧 Email] [💬 SMS]                    [🔍 Search...] [Sync] │
└─────────────────────────────────────────────────────────────┘
```

**Component**: `InboxSearchBar.tsx`
- Material-UI `TextField` with search icon
- Placeholder: "Search emails..."
- Debounced input (300ms delay)
- Clear button (X) appears when text is entered
- Keyboard shortcut: `Cmd/Ctrl + K` to focus

#### 1.3.2 Search Suggestions (Autocomplete)

**Trigger**: Show suggestions after 2+ characters typed

**Display**:
- Dropdown below search bar
- Max 8 suggestions
- Grouped by type:
  - **Recent Searches** (if any)
  - **Matching Threads** (subject + sender)
  - **Matching Senders** (email addresses)
  - **Quick Filters** (e.g., "from:john@example.com", "subject:invoice")

**Suggestion Format**:
```
┌─────────────────────────────────────┐
│ Recent Searches                     │
│ • invoice payment                   │
│ • john smith                        │
├─────────────────────────────────────┤
│ Matching Threads                    │
│ 📧 Invoice #1234 - john@example.com │
│ 📧 Payment Confirmation - acme.com  │
├─────────────────────────────────────┤
│ Matching Senders                    │
│ 👤 John Smith <john@example.com>   │
│ 👤 Acme Corp <billing@acme.com>    │
└─────────────────────────────────────┘
```

#### 1.3.3 Search Results Display

**When Active**:
- Replace normal email table with search results
- Show search query at top: "Search results for: 'invoice'"
- Show result count: "Found 12 threads"
- Highlight matching text in results (subject, sender, snippet)
- Maintain same table layout as inbox (for consistency)

**Empty State**:
```
┌─────────────────────────────────────┐
│ 🔍 No results found                 │
│                                     │
│ Try:                                 │
│ • Different keywords                │
│ • Check spelling                    │
│ • Use filters (from:, subject:)     │
└─────────────────────────────────────┘
```

#### 1.3.4 Advanced Search Filters

**Filter Syntax** (Gmail-style):
- `from:john@example.com` - Search by sender
- `to:jane@example.com` - Search by recipient
- `subject:invoice` - Search by subject
- `has:attachment` - Threads with attachments
- `is:unread` - Unread threads only
- `is:starred` - Starred threads only
- `category:promotions` - Gmail category filter
- `before:2024-01-01` - Before date
- `after:2024-01-01` - After date

**Filter UI**:
- Parse filter syntax from search bar
- Show active filters as chips below search bar
- Click chip to remove filter
- Add filter button opens dropdown with common filters

### 1.4 Backend API

#### 1.4.1 Search Endpoint

**Function**: `searchEmailThreadsApi`

**Location**: `functions/src/messaging/searchApi.ts`

**Request**:
```typescript
GET /searchEmailThreadsApi?tenantId={tenantId}&userId={userId}&query={query}&limit={limit}&offset={offset}
```

**Query Parameters**:
- `tenantId` (required): Tenant ID
- `userId` (required): User ID (for permission filtering)
- `query` (required): Search query string
- `mode` (optional): `'quick'` | `'full'` (default: `'quick'`)
- `filters` (optional): JSON string of filter object
- `limit` (optional): Max results (default: 50)
- `offset` (optional): Pagination offset (default: 0)

**Response**:
```typescript
{
  success: true,
  threads: EmailThread[],
  totalCount: number,
  query: string,
  filters?: {
    from?: string;
    to?: string;
    subject?: string;
    hasAttachment?: boolean;
    isUnread?: boolean;
    isStarred?: boolean;
    category?: string;
    before?: string; // ISO date
    after?: string; // ISO date
  }
}
```

#### 1.4.2 Search Implementation Strategy

**Phase 1: Quick Search (Client-Side)**
- Filter existing `emailThreads` array in `UserInboxPage.tsx`
- Search subject, sender, and snippet only
- Fast, no API call needed
- Limited to currently loaded threads

**Phase 2: Backend Search (Firestore Queries)**
- Use Firestore `where` clauses for exact matches (from, to, subject)
- Use `array-contains` for participant search
- Client-side filtering for partial matches and body text
- Requires composite indexes for complex queries

**Phase 3: Full-Text Search (Optional)**
- Use Algolia, Elasticsearch, or Firebase Extensions
- Index message body content
- Support fuzzy matching and relevance scoring
- More complex, requires additional infrastructure

**Recommended**: Start with Phase 1, add Phase 2 for better results, Phase 3 only if needed.

#### 1.4.3 Search Query Parsing

**Function**: `parseSearchQuery(query: string)`

**Returns**:
```typescript
{
  text: string; // Remaining text after filters extracted
  filters: {
    from?: string;
    to?: string;
    subject?: string;
    hasAttachment?: boolean;
    isUnread?: boolean;
    isStarred?: boolean;
    category?: string;
    before?: Date;
    after?: Date;
  }
}
```

**Example**:
```
Input: "invoice from:john@example.com is:unread"
Output: {
  text: "invoice",
  filters: {
    from: "john@example.com",
    isUnread: true
  }
}
```

### 1.5 Implementation Files

**Frontend**:
- `src/components/InboxSearchBar.tsx` - Search bar component
- `src/components/SearchSuggestions.tsx` - Autocomplete dropdown
- `src/pages/UserInboxPage.tsx` - Integrate search, handle search state

**Backend**:
- `functions/src/messaging/searchApi.ts` - Search endpoint
- `functions/src/messaging/searchUtils.ts` - Query parsing, filtering logic

**Types**:
- `src/types/Inbox.ts` - Add `SearchQuery`, `SearchFilters` interfaces

---

## 2. Contact Linking

### 2.1 Requirements

**Goal**: Automatically link email participants to CRM contacts, and display contact information in the inbox UI.

**User Stories**:
- As a user, I want to see contact names and company information for email senders so I have context
- As a user, I want to quickly navigate to a contact's CRM profile from an email so I can see full relationship history
- As a user, I want to see which emails are linked to deals so I understand business context
- As a system, I want to automatically link emails to contacts when they match so relationships are maintained

### 2.2 Current Implementation

**Existing Logic** (in `gmailIntegration.ts`):
- During Gmail sync, emails are matched to CRM contacts by email address
- `contactId`, `companyId`, and `dealId` are stored in `email_logs`
- This linking happens during sync, not in real-time

**Gaps**:
- Email threads don't store contact/company/deal associations
- Inbox UI doesn't display contact information
- No way to manually link/unlink contacts
- No contact hover cards or quick actions

### 2.3 Enhanced Contact Linking

#### 2.3.1 Thread-Level Associations

**Add to `EmailThread` interface**:
```typescript
export interface EmailThread {
  // ... existing fields ...
  
  // Contact associations (derived from participants)
  participantContacts?: {
    email: string;
    contactId?: string;
    contactName?: string;
    companyId?: string;
    companyName?: string;
    dealIds?: string[]; // Most relevant deals
  }[];
  
  // Primary contact (most relevant for this thread)
  primaryContactId?: string;
  primaryCompanyId?: string;
  primaryDealId?: string;
}
```

**Update Logic**:
- When thread is created/updated, query CRM contacts for all participants
- Store contact/company/deal associations on thread
- Update associations when new messages are added

#### 2.3.2 Real-Time Contact Lookup

**Function**: `enrichThreadWithContacts(threadId: string, tenantId: string)`

**Process**:
1. Get thread participants (from, to, cc)
2. Query `crm_contacts` collection for matching emails
3. For each contact found:
   - Get company information
   - Get associated deals (most recent or active)
4. Update thread with associations
5. Return enriched thread data

**Performance**:
- Cache contact lookups (5-minute TTL)
- Batch queries when possible
- Use Firestore `in` queries for multiple emails

#### 2.3.3 Contact Display in UI

**Inbox Table Enhancements**:

1. **Sender Column**:
   - Show contact name if available (instead of just email)
   - Show company name below contact name (smaller, muted)
   - Show contact avatar if available
   - Badge for "Linked Contact" or "CRM Contact"

2. **Contact Hover Card**:
   - Hover over sender name/avatar
   - Show popover with:
     - Contact name, title, company
     - Phone number, email
     - Associated deals (if any)
     - Quick actions: "View Contact", "View Company", "View Deal"

3. **Thread Drawer**:
   - Show contact information in message headers
   - Link to contact profile
   - Show deal association if thread is linked to deal
   - "Link to Contact" button if not linked

**Example UI**:
```
┌─────────────────────────────────────────────┐
│ [JD] John Doe                    [Linked]   │
│     Acme Corp                               │
│     📧 john@acme.com                        │
│     📞 (555) 123-4567                       │
│                                             │
│     Associated Deals:                       │
│     • Deal #1234 - Q4 Contract             │
│                                             │
│     [View Contact] [View Company]           │
└─────────────────────────────────────────────┘
```

#### 2.3.4 Manual Linking

**Use Case**: When automatic linking fails or user wants to correct association

**UI**:
- In thread drawer, show "Link to Contact" button
- Opens contact picker/search dialog
- User selects contact, company, and/or deal
- Updates thread associations
- Option to "Unlink" if incorrectly linked

**API**:
```typescript
POST /linkEmailThreadApi/{threadId}
{
  tenantId: string;
  contactId?: string;
  companyId?: string;
  dealId?: string;
}
```

### 2.4 Contact Intelligence

#### 2.4.1 Contact Badges

**Display contextual information**:
- **"New Contact"** - First email from this contact
- **"VIP Contact"** - Contact with high-value deals
- **"Recent Deal"** - Thread linked to active/recent deal
- **"Unlinked"** - Email participant not in CRM (opportunity to add)

#### 2.4.2 Contact Suggestions

**When viewing unlinked emails**:
- Suggest creating contact from email
- Pre-fill contact form with email, name (if available)
- Quick action: "Add to CRM"

#### 2.4.3 Relationship Timeline

**In Contact Profile** (future enhancement):
- Show all email threads with this contact
- Timeline view of email interactions
- Integration with CRM activity log

### 2.5 Implementation Files

**Backend**:
- `functions/src/messaging/contactLinking.ts` - Contact enrichment logic
- `functions/src/messaging/emailThreadsApi.ts` - Update to include contact data
- `functions/src/messaging/linkThreadApi.ts` - Manual linking endpoint

**Frontend**:
- `src/components/ContactHoverCard.tsx` - Contact popover component
- `src/components/ContactLinkDialog.tsx` - Manual linking dialog
- `src/pages/UserInboxPage.tsx` - Display contact info in table
- `src/components/EmailThreadView.tsx` - Show contact info in drawer

**Types**:
- `functions/src/messaging/emailThreading.ts` - Update `EmailThread` interface
- `src/types/Inbox.ts` - Add contact-related types

---

## 3. Implementation Phases

### Phase 1: Basic Search (Week 1)
- ✅ Add search bar to inbox UI
- ✅ Client-side quick search (subject, sender, snippet)
- ✅ Search suggestions (recent searches, matching threads)
- ✅ Highlight matching text in results
- ✅ Empty state for no results

**Deliverables**:
- `InboxSearchBar.tsx` component
- Search state management in `UserInboxPage.tsx`
- Basic filtering logic

### Phase 2: Contact Display (Week 1-2)
- ✅ Enrich threads with contact data during sync
- ✅ Display contact names in inbox table
- ✅ Contact hover cards
- ✅ Link to contact profile

**Deliverables**:
- Contact enrichment in `gmailIntegration.ts`
- `ContactHoverCard.tsx` component
- Updated inbox table with contact info

### Phase 3: Advanced Search (Week 2)
- ✅ Backend search API
- ✅ Filter syntax parsing (from:, subject:, etc.)
- ✅ Search filters UI (chips)
- ✅ Full-text search (if needed)

**Deliverables**:
- `searchApi.ts` Firebase function
- Query parsing utilities
- Filter UI components

### Phase 4: Manual Linking & Intelligence (Week 3)
- ✅ Manual contact linking
- ✅ Contact badges and suggestions
- ✅ Deal association display
- ✅ "Add to CRM" quick action

**Deliverables**:
- `linkThreadApi.ts` endpoint
- `ContactLinkDialog.tsx` component
- Badge system and quick actions

---

## 4. Technical Considerations

### 4.1 Performance

**Search**:
- Debounce search input (300ms)
- Limit results to 50-100 initially
- Use pagination for large result sets
- Cache recent searches (localStorage)

**Contact Lookup**:
- Batch contact queries (use `in` operator)
- Cache contact data (5-minute TTL)
- Lazy load contact details (only on hover)
- Index `crm_contacts.email` field

### 4.2 Firestore Indexes

**Required Indexes**:
```json
{
  "collectionGroup": "emailThreads",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "tenantId", "order": "ASCENDING" },
    { "fieldPath": "participants", "order": "ASCENDING" },
    { "fieldPath": "lastMessageAt", "order": "DESCENDING" }
  ]
},
{
  "collectionGroup": "emailThreads",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "tenantId", "order": "ASCENDING" },
    { "fieldPath": "subject", "order": "ASCENDING" },
    { "fieldPath": "lastMessageAt", "order": "DESCENDING" }
  ]
}
```

### 4.3 Security

**Search**:
- Filter results by `userId` (users can only see their own threads)
- Respect tenant isolation
- Sanitize search query to prevent injection

**Contact Linking**:
- Verify user has permission to view contact
- Only link contacts in same tenant
- Audit log for manual linking actions

### 4.4 Error Handling

**Search**:
- Handle empty queries gracefully
- Show error message if search fails
- Fallback to client-side search if API fails

**Contact Linking**:
- Handle missing contacts gracefully (show email only)
- Handle duplicate contacts (use most recent)
- Log linking errors but don't fail thread creation

---

## 5. Testing Checklist

### 5.1 Search
- [ ] Search by subject (exact match)
- [ ] Search by subject (partial match)
- [ ] Search by sender email
- [ ] Search by sender name
- [ ] Search with filters (from:, subject:)
- [ ] Search suggestions appear
- [ ] Search results highlight matching text
- [ ] Empty state shows when no results
- [ ] Keyboard shortcut (Cmd/Ctrl + K) works
- [ ] Clear button clears search

### 5.2 Contact Linking
- [ ] Contact names display in inbox
- [ ] Company names display below contact names
- [ ] Contact hover card shows correct information
- [ ] "View Contact" link navigates correctly
- [ ] Unlinked emails show email address only
- [ ] Manual linking works
- [ ] Manual unlinking works
- [ ] Contact badges display correctly
- [ ] "Add to CRM" creates contact correctly

### 5.3 Integration
- [ ] Search works with all filters (unread, starred, category)
- [ ] Contact info displays in search results
- [ ] Contact linking persists after page refresh
- [ ] Performance is acceptable (< 500ms for search)

---

## 6. Future Enhancements

### 6.1 Advanced Search
- Full-text search with relevance scoring
- Search across attachments
- Search within specific date ranges
- Saved searches

### 6.2 Contact Intelligence
- Relationship strength scoring
- Email frequency analysis
- Contact engagement metrics
- Automated contact creation from emails

### 6.3 Integration
- Link emails to job orders
- Link emails to assignments
- Email-to-task conversion
- Email-to-note conversion

---

## 7. Success Metrics

**Search**:
- Average search time < 500ms
- Search usage rate > 30% of active users
- Average results per search: 5-20 threads

**Contact Linking**:
- Auto-link success rate > 80%
- Contact hover card usage > 50% of email views
- Manual linking usage < 10% (most should be automatic)

---

## Appendix: Component Structure

```
src/
├── components/
│   ├── InboxSearchBar.tsx          # Main search input
│   ├── SearchSuggestions.tsx        # Autocomplete dropdown
│   ├── SearchFilters.tsx            # Filter chips UI
│   ├── ContactHoverCard.tsx         # Contact popover
│   ├── ContactLinkDialog.tsx       # Manual linking dialog
│   └── ContactBadge.tsx            # Contact status badges
│
├── pages/
│   └── UserInboxPage.tsx           # Integrate search & contacts
│
└── types/
    └── Inbox.ts                    # Search & contact types

functions/src/messaging/
├── searchApi.ts                    # Search endpoint
├── searchUtils.ts                 # Query parsing
├── contactLinking.ts              # Contact enrichment
└── linkThreadApi.ts               # Manual linking endpoint
```

---

**Document Version**: 1.0  
**Last Updated**: 2025-01-XX  
**Author**: HRX Development Team




