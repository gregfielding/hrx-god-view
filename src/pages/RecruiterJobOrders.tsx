import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { safeToDate } from '../utils/dateUtils';
import {
  Avatar,
  Box,
  Typography,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  Paper,
  CircularProgress,
  Chip,
  IconButton,
  Menu,
  MenuItem,
  FormControl,
  InputLabel,
  Select,
  Stack,
  Tooltip,
  Link as MuiLink,
  Alert,
  Card,
  CardContent,
  Grid,
  Collapse,
} from '@mui/material';
import StandardTablePagination from '../components/StandardTablePagination';
import {
  MoreVert as MoreVertIcon,
  Visibility as VisibilityIcon,
  ContentCopy as CopyIcon,
  FilterList as FilterIcon,
  Work as WorkIcon,
  Business as BusinessIcon,
  Schedule as ScheduleIcon,
  LocationOn as LocationOnIcon,
} from '@mui/icons-material';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { format, formatDistanceToNow } from 'date-fns';
import { usePageCache } from '../hooks/usePageCache';
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  doc,
  getDoc,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore';

import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { p } from '../data/firestorePaths';
import { JobOrder } from '../types/Phase1Types';
import type { JobOrderStatus } from '../types/recruiter/jobOrder';
import FavoriteButton from '../components/FavoriteButton';
import HotToggle from '../components/HotToggle';
import { useFavorites } from '../hooks/useFavorites';
import type { RecruiterOutletContext } from './RecruiterDashboard';
import { hasJobBoardSyndicationUrl } from '../utils/jobBoardSyndicationUrls';
import JobBoardSyndicationIconRow from '../components/JobBoardSyndicationIconRow';
import { JobsBoardService } from '../services/recruiter/jobsBoardService';
import { formatWorksiteCityStateZip } from '../utils/formatWorksiteAddress';
import { normalizeStateCode } from '../utils/unemploymentRates';
import {
  fetchRecruiterPickerOptions,
  type RecruiterPickerOption,
} from '../utils/fetchRecruiterPickerOptions';
import RecruiterAssignmentCell from '../components/recruiter/RecruiterAssignmentCell';

/** Firestore job orders use recruiter statuses (lowercase); Phase1 JobOrder used title-case. */
interface JobOrderWithDetails extends Omit<JobOrder, 'status'> {
  status: JobOrderStatus | string;
  companyName?: string;
  locationName?: string;
  /** City/state/zip for list line + sorting by state */
  worksiteAddress?: { city?: string; state?: string; zipCode?: string };
  worksiteCity?: string;
  recruiterName?: string;
  deal?: any; // The complete deal data structure
  workersNeeded?: number;
  headcountFilled?: number;
  jobTitle?: string;
  jobType?: 'gig' | 'career';
  assignedRecruiters?: string[];
  /**
   * Unique applicant count for this job order. Computed client-side after fetching
   * by batching `where('jobOrderId', 'in', [...])` queries and deduping by `userId`.
   * Undefined while loading; 0 when the batch completes with no matches.
   */
  applicantCount?: number;
}

const PAGE_SIZE = 20;

interface RecruiterJobOrdersProps {
  search?: string;
  showFavoritesOnly?: boolean;
  onlyMyOrders?: boolean;
}

const CACHE_DEFAULTS = {
  statusFilter: '',
  // Fresh page load = Newest First (today → backwards), per Greg 2026-07-08.
  sortField: 'createdAt',
  sortDirection: 'desc' as const,
  companyFilter: 'all',
  typeFilter: 'all',
  hotOnly: false,
  page: 0,
  rowsPerPage: 20,
};

const JOB_ORDER_STATUS_OPTIONS: { value: JobOrderStatus; label: string }[] = [
  { value: 'draft', label: 'Draft' },
  { value: 'open', label: 'Open' },
  { value: 'on_hold', label: 'On hold' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'filled', label: 'Filled' },
  { value: 'completed', label: 'Completed' },
];

/** Normalize legacy values (e.g. on-hold) to canonical JobOrderStatus */
function toCanonicalJobOrderStatus(s: string): JobOrderStatus {
  const raw = (s || '').toLowerCase().trim();
  if (raw === 'on-hold' || raw === 'on hold' || raw === 'onhold') return 'on_hold';
  const underscored = raw.replace(/-/g, '_');
  const allowed: JobOrderStatus[] = ['draft', 'open', 'on_hold', 'cancelled', 'filled', 'completed'];
  if (allowed.includes(underscored as JobOrderStatus)) return underscored as JobOrderStatus;
  return 'open';
}

function formatJobOrderStatusLabel(s: string): string {
  return toCanonicalJobOrderStatus(s).replace(/_/g, ' ');
}

/* -------------------------------------------------------------------------
 * Next-shift helpers — mirrored from RecruiterAccountDetails.tsx so the main
 * Job Orders table can show "Next shift: <date · time>" on Gig rows in place
 * of the legacy "Order Setup: x/y" caption. Handles single-day, multi-day
 * (with per-date dateSchedule) and multi-day (with weekly day-of-week
 * schedule) shapes. Returns earliest enabled occurrence at or after `now`
 * across all of a JO's shifts, or null if none.
 * ------------------------------------------------------------------------- */
