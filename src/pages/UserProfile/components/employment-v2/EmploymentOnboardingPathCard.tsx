import React from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  Typography,
  Stack,
  Chip,
  Box,
  Divider,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import type {
  EmploymentOnboardingArtifactScope,
  EmploymentOnboardingRow,
  OnboardingPathGroup,
  OnboardingPathUiStatus,
} from './employmentV2Types';

const UI_STATUS_LABEL: Record<OnboardingPathUiStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  completed: 'Completed',
  satisfied_by_existing_record: 'Satisfied by existing record',
  not_required: 'Not required',
  error: 'Error',
};

/** Filled chip color for primary status (completed vs reuse must differ). */
const STATUS_CHIP_COLOR: Record<
  OnboardingPathUiStatus,
  'default' | 'warning' | 'success' | 'error' | 'info'
> = {
  not_started: 'default',
  in_progress: 'info',
  completed: 'success',
  satisfied_by_existing_record: 'info',
  not_required: 'default',
  error: 'error',
};

const OWNER_LABEL: Record<EmploymentOnboardingRow['owner'], string> = {
  worker: 'Worker',
  admin: 'Admin',
  system: 'System',
  vendor: 'Vendor',
};

/** Where the row’s primary signal comes from (pipeline, payroll, case, etc.). */
const ROW_SIGNAL_LABEL: Record<EmploymentOnboardingRow['sourceType'], string> = {
  settings_only: 'Settings only (no runtime yet)',
  pipeline_step: 'Onboarding pipeline',
  pipeline_task: 'Pipeline task',
  everify: 'E-Verify case',
  background_check: 'Background check order',
  payroll: 'Payroll account',
  assignment_requirement: 'Assignment package',
  derived: 'Derived',
};

const SCOPE_LABEL: Record<NonNullable<EmploymentOnboardingRow['artifactScope']>, string> = {
  worker_global: 'Worker-wide (tenant)',
  entity_scoped: 'This entity (C1)',
  assignment_scoped: 'This assignment',
};

const ARTIFACT_TYPE_LABEL: Record<NonNullable<EmploymentOnboardingRow['artifactSourceType']>, string> = {
  background_check: 'Background check',
  everify: 'E-Verify',
  payroll: 'Payroll',
  document: 'Document',
};

function formatUpdated(iso: string | null | undefined): string | null {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleString();
  } catch {
    return null;
  }
}

/** Canonical status chip copy so “this flow” vs “reuse” is obvious at a glance. */
function primaryStatusChipLabel(row: EmploymentOnboardingRow): string {
  if (row.status === 'completed') {
    return 'Completed (this flow)';
  }
  if (row.status === 'satisfied_by_existing_record') {
    return 'Satisfied by existing record';
  }
  return row.statusLabel || UI_STATUS_LABEL[row.status];
}

