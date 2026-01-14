import React, { useEffect, useState, useMemo, useRef } from 'react';
import {
  Box,
  Typography,
  TextField,
  Button,
  Grid,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Snackbar,
  Alert,
  Autocomplete,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { collection, addDoc, getDocs, doc, getDoc, serverTimestamp } from 'firebase/firestore';
import { useNavigate, useLocation } from 'react-router-dom';
import { getAuth } from 'firebase/auth';

import { db } from '../../../firebase';
import PageHeader from '../../../components/PageHeader';
import InboxSearchBar from '../../../components/InboxSearchBar';
import FavoriteButton from '../../../components/FavoriteButton';
import FavoritesFilter from '../../../components/FavoritesFilter';
import { useFavorites } from '../../../hooks/useFavorites';

const UserGroupsTab: React.FC<{ tenantId: string }> = ({ tenantId }) => {
  const [form, setForm] = useState({ title: '', description: '' });
  const [groups, setGroups] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [user, setUser] = useState<any>(null);
  const [showForm, setShowForm] = useState(false);
  const [agencyUsers, setAgencyUsers] = useState<any[]>([]);
  const [groupManagerIds, setGroupManagerIds] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  
  // Refs for sticky positioning
  const contentRef = useRef<HTMLDivElement | null>(null);
  
  // Check if we're accessing from the recruiter module
  const isFromRecruiter = location.pathname.includes('/recruiter/user-groups');

  const { favorites, isFavorite, toggleFavorite } = useFavorites('userGroups');
  
  const handleSearchChange = (value: string) => {
    setSearchTerm(value);
  };
  
  const handleFavoritesToggle = () => {
    setShowFavoritesOnly(!showFavoritesOnly);
  };

  useEffect(() => {
    fetchGroups();
    fetchCurrentUser();
    fetchAgencyUsers();
    // eslint-disable-next-line
  }, [tenantId]);

  const fetchGroups = async () => {
    setLoading(true);
    try {
      const q = collection(db, 'tenants', tenantId, 'userGroups');
      const snapshot = await getDocs(q);
      setGroups(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    } catch (err: any) {
      setError(err.message || 'Failed to fetch groups');
    }
    setLoading(false);
  };

  const fetchCurrentUser = async () => {
    const auth = getAuth();
    const currentUser = auth.currentUser;
    if (currentUser) {
      const userRef = doc(db, 'users', currentUser.uid);
      const userSnap = await getDoc(userRef);
      if (userSnap.exists()) {
        const userData = userSnap.data();
        setUser({
          userId: currentUser.uid,
          firstName: userData.firstName,
          lastName: userData.lastName,
        });
      }
    }
  };

  const fetchAgencyUsers = async () => {
    try {
      const q = collection(db, 'users');
      const snapshot = await getDocs(q);
      setAgencyUsers(
        snapshot.docs
          .map((doc) => ({ id: doc.id, ...doc.data() }))
          .filter((user: any) => user.tenantId === tenantId && user.role === 'Agency'),
      );
    } catch {}
  };

  const handleChange = (field: string, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const filteredGroups = useMemo(() => {
    return groups.filter((group) => {
      if (showFavoritesOnly && !favorites.includes(group.id)) {
        return false;
      }

      if (!searchTerm) {
        return true;
      }

      const search = searchTerm.toLowerCase();
      return (
        group.title?.toLowerCase().includes(search) ||
        group.description?.toLowerCase().includes(search) ||
        group.createdBy?.firstName?.toLowerCase().includes(search) ||
        group.createdBy?.lastName?.toLowerCase().includes(search)
      );
    });
  }, [groups, searchTerm, showFavoritesOnly, favorites]);

  const handleBroadcastSuccess = (result: any) => {
    setSuccess(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title || !form.description) return;
    setLoading(true);
    setError('');
    try {
      await addDoc(collection(db, 'tenants', tenantId, 'userGroups'), {
        title: form.title,
        description: form.description,
        createdAt: serverTimestamp(),
        createdBy: user,
        memberIds: [],
        groupManagerIds,
      });
      setForm({ title: '', description: '' });
      setGroupManagerIds([]);
      setShowForm(false);
      setSuccess(true);
      fetchGroups();
    } catch (err: any) {
      setError(err.message || 'Failed to add group');
    }
    setLoading(false);
  };

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
              User Groups
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexShrink: 0 }}>
              <InboxSearchBar
                value={searchTerm}
                onChange={handleSearchChange}
                onSearch={handleSearchChange}
                placeholder="Search groups..."
              />
              
              {/* Favorites filter */}
              <FavoritesFilter
                favoriteType="userGroups"
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
              
              <Button
                variant="contained"
                startIcon={<AddIcon />}
                onClick={() => setShowForm(true)}
                sx={{
                  textTransform: 'none',
                  borderRadius: '24px',
                  px: 2.5,
                  py: 1,
                  height: '40px',
                  fontWeight: 500,
                  fontSize: '14px',
                  bgcolor: '#0057B8',
                  boxShadow: '0 2px 8px rgba(0, 87, 184, 0.25)',
                  '&:hover': {
                    bgcolor: '#004a9f',
                    boxShadow: '0 4px 12px rgba(0, 87, 184, 0.35)',
                  },
                  whiteSpace: 'nowrap',
                }}
              >
                Create New Group
              </Button>
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
        {/* Table Container */}
        <Box sx={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', px: 2, pb: 2 }}>
          {/* Loading overlay */}
          {loading && groups.length === 0 && (
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
                zIndex: 10,
              }}
            >
              <CircularProgress />
            </Box>
          )}
          
          {/* No Results Message */}
          {!loading && filteredGroups.length === 0 && (
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: '200px',
                textAlign: 'center',
              }}
            >
              <Typography variant="body2" color="text.secondary">
                {groups.length === 0
                  ? 'No groups yet.'
                  : 'No groups match your search.'}
              </Typography>
            </Box>
          )}
          
          {filteredGroups.length > 0 && (
            <TableContainer
              component={Paper}
              elevation={0}
              sx={{
                borderRadius: 0,
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
                      Title
                    </TableCell>
                    <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem', borderRadius: 0 }}>
                      Description
                    </TableCell>
                    <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem', borderRadius: 0 }}>
                      Created
                    </TableCell>
                    <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem', borderRadius: 0 }}>
                      Created By
                    </TableCell>
                    <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem', borderRadius: 0 }}>
                      Members
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {filteredGroups.map((group, index) => (
                    <TableRow
                      key={group.id}
                      hover
                      sx={{
                        cursor: 'pointer',
                        backgroundColor: index % 2 === 0 ? 'background.paper' : '#FAFAFA',
                        '&:hover': {
                          backgroundColor: 'action.selected',
                        },
                      }}
                      onClick={() => navigate(isFromRecruiter ? `/recruiter/user-groups/${group.id}` : `/usergroups/${group.id}`)}
                    >
                      <TableCell onClick={(event) => event.stopPropagation()}>
                        <FavoriteButton
                          itemId={group.id}
                          favoriteType="userGroups"
                          isFavorite={isFavorite}
                          toggleFavorite={toggleFavorite}
                          size="small"
                          tooltipText={{
                            favorited: 'Remove from favorites',
                            notFavorited: 'Add to favorites',
                          }}
                        />
                      </TableCell>
                      <TableCell>{group.title}</TableCell>
                      <TableCell>
                        {group.description && group.description.length > 40
                          ? group.description.slice(0, 40) + '...'
                          : group.description || '-'}
                      </TableCell>
                      <TableCell>
                        {group.createdAt?.toDate ? group.createdAt.toDate().toLocaleDateString() : '-'}
                      </TableCell>
                      <TableCell>
                        {group.createdBy
                          ? `${group.createdBy.firstName} ${group.createdBy.lastName}`
                          : '-'}
                      </TableCell>
                      <TableCell>
                        {Array.isArray(group.memberIds) ? group.memberIds.length : 0}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Box>
      </Box>
      
      {/* Create Group Dialog */}
      <Dialog open={showForm} onClose={() => setShowForm(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Create User Group</DialogTitle>
        <form onSubmit={handleSubmit}>
          <DialogContent>
            <Grid container spacing={2}>
              <Grid item xs={12}>
                <TextField
                  label="Group Title"
                  fullWidth
                  required
                  value={form.title}
                  onChange={(e) => handleChange('title', e.target.value)}
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  label="Description"
                  fullWidth
                  required
                  value={form.description}
                  onChange={(e) => handleChange('description', e.target.value)}
                  multiline
                  rows={3}
                />
              </Grid>
              <Grid item xs={12}>
                <Autocomplete
                  multiple
                  options={agencyUsers}
                  getOptionLabel={(u) => `${u.firstName} ${u.lastName}`}
                  value={agencyUsers.filter((u) => groupManagerIds.includes(u.id))}
                  onChange={(_, newValue) => setGroupManagerIds(newValue.map((u: any) => u.id))}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Group Managers"
                      placeholder="Select managers"
                      fullWidth
                    />
                  )}
                />
              </Grid>
            </Grid>
          </DialogContent>
          <DialogActions>
            <Button variant="outlined" onClick={() => {
              setShowForm(false);
              setForm({ title: '', description: '' });
              setGroupManagerIds([]);
            }}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="contained"
              disabled={loading || !form.title || !form.description}
              sx={{
                bgcolor: '#0057B8',
                '&:hover': {
                  bgcolor: '#004a9f',
                },
              }}
            >
              {loading ? 'Adding...' : 'Create Group'}
            </Button>
          </DialogActions>
        </form>
      </Dialog>
      
      <Snackbar open={!!error} autoHideDuration={4000} onClose={() => setError('')}>
        <Alert severity="error" onClose={() => setError('')} sx={{ width: '100%' }}>
          {error}
        </Alert>
      </Snackbar>
      <Snackbar open={success} autoHideDuration={2000} onClose={() => setSuccess(false)}>
        <Alert severity="success" sx={{ width: '100%' }}>
          Group added!
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default UserGroupsTab;
