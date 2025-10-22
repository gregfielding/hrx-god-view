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

// Security levels for filtering
type SecurityLevel = '0' | '1' | '2' | '3' | '4' | 'all';

interface CandidateWithDetails {
  id: string; // userId
  tenantId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  avatar?: string;
  skills?: string[];
  securityLevel: string;
  role?: string;
  department?: string;
  lastLoginAt?: any;
  createdAt?: any;
  updatedAt?: any;
  applicationCount?: number;
  mostRecentApplication?: {
    jobId?: string;
    jobTitle?: string;
    companyName?: string;
    submittedAt?: any;
    status?: string;
  };
}

const RecruiterApplicants: React.FC = () => {
  const navigate = useNavigate();
  const { activeTenant } = useAuth();
  const [candidates, setCandidates] = useState<CandidateWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [securityLevelFilter, setSecurityLevelFilter] = useState<SecurityLevel>('all');
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'name' | 'lastLogin'>('newest');

  useEffect(() => {
    if (!activeTenant?.id) return;
    loadCandidates();
  }, [activeTenant?.id]);

  const loadCandidates = async () => {
    if (!activeTenant?.id) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const tenantId = activeTenant.id;
      console.log('🔍 RecruiterApplicants: Loading candidates for tenant:', tenantId);
      
      // Query users with security levels 0-4 (Suspended, Dismissed, Applicant, Candidate, Hired Staff)
      const usersRef = collection(db, 'users');
      const q = query(
        usersRef,
        where('tenantId', '==', tenantId),
        where('securityLevel', 'in', ['0', '1', '2', '3', '4']),
        orderBy('updatedAt', 'desc')
      );
      
      const querySnapshot = await getDocs(q);
      console.log('🔍 RecruiterApplicants: Found', querySnapshot.size, 'candidates');
      
      const candidatesData = await Promise.all(
        querySnapshot.docs.map(async (userDoc) => {
          const userData = userDoc.data();
          
          // Get application count and most recent application
          let applicationCount = 0;
          let mostRecentApplication = undefined;
          
          try {
            const applicationsRef = collection(db, 'tenants', tenantId, 'applications');
            const appQuery = query(
              applicationsRef,
              where('userId', '==', userDoc.id),
              orderBy('createdAt', 'desc')
            );
            const appSnapshot = await getDocs(appQuery);
            applicationCount = appSnapshot.size;
            
            // Get most recent application details
            if (!appSnapshot.empty) {
              const recentAppData = appSnapshot.docs[0].data();
              
              // Fetch job posting details if available
              if (recentAppData.jobId) {
                try {
                  const jobPostRef = doc(db, 'tenants', tenantId, 'job_postings', recentAppData.jobId);
                  const jobPostSnap = await getDoc(jobPostRef);
                  
                  if (jobPostSnap.exists()) {
                    const jobPostData = jobPostSnap.data();
                    mostRecentApplication = {
                      jobId: recentAppData.jobId,
                      jobTitle: jobPostData.jobTitle || jobPostData.postTitle,
                      companyName: jobPostData.companyName,
                      submittedAt: recentAppData.submittedAt || recentAppData.createdAt,
                      status: recentAppData.status || 'submitted',
                    };
                  }
                } catch (error) {
                  console.warn('Failed to fetch job posting details:', error);
                }
              }
            }
          } catch (error) {
            console.warn('Failed to fetch applications for user:', userDoc.id, error);
          }
          
          return {
            id: userDoc.id,
            tenantId: userData.tenantId,
            firstName: userData.firstName || '',
            lastName: userData.lastName || '',
            email: userData.email || '',
            phone: userData.phone || '',
            avatar: userData.avatar || '',
            skills: userData.skills || [],
            securityLevel: userData.securityLevel || '0',
            role: userData.role,
            department: userData.department,
            lastLoginAt: userData.lastLoginAt,
            createdAt: userData.createdAt,
            updatedAt: userData.updatedAt,
            applicationCount,
            mostRecentApplication,
          };
        })
      );
      
      setCandidates(candidatesData);
    } catch (error) {
      console.error('Error loading candidates:', error);
      setError('Failed to load candidates. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const getSecurityLevelLabel = (level: string): string => {
    switch (level) {
      case '0': return 'Suspended';
      case '1': return 'Dismissed';
      case '2': return 'Applicant';
      case '3': return 'Candidate';
      case '4': return 'Hired Staff';
      default: return level;
    }
  };

  const getSecurityLevelColor = (level: string): 'default' | 'primary' | 'secondary' | 'success' | 'error' | 'warning' | 'info' => {
    switch (level) {
      case '0': return 'error'; // Suspended
      case '1': return 'default'; // Dismissed
      case '2': return 'info'; // Applicant
      case '3': return 'primary'; // Candidate
      case '4': return 'success'; // Hired Staff
      default: return 'default';
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

  // Filter and sort candidates
  const filteredCandidates = candidates
    .filter(candidate => {
      // Security level filter
      if (securityLevelFilter !== 'all' && candidate.securityLevel !== securityLevelFilter) return false;
      
      // Search filter
      if (searchTerm) {
        const search = searchTerm.toLowerCase();
        return (
          candidate.firstName.toLowerCase().includes(search) ||
          candidate.lastName.toLowerCase().includes(search) ||
          candidate.email.toLowerCase().includes(search) ||
          candidate.phone?.toLowerCase().includes(search) ||
          candidate.mostRecentApplication?.jobTitle?.toLowerCase().includes(search) ||
          candidate.mostRecentApplication?.companyName?.toLowerCase().includes(search)
        );
      }
      
      return true;
    })
    .sort((a, b) => {
      switch (sortBy) {
        case 'newest': {
          const aTime = a.updatedAt instanceof Date ? a.updatedAt.getTime() : (typeof a.updatedAt === 'number' ? a.updatedAt : 0);
          const bTime = b.updatedAt instanceof Date ? b.updatedAt.getTime() : (typeof b.updatedAt === 'number' ? b.updatedAt : 0);
          return bTime - aTime;
        }
        case 'oldest': {
          const aTime = a.updatedAt instanceof Date ? a.updatedAt.getTime() : (typeof a.updatedAt === 'number' ? a.updatedAt : 0);
          const bTime = b.updatedAt instanceof Date ? b.updatedAt.getTime() : (typeof b.updatedAt === 'number' ? b.updatedAt : 0);
          return aTime - bTime;
        }
        case 'lastLogin': {
          const aTime = a.lastLoginAt instanceof Date ? a.lastLoginAt.getTime() : (typeof a.lastLoginAt === 'number' ? a.lastLoginAt : 0);
          const bTime = b.lastLoginAt instanceof Date ? b.lastLoginAt.getTime() : (typeof b.lastLoginAt === 'number' ? b.lastLoginAt : 0);
          return bTime - aTime;
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
          placeholder="Search candidates..."
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
        
        <FormControl size="small" sx={{ minWidth: 180 }}>
          <InputLabel>Security Level</InputLabel>
          <Select
            value={securityLevelFilter}
            onChange={(e) => setSecurityLevelFilter(e.target.value as SecurityLevel)}
            label="Security Level"
          >
            <MenuItem value="all">All Levels</MenuItem>
            <MenuItem value="0">🔴 Suspended</MenuItem>
            <MenuItem value="1">⚫ Dismissed</MenuItem>
            <MenuItem value="2">🔵 Applicant</MenuItem>
            <MenuItem value="3">🟣 Candidate</MenuItem>
            <MenuItem value="4">🟢 Hired Staff</MenuItem>
          </Select>
        </FormControl>
        
        <FormControl size="small" sx={{ minWidth: 150 }}>
          <InputLabel>Sort By</InputLabel>
          <Select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'newest' | 'oldest' | 'name' | 'lastLogin')}
            label="Sort By"
          >
            <MenuItem value="newest">Recently Updated</MenuItem>
            <MenuItem value="oldest">Oldest First</MenuItem>
            <MenuItem value="lastLogin">Last Login</MenuItem>
            <MenuItem value="name">Name (A-Z)</MenuItem>
          </Select>
        </FormControl>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {/* Candidates Table */}
      {filteredCandidates.length === 0 ? (
        <Paper sx={{ p: 4, textAlign: 'center' }}>
          <Typography variant="h6" gutterBottom>
            No candidates found
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {searchTerm || securityLevelFilter !== 'all'
              ? 'Try adjusting your filters'
              : 'Candidates will appear here as users apply to job postings'}
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
                  Security Level
                </TableCell>
                <TableCell sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.75rem' }}>
                  Applications
                </TableCell>
                <TableCell sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.75rem' }}>
                  Recent Application
                </TableCell>
                <TableCell sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.75rem' }}>
                  Last Login
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredCandidates.map((candidate, index) => (
                <TableRow
                  key={candidate.id}
                  hover
                  onClick={() => {
                    // Navigate to user profile
                    navigate(`/users/${candidate.id}`);
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
                      itemId={candidate.id}
                      favoriteType="users"
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
                        {candidate.lastName}, {candidate.firstName}
                      </Typography>
                    </Box>
                  </TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <EmailIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                        <Typography variant="body2" sx={{ fontSize: '0.8rem' }}>
                          {candidate.email}
                        </Typography>
                      </Box>
                      {candidate.phone && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          <PhoneIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                          <Typography variant="body2" sx={{ fontSize: '0.8rem' }}>
                            {candidate.phone}
                          </Typography>
                        </Box>
                      )}
                    </Box>
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={getSecurityLevelLabel(candidate.securityLevel)}
                      color={getSecurityLevelColor(candidate.securityLevel)}
                      size="small"
                    />
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>
                      {candidate.applicationCount || 0}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    {candidate.mostRecentApplication ? (
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          <WorkIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                          <Typography variant="body2" sx={{ fontWeight: 500, fontSize: '0.8rem' }}>
                            {candidate.mostRecentApplication.jobTitle || 'Job'}
                          </Typography>
                        </Box>
                        {candidate.mostRecentApplication.companyName && (
                          <Typography variant="body2" sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>
                            {candidate.mostRecentApplication.companyName}
                          </Typography>
                        )}
                        {candidate.mostRecentApplication.submittedAt && (
                          <Typography variant="body2" sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>
                            {formatDate(candidate.mostRecentApplication.submittedAt)}
                          </Typography>
                        )}
                      </Box>
                    ) : (
                      <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic', fontSize: '0.8rem' }}>
                        No applications
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">
                      {formatDate(candidate.lastLoginAt)}
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
          Showing {filteredCandidates.length} of {candidates.length} candidate{candidates.length !== 1 ? 's' : ''}
        </Typography>
      </Box>
    </Box>
  );
};

export default RecruiterApplicants;

