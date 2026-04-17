import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';

import { safeToDate, getJobOrderAge, getCalendarDayLocal } from '../utils/dateUtils';
import {
  Box,
  Typography,
  Chip,
  Card,
  CardContent,
  CardHeader,
  Grid,
  IconButton,
  Menu,
  MenuItem,
  Alert,
  CircularProgress,
  Paper,
  Avatar,
  Link as MUILink,
  Button,
  Skeleton,
  TextField,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  FormControl,
  InputLabel,
  Select,
  Stack,
  Tooltip,
  Autocomplete,
  Checkbox,
  FormControlLabel,
  Snackbar,
  Tabs,
  Tab
} from '@mui/material';
import {
  MoreVert as MoreVertIcon,
  Business as BusinessIcon,
  LocationOn as LocationIcon,
  Person as PersonIcon,
  Work as BriefcaseIcon,
  Schedule as ScheduleIcon,
  AttachMoney as MoneyIcon,
  Work as WorkIcon,
  Group as GroupIcon,
  Description as DescriptionIcon,
  Security as SecurityIcon,
  Assignment as AssignmentIcon,
  Timeline as TimelineIcon,
  CheckCircle as CheckCircleIcon,
  Warning as WarningIcon,
  Info as InfoIcon,
  AttachMoney as DealIcon,
  Delete as DeleteIcon,
  CloudUpload as UploadIcon,
  Notes as NotesIcon,
  Note as NoteIcon,
  AddTask as AddTaskIcon,
  Add as AddIcon,
  CalendarMonth as CalendarIcon,
  Visibility as VisibilityIcon,
  Settings as SettingsIcon,
  Save as SaveIcon,
  Edit as EditIcon,
  ContentCopy as ContentCopyIcon,
  Language as ExternalLinkIcon,
  ArrowBack as ArrowBackIcon,
  Email as EmailIcon,
  Sms as SmsIcon,
  Lock as LockedIcon,
  AccountBalance as AccountBalanceIcon,
  Groups as GroupsIcon,
} from '@mui/icons-material';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { format, formatDistanceToNow } from 'date-fns';
import {
  doc,
  getDoc,
  collection,
  query,
  where,
  getDocs,
  updateDoc,
  serverTimestamp,
  setDoc,
  onSnapshot,
  limit,
  deleteField,
  deleteDoc,
  type Firestore,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';

import { useAuth } from '../contexts/AuthContext';
import { db, storage, functions } from '../firebase';
import { p } from '../data/firestorePaths';
import { getDateScheduleEntriesWithHours, type DateSchedule } from '../utils/dateSchedule';
import {
  applicationMatchesSelectedDay,
  applicationMatchesShift,
  isIsoGigDay,
} from '../utils/gigShiftState';
import { buildShiftPickerSecondLine } from '../utils/shiftPickerLabel';
import { JobOrder } from '../types/recruiter/jobOrder';
import PageHeader from '../components/PageHeader';
import JobOrderForm from '../components/JobOrderForm';
import { JobsBoardService, JobsBoardPost } from '../services/recruiter/jobsBoardService';
import ManageContactsDialog from '../components/ManageContactsDialog';
import ManageSalespeopleDialog from '../components/ManageSalespeopleDialog';
import StaffInstructionCard from '../components/recruiter/StaffInstructionCard';
import ShiftSetupTab from '../components/recruiter/ShiftSetupTab';
import JobOrderHiringTab from '../components/recruiter/JobOrderHiringTab';
import CRMNotesTab from '../components/CRMNotesTab';
// Jobs Board Visibility tab removed: all controls live in Jobs Board tab
import PlacementsTab from '../components/recruiter/PlacementsTab';
import LaborPoolSelector from '../components/recruiter/LaborPoolSelector';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { useFavorites } from '../hooks/useFavorites';
import { useCategoryScoresCurrentMap } from '../hooks/useCategoryScoresCurrentMap';
import { useEntity } from '../hooks/useEntity';
import FavoriteButton from '../components/FavoriteButton';
import InterviewCell from '../components/InterviewCell';
import { RecruiterApplicantCategoryScoresRow } from '../components/recruiter/RecruiterApplicantCategoryScoresRow';
import { calculateProfileScore, getScoreColor, getScoreLabel } from '../utils/applicantScoring';
import { normalizeScoreSummary, formatOneDecimal, getUserScore } from '../utils/scoreSummary';
import { getOrComputeJobScoreSummary } from '../utils/jobScore';
import { getOrComputeJobScoreSummaryV1, computeJobScoreSummaryV1 } from '../utils/jobScoreV1';
import { getRequirementPackV1 } from '../data/jobRequirementPacksV1';
import { isExcludedFromPlacementsApplicantPool, normalizeApplicationStatus } from '../utils/applicationStatusNormalize';
import HiringLifecycleBadgeGroup from '../components/hiring/HiringLifecycleBadgeGroup';
import { formatAiAutomationRecruiterTooltip } from '../utils/formatAiAutomationRecruiterTooltip';
import {
  countRecruiterLifecycleBuckets,
  deriveRecruiterLifecycleBucket,
  parseJobOrderApplicationsLifecycleParam,
  RECRUITER_LIFECYCLE_BUCKET_LABELS,
  RECRUITER_LIFECYCLE_BUCKET_ORDER,
  RECRUITER_LIFECYCLE_BUCKET_SHORT_LABELS,
  type RecruiterLifecycleFilterBucket,
} from '../utils/recruiterApplicationLifecycleBucket';
import type { PrescreenCategoryId } from '../types/prescreenCategoryScores';
import { PRESCREEN_CATEGORY_IDS } from '../types/prescreenCategoryScores';
import { averageCategoryScore } from '../utils/parseRecruiterCategoryScores';
import {
  applicantPassesCategoryScoreFilters,
  compareApplicantsByCategoryScore,
  getEffectiveCategoryScoresForApplicantRow,
  CATEGORY_SCORE_FILTER_THRESHOLDS,
} from '../utils/recruiterApplicantCategoryScoreFilter';
import { formatPrescreenCategoryLabel } from '../utils/categoryScoreEvolution';
import {
  RECRUITER_LIFECYCLE_FILTER_GUIDANCE,
  summarizeNextActionsInApplicantList,
} from '../utils/recruiterLifecycleRecruiterGuidance';
import type { ApplicationHiringLifecycle } from '../types/applicationHiringLifecycle';
import { parseApplicationHiringLifecycle } from '../utils/applicationHiringLifecycle';
import type { JobScoreSummary, JobScoreSummaryStored } from '../types/jobScore';
import JobPostForm from '../components/JobPostForm';
import {
  fetchResolvedAccountPricingPositions,
  buildPricingByJobTitle,
} from '../utils/accountPricingForJobOrder';
import type { AccountPositionPricing } from '../types/recruiter/account';
import { experienceOptions, educationOptions } from '../data/experienceOptions';
import JobOrderChecklist, { getJobOrderChecklistProgress } from '../components/recruiter/JobOrderChecklist';
import JobOrderAutoMessagingTab from '../components/recruiter/JobOrderAutoMessagingTab';
import CreateTaskDialog from '../components/CreateTaskDialog';
import LogActivityDialog from '../components/LogActivityDialog';
import AddJobOrderNoteDialog from '../components/recruiter/AddJobOrderNoteDialog';
import MessageDrawer, { type MessageRecipient } from '../components/MessageDrawer';
import { computeComplianceSummary } from '../utils/complianceSummary';
import { hasJobBoardSyndicationUrl } from '../utils/jobBoardSyndicationUrls';
import JobBoardSyndicationIconRow from '../components/JobBoardSyndicationIconRow';
import { getWorkAuthorizedStatus } from '../utils/workAuthorizedDisplay';
import { getEVerifyComfortStatusFromUserData } from '../utils/eVerifyComfortDisplay';
import WorkAuthorizedChip from '../components/WorkAuthorizedChip';
import EVerifyComfortChip from '../components/EVerifyComfortChip';
import {
  DEFAULT_JOB_ORDER_DETAIL_TAB,
  type JobOrderDetailTabKey,
  JOB_ORDER_DETAIL_TAB_STRIP,
  jobOrderDetailTabStorageKey,
  parseJobOrderDetailTabQueryParam,
  parseStoredJobOrderTab,
} from '../constants/recruiterJobOrderDetailTabs';

interface TabPanelProps {
  children?: React.ReactNode;
  index: JobOrderDetailTabKey;
  value: JobOrderDetailTabKey;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;

  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`job-order-tabpanel-${index}`}
      aria-labelledby={`job-order-tab-${index}`}
      {...other}
    >
      {value === index && <Box sx={{ p: 2 }}>{children}</Box>}
    </div>
  );
}

// SectionCard component (matching DealDetails) - defined early so RecruiterJobOrderDetail can use it
const SectionCard: React.FC<{ title: string; action?: React.ReactNode; children: React.ReactNode }> = ({ title, action, children }) => (
  <Card>
    <CardHeader
      title={title}
      action={action}
      sx={{ p: 2, pb: 1 }}
      titleTypographyProps={{ variant: 'h6', fontWeight: 'bold' }}
    />
    <CardContent sx={{ p: 2, pt: 0 }}>
      {children}
    </CardContent>
  </Card>
);

/** Applicants table sort: legacy columns, category average, or single category (current→snapshot). */
type ApplicantsTableSortKey =
  | null
  | 'interview'
  | 'jobScore'
  | 'category_avg'
  | PrescreenCategoryId;

// ApplicantsTable Component
interface ApplicantsTableProps {
  jobOrderId: string;
  connectedJobPosts: JobsBoardPost[];
  tenantId: string;
  jobOrder: JobOrder | null;
  onCountChange?: (count: number) => void;
  onCandidateCountChange?: (count: number) => void;
}

interface ShiftOption {
  id: string;
  shiftDate: string | { toDate?: () => Date } | Date;
  shiftTitle?: string;
  defaultJobTitle?: string;
  jobTitle?: string;
  startTime?: string;
  endTime?: string;
  defaultStartTime?: string;
  defaultEndTime?: string;
  /** Multi-day gig: per-date schedule (keys YYYY-MM-DD) */
  dateSchedule?: Record<string, { startTime?: string; endTime?: string; workersNeeded?: number; overstaff?: number }>;
  /** Multi-day gig: last date of shift range */
  endDate?: string | { toDate?: () => Date } | Date;
  shiftMode?: 'single' | 'multi';
}

interface Applicant {
  uid: string;
  displayName: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  avatar?: string;
  applicationData: any;
  city?: string;
  state?: string;
  workEligibility?: boolean;
  workEligibilityAttestation?: { authorizedToWorkUS?: boolean } | null;
  comfortableEVerify?: string;
  workerAttestations?: { eVerifyWillingness?: string } | null;
  phoneVerified?: boolean;
  appliedAt?: any;
  applicationStatus?: string;
  profileScore?: number;
  fitScore?: number | null;
  /** Generic AI / Hiring score (user-level); from users/{uid}.scoreSummary.aiScore */
  hiringScore?: number;
  scoreSummary?: any;
  /** Job Score (per job); from application.jobScoreSummary or computed (v1 or legacy) */
  jobScoreSummary?: JobScoreSummaryStored | null;
  /** Parsed from application doc when present (see `hiringLifecycle` field). */
  hiringLifecycle?: ApplicationHiringLifecycle;
  /** v1.1: from users/{uid}.onboarding (when present) */
  compliancePercent?: number;
  complianceStatus?: 'compliant' | 'expiring_soon' | 'non_compliant' | 'incomplete';
  // Shift selection (for Gig jobs)
  selectedShifts?: string[];
  shiftAssignments?: Record<string, 'pending' | 'approved' | 'rejected' | 'waitlisted'>;
}

function applicationRowId(a: Applicant, jobOrderId: string): string {
  const id = a.applicationData?.id;
  if (typeof id === 'string' && id.length > 0) return id;
  return `${a.uid}::__row__::${jobOrderId}`;
}

function applicationDocRefForApplicant(
  firestore: Firestore,
  tenantId: string,
  _jobOrderId: string,
  applicant: Applicant,
) {
  const id = applicant.applicationData?.id;
  if (!id) {
    throw new Error('Missing application document id');
  }
  return doc(firestore, 'tenants', tenantId, 'applications', id);
}

