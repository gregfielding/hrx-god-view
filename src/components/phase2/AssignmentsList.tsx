import React, { useState, useEffect } from 'react';
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
  Chip,
  IconButton,
  Menu,
  MenuItem,
  FormControl,
  InputLabel,
  Select,
  Card,
  CardContent,
  Avatar,
  Tooltip,
  Stack,
  Divider,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert
} from '@mui/material';
import {
  Add as AddIcon,
  MoreVert as MoreVertIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Visibility as ViewIcon,
  Person as PersonIcon,
  Work as WorkIcon,
  Schedule as ScheduleIcon,
  AttachMoney as MoneyIcon,
  LocationOn as LocationIcon,
  CheckCircle as CheckCircleIcon,
  Cancel as CancelIcon,
  PlayArrow as PlayArrowIcon,
  Stop as StopIcon
} from '@mui/icons-material';
import { format, formatDistanceToNow } from 'date-fns';
import { 
  Assignment, 
  AssignmentFilters, 
  AssignmentSortOptions, 
  AssignmentStatus 
} from '../../types/phase2';
import { getAssignmentService } from '../../services/phase2/assignmentService';
import { safeToDate } from '../../utils/dateUtils';

interface AssignmentsListProps {
  tenantId: string;
  jobOrderId: string;
  onViewAssignment?: (assignment: Assignment) => void;
  onEditAssignment?: (assignment: Assignment) => void;
  onDeleteAssignment?: (assignment: Assignment) => void;
  onCreateAssignment?: () => void;
  onConvertFromApplication?: () => void;
}