function StepRow({ row }: { row: EmploymentOnboardingRow }) {
  const theme = useTheme();
  const updated = formatUpdated(row.lastUpdatedAt);
  const artifactAt = formatUpdated(row.artifactCompletedAt);

  const isCompletedFlow = row.status === 'completed';
  const isSatisfiedReuse = row.status === 'satisfied_by_existing_record';
  const showReuseCallout =
    isSatisfiedReuse || (row.satisfiedByArtifact === true && row.artifactSourceType != null);

  const statusColor = STATUS_CHIP_COLOR[row.status];

  const rowSurface =
    isSatisfiedReuse
      ? alpha(theme.palette.info.main, 0.07)
      : isCompletedFlow
        ? alpha(theme.palette.success.main, 0.08)
        : theme.palette.action.hover;

  const rowAccent = isSatisfiedReuse
    ? theme.palette.info.main
    : isCompletedFlow
      ? theme.palette.success.main
      : 'transparent';

  return (
    <Box
      sx={{
        py: 1.25,
        px: 1.5,
        borderRadius: 1,
        bgcolor: rowSurface,
        borderLeft: rowAccent !== 'transparent' ? 4 : 0,
        borderLeftColor: rowAccent,
        borderLeftStyle: 'solid',
      }}
    >
      <Typography variant="body2" fontWeight={700} sx={{ mb: 1 }}>
        {row.label}
      </Typography>

      <Stack direction="row" flexWrap="wrap" useFlexGap spacing={0.5} gap={0.5} sx={{ mb: 1 }}>
        <Chip
          size="small"
          label={primaryStatusChipLabel(row)}
          color={statusColor}
          variant="filled"
          sx={
            isSatisfiedReuse
              ? {
                  fontWeight: 700,
                  border: `1px solid ${alpha(theme.palette.info.dark, 0.35)}`,
                }
              : isCompletedFlow
                ? { fontWeight: 700 }
                : undefined
          }
        />
        <Chip size="small" variant="outlined" label={`Owner: ${OWNER_LABEL[row.owner]}`} />
        <Chip size="small" variant="outlined" label={row.required ? 'Required' : 'Optional'} />
        <Chip size="small" variant="outlined" label={row.blocking ? 'Blocking' : 'Non-blocking'} />
        <Chip size="small" variant="outlined" color="default" label={`Signal: ${ROW_SIGNAL_LABEL[row.sourceType]}`} />
      </Stack>

      {showReuseCallout && (
        <Box
          sx={{
            mt: 0.5,
            mb: row.helperText || updated || artifactAt ? 0.75 : 0,
            p: 1,
            borderRadius: 1,
            border: `1px solid ${alpha(theme.palette.info.main, 0.45)}`,
            bgcolor: alpha(theme.palette.info.main, 0.04),
          }}
        >
          <Stack direction="row" alignItems="center" spacing={0.75} sx={{ mb: 0.75 }} flexWrap="wrap" useFlexGap>
            <Chip size="small" label="Prior compliance record" color="info" variant="filled" sx={{ fontWeight: 700 }} />
            <Typography variant="caption" color="text.secondary">
              Not completed as a new step in this onboarding flow — an existing valid record satisfies the requirement.
            </Typography>
          </Stack>
          <Stack spacing={0.35}>
            <Typography variant="caption" color="text.secondary">
              <Box component="span" sx={{ fontWeight: 700, color: 'text.primary' }}>
                Artifact type:{' '}
              </Box>
              {row.artifactSourceType != null
                ? ARTIFACT_TYPE_LABEL[row.artifactSourceType]
                : '— (not returned for this row yet)'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              <Box component="span" sx={{ fontWeight: 700, color: 'text.primary' }}>
                Scope:{' '}
              </Box>
              {row.artifactScope != null
                ? SCOPE_LABEL[row.artifactScope as EmploymentOnboardingArtifactScope]
                : '—'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              <Box component="span" sx={{ fontWeight: 700, color: 'text.primary' }}>
                Record completed:{' '}
              </Box>
              {artifactAt ?? '—'}
            </Typography>
            {(row.artifactId != null && row.artifactId !== '') ? (
              <Typography variant="caption" color="text.secondary" sx={{ wordBreak: 'break-all' }}>
                <Box component="span" sx={{ fontWeight: 700, color: 'text.primary' }}>
                  Record ID:{' '}
                </Box>
                {row.artifactId}
              </Typography>
            ) : null}
          </Stack>
        </Box>
      )}

      {row.helperText && (
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5, lineHeight: 1.45 }}>
          <Box component="span" sx={{ fontWeight: 600, color: 'text.primary' }}>
            Why this status:{' '}
          </Box>
          {row.helperText}
        </Typography>
      )}

      {updated && !isSatisfiedReuse && (
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.25 }}>
          Last updated: {updated}
        </Typography>
      )}
      {isSatisfiedReuse && updated && (
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.25 }}>
          Row last synced: {updated}
        </Typography>
      )}
    </Box>
  );
}

function GroupSection({ group }: { group: OnboardingPathGroup }) {
  const frac = group.totalCount > 0 ? `${group.doneCount} / ${group.totalCount}` : '—';
  const reuseDone = group.rows.filter((r) => r.status === 'satisfied_by_existing_record').length;
  const flowDone = group.rows.filter((r) => r.status === 'completed').length;

  return (
    <Box sx={{ mb: 2 }}>
      <Stack direction="row" alignItems="flex-start" justifyContent="space-between" flexWrap="wrap" gap={1} sx={{ mb: 1 }}>
        <Box>
          <Typography variant="subtitle1" fontWeight={700}>
            {group.title}
          </Typography>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.25 }}>
            {group.totalCount > 0 && (
              <>
                {frac} steps done{reuseDone > 0 ? ' (includes prior-record satisfaction)' : ''}.
                {flowDone > 0 && <span> {flowDone} completed in this flow.</span>}
                {reuseDone > 0 && (
                  <span>
                    {' '}
                    {reuseDone} satisfied by prior record{reuseDone === 1 ? '' : 's'}.
                  </span>
                )}
              </>
            )}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <Chip size="small" variant="outlined" label={`${frac} complete`} />
          {group.blockerCount > 0 && (
            <Chip size="small" color="error" label={`${group.blockerCount} blocker${group.blockerCount === 1 ? '' : 's'}`} />
          )}
        </Stack>
      </Stack>
      <Stack spacing={1.25}>
        {group.rows.map((r) => (
          <StepRow key={r.rowId} row={r} />
        ))}
      </Stack>
    </Box>
  );
}

export interface EmploymentOnboardingPathCardProps {
  groups: OnboardingPathGroup[];
}

const EmploymentOnboardingPathCard: React.FC<EmploymentOnboardingPathCardProps> = ({ groups }) => {
  return (
    <Card sx={{ mb: 2 }}>
      <CardHeader title={<Typography variant="h6" fontWeight={700}>Onboarding progress</Typography>} />
      <CardContent sx={{ pt: 0 }}>
        {groups.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No onboarding steps are configured for this entity in Settings, or nothing applies yet. Enable workflow
            steps on the entity to see the path here.
          </Typography>
        ) : (
          <>
            {groups.map((g, i) => (
              <React.Fragment key={g.groupId}>
                {i > 0 && <Divider sx={{ my: 2 }} />}
                <GroupSection group={g} />
              </React.Fragment>
            ))}
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default EmploymentOnboardingPathCard;
