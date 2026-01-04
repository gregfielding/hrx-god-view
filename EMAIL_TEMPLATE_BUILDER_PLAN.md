# Email Template Builder - Implementation Plan

## Current State Analysis

### Existing SMS Template System
- **Location**: `src/pages/TenantViews/MessagingTab.tsx`
- **Backend**: Uses legacy Firebase callable functions (`getSmsTemplates`, `createSmsTemplate`, etc.)
- **UI**: Basic textarea for plain text SMS templates
- **Features**: 
  - Category-based organization
  - Trigger-based templates
  - Variable support (`{{firstName}}`, etc.)
  - Preview functionality
  - Enable/disable toggle

### New Unified Messaging System
- **Backend API**: `functions/src/messaging/templatesApi.ts`
  - `POST /api/messaging/templates` - Create template
  - `GET /api/messaging/templates` - List templates
  - `PATCH /api/messaging/templates/:id` - Update template
  - `DELETE /api/messaging/templates/:id` - Delete template
  - `GET /api/messaging/types` - Get message types
- **Template Structure**: `MessageTemplate` interface supports:
  - `channel`: 'sms' | 'email' | 'push'
  - `body`: string (for SMS/plain text)
  - `subject`: string (for email)
  - `htmlBody`: string (for email HTML - **not yet in API**)
  - `variables`: string[]
  - `messageTypeId`: links to Message Types Registry

### Existing Email Template Component
- **Location**: `src/components/EmailTemplatesManager.tsx`
- **Status**: Uses different collection (`email_templates`) - **NOT integrated with unified system**
- **UI**: Basic HTML textarea (no rich text editor)
- **Issue**: Separate from unified messaging system

---

## Implementation Plan

### Phase 1: Extend MessagingTab to Support Email Templates

#### 1.1 Update MessagingTab UI Structure
**File**: `src/pages/TenantViews/MessagingTab.tsx`

**Changes**:
1. Add channel selector to tabs:
   - Tab 0: "SMS Templates"
   - Tab 1: "Email Templates" (NEW)
   - Tab 2: "Recruiter Numbers" (existing)

2. Add channel filter state:
   ```typescript
   const [selectedChannel, setSelectedChannel] = useState<'sms' | 'email'>('sms');
   ```

3. Update template loading to use unified API:
   - Replace `getSmsTemplatesFn` with `listTemplatesApi` HTTP call
   - Filter by `channel` parameter
   - Map to unified `MessageTemplate` interface

#### 1.2 Integrate with Unified Template API
**New Functions**:
```typescript
// Replace old callable functions with HTTP API calls
const listTemplates = async (tenantId: string, channel: 'sms' | 'email') => {
  const response = await fetch(
    `https://us-central1-hrx1-d3beb.cloudfunctions.net/listTemplatesApi?tenantId=${tenantId}&channel=${channel}&active=true`
  );
  return response.json();
};

