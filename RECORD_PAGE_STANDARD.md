# Record Page Layout Standard

This document defines the canonical "Record Page Layout Standard" used across all record detail pages (Workers, Customers, Contacts, Companies, Job Orders, etc.).

## Overview

Record pages follow a consistent structure that provides identity information, primary actions, functional mode switching via tabs, and organized field groups in sectioned cards.

---

## 🎯 UX Principles

### 1️⃣ Title Bar = Identity + Primary Actions Only

**Never put secondary or destructive actions here.**

#### ✅ Keep:
- **Avatar** (left-aligned, **108px × 108px** - exact template size)
- **Three-line layout** aligned with avatar:
  1. **Full Name / Company Name / Job Order Title** (large, bold)
  2. **Primary CTA icons row** (call / message / email / docs / LinkedIn / notes)
  3. **Metadata subtitle line** (light grey, subtle): Email • ID • Created Date

#### 🔮 Status Chips (Future)
Examples:
- Worker: `Active` • `Candidate` • `Do-Not-Rehire`
- Job Order: `Open` • `Paused` • `Closed`
- Company: `Customer` • `Lead`

**Position:** To the right of the name, not below it.

#### ❌ Never Include:
- Secondary actions (edit, delete, etc.)
- Destructive actions
- Navigation breadcrumbs (handled by Layout)

---

### 2️⃣ Tabs = Functional Mode Switching

Tabs represent **what type of work you're doing**, not just more details.

#### Standard Tabs:
- **Overview** (default) - Identity, contact, basic info, alerts
- **Settings** - Permissions, system access, configuration
- **Activity** (future) - Timeline, audit log, changes
- **Attachments** (future) - Documents, files, uploads
- **Notes** (future) - Internal notes, flags, comments
- **Jobs / Applications** (future) - Related job orders, applications
- **Pay / Assignments** (future) - For workers
- **Conversations** (future) - Message threads, emails
- **Audit History** (future) - Admin-only detailed logs

**Rule:** Tabs = functional mode, not just more details.

---

### 3️⃣ Section Cards = Field Groups

Each section card represents a logical grouping of related fields.

#### Standard Sections:
- **Identity** - Full name, DOB, pronouns, emergency contact
- **Contact** - Phone, email, address, LinkedIn
- **Employment / Eligibility** - Work authorization, EEO data, employment type
- **Assignments / Job History** - Current and past assignments
- **Compliance** - I-9, background checks, certifications
- **System Access / Permissions** - Security level, module access, roles
- **Notes / Internal Flags** - Internal notes, warnings, flags

#### Each Card Should Support:
- ✅ Inline editing (pencil icon)
- ✅ Validation (required fields, format checks)
- ✅ Permission rules (hide/edit based on role)
- ✅ Last updated timestamp (future)
- ✅ Expandable/collapsible (future)

---

### 4️⃣ Inline Alerts = Only for Things That Need Fixing

Color-coded alert banners within sections:

#### 🔴 Red = Blocking Issue
Examples:
- I-9 missing
- Emergency contact missing
- No background check
- Work authorization expired

**Action Required:** User must fix before proceeding.

#### 🟡 Yellow = Recommended / Missing Enhancement
Examples:
- Date of birth missing
- Preferred pronoun missing
- Profile photo missing
- LinkedIn profile not linked

**Action Optional:** Improves record completeness but not blocking.

#### 🟢 No Banner = Record is Healthy
All required fields present, no warnings.

#### UX Rule:
- Banners should be **collapsible** (users hate clutter)
- Show "Add" or "Fix" action button
- Link directly to the relevant field/section

---

### 5️⃣ Right-Side Action Drawer (Future)

Universal right-hand drawer for common actions:
- Assign work
- Send message
- Update status
- Upload document
- Create note
- Add to campaign

**Implementation:** Use existing drawer pattern from Inbox/Slack.

---

## 🧠 Data Hierarchy & Scanability

### Field Display Pattern:

