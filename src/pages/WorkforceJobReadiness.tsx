/**
 * Workforce > Job Readiness — D.4 thin slice.
 *
 * Renders the JO-centric readiness matrix: one row per active job order,
 * one column per requirement category that has data. Sister surface to the
 * Employee Readiness page (R.8 list / matrix) — same chip rules, different
 * grouping.
 *
 * **Scope semantics:**
 *   - `Mine`: JOs where the current user is the recruiter
 *     (`assignedRecruiters` array-contains uid OR legacy `recruiterId == uid`).
 *   - `All`: every active JO in the tenant.
 *
 * **Empty-column hiding:** the matrix only shows requirement-category columns
 * that have items somewhere on the visible page. As Layer 2 matchers light
 * up (`skill_match`, `language_match`, `experience_match`, etc. — see
 * `docs/READINESS_EXECUTION_MATRIX.md` §4), columns appear automatically
 * without a code change here.
 *
 * **Out of scope for v1** (deferred to D.4.1 — same staging used for
 * Employee Readiness D.1.1b/c):
 *   - Bulk-action bar across selected (JO × category) cells
 *   - Per-cell action menu (confirm / waive / mark fail)
 *   - Vendor drawers (none of the JO matrix's columns are vendor-source)
 *
 * @see ../components/workforce/JobReadinessMatrix/index.tsx (the matrix view)
 * @see ../hooks/useJobReadinessMatrixPage.ts (the data hook)
 */

import React from 'react';
import { Box, Stack } from '@mui/material';
import { useOutletContext } from 'react-router-dom';

import WorkforceScopeToggle from '../components/workforce/WorkforceScopeToggle';
import JobReadinessMatrix from '../components/workforce/JobReadinessMatrix';
import { useAuth } from '../contexts/AuthContext';
import type { WorkforceOutletContext } from './Workforce';

const WorkforceJobReadiness: React.FC = () => {
  const { user, activeTenant } = useAuth();
  const tenantId = activeTenant?.id ?? null;
  const currentUserUid = user?.uid ?? null;

  const { scope, setScope, search } = useOutletContext<WorkforceOutletContext>();

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 1.25,
        px: { xs: 2, md: 3 },
        pt: 1.5,
      }}
    >
      <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap">
        <WorkforceScopeToggle value={scope} onChange={setScope} myLabel="Mine" />
      </Stack>

      <JobReadinessMatrix
        tenantId={tenantId}
        currentUserUid={currentUserUid}
        scope={scope}
        search={search}
      />
    </Box>
  );
};

export default WorkforceJobReadiness;