const createTemplate = async (template: MessageTemplate) => {
  const response = await fetch(
    'https://us-central1-hrx1-d3beb.cloudfunctions.net/createTemplateApi',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(template),
    }
  );
  return response.json();
};
```

#### 1.3 Update Template Interface
**New Interface** (unified):
```typescript
interface UnifiedMessageTemplate {
  id?: string;
  messageTypeId: string;
  channel: 'sms' | 'email' | 'push';
  language: 'en' | 'es';
  name: string;
  body: string;              // For SMS/plain text
  subject?: string;          // For email
  htmlBody?: string;         // For email HTML
  variables: string[];
  includeStopFooter: boolean;
  active: boolean;
  version: number;
  createdBy: string;
  createdAt?: Date;
  updatedAt?: Date;
}
```

---

### Phase 2: Add Rich Text Editor for Email Templates

#### 2.1 Choose Rich Text Editor Library
**Recommendation**: `react-quill` (lightweight, MUI-compatible)

**Installation**:
```bash
npm install react-quill quill
npm install --save-dev @types/react-quill
```

**Why react-quill**:
- Lightweight and fast
- Good MUI integration
- HTML output (works with `htmlBody` field)
- Variable insertion support
- Mobile-friendly

#### 2.2 Create EmailTemplateEditor Component
**New File**: `src/components/EmailTemplateEditor.tsx`

**Features**:
1. **Rich Text Editor** (react-quill):
   - Bold, italic, underline
   - Headings (H1, H2, H3)
   - Lists (ordered, unordered)
   - Links
   - Text alignment
   - Color picker
   - HTML source view toggle

2. **Variable Insertion**:
   - Dropdown/palette of available variables
   - Click to insert `{{variableName}}` at cursor
   - Variables extracted from Message Type Registry

3. **Dual View**:
   - Visual editor (WYSIWYG)
   - HTML source view (for advanced users)
   - Toggle between views

4. **Preview Pane**:
   - Live preview with sample data
   - Mobile/desktop view toggle
   - Subject line preview

5. **Template Structure**:
   - Subject line field (separate from body)
   - HTML body editor
   - Plain text fallback (auto-generated from HTML)

---

### Phase 3: Enhanced Template Dialog

#### 3.1 Update Template Dialog for Multi-Channel
**File**: `src/pages/TenantViews/MessagingTab.tsx`

**Dialog Structure**:
```
┌─────────────────────────────────────┐
│ Create Email Template               │
├─────────────────────────────────────┤
│ Template Name: [____________]        │
│ Message Type: [Dropdown ▼]          │
│ Channel: [SMS] [Email] [Push]      │
│ Language: [English ▼] [Spanish ▼]   │
│                                     │
│ ┌─ Subject Line ─────────────────┐ │
│ │ [Email subject here...]        │ │
│ └────────────────────────────────┘ │
│                                     │
│ ┌─ Email Body (HTML) ────────────┐ │
│ │ [Rich Text Editor]              │ │
│ │ [Variable Palette]              │ │
│ └────────────────────────────────┘ │
│                                     │
│ [Visual] [HTML] [Preview]           │
│                                     │
│ ☑ Include STOP footer (SMS only)   │
│ ☑ Active                            │
└─────────────────────────────────────┘
```

#### 3.2 Message Type Selector
- Fetch message types from `GET /api/messaging/types`
- Filter by channel support (show only types that support email)
- Group by category (System, Transactional, Compliance, etc.)
- Show description for each type

#### 3.3 Variable Management
- Auto-detect variables from template body (`{{variableName}}`)
- Show available variables from Message Type Registry
- Validate required variables
- Variable insertion buttons/palette

---

### Phase 4: Template Preview & Testing

#### 4.1 Preview Functionality
**Use**: `POST /api/messaging/test-render`

**Features**:
- Live preview as you type
- Sample data for variables
- Mobile/desktop responsive preview
- Subject + body preview
- Plain text fallback preview

#### 4.2 Test Send
- "Send Test Email" button in template editor
- Select recipient from user list
- Send via `POST /api/messaging/send`
- Show delivery status

---

### Phase 5: Template Library & Management

#### 5.1 Template List View
**Enhanced Table**:
- Channel badge (SMS/Email/Push)
- Message Type column
- Language badge
- Status (Active/Inactive)
- Last updated
- Actions: Edit, Duplicate, Delete, Preview

#### 5.2 Template Filtering
- Filter by channel
- Filter by message type
- Filter by language
- Filter by status
- Search by name

#### 5.3 Template Duplication
- "Duplicate" action
- Create copy with new name
- Option to change channel (SMS → Email conversion)

---

## Technical Implementation Details

### File Structure
```
src/
├── pages/TenantViews/
│   └── MessagingTab.tsx (enhanced)
├── components/
│   ├── EmailTemplateEditor.tsx (NEW)
│   ├── TemplateVariablePalette.tsx (NEW)
│   └── TemplatePreview.tsx (NEW)
└── utils/
    └── templateApi.ts (NEW - API helpers)
