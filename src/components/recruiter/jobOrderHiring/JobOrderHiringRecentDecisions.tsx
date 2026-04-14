import React from 'react';
import {
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import type { RecentHiringDecisionRow } from '../../../hooks/useJobOrderHiringControlPanelData';
import HiringLifecycleBadgeGroup from '../../hiring/HiringLifecycleBadgeGroup';

export type JobOrderHiringRecentDecisionsProps = {
  rows: RecentHiringDecisionRow[];
};

const JobOrderHiringRecentDecisions: React.FC<JobOrderHiringRecentDecisionsProps> = ({ rows }) => {
  return (
    <Card variant="outlined" sx={{ borderRadius: 2 }}>
      <CardContent sx={{ pt: 2, pb: 1 }}>
        <Typography variant="subtitle1" fontWeight={700} gutterBottom>
          Recent decisions
        </Typography>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
          Last 5 orchestrator runs (read-only).
        </Typography>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Candidate</TableCell>
              <TableCell>Decision</TableCell>
              <TableCell>Lifecycle</TableCell>
              <TableCell>Reason codes</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4}>
                  <Typography variant="body2" color="text.secondary">
                    No orchestrator decisions recorded yet.
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.applicationId}>
                  <TableCell sx={{ maxWidth: 160 }}>{r.candidateName}</TableCell>
                  <TableCell>{r.decision}</TableCell>
                  <TableCell sx={{ verticalAlign: 'top', maxWidth: 200 }}>
                    <HiringLifecycleBadgeGroup
                      lifecycle={r.hiringLifecycle}
                      legacyStatusLabel={r.legacyStatusLabel}
                      aiAutomationSummary={r.aiAutomationSummary}
                      compact
                    />
                  </TableCell>
                  <TableCell sx={{ wordBreak: 'break-word' }}>
                    {r.reasonCodes.length ? r.reasonCodes.join(', ') : '—'}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
};

export default JobOrderHiringRecentDecisions;
