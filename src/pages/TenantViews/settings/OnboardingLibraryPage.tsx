/**
 * Onboarding Library Page — Phase 1B
 * Master library of onboarding items, documents, and requirement packages.
 */
import React, { useState } from 'react';
import { Box, Typography, Tabs, Tab, Alert, Paper } from '@mui/material';
import { useAuth } from '../../../contexts/AuthContext';
import OnboardingItemsTab from './OnboardingItemsTab';
import OnboardingDocumentsTab from './OnboardingDocumentsTab';
import WCClassCodesTab from './WCClassCodesTab';

export type OnboardingLibraryTab = 'items' | 'documents' | 'packages' | 'wc-codes';

const OnboardingLibraryPage: React.FC = () => {
  const { activeTenant } = useAuth();
  const tenantId = activeTenant?.id;
  const [activeTab, setActiveTab] = useState<OnboardingLibraryTab>('items');

  if (!tenantId) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="info">Select a tenant to manage the onboarding library.</Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ px: { xs: 2, md: 3 }, py: 2, width: '100%', height: '100%' }}>
      <Typography variant="h6" fontWeight={600} sx={{ mb: 2 }}>
        Onboarding Library
      </Typography>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Tabs value={activeTab} onChange={(_, v) => setActiveTab(v)} sx={{ mb: 2 }}>
          <Tab label="Items" value="items" />
          <Tab label="Documents" value="documents" />
          <Tab label="Packages" value="packages" />
          <Tab label="WC Class Codes" value="wc-codes" />
        </Tabs>

        {activeTab === 'items' && <OnboardingItemsTab tenantId={tenantId} />}
        {activeTab === 'documents' && <OnboardingDocumentsTab tenantId={tenantId} />}
        {activeTab === 'packages' && (
          <Alert severity="info">
            Packages — Build requirement packages from library items. Coming next.
          </Alert>
        )}
        {activeTab === 'wc-codes' && tenantId && (
          <WCClassCodesTab tenantId={tenantId} />
        )}
      </Paper>
    </Box>
  );
};

export default OnboardingLibraryPage;
