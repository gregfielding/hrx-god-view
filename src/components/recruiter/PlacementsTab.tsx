import React, { useCallback, useMemo, useState, useEffect, useRef } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Grid,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Alert,
  CircularProgress,
  Paper,
  Stack,
  Chip,
  IconButton,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Link,
  TextField,
  Checkbox,
} from '@mui/material';
import {
  Description as ResumeIcon,
  Info as BioIcon,
  Work as WorkHistoryIcon,
  Badge as LicenseIcon,
  School as ProfileCertsIcon,
  Lock as LockedIcon,
  LockOpen as UnlockedIcon,
  Clear as ClearIcon,
  Close as CloseIcon,
  Check as CheckIcon,
  Error as ErrorIcon,
  Edit as EditIcon,
  Refresh as RefreshIcon,
  Warning as WarningIcon,
  Email as EmailIcon,
  Sms as SmsIcon,
  Cancel as CancelIcon,
  GetApp as GetAppIcon,
  Fingerprint as FingerprintIcon,
  Science as ScienceIcon,
  History as HistoryIcon,
  OpenInNew as OpenInNewIcon,
} from '@mui/icons-material';
import {
  collection,
  query,
  where,
  getDocs,
  getDoc,
  doc,
  onSnapshot,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  limit,
  type QueryDocumentSnapshot,
  documentId,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';

import { db, functions } from '../../firebase';
import { p } from '../../data/firestorePaths';
import { getCalendarDayLocal } from '../../utils/dateUtils';
import { getDateScheduleEntriesWithHours } from '../../utils/dateSchedule';
import {
  applicationHasShiftMetadata,
  applicationMatchesAnyShift,
  applicationMatchesSelectedDay,
  applicationMatchesShift,
  assignmentMatchesSelectedDay,
  isIsoGigDay,
} from '../../utils/gigShiftState';
import { buildShiftPickerSecondLine } from '../../utils/shiftPickerLabel';
import MessageDrawer, { type MessageRecipient } from '../MessageDrawer';
import WorkforceInactiveElsewhereChip from './WorkforceInactiveElsewhereChip';
import type { UserInactiveAtAccountEntry } from '../../shared/accountWorkforce';
import { useAuth } from '../../contexts/AuthContext';
import { logAssignmentUpdateActivity } from '../../utils/activityLogger';
import { JobOrder } from '../../types/recruiter/jobOrder';
import { isExcludedFromPlacementsApplicantPool } from '../../utils/applicationStatusNormalize';
import { deriveC1EntityKeyFromEntityName } from '../../utils/c1EntityWorkAuthorizationUi';
import {
  placementEmploymentChipFromEntityData,
  formatPlacementEmploymentChipWithEntityName,
  placementBlockerOptionsForRow,
  selectPlacementBlockerLabelsWithOptionalEngine,
  selectPlacementCertBlockerLabelsLegacyFromSnapshot,
  type PlacementEmploymentChipModel,
} from '../../utils/placementQualificationChipsModel';
import certificationCatalogManifest from '../../data/generated/certificationCatalogManifest.v1.json';
import type { CertificationCatalogManifestV1 } from '../../types/certifications/certificationCatalogManifest';
import { warnCertifications } from '../../utils/certifications/certificationsLogging';
import { buildCertificationRequirementsFromJobOrder } from '../../utils/certifications/buildCertificationRequirementsFromJobOrder';
import { computeEngineGapForPhase1Requirements } from '../../utils/certifications/evaluateCertificationsForLegacyRequirementStrings';
import { logCertEngineShadowMismatch } from '../../utils/certifications/certEngineShadowCompare';
import { normalizeDateToISODateString } from '../../utils/certifications/normalizeDateToISODateString';
import { isCertEngineReadinessEnabled } from '../../utils/certifications/certEngineReadinessFlag';

const PLACEMENT_CERT_MANIFEST = certificationCatalogManifest as CertificationCatalogManifestV1;
import { buildPlacementJobFitMap } from '../../utils/placementApplicantJobFit';
import {
  buildPlacementApplicationNoShowRiskMap,
  formatPlacementNoShowRiskCompact,
  type PlacementApplicationNoShowRisk,
} from '../../utils/placementNoShowRiskDisplay';
import type { ReadinessSnapshotV1Firestore } from '../../shared/readinessSnapshotV1';
import { getRecruiterMasterDisplayForAdminUi } from '../../utils/scoring/recruiterMasterScoreDisplay';
import {
  placementJobOrderScreeningFlags,
  coarseScreeningFromOrders,
  placementRequiredCertMatchList,
  type ScreeningSignalState,
  type PlacementRequiredCertStatus,
} from '../../utils/placementTileWorkforceSignals';

/** Dark tooltip body: force white copy for contrast (Placements tiles). */
const placementTileTooltipSlotProps = {
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

interface PlacementsTabProps {
  tenantId: string;
  jobOrderId: string;
  jobOrder: JobOrder | null;
  onJobOrderUpdated?: () => void;
  /** Connected job post IDs (from Jobs Board) so we load the same applicants as the Applications tab */
  connectedJobPostIds?: string[];
  /** Hiring entity legal name (used to resolve C1 entity key for `entity_employments` / employment chip). */
  hiringEntityName?: string | null;
  /**
   * Effective Firestore entities/{id} for this job (explicit JO hiring entity, else recruiter account / parent).
   * When set, `entity_employments` rows are matched by this id; overrides `jobOrder.hiringEntityId` when absent on the JO doc.
   */
  placementHiringEntityId?: string | null;
}

interface Shift {
  id: string;
  shiftDate: string;
  startTime?: string;
  endTime?: string;
  shiftTitle?: string;
  spotsRemaining?: number;
  staffNeeded?: number;
}

interface Worker {
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

const WORKER_DRAG_MIME = 'application/x-hrx-worker-id';

/** `users/{uid}.scoreSummary.interviewLastScore10` — same source as Interview tab / recomputeInterviewScoreSummary. */
function formatInterviewLastScore10(v: number | undefined): string | null {
  if (v == null || !Number.isFinite(v)) return null;
  return `${(Math.round(v * 10) / 10).toFixed(1)}/10`;
}

const placementQualChipSx = { height: 20, '& .MuiChip-label': { px: 0.75, fontSize: '0.65rem' } };

/** Match `placementScreeningIconSx` / readiness row (15px). */
const placementProfileTileIconBtnSx = {
  p: 0.35,
  color: 'text.secondary',
  '& .MuiSvgIcon-root': { fontSize: 15 },
} as const;

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
}: {
  employmentLoading: boolean;
  employmentChip: PlacementEmploymentChipModel;
  blockerLabels: string[];
  requiredCertStatuses?: PlacementRequiredCertStatus[];
}) {
  return (
    <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', flexWrap: 'wrap' }}>
      {employmentLoading ? (
        <Chip size="small" label="…" variant="outlined" sx={placementQualChipSx} />
      ) : (
        <Tooltip title={employmentChip.tooltip || employmentChip.label} {...placementTileTooltipSlotProps}>
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
function PlacementWorkerTileMainColumn({
  worker,
  hiringEntityName,
  entityEmploymentByUserId,
  placementEntityEmploymentLoading,
  blockerLabels,
  row3,
  row4End,
  jobOrder,
  profileActionIcons,
  requiredCertStatuses,
}: {
  worker: Worker;
  hiringEntityName: string | null | undefined;
  entityEmploymentByUserId: Map<string, Record<string, unknown>>;
  placementEntityEmploymentLoading: boolean;
  blockerLabels: string[];
  row3: React.ReactNode;
  row4End?: React.ReactNode;
  jobOrder: JobOrder | null;
  /** Resume / bio / work history / license icons — same row as screening icons, before BG/drug/history. */
  profileActionIcons?: React.ReactNode;
  requiredCertStatuses?: PlacementRequiredCertStatus[];
}) {
  const interviewLabel = formatInterviewLastScore10(worker.interviewLastScore10);
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
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) auto',
          alignItems: 'start',
          columnGap: 1,
          rowGap: 0.15,
          width: '100%',
          minWidth: 0,
        }}
      >
        <Typography variant="body2" fontWeight={600} noWrap sx={{ minWidth: 0 }}>
          {worker.displayName}
        </Typography>
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-end',
            justifySelf: 'end',
            justifyContent: 'flex-start',
            gap: 0.15,
            textAlign: 'right',
            minWidth: 0,
          }}
        >
          {showMaster ? (
            <Box sx={{ display: 'flex', width: '100%', justifyContent: 'flex-end', minWidth: 0 }}>
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
                  }}
                >
                  <Typography
                    component="span"
                    sx={{ fontWeight: 800, fontSize: '0.9rem', lineHeight: 1, color: gradeColor }}
                  >
                    {grade}
                  </Typography>
                  <Typography variant="caption" fontWeight={700} color="text.primary" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                    {Math.round(ms)}
                  </Typography>
                </Box>
              </Tooltip>
            </Box>
          ) : null}
          {interviewLabel ? (
            <Typography variant="caption" color="primary" fontWeight={600} sx={{ lineHeight: 1.2, textAlign: 'right' }}>
              Int {interviewLabel}
            </Typography>
          ) : null}
        </Box>
      </Box>
      {showJobFit ? (
        <Typography variant="caption" color="text.secondary" display="block">
          Job fit {Math.round(jf)}/100
        </Typography>
      ) : null}
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
      {row3}
      <PlacementTileReadinessIconRow jobOrder={jobOrder} worker={worker} leadingSlot={profileActionIcons} />
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.5 }}>
        <PlacementQualificationChipsRow
          employmentLoading={placementEntityEmploymentLoading}
          employmentChip={employmentChip}
          blockerLabels={blockerLabels}
          requiredCertStatuses={requiredCertStatuses}
        />
        {row4End}
      </Box>
    </Box>
  );
}

