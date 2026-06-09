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
  Autocomplete,
  InputAdornment,
  Snackbar,
} from '@mui/material';
import {
  Description as ResumeIcon,
  Lock as LockedIcon,
  LockOpen as UnlockedIcon,
  Clear as ClearIcon,
  Close as CloseIcon,
  Check as CheckIcon,
  Error as ErrorIcon,
  Edit as EditIcon,
  Refresh as RefreshIcon,
  Search as SearchIcon,
  Warning as WarningIcon,
  Email as EmailIcon,
  Sms as SmsIcon,
  Cancel as CancelIcon,
  GetApp as GetAppIcon,
  OpenInNew as OpenInNewIcon,
  PersonAddAlt1 as PersonAddIcon,
  PersonRemove as PersonRemoveIcon,
  NotificationsActive as NotificationsActiveIcon,
  NotificationsOff as NotificationsOffIcon,
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
import type { UserInactiveAtAccountEntry } from '../../shared/accountWorkforce';
import {
  type Worker,
  WORKER_DRAG_MIME,
  placementActionChipSx,
  placementActionIconBtnSx,
  placementTileTooltipSlotProps,
  resolvePlacementResumeUrl,
  PlacementProfileActionIcons,
  PlacementWorkerTileMainColumn,
} from './placementsTileShared';
import { ShiftAssignmentCard } from './ShiftAssignmentCard';
import {
  getEffectiveJobOrderField,
  type JobOrderForEffectiveRead,
} from '../../shared/jobOrder/getEffectiveJobOrderField';
import { useAuth } from '../../contexts/AuthContext';
import { logAssignmentUpdateActivity } from '../../utils/activityLogger';
import { JobOrder } from '../../types/recruiter/jobOrder';
import { isExcludedFromPlacementsApplicantPool } from '../../utils/applicationStatusNormalize';
import { deriveC1EntityKeyFromEntityName } from '../../utils/c1EntityWorkAuthorizationUi';
import {
  placementBlockerOptionsForRow,
  selectIncompleteOnboardingRequirementLabelsFromSnapshot,
  selectPlacementBlockerLabelsWithOptionalEngine,
  selectPlacementCertBlockerLabelsLegacyFromSnapshot,
} from '../../utils/placementQualificationChipsModel';
import certificationCatalogManifest from '../../shared/data/certificationCatalogManifest.v1.json';
import type { CertificationCatalogManifestV1 } from '../../shared/certifications/certificationCatalogManifest';
import { warnCertifications } from '../../shared/certifications/certificationsLogging';
import { buildCertificationRequirementsFromJobOrder } from '../../shared/certifications/buildCertificationRequirementsFromJobOrder';
import { computeEngineGapForPhase1Requirements } from '../../utils/certifications/evaluateCertificationsForLegacyRequirementStrings';
import { logCertEngineShadowMismatch } from '../../utils/certifications/certEngineShadowCompare';
import { normalizeDateToISODateString } from '../../shared/certifications/normalizeDateToISODateString';
import { isCertEngineReadinessEnabled } from '../../utils/certifications/certEngineReadinessFlag';

const PLACEMENT_CERT_MANIFEST = certificationCatalogManifest as CertificationCatalogManifestV1;
import { buildPlacementJobFitMap } from '../../utils/placementApplicantJobFit';
import {
  buildPlacementApplicationNoShowRiskMap,
  type PlacementApplicationNoShowRisk,
} from '../../utils/placementNoShowRiskDisplay';
import type { ReadinessSnapshotV1Firestore } from '../../shared/readinessSnapshotV1';
import type {
  JobReadinessChipContributor,
  JobReadinessChipData,
} from '../../shared/jobReadinessChip/types';
import { getRecruiterMasterDisplayForAdminUi } from '../../utils/scoring/recruiterMasterScoreDisplay';
import {
  placementRequiredCertMatchList,
} from '../../utils/placementTileWorkforceSignals';

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
  /**
   * When set, the tab is pinned to this shift — the shift selector
   * UI is hidden and persisted/derived selections never deviate
   * from this id. Used by `ShiftPlacementsDrawer` so a recruiter
   * always sees placements for the row they clicked, never another
   * shift on the same JO.
   */
  lockedShiftId?: string | null;
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

/**
 * Normalize a Firestore field that may hold either an array of strings or an
 * array of `{ label | name | value }` objects (the shape used by the
 * Skills/Languages UI). Mirrors the helper in `mapUserDataToRecruiterUser`.
 * Returns a deduped string array preserving original order.
 */
function normalizeStringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    let label: string | null = null;
    if (typeof item === 'string') {
      label = item;
    } else if (item && typeof item === 'object') {
      const obj = item as Record<string, unknown>;
      const v = obj.label ?? obj.name ?? obj.value;
      if (typeof v === 'string') label = v;
    }
    if (!label) continue;
    const trimmed = label.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}


