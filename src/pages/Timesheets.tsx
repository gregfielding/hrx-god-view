/**
 * Timesheets — top-level recruiter/admin timesheet workspace.
 *
 * P1.A scope (this file today): page shell + nav entry only. The actual
 * `<TimesheetGrid />`, filter bar, and totals header arrive in P1.C. We
 * ship the empty page now so:
 *   - The route + nav item are wired up and exercise the auth gate
 *     (sec 5+) ahead of any real UI work.
 *   - Composite indexes can deploy and finish building in Firestore
 *     before they're queried.
 *   - Backend changes in P1.B (assignment denorm + backfill) can land
 *     in parallel without UI coupling.
 *
 * Sec 5/6/7 only — the gate is enforced at the route layer (App.tsx)
 * AND the sidebar entry (menuGenerator.ts). Both must agree.
 *
 * See `TS.1 — Timesheet Build Plan` for the full Phase 1 → Phase 6 roadmap.
 */

import React from 'react';
import { Alert, Box, Stack, Typography } from '@mui/material';

import PageHeader from '../components/PageHeader';

const Timesheets: React.FC = () => {
  return (
    <Box sx={{ p: 3 }}>
      <PageHeader
        title="Timesheets"
        subtitle="Recruiter-driven timesheet review, approval, and Everee batch submission."
      />
      <Stack spacing={2} sx={{ mt: 3, maxWidth: 720 }}>
        <Alert severity="info">
          The timesheet workspace is being built incrementally (TS.1).
          Filters, the inline-editable grid, and Everee batch submission arrive
          in upcoming releases. The route and nav entry are live now so the
          underlying composite indexes can finish building in Firestore before
          any query traffic hits them.
        </Alert>
        <Typography variant="body2" color="text.secondary">
          See <code>TS.1 — Timesheet Build Plan</code> for the rollout plan.
        </Typography>
      </Stack>
    </Box>
  );
};

export default Timesheets;
