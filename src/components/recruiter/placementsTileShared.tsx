/**
 * Shared tile primitives used by `PlacementsTab.tsx` and (Phase 1b)
 * `ShiftAssignmentCard.tsx`. Extracted out of PlacementsTab so the
 * Assignments column can live in its own component without creating
 * a circular import back through PlacementsTab for `Worker`,
 * `placementActionChipSx`, `PlacementWorkerTileMainColumn`, etc.
 *
 * This module is intentionally side-effect-free — pure types,
 * constants, and presentational components. All Firestore I/O,
 * drag-state, and event handlers stay in PlacementsTab.tsx.
 */
import React from 'react';
import {
  Box,
  Chip,
  IconButton,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  Description as ResumeIcon,
  Info as BioIcon,
  Work as WorkHistoryIcon,
  Badge as LicenseIcon,
  School as ProfileCertsIcon,
  Fingerprint as FingerprintIcon,
  Science as ScienceIcon,
  History as HistoryIcon,
  OpenInNew as OpenInNewIcon,
  Build as SkillsIcon,
  Translate as LanguagesIcon,
  DirectionsCar as TransportCarIcon,
  DirectionsTransit as TransportTransitIcon,
  DirectionsBike as TransportBikeIcon,
  DirectionsWalk as TransportWalkIcon,
  MoreHoriz as TransportOtherIcon,
} from '@mui/icons-material';
import type { SvgIconComponent } from '@mui/icons-material';

import type { JobOrder } from '../../types/recruiter/jobOrder';
import type { UserInactiveAtAccountEntry } from '../../shared/accountWorkforce';
import {
  placementEmploymentChipFromEntityData,
  formatPlacementEmploymentChipWithEntityName,
  type PlacementEmploymentChipModel,
} from '../../utils/placementQualificationChipsModel';
import {
  placementJobOrderScreeningFlags,
  coarseScreeningFromOrders,
  type ScreeningSignalState,
  type PlacementRequiredCertStatus,
} from '../../utils/placementTileWorkforceSignals';
import type { PlacementApplicationNoShowRisk } from '../../utils/placementNoShowRiskDisplay';
import type {
  JobReadinessChipContributor,
  JobReadinessChipData,
} from '../../shared/jobReadinessChip/types';
import WorkforceInactiveElsewhereChip from './WorkforceInactiveElsewhereChip';

/** Dark tooltip body: force white copy for contrast (Placements tiles). */
export const placementTileTooltipSlotProps = {
  componentsProps: {
    tooltip: {
      sx: {
        bgcolor: 'grey.900',
        color: '#fff',
        maxWidth: 320,
        border: '1px solid',
        borderColor: 'grey.700',
        '& .MuiTypography-root': { color: '#fff' },
      },
    },
  },
} as const;

export interface Worker {
  id: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  displayName?: string;
  city?: string;
  state?: string;
  resumeUrl?: string;
  resume?: {
    storagePath?: string;
    downloadUrl?: string;
    fileName?: string;
  };
  skills?: string[];
  languages?: string[];
  /** `users.transportMethod` — same enum as Profile → Employment (Car / Public Transit / Bike / Walk / Other). */
  transportMethod?: string;
  bio?: string;
  workHistory?: any[];
  employmentHistory?: any[];
  certifications?: any[];
  licenses?: any[];
  aiProfileScore?: number;
  aiJobFitScore?: number;
  /** Denormalized: `users/{uid}.scoreSummary.interviewLastScore10` (0–10), most recent scored interview. */
  interviewLastScore10?: number;
  /** Per-application job match for this job/posting context (`applications.*.jobScoreSummary`). */
  placementJobFitScore?: number;
  /** Application- or assignment-level no-show risk for Placements tiles (`aiAutomation.noShowRisk` or assignment `noShowRiskPredictionV1`). */
  placementNoShowRisk?: PlacementApplicationNoShowRisk & { source?: 'application' | 'assignment' };
  isAssignedToShift?: boolean; // In Assignments column (placed or assigned)
  isPlacementOnly?: boolean;   // Placed but not yet offered - no Assignment, no messages
  assignmentStatus?: string;
  assignmentId?: string;
  confirmationStatus?: 'accepted' | 'confirmed'; // Track confirmation status
  /** Assignment start date (YYYY-MM-DD); when set, shown on tile instead of city/state */
  assignmentStartDate?: string;
  assignmentEndDate?: string;
  /** When the offer (or last reminder) was sent; ms since epoch for display */
  assignmentOfferSentAt?: number;
  /** When status is confirmed, ms when the worker confirmed (accepted) the assignment */
  assignmentConfirmedAt?: number;
  /** Master recruiter score (same source as Users table / profile header). */
  recruiterMasterGrade?: string | null;
  recruiterMasterScore100?: number | null;
  recruiterMasterSummary?: string | null;
  /** AccuSource-style screening orders on `users` (best-effort for tile signals). */
  backgroundCheckOrders?: Array<Record<string, unknown>>;
  drugScreeningOrders?: Array<Record<string, unknown>>;
  /**
   * Accounts where this worker has been marked inactive (§5b of the
   * Workforce doc). Denormalized onto `users/{uid}.inactiveAtAccounts`
   * by `onAccountWorkforceStatusChangeSyncUserInactiveSet` — forwarded
   * here so Labor Pool tiles can render a quiet "Inactive at N
   * account(s)" chip. The Labor Pool view filters out entries that
   * match the current account before rendering.
   */
  inactiveAtAccounts?: UserInactiveAtAccountEntry[];
}

