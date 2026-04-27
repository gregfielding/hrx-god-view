/**
 * Email Signature Utilities (v2)
 * 
 * Generates HTML email signatures with logo support.
 * Matches the v2 spec exactly.
 */

export interface SignatureData {
  fullName: string;
  title: string;
  phone: string;
  email: string;
  website?: string;
  logoUrl?: string;
  pronouns?: string;
  location?: string;
  showConfidentiality: boolean;
}

/**
 * Builds SignatureData from user profile and tenant
 */
export function buildSignatureData(
  user: {
    fullName?: string;
    firstName?: string;
    lastName?: string;
    jobTitle?: string;
    phoneNumber?: string;
    phone?: string;
    email: string;
    pronouns?: string;
    officeLocation?: string;
    location?: string;
    includeConfidentialityNotice?: boolean;
    enableEmailSignature?: boolean;
  },
  tenant: {
    avatar?: string;
    website?: string;
    companyName?: string;
  } | null | undefined
): SignatureData {
  const fullName = user.fullName || 
    `${user.firstName || ''} ${user.lastName || ''}`.trim() || 
    '';
  
  const title = user.jobTitle || '';
  // IMPORTANT: Do NOT append company name to title
  
  const phone = (user.phoneNumber || user.phone || '').trim();
  const email = (user.email || '').trim();
  const website = tenant?.website?.trim() || undefined;
  const logoUrl = tenant?.avatar?.trim() || undefined; // Use tenant avatar for logo
  const pronouns = user.pronouns?.trim() || undefined;
  const location = (user.officeLocation || user.location || '').trim() || undefined;
  const showConfidentiality = user.includeConfidentialityNotice ?? false;

  return {
    fullName,
    title,
    phone,
    email,
    website,
    logoUrl,
    pronouns,
    location,
    showConfidentiality,
  };
}

/**
 * Escapes HTML special characters
 */
function escapeHtml(str: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return str.replace(/[&<>"']/g, (m) => map[m]);
}

/**
 * Renders email signature HTML
 * 
 * Returns full HTML safe for email clients (Gmail, Outlook, Apple Mail).
 */
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
  } = data;

  const lines: string[] = [];

  // Name line (optionally with pronouns)
  const nameLine = pronouns
    ? `<strong>${escapeHtml(fullName)}</strong> <span style="font-weight:normal;color:#555;font-size:12px;">(${escapeHtml(pronouns)})</span>`
    : `<strong>${escapeHtml(fullName)}</strong>`;

  lines.push(nameLine);

  if (title && title.trim()) {
    // IMPORTANT: title only, no company suffix
    lines.push(`${escapeHtml(title.trim())}`);
  }

  if (phone && phone.trim()) {
    lines.push(`${escapeHtml(phone.trim())}`);
  }

  if (email && email.trim()) {
    lines.push(
      `<a href="mailto:${escapeHtml(email.trim())}" style="color:#1155CC;text-decoration:none;">${escapeHtml(email.trim())}</a>`,
    );
  }

  if (website && website.trim()) {
    const url = website.trim().startsWith('http') ? website.trim() : `https://${website.trim()}`;
    const displayUrl = website.trim().replace(/^https?:\/\//, '');
    lines.push(
      `<a href="${escapeHtml(url)}" style="color:#1155CC;text-decoration:none;">${escapeHtml(displayUrl)}</a>`,
    );
  }

  if (location && location.trim()) {
    lines.push(`${escapeHtml(location.trim())}`);
  }

  const textBlock = lines.join('<br/>\n');

  const logoCell = logoUrl
    ? `<td style="padding-right:14px;vertical-align:top;">
          <img src="${escapeHtml(logoUrl)}"
               alt="Company logo"
               style="height:60px;width:auto;border-radius:4px;display:block;" />
       </td>`
    : '';

  const tableHtml = `
<table cellpadding="0" cellspacing="0" role="presentation">
  <tr>
    ${logoCell}
    <td style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.4;color:#111111;">
      ${textBlock}
    </td>
  </tr>
</table>
`.trim();

  const confidentialityHtml = showConfidentiality
    ? `
<br/>
<div style="margin-top:8px;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.4;color:#777777;max-width:520px;">
  This email and any attachments may contain confidential information intended only for the recipient. If you received this message in error, please notify the sender and delete it.
</div>
`.trim()
    : '';

  return tableHtml + confidentialityHtml;
}

