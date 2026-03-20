import React, { useEffect, useMemo, useState } from 'react';
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
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import EmailIcon from '@mui/icons-material/Email';
import PhoneIcon from '@mui/icons-material/Phone';
import StarIcon from '@mui/icons-material/Star';
import GroupIcon from '@mui/icons-material/Groups';
import InsightsIcon from '@mui/icons-material/Insights';
import { useNavigate, useParams } from 'react-router-dom';
import { doc, getDoc, getDocs, collection } from 'firebase/firestore';
import { SelectChangeEvent } from '@mui/material/Select';

import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { toChipLabel } from '../utils/chipLabel';
import { calculateProfileScore } from '../utils/applicantScoring';
import PageHeader from '../components/PageHeader';
import FavoriteButton from '../components/FavoriteButton';
import FavoritesFilter from '../components/FavoritesFilter';
import InboxSearchBar from '../components/InboxSearchBar';
import { useFavorites } from '../hooks/useFavorites';
import StandardTablePagination from '../components/StandardTablePagination';
import { TABLE_AVATAR_SIZE } from '../utils/uiConstants';
import { getWorkAuthorizedStatus, compareWorkAuthorized } from '../utils/workAuthorizedDisplay';
import WorkAuthorizedChip from '../components/WorkAuthorizedChip';

type SecurityLevel =
  | '0'
  | '1'
  | '2'
  | '3'
  | '4'
  | 'all';

interface RecruiterUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  avatar?: string;
  securityLevel: string;
  lastLoginAt?: any;
  updatedAt?: any;
  createdAt?: any;
  aiProfileScore?: number;
  aiJobFitScore?: number;
  userGroupIds: string[];
  skills: string[];
  workEligibility?: boolean;
  workEligibilityAttestation?: { authorizedToWorkUS?: boolean };
}

interface TenantUserGroup {
  id: string;
  title?: string;
  description?: string;
}

