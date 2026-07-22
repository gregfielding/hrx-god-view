import React, { useCallback } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Collapse,
  Divider,
  Stack,
  Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import { useNavigate } from 'react-router-dom';
import type {
  AssignmentPanelReadinessUi,
  AssignmentReadinessPanelRow,
} from '../../../utils/assignmentReadinessPanelModel';
import {
  assignmentReadinessReasonPhrase,
  assignmentReadinessRecruiterChipColor,
  assignmentReadinessRecruiterChipFilled,
  assignmentReadinessRecruiterChipLabel,
  primaryActionForAssignmentRow,
} from '../../../utils/assignmentReadinessPanelModel';

function showAssignmentReadinessReasonLine(readinessUi: AssignmentPanelReadinessUi): boolean {
  return readinessUi !== 'ready' && readinessUi !== 'active' && readinessUi !== 'completed' && readinessUi !== 'canceled';
}
import { packageSectionsSummaryFromReadiness } from '../../../utils/assignmentReadinessUi';
import AssignmentDrawer, {
  type AssignmentDrawerTarget,
} from '../../../components/recruiter/AssignmentDrawer';
import { workerFacingScreeningPrimaryLineFromRecord } from '../../../utils/backgroundChecks/formatWorkerFacingScreeningPackage';

export interface AssignmentReadinessPanelProps {
  rows: AssignmentReadinessPanelRow[];
  /** When provided (admin surfaces), clicking an assignment opens the
   *  admin AssignmentDrawer (view/edit/end/delete) instead of
   *  deep-linking into the worker-facing assignment page. */
  tenantId?: string | null;
  workerId?: string;
  workerName?: string;
}

