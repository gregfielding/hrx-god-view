/**
 * Staff Onboarding hub — `/staff-onboarding`
 * Operational recruiter queues: tax/payroll, E-Verify (C1 Select), background checks.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Box, Button, Stack, Tab, Tabs, Typography } from '@mui/material';
import PageHeader from '../components/PageHeader';
import { useAuth } from '../contexts/AuthContext';
import {
  StaffOnboardingTaxPayrollTab,
  StaffOnboardingEverifyTab,
  StaffOnboardingBackgroundTab,
} from '../components/staffOnboarding/StaffOnboardingQueueTables';
import { OnCallI9SupportingReminderDialog } from '../components/staffOnboarding/OnCallI9SupportingReminderDialog';
import type { OnboardingQueuePagination } from '../types/onboardingQueue';
import {
  defaultStaffOnboardingUi,
  loadStaffOnboardingUi,
  saveStaffOnboardingUi,
  type StaffOnboardingUiState,
} from '../utils/staffOnboardingUiStorage';

function TabPanel(props: { children?: React.ReactNode; index: number; value: number }) {
  const { children, value, index, ...other } = props;
  return (
    <div role="tabpanel" hidden={value !== index} id={`staff-onboarding-tabpanel-${index}`} {...other}>
      {value === index ? (
        <Box sx={{ pt: 2, width: '100%', display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>{children}</Box>
      ) : null}
    </div>
  );
}

const StaffOnboardingCenter: React.FC = () => {
  const [searchParams] = useSearchParams();
  const [ui, setUi] = useState<StaffOnboardingUiState>(() => defaultStaffOnboardingUi());
  /** Prevents the save effect from writing default state to sessionStorage before the first load from storage runs. */
  const [storageHydrated, setStorageHydrated] = useState(false);
  const [i9ReminderOpen, setI9ReminderOpen] = useState(false);
  const { activeTenant } = useAuth();
  const tenantId = activeTenant?.id;

  useEffect(() => {
    if (!tenantId) {
      setStorageHydrated(false);
      setUi(defaultStaffOnboardingUi());
      return;
    }
    const saved = loadStaffOnboardingUi(tenantId);
    setUi(saved ?? defaultStaffOnboardingUi());
    setStorageHydrated(true);
  }, [tenantId]);

  useEffect(() => {
    if (!tenantId || !storageHydrated) return;
    saveStaffOnboardingUi(tenantId, ui);
  }, [tenantId, storageHydrated, ui]);

  useEffect(() => {
    if (!storageHydrated) return;
    if (searchParams.get('tab') === 'background') {
      setUi((prev) => ({ ...prev, tab: 2 }));
    }
  }, [searchParams, storageHydrated]);

  const handleTabChange = useCallback((_: React.SyntheticEvent, value: number) => {
    setUi((prev) => ({ ...prev, tab: value }));
  }, []);

  const taxPagination = useMemo<OnboardingQueuePagination>(
    () => ({
      page: ui.taxPage,
      pageSize: ui.taxPageSize,
      setPage: (p) => setUi((s) => ({ ...s, taxPage: p, taxScrollTop: 0 })),
      setPageSize: (s) => setUi((u) => ({ ...u, taxPageSize: s, taxPage: 0, taxScrollTop: 0 })),
    }),
    [ui.taxPage, ui.taxPageSize],
  );

  const evPagination = useMemo<OnboardingQueuePagination>(
    () => ({
      page: ui.evPage,
      pageSize: ui.evPageSize,
      setPage: (p) => setUi((s) => ({ ...s, evPage: p, evScrollTop: 0 })),
      setPageSize: (s) => setUi((u) => ({ ...u, evPageSize: s, evPage: 0, evScrollTop: 0 })),
    }),
    [ui.evPage, ui.evPageSize],
  );

  const bgPagination = useMemo<OnboardingQueuePagination>(
    () => ({
      page: ui.bgPage,
      pageSize: ui.bgPageSize,
      setPage: (p) => setUi((s) => ({ ...s, bgPage: p, bgScrollTop: 0 })),
      setPageSize: (s) => setUi((u) => ({ ...u, bgPageSize: s, bgPage: 0, bgScrollTop: 0 })),
    }),
    [ui.bgPage, ui.bgPageSize],
  );

  return (
    <Box
      sx={{
        width: '100%',
        maxWidth: '100%',
        px: { xs: 2, sm: 3 },
        py: 2,
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
        boxSizing: 'border-box',
      }}
    >
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'flex-start' }} justifyContent="space-between">
        <PageHeader
          title="Onboarding"
          subtitle="Recruiter queues for tax and payroll milestones, C1 Select E-Verify, and background screening."
        />
        <Button variant="outlined" size="small" sx={{ mt: { xs: 0, sm: 1 }, flexShrink: 0 }} onClick={() => setI9ReminderOpen(true)}>
          Remind incomplete I-9 uploads
        </Button>
      </Stack>
      <OnCallI9SupportingReminderDialog
        open={i9ReminderOpen}
        onClose={() => setI9ReminderOpen(false)}
        tenantId={tenantId}
      />
      <Box sx={{ borderBottom: 1, borderColor: 'divider', flexShrink: 0 }}>
        <Tabs value={ui.tab} onChange={handleTabChange} aria-label="Onboarding queues">
          <Tab label="Tax and Payroll" id="staff-onboarding-tab-0" />
          <Tab label="E-Verify" id="staff-onboarding-tab-1" />
          <Tab label="Background Checks" id="staff-onboarding-tab-2" />
        </Tabs>
      </Box>
      <TabPanel value={ui.tab} index={0}>
        <StaffOnboardingTaxPayrollTab
          tenantId={tenantId}
          pagination={taxPagination}
          workerSearch={ui.taxSearch}
          tableScrollTop={ui.taxScrollTop}
          onTableScrollTopChange={(y) => setUi((s) => ({ ...s, taxScrollTop: y }))}
          onWorkerSearchChange={(v) => setUi((s) => ({ ...s, taxSearch: v, taxPage: 0, taxScrollTop: 0 }))}
        />
      </TabPanel>
      <TabPanel value={ui.tab} index={1}>
        <StaffOnboardingEverifyTab
          tenantId={tenantId}
          pagination={evPagination}
          workerSearch={ui.evSearch}
          tableScrollTop={ui.evScrollTop}
          onTableScrollTopChange={(y) => setUi((s) => ({ ...s, evScrollTop: y }))}
          onWorkerSearchChange={(v) => setUi((s) => ({ ...s, evSearch: v, evPage: 0, evScrollTop: 0 }))}
        />
      </TabPanel>
      <TabPanel value={ui.tab} index={2}>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.5 }}>
          Open orders and errors are prioritized. Package names reflect AccuSource when available.
        </Typography>
        <StaffOnboardingBackgroundTab
          tenantId={tenantId}
          pagination={bgPagination}
          workerSearch={ui.bgSearch}
          tableScrollTop={ui.bgScrollTop}
          onTableScrollTopChange={(y) => setUi((s) => ({ ...s, bgScrollTop: y }))}
          onWorkerSearchChange={(v) => setUi((s) => ({ ...s, bgSearch: v, bgPage: 0, bgScrollTop: 0 }))}
        />
      </TabPanel>
    </Box>
  );
};

export default StaffOnboardingCenter;