```
Field Label (bold, left-aligned)
Field Value (lighter, left-aligned)
[Action icon if applicable]
```

**Example:**
```
Full Name
Danny Rodriguez

Phone
(650) 710-0092  [Copy icon]
```

**NOT:**
```
Full Name: Danny Rodriguez
Phone: (650) 710-0092
```

### Typography Rules:
- **Labels:** Bold, 14px, dark grey
- **Values:** Regular, 14px, black
- **Icons:** 16-20px, primary color
- **Spacing:** 8px between label and value, 16px between fields

---

## 🔐 Role-Based Layout Rules

UI should adjust gracefully to permissions, not just hide buttons.

### Recruiter View (Security Level 5-6)
- ✅ Worker contact details
- ✅ Work eligibility status
- ✅ Assignments
- ❌ No payroll rates
- ❌ No HR notes marked confidential
- ❌ No margin data

### HR Admin (Security Level 7)
- ✅ Everything
- ✅ Internal warnings
- ✅ Margin data
- ✅ Confidential notes

### Customer Manager (Security Level 4)
- ✅ Worker contact details (assigned to their locations)
- ✅ Basic compliance status
- ❌ Internal warnings
- ❌ Margin data
- ❌ Confidential HR notes

**Rule:** Don't just hide fields - adjust the entire layout to show appropriate level of detail.

---

## 🧩 Reusable Layout Structure

This layout should work for:

### Workers
- Identity • Compliance • Assignments • Docs • Messages

### Applicants
- Identity • Screening • Interviews • Notes • Resume

### Customers / Companies
- Company Info • Contacts • Assignments • Billing • Docs

### Job Orders
- Scope • Locations • Pay • Assignments • Activity • Messages

### Contacts
- Identity • Contact • Company • Conversations • Notes

---

## 📐 Component Structure

```tsx
<Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
  {/* PageHeader with avatar, name, icons, metadata, primary actions */}
  <PageHeader
    title={
      <Box>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2.5 }}>
          {/* Avatar - 108px × 108px */}
          <Avatar
            src={avatarUrl || undefined}
            sx={{
              width: 108,
              height: 108,
              bgcolor: 'primary.main',
              fontSize: '40px',
              fontWeight: 600,
              flexShrink: 0,
            }}
          >
            {!avatarUrl && initials}
          </Avatar>
          
          {/* Three-line content area - matches avatar height */}
          <Box sx={{ 
            flex: 1, 
            minWidth: 0, 
            display: 'flex', 
            flexDirection: 'column', 
            justifyContent: 'space-between', 
            minHeight: 108 
          }}>
            {/* Line 1: Name */}
            <Typography
              variant="h6"
              sx={{
                fontSize: { xs: '20px', md: '24px' },
                fontWeight: 600,
                lineHeight: 1.2,
                mb: 1,
              }}
            >
              {fullName || 'Record Name'}
            </Typography>
            
            {/* Line 2: Contact Action Icons Row */}
            <Stack 
              direction="row" 
              spacing={0.5} 
              alignItems="center" 
              flexWrap="wrap" 
              sx={{ mb: 1 }}
            >
              {/* Primary action icons (phone, message, email, docs, LinkedIn, notes) */}
              {/* Icon styling: p: 1, 20px icons, primary color, hover effects */}
            </Stack>
            
            {/* Line 3: Metadata subtitle */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
              {/* Email • ID • Created Date */}
              {/* Typography: 14px, rgba(0, 0, 0, 0.55), bullet separators rgba(0, 0, 0, 0.3) */}
            </Box>
          </Box>
        </Box>
      </Box>
    }
    filters={<Tab buttons>}
    rightActions={<Primary CTAs + Back button>}
  />

  {/* Tab Content Area (standard: scroll + 16px bottom padding) */}
  <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', px: { xs: 2, md: 3 }, pb: 2 }}>
    {/* Section Cards */}
    <SectionCard title="Basic Identity">
      {/* Inline alerts */}
      {/* Field groups with proper hierarchy */}
    </SectionCard>
  </Box>
</Box>
```

