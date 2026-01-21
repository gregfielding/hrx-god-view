import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Avatar,
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import EmailIcon from '@mui/icons-material/Email';
import PhoneIcon from '@mui/icons-material/Phone';
import StarIcon from '@mui/icons-material/Star';
import GroupIcon from '@mui/icons-material/Groups';
import InsightsIcon from '@mui/icons-material/Insights';
import ClearIcon from '@mui/icons-material/Clear';
import IconButton from '@mui/material/IconButton';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { collection, getDocs, query, where, limit, startAfter, orderBy, QueryDocumentSnapshot, DocumentData } from 'firebase/firestore';
import { SelectChangeEvent } from '@mui/material/Select';

import FavoriteButton from '../components/FavoriteButton';
import { usePageCache } from '../hooks/usePageCache';
import StandardTablePagination from '../components/StandardTablePagination';
import PageHeader from '../components/PageHeader';
import InboxSearchBar from '../components/InboxSearchBar';
import FavoritesFilter from '../components/FavoritesFilter';
import { useFavorites } from '../hooks/useFavorites';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { calculateProfileScore } from '../utils/applicantScoring';
import { formatPhoneNumber } from '../utils/formatPhone';
import { TABLE_AVATAR_SIZE } from '../utils/uiConstants';
import type { RecruiterOutletContext } from './RecruiterDashboard';
import { normalizeScoreSummary, formatOneDecimal } from '../utils/scoreSummary';
import type { ScoreSummary } from '../utils/scoreSummary';

type SecurityLevel =
  | '0'
  | '1'
  | '2'
  | '3'
  | '4'
  | 'active_employee'
  | 'active_contractor'
  | 'all';

interface RecruiterUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  avatar?: string;
  securityLevel: string;
  employeeOnboardStatus?: string;
  contractorOnboardStatus?: string;
  onboardingType?: string;
  scoreSummary?: ScoreSummary;
  state?: string;
  lastLoginAt?: any;
  updatedAt?: any;
  createdAt?: any;
  aiProfileScore?: number;
  aiJobFitScore?: number;
  userGroupIds: string[];
  skills: string[];
}

interface TenantUserGroup {
  id: string;
  title?: string;
  description?: string;
}

