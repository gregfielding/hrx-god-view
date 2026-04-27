# Email Signature Settings — Logo & Live Preview Spec

Owner: Greg / HRX One  
Status: Ready for implementation  
Scope: **My Profile → Email Signature** section (web app)

---

## 1. Goals

1. Add a **live signature preview** panel to the Email Signature section.
2. Render the preview in a way that closely matches how it will appear in Gmail / Outlook.
3. Add the **C1 logo to the left** of the signature content in a consistent, responsive layout.
4. Keep everything **driven by profile fields + template**, so we can roll this out to all team members with minimal manual editing.

This doc **extends** the previous email‑signature spec but is self‑contained so Cursor can implement from this file alone.

---

## 2. Data Model & Config

We’ll rely on existing user profile fields and add optional company‑level config for logos.

### 2.1 User profile (existing)

Assume these fields already exist in `users` collection / profile state:

```ts
type UserProfile = {
  id: string;
  fullName: string;
  jobTitle: string;
  phoneNumber: string;
  email: string;
  officeLocation?: string;  // "City, State" or custom
  pronouns?: string;
  enableEmailSignature: boolean;
  emailSignatureTemplateId: string;  // e.g. "default"
  includeConfidentialityNotice: boolean;
};
```

### 2.2 Company / tenant config (new / clarified)

Add (or confirm) tenant‑level settings, e.g. in `settings/general` or `tenants/{id}`:

```ts
type EmailBrandingSettings = {
  logoUrl: string;          // absolute https URL for logo (C1 yellow logo)
  logoWidthPx?: number;     // default 96
  logoHeightPx?: number;    // default 96
  websiteUrl: string;       // e.g. "https://www.c1staffing.com"
  companyName: string;      // "C1 Staffing"
};
```

If `logoUrl` is missing, we **fallback to a text‑only signature** preview.

---

## 3. UX & Layout — My Profile / Email Signature

### 3.1 Section layout

Within **My Profile → Email Signature** we now layout as:

1. **Toggle + Template selector** (existing)
2. **Profile fields** (Full Name, Job Title, Phone, Email, etc.) — existing
3. **Confidentiality notice toggle + text** — existing
4. **NEW: Live Signature Preview panel**

Below the existing fields, add a card:

> #### Signature Preview
> _This is how your signature will appear in emails._

Inside the card:

- A subtle light background (`#F8FAFC` style) with rounded corners.
- White inner area that mimics an email body: 600–680px max width.
- The signature HTML is rendered inside that inner area.

### 3.2 Two‑column signature layout (logo + text)

Use a **table layout** for the signature itself for maximum email‑client compatibility (not flex).

Visual:

```text
+----------------------------------------------------+
| [LOGO]  |  Greg Fielding                            |
|         |  925-448-0579                             |
|         |  g.fielding@c1staffing.com                |
|         |  www.c1staffing.com                       |
|         |  (optional pronouns)                      |
|         |  (optional office location)               |
+----------------------------------------------------+
|   (optional confidentiality notice text)           |
+----------------------------------------------------+
```

Spacing:

- Logo cell: 96x96 px max, centered vertically.
- Right cell: left‑aligned text with 4–8px line‑height spacing.

Typography (preview + final HTML):

