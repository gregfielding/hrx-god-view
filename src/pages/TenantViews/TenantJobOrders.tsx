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
  MenuItem,
  FormControl,
  InputLabel,
  Select,
  OutlinedInput,
  Chip,
  Checkbox,
  AppBar,
  Toolbar,
  IconButton,
  Fab,
} from '@mui/material';
import {
  collection,
  addDoc,
  getDocs,
  doc,
  getDoc,
  query,
  orderBy,
  limit,
  serverTimestamp,
  where,
  onSnapshot,
} from 'firebase/firestore';
import { db } from '../../firebase';
import { useNavigate } from 'react-router-dom';
import { ArrowDropUp, ArrowDropDown, Add as AddIcon } from '@mui/icons-material';
import Autocomplete from '@mui/material/Autocomplete';
import BroadcastDialog from '../../components/BroadcastDialog';
import { useAuth } from '../../contexts/AuthContext';
import JobOrdersTable from '../../componentBlocks/JobOrdersTable';

const TenantJobOrders: React.FC = () => {
  const { tenantId, accessRole, orgType } = useAuth();
  const [form, setForm] = useState({
    title: '',
    description: '',
    tenantId: '',
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
  const [timesheetsEnabled, setTimesheetsEnabled] = useState(false);

  // Add view type helpers:
  const isGodView = accessRole && accessRole.startsWith('hrx_');
  const isTenantView = orgType === 'Tenant' && !isGodView;

  useEffect(() => {
    if (tenantId) {
      fetchTenantCustomerIds();
      fetchJobOrders();
      fetchJobTitles();
    }
  }, [tenantId]);

  // Real-time listener for flex module timesheets setting
  useEffect(() => {
    if (!tenantId) {
      setTimesheetsEnabled(false);
      return;
    }
    
    const flexModuleRef = doc(db, 'tenants', tenantId, 'modules', 'hrx-flex');
    const unsubscribe = onSnapshot(flexModuleRef, (doc) => {
      if (doc.exists()) {
        const data = doc.data();
        setTimesheetsEnabled(data?.settings?.enableTimesheets || false);
      } else {
        setTimesheetsEnabled(false);
      }
    }, (error) => {
      console.error('Error listening to flex module timesheets setting:', error);
      setTimesheetsEnabled(false);
    });
    
    return () => unsubscribe();
  }, [tenantId]);

  useEffect(() => {
    fetchCustomers();
  }, [tenantCustomerIds]);

  useEffect(() => {
    if (form.tenantId) fetchWorksites(form.tenantId);
    else setWorksites([]);
  }, [form.tenantId]);

  const fetchTenantCustomerIds = async () => {
    if (!tenantId) return;
    const tenantRef = doc(db, 'tenants', tenantId);
    const tenantSnap = await getDoc(tenantRef);
    if (tenantSnap.exists()) {
      const data = tenantSnap.data();
      // Get tenants from subcollection or from tenants array
      if (data.tenants && Array.isArray(data.tenants)) {
        setTenantCustomerIds(data.tenants);
      } else {
        // Fallback to subcollection
        const tenantsSnap = await getDocs(collection(db, 'tenants', tenantId, 'tenants'));
        setTenantCustomerIds(tenantsSnap.docs.map(doc => doc.id));
      }
    }
  };

  const fetchJobOrders = async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
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
      const worksiteMap: Record<string, { nickname?: string; city?: string }> = {};
      await Promise.all(
        uniquePairs.map(async ({ tenantId, worksiteId }) => {
          try {
            const locRef = doc(db, 'tenants', tenantId, 'locations', worksiteId);
            const locSnap = await getDoc(locRef);
            if (locSnap.exists()) {
              const data = locSnap.data();
              worksiteMap[worksiteId] = { nickname: data.nickname, city: data.city };
            }
          } catch {}
        }),
      );
      setWorksiteInfo(worksiteMap);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch job orders');
    }
    setLoading(false);
  };

  const fetchCustomers = async () => {
    if (tenantCustomerIds.length === 0) {
      setCustomers([]);
      return;
    }
    const customerDocs = await Promise.all(
      tenantCustomerIds.map(async (id) => {
        const snap = await getDoc(doc(db, 'tenants', id));
        return snap.exists() ? { id, ...snap.data() } : null;
      }),
    );
    setCustomers(customerDocs.filter(Boolean));
  };

  const fetchWorksites = async (tenantId: string) => {
    try {
      const q = collection(db, 'tenants', tenantId, 'locations');
      const snapshot = await getDocs(q);
      setWorksites(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    } catch {}
  };

  const fetchJobTitles = async () => {
    if (!tenantId) return;
    try {
      const settingsRef = doc(db, 'tenants', tenantId, 'settings', 'main');
      const snap = await getDoc(settingsRef);
      setJobTitles(snap.exists() ? snap.data().jobTitles || [] : []);
    } catch {}
  };

  const getNextJobOrderId = async () => {
    if (!tenantId) return 1000;
    const q = query(
      collection(db, 'tenants', tenantId, 'jobOrders'),
      orderBy('jobOrderId', 'desc'),
      limit(1),
    );
    const snapshot = await getDocs(q);
    if (!snapshot.empty) {
      const lastId = snapshot.docs[0].data().jobOrderId;
      return lastId + 1;
    }
    return 1000;
  };

  const isFormValid =
    form.title &&
    form.description &&
    form.tenantId &&
    form.worksiteId &&
    form.type &&
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
      const jobOrderId = await getNextJobOrderId();
      const jobOrderData = {
        ...form,
        tenantId,
        jobOrderId,
        createdAt: serverTimestamp(),
        status: 'Active',
      };

      await addDoc(collection(db, 'jobOrders'), jobOrderData);

      setForm({
        title: '',
        description: '',
        tenantId: '',
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

    if (search) {
      const searchLower = search.toLowerCase();
      filtered = filtered.filter(
        (order) =>
          order.title?.toLowerCase().includes(searchLower) ||
          order.description?.toLowerCase().includes(searchLower) ||
          order.poNum?.toLowerCase().includes(searchLower),
      );
    }

    if (customerFilter) {
      filtered = filtered.filter((order) => order.tenantId === customerFilter);
    }

    if (sortField) {
      filtered.sort((a, b) => {
        const aVal = getSortValue(a, sortField);
        const bVal = getSortValue(b, sortField);
        if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
        if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
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
    <TableCell
      style={{ cursor: 'pointer', userSelect: 'none' }}
      onClick={() => handleSort(field)}
    >
      <Box display="flex" alignItems="center">
        {children}
        {sortField === field && (
          <Box ml={0.5}>
            {sortDirection === 'asc' ? <ArrowDropUp /> : <ArrowDropDown />}
          </Box>
        )}
      </Box>
    </TableCell>
  );

  if (!tenantId) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <Typography variant="h6" color="text.secondary">
          No tenant assigned to your account.
        </Typography>
      </Box>
    );
  }

  if (showForm) {
    return (
      <Box sx={{ bgcolor: 'background.paper', borderRadius: 2, p: 0, mb: 4, boxShadow: 1, maxWidth: 1200, mx: 'auto' }}>
        <Typography variant="h6" gutterBottom>
          Add New Job Order
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
            <Grid item xs={12} sm={6} md={3}>
              <FormControl fullWidth required>
                <InputLabel>Customer</InputLabel>
                <Select
                  value={form.tenantId}
                  onChange={(e) => setForm({ ...form, tenantId: e.target.value })}
                  label="Customer"
                >
                  {tenants.map((customer) => (
                    <MenuItem key={customer.id} value={customer.id}>
                      {customer.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <FormControl fullWidth required>
                <InputLabel>Worksite</InputLabel>
                <Select
                  value={form.worksiteId}
                  onChange={(e) => setForm({ ...form, worksiteId: e.target.value })}
                  label="Worksite"
                  disabled={!form.tenantId}
                >
                  {worksites.map((w) => (
                    <MenuItem key={w.id} value={w.id}>
                      {w.nickname}
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
            <Grid item xs={12} sm={6} md={3}>
              <FormControl fullWidth required>
                <InputLabel>Type</InputLabel>
                <Select
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value })}
                  label="Type"
                >
                  <MenuItem value="Gig">Gig</MenuItem>
                  <MenuItem value="Career">Career</MenuItem>
                </Select>
              </FormControl>
            </Grid>
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
            <Grid item xs={12} sm={6} md={3}>
              <FormControl fullWidth required>
                <InputLabel>Visibility</InputLabel>
                <Select
                  value={form.visibility}
                  onChange={(e) => setForm({ ...form, visibility: e.target.value })}
                  label="Visibility"
                >
                  <MenuItem value="Hidden">Hidden</MenuItem>
                  <MenuItem value="Visible to Groups">Visible to Groups</MenuItem>
                  <MenuItem value="Visible to All">Visible to All</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={12} md={6}>
              <TextField
                label="Description"
                fullWidth
                required
                multiline
                minRows={2}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
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
                    <MenuItem key={jt.title} value={jt.title}>
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
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3, mt: 0 }}>
        <Typography variant="h4">Job Orders</Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setShowForm(true)}
          disabled={loading}
        >
          New Job Order
        </Button>
      </Box>

      {/* Content */}
      <Box sx={{ flex: 1, p: 0, overflow: 'auto' }}>
        {/* Search and Filters */}
        <Grid container spacing={2} sx={{ mb: 3 }}>
          <Grid item xs={12} md={6}>
            <TextField
              fullWidth
              label="Search Job Orders"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by title, description, or PO number..."
            />
          </Grid>
          {(isGodView || isTenantView) && (
            <Grid item xs={12} md={3}>
              <FormControl fullWidth>
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
            </Grid>
          )}
          <Grid item xs={12} md={3}>
            <Button
              fullWidth
              variant="outlined"
              onClick={() => {
                setSearch('');
                setCustomerFilter('');
                setHasSearched(false);
              }}
            >
              Clear Filters
            </Button>
          </Grid>
        </Grid>

        {/* Job Orders Table */}
        <JobOrdersTable
          jobOrders={getFilteredSortedJobOrders()}
          showTenantColumn={isGodView || isTenantView}
          tenants={tenants}
          worksiteInfo={worksiteInfo}
          onView={(id) => navigate(`/joborders/${id}`)}
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
      </Box>

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

export default TenantJobOrders; 