export const WORKER_DRAG_MIME = 'application/x-hrx-worker-id';

/** Mirror of `users.transportMethod` icon mapping in `RecordHeaderTransportMethodIcon`. */
const PLACEMENT_TRANSPORT_BY_VALUE: Record<string, { Icon: SvgIconComponent; label: string }> = {
  Car: { Icon: TransportCarIcon, label: 'Car' },
  'Public Transit': { Icon: TransportTransitIcon, label: 'Public Transit' },
  Bike: { Icon: TransportBikeIcon, label: 'Bike' },
  Walk: { Icon: TransportWalkIcon, label: 'Walk' },
  Other: { Icon: TransportOtherIcon, label: 'Other' },
};

function resolvePlacementTransport(raw: string | null | undefined): { Icon: SvgIconComponent; label: string } | null {
  if (raw == null) return null;
  const key = String(raw).trim();
  if (!key) return null;
  return PLACEMENT_TRANSPORT_BY_VALUE[key] ?? { Icon: TransportOtherIcon, label: key };
}

/**
 * Action chips/buttons in the bottom row (status, Confirm, Assign).
 * Sized to match `tileReadinessChipSx` (further below) so the bottom
 * row reads as one consistent chip strip.
 */
export const placementActionChipSx = {
  height: 20,
  fontWeight: 600,
  '& .MuiChip-label': { px: 0.75, fontSize: '0.65rem' },
  '& .MuiChip-icon': { fontSize: 12, marginLeft: '6px', marginRight: '-4px' },
};

export const placementActionIconBtnSx = {
  width: 20,
  height: 20,
  '& .MuiSvgIcon-root': { fontSize: 14 },
};

/** Match `placementScreeningIconSx` / readiness row (15px). */
const placementProfileTileIconBtnSx = {
  p: 0.35,
  color: 'text.secondary',
  '& .MuiSvgIcon-root': { fontSize: 15 },
} as const;

/**
 * Resume URL resolution mirrors the `getResumeUrl()` closure in the Worker Pool tile;
 * shared so the Assignment column can render the same resume icon without duplicating
 * the storage-bucket fallback.
 */
export function resolvePlacementResumeUrl(worker: Worker): string | null {
  if (worker.resumeUrl) return worker.resumeUrl;
  if (worker.resume?.downloadUrl) return worker.resume.downloadUrl;
  if (worker.resume?.storagePath) {
    return `https://firebasestorage.googleapis.com/v0/b/hrx1-d3beb.firebasestorage.app/o/${encodeURIComponent(worker.resume.storagePath)}?alt=media`;
  }
  return null;
}

/**
 * Compact profile signal strip: open-in-new + resume / bio / work-history /
 * licenses / certs / skills / languages / transport icons. Rendered as the
 * `leadingSlot` of `PlacementTileReadinessIconRow` so it sits inline with
 * the BG / drug / history screening icons. Used by both Worker Pool and
 * Assignment column tiles to keep them visually identical.
 */
