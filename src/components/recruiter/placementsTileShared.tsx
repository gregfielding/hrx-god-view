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
import { JobReadinessChip } from './readiness';
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

const placementQualChipSx = { height: 20, '& .MuiChip-label': { px: 0.75, fontSize: '0.65rem' } };

/**
 * Action chips/buttons in the bottom row (status, Confirm, Assign) sized to match
 * `placementQualChipSx` so the bottom row reads as one consistent chip strip.
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

function PlacementQualificationChipsRow({
  employmentLoading,
  employmentChip,
  blockerLabels,
  requiredCertStatuses = [],
  onboardingMissingLabels = [],
}: {
  employmentLoading: boolean;
  employmentChip: PlacementEmploymentChipModel;
  blockerLabels: string[];
  requiredCertStatuses?: PlacementRequiredCertStatus[];
  /** Specific incomplete entity-onboarding requirements to surface in the chip's tooltip. */
  onboardingMissingLabels?: string[];
}) {
  // Build a richer tooltip for the employment chip when we know the
  // specific items still outstanding. Falls back to the canonical
  // chip tooltip when nothing is missing (or it's already Active).
  const employmentTooltip: React.ReactNode = (() => {
    const baseText = employmentChip.tooltip || employmentChip.label;
    if (!onboardingMissingLabels.length) return baseText;
    return (
      <Box sx={{ maxWidth: 320 }}>
        <Typography variant="caption" sx={{ display: 'block', fontWeight: 600, color: '#fff', mb: 0.5 }}>
          {baseText}
        </Typography>
        <Typography variant="caption" sx={{ display: 'block', fontWeight: 700, color: '#fff' }}>
          Outstanding ({onboardingMissingLabels.length}):
        </Typography>
        <Box component="ul" sx={{ pl: 2, m: 0, color: '#fff' }}>
          {onboardingMissingLabels.slice(0, 8).map((lab) => (
            <Typography
              key={lab}
              component="li"
              variant="caption"
              sx={{ color: '#fff', lineHeight: 1.35 }}
            >
              {lab}
            </Typography>
          ))}
          {onboardingMissingLabels.length > 8 && (
            <Typography component="li" variant="caption" sx={{ color: '#fff', fontStyle: 'italic' }}>
              + {onboardingMissingLabels.length - 8} more…
            </Typography>
          )}
        </Box>
      </Box>
    );
  })();

  return (
    <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', flexWrap: 'wrap' }}>
      {employmentLoading ? (
        <Chip size="small" label="…" variant="outlined" sx={placementQualChipSx} />
      ) : (
        <Tooltip title={employmentTooltip} {...placementTileTooltipSlotProps}>
          <Chip
            size="small"
            label={employmentChip.label}
            color={employmentChip.color}
            variant="outlined"
            sx={placementQualChipSx}
          />
        </Tooltip>
      )}
      {requiredCertStatuses.map(({ label, matched }, idx) => (
        <Tooltip
          key={`${label}-${idx}`}
          title={matched ? 'Matched to profile' : 'Required on job — not matched on profile'}
          {...placementTileTooltipSlotProps}
        >
          <Chip
            size="small"
            label={label.length > 32 ? `${label.slice(0, 30)}…` : label}
            sx={{
              ...placementQualChipSx,
              maxWidth: 200,
              fontWeight: 600,
              border: 'none',
              bgcolor: matched ? 'success.main' : 'error.main',
              color: '#fff',
              '& .MuiChip-label': { color: '#fff' },
            }}
          />
        </Tooltip>
      ))}
      {blockerLabels.map((bl) => (
        <Tooltip key={bl} title={bl} {...placementTileTooltipSlotProps}>
          <Chip size="small" label={bl} color="error" variant="outlined" sx={placementQualChipSx} />
        </Tooltip>
      ))}
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
      {/* Bottom row: Job Readiness chip + qualification chips on the left,
          action buttons right-justified. The Job Readiness chip aggregates
          assignment + employee readiness items (cross-collection) via the
          persisted snapshot.jobReadinessChip; pure presentation here. */}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.5 }}>
        {worker.assignmentId ? (
          <JobReadinessChip
            data={jobReadinessChipData ?? null}
            size="sm"
            onItemClick={
              onJobReadinessItemClick
                ? (c) => onJobReadinessItemClick(worker.id, worker.assignmentId, c)
                : undefined
            }
          />
        ) : null}
        <PlacementQualificationChipsRow
          employmentLoading={placementEntityEmploymentLoading}
          employmentChip={employmentChip}
          blockerLabels={blockerLabels}
          requiredCertStatuses={requiredCertStatuses}
          onboardingMissingLabels={onboardingMissingLabels}
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
