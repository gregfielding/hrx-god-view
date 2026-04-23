import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { safeToDate, getJobOrderAge } from '../utils/dateUtils';
import {
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
  Autocomplete,
  TextField,
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
import { useFavorites } from '../hooks/useFavorites';
import type { RecruiterOutletContext } from './RecruiterDashboard';
import { getJobOrderChecklistProgress } from '../components/recruiter/JobOrderChecklist';
import { hasJobBoardSyndicationUrl } from '../utils/jobBoardSyndicationUrls';
import JobBoardSyndicationIconRow from '../components/JobBoardSyndicationIconRow';
import { JobsBoardService } from '../services/recruiter/jobsBoardService';
import { formatWorksiteCityStateZip } from '../utils/formatWorksiteAddress';
import { normalizeStateCode } from '../utils/unemploymentRates';
import {
  fetchRecruiterPickerOptions,
  type RecruiterPickerOption,
} from '../utils/fetchRecruiterPickerOptions';

function summarizeAssignedRecruiters(ids: string[], opts: Map<string, RecruiterPickerOption>): string {
  if (!ids.length) return 'Unassigned';
  const names = ids.map((id) => opts.get(id)?.displayName || id);
  const first = names[0];
  return ids.length > 1 ? `${first} (+${ids.length - 1})` : first;
}

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
  sortField: 'jobOrderNumber',
  sortDirection: 'desc' as const,
  companyFilter: 'all',
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
  const [assigningRecruitersJobOrderId, setAssigningRecruitersJobOrderId] = useState<string | null>(null);
  const firstLoadRef = useRef(true);
  const prevFiltersRef = useRef<{ search: string; statusFilter: string; companyFilter: string; showFavoritesOnly: boolean } | null>(null);

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

  const recruiterOptionMap = useMemo(
    () => new Map(recruiterPickerOptions.map((o) => [o.id, o])),
    [recruiterPickerOptions],
  );

  const persistAssignedRecruiters = async (jobOrderId: string, selected: RecruiterPickerOption[]) => {
    if (!tenantId) return;
    const ids = selected.map((s) => s.id);
    setAssigningRecruitersJobOrderId(jobOrderId);
    setLoadError(null);
    try {
      await updateDoc(doc(db, p.jobOrder(tenantId, jobOrderId)), {
        assignedRecruiters: ids,
        updatedAt: serverTimestamp(),
      });
      const mergedNameMap = new Map(recruiterOptionMap);
      selected.forEach((s) => mergedNameMap.set(s.id, s));
      const recruiterName = summarizeAssignedRecruiters(ids, mergedNameMap);
      setJobOrders((prev) =>
        prev.map((jo) =>
          jo.id === jobOrderId ? { ...jo, assignedRecruiters: ids, recruiterName } : jo,
        ),
      );
    } catch (err) {
      console.error('Failed to update assigned recruiters:', err);
      setLoadError(err instanceof Error ? err.message : 'Failed to update recruiters');
    } finally {
      setAssigningRecruitersJobOrderId(null);
    }
  };

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

      const newJobOrders: JobOrderWithDetails[] = await Promise.all(
        docsToMap.map(async (jobOrderDoc) => {
          const data = jobOrderDoc.data() as JobOrder;
          
          // Derive job title from flat field or gig position
          const derivedJobTitle =
            (data as any).jobTitle ||
            (Array.isArray((data as any).gigPositions) && (data as any).gigPositions[0]?.jobTitle) ||
            undefined;

          // Fetch company name
          let companyName = 'Unknown Company';
          const flatCompanyId = (data as any).companyId || (data as any).deal?.companyId;
          if (flatCompanyId) {
            try {
              const companyRef = doc(db, 'tenants', tenantId, 'crm_companies', flatCompanyId);
              const companySnap = await getDoc(companyRef);
              if (companySnap.exists()) {
                const companyData = companySnap.data() as any;
                companyName = companyData.companyName || companyData.name || 'Unknown Company';
              }
            } catch (error) {
              // Silently handle errors
            }
          }
          
          // Location display line + city/state line — same pattern as Jobs Board (`formatWorksiteCityStateZip(post.worksiteAddress)`).
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

          // Always hydrate from CRM location when worksite + company are known — job orders often store only
          // worksiteName on the doc while city/state live on `crm_companies/{id}/locations/{id}`.
          if (flatWorksiteId && flatCompanyId) {
            try {
              const locationRef = doc(
                db,
                'tenants',
                tenantId,
                'crm_companies',
                flatCompanyId,
                'locations',
                flatWorksiteId,
              );
              const locationSnap = await getDoc(locationRef);
              if (locationSnap.exists()) {
                const ld = locationSnap.data() as any;
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
            } catch {
              /* ignore */
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
          
          // Fetch recruiter names from assignedRecruiters array
          let recruiterName = 'Unassigned';
          const assignedRecruiters = (data as any).assignedRecruiters || [];
          if (Array.isArray(assignedRecruiters) && assignedRecruiters.length > 0) {
            try {
              // Fetch the first recruiter's name
              const recruiterId = assignedRecruiters[0];
              const recruiterRef = doc(db, 'users', recruiterId);
              const recruiterSnap = await getDoc(recruiterRef);
              if (recruiterSnap.exists()) {
                const recruiterData = recruiterSnap.data();
                recruiterName = `${recruiterData.firstName || ''} ${recruiterData.lastName || ''}`.trim() || recruiterData.displayName || recruiterId;
                // If there are multiple recruiters, append count
                if (assignedRecruiters.length > 1) {
                  recruiterName += ` (+${assignedRecruiters.length - 1})`;
                }
              }
            } catch (error) {
              // Silently handle errors
              recruiterName = assignedRecruiters.length > 1 
                ? `${assignedRecruiters.length} recruiters`
                : 'Unassigned';
            }
          }
          
          return {
            ...data,
            id: jobOrderDoc.id,
            companyName,
            locationName,
            worksiteAddress,
            worksiteCity,
            jobTitle: derivedJobTitle,
            recruiterName
          };
        })
      );

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
      } else if (sortField === 'jobOrderNumber' && effectiveOnlyMyOrders) {
        newJobOrders.sort((a, b) => {
          const aNum = Number(a.jobOrderNumber) || 0;
          const bNum = Number(b.jobOrderNumber) || 0;
          return sortDirection === 'desc' ? bNum - aNum : aNum - bNum;
        });
      }

      setJobOrders(newJobOrders);
      firstLoadRef.current = false;

      // Fetch unique applicant counts for the visible job orders. Firestore's `in` operator
      // supports up to 30 values per query, so we chunk. We dedupe by `userId` so a worker
      // who applied to multiple shifts inside the same job order counts once. This runs AFTER
      // setJobOrders so the table renders immediately with no count, then the counts fill in.
      const jobOrderIds = newJobOrders.map((jo) => jo.id).filter(Boolean);
      if (jobOrderIds.length > 0) {
        try {
          const applicationsRef = collection(db, 'tenants', tenantId, 'applications');
          const CHUNK = 30;
          const countsByJobOrder = new Map<string, number>();

          for (let i = 0; i < jobOrderIds.length; i += CHUNK) {
            const chunk = jobOrderIds.slice(i, i + CHUNK);
            const snap = await getDocs(
              query(applicationsRef, where('jobOrderId', 'in', chunk)),
            );

            // Group doc userIds by jobOrderId → Set for dedup.
            const perOrder = new Map<string, Set<string>>();
            snap.docs.forEach((d) => {
              const data = d.data() as { jobOrderId?: string; userId?: string; candidateId?: string };
              const joId = data.jobOrderId;
              if (!joId) return;
              // Prefer userId; fall back to candidateId; fall back to the doc id so we at
              // least don't zero-out legacy rows without either field.
              const dedupKey =
                (typeof data.userId === 'string' && data.userId.trim()) ||
                (typeof data.candidateId === 'string' && data.candidateId.trim()) ||
                d.id;
              let set = perOrder.get(joId);
              if (!set) {
                set = new Set<string>();
                perOrder.set(joId, set);
              }
              set.add(String(dedupKey));
            });
            perOrder.forEach((set, joId) => {
              countsByJobOrder.set(joId, (countsByJobOrder.get(joId) ?? 0) + set.size);
            });
          }

          setJobOrders((prev) =>
            prev.map((jo) => ({ ...jo, applicantCount: countsByJobOrder.get(jo.id) ?? 0 })),
          );
        } catch (err) {
          // Don't block the list render — just leave counts undefined on error.
          console.warn('RecruiterJobOrders: applicant count fetch failed', err);
        }
      }
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
      prevFiltersRef.current.showFavoritesOnly !== current.showFavoritesOnly
    ) {
      updateCache({ page: 0 });
      prevFiltersRef.current = current;
    }
  }, [effectiveSearch, effectiveShowFavoritesOnly, statusFilter, companyFilter, updateCache]);

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
    
    return true;
  });

  // Paginate filtered job orders
  const paginatedJobOrders = useMemo(() => {
    const startIndex = page * rowsPerPage;
    const endIndex = startIndex + rowsPerPage;
    return filteredJobOrders.slice(startIndex, endIndex);
  }, [filteredJobOrders, page, rowsPerPage]);

  const [jobPostsByJobOrderId, setJobPostsByJobOrderId] = useState<Record<string, any[]>>({});

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
      {/* Filter & Toolbar Area */}
      <Box sx={{ 
        mb: 2,
        p: 1.5,
        backgroundColor: '#F9FAFB',
        borderRadius: '8px',
        border: '1px solid #E5E7EB',
        borderBottom: '1px solid #D1D5DB'
      }}>
        <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
        
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
        
        <FormControl size="small" sx={{ minWidth: 150, height: 36 }}>
          <InputLabel sx={{ fontSize: '0.875rem' }}>Sort By</InputLabel>
          <Select
            value={sortField}
            onChange={(e) => updateCache({ sortField: e.target.value })}
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
            <MenuItem value="createdAt">Newest First</MenuItem>
            <MenuItem value="status">Status</MenuItem>
            <MenuItem value="worksiteState">State</MenuItem>
          </Select>
        </FormControl>
        </Box>
      </Box>

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
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <TableContainer 
            component={Paper}
            sx={{ 
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              overflowY: 'auto',
              overflowX: 'auto',
              // Scrollbar styling per Inbox Standard
              '&::-webkit-scrollbar': {
                width: '8px',
                height: '8px',
              },
              '&::-webkit-scrollbar-track': {
                background: 'rgba(0, 0, 0, 0.02)',
                borderRadius: '4px',
              },
              '&::-webkit-scrollbar-thumb': {
                background: 'rgba(0, 0, 0, 0.15)',
                borderRadius: '4px',
                '&:hover': {
                  background: 'rgba(0, 0, 0, 0.25)',
                },
              },
              // Firefox scrollbar styling
              scrollbarWidth: 'thin',
              scrollbarColor: 'rgba(0, 0, 0, 0.15) rgba(0, 0, 0, 0.02)',
            }}
          >
            <Table stickyHeader>
              <TableHead sx={{
                position: 'sticky',
                top: 0,
                zIndex: 10,
                backgroundColor: '#FFFFFF',
              }}>
                <TableRow>
                  <TableCell sx={{ 
                    fontWeight: 700, 
                    bgcolor: '#FFFFFF',
                    color: 'text.secondary', 
                    textTransform: 'uppercase', 
                    fontSize: '0.75rem', 
                    width: 60,
                  }}>
                    {/* Empty - just for spacing the favorites column */}
                  </TableCell>
                  <TableCell sx={{ 
                    fontWeight: 700, 
                    bgcolor: '#FFFFFF',
                    color: 'text.secondary', 
                    textTransform: 'uppercase', 
                    fontSize: '0.75rem',
                  }}>
                    <TableSortLabel
                      active={sortField === 'jobOrderNumber'}
                      direction={sortField === 'jobOrderNumber' ? sortDirection : 'desc'}
                      onClick={(e) => { e.stopPropagation(); handleSort('jobOrderNumber'); }}
                    >
                      #
                    </TableSortLabel>
                  </TableCell>
                  <TableCell sx={{ 
                    fontWeight: 700, 
                    bgcolor: '#FFFFFF',
                    color: 'text.secondary', 
                    textTransform: 'uppercase', 
                    fontSize: '0.75rem',
                  }}>
                    Title
                  </TableCell>
                  <TableCell sx={{ 
                    fontWeight: 700, 
                    bgcolor: '#FFFFFF',
                    color: 'text.secondary', 
                    textTransform: 'uppercase', 
                    fontSize: '0.75rem',
                  }}>
                    Job Title
                  </TableCell>
                  <TableCell sx={{ 
                    fontWeight: 700, 
                    bgcolor: '#FFFFFF',
                    color: 'text.secondary', 
                    textTransform: 'uppercase', 
                    fontSize: '0.75rem',
                  }}>
                    Account
                  </TableCell>
                  <TableCell sx={{ 
                    fontWeight: 700, 
                    bgcolor: '#FFFFFF',
                    color: 'text.secondary', 
                    textTransform: 'uppercase', 
                    fontSize: '0.75rem',
                  }}>
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
                  <TableCell sx={{ 
                    fontWeight: 700, 
                    bgcolor: '#FFFFFF',
                    color: 'text.secondary', 
                    textTransform: 'uppercase', 
                    fontSize: '0.75rem',
                  }}>
                    Status
                  </TableCell>
                  <TableCell sx={{
                    fontWeight: 700,
                    bgcolor: '#FFFFFF',
                    color: 'text.secondary',
                    textTransform: 'uppercase',
                    fontSize: '0.75rem',
                  }}>
                    Applicants
                  </TableCell>
                  <TableCell sx={{ 
                    fontWeight: 700, 
                    bgcolor: '#FFFFFF',
                    color: 'text.secondary', 
                    textTransform: 'uppercase', 
                    fontSize: '0.75rem',
                  }}>
                    <TableSortLabel
                      active={sortField === 'recruiterName'}
                      direction={sortField === 'recruiterName' ? sortDirection : 'asc'}
                      onClick={() => handleSort('recruiterName')}
                    >
                      Recruiter(s)
                    </TableSortLabel>
                  </TableCell>
                  <TableCell sx={{ 
                    fontWeight: 700, 
                    bgcolor: '#FFFFFF',
                    color: 'text.secondary', 
                    textTransform: 'uppercase', 
                    fontSize: '0.75rem',
                  }}>
                    Age
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
                      '&:hover': {
                        backgroundColor: 'action.selected'
                      }
                    }}
                  >
                    <TableCell onClick={(e) => e.stopPropagation()}>
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
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {formatJobOrderNumber(jobOrder.jobOrderNumber)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25, minWidth: 0 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
                          <Typography variant="body2" sx={{ fontWeight: 500 }}>
                            {jobOrder.jobOrderName}
                          </Typography>
                          <Chip
                            label={jobOrder.jobType === 'gig' ? 'Gig' : 'Career'}
                            size="small"
                            variant="outlined"
                            sx={{
                              height: 22,
                              fontSize: '0.7rem',
                              fontWeight: 600,
                              flexShrink: 0,
                              ...(jobOrder.jobType === 'gig'
                                ? { borderColor: 'secondary.main', color: 'secondary.dark' }
                                : { borderColor: 'primary.main', color: 'primary.dark' }),
                            }}
                          />
                        </Box>
                        {(() => {
                          const jobPosts = jobPostsByJobOrderId[jobOrder.id] || [];
                          const associatedContacts =
                            (jobOrder as any)?.deal?.associations?.contacts ||
                            (jobOrder as any)?.deal?.associations?.contactsIds ||
                            [];
                          const locationObj = jobOrder.locationName ? { name: jobOrder.locationName } : undefined;
                          const shiftsCount = Number(
                            (jobOrder as any)?.shiftsCount ??
                              (jobOrder as any)?.shiftCount ??
                              (jobOrder as any)?.shifts?.length ??
                              0
                          );

                          const progress = getJobOrderChecklistProgress({
                            jobOrder: jobOrder as any,
                            location: locationObj,
                            associatedContacts: Array.isArray(associatedContacts) ? associatedContacts : [],
                            recruiterUsers: [],
                            jobPosts: jobPosts as any[],
                            shiftsCount,
                            indeedUrl: (jobOrder as any)?.indeedUrl,
                            craigslistUrl: (jobOrder as any)?.craigslistUrl,
                          });

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
                              <Typography variant="caption" color="text.secondary" component="span">
                                Order Setup: {progress.completed}/{progress.total}
                              </Typography>
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
                      <Typography variant="body2">{jobOrder.jobTitle || 'No Job Title'}</Typography>
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <BusinessIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                        <Typography variant="body2">
                          {(jobOrder as any).companyName || 
                           jobOrder.deal?.companyName || 
                           jobOrder.deal?.associations?.companies?.[0]?.snapshot?.companyName || 
                           'Unknown Company'}
                        </Typography>
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.primary">
                        {jobOrder.locationName || 'No Location'}
                      </Typography>
                      {(() => {
                        const line = formatWorksiteCityStateZip(jobOrder.worksiteAddress);
                        return line ? (
                          <Typography variant="caption" color="text.secondary" display="block">
                            {line}
                          </Typography>
                        ) : null;
                      })()}
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
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
                      {/* Unique applicant count for this job order (deduped by userId across
                          all shifts in the order). `undefined` while the batch fetch is in
                          flight — show a dash so the column doesn't lie with a stale "0". */}
                      <Typography variant="body2">
                        {jobOrder.applicantCount === undefined ? '—' : jobOrder.applicantCount}
                      </Typography>
                    </TableCell>
                    <TableCell
                      onClick={(e) => e.stopPropagation()}
                      sx={{ verticalAlign: 'middle', minWidth: 220, maxWidth: 320 }}
                    >
                      <Autocomplete
                        multiple
                        size="small"
                        loading={loadingRecruiterOptions}
                        disabled={assigningRecruitersJobOrderId === jobOrder.id}
                        options={recruiterPickerOptions}
                        value={(jobOrder.assignedRecruiters || [])
                          .map((id) => recruiterOptionMap.get(id))
                          .filter((x): x is RecruiterPickerOption => Boolean(x))}
                        onChange={(_, newValue) => {
                          void persistAssignedRecruiters(jobOrder.id, newValue);
                        }}
                        getOptionLabel={(o) => o.displayName}
                        isOptionEqualToValue={(a, b) => a.id === b.id}
                        filterSelectedOptions
                        renderTags={(tagValue, getTagProps) =>
                          tagValue.map((option, index) => (
                            <Chip
                              {...getTagProps({ index })}
                              key={option.id}
                              label={option.displayName}
                              size="small"
                              sx={{ maxWidth: 120 }}
                            />
                          ))
                        }
                        renderInput={(params) => (
                          <TextField
                            {...params}
                            placeholder="Assign recruiters…"
                            variant="outlined"
                            InputProps={{
                              ...params.InputProps,
                              endAdornment: (
                                <>
                                  {assigningRecruitersJobOrderId === jobOrder.id ? (
                                    <CircularProgress color="inherit" size={14} sx={{ mr: 0.5 }} />
                                  ) : null}
                                  {params.InputProps.endAdornment}
                                </>
                              ),
                            }}
                          />
                        )}
                        sx={{
                          '& .MuiOutlinedInput-root': { py: 0.25 },
                        }}
                      />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">
                        {getJobOrderAge(jobOrder.createdAt)} days
                      </Typography>
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
