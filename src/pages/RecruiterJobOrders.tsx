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
  Grid
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
  ArrowUpward as ArrowUpwardIcon,
  ArrowDownward as ArrowDownwardIcon
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { format, formatDistanceToNow } from 'date-fns';
import { collection, query, where, orderBy, limit, startAfter, getDocs, doc, getDoc } from 'firebase/firestore';

import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { p } from '../data/firestorePaths';
import { JobOrder } from '../types/Phase1Types';
import { BreadcrumbNav } from '../components/BreadcrumbNav';

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
  const firstLoadRef = useRef(true);

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


  const breadcrumbItems = [
    {
      label: 'Recruiter',
      href: '/recruiter'
    },
    {
      label: 'Job Orders'
    }
  ];

  return (
    <Box sx={{ p: 0 }}>
      <BreadcrumbNav items={breadcrumbItems} />
      {/* Header */}
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <WorkIcon />
          Job Orders
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Manage and track job orders for your clients
        </Typography>
      </Box>

      {/* Filters and Search */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} md={4}>
              <TextField
                fullWidth
                placeholder="Search job orders..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                InputProps={{
                  startAdornment: <SearchIcon sx={{ mr: 1, color: 'text.secondary' }} />
                }}
              />
            </Grid>
            <Grid item xs={12} md={3}>
              <FormControl fullWidth>
                <InputLabel>Status</InputLabel>
                <Select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  label="Status"
                >
                  <MenuItem value="">All Statuses</MenuItem>
                  <MenuItem value="Open">Open</MenuItem>
                  <MenuItem value="On-Hold">On-Hold</MenuItem>
                  <MenuItem value="Cancelled">Cancelled</MenuItem>
                  <MenuItem value="Filled">Filled</MenuItem>
                  <MenuItem value="Completed">Completed</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} md={2}>
              <Button
                variant="contained"
                onClick={handleSearch}
                startIcon={<SearchIcon />}
                fullWidth
              >
                Search
              </Button>
            </Grid>
            <Grid item xs={12} md={3}>
              <Button
                variant="outlined"
                startIcon={<AddIcon />}
                fullWidth
                onClick={() => navigate('/recruiter/job-orders/new')}
              >
                New Job Order
              </Button>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {/* Job Orders Table */}
      {loading && jobOrders.length === 0 ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
          <CircularProgress />
        </Box>
      ) : (
        <>
          <TableContainer component={Paper}>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell 
                    onClick={() => handleSort('jobOrderNumber')}
                    sx={{ cursor: 'pointer', userSelect: 'none' }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      Order #
                      {sortField === 'jobOrderNumber' && (
                        sortDirection === 'asc' ? <ArrowUpwardIcon fontSize="small" /> : <ArrowDownwardIcon fontSize="small" />
                      )}
                    </Box>
                  </TableCell>
                  <TableCell 
                    onClick={() => handleSort('jobOrderName')}
                    sx={{ cursor: 'pointer', userSelect: 'none' }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      Title
                      {sortField === 'jobOrderName' && (
                        sortDirection === 'asc' ? <ArrowUpwardIcon fontSize="small" /> : <ArrowDownwardIcon fontSize="small" />
                      )}
                    </Box>
                  </TableCell>
                  <TableCell 
                    onClick={() => handleSort('jobTitle')}
                    sx={{ cursor: 'pointer', userSelect: 'none' }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      Job Title
                      {sortField === 'jobTitle' && (
                        sortDirection === 'asc' ? <ArrowUpwardIcon fontSize="small" /> : <ArrowDownwardIcon fontSize="small" />
                      )}
                    </Box>
                  </TableCell>
                  <TableCell 
                    onClick={() => handleSort('companyName')}
                    sx={{ cursor: 'pointer', userSelect: 'none' }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      Account
                      {sortField === 'companyName' && (
                        sortDirection === 'asc' ? <ArrowUpwardIcon fontSize="small" /> : <ArrowDownwardIcon fontSize="small" />
                      )}
                    </Box>
                  </TableCell>
                  <TableCell 
                    onClick={() => handleSort('locationName')}
                    sx={{ cursor: 'pointer', userSelect: 'none' }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      Location
                      {sortField === 'locationName' && (
                        sortDirection === 'asc' ? <ArrowUpwardIcon fontSize="small" /> : <ArrowDownwardIcon fontSize="small" />
                      )}
                    </Box>
                  </TableCell>
                  <TableCell 
                    onClick={() => handleSort('status')}
                    sx={{ cursor: 'pointer', userSelect: 'none' }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      Status
                      {sortField === 'status' && (
                        sortDirection === 'asc' ? <ArrowUpwardIcon fontSize="small" /> : <ArrowDownwardIcon fontSize="small" />
                      )}
                    </Box>
                  </TableCell>
                  <TableCell>Requested/Filled</TableCell>
                  <TableCell 
                    onClick={() => handleSort('recruiterName')}
                    sx={{ cursor: 'pointer', userSelect: 'none' }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      Recruiter(s)
                      {sortField === 'recruiterName' && (
                        sortDirection === 'asc' ? <ArrowUpwardIcon fontSize="small" /> : <ArrowDownwardIcon fontSize="small" />
                      )}
                    </Box>
                  </TableCell>
                  <TableCell 
                    onClick={() => handleSort('createdAt')}
                    sx={{ cursor: 'pointer', userSelect: 'none' }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      Age
                      {sortField === 'createdAt' && (
                        sortDirection === 'asc' ? <ArrowUpwardIcon fontSize="small" /> : <ArrowDownwardIcon fontSize="small" />
                      )}
                    </Box>
                  </TableCell>
                  {/* <TableCell align="center">Actions</TableCell> */}
                </TableRow>
              </TableHead>
              <TableBody>
                {jobOrders.map((jobOrder) => (
                  <TableRow 
                    key={jobOrder.id} 
                    hover 
                    onClick={() => navigate(`/recruiter/job-orders/${jobOrder.id}`)}
                    sx={{ 
                      cursor: 'pointer',
                      '&:hover': {
                        backgroundColor: 'action.hover'
                      }
                    }}
                  >
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {formatJobOrderNumber(jobOrder.jobOrderNumber)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 500 }}>
                        {jobOrder.jobOrderName}
                      </Typography>
                      {/* {(jobOrder.deal?.notes || jobOrder.jobOrderDescription) && (
                        <Typography variant="caption" color="text.secondary" display="block">
                          {(jobOrder.deal?.notes || jobOrder.jobOrderDescription || '').substring(0, 100)}
                          {(jobOrder.deal?.notes || jobOrder.jobOrderDescription || '').length > 100 && '...'}
                        </Typography>
                      )} */}
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography variant="body2">
                          {jobOrder.jobTitle || 'No Job Title'}
                        </Typography>
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
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
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <LocationIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                        <Typography variant="body2">
                          {(jobOrder as any).worksiteName || 
                           jobOrder.deal?.locationName || 
                           jobOrder.deal?.associations?.locations?.[0]?.snapshot?.name || 
                           'No Location'}
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
                        {jobOrder.workersNeeded || 0} / {(jobOrder.workersNeeded || 0) - (jobOrder.headcountFilled || 0)}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {jobOrder.workersNeeded && jobOrder.headcountFilled
                          ? `${Math.round(((jobOrder.headcountFilled || 0) / (jobOrder.workersNeeded || 1)) * 100)}% filled`
                          : '0% filled'
                        }
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
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
                    {/* <TableCell align="center">
                      <IconButton
                        onClick={(e) => handleMenuOpen(e, jobOrder)}
                        size="small"
                      >
                        <MoreVertIcon />
                      </IconButton>
                    </TableCell> */}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>

          {/* Load More */}
          {!isEnd && (
            <Box sx={{ mt: 2, textAlign: 'center' }}>
              <Button onClick={handleLoadMore} disabled={loading}>
                {loading ? <CircularProgress size={20} /> : 'Load More'}
              </Button>
            </Box>
          )}

          {isEnd && jobOrders.length > 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 2, textAlign: 'center' }}>
              End of results
            </Typography>
          )}

          {jobOrders.length === 0 && !loading && (
            <Box sx={{ textAlign: 'center', py: 4 }}>
              <WorkIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
              <Typography variant="h6" color="text.secondary" gutterBottom>
                No job orders found
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
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
