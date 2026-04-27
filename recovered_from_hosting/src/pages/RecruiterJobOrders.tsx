import React, { useState, useEffect, useRef, useCallback } from 'react';
import { safeToDate, getJobOrderAge } from '../utils/dateUtils';
import {
  Box,
  Typography,
  TextField,
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
  InputAdornment
} from '@mui/material';
import {
  MoreVert as MoreVertIcon,
  Visibility as VisibilityIcon,
  ContentCopy as CopyIcon,
  FilterList as FilterIcon,
  Search as SearchIcon,
  Add as AddIcon,
  Work as WorkIcon,
  Business as BusinessIcon,
  LocationOn as LocationIcon,
  Person as PersonIcon,
  Schedule as ScheduleIcon,
  Clear as ClearIcon
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { format, formatDistanceToNow } from 'date-fns';
import { collection, query, where, orderBy, limit, startAfter, getDocs, doc, getDoc } from 'firebase/firestore';

import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { p } from '../data/firestorePaths';
import { JobOrder } from '../types/Phase1Types';
import FavoriteButton from '../components/FavoriteButton';
import FavoritesFilter from '../components/FavoritesFilter';
import { useFavorites } from '../hooks/useFavorites';

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

const RecruiterJobOrders: React.FC = () => {
  const { user, tenantId } = useAuth();
  const navigate = useNavigate();
  
  // State
  const [jobOrders, setJobOrders] = useState<JobOrderWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [lastDoc, setLastDoc] = useState<any>(null);
  const [isEnd, setIsEnd] = useState(false);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [selectedJobOrder, setSelectedJobOrder] = useState<JobOrderWithDetails | null>(null);
  const [sortField, setSortField] = useState<string>('createdAt');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [companyFilter, setCompanyFilter] = useState<string>('all');
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
    console.log('Favorites changed:', favorites);
    console.log('showFavoritesOnly:', showFavoritesOnly);
  }, [favorites, showFavoritesOnly]);

  const fetchJobOrders = useCallback(async (startDoc: any = null, isInitialLoad = false) => {
    if (!tenantId) return;
    
    console.log('🔍 RecruiterJobOrders: Fetching job orders for tenant:', tenantId);
    if (isInitialLoad) {
      setLoading(true);
    } else {
      setLoadingMore(true);
    }
    try {
      // Use the tenant-scoped job_orders collection
      const baseRef = collection(db, p.jobOrders(tenantId));
      
      // When search or filters are active, load more aggressively (up to 200 job orders)
      // This ensures search/filters query a larger dataset from Firestore
      const hasActiveFilters = search || 
        statusFilter || 
        companyFilter !== 'all';
      
      const effectivePageSize = hasActiveFilters ? 200 : PAGE_SIZE;
      
      const constraints: any[] = [
        orderBy(sortField, sortDirection),
        limit(effectivePageSize)
      ];

      // Add status filter if selected
      if (statusFilter) {
        constraints.push(where('status', '==', statusFilter));
      }

      if (startDoc) {
        constraints.push(startAfter(startDoc));
      }

      const jobOrderQuery = query(baseRef, ...constraints);
      const snap = await getDocs(jobOrderQuery);

      console.log('🔍 RecruiterJobOrders: Found', snap.docs.length, 'job orders');

      const newJobOrders: JobOrderWithDetails[] = await Promise.all(
        snap.docs.map(async (jobOrderDoc) => {
          const data = jobOrderDoc.data() as JobOrder;
          console.log('🔍 RecruiterJobOrders: Raw job order data:', data);
          
          // Derive job title from flat field or gig position
          const derivedJobTitle =
            (data as any).jobTitle ||
            (Array.isArray((data as any).gigPositions) && (data as any).gigPositions[0]?.jobTitle) ||
            undefined;

          // Fetch company name
          let companyName = 'Unknown Company';
          const flatCompanyId = (data as any).companyId || (data as any).deal?.companyId;
          console.log('🔍 RecruiterJobOrders: Job order companyId (flat or deal):', flatCompanyId);
          if (flatCompanyId) {
            try {
              const companyRef = doc(db, 'tenants', tenantId, 'crm_companies', flatCompanyId);
              console.log('🔍 RecruiterJobOrders: Fetching company from path:', companyRef.path);
              const companySnap = await getDoc(companyRef);
              console.log('🔍 RecruiterJobOrders: Company exists:', companySnap.exists());
              if (companySnap.exists()) {
                const companyData = companySnap.data() as any;
                console.log('🔍 RecruiterJobOrders: Company data:', companyData);
                companyName = companyData.companyName || companyData.name || 'Unknown Company';
                console.log('🔍 RecruiterJobOrders: Final company name:', companyName);
              } else {
                console.warn('🔍 RecruiterJobOrders: Company document does not exist for ID:', flatCompanyId);
              }
            } catch (error) {
              console.warn('Failed to fetch company name for ID:', flatCompanyId, error);
            }
          } else {
            console.log('🔍 RecruiterJobOrders: No companyId found in job order data');
          }
          
          // Fetch location nickname
          let locationName = 'No Location';
          const flatWorksiteId = (data as any).worksiteId || (data as any).deal?.locationId;
          const flatWorksiteName = (data as any).worksiteName || (data as any).deal?.locationName;
          let worksiteCity: string | undefined =
            (data as any).worksiteAddress?.city ||
            (data as any).city ||
            undefined;
          console.log('🔍 RecruiterJobOrders: Job order worksiteId (flat or deal):', flatWorksiteId);
          console.log('🔍 RecruiterJobOrders: Job order worksiteName (flat or deal):', flatWorksiteName);
          
          // First try to use worksiteName if available
          if (flatWorksiteName) {
            locationName = flatWorksiteName;
            console.log('🔍 RecruiterJobOrders: Using worksiteName:', locationName);
          } else if (flatWorksiteId && flatCompanyId) {
            try {
              const locationRef = doc(db, 'tenants', tenantId, 'crm_companies', flatCompanyId, 'locations', flatWorksiteId);
              console.log('🔍 RecruiterJobOrders: Fetching location from path:', locationRef.path);
              const locationSnap = await getDoc(locationRef);
              console.log('🔍 RecruiterJobOrders: Location exists:', locationSnap.exists());
              if (locationSnap.exists()) {
                const locationData = locationSnap.data() as any;
                console.log('🔍 RecruiterJobOrders: Location data:', locationData);
                locationName = locationData.nickname || locationData.name || 'Unknown Location';
                worksiteCity = worksiteCity || locationData.city || locationData.address?.city;
                console.log('🔍 RecruiterJobOrders: Final location name:', locationName);
              } else {
                console.warn('🔍 RecruiterJobOrders: Location document does not exist for ID:', flatWorksiteId);
              }
            } catch (error) {
              console.warn('Failed to fetch location name for ID:', flatWorksiteId, error);
            }
          } else {
            console.log('🔍 RecruiterJobOrders: No worksiteId or worksiteName found in job order data');
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
              console.warn('Failed to fetch recruiter name:', error);
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

      if (firstLoadRef.current) {
        setJobOrders(newJobOrders);
        firstLoadRef.current = false;
      } else {
        setJobOrders(prev => {
          const existingIds = new Set(prev.map(jo => jo.id));
          const deduped = newJobOrders.filter(jo => !existingIds.has(jo.id));
          return [...prev, ...deduped];
        });
      }

      if (newJobOrders.length < effectivePageSize) {
        setIsEnd(true);
      } else {
        setLastDoc(snap.docs[snap.docs.length - 1]);
      }
    } catch (error) {
      console.error('❌ RecruiterJobOrders: Error fetching job orders:', error);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [tenantId, statusFilter, sortField, sortDirection]);

  // Reset and reload when filters/search/sort change
  useEffect(() => {
    if (tenantId) {
      // Reset pagination state
      setJobOrders([]);
      setLastDoc(null);
      setIsEnd(false);
      firstLoadRef.current = true;
      // Load fresh data
      fetchJobOrders(null, true);
    }
  }, [tenantId, statusFilter, sortField, sortDirection, companyFilter]);
  
  // Debounce search to avoid too many queries
  useEffect(() => {
    if (!tenantId) return;
    
    const timeoutId = setTimeout(() => {
      // Reset pagination when search changes
      setJobOrders([]);
      setLastDoc(null);
      setIsEnd(false);
      firstLoadRef.current = true;
      fetchJobOrders(null, true);
    }, 500); // 500ms debounce
    
    return () => clearTimeout(timeoutId);
  }, [search, tenantId]);

  const handleLoadMore = () => {
    if (!loadingMore && !isEnd) {
      fetchJobOrders(lastDoc, false);
    }
  };

  // Client-side filtering for real-time search and other filters
  const filteredJobOrders = jobOrders.filter(jo => {
    // Search filter
    if (search) {
      const searchLower = search.toLowerCase();
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
    if (showFavoritesOnly && !isFavorite(jo.id)) {
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

  const handleSort = (field: string) => {
    if (field === 'Requested/Filled') return; // Don't sort this column
    
    const newDirection = sortField === field && sortDirection === 'desc' ? 'asc' : 'desc';
    setSortField(field);
    setSortDirection(newDirection);
    firstLoadRef.current = true;
    setLastDoc(null);
    setIsEnd(false);
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
    <Box sx={{ p: 0 }}>
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
          <TextField
            size="small"
            variant="outlined"
            placeholder="Search job orders..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            sx={{ 
              width: 280,
              height: 36,
              '& .MuiOutlinedInput-root': {
                height: 36,
                borderRadius: '6px',
                backgroundColor: 'white',
                fontSize: '0.875rem',
                '& fieldset': {
                  borderColor: '#E5E7EB',
                },
                '&:hover fieldset': {
                  borderColor: '#D1D5DB',
                },
              }
            }}
            InputProps={{
              startAdornment: <SearchIcon sx={{ mr: 1, color: '#9CA3AF', fontSize: '18px' }} />,
              endAdornment: (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <FavoritesFilter
                    favoriteType="jobOrders"
                    showFavoritesOnly={showFavoritesOnly}
                    onToggle={setShowFavoritesOnly}
                    showText={false}
                    size="small"
                    sx={{
                      minWidth: '32px',
                      width: '32px',
                      height: '32px',
                      borderRadius: '50%',
                      '&:hover': {
                        backgroundColor: showFavoritesOnly ? 'primary.dark' : 'action.hover'
                      }
                    }}
                  />
                  {search && (
                    <IconButton
                      size="small"
                      onClick={() => setSearch('')}
                      sx={{ mr: 0.5, p: 0.5 }}
                    >
                      <ClearIcon fontSize="small" />
                    </IconButton>
                  )}
                </Box>
              ),
            }}
          />
        
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
        
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => navigate('/recruiter/job-orders/new')}
            sx={{
              height: 36,
              px: 2,
              fontSize: '0.875rem',
              fontWeight: 500,
              borderRadius: '6px',
              textTransform: 'none',
            }}
          >
            New Order
          </Button>
        </Box>
      </Box>

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
            {search || statusFilter
              ? 'Try adjusting your search criteria'
              : 'Create your first job order to get started'
            }
          </Typography>
          {!search && !statusFilter && (
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => navigate('/recruiter/job-orders/new')}
            >
              Create Job Order
            </Button>
          )}
        </Box>
      ) : (
        <>
          <TableContainer component={Paper}>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.75rem', width: 60 }}>
                    Favorites
                  </TableCell>
                  <TableCell sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.75rem' }}>
                    Order #
                  </TableCell>
                  <TableCell sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.75rem' }}>
                    Title
                  </TableCell>
                  <TableCell sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.75rem' }}>
                    Job Title
                  </TableCell>
                  <TableCell sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.75rem' }}>
                    Account
                  </TableCell>
                  <TableCell sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.75rem' }}>
                    Location
                  </TableCell>
                  <TableCell sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.75rem' }}>
                    Status
                  </TableCell>
                  <TableCell sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.75rem' }}>
                    Requested/Filled
                  </TableCell>
                  <TableCell sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.75rem' }}>
                    Recruiter(s)
                  </TableCell>
                  <TableCell sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.75rem' }}>
                    Age
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filteredJobOrders.map((jobOrder, index) => (
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
                      <Typography variant="body2" sx={{ fontWeight: 500 }}>
                        {jobOrder.jobOrderName}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">
                        {jobOrder.jobTitle || 'No Job Title'}
                      </Typography>
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

          {/* Load More */}
          {!isEnd && (
            <Box sx={{ mt: 3, textAlign: 'center' }}>
              <Button 
                onClick={handleLoadMore} 
                disabled={loadingMore || loading}
                variant="outlined"
                size="large"
                startIcon={loadingMore && <CircularProgress size={16} />}
              >
                {loadingMore ? 'Loading More...' : 'Load More Job Orders'}
              </Button>
            </Box>
          )}

          {isEnd && jobOrders.length > 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 3, textAlign: 'center' }}>
              End of results
            </Typography>
          )}
        </>
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
