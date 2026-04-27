/**
 * useEmailBrandingSettings Hook
 * 
 * Fetches email branding settings (logo, company name, etc.) from tenant settings.
 */

import { useState, useEffect } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { EmailBrandingSettings } from '../utils/emailSignatureBuilder';

const DEFAULT_BRANDING: EmailBrandingSettings = {
  logoUrl: undefined, // Will fallback to text-only if not set
  logoWidthPx: 96,
  logoHeightPx: 96,
  websiteUrl: 'https://www.c1staffing.com',
  companyName: 'C1 Staffing',
};

export function useEmailBrandingSettings(): EmailBrandingSettings {
  const { activeTenant } = useAuth();
  const [branding, setBranding] = useState<EmailBrandingSettings>(DEFAULT_BRANDING);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!activeTenant?.id) {
      setBranding(DEFAULT_BRANDING);
      setLoading(false);
      return;
    }

    const loadBranding = async () => {
      try {
        // Try to get from branding/settings first
        const brandingRef = doc(db, 'tenants', activeTenant.id, 'branding', 'settings');
        const brandingSnap = await getDoc(brandingRef);

        if (brandingSnap.exists()) {
          const data = brandingSnap.data();
          setBranding({
            logoUrl: data?.logoUrl || DEFAULT_BRANDING.logoUrl,
            logoWidthPx: data?.logoWidthPx || DEFAULT_BRANDING.logoWidthPx,
            logoHeightPx: data?.logoHeightPx || DEFAULT_BRANDING.logoHeightPx,
            websiteUrl: data?.websiteUrl || data?.website || DEFAULT_BRANDING.websiteUrl,
            companyName: data?.companyName || data?.name || activeTenant.name || DEFAULT_BRANDING.companyName,
          });
        } else {
          // Fallback to tenant name and default settings
          setBranding({
            ...DEFAULT_BRANDING,
            companyName: activeTenant.name || DEFAULT_BRANDING.companyName,
          });
        }
      } catch (error) {
        console.error('Error loading email branding settings:', error);
        setBranding({
          ...DEFAULT_BRANDING,
          companyName: activeTenant.name || DEFAULT_BRANDING.companyName,
        });
      } finally {
        setLoading(false);
      }
    };

    loadBranding();
  }, [activeTenant?.id, activeTenant?.name]);

  return branding;
}