const AssignmentReadinessCard: React.FC<{
  row: AssignmentReadinessPanelRow;
  onOpenAdmin?: (row: AssignmentReadinessPanelRow) => void;
}> = ({ row, onOpenAdmin }) => {
  const navigate = useNavigate();
  const [detailsOpen, setDetailsOpen] = React.useState(false);
  const packageSummary = packageSectionsSummaryFromReadiness(row.readiness);

  const openAssignment = useCallback(() => {
    if (onOpenAdmin) {
      onOpenAdmin(row);
      return;
    }
    navigate(`/assignments/${encodeURIComponent(row.assignmentId)}`);
  }, [navigate, onOpenAdmin, row]);

  const hasBlocking = row.blockingLines.length > 0;
  const hasDetails = Boolean(packageSummary || row.linkedScreenings.length > 0);
  const primaryAction = primaryActionForAssignmentRow(row);

  const startChipColor: 'default' | 'warning' | 'error' | 'info' | 'success' =
    row.startDateContext.tone === 'default' ? 'default' : row.startDateContext.tone;

  return (
    <Card variant="outlined" sx={{ mb: 1.5 }}>
      <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
        <Stack spacing={1.25}>
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start" gap={1} flexWrap="wrap">
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="subtitle1" fontWeight={800} sx={{ lineHeight: 1.3 }}>
                {row.title}
              </Typography>
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.25 }}>
                {row.companyDisplay} · {row.worksiteDisplay}
              </Typography>
              <Stack direction="row" alignItems="center" flexWrap="wrap" gap={0.75} sx={{ mt: 0.35 }}>
                <Typography variant="caption" color="text.secondary" display="block">
                  Start {row.startDate} · End {row.endDate} · Assignment status: {row.assignmentStatus}
                </Typography>
                <Chip
                  size="small"
                  label={row.startDateContext.label}
                  color={startChipColor}
                  variant="outlined"
                  sx={{ height: 22, '& .MuiChip-label': { px: 0.75, fontSize: '0.7rem' } }}
                />
              </Stack>
            </Box>
            <Chip
              size="small"
              label={assignmentReadinessRecruiterChipLabel(row)}
              color={assignmentReadinessRecruiterChipColor(row)}
              variant={assignmentReadinessRecruiterChipFilled(row) ? 'filled' : 'outlined'}
              sx={{ flexShrink: 0 }}
            />
          </Stack>

          <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.45 }}>
            {row.readinessLabel}
            {row.readiness?.readinessSummary && row.readiness.readinessSummary !== row.readinessLabel
              ? ` · ${row.readiness.readinessSummary}`
              : null}
          </Typography>

          {showAssignmentReadinessReasonLine(row.readinessUi) ? (
            <Typography
              variant="caption"
              color="text.secondary"
              display="block"
              sx={{ lineHeight: 1.45, fontStyle: 'italic' }}
            >
              {assignmentReadinessReasonPhrase(row.reasonCode)}
            </Typography>
          ) : null}

          {hasBlocking ? (
            <Box>
              <Typography variant="caption" fontWeight={700} color="text.secondary" display="block" sx={{ mb: 0.35 }}>
                Blocking & open items
              </Typography>
              <Box component="ul" sx={{ m: 0, pl: 2 }}>
                {row.blockingLines.slice(0, 8).map((line, i) => (
                  <Typography key={`${i}:${line}`} component="li" variant="body2" sx={{ lineHeight: 1.4 }}>
                    {line}
                  </Typography>
                ))}
              </Box>
              {row.blockingLines.length > 8 ? (
                <Typography variant="caption" color="text.secondary">
                  +{row.blockingLines.length - 8} more
                </Typography>
              ) : null}
            </Box>
          ) : null}

          <Stack direction="row" flexWrap="wrap" gap={1} alignItems="center">
            <Button
              size="small"
              variant={primaryAction.variant}
              color={primaryAction.color}
              onClick={openAssignment}
            >
              {primaryAction.label}
            </Button>
            {hasDetails ? (
              <Button
                size="small"
                variant="text"
                onClick={() => setDetailsOpen((o) => !o)}
                endIcon={detailsOpen ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                sx={{ textTransform: 'none' }}
              >
                {detailsOpen ? 'Hide package & screenings' : 'Package & screenings'}
              </Button>
            ) : null}
          </Stack>

          <Collapse in={detailsOpen}>
            <Divider sx={{ my: 0.5 }} />
            {packageSummary ? (
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1, lineHeight: 1.45 }}>
                <Box component="span" sx={{ fontWeight: 600, color: 'text.primary' }}>
                  Package sections:{' '}
                </Box>
                {packageSummary}
              </Typography>
            ) : null}
            {row.linkedScreenings.length > 0 ? (
              <Box>
                <Typography variant="caption" fontWeight={700} color="text.secondary" display="block" sx={{ mb: 0.35 }}>
                  Linked screenings
                </Typography>
                {row.linkedScreenings.map((c) => (
                  <Typography key={c.id} variant="body2" sx={{ lineHeight: 1.4 }}>
                    {workerFacingScreeningPrimaryLineFromRecord(c)} — {String(c.hrxStatus || '—').replace(/_/g, ' ')}
                  </Typography>
                ))}
              </Box>
            ) : null}
          </Collapse>
        </Stack>
      </CardContent>
    </Card>
  );
};

const AssignmentReadinessPanel: React.FC<AssignmentReadinessPanelProps> = ({
  rows,
  tenantId,
  workerId,
  workerName,
}) => {
  const [drawerTarget, setDrawerTarget] = React.useState<AssignmentDrawerTarget | null>(null);
  const adminMode = Boolean(tenantId && workerId);
  const openAdmin = React.useCallback(
    (row: AssignmentReadinessPanelRow) => {
      if (!workerId) return;
      // Assignment doc ids embed the shift id: `${shiftId}__${userId}`
      // (optionally `__${date}`), so the drawer can load the family.
      const shiftId = row.assignmentId.split('__')[0] || null;
      setDrawerTarget({
        workerId,
        workerName: workerName || '',
        jobOrderId: row.jobOrderId,
        shiftId,
        assignmentId: row.assignmentId,
      });
    },
    [workerId, workerName],
  );

  if (!rows.length) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
        No assignments for this worker in this tenant.
      </Typography>
    );
  }

  return (
    <Stack spacing={0}>
      {rows.map((row) => (
        <AssignmentReadinessCard
          key={row.assignmentId}
          row={row}
          onOpenAdmin={adminMode ? openAdmin : undefined}
        />
      ))}
      {adminMode && tenantId && (
        <AssignmentDrawer
          open={!!drawerTarget}
          tenantId={tenantId}
          target={drawerTarget}
          onClose={() => setDrawerTarget(null)}
          onEnded={() => setDrawerTarget(null)}
        />
      )}
    </Stack>
  );
};

export default AssignmentReadinessPanel;