---

## 🎨 Visual Standards

### Avatar
- **Size: 108px × 108px** (exact template size)
- **Position**: Left of content, aligned with three-line layout
- **Font size for initials**: 40px
- **Fallback**: Initials in primary color, fontWeight: 600
- **Gap from content**: 2.5 (20px spacing)
- **Container height**: minHeight: 108px to match avatar

### Three-Line Layout Structure
The avatar (108px) aligns with a three-line content block:

1. **Line 1: Name**
   - Typography variant: h6
   - Font size: 20px (mobile) / 24px (desktop)
   - Font weight: 600
   - Line height: 1.2
   - Margin bottom: 8px (mb: 1)

2. **Line 2: Contact Action Icons**
   - Stack direction: row
   - Spacing: 0.5 (4px)
   - Icon size: 20px
   - Icon padding: 8px (p: 1)
   - Margin bottom: 8px (mb: 1)
   - Icons: Phone, Message, Email, Resume, LinkedIn, Notes

3. **Line 3: Metadata Subtitle**
   - Typography: body2, 14px
   - Color: rgba(0, 0, 0, 0.55)
   - Format: Email • ID • Created Date
   - Bullet separators: rgba(0, 0, 0, 0.3)
   - Gap between items: 8px (gap: 1)

**Container**: Uses `justifyContent: 'space-between'` to distribute lines evenly within 108px height

### Subtitle Metadata
- Font: 14px, regular weight
- Color: `rgba(0, 0, 0, 0.55)` (light grey)
- Format: `Email • ID • Created Date`
- Position: Below name, above tabs

### Section Cards
- Background: White
- Border: 1px solid `rgba(0, 0, 0, 0.08)`
- Border radius: 8px
- Padding: 16px
- Margin bottom: 16px between sections

### Alert Banners
- Red: `#f44336` background, white text
- Yellow: `#ff9800` background, dark text
- Padding: 12px 16px
- Border radius: 4px
- Margin: 8px 0

---

## 📋 Record Header Template (Copy-Paste Ready)

When applying the Record template to other layouts, use this exact structure:

