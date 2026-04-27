/**
 * Worker Documents Summary — Shift Ready status strip (Work Eligibility, ID, Certs, Background).
 * Spec: HRX / C1 Worker Documents Page Spec — Section 2
 */

import React from 'react';
import { Card, CardContent, Stack, Typography, Box, Link } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import WarningIcon from '@mui/icons-material/Warning';
import ScheduleIcon from '@mui/icons-material/Schedule';
import BadgeIcon from '@mui/icons-material/Badge';
import SchoolIcon from '@mui/icons-material/School';
import GavelIcon from '@mui/icons-material/Gavel';
import { Link as RouterLink } from 'react-router-dom';

export type SummaryStatus = 'verified' | 'missing' | 'submitted';

export interface WorkerDocumentsSummaryProps {
  /** From attestation: verified if attested and authorized, else missing */
  eligibilityStatus: SummaryStatus;
  idStatus: SummaryStatus;
  certCount: number;
  /** Summary of screening orders (background, drug, other, e-verify) from admin; "—" or "None ordered" if none */
  backgroundLabel?: string;
  /** Hide Gov ID row; show only Work Eligibility, Certifications, Background */
  hideId?: boolean;
  /** Work Eligibility is attestation: show "Review answers" link (never Upload/View). When set, CTA goes to this URL (e.g. /c1/workers/profile#work-eligibility). */
  eligibilityReviewHref?: string;
}

function StatusIcon({ status }: { status: SummaryStatus }) {
  switch (status) {
    case 'verified':
      return <CheckCircleIcon sx={{ fontSize: 20, color: 'success.main' }} />;
    case 'submitted':
      return <ScheduleIcon sx={{ fontSize: 20, color: 'action.active' }} />;
    case 'missing':
    default:
      return <WarningIcon sx={{ fontSize: 20, color: 'warning.main' }} />;
  }
}

function getStatusLabel(status: SummaryStatus): string {
  switch (status) {
    case 'verified':
      return 'Verified';
    case 'submitted':
      return 'Submitted';
    case 'missing':
    default:
      return 'Missing';
  }
}

const WorkerDocumentsSummary: React.FC<WorkerDocumentsSummaryProps> = ({
  eligibilityStatus,
  idStatus,
  certCount,
  backgroundLabel = '—',
  hideId = false,
  eligibilityReviewHref,
}) => {
  return (
    <Card
      variant="outlined"
      sx={{
        borderRadius: 2,
        borderColor: 'divider',
        boxShadow: 'none',
      }}
    >
      <CardContent sx={{ py: 2, px: 2 }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={2}
          justifyContent="space-around"
          alignItems={{ xs: 'stretch', sm: 'center' }}
          flexWrap="wrap"
          useFlexGap
        >
          <Stack direction="row" alignItems="center" spacing={1}>
            <GavelIcon sx={{ fontSize: 22, color: 'action.active' }} />
            <Box>
              <Typography variant="caption" color="text.secondary" display="block">
                Work Eligibility
              </Typography>
              <Stack direction="row" alignItems="center" spacing={0.5} flexWrap="wrap">
                <StatusIcon status={eligibilityStatus} />
                <Typography variant="body2" fontWeight={500}>
                  {getStatusLabel(eligibilityStatus)}
                </Typography>
                {eligibilityReviewHref && (
                  <Link component={RouterLink} to={eligibilityReviewHref} variant="body2" sx={{ ml: 0.5 }}>
                    Review answers
                  </Link>
                )}
              </Stack>
              <Typography variant="caption" color="text.secondary" display="block">
                From your application (attestation)
              </Typography>
            </Box>
          </Stack>
          {!hideId && (
            <Stack direction="row" alignItems="center" spacing={1}>
              <BadgeIcon sx={{ fontSize: 22, color: 'action.active' }} />
              <Box>
                <Typography variant="caption" color="text.secondary" display="block">
                  ID
                </Typography>
                <Stack direction="row" alignItems="center" spacing={0.5}>
                  <StatusIcon status={idStatus} />
                  <Typography variant="body2" fontWeight={500}>
                    {getStatusLabel(idStatus)}
                  </Typography>
                </Stack>
              </Box>
            </Stack>
          )}
          <Stack direction="row" alignItems="center" spacing={1}>
            <SchoolIcon sx={{ fontSize: 22, color: 'action.active' }} />
            <Box>
              <Typography variant="caption" color="text.secondary" display="block">
                Certifications
              </Typography>
              <Typography variant="body2" fontWeight={500}>
                {certCount}
              </Typography>
            </Box>
          </Stack>
          <Stack direction="row" alignItems="center" spacing={1}>
            <ScheduleIcon sx={{ fontSize: 22, color: 'action.disabled' }} />
            <Box>
              <Typography variant="caption" color="text.secondary" display="block">
                Background
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {backgroundLabel}
              </Typography>
              <Typography variant="caption" color="text.secondary" display="block">
                From admin orders
              </Typography>
            </Box>
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
};

export default WorkerDocumentsSummary;