const PlacementsTab: React.FC<PlacementsTabProps> = ({
  tenantId,
  jobOrderId,
  jobOrder,
  onJobOrderUpdated,
  connectedJobPostIds = [],
  hiringEntityName = null,
  placementHiringEntityId = null,
}) => {
  // Only present in hrx-god-view workspace build (Assign All + Export + Preview Email)
  if (typeof console !== 'undefined' && console.log) {
    console.log('[PlacementsTab] Loaded WITH Preview Email button (run from /Users/gregfielding/hrx-god-view)');
  }
  const { user } = useAuth();
  const placementNotificationsMuted = Boolean(jobOrder?.muted);
  const [togglingPlacementMute, setTogglingPlacementMute] = useState(false);
  // Generate a unique storage key for this job order
  const storageKey = `placements_filters_${tenantId}_${jobOrderId}`;
  
  // Helper to load persisted filters from localStorage
  const loadPersistedFilters = (): { shiftId: string; workforce: string; day?: string } => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          shiftId: parsed.shiftId || '',
          workforce: parsed.workforce || 'applicants',
          day: parsed.day || '',
        };
      }
    } catch (err) {
      console.error('Error loading persisted filters:', err);
    }
    return { shiftId: '', workforce: 'applicants', day: '' };
  };

  const persistedFilters = loadPersistedFilters();
  const [selectedShiftId, setSelectedShiftId] = useState<string>(persistedFilters.shiftId);
  const [selectedWorkforce, setSelectedWorkforce] = useState<string>(persistedFilters.workforce);
  const [selectedDay, setSelectedDay] = useState<string>(persistedFilters.day ?? '');
  // Data state
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  /** Job-order-scoped application job scores (userId → jobScore); shared with assignment column tiles. */
  const [placementJobFitByUserId, setPlacementJobFitByUserId] = useState<Map<string, number>>(() => new Map());
  const [placementAppNoShowRiskByUserId, setPlacementAppNoShowRiskByUserId] = useState<
    Map<string, PlacementApplicationNoShowRisk>
  >(() => new Map());
  const [isAssignmentDragOver, setIsAssignmentDragOver] = useState(false);
  const [isWorkerPoolDragOver, setIsWorkerPoolDragOver] = useState(false);
  type AssignmentRow = {
    userId: string;
    assignmentId: string;
    status: string;
    startDate: string;
    offerSentAt?: number;
    confirmedAt?: number;
    noShowRiskPredictionV1?: {
      score?: number;
      band?: string;
      reasons?: string[];
      recommendedAction?: string;
    };
  };
  const [assignmentRows, setAssignmentRows] = useState<AssignmentRow[]>([]);
  const [placementUserIds, setPlacementUserIds] = useState<Set<string>>(new Set());
  const [userGroups, setUserGroups] = useState<Array<{ id: string; groupName: string }>>([]);
  const [confirmedApplicationsCount, setConfirmedApplicationsCount] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendLoadingAssignmentId, setResendLoadingAssignmentId] = useState<string | null>(null);
  const [resendCooldownUntilByAssignmentId, setResendCooldownUntilByAssignmentId] = useState<Record<string, number>>({});
  const [confirmLoadingAssignmentId, setConfirmLoadingAssignmentId] = useState<string | null>(null);
  const [confirmingPlacementUserId, setConfirmingPlacementUserId] = useState<string | null>(null);
  const [cancelAssignmentWorker, setCancelAssignmentWorker] = useState<Worker | null>(null);
  const [previewEmailOpen, setPreviewEmailOpen] = useState(false);
  const [previewEmailSubject, setPreviewEmailSubject] = useState<string>('');
  const [previewEmailHtml, setPreviewEmailHtml] = useState<string>('');
  const [previewEmailLoading, setPreviewEmailLoading] = useState(false);
  const [previewEmailError, setPreviewEmailError] = useState<string | null>(null);

  const handleTogglePlacementNotificationsMuted = useCallback(async () => {
    if (!tenantId || !jobOrderId) return;
    setTogglingPlacementMute(true);
    try {
      setError(null);
      await updateDoc(doc(db, 'tenants', tenantId, 'job_orders', jobOrderId), {
        muted: !placementNotificationsMuted,
        updatedAt: serverTimestamp(),
      });
      onJobOrderUpdated?.();
    } catch (err: unknown) {
      setError((err as Error)?.message ?? 'Failed to update mute setting');
    } finally {
      setTogglingPlacementMute(false);
    }
  }, [tenantId, jobOrderId, placementNotificationsMuted, onJobOrderUpdated]);

  // Helper function to extract full profile data from user document
  const extractWorkerData = (userData: any, userId: string): Worker => {
    // Extract city/state from various possible locations
    const city = userData.city || 
                userData.addressInfo?.city || 
                userData.address?.city || 
                '';
    const state = userData.state || 
                userData.addressInfo?.state || 
                userData.address?.state || 
                '';
    
    // Extract resume URL (could be in multiple places)
    const resumeUrl = userData.resumeUrl || 
                     userData.resume?.downloadUrl || 
                     '';
    const resume = userData.resume || null;
    
    // Extract skills and languages (ensure arrays)
    const skills = Array.isArray(userData.skills) ? userData.skills : [];
    const languages = Array.isArray(userData.languages) ? userData.languages : [];
    
    // Extract bio (could be from parsed resume or direct field)
    const bio = userData.bio || 
               userData.parsedResume?.parsedData?.bio || 
               '';
    
    // Extract work history
    const workHistory = userData.workHistory || 
                       userData.employmentHistory || 
                       userData.parsedResume?.parsedData?.experience || 
                       [];
    
    // Extract certifications and licenses
    const certifications = Array.isArray(userData.certifications) ? userData.certifications : [];
    const licenses = Array.isArray(userData.licenses) ? userData.licenses : [];
    
    // Extract AI scores
    const aiProfileScore = userData.aiProfileScore || 
                          userData.parsedResume?.parsedData?.aiAnalysis?.overallScore || 
                          undefined;
    const aiJobFitScore = userData.aiJobFitScore || undefined;
    const ss = userData.scoreSummary as Record<string, unknown> | undefined;
    const interviewLastScore10 =
      typeof ss?.interviewLastScore10 === 'number' && Number.isFinite(ss.interviewLastScore10)
        ? ss.interviewLastScore10
        : undefined;

    const masterDisp = getRecruiterMasterDisplayForAdminUi({
      recruiterMasterScoreRaw: userData.recruiterMasterScore,
      recruiterScoreSnapshotRaw: userData.recruiterScoreSnapshot,
      userData: {
        scoreSummary: userData.scoreSummary,
        riskProfile: userData.riskProfile,
      },
      latestPrescreenInterviewAi: null,
    });

    return {
      id: userId,
      firstName: userData.firstName || '',
      lastName: userData.lastName || '',
      email: userData.email,
      phone: userData.phone,
      displayName: userData.displayName || `${userData.firstName || ''} ${userData.lastName || ''}`.trim(),
      city,
      state,
      resumeUrl,
      resume,
      skills,
      languages,
      bio,
      workHistory,
      employmentHistory: userData.employmentHistory || [],
      certifications,
      licenses,
      aiProfileScore,
      aiJobFitScore,
      interviewLastScore10,
      recruiterMasterGrade: masterDisp.grade,
      recruiterMasterScore100: masterDisp.score100,
      recruiterMasterSummary: masterDisp.summary,
      backgroundCheckOrders: Array.isArray(userData.backgroundCheckOrders) ? userData.backgroundCheckOrders : [],
      drugScreeningOrders: Array.isArray(userData.drugScreeningOrders) ? userData.drugScreeningOrders : [],
      // Phase 5b — denormalized AccountWorkforce inactive entries. The
      // array-of-objects shape is enforced at write time by the workforce
      // trigger (see shared/accountWorkforce.ts UserInactiveAtAccountEntry).
      // Cast through unknown because Firestore reads come back `any` and
      // the source-of-truth shape is guaranteed by the trigger.
      inactiveAtAccounts: Array.isArray(userData.inactiveAtAccounts)
        ? (userData.inactiveAtAccounts as unknown as UserInactiveAtAccountEntry[])
        : undefined,
    };
  };

  // State for modals
  const [resumeModalOpen, setResumeModalOpen] = useState(false);
  const [selectedResume, setSelectedResume] = useState<{ url: string; fileName?: string } | null>(null);
  const [certModalOpen, setCertModalOpen] = useState(false);
  const [selectedCerts, setSelectedCerts] = useState<any[]>([]);
  const [licenseModalOpen, setLicenseModalOpen] = useState(false);
  const [selectedLicenses, setSelectedLicenses] = useState<any[]>([]);
  // Assignments column: workers placed/assigned/confirmed/declined for this shift (from Firestore only, not filtered by Workforce)
  const [assignmentWorkersList, setAssignmentWorkersList] = useState<Worker[]>([]);
  const lastAssignmentShiftIdRef = useRef<string | null>(null); // clear list only when shift changes, not when workforce changes
  // Track optimistically added placement IDs so onSnapshot doesn't overwrite them before Firestore confirms
  const pendingPlacementAddsRef = useRef<Set<string>>(new Set());
  // Track optimistically cancelled assignments so UI updates immediately before Firestore propagates
  const [pendingAssignmentCancels, setPendingAssignmentCancels] = useState<Set<string>>(new Set());
  // For Career: user IDs placed or assigned on any shift of this job (so labor pool excludes them)
  const [allShiftsPlacedOrAssignedUserIds, setAllShiftsPlacedOrAssignedUserIds] = useState<Set<string>>(new Set());

  const placementEntityKey = useMemo(
    () => deriveC1EntityKeyFromEntityName(hiringEntityName || ''),
    [hiringEntityName]
  );

  const placementQualUserIds = useMemo(() => {
    const s = new Set<string>();
    workers.forEach((w) => s.add(w.id));
    assignmentWorkersList.forEach((w) => s.add(w.id));
    return [...s].sort();
  }, [workers, assignmentWorkersList]);

  const [entityEmploymentByUserId, setEntityEmploymentByUserId] = useState<Map<string, Record<string, unknown>>>(
    () => new Map()
  );
  const [placementEntityEmploymentLoading, setPlacementEntityEmploymentLoading] = useState(false);
  const [readinessSnapByAssignmentId, setReadinessSnapByAssignmentId] = useState<
    Map<string, ReadinessSnapshotV1Firestore | null>
  >(() => new Map());
  /** Each assignment’s `jobOrderId` (snapshot is built for that JO; tab `jobOrder` may be a different id). */
  const [assignmentJobOrderIdByAssignmentId, setAssignmentJobOrderIdByAssignmentId] = useState<
    Map<string, string>
  >(() => new Map());
  const [jobOrderByIdForPlacementCerts, setJobOrderByIdForPlacementCerts] = useState<
    Map<string, JobOrder | null>
  >(() => new Map());
  /** Phase 3 — engine-derived cert gap labels per assignment (when flag on). */
  const [engineCertBlockerLabelsByAssignmentId, setEngineCertBlockerLabelsByAssignmentId] = useState<
    Map<string, string[]>
  >(() => new Map());

  const assignmentIdsForReadinessSnapshot = useMemo(() => {
    const ids = new Set<string>();
    assignmentWorkersList.forEach((w) => {
      if (w.assignmentId) ids.add(w.assignmentId);
    });
    return [...ids].sort();
  }, [assignmentWorkersList]);

  const placementQualUserIdsKey = placementQualUserIds.join('|');
  const assignmentIdsForReadinessKey = assignmentIdsForReadinessSnapshot.join('|');

  const placementCertJobOrderIdsKey = useMemo(() => {
    const ids = [...new Set(assignmentJobOrderIdByAssignmentId.values())].filter(Boolean).sort();
    return JSON.stringify(ids);
  }, [assignmentJobOrderIdByAssignmentId]);

  useEffect(() => {
    if (!tenantId || placementQualUserIds.length === 0) {
      setEntityEmploymentByUserId(new Map());
      setPlacementEntityEmploymentLoading(false);
      return;
    }
    let cancelled = false;
    setPlacementEntityEmploymentLoading(true);
    (async () => {
      try {
        const ref = collection(db, 'tenants', tenantId, 'entity_employments');
        const merged = new Map<string, Record<string, unknown>>();
        const hiringEntityId = String(
          placementHiringEntityId ?? (jobOrder as { hiringEntityId?: string | null })?.hiringEntityId ?? ''
        ).trim();
        // Fast path when the job has no hiring entity id: `${uid}__${entityKey}` batch lookup.
        if (!hiringEntityId) {
          for (let i = 0; i < placementQualUserIds.length; i += 30) {
            const chunk = placementQualUserIds.slice(i, i + 30);
            const docIds = chunk.map((uid) => `${uid}__${placementEntityKey}`);
            const q = query(ref, where(documentId(), 'in', docIds));
            const snap = await getDocs(q);
            snap.docs.forEach((d) => {
              const uid = d.id.split('__')[0];
              merged.set(uid, d.data() as Record<string, unknown>);
            });
          }
        }
        if (hiringEntityId) {
          // Job order is authoritative: `${uid}__${entityKey}` can point at the wrong row when a worker has
          // multiple entity_employments (e.g. workforce row exists but Select onboarding is the job context).
          // Always prefer the row whose `entityId` matches this job's hiring entity (same as profile chips).
          for (const uid of placementQualUserIds) {
            try {
              const q2 = query(ref, where('userId', '==', uid), limit(60));
              const snap2 = await getDocs(q2);
              const rows = snap2.docs.map((d) => ({ id: d.id, data: d.data() as Record<string, unknown> }));
              const byEntityId = rows.find(
                (r) => String(r.data.entityId || '').trim() === hiringEntityId
              );
              const byEntityKey =
                !byEntityId && placementEntityKey
                  ? rows.find(
                      (r) =>
                        String(r.data.entityKey || '').toLowerCase() === String(placementEntityKey).toLowerCase()
                    )
                  : null;
              const picked = byEntityId ?? byEntityKey;
              if (picked) merged.set(uid, picked.data);
              else merged.delete(uid);
            } catch {
              /* ignore single-user fallback */
            }
          }
        } else {
          for (const uid of placementQualUserIds) {
            if (merged.has(uid)) continue;
            try {
              const q2 = query(ref, where('userId', '==', uid), limit(60));
              const snap2 = await getDocs(q2);
              const match = snap2.docs.find((d) => {
                const data = d.data() as { entityKey?: string };
                return (
                  String(data.entityKey || '').toLowerCase() === String(placementEntityKey).toLowerCase()
                );
              });
              if (match) merged.set(uid, match.data() as Record<string, unknown>);
            } catch {
              /* ignore */
            }
          }
        }
        if (!cancelled) setEntityEmploymentByUserId(merged);
      } catch (e) {
        console.error('PlacementsTab: entity_employments fetch failed', e);
        if (!cancelled) setEntityEmploymentByUserId(new Map());
      } finally {
        if (!cancelled) setPlacementEntityEmploymentLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, placementEntityKey, placementQualUserIdsKey, placementHiringEntityId, jobOrder?.hiringEntityId]);

  useEffect(() => {
    if (!tenantId || assignmentIdsForReadinessSnapshot.length === 0) {
      setReadinessSnapByAssignmentId(new Map());
      setAssignmentJobOrderIdByAssignmentId(new Map());
      return;
    }
    const allowed = new Set(assignmentIdsForReadinessSnapshot);
    setReadinessSnapByAssignmentId((prev) => {
      const next = new Map(prev);
      for (const id of [...next.keys()]) {
        if (!allowed.has(id)) next.delete(id);
      }
      return next;
    });
    setAssignmentJobOrderIdByAssignmentId((prev) => {
      const next = new Map(prev);
      for (const id of [...next.keys()]) {
        if (!allowed.has(id)) next.delete(id);
      }
      return next;
    });

    const unsubs = assignmentIdsForReadinessSnapshot.map((assignmentId) =>
      onSnapshot(doc(db, 'tenants', tenantId, 'assignments', assignmentId), (snap) => {
        setReadinessSnapByAssignmentId((prev) => {
          const next = new Map(prev);
          if (!snap.exists()) {
            next.set(assignmentId, null);
          } else {
            const data = snap.data() as {
              readinessSnapshotV1?: ReadinessSnapshotV1Firestore;
            };
            next.set(assignmentId, data.readinessSnapshotV1 ?? null);
          }
          return next;
        });
        setAssignmentJobOrderIdByAssignmentId((prev) => {
          const next = new Map(prev);
          if (!snap.exists()) {
            next.delete(assignmentId);
          } else {
            const data = snap.data() as { jobOrderId?: string };
            const jid = String(data.jobOrderId || '').trim();
            if (jid) next.set(assignmentId, jid);
            else next.delete(assignmentId);
          }
          return next;
        });
      })
    );
    return () => unsubs.forEach((u) => u());
  }, [tenantId, assignmentIdsForReadinessKey]);

  useEffect(() => {
    let ids: string[] = [];
    try {
      ids = JSON.parse(placementCertJobOrderIdsKey) as string[];
    } catch {
      ids = [];
    }
    if (!tenantId || !Array.isArray(ids) || ids.length === 0) {
      setJobOrderByIdForPlacementCerts(new Map());
      return;
    }
    let cancelled = false;
    (async () => {
      const next = new Map<string, JobOrder | null>();
      await Promise.all(
        ids.map(async (jid) => {
          try {
            let joSnap = await getDoc(doc(db, p.jobOrder(tenantId, jid)));
            if (!joSnap.exists()) {
              joSnap = await getDoc(doc(db, 'tenants', tenantId, 'recruiter_jobOrders', jid));
            }
            next.set(jid, joSnap.exists() ? (joSnap.data() as JobOrder) : null);
          } catch {
            next.set(jid, null);
          }
        })
      );
      if (!cancelled) setJobOrderByIdForPlacementCerts(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, placementCertJobOrderIdsKey]);

  useEffect(() => {
    if (!isCertEngineReadinessEnabled() || assignmentWorkersList.length === 0) {
      setEngineCertBlockerLabelsByAssignmentId(new Map());
      return;
    }
    let cancelled = false;
    (async () => {
      const next = new Map<string, string[]>();
      const todayISO = normalizeDateToISODateString(new Date()) ?? '1970-01-01';

      for (const w of assignmentWorkersList) {
        const aid = w.assignmentId;
        if (!aid || !w.id) continue;
        const joId = (assignmentJobOrderIdByAssignmentId.get(aid) || '').trim();
        let effectiveJobOrder: JobOrder | null | undefined;
        if (!joId) {
          effectiveJobOrder = jobOrder;
        } else if (jobOrderByIdForPlacementCerts.has(joId)) {
          effectiveJobOrder = jobOrderByIdForPlacementCerts.get(joId) ?? null;
        } else {
          continue;
        }
        const jc = effectiveJobOrder?.requiredCertifications;
        const jl = effectiveJobOrder?.requiredLicenses;
        if ((!jc || jc.length === 0) && (!jl || jl.length === 0)) {
          next.set(aid, []);
          continue;
        }
        try {
          const { requirements, unmappedStrings } = buildCertificationRequirementsFromJobOrder({
            jobOrder: effectiveJobOrder ?? undefined,
            manifest: PLACEMENT_CERT_MANIFEST,
            jobOrderId: joId || null,
          });
          const { labels, rows } = await computeEngineGapForPhase1Requirements({
            workerUid: w.id,
            requirements,
            context: 'assignment',
            todayISO,
            manifest: PLACEMENT_CERT_MANIFEST,
          });
          next.set(aid, labels);

          const reqs = readinessSnapByAssignmentId.get(aid)?.requirements;
          const opts = placementBlockerOptionsForRow(effectiveJobOrder, reqs);
          const legacyCert = selectPlacementCertBlockerLabelsLegacyFromSnapshot(reqs, opts);
          logCertEngineShadowMismatch({
            surface: 'placement',
            requirementSource: 'assignment',
            userId: w.id,
            assignmentId: aid,
            jobOrderId: joId || effectiveJobOrder?.id,
            legacyMissing: legacyCert,
            engineLabels: labels,
            unmappedStrings,
            engineRows: rows.map((r) => ({
              catalogEntryId: r.requirement.catalogEntryId,
              status: r.result.status,
              legacySourceLabel: r.requirement.legacySourceLabel,
            })),
          });
          if (process.env.NODE_ENV !== 'production') {
            const oldKey = [...legacyCert].sort().join('\u0001');
            const newKey = [...labels].sort().join('\u0001');
            if (oldKey !== newKey) {
              warnCertifications('readiness_mismatch', {
                userId: w.id,
                detail: {
                  surface: 'placement_blockers',
                  assignmentId: aid,
                  oldBlockers: legacyCert,
                  newBlockers: labels,
                  oldMissing: legacyCert,
                  newMissing: labels,
                },
              });
            }
          }
        } catch {
          /* ignore row */
        }
      }

      if (!cancelled) {
        setEngineCertBlockerLabelsByAssignmentId(next);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    assignmentWorkersList,
    assignmentJobOrderIdByAssignmentId,
    jobOrderByIdForPlacementCerts,
    jobOrder,
    readinessSnapByAssignmentId,
  ]);

  const placementBlockerLabelsForAssignmentId = useCallback(
    (assignmentId: string | undefined) => {
      if (!assignmentId) return [];
      const reqs = readinessSnapByAssignmentId.get(assignmentId)?.requirements;
      const joId = (assignmentJobOrderIdByAssignmentId.get(assignmentId) || '').trim();
      let effectiveJobOrder: JobOrder | null | undefined;
      if (!joId) {
        effectiveJobOrder = jobOrder;
      } else if (jobOrderByIdForPlacementCerts.has(joId)) {
        effectiveJobOrder = jobOrderByIdForPlacementCerts.get(joId) ?? null;
      } else {
        effectiveJobOrder = null;
      }
      const opts = placementBlockerOptionsForRow(effectiveJobOrder, reqs);
      const engineLabels = isCertEngineReadinessEnabled()
        ? engineCertBlockerLabelsByAssignmentId.get(assignmentId)
        : undefined;
      return selectPlacementBlockerLabelsWithOptionalEngine(reqs, opts, engineLabels);
    },
    [
      readinessSnapByAssignmentId,
      assignmentJobOrderIdByAssignmentId,
      jobOrderByIdForPlacementCerts,
      jobOrder,
      engineCertBlockerLabelsByAssignmentId,
    ],
  );

  // Load user groups for workforce dropdown
  useEffect(() => {
    const loadUserGroups = async () => {
      if (!tenantId) return;
      
      try {
        const groupsRef = collection(db, 'tenants', tenantId, 'userGroups');
        const groupsSnap = await getDocs(groupsRef);
        const groups = groupsSnap.docs.map(doc => {
          const d = doc.data();
          const groupName = d.groupName || d.name || d.title || doc.id;
          return { id: doc.id, groupName };
        });
        setUserGroups(groups);
      } catch (err) {
        console.error('Error loading user groups:', err);
      }
    };
    
    loadUserGroups();
  }, [tenantId]);

  // Persist filters to localStorage whenever they change
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify({
        shiftId: selectedShiftId,
        workforce: selectedWorkforce,
        day: selectedDay || undefined,
      }));
    } catch (err) {
      console.error('Error saving filters to localStorage:', err);
    }
  }, [selectedShiftId, selectedWorkforce, selectedDay, storageKey]);

  // Load confirmed applications count for selected shift
  useEffect(() => {
    const loadConfirmedApplications = async () => {
      if (!tenantId || !selectedShiftId) {
        setConfirmedApplicationsCount(0);
        return;
      }

      try {
        const applicationsRef = collection(db, 'tenants', tenantId, 'applications');
        // Query applications for this shift with status 'confirmed' (worker has confirmed)
        // Applications can have either shiftId (single) or shiftIds (array)
        const q1 = query(
          applicationsRef,
          where('shiftId', '==', selectedShiftId),
          where('status', '==', 'confirmed')
        );
        const q2 = query(
          applicationsRef,
          where('shiftIds', 'array-contains', selectedShiftId),
          where('status', '==', 'confirmed')
        );
        
        const [snapshot1, snapshot2] = await Promise.all([getDocs(q1), getDocs(q2)]);
        
        // Count unique applications that match this shift and are confirmed
        const uniqueAppIds = new Set<string>();
        snapshot1.docs.forEach(doc => uniqueAppIds.add(doc.id));
        snapshot2.docs.forEach(doc => {
          const data = doc.data();
          if (Array.isArray(data.shiftIds) && data.shiftIds.includes(selectedShiftId)) {
            uniqueAppIds.add(doc.id);
          }
        });
        
        setConfirmedApplicationsCount(uniqueAppIds.size);
      } catch (err: any) {
        console.error('Error loading confirmed applications:', err);
        // Don't show error, just set to 0
        setConfirmedApplicationsCount(0);
      }
    };

    loadConfirmedApplications();
  }, [tenantId, selectedShiftId]);

  // Load all shifts for this job order
  useEffect(() => {
    const loadShifts = async () => {
      if (!tenantId || !jobOrderId) {
        setShifts([]);
        setSelectedShiftId('');
        return;
      }

      setLoading(true);
      setError(null);
      try {
        // Load job order to get pay rate information (using canonical path)
        const jobOrderRef = doc(db, 'tenants', tenantId, 'job_orders', jobOrderId);
        const jobOrderSnap = await getDoc(jobOrderRef);
        const jobOrderData = jobOrderSnap.exists() ? jobOrderSnap.data() : null;
        const gigPositions = (jobOrderData as any)?.gigPositions as Array<{jobTitle: string; payRate: string | number}> | undefined;
        const defaultPayRate = jobOrderData?.payRate as number | undefined;
        
        // Helper to get pay rate for a shift
        const getPayRateForShift = (shift: any): number | undefined => {
          // First, check if shift already has payRate
          if (shift.payRate !== undefined && shift.payRate !== null) {
            const rate = typeof shift.payRate === 'number' ? shift.payRate : parseFloat(String(shift.payRate));
            return isNaN(rate) ? undefined : rate;
          }
          
          // If shift has defaultJobTitle, look it up in gigPositions
          if (shift.defaultJobTitle && gigPositions) {
            const position = gigPositions.find(p => p.jobTitle === shift.defaultJobTitle);
            if (position && position.payRate) {
              const rate = typeof position.payRate === 'number' ? position.payRate : parseFloat(String(position.payRate));
              return isNaN(rate) ? undefined : rate;
            }
          }
          
          // Fall back to job order's default pay rate
          return defaultPayRate;
        };
        
        // Query all shifts for this job order
        // For gig jobs, shifts are in tenants/{tenantId}/job_orders/{jobOrderId}/shifts
        const shiftsRef = collection(db, 'tenants', tenantId, 'job_orders', jobOrderId, 'shifts');
        const shiftsSnap = await getDocs(shiftsRef);
        
        // Enrich all shifts with pay rate
        const allShifts = shiftsSnap.docs.map(doc => {
          const shiftData: any = {
            id: doc.id,
            ...doc.data()
          } as Shift;
          
          // Enrich shift with pay rate if not present
          if (!shiftData.payRate) {
            const payRate = getPayRateForShift(shiftData);
            if (payRate !== undefined) {
              shiftData.payRate = payRate;
            }
          }
          
          return shiftData;
        });

        const sortedShifts = allShifts.sort((a, b) => {
          const dateA = getCalendarDayLocal(a.shiftDate);
          const dateB = getCalendarDayLocal(b.shiftDate);
          return dateA.localeCompare(dateB);
        });

        setShifts(sortedShifts);

        // Keep an existing valid selection; otherwise default to the first available shift.
        // Use functional updates so this effect does NOT need `selectedShiftId` in deps — including it
        // re-ran the whole fetch on every dropdown change and raced with assignment listeners.
        setSelectedShiftId((prev) => {
          if (sortedShifts.length === 0) return '';
          if (prev && sortedShifts.some((s) => s.id === prev)) return prev;
          return sortedShifts[0].id;
        });
      } catch (err: any) {
        console.error('Error loading shifts:', err);
        setError(err.message || 'Failed to load shifts');
      } finally {
        setLoading(false);
      }
    };

    loadShifts();
  }, [tenantId, jobOrderId]);

  // Load workforce based on selected option
  useEffect(() => {
    const loadWorkforce = async () => {
      if (!tenantId || !jobOrderId || !selectedWorkforce) {
        setWorkers([]);
        return;
      }
      if (selectedWorkforce === 'choose_group') {
        setWorkers([]);
        setLoading(false);
        return;
      }

      const jobType = String((jobOrder as any)?.jobType || '').toLowerCase();
      const isGig = jobType === 'gig';
      const currentSelectedShift = shifts.find((s) => s.id === selectedShiftId);
      const isSelectedShiftGigMultiDay = Boolean(
        isGig &&
        currentSelectedShift &&
        (currentSelectedShift as any).dateSchedule &&
        (currentSelectedShift as any).endDate &&
        (currentSelectedShift as any).endDate !== (currentSelectedShift as any).shiftDate,
      );
      // Normalize legacy persisted values for Gig: applicants -> shift_applicants, candidates -> shift_candidates
      const workforce =
        isGig && selectedWorkforce === 'applicants'
          ? 'shift_applicants'
          : isGig && selectedWorkforce === 'candidates'
            ? 'shift_candidates'
            : selectedWorkforce;

      setLoading(true);
      setError(null);
      try {
        let workforceUsers: Worker[] = [];

        const isCareerJob = jobType === 'career';
        const hasSelectedDayApplication = (applicationData: any): boolean => {
          if (!isSelectedShiftGigMultiDay || !selectedDay) return true;
          return applicationMatchesSelectedDay(applicationData, selectedDay);
        };

        /** For gig "All Applicants" / "All Candidates": include if application matches any shift (any day) for this job. */
        const allShiftIds = shifts.map((s) => s.id);

        const loadApplicationDocs = async (): Promise<Array<{ id: string; data: any }>> => {
          const applicationsRef = collection(db, 'tenants', tenantId, 'applications');
          const tenantById = new Map<string, QueryDocumentSnapshot>();

          // 1) Tenant applications linked by jobOrderId
          const byOrderSnap = await getDocs(
            query(applicationsRef, where('jobOrderId', '==', jobOrderId)),
          );
          byOrderSnap.docs.forEach((d) => tenantById.set(d.id, d));

          // 2) Tenant applications by connected job post IDs (jobId/postId = posting id)
          let jobPostIdsToUse: string[] =
            connectedJobPostIds.length > 0
              ? connectedJobPostIds.slice(0, 10)
              : [];
          if (jobPostIdsToUse.length === 0) {
            const jobPostingsSnap = await getDocs(
              query(collection(db, 'tenants', tenantId, 'job_postings'), where('jobOrderId', '==', jobOrderId)),
            );
            jobPostIdsToUse = jobPostingsSnap.docs.map((d) => d.id).filter(Boolean).slice(0, 10);
          }
          if (jobPostIdsToUse.length > 0) {
            const byJobIdSnap = await getDocs(query(applicationsRef, where('jobId', 'in', jobPostIdsToUse)));
            byJobIdSnap.docs.forEach((d) => tenantById.set(d.id, d));
            const byPostIdSnap = await getDocs(query(applicationsRef, where('postId', 'in', jobPostIdsToUse)));
            byPostIdSnap.docs.forEach((d) => tenantById.set(d.id, d));
          }

          const tenantSnaps = Array.from(tenantById.values());
          return tenantSnaps.map((d) => ({ id: d.id, data: d.data() }));
        };

        let applicationDocsBundle: Array<{ id: string; data: any }> = [];
        let jobFitMap = new Map<string, number>();
        let appNoShowMap = new Map<string, PlacementApplicationNoShowRisk>();
        if (!selectedWorkforce.startsWith('group_')) {
          applicationDocsBundle = await loadApplicationDocs();
          jobFitMap = buildPlacementJobFitMap(applicationDocsBundle);
          appNoShowMap = buildPlacementApplicationNoShowRiskMap(applicationDocsBundle);
        }
        setPlacementJobFitByUserId(jobFitMap);
        setPlacementAppNoShowRiskByUserId(appNoShowMap);

        const mergePoolWorker = (base: Worker, uid: string): Worker => {
          const jf = jobFitMap.get(uid);
          const ns = appNoShowMap.get(uid);
          let next: Worker = base;
          if (jf !== undefined) next = { ...next, placementJobFitScore: jf };
          if (ns) next = { ...next, placementNoShowRisk: { ...ns, source: 'application' } };
          return next;
        };

        // Career applicants are not shift-specific: show all in the labor pool regardless of selected shift.
        // Gig "Shift Applicants" / "Shift Candidates": only users whose application lists this shift (shiftIds/selectedShifts).
        // Job-level apps with no shift metadata belong in "All Applicants", not in shift-scoped pools.
        const strictGigShiftPool =
          isGig && (workforce === 'shift_applicants' || workforce === 'shift_candidates');
        const includeApplicantByShift = (data: any) => {
          if (isCareerJob) return true;
          const hasShift = applicationMatchesShift(data, selectedShiftId);
          if (strictGigShiftPool) {
            if (!selectedShiftId) return false;
            if (!applicationHasShiftMetadata(data)) return false;
            if (!hasShift) return false;
            if (isSelectedShiftGigMultiDay && selectedDay) {
              return hasSelectedDayApplication(data);
            }
            return true;
          }
          const allowWithoutShift = !applicationHasShiftMetadata(data);
          if (!hasShift && !allowWithoutShift) return false;
          if (isSelectedShiftGigMultiDay && selectedDay) {
            if (!hasShift) return false;
            return hasSelectedDayApplication(data);
          }
          return true;
        };

        // For gig "All Applicants" / "All Candidates": show everyone who applied to any day (any shift) for this job, without duplicates.
        const includeApplicantForAllDays = (data: any) => {
          const base =
            allShiftIds.length === 0 ||
            !applicationHasShiftMetadata(data) ||
            applicationMatchesAnyShift(data, allShiftIds);
          if (!base) return false;
          if (isSelectedShiftGigMultiDay && selectedDay) return hasSelectedDayApplication(data);
          return true;
        };

        if (workforce === 'all_applicants' || workforce === 'shift_applicants') {
          const applicationDocs = applicationDocsBundle;
          const userIds = new Set<string>();
          const filterByShift = workforce === 'shift_applicants';
          applicationDocs.forEach(({ data }) => {
            if (!data.userId) return;
            if (data.candidate === true) return;
            if (isExcludedFromPlacementsApplicantPool(data.status)) return;
            if (filterByShift && !includeApplicantByShift(data)) return;
            if (!filterByShift && !isCareerJob && !includeApplicantForAllDays(data)) return;
            userIds.add(data.userId);
          });
          const userPromises = Array.from(userIds).map(async (userId): Promise<Worker | null> => {
            const userRef = doc(db, 'users', userId);
            const userSnap = await getDoc(userRef);
            if (userSnap.exists()) return mergePoolWorker(extractWorkerData(userSnap.data(), userId), userId);
            return null;
          });
          const users = await Promise.all(userPromises);
          workforceUsers = users.filter((u): u is Worker => u !== null);
        } else if (workforce === 'all_candidates' || workforce === 'shift_candidates') {
          const applicationDocs = applicationDocsBundle;
          const candidateUserIds = new Set<string>();
          const filterByShift = workforce === 'shift_candidates';
          applicationDocs.forEach(({ data }) => {
            if (!data.userId || data.candidate !== true) return;
            if (isExcludedFromPlacementsApplicantPool(data.status)) return;
            if (filterByShift && !includeApplicantByShift(data)) return;
            if (!filterByShift && !isCareerJob && !includeApplicantForAllDays(data)) return;
            candidateUserIds.add(data.userId);
          });
          const userPromises = Array.from(candidateUserIds).map(async (userId): Promise<Worker | null> => {
            const userRef = doc(db, 'users', userId);
            const userSnap = await getDoc(userRef);
            if (userSnap.exists()) return mergePoolWorker(extractWorkerData(userSnap.data(), userId), userId);
            return null;
          });
          const users = await Promise.all(userPromises);
          workforceUsers = users.filter((u): u is Worker => u !== null);
        } else if (workforce === 'applicants') {
          // Non-Gig: applicants for this job order and selected shift
          const applicationDocs = applicationDocsBundle;
          const userIds = new Set<string>();
          applicationDocs.forEach(({ data }) => {
            if (!data.userId) return;
            if (data.candidate === true) return;
            if (isExcludedFromPlacementsApplicantPool(data.status)) return;
            if (!includeApplicantByShift(data)) return;
            userIds.add(data.userId);
          });
          const userPromises = Array.from(userIds).map(async (userId): Promise<Worker | null> => {
            const userRef = doc(db, 'users', userId);
            const userSnap = await getDoc(userRef);
            if (userSnap.exists()) return mergePoolWorker(extractWorkerData(userSnap.data(), userId), userId);
            return null;
          });
          const users = await Promise.all(userPromises);
          workforceUsers = users.filter((u): u is Worker => u !== null);
        } else if (workforce === 'candidates') {
          const applicationDocs = applicationDocsBundle;
          const candidateUserIds = new Set<string>();
          applicationDocs.forEach(({ data }) => {
            if (!data.userId || data.candidate !== true) return;
            if (isExcludedFromPlacementsApplicantPool(data.status)) return;
            if (!includeApplicantByShift(data)) return;
            candidateUserIds.add(data.userId);
          });
          const userPromises = Array.from(candidateUserIds).map(async (userId): Promise<Worker | null> => {
            const userRef = doc(db, 'users', userId);
            const userSnap = await getDoc(userRef);
            if (userSnap.exists()) return mergePoolWorker(extractWorkerData(userSnap.data(), userId), userId);
            return null;
          });
          const users = await Promise.all(userPromises);
          workforceUsers = users.filter((u): u is Worker => u !== null);
        } else if (selectedWorkforce.startsWith('group_')) {
          // Load users from selected group
          const groupId = selectedWorkforce.replace('group_', '');
          const groupRef = doc(db, 'tenants', tenantId, 'userGroups', groupId);
          const groupSnap = await getDoc(groupRef);
          
          if (groupSnap.exists()) {
            const groupData = groupSnap.data();
            const memberIds = groupData.memberIds || groupData.members || [];
            
            // Load user documents with full profile data
            const userPromises = memberIds.map(async (userId: string): Promise<Worker | null> => {
              const userRef = doc(db, 'users', userId);
              const userSnap = await getDoc(userRef);
              if (userSnap.exists()) {
                return extractWorkerData(userSnap.data(), userId);
              }
              return null;
            });
            
            const users = await Promise.all(userPromises);
            workforceUsers = users.filter((u): u is Worker => u !== null);
          }
        }
        
        // Assignment status is now applied from real-time shift listener below.
        setWorkers(workforceUsers);
      } catch (err: any) {
        console.error('Error loading workforce:', err);
        setError(err.message || 'Failed to load workforce');
      } finally {
        setLoading(false);
      }
    };

    loadWorkforce();
  }, [tenantId, jobOrderId, selectedWorkforce, selectedShiftId, selectedDay, jobOrder, connectedJobPostIds, shifts]);

  // Real-time assignment status map for the selected shift.
  useEffect(() => {
    if (!tenantId || !selectedShiftId) {
      setAssignmentRows([]);
      return;
    }

    // Drop previous shift's rows immediately so Assignments column / maps never mix shifts
    // while waiting for the new onSnapshot callback (fixes stale Tonya-on-wrong-shift UI).
    setAssignmentRows([]);
    setPendingAssignmentCancels(new Set());

    const toMs = (v: unknown): number | undefined => {
      if (v == null) return undefined;
      if (typeof v === 'number') return v;
      if (typeof v === 'object' && typeof (v as { toMillis?: () => number }).toMillis === 'function') return (v as { toMillis: () => number }).toMillis();
      if (typeof v === 'object' && typeof (v as { toDate?: () => Date }).toDate === 'function') return (v as { toDate: () => Date }).toDate().getTime();
      if (typeof v === 'string') { const n = Date.parse(v); return Number.isNaN(n) ? undefined : n; }
      return undefined;
    };

    const assignmentsRef = collection(db, 'tenants', tenantId, 'assignments');
    const assignmentsQuery = query(assignmentsRef, where('shiftId', '==', selectedShiftId));
    const unsubscribe = onSnapshot(
      assignmentsQuery,
      { includeMetadataChanges: true },
      (snapshot) => {
        const rows: AssignmentRow[] = [];
        snapshot.docs.forEach((docSnap) => {
          const data = docSnap.data() as any;
          const userId = String(data?.userId || data?.candidateId || '');
          const status = String(data?.status || 'proposed').toLowerCase();
          if (!userId) return;
          let startDate = '';
          const startDateVal = data?.startDate;
          if (typeof startDateVal === 'string' && startDateVal) startDate = startDateVal.split('T')[0];
          else if (startDateVal?.toDate) startDate = startDateVal.toDate().toISOString().split('T')[0];
          const reminderMs = toMs(data?.lastReminderSentAt);
          const assignedMs = toMs(data?.assignedAt);
          const offerSentAt = reminderMs ?? assignedMs;
          const confirmedAt = toMs(data?.confirmedAt);
          const predRaw = data?.noShowRiskPredictionV1;
          let noShowRiskPredictionV1: AssignmentRow['noShowRiskPredictionV1'];
          if (predRaw && typeof predRaw === 'object') {
            const pr = predRaw as Record<string, unknown>;
            noShowRiskPredictionV1 = {
              score: typeof pr.score === 'number' ? pr.score : undefined,
              band: typeof pr.band === 'string' ? pr.band : undefined,
              reasons: Array.isArray(pr.reasons) ? (pr.reasons as string[]) : undefined,
              recommendedAction: typeof pr.recommendedAction === 'string' ? pr.recommendedAction : undefined,
            };
          }
          rows.push({
            userId,
            assignmentId: docSnap.id,
            status,
            startDate,
            offerSentAt,
            confirmedAt,
            noShowRiskPredictionV1,
          });
        });
        setAssignmentRows(rows);
      },
      (err) => {
        console.warn('Assignments onSnapshot error:', err);
      },
    );

    return () => unsubscribe();
  }, [tenantId, selectedShiftId]);

  // Derive per-user assignment maps from rows. Only filter by selectedDay when this is a multi-day gig;
  // otherwise a stale selectedDay (e.g. from persistence) would wrongly filter single-day shifts.
  const {
    assignmentStatusByUserId,
    assignmentIdByUserId,
    assignmentStartDateByUserId,
    assignmentOfferSentAtByUserId,
    assignmentConfirmedAtByUserId,
    assignmentNoShowRiskByUserId,
  } = useMemo(() => {
    const selectedShift = shifts.find((s) => s.id === selectedShiftId);
    const isMultiDay =
      selectedShift &&
      (selectedShift as any).dateSchedule &&
      (selectedShift as any).endDate &&
      (selectedShift as any).endDate !== (selectedShift as any).shiftDate;
    const filtered =
      isMultiDay && selectedDay
        ? assignmentRows.filter((r) => assignmentMatchesSelectedDay(r, selectedDay, true))
        : assignmentRows;
    const statusByUser = new Map<string, string>();
    const idByUser = new Map<string, string>();
    const startDateByUser = new Map<string, string>();
    const offerSentAtByUser = new Map<string, number>();
    const confirmedAtByUser = new Map<string, number>();
    const noShowByUser = new Map<
      string,
      { band: string; score: number; reasons: string[]; recommendedAction: string }
    >();
    filtered.forEach((r) => {
      if (statusByUser.has(r.userId)) return;
      statusByUser.set(r.userId, r.status);
      idByUser.set(r.userId, r.assignmentId);
      if (r.startDate) startDateByUser.set(r.userId, r.startDate);
      if (r.offerSentAt != null) offerSentAtByUser.set(r.userId, r.offerSentAt);
      if (r.confirmedAt != null) confirmedAtByUser.set(r.userId, r.confirmedAt);
      const p = r.noShowRiskPredictionV1;
      if (
        p &&
        typeof p.score === 'number' &&
        typeof p.band === 'string' &&
        !noShowByUser.has(r.userId)
      ) {
        noShowByUser.set(r.userId, {
          band: p.band,
          score: p.score,
          reasons: Array.isArray(p.reasons) ? p.reasons : [],
          recommendedAction: String(p.recommendedAction || ''),
        });
      }
    });
    return {
      assignmentStatusByUserId: statusByUser,
      assignmentIdByUserId: idByUser,
      assignmentStartDateByUserId: startDateByUser,
      assignmentOfferSentAtByUserId: offerSentAtByUser,
      assignmentConfirmedAtByUserId: confirmedAtByUser,
      assignmentNoShowRiskByUserId: noShowByUser,
    };
  }, [assignmentRows, selectedDay, shifts, selectedShiftId]);

  // Real-time placements (placed but not yet assigned - no Assignment created, no messages sent).
  useEffect(() => {
    if (!tenantId || !selectedShiftId) {
      setPlacementUserIds(new Set());
      return;
    }

    setPlacementUserIds(new Set());

    const placementsRef = collection(db, 'tenants', tenantId, 'placements');
    const placementsQuery = query(placementsRef, where('shiftId', '==', selectedShiftId));
    const unsubscribe = onSnapshot(
      placementsQuery,
      { includeMetadataChanges: true },
      (snapshot) => {
        const ids = new Set<string>();
        snapshot.docs.forEach((docSnap) => {
          const data = docSnap.data() as any;
          const userId = String(data?.userId || '');
          if (userId) {
            ids.add(userId);
            pendingPlacementAddsRef.current.delete(userId); // Confirmed by server
          }
        });
        // Merge in optimistically added IDs so we don't overwrite with stale snapshot (race with local write)
        pendingPlacementAddsRef.current.forEach((id) => ids.add(id));
        setPlacementUserIds(ids);
        // Clear pending cancels for workers now confirmed as placed by server
        setPendingAssignmentCancels((prev) => {
          if (prev.size === 0) return prev;
          const stillPending = new Set(prev);
          ids.forEach((id) => stillPending.delete(id));
          return stillPending.size === prev.size ? prev : stillPending;
        });
      },
      (err) => {
        console.warn('Placements onSnapshot error:', err);
      },
    );

    return () => unsubscribe();
  }, [tenantId, selectedShiftId]);

  // For Career jobs: listen to placements + assignments across all shifts so labor pool can exclude anyone already placed
  const allShiftsPlacedOrAssignedRef = useRef<Map<string, Set<string>>>(new Map());
  useEffect(() => {
    if (!tenantId || shifts.length === 0) {
      setAllShiftsPlacedOrAssignedUserIds(new Set());
      allShiftsPlacedOrAssignedRef.current = new Map();
      return;
    }
    const shiftIds = shifts.map((s) => s.id);
    const placementsRef = collection(db, 'tenants', tenantId, 'placements');
    const assignmentsRef = collection(db, 'tenants', tenantId, 'assignments');
    const chunkSize = 10;
    const unsubs: Array<() => void> = [];

    const mergeAndSet = () => {
      const combined = new Set<string>();
      allShiftsPlacedOrAssignedRef.current.forEach((s) => s.forEach((id) => combined.add(id)));
      setAllShiftsPlacedOrAssignedUserIds(combined);
    };

    for (let i = 0; i < shiftIds.length; i += chunkSize) {
      const chunk = shiftIds.slice(i, i + chunkSize);
      const placeKey = `placements-${i}`;
      const placeQ = query(placementsRef, where('shiftId', 'in', chunk));
      unsubs.push(
        onSnapshot(
          placeQ,
          (snap) => {
            const ids = new Set<string>();
            snap.docs.forEach((d) => {
              const uid = String((d.data() as { userId?: string })?.userId || '');
              if (uid) ids.add(uid);
            });
            allShiftsPlacedOrAssignedRef.current.set(placeKey, ids);
            mergeAndSet();
          },
          (err) => console.warn('Placements (all shifts) onSnapshot error:', err),
        ),
      );
      const assignKey = `assignments-${i}`;
      const assignQ = query(assignmentsRef, where('shiftId', 'in', chunk));
      unsubs.push(
        onSnapshot(
          assignQ,
          (snap) => {
            const ids = new Set<string>();
            snap.docs.forEach((d) => {
              const data = d.data() as { userId?: string; candidateId?: string };
              const uid = String(data?.userId || data?.candidateId || '');
              if (uid) ids.add(uid);
            });
            allShiftsPlacedOrAssignedRef.current.set(assignKey, ids);
            mergeAndSet();
          },
          (err) => console.warn('Assignments (all shifts) onSnapshot error:', err),
        ),
      );
    }

    return () => {
      unsubs.forEach((u) => u());
      allShiftsPlacedOrAssignedRef.current = new Map();
    };
  }, [tenantId, shifts]);

  // Assignments column shows all workers for this shift (placements + assignments), independent of Workforce selection
  const assignedUserIds = useMemo(() => {
    const ids = new Set<string>(placementUserIds);
    assignmentStatusByUserId.forEach((_, uid) => ids.add(uid));
    pendingAssignmentCancels.forEach((uid) => ids.add(uid));
    return ids;
  }, [placementUserIds, assignmentStatusByUserId, pendingAssignmentCancels]);

  // Load user docs for everyone in Assignments; clear list only when *shift* changes, not when workforce changes
  useEffect(() => {
    if (!selectedShiftId) {
      setAssignmentWorkersList([]);
      lastAssignmentShiftIdRef.current = null;
      return;
    }
    if (lastAssignmentShiftIdRef.current !== selectedShiftId) {
      setAssignmentWorkersList([]);
      lastAssignmentShiftIdRef.current = selectedShiftId;
    }
    if (assignedUserIds.size === 0) {
      return; // Keep current list when workforce changes; only refresh when we have ids for this shift
    }
    let cancelled = false;
    const load = async () => {
      const userIds = Array.from(assignedUserIds);
      const userPromises = userIds.map(async (userId): Promise<Worker | null> => {
        const userRef = doc(db, 'users', userId);
        const userSnap = await getDoc(userRef);
        if (!userSnap.exists() || cancelled) return null;
        const base = extractWorkerData(userSnap.data(), userId);
        const jf = placementJobFitByUserId.get(userId);
        const nsAssign = assignmentNoShowRiskByUserId.get(userId);
        const nsApp = placementAppNoShowRiskByUserId.get(userId);
        const placementNoShowRisk =
          nsAssign && typeof nsAssign.score === 'number' && nsAssign.band
            ? {
                band: nsAssign.band as PlacementApplicationNoShowRisk['band'],
                score: Math.round(nsAssign.score),
                source: 'assignment' as const,
              }
            : nsApp
              ? { ...nsApp, source: 'application' as const }
              : undefined;
        let withFit: Worker = base;
        if (jf !== undefined) withFit = { ...withFit, placementJobFitScore: jf };
        if (placementNoShowRisk) withFit = { ...withFit, placementNoShowRisk };
        const isPendingCancel = pendingAssignmentCancels.has(userId);
        const assignmentStatus = isPendingCancel ? undefined : assignmentStatusByUserId.get(userId);
        const hasPlacement = placementUserIds.has(userId);
        const hasAssignment = Boolean(assignmentStatus);
        const isPlacementOnly = hasPlacement && !hasAssignment;
        const confirmationStatus: 'accepted' | 'confirmed' | undefined =
          assignmentStatus && (assignmentStatus === 'confirmed' || assignmentStatus === 'active')
            ? 'confirmed'
            : assignmentStatus
              ? 'accepted'
              : undefined;
        return {
          ...withFit,
          isAssignedToShift: true,
          isPlacementOnly,
          assignmentStatus,
          assignmentId: assignmentIdByUserId.get(userId),
          confirmationStatus,
          assignmentStartDate: assignmentStartDateByUserId.get(userId),
          assignmentOfferSentAt: assignmentOfferSentAtByUserId.get(userId),
          assignmentConfirmedAt: assignmentConfirmedAtByUserId.get(userId),
        };
      });
      const list = await Promise.all(userPromises);
      if (cancelled) return;
      const valid = list.filter((w): w is Worker => w !== null);
      const statusRank = (w: Worker) =>
        w.confirmationStatus === 'confirmed' ? 2 : w.assignmentStatus ? 1 : 0;
      valid.sort((a, b) => {
        const aPlace = a.isPlacementOnly ? 0 : 1;
        const bPlace = b.isPlacementOnly ? 0 : 1;
        if (aPlace !== bPlace) return aPlace - bPlace;
        return statusRank(b) - statusRank(a);
      });
      setAssignmentWorkersList(valid);
      lastAssignmentShiftIdRef.current = selectedShiftId;
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [
    selectedShiftId,
    assignedUserIds,
    placementUserIds,
    assignmentStatusByUserId,
    assignmentIdByUserId,
    assignmentStartDateByUserId,
    assignmentOfferSentAtByUserId,
    assignmentConfirmedAtByUserId,
    pendingAssignmentCancels,
    placementJobFitByUserId,
    placementAppNoShowRiskByUserId,
    assignmentNoShowRiskByUserId,
  ]);

  const workforceOptions = useMemo(() => getWorkforceOptions(), [jobOrder, userGroups]);
  const safeSelectedShiftId = shifts.some((s) => s.id === selectedShiftId) ? selectedShiftId : '';
  // For Gig, map legacy persisted 'applicants'/'candidates' to shift_applicants/shift_candidates
  const normalizedWorkforce =
    String((jobOrder as any)?.jobType || '').toLowerCase() === 'gig' && selectedWorkforce === 'applicants'
      ? 'shift_applicants'
      : String((jobOrder as any)?.jobType || '').toLowerCase() === 'gig' && selectedWorkforce === 'candidates'
        ? 'shift_candidates'
        : selectedWorkforce;
  const safeSelectedWorkforce = workforceOptions.some((o) => o.value === normalizedWorkforce) ? normalizedWorkforce : (workforceOptions[0]?.value ?? '');

  // When workforce options change (e.g. job is Gig), sync selection if current value is no longer valid
  useEffect(() => {
    const valid = workforceOptions.some((o) => o.value === selectedWorkforce);
    if (!valid && workforceOptions.length > 0 && selectedWorkforce !== 'choose_group') {
      setSelectedWorkforce(workforceOptions[0].value);
    }
  }, [workforceOptions, selectedWorkforce]);

  const handleRemoveGroupFromWorkforce = async (groupValue: string) => {
    if (!groupValue.startsWith('group_') || !tenantId || !jobOrderId) return;
    const groupId = groupValue.replace('group_', '');
    try {
      const jobOrderRef = doc(db, 'tenants', tenantId, 'job_orders', jobOrderId);
      const job = jobOrder as any;
      const updates: Record<string, unknown> = { updatedAt: serverTimestamp() };
      if (job?.placementsLastGroup?.id === groupId) {
        updates.placementsLastGroup = null;
      }
      const laborPoolGroups = Array.isArray(job?.laborPoolGroups) ? job.laborPoolGroups.filter((id: string) => id !== groupId) : [];
      const restrictedGroups = Array.isArray(job?.restrictedGroups) ? job.restrictedGroups.filter((id: string) => id !== groupId) : [];
      if (laborPoolGroups.length !== (job?.laborPoolGroups?.length ?? 0)) updates.laborPoolGroups = laborPoolGroups;
      if (restrictedGroups.length !== (job?.restrictedGroups?.length ?? 0)) updates.restrictedGroups = restrictedGroups;
      await updateDoc(jobOrderRef, updates);
      if (selectedWorkforce === groupValue) setSelectedWorkforce('choose_group');
      onJobOrderUpdated?.();
    } catch (err) {
      console.error('Error removing group from workforce:', err);
      setError((err as Error)?.message ?? 'Failed to remove group');
    }
  };

  // Build workforce options. For Gigs: All Applicants, All Candidates, Shift Applicants, Shift Candidates, then groups.
  // For non-Gigs: Applicants, Candidates, then groups.
  function getWorkforceOptions() {
    const jobType = String((jobOrder as any)?.jobType || '').toLowerCase();
    const isGig = jobType === 'gig';

    const options: Array<{ value: string; label: string }> = isGig
      ? [
          { value: 'all_applicants', label: 'All Applicants' },
          { value: 'all_candidates', label: 'All Candidates' },
          { value: 'shift_applicants', label: 'Shift Applicants' },
          { value: 'shift_candidates', label: 'Shift Candidates' },
        ]
      : [
          { value: 'applicants', label: 'Applicants' },
          { value: 'candidates', label: 'Candidates' },
        ];

    // Add last group selected via "Choose Group" (stored on job order for quick re-select)
    const lastGroup = (jobOrder as any)?.placementsLastGroup;
    if (lastGroup?.id && lastGroup?.groupName) {
      const alreadyAdded = options.some((o) => o.value === `group_${lastGroup.id}`);
      if (!alreadyAdded) {
        options.push({
          value: `group_${lastGroup.id}`,
          label: lastGroup.groupName,
        });
      }
    }
    
    // Get labor pool groups from job order (preferred)
    const laborPoolGroups = (jobOrder as any)?.laborPoolGroups || [];
    const visibility = jobOrder?.visibility || (jobOrder as any)?.jobsBoardVisibility;
    const restrictedGroups = jobOrder?.restrictedGroups || [];
    const allGroupIds = new Set<string>([
      ...laborPoolGroups,
      ...(visibility === 'group_restricted' ? restrictedGroups : []),
    ]);
    
    // Add labor pool groups not already in options
      allGroupIds.forEach((groupId: string) => {
      if (options.some((o) => o.value === `group_${groupId}`)) return;
      const group = userGroups.find((g) => g.id === groupId);
        if (group) {
        options.push({ value: `group_${groupId}`, label: group.groupName });
        }
      });
    
    options.push({ value: 'choose_group', label: 'Choose Group' });
    return options;
  }

  const assignWorkersToShift = async (workerIds: string[], dayOverride?: string) => {
    if (!selectedShift || !tenantId || !jobOrderId || workerIds.length === 0) {
      setError('Missing required information to assign shift');
      return;
    }

    try {
      setError(null);
      // Use explicit day override (e.g. from Placed chip) so the correct day is used even if state updates
      const effectiveDay = dayOverride !== undefined ? dayOverride : selectedDay;
      const jobTypeForAssign = String((jobOrder as any)?.jobType || '').toLowerCase();
      const isGigMultiDayForAssign =
        jobTypeForAssign === 'gig' &&
        selectedShift &&
        (selectedShift as any).dateSchedule &&
        (selectedShift as any).endDate &&
        (selectedShift as any).endDate !== (selectedShift as any).shiftDate;
      // When a specific day is selected, create assignment for that day only (never send applyDates).
      const useSingleDay = Boolean(isIsoGigDay(effectiveDay));
      const bulkDates =
        !useSingleDay && !effectiveDay && isGigMultiDayForAssign && selectedShift
          ? getDateScheduleEntriesWithHours(
              (selectedShift as any).dateSchedule,
              (selectedShift as any).shiftDate,
              (selectedShift as any).endDate,
            ).map((d) => d.date)
          : [];
      const payload: Record<string, unknown> = {
        tenantId,
        jobOrderId,
        shiftId: selectedShift.id,
        userIds: workerIds,
        sourceType: selectedWorkforce || 'manual',
        sourceId: selectedWorkforce.startsWith('group_') ? selectedWorkforce.replace('group_', '') : null,
      };
      if (useSingleDay) {
        payload.applyDate = effectiveDay;
      } else if (bulkDates.length > 0) {
        payload.applyDates = bulkDates;
      }
      const assignFn = httpsCallable(functions, 'placementsCreateAssignments');
      const response = await assignFn(payload);

      const data = response.data as any;
      const created = Array.isArray(data?.created) ? data.created : [];
      const createdCount = created.length;
      const skipped = Array.isArray(data?.skipped) ? data.skipped : [];

      if (createdCount === 0 && skipped.length > 0) {
        setError(`No assignments created. ${skipped.map((s: any) => s.reason).join(', ')}`);
      } else {
        setError(null);
        created.forEach((entry: { userId: string; assignmentId: string }) => {
          if (entry?.userId && entry?.assignmentId) {
            logAssignmentUpdateActivity(entry.userId, entry.assignmentId, 'placed').catch((e) =>
              console.warn('Failed to log assignment placed activity:', e)
            );
          }
        });
      }
    } catch (err: any) {
      console.error('Error assigning workers to shift:', err);
      setError(err?.message || 'Failed to assign worker(s) to shift');
    }
  };

  // Handle assign to shift (create new assignment from pool). Pass selected day when set.
  const handleAssignToShift = async (worker: Worker, shift: Shift | undefined) => {
    if (!shift || !worker.id) return;
    await assignWorkersToShift([worker.id], selectedDay || undefined);
  };

  // Handle offering position: create Assignment (sends accept/decline message). Pass selected day so
  // assignment is for that day only when a day is selected; for "All days" we send all dates.
  const handleConfirmPlacement = async (worker: Worker) => {
    if (!worker.isPlacementOnly || !selectedShift) return;
    if (confirmingPlacementUserId) return;
    setConfirmingPlacementUserId(worker.id);
    try {
      setError(null);
      await assignWorkersToShift([worker.id], selectedDay || undefined);
      if (selectedDay === '') {
        await deletePlacement(worker);
      }
    } catch (err: any) {
      console.error('Error offering position:', err);
      setError(err?.message || 'Failed to offer position');
    } finally {
      setConfirmingPlacementUserId(null);
    }
  };

  // Cancel assignment(s). When "All days" selected, cancel all assignments for this user on this shift.
  const handleCancelAssignment = async (worker: Worker) => {
    if (worker.isPlacementOnly || !selectedShiftId || !jobOrderId) return;
    const assignmentIds =
      selectedDay === ''
        ? assignmentRows.filter((r) => r.userId === worker.id).map((r) => r.assignmentId)
        : worker.assignmentId
          ? [worker.assignmentId]
          : [];
    if (assignmentIds.length === 0) return;
    setCancelAssignmentWorker(null);
    try {
      setError(null);
      setPendingAssignmentCancels((prev) => new Set([...prev, worker.id]));
      const cancelFn = httpsCallable(functions, 'placementsCancelAssignment');
      await Promise.all(
        assignmentIds.map((assignmentId) =>
          cancelFn({ tenantId, assignmentId, shiftId: selectedShiftId, userId: worker.id }),
        ),
      );
    } catch (err: any) {
      console.error('Error cancelling assignment:', err);
      setError(err?.message || 'Failed to cancel assignment');
      setPendingAssignmentCancels((prev) => {
        const next = new Set(prev);
        next.delete(worker.id);
        return next;
      });
    }
  };

  const RESEND_COOLDOWN_MS = 15000;
  const handleResendOffer = async (worker: Worker) => {
    if (!worker.assignmentId || !tenantId) return;
    const aid = worker.assignmentId;
    if (resendLoadingAssignmentId === aid) return;
    const cooldownUntil = resendCooldownUntilByAssignmentId[aid] ?? 0;
    if (Date.now() < cooldownUntil) return;
    try {
      setResendLoadingAssignmentId(aid);
      setError(null);
      const resendFn = httpsCallable(functions, 'resendAssignmentOffer');
      await resendFn({ tenantId, assignmentId: aid });
      setResendCooldownUntilByAssignmentId((prev) => ({ ...prev, [aid]: Date.now() + RESEND_COOLDOWN_MS }));
    } catch (err: any) {
      console.error('Error resending offer:', err);
      setError(err?.message || 'Failed to resend offer');
    } finally {
      setResendLoadingAssignmentId(null);
    }
  };

  /** Manually confirm assignment(s) on behalf of the worker. When "All days", confirm all their assignments for this shift. */
  const handleConfirmForWorker = async (worker: Worker) => {
    if (!tenantId) return;
    const assignmentIds =
      selectedDay === ''
        ? assignmentRows.filter((r) => r.userId === worker.id).map((r) => r.assignmentId)
        : worker.assignmentId
          ? [worker.assignmentId]
          : [];
    if (assignmentIds.length === 0) return;
    if (confirmLoadingAssignmentId === worker.id) return;
    try {
      setConfirmLoadingAssignmentId(worker.id);
      setError(null);
      const confirmFn = httpsCallable(functions, 'confirmAssignmentForWorker');
      await Promise.all(assignmentIds.map((aid) => confirmFn({ tenantId, assignmentId: aid })));
    } catch (err: any) {
      console.error('Error confirming assignment:', err);
      setError(err?.message || 'Failed to confirm assignment');
    } finally {
      setConfirmLoadingAssignmentId(null);
    }
  };

  const selectedShift = shifts.find(s => s.id === selectedShiftId);
  const jobType = String((jobOrder as any)?.jobType || '').toLowerCase();
  const isGigMultiDay =
    jobType === 'gig' &&
    selectedShift &&
    (selectedShift as any).dateSchedule &&
    (selectedShift as any).endDate &&
    (selectedShift as any).endDate !== (selectedShift as any).shiftDate;
  const dayOptions = useMemo(() => {
    if (!isGigMultiDay || !selectedShift) return [];
    return getDateScheduleEntriesWithHours(
      (selectedShift as any).dateSchedule,
      (selectedShift as any).shiftDate,
      (selectedShift as any).endDate,
    );
  }, [isGigMultiDay, selectedShift]);
  useEffect(() => {
    if (dayOptions.length === 0) {
      if (selectedDay) setSelectedDay('');
      return;
    }
    if (!selectedDay) return;
    const valid = dayOptions.some((d) => d.date === selectedDay);
    if (!valid) setSelectedDay('');
  }, [selectedShiftId, selectedDay, dayOptions]);
  const showContent = true; // Grid always visible; Workforce selector is in Worker Pool card, Shift selector is in Shift Details card
  // Assignments column: workers placed/assigned for this shift. When a specific day is selected (multi-day gig), show only that day.
  const assignedWorkers = assignmentWorkersList;
  // Exclude cancelled. For multi-day gig: when a specific day is selected, show placement-only + assigned for that day.
  // When "All Days" is selected, show everyone on this shift (placed-only or any assignment row). Filtering to
  // placement-only only here made workers vanish as soon as an assignment was created (Offer / Accept).
  const displayedAssignedWorkers = useMemo(() => {
    const notCancelled = assignedWorkers.filter(
      (w) => w.assignmentStatus !== 'cancelled' && w.assignmentStatus !== 'canceled',
    );
    if (isGigMultiDay && selectedDay) {
      return notCancelled.filter(
        (w) => w.isPlacementOnly || w.assignmentStartDate === selectedDay,
      );
    }
    if (isGigMultiDay && !selectedDay) {
      return notCancelled;
    }
    return notCancelled;
  }, [assignedWorkers, isGigMultiDay, selectedDay]);
  const placedOnlyWorkers = useMemo(
    () => assignedWorkers.filter((w) => w.isPlacementOnly),
    [assignedWorkers],
  );
  const [, setAssignAllBusy] = useState(false); // kept for compatibility (Assign All button removed; bulk Accept does the same)

  // Selection and bulk messaging for assignees (same pattern as Applications tab)
  const [selectedAssignmentWorkerIds, setSelectedAssignmentWorkerIds] = useState<Set<string>>(new Set());
  const [bulkDrawerOpen, setBulkDrawerOpen] = useState(false);
  const [bulkDrawerChannel, setBulkDrawerChannel] = useState<'email' | 'sms'>('email');
  const [bulkAcceptBusy, setBulkAcceptBusy] = useState(false);
  const [bulkCancelBusy, setBulkCancelBusy] = useState(false);
  const isAllAssignmentsSelected =
    displayedAssignedWorkers.length > 0 &&
    selectedAssignmentWorkerIds.size === displayedAssignedWorkers.length;
  const isSomeAssignmentsSelected = selectedAssignmentWorkerIds.size > 0;
  const handleSelectAllAssignments = () => {
    if (isAllAssignmentsSelected) {
      setSelectedAssignmentWorkerIds(new Set());
    } else {
      setSelectedAssignmentWorkerIds(new Set(displayedAssignedWorkers.map((w) => w.id)));
    }
  };
  const handleSelectOneAssignment = (workerId: string) => {
    setSelectedAssignmentWorkerIds((prev) => {
      const next = new Set(prev);
      if (next.has(workerId)) next.delete(workerId);
      else next.add(workerId);
      return next;
    });
  };
  const bulkAssignmentRecipients = useMemo(() => {
    const selected = displayedAssignedWorkers.filter((w) =>
      selectedAssignmentWorkerIds.has(w.id),
    );
    const recipients: MessageRecipient[] = selected.map((w) => ({
      userId: w.id,
      name: w.displayName || [w.firstName, w.lastName].filter(Boolean).join(' ').trim() || w.id,
      email: w.email,
      phone: w.phone,
    }));
    const recipientUserIds = selected.map((w) => w.id);
    return { recipients, recipientUserIds };
  }, [displayedAssignedWorkers, selectedAssignmentWorkerIds]);

  /** Bulk Accept: send offer (create assignment + send accept/decline message) for all selected workers who are Placed only. */
  const handleBulkAccept = async () => {
    const selected = displayedAssignedWorkers.filter((w) => selectedAssignmentWorkerIds.has(w.id));
    const placedOnly = selected.filter((w) => w.isPlacementOnly);
    if (placedOnly.length === 0 || !selectedShift) return;
    setBulkAcceptBusy(true);
    try {
      setError(null);
      await assignWorkersToShift(placedOnly.map((w) => w.id), selectedDay || undefined);
      if (selectedDay === '') {
        for (const worker of placedOnly) {
          await deletePlacement(worker);
        }
      }
      setSelectedAssignmentWorkerIds((prev) => {
        const next = new Set(prev);
        placedOnly.forEach((w) => next.delete(w.id));
        return next;
      });
    } catch (err: any) {
      console.error('Error bulk offering position:', err);
      setError(err?.message || 'Failed to send offer to selected');
    } finally {
      setBulkAcceptBusy(false);
    }
  };

  /** Bulk Cancel: cancel assignment (red X) for all selected workers who have an assignment. */
  const handleBulkCancel = async () => {
    const selected = displayedAssignedWorkers.filter((w) => selectedAssignmentWorkerIds.has(w.id));
    const withAssignment = selected.filter((w) => !w.isPlacementOnly && w.assignmentId);
    if (withAssignment.length === 0 || !selectedShiftId || !jobOrderId) return;
    setBulkCancelBusy(true);
    try {
      setError(null);
      setPendingAssignmentCancels((prev) => new Set([...prev, ...withAssignment.map((w) => w.id)]));
      const cancelFn = httpsCallable(functions, 'placementsCancelAssignment');
      for (const worker of withAssignment) {
        await cancelFn({
          tenantId,
          assignmentId: worker.assignmentId,
          shiftId: selectedShiftId,
          userId: worker.id,
        });
      }
      setSelectedAssignmentWorkerIds((prev) => {
        const next = new Set(prev);
        withAssignment.forEach((w) => next.delete(w.id));
        return next;
      });
    } catch (err: any) {
      console.error('Error bulk cancelling assignments:', err);
      setError(err?.message || 'Failed to cancel selected');
      setPendingAssignmentCancels((prev) => {
        const next = new Set(prev);
        withAssignment.forEach((w) => next.delete(w.id));
        return next;
      });
    } finally {
      setBulkCancelBusy(false);
    }
  };

  // --- Multi-day gig: day picker filters assignment maps + displayed rows; "All Days" shows full shift roster. ---
  // Assignment maps are filtered by selectedDay only when isGigMultiDay (so single-day shifts show all rows). displayedAssignedWorkers
  // shows placement-only + assignments for selected day, or everyone on shift when All Days. poolExcludeIds = placed/assigned for selected day, so availableWorkers
  // = workforce minus that set. Drag/drop and Offer use selectedDay (applyDate) when set.
  // Worker Pool: exclude anyone placed or assigned for the selected day (so they don't appear for drag-and-drop again).
  // Career: exclude anyone placed/assigned on any shift. Gig/other: exclude only placed/assigned for the selected day.
  const jobTypeForPool = String((jobOrder as any)?.jobType || '').toLowerCase();
  const isCareerForPool = jobTypeForPool === 'career';
  const poolExcludeIds = useMemo(() => {
    if (isCareerForPool && (safeSelectedWorkforce === 'applicants' || safeSelectedWorkforce === 'candidates')) {
      return allShiftsPlacedOrAssignedUserIds;
    }
    // Gig/other: assignedUserIds = placementUserIds + (assignment user IDs for selected day when selectedDay set) + pending; excludes from pool anyone "placed for the selected day"
    return assignedUserIds;
  }, [isCareerForPool, safeSelectedWorkforce, allShiftsPlacedOrAssignedUserIds, assignedUserIds]);
  const availableWorkers = useMemo(
    () => workers.filter((w) => !poolExcludeIds.has(w.id)),
    [workers, poolExcludeIds],
  );
  const staffingTarget = useMemo(() => {
    if (!selectedShift) return null;
    const value =
      (selectedShift as any).staffNeeded ??
      (selectedShift as any).totalStaffRequested ??
      (selectedShift as any).workersNeeded;
    return value === undefined || value === null ? null : Number(value);
  }, [selectedShift]);
  const staffingFilled = useMemo(
    () => assignedWorkers.filter((w) => w.confirmationStatus === 'confirmed').length,
    [assignedWorkers],
  );

  // Shift start date for display (YYYY-MM-DD in recruiter's local timezone for same-day comparison)
  const shiftStartDateStr = useMemo(() => {
    if (!selectedShift) return '';
    return getCalendarDayLocal((selectedShift as any).shiftDate);
  }, [selectedShift]);

  // Same-day shift IDs (other shifts on the same calendar day as the selected shift) for double-book protection.
  // Uses recruiter's local timezone so "same day" is consistent (e.g. Saturday 10 PM and Saturday 2 PM are same day).
  const getShiftDateStr = (shift: Shift | undefined) => {
    if (!shift) return '';
    return getCalendarDayLocal((shift as any).shiftDate);
  };
  const sameDayShiftIds = useMemo(() => {
    if (!shiftStartDateStr || !selectedShiftId) return [];
    return shifts
      .filter((s) => s.id !== selectedShiftId && getShiftDateStr(s) === shiftStartDateStr)
      .map((s) => s.id);
  }, [shifts, selectedShiftId, shiftStartDateStr]);

  // Map: userId -> list of { shiftId, shiftTitle, type } for same-day placements/assignments (double-book warning)
  const [sameDayConflictByUserId, setSameDayConflictByUserId] = useState<Map<string, Array<{ shiftId: string; shiftTitle: string; type: 'placement' | 'assigned' | 'confirmed' }>>>(new Map());
  useEffect(() => {
    if (!tenantId || !jobOrderId || sameDayShiftIds.length === 0) {
      setSameDayConflictByUserId(new Map());
      return;
    }
    let cancelled = false;
    const run = async () => {
      const conflicts = new Map<string, Array<{ shiftId: string; shiftTitle: string; type: 'placement' | 'assigned' | 'confirmed' }>>();
      const shiftTitleById = new Map<string, string>(shifts.map((s) => [s.id, (s as any).shiftTitle || s.shiftTitle || 'Shift']));

      const placementsRef = collection(db, 'tenants', tenantId, 'placements');
      const placementsQuery = query(
        placementsRef,
        where('jobOrderId', '==', jobOrderId),
        where('shiftId', 'in', sameDayShiftIds.slice(0, 30)),
      );
      const placementsSnap = await getDocs(placementsQuery);
      placementsSnap.docs.forEach((d) => {
        const data = d.data() as { userId?: string; shiftId?: string };
        const uid = data?.userId;
        const shiftId = data?.shiftId;
        if (!uid || !shiftId) return;
        const list = conflicts.get(uid) ?? [];
        list.push({ shiftId, shiftTitle: shiftTitleById.get(shiftId) ?? 'Shift', type: 'placement' });
        conflicts.set(uid, list);
      });

      const assignmentsRef = collection(db, 'tenants', tenantId, 'assignments');
      const assignmentQueries = sameDayShiftIds.slice(0, 30).map((shiftId) =>
        query(
          assignmentsRef,
          where('shiftId', '==', shiftId),
          where('status', 'in', ['proposed', 'confirmed', 'active']),
        ),
      );
      const assignmentSnaps = await Promise.all(assignmentQueries.map((q) => getDocs(q)));
      assignmentSnaps.forEach((snap, idx) => {
        const shiftId = sameDayShiftIds[idx];
        const shiftTitle = shiftTitleById.get(shiftId) ?? 'Shift';
        snap.docs.forEach((d) => {
          const data = d.data() as { userId?: string; candidateId?: string; status?: string };
          const uid = data?.userId || data?.candidateId;
          if (!uid) return;
          const status = (data?.status || '').toLowerCase();
          const type: 'placement' | 'assigned' | 'confirmed' = status === 'confirmed' || status === 'active' ? 'confirmed' : 'assigned';
          const list = conflicts.get(uid) ?? [];
          if (!list.some((x) => x.shiftId === shiftId)) list.push({ shiftId, shiftTitle, type });
          conflicts.set(uid, list);
        });
      });

      if (!cancelled) setSameDayConflictByUserId(conflicts);
    };
    run();
    return () => { cancelled = true; };
  }, [tenantId, jobOrderId, sameDayShiftIds, shifts]);

  const formatDateDisplay = (yyyyMmDd: string) => {
    if (!yyyyMmDd) return '';
    const d = new Date(yyyyMmDd + 'T12:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  };

  const handleExportAssignmentsCsv = () => {
    if (!selectedShift || displayedAssignedWorkers.length === 0) return;
    const shift = selectedShift as any;
    const job = jobOrder as any;
    const shiftName = shift.shiftTitle ?? 'Shift';
    const shiftDateStr = shiftStartDateStr || getShiftDateStr(selectedShift);
    const shiftStartTime = shift.defaultStartTime ?? shift.startTime ?? '';
    const jobTitle = shift.defaultJobTitle ?? shift.jobTitle ?? job?.jobTitle ?? '';
    const payRate =
      shift.payRate != null
        ? String(shift.payRate)
        : job?.payRate != null
          ? String(job.payRate)
          : '';
    const worksiteNickname = job?.worksiteName ?? '';
    const addr = job?.worksiteAddress;
    const worksiteAddress = addr
      ? [addr.street, addr.city, addr.state, addr.zipCode ?? addr.zip]
        .filter(Boolean)
        .join(', ')
      : '';

    const escapeCsv = (v: string) => {
      const s = String(v ?? '').replace(/"/g, '""');
      return /[",\r\n]/.test(s) ? `"${s}"` : s;
    };

    const header = [
      'firstName',
      'lastName',
      'email',
      'phone',
      'shift name',
      'shift start date',
      'shift start time',
      'job title',
      'pay rate',
      'worksite location nickname',
      'worksite location address',
    ];
    const rows = displayedAssignedWorkers.map((w) => [
      escapeCsv(w.firstName),
      escapeCsv(w.lastName),
      escapeCsv(w.email ?? ''),
      escapeCsv(w.phone ?? ''),
      escapeCsv(shiftName),
      escapeCsv(shiftDateStr),
      escapeCsv(shiftStartTime),
      escapeCsv(jobTitle),
      escapeCsv(payRate),
      escapeCsv(worksiteNickname),
      escapeCsv(worksiteAddress),
    ]);
    const csv = [header.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `assignments-${shiftDateStr || 'export'}-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handlePreviewEmail = async () => {
    const firstWithAssignment = displayedAssignedWorkers.find((w) => assignmentIdByUserId.get(w.id));
    const assignmentId = firstWithAssignment ? assignmentIdByUserId.get(firstWithAssignment.id) : null;
    if (!tenantId || !assignmentId) {
      setPreviewEmailError('Add at least one assignment (place a worker and click "Offer position") to preview the confirmation email.');
      setPreviewEmailOpen(true);
      setPreviewEmailSubject('');
      setPreviewEmailHtml('');
      return;
    }
    setPreviewEmailError(null);
    setPreviewEmailLoading(true);
    setPreviewEmailOpen(true);
    setPreviewEmailSubject('');
    setPreviewEmailHtml('');
    try {
      const preview = httpsCallable<{ tenantId: string; assignmentId: string }, { subject: string; html: string }>(
        functions,
        'previewAssignmentDetailsEmail'
      );
      const { data } = await preview({ tenantId, assignmentId });
      setPreviewEmailSubject(data.subject ?? '');
      setPreviewEmailHtml(data.html ?? '');
    } catch (err: any) {
      setPreviewEmailError(err?.message ?? 'Failed to load email preview.');
    } finally {
      setPreviewEmailLoading(false);
    }
  };

  const [editStartDateWorker, setEditStartDateWorker] = useState<Worker | null>(null);
  const [editStartDateValue, setEditStartDateValue] = useState('');
  const [editStartDateSaving, setEditStartDateSaving] = useState(false);
  const handleOpenEditStartDate = (worker: Worker) => {
    const current = worker.assignmentStartDate || shiftStartDateStr || '';
    setEditStartDateWorker(worker);
    setEditStartDateValue(current || '');
  };
  const handleSaveStartDate = async () => {
    if (!editStartDateWorker?.assignmentId || !tenantId || !editStartDateValue.trim()) {
      setEditStartDateWorker(null);
      return;
    }
    setEditStartDateSaving(true);
    try {
      const assignmentRef = doc(db, 'tenants', tenantId, 'assignments', editStartDateWorker.assignmentId);
      await updateDoc(assignmentRef, {
        startDate: editStartDateValue.trim().split('T')[0],
        updatedAt: serverTimestamp(),
      });
      setEditStartDateWorker(null);
    } catch (err: any) {
      console.error('Error updating assignment start date:', err);
      setError(err?.message ?? 'Failed to update start date');
    } finally {
      setEditStartDateSaving(false);
    }
  };

  const handleWorkerDragStart = (event: React.DragEvent, workerId: string) => {
    event.dataTransfer.setData(WORKER_DRAG_MIME, workerId);
    // Keep plain text for browser compatibility, but we only read the custom MIME on drop.
    event.dataTransfer.setData('text/plain', workerId);
    event.dataTransfer.effectAllowed = 'move';
  };

  const handleAssignmentsDragOver = (event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    setIsAssignmentDragOver(true);
  };

  const [doubleBookConfirmWorker, setDoubleBookConfirmWorker] = useState<Worker | null>(null);

  const handleAssignmentsDrop = (event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setIsAssignmentDragOver(false);
    const workerId = event.dataTransfer.getData(WORKER_DRAG_MIME) || event.dataTransfer.getData('text/plain');
    if (!workerId) return;
    const worker = availableWorkers.find((w) => w.id === workerId);
    if (worker) {
      tryPlaceWorker(worker);
    }
  };

  const tryPlaceWorker = (worker: Worker) => {
    const conflicts = sameDayConflictByUserId.get(worker.id);
    if (conflicts && conflicts.length > 0) {
      setDoubleBookConfirmWorker(worker);
      return;
    }
    createPlacement(worker);
  };

  const createPlacement = async (worker: Worker) => {
    if (!tenantId || !selectedShiftId || !jobOrderId || !user?.uid) {
      setError('Missing required information to place worker');
      return;
    }
    setDoubleBookConfirmWorker(null);
    const placementId = `${selectedShiftId}__${worker.id}`;
    try {
      setError(null);
      pendingPlacementAddsRef.current.add(worker.id);
      setPlacementUserIds((prev) => new Set([...prev, worker.id]));
      const placementRef = doc(db, 'tenants', tenantId, 'placements', placementId);
      await setDoc(placementRef, {
        tenantId,
        jobOrderId,
        shiftId: selectedShiftId,
        userId: worker.id,
        createdBy: user.uid,
        createdAt: serverTimestamp(),
      });
    } catch (err: any) {
      console.error('Error placing worker:', err);
      setError(err?.message || 'Failed to place worker');
      pendingPlacementAddsRef.current.delete(worker.id);
      setPlacementUserIds((prev) => {
        const next = new Set(prev);
        next.delete(worker.id);
        return next;
      });
    }
  };

  const deletePlacement = async (worker: Worker) => {
    if (!tenantId || !selectedShiftId) return;
    if (!worker.isPlacementOnly) return;
    const placementId = `${selectedShiftId}__${worker.id}`;
    try {
      setError(null);
      // Optimistic update: remove from Assignments immediately
      setPlacementUserIds((prev) => {
        const next = new Set(prev);
        next.delete(worker.id);
        return next;
      });
      const placementRef = doc(db, 'tenants', tenantId, 'placements', placementId);
      await deleteDoc(placementRef);
    } catch (err: any) {
      console.error('Error removing placement:', err);
      setError(err?.message || 'Failed to remove placement');
      // Revert optimistic update on error
      setPlacementUserIds((prev) => new Set([...prev, worker.id]));
    }
  };

  const handleUnplaceToWorkerPool = async (worker: Worker) => {
    if (!worker.isPlacementOnly) return;
    await deletePlacement(worker);
  };

  const handleWorkerPoolDragOver = (event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    setIsWorkerPoolDragOver(true);
  };

  const handleWorkerPoolDrop = (event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setIsWorkerPoolDragOver(false);
    const workerId = event.dataTransfer.getData(WORKER_DRAG_MIME) || event.dataTransfer.getData('text/plain');
    if (!workerId) return;
    const assignedWorker = assignedWorkers.find((w) => w.id === workerId);
    if (assignedWorker) {
      handleUnplaceToWorkerPool(assignedWorker);
    }
  };

  // Guard against browser default drop navigation (e.g. cid:, mailto:, file:).
  useEffect(() => {
    const preventWindowDropNavigation = (event: DragEvent) => {
      event.preventDefault();
    };
    window.addEventListener('dragover', preventWindowDropNavigation);
    window.addEventListener('drop', preventWindowDropNavigation);
    return () => {
      window.removeEventListener('dragover', preventWindowDropNavigation);
      window.removeEventListener('drop', preventWindowDropNavigation);
    };
  }, []);

  return (
    <Box
      onDragOverCapture={(event) => {
        // Prevent browser default drop navigation (e.g., cid: URLs).
        event.preventDefault();
      }}
      onDropCapture={(event) => {
        // Keep drops in-app and avoid page-level navigation.
        event.preventDefault();
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          mb: 2,
          width: '100%',
          flexWrap: { xs: 'wrap', sm: 'nowrap' },
        }}
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 3,
            flexWrap: 'wrap',
            flex: '1 1 auto',
            minWidth: 0,
          }}
        >
          {showContent && shifts.length > 0 && (
            <FormControl size="small" sx={{ minWidth: 280 }}>
              <InputLabel>Shift</InputLabel>
              <Select
                value={safeSelectedShiftId}
                label="Shift"
                onChange={(e) => setSelectedShiftId(e.target.value)}
                disabled={loading}
                renderValue={(value) => {
                  if (!value) {
                    return <em>Select shift</em>;
                  }
                  const shift = shifts.find((s) => s.id === value);
                  if (!shift) return '';
                  return (
                    <Box sx={{ lineHeight: 1.25, textAlign: 'left' }}>
                      <Typography variant="body2" component="span" display="block">
                        {shift.shiftTitle || 'Shift'}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" component="span" display="block">
                        {buildShiftPickerSecondLine(shift, (jobOrder as any)?.jobTitle)}
                      </Typography>
                    </Box>
                  );
                }}
              >
                <MenuItem value="">
                  <em>Select shift</em>
                </MenuItem>
                {shifts.map((shift) => (
                  <MenuItem key={shift.id} value={shift.id}>
                    <Box>
                      <Typography variant="body2">{shift.shiftTitle || 'Shift'}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {buildShiftPickerSecondLine(shift, (jobOrder as any)?.jobTitle)}
                      </Typography>
                    </Box>
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}
          {isGigMultiDay && dayOptions.length > 0 && (
            <FormControl size="small" sx={{ minWidth: 200 }}>
              <InputLabel>Day</InputLabel>
              <Select
                value={selectedDay || '__all__'}
                label="Day"
                onChange={(e) => setSelectedDay(e.target.value === '__all__' ? '' : e.target.value)}
                disabled={loading}
                renderValue={(v) => (v === '__all__' || !v ? 'All days' : dayOptions.find((d) => d.date === v)?.dayLabel ?? v)}
              >
                <MenuItem value="__all__">
                  <em>All days</em>
                </MenuItem>
                {dayOptions.map((opt) => (
                  <MenuItem key={opt.date} value={opt.date}>
                    {opt.dayLabel}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}
          {selectedShift && !(isGigMultiDay && selectedDay === '') && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
              {(() => {
                const dayEntry = selectedDay && dayOptions.length > 0 ? dayOptions.find((d) => d.date === selectedDay) : null;
                const startTime =
                  dayEntry?.startTime ?? (selectedShift as any).defaultStartTime ?? (selectedShift as any).startTime ?? '';
                const endTime =
                  dayEntry?.endTime ?? (selectedShift as any).defaultEndTime ?? (selectedShift as any).endTime ?? '';
                const formatTimeStr = (t: string) => {
                  if (!t) return '';
                  const m = t.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
                  if (!m) return t;
                  const hour = parseInt(m[1], 10);
                  const min = m[2];
                  if (m[3]) return `${hour}:${min} ${m[3]}`;
                  const ampm = hour >= 12 ? 'PM' : 'AM';
                  const displayHour = hour % 12 || 12;
                  return `${displayHour}:${min} ${ampm}`;
                };
                const staffReq =
                  dayEntry?.workersNeeded !== undefined
                    ? dayEntry.workersNeeded
                    : (selectedShift as any).totalStaffRequested ?? (selectedShift as any).staffNeeded ?? (selectedShift as any).workersNeeded;
                const overstaff =
                  dayEntry?.overstaff ?? (selectedShift as any).overstaffCount ?? (selectedShift as any).overstaff ?? 0;
                const scheduleStr = startTime && endTime ? `${formatTimeStr(startTime)} – ${formatTimeStr(endTime)}` : null;
                return (
                  <>
                    {scheduleStr && (
                      <Typography variant="body2" color="text.secondary">
                        {scheduleStr}
                      </Typography>
                    )}
                    {typeof staffReq === 'number' && (
                      <Typography variant="body2" color="text.secondary">
                        Staff: {staffReq}
                        {typeof overstaff === 'number' && overstaff > 0 ? ` (+${overstaff} overstaff)` : ''}
                      </Typography>
                    )}
                  </>
                );
              })()}
            </Box>
          )}
        </Box>
        {showContent && shifts.length > 0 && (
          <Button
            size="small"
            variant={placementNotificationsMuted ? 'contained' : 'outlined'}
            color={placementNotificationsMuted ? 'warning' : 'inherit'}
            onClick={() => void handleTogglePlacementNotificationsMuted()}
            disabled={togglingPlacementMute || loading}
            sx={{ flexShrink: 0, ml: { xs: 'auto', sm: 0 } }}
          >
            {placementNotificationsMuted ? 'Notifications Muted' : 'Mute Notifications'}
          </Button>
        )}
      </Box>

      {/* Error Message */}
        {error && (
          <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {/* Content Area - two column board */}
        {showContent && (
          <Grid container spacing={3}>
            {/* Left: Assignments */}
            <Grid item xs={12} lg={6}>
              <Card sx={{ height: '100%' }}>
                <CardContent sx={{ p: '16px', '&:last-child': { pb: '16px' }, overflow: 'visible' }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', width: '100%', mb: 0.5, overflow: 'visible' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, flex: '0 1 auto' }}>
                      {selectedShiftId && displayedAssignedWorkers.length > 0 && (
                        <Checkbox
                          indeterminate={isSomeAssignmentsSelected && !isAllAssignmentsSelected}
                          checked={isAllAssignmentsSelected}
                          onChange={handleSelectAllAssignments}
                          size="small"
                          aria-label="select all assignees"
                        />
                      )}
                      <Typography variant="h6" sx={{ fontWeight: 600 }} noWrap>
                        Assignments ({displayedAssignedWorkers.length})
                        <Typography component="span" sx={{ ml: 0.5, fontSize: '0.7rem', color: 'text.secondary', fontWeight: 400 }} title="New UI with Preview Email">
                          (updated)
                        </Typography>
                      </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flex: '0 0 auto', ml: 'auto' }}>
                      <Tooltip title="Export">
                        <span>
                          <IconButton
                            size="small"
                            disabled={displayedAssignedWorkers.length === 0 || !selectedShiftId}
                            onClick={handleExportAssignmentsCsv}
                            aria-label="Export"
                          >
                            <GetAppIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={<EmailIcon />}
                        disabled={!selectedShiftId}
                        onClick={handlePreviewEmail}
                        title="Preview the confirmation email workers receive (staff details, parking, check-in, attachments)"
                        sx={{ minWidth: 0, py: 0.5, px: 1.25, fontSize: '0.8125rem' }}
                      >
                        Preview
                      </Button>
                    </Box>
                  </Box>
                  {isSomeAssignmentsSelected && (
                    <Box
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 2,
                        px: 0,
                        py: 1,
                        mb: 0.5,
                        borderBottom: 1,
                        borderColor: 'divider',
                        bgcolor: 'action.hover',
                      }}
                    >
                      <Typography variant="body2" color="text.secondary">
                        {selectedAssignmentWorkerIds.size} selected
                      </Typography>
                      <Tooltip title="Accept All">
                        <span>
                          <IconButton
                            size="small"
                            color="primary"
                            onClick={handleBulkAccept}
                            disabled={bulkAcceptBusy || displayedAssignedWorkers.filter((w) => selectedAssignmentWorkerIds.has(w.id) && w.isPlacementOnly).length === 0}
                            aria-label="Accept All"
                          >
                            {bulkAcceptBusy ? <CircularProgress size={20} /> : <CheckIcon />}
                          </IconButton>
                        </span>
                      </Tooltip>
                      <Tooltip title="Cancel All">
                        <span>
                          <IconButton
                            size="small"
                            color="error"
                            onClick={handleBulkCancel}
                            disabled={bulkCancelBusy || displayedAssignedWorkers.filter((w) => selectedAssignmentWorkerIds.has(w.id) && !w.isPlacementOnly && w.assignmentId).length === 0}
                            aria-label="Cancel All"
                          >
                            {bulkCancelBusy ? <CircularProgress size={20} /> : <CancelIcon />}
                          </IconButton>
                        </span>
                      </Tooltip>
                      <Tooltip title="Email All">
                        <IconButton
                          size="small"
                          color="primary"
                          onClick={() => {
                            setBulkDrawerChannel('email');
                            setBulkDrawerOpen(true);
                          }}
                          aria-label="Email All"
                        >
                          <EmailIcon />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Message All">
                        <IconButton
                          size="small"
                          color="primary"
                          onClick={() => {
                            setBulkDrawerChannel('sms');
                            setBulkDrawerOpen(true);
                          }}
                          aria-label="Message All"
                        >
                          <SmsIcon />
                        </IconButton>
                      </Tooltip>
                      <Button
                        size="small"
                        onClick={() => setSelectedAssignmentWorkerIds(new Set())}
                      >
                        Clear selection
                      </Button>
                    </Box>
                  )}
                  <Box
                    onDragOver={handleAssignmentsDragOver}
                    onDragLeave={() => setIsAssignmentDragOver(false)}
                    onDrop={handleAssignmentsDrop}
                    sx={{
                      borderRadius: 1,
                      border: '1px dashed',
                      borderColor: isAssignmentDragOver ? 'primary.main' : 'divider',
                      bgcolor: isAssignmentDragOver ? 'rgba(0,0,0,0.06)' : 'rgba(0,0,0,0.02)',
                      minHeight: 220,
                      p: 1,
                      transition: 'all 0.15s ease',
                      boxShadow: isAssignmentDragOver ? 2 : 0,
                    }}
                  >
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                      Drag workers here to place them (no message sent). Click Placed chip to offer position.
                    </Typography>
                    {!selectedShiftId ? (
                      <Alert severity="info" sx={{ py: 2 }}>
                        Select a shift to view placements.
                      </Alert>
                    ) : (
                    <Stack spacing={1}>
                      {displayedAssignedWorkers.map((worker) => {
                        const isPlacementOnly = Boolean(worker.isPlacementOnly);
                        const isDeclined = worker.assignmentStatus === 'declined';
                        const isCancelled = worker.assignmentStatus === 'cancelled' || worker.assignmentStatus === 'canceled';
                        // Placed = placement only (no offer sent). Accepted = offer sent, awaiting response. Confirmed = worker accepted. Declined/Cancelled = worker or system cancelled.
                        const isConfirmed = worker.assignmentStatus && ['confirmed', 'active'].includes(worker.assignmentStatus);
                        const offeringThis = isPlacementOnly && confirmingPlacementUserId === worker.id;
                        const statusLabel = offeringThis ? 'Offering…' : isPlacementOnly ? 'Placed' : isDeclined ? 'Declined' : isCancelled ? 'Cancelled' : isConfirmed ? 'Confirmed' : 'Accepted';
                        const canDragBackToPool = isPlacementOnly && !offeringThis; // Only placement-only (no Assignment) can be dragged back
                        return (
                          <Paper
                            key={worker.id}
                            variant="outlined"
                            draggable={canDragBackToPool}
                            onDragStart={(event) => handleWorkerDragStart(event, worker.id)}
                            sx={{
                              p: 0.5,
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              gap: 1,
                              cursor: canDragBackToPool ? 'grab' : 'default',
                            }}
                          >
                            <Checkbox
                              checked={selectedAssignmentWorkerIds.has(worker.id)}
                              onChange={() => handleSelectOneAssignment(worker.id)}
                              size="small"
                              onClick={(e) => e.stopPropagation()}
                              aria-label={`Select ${worker.displayName}`}
                              sx={{ py: 0, px: 0.5 }}
                            />
                            <PlacementWorkerTileMainColumn
                              worker={worker}
                              jobOrder={jobOrder}
                              hiringEntityName={hiringEntityName}
                              entityEmploymentByUserId={entityEmploymentByUserId}
                              placementEntityEmploymentLoading={placementEntityEmploymentLoading}
                              blockerLabels={placementBlockerLabelsForAssignmentId(worker.assignmentId)}
                              requiredCertStatuses={placementRequiredCertMatchList(
                                jobOrder,
                                worker.certifications,
                                worker.licenses,
                              )}
                              row3={
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                  <Typography variant="caption" color="text.secondary" noWrap>
                                    Starts: {formatDateDisplay(worker.assignmentStartDate || shiftStartDateStr) || '—'}
                                  </Typography>
                                  {!isPlacementOnly && worker.assignmentId && (
                                    <Tooltip title="Edit start date">
                                      <IconButton
                                        size="small"
                                        sx={{ p: 0, color: 'text.secondary' }}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleOpenEditStartDate(worker);
                                        }}
                                        aria-label="Edit start date"
                                      >
                                        <EditIcon sx={{ fontSize: 14 }} />
                                      </IconButton>
                                    </Tooltip>
                                  )}
                                </Box>
                              }
                            />
                            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0.25 }}>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                {!isPlacementOnly && !isDeclined && !isCancelled && (
                                  <Tooltip title="Remove assignment (revert to Placed, worker will be notified)">
                                    <IconButton
                                      size="small"
                                      onClick={() => setCancelAssignmentWorker(worker)}
                                      sx={{ color: 'error.main' }}
                                      aria-label="Cancel assignment"
                                    >
                                      <CloseIcon fontSize="small" />
                                    </IconButton>
                                  </Tooltip>
                                )}
                                <Tooltip title={offeringThis ? 'Sending offer…' : isPlacementOnly ? 'Click to offer position (sends accept/decline message)' : isDeclined ? 'Worker declined this assignment' : isCancelled ? 'Assignment was cancelled' : undefined}>
                                  <Chip
                                    size="small"
                                    label={statusLabel}
                                    color={isPlacementOnly ? 'info' : isDeclined || isCancelled ? 'error' : undefined}
                                    icon={
                                      offeringThis ? (
                                        <CircularProgress size={14} color="inherit" sx={{ color: 'white' }} />
                                      ) : isPlacementOnly ? (
                                        <UnlockedIcon fontSize="small" />
                                      ) : isDeclined || isCancelled ? (
                                        <ErrorIcon fontSize="small" />
                                      ) : isConfirmed ? (
                                        <CheckIcon fontSize="small" />
                                      ) : (
                                        <LockedIcon fontSize="small" />
                                      )
                                    }
                                    onClick={isPlacementOnly && !offeringThis ? () => handleConfirmPlacement(worker) : undefined}
                                    disabled={offeringThis}
                                    sx={{
                                      ...(isPlacementOnly && !offeringThis && {
                                        cursor: 'pointer',
                                        zIndex: 50,
                                        position: 'relative',
                                        '&:hover': { opacity: 0.9 },
                                      }),
                                      ...(offeringThis && {
                                        cursor: 'wait',
                                        opacity: 0.95,
                                        '& .MuiChip-icon': { color: 'white' },
                                      }),
                                      ...((isDeclined || isCancelled) && {
                                        bgcolor: 'error.main',
                                        color: 'white',
                                        '& .MuiChip-icon': { color: 'white' },
                                      }),
                                      ...(isConfirmed && {
                                        bgcolor: 'success.main',
                                        color: 'white',
                                        '& .MuiChip-icon': { color: 'white' },
                                      }),
                                      ...(!isPlacementOnly && !isConfirmed && !isDeclined && !isCancelled && {
                                        bgcolor: '#e8f5e9', // Light green (Material green 50)
                                        color: 'success.main',
                                        '& .MuiChip-icon': { color: 'success.main' },
                                      }),
                                    }}
                                  />
                                </Tooltip>
                                {!isPlacementOnly && !isConfirmed && !isDeclined && !isCancelled && worker.assignmentId && (
                                  <Tooltip title="Confirm this assignment on behalf of the worker (same as them clicking Accept)">
                                    <Chip
                                      size="small"
                                      label={confirmLoadingAssignmentId === worker.assignmentId || confirmLoadingAssignmentId === worker.id ? 'Confirming…' : 'Confirm'}
                                      onClick={() => handleConfirmForWorker(worker)}
                                      disabled={confirmLoadingAssignmentId === worker.assignmentId || confirmLoadingAssignmentId === worker.id}
                                      sx={{
                                        bgcolor: '#E3F2FD',
                                        color: '#1976D2',
                                        fontWeight: 500,
                                        '&:hover': { bgcolor: '#BBDEFB' },
                                      }}
                                    />
                                  </Tooltip>
                                )}
                              </Box>
                              {!isPlacementOnly && !isDeclined && !isCancelled && (worker.assignmentConfirmedAt != null || worker.assignmentOfferSentAt != null) && (
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                  <Typography variant="caption" color="text.secondary">
                                    {isConfirmed
                                      ? worker.assignmentConfirmedAt != null
                                        ? `Confirmed ${new Date(worker.assignmentConfirmedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}`
                                        : worker.assignmentOfferSentAt != null
                                          ? `Confirmed (offer sent ${new Date(worker.assignmentOfferSentAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })})`
                                          : 'Confirmed'
                                      : worker.assignmentOfferSentAt != null
                                        ? `Offer sent ${new Date(worker.assignmentOfferSentAt).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}`
                                        : null}
                                  </Typography>
                                  {!isConfirmed && worker.assignmentOfferSentAt != null && (() => {
                                    const aid = worker.assignmentId ?? '';
                                    const loading = resendLoadingAssignmentId === aid;
                                    const cooldownUntil = resendCooldownUntilByAssignmentId[aid] ?? 0;
                                    const inCooldown = Date.now() < cooldownUntil;
                                    const disabled = loading || inCooldown;
                                    return (
                                      <Tooltip title={inCooldown ? 'Please wait before resending' : 'Resend offer (SMS + push + email)'}>
                                        <span>
                                          <IconButton
                                            size="small"
                                            sx={{ p: 0, color: 'text.secondary' }}
                                            onClick={() => handleResendOffer(worker)}
                                            disabled={disabled}
                                            aria-label="Resend offer"
                                          >
                                            <RefreshIcon
                                              sx={{
                                                fontSize: 14,
                                                ...(loading && {
                                                  animation: 'spin 0.8s linear infinite',
                                                  '@keyframes spin': { from: { transform: 'rotate(0deg)' }, to: { transform: 'rotate(360deg)' } },
                                                }),
                                              }}
                                            />
                                          </IconButton>
                                        </span>
                                      </Tooltip>
                                    );
                                  })()}
                                </Box>
                              )}
                            </Box>
                          </Paper>
                        );
                      })}
                      {displayedAssignedWorkers.length === 0 && (
                        <Alert severity="info">
                          No workers placed or assigned yet.
                        </Alert>
                      )}
                    </Stack>
                  )}
                  </Box>
                </CardContent>
              </Card>
            </Grid>

            {/* Right: Worker Pool */}
            <Grid item xs={12} lg={6}>
              <Card sx={{ height: '100%' }}>
                <CardContent sx={{ p: '16px', '&:last-child': { pb: '16px' } }}>
                  <Typography variant="h6" gutterBottom sx={{ fontWeight: 600 }}>
                    Worker Pool ({availableWorkers.length})
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', mb: 1, flexWrap: 'wrap' }}>
                    <FormControl size="small" sx={{ minWidth: 160, flex: 1 }}>
                      <InputLabel>Workforce</InputLabel>
                      <Select
                        value={safeSelectedWorkforce}
                        label="Workforce"
                        onChange={(e) => setSelectedWorkforce(e.target.value)}
                      >
                        <MenuItem value="">
                          <em>Select workforce</em>
                        </MenuItem>
                        {workforceOptions.map((option) => {
                          const isGroup = option.value.startsWith('group_');
                          return (
                            <MenuItem key={option.value} value={option.value}>
                              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: 1 }}>
                                <span>{option.label}</span>
                                {isGroup && (
                                  <Tooltip title="Remove group from list">
                                    <IconButton
                                      size="small"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleRemoveGroupFromWorkforce(option.value);
                                      }}
                                      sx={{ color: 'error.main', p: 0.25 }}
                                      aria-label="Remove group"
                                    >
                                      <CloseIcon fontSize="small" />
                                    </IconButton>
                                  </Tooltip>
                                )}
                              </Box>
                            </MenuItem>
                          );
                        })}
                      </Select>
                    </FormControl>
                    {selectedWorkforce.startsWith('group_') && (
                      <Tooltip title="Clear group selection">
                        <IconButton
                          size="small"
                          onClick={() => setSelectedWorkforce('choose_group')}
                          sx={{ mt: 0.5 }}
                        >
                          <ClearIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                  </Box>
                  {safeSelectedWorkforce === 'choose_group' && (
                    <FormControl fullWidth size="small" sx={{ mb: 1 }}>
                      <InputLabel id="placements-group-select-label" shrink>Group</InputLabel>
                      <Select
                        labelId="placements-group-select-label"
                        value=""
                        label="Group"
                        displayEmpty
                        renderValue={(v) => (v === '' ? 'Select a group' : userGroups.find((g) => g.id === v)?.groupName ?? v)}
                        onChange={async (e) => {
                          const groupId = e.target.value as string;
                          if (!groupId) return;
                          const group = userGroups.find((g) => g.id === groupId);
                          if (!group) return;
                          setSelectedWorkforce(`group_${groupId}`);
                          try {
                            const jobOrderRef = doc(db, 'tenants', tenantId, 'job_orders', jobOrderId);
                            await updateDoc(jobOrderRef, {
                              placementsLastGroup: { id: groupId, groupName: group.groupName },
                              updatedAt: serverTimestamp(),
                            });
                            onJobOrderUpdated?.();
                          } catch (err) {
                            console.error('Error saving placements last group:', err);
                          }
                        }}
                      >
                        <MenuItem value="">
                          <em>Select a group</em>
                        </MenuItem>
                        {userGroups.map((g) => (
                          <MenuItem key={g.id} value={g.id}>
                            {g.groupName}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  )}
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                    Drag into Assignments to place. Drop Placed workers here to unplace.
                  </Typography>

                  <Box
                    onDragOver={handleWorkerPoolDragOver}
                    onDragLeave={() => setIsWorkerPoolDragOver(false)}
                    onDrop={handleWorkerPoolDrop}
                    sx={{
                      borderRadius: 1,
                      border: '1px dashed',
                      borderColor: isWorkerPoolDragOver ? 'warning.main' : 'divider',
                      bgcolor: isWorkerPoolDragOver ? 'rgba(255, 152, 0, 0.08)' : 'rgba(0,0,0,0.02)',
                      minHeight: 220,
                      p: 1,
                      transition: 'all 0.15s ease',
                      boxShadow: isWorkerPoolDragOver ? 2 : 0,
                    }}
                  >
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                      Drop Placed workers here to unplace
                    </Typography>
                  {!safeSelectedWorkforce ? (
                    <Alert severity="info" sx={{ py: 2 }}>
                      Select a workforce to view workers.
                    </Alert>
                  ) : safeSelectedWorkforce === 'choose_group' ? (
                    <Alert severity="info" sx={{ py: 2 }}>
                      Select a group above to view its members.
                    </Alert>
                  ) : !selectedShiftId && !(String((jobOrder as any)?.jobType || '').toLowerCase() === 'career' && (safeSelectedWorkforce === 'applicants' || safeSelectedWorkforce === 'candidates')) ? (
                    <Alert severity="info" sx={{ py: 2 }}>
                      Select a shift to view worker pool.
                    </Alert>
                  ) : loading ? (
                    <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
                      <CircularProgress size={28} />
                    </Box>
                  ) : availableWorkers.length === 0 ? (
                    <Alert severity="info">
                      No available workers for the selected workforce option.
                    </Alert>
                  ) : (
                    <Stack spacing={1}>
                      {availableWorkers.map((worker) => {
                        const getResumeUrl = () => {
                          if (worker.resumeUrl) return worker.resumeUrl;
                          if (worker.resume?.downloadUrl) return worker.resume.downloadUrl;
                          if (worker.resume?.storagePath) {
                            return `https://firebasestorage.googleapis.com/v0/b/hrx1-d3beb.firebasestorage.app/o/${encodeURIComponent(worker.resume.storagePath)}?alt=media`;
                          }
                          return null;
                        };

                        const resumeUrl = getResumeUrl();
                        const hasBio = worker.bio && worker.bio.trim().length > 0;
                        const hasWorkHistory = worker.workHistory && worker.workHistory.length > 0;
                        const hasCerts = worker.certifications && worker.certifications.length > 0;
                        const hasLicenses = worker.licenses && worker.licenses.length > 0;
                        const requiredCertStatuses = placementRequiredCertMatchList(
                          jobOrder,
                          worker.certifications,
                          worker.licenses,
                        );

                        return (
                          <Paper
                            key={worker.id}
                            variant="outlined"
                            draggable
                            onDragStart={(event) => handleWorkerDragStart(event, worker.id)}
                            sx={{
                              p: 0.5,
                              display: 'flex',
                              flexDirection: 'row',
                              alignItems: 'stretch',
                              gap: 0.5,
                              cursor: 'grab',
                            }}
                          >
                            <Box sx={{ flex: 1, minWidth: 0, pr: 0 }}>
                              <PlacementWorkerTileMainColumn
                                worker={worker}
                                jobOrder={jobOrder}
                                hiringEntityName={hiringEntityName}
                                entityEmploymentByUserId={entityEmploymentByUserId}
                                placementEntityEmploymentLoading={placementEntityEmploymentLoading}
                                blockerLabels={placementBlockerLabelsForAssignmentId(worker.assignmentId)}
                                requiredCertStatuses={requiredCertStatuses}
                                profileActionIcons={
                                  <>
                                    {/* Phase 5b — quiet "Inactive at N account(s)"
                                        signal, filtered to exclude the current
                                        account the recruiter is already placing
                                        for. Read from denormalized user doc
                                        field; zero extra queries. */}
                                    <WorkforceInactiveElsewhereChip
                                      entries={worker.inactiveAtAccounts}
                                      currentAccountId={(jobOrder as any)?.recruiterAccountId ?? null}
                                      iconOnly
                                    />
                                    {resumeUrl ? (
                                      <Tooltip title="View resume" {...placementTileTooltipSlotProps}>
                                        <IconButton
                                          size="small"
                                          sx={placementProfileTileIconBtnSx}
                                          onClick={() => {
                                            setSelectedResume({ url: resumeUrl, fileName: worker.resume?.fileName });
                                            setResumeModalOpen(true);
                                          }}
                                        >
                                          <ResumeIcon />
                                        </IconButton>
                                      </Tooltip>
                                    ) : null}
                                    {hasBio ? (
                                      <Tooltip
                                        title={
                                          <Typography
                                            variant="body2"
                                            sx={{ whiteSpace: 'pre-wrap', maxWidth: 320, color: '#fff' }}
                                          >
                                            {worker.bio}
                                          </Typography>
                                        }
                                        {...placementTileTooltipSlotProps}
                                      >
                                        <IconButton size="small" sx={placementProfileTileIconBtnSx}>
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
                                        <IconButton size="small" sx={placementProfileTileIconBtnSx}>
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
                                          onClick={() => {
                                            setSelectedLicenses(worker.licenses || []);
                                            setLicenseModalOpen(true);
                                          }}
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
                                          onClick={() => {
                                            setSelectedCerts(worker.certifications || []);
                                            setCertModalOpen(true);
                                          }}
                                        >
                                          <ProfileCertsIcon />
                                        </IconButton>
                                      </Tooltip>
                                    ) : null}
                                  </>
                                }
                                row3={
                                  <Typography variant="caption" color="text.secondary" noWrap>
                                    {[worker.city, worker.state].filter(Boolean).join(', ') ||
                                      worker.email ||
                                      worker.phone ||
                                      'No contact info'}
                                  </Typography>
                                }
                                row4End={
                                  <>
                                    {!!worker.skills?.length && (
                                      <Chip
                                        size="small"
                                        label={`${worker.skills.length} skills`}
                                        sx={{ height: 20, '& .MuiChip-label': { px: 0.75, fontSize: '0.65rem' } }}
                                      />
                                    )}
                                    {!!worker.languages?.length && (
                                      <Chip
                                        size="small"
                                        variant="outlined"
                                        label={`${worker.languages.length} langs`}
                                        sx={{ height: 20, '& .MuiChip-label': { px: 0.75, fontSize: '0.65rem' } }}
                                      />
                                    )}
                                  </>
                                }
                              />
                            </Box>
                            <Box
                              sx={{
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'flex-end',
                                justifyContent: 'space-between',
                                flexShrink: 0,
                                alignSelf: 'stretch',
                                minWidth: 56,
                              }}
                            >
                              {sameDayConflictByUserId.get(worker.id)?.length ? (
                                <Tooltip
                                  title={
                                    <Box>
                                      <Typography variant="caption" fontWeight={600} display="block" sx={{ mb: 0.5, color: '#fff' }}>
                                        Already on a shift this day
                                      </Typography>
                                      {sameDayConflictByUserId.get(worker.id)?.map((c, i) => (
                                        <Typography key={i} variant="caption" display="block" sx={{ color: '#fff' }}>
                                          {c.shiftTitle} ({c.type === 'placement' ? 'Placed' : c.type === 'assigned' ? 'Accepted' : 'Confirmed'})
                                        </Typography>
                                      ))}
                                    </Box>
                                  }
                                  {...placementTileTooltipSlotProps}
                                >
                                  <WarningIcon fontSize="small" sx={{ color: 'warning.main' }} />
                                </Tooltip>
                              ) : (
                                <Box sx={{ minHeight: 0 }} />
                              )}
                              <Box
                                sx={{
                                  mt: 'auto',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 0.5,
                                }}
                              >
                                {/* Open user record in a new tab — handy when the
                                    recruiter wants to vet skills / history without
                                    losing their place in the Placements board. */}
                                <Tooltip title="Open user record in new tab" {...placementTileTooltipSlotProps}>
                                  <IconButton
                                    size="small"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      window.open(`/users/${worker.id}`, '_blank', 'noopener,noreferrer');
                                    }}
                                    sx={{
                                      width: 24,
                                      height: 24,
                                      color: 'text.secondary',
                                    }}
                                    aria-label="Open user record in new tab"
                                  >
                                    <OpenInNewIcon sx={{ fontSize: 16 }} />
                                  </IconButton>
                                </Tooltip>
                                <Button
                                  variant="outlined"
                                  size="small"
                                  onClick={() => handleAssignToShift(worker, selectedShift)}
                                  disabled={!selectedShift}
                                  sx={{
                                    minWidth: 56,
                                    height: 24,
                                    py: 0.25,
                                    px: 0.75,
                                    fontSize: '0.6875rem',
                                    lineHeight: 1,
                                  }}
                                >
                                  Assign
                                </Button>
                              </Box>
                            </Box>
                          </Paper>
                        );
                      })}
                    </Stack>
                  )}
                  </Box>
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        )}

        {/* Resume Modal */}
        <Dialog
          open={resumeModalOpen}
          onClose={() => setResumeModalOpen(false)}
          maxWidth="md"
          fullWidth
        >
          <DialogTitle>
            Resume {selectedResume?.fileName && `- ${selectedResume.fileName}`}
          </DialogTitle>
          <DialogContent>
            {selectedResume?.url && (
              <iframe
                src={selectedResume.url}
                style={{ width: '100%', height: '600px', border: 'none' }}
                title="Resume Viewer"
              />
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setResumeModalOpen(false)}>Close</Button>
            {selectedResume?.url && (
              <Button
                variant="contained"
                onClick={() => window.open(selectedResume.url, '_blank')}
                startIcon={<ResumeIcon />}
              >
                Open in New Tab
              </Button>
            )}
          </DialogActions>
        </Dialog>

        {/* Certifications Modal */}
        <Dialog
          open={certModalOpen}
          onClose={() => setCertModalOpen(false)}
          maxWidth="sm"
          fullWidth
        >
          <DialogTitle>Certifications</DialogTitle>
          <DialogContent>
            {selectedCerts.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No certifications available.
              </Typography>
            ) : (
              <Stack spacing={2} sx={{ mt: 1 }}>
                {selectedCerts.map((cert: any, idx: number) => (
                  <Card key={idx} variant="outlined">
                    <CardContent>
                      <Typography variant="subtitle2" fontWeight={600}>
                        {cert.name || cert.certification || cert}
                      </Typography>
                      {cert.issuer && (
                        <Typography variant="body2" color="text.secondary">
                          Issuer: {cert.issuer}
                        </Typography>
                      )}
                      {cert.issueDate && (
                        <Typography variant="body2" color="text.secondary">
                          Issue Date: {typeof cert.issueDate === 'string' ? cert.issueDate : new Date(cert.issueDate).toLocaleDateString()}
                        </Typography>
                      )}
                      {cert.expirationDate && (
                        <Typography variant="body2" color="text.secondary">
                          Expires: {typeof cert.expirationDate === 'string' ? cert.expirationDate : new Date(cert.expirationDate).toLocaleDateString()}
                        </Typography>
                      )}
                      {cert.url && (
                        <Link href={cert.url} target="_blank" rel="noopener">
                          View Certificate
                        </Link>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </Stack>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setCertModalOpen(false)}>Close</Button>
          </DialogActions>
        </Dialog>

        {/* Licenses Modal */}
        <Dialog
          open={licenseModalOpen}
          onClose={() => setLicenseModalOpen(false)}
          maxWidth="sm"
          fullWidth
        >
          <DialogTitle>Licenses</DialogTitle>
          <DialogContent>
            {selectedLicenses.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No licenses available.
              </Typography>
            ) : (
              <Stack spacing={2} sx={{ mt: 1 }}>
                {selectedLicenses.map((license: any, idx: number) => (
                  <Card key={idx} variant="outlined">
                    <CardContent>
                      <Typography variant="subtitle2" fontWeight={600}>
                        {license.type || license.name || license.license || license}
                      </Typography>
                      {license.number && (
                        <Typography variant="body2" color="text.secondary">
                          Number: {license.number}
                        </Typography>
                      )}
                      {license.state && (
                        <Typography variant="body2" color="text.secondary">
                          State: {license.state}
                        </Typography>
                      )}
                      {license.expirationDate && (
                        <Typography variant="body2" color="text.secondary">
                          Expires: {typeof license.expirationDate === 'string' ? license.expirationDate : new Date(license.expirationDate).toLocaleDateString()}
                        </Typography>
                      )}
                      {license.url && (
                        <Link href={license.url} target="_blank" rel="noopener">
                          View License
                        </Link>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </Stack>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setLicenseModalOpen(false)}>Close</Button>
          </DialogActions>
        </Dialog>

        {/* Confirm remove assignment */}
        <Dialog open={!!cancelAssignmentWorker} onClose={() => setCancelAssignmentWorker(null)} maxWidth="xs" fullWidth>
          <DialogTitle>Remove assignment?</DialogTitle>
          <DialogContent>
            <Typography variant="body2">
              This will revert {cancelAssignmentWorker?.displayName ?? 'this worker'} to <strong>Placed</strong>. The worker will be notified that the assignment was cancelled (SMS / email / push).
            </Typography>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setCancelAssignmentWorker(null)}>Cancel</Button>
            <Button variant="contained" color="error" onClick={() => cancelAssignmentWorker && handleCancelAssignment(cancelAssignmentWorker)}>
              Remove assignment
            </Button>
          </DialogActions>
        </Dialog>

        {/* Preview confirmation email (staff details, parking, check-in, attachments) */}
        <Dialog
          open={previewEmailOpen}
          onClose={() => { setPreviewEmailOpen(false); setPreviewEmailError(null); }}
          maxWidth="md"
          fullWidth
          PaperProps={{ sx: { maxHeight: '90vh' } }}
        >
          <DialogTitle>Preview: Confirmation Email</DialogTitle>
          <DialogContent>
            {previewEmailLoading && (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                <CircularProgress />
              </Box>
            )}
            {previewEmailError && (
              <Alert severity="warning" sx={{ mb: 2 }} onClose={() => setPreviewEmailError(null)}>
                {previewEmailError}
              </Alert>
            )}
            {!previewEmailLoading && previewEmailSubject && (
              <>
                <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 0.5 }}>Subject</Typography>
                <Typography variant="body1" sx={{ mb: 2, fontWeight: 600 }}>{previewEmailSubject}</Typography>
                <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 0.5 }}>Body (staff details, parking, check-in instructions; attachments appear as links below)</Typography>
                <Box
                  sx={{
                    border: 1,
                    borderColor: 'divider',
                    borderRadius: 1,
                    p: 2,
                    maxHeight: 400,
                    overflow: 'auto',
                    bgcolor: 'grey.50',
                  }}
                >
                  <Box component="div" dangerouslySetInnerHTML={{ __html: previewEmailHtml }} />
                </Box>
              </>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => { setPreviewEmailOpen(false); setPreviewEmailError(null); }}>Close</Button>
          </DialogActions>
        </Dialog>

        {/* Double-book warning: worker already placed/assigned/confirmed on same day */}
        <Dialog open={!!doubleBookConfirmWorker} onClose={() => setDoubleBookConfirmWorker(null)} maxWidth="sm" fullWidth>
          <DialogTitle>Already working this day</DialogTitle>
          <DialogContent>
            <Typography variant="body2" sx={{ mb: 1 }}>
              {doubleBookConfirmWorker?.displayName ?? 'This worker'} is already placed, assigned, or confirmed on another shift this day:
            </Typography>
            <Stack component="ul" sx={{ pl: 2, m: 0 }}>
              {doubleBookConfirmWorker && sameDayConflictByUserId.get(doubleBookConfirmWorker.id)?.map((c, i) => (
                <Typography key={i} component="li" variant="body2" color="text.secondary">
                  {c.shiftTitle} ({c.type === 'placement' ? 'Placed' : c.type === 'assigned' ? 'Accepted' : 'Confirmed'})
                </Typography>
              ))}
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Placing them on this shift as well may double-book them. Do you want to place anyway?
            </Typography>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setDoubleBookConfirmWorker(null)}>Cancel</Button>
            <Button variant="contained" onClick={() => doubleBookConfirmWorker && createPlacement(doubleBookConfirmWorker)}>
              Place anyway
            </Button>
          </DialogActions>
        </Dialog>

        {/* Edit assignment start date */}
        <Dialog open={!!editStartDateWorker} onClose={() => setEditStartDateWorker(null)} maxWidth="xs" fullWidth>
          <DialogTitle>Start date</DialogTitle>
          <DialogContent>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              {editStartDateWorker?.displayName}
            </Typography>
            <TextField
              type="date"
              label="Start date"
              value={editStartDateValue}
              onChange={(e) => setEditStartDateValue(e.target.value)}
              fullWidth
              size="small"
              InputLabelProps={{ shrink: true }}
              inputProps={{ max: '9999-12-31' }}
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setEditStartDateWorker(null)}>Cancel</Button>
            <Button variant="contained" onClick={handleSaveStartDate} disabled={editStartDateSaving || !editStartDateValue.trim()}>
              {editStartDateSaving ? 'Saving…' : 'Save'}
            </Button>
          </DialogActions>
        </Dialog>

        <MessageDrawer
          open={bulkDrawerOpen}
          onClose={() => setBulkDrawerOpen(false)}
          recipients={bulkAssignmentRecipients.recipients}
          tenantId={tenantId}
          bulkSystemMode={true}
          recipientUserIds={bulkAssignmentRecipients.recipientUserIds}
          defaultChannels={[bulkDrawerChannel]}
          onSend={() => {
            setSelectedAssignmentWorkerIds(new Set());
            setBulkDrawerOpen(false);
          }}
        />
      </Box>
  );
};

export default PlacementsTab;

