import React, { useState, useEffect } from 'react';
import { safeToDate } from '../../utils/dateUtils';
import {
  Box,
  Typography,
  TextField,
  Button,
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  Paper,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
  CircularProgress,
  Grid,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Tooltip,
  Avatar,
} from '@mui/material';
import {
  Add as AddIcon,
  Edit as EditIcon,
  Work as WorkIcon,
  Business as BusinessIcon,
  People as PeopleIcon,
  AttachMoney as MoneyIcon,
  Search as SearchIcon,
  FilterList as FilterIcon,
  PostAdd as PostAddIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { JobOrderService } from '../../services/recruiter/jobOrderService';
import { JobOrder, JobOrderStatus } from '../../types/recruiter/jobOrder';
import JobOrderForm from './JobOrderForm';
import PostToJobsBoardDialog from './PostToJobsBoardDialog';

interface JobOrdersManagementProps {
  onViewJobOrder?: (jobOrderId: string) => void;
}

const JobOrdersManagement: React.FC<JobOrdersManagementProps> = ({ onViewJobOrder }) => {
  const { tenantId, user } = useAuth();
  const navigate = useNavigate();
  
  // State
  const [jobOrders, setJobOrders] = useState<JobOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<JobOrderStatus | 'all'>('all');
  const [sortField, setSortField] = useState<keyof JobOrder>('createdAt');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  
  // Dialog states
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showPostDialog, setShowPostDialog] = useState(false);
  const [selectedJobOrder, setSelectedJobOrder] = useState<JobOrder | null>(null);
  
  
  const jobOrderService = JobOrderService.getInstance();

  // Load job orders
  useEffect(() => {
    if (tenantId) {
      loadJobOrders();
    }
  }, [tenantId]);

  const loadJobOrders = async () => {
    if (!tenantId) return;
    
    setLoading(true);
    try {
      const orders = await jobOrderService.getJobOrders(tenantId);
      setJobOrders(orders);
    } catch (err: any) {
      setError(err.message || 'Failed to load job orders');
    } finally {
      setLoading(false);
    }
  };

  // Filter and sort job orders
  const filteredAndSortedJobOrders = React.useMemo(() => {
    const filtered = jobOrders.filter(order => {
      const matchesSearch = !searchTerm || 
        order.jobOrderName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        order.jobTitle.toLowerCase().includes(searchTerm.toLowerCase()) ||
        order.companyName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        order.poNumber?.toLowerCase().includes(searchTerm.toLowerCase());
      
      const matchesStatus = statusFilter === 'all' || order.status === statusFilter;
      
      return matchesSearch && matchesStatus;
    });

    // Sort
    filtered.sort((a, b) => {
      const aValue = a[sortField];
      const bValue = b[sortField];
      
      if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    return filtered;
  }, [jobOrders, searchTerm, statusFilter, sortField, sortDirection]);

  // Handle sort
  const handleSort = (field: keyof JobOrder) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };


  const handleViewJobOrder = (jobOrderId: string) => {
    if (onViewJobOrder) {
      onViewJobOrder(jobOrderId);
    } else {
      navigate(`/recruiter/job-orders/${jobOrderId}`);
    }
  };


  // Handle job order creation/update
  const handleJobOrderSaved = async () => {
    setShowCreateDialog(false);
    setShowEditDialog(false);
    setSelectedJobOrder(null);
    await loadJobOrders();
  };

  // Get status color
  const getStatusColor = (status: JobOrderStatus) => {
    switch (status) {
      case 'draft': return 'default';
      case 'open': return 'primary';
      case 'on_hold': return 'warning';
      case 'cancelled': return 'error';
      case 'filled': return 'success';
      case 'completed': return 'info';
      default: return 'default';
    }
  };

  // Get status label
  const getStatusLabel = (status: JobOrderStatus) => {
    switch (status) {
      case 'draft': return 'Draft';
      case 'open': return 'Open';
      case 'on_hold': return 'On Hold';
      case 'cancelled': return 'Cancelled';
      case 'filled': return 'Filled';
      case 'completed': return 'Completed';
      default: return status;
    }
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h5" fontWeight="bold" gutterBottom>
            Job Orders
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Manage and track all job orders
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setShowCreateDialog(true)}
          sx={{ minWidth: 180 }}
        >
          Create New Job Order
        </Button>
      </Box>

      {/* Search and Filters */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                placeholder="Search job orders..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                InputProps={{
                  startAdornment: <SearchIcon sx={{ mr: 1, color: 'text.secondary' }} />,
                }}
              />
            </Grid>
            <Grid item xs={12} md={3}>
              <FormControl fullWidth>
                <InputLabel>Status</InputLabel>
                <Select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as JobOrderStatus | 'all')}
                  label="Status"
                >
                  <MenuItem value="all">All Statuses</MenuItem>
                  <MenuItem value="draft">Draft</MenuItem>
                  <MenuItem value="open">Open</MenuItem>
                  <MenuItem value="on_hold">On Hold</MenuItem>
                  <MenuItem value="cancelled">Cancelled</MenuItem>
                  <MenuItem value="filled">Filled</MenuItem>
                  <MenuItem value="completed">Completed</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} md={3}>
              <Button
                fullWidth
                variant="outlined"
                startIcon={<FilterIcon />}
                onClick={() => {
                  setSearchTerm('');
                  setStatusFilter('all');
                }}
              >
                Clear Filters
              </Button>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {/* Error Alert */}
      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError('')}>
          {error}
        </Alert>
      )}

      {/* Job Orders Table */}
      <Card>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>
                  <TableSortLabel
                    active={sortField === 'jobOrderNumber'}
                    direction={sortField === 'jobOrderNumber' ? sortDirection : 'asc'}
                    onClick={() => handleSort('jobOrderNumber')}
                  >
                    Job Order #
                  </TableSortLabel>
                </TableCell>
                <TableCell>
                  <TableSortLabel
                    active={sortField === 'jobOrderName'}
                    direction={sortField === 'jobOrderName' ? sortDirection : 'asc'}
                    onClick={() => handleSort('jobOrderName')}
                  >
                    Job Order Name
                  </TableSortLabel>
                </TableCell>
                <TableCell>
                  <TableSortLabel
                    active={sortField === 'companyName'}
                    direction={sortField === 'companyName' ? sortDirection : 'asc'}
                    onClick={() => handleSort('companyName')}
                  >
                    Company
                  </TableSortLabel>
                </TableCell>
                <TableCell>
                  <TableSortLabel
                    active={sortField === 'jobTitle'}
                    direction={sortField === 'jobTitle' ? sortDirection : 'asc'}
                    onClick={() => handleSort('jobTitle')}
                  >
                    Job Title
                  </TableSortLabel>
                </TableCell>
                <TableCell>
                  <TableSortLabel
                    active={sortField === 'status'}
                    direction={sortField === 'status' ? sortDirection : 'asc'}
                    onClick={() => handleSort('status')}
                  >
                    Status
                  </TableSortLabel>
                </TableCell>
                <TableCell>
                  <TableSortLabel
                    active={sortField === 'workersNeeded'}
                    direction={sortField === 'workersNeeded' ? sortDirection : 'asc'}
                    onClick={() => handleSort('workersNeeded')}
                  >
                    Workers Needed
                  </TableSortLabel>
                </TableCell>
                <TableCell>
                  <TableSortLabel
                    active={sortField === 'payRate'}
                    direction={sortField === 'payRate' ? sortDirection : 'asc'}
                    onClick={() => handleSort('payRate')}
                  >
                    Pay Rate
                  </TableSortLabel>
                </TableCell>
                <TableCell>
                  <TableSortLabel
                    active={sortField === 'createdAt'}
                    direction={sortField === 'createdAt' ? sortDirection : 'asc'}
                    onClick={() => handleSort('createdAt')}
                  >
                    Created
                  </TableSortLabel>
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredAndSortedJobOrders.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} align="center" sx={{ py: 4 }}>
                    <Box sx={{ textAlign: 'center' }}>
                      <WorkIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
                      <Typography variant="h6" color="text.secondary" gutterBottom>
                        No job orders found
                      </Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                        {searchTerm || statusFilter !== 'all' 
                          ? 'Try adjusting your search or filters'
                          : 'Create your first job order to get started'
                        }
                      </Typography>
                      {!searchTerm && statusFilter === 'all' && (
                        <Button
                          variant="contained"
                          startIcon={<AddIcon />}
                          onClick={() => setShowCreateDialog(true)}
                        >
                          Create Job Order
                        </Button>
                      )}
                    </Box>
                  </TableCell>
                </TableRow>
              ) : (
                filteredAndSortedJobOrders.map((jobOrder) => (
                  <TableRow 
                    key={jobOrder.id} 
                    hover 
                    sx={{ 
                      cursor: 'pointer',
                      '&:hover': {
                        backgroundColor: 'action.hover'
                      }
                    }}
                    onClick={() => handleViewJobOrder(jobOrder.id)}
                  >
                    <TableCell>
                      <Typography variant="body2" fontWeight="medium">
                        #{jobOrder.jobOrderNumber}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Box>
                        <Typography variant="body2" fontWeight="medium">
                          {jobOrder.jobOrderName}
                        </Typography>
                        {jobOrder.poNumber && (
                          <Typography variant="caption" color="text.secondary">
                            PO: {jobOrder.poNumber}
                          </Typography>
                        )}
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Avatar sx={{ width: 24, height: 24, fontSize: '0.75rem' }}>
                          <BusinessIcon fontSize="small" />
                        </Avatar>
                        <Typography variant="body2">
                          {jobOrder.companyName}
                        </Typography>
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">
                        {jobOrder.jobTitle}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={getStatusLabel(jobOrder.status)}
                        color={getStatusColor(jobOrder.status)}
                        size="small"
                      />
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <PeopleIcon fontSize="small" color="action" />
                        <Typography variant="body2">
                          {jobOrder.workersNeeded}
                        </Typography>
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <MoneyIcon fontSize="small" color="action" />
                        <Typography variant="body2">
                          ${jobOrder.payRate}/hr
                        </Typography>
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary">
                        {safeToDate(jobOrder.createdAt).toLocaleDateString()}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>


      {/* Create Job Order Dialog */}
      <Dialog
        open={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
        maxWidth="lg"
        fullWidth
      >
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <AddIcon />
            Create New Job Order
          </Box>
        </DialogTitle>
        <DialogContent sx={{ p: 0 }}>
          <JobOrderForm
            onSave={handleJobOrderSaved}
            onCancel={() => setShowCreateDialog(false)}
            tenantId={tenantId!}
            createdBy={user?.uid || ''}
          />
        </DialogContent>
      </Dialog>

      {/* Edit Job Order Dialog */}
      <Dialog
        open={showEditDialog}
        onClose={() => setShowEditDialog(false)}
        maxWidth="lg"
        fullWidth
      >
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <EditIcon />
            Edit Job Order
          </Box>
        </DialogTitle>
        <DialogContent sx={{ p: 0 }}>
          {selectedJobOrder && (
            <JobOrderForm
              jobOrder={selectedJobOrder}
              onSave={handleJobOrderSaved}
              onCancel={() => setShowEditDialog(false)}
              tenantId={tenantId!}
              createdBy={user?.uid || ''}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Post to Jobs Board Dialog */}
      <Dialog
        open={showPostDialog}
        onClose={() => setShowPostDialog(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <PostAddIcon />
            Post to Jobs Board
          </Box>
        </DialogTitle>
        <DialogContent>
          {selectedJobOrder && (
            <PostToJobsBoardDialog
              open={showPostDialog}
              onClose={() => setShowPostDialog(false)}
              jobOrder={selectedJobOrder}
              onPostCreated={() => {
                setShowPostDialog(false);
                setSelectedJobOrder(null);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </Box>
  );
};

export default JobOrdersManagement;
