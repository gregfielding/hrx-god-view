/**
 * Staff Onboarding hub — `/staff-onboarding`
 *
 * **E.7** — collapsed from 3 tabs (Tax+Payroll / E-Verify / Background)
 * to 2 tabs (To-Do / Background Checks). The "Tax+Payroll" and
 * "E-Verify" tabs were both lists of workers stuck somewhere in their
 * external onboarding pipeline — a recruiter view of "what's not done".
 * E.7 reframes them as an Onboarding Specialist action queue: surface
 * (worker × action) pairs the specialist actually needs to act on
 * (I-9 Section 2, start E-Verify
 * case, address E-Verify TNC) and route everything else to the worker
 * profile. The two old tabs' data is fully covered by the new "To-Do"
 * tab; the renderer for them is no longer mounted but kept exported
 * from `StaffOnboardingQueueTables.tsx` for an emergency revert.
 *
 * Background Checks tab is unchanged — AC.0a/AC.0b will reshape that
 * surface separately.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Box, Button, Stack, Tab, Tabs, Typography } from '@mui/material';
import PageHeader from '../components/PageHeader';
import { useAuth } from '../contexts/AuthContext';
import { StaffOnboardingBackgroundTab } from '../components/staffOnboarding/StaffOnboardingQueueTables';
import OnboardingSpecialistActionQueue from '../components/staffOnboarding/OnboardingSpecialistActionQueue';
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

  // `?tab=background` deep-link (used by the legacy `/screenings-queue`
  // redirect in App.tsx) → land on the Background Checks tab. Index is
  // now `1` post-E.7 (was `2` pre-E.7).
  useEffect(() => {
    if (!storageHydrated) return;
    if (searchParams.get('tab') === 'background') {
      setUi((prev) => ({ ...prev, tab: 1 }));
    } else if (searchParams.get('tab') === 'todo') {
      setUi((prev) => ({ ...prev, tab: 0 }));
    }
  }, [searchParams, storageHydrated]);

  const handleTabChange = useCallback((_: React.SyntheticEvent, value: number) => {
    setUi((prev) => ({ ...prev, tab: value }));
  }, []);

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
          subtitle="Action items for Onboarding Specialists — workers waiting on the employer portion of onboarding."
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
          <Tab label="To-Do" id="staff-onboarding-tab-0" />
          <Tab label="Background Checks" id="staff-onboarding-tab-1" />
        </Tabs>
      </Box>
      <TabPanel value={ui.tab} index={0}>
        <OnboardingSpecialistActionQueue tenantId={tenantId} />
      </TabPanel>
      <TabPanel value={ui.tab} index={1}>
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
          sortColumn={ui.bgSortColumn}
          sortDirection={ui.bgSortDirection}
          onSortChange={(column, direction) =>
            setUi((s) => ({
              ...s,
              bgSortColumn: column,
              bgSortDirection: direction,
              // Reset to page 0 + top of table when sort changes — preserves
              // the "the row I'm scrolled to" intuition by anchoring to a
              // known position rather than an arbitrary mid-page offset.
              bgPage: 0,
              bgScrollTop: 0,
            }))
          }
        />
      </TabPanel>
    </Box>
  );
};

export default StaffOnboardingCenter;