function parseYyyyMmDdLocal(s: string | undefined | null): Date | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return Number.isNaN(dt.getTime()) ? null : dt;
}
function formatYyyyMmDdLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function makeShiftDateTime(day: Date, hhmm: string): Date | null {
  if (!/^\d{1,2}:\d{2}$/.test(hhmm)) return null;
  const [h, m] = hhmm.split(':').map(Number);
  const out = new Date(day);
  out.setHours(h, m, 0, 0);
  return out;
}
function nextShiftStartForJobOrder(shifts: Array<Record<string, any>>, now: Date): Date | null {
  let best: Date | null = null;
  for (const shift of shifts) {
    const shiftDate = typeof shift.shiftDate === 'string' ? shift.shiftDate : '';
    const endDate = typeof shift.endDate === 'string' ? shift.endDate : '';
    const defStart = typeof shift.defaultStartTime === 'string' ? shift.defaultStartTime : '00:00';
    const startD = parseYyyyMmDdLocal(shiftDate);
    if (!startD) continue;
    // Cancelled / closed shifts shouldn't drive "next shift".
    const status = typeof shift.status === 'string' ? shift.status.toLowerCase() : '';
    if (status === 'cancelled' || status === 'canceled' || status === 'closed') continue;

    const isMulti = shift.shiftMode === 'multi' && !!endDate && endDate !== shiftDate;
    const endD = isMulti ? parseYyyyMmDdLocal(endDate) : startD;
    if (!endD) continue;
    const dateSched =
      shift.dateSchedule && typeof shift.dateSchedule === 'object'
        ? (shift.dateSchedule as Record<string, { enabled?: boolean; startTime?: string }>)
        : null;
    const weekly =
      shift.weeklySchedule && typeof shift.weeklySchedule === 'object'
        ? (shift.weeklySchedule as Record<string, { enabled?: boolean; startTime?: string }>)
        : null;
    const cursor = new Date(startD);
    while (cursor.getTime() <= endD.getTime()) {
      const dateStr = formatYyyyMmDdLocal(cursor);
      let enabled = true;
      let startTime = defStart;
      if (dateSched && dateSched[dateStr]) {
        const entry = dateSched[dateStr];
        if (entry.enabled === false) enabled = false;
        else if (entry.startTime) startTime = entry.startTime;
      } else if (weekly) {
        const dow = String(cursor.getDay());
        const sched = weekly[dow];
        if (sched?.enabled === false) enabled = false;
        else if (sched?.startTime) startTime = sched.startTime;
      }
      if (enabled) {
        const dt = makeShiftDateTime(cursor, startTime);
        if (dt && dt.getTime() >= now.getTime()) {
          if (!best || dt.getTime() < best.getTime()) best = dt;
        }
      }
      cursor.setDate(cursor.getDate() + 1);
    }
  }
  return best;
}
/** "Apr 30 · 7:00 AM" — compact label used in the row caption. */
function formatNextShiftLabel(d: Date): string {
  const dateLabel = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const timeLabel = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${dateLabel} · ${timeLabel}`;
}

const RecruiterJobOrders: React.FC<RecruiterJobOrdersProps> = ({
  search: searchProp = '', 
  showFavoritesOnly: showFavoritesOnlyProp = false,
  onlyMyOrders: onlyMyOrdersProp
}) => {
  const { user, tenantId } = useAuth();
  const navigate = useNavigate();
  const outletCtx = useOutletContext<RecruiterOutletContext | null>();
  const effectiveSearch = searchProp || outletCtx?.search || '';
  const effectiveShowFavoritesOnly = showFavoritesOnlyProp || outletCtx?.showFavoritesOnly || false;
  // Filter row visibility is lifted into <RecruiterDashboard> so the
  // Show/Hide button can live in the global tab strip (mirrors `/shifts/list`).
  // Falls back to a local state default for any caller that mounts this
  // page outside the recruiter outlet (none today, but cheap to support).
  const filtersExpanded = outletCtx?.filtersExpanded ?? false;
  const effectiveOnlyMyOrders = typeof onlyMyOrdersProp === 'boolean'
    ? onlyMyOrdersProp
    : outletCtx?.activeTab === 'my-orders';

  const pageKey = effectiveOnlyMyOrders ? 'recruiterMyJobOrders' : 'recruiterJobOrders';
  const { cacheState, updateCache } = usePageCache({
    pageKey,
    defaultState: CACHE_DEFAULTS,
  });

  const statusFilter = cacheState.statusFilter ?? CACHE_DEFAULTS.statusFilter;
  const sortField = cacheState.sortField ?? CACHE_DEFAULTS.sortField;
  const sortDirection = (cacheState.sortDirection ?? CACHE_DEFAULTS.sortDirection) as 'asc' | 'desc';
  const companyFilter = cacheState.companyFilter ?? CACHE_DEFAULTS.companyFilter;
  const typeFilter = cacheState.typeFilter ?? CACHE_DEFAULTS.typeFilter;
  const hotOnly = (cacheState as any).hotOnly ?? CACHE_DEFAULTS.hotOnly;
  const page = typeof cacheState.page === 'number' ? cacheState.page : CACHE_DEFAULTS.page;
  const rowsPerPage = typeof cacheState.rowsPerPage === 'number' ? cacheState.rowsPerPage : CACHE_DEFAULTS.rowsPerPage;
  
  // State (not cached)
  const [jobOrders, setJobOrders] = useState<JobOrderWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [selectedJobOrder, setSelectedJobOrder] = useState<JobOrderWithDetails | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [statusMenuAnchor, setStatusMenuAnchor] = useState<Record<string, HTMLElement | null>>({});
  const [statusUpdatingId, setStatusUpdatingId] = useState<string | null>(null);
  const [recruiterPickerOptions, setRecruiterPickerOptions] = useState<RecruiterPickerOption[]>([]);
  const [loadingRecruiterOptions, setLoadingRecruiterOptions] = useState(false);
  const firstLoadRef = useRef(true);
  const prevFiltersRef = useRef<{ search: string; statusFilter: string; companyFilter: string; typeFilter: string; showFavoritesOnly: boolean } | null>(null);

  const { favorites, toggleFavorite, isFavorite } = useFavorites('jobOrders');

  // Get unique companies from all job orders for filtering
  const uniqueCompanies = Array.from(
    new Set(
      jobOrders
        .map(jobOrder => jobOrder.companyName)
        .filter((name): name is string => !!name)
    )
  ).sort();

  // Force re-render when favorites change
  useEffect(() => {
    // Logging removed for production
  }, [favorites, effectiveShowFavoritesOnly]);

  useEffect(() => {
    if (!tenantId) {
      setRecruiterPickerOptions([]);
      return;
    }
    let cancelled = false;
    setLoadingRecruiterOptions(true);
    fetchRecruiterPickerOptions(tenantId)
      .then((opts) => {
        if (!cancelled) setRecruiterPickerOptions(opts);
      })
      .catch(() => {
        if (!cancelled) setRecruiterPickerOptions([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingRecruiterOptions(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  // Patch the in-memory list after <RecruiterAssignmentCell> persists. The
  // cell handles the Firestore write itself; this only refreshes the row
  // we already render so the recruiter pill + sort key reflect the change
  // without waiting for a full refetch.
  const handleAssignmentSaved = useCallback(
    (jobOrderId: string, ids: string[], summary: string) => {
      setJobOrders((prev) =>
        prev.map((jo) =>
          jo.id === jobOrderId
            ? { ...jo, assignedRecruiters: ids, recruiterName: summary }
            : jo,
        ),
      );
    },
    [],
  );

  const fetchJobOrders = useCallback(async () => {
    if (!tenantId) return;
    
    setLoading(true);
    setLoadError(null);
    try {
      // Use the tenant-scoped job_orders collection
      const baseRef = collection(db, p.jobOrders(tenantId));
      
      // Load a reasonable number of job orders for client-side filtering and pagination
      const effectivePageSize = 500; // Load enough for filtering/pagination

      let docsToMap: Array<{ id: string; data: () => any }> = [];

      // "My Orders" should be rock-solid and NOT depend on composite indexes.
      // We intentionally avoid orderBy() and avoid combining where() clauses that would require indexes.
      // Sorting + status/company/search filtering is handled client-side below.
      if (effectiveOnlyMyOrders && user?.uid) {
        const uid = user.uid;

        const qAssigned = query(baseRef, where('assignedRecruiters', 'array-contains', uid), limit(effectivePageSize));
        const qLegacy = query(baseRef, where('recruiterId', '==', uid), limit(effectivePageSize));

        const [snapAssigned, snapLegacy] = await Promise.all([getDocs(qAssigned), getDocs(qLegacy)]);

        const byId = new Map<string, { id: string; data: () => any }>();
        snapAssigned.docs.forEach((d) => byId.set(d.id, d as any));
        snapLegacy.docs.forEach((d) => byId.set(d.id, d as any));
        docsToMap = Array.from(byId.values());
      } else {
        const constraints: any[] = [];

        // Add status filter if selected (normalize to match DB: stored as lowercase e.g. open, cancelled, on-hold)
        if (statusFilter) {
          const normalizedStatus = statusFilter.toLowerCase().replace(/\s+/g, '-');
          constraints.push(where('status', '==', normalizedStatus));
        }

        // recruiterName / worksiteState are computed client-side — use createdAt for Firestore order
        // jobOrderNumber is supported by Firestore orderBy (index required)
        const orderByField =
          sortField === 'recruiterName' || sortField === 'worksiteState' ? 'createdAt' : sortField;
        constraints.push(orderBy(orderByField, sortDirection));
        constraints.push(limit(effectivePageSize));

        const jobOrderQuery = query(baseRef, ...constraints);
        const snap = await getDocs(jobOrderQuery);
        docsToMap = snap.docs as any;
      }

      // ── N+1 elimination ──
      // Previously each JO triggered up to 3 sequential getDoc()s (company,
      // location, first recruiter) inside one big Promise.all — ~1,500 reads
      // for a 500-JO page, which saturated the client and hung the spinner.
      // Companies + recruiters are heavily shared across JOs, so we collect
      // the UNIQUE ids, fetch each referenced doc exactly once, then enrich
      // every JO from in-memory maps (pure, zero I/O).
      const rawList = docsToMap.map((d) => ({ id: d.id, data: d.data() as JobOrder }));

      const companyIds = new Set<string>();
      const recruiterIds = new Set<string>();
      const locationPairs = new Map<string, { companyId: string; worksiteId: string }>();
      for (const { data } of rawList) {
        const cId = (data as any).companyId || (data as any).deal?.companyId;
        const wId = (data as any).worksiteId || (data as any).deal?.locationId;
        if (cId) companyIds.add(cId);
        if (cId && wId) locationPairs.set(`${cId}${wId}`, { companyId: cId, worksiteId: wId });
        const ar = (data as any).assignedRecruiters;
        if (Array.isArray(ar) && ar.length > 0 && ar[0]) recruiterIds.add(ar[0]);
      }

      const companyNameById = new Map<string, string>();
      const companyLogoById = new Map<string, string>();
      const recruiterNameById = new Map<string, string>();
      const locationByKey = new Map<string, any>();
      await Promise.all([
        ...[...companyIds].map(async (cId) => {
          try {
            const s = await getDoc(doc(db, 'tenants', tenantId, 'crm_companies', cId));
            if (s.exists()) {
              const cd = s.data() as any;
              companyNameById.set(cId, cd.companyName || cd.name || 'Unknown Company');
              if (typeof cd.logo === 'string' && cd.logo.trim()) {
                companyLogoById.set(cId, cd.logo.trim());
              }
            }
          } catch {
            /* ignore — falls back to 'Unknown Company' */
          }
        }),
        ...[...recruiterIds].map(async (rId) => {
          try {
            const s = await getDoc(doc(db, 'users', rId));
            if (s.exists()) {
              const rd = s.data() as any;
              recruiterNameById.set(
                rId,
                `${rd.firstName || ''} ${rd.lastName || ''}`.trim() || rd.displayName || rId,
              );
            }
          } catch {
            /* ignore */
          }
        }),
        ...[...locationPairs.entries()].map(async ([key, { companyId, worksiteId }]) => {
          try {
            const s = await getDoc(
              doc(db, 'tenants', tenantId, 'crm_companies', companyId, 'locations', worksiteId),
            );
            if (s.exists()) locationByKey.set(key, s.data());
          } catch {
            /* ignore */
          }
        }),
      ]);

      const newJobOrders: JobOrderWithDetails[] = rawList.map(({ id, data }) => {
        // Derive job title from flat field or gig position
        const derivedJobTitle =
          (data as any).jobTitle ||
          (Array.isArray((data as any).gigPositions) && (data as any).gigPositions[0]?.jobTitle) ||
          undefined;

        const flatCompanyId = (data as any).companyId || (data as any).deal?.companyId;
        const companyName = flatCompanyId
          ? companyNameById.get(flatCompanyId) || 'Unknown Company'
          : 'Unknown Company';
        const companyLogo = flatCompanyId ? companyLogoById.get(flatCompanyId) || null : null;

        // Location display line + city/state line.
        const flatWorksiteId = (data as any).worksiteId || (data as any).deal?.locationId;
        const wa = (data as any).worksiteAddress as Record<string, unknown> | undefined;
        const waInner =
          wa && typeof wa === 'object' ? ((wa as any).address as Record<string, unknown> | undefined) : undefined;
        let city = String(wa?.city ?? waInner?.city ?? (data as any).city ?? '').trim();
        let state = String(wa?.state ?? waInner?.state ?? '').trim();
        let zipCode = String(
          (wa as any)?.zipCode ?? (wa as any)?.zip ?? waInner?.zipCode ?? (data as any).zipCode ?? (data as any).zip ?? '',
        ).trim();

        let locationName =
          String((data as any).worksiteName || (data as any).deal?.locationName || '').trim() || 'No Location';

        // Hydrate from the (deduped) CRM location when worksite + company are known.
        const ld = flatWorksiteId && flatCompanyId
          ? locationByKey.get(`${flatCompanyId}${flatWorksiteId}`)
          : undefined;
        if (ld) {
          const ac = ld.address || {};
          if (locationName === 'No Location') {
            locationName = String(ld.nickname || ld.name || locationName).trim() || 'No Location';
          }
          if (!city) city = String(ld.city || ac.city || '').trim();
          if (!state) state = String(ld.state || ac.state || '').trim();
          if (!zipCode) {
            zipCode = String(ld.zipCode || ld.zip || ac.zipCode || ac.zip || '').trim();
          }
        }

        const worksiteAddress: { city?: string; state?: string; zipCode?: string } | undefined =
          city || state || zipCode
            ? {
                city: city || undefined,
                state: state ? normalizeStateCode(state) || state : undefined,
                zipCode: zipCode || undefined,
              }
            : undefined;
        const worksiteCity = worksiteAddress?.city;

        // Recruiter name from the (deduped) users map.
        let recruiterName = 'Unassigned';
        const assignedRecruiters = (data as any).assignedRecruiters || [];
        if (Array.isArray(assignedRecruiters) && assignedRecruiters.length > 0) {
          const resolved = recruiterNameById.get(assignedRecruiters[0]);
          if (resolved) {
            recruiterName = resolved;
            if (assignedRecruiters.length > 1) recruiterName += ` (+${assignedRecruiters.length - 1})`;
          } else {
            recruiterName =
              assignedRecruiters.length > 1 ? `${assignedRecruiters.length} recruiters` : 'Unassigned';
          }
        }

        return {
          ...data,
          id,
          companyName,
          companyLogo,
          locationName,
          worksiteAddress,
          worksiteCity,
          jobTitle: derivedJobTitle,
          recruiterName,
        };
      });

      // Sort by worksite state (client-side — not on Firestore index)
      if (sortField === 'worksiteState') {
        const key = (jo: JobOrderWithDetails) =>
          normalizeStateCode(jo.worksiteAddress?.state || '').toUpperCase() || '\uFFFF';
        newJobOrders.sort((a, b) => {
          const cmp = key(a).localeCompare(key(b));
          return sortDirection === 'asc' ? cmp : -cmp;
        });
      } else if (sortField === 'recruiterName') {
        newJobOrders.sort((a, b) => {
          const na = (a.recruiterName || 'Unassigned').toLowerCase();
          const nb = (b.recruiterName || 'Unassigned').toLowerCase();
          const cmp = na.localeCompare(nb);
          return sortDirection === 'asc' ? cmp : -cmp;
        });
      } else if (sortField === 'jobOrderNumber') {
        // Always re-sort numerically client-side: jobOrderNumber is stored
        // as a NUMBER on some docs and a zero-padded STRING on others, and
        // Firestore's orderBy groups by type first — producing two separate
        // descending runs in the table (bug report 2026-07-08).
        newJobOrders.sort((a, b) => {
          const aNum = Number(a.jobOrderNumber) || 0;
          const bNum = Number(b.jobOrderNumber) || 0;
          return sortDirection === 'desc' ? bNum - aNum : aNum - bNum;
        });
      }

      setJobOrders(newJobOrders);
      firstLoadRef.current = false;
      // Applicant counts are computed in a separate effect below — once the
      // visible page + its connected jobs-board posts are loaded — so we can
      // count apps linked via `jobOrderId`, `jobId`, AND `postId` the same way
      // `RecruiterJobOrderDetail.fetchApplicants()` does. Counting only by
      // `jobOrderId` here undercounts (detail showed 19, table showed 11).
    } catch (error) {
      console.error('❌ RecruiterJobOrders: Error fetching job orders:', error);
      const err = error as any;
      const msg =
        err?.code === 'failed-precondition'
          ? 'Job Orders query requires a Firestore index. We can add the index, but this tab should still work; please refresh.'
          : err?.message || 'Failed to load job orders.';
      setLoadError(msg);
    } finally {
      setLoading(false);
    }
  }, [tenantId, statusFilter, sortField, sortDirection, effectiveOnlyMyOrders, user?.uid]);

  useEffect(() => {
    const ref = outletCtx?.jobOrdersListRefreshRef;
    if (!ref) return;
    ref.current = fetchJobOrders;
    return () => {
      ref.current = null;
    };
  }, [fetchJobOrders, outletCtx]);

  // Reset and reload when filters/search/sort change
  useEffect(() => {
    if (tenantId) {
      setJobOrders([]);
      firstLoadRef.current = true;
      fetchJobOrders();
    }
  }, [tenantId, statusFilter, sortField, sortDirection, companyFilter, fetchJobOrders]);
  
  // Reset and reload when search or favorites filter changes (from props)
  useEffect(() => {
    if (!tenantId) return;
    
    const timeoutId = setTimeout(() => {
      setJobOrders([]);
      updateCache({ page: 0 });
      firstLoadRef.current = true;
      fetchJobOrders();
    }, 500); // 500ms debounce
    
    return () => clearTimeout(timeoutId);
  }, [effectiveSearch, effectiveShowFavoritesOnly, tenantId, fetchJobOrders, updateCache]);

  // Reset page to 0 when user changes filters/search (not on initial mount / restore from cache)
  useEffect(() => {
    const current = {
      search: effectiveSearch,
      statusFilter,
      companyFilter,
      typeFilter,
      showFavoritesOnly: effectiveShowFavoritesOnly,
    };
    if (prevFiltersRef.current === null) {
      prevFiltersRef.current = current;
      return;
    }
    if (
      prevFiltersRef.current.search !== current.search ||
      prevFiltersRef.current.statusFilter !== current.statusFilter ||
      prevFiltersRef.current.companyFilter !== current.companyFilter ||
      prevFiltersRef.current.typeFilter !== current.typeFilter ||
      prevFiltersRef.current.showFavoritesOnly !== current.showFavoritesOnly
    ) {
      updateCache({ page: 0 });
      prevFiltersRef.current = current;
    }
  }, [effectiveSearch, effectiveShowFavoritesOnly, statusFilter, companyFilter, typeFilter, updateCache]);

  // Client-side filtering for real-time search and other filters
  const filteredJobOrders = jobOrders.filter(jo => {
    // Search filter
    if (effectiveSearch) {
      const searchLower = effectiveSearch.toLowerCase();
      const matchesSearch = (
        (jo.jobOrderName && jo.jobOrderName.toLowerCase().includes(searchLower)) ||
        (jo.companyName && jo.companyName.toLowerCase().includes(searchLower)) ||
        (jo.locationName && jo.locationName.toLowerCase().includes(searchLower)) ||
        (jo.worksiteCity && jo.worksiteCity.toLowerCase().includes(searchLower)) ||
        (jo.worksiteAddress?.state && jo.worksiteAddress.state.toLowerCase().includes(searchLower)) ||
        (jo.jobTitle && jo.jobTitle.toLowerCase().includes(searchLower))
      );
      if (!matchesSearch) return false;
    }
    
    // Favorites filter
    if (effectiveShowFavoritesOnly && !isFavorite(jo.id)) {
      return false;
    }
    
    // Status filter
    if (statusFilter && jo.status?.toLowerCase() !== statusFilter.toLowerCase()) {
      return false;
    }
    
    // Company filter
    if (companyFilter !== 'all' && jo.companyName !== companyFilter) {
      return false;
    }

    // Type filter — Career vs Gig. `jobType === 'gig'` => Gig; anything else
    // (including missing) is treated as Career.
    if (typeFilter !== 'all') {
      const isGigJob = (jo as any).jobType === 'gig';
      if (typeFilter === 'gig' && !isGigJob) return false;
      if (typeFilter === 'career' && isGigJob) return false;
    }

    // 🔥 Hot only — engaged client relationships (shared flag across the
    // order/account/contact trio).
    if (hotOnly && (jo as any).hot !== true) return false;

    return true;
  });

  // Paginate filtered job orders
  const paginatedJobOrders = useMemo(() => {
    const startIndex = page * rowsPerPage;
    const endIndex = startIndex + rowsPerPage;
    return filteredJobOrders.slice(startIndex, endIndex);
  }, [filteredJobOrders, page, rowsPerPage]);

  const [jobPostsByJobOrderId, setJobPostsByJobOrderId] = useState<Record<string, any[]>>({});

  /**
   * Earliest future enabled shift datetime per Gig JO on the current page.
   * Drives the "Next shift: <date · time>" caption that replaces the legacy
   * "Order Setup: x/y" line. Career JOs are skipped (no shift concept) and
   * absent entries simply render no caption.
   */
  const [nextShiftByJobOrderId, setNextShiftByJobOrderId] = useState<Record<string, Date>>({});

  /**
   * Fan-out fetch of shifts for each Gig JO currently on the visible page.
   * Career orders are skipped. Processed in chunks of 10 so we don't slam
   * Firestore for tenants with many gig orders. Aborts cleanly on unmount /
   * pagination so stale results don't overwrite a newer fetch.
   */
  useEffect(() => {
    if (!tenantId) return;
    const gigJobOrderIds = paginatedJobOrders
      .filter((jo) => (jo as any).jobType === 'gig')
      .map((jo) => jo.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
    if (gigJobOrderIds.length === 0) {
      setNextShiftByJobOrderId({});
      return;
    }
    let cancelled = false;
    (async () => {
      const result: Record<string, Date> = {};
      const now = new Date();
      const CHUNK = 10;
      for (let i = 0; i < gigJobOrderIds.length; i += CHUNK) {
        if (cancelled) return;
        const chunk = gigJobOrderIds.slice(i, i + CHUNK);
        await Promise.all(
          chunk.map(async (joId) => {
            try {
              const shiftsRef = collection(
                db,
                'tenants',
                tenantId,
                'job_orders',
                joId,
                'shifts',
              );
              const snap = await getDocs(shiftsRef);
              const shifts = snap.docs.map((d) => d.data() as Record<string, any>);
              const next = nextShiftStartForJobOrder(shifts, now);
              if (next) result[joId] = next;
            } catch {
              // Ignore per-JO failures — missing `next shift` just means the
              // row falls back to no caption instead of a stale or wrong value.
            }
          }),
        );
      }
      if (!cancelled) setNextShiftByJobOrderId(result);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, paginatedJobOrders]);

  // Load jobs board posts for currently visible job orders (chunked to respect Firestore 'in' limits)
  useEffect(() => {
    if (!tenantId) return;
    const ids = paginatedJobOrders.map((jo) => jo.id).filter(Boolean);
    const missing = ids.filter((id) => jobPostsByJobOrderId[id] === undefined);
    if (missing.length === 0) return;

    let cancelled = false;

    const fetchPostsForVisibleOrders = async () => {
      try {
        const postsRef = collection(db, 'tenants', tenantId, 'job_postings');
        const chunks: string[][] = [];
        for (let i = 0; i < missing.length; i += 10) chunks.push(missing.slice(i, i + 10));

        const results: any[][] = await Promise.all(
          chunks.map(async (chunk) => {
            const q = query(postsRef, where('jobOrderId', 'in', chunk));
            const snap = await getDocs(q);
            return snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
          })
        );

        const allPosts = results.flat() as any[];
        const nextMap: Record<string, any[]> = {};
        // initialize all missing to empty arrays
        missing.forEach((id) => {
          nextMap[id] = [];
        });
        allPosts.forEach((post: any) => {
          const joId = post.jobOrderId as string | undefined;
          if (!joId) return;
          if (!nextMap[joId]) nextMap[joId] = [];
          nextMap[joId].push(post);
        });

        if (cancelled) return;
        setJobPostsByJobOrderId((prev) => ({ ...prev, ...nextMap }));
      } catch (err) {
        // Silent fail: checklist progress will be best-effort without job post data.
        if (cancelled) return;
        setJobPostsByJobOrderId((prev) => {
          const next = { ...prev };
          missing.forEach((id) => {
            if (next[id] === undefined) next[id] = [];
          });
          return next;
        });
      }
    };

    fetchPostsForVisibleOrders();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, paginatedJobOrders]);

  // Compute unique applicant count for each visible job order. Mirrors
  // `RecruiterJobOrderDetail.fetchApplicants()` so the table number matches the
  // detail-page header (e.g. "Applications (19)"). Three link types:
  //   1. application.jobOrderId  — direct
  //   2. application.jobId       — via a connected jobs-board posting
  //   3. application.postId      — same, legacy field name
  // We dedupe by userId (falling back to candidateId, then doc id) so one
  // worker applying to multiple shifts in the same job order counts once.
  useEffect(() => {
    if (!tenantId) return;
    const visibleIds = paginatedJobOrders.map((jo) => jo.id).filter(Boolean);
    if (visibleIds.length === 0) return;

    // postId -> jobOrderId reverse map, built from already-loaded jobs-board posts
    const postToJobOrder = new Map<string, string>();
    const allPostIds: string[] = [];
    visibleIds.forEach((joId) => {
      const posts = jobPostsByJobOrderId[joId] || [];
      posts.forEach((p: any) => {
        if (p?.id) {
          postToJobOrder.set(p.id, joId);
          allPostIds.push(p.id);
        }
      });
    });

    let cancelled = false;
    (async () => {
      try {
        const applicationsRef = collection(db, 'tenants', tenantId, 'applications');
        const CHUNK = 30;
        const setsByJo = new Map<string, Set<string>>();
        const keyFor = (d: { userId?: string; candidateId?: string }, docId: string): string =>
          (typeof d.userId === 'string' && d.userId.trim()) ||
          (typeof d.candidateId === 'string' && d.candidateId.trim()) ||
          docId;
        const addFor = (joId: string, key: string) => {
          let set = setsByJo.get(joId);
          if (!set) {
            set = new Set<string>();
            setsByJo.set(joId, set);
          }
          set.add(key);
        };

        // 1) Apps with jobOrderId set directly
        for (let i = 0; i < visibleIds.length; i += CHUNK) {
          const chunk = visibleIds.slice(i, i + CHUNK);
          const snap = await getDocs(query(applicationsRef, where('jobOrderId', 'in', chunk)));
          snap.docs.forEach((d) => {
            const data = d.data() as { jobOrderId?: string; userId?: string; candidateId?: string };
            if (!data.jobOrderId) return;
            addFor(data.jobOrderId, keyFor(data, d.id));
          });
        }

        // 2) + 3) Apps linked via a connected job post (by jobId or postId)
        if (allPostIds.length > 0) {
          for (let i = 0; i < allPostIds.length; i += CHUNK) {
            const chunk = allPostIds.slice(i, i + CHUNK);
            const [byJobId, byPostId] = await Promise.all([
              getDocs(query(applicationsRef, where('jobId', 'in', chunk))),
              getDocs(query(applicationsRef, where('postId', 'in', chunk))),
            ]);
            [byJobId, byPostId].forEach((snap) => {
              snap.docs.forEach((d) => {
                const data = d.data() as {
                  jobId?: string;
                  postId?: string;
                  userId?: string;
                  candidateId?: string;
                };
                const postRef = data.jobId || data.postId;
                if (!postRef) return;
                const joId = postToJobOrder.get(postRef);
                if (!joId) return;
                addFor(joId, keyFor(data, d.id));
              });
            });
          }
        }

        if (cancelled) return;
        setJobOrders((prev) =>
          prev.map((jo) =>
            visibleIds.includes(jo.id)
              ? { ...jo, applicantCount: setsByJo.get(jo.id)?.size ?? 0 }
              : jo,
          ),
        );
      } catch (err) {
        if (cancelled) return;
        console.warn('RecruiterJobOrders: applicant count fetch failed', err);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, paginatedJobOrders, jobPostsByJobOrderId]);

  const handleSort = (field: string) => {
    // Applicants is computed client-side after the main fetch (not a Firestore field) — not sortable.
    if (field === 'Applicants' || field === 'Requested/Filled') return;
    const newDirection = sortField === field && sortDirection === 'desc' ? 'asc' : 'desc';
    updateCache({ sortField: field, sortDirection: newDirection, page: 0 });
  };

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>, jobOrder: JobOrderWithDetails) => {
    setAnchorEl(event.currentTarget);
    setSelectedJobOrder(jobOrder);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
    setSelectedJobOrder(null);
  };

  const closeStatusMenu = (jobOrderId: string) => {
    setStatusMenuAnchor((prev) => ({ ...prev, [jobOrderId]: null }));
  };

  const handleJobOrderStatusChange = async (jobOrderId: string, newStatus: JobOrderStatus) => {
    closeStatusMenu(jobOrderId);
    if (!tenantId) return;
    const previousStatus = jobOrders.find((jo) => jo.id === jobOrderId)?.status;
    setStatusUpdatingId(jobOrderId);
    setLoadError(null);
    try {
      await updateDoc(doc(db, p.jobOrder(tenantId, jobOrderId)), {
        status: newStatus,
        updatedAt: serverTimestamp(),
      });
      setJobOrders((prev) =>
        prev.map((jo) => (jo.id === jobOrderId ? { ...jo, status: newStatus } : jo))
      );
      try {
        await JobsBoardService.getInstance().syncLinkedJobPostingsToJobOrderStatus(
          tenantId,
          jobOrderId,
          newStatus,
          previousStatus,
        );
      } catch (syncErr) {
        console.error('Failed to sync jobs board postings for job order status:', syncErr);
      }
    } catch (err) {
      console.error('Failed to update job order status:', err);
      setLoadError(err instanceof Error ? err.message : 'Failed to update status');
    } finally {
      setStatusUpdatingId(null);
    }
  };

  const handleViewJobOrder = () => {
    if (selectedJobOrder) {
      navigate(`/jobs/job-orders/${selectedJobOrder.id}`);
    }
    handleMenuClose();
  };


  const handleCopyLink = async () => {
    if (selectedJobOrder) {
      const link = `${window.location.origin}/jobs/job-orders/${selectedJobOrder.id}`;
      try {
        await navigator.clipboard.writeText(link);
        // TODO: Show success toast
      } catch (error) {
        console.error('Failed to copy link:', error);
      }
    }
    handleMenuClose();
  };

  const getStatusColor = (status: string) => {
    const normalizedStatus = status?.toLowerCase();
    switch (normalizedStatus) {
      case 'open': return 'success';
      case 'on_hold':
      case 'on-hold': 
      case 'on hold': 
      case 'onhold': return 'warning';
      case 'cancelled': 
      case 'canceled': return 'error';
      case 'filled': 
      case 'closed': return 'info';
      case 'completed': 
      case 'finished': return 'default';
      case 'pending': 
      case 'draft': return 'secondary';
      default: return 'default';
    }
  };

  const formatJobOrderNumber = (number: number) => {
    return number.toString().padStart(4, '0');
  };


  return (
    <Box sx={{ 
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      px: { xs: 2, md: 3 },
      pt: 2,
    }}>
      {/* Filter & Toolbar Area — collapsible, flat (no wrapping card) so it
          matches `/shifts/list` visually. The Show/Hide button lives in the
          parent <RecruiterDashboard> tab strip. */}
      <Collapse in={filtersExpanded} timeout="auto" unmountOnExit>
        <Box
          sx={{
            display: 'flex',
            gap: 1.25,
            alignItems: 'center',
            flexWrap: 'wrap',
            rowGap: 1,
            pt: 1.25,
            pb: 1.5,
          }}
        >
        <FormControl size="small" sx={{ minWidth: 150, height: 36 }}>
          <InputLabel sx={{ fontSize: '0.875rem' }}>Status</InputLabel>
          <Select
            value={statusFilter}
            onChange={(e) => updateCache({ statusFilter: e.target.value })}
            label="Status"
            sx={{
              height: 36,
              borderRadius: '6px',
              backgroundColor: 'white',
              fontSize: '0.875rem',
              '& .MuiOutlinedInput-notchedOutline': {
                borderColor: '#E5E7EB',
              },
              '&:hover .MuiOutlinedInput-notchedOutline': {
                borderColor: '#D1D5DB',
              },
            }}
          >
            <MenuItem value="">All Statuses</MenuItem>
            <MenuItem value="Open">Open</MenuItem>
            <MenuItem value="On-Hold">On-Hold</MenuItem>
            <MenuItem value="Cancelled">Cancelled</MenuItem>
            <MenuItem value="Filled">Filled</MenuItem>
            <MenuItem value="Completed">Completed</MenuItem>
          </Select>
        </FormControl>
        
        <FormControl size="small" sx={{ minWidth: 180, height: 36 }}>
          <InputLabel sx={{ fontSize: '0.875rem' }}>Company</InputLabel>
          <Select
            value={companyFilter}
            onChange={(e) => updateCache({ companyFilter: e.target.value })}
            label="Company"
            sx={{
              height: 36,
              borderRadius: '6px',
              backgroundColor: 'white',
              fontSize: '0.875rem',
              '& .MuiOutlinedInput-notchedOutline': {
                borderColor: '#E5E7EB',
              },
              '&:hover .MuiOutlinedInput-notchedOutline': {
                borderColor: '#D1D5DB',
              },
            }}
          >
            <MenuItem value="all">All Companies</MenuItem>
            {uniqueCompanies.map((company) => (
              <MenuItem key={company} value={company}>
                {company}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <FormControl size="small" sx={{ minWidth: 130, height: 36 }}>
          <InputLabel sx={{ fontSize: '0.875rem' }}>Type</InputLabel>
          <Select
            value={typeFilter}
            onChange={(e) => updateCache({ typeFilter: e.target.value })}
            label="Type"
            sx={{
              height: 36,
              borderRadius: '6px',
              backgroundColor: 'white',
              fontSize: '0.875rem',
              '& .MuiOutlinedInput-notchedOutline': {
                borderColor: '#E5E7EB',
              },
              '&:hover .MuiOutlinedInput-notchedOutline': {
                borderColor: '#D1D5DB',
              },
            }}
          >
            <MenuItem value="all">All</MenuItem>
            <MenuItem value="career">Career</MenuItem>
            <MenuItem value="gig">Gig</MenuItem>
          </Select>
        </FormControl>

        <FormControl size="small" sx={{ minWidth: 150, height: 36 }}>
          <InputLabel sx={{ fontSize: '0.875rem' }}>Sort By</InputLabel>
          <Select
            value={
              sortField === 'createdAt'
                ? sortDirection === 'asc'
                  ? 'oldestFirst'
                  : 'newestFirst'
                : sortField
            }
            onChange={(e) => {
              // Each option pins BOTH field and direction — direction is a
              // separately persisted setting that header-arrow clicks flip,
              // and without pinning it "Newest First" could silently render
              // oldest-first (bug report 2026-07-08).
              const v = e.target.value;
              if (v === 'newestFirst') updateCache({ sortField: 'createdAt', sortDirection: 'desc' });
              else if (v === 'oldestFirst') updateCache({ sortField: 'createdAt', sortDirection: 'asc' });
              else if (v === 'jobOrderNumber') updateCache({ sortField: v, sortDirection: 'desc' });
              else updateCache({ sortField: v, sortDirection: 'asc' });
            }}
            label="Sort By"
            sx={{
              height: 36,
              borderRadius: '6px',
              backgroundColor: 'white',
              fontSize: '0.875rem',
              '& .MuiOutlinedInput-notchedOutline': {
                borderColor: '#E5E7EB',
              },
              '&:hover .MuiOutlinedInput-notchedOutline': {
                borderColor: '#D1D5DB',
              },
            }}
          >
            <MenuItem value="jobOrderNumber">Job Order #</MenuItem>
            <MenuItem value="newestFirst">Newest First</MenuItem>
            <MenuItem value="oldestFirst">Oldest First</MenuItem>
            <MenuItem value="status">Status</MenuItem>
            <MenuItem value="worksiteState">State</MenuItem>
          </Select>
        </FormControl>

        <Button
          variant={hotOnly ? 'contained' : 'outlined'}
          size="small"
          onClick={() => updateCache({ hotOnly: !hotOnly } as any)}
          sx={{
            height: 36,
            borderRadius: '6px',
            textTransform: 'none',
            fontSize: '0.875rem',
            minWidth: 'auto',
            px: 1.5,
            ...(hotOnly
              ? { bgcolor: '#ff5722', '&:hover': { bgcolor: '#e64a19' } }
              : { borderColor: '#E5E7EB', color: 'text.secondary' }),
          }}
        >
          🔥 Hot
        </Button>
        </Box>
      </Collapse>

      {loadError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {loadError}
        </Alert>
      )}

      {/* Job Orders Table */}
      {loading && jobOrders.length === 0 ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
          <CircularProgress />
        </Box>
      ) : filteredJobOrders.length === 0 ? (
        <Box sx={{ textAlign: 'center', py: 8 }}>
          <WorkIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
          <Typography variant="h6" color="text.secondary" gutterBottom>
            No job orders found
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            {effectiveSearch || statusFilter
              ? 'Try adjusting your search criteria'
              : 'Create your first job order to get started'
            }
          </Typography>
        </Box>
      ) : (
        /* Layout/design copied from the account-detail Job Orders tab so the
           two surfaces stay visually identical — uppercase 0.75rem header
           cells, zebra-striped rows, gray Type chip. The Recruiter cell on
           BOTH surfaces uses <RecruiterAssignmentCell> (inline edit). */
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <TableContainer
            component={Paper}
            sx={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              overflowY: 'auto',
              overflowX: 'auto',
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
            <Table stickyHeader size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.75rem', width: 60 }} />
                  <TableCell sx={{ fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.75rem' }}>
                    <TableSortLabel
                      active={sortField === 'jobOrderNumber'}
                      direction={sortField === 'jobOrderNumber' ? sortDirection : 'desc'}
                      onClick={(e) => { e.stopPropagation(); handleSort('jobOrderNumber'); }}
                    >
                      #
                    </TableSortLabel>
                  </TableCell>
                  <TableCell sx={{ fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.75rem' }}>Title</TableCell>
                  <TableCell sx={{ fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.75rem' }}>Type</TableCell>
                  <TableCell sx={{ fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.75rem' }}>Job Title</TableCell>
                  <TableCell sx={{ fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.75rem' }}>Account</TableCell>
                  <TableCell sx={{ fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.75rem' }}>
                    <TableSortLabel
                      active={sortField === 'worksiteState'}
                      direction={sortField === 'worksiteState' ? sortDirection : 'asc'}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSort('worksiteState');
                      }}
                    >
                      Location
                    </TableSortLabel>
                  </TableCell>
                  <TableCell sx={{ fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.75rem' }}>Status</TableCell>
                  <TableCell sx={{ fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.75rem' }}>Applicants</TableCell>
                  <TableCell sx={{ fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.75rem' }}>
                    <TableSortLabel
                      active={sortField === 'recruiterName'}
                      direction={sortField === 'recruiterName' ? sortDirection : 'asc'}
                      onClick={() => handleSort('recruiterName')}
                    >
                      Recruiter(s)
                    </TableSortLabel>
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {paginatedJobOrders.map((jobOrder, index) => (
                  <TableRow
                    key={jobOrder.id}
                    hover
                    onClick={() => navigate(`/jobs/job-orders/${jobOrder.id}`)}
                    sx={{
                      cursor: 'pointer',
                      backgroundColor: index % 2 === 0 ? 'background.paper' : 'action.hover',
                      '&:hover': { backgroundColor: 'action.selected' },
                    }}
                  >
                    {/* No cell-level stopPropagation here — FavoriteButton
                        already stops propagation in its own onClick, so a
                        blanket handler on the whole <td> would just create a
                        dead click zone in the cell's padding around the icon
                        (the row wouldn't open even though the click landed
                        nowhere near the star). Same reasoning applies to the
                        Status and Recruiter(s) cells below. */}
                    <TableCell>
                      <FavoriteButton
                        itemId={jobOrder.id}
                        favoriteType="jobOrders"
                        isFavorite={isFavorite}
                        toggleFavorite={toggleFavorite}
                        size="small"
                        tooltipText={{
                          favorited: 'Remove from favorites',
                          notFavorited: 'Add to favorites'
                        }}
                      />
                      <HotToggle
                        tenantId={tenantId!}
                        originType="job_order"
                        originId={jobOrder.id}
                        hot={(jobOrder as any).hot === true}
                      />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {formatJobOrderNumber(jobOrder.jobOrderNumber)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25, minWidth: 0 }}>
                        <Typography variant="body2" sx={{ fontWeight: 500 }}>
                          {jobOrder.jobOrderName}
                        </Typography>
                        {(() => {
                          const jobPosts = jobPostsByJobOrderId[jobOrder.id] || [];
                          const indeedFromPosts = (jobPosts as any[])
                            .map((p) => (typeof p?.indeedUrl === 'string' ? p.indeedUrl.trim() : ''))
                            .find(Boolean);
                          const craigslistFromPosts = (jobPosts as any[])
                            .map((p) => (typeof p?.craigslistUrl === 'string' ? p.craigslistUrl.trim() : ''))
                            .find(Boolean);
                          const indeedUrl =
                            indeedFromPosts || (typeof (jobOrder as any)?.indeedUrl === 'string' ? (jobOrder as any).indeedUrl.trim() : '') || undefined;
                          const craigslistUrl =
                            craigslistFromPosts ||
                            (typeof (jobOrder as any)?.craigslistUrl === 'string'
                              ? (jobOrder as any).craigslistUrl.trim()
                              : '') ||
                            undefined;
                          const showSyndication = hasJobBoardSyndicationUrl(indeedUrl, craigslistUrl);

                          // Replaces the old "Order Setup: x/y" caption (which
                          // wasn't pulling its weight in this list view). For Gig
                          // JOs with an upcoming shift today or later, surface
                          // the next-shift datetime. Career orders / Gig JOs
                          // with no future shifts render only the syndication
                          // icons (when present) and no caption text.
                          const isGig = (jobOrder as any).jobType === 'gig';
                          const nextShift = isGig ? nextShiftByJobOrderId[jobOrder.id] : null;
                          const showNextShift = isGig && nextShift instanceof Date;

                          if (!showNextShift && !showSyndication) return null;

                          return (
                            <Box
                              sx={{
                                display: 'flex',
                                alignItems: 'center',
                                flexWrap: 'wrap',
                                gap: 0.75,
                                lineHeight: 1.2,
                              }}
                            >
                              {showNextShift ? (
                                <Typography
                                  variant="caption"
                                  color="text.secondary"
                                  component="span"
                                  sx={{ lineHeight: 1.2 }}
                                >
                                  Next shift: {formatNextShiftLabel(nextShift as Date)}
                                </Typography>
                              ) : null}
                              {showSyndication ? (
                                <JobBoardSyndicationIconRow
                                  indeedUrl={indeedUrl}
                                  craigslistUrl={craigslistUrl}
                                  inline
                                  sx={{ mt: 0 }}
                                />
                              ) : null}
                            </Box>
                          );
                        })()}
                      </Box>
                    </TableCell>
                    <TableCell>
                      {/* Type column — Career/Gig chip with the same gray
                          background treatment used on the account-detail
                          Job Orders tab. */}
                      {(() => {
                        const raw = (jobOrder as any).jobType;
                        const label =
                          raw === 'gig'
                            ? 'Gig'
                            : raw === 'career'
                              ? 'Career'
                              : raw
                                ? String(raw)
                                : null;
                        return label ? (
                          <Chip
                            label={label}
                            size="small"
                            sx={{
                              height: 22,
                              fontSize: '0.7rem',
                              fontWeight: 600,
                              bgcolor: 'rgba(0,0,0,0.06)',
                              '& .MuiChip-label': { px: 0.75 },
                            }}
                          />
                        ) : (
                          <Typography variant="body2" color="text.disabled">
                            —
                          </Typography>
                        );
                      })()}
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">{jobOrder.jobTitle || 'No Job Title'}</Typography>
                    </TableCell>
                    <TableCell>
                      {/* Company avatar (logo) instead of icon+name — the
                          name lives in the tooltip (Greg, 2026-07-08). */}
                      {(() => {
                        const name =
                          (jobOrder as any).companyName ||
                          jobOrder.deal?.companyName ||
                          jobOrder.deal?.associations?.companies?.[0]?.snapshot?.companyName ||
                          'Unknown Company';
                        const logo = (jobOrder as any).companyLogo as string | null;
                        return (
                          <Tooltip title={name}>
                            <Avatar
                              src={logo || undefined}
                              alt={name}
                              sx={{ width: 30, height: 30, fontSize: '0.8rem', bgcolor: logo ? 'transparent' : 'primary.main' }}
                            >
                              {name.charAt(0).toUpperCase()}
                            </Avatar>
                          </Tooltip>
                        );
                      })()}
                    </TableCell>
                    <TableCell>
                      {/* Worksite name on top, then street + city/state/zip
                          on lines 2/3 — same shape as the account-detail
                          Job Orders tab so a recruiter can disambiguate
                          two same-named worksites without opening the JO. */}
                      {(() => {
                        const locName = jobOrder.locationName || 'No Location';
                        const addr = jobOrder.worksiteAddress as
                          | { street?: string; city?: string; state?: string; zipCode?: string }
                          | undefined;
                        const street = addr?.street?.trim() || '';
                        const cityStateZip = formatWorksiteCityStateZip(jobOrder.worksiteAddress);
                        return (
                          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5, minWidth: 0 }}>
                            <LocationOnIcon sx={{ fontSize: 16, color: 'text.secondary', mt: '2px', flexShrink: 0 }} />
                            <Box sx={{ minWidth: 0 }}>
                              <Typography variant="body2" sx={{ lineHeight: 1.3 }}>
                                {locName}
                              </Typography>
                              {street && (
                                <Typography
                                  variant="caption"
                                  color="text.secondary"
                                  sx={{ display: 'block', lineHeight: 1.3 }}
                                >
                                  {street}
                                </Typography>
                              )}
                              {cityStateZip && (
                                <Typography
                                  variant="caption"
                                  color="text.secondary"
                                  sx={{ display: 'block', lineHeight: 1.3 }}
                                >
                                  {cityStateZip}
                                </Typography>
                              )}
                            </Box>
                          </Box>
                        );
                      })()}
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={formatJobOrderStatusLabel(jobOrder.status)}
                        color={getStatusColor(jobOrder.status) as any}
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation();
                          setStatusMenuAnchor((prev) => ({
                            ...prev,
                            [jobOrder.id]: e.currentTarget,
                          }));
                        }}
                        sx={{ cursor: statusUpdatingId === jobOrder.id ? 'wait' : 'pointer' }}
                        disabled={statusUpdatingId === jobOrder.id}
                      />
                      <Menu
                        anchorEl={statusMenuAnchor[jobOrder.id] ?? null}
                        open={Boolean(statusMenuAnchor[jobOrder.id])}
                        onClose={() => closeStatusMenu(jobOrder.id)}
                        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
                        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
                        slotProps={{ paper: { sx: { minWidth: 160 } } }}
                      >
                        {JOB_ORDER_STATUS_OPTIONS.map((opt) => (
                          <MenuItem
                            key={opt.value}
                            selected={toCanonicalJobOrderStatus(jobOrder.status) === opt.value}
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleJobOrderStatusChange(jobOrder.id, opt.value);
                            }}
                          >
                            {opt.label}
                          </MenuItem>
                        ))}
                      </Menu>
                    </TableCell>
                    <TableCell>
                      {/* Denormalized on the JO doc by onApplicationWriteUpdateCounters —
                          total real applications + how many await review. Click jumps
                          straight to the Applications tab. */}
                      {(() => {
                        const stats = (jobOrder as any).applicantStats as
                          | { total?: number; new?: number }
                          | undefined;
                        const total = Number(stats?.total ?? 0);
                        const fresh = Number(stats?.new ?? 0);
                        if (total <= 0) {
                          return (
                            <Typography variant="body2" color="text.disabled">
                              —
                            </Typography>
                          );
                        }
                        return (
                          <Box
                            sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(`/jobs/job-orders/${jobOrder.id}?tab=applications`);
                            }}
                          >
                            <Typography variant="body2" sx={{ fontWeight: 600 }}>
                              {total}
                            </Typography>
                            {fresh > 0 && (
                              <Chip
                                label={`${fresh} new`}
                                size="small"
                                color="primary"
                                sx={{ height: 20, fontSize: '0.7rem', cursor: 'pointer' }}
                              />
                            )}
                          </Box>
                        );
                      })()}
                    </TableCell>
                    <TableCell sx={{ verticalAlign: 'middle' }}>
                      <RecruiterAssignmentCell
                        tenantId={tenantId}
                        jobOrderId={jobOrder.id}
                        assignedRecruiterIds={jobOrder.assignedRecruiters || []}
                        options={recruiterPickerOptions}
                        optionsLoading={loadingRecruiterOptions}
                        onSaved={handleAssignmentSaved}
                        onError={(err) =>
                          setLoadError(
                            err instanceof Error ? err.message : 'Failed to update recruiters',
                          )
                        }
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>

          {/* Pagination Footer */}
          <StandardTablePagination
            count={filteredJobOrders.length}
            page={page}
            onPageChange={(_, newPage) => updateCache({ page: newPage })}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={(e) => {
              const value = parseInt(e.target.value, 10);
              updateCache({ rowsPerPage: value, page: 0 });
            }}
          />
        </Box>
      )}

      {/* Action Menu */}
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={handleMenuClose}
      >
        <MenuItem onClick={handleViewJobOrder}>
          <VisibilityIcon sx={{ mr: 1 }} />
          View Details
        </MenuItem>
        <MenuItem onClick={handleCopyLink}>
          <CopyIcon sx={{ mr: 1 }} />
          Copy Link
        </MenuItem>
      </Menu>
    </Box>
  );
};

export default RecruiterJobOrders;
