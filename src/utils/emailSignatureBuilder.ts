/**
 * Email Signature Builder
 * 
 * Generates HTML email signatures with logo support and table layout
 * for maximum email client compatibility.
 */

export interface UserProfileForSignature {
  fullName: string;
  jobTitle: string;
  phoneNumber: string;
  email: string;
  officeLocation?: string;
  pronouns?: string;
  includeConfidentialityNotice?: boolean;
}

export interface EmailBrandingSettings {
  logoUrl?: string;
  logoWidthPx?: number;
  logoHeightPx?: number;
  websiteUrl: string;
  companyName: string;
}

export interface BuildEmailSignatureOptions {
  asBlockquote?: boolean;
}

/**
 * Builds email signature HTML with logo support
 */
export function buildEmailSignatureHtml(
  profile: UserProfileForSignature,
  branding: EmailBrandingSettings,
  options?: BuildEmailSignatureOptions
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

  const safePhone = phoneNumber?.trim() || '';
  const safeEmail = email?.trim() || '';
  const safeWebsite = websiteUrl?.trim() || '';

  const lines: string[] = [];

  // Name + title
  if (fullName) {
    lines.push(`<span style="font-weight:600;font-size:15px;color:#111827;">${escapeHtml(fullName)}</span>`);
  }
  if (jobTitle) {
    const companyPart = companyName ? `, ${escapeHtml(companyName)}` : '';
    lines.push(
      `<span style="font-size:13px;color:#4B5563;">${escapeHtml(jobTitle)}${companyPart}</span>`
    );
  }

  // Phone
  if (safePhone) {
    const phoneDigits = safePhone.replace(/\D/g, '');
    lines.push(
      `<a href="tel:${phoneDigits}" style="font-size:13px;color:#111827;text-decoration:none;">${escapeHtml(safePhone)}</a>`
    );
  }

  // Email
  if (safeEmail) {
    lines.push(
      `<a href="mailto:${safeEmail}" style="font-size:13px;color:#1D4ED8;text-decoration:none;">${escapeHtml(safeEmail)}</a>`
    );
  }

  // Website
  if (safeWebsite) {
    const displayUrl = safeWebsite.replace(/^https?:\/\//, '').replace(/^www\./, '');
    lines.push(
      `<a href="${safeWebsite.startsWith('http') ? safeWebsite : `https://${safeWebsite}`}" style="font-size:13px;color:#1D4ED8;text-decoration:none;">${escapeHtml(displayUrl)}</a>`
    );
  }

  // Pronouns
  if (pronouns) {
    lines.push(
      `<span style="font-size:12px;color:#6B7280;">${escapeHtml(pronouns)}</span>`
    );
  }

  // Office location
  if (officeLocation) {
    lines.push(
      `<span style="font-size:12px;color:#6B7280;">${escapeHtml(officeLocation)}</span>`
    );
  }

  const textColumnHtml = lines
    .map(line => `<div style="line-height:1.4;margin:0;padding:0;">${line}</div>`)
    .join('');

  const logoCellHtml = logoUrl
    ? `<td style="padding-right:16px;vertical-align:middle;">
         <img src="${escapeHtml(logoUrl)}"
              width="${logoWidthPx}"
              height="${logoHeightPx}"
              alt="${escapeHtml(companyName || 'Company Logo')}"
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

/**
 * Escapes HTML special characters
 */
function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