const PlacementsTab: React.FC<PlacementsTabProps> = ({
  tenantId,
  jobOrderId,
  jobOrder,
  onJobOrderUpdated,
  connectedJobPostIds = [],
  hiringEntityName = null,
  placementHiringEntityId = null,
  lockedShiftId = null,
}) => {
  // Only present in hrx-god-view workspace build (Assign All + Export + Preview Email)
  if (typeof console !== 'undefined' && console.log) {
    console.log('[PlacementsTab] Loaded WITH Preview Email button (run from /Users/gregfielding/hrx-god-view)');
  }
  const { user } = useAuth();
  // Optimistic local override for the mute toggle. The parent's
  // `jobOrder` prop is the source of truth, but we want the icon to
  // flip instantly on click without waiting for the parent's refetch
  // (which would briefly toggle the page through a `loading` state and
  // feel like a reload). The override is consulted first; once the
  // parent's prop catches up to the same value, the effect below
  // clears the override so future external changes (e.g. another user
  // muting elsewhere) propagate normally.
  const [localMutedOverride, setLocalMutedOverride] = useState<boolean | null>(null);
  const placementNotificationsMuted =
    localMutedOverride !== null ? localMutedOverride : Boolean(jobOrder?.muted);
  useEffect(() => {
    if (
      localMutedOverride !== null &&
      Boolean(jobOrder?.muted) === localMutedOverride
    ) {
      setLocalMutedOverride(null);
    }
  }, [jobOrder?.muted, localMutedOverride]);
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
  /**
   * **Phase 5 semantics** — `selectedShiftId` is the *anchor* for
   * shift-scoped data: which shift the legacy single-shift assignment/
   * placement listeners are subscribed to, and which shift the Worker
   * Pool's "Shift Applicants" filter resolves against. It is no longer
   * the user-facing "selected" shift — instead it follows whichever
   * card the recruiter has expanded in the Assignments column (the
   * `expandedShiftId` sync, below). Direct `setSelectedShiftId` calls
   * are reserved for plumbing — UI interactions go through
   * `handleJumpToShift` or `handleToggleShiftExpand`, which drive
   * `expandedShiftId` and let the sync update this anchor.
   *
   * Persistence: still keyed by `shiftId` for backwards compat with
   * previously-saved JO Detail filter prefs.
   */
  const [selectedShiftId, setSelectedShiftId] = useState<string>(persistedFilters.shiftId);
  // In drawer mode (`lockedShiftId`) the worker pool is always
  // scoped to a specific shift, so default the Workforce filter to
  // "Shift Applicants" rather than rehydrating from the JO Detail
  // page's persisted preference. Recruiters can still pick another
  // option inside the drawer; we just don't carry their JO-Detail
  // choice over because the drawer's mental model is per-shift.
  const [selectedWorkforce, setSelectedWorkforce] = useState<string>(
    lockedShiftId ? 'shift_applicants' : persistedFilters.workforce,
  );
  const [selectedDay, setSelectedDay] = useState<string>(persistedFilters.day ?? '');
  // Data state
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  /** Job-order-scoped application job scores (userId → jobScore); shared with assignment column tiles. */
  const [placementJobFitByUserId, setPlacementJobFitByUserId] = useState<Map<string, number>>(() => new Map());
  const [placementAppNoShowRiskByUserId, setPlacementAppNoShowRiskByUserId] = useState<
    Map<string, PlacementApplicationNoShowRisk>
  >(() => new Map());
  /**
   * Phase 3: per-card drop tracking. Each <ShiftAssignmentCard> has
   * its own drop zone (the whole Card root) and reports which shiftId
   * is currently being hovered. `null` = nothing being dragged over.
   * Replaces the prior single-boolean `isAssignmentDragOver`.
   */
  const [dragOverShiftId, setDragOverShiftId] = useState<string | null>(null);
  const [isWorkerPoolDragOver, setIsWorkerPoolDragOver] = useState(false);
  type AssignmentRow = {
    /**
     * Phase 2: each row carries the shiftId it belongs to so the
     * Assignments column can render multiple cards (one per visible
     * shift) by grouping rows by `shiftId`. Sourced from
     * `assignments/{aid}.shiftId` (already denormalized; see Slice 5.5
     * for the parallel `timesheetEntries.shiftId` denorm).
     */
    shiftId: string;
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
  /**
   * Per-placement start date overrides (`tenants/{}/placements/{}.startDate`,
   * YYYY-MM-DD). Lets recruiters edit a target start date BEFORE confirming
   * the placement; the value is later passed as `applyDate` to
   * `placementsCreateAssignments` so the server-side `effectiveStartDate`
   * picks it up. Map keyed by `userId`.
   */
  const [placementStartDateByUserId, setPlacementStartDateByUserId] = useState<Map<string, string>>(new Map());
  const [userGroups, setUserGroups] = useState<Array<{ id: string; groupName: string }>>([]);
  const [confirmedApplicationsCount, setConfirmedApplicationsCount] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumped to force the Worker Pool to re-load after a silent mutation
  // (e.g. removing an applicant from the selected shift).
  const [poolRefreshTick, setPoolRefreshTick] = useState(0);
  /**
   * Bottom-center toast for assign-click feedback. The legacy `error`
   * Alert renders at the very top of the placements UI — when the
   * recruiter is scrolled down looking at the Worker Pool on the right
   * and clicks Assign, an error like "Could not hire: Quiana Jackson —
   * already assigned to this shift" was off-screen, so the click felt
   * silent. The Snackbar floats above content regardless of scroll.
   *
   * `severity` drives the color (error = red, success = green). For
   * mixed batches we use 'info' so neither a green nor a red read
   * misrepresents what happened.
   */
  const [assignToast, setAssignToast] = useState<{
    message: string;
    severity: 'success' | 'error' | 'info';
    /**
     * Optional retry action for the toast. When the only blocker on a
     * batch was `overlapping_assignment`, we surface an "Assign anyway"
     * button that re-fires the same batch with `allowOverlapping: true`
     * — so the recruiter doesn't have to re-click each tile after
     * acknowledging the conflict.
     */
    overrideAction?: {
      label: string;
      workerIds: string[];
      dayOverride?: string;
    };
  } | null>(null);
  const [resendLoadingAssignmentId, setResendLoadingAssignmentId] = useState<string | null>(null);
  const [resendCooldownUntilByAssignmentId, setResendCooldownUntilByAssignmentId] = useState<Record<string, number>>({});
  const [confirmLoadingAssignmentId, setConfirmLoadingAssignmentId] = useState<string | null>(null);
  const [confirmingPlacementUserId, setConfirmingPlacementUserId] = useState<string | null>(null);
  // Workers whose hire was just clicked but whose Assignment doc
  // hasn't yet propagated through the snapshot listener. Treated as
  // having a `proposed` assignment for the purpose of the tile chip,
  // so "Click to Hire" flips instantly to "Accepted" without waiting
  // on the server round-trip. Mirrors `pendingPlacementRemovesRef`'s
  // role on the unplace path. Cleared by the effect below once the
  // real assignment row arrives in `assignmentRows`.
  const [pendingHireWorkerIds, setPendingHireWorkerIds] = useState<Set<string>>(new Set());
  const [cancelAssignmentWorker, setCancelAssignmentWorker] = useState<Worker | null>(null);
  const [previewEmailOpen, setPreviewEmailOpen] = useState(false);
  const [previewEmailSubject, setPreviewEmailSubject] = useState<string>('');
  const [previewEmailHtml, setPreviewEmailHtml] = useState<string>('');
  const [previewEmailLoading, setPreviewEmailLoading] = useState(false);
  const [previewEmailError, setPreviewEmailError] = useState<string | null>(null);

  const handleTogglePlacementNotificationsMuted = useCallback(async () => {
    if (!tenantId || !jobOrderId) return;
    const next = !placementNotificationsMuted;
    // Optimistic — flip the icon immediately. Override is consulted
    // over `jobOrder?.muted` until the parent's view of the JO catches
    // up (or we revert on error below).
    setLocalMutedOverride(next);
    setTogglingPlacementMute(true);
    try {
      setError(null);
      await updateDoc(doc(db, 'tenants', tenantId, 'job_orders', jobOrderId), {
        muted: next,
        updatedAt: serverTimestamp(),
      });
      // Intentionally NOT calling onJobOrderUpdated() — the parent's
      // refetch flips the whole page through a loading state and
      // feels like a reload. The local override holds the new value;
      // the parent picks it up on its next natural refresh.
    } catch (err: unknown) {
      setLocalMutedOverride(null); // revert optimistic update
      setError((err as Error)?.message ?? 'Failed to update mute setting');
    } finally {
      setTogglingPlacementMute(false);
    }
  }, [tenantId, jobOrderId, placementNotificationsMuted]);

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
    
    // Extract skills and languages (ensure arrays of strings; profile data may
    // store these as objects with `label`/`name`/`value`, mirroring
    // mapUserDataToRecruiterUser).
    const skills = normalizeStringList(userData.skills);
    const languages = normalizeStringList(userData.languages);
    
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
      phoneE164: userData.phoneE164,
      phoneVerified: userData.phoneVerified === true,
      displayName: userData.displayName || `${userData.firstName || ''} ${userData.lastName || ''}`.trim(),
      city,
      state,
      resumeUrl,
      resume,
      skills,
      languages,
      transportMethod: typeof userData.transportMethod === 'string' ? userData.transportMethod : undefined,
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
      // Read the headshot/avatar verification status straight off the user doc.
      // When this isn't 'approved', the worker is blocked from self-confirming
      // shifts via respondToAssignment (Accept-flow headshot gate). Tile shows a
      // "Headshot {status}" chip so the recruiter sees the blocker before sending
      // the offer.
      headshotStatus: (() => {
        const av = userData.avatarVerification as { status?: string } | undefined;
        if (!av) {
          // No verification record at all → treat as missing for chip purposes
          // (so it's visible). When the worker uploads their first photo, the
          // onUserAvatarChangedVerify trigger creates the record.
          return userData.avatar ? 'pending' : 'missing';
        }
        const s = String(av.status || '').toLowerCase();
        if (s === 'approved') return 'approved';
        if (s === 'pending' || s === 'rejected' || s === 'error') return s;
        return 'missing';
      })(),
      headshotRejectionReason:
        ((userData.avatarVerification as { rejectionReason?: string } | undefined)?.rejectionReason as
          | string
          | undefined) || undefined,
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
  // Mirror of the above for REMOVES — without this the snapshot
  // listener fires with the still-present doc (cache or in-flight
  // delete) and overwrites the optimistic remove, making the
  // dragged-back tile pop back into Assignments until refresh.
  const pendingPlacementRemovesRef = useRef<Set<string>>(new Set());
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
        // R.16.2a — `placementHiringEntityId` (if the placement record
        // already pinned an entity) wins absolutely. Below that, the JO
        // doc's effective hiring entity flows through the snapshot-aware
        // helper: snapshot wins for non-draft JOs, fallback preserves
        // the legacy live read for drafts and pre-§16.1 active JOs.
        const joForRead = jobOrder as unknown as JobOrderForEffectiveRead | null | undefined;
        const { value: joHiring } = getEffectiveJobOrderField<string | null>(
          joForRead,
          'hiringEntityId',
          { fallback: (jobOrder as { hiringEntityId?: string | null })?.hiringEntityId ?? null },
        );
        const hiringEntityId = String(
          placementHiringEntityId ?? joHiring ?? ''
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
    // Prune entries no longer in the visible set BEFORE the new
    // listeners fire so a chip never lingers stale after a shift
    // change.
    setReadinessSnapByAssignmentId((prev) => {
      const next = new Map(prev);
      let mutated = false;
      for (const id of [...next.keys()]) {
        if (!allowed.has(id)) {
          next.delete(id);
          mutated = true;
        }
      }
      return mutated ? next : prev;
    });
    setAssignmentJobOrderIdByAssignmentId((prev) => {
      const next = new Map(prev);
      let mutated = false;
      for (const id of [...next.keys()]) {
        if (!allowed.has(id)) {
          next.delete(id);
          mutated = true;
        }
      }
      return mutated ? next : prev;
    });

    /**
     * Perf (2026-05-04 — Greg): originally one `onSnapshot` per
     * assignment, fanning N round-trips for the chip's first paint.
     * On shift drawers with many placements that translated into 1+
     * second of visible "computing…" chips while N independent
     * snapshot callbacks fired, each producing its own React
     * re-render of the entire PlacementsTab.
     *
     * Replaced with chunked `where(documentId(), 'in', [...])`
     * snapshot queries (Firestore caps `in` at 30 entries). Now N
     * docs land in O(N/30) round-trips with one state update per
     * chunk, and `docChanges()` keeps incremental updates cheap.
     */
    const collRef = collection(db, 'tenants', tenantId, 'assignments');
    const CHUNK = 30;
    const chunks: string[][] = [];
    for (let i = 0; i < assignmentIdsForReadinessSnapshot.length; i += CHUNK) {
      chunks.push(assignmentIdsForReadinessSnapshot.slice(i, i + CHUNK));
    }
    const unsubs = chunks.map((chunk) =>
      onSnapshot(
        query(collRef, where(documentId(), 'in', chunk)),
        (snap) => {
          // Coalesce all per-chunk doc changes into a single
          // setState per state slice so React batches.
          const presentIds = new Set<string>();
          const snapshotPatches: Array<[string, ReadinessSnapshotV1Firestore | null]> = [];
          const jobOrderPatches: Array<[string, string | null]> = [];
          snap.forEach((docSnap) => {
            const id = docSnap.id;
            presentIds.add(id);
            const data = docSnap.data() as {
              readinessSnapshotV1?: ReadinessSnapshotV1Firestore;
              jobOrderId?: string;
            };
            snapshotPatches.push([id, data.readinessSnapshotV1 ?? null]);
            const jid = String(data.jobOrderId || '').trim();
            jobOrderPatches.push([id, jid || null]);
          });
          // Any id we asked for but Firestore didn't return is a
          // tombstone (deleted). Mark it so the chip stops rendering
          // stale data.
          const missing = chunk.filter((id) => !presentIds.has(id));

          setReadinessSnapByAssignmentId((prev) => {
            const next = new Map(prev);
            for (const [id, val] of snapshotPatches) next.set(id, val);
            for (const id of missing) next.set(id, null);
            return next;
          });
          setAssignmentJobOrderIdByAssignmentId((prev) => {
            const next = new Map(prev);
            for (const [id, val] of jobOrderPatches) {
              if (val) next.set(id, val);
              else next.delete(id);
            }
            for (const id of missing) next.delete(id);
            return next;
          });
        },
        (err) => {
          console.warn('Readiness snapshot listener error:', err);
        },
      ),
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

  /**
   * Incomplete entity-onboarding requirement labels (identity / employment /
   * policies categories). Surfaced inside the Onboarding chip's tooltip so
   * a recruiter can see *what* is outstanding without leaving the tile.
   * Distinct from `placementBlockerLabelsForAssignmentId`, which only
   * returns the items that warrant a separate red blocker chip.
   */
  const placementOnboardingMissingLabelsForAssignmentId = useCallback(
    (assignmentId: string | undefined): string[] => {
      if (!assignmentId) return [];
      const reqs = readinessSnapByAssignmentId.get(assignmentId)?.requirements;
      return selectIncompleteOnboardingRequirementLabelsFromSnapshot(reqs);
    },
    [readinessSnapByAssignmentId],
  );

  /**
   * **R.4** — read pre-computed `jobReadinessChip` off the persisted snapshot.
   * `undefined` → no snapshot yet (chip renders the `'computing'` state).
   * `null` snapshot value or missing chip field → also `'computing'` (older
   * snapshots predating R.4 simply lack the field; sync writer will populate).
   */
  const placementJobReadinessChipDataForAssignmentId = useCallback(
    (assignmentId: string | undefined): JobReadinessChipData | null => {
      if (!assignmentId) return null;
      const snap = readinessSnapByAssignmentId.get(assignmentId);
      return snap?.jobReadinessChip ?? null;
    },
    [readinessSnapByAssignmentId],
  );

  /**
   * **R.4 + R.7** — drill-in handler for chip popover rows.
   *
   * Opens the worker profile in a new tab. Deep-link query carries enough
   * identity for the Worker Readiness tab (R.7) to:
   *   1. pre-select the right assignment via `assignmentId` (parent context —
   *      not on the contributor itself, threaded through here),
   *   2. highlight the matching requirement row via `itemId` / `type`.
   *
   * `source` is informational (drives label disambiguation in the popover
   * but the readiness tab uses `type` + `itemId` to match rows).
   *
   * Until R.7 lands the query was harmless / ignored. After R.7 the same
   * URL shape is honoured.
   */
  const handlePlacementJobReadinessItemClick = useCallback(
    (workerUid: string, assignmentId: string | null | undefined, contributor: JobReadinessChipContributor) => {
      if (!workerUid) return;
      const params = new URLSearchParams({
        tab: 'readiness',
        source: contributor.source,
        type: contributor.requirementType,
        itemId: contributor.itemId,
      });
      if (assignmentId && assignmentId.trim()) params.set('assignmentId', assignmentId);
      // **R.5 + R.6** — propagate the contributor's `caseId` so the
      // Readiness tab can auto-open the per-vendor drawer against the
      // precise case rather than falling back to "first item for this
      // worker × entity". The chip helper populates `caseId` for:
      //   - `e_verify`             (R.5) → `everify_cases/{caseId}`
      //   - `background_check`,
      //     `drug_screen`          (R.6) → `backgroundChecks/{checkId}`
      // For other types `caseId` is `undefined` and the param is
      // omitted. The Readiness tab routes by `type=` to the correct
      // drawer.
      if (contributor.caseId && contributor.caseId.trim()) params.set('caseId', contributor.caseId);
      window.open(`/users/${workerUid}?${params.toString()}`, '_blank', 'noopener,noreferrer');
    },
    [],
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

  // Persist filters to localStorage whenever they change. Skipped
  // in drawer mode (`lockedShiftId`) — otherwise the drawer's
  // per-shift defaults (forced shift id + "Shift Applicants"
  // workforce) would clobber the JO Detail page's saved preference
  // every time a recruiter clicked into a shift row.
  useEffect(() => {
    if (lockedShiftId) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify({
        shiftId: selectedShiftId,
        workforce: selectedWorkforce,
        day: selectedDay || undefined,
      }));
    } catch (err) {
      console.error('Error saving filters to localStorage:', err);
    }
  }, [lockedShiftId, selectedShiftId, selectedWorkforce, selectedDay, storageKey]);

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
        // Accept both `positions[]` (career / canonical) AND `gigPositions[]`
        // (gig JOs' historical write target). Greg, 2026-04-30 cascade audit.
        const positionsForLookup = (() => {
          const p = (jobOrderData as any)?.positions;
          if (Array.isArray(p) && p.length > 0) return p as Array<{ jobTitle: string; payRate: string | number }>;
          const g = (jobOrderData as any)?.gigPositions;
          return Array.isArray(g) ? (g as Array<{ jobTitle: string; payRate: string | number }>) : undefined;
        })();
        const defaultPayRate = jobOrderData?.payRate as number | undefined;

        // Helper to get pay rate for a shift
        const getPayRateForShift = (shift: any): number | undefined => {
          // First, check if shift already has payRate (snapshot at save
          // time by EditShiftForm — every new shift carries this).
          if (shift.payRate !== undefined && shift.payRate !== null) {
            const rate = typeof shift.payRate === 'number' ? shift.payRate : parseFloat(String(shift.payRate));
            return isNaN(rate) ? undefined : rate;
          }

          // Legacy fallback: case-insensitive title match across
          // `positions[]` / `gigPositions[]`.
          const title = String(shift.defaultJobTitle ?? '').trim().toLowerCase();
          if (title && positionsForLookup) {
            const position = positionsForLookup.find(
              (p) => String(p?.jobTitle ?? '').trim().toLowerCase() === title,
            );
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
        // When `lockedShiftId` is set (drawer mode), force the
        // selection to that shift regardless of persistence so a
        // recruiter never sees placements for a different shift.
        setSelectedShiftId((prev) => {
          if (sortedShifts.length === 0) return '';
          if (lockedShiftId && sortedShifts.some((s) => s.id === lockedShiftId)) {
            return lockedShiftId;
          }
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
  }, [tenantId, jobOrderId, lockedShiftId]);

  // Re-pin to `lockedShiftId` if the drawer reopens against a
  // different shift while shifts are already loaded — guards
  // against the user opening the drawer for shift A, closing,
  // then opening for shift B before `loadShifts` re-runs.
  useEffect(() => {
    if (!lockedShiftId) return;
    if (!shifts.some((s) => s.id === lockedShiftId)) return;
    setSelectedShiftId((prev) => (prev === lockedShiftId ? prev : lockedShiftId));
  }, [lockedShiftId, shifts]);

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

        /**
         * Per-userId candidate flag derived from the application docs.
         * True if ANY application that user has for this JO has
         * `candidate === true`. Used by `mergePoolWorker` to set
         * `Worker.isCandidate`, which the tile renders as a purple
         * "Candidate" chip alongside the readiness chips.
         *
         * Why this Set exists: the "All Applicants" pool now includes
         * candidates (2026-05-23 change — Greg's request was for
         * Applicants to be the superset). Without this flag the
         * recruiter would lose the at-a-glance candidate signal
         * when viewing the unified pool.
         */
        const candidateUserIdSet = new Set<string>();
        applicationDocsBundle.forEach(({ data }) => {
          if (data?.userId && data?.candidate === true) {
            candidateUserIdSet.add(String(data.userId));
          }
        });

        const mergePoolWorker = (base: Worker, uid: string): Worker => {
          const jf = jobFitMap.get(uid);
          const ns = appNoShowMap.get(uid);
          let next: Worker = base;
          if (jf !== undefined) next = { ...next, placementJobFitScore: jf };
          if (ns) next = { ...next, placementNoShowRisk: { ...ns, source: 'application' } };
          if (candidateUserIdSet.has(uid)) next = { ...next, isCandidate: true };
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

        // **Phase 4** — "Selected Day Applicants" pool: applied to *any*
        // shift on the JO whose date range overlaps `selectedDay`. Job-
        // level apps with no shift metadata are excluded (same as the
        // shift-scoped pools) so the day-scoped list doesn't silently
        // accumulate generic applications. Multi-day shifts require the
        // app's day metadata to include `selectedDay`.
        const selectedDayShiftIds = selectedDay
          ? shifts
              .filter((s) => {
                const start = (s as any).shiftDate as string | undefined;
                const end = ((s as any).endDate as string | undefined) ?? start;
                if (!start) return false;
                return selectedDay >= start && selectedDay <= (end as string);
              })
              .map((s) => s.id)
          : [];
        const includeApplicantForSelectedDay = (data: any) => {
          if (!selectedDay) return false;
          if (selectedDayShiftIds.length === 0) return false;
          if (!applicationHasShiftMetadata(data)) return false;
          if (!applicationMatchesAnyShift(data, selectedDayShiftIds)) return false;
          return applicationMatchesSelectedDay(data, selectedDay);
        };

        if (
          workforce === 'all_applicants' ||
          workforce === 'shift_applicants' ||
          workforce === 'selected_day_applicants'
        ) {
          const applicationDocs = applicationDocsBundle;
          const userIds = new Set<string>();
          applicationDocs.forEach(({ data }) => {
            if (!data.userId) return;
            // **2026-05-23, Greg's request** — Applicants pool is now a
            // superset that includes candidates. Removed the prior
            // `if (data.candidate === true) return;` exclusion. The
            // "Candidate" chip on the tile (see `Worker.isCandidate`)
            // still surfaces which entries are candidate-marked.
            if (isExcludedFromPlacementsApplicantPool(data.status)) return;
            if (workforce === 'shift_applicants') {
              if (!includeApplicantByShift(data)) return;
            } else if (workforce === 'selected_day_applicants') {
              if (!includeApplicantForSelectedDay(data)) return;
            } else if (!isCareerJob) {
              // all_applicants on a Gig — match any shift / any day
              if (!includeApplicantForAllDays(data)) return;
            }
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
          // Non-Gig: applicants for this job order and selected shift.
          // **2026-05-23** — Applicants is now a superset that
          // includes candidates (see the Gig branch above for the
          // same change + rationale). The Worker.isCandidate flag
          // routes through `mergePoolWorker` so the tile still tags
          // candidate-marked entries.
          const applicationDocs = applicationDocsBundle;
          const userIds = new Set<string>();
          applicationDocs.forEach(({ data }) => {
            if (!data.userId) return;
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
            /**
             * Per-member preference status keyed by userId. Source: the
             * group doc's `memberStatusById` map. Surfaced on each
             * `Worker.groupPrefStatus` so the tile can render the 4th
             * "group status" chip (Preferred / Member / Not Preferred).
             * Falls back to `'member'` when the user is in `memberIds`
             * but missing from `memberStatusById` (legacy data shape
             * before the per-member status field existed).
             */
            const rawStatusMap = (groupData.memberStatusById ?? {}) as Record<string, string>;
            const normalizePrefStatus = (raw: string | undefined): 'preferred' | 'member' | 'not_preferred' => {
              if (raw === 'preferred' || raw === 'not_preferred') return raw;
              return 'member';
            };

            // Load user documents with full profile data
            const userPromises = memberIds.map(async (userId: string): Promise<Worker | null> => {
              const userRef = doc(db, 'users', userId);
              const userSnap = await getDoc(userRef);
              if (!userSnap.exists()) return null;
              const base = extractWorkerData(userSnap.data(), userId);
              return {
                ...base,
                groupPrefStatus: normalizePrefStatus(rawStatusMap[userId]),
              };
            });

            const users = await Promise.all(userPromises);
            workforceUsers = users.filter((u): u is Worker => u !== null);
          }
        }
        
        /**
         * **Multi-group memberships (2026-06-02).** When the workforce
         * dropdown isn't a single group, attach each worker's membership
         * status across the JO's auto-messaging groups so the tiles can
         * surface Preferred / Member / Not Preferred chips per group.
         * The single-group branch above already sets `groupPrefStatus`
         * for the selected group; skip the per-group decoration there
         * to avoid double-rendering.
         */
        if (!selectedWorkforce.startsWith('group_')) {
          const autoGroupIds = ((jobOrder as any)?.autoMessagingUserGroupIds ?? []).filter(
            (s: unknown): s is string => typeof s === 'string' && !!s.trim(),
          );
          if (autoGroupIds.length > 0 && workforceUsers.length > 0) {
            const groupDocs = await Promise.all(
              autoGroupIds.map((gid: string) =>
                getDoc(doc(db, 'tenants', tenantId, 'userGroups', gid)).catch(() => null),
              ),
            );
            const groups = groupDocs
              .filter((s): s is NonNullable<typeof s> => !!s && s.exists())
              .map((s) => {
                const data = s.data();
                const memberIds: string[] = Array.isArray(data?.memberIds)
                  ? data!.memberIds
                  : Array.isArray(data?.members)
                    ? data!.members
                    : [];
                const memberStatusById = (data?.memberStatusById ?? {}) as Record<string, string>;
                const groupName =
                  typeof data?.title === 'string' && data.title.trim()
                    ? data.title.trim()
                    : typeof data?.name === 'string' && data.name.trim()
                      ? data.name.trim()
                      : s.id;
                return { id: s.id, groupName, memberIds: new Set(memberIds), memberStatusById };
              });

            const normalize = (raw: string | undefined): 'preferred' | 'member' | 'not_preferred' =>
              raw === 'preferred' || raw === 'not_preferred' ? raw : 'member';

            workforceUsers = workforceUsers.map((w) => {
              const memberships = groups
                .filter((g) => g.memberIds.has(w.id))
                .map((g) => ({
                  groupId: g.id,
                  groupName: g.groupName,
                  status: normalize(g.memberStatusById[w.id]),
                }));
              return memberships.length > 0 ? { ...w, groupMemberships: memberships } : w;
            });
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
  }, [tenantId, jobOrderId, selectedWorkforce, selectedShiftId, selectedDay, jobOrder, connectedJobPostIds, shifts, poolRefreshTick]);

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
            shiftId: String(data?.shiftId || selectedShiftId),
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
    // Optimistic hire injection — when a worker was just clicked-to-
    // hire but the Assignment doc snapshot hasn't propagated yet,
    // synthesize a `proposed` status so the tile chip flips out of
    // "Click to Hire" immediately. The effect that watches
    // `assignmentRows` clears these entries as soon as the real
    // server-side assignment row arrives.
    pendingHireWorkerIds.forEach((uid) => {
      if (!statusByUser.has(uid)) statusByUser.set(uid, 'proposed');
    });
    return {
      assignmentStatusByUserId: statusByUser,
      assignmentIdByUserId: idByUser,
      assignmentStartDateByUserId: startDateByUser,
      assignmentOfferSentAtByUserId: offerSentAtByUser,
      assignmentConfirmedAtByUserId: confirmedAtByUser,
      assignmentNoShowRiskByUserId: noShowByUser,
    };
  }, [assignmentRows, selectedDay, shifts, selectedShiftId, pendingHireWorkerIds]);

  // Clear pending-hire entries once the snapshot listener picks up
  // the real Assignment doc. We watch the RAW `assignmentRows` (not
  // the derived map, which already includes our optimistic entries)
  // so we can tell what the server actually has.
  useEffect(() => {
    if (pendingHireWorkerIds.size === 0) return;
    const realUserIds = new Set(assignmentRows.map((r) => r.userId));
    let changed = false;
    const next = new Set(pendingHireWorkerIds);
    pendingHireWorkerIds.forEach((uid) => {
      if (realUserIds.has(uid)) {
        next.delete(uid);
        changed = true;
      }
    });
    if (changed) setPendingHireWorkerIds(next);
  }, [assignmentRows, pendingHireWorkerIds]);

  // Real-time placements (placed but not yet assigned - no Assignment created, no messages sent).
  useEffect(() => {
    // Reset optimistic placement bookkeeping whenever the selected shift
    // changes. `pendingPlacementAddsRef` / `pendingPlacementRemovesRef` are
    // keyed by userId only (not shiftId), and the snapshot listener below
    // merges them into the placed set. Carrying them across a shift switch
    // leaked a just-placed worker onto OTHER shifts of the same job order
    // (2026-06-04 cross-shift placement-leak bug — e.g. workers placed on
    // "Day Cleaners" also showing on "PM Cleaners"). Each shift's own
    // placements snapshot is authoritative; the pending refs only matter
    // within a single shift to smooth the local-write → snapshot race.
    pendingPlacementAddsRef.current.clear();
    pendingPlacementRemovesRef.current.clear();

    if (!tenantId || !selectedShiftId) {
      setPlacementUserIds(new Set());
      setPlacementStartDateByUserId(new Map());
      return;
    }

    setPlacementUserIds(new Set());
    setPlacementStartDateByUserId(new Map());

    const placementsRef = collection(db, 'tenants', tenantId, 'placements');
    const placementsQuery = query(placementsRef, where('shiftId', '==', selectedShiftId));
    const unsubscribe = onSnapshot(
      placementsQuery,
      { includeMetadataChanges: true },
      (snapshot) => {
        const ids = new Set<string>();
        const startDates = new Map<string, string>();
        snapshot.docs.forEach((docSnap) => {
          const data = docSnap.data() as any;
          const userId = String(data?.userId || '');
          if (userId) {
            ids.add(userId);
            pendingPlacementAddsRef.current.delete(userId); // Confirmed by server
            const sd = typeof data?.startDate === 'string' ? data.startDate.trim() : '';
            if (sd && /^\d{4}-\d{2}-\d{2}$/.test(sd)) startDates.set(userId, sd);
          }
        });
        // Merge in optimistically added IDs so we don't overwrite with stale snapshot (race with local write)
        pendingPlacementAddsRef.current.forEach((id) => ids.add(id));
        // Honor optimistic REMOVES the same way. If the server still
        // shows the placement, keep it hidden until the delete
        // propagates. When the server confirms removal (id no longer
        // in the snapshot's `ids`), clear the pending entry so future
        // re-adds from another tab/user surface normally.
        pendingPlacementRemovesRef.current.forEach((id) => {
          if (ids.has(id)) ids.delete(id);
          else pendingPlacementRemovesRef.current.delete(id);
        });
        setPlacementUserIds(ids);
        setPlacementStartDateByUserId(startDates);
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
        // Placement-only workers get their start date from the placement doc
        // (`placementStartDateByUserId`); workers with assignments use the
        // assignment doc's startDate. Both feed the same `assignmentStartDate`
        // field on Worker so display + edit logic stays unified.
        const effectiveStartDate = isPlacementOnly
          ? placementStartDateByUserId.get(userId)
          : assignmentStartDateByUserId.get(userId);
        return {
          ...withFit,
          isAssignedToShift: true,
          isPlacementOnly,
          assignmentStatus,
          assignmentId: assignmentIdByUserId.get(userId),
          confirmationStatus,
          assignmentStartDate: effectiveStartDate,
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
    placementStartDateByUserId,
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

  /**
   * Groups the recruiter has picked via the "Choose Group" autocomplete
   * during this session.
   *
   * Why this state exists: `getWorkforceOptions()` derives the dropdown
   * from `jobOrder.placementsLastGroup` + `jobOrder.laborPoolGroups`. When
   * the user picks a new group via the autocomplete we
   * `setSelectedWorkforce('group_<id>')` synchronously and write
   * `placementsLastGroup` to Firestore in the background — but the JO
   * doc refresh round-trip lands several ms later.
   *
   * In that gap, `workforceOptions` does NOT yet include the new
   * `group_<id>`, so the reset effect below fires
   * (`valid=false → setSelectedWorkforce(options[0])`) and snaps the
   * selection back to "Applicants" before the user can do anything with
   * the group. This regression made "Choose Group" appear broken even
   * though the group was being saved correctly.
   *
   * Solution: remember every group picked this session in a local map
   * and merge it into `workforceOptions` synchronously, so the picked
   * group is in the list the same render it's selected. The Firestore
   * write still happens (so the choice survives reload), but the UI no
   * longer depends on its completion.
   */
  const [sessionPickedGroups, setSessionPickedGroups] = useState<Map<string, string>>(
    () => new Map(),
  );
  const workforceOptions = useMemo(
    () => getWorkforceOptions(),
    // `selectedDay` is in the dep list because `getWorkforceOptions`
    // conditionally surfaces the "Selected Day Applicants" entry only
    // when a day filter is active (Phase 4). Without this dep, switching
    // the day filter wouldn't refresh the dropdown.
    [jobOrder, userGroups, sessionPickedGroups, selectedDay],
  );
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
      // Drop from session-picked map so the removed group doesn't get
      // resurrected by `getWorkforceOptions` on the next render.
      setSessionPickedGroups((prev) => {
        if (!prev.has(groupId)) return prev;
        const next = new Map(prev);
        next.delete(groupId);
        return next;
      });
      if (selectedWorkforce === groupValue) setSelectedWorkforce('choose_group');
      onJobOrderUpdated?.();
    } catch (err) {
      console.error('Error removing group from workforce:', err);
      setError((err as Error)?.message ?? 'Failed to remove group');
    }
  };

  // Build workforce options. For Gigs: All Applicants, All Candidates,
  // (optional) Selected Day Applicants, Shift Applicants, Shift Candidates,
  // then groups. For non-Gigs: Applicants, Candidates, then groups.
  //
  // **Phase 4** — when a day filter is active on a multi-day Gig we
  // surface a `selected_day_applicants` option scoped to *all* shifts on
  // that day (not just the expanded one). That's the missing middle
  // ground between "All Applicants" (ignore day) and "Shift Applicants"
  // (one specific shift). Hidden when no day is selected so the dropdown
  // doesn't accumulate a confusing dead option.
  function getWorkforceOptions() {
    const jobType = String((jobOrder as any)?.jobType || '').toLowerCase();
    const isGig = jobType === 'gig';

    const options: Array<{ value: string; label: string }> = isGig
      ? [
          { value: 'all_applicants', label: 'All Applicants' },
          { value: 'all_candidates', label: 'All Candidates' },
          // Inserted only when there's a day to be scoped to — see
          // header doc-comment above for rationale.
          ...(selectedDay
            ? [{ value: 'selected_day_applicants', label: 'Selected Day Applicants' }]
            : []),
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

    // Add every group the recruiter has picked via Choose Group during
    // this session. This bridges the gap between the synchronous
    // setSelectedWorkforce('group_<id>') call and the JO doc refresh —
    // see the long comment on `sessionPickedGroups` for the bug this
    // fixes. Order: appended after `placementsLastGroup` so the most
    // recent pick is naturally last (also matches the dropdown UX of
    // "newest pick at the bottom").
    sessionPickedGroups.forEach((groupName, groupId) => {
      if (options.some((o) => o.value === `group_${groupId}`)) return;
      options.push({ value: `group_${groupId}`, label: groupName });
    });

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

  const assignWorkersToShift = async (
    workerIds: string[],
    dayOverride?: string,
    options?: { allowOverlapping?: boolean },
  ) => {
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
      if (options?.allowOverlapping) {
        // Recruiter explicitly overrode the overlap guard via the
        // "Assign anyway" snackbar action (or programmatically). Server
        // logs `overlapping_assignment_overridden` in warnings.
        payload.allowOverlapping = true;
      }
      const assignFn = httpsCallable(functions, 'placementsCreateAssignments');
      const response = await assignFn(payload);

      const data = response.data as any;
      const created = Array.isArray(data?.created) ? data.created : [];
      const createdCount = created.length;
      const skipped: Array<{ userId: string; reason: string }> = Array.isArray(data?.skipped)
        ? data.skipped
        : [];

      // Soft-skip recovery (Kalijah Emmanuel bug, 2026-06-08): the server
      // returns 200 with `{ created: [...], skipped: [{userId, reason}] }`
      // when a worker can't be hired (overlapping_assignment,
      // already_assigned_to_shift, user_not_found). The previous code only
      // wrote a generic error string and left the optimistic
      // `pendingHireWorkerIds` entry in place — which left the tile stuck
      // on "Accepted" with no Confirm button because:
      //   1. statusByUser had 'proposed' (from the optimistic injection)
      //   2. idByUser had nothing (no real assignment doc ever existed)
      //   3. the cleanup effect only fires when a row appears in
      //      `assignmentRows`, which never happened for a skipped worker.
      // Now we explicitly drop skipped uids from pendingHireWorkerIds so
      // their tile flips back to "Click to Hire" + we surface a
      // worker-specific error so the recruiter knows why.
      if (skipped.length > 0) {
        const skippedUserIds = new Set(skipped.map((s) => s?.userId).filter(Boolean) as string[]);
        if (skippedUserIds.size > 0) {
          setPendingHireWorkerIds((prev) => {
            let changed = false;
            const next = new Set(prev);
            skippedUserIds.forEach((uid) => {
              if (next.delete(uid)) changed = true;
            });
            return changed ? next : prev;
          });
        }
      }

      // Resolve a name for each worker in the batch (used by both the
      // success toast + the failure breakdown).
      const nameById = new Map<string, string>();
      const allLists = [assignmentWorkersList, availableWorkers];
      for (const list of allLists) {
        for (const w of list) {
          const nm = w.displayName || [w.firstName, w.lastName].filter(Boolean).join(' ').trim();
          if (nm) nameById.set(w.id, nm);
        }
      }
      const shiftLabel = selectedShift
        ? String((selectedShift as any).title || (selectedShift as any).jobTitle || (selectedShift as any).name || 'this shift')
        : 'this shift';

      if (skipped.length > 0) {
        // Build a worker-name-aware error so the recruiter sees who was
        // rejected and why ("Jane Doe — already on another shift today").
        const reasonLabel = (reason: string): string => {
          switch (reason) {
            case 'overlapping_assignment':
              return 'already on another shift that overlaps this one';
            case 'already_assigned_to_shift':
              return 'already assigned to this shift';
            case 'user_not_found':
              return 'user record not found';
            default:
              return reason || 'unknown reason';
          }
        };
        const lines = skipped.map((s) => {
          const nm = nameById.get(s.userId) || s.userId.slice(0, 8);
          return `${nm} — ${reasonLabel(s.reason)}`;
        });
        // If every skip is `overlapping_assignment`, the recruiter can
        // override with one tap on the toast. Surface the action — same
        // call again with allowOverlapping=true. Mixed-reason batches
        // (e.g. one overlap + one user_not_found) don't get the action
        // since the override only helps the overlap cases.
        const overlappingUserIds = skipped
          .filter((s) => s.reason === 'overlapping_assignment')
          .map((s) => s.userId);
        const allSkipsAreOverlap =
          skipped.length > 0 && overlappingUserIds.length === skipped.length;
        const overrideAction =
          allSkipsAreOverlap && !options?.allowOverlapping
            ? {
                label: overlappingUserIds.length > 1 ? 'Assign all anyway' : 'Assign anyway',
                workerIds: overlappingUserIds,
                dayOverride,
              }
            : undefined;

        if (createdCount === 0) {
          const msg = `Could not assign: ${lines.join('; ')}`;
          setError(msg);
          setAssignToast({ message: msg, severity: 'error', overrideAction });
        } else {
          // Mixed batch: some hired, some skipped. Don't mask the
          // partial success — but tell the recruiter what fell out.
          const createdNames = created
            .map((c: { userId: string }) => nameById.get(c.userId) || c.userId.slice(0, 8))
            .join(', ');
          const msg = `Assigned ${createdNames} to ${shiftLabel}. Skipped ${skipped.length}: ${lines.join('; ')}`;
          setError(msg);
          setAssignToast({ message: msg, severity: 'info', overrideAction });
        }
      } else {
        setError(null);
        if (createdCount > 0) {
          const createdNames = created
            .map((c: { userId: string }) => nameById.get(c.userId) || c.userId.slice(0, 8))
            .join(', ');
          setAssignToast({
            message: `Assigned ${createdNames} to ${shiftLabel} — offer SMS sent.`,
            severity: 'success',
          });
        }
      }

      created.forEach((entry: { userId: string; assignmentId: string }) => {
        if (entry?.userId && entry?.assignmentId) {
          logAssignmentUpdateActivity(entry.userId, entry.assignmentId, 'placed').catch((e) =>
            console.warn('Failed to log assignment placed activity:', e),
          );
        }
      });

      // Return so callers (handleConfirmPlacement, bulk hire) can tell
      // whether their specific worker actually got hired. Without this,
      // an all-skipped batch silently leaves the optimistic-hire flag
      // stuck — the catch path below only fires for hard HttpsErrors.
      return { created, skipped };
    } catch (err: any) {
      console.error('Error assigning workers to shift:', err);
      setError(err?.message || 'Failed to assign worker(s) to shift');
      // Hard failure path — bubble so callers can revert their optimistic
      // state and stop the chip from being stuck on "Accepted" forever.
      throw err;
    }
  };

  // Handle assign to shift (create new assignment from pool). Pass selected day when set.
  // `assignWorkersToShift` now throws on hard failures (HttpsError); the
  // drag-and-drop callback that invokes this would silently warn if
  // we let that bubble. Swallow with a console.error — assignWorkersToShift
  // already calls setError() with a recruiter-readable message.
  const handleAssignToShift = async (worker: Worker, shift: Shift | undefined) => {
    if (!shift || !worker.id) return;
    try {
      await assignWorkersToShift([worker.id], selectedDay || undefined);
    } catch (err) {
      console.error('handleAssignToShift failed:', err);
    }
  };

  /**
   * SILENTLY remove a worker's application from the SELECTED shift only —
   * no notification fires (we mutate the application's shift arrays, not its
   * status; the withdrawn/deleted cascade only watches status changes).
   *
   * Use case: a worker applied to both the AM and PM shift (open to either).
   * Once you accept them for one, you can manually drop the other so they
   * don't get hired for two shifts the same day — kept manual so you CAN
   * still double-book intentionally.
   */
  const handleRemoveApplicationFromShift = async (worker: Worker) => {
    if (!worker.id || !selectedShiftId || !tenantId) return;
    const name = [worker.firstName, worker.lastName].filter(Boolean).join(' ') || 'this applicant';
    const ok = window.confirm(
      `Remove ${name} from this shift's applicants?\n\nThis silently drops their application for THIS shift only — no message is sent, and their applications to other shifts are unaffected.`
    );
    if (!ok) return;
    try {
      const appsRef = collection(db, 'tenants', tenantId, 'applications');
      const snap = await getDocs(query(appsRef, where('userId', '==', worker.id)));
      const joIds = new Set<string>([jobOrderId, ...connectedJobPostIds].filter(Boolean));
      let removed = 0;
      for (const d of snap.docs) {
        const data = d.data() as Record<string, any>;
        const belongsToJO =
          joIds.has(String(data.jobOrderId || '')) ||
          joIds.has(String(data.jobId || '')) ||
          joIds.has(String(data.postId || ''));
        if (!belongsToJO) continue;
        if (!applicationMatchesShift(data, selectedShiftId)) continue;
        const shiftIds: string[] = Array.isArray(data.shiftIds) ? data.shiftIds.map(String) : [];
        const newShiftIds = shiftIds.filter((s) => s !== selectedShiftId);
        const selectedShifts: any[] = Array.isArray(data.selectedShifts) ? data.selectedShifts : [];
        const newSelectedShifts = selectedShifts.filter(
          (s) => String(s?.shiftId ?? s) !== selectedShiftId
        );
        const patch: Record<string, unknown> = {
          shiftIds: newShiftIds,
          selectedShifts: newSelectedShifts,
          updatedAt: serverTimestamp(),
        };
        // Clear the legacy single shiftId if it pointed at the removed shift.
        if (String(data.shiftId || '') === selectedShiftId) {
          patch.shiftId = newShiftIds[0] || '';
        }
        // Plain field update — NOT a status change — so no worker SMS/push fires.
        await updateDoc(doc(db, 'tenants', tenantId, 'applications', d.id), patch);
        removed += 1;
      }
      if (removed === 0) {
        setError(`No application found for ${name} on this shift.`);
      }
      setPoolRefreshTick((n) => n + 1);
    } catch (err) {
      console.error('handleRemoveApplicationFromShift failed:', err);
      setError((err as Error)?.message ?? 'Failed to remove applicant from shift');
    }
  };

  // Handle offering position: create Assignment (sends accept/decline message). Pass selected day so
  // assignment is for that day only when a day is selected; for "All days" we send all dates.
  const handleConfirmPlacement = async (worker: Worker) => {
    if (!worker.isPlacementOnly || !selectedShift) return;
    // Per-worker guard — only block re-clicking THIS same worker.
    // Previously a global `if (confirmingPlacementUserId) return` blocked
    // every chip while any hire was in flight, forcing the recruiter to
    // wait (or refresh) between clicks. With the optimistic hire below,
    // the clicked tile flips out of placement-only state immediately, so
    // duplicate clicks are also prevented by the chip becoming
    // un-clickable.
    if (pendingHireWorkerIds.has(worker.id)) return;
    setConfirmingPlacementUserId(worker.id);
    // Optimistic — flip the chip from "Click to Hire" → "Accepted"
    // before the callable RTT. Reverted in the catch block on failure.
    setPendingHireWorkerIds((prev) => {
      const next = new Set(prev);
      next.add(worker.id);
      return next;
    });
    try {
      setError(null);
      // Prefer the placement-specific start date the recruiter set via the
      // edit pencil before hiring. Falls back to the day picker, then to the
      // shift's default. The server's `placementsCreateAssignments` reads
      // this as `applyDate` and uses it as `effectiveStartDate`.
      const placementStartDate = placementStartDateByUserId.get(worker.id);
      const dayOverride = placementStartDate || (selectedDay || undefined);
      await assignWorkersToShift([worker.id], dayOverride);
      if (selectedDay === '') {
        await deletePlacement(worker);
      }
    } catch (err: any) {
      console.error('Error offering position:', err);
      setError(err?.message || 'Failed to offer position');
      // Revert optimistic hire so the chip flips back to "Click to Hire".
      setPendingHireWorkerIds((prev) => {
        if (!prev.has(worker.id)) return prev;
        const next = new Set(prev);
        next.delete(worker.id);
        return next;
      });
    } finally {
      setConfirmingPlacementUserId(null);
    }
  };

  /**
   * Cancel assignment(s). When "All days" selected, cancel all assignments
   * for this user on this shift.
   *
   * Optimistic-UI contract:
   *   1. We synchronously transform the visible row in `assignmentWorkersList`
   *      so the chip flips to "Placed" (or the row is removed when no
   *      placement exists) BEFORE the callable RTT — recruiters see the
   *      action take effect on click instead of waiting on the
   *      `placementsCancelAssignment` callable, which can spend 10s+
   *      sending offer-cancelled notifications and updating downstream
   *      docs. The previous flow only set `pendingAssignmentCancels`,
   *      which forced the UI to wait for the load() effect to re-run a
   *      batch of `getDoc`s before the chip updated.
   *   2. We still flag the uid in `pendingAssignmentCancels` so the
   *      reconciling `load()` effect doesn't overwrite our optimistic
   *      transform with a stale `assignmentStatusByUserId.get(userId)`
   *      value before Firestore catches up.
   *   3. On callable failure (e.g. INTERNAL — observed in the wild), we
   *      clear `pendingAssignmentCancels`, which retriggers the load()
   *      effect and pulls the original assignment status back from
   *      Firestore truth, restoring the tile.
   */
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
    const hasPlacement = placementUserIds.has(worker.id);
    setAssignmentWorkersList((prev) => {
      if (hasPlacement) {
        return prev.map((w) =>
          w.id === worker.id
            ? {
                ...w,
                assignmentStatus: undefined,
                assignmentId: undefined,
                isPlacementOnly: true,
                confirmationStatus: undefined,
                assignmentOfferSentAt: undefined,
                assignmentConfirmedAt: undefined,
              }
            : w,
        );
      }
      // No placement to fall back to (rare — workers usually progress
      // Placed → Accepted → Confirmed, so they always have a placement
      // doc when cancellable). Drop them from the list rather than show
      // a stale Confirmed chip.
      return prev.filter((w) => w.id !== worker.id);
    });
    setPendingAssignmentCancels((prev) => new Set([...prev, worker.id]));
    try {
      setError(null);
      const cancelFn = httpsCallable(functions, 'placementsCancelAssignment');
      await Promise.all(
        assignmentIds.map((assignmentId) =>
          cancelFn({ tenantId, assignmentId, shiftId: selectedShiftId, userId: worker.id }),
        ),
      );
      // Success: leave the optimistic transform in place. Firestore
      // subscription on placements/assignments will eventually update
      // `assignmentStatusByUserId` to 'cancelled', the load() effect
      // re-runs, and our same shape (Placed) is rebuilt deterministically
      // — no flicker.
    } catch (err: any) {
      console.error('Error cancelling assignment:', err);
      setError(err?.message || 'Failed to cancel assignment');
      // Revert: clearing the pending flag retriggers `assignedUserIds`
      // → load() effect → fresh `assignmentStatusByUserId.get(userId)`
      // value (still the original 'confirmed' / 'accepted'), which
      // rebuilds the row with its prior chip. No need to manually
      // restore fields here — the load() effect is the source of truth.
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

  /**
   * Per-worker confirmation resend. Mirrors `handleResendOffer` but for
   * the post-confirmation state — the refresh icon next to the
   * "Confirmed Jun X" timestamp on confirmed tiles. Sends the latest
   * assignment-details email + a short SMS pointer to one worker.
   * Shares loading + cooldown state with the offer-resend path so we
   * don't burn one debounce on each (recruiter-intent is "resend this
   * worker's message" regardless of which side of confirmation it is).
   */
  const handleResendConfirmation = async (worker: Worker) => {
    if (!worker.assignmentId || !tenantId) return;
    const aid = worker.assignmentId;
    if (resendLoadingAssignmentId === aid) return;
    const cooldownUntil = resendCooldownUntilByAssignmentId[aid] ?? 0;
    if (Date.now() < cooldownUntil) return;
    try {
      setResendLoadingAssignmentId(aid);
      setError(null);
      const resendFn = httpsCallable(functions, 'resendAssignmentConfirmation');
      await resendFn({ tenantId, assignmentId: aid });
      setResendCooldownUntilByAssignmentId((prev) => ({ ...prev, [aid]: Date.now() + RESEND_COOLDOWN_MS }));
    } catch (err: any) {
      console.error('Error resending confirmation:', err);
      setError(err?.message || 'Failed to resend confirmation');
    } finally {
      setResendLoadingAssignmentId(null);
    }
  };

  /**
   * Revert a declined OR cancelled assignment back to 'pending' (awaiting
   * worker confirm). Recruiter clicks the red chip — for decline it's
   * "undo the worker's decline so I can re-offer / confirm on their
   * behalf"; for cancel it's "undo my mistake cancellation".
   *
   * Both call distinct server callables (`revertAssignmentDecline` /
   * `revertAssignmentCancel`) because the application-side and audit
   * field cleanup is status-specific. Multi-day "All days" mode sweeps
   * every matching status row for the worker on this shift in one click.
   */
  const handleRevertTerminalStatus = async (
    worker: Worker,
    fromStatus: 'declined' | 'cancelled',
  ) => {
    if (!tenantId) return;
    const matchStatus = (s: string | undefined): boolean =>
      fromStatus === 'declined'
        ? s === 'declined'
        : s === 'cancelled' || s === 'canceled';
    const targetAssignmentIds =
      selectedDay === ''
        ? assignmentRows
            .filter((r) => r.userId === worker.id && matchStatus(r.status))
            .map((r) => r.assignmentId)
        : worker.assignmentId && matchStatus(worker.assignmentStatus)
          ? [worker.assignmentId]
          : [];
    if (targetAssignmentIds.length === 0) return;
    if (confirmLoadingAssignmentId === worker.id) return;
    const fnName =
      fromStatus === 'declined' ? 'revertAssignmentDecline' : 'revertAssignmentCancel';
    const errorVerb = fromStatus === 'declined' ? 'revert decline' : 'revert cancellation';
    try {
      setConfirmLoadingAssignmentId(worker.id);
      setError(null);
      const revertFn = httpsCallable(functions, fnName);
      await Promise.all(
        targetAssignmentIds.map((aid) => revertFn({ tenantId, assignmentId: aid })),
      );
    } catch (err: any) {
      console.error(`Error during ${errorVerb}:`, err);
      setError(err?.message || `Failed to ${errorVerb}`);
    } finally {
      setConfirmLoadingAssignmentId(null);
    }
  };

  const handleRevertDecline = (worker: Worker) => handleRevertTerminalStatus(worker, 'declined');
  const handleRevertCancel = (worker: Worker) => handleRevertTerminalStatus(worker, 'cancelled');

  /**
   * Per-shift "resend confirmation to all confirmed staff" — fires the
   * `resendShiftConfirmationsToConfirmedStaff` callable for the given
   * shift. Each card has its own loading flag keyed by shiftId so two
   * resends on different cards can run concurrently without their
   * spinners colliding.
   */
  const [resendingShiftIds, setResendingShiftIds] = useState<Set<string>>(new Set());
  const handleResendShiftConfirmations = async (shiftId: string) => {
    if (!tenantId || !shiftId) return;
    if (resendingShiftIds.has(shiftId)) return;
    // Light client-side confirm prompt. The recruiter is about to send
    // N emails + N SMSes; one tap of the icon shouldn't yeet that out
    // without a sanity check. We don't list every worker by name (the
    // card already shows them); the count is sufficient context.
    const confirmedWorkerCount = assignmentRows.filter(
      (r) =>
        r.shiftId === shiftId &&
        (r.status === 'confirmed' || r.status === 'active'),
    ).length;
    if (confirmedWorkerCount === 0) {
      setError('No confirmed workers on this shift to resend to.');
      return;
    }
    const ok = window.confirm(
      `Resend the confirmation email and SMS to ${confirmedWorkerCount} confirmed worker${confirmedWorkerCount === 1 ? '' : 's'} on this shift?\n\n` +
        'Each will receive the latest shift-details email (reflecting any recent edits to the JO/shift) plus a short SMS pointing them at it.',
    );
    if (!ok) return;
    try {
      setResendingShiftIds((prev) => {
        const next = new Set(prev);
        next.add(shiftId);
        return next;
      });
      setError(null);
      const resendFn = httpsCallable<
        { tenantId: string; shiftId: string; jobOrderId?: string },
        { sent: number; skipped: number; failed: number; totalConfirmed: number; errors: any[] }
      >(functions, 'resendShiftConfirmationsToConfirmedStaff');
      const { data } = await resendFn({
        tenantId,
        shiftId,
        ...(jobOrderId ? { jobOrderId } : {}),
      });
      const parts: string[] = [];
      if (data.sent > 0) parts.push(`✓ ${data.sent} sent`);
      if (data.skipped > 0) parts.push(`⚠ ${data.skipped} skipped`);
      if (data.failed > 0) parts.push(`✗ ${data.failed} failed`);
      // Use the existing error banner channel since it's already
      // surfaced inside the page — success messages render as info.
      // (If/when a tenant adopts a real snackbar component we can
      // swap this to severity='success'.)
      window.alert(
        `Resend complete for ${data.totalConfirmed} confirmed worker${data.totalConfirmed === 1 ? '' : 's'}.\n\n${parts.join(' · ') || 'No actionable results.'}` +
          (data.errors && data.errors.length > 0
            ? `\n\nFirst error: ${data.errors[0]?.error || 'unknown'}`
            : ''),
      );
    } catch (err: any) {
      console.error('Error resending shift confirmations:', err);
      setError(err?.message || 'Failed to resend confirmations');
    } finally {
      setResendingShiftIds((prev) => {
        const next = new Set(prev);
        next.delete(shiftId);
        return next;
      });
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
  // Show the silent "remove from shift" action only in the shift-scoped
  // applicant pools (where each card maps to an application for THIS shift).
  const isShiftApplicantPool =
    selectedWorkforce === 'shift_applicants' ||
    selectedWorkforce === 'selected_day_applicants' ||
    selectedWorkforce === 'shift_candidates';

  /**
   * Phase 2: shifts that should appear as cards in the Assignments
   * column. Default = all shifts on the JO. When a day filter is set,
   * narrow to shifts whose date range includes that day (single-day
   * shifts → equality; multi-day gigs → date in [shiftDate, endDate]).
   *
   * Drawer mode (`lockedShiftId`) collapses to the single pinned
   * shift so the drawer's mental model stays per-shift.
   */
  const visibleShifts = useMemo(() => {
    if (lockedShiftId) {
      const locked = shifts.find((s) => s.id === lockedShiftId);
      return locked ? [locked] : [];
    }
    if (!selectedDay) return shifts;
    return shifts.filter((shift) => {
      const start = (shift as any).shiftDate as string | undefined;
      const end = ((shift as any).endDate as string | undefined) ?? start;
      if (!start) return false;
      // Inclusive bounds; YYYY-MM-DD strings compare lexically.
      return selectedDay >= start && selectedDay <= (end as string);
    });
  }, [shifts, selectedDay, lockedShiftId]);

  /**
   * Phase 2 accordion: only one card is expanded at a time. The
   * expanded card is the data anchor — its shiftId is also pushed
   * into `selectedShiftId` so the existing listeners + Worker Pool
   * "Shift Applicants" filter keep working. Default = first visible
   * shift expanded, rest collapsed (matches the "first card expanded"
   * UX Greg confirmed).
   *
   * The `userExplicitlyCollapsedRef` distinguishes "initial null
   * before visibleShifts loads" from "user clicked to collapse the
   * expanded card". Without this guard the auto-bump effect below
   * would treat any null as "no current expand → set to first" and
   * collapsing the only-open card would snap right back open.
   */
  const [expandedShiftId, setExpandedShiftId] = useState<string | null>(null);
  const userExplicitlyCollapsedRef = useRef(false);
  // Auto-bump cases:
  //   1) No visible shifts → null
  //   2) Initial load with visibleShifts populated and user hasn't
  //      interacted yet → expand the first one
  //   3) Currently expanded shift dropped out of visibleShifts (e.g.
  //      day filter changed) → fall back to the first visible shift
  // Explicit user-collapse (null AND userExplicitlyCollapsedRef true)
  // is respected and left alone.
  useEffect(() => {
    if (visibleShifts.length === 0) {
      if (expandedShiftId !== null) setExpandedShiftId(null);
      return;
    }
    if (expandedShiftId !== null) {
      const stillVisible = visibleShifts.some((s) => s.id === expandedShiftId);
      if (!stillVisible) setExpandedShiftId(visibleShifts[0].id);
      return;
    }
    // expandedShiftId === null. Only auto-expand on initial load;
    // after the user has explicitly collapsed, leave it null.
    if (!userExplicitlyCollapsedRef.current) {
      setExpandedShiftId(visibleShifts[0].id);
    }
  }, [visibleShifts, expandedShiftId]);
  // Keep `selectedShiftId` in sync with the expanded card so the
  // legacy single-shift data layer (listeners, displayedAssignedWorkers,
  // Worker Pool's "Shift Applicants" filter) follows the expanded card.
  // Phase 5 reframes `selectedShiftId` semantically as "the anchor for
  // shift-scoped Worker Pool filters" — this sync is the first step.
  useEffect(() => {
    if (expandedShiftId && expandedShiftId !== selectedShiftId) {
      setSelectedShiftId(expandedShiftId);
    }
  }, [expandedShiftId, selectedShiftId]);

  const handleToggleShiftExpand = useCallback((shiftId: string) => {
    setExpandedShiftId((prev) => {
      if (prev === shiftId) {
        // User collapsed the open card — mark so the auto-bump effect
        // doesn't immediately re-expand it.
        userExplicitlyCollapsedRef.current = true;
        return null;
      }
      // Expanding a different card clears the collapsed-flag — auto-
      // bump is welcome again if this new shift later drops out.
      userExplicitlyCollapsedRef.current = false;
      return shiftId;
    });
  }, []);

  /**
   * **Phase 5** — top-of-page shift picker becomes a "jump to + expand"
   * shortcut. Picking a shift in the dropdown expands that card in the
   * Assignments column (and collapses any other open one). When the
   * picked shift isn't currently in `visibleShifts` (e.g. the day
   * filter excludes it), we also clear `selectedDay` so the card
   * becomes visible — otherwise the user would pick a shift and see
   * nothing change.
   *
   * Picking the empty value (the "Select shift" placeholder) collapses
   * the accordion and sets `userExplicitlyCollapsedRef.current = true`
   * so the auto-bump effect doesn't immediately re-expand the first
   * card.
   */
  const handleJumpToShift = useCallback((shiftId: string) => {
    if (!shiftId) {
      userExplicitlyCollapsedRef.current = true;
      setExpandedShiftId(null);
      return;
    }
    // If the picked shift isn't in the current visibleShifts (day
    // filter excludes it), clear the day filter so the card appears.
    const inVisible = visibleShifts.some((s) => s.id === shiftId);
    if (!inVisible && selectedDay) {
      setSelectedDay('');
    }
    userExplicitlyCollapsedRef.current = false;
    setExpandedShiftId(shiftId);
  }, [visibleShifts, selectedDay]);

  const jobType = String((jobOrder as any)?.jobType || '').toLowerCase();
  const isGigMultiDay =
    jobType === 'gig' &&
    selectedShift &&
    (selectedShift as any).dateSchedule &&
    (selectedShift as any).endDate &&
    (selectedShift as any).endDate !== (selectedShift as any).shiftDate;
  /**
   * Days inside the *currently-expanded* multi-day shift's `dateSchedule`.
   * Used by `ShiftAssignmentCard` for the per-day staff/overstaff lookup
   * — that read is meaningful only when one shift spans multiple days,
   * so it stays scoped to the expanded shift.
   */
  const dayOptions = useMemo(() => {
    if (!isGigMultiDay || !selectedShift) return [];
    return getDateScheduleEntriesWithHours(
      (selectedShift as any).dateSchedule,
      (selectedShift as any).shiftDate,
      (selectedShift as any).endDate,
    );
  }, [isGigMultiDay, selectedShift]);

  /**
   * **JO-wide day picker (2026-05-23)** — union of every distinct day
   * touched by any shift on this JO. Single-day shifts contribute their
   * `shiftDate`; multi-day shifts contribute every day in their
   * `dateSchedule`. Powers the top "Day" filter so a JO with many
   * single-day shifts on different dates (e.g. Loader/Crew shifts
   * spread across April–June) gets a usable day filter — previously
   * the picker only showed when the expanded shift was itself
   * multi-day, leaving JOs with many separate single-day shifts with
   * no day-narrowing UI.
   *
   * Returns `{ date, dayLabel }[]` sorted ascending by date.
   */
  const joDayOptions = useMemo(() => {
    const seen = new Map<string, string>();
    const formatLabel = (yyyyMmDd: string) => {
      const [y, m, d] = yyyyMmDd.split('-').map(Number);
      if (!y || !m || !d) return yyyyMmDd;
      const date = new Date(y, m - 1, d);
      return date.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    };
    shifts.forEach((shift) => {
      const dateSchedule = (shift as any).dateSchedule;
      const start = (shift as any).shiftDate as string | undefined;
      const end = ((shift as any).endDate as string | undefined) ?? start;
      if (dateSchedule && end && start && end !== start) {
        // Multi-day shift → enumerate via the existing helper.
        const entries = getDateScheduleEntriesWithHours(dateSchedule, start, end);
        entries.forEach((entry) => {
          if (entry?.date && !seen.has(entry.date)) {
            seen.set(entry.date, entry.dayLabel ?? formatLabel(entry.date));
          }
        });
      } else if (start) {
        if (!seen.has(start)) seen.set(start, formatLabel(start));
      }
    });
    return Array.from(seen.entries())
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([date, dayLabel]) => ({ date, dayLabel }));
  }, [shifts]);

  useEffect(() => {
    // Validate `selectedDay` against the JO-wide day set instead of the
    // per-shift `dayOptions` — the picker UI surface is JO-wide now.
    // Per-shift narrowing inside a multi-day shift still uses
    // `dayOptions` downstream (passed into `ShiftAssignmentCard`).
    if (joDayOptions.length === 0) {
      if (selectedDay) setSelectedDay('');
      return;
    }
    if (!selectedDay) return;
    const valid = joDayOptions.some((d) => d.date === selectedDay);
    if (!valid) setSelectedDay('');
  }, [selectedShiftId, selectedDay, joDayOptions]);
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

  /**
   * Bulk Cancel: cancel assignment (red X) for all selected workers who
   * have an assignment. Same optimistic-UI contract as
   * `handleCancelAssignment` — see that method for the long-form rationale
   * (synchronous in-place transform, pending flag to fence the load()
   * effect, full revert on failure).
   */
  const handleBulkCancel = async () => {
    const selected = displayedAssignedWorkers.filter((w) => selectedAssignmentWorkerIds.has(w.id));
    const withAssignment = selected.filter((w) => !w.isPlacementOnly && w.assignmentId);
    if (withAssignment.length === 0 || !selectedShiftId || !jobOrderId) return;
    setBulkCancelBusy(true);
    const cancelledIds = new Set(withAssignment.map((w) => w.id));
    setAssignmentWorkersList((prev) =>
      prev.flatMap((w) => {
        if (!cancelledIds.has(w.id)) return [w];
        if (placementUserIds.has(w.id)) {
          return [
            {
              ...w,
              assignmentStatus: undefined,
              assignmentId: undefined,
              isPlacementOnly: true,
              confirmationStatus: undefined,
              assignmentOfferSentAt: undefined,
              assignmentConfirmedAt: undefined,
            },
          ];
        }
        return [];
      }),
    );
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
  /**
   * Worker Pool name search.
   *
   * Recruiters frequently know the worker by name and need to find them in
   * a Worker Pool of 90+ — scrolling the entire pool to drag the right
   * person into Assignments was the dominant UX cost. Filter is applied
   * client-side against the already-loaded `availableWorkers` list (the
   * pool is paginated server-side; this just narrows what's already on
   * screen). Match runs against firstName, lastName, displayName, and
   * "firstName lastName" so partial-token searches like "ann kell" still
   * return Annett Kelley.
   */
  const [workerPoolSearch, setWorkerPoolSearch] = useState('');
  const availableWorkersFiltered = useMemo(() => {
    const term = workerPoolSearch.trim().toLowerCase();
    if (!term) return availableWorkers;
    const tokens = term.split(/\s+/).filter(Boolean);
    return availableWorkers.filter((w) => {
      const first = String(w.firstName ?? '').toLowerCase();
      const last = String(w.lastName ?? '').toLowerCase();
      const display = String(w.displayName ?? '').toLowerCase();
      const combined = `${first} ${last}`.trim();
      return tokens.every(
        (t) =>
          first.includes(t) ||
          last.includes(t) ||
          display.includes(t) ||
          combined.includes(t),
      );
    });
  }, [availableWorkers, workerPoolSearch]);
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
    const trimmed = editStartDateValue.trim().split('T')[0];
    if (!editStartDateWorker || !tenantId || !trimmed) {
      setEditStartDateWorker(null);
      return;
    }
    setEditStartDateSaving(true);
    try {
      if (editStartDateWorker.assignmentId) {
        const assignmentRef = doc(db, 'tenants', tenantId, 'assignments', editStartDateWorker.assignmentId);
        await updateDoc(assignmentRef, {
          startDate: trimmed,
          updatedAt: serverTimestamp(),
        });
      } else if (editStartDateWorker.isPlacementOnly && selectedShiftId) {
        // Placement-only workers don't have an assignment yet — store the
        // recruiter's intended start date on the placement doc. It's hydrated
        // back into `Worker.assignmentStartDate` for display, and forwarded
        // as `applyDate` when `handleConfirmPlacement` creates the assignment.
        const placementId = `${selectedShiftId}__${editStartDateWorker.id}`;
        const placementRef = doc(db, 'tenants', tenantId, 'placements', placementId);
        await updateDoc(placementRef, {
          startDate: trimmed,
          updatedAt: serverTimestamp(),
        });
      }
      setEditStartDateWorker(null);
    } catch (err: any) {
      console.error('Error updating start date:', err);
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

  /**
   * Phase 3: drop-over fires from each card. The bound `shiftId` is
   * the card's shift, not necessarily the expanded card. We also
   * stop propagation to prevent the global pool drop-zone from
   * stealing the event.
   */
  const handleAssignmentsDragOver = (shiftId: string, event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    if (dragOverShiftId !== shiftId) setDragOverShiftId(shiftId);
  };

  const [doubleBookConfirmWorker, setDoubleBookConfirmWorker] = useState<Worker | null>(null);
  // When a double-book confirm popover is open, the user confirms
  // placement on a specific shift — capture it so `createPlacement`
  // (called from the confirm button) hits the right shiftId.
  const [pendingPlacementShiftId, setPendingPlacementShiftId] = useState<string | null>(null);

  /**
   * Phase 3: per-shift drop handler. Bound by each card to its own
   * shiftId so dropping on card X creates a placement on shift X
   * (NOT on the legacy `selectedShiftId`). After a successful drop
   * we also auto-expand that card so the recruiter sees the new
   * placement land — even if they dropped on a previously-collapsed
   * card.
   */
  const handleAssignmentsDrop = (shiftId: string, event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setDragOverShiftId(null);
    const workerId = event.dataTransfer.getData(WORKER_DRAG_MIME) || event.dataTransfer.getData('text/plain');
    if (!workerId) return;
    const worker = availableWorkers.find((w) => w.id === workerId);
    if (!worker) return;
    // Auto-expand the dropped-on card so the recruiter sees the
    // new placement land. Mirrors the "click to expand" UX but
    // triggered by the drop instead of a header click.
    if (expandedShiftId !== shiftId) {
      userExplicitlyCollapsedRef.current = false;
      setExpandedShiftId(shiftId);
    }
    tryPlaceWorker(worker, shiftId);
  };

  const tryPlaceWorker = (worker: Worker, targetShiftId: string) => {
    const conflicts = sameDayConflictByUserId.get(worker.id);
    if (conflicts && conflicts.length > 0) {
      // Stash the target shift so the confirm button creates the
      // placement on the right shiftId (not selectedShiftId).
      setPendingPlacementShiftId(targetShiftId);
      setDoubleBookConfirmWorker(worker);
      return;
    }
    createPlacement(worker, targetShiftId);
  };

  const createPlacement = async (worker: Worker, targetShiftId?: string) => {
    const shiftId = targetShiftId ?? pendingPlacementShiftId ?? selectedShiftId;
    if (!tenantId || !shiftId || !jobOrderId || !user?.uid) {
      setError('Missing required information to place worker');
      return;
    }
    setDoubleBookConfirmWorker(null);
    setPendingPlacementShiftId(null);
    const placementId = `${shiftId}__${worker.id}`;
    try {
      setError(null);
      pendingPlacementAddsRef.current.add(worker.id);
      setPlacementUserIds((prev) => new Set([...prev, worker.id]));
      const placementRef = doc(db, 'tenants', tenantId, 'placements', placementId);
      await setDoc(placementRef, {
        tenantId,
        jobOrderId,
        shiftId,
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
    try {
      setError(null);
      // Optimistic update: remove from Assignments immediately
      setPlacementUserIds((prev) => {
        const next = new Set(prev);
        next.delete(worker.id);
        return next;
      });
      // Also clear any pending-add bookkeeping so the placements snapshot
      // listener doesn't re-add this worker via pendingPlacementAddsRef.
      pendingPlacementAddsRef.current.delete(worker.id);
      // Mark as pending-removal so the snapshot listener keeps the
      // worker hidden from Assignments while the delete propagates.
      // Cleared by the listener once the server-side snapshot no
      // longer includes this id.
      pendingPlacementRemovesRef.current.add(worker.id);
      // Placement docs may exist under multiple ID schemes for the same
      // (shift, user) pair:
      //   - simple: `${shiftId}__${userId}` (created by the UI)
      //   - day-scoped: `${shiftId}__${userId}__${yyyy-mm-dd}` (recreated by
      //     `placementsCancelAssignment` when an assignment is cancelled)
      // Deleting only the simple ID leaves the day-scoped doc behind, so the
      // placements listener re-hydrates the worker on refresh. Query by
      // `shiftId` + `userId` and batch-delete every match.
      const placementsRef = collection(db, 'tenants', tenantId, 'placements');
      const matchesQuery = query(
        placementsRef,
        where('shiftId', '==', selectedShiftId),
        where('userId', '==', worker.id),
      );
      const matchesSnap = await getDocs(matchesQuery);
      if (matchesSnap.empty) {
        // Nothing to delete on the server (already gone). The optimistic
        // update is enough.
        return;
      }
      await Promise.all(matchesSnap.docs.map((d) => deleteDoc(d.ref)));
    } catch (err: any) {
      console.error('Error removing placement:', err);
      setError(err?.message || 'Failed to remove placement');
      // Revert optimistic update on error
      setPlacementUserIds((prev) => new Set([...prev, worker.id]));
      // Clear the pending-remove flag so the snapshot listener stops
      // suppressing this id and the worker re-appears in Assignments.
      pendingPlacementRemovesRef.current.delete(worker.id);
    }
  };

  /**
   * Drag-to-unplace destination. Three cases the recruiter can drop:
   *
   *   1. Placement-only worker (Click to Hire state) → `deletePlacement`
   *      runs its own optimistic remove + Firestore delete. Row vanishes
   *      from the Assignments card immediately.
   *   2. Worker has an assignment (offered / accepted / confirmed) →
   *      open the existing cancel-assignment confirm dialog. Cancelling
   *      an assignment is non-trivial (worker gets notified, audit row
   *      written) so we don't silent-fire it on a drop — we ask first.
   *      Previously this branch returned silently and the user thought
   *      the drop did nothing.
   *   3. Neither (defensive) → log + ignore. Should never happen since
   *      `assignedWorkers` only contains workers with a placement or
   *      assignment, but the guard keeps us honest if the data layer
   *      changes upstream.
   */
  const handleUnplaceToWorkerPool = async (worker: Worker) => {
    if (worker.isPlacementOnly) {
      await deletePlacement(worker);
      return;
    }
    if (worker.assignmentStatus || worker.assignmentId) {
      // Route to the same confirm dialog the per-row "Cancel" button
      // uses so the recruiter gets the explicit "this will notify the
      // worker" copy before we touch the assignment doc.
      setCancelAssignmentWorker(worker);
      return;
    }
    // Defensive: nothing to do. Log so we can spot the case in field
    // reports rather than silently swallowing the drop.
    console.warn('[PlacementsTab] drag-to-unplace: worker has neither placement nor assignment', {
      workerId: worker.id,
      displayName: worker.displayName,
    });
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
          {showContent && shifts.length > 0 && !lockedShiftId && (
            <FormControl size="small" sx={{ minWidth: 280 }}>
              <InputLabel>Shift</InputLabel>
              <Select
                value={safeSelectedShiftId}
                label="Shift"
                // Phase 5: the top picker is a "jump to + expand" shortcut,
                // not a separate selection. `handleJumpToShift` expands
                // the picked card in the Assignments column (and clears
                // any day filter that would otherwise hide it). The
                // existing `expandedShiftId → selectedShiftId` sync keeps
                // the legacy single-shift data layer + Worker Pool "Shift
                // Applicants" filter following the picker too.
                onChange={(e) => handleJumpToShift(e.target.value)}
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
          {/* Day picker — JO-wide (2026-05-23). Shows whenever the JO
              spans more than one calendar day, whether that's from a
              single multi-day shift OR from many single-day shifts on
              different dates. The visibleShifts useMemo upstream
              already filters cards by selectedDay. */}
          {joDayOptions.length > 1 && !lockedShiftId && (
            <FormControl size="small" sx={{ minWidth: 200 }}>
              <InputLabel>Day</InputLabel>
              <Select
                value={selectedDay || '__all__'}
                label="Day"
                onChange={(e) => setSelectedDay(e.target.value === '__all__' ? '' : e.target.value)}
                disabled={loading}
                renderValue={(v) => (v === '__all__' || !v ? 'All days' : joDayOptions.find((d) => d.date === v)?.dayLabel ?? v)}
              >
                <MenuItem value="__all__">
                  <em>All days</em>
                </MenuItem>
                {joDayOptions.map((opt) => (
                  <MenuItem key={opt.date} value={opt.date}>
                    {opt.dayLabel}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}
          {/* The schedule + staff summary that used to render here is now
              consolidated into the Assignments column header (second line
              under the shift title). Removed from this row to avoid showing
              the same info twice. */}
        </Box>
        {showContent && shifts.length > 0 && !lockedShiftId && (
          <Tooltip
            title={
              placementNotificationsMuted
                ? 'Notifications muted — click to unmute'
                : 'Mute placement notifications for this shift'
            }
          >
            <span>
              <IconButton
                onClick={() => void handleTogglePlacementNotificationsMuted()}
                disabled={togglingPlacementMute || loading}
                sx={{
                  width: 32,
                  height: 32,
                  flexShrink: 0,
                  ml: { xs: 'auto', sm: 0 },
                  border: '1px solid',
                  borderColor: placementNotificationsMuted
                    ? 'warning.main'
                    : 'rgba(0, 87, 184, 0.5)',
                  color: placementNotificationsMuted ? 'warning.main' : '#0057B8',
                  bgcolor: placementNotificationsMuted ? 'warning.lighter' : 'transparent',
                  '&:hover': {
                    borderColor: placementNotificationsMuted ? 'warning.dark' : '#0057B8',
                    bgcolor: placementNotificationsMuted
                      ? 'warning.light'
                      : 'rgba(0, 87, 184, 0.04)',
                  },
                }}
              >
                {placementNotificationsMuted ? (
                  <NotificationsOffIcon sx={{ fontSize: 18 }} />
                ) : (
                  <NotificationsActiveIcon sx={{ fontSize: 18 }} />
                )}
              </IconButton>
            </span>
          </Tooltip>
        )}
      </Box>

      {/* Error Message */}
        {error && (
          <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {/* Assign-click feedback toast (floats over content, visible
            regardless of scroll). Auto-hides after 6s for success/info,
            10s for errors so recruiters get longer to read why a click
            was rejected. */}
        <Snackbar
          open={assignToast !== null}
          // When there's an "Assign anyway" action, give the recruiter a
          // generous window to react before the toast auto-dismisses —
          // 20s vs the standard 10s for plain errors. Otherwise the
          // override CTA evaporates while they're still reading the
          // conflict message.
          autoHideDuration={
            assignToast?.overrideAction
              ? 20_000
              : assignToast?.severity === 'error'
                ? 10_000
                : 6_000
          }
          onClose={() => setAssignToast(null)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        >
          {assignToast ? (
            <Alert
              severity={assignToast.severity}
              variant="filled"
              onClose={() => setAssignToast(null)}
              sx={{ maxWidth: 720 }}
              action={
                assignToast.overrideAction ? (
                  <Button
                    color="inherit"
                    size="small"
                    onClick={() => {
                      const action = assignToast.overrideAction;
                      if (!action) return;
                      setAssignToast(null);
                      // Re-fire the same batch with the overlap guard
                      // bypassed. Server logs `overlapping_assignment_overridden`
                      // in `warnings` so the audit trail captures the
                      // deliberate double-book.
                      void assignWorkersToShift(action.workerIds, action.dayOverride, {
                        allowOverlapping: true,
                      });
                    }}
                    sx={{ fontWeight: 600 }}
                  >
                    {assignToast.overrideAction.label}
                  </Button>
                ) : undefined
              }
            >
              {assignToast.message}
            </Alert>
          ) : undefined}
        </Snackbar>

        {/* Content Area - two column board.
            Drawer mode (`lockedShiftId`) drops the Card chrome and
            tightens the gutter so the two columns read as a clean
            split rather than two boxes-in-a-box. The JO Detail page
            keeps the elevated Card look. */}
        {showContent && (
          <Grid container spacing={lockedShiftId ? 1.5 : 3}>
            {/* Left: Assignments — one <ShiftAssignmentCard> per visible
                shift (Phase 2). Accordion expansion: only the card whose
                shiftId matches `expandedShiftId` shows its body + data.
                Collapsed cards render the header only.
                `selectedShiftId` follows `expandedShiftId` automatically
                so the existing single-shift listeners / Worker Pool's
                "Shift Applicants" filter follow the expanded card. */}
            <Grid item xs={12} lg={6}>
              <Stack spacing={lockedShiftId ? 1 : 1.5}>
                {visibleShifts.length === 0 ? (
                  <Alert severity="info">
                    {selectedDay
                      ? 'No shifts on this date.'
                      : 'No shifts on this job order yet.'}
                  </Alert>
                ) : (
                  visibleShifts.map((shift) => {
                    const isExpanded = shift.id === expandedShiftId;
                    // Only the expanded card gets real data — collapsed
                    // cards just need their `shift` for the header. This
                    // sidesteps a multi-shift data-layer refactor for
                    // Phase 2 while still delivering the multi-card UX.
                    // Phase 2b (deferred) can optimize to per-shift
                    // listeners when needed for performance.
                    const cardDisplayedWorkers = isExpanded ? displayedAssignedWorkers : [];
                    return (
                      <ShiftAssignmentCard
                        key={shift.id}
                        lockedShiftId={lockedShiftId}
                        selectedShiftId={isExpanded ? selectedShiftId : shift.id}
                        selectedShift={shift}
                        selectedDay={selectedDay}
                        dayOptions={isExpanded ? dayOptions : []}
                        jobOrder={jobOrder}
                        displayedAssignedWorkers={cardDisplayedWorkers}
                        shiftStartDateStr={isExpanded ? shiftStartDateStr : ''}
                        selectedAssignmentWorkerIds={isExpanded ? selectedAssignmentWorkerIds : new Set()}
                        isAllAssignmentsSelected={isExpanded ? isAllAssignmentsSelected : false}
                        isSomeAssignmentsSelected={isExpanded ? isSomeAssignmentsSelected : false}
                        onSelectAllAssignments={handleSelectAllAssignments}
                        onSelectOneAssignment={handleSelectOneAssignment}
                        onClearAssignmentSelection={() => setSelectedAssignmentWorkerIds(new Set())}
                        bulkAcceptBusy={bulkAcceptBusy}
                        bulkCancelBusy={bulkCancelBusy}
                        onBulkAccept={handleBulkAccept}
                        onBulkCancel={handleBulkCancel}
                        onOpenBulkEmailDrawer={() => {
                          setBulkDrawerChannel('email');
                          setBulkDrawerOpen(true);
                        }}
                        onOpenBulkSmsDrawer={() => {
                          setBulkDrawerChannel('sms');
                          setBulkDrawerOpen(true);
                        }}
                        onExportAssignmentsCsv={handleExportAssignmentsCsv}
                        onPreviewEmail={handlePreviewEmail}
                        isAssignmentDragOver={dragOverShiftId === shift.id}
                        onAssignmentsDragOver={(e) => handleAssignmentsDragOver(shift.id, e)}
                        onAssignmentsDragLeave={() => {
                          if (dragOverShiftId === shift.id) setDragOverShiftId(null);
                        }}
                        onAssignmentsDrop={(e) => handleAssignmentsDrop(shift.id, e)}
                        onWorkerDragStart={handleWorkerDragStart}
                        confirmingPlacementUserId={confirmingPlacementUserId}
                        confirmLoadingAssignmentId={confirmLoadingAssignmentId}
                        resendLoadingAssignmentId={resendLoadingAssignmentId}
                        resendCooldownUntilByAssignmentId={resendCooldownUntilByAssignmentId}
                        onConfirmPlacement={handleConfirmPlacement}
                        onConfirmForWorker={handleConfirmForWorker}
                        onRevertDecline={handleRevertDecline}
                        onRevertCancel={handleRevertCancel}
                        onResendConfirmations={() => void handleResendShiftConfirmations(shift.id)}
                        resendingShiftConfirmations={resendingShiftIds.has(shift.id)}
                        onResendOffer={handleResendOffer}
                        onResendConfirmation={handleResendConfirmation}
                        onCancelAssignment={(worker) => setCancelAssignmentWorker(worker)}
                        onOpenEditStartDate={handleOpenEditStartDate}
                        hiringEntityName={hiringEntityName}
                        entityEmploymentByUserId={entityEmploymentByUserId}
                        placementEntityEmploymentLoading={placementEntityEmploymentLoading}
                        blockerLabelsForAssignmentId={placementBlockerLabelsForAssignmentId}
                        onboardingMissingLabelsForAssignmentId={placementOnboardingMissingLabelsForAssignmentId}
                        jobReadinessChipDataForAssignmentId={placementJobReadinessChipDataForAssignmentId}
                        onJobReadinessItemClick={handlePlacementJobReadinessItemClick}
                        onOpenResume={(url, fileName) => {
                          setSelectedResume({ url, fileName });
                          setResumeModalOpen(true);
                        }}
                        onOpenLicenses={(licenses) => {
                          setSelectedLicenses(licenses);
                          setLicenseModalOpen(true);
                        }}
                        onOpenCerts={(certs) => {
                          setSelectedCerts(certs);
                          setCertModalOpen(true);
                        }}
                        formatDateDisplay={formatDateDisplay}
                        // Phase 2 accordion props — single-shift drawer
                        // mode (one visible shift) renders always-expanded
                        // by passing `undefined` instead.
                        isExpanded={lockedShiftId ? undefined : isExpanded}
                        onToggleExpand={
                          lockedShiftId ? undefined : () => handleToggleShiftExpand(shift.id)
                        }
                      />
                    );
                  })
                )}
              </Stack>
            </Grid>

            {/* Right: Worker Pool */}
            <Grid item xs={12} lg={6}>
              <Card
                elevation={0}
                sx={{
                  height: '100%',
                  // See the Assignments Card above for the same theme-
                  // override reasoning: strip the hidden 24px Card
                  // padding + shadow + hover re-shadow.
                  boxShadow: 'none !important',
                  padding: '0 !important',
                  '&:hover': {
                    boxShadow: 'none !important',
                    border: 'none !important',
                    borderColor: 'transparent !important',
                  },
                  ...(lockedShiftId && {
                    border: 'none !important',
                    backgroundColor: 'transparent !important',
                  }),
                }}
              >
                <CardContent
                  sx={{
                    p: lockedShiftId ? 0 : '12px',
                    '&:last-child': { pb: lockedShiftId ? 0 : '12px' },
                  }}
                >
                  <Typography variant="h6" gutterBottom sx={{ fontWeight: 600 }}>
                    {workerPoolSearch.trim()
                      ? `Worker Pool (${availableWorkersFiltered.length} of ${availableWorkers.length})`
                      : `Worker Pool (${availableWorkers.length})`}
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
                    /*
                     * Group picker — Autocomplete (Greg, 2026-04-30).
                     *
                     * Switched from a simple Select to a searchable
                     * Autocomplete because the userGroups list grew long
                     * enough (20+ entries: "Sodexo Dallas", "Phoenix
                     * Cleaners", "CORT Orange County" …) that hunting
                     * for a specific group in the dropdown was painful.
                     * Sorted alphabetically here so the rendered list
                     * has a stable, predictable order regardless of how
                     * Firestore returned them in `setUserGroups`. The
                     * persist-on-pick behavior is unchanged from the
                     * Select — same `placementsLastGroup` Firestore
                     * write, same `setSelectedWorkforce('group_<id>')`.
                     */
                    <Box sx={{ mb: 1 }}>
                      <Autocomplete
                        size="small"
                        fullWidth
                        autoHighlight
                        openOnFocus
                        options={[...userGroups].sort((a, b) =>
                          (a.groupName || '').localeCompare(b.groupName || '', undefined, {
                            sensitivity: 'base',
                          }),
                        )}
                        getOptionLabel={(option) => option?.groupName ?? ''}
                        isOptionEqualToValue={(option, value) => option.id === value.id}
                        value={null}
                        // Always reset visible value back to null after a pick
                        // — the *active* selection is reflected in the
                        // outer Workforce dropdown ('group_<id>') via
                        // `setSelectedWorkforce`, so this input acts as
                        // a one-shot "switch to this group" search box.
                        blurOnSelect
                        onChange={async (_e, group) => {
                          if (!group) return;
                          // Remember the pick locally FIRST so
                          // `workforceOptions` includes `group_<id>`
                          // synchronously this render — otherwise the
                          // reset effect fires and snaps the selection
                          // back to Applicants/All Applicants before the
                          // JO refresh lands. See the long-form comment
                          // on `sessionPickedGroups` above for full
                          // rationale.
                          setSessionPickedGroups((prev) => {
                            if (prev.has(group.id)) return prev;
                            const next = new Map(prev);
                            next.set(group.id, group.groupName);
                            return next;
                          });
                          setSelectedWorkforce(`group_${group.id}`);
                          try {
                            const jobOrderRef = doc(db, 'tenants', tenantId, 'job_orders', jobOrderId);
                            await updateDoc(jobOrderRef, {
                              placementsLastGroup: { id: group.id, groupName: group.groupName },
                              updatedAt: serverTimestamp(),
                            });
                            onJobOrderUpdated?.();
                          } catch (err) {
                            console.error('Error saving placements last group:', err);
                          }
                        }}
                        renderInput={(params) => (
                          <TextField
                            {...params}
                            label="Group"
                            placeholder="Search groups…"
                            InputLabelProps={{ shrink: true }}
                          />
                        )}
                      />
                    </Box>
                  )}
                  {/* Replaces the old "Drag into Assignments to place. Drop
                      Placed workers here to unplace." caption — recruiters
                      asked for a name filter because scrolling a 90-person
                      pool to find one worker is the bottleneck. The "drag /
                      drop to unplace" affordance is preserved by the
                      dropzone hint inside the pool box (below). */}
                  <TextField
                    size="small"
                    fullWidth
                    value={workerPoolSearch}
                    onChange={(e) => setWorkerPoolSearch(e.target.value)}
                    placeholder="Search by name…"
                    sx={{ mb: 1 }}
                    InputProps={{
                      startAdornment: (
                        <InputAdornment position="start">
                          <SearchIcon fontSize="small" sx={{ color: 'text.secondary' }} />
                        </InputAdornment>
                      ),
                      endAdornment: workerPoolSearch ? (
                        <InputAdornment position="end">
                          <IconButton
                            size="small"
                            edge="end"
                            onClick={() => setWorkerPoolSearch('')}
                            aria-label="Clear worker pool search"
                          >
                            <ClearIcon fontSize="small" />
                          </IconButton>
                        </InputAdornment>
                      ) : null,
                    }}
                  />

                  <Box
                    onDragOver={handleWorkerPoolDragOver}
                    onDragLeave={() => setIsWorkerPoolDragOver(false)}
                    onDrop={handleWorkerPoolDrop}
                    sx={{
                      borderRadius: 1,
                      // Same drawer-flat treatment as the
                      // assignments dropzone (above).
                      border: lockedShiftId
                        ? isWorkerPoolDragOver
                          ? '1px dashed'
                          : 'none'
                        : '1px dashed',
                      borderColor: isWorkerPoolDragOver ? 'warning.main' : 'divider',
                      bgcolor: isWorkerPoolDragOver ? 'rgba(255, 152, 0, 0.08)' : 'rgba(0,0,0,0.02)',
                      minHeight: 220,
                      p: 1,
                      transition: 'all 0.15s ease',
                      boxShadow: lockedShiftId ? 0 : isWorkerPoolDragOver ? 2 : 0,
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
                  ) : availableWorkersFiltered.length === 0 ? (
                    <Alert severity="info">
                      No workers match &quot;{workerPoolSearch.trim()}&quot;.
                    </Alert>
                  ) : (
                    <Stack spacing={1}>
                      {availableWorkersFiltered.map((worker) => {
                        const requiredCertStatuses = placementRequiredCertMatchList(
                          jobOrder,
                          worker.certifications,
                          worker.licenses,
                        );

                        const sameDayConflicts = sameDayConflictByUserId.get(worker.id);

                        return (
                          <Paper
                            key={worker.id}
                            variant={lockedShiftId ? undefined : 'outlined'}
                            elevation={0}
                            draggable
                            onDragStart={(event) => handleWorkerDragStart(event, worker.id)}
                            sx={{
                              p: lockedShiftId ? 1 : '6px',
                              cursor: 'grab',
                              ...(lockedShiftId && {
                                border: 'none',
                                boxShadow: 'none',
                              }),
                            }}
                          >
                            <PlacementWorkerTileMainColumn
                                worker={worker}
                                jobOrder={jobOrder}
                                hiringEntityName={hiringEntityName}
                                entityEmploymentByUserId={entityEmploymentByUserId}
                                placementEntityEmploymentLoading={placementEntityEmploymentLoading}
                                blockerLabels={placementBlockerLabelsForAssignmentId(worker.assignmentId)}
                                onboardingMissingLabels={placementOnboardingMissingLabelsForAssignmentId(worker.assignmentId)}
                                jobReadinessChipData={placementJobReadinessChipDataForAssignmentId(worker.assignmentId)}
                                onJobReadinessItemClick={handlePlacementJobReadinessItemClick}
                                requiredCertStatuses={requiredCertStatuses}
                                profileActionIcons={
                                  <PlacementProfileActionIcons
                                    worker={worker}
                                    jobOrder={jobOrder}
                                    onOpenResume={(url, fileName) => {
                                      setSelectedResume({ url, fileName });
                                      setResumeModalOpen(true);
                                    }}
                                    onOpenLicenses={(licenses) => {
                                      setSelectedLicenses(licenses);
                                      setLicenseModalOpen(true);
                                    }}
                                    onOpenCerts={(certs) => {
                                      setSelectedCerts(certs);
                                      setCertModalOpen(true);
                                    }}
                                  />
                                }
                                row3={
                                  <Typography variant="caption" color="text.secondary" noWrap>
                                    {[worker.city, worker.state].filter(Boolean).join(', ') ||
                                      worker.email ||
                                      worker.phone ||
                                      'No contact info'}
                                  </Typography>
                                }
                                actions={
                                  <>
                                    {sameDayConflicts?.length ? (
                                      <Tooltip
                                        title={
                                          <Box>
                                            <Typography variant="caption" fontWeight={600} display="block" sx={{ mb: 0.5, color: '#fff' }}>
                                              Already on a shift this day
                                            </Typography>
                                            {sameDayConflicts.map((c, i) => (
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
                                    ) : null}
                                    <Tooltip title={selectedShift ? 'Add this worker to the selected shift as Placed' : 'Select a shift to assign'}>
                                      <span>
                                        <Chip
                                          size="small"
                                          label="Assign"
                                          color="info"
                                          icon={<PersonAddIcon />}
                                          onClick={() => handleAssignToShift(worker, selectedShift)}
                                          disabled={!selectedShift}
                                          sx={{
                                            ...placementActionChipSx,
                                            cursor: selectedShift ? 'pointer' : 'not-allowed',
                                            '&:hover': selectedShift ? { opacity: 0.9 } : undefined,
                                          }}
                                        />
                                      </span>
                                    </Tooltip>
                                    {isShiftApplicantPool && selectedShift ? (
                                      <Tooltip title="Remove this applicant from the selected shift (silent — no message sent). Use after accepting them for another shift the same day.">
                                        <IconButton
                                          size="small"
                                          aria-label="Remove from this shift"
                                          onClick={() => handleRemoveApplicationFromShift(worker)}
                                          sx={{ color: 'text.secondary', '&:hover': { color: 'error.main' } }}
                                        >
                                          <PersonRemoveIcon fontSize="small" />
                                        </IconButton>
                                      </Tooltip>
                                    ) : null}
                                  </>
                                }
                              />
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
            <Button onClick={() => {
              // Clear the stashed target shift too so a future drop
              // doesn't accidentally re-use this cancelled target.
              setDoubleBookConfirmWorker(null);
              setPendingPlacementShiftId(null);
            }}>Cancel</Button>
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

