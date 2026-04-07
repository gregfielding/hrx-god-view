import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Avatar,
  Autocomplete,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import EmailIcon from '@mui/icons-material/Email';
import PhoneIcon from '@mui/icons-material/Phone';
import LocationOnIcon from '@mui/icons-material/LocationOn';
import SmsIcon from '@mui/icons-material/Sms';
import MessageDrawer, { type MessageRecipient } from '../components/MessageDrawer';
import { toChipLabel } from '../utils/chipLabel';
import InsightsIcon from '@mui/icons-material/Insights';
import ClearIcon from '@mui/icons-material/Clear';
import IconButton from '@mui/material/IconButton';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { collection, getDocs, getDoc, doc, query, where, limit, startAfter, orderBy, QueryDocumentSnapshot, DocumentData, documentId } from 'firebase/firestore';
import { SelectChangeEvent } from '@mui/material/Select';

import FavoriteButton from '../components/FavoriteButton';
import InterviewCell from '../components/InterviewCell';
import { usePageCache } from '../hooks/usePageCache';
import StandardTablePagination from '../components/StandardTablePagination';
import PageHeader from '../components/PageHeader';
import InboxSearchBar from '../components/InboxSearchBar';
import FavoritesFilter from '../components/FavoritesFilter';
import { useFavorites } from '../hooks/useFavorites';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { calculateProfileScore } from '../utils/applicantScoring';
import { formatPhoneNumber } from '../utils/formatPhone';
import { TABLE_AVATAR_SIZE } from '../utils/uiConstants';
import UserTableResumeIcon from '../components/tables/UserTableResumeIcon';
import UserTableIndeedFlexBadge from '../components/tables/UserTableIndeedFlexBadge';
import { pickResumeFromUserDoc } from '../utils/userResumeOpen';
import type { RecruiterOutletContext } from './RecruiterDashboard';
import { normalizeScoreSummary, formatOneDecimal, getRelativeAiScore } from '../utils/scoreSummary';
import type { ScoreSummary } from '../utils/scoreSummary';
import { useScoringDistribution } from '../hooks/useScoringDistribution';
import { getWorkAuthorizedStatus, compareWorkAuthorized } from '../utils/workAuthorizedDisplay';
import {
  getEVerifyComfortStatusFromUserData,
  compareEVerifyComfort,
} from '../utils/eVerifyComfortDisplay';
import WorkAuthorizedChip from '../components/WorkAuthorizedChip';
import EVerifyComfortChip from '../components/EVerifyComfortChip';
import UserEntityOnboardingStatusCell from '../components/tables/UserEntityOnboardingStatusCell';
import { useRecruiterUsersEntityEmploymentChips } from '../hooks/useRecruiterUsersEntityEmploymentChips';
import { useActiveAssignmentUserIds } from '../hooks/useActiveAssignmentUserIds';
import { getWorkStatusColumnDisplay } from '../utils/workStatusColumnDisplay';

type SecurityLevel =
  | '0'
  | '1'
  | '2'
  | '3'
  | '4'
  | 'active_employee'
  | 'active_contractor'
  | 'onboarding'
  | 'all';

interface RecruiterUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  city?: string;
  state?: string;
  avatar?: string;
  securityLevel: string;
  employeeOnboardStatus?: string;
  contractorOnboardStatus?: string;
  onboardingType?: string;
  scoreSummary?: ScoreSummary;
  lastLoginAt?: any;
  updatedAt?: any;
  createdAt?: any;
  aiProfileScore?: number;
  aiJobFitScore?: number;
  userGroupIds: string[];
  skills: string[];
  workEligibility?: boolean;
  workEligibilityAttestation?: { authorizedToWorkUS?: boolean };
  /** Apply flow / profile — used by Documented (E-Verify) column */
  comfortableEVerify?: string;
  workerAttestations?: { eVerifyWillingness?: string };
  /** Firestore `resume` map — used for inline resume link in Person column */
  resume?: Record<string, unknown> | null;
  addedToIndeedFlex?: boolean;
}

interface TenantUserGroup {
  id: string;
  title?: string;
  description?: string;
}

/** Map a Firestore user doc to RecruiterUser for the given tenant; null if not in tenant or not security 0–4. */
function mapUserDocToRecruiterUser(userDoc: { id: string; data: () => any }, tenantId: string): RecruiterUser | null {
  const userData = userDoc.data() as any;
  const tenantData = userData.tenantIds?.[tenantId] || null;
  if (!tenantData) return null;

  const securityLevel = tenantData.securityLevel || userData.securityLevel || '0';
  if (!['0', '1', '2', '3', '4'].includes(String(securityLevel))) return null;

  const rawSkills = Array.isArray(userData.skills)
    ? userData.skills
    : Array.isArray(tenantData.skills)
    ? tenantData.skills
    : [];
  const normalizedSkills = rawSkills
    .map((skill: any) => {
      if (!skill) return null;
      if (typeof skill === 'string') return skill;
      if (typeof skill === 'object') {
        if (typeof skill.label === 'string') return skill.label;
        if (typeof skill.name === 'string') return skill.name;
        if (typeof skill.value === 'string') return skill.value;
      }
      return null;
    })
    .filter((skill): skill is string => !!skill);

  const mergedScoreSummary = normalizeScoreSummary({
    ...(userData.scoreSummary || {}),
    ...(tenantData?.scoreSummary || {}),
  });

  const resolvedEmail =
    [userData.email, userData.contactEmail, userData.primaryEmail, userData.profileEmail].find(
      (v: unknown) => typeof v === 'string' && String(v).trim().length > 0
    ) || '';

  return {
    id: userDoc.id,
    firstName: userData.firstName || '',
    lastName: userData.lastName || '',
    email: String(resolvedEmail).trim(),
    phone: userData.phone || '',
    avatar: userData.avatar || tenantData.avatar,
    securityLevel: String(securityLevel),
    employeeOnboardStatus: userData.employeeOnboardStatus,
    contractorOnboardStatus: userData.contractorOnboardStatus,
    onboardingType: userData.onboardingType,
    scoreSummary: mergedScoreSummary,
    lastLoginAt: userData.lastLoginAt,
    updatedAt: userData.updatedAt,
    createdAt: userData.createdAt,
    aiProfileScore:
      tenantData.aiProfileScore ??
      userData.aiProfileScore ??
      userData.aiScore ??
      userData.aiProfile?.score ??
      calculateProfileScore(userData),
    aiJobFitScore: tenantData.aiJobFitScore ?? userData.aiJobFitScore,
    userGroupIds: tenantData.userGroupIds || userData.userGroupIds || [],
    skills: normalizedSkills,
    city: userData.city || userData.address?.city || (userData.addressInfo && (userData.addressInfo as any).city) || '',
    state: userData.state || userData.address?.state || (userData.addressInfo && (userData.addressInfo as any).state) || '',
    workEligibility: userData.workEligibility,
    workEligibilityAttestation: userData.workEligibilityAttestation,
    comfortableEVerify: userData.comfortableEVerify,
    workerAttestations: userData.workerAttestations,
    resume: userData.resume ?? null,
    addedToIndeedFlex: userData.addedToIndeedFlex === true,
  };
}

