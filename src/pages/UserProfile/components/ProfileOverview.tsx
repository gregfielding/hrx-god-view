import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useUserProfileEntityEmploymentChips } from '../../../hooks/useUserProfileEntityEmploymentChips';
import { useLatestWorkerAiPrescreenInterview } from '../../../hooks/useLatestWorkerAiPrescreenInterview';
import { normalizeScoreSummary, type ScoreSummary } from '../../../utils/scoreSummary';
import {
  OverviewQualificationsCard,
  OverviewScoringCard,
  OverviewRecentActivityCard,
  overviewSubsectionHeadingTypographyProps,
  overviewProfileFieldValueSx,
  type OverviewActivityLogEntry,
} from './OverviewDashboardSections';
import OverviewActionItemsCard from './OverviewActionItemsCard';
import UserScoreRefreshButton from './UserScoreRefreshButton';
import { deriveActionItemsV1 } from '../../../utils/userActionItems/deriveActionItemsV1';
import certificationCatalogManifestJson from '../../../data/generated/certificationCatalogManifest.v1.json';
import type { CertificationCatalogManifestV1 } from '../../../types/certifications/certificationCatalogManifest';
import { PREVIEW_SAMPLE_CERTIFICATION_REQUIREMENTS } from '../../../utils/certifications/previewSampleCertificationRequirements';
import {
  evaluateCertificationsForRequirements,
  type RequirementEvaluationRow,
} from '../../../utils/certifications/evaluateCertificationsForRequirements';
import { getCanonicalCertificationRecordsWithIds } from '../../../utils/certifications/getCanonicalCertificationRecords';
import { normalizeDateToISODateString } from '../../../utils/certifications/normalizeDateToISODateString';
import {
  buildRecruiterCertificationTrustSignals,
  certificationOperationalSummaryCounts,
} from '../../../utils/certifications/buildRecruiterCertificationTrustSignals';
import {
  isCertEngineActionItemsEnabled,
  isCertEngineTrustSurfacesEnabled,
} from '../../../utils/certifications/certEngineFeatureFlags';
import { buildOverviewQualificationsFromUserDoc } from '../utils/overviewQualificationsSnapshot';
import type { OverviewQualificationsData } from '../utils/overviewQualificationsSnapshot';
import { toChipLabel } from '../../../utils/chipLabel';
import {
  Box,
  TextField,
  Typography,
  Button,
  Snackbar,
  Alert,
  Grid,
  MenuItem,
  FormControl,
  InputLabel,
  Select,
  Chip,
  Autocomplete,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  DialogContentText,
  FormControlLabel,
  Switch,
  Checkbox,
  Card,
  CardContent,
  CardHeader,
  IconButton,
  InputAdornment,
  Stack,
  Link as MUILink,
  Tooltip,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import {
  Person as PersonIcon,
  Work as WorkIcon,
  Business as BusinessIcon,
  ContactEmergency as EmergencyIcon,
  Security as SecurityIcon,
  LocationOnOutlined as LocationOnOutlinedIcon,
  CheckCircle as CheckCircleIcon,
  DirectionsCar,
  DirectionsTransit,
  DirectionsBike,
  DirectionsWalk,
  MoreHoriz,
  Edit as EditIcon,
  Email as EmailIcon,
  Phone as PhoneIcon,
  CalendarToday as CalendarIcon,
  Language as LanguageIcon,
  AccountBox as AccountBoxIcon,
  LocalPhone as LocalPhoneIcon,
  ContentCopy as ContentCopyIcon,
} from '@mui/icons-material';
import type { SvgIconComponent } from '@mui/icons-material';
import {
  doc,
  getDoc,
  onSnapshot,
  updateDoc,
  collection,
  getDocs,
  query,
  where,
  orderBy,
  limit,
} from 'firebase/firestore';
import { sendPasswordResetEmail } from 'firebase/auth';

import { db , auth } from '../../../firebase';
import { formatPhoneNumber } from '../../../utils/formatPhone';
import { normalizeLast4SsnDigits } from '../../../utils/last4Ssn';
import { logProfileUpdateActivity, logSecurityChangeActivity } from '../../../utils/activityLogger';
import { persistScoreSummaryFromProfile } from '../../../utils/persistScoreSummaryFromProfile';
import { useAuth } from '../../../contexts/AuthContext';
import { UserProfileForm, EmergencyContact } from '../../../types/UserProfile';
import type { ActionItem } from '../../../types/actionItems';
import type { WorkerInterviewAiBlock } from '../../../types/workerAiPrescreenInterview';
import type { ProfileUpdateReminderControls } from './MessagesTab';

import AddressFormFields, { type AddressFormFieldsHandle } from './AddressTab/AddressFormFields';
import MapWithMarkers from './AddressTab/MapWithMarkers';
type Props = {
  uid: string;
  onTabChange?: (tab: string) => void;
  /** When set, Overview Scoring card shows a link to open the Score tab. Omit when that tab is not available. */
  onOpenScoreTab?: () => void;
  autoOpenHomeAddress?: boolean;
  /**
   * When `quickProfileOnly`, render only the Quick profile & location card (for a modal).
   * Loads the same user doc and edit controls as the Overview tab.
   */
  embeddedMode?: 'full' | 'quickProfileOnly';
  /**
   * Header-grade interview signal from parent (scoreSummary + interview subcollection).
   * When omitted, Action Items falls back to scoreSummary on this tab only.
   */
  actionItemsHasInterview?: boolean;
  /** Same `users/{uid}` screening orders as the record header — no extra read. */
  actionItemsBackgroundCheckOrders?: Array<{
    id: string;
    status: string;
    result?: string;
    typeLabel?: string;
  }>;
  /** Raw certification entries from the user doc (e.g. `skillsData.certifications`). */
  actionItemsCertifications?: unknown[];
  /** Latest prescreen `ai` from parent (aligns action item copy with Score tab / decision summary). */
  actionItemsPrescreenAi?: WorkerInterviewAiBlock | null;
  /** After manual recruiter rescore (callable), bump parent refresh for interview-derived signals. */
  onAfterRecruiterRescore?: () => void;
  /** Recruiter-only: SMS profile update reminder (Qualifications card header). */
  profileUpdateReminder?: ProfileUpdateReminderControls;
};

const ProfileOverview: React.FC<Props> = ({
  uid,
  onTabChange,
  onOpenScoreTab,
  autoOpenHomeAddress = false,
  embeddedMode = 'full',
  actionItemsHasInterview,
  actionItemsBackgroundCheckOrders,
  actionItemsCertifications,
  actionItemsPrescreenAi,
  onAfterRecruiterRescore,
  profileUpdateReminder,
}) => {
  const { latestPrescreenAi: scoringPrescreenAiFromInterview } = useLatestWorkerAiPrescreenInterview(uid);
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const sectionSpacing = isMobile ? 1.25 : 1.25;
  const cardPadding = isMobile ? 1 : 1;
  const cardContentPadding = isMobile ? 1.1 : 1.1;
  const cardHeaderPadding = isMobile ? { px: 1.1, py: 0.65 } : { px: 1.25, py: 0.65 };
  /** No elevation/hover lift on user-record overview cards (scoped to this page only). */
  const overviewCardSx = {
    boxShadow: 'none',
    transition: 'none',
    '&:hover': { boxShadow: 'none' },
  } as const;
  const coerceToDate = (value: any): Date | null => {
    if (!value) return null;
    try {
      // Firestore Timestamp
      if (typeof value?.toDate === 'function') return value.toDate();
      // ISO string or date string
      if (typeof value === 'string') {
        // NOTE: For date-only strings like YYYY-MM-DD, `new Date("YYYY-MM-DD")` is parsed as UTC,
        // which can display as the previous day in local timezones. Prefer parsing those explicitly
        // when you need a date-only value.
        const d = new Date(value);
        return isNaN(d.getTime()) ? null : d;
      }
      // Milliseconds
      if (typeof value === 'number') {
        const d = new Date(value);
        return isNaN(d.getTime()) ? null : d;
      }
      // Date instance
      if (value instanceof Date) return value;
      return null;
    } catch {
      return null;
    }
  };

  // Normalize any dob value (string, Timestamp, { seconds }, Date) to YYYY-MM-DD for form/display
  const normalizeDobToYyyyMmDd = (v: any): string => {
    if (v == null || v === '') return '';
    if (typeof v === 'string') {
      const s = v.trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
      if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) {
        const [mm, dd, yyyy] = s.split('/');
        return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
      }
      const d = new Date(s);
      return !isNaN(d.getTime()) ? d.toISOString().split('T')[0]! : '';
    }
    if (typeof v?.toDate === 'function') {
      const d = v.toDate();
      return d instanceof Date && !isNaN(d.getTime()) ? d.toISOString().split('T')[0]! : '';
    }
    if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().split('T')[0]!;
    if (typeof v === 'number' && v > 0) {
      const d = new Date(v);
      return !isNaN(d.getTime()) ? d.toISOString().split('T')[0]! : '';
    }
    const sec = (v && (typeof (v as any).seconds === 'number' ? (v as any).seconds : (v as any)._seconds));
    if (typeof sec === 'number') {
      const d = new Date(sec * 1000);
      return !isNaN(d.getTime()) ? d.toISOString().split('T')[0]! : '';
    }
    return '';
  };

  const formatDateOnlyForDisplay = (v: any): string => {
    const normalized = normalizeDobToYyyyMmDd(v);
    if (!normalized) return '-';
    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ];
    const [yyyy, mm, dd] = normalized.split('-');
    const monthIdx = Math.max(0, Math.min(11, parseInt(mm, 10) - 1));
    const dayNum = parseInt(dd, 10);
    return `${monthNames[monthIdx]} ${dayNum}, ${yyyy}`;
  };

  // Helper: valid DOB present (string, Timestamp, { seconds }, Date)
  const hasValidDateOfBirth = (dob: any): boolean => {
    return normalizeDobToYyyyMmDd(dob) !== '';
  };
  const { tenantId: activeTenantId, user, securityLevel, activeTenant } = useAuth();
  const viewerSecurityLevel = parseInt(String(securityLevel || '0'), 10);
  const isOwnProfile = !!user?.uid && user.uid === uid;
  /** Logged-in applicant/flex/worker (0–4) viewing their own profile — show SSN last-four near phone. */
  const isStaffSelfProfile = isOwnProfile && viewerSecurityLevel >= 0 && viewerSecurityLevel <= 4;
  // Only show User Groups on a user's *own* profile, and only for admin security levels 5-7.
  const canViewUserGroupsSection = isOwnProfile && viewerSecurityLevel >= 5 && viewerSecurityLevel <= 7;
  /** Align with recruiter/admin profile views (security ≥ 5); Overview scoring is only shown in full mode. */
  const showReviewRescore = embeddedMode === 'full' && viewerSecurityLevel >= 5;
  const [form, setForm] = useState<UserProfileForm>({
    firstName: '',
    lastName: '',
    preferredName: '',
    email: '',
    phone: '',
    linkedinUrl: '',
    dateOfBirth: '',
    last4SSN: '',
    gender: undefined,
    securityLevel: '5',
    employmentType: 'Full-Time',
    departmentId: '',
    divisionId: '',
    locationId: '',
    regionId: '',
    managerId: '',
    startDate: '',
    workStatus: 'Active',
    workerId: '',
    union: '',
    workEligibility: true,
    languages: [],
    emergencyContact: undefined,
    transportMethod: undefined,
    addedToIndeedFlex: false,
    role: 'Worker',
    jobTitle: '',
    department: '',
  });

  const [originalForm, setOriginalForm] = useState<UserProfileForm>(form);
  const [message, setMessage] = useState('');
  const [showToast, setShowToast] = useState(false);
  const [departments, setDepartments] = useState<any[]>([]);
  const [divisions, setDivisions] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [regions, setRegions] = useState<any[]>([]);
  const [managers, setManagers] = useState<any[]>([]);
  const [tenantId, setTenantId] = useState<string>('');
  const [tenantName, setTenantName] = useState<string>('');
  const [customerName, setCustomerName] = useState<string>('');
  const [userGroups, setUserGroups] = useState<any[]>([]);
  const [userGroupIds, setUserGroupIds] = useState<string[]>([]);
  const [resetPasswordDialogOpen, setResetPasswordDialogOpen] = useState(false);
  const [resetPasswordLoading, setResetPasswordLoading] = useState(false);
  const [addressInfo, setAddressInfo] = useState<any>({
    homeLat: null,
    homeLng: null,
    workLat: 38.8977, // Default: White House
    workLng: -77.0365,
    currentLat: null,
    currentLng: null,
  });

  // System access info (read-only)
  const [systemAccess, setSystemAccess] = useState<{
    loginCount: number | null;
    lastLoginAt: Date | null;
    lastActiveAt: Date | null;
    uid: string;
  }>({ loginCount: null, lastLoginAt: null, lastActiveAt: null, uid });

  // Phone verification status
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [isEditingBasicIdentity, setIsEditingBasicIdentity] = useState(false);
  const [isEditingHomeAddress, setIsEditingHomeAddress] = useState(false);
  const homeAddressRef = useRef<HTMLDivElement | null>(null);
  const quickProfileAddressFormRef = useRef<AddressFormFieldsHandle | null>(null);
  const [quickProfileAddressDirty, setQuickProfileAddressDirty] = useState(false);
  const [quickProfileAddressMapPreview, setQuickProfileAddressMapPreview] = useState<Record<
    string,
    unknown
  > | null>(null);

  const [overviewActivityLogs, setOverviewActivityLogs] = useState<OverviewActivityLogEntry[]>([]);
  const [overviewActivityLogsLoading, setOverviewActivityLogsLoading] = useState(false);
  const [overviewActivityLogsError, setOverviewActivityLogsError] = useState<string | null>(null);

  useEffect(() => {
    if (!autoOpenHomeAddress) return;
    setIsEditingHomeAddress(true);
    setTimeout(() => {
      homeAddressRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  }, [autoOpenHomeAddress]);

  useEffect(() => {
    if (embeddedMode !== 'quickProfileOnly') return;
    setIsEditingBasicIdentity(true);
    setIsEditingHomeAddress(true);
    setQuickProfileAddressMapPreview(null);
    setQuickProfileAddressDirty(false);
  }, [embeddedMode]);

  const noopAddressPersist = useCallback(async () => {}, []);

  const quickProfileMapCoords = embeddedMode === 'quickProfileOnly' ? quickProfileAddressMapPreview ?? addressInfo : addressInfo;

  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    (async () => {
      setOverviewActivityLogsLoading(true);
      setOverviewActivityLogsError(null);
      try {
        const activitiesRef = collection(db, 'users', uid, 'activityLogs');
        const q = query(activitiesRef, orderBy('timestamp', 'desc'), limit(500));
        const snap = await getDocs(q);
        const rows: OverviewActivityLogEntry[] = [];
        snap.forEach((d) => {
          const data = d.data() as Record<string, unknown>;
          const ts = data.timestamp as { toDate?: () => Date } | undefined;
          rows.push({
            id: d.id,
            action: String(data.action ?? ''),
            actionType: String(data.actionType ?? 'other'),
            description: String(data.description ?? ''),
            timestamp: ts && typeof ts.toDate === 'function' ? ts.toDate() : new Date(0),
            severity: String(data.severity ?? 'low'),
            source: String(data.source ?? 'web'),
            metadata:
              data.metadata && typeof data.metadata === 'object'
                ? (data.metadata as Record<string, unknown>)
                : undefined,
          });
        });
        if (!cancelled) setOverviewActivityLogs(rows);
      } catch (e) {
        console.warn('ProfileOverview: activity logs preview failed', e);
        if (!cancelled) {
          setOverviewActivityLogs([]);
          setOverviewActivityLogsError('Could not load recent activity.');
        }
      } finally {
        if (!cancelled) setOverviewActivityLogsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [uid]);

  const catalogManifestPhase5 = certificationCatalogManifestJson as CertificationCatalogManifestV1;

  useEffect(() => {
    const flagsOn = isCertEngineActionItemsEnabled() || isCertEngineTrustSurfacesEnabled();
    if (!uid || !flagsOn) {
      setCertificationEvaluationRowsProfile(null);
      return;
    }
    let cancelled = false;
    const todayISO = normalizeDateToISODateString(new Date()) ?? '1970-01-01';
    void (async () => {
      try {
        const records = await getCanonicalCertificationRecordsWithIds(uid);
        if (cancelled) return;
        const rows = evaluateCertificationsForRequirements({
          requirements: PREVIEW_SAMPLE_CERTIFICATION_REQUIREMENTS,
          records,
          context: 'generic',
          todayISO,
        });
        setCertificationEvaluationRowsProfile(rows);
      } catch (e) {
        console.warn('ProfileOverview: certification engine rows load failed', e);
        if (!cancelled) setCertificationEvaluationRowsProfile(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [uid]);

  const [workEligibilityData, setWorkEligibilityData] = useState({
    workAuthorized: false,
    requireSponsorship: false,
    gender: undefined as string | undefined,
    veteranStatus: '',
    disabilityStatus: '',
  });

  const [scoreSummaryFromUser, setScoreSummaryFromUser] = useState<ScoreSummary | undefined>(undefined);
  const [recruiterScoreSnapshotFromUser, setRecruiterScoreSnapshotFromUser] = useState<unknown>(undefined);
  const [recruiterMasterScoreFromUser, setRecruiterMasterScoreFromUser] = useState<unknown>(undefined);
  /** First Firestore `users/{uid}` snapshot received — prevents false “interview missing” before scoreSummary hydrates. */
  const [userDocHydratedForActionItems, setUserDocHydratedForActionItems] = useState(false);
  const [riskProfileRaw, setRiskProfileRaw] = useState<unknown>(null);
  const [overviewQualifications, setOverviewQualifications] = useState<OverviewQualificationsData>(() =>
    buildOverviewQualificationsFromUserDoc({}),
  );

  /** Phase 5 — shared engine rows for action items + trust surfaces (preview requirements until tenant-scoped lists ship). */
  const [certificationEvaluationRowsProfile, setCertificationEvaluationRowsProfile] = useState<
    RequirementEvaluationRow[] | null
  >(null);

  // Removed AI insights section

  // Location settings data (read-only)
  const [locationSettings, setLocationSettings] = useState({
    locationSharingEnabled: false,
    locationGranularity: 'disabled' as string,
    lastLocationUpdate: null as Date | null,
  });

  const showRecruiterDeployment =
    viewerSecurityLevel >= 5 && viewerSecurityLevel <= 7 && !isOwnProfile;
  const {
    items: entityEmploymentChipItems,
    loading: entityEmploymentChipsLoading,
    entitySignals: entityEmploymentSignals,
  } = useUserProfileEntityEmploymentChips(
    activeTenantId || tenantId || undefined,
    uid,
    showRecruiterDeployment && Boolean((activeTenantId || tenantId || '').trim()),
  );

  const hasInterviewForActionItems =
    actionItemsHasInterview ??
    ((scoreSummaryFromUser?.interviewCount ?? 0) > 0 ||
      (Boolean(coerceToDate(scoreSummaryFromUser?.interviewLastAt)) &&
        typeof scoreSummaryFromUser?.interviewLastScore10 === 'number' &&
        !Number.isNaN(scoreSummaryFromUser.interviewLastScore10)));

  const backgroundCheckPending = useMemo(() => {
    const orders = actionItemsBackgroundCheckOrders ?? [];
    return orders.some((o) => {
      const s = String(o.status || '').toLowerCase();
      return (
        s === 'pending' ||
        s === 'processing' ||
        s === 'ordered' ||
        s === 'in_progress' ||
        s === 'submitted' ||
        s === 'requested'
      );
    });
  }, [actionItemsBackgroundCheckOrders]);

  const certificationTrustPack = useMemo(() => {
    if (!isCertEngineTrustSurfacesEnabled() || !certificationEvaluationRowsProfile?.length) return null;
    return buildRecruiterCertificationTrustSignals(certificationEvaluationRowsProfile, catalogManifestPhase5);
  }, [certificationEvaluationRowsProfile]);

  const certificationReadinessSummaryCounts = useMemo(() => {
    if (!isCertEngineTrustSurfacesEnabled() || !certificationEvaluationRowsProfile?.length) return null;
    return certificationOperationalSummaryCounts(certificationEvaluationRowsProfile);
  }, [certificationEvaluationRowsProfile]);

  const actionItems = useMemo(
    () =>
      deriveActionItemsV1({
        uid,
        enabled: showRecruiterDeployment,
        phoneVerified,
        phone: (form.phone || '').trim(),
        hasInterview: hasInterviewForActionItems,
        workAuthorized: workEligibilityData.workAuthorized,
        scoreSummary: scoreSummaryFromUser,
        riskProfileRaw,
        entityItems: entityEmploymentChipItems,
        entitySignals: entityEmploymentSignals,
        backgroundCheckOrders: Array.isArray(actionItemsBackgroundCheckOrders) ? actionItemsBackgroundCheckOrders : [],
        certifications: Array.isArray(actionItemsCertifications) ? actionItemsCertifications : [],
        actionSignalsReady: userDocHydratedForActionItems,
        prescreenInterviewAi: actionItemsPrescreenAi ?? null,
        certEngineActionItemsEnabled: isCertEngineActionItemsEnabled(),
        certificationEvaluationRows: certificationEvaluationRowsProfile,
        certificationCatalogManifest: catalogManifestPhase5,
        certificationActionSurface: 'profile',
      }),
    [
      uid,
      showRecruiterDeployment,
      phoneVerified,
      form.phone,
      hasInterviewForActionItems,
      workEligibilityData.workAuthorized,
      scoreSummaryFromUser,
      riskProfileRaw,
      entityEmploymentChipItems,
      entityEmploymentSignals,
      actionItemsBackgroundCheckOrders,
      actionItemsCertifications,
      userDocHydratedForActionItems,
      actionItemsPrescreenAi,
      certificationEvaluationRowsProfile,
    ],
  );

  // Language options for autocomplete
  const languageOptions = [
    'English', 'Spanish', 'French', 'German', 'Italian', 'Portuguese', 'Russian', 'Chinese', 'Japanese', 'Korean',
    'Arabic', 'Hindi', 'Bengali', 'Urdu', 'Turkish', 'Dutch', 'Swedish', 'Norwegian', 'Danish', 'Finnish',
    'Polish', 'Czech', 'Hungarian', 'Romanian', 'Bulgarian', 'Greek', 'Hebrew', 'Thai', 'Vietnamese', 'Tagalog'
  ];

const transportOptions: Array<{
  value: NonNullable<UserProfileForm['transportMethod']>;
  label: string;
  icon: SvgIconComponent;
}> = [
  { value: 'Car', label: 'Car', icon: DirectionsCar },
  { value: 'Public Transit', label: 'Public Transit', icon: DirectionsTransit },
  { value: 'Bike', label: 'Bike', icon: DirectionsBike },
  { value: 'Walk', label: 'Walk', icon: DirectionsWalk },
  { value: 'Other', label: 'Other', icon: MoreHoriz },
];

  // Check if user can edit this profile
  const canEditProfile = () => {
    // Users can always edit their own profile
    if (user?.uid === uid) return true;
    
    // Admins and managers can edit any profile (security level 4 or higher)
    const userLevel = parseInt(securityLevel || '0');
    if (userLevel >= 4) return true;
    
    return false;
  };

  // Check if user can see sensitive sections
  const canSeeSensitiveSections = () => {
    // Admins and managers can see all sections (security level 4 or higher)
    const userLevel = parseInt(securityLevel || '0');
    if (userLevel >= 4) return true;
    
    // Workers can only see basic sections
    return false;
  };

  // AI Insights removed

  // Check if user can reset passwords
  const canResetPassword = () => {
    // Users can reset their own password
    if (user?.uid === uid) return true;
    
    // Admins and managers can reset any password (security level 4 or higher)
    const userLevel = parseInt(securityLevel || '0');
    if (userLevel >= 4) return true;
    
    return false;
  };

  useEffect(() => {
    setUserDocHydratedForActionItems(false);
  }, [uid]);

  useEffect(() => {
    const userRef = doc(db, 'users', uid);
    const unsubscribe =
      onSnapshot(
        userRef,
        async (snapshot) => {
          setUserDocHydratedForActionItems(true);
          if (snapshot.exists()) {
            const data = snapshot.data();
            
            // Get effective tenant ID first (same pattern as UserProfilePage)
            const effectiveTenantId = activeTenant?.id || data.activeTenantId || data.tenantId || activeTenantId;
            
            // Fetch tenant-dependent fields from nested structure first, then fallback to direct fields
            const tenantData = effectiveTenantId && data.tenantIds?.[effectiveTenantId] ? data.tenantIds[effectiveTenantId] : {};
            
            // Convert dates to ISO strings for form inputs (string, Timestamp, or plain { seconds })
            const dobValue = data.dob || data.dateOfBirth;
            const dateOfBirth = normalizeDobToYyyyMmDd(dobValue);
            const startDate = data.startDate ? 
              (data.startDate.toDate ? new Date(data.startDate.toDate()).toISOString().split('T')[0] : 
               typeof data.startDate === 'string' ? data.startDate : 
               new Date(data.startDate).toISOString().split('T')[0]) : '';
            
            const newForm: UserProfileForm = {
              firstName: data.firstName || '',
              lastName: data.lastName || '',
              preferredName: data.preferredName || '',
              email: data.email || '',
              phone: data.phone || (data.phoneE164 ? formatPhoneNumber(data.phoneE164.replace('+1', '')) : ''),
              linkedinUrl: data.linkedinUrl || '',
              dateOfBirth,
              last4SSN: normalizeLast4SsnDigits(data.last4SSN ?? ''),
              gender: data.gender || undefined,
              securityLevel: tenantData.securityLevel || data.securityLevel || '5',
              employmentType: data.employmentType || 'Full-Time',
              departmentId: data.departmentId || '',
              divisionId: data.divisionId || '',
              locationId: data.locationId || '',
              regionId: data.regionId || '',
              managerId: data.managerId || '',
              startDate,
              workStatus: data.workStatus || 'Active',
              workerId: data.workerId || '',
              union: data.union || '',
              workEligibility: data.workEligibility !== false,
              languages: (() => {
                const langs = data.languages || [];
                // Normalize languages - convert objects to strings for the form
                return langs.map((lang: any) => {
                  if (typeof lang === 'string') return lang;
                  if (lang && typeof lang === 'object') {
                    return lang.language || lang.name || String(lang || '');
                  }
                  return String(lang || '');
                }).filter(Boolean);
              })(),
              emergencyContact: data.emergencyContact || undefined,
              transportMethod: data.transportMethod || null,
              addedToIndeedFlex: data.addedToIndeedFlex === true,
              role: data.role || 'Worker',
              jobTitle: data.jobTitle || '',
              department: data.department || '',
              crm_sales: !!data.crm_sales,
              recruiter: !!data.recruiter,
              jobsBoard: !!data.jobsBoard,
            };
            
            setForm(newForm);
            setOriginalForm(newForm);

            setScoreSummaryFromUser(normalizeScoreSummary(data.scoreSummary));
            setRecruiterScoreSnapshotFromUser(data.recruiterScoreSnapshot ?? undefined);
            setRecruiterMasterScoreFromUser(data.recruiterMasterScore ?? undefined);
            setRiskProfileRaw(data.riskProfile ?? null);
            setOverviewQualifications(buildOverviewQualificationsFromUserDoc(data as Record<string, unknown>));

            // Load Work Eligibility data
            setWorkEligibilityData({
              workAuthorized: data.workEligibility !== false,
              requireSponsorship: !!data.requireSponsorship,
              gender: data.gender || undefined,
              veteranStatus: data.veteranStatus || '',
              disabilityStatus: data.disabilityStatus || '',
            });

            // Set phone verification status
            setPhoneVerified(data.phoneVerified === true);

            // AI insights removed
            
            // Load location settings data
            setLocationSettings({
              locationSharingEnabled: data.locationSettings?.locationSharingEnabled || false,
              locationGranularity: data.locationSettings?.locationGranularity || 'disabled',
              lastLocationUpdate: data.locationSettings?.lastLocationUpdate?.toDate ? data.locationSettings.lastLocationUpdate.toDate() : 
                (data.locationSettings?.lastLocationUpdate ? new Date(data.locationSettings.lastLocationUpdate) : null),
            });
            
            // Load addressInfo - check multiple possible locations for address data
            const addressInfoData = data.addressInfo || {};
            const addressData = data.address || {};
            const coordinatesData = addressData.coordinates || {};
            
            // Merge addressInfo with fallbacks from address.coordinates
            setAddressInfo({
              streetAddress: addressInfoData.streetAddress || addressData.street || '',
              unitNumber: addressInfoData.unitNumber || addressData.unit || '',
              city: addressInfoData.city || addressData.city || data.city || '',
              state: addressInfoData.state || addressData.state || data.state || '',
              zip: addressInfoData.zip || addressInfoData.zipCode || addressData.zipCode || addressData.zip || '',
              homeLat: addressInfoData.homeLat ?? coordinatesData.lat ?? null,
              homeLng: addressInfoData.homeLng ?? coordinatesData.lng ?? null,
              workLat: addressInfoData.workLat ?? null,
              workLng: addressInfoData.workLng ?? null,
              currentLat: addressInfoData.currentLat ?? null,
              currentLng: addressInfoData.currentLng ?? null,
            });

            // Populate system access info: prefer lastActiveAt, fallback to lastLoginAt
            const lastActiveAt = coerceToDate(data.lastActiveAt);
            const lastLoginAt = coerceToDate(data.lastLoginAt);
            setSystemAccess({
              loginCount: typeof data.loginCount === 'number' ? data.loginCount : null,
              lastLoginAt: lastActiveAt || lastLoginAt,
              lastActiveAt,
              uid,
            });
          }
        },
        (error) => {
          console.error('Error fetching user data:', error);
        },
      );

    return () => unsubscribe();
  }, [uid]);

  // Load tenant data when activeTenantId changes
  useEffect(() => {
    if (activeTenantId) {
      setTenantId(activeTenantId);
      loadTenantData(activeTenantId);
    }
  }, [activeTenantId]);

  const loadTenantData = async (tenantId: string) => {
    try {
      console.log('Loading tenant data for tenantId:', tenantId);
      
      // Use tenant name from activeTenant if available, otherwise use tenantId as fallback
      if (activeTenant?.name) {
        setTenantName(activeTenant.name);
        setCustomerName(activeTenant.name);
      } else {
        setTenantName(tenantId);
        setCustomerName(tenantId);
      }
      
      // Fetch departments with error handling
      try {
        const deptQuery = collection(db, 'tenants', tenantId, 'departments');
        const deptSnap = await getDocs(deptQuery);
        const deptData = deptSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        console.log('Fetched departments:', deptData);
        setDepartments(deptData);
      } catch (deptError) {
        console.warn('Could not fetch departments:', deptError);
        setDepartments([]);
      }
      
      // Fetch divisions with error handling
      try {
        const divQuery = collection(db, 'tenants', tenantId, 'divisions');
        const divSnap = await getDocs(divQuery);
        const divData = divSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        console.log('Fetched divisions:', divData);
        setDivisions(divData);
      } catch (divError) {
        console.warn('Could not fetch divisions:', divError);
        setDivisions([]);
      }
      
      // Fetch regions with error handling
      try {
        const regionQuery = collection(db, 'tenants', tenantId, 'regions');
        const regionSnap = await getDocs(regionQuery);
        const regionData = regionSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        console.log('Fetched regions:', regionData);
        setRegions(regionData);
      } catch (regionError) {
        console.warn('Could not fetch regions:', regionError);
        setRegions([]);
      }
      
      // Fetch locations with error handling
      try {
        const locQuery = collection(db, 'tenants', tenantId, 'locations');
        const locSnap = await getDocs(locQuery);
        const locData = locSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        console.log('Fetched locations:', locData);
        setLocations(locData);
      } catch (locError) {
        console.warn('Could not fetch locations:', locError);
        setLocations([]);
      }
      
      // Fetch managers with error handling
      try {
        const usersQuery = query(
          collection(db, 'users'),
          where('tenantId', '==', tenantId),
          where('securityLevel', 'in', ['5', '6', '7'])
        );
        const usersSnap = await getDocs(usersQuery);
        const managerData = usersSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        console.log('Fetched managers:', managerData);
        setManagers(managerData);
      } catch (managerError) {
        console.warn('Could not fetch managers:', managerError);
        setManagers([]);
      }
      
      
    } catch (error) {
      console.error('Error loading tenant data:', error);
      // Set empty arrays as fallbacks
      setDepartments([]);
      setDivisions([]);
      setRegions([]);
      setLocations([]);
      setManagers([]);
    }
  };

  // Load user groups only when viewer is allowed to see them
  useEffect(() => {
    if (!canViewUserGroupsSection) return;
    if (tenantId && uid) {
      loadUserGroups(tenantId);
    }
  }, [tenantId, uid, canViewUserGroupsSection]);

  const loadUserGroups = async (tenantId: string) => {
    try {
      // Fetch user groups
      const gq = collection(db, 'tenants', tenantId, 'userGroups');
      const gSnap = await getDocs(gq);
      const groupData = gSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      setUserGroups(groupData);

      // Fetch current user's group memberships
      const userRef = doc(db, 'users', uid);
      const userSnap = await getDoc(userRef);
      if (userSnap.exists()) {
        const userData = userSnap.data();
        setUserGroupIds(userData.userGroupIds || []);
      }
    } catch (error) {
      console.error('Error loading user groups:', error);
      setUserGroups([]);
    }
  };

  const handleUserGroupsChange = (event: any, newValue: any[]) => {
    const newGroupIds = newValue.map((group: any) => group.id);
    setUserGroupIds(newGroupIds);
    
    // Persist to Firestore
    const userRef = doc(db, 'users', uid);
    updateDoc(userRef, { 
      userGroupIds: newGroupIds,
      updatedAt: new Date()
    }).catch((error) => {
      console.error('Error updating user groups:', error);
    });
  };

  const handleAddressChange = async (updatedAddressInfo: any) => {
    setAddressInfo(updatedAddressInfo);
    const userRef = doc(db, 'users', uid);
    
    // Only update addressInfo - this is now the single source of truth for address data
    await updateDoc(userRef, { 
      addressInfo: updatedAddressInfo
    });
  };

  const formFieldsChanged = JSON.stringify(form) !== JSON.stringify(originalForm);
  const hasChanges =
    formFieldsChanged ||
    (embeddedMode === 'quickProfileOnly' && quickProfileAddressDirty);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    // Functional update avoids stale `form` — without this, phone (and other fields) can "snap back" while typing.
    setForm((prev) =>
      name === 'last4SSN'
        ? { ...prev, last4SSN: normalizeLast4SsnDigits(value) }
        : { ...prev, [name]: value },
    );
  };

  const handleSelectChange = (e: any) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    // Persist Employment Details fields immediately
    const employmentFields = new Set([
      'jobTitle',
      'securityLevel',
      'employmentType',
      'departmentId',
      'divisionId',
      'locationId',
      'regionId',
      'managerId',
      'startDate',
      'workStatus',
      // Also persist identity select fields
      'gender',
      'transportMethod',
    ]);
    if (employmentFields.has(name)) {
      persistEmploymentField(name, value);
    }
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    if (name === 'phone') {
      const formatted = formatPhoneNumber(value);
      setForm((prev) => ({ ...prev, phone: formatted }));
      persistProfileField('phone', formatted);
    }
    // Persist text inputs in Employment Details on blur
    const employmentTextFields = new Set(['jobTitle', 'workerId', 'union']);
    if (employmentTextFields.has(name)) {
      persistEmploymentField(name, value);
    }
    // Persist Basic Identity text fields on blur
    const identityTextFields = new Set(['firstName', 'lastName', 'preferredName', 'email', 'last4SSN']);
    if (identityTextFields.has(name)) {
      persistProfileField(name, name === 'last4SSN' ? normalizeLast4SsnDigits(value) : value);
    }
  };


  const handleLanguagesChange = (event: any, newValue: string[]) => {
    setForm((prev) => ({ ...prev, languages: newValue }));
    persistProfileField('languages', newValue);
  };

  const handleEmergencyContactChange = (field: keyof EmergencyContact, value: string) => {
    setForm((prev) => {
      const updatedEmergencyContact = {
        ...prev.emergencyContact,
        [field]: value,
      } as EmergencyContact;
      void persistProfileField('emergencyContact', updatedEmergencyContact);
      return { ...prev, emergencyContact: updatedEmergencyContact };
    });
  };

  // Persist a single Employment Details field to Firestore immediately
  const persistEmploymentField = async (field: string, value: any) => {
    try {
      const userRef = doc(db, 'users', uid);
      let toSave: any = value;
      const normalizeDateOnlyToYmd = (v: any): string | null => {
        if (!v) return null;
        if (typeof v === 'string') {
          const s = v.trim();
          if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
          if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) {
            const [mm, dd, yyyy] = s.split('/');
            return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
          }
          // Fall back: try to parse and format in UTC to preserve calendar day
          const d = new Date(s);
          if (!isNaN(d.getTime())) {
            const yyyy = d.getUTCFullYear();
            const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
            const dd = String(d.getUTCDate()).padStart(2, '0');
            return `${yyyy}-${mm}-${dd}`;
          }
          return null;
        }
        if (typeof v?.toDate === 'function') {
          const d = v.toDate();
          const yyyy = d.getUTCFullYear();
          const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
          const dd = String(d.getUTCDate()).padStart(2, '0');
          return `${yyyy}-${mm}-${dd}`;
        }
        if (v instanceof Date) {
          const yyyy = v.getUTCFullYear();
          const mm = String(v.getUTCMonth() + 1).padStart(2, '0');
          const dd = String(v.getUTCDate()).padStart(2, '0');
          return `${yyyy}-${mm}-${dd}`;
        }
        return null;
      };

      // Date-only fields: store as YYYY-MM-DD strings (avoid timezone shifts)
      if (field === 'startDate' || field === 'dateOfBirth') {
        toSave = normalizeDateOnlyToYmd(value);
      }
      
      // List of tenant-dependent fields that need to be stored in nested tenantIds structure
      const tenantDependentFields = [
        'securityLevel', 'regionId', 'jobTitle', 'workStatus', 'employmentType', 
        'departmentId', 'divisionId', 'managerId', 'startDate', 'workerId', 'locationId'
      ];
      
      // Special handling for tenant-dependent fields - update nested tenantIds
      if (tenantDependentFields.includes(field) && activeTenantId) {
        // Get current user document to access tenantIds
        const userDoc = await getDoc(userRef);
        const userData = userDoc.data();
        
        if (userData?.tenantIds?.[activeTenantId]) {
          // Prepare update data with both direct field and nested field
          const updateData: any = { 
            [field]: toSave,
            [`tenantIds.${activeTenantId}.${field}`]: toSave,
            updatedAt: new Date() 
          };
          
          // Clean up old field names to prevent duplication
          const fieldMappings: { [key: string]: string } = {
            'departmentId': 'department',
            'regionId': 'region'
          };
          
          if (fieldMappings[field]) {
            // Remove the old field name from the nested structure
            updateData[`tenantIds.${activeTenantId}.${fieldMappings[field]}`] = null;
            console.log(`🧹 Cleaning up old field: tenantIds.${activeTenantId}.${fieldMappings[field]}`);
          }
          
          await updateDoc(userRef, updateData);
          console.log(`✅ Updated ${field} to ${toSave} in both direct field and tenantIds.${activeTenantId}.${field}`);
        } else {
          // Fallback: just update direct field if tenantIds structure is missing
          await updateDoc(userRef, { [field]: toSave, updatedAt: new Date() });
          console.log(`⚠️ Updated ${field} to ${toSave} in direct field only (tenantIds structure missing)`);
        }
      } else {
        // Normal field update (for non-tenant-dependent fields)
        await updateDoc(userRef, { [field]: toSave, updatedAt: new Date() });
      }
    } catch (err) {
      console.error('Error updating field', field, err);
    }
  };

  const handleTransportMethodToggle = (optionValue: NonNullable<UserProfileForm['transportMethod']>) => {
    setForm((prev) => {
      const nextValue = prev.transportMethod === optionValue ? undefined : optionValue;
      persistEmploymentField('transportMethod', nextValue || '');
      return { ...prev, transportMethod: nextValue };
    });
  };

  // Generic alias for non-employment fields
  const persistProfileField = async (field: string, value: any) => {
    // Phone: compare by digits (not display string) and always persist formatted display + E.164 when valid.
    // Previous logic only wrote when `currentPhone !== newPhone`, so same digits with different formatting
    // or missing `phoneE164` could fail to save; stale `handleChange` closures also made the field "not stick".
    if (field === 'phone') {
      try {
        const userRef = doc(db, 'users', uid);
        const userDoc = await getDoc(userRef);
        const currentData = userDoc.data() || {};

        const last10 = (raw: string) => {
          const d = String(raw || '').replace(/\D/g, '');
          if (d.length >= 11 && d.startsWith('1')) return d.slice(-10);
          if (d.length >= 10) return d.slice(-10);
          return d;
        };

        const trimmed = String(value ?? '').trim();
        if (!trimmed) {
          await updateDoc(userRef, {
            phone: '',
            phoneE164: null,
            phoneVerified: false,
            workEligibility: false,
            updatedAt: new Date(),
          });
          setPhoneVerified(false);
          return;
        }

        const display = formatPhoneNumber(trimmed);
        const core10 = last10(display);
        const prev10 =
          last10(String(currentData.phone || '')) || last10(String(currentData.phoneE164 || '').replace(/^\+/, ''));

        const updates: Record<string, unknown> = {
          phone: display || trimmed,
          updatedAt: new Date(),
        };
        if (core10.length === 10) {
          updates.phoneE164 = `+1${core10}`;
        }
        const digitsChanged = core10.length === 10 && core10 !== prev10;
        if (digitsChanged) {
          updates.phoneVerified = false;
          updates.workEligibility = false;
        }
        await updateDoc(userRef, updates);
        if (digitsChanged) setPhoneVerified(false);
        return;
      } catch (error) {
        console.error('Error handling phone change:', error);
        return;
      }
    }

    if (field === 'last4SSN') {
      try {
        const userRef = doc(db, 'users', uid);
        const digits = normalizeLast4SsnDigits(value);
        if (digits.length === 4) {
          await updateDoc(userRef, { last4SSN: digits, updatedAt: new Date() });
        } else if (digits.length === 0) {
          await updateDoc(userRef, { last4SSN: null, updatedAt: new Date() });
        }
      } catch (error) {
        console.error('Error updating last4SSN', error);
      }
      return;
    }

    await persistEmploymentField(field, value);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const userRef = doc(db, 'users', uid);
      
      // Convert form data back to proper format for Firestore
      // Filter out undefined values to prevent Firestore errors
      const cleanForm = Object.fromEntries(
        Object.entries(form).filter(
          ([key, value]) => key !== 'last4SSN' && value !== undefined,
        ),
      );

      const last4Digits = normalizeLast4SsnDigits(form.last4SSN);
      const last4Payload =
        last4Digits.length === 4 ? last4Digits : last4Digits.length === 0 ? null : undefined;

      const updateData = {
        ...cleanForm,
        // Store as date-only strings to avoid timezone day-shifts
        dob: form.dateOfBirth || null, // Standard field name
        dateOfBirth: form.dateOfBirth || null, // Backward compatibility: keep same value (string)
        startDate: form.startDate || null,
        ...(last4Payload !== undefined ? { last4SSN: last4Payload } : {}),
        updatedAt: new Date()
      };
      
      // Remove null values as well to prevent Firestore errors
      const finalUpdateData = Object.fromEntries(
        Object.entries(updateData).filter(([key, value]) => {
          // Filter out null, undefined, and empty strings for optional fields
          if (value === null || value === undefined) {
            if (key === 'last4SSN' && last4Payload === null) return true;
            return false;
          }
          if (typeof value === 'string' && value === '' && ['preferredName', 'divisionId', 'locationId', 'managerId', 'workerId', 'union', 'jobTitle', 'department'].includes(key)) return false;
          
          // Handle emergencyContact object - only include if it has valid data
          if (key === 'emergencyContact') {
            if (!value || typeof value !== 'object') return false;
            const contact = value as any;
            // Only include if at least one field has a non-empty value
            return contact.name?.trim() || contact.relationship?.trim() || contact.phone?.trim();
          }
          
          // Handle gender field - only include if it has a valid value
          if (key === 'gender') {
            return value && typeof value === 'string' && value !== '' && value !== 'undefined';
          }
          
          return true;
        })
      );
      
      console.log('Submitting update data:', finalUpdateData);

      if (embeddedMode === 'quickProfileOnly' && quickProfileAddressFormRef.current) {
        const addressPayload = await quickProfileAddressFormRef.current.prepareAddressForSubmit();
        await updateDoc(userRef, { ...finalUpdateData, addressInfo: addressPayload });
        quickProfileAddressFormRef.current.markSaved();
        setQuickProfileAddressMapPreview(null);
      } else {
        await updateDoc(userRef, finalUpdateData);
      }

      await persistScoreSummaryFromProfile(uid).catch((err) =>
        console.warn('ProfileOverview: persist scoreSummary failed', err)
      );

      // Log the profile update activity
      const changes = {
        formChanges: Object.keys(form).reduce((acc, key) => {
          if (form[key as keyof typeof form] !== originalForm[key as keyof typeof originalForm]) {
            acc[key] = {
              old: originalForm[key as keyof typeof originalForm],
              new: form[key as keyof typeof form]
            };
          }
          return acc;
        }, {} as any)
      };
      
      await logProfileUpdateActivity(uid, changes);
      
      setMessage('Profile updated successfully');
      setShowToast(true);
      setOriginalForm(form);
    } catch (error) {
      console.error('Error updating user data:', error);
      setMessage('Failed to update profile');
      setShowToast(true);
    }
  };

  const handleResetPassword = async () => {
    if (!form.email) {
      setMessage('Email address is required to reset password');
      setShowToast(true);
      return;
    }

    setResetPasswordLoading(true);
    try {
      await sendPasswordResetEmail(auth, form.email);
      
      // Log the password reset activity
      await logSecurityChangeActivity(
        uid,
        'password_reset_requested',
        'Password reset email requested',
        { email: form.email }
      );
      
      setMessage('Password reset email sent successfully');
      setShowToast(true);
      setResetPasswordDialogOpen(false);
    } catch (error: any) {
      console.error('Error sending password reset email:', error);
      let errorMessage = 'Failed to send password reset email';
      
      // Handle specific Firebase Auth errors
      if (error.code === 'auth/user-not-found') {
        errorMessage = 'No user found with this email address';
      } else if (error.code === 'auth/invalid-email') {
        errorMessage = 'Invalid email address';
      } else if (error.code === 'auth/too-many-requests') {
        errorMessage = 'Too many password reset attempts. Please try again later';
      }
      
      setMessage(errorMessage);
      setShowToast(true);
    } finally {
      setResetPasswordLoading(false);
    }
  };

  const hideNonQuickSections = embeddedMode === 'quickProfileOnly';

  return (
    <Box
      sx={{
        p: 0,
        ...(hideNonQuickSections
          ? { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }
          : {}),
      }}
    >
      <Box
        component="form"
        onSubmit={handleSubmit}
        noValidate
        sx={
          hideNonQuickSections
            ? { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }
            : {}
        }
      >
        <Box
          sx={
            hideNonQuickSections
              ? { flex: 1, minHeight: 0, overflow: 'auto', pr: 0.5 }
              : {}
          }
        >
        <Grid container spacing={sectionSpacing} sx={{ alignItems: 'stretch', pb: 2 }}>
          {/* Section 1: Action items (recruiter overview) */}
          {showRecruiterDeployment && !hideNonQuickSections && (
            <Grid item xs={12}>
              <OverviewActionItemsCard
                items={actionItems}
                loading={entityEmploymentChipsLoading || !userDocHydratedForActionItems}
                onNavigateCta={
                  onTabChange
                    ? (item: ActionItem) => {
                        const t = item.ctaTarget;
                        if (t.kind === 'profileTab') onTabChange(t.tab);
                        else if (t.kind === 'anchor') onTabChange(t.tab ?? 'Employment');
                        else if (t.kind === 'route') window.location.assign(t.path);
                      }
                    : undefined
                }
              />
            </Grid>
          )}

          {/* Standalone Location card removed — address + map live in the Quick profile & location card (right column). */}

          {/* Quick profile & location: hidden on Overview tab; still rendered for quick-profile modal (`embeddedMode === 'quickProfileOnly'`). */}
          {embeddedMode === 'quickProfileOnly' && (
          <Grid item xs={12}>
            <Box
              id="home-address"
              ref={homeAddressRef}
              sx={{ width: '100%' }}
            >
                {/* Missing Items Alerts for Basic Identity */}
                {!isEditingBasicIdentity && (
                  <Box sx={{ mb: 2 }}>
                    {!hasValidDateOfBirth(form.dateOfBirth) && (
                      <Alert 
                        severity="warning" 
                        sx={{ mb: 1 }}
                        action={
                          <Button 
                            size="small" 
                            onClick={() => setIsEditingBasicIdentity(true)}
                            color="inherit"
                          >
                            Add
                          </Button>
                        }
                      >
                        Missing Date of Birth
                      </Alert>
                    )}
                    {!form.phone && (
                      <Alert 
                        severity="warning" 
                        sx={{ mb: 1 }}
                        action={
                          <Button 
                            size="small" 
                            onClick={() => setIsEditingBasicIdentity(true)}
                            color="inherit"
                          >
                            Add
                          </Button>
                        }
                      >
                        Missing Phone Number
                      </Alert>
                    )}
                    {isStaffSelfProfile && normalizeLast4SsnDigits(form.last4SSN).length !== 4 && (
                      <Alert
                        severity="info"
                        sx={{ mb: 1 }}
                        action={
                          <Button
                            size="small"
                            onClick={() => setIsEditingBasicIdentity(true)}
                            color="inherit"
                          >
                            Add
                          </Button>
                        }
                      >
                        Last 4 of SSN or ITIN is not on file. Add it next to your phone number if you choose (optional).
                      </Alert>
                    )}
                  </Box>
                )}
                {isEditingBasicIdentity ? (
                  // Edit Mode - Show Input Fields
                  <Grid container spacing={2}>
                    {/* Left Column */}
                    <Grid item xs={12} sm={6}>
                      <Grid container spacing={2}>
                        <Grid item xs={12}>
                          <TextField
                            fullWidth
                            required
                            name="firstName"
                            label="First Name"
                            value={form.firstName}
                            onChange={handleChange}
                            onBlur={handleBlur}
                            size="small"
                          />
                        </Grid>
                        <Grid item xs={12}>
                          <TextField
                            fullWidth
                            required
                            name="lastName"
                            label="Last Name"
                            value={form.lastName}
                            onChange={handleChange}
                            onBlur={handleBlur}
                            size="small"
                          />
                        </Grid>
                        <Grid item xs={12}>
                          <TextField
                            fullWidth
                            name="preferredName"
                            label="Preferred Name"
                            value={form.preferredName}
                            onChange={handleChange}
                            onBlur={handleBlur}
                            helperText="Shown in Companion/chat and dashboards"
                            size="small"
                          />
                        </Grid>
                        <Grid item xs={12} sm={6}>
                          <TextField
                            fullWidth
                            required
                            name="phone"
                            label="Phone"
                            value={form.phone}
                            onChange={handleChange}
                            onBlur={handleBlur}
                            InputProps={{
                              endAdornment: phoneVerified ? (
                                <InputAdornment position="end">
                                  <CheckCircleIcon color="success" fontSize="small" titleAccess="Phone Verified" />
                                </InputAdornment>
                              ) : null
                            }}
                            helperText={phoneVerified ? "Verified" : ""}
                            size="small"
                          />
                        </Grid>
                        <Grid item xs={12} sm={6}>
                          <TextField
                            fullWidth
                            name="last4SSN"
                            label="Last 4 of SSN or ITIN"
                            inputMode="numeric"
                            autoComplete="off"
                            value={form.last4SSN || ''}
                            onChange={handleChange}
                            onBlur={handleBlur}
                            helperText="Optional. Last four digits of SSN or ITIN."
                            size="small"
                            inputProps={{ maxLength: 4 }}
                          />
                        </Grid>
                        <Grid item xs={12}>
                          <TextField
                            fullWidth
                            required
                            name="email"
                            label="Email"
                            type="email"
                            value={form.email}
                            onChange={handleChange}
                            onBlur={handleBlur}
                            size="small"
                          />
                        </Grid>
                        <Grid item xs={12}>
                          <TextField
                            fullWidth
                            name="dateOfBirth"
                            label="Date of Birth"
                            type="date"
                            required
                            value={form.dateOfBirth}
                            onChange={(e) => {
                              handleChange(e as any);
                              persistProfileField('dateOfBirth', (e.target as HTMLInputElement).value);
                            }}
                            InputLabelProps={{ shrink: true }}
                            helperText="Used for EEO reporting or validation"
                            size="small"
                          />
                        </Grid>
                      </Grid>
                    </Grid>
                    
                    {/* Right Column */}
                    <Grid item xs={12} sm={6}>
                      <Grid container spacing={2}>
                        <Grid item xs={12}>
                          <TextField
                            fullWidth
                            name="linkedinUrl"
                            label="LinkedIn URL"
                            value={form.linkedinUrl || ''}
                            onChange={handleChange}
                            onBlur={(e) => persistProfileField('linkedinUrl', e.target.value)}
                            size="small"
                          />
                        </Grid>
                        <Grid item xs={12}>
                          <Autocomplete
                            multiple
                            options={languageOptions}
                            value={(() => {
                              const langs = form.languages || [];
                              // Normalize to strings - handle both string and object formats
                              return langs.map((lang: any) => {
                                if (typeof lang === 'string') return lang;
                                if (lang && typeof lang === 'object') {
                                  return lang.language || lang.name || String(lang || '');
                                }
                                return String(lang || '');
                              }).filter(Boolean);
                            })()}
                            onChange={handleLanguagesChange}
                            getOptionLabel={(option: string) => option}
                            size="small"
                            renderInput={(params) => (
                              <TextField {...params} label="Languages" placeholder="Select languages" />
                            )}
                            renderTags={(value: string[], getTagProps) =>
                              value.map((option: string, index: number) => (
                                <Chip 
                                  label={toChipLabel(option)} 
                                  {...getTagProps({ index })} 
                                  key={toChipLabel(option) || index} 
                                />
                              ))
                            }
                          />
                        </Grid>
                        <Grid item xs={12}>
                          <TextField
                            fullWidth
                            name="emergencyContactName"
                            label="Emergency Contact Name"
                            value={form.emergencyContact?.name || ''}
                            onChange={(e) => handleEmergencyContactChange('name', e.target.value)}
                            size="small"
                          />
                        </Grid>
                        <Grid item xs={12}>
                          <TextField
                            fullWidth
                            name="emergencyContactRelationship"
                            label="Relationship"
                            value={form.emergencyContact?.relationship || ''}
                            onChange={(e) => handleEmergencyContactChange('relationship', e.target.value)}
                            size="small"
                          />
                        </Grid>
                        <Grid item xs={12}>
                          <TextField
                            fullWidth
                            name="emergencyContactPhone"
                            label="Emergency Contact Phone"
                            value={form.emergencyContact?.phone || ''}
                            onChange={(e) => handleEmergencyContactChange('phone', e.target.value)}
                            size="small"
                          />
                        </Grid>
                        <Grid item xs={12}>
                          <Box>
                            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                              How will you get to work?
                            </Typography>
                            <Stack direction="row" spacing={1} flexWrap="wrap">
                              {transportOptions.map((option) => {
                                const Icon = option.icon;
                                const isSelected = form.transportMethod === option.value;
                                return (
                                  <Chip
                                    key={option.value}
                                    icon={<Icon fontSize="small" />}
                                    label={option.label}
                                    onClick={() => handleTransportMethodToggle(option.value)}
                                    color={isSelected ? 'primary' : 'default'}
                                    variant={isSelected ? 'filled' : 'outlined'}
                                    sx={{
                                      borderRadius: '999px',
                                      px: 1.5,
                                      height: 36,
                                      fontWeight: isSelected ? 600 : 500,
                                      mt: 0.5
                                    }}
                                  />
                                );
                              })}
                            </Stack>
                          </Box>
                        </Grid>
                      </Grid>
                    </Grid>
                    {embeddedMode === 'quickProfileOnly' && (
                      <Grid item xs={12}>
                        <Typography
                          {...overviewSubsectionHeadingTypographyProps}
                          sx={{ ...overviewSubsectionHeadingTypographyProps.sx, mt: 1 }}
                        >
                          Home address
                        </Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                          Search for your street address to fill city, state, and ZIP. You can edit
                          details below if needed.
                        </Typography>
                        <AddressFormFields
                          ref={quickProfileAddressFormRef}
                          uid={uid}
                          formData={addressInfo}
                          onFormChange={noopAddressPersist}
                          hideActions
                          onDirtyChange={setQuickProfileAddressDirty}
                          onDraftChange={setQuickProfileAddressMapPreview}
                        />
                        <Box sx={{ mt: 1.5, borderRadius: 1, overflow: 'hidden', border: '1px solid', borderColor: 'divider' }}>
                          <MapWithMarkers
                            homeLat={quickProfileMapCoords.homeLat as number | null | undefined}
                            homeLng={quickProfileMapCoords.homeLng as number | null | undefined}
                            workLat={quickProfileMapCoords.workLat as number | null | undefined}
                            workLng={quickProfileMapCoords.workLng as number | null | undefined}
                            currentLat={quickProfileMapCoords.currentLat as number | null | undefined}
                            currentLng={quickProfileMapCoords.currentLng as number | null | undefined}
                            mapHeightPx={240}
                            dense
                          />
                        </Box>
                      </Grid>
                    )}
                  </Grid>
                ) : (
                  (() => {
                    const showQuickProfileMiddleColumn =
                      Boolean(form.email) ||
                      Boolean(form.transportMethod) ||
                      normalizeLast4SsnDigits(form.last4SSN).length === 4 ||
                      isStaffSelfProfile;
                    const quickColSpan = showQuickProfileMiddleColumn ? 4 : 6;
                    const overviewMapHeightPx = 240; // ~40% shorter than default 400px map
                    return (
                  <Grid container spacing={1.5}>
                    <Grid item xs={12} md={quickColSpan}>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    {/* Personal Information Section */}
                    <Box>
                      <Typography
                        {...overviewSubsectionHeadingTypographyProps}
                        sx={{ ...overviewSubsectionHeadingTypographyProps.sx, fontWeight: 700 }}
                      >
                        Contact & identity
                      </Typography>
                      <Grid container spacing={1.25}>
                        {(form.firstName || form.lastName) && (
                          <Grid item xs={12} sm={6}>
                            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                              <PersonIcon sx={{ fontSize: 18, color: 'text.secondary', mt: 0.5, flexShrink: 0 }} />
                              <Box sx={{ flex: 1, minWidth: 0 }}>
                                <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', fontWeight: 500 }}>
                                  Full Name
                                </Typography>
                                <Typography variant="body2" sx={{ ...overviewProfileFieldValueSx, mt: 0.25 }}>
                                  {`${form.firstName || ''} ${form.lastName || ''}`.trim() || '-'}
                                </Typography>
                              </Box>
                            </Box>
                          </Grid>
                        )}
                        
                        {form.preferredName && (
                          <Grid item xs={12} sm={6}>
                            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                              <AccountBoxIcon sx={{ fontSize: 18, color: 'text.secondary', mt: 0.5, flexShrink: 0 }} />
                              <Box sx={{ flex: 1, minWidth: 0 }}>
                                <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', fontWeight: 500 }}>
                                  Preferred Name
                                </Typography>
                                <Typography variant="body2" sx={{ ...overviewProfileFieldValueSx, mt: 0.25 }}>
                                  {form.preferredName}
                                </Typography>
                              </Box>
                            </Box>
                          </Grid>
                        )}
                        
                        {form.phone && !showRecruiterDeployment && (
                          <Grid item xs={12} sm={6}>
                            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                              <PhoneIcon sx={{ fontSize: 18, color: 'text.secondary', mt: 0.5, flexShrink: 0 }} />
                              <Box sx={{ flex: 1, minWidth: 0 }}>
                                <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', fontWeight: 500 }}>
                                  Phone
                                </Typography>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.25 }}>
                                  <Typography variant="body2" sx={overviewProfileFieldValueSx}>
                                    {formatPhoneNumber(form.phone) || form.phone}
                                  </Typography>
                                  {phoneVerified && (
                                    <CheckCircleIcon color="success" fontSize="small" titleAccess="Phone Verified" />
                                  )}
                                  <Tooltip title="Copy phone number">
                                    <IconButton
                                      size="small"
                                      onClick={async () => {
                                        try {
                                          const phoneToCopy = formatPhoneNumber(form.phone) || form.phone;
                                          await navigator.clipboard.writeText(phoneToCopy);
                                          setMessage('Phone number copied to clipboard');
                                          setShowToast(true);
                                        } catch (err) {
                                          console.error('Failed to copy phone number:', err);
                                          setMessage('Failed to copy phone number');
                                          setShowToast(true);
                                        }
                                      }}
                                      sx={{ 
                                        p: 0.5,
                                        color: 'text.secondary',
                                        '&:hover': {
                                          color: 'primary.main',
                                          bgcolor: 'action.hover'
                                        }
                                      }}
                                    >
                                      <ContentCopyIcon sx={{ fontSize: 16 }} />
                                    </IconButton>
                                  </Tooltip>
                                </Box>
                              </Box>
                            </Box>
                          </Grid>
                        )}

                        {form.dateOfBirth && (
                          <Grid item xs={12} sm={6}>
                            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                              <CalendarIcon sx={{ fontSize: 18, color: 'text.secondary', mt: 0.5, flexShrink: 0 }} />
                              <Box sx={{ flex: 1, minWidth: 0 }}>
                                <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', fontWeight: 500 }}>
                                  Date of Birth
                                </Typography>
                                <Typography variant="body2" sx={{ ...overviewProfileFieldValueSx, mt: 0.25 }}>
                                  {formatDateOnlyForDisplay(form.dateOfBirth)}
                                </Typography>
                              </Box>
                            </Box>
                          </Grid>
                        )}
                      </Grid>
                    </Box>

                    {/* Additional Information Section */}
                    {(form.linkedinUrl || (form.languages && form.languages.length > 0)) && (
                      <Box>
                        <Typography {...overviewSubsectionHeadingTypographyProps}>
                          Additional information
                        </Typography>
                        <Grid container spacing={2}>
                          {form.linkedinUrl && (
                            <Grid item xs={12} sm={6}>
                              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                                <LanguageIcon sx={{ fontSize: 18, color: 'text.secondary', mt: 0.5, flexShrink: 0 }} />
                                <Box sx={{ flex: 1, minWidth: 0 }}>
                                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', fontWeight: 500 }}>
                                    LinkedIn
                                  </Typography>
                                  <Typography variant="body2" component="span" sx={{ ...overviewProfileFieldValueSx, mt: 0.25 }}>
                                    <MUILink 
                                      href={form.linkedinUrl.startsWith('http') ? form.linkedinUrl : `https://${form.linkedinUrl}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      color="primary"
                                      underline="hover"
                                      sx={{ wordBreak: 'break-all', fontSize: 'inherit', lineHeight: 'inherit' }}
                                    >
                                      {form.linkedinUrl}
                                    </MUILink>
                                  </Typography>
                                </Box>
                              </Box>
                            </Grid>
                          )}
                          
                          {form.languages && form.languages.length > 0 && (
                            <Grid item xs={12}>
                              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                                <LanguageIcon sx={{ fontSize: 18, color: 'text.secondary', mt: 0.5, flexShrink: 0 }} />
                                <Box sx={{ flex: 1, minWidth: 0 }}>
                                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', fontWeight: 500, mb: 0.5, display: 'block' }}>
                                    Languages
                                  </Typography>
                                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mt: 0.25 }}>
                                    {form.languages.map((lang: any, index: number) => {
                                      // Handle both string and object formats
                                      const languageName = typeof lang === 'string' 
                                        ? lang 
                                        : (lang?.language || lang?.name || 'Unknown');
                                      return (
                                        <Chip 
                                          key={index}
                                          label={languageName} 
                                          size="small" 
                                          variant="outlined"
                                        />
                                      );
                                    })}
                                  </Box>
                                </Box>
                              </Box>
                            </Grid>
                          )}
                        </Grid>
                      </Box>
                    )}

                    {/* Emergency Contact Section */}
                    {(form.emergencyContact?.name || form.emergencyContact?.phone) && (
                      <Box>
                        <Typography {...overviewSubsectionHeadingTypographyProps}>
                          Emergency contact
                        </Typography>
                        <Grid container spacing={2}>
                          {form.emergencyContact?.name && (
                            <Grid item xs={12} sm={6}>
                              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                                <EmergencyIcon sx={{ fontSize: 18, color: 'text.secondary', mt: 0.5, flexShrink: 0 }} />
                                <Box sx={{ flex: 1, minWidth: 0 }}>
                                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', fontWeight: 500 }}>
                                    Name
                                  </Typography>
                                  <Typography variant="body2" sx={{ ...overviewProfileFieldValueSx, mt: 0.25 }}>
                                    {form.emergencyContact.name}
                                    {form.emergencyContact?.relationship && ` (${form.emergencyContact.relationship})`}
                                  </Typography>
                                </Box>
                              </Box>
                            </Grid>
                          )}
                          
                          {form.emergencyContact?.phone && (
                            <Grid item xs={12} sm={6}>
                              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                                <LocalPhoneIcon sx={{ fontSize: 18, color: 'text.secondary', mt: 0.5, flexShrink: 0 }} />
                                <Box sx={{ flex: 1, minWidth: 0 }}>
                                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', fontWeight: 500 }}>
                                    Phone
                                  </Typography>
                                  <Typography variant="body2" sx={{ ...overviewProfileFieldValueSx, mt: 0.25 }}>
                                    {formatPhoneNumber(form.emergencyContact.phone) || form.emergencyContact.phone}
                                  </Typography>
                                </Box>
                              </Box>
                            </Grid>
                          )}
                        </Grid>
                      </Box>
                    )}

                    {!hideNonQuickSections && form.addedToIndeedFlex && (
                      <Box sx={{ mb: 0 }}>
                        <Typography {...overviewSubsectionHeadingTypographyProps} sx={{ ...overviewSubsectionHeadingTypographyProps.sx, mb: 1.5 }}>
                          Indeed Flex
                        </Typography>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                          <Box
                            component="img"
                            src="/img/flex.png"
                            alt="Indeed Flex"
                            sx={{ height: 28, width: 'auto', objectFit: 'contain' }}
                          />
                          <Typography variant="body2" sx={overviewProfileFieldValueSx}>
                            Added to Indeed Flex
                          </Typography>
                        </Box>
                      </Box>
                    )}
                  </Box>
                    </Grid>

                    {showQuickProfileMiddleColumn && (
                    <Grid item xs={12} md={4}>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                        {form.email && !showRecruiterDeployment && (
                          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                            <EmailIcon sx={{ fontSize: 18, color: 'text.secondary', mt: 0.5, flexShrink: 0 }} />
                            <Box sx={{ flex: 1, minWidth: 0 }}>
                              <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', fontWeight: 500 }}>
                                Email
                              </Typography>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.25 }}>
                                <Typography variant="body2" component="span" sx={overviewProfileFieldValueSx}>
                                  <MUILink 
                                    href={`mailto:${form.email}`} 
                                    color="primary" 
                                    underline="hover"
                                    sx={{ wordBreak: 'break-all', fontSize: 'inherit', lineHeight: 'inherit' }}
                                  >
                                    {form.email}
                                  </MUILink>
                                </Typography>
                                <Tooltip title="Copy email">
                                  <IconButton
                                    size="small"
                                    onClick={async () => {
                                      try {
                                        await navigator.clipboard.writeText(form.email);
                                        setMessage('Email copied to clipboard');
                                        setShowToast(true);
                                      } catch (err) {
                                        console.error('Failed to copy email:', err);
                                        setMessage('Failed to copy email');
                                        setShowToast(true);
                                      }
                                    }}
                                    sx={{ 
                                      p: 0.5,
                                      color: 'text.secondary',
                                      '&:hover': {
                                        color: 'primary.main',
                                        bgcolor: 'action.hover'
                                      }
                                    }}
                                  >
                                    <ContentCopyIcon sx={{ fontSize: 16 }} />
                                  </IconButton>
                                </Tooltip>
                              </Box>
                            </Box>
                          </Box>
                        )}

                        {(normalizeLast4SsnDigits(form.last4SSN).length === 4 || isStaffSelfProfile) && (
                          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                            <SecurityIcon sx={{ fontSize: 18, color: 'text.secondary', mt: 0.5, flexShrink: 0 }} />
                            <Box sx={{ flex: 1, minWidth: 0 }}>
                              <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', fontWeight: 500 }}>
                                Last 4 of SSN or ITIN
                              </Typography>
                              <Typography variant="body2" sx={{ ...overviewProfileFieldValueSx, mt: 0.25 }}>
                                {normalizeLast4SsnDigits(form.last4SSN).length === 4
                                  ? `••••${normalizeLast4SsnDigits(form.last4SSN)}`
                                  : '— Use the edit control above to add your last four SSN or ITIN (optional).'}
                              </Typography>
                            </Box>
                          </Box>
                        )}

                        {form.transportMethod && (() => {
                          const transportOption = transportOptions.find(opt => opt.value === form.transportMethod);
                          const TransportIcon = transportOption?.icon || DirectionsCar;
                          return (
                            <Box>
                              <Typography {...overviewSubsectionHeadingTypographyProps}>
                                Transportation
                              </Typography>
                              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                                <TransportIcon sx={{ fontSize: 18, color: 'text.secondary', mt: 0.5, flexShrink: 0 }} />
                                <Box sx={{ flex: 1, minWidth: 0 }}>
                                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', fontWeight: 500 }}>
                                    How will you get to work?
                                  </Typography>
                                  <Typography variant="body2" sx={{ ...overviewProfileFieldValueSx, mt: 0.25 }}>
                                    {transportOption?.label || form.transportMethod}
                                  </Typography>
                                </Box>
                              </Box>
                            </Box>
                          );
                        })()}
                  </Box>
                    </Grid>
                    )}

                    <Grid item xs={12} md={quickColSpan}>
                      <Typography {...overviewSubsectionHeadingTypographyProps}>
                        Home address
                      </Typography>
                      {isEditingHomeAddress ? (
                        <Box>
                          <AddressFormFields uid={uid} formData={addressInfo} onFormChange={handleAddressChange} />
                          <Box sx={{ mt: 1.5 }}>
                            <MapWithMarkers
                              homeLat={addressInfo.homeLat}
                              homeLng={addressInfo.homeLng}
                              workLat={addressInfo.workLat}
                              workLng={addressInfo.workLng}
                              currentLat={addressInfo.currentLat}
                              currentLng={addressInfo.currentLng}
                              mapHeightPx={overviewMapHeightPx}
                              dense
                            />
                          </Box>
                        </Box>
                      ) : (
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                          {(addressInfo.streetAddress || addressInfo.city || addressInfo.state || addressInfo.zip) && (
                            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                              <LocationOnOutlinedIcon sx={{ fontSize: 17, color: 'text.secondary', mt: 0.35, flexShrink: 0 }} />
                              <Typography variant="body2" sx={overviewProfileFieldValueSx}>
                                {[
                                  [addressInfo.streetAddress, addressInfo.unitNumber].filter(Boolean).join(', '),
                                  [addressInfo.city, addressInfo.state, addressInfo.zip].filter(Boolean).join(', ')
                                ]
                                  .filter(Boolean)
                                  .join(', ') || '-'}
                              </Typography>
                            </Box>
                          )}
                          {((addressInfo.homeLat !== null && addressInfo.homeLat !== undefined && addressInfo.homeLng !== null && addressInfo.homeLng !== undefined) ||
                            (addressInfo.workLat !== null && addressInfo.workLat !== undefined && addressInfo.workLng !== null && addressInfo.workLng !== undefined) ||
                            (addressInfo.currentLat !== null && addressInfo.currentLat !== undefined && addressInfo.currentLng !== null && addressInfo.currentLng !== undefined)) && (
                            <Box sx={{ borderRadius: 1, overflow: 'hidden', border: '1px solid', borderColor: 'divider' }}>
                              <MapWithMarkers
                                homeLat={addressInfo.homeLat}
                                homeLng={addressInfo.homeLng}
                                workLat={addressInfo.workLat}
                                workLng={addressInfo.workLng}
                                currentLat={addressInfo.currentLat}
                                currentLng={addressInfo.currentLng}
                                mapHeightPx={overviewMapHeightPx}
                                dense
                              />
                            </Box>
                          )}
                        </Box>
                      )}
                    </Grid>
                  </Grid>
                    );
                  })()
                )}
            </Box>
          </Grid>
          )}

          {/* Section 4 & 5: Skills / experience + recent activity */}
          {!hideNonQuickSections && (
            <>
              <Grid item xs={12}>
                <OverviewQualificationsCard
                  uid={uid}
                  qualifications={overviewQualifications}
                  allowResumeUpload={canEditProfile()}
                  tenantId={activeTenantId || tenantId || activeTenant?.id || null}
                  profileUpdateReminder={embeddedMode === 'full' ? profileUpdateReminder : undefined}
                  certificationReadinessSummaryCounts={certificationReadinessSummaryCounts}
                />
              </Grid>
              <Grid item xs={12}>
                <OverviewScoringCard
                  uid={uid}
                  scoreSummary={scoreSummaryFromUser}
                  riskProfileRaw={riskProfileRaw}
                  recruiterScoreSnapshot={recruiterScoreSnapshotFromUser}
                  recruiterMasterScore={recruiterMasterScoreFromUser}
                  useRecruiterSnapshotOnly={showReviewRescore}
                  latestPrescreenInterviewAi={scoringPrescreenAiFromInterview ?? actionItemsPrescreenAi ?? null}
                  onOpenScoreTab={onOpenScoreTab}
                  headerActionsRight={null}
                  certificationTrustPack={certificationTrustPack}
                  scoringDecisionControls={
                    showReviewRescore
                      ? {
                          reviewRescoreSlot: (
                            <UserScoreRefreshButton
                              compact
                              targetUserId={uid}
                              tenantId={activeTenant?.id || activeTenantId || null}
                              onAfterSuccess={onAfterRecruiterRescore}
                            />
                          ),
                          manualOverrideLabel: null,
                        }
                      : undefined
                  }
                />
              </Grid>
              <Grid item xs={12}>
                <OverviewRecentActivityCard
                  activities={overviewActivityLogs}
                  activitiesLoading={overviewActivityLogsLoading}
                  activitiesError={overviewActivityLogsError}
                />
              </Grid>
            </>
          )}

          {/* User Groups Section (admin 5-7 only, and only on own profile) */}
          {canViewUserGroupsSection && !hideNonQuickSections && (
            <Grid item xs={12}>
              <Card variant="outlined" sx={{ p: cardPadding, borderColor: 'divider', ...overviewCardSx }}>
                <CardHeader
                  title={
                    <Box sx={{ display: 'flex', alignItems: 'center' }}>
                      <Typography variant="h6" sx={{ fontWeight: 700 }}>
                        User Groups
                      </Typography>
                    </Box>
                  }
                  titleTypographyProps={{ component: 'div' }}
                  sx={cardHeaderPadding}
                />
                <CardContent sx={{ p: cardContentPadding, pt: 0 }}>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                      Manage which user groups this user belongs to. User groups help organize users and control access to specific features.
                    </Typography>
                    <Autocomplete
                      multiple
                      options={userGroups}
                      getOptionLabel={(option) => option.title || option.id}
                      value={userGroups.filter((g) => userGroupIds.includes(g.id))}
                      onChange={handleUserGroupsChange}
                      renderInput={(params) => (
                        <TextField {...params} label="User Groups" placeholder="Select groups" fullWidth />
                      )}
                      renderTags={(value, getTagProps) =>
                        value.map((option, index) => (
                          <Chip label={option.title || option.id} {...getTagProps({ index })} key={option.id} />
                        ))
                      }
                      isOptionEqualToValue={(option, value) => option.id === value.id}
                    />
                  </Box>
                </CardContent>
              </Card>
            </Grid>
          )}

          {/* 📍 Employment Classification Section */}
          {/* Only show Employment Details for internal employees (security levels 5-7) */}
          {!hideNonQuickSections &&
          (() => {
            const profileSecurityLevel = parseInt(form.securityLevel || '0');
            return profileSecurityLevel >= 5 && profileSecurityLevel <= 7;
          })() && (
            <Grid item xs={12}>
              <Card variant="outlined" sx={{ p: cardPadding, borderColor: 'divider', ...overviewCardSx }}>
                <CardContent sx={{ p: 0 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                    <WorkIcon sx={{ mr: 1 }} color="primary" />
                    <Typography variant="h6" sx={{ fontWeight: 700 }}>Employment Details</Typography>
                  </Box>
                <Grid container spacing={2}>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      fullWidth
                      name="jobTitle"
                      label="Job Title"
                      value={form.jobTitle}
                      onChange={handleChange}
                      onBlur={handleBlur}
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <FormControl fullWidth required>
                      <InputLabel>Work Status</InputLabel>
                      <Select
                        name="workStatus"
                        value={form.workStatus}
                        onChange={handleSelectChange}
                        label="Work Status *"
                      >
                        <MenuItem value="Active">Active</MenuItem>
                        <MenuItem value="On Leave">On Leave</MenuItem>
                        <MenuItem value="Terminated">Terminated</MenuItem>
                        <MenuItem value="Suspended">Suspended</MenuItem>
                        <MenuItem value="Pending">Pending</MenuItem>
                      </Select>
                    </FormControl>
                  </Grid>
                  
                  <Grid item xs={12} sm={6}>
                    <FormControl fullWidth>
                      <InputLabel>Employment Type</InputLabel>
                      <Select
                        name="employmentType"
                        value={form.employmentType}
                        onChange={handleSelectChange}
                        label="Employment Type *"
                      >
                        <MenuItem value="Full-Time">Full-Time</MenuItem>
                        <MenuItem value="Part-Time">Part-Time</MenuItem>
                        <MenuItem value="Contract">Contract</MenuItem>
                        <MenuItem value="Flex">Flex</MenuItem>
                      </Select>
                    </FormControl>
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    {departments.length === 0 ? (
                      <TextField
                        label="Department"
                        fullWidth
                        disabled
                        value="No departments available"
                        helperText="Please create departments first"
                      />
                    ) : (
                      <FormControl fullWidth>
                        <InputLabel>Department</InputLabel>
                        <Select
                          name="departmentId"
                          value={form.departmentId}
                          onChange={handleSelectChange}
                          label="Department"
                        >
                          <MenuItem value="">None</MenuItem>
                          {departments.map((dept: any) => (
                            <MenuItem key={dept.id} value={dept.id}>
                              {dept.name}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    )}
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    {divisions.length === 0 ? (
                      <TextField
                        label="Division"
                        fullWidth
                        disabled
                        value="No divisions available"
                        helperText="Optional - useful for reporting"
                      />
                    ) : (
                      <FormControl fullWidth>
                        <InputLabel>Division</InputLabel>
                        <Select
                          name="divisionId"
                          value={form.divisionId || ''}
                          onChange={handleSelectChange}
                          label="Division"
                        >
                          <MenuItem value="">None</MenuItem>
                          {divisions.map((div: any) => (
                            <MenuItem key={div.id} value={div.id}>
                              {div.name}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    )}
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    {regions.length === 0 ? (
                      <TextField
                        label="Region"
                        fullWidth
                        disabled
                        value="No regions available"
                        helperText="Optional - geographic region"
                      />
                    ) : (
                      <FormControl fullWidth>
                        <InputLabel>Region</InputLabel>
                        <Select
                          name="regionId"
                          value={form.regionId || ''}
                          onChange={handleSelectChange}
                          label="Region"
                        >
                          <MenuItem value="">None</MenuItem>
                          {regions.map((region: any) => (
                            <MenuItem key={region.id} value={region.id}>
                              {region.name}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    )}
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    {locations.length === 0 ? (
                      <TextField
                        label="Location"
                        fullWidth
                        disabled
                        value="No locations available"
                        helperText="Optional - primary physical location"
                      />
                    ) : (
                      <FormControl fullWidth>
                        <InputLabel>Location</InputLabel>
                        <Select
                          name="locationId"
                          value={form.locationId || ''}
                          onChange={handleSelectChange}
                          label="Location"
                        >
                          <MenuItem value="">None</MenuItem>
                          {locations.map((loc: any) => (
                            <MenuItem key={loc.id} value={loc.id}>
                              {loc.nickname || loc.name}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    )}
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <FormControl fullWidth>
                      <InputLabel>Manager</InputLabel>
                      <Select
                        name="managerId"
                        value={form.managerId || ''}
                        onChange={handleSelectChange}
                        label="Manager"
                      >
                        <MenuItem value="">None</MenuItem>
                        {managers.map((manager: any) => (
                          <MenuItem key={manager.id} value={manager.id}>
                            {manager.firstName} {manager.lastName}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      fullWidth
                      name="startDate"
                      label="Start Date"
                      type="date"
                      value={form.startDate}
                      onChange={(e) => {
                        handleChange(e as any);
                        persistEmploymentField('startDate', (e.target as HTMLInputElement).value);
                      }}
                      InputLabelProps={{ shrink: true }}
                      helperText="Used for tenure calculations"
                    />
                  </Grid>
                  
                  <Grid item xs={12} sm={6}>
                    <TextField
                      fullWidth
                      name="workerId"
                      label="Worker ID"
                      value={form.workerId}
                      onChange={handleChange}
                      onBlur={handleBlur}
                      helperText="Optional custom ID from HRIS"
                    />
                  </Grid>
                  {/* <Grid item xs={12} sm={6}>
                    <TextField
                      fullWidth
                      name="union"
                      label="Union"
                      value={form.union}
                      onChange={handleChange}
                      onBlur={handleBlur}
                      helperText="Union name if exists"
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <FormControlLabel
                      control={
                        <Switch
                          checked={form.workEligibility}
                          onChange={(e) => {
                            setForm({ ...form, workEligibility: e.target.checked });
                            persistEmploymentField('workEligibility', e.target.checked);
                          }}
                        />
                      }
                      label="Work Eligibility"
                    />
                  </Grid> */}
                </Grid>
              </CardContent>
            </Card>
          </Grid>
          )}

          {!hideNonQuickSections && hasChanges && canEditProfile() && (
            <Grid item xs={12}>
              <Button type="submit" variant="contained" size="large">
                Save Changes
              </Button>
            </Grid>
          )}
        </Grid>
        </Box>
        {hideNonQuickSections && canEditProfile() && (
          <Box
            sx={{
              flexShrink: 0,
              pt: 2,
              pb: 2,
              mt: 'auto',
              borderTop: 1,
              borderColor: 'divider',
              bgcolor: 'background.paper',
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 1,
            }}
          >
            <Button
              type="submit"
              variant="contained"
              size="large"
              disabled={!hasChanges}
            >
              Save Changes
            </Button>
          </Box>
        )}
      </Box>

      <Snackbar open={showToast} autoHideDuration={3000} onClose={() => setShowToast(false)}>
        <Alert 
          onClose={() => setShowToast(false)} 
          severity={message.includes('successfully') ? 'success' : 'error'} 
          sx={{ width: '100%' }}
        >
          {message}
        </Alert>
      </Snackbar>

      {/* Password Reset Confirmation Dialog */}
      <Dialog
        open={resetPasswordDialogOpen}
        onClose={() => setResetPasswordDialogOpen(false)}
        aria-labelledby="reset-password-dialog-title"
        aria-describedby="reset-password-dialog-description"
      >
        <DialogTitle id="reset-password-dialog-title">
          Reset Password
        </DialogTitle>
        <DialogContent>
          <DialogContentText id="reset-password-dialog-description">
            Are you sure you want to send a password reset email to <strong>{form.email}</strong>?
            <br /><br />
            The user will receive an email with a link to reset their password.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button 
            onClick={() => setResetPasswordDialogOpen(false)} 
            disabled={resetPasswordLoading}
          >
            Cancel
          </Button>
          <Button 
            onClick={handleResetPassword} 
            variant="contained" 
            color="primary"
            disabled={resetPasswordLoading}
          >
            {resetPasswordLoading ? 'Sending...' : 'Send Reset Email'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default ProfileOverview;
