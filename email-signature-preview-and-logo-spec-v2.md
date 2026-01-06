# Email Signature Preview + Logo Integration Spec
HRX / C1 Staffing – Profile → Email Signature

Owner: Greg  
Target: React + TypeScript + Firebase (Firestore + Storage)  
Scope: **Preview-only UI + render function**, NOT Gmail API plumbing.

---

## 1. Goals

1. Show a **live, accurate preview** of the user’s email signature on the Profile page.
2. Pull **company logo** from the active tenant’s branding (tenant avatar) and render it **to the left** of the text.
3. Remove the literal `, C1 Staffing` suffix from the job title in the preview and outbound HTML.
4. Ensure the preview uses the **same HTML** that will be injected into outbound messages so there’s no divergence.
5. Keep the output **email-client safe** (Gmail, Outlook, Apple Mail).

---

## 2. Data Model

### 2.1 User Profile Fields (existing)

Source: `users/{userId}` (or equivalent HRX users collection)

Required for signature:

```ts
interface UserProfile {
  id: string
  fullName: string               // "Greg Fielding"
  jobTitle: string               // "Chief Executive Officer"
  phoneNumber: string            // "(925) 448-0579"
  email: string                  // "g.fielding@c1staffing.com"
  location?: string              // Optional, e.g. "Austin, TX"
  pronouns?: string              // Optional, e.g. "he/him"
  activeTenantId: string
  enableEmailSignature: boolean  // toggle
  includeConfidentialityNotice: boolean
}
```

### 2.2 Tenant Branding (existing)

Source: `tenants/{tenantId}`

```ts
interface Tenant {
  id: string
  companyName: string            // "C1 Staffing LLC"
  avatar?: string                // Public logo URL (Firebase Storage)
  website?: string               // "https://c1staffing.com"
  accentColor?: string           // "#0057B8" (if needed later)
}
```

### 2.3 Signature Render Data (derived)

We build a **clean DTO** used both for preview and for outbound signatures:

```ts
export interface SignatureData {
  fullName: string
  title: string
  phone: string
  email: string
  website?: string
  logoUrl?: string
  pronouns?: string
  location?: string
  showConfidentiality: boolean
}
```

Notes:

- `title` is **job title only** – no automatic concatenation with company name.
- `logoUrl` is optional. If missing, left column is hidden.
- `website` comes from tenant.website.
- `showConfidentiality` = `user.includeConfidentialityNotice`.

Helper mapping:

```ts
function buildSignatureData(user: UserProfile, tenant: Tenant | undefined): SignatureData {
  return {
    fullName: user.fullName,
    title: user.jobTitle, // DO NOT append ", C1 Staffing"
    phone: user.phoneNumber,
    email: user.email,
    website: tenant?.website,
    logoUrl: tenant?.avatar,
    pronouns: user.pronouns || undefined,
    location: user.location || undefined,
    showConfidentiality: user.includeConfidentialityNotice ?? false,
  }
}
```

---

## 3. Signature HTML Render Function

We centralize signature rendering in a **pure function**:

```ts
export function renderHtmlSignature(data: SignatureData): string
```

This function returns **full HTML** safe for email clients.

### 3.1 Layout Rules

- Two-column layout with a table (for Outlook compatibility).
- Left column: logo (if present).
- Right column: text block with name, title, phone, email, website.
- Font stack: `Arial, Helvetica, sans-serif`.
- Font size: 13–14px.
- Main text color: `#111111`.
- Links: standard blue (`#1155CC` or browser default).

### 3.2 HTML Structure (core)