const RecruiterUserGroupDetails: React.FC = () => {
  const navigate = useNavigate();
  const { groupId } = useParams<{ groupId: string }>();
  const { activeTenant } = useAuth();

  const [group, setGroup] = useState<TenantUserGroup | null>(null);
  const [members, setMembers] = useState<RecruiterUser[]>([]);
  const [allGroups, setAllGroups] = useState<TenantUserGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [securityLevelFilter, setSecurityLevelFilter] = useState<SecurityLevel>('all');
  const [skillFilter, setSkillFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'recentlyUpdated' | 'lastLogin' | 'name' | 'aiScore' | 'auth'>('recentlyUpdated');
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [activeTab, setActiveTab] = useState<'members' | 'settings'>('members');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(20);

  const { favorites, isFavorite, toggleFavorite } = useFavorites('users');

  const tenantId = activeTenant?.id;

  useEffect(() => {
    if (!tenantId || !groupId) return;
    loadGroup();
    loadGroups();
  }, [tenantId, groupId]);

  useEffect(() => {
    if (!tenantId || !group?.id) return;
    loadMembers();
  }, [tenantId, group?.id]);

  const loadGroup = async () => {
    if (!tenantId || !groupId) return;
    setLoading(true);
    try {
      const groupRef = doc(db, 'tenants', tenantId, 'userGroups', groupId);
      const groupSnap = await getDoc(groupRef);
      if (groupSnap.exists()) {
        const data = groupSnap.data();
        setGroup({ id: groupId, ...data });
      } else {
        setError('Group not found');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load group');
    } finally {
      setLoading(false);
    }
  };

  const loadGroups = async () => {
    if (!tenantId) return;
    try {
      const groupsRef = collection(db, 'tenants', tenantId, 'userGroups');
      const snapshot = await getDocs(groupsRef);
      const groupsData = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })) as TenantUserGroup[];
      setAllGroups(groupsData);
    } catch (err) {
      console.error('Error loading groups:', err);
    }
  };

  const loadMembers = async () => {
    if (!tenantId || !group) return;
    setLoading(true);
    try {
      const groupData = group as any;
      const memberIds = groupData.memberIds || [];
      
      if (memberIds.length === 0) {
        setMembers([]);
        setLoading(false);
        return;
      }

      // Fetch users by their IDs
      const usersRef = collection(db, 'users');
      const usersSnapshot = await getDocs(usersRef);
      
      const allUsers = usersSnapshot.docs
        .map((doc) => ({ id: doc.id, ...doc.data() }))
        .filter((user: any) => {
          // Only include users with security levels 0-4 (not internal team)
          const securityLevel = user.securityLevel || user.tenantIds?.[tenantId]?.securityLevel || '0';
          return ['0', '1', '2', '3', '4'].includes(String(securityLevel)) && memberIds.includes(user.id);
        })
        .map((user: any) => {
          // Normalize skills to strings
          const rawSkills = user.skills || [];
          const normalizedSkills = rawSkills
            .map((skill: any) => {
              if (typeof skill === 'string') return skill;
              if (skill?.label) return skill.label;
              if (skill?.name) return skill.name;
              if (skill?.value) return skill.value;
              return null;
            })
            .filter((skill: string | null) => skill !== null);

          // Calculate AI profile score if not present
          const aiProfileScore =
            user.aiJobFitScore ?? user.aiProfileScore ?? calculateProfileScore(user);

          return {
            id: user.id,
            firstName: user.firstName || '',
            lastName: user.lastName || '',
            email: user.email || '',
            phone: user.phone || '',
            avatar: user.avatar,
            securityLevel: String(user.securityLevel || user.tenantIds?.[tenantId]?.securityLevel || '0'),
            lastLoginAt: user.lastLoginAt,
            updatedAt: user.updatedAt,
            createdAt: user.createdAt,
            aiProfileScore,
            userGroupIds: user.userGroupIds || [],
            skills: normalizedSkills,
            workEligibility: user.workEligibility,
            workEligibilityAttestation: user.workEligibilityAttestation,
          } as RecruiterUser;
        });

      setMembers(allUsers);
    } catch (err: any) {
      setError(err.message || 'Failed to load members');
    } finally {
      setLoading(false);
    }
  };

  const groupLookup = useMemo(() => {
    const map = new Map<string, TenantUserGroup>();
    allGroups.forEach((group) => map.set(group.id, group));
    return map;
  }, [allGroups]);

  const getSecurityLevelLabel = (level: string): string => {
    const labels: Record<string, string> = {
      '0': 'Suspended',
      '1': 'Dismissed',
      '2': 'Applicant',
      '3': 'Candidate',
      '4': 'Staff',
    };
    return labels[level] || 'Unknown';
  };

  const getSecurityLevelColor = (
    level: string,
  ): 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning' => {
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

  const uniqueSkills = useMemo(() => {
    const set = new Set<string>();
    members.forEach((user) => {
      user.skills?.forEach((skill) => set.add(skill));
    });
    return Array.from(set).sort();
  }, [members]);

  const filteredMembers = useMemo(() => {
    return members
      .filter((user) => {
        if (showFavoritesOnly && !favorites.includes(user.id)) {
          return false;
        }

        if (securityLevelFilter !== 'all' && user.securityLevel !== securityLevelFilter) {
          return false;
        }

        if (skillFilter !== 'all') {
          return user.skills?.includes(skillFilter);
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
            const aTime =
              a.updatedAt instanceof Date
                ? a.updatedAt.getTime()
                : typeof a.updatedAt === 'number'
                ? a.updatedAt
                : 0;
            const bTime =
              b.updatedAt instanceof Date
                ? b.updatedAt.getTime()
                : typeof b.updatedAt === 'number'
                ? b.updatedAt
                : 0;
            return bTime - aTime;
          }
          case 'lastLogin': {
            const aTime =
              a.lastLoginAt instanceof Date
                ? a.lastLoginAt.getTime()
                : typeof a.lastLoginAt === 'number'
                ? a.lastLoginAt
                : 0;
            const bTime =
              b.lastLoginAt instanceof Date
                ? b.lastLoginAt.getTime()
                : typeof b.lastLoginAt === 'number'
                ? b.lastLoginAt
                : 0;
            return bTime - aTime;
          }
          case 'name':
            return `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`);
          case 'aiScore': {
            const aScore = a.aiJobFitScore ?? a.aiProfileScore ?? -1;
            const bScore = b.aiJobFitScore ?? b.aiProfileScore ?? -1;
            return (bScore ?? -1) - (aScore ?? -1);
          }
          case 'auth': {
            const aStatus = getWorkAuthorizedStatus(a);
            const bStatus = getWorkAuthorizedStatus(b);
            return compareWorkAuthorized(aStatus, bStatus);
          }
          default:
            return 0;
        }
      });
  }, [
    favorites,
    members,
    searchTerm,
    securityLevelFilter,
    showFavoritesOnly,
    skillFilter,
    sortBy,
  ]);

  useEffect(() => {
    setPage(0);
  }, [searchTerm, securityLevelFilter, skillFilter, sortBy, showFavoritesOnly]);

  const paginatedMembers = useMemo(() => {
    const start = page * rowsPerPage;
    return filteredMembers.slice(start, start + rowsPerPage);
  }, [filteredMembers, page, rowsPerPage]);

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
    const score = user.aiJobFitScore ?? user.aiProfileScore;
    if (score === undefined || score === null || Number.isNaN(score)) {
      return <Typography variant="body2" color="text.secondary">N/A</Typography>;
    }

    let color: 'default' | 'success' | 'warning' | 'error' = 'default';
    if (score >= 80) color = 'success';
    else if (score >= 60) color = 'warning';
    else color = 'default';

    return (
      <Chip
        icon={<InsightsIcon sx={{ fontSize: 16 }} />}
        label={`${Math.round(score)}`}
        color={color}
        size="small"
        variant={color === 'default' ? 'outlined' : 'filled'}
        sx={{ minWidth: 96, justifyContent: 'flex-start' }}
      />
    );
  };

  if (loading && !group) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 320 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Alert severity="error" sx={{ maxWidth: 640 }}>
        {error}
      </Alert>
    );
  }

  if (!group) {
    return (
      <Alert severity="info" sx={{ maxWidth: 640 }}>
        Group not found
      </Alert>
    );
  }

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      <PageHeader
        title={
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2.5 }}>
            <Avatar
              sx={{
                width: 108,
                height: 108,
                bgcolor: 'primary.main',
                fontSize: '40px',
                fontWeight: 700,
                flexShrink: 0,
              }}
            >
              {(group.title || 'G').trim().charAt(0).toUpperCase()}
            </Avatar>
            <Box sx={{ flex: 1, minWidth: 0, minHeight: 108, display: 'flex', flexDirection: 'column' }}>
              <Typography
                variant="h6"
                sx={{
                  fontSize: { xs: '20px', md: '24px' },
                  fontWeight: 600,
                  lineHeight: 1.2,
                }}
              >
                {group.title || 'Untitled Group'}
              </Typography>
              {group.description && (
                <Typography sx={{ fontSize: '0.875rem', color: 'rgba(0,0,0,0.55)', mt: 0.75 }}>
                  {group.description}
                </Typography>
              )}
              <Typography sx={{ fontSize: '0.875rem', color: 'rgba(0,0,0,0.55)', mt: 0.75 }}>
                {members.length} member{members.length === 1 ? '' : 's'} • ID: {group.id.slice(0, 8)}
              </Typography>
            </Box>
          </Box>
        }
        filters={
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            {[
              { label: 'Members', value: 'members' as const },
              { label: 'Settings', value: 'settings' as const },
            ].map((t) => {
              const isActive = activeTab === t.value;
              return (
                <Button
                  key={t.value}
                  onClick={() => setActiveTab(t.value)}
                  variant="text"
                  sx={{
                    textTransform: 'none',
                    borderRadius: '999px',
                    fontSize: '14px',
                    fontWeight: isActive ? 500 : 400,
                    color: isActive ? 'white' : 'rgba(0, 0, 0, 0.7)',
                    bgcolor: isActive ? '#0057B8' : 'rgba(0, 0, 0, 0.04)',
                    px: 1.5,
                    py: 0.75,
                    minWidth: 'auto',
                    whiteSpace: 'nowrap',
                    '&:hover': {
                      bgcolor: isActive ? '#004a9f' : 'rgba(0, 0, 0, 0.08)',
                    },
                  }}
                >
                  {t.label}
                </Button>
              );
            })}
          </Box>
        }
        rightActions={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            {activeTab === 'members' && (
              <>
                <FavoritesFilter
                  favoriteType="users"
                  showFavoritesOnly={showFavoritesOnly}
                  onToggle={setShowFavoritesOnly}
                  showText={false}
                  size="small"
                  sx={{
                    minWidth: '36px',
                    width: '36px',
                    height: '36px',
                    borderRadius: '50%',
                    '&:hover': {
                      backgroundColor: showFavoritesOnly ? 'primary.dark' : 'action.hover',
                    },
                  }}
                />
                <InboxSearchBar
                  value={searchTerm}
                  onChange={setSearchTerm}
                  onSearch={setSearchTerm}
                  placeholder="Search people..."
                />
              </>
            )}

            <Button
              variant="outlined"
              onClick={() => navigate('/recruiter/user-groups')}
              sx={{
                textTransform: 'none',
                borderRadius: '24px',
                height: '40px',
                px: 2,
                whiteSpace: 'nowrap',
              }}
            >
              Back
            </Button>
          </Box>
        }
      />

      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}>
        {activeTab === 'settings' ? (
          <Box sx={{ p: 2 }}>
            <Paper elevation={0} sx={{ borderRadius: 2, border: '1px solid #EAEEF4', p: 2 }}>
              <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>
                Group Settings
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Title: {group.title || 'Untitled Group'}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Description: {group.description || '—'}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Members: {members.length}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Group ID: {group.id}
              </Typography>
            </Paper>
          </Box>
        ) : (
          <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            {/* Member filters */}
            <Box
              sx={{
                mb: 2,
                p: 1.5,
                backgroundColor: '#F9FAFB',
                borderRadius: '8px',
                border: '1px solid #E5E7EB',
                borderBottom: '1px solid #D1D5DB',
              }}
            >
              <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
                <FormControl size="small" sx={{ minWidth: 160 }}>
                  <InputLabel>Role</InputLabel>
                  <Select
                    label="Role"
                    value={securityLevelFilter}
                    onChange={(event: SelectChangeEvent<SecurityLevel>) =>
                      setSecurityLevelFilter(event.target.value as SecurityLevel)
                    }
                  >
                    <MenuItem value="all">All Roles</MenuItem>
                    <MenuItem value="4">Staff</MenuItem>
                    <MenuItem value="3">Candidate</MenuItem>
                    <MenuItem value="2">Applicant</MenuItem>
                    <MenuItem value="1">Dismissed</MenuItem>
                    <MenuItem value="0">Suspended</MenuItem>
                  </Select>
                </FormControl>

                <Autocomplete
                  size="small"
                  options={uniqueSkills}
                  value={skillFilter === 'all' ? null : skillFilter}
                  onChange={(_, newValue) => setSkillFilter(newValue || 'all')}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Primary Skill"
                      placeholder="Search skills..."
                      sx={{ minWidth: 160 }}
                    />
                  )}
                />

                <FormControl size="small" sx={{ minWidth: 180 }}>
                  <InputLabel>Sort By</InputLabel>
                  <Select
                    label="Sort By"
                    value={sortBy}
                    onChange={(event) => setSortBy(event.target.value as typeof sortBy)}
                  >
                    <MenuItem value="recentlyUpdated">Recently Updated</MenuItem>
                    <MenuItem value="lastLogin">Last Login</MenuItem>
                    <MenuItem value="aiScore">AI Score</MenuItem>
                    <MenuItem value="name">Name (A-Z)</MenuItem>
                    <MenuItem value="auth">Work Authorized</MenuItem>
                  </Select>
                </FormControl>
              </Box>
            </Box>

            {/* Members Table */}
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
                <TableHead sx={{ position: 'sticky', top: 0, zIndex: 10, backgroundColor: '#FFFFFF' }}>
                  <TableRow sx={{ backgroundColor: '#FFFFFF' }}>
                    <TableCell sx={{ width: 60, bgcolor: '#FFFFFF' }} />
                    <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem' }}>
                      Person
                    </TableCell>
                    <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem' }}>
                      Contact
                    </TableCell>
                    <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem' }}>
                      Auth
                    </TableCell>
                    <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem' }}>
                      Role
                    </TableCell>
                    <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem' }}>
                      Profile Score
                    </TableCell>
                    <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem' }}>
                      Groups
                    </TableCell>
                    <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem' }}>
                      Skills
                    </TableCell>
                    <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem' }}>
                      Last Login
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {paginatedMembers.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={9} sx={{ textAlign: 'center', py: 4 }}>
                        <Typography variant="body2" color="text.secondary">
                          {members.length === 0 ? 'No members in this group.' : 'No members match your filters.'}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ) : (
                    paginatedMembers.map((user, index) => (
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
                                  {user.phone}
                                </Typography>
                              </Box>
                            )}
                          </Box>
                        </TableCell>
                        <TableCell>
                          <WorkAuthorizedChip status={getWorkAuthorizedStatus(user)} />
                        </TableCell>
                        <TableCell>
                          <Chip
                            size="small"
                            label={getSecurityLevelLabel(user.securityLevel)}
                            color={getSecurityLevelColor(user.securityLevel)}
                          />
                        </TableCell>
                        <TableCell>{renderAiScore(user)}</TableCell>
                        <TableCell>
                          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                            {user.userGroupIds.length === 0 && (
                              <Typography variant="body2" color="text.secondary">
                                —
                              </Typography>
                            )}
                            {user.userGroupIds.slice(0, 3).map((gid) => {
                              const g = groupLookup.get(gid);
                              return (
                                <Chip
                                  key={gid}
                                  size="small"
                                  icon={<GroupIcon sx={{ fontSize: 14 }} />}
                                  label={g?.title || gid}
                                  variant="outlined"
                                />
                              );
                            })}
                            {user.userGroupIds.length > 3 && (
                              <Chip size="small" label={`+${user.userGroupIds.length - 3} more`} variant="outlined" />
                            )}
                          </Box>
                        </TableCell>
                        <TableCell>
                          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                            {user.skills?.slice(0, 3).map((skill, i) => (
                              <Chip
                                key={`${toChipLabel(skill)}-${i}`}
                                label={toChipLabel(skill)}
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
                        <TableCell>
                          <Typography variant="body2">{formatDate(user.lastLoginAt)}</Typography>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </TableContainer>

            <StandardTablePagination
              count={filteredMembers.length}
              page={page}
              onPageChange={(_e, newPage) => setPage(newPage)}
              rowsPerPage={rowsPerPage}
              onRowsPerPageChange={(e) => {
                setRowsPerPage(parseInt(e.target.value, 10));
                setPage(0);
              }}
            />
          </Box>
        )}
      </Box>
    </Box>
  );
};

export default RecruiterUserGroupDetails;

