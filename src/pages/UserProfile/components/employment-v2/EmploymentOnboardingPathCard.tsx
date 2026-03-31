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
  Tooltip,
  IconButton,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { alpha, useTheme } from '@mui/material/styles';
import type {
  EmploymentEntityKey,
  EmploymentOnboardingArtifactScope,
  EmploymentOnboardingNarrativeEvent,
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
import {
  isExternalOnboardingStepVerificationUiKey,
  parseExternalOnboardingSteps,
} from '../../../../utils/externalOnboardingSteps';
import {
  mergeOnboardingPathRowsByExternalStepKey,
  recruiterExternalStepChip,
  TEMPWORKS_WIRING_HINT,
  type MergedPathRow,
} from '../../../../utils/employmentOnboardingPathRecruiterView';
import { isOnboardingPathRowBlocker, isOnboardingPathRowDone } from '../../../../utils/employmentOnboardingPath';
import { EmploymentOnboardingPathRowAction } from './EmploymentOnboardingPathRowAction';
import ExternalOnboardingVerificationControls from './ExternalOnboardingVerificationControls';
import InternalPipelineTaskVerification from './InternalPipelineTaskVerification';

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

function normalizeWs(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

const TONE_CHIP_COLOR: Record<
  'default' | 'info' | 'warning' | 'success' | 'error',
  'default' | 'warning' | 'success' | 'error' | 'info'
> = {
  default: 'default',
  info: 'info',
  warning: 'warning',
  success: 'success',
  error: 'error',
};

function collectActivityFromRows(rows: EmploymentOnboardingRow[]): {
  summaries: string[];
  events: EmploymentOnboardingNarrativeEvent[];
} {
  const summaries: string[] = [];
  const events: EmploymentOnboardingNarrativeEvent[] = [];
  const seenSummary = new Set<string>();
  for (const row of rows) {
    const s = row.narrative?.summary?.trim();
    if (s && !seenSummary.has(normalizeWs(s))) {
      seenSummary.add(normalizeWs(s));
      summaries.push(s);
    }
    row.narrative?.events?.forEach((ev) => {
      if (String(ev.message || '').trim()) events.push(ev);
    });
  }
  events.sort((a, b) => (a.timestamp?.getTime() || 0) - (b.timestamp?.getTime() || 0));
  return { summaries, events };
}

/** Collapsed “View activity” only — keeps the default row surface minimal. */
function ActivityCollapse({ rows }: { rows: EmploymentOnboardingRow[] }) {
  const [open, setOpen] = React.useState(false);
  const { summaries, events } = React.useMemo(() => collectActivityFromRows(rows), [rows]);
  if (summaries.length === 0 && events.length === 0) return null;

  return (
    <Box sx={{ mt: 0.5 }}>
      <Button
        size="small"
        onClick={() => setOpen((o) => !o)}
        endIcon={
          <ExpandMoreIcon
            fontSize="small"
            sx={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}
          />
        }
        sx={{ px: 0, minWidth: 0, textTransform: 'none' }}
      >
        View activity
      </Button>
      <Collapse in={open}>
        <Box sx={{ mt: 0.75 }}>
          {summaries.map((s, i) => (
            <Typography key={i} variant="caption" color="text.secondary" display="block" sx={{ mb: 0.75, lineHeight: 1.45 }}>
              {s}
            </Typography>
          ))}
          {events.length > 0 ? (
            <List dense disablePadding>
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
          ) : null}
        </Box>
      </Collapse>
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

function recruiterFacingChip(
  row: EmploymentOnboardingRow,
  workerOnboarding: WorkerOnboardingPipeline | null | undefined,
  debugMode: boolean
): { label: string; color: 'default' | 'warning' | 'success' | 'error' | 'info' } {
  if (debugMode) {
    return { label: primaryStatusChipLabel(row), color: STATUS_CHIP_COLOR[row.status] };
  }
  const extKey = row.sourceRef?.externalStepKey;
  if (extKey) {
    const map = parseExternalOnboardingSteps(workerOnboarding?.externalOnboardingSteps);
    const rec = map?.[extKey];
    const { label, tone } = recruiterExternalStepChip(rec);
    return { label, color: TONE_CHIP_COLOR[tone] };
  }
  if (row.status === 'error') return { label: 'Needs attention', color: 'error' };
  if (row.status === 'satisfied_by_existing_record') return { label: 'Satisfied (prior record)', color: 'info' };
  if (row.status === 'completed') return { label: 'Verified', color: 'success' };
  if (row.status === 'in_progress') return { label: row.statusLabel || 'In progress', color: 'info' };
  if (row.status === 'not_required') return { label: 'Not required', color: 'default' };
  return { label: row.statusLabel || 'Not started', color: 'default' };
}

/** Presentation only — groups path rows for recruiter vs waiting buckets (no logic change). */
function isRecruiterOwnedPathRow(row: EmploymentOnboardingRow): boolean {
  return row.owner === 'recruiter' || row.actionableBy === 'recruiter' || row.actionableBy === 'either';
}

function tempWorksHintText(row: EmploymentOnboardingRow): string | null {
  const h = row.helperText?.trim();
  if (h && (h.includes('TempWorks') || h.includes(TEMPWORKS_WIRING_HINT.slice(0, 24)))) {
    return h;
  }
  if (row.statusLabel?.includes('TempWorks')) return row.statusLabel;
  return null;
}

function StepRow({
  row,
  entityKey,
  actionContext,
  onActionComplete,
  debugMode,
  relationshipPathHistorical,
  workerOnboarding,
  mergedSources,
  onDismissOptionalPolicyRow,
  deemphasize,
}: {
  row: EmploymentOnboardingRow;
  entityKey: EmploymentEntityKey;
  actionContext: EmploymentV2ActionResolutionContext | null;
  onActionComplete?: () => void;
  debugMode: boolean;
  relationshipPathHistorical: boolean;
  workerOnboarding?: WorkerOnboardingPipeline | null;
  mergedSources: EmploymentOnboardingRow[];
  onDismissOptionalPolicyRow?: (rowId: string) => void;
  /** Muted presentation for worker / vendor / system bucket (visual only). */
  deemphasize?: boolean;
}) {
  const theme = useTheme();
  const isCompletedFlow = row.status === 'completed';
  const isSatisfiedReuse = row.status === 'satisfied_by_existing_record';
  const showReuseCallout =
    isSatisfiedReuse || (row.satisfiedByArtifact === true && row.artifactSourceType != null);

  const chip = recruiterFacingChip(row, workerOnboarding, debugMode);
  const extBusinessKey = row.sourceRef?.externalStepKey;
  const policyOptionalDismiss =
    extBusinessKey === 'policies_acknowledgment' && row.required === false;
  const showExternalVerificationControls =
    Boolean(extBusinessKey && isExternalOnboardingStepVerificationUiKey(extBusinessKey)) &&
    !policyOptionalDismiss;

  const twLine = tempWorksHintText(row);
  const internalExplain =
    row.groupId === 'internal_readiness' && row.helperText?.trim() ? row.helperText.trim() : null;
  const longExplain =
    !internalExplain && row.helperText && row.helperText.trim().length >= 72 ? row.helperText.trim() : null;
  const rowInfoTooltip = [twLine, internalExplain || longExplain].filter(Boolean).join('\n\n') || null;

  const recruiterActionable =
    actionContext?.viewer === 'recruiter' &&
    (row.actionableBy === 'recruiter' || row.actionableBy === 'either') &&
    !relationshipPathHistorical &&
    !isOnboardingPathRowDone(row.status);

  const verifiedQuiet =
    (extBusinessKey &&
      (() => {
        const map = parseExternalOnboardingSteps(workerOnboarding?.externalOnboardingSteps);
        const rec = map?.[extBusinessKey];
        return rec && rec.status === 'completed' && String(rec.verifiedAt || '').length > 0;
      })()) ||
    isCompletedFlow ||
    isSatisfiedReuse;

  const vendorOnlyQuiet = row.owner === 'vendor' && !isOnboardingPathRowBlocker(row) && row.status !== 'error';

  const rowSurface = debugMode
    ? theme.palette.action.hover
    : verifiedQuiet
      ? alpha(theme.palette.divider, 0.2)
      : recruiterActionable
        ? alpha(theme.palette.primary.main, 0.06)
        : vendorOnlyQuiet
          ? alpha(theme.palette.action.hover, 0.5)
          : theme.palette.action.hover;

  const rowAccent =
    recruiterActionable && !verifiedQuiet
      ? theme.palette.primary.main
      : isSatisfiedReuse
        ? theme.palette.info.main
        : isCompletedFlow
          ? theme.palette.success.main
          : 'transparent';

  const oneLineHelper =
    !debugMode &&
    relationshipPathHistorical &&
    !isCompletedFlow &&
    !isSatisfiedReuse &&
    !recruiterActionable
      ? 'Historical — not current required work.'
      : showReuseCallout && !debugMode
        ? 'Met by an existing compliance record on file.'
        : null;

  const rowOpacity =
    deemphasize && !debugMode ? 0.86 : vendorOnlyQuiet ? 0.92 : 1;

  return (
    <Box
      sx={{
        py: verifiedQuiet ? 0.75 : 1.15,
        px: 1.25,
        borderRadius: 1,
        bgcolor: rowSurface,
        borderLeft: rowAccent !== 'transparent' ? 3 : 0,
        borderLeftColor: rowAccent,
        borderLeftStyle: 'solid',
        opacity: rowOpacity,
      }}
    >
      <Stack direction="row" alignItems="flex-start" justifyContent="space-between" gap={1} sx={{ mb: 0.75 }}>
        <Stack direction="row" alignItems="flex-start" gap={0.5} sx={{ flex: 1, minWidth: 0 }}>
          <Typography
            variant="body2"
            fontWeight={verifiedQuiet || deemphasize ? 600 : 700}
            color={verifiedQuiet || deemphasize ? 'text.secondary' : 'text.primary'}
            sx={{ lineHeight: 1.35 }}
          >
            {row.label}
          </Typography>
          {rowInfoTooltip && !debugMode ? (
            <Tooltip title={rowInfoTooltip} placement="right" enterTouchDelay={0}>
              <IconButton size="small" aria-label="Row details" sx={{ mt: -0.5, color: 'text.secondary' }}>
                <InfoOutlinedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          ) : null}
        </Stack>
        <Chip
          size="small"
          label={relationshipPathHistorical && !isCompletedFlow && !isSatisfiedReuse ? `Prior: ${chip.label}` : chip.label}
          color={chip.color}
          variant={verifiedQuiet || deemphasize ? 'outlined' : 'filled'}
          sx={{ flexShrink: 0, fontWeight: verifiedQuiet || deemphasize ? 500 : 600 }}
        />
      </Stack>

      {debugMode ? (
        <Stack direction="row" flexWrap="wrap" useFlexGap spacing={0.5} gap={0.5} sx={{ mb: 1 }}>
          <Chip size="small" variant="outlined" label={`Owner: ${OWNER_LABEL[row.owner]}`} />
          <Chip size="small" variant="outlined" label={AUDIENCE_LABEL[row.audience]} />
          <Chip size="small" variant="outlined" label={ACTIONABLE_LABEL[row.actionableBy]} />
          <Chip size="small" variant="outlined" label={row.required ? 'Required' : 'Optional'} />
          <Chip size="small" variant="outlined" label={row.blocking ? 'Blocking' : 'Non-blocking'} />
          <Chip size="small" variant="outlined" color="default" label={`Signal: ${ROW_SIGNAL_LABEL[row.sourceType]}`} />
        </Stack>
      ) : null}

      {debugMode && row.helperText ? (
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.75, lineHeight: 1.45 }}>
          <Box component="span" sx={{ fontWeight: 600, color: 'text.primary' }}>
            Why this status:{' '}
          </Box>
          {row.helperText}
        </Typography>
      ) : null}

      {oneLineHelper ? (
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5, lineHeight: 1.4 }}>
          {oneLineHelper}
        </Typography>
      ) : null}

      <ActivityCollapse rows={mergedSources} />

      {actionContext?.viewer === 'recruiter' &&
      policyOptionalDismiss &&
      onDismissOptionalPolicyRow &&
      !relationshipPathHistorical ? (
        <Box sx={{ mt: 1, pt: 1, borderTop: 1, borderColor: 'divider' }}>
          <Stack direction="row" alignItems="center" gap={0.5} flexWrap="wrap">
            <Button
              size="small"
              variant="outlined"
              onClick={() => onDismissOptionalPolicyRow(row.rowId)}
              sx={{ textTransform: 'none' }}
            >
              Dismiss
            </Button>
            <Tooltip title="Optional policy acknowledgment — dismiss to hide this row on the checklist until you refresh the page.">
              <IconButton size="small" aria-label="About dismiss" sx={{ color: 'text.secondary' }}>
                <InfoOutlinedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
        </Box>
      ) : null}

      {showReuseCallout && debugMode ? (
        <Box
          sx={{
            mt: 0.5,
            mb: 0.75,
            p: 1,
            borderRadius: 1,
            border: `1px solid ${alpha(theme.palette.info.main, 0.45)}`,
            bgcolor: alpha(theme.palette.info.main, 0.04),
          }}
        >
          <Chip size="small" label="Prior compliance record" color="info" variant="filled" sx={{ fontWeight: 700, mb: 0.5 }} />
          <Typography variant="caption" color="text.secondary" display="block">
            Artifact:{' '}
            {row.artifactSourceType != null ? ARTIFACT_TYPE_LABEL[row.artifactSourceType] : '—'} · Scope:{' '}
            {row.artifactScope != null ? SCOPE_LABEL[row.artifactScope as EmploymentOnboardingArtifactScope] : '—'}
          </Typography>
        </Box>
      ) : null}

      {actionContext && (
        <EmploymentOnboardingPathRowAction
          row={row}
          entityKey={entityKey}
          ctx={actionContext}
          onComplete={onActionComplete}
          primaryCta={!debugMode && !relationshipPathHistorical && recruiterActionable}
        />
      )}
      {actionContext ? (
        <InternalPipelineTaskVerification
          row={row}
          ctx={actionContext}
          onComplete={onActionComplete}
          suppress={relationshipPathHistorical}
        />
      ) : null}
      {actionContext && row.sourceRef?.externalStepKey && showExternalVerificationControls ? (
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
  dismissedOptionalPolicyRowIds = new Set<string>(),
  onDismissOptionalPolicyRow = () => {},
}: {
  group: OnboardingPathGroup;
  entityKey: EmploymentEntityKey;
  actionContext: EmploymentV2ActionResolutionContext | null;
  onActionComplete?: () => void;
  debugMode: boolean;
  suppressCurrentDemandBlockers: boolean;
  workerOnboarding?: WorkerOnboardingPipeline | null;
  /** Lifted from parent so optional-policy dismiss persists across groups; defaults are no-ops. */
  dismissedOptionalPolicyRowIds?: ReadonlySet<string>;
  onDismissOptionalPolicyRow?: (rowId: string) => void;
}) {
  const merged = React.useMemo(() => {
    const ext = mergeOnboardingPathRowsByExternalStepKey(group.rows);
    return ext.map((m) => ({
      row: m.row,
      mergedSources:
        m.row.requirementDetailRows && m.row.requirementDetailRows.length > 0
          ? m.row.requirementDetailRows
          : m.mergedSources,
    }));
  }, [group.rows]);

  const visibleMerged = React.useMemo(
    () => merged.filter((m) => !dismissedOptionalPolicyRowIds.has(m.row.rowId)),
    [merged, dismissedOptionalPolicyRowIds]
  );

  const doneCount = visibleMerged.filter((m) => isOnboardingPathRowDone(m.row.status)).length;
  const totalCount = visibleMerged.length;
  const blockerCount = visibleMerged.filter((m) => isOnboardingPathRowBlocker(m.row)).length;
  const reuseDone = visibleMerged.filter((m) => m.row.status === 'satisfied_by_existing_record').length;
  const flowDone = visibleMerged.filter((m) => m.row.status === 'completed').length;
  const historical = suppressCurrentDemandBlockers;

  const frac = totalCount > 0 ? `${doneCount} / ${totalCount}` : '—';
  const isInternal = group.groupId === 'internal_readiness';
  const internalOnlyTasks =
    isInternal && visibleMerged.length > 0 && visibleMerged.every((m) => m.row.sourceType === 'pipeline_task');
  const [internalOpen, setInternalOpen] = React.useState(true);

  const recruiterBucket = React.useMemo(
    () => visibleMerged.filter((m) => isRecruiterOwnedPathRow(m.row)),
    [visibleMerged]
  );
  const waitingBucket = React.useMemo(
    () => visibleMerged.filter((m) => !isRecruiterOwnedPathRow(m.row)),
    [visibleMerged]
  );

  const renderMergedRow = (m: MergedPathRow, deemphasize: boolean) => (
    <StepRow
      key={m.row.rowId}
      row={m.row}
      entityKey={entityKey}
      actionContext={actionContext}
      onActionComplete={onActionComplete}
      debugMode={debugMode}
      relationshipPathHistorical={historical}
      workerOnboarding={workerOnboarding}
      mergedSources={m.mergedSources}
      onDismissOptionalPolicyRow={onDismissOptionalPolicyRow}
      deemphasize={deemphasize}
    />
  );

  const renderPathRowBuckets = (spacing: number) => (
    <Stack spacing={spacing}>
      {recruiterBucket.length > 0 ? (
        <Box>
          <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.75 }}>
            Your verification tasks
          </Typography>
          <Stack spacing={spacing}>{recruiterBucket.map((m) => renderMergedRow(m, false))}</Stack>
        </Box>
      ) : null}
      {waitingBucket.length > 0 ? (
        <Box>
          <Typography variant="subtitle2" fontWeight={600} color="text.secondary" sx={{ mb: 0.75 }}>
            Waiting on worker or system
          </Typography>
          <Stack spacing={spacing}>{waitingBucket.map((m) => renderMergedRow(m, true))}</Stack>
        </Box>
      ) : null}
    </Stack>
  );

  return (
    <Box sx={{ mb: 2 }}>
      <Stack direction="row" alignItems="flex-start" justifyContent="space-between" flexWrap="wrap" gap={1} sx={{ mb: 1 }}>
        <Box>
          <Typography variant="subtitle1" fontWeight={700}>
            {group.title}
          </Typography>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.25 }}>
            {totalCount > 0 && !internalOnlyTasks && (
              <>
                {historical ? 'Recorded: ' : ''}
                {frac} complete
                {reuseDone > 0 ? ` · ${reuseDone} prior record` : ''}
                {flowDone > 0 && reuseDone === 0 ? ` · ${flowDone} finished in this flow` : null}
              </>
            )}
            {internalOnlyTasks && (
              <>
                {frac} verification items
                {!historical && blockerCount > 0
                  ? ` · ${blockerCount} open blocker${blockerCount === 1 ? '' : 's'}`
                  : ''}
              </>
            )}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          {!internalOnlyTasks ? (
            <Chip size="small" variant="outlined" label={historical ? `Prior: ${frac}` : `${frac} done`} />
          ) : null}
          {!suppressCurrentDemandBlockers && blockerCount > 0 && (
            <Chip size="small" color="error" label={`${blockerCount} blocker${blockerCount === 1 ? '' : 's'}`} />
          )}
        </Stack>
      </Stack>

      {internalOnlyTasks ? (
        <>
          <Button
            size="small"
            onClick={() => setInternalOpen((o) => !o)}
            endIcon={
              <ExpandMoreIcon
                fontSize="small"
                sx={{ transform: internalOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}
              />
            }
            sx={{ textTransform: 'none', px: 0, minWidth: 0, mb: 0.5 }}
          >
            {internalOpen ? 'Hide internal verification' : 'Show internal verification'}
          </Button>
          <Collapse in={internalOpen}>
            {renderPathRowBuckets(1)}
          </Collapse>
        </>
      ) : (
        renderPathRowBuckets(1.15)
      )}
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
  const [dismissedOptionalPolicyRowIds, setDismissedOptionalPolicyRowIds] = React.useState<Set<string>>(
    () => new Set()
  );
  const dismissOptionalPolicyRow = React.useCallback((rowId: string) => {
    setDismissedOptionalPolicyRowIds((prev) => new Set([...prev, rowId]));
  }, []);

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
        subheader="Work authorization, forms & policies, payroll, and internal verification — not job package or screening orders."
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
                  dismissedOptionalPolicyRowIds={dismissedOptionalPolicyRowIds}
                  onDismissOptionalPolicyRow={dismissOptionalPolicyRow}
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
