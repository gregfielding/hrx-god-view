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
  Schedule as ScheduleIcon
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
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [lastDoc, setLastDoc] = useState<any>(null);
  const [isEnd, setIsEnd] = useState(false);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [selectedJobOrder, setSelectedJobOrder] = useState<JobOrderWithDetails | null>(null);
  const [sortField, setSortField] = useState<string>('createdAt');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const firstLoadRef = useRef(true);

  const { favorites, toggleFavorite, isFavorite } = useFavorites('jobOrders');

  const fetchJobOrders = useCallback(async (searchQuery = '', startDoc: any = null) => {
    if (!tenantId) return;
    
    console.log('🔍 RecruiterJobOrders: Fetching job orders for tenant:', tenantId);
    setLoading(true);
    try {
      // Use the tenant-scoped job_orders collection
      const baseRef = collection(db, p.jobOrders(tenantId));
      const constraints: any[] = [
        orderBy(sortField, sortDirection),
        limit(PAGE_SIZE)
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
          
          // TODO: Fetch recruiter names
          return {
            ...data,
            id: jobOrderDoc.id,
            companyName,
            locationName,
            recruiterName: data.recruiterId // TODO: Fetch actual recruiter name
          };
        })
      );

      // Filter by search if provided
      const filteredJobOrders = searchQuery
        ? newJobOrders.filter(jo => 
            jo.jobOrderName.toLowerCase().includes(searchQuery.toLowerCase()) ||
            jo.companyName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
            jo.description?.toLowerCase().includes(searchQuery.toLowerCase())
          )
        : newJobOrders;

      if (firstLoadRef.current) {
        setJobOrders(filteredJobOrders);
        firstLoadRef.current = false;
      } else {
        setJobOrders(prev => {
          const existingIds = new Set(prev.map(jo => jo.id));
          const deduped = filteredJobOrders.filter(jo => !existingIds.has(jo.id));
          return [...prev, ...deduped];
        });
      }

      if (newJobOrders.length < PAGE_SIZE) {
        setIsEnd(true);
      } else {
        setLastDoc(snap.docs[snap.docs.length - 1]);
      }
    } catch (error) {
      console.error('❌ RecruiterJobOrders: Error fetching job orders:', error);
    } finally {
      setLoading(false);
    }
  }, [tenantId, statusFilter, sortField, sortDirection]);

  // Load job orders
  useEffect(() => {
    if (tenantId) {
      fetchJobOrders();
    }
  }, [tenantId, fetchJobOrders]);

  const handleSearch = () => {
    firstLoadRef.current = true;
    setLastDoc(null);
    setIsEnd(false);
    fetchJobOrders(search);
  };

  const handleLoadMore = () => {
    fetchJobOrders(search, lastDoc);
  };

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
    switch (status) {
      case 'Open': return 'success';
      case 'On-Hold': return 'warning';
      case 'Cancelled': return 'error';
      case 'Filled': return 'info';
      case 'Completed': return 'default';
      default: return 'default';
    }
  };

  const formatJobOrderNumber = (number: number) => {
    return number.toString().padStart(4, '0');
  };


  return (
    <Box sx={{ p: 0 }}>
      {/* Filters and Search */}
      <Box sx={{ mb: 3, display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
        <TextField
          placeholder="Search job orders..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
          variant="outlined"
          size="small"
          sx={{ 
            flexGrow: 1, 
            minWidth: 300,
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
              <InputAdornment position="end">
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
              </InputAdornment>
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
          New Post
        </Button>
      </Box>

      {/* Job Orders Table */}
      {loading && jobOrders.length === 0 ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
          <CircularProgress />
        </Box>
      ) : jobOrders.length === 0 ? (
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
                {jobOrders
                  .filter(jobOrder => {
                    if (showFavoritesOnly && !isFavorite(jobOrder.id)) return false;
                    return true;
                  })
                  .map((jobOrder, index) => (
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
                          {jobOrder.deal?.associations?.recruiter?.[0]?.snapshot?.displayName || 
                           jobOrder.deal?.associations?.recruiter?.[0]?.snapshot?.name || 
                           'Unassigned'}
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
              <Button onClick={handleLoadMore} disabled={loading} variant="outlined">
                {loading ? <CircularProgress size={20} /> : 'Load More'}
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
