import React, { useEffect, useState } from 'react';
import {
  Box,
  Typography,
  Grid,
  TextField,
  Button,
  Chip,
  Snackbar,
  Alert,
  MenuItem,
  FormControl,
  InputLabel,
  Select,
  OutlinedInput,
  Tabs,
  Tab,
  TableContainer,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  Paper,
  Autocomplete,
  Switch,
  FormControlLabel,
} from '@mui/material';
import { doc, getDoc, updateDoc, collection, getDocs, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase';
import { useNavigate } from 'react-router-dom';
import InfoIcon from '@mui/icons-material/Info';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import JobOrderShiftsTab from './JobOrderShiftsTab';

const noop = () => {
  /* intentionally left blank */
};

const JobOrderDetails: React.FC<{ tenantId: string; jobOrderId: string; onBack?: () => void }> = ({
  tenantId,
  jobOrderId,
  onBack,
}) => {
  const [jobOrder, setJobOrder] = useState<any>(null);
  const [editForm, setEditForm] = useState<any>(null);
  const [originalForm, setOriginalForm] = useState<any>(null);
  const [tenants, setCustomers] = useState<any[]>([]);
  const [worksites, setWorksites] = useState<any[]>([]);
  const [jobTitles, setJobTitles] = useState<any[]>([]);
  const [jobTitleRates, setJobTitleRates] = useState<any[]>([]);
  const [originalRates, setOriginalRates] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
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
  const [originalAdditionalStaffInstructions, setOriginalAdditionalStaffInstructions] =
    useState('');
  const [userGroups, setUserGroups] = useState<any[]>([]);
  const [selectedUserGroups, setSelectedUserGroups] = useState<string[]>([]);
  const [originalUserGroups, setOriginalUserGroups] = useState<string[]>([]);
  const [status, setStatus] = useState('Active');
  const [originalStatus, setOriginalStatus] = useState('Active');
  const [type, setType] = useState('Gig');
  const [originalType, setOriginalType] = useState('Gig');
  const [visibility, setVisibility] = useState('Hidden');
  const [originalVisibility, setOriginalVisibility] = useState('Hidden');
  const [showExactLocation, setShowExactLocation] = useState(false);
  const [overstaff, setOverstaff] = useState('None');
  const [customersModuleEnabled, setCustomersModuleEnabled] = useState(false);
  const [tenantName, setTenantName] = useState('');
  const [tenantLocations, setTenantLocations] = useState<any[]>([]);

  useEffect(() => {
    fetchJobOrder();
    fetchCustomers();
    fetchJobTitles();
    fetchStaffingManagers();
    fetchUniformDefaults();
    fetchUserGroups();
    fetchTenantLocations();
    // eslint-disable-next-line
  }, [tenantId, jobOrderId]);

  // Listen for customers module status and tenant name
  useEffect(() => {
    if (!tenantId) return;

    // Listen for customers module status
    const customersModuleRef = doc(db, 'tenants', tenantId, 'modules', 'hrx-customers');
    const customersUnsubscribe = onSnapshot(customersModuleRef, (doc) => {
      if (doc.exists()) {
        const isEnabled = doc.data()?.isEnabled || false;
        setCustomersModuleEnabled(isEnabled);
      } else {
        setCustomersModuleEnabled(false);
      }
    }, (error) => {
      console.error('Error listening to customers module status:', error);
      setCustomersModuleEnabled(false);
    });

    // Get tenant name
    const tenantRef = doc(db, 'tenants', tenantId);
    const tenantUnsubscribe = onSnapshot(tenantRef, (doc) => {
      if (doc.exists()) {
        const data = doc.data();
        setTenantName(data?.name || 'Your Company');
      } else {
        setTenantName('Your Company');
      }
    }, (error) => {
      console.error('Error loading tenant name:', error);
      setTenantName('Your Company');
    });

    return () => {
      customersUnsubscribe();
      tenantUnsubscribe();
    };
  }, [tenantId]);

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
    if (editForm && editForm.visibility !== undefined) {
      setVisibility(editForm.visibility);
      setOriginalVisibility(editForm.visibility);
    }
  }, [editForm?.visibility]);

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
        setSelectedUniformId(
          data.uniformInstructions &&
            typeof data.uniformInstructions === 'string' &&
            uniformDefaults.some((u: any) => u.title === data.uniformInstructions)
            ? data.uniformInstructions
            : '',
        );
        setOriginalUniformId(
          data.uniformInstructions &&
            typeof data.uniformInstructions === 'string' &&
            uniformDefaults.some((u: any) => u.title === data.uniformInstructions)
            ? data.uniformInstructions
            : '',
        );
        setCustomUniform(
          data.uniformInstructions &&
            !uniformDefaults.some((u: any) => u.title === data.uniformInstructions)
            ? data.uniformInstructions
            : '',
        );
        setOriginalCustomUniform(
          data.uniformInstructions &&
            !uniformDefaults.some((u: any) => u.title === data.uniformInstructions)
            ? data.uniformInstructions
            : '',
        );
        setAdditionalStaffInstructions(data.additionalStaffInstructions || '');
        setOriginalAdditionalStaffInstructions(data.additionalStaffInstructions || '');
        setUserGroups(data.userGroupIds || []);
        setSelectedUserGroups(data.userGroupIds || []);
        setOriginalUserGroups(data.userGroupIds || []);
        setStatus(data.status || 'Active');
        setOriginalStatus(data.status || 'Active');
        setType(data.type || 'Gig');
        setOriginalType(data.type || 'Gig');
        setVisibility(data.visibility || 'Hidden');
        setOriginalVisibility(data.visibility || 'Hidden');
        setShowExactLocation(data.showExactLocation || false);
        setOverstaff(data.overstaff || 'None');
        if (data.customerId) fetchWorksites(data.customerId);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch job order');
    }
    setLoading(false);
  };

  const fetchCustomers = async () => {
    if (!tenantId) {
      setCustomers([]);
      return;
    }
    try {
      console.log('🔍 Fetching customers for tenant:', tenantId);
      // Fetch from the correct subcollection path: tenants/{tenantId}/customers
      const customersSnap = await getDocs(collection(db, 'tenants', tenantId, 'customers'));
      const customerDocs = customersSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      
      // Add the tenant as a customer option
      const tenantAsCustomer = {
        id: tenantId,
        name: tenantName,
        companyName: tenantName,
        email: tenantName,
        isTenant: true, // Flag to identify this is the tenant
      };
      customerDocs.unshift(tenantAsCustomer); // Add to beginning of array
      
      console.log('✅ Fetched customers:', customerDocs);
      setCustomers(customerDocs);
    } catch (error) {
      console.error('❌ Error in fetchCustomers:', error);
      setCustomers([]);
    }
  };

  const fetchWorksites = async (customerId: string) => {
    try {
      console.log('🔍 Fetching worksites for customer:', customerId, 'in tenant:', tenantId);
      
      // Check if the selected customer is actually the tenant
      const isTenant = customerId === tenantId;
      
      if (isTenant) {
        // Use tenant locations
        console.log('🔍 Using tenant locations for tenant:', customerId);
        setWorksites(tenantLocations);
      } else {
        // Use customer locations - correct path: tenants/{tenantId}/customers/{customerId}/locations
        console.log('🔍 Fetching customer locations for customer:', customerId);
        const q = collection(db, 'tenants', tenantId, 'customers', customerId, 'locations');
        const snapshot = await getDocs(q);
        const worksiteDocs = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        console.log('✅ Fetched customer worksites:', worksiteDocs);
        setWorksites(worksiteDocs);
      }
    } catch (error) {
      console.error('❌ Error in fetchWorksites:', error);
      setWorksites([]);
    }
  };

  const fetchJobTitles = async () => {
    if (!tenantId) return;
    try {
      console.log('🔍 Fetching job titles for tenant:', tenantId);
      
      // Try to get from hrx-flex module settings first
      const flexModuleRef = doc(db, 'tenants', tenantId, 'modules', 'hrx-flex');
      const flexDoc = await getDoc(flexModuleRef);
      
      if (flexDoc.exists() && flexDoc.data().jobTitles) {
        // If jobTitles exists in module settings, use that
        console.log('✅ Found job titles in flex module settings');
        setJobTitles(flexDoc.data().jobTitles);
      } else {
        // Fallback to subcollection
        console.log('🔍 Fetching job titles from subcollection');
        const jobTitlesCollection = collection(db, 'tenants', tenantId, 'modules', 'hrx-flex', 'jobTitles');
        const snapshot = await getDocs(jobTitlesCollection);
        const jobTitlesData = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        console.log('✅ Fetched job titles from subcollection:', jobTitlesData);
        setJobTitles(jobTitlesData);
      }
    } catch (error) {
      console.error('❌ Error in fetchJobTitles:', error);
      setJobTitles([]);
    }
  };



  const fetchStaffingManagers = async () => {
    try {
      const q = collection(db, 'users');
      const snapshot = await getDocs(q);
      setStaffingManagers(
        snapshot.docs
          .map((doc) => ({ id: doc.id, ...doc.data() }))
          .filter(
            (user: any) =>
              user.tenantId === tenantId &&
              ['5', '4', '3'].includes(user.securityLevel),
          ),
      );
    } catch {}
  };

  const fetchUniformDefaults = async () => {
    if (!tenantId) return;
    try {
      console.log('🔍 Fetching uniform defaults for tenant:', tenantId);
      
      // Try to get from hrx-flex module settings first
      const flexModuleRef = doc(db, 'tenants', tenantId, 'modules', 'hrx-flex');
      const flexDoc = await getDoc(flexModuleRef);
      
      if (flexDoc.exists() && flexDoc.data().uniformDefaults) {
        // If uniformDefaults exists in module settings, use that
        console.log('✅ Found uniform defaults in flex module settings');
        setUniformDefaults(flexDoc.data().uniformDefaults);
      } else {
        // Fallback to subcollection
        console.log('🔍 Fetching uniform defaults from subcollection');
        const uniformDefaultsCollection = collection(db, 'tenants', tenantId, 'modules', 'hrx-flex', 'uniformDefaults');
        const snapshot = await getDocs(uniformDefaultsCollection);
        const uniformDefaultsData = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        console.log('✅ Fetched uniform defaults from subcollection:', uniformDefaultsData);
        setUniformDefaults(uniformDefaultsData);
      }
    } catch (error) {
      console.error('❌ Error in fetchUniformDefaults:', error);
      setUniformDefaults([]);
    }
  };

  const fetchUserGroups = async () => {
    try {
      const q = collection(db, 'tenants', tenantId, 'userGroups');
      const snapshot = await getDocs(q);
      setUserGroups(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    } catch {}
  };

  const fetchTenantLocations = async () => {
    if (!tenantId) return;
    try {
      console.log('🔍 Fetching tenant locations for tenant:', tenantId);
      const locationsSnap = await getDocs(collection(db, 'tenants', tenantId, 'locations'));
      const locationDocs = locationsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      console.log('✅ Fetched tenant locations:', locationDocs);
      setTenantLocations(locationDocs);
    } catch (error) {
      console.error('❌ Error in fetchTenantLocations:', error);
      setTenantLocations([]);
    }
  };

  const handleEditChange = (field: string, value: any) => {
    setEditForm((prev: any) => ({ ...prev, [field]: value }));
  };

  const handleRateChange = (title: string, field: 'payRate' | 'billRate', value: string) => {
    setJobTitleRates((prevRates) =>
      prevRates.map((r: any) => (r.title === title ? { ...r, [field]: value } : r)),
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
        visibility,
        showExactLocation,
        overstaff,
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
      'overview',
      'settings',
      'locations',
      'billing',
      'contacts',
      'workforce',
      'userGroups',
      'tenants',
      'jobOrders',
      'shifts',
      'timesheets',
      'reports',
      'aiSettings',
      'activityLogs',
    ];
    if (newIndex !== 8) {
      navigate(`/tenants/${tenantId}?tab=${newIndex}`);
    }
  };

  const isChanged = editForm && originalForm ? (
    JSON.stringify(editForm) !== JSON.stringify(originalForm) ||
    JSON.stringify(jobTitleRates) !== JSON.stringify(originalRates) ||
    JSON.stringify(selectedManagers) !== JSON.stringify(originalManagers) ||
    selectedUniformId !== originalUniformId ||
    customUniform !== originalCustomUniform ||
    additionalStaffInstructions !== originalAdditionalStaffInstructions ||
    JSON.stringify(selectedUserGroups) !== JSON.stringify(originalUserGroups) ||
    status !== originalStatus ||
    type !== originalType ||
    visibility !== originalVisibility ||
    showExactLocation !== (editForm?.showExactLocation || false) ||
    overstaff !== (editForm?.overstaff || 'None')
  ) : false;

  if (!editForm) return <Typography>Loading...</Typography>;

  return (
    <Box sx={{ p: 0, width: '100%' }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start' }}>
        <Box sx={{ width: 48, mr: 2 }}>
          <Tabs
            orientation="vertical"
            value={sideTab}
            onChange={(_, v) => setSideTab(v)}
            sx={{ borderRight: 1, borderColor: 'divider', width: 48 }}
            TabIndicatorProps={{ sx: { left: 0, width: 4 } }}
          >
            <Tab
              icon={<InfoIcon />}
              sx={{
                minWidth: 0,
                maxWidth: 48,
                p: 0,
                justifyContent: 'center',
                alignItems: 'center',
              }}
            />
            <Tab
              icon={<CalendarMonthIcon />}
              sx={{
                minWidth: 0,
                maxWidth: 48,
                p: 0,
                justifyContent: 'center',
                alignItems: 'center',
              }}
            />
            <Tab
              icon={<AccessTimeIcon />}
              sx={{
                minWidth: 0,
                maxWidth: 48,
                p: 0,
                justifyContent: 'center',
                alignItems: 'center',
              }}
            />
          </Tabs>
        </Box>
        <Box sx={{ flex: 1 }}>
          {sideTab === 0 && (
            <>
              <Box display="flex" alignItems="center" justifyContent="space-between" mb={3}>
                <Typography variant="h6" gutterBottom>
                  Details: Job Order {editForm.jobOrderId || jobOrderId}
                </Typography>
                <Button variant="outlined" onClick={onBack || (() => navigate('/flex'))}>
                  &larr; Back to Job Orders
                </Button>
              </Box>
              <Box component="form" mb={3}>
                <Grid container spacing={2} mb={2}>
                  <Grid item xs={12} sm={4} md={4}>
                    <TextField
                      label="Title"
                      fullWidth
                      required
                      value={editForm.title}
                      onChange={(e) => handleEditChange('title', e.target.value)}
                    />
                  </Grid>
                  <Grid item xs={12} sm={2} md={2}>
                    <FormControl fullWidth required>
                      <InputLabel id="type-label">Type</InputLabel>
                      <Select
                        labelId="type-label"
                        value={type}
                        label="Type"
                        onChange={(e) => setType(e.target.value)}
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
                        onChange={(e) => setStatus(e.target.value)}
                      >
                        <MenuItem value="Active">Active</MenuItem>
                        <MenuItem value="Closed">Closed</MenuItem>
                        <MenuItem value="Cancelled">Cancelled</MenuItem>
                      </Select>
                    </FormControl>
                  </Grid>
                  <Grid item xs={12}>
                    <TextField
                      label="Description"
                      fullWidth
                      required
                      value={editForm.description}
                      onChange={(e) => handleEditChange('description', e.target.value)}
                      multiline
                      minRows={2}
                    />
                  </Grid>
                  {(customersModuleEnabled || editForm.customerId) && (
                    <>
                      <Grid item xs={12} sm={4}>
                        <Autocomplete
                          options={tenants}
                          getOptionLabel={(c) => c.companyName || c.name || c.email}
                          value={tenants.find((c) => c.id === editForm.customerId) || null}
                          onChange={(_, newValue) => {
                            handleEditChange('customerId', newValue ? newValue.id : '');
                            handleEditChange('worksiteId', ''); // Reset worksite when customer changes
                          }}
                          renderInput={(params) => (
                            <TextField {...params} label="Customer" fullWidth required />
                          )}
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
                          onChange={(e) => handleEditChange('worksiteId', e.target.value)}
                          disabled={!editForm.customerId}
                        >
                          {worksites.map((w) => (
                            <MenuItem key={w.id} value={w.id}>
                              {w.nickname || w.street || w.city || w.id}
                            </MenuItem>
                          ))}
                        </TextField>
                      </Grid>
                    </>
                  )}
                  <Grid item xs={12} sm={4}>
                    <TextField
                      label="PO Number"
                      fullWidth
                      value={editForm.poNum || ''}
                      onChange={(e) => handleEditChange('poNum', e.target.value)}
                    />
                  </Grid>
                  <Grid item xs={12} sm={2}>
                    <TextField
                      label="Start Date"
                      type="date"
                      fullWidth
                      required
                      value={editForm.startDate}
                      onChange={(e) => handleEditChange('startDate', e.target.value)}
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
                      onChange={(e) => handleEditChange('endDate', e.target.value)}
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
                        onChange={(e) =>
                          handleEditChange(
                            'jobTitleIds',
                            Array.isArray(e.target.value) ? e.target.value : [e.target.value],
                          )
                        }
                        input={<OutlinedInput label="Job Titles" />}
                        renderValue={(selected) => (
                          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                            {(selected as string[]).map((id) => {
                              const jt = jobTitles.find((j: any) => j.title === id);
                              return (
                                <Chip
                                  key={id}
                                  label={jt ? jt.title : id}
                                  onMouseDown={(e) => e.stopPropagation()}
                                  onDelete={() =>
                                    handleEditChange(
                                      'jobTitleIds',
                                      editForm.jobTitleIds.filter((jid: string) => jid !== id),
                                    )
                                  }
                                />
                              );
                            })}
                          </Box>
                        )}
                      >
                        {jobTitles.map((jt: any) => (
                          <MenuItem key={jt.title} value={jt.title}>
                            {jt.title}
                          </MenuItem>
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
                        onChange={(e) =>
                          setSelectedUserGroups(
                            Array.isArray(e.target.value) ? e.target.value : [e.target.value],
                          )
                        }
                        input={<OutlinedInput label="User Groups" />}
                        renderValue={(selected) => (
                          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                            {(selected as string[]).map((id) => {
                              const group = userGroups.find((g: any) => g.id === id);
                              return (
                                <Chip
                                  key={id}
                                  label={group ? group.title : id}
                                  onMouseDown={(e) => e.stopPropagation()}
                                  onDelete={() =>
                                    setSelectedUserGroups(
                                      selectedUserGroups.filter((gid: string) => gid !== id),
                                    )
                                  }
                                />
                              );
                            })}
                          </Box>
                        )}
                      >
                        {userGroups.map((g: any) => (
                          <MenuItem key={g.id} value={g.id}>
                            {g.title}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Grid>
                  <Grid item xs={12}>
                    <TableContainer
                      component={Paper}
                      sx={{
                        border: '1px solid',
                        borderColor: 'divider',
                        borderRadius: 2,
                        boxShadow: 'none',
                        background: 'transparent',
                        mt: 2,
                      }}
                    >
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
                                  onChange={(e) =>
                                    handleRateChange(rate.title, 'payRate', e.target.value)
                                  }
                                  size="small"
                                  placeholder="$"
                                />
                              </TableCell>
                              <TableCell>
                                <TextField
                                  value={rate.billRate}
                                  onChange={(e) =>
                                    handleRateChange(rate.title, 'billRate', e.target.value)
                                  }
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
                      getOptionLabel={(u) => `${u.firstName} ${u.lastName}`}
                      value={staffingManagers.filter((u) => selectedManagers.includes(u.id))}
                      onChange={(_, newValue) =>
                        setSelectedManagers(newValue.map((u: any) => u.id))
                      }
                      renderInput={(params) => (
                        <TextField
                          {...params}
                          label="Staffing Managers"
                          placeholder="Select managers"
                          fullWidth
                        />
                      )}
                      renderTags={(value, getTagProps) =>
                        value.map((option, index) => (
                          <Chip
                            label={`${option.firstName} ${option.lastName}`}
                            {...getTagProps({ index })}
                            key={option.id}
                          />
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
                        onChange={(e) => setSelectedUniformId(e.target.value)}
                      >
                        {uniformDefaults.map((u: any) => (
                          <MenuItem key={u.title} value={u.title}>
                            {u.title}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                    {selectedUniformId && (
                      <Button
                        variant="outlined"
                        color="error"
                        sx={{ mb: 2 }}
                        onClick={() => setSelectedUniformId('')}
                      >
                        Remove
                      </Button>
                    )}
                    <TextField
                      label="Or add custom uniform instructions"
                      value={customUniform}
                      onChange={(e) => setCustomUniform(e.target.value)}
                      fullWidth
                      multiline
                      minRows={2}
                      sx={{ mb: 2 }}
                      disabled={!!selectedUniformId}
                    />
                    {selectedUniformId && (
                      <Box sx={{ mb: 2 }}>
                        <Typography variant="body2" color="textSecondary">
                          {uniformDefaults.find((u: any) => u.title === selectedUniformId)
                            ?.description || ''}
                        </Typography>
                        {uniformDefaults.find((u: any) => u.title === selectedUniformId)
                          ?.imageUrl && (
                          <img
                            src={
                              uniformDefaults.find((u: any) => u.title === selectedUniformId)
                                ?.imageUrl
                            }
                            alt={selectedUniformId}
                            style={{
                              width: 64,
                              height: 64,
                              objectFit: 'cover',
                              borderRadius: 4,
                              marginTop: 8,
                            }}
                          />
                        )}
                      </Box>
                    )}
                  </Grid>
                  <Grid item xs={12}>
                    <TextField
                      label="Additional Staff Instructions"
                      value={additionalStaffInstructions}
                      onChange={(e) => setAdditionalStaffInstructions(e.target.value)}
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
                      onChange={(e) => handleEditChange('aiPrompts', e.target.value)}
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
                  <Grid item xs={12}>
                    <FormControl fullWidth required>
                      <InputLabel id="visibility-label">Job Board Visibility</InputLabel>
                      <Select
                        labelId="visibility-label"
                        value={visibility}
                        label="Visibility"
                        onChange={(e) => setVisibility(e.target.value)}
                      >
                        <MenuItem value="Hidden">Hidden</MenuItem>
                        <MenuItem value="Visible to Groups">Visible to Groups</MenuItem>
                        <MenuItem value="Visible to All">Visible to All</MenuItem>
                      </Select>
                    </FormControl>
                  </Grid>
                  {visibility !== 'Hidden' && (
                    <>
                      <Grid item xs={12} sm={6} md={4}>
                        <FormControlLabel
                          control={
                            <Switch
                              checked={showExactLocation}
                              onChange={(e) => setShowExactLocation(e.target.checked)}
                            />
                          }
                          label={"Show Exact Location"}
                        />
                      </Grid>
                      <Grid item xs={12} sm={6} md={4}>
                        <FormControl fullWidth>
                          <InputLabel id="overstaff-label">Overstaff</InputLabel>
                          <Select
                            labelId="overstaff-label"
                            value={overstaff}
                            label="Overstaff"
                            onChange={(e) => setOverstaff(e.target.value)}
                          >
                            <MenuItem value="None">None</MenuItem>
                            <MenuItem value="25%">25%</MenuItem>
                            <MenuItem value="50%">50%</MenuItem>
                            <MenuItem value="No Limit">No Limit</MenuItem>
                          </Select>
                        </FormControl>
                      </Grid>
                    </>
                  )}
                </Grid>
                <Button variant="contained" onClick={handleSave} disabled={loading || !isChanged}>
                  Save Changes
                </Button>
              </Box>
              <Typography variant="body2" color="textSecondary">
                Job Order ID: {editForm.jobOrderId || '-'} | Created At:{' '}
                {editForm.createdAt?.toDate
                  ? editForm.createdAt.toDate().toLocaleDateString()
                  : '-'}
              </Typography>
            </>
          )}
          {sideTab === 1 && (
            <JobOrderShiftsTab tenantId={tenantId} jobOrderId={jobOrder?.id || jobOrderId} />
          )}
          {sideTab === 2 && (
            <Box>
              <Typography variant="h6" gutterBottom>
                Timesheets: Job Order {editForm.jobOrderId || jobOrderId}
              </Typography>
              <Typography>Timesheets content for this job order will go here.</Typography>
            </Box>
          )}
        </Box>
      </Box>
      <Snackbar open={!!error} autoHideDuration={4000} onClose={() => setError('')}>
        <Alert severity="error" onClose={() => setError('')} sx={{ width: '100%' }}>
          {error}
        </Alert>
      </Snackbar>
      <Snackbar open={success} autoHideDuration={2000} onClose={() => setSuccess(false)}>
        <Alert severity="success" sx={{ width: '100%' }}>
          Job order updated!
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default JobOrderDetails; 