/** Name, email (full + local-part + ignore spaces), phone, skills */
function userMatchesSearchTerm(user: RecruiterUser, rawSearch: string): boolean {
  const q = rawSearch.trim().toLowerCase();
  if (!q) return true;

  const fullName = `${user.firstName} ${user.lastName}`.trim().toLowerCase();
  if (fullName.includes(q)) return true;

  const email = (user.email || '').trim();
  const emailLower = email.toLowerCase();
  if (emailLower) {
    if (emailLower.includes(q)) return true;
    const compactEmail = emailLower.replace(/\s/g, '');
    const compactQ = q.replace(/\s/g, '');
    if (compactEmail.includes(compactQ)) return true;
    const at = emailLower.indexOf('@');
    if (at > 0) {
      const local = emailLower.slice(0, at);
      if (local.includes(q)) return true;
    }
  }

  if (user.phone?.toLowerCase().includes(q)) return true;
  const digits = (s: string) => s.replace(/\D/g, '');
  const qDigits = digits(q);
  if (qDigits.length >= 3 && user.phone && digits(user.phone).includes(qDigits)) return true;

  if (user.skills?.some((skill) => skill.toLowerCase().includes(q))) return true;

  return false;
}

export interface RecruiterUsersProps {
  hideHeader?: boolean;
  scope?: 'all' | 'my';
}

