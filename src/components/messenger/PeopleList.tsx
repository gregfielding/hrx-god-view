/**
 * People List Component
 * 
 * Displays a list of people (coworkers) that can be messaged.
 * Allows starting new conversations.
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  Box,
  List,
  ListItem,
  ListItemButton,
  ListItemAvatar,
  ListItemText,
  Avatar,
  Typography,
  CircularProgress,
  Alert,
  TextField,
  InputAdornment,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import { collection, query, where, getDocs, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useDirectMessenger } from '../../contexts/DirectMessengerContext';
import { useTheme, useMediaQuery } from '@mui/material';

interface PeopleListProps {
  searchQuery?: string;
}

interface Person {
  uid: string;
  displayName: string;
  email: string;
  avatarUrl?: string;
  jobTitle?: string;
  department?: string;
}

const PeopleList: React.FC<PeopleListProps> = ({ searchQuery: externalSearchQuery = '' }) => {
  const { user, activeTenant } = useAuth();
  const { openThreadForUser, threads, setActiveThreadId, setMode } = useDirectMessenger();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [internalSearchQuery, setInternalSearchQuery] = useState('');

  const tenantId = activeTenant?.id;
  const currentUserId = user?.uid;

  // Use external search query if provided, otherwise use internal
  const searchQuery = externalSearchQuery || internalSearchQuery;

  // Fetch people from the users collection
  useEffect(() => {
    if (!tenantId || !currentUserId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const loadPeople = async () => {
      try {
        const usersRef = collection(db, 'users');
        
        // Query users that belong to this tenant
        // We'll get all users and filter client-side for now
        // In production, you might want to use a more efficient query
        const usersSnapshot = await getDocs(usersRef);
        
        const peopleList: Person[] = [];
        const seenUids = new Set<string>();

        usersSnapshot.docs.forEach((doc) => {
          const userData = doc.data();
          const uid = doc.id;

          // Skip current user
          if (uid === currentUserId) return;

          // Check if user belongs to this tenant
          const hasTenantAccess =
            userData.tenantId === tenantId ||
            userData.activeTenantId === tenantId ||
            (userData.tenantIds &&
              (Array.isArray(userData.tenantIds)
                ? userData.tenantIds.includes(tenantId)
                : typeof userData.tenantIds === 'object' && tenantId in userData.tenantIds));

          if (!hasTenantAccess) return;

          // Check security level (5-7) - same logic as company directory
          let workerLevel: any = null;
          
          // Check tenantIds map first (new structure)
          if (userData.tenantIds && userData.tenantIds[tenantId]) {
            workerLevel = userData.tenantIds[tenantId].securityLevel;
          }
          // Fall back to direct securityLevel field (old structure)
          else if (userData.securityLevel) {
            workerLevel = userData.securityLevel;
          }

          // Only include users with security level 5, 6, or 7
          const hasValidSecurityLevel =
            workerLevel === 5 || workerLevel === 6 || workerLevel === 7 ||
            workerLevel === '5' || workerLevel === '6' || workerLevel === '7';

          if (!hasValidSecurityLevel) return;

          // Skip if already seen (shouldn't happen, but safety check)
          if (seenUids.has(uid)) return;
          seenUids.add(uid);

          // Get display name
          const displayName =
            userData.displayName ||
            (userData.firstName && userData.lastName
              ? `${userData.firstName} ${userData.lastName}`.trim()
              : userData.email?.split('@')[0] || 'Unknown User');

          // Get tenant-specific data if available
          const tenantData = userData.tenantIds?.[tenantId] || {};
          const jobTitle = tenantData.jobTitle || userData.jobTitle || '';
          const department = tenantData.department || userData.department || '';

          peopleList.push({
            uid,
            displayName,
            email: userData.email || '',
            avatarUrl: userData.avatar || userData.photoURL || '',
            jobTitle,
            department,
          });
        });

        // Sort by display name
        peopleList.sort((a, b) => a.displayName.localeCompare(b.displayName));

        setPeople(peopleList);
        setLoading(false);
      } catch (err: any) {
        console.error('Error loading people:', err);
        setError(err.message || 'Failed to load people');
        setLoading(false);
      }
    };

    loadPeople();
  }, [tenantId, currentUserId]);

  // Filter people by search query
  const filteredPeople = useMemo(() => {
    if (!searchQuery.trim()) return people;

    const query = searchQuery.toLowerCase();
    return people.filter((person) => {
      const nameMatch = person.displayName.toLowerCase().includes(query);
      const emailMatch = person.email.toLowerCase().includes(query);
      const jobMatch = person.jobTitle?.toLowerCase().includes(query) || false;
      const deptMatch = person.department?.toLowerCase().includes(query) || false;
      return nameMatch || emailMatch || jobMatch || deptMatch;
    });
  }, [people, searchQuery]);

  // Create a map of existing threads by other user's UID
  const existingThreadsMap = useMemo(() => {
    const map = new Map<string, string>();
    threads.forEach((thread) => {
      map.set(thread.otherUser.uid, thread.id);
    });
    return map;
  }, [threads]);

  const handlePersonClick = async (person: Person) => {
    // Pass user data to avoid needing to read from Firestore
    await openThreadForUser(person.uid, {
      displayName: person.displayName,
      email: person.email,
      avatarUrl: person.avatarUrl,
    });
    if (isMobile) {
      setMode('conversation');
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 4 }}>
        <CircularProgress size={32} />
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 2 }}>
        <Alert severity="error">Failed to load people: {error}</Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Search bar (if not provided externally) */}
      {!externalSearchQuery && (
        <Box sx={{ p: 2, pb: 1, flexShrink: 0 }}>
          <TextField
            fullWidth
            size="small"
            placeholder="Search coworkers..."
            value={internalSearchQuery}
            onChange={(e) => setInternalSearchQuery(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            }}
            sx={{
              '& .MuiOutlinedInput-root': {
                borderRadius: '8px',
                backgroundColor: 'grey.50',
              },
            }}
          />
        </Box>
      )}

      {/* People List */}
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 4 }}>
          <CircularProgress size={32} />
        </Box>
      ) : filteredPeople.length === 0 ? (
        <Box sx={{ p: 3, textAlign: 'center' }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {searchQuery ? 'No people match your search.' : 'No coworkers available.'}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Only Staff Managers, Managers, and Admins (security level 5-7) can be messaged.
          </Typography>
        </Box>
      ) : (
        <List sx={{ flex: 1, overflow: 'auto', p: 0 }}>
          {filteredPeople.map((person) => {
            const hasExistingThread = existingThreadsMap.has(person.uid);

            return (
              <ListItem key={person.uid} disablePadding>
                <ListItemButton
                  onClick={() => handlePersonClick(person)}
                  sx={{
                    py: 1.5,
                    px: 2,
                    '&:hover': {
                      bgcolor: 'action.hover',
                    },
                  }}
                >
                  <ListItemAvatar>
                    <Avatar
                      src={person.avatarUrl}
                      sx={{
                        width: 48,
                        height: 48,
                        bgcolor: 'primary.main',
                      }}
                    >
                      {person.displayName
                        .split(' ')
                        .map((n) => n[0])
                        .join('')
                        .toUpperCase()
                        .slice(0, 2)}
                    </Avatar>
                  </ListItemAvatar>
                  <ListItemText
                    primary={
                      <Typography
                        variant="subtitle2"
                        fontWeight={500}
                        sx={{
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {person.displayName}
                      </Typography>
                    }
                    secondary={
                      <Box>
                        {person.jobTitle && (
                          <Typography
                            variant="body2"
                            color="text.secondary"
                            sx={{
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {person.jobTitle}
                            {person.department && ` • ${person.department}`}
                          </Typography>
                        )}
                      </Box>
                    }
                  />
                </ListItemButton>
              </ListItem>
            );
          })}
        </List>
      )}
    </Box>
  );
};

export default PeopleList;