const RecruiterUsers: React.FC = () => {
  const navigate = useNavigate();
  const { activeTenant } = useAuth();
  const outletCtx = useOutletContext<RecruiterOutletContext | null>();
  const [localSearch, setLocalSearch] = useState('');
  const [localShowFavoritesOnly, setLocalShowFavoritesOnly] = useState(false);
  
  // All hooks must be called at the top level, before any conditional returns
  const isFetchingRef = useRef(false);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const filtersRef = useRef<HTMLDivElement | null>(null);
  
  // Page cache for search and filters
  const { cacheState, updateCache } = usePageCache({
    pageKey: 'users',
    defaultState: {
      securityLevelFilter: 'all',
      groupFilter: 'all',
      skillFilter: 'all',
      stateFilter: 'all',
      sortBy: 'accountCreated',
      sortDirection: 'desc',
    },
  });
  
  // Use outlet context if available, otherwise use local state
  const searchTerm = outletCtx?.search !== undefined ? outletCtx.search : localSearch;
  const showFavoritesOnly = outletCtx?.showFavoritesOnly !== undefined ? outletCtx.showFavoritesOnly : localShowFavoritesOnly;
  
  const handleSearchChange = (value: string) => {
    if (outletCtx?.setSearch) {
      outletCtx.setSearch(value);
    } else {
      setLocalSearch(value);
    }
  };
  
  const handleFavoritesToggle = (value: boolean) => {
    if (outletCtx?.setShowFavoritesOnly) {
      outletCtx.setShowFavoritesOnly(value);
    } else {
      setLocalShowFavoritesOnly(value);
    }
  };

  const [users, setUsers] = useState<RecruiterUser[]>([]);
  const [groups, setGroups] = useState<TenantUserGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Pagination state
  const [lastVisibleDoc, setLastVisibleDoc] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const PAGE_SIZE = 500; // Load up to 500 users at a time so search can filter locally without reloads

  // State - initialize from cache
  const [securityLevelFilter, setSecurityLevelFilter] = useState<SecurityLevel>(cacheState.securityLevelFilter || 'all');
  const [groupFilter, setGroupFilter] = useState<string>(cacheState.groupFilter || 'all');
  const [skillFilter, setSkillFilter] = useState<string>(cacheState.skillFilter || 'all');
  const [stateFilter, setStateFilter] = useState<string>(cacheState.stateFilter || 'all');
  const [sortBy, setSortBy] = useState<'recentlyUpdated' | 'lastLogin' | 'name' | 'aiScore' | 'interview' | 'accountCreated'>((cacheState.sortBy as any) || 'accountCreated');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>(cacheState.sortDirection || 'desc');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(20);

  const { favorites, isFavorite, toggleFavorite } = useFavorites('users');

  const groupLookup = useMemo(() => {
    const map = new Map<string, TenantUserGroup>();
    groups.forEach((group) => map.set(group.id, group));
    return map;
  }, [groups]);

  // Reset pagination when core filters (excluding search) change
  useEffect(() => {
    if (!activeTenant?.id) return;

    loadGroups(activeTenant.id);
    // Reset and load fresh data when filters/sort change
    setUsers([]);
    setLastVisibleDoc(null);
    setHasMore(true);
    loadUsers(activeTenant.id, true);
  }, [activeTenant?.id, securityLevelFilter, groupFilter, skillFilter, stateFilter, sortBy]);

  // Update cache when filters change
  useEffect(() => {
    updateCache({
      securityLevelFilter,
      groupFilter,
      skillFilter,
      stateFilter,
      sortBy,
      sortDirection,
    });
  }, [securityLevelFilter, groupFilter, skillFilter, stateFilter, sortBy, sortDirection, updateCache]);

  // Reset client pagination when filters/search change
  useEffect(() => {
    setPage(0);
  }, [searchTerm, securityLevelFilter, groupFilter, skillFilter, stateFilter, sortBy, showFavoritesOnly]);

  const handleSort = (key: 'name' | 'aiScore' | 'interview' | 'lastLogin') => {
    if (sortBy === key) {
      const newDirection = sortDirection === 'asc' ? 'desc' : 'asc';
      setSortDirection(newDirection);
      updateCache({ sortDirection: newDirection });
      return;
    }
    const newDirection = key === 'name' ? 'asc' : 'desc';
    setSortBy(key);
    setSortDirection(newDirection);
    updateCache({ sortBy: key, sortDirection: newDirection });
  };

  const loadGroups = async (tenantId: string) => {
    try {
      const groupsRef = collection(db, 'tenants', tenantId, 'userGroups');
      const snapshot = await getDocs(groupsRef);
      setGroups(snapshot.docs.map((doc) => ({ id: doc.id, ...(doc.data() as TenantUserGroup) })));
    } catch (err) {
      console.warn('RecruiterUsers: Failed to load user groups', err);
      setGroups([]);
    }
  };

  const loadUsers = async (tenantId: string, isInitialLoad = false) => {
    // Guard against overlapping/double-invoked fetches (React dev/StrictMode)
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;

    if (isInitialLoad) {
      setLoading(true);
    } else {
      setLoadingMore(true);
    }
    setError(null);

    try {
      const usersRef = collection(db, 'users');
      
      // Build base query
      let q = query(
        usersRef,
        where(`tenantIds.${tenantId}.securityLevel`, 'in', ['0', '1', '2', '3', '4'])
      );

      // Add ordering for pagination (required for startAfter)
      q = query(q, orderBy('createdAt', 'desc'));
      
      // When search or filters are active, load more aggressively (up to 500 users)
      // This ensures search/filters query the full collection
      const hasActiveFilters = searchTerm || 
        securityLevelFilter !== 'all' || 
        groupFilter !== 'all' || 
        skillFilter !== 'all' || 
        stateFilter !== 'all';
      
      const effectivePageSize = hasActiveFilters ? 500 : PAGE_SIZE;
      
      // Add limit
      q = query(q, limit(effectivePageSize));
      
      // If loading more, start after last document
      if (!isInitialLoad && lastVisibleDoc) {
        q = query(q, startAfter(lastVisibleDoc));
      }

      const snapshot = await getDocs(q);
      
      // Track last document for pagination
      const lastDoc = snapshot.docs[snapshot.docs.length - 1];
      setLastVisibleDoc(lastDoc || null);
      setHasMore(snapshot.docs.length === effectivePageSize);

      const data: RecruiterUser[] = snapshot.docs.map((userDoc) => {
        const userData = userDoc.data() as any;
        const tenantData = userData.tenantIds?.[tenantId] || {};
        const securityLevel = tenantData.securityLevel || userData.securityLevel || '0';
        const rawSkills = Array.isArray(userData.skills)
          ? userData.skills
          : Array.isArray(tenantData.skills)
          ? tenantData.skills
          : [];
        const normalizedSkills = rawSkills
          .map((skill: any) => {
            if (!skill) return null;
            if (typeof skill === 'string') return skill;
            if (typeof skill === 'object') {
              if (typeof skill.label === 'string') return skill.label;
              if (typeof skill.name === 'string') return skill.name;
              if (typeof skill.value === 'string') return skill.value;
            }
            return null;
          })
          .filter((skill): skill is string => !!skill);

        return {
          id: userDoc.id,
          firstName: userData.firstName || '',
          lastName: userData.lastName || '',
          email: userData.email || '',
          phone: userData.phone || '',
          avatar: userData.avatar || tenantData.avatar,
          securityLevel: String(securityLevel),
          employeeOnboardStatus: userData.employeeOnboardStatus,
          contractorOnboardStatus: userData.contractorOnboardStatus,
          onboardingType: userData.onboardingType,
          scoreSummary: normalizeScoreSummary(userData.scoreSummary),
          lastLoginAt: userData.lastLoginAt,
          updatedAt: userData.updatedAt,
          createdAt: userData.createdAt,
          aiProfileScore:
            tenantData.aiProfileScore ??
            userData.aiProfileScore ??
            userData.aiScore ??
            userData.aiProfile?.score ??
            calculateProfileScore(userData),
          aiJobFitScore: tenantData.aiJobFitScore ?? userData.aiJobFitScore,
          userGroupIds: tenantData.userGroupIds || userData.userGroupIds || [],
          skills: normalizedSkills,
          state: userData.state || userData.address?.state || '',
        };
      });
      
      // If initial load, replace users; if loading more, append (dedupe by id)
      setUsers((prev) => {
        const map = new Map<string, RecruiterUser>();
        if (!isInitialLoad) {
          prev.forEach((u) => map.set(u.id, u));
        }
        data.forEach((u) => map.set(u.id, u));
        return Array.from(map.values());
      });
    } catch (err) {
      console.error('RecruiterUsers: Failed to load users', err);
      setError('Unable to load users. Please try again.');
    } finally {
      setLoading(false);
      setLoadingMore(false);
      isFetchingRef.current = false;
    }
  };
  
  // Load more users when clicking "Load More"
  const loadMoreUsers = () => {
    if (!activeTenant?.id || loadingMore || !hasMore) return;
    loadUsers(activeTenant.id, false);
  };

  const getSecurityLevelLabel = (level: string): string => {
    switch (level) {
      case '0':
        return 'Suspended';
      case '1':
        return 'Dismissed';
      case '2':
        return 'Applicant';
      case '3':
        return 'Candidate';
      case '4':
        return 'Staff';
      default:
        return level;
    }
  };

  const getSecurityLevelColor = (level: string):
    | 'default'
    | 'primary'
    | 'secondary'
    | 'success'
    | 'error'
    | 'warning'
    | 'info' => {
    switch (level) {
      case '0':
        return 'error';
      case '1':
        return 'default';
      case '2':
        return 'info';
      case '3':
        return 'primary';
      case '4':
        return 'success';
      default:
        return 'default';
    }
  };

  const getWorkStatusDisplay = (u: RecruiterUser): { label: string; color: 'default' | 'primary' | 'secondary' | 'success' | 'error' | 'warning' | 'info'; sx?: any } => {
    const employeeInProgress = String(u.employeeOnboardStatus || '').toLowerCase() === 'in progress';
    const contractorInProgress = String(u.contractorOnboardStatus || '').toLowerCase() === 'in progress';
    if (employeeInProgress || contractorInProgress) {
      const typeLabel =
        String(u.onboardingType || '').toLowerCase() === 'contractor' || contractorInProgress
          ? 'Contractor'
          : 'Employee';
      return {
        label: `Onboarding (${typeLabel})`,
        color: 'warning',
        sx: { bgcolor: '#E4572E', color: '#FFFFFF' },
      };
    }

    // Fall back to security-level-based lifecycle label
    switch (u.securityLevel) {
      case '4':
        return { label: 'Hired', color: 'success' };
      case '3':
        return { label: 'Candidate', color: 'primary' };
      case '2':
        return { label: 'Applicant', color: 'info' };
      case '1':
        return { label: 'Dismissed', color: 'default' };
      case '0':
        return { label: 'Suspended', color: 'error' };
      default:
        return { label: u.securityLevel, color: 'default' };
    }
  };

  const formatDate = (timestamp: any) => {
    if (!timestamp) return 'N/A';
    let date: Date;
    if (timestamp instanceof Date) {
      date = timestamp;
    } else if (typeof timestamp === 'number') {
      date = new Date(timestamp);
    } else if (timestamp?.toDate) {
      date = timestamp.toDate();
    } else if (timestamp?._seconds) {
      date = new Date(timestamp._seconds * 1000);
    } else {
      return 'N/A';
    }

    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const renderAiScore = (user: RecruiterUser) => {
    const score =
      user.scoreSummary?.aiScore ??
      user.aiJobFitScore ??
      user.aiProfileScore;
    if (score === undefined || score === null || Number.isNaN(score)) {
      return <Typography variant="body2" color="text.secondary">N/A</Typography>;
    }

    let color: 'default' | 'success' | 'warning' | 'error' = 'default';
    if (score >= 80) color = 'success';
    else if (score >= 60) color = 'warning';
    else color = 'default';

    return (
      <Tooltip
        arrow
        title={
          <Box sx={{ p: 0.5 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
              Score Summary
            </Typography>
            <Stack spacing={0.25}>
              <Typography variant="body2">
                AI: <strong>{Math.round(score)}</strong>
              </Typography>
              <Typography variant="body2">
                Interview: <strong>{formatOneDecimal(user.scoreSummary?.interviewAvg)}</strong>/10
                {user.scoreSummary?.interviewCount ? ` (${user.scoreSummary.interviewCount})` : ''}
              </Typography>
              <Typography variant="body2">
                Reviews: <strong>{formatOneDecimal(user.scoreSummary?.reviewAvg)}</strong>/5
                {user.scoreSummary?.reviewCount ? ` (${user.scoreSummary.reviewCount})` : ''}
              </Typography>
            </Stack>
          </Box>
        }
      >
        <Chip
          icon={<InsightsIcon sx={{ fontSize: 16 }} />}
          label={`${Math.round(score)}`}
          color={color}
          size="small"
          variant={color === 'default' ? 'outlined' : 'filled'}
          sx={{ minWidth: 96, justifyContent: 'flex-start' }}
        />
      </Tooltip>
    );
  };

  const uniqueSkills = useMemo(() => {
    const set = new Set<string>();
    users.forEach((user) => {
      user.skills?.forEach((skill) => set.add(skill));
    });
    return Array.from(set).sort();
  }, [users]);

  const filteredUsers = useMemo(() => {
    return users
      .filter((user) => {
        if (showFavoritesOnly && !favorites.includes(user.id)) {
          return false;
        }

        if (securityLevelFilter !== 'all') {
          const onboardingType = String(user.onboardingType || '').toLowerCase();
          const employeeStatus = String(user.employeeOnboardStatus || '').toLowerCase();
          const contractorStatus = String(user.contractorOnboardStatus || '').toLowerCase();

          const isEmployee =
            onboardingType === 'employee' ||
            employeeStatus === 'in progress' ||
            employeeStatus === 'completed';
          const isContractor =
            onboardingType === 'contractor' ||
            contractorStatus === 'in progress' ||
            contractorStatus === 'completed';

          const isActiveEmployee = user.securityLevel === '4' && isEmployee;
          const isActiveContractor = user.securityLevel === '4' && isContractor;

          if (securityLevelFilter === 'active_employee') {
            if (!isActiveEmployee) return false;
          } else if (securityLevelFilter === 'active_contractor') {
            if (!isActiveContractor) return false;
          } else if (user.securityLevel !== securityLevelFilter) {
            // Back-compat: allow older cached values like "4"
            return false;
          }
        }

        if (groupFilter !== 'all' && !user.userGroupIds.includes(groupFilter)) {
          return false;
        }

        if (skillFilter !== 'all') {
          return user.skills?.includes(skillFilter);
        }

        if (stateFilter !== 'all' && user.state !== stateFilter) {
          return false;
        }

        if (!searchTerm) {
          return true;
        }

        const search = searchTerm.toLowerCase();
        return (
          `${user.firstName} ${user.lastName}`.toLowerCase().includes(search) ||
          user.email.toLowerCase().includes(search) ||
          user.phone?.toLowerCase().includes(search) ||
          user.skills?.some((skill) => skill.toLowerCase().includes(search))
        );
      })
      .sort((a, b) => {
        switch (sortBy) {
          case 'recentlyUpdated': {
            // For desc (newest first): (b - a) gives positive when b is newer, which puts b before a ✓
            // For asc (oldest first): (a - b) gives negative when b is newer, which puts a before b ✓
            const diff = getUpdatedMillis(b) - getUpdatedMillis(a);
            return sortDirection === 'desc' ? diff : -diff;
          }
          case 'lastLogin': {
            const diff = getLoginMillis(b) - getLoginMillis(a);
            return sortDirection === 'desc' ? diff : -diff;
          }
          case 'accountCreated': {
            // For desc (newest first): (b - a) gives positive when b is newer, which puts b before a ✓
            // For asc (oldest first): (a - b) gives negative when b is newer, which puts a before b ✓
            const diff = getCreatedMillis(b) - getCreatedMillis(a);
            return sortDirection === 'desc' ? diff : -diff;
          }
          case 'name': {
            const nameCompare = `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`);
            return sortDirection === 'asc' ? nameCompare : -nameCompare;
          }
          case 'aiScore': {
            const aScore = a.aiJobFitScore ?? a.aiProfileScore ?? -1;
            const bScore = b.aiJobFitScore ?? b.aiProfileScore ?? -1;
            const diff = (bScore ?? -1) - (aScore ?? -1);
            return sortDirection === 'desc' ? diff : -diff;
          }
          case 'interview': {
            const diff = getInterviewMillis(b) - getInterviewMillis(a);
            return sortDirection === 'desc' ? diff : -diff;
          }
          default:
            return 0;
        }
      });
  }, [
    favorites,
    groupFilter,
    searchTerm,
    securityLevelFilter,
    showFavoritesOnly,
    skillFilter,
    stateFilter,
    sortBy,
    sortDirection,
    users,
  ]);

  const paginatedUsers = useMemo(() => {
    const start = page * rowsPerPage;
    const end = start + rowsPerPage;
    return filteredUsers.slice(start, end);
  }, [filteredUsers, page, rowsPerPage]);

  // If user paginates beyond what's loaded, auto-fetch more in the background
  useEffect(() => {
    if (!activeTenant?.id) return;
    if (!hasMore || loadingMore) return;
    const needed = (page + 1) * rowsPerPage;
    if (needed > users.length) {
      loadMoreUsers();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, rowsPerPage, users.length, hasMore, loadingMore, activeTenant?.id]);

  if (error) {
    return (
      <Alert severity="error" sx={{ maxWidth: 640 }}>
        {error}
      </Alert>
    );
  }

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <PageHeader
        title={
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: 2 }}>
            <Typography
              variant="h6"
              sx={{
                fontSize: { xs: '20px', md: '24px' },
                fontWeight: 600,
                lineHeight: 1.2,
              }}
            >
              Users
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexShrink: 0 }}>
              <InboxSearchBar
                value={searchTerm}
                onChange={handleSearchChange}
                onSearch={handleSearchChange}
                placeholder="Search users..."
              />
              
              {/* Favorites filter */}
              <FavoritesFilter
                favoriteType="users"
                showFavoritesOnly={showFavoritesOnly}
                onToggle={handleFavoritesToggle}
                showText={false}
                size="small"
                sx={{
                  minWidth: '32px',
                  width: '32px',
                  height: '32px',
                  borderRadius: '50%',
                  '&:hover': {
                    backgroundColor: showFavoritesOnly ? 'primary.dark' : 'action.hover',
                  },
                }}
              />
            </Box>
          </Box>
        }
      />
      
      <Box
        ref={contentRef}
        sx={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          overflowX: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Filter & Toolbar Area */}
        <Box
          ref={filtersRef}
          sx={{ 
            mt: 0,
            mb: 0,
            px: 1.5,
            py: 1.25,
            backgroundColor: '#F9FAFB',
            borderRadius: 0,
            border: '1px solid #E5E7EB',
            borderBottom: '1px solid #EAEEF4',
            overflowX: 'auto',
            overflowY: 'hidden',
            position: 'sticky',
            top: 0,
            zIndex: 15,
          }}
        >
          <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'nowrap', minWidth: 'max-content' }}>
            <FormControl size="small" sx={{ minWidth: 160, height: 36 }}>
              <InputLabel sx={{ fontSize: '0.875rem' }}>Status</InputLabel>
              <Select
                label="Status"
                value={securityLevelFilter}
                onChange={(event: SelectChangeEvent<SecurityLevel>) => {
                  const newFilter = event.target.value as SecurityLevel;
                  setSecurityLevelFilter(newFilter);
                  updateCache({ securityLevelFilter: newFilter });
                }}
                sx={{
                  height: 36,
                  borderRadius: '6px',
                  backgroundColor: 'white',
                  fontSize: '0.875rem',
                }}
              >
                <MenuItem value="all">All Statuses</MenuItem>
                <MenuItem value="active_contractor">Active Contractors</MenuItem>
                <MenuItem value="active_employee">Active Employees</MenuItem>
                <MenuItem value="3">Candidate</MenuItem>
                <MenuItem value="2">Applicant</MenuItem>
                <MenuItem value="1">Dismissed</MenuItem>
                <MenuItem value="0">Suspended</MenuItem>
              </Select>
            </FormControl>

            <Autocomplete
              size="small"
              options={groups}
              getOptionLabel={(option) => option.title || option.id || 'Unnamed Group'}
              value={groupFilter === 'all' ? null : groups.find(g => g.id === groupFilter) || null}
              onChange={(_, newValue) => {
                const newFilter = newValue ? newValue.id : 'all';
                setGroupFilter(newFilter);
                updateCache({ groupFilter: newFilter });
              }}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="User Group"
                  placeholder="Search groups..."
                  sx={{ minWidth: 160 }}
                />
              )}
            />

            <Autocomplete
              size="small"
              options={uniqueSkills}
              value={skillFilter === 'all' ? null : skillFilter}
              onChange={(_, newValue) => {
                const newFilter = newValue || 'all';
                setSkillFilter(newFilter);
                updateCache({ skillFilter: newFilter });
              }}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Primary Skill"
                  placeholder="Search skills..."
                  sx={{ minWidth: 160 }}
                />
              )}
            />

            {/* State Filter */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <FormControl size="small" sx={{ minWidth: 160, height: 36 }}>
                <InputLabel sx={{ fontSize: '0.875rem' }}>State Filter</InputLabel>
                <Select
                  value={stateFilter}
                  onChange={(e) => {
                    const newFilter = String(e.target.value);
                    setStateFilter(newFilter);
                    updateCache({ stateFilter: newFilter });
                  }}
                  label="State Filter"
                  sx={{
                    height: 36,
                    borderRadius: '6px',
                    backgroundColor: 'white',
                    fontSize: '0.875rem',
                  }}
                >
                  <MenuItem value="all">All States</MenuItem>
                  {['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'].map((st) => (
                    <MenuItem key={st} value={st}>{st}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              <IconButton
                size="small"
                aria-label="Clear state filter"
                onClick={() => {
                  setStateFilter('all');
                  updateCache({ stateFilter: 'all' });
                }}
                disabled={stateFilter === 'all'}
                sx={{ height: 36, width: 36, p: 0.75 }}
              >
                <ClearIcon fontSize="small" />
              </IconButton>
            </Box>

            <FormControl size="small" sx={{ minWidth: 180, height: 36 }}>
              <InputLabel sx={{ fontSize: '0.875rem' }}>Sort By</InputLabel>
              <Select
                label="Sort By"
                value={sortBy}
                onChange={(event) => {
                  const newSortBy = event.target.value as typeof sortBy;
                  setSortBy(newSortBy);
                  updateCache({ sortBy: newSortBy });
                }}
                sx={{
                  height: 36,
                  borderRadius: '6px',
                  backgroundColor: 'white',
                  fontSize: '0.875rem',
                }}
              >
                <MenuItem value="accountCreated">Account Creation (Newest)</MenuItem>
                <MenuItem value="recentlyUpdated">Recently Updated</MenuItem>
                <MenuItem value="lastLogin">Last Login</MenuItem>
                <MenuItem value="aiScore">AI Score</MenuItem>
                <MenuItem value="name">Name (A-Z)</MenuItem>
              </Select>
            </FormControl>
          </Box>
        </Box>

        {/* Initial loading indicator */}
        {loading && users.length === 0 && (
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 200, py: 4 }}>
            <CircularProgress size={24} />
          </Box>
        )}

        {!loading || users.length > 0 ? (
          <>
          <Box sx={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            {/* Loading overlay */}
            {loading && users.length > 0 && (
              <Box
                sx={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  backgroundColor: 'rgba(255, 255, 255, 0.8)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  zIndex: 1000,
                  borderRadius: '8px',
                }}
              >
                <CircularProgress size={40} />
              </Box>
            )}
            
            {/* No Results Found message */}
            {!loading && filteredUsers.length === 0 && (
              <Box
                sx={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  zIndex: 999,
                  flexDirection: 'column',
                  gap: 2,
                }}
              >
                <Typography variant="h6" color="text.secondary" sx={{ fontWeight: 500 }}>
                  No Results Found
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Try adjusting your search or filters
                </Typography>
              </Box>
            )}
            
          <TableContainer
            component={Paper}
            elevation={0}
            sx={{
              borderRadius: 2,
              border: '1px solid #EAEEF4',
              position: 'relative',
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0,
              overflowY: 'auto',
              overflowX: 'auto',
              width: '100%',
              px: 2, // 16px padding left and right
              '&::-webkit-scrollbar': { width: '8px', height: '8px' },
              '&::-webkit-scrollbar-track': {
                background: 'rgba(0, 0, 0, 0.02)',
                borderRadius: '4px',
              },
              '&::-webkit-scrollbar-thumb': {
                background: 'rgba(0, 0, 0, 0.15)',
                borderRadius: '4px',
                '&:hover': { background: 'rgba(0, 0, 0, 0.25)' },
              },
              scrollbarWidth: 'thin',
              scrollbarColor: 'rgba(0, 0, 0, 0.15) rgba(0, 0, 0, 0.02)',
            }}
          >
        <Table size="small" stickyHeader sx={{ width: '100%' }}>
          <TableHead
            sx={{
              position: 'sticky',
              top: 0,
              zIndex: 10,
              backgroundColor: 'background.paper',
              borderRadius: 0,
              '& .MuiTableCell-root': {
                borderRadius: 0,
              },
            }}
          >
            <TableRow sx={{ backgroundColor: 'background.paper', borderRadius: 0 }}>
                <TableCell sx={{ width: 60, bgcolor: '#FFFFFF', borderRadius: 0 }} />
                <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem', borderRadius: 0 }}>
                  <TableSortLabel
                    active={sortBy === 'name'}
                    direction={sortBy === 'name' ? sortDirection : 'asc'}
                    onClick={() => handleSort('name')}
                  >
                    Person
                  </TableSortLabel>
                </TableCell>
                <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem', borderRadius: 0 }}>
                  Contact
                </TableCell>
                <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem', borderRadius: 0 }}>
                  Work Status
                </TableCell>
                <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem', borderRadius: 0 }}>
                  <TableSortLabel
                    active={sortBy === 'aiScore'}
                    direction={sortBy === 'aiScore' ? sortDirection : 'desc'}
                    onClick={() => handleSort('aiScore')}
                  >
                    Score
                  </TableSortLabel>
                </TableCell>
                <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem', borderRadius: 0 }}>
                  <TableSortLabel
                    active={sortBy === 'interview'}
                    direction={sortBy === 'interview' ? sortDirection : 'desc'}
                    onClick={() => handleSort('interview')}
                  >
                    Interview
                  </TableSortLabel>
                </TableCell>
                <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem', borderRadius: 0 }}>
                  Groups
                </TableCell>
                <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem', borderRadius: 0 }}>
                  Skills
                </TableCell>
                <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem', minWidth: 200, borderRadius: 0 }}>
                  <TableSortLabel
                    active={sortBy === 'lastLogin'}
                    direction={sortBy === 'lastLogin' ? sortDirection : 'desc'}
                    onClick={() => handleSort('lastLogin')}
                  >
                    Last Login
                  </TableSortLabel>
                </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {paginatedUsers.map((user, index) => (
              <TableRow
                key={user.id}
                hover
                sx={{
                  cursor: 'pointer',
                  backgroundColor: index % 2 === 0 ? 'background.paper' : 'action.hover',
                  '&:hover': {
                    backgroundColor: 'action.selected',
                  },
                }}
                onClick={() => navigate(`/users/${user.id}`)}
              >
                  <TableCell onClick={(event) => event.stopPropagation()}>
                    <FavoriteButton
                      itemId={user.id}
                      favoriteType="users"
                      isFavorite={isFavorite}
                      toggleFavorite={toggleFavorite}
                      size="small"
                      tooltipText={{
                        favorited: 'Remove from favorites',
                        notFavorited: 'Add to favorites',
                      }}
                    />
                  </TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <Avatar
                        src={user.avatar}
                        alt={`${user.firstName} ${user.lastName}`}
                        sx={{ width: TABLE_AVATAR_SIZE, height: TABLE_AVATAR_SIZE }}
                      >
                        {user.firstName?.[0]}
                      </Avatar>
                      <Box>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {user.firstName} {user.lastName}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          #{user.id.slice(-6)}
                        </Typography>
                        {user.createdAt && (
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
                            {formatDate(user.createdAt)}
                          </Typography>
                        )}
                      </Box>
                    </Box>
                  </TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <EmailIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                        <Typography variant="body2" sx={{ fontSize: '0.85rem' }}>
                          {user.email}
                        </Typography>
                      </Box>
                      {user.phone && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          <PhoneIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                          <Typography variant="body2" sx={{ fontSize: '0.85rem' }}>
                            {formatPhoneNumber(user.phone)}
                          </Typography>
                        </Box>
                      )}
                    </Box>
                  </TableCell>
                  <TableCell>
                    {(() => {
                      const ws = getWorkStatusDisplay(user);
                      return (
                        <Chip
                          size="small"
                          label={ws.label}
                          color={ws.color}
                          sx={ws.sx}
                        />
                      );
                    })()}
                  </TableCell>
                  <TableCell>{renderAiScore(user)}</TableCell>
                  <TableCell>
                    {(() => {
                      const lastAt = user.scoreSummary?.interviewLastAt;
                      const lastScore = user.scoreSummary?.interviewLastScore10;
                      if (!lastAt || typeof lastScore !== 'number' || Number.isNaN(lastScore)) return null;
                      return (
                        <Typography variant="body2">
                          {formatDate(lastAt)} — {formatOneDecimal(lastScore)}/10
                        </Typography>
                      );
                    })()}
                  </TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                      {user.userGroupIds.length === 0 && (
                        <Typography variant="body2" color="text.secondary">
                          —
                        </Typography>
                      )}
                      {user.userGroupIds.slice(0, 3).map((groupId) => {
                        const group = groupLookup.get(groupId);
                        return (
                          <Chip
                            key={groupId}
                            size="small"
                            icon={<GroupIcon sx={{ fontSize: 14 }} />}
                            label={group?.title || groupId}
                            variant="outlined"
                          />
                        );
                      })}
                      {user.userGroupIds.length > 3 && (
                        <Chip
                          size="small"
                          label={`+${user.userGroupIds.length - 3} more`}
                          variant="outlined"
                        />
                      )}
                    </Box>
                  </TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                      {user.skills?.slice(0, 3).map((skill) => (
                        <Chip
                          key={skill}
                          label={skill}
                          size="small"
                          variant="outlined"
                          icon={<StarIcon sx={{ fontSize: 14 }} />}
                        />
                      ))}
                      {user.skills?.length === 0 && (
                        <Typography variant="body2" color="text.secondary">
                          —
                        </Typography>
                      )}
                      {user.skills?.length > 3 && (
                        <Chip size="small" label={`+${user.skills.length - 3}`} variant="outlined" />
                      )}
                    </Box>
                  </TableCell>
                  <TableCell sx={{ minWidth: 200 }}>
                    <Typography variant="body2">{formatDate(user.lastLoginAt)}</Typography>
                  </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

          <StandardTablePagination
            count={filteredUsers.length}
            page={page}
            onPageChange={(_, newPage) => setPage(newPage)}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={(e) => {
              setRowsPerPage(parseInt(e.target.value, 10));
              setPage(0);
            }}
          />
          </Box>
          </>
        ) : null}
      </Box>
    </Box>
  );
};

const toMillis = (input: any): number => {
  if (!input) return 0;
  if (input instanceof Date) return input.getTime();
  if (typeof input === 'number') return input;
  if (typeof input === 'string') {
    const parsed = Date.parse(input);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  if (typeof input === 'object') {
    if (typeof input.toDate === 'function') {
      return input.toDate().getTime();
    }
    if (typeof input._seconds === 'number') {
      return input._seconds * 1000;
    }
  }
  return 0;
};

const getUpdatedMillis = (user: RecruiterUser) => toMillis(user.updatedAt) || toMillis(user.createdAt);
const getLoginMillis = (user: RecruiterUser) => toMillis(user.lastLoginAt) || toMillis(user.createdAt);
const getCreatedMillis = (user: RecruiterUser) => toMillis(user.createdAt);
const getInterviewMillis = (user: RecruiterUser) => toMillis(user.scoreSummary?.interviewLastAt);

export default RecruiterUsers;

