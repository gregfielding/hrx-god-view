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
} from '@mui/material';
import StandardTablePagination from '../components/StandardTablePagination';
import {
  MoreVert as MoreVertIcon,
  Visibility as VisibilityIcon,
  ContentCopy as CopyIcon,
  FilterList as FilterIcon,
  Work as WorkIcon,
  Business as BusinessIcon,
  LocationOn as LocationIcon,
  Person as PersonIcon,
  Schedule as ScheduleIcon,
} from '@mui/icons-material';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { format, formatDistanceToNow } from 'date-fns';
import { collection, query, where, orderBy, limit, getDocs, doc, getDoc } from 'firebase/firestore';

import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { p } from '../data/firestorePaths';
import { JobOrder } from '../types/Phase1Types';
import FavoriteButton from '../components/FavoriteButton';
import { useFavorites } from '../hooks/useFavorites';
import type { RecruiterOutletContext } from './RecruiterDashboard';
import { getJobOrderChecklistProgress } from '../components/recruiter/JobOrderChecklist';

interface JobOrderWithDetails extends JobOrder {
  companyName?: string;
  locationName?: string;
  worksiteCity?: string;
  recruiterName?: string;
  deal?: any; // The complete deal data structure
  workersNeeded?: number;
  headcountFilled?: number;
  jobTitle?: string;
}

const PAGE_SIZE = 20;

interface RecruiterJobOrdersProps {
  search?: string;
  showFavoritesOnly?: boolean;
  onlyMyOrders?: boolean;
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
  
  // State
  const [jobOrders, setJobOrders] = useState<JobOrderWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [selectedJobOrder, setSelectedJobOrder] = useState<JobOrderWithDetails | null>(null);
  const [sortField, setSortField] = useState<string>('createdAt');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [companyFilter, setCompanyFilter] = useState<string>('all');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(20);
  const [loadError, setLoadError] = useState<string | null>(null);
  const firstLoadRef = useRef(true);

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

        // Add status filter if selected (kept server-side for non-My Orders views)
        if (statusFilter) {
          constraints.push(where('status', '==', statusFilter));
        }

        // Keep server-side ordering for general listing; if an index is missing Firestore will surface an error.
        constraints.push(orderBy(sortField, sortDirection));
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
          
          // Fetch location nickname
          let locationName = 'No Location';
          const flatWorksiteId = (data as any).worksiteId || (data as any).deal?.locationId;
          const flatWorksiteName = (data as any).worksiteName || (data as any).deal?.locationName;
          let worksiteCity: string | undefined =
            (data as any).worksiteAddress?.city ||
            (data as any).city ||
            undefined;
          
          // First try to use worksiteName if available
          if (flatWorksiteName) {
            locationName = flatWorksiteName;
          } else if (flatWorksiteId && flatCompanyId) {
            try {
              const locationRef = doc(db, 'tenants', tenantId, 'crm_companies', flatCompanyId, 'locations', flatWorksiteId);
              const locationSnap = await getDoc(locationRef);
              if (locationSnap.exists()) {
                const locationData = locationSnap.data() as any;
                locationName = locationData.nickname || locationData.name || 'Unknown Location';
                worksiteCity = worksiteCity || locationData.city || locationData.address?.city;
              }
            } catch (error) {
              // Silently handle errors
            }
          }
          
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
            worksiteCity,
            jobTitle: derivedJobTitle,
            recruiterName
          };
        })
      );

      setJobOrders(newJobOrders);
      firstLoadRef.current = false;
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

  // Reset and reload when filters/search/sort change
  useEffect(() => {
    if (tenantId) {
      // Reset pagination state
      setJobOrders([]);
      setPage(0); // Reset to first page when filters change
      firstLoadRef.current = true;
      // Load fresh data
      fetchJobOrders();
    }
  }, [tenantId, statusFilter, sortField, sortDirection, companyFilter, fetchJobOrders]);
  
  // Reset and reload when search or favorites filter changes (from props)
  useEffect(() => {
    if (!tenantId) return;
    
    const timeoutId = setTimeout(() => {
      // Reset pagination when search/favorites change
      setJobOrders([]);
      setPage(0); // Reset to first page when search/favorites change
      firstLoadRef.current = true;
      fetchJobOrders();
    }, 500); // 500ms debounce
    
    return () => clearTimeout(timeoutId);
  }, [effectiveSearch, effectiveShowFavoritesOnly, tenantId, fetchJobOrders]);

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

  // Reset page when filtered results change
  useEffect(() => {
    setPage(0);
  }, [effectiveSearch, effectiveShowFavoritesOnly, statusFilter, companyFilter]);

  const handleSort = (field: string) => {
    if (field === 'Requested/Filled') return; // Don't sort this column
    
    const newDirection = sortField === field && sortDirection === 'desc' ? 'asc' : 'desc';
    setSortField(field);
    setSortDirection(newDirection);
    setPage(0); // Reset to first page when sorting changes
  };

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>, jobOrder: JobOrderWithDetails) => {
    setAnchorEl(event.currentTarget);
    setSelectedJobOrder(jobOrder);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
    setSelectedJobOrder(null);
  };

  const handleViewJobOrder = () => {
    if (selectedJobOrder) {
      navigate(`/recruiter/job-orders/${selectedJobOrder.id}`);
    }
    handleMenuClose();
  };


  const handleCopyLink = async () => {
    if (selectedJobOrder) {
      const link = `${window.location.origin}/recruiter/job-orders/${selectedJobOrder.id}`;
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
            onChange={(e) => setStatusFilter(e.target.value)}
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
            onChange={(e) => setCompanyFilter(e.target.value)}
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
            onChange={(e) => setSortField(e.target.value)}
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
            <MenuItem value="createdAt">Newest First</MenuItem>
            <MenuItem value="jobOrderNumber">Order Number</MenuItem>
            <MenuItem value="status">Status</MenuItem>
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
                    #
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
                    Location
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
                    Requested/Filled
                  </TableCell>
                  <TableCell sx={{ 
                    fontWeight: 700, 
                    bgcolor: '#FFFFFF',
                    color: 'text.secondary', 
                    textTransform: 'uppercase', 
                    fontSize: '0.75rem',
                  }}>
                    Recruiter(s)
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
                    onClick={() => navigate(`/recruiter/job-orders/${jobOrder.id}`)}
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
                        <Typography variant="body2" sx={{ fontWeight: 500 }}>
                          {jobOrder.jobOrderName}
                        </Typography>
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

                          return (
                            <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.2 }}>
                              Order Setup: {progress.completed}/{progress.total}
                            </Typography>
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
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <LocationIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                        <Typography variant="body2">
                          {jobOrder.locationName || 'No Location'}
                        </Typography>
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={jobOrder.status}
                        color={getStatusColor(jobOrder.status) as any}
                        size="small"
                      />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">
                        {jobOrder.workersNeeded || 0} / {jobOrder.headcountFilled || 0}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {jobOrder.workersNeeded && jobOrder.headcountFilled
                          ? `${Math.round(((jobOrder.headcountFilled || 0) / (jobOrder.workersNeeded || 1)) * 100)}% filled`
                          : '0% filled'
                        }
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <PersonIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                        <Typography variant="body2">
                          {jobOrder.recruiterName || 'Unassigned'}
                        </Typography>
                      </Box>
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
            onPageChange={(_, newPage) => setPage(newPage)}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={(e) => {
              setRowsPerPage(parseInt(e.target.value, 10));
              setPage(0);
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
