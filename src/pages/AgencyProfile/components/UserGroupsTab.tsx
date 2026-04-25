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
  TableSortLabel,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import {
  collection,
  addDoc,
  getDocs,
  doc,
  getDoc,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { useNavigate, useLocation } from 'react-router-dom';
import { getAuth } from 'firebase/auth';

import { db } from '../../../firebase';
import PageHeader from '../../../components/PageHeader';
import InboxSearchBar from '../../../components/InboxSearchBar';
import FavoriteButton from '../../../components/FavoriteButton';
import FavoritesFilter from '../../../components/FavoritesFilter';
import { useFavorites } from '../../../hooks/useFavorites';
import { fetchAgencyUserGroupManagerCandidates } from '../../../utils/userGroupManagerCandidateUsers';

export interface UserGroupsTabProps {
  tenantId: string;
  hideHeader?: boolean;
  /**
   * `'all'` (default) shows every group in the tenant.
   * `'mine'` filters to groups where the current viewer's uid is in
   * `groupManagerIds`. The Cloud-Function-side rules don't need to
   * change — we just hide rows the viewer isn't a manager of.
   */
  scope?: 'all' | 'mine';
  layoutSearch?: string;
  layoutSetSearch?: (value: string) => void;
  layoutShowFavoritesOnly?: boolean;
  layoutSetShowFavoritesOnly?: (value: boolean) => void;
  layoutOpenCreateForm?: boolean;
  layoutSetOpenCreateForm?: (value: boolean) => void;
}

const UserGroupsTab: React.FC<UserGroupsTabProps> = ({
  tenantId,
  hideHeader = false,
  scope = 'all',
  layoutSearch,
  layoutSetSearch,
  layoutShowFavoritesOnly,
  layoutSetShowFavoritesOnly,
  layoutOpenCreateForm,
  layoutSetOpenCreateForm,
}) => {
  const [form, setForm] = useState({ title: '', description: '' });
  const [groups, setGroups] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [user, setUser] = useState<any>(null);
  const [showForm, setShowForm] = useState(false);
  const [managerOptions, setManagerOptions] = useState<any[]>([]);
  const [groupManagerIds, setGroupManagerIds] = useState<string[]>([]);
  const [localSearchTerm, setLocalSearchTerm] = useState('');
  const [localShowFavoritesOnly, setLocalShowFavoritesOnly] = useState(false);
  // Per-column sort. Defaults to title ascending so the table opens
  // alphabetised — matches the previous (implicit) order most closely.
  type SortKey = 'title' | 'managers' | 'members';
  type SortDir = 'asc' | 'desc';
  const [sortBy, setSortBy] = useState<SortKey>('title');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const navigate = useNavigate();
  const location = useLocation();

  const searchTerm = hideHeader && layoutSearch !== undefined ? layoutSearch : localSearchTerm;
  const setSearchTerm = hideHeader && layoutSetSearch ? layoutSetSearch : setLocalSearchTerm;
  const showFavoritesOnly = hideHeader && layoutShowFavoritesOnly !== undefined ? layoutShowFavoritesOnly : localShowFavoritesOnly;
  const setShowFavoritesOnly = hideHeader && layoutSetShowFavoritesOnly ? layoutSetShowFavoritesOnly : (v: boolean) => setLocalShowFavoritesOnly(v);

  // Refs for sticky positioning
  const contentRef = useRef<HTMLDivElement | null>(null);

  // When layout requests open create form (header Create button), open dialog and clear the flag
  useEffect(() => {
    if (hideHeader && layoutOpenCreateForm && layoutSetOpenCreateForm) {
      setShowForm(true);
      layoutSetOpenCreateForm(false);
    }
  }, [hideHeader, layoutOpenCreateForm, layoutSetOpenCreateForm]);

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
    if (!tenantId) return;
    
    const loadData = async () => {
      try {
        await Promise.all([fetchGroups(), fetchCurrentUser(), fetchAgencyUsersForManagers()]);
      } catch (err) {
        console.error('Error loading user groups data:', err);
      }
    };

    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  const fetchGroups = async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const q = collection(db, 'tenants', tenantId, 'userGroups');
      const snapshot = await getDocs(q);
      setGroups(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    } catch (err: any) {
      console.error('Error fetching user groups:', err);
      setError(err.message || 'Failed to fetch groups');
      setGroups([]);
    } finally {
      setLoading(false);
    }
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

  /** Same pool as `UserGroupDetails` Group managers picker (`tenantId` + `role === 'Agency'`). */
  const fetchAgencyUsersForManagers = async () => {
    if (!tenantId) return;
    try {
      const rows = await fetchAgencyUserGroupManagerCandidates(db, tenantId);
      setManagerOptions(rows);
    } catch (err: any) {
      console.error('Error fetching agency users for group managers:', err);
      setManagerOptions([]);
    }
  };

  /** Resolve `groupManagerIds` for search (agency pool + id fallback). */
  const managerDisplayById = useMemo(() => {
    const m = new Map<string, string>();
    for (const u of managerOptions) {
      const raw = String(u?.firstName ?? '').trim();
      const rawLast = String(u?.lastName ?? '').trim();
      const name = [raw, rawLast].filter(Boolean).join(' ').trim();
      m.set(u.id, name || u.id);
    }
    return m;
  }, [managerOptions]);

  const handleRowGroupManagersChange = async (group: { id: string }, newIds: string[]) => {
    if (!tenantId || !group?.id) return;
    try {
      const ref = doc(db, 'tenants', tenantId, 'userGroups', group.id);
      await updateDoc(ref, { groupManagerIds: newIds });
      setGroups((prev) =>
        prev.map((g) => (g.id === group.id ? { ...g, groupManagerIds: newIds } : g)),
      );
    } catch (err: any) {
      console.error('Error updating group managers:', err);
      setError(err.message || 'Failed to update group managers');
    }
  };

  const formatGroupManagersLabel = (group: { groupManagerIds?: string[] }): string => {
    const ids = Array.isArray(group.groupManagerIds) ? group.groupManagerIds : [];
    if (ids.length === 0) return '—';
    return ids
      .map((id) => managerDisplayById.get(id) ?? id)
      .join(', ');
  };

  const managerOptionLabel = (u: { id?: string; firstName?: string; lastName?: string }) => {
    const n = `${u?.firstName ?? ''} ${u?.lastName ?? ''}`.trim();
    return n || u?.id || '';
  };

  /** Include ids not in the agency pool (e.g. old data) so chips match the stored group doc. */
  const rowManagerOptions = (group: { groupManagerIds?: string[] }) => {
    const ids = Array.isArray(group.groupManagerIds) ? group.groupManagerIds : [];
    const known = new Set(managerOptions.map((u) => u.id));
    const extra = ids
      .filter((id) => !known.has(id))
      .map((id) => ({ id, firstName: id, lastName: '' }));
    return [...managerOptions, ...extra];
  };

  const handleChange = (field: string, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const viewerUid = user?.userId as string | undefined;

  const filteredGroups = useMemo(() => {
    return groups.filter((group) => {
      // `scope === 'mine'` powers the /users/my-user-groups tab — only
      // surface groups where the signed-in viewer is one of the managers.
      if (scope === 'mine') {
        if (!viewerUid) return false;
        const ids = Array.isArray(group.groupManagerIds) ? group.groupManagerIds : [];
        if (!ids.includes(viewerUid)) return false;
      }

      if (showFavoritesOnly && !favorites.includes(group.id)) {
        return false;
      }

      if (!searchTerm) {
        return true;
      }

      const search = searchTerm.toLowerCase();
      const managerSearchBlob = (Array.isArray(group.groupManagerIds) ? group.groupManagerIds : [])
        .map((id) => managerDisplayById.get(id) ?? '')
        .join(' ')
        .toLowerCase();
      return (
        group.title?.toLowerCase().includes(search) ||
        group.description?.toLowerCase().includes(search) ||
        group.createdBy?.firstName?.toLowerCase().includes(search) ||
        group.createdBy?.lastName?.toLowerCase().includes(search) ||
        managerSearchBlob.includes(search)
      );
    });
  }, [groups, scope, viewerUid, searchTerm, showFavoritesOnly, favorites, managerDisplayById]);

  /**
   * Click handler shared by every sortable column header. Toggles between
   * asc/desc when the same column is clicked twice; switches column and
   * defaults to asc for text / desc for numeric counts otherwise.
   */
  const handleRequestSort = (key: SortKey) => {
    if (sortBy === key) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(key);
      setSortDir(key === 'title' ? 'asc' : 'desc');
    }
  };

  const sortedGroups = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    const safeStr = (v: unknown) => (typeof v === 'string' ? v : '').toLowerCase();
    const managerCount = (g: any) =>
      Array.isArray(g.groupManagerIds) ? g.groupManagerIds.length : 0;
    const memberCount = (g: any) => (Array.isArray(g.memberIds) ? g.memberIds.length : 0);

    return [...filteredGroups].sort((a, b) => {
      switch (sortBy) {
        case 'title': {
          const cmp = safeStr(a.title).localeCompare(safeStr(b.title));
          return cmp * dir;
        }
        case 'managers': {
          const cmp = managerCount(a) - managerCount(b);
          // Tie-break by title so stable, predictable order.
          return (cmp || safeStr(a.title).localeCompare(safeStr(b.title))) * dir;
        }
        case 'members': {
          const cmp = memberCount(a) - memberCount(b);
          return (cmp || safeStr(a.title).localeCompare(safeStr(b.title))) * dir;
        }
        default:
          return 0;
      }
    });
  }, [filteredGroups, sortBy, sortDir]);

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
    // `flex: 1, minHeight: 0` lets the table stretch when this tab is
    // hosted in a flex column parent (UsersLayout outlet). In the legacy
    // AgencyProfile tab panel the parent isn't a flex container, so the
    // box just falls back to content height — same as it did before.
    <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {!hideHeader && (
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
      )}
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
        {/* Table Container — no bottom padding here; UsersLayout's outlet
            container already supplies the 16px gutter below the table. */}
        <Box sx={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', px: 2, pb: 0 }}>
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
                  : scope === 'mine'
                    ? 'You aren’t listed as a manager on any groups yet.'
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
                    <TableCell
                      sortDirection={sortBy === 'title' ? sortDir : false}
                      sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem', borderRadius: 0 }}
                    >
                      <TableSortLabel
                        active={sortBy === 'title'}
                        direction={sortBy === 'title' ? sortDir : 'asc'}
                        onClick={() => handleRequestSort('title')}
                      >
                        Title
                      </TableSortLabel>
                    </TableCell>
                    <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem', borderRadius: 0 }}>
                      Description
                    </TableCell>
                    {/* Created / Created By columns hidden per product request — uncomment to restore.
                    <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem', borderRadius: 0 }}>
                      Created
                    </TableCell>
                    <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem', borderRadius: 0 }}>
                      Created By
                    </TableCell>
                    */}
                    <TableCell
                      sortDirection={sortBy === 'managers' ? sortDir : false}
                      sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem', borderRadius: 0 }}
                    >
                      <TableSortLabel
                        active={sortBy === 'managers'}
                        direction={sortBy === 'managers' ? sortDir : 'desc'}
                        onClick={() => handleRequestSort('managers')}
                      >
                        Group managers
                      </TableSortLabel>
                    </TableCell>
                    <TableCell
                      sortDirection={sortBy === 'members' ? sortDir : false}
                      sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem', borderRadius: 0 }}
                    >
                      <TableSortLabel
                        active={sortBy === 'members'}
                        direction={sortBy === 'members' ? sortDir : 'desc'}
                        onClick={() => handleRequestSort('members')}
                      >
                        Members
                      </TableSortLabel>
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {sortedGroups.map((group, index) => (
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
                      {/* Created / Created By cells hidden per product request — uncomment to restore.
                      <TableCell>
                        {group.createdAt?.toDate ? group.createdAt.toDate().toLocaleDateString() : '-'}
                      </TableCell>
                      <TableCell>
                        {group.createdBy
                          ? `${group.createdBy.firstName} ${group.createdBy.lastName}`
                          : '-'}
                      </TableCell>
                      */}
                      <TableCell
                        onClick={(e) => e.stopPropagation()}
                        onMouseDown={(e) => e.stopPropagation()}
                        sx={{ minWidth: 240, maxWidth: 320, verticalAlign: 'middle', py: 0.5 }}
                      >
                        <Autocomplete
                          multiple
                          size="small"
                          disableCloseOnSelect
                          options={rowManagerOptions(group)}
                          getOptionLabel={(u: any) => managerOptionLabel(u)}
                          isOptionEqualToValue={(a, b) => a.id === b.id}
                          value={rowManagerOptions(group).filter((u: any) =>
                            (Array.isArray(group.groupManagerIds) ? group.groupManagerIds : []).includes(
                              u.id,
                            ),
                          )}
                          onChange={(_, newValue) => {
                            handleRowGroupManagersChange(group, newValue.map((u: any) => u.id));
                          }}
                          renderInput={(params) => (
                            <TextField
                              {...params}
                              placeholder="Managers"
                              variant="outlined"
                              sx={{ '& .MuiOutlinedInput-root': { minHeight: 40 } }}
                            />
                          )}
                          sx={{ '& .MuiAutocomplete-inputRoot': { flexWrap: 'wrap' } }}
                        />
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
                  options={managerOptions}
                  getOptionLabel={(u: any) => managerOptionLabel(u)}
                  value={managerOptions.filter((u) => groupManagerIds.includes(u.id))}
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
