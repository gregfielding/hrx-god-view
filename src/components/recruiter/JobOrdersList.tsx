import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  CardHeader,
  Button,
  Chip,
  Grid,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  IconButton,
  Tooltip,
  Alert,
  CircularProgress,
  TextField,
  InputAdornment,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions
} from '@mui/material';
import {
  Add as AddIcon,
  Edit as EditIcon,
  Visibility as VisibilityIcon,
  Work as WorkIcon,
  Business as BusinessIcon,
  LocationOn as LocationIcon,
  People as PeopleIcon,
  Search as SearchIcon,
  FilterList as FilterIcon,
  Assignment as AssignmentIcon,
  TrendingUp as TrendingUpIcon,
  Schedule as ScheduleIcon
} from '@mui/icons-material';
import { JobOrderService } from '../../services/recruiter/jobOrderService';
import { JobOrder } from '../../types/recruiter/jobOrder';
import { useAuth } from '../../contexts/AuthContext';

interface JobOrdersListProps {
  onJobOrderSelect?: (jobOrder: JobOrder) => void;
  onJobOrderEdit?: (jobOrder: JobOrder) => void;
  onCreateNew?: () => void;
}

const JobOrdersList: React.FC<JobOrdersListProps> = ({
  onJobOrderSelect,
  onJobOrderEdit,
  onCreateNew
}) => {
  const { tenantId } = useAuth();
  const [jobOrders, setJobOrders] = useState<JobOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedJobOrder, setSelectedJobOrder] = useState<JobOrder | null>(null);
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);

  const jobOrderService = JobOrderService.getInstance();

  useEffect(() => {
    loadJobOrders();
  }, [tenantId]);

  const loadJobOrders = async () => {
    if (!tenantId) return;
    
    try {
      setLoading(true);
      const orders = await jobOrderService.getJobOrders(tenantId);
      setJobOrders(orders);
    } catch (err: any) {
      console.error('Error loading job orders:', err);
      setError(err.message || 'Failed to load job orders');
    } finally {
      setLoading(false);
    }
  };

  const handleJobOrderClick = (jobOrder: JobOrder) => {
    setSelectedJobOrder(jobOrder);
    setDetailsDialogOpen(true);
    if (onJobOrderSelect) {
      onJobOrderSelect(jobOrder);
    }
  };

  const handleEditJobOrder = (jobOrder: JobOrder) => {
    if (onJobOrderEdit) {
      onJobOrderEdit(jobOrder);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'open': return 'success';
      case 'draft': return 'default';
      case 'on_hold': return 'warning';
      case 'cancelled': return 'error';
      case 'filled': return 'info';
      case 'completed': return 'success';
      default: return 'default';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'open': return <TrendingUpIcon />;
      case 'draft': return <EditIcon />;
      case 'on_hold': return <ScheduleIcon />;
      case 'cancelled': return <AssignmentIcon />;
      case 'filled': return <PeopleIcon />;
      case 'completed': return <AssignmentIcon />;
      default: return <AssignmentIcon />;
    }
  };

  const filteredJobOrders = jobOrders.filter(jobOrder => {
    const matchesSearch = 
      jobOrder.jobOrderName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      jobOrder.companyName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      jobOrder.jobTitle.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesStatus = statusFilter === 'all' || jobOrder.status === statusFilter;
    
    return matchesSearch && matchesStatus;
  });

  const getJobOrderAge = (dateOpened: Date) => {
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - dateOpened.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  const getAgeColor = (days: number) => {
    if (days <= 7) return 'success';
    if (days <= 14) return 'warning';
    return 'error';
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Alert severity="error" sx={{ mb: 2 }}>
        {error}
      </Alert>
    );
  }

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4" component="h1">
          Job Orders
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={onCreateNew}
          sx={{ bgcolor: 'primary.main' }}
        >
          Create Job Order
        </Button>
      </Box>

      {/* Filters */}
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
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon />
                    </InputAdornment>
                  ),
                }}
              />
            </Grid>
            <Grid item xs={12} md={3}>
              <FormControl fullWidth>
                <InputLabel>Status</InputLabel>
                <Select
                  value={statusFilter}
                  label="Status"
                  onChange={(e) => setStatusFilter(e.target.value)}
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
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Chip 
                  label={`${filteredJobOrders.length} Job Orders`} 
                  color="primary" 
                  variant="outlined" 
                />
                <Chip 
                  label={`${jobOrders.filter(jo => jo.status === 'open').length} Open`} 
                  color="success" 
                  variant="outlined" 
                />
              </Box>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {/* Job Orders Table */}
      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Job Order</TableCell>
              <TableCell>Company</TableCell>
              <TableCell>Position</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Age</TableCell>
              <TableCell>Workers</TableCell>
              <TableCell>Pay Rate</TableCell>
              <TableCell>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filteredJobOrders.map((jobOrder) => {
              const age = getJobOrderAge(jobOrder.dateOpened);
              return (
                <TableRow 
                  key={jobOrder.id} 
                  hover
                  sx={{ cursor: 'pointer' }}
                  onClick={() => handleJobOrderClick(jobOrder)}
                >
                  <TableCell>
                    <Box>
                      <Typography variant="subtitle2" fontWeight="bold">
                        #{jobOrder.jobOrderNumber} - {jobOrder.jobOrderName}
                      </Typography>
                      {jobOrder.dealId && (
                        <Typography variant="caption" color="text.secondary">
                          From Deal: {jobOrder.dealId}
                        </Typography>
                      )}
                    </Box>
                  </TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <BusinessIcon fontSize="small" color="action" />
                      <Typography variant="body2">
                        {jobOrder.companyName}
                      </Typography>
                    </Box>
                  </TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <WorkIcon fontSize="small" color="action" />
                      <Typography variant="body2">
                        {jobOrder.jobTitle}
                      </Typography>
                    </Box>
                  </TableCell>
                  <TableCell>
                    <Chip
                      icon={getStatusIcon(jobOrder.status)}
                      label={jobOrder.status.replace('_', ' ').toUpperCase()}
                      color={getStatusColor(jobOrder.status) as any}
                      size="small"
                    />
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={`${age} days`}
                      color={getAgeColor(age) as any}
                      size="small"
                      variant="outlined"
                    />
                  </TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <PeopleIcon fontSize="small" color="action" />
                      <Typography variant="body2">
                        {jobOrder.workersNeeded}
                      </Typography>
                    </Box>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" fontWeight="medium">
                      ${jobOrder.payRate}/hr
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', gap: 0.5 }}>
                      <Tooltip title="View Details">
                        <IconButton 
                          size="small"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleJobOrderClick(jobOrder);
                          }}
                        >
                          <VisibilityIcon />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Edit">
                        <IconButton 
                          size="small"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleEditJobOrder(jobOrder);
                          }}
                        >
                          <EditIcon />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>

      {filteredJobOrders.length === 0 && (
        <Box sx={{ textAlign: 'center', py: 4 }}>
          <Typography variant="h6" color="text.secondary" gutterBottom>
            No job orders found
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {searchTerm || statusFilter !== 'all' 
              ? 'Try adjusting your search or filter criteria'
              : 'Create your first job order to get started'
            }
          </Typography>
        </Box>
      )}

      {/* Job Order Details Dialog */}
      <Dialog
        open={detailsDialogOpen}
        onClose={() => setDetailsDialogOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          Job Order Details
        </DialogTitle>
        <DialogContent>
          {selectedJobOrder && (
            <Box>
              <Typography variant="h6" gutterBottom>
                #{selectedJobOrder.jobOrderNumber} - {selectedJobOrder.jobOrderName}
              </Typography>
              <Grid container spacing={2}>
                <Grid item xs={12} md={6}>
                  <Typography variant="subtitle2" color="text.secondary">
                    Company
                  </Typography>
                  <Typography variant="body1">
                    {selectedJobOrder.companyName}
                  </Typography>
                </Grid>
                <Grid item xs={12} md={6}>
                  <Typography variant="subtitle2" color="text.secondary">
                    Position
                  </Typography>
                  <Typography variant="body1">
                    {selectedJobOrder.jobTitle}
                  </Typography>
                </Grid>
                <Grid item xs={12} md={6}>
                  <Typography variant="subtitle2" color="text.secondary">
                    Status
                  </Typography>
                  <Chip
                    icon={getStatusIcon(selectedJobOrder.status)}
                    label={selectedJobOrder.status.replace('_', ' ').toUpperCase()}
                    color={getStatusColor(selectedJobOrder.status) as any}
                    size="small"
                  />
                </Grid>
                <Grid item xs={12} md={6}>
                  <Typography variant="subtitle2" color="text.secondary">
                    Workers Needed
                  </Typography>
                  <Typography variant="body1">
                    {selectedJobOrder.workersNeeded}
                  </Typography>
                </Grid>
                <Grid item xs={12} md={6}>
                  <Typography variant="subtitle2" color="text.secondary">
                    Pay Rate
                  </Typography>
                  <Typography variant="body1">
                    ${selectedJobOrder.payRate}/hour
                  </Typography>
                </Grid>
                <Grid item xs={12} md={6}>
                  <Typography variant="subtitle2" color="text.secondary">
                    Bill Rate
                  </Typography>
                  <Typography variant="body1">
                    ${selectedJobOrder.billRate}/hour
                  </Typography>
                </Grid>
                {selectedJobOrder.jobOrderDescription && (
                  <Grid item xs={12}>
                    <Typography variant="subtitle2" color="text.secondary">
                      Description
                    </Typography>
                    <Typography variant="body1">
                      {selectedJobOrder.jobOrderDescription}
                    </Typography>
                  </Grid>
                )}
              </Grid>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDetailsDialogOpen(false)}>
            Close
          </Button>
          {selectedJobOrder && (
            <Button 
              variant="contained"
              onClick={() => {
                setDetailsDialogOpen(false);
                handleEditJobOrder(selectedJobOrder);
              }}
            >
              Edit Job Order
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default JobOrdersList;
