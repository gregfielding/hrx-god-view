import React, { useState, useEffect } from 'react';
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
  Badge,
  Stack,
  Divider
} from '@mui/material';
import {
  Search as SearchIcon,
  FilterList as FilterIcon,
  MoreVert as MoreVertIcon,
  Person as PersonIcon,
  Email as EmailIcon,
  Phone as PhoneIcon,
  Star as StarIcon,
  StarBorder as StarBorderIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Visibility as ViewIcon,
  TrendingUp as TrendingUpIcon
} from '@mui/icons-material';
import { format, formatDistanceToNow } from 'date-fns';
import { Application, ApplicationFilters, ApplicationSortOptions, ApplicationStage } from '../../types/phase2';
import { getApplicationService } from '../../services/phase2/applicationService';
import { safeToDate } from '../../utils/dateUtils';

interface ApplicationsListProps {
  tenantId: string;
  jobOrderId?: string; // If provided, only show applications for this job order
  onViewApplication?: (application: Application) => void;
  onEditApplication?: (application: Application) => void;
  onDeleteApplication?: (application: Application) => void;
}

const ApplicationsList: React.FC<ApplicationsListProps> = ({
  tenantId,
  jobOrderId,
  onViewApplication,
  onEditApplication,
  onDeleteApplication
}) => {
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<ApplicationStage | 'all'>('all');
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [sortField, setSortField] = useState<'createdAt' | 'stageChangedAt' | 'candidate.lastName' | 'rating'>('createdAt');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [selectedApplication, setSelectedApplication] = useState<Application | null>(null);

  const applicationService = getApplicationService();

  useEffect(() => {
    loadApplications();
  }, [tenantId, jobOrderId, statusFilter, sourceFilter, sortField, sortDirection]);

  const loadApplications = async () => {
    try {
      setLoading(true);
      
      const filters: ApplicationFilters = {
        search: searchTerm || undefined,
        status: statusFilter !== 'all' ? statusFilter : undefined,
        source: sourceFilter !== 'all' ? sourceFilter as any : undefined,
        jobOrderId: jobOrderId || undefined
      };

      const sortOptions: ApplicationSortOptions = {
        field: sortField,
        direction: sortDirection
      };

      const data = await applicationService.getApplications(tenantId, filters, sortOptions);
      setApplications(data);
    } catch (error) {
      console.error('Error loading applications:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = () => {
    loadApplications();
  };

  const handleStageChange = async (application: Application, newStage: ApplicationStage) => {
    try {
      await applicationService.updateApplicationStage(
        tenantId,
        application.id,
        newStage,
        'current-user', // TODO: Get actual user ID
        application.jobOrderId || undefined
      );
      
      // Reload applications to reflect the change
      loadApplications();
    } catch (error) {
      console.error('Error updating application stage:', error);
    }
  };

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>, application: Application) => {
    setAnchorEl(event.currentTarget);
    setSelectedApplication(application);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
    setSelectedApplication(null);
  };

  const getStatusColor = (status: ApplicationStage): 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning' => {
    switch (status) {
      case 'applied': return 'info';
      case 'screening': return 'primary';
      case 'interview': return 'warning';
      case 'offer': return 'secondary';
      case 'hired': return 'success';
      case 'rejected': return 'error';
      case 'withdrawn': return 'default';
      default: return 'default';
    }
  };

  const getSourceIcon = (source?: string) => {
    switch (source) {
      case 'job_board': return '📋';
      case 'manual': return '✋';
      case 'referral': return '🤝';
      case 'import': return '📥';
      case 'career_page': return '🌐';
      default: return '❓';
    }
  };

  const renderRating = (rating?: number) => {
    if (!rating) return null;
    
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        {[1, 2, 3, 4, 5].map((star) => (
          <StarIcon
            key={star}
            sx={{
              fontSize: 16,
              color: star <= rating ? 'gold' : 'grey.300'
            }}
          />
        ))}
      </Box>
    );
  };

  const filteredApplications = applications.filter(app => {
    if (searchTerm) {
      const searchLower = searchTerm.toLowerCase();
      return (
        app.candidate.firstName.toLowerCase().includes(searchLower) ||
        app.candidate.lastName.toLowerCase().includes(searchLower) ||
        app.candidate.email?.toLowerCase().includes(searchLower) ||
        app.notes?.toLowerCase().includes(searchLower)
      );
    }
    return true;
  });

  return (
    <Box>
      {/* Header */}
      {/* <Box sx={{ mb: 3 }}>
        <Typography variant="h5" gutterBottom>
          Applications
          {jobOrderId && (
            <Typography variant="body2" color="text.secondary" component="span" sx={{ ml: 1 }}>
              (Job Order Specific)
            </Typography>
          )}
        </Typography>
      </Box> */}

      {/* Filters */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap">
            <TextField
              size="small"
              placeholder="Search applications..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
              InputProps={{
                startAdornment: <SearchIcon sx={{ mr: 1, color: 'text.secondary' }} />
              }}
              sx={{ minWidth: 250 }}
            />
            
            <FormControl size="small" sx={{ minWidth: 120 }}>
              <InputLabel>Status</InputLabel>
              <Select
                value={statusFilter}
                label="Status"
                onChange={(e) => setStatusFilter(e.target.value as ApplicationStage | 'all')}
              >
                <MenuItem value="all">All Statuses</MenuItem>
                <MenuItem value="applied">Applied</MenuItem>
                <MenuItem value="screening">Screening</MenuItem>
                <MenuItem value="interview">Interview</MenuItem>
                <MenuItem value="offer">Offer</MenuItem>
                <MenuItem value="hired">Hired</MenuItem>
                <MenuItem value="rejected">Rejected</MenuItem>
                <MenuItem value="withdrawn">Withdrawn</MenuItem>
              </Select>
            </FormControl>

            <FormControl size="small" sx={{ minWidth: 120 }}>
              <InputLabel>Source</InputLabel>
              <Select
                value={sourceFilter}
                label="Source"
                onChange={(e) => setSourceFilter(e.target.value)}
              >
                <MenuItem value="all">All Sources</MenuItem>
                <MenuItem value="job_board">Job Board</MenuItem>
                <MenuItem value="manual">Manual</MenuItem>
                <MenuItem value="referral">Referral</MenuItem>
                <MenuItem value="import">Import</MenuItem>
                <MenuItem value="career_page">Career Page</MenuItem>
              </Select>
            </FormControl>

            <Button
              variant="outlined"
              startIcon={<FilterIcon />}
              onClick={handleSearch}
            >
              Apply Filters
            </Button>
          </Stack>
        </CardContent>
      </Card>

      {/* Applications Table */}
      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Candidate</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Source</TableCell>
              <TableCell>Rating</TableCell>
              <TableCell>Applied</TableCell>
              <TableCell>Last Updated</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={7} align="center">
                  <Typography>Loading applications...</Typography>
                </TableCell>
              </TableRow>
            ) : filteredApplications.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} align="center">
                  <Typography color="text.secondary">No applications found</Typography>
                </TableCell>
              </TableRow>
            ) : (
              filteredApplications.map((application) => (
                <TableRow key={application.id} hover>
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <Avatar sx={{ bgcolor: 'primary.main' }}>
                        {application.candidate.firstName[0]}{application.candidate.lastName[0]}
                      </Avatar>
                      <Box>
                        <Typography variant="body2" fontWeight="medium">
                          {application.candidate.firstName} {application.candidate.lastName}
                        </Typography>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
                          {application.candidate.email && (
                            <Tooltip title={application.candidate.email}>
                              <EmailIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                            </Tooltip>
                          )}
                          {application.candidate.phone && (
                            <Tooltip title={application.candidate.phone}>
                              <PhoneIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                            </Tooltip>
                          )}
                        </Box>
                      </Box>
                    </Box>
                  </TableCell>
                  
                  <TableCell>
                    <Chip
                      label={application.status}
                      color={getStatusColor(application.status)}
                      size="small"
                      onClick={() => {
                        // TODO: Show stage change dialog
                        console.log('Change stage for:', application.id);
                      }}
                      sx={{ cursor: 'pointer' }}
                    />
                  </TableCell>
                  
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <span>{getSourceIcon(application.source)}</span>
                      <Typography variant="body2" sx={{ textTransform: 'capitalize' }}>
                        {application.source?.replace('_', ' ') || 'Unknown'}
                      </Typography>
                    </Box>
                  </TableCell>
                  
                  <TableCell>
                    {renderRating(application.rating)}
                  </TableCell>
                  
                  <TableCell>
                    <Typography variant="body2">
                      {format(safeToDate(application.createdAt), 'MMM dd, yyyy')}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {formatDistanceToNow(safeToDate(application.createdAt), { addSuffix: true })}
                    </Typography>
                  </TableCell>
                  
                  <TableCell>
                    <Typography variant="body2">
                      {format(safeToDate(application.stageChangedAt), 'MMM dd, yyyy')}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {formatDistanceToNow(safeToDate(application.stageChangedAt), { addSuffix: true })}
                    </Typography>
                  </TableCell>
                  
                  <TableCell align="right">
                    <IconButton
                      size="small"
                      onClick={(e) => handleMenuOpen(e, application)}
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
          if (selectedApplication && onViewApplication) {
            onViewApplication(selectedApplication);
          }
          handleMenuClose();
        }}>
          <ViewIcon sx={{ mr: 1 }} />
          View Details
        </MenuItem>
        <MenuItem onClick={() => {
          if (selectedApplication && onEditApplication) {
            onEditApplication(selectedApplication);
          }
          handleMenuClose();
        }}>
          <EditIcon sx={{ mr: 1 }} />
          Edit
        </MenuItem>
        <Divider />
        <MenuItem onClick={() => {
          if (selectedApplication && onDeleteApplication) {
            onDeleteApplication(selectedApplication);
          }
          handleMenuClose();
        }} sx={{ color: 'error.main' }}>
          <DeleteIcon sx={{ mr: 1 }} />
          Delete
        </MenuItem>
      </Menu>
    </Box>
  );
};

export default ApplicationsList;
