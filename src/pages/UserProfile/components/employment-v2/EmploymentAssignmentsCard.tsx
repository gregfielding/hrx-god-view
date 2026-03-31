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
import { isAssignmentTerminalNormalized } from '../../../../utils/assignmentStatusNormalize';

export interface EmploymentAssignmentsCardProps {
  assignments: EmploymentAssignmentSummary[];
  /** When false, all rows are framed as historical (no “current” live assignments). */
  hasOpenOnboardingDemand: boolean;
}

function AssignmentRows({
  assignments,
  expanded,
  setExpanded,
  navigate,
  historical,
}: {
  assignments: EmploymentAssignmentSummary[];
  expanded: string | null;
  setExpanded: (id: string | null) => void;
  navigate: (path: string) => void;
  historical: boolean;
}) {
  return (
    <>
      {assignments.map((a) => {
        const req = a.resolvedRequirementsSummary;
        const open = expanded === a.assignmentId;
        return (
          <React.Fragment key={a.assignmentId}>
            <TableRow
              hover
              sx={
                historical
                  ? {
                      opacity: 0.92,
                      '& .MuiTableCell-root': { color: 'text.secondary' },
                    }
                  : undefined
              }
            >
              <TableCell>{a.title || a.jobOrderId || '—'}</TableCell>
              <TableCell>
                <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap" useFlexGap>
                  <Chip size="small" label={a.status || '—'} variant="outlined" />
                  {historical ? (
                    <Chip size="small" label="Past" variant="outlined" sx={{ fontSize: '0.65rem', height: 22 }} />
                  ) : null}
                </Stack>
              </TableCell>
              <TableCell>
                <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap" useFlexGap>
                  <Typography variant="body2">{a.onboardingStatus || '—'}</Typography>
                  {a.onboardingPercent != null && (
                    <Chip
                      size="small"
                      variant="outlined"
                      label={historical ? `Record · ${a.onboardingPercent}%` : `${a.onboardingPercent}%`}
                    />
                  )}
                </Stack>
              </TableCell>
              <TableCell>{a.startDate || '—'}</TableCell>
              <TableCell align="right">
                <Stack direction="row" spacing={0.5} justifyContent="flex-end" flexWrap="wrap" useFlexGap>
                  <Button size="small" onClick={() => setExpanded(open ? null : a.assignmentId)}>
                    {open ? 'Hide' : historical ? 'Snapshot' : 'Requirements'}
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
                      {historical ? 'Requirement snapshot (historical)' : 'Requirement snapshot'}
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
    </>
  );
}

const EmploymentAssignmentsCard: React.FC<EmploymentAssignmentsCardProps> = ({
  assignments,
  hasOpenOnboardingDemand,
}) => {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState<string | null>(null);

  const live = assignments.filter((a) => !isAssignmentTerminalNormalized(a.status));
  const past = assignments.filter((a) => isAssignmentTerminalNormalized(a.status));

  const subheader =
    assignments.length === 0
      ? undefined
      : !hasOpenOnboardingDemand
        ? 'All rows are past or context-only — no live assignment onboarding for this entity.'
        : live.length > 0 && past.length > 0
          ? `${live.length} current · ${past.length} past`
          : past.length > 0 && live.length === 0
            ? 'All listed assignments are completed or cancelled.'
            : `${live.length} current assignment${live.length === 1 ? '' : 's'}`;

  return (
    <Card sx={{ mb: 2 }}>
      <CardHeader
        title="Assignments under this entity"
        subheader={subheader}
        titleTypographyProps={{ variant: 'h6', fontWeight: 700 }}
        subheaderTypographyProps={{ variant: 'body2', color: 'text.secondary' }}
      />
      <CardContent sx={{ pt: 0 }}>
        {assignments.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No assignments linked to this hiring entity yet. Assignments are matched using the job order&apos;s hiring
            entity.
          </Typography>
        ) : (
          <Stack spacing={3}>
            {hasOpenOnboardingDemand && live.length > 0 ? (
              <Box>
                <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
                  Current assignments
                </Typography>
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
                    <AssignmentRows
                      assignments={live}
                      expanded={expanded}
                      setExpanded={setExpanded}
                      navigate={navigate}
                      historical={false}
                    />
                  </TableBody>
                </Table>
              </Box>
            ) : null}

            {past.length > 0 ? (
              <Box>
                <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1, color: 'text.secondary' }}>
                  Past assignments
                </Typography>
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
                  Completed or cancelled — package and snapshot values are for audit, not current required work.
                </Typography>
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
                    <AssignmentRows
                      assignments={past}
                      expanded={expanded}
                      setExpanded={setExpanded}
                      navigate={navigate}
                      historical
                    />
                  </TableBody>
                </Table>
              </Box>
            ) : null}

          </Stack>
        )}
      </CardContent>
    </Card>
  );
};

export default EmploymentAssignmentsCard;
