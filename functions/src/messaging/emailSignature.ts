/**
 * Email Signature Utilities (Cloud Functions)
 * 
 * Generates HTML email signatures based on C1 Staffing brand standards.
 */

export type SignatureTemplate = 'default' | 'sales' | 'recruiter' | 'executive';

export interface EmailSignatureData {
  fullName: string;
  jobTitle: string;
  phone: string;
  email: string;
  officeLocation?: string;
  pronouns?: string;
  schedulingLink?: string;
  applicationPortal?: string;
  includeConfidentialityNotice?: boolean;
  website?: string; // Tenant website
  logoUrl?: string; // Tenant logo/avatar
}

export interface EmailSignatureSettings {
  template: SignatureTemplate;
  enabled: boolean;
  customHtml?: string;
  data: EmailSignatureData;
}

function formatPhone(phone: string): { display: string; digits: string } {
  const digits = phone.replace(/\D/g, '');
  
  if (digits.length === 10) {
    const formatted = `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
    return { display: formatted, digits };
  }
  
  return { display: phone, digits };
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

function generateDefaultSignature(data: EmailSignatureData): string {
  // Map to match preview format exactly (title instead of jobTitle, location instead of officeLocation)
  const title = data.jobTitle || '';
  const location = data.officeLocation || undefined;
  
  const lines: string[] = [];

  // Name line (optionally with pronouns) - EXACT match to preview
  const nameLine = data.pronouns
    ? `<strong>${escapeHtml(data.fullName)}</strong> <span style="font-weight:normal;color:#555;font-size:12px;">(${escapeHtml(data.pronouns)})</span>`
    : `<strong>${escapeHtml(data.fullName)}</strong>`;
  lines.push(nameLine);

  // Title only (no company suffix) - EXACT match to preview
  if (title && title.trim()) {
    lines.push(`${escapeHtml(title.trim())}`);
  }

  // Phone - EXACT match to preview
  if (data.phone && data.phone.trim()) {
    lines.push(`${escapeHtml(data.phone.trim())}`);
  }

  // Email - EXACT match to preview
  if (data.email && data.email.trim()) {
    lines.push(
      `<a href="mailto:${escapeHtml(data.email.trim())}" style="color:#1155CC;text-decoration:none;">${escapeHtml(data.email.trim())}</a>`
    );
  }

  // Website (only show if provided) - EXACT match to preview
  if (data.website && data.website.trim()) {
    const url = data.website.trim().startsWith('http') ? data.website.trim() : `https://${data.website.trim()}`;
    const displayUrl = data.website.trim().replace(/^https?:\/\//, '');
    lines.push(
      `<a href="${escapeHtml(url)}" style="color:#1155CC;text-decoration:none;">${escapeHtml(displayUrl)}</a>`
    );
  }

  // Location - EXACT match to preview
  if (location && location.trim()) {
    lines.push(`${escapeHtml(location.trim())}`);
  }

  const textBlock = lines.join('<br/>\n');

  // Logo cell - EXACT match to preview
  const logoCell = data.logoUrl
    ? `<td style="padding-right:14px;vertical-align:top;">
          <img src="${escapeHtml(data.logoUrl)}"
               alt="Company logo"
               height="60"
               style="height:60px;max-width:140px;width:auto;object-fit:contain;border-radius:4px;display:block;" />
       </td>`
    : '';

  // Table HTML - EXACT match to preview
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

  return tableHtml;
}

function generateSalesSignature(data: EmailSignatureData): string {
  // Use same format as default, but can add scheduling link if needed
  return generateDefaultSignature(data);
}

function generateRecruiterSignature(data: EmailSignatureData): string {
  // Use same format as default
  return generateDefaultSignature(data);
}

function generateExecutiveSignature(data: EmailSignatureData): string {
  // Use same format as default
  return generateDefaultSignature(data);
}

function generateConfidentialityNotice(): string {
  return `
<br/>
<div style="margin-top:8px;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.4;color:#777777;max-width:520px;">
  This email and any attachments may contain confidential information intended only for the recipient. If you received this message in error, please notify the sender and delete it.
</div>
`.trim();
}

export function generateEmailSignature(settings: EmailSignatureSettings): string {
  // Always generate signature if settings exist (enabled flag is now optional/ignored)
  // This ensures signatures are always included automatically
  
  // IGNORE customHtml - always use template-based generation to match preview
  // This ensures consistency between preview and delivered emails

  // Check if we have minimum required data to generate a signature
  // Allow signature generation if we have at least email OR fullName
  if (!settings.data) {
    return '';
  }
  
  // For template-based signatures, we need at least email or fullName
  if (!settings.data.email && !settings.data.fullName) {
    return '';
  }

  let signature = '';
  switch (settings.template) {
    case 'sales':
      signature = generateSalesSignature(settings.data);
      break;
    case 'recruiter':
      signature = generateRecruiterSignature(settings.data);
      break;
    case 'executive':
      signature = generateExecutiveSignature(settings.data);
      break;
    case 'default':
    default:
      signature = generateDefaultSignature(settings.data);
      break;
  }

  if (settings.data.includeConfidentialityNotice) {
    signature += generateConfidentialityNotice();
  }

  return signature;
}

export function appendSignatureToEmail(bodyHtml: string, signature: string): string {
  if (!signature) {
    return bodyHtml;
  }

  // Prevent double-appending if upstream callers retry or re-render with an already-signed body.
  const marker = '<!-- HRX_EMAIL_SIGNATURE -->';
  if (bodyHtml.includes(marker)) {
    return bodyHtml;
  }

  const separator = '<br/><br/>';
  return bodyHtml.trim() + separator + marker + signature;
}

