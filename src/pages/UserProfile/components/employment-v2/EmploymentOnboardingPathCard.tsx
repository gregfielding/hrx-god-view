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
  Button,
  Collapse,
  List,
  ListItem,
  ListItemText,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { alpha, useTheme } from '@mui/material/styles';
import type {
  EmploymentEntityKey,
  EmploymentOnboardingArtifactScope,
  EmploymentOnboardingRow,
  OnboardingPathGroup,
  OnboardingPathUiStatus,
  WorkerOnboardingPipeline,
} from './employmentV2Types';
import {
  warnBlockingPathRowsMissingDedicatedActions,
  type EmploymentV2ActionResolutionContext,
} from '../../../../utils/employmentBlockerActionMap';
import { isEmploymentOnboardingPathDebugEnvEnabled } from '../../../../utils/employmentPathDebugEnv';
import { narrativeActorLabelForUi } from '../../../../utils/employmentOnboardingNarrative';
import { EmploymentOnboardingPathRowAction } from './EmploymentOnboardingPathRowAction';
import ExternalOnboardingVerificationControls from './ExternalOnboardingVerificationControls';

/** Explicit `false` turns debug off; `undefined` uses `REACT_APP_EMPLOYMENT_ONBOARDING_PATH_DEBUG`. */
export function resolveEmploymentOnboardingPathDebugMode(explicit?: boolean): boolean {
  if (explicit === false) return false;
  if (explicit === true) return true;
  return isEmploymentOnboardingPathDebugEnvEnabled();
}

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
  recruiter: 'Recruiter',
  system: 'System',
  vendor: 'Vendor',
};

const AUDIENCE_LABEL: Record<EmploymentOnboardingRow['audience'], string> = {
  worker: 'Visible: worker',
  admin: 'Visible: admin',
  both: 'Visible: both',
  internal: 'Visible: internal',
};

const ACTIONABLE_LABEL: Record<EmploymentOnboardingRow['actionableBy'], string> = {
  worker: 'Act: worker',
  recruiter: 'Act: recruiter',
  none: 'Act: none',
  either: 'Act: either',
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
  external_onboarding: 'External onboarding (TempWorks / HRIS)',
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
function plainLanguageStatusLabel(row: EmploymentOnboardingRow): string {
  switch (row.status) {
    case 'completed':
      if (row.sourceType === 'external_onboarding') {
        const s = row.narrative?.summary?.trim();
        if (s) return s;
      }
      return 'This step is finished.';
    case 'satisfied_by_existing_record':
      return 'An existing record already satisfies this requirement.';
    case 'not_required':
      return 'This does not apply here.';
    case 'error':
      return row.statusLabel || 'Something went wrong with this step.';
    case 'in_progress':
      return row.statusLabel || 'In progress.';
    case 'not_started':
      return row.statusLabel || 'Not started yet.';
    default:
      return row.statusLabel || UI_STATUS_LABEL[row.status];
  }
}

const HANDLING_LABEL: Record<EmploymentOnboardingRow['owner'], string> = {
  worker: 'You (the worker)',
  recruiter: 'Your hiring team',
  system: 'Automated processing',
  vendor: 'Outside verification partner',
};

function NarrativeBlock({ row }: { row: EmploymentOnboardingRow }) {
  const [open, setOpen] = React.useState(false);
  const summary = row.narrative?.summary?.trim();
  const events = row.narrative?.events?.filter((e) => String(e.message || '').trim());
  /** Primary status line already shows narrative summary for verified external completions. */
  const summaryShownInStatusLine =
    row.status === 'completed' && row.sourceType === 'external_onboarding' && Boolean(summary);
  const hasVisibleSummary = Boolean(summary) && !summaryShownInStatusLine;

  if (!hasVisibleSummary && (!events || events.length === 0)) {
    return null;
  }

  return (
    <Box sx={{ mb: 1 }}>
      {summary && !summaryShownInStatusLine ? (
        <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.45 }}>
          {summary}
        </Typography>
      ) : null}
      {events && events.length > 0 ? (
        <>
          <Button
            size="small"
            onClick={() => setOpen((o) => !o)}
            endIcon={
              <ExpandMoreIcon
                fontSize="small"
                sx={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}
              />
            }
            sx={{ mt: 0.5, px: 0, minWidth: 0, textTransform: 'none' }}
          >
            View activity
          </Button>
          <Collapse in={open}>
            <List dense disablePadding sx={{ mt: 0.5 }}>
              {events.map((ev, i) => (
                <ListItem key={i} disableGutters sx={{ py: 0.2, alignItems: 'flex-start' }}>
                  <ListItemText
                    primary={ev.message}
                    secondary={
                      ev.timestamp
                        ? `${ev.timestamp.toLocaleString()}${
                            narrativeActorLabelForUi(ev.type, 'admin')
                              ? ` · ${narrativeActorLabelForUi(ev.type, 'admin')}`
                              : ''
                          }`
                        : narrativeActorLabelForUi(ev.type, 'admin')
                    }
                    primaryTypographyProps={{ variant: 'caption', color: 'text.primary', sx: { whiteSpace: 'pre-wrap' } }}
                    secondaryTypographyProps={{ variant: 'caption', color: 'text.secondary' }}
                  />
                </ListItem>
              ))}
            </List>
          </Collapse>
        </>
      ) : null}
    </Box>
  );
}