export function PlacementProfileActionIcons({
  worker,
  jobOrder,
  onOpenResume,
  onOpenLicenses,
  onOpenCerts,
}: {
  worker: Worker;
  jobOrder: JobOrder | null;
  onOpenResume: (resumeUrl: string, fileName: string | undefined) => void;
  onOpenLicenses: (licenses: any[]) => void;
  onOpenCerts: (certs: any[]) => void;
}) {
  const resumeUrl = resolvePlacementResumeUrl(worker);
  const hasBio = !!(worker.bio && worker.bio.trim().length > 0);
  const hasWorkHistory = !!(worker.workHistory && worker.workHistory.length > 0);
  const hasCerts = !!(worker.certifications && worker.certifications.length > 0);
  const hasLicenses = !!(worker.licenses && worker.licenses.length > 0);
  const transport = resolvePlacementTransport(worker.transportMethod);

  return (
    <>
      {/* Phase 5b — quiet "Inactive at N account(s)" signal, filtered to
          exclude the current account the recruiter is already placing for. */}
      <WorkforceInactiveElsewhereChip
        entries={worker.inactiveAtAccounts}
        currentAccountId={(jobOrder as any)?.recruiterAccountId ?? null}
        iconOnly
      />
      <Tooltip title="Open user record in new tab" {...placementTileTooltipSlotProps}>
        <IconButton
          size="small"
          sx={placementProfileTileIconBtnSx}
          onClick={(e) => {
            e.stopPropagation();
            window.open(`/users/${worker.id}`, '_blank', 'noopener,noreferrer');
          }}
          aria-label="Open user record in new tab"
        >
          <OpenInNewIcon />
        </IconButton>
      </Tooltip>
      {resumeUrl ? (
        <Tooltip title="View resume" {...placementTileTooltipSlotProps}>
          <IconButton
            size="small"
            sx={placementProfileTileIconBtnSx}
            onClick={() => onOpenResume(resumeUrl, worker.resume?.fileName)}
            aria-label="View resume"
          >
            <ResumeIcon />
          </IconButton>
        </Tooltip>
      ) : null}
      {hasBio ? (
        <Tooltip
          title={
            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', maxWidth: 320, color: '#fff' }}>
              {worker.bio}
            </Typography>
          }
          {...placementTileTooltipSlotProps}
        >
          <IconButton size="small" sx={placementProfileTileIconBtnSx} aria-label="View bio">
            <BioIcon />
          </IconButton>
        </Tooltip>
      ) : null}
      {hasWorkHistory ? (
        <Tooltip
          title={
            <Box sx={{ maxWidth: 340 }}>
              <Typography variant="subtitle2" sx={{ mb: 0.5, color: '#fff', fontWeight: 600 }}>
                Work history
              </Typography>
              {worker.workHistory?.slice(0, 3).map((job: any, idx: number) => (
                <Typography key={idx} variant="caption" display="block" sx={{ color: '#fff' }}>
                  {job.position || job.title || job.role || 'Position'}
                  {job.company ? ` at ${job.company}` : ''}
                </Typography>
              ))}
            </Box>
          }
          {...placementTileTooltipSlotProps}
        >
          <IconButton size="small" sx={placementProfileTileIconBtnSx} aria-label="View work history">
            <WorkHistoryIcon />
          </IconButton>
        </Tooltip>
      ) : null}
      {hasLicenses ? (
        <Tooltip
          title={`${worker.licenses?.length} license${(worker.licenses?.length || 0) > 1 ? 's' : ''} on profile`}
          {...placementTileTooltipSlotProps}
        >
          <IconButton
            size="small"
            sx={placementProfileTileIconBtnSx}
            onClick={() => onOpenLicenses(worker.licenses || [])}
            aria-label="View licenses"
          >
            <LicenseIcon />
          </IconButton>
        </Tooltip>
      ) : null}
      {hasCerts ? (
        <Tooltip title="View profile certifications" {...placementTileTooltipSlotProps}>
          <IconButton
            size="small"
            sx={placementProfileTileIconBtnSx}
            onClick={() => onOpenCerts(worker.certifications || [])}
            aria-label="View certifications"
          >
            <ProfileCertsIcon />
          </IconButton>
        </Tooltip>
      ) : null}
      {worker.skills?.length ? (
        <Tooltip
          title={
            <Box sx={{ maxWidth: 320 }}>
              <Typography variant="caption" fontWeight={700} display="block" sx={{ mb: 0.5, color: '#fff' }}>
                {worker.skills.length} skill{worker.skills.length === 1 ? '' : 's'}
              </Typography>
              <Typography variant="caption" display="block" sx={{ color: '#fff' }}>
                {worker.skills.join(', ')}
              </Typography>
            </Box>
          }
          {...placementTileTooltipSlotProps}
        >
          <IconButton size="small" sx={placementProfileTileIconBtnSx} aria-label="View skills">
            <SkillsIcon />
          </IconButton>
        </Tooltip>
      ) : null}
      {worker.languages?.length ? (
        <Tooltip
          title={
            <Box sx={{ maxWidth: 320 }}>
              <Typography variant="caption" fontWeight={700} display="block" sx={{ mb: 0.5, color: '#fff' }}>
                {worker.languages.length} language{worker.languages.length === 1 ? '' : 's'}
              </Typography>
              <Typography variant="caption" display="block" sx={{ color: '#fff' }}>
                {worker.languages.join(', ')}
              </Typography>
            </Box>
          }
          {...placementTileTooltipSlotProps}
        >
          <IconButton size="small" sx={placementProfileTileIconBtnSx} aria-label="View languages">
            <LanguagesIcon />
          </IconButton>
        </Tooltip>
      ) : null}
      {transport ? (
        <Tooltip title={`Transportation: ${transport.label}`} {...placementTileTooltipSlotProps}>
          <IconButton
            size="small"
            sx={placementProfileTileIconBtnSx}
            aria-label={`Transportation: ${transport.label}`}
          >
            <transport.Icon />
          </IconButton>
        </Tooltip>
      ) : null}
    </>
  );
}

