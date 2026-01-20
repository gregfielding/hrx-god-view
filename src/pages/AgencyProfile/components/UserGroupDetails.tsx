import React, { useEffect, useState } from 'react';
import {
  Box,
  Typography,
  TextField,
  Button,
  Card,
  CardHeader,
  CardContent,
  Divider,
  Stack,
  Chip,
  Avatar,
  Tooltip,
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
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Tabs,
  Tab,
} from '@mui/material';
import { doc, getDoc, updateDoc, collection, getDocs, deleteDoc, where, documentId, query } from 'firebase/firestore';
import { useNavigate, useLocation } from 'react-router-dom';
import GroupsIcon from '@mui/icons-material/Groups';
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';

import { db } from '../../../firebase';
import PageHeader from '../../../components/PageHeader';
import StandardTablePagination from '../../../components/StandardTablePagination';
import { formatPhoneNumber } from '../../../utils/formatPhone';

import AgencyProfileHeader from './AgencyProfileHeader';

const UserGroupDetails: React.FC<{ tenantId: string; groupId: string }> = ({
  tenantId,
  groupId,
}) => {
  const [group, setGroup] = useState<any>(null);
  const [editForm, setEditForm] = useState({ title: '', description: '' });
  const [allWorkers, setAllWorkers] = useState<any[]>([]);
  const [membersData, setMembersData] = useState<any[]>([]);
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
  const [activeTab, setActiveTab] = useState<'members' | 'details'>('members');
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [membersPage, setMembersPage] = useState(0);
  const [membersRowsPerPage, setMembersRowsPerPage] = useState(20);

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
      const qRef = collection(db, 'users');
      const snapshot = await getDocs(qRef);
      setAllWorkers(
        snapshot.docs
          .map((doc) => ({ id: doc.id, ...doc.data() }))
          // Include any non-internal users belonging to this tenant (workers/applicants/etc.)
          .filter((user: any) => {
            const tenantIds = user.tenantIds;
            const belongsToTenant =
              user.tenantId === tenantId ||
              user.activeTenantId === tenantId ||
              (Array.isArray(tenantIds) && tenantIds.includes(tenantId)) ||
              (tenantIds && typeof tenantIds === 'object' && !Array.isArray(tenantIds) && tenantId in tenantIds);

            const levelRaw = user.tenantIds?.[tenantId]?.securityLevel ?? user.securityLevel ?? '0';
            const levelNum = parseInt(String(levelRaw), 10) || 0;
            const isInternal = levelNum >= 5;

            return belongsToTenant && !isInternal;
          }),
      );
    } catch (err: any) {
      // ignore for now
    }
  };

  const fetchMembersByIds = async (ids: string[]) => {
    if (!tenantId) return;
    if (!ids || ids.length === 0) {
      setMembersData([]);
      return;
    }
    try {
      const chunks: string[][] = [];
      for (let i = 0; i < ids.length; i += 10) {
        chunks.push(ids.slice(i, i + 10));
      }

      const snaps = await Promise.all(
        chunks.map((chunk) => getDocs(query(collection(db, 'users'), where(documentId(), 'in', chunk))))
      );
      const users = snaps.flatMap((s) => s.docs.map((d) => ({ id: d.id, ...d.data() })));

      // Preserve group order (memberIds)
      const byId = new Map(users.map((u) => [u.id, u]));
      const ordered = ids.map((id) => byId.get(id)).filter(Boolean);
      setMembersData(ordered as any[]);
    } catch (err) {
      console.error('Failed to fetch group members:', err);
      setMembersData([]);
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
      await fetchMembersByIds(newMemberIds);
      setSelectedWorker(null);
      setSuccess(true);
      setAddMemberOpen(false);
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
      await fetchMembersByIds(newMemberIds);
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

  useEffect(() => {
    fetchMembersByIds(memberIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, groupId, memberIds]);

  const members = membersData;
  const availableWorkers = allWorkers.filter((w) => !memberIds.includes(w.id));
  const paginatedMembers = members.slice(
    membersPage * membersRowsPerPage,
    membersPage * membersRowsPerPage + membersRowsPerPage,
  );

  const noop = () => {
    /* intentionally left blank */
  };

  return (
    <Box sx={{ p: 0, width: '100%' }}>
      {agency && (
        <>
          {!isFromTopLevel && (
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
                sx={{ mb: 0 }}
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
            </>
          )}
        </>
      )}

      <PageHeader
        title={
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
            <Avatar
              sx={{
                width: 72,
                height: 72,
                bgcolor: 'primary.main',
                color: '#fff',
                fontWeight: 700,
                flexShrink: 0,
              }}
            >
              <GroupsIcon />
            </Avatar>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography
                variant="h6"
                sx={{
                  fontSize: { xs: '20px', md: '24px' },
                  fontWeight: 700,
                  lineHeight: 1.2,
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {editForm.title || group?.title || 'User Group'}
              </Typography>
              <Typography
                variant="body2"
                sx={{
                  fontSize: '14px',
                  color: 'rgba(0, 0, 0, 0.55)',
                  mt: 0.75,
                }}
              >
                {editForm.description || group?.description || '—'}
              </Typography>
              <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: 'wrap' }}>
                <Chip label={`Members: ${memberIds.length}`} size="small" variant="outlined" />
                <Chip label={`Managers: ${groupManagerIds.length}`} size="small" variant="outlined" />
              </Stack>
            </Box>
          </Box>
        }
        titleRightActions={
          <Stack direction="row" spacing={1.25} alignItems="center" sx={{ justifyContent: { xs: 'flex-start', md: 'flex-end' } }}>
            <Button
              variant="outlined"
              startIcon={<ArrowBackIcon />}
              onClick={() => (isFromTopLevel ? navigate('/usergroups') : navigate(`/tenants/${tenantId}?tab=6`))}
              sx={{ borderRadius: '999px', textTransform: 'none' }}
            >
              Back
            </Button>
            <Button
              variant="contained"
              startIcon={<SaveOutlinedIcon />}
              onClick={handleEditSave}
              disabled={loading || !editForm.title || !editForm.description}
              sx={{ borderRadius: '999px', textTransform: 'none' }}
            >
              Save
            </Button>
            <Tooltip title={members.length > 0 ? 'Remove all members before deleting this group' : 'Delete group'} arrow>
              <span>
                <Button
                  variant="contained"
                  color="error"
                  startIcon={<DeleteOutlineIcon />}
                  onClick={handleDeleteGroup}
                  disabled={loading || members.length > 0}
                  sx={{ borderRadius: '999px', textTransform: 'none' }}
                >
                  Delete
                </Button>
              </span>
            </Tooltip>
          </Stack>
        }
      />

      <Box sx={{ px: { xs: 2, md: 3 }, py: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
        {/* Inbox-style section header row: tab buttons (left) + primary action (right) */}
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
          <Box sx={{ display: 'flex', gap: 0.75 }}>
            {([
              { id: 'members' as const, label: 'Members' },
              { id: 'details' as const, label: 'Details' },
            ]).map((t) => {
              const isActive = activeTab === t.id;
              return (
                <Button
                  key={t.id}
                  onClick={() => setActiveTab(t.id)}
                  variant="text"
                  sx={{
                    textTransform: 'none',
                    borderRadius: '999px',
                    fontSize: '14px',
                    fontWeight: isActive ? 600 : 500,
                    color: isActive ? 'white' : 'rgba(0, 0, 0, 0.7)',
                    bgcolor: isActive ? '#0057B8' : 'rgba(0, 0, 0, 0.04)',
                    px: 2,
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

          {activeTab === 'members' && (
            <Button
              variant="contained"
              onClick={() => setAddMemberOpen(true)}
              disabled={loading || availableWorkers.length === 0}
              sx={{ borderRadius: '999px', textTransform: 'none' }}
            >
              Add Member
            </Button>
          )}
        </Box>

        {activeTab === 'members' && (
          <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
            <TableContainer sx={{ maxHeight: 520 }}>
              <Table size="small" stickyHeader>
                <TableHead
                  sx={{
                    position: 'sticky',
                    top: 0,
                    zIndex: 10,
                    backgroundColor: 'background.paper',
                    '& .MuiTableCell-root': { borderRadius: 0 },
                  }}
                >
                  <TableRow sx={{ height: 40, backgroundColor: 'background.paper' }}>
                    <TableCell sx={{ fontWeight: 700, textTransform: 'uppercase', fontSize: '0.75rem', py: 1.25 }}>
                      Name
                    </TableCell>
                    <TableCell sx={{ fontWeight: 700, textTransform: 'uppercase', fontSize: '0.75rem', py: 1.25 }}>
                      Email
                    </TableCell>
                    <TableCell sx={{ fontWeight: 700, textTransform: 'uppercase', fontSize: '0.75rem', py: 1.25 }}>
                      Phone
                    </TableCell>
                    <TableCell sx={{ fontWeight: 700, textTransform: 'uppercase', fontSize: '0.75rem', py: 1.25 }}>
                      View
                    </TableCell>
                    <TableCell sx={{ fontWeight: 700, textTransform: 'uppercase', fontSize: '0.75rem', py: 1.25 }}>
                      Remove
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {members.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} sx={{ color: 'text.secondary', fontStyle: 'italic', py: 2 }}>
                        No members in this group.
                      </TableCell>
                    </TableRow>
                  ) : (
                    paginatedMembers.map((member, idx) => (
                      <TableRow
                        key={member.id}
                        hover
                        sx={{
                          height: 56,
                          bgcolor: idx % 2 === 0 ? 'background.paper' : 'grey.50',
                        }}
                      >
                        <TableCell sx={{ py: 1.25 }}>
                          {member.firstName} {member.lastName}
                        </TableCell>
                        <TableCell sx={{ py: 1.25 }}>{member.email}</TableCell>
                        <TableCell sx={{ py: 1.25 }}>
                          {member.phone ? formatPhoneNumber(String(member.phone)) : '-'}
                        </TableCell>
                        <TableCell sx={{ py: 1.25 }}>
                          <Button
                            size="small"
                            variant="outlined"
                            onClick={() => navigate(`/users/${member.id}`)}
                            sx={{ borderRadius: '999px', textTransform: 'none' }}
                          >
                            View
                          </Button>
                        </TableCell>
                        <TableCell sx={{ py: 1.25 }}>
                          <Button
                            size="small"
                            variant="outlined"
                            color="error"
                            onClick={() => handleRemoveMember(member.id)}
                            sx={{ borderRadius: '999px', textTransform: 'none' }}
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

            <StandardTablePagination
              count={members.length}
              page={membersPage}
              rowsPerPage={membersRowsPerPage}
              onPageChange={(_e, newPage) => setMembersPage(newPage)}
              onRowsPerPageChange={(e) => {
                setMembersRowsPerPage(parseInt(e.target.value, 10));
                setMembersPage(0);
              }}
            />
          </Paper>
        )}

        {activeTab === 'details' && (
          <Stack spacing={2}>
            <Card variant="outlined">
              <CardHeader title="Group details" titleTypographyProps={{ fontWeight: 800 }} />
              <CardContent>
                <Stack spacing={2}>
                  <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                    <TextField
                      label="Group Title"
                      value={editForm.title}
                      onChange={(e) => handleEditChange('title', e.target.value)}
                      fullWidth
                    />
                    <TextField
                      label="Description"
                      value={editForm.description}
                      onChange={(e) => handleEditChange('description', e.target.value)}
                      fullWidth
                      multiline
                      minRows={2}
                    />
                  </Stack>
                </Stack>
              </CardContent>
            </Card>

            <Card variant="outlined">
              <CardHeader title="Group managers" titleTypographyProps={{ fontWeight: 800 }} />
              <CardContent>
                <Autocomplete
                  multiple
                  options={agencyUsers}
                  getOptionLabel={(u) => `${u.firstName} ${u.lastName}`}
                  value={agencyUsers.filter((u) => groupManagerIds.includes(u.id))}
                  onChange={(_, newValue) => handleManagersChange(newValue)}
                  renderInput={(params) => (
                    <TextField {...params} label="Managers" placeholder="Select managers" fullWidth />
                  )}
                  renderTags={(value, getTagProps) =>
                    value.map((option, index) => (
                      <Chip
                        {...getTagProps({ index })}
                        key={option.id}
                        label={`${option.firstName} ${option.lastName}`}
                        size="small"
                        sx={{ fontWeight: 600 }}
                      />
                    ))
                  }
                />
              </CardContent>
            </Card>
          </Stack>
        )}
      </Box>

      <Dialog open={addMemberOpen} onClose={() => setAddMemberOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add member</DialogTitle>
        <DialogContent>
          <Box sx={{ mt: 1 }}>
            <Autocomplete
              options={availableWorkers}
              getOptionLabel={(w) => `${w.firstName} ${w.lastName}`}
              value={selectedWorker}
              onChange={(_, newValue) => setSelectedWorker(newValue)}
              renderInput={(params) => <TextField {...params} label="Worker" fullWidth />}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddMemberOpen(false)} disabled={loading} sx={{ textTransform: 'none' }}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={handleAddMember}
            disabled={!selectedWorker || loading}
            sx={{ borderRadius: '999px', textTransform: 'none' }}
          >
            Add
          </Button>
        </DialogActions>
      </Dialog>
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
