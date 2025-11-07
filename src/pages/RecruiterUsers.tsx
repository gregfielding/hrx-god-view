import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Avatar,
  Box,
  Chip,
  CircularProgress,
  FormControl,
  InputAdornment,
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
import SearchIcon from '@mui/icons-material/Search';
import EmailIcon from '@mui/icons-material/Email';
import PhoneIcon from '@mui/icons-material/Phone';
import StarIcon from '@mui/icons-material/Star';
import GroupIcon from '@mui/icons-material/Groups';
import InsightsIcon from '@mui/icons-material/Insights';
import { useNavigate } from 'react-router-dom';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { SelectChangeEvent } from '@mui/material/Select';

import FavoriteButton from '../components/FavoriteButton';
import FavoritesFilter from '../components/FavoritesFilter';
import { useFavorites } from '../hooks/useFavorites';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';

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
}

interface TenantUserGroup {
  id: string;
  title?: string;
  description?: string;
}

const RecruiterUsers: React.FC = () => {
  const navigate = useNavigate();
  const { activeTenant } = useAuth();

  const [users, setUsers] = useState<RecruiterUser[]>([]);
  const [groups, setGroups] = useState<TenantUserGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [securityLevelFilter, setSecurityLevelFilter] = useState<SecurityLevel>('all');
  const [groupFilter, setGroupFilter] = useState<string>('all');
  const [skillFilter, setSkillFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'recentlyUpdated' | 'lastLogin' | 'name' | 'aiScore'>('recentlyUpdated');
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);

  const { favorites, isFavorite, toggleFavorite } = useFavorites('users');

  const groupLookup = useMemo(() => {
    const map = new Map<string, TenantUserGroup>();
    groups.forEach((group) => map.set(group.id, group));
    return map;
  }, [groups]);

  useEffect(() => {
    if (!activeTenant?.id) return;

    loadGroups(activeTenant.id);
    loadUsers(activeTenant.id);
  }, [activeTenant?.id]);

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

  const loadUsers = async (tenantId: string) => {
    setLoading(true);
    setError(null);

    try {
      const usersRef = collection(db, 'users');
      const q = query(
        usersRef,
        where(`tenantIds.${tenantId}.securityLevel`, 'in', ['0', '1', '2', '3', '4'])
      );

      const snapshot = await getDocs(q);
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
          lastLoginAt: userData.lastLoginAt,
          updatedAt: userData.updatedAt,
          createdAt: userData.createdAt,
          aiProfileScore:
            tenantData.aiProfileScore ??
            userData.aiProfileScore ??
            userData.aiScore ??
            userData.aiProfile?.score,
          aiJobFitScore: tenantData.aiJobFitScore ?? userData.aiJobFitScore,
          userGroupIds: tenantData.userGroupIds || userData.userGroupIds || [],
          skills: normalizedSkills,
        };
      });

      setUsers(data);
    } catch (err) {
      console.error('RecruiterUsers: Failed to load users', err);
      setError('Unable to load users. Please try again.');
    } finally {
      setLoading(false);
    }
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
        label={`${Math.round(score)} / 100`}
        color={color}
        size="small"
        variant={color === 'default' ? 'outlined' : 'filled'}
        sx={{ minWidth: 96, justifyContent: 'flex-start' }}
      />
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

        if (securityLevelFilter !== 'all' && user.securityLevel !== securityLevelFilter) {
          return false;
        }

        if (groupFilter !== 'all' && !user.userGroupIds.includes(groupFilter)) {
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
    sortBy,
    users,
  ]);

  if (loading) {
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

  return (
    <Box>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" component="h1" sx={{ fontWeight: 600 }}>
          All Users
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Search, filter, and compare everyone in your talent network.
        </Typography>
      </Box>

      <Box
        sx={{
          mb: 3,
          display: 'flex',
          flexWrap: 'wrap',
          gap: 2,
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <TextField
          placeholder="Search people..."
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          variant="outlined"
          size="small"
          sx={{
            flexGrow: 1,
            minWidth: 280,
            maxWidth: 480,
            '& .MuiOutlinedInput-root': {
              borderRadius: '8px',
              backgroundColor: 'white',
            },
          }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon sx={{ color: 'text.secondary' }} />
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
                />
              </InputAdornment>
            ),
          }}
        />

        <FormControl size="small" sx={{ minWidth: 160 }}>
          <InputLabel>Security Level</InputLabel>
          <Select
            label="Security Level"
            value={securityLevelFilter}
            onChange={(event: SelectChangeEvent<SecurityLevel>) =>
              setSecurityLevelFilter(event.target.value as SecurityLevel)
            }
          >
            <MenuItem value="all">All Levels</MenuItem>
            <MenuItem value="4">Staff</MenuItem>
            <MenuItem value="3">Candidate</MenuItem>
            <MenuItem value="2">Applicant</MenuItem>
            <MenuItem value="1">Dismissed</MenuItem>
            <MenuItem value="0">Suspended</MenuItem>
          </Select>
        </FormControl>

        <FormControl size="small" sx={{ minWidth: 160 }}>
          <InputLabel>User Group</InputLabel>
          <Select
            label="User Group"
            value={groupFilter}
            onChange={(event) => setGroupFilter(event.target.value)}
          >
            <MenuItem value="all">All Groups</MenuItem>
            {groups.map((group) => (
              <MenuItem key={group.id} value={group.id}>
                {group.title || group.id}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <FormControl size="small" sx={{ minWidth: 160 }}>
          <InputLabel>Primary Skill</InputLabel>
          <Select
            label="Primary Skill"
            value={skillFilter}
            onChange={(event) => setSkillFilter(event.target.value)}
          >
            <MenuItem value="all">All Skills</MenuItem>
            {uniqueSkills.map((skill) => (
              <MenuItem key={skill} value={skill}>
                {skill}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

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
          </Select>
        </FormControl>
      </Box>

      <Paper elevation={0} sx={{ borderRadius: 2, overflow: 'hidden', border: '1px solid #EAEEF4' }}>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: 60 }} />
                <TableCell sx={{ fontWeight: 600, textTransform: 'uppercase', fontSize: '0.75rem' }}>
                  Person
                </TableCell>
                <TableCell sx={{ fontWeight: 600, textTransform: 'uppercase', fontSize: '0.75rem' }}>
                  Contact
                </TableCell>
                <TableCell sx={{ fontWeight: 600, textTransform: 'uppercase', fontSize: '0.75rem' }}>
                  Security Level
                </TableCell>
                <TableCell sx={{ fontWeight: 600, textTransform: 'uppercase', fontSize: '0.75rem' }}>
                  AI Profile
                </TableCell>
                <TableCell sx={{ fontWeight: 600, textTransform: 'uppercase', fontSize: '0.75rem' }}>
                  Groups
                </TableCell>
                <TableCell sx={{ fontWeight: 600, textTransform: 'uppercase', fontSize: '0.75rem' }}>
                  Skills
                </TableCell>
                <TableCell sx={{ fontWeight: 600, textTransform: 'uppercase', fontSize: '0.75rem' }}>
                  Last Login
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredUsers.map((user, index) => (
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
                      <Avatar src={user.avatar} alt={`${user.firstName} ${user.lastName}`} sx={{ width: 40, height: 40 }}>
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
                  <TableCell>
                    <Typography variant="body2">{formatDate(user.lastLoginAt)}</Typography>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <Box sx={{ mt: 2, textAlign: 'center', color: 'text.secondary' }}>
        <Typography variant="body2">
          Showing {filteredUsers.length} of {users.length} user{users.length !== 1 ? 's' : ''}
        </Typography>
      </Box>
    </Box>
  );
};

export default RecruiterUsers;

