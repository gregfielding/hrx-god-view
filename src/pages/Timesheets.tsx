/**
 * Timesheets — recruiter/admin timesheet workspace.
 *
 * **Filter gating** (per TS.1 §3.1):
 *   1. Entity dropdown is required.
 *   2. Once an entity is chosen, the period picker activates.
 *   3. Once a period is chosen, the grid hydrates.
 *
 * If a recruiter lands on the page with neither selected, the grid
 * shows a friendly "pick a hiring entity and period" empty state — we
 * never show "0 workers · 0 hrs" before the filter has been narrowed.
 *
 * **Scope** (this commit, TS.1.P1.C.1):
 *   - Page shell, filter bar (entity + period), gated grid skeleton.
 *   - Grid skeleton renders an empty/placeholder state (no row
 *     resolution yet).
 *
 * **Coming in TS.1.P1.C.2:**
 *   - Row resolution via `timesheetGridResolver`.
 *   - Live totals header (worker count + scheduled/actual hours).
 *
 * **Coming in TS.1.P3+:**
 *   - Inline-editable cells (actuals, breaks, tips, bonuses).
 *   - Status pill flow (draft → submit → approve).
 *   - Variance filter, status filter, batch submit / Everee dispatch.
 *
 * Sec 5/6/7 only — gate enforced at `App.tsx` (route) and
 * `menuGenerator.ts` (sidebar). Both must agree.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Box, Paper, Stack, Typography } from '@mui/material';

import PageHeader from '../components/PageHeader';
import EntityPicker from '../components/timesheets/EntityPicker';
import PeriodPicker from '../components/timesheets/PeriodPicker';
import TimesheetGrid from '../components/timesheets/TimesheetGrid';
import { useAuth } from '../contexts/AuthContext';
import type { HiringEntity } from '../types/recruiter/hiringEntity';
import type { TimesheetFilter } from '../types/recruiter/timesheet';
import {
  type PeriodRange,
  isValidPeriod,
} from '../utils/timesheets/dateRange';

const Timesheets: React.FC = () => {
  const { tenantId } = useAuth();

  const [entity, setEntity] = useState<HiringEntity | null>(null);
  const [period, setPeriod] = useState<PeriodRange | null>(null);

  /**
   * Reset the period whenever the entity changes — different entities
   * have different `payPeriodPolicy` shapes, and re-using a stale
   * period across an entity swap would feel bizarre. PeriodPicker will
   * re-seed with the new entity's default on its next render.
   */
  const handleEntityChange = useCallback((next: HiringEntity | null) => {
    setEntity(next);
    setPeriod(null);
  }, []);

  /**
   * Compose the page-level filter once both entity and period are set.
   * P1.C.1 only supports `entity_period`; deep-link scopes (jobOrder,
   * shift, worker, account) arrive in later phases.
   */
  const filter: TimesheetFilter | null = useMemo(() => {
    if (!entity) return null;
    if (!period || !isValidPeriod(period)) return null;
    return {
      kind: 'entity_period',
      hiringEntityId: entity.id,
      periodStart: period.start,
      periodEnd: period.end,
    };
  }, [entity, period]);

  // Defensive: if the tenant changes (rare in practice — would mean a
  // tenant-switcher firing), reset the local state. Avoids leaking an
  // entity from one tenant into another.
  useEffect(() => {
    setEntity(null);
    setPeriod(null);
  }, [tenantId]);

  if (!tenantId) {
    return (
      <Box sx={{ p: 3 }}>
        <PageHeader
          title="Timesheets"
          subtitle="Recruiter-driven timesheet review, approval, and Everee batch submission."
        />
        <Alert severity="warning" sx={{ mt: 3, maxWidth: 720 }}>
          No active tenant. Switch tenants to load timesheets.
        </Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      <PageHeader
        title="Timesheets"
        subtitle="Recruiter-driven timesheet review, approval, and Everee batch submission."
      />

      <Paper variant="outlined" sx={{ p: 2, mt: 3 }}>
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={2}
          alignItems={{ xs: 'stretch', md: 'flex-start' }}
        >
          <EntityPicker
            tenantId={tenantId}
            value={entity}
            onChange={handleEntityChange}
            showRequiredHelper={!entity}
          />

          {/* Period picker stays mounted but only meaningful once an
              entity is picked. The component itself defends against
              entity={null} by being conditionally rendered. */}
          {entity ? (
            <PeriodPicker
              entity={entity}
              value={period}
              onChange={setPeriod}
              scope={null}
            />
          ) : (
            <Typography
              variant="body2"
              color="text.disabled"
              sx={{ pt: 1.5 }}
            >
              Period selector will activate once a hiring entity is selected.
            </Typography>
          )}
        </Stack>
      </Paper>

      <Box sx={{ mt: 2 }}>
        <TimesheetGrid filter={filter} />
      </Box>
    </Box>
  );
};

export default Timesheets;
