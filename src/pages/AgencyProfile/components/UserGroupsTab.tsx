import React, { useEffect, useState } from 'react';
import { Box, Typography, TextField, Button, Grid, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper, Snackbar, Alert, Autocomplete } from '@mui/material';
import { collection, addDoc, getDocs, doc, getDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../../firebase';
import { useNavigate } from 'react-router-dom';
import { getAuth } from 'firebase/auth';

const UserGroupsTab: React.FC<{ agencyId: string }> = ({ agencyId }) => {
  const [form, setForm] = useState({ title: '', description: '' });
  const [groups, setGroups] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [user, setUser] = useState<any>(null);
  const [showForm, setShowForm] = useState(false);
  const [agencyUsers, setAgencyUsers] = useState<any[]>([]);
  const [groupManagerIds, setGroupManagerIds] = useState<string[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    fetchGroups();
    fetchCurrentUser();
    fetchAgencyUsers();
    // eslint-disable-next-line
  }, [agencyId]);

  const fetchGroups = async () => {
    setLoading(true);
    try {
      const q = collection(db, 'agencies', agencyId, 'userGroups');
      const snapshot = await getDocs(q);
      setGroups(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
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
        setUser({ userId: currentUser.uid, firstName: userData.firstName, lastName: userData.lastName });
      }
    }
  };

  const fetchAgencyUsers = async () => {
    try {
      const q = collection(db, 'users');
      const snapshot = await getDocs(q);
      setAgencyUsers(snapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .filter((user: any) => user.agencyId === agencyId && user.role === 'Agency'));
    } catch {}
  };

  const handleChange = (field: string, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title || !form.description) return;
    setLoading(true);
    setError('');
    try {
      await addDoc(collection(db, 'agencies', agencyId, 'userGroups'), {
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
    <Box sx={{ p: 2, width: '100%' }}>
      {!showForm && (
        <Button variant="contained" color="primary" sx={{ mb: 2 }} onClick={() => setShowForm(true)}>
          Create New Group
        </Button>
      )}
      {showForm && (
        <>
          <Typography variant="h6" gutterBottom>Create User Group</Typography>
          <form onSubmit={handleSubmit}>
            <Grid container spacing={2} mb={2}>
              <Grid item xs={12} sm={6}>
                <TextField label="Group Title" fullWidth required value={form.title} onChange={e => handleChange('title', e.target.value)} />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField label="Description" fullWidth required value={form.description} onChange={e => handleChange('description', e.target.value)} multiline />
              </Grid>
              <Grid item xs={12} sm={6}>
                <Autocomplete
                  multiple
                  options={agencyUsers}
                  getOptionLabel={u => `${u.firstName} ${u.lastName}`}
                  value={agencyUsers.filter(u => groupManagerIds.includes(u.id))}
                  onChange={(_, newValue) => setGroupManagerIds(newValue.map((u: any) => u.id))}
                  renderInput={params => <TextField {...params} label="Group Managers" placeholder="Select managers" fullWidth />}
                  renderTags={(value, getTagProps) =>
                    value.map((option, index) => (
                      <Button variant="outlined" {...getTagProps({ index })} key={option.id} sx={{ mr: 1 }}>
                        {option.firstName} {option.lastName}
                      </Button>
                    ))
                  }
                />
              </Grid>
              <Grid item xs={12} display="flex" gap={2}>
                <Button type="submit" variant="contained" color="primary" disabled={loading || !form.title || !form.description}>
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
      <Typography variant="h6" gutterBottom>Groups</Typography>
      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
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
              <TableRow><TableCell colSpan={5}>No groups yet.</TableCell></TableRow>
            ) : (
              groups.map((group) => (
                <TableRow key={group.id}>
                  <TableCell>{group.title}</TableCell>
                  <TableCell>{group.description.length > 40 ? group.description.slice(0, 40) + '...' : group.description}</TableCell>
                  <TableCell>{group.createdAt?.toDate ? group.createdAt.toDate().toLocaleDateString() : '-'}</TableCell>
                  <TableCell>{group.createdBy ? `${group.createdBy.firstName} ${group.createdBy.lastName}` : '-'}</TableCell>
                  <TableCell>{Array.isArray(group.memberIds) ? group.memberIds.length : 0}</TableCell>
                  <TableCell>
                    <Button size="small" variant="outlined" onClick={() => navigate(`/agencies/${agencyId}/userGroups/${group.id}`)}>Open</Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>
      <Snackbar open={!!error} autoHideDuration={4000} onClose={() => setError('')}>
        <Alert severity="error" onClose={() => setError('')} sx={{ width: '100%' }}>{error}</Alert>
      </Snackbar>
      <Snackbar open={success} autoHideDuration={2000} onClose={() => setSuccess(false)}>
        <Alert severity="success" sx={{ width: '100%' }}>Group added!</Alert>
      </Snackbar>
    </Box>
  );
};

export default UserGroupsTab; 