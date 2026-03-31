import React, { useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  CardHeader,
  Typography,
  Stack,
  Collapse,
  IconButton,
  Divider,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import type { EmploymentEntityOverview } from './employmentV2Types';
import { assignmentRequirementsSystemsLine } from '../../../../utils/assignmentRequirementsViewModel';

export interface EmploymentSystemsSummaryCardProps {
  overview: EmploymentEntityOverview;
}

const EmploymentSystemsSummaryCard: React.FC<EmploymentSystemsSummaryCardProps> = ({ overview }) => {
  const [open, setOpen] = useState(false);
  const { systems } = overview;
  const historical = !overview.hasOpenOnboardingDemand;
  const iaLine = assignmentRequirementsSystemsLine(overview.assignmentRequirementsViewModel);

  return (
    <Card sx={{ mb: 2, opacity: 0.95 }}>
      <CardHeader
        title={historical ? 'Systems record (context)' : 'Systems summary'}
        subheader={
          <span>
            {historical
              ? 'Historical context — figures may include completed or cancelled assignment activity; not framed as current required work.'
              : 'Operational detail — not the primary workflow surface.'}
            {iaLine ? (
              <>
                <br />
                <Typography component="span" variant="caption" color="text.secondary">
                  {historical ? 'Snapshot (may include history): ' : 'Job / screening snapshot: '}
                  {iaLine}
                </Typography>
              </>
            ) : null}
          </span>
        }
        titleTypographyProps={{ variant: 'subtitle1', fontWeight: 700 }}
        action={
          <IconButton aria-label="expand" onClick={() => setOpen((v) => !v)} size="small">
            {open ? <ExpandLessIcon /> : <ExpandMoreIcon />}
          </IconButton>
        }
      />
      <Collapse in={open}>
        <CardContent sx={{ pt: 0 }}>
          <Stack spacing={1.5}>
            {systems.everify && systems.everify.applicable && (
              <Box>
                <Typography variant="subtitle2" fontWeight={600}>
                  E-Verify (Select)
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {systems.everify.statusDisplay} · {systems.everify.caseCount} case(s)
                  {systems.everify.actionNeeded
                    ? historical
                      ? ' · Review if a new assignment starts (not framed as open work here)'
                      : ' · Action may be needed'
                    : ''}
                </Typography>
              </Box>
            )}
            {systems.payroll && (
              <>
                <Divider />
                <Box>
                  <Typography variant="subtitle2" fontWeight={600}>
                    Payroll
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {historical ? 'Context: ' : ''}
                    {systems.payroll.statusDisplay}
                    {systems.payroll.portalUrl ? ` · Portal set` : ''}
                  </Typography>
                </Box>
              </>
            )}
            {systems.screenings && (
              <>
                <Divider />
                <Box>
                  <Typography variant="subtitle2" fontWeight={600}>
                    Screenings
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {historical ? 'Record: ' : ''}
                    {systems.screenings.statusDisplay}
                  </Typography>
                </Box>
              </>
            )}
            {systems.documents && systems.documents.applicable && (
              <>
                <Divider />
                <Box>
                  <Typography variant="subtitle2" fontWeight={600}>
                    Documents (e-sign)
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {historical ? 'On file: ' : ''}Signed {systems.documents.signedCount} · Pending{' '}
                    {systems.documents.pendingCount}
                  </Typography>
                </Box>
              </>
            )}
          </Stack>
        </CardContent>
      </Collapse>
    </Card>
  );
};

export default EmploymentSystemsSummaryCard;
