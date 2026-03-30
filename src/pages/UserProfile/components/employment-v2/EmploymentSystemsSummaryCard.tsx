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

export interface EmploymentSystemsSummaryCardProps {
  overview: EmploymentEntityOverview;
}

const EmploymentSystemsSummaryCard: React.FC<EmploymentSystemsSummaryCardProps> = ({ overview }) => {
  const [open, setOpen] = useState(false);
  const { systems } = overview;

  return (
    <Card sx={{ mb: 2, opacity: 0.95 }}>
      <CardHeader
        title="Systems summary"
        subheader="Operational detail — not the primary workflow surface"
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
                  {systems.everify.actionNeeded ? ' · Action may be needed' : ''}
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
                    Signed {systems.documents.signedCount} · Pending {systems.documents.pendingCount}
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
