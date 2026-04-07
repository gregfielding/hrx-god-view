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
  Avatar,
  CircularProgress,
  Alert,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Button,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import EmailIcon from '@mui/icons-material/Email';
import PhoneIcon from '@mui/icons-material/Phone';
import WorkIcon from '@mui/icons-material/Work';
import StarIcon from '@mui/icons-material/Star';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { collection, query, where, orderBy, getDocs, doc, getDoc } from 'firebase/firestore';
import FavoriteButton from '../components/FavoriteButton';
import FavoritesFilter from '../components/FavoritesFilter';
import { useFavorites } from '../hooks/useFavorites';
import TableSortLabel from '@mui/material/TableSortLabel';
import { getWorkAuthorizedStatus, compareWorkAuthorized } from '../utils/workAuthorizedDisplay';
import {
  getEVerifyComfortStatusFromUserData,
  compareEVerifyComfort,
} from '../utils/eVerifyComfortDisplay';
import WorkAuthorizedChip from '../components/WorkAuthorizedChip';
import EVerifyComfortChip from '../components/EVerifyComfortChip';
import { formatHourlyPayRateForDisplay } from '../utils/hourlyPayDisplay';
import { TABLE_AVATAR_SIZE } from '../utils/uiConstants';
import UserTableResumeIcon from '../components/tables/UserTableResumeIcon';
import UserTableIndeedFlexBadge from '../components/tables/UserTableIndeedFlexBadge';
import { pickResumeFromUserDoc } from '../utils/userResumeOpen';

// Security levels for filtering
type SecurityLevel = '0' | '1' | '2' | '3' | '4' | 'all';

interface ApplicationData {
  applicationId: string;
  jobId: string;
  jobTitle?: string;
  jobOrderName?: string; // Full job order name like "Janitor - Parker Plastics Offer - New"
  postTitle?: string;
  companyName?: string;
  companyId?: string;
  jobPostId?: string;
  payRate?: number;
  status: string;
  appliedAt: any;
  startDate?: any;
  location?: string;
  updatedAt?: any;
}

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
  applicationData?: Record<string, ApplicationData>;
  applicationCount?: number;
  mostRecentApplication?: ApplicationData;
  comfortableEVerify?: string;
  workerAttestations?: { eVerifyWillingness?: string };
  resume?: Record<string, unknown> | null;
  addedToIndeedFlex?: boolean;
}

