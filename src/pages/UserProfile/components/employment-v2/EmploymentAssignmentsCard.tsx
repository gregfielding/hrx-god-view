import React, { useState } from 'react';
import {
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
  Button,
  Collapse,
  Box,
  Chip,
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import type { EmploymentAssignmentSummary } from './employmentV2Types';

export interface EmploymentAssignmentsCardProps {
  assignments: EmploymentAssignmentSummary[];
}

const EmploymentAssignmentsCard: React.FC<EmploymentAssignmentsCardProps> = ({ assignments }) => {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <Card sx={{ mb: 2 }}>
      <CardHeader
        title="Assignments under this entity"
        titleTypographyProps={{ variant: 'h6', fontWeight: 700 }}
      />
      <CardContent sx={{ pt: 0 }}>
        {assignments.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No assignments linked to this hiring entity yet. Assignments are matched using the job order&apos;s hiring
            entity.
          </Typography>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Job</TableCell>
                <TableCell>Assignment</TableCell>
                <TableCell>Onboarding</TableCell>
                <TableCell>Start</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {assignments.map((a) => {
                const req = a.resolvedRequirementsSummary;
                const open = expanded === a.assignmentId;
                return (
                  <React.Fragment key={a.assignmentId}>
                    <TableRow hover>
                      <TableCell>{a.title || a.jobOrderId || '—'}</TableCell>
                      <TableCell>
                        <Chip size="small" label={a.status || '—'} variant="outlined" />
                      </TableCell>
                      <TableCell>
                        <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap" useFlexGap>
                          <Typography variant="body2">{a.onboardingStatus || '—'}</Typography>
                          {a.onboardingPercent != null && (
                            <Chip size="small" label={`${a.onboardingPercent}%`} variant="outlined" />
                          )}
                        </Stack>
                      </TableCell>
                      <TableCell>{a.startDate || '—'}</TableCell>
                      <TableCell align="right">
                        <Stack direction="row" spacing={0.5} justifyContent="flex-end" flexWrap="wrap" useFlexGap>
                          <Button size="small" onClick={() => setExpanded(open ? null : a.assignmentId)}>
                            {open ? 'Hide' : 'Requirements'}
                          </Button>
                          <Button size="small" variant="outlined" onClick={() => navigate(`/assignments/${a.assignmentId}`)}>
                            Open
                          </Button>
                        </Stack>
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell colSpan={5} sx={{ py: 0, borderBottom: open ? undefined : 'none' }}>
                        <Collapse in={open}>
                          <Box sx={{ py: 1.5, px: 0 }}>
                            <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
                              Requirement snapshot
                            </Typography>
                            <Typography variant="body2">
                              Required documents (count): {req?.documentsRequired ?? 0}
                            </Typography>
                            <Typography variant="body2">
                              Required checks (count): {req?.checksRequired ?? 0}
                            </Typography>
                            <Typography variant="body2">
                              Signatures pending (e-sign): {req?.signaturesPending ?? 0}
                            </Typography>
                          </Box>
                        </Collapse>
                      </TableCell>
                    </TableRow>
                  </React.Fragment>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
};

export default EmploymentAssignmentsCard;