function placementScreeningIconSx(state: ScreeningSignalState, active: boolean): Record<string, unknown> {
  if (!active || state === 'na') return { fontSize: 15, color: 'text.disabled', opacity: 0.45 };
  if (state === 'ok') return { fontSize: 15, color: 'success.main' };
  if (state === 'pending') return { fontSize: 15, color: 'warning.main' };
  if (state === 'issue') return { fontSize: 15, color: 'error.main' };
  if (state === 'missing') return { fontSize: 15, color: 'info.main' };
  return { fontSize: 15, color: 'text.secondary' };
}

/** Job-order screening: compact icons + tooltips (Placements tiles). Required certs use chips in the qualification row. */
function PlacementTileReadinessIconRow({
  jobOrder,
  worker,
  leadingSlot,
}: {
  jobOrder: JobOrder | null;
  worker: Worker;
  leadingSlot?: React.ReactNode;
}) {
  if (!jobOrder) return leadingSlot ? <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.35, flexWrap: 'wrap' }}>{leadingSlot}</Box> : null;
  const flags = placementJobOrderScreeningFlags(jobOrder);
  const hasScreening = flags.bgRequired || flags.drugRequired || flags.certCount > 0;

  const bgState = flags.bgRequired ? coarseScreeningFromOrders(worker.backgroundCheckOrders) : 'na';
  const drugState = flags.drugRequired ? coarseScreeningFromOrders(worker.drugScreeningOrders) : 'na';

  const jobLabel = String((jobOrder as { jobOrderName?: string }).jobOrderName || jobOrder.jobTitle || 'This job').trim();

  const bgTip = (
    <Box sx={{ maxWidth: 280 }}>
      <Typography variant="caption" fontWeight={700} display="block" sx={{ mb: 0.5, color: '#fff' }}>
        Background check
      </Typography>
      <Typography variant="caption" display="block" sx={{ color: '#fff' }}>
        Job requires a background check ({jobLabel}). Worker signal uses AccuSource / screening orders on the profile.
      </Typography>
      <Typography variant="caption" display="block" sx={{ mt: 0.5, color: '#fff' }}>
        Status:{' '}
        {bgState === 'ok'
          ? 'Satisfied (cleared / complete on latest order).'
          : bgState === 'pending'
            ? 'In progress or awaiting results.'
            : bgState === 'missing'
              ? 'No screening order found yet.'
              : 'Needs review (failed, canceled, or unfavorable).'}
      </Typography>
    </Box>
  );

  const drugTip = (
    <Box sx={{ maxWidth: 280 }}>
      <Typography variant="caption" fontWeight={700} display="block" sx={{ mb: 0.5, color: '#fff' }}>
        Drug screen
      </Typography>
      <Typography variant="caption" display="block" sx={{ color: '#fff' }}>
        Job requires drug screening ({jobLabel}). Worker signal uses drug screening orders on the profile.
      </Typography>
      <Typography variant="caption" display="block" sx={{ mt: 0.5, color: '#fff' }}>
        Status:{' '}
        {drugState === 'ok'
          ? 'Satisfied (negative / complete on latest order).'
          : drugState === 'pending'
            ? 'In progress or awaiting results.'
            : drugState === 'missing'
              ? 'No screening order found yet.'
              : 'Needs review (positive, failed, or unfavorable).'}
      </Typography>
    </Box>
  );

  const historyTip = (
    <Box sx={{ maxWidth: 280 }}>
      <Typography variant="caption" fontWeight={700} display="block" sx={{ mb: 0.5, color: '#fff' }}>
        Assignment history
      </Typography>
      <Typography variant="caption" display="block" sx={{ color: '#fff' }}>
        Worked shifts vs. no-shows tracked in HRX will surface here when time entry is connected. Until then, use the
        no-show risk line (model-based) when shown.
      </Typography>
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.35, flexWrap: 'wrap', minHeight: 18 }}>
      {leadingSlot}
      {hasScreening ? (
        <>
          {flags.bgRequired ? (
            <Tooltip title={bgTip} placement="top" enterDelay={350} {...placementTileTooltipSlotProps}>
              <FingerprintIcon sx={placementScreeningIconSx(bgState, true)} />
            </Tooltip>
          ) : null}
          {flags.drugRequired ? (
            <Tooltip title={drugTip} placement="top" enterDelay={350} {...placementTileTooltipSlotProps}>
              <ScienceIcon sx={placementScreeningIconSx(drugState, true)} />
            </Tooltip>
          ) : null}
        </>
      ) : null}
      <Tooltip title={historyTip} placement="top" enterDelay={200} {...placementTileTooltipSlotProps}>
        <HistoryIcon sx={{ fontSize: 15, color: 'text.secondary', opacity: 0.65 }} />
      </Tooltip>
    </Box>
  );
}

