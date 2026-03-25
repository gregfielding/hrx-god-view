/**
 * Staff Onboarding hub — `/staff-onboarding`
 * Security levels 5–7 (menu + route). Phase A: shell with tabs; Tax/Payroll and E-Verify empty until scoped.
 * @see docs/ONBOARDING_CENTER_IMPLEMENTATION_PLAN.md
 */

import React, { useState } from 'react';
import { Box, Tab, Tabs, Typography } from '@mui/material';
import PageHeader from '../components/PageHeader';
import { useAuth } from '../contexts/AuthContext';
import StaffOnboardingBackgroundChecksPanel from '../components/staffOnboarding/StaffOnboardingBackgroundChecksPanel';

function TabPanel(props: { children?: React.ReactNode; index: number; value: number }) {
  const { children, value, index, ...other } = props;
  return (
    <div role="tabpanel" hidden={value !== index} id={`staff-onboarding-tabpanel-${index}`} {...other}>
      {value === index ? <Box sx={{ pt: 2 }}>{children}</Box> : null}
    </div>
  );
}

const StaffOnboardingCenter: React.FC = () => {
  const [tab, setTab] = useState(0);
  const { activeTenant } = useAuth();
  const tenantId = activeTenant?.id;

  return (
    <Box sx={{ maxWidth: 1200, mx: 'auto', px: 2, py: 2 }}>
      <PageHeader title="Onboarding" subtitle="Tax, payroll, E-Verify, and background screening operations." />
      <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} aria-label="Onboarding sections">
          <Tab label="Tax and Payroll" id="staff-onboarding-tab-0" />
          <Tab label="E-Verify" id="staff-onboarding-tab-1" />
          <Tab label="Background Checks" id="staff-onboarding-tab-2" />
        </Tabs>
      </Box>
      <TabPanel value={tab} index={0}>
        <Typography variant="body2" color="text.secondary">
          This section will host payroll and tax onboarding tools when scoped.
        </Typography>
      </TabPanel>
      <TabPanel value={tab} index={1}>
        <Typography variant="body2" color="text.secondary">
          This section will host E-Verify operations when scoped.
        </Typography>
      </TabPanel>
      <TabPanel value={tab} index={2}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          AccuSource screening orders for the active tenant (read-only).
        </Typography>
        <StaffOnboardingBackgroundChecksPanel tenantId={tenantId} />
      </TabPanel>
    </Box>
  );
};

export default StaffOnboardingCenter;
