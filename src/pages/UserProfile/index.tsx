import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Box,
  Tabs,
  Tab,
  Typography,
  Button,
  Paper,
  Alert,
  Badge,
  Avatar,
  IconButton,
  Tooltip,
  Stack,
  Link as MUILink,
  Chip,
  CircularProgress,
  Snackbar,
  Table,
  TableBody,
  TableRow,
  TableCell,
  Dialog,
  DialogTitle,
  DialogContent,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import PersonIcon from '@mui/icons-material/Person';
import CloseIcon from '@mui/icons-material/Close';
import PhoneOutlinedIcon from '@mui/icons-material/PhoneOutlined';
import MessageIcon from '@mui/icons-material/Message';
import EmailOutlinedIcon from '@mui/icons-material/EmailOutlined';
import DescriptionIcon from '@mui/icons-material/Description';
import NoteIcon from '@mui/icons-material/Note';
import LinkedInIcon from '@mui/icons-material/LinkedIn';
import AddTaskIcon from '@mui/icons-material/AddTask';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { useParams, useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import PageHeader from '../../components/PageHeader';
import ContactActionButtons from './components/ContactActionButtons';
import { httpsCallable } from 'firebase/functions';
import {
  doc,
  getDoc,
  onSnapshot,
  updateDoc,
  collection,
  query,
  where,
  orderBy,
  getDocs,
  getCountFromServer,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';

import { FirebaseError } from 'firebase/app';
import { db, functions, storage } from '../../firebase'; // adjust path
import ImageCropDialog from '../../components/common/ImageCropDialog';
import CameraAltIcon from '@mui/icons-material/CameraAlt';
import onetSkills from '../../data/onetSkills.json';
import onetJobTitles from '../../data/onetJobTitles.json';
import { useAuth } from '../../contexts/AuthContext';
import { calculateProfileScore, calculateCompletenessScore } from '../../utils/applicantScoring';
import { userProfileBatcher, flushProfileUpdates } from '../../utils/userProfileBatching';
import { toSafeHref } from '../../utils/urlUtils';
import { getActiveOnboardingType, isOnboardingInProgress } from './utils/onboardingHelpers';
import { getTaskCompletionPercentage, initializeOnboardingTasks } from './utils/onboardingTasks';
import FavoriteButton from '../../components/FavoriteButton';
import { useFavorites } from '../../hooks/useFavorites';
import MissingHomeAddressAlert from '../../components/MissingHomeAddressAlert';

import { toChipLabel } from '../../utils/chipLabel';
import RecruiterUserProfileTableHeader from './components/RecruiterUserProfileTableHeader';
import AiScoreGradeDisplay from './components/AiScoreGradeDisplay';
import ProfileOverview from './components/ProfileOverview';
import UserProfileHeader from './components/UserProfileHeader';
import RecordHeaderActionIcon from './components/RecordHeaderActionIcon';
import RecordHeaderLanguagePreferenceBadge from './components/RecordHeaderLanguagePreferenceBadge';
import RecordHeaderTransportMethodIcon from './components/RecordHeaderTransportMethodIcon';
import { recordHeaderActionIconButtonSx, recordHeaderTooltipComponentsProps } from './components/recordHeaderStyles';
import UserGroupsTab from './components/UserGroupsTab';
import SkillsTab from './components/SkillsTab';
import BackgroundsComplianceTab from './components/BackgroundsComplianceTab';
import SkillsOnlyTab from './components/SkillsOnlyTab';
import WorkEligibilityTab from './components/WorkEligibilityTab';
import QualificationsTab from './components/QualificationsTab';
import InterviewTab from './components/InterviewTab';
import ScoreTab from './components/ScoreTab';
import ReportsAndInsightsTab from './components/ReportsAndInsightsTab';
import NotesTab from './components/NotesTab';
import ActivityLogTab from './components/ActivityLogTab';
import UserAssignmentsTab from './components/UserAssignmentsTab';
import ProfileReadinessTabContent from './components/ProfileReadinessTabContent';
import SystemAccessTab from './components/SystemAccessTab';
import EmailSignatureTab from './components/EmailSignatureTab';
import OnboardingTab from './components/OnboardingTab';
import EmploymentV2Tab from './components/employment-v2/EmploymentV2Tab';
import ComplianceTab from './components/ComplianceTab';
import UserApplicationsTab from './components/UserApplicationsTab';
import MessagesTab from './components/MessagesTab';
import ResumeTab from './components/ResumeTab';
import StartOnboardingDialog from './components/StartOnboardingDialog';
import MessageDrawer, { MessageRecipient } from '../../components/MessageDrawer';
import AddUserNoteDialog from './components/AddUserNoteDialog';
import CreateTaskDialog from '../../components/CreateTaskDialog';
import LogActivityDialog from '../../components/LogActivityDialog';
import { logUserActivity } from '../../utils/activityLogger';
import { normalizeLast4SsnDigits } from '../../utils/last4Ssn';
import { buildRecordHeaderAddressLines } from '../../utils/recordHeaderAddress';
import {
  normalizeScoreSummary,
  type ScoreSummary,
  formatOneDecimal,
} from '../../utils/scoreSummary';
import { getWorkAuthorizedStatus } from '../../utils/workAuthorizedDisplay';
import { getEVerifyComfortStatusFromUserData, type EVerifyComfortStatus } from '../../utils/eVerifyComfortDisplay';
import { persistScoreSummaryFromProfile } from '../../utils/persistScoreSummaryFromProfile';
import { useScoringDistribution } from '../../hooks/useScoringDistribution';
import { useUserProfileEntityEmploymentChips } from '../../hooks/useUserProfileEntityEmploymentChips';
import { useRecruiterUsersEntityEmploymentChips } from '../../hooks/useRecruiterUsersEntityEmploymentChips';
import { useRecruiterUsersLatestBackgroundChecks } from '../../hooks/useRecruiterUsersLatestBackgroundChecks';
import { useRecruiterUsersRowExtras } from '../../hooks/useRecruiterUsersRowExtras';
import UserEntityOnboardingStatusCell from '../../components/tables/UserEntityOnboardingStatusCell';
import { getReadinessBreakdownRows } from '../../utils/recruiterUsersReadinessDisplay';
import type { RecruiterUserBreakdownExtras, RecruiterUserReadinessLike } from '../../utils/recruiterUsersReadinessDisplay';
import { getRecordHeaderEntitySlots } from '../../utils/recruiterUsersEntityWorkReadiness';
import { useCategoryScoresCurrent } from '../../hooks/useCategoryScoresCurrent';
import { formatOverviewInterviewLine } from './utils/overviewDashboardComposer';
import { accusourceScreeningLineItems } from '../../utils/accusourceScreeningLineItems';
import { normalizeRiskProfileFromUserDoc } from '../../utils/workerRiskProfileDisplay';
import {
  backgroundComplianceScreeningRowElementId,
  employmentOnboardingEverifyRowElementId,
} from '../../utils/employmentOnboardingPath';
import { EMPLOYMENT_I9_SECTION_ELEMENT_ID } from '../../utils/workerReadinessBannerModel';
import { sendBulkSmsToWorkerUsers, sendNewEmailFromRecruiter } from '../../utils/sendWorkerQuickNotification';
import { I9_MESSAGE_REQUEST_UPLOAD_EMAIL_SUBJECT } from '../../constants/i9SupportingDocumentsEmploymentStrings';
import type { EmergencyContact } from '../../types/UserProfile';
import { p } from '../../data/firestorePaths';
import { enrichUserAssignmentRow } from '../../utils/enrichAssignmentRowForDisplay';
import { pickRecordHeaderAssignments, type RecordHeaderAssignmentLine } from '../../utils/recordHeaderAssignments';

const UserProfilePage = () => {
  const { uid } = useParams<{ uid: string }>();
  const { user, securityLevel, currentClaimsSecurityLevel, role, tenantId: authTenantId, activeTenant } = useAuth();
  const [tenantId, setCustomerId] = useState<string | null>(null);
  const effectiveTenantId = tenantId || authTenantId || activeTenant?.id;
  const { distribution: scoringDistribution } = useScoringDistribution(effectiveTenantId ?? undefined);
  const [searchParams] = useSearchParams();
  const shouldAutoOpenHomeAddress = searchParams.get('editHomeAddress') === '1';
  const navigate = useNavigate();
  const location = useLocation();
  const { isFavorite, toggleFavorite } = useFavorites('users');

  // Initialize profile batcher and flush on navigation
  useEffect(() => {
    userProfileBatcher.initialize();
    
    // Flush on component unmount (navigation away)
    return () => {
      flushProfileUpdates(true);
    };
  }, []);
  
  const [tabValue, setTabValue] = useState<string>('Overview');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [preferredName, setPreferredName] = useState<string>('');
  const [avatarUrl, setAvatarUrl] = useState<string>('');
  const [skillsData, setSkillsData] = useState<any>(null);
  const [eVerifyOrders, setEVerifyOrders] = useState<Array<{ id: string; dateSubmitted: string; status: string; result?: string; completionDate?: string; submittedBy?: string }>>([]);
  const [backgroundCheckOrders, setBackgroundCheckOrders] = useState<Array<{ id: string; type: string; typeLabel: string; dateOrdered: string; status: string; result?: string; completionDate?: string; submittedBy?: string }>>([]);
  const [drugScreeningOrders, setDrugScreeningOrders] = useState<Array<{ id: string; type: string; typeLabel: string; dateOrdered: string; status: string; result?: string; completionDate?: string; submittedBy?: string }>>([]);
  const [additionalScreeningOrders, setAdditionalScreeningOrders] = useState<Array<{ id: string; type: string; typeLabel: string; dateOrdered: string; status: string; result?: string; completionDate?: string; submittedBy?: string }>>([]);
  const [jobTitle, setJobTitle] = useState<string>('');
  const [phone, setPhone] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [city, setCity] = useState<string>('');
  const [state, setState] = useState<string>('');
  const [recordHeaderAddressLines, setRecordHeaderAddressLines] = useState<{ line1: string; line2: string } | null>(null);
  const [linkedinUrl, setLinkedinUrl] = useState<string>('');
  const [workStatus, setWorkStatus] = useState<string>('');
  const [employmentType, setEmploymentType] = useState<string>('');
  const [departmentName, setDepartmentName] = useState<string>('');
  const [locationName, setLocationName] = useState<string>('');
  const [divisionName, setDivisionName] = useState<string>('');
  const [regionName, setRegionName] = useState<string>('');
  const [managerName, setManagerName] = useState<string>('');
  const [managerId, setManagerId] = useState<string>('');
  const [targetUserSecurityLevel, setTargetUserSecurityLevel] = useState<string>('');
  const [accessDenied, setAccessDenied] = useState(false);
  const [addedToIndeedFlex, setAddedToIndeedFlex] = useState(false);
  const [profileScore, setProfileScore] = useState<number | undefined>(undefined);
  const [profileCompletenessScore, setProfileCompletenessScore] = useState<number | undefined>(undefined);
  const [scoreSummary, setScoreSummary] = useState<ScoreSummary | undefined>(undefined);
  const [reviewsCount, setReviewsCount] = useState<number>(0);
  const [createdAt, setCreatedAt] = useState<any>(null);
  const [workAuthorizedStatus, setWorkAuthorizedStatus] = useState<'yes' | 'no' | 'skipped'>('skipped');
  const [workAuthorizationAttestedAt, setWorkAuthorizationAttestedAt] = useState<unknown>(null);
  const [eVerifyComfortStatus, setEVerifyComfortStatus] = useState<EVerifyComfortStatus>('skipped');
  const [activeApplicationsCount, setActiveApplicationsCount] = useState<number>(0);
  const [assignmentsCount, setAssignmentsCount] = useState<number>(0);
  const [userGroupsCount, setUserGroupsCount] = useState<number>(0);
  const [notesCount, setNotesCount] = useState<number>(0);
  /** Staff onboarding queue deep-link: highlight a screening row on Backgrounds. */
  const [backgroundComplianceHighlightId, setBackgroundComplianceHighlightId] = useState<string | null>(null);
  /** Readiness → Employment deep-link: brief highlight on I-9 / tax & identity block. */
  const [employmentI9SectionFlash, setEmploymentI9SectionFlash] = useState(false);
  const [interviewsCount, setInterviewsCount] = useState<number>(0);
  /** Latest interview from subcollection (used for header when scoreSummary is not yet updated) */
  const [latestInterviewFromSubcollection, setLatestInterviewFromSubcollection] = useState<{ lastAt: Date; lastScore10: number } | null>(null);
  const [employeeOnboardStatus, setEmployeeOnboardStatus] = useState<string | undefined>();
  const [contractorOnboardStatus, setContractorOnboardStatus] = useState<string | undefined>();
  /** Denormalized from `users/{uid}` for recruiter readiness lines (same as Users table). */
  const [profileOnboardingType, setProfileOnboardingType] = useState<string | undefined>();
  const [profileComfortableEVerify, setProfileComfortableEVerify] = useState<unknown>();
  const [profileWorkerAttestations, setProfileWorkerAttestations] = useState<unknown>();
  const [profileWorkEligibilityAttestation, setProfileWorkEligibilityAttestation] = useState<unknown>();
  const [onboardingCompletionPct, setOnboardingCompletionPct] = useState<number>(0);
  const [messageDrawerOpen, setMessageDrawerOpen] = useState(false);
  const [emailComposeOpen, setEmailComposeOpen] = useState(false);
  const [viewerGmailConnected, setViewerGmailConnected] = useState(false);
  const [smsComposeOpen, setSmsComposeOpen] = useState(false);
  /** Prefill body when opening SMS compose from Employment I-9 flow. */
  const [smsComposePrefillBody, setSmsComposePrefillBody] = useState<string | undefined>(undefined);
  const [emailComposePrefill, setEmailComposePrefill] = useState<{ subject?: string; body?: string } | undefined>(
    undefined,
  );
  const [viewerHasSmsSender, setViewerHasSmsSender] = useState(false);
  const [quickReviewStars, setQuickReviewStars] = useState<number | null>(null);
  const [showStartOnboardingDialog, setShowStartOnboardingDialog] = useState(false);
  const [showAddUserNoteDialog, setShowAddUserNoteDialog] = useState(false);
  const [showCreateTaskDialog, setShowCreateTaskDialog] = useState(false);
  const [showLogActivityDialog, setShowLogActivityDialog] = useState(false);
  const [quickProfileDialogOpen, setQuickProfileDialogOpen] = useState(false);
  const [logActivityLoading, setLogActivityLoading] = useState(false);
  const [taskSubmitting, setTaskSubmitting] = useState(false);
  const [activityLogRefreshKey, setActivityLogRefreshKey] = useState(0);
  const [headerUserGroups, setHeaderUserGroups] = useState<Array<{ id: string; title: string }>>([]);
  const [recordHeaderAssignmentLines, setRecordHeaderAssignmentLines] = useState<RecordHeaderAssignmentLine[]>([]);
  const [recordHeaderAvatarHover, setRecordHeaderAvatarHover] = useState(false);
  const [recordHeaderCropOpen, setRecordHeaderCropOpen] = useState(false);
  const [pendingRecordAvatarSrc, setPendingRecordAvatarSrc] = useState<string | null>(null);
  const [recordHeaderAvatarBusy, setRecordHeaderAvatarBusy] = useState(false);
  const recordHeaderFileInputRef = useRef<HTMLInputElement>(null);
  const [profileUpdateReminderLastSentAt, setProfileUpdateReminderLastSentAt] = useState<Date | null>(null);
  const [profileUpdateReminderSendError, setProfileUpdateReminderSendError] = useState<string | null>(null);
  const [sendingProfileUpdateReminder, setSendingProfileUpdateReminder] = useState(false);
  const [messageHistoryRefreshKey, setMessageHistoryRefreshKey] = useState(0);
  const [recordHeaderAvatarSaveError, setRecordHeaderAvatarSaveError] = useState<string | null>(null);
  const [workerQuickNotify, setWorkerQuickNotify] = useState<{
    message: string;
    severity: 'success' | 'error';
  } | null>(null);

  const canEditRecordAvatar = !!uid && (user?.uid === uid || (typeof securityLevel === 'string' && parseInt(securityLevel, 10) >= 4));
  const handleRecordHeaderAvatarClick = useCallback(() => {
    recordHeaderFileInputRef.current?.click();
  }, []);
  const handleRecordHeaderAvatarFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const src = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ''));
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
      });
      setPendingRecordAvatarSrc(src);
      setRecordHeaderCropOpen(true);
    } catch {
      // ignore
    }
    e.target.value = '';
  }, []);
  const handleConfirmRecordHeaderAvatarCrop = useCallback(async (blob: Blob) => {
    if (!uid) return;
    setRecordHeaderAvatarBusy(true);
    setRecordHeaderAvatarSaveError(null);
    try {
      const storageRef = ref(storage, `avatars/${uid}.jpg`);
      await uploadBytes(storageRef, blob, { contentType: blob.type || 'image/jpeg' });
      const downloadURL = await getDownloadURL(storageRef);
      await updateDoc(doc(db, 'users', uid), { avatar: downloadURL });
      setAvatarUrl(downloadURL);
      setRecordHeaderCropOpen(false);
      setPendingRecordAvatarSrc(null);
    } catch (err) {
      console.error('Error saving avatar:', err);
      const denied = err instanceof FirebaseError && err.code === 'permission-denied';
      setRecordHeaderAvatarSaveError(
        denied
          ? "Couldn't save the photo (permission denied). Ask an admin or try again signed in with the right tenant role."
          : "Couldn't save the photo. Check your connection and try again."
      );
    } finally {
      setRecordHeaderAvatarBusy(false);
    }
  }, [uid]);

  const handleIndeedFlexToggle = useCallback(async (checked: boolean) => {
    if (!uid) return;
    try {
      await updateDoc(doc(db, 'users', uid), { addedToIndeedFlex: checked, updatedAt: new Date() });
      setAddedToIndeedFlex(checked);
      setSkillsData((prev: any) => (prev ? { ...prev, addedToIndeedFlex: checked } : prev));
    } catch (err) {
      console.error('Failed to update Indeed Flex flag:', err);
    }
  }, [uid]);

  /** Remove target user from a group — mirrors how header resolves `userGroupIds` (tenant + top-level). */
  const handleRemoveUserFromGroup = useCallback(
    async (groupId: string) => {
      if (!uid) return;
      try {
        const userRef = doc(db, 'users', uid);
        const userSnap = await getDoc(userRef);
        if (!userSnap.exists()) return;
        const data = userSnap.data() as Record<string, any>;
        const effectiveTenantId = data.activeTenantId || data.tenantId || null;
        const tenantData =
          effectiveTenantId && data.tenantIds?.[effectiveTenantId] ? data.tenantIds[effectiveTenantId] : {};
        const rawGroupIds =
          (Array.isArray(tenantData?.userGroupIds) ? tenantData.userGroupIds : null) ||
          (Array.isArray(data?.userGroupIds) ? data.userGroupIds : null) ||
          (Array.isArray(data?.tenantIds?.[effectiveTenantId]?.userGroupIds)
            ? data.tenantIds[effectiveTenantId].userGroupIds
            : null) ||
          [];
        const current = Array.from(new Set((rawGroupIds as string[]).filter(Boolean)));
        const newIds = current.filter((id) => id !== groupId);
        const patch: Record<string, unknown> = {
          userGroupIds: newIds,
          updatedAt: new Date(),
        };
        if (effectiveTenantId) {
          patch[`tenantIds.${effectiveTenantId}.userGroupIds`] = newIds;
        }
        await updateDoc(userRef, patch);
        setHeaderUserGroups((prev) => prev.filter((g) => g.id !== groupId));
        setUserGroupsCount((c) => Math.max(0, c - 1));
      } catch (err) {
        console.error('Failed to remove user from group:', err);
      }
    },
    [uid],
  );

  const handleAddUserToGroup = useCallback(
    async (groupId: string) => {
      if (!uid) return;
      const tid = (tenantId || authTenantId || activeTenant?.id || '').trim();
      if (!tid) return;
      try {
        const userRef = doc(db, 'users', uid);
        const userSnap = await getDoc(userRef);
        if (!userSnap.exists()) return;
        const data = userSnap.data() as Record<string, any>;
        const effectiveTenantId = data.activeTenantId || data.tenantId || null;
        const tenantData =
          effectiveTenantId && data.tenantIds?.[effectiveTenantId] ? data.tenantIds[effectiveTenantId] : {};
        const rawGroupIds =
          (Array.isArray(tenantData?.userGroupIds) ? tenantData.userGroupIds : null) ||
          (Array.isArray(data?.userGroupIds) ? data.userGroupIds : null) ||
          (Array.isArray(data?.tenantIds?.[effectiveTenantId]?.userGroupIds)
            ? data.tenantIds[effectiveTenantId].userGroupIds
            : null) ||
          [];
        const current = Array.from(new Set((rawGroupIds as string[]).filter(Boolean)));
        if (current.includes(groupId)) return;
        const newIds = [...current, groupId];
        const patch: Record<string, unknown> = {
          userGroupIds: newIds,
          updatedAt: new Date(),
        };
        if (effectiveTenantId) {
          patch[`tenantIds.${effectiveTenantId}.userGroupIds`] = newIds;
        }
        await updateDoc(userRef, patch);
        let title = groupId;
        try {
          const gSnap = await getDoc(doc(db, 'tenants', tid, 'userGroups', groupId));
          if (gSnap.exists()) {
            const g = gSnap.data() as Record<string, unknown>;
            title = String(g?.title || g?.name || groupId);
          }
        } catch {
          /* use groupId */
        }
        setHeaderUserGroups((prev) =>
          [...prev.filter((g) => g.id !== groupId), { id: groupId, title }].sort((a, b) =>
            a.title.localeCompare(b.title),
          ),
        );
        setUserGroupsCount((c) => c + 1);
      } catch (err) {
        console.error('Failed to add user to group:', err);
      }
    },
    [uid, tenantId, authTenantId, activeTenant?.id],
  );

  const effectiveTenantIdForMessaging = tenantId || authTenantId || activeTenant?.id || '';
  const canSendProfileUpdateReminder = (() => {
    const level = Number.parseInt(String(currentClaimsSecurityLevel || securityLevel || '0'), 10) || 0;
    return level >= 5 && level <= 7 && !!uid && !!phone;
  })();

  const handleSendProfileUpdateReminder = async () => {
    if (!uid || !effectiveTenantIdForMessaging) return;
    setSendingProfileUpdateReminder(true);
    setProfileUpdateReminderSendError(null);
    try {
      const fn = httpsCallable(functions, 'sendProfileUpdateReminder');
      const result = await fn({ uid, tenantId: effectiveTenantIdForMessaging });
      const data = (result as any)?.data || {};
      setProfileUpdateReminderLastSentAt(data?.sentAt ? new Date(data.sentAt) : new Date());
      setActivityLogRefreshKey((k) => k + 1);
      setMessageHistoryRefreshKey((k) => k + 1);
    } catch (error: any) {
      console.error('Failed to send profile update reminder:', error);
      const raw =
        error?.message ||
        error?.details?.message ||
        (typeof error === 'string' ? error : '');
      const cleaned = String(raw)
        .replace(/^Firebase:\s*/i, '')
        .replace(/\s*\(functions\/[^)]+\)\s*$/i, '')
        .trim();
      setProfileUpdateReminderSendError(cleaned || 'Failed to send profile update reminder');
    } finally {
      setSendingProfileUpdateReminder(false);
    }
  };

  // Determine if viewer has Gmail connected (for conditional Email icon behavior)
  useEffect(() => {
    let mounted = true;

    const checkViewerGmail = async () => {
      if (!user?.uid) {
        if (mounted) setViewerGmailConnected(false);
        return;
      }
      const level =
        Number.parseInt(String(currentClaimsSecurityLevel || securityLevel || '0'), 10) || 0;
      if (level < 5 || level > 7) {
        if (mounted) setViewerGmailConnected(false);
        return;
      }

      try {
        const getGmailStatus = httpsCallable(functions, 'getGmailStatusOptimized');
        const result = await getGmailStatus({ userId: user.uid, force: true });
        const data = result.data as any;
        // If rate-limited/sampled, treat as connected to avoid false negatives; MessageDrawer will validate senders.
        const connected = !!data?.connected || !!data?.rateLimited || !!data?.sampled;
        if (mounted) setViewerGmailConnected(connected);
      } catch {
        // Fallback: check tokens on user doc
        try {
          const viewerSnap = await getDoc(doc(db, 'users', user.uid));
          const viewerData: any = viewerSnap.exists() ? viewerSnap.data() : null;
          if (mounted) setViewerGmailConnected(!!viewerData?.gmailTokens?.access_token);
        } catch {
          if (mounted) setViewerGmailConnected(false);
        }
      }
    };

    checkViewerGmail();
    return () => {
      mounted = false;
    };
  }, [user?.uid, currentClaimsSecurityLevel, securityLevel]);

  const canComposeEmailViaGmail = useMemo(() => {
    const level =
      Number.parseInt(String(currentClaimsSecurityLevel || securityLevel || '0'), 10) || 0;
    return level >= 5 && level <= 7 && viewerGmailConnected;
  }, [currentClaimsSecurityLevel, securityLevel, viewerGmailConnected]);

  // Determine if viewer can use in-app SMS compose.
  // Internal users (security 5-7) can always use the shared Twilio sender.
  // Others require a recruiter number assignment.
  useEffect(() => {
    let mounted = true;

    const checkSmsSender = async () => {
      const effectiveSecurityLevel = Number.parseInt(String(currentClaimsSecurityLevel || securityLevel || '0'), 10) || 0;
      if (effectiveSecurityLevel >= 5 && effectiveSecurityLevel <= 7) {
        if (mounted) setViewerHasSmsSender(true);
        return;
      }

      if (!user?.uid || !effectiveTenantIdForMessaging) {
        if (mounted) setViewerHasSmsSender(false);
        return;
      }

      try {
        const recruiterNumberDoc = await getDoc(
          doc(db, 'tenants', effectiveTenantIdForMessaging, 'recruiterNumbers', user.uid)
        );
        const hasNumber =
          recruiterNumberDoc.exists() &&
          !!(recruiterNumberDoc.data()?.twilioNumber || recruiterNumberDoc.data()?.useMainNumber);
        if (mounted) setViewerHasSmsSender(!!hasNumber);
      } catch {
        if (mounted) setViewerHasSmsSender(false);
      }
    };

    checkSmsSender();
    return () => {
      mounted = false;
    };
  }, [user?.uid, effectiveTenantIdForMessaging, currentClaimsSecurityLevel, securityLevel]);

  // Check if user has access to this profile
  const canAccessProfile = () => {
    // HRX users and admins can access any profile (security levels 5 and above)
    if (parseInt(securityLevel) >= 5) {
      return true;
    }
    
    // Users can always access their own profile
    if (user?.uid === uid) {
      return true;
    }
    
    // Managers can access profiles within their tenant (security level 4)
    if (parseInt(securityLevel) >= 4) {
      return true;
    }
    
    // Workers can only access their own profile
    return false;
  };

  useEffect(() => {
    // Check access permissions
    if (!canAccessProfile()) {
      setAccessDenied(true);
      return;
    }

    const fetchUserData = async () => {
      if (uid) {
        const userRef = doc(db, 'users', uid);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
          const data = userSnap.data();
          setFirstName(data.firstName || '');
          setLastName(data.lastName || '');
          setPreferredName(data.preferredName || '');
          setAvatarUrl(data.avatar || '');
          // Get effective tenant ID first (target user's tenant, if present)
          const effectiveTenantId = data.activeTenantId || data.tenantId || null;
          // Fallback to viewer tenant when target user has no tenantId set (common for older docs / applicants)
          const tenantForGroups = effectiveTenantId || authTenantId || activeTenant?.id || null;
          
          // Fetch tenant-dependent fields from nested structure first, then fallback to direct fields
          const tenantData = effectiveTenantId && data.tenantIds?.[effectiveTenantId] ? data.tenantIds[effectiveTenantId] : {};
          
          setJobTitle(tenantData.jobTitle || data.jobTitle || data.primaryJobTitle || '');
          setPhone(data.phone || '');
          setEmail(data.email || '');
          setProfileUpdateReminderLastSentAt(data.profileUpdateReminderLastSentAt?.toDate?.() || null);
          // City/State: prefer explicit top-level fields, then addressInfo (single source of truth in ProfileOverview),
          // then legacy address object fallbacks.
          setCity(data.city || data.addressInfo?.city || data.address?.city || '');
          setState(data.state || data.addressInfo?.state || data.address?.state || '');
          setRecordHeaderAddressLines(buildRecordHeaderAddressLines(data as Record<string, unknown>));
          setLinkedinUrl(data.linkedinUrl || '');
          setCustomerId(effectiveTenantId || null);
          // Resolve header user groups (ids -> titles)
          try {
            const rawGroupIds =
              (Array.isArray((tenantData as any)?.userGroupIds) ? (tenantData as any).userGroupIds : null) ||
              (Array.isArray((data as any)?.userGroupIds) ? (data as any).userGroupIds : null) ||
              (Array.isArray((data as any)?.tenantIds?.[effectiveTenantId as any]?.userGroupIds)
                ? (data as any).tenantIds[effectiveTenantId as any].userGroupIds
                : null) ||
              [];

            const userGroupIds = Array.from(new Set((rawGroupIds as any[]).filter(Boolean))).slice(0, 25);
            if (userGroupIds.length > 0) {
              // If we can't resolve titles (no tenant), still show IDs so the header isn't blank.
              if (!tenantForGroups) {
                setHeaderUserGroups(userGroupIds.map((id: string) => ({ id, title: id })));
                return;
              }
              const groupDocs = await Promise.all(
                userGroupIds.map(async (groupId: string) => {
                  try {
                    const gSnap = await getDoc(doc(db, 'tenants', tenantForGroups, 'userGroups', groupId));
                    if (!gSnap.exists()) return { id: groupId, title: groupId };
                    const g = gSnap.data() as any;
                    return {
                      id: groupId,
                      title: g?.title || g?.name || groupId,
                    };
                  } catch {
                    return { id: groupId, title: groupId };
                  }
                })
              );
              setHeaderUserGroups(groupDocs.filter(Boolean) as Array<{ id: string; title: string }>);
            } else {
              setHeaderUserGroups([]);
            }
          } catch {
            setHeaderUserGroups([]);
          }
          // Provide sensible defaults so header chips render consistently
          setWorkStatus(tenantData.workStatus || data.workStatus || 'Active');
          setEmploymentType(tenantData.employmentType || data.employmentType || 'Full-Time');
          setTargetUserSecurityLevel(tenantData.securityLevel || data.securityLevel || '5');
          // Resolve department/location/division names from nested structure first
          // Handle both old and new field names for backward compatibility
          const deptId: string | undefined = tenantData.departmentId || tenantData.department || data.departmentId;
          const locId: string | undefined = tenantData.locationId || data.locationId;
          const divId: string | undefined = tenantData.divisionId || data.divisionId;

          // Default from already present human-readable fields
          if (data.department && !deptId) {
            setDepartmentName(data.department);
          } else if (effectiveTenantId && deptId) {
            try {
              const deptDoc = await getDoc(doc(db, 'tenants', effectiveTenantId, 'departments', deptId));
              setDepartmentName(deptDoc.exists() ? (deptDoc.data() as any).name || '' : '');
            } catch (e) {
              setDepartmentName('');
            }
          } else {
            setDepartmentName('');
          }

          if (data.locationName && !locId) {
            setLocationName(data.locationName);
          } else if (effectiveTenantId && locId) {
            try {
              const locDoc = await getDoc(doc(db, 'tenants', effectiveTenantId, 'locations', locId));
              if (locDoc.exists()) {
                const l = locDoc.data() as any;
                setLocationName(l.nickname || l.name || '');
              } else {
                setLocationName('');
              }
            } catch (e) {
              setLocationName('');
            }
          } else {
            setLocationName('');
          }

          // Fetch division information
          if (effectiveTenantId && divId) {
            try {
              const divDoc = await getDoc(doc(db, 'tenants', effectiveTenantId, 'divisions', divId));
              setDivisionName(divDoc.exists() ? (divDoc.data() as any).name || '' : '');
            } catch (e) {
              setDivisionName('');
            }
          } else {
            setDivisionName('');
          }

          // Fetch region information - check nested tenantIds first, then fallback to location
          let regionId: string | undefined = undefined;
          
          // First check nested tenantIds structure (handle both old and new field names)
          if (effectiveTenantId && data.tenantIds?.[effectiveTenantId]) {
            const tenantData = data.tenantIds[effectiveTenantId];
            regionId = tenantData.regionId || tenantData.region;
            if (regionId) {
              console.log('Found regionId in nested tenantIds:', regionId);
            }
          }
          // Fallback to direct field
          else if (data.regionId) {
            regionId = data.regionId;
            console.log('Found regionId in direct field:', regionId);
          }
          // Fallback to location-based lookup
          else if (effectiveTenantId && data.locationId) {
            try {
              // First get the location document
              const locationDoc = await getDoc(doc(db, 'tenants', effectiveTenantId, 'locations', data.locationId));
              if (locationDoc.exists()) {
                const locationData = locationDoc.data() as any;
                
                // Try different possible region field locations in the location document
                regionId = locationData?.primaryContacts?.region || 
                          locationData?.region || 
                          locationData?.regionId;
                console.log('Found regionId through location:', regionId);
              }
            } catch (e) {
              console.warn('Error fetching region through location:', e);
            }
          }
          
          // Get region name if we found a regionId
          if (effectiveTenantId && regionId) {
            try {
              const regionDoc = await getDoc(doc(db, 'tenants', effectiveTenantId, 'regions', regionId));
              setRegionName(regionDoc.exists() ? (regionDoc.data() as any).name || '' : '');
            } catch (e) {
              console.warn('Error fetching region document:', e);
              setRegionName('');
            }
          } else {
            setRegionName('');
          }

          // Fetch manager information from nested structure first
          const managerIdValue = tenantData.managerId || data.managerId;
          if (managerIdValue) {
            setManagerId(managerIdValue);
            try {
              const managerDoc = await getDoc(doc(db, 'users', managerIdValue));
              if (managerDoc.exists()) {
                const managerData = managerDoc.data();
                setManagerName(`${managerData.firstName || ''} ${managerData.lastName || ''}`.trim());
              } else {
                setManagerName('');
              }
            } catch (e) {
              setManagerName('');
            }
          } else {
            setManagerId('');
            setManagerName('');
          }
          
          // Calculate profile score and completeness (for AI score formula)
          const score = calculateProfileScore(data);
          setProfileScore(score);
          const completeness = calculateCompletenessScore(data);
          setProfileCompletenessScore(completeness);
          // Denormalized score summary (interviews/reviews/AI)
          const normalizedSummary = normalizeScoreSummary((data as any).scoreSummary);
          setScoreSummary(normalizedSummary);

          // Do not write scoreSummary on profile load — canonical score comes from Firestore only;
          // updates happen via interview flows, server recomputes, or persistScoreSummaryFromProfile after edits.

          // Set createdAt
          setCreatedAt(data.createdAt || null);
          const attestation = data.workEligibilityAttestation as { attestedAt?: unknown } | null | undefined;
          setWorkAuthorizationAttestedAt(attestation?.attestedAt ?? null);
          setWorkAuthorizedStatus(
            getWorkAuthorizedStatus({
              workEligibility: data.workEligibility,
              workEligibilityAttestation: data.workEligibilityAttestation,
            })
          );
          setEVerifyComfortStatus(getEVerifyComfortStatusFromUserData(data));
        } else {
          setRecordHeaderAddressLines(null);
        }
      }
    };
    fetchUserData();
  }, [uid, user, securityLevel]);

  useEffect(() => {
    if (!uid || !canAccessProfile()) return;
    
    // Avoid always-on Firestore listeners on this page (can trigger rare SDK watch-stream crashes).
    // One-time fetch is enough for the profile summary; tab-specific screens can fetch as needed.
    let cancelled = false;

    const fetchOnce = async () => {
      try {
        const userRef = doc(db, 'users', uid);
        const docSnap = await getDoc(userRef);
        if (cancelled) return;
        if (!docSnap.exists()) return;

        const data = docSnap.data() as any;
        setScoreSummary(normalizeScoreSummary(data.scoreSummary));
        setEVerifyComfortStatus(getEVerifyComfortStatusFromUserData(data));

        // Fetch E-Verify orders
        const eVerifyOrdersArray = Array.isArray(data.eVerifyOrders) ? data.eVerifyOrders : [];
        setEVerifyOrders(eVerifyOrdersArray.map((o: any) => ({
          id: o.id || '',
          dateSubmitted: o.dateSubmitted || '',
          status: o.status || '',
          result: o.result,
          completionDate: o.completionDate,
          submittedBy: o.submittedBy,
        })));

        // Fetch Background Check orders
        const bgOrders = Array.isArray(data.backgroundCheckOrders) ? data.backgroundCheckOrders : [];
        setBackgroundCheckOrders(bgOrders.map((o: any) => ({
          id: o.id || '',
          type: o.type || '',
          typeLabel: o.typeLabel || o.type || '',
          dateOrdered: o.dateOrdered || '',
          status: o.status || '',
          result: o.result,
          completionDate: o.completionDate,
          submittedBy: o.submittedBy,
        })));

        // Fetch Drug Screening orders
        const drugOrders = Array.isArray(data.drugScreeningOrders) ? data.drugScreeningOrders : [];
        setDrugScreeningOrders(drugOrders.map((o: any) => ({
          id: o.id || '',
          type: o.type || '',
          typeLabel: o.typeLabel || o.type || '',
          dateOrdered: o.dateOrdered || '',
          status: o.status || '',
          result: o.result,
          completionDate: o.completionDate,
          submittedBy: o.submittedBy,
        })));

        // Fetch Additional Screening orders
        const addlOrders = Array.isArray(data.additionalScreeningOrders) ? data.additionalScreeningOrders : [];
        setAdditionalScreeningOrders(addlOrders.map((o: any) => ({
          id: o.id || '',
          type: o.type || '',
          typeLabel: o.typeLabel || o.type || '',
          dateOrdered: o.dateOrdered || '',
          status: o.status || '',
          result: o.result,
          completionDate: o.completionDate,
          submittedBy: o.submittedBy,
        })));

        setSkillsData({
          bio: data.professionalBio || data.bio || data.summary || '',
          primaryJobTitle: data.primaryJobTitle || '',
          certifications: data.certifications || [],
          skills: data.skills || [],
          languages: data.languages || [],
          yearsExperience: data.yearsExperience || '',
          educationLevel: data.educationLevel || '',
          backgroundCheckStatus: data.backgroundCheckStatus || '',
          vaccinationStatus: data.vaccinationStatus || '',
          specialTraining: data.specialTraining || '',
          resume: data.resume || null,
          education: data.education || [],
          workExperience: data.workExperience || data.workHistory || [],
          // New fields from the schema
          preferredName: data.preferredName || '',
          // Check both 'dob' and 'dateOfBirth' fields for backward compatibility
          dateOfBirth: (() => {
            const dobValue = data.dob || data.dateOfBirth;
            if (!dobValue) return null;
            if (dobValue?.toDate && typeof dobValue.toDate === 'function') return dobValue.toDate();
            if (typeof dobValue === 'string' || dobValue instanceof Date) return dobValue;
            if (typeof dobValue === 'number') return new Date(dobValue);
            return dobValue;
          })(),
          gender: data.gender || '',
          employmentType: data.employmentType || 'Full-Time',
          departmentId: data.departmentId || '',
          divisionId: data.divisionId || '',
          locationId: data.locationId || '',
          managerId: data.managerId || '',
          startDate: data.startDate || null,
          workStatus: data.workStatus || 'Active',
          workerId: data.workerId || '',
          union: data.union || '',
          workEligibility: data.workEligibility !== false,
          emergencyContact: data.emergencyContact || null,
          transportMethod: data.transportMethod || null,
          addedToIndeedFlex: data.addedToIndeedFlex === true,
          riskProfile: data.riskProfile ?? null,
          preferredLanguage:
            String(data.preferredLanguage || '').toLowerCase() === 'es' ? 'es' : 'en',
          last4SSN: normalizeLast4SsnDigits(data.last4SSN ?? ''),
        });

        setProfileOnboardingType(typeof data.onboardingType === 'string' ? data.onboardingType : undefined);
        setProfileComfortableEVerify(data.comfortableEVerify);
        setProfileWorkerAttestations(data.workerAttestations);
        setProfileWorkEligibilityAttestation(data.workEligibilityAttestation);

        // Load onboarding status
        setEmployeeOnboardStatus(data.employeeOnboardStatus);
        setContractorOnboardStatus(data.contractorOnboardStatus);

        // Compute onboarding completion percentage from onboardingTasks (same logic as OnboardingTab)
        try {
          const activeType = getActiveOnboardingType(data.employeeOnboardStatus, data.contractorOnboardStatus);
          const existingTasks = Array.isArray((data as any).onboardingTasks) ? (data as any).onboardingTasks : [];
          const initializedTasks = activeType ? initializeOnboardingTasks(activeType, existingTasks) : existingTasks;
          setOnboardingCompletionPct(getTaskCompletionPercentage(initializedTasks || []));
        } catch {
          setOnboardingCompletionPct(0);
        }
      } catch (e) {
        console.warn('Failed to fetch user snapshot for profile summary:', e);
      }
    };

    fetchOnce();
    return () => { cancelled = true; };
  }, [uid, user, securityLevel]);

  useEffect(() => {
    if (!uid || !canAccessProfile()) {
      setAddedToIndeedFlex(false);
      return;
    }
    const userRef = doc(db, 'users', uid);
    const unsub = onSnapshot(userRef, (snap) => {
      if (snap.exists()) {
        setAddedToIndeedFlex(snap.data()?.addedToIndeedFlex === true);
      } else {
        setAddedToIndeedFlex(false);
      }
    });
    return () => unsub();
  }, [uid, user, securityLevel]);

  // Fetch counts for tabs
  useEffect(() => {
    if (!uid || !canAccessProfile()) return;

    const fetchCounts = async () => {
      try {
        // Applications count - from user's applicationIds array
        const userRef = doc(db, 'users', uid);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
          const userData = userSnap.data();
          const applicationIds = Array.isArray(userData?.applicationIds) ? userData.applicationIds : [];
          setActiveApplicationsCount(applicationIds.length);

          // User Groups count - from user's userGroupIds array
          const userGroupIds = Array.isArray(userData?.userGroupIds) ? userData.userGroupIds : [];
          setUserGroupsCount(userGroupIds.length);

          // Reviews count - from users/{uid}/reviews subcollection (admin-only tab)
          try {
            const reviewsRef = collection(db, 'users', uid, 'reviews');
            const reviewsSnap = await getDocs(reviewsRef);
            setReviewsCount(reviewsSnap.size);
          } catch {
            setReviewsCount(0);
          }
        }

        // Assignments count
        try {
          const assignmentsQuery = query(
            collection(db, 'assignments'),
            where('userId', '==', uid)
          );
          const assignmentsSnapshot = await getDocs(assignmentsQuery);
          setAssignmentsCount(assignmentsSnapshot.size);
        } catch (error: any) {
          // Silently handle permission errors for lower-level users
          if (error?.code === 'permission-denied' || 
              error?.code === 'PERMISSION_DENIED' || 
              error?.message?.includes('Missing or insufficient permissions')) {
            setAssignmentsCount(0);
          } else {
            console.error('Error fetching assignments count:', error);
          }
          setAssignmentsCount(0);
        }

        // Only fetch notes and interviews counts if viewer has admin access (securityLevel >= 5)
        const viewerSecurityLevel = typeof securityLevel === 'number' ? securityLevel : parseInt(securityLevel || '0', 10);
        const canViewAdminContent = viewerSecurityLevel >= 5;

        // Notes count - from users/{uid}/notes subcollection
        if (canViewAdminContent) {
          try {
            const notesRef = collection(db, 'users', uid, 'notes');
            const notesSnapshot = await getDocs(notesRef);
            setNotesCount(notesSnapshot.size);
          } catch (error: any) {
            // Silently handle permission errors - Firestore rules may restrict access
            const isPermissionError = 
              error?.code === 'permission-denied' || 
              error?.code === 'PERMISSION_DENIED' ||
              error?.message?.includes('Missing or insufficient permissions') ||
              error?.message?.includes('permission');
            if (!isPermissionError) {
              console.error('Error fetching notes count:', error);
            }
            setNotesCount(0);
          }
        } else {
          setNotesCount(0);
        }

        // Interviews count and latest interview - from users/{uid}/interviews (header uses latest when scoreSummary not yet updated)
        if (canViewAdminContent) {
          try {
            const interviewsRef = collection(db, 'users', uid, 'interviews');
            let interviewsSnapshot;
            try {
              const q = query(interviewsRef, orderBy('createdAt', 'desc'));
              interviewsSnapshot = await getDocs(q);
            } catch {
              interviewsSnapshot = await getDocs(interviewsRef);
            }
            setInterviewsCount(interviewsSnapshot.size);
            const docs = interviewsSnapshot.docs
              .map((d) => ({ id: d.id, ...d.data() } as { createdAt?: { toDate?: () => Date }; timestamp?: { toDate?: () => Date }; score10?: number; score?: number; isArchived?: boolean }))
              .filter((d) => d && d.isArchived !== true);
            const toTime = (x: typeof docs[0]) => (x?.createdAt?.toDate?.() ?? x?.timestamp?.toDate?.() ?? new Date(0)).getTime();
            docs.sort((a, b) => toTime(b) - toTime(a));
            const latest = docs[0];
            if (latest) {
              const lastAt = latest.createdAt?.toDate?.() ?? latest.timestamp?.toDate?.() ?? null;
              const lastScore10 = typeof latest.score10 === 'number' ? latest.score10 : typeof latest.score === 'number' ? latest.score : null;
              if (lastAt && typeof lastScore10 === 'number' && !Number.isNaN(lastScore10)) {
                setLatestInterviewFromSubcollection({ lastAt, lastScore10 });
              } else {
                setLatestInterviewFromSubcollection(null);
              }
            } else {
              setLatestInterviewFromSubcollection(null);
            }
          } catch (error: any) {
            const isPermissionError =
              error?.code === 'permission-denied' ||
              error?.code === 'PERMISSION_DENIED' ||
              error?.message?.includes('Missing or insufficient permissions') ||
              error?.message?.includes('permission');
            if (!isPermissionError) {
              console.error('Error fetching interviews count:', error);
            }
            setInterviewsCount(0);
            setLatestInterviewFromSubcollection(null);
          }
        } else {
          setInterviewsCount(0);
          setLatestInterviewFromSubcollection(null);
        }
      } catch (error) {
        console.error('Error fetching counts:', error);
      }
    };

    fetchCounts();
  }, [uid, securityLevel, tabValue]);

  // Tab list — memoized so child updates (e.g. resume upload) do not recreate arrays every render and retrigger tab sync effects.
  const availableTabs = useMemo(() => {
    const viewerSecurityLevel = parseInt(securityLevel);
    const isAdminViewer = viewerSecurityLevel >= 5;

    const isWorkerRoute = location.pathname.includes('/c1/users/');
    const isWorkforceRoute = location.pathname.includes('/workforce/users/');

    const targetUserLevel = parseInt(targetUserSecurityLevel || '0');
    const isInternalTeamMember = targetUserLevel >= 5 && targetUserLevel <= 7;

    const isWorkforceInternalTeamView = isWorkforceRoute && isInternalTeamMember;

    const canViewAdminContent = viewerSecurityLevel >= 5;

    const onboardingInProgress = isOnboardingInProgress(employeeOnboardStatus as any, contractorOnboardStatus as any);

    const tabs = [
      { label: 'Overview', available: true, count: undefined },
      { label: 'Interview', available: canViewAdminContent && !isWorkforceInternalTeamView, count: interviewsCount },
      { label: 'Score', available: canViewAdminContent && !isWorkforceInternalTeamView },
      { label: 'Qualifications', available: false, count: undefined },
      { label: 'Resume Upload', available: !isWorkforceInternalTeamView, count: undefined },
      { label: 'Applications', available: (isAdminViewer && !isWorkerRoute) && !isWorkforceInternalTeamView, count: activeApplicationsCount },
      { label: 'Assignments', available: (isAdminViewer && !isWorkerRoute) && !isWorkforceInternalTeamView, count: assignmentsCount },
      { label: 'Readiness', available: (isAdminViewer && !isWorkerRoute) && !isWorkforceInternalTeamView, count: undefined },
      { label: 'User Groups', available: canViewAdminContent && !isWorkerRoute && !isWorkforceInternalTeamView, count: userGroupsCount },
      { label: 'Onboarding', available: onboardingInProgress && canViewAdminContent && !isWorkforceInternalTeamView, count: undefined },
      { label: 'Employment', available: canViewAdminContent && !isWorkforceInternalTeamView, count: undefined },
      { label: 'Certifications', available: canViewAdminContent && !isWorkforceInternalTeamView, count: undefined },
      { label: 'Backgrounds', available: canViewAdminContent && !isWorkforceInternalTeamView, count: undefined },
      { label: 'Notes', available: canViewAdminContent && !isWorkforceInternalTeamView, count: notesCount },
      { label: 'Messages', available: canViewAdminContent && !isWorkforceInternalTeamView, count: undefined },
      { label: 'Activity Log', available: canViewAdminContent && !isWorkforceInternalTeamView, count: undefined },
      { label: 'Reports & Insights', available: false, count: undefined },
      { label: 'Settings', available: (isAdminViewer && !isWorkerRoute) || isWorkforceInternalTeamView, count: undefined },
    ];

    let filtered = tabs.filter((t) => t.available);
    if (onboardingInProgress) {
      const idx = filtered.findIndex((t) => t.label === 'Onboarding');
      if (idx > 0) {
        const [onboardingTab] = filtered.splice(idx, 1);
        filtered = [onboardingTab, ...filtered];
      }
    }
    return filtered;
  }, [
    location.pathname,
    securityLevel,
    targetUserSecurityLevel,
    employeeOnboardStatus,
    contractorOnboardStatus,
    interviewsCount,
    activeApplicationsCount,
    assignmentsCount,
    userGroupsCount,
    notesCount,
  ]);

  const availableTabLabels = useMemo(() => availableTabs.map((t) => t.label), [availableTabs]);

  const navigateProfileTab = useCallback(
    (label: string) => {
      if (availableTabLabels.includes(label)) setTabValue(label);
    },
    [availableTabLabels],
  );

  // Handle tab query parameter - must be before early returns
  
  // Validate current tab is still available, reset if needed - MUST be before early returns (hook rules)
  useEffect(() => {
    if (availableTabLabels.length > 0 && (!tabValue || !availableTabLabels.includes(tabValue))) {
      setTabValue(availableTabLabels[0]);
    }
  }, [availableTabLabels, tabValue]);

  /** Employment V2 path actions: open a profile tab without remounting the page. */
  useEffect(() => {
    const focus = searchParams.get('employmentFocus');
    const scrollTo = searchParams.get('employmentScrollTo');
    const scrollEntityKey = searchParams.get('employmentEntityKey');
    const backgroundCheckId = searchParams.get('employmentBackgroundCheckId');
    if (!focus || availableTabLabels.length === 0) return;
    if (!availableTabLabels.includes(focus)) return;
    setTabValue(focus);
    const next = new URLSearchParams(searchParams);
    next.delete('employmentFocus');
    next.delete('employmentScrollTo');
    next.delete('employmentEntityKey');
    next.delete('employmentBackgroundCheckId');
    const q = next.toString();
    navigate(`${location.pathname}${q ? `?${q}` : ''}`, { replace: true });

    if (scrollTo === 'e_verify' && scrollEntityKey) {
      const anchorId = employmentOnboardingEverifyRowElementId(scrollEntityKey);
      const runScroll = (): void => {
        document.getElementById(anchorId)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      };
      requestAnimationFrame(() => {
        window.setTimeout(runScroll, 200);
      });
    }

    if (scrollTo === 'background_check' && backgroundCheckId) {
      setBackgroundComplianceHighlightId(backgroundCheckId);
      const anchorId = backgroundComplianceScreeningRowElementId(backgroundCheckId);
      const runScroll = (): void => {
        document.getElementById(anchorId)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      };
      requestAnimationFrame(() => {
        window.setTimeout(runScroll, 280);
      });
    }
  }, [searchParams, availableTabLabels, location.pathname, navigate]);

  useEffect(() => {
    const rf = searchParams.get('readinessFocus');
    if (rf !== 'Readiness' || availableTabLabels.length === 0) return;
    if (!availableTabLabels.includes('Readiness')) return;
    setTabValue('Readiness');
    const next = new URLSearchParams(searchParams);
    next.delete('readinessFocus');
    const q = next.toString();
    navigate(`${location.pathname}${q ? `?${q}` : ''}`, { replace: true });
  }, [searchParams, availableTabLabels, location.pathname, navigate]);

  /** `?tab=employment&focus=i9` — open Employment tab and scroll to I-9 / work authorization checklist (Readiness deep-link). */
  useEffect(() => {
    const tabParam = (searchParams.get('tab') || '').toLowerCase();
    if (tabParam !== 'employment' || availableTabLabels.length === 0) return;
    if (!availableTabLabels.includes('Employment')) return;

    const focusParam = (searchParams.get('focus') || '').toLowerCase();
    setTabValue('Employment');

    const next = new URLSearchParams(searchParams);
    next.delete('tab');
    next.delete('focus');
    const q = next.toString();
    navigate(`${location.pathname}${q ? `?${q}` : ''}`, { replace: true });

    if (focusParam === 'i9') {
      setEmploymentI9SectionFlash(true);
      const runScroll = (): void => {
        document.getElementById(EMPLOYMENT_I9_SECTION_ELEMENT_ID)?.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        });
      };
      requestAnimationFrame(() => {
        window.setTimeout(runScroll, 320);
      });
    }
  }, [searchParams, availableTabLabels, location.pathname, navigate]);

  useEffect(() => {
    if (!employmentI9SectionFlash) return;
    const t = window.setTimeout(() => setEmploymentI9SectionFlash(false), 2000);
    return () => window.clearTimeout(t);
  }, [employmentI9SectionFlash]);

  useEffect(() => {
    if (!backgroundComplianceHighlightId) return;
    const t = window.setTimeout(() => setBackgroundComplianceHighlightId(null), 4000);
    return () => window.clearTimeout(t);
  }, [backgroundComplianceHighlightId]);
  
  useEffect(() => {
    // Removed Certs tab handling
  }, [searchParams, availableTabLabels]);

  const handleTabChange = (_: React.SyntheticEvent, newValue: string) => {
    // Only change local state; do not navigate to a different route which
    // causes a remount and resets the tab for worker (level 2) users.
    setTabValue(newValue);

    // Update URL with search params if needed
    const pathname = window.location.pathname;
    const params = new URLSearchParams(window.location.search);
    params.delete('tab');
    params.delete('focus');
    const search = params.toString();
    navigate(`${pathname}${search ? `?${search}` : ''}`, { replace: true });
  };

  // Handler for tab change from header components (e.g., document icons)
  const handleHeaderTabChange = (tabLabel: string) => {
    if (availableTabLabels.includes(tabLabel)) {
      setTabValue(tabLabel);
      // Update URL if needed
      const pathname = window.location.pathname;
      const params = new URLSearchParams(window.location.search);
      params.delete('tab');
      params.delete('focus');
      const search = params.toString();
      navigate(`${pathname}${search ? `?${search}` : ''}`, { replace: true });
    }
  };

  const handleOpenWorkerNotificationComposer = useCallback(
    (args: { channel: 'sms' | 'email'; body: string; subject?: string }) => {
      if (args.channel === 'sms') {
        setSmsComposePrefillBody(args.body);
        setSmsComposeOpen(true);
      } else {
        setEmailComposePrefill({ body: args.body, subject: args.subject });
        setEmailComposeOpen(true);
      }
    },
    [],
  );

  const handleSendWorkerNotificationDirect = useCallback(
    async (args: { channel: 'sms' | 'email'; body: string; subject?: string }) => {
      const tid = (tenantId || authTenantId || activeTenant?.id || '').trim();
      if (!user?.uid || !tid || !uid) {
        setWorkerQuickNotify({
          message: 'Cannot send: missing account, tenant, or profile.',
          severity: 'error',
        });
        return;
      }
      try {
        if (args.channel === 'sms') {
          const token = await user.getIdToken();
          const r = await sendBulkSmsToWorkerUsers({
            idToken: token,
            tenantId: tid,
            initiatedByUserId: user.uid,
            recipientUserIds: [uid],
            body: args.body,
          });
          if (r.ok === false) {
            setWorkerQuickNotify({ message: r.error, severity: 'error' });
            return;
          }
          setWorkerQuickNotify({ message: 'Reminder SMS sent.', severity: 'success' });
          return;
        }
        const to = email.trim();
        if (!to) {
          setWorkerQuickNotify({ message: 'This worker has no email on file.', severity: 'error' });
          return;
        }
        const r = await sendNewEmailFromRecruiter({
          tenantId: tid,
          recruiterUserId: user.uid,
          toEmails: [to],
          subject: (args.subject || '').trim() || I9_MESSAGE_REQUEST_UPLOAD_EMAIL_SUBJECT,
          bodyPlain: args.body,
        });
        if (r.ok === false) {
          setWorkerQuickNotify({ message: r.error, severity: 'error' });
          return;
        }
        setWorkerQuickNotify({ message: 'Email sent.', severity: 'success' });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Send failed.';
        setWorkerQuickNotify({ message: msg, severity: 'error' });
      }
    },
    [user, tenantId, authTenantId, activeTenant?.id, uid, email],
  );

  const pathnameForEntityChips = location.pathname;
  const isRecruiterRouteForEntityChips =
    pathnameForEntityChips.includes('/users/') ||
    (pathnameForEntityChips.includes('/users') && pathnameForEntityChips.split('/').length > 3);
  const isWorkforceUserRouteForEntityChips = pathnameForEntityChips.includes('/workforce/users/');
  const useRecordHeaderForEntityChips = isWorkforceUserRouteForEntityChips || isRecruiterRouteForEntityChips;
  const viewerSecurityLevelForEntityChips = parseInt(String(securityLevel || '0'), 10);
  const showRecordHeaderEntityStatus =
    Boolean(uid) &&
    !accessDenied &&
    useRecordHeaderForEntityChips &&
    user?.uid !== uid &&
    viewerSecurityLevelForEntityChips >= 5 &&
    viewerSecurityLevelForEntityChips <= 7 &&
    Boolean(effectiveTenantId);

  /** Recruiter `/users/:uid` (not Workforce) — match All Users table row in the record header. */
  const showRecruiterUsersTableHeaderHook = showRecordHeaderEntityStatus && !isWorkforceUserRouteForEntityChips;

  /** Same primary-entity pipeline + payroll as `/users` table — used for header readiness lines on every record header view. */
  const loadRecordHeaderEmploymentBreakdown = showRecordHeaderEntityStatus && Boolean(uid);

  const { itemsByUserId: recruiterEntityItemsByUserId, employmentBreakdownByUserId: recruiterEmploymentBreakdownByUserId, loading: recruiterEntityChipsLoading } =
    useRecruiterUsersEntityEmploymentChips(
      effectiveTenantId ?? undefined,
      loadRecordHeaderEmploymentBreakdown && uid ? [uid] : [],
    );

  const { latestByUserId: recruiterLatestBgByUserId } = useRecruiterUsersLatestBackgroundChecks(
    effectiveTenantId ?? undefined,
    loadRecordHeaderEmploymentBreakdown && uid ? [uid] : [],
  );

  const { latestNoteByUserId: recruiterLatestNoteByUserId, latestInterviewByUserId: recruiterLatestInterviewByUserId } =
    useRecruiterUsersRowExtras(loadRecordHeaderEmploymentBreakdown && uid ? [uid] : []);

  const { items: profileOnlyEntityChips, loading: profileOnlyEntityChipsLoading } = useUserProfileEntityEmploymentChips(
    effectiveTenantId ?? undefined,
    uid,
    showRecordHeaderEntityStatus && !showRecruiterUsersTableHeaderHook,
  );

  const recordHeaderEntityChips = showRecruiterUsersTableHeaderHook
    ? (uid ? recruiterEntityItemsByUserId.get(uid) ?? [] : [])
    : profileOnlyEntityChips;
  const recordHeaderEntityChipsLoading = showRecruiterUsersTableHeaderHook
    ? recruiterEntityChipsLoading
    : profileOnlyEntityChipsLoading;

  /** Record header: formatted account created date (hooks must run before any early return). */
  const recordHeaderCreatedLabel = useMemo(() => {
    if (!createdAt) return null;
    try {
      let date: Date | null = null;
      if (createdAt?.toDate && typeof createdAt.toDate === 'function') {
        date = createdAt.toDate();
      } else if (createdAt instanceof Date) {
        date = createdAt;
      } else if (typeof createdAt === 'string' || typeof createdAt === 'number') {
        date = new Date(createdAt);
      } else if (createdAt?._seconds && typeof createdAt._seconds === 'number') {
        date = new Date(createdAt._seconds * 1000);
      }
      if (date && !Number.isNaN(date.getTime())) {
        return date.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        });
      }
    } catch {
      /* ignore */
    }
    return null;
  }, [createdAt]);

  const recruiterReadinessUser = useMemo((): RecruiterUserReadinessLike & RecruiterUserBreakdownExtras => {
    return {
      securityLevel: targetUserSecurityLevel,
      employeeOnboardStatus,
      contractorOnboardStatus,
      onboardingType: profileOnboardingType,
      scoreSummary,
      workEligibility: skillsData?.workEligibility,
      workEligibilityAttestation: profileWorkEligibilityAttestation as RecruiterUserReadinessLike['workEligibilityAttestation'],
      comfortableEVerify:
        typeof profileComfortableEVerify === 'string' ? profileComfortableEVerify : undefined,
      workerAttestations: profileWorkerAttestations as RecruiterUserReadinessLike['workerAttestations'],
      eVerifyOrders,
      backgroundCheckOrders,
    };
  }, [
    targetUserSecurityLevel,
    employeeOnboardStatus,
    contractorOnboardStatus,
    profileOnboardingType,
    scoreSummary,
    skillsData?.workEligibility,
    profileWorkEligibilityAttestation,
    profileComfortableEVerify,
    profileWorkerAttestations,
    eVerifyOrders,
    backgroundCheckOrders,
  ]);

  const userDocForRecruiterTableIcons = useMemo(
    () =>
      ({
        resume: skillsData?.resume,
        skills: skillsData?.skills,
        addedToIndeedFlex,
      }) as Record<string, unknown>,
    [skillsData?.resume, skillsData?.skills, addedToIndeedFlex],
  );

  const viewerIsAdminContent = parseInt(String(securityLevel || '0'), 10) >= 5;
  const { scores: categoryScoresCurrent } = useCategoryScoresCurrent(viewerIsAdminContent && uid ? uid : null);

  const recordHeaderEntitySlots = useMemo(
    () => getRecordHeaderEntitySlots(recordHeaderEntityChips),
    [recordHeaderEntityChips],
  );

  const recordHeaderScreeningLines = useMemo(() => {
    if (!uid) return [];
    const bg = recruiterLatestBgByUserId.get(uid);
    if (!bg) return [];
    return accusourceScreeningLineItems(bg).slice(0, 12);
  }, [uid, recruiterLatestBgByUserId]);

  const recordHeaderScreeningPackageHint = useMemo(() => {
    if (!uid) return null;
    const bg = recruiterLatestBgByUserId.get(uid);
    if (!bg) return null;
    const parts = [bg.requestedPackageName, bg.requestedPackageId].filter(Boolean);
    return parts.length ? parts.join(' · ') : null;
  }, [uid, recruiterLatestBgByUserId]);

  const recordHeaderInterviewLine = useMemo(() => formatOverviewInterviewLine(scoreSummary), [scoreSummary]);

  const recordHeaderRiskProfile = useMemo(
    () => normalizeRiskProfileFromUserDoc((skillsData as { riskProfile?: unknown })?.riskProfile),
    [skillsData],
  );

  const recruiterReadinessBreakdownRows = useMemo(() => {
    if (!showRecordHeaderEntityStatus || !uid) return [];
    const eb =
      recruiterEmploymentBreakdownByUserId.has(uid) && recruiterEmploymentBreakdownByUserId.get(uid)
        ? { employmentBreakdown: recruiterEmploymentBreakdownByUserId.get(uid)! }
        : {};
    return getReadinessBreakdownRows(recruiterReadinessUser, recordHeaderEntityChips, {
      lastInterviewSubmitterName: recruiterLatestInterviewByUserId.get(uid)?.createdByName ?? null,
      latestAccusourceBackground: recruiterLatestBgByUserId.get(uid) ?? null,
      ...eb,
    });
  }, [
    showRecordHeaderEntityStatus,
    uid,
    recruiterReadinessUser,
    recordHeaderEntityChips,
    recruiterEmploymentBreakdownByUserId,
    recruiterLatestInterviewByUserId,
    recruiterLatestBgByUserId,
  ]);

  useEffect(() => {
    if (!uid || !effectiveTenantId || !showRecruiterUsersTableHeaderHook) {
      setRecordHeaderAssignmentLines([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const col = collection(db, p.assignments(effectiveTenantId));
        const byId = new Map<string, QueryDocumentSnapshot<DocumentData>>();
        try {
          const byUser = await getDocs(query(col, where('userId', '==', uid), orderBy('startDate', 'desc')));
          byUser.docs.forEach((d) => byId.set(d.id, d));
        } catch {
          /* composite index may be missing */
        }
        const byCandidate = await getDocs(query(col, where('candidateId', '==', uid)));
        byCandidate.docs.forEach((d) => {
          if (!byId.has(d.id)) byId.set(d.id, d);
        });
        if (byId.size === 0) {
          const byUserFallback = await getDocs(query(col, where('userId', '==', uid)));
          byUserFallback.docs.forEach((d) => byId.set(d.id, d));
        }
        const merged = Array.from(byId.values()).sort((a, b) => {
          const sa = String((a.data() as { startDate?: string }).startDate || '');
          const sb = String((b.data() as { startDate?: string }).startDate || '');
          return sb.localeCompare(sa);
        });
        const enriched = await Promise.all(merged.map((d) => enrichUserAssignmentRow(effectiveTenantId, d)));
        if (!cancelled) {
          setRecordHeaderAssignmentLines(pickRecordHeaderAssignments(enriched, 3));
        }
      } catch (e) {
        console.warn('UserProfile: record header assignments', e);
        if (!cancelled) setRecordHeaderAssignmentLines([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [uid, effectiveTenantId, showRecruiterUsersTableHeaderHook]);

  const handleSkillsUpdate = async (updated: any) => {
    if (!uid) return;
    const userRef = doc(db, 'users', uid);
    
    // Filter out undefined values to prevent Firestore errors
    const cleanData = Object.fromEntries(
      Object.entries(updated).filter(([_, value]) => {
        if (value === null || value === undefined) return false;
        if (typeof value === 'string' && value === '') return false;
        return true;
      })
    );
    
    await updateDoc(userRef, cleanData);
    await persistScoreSummaryFromProfile(uid).catch((err) =>
      console.warn('UserProfile: persist scoreSummary after skills update failed', err)
    );
  };

  if (!uid) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography variant="h6">No User ID provided</Typography>
      </Box>
    );
  }

  if (accessDenied) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error" sx={{ mb: 2 }}>
          <Typography variant="h6">Access Denied</Typography>
          <Typography variant="body1">
            You don&apos;t have permission to view this profile.
          </Typography>
        </Alert>
        <Button variant="contained" onClick={() => navigate('/dashboard')}>
          Back to Dashboard
        </Button>
      </Box>
    );
  }

  const currentLabel = tabValue;

  // Create breadcrumb path based on current route
  const pathname = location.pathname;
  // Check if this is a recruiter route - more robust check
  const isRecruiterRoute = pathname.includes('/users/') || 
                          (pathname.includes('/users') && pathname.split('/').length > 3);
  // Check if this is a workforce route (from Company Directory)
  const isWorkforceRoute = pathname.includes('/workforce/users/');
  const useRecordHeader = isWorkforceRoute || isRecruiterRoute;
  // Also check if viewing someone else's profile (not own profile) - treat as recruiter view
  const isViewingOtherProfile = user?.uid !== uid;
  const displayName = `${firstName} ${lastName}${preferredName && preferredName !== firstName ? ` (${preferredName})` : ''}`;
  
  // Determine breadcrumb path based on route
  let breadcrumbPath: Array<{ label: string; href?: string }>;
  if (isRecruiterRoute) {
    breadcrumbPath = [
      { label: 'Recruiter', href: '/recruiter' },
      { label: 'All Users', href: '/users' },
      { label: displayName },
    ];
  } else if (isWorkforceRoute) {
    breadcrumbPath = [
      { label: 'Workforce', href: '/workforce' },
      { label: 'Company Directory', href: '/workforce/company-directory' },
      { label: displayName },
    ];
  } else {
    breadcrumbPath = [
      { label: 'Workforce', href: '/workforce' },
      { label: 'Company Directory', href: '/workforce/company-directory' },
      { label: displayName },
    ];
  }

  const isAdminView = parseInt(securityLevel) >= 5;
  const viewerSecurityLevel = parseInt(securityLevel);
  const isOwnProfile = user?.uid === uid;
  /**
   * Staff self-view guardrail: true ONLY when viewer is staff (security 0–4) AND viewing their own record.
   * Use isStaffViewingOwnRecord for any UI that must apply only to this case. Admin view (5–7) and
   * "viewing another user's record" must never be affected—keep those paths unchanged.
   */
  const isStaffViewingOwnRecord = viewerSecurityLevel >= 0 && viewerSecurityLevel <= 4 && !!uid && user?.uid === uid;
  const canViewAdminContent = viewerSecurityLevel >= 5;
  const onboardingInProgress = isOnboardingInProgress(employeeOnboardStatus as any, contractorOnboardStatus as any);
  // Slightly more yellow-orange + used for borders/text. Button gradient is set where needed.
  const onboardingAccent = '#FF9800';
  const onboardingAccentGradient = 'linear-gradient(90deg, #FF8A00 0%, #FFB300 100%)';
  const onboardingAccentGradientHover = 'linear-gradient(90deg, #FB8C00 0%, #FFA000 100%)';

  const coerceToDate = (value: any): Date | null => {
    if (!value) return null;
    try {
      if (typeof value?.toDate === 'function') return value.toDate();
      if (value instanceof Date) return value;
      if (typeof value === 'string' || typeof value === 'number') {
        const d = new Date(value);
        return isNaN(d.getTime()) ? null : d;
      }
      if (value?._seconds && typeof value._seconds === 'number') {
        const d = new Date(value._seconds * 1000);
        return isNaN(d.getTime()) ? null : d;
      }
      return null;
    } catch {
      return null;
    }
  };

  const formatShortDate = (date: Date) =>
    date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  const getSecurityStatusLabel = (lvl?: string) => {
    switch (lvl) {
      case '7': return 'Admin';
      case '6': return 'Manager';
      case '5': return 'Worker';
      case '4': return 'Hired';
      case '3': return 'Flex';
      case '2': return 'Applicant';
      case '1': return 'Dismissed';
      case '0': return 'Suspended';
      default: return undefined;
    }
  };

  const statusLine = (() => {
    // Onboarding overrides everything else
    if (onboardingInProgress) {
      return { text: `Onboarding: ${onboardingCompletionPct}%`, color: onboardingAccent };
    }

    // Prefer explicit workStatus if it signals a terminal state
    const ws = (workStatus || '').toLowerCase().trim();
    if (ws === 'terminated') return { text: 'Dismissed', color: '#D32F2F' };
    if (ws === 'suspended') return { text: 'Suspended', color: '#D32F2F' };

    const secLabel = getSecurityStatusLabel(targetUserSecurityLevel);

    // If hired, show hire date when available
    if (targetUserSecurityLevel === '4') {
      const hireDate = coerceToDate(skillsData?.startDate);
      return {
        text: hireDate ? `Hired: ${formatShortDate(hireDate)}` : 'Hired',
        color: 'rgba(0, 0, 0, 0.55)',
      };
    }

    if (secLabel) {
      return {
        text: secLabel,
        color: secLabel === 'Dismissed' || secLabel === 'Suspended' ? '#D32F2F' : 'rgba(0, 0, 0, 0.55)',
      };
    }

    if (workStatus) return { text: workStatus, color: 'rgba(0, 0, 0, 0.55)' };
    return { text: null as any, color: 'rgba(0, 0, 0, 0.55)' };
  })();

  const initials = `${firstName[0] ?? ''}${lastName[0] ?? ''}`.toUpperCase();

  const interviewLine = (() => {
    const fromSummary = coerceToDate(scoreSummary?.interviewLastAt) && typeof scoreSummary?.interviewLastScore10 === 'number' && !Number.isNaN(scoreSummary.interviewLastScore10);
    const lastAt = fromSummary ? coerceToDate(scoreSummary?.interviewLastAt) : (latestInterviewFromSubcollection?.lastAt ?? null);
    const lastScore = fromSummary ? scoreSummary?.interviewLastScore10 : latestInterviewFromSubcollection?.lastScore10;
    const hasInterview = !!lastAt && typeof lastScore === 'number' && !Number.isNaN(lastScore);

    if (!hasInterview) {
      return { text: 'Not Interviewed', color: '#D32F2F' };
    }

    return {
      text: `Interviewed ${formatShortDate(lastAt)} · ${formatOneDecimal(lastScore)}/10`,
      color: 'rgba(0, 0, 0, 0.55)',
    };
  })();

  const toStringList = (raw: any, opts?: { limit?: number; mapper?: (v: any) => string | null }) => {
    const limit = opts?.limit ?? 12;
    const mapper = opts?.mapper ?? ((v: any) => (typeof v === 'string' ? v : null));
    if (!Array.isArray(raw)) return [];
    const out: string[] = [];
    for (const item of raw) {
      const s = mapper(item);
      const trimmed = s ? String(s).trim() : '';
      if (trimmed) out.push(trimmed);
      if (out.length >= limit) break;
    }
    return out;
  };

  const quickBio = String((skillsData as any)?.bio || '').trim();
  const quickSkills = toStringList((skillsData as any)?.skills, {
    limit: 20,
    mapper: (v) => {
      if (!v) return null;
      if (typeof v === 'string') return v;
      if (typeof v === 'object') return v.label || v.name || v.value || v.canonicalId || null;
      return null;
    },
  });
  const quickCerts = toStringList((skillsData as any)?.certifications, {
    limit: 12,
    mapper: (v) => {
      if (!v) return null;
      if (typeof v === 'string') return v;
      if (typeof v === 'object') return v.name || v.fileName || null;
      return null;
    },
  });
  const quickEducation = (() => {
    const edu = toStringList((skillsData as any)?.education, {
      limit: 8,
      mapper: (v) => {
        if (!v) return null;
        if (typeof v === 'string') return v;
        if (typeof v === 'object') return v.degree || v.program || v.school || null;
        return null;
      },
    });
    const level = String((skillsData as any)?.educationLevel || '').trim();
    return edu.length ? edu : level ? [level] : [];
  })();
  const quickWork = toStringList((skillsData as any)?.workExperience, {
    limit: 8,
    mapper: (v) => {
      if (!v) return null;
      if (typeof v === 'string') return v;
      if (typeof v === 'object') {
        const title = v.jobTitle || v.title || '';
        const employer = v.employer || v.company || '';
        const combined = [title, employer].filter(Boolean).join(' — ');
        return combined || null;
      }
      return null;
    },
  });
  const quickLangs = toStringList((skillsData as any)?.languages, {
    limit: 12,
    mapper: (v) => {
      if (!v) return null;
      if (typeof v === 'string') return v;
      if (typeof v === 'object') return v.language || v.name || null;
      return null;
    },
  });

  const renderQuickChip = (label: string, content: string) => (
    <Tooltip
      arrow
      enterDelay={300}
      placement="top"
      componentsProps={recordHeaderTooltipComponentsProps}
      title={
        <Box sx={{ p: 0.75, maxWidth: 380, whiteSpace: 'pre-wrap' }}>
          <Typography variant="caption" sx={{ fontWeight: 700, mb: 0.25, display: 'block', color: 'inherit' }}>
            {label}
          </Typography>
          <Typography variant="body2" sx={{ color: 'inherit', fontSize: '0.8125rem', lineHeight: 1.4 }}>
            {content || '—'}
          </Typography>
        </Box>
      }
    >
      <Chip
        size="small"
        label={label}
        variant="outlined"
        sx={{
          height: 26,
          fontWeight: 600,
          fontSize: '0.75rem',
          cursor: 'help',
          opacity: content ? 1 : 0.45,
          '& .MuiChip-label': { px: 1 },
        }}
      />
    </Tooltip>
  );

  return (
    <Box className="user-profile-page" sx={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {!useRecordHeader && (
        <UserProfileHeader
          uid={uid}
          firstName={firstName}
          lastName={lastName}
          preferredName={preferredName}
          avatarUrl={avatarUrl}
          onAvatarUpdated={setAvatarUrl}
          headerUserGroups={headerUserGroups}
          showIndeedFlexBadge={addedToIndeedFlex}
          showBackButton={(isRecruiterRoute || user?.uid !== uid) && !isWorkforceRoute}
          onBack={() => {
            if (isRecruiterRoute) {
              navigate('/users');
            } else {
              navigate(-1);
            }
          }}
          jobTitle={jobTitle}
          phone={phone}
          email={email}
          createdAt={createdAt}
          city={city}
          state={state}
          linkedinUrl={linkedinUrl}
          canEditAvatar={user?.uid === uid || parseInt(securityLevel) >= 4}
          workStatus={workStatus}
          securityLevel={targetUserSecurityLevel}
          employmentType={employmentType}
          departmentName={departmentName}
          locationName={locationName}
          divisionName={divisionName}
          regionName={regionName}
          managerName={managerName}
          managerId={managerId}
          showBreadcrumbs={isRecruiterRoute || isWorkforceRoute || user?.uid !== uid}
          breadcrumbPath={breadcrumbPath}
          isAdminView={isAdminView}
          isStaffViewingOwnRecord={isStaffViewingOwnRecord}
          profileScore={profileScore}
          scoreSummary={scoreSummary}
          scoringDistribution={scoringDistribution}
          resume={skillsData?.resume || null}
          certifications={skillsData?.certifications || []}
          education={skillsData?.education || []}
          workExperience={skillsData?.workExperience || []}
          workEligibility={skillsData?.workEligibility}
          backgroundCheckStatus={skillsData?.backgroundCheckStatus}
          vaccinationStatus={skillsData?.vaccinationStatus}
          yearsExperience={skillsData?.yearsExperience}
          primarySkills={(() => {
            try {
              if (!Array.isArray(skillsData?.skills)) return [];
              
              const skillNames: string[] = [];
              
              for (const item of skillsData.skills) {
                // Skip language objects - they have 'language', 'proficiency', 'isNative' keys
                if (item && typeof item === 'object') {
                  // Check for language object structure
                  if (('language' in item) || (('proficiency' in item) && ('isNative' in item))) {
                    continue; // Skip language objects completely
                  }
                  // Extract skill name from skill object (must have 'name' key)
                  if ('name' in item) {
                    const skillName = item.name || item.canonicalId || '';
                    if (skillName && typeof skillName === 'string') {
                      const trimmed = String(skillName).trim();
                      if (trimmed) {
                        skillNames.push(trimmed);
                      }
                    }
                  }
                } else if (typeof item === 'string') {
                  // Direct string skill
                  const trimmed = item.trim();
                  if (trimmed) {
                    skillNames.push(trimmed);
                  }
                }
                
                // Limit to 5 skills
                if (skillNames.length >= 5) break;
              }
              
              // Final safety check - ensure all items are strings (normalize any object that slipped through)
              return skillNames
                .map((s) => (typeof s === 'string' ? s : toChipLabel(s)))
                .filter((name): name is string => typeof name === 'string' && name.length > 0);
            } catch (error) {
              console.error('Error extracting primary skills:', error);
              return [];
            }
          })()}
          languages={(() => {
            try {
              if (!Array.isArray(skillsData?.languages)) return [];
              
              const languageNames: string[] = [];
              
              for (const lang of skillsData.languages) {
                if (typeof lang === 'string') {
                  languageNames.push(lang);
                } else if (lang && typeof lang === 'object' && 'language' in lang) {
                  // Extract language from object
                  const langName = lang.language || String(lang);
                  if (langName && typeof langName === 'string') {
                    languageNames.push(langName.trim());
                  }
                }
                
                // Limit to top 5 languages
                if (languageNames.length >= 5) break;
              }
              
              return languageNames.filter((name): name is string => typeof name === 'string' && name.length > 0);
            } catch (error) {
              console.error('Error extracting languages:', error);
              return [];
            }
          })()}
          eVerifyOrders={eVerifyOrders}
          backgroundCheckOrders={backgroundCheckOrders}
          drugScreeningOrders={drugScreeningOrders}
          additionalScreeningOrders={additionalScreeningOrders}
          behavioralTraits={(() => {
            try {
              // Extract behavioral traits from traitsProfile if available
              const traitsProfile = skillsData?.traitsProfile;
              if (traitsProfile && typeof traitsProfile === 'object') {
                // Check for common trait fields
                const traits: string[] = [];
                
                // If traitsProfile has a traits array
                if (Array.isArray(traitsProfile.traits)) {
                  traits.push(...traitsProfile.traits.slice(0, 5).filter((t: any) => typeof t === 'string'));
                }
                
                // If traitsProfile has individual trait fields
                if (traitsProfile.topTraits && Array.isArray(traitsProfile.topTraits)) {
                  traits.push(...traitsProfile.topTraits.slice(0, 5).filter((t: any) => typeof t === 'string'));
                }
                
                return traits.slice(0, 5);
              }
              
              return [];
            } catch (error) {
              console.error('Error extracting behavioral traits:', error);
              return [];
            }
          })()}
          educationLevel={skillsData?.educationLevel}
          activeApplicationsCount={activeApplicationsCount}
          resumeCompleteness={skillsData?.resume ? 100 : 0}
          onTabChange={handleHeaderTabChange}
          emergencyContact={skillsData?.emergencyContact || null}
          dateOfBirth={skillsData?.dateOfBirth || null}
          onEditProfile={() => {
            // Scroll to overview and focus on edit mode - could be enhanced later
            setTabValue('Overview');
          }}
          onAddNote={() => {
            setTabValue('Notes');
          }}
          onSendApplicationLink={() => {
            // TODO: Implement send application link functionality
            console.log('Send application link');
          }}
          onPrintProfile={() => {
            window.print();
          }}
          onCreateAssignment={() => {
            setTabValue('Assignments');
          }}
          onCallNow={phone ? () => {
            window.location.href = `tel:${phone.replace(/\D/g, '')}`;
          } : undefined}
          onMessageApplicant={() => setSmsComposeOpen(true)}
          onViewTimeline={() => {
            setTabValue('Activity Log');
          }}
          hasPhone={!!phone}
          employeeOnboardStatus={employeeOnboardStatus}
          contractorOnboardStatus={contractorOnboardStatus}
          tenantId={tenantId || authTenantId || activeTenant?.id || undefined}
          onOnboardingStarted={async () => {
            // Reload onboarding status from Firestore
            const userRef = doc(db, 'users', uid!);
            const userSnap = await getDoc(userRef);
            if (userSnap.exists()) {
              const data = userSnap.data();
              setEmployeeOnboardStatus(data.employeeOnboardStatus);
              setContractorOnboardStatus(data.contractorOnboardStatus);
            }
          }}
        />
        )}

        {/* Use Record PageHeader for Workforce + Recruiter record views */}
        {useRecordHeader ? (
          <Box sx={{ pt: '18px' }}>
          <PageHeader
            dense
            sx={{ pt: 0 }}
            title={
              showRecruiterUsersTableHeaderHook ? (
              <Box>
                <RecruiterUserProfileTableHeader
                  firstName={firstName}
                  lastName={lastName}
                  initials={initials}
                  email={email}
                  recordHeaderAddressLines={recordHeaderAddressLines}
                  phone={phone}
                  avatarUrl={avatarUrl}
                  onboardingInProgress={onboardingInProgress}
                  onboardingAccent={onboardingAccent}
                  uid={uid!}
                  canViewAdminContent={canViewAdminContent}
                  targetUserSecurityLevel={targetUserSecurityLevel}
                  isFavorite={isFavorite}
                  toggleFavorite={toggleFavorite}
                  scoreSummary={scoreSummary}
                  scoringDistribution={scoringDistribution}
                  categoryScores={categoryScoresCurrent}
                  riskProfile={recordHeaderRiskProfile}
                  recordHeaderCreatedLabel={recordHeaderCreatedLabel}
                  headerUserGroups={headerUserGroups}
                  viewerSecurityLevel={viewerSecurityLevel}
                  userDocForTableIcons={userDocForRecruiterTableIcons}
                  entitySlots={recordHeaderEntitySlots}
                  interviewSummaryLine={recordHeaderInterviewLine}
                  screeningLines={recordHeaderScreeningLines}
                  screeningPackageHint={recordHeaderScreeningPackageHint}
                  readinessRows={recruiterReadinessBreakdownRows}
                  addedToIndeedFlex={addedToIndeedFlex}
                  onIndeedFlexChange={handleIndeedFlexToggle}
                  canEditIndeedFlex={viewerSecurityLevel >= 4}
                  recordHeaderFileInputRef={recordHeaderFileInputRef}
                  handleRecordHeaderAvatarFileChange={handleRecordHeaderAvatarFileChange}
                  canEditRecordAvatar={canEditRecordAvatar}
                  recordHeaderAvatarHover={recordHeaderAvatarHover}
                  setRecordHeaderAvatarHover={setRecordHeaderAvatarHover}
                  handleRecordHeaderAvatarClick={handleRecordHeaderAvatarClick}
                  recordHeaderAvatarBusy={recordHeaderAvatarBusy}
                  dateOfBirth={skillsData?.dateOfBirth ?? null}
                  lastFourSsnDigits={skillsData?.last4SSN ?? ''}
                  emergencyContact={(skillsData?.emergencyContact as EmergencyContact | undefined) ?? null}
                  onContactEditClick={
                    viewerSecurityLevel >= 4 ? () => setQuickProfileDialogOpen(true) : undefined
                  }
                  assignmentLines={recordHeaderAssignmentLines}
                  onRemoveUserFromGroup={
                    viewerSecurityLevel >= 4 && viewerSecurityLevel <= 7 ? handleRemoveUserFromGroup : undefined
                  }
                  tenantIdForUserGroups={effectiveTenantId ?? null}
                  onAddUserToGroup={
                    viewerSecurityLevel >= 4 && viewerSecurityLevel <= 7 && effectiveTenantId
                      ? handleAddUserToGroup
                      : undefined
                  }
                  contactActionIcons={
                    <Stack direction="row" alignItems="center" flexWrap="wrap" sx={{ gap: '3px' }}>
                      {phone && (
                        <>
                          <RecordHeaderActionIcon
                            tooltip={`Call ${phone}`}
                            component="a"
                            href={`tel:${phone.replace(/\D/g, '')}`}
                          >
                            <PhoneOutlinedIcon />
                          </RecordHeaderActionIcon>
                          <RecordHeaderActionIcon
                            tooltip="Send Message"
                            onClick={() => {
                              if (viewerHasSmsSender) {
                                setSmsComposeOpen(true);
                                return;
                              }
                              const digits = phone.replace(/\D/g, '');
                              if (digits) {
                                window.location.href = `sms:${digits}`;
                              }
                            }}
                          >
                            <MessageIcon />
                          </RecordHeaderActionIcon>
                        </>
                      )}
                      {email && (
                        <RecordHeaderActionIcon
                          tooltip={
                            canComposeEmailViaGmail
                              ? `Email ${email} (send from your Gmail)`
                              : `Email ${email} (open mail app)`
                          }
                          onClick={() => {
                            if (canComposeEmailViaGmail) {
                              setEmailComposeOpen(true);
                            } else {
                              window.location.href = `mailto:${email}`;
                            }
                          }}
                        >
                          <EmailOutlinedIcon />
                        </RecordHeaderActionIcon>
                      )}
                      {skillsData?.resume && skillsData.resume.fileName && (
                        <RecordHeaderActionIcon
                          tooltip={`View Resume: ${skillsData.resume.fileName}`}
                          onClick={async () => {
                            const resume = skillsData.resume;
                            if (resume.downloadUrl) {
                              window.open(resume.downloadUrl, '_blank');
                            } else if (resume.storagePath) {
                              const encodedPath = encodeURIComponent(resume.storagePath);
                              const publicUrl = `https://firebasestorage.googleapis.com/v0/b/hrx1-d3beb.firebasestorage.app/o/${encodedPath}?alt=media`;
                              window.open(publicUrl, '_blank');
                            }
                          }}
                        >
                          <DescriptionIcon />
                        </RecordHeaderActionIcon>
                      )}
                      {toSafeHref(linkedinUrl) && (
                        <RecordHeaderActionIcon
                          tooltip="LinkedIn Profile"
                          component="a"
                          href={toSafeHref(linkedinUrl)}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <LinkedInIcon />
                        </RecordHeaderActionIcon>
                      )}
                      {isAdminView && (
                        <Tooltip
                          title={notesCount > 0 ? `${notesCount} note${notesCount !== 1 ? 's' : ''}` : 'Add note'}
                          componentsProps={recordHeaderTooltipComponentsProps}
                        >
                          <Badge badgeContent={notesCount > 0 ? notesCount : undefined} color="primary">
                            <IconButton
                              size="small"
                              onClick={() => {
                                setShowAddUserNoteDialog(true);
                              }}
                              sx={recordHeaderActionIconButtonSx}
                            >
                              <NoteIcon />
                            </IconButton>
                          </Badge>
                        </Tooltip>
                      )}
                      {isAdminView && (
                        <RecordHeaderActionIcon tooltip="Add Task" onClick={() => setShowCreateTaskDialog(true)}>
                          <AddTaskIcon />
                        </RecordHeaderActionIcon>
                      )}
                      {isAdminView && (
                        <RecordHeaderActionIcon tooltip="Log Activity" onClick={() => setShowLogActivityDialog(true)}>
                          <CheckCircleIcon />
                        </RecordHeaderActionIcon>
                      )}
                      <RecordHeaderLanguagePreferenceBadge
                        language={skillsData?.preferredLanguage === 'es' ? 'es' : 'en'}
                      />
                      <RecordHeaderTransportMethodIcon transportMethod={skillsData?.transportMethod} />
                    </Stack>
                  }
                />
                {/* Bio / Skills / Certifications / Education / Work / Languages quick chips — hidden
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap', mt: 0.35 }}>
                  {renderQuickChip('Bio', quickBio)}
                  {renderQuickChip('Skills', quickSkills.join('\n'))}
                  {renderQuickChip('Certifications', quickCerts.join('\n'))}
                  {renderQuickChip('Education', quickEducation.join('\n'))}
                  {renderQuickChip('Work Experience', quickWork.join('\n'))}
                  {renderQuickChip('Languages', quickLangs.join('\n'))}
                </Box>
                */}
              </Box>
              ) : (
              <Box>
                <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
                  <Box
                    position="relative"
                    onMouseEnter={() => setRecordHeaderAvatarHover(true)}
                    onMouseLeave={() => setRecordHeaderAvatarHover(false)}
                    sx={{ flexShrink: 0 }}
                  >
                    <Avatar
                      src={avatarUrl || undefined}
                      sx={{
                        width: 120,
                        height: 120,
                        bgcolor: avatarUrl ? 'transparent' : 'primary.main',
                        fontSize: '2.5rem',
                        fontWeight: 600,
                        border: onboardingInProgress ? `4px solid ${onboardingAccent}` : undefined,
                        boxSizing: 'border-box',
                      }}
                    >
                      {!avatarUrl && initials}
                    </Avatar>
                    <input
                      type="file"
                      accept="image/*"
                      ref={recordHeaderFileInputRef}
                      style={{ display: 'none' }}
                      onChange={handleRecordHeaderAvatarFileChange}
                    />
                    {canEditRecordAvatar && recordHeaderAvatarHover && (
                      <Tooltip title="Replace photo">
                        <IconButton
                          size="small"
                          onClick={(e) => { e.stopPropagation(); handleRecordHeaderAvatarClick(); }}
                          disabled={recordHeaderAvatarBusy}
                          sx={{
                            position: 'absolute',
                            bottom: -4,
                            right: -4,
                            bgcolor: 'grey.300',
                            color: 'grey.700',
                            width: 28,
                            height: 28,
                            '&:hover': { bgcolor: 'grey.400' },
                          }}
                        >
                          {recordHeaderAvatarBusy ? (
                            <CircularProgress size={16} color="inherit" />
                          ) : (
                            <CameraAltIcon sx={{ fontSize: 16 }} />
                          )}
                        </IconButton>
                      </Tooltip>
                    )}
                  </Box>
                  <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'flex-start', minHeight: 120 }}>
                    {/* Line 1: Name → star → score */}
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.35 }}>
                      <Stack direction="row" spacing={0.5} alignItems="center" sx={{ minWidth: 0, flexWrap: 'wrap', rowGap: 0.25 }}>
                        <Typography
                          variant="h5"
                          sx={{
                            fontSize: { xs: '1.25rem', md: '1.5rem' },
                            fontWeight: 700,
                            lineHeight: 1.2,
                            minWidth: 0,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {`${firstName} ${lastName}`.trim() || 'User Profile'}
                        </Typography>

                          {canViewAdminContent &&
                            uid &&
                            targetUserSecurityLevel &&
                            !['5', '6', '7'].includes(String(targetUserSecurityLevel)) && (
                              <FavoriteButton
                                itemId={uid}
                                favoriteType="users"
                                isFavorite={isFavorite}
                                toggleFavorite={toggleFavorite}
                                size="small"
                                sx={{ p: 0.25, opacity: 0.88, '& .MuiSvgIcon-root': { fontSize: 17 } }}
                                tooltipText={{
                                  favorited: 'Remove from favorites',
                                  notFavorited: 'Add to favorites',
                                }}
                              />
                            )}

                        {canViewAdminContent && (
                          <AiScoreGradeDisplay scoreSummary={scoreSummary} scoringDistribution={scoringDistribution} />
                        )}
                      </Stack>
                    </Box>
                    {/* Line 2: Contact action icons */}
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.125, mb: 0.5 }}>
                    <Stack direction="row" alignItems="center" flexWrap="wrap" sx={{ gap: '3px' }}>
                  {phone && (
                    <>
                      <RecordHeaderActionIcon
                        tooltip={`Call ${phone}`}
                        component="a"
                        href={`tel:${phone.replace(/\D/g, '')}`}
                      >
                        <PhoneOutlinedIcon />
                      </RecordHeaderActionIcon>
                      <RecordHeaderActionIcon
                        tooltip="Send Message"
                        onClick={() => {
                          if (viewerHasSmsSender) {
                            setSmsComposeOpen(true);
                            return;
                          }
                          const digits = phone.replace(/\D/g, '');
                          if (digits) {
                            window.location.href = `sms:${digits}`;
                          }
                        }}
                      >
                        <MessageIcon />
                      </RecordHeaderActionIcon>
                    </>
                  )}
                  {email && (
                    <RecordHeaderActionIcon
                      tooltip={
                        canComposeEmailViaGmail
                          ? `Email ${email} (send from your Gmail)`
                          : `Email ${email} (open mail app)`
                      }
                      onClick={() => {
                        if (canComposeEmailViaGmail) {
                          setEmailComposeOpen(true);
                        } else {
                          window.location.href = `mailto:${email}`;
                        }
                      }}
                    >
                      <EmailOutlinedIcon />
                    </RecordHeaderActionIcon>
                  )}
                  {skillsData?.resume && skillsData.resume.fileName && (
                    <RecordHeaderActionIcon
                      tooltip={`View Resume: ${skillsData.resume.fileName}`}
                      onClick={async () => {
                        const resume = skillsData.resume;
                        if (resume.downloadUrl) {
                          window.open(resume.downloadUrl, '_blank');
                        } else if (resume.storagePath) {
                          const encodedPath = encodeURIComponent(resume.storagePath);
                          const publicUrl = `https://firebasestorage.googleapis.com/v0/b/hrx1-d3beb.firebasestorage.app/o/${encodedPath}?alt=media`;
                          window.open(publicUrl, '_blank');
                        }
                      }}
                    >
                      <DescriptionIcon />
                    </RecordHeaderActionIcon>
                  )}
                  {toSafeHref(linkedinUrl) && (
                    <RecordHeaderActionIcon
                      tooltip="LinkedIn Profile"
                      component="a"
                      href={toSafeHref(linkedinUrl)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <LinkedInIcon />
                    </RecordHeaderActionIcon>
                  )}
                  {isAdminView && (
                    <Tooltip
                      title={notesCount > 0 ? `${notesCount} note${notesCount !== 1 ? 's' : ''}` : 'Add note'}
                      componentsProps={recordHeaderTooltipComponentsProps}
                    >
                      <Badge badgeContent={notesCount > 0 ? notesCount : undefined} color="primary">
                        <IconButton
                          size="small"
                          onClick={() => {
                            setShowAddUserNoteDialog(true);
                          }}
                          sx={recordHeaderActionIconButtonSx}
                        >
                          <NoteIcon />
                        </IconButton>
                      </Badge>
                    </Tooltip>
                  )}
                  {isAdminView && (
                    <RecordHeaderActionIcon tooltip="Add Task" onClick={() => setShowCreateTaskDialog(true)}>
                      <AddTaskIcon />
                    </RecordHeaderActionIcon>
                  )}
                  {isAdminView && (
                    <RecordHeaderActionIcon tooltip="Log Activity" onClick={() => setShowLogActivityDialog(true)}>
                      <CheckCircleIcon />
                    </RecordHeaderActionIcon>
                  )}
                  <RecordHeaderLanguagePreferenceBadge
                    language={skillsData?.preferredLanguage === 'es' ? 'es' : 'en'}
                  />
                  <RecordHeaderTransportMethodIcon transportMethod={skillsData?.transportMethod} />
                    {addedToIndeedFlex ? (
                      <Tooltip title="Added to Indeed Flex" componentsProps={recordHeaderTooltipComponentsProps}>
                        <Box
                          component="img"
                          src="/img/flex.png"
                          alt="Indeed Flex"
                          sx={{
                            height: 28,
                            width: 'auto',
                            maxWidth: 88,
                            objectFit: 'contain',
                            display: 'block',
                            flexShrink: 0,
                            alignSelf: 'center',
                            ml: 0.25,
                          }}
                        />
                      </Tooltip>
                    ) : null}
                    </Stack>
                    </Box>
                    {/* Line 3: Location · created (work auth / e-verify live in Employment tab & table elsewhere) */}
                    <Box
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        columnGap: 0.5,
                        rowGap: 0.35,
                        flexWrap: 'wrap',
                        mt: 0.15,
                      }}
                    >
                      {(() => {
                        const loc = [city, state].filter(Boolean).join(', ');
                        const hasLoc = Boolean(loc);
                        const hasCreated = Boolean(recordHeaderCreatedLabel);
                        const metaText = { fontSize: '13px', fontWeight: 400, color: 'text.secondary', lineHeight: 1.35 } as const;
                        const sep = (
                          <Typography component="span" sx={{ color: 'text.disabled', fontSize: '12px', userSelect: 'none', lineHeight: 1.35 }}>
                            ·
                          </Typography>
                        );
                        return (
                          <>
                            {hasLoc && (
                              <Typography component="span" variant="body2" sx={metaText}>
                                {loc}
                              </Typography>
                            )}
                            {hasCreated && (
                              <>
                                {hasLoc && sep}
                                <Typography component="span" variant="body2" sx={metaText}>
                                  Created {recordHeaderCreatedLabel}
                                </Typography>
                              </>
                            )}
                            {!hasLoc && !hasCreated && jobTitle && (
                              <Typography component="span" variant="body2" sx={metaText}>
                                {jobTitle}
                              </Typography>
                            )}
                          </>
                        );
                      })()}
                    </Box>
                    {/* Group / employment / interview — compact table (mirrors Users list density) */}
                    {(() => {
                      const labelSx = {
                        fontSize: '0.7rem',
                        fontWeight: 700,
                        color: 'text.secondary',
                        textTransform: 'uppercase' as const,
                        letterSpacing: '0.06em',
                        borderColor: 'divider',
                        verticalAlign: 'top' as const,
                        width: 108,
                        py: 0.65,
                      };
                      const valueSx = {
                        fontSize: '0.75rem',
                        borderColor: 'divider',
                        py: 0.65,
                        verticalAlign: 'top' as const,
                      };
                      const showGroup =
                        headerUserGroups.length > 0 && viewerSecurityLevel >= 4 && viewerSecurityLevel <= 7;
                      const showEmployment =
                        showRecordHeaderEntityStatus &&
                        (recordHeaderEntityChipsLoading || recordHeaderEntityChips.length > 0);
                      const showInterviewStatus =
                        !isOwnProfile &&
                        viewerSecurityLevel >= 5 &&
                        viewerSecurityLevel <= 7 &&
                        (statusLine?.text || interviewLine?.text);
                      const showReadinessBreakdown = recruiterReadinessBreakdownRows.length > 0;
                      if (!showGroup && !showEmployment && !showInterviewStatus && !showReadinessBreakdown) return null;
                      return (
                        <Table
                          size="small"
                          sx={{
                            mt: 0.5,
                            border: '1px solid',
                            borderColor: 'divider',
                            borderRadius: 1,
                            overflow: 'hidden',
                            maxWidth: '100%',
                            '& td': { borderColor: 'divider' },
                          }}
                        >
                          <TableBody>
                            {showGroup && (
                              <TableRow>
                                <TableCell component="th" scope="row" sx={labelSx}>
                                  Group
                                </TableCell>
                                <TableCell sx={valueSx}>
                                  <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 0.25 }}>
                                    {headerUserGroups.map((g, idx) => {
                                      const href = `/usergroups/${g.id}`;
                                      return (
                                        <React.Fragment key={g.id}>
                                          {idx > 0 && (
                                            <Typography component="span" sx={{ color: 'text.disabled', fontSize: '12px' }}>
                                              ·
                                            </Typography>
                                          )}
                                          <MUILink
                                            component="button"
                                            type="button"
                                            onClick={() => navigate(href)}
                                            underline="hover"
                                            sx={{
                                              fontSize: '0.75rem',
                                              fontWeight: 500,
                                              color: 'text.primary',
                                              cursor: 'pointer',
                                              '&:hover': { color: 'primary.main' },
                                            }}
                                          >
                                            {g.title}
                                          </MUILink>
                                        </React.Fragment>
                                      );
                                    })}
                                  </Box>
                                </TableCell>
                              </TableRow>
                            )}
                            {showEmployment && (
                              <TableRow>
                                <TableCell component="th" scope="row" sx={labelSx}>
                                  Employment
                                </TableCell>
                                <TableCell sx={valueSx}>
                                  <UserEntityOnboardingStatusCell
                                    items={recordHeaderEntityChips}
                                    loading={recordHeaderEntityChipsLoading}
                                    emptyDisplay="hidden"
                                    density="compact"
                                  />
                                </TableCell>
                              </TableRow>
                            )}
                            {showReadinessBreakdown && (
                              <TableRow>
                                <TableCell component="th" scope="row" sx={labelSx}>
                                  Readiness
                                </TableCell>
                                <TableCell sx={valueSx}>
                                  <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 0.35 }}>
                                    {recruiterReadinessBreakdownRows.map((row) => (
                                      <Typography
                                        key={row.key}
                                        variant="body2"
                                        sx={{ fontSize: '0.75rem', fontWeight: 500, color: 'text.secondary', lineHeight: 1.35 }}
                                      >
                                        {row.text}
                                      </Typography>
                                    ))}
                                  </Box>
                                </TableCell>
                              </TableRow>
                            )}
                            {showInterviewStatus && (
                              <TableRow>
                                <TableCell component="th" scope="row" sx={labelSx}>
                                  Interview / status
                                </TableCell>
                                <TableCell sx={valueSx}>
                                  <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 0.35 }}>
                                    {interviewLine?.text && (
                                      <Typography variant="body2" sx={{ fontSize: '0.75rem', fontWeight: 600, color: interviewLine.color, lineHeight: 1.35 }}>
                                        {interviewLine.text}
                                      </Typography>
                                    )}
                                    {statusLine?.text && (
                                      <Typography variant="body2" sx={{ fontSize: '0.75rem', fontWeight: 600, color: statusLine.color, lineHeight: 1.35 }}>
                                        {statusLine.text}
                                      </Typography>
                                    )}
                                  </Box>
                                </TableCell>
                              </TableRow>
                            )}
                          </TableBody>
                        </Table>
                      );
                    })()}

                    {/* Quick profile detail chips (hover for tooltip) — hidden
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap', mt: 0.5 }}>
                      {renderQuickChip('Bio', quickBio)}
                      {renderQuickChip('Skills', quickSkills.join('\n'))}
                      {renderQuickChip('Certifications', quickCerts.join('\n'))}
                      {renderQuickChip('Education', quickEducation.join('\n'))}
                      {renderQuickChip('Work Experience', quickWork.join('\n'))}
                      {renderQuickChip('Languages', quickLangs.join('\n'))}
                    </Box>
                    */}

                    {/* Score Stack removed (now shown as a single summary score on the name line) */}
                  </Box>
                </Box>
              </Box>
              )
            }
            titleRightActions={
              <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end', gap: 1, flexShrink: 0 }}>
                {/*
                Star review control (moved off header — restore beside Back if needed)
                {canViewAdminContent && (
                  <Tooltip title="Leave a star review" arrow placement="left" componentsProps={recordHeaderTooltipComponentsProps}>
                    <Box sx={{ display: 'flex', justifyContent: 'flex-end', pt: 0 }}>
                      <Rating
                        value={quickReviewStars ?? scoreSummary?.reviewAvg ?? 0}
                        precision={0.1}
                        onChange={(_, value) => {
                          if (!value) return;
                          setQuickReviewStars(value);
                          setTabValue('Score');
                          const pathname = window.location.pathname;
                          const params = new URLSearchParams(window.location.search);
                          params.delete('tab');
                          params.set('openReview', '1');
                          params.set('stars', String(value));
                          const search = params.toString();
                          navigate(`${pathname}${search ? `?${search}` : ''}`, { replace: true });
                          setTimeout(() => setQuickReviewStars(null), 0);
                        }}
                        size="small"
                      />
                    </Box>
                  </Tooltip>
                )}
                */}
                <Button
                  startIcon={<ArrowBackIcon sx={{ fontSize: '0.95rem' }} />}
                  onClick={() => {
                    if (isRecruiterRoute) {
                      navigate('/users');
                      return;
                    }
                    if (isWorkforceRoute) {
                      navigate('/workforce/company-directory');
                      return;
                    }
                    navigate(-1);
                  }}
                  variant="outlined"
                  sx={{
                    textTransform: 'none',
                    borderRadius: '999px',
                    fontSize: '13px',
                    fontWeight: 500,
                    px: 1.25,
                    py: 0.5,
                    minHeight: 30,
                    minWidth: 'auto',
                    lineHeight: 1.2,
                    whiteSpace: 'nowrap',
                    boxSizing: 'border-box',
                    borderColor: 'divider',
                    color: 'text.secondary',
                    bgcolor: 'action.hover',
                    '&:hover': {
                      borderColor: 'divider',
                      bgcolor: 'action.selected',
                      color: 'text.primary',
                    },
                    '& .MuiButton-startIcon': {
                      mr: 0.5,
                      ml: -0.25,
                    },
                  }}
                >
                  Back
                </Button>
              </Box>
            }
            subtitle={undefined}
            filters={
              isRecruiterRoute ? (
                <Box display="flex" gap={0.35} flexWrap="wrap" alignItems="center">
                  {availableTabs.map((tab, i) => {
                    const isActive = tabValue === tab.label;
                    const hasCount = tab.count !== undefined && tab.count > 0;
                    return (
                      <Button
                        key={`${tab.label}-${i}`}
                        onClick={() => handleTabChange({} as React.SyntheticEvent, tab.label)}
                        variant="text"
                        sx={{
                          textTransform: 'none',
                          borderRadius: '999px',
                          fontSize: '13px',
                          fontWeight: isActive ? 600 : 400,
                          color: isActive ? 'white' : 'rgba(0, 0, 0, 0.7)',
                          bgcolor: isActive ? '#0057B8' : 'rgba(0, 0, 0, 0.04)',
                          px: 1.25,
                          py: 0.5,
                          minHeight: 30,
                          minWidth: 'auto',
                          whiteSpace: 'nowrap',
                          '&:hover': {
                            bgcolor: isActive ? '#004a9f' : 'rgba(0, 0, 0, 0.08)',
                          },
                        }}
                      >
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                          {tab.label}
                          {hasCount && <Badge badgeContent={tab.count} color="primary" />}
                        </Box>
                      </Button>
                    );
                  })}
                </Box>
              ) : (
                <Box display="flex" gap={0.35} flexWrap="wrap" alignItems="center">
                  <Button
                    onClick={() => handleTabChange({} as React.SyntheticEvent, 'Overview')}
                    variant="text"
                    sx={{
                      textTransform: 'none',
                      borderRadius: '999px',
                      fontSize: '13px',
                      fontWeight: tabValue === 'Overview' ? 600 : 400,
                      color: tabValue === 'Overview' ? 'white' : 'rgba(0, 0, 0, 0.7)',
                      bgcolor: tabValue === 'Overview' ? '#0057B8' : 'rgba(0, 0, 0, 0.04)',
                      px: 1.25,
                      py: 0.5,
                      minHeight: 30,
                      minWidth: 'auto',
                      whiteSpace: 'nowrap',
                      '&:hover': {
                        bgcolor: tabValue === 'Overview' ? '#004a9f' : 'rgba(0, 0, 0, 0.08)',
                      },
                    }}
                  >
                    Overview
                  </Button>
                  {availableTabs.some((t) => t.label === 'Settings') && (
                    <Button
                      onClick={() => handleTabChange({} as React.SyntheticEvent, 'Settings')}
                      variant="text"
                      sx={{
                        textTransform: 'none',
                        borderRadius: '999px',
                        fontSize: '13px',
                        fontWeight: tabValue === 'Settings' ? 600 : 400,
                        color: tabValue === 'Settings' ? 'white' : 'rgba(0, 0, 0, 0.7)',
                        bgcolor: tabValue === 'Settings' ? '#0057B8' : 'rgba(0, 0, 0, 0.04)',
                        px: 1.25,
                        py: 0.5,
                        minHeight: 30,
                        minWidth: 'auto',
                        whiteSpace: 'nowrap',
                        '&:hover': {
                          bgcolor: tabValue === 'Settings' ? '#004a9f' : 'rgba(0, 0, 0, 0.08)',
                        },
                      }}
                    >
                      Settings
                    </Button>
                  )}
                </Box>
              )
            }
            rightActions={
              isRecruiterRoute && canViewAdminContent && isAdminView && onboardingInProgress ? (
                <Button
                  variant="contained"
                  disabled
                  sx={{
                    textTransform: 'none',
                    borderRadius: '999px',
                    fontSize: '14px',
                    fontWeight: 500,
                    px: 1.5,
                    py: 0.75,
                    whiteSpace: 'nowrap',
                    '&.Mui-disabled': {
                      backgroundImage: onboardingAccentGradient,
                      color: '#FFFFFF',
                      opacity: 1,
                    },
                    '&.Mui-disabled:hover': {
                      backgroundImage: onboardingAccentGradientHover,
                      color: '#FFFFFF',
                      opacity: 1,
                    },
                  }}
                >
                  Onboarding
                </Button>
              ) : null
            }
          />
          </Box>
        ) : (
        <Paper 
          elevation={1} 
          sx={{ 
            mb: 3, 
            borderRadius: 1,
            position: 'sticky',
            top: 0,
            zIndex: 1000,
            bgcolor: 'background.paper',
            borderBottom: '1px solid',
            borderColor: 'divider',
          }}
        >
          <Tabs
            value={tabValue}
            onChange={handleTabChange}
            indicatorColor="primary"
            textColor="primary"
            variant="scrollable"
            scrollButtons="auto"
            aria-label="user profile tabs"
          >
            {availableTabs.map((tab, i) => {
              const hasCount = tab.count !== undefined && tab.count > 0;
              return (
                <Tab
                  key={i}
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      {tab.label}
                      {hasCount && (
                        <Badge badgeContent={tab.count} color="primary" />
                      )}
                    </Box>
                  }
                  value={tab.label}
                />
              );
            })}
          </Tabs>
        </Paper>
        )}

        <Box sx={{ mt: 1.5, px: { xs: 2, md: 3 }, pb: 1.5 }} className="profile-tab-content">
          {(() => {
            const label = currentLabel;
            if (!label || !availableTabLabels.includes(label)) return null;
            switch (label) {
              case 'Overview':
                return (
                  <>
                    {user?.uid === uid && <MissingHomeAddressAlert compact />}
                    <ProfileOverview
                      uid={uid}
                      onTabChange={(tab: string) => handleTabChange({} as React.SyntheticEvent, tab)}
                      onOpenScoreTab={
                        availableTabLabels.includes('Score')
                          ? () => handleTabChange({} as React.SyntheticEvent, 'Score')
                          : undefined
                      }
                      autoOpenHomeAddress={shouldAutoOpenHomeAddress}
                    />
                  </>
                );
              case 'Interview':
                return <InterviewTab uid={uid} />;
              case 'Score':
                return (
                  <ScoreTab
                    uid={uid}
                    scoreSummary={scoreSummary}
                    fallbackAiScore={profileScore}
                    fallbackCompleteness={profileCompletenessScore}
                    scoringDistribution={scoringDistribution}
                    onGoToInterview={() => handleTabChange({} as React.SyntheticEvent, 'Interview')}
                  />
                );
              case 'Qualifications':
                return <QualificationsTab uid={uid} />;
              case 'Resume Upload':
                return (
                  <ResumeTab
                    uid={uid}
                    tenantId={tenantId || authTenantId || activeTenant?.id || undefined}
                  />
                );
              case 'Applications':
                return <UserApplicationsTab userId={uid} />;
              case 'Assignments':
                return (
                  <UserAssignmentsTab
                    userId={uid}
                    tenantId={tenantId || authTenantId || activeTenant?.id || null}
                  />
                );
              case 'Readiness':
                return (
                  <ProfileReadinessTabContent
                    uid={uid}
                    tenantId={tenantId || authTenantId || activeTenant?.id || null}
                  />
                );
              case 'User Groups':
                return <UserGroupsTab uid={uid} tenantId={tenantId || authTenantId || activeTenant?.id || undefined} />;
              case 'Onboarding':
                return <OnboardingTab uid={uid} tenantId={tenantId || ''} />;
              case 'Employment':
                return (
                  <EmploymentV2Tab
                    uid={uid}
                    tenantId={tenantId || authTenantId || activeTenant?.id || null}
                    onNavigateToProfileTab={navigateProfileTab}
                    allowStartOnCallEmployment={viewerSecurityLevel >= 4}
                    workerDisplayName={
                      `${firstName} ${lastName}`.trim() || preferredName?.trim() || null
                    }
                    workAuthorizedStatus={workAuthorizedStatus}
                    workAuthorizationAttestedAt={workAuthorizationAttestedAt}
                    employmentI9SectionFlash={employmentI9SectionFlash}
                    onOpenWorkerNotificationComposer={handleOpenWorkerNotificationComposer}
                    onSendWorkerNotificationDirect={handleSendWorkerNotificationDirect}
                  />
                );
              case 'Certifications':
                return <ComplianceTab uid={uid} tenantId={tenantId || authTenantId || activeTenant?.id || null} />;
              case 'Backgrounds':
                return (
                  <BackgroundsComplianceTab
                    uid={uid}
                    tenantId={tenantId || authTenantId || activeTenant?.id || null}
                    highlightScreeningRowId={backgroundComplianceHighlightId}
                    onNavigateToProfileTab={navigateProfileTab}
                  />
                );
              case 'Reports & Insights':
                return <ReportsAndInsightsTab uid={uid} />;
              case 'Notes':
                return <NotesTab uid={uid} user={user} />;
              case 'Messages':
                return (
                  <MessagesTab
                    uid={uid}
                    tenantId={tenantId || undefined}
                    messageHistoryRefreshTrigger={messageHistoryRefreshKey}
                    profileUpdateReminder={
                      canSendProfileUpdateReminder
                        ? {
                            sending: sendingProfileUpdateReminder,
                            lastSentAt: profileUpdateReminderLastSentAt,
                            error: profileUpdateReminderSendError,
                            onSend: handleSendProfileUpdateReminder,
                          }
                        : undefined
                    }
                  />
                );
              case 'Activity Log':
                return <ActivityLogTab uid={uid} user={user} refreshTrigger={activityLogRefreshKey} />;
              case 'Settings':
                return <SystemAccessTab uid={uid} />;
              default:
                return null;
            }
          })()}
        </Box>
      </Box>
      {/* <ChatUI workerId={uid} tenantId={tenantId || undefined} showFAQ={true} /> */}

      {/* Message Drawer */}
      {uid && tenantId && (
        <MessageDrawer
          open={messageDrawerOpen}
          onClose={() => setMessageDrawerOpen(false)}
          recipients={[{
            userId: uid,
            name: `${firstName} ${lastName}`.trim() || preferredName || 'User',
            email: email || undefined,
            phone: phone || undefined,
            avatar: avatarUrl || undefined,
          }]}
          tenantId={tenantId}
          onSend={(result) => {
            console.log('Message sent:', result);
            // Could show a success snackbar here
          }}
        />
      )}

      {/* Email Compose Drawer (opens from Email icon when viewer has Gmail connected) */}
      {uid && (tenantId || authTenantId || activeTenant?.id) && (
        <MessageDrawer
          open={emailComposeOpen}
          onClose={() => {
            setEmailComposeOpen(false);
            setEmailComposePrefill(undefined);
          }}
          recipients={[
            {
              userId: uid,
              name: `${firstName} ${lastName}`.trim() || preferredName || 'User',
              email: email || undefined,
              phone: phone || undefined,
              avatar: avatarUrl || undefined,
            },
          ]}
          tenantId={(tenantId || authTenantId || activeTenant?.id) as string}
          defaultChannels={['email']}
          defaultSubject={emailComposePrefill?.subject}
          defaultBody={emailComposePrefill?.body}
        />
      )}

      {/* SMS Compose Drawer (opens from SMS icon when viewer has recruiter SMS sender) */}
      {uid && (tenantId || authTenantId || activeTenant?.id) && (
        <MessageDrawer
          open={smsComposeOpen}
          onClose={() => {
            setSmsComposeOpen(false);
            setSmsComposePrefillBody(undefined);
          }}
          recipients={[
            {
              userId: uid,
              name: `${firstName} ${lastName}`.trim() || preferredName || 'User',
              email: email || undefined,
              phone: phone || undefined,
              avatar: avatarUrl || undefined,
            },
          ]}
          tenantId={(tenantId || authTenantId || activeTenant?.id) as string}
          defaultChannels={['sms']}
          defaultBody={smsComposePrefillBody}
        />
      )}

      {/* Quick profile & location (from Contact pencil on recruiter record header) */}
      {uid && (
        <Dialog
          open={quickProfileDialogOpen}
          onClose={() => setQuickProfileDialogOpen(false)}
          fullWidth
          maxWidth="lg"
          scroll="paper"
          PaperProps={{
            sx: {
              maxHeight: 'min(90vh, 900px)',
              display: 'flex',
              flexDirection: 'column',
            },
          }}
        >
          <DialogTitle
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 1,
              pr: 1,
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
              <PersonIcon color="primary" sx={{ fontSize: 22, flexShrink: 0 }} aria-hidden />
              <Typography component="span" variant="subtitle1" sx={{ fontWeight: 700 }}>
                Quick profile &amp; location
              </Typography>
            </Box>
            <IconButton
              size="small"
              aria-label="Close"
              onClick={() => setQuickProfileDialogOpen(false)}
              sx={{ color: 'text.secondary' }}
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          </DialogTitle>
          <DialogContent
            dividers
            sx={{
              pt: 1.5,
              pb: 0,
              flex: 1,
              minHeight: 0,
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <ProfileOverview
              uid={uid}
              embeddedMode="quickProfileOnly"
              onTabChange={(tab) => {
                setQuickProfileDialogOpen(false);
                handleTabChange({} as React.SyntheticEvent, tab);
              }}
            />
          </DialogContent>
        </Dialog>
      )}

      {/* Add Note Dialog (opens from Note icon in Record header) */}
      {uid && isAdminView && (
        <AddUserNoteDialog
          open={showAddUserNoteDialog}
          onClose={() => setShowAddUserNoteDialog(false)}
          userId={uid}
          userName={`${firstName} ${lastName}`.trim() || preferredName || 'User'}
          onNoteAdded={() => {
            setNotesCount((c) => c + 1);
            setTabValue('Notes');
          }}
        />
      )}

      {/* Record header avatar crop (when using PageHeader / recruiter view) */}
      <ImageCropDialog
        open={recordHeaderCropOpen}
        title="Edit profile photo"
        imageSrc={pendingRecordAvatarSrc}
        cropShape="round"
        aspect={1}
        confirmLabel={recordHeaderAvatarBusy ? 'Saving…' : 'Save'}
        loading={recordHeaderAvatarBusy}
        onCancel={() => {
          if (recordHeaderAvatarBusy) return;
          setRecordHeaderCropOpen(false);
          setPendingRecordAvatarSrc(null);
          if (recordHeaderFileInputRef.current) recordHeaderFileInputRef.current.value = '';
        }}
        onConfirm={handleConfirmRecordHeaderAvatarCrop}
      />

      {/* Start Onboarding Dialog (Recruiter record view) */}
      {uid && (tenantId || authTenantId || activeTenant?.id) && (
        <StartOnboardingDialog
          open={showStartOnboardingDialog}
          onClose={() => setShowStartOnboardingDialog(false)}
          userId={uid}
          tenantId={(tenantId || authTenantId || activeTenant?.id) as string}
          onOnboardingStarted={async () => {
            const userRef = doc(db, 'users', uid);
            const userSnap = await getDoc(userRef);
            if (userSnap.exists()) {
              const data = userSnap.data();
              setEmployeeOnboardStatus(data.employeeOnboardStatus);
              setContractorOnboardStatus(data.contractorOnboardStatus);
            }
          }}
        />
      )}

      {/* Create Task Dialog */}
      {showCreateTaskDialog && uid && (tenantId || authTenantId || activeTenant?.id) && (
        <CreateTaskDialog
          open={showCreateTaskDialog}
          onClose={() => setShowCreateTaskDialog(false)}
          onSubmit={async (taskData) => {
            if (taskSubmitting) return;
            setTaskSubmitting(true);
            setShowCreateTaskDialog(false);
            try {
              // Import TaskService dynamically to avoid circular dependencies
              const { TaskService } = await import('../../utils/taskService');
              const taskService = TaskService.getInstance();
              
              await taskService.createTask({
                ...taskData,
                tenantId: (tenantId || authTenantId || activeTenant?.id) as string,
                createdBy: user?.uid || '',
                // Ensure tasks created from a user profile are assigned to the logged-in viewer by default
                assignedTo: user?.uid || '',
                associations: {
                  ...(taskData?.associations || {}),
                  // Associate this task to the viewed user record (not a CRM contact).
                  // Backend accepts arbitrary association keys; this is a lightweight linkage for future filtering/UI.
                  users: [uid]
                }
              });
            } catch (error) {
              console.error('Error creating task:', error);
            } finally {
              setTaskSubmitting(false);
            }
          }}
          prefilledData={{
            assignedTo: user?.uid || '',
            associations: {
              users: [uid]
            }
          }}
          // In user context we auto-associate; hide CRM-only pickers.
          hideCrmAssociations
          currentUserId={user?.uid || ''}
          loading={taskSubmitting}
        />
      )}

      {/* Log Activity Dialog */}
      <LogActivityDialog
        open={showLogActivityDialog}
        onClose={() => setShowLogActivityDialog(false)}
        onSubmit={async (taskData) => {
          setLogActivityLoading(true);
          try {
            const { TaskService } = await import('../../utils/taskService');
            const taskService = TaskService.getInstance();
            const result = await taskService.createTask({
              ...taskData,
              tenantId: (tenantId || authTenantId || activeTenant?.id) as string,
              createdBy: user?.uid || '',
              assignedTo: user?.uid || '',
              status: 'completed',
              completedAt: new Date(),
              associations: {
                ...taskData.associations,
                // Associate to the viewed user record (and keep viewer linkage for dashboards)
                users: uid ? [uid] : [],
                salespeople: user?.uid ? [user.uid] : []
              }
            });
            // Save to this user's activity log so it appears in Activity History tab
            if (uid) {
              await logUserActivity({
                userId: uid,
                action: taskData.title || 'Activity logged',
                actionType: 'other',
                description: taskData.description || '',
                severity: (taskData.priority === 'low' || taskData.priority === 'high' ? taskData.priority : 'medium') as 'low' | 'medium' | 'high',
                source: 'web',
                metadata: { taskId: result?.taskId, loggedBy: user?.uid }
              });
              setActivityLogRefreshKey((k) => k + 1);
            }
            setShowLogActivityDialog(false);
          } catch (error) {
            console.error('Error logging activity:', error);
          } finally {
            setLogActivityLoading(false);
          }
        }}
        loading={logActivityLoading}
        // In user context we auto-associate; hide CRM pickers and default to Recruiting.
        hideCrmAssociations
        relatedUser={{ id: uid || '', name: `${firstName} ${lastName}`.trim() || preferredName || 'User' }}
        defaultQuotaCategory="recruiting"
        salespeople={[]}
        contacts={[]}
        preselectContactsFromProps={false}
        currentUserId={user?.uid || ''}
        tenantId={tenantId || authTenantId || activeTenant?.id || ''}
      />

      <Snackbar
        open={!!recordHeaderAvatarSaveError}
        autoHideDuration={8000}
        onClose={() => setRecordHeaderAvatarSaveError(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setRecordHeaderAvatarSaveError(null)}
          severity="error"
          variant="filled"
          sx={{ width: '100%' }}
        >
          {recordHeaderAvatarSaveError}
        </Alert>
      </Snackbar>

      <Snackbar
        open={workerQuickNotify !== null}
        autoHideDuration={6000}
        onClose={() => setWorkerQuickNotify(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setWorkerQuickNotify(null)}
          severity={workerQuickNotify?.severity ?? 'success'}
          variant="filled"
          sx={{ width: '100%' }}
        >
          {workerQuickNotify?.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default UserProfilePage;
