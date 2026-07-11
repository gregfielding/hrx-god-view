import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Avatar,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Collapse,
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
  Tooltip,
  Typography,
  Chip,
} from '@mui/material';
import EmailIcon from '@mui/icons-material/Email';
import SmsIcon from '@mui/icons-material/Sms';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import MuiMenu from '@mui/material/Menu';
import * as XLSX from 'xlsx';
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
import { useTenantWorkerDirectory } from '../hooks/useTenantWorkerDirectory';
import { formatFirebaseHttpsError } from '../utils/firebaseHttpsErrors';
import { formatPhoneNumber } from '../utils/formatPhone';
import { normalizeUsStateCode } from '../utils/usStateNormalize';
import { TABLE_AVATAR_SIZE } from '../utils/uiConstants';
import RecruiterUserTableContactBlock from '../components/tables/RecruiterUserTableContactBlock';
import { useTenantRecruiterNamesByUid } from '../hooks/useTenantRecruiterNamesByUid';
import type { RecruiterOutletContext } from './RecruiterDashboard';
import { normalizeScoreSummary, getCanonicalStoredAiScore } from '../utils/scoreSummary';
import { getRecruiterPrimaryScore100FromSummary } from '../utils/scoring/recruiterOperationalScore';
import { getRecruiterMasterDisplayForAdminUi } from '../utils/scoring/recruiterMasterScoreDisplay';
import { getWorkAuthorizedStatus, compareWorkAuthorized } from '../utils/workAuthorizedDisplay';
import {
  getEVerifyComfortStatusFromUserData,
  compareEVerifyComfort,
} from '../utils/eVerifyComfortDisplay';
import { useRecruiterUsersEntityEmploymentChips } from '../hooks/useRecruiterUsersEntityEmploymentChips';
import { TENANT_LISTABLE_SECURITY_LEVELS } from '../constants/tenantWorkerSecurityLevels';
import { getBackgroundBreakdownRows, getReadinessBreakdownRows } from '../utils/recruiterUsersReadinessDisplay';
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
import { useCategoryScoresCurrentMap } from '../hooks/useCategoryScoresCurrentMap';
import { useRecruiterUsersRowExtras } from '../hooks/useRecruiterUsersRowExtras';
import { useRecruiterUsersLatestBackgroundChecks } from '../hooks/useRecruiterUsersLatestBackgroundChecks';
import type { RecruiterUser } from '../types/recruiterUserListRow';
import { mapUserDocToRecruiterUser } from '../utils/mapUserDataToRecruiterUser';
import { userMatchesSearchTerm } from '../utils/recruiterUserSearchMatch';
import RecruiterUserAiScoreCell from '../components/recruiter/RecruiterUserAiScoreCell';
import { WorkHistoryJobTitlesCell } from '../components/recruiter/ApplicantsUsersStyleTableCells';
import OrderInterviewInlineAction from '../components/recruiter/OrderInterviewInlineAction';
import BulkOrderInterviewButton from '../components/recruiter/BulkOrderInterviewButton';
import CertificationIntelligencePanel from '../components/recruiter/CertificationIntelligencePanel';

/** C1 tenant entities — keys match `entity_employments.entityKey` and the recruiter callable. */
type RecruiterUsersEntityFilterKey = 'all' | 'select' | 'workforce' | 'events';

/** Employment lifecycle filter — matches `entity_employments` status server-side.
 *  'terminated' and 'on_assignment' are only offered for C1 Select;
 *  'on_assignment' matches live assignments overlapping today (at search
 *  time) rather than an employment lifecycle. */
type RecruiterUsersStatusFilterKey = 'all' | 'active' | 'onboarding' | 'terminated' | 'on_assignment';

/**
 * Back-navigation results cache: open a user from the table, click back →
 * the same filtered/searched rows render instantly instead of re-running
 * the fetch. Module-level in-memory singleton (NOT sessionStorage): row
 * sets can be thousands of objects and `lastVisibleDoc` is a live
 * Firestore cursor that doesn't serialize. Keyed on the full filter tuple;
 * a stale or mismatched key falls through to the normal fetch.
 */
interface UsersBackNavCache {
  key: string;
  users: RecruiterUser[];
  lastVisibleDoc: QueryDocumentSnapshot<DocumentData> | null;
  hasMore: boolean;
  scrollTop: number;
  at: number;
}
let usersBackNavCache: UsersBackNavCache | null = null;
const USERS_BACK_NAV_CACHE_TTL_MS = 5 * 60 * 1000;

