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
  IconButton,
  Tooltip,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import { useNavigate } from 'react-router-dom';
import type { EmploymentAssignmentSummary } from './employmentV2Types';
import {
  assignmentReadinessSectionDisplayName,
  assignmentReadinessSectionStatusDisplay,
  assignmentReadinessStateDisplay,
  isAssignmentSummaryTerminal,
} from '../../../../utils/assignmentReadinessUi';

function readinessChipColor(
  state: string | null | undefined
): 'default' | 'success' | 'warning' | 'error' | 'info' {
  const s = String(state || '').toLowerCase();
  if (s === 'blocked') return 'error';
  if (s === 'requirements_incomplete' || s === 'pending_confirmation') return 'warning';
  if (s === 'ready' || s === 'active' || s === 'completed') return 'success';
  return 'default';
}

/** Tooltip adds legacy/instance detail only — row already shows canonical state + summary. */
function assignmentReadinessTooltip(a: EmploymentAssignmentSummary): string {
  const r = a.assignmentReadinessV1;
  const parts: string[] = [];
  if (!r) {
    parts.push(`Assignment status: ${a.status || '—'}`);
    if (a.onboardingPercent != null) parts.push(`Instance: ${a.onboardingPercent}%`);
    if (a.onboardingStatus) parts.push(`Instance status: ${a.onboardingStatus}`);
    return parts.filter(Boolean).join('\n');
  }
  parts.push(`Raw assignment status: ${a.status || '—'}`);
  if (a.onboardingPercent != null) parts.push(`Instance completion: ${a.onboardingPercent}%`);
  if (a.onboardingStatus) parts.push(`Instance status: ${a.onboardingStatus}`);
  if (r.blockingRequirementIds?.length) {
    parts.push(`Blocking requirement ids: ${r.blockingRequirementIds.join(', ')}`);
  }
  return parts.filter(Boolean).join('\n');
}

export interface EmploymentAssignmentsCardProps {
  assignments: EmploymentAssignmentSummary[];
  /** When false, all rows are framed as historical (no “current” live assignments). */
  hasOpenOnboardingDemand: boolean;
  /**
   * When false, assignment tables start collapsed (on-call pool — checklist first).
   * Empty state (no rows) is always shown without collapsing.
   */
  defaultListExpanded?: boolean;
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
                  <Tooltip title={assignmentReadinessTooltip(a)} placement="top" enterDelay={400}>
                    <Chip
                      size="small"
                      label={
                        a.assignmentReadinessV1
                          ? assignmentReadinessStateDisplay(a.assignmentReadinessV1.assignmentReadinessState)
                          : 'Readiness not synced'
                      }
                      color={
                        a.assignmentReadinessV1
                          ? readinessChipColor(a.assignmentReadinessV1.assignmentReadinessState)
                          : 'default'
                      }
                      variant={
                        a.assignmentReadinessV1 &&
                        ['blocked', 'requirements_incomplete', 'pending_confirmation'].includes(
                          String(a.assignmentReadinessV1.assignmentReadinessState || '').toLowerCase()
                        )
                          ? 'filled'
                          : 'outlined'
                      }
                    />
                  </Tooltip>
                  {historical ? (
                    <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.7rem' }}>
                      Past
                    </Typography>
                  ) : null}
                </Stack>
              </TableCell>
              <TableCell>
                <Stack spacing={0.25} alignItems="flex-start">
                  {a.assignmentReadinessV1?.readinessSummary ? (
                    <Typography variant="body2" sx={{ lineHeight: 1.3 }}>
                      {a.assignmentReadinessV1.readinessSummary}
                    </Typography>
                  ) : a.assignmentReadinessV1 ? (
                    <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.3 }}>
                      {assignmentReadinessStateDisplay(a.assignmentReadinessV1.assignmentReadinessState)}
                    </Typography>
                  ) : null}
                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
                    {a.onboardingStatus || '—'}
                    {a.onboardingPercent != null ? ` · ${a.onboardingPercent}%` : ''}
                  </Typography>
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
                    <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
                      {historical ? 'Extra detail (historical)' : 'Extra detail — package counts and section chips'}
                    </Typography>
                    {a.assignmentReadinessV1?.assignmentSectionStatuses?.length ? (
                      <Stack direction="row" flexWrap="wrap" gap={0.5} useFlexGap sx={{ mb: 1.25 }}>
                        {a.assignmentReadinessV1.assignmentSectionStatuses.map((row) => (
                          <Chip
                            key={row.sectionId}
                            size="small"
                            variant="outlined"
                            label={`${assignmentReadinessSectionDisplayName(row.sectionId)} · ${assignmentReadinessSectionStatusDisplay(row.status)}`}
                          />
                        ))}
                      </Stack>
                    ) : null}
                    {a.assignmentReadinessV1?.blockingRequirementIds &&
                    a.assignmentReadinessV1.blockingRequirementIds.length > 0 ? (
                      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
                        Blocking ids: {a.assignmentReadinessV1.blockingRequirementIds.join(', ')}
                      </Typography>
                    ) : null}
                    <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 0.5 }}>
                      Onboarding instance package
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Required documents: {req?.documentsRequired ?? 0}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Required checks: {req?.checksRequired ?? 0}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
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
  defaultListExpanded = true,
}) => {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(defaultListExpanded);

  const live = assignments.filter((a) => !isAssignmentSummaryTerminal(a));
  const past = assignments.filter((a) => isAssignmentSummaryTerminal(a));

  const subheader = !hasOpenOnboardingDemand
    ? 'Past or context only — no live assignment onboarding for this entity.'
    : live.length > 0 && past.length > 0
      ? `${live.length} current · ${past.length} past`
      : past.length > 0 && live.length === 0
        ? 'All listed assignments are completed or cancelled.'
        : `${live.length} current assignment${live.length === 1 ? '' : 's'}`;

  if (assignments.length === 0) {
    return (
      <Box sx={{ mb: 1.5 }}>
        <Typography variant="subtitle2" fontWeight={700} color="text.secondary" sx={{ mb: 0.25 }}>
          Assignments
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.4 }}>
          None linked to this hiring entity. Assignments match the job order&apos;s entity.
        </Typography>
      </Box>
    );
  }

  const tablesBody = (
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
                  <TableCell>Readiness</TableCell>
                  <TableCell>Summary / instance</TableCell>
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
                  <TableCell>Readiness</TableCell>
                  <TableCell>Summary / instance</TableCell>
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
  );

  return (
    <Card sx={{ mb: 2 }} variant="outlined">
      <CardHeader
        title="Assignments under this entity"
        subheader={subheader}
        titleTypographyProps={{ variant: 'subtitle1', fontWeight: 700 }}
        subheaderTypographyProps={{ variant: 'caption', color: 'text.secondary' }}
        action={
          <IconButton aria-label="expand assignments list" onClick={() => setListOpen((v) => !v)} size="small">
            {listOpen ? <ExpandLessIcon /> : <ExpandMoreIcon />}
          </IconButton>
        }
      />
      <Collapse in={listOpen}>
        <CardContent sx={{ pt: 0 }}>{tablesBody}</CardContent>
      </Collapse>
    </Card>
  );
};

export default EmploymentAssignmentsCard;