/**
 * The two-chip readiness model that every tile renders, regardless of
 * column. Greg's spec (2026-05-22):
 *   - Employee chip = "is this worker onboarded with the hiring entity
 *     for this job order?"
 *   - Job chip = "do they meet the JO's requirements — certs,
 *     background, drug, etc?"
 * Three states each. Hover tooltip lists the specific issues.
 *
 * State mapping
 *   green  → all clear / Active / matched
 *   yellow → in progress / pending / not yet on file / no record
 *   red    → terminated / failed / hard blocker
 *
 * Color drift is the danger here — every signal we ingest has to map
 * cleanly into one of these three states. The compute helpers below
 * make those mappings explicit so they're easy to audit.
 */
type TileReadinessState = 'green' | 'yellow' | 'red' | 'loading';

interface TileReadinessChipModel {
  state: TileReadinessState;
  summary: string;
  /** Bulleted detail lines for the tooltip body (excludes the summary). */
  issues: string[];
}

const tileReadinessChipSx = {
  height: 20,
  fontWeight: 600,
  '& .MuiChip-label': { px: 0.75, fontSize: '0.65rem', letterSpacing: 0.2 },
} as const;

function tileChipStyle(state: TileReadinessState) {
  // Solid color fills so the state reads instantly across both columns.
  // Loading uses outlined neutral so the chip doesn't shout while data
  // is still flowing in.
  if (state === 'green') {
    return {
      ...tileReadinessChipSx,
      bgcolor: 'success.main',
      color: '#fff',
      '& .MuiChip-label': { ...tileReadinessChipSx['& .MuiChip-label'], color: '#fff' },
    };
  }
  if (state === 'yellow') {
    return {
      ...tileReadinessChipSx,
      bgcolor: 'warning.main',
      color: '#fff',
      '& .MuiChip-label': { ...tileReadinessChipSx['& .MuiChip-label'], color: '#fff' },
    };
  }
  if (state === 'red') {
    return {
      ...tileReadinessChipSx,
      bgcolor: 'error.main',
      color: '#fff',
      '& .MuiChip-label': { ...tileReadinessChipSx['& .MuiChip-label'], color: '#fff' },
    };
  }
  return { ...tileReadinessChipSx, bgcolor: 'grey.200', color: 'text.secondary' };
}

/**
 * Employee chip = onboarded status with the hiring entity.
 *
 * State mapping:
 *   - employmentChip.color === 'success' AND no missing items AND no
 *     blockers → green
 *   - employmentChip.color === 'error' (terminated / inactive) → red
 *   - everything else (Onboarding, no record, pending, blocked) →
 *     yellow
 *
 * Tooltip lines: the canonical employment tooltip first, then the
 * onboarding-missing list, then any non-cert / non-screening blocker
 * labels (those go in the Job chip instead).
 */
