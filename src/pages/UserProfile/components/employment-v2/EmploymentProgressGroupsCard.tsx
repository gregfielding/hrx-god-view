import React from 'react';
import {
  Box,
  Card,
  CardContent,
  CardHeader,
  Typography,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Chip,
} from '@mui/material';
import type { EmploymentEntityKey, EmploymentEntityOverview } from './employmentV2Types';
import { buildProgressGroupsForEntity } from '../../../../utils/employmentReadiness';

export interface EmploymentProgressGroupsCardProps {
  entityKey: EmploymentEntityKey;
  overview: EmploymentEntityOverview;
}

const EmploymentProgressGroupsCard: React.FC<EmploymentProgressGroupsCardProps> = ({
  entityKey,
  overview,
}) => {
  const groups = buildProgressGroupsForEntity(entityKey, overview.workerOnboarding);

  return (
    <Card sx={{ mb: 2 }}>
      <CardHeader title="Onboarding progress" titleTypographyProps={{ variant: 'h6', fontWeight: 700 }} />
      <CardContent sx={{ pt: 0 }}>
        {groups.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No onboarding steps to show for this entity yet.
          </Typography>
        ) : (
          <Stack spacing={2}>
            {groups.map((g) => (
              <Box key={g.groupId}>
                <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                  <Typography variant="subtitle1" fontWeight={600}>
                    {g.title}
                  </Typography>
                  <Chip size="small" label={g.summaryStatus} variant="outlined" />
                </Stack>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Step</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell>Owner</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {g.rows.map((r) => (
                      <TableRow key={r.stepId}>
                        <TableCell>{r.label}</TableCell>
                        <TableCell>{r.status}</TableCell>
                        <TableCell>{r.owner}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
            ))}
          </Stack>
        )}
      </CardContent>
    </Card>
  );
};

export default EmploymentProgressGroupsCard;
