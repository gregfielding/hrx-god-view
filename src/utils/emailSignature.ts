/**
 * Email Signature Utilities
 * 
 * Generates HTML email signatures based on C1 Staffing brand standards.
 */

export type SignatureTemplate = 'default' | 'sales' | 'recruiter' | 'executive';

export interface EmailSignatureData {
  fullName: string;
  jobTitle: string;
  phone: string;
  email: string;
  officeLocation?: string; // City, State
  pronouns?: string;
  schedulingLink?: string; // For sales
  applicationPortal?: string; // For recruiters
  includeConfidentialityNotice?: boolean;
}

export interface EmailSignatureSettings {
  template: SignatureTemplate;
  enabled: boolean;
  customHtml?: string; // Optional custom HTML override
  data: EmailSignatureData;
}

/**
 * Formats phone number for display and tel: links
 */
function formatPhone(phone: string): { display: string; digits: string } {
  // Remove all non-digit characters
  const digits = phone.replace(/\D/g, '');
  
  // Format as (XXX) XXX-XXXX if 10 digits
  if (digits.length === 10) {
    const formatted = `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
    return { display: formatted, digits };
  }
  
  // Return as-is if not standard format
  return { display: phone, digits };
}

/**
 * Generates default signature HTML
 */
function generateDefaultSignature(data: EmailSignatureData): string {
  const phone = formatPhone(data.phone);
  const locationLine = data.officeLocation ? `<br/><span style="font-size:13px;">📍 ${data.officeLocation}</span>` : '';
  const pronounsLine = data.pronouns ? `<br/><span style="font-size:13px;">${data.pronouns}</span>` : '';
  
  return `<strong style="font-size:14px;">${data.fullName}</strong>${pronounsLine}<br/>
<span style="font-size:13px;">${data.jobTitle} | <strong>C1 Staffing</strong></span>${locationLine}<br/>
<span style="font-size:13px;">📞 <a href="tel:${phone.digits}" style="color:#2F5FFF;">${phone.display}</a></span><br/>
<span style="font-size:13px;">📧 <a href="mailto:${data.email}" style="color:#2F5FFF;">${data.email}</a></span><br/>
<span style="font-size:13px;">🌐 <a href="https://www.c1staffing.com" style="color:#2F5FFF;">www.c1staffing.com</a></span><br/><br/>

<span style="font-size:12px;color:#555;">
Nevada • Texas • Arizona • California
</span>`;
}

/**
 * Generates sales signature HTML
 */
function generateSalesSignature(data: EmailSignatureData): string {
  const phone = formatPhone(data.phone);
  const locationLine = data.officeLocation ? `<br/><span style="font-size:13px;">📍 ${data.officeLocation}</span>` : '';
  const pronounsLine = data.pronouns ? `<br/><span style="font-size:13px;">${data.pronouns}</span>` : '';
  const schedulingLine = data.schedulingLink ? `<br/><span style="font-size:13px;">📅 <a href="${data.schedulingLink}" style="color:#2F5FFF;">Book time with me</a></span>` : '';
  
  return `<strong style="font-size:14px;">${data.fullName}</strong>${pronounsLine}<br/>
<span style="font-size:13px;">${data.jobTitle} | <strong>C1 Staffing</strong></span>${locationLine}<br/>
<span style="font-size:13px;">📞 <a href="tel:${phone.digits}" style="color:#2F5FFF;">${phone.display}</a></span><br/>
<span style="font-size:13px;">📧 <a href="mailto:${data.email}" style="color:#2F5FFF;">${data.email}</a></span>${schedulingLine}<br/>
<span style="font-size:13px;">🌐 <a href="https://www.c1staffing.com" style="color:#2F5FFF;">www.c1staffing.com</a></span><br/><br/>

<span style="font-size:12px;color:#555;">
Nevada • Texas • Arizona • California
</span>`;
}

/**
 * Generates recruiter signature HTML
 */
function generateRecruiterSignature(data: EmailSignatureData): string {
  const phone = formatPhone(data.phone);
  const locationLine = data.officeLocation ? `<br/><span style="font-size:13px;">📍 ${data.officeLocation}</span>` : '';
  const pronounsLine = data.pronouns ? `<br/><span style="font-size:13px;">${data.pronouns}</span>` : '';
  const applicationLine = data.applicationPortal ? `<br/><span style="font-size:13px;">📝 <a href="${data.applicationPortal}" style="color:#2F5FFF;">Apply with C1 Staffing</a></span>` : '';
  
  return `<strong style="font-size:14px;">${data.fullName}</strong>${pronounsLine}<br/>
<span style="font-size:13px;">${data.jobTitle} | <strong>C1 Staffing</strong></span>${locationLine}<br/>
<span style="font-size:13px;">📞 <a href="tel:${phone.digits}" style="color:#2F5FFF;">${phone.display}</a></span><br/>
<span style="font-size:13px;">📧 <a href="mailto:${data.email}" style="color:#2F5FFF;">${data.email}</a></span>${applicationLine}<br/>
<span style="font-size:13px;">🌐 <a href="https://www.c1staffing.com" style="color:#2F5FFF;">www.c1staffing.com</a></span><br/><br/>

<span style="font-size:12px;color:#555;">
Nevada • Texas • Arizona • California
</span>`;
}

/**
 * Generates executive signature HTML (simplified)
 */
function generateExecutiveSignature(data: EmailSignatureData): string {
  const phone = formatPhone(data.phone);
  const locationLine = data.officeLocation ? `<br/><span style="font-size:13px;">📍 ${data.officeLocation}</span>` : '';
  const pronounsLine = data.pronouns ? `<br/><span style="font-size:13px;">${data.pronouns}</span>` : '';
  
  return `<strong style="font-size:14px;">${data.fullName}</strong>${pronounsLine}<br/>
<span style="font-size:13px;">${data.jobTitle} | <strong>C1 Staffing</strong></span>${locationLine}<br/>
<span style="font-size:13px;">📞 <a href="tel:${phone.digits}" style="color:#2F5FFF;">${phone.display}</a></span><br/>
<span style="font-size:13px;">📧 <a href="mailto:${data.email}" style="color:#2F5FFF;">${data.email}</a></span><br/>
<span style="font-size:13px;">🌐 <a href="https://www.c1staffing.com" style="color:#2F5FFF;">www.c1staffing.com</a></span><br/><br/>

<span style="font-size:12px;color:#555;">
C1 Staffing — People Powering Business
</span>`;
}

/**
 * Generates confidentiality notice HTML
 */
function generateConfidentialityNotice(): string {
  return `<br/><br/><span style="font-size:11px;color:#777;">
CONFIDENTIALITY NOTICE: This email and any attachments are intended only for the named recipient. If you received this message in error, please notify the sender and delete it immediately.
</span>`;
}

/**
 * Generates complete email signature HTML based on template and data
 */
export function generateEmailSignature(settings: EmailSignatureSettings): string {
  if (!settings.enabled) {
    return '';
  }

  // Use custom HTML if provided
  if (settings.customHtml) {
    let signature = settings.customHtml;
    if (settings.data.includeConfidentialityNotice) {
      signature += generateConfidentialityNotice();
    }
    return signature;
  }

  // Generate based on template
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

  // Add confidentiality notice if requested
  if (settings.data.includeConfidentialityNotice) {
    signature += generateConfidentialityNotice();
  }

  return signature;
}

/**
 * Appends signature to email body HTML
 */
export function appendSignatureToEmail(bodyHtml: string, signature: string): string {
  if (!signature) {
    return bodyHtml;
  }

  // Add signature with proper spacing
  const separator = '<br/><br/>';
  return bodyHtml.trim() + separator + signature;
}