function primaryStatusChipLabel(row: EmploymentOnboardingRow): string {
  if (row.status === 'completed') {
    return 'Completed (this flow)';
  }
  if (row.status === 'satisfied_by_existing_record') {
    return 'Satisfied by existing record';
  }
  return row.statusLabel || UI_STATUS_LABEL[row.status];
}

function StepRow({
  row,
  entityKey,
  actionContext,
  onActionComplete,
  debugMode,
  relationshipPathHistorical,
  workerOnboarding,
}: {
  row: EmploymentOnboardingRow;
  entityKey: EmploymentEntityKey;
  actionContext: EmploymentV2ActionResolutionContext | null;
  onActionComplete?: () => void;
  debugMode: boolean;
  /** When true, rows stay visible but CTAs and emphasis read as prior onboarding, not current work. */
  relationshipPathHistorical: boolean;
  workerOnboarding?: WorkerOnboardingPipeline | null;
}) {
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
      <Typography variant="body2" fontWeight={700} sx={{ mb: 0.25 }}>
        {row.label}
      </Typography>
      <NarrativeBlock row={row} />

      {debugMode ? (
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
          <Chip size="small" variant="outlined" label={AUDIENCE_LABEL[row.audience]} />
          <Chip size="small" variant="outlined" label={ACTIONABLE_LABEL[row.actionableBy]} />
          <Chip size="small" variant="outlined" label={row.required ? 'Required' : 'Optional'} />
          <Chip size="small" variant="outlined" label={row.blocking ? 'Blocking' : 'Non-blocking'} />
          <Chip size="small" variant="outlined" color="default" label={`Signal: ${ROW_SIGNAL_LABEL[row.sourceType]}`} />
        </Stack>
      ) : (
        <Stack spacing={0.5} sx={{ mb: 1 }}>
          <Typography
            variant="body2"
            fontWeight={600}
            color={
              relationshipPathHistorical && !isCompletedFlow && !isSatisfiedReuse && row.status !== 'error'
                ? 'text.secondary'
                : row.status === 'error'
                  ? 'error'
                  : isCompletedFlow
                    ? 'success.main'
                    : isSatisfiedReuse
                      ? 'info.main'
                      : 'text.primary'
            }
          >
            {relationshipPathHistorical && !isCompletedFlow && !isSatisfiedReuse
              ? `Prior activity: ${plainLanguageStatusLabel(row)}`
              : plainLanguageStatusLabel(row)}
          </Typography>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ lineHeight: 1.45 }}>
            <Box component="span" sx={{ fontWeight: 600, color: 'text.primary' }}>
              Who is handling this:{' '}
            </Box>
            {HANDLING_LABEL[row.owner]}
          </Typography>
        </Stack>
      )}

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

      {debugMode && row.helperText && (
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

      {actionContext && (
        <EmploymentOnboardingPathRowAction
          row={row}
          entityKey={entityKey}
          ctx={actionContext}
          onComplete={onActionComplete}
          primaryCta={!debugMode && !relationshipPathHistorical}
        />
      )}
      {actionContext && row.sourceType === 'external_onboarding' && row.sourceRef?.externalStepKey ? (
        <ExternalOnboardingVerificationControls
          ctx={actionContext}
          entityKey={entityKey}
          stepKey={row.sourceRef.externalStepKey}
          workerOnboarding={workerOnboarding}
          onComplete={onActionComplete}
          suppress={relationshipPathHistorical}
        />
      ) : null}
    </Box>
  );
}

