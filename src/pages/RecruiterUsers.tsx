import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Avatar,
  Autocomplete,
  Box,
  Button,
  Checkbox,
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
  Chip,
} from '@mui/material';
import EmailIcon from '@mui/icons-material/Email';
import SmsIcon from '@mui/icons-material/Sms';
import MessageDrawer, { type MessageRecipient } from '../components/MessageDrawer';
import ClearIcon from '@mui/icons-material/Clear';
import IconButton from '@mui/material/IconButton';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { collection, getDocs, getDoc, doc, query, where, limit, startAfter, orderBy, QueryDocumentSnapshot, DocumentData, documentId } from 'firebase/firestore';
import FavoriteButton from '../components/FavoriteButton';
import { usePageCache } from '../hooks/usePageCache';
import StandardTablePagination from '../components/StandardTablePagination';
import PageHeader from '../components/PageHeader';
import InboxSearchBar from '../components/InboxSearchBar';
import FavoritesFilter from '../components/FavoritesFilter';
import { useFavorites } from '../hooks/useFavorites';
import { useAuth } from '../contexts/AuthContext';
import { db, functions } from '../firebase';
import { callSearchRecruiterTableUsers } from '../services/searchRecruiterTableUsersCallable';
import { formatFirebaseHttpsError } from '../utils/firebaseHttpsErrors';
import { calculateProfileScore } from '../utils/applicantScoring';
import { formatPhoneNumber } from '../utils/formatPhone';
import { normalizeUsStateCode } from '../utils/usStateNormalize';
import { TABLE_AVATAR_SIZE } from '../utils/uiConstants';
import { sanitizeWorkerNameParts } from '../utils/profileDisplayName';
import RecruiterUserTableContactBlock from '../components/tables/RecruiterUserTableContactBlock';
import type { RecruiterOutletContext } from './RecruiterDashboard';
import {
  normalizeScoreSummary,
  formatOneDecimal,
  getCanonicalStoredAiScore,
} from '../utils/scoreSummary';
import { getRecruiterPrimaryScore100FromSummary } from '../utils/scoring/recruiterOperationalScore';
import { getRecruiterMasterDisplayForAdminUi } from '../utils/scoring/recruiterMasterScoreDisplay';
import { getRecruiterScoreDisplayForAdminUi } from '../utils/scoring/recruiterScoreSnapshot';
import type { ScoreSummary } from '../utils/scoreSummary';
import { getWorkAuthorizedStatus, compareWorkAuthorized } from '../utils/workAuthorizedDisplay';
import {
  getEVerifyComfortStatusFromUserData,
  compareEVerifyComfort,
} from '../utils/eVerifyComfortDisplay';
import { useRecruiterUsersEntityEmploymentChips } from '../hooks/useRecruiterUsersEntityEmploymentChips';
import { TENANT_LISTABLE_SECURITY_LEVELS } from '../constants/tenantWorkerSecurityLevels';
import {
  getBackgroundBreakdownRows,
  getReadinessBreakdownRows,
  recruiterTableLetterGrade,
} from '../utils/recruiterUsersReadinessDisplay';
import type { UserListEntityOnboardingItem } from '../utils/userListEntityEmploymentStatus';
import {
  compareWorkReadinessForEntity,
  getWorkReadinessEntityChipsDisplay,
  getRecruiterUserTopConcernDetailed,
} from '../utils/recruiterUsersEntityWorkReadiness';
import {
  normalizeRiskProfileFromUserDoc,
  workerRiskPrimaryLine,
  workerRiskTooltipContent,
} from '../utils/workerRiskProfileDisplay';
import {
  formatCategoryScoresCompactPreview,
  formatCategoryScoresCompactPreviewFromPartial,
} from '../utils/parseRecruiterCategoryScores';
import { useCategoryScoresCurrentMap } from '../hooks/useCategoryScoresCurrentMap';
import { useRecruiterUsersRowExtras } from '../hooks/useRecruiterUsersRowExtras';
import { useRecruiterUsersLatestBackgroundChecks } from '../hooks/useRecruiterUsersLatestBackgroundChecks';

/** C1 tenant entities — keys match `entity_employments.entityKey` and the recruiter callable. */
type RecruiterUsersEntityFilterKey = 'all' | 'select' | 'workforce' | 'events';

type RecruiterUsersSortKey =
  | 'recentlyUpdated'
  | 'lastLogin'
  | 'name'
  | 'aiScore'
  | 'interview'
  | 'accountCreated'
  | 'auth'
  | 'documented'
  | 'workReadiness';

