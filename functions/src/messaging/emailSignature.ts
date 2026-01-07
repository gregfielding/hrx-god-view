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

function generateConfidentialityNotice(): string {
  return `<br/><br/><span style="font-size:11px;color:#777;">
CONFIDENTIALITY NOTICE: This email and any attachments are intended only for the named recipient. If you received this message in error, please notify the sender and delete it immediately.
</span>`;
}

export function generateEmailSignature(settings: EmailSignatureSettings): string {
  // Always generate signature if settings exist (enabled flag is now optional/ignored)
  // This ensures signatures are always included automatically

  if (settings.customHtml) {
    let signature = settings.customHtml;
    if (settings.data?.includeConfidentialityNotice) {
      signature += generateConfidentialityNotice();
    }
    return signature;
  }

  // Check if we have minimum required data to generate a signature
  if (!settings.data || (!settings.data.fullName && !settings.data.email)) {
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

  const separator = '<br/><br/>';
  return bodyHtml.trim() + separator + signature;
}

