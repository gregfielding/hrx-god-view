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
import { recruiterExternalStepChip } from '../../../../utils/employmentOnboardingPathRecruiterView';
import {
  consolidateRecruiterOnboardingPathGroups,
  type RecruiterConsolidatedPathGroup,
  type RecruiterConsolidatedPathItem,
} from '../../../../utils/employmentOnboardingPathRecruiterConsolidation';
import {
  employmentOnboardingEverifyRowElementId,
  isEverifyOnboardingPathScrollRow,
  isOnboardingPathRowBlocker,
  isOnboardingPathRowDone,
  RECRUITER_PAYROLL_ROW_HINT,
} from '../../../../utils/employmentOnboardingPath';
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
  satisfied_by_existing_record: 'Already on file',
  not_required: 'Doesn’t apply',
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

/** Recruiter profile: one owner label per row (no combined contributors). */
function recruiterLeadOwnerLabel(row: EmploymentOnboardingRow, internalTaskRow: EmploymentOnboardingRow | undefined): string {
  if (internalTaskRow || row.actionableBy === 'recruiter') return 'You';
  if (row.actionableBy === 'worker') return 'Worker';
  if (row.actionableBy === 'either') {
    return row.owner === 'recruiter' ? 'You' : 'Worker';
  }
  if (row.owner === 'vendor') return 'Vendor';
  if (row.owner === 'system') return 'System';
  if (row.owner === 'recruiter') return 'You';
  return 'Worker';
}

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
  external_onboarding: 'Payroll milestones',
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

/** Collapse near-duplicate activity lines (same event, different punctuation). */
function activityFingerprint(s: string): string {
  const n = normalizeWs(s).toLowerCase();
  return n
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\d{1,2}\/\d{1,2}\/\d{2,4}[^a-z0-9:]*/gi, 'DATE ')
    .replace(/\s+/g, ' ')
    .trim();
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
  const seenEvent = new Set<string>();
  for (const row of rows) {
    const s = row.narrative?.summary?.trim();
    if (s) {
      const fp = activityFingerprint(s);
      if (!seenSummary.has(fp)) {
        seenSummary.add(fp);
        summaries.push(s);
      }
    }
    row.narrative?.events?.forEach((ev) => {
      const msg = String(ev.message || '').trim();
      if (!msg) return;
      const ts = ev.timestamp?.getTime() ?? 0;
      const k = `${Math.floor(ts / 60000)}|${activityFingerprint(msg)}`;
      if (seenEvent.has(k)) return;
      seenEvent.add(k);
      events.push(ev);
    });
  }
  events.sort((a, b) => (a.timestamp?.getTime() || 0) - (b.timestamp?.getTime() || 0));
  return { summaries, events };
}