- Name: bold, 15–16px.
- Job title: regular, 13–14px.
- Phone + email + website: 13–14px.
- Company name (if shown): 13–14px, can be appended after job title or as separate line.
- Confidentiality notice: 10–11px, gray (#6B7280).

---

## 4. Signature HTML Generator

Centralize generation in a helper so **preview + actual usage** are identical.

### 4.1 Helper function

Create `src/utils/emailSignature.ts`:

```ts
import type { UserProfile } from '@/types/UserProfile';
import type { EmailBrandingSettings } from '@/types/Settings';

export function buildEmailSignatureHtml(
  profile: UserProfile,
  branding: EmailBrandingSettings,
  options?: { asBlockquote?: boolean } // optional wrapper for replies
): string {
  const {
    fullName,
    jobTitle,
    phoneNumber,
    email,
    officeLocation,
    pronouns,
    includeConfidentialityNotice,
  } = profile;

  const {
    logoUrl,
    logoWidthPx = 96,
    logoHeightPx = 96,
    websiteUrl,
    companyName,
  } = branding;

  const safePhone = phoneNumber?.trim();
  const safeEmail = email?.trim();
  const safeWebsite = websiteUrl?.trim();

  const lines: string[] = [];

  // Name + title
  if (fullName) {
    lines.push(`<span style="font-weight:600;font-size:15px;color:#111827;">${fullName}</span>`);
  }
  if (jobTitle) {
    const companyPart = companyName ? `, ${companyName}` : '';
    lines.push(
      `<span style="font-size:13px;color:#4B5563;">${jobTitle}${companyPart}</span>`
    );
  }

  // Phone
  if (safePhone) {
    lines.push(
      `<a href="tel:${safePhone}" style="font-size:13px;color:#111827;text-decoration:none;">${safePhone}</a>`
    );
  }

  // Email
  if (safeEmail) {
    lines.push(
      `<a href="mailto:${safeEmail}" style="font-size:13px;color:#1D4ED8;text-decoration:none;">${safeEmail}</a>`
    );
  }

  // Website
  if (safeWebsite) {
    lines.push(
      `<a href="${safeWebsite}" style="font-size:13px;color:#1D4ED8;text-decoration:none;">${safeWebsite}</a>`
    );
  }

  // Pronouns
  if (pronouns) {
    lines.push(
      `<span style="font-size:12px;color:#6B7280;">${pronouns}</span>`
    );
  }

  // Office location
  if (officeLocation) {
    lines.push(
      `<span style="font-size:12px;color:#6B7280;">${officeLocation}</span>`
    );
  }

  const textColumnHtml = lines
    .map(line => `<div style="line-height:1.4;margin:0;padding:0;">${line}</div>`)
    .join('');

  const logoCellHtml = logoUrl
    ? `<td style="padding-right:16px;vertical-align:middle;">
         <img src="${logoUrl}"
              width="${logoWidthPx}"
              height="${logoHeightPx}"
              style="display:block;border:0;outline:none;text-decoration:none;max-width:${logoWidthPx}px;max-height:${logoHeightPx}px;"/>
       </td>`
    : '';

  const mainTable = `
    <table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
      <tr>
        ${logoCellHtml}
        <td style="vertical-align:middle;padding:4px 0;">
          ${textColumnHtml}
        </td>
      </tr>
    </table>
  `;

  let confidentialityHtml = '';
  if (includeConfidentialityNotice) {
    confidentialityHtml = `
      <div style="margin-top:12px;font-size:10px;line-height:1.4;color:#6B7280;max-width:520px;">
        This email and any attachments are confidential and intended solely for the use of the individual or entity to whom they are addressed. If you have received this email in error, please notify the sender and delete it from your system.
      </div>
    `;
  }

  const wrapper = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
      ${mainTable}
      ${confidentialityHtml}
    </div>
  `;

  if (options?.asBlockquote) {
    return `<blockquote style="margin:0;padding-left:8px;border-left:2px solid #E5E7EB;">${wrapper}</blockquote>`;
  }

  return wrapper;
}
```

> Cursor: you can adjust styling tokens to match design‑system variables, but keep the overall structure (table + div wrapper).

---

## 5. Signature Preview Component

### 5.1 Component skeleton

Create `src/components/profile/EmailSignaturePreview.tsx`:

```tsx
import React, { useMemo } from 'react';
import { Card, CardHeader, CardContent, Box, Typography } from '@mui/material';
import { buildEmailSignatureHtml } from '@/utils/emailSignature';
import { useCurrentUserProfile } from '@/hooks/useCurrentUserProfile';
import { useEmailBrandingSettings } from '@/hooks/useEmailBrandingSettings';

