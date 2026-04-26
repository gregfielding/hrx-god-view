/**
 * Workforce > Job Readiness — D.4 placeholder.
 *
 * The full implementation reads from `assignmentReadinessItems` and renders
 * a JO-centric matrix (one row per job order, one column per requirement
 * dimension). It ships in PR D.4 — included here so the route + tab
 * navigation are real from day one and CSAs can see where the feature is
 * going.
 *
 * @see Phase D spec §4 for the table shape and filter behavior.
 */

import React from 'react';
import { Box, Stack, Typography, Paper, Chip } from '@mui/material';
import WorkOutlineIcon from '@mui/icons-material/WorkOutline';
import { useOutletContext } from 'react-router-dom';

import WorkforceScopeToggle from '../components/workforce/WorkforceScopeToggle';
import type { WorkforceOutletContext } from './Workforce';

const WorkforceJobReadiness: React.FC = () => {
  const { scope, setScope } = useOutletContext<WorkforceOutletContext>();

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25, px: { xs: 2, md: 3 }, pt: 1.5 }}>
      <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap">
        <WorkforceScopeToggle value={scope} onChange={setScope} myLabel="Mine" />
        <Box sx={{ flex: 1 }} />
        <Chip label="Coming in D.4" size="small" color="info" variant="outlined" />
      </Stack>

      <Paper
        variant="outlined"
        sx={{
          p: 4,
          textAlign: 'center',
          bgcolor: 'rgba(0,0,0,0.015)',
          borderStyle: 'dashed',
          borderColor: 'divider',
        }}
      >
        <WorkOutlineIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 1 }} />
        <Typography variant="h6" gutterBottom>
          Job Readiness queue
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 520, mx: 'auto' }}>
          One row per job order, with readiness coverage across the assignment
          requirement dimensions (job-order specific I-9, BGC tier, training
          modules, equipment). Lands in PR D.4 — wiring the existing
          <code style={{ margin: '0 4px' }}>assignmentReadinessItems</code>
          collection into the matching table shape.
        </Typography>
      </Paper>
    </Box>
  );
};

export default WorkforceJobReadiness;
