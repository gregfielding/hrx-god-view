import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  TextField,
  InputAdornment,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
  CircularProgress,
  Alert,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Button,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import PersonIcon from '@mui/icons-material/Person';
import EmailIcon from '@mui/icons-material/Email';
import PhoneIcon from '@mui/icons-material/Phone';
import WorkIcon from '@mui/icons-material/Work';
import StarIcon from '@mui/icons-material/Star';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { collection, query, where, orderBy, getDocs, doc, getDoc } from 'firebase/firestore';
import FavoriteButton from '../components/FavoriteButton';

type ApplicationStatus = 'applied' | 'screening' | 'interview' | 'offer' | 'hired' | 'rejected' | 'withdrawn' | 'submitted';

interface ApplicantWithDetails {
  id: string;
  tenantId: string;
  userId: string;
  jobId?: string;
  status: ApplicationStatus;
  submittedAt: any;
  createdAt: any;
  updatedAt?: any;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  data?: any;
  jobOrderNumber?: string;
  jobTitle?: string;
  companyName?: string;
  rating?: number;
  source?: string;
}

const RecruiterApplicants: React.FC = () => {
  const navigate = useNavigate();
  const { activeTenant } = useAuth();
  const [applicants, setApplicants] = useState<ApplicantWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<ApplicationStatus | 'all'>('all');
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'name'>('newest');

  useEffect(() => {
    if (!activeTenant?.id) return;
    loadApplicants();
  }, [activeTenant?.id]);

  const loadApplicants = async () => {
    if (!activeTenant?.id) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const tenantId = activeTenant.id;
      console.log('🔍 RecruiterApplicants: Loading applications for tenant:', tenantId);
      
      // Query applications from tenants/{tenantId}/applications
      const applicationsRef = collection(db, 'tenants', tenantId, 'applications');
      const q = query(applicationsRef, orderBy('createdAt', 'desc'));
      
      const querySnapshot = await getDocs(q);
      console.log('🔍 RecruiterApplicants: Found', querySnapshot.size, 'applications');
      
      const applicationsData = await Promise.all(
        querySnapshot.docs.map(async (applicationDoc) => {
          const data = applicationDoc.data();
          
          // Extract applicant info from the nested data structure
          const firstName = data.firstName || data.data?.personal?.firstName || '';
          const lastName = data.lastName || data.data?.personal?.lastName || '';
          const email = data.email || data.data?.personal?.email || '';
          const phone = data.phone || data.data?.personal?.phone || '';
          
          // Fetch job posting details if linked
          let jobOrderNumber = undefined;
          let jobTitle = undefined;
          let companyName = undefined;
          
          if (data.jobId) {
            try {
              const jobPostRef = doc(db, 'tenants', tenantId, 'job_postings', data.jobId);
              const jobPostSnap = await getDoc(jobPostRef);
              
              if (jobPostSnap.exists()) {
                const jobPostData = jobPostSnap.data();
                jobOrderNumber = jobPostData.jobPostId || jobPostData.jobOrderId;
                jobTitle = jobPostData.jobTitle || jobPostData.postTitle;
                companyName = jobPostData.companyName;
              }
            } catch (error) {
              console.warn('Failed to fetch job posting details:', error);
            }
          }
          
          return {
            id: applicationDoc.id,
            tenantId: data.tenantId,
            userId: data.userId || data.uid,
            jobId: data.jobId,
            status: data.status || 'submitted',
            submittedAt: data.submittedAt,
            createdAt: data.createdAt,
            updatedAt: data.updatedAt,
            firstName,
            lastName,
            email,
            phone,
            data: data.data,
            jobOrderNumber,
            jobTitle,
            companyName,
            rating: data.rating,
            source: data.source || 'job_board',
          };
        })
      );
      
      setApplicants(applicationsData);
    } catch (error) {
      console.error('Error loading applications:', error);
      setError('Failed to load applicants. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: ApplicationStatus): 'default' | 'primary' | 'secondary' | 'success' | 'error' | 'warning' | 'info' => {
    switch (status) {
      case 'hired':
        return 'success';
      case 'offer':
        return 'info';
      case 'interview':
        return 'primary';
      case 'screening':
        return 'secondary';
      case 'rejected':
        return 'error';
      case 'withdrawn':
        return 'default';
      default:
        return 'default';
    }
  };

  const getRatingStars = (rating?: number) => {
    if (!rating) return null;
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        {[...Array(5)].map((_, i) => (
          <StarIcon
            key={i}
            sx={{
              fontSize: 14,
              color: i < rating ? 'warning.main' : 'action.disabled'
            }}
          />
        ))}
      </Box>
    );
  };

  const formatDate = (timestamp: any) => {
    if (!timestamp) return 'N/A';
    let date: Date;
    if (timestamp instanceof Date) {
      date = timestamp;
    } else if (typeof timestamp === 'number') {
      date = new Date(timestamp);
    } else if (timestamp.toDate && typeof timestamp.toDate === 'function') {
      date = timestamp.toDate();
    } else {
      return 'N/A';
    }
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  // Filter and sort applicants
  const filteredApplicants = applicants
    .filter(app => {
      // Status filter
      if (statusFilter !== 'all' && app.status !== statusFilter) return false;
      
      // Search filter
      if (searchTerm) {
        const search = searchTerm.toLowerCase();
        return (
          app.firstName?.toLowerCase().includes(search) ||
          app.lastName?.toLowerCase().includes(search) ||
          app.email?.toLowerCase().includes(search) ||
          app.phone?.toLowerCase().includes(search) ||
          app.jobTitle?.toLowerCase().includes(search) ||
          app.companyName?.toLowerCase().includes(search)
        );
      }
      
      return true;
    })
    .sort((a, b) => {
      switch (sortBy) {
        case 'newest': {
          const aTime = a.createdAt instanceof Date ? a.createdAt.getTime() : (typeof a.createdAt === 'number' ? a.createdAt : 0);
          const bTime = b.createdAt instanceof Date ? b.createdAt.getTime() : (typeof b.createdAt === 'number' ? b.createdAt : 0);
          return bTime - aTime;
        }
        case 'oldest': {
          const aTime = a.createdAt instanceof Date ? a.createdAt.getTime() : (typeof a.createdAt === 'number' ? a.createdAt : 0);
          const bTime = b.createdAt instanceof Date ? b.createdAt.getTime() : (typeof b.createdAt === 'number' ? b.createdAt : 0);
          return aTime - bTime;
        }
        case 'name':
          return `${a.lastName} ${a.firstName}`.localeCompare(
            `${b.lastName} ${b.firstName}`
          );
        default:
          return 0;
      }
    });

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      {/* Search and Filters */}
      <Box sx={{ mb: 3, display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
        <TextField
          placeholder="Search applicants..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          variant="outlined"
          size="small"
          sx={{ flexGrow: 1, minWidth: 300 }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon />
              </InputAdornment>
            ),
          }}
        />
        
        <FormControl size="small" sx={{ minWidth: 150 }}>
          <InputLabel>Status</InputLabel>
          <Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as ApplicationStatus | 'all')}
            label="Status"
          >
            <MenuItem value="all">All Statuses</MenuItem>
            <MenuItem value="submitted">Submitted</MenuItem>
            <MenuItem value="applied">Applied</MenuItem>
            <MenuItem value="screening">Screening</MenuItem>
            <MenuItem value="interview">Interview</MenuItem>
            <MenuItem value="offer">Offer</MenuItem>
            <MenuItem value="hired">Hired</MenuItem>
            <MenuItem value="rejected">Rejected</MenuItem>
            <MenuItem value="withdrawn">Withdrawn</MenuItem>
          </Select>
        </FormControl>
        
        <FormControl size="small" sx={{ minWidth: 150 }}>
          <InputLabel>Sort By</InputLabel>
          <Select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'newest' | 'oldest' | 'name')}
            label="Sort By"
          >
            <MenuItem value="newest">Newest First</MenuItem>
            <MenuItem value="oldest">Oldest First</MenuItem>
            <MenuItem value="name">Name (A-Z)</MenuItem>
          </Select>
        </FormControl>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {/* Applicants Table */}
      {filteredApplicants.length === 0 ? (
        <Paper sx={{ p: 4, textAlign: 'center' }}>
          <Typography variant="h6" gutterBottom>
            No applicants found
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {searchTerm || statusFilter !== 'all'
              ? 'Try adjusting your filters'
              : 'Applicants will appear here as they apply to your job orders'}
          </Typography>
        </Paper>
      ) : (
        <TableContainer component={Paper}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.75rem', width: 60 }}>
                  Favorites
                </TableCell>
                <TableCell sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.75rem' }}>
                  Name
                </TableCell>
                <TableCell sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.75rem' }}>
                  Contact
                </TableCell>
                <TableCell sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.75rem' }}>
                  Job Order
                </TableCell>
                <TableCell sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.75rem' }}>
                  Status
                </TableCell>
                <TableCell sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.75rem' }}>
                  Rating
                </TableCell>
                <TableCell sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.75rem' }}>
                  Source
                </TableCell>
                <TableCell sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.75rem' }}>
                  Applied
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredApplicants.map((applicant, index) => (
                <TableRow
                  key={applicant.id}
                  hover
                  onClick={() => {
                    // TODO: Navigate to applicant detail page
                    console.log('View applicant:', applicant.id);
                  }}
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
                      itemId={applicant.id}
                      favoriteType="applications"
                      size="small"
                      tooltipText={{
                        favorited: 'Remove from favorites',
                        notFavorited: 'Add to favorites'
                      }}
                    />
                  </TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <PersonIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                      <Typography variant="body2" sx={{ fontWeight: 500 }}>
                        {applicant.lastName}, {applicant.firstName}
                      </Typography>
                    </Box>
                  </TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                      {applicant.email && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          <EmailIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                          <Typography variant="body2" sx={{ fontSize: '0.8rem' }}>
                            {applicant.email}
                          </Typography>
                        </Box>
                      )}
                      {applicant.phone && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          <PhoneIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                          <Typography variant="body2" sx={{ fontSize: '0.8rem' }}>
                            {applicant.phone}
                          </Typography>
                        </Box>
                      )}
                    </Box>
                  </TableCell>
                  <TableCell>
                    {applicant.jobId ? (
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          <WorkIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                          <Typography variant="body2" sx={{ fontWeight: 500 }}>
                            {applicant.jobOrderNumber || applicant.jobId}
                          </Typography>
                        </Box>
                        {applicant.jobTitle && (
                          <Typography variant="body2" sx={{ fontSize: '0.8rem', color: 'text.secondary' }}>
                            {applicant.jobTitle}
                          </Typography>
                        )}
                        {applicant.companyName && (
                          <Typography variant="body2" sx={{ fontSize: '0.8rem', color: 'text.secondary' }}>
                            {applicant.companyName}
                          </Typography>
                        )}
                      </Box>
                    ) : (
                      <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                        General Application
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={applicant.status.charAt(0).toUpperCase() + applicant.status.slice(1)}
                      color={getStatusColor(applicant.status)}
                      size="small"
                    />
                  </TableCell>
                  <TableCell>
                    {getRatingStars(applicant.rating)}
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" sx={{ textTransform: 'capitalize' }}>
                      {applicant.source?.replace('_', ' ') || 'N/A'}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">
                      {formatDate(applicant.createdAt)}
                    </Typography>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
      
      <Box sx={{ mt: 2, textAlign: 'center', color: 'text.secondary' }}>
        <Typography variant="body2">
          Showing {filteredApplicants.length} of {applicants.length} applicant{applicants.length !== 1 ? 's' : ''}
        </Typography>
      </Box>
    </Box>
  );
};

export default RecruiterApplicants;