export const EmailSignaturePreview: React.FC = () => {
  const profile = useCurrentUserProfile();
  const branding = useEmailBrandingSettings();

  const signatureHtml = useMemo(() => {
    if (!profile || !branding || !profile.enableEmailSignature) {
      return '';
    }
    return buildEmailSignatureHtml(profile, branding);
  }, [profile, branding]);

  return (
    <Card variant="outlined" sx={{ mt: 3 }}>
      <CardHeader
        title="Signature Preview"
        subheader="This is how your email signature will appear in outgoing messages."
      />
      <CardContent>
        {!profile?.enableEmailSignature ? (
          <Typography variant="body2" color="text.secondary">
            Enable your email signature to see a preview.
          </Typography>
        ) : !signatureHtml ? (
          <Typography variant="body2" color="text.secondary">
            Complete your profile details above to generate your signature.
          </Typography>
        ) : (
          <Box
            sx={{
              borderRadius: 2,
              bgcolor: 'grey.50',
              p: 2,
              display: 'flex',
              justifyContent: 'center',
            }}
          >
            <Box
              sx={{
                bgcolor: 'background.paper',
                borderRadius: 1,
                px: 3,
                py: 2,
                maxWidth: 680,
                width: '100%',
                boxShadow: 'inset 0 0 0 1px rgba(15,23,42,0.03)',
              }}
            >
              <div
                // Email HTML uses inline styles; we trust our own generator
                dangerouslySetInnerHTML={{ __html: signatureHtml }}
              />
            </Box>
          </Box>
        )}
      </CardContent>
    </Card>
  );
};
```

### 5.2 Wiring into My Profile page

In `MyProfilePage` (or equivalent), within the **Email Signature** section:

```tsx
// ...existing fields (enable toggle, template, contact info, notice toggle)

<EmailSignaturePreview />
```

Whenever the user edits:

- Full Name
- Job Title
- Phone Number
- Email
- Pronouns
- Office Location
- Confidentiality toggle
- Template selection (if template changes behavior in future)

…we simply update the local form state and the preview reacts immediately (no save required for preview). Final save still persists to Firestore as usual.

---

## 6. Gmail / Client Integration Notes

### 6.1 Usage patterns

There are two primary ways this signature will be used:

1. **Our internal Gmail integration** (if app is injecting signatures into composed messages)  
   - Use `buildEmailSignatureHtml(profile, branding)` to inject into the message body.

2. **Manual copy into Gmail settings** (for early adoption)  
   - Provide a “Copy HTML to clipboard” button near the preview (optional enhancement).  
   - This can call `navigator.clipboard.writeText(signatureHtml)` and show a toast:  
     “Signature HTML copied. Paste into Gmail → Settings → Signature.”

### 6.2 Dark‑mode considerations

- Because we use inline colors (e.g. #111827, #4B5563), dark‑mode clients will render signature content readable regardless of background.  
- Avoid pure black (#000000) and pure white (#FFFFFF); stick to Tailwind‑like grays.

---

## 7. Edge Cases & Validation

- If `enableEmailSignature` is `false` → preview shows a simple informational message.
- If `fullName` or `email` is missing → show a warning below preview, e.g.:  
  “Add your name and email address above to generate a proper signature.”
- If `logoUrl` fails to load in some clients, the text column still renders cleanly.
- If phone number is not valid, we still render it as plain text; `tel:` link is best‑effort.

---

## 8. Implementation Checklist (Cursor)

1. Add / confirm `EmailBrandingSettings` and hook `useEmailBrandingSettings`.
2. Implement `buildEmailSignatureHtml` in `src/utils/emailSignature.ts`.
3. Create `EmailSignaturePreview` component and wire into My Profile → Email Signature.
4. Ensure profile form updates (name, title, phone, etc.) update local state and preview.
5. Test with:
   - Signature disabled / enabled.
   - Missing logo → text‑only preview.
   - Confidentiality notice on/off.
   - Long titles and locations (wrap gracefully).
6. Optionally add a “Copy HTML” button for convenience.

Once complete, Greg (and all team members) should see **exactly** the signature layout shown in the screenshot, with the C1 logo on the left and their details on the right, updated in real time as they edit their profile.