interface RecruiterUser {
  id: string;
  firstName: string;
  lastName: string;
  /** Profile display name when present (search + fallback when first/last missing). */
  displayName?: string;
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
  workEligibilityAttestation?: { authorizedToWorkUS?: boolean; attestedAt?: unknown };
  /** Apply flow / profile — used by Documented (E-Verify) column */
  comfortableEVerify?: string;
  workerAttestations?: { eVerifyWillingness?: string };
  /** Firestore `resume` map — used for inline resume link in Person column */
  resume?: Record<string, unknown> | null;
  addedToIndeedFlex?: boolean;
  /** Screening / payroll — readiness breakdown (same shape as profile credentials) */
  eVerifyOrders?: Array<{
    status?: string;
    result?: string;
    dateSubmitted?: string;
    completionDate?: string;
    dateOrdered?: string;
  }>;
  backgroundCheckOrders?: Array<{
    status?: string;
    result?: string;
    dateOrdered?: string;
    completionDate?: string;
  }>;
  /** Structured AI + compliance risk layer */
  riskProfile?: unknown;
  /** Canonical recruiter score — single UI source when present */
  recruiterScoreSnapshot?: unknown;
  /** Blended Master Recruiter Score (preferred headline). */
  recruiterMasterScore?: unknown;
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

  const securityLevel = String(tenantData.securityLevel ?? userData.securityLevel ?? '0');
  if (!['0', '1', '2', '3', '4'].includes(securityLevel)) return null;

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

  const rawDisplay = String(userData.displayName || '').trim();
  let firstName = String(userData.firstName || '').trim();
  let lastName = String(userData.lastName || '').trim();
  if (!firstName && !lastName && rawDisplay) {
    const parts = rawDisplay.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      firstName = parts[0];
      lastName = parts.slice(1).join(' ');
    } else if (parts.length === 1) {
      firstName = parts[0];
    }
  }

  const phoneForSanitize = String(userData.phone || userData.phoneE164 || '');
  const nameSanitized = sanitizeWorkerNameParts({
    firstName,
    lastName,
    preferredName: userData.preferredName,
    displayName: rawDisplay || undefined,
    email: resolvedEmail,
    phone: phoneForSanitize,
  });

  return {
    id: userDoc.id,
    firstName: nameSanitized.firstName,
    lastName: nameSanitized.lastName,
    displayName: rawDisplay || undefined,
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
    state: (() => {
      const ai = userData.addressInfo && typeof userData.addressInfo === 'object' ? (userData.addressInfo as any) : null;
      const ad = userData.address && typeof userData.address === 'object' ? (userData.address as any) : null;
      const raw = userData.state || ad?.state || ai?.state || '';
      return typeof raw === 'string' ? raw.trim() : '';
    })(),
    workEligibility: userData.workEligibility,
    workEligibilityAttestation: userData.workEligibilityAttestation,
    comfortableEVerify: userData.comfortableEVerify,
    workerAttestations: userData.workerAttestations,
    resume: userData.resume ?? null,
    addedToIndeedFlex: userData.addedToIndeedFlex === true,
    eVerifyOrders: Array.isArray(userData.eVerifyOrders) ? userData.eVerifyOrders : undefined,
    backgroundCheckOrders: Array.isArray(userData.backgroundCheckOrders) ? userData.backgroundCheckOrders : undefined,
    riskProfile: userData.riskProfile ?? undefined,
    recruiterScoreSnapshot: userData.recruiterScoreSnapshot ?? undefined,
    recruiterMasterScore: userData.recruiterMasterScore ?? undefined,
  };
}

