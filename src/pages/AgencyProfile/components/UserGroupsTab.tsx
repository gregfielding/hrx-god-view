import React, { useEffect, useState, useMemo } from 'react';
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
  InputAdornment,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import { collection, addDoc, getDocs, doc, getDoc, serverTimestamp } from 'firebase/firestore';
import { useNavigate, useLocation } from 'react-router-dom';
import { getAuth } from 'firebase/auth';

import { db } from '../../../firebase';
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
  
  // Check if we're accessing from the recruiter module
  const isFromRecruiter = location.pathname.includes('/recruiter/user-groups');

  const { favorites, isFavorite, toggleFavorite } = useFavorites('userGroups');

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
      setSuccess(true);
      fetchGroups();
    } catch (err: any) {
      setError(err.message || 'Failed to add group');
    }
    setLoading(false);
  };

  return (
    <Box sx={{ p: 0, width: '100%' }}>
      {(
        <Box display="flex" alignItems="center" justifyContent="space-between" mb={0}>
          <Typography variant="h6" component="h1">
            User Groups
          </Typography>
          <Button
            variant="contained"
            color="primary"
            onClick={() => setShowForm(true)}
          >
            CREATE NEW GROUP
          </Button>
        </Box>
      )}
      {showForm && (
        <>
          <Typography variant="h6" gutterBottom>
            Create User Group
          </Typography>
          <form onSubmit={handleSubmit}>
            <Grid container spacing={2} mb={2}>
              <Grid item xs={12} sm={6}>
                <TextField
                  label="Group Title"
                  fullWidth
                  required
                  value={form.title}
                  onChange={(e) => handleChange('title', e.target.value)}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  label="Description"
                  fullWidth
                  required
                  value={form.description}
                  onChange={(e) => handleChange('description', e.target.value)}
                  multiline
                />
              </Grid>
              <Grid item xs={12} sm={6}>
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
                  renderTags={(value, getTagProps) =>
                    value.map((option, index) => (
                      <Button
                        variant="outlined"
                        {...getTagProps({ index })}
                        key={option.id}
                        sx={{ mr: 1 }}
                      >
                        {option.firstName} {option.lastName}
                      </Button>
                    ))
                  }
                />
              </Grid>
              <Grid item xs={12} display="flex" gap={2}>
                <Button
                  type="submit"
                  variant="contained"
                  color="primary"
                  disabled={loading || !form.title || !form.description}
                >
                  {loading ? 'Adding...' : 'Add Group'}
                </Button>
                <Button variant="outlined" color="secondary" onClick={() => setShowForm(false)}>
                  Cancel
                </Button>
              </Grid>
            </Grid>
          </form>
        </>
      )}

      <Box
        sx={{
          mb: 3,
          display: 'flex',
          gap: 2,
          alignItems: 'center',
        }}
      >
        <TextField
          placeholder="Search groups..."
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          variant="outlined"
          size="small"
          sx={{
            flexGrow: 1,
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
                  favoriteType="userGroups"
                  showFavoritesOnly={showFavoritesOnly}
                  onToggle={setShowFavoritesOnly}
                  showText={false}
                  size="small"
                />
              </InputAdornment>
            ),
          }}
        />
      </Box>

      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: 60 }} />
              <TableCell sx={{ fontWeight: 600, textTransform: 'uppercase', fontSize: '0.75rem' }}>
                Title
              </TableCell>
              <TableCell sx={{ fontWeight: 600, textTransform: 'uppercase', fontSize: '0.75rem' }}>
                Description
              </TableCell>
              <TableCell sx={{ fontWeight: 600, textTransform: 'uppercase', fontSize: '0.75rem' }}>
                Created
              </TableCell>
              <TableCell sx={{ fontWeight: 600, textTransform: 'uppercase', fontSize: '0.75rem' }}>
                Created By
              </TableCell>
              <TableCell sx={{ fontWeight: 600, textTransform: 'uppercase', fontSize: '0.75rem' }}>
                Members
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filteredGroups.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} sx={{ textAlign: 'center', py: 4 }}>
                  <Typography variant="body2" color="text.secondary">
                    {groups.length === 0
                      ? 'No groups yet.'
                      : 'No groups match your search.'}
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              filteredGroups.map((group, index) => (
                <TableRow
                  key={group.id}
                  hover
                  sx={{
                    cursor: 'pointer',
                    backgroundColor: index % 2 === 0 ? 'background.paper' : 'action.hover',
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
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>
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