function computeEmployeeChip(
  employmentLoading: boolean,
  employmentChip: PlacementEmploymentChipModel,
  onboardingMissingLabels: string[],
  blockerLabels: string[],
): TileReadinessChipModel {
  if (employmentLoading) {
    return { state: 'loading', summary: 'Checking entity employment…', issues: [] };
  }
  const baseSummary = employmentChip.tooltip || employmentChip.label;
  const issues: string[] = [];
  onboardingMissingLabels.forEach((l) => issues.push(l));

  // Route generic blockers that aren't cert / screening-shaped into the
  // Employee bucket. Keep the heuristic narrow so we don't accidentally
  // surface a cert blocker here too.
  blockerLabels.forEach((l) => {
    const lower = l.toLowerCase();
    const isCertOrScreening =
      lower.includes('cert') ||
      lower.includes('license') ||
      lower.includes('background') ||
      lower.includes('drug');
    if (!isCertOrScreening && !issues.includes(l)) issues.push(l);
  });

  let state: TileReadinessState;
  if (employmentChip.color === 'success' && issues.length === 0) {
    state = 'green';
  } else if (employmentChip.color === 'error') {
    state = 'red';
  } else {
    state = 'yellow';
  }

  return { state, summary: baseSummary, issues };
}

/**
 * Job chip = JO requirement compliance (certs, background, drug, etc.).
 *
 * Inputs:
 *   - `requiredCertStatuses` — array of `{ label, matched }` for each
 *     cert the JO requires; matched=true means present on the worker's
 *     profile. Missing certs → yellow (not red, because the cert isn't
 *     "failed" — it just hasn't been provided yet).
 *   - `bgState` / `drugState` — coarse screening status from the
 *     worker's BG / drug orders. `'ok'` → green-contributing,
 *     `'pending'` / `'missing'` → yellow-contributing, `'issue'` → red.
 *   - `blockerLabels` — cert/screening blockers route here.
 *
 * Worst-wins aggregation: any red → red. Else any yellow → yellow.
 * Else green.
 */
function computeJobChip(
  jobOrder: JobOrder | null,
  worker: Worker,
  requiredCertStatuses: PlacementRequiredCertStatus[],
  blockerLabels: string[],
): TileReadinessChipModel {
  const issues: string[] = [];
  let worst: 'green' | 'yellow' | 'red' = 'green';
  const bump = (next: 'yellow' | 'red') => {
    if (worst === 'red') return;
    if (next === 'red') worst = 'red';
    else if (worst === 'green') worst = 'yellow';
  };

  // Missing certs → yellow.
  requiredCertStatuses.forEach(({ label, matched }) => {
    if (!matched) {
      issues.push(`Missing cert: ${label}`);
      bump('yellow');
    }
  });

  // Screening signals (only if the JO requires them).
  const flags = jobOrder ? placementJobOrderScreeningFlags(jobOrder) : { bgRequired: false, drugRequired: false, certCount: 0 };
  if (flags.bgRequired) {
    const bg = coarseScreeningFromOrders(worker.backgroundCheckOrders);
    if (bg === 'issue') {
      issues.push('Background check: needs review');
      bump('red');
    } else if (bg === 'pending') {
      issues.push('Background check: in progress');
      bump('yellow');
    } else if (bg === 'missing') {
      issues.push('Background check: not started');
      bump('yellow');
    }
  }
  if (flags.drugRequired) {
    const drug = coarseScreeningFromOrders(worker.drugScreeningOrders);
    if (drug === 'issue') {
      issues.push('Drug screen: needs review');
      bump('red');
    } else if (drug === 'pending') {
      issues.push('Drug screen: in progress');
      bump('yellow');
    } else if (drug === 'missing') {
      issues.push('Drug screen: not started');
      bump('yellow');
    }
  }

  // Cert / screening-shaped blockers route into the Job tooltip too.
  blockerLabels.forEach((l) => {
    const lower = l.toLowerCase();
    const isCertOrScreening =
      lower.includes('cert') ||
      lower.includes('license') ||
      lower.includes('background') ||
      lower.includes('drug');
    if (isCertOrScreening && !issues.includes(l)) {
      issues.push(l);
      bump('yellow');
    }
  });

  const summary =
    worst === 'green'
      ? 'Meets all job requirements'
      : worst === 'red'
        ? 'Critical job-readiness issue'
        : 'Job readiness: some items pending';

  return { state: worst, summary, issues };
}

