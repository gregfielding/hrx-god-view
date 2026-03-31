/**
 * Staff Onboarding hub — `/staff-onboarding`
 * Security levels 5–7 (menu + route). Phase A: shell with tabs; Tax/Payroll and E-Verify empty until scoped.
 * @see docs/ONBOARDING_CENTER_IMPLEMENTATION_PLAN.md
 */

import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
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
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState(0);
  const { activeTenant } = useAuth();

  useEffect(() => {
    if (searchParams.get('tab') === 'background') {
      setTab(2);
    }
  }, [searchParams]);
  const tenantId = activeTenant?.id;

  return (
    <Box sx={{ maxWidth: 1200, mx: 'auto', px: 2, py: 2 }}>
      <PageHeader
        title="Onboarding"
        subtitle="Tax, payroll, and background screening. E-Verify (C1 Select work authorization) will appear in the E-Verify tab when implemented."
      />
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
          Tenant queue for <strong>C1 Select</strong> E-Verify cases will live here (not a cross-entity track). Not wired yet — use the user profile
          Backgrounds tab for Select work authorization today.
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
