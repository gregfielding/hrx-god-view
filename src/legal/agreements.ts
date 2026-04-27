/**
 * Single source of truth for legal agreement versions
 * Update these when Terms, Consent, or Privacy documents change
 */
export const AGREEMENTS = {
  termsOfUse: { 
    version: "2025-10-21", 
    url: "/terms" 
  },
  smsConsent: { 
    version: "2025-10-21", 
    url: "/consent" 
  },
  privacyPolicy: { 
    version: "2025-10-21", 
    url: "/privacy" 
  },
} as const;

export type AgreementKey = keyof typeof AGREEMENTS;

/**
 * Check if user needs to re-consent to any agreements
 */
export function needsReconsent(userDoc: any): { 
  terms: boolean; 
  sms: boolean; 
  privacy: boolean 
} {
  const ua = userDoc?.userAgreements || {};
  return {
    terms: ua?.termsOfUse?.version !== AGREEMENTS.termsOfUse.version,
    sms: ua?.smsConsent?.version !== AGREEMENTS.smsConsent.version,
    privacy: ua?.privacyPolicy?.version !== AGREEMENTS.privacyPolicy.version,
  };
}

