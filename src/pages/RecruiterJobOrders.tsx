import React, { useState, useEffect, useRef } from 'react';
import { safeToDate } from '../utils/dateUtils';
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
  Edit as EditIcon,
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
import { Link, useNavigate } from 'react-router-dom';
import { format, formatDistanceToNow } from 'date-fns';
import { collection, query, where, orderBy, limit, startAfter, getDocs } from 'firebase/firestore';

import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { p } from '../data/firestorePaths';
import { useFlag } from '../hooks/useFlag';
import { JobOrder } from '../types/Phase1Types';

interface JobOrderWithDetails extends JobOrder {
  companyName?: string;
  locationName?: string;
  recruiterName?: string;
}

const PAGE_SIZE = 20;

const RecruiterJobOrders: React.FC = () => {
  const { user, tenantId } = useAuth();
  const navigate = useNavigate();
  const useNewDataModel = useFlag('NEW_DATA_MODEL');
  
  // State
  const [jobOrders, setJobOrders] = useState<JobOrderWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [lastDoc, setLastDoc] = useState<any>(null);
  const [isEnd, setIsEnd] = useState(false);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [selectedJobOrder, setSelectedJobOrder] = useState<JobOrderWithDetails | null>(null);
  const firstLoadRef = useRef(true);

  // Load job orders
  useEffect(() => {
    if (tenantId && useNewDataModel) {
      fetchJobOrders();
    }
  }, [tenantId, useNewDataModel, statusFilter]);

  const fetchJobOrders = async (searchQuery = '', startDoc: any = null) => {
    if (!tenantId) return;
    
    setLoading(true);
    try {
      const baseRef = collection(db, p.jobOrders(tenantId));
      const constraints: any[] = [
        where('tenantId', '==', tenantId),
        orderBy('dateOpened', 'desc'),
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

      const newJobOrders: JobOrderWithDetails[] = await Promise.all(
        snap.docs.map(async (doc) => {
          const data = doc.data() as JobOrder;
          
          // TODO: Fetch company and location names
          // For now, we'll use IDs
          return {
            ...data,
            id: doc.id,
            companyName: data.companyId, // TODO: Fetch actual company name
            locationName: data.locationId || 'No Location', // TODO: Fetch actual location name
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
      console.error('Error fetching job orders:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = () => {
    firstLoadRef.current = true;
    setLastDoc(null);
    setIsEnd(false);
    fetchJobOrders(search);
  };

  const handleLoadMore = () => {
    fetchJobOrders(search, lastDoc);
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

  const handleEditJobOrder = () => {
    if (selectedJobOrder) {
      navigate(`/recruiter/job-orders/${selectedJobOrder.id}/edit`);
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
    return `JO-${number.toString().padStart(4, '0')}`;
  };

  if (!useNewDataModel) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="info">
          New data model is disabled. Enable the NEW_DATA_MODEL feature flag to view job orders.
        </Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
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
                  <TableCell>JO #</TableCell>
                  <TableCell>Title</TableCell>
                  <TableCell>Account</TableCell>
                  <TableCell>Location</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Requested/Filled</TableCell>
                  <TableCell>Recruiter(s)</TableCell>
                  <TableCell>Opened</TableCell>
                  <TableCell align="center">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {jobOrders.map((jobOrder) => (
                  <TableRow key={jobOrder.id} hover>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {formatJobOrderNumber(jobOrder.jobOrderNumber)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <MuiLink
                        component={Link}
                        to={`/recruiter/job-orders/${jobOrder.id}`}
                        sx={{ textDecoration: 'none', fontWeight: 500 }}
                      >
                        {jobOrder.jobOrderName}
                      </MuiLink>
                      {jobOrder.description && (
                        <Typography variant="caption" color="text.secondary" display="block">
                          {jobOrder.description.substring(0, 100)}
                          {jobOrder.description.length > 100 && '...'}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <BusinessIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                        <Typography variant="body2">
                          {jobOrder.companyName || 'Unknown Company'}
                        </Typography>
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
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
                        {jobOrder.openings || 0} / {jobOrder.remainingOpenings || 0}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {jobOrder.openings && jobOrder.remainingOpenings
                          ? `${Math.round(((jobOrder.openings - jobOrder.remainingOpenings) / jobOrder.openings) * 100)}% filled`
                          : '0% filled'
                        }
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <PersonIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                        <Typography variant="body2">
                          {jobOrder.recruiterName || 'Unassigned'}
                        </Typography>
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <ScheduleIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                        <Box>
                          <Typography variant="body2">
                            {format(safeToDate(jobOrder.dateOpened), 'MMM dd, yyyy')}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {formatDistanceToNow(safeToDate(jobOrder.dateOpened), { addSuffix: true })}
                          </Typography>
                        </Box>
                      </Box>
                    </TableCell>
                    <TableCell align="center">
                      <IconButton
                        onClick={(e) => handleMenuOpen(e, jobOrder)}
                        size="small"
                      >
                        <MoreVertIcon />
                      </IconButton>
                    </TableCell>
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
        <MenuItem onClick={handleEditJobOrder}>
          <EditIcon sx={{ mr: 1 }} />
          Edit
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