/** Collapsed “View activity” only — keeps the default row surface minimal. */
function ActivityCollapse({ rows, compact = false }: { rows: EmploymentOnboardingRow[]; compact?: boolean }) {
  const [open, setOpen] = React.useState(false);
  const { summaries, events } = React.useMemo(() => collectActivityFromRows(rows), [rows]);
  if (summaries.length === 0 && events.length === 0) return null;

  return (
    <Box sx={{ mt: compact ? 0.25 : 0.5 }}>
      <Button
        size="small"
        onClick={() => setOpen((o) => !o)}
        endIcon={
          <ExpandMoreIcon
            fontSize="inherit"
            sx={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}
          />
        }
        sx={{
          px: 0,
          minWidth: 0,
          textTransform: 'none',
          fontSize: compact ? '0.7rem' : undefined,
          minHeight: compact ? 28 : undefined,
        }}
      >
        Activity
      </Button>
      <Collapse in={open}>
        <Box sx={{ mt: compact ? 0.5 : 0.75 }}>
          {summaries.map((s, i) => (
            <Typography
              key={i}
              variant="caption"
              color="text.secondary"
              display="block"
              sx={{ mb: compact ? 0.35 : 0.75, lineHeight: 1.4, fontSize: compact ? '0.7rem' : undefined }}
            >
              {s}
            </Typography>
          ))}
          {events.length > 0 ? (
            <List dense disablePadding>
              {events.map((ev, i) => (
                <ListItem key={i} disableGutters sx={{ py: compact ? 0.1 : 0.2, alignItems: 'flex-start' }}>
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
                    primaryTypographyProps={{
                      variant: 'caption',
                      color: 'text.primary',
                      sx: { whiteSpace: 'pre-wrap', fontSize: compact ? '0.7rem' : undefined },
                    }}
                    secondaryTypographyProps={{
                      variant: 'caption',
                      color: 'text.secondary',
                      sx: { fontSize: compact ? '0.65rem' : undefined },
                    }}
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

function humanizeRecruiterStatusLabel(label: string): string {
  const t = label.trim();
  if (/pending\s*admin\s*verification/i.test(t)) return 'Needs review';
  if (/waiting\s*on\s*admin/i.test(t)) return 'Needs review';
  if (/pending\s*verification/i.test(t) && !/worker/i.test(t)) return 'Needs review';
  if (/verification\s*pending/i.test(t)) return 'Needs review';
  if (/internal\s*verification/i.test(t)) return 'Your tasks';
  return label;
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
    return { label: humanizeRecruiterStatusLabel(label), color: TONE_CHIP_COLOR[tone] };
  }
  if (row.status === 'error') return { label: 'Needs attention', color: 'error' };
  if (row.status === 'satisfied_by_existing_record') return { label: 'Already on file', color: 'info' };
  if (row.status === 'completed') return { label: 'Done', color: 'success' };
  if (row.status === 'in_progress') {
    return { label: humanizeRecruiterStatusLabel(row.statusLabel || 'In progress'), color: 'info' };
  }
  if (row.status === 'not_required') return { label: 'Doesn’t apply', color: 'default' };
  return { label: humanizeRecruiterStatusLabel(row.statusLabel || 'Not started'), color: 'default' };
}

function payrollRowHintText(row: EmploymentOnboardingRow): string | null {
  const h = row.helperText?.trim();
  if (h && (h.includes('payroll system') || h.includes(RECRUITER_PAYROLL_ROW_HINT.slice(0, 28)))) {
    return h;
  }
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
  internalTaskRow,
  flattenChrome,
  isLastInGroup,
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
  /** Consolidated internal pipeline_task (recruiter checkbox) merged into this requirement row. */
  internalTaskRow?: EmploymentOnboardingRow;
  /** List-style rows (no nested “cards”) when checklist sits inside accordion / drill-down. */
  flattenChrome?: boolean;
  isLastInGroup?: boolean;
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

  const twLine = payrollRowHintText(row);
  const internalExplain =
    mergedSources.find((r) => r.groupId === 'internal_readiness' && r.helperText?.trim())?.helperText?.trim() || null;
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

  const dominantOwner = React.useMemo((): EmploymentOnboardingRow['owner'] => {
    if (mergedSources.some((r) => r.owner === 'recruiter')) return 'recruiter';
    if (mergedSources.some((r) => r.owner === 'vendor')) return 'vendor';
    if (mergedSources.some((r) => r.owner === 'system')) return 'system';
    return row.owner;
  }, [mergedSources, row.owner]);

  const internalTaskSurface =
    Boolean(internalTaskRow) && !(showExternalVerificationControls && Boolean(internalTaskRow));

  const recruiterLeanIn =
    !verifiedQuiet &&
    (internalTaskSurface ||
      mergedSources.some(
        (r) => r.owner === 'recruiter' || r.actionableBy === 'recruiter' || r.actionableBy === 'either'
      ));

  const workerVendorMuted =
    !verifiedQuiet &&
    !recruiterLeanIn &&
    (dominantOwner === 'worker' || dominantOwner === 'vendor' || dominantOwner === 'system');

  const rowSurface = debugMode
    ? theme.palette.action.hover
    : verifiedQuiet
      ? alpha(theme.palette.divider, 0.15)
      : recruiterLeanIn
        ? alpha(theme.palette.primary.main, 0.09)
        : vendorOnlyQuiet
          ? alpha(theme.palette.action.hover, 0.45)
          : theme.palette.action.hover;

  /** Flat list: no tinted “cards”; subtle striping only when attention needed. */
  const rowSurfaceDisplay =
    flattenChrome && relationshipPathHistorical
      ? 'transparent'
      : flattenChrome
        ? verifiedQuiet
          ? 'transparent'
          : recruiterLeanIn
            ? alpha(theme.palette.primary.main, 0.05)
            : alpha(theme.palette.divider, 0.06)
        : rowSurface;

  const rowAccent =
    recruiterLeanIn && !verifiedQuiet
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
    flattenChrome && relationshipPathHistorical ? 1 : verifiedQuiet && !debugMode ? 0.88 : workerVendorMuted && !debugMode ? 0.93 : 1;

  const workerAssignmentCta =
    row.groupId === 'assignment_requirements' &&
    (row.actionableBy === 'worker' || row.actionableBy === 'either') &&
    !isOnboardingPathRowDone(row.status);

  const everifyScrollAnchorId = isEverifyOnboardingPathScrollRow(row, entityKey)
    ? employmentOnboardingEverifyRowElementId(entityKey)
    : undefined;

  /** Completed / reuse rows: one shallow line; detail in tooltip + Activity. */
  const compactDone =
    !debugMode && !policyOptionalDismiss && (isCompletedFlow || isSatisfiedReuse);
  const showOneLineHelperBelow = Boolean(oneLineHelper && !(flattenChrome && relationshipPathHistorical));
  const detailTooltip = [rowInfoTooltip, oneLineHelper].filter(Boolean).join('\n\n') || '';
  const historicalFlatTooltip =
    flattenChrome && relationshipPathHistorical
      ? [rowInfoTooltip, oneLineHelper].filter(Boolean).join('\n\n') || ''
      : '';

  return (
    <Box
      id={everifyScrollAnchorId}
      sx={{
        py: flattenChrome
          ? compactDone
            ? 0.3
            : relationshipPathHistorical
              ? 0.5
              : 0.65
          : compactDone
            ? 0.35
            : verifiedQuiet
              ? 0.75
              : 1.15,
        px: flattenChrome ? (compactDone ? 0.5 : 1) : compactDone ? 0.75 : 1.25,
        borderRadius: flattenChrome ? 0 : 1,
        bgcolor: flattenChrome ? rowSurfaceDisplay : rowSurface,
        borderLeft:
          flattenChrome && relationshipPathHistorical
            ? 0
            : rowAccent !== 'transparent'
              ? compactDone
                ? 2
                : 3
              : 0,
        borderLeftColor: rowAccent,
        borderLeftStyle: 'solid',
        borderBottom:
          flattenChrome && !isLastInGroup ? `1px solid ${theme.palette.divider}` : undefined,
        opacity: rowOpacity,
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        gap={1}
        sx={{ mb: compactDone ? 0 : 0.75 }}
      >
        <Stack direction="row" alignItems="center" gap={0.5} sx={{ flex: 1, minWidth: 0 }}>
          {compactDone ? (
            detailTooltip ? (
              <Tooltip title={detailTooltip} placement="top" enterDelay={400}>
                <Typography
                  variant="body2"
                  fontWeight={500}
                  color="text.secondary"
                  sx={{ lineHeight: 1.25 }}
                >
                  {row.label}
                </Typography>
              </Tooltip>
            ) : (
              <Typography
                variant="body2"
                fontWeight={500}
                color="text.secondary"
                sx={{ lineHeight: 1.25 }}
              >
                {row.label}
              </Typography>
            )
          ) : flattenChrome && relationshipPathHistorical && historicalFlatTooltip ? (
            <Tooltip title={historicalFlatTooltip} placement="top" enterDelay={400}>
              <Typography
                variant="body2"
                fontWeight={verifiedQuiet ? 500 : workerVendorMuted ? 600 : 700}
                color={verifiedQuiet || workerVendorMuted ? 'text.secondary' : 'text.primary'}
                sx={{ lineHeight: 1.3 }}
              >
                {row.label}
              </Typography>
            </Tooltip>
          ) : (
            <>
              <Typography
                variant="body2"
                fontWeight={verifiedQuiet ? 500 : workerVendorMuted ? 600 : 700}
                color={verifiedQuiet || workerVendorMuted ? 'text.secondary' : 'text.primary'}
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
            </>
          )}
        </Stack>
        <Stack direction="row" alignItems="center" flexWrap="wrap" gap={0.5} useFlexGap sx={{ flexShrink: 0 }}>
          {!compactDone && !debugMode && actionContext?.viewer === 'recruiter' ? (
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, mr: 0.25 }}>
              {recruiterLeadOwnerLabel(row, internalTaskRow)}
            </Typography>
          ) : !compactDone && !debugMode ? (
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, mr: 0.25 }}>
              {OWNER_LABEL[row.owner]}
            </Typography>
          ) : null}
          <Chip
            size="small"
            label={relationshipPathHistorical && !isCompletedFlow && !isSatisfiedReuse ? `Prior: ${chip.label}` : chip.label}
            color={chip.color}
            variant={verifiedQuiet || compactDone ? 'outlined' : 'filled'}
            sx={{
              flexShrink: 0,
              fontWeight: verifiedQuiet || compactDone ? 500 : 600,
              height: compactDone ? 22 : undefined,
              '& .MuiChip-label': compactDone ? { px: 0.65, fontSize: '0.7rem' } : undefined,
            }}
          />
        </Stack>
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

      {!compactDone && showOneLineHelperBelow ? (
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5, lineHeight: 1.4 }}>
          {oneLineHelper}
        </Typography>
      ) : null}

      <ActivityCollapse rows={mergedSources} compact={compactDone} />

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
          primaryCta={
            !debugMode &&
            !relationshipPathHistorical &&
            (recruiterActionable || workerAssignmentCta)
          }
        />
      )}
      {actionContext ? (
        <InternalPipelineTaskVerification
          row={row}
          taskRow={internalTaskRow}
          ctx={actionContext}
          onComplete={onActionComplete}
          suppress={
            (compactDone && verifiedQuiet) ||
            relationshipPathHistorical ||
            /* Payroll verification is the single source of truth for these milestones; pipeline task is legacy overlap. */
            (showExternalVerificationControls && Boolean(internalTaskRow))
          }
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
  consolidated,
  entityKey,
  actionContext,
  onActionComplete,
  debugMode,
  suppressCurrentDemandBlockers,
  workerOnboarding,
  dismissedOptionalPolicyRowIds = new Set<string>(),
  onDismissOptionalPolicyRow = () => {},
  flattenChrome,
}: {
  consolidated: RecruiterConsolidatedPathGroup;
  entityKey: EmploymentEntityKey;
  actionContext: EmploymentV2ActionResolutionContext | null;
  onActionComplete?: () => void;
  debugMode: boolean;
  suppressCurrentDemandBlockers: boolean;
  workerOnboarding?: WorkerOnboardingPipeline | null;
  dismissedOptionalPolicyRowIds?: ReadonlySet<string>;
  onDismissOptionalPolicyRow?: (rowId: string) => void;
  flattenChrome?: boolean;
}) {
  const visibleItems = React.useMemo(
    () => consolidated.items.filter((it) => !dismissedOptionalPolicyRowIds.has(it.row.rowId)),
    [consolidated.items, dismissedOptionalPolicyRowIds]
  );

  const doneCount = visibleItems.filter((it) => isOnboardingPathRowDone(it.row.status)).length;
  const totalCount = visibleItems.length;
  const blockerCount = visibleItems.filter((it) => isOnboardingPathRowBlocker(it.row)).length;
  const reuseDone = visibleItems.filter((it) => it.row.status === 'satisfied_by_existing_record').length;
  const flowDone = visibleItems.filter((it) => it.row.status === 'completed').length;
  const historical = suppressCurrentDemandBlockers;

  const frac = totalCount > 0 ? `${doneCount} / ${totalCount}` : '—';

  const renderItem = (it: RecruiterConsolidatedPathItem, idx: number) => (
    <StepRow
      key={it.mergedSources
        .map((r) => r.rowId)
        .sort()
        .join('|')}
      row={it.row}
      entityKey={entityKey}
      actionContext={actionContext}
      onActionComplete={onActionComplete}
      debugMode={debugMode}
      relationshipPathHistorical={historical}
      workerOnboarding={workerOnboarding}
      mergedSources={it.mergedSources}
      onDismissOptionalPolicyRow={onDismissOptionalPolicyRow}
      internalTaskRow={it.internalTaskRow}
      flattenChrome={flattenChrome}
      isLastInGroup={idx === visibleItems.length - 1}
    />
  );

  return (
    <Box sx={{ mb: flattenChrome ? 0 : 1.5 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1} sx={{ mb: 0.75 }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle2" fontWeight={700} sx={{ lineHeight: 1.3 }}>
            {consolidated.title}
          </Typography>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.15, lineHeight: 1.35 }}>
            {totalCount > 0 ? (
              <>
                {historical ? 'Recorded: ' : ''}
                {frac} complete
                {reuseDone > 0 ? ` · ${reuseDone} prior` : ''}
                {flowDone > 0 && reuseDone === 0 ? ` · ${flowDone} in flow` : null}
              </>
            ) : null}
          </Typography>
        </Box>
        {!suppressCurrentDemandBlockers && blockerCount > 0 ? (
          <Chip
            size="small"
            color="warning"
            variant="outlined"
            label={`${blockerCount} open`}
            sx={{ flexShrink: 0, height: 24, '& .MuiChip-label': { px: 0.75 } }}
          />
        ) : totalCount > 0 ? (
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
            {frac}
          </Typography>
        ) : null}
      </Stack>

      <Stack spacing={flattenChrome ? 0 : 0.65}>{visibleItems.map((it, idx) => renderItem(it, idx))}</Stack>
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
  /** Worker onboarding pipeline (payroll milestone + task state for this tab). */
  workerOnboarding?: WorkerOnboardingPipeline | null;
  /**
   * Softer card chrome + title scale so this reads as drill-down under on-file summary / header,
   * not a competing top-level status surface.
   */
  drillDownVisual?: boolean;
}

const EmploymentOnboardingPathCard: React.FC<EmploymentOnboardingPathCardProps> = ({
  groups,
  entityKey,
  actionContext,
  onActionComplete,
  debugMode: debugModeProp,
  suppressCurrentDemandBlockers = false,
  workerOnboarding,
  drillDownVisual = false,
}) => {
  const debugMode = resolveEmploymentOnboardingPathDebugMode(debugModeProp);
  const consolidatedGroups = React.useMemo(() => consolidateRecruiterOnboardingPathGroups(groups), [groups]);
  const [dismissedOptionalPolicyRowIds, setDismissedOptionalPolicyRowIds] = React.useState<Set<string>>(
    () => new Set()
  );
  const dismissOptionalPolicyRow = React.useCallback((rowId: string) => {
    setDismissedOptionalPolicyRowIds((prev) => new Set([...prev, rowId]));
  }, []);

  React.useEffect(() => {
    if (!actionContext || suppressCurrentDemandBlockers) return;
    const rows = consolidatedGroups.flatMap((cg) => cg.items.map((it) => it.row));
    warnBlockingPathRowsMissingDedicatedActions(rows, actionContext, `entity:${entityKey}`);
  }, [actionContext, consolidatedGroups, entityKey, suppressCurrentDemandBlockers]);

  const pathBody =
    consolidatedGroups.length === 0 ? (
      <Typography variant="body2" color="text.secondary">
        No onboarding steps are configured for this entity in Settings, or nothing applies yet. Enable workflow steps
        on the entity to see the path here.
      </Typography>
    ) : (
      <>
        {consolidatedGroups.map((g, i) => (
          <React.Fragment key={g.groupId}>
            {i > 0 && <Divider sx={{ my: drillDownVisual ? 1.25 : 2 }} />}
            <GroupSection
              consolidated={g}
              entityKey={entityKey}
              actionContext={actionContext}
              onActionComplete={onActionComplete}
              debugMode={debugMode}
              suppressCurrentDemandBlockers={suppressCurrentDemandBlockers}
              workerOnboarding={workerOnboarding}
              dismissedOptionalPolicyRowIds={dismissedOptionalPolicyRowIds}
              onDismissOptionalPolicyRow={dismissOptionalPolicyRow}
              flattenChrome={drillDownVisual}
            />
          </React.Fragment>
        ))}
      </>
    );

  if (drillDownVisual) {
    return (
      <Box sx={{ px: { xs: 1.5, sm: 2 }, pt: 0.5 }}>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.25, lineHeight: 1.45 }}>
          {suppressCurrentDemandBlockers
            ? 'Prior steps only — not current required work. Job package items stay under Job requirements.'
            : 'Row-level checklist. Job package items stay under Job requirements.'}
        </Typography>
        {pathBody}
      </Box>
    );
  }

  return (
    <Card variant="elevation" sx={{ mb: 2 }}>
      <CardHeader
        title={
          <Typography variant="h6" fontWeight={700}>
            Step-by-step checklist
            {suppressCurrentDemandBlockers ? (
              <Typography
                component="span"
                variant="body2"
                color="text.secondary"
                fontWeight={500}
                display="block"
                sx={{ mt: 0.5 }}
              >
                Record of prior work — not current required steps
              </Typography>
            ) : null}
          </Typography>
        }
        subheader="One row per requirement. Assignment package items are under Job requirements."
        titleTypographyProps={{ component: 'div' }}
        subheaderTypographyProps={{ variant: 'body2', color: 'text.secondary' }}
      />
      <CardContent sx={{ pt: 0 }}>{pathBody}</CardContent>
    </Card>
  );
};

export default EmploymentOnboardingPathCard;