const ApplicantsTable: React.FC<ApplicantsTableProps> = ({
  jobOrderId,
  connectedJobPosts,
  tenantId,
  jobOrder,
  onCountChange,
  onCandidateCountChange,
}) => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const [applicants, setApplicants] = useState<Applicant[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionMenuAnchor, setActionMenuAnchor] = useState<{ [key: string]: HTMLElement | null }>({});
  const [applicantsSortBy, setApplicantsSortBy] = useState<ApplicantsTableSortKey>(null);
  const [applicantsSortDirection, setApplicantsSortDirection] = useState<'asc' | 'desc'>('desc');
  /** Min average (current→snapshot); null = no filter. */
  const [categoryFilterMinAvg, setCategoryFilterMinAvg] = useState<number | null>(null);
  const [categoryFilterCategoryId, setCategoryFilterCategoryId] = useState<PrescreenCategoryId | ''>('');
  const [categoryFilterCategoryMin, setCategoryFilterCategoryMin] = useState<number | null>(null);
  const defaultSortAppliedRef = useRef(false);

  // Shift and day selectors (for Gig jobs - filter applicants by shift and optionally by day)
  const [shifts, setShifts] = useState<ShiftOption[]>([]);
  const [selectedShiftId, setSelectedShiftId] = useState<string>('');
  const [selectedDay, setSelectedDay] = useState<string>('');
  const [lifecycleStageFilter, setLifecycleStageFilter] = useState<'all' | RecruiterLifecycleFilterBucket>('all');
  const appsStorageKey = `applications_shift_${tenantId}_${jobOrderId}`;

  useEffect(() => {
    const lc = parseJobOrderApplicationsLifecycleParam(searchParams.get('lifecycle'));
    if (lc) setLifecycleStageFilter(lc);
  }, [searchParams]);

  // Default sort by Job Score when this job has a requirement pack (once jobOrder is available)
  useEffect(() => {
    if (jobOrder?.requirementPackId && !defaultSortAppliedRef.current) {
      defaultSortAppliedRef.current = true;
      setApplicantsSortBy('jobScore');
    }
  }, [jobOrder?.requirementPackId]);

  const [statusMenuAnchor, setStatusMenuAnchor] = useState<{ [key: string]: HTMLElement | null }>({});
  const [levelMenuAnchor, setLevelMenuAnchor] = useState<{ [key: string]: HTMLElement | null }>({});
  const [switchJobDialogOpen, setSwitchJobDialogOpen] = useState(false);
  const [selectedApplicant, setSelectedApplicant] = useState<Applicant | null>(null);
  const [targetJobOrderId, setTargetJobOrderId] = useState('');
  const [availableJobOrders, setAvailableJobOrders] = useState<any[]>([]);
  const [addApplicantDialogOpen, setAddApplicantDialogOpen] = useState(false);
  const [availableUsers, setAvailableUsers] = useState<any[]>([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [selectedApplicationRowIds, setSelectedApplicationRowIds] = useState<Set<string>>(new Set());
  const [bulkStatusMenuAnchor, setBulkStatusMenuAnchor] = useState<HTMLElement | null>(null);
  const [bulkDrawerOpen, setBulkDrawerOpen] = useState(false);
  const [bulkDrawerChannel, setBulkDrawerChannel] = useState<'email' | 'sms'>('email');
  const [assignmentStatusByUserId, setAssignmentStatusByUserId] = useState<Map<string, string>>(new Map());
  const [refreshingScores, setRefreshingScores] = useState(false);

  // Favorites hook for starring applicants
  const { isFavorite, toggleFavorite } = useFavorites('users');

  const applicantUserIdsForCategoryScores = useMemo(
    () => Array.from(new Set(applicants.map((a) => a.uid).filter(Boolean))),
    [applicants],
  );
  const { scoresByUserId: categoryScoresCurrentByUserId, loading: categoryScoresCurrentLoading } =
    useCategoryScoresCurrentMap(applicantUserIdsForCategoryScores);

  const fetchApplicants = useCallback(async () => {
    try {
      if (!tenantId) {
        setApplicants([]);
        setLoading(false);
        return;
      }
      setLoading(true);

      const jobPostIds = (connectedJobPosts || []).map((p) => p.id).filter(Boolean);
      const applicationsRef = collection(db, 'tenants', tenantId, 'applications');
      const tenantById = new Map<string, QueryDocumentSnapshot>();

      const appsByOrderQ = query(applicationsRef, where('jobOrderId', '==', jobOrderId));
      const appsByOrderSnap = await getDocs(appsByOrderQ);
      appsByOrderSnap.docs.forEach((d) => tenantById.set(d.id, d));

      if (jobPostIds.length > 0) {
        const IN_LIMIT = 10;
        for (let i = 0; i < jobPostIds.length; i += IN_LIMIT) {
          const slice = jobPostIds.slice(i, i + IN_LIMIT);
          const appsByJobIdSnap = await getDocs(query(applicationsRef, where('jobId', 'in', slice)));
          appsByJobIdSnap.docs.forEach((d) => tenantById.set(d.id, d));
          const appsByPostIdSnap = await getDocs(query(applicationsRef, where('postId', 'in', slice)));
          appsByPostIdSnap.docs.forEach((d) => tenantById.set(d.id, d));
        }
      }

      const tenantSnaps = Array.from(tenantById.values());
      const rows = tenantSnaps.map((d) => ({ id: d.id, data: d.data() as Record<string, unknown> }));

      if (rows.length === 0) {
        setApplicants([]);
        setLoading(false);
        return;
      }

      const applicationItems = rows.map((r) => ({ id: r.id, ...r.data })) as Array<Record<string, any> & { id: string }>;
      const userIds = Array.from(new Set(applicationItems.map((a) => a.userId).filter(Boolean)));

      const usersRef = collection(db, 'users');
      const usersSnap = await getDocs(usersRef);
      const userMap = new Map<string, any>();
      usersSnap.docs.forEach((u) => {
        if (userIds.includes(u.id)) userMap.set(u.id, u.data());
      });

      const requirementPackId = (jobOrder as any)?.requirementPackId;

      const applicantsData: Applicant[] = applicationItems
        .filter((app) => !isExcludedFromPlacementsApplicantPool(app.status))
        .map((app) => {
          const userData = userMap.get(app.userId) || {};
          const profileScore = calculateProfileScore(userData);
          const fitScore = app.scores?.fitScore ?? null;
          const hiringScore = getUserScore(userData);
          const packV1 = requirementPackId ? getRequirementPackV1(requirementPackId) : null;
          const appForScore = { ...app, userId: app.userId };
          const jobScoreSummary = packV1
            ? getOrComputeJobScoreSummaryV1(appForScore as { jobScoreSummary?: any }, userData, requirementPackId, hiringScore)
            : getOrComputeJobScoreSummary(appForScore, userData, requirementPackId, hiringScore);
          const rawStatus = app.status || 'submitted';
          const applicationStatus = normalizeApplicationStatus(rawStatus) ?? String(rawStatus);

          return {
            uid: app.userId,
            displayName: userData.displayName || `${userData.firstName || ''} ${userData.lastName || ''}`.trim(),
            firstName: userData.firstName || '',
            lastName: userData.lastName || '',
            email: userData.email || '',
            phone: userData.phone || userData.phoneE164 || '',
            avatar: userData.avatar,
            applicationData: app,
            city: userData.city || userData.addressInfo?.city || '',
            state: userData.state || userData.addressInfo?.state || '',
            workEligibility: userData.workEligibility || false,
            workEligibilityAttestation: userData.workEligibilityAttestation,
            comfortableEVerify: userData.comfortableEVerify,
            workerAttestations: userData.workerAttestations,
            phoneVerified: userData.phoneVerified || false,
            appliedAt: app.appliedAt,
            applicationStatus,
            profileScore,
            fitScore,
            hiringScore: typeof hiringScore === 'number' && Number.isFinite(hiringScore) ? hiringScore : undefined,
            scoreSummary: normalizeScoreSummary(userData.scoreSummary),
            jobScoreSummary: jobScoreSummary || null,
            ...((): { compliancePercent?: number; complianceStatus?: 'compliant' | 'expiring_soon' | 'non_compliant' | 'incomplete' } => {
              const onboarding = (userData as any)?.onboarding;
              if (onboarding?.checklist && Object.keys(onboarding.checklist).length > 0) {
                const sum = computeComplianceSummary(onboarding.checklist);
                return { compliancePercent: sum.compliancePercent, complianceStatus: sum.overallStatus };
              }
              if (onboarding?.compliancePercent != null || onboarding?.overallStatus) {
                return { compliancePercent: onboarding.compliancePercent, complianceStatus: onboarding.overallStatus };
              }
              return {};
            })(),
            selectedShifts: app.selectedShifts || [],
            shiftAssignments: app.shiftAssignments || {},
            hiringLifecycle: parseApplicationHiringLifecycle(app.hiringLifecycle),
          };
        });

      applicantsData.sort((a, b) => {
        const dateA = a.appliedAt?.toDate ? a.appliedAt.toDate() : new Date(0);
        const dateB = b.appliedAt?.toDate ? b.appliedAt.toDate() : new Date(0);
        return dateB.getTime() - dateA.getTime();
      });

      setApplicants(applicantsData);
    } catch (error) {
      console.error('Error fetching applicants:', error);
      setApplicants([]);
    } finally {
      setLoading(false);
    }
  }, [jobOrderId, connectedJobPosts, tenantId, jobOrder]);

  useEffect(() => {
    fetchApplicants();
  }, [fetchApplicants]);

  // Load shifts for shift selector (Gig jobs only)
  const isGigJob = jobOrder?.jobType === 'gig';
  useEffect(() => {
    if (!isGigJob) {
      setShifts([]);
      setSelectedShiftId('');
      return;
    }
    const loadShifts = async () => {
      if (!tenantId || !jobOrderId) {
        setShifts([]);
        return;
      }
      try {
        const shiftsRef = collection(db, 'tenants', tenantId, 'job_orders', jobOrderId, 'shifts');
        const snap = await getDocs(shiftsRef);
        // Show all shifts (same as Placements tab) so Shift/Day filters always appear for Gigs
        const loaded = snap.docs
          .map((d) => ({ id: d.id, ...d.data() } as ShiftOption))
          .sort((a, b) => {
            const da = getCalendarDayLocal(a.shiftDate);
            const db_ = getCalendarDayLocal(b.shiftDate);
            return da.localeCompare(db_);
          });
        setShifts(loaded);
        // Restore persisted selection, or default to first shift (same as Placements) so Day filter can show
        try {
          const saved = localStorage.getItem(appsStorageKey);
          if (saved) {
            const parsed = JSON.parse(saved);
            if (parsed?.shiftId && loaded.some((s) => s.id === parsed.shiftId)) {
              setSelectedShiftId(parsed.shiftId);
              if (isIsoGigDay(parsed?.day)) {
                setSelectedDay(parsed.day);
              }
              return;
            }
          }
        } catch {}
        if (loaded.length > 0) {
          if (selectedShiftId && !loaded.some((s) => s.id === selectedShiftId)) {
            setSelectedShiftId(loaded[0].id);
          } else if (!selectedShiftId) {
            setSelectedShiftId(loaded[0].id);
          }
        }
      } catch (err) {
        console.warn('Error loading shifts for Applications:', err);
        setShifts([]);
      }
    };
    loadShifts();
  }, [isGigJob, tenantId, jobOrderId, appsStorageKey]);

  useEffect(() => {
    try {
      localStorage.setItem(appsStorageKey, JSON.stringify({ shiftId: selectedShiftId, day: selectedDay || undefined }));
    } catch {}
  }, [selectedShiftId, selectedDay, appsStorageKey]);

  // Selected shift (full object) and multi-day day options
  const selectedShift = selectedShiftId ? shifts.find((s) => s.id === selectedShiftId) ?? null : null;
  /** YYYY-MM-DD in local calendar — matches Shift Setup / Placements / dateSchedule keys (not UTC from toISOString). */
  const shiftScheduleDayKey = (val: ShiftOption['shiftDate'] | ShiftOption['endDate'] | undefined): string =>
    getCalendarDayLocal(val ?? null);
  const isGigMultiDay = Boolean(
    selectedShift &&
    selectedShift.dateSchedule &&
    selectedShift.endDate &&
    shiftScheduleDayKey(selectedShift.endDate) !== shiftScheduleDayKey(selectedShift.shiftDate),
  );
  const dayOptions = useMemo(() => {
    if (!isGigMultiDay || !selectedShift) return [];
    return getDateScheduleEntriesWithHours(
      selectedShift.dateSchedule as unknown as DateSchedule | undefined,
      shiftScheduleDayKey(selectedShift.shiftDate),
      shiftScheduleDayKey(selectedShift.endDate),
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

  // Filter applicants by selected shift (Gig jobs only)
  const filteredApplicants = useMemo(() => {
    if (!isGigJob || !selectedShiftId) return applicants;
    return applicants.filter((a) => {
      const app = a.applicationData || {};
      return applicationMatchesShift(app, selectedShiftId);
    });
  }, [applicants, selectedShiftId, isGigJob]);

  // When a specific day is selected (multi-day gig), show only applicants who applied for that day (applyDate/applyDates).
  // When "All days", show all applicants for the shift (no duplicates). Applicants without applyDate/applyDates only show on "All days".
  const filteredByShiftAndDay = useMemo(() => {
    if (!selectedDay || !isGigMultiDay) return filteredApplicants;
    return filteredApplicants.filter((a) => {
      const app = a.applicationData || {};
      return applicationMatchesSelectedDay(app, selectedDay);
    });
  }, [filteredApplicants, selectedDay, isGigMultiDay]);

  const lifecycleCounts = useMemo(
    () =>
      countRecruiterLifecycleBuckets(
        filteredByShiftAndDay.map((a) => ({
          hiringLifecycle: a.hiringLifecycle,
          applicationStatus: a.applicationStatus,
          rawApplicationStatus: a.applicationData?.status,
        })),
      ),
    [filteredByShiftAndDay],
  );

  const filteredByLifecycle = useMemo(() => {
    if (lifecycleStageFilter === 'all') return filteredByShiftAndDay;
    return filteredByShiftAndDay.filter(
      (a) =>
        deriveRecruiterLifecycleBucket({
          hiringLifecycle: a.hiringLifecycle,
          applicationStatus: a.applicationStatus,
          rawApplicationStatus: a.applicationData?.status,
        }) === lifecycleStageFilter,
    );
  }, [filteredByShiftAndDay, lifecycleStageFilter]);

  const filteredByCategoryScores = useMemo(() => {
    const catId = categoryFilterCategoryId || null;
    const catMin =
      catId && categoryFilterCategoryMin != null ? categoryFilterCategoryMin : null;
    return filteredByLifecycle.filter((a) =>
      applicantPassesCategoryScoreFilters(
        a.uid,
        a.applicationData,
        categoryScoresCurrentByUserId,
        {
          minAvg: categoryFilterMinAvg,
          filterCategoryId: catId,
          filterCategoryMin: catMin,
        },
      ),
    );
  }, [
    filteredByLifecycle,
    categoryScoresCurrentByUserId,
    categoryFilterMinAvg,
    categoryFilterCategoryId,
    categoryFilterCategoryMin,
  ]);

  const categoryScoreFilterEmpty =
    (categoryFilterMinAvg != null ||
      (categoryFilterCategoryId && categoryFilterCategoryMin != null)) &&
    filteredByLifecycle.length > 0 &&
    filteredByCategoryScores.length === 0;

  const lifecycleFilterEmpty =
    lifecycleStageFilter !== 'all' && filteredByShiftAndDay.length > 0 && filteredByLifecycle.length === 0;

  const lifecycleFilterNextActionSummary = React.useMemo(
    () =>
      lifecycleStageFilter === 'all'
        ? []
        : summarizeNextActionsInApplicantList(filteredByCategoryScores),
    [lifecycleStageFilter, filteredByCategoryScores],
  );

  const handleRefreshScores = useCallback(async () => {
    const requirementPackId = (jobOrder as any)?.requirementPackId;
    const packV1 = requirementPackId ? getRequirementPackV1(requirementPackId) : null;
    if (!tenantId || !requirementPackId || !packV1) return;

    const toRefresh =
      selectedApplicationRowIds.size > 0
        ? applicants.filter((a) => selectedApplicationRowIds.has(applicationRowId(a, jobOrderId)))
        : applicants;
    if (toRefresh.length === 0) return;

    setRefreshingScores(true);
    try {
      for (const applicant of toRefresh) {
        const appId = applicant.applicationData?.id;
        if (!appId) continue;
        const userSnap = await getDoc(doc(db, 'users', applicant.uid));
        const userData = userSnap.exists() ? userSnap.data() : {};
        const aiScore = getUserScore(userData);
        const summary = computeJobScoreSummaryV1(userData as any, requirementPackId, aiScore, new Date(), {
          userProfileUpdatedAt: (userData as any)?.profileUpdatedAt ?? (userData as any)?.updatedAt,
        });
        if (!summary) continue;
        let appRef;
        try {
          appRef = applicationDocRefForApplicant(db, tenantId, jobOrderId, applicant);
        } catch {
          continue;
        }
        await updateDoc(appRef, {
          jobScoreSummary: { ...summary, computedAt: serverTimestamp(), writtenAt: serverTimestamp() },
          updatedAt: serverTimestamp(),
        });
      }
      await fetchApplicants();
    } catch (err) {
      console.error('Refresh scores failed:', err);
    } finally {
      setRefreshingScores(false);
    }
  }, [tenantId, jobOrder, selectedApplicationRowIds, applicants, fetchApplicants, jobOrderId]);

  // Fetch available job orders for switching
  useEffect(() => {
    const fetchJobOrders = async () => {
      if (!tenantId) return;
      
      try {
        const jobOrdersRef = collection(db, 'tenants', tenantId, 'job_orders');
        const jobOrdersSnapshot = await getDocs(jobOrdersRef);
        const jobOrdersData = jobOrdersSnapshot.docs
          .map(doc => ({ id: doc.id, ...doc.data() }))
          .filter((jo: any) => jo.id !== jobOrderId && jo.status === 'open'); // Exclude current job order and only show open jobs
        
        setAvailableJobOrders(jobOrdersData);
      } catch (error) {
        console.error('Error fetching job orders:', error);
      }
    };

    fetchJobOrders();
  }, [tenantId, jobOrderId]);

  // Subscribe to assignments for this job order (Placements status: Placed, Assigned)
  useEffect(() => {
    if (!tenantId || !jobOrderId) {
      setAssignmentStatusByUserId(new Map());
      return;
    }
    const assignmentsRef = collection(db, 'tenants', tenantId, 'assignments');
    const assignmentsQuery = query(
      assignmentsRef,
      where('jobOrderId', '==', jobOrderId),
    );
    const unsubscribe = onSnapshot(
      assignmentsQuery,
      (snapshot) => {
        const nextStatus = new Map<string, string>();
        snapshot.docs.forEach((docSnap) => {
          const data = docSnap.data() as Record<string, unknown>;
          const userId = String(data?.userId || data?.candidateId || '');
          const status = String(data?.status || 'proposed').toLowerCase();
          if (!userId) return;
          // Include all statuses (incl. declined/cancelled) so Applications table can show Declined/Cancelled
          const existing = nextStatus.get(userId);
          if (!existing) {
            nextStatus.set(userId, status);
            return;
          }
          const rank = (s: string) =>
            ['confirmed', 'active'].includes(s) ? 3 : ['proposed', 'accepted'].includes(s) ? 2 : ['declined', 'canceled', 'cancelled'].includes(s) ? 1 : 0;
          if (rank(status) > rank(existing)) nextStatus.set(userId, status);
        });
        setAssignmentStatusByUserId(nextStatus);
      },
      (err) => console.warn('Assignments onSnapshot error:', err),
    );
    return () => unsubscribe();
  }, [tenantId, jobOrderId]);

  const handleViewApplicant = (uid: string) => {
    // Open in new tab
    window.open(`/users/${uid}`, '_blank');
  };

  const handleOpenActionMenu = (event: React.MouseEvent<HTMLElement>, applicantRowId: string) => {
    event.stopPropagation();
    setActionMenuAnchor({ ...actionMenuAnchor, [applicantRowId]: event.currentTarget });
  };

  const handleCloseActionMenu = (applicantRowId: string) => {
    setActionMenuAnchor({ ...actionMenuAnchor, [applicantRowId]: null });
  };

  const handleOpenStatusMenu = (event: React.MouseEvent<HTMLElement>, applicantRowId: string) => {
    event.stopPropagation();
    setStatusMenuAnchor({ ...statusMenuAnchor, [applicantRowId]: event.currentTarget });
  };

  const handleCloseStatusMenu = (applicantRowId: string) => {
    setStatusMenuAnchor({ ...statusMenuAnchor, [applicantRowId]: null });
  };

  const handleOpenLevelMenu = (event: React.MouseEvent<HTMLElement>, applicantRowId: string) => {
    event.stopPropagation();
    setLevelMenuAnchor({ ...levelMenuAnchor, [applicantRowId]: event.currentTarget });
  };

  const handleCloseLevelMenu = (applicantRowId: string) => {
    setLevelMenuAnchor({ ...levelMenuAnchor, [applicantRowId]: null });
  };

  const toMillis = (input: any): number => {
    if (!input) return -1;
    if (input instanceof Date) return input.getTime();
    if (typeof input === 'number') return input;
    if (typeof input === 'string') {
      const parsed = Date.parse(input);
      return Number.isNaN(parsed) ? -1 : parsed;
    }
    if (typeof input === 'object') {
      if (typeof input.toDate === 'function') return input.toDate().getTime();
      if (typeof input._seconds === 'number') return input._seconds * 1000;
    }
    return -1;
  };

  const handleApplicantsSort = (key: 'interview' | 'jobScore') => {
    if (applicantsSortBy === key) {
      setApplicantsSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setApplicantsSortBy(key);
    setApplicantsSortDirection('desc');
  };

  const sortedApplicants = React.useMemo(() => {
    if (applicantsSortBy === 'interview') {
      const data = [...filteredByCategoryScores];
      data.sort((a, b) => {
        const aM = toMillis(a.scoreSummary?.interviewLastAt);
        const bM = toMillis(b.scoreSummary?.interviewLastAt);
        const diff = aM - bM;
        return applicantsSortDirection === 'asc' ? diff : -diff;
      });
      return data;
    }
    if (applicantsSortBy === 'jobScore') {
      const data = [...filteredByCategoryScores];
      data.sort((a, b) => {
        const aScore = a.jobScoreSummary?.jobScore ?? -1;
        const bScore = b.jobScoreSummary?.jobScore ?? -1;
        const diff = aScore - bScore;
        return applicantsSortDirection === 'asc' ? diff : -diff;
      });
      return data;
    }
    if (applicantsSortBy === 'category_avg') {
      const data = [...filteredByCategoryScores];
      data.sort((a, b) => {
        const sa = getEffectiveCategoryScoresForApplicantRow(
          a.uid,
          a.applicationData,
          categoryScoresCurrentByUserId,
        ).scores;
        const sb = getEffectiveCategoryScoresForApplicantRow(
          b.uid,
          b.applicationData,
          categoryScoresCurrentByUserId,
        ).scores;
        const av = sa ? averageCategoryScore(sa) : null;
        const bv = sb ? averageCategoryScore(sb) : null;
        return compareApplicantsByCategoryScore(av, bv, applicantsSortDirection);
      });
      return data;
    }
    if (applicantsSortBy && PRESCREEN_CATEGORY_IDS.includes(applicantsSortBy as PrescreenCategoryId)) {
      const cat = applicantsSortBy as PrescreenCategoryId;
      const data = [...filteredByCategoryScores];
      data.sort((a, b) => {
        const sa = getEffectiveCategoryScoresForApplicantRow(
          a.uid,
          a.applicationData,
          categoryScoresCurrentByUserId,
        ).scores;
        const sb = getEffectiveCategoryScoresForApplicantRow(
          b.uid,
          b.applicationData,
          categoryScoresCurrentByUserId,
        ).scores;
        const av = sa ? sa[cat] : null;
        const bv = sb ? sb[cat] : null;
        return compareApplicantsByCategoryScore(av, bv, applicantsSortDirection);
      });
      return data;
    }
    return filteredByCategoryScores;
  }, [
    filteredByCategoryScores,
    applicantsSortBy,
    applicantsSortDirection,
    categoryScoresCurrentByUserId,
  ]);

  const displayedApplicants = applicantsSortBy ? sortedApplicants : filteredByCategoryScores;

  // Notify parent of count changes (use displayed count)
  useEffect(() => {
    if (onCountChange) onCountChange(displayedApplicants.length);
  }, [displayedApplicants.length, onCountChange]);
  useEffect(() => {
    if (onCandidateCountChange) {
      const candidateCount = displayedApplicants.filter(
        (a) => a.applicationData?.candidate === true
      ).length;
      onCandidateCountChange(candidateCount);
    }
  }, [displayedApplicants, onCandidateCountChange]);
  const isAllSelected =
    displayedApplicants.length > 0 && selectedApplicationRowIds.size === displayedApplicants.length;
  const isSomeSelected = selectedApplicationRowIds.size > 0;

  const handleSelectAll = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.checked) {
      setSelectedApplicationRowIds(new Set(displayedApplicants.map((a) => applicationRowId(a, jobOrderId))));
    } else {
      setSelectedApplicationRowIds(new Set());
    }
  };

  const handleSelectOne = (rowId: string) => {
    setSelectedApplicationRowIds((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  };

  const handleBulkChangeStatus = (newStatus: string) => {
    const rowIds = Array.from(selectedApplicationRowIds);
    rowIds.forEach((rowId) => {
      const applicant = applicants.find((a) => applicationRowId(a, jobOrderId) === rowId);
      if (applicant) handleChangeStatus(applicant, newStatus);
    });
    setBulkStatusMenuAnchor(null);
    setSelectedApplicationRowIds(new Set());
  };

  const handleOpenBulkStatusMenu = (event: React.MouseEvent<HTMLElement>) => {
    setBulkStatusMenuAnchor(event.currentTarget);
  };

  const handleCloseBulkStatusMenu = () => {
    setBulkStatusMenuAnchor(null);
  };

  const bulkRecipientsAndIds = React.useMemo(() => {
    const selected = applicants.filter((a) => selectedApplicationRowIds.has(applicationRowId(a, jobOrderId)));
    const recipients: MessageRecipient[] = selected.map((a) => ({
      userId: a.uid,
      name: a.displayName || [a.firstName, a.lastName].filter(Boolean).join(' ').trim() || a.uid,
      email: a.email,
      phone: a.phone,
    }));
    const recipientUserIds = selected.map((a) => a.uid);
    return { recipients, recipientUserIds };
  }, [applicants, selectedApplicationRowIds, jobOrderId]);

  const formatInterviewDate = (ts: any) => {
    const d = ts?.toDate?.();
    if (d) return format(d, 'MMM d, yyyy');
    const d2 = ts instanceof Date ? ts : new Date(ts);
    return Number.isNaN(d2.getTime()) ? 'N/A' : format(d2, 'MMM d, yyyy');
  };

  const renderInterviewCell = (applicant: Applicant) => (
    <Stack spacing={0.5} alignItems="flex-start">
      <InterviewCell
        userId={applicant.uid}
        scoreSummary={applicant.scoreSummary}
        formatDate={formatInterviewDate}
      />
      <RecruiterApplicantCategoryScoresRow
        userId={applicant.uid}
        applicationData={applicant.applicationData}
        currentCategoryScores={categoryScoresCurrentByUserId[applicant.uid] ?? null}
        currentScoresLoading={categoryScoresCurrentLoading}
      />
    </Stack>
  );

  const handleChangeStatus = async (applicant: Applicant, newStatus: string) => {
    try {
      let applicationRef;
      try {
        applicationRef = applicationDocRefForApplicant(db, tenantId, jobOrderId, applicant);
      } catch {
        alert('Missing application document for this row.');
        return;
      }
      const updateData: Record<string, unknown> = {
        status: newStatus,
        updatedAt: serverTimestamp(),
      };
      // When reverting to submitted, clear deleted flags so application is no longer treated as removed
      if (newStatus === 'submitted') {
        updateData.deletedAt = deleteField();
        updateData.deletedBy = deleteField();
      }
      await updateDoc(applicationRef, updateData);

      const rid = applicationRowId(applicant, jobOrderId);
      setApplicants((prev) =>
        prev.map((a) => (applicationRowId(a, jobOrderId) === rid ? { ...a, applicationStatus: newStatus } : a)),
      );

      handleCloseStatusMenu(rid);
    } catch (error) {
      console.error('❌ Error changing application status:', error);
      alert('Failed to update status. Check the console for details.');
    }
  };

  const handleChangeLevel = async (applicant: Applicant, newLevel: 'applicant' | 'candidate') => {
    try {

      if (!applicant.applicationData?.id) {
        console.error('❌ No application ID found for applicant');
        return;
      }

      const isCandidateNow = newLevel === 'candidate';

      // Update the candidate field directly on the APPLICATION DOCUMENT
      // This makes candidate status specific to this application
      const applicationRef = applicationDocRefForApplicant(db, tenantId, jobOrderId, applicant);
      const updateData: any = {
        candidate: isCandidateNow,
        updatedAt: serverTimestamp()
      };

      if (isCandidateNow) {
        updateData.vettedBy = user?.uid || 'unknown';
        updateData.vettedAt = serverTimestamp();
      } else {
        // Remove vetted fields when demoting back to applicant
        updateData.vettedBy = null;
        updateData.vettedAt = null;
      }

      await updateDoc(applicationRef, updateData);

      // TODO: Log activity

      // Update local state to reflect the change
      const rid = applicationRowId(applicant, jobOrderId);
      setApplicants((prev) =>
        prev.map((a) =>
          applicationRowId(a, jobOrderId) === rid
            ? {
                ...a,
                applicationData: {
                  ...a.applicationData,
                  candidate: isCandidateNow,
                  vettedBy: isCandidateNow ? user?.uid || 'unknown' : null,
                  vettedAt: isCandidateNow ? new Date() : null,
                },
              }
            : a,
        ),
      );

      handleCloseLevelMenu(rid);
    } catch (error) {
      console.error('❌ Error changing level:', error);
    }
  };

  const handleMarkAsCandidate = async (applicant: Applicant) => {
    // Reuse the new handleChangeLevel function
    await handleChangeLevel(applicant, 'candidate');
    handleCloseActionMenu(applicationRowId(applicant, jobOrderId));
  };

  const handleRemoveApplication = async (applicant: Applicant) => {
    if (!confirm(`Are you sure you want to remove ${applicant.displayName}'s application?`)) {
      return;
    }

    if (!tenantId || !applicant.uid) {
      alert('Missing tenant or applicant info.');
      return;
    }

    try {
      let appRef;
      try {
        appRef = applicationDocRefForApplicant(db, tenantId, jobOrderId, applicant);
      } catch {
        alert('Could not resolve application document to remove.');
        return;
      }
      await updateDoc(appRef, {
        status: 'deleted',
        deletedAt: serverTimestamp(),
        deletedBy: user?.uid,
        updatedAt: serverTimestamp(),
      });

      const rid = applicationRowId(applicant, jobOrderId);
      setApplicants((prev) => prev.filter((a) => applicationRowId(a, jobOrderId) !== rid));
      handleCloseActionMenu(rid);
    } catch (error) {
      console.error('❌ Error removing application:', error);
      alert('Error removing application. Please try again.');
    }
  };

  const handleOpenSwitchJobDialog = (applicant: Applicant) => {
    setSelectedApplicant(applicant);
    setSwitchJobDialogOpen(true);
    setTargetJobOrderId('');
    handleCloseActionMenu(applicationRowId(applicant, jobOrderId));
  };

  const handleCloseSwitchJobDialog = () => {
    setSwitchJobDialogOpen(false);
    setSelectedApplicant(null);
    setTargetJobOrderId('');
  };

  const handleSwitchJob = async () => {
    if (!selectedApplicant || !targetJobOrderId) return;

    try {
      // Get the target job order details
      const targetJobOrderRef = doc(db, 'tenants', tenantId, 'job_orders', targetJobOrderId);
      const targetJobOrderDoc = await getDoc(targetJobOrderRef);
      
      if (!targetJobOrderDoc.exists()) {
        alert('Target job order not found');
        return;
      }

      const targetJobOrder = targetJobOrderDoc.data();

      const currentApplicationDocId = selectedApplicant.applicationData?.id;
      if (!currentApplicationDocId) {
        console.error('Could not find application to switch');
        alert('Could not find application to switch');
        return;
      }

      // Create a unique application ID for the new job order
      const newApplicationId = `${tenantId}_${targetJobOrderId}_${Date.now()}`;
      const newTenantAppDocId = `${selectedApplicant.uid}_${targetJobOrderId}_${Date.now()}`;
      
      // Create a new canonical tenant application for the target job order
      const newApplicationData = {
        applicationId: newApplicationId,
        id: newTenantAppDocId,
        tenantId,
        userId: selectedApplicant.uid,
        jobId: null, // No specific job post, this is a switched application
        jobOrderId: targetJobOrderId,
        jobOrderName: targetJobOrder.jobOrderName || '',
        jobTitle: targetJobOrder.jobTitle || '',
        companyId: targetJobOrder.companyId || '',
        companyName: targetJobOrder.companyName || '',
        location: targetJobOrder.worksiteName || '',
        payRate: targetJobOrder.payRate || 0,
        startDate: targetJobOrder.startDate || null,
        status: 'submitted',
        candidate: false,
        appliedAt: new Date(),
        updatedAt: new Date(),
        source: 'job_switch',
        switchedFrom: jobOrderId,
        switchedFromApplicationId: currentApplicationDocId,
        switchedAt: new Date(),
        switchedBy: user?.uid
      };

      const currentApplicationRef = applicationDocRefForApplicant(db, tenantId, jobOrderId, selectedApplicant);
      const newApplicationRef = doc(db, 'tenants', tenantId, 'applications', newTenantAppDocId);

      // Soft-delete current application and create the new application
      await updateDoc(currentApplicationRef, {
        status: 'deleted',
        deletedAt: serverTimestamp(),
        deletedBy: user?.uid,
        updatedAt: serverTimestamp(),
      });
      await setDoc(
        newApplicationRef,
        {
          ...newApplicationData,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );

      // TODO: Log activity

      const rid = applicationRowId(selectedApplicant, jobOrderId);
      setApplicants((prev) => prev.filter((a) => applicationRowId(a, jobOrderId) !== rid));

      handleCloseSwitchJobDialog();
    } catch (error) {
      console.error('❌ Error switching job:', error);
      alert('Error switching job. Please try again.');
    }
  };

  const handleOpenAddApplicantDialog = async () => {
    setAddApplicantDialogOpen(true);
    setLoadingUsers(true);
    
    try {
      const usersRef = collection(db, 'users');
      const usersSnapshot = await getDocs(usersRef);
      
      const users: any[] = [];
      
      usersSnapshot.docs.forEach(doc => {
        const userData = doc.data();
        
        // Check if user belongs to this tenant
        if (!userData.tenantIds || !userData.tenantIds[tenantId]) return;
        
        const tenantData = userData.tenantIds[tenantId];
        const securityLevel = parseInt(tenantData.securityLevel || userData.securityLevel || '0');
        
        // Only include users with securityLevel 2 or 3 (Applicants and Candidates)
        if (securityLevel !== 2 && securityLevel !== 3) return;
        
        // If job order has userGroup restrictions, only show members of those groups
        if (jobOrder?.restrictedGroups && jobOrder.restrictedGroups.length > 0) {
          const userGroupIds = userData.userGroupIds || [];
          const hasMatchingGroup = jobOrder.restrictedGroups.some(groupId => 
            userGroupIds.includes(groupId)
          );
          
          if (!hasMatchingGroup) return;
        }
        
        // Don't include users who already applied
        const alreadyApplied = applicants.some(a => a.uid === doc.id);
        if (alreadyApplied) return;
        
        users.push({
          uid: doc.id,
          displayName: userData.displayName || `${userData.firstName || ''} ${userData.lastName || ''}`.trim(),
          email: userData.email || '',
          securityLevel,
          city: userData.city || userData.addressInfo?.city || '',
          state: userData.state || userData.addressInfo?.state || ''
        });
      });
      
      // Sort by name
      users.sort((a, b) => a.displayName.localeCompare(b.displayName));
      
      setAvailableUsers(users);
    } catch (error) {
      console.error('Error loading users:', error);
    } finally {
      setLoadingUsers(false);
    }
  };

  const handleCloseAddApplicantDialog = () => {
    setAddApplicantDialogOpen(false);
    setSelectedUserId('');
  };

  const handleAddApplicant = async () => {
    if (!selectedUserId || !jobOrder) return;
    
    try {
      
      // Get the first connected job post to use as the jobId
      const jobId = connectedJobPosts[0]?.id || `manual_${Date.now()}`;
      const applicationId = `${tenantId}_${jobId}`;
      const tenantAppDocId = `${selectedUserId}_${jobId}`;
      
      // Create application data
      const applicationData = {
        applicationId,
        id: tenantAppDocId,
        jobId,
        jobOrderId: jobOrderId,
        jobOrderName: jobOrder.jobOrderName || '',
        jobTitle: jobOrder.jobTitle || '',
        postTitle: jobOrder.jobOrderName || '',
        companyId: jobOrder.companyId || '',
        companyName: jobOrder.companyName || '',
        location: jobOrder.worksiteName || '',
        payRate: jobOrder.payRate || 0,
        startDate: jobOrder.startDate || null,
        status: 'submitted',
        candidate: false,
        appliedAt: new Date(),
        updatedAt: new Date(),
        source: 'manual_add',
        addedBy: user?.uid
      };
      
      // 1) Create tenant application doc (source of truth for recruiter application list)
      const tenantApplicationRef = doc(db, 'tenants', tenantId, 'applications', tenantAppDocId);
      await setDoc(
        tenantApplicationRef,
        {
          ...applicationData,
          tenantId,
          userId: selectedUserId,
          status: 'submitted',
          candidate: false,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );

      // Read user profile data for immediate local row update (no user application mirror write)
      const userRef = doc(db, 'users', selectedUserId);
      const userDoc = await getDoc(userRef);
      
      // TODO: Log activity

      try {
        const functions = getFunctions();
        const enqueueApplicantScore = httpsCallable(functions as any, 'enqueueApplicantScore');
        await enqueueApplicantScore({
          userId: selectedUserId,
          applicationId,
          tenantId,
          source: 'recruiter_manual_add'
        });
      } catch (queueErr) {
      }
      
      if (userDoc.exists()) {
        const userData = userDoc.data();
        const savedApplicationData = {
          ...applicationData,
          tenantId,
          userId: selectedUserId,
          id: tenantAppDocId,
        };
        
        // Calculate Profile Score
        const profileScore = calculateProfileScore(userData);
        const fitScore = (savedApplicationData as any)?.scores?.fitScore ?? null;
        
        const newApplicant: Applicant = {
          uid: selectedUserId,
          displayName: userData.displayName || `${userData.firstName || ''} ${userData.lastName || ''}`.trim(),
          firstName: userData.firstName || '',
          lastName: userData.lastName || '',
          email: userData.email || '',
          phone: userData.phone || userData.phoneE164 || '',
          avatar: userData.avatar,
          applicationData: {
            ...savedApplicationData,
          },
          city: userData.city || userData.addressInfo?.city || '',
          state: userData.state || userData.addressInfo?.state || '',
          workEligibility: userData.workEligibility || false,
          workEligibilityAttestation: userData.workEligibilityAttestation,
          comfortableEVerify: userData.comfortableEVerify,
          workerAttestations: userData.workerAttestations,
          phoneVerified: userData.phoneVerified || false,
          appliedAt: savedApplicationData.appliedAt,
          applicationStatus: 'submitted',
          profileScore,
          fitScore
        };
        
        setApplicants(prev => [newApplicant, ...prev]);
      }
      
      handleCloseAddApplicantDialog();
    } catch (error) {
      console.error('❌ Error adding applicant:', error);
      alert('Error adding applicant. Please try again.');
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (connectedJobPosts.length === 0) {
    return (
      <Card>
        <CardContent>
          <Alert severity="info">
            No job posts are connected to this job order. Create a job post to start receiving applications.
          </Alert>
        </CardContent>
      </Card>
    );
  }

  // Always show the Applications card with Add Applicant button; table body shows empty state when no applicants
  return (
    <>
      <Card>
        <CardHeader 
          title={`Applications (${displayedApplicants.length})`}
          action={
            <Stack direction="row" alignItems="center" spacing={1}>
              {jobOrder?.requirementPackId && (
                <Button
                  variant="outlined"
                  size="small"
                  disabled={refreshingScores || applicants.length === 0}
                  onClick={handleRefreshScores}
                  startIcon={refreshingScores ? <CircularProgress size={16} /> : <SaveIcon />}
                >
                  {refreshingScores ? 'Refreshing…' : 'Refresh scores'}
                </Button>
              )}
              <Button
                variant="contained"
                startIcon={<AddIcon />}
                onClick={handleOpenAddApplicantDialog}
              >
                Add Applicant
              </Button>
            </Stack>
          }
          sx={{ borderBottom: 1, borderColor: 'divider' }}
        />
        <CardContent sx={{ p: 0 }}>
          {isGigJob && shifts.length > 0 && (
            <Box sx={{ px: 2, py: 1.5, borderBottom: 1, borderColor: 'divider', display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center' }}>
              <FormControl size="small" sx={{ minWidth: 280 }}>
                <InputLabel>Shift</InputLabel>
                <Select
                  value={selectedShiftId}
                  label="Shift"
                  onChange={(e) => {
                    setSelectedShiftId(e.target.value);
                    setSelectedDay('');
                  }}
                  renderValue={(value) => {
                    if (!value) {
                      return <em>All shifts</em>;
                    }
                    const shift = shifts.find((s) => s.id === value);
                    if (!shift) return '';
                    return (
                      <Box sx={{ lineHeight: 1.25, textAlign: 'left' }}>
                        <Typography variant="body2" component="span" display="block">
                          {shift.shiftTitle || 'Shift'}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" component="span" display="block">
                          {buildShiftPickerSecondLine(shift, jobOrder?.jobTitle)}
                        </Typography>
                      </Box>
                    );
                  }}
                >
                  <MenuItem value="">
                    <em>All shifts</em>
                  </MenuItem>
                  {shifts.map((shift) => (
                    <MenuItem key={shift.id} value={shift.id}>
                      <Box>
                        <Typography variant="body2">{shift.shiftTitle || 'Shift'}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {buildShiftPickerSecondLine(shift, jobOrder?.jobTitle)}
                        </Typography>
                      </Box>
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              {isGigMultiDay && dayOptions.length > 0 && (
                <FormControl size="small" sx={{ minWidth: 200 }}>
                  <InputLabel>Day</InputLabel>
                  <Select
                    value={selectedDay || '__all__'}
                    label="Day"
                    onChange={(e) => setSelectedDay(e.target.value === '__all__' ? '' : e.target.value)}
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
            </Box>
          )}
          <Box
            sx={{
              px: 2,
              py: 1.5,
              borderBottom: 1,
              borderColor: 'divider',
              display: 'flex',
              flexWrap: 'wrap',
              gap: 2,
              alignItems: 'center',
            }}
          >
            <FormControl size="small" sx={{ minWidth: 280 }}>
              <InputLabel>Lifecycle stage</InputLabel>
              <Select
                value={lifecycleStageFilter}
                label="Lifecycle stage"
                onChange={(e) =>
                  setLifecycleStageFilter(e.target.value as 'all' | RecruiterLifecycleFilterBucket)
                }
              >
                <MenuItem value="all">All stages ({filteredByShiftAndDay.length})</MenuItem>
                {RECRUITER_LIFECYCLE_BUCKET_ORDER.map((b) => (
                  <MenuItem key={b} value={b}>
                    {RECRUITER_LIFECYCLE_BUCKET_LABELS[b]} ({lifecycleCounts[b]})
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <Stack direction="row" flexWrap="wrap" useFlexGap spacing={0.75} alignItems="center" sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>
                Counts (current shift/day filter):
              </Typography>
              {RECRUITER_LIFECYCLE_BUCKET_ORDER.map((b) => (
                <Tooltip key={b} title={`${RECRUITER_LIFECYCLE_BUCKET_LABELS[b]} — click to filter`}>
                  <Chip
                    size="small"
                    variant={lifecycleStageFilter === b ? 'filled' : 'outlined'}
                    color={lifecycleStageFilter === b ? 'primary' : 'default'}
                    onClick={() => setLifecycleStageFilter((prev) => (prev === b ? 'all' : b))}
                    label={`${RECRUITER_LIFECYCLE_BUCKET_SHORT_LABELS[b]} · ${lifecycleCounts[b]}`}
                    sx={{ cursor: 'pointer' }}
                  />
                </Tooltip>
              ))}
            </Stack>
          </Box>
          <Box
            sx={{
              px: 2,
              py: 1.5,
              borderBottom: 1,
              borderColor: 'divider',
              display: 'flex',
              flexWrap: 'wrap',
              gap: 2,
              alignItems: 'flex-end',
            }}
          >
            <Typography variant="caption" color="text.secondary" sx={{ width: '100%', mb: -0.5 }}>
              Category scores — filters & sort use <strong>current worker profile</strong> scores when loaded; if not set,
              the <strong>interview snapshot on this application</strong> is used. Applicants with neither score are excluded
              when a minimum threshold is set. Sorting uses the same rule; missing scores sort to the bottom.
            </Typography>
            <FormControl size="small" sx={{ minWidth: 140 }}>
              <InputLabel>Avg ≥</InputLabel>
              <Select
                label="Avg ≥"
                value={categoryFilterMinAvg == null ? '' : String(categoryFilterMinAvg)}
                onChange={(e) => {
                  const v = e.target.value;
                  setCategoryFilterMinAvg(v === '' ? null : Number(v));
                }}
              >
                <MenuItem value="">
                  <em>All</em>
                </MenuItem>
                {CATEGORY_SCORE_FILTER_THRESHOLDS.map((t) => (
                  <MenuItem key={t} value={String(t)}>
                    {t}+
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 160 }}>
              <InputLabel>Category min</InputLabel>
              <Select
                label="Category min"
                value={categoryFilterCategoryId || ''}
                onChange={(e) => {
                  const v = e.target.value as PrescreenCategoryId | '';
                  setCategoryFilterCategoryId(v);
                  if (!v) setCategoryFilterCategoryMin(null);
                }}
              >
                <MenuItem value="">
                  <em>Any category</em>
                </MenuItem>
                {PRESCREEN_CATEGORY_IDS.map((id) => (
                  <MenuItem key={id} value={id}>
                    {formatPrescreenCategoryLabel(id)}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 120 }} disabled={!categoryFilterCategoryId}>
              <InputLabel>Min</InputLabel>
              <Select
                label="Min"
                value={categoryFilterCategoryMin == null ? '' : String(categoryFilterCategoryMin)}
                onChange={(e) => {
                  const v = e.target.value;
                  setCategoryFilterCategoryMin(v === '' ? null : Number(v));
                }}
              >
                <MenuItem value="">
                  <em>—</em>
                </MenuItem>
                {CATEGORY_SCORE_FILTER_THRESHOLDS.map((t) => (
                  <MenuItem key={t} value={String(t)}>
                    {t}+
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 260 }}>
              <InputLabel>Sort by</InputLabel>
              <Select
                label="Sort by"
                value={
                  applicantsSortBy == null
                    ? ''
                    : applicantsSortBy === 'category_avg'
                      ? 'category_avg'
                      : String(applicantsSortBy)
                }
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === '') {
                    setApplicantsSortBy(null);
                    return;
                  }
                  if (v === 'interview' || v === 'jobScore') {
                    setApplicantsSortBy(v);
                    setApplicantsSortDirection('desc');
                    return;
                  }
                  if (v === 'category_avg') {
                    setApplicantsSortBy('category_avg');
                    setApplicantsSortDirection('desc');
                    return;
                  }
                  if (PRESCREEN_CATEGORY_IDS.includes(v as PrescreenCategoryId)) {
                    setApplicantsSortBy(v as PrescreenCategoryId);
                    setApplicantsSortDirection('desc');
                  }
                }}
              >
                <MenuItem value="">
                  <em>Applied date (default)</em>
                </MenuItem>
                {jobOrder?.requirementPackId ? (
                  <MenuItem value="jobScore">Job score (requirement pack)</MenuItem>
                ) : null}
                <MenuItem value="interview">Interview activity (date)</MenuItem>
                <MenuItem value="category_avg">Current category average</MenuItem>
                {PRESCREEN_CATEGORY_IDS.map((id) => (
                  <MenuItem key={`sort-${id}`} value={id}>
                    Current — {formatPrescreenCategoryLabel(id)}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>
          {lifecycleStageFilter !== 'all' && (
            <Box
              sx={{
                px: 2,
                py: 1.75,
                borderBottom: 1,
                borderColor: 'divider',
                bgcolor: 'action.hover',
              }}
            >
              <Typography variant="subtitle2" fontWeight={700} gutterBottom>
                {RECRUITER_LIFECYCLE_BUCKET_LABELS[lifecycleStageFilter]}
              </Typography>
              <Typography variant="body2" color="text.primary" sx={{ mb: 1 }}>
                {RECRUITER_LIFECYCLE_FILTER_GUIDANCE[lifecycleStageFilter].summary}
              </Typography>
              <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: lifecycleFilterNextActionSummary.length ? 1 : 0 }}>
                <strong>Suggested next steps</strong>
                <Box component="ul" sx={{ m: 0, pl: 2.5, mt: 0.5 }}>
                  {RECRUITER_LIFECYCLE_FILTER_GUIDANCE[lifecycleStageFilter].suggestedCues.map((c) => (
                    <li key={c}>
                      <Typography variant="caption" component="span">
                        {c}
                      </Typography>
                    </li>
                  ))}
                </Box>
              </Typography>
              {lifecycleFilterNextActionSummary.length > 0 ? (
                <Typography variant="caption" color="text.secondary" display="block">
                  <strong>Next actions in this list</strong> (from stored lifecycle data):{' '}
                  {lifecycleFilterNextActionSummary.map((r, i) => (
                    <React.Fragment key={r.key}>
                      {i > 0 ? ' · ' : ''}
                      {r.label} ({r.count})
                    </React.Fragment>
                  ))}
                </Typography>
              ) : (
                <Typography variant="caption" color="text.secondary" display="block" sx={{ fontStyle: 'italic' }}>
                  No next-action hints stored on these rows yet—use the steps above and the Lifecycle column when present.
                </Typography>
              )}
            </Box>
          )}
          {isSomeSelected && (
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                px: 2,
                py: 1.5,
                borderBottom: 1,
                borderColor: 'divider',
                bgcolor: 'action.hover',
              }}
            >
              <Typography variant="body2" color="text.secondary">
                {selectedApplicationRowIds.size} selected
              </Typography>
              <Button
                size="small"
                variant="outlined"
                startIcon={<EmailIcon />}
                onClick={() => {
                  setBulkDrawerChannel('email');
                  setBulkDrawerOpen(true);
                }}
                sx={{ textTransform: 'none' }}
              >
                Bulk Email
              </Button>
              <Button
                size="small"
                variant="outlined"
                startIcon={<SmsIcon />}
                onClick={() => {
                  setBulkDrawerChannel('sms');
                  setBulkDrawerOpen(true);
                }}
                sx={{ textTransform: 'none' }}
              >
                Bulk SMS
              </Button>
              <Button
                size="small"
                variant="outlined"
                startIcon={<CheckCircleIcon />}
                onClick={handleOpenBulkStatusMenu}
              >
                Change status
              </Button>
              <Menu
                anchorEl={bulkStatusMenuAnchor}
                open={Boolean(bulkStatusMenuAnchor)}
                onClose={handleCloseBulkStatusMenu}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
                transformOrigin={{ vertical: 'top', horizontal: 'left' }}
              >
                <MenuItem onClick={() => handleBulkChangeStatus('submitted')}>Submitted</MenuItem>
                <MenuItem onClick={() => handleBulkChangeStatus('waitlisted')}>Waitlisted</MenuItem>
                <MenuItem onClick={() => handleBulkChangeStatus('rejected')}>Rejected</MenuItem>
              </Menu>
              <Button size="small" onClick={() => setSelectedApplicationRowIds(new Set())}>
                Clear selection
              </Button>
            </Box>
          )}
          <TableContainer sx={{ overflowX: 'auto' }}>
            <Table>
            <TableHead>
              <TableRow sx={{ bgcolor: 'grey.50' }}>
                <TableCell padding="checkbox" sx={{ width: 48 }}>
                  <Checkbox
                    indeterminate={isSomeSelected && !isAllSelected}
                    checked={isAllSelected}
                    onChange={handleSelectAll}
                    size="small"
                    aria-label="select all applicants"
                  />
                </TableCell>
                <TableCell sx={{ width: 60 }}></TableCell>
                <TableCell>Applicant</TableCell>
                <TableCell>Contact</TableCell>
                <TableCell>Auth</TableCell>
                <TableCell>Documented</TableCell>
                <TableCell>Location</TableCell>
                <TableCell>Applied</TableCell>
                {isGigJob && shifts.length > 0 ? (
                  <TableCell>Shift(s)</TableCell>
                ) : null}
                <TableCell>Profile</TableCell>
                <TableCell>Fit</TableCell>
                {jobOrder?.requirementPackId ? (
                  <>
                    <TableCell>
                      <TableSortLabel
                        active={applicantsSortBy === 'jobScore'}
                        direction={applicantsSortBy === 'jobScore' ? applicantsSortDirection : 'desc'}
                        onClick={() => handleApplicantsSort('jobScore')}
                      >
                        Job Score
                      </TableSortLabel>
                    </TableCell>
                    <TableCell>Missing</TableCell>
                  </>
                ) : null}
                <TableCell sx={{ minWidth: 120 }}>
                  <TableSortLabel
                    active={applicantsSortBy === 'interview'}
                    direction={applicantsSortBy === 'interview' ? applicantsSortDirection : 'desc'}
                    onClick={() => handleApplicantsSort('interview')}
                  >
                    Interview
                  </TableSortLabel>
                  <Tooltip title="Date and score from the latest interview; category chip shows the six category snapshot from the worker AI pre-screen when saved on this application (read-only).">
                    <Typography component="span" variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                      + categories
                    </Typography>
                  </Tooltip>
                </TableCell>
                <TableCell>Compliance</TableCell>
                <TableCell>Lifecycle</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Level</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {displayedApplicants.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={25} sx={{ py: 4, textAlign: 'center' }}>
                    <Alert severity="info" sx={{ justifyContent: 'center' }}>
                      {applicants.length === 0
                        ? 'No applications received yet for this job order.'
                        : lifecycleFilterEmpty
                          ? 'No applicants match this lifecycle filter. Choose "All stages" or tap another lifecycle chip.'
                        : categoryScoreFilterEmpty
                          ? 'No applicants match these category score filters. Try lowering thresholds, set Avg ≥ to All, or set Category min to Any category.'
                        : isGigJob && selectedShiftId
                        ? selectedDay
                          ? 'No applicants for this shift and day. Try "All days" to see everyone who applied to this shift.'
                          : 'No applicants for this shift. Select "All shifts" to see all applicants.'
                        : 'No applicants.'}
                    </Alert>
                  </TableCell>
                </TableRow>
              ) : displayedApplicants.map((applicant) => {
                const rowId = applicationRowId(applicant, jobOrderId);
                return (
                <TableRow 
                  key={rowId}
                  hover
                  onClick={() => handleViewApplicant(applicant.uid)}
                  sx={{
                    cursor: 'pointer',
                    '&:last-child td, &:last-child th': { border: 0 },
                  }}
                >
                  <TableCell padding="checkbox" sx={{ width: 48 }} onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={selectedApplicationRowIds.has(rowId)}
                      onChange={() => handleSelectOne(rowId)}
                      size="small"
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`Select ${applicant.displayName}`}
                    />
                  </TableCell>
                  <TableCell sx={{ py: 1 }} onClick={(e) => e.stopPropagation()}>
                    <FavoriteButton
                      itemId={applicant.uid}
                      favoriteType="users"
                      isFavorite={isFavorite}
                      toggleFavorite={toggleFavorite}
                      size="small"
                      showTooltip={true}
                      tooltipText={{
                        favorited: 'Remove from favorites',
                        notFavorited: 'Add to favorites'
                      }}
                    />
                  </TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                      <Avatar 
                        src={applicant.avatar} 
                        alt={applicant.displayName}
                        sx={{ width: 40, height: 40 }}
                      >
                        {applicant.firstName?.[0]}{applicant.lastName?.[0]}
                      </Avatar>
                      <Box>
                        <Typography variant="body2" fontWeight={600}>
                          {applicant.displayName}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {applicant.applicationData?.jobTitle || 'N/A'}
                        </Typography>
                      </Box>
                    </Box>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">{applicant.email}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {applicant.phone}
                    </Typography>
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <WorkAuthorizedChip status={getWorkAuthorizedStatus(applicant)} />
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <EVerifyComfortChip status={getEVerifyComfortStatusFromUserData(applicant)} />
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">
                      {applicant.city && applicant.state 
                        ? `${applicant.city}, ${applicant.state}`
                        : applicant.city || applicant.state || '-'}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">
                      {applicant.appliedAt 
                        ? (() => {
                            try {
                              // Handle Firestore Timestamp
                              if (applicant.appliedAt.toDate && typeof applicant.appliedAt.toDate === 'function') {
                                return formatDistanceToNow(applicant.appliedAt.toDate(), { addSuffix: true });
                              }
                              // Handle Date object
                              if (applicant.appliedAt instanceof Date) {
                                return formatDistanceToNow(applicant.appliedAt, { addSuffix: true });
                              }
                              // Handle timestamp number or string
                              const date = new Date(applicant.appliedAt);
                              if (!isNaN(date.getTime())) {
                                return formatDistanceToNow(date, { addSuffix: true });
                              }
                              return '-';
                            } catch (error) {
                              console.error('Error formatting appliedAt:', error, applicant.appliedAt);
                              return '-';
                            }
                          })()
                        : '-'}
                    </Typography>
                  </TableCell>
                  {isGigJob && shifts.length > 0 ? (
                    <TableCell>
                      {(() => {
                        const app = applicant.applicationData || {};
                        const ids: string[] = [];
                        if (app.shiftId) ids.push(app.shiftId);
                        if (Array.isArray(app.shiftIds)) ids.push(...app.shiftIds);
                        if (Array.isArray(app.selectedShifts)) {
                          app.selectedShifts.forEach((s: any) => {
                            const id = typeof s === 'string' ? s : s?.shiftId || s?.id;
                            if (id && !ids.includes(id)) ids.push(id);
                          });
                        }
                        const shiftEntries = ids
                          .map((id, index) => ({ id, label: shifts.find((s) => s.id === id)?.shiftTitle || id }))
                          .filter((e) => e.label);
                        if (shiftEntries.length === 0) return <Typography variant="caption" color="text.secondary">—</Typography>;
                        return (
                          <Stack direction="row" flexWrap="wrap" gap={0.5} sx={{ maxWidth: 180 }}>
                            {shiftEntries.map((e, index) => (
                              <Chip key={`${e.id}-${index}`} label={e.label} size="small" variant="outlined" sx={{ fontSize: '0.7rem' }} />
                            ))}
                          </Stack>
                        );
                      })()}
                    </TableCell>
                  ) : null}
                  <TableCell>
                    <Tooltip title="Profile completeness score based on resume, skills, work history, and engagement">
                      <Chip 
                        label={getScoreLabel(applicant.profileScore)}
                        size="small"
                        color={getScoreColor(applicant.profileScore)}
                        sx={{ minWidth: 50, fontWeight: 600 }}
                      />
                    </Tooltip>
                  </TableCell>
                  <TableCell>
                    {(() => {
                      const jobScore = applicant.jobScoreSummary != null
                        ? (applicant.jobScoreSummary as any).jobScore
                        : undefined;
                      const hiring = applicant.hiringScore;
                      const hasJob = typeof jobScore === 'number' && Number.isFinite(jobScore);
                      const hasHiring = typeof hiring === 'number' && Number.isFinite(hiring);
                      const legacyFit = applicant.fitScore !== null && applicant.fitScore !== undefined;
                      const showPlaceholder = !hasJob && !hasHiring && !legacyFit;
                      const tooltipParts: string[] = [];
                      if (hasJob) tooltipParts.push(`Job fit (this role): ${getScoreLabel(jobScore)}`);
                      if (hasHiring) tooltipParts.push(`Hiring score (overall): ${getScoreLabel(hiring)}`);
                      if (showPlaceholder)
                        tooltipParts.push((applicant.profileScore ?? 0) >= 40 ? 'Fit score will be calculated automatically' : 'Complete profile to 40% to enable fit scoring');
                      const tooltip = tooltipParts.length ? tooltipParts.join(' · ') : 'Fit';
                      return (
                        <Tooltip title={tooltip}>
                          <Stack direction="row" alignItems="center" spacing={0.5} flexWrap="wrap" sx={{ minWidth: 50 }}>
                            {showPlaceholder ? (
                              <Chip label="..." size="small" variant="outlined" sx={{ minWidth: 50, opacity: 0.5 }} />
                            ) : (
                              <>
                                {hasJob && (
                                  <Chip
                                    label={getScoreLabel(jobScore)}
                                    size="small"
                                    color={getScoreColor(jobScore)}
                                    sx={{ minWidth: 44, fontWeight: 600 }}
                                  />
                                )}
                                {hasHiring && (
                                  <Chip
                                    label={getScoreLabel(hiring)}
                                    size="small"
                                    variant={hasJob ? 'outlined' : 'filled'}
                                    color={getScoreColor(hiring)}
                                    sx={{ minWidth: 44, fontWeight: hasJob ? 500 : 600 }}
                                  />
                                )}
                                {!hasJob && !hasHiring && legacyFit && (
                                  <Chip
                                    label={getScoreLabel(applicant.fitScore)}
                                    size="small"
                                    color={getScoreColor(applicant.fitScore)}
                                    sx={{ minWidth: 50, fontWeight: 600 }}
                                  />
                                )}
                              </>
                            )}
                          </Stack>
                        </Tooltip>
                      );
                    })()}
                  </TableCell>
                  {jobOrder?.requirementPackId ? (
                    <>
                      <TableCell>
                        {applicant.jobScoreSummary != null ? (
                          (() => {
                            const s = applicant.jobScoreSummary as any;
                            const isV1 = s.version === 'v1';
                            const stale = s.stale?.isStale;
                            const tooltip = isV1
                              ? (stale ? 'Score may be outdated (profile or pack changed). Use Refresh scores to update. ' : '') +
                                `Requirements: ${s.breakdown?.requirements ?? '—'} · Hiring lift: ${s.breakdown?.hiringLift ?? '—'}`
                              : `Fit: ${s.fitScore ?? '—'} · Hiring: ${s.hiringScoreUsed ?? '—'}`;
                            const missingLabels = isV1
                              ? (s.buckets?.missingRequired ?? []).map((x: any) => x.label)
                              : (s.missingLabels ?? []);
                            return (
                              <Tooltip title={tooltip}>
                                <Stack direction="row" alignItems="center" spacing={0.5} flexWrap="wrap">
                                  {isV1 && stale && (
                                    <Chip label="Stale" size="small" variant="outlined" color="warning" sx={{ fontWeight: 500 }} />
                                  )}
                                  {isV1 && !s.eligible && (
                                    <Chip label="Not Eligible" size="small" color="error" sx={{ fontWeight: 600 }} />
                                  )}
                                  <Chip
                                    label={getScoreLabel(s.jobScore)}
                                    size="small"
                                    color={getScoreColor(s.jobScore)}
                                    sx={{ minWidth: 50, fontWeight: 600 }}
                                  />
                                </Stack>
                              </Tooltip>
                            );
                          })()
                        ) : (
                          <Typography variant="caption" color="text.secondary">—</Typography>
                        )}
                      </TableCell>
                      <TableCell>
                        {(() => {
                          const s = applicant.jobScoreSummary as any;
                          if (!s) return <Typography variant="caption" color="text.secondary">—</Typography>;
                          const isV1 = s.version === 'v1';
                          const labels = isV1 ? (s.buckets?.missingRequired ?? []).map((x: any) => x.label) : (s.missingLabels ?? []);
                          if (labels.length) {
                            return (
                              <Tooltip title={labels.join(', ')}>
                                <Typography variant="caption" noWrap sx={{ maxWidth: 120 }} color="text.secondary">
                                  {labels.slice(0, 2).join(', ')}
                                  {labels.length > 2 ? '…' : ''}
                                </Typography>
                              </Tooltip>
                            );
                          }
                          return <Typography variant="caption" color="success.main">Eligible</Typography>;
                        })()}
                      </TableCell>
                    </>
                  ) : null}
                  <TableCell>
                    {renderInterviewCell(applicant)}
                  </TableCell>
                  <TableCell>
                    {applicant.compliancePercent != null ? (
                      <Tooltip title={applicant.complianceStatus === 'expiring_soon' ? 'Expiring soon' : applicant.complianceStatus === 'non_compliant' ? 'Expired or non-compliant' : applicant.complianceStatus === 'compliant' ? 'Compliant' : 'Incomplete'}>
                        <Chip
                          size="small"
                          label={`${applicant.compliancePercent}%`}
                          color={
                            applicant.complianceStatus === 'compliant' ? 'success' :
                            applicant.complianceStatus === 'expiring_soon' ? 'warning' :
                            applicant.complianceStatus === 'non_compliant' ? 'error' : 'default'
                          }
                          variant="outlined"
                          sx={{ minWidth: 44 }}
                        />
                      </Tooltip>
                    ) : (
                      <Typography variant="caption" color="text.secondary">—</Typography>
                    )}
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <HiringLifecycleBadgeGroup
                      lifecycle={applicant.hiringLifecycle}
                      legacyStatusLabel={(
                        normalizeApplicationStatus(applicant.applicationStatus || 'submitted') ??
                        applicant.applicationStatus ??
                        'submitted'
                      ).replace(/_/g, ' ')}
                      aiAutomationSummary={formatAiAutomationRecruiterTooltip(applicant.applicationData)}
                      compact
                    />
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    {(() => {
                      const placementStatus = assignmentStatusByUserId.get(applicant.uid);
                      const isConfirmed = placementStatus && ['confirmed', 'active'].includes(placementStatus);
                      const isAssigned = placementStatus && ['proposed', 'accepted'].includes(placementStatus);
                      const isDeclined = placementStatus === 'declined';
                      const isCancelled = placementStatus === 'cancelled' || placementStatus === 'canceled';
                      const appStatus = (applicant.applicationStatus || 'submitted').toLowerCase();
                      // When assignment is cancelled, show submitted if application was reverted (so status change is visible). Use same label/case as backend: 'submitted'.
                      const displayLabel = isConfirmed ? 'Confirmed' : isAssigned ? 'Accepted' : isDeclined ? 'Declined' : (isCancelled && appStatus === 'submitted') ? 'submitted' : isCancelled ? 'Cancelled' : (applicant.applicationStatus || 'submitted');
                      // Submitted (any source) uses default color; only cancelled when not reverted to submitted uses error
                      const displayColor = isConfirmed ? 'success' : isAssigned ? undefined : isDeclined || (isCancelled && appStatus !== 'submitted') ? 'error' :
                        applicant.applicationStatus === 'accepted' ? 'success' :
                        applicant.applicationStatus === 'rejected' ? 'error' :
                        applicant.applicationStatus === 'waitlisted' ? 'warning' : 'default';
                      return (
                        <Tooltip title={isAssigned || isConfirmed ? `Application: ${applicant.applicationStatus || 'submitted'}` : isDeclined ? 'Worker declined assignment' : isCancelled ? 'Assignment cancelled' : undefined}>
                          <Chip
                            label={displayLabel}
                            size="small"
                            color={displayColor}
                            icon={isAssigned && !isConfirmed ? <LockedIcon fontSize="small" /> : undefined}
                            onClick={(e) => handleOpenStatusMenu(e, rowId)}
                            sx={{
                              cursor: 'pointer',
                              ...(isAssigned && !isConfirmed && {
                                bgcolor: '#e8f5e9',
                                color: 'success.main',
                                '& .MuiChip-icon': { color: 'success.main' },
                              }),
                            }}
                          />
                        </Tooltip>
                      );
                    })()}
                    <Menu
                      anchorEl={statusMenuAnchor[rowId]}
                      open={Boolean(statusMenuAnchor[rowId])}
                      onClose={() => handleCloseStatusMenu(rowId)}
                    >
                      <MenuItem onClick={() => handleChangeStatus(applicant, 'submitted')}>
                        Submitted
                      </MenuItem>
                      <MenuItem onClick={() => handleChangeStatus(applicant, 'waitlisted')}>
                        Waitlisted
                      </MenuItem>
                      <MenuItem onClick={() => handleChangeStatus(applicant, 'rejected')}>
                        Rejected
                      </MenuItem>
                    </Menu>
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Chip 
                      label={applicant.applicationData?.candidate ? '⭐ Candidate' : 'Applicant'}
                      size="small"
                      color={applicant.applicationData?.candidate ? 'primary' : 'default'}
                      onClick={(e) => handleOpenLevelMenu(e, rowId)}
                      sx={{ 
                        cursor: 'pointer',
                        fontWeight: applicant.applicationData?.candidateStatus ? 600 : 400
                      }}
                    />
                    <Menu
                      anchorEl={levelMenuAnchor[rowId]}
                      open={Boolean(levelMenuAnchor[rowId])}
                      onClose={() => handleCloseLevelMenu(rowId)}
                    >
                      <MenuItem onClick={() => handleChangeLevel(applicant, 'applicant')}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <PersonIcon fontSize="small" />
                          Applicant
                        </Box>
                      </MenuItem>
                      <MenuItem onClick={() => handleChangeLevel(applicant, 'candidate')}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <CheckCircleIcon fontSize="small" />
                          ⭐ Candidate
                        </Box>
                      </MenuItem>
                    </Menu>
                  </TableCell>
                  <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                    <IconButton
                      size="small"
                      onClick={(e) => handleOpenActionMenu(e, rowId)}
                    >
                      <MoreVertIcon />
                    </IconButton>
                    <Menu
                      anchorEl={actionMenuAnchor[rowId]}
                      open={Boolean(actionMenuAnchor[rowId])}
                      onClose={() => handleCloseActionMenu(rowId)}
                    >
                      <MenuItem onClick={() => handleOpenSwitchJobDialog(applicant)}>
                        <WorkIcon fontSize="small" sx={{ mr: 1 }} />
                        Switch to Different Job
                      </MenuItem>
                      <MenuItem 
                        onClick={() => handleRemoveApplication(applicant)}
                        sx={{ color: 'error.main' }}
                      >
                        <DeleteIcon fontSize="small" sx={{ mr: 1 }} />
                        Remove Application
                      </MenuItem>
                    </Menu>
                  </TableCell>
                </TableRow>
              );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      </CardContent>
    </Card>

    {/* Switch Job Dialog */}
    <Dialog 
      open={switchJobDialogOpen} 
      onClose={handleCloseSwitchJobDialog}
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle>Switch to Different Job Order</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 2 }}>
          <Alert severity="info">
            Switching {selectedApplicant?.displayName}'s application to a different job order.
          </Alert>
          <FormControl fullWidth>
            <InputLabel>Target Job Order</InputLabel>
            <Select
              value={targetJobOrderId}
              onChange={(e) => setTargetJobOrderId(e.target.value)}
              label="Target Job Order"
            >
              {availableJobOrders.map((jo: any) => (
                <MenuItem key={jo.id} value={jo.id}>
                  {jo.jobOrderName || jo.jobTitle} - {jo.companyName} ({jo.status})
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleCloseSwitchJobDialog}>Cancel</Button>
        <Button 
          onClick={handleSwitchJob} 
          variant="contained"
          disabled={!targetJobOrderId}
        >
          Switch Job
        </Button>
      </DialogActions>
    </Dialog>

    {/* Add Applicant Dialog */}
    <Dialog 
      open={addApplicantDialogOpen} 
      onClose={handleCloseAddApplicantDialog}
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle>Add Applicant to Job Order</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 2 }}>
          <Alert severity="info">
            {jobOrder?.restrictedGroups && jobOrder.restrictedGroups.length > 0
              ? 'This job order is restricted to specific user groups. Only eligible users are shown.'
              : 'Select an applicant or candidate to add to this job order.'}
          </Alert>
          {loadingUsers ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
              <CircularProgress />
            </Box>
          ) : (
            <Autocomplete
              options={availableUsers}
              value={availableUsers.find((u: any) => u.uid === selectedUserId) || null}
              onChange={(_, newValue: any) => setSelectedUserId(newValue?.uid || '')}
              getOptionLabel={(u: any) =>
                [u.displayName || '', u.email || ''].filter(Boolean).join(' · ') ||
                (u.city && u.state ? `(${u.city}, ${u.state})` : '') ||
                'Unknown'
              }
              filterOptions={(options, { inputValue }) => {
                const search = inputValue.trim().toLowerCase();
                if (!search) return options;
                return options.filter(
                  (u: any) =>
                    (u.displayName || '').toLowerCase().includes(search) ||
                    (u.email || '').toLowerCase().includes(search) ||
                    (u.city || '').toLowerCase().includes(search) ||
                    (u.state || '').toLowerCase().includes(search)
                );
              }}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Search by name or email"
                  placeholder="Type to search applicants..."
                />
              )}
              renderOption={(props, u: any) => (
                <li {...props} key={u.uid}>
                  {[u.displayName, u.email].filter(Boolean).join(' · ') || '—'}{' '}
                  {u.city && u.state ? `(${u.city}, ${u.state})` : ''}
                  {u.securityLevel === 3 ? ' ⭐ Candidate' : ''}
                </li>
              )}
              noOptionsText="No eligible users found"
              fullWidth
            />
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleCloseAddApplicantDialog}>Cancel</Button>
        <Button 
          onClick={handleAddApplicant} 
          variant="contained"
          disabled={!selectedUserId || loadingUsers}
        >
          Add Applicant
        </Button>
      </DialogActions>
    </Dialog>

    <MessageDrawer
      open={bulkDrawerOpen}
      onClose={() => setBulkDrawerOpen(false)}
      recipients={bulkRecipientsAndIds.recipients}
      tenantId={tenantId}
      bulkSystemMode={true}
      recipientUserIds={bulkRecipientsAndIds.recipientUserIds}
      defaultChannels={[bulkDrawerChannel]}
      onSend={() => {
        setSelectedApplicationRowIds(new Set());
        setBulkDrawerOpen(false);
      }}
    />
    </>
  );
};

// Job Order Defaults Tab - mirrors Company Defaults but saves to job order
const JobOrderDefaultsTab: React.FC<{
  jobOrder: JobOrder | null;
  tenantId: string;
  onSaved?: () => void;
}> = ({ jobOrder, tenantId, onSaved }) => {
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** E-Verify comes from the Hiring Entity (Settings > Entities); read-only here. */
  const { entity: jobOrderEntity, loading: entityLoading } = useEntity(tenantId, jobOrder?.hiringEntityId ?? null);
  
  // Get values from job order's deal.stageData.scoping structure
  const scoping = jobOrder?.deal?.stageData?.scoping || {};
  const compliance = scoping.compliance || {};
  const customerRules = scoping.customerRules || {};
  
  const initialRules = {
    timeclockSystem: scoping.timeclockSystem || '',
    attendancePolicy: customerRules.attendance || '',
    noShowPolicy: customerRules.noShows || '',
    overtimePolicy: customerRules.overtime || '',
    callOffPolicy: customerRules.callOffs || '',
    injuryHandlingPolicy: customerRules.injuryHandling || '',
    disciplinePolicy: scoping.disciplinePolicy || '',
  };
  const initialBilling = {
    poRequired: !!scoping.poRequired,
    paymentTerms: scoping.paymentTerms || '',
    invoiceDeliveryMethod: scoping.invoiceDeliveryMethod || '',
    invoiceFrequency: scoping.invoiceFrequency || '',
  };
  const [rules, setRules] = useState(initialRules);
  const [billing, setBilling] = useState(initialBilling);
  
  // Update state when jobOrder changes (E-Verify is read from entity, not local state)
  useEffect(() => {
    const scoping = jobOrder?.deal?.stageData?.scoping || {};
    const compliance = scoping.compliance || {};
    const customerRules = scoping.customerRules || {};
    
    setRules({
      timeclockSystem: scoping.timeclockSystem || '',
      attendancePolicy: customerRules.attendance || '',
      noShowPolicy: customerRules.noShows || '',
      overtimePolicy: customerRules.overtime || '',
      callOffPolicy: customerRules.callOffs || '',
      injuryHandlingPolicy: customerRules.injuryHandling || '',
      disciplinePolicy: scoping.disciplinePolicy || '',
    });
    setBilling({
      poRequired: !!scoping.poRequired,
      paymentTerms: scoping.paymentTerms || '',
      invoiceDeliveryMethod: scoping.invoiceDeliveryMethod || '',
      invoiceFrequency: scoping.invoiceFrequency || '',
    });
  }, [jobOrder]);
  
  const handleSave = async () => {
    if (!tenantId || !jobOrder?.id) return;
    try {
      setSaving(true);
      setError(null);
      
      // Get current job order to preserve existing structure
      const jobOrderRef = doc(db, 'tenants', tenantId, 'job_orders', jobOrder.id);
      const jobOrderSnap = await getDoc(jobOrderRef);
      const currentData = jobOrderSnap.data();
      
      // Update the deal.stageData.scoping structure
      const updatedStageData = {
        ...(currentData?.deal?.stageData || {}),
        scoping: {
          ...(currentData?.deal?.stageData?.scoping || {}),
          timeclockSystem: rules.timeclockSystem || undefined,
          disciplinePolicy: rules.disciplinePolicy || undefined,
          poRequired: billing.poRequired || undefined,
          paymentTerms: billing.paymentTerms || undefined,
          invoiceDeliveryMethod: billing.invoiceDeliveryMethod || undefined,
          invoiceFrequency: billing.invoiceFrequency || undefined,
          customerRules: {
            attendance: rules.attendancePolicy || undefined,
            noShows: rules.noShowPolicy || undefined,
            overtime: rules.overtimePolicy || undefined,
            callOffs: rules.callOffPolicy || undefined,
            injuryHandling: rules.injuryHandlingPolicy || undefined,
          },
          compliance: {
            ...(currentData?.deal?.stageData?.scoping?.compliance || {}),
            // E-Verify comes from Hiring Entity (source of truth); persist entity value when we have it
            eVerify: jobOrderEntity ? jobOrderEntity.everifyRequired : (currentData?.deal?.stageData?.scoping?.compliance?.eVerify ?? false),
          },
        },
      };
      
      await updateDoc(jobOrderRef, {
        'deal.stageData': updatedStageData,
        updatedAt: serverTimestamp(),
      });
      
      setSuccess('Defaults saved successfully');
      onSaved?.();
    } catch (e: any) {
      console.error('Failed to save Job Order Defaults:', e);
      setError('Failed to save defaults');
    } finally {
      setSaving(false);
    }
  };
  
  return (
    <Box>
      {success && (
        <Snackbar open={!!success} autoHideDuration={4000} onClose={() => setSuccess(null)}>
          <Alert severity="success" onClose={() => setSuccess(null)}>{success}</Alert>
        </Snackbar>
      )}
      {error && (
        <Snackbar open={!!error} autoHideDuration={4000} onClose={() => setError(null)}>
          <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>
        </Snackbar>
      )}
      
      <Grid container spacing={3}>
        <Grid item xs={12} md={7}>
          <Card>
            <CardHeader title="Customer Rules & Policies" />
            <CardContent>
              <Grid container spacing={2}>
                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    label="Timeclock System"
                    value={rules.timeclockSystem}
                    onChange={(e) => setRules({ ...rules, timeclockSystem: e.target.value })}
                  />
                </Grid>
                <Grid item xs={12}>
                  <TextField
                    fullWidth
                    label="Attendance Policy"
                    value={rules.attendancePolicy}
                    onChange={(e) => setRules({ ...rules, attendancePolicy: e.target.value })}
                    multiline
                    rows={2}
                  />
                </Grid>
                <Grid item xs={12}>
                  <TextField
                    fullWidth
                    label="No-Show Policy"
                    value={rules.noShowPolicy}
                    onChange={(e) => setRules({ ...rules, noShowPolicy: e.target.value })}
                    multiline
                    rows={2}
                  />
                </Grid>
                <Grid item xs={12}>
                  <TextField
                    fullWidth
                    label="Overtime Policy"
                    value={rules.overtimePolicy}
                    onChange={(e) => setRules({ ...rules, overtimePolicy: e.target.value })}
                    multiline
                    rows={2}
                  />
                </Grid>
                <Grid item xs={12}>
                  <TextField
                    fullWidth
                    label="Call-Off Policy"
                    value={rules.callOffPolicy}
                    onChange={(e) => setRules({ ...rules, callOffPolicy: e.target.value })}
                    multiline
                    rows={2}
                  />
                </Grid>
                <Grid item xs={12}>
                  <TextField
                    fullWidth
                    label="Injury Handling Policy"
                    value={rules.injuryHandlingPolicy}
                    onChange={(e) => setRules({ ...rules, injuryHandlingPolicy: e.target.value })}
                    multiline
                    rows={2}
                  />
                </Grid>
                <Grid item xs={12}>
                  <TextField
                    fullWidth
                    label="Discipline Policy"
                    value={rules.disciplinePolicy}
                    onChange={(e) => setRules({ ...rules, disciplinePolicy: e.target.value })}
                    multiline
                    rows={2}
                  />
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        </Grid>
        
        <Grid item xs={12} md={5}>
          {/* Labor Pool Selector */}
          <Card sx={{ mb: 3 }}>
            <LaborPoolSelector
              jobOrderId={jobOrder?.id || ''}
              tenantId={tenantId}
              currentLaborPoolGroups={(jobOrder as any)?.laborPoolGroups || []}
              onUpdate={() => {
                if (onSaved) onSaved();
              }}
            />
          </Card>
          
          <Card sx={{ mb: 3 }}>
            <CardHeader title="E-Verify" />
            <CardContent>
              <Grid container spacing={2}>
                <Grid item xs={12}>
                  {entityLoading ? (
                    <Typography variant="body2" color="text.secondary">Loading entity…</Typography>
                  ) : jobOrderEntity ? (
                    <FormControlLabel
                      control={<Checkbox checked={jobOrderEntity.everifyRequired} disabled />}
                      label={
                        <Box>
                          <Typography variant="body2">E-Verify Required</Typography>
                          <Typography variant="caption" color="text.secondary" display="block">
                            Set by Hiring Entity (Settings → Entities). Cannot be changed on the job order.
                          </Typography>
                        </Box>
                      }
                    />
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      E-Verify is set by the Hiring Entity. Create job orders from an account that has a Hiring Entity selected to set this.
                    </Typography>
                  )}
                </Grid>
              </Grid>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader title="Billing & Invoicing" />
            <CardContent>
              <Grid container spacing={2}>
                <Grid item xs={12}>
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={billing.poRequired}
                        onChange={(e) => setBilling({ ...billing, poRequired: e.target.checked })}
                      />
                    }
                    label="PO Required"
                  />
                </Grid>
                <Grid item xs={12}>
                  <TextField
                    fullWidth
                    label="Payment Terms"
                    value={billing.paymentTerms}
                    onChange={(e) => setBilling({ ...billing, paymentTerms: e.target.value })}
                    placeholder="e.g., Net 30"
                  />
                </Grid>
                <Grid item xs={12}>
                  <FormControl fullWidth>
                    <InputLabel>Invoice Delivery Method</InputLabel>
                    <Select
                      value={billing.invoiceDeliveryMethod}
                      label="Invoice Delivery Method"
                      onChange={(e) => setBilling({ ...billing, invoiceDeliveryMethod: e.target.value as string })}
                    >
                      <MenuItem value="">—</MenuItem>
                      <MenuItem value="email">Email</MenuItem>
                      <MenuItem value="portal">Portal</MenuItem>
                      <MenuItem value="mail">Mail</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12}>
                  <FormControl fullWidth>
                    <InputLabel>Invoice Frequency</InputLabel>
                    <Select
                      value={billing.invoiceFrequency}
                      label="Invoice Frequency"
                      onChange={(e) => setBilling({ ...billing, invoiceFrequency: e.target.value as string })}
                    >
                      <MenuItem value="">—</MenuItem>
                      <MenuItem value="weekly">Weekly</MenuItem>
                      <MenuItem value="biweekly">Bi-weekly</MenuItem>
                      <MenuItem value="monthly">Monthly</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        </Grid>
        
        <Grid item xs={12}>
          <Box sx={{ display: 'flex', gap: 2, mt: 1 }}>
            <Button variant="contained" startIcon={<SaveIcon />} onClick={handleSave} disabled={saving}>
              {saving ? <CircularProgress size={20} /> : 'Save Defaults'}
            </Button>
          </Box>
        </Grid>
      </Grid>
    </Box>
  );
};

type GigPosition = { jobTitle: string; payRate: string; workersNeeded?: number };

// Job Order Jobs Board Tab - uses JobPostForm with job order data pre-populated; Gig jobs get one sub-tab per position
const JobOrderJobsBoardTab: React.FC<{
  jobOrder: JobOrder;
  tenantId: string;
  userId: string;
  onPostSaved?: () => void;
}> = ({ jobOrder, tenantId, userId, onPostSaved }) => {
  const [loading, setLoading] = useState(false);
  const [posts, setPosts] = useState<JobsBoardPost[]>([]);
  const [jobsBoardSubTab, setJobsBoardSubTab] = useState(0);
  const [copyLinkSnackbarOpen, setCopyLinkSnackbarOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const jobsBoardService = JobsBoardService.getInstance();
  /** Account → Pricing positions (client JD per title) for seeding Jobs Board posts. */
  const [accountPricingPositions, setAccountPricingPositions] = useState<AccountPositionPricing[]>([]);

  /** E-Verify comes from Hiring Entity (source of truth). */
  const { entity: jobOrderEntity } = useEntity(tenantId, jobOrder?.hiringEntityId ?? null);

  const gigPositions = (jobOrder as any).gigPositions as GigPosition[] | undefined;
  const isGigWithPositions = jobOrder?.jobType === 'gig' && gigPositions && gigPositions.length > 0;

  // Format date for input
  const formatDateForInput = (dateValue: any): string => {
    if (!dateValue) return '';
    try {
      if (typeof dateValue === 'string') {
        if (dateValue.match(/^\d{4}-\d{2}-\d{2}$/)) {
          return dateValue;
        }
        const date = new Date(dateValue);
        return isNaN(date.getTime()) ? '' : date.toISOString().split('T')[0];
      } else if (dateValue && typeof dateValue.toDate === 'function') {
        return dateValue.toDate().toISOString().split('T')[0];
      } else if (dateValue && typeof dateValue.toISOString === 'function') {
        return dateValue.toISOString().split('T')[0];
      } else {
        const date = new Date(dateValue);
        return isNaN(date.getTime()) ? '' : date.toISOString().split('T')[0];
      }
    } catch (error) {
      return '';
    }
  };

  // Load connected posts; for Gig with positions and no posts, create one draft post per position
  const loadPosts = useCallback(async () => {
    if (!jobOrder?.id) return;
    try {
      let list = await jobsBoardService.getPostsByJobOrder(tenantId, jobOrder.id);
      if (isGigWithPositions && list.length === 0 && userId) {
        await jobsBoardService.createPostsForGigJobOrderPositions(tenantId, jobOrder.id, userId);
        list = await jobsBoardService.getPostsByJobOrder(tenantId, jobOrder.id);
      }
      setPosts(list);
    } catch (err) {
      console.error('Error loading job posts:', err);
    }
  }, [jobOrder?.id, tenantId, userId, isGigWithPositions]);

  useEffect(() => {
    loadPosts();
  }, [loadPosts]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await fetchResolvedAccountPricingPositions(tenantId, {
          recruiterAccountId: jobOrder?.recruiterAccountId,
          companyId: jobOrder?.companyId,
        });
        if (!cancelled) setAccountPricingPositions(rows);
      } catch {
        if (!cancelled) setAccountPricingPositions([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, jobOrder?.recruiterAccountId, jobOrder?.companyId]);

  const accountPricingByTitle = useMemo(
    () => buildPricingByJobTitle(accountPricingPositions),
    [accountPricingPositions],
  );

  const accountPricingSeedKey = useMemo(
    () =>
      accountPricingPositions
        .map((p) => `${String(p.jobTitle ?? '').trim()}\t${String(p.jobDescriptionFromClient ?? '').length}`)
        .join('|'),
    [accountPricingPositions],
  );

  const existingPostSingle = !isGigWithPositions ? (posts[0] ?? null) : null;

  // Memoize initialData to prevent JobPostForm's useEffect from overwriting user input on every parent re-render.
  // Without this, getInitialData() returns a new object each render, triggering JobPostForm to reset the form and wipe typed data.
  const initialDataByPositionKey = useMemo(() => {
    return (gigPositions ?? [])
      .map((p) => {
        const post = posts.find((x) => x.positionJobTitle === p.jobTitle);
        return `${p.jobTitle}:${post?.id ?? 'new'}`;
      })
      .join('|');
  }, [gigPositions, posts]);

  const initialDataMap = useMemo(() => {
    const map: Record<string, any> = {};
    (gigPositions ?? []).forEach((position) => {
      const existingPost = posts.find((p) => p.positionJobTitle === position.jobTitle) ?? null;
      map[position.jobTitle] = getInitialDataStatic(existingPost, position);
    });
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initialDataByPositionKey and jobOrderEntity drive recompute
  }, [initialDataByPositionKey, jobOrder?.id, jobOrderEntity?.everifyRequired, accountPricingSeedKey]);

  const initialDataSingle = useMemo(
    () => getInitialDataStatic(existingPostSingle, null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recompute when post loads, job order or entity changes
    [existingPostSingle?.id ?? 'new', jobOrder?.id, jobOrderEntity?.everifyRequired, accountPricingSeedKey]
  );

  // Convert job order data to JobPostForm initialData format (optionally for a specific Gig position)
  function getInitialDataStatic(existingPostForForm: JobsBoardPost | null | undefined, position: GigPosition | null | undefined): any {
    if (existingPostForForm) {
      const savedDesc =
        typeof existingPostForForm.jobDescription === 'string' ? existingPostForForm.jobDescription.trim() : '';
      const titleKey = String(
        existingPostForForm.positionJobTitle || existingPostForForm.jobTitle || '',
      ).trim();
      const accountRow = titleKey ? accountPricingByTitle.get(titleKey) : undefined;
      const accountJd = accountRow?.jobDescriptionFromClient?.trim();
      return {
        ...existingPostForForm,
        startDate: formatDateForInput(existingPostForForm.startDate),
        endDate: formatDateForInput(existingPostForForm.endDate),
        expDate: formatDateForInput(existingPostForForm.expDate),
        payRate: existingPostForForm.payRate?.toString() || '',
        showWorkersNeeded: existingPostForForm.showWorkersNeeded !== undefined ? existingPostForForm.showWorkersNeeded : false,
        skills: Array.isArray(existingPostForForm.skills) ? existingPostForForm.skills : (existingPostForForm.skills ? [existingPostForForm.skills] : []),
        uniformRequirements: Array.isArray(existingPostForForm.uniformRequirements) ? existingPostForForm.uniformRequirements : (existingPostForForm.uniformRequirements ? [existingPostForForm.uniformRequirements] : []),
        jobDescription: savedDesc || accountJd || '',
      };
    }

    const scoping = jobOrder?.deal?.stageData?.scoping || {};
    const compliance = scoping.compliance || {};
    const isGigJob = jobOrder.jobType === 'gig';
    const firstPosition = gigPositions && gigPositions.length > 0 ? gigPositions[0] : null;
    const positionForPrefill = position ?? firstPosition;

    // Combine requiredLicenses and requiredCertifications
    // JobOrderForm (Overview) saves to deal.stageData.scoping.compliance; also check scoping and top-level
    const topLevelLicenses = jobOrder.requiredLicenses || [];
    const topLevelCerts = jobOrder.requiredCertifications || [];
    const complianceLicensesCerts = Array.isArray(compliance.licensesCerts) ? compliance.licensesCerts : [];
    const scopingLicensesCerts = scoping.licensesCerts || [];
    const allLicensesCerts = Array.from(new Set([
      ...topLevelLicenses,
      ...topLevelCerts,
      ...complianceLicensesCerts,
      ...scopingLicensesCerts,
    ]));

    // Skills: Overview tab saves to scoping.compliance.skills; merge with scoping and top-level
    const skillsFromCompliance = Array.isArray(compliance.skills) ? compliance.skills : [];
    const skillsFromScoping = Array.isArray(scoping.skills) ? scoping.skills : [];
    const skillsFromTopLevel = Array.isArray(jobOrder.skillsRequired) ? jobOrder.skillsRequired : [];
    const allSkills = Array.from(new Set([...skillsFromCompliance, ...skillsFromScoping, ...skillsFromTopLevel]));

    // Uniform requirements are stored in deal.stageData.scoping.uniformRequirements
    // Prefer scoping, but merge and deduplicate
    const uniformFromScoping = Array.isArray(scoping.uniformRequirements) ? scoping.uniformRequirements : [];
    const uniformFromTopLevel = typeof jobOrder.uniformRequirements === 'string' 
      ? [jobOrder.uniformRequirements] 
      : (Array.isArray(jobOrder.uniformRequirements) ? jobOrder.uniformRequirements : []);
    const allUniformRequirements = Array.from(new Set([...uniformFromScoping, ...uniformFromTopLevel])); // Remove duplicates

    return {
      jobOrderId: jobOrder.id,
      postTitle: jobOrder.jobOrderName || '',
      jobType: jobOrder.jobType || 'career',
      jobTitle: isGigJob && positionForPrefill ? positionForPrefill.jobTitle : jobOrder.jobTitle || '',
      jobDescription: (() => {
        const titleKey = String(positionForPrefill?.jobTitle || jobOrder.jobTitle || '').trim();
        const row = titleKey ? accountPricingByTitle.get(titleKey) : undefined;
        const fromAccount = row?.jobDescriptionFromClient?.trim();
        if (fromAccount) return fromAccount;
        return '';
      })(),
      companyId: jobOrder.companyId || '',
      companyName: jobOrder.companyName || '',
      worksiteId: jobOrder.worksiteId || '',
      worksiteName: jobOrder.worksiteName || '',
      worksiteAddress: jobOrder.worksiteAddress || {
        street: '',
        city: '',
        state: '',
        zipCode: '',
      },
      startDate: formatDateForInput(jobOrder.startDate),
      endDate: formatDateForInput(jobOrder.endDate),
      payRate: isGigJob && positionForPrefill && positionForPrefill.payRate
        ? positionForPrefill.payRate
        : jobOrder.payRate?.toString() || '',
      ...(positionForPrefill && { positionJobTitle: positionForPrefill.jobTitle }),
      workersNeeded: jobOrder.workersNeeded || 1,
      eVerifyRequired: jobOrderEntity ? jobOrderEntity.everifyRequired : (compliance.eVerify === true || (jobOrder as any).eVerifyRequired || false),
      screeningPackageId: String((jobOrder as any).screeningPackageId ?? '').trim(),
      screeningPackageName: String((jobOrder as any).screeningPackageName ?? '').trim(),
      // Background check packages from scoping (preferred) or top-level, deduplicated
      backgroundCheckPackages: (() => {
        const scopingBg = Array.isArray(compliance.backgroundCheckPackages) ? compliance.backgroundCheckPackages : [];
        const topLevelBg = Array.isArray((jobOrder as any).backgroundCheckPackages) ? (jobOrder as any).backgroundCheckPackages : [];
        // Prefer scoping, but merge and deduplicate
        const combined = [...scopingBg, ...topLevelBg];
        return Array.from(new Set(combined)); // Remove duplicates
      })(),
      // Drug screening panels from scoping (preferred) or top-level, deduplicated
      drugScreeningPanels: (() => {
        const scopingDrug = Array.isArray(compliance.drugScreeningPanels) ? compliance.drugScreeningPanels : [];
        const topLevelDrug = Array.isArray((jobOrder as any).drugScreeningPanels) ? (jobOrder as any).drugScreeningPanels : [];
        // Prefer scoping, but merge and deduplicate
        const combined = [...scopingDrug, ...topLevelDrug];
        return Array.from(new Set(combined)); // Remove duplicates
      })(),
      // Additional screenings from scoping (preferred) or top-level, deduplicated
      additionalScreenings: (() => {
        const scopingAdditional = Array.isArray(compliance.additionalScreenings) ? compliance.additionalScreenings : [];
        const topLevelAdditional = Array.isArray((jobOrder as any).additionalScreenings) ? (jobOrder as any).additionalScreenings : [];
        // Prefer scoping, but merge and deduplicate
        const combined = [...scopingAdditional, ...topLevelAdditional];
        return Array.from(new Set(combined)); // Remove duplicates
      })(),
      licensesCerts: allLicensesCerts,
      showLicensesCerts: allLicensesCerts.length > 0,
      skills: allSkills,
      showSkills: allSkills.length > 0,
      // Languages: Overview saves to scoping.compliance.languages; merge with scoping and top-level
      languages: (() => {
        const complianceLanguages = Array.isArray(compliance.languages) ? compliance.languages : [];
        const scopingLanguages = Array.isArray(scoping.languages) ? scoping.languages : [];
        const topLevelLanguages = Array.isArray(jobOrder.languagesRequired) ? jobOrder.languagesRequired : [];
        return Array.from(new Set([...complianceLanguages, ...scopingLanguages, ...topLevelLanguages]));
      })(),
      showLanguages: (() => {
        const complianceLanguages = Array.isArray(compliance.languages) ? compliance.languages : [];
        const scopingLanguages = Array.isArray(scoping.languages) ? scoping.languages : [];
        const topLevelLanguages = Array.isArray(jobOrder.languagesRequired) ? jobOrder.languagesRequired : [];
        return complianceLanguages.length > 0 || scopingLanguages.length > 0 || topLevelLanguages.length > 0;
      })(),
      // Experience: Overview saves to compliance.experience; also scoping and top-level
      experienceLevels: (() => {
        const expValue = compliance.experience || scoping.experience || jobOrder.experienceRequired;
        if (!expValue) return [];
        const expOption = experienceOptions.find(opt => opt.value === expValue);
        return expOption ? [expOption.label] : [expValue];
      })(),
      showExperience: !!(compliance.experience || scoping.experience || jobOrder.experienceRequired),
      // Education: Overview saves to compliance.education; also top-level jobOrder.educationRequired
      educationLevels: (() => {
        const eduValue = compliance.education || jobOrder.educationRequired;
        if (!eduValue) return [];
        const eduOption = educationOptions.find(opt => opt.value === eduValue);
        return eduOption ? [eduOption.label] : [eduValue];
      })(),
      showEducation: !!(compliance.education || jobOrder.educationRequired),
      // Physical requirements: Overview saves to compliance.physicalRequirements; merge with scoping and top-level
      physicalRequirements: (() => {
        const compliancePhysical = Array.isArray(compliance.physicalRequirements) ? compliance.physicalRequirements : [];
        const scopingPhysical = Array.isArray(scoping.physicalRequirements) ? scoping.physicalRequirements : [];
        const topLevelPhysical = jobOrder.physicalRequirements
          ? (Array.isArray(jobOrder.physicalRequirements) ? jobOrder.physicalRequirements : [jobOrder.physicalRequirements])
          : [];
        return Array.from(new Set([...compliancePhysical, ...scopingPhysical, ...topLevelPhysical]));
      })(),
      showPhysicalRequirements: (() => {
        const compliancePhysical = Array.isArray(compliance.physicalRequirements) ? compliance.physicalRequirements : [];
        const scopingPhysical = Array.isArray(scoping.physicalRequirements) ? scoping.physicalRequirements : [];
        const topLevelPhysical = jobOrder.physicalRequirements
          ? (Array.isArray(jobOrder.physicalRequirements) ? jobOrder.physicalRequirements : [jobOrder.physicalRequirements])
          : [];
        return compliancePhysical.length > 0 || scopingPhysical.length > 0 || topLevelPhysical.length > 0;
      })(),
      // Uniform requirements from scoping (preferred) or top-level
      uniformRequirements: allUniformRequirements,
      showUniformRequirements: allUniformRequirements.length > 0,
      // Custom uniform requirements from scoping or top-level
      customUniformRequirements: scoping.customUniformRequirements || (jobOrder as any).customUniformRequirements || '',
      showCustomUniformRequirements: !!(scoping.customUniformRequirements || (jobOrder as any).customUniformRequirements),
      // PPE requirements: Overview saves to scoping.compliance.ppe; merge with scoping and top-level
      requiredPpe: (() => {
        const compliancePpe = Array.isArray(compliance.ppe) ? compliance.ppe : [];
        const scopingPpe = Array.isArray(scoping.ppe) ? scoping.ppe : [];
        const topLevelPpe = jobOrder.ppeRequirements
          ? (Array.isArray(jobOrder.ppeRequirements) ? jobOrder.ppeRequirements : [jobOrder.ppeRequirements])
          : [];
        return Array.from(new Set([...compliancePpe, ...scopingPpe, ...topLevelPpe]));
      })(),
      showRequiredPpe: (() => {
        const compliancePpe = Array.isArray(compliance.ppe) ? compliance.ppe : [];
        const scopingPpe = Array.isArray(scoping.ppe) ? scoping.ppe : [];
        const topLevelPpe = jobOrder.ppeRequirements
          ? (Array.isArray(jobOrder.ppeRequirements) ? jobOrder.ppeRequirements : [jobOrder.ppeRequirements])
          : [];
        return compliancePpe.length > 0 || scopingPpe.length > 0 || topLevelPpe.length > 0;
      })(),
      ppeProvidedBy: compliance.ppeProvidedBy || (jobOrder as any).ppeProvidedBy || 'company',
      // Map shiftType from job order to shift array for job post
      shift: (jobOrder as any).shiftType ? (Array.isArray((jobOrder as any).shiftType) ? (jobOrder as any).shiftType : [(jobOrder as any).shiftType]) : [],
      showShift: !!(jobOrder as any).shiftType,
      // Copy display toggles from job order so job post shows same fields
      showPayRate: (jobOrder as any).showPayRate !== undefined ? (jobOrder as any).showPayRate : true,
      showStart: (jobOrder as any).showStartDate ?? (jobOrder as any).showStart ?? false,
      showEnd: (jobOrder as any).showEnd ?? false,
      showWorkersNeeded: (jobOrder as any).showWorkersNeeded !== undefined ? (jobOrder as any).showWorkersNeeded : false,
      expDate: formatDateForInput((jobOrder as any).expDate) || '',
      // Show toggles: use compliance (Overview) and top-level so Jobs Board post defaults match what was set on the job order
      showBackgroundChecks: (Array.isArray(compliance.backgroundCheckPackages) ? compliance.backgroundCheckPackages.length : 0) > 0 || ((jobOrder as any).backgroundCheckPackages || []).length > 0,
      showDrugScreening: (Array.isArray(compliance.drugScreeningPanels) ? compliance.drugScreeningPanels.length : 0) > 0 || ((jobOrder as any).drugScreeningPanels || []).length > 0,
      showAdditionalScreenings: (Array.isArray(compliance.additionalScreenings) ? compliance.additionalScreenings.length : 0) > 0 || ((jobOrder as any).additionalScreenings || []).length > 0,
      status: 'draft' as const,
      visibility: 'public' as const,
    };
  };

  const handleSave = async (
    data: Partial<JobsBoardPost>,
    existingPostForForm: JobsBoardPost | null | undefined,
    position: GigPosition | null | undefined
  ) => {
    setLoading(true);
    setError(null);
    try {
      if (existingPostForForm) {
        await jobsBoardService.updatePost(tenantId, existingPostForForm.id, {
          ...data,
          jobOrderId: jobOrder.id,
          ...(position && { positionJobTitle: position.jobTitle }),
        });
      } else if (isGigWithPositions && position) {
        await jobsBoardService.createPostFromJobOrder(tenantId, jobOrder.id, userId, {
          positionJobTitle: position.jobTitle,
          jobTitle: position.jobTitle,
          payRate: position.payRate ? parseFloat(position.payRate) || undefined : undefined,
          ...data,
        });
      } else {
        await jobsBoardService.createPost(tenantId, {
          ...data,
          jobOrderId: jobOrder.id,
        } as any, userId);
      }
      loadPosts();
      onPostSaved?.();
    } catch (err: any) {
      console.error('Error saving job post:', err);
      setError(err.message || 'Failed to save job post');
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {};

  const postForCopy = isGigWithPositions && gigPositions?.length
    ? posts.find((p) => p.positionJobTitle === gigPositions[jobsBoardSubTab]?.jobTitle) ?? null
    : posts[0] ?? null;
  const copyUrl = postForCopy ? `${window.location.origin}/c1/jobs-board/${postForCopy.id}` : null;

  const handleCopyLink = () => {
    if (copyUrl) {
      navigator.clipboard.writeText(copyUrl);
      setCopyLinkSnackbarOpen(true);
    }
  };

  return (
    <Box>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      {isGigWithPositions ? (
        <>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: 1, borderColor: 'divider', mb: 2 }}>
            <Tabs value={jobsBoardSubTab} onChange={(_, v) => setJobsBoardSubTab(v)}>
              {(gigPositions ?? []).map((pos, idx) => (
                <Tab key={pos.jobTitle} label={pos.jobTitle} id={`jobs-board-tab-${idx}`} aria-controls={`jobs-board-tabpanel-${idx}`} />
              ))}
            </Tabs>
            <Button
              variant="outlined"
              size="small"
              startIcon={<ContentCopyIcon />}
              onClick={handleCopyLink}
              disabled={!copyUrl}
              sx={{ textTransform: 'none', borderRadius: '24px', height: '36px', px: 2, whiteSpace: 'nowrap', flexShrink: 0 }}
            >
              Copy Jobs Board Link
            </Button>
          </Box>
          {(gigPositions ?? []).map((position, idx) => {
            const existingPostForPosition = posts.find((p) => p.positionJobTitle === position.jobTitle) ?? null;
            return (
              <div key={position.jobTitle} role="tabpanel" hidden={jobsBoardSubTab !== idx} id={`jobs-board-tabpanel-${idx}`} aria-labelledby={`jobs-board-tab-${idx}`}>
                {jobsBoardSubTab === idx && (
                  <Card sx={{ bgcolor: 'background.paper' }}>
                    <CardContent>
                      <JobPostForm
                        initialData={initialDataMap[position.jobTitle]}
                        onSave={(data) => handleSave(data, existingPostForPosition, position)}
                        onCancel={handleCancel}
                        loading={loading}
                        mode={existingPostForPosition ? 'edit' : 'create'}
                        hideJobOrderConnection={true}
                        jobOrderData={jobOrder}
                        positionJobDescriptionFromAccount={
                          accountPricingByTitle.get(String(position.jobTitle).trim())?.jobDescriptionFromClient ??
                          null
                        }
                      />
                    </CardContent>
                  </Card>
                )}
              </div>
            );
          })}
        </>
      ) : (
        <>
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
            <Button
              variant="outlined"
              size="small"
              startIcon={<ContentCopyIcon />}
              onClick={handleCopyLink}
              disabled={!copyUrl}
              sx={{ textTransform: 'none', borderRadius: '24px', height: '36px', px: 2, whiteSpace: 'nowrap' }}
            >
              Copy Jobs Board Link
            </Button>
          </Box>
          <Card sx={{ bgcolor: 'background.paper' }}>
            <CardContent>
              <JobPostForm
                initialData={initialDataSingle}
                onSave={(data) => handleSave(data, existingPostSingle, null)}
                onCancel={handleCancel}
                loading={loading}
                mode={existingPostSingle ? 'edit' : 'create'}
                hideJobOrderConnection={true}
                jobOrderData={jobOrder}
                positionJobDescriptionFromAccount={
                  accountPricingByTitle.get(
                    String(
                      (isGigWithPositions && gigPositions?.[0]?.jobTitle) || jobOrder.jobTitle || '',
                    ).trim(),
                  )?.jobDescriptionFromClient ?? null
                }
              />
            </CardContent>
          </Card>
        </>
      )}
      <Snackbar
        open={copyLinkSnackbarOpen}
        autoHideDuration={3000}
        onClose={() => setCopyLinkSnackbarOpen(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert onClose={() => setCopyLinkSnackbarOpen(false)} severity="success" sx={{ width: '100%' }}>
          Link copied to clipboard.
        </Alert>
      </Snackbar>
    </Box>
  );
};

const RecruiterJobOrderDetail: React.FC = () => {
  const { jobOrderId } = useParams<{ jobOrderId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, tenantId } = useAuth();
  /** One syncGigJobOrderStatusFromShifts invoke per job order visit (ref avoids duplicate calls after auto status flip). */
  const gigStatusSyncOnceRef = useRef<string | null>(null);

  // State
  const [jobOrder, setJobOrder] = useState<JobOrder | null>(null);
  const [company, setCompany] = useState<any>(null);
  const [location, setLocation] = useState<any>(null);
  const [deal, setDeal] = useState<any>(null);
  /** Recruiter account linked to this job order's company (for Account Type, E-Verify, Hiring Entity). */
  const [linkedAccount, setLinkedAccount] = useState<{ id: string; name?: string; accountType?: string | null; hiringEntityId?: string | null; defaults?: { eVerify?: { eVerifyRequired?: boolean } } } | null>(null);
  const [loading, setLoading] = useState(true);
  
  const getStoredTab = (): JobOrderDetailTabKey => {
    if (!jobOrderId) return DEFAULT_JOB_ORDER_DETAIL_TAB;
    try {
      const stored = localStorage.getItem(jobOrderDetailTabStorageKey(jobOrderId));
      return parseStoredJobOrderTab(stored);
    } catch {
      return DEFAULT_JOB_ORDER_DETAIL_TAB;
    }
  };

  const [activeTab, setActiveTab] = useState<JobOrderDetailTabKey>(() => getStoredTab());
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [recruiterUsers, setRecruiterUsers] = useState<Array<{id: string; displayName: string; email?: string}>>([]);
  
  // Reload stored tab when jobOrderId or URL tab param changes; ?tab=<key> (e.g. applications) overrides
  useEffect(() => {
    if (!jobOrderId) return;
    const tabParam = searchParams.get('tab');
    const fromUrl = parseJobOrderDetailTabQueryParam(tabParam);
    if (fromUrl) {
      setActiveTab(fromUrl);
      try {
        localStorage.setItem(jobOrderDetailTabStorageKey(jobOrderId), fromUrl);
      } catch {
        // ignore
      }
      return;
    }
    try {
      const stored = localStorage.getItem(jobOrderDetailTabStorageKey(jobOrderId));
      setActiveTab(parseStoredJobOrderTab(stored));
    } catch {
      setActiveTab(DEFAULT_JOB_ORDER_DETAIL_TAB);
    }
  }, [jobOrderId, searchParams]);

  /** Gig-only tab: clear stored/URL tab if it is not valid for this job order type. */
  useEffect(() => {
    if (!jobOrderId || !jobOrder) return;
    if (activeTab !== 'auto_messaging') return;
    if ((jobOrder as any).jobType === 'gig') return;
    setActiveTab(DEFAULT_JOB_ORDER_DETAIL_TAB);
    try {
      localStorage.setItem(jobOrderDetailTabStorageKey(jobOrderId), DEFAULT_JOB_ORDER_DETAIL_TAB);
    } catch {
      // ignore
    }
  }, [jobOrderId, jobOrder, activeTab]);

  const [associatedContacts, setAssociatedContacts] = useState<any[]>([]);
  const [associatedSalespeople, setAssociatedSalespeople] = useState<any[]>([]);
  const [connectedJobPosts, setConnectedJobPosts] = useState<JobsBoardPost[]>([]);

  const connectedPostSyndicationUrls = useMemo(() => {
    let indeedUrl: string | undefined;
    let craigslistUrl: string | undefined;
    for (const p of connectedJobPosts) {
      if (!indeedUrl && typeof p.indeedUrl === 'string' && p.indeedUrl.trim()) {
        indeedUrl = p.indeedUrl.trim();
      }
      if (!craigslistUrl && typeof p.craigslistUrl === 'string' && p.craigslistUrl.trim()) {
        craigslistUrl = p.craigslistUrl.trim();
      }
      if (indeedUrl && craigslistUrl) break;
    }
    return { indeedUrl, craigslistUrl };
  }, [connectedJobPosts]);
  const [manageContactsOpen, setManageContactsOpen] = useState(false);
  const [showManageSalespeopleDialog, setShowManageSalespeopleDialog] = useState(false);
  const [manageRecruitersOpen, setManageRecruitersOpen] = useState(false);
  const [availableRecruiters, setAvailableRecruiters] = useState<Array<{id: string; displayName: string; email?: string}>>([]);
  const [selectedRecruiterIds, setSelectedRecruiterIds] = useState<string[]>([]);
  const [loadingRecruiters, setLoadingRecruiters] = useState(false);
  const [shifts, setShifts] = useState<any[]>([]);
  const [applicantsCount, setApplicantsCount] = useState<number>(0);
  const [candidateCount, setCandidateCount] = useState<number>(0);
  const [assignmentsCount, setAssignmentsCount] = useState<number>(0);
  const [isEditingJobOrderDetails, setIsEditingJobOrderDetails] = useState(false);
  const [shareSnackbarOpen, setShareSnackbarOpen] = useState(false);
  const [showAddNoteDialog, setShowAddNoteDialog] = useState(false);
  const [showCreateTaskDialog, setShowCreateTaskDialog] = useState(false);
  const [showLogActivityDialog, setShowLogActivityDialog] = useState(false);
  const [taskSubmitting, setTaskSubmitting] = useState(false);
  const [logActivityLoading, setLogActivityLoading] = useState(false);
  const [deleteJobOrderDialogOpen, setDeleteJobOrderDialogOpen] = useState(false);
  const [deleteJobOrderSubmitting, setDeleteJobOrderSubmitting] = useState(false);
  /** Resolved labels for auto-messaging user groups (gig header). */
  const [autoMessagingUserGroupLabels, setAutoMessagingUserGroupLabels] = useState<string[]>([]);

  const { isFavorite: isJobOrderFavorite, toggleFavorite: toggleJobOrderFavorite } = useFavorites('jobOrders');

  const autoMessagingUserGroupIdsKey = useMemo(
    () => JSON.stringify(jobOrder?.autoMessagingUserGroupIds ?? null),
    [jobOrder?.autoMessagingUserGroupIds],
  );

  // Helper functions (defined before useEffect that uses them)
  const loadCompanyData = useCallback(async (companyId: string) => {
    if (!companyId || !tenantId) return;
    
    try {
      const companyRef = doc(db, 'tenants', tenantId, 'crm_companies', companyId);
      const companyDoc = await getDoc(companyRef);
      
      if (companyDoc.exists()) {
        const companyData = { id: companyDoc.id, ...companyDoc.data() };
        setCompany(companyData);
      }
    } catch (error) {
      console.error('Error loading company data:', error);
    }
  }, [tenantId]);

  const loadConnectedJobPosts = useCallback(async (jobOrderId: string) => {
    if (!jobOrderId || !tenantId) return;
    
    try {
      const jobsBoardService = JobsBoardService.getInstance();
      const posts = await jobsBoardService.getPostsByJobOrder(tenantId, jobOrderId);
      setConnectedJobPosts(posts);
    } catch (error) {
      console.error('Error loading connected job posts:', error);
    }
  }, [tenantId]);

  const fetchJobOrder = useCallback(async () => {
    if (!jobOrderId || !tenantId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const jobOrderRef = doc(db, p.jobOrder(tenantId, jobOrderId));
      const jobOrderSnap = await getDoc(jobOrderRef);
      if (jobOrderSnap.exists()) {
        const data = jobOrderSnap.data() as JobOrder;
        setJobOrder({ ...data, id: jobOrderSnap.id });
        const flatCompanyId = (data as any).companyId || data.deal?.companyId;
        if (flatCompanyId) await loadCompanyData(flatCompanyId);
        await loadConnectedJobPosts(jobOrderId);
      } else {
        const topLevelRef = doc(db, 'jobOrders', jobOrderId);
        const topSnap = await getDoc(topLevelRef);
        if (topSnap.exists()) {
          const data = topSnap.data() as JobOrder;
          setJobOrder({ ...data, id: topSnap.id });
          const flatCompanyId = (data as any).companyId || data.deal?.companyId;
          if (flatCompanyId) await loadCompanyData(flatCompanyId);
          await loadConnectedJobPosts(jobOrderId);
        } else {
          setJobOrder(null);
        }
      }
    } catch (error) {
      console.error('Error fetching job order:', error);
      setJobOrder(null);
    } finally {
      setLoading(false);
    }
  }, [jobOrderId, tenantId, loadCompanyData, loadConnectedJobPosts]);

  // Resolve recruiter account linked to this job order's company (for Account Type, E-Verify, Hiring Entity on Basic Information)
  const companyIdForAccount = jobOrder?.companyId || (jobOrder as any)?.accountId || null;
  useEffect(() => {
    if (!tenantId || !companyIdForAccount) {
      setLinkedAccount(null);
      return;
    }
    let cancelled = false;
    const accountsRef = collection(db, p.recruiterAccounts(tenantId));
    const q = query(
      accountsRef,
      where('associations.companyIds', 'array-contains', companyIdForAccount),
      limit(1)
    );
    getDocs(q)
      .then((snap) => {
        if (cancelled) return;
        const first = snap.docs[0];
        if (first) {
          setLinkedAccount({ id: first.id, ...first.data() } as any);
        } else {
          setLinkedAccount(null);
        }
      })
      .catch(() => {
        if (!cancelled) setLinkedAccount(null);
      });
    return () => { cancelled = true; };
  }, [tenantId, companyIdForAccount]);

  /** When the JO has no `hiringEntityId`, inherit from `recruiterAccountId` (then parent national account). Matches backend `resolveEntityContext` / Placements entity_employments scoping. */
  const [resolvedRecruiterAccountHiringEntityId, setResolvedRecruiterAccountHiringEntityId] = useState<string | null>(null);
  useEffect(() => {
    const rid = String((jobOrder as any)?.recruiterAccountId || '').trim();
    if (!tenantId || !rid) {
      setResolvedRecruiterAccountHiringEntityId(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDoc(doc(db, p.recruiterAccount(tenantId, rid)));
        if (!snap.exists() || cancelled) {
          if (!cancelled) setResolvedRecruiterAccountHiringEntityId(null);
          return;
        }
        const d = snap.data() as { hiringEntityId?: string | null; parentAccountId?: string | null };
        let hid = d.hiringEntityId != null && String(d.hiringEntityId).trim() ? String(d.hiringEntityId).trim() : null;
        const parentId = d.parentAccountId != null && String(d.parentAccountId).trim() ? String(d.parentAccountId).trim() : null;
        if (!hid && parentId) {
          const pSnap = await getDoc(doc(db, p.recruiterAccount(tenantId, parentId)));
          if (pSnap.exists()) {
            const pd = pSnap.data() as { hiringEntityId?: string | null };
            if (pd.hiringEntityId != null && String(pd.hiringEntityId).trim()) {
              hid = String(pd.hiringEntityId).trim();
            }
          }
        }
        if (!cancelled) setResolvedRecruiterAccountHiringEntityId(hid);
      } catch {
        if (!cancelled) setResolvedRecruiterAccountHiringEntityId(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, (jobOrder as any)?.recruiterAccountId]);

  const effectiveJobOrderHiringEntityId = useMemo(() => {
    const direct = (jobOrder as any)?.hiringEntityId;
    if (direct != null && String(direct).trim()) return String(direct).trim();
    if (resolvedRecruiterAccountHiringEntityId) return resolvedRecruiterAccountHiringEntityId;
    const fromLinked = linkedAccount?.hiringEntityId;
    if (fromLinked != null && String(fromLinked).trim()) return String(fromLinked).trim();
    return null;
  }, [jobOrder, resolvedRecruiterAccountHiringEntityId, linkedAccount?.hiringEntityId]);

  /** Entity for linked account (Account Type / E-Verify / Hiring Entity on Basic Information card). */
  const { entity: linkedAccountEntity } = useEntity(tenantId, linkedAccount?.hiringEntityId ?? null);
  /** Hiring entity for this job context: explicit JO → recruiter account (± parent) → company-linked account. Used for Placements employment chips. */
  const { entity: jobOrderHiringEntity } = useEntity(tenantId, effectiveJobOrderHiringEntityId);

  // Subscribe to job order with onSnapshot so Staff Instructions inputs update in real time; save on blur
  const jobOrderInitialLoadDone = useRef(false);
  useEffect(() => {
    if (!jobOrderId || !tenantId) {
      setLoading(false);
      return;
    }
    jobOrderInitialLoadDone.current = false;
    setLoading(true);
    const jobOrderRef = doc(db, p.jobOrder(tenantId, jobOrderId));
    const unsubscribe = onSnapshot(
      jobOrderRef,
      (snap) => {
        if (snap.exists()) {
          const data = snap.data() as JobOrder;
          setJobOrder({ ...data, id: snap.id });
          if (!jobOrderInitialLoadDone.current) {
            jobOrderInitialLoadDone.current = true;
            const flatCompanyId = (data as any).companyId || data.deal?.companyId;
            if (flatCompanyId) loadCompanyData(flatCompanyId);
            loadConnectedJobPosts(jobOrderId);
          }
        } else {
          // Fallback: try legacy top-level jobOrders path (no real-time for legacy)
          getDoc(doc(db, 'jobOrders', jobOrderId)).then((legacySnap) => {
            if (legacySnap.exists()) {
              const data = legacySnap.data() as JobOrder;
              setJobOrder({ ...data, id: legacySnap.id });
              if (!jobOrderInitialLoadDone.current) {
                jobOrderInitialLoadDone.current = true;
                const flatCompanyId = (data as any).companyId || data.deal?.companyId;
                if (flatCompanyId) loadCompanyData(flatCompanyId);
                loadConnectedJobPosts(jobOrderId);
              }
            } else {
              setJobOrder(null);
            }
            setLoading(false);
          });
          return;
        }
        setLoading(false);
      },
      (err) => {
        console.error('Job order onSnapshot error:', err);
        setJobOrder(null);
        setLoading(false);
      }
    );
    return () => unsubscribe();
  }, [jobOrderId, tenantId, loadCompanyData, loadConnectedJobPosts]);

  // Load shifts for this job order
  useEffect(() => {
    const fetchShifts = async () => {
      if (!jobOrder || !jobOrderId || !tenantId) {
        setShifts([]);
        return;
      }

      try {
        // Use tenant/job_order subcollection path
        const shiftsRef = collection(db, 'tenants', tenantId, 'job_orders', jobOrderId, 'shifts');
        const q = query(shiftsRef);
        const snapshot = await getDocs(q);
        
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        // Format as YYYY-MM-DD in local timezone (not UTC)
        const todayISO = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        
        const shiftsData = snapshot.docs
          .map(doc => ({ id: doc.id, ...doc.data(), shiftDate: doc.data().shiftDate }))
          .filter((shift: any) => shift.shiftDate >= todayISO)
          .sort((a: any, b: any) => a.shiftDate.localeCompare(b.shiftDate));
        
        setShifts(shiftsData);
      } catch (error) {
        console.error('Error fetching shifts:', error);
        setShifts([]);
      }
    };

    fetchShifts();
  }, [jobOrder, jobOrderId, tenantId]);

  // Load assignments count for this job order
  useEffect(() => {
    const fetchAssignmentsCount = async () => {
      if (!tenantId || !jobOrderId) {
        setAssignmentsCount(0);
        return;
      }
      try {
        const assignmentsRef = collection(db, 'tenants', tenantId, 'assignments');
        const q = query(assignmentsRef, where('jobOrderId', '==', jobOrderId));
        const snapshot = await getDocs(q);
        const activeCount = snapshot.docs.filter((docSnap) => {
          const data: any = docSnap.data();
          const status = data.status || 'proposed';
          return status !== 'canceled';
        }).length;
        setAssignmentsCount(activeCount);
      } catch (error) {
        console.error('Error fetching assignments for checklist:', error);
        setAssignmentsCount(0);
      }
    };

    fetchAssignmentsCount();
  }, [tenantId, jobOrderId]);

  useEffect(() => {
    if (!tenantId || !jobOrder || jobOrder.jobType !== 'gig') {
      setAutoMessagingUserGroupLabels([]);
      return;
    }
    const ids = jobOrder.autoMessagingUserGroupIds;
    if (!Array.isArray(ids) || ids.length === 0) {
      setAutoMessagingUserGroupLabels([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      const ordered: string[] = [];
      for (const gid of ids) {
        if (typeof gid !== 'string' || !gid.trim()) continue;
        try {
          const snap = await getDoc(doc(db, 'tenants', tenantId, 'userGroups', gid));
          if (snap.exists()) {
            const d = snap.data() as { groupName?: string; title?: string; name?: string };
            ordered.push(d.groupName || d.title || d.name || gid);
          } else {
            ordered.push(gid);
          }
        } catch {
          ordered.push(gid);
        }
      }
      if (!cancelled) setAutoMessagingUserGroupLabels(ordered);
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, jobOrder?.id, jobOrder?.jobType, autoMessagingUserGroupIdsKey]);

  useEffect(() => {
    gigStatusSyncOnceRef.current = null;
  }, [jobOrderId]);

  // Gig: auto open/on_hold from shift dates (server-side on shift writes; callable catches calendar rollover when opening the page)
  useEffect(() => {
    if (!tenantId || !jobOrderId || jobOrder?.jobType !== 'gig') return;
    const s = jobOrder?.status;
    if (s !== 'open' && s !== 'on_hold') return;
    const key = `${tenantId}:${jobOrderId}`;
    if (gigStatusSyncOnceRef.current === key) return;
    gigStatusSyncOnceRef.current = key;
    const fn = httpsCallable(functions, 'syncGigJobOrderStatusFromShifts');
    void fn({ tenantId, jobOrderId }).catch(() => {});
  }, [tenantId, jobOrderId, jobOrder?.jobType, jobOrder?.status]);

  const loadLocationData = useCallback(async (companyId: string, locationId: string) => {
    if (!companyId || !locationId || !tenantId) return;
    
    try {
      const locationRef = doc(db, 'tenants', tenantId, 'crm_companies', companyId, 'locations', locationId);
      const locationDoc = await getDoc(locationRef);
      
      if (locationDoc.exists()) {
        const locationData = { id: locationDoc.id, ...locationDoc.data() };
        setLocation(locationData);
      }
    } catch (error) {
      console.error('Error loading location data:', error);
    }
  }, [tenantId]);

  const loadDealData = useCallback(async (dealId: string) => {
    if (!dealId || !tenantId) return;
    
    try {
      const dealRef = doc(db, 'tenants', tenantId, 'crm_deals', dealId);
      const dealDoc = await getDoc(dealRef);
      
      if (dealDoc.exists()) {
        const dealData = { id: dealDoc.id, ...dealDoc.data() };
        setDeal(dealData);
      }
    } catch (error) {
      console.error('Error loading deal data:', error);
    }
  }, [tenantId]);

  // Load assigned recruiter user names for header display
  const loadAssignedRecruiters = async (ids: string[]) => {
    if (!ids || ids.length === 0) {
      setRecruiterUsers([]);
      return;
    }
    try {
      const usersRef = collection(db, 'users');
      const chunks: string[][] = [];
      for (let i = 0; i < ids.length; i += 10) chunks.push(ids.slice(i, i + 10));
      const results: Array<{id: string; displayName: string; email?: string}> = [];
      for (const batch of chunks) {
        const q = query(usersRef, where('__name__', 'in' as any, batch as any));
        const snap = await getDocs(q);
        snap.docs.forEach(d => {
          const u: any = d.data() || {};
          const displayName = (u.firstName && u.lastName ? `${u.firstName} ${u.lastName}`.trim() : '') ||
                              u.displayName ||
                              (u.email ? String(u.email).split('@')[0] : 'Recruiter');
          results.push({ id: d.id, displayName, email: u.email });
        });
      }
      setRecruiterUsers(results);
    } catch (error) {
      console.error('Error loading assigned recruiters:', error);
      setRecruiterUsers([]);
    }
  };

  // Load available recruiters (users with security level 5-7 or recruiter access)
  const loadAvailableRecruiters = async () => {
    if (!tenantId) return;
    
    setLoadingRecruiters(true);
    try {
      const usersRef = collection(db, 'users');
      const usersSnapshot = await getDocs(usersRef);
      
      const recruiters: Array<{id: string; displayName: string; email?: string}> = [];
      
      usersSnapshot.docs.forEach(doc => {
        const userData = doc.data();
        
        // Check if user belongs to this tenant
        if (!userData.tenantIds || !userData.tenantIds[tenantId]) return;
        
        const tenantData = userData.tenantIds[tenantId];
        const securityLevel = parseInt(tenantData.securityLevel || userData.securityLevel || '0');
        
        // Include users with security level 5-7 (internal team) or users with recruiter access
        const hasRecruiterAccess = tenantData.recruiter || userData.recruiter || false;
        const isInternalTeam = securityLevel >= 5 && securityLevel <= 7;
        
        if (!isInternalTeam && !hasRecruiterAccess) return;
        
        const displayName = (userData.firstName && userData.lastName ? `${userData.firstName} ${userData.lastName}`.trim() : '') ||
                            userData.displayName ||
                            (userData.email ? String(userData.email).split('@')[0] : 'Recruiter');
        
        recruiters.push({
          id: doc.id,
          displayName,
          email: userData.email
        });
      });
      
      // Sort by name
      recruiters.sort((a, b) => a.displayName.localeCompare(b.displayName));
      
      setAvailableRecruiters(recruiters);
    } catch (error) {
      console.error('Error loading available recruiters:', error);
      setAvailableRecruiters([]);
    } finally {
      setLoadingRecruiters(false);
    }
  };

  // Handle opening manage recruiters dialog
  const handleOpenManageRecruiters = () => {
    if (jobOrder?.assignedRecruiters) {
      setSelectedRecruiterIds([...jobOrder.assignedRecruiters]);
    } else {
      setSelectedRecruiterIds([]);
    }
    loadAvailableRecruiters();
    setManageRecruitersOpen(true);
  };

  // Handle saving assigned recruiters
  const handleSaveRecruiters = async () => {
    if (!jobOrderId || !tenantId) return;
    
    try {
      const jobOrderRef = doc(db, 'tenants', tenantId, 'job_orders', jobOrderId);
      await updateDoc(jobOrderRef, {
        assignedRecruiters: selectedRecruiterIds,
        updatedAt: serverTimestamp()
      });
      
      // Update local state
      setJobOrder(prev => prev ? { ...prev, assignedRecruiters: selectedRecruiterIds } : null);
      
      // Reload recruiter users for display
      if (selectedRecruiterIds.length > 0) {
        await loadAssignedRecruiters(selectedRecruiterIds);
      } else {
        setRecruiterUsers([]);
      }
      
      setManageRecruitersOpen(false);
    } catch (error) {
      console.error('Error saving assigned recruiters:', error);
      alert('Failed to save assigned recruiters. Please try again.');
    }
  };

  // Load associated contacts and salespeople from job order or original deal data
  const loadAssociatedContactsAndSalespeople = async () => {
    if (!jobOrder) {
      setAssociatedContacts([]);
      setAssociatedSalespeople([]);
      return;
    }
    
    try {
      const hasEmbeddedAssociations = !!jobOrder.deal?.associations;
      if (!hasEmbeddedAssociations && jobOrder.dealId) {
        try {
          const dealRef = doc(db, 'tenants', tenantId!, 'crm_deals', jobOrder.dealId);
          const dealDoc = await getDoc(dealRef);
          
          if (dealDoc.exists()) {
            const originalDealData = dealDoc.data();
            
            if (originalDealData.associations) {
              // Use the original deal associations
              const associations = originalDealData.associations;
              let contacts: any[] = [];
              let salespeople: any[] = [];
              
              // Load contacts from original deal associations
              if (associations.contacts && Array.isArray(associations.contacts)) {
                contacts = associations.contacts.map((contact: any) => ({
                  id: typeof contact === 'string' ? contact : contact.id,
                  fullName: typeof contact === 'string' ? 'Unknown Contact' : (contact.snapshot?.fullName || contact.snapshot?.name || 'Unknown Contact'),
                  email: typeof contact === 'string' ? '' : (contact.snapshot?.email || ''),
                  phone: typeof contact === 'string' ? '' : (contact.snapshot?.phone || ''),
                  title: typeof contact === 'string' ? '' : (contact.snapshot?.title || '')
                }));
                setAssociatedContacts(contacts);
              } else {
                setAssociatedContacts([]);
              }
              
              // Load salespeople from original deal associations
              if (associations.salespeople && Array.isArray(associations.salespeople)) {
                salespeople = associations.salespeople.map((salesperson: any) => {
                  const salespersonData = typeof salesperson === 'string' ? { id: salesperson } : salesperson;
                  const snapshot = salespersonData.snapshot || {};
                  
                  const fullName = snapshot.fullName || 
                                 snapshot.name || 
                                 (snapshot.firstName && snapshot.lastName ? `${snapshot.firstName} ${snapshot.lastName}`.trim() : '') ||
                                 snapshot.displayName ||
                                 snapshot.email?.split('@')[0] ||
                                 'Unknown Salesperson';
                  
                  return {
                    id: salespersonData.id,
                    fullName: fullName,
                    firstName: snapshot.firstName || '',
                    lastName: snapshot.lastName || '',
                    displayName: snapshot.displayName || fullName,
                    email: snapshot.email || '',
                    phone: snapshot.phone || '',
                    title: snapshot.title || ''
                  };
                });
                setAssociatedSalespeople(salespeople);
              } else {
                setAssociatedSalespeople([]);
              }
              
              return;
            }
          }
        } catch (error) {
          console.error('Error loading original deal associations:', error);
        }
      }
      
      if (!hasEmbeddedAssociations) {
        setAssociatedContacts([]);
        setAssociatedSalespeople([]);
        return;
      }
      
      // Load contacts from deal associations (same as DealDetails.tsx)
      const associations = jobOrder.deal!.associations || {};
      
      if (associations.contacts && Array.isArray(associations.contacts)) {
        const contacts = associations.contacts.map((contact: any) => ({
          id: typeof contact === 'string' ? contact : contact.id,
          fullName: typeof contact === 'string' ? 'Unknown Contact' : (contact.snapshot?.fullName || contact.snapshot?.name || 'Unknown Contact'),
          email: typeof contact === 'string' ? '' : (contact.snapshot?.email || ''),
          phone: typeof contact === 'string' ? '' : (contact.snapshot?.phone || ''),
          title: typeof contact === 'string' ? '' : (contact.snapshot?.title || '')
        }));
        setAssociatedContacts(contacts);
      } else {
        setAssociatedContacts([]);
      }
      
      // Load salespeople from deal associations (same as DealDetails.tsx)
      if (associations.salespeople && Array.isArray(associations.salespeople)) {
        const salespeople = associations.salespeople.map((salesperson: any) => {
          const salespersonData = typeof salesperson === 'string' ? { id: salesperson } : salesperson;
          const snapshot = salespersonData.snapshot || {};
          
          // Better name resolution: try multiple name fields
          const fullName = snapshot.fullName || 
                         snapshot.name || 
                         (snapshot.firstName && snapshot.lastName ? `${snapshot.firstName} ${snapshot.lastName}`.trim() : '') ||
                         snapshot.displayName ||
                         snapshot.email?.split('@')[0] ||
                         'Unknown Salesperson';
          
          return {
            id: salespersonData.id,
            fullName: fullName,
            firstName: snapshot.firstName || '',
            lastName: snapshot.lastName || '',
            displayName: snapshot.displayName || fullName,
            email: snapshot.email || '',
            phone: snapshot.phone || '',
            title: snapshot.title || ''
          };
        });
        setAssociatedSalespeople(salespeople);
      } else {
        setAssociatedSalespeople([]);
      }
      
    } catch (error) {
      console.error('Error loading associated contacts and salespeople:', error);
      setAssociatedContacts([]);
      setAssociatedSalespeople([]);
    }
  };

  // Trigger recruiter load when job order changes
  useEffect(() => {
    if (jobOrder?.assignedRecruiters && jobOrder.assignedRecruiters.length > 0) {
      loadAssignedRecruiters(jobOrder.assignedRecruiters);
    } else {
      setRecruiterUsers([]);
    }
  }, [jobOrder?.assignedRecruiters]);

  // Load associated contacts and salespeople when job order deal data changes
  useEffect(() => {
    if (jobOrder) {
      loadAssociatedContactsAndSalespeople();
    } else {
      setAssociatedContacts([]);
      setAssociatedSalespeople([]);
    }
  }, [jobOrder, jobOrder?.deal?.associations, jobOrder?.dealId]);

  // Load location data if worksiteId exists but worksiteName is missing
  useEffect(() => {
    const hasWorksiteId = jobOrder?.worksiteId;
    const hasWorksiteName = jobOrder?.worksiteName;
    const hasCompanyId = jobOrder?.companyId || company?.id;
    
    if (hasWorksiteId && !hasWorksiteName && hasCompanyId) {
      loadLocationData(hasCompanyId, jobOrder!.worksiteId!);
    }
  }, [jobOrder?.worksiteId, jobOrder?.worksiteName, jobOrder?.companyId, company?.id]);

  // Load deal data if dealId exists but no embedded deal data
  useEffect(() => {
    const hasDealId = jobOrder?.dealId;
    const hasEmbeddedDeal = jobOrder?.deal?.name;
    
    if (hasDealId && !hasEmbeddedDeal && !deal) {
      loadDealData(jobOrder!.dealId);
    }
  }, [jobOrder?.dealId, jobOrder?.deal?.name, deal]);

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
  };

  const handleEditLocation = () => {
    // TODO: Open manage location dialog
  };


  const getStatusColor = (status: string) => {
    switch (status) {
      case 'open': return 'success';
      case 'on_hold': return 'warning';
      case 'cancelled': return 'error';
      case 'filled': return 'info';
      case 'completed': return 'default';
      default: return 'default';
    }
  };

  const formatJobOrderNumber = (number: string | number) => {
    if (typeof number === 'string') {
      return number; // Already formatted
    }
    return `#${number.toString().padStart(4, '0')}`;
  };

  const handleContactsChange = async (updatedContacts: any[]) => {
    if (!jobOrder || !tenantId || !jobOrderId) return;
    
    try {
      // Update local state immediately for responsive UI
      setAssociatedContacts(updatedContacts);
      
      // Prepare the updated associations structure
      const updatedAssociations = {
        ...(jobOrder.deal?.associations || {}),
        contacts: updatedContacts.map(contact => ({
          id: contact.id,
          snapshot: {
            fullName: contact.fullName,
            firstName: contact.firstName,
            lastName: contact.lastName,
            email: contact.email,
            phone: contact.phone,
            title: contact.title
          }
        }))
      };
      
      
      // If job order has a deal object (created from deal OR manually created)
      if (jobOrder.deal) {
        // Update the existing deal object with new associations
        await updateDoc(doc(db, p.jobOrder(tenantId, jobOrderId)), {
          'deal.associations': updatedAssociations,
          updatedAt: new Date()
        });
      } else {
        // Job order has no deal object - create minimal deal structure to store associations
        const minimalDeal = {
          id: null,
          name: jobOrder.jobOrderName,
          companyId: jobOrder.companyId,
          companyName: jobOrder.companyName,
          locationId: jobOrder.worksiteId,
          locationName: jobOrder.worksiteName,
          stage: null,
          status: null,
          estimatedRevenue: jobOrder.estimatedRevenue || 0,
          closeDate: null,
          owner: jobOrder.createdBy,
          tags: [],
          notes: '',
          stageData: {},
          associations: updatedAssociations,
          createdAt: null,
          updatedAt: new Date()
        };
        
        
        await updateDoc(doc(db, p.jobOrder(tenantId, jobOrderId)), {
          deal: minimalDeal,
          updatedAt: new Date()
        });
      }
      
      // If there's a source deal, also update it
      if (jobOrder.dealId) {
        try {
          await updateDoc(doc(db, 'tenants', tenantId, 'crm_deals', jobOrder.dealId), {
            associations: updatedAssociations,
            updatedAt: new Date()
          });
        } catch (error) {
        }
      }
      
      
      // Reload job order to get fresh data
      await fetchJobOrder();
    } catch (error) {
      console.error('❌ Error updating contacts:', error);
      // Revert local state if update fails
      setAssociatedContacts(jobOrder?.deal?.associations?.contacts || []);
    }
  };

  const handleSalespeopleChange = async (updatedSalespeople: any[]) => {
    if (!jobOrder || !tenantId || !jobOrderId) return;

    try {
      setAssociatedSalespeople(updatedSalespeople);

      const updatedAssociations = {
        ...(jobOrder.deal?.associations || {}),
        salespeople: updatedSalespeople.map((sp) => ({
          id: sp.id,
          snapshot: {
            fullName: sp.fullName,
            firstName: sp.firstName,
            lastName: sp.lastName,
            displayName: sp.displayName,
            email: sp.email,
            phone: sp.phone,
            title: sp.title,
          },
        })),
      };

      if (jobOrder.deal) {
        await updateDoc(doc(db, p.jobOrder(tenantId, jobOrderId)), {
          'deal.associations': updatedAssociations,
          updatedAt: new Date(),
        });
      } else {
        const minimalDeal = {
          id: null,
          name: jobOrder.jobOrderName,
          companyId: jobOrder.companyId,
          companyName: jobOrder.companyName,
          locationId: jobOrder.worksiteId,
          locationName: jobOrder.worksiteName,
          stage: null,
          status: null,
          estimatedRevenue: jobOrder.estimatedRevenue || 0,
          closeDate: null,
          owner: jobOrder.createdBy,
          tags: [],
          notes: '',
          stageData: {},
          associations: updatedAssociations,
          createdAt: null,
          updatedAt: new Date(),
        };
        await updateDoc(doc(db, p.jobOrder(tenantId, jobOrderId)), {
          deal: minimalDeal,
          updatedAt: new Date(),
        });
      }

      if (jobOrder.dealId) {
        try {
          await updateDoc(doc(db, 'tenants', tenantId, 'crm_deals', jobOrder.dealId), {
            associations: updatedAssociations,
            updatedAt: new Date(),
          });
        } catch {
          // Ignore if source deal update fails
        }
      }

      await fetchJobOrder();
    } catch (error) {
      console.error('Error updating salespeople:', error);
      setAssociatedSalespeople(jobOrder?.deal?.associations?.salespeople || []);
    }
  };

  /** Permanently remove job order, linked job posts, shifts, and placements on those shifts. */
  const handleConfirmDeleteJobOrder = async () => {
    if (!tenantId || !jobOrderId) return;
    setDeleteJobOrderSubmitting(true);
    try {
      const jobsBoardService = JobsBoardService.getInstance();
      const posts = await jobsBoardService.getPostsByJobOrder(tenantId, jobOrderId);
      for (const post of posts) {
        await jobsBoardService.deletePost(tenantId, post.id);
      }

      const shiftsRef = collection(db, p.shifts(tenantId, jobOrderId));
      const shiftsSnap = await getDocs(shiftsRef);
      const placementsRef = collection(db, 'tenants', tenantId, 'placements');
      for (const shiftDoc of shiftsSnap.docs) {
        const shiftId = shiftDoc.id;
        const placeSnap = await getDocs(query(placementsRef, where('shiftId', '==', shiftId)));
        for (const pd of placeSnap.docs) {
          await deleteDoc(pd.ref);
        }
        await deleteDoc(shiftDoc.ref);
      }

      await deleteDoc(doc(db, p.jobOrder(tenantId, jobOrderId)));
      navigate('/jobs/job-orders');
    } catch (err: any) {
      console.error('Delete job order failed:', err);
      alert(err?.message || 'Could not delete this job order. Check permissions or try again.');
    } finally {
      setDeleteJobOrderSubmitting(false);
      setDeleteJobOrderDialogOpen(false);
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!jobOrder) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">
          Job order not found or you don't have permission to view it.
        </Alert>
      </Box>
    );
  }

  const setTabAndPersist = (key: JobOrderDetailTabKey) => {
    setActiveTab(key);
    if (jobOrderId) {
      try {
        localStorage.setItem(jobOrderDetailTabStorageKey(jobOrderId), key);
      } catch {
        // ignore
      }
    }
  };

  const displayCompanyName =
    jobOrder.companyName || company?.companyName || company?.name || 'Company';
  const companyInitial = String(displayCompanyName || 'C').trim().charAt(0).toUpperCase();

  const jobTypeRaw = (jobOrder as any).jobType;
  const jobTypeLabel =
    jobTypeRaw === 'gig' ? 'Gig' : jobTypeRaw === 'career' ? 'Career' : jobTypeRaw ? String(jobTypeRaw) : '';

  const jobOrderDetailVisibleTabStrip =
    jobTypeRaw === 'gig'
      ? JOB_ORDER_DETAIL_TAB_STRIP
      : JOB_ORDER_DETAIL_TAB_STRIP.filter((t) => t.key !== 'auto_messaging');

  const displayCompanyId = (jobOrder as any).companyId || jobOrder?.deal?.companyId || company?.id;

  const worksiteName = (jobOrder as any).worksiteName || (jobOrder as any).deal?.worksiteName;
  const worksiteId = (jobOrder as any).worksiteId || (jobOrder as any).deal?.worksiteId || location?.id;
  const loadedLocationName = location?.name || location?.locationName;
  const dealLocations = (jobOrder as any)?.deal?.locations || [];
  const dealLocationName = dealLocations?.[0]?.locationName || dealLocations?.[0]?.name;
  const dealLocationId = dealLocations?.[0]?.id;
              const displayLocationId = worksiteId || dealLocationId;

  const worksiteCity: string | undefined =
    (jobOrder as any).worksiteAddress?.city || (jobOrder as any).city || undefined;
  const worksiteState: string | undefined =
    (jobOrder as any).worksiteAddress?.state || (jobOrder as any).state || undefined;

  const displayLocationName =
    worksiteName ||
    loadedLocationName ||
    dealLocationName ||
    ([worksiteCity, worksiteState].filter(Boolean).join(', ') || '');

  const startDate = safeToDate((jobOrder as any).startDate);
  const createdAt = safeToDate((jobOrder as any).createdAt);

  const checklistProgress = getJobOrderChecklistProgress({
    jobOrder,
    location,
    associatedContacts,
    recruiterUsers,
    jobPosts: connectedJobPosts,
    shiftsCount: shifts.length,
    indeedUrl: (jobOrder as any)?.indeedUrl,
    craigslistUrl: (jobOrder as any)?.craigslistUrl,
  });

  const linkedRecruiterAccountId =
    (jobOrder as any)?.recruiterAccountId ?? linkedAccount?.id ?? null;

  return (
    <Box sx={{ p: 0 }}>
      <PageHeader
        title={
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2.5 }}>
              <Avatar
                src={company?.logo}
              alt={displayCompanyName}
                sx={{ 
                width: 108,
                height: 108,
                  bgcolor: 'primary.main',
                fontSize: '40px',
                fontWeight: 700,
                flexShrink: 0,
                }}
              >
              {companyInitial}
              </Avatar>

            <Box
              sx={{
                flex: 1,
                minWidth: 0,
                minHeight: '108px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'flex-start',
                gap: 0.75,
              }}
            >
              {/* Line 1: Name + Favorites star */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                {jobOrderId && (
                  <FavoriteButton
                    itemId={jobOrderId}
                    favoriteType="jobOrders"
                    isFavorite={isJobOrderFavorite}
                    toggleFavorite={toggleJobOrderFavorite}
                    size="small"
                    tooltipText={{ favorited: 'Remove from favorites', notFavorited: 'Add to favorites' }}
                    sx={{ p: 0.25 }}
                  />
                )}
                <Typography
                  variant="h6"
                  sx={{
                    fontSize: { xs: '20px', md: '24px' },
                    fontWeight: 600,
                    lineHeight: 1.2,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {jobOrder.jobOrderName || 'Job Order'}
                </Typography>
              </Box>

              {/* Line 2: Job Order meta (two-row style from prod) */}
              <Box sx={{ mt: 0.25, display: 'flex', flexWrap: 'wrap', gap: 1.25, alignItems: 'center' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                  <Typography
                    variant="body2"
                    sx={{ color: 'rgba(0,0,0,0.55)', fontWeight: 500, fontSize: '0.875rem' }}
                  >
                    Job Order:
                  </Typography>
                  <Chip
                    label={`#${jobOrder.jobOrderNumber || ''}`}
                    size="small"
                    sx={{
                      bgcolor: 'rgba(0,0,0,0.08)',
                      '& .MuiChip-label': { fontWeight: 600, fontSize: '0.875rem' },
                    }}
                  />
                </Box>
                
                {jobTypeLabel && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                    <Typography
                      variant="body2"
                      sx={{ color: 'rgba(0,0,0,0.55)', fontWeight: 500, fontSize: '0.875rem' }}
                    >
                      Job Type:
                    </Typography>
                    <Chip
                      label={jobTypeLabel}
                      size="small"
                      sx={{
                        bgcolor: 'rgba(0,0,0,0.08)',
                        '& .MuiChip-label': { fontWeight: 600, fontSize: '0.875rem' },
                      }}
                    />
                  </Box>
                )}
                
                {jobOrder.status && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                    <Typography
                      variant="body2"
                      sx={{ color: 'rgba(0,0,0,0.55)', fontWeight: 500, fontSize: '0.875rem' }}
                    >
                      Status:
                    </Typography>
          <Chip
            label={jobOrder.status}
                    size="small"
                      sx={{
                        bgcolor: 'rgba(0, 180, 90, 0.12)',
                        color: '#0A7A3B',
                        '& .MuiChip-label': { fontWeight: 700, fontSize: '0.875rem' },
                      }}
                    />
                  </Box>
                )}
                
                {displayLocationName && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                    <Typography
                      variant="body2"
                      sx={{ color: 'rgba(0,0,0,0.55)', fontWeight: 500, fontSize: '0.875rem' }}
                    >
                      Location:
                    </Typography>
                    <Chip
                      label={displayLocationName}
                      size="small"
                      sx={{
                        bgcolor: 'rgba(0,0,0,0.08)',
                        '& .MuiChip-label': { fontWeight: 600, fontSize: '0.875rem' },
                      }}
                    />
                  </Box>
                )}
                
                {startDate && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                    <Typography
                      variant="body2"
                      sx={{ color: 'rgba(0,0,0,0.55)', fontWeight: 500, fontSize: '0.875rem' }}
                    >
                      Start Date:
                    </Typography>
                      <Chip
                      label={format(startDate, 'MMM dd, yyyy')}
                        size="small"
                      sx={{
                        bgcolor: 'rgba(0,0,0,0.08)',
                        '& .MuiChip-label': { fontWeight: 600, fontSize: '0.875rem' },
                      }}
                      />
                    </Box>
                )}
              </Box>

              {hasJobBoardSyndicationUrl(
                connectedPostSyndicationUrls.indeedUrl,
                connectedPostSyndicationUrls.craigslistUrl
              ) && (
                <JobBoardSyndicationIconRow
                  indeedUrl={connectedPostSyndicationUrls.indeedUrl}
                  craigslistUrl={connectedPostSyndicationUrls.craigslistUrl}
                  sx={{ mt: 0.25 }}
                />
              )}

              {/* Line 3: Blue link row */}
              <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center', mt: 0.25, flexWrap: 'wrap' }}>
                <BusinessIcon sx={{ fontSize: 18, color: 'rgb(74, 144, 226)' }} />
                {displayCompanyId ? (
                        <MUILink
                    component="button"
                    type="button"
                          underline="hover"
                    onClick={() => navigate(`/companies/${displayCompanyId}`)}
                    sx={{
                      fontSize: '0.875rem',
                      fontWeight: 600,
                      color: 'rgb(74, 144, 226)',
                      '&:hover': { color: 'rgb(74, 144, 226)' },
                    }}
                  >
                    {displayCompanyName}
                        </MUILink>
                ) : (
                  <Typography sx={{ fontSize: '0.875rem', fontWeight: 600, color: 'rgb(74, 144, 226)' }}>
                    {displayCompanyName}
                  </Typography>
                )}

                {displayLocationName && (
                  <>
                    <LocationIcon sx={{ fontSize: 18, color: 'rgb(74, 144, 226)' }} />
                    {displayCompanyId && displayLocationId ? (
                            <MUILink
                        component="button"
                        type="button"
                              underline="hover"
                        onClick={() =>
                          navigate(`/companies/${displayCompanyId}/locations/${displayLocationId}`)
                        }
                        sx={{
                          fontSize: '0.875rem',
                          fontWeight: 600,
                          color: 'rgb(74, 144, 226)',
                          '&:hover': { color: 'rgb(74, 144, 226)' },
                        }}
                      >
                        {displayLocationName}
                            </MUILink>
                    ) : (
                      <Typography sx={{ fontSize: '0.875rem', fontWeight: 600, color: 'rgb(74, 144, 226)' }}>
                        {displayLocationName}
                          </Typography>
                    )}
                  </>
                )}

                {jobTypeRaw === 'gig' && autoMessagingUserGroupLabels.length > 0 && (
                  <>
                    <GroupsIcon sx={{ fontSize: 18, color: 'rgb(74, 144, 226)' }} />
                    <Typography
                      component="span"
                      sx={{ fontSize: '0.875rem', fontWeight: 600, color: 'rgb(74, 144, 226)' }}
                    >
                      {autoMessagingUserGroupLabels.join(' · ')}
                    </Typography>
                  </>
                )}
              </Stack>

              {/* Line 4: Checklist progress */}
              <Stack
                direction="row"
                spacing={0.5}
                sx={{ alignItems: 'center', mt: 0.5, flexWrap: 'wrap' }}
              >
                <Typography
                  variant="caption"
                  sx={{ fontWeight: 700, color: 'rgba(0,0,0,0.55)', mr: 0.75 }}
                >
                  Order Setup: {checklistProgress.completed}/{checklistProgress.total}
                </Typography>
                {checklistProgress.statuses.map((s) => (
                  <Tooltip
                    key={s.id}
                    title={`${s.label}: ${s.complete ? 'Complete' : 'Missing'}`}
                    arrow
                  >
                    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center' }}>
                      <CheckCircleIcon
                        sx={{
                          fontSize: 16,
                          color: s.complete ? 'success.main' : 'grey.300',
                        }}
                      />
                    </Box>
                  </Tooltip>
                ))}
              </Stack>

              {/* Line 5: Icon row (Account, Add Note, Add Task, Log Activity) */}
              <Stack
                direction="row"
                spacing={1}
                sx={{ alignItems: 'center', mt: 1.5 }}
              >
                <Tooltip
                  title={
                    linkedRecruiterAccountId
                      ? 'Open linked account'
                      : 'No recruiter account linked to this job’s company yet'
                  }
                >
                  <span>
                    <IconButton
                      size="small"
                      disabled={!linkedRecruiterAccountId}
                      onClick={() =>
                        linkedRecruiterAccountId && navigate(`/accounts/${linkedRecruiterAccountId}`)
                      }
                      aria-label="Open linked account"
                      sx={{
                        p: 1,
                        color: 'primary.main',
                        bgcolor: 'action.hover',
                        borderRadius: 1,
                        '&:hover': {
                          color: 'primary.dark',
                          bgcolor: 'primary.light',
                          transform: 'translateY(-1px)',
                          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                        },
                        '&.Mui-disabled': { opacity: 0.45 },
                        transition: 'all 0.2s ease',
                      }}
                    >
                      <AccountBalanceIcon sx={{ fontSize: 20 }} />
                    </IconButton>
                  </span>
                </Tooltip>
                <Tooltip title="Add Note">
                  <IconButton
                    size="small"
                    onClick={() => setShowAddNoteDialog(true)}
                    sx={{ 
                      p: 1,
                      color: 'primary.main',
                      bgcolor: 'action.hover',
                      borderRadius: 1,
                      '&:hover': {
                        color: 'primary.dark',
                        bgcolor: 'primary.light',
                        transform: 'translateY(-1px)',
                        boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                      },
                      transition: 'all 0.2s ease'
                    }}
                  >
                    <NoteIcon sx={{ fontSize: 20 }} />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Add Task">
                  <IconButton
                    size="small"
                    onClick={() => setShowCreateTaskDialog(true)}
                    sx={{ 
                      p: 1,
                      color: 'primary.main',
                      bgcolor: 'action.hover',
                      borderRadius: 1,
                      '&:hover': {
                        color: 'primary.dark',
                        bgcolor: 'primary.light',
                        transform: 'translateY(-1px)',
                        boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                      },
                      transition: 'all 0.2s ease'
                    }}
                  >
                    <AddTaskIcon sx={{ fontSize: 20 }} />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Log Activity">
                  <IconButton
                    size="small"
                    onClick={() => setShowLogActivityDialog(true)}
                    sx={{ 
                      p: 1,
                      color: 'primary.main',
                      bgcolor: 'action.hover',
                      borderRadius: 1,
                      '&:hover': {
                        color: 'primary.dark',
                        bgcolor: 'primary.light',
                        transform: 'translateY(-1px)',
                        boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                      },
                      transition: 'all 0.2s ease'
                    }}
                  >
                    <CheckCircleIcon sx={{ fontSize: 20 }} />
                  </IconButton>
                </Tooltip>
              </Stack>
                      </Box>
                  </Box>
        }
        filters={
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            {jobOrderDetailVisibleTabStrip.map((t) => {
              const isActive = activeTab === t.key;
                return (
                <Button
                  key={t.key}
                  onClick={() => setTabAndPersist(t.key)}
                  variant="text"
                  sx={{
                    textTransform: 'none',
                    borderRadius: '999px',
                    fontSize: '14px',
                    fontWeight: isActive ? 500 : 400,
                    color: isActive ? 'white' : 'rgba(0, 0, 0, 0.7)',
                    bgcolor: isActive ? '#0057B8' : 'rgba(0, 0, 0, 0.04)',
                    px: 1.5,
                    py: 0.75,
                    minWidth: 'auto',
                    '&:hover': {
                      bgcolor: isActive ? '#004a9f' : 'rgba(0, 0, 0, 0.08)',
                    },
                  }}
                >
                  {t.label}
                </Button>
              );
            })}
              </Box>
            } 
        rightActions={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Button
              variant="outlined"
              color="error"
              startIcon={<DeleteIcon />}
              onClick={() => setDeleteJobOrderDialogOpen(true)}
              sx={{
                textTransform: 'none',
                borderRadius: '24px',
                height: '40px',
                px: 2,
                whiteSpace: 'nowrap',
              }}
            >
              Delete
            </Button>
            <Button
              variant="outlined"
              startIcon={<ArrowBackIcon />}
              onClick={() => navigate('/jobs/job-orders')}
                    sx={{
                textTransform: 'none',
                borderRadius: '24px',
                height: '40px',
                px: 2,
                whiteSpace: 'nowrap',
              }}
            >
              Back
            </Button>
              </Box>
            } 
          />

      <Dialog
        open={deleteJobOrderDialogOpen}
        onClose={() => !deleteJobOrderSubmitting && setDeleteJobOrderDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Delete this job order?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 2 }}>
            This permanently deletes <strong>{jobOrder.jobOrderName || 'this job order'}</strong> ({formatJobOrderNumber(jobOrder.jobOrderNumber || '')}
            ). Linked job board posts, all shifts, and placements on those shifts will be removed. This cannot be undone.
          </Typography>
          {(applicantsCount > 0 || assignmentsCount > 0) && (
            <Alert severity="warning" sx={{ mb: 1 }}>
              This order has {applicantsCount > 0 ? `${applicantsCount} application(s)` : ''}
              {applicantsCount > 0 && assignmentsCount > 0 ? ' and ' : ''}
              {assignmentsCount > 0 ? `${assignmentsCount} assignment(s)` : ''} recorded. Tenant-level application and
              assignment documents may still exist; clean those up separately if needed.
            </Alert>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDeleteJobOrderDialogOpen(false)} disabled={deleteJobOrderSubmitting}>
            Cancel
          </Button>
          <Button
            variant="contained"
            color="error"
            disabled={deleteJobOrderSubmitting}
            onClick={() => void handleConfirmDeleteJobOrder()}
          >
            {deleteJobOrderSubmitting ? 'Deleting…' : 'Delete job order'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Tab Panels */}
      <TabPanel value={activeTab} index="overview">
        {/* Overview Tab - Job Order Form with Widgets */}
        <Grid container spacing={3}>
          {/* Left Column - Basic Information Card (70%) */}
          <Grid item xs={12} md={8}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {/* Basic Information Card */}
              {isEditingJobOrderDetails ? (
                // Edit Mode - Show JobOrderForm without outer Card wrapper
                <JobOrderForm
                  jobOrderId={jobOrderId}
                  dealId={jobOrder?.dealId}
                  recruiterAccountId={(jobOrder as any)?.recruiterAccountId ?? linkedAccount?.id ?? null}
                  onSave={() => {
                    setIsEditingJobOrderDetails(false);
                    fetchJobOrder();
                  }}
                  onCancel={() => {
                    setIsEditingJobOrderDetails(false);
                  }}
                />
              ) : (
                <Card>
                  <CardHeader 
                    title="Basic Information" 
                    titleTypographyProps={{ variant: 'h6', fontWeight: 'bold' }}
                    action={
                      <IconButton
                        size="small"
                        onClick={() => setIsEditingJobOrderDetails(!isEditingJobOrderDetails)}
                        sx={{ 
                          color: isEditingJobOrderDetails ? 'primary.main' : 'text.secondary',
                          '&:hover': {
                            bgcolor: 'action.hover'
                          }
                        }}
                      >
                        <EditIcon fontSize="small" />
                      </IconButton>
                    }
                  />
                  <CardContent sx={{ p: 2 }}>
                    {/* View Mode - Show as Text with Better Visual Hierarchy */}
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      {/* Basic Details Section */}
                      <Box>
                        <Typography variant="subtitle2" fontWeight={600} color="text.primary" sx={{ mb: 2, fontSize: '0.875rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                          Basic Details
                        </Typography>
                        <Grid container spacing={2}>
                          {jobOrder?.jobOrderName && (
                            <Grid item xs={12} sm={6}>
                              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                                <BriefcaseIcon sx={{ fontSize: 18, color: 'text.secondary', mt: 0.5, flexShrink: 0 }} />
                                <Box sx={{ flex: 1, minWidth: 0 }}>
                                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', fontWeight: 500 }}>
                                    Job Order Name
                                  </Typography>
                                  <Typography variant="body1" sx={{ mt: 0.25, fontWeight: 500 }}>
                                    {jobOrder.jobOrderName}
                                  </Typography>
                                </Box>
                              </Box>
                            </Grid>
                          )}

                          {jobOrder?.status && (
                            <Grid item xs={12} sm={6}>
                              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                                <InfoIcon sx={{ fontSize: 18, color: 'text.secondary', mt: 0.5, flexShrink: 0 }} />
                                <Box sx={{ flex: 1, minWidth: 0 }}>
                                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', fontWeight: 500 }}>
                                    Status
                                  </Typography>
                                  <Box sx={{ mt: 0.25 }}>
                                    <Chip
                                      label={jobOrder.status}
                                      size="small"
                                      color={jobOrder.status === 'open' ? 'success' : jobOrder.status === 'on_hold' ? 'warning' : jobOrder.status === 'cancelled' ? 'error' : 'default'}
                                      sx={{ height: 24, fontSize: '0.75rem', fontWeight: 500 }}
                                    />
                                  </Box>
                                </Box>
                              </Box>
                            </Grid>
                          )}

                          {jobOrder?.jobType && (
                            <Grid item xs={12} sm={6}>
                              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                                <WorkIcon sx={{ fontSize: 18, color: 'text.secondary', mt: 0.5, flexShrink: 0 }} />
                                <Box sx={{ flex: 1, minWidth: 0 }}>
                                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', fontWeight: 500 }}>
                                    Job Type
                                  </Typography>
                                  <Typography variant="body1" sx={{ mt: 0.25, fontWeight: 500 }}>
                                    {jobOrder.jobType === 'gig' ? 'Gig' : jobOrder.jobType === 'career' ? 'Career' : 'Not set'}
                                  </Typography>
                                </Box>
                              </Box>
                            </Grid>
                          )}

                          {(jobOrder?.companyName || company?.companyName || company?.name) && (
                            <Grid item xs={12} sm={6}>
                              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                                <BusinessIcon sx={{ fontSize: 18, color: 'text.secondary', mt: 0.5, flexShrink: 0 }} />
                                <Box sx={{ flex: 1, minWidth: 0 }}>
                                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', fontWeight: 500 }}>
                                    Account
                                  </Typography>
                                  <Typography variant="body1" sx={{ mt: 0.25 }}>
                                    {(jobOrder?.companyId || company?.id) ? (
                                      <MUILink
                                        href={`/companies/${jobOrder?.companyId || company?.id}`}
                                        onClick={(e) => {
                                          e.preventDefault();
                                          navigate(`/companies/${jobOrder?.companyId || company?.id}`);
                                        }}
                                        color="primary"
                                        underline="hover"
                                        sx={{ fontWeight: 500 }}
                                      >
                                        {jobOrder?.companyName || company?.companyName || company?.name}
                                      </MUILink>
                                    ) : (
                                      <span style={{ fontWeight: 500 }}>{jobOrder?.companyName || company?.companyName || company?.name}</span>
                                    )}
                                  </Typography>
                                </Box>
                              </Box>
                            </Grid>
                          )}

                          {/* Account Type, E-Verify, Hiring Entity from linked recruiter account */}
                          <Grid item xs={12} sm={6}>
                            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                              <BusinessIcon sx={{ fontSize: 18, color: 'text.secondary', mt: 0.5, flexShrink: 0 }} />
                              <Box sx={{ flex: 1, minWidth: 0 }}>
                                <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', fontWeight: 500 }}>
                                  Account Type
                                </Typography>
                                <Typography variant="body1" sx={{ mt: 0.25 }}>
                                  {linkedAccount?.accountType === 'national'
                                    ? 'National account'
                                    : linkedAccount?.accountType === 'child'
                                      ? 'Child account'
                                      : linkedAccount != null
                                        ? 'Standalone'
                                        : '—'}
                                </Typography>
                              </Box>
                            </Box>
                          </Grid>
                          <Grid item xs={12} sm={6}>
                            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                              <SecurityIcon sx={{ fontSize: 18, color: 'text.secondary', mt: 0.5, flexShrink: 0 }} />
                              <Box sx={{ flex: 1, minWidth: 0 }}>
                                <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', fontWeight: 500 }}>
                                  E-Verify
                                </Typography>
                                <Typography variant="body1" sx={{ mt: 0.25 }}>
                                  {linkedAccount != null
                                    ? (linkedAccountEntity?.everifyRequired ?? linkedAccount?.defaults?.eVerify?.eVerifyRequired ?? false)
                                      ? 'Yes'
                                      : 'No'
                                    : '—'}
                                </Typography>
                              </Box>
                            </Box>
                          </Grid>
                          <Grid item xs={12} sm={6}>
                            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                              <WorkIcon sx={{ fontSize: 18, color: 'text.secondary', mt: 0.5, flexShrink: 0 }} />
                              <Box sx={{ flex: 1, minWidth: 0 }}>
                                <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', fontWeight: 500 }}>
                                  Hiring Entity
                                </Typography>
                                <Typography variant="body1" sx={{ mt: 0.25 }}>
                                  {linkedAccount != null
                                    ? (linkedAccountEntity?.name ?? '—')
                                    : '—'}
                                </Typography>
                              </Box>
                            </Box>
                          </Grid>

                          {jobOrder?.worksiteName && (
                            <Grid item xs={12} sm={6}>
                              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                                <LocationIcon sx={{ fontSize: 18, color: 'text.secondary', mt: 0.5, flexShrink: 0 }} />
                                <Box sx={{ flex: 1, minWidth: 0 }}>
                                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', fontWeight: 500 }}>
                                    Worksite
                                  </Typography>
                                  <Typography variant="body1" sx={{ mt: 0.25 }}>
                                    {jobOrder.worksiteId && company?.id ? (
                                      <MUILink
                                        href={`/companies/${company.id}?tab=locations`}
                                        onClick={(e) => {
                                          e.preventDefault();
                                          navigate(`/companies/${company.id}?tab=locations`);
                                        }}
                                        color="primary"
                                        underline="hover"
                                        sx={{ fontWeight: 500 }}
                                      >
                                        {jobOrder.worksiteName}
                                      </MUILink>
                                    ) : (
                                      <span style={{ fontWeight: 500 }}>{jobOrder.worksiteName}</span>
                                    )}
                                  </Typography>
                                </Box>
                              </Box>
                            </Grid>
                          )}
                        </Grid>
                      </Box>

                      {/* Job Details Section (Career only) */}
                      {jobOrder?.jobType === 'career' && (jobOrder?.jobTitle || jobOrder?.workersNeeded || jobOrder?.startDate || jobOrder?.endDate) && (
                        <Box>
                          <Typography variant="subtitle2" fontWeight={600} color="text.primary" sx={{ mb: 2, fontSize: '0.875rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                            Job Details
                          </Typography>
                          <Grid container spacing={2}>
                            {jobOrder?.jobTitle && (
                              <Grid item xs={12} sm={6}>
                                <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                                  <BriefcaseIcon sx={{ fontSize: 18, color: 'text.secondary', mt: 0.5, flexShrink: 0 }} />
                                  <Box sx={{ flex: 1, minWidth: 0 }}>
                                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', fontWeight: 500 }}>
                                      Job Title
                                    </Typography>
                                    <Typography variant="body1" sx={{ mt: 0.25, fontWeight: 500 }}>
                                      {jobOrder.jobTitle}
                                    </Typography>
                                  </Box>
                                </Box>
                              </Grid>
                            )}

                            {jobOrder?.workersNeeded && (
                              <Grid item xs={12} sm={6}>
                                <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                                  <GroupIcon sx={{ fontSize: 18, color: 'text.secondary', mt: 0.5, flexShrink: 0 }} />
                                  <Box sx={{ flex: 1, minWidth: 0 }}>
                                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', fontWeight: 500 }}>
                                      Workers Needed
                                    </Typography>
                                    <Typography variant="body1" sx={{ mt: 0.25, fontWeight: 500 }}>
                                      {jobOrder.workersNeeded}
                                    </Typography>
                                  </Box>
                                </Box>
                              </Grid>
                            )}

                            {jobOrder?.startDate && (
                              <Grid item xs={12} sm={6}>
                                <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                                  <CalendarIcon sx={{ fontSize: 18, color: 'text.secondary', mt: 0.5, flexShrink: 0 }} />
                                  <Box sx={{ flex: 1, minWidth: 0 }}>
                                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', fontWeight: 500 }}>
                                      Start Date
                                    </Typography>
                                    <Typography variant="body1" sx={{ mt: 0.25, fontWeight: 500 }}>
                                      {typeof jobOrder.startDate === 'string' 
                                        ? format(new Date(jobOrder.startDate), 'MMM dd, yyyy')
                                        : safeToDate(jobOrder.startDate) 
                                          ? format(safeToDate(jobOrder.startDate)!, 'MMM dd, yyyy')
                                          : 'Not set'}
                                    </Typography>
                                  </Box>
                                </Box>
                              </Grid>
                            )}

                            {jobOrder?.endDate && (
                              <Grid item xs={12} sm={6}>
                                <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                                  <CalendarIcon sx={{ fontSize: 18, color: 'text.secondary', mt: 0.5, flexShrink: 0 }} />
                                  <Box sx={{ flex: 1, minWidth: 0 }}>
                                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', fontWeight: 500 }}>
                                      End Date
                                    </Typography>
                                    <Typography variant="body1" sx={{ mt: 0.25, fontWeight: 500 }}>
                                      {typeof jobOrder.endDate === 'string' 
                                        ? format(new Date(jobOrder.endDate), 'MMM dd, yyyy')
                                        : safeToDate(jobOrder.endDate) 
                                          ? format(safeToDate(jobOrder.endDate)!, 'MMM dd, yyyy')
                                          : 'Not set'}
                                    </Typography>
                                  </Box>
                                </Box>
                              </Grid>
                            )}
                          </Grid>
                        </Box>
                      )}

                      {/* Financial Information Section */}
                      {(jobOrder?.payRate || (jobOrder as any)?.markup || (jobOrder as any)?.billRate) && (
                        <Box>
                          <Typography variant="subtitle2" fontWeight={600} color="text.primary" sx={{ mb: 2, fontSize: '0.875rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                            Financial Information
                          </Typography>
                          <Grid container spacing={2}>
                            {jobOrder?.payRate && (
                              <Grid item xs={12} sm={6}>
                                <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                                  <MoneyIcon sx={{ fontSize: 18, color: 'text.secondary', mt: 0.5, flexShrink: 0 }} />
                                  <Box sx={{ flex: 1, minWidth: 0 }}>
                                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', fontWeight: 500 }}>
                                      Pay Rate
                                    </Typography>
                                    <Typography variant="body1" sx={{ mt: 0.25, fontWeight: 500 }}>
                                      ${parseFloat(jobOrder.payRate.toString()).toFixed(2)}
                                    </Typography>
                                  </Box>
                                </Box>
                              </Grid>
                            )}

                            {(jobOrder as any)?.markup && (
                              <Grid item xs={12} sm={6}>
                                <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                                  <MoneyIcon sx={{ fontSize: 18, color: 'text.secondary', mt: 0.5, flexShrink: 0 }} />
                                  <Box sx={{ flex: 1, minWidth: 0 }}>
                                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', fontWeight: 500 }}>
                                      Markup
                                    </Typography>
                                    <Typography variant="body1" sx={{ mt: 0.25, fontWeight: 500 }}>
                                      {(jobOrder as any).markup}%
                                    </Typography>
                                  </Box>
                                </Box>
                              </Grid>
                            )}

                            {(jobOrder as any)?.billRate && (
                              <Grid item xs={12} sm={6}>
                                <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                                  <MoneyIcon sx={{ fontSize: 18, color: 'text.secondary', mt: 0.5, flexShrink: 0 }} />
                                  <Box sx={{ flex: 1, minWidth: 0 }}>
                                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', fontWeight: 500 }}>
                                      Bill Rate
                                    </Typography>
                                    <Typography variant="body1" sx={{ mt: 0.25, fontWeight: 500 }}>
                                      ${parseFloat((jobOrder as any).billRate.toString()).toFixed(2)}
                                    </Typography>
                                  </Box>
                                </Box>
                              </Grid>
                            )}
                          </Grid>
                        </Box>
                      )}
                    </Box>
                  </CardContent>
                </Card>
              )}
            </Box>
          </Grid>

          {/* Right Column - Widgets (30%) */}
          <Grid item xs={12} md={4}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {/* CRM company (client account) summary */}
              <SectionCard title="Account" action={
                <Button
                  variant="outlined"
                  size="small"
                  onClick={() => {
                    const aid =
                      (jobOrder as any)?.recruiterAccountId ?? linkedAccount?.id ?? null;
                    if (aid) navigate(`/accounts/${aid}`);
                    else if (company) navigate(`/companies/${company.id}`);
                  }}
                  sx={{ 
                    minWidth: 'auto',
                    px: 1,
                    py: 0.5,
                    fontSize: '0.75rem',
                    textTransform: 'none'
                  }}
                >
                  View
                </Button>
              }>
                {company ? (
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <Box
                      sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1, borderRadius: 1, bgcolor: 'grey.50', cursor: 'pointer' }}
                      onClick={() => {
                        const aid =
                          (jobOrder as any)?.recruiterAccountId ?? linkedAccount?.id ?? null;
                        if (aid) navigate(`/accounts/${aid}`);
                        else navigate(`/companies/${company.id}`);
                      }}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => { 
                        if (e.key === 'Enter' || e.key === ' ') { 
                          e.preventDefault(); 
                          const aid =
                            (jobOrder as any)?.recruiterAccountId ?? linkedAccount?.id ?? null;
                          if (aid) navigate(`/accounts/${aid}`);
                          else navigate(`/companies/${company.id}`);
                        } 
                      }}
                    >
                      <Avatar 
                        src={company.logo || company.logoUrl || company.logo_url || company.avatar}
                        sx={{ width: 32, height: 32, fontSize: '0.875rem', bgcolor: 'primary.main' }}
                      >
                        {(company.companyName || company.name || 'C').charAt(0).toUpperCase()}
                      </Avatar>
                      <Box sx={{ flex: 1 }}>
                        <Typography variant="body2" fontWeight="medium">
                          {company.companyName || company.name || 'Unknown Company'}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {company.industry || company.sector || 'No industry'}
                        </Typography>
                      </Box>
                    </Box>
                  </Box>
                ) : (
                  <Box sx={{ textAlign: 'center', py: 3 }}>
                    <Typography variant="body2" color="text.secondary">
                      No company assigned
                    </Typography>
                  </Box>
                )}
              </SectionCard>

              {/* Assigned Recruiters Widget */}
              <SectionCard title="Assigned Recruiters" action={
                <Button
                  variant="outlined"
                  size="small"
                  onClick={handleOpenManageRecruiters}
                  sx={{ 
                    minWidth: 'auto',
                    px: 1,
                    py: 0.5,
                    fontSize: '0.75rem',
                    textTransform: 'none'
                  }}
                >
                  Edit
                </Button>
              }>
                {recruiterUsers.length > 0 ? (
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    {recruiterUsers.map((recruiter) => (
                      <Box
                        key={recruiter.id}
                        sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1, borderRadius: 1, bgcolor: 'grey.50', cursor: 'pointer' }}
                        onClick={() => navigate(`/users/${recruiter.id}`)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/users/${recruiter.id}`); } }}
                      >
                        <Avatar sx={{ width: 32, height: 32, fontSize: '0.875rem' }}>
                          {recruiter.displayName?.charAt(0) || 'R'}
                        </Avatar>
                        <Box sx={{ flex: 1 }}>
                          <Typography variant="body2" fontWeight="medium">
                            {recruiter.displayName || 'Unknown Recruiter'}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {recruiter.email || 'No email'}
                          </Typography>
                        </Box>
                      </Box>
                    ))}
                  </Box>
                ) : (
                  <Box sx={{ textAlign: 'center', py: 3 }}>
                    <Typography variant="body2" color="text.secondary">
                      No recruiters assigned
                    </Typography>
                  </Box>
                )}
              </SectionCard>

              {/* Active Salespeople Widget */}
              <SectionCard title="Active Salespeople" action={
                <Button
                  variant="outlined"
                  size="small"
                  onClick={() => setShowManageSalespeopleDialog(true)}
                  sx={{ 
                    minWidth: 'auto',
                    px: 1,
                    py: 0.5,
                    fontSize: '0.75rem',
                    textTransform: 'none'
                  }}
                >
                  Edit
                </Button>
              }>
                {associatedSalespeople.length > 0 ? (
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    {associatedSalespeople.map((salesperson) => (
                      <Box
                        key={salesperson.id}
                        sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1, borderRadius: 1, bgcolor: 'grey.50' }}
                      >
                        <Avatar sx={{ width: 32, height: 32, fontSize: '0.875rem' }}>
                          {salesperson.fullName?.charAt(0) || salesperson.firstName?.charAt(0) || salesperson.displayName?.charAt(0) || 'S'}
                        </Avatar>
                        <Box sx={{ flex: 1 }}>
                          <Typography variant="body2" fontWeight="medium">
                            {salesperson.fullName || salesperson.displayName || `${salesperson.firstName || ''} ${salesperson.lastName || ''}`.trim() || 'Unknown Salesperson'}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {salesperson.email || salesperson.title || 'No additional info'}
                          </Typography>
                        </Box>
                      </Box>
                    ))}
                  </Box>
                ) : (
                  <Box sx={{ textAlign: 'center', py: 3 }}>
                    <Typography variant="body2" color="text.secondary">
                      No salespeople assigned
                    </Typography>
                  </Box>
                )}
              </SectionCard>

              {/* Deal Contacts Widget */}
              <SectionCard title="Deal Contacts" action={
                <Button
                  variant="outlined"
                  size="small"
                  onClick={() => setManageContactsOpen(true)}
                  sx={{ 
                    minWidth: 'auto',
                    px: 1,
                    py: 0.5,
                    fontSize: '0.75rem',
                    textTransform: 'none'
                  }}
                >
                  Edit
                </Button>
              }>
                {associatedContacts.length > 0 ? (
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    {associatedContacts.map((contact) => (
                      <Box
                        key={contact.id}
                        sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1, borderRadius: 1, bgcolor: 'grey.50', cursor: 'pointer' }}
                        onClick={() => navigate(`/contacts/${contact.id}`)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/contacts/${contact.id}`); } }}
                      >
                        <Avatar sx={{ width: 32, height: 32, fontSize: '0.875rem' }}>
                          {contact.fullName?.charAt(0) || contact.firstName?.charAt(0) || contact.name?.charAt(0) || 'C'}
                        </Avatar>
                        <Box sx={{ flex: 1 }}>
                          <Typography variant="body2" fontWeight="medium">
                            {contact.fullName || `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || contact.name || 'Unknown Contact'}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {contact.title || 'No title'}
                          </Typography>
                        </Box>
                      </Box>
                    ))}
                  </Box>
                ) : (
                  <Box sx={{ textAlign: 'center', py: 3 }}>
                    <Typography variant="body2" color="text.secondary">
                      No contacts assigned
                    </Typography>
                  </Box>
                )}
              </SectionCard>

              {/* Location Widget */}
              <SectionCard title="Location" action={
                <Button
                  variant="outlined"
                  size="small"
                  onClick={handleEditLocation}
                  sx={{ 
                    minWidth: 'auto',
                    px: 1,
                    py: 0.5,
                    fontSize: '0.75rem',
                    textTransform: 'none'
                  }}
                >
                  Edit
                </Button>
              }>
                {(() => {
                  // Try to get location from job order directly, loaded location data, or deal associations
                  const worksiteName = jobOrder?.worksiteName;
                  const worksiteId = jobOrder?.worksiteId;
                  const loadedLocationName = location?.nickname || location?.name;
                  
                  // Fallback to deal associations if no worksite name
                  const dealLocations = jobOrder?.deal?.associations?.locations || [];
                  const locationEntry = dealLocations.length > 0 ? dealLocations[0] : null;
                  const dealLocationId = typeof locationEntry === 'string' ? locationEntry : locationEntry?.id;
                  const dealLocationName = typeof locationEntry === 'string' ? '' : (locationEntry?.snapshot?.name || locationEntry?.snapshot?.nickname || locationEntry?.name || '');
                  
                  const displayLocationId = worksiteId || dealLocationId;
                  const displayLocationName = worksiteName || loadedLocationName || dealLocationName;
                  const displayAddress = location?.address || (typeof jobOrder?.worksiteAddress === 'string' ? jobOrder.worksiteAddress : '');
                  
                  if (displayLocationName) {
                    return (
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                        <Box
                          sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1, borderRadius: 1, bgcolor: 'grey.50', cursor: 'pointer' }}
                          onClick={() => {
                            const companyId = company?.id || jobOrder?.companyId;
                            if (companyId && displayLocationId) {
                              navigate(`/companies/${companyId}/locations/${displayLocationId}`);
                            }
                          }}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => { 
                            if (e.key === 'Enter' || e.key === ' ') { 
                              e.preventDefault(); 
                              const companyId = company?.id || jobOrder?.companyId;
                              if (companyId && displayLocationId) {
                                navigate(`/companies/${companyId}/locations/${displayLocationId}`);
                              }
                            } 
                          }}
                        >
                          <Avatar sx={{ width: 32, height: 32, fontSize: '0.875rem', bgcolor: 'primary.main' }}>
                            <BusinessIcon sx={{ fontSize: 16 }} />
                          </Avatar>
                          <Box sx={{ flex: 1 }}>
                            <Typography variant="body2" fontWeight="medium">
                              {displayLocationName}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {displayAddress || 'No address'}
                            </Typography>
                          </Box>
                        </Box>
                      </Box>
                    );
                  } else {
                    return (
                      <Box sx={{ textAlign: 'center', py: 3 }}>
                        <Typography variant="body2" color="text.secondary">
                          No location assigned
                        </Typography>
                      </Box>
                    );
                  }
                })()}
              </SectionCard>
            </Box>
          </Grid>
        </Grid>
      </TabPanel>

      <TabPanel value={activeTab} index="checklist">
        <JobOrderChecklist
          jobOrder={jobOrder}
          location={location}
          associatedContacts={associatedContacts}
          recruiterUsers={recruiterUsers}
          jobPosts={connectedJobPosts}
          tenantId={tenantId || ''}
          jobOrderId={jobOrderId || ''}
          applicantsCount={applicantsCount}
          candidateCount={candidateCount}
          shiftsCount={shifts.length}
          assignmentsCount={assignmentsCount}
          onEditLocation={handleEditLocation}
          onEditContacts={() => setManageContactsOpen(true)}
          onEditRecruiters={handleOpenManageRecruiters}
          onOpenJobBoard={() => setTabAndPersist('jobs_board')}
          onJobOrderUpdated={(updates) =>
            setJobOrder((prev) => (prev ? { ...prev, ...updates } : prev))
          }
        />
      </TabPanel>

      <TabPanel value={activeTab} index="hiring">
        <JobOrderHiringTab
          jobOrder={jobOrder}
          tenantId={tenantId || ''}
          onSaved={() => {
            fetchJobOrder();
          }}
        />
      </TabPanel>

      <TabPanel value={activeTab} index="defaults">
        <JobOrderDefaultsTab 
          jobOrder={jobOrder}
          tenantId={tenantId || ''}
          onSaved={() => {
            fetchJobOrder();
          }}
        />
      </TabPanel>

      <TabPanel value={activeTab} index="staff_instructions">
        {/* Staff Instructions Tab */}
        <Grid container spacing={3}>
          {/* First Day Instructions */}
          <Grid item xs={12}>
            <StaffInstructionCard
              title="First Day Instructions"
              fieldKey="firstDay"
              placeholder="Enter first day instructions (e.g., arrival time, what to bring, who to meet, orientation details...)"
              uploadPlaceholder="Upload first day schedules, orientation materials, or related documents"
              jobOrder={jobOrder}
              jobOrderId={jobOrderId || ''}
              tenantId={tenantId || ''}
              userId={user?.uid || ''}
              onRefresh={fetchJobOrder}
            />
          </Grid>

          {/* Parking Instructions */}
          <Grid item xs={12}>
            <StaffInstructionCard
              title="Parking Instructions"
              fieldKey="parking"
              placeholder="Enter parking instructions for staff (e.g., where to park, parking pass requirements, visitor parking location...)"
              uploadPlaceholder="Upload parking maps, diagrams, or related documents"
              jobOrder={jobOrder}
              jobOrderId={jobOrderId || ''}
              tenantId={tenantId || ''}
              userId={user?.uid || ''}
              onRefresh={fetchJobOrder}
            />
          </Grid>

          {/* Check-In Instructions */}
          <Grid item xs={12}>
            <StaffInstructionCard
              title="Check-In Instructions"
              fieldKey="checkIn"
              placeholder="Enter check-in instructions (e.g., where to report, who to ask for, required documents...)"
              uploadPlaceholder="Upload check-in forms, maps, or related documents"
              jobOrder={jobOrder}
              jobOrderId={jobOrderId || ''}
              tenantId={tenantId || ''}
              userId={user?.uid || ''}
              onRefresh={fetchJobOrder}
            />
          </Grid>

          {/* Uniform Instructions */}
          <Grid item xs={12}>
            <StaffInstructionCard
              title="Uniform Instructions"
              fieldKey="uniform"
              placeholder="Enter uniform and dress code requirements (e.g., specific colors, safety gear, PPE requirements...)"
              uploadPlaceholder="Upload uniform photos, dress code guides, or related documents"
              jobOrder={jobOrder}
              jobOrderId={jobOrderId || ''}
              tenantId={tenantId || ''}
              userId={user?.uid || ''}
              onRefresh={fetchJobOrder}
            />
          </Grid>

          {/* Credential Instructions */}
          <Grid item xs={12}>
            <StaffInstructionCard
              title="Credential Instructions"
              fieldKey="credentials"
              placeholder="Enter credential requirements (e.g., badge pickup, wristband issuance, ID requirements...)"
              uploadPlaceholder="Upload credential forms, badge photos, or related documents"
              jobOrder={jobOrder}
              jobOrderId={jobOrderId || ''}
              tenantId={tenantId || ''}
              userId={user?.uid || ''}
              onRefresh={fetchJobOrder}
            />
          </Grid>

          {/* Other Instructions */}
          <Grid item xs={12}>
            <StaffInstructionCard
              title="Other Instructions"
              fieldKey="other"
              placeholder="Enter any additional instructions or important information for staff..."
              uploadPlaceholder="Upload any other relevant documents"
              jobOrder={jobOrder}
              jobOrderId={jobOrderId || ''}
              tenantId={tenantId || ''}
              userId={user?.uid || ''}
              onRefresh={fetchJobOrder}
            />
          </Grid>

          {/* Other Attachments (attachments only, no text field) */}
          <Grid item xs={12}>
            <StaffInstructionCard
              title="Other Attachments"
              fieldKey="attachments"
              placeholder="" 
              uploadPlaceholder="Upload any other relevant documents for this job order"
              jobOrder={jobOrder}
              jobOrderId={jobOrderId || ''}
              tenantId={tenantId || ''}
              userId={user?.uid || ''}
              onRefresh={fetchJobOrder}
            />
          </Grid>
        </Grid>
      </TabPanel>

      <TabPanel value={activeTab} index="jobs_board">
        {/* Jobs Board Tab */}
        {jobOrder && (
          <JobOrderJobsBoardTab
            jobOrder={jobOrder}
            tenantId={tenantId || ''}
            userId={user?.uid || ''}
            onPostSaved={() => {
              loadConnectedJobPosts(jobOrder.id);
              fetchJobOrder();
            }}
          />
        )}
      </TabPanel>

      <TabPanel value={activeTab} index="auto_messaging">
        {jobOrder && tenantId && jobOrderId && (
          <JobOrderAutoMessagingTab
            tenantId={tenantId}
            jobOrderId={jobOrderId}
            jobOrder={jobOrder}
            onJobOrderUpdated={fetchJobOrder}
          />
        )}
      </TabPanel>

      <TabPanel value={activeTab} index="shift_setup">
        {/* Shift Setup Tab */}
        <ShiftSetupTab 
          tenantId={tenantId}
          jobOrderId={jobOrderId || ''}
          jobOrder={jobOrder}
        />
      </TabPanel>

      <TabPanel value={activeTab} index="applications">
        {/* Applications Tab */}
        <ApplicantsTable 
          jobOrderId={jobOrderId || ''} 
          connectedJobPosts={connectedJobPosts}
          tenantId={tenantId || ''}
          jobOrder={jobOrder}
          onCountChange={setApplicantsCount}
          onCandidateCountChange={setCandidateCount}
        />
      </TabPanel>

      <TabPanel value={activeTab} index="placements">
        {/* Placements Tab */}
        <PlacementsTab
          tenantId={tenantId || ''}
          jobOrderId={jobOrderId || ''}
          jobOrder={jobOrder}
          onJobOrderUpdated={fetchJobOrder}
          connectedJobPostIds={(connectedJobPosts || []).map((p) => p.id).filter(Boolean)}
          hiringEntityName={jobOrderHiringEntity?.name ?? null}
          placementHiringEntityId={effectiveJobOrderHiringEntityId}
        />
      </TabPanel>

      <TabPanel value={activeTab} index="notes">
        {/* Notes Tab */}
        <CRMNotesTab
          entityId={jobOrderId || ''}
          entityType={"jobOrder" as any}
          entityName={jobOrder?.jobOrderName || 'Job Order'}
          tenantId={tenantId || ''}
        />
      </TabPanel>

      <TabPanel value={activeTab} index="activity">
        {/* Activity Tab */}
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Activity Timeline
            </Typography>
            <Alert severity="info">
              Activity tracking will be implemented in the next phase.
            </Alert>
          </CardContent>
        </Card>
      </TabPanel>

      {/* Action Menu */}

      {/* Manage Recruiters Dialog */}
      <Dialog
        open={manageRecruitersOpen}
        onClose={() => setManageRecruitersOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Assign Recruiters</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 2 }}>
            <Alert severity="info">
              Select one or more recruiters to assign to this job order. Recruiters can be internal team members (security levels 5-7) or users with recruiter access.
            </Alert>
            {loadingRecruiters ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
                <CircularProgress />
              </Box>
            ) : (
              <Autocomplete
                multiple
                options={availableRecruiters}
                getOptionLabel={(option) => option.displayName || option.email || 'Unknown'}
                value={availableRecruiters.filter(r => selectedRecruiterIds.includes(r.id))}
                onChange={(_, newValue) => {
                  setSelectedRecruiterIds(newValue.map(r => r.id));
                }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Select Recruiters"
                    placeholder="Choose recruiters..."
                  />
                )}
                renderTags={(value, getTagProps) =>
                  value.map((option, index) => (
                    <Chip
                      label={option.displayName || option.email || 'Unknown'}
                      {...getTagProps({ index })}
                      key={option.id}
                    />
                  ))
                }
              />
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setManageRecruitersOpen(false)}>Cancel</Button>
          <Button 
            onClick={handleSaveRecruiters} 
            variant="contained"
            disabled={loadingRecruiters}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>

      {/* Manage Contacts Dialog */}
      <ManageContactsDialog
        open={manageContactsOpen}
        onClose={() => setManageContactsOpen(false)}
        tenantId={tenantId || ''}
        currentContacts={associatedContacts}
        onContactsChange={handleContactsChange}
        dealCompanyId={jobOrder?.companyId || company?.id}
      />

      <ManageSalespeopleDialog
        open={showManageSalespeopleDialog}
        onClose={() => setShowManageSalespeopleDialog(false)}
        tenantId={tenantId || ''}
        currentSalespeople={associatedSalespeople}
        onSalespeopleChange={handleSalespeopleChange}
        filterByInternalTeam
      />

      {/* Share Snackbar */}
      <Snackbar
        open={shareSnackbarOpen}
        autoHideDuration={3000}
        onClose={() => setShareSnackbarOpen(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert onClose={() => setShareSnackbarOpen(false)} severity="success" sx={{ width: '100%' }}>
          Job posting URL copied to clipboard!
        </Alert>
      </Snackbar>

      {/* Add Note Dialog */}
      {jobOrderId && tenantId && (
        <AddJobOrderNoteDialog
          open={showAddNoteDialog}
          onClose={() => setShowAddNoteDialog(false)}
          jobOrderId={jobOrderId}
          jobOrderName={jobOrder?.jobOrderName || 'Job Order'}
          tenantId={tenantId}
          onNoteAdded={() => {
            // Optionally refresh notes tab or show success message
          }}
        />
      )}

      {/* Create Task Dialog */}
      {showCreateTaskDialog && jobOrderId && tenantId && user && (
        <CreateTaskDialog
          open={showCreateTaskDialog}
          onClose={() => setShowCreateTaskDialog(false)}
          onSubmit={async (taskData) => {
            if (taskSubmitting) return;
            setTaskSubmitting(true);
            try {
              // Import TaskService dynamically to avoid circular dependencies
              const { TaskService } = await import('../utils/taskService');
              const taskService = TaskService.getInstance();
              
              await taskService.createTask({
                ...taskData,
                tenantId,
                createdBy: user.uid,
                assignedTo: user.uid, // Default to current user
                associations: taskData?.associations || {},
                sourceType: 'recruiting',
                sourceId: jobOrderId,
                sourceName: jobOrder?.jobOrderName || 'Job Order',
                jobOrderId: jobOrderId,
              });
              setShowCreateTaskDialog(false);
            } catch (error) {
              console.error('Error creating task:', error);
            } finally {
              setTaskSubmitting(false);
            }
          }}
          hideCrmAssociations
        />
      )}

      {/* Log Activity Dialog */}
      {showLogActivityDialog && jobOrderId && tenantId && user && (
        <LogActivityDialog
          open={showLogActivityDialog}
          onClose={() => setShowLogActivityDialog(false)}
          onSubmit={async (taskData) => {
            setLogActivityLoading(true);
            try {
              const { TaskService } = await import('../utils/taskService');
              const taskService = TaskService.getInstance();
              await taskService.createTask({
                ...taskData,
                tenantId,
                createdBy: user.uid,
                assignedTo: user.uid,
                status: 'completed',
                completedAt: new Date(),
                associations: taskData.associations || {},
                sourceType: 'recruiting',
                sourceId: jobOrderId,
                sourceName: jobOrder?.jobOrderName || 'Job Order',
                jobOrderId: jobOrderId,
              });
              setShowLogActivityDialog(false);
            } catch (error) {
              console.error('Error logging activity:', error);
            } finally {
              setLogActivityLoading(false);
            }
          }}
          loading={logActivityLoading}
          hideCrmAssociations
        />
      )}
     
    </Box>
  );
};

export default RecruiterJobOrderDetail;