```ts
export function renderHtmlSignature(data: SignatureData): string {
  const {
    fullName,
    title,
    phone,
    email,
    website,
    logoUrl,
    pronouns,
    location,
    showConfidentiality,
  } = data

  const lines: string[] = []

  // Name line (optionally with pronouns)
  const nameLine = pronouns
    ? `<strong>${escapeHtml(fullName)}</strong> <span style="font-weight:normal;color:#555;font-size:12px;">(${escapeHtml(pronouns)})</span>`
    : `<strong>${escapeHtml(fullName)}</strong>`

  lines.push(nameLine)

  if (title) {
    // IMPORTANT: title only, no company suffix
    lines.push(`${escapeHtml(title)}`)
  }

  if (phone) {
    lines.push(`${escapeHtml(phone)}`)
  }

  if (email) {
    lines.push(
      `<a href="mailto:${escapeHtml(email)}" style="color:#1155CC;text-decoration:none;">${escapeHtml(email)}</a>`,
    )
  }

  if (website) {
    const url = website.startsWith('http') ? website : `https://${website}`
    lines.push(
      `<a href="${escapeHtml(url)}" style="color:#1155CC;text-decoration:none;">${escapeHtml(website.replace(/^https?:\/\//, ''))}</a>`,
    )
  }

  if (location) {
    lines.push(`${escapeHtml(location)}`)
  }

  const textBlock = lines.join('<br/>\n')

  const logoCell = logoUrl
    ? `<td style="padding-right:14px;vertical-align:top;">
          <img src="${escapeHtml(logoUrl)}"
               alt="Company logo"
               style="height:60px;width:auto;border-radius:4px;display:block;" />
       </td>`
    : ''

  const tableHtml = `
<table cellpadding="0" cellspacing="0" role="presentation">
  <tr>
    ${logoCell}
    <td style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.4;color:#111111;">
      ${textBlock}
    </td>
  </tr>
</table>
`.trim()

  const confidentialityHtml = showConfidentiality
    ? `
<br/>
<div style="margin-top:8px;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.4;color:#777777;max-width:520px;">
  This email and any attachments may contain confidential information intended only for the recipient. If you received this message in error, please notify the sender and delete it.
</div>
`.trim()
    : ''

  return tableHtml + confidentialityHtml
}
```

Implementation details:

- Implement a simple `escapeHtml(str: string)` to avoid HTML injection.
- `logoUrl` must be a public HTTPS URL from Firebase Storage.
- Keep `height:60px` as a hard cap on logo display size.

---

## 4. React Signature Preview Component

File: `src/components/profile/SignaturePreview.tsx`

### 4.1 Props

```ts
interface SignaturePreviewProps {
  user: UserProfile | null
  tenant: Tenant | null
}
```

### 4.2 Behavior

- If `!user` → show skeleton/placeholder.
- If `user.enableEmailSignature === false` → show muted text: “Email signature is disabled.”
- Otherwise:
  - Build `SignatureData` with `buildSignatureData(user, tenant)`.
  - Generate HTML with `renderHtmlSignature(data)`.
  - Use `dangerouslySetInnerHTML` inside a card.

### 4.3 UI Layout

```tsx
export const SignaturePreview: React.FC<SignaturePreviewProps> = ({ user, tenant }) => {
  if (!user) {
    return (
      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Signature Preview
          </Typography>
          <Typography color="textSecondary">Loading profile…</Typography>
        </CardContent>
      </Card>
    )
  }

  if (!user.enableEmailSignature) {
    return (
      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Signature Preview
          </Typography>
          <Typography color="textSecondary">
            Email signature is currently disabled. Turn it on above to see a preview.
          </Typography>
        </CardContent>
      </Card>
    )
  }

  const data = buildSignatureData(user, tenant ?? undefined)
  const html = renderHtmlSignature(data)

  return (
    <Card sx={{ mt: 3 }}>
      <CardContent>
        <Typography variant="h6" gutterBottom>
          Signature Preview
        </Typography>
        <Typography color="textSecondary" sx={{ mb: 2 }}>
          This is how your email signature will appear in outgoing messages.
        </Typography>

        <Box
          sx={{
            borderRadius: 3,
            p: 3,
            bgcolor: '#F7F7F9',
          }}
        >
          <Box
            sx={{
              borderRadius: 3,
              bgcolor: '#FFFFFF',
              p: 3,
              display: 'inline-block',
              maxWidth: 520,
            }}
          >
            <div dangerouslySetInnerHTML={{ __html: html }} />
          </Box>
        </Box>
      </CardContent>
    </Card>
  )
}
```

Notes:

- Wrapper card and inner white “email” card should visually mirror the current screenshot.
- No extra styling inside the HTML other than inlined styles in `renderHtmlSignature` (email-safe).

---

## 5. Wiring Into Profile Page

Page: `src/pages/MyProfilePage.tsx` (or equivalent)

### 5.1 Data Fetching

Assuming hooks exist:

```ts
const { user } = useCurrentUser()
const { tenant } = useActiveTenant() // uses user.activeTenantId internally
```

Then include:

```tsx
<SignatureSettingsForm user={user} />  {/* existing controls */}