```

### API Integration Points

1. **List Templates**:
   ```typescript
   GET /api/messaging/templates?tenantId={id}&channel=email
   ```

2. **Get Message Types**:
   ```typescript
   GET /api/messaging/types?tenantId={id}
   ```

3. **Create Template**:
   ```typescript
   POST /api/messaging/templates
   {
     tenantId, messageTypeId, channel: 'email',
     language: 'en', name, subject, body, htmlBody,
     variables, active
   }
   ```

4. **Preview Template**:
   ```typescript
   POST /api/messaging/test-render
   {
     tenantId, messageTypeId, channel: 'email',
     language: 'en', context: { variables }
   }
   ```

### Backend Updates Needed

#### Update `createTemplateApi` to Support `htmlBody`
**File**: `functions/src/messaging/templatesApi.ts`

```typescript
const {
  tenantId,
  messageTypeId,
  channel,
  language,
  name,
  body,           // Plain text fallback
  subject,        // Email subject
  htmlBody,       // Email HTML body (NEW)
  variables,
  includeStopFooter = false,
  active = true,
} = request.body;
```

#### Update `MessageTemplate` Interface
**File**: `functions/src/messaging/templateEngine.ts`

Ensure `htmlBody` is properly stored and used:
```typescript
export interface MessageTemplate {
  // ... existing fields
  subject?: string;      // For email
  htmlBody?: string;     // For email HTML (ensure this is used)
  body: string;          // Plain text (fallback for email, primary for SMS)
}
```

---

## UI/UX Design Principles

### Design Standards (from memories)
- **Tabbed sections**: `<Box px={3} py={4}>` for content areas
- **Headings**: Typography variant 'h6' with fontWeight=700
- **Subheads**: Typography variant 'subtitle2' color text.secondary
- **Layout**: Stack direction='row' justifyContent='space-between' alignItems='center'
- **Tabs**: Icons with labels, active tab highlighted with bottom border
- **Border radius**: Zero for horizontal tabbed menus
- **Tables**: Compact with slight striping

### Email Template Editor Design
- **Split view**: Editor on left, preview on right (desktop)
- **Stacked view**: Editor above, preview below (mobile)
- **Variable palette**: Collapsible sidebar or floating palette
- **Toolbar**: Sticky toolbar with formatting options
- **Auto-save**: Draft auto-save every 30 seconds
- **Validation**: Real-time validation (required fields, variable syntax)

---

## Migration Strategy

### Step 1: Parallel Support
- Keep existing SMS template UI working
- Add email template tab alongside
- Both use unified API (different `channel` parameter)

### Step 2: Gradual Migration
- Migrate existing SMS templates to unified system (if needed)
- Update SMS template UI to use unified API
- Deprecate old `getSmsTemplates` callable functions

### Step 3: Consolidation
- Single template management interface
- Channel selector instead of separate tabs
- Unified template list with channel badges

---

## Testing Checklist

- [ ] Create email template via UI
- [ ] Edit email template
- [ ] Preview email template with variables
- [ ] Send test email
- [ ] Verify email received
- [ ] Check messageLogs entry created
- [ ] Test template rendering with real data
- [ ] Test variable substitution
- [ ] Test HTML rendering in email client
- [ ] Test plain text fallback
- [ ] Test multi-language templates
- [ ] Test template duplication
- [ ] Test template deletion
- [ ] Test template enable/disable

---

## Priority Order

1. **Phase 1**: Extend MessagingTab to support email (use basic textarea first)
2. **Phase 2**: Add rich text editor (react-quill)
3. **Phase 3**: Enhanced template dialog with message type selector
4. **Phase 4**: Preview & testing functionality
5. **Phase 5**: Template library enhancements

---

## Estimated Effort

- **Phase 1**: 4-6 hours (API integration, basic UI)
- **Phase 2**: 6-8 hours (Rich text editor, variable palette)
- **Phase 3**: 4-6 hours (Enhanced dialog, message type selector)
- **Phase 4**: 3-4 hours (Preview, test send)
- **Phase 5**: 4-6 hours (Filtering, duplication, enhancements)

**Total**: ~21-30 hours

---

## Next Steps

1. Review and approve this plan
2. Install react-quill dependency
3. Create EmailTemplateEditor component
4. Update MessagingTab to support email channel
5. Integrate with unified template API
6. Add preview and testing features
7. Polish UI/UX to match design standards

