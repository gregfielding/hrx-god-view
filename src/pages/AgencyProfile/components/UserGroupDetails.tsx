import React, { useEffect, useState } from 'react';
import {
  Box,
  Typography,
  TextField,
  Button,
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
  Tabs,
  Tab,
} from '@mui/material';
import { doc, getDoc, updateDoc, collection, getDocs, deleteDoc } from 'firebase/firestore';
import { db } from '../../../firebase';
import { useNavigate, useLocation } from 'react-router-dom';
import AgencyProfileHeader from './AgencyProfileHeader';

const UserGroupDetails: React.FC<{ tenantId: string; groupId: string }> = ({
  tenantId,
  groupId,
}) => {
  const [group, setGroup] = useState<any>(null);
  const [editForm, setEditForm] = useState({ title: '', description: '' });
  const [allWorkers, setAllWorkers] = useState<any[]>([]);
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [selectedWorker, setSelectedWorker] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const location = useLocation();
  const [agency, setAgency] = useState<any>(null);
  const [tabIndex, setTabIndex] = useState(7); // User Groups tab index
  const [agencyUsers, setAgencyUsers] = useState<any[]>([]);
  const [groupManagerIds, setGroupManagerIds] = useState<string[]>([]);

  // Check if we're accessing from the top-level usergroups page
  const isFromTopLevel = location.pathname.includes('/usergroups') || location.pathname === '/usergroups';

  useEffect(() => {
    fetchGroup();
    fetchAllWorkers();
    fetchAgency();
    fetchAgencyUsers();
    // eslint-disable-next-line
  }, [tenantId, groupId]);

  const fetchGroup = async () => {
    setLoading(true);
    try {
      const groupRef = doc(db, 'tenants', tenantId, 'userGroups', groupId);
      const groupSnap = await getDoc(groupRef);
      if (groupSnap.exists()) {
        const data = groupSnap.data();
        setGroup({ id: groupId, ...data });
        setEditForm({ title: data.title || '', description: data.description || '' });
        setMemberIds(data.memberIds || []);
        setGroupManagerIds(data.groupManagerIds || []);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch group');
    }
    setLoading(false);
  };

  const fetchAllWorkers = async () => {
    try {
      const q = collection(db, 'users');
      const snapshot = await getDocs(q);
      setAllWorkers(
        snapshot.docs
          .map((doc) => ({ id: doc.id, ...doc.data() }))
          .filter((user: any) => user.role === 'Worker' && user.tenantId === tenantId),
      );
    } catch (err: any) {
      // ignore for now
    }
  };

  const fetchAgency = async () => {
    try {
      const agencyRef = doc(db, 'tenants', tenantId);
      const agencySnap = await getDoc(agencyRef);
      if (agencySnap.exists()) {
        setAgency({ id: tenantId, ...agencySnap.data() });
      }
    } catch {}
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

  const handleEditChange = (field: string, value: string) => {
    setEditForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleManagersChange = async (newValue: any[]) => {
    setGroupManagerIds(newValue.map((u: any) => u.id));
    try {
      const groupRef = doc(db, 'tenants', tenantId, 'userGroups', groupId);
      await updateDoc(groupRef, { groupManagerIds: newValue.map((u: any) => u.id) });
      setSuccess(true);
    } catch (err: any) {
      setError(err.message || 'Failed to update group managers');
    }
  };

  const handleEditSave = async () => {
    setLoading(true);
    setError('');
    try {
      const groupRef = doc(db, 'tenants', tenantId, 'userGroups', groupId);
      await updateDoc(groupRef, {
        title: editForm.title,
        description: editForm.description,
        groupManagerIds,
      });
      setSuccess(true);
      fetchGroup();
    } catch (err: any) {
      setError(err.message || 'Failed to update group');
    }
    setLoading(false);
  };

  const handleAddMember = async () => {
    if (!selectedWorker) return;
    setLoading(true);
    setError('');
    try {
      const groupRef = doc(db, 'tenants', tenantId, 'userGroups', groupId);
      const newMemberIds = memberIds.includes(selectedWorker.id)
        ? memberIds
        : [...memberIds, selectedWorker.id];
      await updateDoc(groupRef, { memberIds: newMemberIds });
      setMemberIds(newMemberIds);
      setSelectedWorker(null);
      setSuccess(true);
    } catch (err: any) {
      setError(err.message || 'Failed to add member');
    }
    setLoading(false);
  };

  const handleRemoveMember = async (userId: string) => {
    setLoading(true);
    setError('');
    try {
      const groupRef = doc(db, 'tenants', tenantId, 'userGroups', groupId);
      const newMemberIds = memberIds.filter((id) => id !== userId);
      await updateDoc(groupRef, { memberIds: newMemberIds });
      setMemberIds(newMemberIds);
      setSuccess(true);
    } catch (err: any) {
      setError(err.message || 'Failed to remove member');
    }
    setLoading(false);
  };

  const handleTabChange = (_: React.SyntheticEvent, newIndex: number) => {
    setTabIndex(newIndex);
    // Navigate to the correct tab in AgencyProfile
    const tabRoutes = [
      'overview',
      'modules',
      'locations',
      'billing',
      'contacts',
      'tenants',
      'workforce',
      'userGroups',
      'jobOrders',
      'shifts',
      'timesheets',
      'reports',
      'aiSettings',
      'activityLogs',
    ];
    if (newIndex !== 7) {
      navigate(`/tenants/${tenantId}?tab=${newIndex}`);
    }
  };

  const handleDeleteGroup = async () => {
    setLoading(true);
    setError('');
    try {
      await deleteDoc(doc(db, 'tenants', tenantId, 'userGroups', groupId));
      if (isFromTopLevel) {
        navigate('/usergroups');
      } else {
        navigate(`/tenants/${tenantId}?tab=6`);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to delete group');
    }
    setLoading(false);
  };

  const members = allWorkers.filter((w) => memberIds.includes(w.id));
  const availableWorkers = allWorkers.filter((w) => !memberIds.includes(w.id));

  const noop = () => {
    /* intentionally left blank */
  };

  return (
    <Box sx={{ p: 0, width: '100%' }}>
      {agency && (
        <>
          {isFromTopLevel ? (
            // Simplified header for top-level page
            <Box display="flex" justifyContent="flex-end" mb={2}>
              <Button variant="outlined" onClick={() => navigate('/usergroups')}>
                &larr; Back to User Groups
              </Button>
            </Box>
          ) : (
            // Full header for agency profile page
            <>
              <AgencyProfileHeader
                uid={tenantId}
                name={agency.name}
                avatarUrl={agency.avatar || ''}
                onAvatarUpdated={noop}
              />
              <Tabs
                value={7}
                onChange={handleTabChange}
                variant="scrollable"
                scrollButtons="auto"
                allowScrollButtonsMobile
                sx={{ mb: 2 }}
              >
                <Tab label="Overview" />
                <Tab label="Modules" />
                <Tab label="Locations" />
                <Tab label="Billing Info" />
                <Tab label="Contacts" />
                <Tab label="Customers" />
                <Tab label="Workforce" />
                <Tab label="User Groups" />
                <Tab label="Job Orders" />
                <Tab label="Shifts" />
                <Tab label="Timesheets" />
                <Tab label="Reports & Insights" />
                <Tab label="AI Settings" />
                <Tab label="Activity Logs" />
              </Tabs>
              <Box display="flex" justifyContent="flex-end" mb={2}>
                <Button variant="outlined" onClick={() => navigate(`/tenants/${tenantId}?tab=6`)}>
                  &larr; Back to User Groups
                </Button>
              </Box>
            </>
          )}
        </>
      )}
      <Typography variant="h6" gutterBottom>
        Group Details
      </Typography>
      <Box display="flex" gap={2} mb={2}>
        <TextField
          label="Group Title"
          value={editForm.title}
          onChange={(e) => handleEditChange('title', e.target.value)}
          sx={{ flex: 1 }}
        />
        <TextField
          label="Description"
          value={editForm.description}
          onChange={(e) => handleEditChange('description', e.target.value)}
          sx={{ flex: 2 }}
          multiline
          minRows={2}
        />
      </Box>
      <Box mb={2}>
        <Autocomplete
          multiple
          options={agencyUsers}
          getOptionLabel={(u) => `${u.firstName} ${u.lastName}`}
          value={agencyUsers.filter((u) => groupManagerIds.includes(u.id))}
          onChange={(_, newValue) => handleManagersChange(newValue)}
          renderInput={(params) => (
            <TextField {...params} label="Group Managers" placeholder="Select managers" fullWidth />
          )}
          renderTags={(value, getTagProps) =>
            value.map((option, index) => (
              <Button variant="outlined" {...getTagProps({ index })} key={option.id} sx={{ mr: 1 }}>
                {option.firstName} {option.lastName}
              </Button>
            ))
          }
        />
      </Box>
      <Box mb={2}>
        <Button
          variant="contained"
          onClick={handleEditSave}
          disabled={loading || !editForm.title || !editForm.description}
        >
          Save
        </Button>
      </Box>
      <Box display="flex" gap={2} mb={2}>
        <Autocomplete
          options={allWorkers}
          getOptionLabel={(w) => `${w.firstName} ${w.lastName}`}
          value={selectedWorker}
          onChange={(_, newValue) => setSelectedWorker(newValue)}
          renderInput={(params) => <TextField {...params} label="Add Worker to Group" fullWidth />}
          sx={{ flex: 2 }}
        />
        <Button variant="contained" onClick={handleAddMember} disabled={!selectedWorker || loading}>
          Add
        </Button>
      </Box>
      <Typography variant="h6" gutterBottom>
        Group Members
      </Typography>
      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Email</TableCell>
              <TableCell>Phone</TableCell>
              <TableCell>View</TableCell>
              <TableCell>Remove</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {members.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5}>No members in this group.</TableCell>
              </TableRow>
            ) : (
              members.map((member) => (
                <TableRow key={member.id}>
                  <TableCell>
                    {member.firstName} {member.lastName}
                  </TableCell>
                  <TableCell>{member.email}</TableCell>
                  <TableCell>{member.phone || '-'}</TableCell>
                  <TableCell>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => navigate(`/users/${member.id}`)}
                    >
                      View
                    </Button>
                  </TableCell>
                  <TableCell>
                    <Button
                      size="small"
                      variant="outlined"
                      color="error"
                      onClick={() => handleRemoveMember(member.id)}
                    >
                      Remove
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>
      {members.length === 0 && (
        <Box display="flex" justifyContent="flex-end" mt={2}>
          <Button variant="contained" color="error" onClick={handleDeleteGroup} disabled={loading}>
            Delete Group
          </Button>
        </Box>
      )}
      <Snackbar open={!!error} autoHideDuration={4000} onClose={() => setError('')}>
        <Alert severity="error" onClose={() => setError('')} sx={{ width: '100%' }}>
          {error}
        </Alert>
      </Snackbar>
      <Snackbar open={success} autoHideDuration={2000} onClose={() => setSuccess(false)}>
        <Alert severity="success" sx={{ width: '100%' }}>
          Group updated!
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default UserGroupDetails;