function PlacementReadinessChipsRow({
  employmentLoading,
  employmentChip,
  blockerLabels,
  requiredCertStatuses = [],
  onboardingMissingLabels = [],
  jobOrder,
  worker,
}: {
  employmentLoading: boolean;
  employmentChip: PlacementEmploymentChipModel;
  blockerLabels: string[];
  requiredCertStatuses?: PlacementRequiredCertStatus[];
  /** Specific incomplete entity-onboarding requirements to surface in the chip's tooltip. */
  onboardingMissingLabels?: string[];
  jobOrder: JobOrder | null;
  worker: Worker;
}) {
  const employee = computeEmployeeChip(
    employmentLoading,
    employmentChip,
    onboardingMissingLabels,
    blockerLabels,
  );
  const job = computeJobChip(jobOrder, worker, requiredCertStatuses, blockerLabels);

  const renderTooltip = (model: TileReadinessChipModel) => (
    <Box sx={{ maxWidth: 320 }}>
      <Typography variant="caption" sx={{ display: 'block', fontWeight: 700, color: '#fff', mb: 0.5 }}>
        {model.summary}
      </Typography>
      {model.issues.length > 0 && (
        <Box component="ul" sx={{ pl: 2, m: 0, color: '#fff' }}>
          {model.issues.slice(0, 10).map((issue) => (
            <Typography
              key={issue}
              component="li"
              variant="caption"
              sx={{ color: '#fff', lineHeight: 1.35 }}
            >
              {issue}
            </Typography>
          ))}
          {model.issues.length > 10 && (
            <Typography component="li" variant="caption" sx={{ color: '#fff', fontStyle: 'italic' }}>
              + {model.issues.length - 10} more…
            </Typography>
          )}
        </Box>
      )}
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', flexWrap: 'wrap' }}>
      <Tooltip title={renderTooltip(employee)} {...placementTileTooltipSlotProps}>
        <Chip size="small" label="Employee" sx={tileChipStyle(employee.state)} />
      </Tooltip>
      <Tooltip title={renderTooltip(job)} {...placementTileTooltipSlotProps}>
        <Chip size="small" label="Job" sx={tileChipStyle(job.state)} />
      </Tooltip>
    </Box>
  );
}

/**
 * Worker pool + Assignments column tiles: name, master grade/score, interview, job fit, no-show, job-readiness icons, chips.
 */
