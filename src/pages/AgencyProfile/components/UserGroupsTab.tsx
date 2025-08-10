import React, { useEffect, useState } from 'react';
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
  Checkbox,
} from '@mui/material';
import { collection, addDoc, getDocs, doc, getDoc, serverTimestamp } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { getAuth } from 'firebase/auth';

import { db } from '../../../firebase';
import BroadcastDialog from '../../../components/BroadcastDialog';

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
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [showBroadcastDialog, setShowBroadcastDialog] = useState(false);
  const navigate = useNavigate();

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

  const handleGroupSelection = (groupId: string) => {
    setSelectedGroups((prev) =>
      prev.includes(groupId) ? prev.filter((id) => id !== groupId) : [...prev, groupId],
    );
  };

  const handleSelectAll = () => {
    if (selectedGroups.length === groups.length) {
      setSelectedGroups([]);
    } else {
      setSelectedGroups(groups.map((group) => group.id));
    }
  };

  const handleBroadcastSuccess = (result: any) => {
    setSuccess(true);
    setSelectedGroups([]);
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

      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        {/* <Typography variant="h6">Groups</Typography> */}
        {selectedGroups.length > 0 && (
          <Button
            variant="contained"
            color="primary"
            onClick={() => setShowBroadcastDialog(true)}
            sx={{ ml: 2 }}
          >
            Send Broadcast to {selectedGroups.length} Group{selectedGroups.length !== 1 ? 's' : ''}{' '}
            Members
          </Button>
        )}
      </Box>

      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell padding="checkbox">
                <Checkbox
                  checked={selectedGroups.length === groups.length && groups.length > 0}
                  indeterminate={selectedGroups.length > 0 && selectedGroups.length < groups.length}
                  onChange={handleSelectAll}
                />
              </TableCell>
              <TableCell>Title</TableCell>
              <TableCell>Description</TableCell>
              <TableCell>Created</TableCell>
              <TableCell>Created By</TableCell>
              <TableCell>Members</TableCell>
              <TableCell>Open</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {groups.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5}>No groups yet.</TableCell>
              </TableRow>
            ) : (
              groups.map((group) => (
                <TableRow key={group.id}>
                  <TableCell padding="checkbox">
                    <Checkbox
                      checked={selectedGroups.includes(group.id)}
                      onChange={(e) => {
                        e.stopPropagation();
                        handleGroupSelection(group.id);
                      }}
                    />
                  </TableCell>
                  <TableCell>{group.title}</TableCell>
                  <TableCell>
                    {group.description.length > 40
                      ? group.description.slice(0, 40) + '...'
                      : group.description}
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
                  <TableCell>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => navigate(`/usergroups/${group.id}`)}
                    >
                      Open
                    </Button>
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

      <BroadcastDialog
        open={showBroadcastDialog}
        onClose={() => setShowBroadcastDialog(false)}
        tenantId={tenantId}
        senderId="admin" // Replace with actual user ID
        initialAudienceFilter={{
          userGroupId: selectedGroups.length === 1 ? selectedGroups[0] : undefined,
        }}
        title={`Send Broadcast to Group Members`}
        onSuccess={handleBroadcastSuccess}
      />
    </Box>
  );
};

export default UserGroupsTab;