/** Name, email (full + local-part + ignore spaces), phone, skills */
function userMatchesSearchTerm(user: RecruiterUser, rawSearch: string): boolean {
  const q = rawSearch.trim().toLowerCase();
  if (!q) return true;

  const fullName = `${user.firstName} ${user.lastName}`.trim().toLowerCase();
  const displayLower = (user.displayName || '').trim().toLowerCase();

  const fieldMatchesToken = (token: string) =>
    fullName.includes(token) ||
    (displayLower && displayLower.includes(token)) ||
    (user.email || '').toLowerCase().includes(token) ||
    (user.phone || '').toLowerCase().includes(token) ||
    user.skills?.some((skill) => skill.toLowerCase().includes(token)) === true;

  const tokens = q.split(/\s+/).filter(Boolean);
  if (tokens.length > 1) {
    if (tokens.every((t) => fieldMatchesToken(t))) return true;
  } else {
    if (fullName.includes(q)) return true;
    if (displayLower && displayLower.includes(q)) return true;
  }

  const email = (user.email || '').trim();
  const emailLower = email.toLowerCase();
  if (emailLower) {
    if (tokens.length <= 1 && emailLower.includes(q)) return true;
    const compactEmail = emailLower.replace(/\s/g, '');
    const compactQ = q.replace(/\s/g, '');
    if (compactEmail.includes(compactQ)) return true;
    const at = emailLower.indexOf('@');
    if (at > 0) {
      const local = emailLower.slice(0, at);
      if (local.includes(q)) return true;
    }
  }

  if (tokens.length <= 1 && user.phone?.toLowerCase().includes(q)) return true;
  const digits = (s: string) => s.replace(/\D/g, '');
  const qDigits = digits(q);
  if (qDigits.length >= 3 && user.phone && digits(user.phone).includes(qDigits)) return true;

  if (tokens.length <= 1 && user.skills?.some((skill) => skill.toLowerCase().includes(q))) return true;

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
      entityFilter: 'all',
      groupFilter: 'all',
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
  /** All-users scope: full-collection Firestore search via callable (not limited to first 500 rows). */
  const [searchFirestoreLoading, setSearchFirestoreLoading] = useState(false);
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

  const [entityFilter, setEntityFilter] = useState<RecruiterUsersEntityFilterKey>(() => {
    const raw = (cacheState as { entityFilter?: string }).entityFilter;
    if (raw === 'select' || raw === 'workforce' || raw === 'events') return raw;
    return 'all';
  });
  const [groupFilter, setGroupFilter] = useState<string>(cacheState.groupFilter || 'all');
  const [stateFilter, setStateFilter] = useState<string>(cacheState.stateFilter || 'all');
  const [sortBy, setSortBy] = useState<RecruiterUsersSortKey>((cacheState.sortBy as RecruiterUsersSortKey) || 'accountCreated');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>(cacheState.sortDirection || 'desc');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(20);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectAllResults, setSelectAllResults] = useState(false);
  const [bulkDrawerOpen, setBulkDrawerOpen] = useState(false);
  const [bulkDrawerChannel, setBulkDrawerChannel] = useState<'email' | 'sms'>('email');

  const { favorites, isFavorite, toggleFavorite } = useFavorites('users');

  /** All-users scope: full Firestore scan via `searchRecruiterTableUsers` (search and/or group/state/entity), not paginated `loadUsers`. */
  const fullCollectionQueryActive = useMemo(
    () =>
      effectiveScope === 'all' &&
      (searchTerm.trim() !== '' ||
        groupFilter !== 'all' ||
        stateFilter !== 'all' ||
        entityFilter !== 'all'),
    [effectiveScope, searchTerm, groupFilter, stateFilter, entityFilter],
  );

  const groupLookup = useMemo(() => {
    const map = new Map<string, TenantUserGroup>();
    groups.forEach((group) => map.set(group.id, group));
    return map;
  }, [groups]);

  const groupTitleLookup = useMemo(() => {
    const m = new Map<string, string>();
    groupLookup.forEach((g, id) => {
      m.set(id, g.title || id);
    });
    return m;
  }, [groupLookup]);

  // Reset pagination when core filters (excluding search) change
  useEffect(() => {
    if (!activeTenant?.id) return;

    loadGroups(activeTenant.id);
    // All Users + search and/or group/state/entity: list is filled by `searchRecruiterTableUsers` + hydrate (not paginated `loadUsers`).
    if (fullCollectionQueryActive) {
      setUsers([]);
      setLastVisibleDoc(null);
      setHasMore(false);
      setSearchFirestoreLoading(true);
      return;
    }
    setSearchFirestoreLoading(false);
    setUsers([]);
    setLastVisibleDoc(null);
    setHasMore(true);
    loadUsers(activeTenant.id, true);
  }, [
    activeTenant?.id,
    effectiveScope,
    entityFilter,
    groupFilter,
    stateFilter,
    sortBy,
    searchTerm,
    fullCollectionQueryActive,
  ]);

  /** Debounced full-collection query (search and/or group/state/entity) across all tenant listable users. */
  useEffect(() => {
    if (!activeTenant?.id || !tenantId) return;
    if (effectiveScope !== 'all') return;
    const q = searchTerm.trim();
    const hasGroup = groupFilter !== 'all';
    const hasState = stateFilter !== 'all';
    const hasEntity = entityFilter !== 'all';
    if (!q && !hasGroup && !hasState && !hasEntity) {
      setSearchFirestoreLoading(false);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setSearchFirestoreLoading(true);
      setError(null);
      try {
        const { data } = await callSearchRecruiterTableUsers(functions, {
          tenantId,
          searchQuery: q,
          ...(hasGroup ? { groupId: groupFilter } : {}),
          ...(hasState ? { stateCode: stateFilter } : {}),
          ...(hasEntity ? { entityKey: entityFilter } : {}),
        });
        if (cancelled) return;
        const ids = data.userIds;
        if (ids.length === 0) {
          setUsers([]);
          return;
        }
        const usersRef = collection(db, 'users');
        const chunk = <T,>(arr: T[], size: number): T[][] => {
          const out: T[][] = [];
          for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
          return out;
        };
        const IN_LIMIT = 30;
        const byId = new Map<string, RecruiterUser>();
        for (const idChunk of chunk(ids, IN_LIMIT)) {
          if (cancelled) return;
          const snap = await getDocs(query(usersRef, where(documentId(), 'in', idChunk)));
          snap.docs.forEach((d) => {
            const u = mapUserDocToRecruiterUser(d, tenantId);
            if (u) byId.set(d.id, u);
          });
        }
        if (cancelled) return;
        const ordered = ids.map((id) => byId.get(id)).filter((u): u is RecruiterUser => !!u);
        setUsers(ordered);
      } catch (e: unknown) {
        if (!cancelled) {
          console.warn('RecruiterUsers: searchRecruiterTableUsers failed', e);
          setError(formatFirebaseHttpsError(e));
          setUsers([]);
        }
      } finally {
        if (!cancelled) setSearchFirestoreLoading(false);
      }
    }, 400);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [searchTerm, groupFilter, stateFilter, entityFilter, effectiveScope, tenantId, activeTenant?.id]);

  // Update cache when filters change
  useEffect(() => {
    updateCache({
      usersScope: effectiveScope,
      entityFilter,
      groupFilter,
      stateFilter,
      sortBy,
      sortDirection,
    });
  }, [effectiveScope, entityFilter, groupFilter, stateFilter, sortBy, sortDirection, updateCache]);

  // Reset client pagination when filters/search change
  useEffect(() => {
    setPage(0);
  }, [searchTerm, effectiveScope, entityFilter, groupFilter, stateFilter, sortBy, showFavoritesOnly]);

  /** Work readiness sort only applies when a single entity is selected; reset if user clears entity. */
  useEffect(() => {
    if (entityFilter === 'all' && sortBy === 'workReadiness') {
      setSortBy('accountCreated');
      updateCache({ sortBy: 'accountCreated' });
    }
  }, [entityFilter, sortBy, updateCache]);

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

  const handleSort = (
    key: 'name' | 'aiScore' | 'interview' | 'lastLogin' | 'auth' | 'documented' | 'workReadiness',
  ) => {
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
      
      // Match both string and numeric security levels (Firestore `in` is type-sensitive).
      let q = query(usersRef, where(`tenantIds.${tenantId}.securityLevel`, 'in', TENANT_LISTABLE_SECURITY_LEVELS));

      // Add ordering for pagination (required for startAfter)
      q = query(q, orderBy('createdAt', 'desc'));
      
      const effectivePageSize = PAGE_SIZE;
      
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

  /** If search has no matches in the current batch, paginate Firestore until we find some or exhaust results (large tenants). */
  const searchAutoLoadAttemptsRef = useRef(0);
  useEffect(() => {
    searchAutoLoadAttemptsRef.current = 0;
  }, [searchTerm]);

  useEffect(() => {
    if (effectiveScope === 'my') return;
    if (fullCollectionQueryActive) return;
    if (!activeTenant?.id) return;
    const q = searchTerm.trim();
    if (!q) return;
    if (loading || loadingMore) return;
    if (!hasMore) return;
    if (users.some((u) => userMatchesSearchTerm(u, q))) return;
    if (searchAutoLoadAttemptsRef.current >= 25) return;
    searchAutoLoadAttemptsRef.current += 1;
    loadUsers(activeTenant.id, false);
  }, [
    searchTerm,
    users,
    hasMore,
    loading,
    loadingMore,
    effectiveScope,
    activeTenant?.id,
    fullCollectionQueryActive,
  ]);

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
    const cat = categoryScoresByUserId[user.id];
    const userData: Record<string, unknown> = {
      scoreSummary: user.scoreSummary,
      riskProfile: user.riskProfile,
      ...(cat ? { categoryScoresCurrent: cat } : {}),
    };
    const masterDisp = getRecruiterMasterDisplayForAdminUi({
      recruiterMasterScoreRaw: user.recruiterMasterScore,
      recruiterScoreSnapshotRaw: user.recruiterScoreSnapshot,
      userData,
      latestPrescreenInterviewAi: null,
    });
    const snapDisp = getRecruiterScoreDisplayForAdminUi(user.recruiterScoreSnapshot);
    const categoryPreview =
      cat != null
        ? formatCategoryScoresCompactPreview(cat)
        : snapDisp.hasSnapshot && Object.keys(snapDisp.categoryScores || {}).length > 0
          ? formatCategoryScoresCompactPreviewFromPartial(snapDisp.categoryScores)
          : [];
    const categoryLine1 = categoryPreview.slice(0, 3).join(' · ');
    const categoryLine2 = categoryPreview.slice(3).join(' · ');
    const rawScore = masterDisp.score100;
    const m = masterDisp.master;
    if (rawScore === null || Number.isNaN(rawScore)) {
      return (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 0.25 }}>
          <Typography variant="body2" color="text.secondary">
            N/A
          </Typography>
          {categoryLine1.length > 0 && (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ fontSize: '0.65rem', lineHeight: 1.25, display: 'block', opacity: 0.88 }}
            >
              {categoryLine1}
            </Typography>
          )}
          {categoryLine2.length > 0 && (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ fontSize: '0.65rem', lineHeight: 1.25, display: 'block', opacity: 0.88 }}
            >
              {categoryLine2}
            </Typography>
          )}
        </Box>
      );
    }
    const displayScore = Math.round(rawScore);
    const grade = masterDisp.grade ?? recruiterTableLetterGrade(displayScore);

    let scoreColor: 'success.main' | 'warning.main' | 'text.primary' = 'text.primary';
    if (displayScore >= 80) scoreColor = 'success.main';
    else if (displayScore >= 60) scoreColor = 'warning.main';

    const c = m?.components;
    const ew = m?.effectiveWeights;

    return (
      <Tooltip
        arrow
        title={
          <Box sx={{ p: 0.5 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
              Master Recruiter Score
            </Typography>
            <Typography variant="caption" color="inherit" sx={{ display: 'block', mb: 0.5, opacity: 0.9 }}>
              Blended category (50%) · interview (35%) · profile Hiring Score (15%), renormalized when inputs are missing.
            </Typography>
            <Stack spacing={0.25}>
              <Typography variant="body2">
                Master: <strong>{displayScore}</strong> (grade {grade})
                {masterDisp.computedFallback ? ' · computed locally' : ''}
              </Typography>
              {c && ew ? (
                <>
                  <Typography variant="caption" color="inherit" sx={{ opacity: 0.92 }}>
                    Category {c.categoryScore ?? '—'} × {Math.round(ew.categoryScore * 100)}% · Interview {c.interviewScore ?? '—'} ×{' '}
                    {Math.round(ew.interviewScore * 100)}% · Profile {c.profileScore ?? '—'} × {Math.round(ew.profileScore * 100)}%
                  </Typography>
                </>
              ) : null}
              <Typography variant="body2">
                Interview avg: <strong>{formatOneDecimal(user.scoreSummary?.interviewAvg)}</strong>/10
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
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 0.25 }}>
          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75 }}>
            <Typography
              component="span"
              variant="body2"
              sx={{
                fontWeight: 700,
                color: scoreColor,
                fontSize: '0.8125rem',
                minWidth: 14,
              }}
            >
              {grade}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>
              {displayScore}
            </Typography>
          </Box>
          {categoryLine1.length > 0 && (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ fontSize: '0.65rem', lineHeight: 1.25, display: 'block', opacity: 0.88 }}
            >
              {categoryLine1}
            </Typography>
          )}
          {categoryLine2.length > 0 && (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ fontSize: '0.65rem', lineHeight: 1.25, display: 'block', opacity: 0.88 }}
            >
              {categoryLine2}
            </Typography>
          )}
        </Box>
      </Tooltip>
    );
  };

  const filteredUsersUnsorted = useMemo(() => {
    return users.filter((user) => {
      if (showFavoritesOnly && !favorites.includes(user.id)) {
        return false;
      }

      if (
        !fullCollectionQueryActive &&
        groupFilter !== 'all' &&
        !user.userGroupIds.includes(groupFilter)
      ) {
        return false;
      }

      if (!fullCollectionQueryActive && stateFilter !== 'all') {
        const selectedCode = normalizeUsStateCode(stateFilter);
        const userCode = normalizeUsStateCode(user.state);
        if (!selectedCode || userCode !== selectedCode) {
          return false;
        }
      }

      return userMatchesSearchTerm(user, searchTerm);
    });
  }, [
    favorites,
    fullCollectionQueryActive,
    groupFilter,
    searchTerm,
    showFavoritesOnly,
    stateFilter,
    users,
  ]);

  /** When no entity is selected, chip fetch is paginated only; sort never uses workReadiness here. */
  const sortedUsersForChipPagination = useMemo(
    () =>
      sortRecruiterUserRows(
        filteredUsersUnsorted,
        sortBy,
        sortDirection,
        new Map<string, UserListEntityOnboardingItem[]>(),
        'all',
        { skipWorkReadiness: true },
      ),
    [filteredUsersUnsorted, sortBy, sortDirection],
  );

  const entityEmploymentChipUserIds = useMemo(() => {
    if (entityFilter !== 'all') {
      return filteredUsersUnsorted.map((u) => u.id);
    }
    const start = page * rowsPerPage;
    const end = start + rowsPerPage;
    return sortedUsersForChipPagination.slice(start, end).map((u) => u.id);
  }, [entityFilter, filteredUsersUnsorted, sortedUsersForChipPagination, page, rowsPerPage]);

  const { itemsByUserId: entityEmploymentChipsByUser, employmentBreakdownByUserId } =
    useRecruiterUsersEntityEmploymentChips(activeTenant?.id, entityEmploymentChipUserIds);

  const filteredUsers = useMemo(
    () =>
      sortRecruiterUserRows(
        filteredUsersUnsorted,
        sortBy,
        sortDirection,
        entityEmploymentChipsByUser,
        entityFilter,
        { skipWorkReadiness: false },
      ),
    [filteredUsersUnsorted, sortBy, sortDirection, entityEmploymentChipsByUser, entityFilter],
  );

  const paginatedUsers = useMemo(() => {
    const start = page * rowsPerPage;
    const end = start + rowsPerPage;
    return filteredUsers.slice(start, end);
  }, [filteredUsers, page, rowsPerPage]);

  const paginatedUserIds = useMemo(() => paginatedUsers.map((u) => u.id), [paginatedUsers]);
  const { scoresByUserId: categoryScoresByUserId } = useCategoryScoresCurrentMap(paginatedUserIds);
  const { latestNoteByUserId, latestInterviewByUserId } = useRecruiterUsersRowExtras(paginatedUserIds);
  const { latestByUserId: latestBackgroundByUserId } = useRecruiterUsersLatestBackgroundChecks(
    activeTenant?.id,
    paginatedUserIds,
  );

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
    if (fullCollectionQueryActive) return;
    if (!hasMore || loadingMore) return;
    const needed = (page + 1) * rowsPerPage;
    if (needed > users.length) {
      loadMoreUsers();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    page,
    rowsPerPage,
    users.length,
    hasMore,
    loadingMore,
    activeTenant?.id,
    effectiveScope,
    searchTerm,
    fullCollectionQueryActive,
  ]);

  const tableLoading = loading || searchFirestoreLoading;

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
                        if (t.value === 'my') {
                          setEntityFilter('all');
                          updateCache({ usersScope: t.value, entityFilter: 'all' });
                        } else {
                          updateCache({ usersScope: t.value });
                        }
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
            {effectiveScope === 'all' && (
              <FormControl size="small" sx={{ minWidth: 180, height: 36 }}>
                <InputLabel sx={{ fontSize: '0.875rem' }}>Entity</InputLabel>
                <Select
                  label="Entity"
                  value={entityFilter}
                  onChange={(e) => {
                    const newFilter = e.target.value as RecruiterUsersEntityFilterKey;
                    setEntityFilter(newFilter);
                    updateCache({ entityFilter: newFilter });
                  }}
                  sx={{
                    height: 36,
                    borderRadius: '6px',
                    backgroundColor: 'white',
                    fontSize: '0.875rem',
                  }}
                >
                  <MenuItem value="all">All entities</MenuItem>
                  <MenuItem value="select">C1 Select</MenuItem>
                  <MenuItem value="workforce">C1 Workforce</MenuItem>
                  <MenuItem value="events">C1 Events</MenuItem>
                </Select>
              </FormControl>
            )}

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
                  const newSortBy = event.target.value as RecruiterUsersSortKey;
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
                <MenuItem value="aiScore">Master score</MenuItem>
                <MenuItem value="name">Name (A-Z)</MenuItem>
                {entityFilter !== 'all' && (
                  <MenuItem value="workReadiness">Work readiness (selected entity)</MenuItem>
                )}
              </Select>
            </FormControl>
          </Box>
        </Box>

        {/* Initial loading indicator */}
        {tableLoading && users.length === 0 && (
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 200, py: 4 }}>
            <CircularProgress size={24} />
          </Box>
        )}

        {!tableLoading || users.length > 0 ? (
          <>
          <Box sx={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            {/* Loading overlay */}
            {tableLoading && users.length > 0 && (
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
            {!tableLoading && filteredUsers.length === 0 && (
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
                <TableCell padding="checkbox" sx={{ width: 48, bgcolor: '#FFFFFF', borderRadius: 0, py: 1 }}>
                  <Checkbox
                    size="small"
                    checked={allOnPageSelected}
                    indeterminate={someOnPageSelected}
                    onChange={handleSelectAllOnPage}
                    aria-label="Select all on page"
                  />
                </TableCell>
                <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem', borderRadius: 0, minWidth: 260, py: 1 }}>
                  <TableSortLabel
                    active={sortBy === 'name'}
                    direction={sortBy === 'name' ? sortDirection : 'asc'}
                    onClick={() => handleSort('name')}
                  >
                    Person
                  </TableSortLabel>
                </TableCell>
                <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem', borderRadius: 0, minWidth: 128, py: 1 }}>
                  {entityFilter !== 'all' ? (
                    <TableSortLabel
                      active={sortBy === 'workReadiness'}
                      direction={sortBy === 'workReadiness' ? sortDirection : 'desc'}
                      onClick={() => handleSort('workReadiness')}
                    >
                      Work readiness
                    </TableSortLabel>
                  ) : (
                    'Work readiness'
                  )}
                </TableCell>
                <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem', borderRadius: 0, minWidth: 120, py: 1 }}>
                  Readiness breakdown
                </TableCell>
                <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem', borderRadius: 0, minWidth: 120, py: 1 }}>
                  Backgrounds
                </TableCell>
                <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem', borderRadius: 0, minWidth: 72, py: 1 }}>
                  <TableSortLabel
                    active={sortBy === 'aiScore'}
                    direction={sortBy === 'aiScore' ? sortDirection : 'desc'}
                    onClick={() => handleSort('aiScore')}
                  >
                    Score
                  </TableSortLabel>
                </TableCell>
                <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem', borderRadius: 0, minWidth: 100, py: 1 }}>
                  Risk / concern
                </TableCell>
                <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem', minWidth: 120, borderRadius: 0, py: 1 }}>
                  <TableSortLabel
                    active={sortBy === 'lastLogin'}
                    direction={sortBy === 'lastLogin' ? sortDirection : 'desc'}
                    onClick={() => handleSort('lastLogin')}
                  >
                    Last activity
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
                  <TableCell
                    padding="checkbox"
                    onClick={(e) => e.stopPropagation()}
                    sx={{ width: 48, py: 0.5, px: 1 }}
                  >
                    <Checkbox
                      size="small"
                      checked={selectAllResults || selectedIds.has(user.id)}
                      onChange={(_, checked) => handleSelectRow(user.id, checked)}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`Select ${user.firstName} ${user.lastName}`}
                    />
                  </TableCell>
                  <TableCell sx={{ minWidth: 260, maxWidth: 380, verticalAlign: 'top', py: 0.5, px: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.75, minWidth: 0 }}>
                      <Avatar
                        src={user.avatar}
                        alt={`${user.firstName} ${user.lastName}`}
                        sx={{ width: TABLE_AVATAR_SIZE, height: TABLE_AVATAR_SIZE, flexShrink: 0, mt: 0.125 }}
                      >
                        {user.firstName?.[0]}
                      </Avatar>
                      <Box sx={{ minWidth: 0, flex: 1, overflow: 'hidden' }}>
                        <Box
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 0.25,
                            minWidth: 0,
                          }}
                        >
                          <Typography
                            variant="body2"
                            sx={{ fontWeight: 600, flex: 1, minWidth: 0, fontSize: '0.8125rem', lineHeight: 1.3 }}
                            noWrap
                          >
                            {user.firstName} {user.lastName}
                          </Typography>
                          <Box
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => e.stopPropagation()}
                            sx={{
                              flexShrink: 0,
                              position: 'relative',
                              zIndex: 2,
                              pointerEvents: 'auto',
                              ml: 0.25,
                            }}
                          >
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
                              sx={{
                                p: 0.125,
                                '& .MuiSvgIcon-root': { fontSize: 17 },
                              }}
                            />
                          </Box>
                        </Box>
                        <RecruiterUserTableContactBlock
                          user={user as unknown as Record<string, unknown>}
                          latestNote={latestNoteByUserId.get(user.id) ?? null}
                          groupTitleLookup={groupTitleLookup}
                          formatDate={formatDate}
                        />
                      </Box>
                    </Box>
                  </TableCell>
                  <TableCell sx={{ verticalAlign: 'top', py: 0.5, px: 1, maxWidth: 140 }}>
                    {(() => {
                      const entityItems = entityEmploymentChipsByUser.get(user.id);
                      const chips = getWorkReadinessEntityChipsDisplay(entityItems);
                      if (chips.length === 0) {
                        return null;
                      }
                      return (
                        <Stack spacing={0.35} alignItems="flex-start">
                          {chips.map((c) => {
                            const chipColor =
                              c.displayState === 'active'
                                ? 'success'
                                : c.displayState === 'onboarding'
                                  ? 'warning'
                                  : 'error';
                            const filled = c.displayState === 'active';
                            return (
                              <Chip
                                key={c.key}
                                label={c.label}
                                size="small"
                                color={chipColor}
                                variant={filled ? 'filled' : 'outlined'}
                                sx={{
                                  height: 22,
                                  maxWidth: '100%',
                                  '& .MuiChip-label': {
                                    px: 0.75,
                                    fontSize: '0.65rem',
                                    fontWeight: 600,
                                    lineHeight: 1.2,
                                  },
                                }}
                              />
                            );
                          })}
                        </Stack>
                      );
                    })()}
                  </TableCell>
                  <TableCell sx={{ verticalAlign: 'top', py: 0.5, px: 1, maxWidth: 280 }}>
                    <Stack spacing={0.15}>
                      {getReadinessBreakdownRows(
                        user,
                        entityEmploymentChipsByUser.get(user.id),
                        {
                          lastInterviewSubmitterName:
                            latestInterviewByUserId.get(user.id)?.createdByName ?? null,
                          latestAccusourceBackground: latestBackgroundByUserId.get(user.id) ?? null,
                          ...(employmentBreakdownByUserId.has(user.id) &&
                          employmentBreakdownByUserId.get(user.id)
                            ? { employmentBreakdown: employmentBreakdownByUserId.get(user.id)! }
                            : {}),
                        },
                      ).map((row) => (
                        <Box key={row.key} component="span" sx={{ display: 'block' }}>
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{ lineHeight: 1.3, fontSize: '0.65rem', fontFamily: 'inherit', display: 'block' }}
                          >
                            {row.text}
                          </Typography>
                          {row.sublines?.map((line, i) => (
                            <Typography
                              key={i}
                              variant="caption"
                              color="text.secondary"
                              sx={{
                                display: 'block',
                                pl: 0.5,
                                fontSize: '0.6rem',
                                lineHeight: 1.25,
                                opacity: 0.95,
                              }}
                            >
                              {line}
                            </Typography>
                          ))}
                        </Box>
                      ))}
                    </Stack>
                  </TableCell>
                  <TableCell sx={{ verticalAlign: 'top', py: 0.5, px: 1, maxWidth: 260 }}>
                    <Stack spacing={0.15}>
                      {getBackgroundBreakdownRows(user, entityEmploymentChipsByUser.get(user.id), {
                        latestAccusourceBackground: latestBackgroundByUserId.get(user.id) ?? null,
                      }).map((row) => (
                        <Box key={row.key} component="span" sx={{ display: 'block' }}>
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{ lineHeight: 1.3, fontSize: '0.65rem', fontFamily: 'inherit', display: 'block' }}
                          >
                            {row.text}
                          </Typography>
                          {row.sublines?.map((line, i) => (
                            <Typography
                              key={i}
                              variant="caption"
                              color="text.secondary"
                              sx={{
                                display: 'block',
                                pl: 0.5,
                                fontSize: '0.6rem',
                                lineHeight: 1.25,
                                opacity: 0.95,
                              }}
                            >
                              {line}
                            </Typography>
                          ))}
                        </Box>
                      ))}
                    </Stack>
                  </TableCell>
                  <TableCell sx={{ verticalAlign: 'top', py: 0.5, px: 1 }}>{renderAiScore(user)}</TableCell>
                  <TableCell sx={{ verticalAlign: 'top', py: 0.5, px: 1 }}>
                    {(() => {
                      const entityItems = entityEmploymentChipsByUser.get(user.id);
                      const rp = normalizeRiskProfileFromUserDoc(user.riskProfile);
                      const fromRisk = workerRiskPrimaryLine(rp);
                      const concern =
                        fromRisk ??
                        getRecruiterUserTopConcernDetailed(user, entityItems, {
                          latestAccusourceBackground: latestBackgroundByUserId.get(user.id) ?? null,
                          categoryScores: categoryScoresByUserId[user.id] ?? null,
                        });
                      const muted = concern === 'None';
                      const tip = rp?.topRisks?.length ? workerRiskTooltipContent(rp) : '';
                      const body = (
                        <Typography
                          variant="body2"
                          color={muted ? 'text.secondary' : 'text.primary'}
                          sx={{ fontWeight: 400, fontSize: '0.8125rem', lineHeight: 1.3 }}
                        >
                          {concern}
                        </Typography>
                      );
                      return tip ? (
                        <Tooltip title={<span style={{ whiteSpace: 'pre-wrap' }}>{tip}</span>} placement="top" enterDelay={350}>
                          {body}
                        </Tooltip>
                      ) : (
                        body
                      );
                    })()}
                  </TableCell>
                  <TableCell sx={{ minWidth: 120, verticalAlign: 'top', py: 0.5, px: 1 }}>
                    <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.8125rem', lineHeight: 1.3 }}>
                      {formatDate(user.lastLoginAt)}
                    </Typography>
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

function sortRecruiterUserRows(
  rows: RecruiterUser[],
  sortBy: RecruiterUsersSortKey,
  sortDirection: 'asc' | 'desc',
  chipsByUserId: Map<string, UserListEntityOnboardingItem[]>,
  entityFilter: RecruiterUsersEntityFilterKey,
  options: { skipWorkReadiness?: boolean },
): RecruiterUser[] {
  const skipWR = options.skipWorkReadiness === true;
  const copy = [...rows];
  copy.sort((a, b) => {
    switch (sortBy) {
      case 'workReadiness': {
        if (skipWR || entityFilter === 'all') {
          const diff = getCreatedMillis(b) - getCreatedMillis(a);
          return sortDirection === 'desc' ? diff : -diff;
        }
        return compareWorkReadinessForEntity(
          chipsByUserId.get(a.id),
          chipsByUserId.get(b.id),
          entityFilter,
          sortDirection,
        );
      }
      case 'recentlyUpdated': {
        const diff = getUpdatedMillis(b) - getUpdatedMillis(a);
        return sortDirection === 'desc' ? diff : -diff;
      }
      case 'lastLogin': {
        const diff = getLoginMillis(b) - getLoginMillis(a);
        return sortDirection === 'desc' ? diff : -diff;
      }
      case 'accountCreated': {
        const diff = getCreatedMillis(b) - getCreatedMillis(a);
        return sortDirection === 'desc' ? diff : -diff;
      }
      case 'name': {
        const nameCompare = `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`);
        return sortDirection === 'asc' ? nameCompare : -nameCompare;
      }
      case 'aiScore': {
        const build = (u: RecruiterUser) =>
          getRecruiterMasterDisplayForAdminUi({
            recruiterMasterScoreRaw: u.recruiterMasterScore,
            recruiterScoreSnapshotRaw: u.recruiterScoreSnapshot,
            userData: {
              scoreSummary: u.scoreSummary,
              riskProfile: u.riskProfile,
            },
            latestPrescreenInterviewAi: null,
          }).score100;
        const aScore = build(a);
        const bScore = build(b);
        const av = aScore ?? -1;
        const bv = bScore ?? -1;
        const diff = bv - av;
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
  return copy;
}

export default RecruiterUsers;