/** Nearest scrollable ancestor — the Users list scrolls inside `UsersLayout`'s outlet Box, not the window. */
function findScrollParent(el: HTMLElement | null): HTMLElement | null {
  let node = el?.parentElement ?? null;
  while (node) {
    const style = window.getComputedStyle(node);
    if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

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

/** Default direction when switching sort mode (matches `handleSort` first-click behavior). */
function defaultSortDirectionForKey(key: RecruiterUsersSortKey): 'asc' | 'desc' {
  return key === 'name' ? 'asc' : 'desc';
}

interface TenantUserGroup {
  id: string;
  title?: string;
  description?: string;
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
  /**
   * Generation token for paginated `loadUsers` calls. Incremented whenever we
   * transition into `fullCollectionQueryActive` mode (or otherwise want any
   * in-flight `loadUsers` to ignore its result). `loadUsers` captures the
   * generation at start and skips `setUsers` if the current generation has
   * advanced — guards against a stale 500-by-createdAt load overwriting a
   * fresh full-collection search result (see /users/all "abraham" race).
   */
  const loadUsersGenerationRef = useRef(0);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const filtersRef = useRef<HTMLDivElement | null>(null);
  
  // Page cache for search and filters
  const { cacheState, updateCache } = usePageCache({
    pageKey: 'users',
    defaultState: {
      usersScope: 'all',
      entityFilter: 'all',
      statusFilter: 'all',
      groupFilter: 'all',
      stateFilter: 'all',
      sortBy: 'accountCreated',
      sortDirection: 'desc',
      usersTablePage: 0,
      usersTableRowsPerPage: 20,
    },
  });
  
  // Use outlet context if available, otherwise use local state
  const searchTerm = outletCtx?.search !== undefined ? outletCtx.search : localSearch;
  /**
   * Committed search — only updates on Enter, Clear, or suggestion-pick.
   * Used to gate the expensive `/users/all` full-collection scan so we
   * don't burn an 8.5k-doc server query on every keystroke. Falls back to
   * the live `searchTerm` for non-`UsersLayout` callers (e.g. the legacy
   * standalone embed) where the parent doesn't split live vs committed.
   */
  const submittedSearchTerm =
    outletCtx?.submittedSearch !== undefined ? outletCtx.submittedSearch : searchTerm;
  const showFavoritesOnly = outletCtx?.showFavoritesOnly !== undefined ? outletCtx.showFavoritesOnly : localShowFavoritesOnly;
  // Show/Hide filters lives in the parent layout's tab strip (mirrors
  // `/jobs/job-orders`). Default closed when no outlet context is
  // present (defensive — this page only renders inside <UsersLayout>
  // today, but the legacy `hideHeader=false` path could reach here too).
  const filtersExpanded = outletCtx?.filtersExpanded ?? false;
  
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
  const [statusFilter, setStatusFilter] = useState<RecruiterUsersStatusFilterKey>(() => {
    const raw = (cacheState as { statusFilter?: string }).statusFilter;
    if (raw === 'active' || raw === 'onboarding' || raw === 'terminated' || raw === 'on_assignment') {
      return raw;
    }
    return 'all';
  });
  // `setGroupFilter` was used by the inline User Group Autocomplete that
  // we removed from the All Users / My Users filter row. The state itself
  // still flows through load/filter logic (and the persisted cache), so we
  // keep `groupFilter` as a read-only value pinned to whatever the cache
  // hands back — typically `'all'`.
  const [groupFilter] = useState<string>(cacheState.groupFilter || 'all');
  const [stateFilter, setStateFilter] = useState<string>(cacheState.stateFilter || 'all');
  const [sortBy, setSortBy] = useState<RecruiterUsersSortKey>((cacheState.sortBy as RecruiterUsersSortKey) || 'accountCreated');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>(cacheState.sortDirection || 'desc');
  const ROWS_PER_PAGE_OPTIONS = [10, 20, 50, 100] as const;
  const [page, setPage] = useState(() => {
    const raw = (cacheState as { usersTablePage?: unknown }).usersTablePage;
    const n = typeof raw === 'number' && Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0;
    return n;
  });
  const [rowsPerPage, setRowsPerPage] = useState(() => {
    const raw = (cacheState as { usersTableRowsPerPage?: unknown }).usersTableRowsPerPage;
    const r = typeof raw === 'number' && Number.isFinite(raw) ? Math.floor(raw) : 20;
    return ROWS_PER_PAGE_OPTIONS.includes(r as (typeof ROWS_PER_PAGE_OPTIONS)[number]) ? r : 20;
  });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectAllResults, setSelectAllResults] = useState(false);
  const [bulkDrawerOpen, setBulkDrawerOpen] = useState(false);
  const [bulkDrawerChannel, setBulkDrawerChannel] = useState<'email' | 'sms'>('email');

  const { favorites, isFavorite, toggleFavorite } = useFavorites('users');

  /** All-users scope: full Firestore scan via `searchRecruiterTableUsers` (search and/or group/state/entity), not paginated `loadUsers`. */
  const fullCollectionQueryActive = useMemo(
    () =>
      effectiveScope === 'all' &&
      // Use the COMMITTED query so the server scan only fires when the user
      // explicitly hits Enter / Clear / picks a suggestion. Live typing
      // (`searchTerm`) still drives the in-memory filter below.
      (submittedSearchTerm.trim() !== '' ||
        groupFilter !== 'all' ||
        stateFilter !== 'all' ||
        entityFilter !== 'all' ||
        statusFilter !== 'all'),
    [effectiveScope, submittedSearchTerm, groupFilter, stateFilter, entityFilter, statusFilter],
  );

  /**
   * Identity of the current result set for the back-navigation cache. Every
   * input that changes WHICH rows get fetched is in here; anything not in
   * the key (favorites toggle, table page, sort direction) only re-slices
   * rows client-side and is safe to restore across.
   */
  const backNavCacheKey = useMemo(
    () =>
      JSON.stringify({
        t: activeTenant?.id ?? '',
        scope: effectiveScope,
        entity: entityFilter,
        status: statusFilter,
        group: groupFilter,
        state: stateFilter,
        sort: sortBy,
        q: submittedSearchTerm.trim(),
      }),
    [activeTenant?.id, effectiveScope, entityFilter, statusFilter, groupFilter, stateFilter, sortBy, submittedSearchTerm],
  );
  /**
   * Set when this mount restored rows from `usersBackNavCache`. Both fetch
   * effects skip while the current key still matches, so directory
   * revalidation (`workerDirectory.workers` identity changes) can't clobber
   * the restored rows with a redundant refetch. Any real filter/search
   * change produces a different key and fetches normally.
   */
  const backNavRestoredKeyRef = useRef<string | null>(null);
  /** Monotonic id for search-scan runs — a run's writes are discarded only
   *  when a NEWER run has started (filter key changed), not when the effect
   *  merely re-fires with the same key. See the dedup note in the effect. */
  const searchScanRunIdRef = useRef(0);
  /** Filter key of the last slow-path (server scan) run started; identical
   *  re-fires skip instead of cancel-and-restart. Cleared on scan error so
   *  the next re-fire retries. */
  const lastSlowScanKeyRef = useRef<string | null>(null);
  /** Live snapshot for the unmount save — refs so the cleanup sees current values. */
  const backNavSnapshotRef = useRef<{ key: string; users: RecruiterUser[]; lastVisibleDoc: QueryDocumentSnapshot<DocumentData> | null; hasMore: boolean }>({
    key: backNavCacheKey,
    users: [],
    lastVisibleDoc: null,
    hasMore: true,
  });

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

  // Map of recruiter uid -> display name; powers the "Recruiter: <name>"
  // line on each Person cell (the row only carries
  // `users.{uid}.primaryRecruiterId`, and we want a name without N getDocs).
  const recruiterNameByUid = useTenantRecruiterNamesByUid(activeTenant?.id ?? null);

  // Reset pagination when core filters (excluding search) change
  useEffect(() => {
    if (!activeTenant?.id) return;

    loadGroups(activeTenant.id);

    // Back-navigation restore: same filter/search key + fresh → rehydrate the
    // previous rows (and pagination cursor) instantly instead of refetching.
    // Covers both fetch paths — the rows were whatever the last visit showed.
    const cached = usersBackNavCache;
    if (
      cached &&
      cached.key === backNavCacheKey &&
      Date.now() - cached.at < USERS_BACK_NAV_CACHE_TTL_MS &&
      cached.users.length > 0
    ) {
      backNavRestoredKeyRef.current = backNavCacheKey;
      // Invalidate any in-flight paginated load from a prior filter set so a
      // late result can't overwrite the restored rows.
      loadUsersGenerationRef.current += 1;
      setUsers(cached.users);
      setLastVisibleDoc(cached.lastVisibleDoc);
      setHasMore(cached.hasMore);
      setLoading(false);
      setSearchFirestoreLoading(false);
      const { scrollTop } = cached;
      if (scrollTop > 0) {
        requestAnimationFrame(() => {
          const scroller = findScrollParent(contentRef.current);
          if (scroller) scroller.scrollTop = scrollTop;
        });
      }
      return;
    }
    backNavRestoredKeyRef.current = null;

    // All Users + search and/or group/state/entity/status: list is filled by `searchRecruiterTableUsers` + hydrate (not paginated `loadUsers`).
    if (fullCollectionQueryActive) {
      // Invalidate any paginated `loadUsers` in flight from a prior empty-search
      // render. Without this, its setUsers(500 newest by createdAt) lands AFTER
      // the search hydration and silently wipes older matches (e.g. the bulk-
      // imported Abraham cohort, whose createdAt predates the first 500).
      loadUsersGenerationRef.current += 1;
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
    statusFilter,
    groupFilter,
    stateFilter,
    sortBy,
    // Watching `submittedSearchTerm` (not `searchTerm`) keeps live keystrokes
    // from re-running the mode-switch + setUsers([]) clear. Live typing only
    // touches the in-memory filter.
    submittedSearchTerm,
    fullCollectionQueryActive,
  ]);

  // Keep the back-nav snapshot current every render; write it to the module
  // cache on unmount (row click → user detail). Empty result sets aren't
  // worth caching — the refetch is what would fill them. Scroll position is
  // tracked live into a ref because the DOM is already detached by the time
  // a passive effect cleanup runs.
  backNavSnapshotRef.current = { key: backNavCacheKey, users, lastVisibleDoc, hasMore };
  const backNavScrollTopRef = useRef(0);
  useEffect(() => {
    const scroller = findScrollParent(contentRef.current);
    backNavScrollTopRef.current = scroller?.scrollTop ?? 0;
    const onScroll = () => {
      backNavScrollTopRef.current = scroller?.scrollTop ?? 0;
    };
    scroller?.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      scroller?.removeEventListener('scroll', onScroll);
      const snap = backNavSnapshotRef.current;
      if (snap.users.length === 0) return;
      usersBackNavCache = {
        ...snap,
        scrollTop: backNavScrollTopRef.current,
        at: Date.now(),
      };
    };
  }, []);

  /**
   * Tenant worker directory — stale-while-revalidate IndexedDB cache.
   * Powers the fast path below: text-only committed searches resolve
   * locally in ~1ms instead of round-tripping the 8.5k-doc server scan.
   */
  const workerDirectory = useTenantWorkerDirectory(
    effectiveScope === 'all' ? (tenantId ?? null) : null,
  );

  /** Full-collection query (search and/or group/state/entity) across all tenant listable users.
   *  Fires immediately on commit (Enter / Clear / suggestion-pick) — no debounce, since
   *  the user has already signaled intent. */
  useEffect(() => {
    if (!activeTenant?.id || !tenantId) return;
    if (effectiveScope !== 'all') return;
    // This mount restored these exact results from the back-nav cache — don't
    // refetch them (directory revalidation re-runs this effect via the
    // `workerDirectory.workers` dep; the key check keeps the skip scoped to
    // the restored filter set only).
    if (backNavRestoredKeyRef.current === backNavCacheKey) return;
    const q = submittedSearchTerm.trim();
    const hasGroup = groupFilter !== 'all';
    const hasState = stateFilter !== 'all';
    const hasEntity = entityFilter !== 'all';
    const hasStatus = statusFilter !== 'all';
    if (!q && !hasGroup && !hasState && !hasEntity && !hasStatus) {
      setSearchFirestoreLoading(false);
      return;
    }

    /**
     * Fast path — text-only commit AND the directory is loaded. Filter
     * the in-memory directory locally to get matching ids, then hydrate
     * the full user docs the same way the slow path does. Skips the
     * 8.5k-doc server scan entirely (~2s → ~50ms wall clock on a warm
     * cache).
     */
    const canUseDirectory =
      q.length > 0 &&
      !hasGroup &&
      !hasState &&
      !hasEntity &&
      !hasStatus &&
      workerDirectory.workers.length > 0;

    // Slow-path dedup (2026-07-11): this effect re-fires whenever the
    // worker directory revalidates (`workerDirectory.workers` identity),
    // which used to cancel the in-flight scan and start an identical one —
    // 3–5 concurrent full scans per page view, enough to time out the
    // callable. Same filter key → let the original run finish; its writes
    // stay valid because staleness is a monotonic run id (bumped only when
    // a NEW run starts), not a per-effect cancel flag.
    if (!canUseDirectory && lastSlowScanKeyRef.current === backNavCacheKey) return;
    searchScanRunIdRef.current += 1;
    const runId = searchScanRunIdRef.current;
    const isStale = () => searchScanRunIdRef.current !== runId;
    if (!canUseDirectory) lastSlowScanKeyRef.current = backNavCacheKey;

    const hydrateAndSet = async (ids: string[]): Promise<void> => {
      if (isStale()) return;
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
        if (isStale()) return;
        const snap = await getDocs(query(usersRef, where(documentId(), 'in', idChunk)));
        snap.docs.forEach((d) => {
          const u = mapUserDocToRecruiterUser(d, tenantId);
          if (u) byId.set(d.id, u);
        });
      }
      if (isStale()) return;
      const ordered = ids.map((id) => byId.get(id)).filter((u): u is RecruiterUser => !!u);
      setUsers(ordered);
    };

    const runFast = async (): Promise<void> => {
      setSearchFirestoreLoading(true);
      setError(null);
      try {
        const ids: string[] = [];
        for (const w of workerDirectory.workers) {
          if (
            userMatchesSearchTerm(
              {
                firstName: w.firstName,
                lastName: w.lastName,
                displayName: w.displayName,
                email: w.email,
                phone: w.phone,
                skills: w.skills ?? null,
              },
              q,
            )
          ) {
            ids.push(w.id);
            if (ids.length >= 2500) break; // matches server MAX_MATCH_IDS
          }
        }
        await hydrateAndSet(ids);
      } catch (e: unknown) {
        if (!isStale()) {
          console.warn('RecruiterUsers: local directory hydrate failed', e);
          setError(formatFirebaseHttpsError(e));
          setUsers([]);
        }
      } finally {
        if (!isStale()) setSearchFirestoreLoading(false);
      }
    };

    const runSlow = async (): Promise<void> => {
      setSearchFirestoreLoading(true);
      setError(null);
      try {
        const { data } = await callSearchRecruiterTableUsers(functions, {
          tenantId,
          searchQuery: q,
          ...(hasGroup ? { groupId: groupFilter } : {}),
          ...(hasState ? { stateCode: stateFilter } : {}),
          ...(hasEntity ? { entityKey: entityFilter } : {}),
          ...(hasStatus ? { employmentStatus: statusFilter } : {}),
        });
        if (isStale()) return;
        await hydrateAndSet(data.userIds);
      } catch (e: unknown) {
        // Clear the dedup marker so a later re-fire (directory revalidation
        // or filter round-trip) can retry instead of skipping forever.
        lastSlowScanKeyRef.current = null;
        if (!isStale()) {
          console.warn('RecruiterUsers: searchRecruiterTableUsers failed', e);
          setError(formatFirebaseHttpsError(e));
          setUsers([]);
        }
      } finally {
        if (!isStale()) setSearchFirestoreLoading(false);
      }
    };

    void (canUseDirectory ? runFast() : runSlow());
  }, [
    submittedSearchTerm,
    groupFilter,
    stateFilter,
    entityFilter,
    statusFilter,
    effectiveScope,
    tenantId,
    activeTenant?.id,
    workerDirectory.workers,
    backNavCacheKey,
  ]);

  // Update cache when filters change
  useEffect(() => {
    updateCache({
      usersScope: effectiveScope,
      entityFilter,
      statusFilter,
      groupFilter,
      stateFilter,
      sortBy,
      sortDirection,
    });
  }, [effectiveScope, entityFilter, statusFilter, groupFilter, stateFilter, sortBy, sortDirection, updateCache]);

  /** Persist table page / rows so browser back from /users/:id returns to the same slice (sessionStorage). */
  useEffect(() => {
    updateCache({ usersTablePage: page, usersTableRowsPerPage: rowsPerPage });
  }, [page, rowsPerPage, updateCache]);

  // Reset client pagination when filters / committed search change.
  // (Live `searchTerm` is intentionally NOT a dep — typing doesn't
  // affect the rendered list; only commit does.)
  // Skip the mount run: on first render every dep "changes" from nothing,
  // which would zero out the persisted `usersTablePage` and break returning
  // to the same table slice from /users/:id. Only genuine in-page filter /
  // search changes should snap back to page 0.
  const pageResetSkipMountRef = useRef(true);
  useEffect(() => {
    if (pageResetSkipMountRef.current) {
      pageResetSkipMountRef.current = false;
      return;
    }
    setPage(0);
  }, [submittedSearchTerm, effectiveScope, entityFilter, statusFilter, groupFilter, stateFilter, sortBy, showFavoritesOnly]);

  /** Work readiness sort only applies when a single entity is selected; reset if user clears entity. */
  useEffect(() => {
    if (entityFilter === 'all' && sortBy === 'workReadiness') {
      setSortBy('accountCreated');
      updateCache({ sortBy: 'accountCreated' });
    }
  }, [entityFilter, sortBy, updateCache]);

  /** 'Terminated' and 'On Assignment' are only offered for C1 Select;
   *  leaving that entity clears the stale status filter. */
  useEffect(() => {
    if (
      (statusFilter === 'terminated' || statusFilter === 'on_assignment') &&
      entityFilter !== 'select'
    ) {
      setStatusFilter('all');
      updateCache({ statusFilter: 'all' });
    }
  }, [entityFilter, statusFilter, updateCache]);

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
    const newDirection = defaultSortDirectionForKey(key);
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
    // Capture the generation at start; if it advances before we call setUsers,
    // a newer code path (full-collection search) has taken over and our 500-by-
    // createdAt result is now stale and must NOT overwrite it.
    const generation = loadUsersGenerationRef.current;

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

        // My Users = union of two sources during the Phase 1 readiness rollout:
        //
        //   (A) CANONICAL source — `users/{uid}.primaryRecruiterId == me`. This
        //       is the denormalized scalar maintained by the
        //       recomputePrimaryOnEmployeeReadinessItemWrite /
        //       recomputePrimaryOnAssignmentReadinessItemWrite triggers per
        //       recruiter-ownership-model.md §13b. It's authoritative once
        //       readiness items have been seeded for a worker, but won't cover
        //       pre-existing workers until the one-time backfill runs.
        //
        //   (B) LEGACY source — workers linked to me via job_orders I'm
        //       assignedRecruiters on (or the pre-array `recruiterId`). This is
        //       what RecruiterUsers did before the rethink. We union it so the
        //       tab isn't nearly empty during the transition. Once the backfill
        //       runs and every active worker has a scalar, (B) can be removed.
        //
        // We query both in parallel and dedupe by doc id.
        const userDocMap = new Map<string, QueryDocumentSnapshot<DocumentData>>();

        // (A) Canonical — primaryRecruiterId scalar lookup. One indexed query.
        const scalarSnapPromise = getDocs(
          query(usersRef, where('primaryRecruiterId', '==', uid), limit(500)),
        ).then((snap) => {
          snap.docs.forEach((d) => userDocMap.set(d.id, d));
        });

        // (B) Legacy — JO-based union of applications + job_applications + assignments.
        const legacyPromise = (async () => {
          const jobOrdersRef = collection(db, 'tenants', tenantId, 'job_orders');
          const [snapAssigned, snapLegacy] = await Promise.all([
            getDocs(query(jobOrdersRef, where('assignedRecruiters', 'array-contains', uid), limit(500))),
            getDocs(query(jobOrdersRef, where('recruiterId', '==', uid), limit(500))),
          ]);
          const jobOrderIds = Array.from(
            new Set([...snapAssigned.docs.map((d) => d.id), ...snapLegacy.docs.map((d) => d.id)]),
          );
          if (jobOrderIds.length === 0) return;

          const idSet = new Set<string>();
          const chunks = chunk(jobOrderIds, 10);
          const applicationsRef = collection(db, 'tenants', tenantId, 'applications');
          const jobApplicationsRef = collection(db, 'tenants', tenantId, 'job_applications');
          const assignmentsRef = collection(db, 'tenants', tenantId, 'assignments');

          const collectUserIdsFromApplication = (snap: { docs: Array<{ data: () => any }> }) => {
            snap.docs.forEach((d) => {
              const id = extractUserId(d.data());
              if (id) idSet.add(id);
            });
          };

          await Promise.all(
            chunks.map(async (ids) => {
              try {
                const snap = await getDocs(query(applicationsRef, where('jobOrderId', 'in', ids)));
                collectUserIdsFromApplication(snap);
              } catch {
                /* ignore */
              }
            }),
          );
          await Promise.all(
            chunks.map(async (ids) => {
              try {
                const snap = await getDocs(query(jobApplicationsRef, where('jobOrderId', 'in', ids)));
                collectUserIdsFromApplication(snap);
              } catch {
                /* ignore */
              }
            }),
          );
          await Promise.all(
            chunks.map(async (ids) => {
              try {
                const snap = await getDocs(query(assignmentsRef, where('jobOrderId', 'in', ids)));
                collectUserIdsFromApplication(snap);
              } catch {
                /* ignore */
              }
            }),
          );

          const legacyUserIds = Array.from(idSet).filter((id) => !userDocMap.has(id));
          if (legacyUserIds.length === 0) return;

          const userIdChunks = chunk(legacyUserIds, 10);
          const userDocs = (
            await Promise.all(
              userIdChunks.map(async (ids) => {
                const snap = await getDocs(query(usersRef, where(documentId(), 'in', ids)));
                return snap.docs;
              }),
            )
          ).flat();
          userDocs.forEach((d) => userDocMap.set(d.id, d));
        })();

        await Promise.all([scalarSnapPromise, legacyPromise]);

        const mapped = Array.from(userDocMap.values())
          .map((d) => mapUserDocToRecruiterUser(d, tenantId))
          .filter((u): u is RecruiterUser => !!u);

        if (loadUsersGenerationRef.current !== generation) return;
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

      // Stale result — a newer code path (full-collection search) is in charge now.
      if (loadUsersGenerationRef.current !== generation) return;

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

  // (Removed) Auto-paginate-while-typing effect — previously tried to
  // load more 500-doc pages when the user typed something with no local
  // match. The current design only filters on the COMMITTED query (Enter
  // / magnifier click), which fires the full-collection callable in one
  // shot, so progressive in-memory pagination is dead weight.

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

      // Filter only on the COMMITTED query so live typing is a no-op
      // (per design: every search hits the entire DB via the callable,
      // never the 500-row in-memory cache).
      return userMatchesSearchTerm(user, submittedSearchTerm);
    });
  }, [
    favorites,
    fullCollectionQueryActive,
    groupFilter,
    submittedSearchTerm,
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

  /** Export the table as shown — ALL filtered+sorted rows, not just the
   *  current page. Employment chips are only loaded for every row when an
   *  entity filter is active (otherwise just the visible page), so that
   *  column may be blank for off-page rows in unfiltered exports. */
  const [exportAnchor, setExportAnchor] = useState<null | HTMLElement>(null);
  const handleExportUsers = (kind: 'csv' | 'xlsx') => {
    const sheetRows = filteredUsers.map((u) => {
      const chips = entityEmploymentChipsByUser.get(u.id) || [];
      const master = getRecruiterMasterDisplayForAdminUi({
        recruiterMasterScoreRaw: u.recruiterMasterScore,
        recruiterScoreSnapshotRaw: u.recruiterScoreSnapshot,
        userData: { scoreSummary: u.scoreSummary, riskProfile: u.riskProfile },
        latestPrescreenInterviewAi: null,
      });
      const dateOrBlank = (v: unknown) => {
        const s = formatDate(v);
        return s === 'N/A' ? '' : s;
      };
      return {
        Name: `${u.firstName} ${u.lastName}`.trim() || u.displayName || '',
        City: u.city || '',
        State: u.state || '',
        Phone: u.phone ? formatPhoneNumber(u.phone) : '',
        Email: u.email || '',
        Employment: chips.map((c) => `${c.entityLabel}: ${c.statusLabel}`).join('; '),
        Score: master.score100 ?? '',
        'Work history': (u.workHistoryJobTitles || []).join('; '),
        Joined: dateOrBlank(u.createdAt),
        'Last activity': dateOrBlank(u.updatedAt),
        'Last login': dateOrBlank(u.lastLoginAt),
      };
    });
    const ws = XLSX.utils.json_to_sheet(sheetRows);
    const stamp = new Date().toISOString().slice(0, 10);
    const base = [
      'users',
      entityFilter !== 'all' ? entityFilter : '',
      statusFilter !== 'all' ? statusFilter : '',
      stamp,
    ]
      .filter(Boolean)
      .join('-');
    if (kind === 'csv') {
      const csv = XLSX.utils.sheet_to_csv(ws);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${base}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    } else {
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Users');
      XLSX.writeFile(wb, `${base}.xlsx`);
    }
    setExportAnchor(null);
  };

  /** Stable reference for Phase 5.5 certification intelligence (bounded in hook). */
  const workforceCertIntelligenceIds = useMemo(() => filteredUsers.map((u) => u.id), [filteredUsers]);

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
    submittedSearchTerm,
    fullCollectionQueryActive,
  ]);

  const tableLoading = loading || searchFirestoreLoading;

  /** If the result set shrinks, avoid an empty page. Skip while the first rowset is still loading so a restored page is not reset to 0. */
  useEffect(() => {
    if (tableLoading && filteredUsers.length === 0) return;
    const n = filteredUsers.length;
    const maxPage = n === 0 ? 0 : Math.max(0, Math.ceil(n / rowsPerPage) - 1);
    if (page > maxPage) {
      setPage(maxPage);
    }
  }, [filteredUsers.length, rowsPerPage, page, tableLoading]);

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
        {/* Filter & Toolbar Area — collapsible, flat (no card wrapper)
            so it matches `/jobs/job-orders` and `/shifts/list` visually.
            The Show/Hide toggle lives in the parent <UsersLayout> tab
            strip; this surface only consumes the boolean. */}
        <Collapse in={filtersExpanded} timeout="auto" unmountOnExit>
          <Box
            ref={filtersRef}
            sx={{
              px: { xs: 2, md: 3 },
              pt: 1.25,
              pb: 1.5,
              overflowX: 'auto',
              overflowY: 'hidden',
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
                          setStatusFilter('all');
                          updateCache({ usersScope: t.value, entityFilter: 'all', statusFilter: 'all' });
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
            {/* Entity filter — shown on both All Users and My Users.
                The underlying `groupFilter` state is left in place (it's
                consumed by load/filter logic) but no longer surfaced as a
                UI control on these tabs; the dedicated User Groups tabs
                cover that picker. */}
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

            {/* Status filter — employment lifecycle on `entity_employments`,
                matched server-side by `searchRecruiterTableUsers` (scoped to
                the selected entity when one is chosen). Terminated is only
                offered for C1 Select, where separation happens. Inert on My
                Users, so only rendered for the All Users scope. */}
            {effectiveScope === 'all' && (
              <FormControl size="small" sx={{ minWidth: 160, height: 36 }}>
                <InputLabel sx={{ fontSize: '0.875rem' }}>Status</InputLabel>
                <Select
                  label="Status"
                  value={statusFilter}
                  onChange={(e) => {
                    const newFilter = e.target.value as RecruiterUsersStatusFilterKey;
                    setStatusFilter(newFilter);
                    updateCache({ statusFilter: newFilter });
                  }}
                  sx={{
                    height: 36,
                    borderRadius: '6px',
                    backgroundColor: 'white',
                    fontSize: '0.875rem',
                  }}
                >
                  <MenuItem value="all">All statuses</MenuItem>
                  <MenuItem value="active">Active</MenuItem>
                  <MenuItem value="onboarding">Onboarding</MenuItem>
                  {entityFilter === 'select' && (
                    <MenuItem value="on_assignment">On Assignment</MenuItem>
                  )}
                  {entityFilter === 'select' && <MenuItem value="terminated">Terminated</MenuItem>}
                </Select>
              </FormControl>
            )}

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
                  const newDirection = defaultSortDirectionForKey(newSortBy);
                  setSortBy(newSortBy);
                  setSortDirection(newDirection);
                  updateCache({ sortBy: newSortBy, sortDirection: newDirection });
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
                  <MenuItem value="workReadiness">Employment (selected entity)</MenuItem>
                )}
              </Select>
            </FormControl>

            {/* Export — the filtered/sorted rows, as CSV or Excel. */}
            <Box sx={{ ml: 'auto' }}>
              <Button
                size="small"
                variant="outlined"
                startIcon={<FileDownloadOutlinedIcon />}
                onClick={(e) => setExportAnchor(e.currentTarget)}
                sx={{ height: 36, textTransform: 'none', whiteSpace: 'nowrap' }}
              >
                Export
              </Button>
              <MuiMenu
                anchorEl={exportAnchor}
                open={!!exportAnchor}
                onClose={() => setExportAnchor(null)}
              >
                <MenuItem onClick={() => handleExportUsers('xlsx')}>Excel (.xlsx)</MenuItem>
                <MenuItem onClick={() => handleExportUsers('csv')}>CSV</MenuItem>
              </MuiMenu>
            </Box>
          </Box>
          </Box>
        </Collapse>

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
              {/* Order Interviews — same payload as the per-row CTA,
                  looped over the eligible subset of the current
                  selection. The button hides itself when no one in
                  the selection is eligible (already interviewed / no
                  phone / internal staff). */}
              <BulkOrderInterviewButton
                selectedUsers={
                  selectAllResults
                    ? filteredUsers
                    : filteredUsers.filter((u) => selectedIds.has(u.id))
                }
              />
            </Box>
          )}

          <CertificationIntelligencePanel workerIds={workforceCertIntelligenceIds} />

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
                      Employment
                    </TableSortLabel>
                  ) : (
                    'Employment'
                  )}
                </TableCell>
                <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem', borderRadius: 0, minWidth: 120, py: 1 }}>
                  Onboarding
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
                  Concern
                </TableCell>
                <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem', borderRadius: 0, minWidth: 140, py: 1 }}>
                  Work history
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
                          recruiterNameByUid={recruiterNameByUid}
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
                  <TableCell sx={{ verticalAlign: 'top', py: 0.5, px: 1 }}>
                    <RecruiterUserAiScoreCell user={user} categoryScoresCurrent={categoryScoresByUserId[user.id] ?? null} />
                  </TableCell>
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
                          variant="caption"
                          color={muted ? 'text.secondary' : 'text.primary'}
                          sx={{ fontWeight: 400, fontSize: '0.65rem', lineHeight: 1.3, fontFamily: 'inherit', display: 'block' }}
                        >
                          {concern}
                        </Typography>
                      );
                      const concernNode = tip ? (
                        <Tooltip title={<span style={{ whiteSpace: 'pre-wrap' }}>{tip}</span>} placement="top" enterDelay={350}>
                          {body}
                        </Tooltip>
                      ) : (
                        body
                      );
                      return (
                        <>
                          {concernNode}
                          <OrderInterviewInlineAction user={user} />
                        </>
                      );
                    })()}
                  </TableCell>
                  <TableCell sx={{ verticalAlign: 'top', py: 0.5, px: 1, maxWidth: 200 }}>
                    <WorkHistoryJobTitlesCell user={user as unknown as Record<string, unknown>} />
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

