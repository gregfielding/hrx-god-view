import React, { useEffect, useState } from 'react';
import { Box, Typography, Grid, TextField, Button, Chip, Snackbar, Alert, MenuItem, FormControl, InputLabel, Select, OutlinedInput, Tabs, Tab, TableContainer, Table, TableHead, TableBody, TableRow, TableCell, Paper, Autocomplete } from '@mui/material';
import { doc, getDoc, updateDoc, collection, getDocs } from 'firebase/firestore';
import { db } from '../../../firebase';
import { useNavigate } from 'react-router-dom';
import AgencyProfileHeader from './AgencyProfileHeader';
import InfoIcon from '@mui/icons-material/Info';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import JobOrderShiftsTab from './JobOrderShiftsTab';

const noop = () => { /* intentionally left blank */ };

const JobOrderDetails: React.FC<{ agencyId: string; jobOrderId: string }> = ({ agencyId, jobOrderId }) => {
  const [jobOrder, setJobOrder] = useState<any>(null);
  const [editForm, setEditForm] = useState<any>(null);
  const [originalForm, setOriginalForm] = useState<any>(null);
  const [customers, setCustomers] = useState<any[]>([]);
  const [worksites, setWorksites] = useState<any[]>([]);
  const [jobTitles, setJobTitles] = useState<any[]>([]);
  const [jobTitleRates, setJobTitleRates] = useState<any[]>([]);
  const [originalRates, setOriginalRates] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const [agency, setAgency] = useState<any>(null);
  const [tabIndex, setTabIndex] = useState(8); // Job Orders tab index
  const [staffingManagers, setStaffingManagers] = useState<any[]>([]);
  const [selectedManagers, setSelectedManagers] = useState<string[]>([]);
  const [uniformDefaults, setUniformDefaults] = useState<any[]>([]);
  const [selectedUniformId, setSelectedUniformId] = useState('');
  const [customUniform, setCustomUniform] = useState('');
  const [additionalStaffInstructions, setAdditionalStaffInstructions] = useState('');
  const [sideTab, setSideTab] = useState(0);
  const [originalManagers, setOriginalManagers] = useState<string[]>([]);
  const [originalUniformId, setOriginalUniformId] = useState('');
  const [originalCustomUniform, setOriginalCustomUniform] = useState('');
  const [originalAdditionalStaffInstructions, setOriginalAdditionalStaffInstructions] = useState('');
  const [userGroups, setUserGroups] = useState<any[]>([]);
  const [selectedUserGroups, setSelectedUserGroups] = useState<string[]>([]);
  const [originalUserGroups, setOriginalUserGroups] = useState<string[]>([]);
  const [status, setStatus] = useState('Active');
  const [originalStatus, setOriginalStatus] = useState('Active');
  const [type, setType] = useState('Gig');
  const [originalType, setOriginalType] = useState('Gig');
  const [agencyCustomerIds, setAgencyCustomerIds] = useState<string[]>([]);

  useEffect(() => {
    fetchJobOrder();
    fetchCustomers();
    fetchJobTitles();
    fetchAgency();
    fetchStaffingManagers();
    fetchUniformDefaults();
    fetchUserGroups();
    // eslint-disable-next-line
  }, [agencyId, jobOrderId]);

  useEffect(() => {
    if (editForm && editForm.customerId) fetchWorksites(editForm.customerId);
    else setWorksites([]);
    // eslint-disable-next-line
  }, [editForm?.customerId]);

  useEffect(() => {
    // Sync jobTitleRates with selected job titles
    if (editForm && editForm.jobTitleIds) {
      setJobTitleRates((prevRates) => {
        // Add new job titles
        const updated = editForm.jobTitleIds.map((title: string) => {
          const existing = prevRates.find((r: any) => r.title === title);
          return existing || { title, payRate: '', billRate: '' };
        });
        return updated;
      });
    }
  }, [editForm?.jobTitleIds]);

  useEffect(() => {
    if (editForm && editForm.staffingManagerIds) {
      setSelectedManagers(editForm.staffingManagerIds);
    }
  }, [editForm?.staffingManagerIds]);

  useEffect(() => {
    if (editForm && editForm.additionalStaffInstructions !== undefined) {
      setAdditionalStaffInstructions(editForm.additionalStaffInstructions);
    }
  }, [editForm?.additionalStaffInstructions]);

  useEffect(() => {
    if (editForm && editForm.userGroupIds) {
      setSelectedUserGroups(editForm.userGroupIds);
    }
  }, [editForm?.userGroupIds]);

  useEffect(() => {
    console.log('agencyCustomerIds:', agencyCustomerIds);
    fetchCustomers();
    // eslint-disable-next-line
  }, [agencyCustomerIds]);

  const fetchJobOrder = async () => {
    setLoading(true);
    try {
      const orderRef = doc(db, 'jobOrders', jobOrderId);
      const orderSnap = await getDoc(orderRef);
      if (orderSnap.exists()) {
        const data = orderSnap.data();
        setJobOrder({ id: jobOrderId, ...data });
        setEditForm({ ...data });
        setOriginalForm({ ...data });
        setJobTitleRates(data.jobTitleRates || []);
        setOriginalRates(data.jobTitleRates || []);
        setSelectedManagers(data.staffingManagerIds || []);
        setOriginalManagers(data.staffingManagerIds || []);
        setSelectedUniformId(data.uniformInstructions && typeof data.uniformInstructions === 'string' && uniformDefaults.some((u: any) => u.title === data.uniformInstructions) ? data.uniformInstructions : '');
        setOriginalUniformId(data.uniformInstructions && typeof data.uniformInstructions === 'string' && uniformDefaults.some((u: any) => u.title === data.uniformInstructions) ? data.uniformInstructions : '');
        setCustomUniform(data.uniformInstructions && (!uniformDefaults.some((u: any) => u.title === data.uniformInstructions)) ? data.uniformInstructions : '');
        setOriginalCustomUniform(data.uniformInstructions && (!uniformDefaults.some((u: any) => u.title === data.uniformInstructions)) ? data.uniformInstructions : '');
        setAdditionalStaffInstructions(data.additionalStaffInstructions || '');
        setOriginalAdditionalStaffInstructions(data.additionalStaffInstructions || '');
        setUserGroups(data.userGroupIds || []);
        setSelectedUserGroups(data.userGroupIds || []);
        setOriginalUserGroups(data.userGroupIds || []);
        setStatus(data.status || 'Active');
        setOriginalStatus(data.status || 'Active');
        setType(data.type || 'Gig');
        setOriginalType(data.type || 'Gig');
        if (data.customerId) fetchWorksites(data.customerId);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch job order');
    }
    setLoading(false);
  };

  const fetchCustomers = async () => {
    try {
      if (agencyCustomerIds.length === 0) {
        setCustomers([]);
        return;
      }
      const customerDocs = await Promise.all(
        agencyCustomerIds.map(async (id) => {
          const snap = await getDoc(doc(db, 'customers', id));
          if (snap.exists()) {
            const data = snap.data();
            console.log('Fetched customer:', data.name, id);
            return { id, name: data.name || id, ...data };
          }
          return null;
        })
      );
      setCustomers(customerDocs.filter(Boolean));
    } catch (err) {
      console.error('Error fetching customers:', err);
    }
  };

  const fetchWorksites = async (customerId: string) => {
    try {
      const q = collection(db, 'customers', customerId, 'locations');
      const snapshot = await getDocs(q);
      setWorksites(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    } catch {}
  };

  const fetchJobTitles = async () => {
    try {
      const settingsRef = doc(db, 'agencies', agencyId, 'settings', 'main');
      const snap = await getDoc(settingsRef);
      setJobTitles(snap.exists() ? snap.data().jobTitles || [] : []);
    } catch {}
  };

  const fetchAgency = async () => {
    try {
      const agencyRef = doc(db, 'agencies', agencyId);
      const agencySnap = await getDoc(agencyRef);
      if (agencySnap.exists()) {
        setAgency({ id: agencyId, ...agencySnap.data() });
        setAgencyCustomerIds(agencySnap.data().customerIds || []);
      }
    } catch {}
  };

  const fetchStaffingManagers = async () => {
    try {
      const q = collection(db, 'users');
      const snapshot = await getDocs(q);
      setStaffingManagers(snapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .filter((user: any) => user.agencyId === agencyId && ['Admin', 'Manager', 'Staffer'].includes(user.securityLevel)));
    } catch {}
  };

  const fetchUniformDefaults = async () => {
    try {
      const settingsRef = doc(db, 'agencies', agencyId, 'settings', 'main');
      const snap = await getDoc(settingsRef);
      setUniformDefaults(snap.exists() ? snap.data().uniformDefaults || [] : []);
    } catch {}
  };

  const fetchUserGroups = async () => {
    try {
      const q = collection(db, 'agencies', agencyId, 'userGroups');
      const snapshot = await getDocs(q);
      setUserGroups(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    } catch {}
  };

  const handleEditChange = (field: string, value: any) => {
    setEditForm((prev: any) => ({ ...prev, [field]: value }));
  };

  const handleRateChange = (title: string, field: 'payRate' | 'billRate', value: string) => {
    setJobTitleRates((prevRates) =>
      prevRates.map((r: any) =>
        r.title === title ? { ...r, [field]: value } : r
      )
    );
  };

  const handleSave = async () => {
    setLoading(true);
    setError('');
    try {
      const updateOrderRef = doc(db, 'jobOrders', jobOrderId);
      await updateDoc(updateOrderRef, {
        ...editForm,
        jobTitleRates,
        staffingManagerIds: selectedManagers,
        uniformInstructions: selectedUniformId === 'custom' ? customUniform : selectedUniformId,
        additionalStaffInstructions,
        userGroupIds: selectedUserGroups,
        status,
        type,
        aiPrompts: editForm.aiPrompts || '',
      });
      setSuccess(true);
      fetchJobOrder();
    } catch (err: any) {
      setError(err.message || 'Failed to update job order');
    }
    setLoading(false);
  };

  const handleTabChange = (_: React.SyntheticEvent, newIndex: number) => {
    setTabIndex(newIndex);
    // Navigate to the correct tab in AgencyProfile
    const tabRoutes = [
      'overview', 'settings', 'locations', 'billing', 'contacts', 'workforce', 'userGroups', 'customers', 'jobOrders', 'shifts', 'timesheets', 'reports', 'aiSettings', 'activityLogs'
    ];
    if (newIndex !== 8) {
      navigate(`/agencies/${agencyId}?tab=${newIndex}`);
    }
  };

  const isChanged =
    JSON.stringify(editForm) !== JSON.stringify(originalForm) ||
    JSON.stringify(jobTitleRates) !== JSON.stringify(originalRates) ||
    JSON.stringify(selectedManagers) !== JSON.stringify(originalManagers) ||
    selectedUniformId !== originalUniformId ||
    customUniform !== originalCustomUniform ||
    additionalStaffInstructions !== originalAdditionalStaffInstructions ||
    JSON.stringify(selectedUserGroups) !== JSON.stringify(originalUserGroups) ||
    status !== originalStatus ||
    type !== originalType;

  if (!editForm) return <Typography>Loading...</Typography>;

  return (
    <Box sx={{ p: 2, width: '100%' }}>
      {agency && (
        <>
          <AgencyProfileHeader
            uid={agencyId}
            name={agency.name}
            avatarUrl={agency.avatar || ''}
            onAvatarUpdated={noop}
          />
          <Tabs
            value={8}
            onChange={handleTabChange}
            variant="scrollable"
            scrollButtons="auto"
            allowScrollButtonsMobile
            sx={{ mb: 2 }}
          >
            <Tab label="Overview" />
            <Tab label="Settings" />
            <Tab label="Locations" />
            <Tab label="Billing Info" />
            <Tab label="Manage Users" />
            <Tab label="Workforce" />
            <Tab label="User Groups" />
            <Tab label="Customers" />
            <Tab label="Job Orders" />
            <Tab label="Assignments" />
            <Tab label="Shifts" />
            <Tab label="Timesheets" />
            {/* <Tab label="Reports & Insights" />
            <Tab label="AI Settings" />
            <Tab label="Activity Logs" /> */}
          </Tabs>
        </>
      )}
      <Box sx={{ display: 'flex', alignItems: 'flex-start' }}>
        <Box sx={{ width: 48, mr: 2 }}>
          <Tabs
            orientation="vertical"
            value={sideTab}
            onChange={(_, v) => setSideTab(v)}
            sx={{ borderRight: 1, borderColor: 'divider', width: 48 }}
            TabIndicatorProps={{ sx: { left: 0, width: 4 } }}
          >
            <Tab icon={<InfoIcon />} sx={{ minWidth: 0, maxWidth: 48, p: 0, justifyContent: 'center', alignItems: 'center' }} />
            <Tab icon={<CalendarMonthIcon />} sx={{ minWidth: 0, maxWidth: 48, p: 0, justifyContent: 'center', alignItems: 'center' }} />
            <Tab icon={<AccessTimeIcon />} sx={{ minWidth: 0, maxWidth: 48, p: 0, justifyContent: 'center', alignItems: 'center' }} />
          </Tabs>
        </Box>
        <Box sx={{ flex: 1 }}>
          {sideTab === 0 && (
            <>
              <Box display="flex" alignItems="center" justifyContent="space-between" mb={3}>
                <Typography variant="h6" gutterBottom>
                  Details: Job Order {editForm.jobOrderId || jobOrderId}
                </Typography>
                <Button variant="outlined" onClick={() => navigate(`/agencies/${agencyId}?tab=8`)}>
                  &larr; Back to Job Orders
                </Button>
              </Box>
              <Box component="form" mb={3}>
                <Grid container spacing={2} mb={2}>
                  <Grid item xs={12} sm={4} md={4}>
                    <TextField label="Title" fullWidth required value={editForm.title} onChange={e => handleEditChange('title', e.target.value)} />
                  </Grid>
                  <Grid item xs={12} sm={2} md={2}>
                    <FormControl fullWidth required>
                      <InputLabel id="type-label">Type</InputLabel>
                      <Select
                        labelId="type-label"
                        value={type}
                        label="Type"
                        onChange={e => setType(e.target.value)}
                      >
                        <MenuItem value="Gig">Gig</MenuItem>
                        <MenuItem value="Career">Career</MenuItem>
                      </Select>
                    </FormControl>
                  </Grid>
                  <Grid item xs={12} sm={6} md={6}>
                    <FormControl fullWidth required>
                      <InputLabel id="status-label">Status</InputLabel>
                      <Select
                        labelId="status-label"
                        value={status}
                        label="Status"
                        onChange={e => setStatus(e.target.value)}
                      >
                        <MenuItem value="Active">Active</MenuItem>
                        <MenuItem value="Closed">Closed</MenuItem>
                        <MenuItem value="Cancelled">Cancelled</MenuItem>
                      </Select>
                    </FormControl>
                  </Grid>
                  <Grid item xs={12}>
                    <TextField label="Description" fullWidth required value={editForm.description} onChange={e => handleEditChange('description', e.target.value)} multiline minRows={2} />
                  </Grid>
                  <Grid item xs={12} sm={4}>
                    <Autocomplete
                      options={customers}
                      getOptionLabel={c => c.name}
                      value={customers.find(c => c.id === editForm.customerId) || null}
                      onChange={(_, newValue) => handleEditChange('customerId', newValue ? newValue.id : '')}
                      renderInput={params => <TextField {...params} label="Customer" fullWidth required />}
                      isOptionEqualToValue={(option, value) => option.id === value.id}
                      clearOnEscape
                    />
                  </Grid>
                  <Grid item xs={12} sm={4}>
                    <TextField
                      select
                      label="Worksite"
                      fullWidth
                      required
                      value={editForm.worksiteId}
                      onChange={e => handleEditChange('worksiteId', e.target.value)}
                      disabled={!editForm.customerId}
                    >
                      {worksites.map((w) => (
                        <MenuItem key={w.id} value={w.id}>{w.nickname}</MenuItem>
                      ))}
                    </TextField>
                  </Grid>
                  <Grid item xs={12} sm={2}>
                    <TextField
                      label="Start Date"
                      type="date"
                      fullWidth
                      required
                      value={editForm.startDate}
                      onChange={e => handleEditChange('startDate', e.target.value)}
                      InputLabelProps={{ shrink: true }}
                    />
                  </Grid>
                  <Grid item xs={12} sm={2}>
                    <TextField
                      label="End Date"
                      type="date"
                      fullWidth
                      required
                      value={editForm.endDate}
                      onChange={e => handleEditChange('endDate', e.target.value)}
                      InputLabelProps={{ shrink: true }}
                    />
                  </Grid>
                  <Grid item xs={12} sm={6} md={6}>
                    <FormControl fullWidth required>
                      <InputLabel id="job-titles-label">Job Titles</InputLabel>
                      <Select
                        labelId="job-titles-label"
                        multiple
                        value={editForm.jobTitleIds}
                        onChange={e => handleEditChange('jobTitleIds', Array.isArray(e.target.value) ? e.target.value : [e.target.value])}
                        input={<OutlinedInput label="Job Titles" />}
                        renderValue={(selected) => (
                          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                            {(selected as string[]).map((id) => {
                              const jt = jobTitles.find((j: any) => j.title === id);
                              return (
                                <Chip
                                  key={id}
                                  label={jt ? jt.title : id}
                                  onMouseDown={e => e.stopPropagation()}
                                  onDelete={() => handleEditChange('jobTitleIds', editForm.jobTitleIds.filter((jid: string) => jid !== id))}
                                />
                              );
                            })}
                          </Box>
                        )}
                      >
                        {jobTitles.map((jt: any) => (
                          <MenuItem key={jt.title} value={jt.title}>{jt.title}</MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Grid>
                  <Grid item xs={12} sm={6} md={6}>
                    <FormControl fullWidth required>
                      <InputLabel id="user-groups-label">User Groups</InputLabel>
                      <Select
                        labelId="user-groups-label"
                        multiple
                        value={selectedUserGroups}
                        onChange={e => setSelectedUserGroups(Array.isArray(e.target.value) ? e.target.value : [e.target.value])}
                        input={<OutlinedInput label="User Groups" />}
                        renderValue={(selected) => (
                          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                            {(selected as string[]).map((id) => {
                              const group = userGroups.find((g: any) => g.id === id);
                              return (
                                <Chip
                                  key={id}
                                  label={group ? group.title : id}
                                  onMouseDown={e => e.stopPropagation()}
                                  onDelete={() => setSelectedUserGroups(selectedUserGroups.filter((gid: string) => gid !== id))}
                                />
                              );
                            })}
                          </Box>
                        )}
                      >
                        {userGroups.map((g: any) => (
                          <MenuItem key={g.id} value={g.id}>{g.title}</MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Grid>
                  <Grid item xs={12}>
                    <TableContainer component={Paper} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, boxShadow: 'none', background: 'transparent', mt: 2 }}>
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell>Title</TableCell>
                            <TableCell>Pay Rate</TableCell>
                            <TableCell>Bill Rate</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {jobTitleRates.map((rate: any) => (
                            <TableRow key={rate.title}>
                              <TableCell>{rate.title}</TableCell>
                              <TableCell>
                                <TextField
                                  value={rate.payRate}
                                  onChange={e => handleRateChange(rate.title, 'payRate', e.target.value)}
                                  size="small"
                                  placeholder="$"
                                />
                              </TableCell>
                              <TableCell>
                                <TextField
                                  value={rate.billRate}
                                  onChange={e => handleRateChange(rate.title, 'billRate', e.target.value)}
                                  size="small"
                                  placeholder="$"
                                />
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  </Grid>
                  <Grid item xs={12}>
                    <Autocomplete
                      multiple
                      options={staffingManagers}
                      getOptionLabel={u => `${u.firstName} ${u.lastName}`}
                      value={staffingManagers.filter(u => selectedManagers.includes(u.id))}
                      onChange={(_, newValue) => setSelectedManagers(newValue.map((u: any) => u.id))}
                      renderInput={params => <TextField {...params} label="Staffing Managers" placeholder="Select managers" fullWidth />}
                      renderTags={(value, getTagProps) =>
                        value.map((option, index) => (
                          <Chip label={`${option.firstName} ${option.lastName}`} {...getTagProps({ index })} key={option.id} />
                        ))
                      }
                    />
                  </Grid>
                  <Grid item xs={12}>
                    <FormControl fullWidth sx={{ mb: 2 }}>
                      <InputLabel id="uniform-default-label">Select Uniform Default</InputLabel>
                      <Select
                        labelId="uniform-default-label"
                        value={selectedUniformId}
                        label="Select Uniform Default"
                        onChange={e => setSelectedUniformId(e.target.value)}
                      >
                        {uniformDefaults.map((u: any) => (
                          <MenuItem key={u.title} value={u.title}>{u.title}</MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                    {selectedUniformId && (
                      <Button variant="outlined" color="error" sx={{ mb: 2 }} onClick={() => setSelectedUniformId('')}>
                        Remove
                      </Button>
                    )}
                    <TextField
                      label="Or add custom uniform instructions"
                      value={customUniform}
                      onChange={e => setCustomUniform(e.target.value)}
                      fullWidth
                      multiline
                      minRows={2}
                      sx={{ mb: 2 }}
                      disabled={!!selectedUniformId}
                    />
                    {selectedUniformId && (
                      <Box sx={{ mb: 2 }}>
                        <Typography variant="body2" color="textSecondary">
                          {uniformDefaults.find((u: any) => u.title === selectedUniformId)?.description || ''}
                        </Typography>
                        {uniformDefaults.find((u: any) => u.title === selectedUniformId)?.imageUrl && (
                          <img
                            src={uniformDefaults.find((u: any) => u.title === selectedUniformId)?.imageUrl}
                            alt={selectedUniformId}
                            style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 4, marginTop: 8 }}
                          />
                        )}
                      </Box>
                    )}
                  </Grid>
                  <Grid item xs={12}>
                    <TextField
                      label="Additional Staff Instructions"
                      value={additionalStaffInstructions}
                      onChange={e => setAdditionalStaffInstructions(e.target.value)}
                      fullWidth
                      multiline
                      minRows={2}
                      sx={{ mb: 2 }}
                    />
                  </Grid>
                  <Grid item xs={12}>
                    <TextField
                      label="AI Prompts"
                      value={editForm?.aiPrompts || ''}
                      onChange={e => handleEditChange('aiPrompts', e.target.value)}
                      fullWidth
                      multiline
                      minRows={2}
                      sx={{
                        mb: 2,
                        border: '2px solid #ff69b4',
                        boxShadow: '0 0 8px 2px #ff69b4',
                        borderRadius: 2,
                        '& .MuiOutlinedInput-root': {
                          '& fieldset': {
                            borderColor: '#ff69b4',
                            boxShadow: '0 0 8px 2px #ff69b4',
                          },
                          '&:hover fieldset': {
                            borderColor: '#ff69b4',
                          },
                          '&.Mui-focused fieldset': {
                            borderColor: '#ff69b4',
                            boxShadow: '0 0 12px 4px #ff69b4',
                          },
                        },
                      }}
                    />
                  </Grid>
                </Grid>
                <Button variant="contained" onClick={handleSave} disabled={loading || !isChanged}>Save Changes</Button>
              </Box>
              <Typography variant="body2" color="textSecondary">
                Job Order ID: {editForm.jobOrderId || '-'} | Created At: {editForm.createdAt?.toDate ? editForm.createdAt.toDate().toLocaleDateString() : '-'}
              </Typography>
            </>
          )}
          {sideTab === 1 && (
            <JobOrderShiftsTab agencyId={agencyId} jobOrderId={editForm.jobOrderId || jobOrderId} />
          )}
          {sideTab === 2 && (
            <Box>
              <Typography variant="h6" gutterBottom>Timesheets: Job Order {editForm.jobOrderId || jobOrderId}</Typography>
              <Typography>Timesheets content for this job order will go here.</Typography>
            </Box>
          )}
        </Box>
      </Box>
      <Snackbar open={!!error} autoHideDuration={4000} onClose={() => setError('')}>
        <Alert severity="error" onClose={() => setError('')} sx={{ width: '100%' }}>{error}</Alert>
      </Snackbar>
      <Snackbar open={success} autoHideDuration={2000} onClose={() => setSuccess(false)}>
        <Alert severity="success" sx={{ width: '100%' }}>Job order updated!</Alert>
      </Snackbar>
    </Box>
  );
};

export default JobOrderDetails; 