<SignaturePreview user={user} tenant={tenant} />
```

Whenever the user edits:

- Full Name
- Job Title
- Phone Number
- Email
- Pronouns
- Location
- Confidentiality toggle
- Signature enabled toggle

→ Save to Firestore and let the preview re-render using the latest `user` data.

---

## 6. Outbound Integration Hook (Optional but Recommended)

To keep preview and actual messages in sync, **reuse the same render function** on the send path.

Example: before sending an email from the app:

```ts
const data = buildSignatureData(user, tenant)
const signatureHtml = renderHtmlSignature(data)

const finalBodyHtml = `${emailBodyHtml}<br/><br/>${signatureHtml}`
```

This ensures:

- The **preview matches reality**.
- Any future changes (e.g., adding pronouns, new legal text) only require updates in one place.

---

## 7. Edge Cases & Fallbacks

1. **No Logo**  
   - Omit logo `<td>` completely. The text column shifts left with no awkward spacing.
2. **No Website**  
   - Omit website line entirely.
3. **No Phone**  
   - Omit phone line.
4. **No Pronouns**  
   - Render name without pronoun suffix.
5. **User changes tenant (multi-tenant)**  
   - `useActiveTenant()` refetches tenant → preview updates automatically with new logo + domain.
6. **Invalid or broken logo URL**  
   - The app should ensure `tenant.avatar` is a working URL; for now, failures just show a broken image icon in preview. Future improvement: add `<img onError>` handler in a React-only logo preview (not necessary inside the HTML function).

---

## 8. Acceptance Criteria

- [ ] Signature preview shows **name, title, phone, email, website** exactly like outbound messages.
- [ ] Job title line is **title only**, with **no appended company name** (no `, C1 Staffing`).
- [ ] Tenant logo renders **to the left** of the text with a max height of 60px.
- [ ] Toggling “Enable email signature” hides/shows the preview with appropriate helper text.
- [ ] Toggling “Include Confidentiality Notice” immediately adds/removes the legal blurb in the preview.
- [ ] Editing profile fields (name, title, phone, email, pronouns, location) updates the preview in real time.
- [ ] The same `renderHtmlSignature()` function is used by both the preview component and outbound email-sending code.
- [ ] Layout looks correct in Chrome dev tools when inspecting HTML in a blank email body container.

---

## 9. Implementation Order (for Cursor)

1. **Create** `SignatureData`, `buildSignatureData`, and `renderHtmlSignature` in `src/utils/signature.ts` (or similar).
2. **Implement** `SignaturePreview` React component (as above).
3. **Wire** `SignaturePreview` into the Profile page below the signature settings form.
4. **Update** any existing outbound email integration to use `renderHtmlSignature` instead of a hard-coded signature block.
5. **Manually QA** in dev:
   - Confirm the preview visually matches Greg’s Gmail signature (logo left, text right).
   - Switch tenants (if applicable) and confirm logo/domain update.
   - Toggle the confidentiality notice and confirm behavior.