```tsx
<PageHeader
  title={
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2.5 }}>
        {/* Avatar - 108px × 108px */}
        <Avatar
          src={avatarUrl || undefined}
          sx={{
            width: 108,
            height: 108,
            bgcolor: 'primary.main',
            fontSize: '40px',
            fontWeight: 600,
            flexShrink: 0,
          }}
        >
          {!avatarUrl && initials}
        </Avatar>
        
        {/* Three-line content area - 108px minHeight */}
        <Box sx={{ 
          flex: 1, 
          minWidth: 0, 
          display: 'flex', 
          flexDirection: 'column', 
          justifyContent: 'space-between', 
          minHeight: 108 
        }}>
          {/* Line 1: Name */}
          <Typography
            variant="h6"
            sx={{
              fontSize: { xs: '20px', md: '24px' },
              fontWeight: 600,
              lineHeight: 1.2,
              mb: 1,
            }}
          >
            {recordName || 'Record Name'}
          </Typography>
          
          {/* Line 2: Contact Action Icons */}
          <Stack 
            direction="row" 
            spacing={0.5} 
            alignItems="center" 
            flexWrap="wrap" 
            sx={{ mb: 1 }}
          >
            {/* IconButton examples */}
            <Tooltip title="Action">
              <IconButton
                size="small"
                sx={{ 
                  p: 1,
                  color: 'primary.main',
                  bgcolor: 'action.hover',
                  borderRadius: 1,
                  '&:hover': {
                    color: 'primary.dark',
                    bgcolor: 'primary.light',
                    transform: 'translateY(-1px)',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                  },
                  transition: 'all 0.2s ease'
                }}
              >
                <Icon sx={{ fontSize: 20 }} />
              </IconButton>
            </Tooltip>
          </Stack>
          
          {/* Line 3: Metadata subtitle */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            {email && (
              <Typography
                component="span"
                variant="body2"
                sx={{
                  fontSize: '14px',
                  fontWeight: 400,
                  color: 'rgba(0, 0, 0, 0.55)',
                }}
              >
                {email}
              </Typography>
            )}
            {recordId && (
              <>
                <Typography component="span" sx={{ color: 'rgba(0, 0, 0, 0.3)' }}>•</Typography>
                <Typography
                  component="span"
                  variant="body2"
                  sx={{
                    fontSize: '14px',
                    fontWeight: 400,
                    color: 'rgba(0, 0, 0, 0.55)',
                  }}
                >
                  ID: {recordId}
                </Typography>
              </>
            )}
            {createdAt && (
              <>
                <Typography component="span" sx={{ color: 'rgba(0, 0, 0, 0.3)' }}>•</Typography>
                <Typography
                  component="span"
                  variant="body2"
                  sx={{
                    fontSize: '14px',
                    fontWeight: 400,
                    color: 'rgba(0, 0, 0, 0.55)',
                  }}
                >
                  Created {formatDate(createdAt)}
                </Typography>
              </>
            )}
          </Box>
        </Box>
      </Box>
    </Box>
  }
  filters={
    <Box sx={{ display: 'flex', gap: 1 }}>
      <Button
        variant={activeTab === 'Overview' ? 'contained' : 'text'}
        sx={{
          borderRadius: '999px',
          fontSize: '14px',
          px: 1.5,
          py: 0.75,
          ...(activeTab === 'Overview' ? {
            bgcolor: '#0057B8',
            color: 'white',
            fontWeight: 500,
          } : {
            bgcolor: 'rgba(0, 0, 0, 0.04)',
            color: 'rgba(0, 0, 0, 0.7)',
            fontWeight: 400,
          }),
        }}
      >
        Overview
      </Button>
      {/* Add more tabs */}
    </Box>
  }
  rightActions={
    <Button
      variant="outlined"
      startIcon={<ArrowBackIcon />}
      onClick={() => navigate('/back-path')}
    >
      Back
    </Button>
  }
/>
```

### Key Dimensions (EXACT):
- **Avatar**: 108px × 108px
- **Avatar font size**: 40px
- **Container gap**: 2.5 (20px)
- **Container minHeight**: 108px
- **Name font size**: 20px mobile / 24px desktop
- **Icon size**: 20px
- **Icon padding**: 8px (p: 1)
- **Metadata font size**: 14px
- **Metadata color**: rgba(0, 0, 0, 0.55)

---

## 📝 Implementation Checklist

When creating a new record page:

- [ ] Use `PageHeader` component with **108px avatar** + three-line layout
- [ ] Line 1: Record name (h6, 20px/24px)
- [ ] Line 2: Contact action icons (20px icons, 8px padding)
- [ ] Line 3: Metadata subtitle (email • ID • created date, 14px)
- [ ] Container uses `justifyContent: 'space-between'` and `minHeight: 108px`
- [ ] Place primary action icons in header (call, message, email, etc.)
- [ ] Use filter buttons for tabs (Overview, Settings, etc.)
- [ ] Add Back button to `rightActions`
- [ ] Organize content into section cards
- [ ] Implement inline alerts (red/yellow) for missing data
- [ ] Use proper field hierarchy (label above value)
- [ ] Add horizontal padding to content area (16px mobile, 24px desktop)
- [ ] Add bottom padding (16px)
- [ ] Ensure proper scrolling (overflow-y: auto)
- [ ] Test role-based visibility rules

---

## 🔄 Migration Path

Existing record pages to update:
1. ✅ UserProfile (Workers) - In progress
2. ⏳ CustomerProfile (Companies)
3. ⏳ AgencyProfile (Agencies)
4. ⏳ ContactDetails (Contacts)
5. ⏳ JobOrderDetails (Job Orders)
6. ⏳ RecruiterContactDetails (Applicants)

Each should follow this standard for consistency.