function GroupSection({
  group,
  entityKey,
  actionContext,
  onActionComplete,
  debugMode,
  suppressCurrentDemandBlockers,
  workerOnboarding,
}: {
  group: OnboardingPathGroup;
  entityKey: EmploymentEntityKey;
  actionContext: EmploymentV2ActionResolutionContext | null;
  onActionComplete?: () => void;
  debugMode: boolean;
  suppressCurrentDemandBlockers: boolean;
  workerOnboarding?: WorkerOnboardingPipeline | null;
}) {
  const frac = group.totalCount > 0 ? `${group.doneCount} / ${group.totalCount}` : '—';
  const reuseDone = group.rows.filter((r) => r.status === 'satisfied_by_existing_record').length;
  const flowDone = group.rows.filter((r) => r.status === 'completed').length;
  const historical = suppressCurrentDemandBlockers;

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
                {historical ? 'Recorded progress: ' : ''}
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
          <Chip size="small" variant="outlined" label={historical ? `Prior: ${frac} steps` : `${frac} complete`} />
          {!suppressCurrentDemandBlockers && group.blockerCount > 0 && (
            <Chip size="small" color="error" label={`${group.blockerCount} blocker${group.blockerCount === 1 ? '' : 's'}`} />
          )}
        </Stack>
      </Stack>
      <Stack spacing={1.25}>
        {group.rows.map((r) => (
          <StepRow
            key={r.rowId}
            row={r}
            entityKey={entityKey}
            actionContext={actionContext}
            onActionComplete={onActionComplete}
            debugMode={debugMode}
            relationshipPathHistorical={historical}
            workerOnboarding={workerOnboarding}
          />
        ))}
      </Stack>
    </Box>
  );
}

export interface EmploymentOnboardingPathCardProps {
  groups: OnboardingPathGroup[];
  entityKey: EmploymentEntityKey;
  actionContext: EmploymentV2ActionResolutionContext | null;
  onActionComplete?: () => void;
  /**
   * Show Owner / Visible / Act / Signal chips and “Why this status”. Default false.
   * Set true or use env `REACT_APP_EMPLOYMENT_ONBOARDING_PATH_DEBUG=true` (unless this prop is `false`).
   */
  debugMode?: boolean;
  /**
   * When true, hide red group blocker chips — path rows remain for history/audit without implying current action demand.
   */
  suppressCurrentDemandBlockers?: boolean;
  /** Pipeline doc for external step verification (admin). */
  workerOnboarding?: WorkerOnboardingPipeline | null;
}

const EmploymentOnboardingPathCard: React.FC<EmploymentOnboardingPathCardProps> = ({
  groups,
  entityKey,
  actionContext,
  onActionComplete,
  debugMode: debugModeProp,
  suppressCurrentDemandBlockers = false,
  workerOnboarding,
}) => {
  const debugMode = resolveEmploymentOnboardingPathDebugMode(debugModeProp);

  React.useEffect(() => {
    if (!actionContext || suppressCurrentDemandBlockers) return;
    const rows = groups.flatMap((g) => g.rows);
    warnBlockingPathRowsMissingDedicatedActions(rows, actionContext, `entity:${entityKey}`);
  }, [actionContext, groups, entityKey, suppressCurrentDemandBlockers]);

  return (
    <Card sx={{ mb: 2 }}>
      <CardHeader
        title={
          <Typography variant="h6" fontWeight={700}>
            Employment relationship path
            {suppressCurrentDemandBlockers ? (
              <Typography component="span" variant="body2" color="text.secondary" fontWeight={500} display="block" sx={{ mt: 0.5 }}>
                Record of prior relationship onboarding — not current required work
              </Typography>
            ) : null}
          </Typography>
        }
        subheader="Work authorization, forms & policies, payroll, and internal readiness — not job package or screening orders."
        titleTypographyProps={{ component: 'div' }}
        subheaderTypographyProps={{ variant: 'body2', color: 'text.secondary' }}
      />
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
                <GroupSection
                  group={g}
                  entityKey={entityKey}
                  actionContext={actionContext}
                  onActionComplete={onActionComplete}
                  debugMode={debugMode}
                  suppressCurrentDemandBlockers={suppressCurrentDemandBlockers}
                  workerOnboarding={workerOnboarding}
                />
              </React.Fragment>
            ))}
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default EmploymentOnboardingPathCard;
