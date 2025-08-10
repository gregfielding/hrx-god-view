import React, { useEffect, useState } from 'react';
import {
  Box,
  Typography,
  TextField,
  Button,
  Grid,
  Snackbar,
  Alert,
  MenuItem,
  FormControl,
  InputLabel,
  Select,
  OutlinedInput,
  Fab,
} from '@mui/material';
import {
  collection,
  addDoc,
  getDocs,
  doc,
  getDoc,
  query,
  serverTimestamp,
  where,
  onSnapshot,
} from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { ArrowDropUp, ArrowDropDown, Add as AddIcon } from '@mui/icons-material';

import { db } from '../../firebase';
import BroadcastDialog from '../../components/BroadcastDialog';
import { useAuth } from '../../contexts/AuthContext';
import JobOrdersTable from '../../componentBlocks/JobOrdersTable';
import { getNextJobOrderId } from '../../utils/jobOrderUtils';

const TenantJobOrdersTab: React.FC<{ onViewJobOrder?: (jobOrderId: string) => void }> = ({ onViewJobOrder }) => {
  const { tenantId, accessRole, orgType } = useAuth();
  const [form, setForm] = useState({
    title: '',
    description: '',
    aiInstructions: '',
    customerId: '',
    worksiteId: '',
    poNum: '',
    type: '',
    startDate: '',
    endDate: '',
    jobTitleIds: [] as string[],
    visibility: 'Hidden',
  });
  const [jobOrders, setJobOrders] = useState<any[]>([]);
  const [tenants, setCustomers] = useState<any[]>([]);
  const [worksites, setWorksites] = useState<any[]>([]);
  const [jobTitles, setJobTitles] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const [tenantCustomerIds, setTenantCustomerIds] = useState<string[]>([]);
  const [worksiteInfo, setWorksiteInfo] = useState<
    Record<string, { nickname?: string; city?: string }>
  >({});
  const [sortField, setSortField] = useState<string>('');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [search, setSearch] = useState('');
  const [hasSearched, setHasSearched] = useState(false);
  const [customerFilter, setCustomerFilter] = useState<string>('');
  const [showForm, setShowForm] = useState(false);
  const [selectedJobOrders, setSelectedJobOrders] = useState<string[]>([]);
  const [showBroadcastDialog, setShowBroadcastDialog] = useState(false);
  const [worksiteSettings, setWorksiteSettings] = useState({
    workerAssignmentLocation: 'tenant', // 'tenant', 'customer', 'both'
  });
  const [tenantName, setTenantName] = useState('');
  const [tenantLocations, setTenantLocations] = useState<any[]>([]);
  const [jobsBoardModuleEnabled, setJobsBoardModuleEnabled] = useState(false);

  // Add view type helpers:
  const isGodView = accessRole && accessRole.startsWith('hrx_');
  const isTenantView = orgType === 'Tenant' && !isGodView;

  useEffect(() => {
    if (tenantId) {
      console.log('🚀 Starting data fetch for tenant:', tenantId);
      fetchTenantCustomerIds();
      fetchJobOrders();
      fetchJobTitles();
      fetchCustomers(); // Add this line
      fetchTenantLocations(); // Add this line
    }
  }, [tenantId]);

  // Load flex module worksite settings and tenant name
  useEffect(() => {
    if (!tenantId) return;

    // Listen for flex module worksite settings
    const flexModuleRef = doc(db, 'tenants', tenantId, 'modules', 'hrx-flex');
    const flexUnsubscribe = onSnapshot(flexModuleRef, (doc) => {
      if (doc.exists()) {
        const data = doc.data();
        setWorksiteSettings(prev => ({
          ...prev,
          ...data?.settings?.worksiteSettings,
        }));
      }
    }, (error) => {
      console.error('Error listening to flex module worksite settings:', error);
    });

    // Get tenant name
    const tenantRef = doc(db, 'tenants', tenantId);
    const tenantUnsubscribe = onSnapshot(tenantRef, (doc) => {
      if (doc.exists()) {
        const data = doc.data();
        setTenantName(data?.name || 'Your Company');
      }
    }, (error) => {
      console.error('Error loading tenant name:', error);
      setTenantName('Your Company');
    });

    return () => {
      flexUnsubscribe();
      tenantUnsubscribe();
    };
  }, [tenantId]);

  // Real-time listener for jobs board module status
  useEffect(() => {
    if (!tenantId) {
      setJobsBoardModuleEnabled(false);
      return;
    }

    const jobsBoardModuleRef = doc(db, 'tenants', tenantId, 'modules', 'hrx-jobs-board');
    const unsubscribe = onSnapshot(jobsBoardModuleRef, (doc) => {
      if (doc.exists()) {
        const isEnabled = doc.data()?.isEnabled || false;
        console.log('Jobs Board module status changed:', isEnabled);
        setJobsBoardModuleEnabled(isEnabled);
      } else {
        console.log('Jobs Board module document does not exist, defaulting to disabled');
        setJobsBoardModuleEnabled(false);
      }
    }, (error) => {
      console.error('Error listening to jobs board module status:', error);
      setJobsBoardModuleEnabled(false);
    });

    return () => unsubscribe();
  }, [tenantId]);

  // Refetch customers when worksite settings change
  useEffect(() => {
    if (tenantId && tenantName) {
      fetchCustomers();
    }
  }, [worksiteSettings.workerAssignmentLocation, tenantName]);

  // Handle tenant-only mode: automatically set customerId and load worksites
  useEffect(() => {
    if (worksiteSettings.workerAssignmentLocation === 'tenant' && tenantId) {
      setForm(prev => ({
        ...prev,
        customerId: tenantId,
      }));
      setWorksites(tenantLocations);
    }
  }, [worksiteSettings.workerAssignmentLocation, tenantId, tenantLocations]);

  useEffect(() => {
    if (form.customerId) fetchWorksites(form.customerId);
    else setWorksites([]);
  }, [form.customerId]);

  useEffect(() => {
    if (search.trim()) {
      setHasSearched(true);
    }
  }, [search]);

  const fetchTenantCustomerIds = async () => {
    if (!tenantId) return;
    try {
      console.log('🔍 Fetching tenant customer IDs for tenant:', tenantId);
      const tenantRef = doc(db, 'tenants', tenantId);
      const tenantSnap = await getDoc(tenantRef);
      if (tenantSnap.exists()) {
        const data = tenantSnap.data();
        // Get tenants from subcollection or from tenants array
        if (data.tenants && Array.isArray(data.tenants)) {
          setTenantCustomerIds(data.tenants);
        } else {
          // Fallback to subcollection
          console.log('🔍 Fetching tenants subcollection for tenant:', tenantId);
          const tenantsSnap = await getDocs(collection(db, 'tenants', tenantId, 'tenants'));
          setTenantCustomerIds(tenantsSnap.docs.map(doc => doc.id));
        }
      }
    } catch (error) {
      console.error('❌ Error in fetchTenantCustomerIds:', error);
      throw error;
    }
  };

  const fetchJobOrders = async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      console.log('🔍 Fetching job orders for tenant:', tenantId);
      const q = query(collection(db, 'jobOrders'), where('tenantId', '==', tenantId));
      const snapshot = await getDocs(q);
      const jobOrdersData: any[] = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      setJobOrders(jobOrdersData);

      // Gather all unique {tenantId, worksiteId} pairs
      const pairs = jobOrdersData
        .filter((order) => order.tenantId && order.worksiteId)
        .map((order) => ({ tenantId: order.tenantId, worksiteId: order.worksiteId }));
      const uniquePairs = Array.from(
        new Set(pairs.map((p) => p.tenantId + '|' + p.worksiteId)),
      ).map((key) => {
        const [tenantId, worksiteId] = key.split('|');
        return { tenantId, worksiteId };
      });

      // Fetch all referenced worksites
      console.log('🔍 Fetching worksite info for pairs:', uniquePairs);
      const worksiteMap: Record<string, { nickname?: string; city?: string }> = {};
      await Promise.all(
        uniquePairs.map(async ({ tenantId, worksiteId }) => {
          try {
            console.log('🔍 Fetching worksite:', worksiteId, 'for tenant:', tenantId);
            
            // First try tenant locations
            const locRef = doc(db, 'tenants', tenantId, 'locations', worksiteId);
            const locSnap = await getDoc(locRef);
            
            if (locSnap.exists()) {
              const data = locSnap.data();
              worksiteMap[worksiteId] = { nickname: data.nickname, city: data.city };
              console.log('✅ Found worksite in tenant locations:', data.nickname);
            } else {
              // If not found in tenant locations, try customer locations
              console.log('🔍 Worksite not found in tenant locations, checking customer locations...');
              
              // Get all customers for this tenant
              const customersSnap = await getDocs(collection(db, 'tenants', tenantId, 'customers'));
              const customers = customersSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));
              
              // Check each customer's locations
              for (const customer of customers) {
                try {
                  const customerLocRef = doc(db, 'tenants', tenantId, 'customers', customer.id, 'locations', worksiteId);
                  const customerLocSnap = await getDoc(customerLocRef);
                  
                  if (customerLocSnap.exists()) {
                    const data = customerLocSnap.data();
                    worksiteMap[worksiteId] = { nickname: data.nickname, city: data.city };
                    console.log('✅ Found worksite in customer locations:', data.nickname, 'for customer:', customer.name);
                    break; // Found it, no need to check other customers
                  }
                } catch (customerError) {
                  console.log('❌ Error checking customer locations for customer:', customer.id, customerError);
                }
              }
              
              // If still not found, log it
              if (!worksiteMap[worksiteId]) {
                console.log('❌ Worksite not found in any locations:', worksiteId);
              }
            }
          } catch (error) {
            console.error('❌ Error fetching worksite:', worksiteId, 'for tenant:', tenantId, error);
          }
        }),
      );
      setWorksiteInfo(worksiteMap);
    } catch (err: any) {
      console.error('❌ Error in fetchJobOrders:', err);
      setError(err.message || 'Failed to fetch job orders');
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
      
      // If "Both" is selected, add the tenant as a customer option
      if (worksiteSettings.workerAssignmentLocation === 'both') {
        const tenantAsCustomer = {
          id: tenantId,
          name: tenantName,
          companyName: tenantName,
          email: tenantName,
          isTenant: true, // Flag to identify this is the tenant
        };
        customerDocs.unshift(tenantAsCustomer); // Add to beginning of array
      }
      
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

  // Using the centralized getNextJobOrderId function from utils
  const getNextJobOrderIdLocal = async () => {
    return await getNextJobOrderId(tenantId || '');
  };

  const isFormValid =
    form.title &&
    form.description &&
    (worksiteSettings.workerAssignmentLocation === 'tenant' ? true : form.customerId) &&
    form.worksiteId &&
    form.startDate &&
    form.endDate &&
    form.jobTitleIds.length > 0;

  const handleJobOrderSelection = (jobOrderId: string) => {
    setSelectedJobOrders((prev) =>
      prev.includes(jobOrderId) ? prev.filter((id) => id !== jobOrderId) : [...prev, jobOrderId],
    );
  };

  const handleSelectAll = () => {
    if (selectedJobOrders.length === jobOrders.length) {
      setSelectedJobOrders([]);
    } else {
      setSelectedJobOrders(jobOrders.map((order) => order.id));
    }
  };

  const handleBroadcastSuccess = (result: any) => {
    setShowBroadcastDialog(false);
    setSuccess(true);
    setTimeout(() => setSuccess(false), 3000);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isFormValid || !tenantId) return;

    setLoading(true);
    setError('');

    try {
      const jobOrderId = await getNextJobOrderIdLocal();
      const jobOrderData = {
        ...form,
        tenantId, // The actual tenant ID (current tenant)
        customerId: form.customerId, // The selected customer ID
        jobOrderId,
        createdAt: serverTimestamp(),
        status: 'Active',
      };

      await addDoc(collection(db, 'jobOrders'), jobOrderData);

      setForm({
        title: '',
        description: '',
        aiInstructions: '',
        customerId: '',
        worksiteId: '',
        poNum: '',
        type: '',
        startDate: '',
        endDate: '',
        jobTitleIds: [],
        visibility: 'Hidden',
      });
      setShowForm(false);
      setSuccess(true);
      fetchJobOrders();
    } catch (err: any) {
      setError(err.message || 'Failed to create job order');
    }
    setLoading(false);
  };

  const getSortValue = (order: any, field: string): string | number | Date => {
    switch (field) {
      case 'title':
        return order.title || '';
      case 'customer':
        return tenants.find((c) => c.id === order.tenantId)?.name || '';
      case 'worksite':
        return worksiteInfo[order.worksiteId]?.nickname || '';
      case 'type':
        return order.type || '';
      case 'startDate':
        return order.startDate || '';
      case 'endDate':
        return order.endDate || '';
      default:
        return '';
    }
  };

  const getFilteredSortedJobOrders = () => {
    let filtered = jobOrders;

    // Apply search filter
    if (search.trim()) {
      const searchLower = search.toLowerCase();
      filtered = filtered.filter(
        (order) =>
          order.title?.toLowerCase().includes(searchLower) ||
          order.description?.toLowerCase().includes(searchLower) ||
          order.poNum?.toLowerCase().includes(searchLower),
      );
    }

    // Apply customer filter
    if (customerFilter) {
      filtered = filtered.filter((order) => order.tenantId === customerFilter);
    }

    // Apply sorting
    if (sortField) {
      filtered.sort((a, b) => {
        const aValue = getSortValue(a, sortField);
        const bValue = getSortValue(b, sortField);

        if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
        if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
        return 0;
      });
    }

    return filtered;
  };

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const SortableHeader = ({ field, children }: { field: string; children: React.ReactNode }) => (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        cursor: 'pointer',
        '&:hover': { opacity: 0.7 },
      }}
      onClick={() => handleSort(field)}
    >
      {children}
      {sortField === field ? (
        sortDirection === 'asc' ? (
          <ArrowDropUp fontSize="small" />
        ) : (
          <ArrowDropDown fontSize="small" />
        )
      ) : (
        <Box sx={{ width: 20 }} />
      )}
    </Box>
  );

  if (showForm) {
    return (
      <Box sx={{ p: 0 }}>
        <Typography variant="h6" gutterBottom>
          Add Job Order
        </Typography>
        <form onSubmit={handleSubmit}>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6} md={3}>
              <TextField
                label="Title"
                fullWidth
                required
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </Grid>
            {/* Customer dropdown - only show if not "tenant only" */}
            {worksiteSettings.workerAssignmentLocation !== 'tenant' && (
              <Grid item xs={12} sm={6} md={3}>
                <FormControl fullWidth required>
                  <InputLabel>Customer</InputLabel>
                  <Select
                    value={form.customerId}
                    onChange={async (e) => {
                      const newCustomerId = e.target.value;
                      setForm({
                        ...form,
                        customerId: newCustomerId,
                        worksiteId: '', // Reset worksite when customer changes
                      });
                      await fetchWorksites(newCustomerId);
                    }}
                    label="Customer"
                  >
                    {tenants.map((customer) => (
                      <MenuItem key={customer.id} value={customer.id}>
                        {customer.companyName || customer.name || customer.email}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
            )}
            <Grid item xs={12} sm={6} md={3}>
              <FormControl fullWidth required>
                <InputLabel>Location</InputLabel>
                <Select
                  value={form.worksiteId}
                  onChange={(e) => setForm({ ...form, worksiteId: e.target.value })}
                  label="Location"
                  disabled={worksiteSettings.workerAssignmentLocation !== 'tenant' && !form.customerId}
                >
                  {worksites.map((worksite) => (
                    <MenuItem key={worksite.id} value={worksite.id}>
                      {worksite.nickname || worksite.street || worksite.city || worksite.id}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <TextField
                label="PO Number"
                fullWidth
                value={form.poNum}
                onChange={(e) => setForm({ ...form, poNum: e.target.value })}
              />
            </Grid>
            {/* <Grid item xs={12} sm={6} md={3}>
              <FormControl fullWidth required>
                <InputLabel>Type</InputLabel>
                <Select
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value })}
                  label="Type"
                >
                  <MenuItem value="Temporary">Temporary</MenuItem>
                  <MenuItem value="Contract">Contract</MenuItem>
                  <MenuItem value="Permanent">Permanent</MenuItem>
                  <MenuItem value="Project">Project</MenuItem>
                </Select>
              </FormControl>
            </Grid> */}
            <Grid item xs={12} sm={6} md={3}>
              <TextField
                label="Start Date"
                type="date"
                fullWidth
                required
                value={form.startDate}
                onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <TextField
                label="End Date"
                type="date"
                fullWidth
                required
                value={form.endDate}
                onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            {jobsBoardModuleEnabled && (
              <Grid item xs={12} sm={6} md={3}>
                <FormControl fullWidth required>
                  <InputLabel>Jobs Board Visibility</InputLabel>
                  <Select
                    value={form.visibility}
                    onChange={(e) => setForm({ ...form, visibility: e.target.value })}
                    label="Job Board Visibility"
                  >
                    <MenuItem value="Hidden">Hidden</MenuItem>
                    <MenuItem value="Visible to Groups">Visible to Groups</MenuItem>
                    <MenuItem value="Visible to All">Visible to All</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
            )}
            <Grid item xs={12} sm={12} md={6}>
              <TextField
                label="Description"
                fullWidth
                required
                multiline
                minRows={4}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={12} md={6}>
              <TextField
                label="AI Instructions"
                fullWidth
                multiline
                minRows={4}
                value={form.aiInstructions}
                onChange={(e) => setForm({ ...form, aiInstructions: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={12} md={6}>
              <FormControl fullWidth required>
                <InputLabel>Job Titles</InputLabel>
                <Select
                  multiple
                  value={form.jobTitleIds}
                  onChange={(e) => setForm({ ...form, jobTitleIds: Array.isArray(e.target.value) ? e.target.value : [e.target.value] })}
                  input={<OutlinedInput label="Job Titles" />}
                  renderValue={(selected) => (selected as string[]).join(', ')}
                >
                  {jobTitles.map((jt: any) => (
                    <MenuItem key={jt.id || jt.title} value={jt.title}>
                      {jt.title}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
          </Grid>
          <Box mt={3} display="flex" justifyContent="flex-end" gap={2}>
            <Button variant="contained" color="primary" type="submit" disabled={loading}>
              Create
            </Button>
            <Button variant="outlined" onClick={() => setShowForm(false)} disabled={loading}>
              Cancel
            </Button>
          </Box>
        </form>
        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>
        )}
      </Box>
    );
  }

  return (
    <Box sx={{ width: '100%' }}>
      {/* Header */}
      <Typography variant="h6" gutterBottom>
        Job Orders
      </Typography>

      {/* Search, Filters, and Actions */}
      <Box sx={{ display: 'flex', gap: 2, mb: 3, alignItems: 'center', flexWrap: 'wrap' }}>
        <TextField
          label="Search Job Orders"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by title, description, or PO number..."
          sx={{ minWidth: 250, flex: 1 }}
        />
        {(isGodView || isTenantView) && (
          <FormControl sx={{ minWidth: 200 }}>
            <InputLabel>Filter by Customer</InputLabel>
            <Select
              value={customerFilter}
              onChange={(e) => setCustomerFilter(e.target.value)}
              label="Filter by Customer"
            >
              <MenuItem value="">All Customers</MenuItem>
              {tenants.map((customer) => (
                <MenuItem key={customer.id} value={customer.id}>
                  {customer.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        )}
        {(search.trim() || customerFilter) && (
          <Button
            variant="outlined"
            onClick={() => {
              setSearch('');
              setCustomerFilter('');
              setHasSearched(false);
            }}
          >
            Clear Filters
          </Button>
        )}
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setShowForm(true)}
          disabled={loading}
          sx={{ ml: 'auto' }}
        >
          New Job Order
        </Button>
      </Box>

      {/* Job Orders Table */}
      <JobOrdersTable
        jobOrders={getFilteredSortedJobOrders()}
        showTenantColumn={isGodView || isTenantView}
        tenants={[{ id: tenantId || '', name: tenantName }]}
        customers={tenants}
        worksiteInfo={worksiteInfo}
        onView={(id) => onViewJobOrder ? onViewJobOrder(id) : navigate(`/joborders/${id}`)}
        selectedJobOrders={selectedJobOrders}
        onSelect={handleJobOrderSelection}
        onSelectAll={handleSelectAll}
      />

      {/* Broadcast Button */}
      {selectedJobOrders.length > 0 && (
        <Fab
          color="primary"
          aria-label="broadcast"
          sx={{ position: 'fixed', bottom: 16, right: 16 }}
          onClick={() => setShowBroadcastDialog(true)}
        >
          <AddIcon />
        </Fab>
      )}

      {/* Alerts */}
      <Snackbar open={success} autoHideDuration={6000} onClose={() => setSuccess(false)}>
        <Alert onClose={() => setSuccess(false)} severity="success">
          Job order created successfully!
        </Alert>
      </Snackbar>

      <Snackbar open={!!error} autoHideDuration={6000} onClose={() => setError('')}>
        <Alert onClose={() => setError('')} severity="error">
          {error}
        </Alert>
      </Snackbar>

      {/* Broadcast Dialog */}
      <BroadcastDialog
        open={showBroadcastDialog}
        onClose={() => setShowBroadcastDialog(false)}
        onSuccess={handleBroadcastSuccess}
        tenantId={tenantId || ''}
        senderId={tenantId || ''}
        initialAudienceFilter={{
          jobOrderId: selectedJobOrders[0], // For now, just use the first selected job order
        }}
        title="Broadcast to Job Order Workers"
      />
    </Box>
  );
};

export default TenantJobOrdersTab; 