export function PlacementWorkerTileMainColumn({
  worker,
  hiringEntityName,
  entityEmploymentByUserId,
  placementEntityEmploymentLoading,
  blockerLabels,
  onboardingMissingLabels,
  row3,
  row4End,
  jobOrder,
  profileActionIcons,
  requiredCertStatuses,
  jobReadinessChipData,
  onJobReadinessItemClick,
  headerLeading,
  actions,
  actionsSubline,
}: {
  worker: Worker;
  hiringEntityName: string | null | undefined;
  entityEmploymentByUserId: Map<string, Record<string, unknown>>;
  placementEntityEmploymentLoading: boolean;
  blockerLabels: string[];
  /** Specific incomplete entity-onboarding requirement labels for the Onboarding chip tooltip. */
  onboardingMissingLabels?: string[];
  row3: React.ReactNode;
  row4End?: React.ReactNode;
  jobOrder: JobOrder | null;
  /** Resume / bio / work history / license icons — same row as screening icons, before BG/drug/history. */
  profileActionIcons?: React.ReactNode;
  requiredCertStatuses?: PlacementRequiredCertStatus[];
  /**
   * **R.4** — Pre-computed Job Readiness chip data for this assignment.
   * Read off `readinessSnapshotV1.jobReadinessChip` by the parent so we
   * don't refetch per tile. `null`/`undefined` → chip renders the
   * `'computing'` initial state.
   */
  jobReadinessChipData?: JobReadinessChipData | null;
  /**
   * Drill-in handler for popover rows; navigates to Worker Readiness tab.
   * `assignmentId` (when known) is threaded through so the readiness tab
   * can pre-select the matching assignment without resolving from the
   * contributor's `itemId`. R.7 honours `?assignmentId=` from the URL.
   */
  onJobReadinessItemClick?: (
    workerUid: string,
    assignmentId: string | null | undefined,
    contributor: JobReadinessChipContributor,
  ) => void;
  /** Optional slot rendered before the name in the header row (e.g. selection checkbox). */
  headerLeading?: React.ReactNode;
  /** Optional action buttons/chips appended to the bottom chips row (left-to-right). */
  actions?: React.ReactNode;
  /** Optional sub-line rendered below the bottom chips/actions row (e.g. confirmed-on date). */
  actionsSubline?: React.ReactNode;
}) {
  const jf = worker.placementJobFitScore;
  const showJobFit = jf != null && Number.isFinite(jf);
  const employmentChip = formatPlacementEmploymentChipWithEntityName(
    placementEmploymentChipFromEntityData(entityEmploymentByUserId.get(worker.id)),
    hiringEntityName,
  );
  const ms = worker.recruiterMasterScore100;
  const grade = worker.recruiterMasterGrade;
  const showMaster =
    ms != null && grade != null && grade !== 'N/A' && Number.isFinite(ms);
  const gradeColor =
    ms == null || !Number.isFinite(ms)
      ? 'text.secondary'
      : ms >= 80
        ? 'success.main'
        : ms >= 60
          ? 'warning.main'
          : 'text.primary';

  return (
    <Box
      sx={{
        minWidth: 0,
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        gap: 0.35,
        width: '100%',
        alignSelf: 'stretch',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          columnGap: 0.5,
          width: '100%',
          minWidth: 0,
        }}
      >
        {headerLeading}
        <Box
          sx={{
            flex: 1,
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) auto',
            alignItems: 'baseline',
            columnGap: 1,
            minWidth: 0,
          }}
        >
          <Typography variant="body2" fontWeight={600} noWrap sx={{ minWidth: 0 }}>
            {worker.displayName}
          </Typography>
          {showMaster ? (
            <Tooltip
              title={
                <Box sx={{ maxWidth: 300 }}>
                  <Typography variant="caption" fontWeight={700} display="block" sx={{ mb: 0.5, color: '#fff' }}>
                    Master score
                  </Typography>
                  <Typography variant="caption" display="block" sx={{ whiteSpace: 'pre-wrap', color: '#fff' }}>
                    {worker.recruiterMasterSummary || 'Blended category, interview, and profile inputs (same as Users table).'}
                  </Typography>
                </Box>
              }
              placement="top"
              enterDelay={300}
              {...placementTileTooltipSlotProps}
            >
              <Box
                component="span"
                sx={{
                  display: 'inline-flex',
                  alignItems: 'baseline',
                  gap: 0.35,
                  cursor: 'default',
                  justifySelf: 'end',
                }}
              >
                <Typography
                  component="span"
                  sx={{ fontWeight: 800, fontSize: '0.9rem', lineHeight: 1, color: gradeColor }}
                >
                  {grade}
                </Typography>
                <Typography
                  variant="caption"
                  fontWeight={700}
                  color="text.primary"
                  sx={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  {Math.round(ms)}
                </Typography>
              </Box>
            </Tooltip>
          ) : null}
        </Box>
      </Box>
      {showJobFit ? (
        <Typography variant="caption" color="text.secondary" display="block">
          Job fit {Math.round(jf)}/100
        </Typography>
      ) : null}
      {/* TEMP — model-based no-show risk hidden until HRX time-tracking
          backed counts replace the placeholder. Re-enable when shift counts
          (worked vs. no-show) are wired into `placementNoShowRisk`.
      {worker.placementNoShowRisk ? (
        <Tooltip
          title="Model-based no-show risk from application/assignment data. Counts of worked shifts vs. no-shows from HRX time tracking will appear here when available."
          placement="top"
          enterDelay={250}
          {...placementTileTooltipSlotProps}
        >
          <Typography variant="caption" color="text.secondary" display="block" sx={{ lineHeight: 1.25, cursor: 'default' }}>
            {formatPlacementNoShowRiskCompact(worker.placementNoShowRisk)}
          </Typography>
        </Tooltip>
      ) : null}
      */}
      {row3}
      <PlacementTileReadinessIconRow jobOrder={jobOrder} worker={worker} leadingSlot={profileActionIcons} />
      {/* Bottom row (rewritten 2026-05-23 per Greg's chip-redesign spec):
          exactly two chips — Employee + Job — regardless of column or
          assignment status. Tooltip-only details, no popover drill-in.
          The legacy `JobReadinessChip` (assignment-only popover) and the
          multi-cert / multi-blocker `PlacementQualificationChipsRow`
          were removed; both flows are now collapsed into the two-state
          tile chips that work for Worker Pool tiles as well.
          `jobReadinessChipData` / `onJobReadinessItemClick` props are
          preserved on the interface for caller back-compat but are no
          longer read here. */}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.5 }}>
        <PlacementReadinessChipsRow
          employmentLoading={placementEntityEmploymentLoading}
          employmentChip={employmentChip}
          blockerLabels={blockerLabels}
          requiredCertStatuses={requiredCertStatuses}
          onboardingMissingLabels={onboardingMissingLabels}
          jobOrder={jobOrder}
          worker={worker}
        />
        {row4End}
        {actions ? (
          <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 0.5 }}>{actions}</Box>
        ) : null}
      </Box>
      {actionsSubline}
    </Box>
  );
}