const RecruiterUsers: React.FC<RecruiterUsersProps> = ({ hideHeader = false, scope: scopeProp }) => {
  const navigate = useNavigate();
  const { activeTenant, user } = useAuth();
  const tenantId = activeTenant?.id;
  const { distribution: scoringDistribution } = useScoringDistribution(tenantId);
  const outletCtx = useOutletContext<RecruiterOutletContext | null>();
  const [localSearch, setLocalSearch] = useState('');
  const [localShowFavoritesOnly, setLocalShowFavoritesOnly] = useState(false);
  
  // All hooks must be called at the top level, before any conditional returns
  const isFetchingRef = useRef(false);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const filtersRef = useRef<HTMLDivElement | null>(null);
  
  // Page cache for search and filters
  const { cacheState, updateCache } = usePageCache({
    pageKey: 'users',
    defaultState: {
      usersScope: 'all',
      securityLevelFilter: 'all',
      groupFilter: 'all',
      skillFilter: 'all',
      stateFilter: 'all',
      sortBy: 'accountCreated',
      sortDirection: 'desc',
    },
  });
  
  // Use outlet context if available, otherwise use local state
  const searchTerm = outletCtx?.search !== undefined ? outletCtx.search : localSearch;
  const showFavoritesOnly = outletCtx?.showFavoritesOnly !== undefined ? outletCtx.showFavoritesOnly : localShowFavoritesOnly;
  
  const handleSearchChange = (value: string) => {
    if (outletCtx?.setSearch) {
      outletCtx.setSearch(value);
    } else {
      setLocalSearch(value);
    }
  };
  
  const handleFavoritesToggle = (value: boolean) => {
    if (outletCtx?.setShowFavoritesOnly) {
      outletCtx.setShowFavoritesOnly(value);
    } else {
      setLocalShowFavoritesOnly(value);
    }
  };

  const [users, setUsers] = useState<RecruiterUser[]>([]);
  const [groups, setGroups] = useState<TenantUserGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [usersScope, setUsersScope] = useState<'all' | 'my'>(
    cacheState.usersScope === 'my' ? 'my' : 'all'
  );

  // When embedded in UsersLayout, scope comes from route (prop); otherwise use local tab state
  const effectiveScope = scopeProp !== undefined ? scopeProp : usersScope;
  const showAllMyTabs = scopeProp === undefined;
  
  // Pagination state
  const [lastVisibleDoc, setLastVisibleDoc] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const PAGE_SIZE = 500; // Load up to 500 users at a time so search can filter locally without reloads

  // State - initialize from cache
  const [securityLevelFilter, setSecurityLevelFilter] = useState<SecurityLevel>(cacheState.securityLevelFilter || 'all');
  const [groupFilter, setGroupFilter] = useState<string>(cacheState.groupFilter || 'all');
  const [skillFilter, setSkillFilter] = useState<string>(cacheState.skillFilter || 'all');
  const [stateFilter, setStateFilter] = useState<string>(cacheState.stateFilter || 'all');
  const [sortBy, setSortBy] = useState<
    'recentlyUpdated' | 'lastLogin' | 'name' | 'aiScore' | 'interview' | 'accountCreated' | 'auth' | 'documented'
  >((cacheState.sortBy as any) || 'accountCreated');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>(cacheState.sortDirection || 'desc');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(20);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectAllResults, setSelectAllResults] = useState(false);
  const [bulkDrawerOpen, setBulkDrawerOpen] = useState(false);
  const [bulkDrawerChannel, setBulkDrawerChannel] = useState<'email' | 'sms'>('email');

  const { favorites, isFavorite, toggleFavorite } = useFavorites('users');

  const groupLookup = useMemo(() => {
    const map = new Map<string, TenantUserGroup>();
    groups.forEach((group) => map.set(group.id, group));
    return map;
  }, [groups]);

  // Reset pagination when core filters (excluding search) change
  useEffect(() => {
    if (!activeTenant?.id) return;

    loadGroups(activeTenant.id);
    // Reset and load fresh data when filters/sort change
    setUsers([]);
    setLastVisibleDoc(null);
    setHasMore(true);
    loadUsers(activeTenant.id, true);
  }, [activeTenant?.id, effectiveScope, securityLevelFilter, groupFilter, skillFilter, stateFilter, sortBy]);

  // Update cache when filters change
  useEffect(() => {
    updateCache({
      usersScope: effectiveScope,
      securityLevelFilter,
      groupFilter,
      skillFilter,
      stateFilter,
      sortBy,
      sortDirection,
    });
  }, [effectiveScope, securityLevelFilter, groupFilter, skillFilter, stateFilter, sortBy, sortDirection, updateCache]);

  // Reset client pagination when filters/search change
  useEffect(() => {
    setPage(0);
  }, [searchTerm, effectiveScope, securityLevelFilter, groupFilter, skillFilter, stateFilter, sortBy, showFavoritesOnly]);

  // When "show favorites only" is on, ensure favorited user ids are loaded so they appear in the table
  // (e.g. users starred as applicants on a job order are stored as user favorites and must show here)
  useEffect(() => {
    if (!showFavoritesOnly || !favorites.length || !tenantId) return;
    const existingIds = new Set(users.map((u) => u.id));
    const missingIds = favorites.filter((id) => !existingIds.has(id));
    if (missingIds.length === 0) return;

    const usersRef = collection(db, 'users');
    const chunk = <T,>(arr: T[], size: number): T[][] => {
      const out: T[][] = [];
      for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
      return out;
    };
    const IN_QUERY_LIMIT = 30;
    let cancelled = false;

    (async () => {
      for (const ids of chunk(missingIds, IN_QUERY_LIMIT)) {
        if (cancelled) return;
        try {
          const snap = await getDocs(query(usersRef, where(documentId(), 'in', ids)));
          const mapped = snap.docs
            .map((d) => mapUserDocToRecruiterUser(d, tenantId))
            .filter((u): u is RecruiterUser => !!u);
          if (mapped.length > 0) {
            setUsers((prev) => {
              const map = new Map(prev.map((u) => [u.id, u]));
              mapped.forEach((u) => map.set(u.id, u));
              return Array.from(map.values());
            });
          }
        } catch (e) {
          console.warn('RecruiterUsers: failed to load favorited users', e);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showFavoritesOnly, favorites, tenantId, users]);

  const handleSort = (key: 'name' | 'aiScore' | 'interview' | 'lastLogin' | 'auth' | 'documented') => {
    if (sortBy === key) {
      const newDirection = sortDirection === 'asc' ? 'desc' : 'asc';
      setSortDirection(newDirection);
      updateCache({ sortDirection: newDirection });
      return;
    }
    const newDirection = key === 'name' ? 'asc' : 'desc';
    setSortBy(key);
    setSortDirection(newDirection);
    updateCache({ sortBy: key, sortDirection: newDirection });
  };

  const loadGroups = async (tenantId: string) => {
    try {
      const groupsRef = collection(db, 'tenants', tenantId, 'userGroups');
      const snapshot = await getDocs(groupsRef);
      setGroups(snapshot.docs.map((doc) => ({ id: doc.id, ...(doc.data() as TenantUserGroup) })));
    } catch (err) {
      console.warn('RecruiterUsers: Failed to load user groups', err);
      setGroups([]);
    }
  };

  const loadUsers = async (tenantId: string, isInitialLoad = false) => {
    // Guard against overlapping/double-invoked fetches (React dev/StrictMode)
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;

    if (isInitialLoad) {
      setLoading(true);
    } else {
      setLoadingMore(true);
    }
    setError(null);

    try {
      const usersRef = collection(db, 'users');

      const chunk = <T,>(arr: T[], size: number): T[][] => {
        const out: T[][] = [];
        for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
        return out;
      };

      const extractUserId = (data: any): string | null => {
        if (!data || typeof data !== 'object') return null;
        const candidate =
          data.userId ||
          data.candidateId ||
          data.applicantId ||
          data.workerId ||
          data.employeeId ||
          data.uid ||
          data.userUID ||
          null;
        return typeof candidate === 'string' && candidate.trim() ? candidate : null;
      };

      if (effectiveScope === 'my') {
        const uid = user?.uid;
        if (!uid) {
          setUsers([]);
          setLastVisibleDoc(null);
          setHasMore(false);
          return;
        }

        // My Job Orders: assignedRecruiters contains me OR legacy recruiterId == me
        const jobOrdersRef = collection(db, 'tenants', tenantId, 'job_orders');
        const [snapAssigned, snapLegacy] = await Promise.all([
          getDocs(query(jobOrdersRef, where('assignedRecruiters', 'array-contains', uid), limit(500))),
          getDocs(query(jobOrdersRef, where('recruiterId', '==', uid), limit(500))),
        ]);
        const jobOrderIds = Array.from(
          new Set([...snapAssigned.docs.map((d) => d.id), ...snapLegacy.docs.map((d) => d.id)])
        );

        if (jobOrderIds.length === 0) {
          setUsers([]);
          setLastVisibleDoc(null);
          setHasMore(false);
          return;
        }

        const idSet = new Set<string>();
        const chunks = chunk(jobOrderIds, 10);

        const applicationsRef = collection(db, 'tenants', tenantId, 'applications');
        const jobApplicationsRef = collection(db, 'tenants', tenantId, 'job_applications');
        const assignmentsRef = collection(db, 'tenants', tenantId, 'assignments');

        await Promise.all(
          chunks.map(async (ids) => {
            try {
              const snap = await getDocs(query(applicationsRef, where('jobOrderId', 'in', ids)));
              snap.docs.forEach((d) => {
                const id = extractUserId(d.data());
                if (id) idSet.add(id);
              });
            } catch {
              // ignore
            }
          })
        );

        await Promise.all(
          chunks.map(async (ids) => {
            try {
              const snap = await getDocs(query(jobApplicationsRef, where('jobOrderId', 'in', ids)));
              snap.docs.forEach((d) => {
                const id = extractUserId(d.data());
                if (id) idSet.add(id);
              });
            } catch {
              // ignore
            }
          })
        );

        await Promise.all(
          chunks.map(async (ids) => {
            try {
              const snap = await getDocs(query(assignmentsRef, where('jobOrderId', 'in', ids)));
              snap.docs.forEach((d) => {
                const id = extractUserId(d.data());
                if (id) idSet.add(id);
              });
            } catch {
              // ignore
            }
          })
        );

        const myUserIds = Array.from(idSet);
        if (myUserIds.length === 0) {
          setUsers([]);
          setLastVisibleDoc(null);
          setHasMore(false);
          return;
        }

        const userIdChunks = chunk(myUserIds, 10);
        const userDocs = (
          await Promise.all(
            userIdChunks.map(async (ids) => {
              const snap = await getDocs(query(usersRef, where(documentId(), 'in', ids)));
              return snap.docs;
            })
          )
        ).flat();

        const mapped = userDocs
          .map((d) => mapUserDocToRecruiterUser(d, tenantId))
          .filter((u): u is RecruiterUser => !!u);

        setUsers(mapped);
        setLastVisibleDoc(null);
        setHasMore(false);
        return;
      }
      
      // Build base query
      let q = query(
        usersRef,
        where(`tenantIds.${tenantId}.securityLevel`, 'in', ['0', '1', '2', '3', '4'])
      );

      // Add ordering for pagination (required for startAfter)
      q = query(q, orderBy('createdAt', 'desc'));
      
      // When search or filters are active, load more aggressively (up to 500 users)
      // This ensures search/filters query the full collection
      const hasActiveFilters = searchTerm || 
        securityLevelFilter !== 'all' || 
        groupFilter !== 'all' || 
        skillFilter !== 'all' || 
        stateFilter !== 'all';
      
      const effectivePageSize = hasActiveFilters ? 500 : PAGE_SIZE;
      
      // Add limit
      q = query(q, limit(effectivePageSize));
      
      // If loading more, start after last document
      if (!isInitialLoad && lastVisibleDoc) {
        q = query(q, startAfter(lastVisibleDoc));
      }

      const snapshot = await getDocs(q);
      
      // Track last document for pagination
      const lastDoc = snapshot.docs[snapshot.docs.length - 1];
      setLastVisibleDoc(lastDoc || null);
      setHasMore(snapshot.docs.length === effectivePageSize);

      const data: RecruiterUser[] = snapshot.docs
        .map((userDoc) => mapUserDocToRecruiterUser(userDoc, tenantId))
        .filter((u): u is RecruiterUser => !!u);
      
      // If initial load, replace users; if loading more, append (dedupe by id)
      setUsers((prev) => {
        const map = new Map<string, RecruiterUser>();
        if (!isInitialLoad) {
          prev.forEach((u) => map.set(u.id, u));
        }
        data.forEach((u) => map.set(u.id, u));
        return Array.from(map.values());
      });
    } catch (err) {
      console.error('RecruiterUsers: Failed to load users', err);
      setError('Unable to load users. Please try again.');
    } finally {
      setLoading(false);
      setLoadingMore(false);
      isFetchingRef.current = false;
    }
  };
  
  // Load more users when clicking "Load More"
  const loadMoreUsers = () => {
    if (effectiveScope === 'my') return;
    if (!activeTenant?.id || loadingMore || !hasMore) return;
    loadUsers(activeTenant.id, false);
  };

  const getSecurityLevelLabel = (level: string): string => {
    switch (level) {
      case '0':
        return 'Suspended';
      case '1':
        return 'Dismissed';
      case '2':
        return 'Applicant';
      case '3':
        return 'Candidate';
      case '4':
        return 'Staff';
      default:
        return level;
    }
  };

  const getSecurityLevelColor = (level: string):
    | 'default'
    | 'primary'
    | 'secondary'
    | 'success'
    | 'error'
    | 'warning'
    | 'info' => {
    switch (level) {
      case '0':
        return 'error';
      case '1':
        return 'default';
      case '2':
        return 'info';
      case '3':
        return 'primary';
      case '4':
        return 'success';
      default:
        return 'default';
    }
  };

  const formatDate = (timestamp: any) => {
    if (timestamp == null) return 'N/A';
    let date: Date;
    if (timestamp instanceof Date) {
      date = timestamp;
    } else if (typeof timestamp === 'number') {
      date = new Date(timestamp);
    } else if (typeof timestamp === 'string') {
      date = new Date(timestamp);
    } else if (timestamp?.toDate && typeof timestamp.toDate === 'function') {
      date = timestamp.toDate();
    } else if (timestamp?._seconds) {
      date = new Date(timestamp._seconds * 1000);
    } else {
      return 'N/A';
    }
    if (Number.isNaN(date.getTime())) return 'N/A';
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const renderAiScore = (user: RecruiterUser) => {
    const rawScore =
      user.scoreSummary?.aiScore ??
      user.aiJobFitScore ??
      user.aiProfileScore;
    if (rawScore === undefined || rawScore === null || Number.isNaN(rawScore)) {
      return <Typography variant="body2" color="text.secondary">N/A</Typography>;
    }
    const relativeScore = getRelativeAiScore(rawScore, scoringDistribution);
    const displayScore = relativeScore != null ? relativeScore : Math.round(rawScore);
    const showRelative = relativeScore != null;

    let color: 'default' | 'success' | 'warning' | 'error' = 'default';
    if (displayScore >= 80) color = 'success';
    else if (displayScore >= 60) color = 'warning';
    else color = 'default';

    return (
      <Tooltip
        arrow
        title={
          <Box sx={{ p: 0.5 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
              Score Summary
            </Typography>
            <Stack spacing={0.25}>
              <Typography variant="body2">
                AI: <strong>{Math.round(rawScore)}</strong>
                {showRelative ? ` (relative: ${displayScore})` : ''}
              </Typography>
              <Typography variant="body2">
                Interview: <strong>{formatOneDecimal(user.scoreSummary?.interviewAvg)}</strong>/10
                {user.scoreSummary?.interviewCount ? ` (${user.scoreSummary.interviewCount})` : ''}
              </Typography>
              <Typography variant="body2">
                Reviews: <strong>{formatOneDecimal(user.scoreSummary?.reviewAvg)}</strong>/5
                {user.scoreSummary?.reviewCount ? ` (${user.scoreSummary.reviewCount})` : ''}
              </Typography>
            </Stack>
          </Box>
        }
      >
        <Chip
          icon={<InsightsIcon sx={{ fontSize: 16 }} />}
          label={`${displayScore}`}
          color={color}
          size="small"
          variant={color === 'default' ? 'outlined' : 'filled'}
          sx={{ minWidth: 96, justifyContent: 'flex-start' }}
        />
      </Tooltip>
    );
  };

  const uniqueSkills = useMemo(() => {
    const set = new Set<string>();
    users.forEach((user) => {
      user.skills?.forEach((skill) => set.add(skill));
    });
    return Array.from(set).sort();
  }, [users]);

  const filteredUsers = useMemo(() => {
    return users
      .filter((user) => {
        if (showFavoritesOnly && !favorites.includes(user.id)) {
          return false;
        }

        if (securityLevelFilter !== 'all') {
          const onboardingType = String(user.onboardingType || '').toLowerCase();
          const employeeStatus = String(user.employeeOnboardStatus || '').toLowerCase();
          const contractorStatus = String(user.contractorOnboardStatus || '').toLowerCase();

          const isEmployee =
            onboardingType === 'employee' ||
            employeeStatus === 'in progress' ||
            employeeStatus === 'completed';
          const isContractor =
            onboardingType === 'contractor' ||
            contractorStatus === 'in progress' ||
            contractorStatus === 'completed';

          const isActiveEmployee = user.securityLevel === '4' && isEmployee;
          const isActiveContractor = user.securityLevel === '4' && isContractor;
          const isOnboarding = employeeStatus === 'in progress' || contractorStatus === 'in progress';

          if (securityLevelFilter === 'active_employee') {
            if (!isActiveEmployee) return false;
          } else if (securityLevelFilter === 'active_contractor') {
            if (!isActiveContractor) return false;
          } else if (securityLevelFilter === 'onboarding') {
            if (!isOnboarding) return false;
          } else if (user.securityLevel !== securityLevelFilter) {
            // Back-compat: allow older cached values like "4"
            return false;
          }
        }

        if (groupFilter !== 'all' && !user.userGroupIds.includes(groupFilter)) {
          return false;
        }

        if (skillFilter !== 'all') {
          return user.skills?.includes(skillFilter);
        }

        if (stateFilter !== 'all' && user.state !== stateFilter) {
          return false;
        }

        return userMatchesSearchTerm(user, searchTerm);
      })
      .sort((a, b) => {
        switch (sortBy) {
          case 'recentlyUpdated': {
            // For desc (newest first): (b - a) gives positive when b is newer, which puts b before a ✓
            // For asc (oldest first): (a - b) gives negative when b is newer, which puts a before b ✓
            const diff = getUpdatedMillis(b) - getUpdatedMillis(a);
            return sortDirection === 'desc' ? diff : -diff;
          }
          case 'lastLogin': {
            const diff = getLoginMillis(b) - getLoginMillis(a);
            return sortDirection === 'desc' ? diff : -diff;
          }
          case 'accountCreated': {
            // For desc (newest first): (b - a) gives positive when b is newer, which puts b before a ✓
            // For asc (oldest first): (a - b) gives negative when b is newer, which puts a before b ✓
            const diff = getCreatedMillis(b) - getCreatedMillis(a);
            return sortDirection === 'desc' ? diff : -diff;
          }
          case 'name': {
            const nameCompare = `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`);
            return sortDirection === 'asc' ? nameCompare : -nameCompare;
          }
          case 'aiScore': {
            const aScore = a.scoreSummary?.aiScore ?? a.aiJobFitScore ?? a.aiProfileScore ?? -1;
            const bScore = b.scoreSummary?.aiScore ?? b.aiJobFitScore ?? b.aiProfileScore ?? -1;
            const diff = (bScore ?? -1) - (aScore ?? -1);
            return sortDirection === 'desc' ? diff : -diff;
          }
          case 'interview': {
            const diff = getInterviewMillis(b) - getInterviewMillis(a);
            return sortDirection === 'desc' ? diff : -diff;
          }
          case 'auth': {
            const aStatus = getWorkAuthorizedStatus(a);
            const bStatus = getWorkAuthorizedStatus(b);
            const cmp = compareWorkAuthorized(aStatus, bStatus);
            return sortDirection === 'asc' ? cmp : -cmp;
          }
          case 'documented': {
            const aEv = getEVerifyComfortStatusFromUserData(a);
            const bEv = getEVerifyComfortStatusFromUserData(b);
            const cmp = compareEVerifyComfort(aEv, bEv);
            return sortDirection === 'asc' ? cmp : -cmp;
          }
          default:
            return 0;
        }
      });
  }, [
    favorites,
    groupFilter,
    searchTerm,
    securityLevelFilter,
    showFavoritesOnly,
    skillFilter,
    stateFilter,
    sortBy,
    sortDirection,
    users,
  ]);

  const filteredUserIdsForAssignments = useMemo(() => filteredUsers.map((u) => u.id), [filteredUsers]);
  const activeAssignmentUserIds = useActiveAssignmentUserIds(tenantId, filteredUserIdsForAssignments);

  const getWorkStatusDisplay = (u: RecruiterUser) =>
    getWorkStatusColumnDisplay(u, { hasActiveAssignment: activeAssignmentUserIds.has(u.id) });

  const paginatedUsers = useMemo(() => {
    const start = page * rowsPerPage;
    const end = start + rowsPerPage;
    return filteredUsers.slice(start, end);
  }, [filteredUsers, page, rowsPerPage]);

  const paginatedUserIds = useMemo(() => paginatedUsers.map((u) => u.id), [paginatedUsers]);
  const { itemsByUserId: entityEmploymentChipsByUser, loading: entityEmploymentChipsLoading } =
    useRecruiterUsersEntityEmploymentChips(activeTenant?.id, paginatedUserIds);

  const selectedCount = selectAllResults ? filteredUsers.length : selectedIds.size;
  const allOnPageSelected =
    paginatedUsers.length > 0 &&
    (selectAllResults || paginatedUsers.every((u) => selectedIds.has(u.id)));
  const someOnPageSelected =
    !selectAllResults && paginatedUsers.some((u) => selectedIds.has(u.id));

  const handleSelectAllOnPage = () => {
    if (allOnPageSelected) {
      if (selectAllResults) {
        setSelectAllResults(false);
        const remaining = new Set(filteredUsers.map((u) => u.id));
        paginatedUsers.forEach((u) => remaining.delete(u.id));
        setSelectedIds(remaining);
      } else {
        const next = new Set(selectedIds);
        paginatedUsers.forEach((u) => next.delete(u.id));
        setSelectedIds(next);
      }
    } else {
      const next = new Set(selectedIds);
      paginatedUsers.forEach((u) => next.add(u.id));
      setSelectedIds(next);
    }
  };

  const handleSelectRow = (userId: string, checked: boolean) => {
    if (selectAllResults) {
      if (checked) return;
      setSelectAllResults(false);
      const next = new Set(filteredUsers.map((u) => u.id));
      next.delete(userId);
      setSelectedIds(next);
    } else {
      const next = new Set(selectedIds);
      if (checked) next.add(userId);
      else next.delete(userId);
      setSelectedIds(next);
    }
  };

  const handleSelectAllResults = () => {
    setSelectAllResults(true);
    setSelectedIds(new Set());
  };

  const handleClearSelection = () => {
    setSelectAllResults(false);
    setSelectedIds(new Set());
  };

  const bulkRecipientsAndIds = useMemo(() => {
    const usersToUse = selectAllResults ? filteredUsers : filteredUsers.filter((u) => selectedIds.has(u.id));
    const recipients: MessageRecipient[] = usersToUse.map((u) => ({
      userId: u.id,
      name: [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email || u.id,
      email: u.email,
      phone: u.phone ? formatPhoneNumber(u.phone) : undefined,
    }));
    const recipientUserIds = usersToUse.map((u) => u.id);
    return { recipients, recipientUserIds };
  }, [selectAllResults, selectedIds, filteredUsers]);

  // If user paginates beyond what's loaded, auto-fetch more in the background
  useEffect(() => {
    if (!activeTenant?.id) return;
    if (!hasMore || loadingMore) return;
    const needed = (page + 1) * rowsPerPage;
    if (needed > users.length) {
      loadMoreUsers();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, rowsPerPage, users.length, hasMore, loadingMore, activeTenant?.id]);

  if (error) {
    return (
      <Alert severity="error" sx={{ maxWidth: 640 }}>
        {error}
      </Alert>
    );
  }

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {!hideHeader && (
        <PageHeader
          title={
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: 2 }}>
              <Typography
                variant="h6"
                sx={{
                  fontSize: { xs: '20px', md: '24px' },
                  fontWeight: 600,
                  lineHeight: 1.2,
                }}
              >
                Users
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexShrink: 0 }}>
                <InboxSearchBar
                  value={searchTerm}
                  onChange={handleSearchChange}
                  onSearch={handleSearchChange}
                  placeholder="Search by name, email, or phone..."
                />
                <FavoritesFilter
                  favoriteType="users"
                  showFavoritesOnly={showFavoritesOnly}
                  onToggle={handleFavoritesToggle}
                  showText={false}
                  size="small"
                  sx={{
                    minWidth: '32px',
                    width: '32px',
                    height: '32px',
                    borderRadius: '50%',
                    '&:hover': {
                      backgroundColor: showFavoritesOnly ? 'primary.dark' : 'action.hover',
                    },
                  }}
                />
              </Box>
            </Box>
          }
        />
      )}
      <Box
        ref={contentRef}
        sx={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          overflowX: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Filter & Toolbar Area */}
        <Box
          ref={filtersRef}
          sx={{ 
            mt: 0,
            mb: 0,
            px: 1.5,
            py: 1.25,
            backgroundColor: '#F9FAFB',
            borderRadius: 0,
            border: '1px solid #E5E7EB',
            borderBottom: '1px solid #EAEEF4',
            overflowX: 'auto',
            overflowY: 'hidden',
            position: 'sticky',
            top: 0,
            zIndex: 15,
          }}
        >
          <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'nowrap', minWidth: 'max-content' }}>
            {showAllMyTabs && (
              <Box sx={{ display: 'flex', gap: 0.5, mr: 0.5 }}>
                {[
                  { label: 'All Users', value: 'all' as const },
                  { label: 'My Users', value: 'my' as const },
                ].map((t) => {
                  const isActive = usersScope === t.value;
                  return (
                    <Button
                      key={t.value}
                      onClick={() => {
                        setUsersScope(t.value);
                        updateCache({ usersScope: t.value });
                      }}
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
            )}
            <FormControl size="small" sx={{ minWidth: 160, height: 36 }}>
              <InputLabel sx={{ fontSize: '0.875rem' }}>Status</InputLabel>
              <Select
                label="Status"
                value={securityLevelFilter}
                onChange={(event: SelectChangeEvent<SecurityLevel>) => {
                  const newFilter = event.target.value as SecurityLevel;
                  setSecurityLevelFilter(newFilter);
                  updateCache({ securityLevelFilter: newFilter });
                }}
                sx={{
                  height: 36,
                  borderRadius: '6px',
                  backgroundColor: 'white',
                  fontSize: '0.875rem',
                }}
              >
                <MenuItem value="all">All Statuses</MenuItem>
                <MenuItem value="active_contractor">Active Contractors</MenuItem>
                <MenuItem value="active_employee">Active Employees</MenuItem>
                <MenuItem value="onboarding">Onboarding</MenuItem>
                <MenuItem value="3">Candidates</MenuItem>
                <MenuItem value="2">Applicants</MenuItem>
                <MenuItem value="1">Dismissed</MenuItem>
                <MenuItem value="0">Suspended</MenuItem>
              </Select>
            </FormControl>

            <Autocomplete
              size="small"
              options={groups}
              getOptionLabel={(option) => option.title || option.id || 'Unnamed Group'}
              value={groupFilter === 'all' ? null : groups.find(g => g.id === groupFilter) || null}
              onChange={(_, newValue) => {
                const newFilter = newValue ? newValue.id : 'all';
                setGroupFilter(newFilter);
                updateCache({ groupFilter: newFilter });
              }}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="User Group"
                  placeholder="Search groups..."
                  sx={{ minWidth: 160 }}
                />
              )}
            />

            <Autocomplete
              size="small"
              options={uniqueSkills}
              value={skillFilter === 'all' ? null : skillFilter}
              onChange={(_, newValue) => {
                const newFilter = newValue || 'all';
                setSkillFilter(newFilter);
                updateCache({ skillFilter: newFilter });
              }}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Primary Skill"
                  placeholder="Search skills..."
                  sx={{ minWidth: 160 }}
                />
              )}
            />

            {/* State Filter */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <FormControl size="small" sx={{ minWidth: 160, height: 36 }}>
                <InputLabel sx={{ fontSize: '0.875rem' }}>State Filter</InputLabel>
                <Select
                  value={stateFilter}
                  onChange={(e) => {
                    const newFilter = String(e.target.value);
                    setStateFilter(newFilter);
                    updateCache({ stateFilter: newFilter });
                  }}
                  label="State Filter"
                  sx={{
                    height: 36,
                    borderRadius: '6px',
                    backgroundColor: 'white',
                    fontSize: '0.875rem',
                  }}
                >
                  <MenuItem value="all">All States</MenuItem>
                  {['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'].map((st) => (
                    <MenuItem key={st} value={st}>{st}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              <IconButton
                size="small"
                aria-label="Clear state filter"
                onClick={() => {
                  setStateFilter('all');
                  updateCache({ stateFilter: 'all' });
                }}
                disabled={stateFilter === 'all'}
                sx={{ height: 36, width: 36, p: 0.75 }}
              >
                <ClearIcon fontSize="small" />
              </IconButton>
            </Box>

            <FormControl size="small" sx={{ minWidth: 180, height: 36 }}>
              <InputLabel sx={{ fontSize: '0.875rem' }}>Sort By</InputLabel>
              <Select
                label="Sort By"
                value={sortBy}
                onChange={(event) => {
                  const newSortBy = event.target.value as typeof sortBy;
                  setSortBy(newSortBy);
                  updateCache({ sortBy: newSortBy });
                }}
                sx={{
                  height: 36,
                  borderRadius: '6px',
                  backgroundColor: 'white',
                  fontSize: '0.875rem',
                }}
              >
                <MenuItem value="accountCreated">Account Creation (Newest)</MenuItem>
                <MenuItem value="recentlyUpdated">Recently Updated</MenuItem>
                <MenuItem value="lastLogin">Last Login</MenuItem>
                <MenuItem value="auth">Auth</MenuItem>
                <MenuItem value="documented">Documented</MenuItem>
                <MenuItem value="aiScore">AI Score</MenuItem>
                <MenuItem value="name">Name (A-Z)</MenuItem>
              </Select>
            </FormControl>
          </Box>
        </Box>

        {/* Initial loading indicator */}
        {loading && users.length === 0 && (
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 200, py: 4 }}>
            <CircularProgress size={24} />
          </Box>
        )}

        {!loading || users.length > 0 ? (
          <>
          <Box sx={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            {/* Loading overlay */}
            {loading && users.length > 0 && (
              <Box
                sx={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  backgroundColor: 'rgba(255, 255, 255, 0.8)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  zIndex: 1000,
                  borderRadius: '8px',
                }}
              >
                <CircularProgress size={40} />
              </Box>
            )}
            
            {/* No Results Found message */}
            {!loading && filteredUsers.length === 0 && (
              <Box
                sx={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  zIndex: 999,
                  flexDirection: 'column',
                  gap: 2,
                }}
              >
                <Typography variant="h6" color="text.secondary" sx={{ fontWeight: 500 }}>
                  No Results Found
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Try adjusting your search or filters
                </Typography>
              </Box>
            )}

          {selectedCount > 0 && (
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                px: 2,
                py: 1.25,
                backgroundColor: 'action.selected',
                border: '1px solid',
                borderColor: 'divider',
                borderBottom: 'none',
                borderRadius: '8px 8px 0 0',
              }}
            >
              <Typography variant="body2" sx={{ fontWeight: 500 }}>
                {selectAllResults
                  ? `All ${filteredUsers.length} result${filteredUsers.length === 1 ? '' : 's'} selected`
                  : `${selectedCount} selected`}
              </Typography>
              <Button size="small" onClick={handleClearSelection} sx={{ textTransform: 'none' }}>
                Clear selection
              </Button>
              {allOnPageSelected && !selectAllResults && filteredUsers.length > paginatedUsers.length && (
                <Button size="small" variant="outlined" onClick={handleSelectAllResults} sx={{ textTransform: 'none' }}>
                  Select all {filteredUsers.length} results
                </Button>
              )}
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
            </Box>
          )}

          <TableContainer
            component={Paper}
            elevation={0}
            sx={{
              borderRadius: 2,
              border: '1px solid #EAEEF4',
              ...(selectedCount > 0 && { borderRadius: '0 0 8px 8px' }),
              position: 'relative',
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0,
              overflowY: 'auto',
              overflowX: 'auto',
              width: '100%',
              px: 2, // 16px padding left and right
              '&::-webkit-scrollbar': { width: '8px', height: '8px' },
              '&::-webkit-scrollbar-track': {
                background: 'rgba(0, 0, 0, 0.02)',
                borderRadius: '4px',
              },
              '&::-webkit-scrollbar-thumb': {
                background: 'rgba(0, 0, 0, 0.15)',
                borderRadius: '4px',
                '&:hover': { background: 'rgba(0, 0, 0, 0.25)' },
              },
              scrollbarWidth: 'thin',
              scrollbarColor: 'rgba(0, 0, 0, 0.15) rgba(0, 0, 0, 0.02)',
            }}
          >
        <Table size="small" stickyHeader sx={{ width: '100%' }}>
          <TableHead
            sx={{
              position: 'sticky',
              top: 0,
              zIndex: 10,
              backgroundColor: 'background.paper',
              borderRadius: 0,
              '& .MuiTableCell-root': {
                borderRadius: 0,
              },
            }}
          >
            <TableRow sx={{ backgroundColor: 'background.paper', borderRadius: 0 }}>
                <TableCell padding="checkbox" sx={{ width: 48, bgcolor: '#FFFFFF', borderRadius: 0 }}>
                  <Checkbox
                    size="small"
                    checked={allOnPageSelected}
                    indeterminate={someOnPageSelected}
                    onChange={handleSelectAllOnPage}
                    aria-label="Select all on page"
                  />
                </TableCell>
                <TableCell sx={{ width: 60, bgcolor: '#FFFFFF', borderRadius: 0 }} />
                <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem', borderRadius: 0, minWidth: 200 }}>
                  <TableSortLabel
                    active={sortBy === 'name'}
                    direction={sortBy === 'name' ? sortDirection : 'asc'}
                    onClick={() => handleSort('name')}
                  >
                    Person
                  </TableSortLabel>
                </TableCell>
                <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem', borderRadius: 0 }}>
                  Contact
                </TableCell>
                <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem', borderRadius: 0 }}>
                  Work Status
                </TableCell>
                <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem', borderRadius: 0 }}>
                  <TableSortLabel
                    active={sortBy === 'auth'}
                    direction={sortBy === 'auth' ? sortDirection : 'desc'}
                    onClick={() => handleSort('auth')}
                  >
                    Auth
                  </TableSortLabel>
                </TableCell>
                <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem', borderRadius: 0 }}>
                  <TableSortLabel
                    active={sortBy === 'documented'}
                    direction={sortBy === 'documented' ? sortDirection : 'desc'}
                    onClick={() => handleSort('documented')}
                  >
                    Documented
                  </TableSortLabel>
                </TableCell>
                <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem', borderRadius: 0 }}>
                  <TableSortLabel
                    active={sortBy === 'aiScore'}
                    direction={sortBy === 'aiScore' ? sortDirection : 'desc'}
                    onClick={() => handleSort('aiScore')}
                  >
                    Score
                  </TableSortLabel>
                </TableCell>
                <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem', borderRadius: 0 }}>
                  <TableSortLabel
                    active={sortBy === 'interview'}
                    direction={sortBy === 'interview' ? sortDirection : 'desc'}
                    onClick={() => handleSort('interview')}
                  >
                    Interview
                  </TableSortLabel>
                </TableCell>
                <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem', borderRadius: 0, minWidth: 200 }}>
                  Status
                </TableCell>
                <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem', borderRadius: 0 }}>
                  Groups
                </TableCell>
                <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem', borderRadius: 0 }}>
                  Skills
                </TableCell>
                <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem', minWidth: 200, borderRadius: 0 }}>
                  <TableSortLabel
                    active={sortBy === 'lastLogin'}
                    direction={sortBy === 'lastLogin' ? sortDirection : 'desc'}
                    onClick={() => handleSort('lastLogin')}
                  >
                    Last Login
                  </TableSortLabel>
                </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {paginatedUsers.map((user, index) => (
              <TableRow
                key={user.id}
                hover
                sx={{
                  cursor: 'pointer',
                  backgroundColor: index % 2 === 0 ? 'background.paper' : 'action.hover',
                  '&:hover': {
                    backgroundColor: 'action.selected',
                  },
                }}
                onClick={() => navigate(`/users/${user.id}`)}
              >
                  <TableCell padding="checkbox" onClick={(e) => e.stopPropagation()} sx={{ width: 48 }}>
                    <Checkbox
                      size="small"
                      checked={selectAllResults || selectedIds.has(user.id)}
                      onChange={(_, checked) => handleSelectRow(user.id, checked)}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`Select ${user.firstName} ${user.lastName}`}
                    />
                  </TableCell>
                  <TableCell onClick={(event) => event.stopPropagation()}>
                    <FavoriteButton
                      itemId={user.id}
                      favoriteType="users"
                      isFavorite={isFavorite}
                      toggleFavorite={toggleFavorite}
                      size="small"
                      tooltipText={{
                        favorited: 'Remove from favorites',
                        notFavorited: 'Add to favorites',
                      }}
                    />
                  </TableCell>
                  <TableCell sx={{ minWidth: 200 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0 }}>
                      <Avatar
                        src={user.avatar}
                        alt={`${user.firstName} ${user.lastName}`}
                        sx={{ width: TABLE_AVATAR_SIZE, height: TABLE_AVATAR_SIZE, flexShrink: 0 }}
                      >
                        {user.firstName?.[0]}
                      </Avatar>
                      <Box sx={{ minWidth: 0, overflow: 'hidden' }}>
                        <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
                          {user.firstName} {user.lastName}
                        </Typography>
                        {(user.createdAt ||
                          pickResumeFromUserDoc(user as unknown as Record<string, unknown>)) && (
                          <Box
                            sx={{
                              display: 'flex',
                              alignItems: 'center',
                              flexWrap: 'nowrap',
                              gap: '6px',
                              mt: 0.25,
                            }}
                          >
                            {user.createdAt && (
                              <Typography
                                variant="caption"
                                color="text.secondary"
                                component="span"
                                sx={{ lineHeight: 1.2 }}
                              >
                                {formatDate(user.createdAt)}
                              </Typography>
                            )}
                            <UserTableResumeIcon user={user as unknown as Record<string, unknown>} />
                          </Box>
                        )}
                        <UserTableIndeedFlexBadge user={user as unknown as Record<string, unknown>} />
                      </Box>
                    </Box>
                  </TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <EmailIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                        <Typography variant="body2" sx={{ fontSize: '0.85rem' }}>
                          {user.email}
                        </Typography>
                      </Box>
                      {user.phone && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          <PhoneIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                          <Typography variant="body2" sx={{ fontSize: '0.85rem' }}>
                            {formatPhoneNumber(user.phone)}
                          </Typography>
                        </Box>
                      )}
                      {(user.city || user.state) && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          <LocationOnIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                          <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.85rem' }}>
                            {[user.city, user.state].filter(Boolean).join(', ')}
                          </Typography>
                        </Box>
                      )}
                    </Box>
                  </TableCell>
                  <TableCell>
                    {(() => {
                      const ws = getWorkStatusDisplay(user);
                      return (
                        <Chip
                          size="small"
                          label={ws.label}
                          color={ws.color}
                          sx={ws.sx}
                        />
                      );
                    })()}
                  </TableCell>
                  <TableCell>
                    <WorkAuthorizedChip status={getWorkAuthorizedStatus(user)} />
                  </TableCell>
                  <TableCell>
                    <EVerifyComfortChip status={getEVerifyComfortStatusFromUserData(user)} />
                  </TableCell>
                  <TableCell>{renderAiScore(user)}</TableCell>
                  <TableCell>
                    <InterviewCell
                      userId={user.id}
                      scoreSummary={user.scoreSummary}
                      formatDate={formatDate}
                    />
                  </TableCell>
                  <TableCell sx={{ verticalAlign: 'middle', py: 0.75 }}>
                    <UserEntityOnboardingStatusCell
                      items={entityEmploymentChipsByUser.get(user.id) ?? []}
                      loading={entityEmploymentChipsLoading}
                    />
                  </TableCell>
                  <TableCell>
                    {user.userGroupIds.length === 0 ? (
                      <Typography variant="body2" color="text.secondary">—</Typography>
                    ) : (
                      <Tooltip
                        title={
                          user.userGroupIds.length <= 1
                            ? (groupLookup.get(user.userGroupIds[0])?.title || user.userGroupIds[0])
                            : (
                              <Box component="span" sx={{ display: 'block', maxHeight: 320, overflowY: 'auto', py: 0.5 }}>
                                {user.userGroupIds.map((id) => (
                                  <Typography key={id} component="span" variant="body2" sx={{ display: 'block' }}>
                                    {groupLookup.get(id)?.title || id}
                                  </Typography>
                                ))}
                              </Box>
                            )
                        }
                        placement="top"
                        enterDelay={300}
                        disableInteractive={false}
                      >
                        <Typography variant="body2" noWrap component="span" sx={{ display: 'block' }}>
                          {groupLookup.get(user.userGroupIds[0])?.title || user.userGroupIds[0]}
                          {user.userGroupIds.length > 1 ? '…' : ''}
                        </Typography>
                      </Tooltip>
                    )}
                  </TableCell>
                  <TableCell>
                    {!user.skills?.length ? (
                      <Typography variant="body2" color="text.secondary">—</Typography>
                    ) : (
                      <Tooltip
                        title={
                          user.skills.length <= 1
                            ? toChipLabel(user.skills[0])
                            : (
                              <Box component="span" sx={{ display: 'block', maxHeight: 320, overflowY: 'auto', py: 0.5 }}>
                                {user.skills.map((skill, i) => (
                                  <Typography key={`${toChipLabel(skill)}-${i}`} component="span" variant="body2" sx={{ display: 'block' }}>
                                    {toChipLabel(skill)}
                                  </Typography>
                                ))}
                              </Box>
                            )
                        }
                        placement="top"
                        enterDelay={300}
                        disableInteractive={false}
                      >
                        <Typography variant="body2" noWrap component="span" sx={{ display: 'block' }}>
                          {toChipLabel(user.skills[0])}
                          {user.skills.length > 1 ? '…' : ''}
                        </Typography>
                      </Tooltip>
                    )}
                  </TableCell>
                  <TableCell sx={{ minWidth: 200 }}>
                    <Typography variant="body2">{formatDate(user.lastLoginAt)}</Typography>
                  </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

          <StandardTablePagination
            count={filteredUsers.length}
            page={page}
            onPageChange={(_, newPage) => setPage(newPage)}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={(e) => {
              setRowsPerPage(parseInt(e.target.value, 10));
              setPage(0);
            }}
          />
          </Box>
          </>
        ) : null}
      </Box>

      <MessageDrawer
        open={bulkDrawerOpen}
        onClose={() => setBulkDrawerOpen(false)}
        recipients={bulkRecipientsAndIds.recipients}
        tenantId={activeTenant?.id}
        bulkSystemMode={true}
        recipientUserIds={bulkRecipientsAndIds.recipientUserIds}
        defaultChannels={[bulkDrawerChannel]}
        onSend={() => {
          handleClearSelection();
          setBulkDrawerOpen(false);
        }}
      />
    </Box>
  );
};

const toMillis = (input: any): number => {
  if (!input) return 0;
  if (input instanceof Date) return input.getTime();
  if (typeof input === 'number') return input;
  if (typeof input === 'string') {
    const parsed = Date.parse(input);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  if (typeof input === 'object') {
    if (typeof input.toDate === 'function') {
      return input.toDate().getTime();
    }
    if (typeof input._seconds === 'number') {
      return input._seconds * 1000;
    }
  }
  return 0;
};

const getUpdatedMillis = (user: RecruiterUser) => toMillis(user.updatedAt) || toMillis(user.createdAt);
const getLoginMillis = (user: RecruiterUser) => toMillis(user.lastLoginAt) || toMillis(user.createdAt);
const getCreatedMillis = (user: RecruiterUser) => toMillis(user.createdAt);
const getInterviewMillis = (user: RecruiterUser) => toMillis(user.scoreSummary?.interviewLastAt);

export default RecruiterUsers;