const AssignmentsList: React.FC<AssignmentsListProps> = ({
  tenantId,
  jobOrderId,
  onViewAssignment,
  onEditAssignment,
  onDeleteAssignment,
  onCreateAssignment,
  onConvertFromApplication
}) => {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<AssignmentStatus | 'all'>('all');
  const [sortField, setSortField] = useState<'startDate' | 'endDate' | 'createdAt' | 'status'>('startDate');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [selectedAssignment, setSelectedAssignment] = useState<Assignment | null>(null);
  const [statusChangeDialog, setStatusChangeDialog] = useState(false);
  const [newStatus, setNewStatus] = useState<AssignmentStatus>('proposed');

  const assignmentService = getAssignmentService();

  useEffect(() => {
    loadAssignments();
  }, [tenantId, jobOrderId, statusFilter, sortField, sortDirection]);

  const loadAssignments = async () => {
    try {
      setLoading(true);
      
      const filters: AssignmentFilters = {
        status: statusFilter !== 'all' ? statusFilter : undefined
      };

      const sortOptions: AssignmentSortOptions = {
        field: sortField,
        direction: sortDirection
      };

      const data = await assignmentService.getAssignmentsByJobOrder(tenantId, jobOrderId, filters, sortOptions);
      setAssignments(data);
    } catch (error) {
      console.error('Error loading assignments:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleStatusChange = async (assignment: Assignment, newStatus: AssignmentStatus) => {
    try {
      await assignmentService.updateAssignmentStatus(
        tenantId,
        jobOrderId,
        assignment.id,
        newStatus,
        'current-user' // TODO: Get actual user ID
      );
      
      // Reload assignments to reflect the change
      loadAssignments();
    } catch (error) {
      console.error('Error updating assignment status:', error);
    }
  };

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>, assignment: Assignment) => {
    setAnchorEl(event.currentTarget);
    setSelectedAssignment(assignment);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
    setSelectedAssignment(null);
  };

  const handleStatusChangeClick = () => {
    if (selectedAssignment) {
      setNewStatus(selectedAssignment.status);
      setStatusChangeDialog(true);
    }
    handleMenuClose();
  };

  const handleStatusChangeConfirm = async () => {
    if (selectedAssignment) {
      await handleStatusChange(selectedAssignment, newStatus);
      setStatusChangeDialog(false);
    }
  };

  const getStatusColor = (status: AssignmentStatus): 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning' => {
    switch (status) {
      case 'proposed': return 'info';
      case 'confirmed': return 'primary';
      case 'active': return 'success';
      case 'completed': return 'secondary';
      case 'ended': return 'default';
      case 'canceled': return 'error';
      default: return 'default';
    }
  };

  const getStatusIcon = (status: AssignmentStatus) => {
    switch (status) {
      case 'proposed': return <ScheduleIcon />;
      case 'confirmed': return <CheckCircleIcon />;
      case 'active': return <PlayArrowIcon />;
      case 'completed': return <CheckCircleIcon />;
      case 'ended': return <StopIcon />;
      case 'canceled': return <CancelIcon />;
      default: return <ScheduleIcon />;
    }
  };

  const formatCurrency = (amount: number): string => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  };

  const getStatusOptions = (currentStatus: AssignmentStatus): AssignmentStatus[] => {
    switch (currentStatus) {
      case 'proposed':
        return ['confirmed', 'canceled'];
      case 'confirmed':
        return ['active', 'canceled'];
      case 'active':
        return ['completed', 'ended', 'canceled'];
      case 'completed':
        return ['ended'];
      case 'ended':
        return ['active']; // Can reactivate if needed
      case 'canceled':
        return ['proposed']; // Can restart the process
      default:
        return [];
    }
  };

  return (
    <Box>
      {/* Header with Actions */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h6">
          Assignments ({assignments.length})
        </Typography>
        
        <Stack direction="row" spacing={1}>
          <Button
            variant="outlined"
            startIcon={<AddIcon />}
            onClick={onConvertFromApplication}
            size="small"
          >
            Convert from Application
          </Button>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={onCreateAssignment}
            size="small"
          >
            Create Assignment
          </Button>
        </Stack>
      </Box>

      {/* Filters */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Stack direction="row" spacing={2} alignItems="center">
            <FormControl size="small" sx={{ minWidth: 120 }}>
              <InputLabel>Status</InputLabel>
              <Select
                value={statusFilter}
                label="Status"
                onChange={(e) => setStatusFilter(e.target.value as AssignmentStatus | 'all')}
              >
                <MenuItem value="all">All Statuses</MenuItem>
                <MenuItem value="proposed">Proposed</MenuItem>
                <MenuItem value="confirmed">Confirmed</MenuItem>
                <MenuItem value="active">Active</MenuItem>
                <MenuItem value="completed">Completed</MenuItem>
                <MenuItem value="ended">Ended</MenuItem>
                <MenuItem value="canceled">Canceled</MenuItem>
              </Select>
            </FormControl>

            <FormControl size="small" sx={{ minWidth: 120 }}>
              <InputLabel>Sort By</InputLabel>
              <Select
                value={sortField}
                label="Sort By"
                onChange={(e) => setSortField(e.target.value as any)}
              >
                <MenuItem value="startDate">Start Date</MenuItem>
                <MenuItem value="endDate">End Date</MenuItem>
                <MenuItem value="createdAt">Created</MenuItem>
                <MenuItem value="status">Status</MenuItem>
              </Select>
            </FormControl>

            <Button
              variant="outlined"
              onClick={() => setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')}
              size="small"
            >
              {sortDirection === 'asc' ? '↑' : '↓'}
            </Button>
          </Stack>
        </CardContent>
      </Card>

      {/* Assignments Table */}
      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Candidate</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Start Date</TableCell>
              <TableCell>End Date</TableCell>
              <TableCell>Worksite</TableCell>
              <TableCell>Pay Rate</TableCell>
              <TableCell>Bill Rate</TableCell>
              <TableCell>Notes</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={9} align="center">
                  <Typography>Loading assignments...</Typography>
                </TableCell>
              </TableRow>
            ) : assignments.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} align="center">
                  <Typography color="text.secondary">No assignments found</Typography>
                </TableCell>
              </TableRow>
            ) : (
              assignments.map((assignment) => (
                <TableRow key={assignment.id} hover>
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <Avatar sx={{ bgcolor: 'primary.main' }}>
                        <PersonIcon />
                      </Avatar>
                      <Box>
                        <Typography variant="body2" fontWeight="medium">
                          Candidate {assignment.candidateId}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          ID: {assignment.candidateId}
                        </Typography>
                      </Box>
                    </Box>
                  </TableCell>
                  
                  <TableCell>
                    <Chip
                      label={assignment.status}
                      color={getStatusColor(assignment.status)}
                      size="small"
                      icon={getStatusIcon(assignment.status)}
                    />
                  </TableCell>
                  
                  <TableCell>
                    <Typography variant="body2">
                      {format(new Date(assignment.startDate), 'MMM dd, yyyy')}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {formatDistanceToNow(new Date(assignment.startDate), { addSuffix: true })}
                    </Typography>
                  </TableCell>
                  
                  <TableCell>
                    {assignment.endDate ? (
                      <>
                        <Typography variant="body2">
                          {format(new Date(assignment.endDate), 'MMM dd, yyyy')}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {formatDistanceToNow(new Date(assignment.endDate), { addSuffix: true })}
                        </Typography>
                      </>
                    ) : (
                      <Typography variant="body2" color="text.secondary">
                        Indefinite
                      </Typography>
                    )}
                  </TableCell>
                  
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <LocationIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                      <Typography variant="body2">
                        {assignment.worksite}
                      </Typography>
                    </Box>
                  </TableCell>
                  
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <MoneyIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                      <Typography variant="body2">
                        {formatCurrency(assignment.payRate)}
                      </Typography>
                    </Box>
                  </TableCell>
                  
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <MoneyIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                      <Typography variant="body2">
                        {formatCurrency(assignment.billRate)}
                      </Typography>
                    </Box>
                  </TableCell>
                  
                  <TableCell>
                    <Typography variant="body2" sx={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {assignment.notes || 'No notes'}
                    </Typography>
                  </TableCell>
                  
                  <TableCell align="right">
                    <IconButton
                      size="small"
                      onClick={(e) => handleMenuOpen(e, assignment)}
                    >
                      <MoreVertIcon />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Actions Menu */}
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={handleMenuClose}
      >
        <MenuItem onClick={() => {
          if (selectedAssignment && onViewAssignment) {
            onViewAssignment(selectedAssignment);
          }
          handleMenuClose();
        }}>
          <ViewIcon sx={{ mr: 1 }} />
          View Details
        </MenuItem>
        <MenuItem onClick={() => {
          if (selectedAssignment && onEditAssignment) {
            onEditAssignment(selectedAssignment);
          }
          handleMenuClose();
        }}>
          <EditIcon sx={{ mr: 1 }} />
          Edit
        </MenuItem>
        <MenuItem onClick={handleStatusChangeClick}>
          <ScheduleIcon sx={{ mr: 1 }} />
          Change Status
        </MenuItem>
        <Divider />
        <MenuItem onClick={() => {
          if (selectedAssignment && onDeleteAssignment) {
            onDeleteAssignment(selectedAssignment);
          }
          handleMenuClose();
        }} sx={{ color: 'error.main' }}>
          <DeleteIcon sx={{ mr: 1 }} />
          Delete
        </MenuItem>
      </Menu>

      {/* Status Change Dialog */}
      <Dialog open={statusChangeDialog} onClose={() => setStatusChangeDialog(false)}>
        <DialogTitle>Change Assignment Status</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Current status: <strong>{selectedAssignment?.status}</strong>
          </Typography>
          <FormControl fullWidth>
            <InputLabel>New Status</InputLabel>
            <Select
              value={newStatus}
              label="New Status"
              onChange={(e) => setNewStatus(e.target.value as AssignmentStatus)}
            >
              {selectedAssignment && getStatusOptions(selectedAssignment.status).map(status => (
                <MenuItem key={status} value={status}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    {getStatusIcon(status)}
                    {status}
                  </Box>
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setStatusChangeDialog(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleStatusChangeConfirm}>
            Update Status
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default AssignmentsList;