const RecruiterApplicants: React.FC = () => {
  const navigate = useNavigate();
  const { activeTenant } = useAuth();
  const [candidates, setCandidates] = useState<CandidateWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [securityLevelFilter, setSecurityLevelFilter] = useState<SecurityLevel>('all');
  const [companyFilter, setCompanyFilter] = useState<string>('all');
  const [jobFilter, setJobFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'name' | 'lastLogin' | 'auth' | 'documented'>('newest');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  
  // Get favorites
  const { favorites, isFavorite, toggleFavorite } = useFavorites('users');
  
  // Get unique companies from all candidates for filtering
  const uniqueCompanies = Array.from(
    new Set(
      candidates
        .map(c => c.mostRecentApplication?.companyName)
        .filter((name): name is string => !!name)
    )
  ).sort();
  
  // Get unique job order names from all candidates for filtering
  const uniqueJobOrders = Array.from(
    new Set(
      candidates
        .map(c => c.mostRecentApplication?.jobOrderName || c.mostRecentApplication?.postTitle || c.mostRecentApplication?.jobTitle)
        .filter((name): name is string => !!name)
    )
  ).sort();

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
      
      // Query users with security levels 0-4 within the tenant
      // Security level is stored in tenantIds.{tenantId}.securityLevel
      // Note: We don't orderBy here to avoid needing a composite index - we'll sort in memory
      const usersRef = collection(db, 'users');
      const q = query(
        usersRef,
        where(`tenantIds.${tenantId}.securityLevel`, 'in', ['0', '1', '2', '3', '4'])
      );
      
      console.log('🔍 RecruiterApplicants: Querying users with tenantIds.' + tenantId + '.securityLevel in:', ['0', '1', '2', '3', '4']);
      
      const querySnapshot = await getDocs(q);
      console.log('🔍 RecruiterApplicants: Found', querySnapshot.size, 'candidates');
      
      // Debug: log what we got
      if (querySnapshot.size === 0) {
        console.log('⚠️ No candidates found. Checking all users with this tenant...');
        const allUsersQuery = query(usersRef, where('tenantId', '==', tenantId));
        const allUsersSnapshot = await getDocs(allUsersQuery);
        console.log('🔍 Total users in tenant:', allUsersSnapshot.size);
        allUsersSnapshot.docs.forEach(doc => {
          const data = doc.data();
          const tenantSecLevel = data.tenantIds?.[tenantId]?.securityLevel;
          console.log(`   - ${data.firstName} ${data.lastName}: tenant securityLevel=${tenantSecLevel}, top-level=${data.securityLevel}`);
        });
      }
      
      const candidatesData = querySnapshot.docs.map((userDoc) => {
        const userData = userDoc.data();
        
        // Get security level from tenant-specific data
        const tenantData = userData.tenantIds?.[tenantId] || {};
        const securityLevel = tenantData.securityLevel || userData.securityLevel || '0';
        
        // Get application data from denormalized map (much faster!)
        const applicationData: Record<string, ApplicationData> = userData.applicationData || {};
        const applicationCount = Object.keys(applicationData).length;
        
        // Find most recent application by sorting appliedAt
        let mostRecentApplication: ApplicationData | undefined = undefined;
        if (applicationCount > 0) {
          const applications = Object.values(applicationData);
          // Sort by appliedAt descending to get most recent
          applications.sort((a, b) => {
            const aTime = a.appliedAt?.toMillis?.() || a.appliedAt?.getTime?.() || 0;
            const bTime = b.appliedAt?.toMillis?.() || b.appliedAt?.getTime?.() || 0;
            return bTime - aTime;
          });
          mostRecentApplication = applications[0];
        }
        
        const workEligibility =
          userData.workEligibilityAttestation && typeof userData.workEligibilityAttestation.authorizedToWorkUS === 'boolean'
            ? userData.workEligibilityAttestation.authorizedToWorkUS
            : userData.workEligibility;

        return {
          id: userDoc.id,
          tenantId: userData.tenantId,
          firstName: userData.firstName || '',
          lastName: userData.lastName || '',
          email: userData.email || '',
          phone: userData.phone || '',
          avatar: userData.avatar || '',
          skills: userData.skills || [],
          securityLevel: String(securityLevel), // Ensure it's a string
          role: tenantData.role || userData.role,
          department: tenantData.department || userData.department,
          lastLoginAt: userData.lastLoginAt,
          createdAt: userData.createdAt,
          updatedAt: userData.updatedAt,
          applicationData,
          applicationCount,
          mostRecentApplication,
          workEligibility,
          workEligibilityAttestation: userData.workEligibilityAttestation,
          comfortableEVerify: userData.comfortableEVerify,
          workerAttestations: userData.workerAttestations,
          resume: userData.resume ?? null,
          addedToIndeedFlex: userData.addedToIndeedFlex === true,
        };
      });
      
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
      // Favorites filter
      if (showFavoritesOnly && !favorites.includes(candidate.id)) return false;
      
      // Security level filter
      if (securityLevelFilter !== 'all' && candidate.securityLevel !== securityLevelFilter) return false;
      
      // Company filter
      if (companyFilter !== 'all' && candidate.mostRecentApplication?.companyName !== companyFilter) return false;
      
      // Job filter
      if (jobFilter !== 'all') {
        const jobOrderName = candidate.mostRecentApplication?.jobOrderName || candidate.mostRecentApplication?.postTitle || candidate.mostRecentApplication?.jobTitle;
        if (jobOrderName !== jobFilter) return false;
      }
      
      // Search filter
      if (searchTerm) {
        const search = searchTerm.toLowerCase();
        return (
          candidate.firstName.toLowerCase().includes(search) ||
          candidate.lastName.toLowerCase().includes(search) ||
          candidate.email.toLowerCase().includes(search) ||
          candidate.phone?.toLowerCase().includes(search) ||
          candidate.mostRecentApplication?.jobTitle?.toLowerCase().includes(search) ||
          candidate.mostRecentApplication?.postTitle?.toLowerCase().includes(search) ||
          candidate.mostRecentApplication?.companyName?.toLowerCase().includes(search) ||
          candidate.mostRecentApplication?.location?.toLowerCase().includes(search)
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
        case 'auth': {
          const aStatus = getWorkAuthorizedStatus(a);
          const bStatus = getWorkAuthorizedStatus(b);
          const cmp = compareWorkAuthorized(aStatus, bStatus);
          return sortDirection === 'asc' ? cmp : -cmp;
        }
        case 'documented': {
          const cmp = compareEVerifyComfort(
            getEVerifyComfortStatusFromUserData(a),
            getEVerifyComfortStatusFromUserData(b),
          );
          return sortDirection === 'asc' ? cmp : -cmp;
        }
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
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon sx={{ color: '#9CA3AF', fontSize: '18px' }} />
              </InputAdornment>
            ),
            endAdornment: (
              <InputAdornment position="end">
                <FavoritesFilter
                  favoriteType="users"
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
        
        <FormControl size="small" sx={{ minWidth: 180, height: 36 }}>
          <InputLabel sx={{ fontSize: '0.875rem' }}>Security Level</InputLabel>
          <Select
            value={securityLevelFilter}
            onChange={(e) => setSecurityLevelFilter(e.target.value as SecurityLevel)}
            label="Security Level"
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
            <MenuItem value="all">All Levels</MenuItem>
            <MenuItem value="0">🔴 Suspended</MenuItem>
            <MenuItem value="1">⚫ Dismissed</MenuItem>
            <MenuItem value="2">🔵 Applicant</MenuItem>
            <MenuItem value="3">🟣 Candidate</MenuItem>
            <MenuItem value="4">🟢 Hired Staff</MenuItem>
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
        
        <FormControl size="small" sx={{ minWidth: 200, height: 36 }}>
          <InputLabel sx={{ fontSize: '0.875rem' }}>Job Order</InputLabel>
          <Select
            value={jobFilter}
            onChange={(e) => setJobFilter(e.target.value)}
            label="Job Order"
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
            <MenuItem value="all">All Job Orders</MenuItem>
            {uniqueJobOrders.map((jobOrder) => (
              <MenuItem key={jobOrder} value={jobOrder}>
                {jobOrder}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        
        <FormControl size="small" sx={{ minWidth: 150, height: 36 }}>
          <InputLabel sx={{ fontSize: '0.875rem' }}>Sort By</InputLabel>
          <Select
            value={sortBy}
            onChange={(e) =>
              setSortBy(e.target.value as 'newest' | 'oldest' | 'name' | 'lastLogin' | 'auth' | 'documented')
            }
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
            <MenuItem value="newest">Recently Updated</MenuItem>
            <MenuItem value="oldest">Oldest First</MenuItem>
            <MenuItem value="lastLogin">Last Login</MenuItem>
            <MenuItem value="name">Name (A-Z)</MenuItem>
            <MenuItem value="auth">Work Authorized</MenuItem>
            <MenuItem value="documented">Documented</MenuItem>
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
            {searchTerm || securityLevelFilter !== 'all' || companyFilter !== 'all' || jobFilter !== 'all' || showFavoritesOnly
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
                  <TableSortLabel
                    active={sortBy === 'auth'}
                    direction={sortBy === 'auth' ? sortDirection : 'desc'}
                    onClick={() => {
                      if (sortBy === 'auth') setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
                      else { setSortBy('auth'); setSortDirection('desc'); }
                    }}
                  >
                    Auth
                  </TableSortLabel>
                </TableCell>
                <TableCell sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.75rem' }}>
                  <TableSortLabel
                    active={sortBy === 'documented'}
                    direction={sortBy === 'documented' ? sortDirection : 'desc'}
                    onClick={() => {
                      if (sortBy === 'documented') setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
                      else {
                        setSortBy('documented');
                        setSortDirection('desc');
                      }
                    }}
                  >
                    Documented
                  </TableSortLabel>
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
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0 }}>
                      <Avatar
                        src={candidate.avatar}
                        alt={`${candidate.firstName} ${candidate.lastName}`}
                        sx={{ width: TABLE_AVATAR_SIZE, height: TABLE_AVATAR_SIZE, flexShrink: 0 }}
                      >
                        {candidate.firstName?.[0]}
                      </Avatar>
                      <Box sx={{ minWidth: 0, overflow: 'hidden' }}>
                        <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
                          {candidate.lastName}, {candidate.firstName}
                        </Typography>
                        {(candidate.createdAt ||
                          pickResumeFromUserDoc(candidate as unknown as Record<string, unknown>)) && (
                          <Box
                            sx={{
                              display: 'flex',
                              alignItems: 'center',
                              flexWrap: 'nowrap',
                              gap: '6px',
                              mt: 0.25,
                            }}
                          >
                            {candidate.createdAt && (
                              <Typography
                                variant="caption"
                                color="text.secondary"
                                component="span"
                                sx={{ lineHeight: 1.2 }}
                              >
                                {formatDate(candidate.createdAt)}
                              </Typography>
                            )}
                            <UserTableResumeIcon user={candidate as unknown as Record<string, unknown>} />
                          </Box>
                        )}
                        <UserTableIndeedFlexBadge user={candidate as unknown as Record<string, unknown>} />
                      </Box>
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
                    <WorkAuthorizedChip status={getWorkAuthorizedStatus(candidate)} />
                  </TableCell>
                  <TableCell>
                    <EVerifyComfortChip status={getEVerifyComfortStatusFromUserData(candidate)} />
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
                            {candidate.mostRecentApplication.jobTitle || candidate.mostRecentApplication.postTitle || 'Job'}
                          </Typography>
                        </Box>
                        {candidate.mostRecentApplication.companyName && (
                          <Typography variant="body2" sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>
                            {candidate.mostRecentApplication.companyName}
                          </Typography>
                        )}
                        {candidate.mostRecentApplication.location && (
                          <Typography variant="body2" sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>
                            📍 {candidate.mostRecentApplication.location}
                          </Typography>
                        )}
                        {(() => {
                          const payLbl = formatHourlyPayRateForDisplay(candidate.mostRecentApplication.payRate);
                          if (!payLbl) return null;
                          return (
                            <Typography variant="body2" sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>
                              💰 {payLbl}
                            </Typography>
                          );
                        })()}
                        {candidate.mostRecentApplication.appliedAt && (
                          <Typography variant="body2" sx={{ fontSize: '0.75rem', color: 'text.secondary', fontStyle: 'italic' }}>
                            Applied: {formatDate(candidate.mostRecentApplication.appliedAt)}
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

