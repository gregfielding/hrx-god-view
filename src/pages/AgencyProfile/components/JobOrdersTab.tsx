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
} from 'firebase/firestore';
import { db } from '../../../firebase';
import { useNavigate } from 'react-router-dom';
import JobOrderDetails from './JobOrderDetails';
import { ArrowDropUp, ArrowDropDown } from '@mui/icons-material';
import Autocomplete from '@mui/material/Autocomplete';
import BroadcastDialog from '../../../components/BroadcastDialog';

const JobOrdersTab: React.FC<{ tenantId: string }> = ({ tenantId }) => {
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

  useEffect(() => {
    fetchTenantCustomerIds();
    fetchJobOrders();
    fetchJobTitles();
    // eslint-disable-next-line
  }, [tenantId]);

  useEffect(() => {
    fetchCustomers();
    // eslint-disable-next-line
  }, [tenantCustomerIds]);

  useEffect(() => {
    if (form.tenantId) fetchWorksites(form.tenantId);
    else setWorksites([]);
  }, [form.tenantId]);

  const fetchTenantCustomerIds = async () => {
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
    try {
      const settingsRef = doc(db, 'tenants', tenantId, 'settings', 'main');
      const snap = await getDoc(settingsRef);
      setJobTitles(snap.exists() ? snap.data().jobTitles || [] : []);
    } catch {}
  };

  const getNextJobOrderId = async () => {
    try {
      console.log('🔍 Getting next job order ID for tenant:', tenantId);
      const q = query(
        collection(db, 'jobOrders'),
        where('tenantId', '==', tenantId),
        orderBy('jobOrderId', 'desc'),
        limit(1),
      );
      const snapshot = await getDocs(q);
      if (!snapshot.empty) {
        const lastId = snapshot.docs[0].data().jobOrderId;
        console.log('✅ Found last job order ID:', lastId, 'Next will be:', lastId + 1);
        return lastId + 1;
      }
      console.log('✅ No existing job orders found, starting with 1000');
      return 1000;
    } catch (error) {
      console.error('❌ Error in getNextJobOrderId:', error);
      throw error;
    }
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
    if (selectedJobOrders.length === filteredSortedJobOrders.length) {
      setSelectedJobOrders([]);
    } else {
      setSelectedJobOrders(filteredSortedJobOrders.map((order) => order.id));
    }
  };

  const handleBroadcastSuccess = (result: any) => {
    setSuccess(true);
    setSelectedJobOrders([]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const jobOrderId = await getNextJobOrderId();
      await addDoc(collection(db, 'tenants', tenantId, 'jobOrders'), {
        ...form,
        jobOrderId,
        createdAt: serverTimestamp(),
        status: 'Active',
        visibility: form.visibility || 'Hidden',
      });
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
      setSuccess(true);
      fetchJobOrders();
    } catch (err: any) {
      setError(err.message || 'Failed to add job order');
    }
    setLoading(false);
  };

  const getSortValue = (order: any, field: string): string | number | Date => {
    if (field === 'jobOrderId') return order.jobOrderId ?? 0;
    if (field === 'customer')
      return tenants.find((c: any) => c.id === order.tenantId)?.name || '';
    if (field === 'worksite') {
      const info = worksiteInfo[order.worksiteId];
      if (info) {
        if (info.nickname && info.city) return `${info.nickname} (${info.city})`;
        if (info.nickname) return info.nickname;
        if (info.city) return info.city;
      }
      return '';
    }
    if (field === 'poNum') return order.poNum || '';
    if (field === 'createdAt')
      return order.createdAt?.toDate ? order.createdAt.toDate() : new Date(0);
    if (field === 'startDate') return order.startDate ? new Date(order.startDate) : new Date(0);
    if (field === 'endDate') return order.endDate ? new Date(order.endDate) : new Date(0);
    if (field === 'status') return order.status || '';
    return '';
  };

  const getFilteredSortedJobOrders = () => {
    let filtered = jobOrders;
    if (search.trim()) {
      const searchLower = search.trim().toLowerCase();
      filtered = filtered.filter((order) =>
        (order.title || '').toLowerCase().includes(searchLower),
      );
    }
    if (customerFilter) {
      filtered = filtered.filter((order) => order.tenantId === customerFilter);
    }
    // Now sort
    if (!sortField) return filtered;
    const sorted = [...filtered].sort((a, b) => {
      let aValue = getSortValue(a, sortField);
      let bValue = getSortValue(b, sortField);
      if (aValue instanceof Date && bValue instanceof Date) {
        return sortDirection === 'asc'
          ? aValue.getTime() - bValue.getTime()
          : bValue.getTime() - aValue.getTime();
      }
      if (typeof aValue === 'number' && typeof bValue === 'number') {
        return sortDirection === 'asc' ? aValue - bValue : bValue - aValue;
      }
      aValue = (aValue as string).toLowerCase();
      bValue = (bValue as string).toLowerCase();
      if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
    return sorted;
  };

  const filteredSortedJobOrders = getFilteredSortedJobOrders();

  return (
    <Box sx={{ p: 0, width: '100%' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Typography variant="h4">Job Orders</Typography>
        <Button
          variant="contained"
          color="primary"
          onClick={() => setShowForm(true)}
        >
          + New Job Order
        </Button>
      </Box>
      {showForm && (
        <>
          <Typography variant="h6" gutterBottom>
            Add Job Order
          </Typography>
          <form onSubmit={handleSubmit}>
            <Grid container spacing={2} mb={2}>
              <Grid item xs={12} sm={4}>
                <TextField
                  label="Title"
                  fullWidth
                  required
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                />
              </Grid>
              <Grid item xs={12} sm={8}>
                <TextField
                  label="Description"
                  fullWidth
                  required
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  multiline
                />
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField
                  select
                  label="Customer"
                  fullWidth
                  required
                  value={form.tenantId}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, tenantId: e.target.value, worksiteId: '' }))
                  }
                >
                  {tenants.map((c) => (
                    <MenuItem key={c.id} value={c.id}>
                      {c.name}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField
                  select
                  label="Worksite"
                  fullWidth
                  required
                  value={form.worksiteId}
                  onChange={(e) => setForm((f) => ({ ...f, worksiteId: e.target.value }))}
                  disabled={!form.tenantId}
                >
                  {worksites.map((w) => (
                    <MenuItem key={w.id} value={w.id}>
                      {w.nickname}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField
                  select
                  label="Type"
                  fullWidth
                  required
                  value={form.type}
                  onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
                >
                  <MenuItem value="Gig">Gig</MenuItem>
                  <MenuItem value="Career">Career</MenuItem>
                </TextField>
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField
                  label="PO Number"
                  fullWidth
                  value={form.poNum}
                  onChange={(e) => setForm((f) => ({ ...f, poNum: e.target.value }))}
                />
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField
                  select
                  label="Visibility"
                  fullWidth
                  required
                  value={form.visibility}
                  onChange={(e) => setForm((f) => ({ ...f, visibility: e.target.value }))}
                >
                  <MenuItem value="Hidden">Hidden</MenuItem>
                  <MenuItem value="Visible to Groups">Visible to Groups</MenuItem>
                  <MenuItem value="Visible to All">Visible to All</MenuItem>
                </TextField>
              </Grid>
              <Grid item xs={12} sm={2}>
                <TextField
                  label="Start Date"
                  type="date"
                  fullWidth
                  required
                  value={form.startDate}
                  onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
                  InputLabelProps={{ shrink: true }}
                />
              </Grid>
              <Grid item xs={12} sm={2}>
                <TextField
                  label="End Date"
                  type="date"
                  fullWidth
                  required
                  value={form.endDate}
                  onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
                  InputLabelProps={{ shrink: true }}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <FormControl fullWidth required>
                  <InputLabel id="job-titles-label">Job Titles</InputLabel>
                  <Select
                    labelId="job-titles-label"
                    multiple
                    value={form.jobTitleIds}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        jobTitleIds: Array.isArray(e.target.value)
                          ? e.target.value
                          : [e.target.value],
                      }))
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
                                setForm((f) => ({
                                  ...f,
                                  jobTitleIds: f.jobTitleIds.filter((jid: string) => jid !== id),
                                }))
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
              <Grid item xs={12} display="flex" gap={2}>
                <Button
                  type="submit"
                  variant="contained"
                  color="primary"
                  disabled={loading || !isFormValid}
                >
                  {loading ? 'Adding...' : 'Add Job Order'}
                </Button>
                <Button variant="outlined" color="secondary" onClick={() => setShowForm(false)}>
                  Cancel
                </Button>
              </Grid>
            </Grid>
          </form>
        </>
      )}
      <Typography variant="h4" gutterBottom>
        Job Orders
      </Typography>
      <Box display="flex" gap={2} mb={2} alignItems="center">
        <TextField
          variant="outlined"
          size="medium"
          placeholder="Search by Title"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            if (hasSearched) setHasSearched(false);
          }}
        />
        {search.trim() && !hasSearched && (
          <Button variant="contained" size="large" onClick={() => setHasSearched(true)}>
            SEARCH
          </Button>
        )}
        {hasSearched && (
          <Button
            variant="outlined"
            size="large"
            onClick={() => {
              setSearch('');
              setCustomerFilter('');
              setHasSearched(false);
            }}
          >
            CLEAR
          </Button>
        )}
        <Autocomplete
          options={tenants}
          getOptionLabel={(option) => option.name || ''}
          value={tenants.find((c) => c.id === customerFilter) || null}
          onChange={(_, newValue) => {
            setCustomerFilter(newValue ? newValue.id : '');
            setHasSearched(false); // Reset search state if filter changes
          }}
          renderInput={(params) => (
            <TextField
              {...params}
              variant="outlined"
              size="medium"
              placeholder="Filter by Customer"
              sx={{ minWidth: 200 }}
            />
          )}
          clearOnEscape
          isOptionEqualToValue={(option, value) => option.id === value.id}
        />
      </Box>

      {selectedJobOrders.length > 0 && (
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
          <Button variant="contained" color="primary" onClick={() => setShowBroadcastDialog(true)}>
            Send Broadcast to {selectedJobOrders.length} Job Order
            {selectedJobOrders.length !== 1 ? 's' : ''} Workers
          </Button>
        </Box>
      )}

      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell padding="checkbox">
                <Checkbox
                  checked={
                    selectedJobOrders.length === filteredSortedJobOrders.length &&
                    filteredSortedJobOrders.length > 0
                  }
                  indeterminate={
                    selectedJobOrders.length > 0 &&
                    selectedJobOrders.length < filteredSortedJobOrders.length
                  }
                  onChange={handleSelectAll}
                />
              </TableCell>
              <TableCell
                onClick={() => {
                  if (sortField === 'jobOrderId') {
                    setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
                  } else {
                    setSortField('jobOrderId');
                    setSortDirection('asc');
                  }
                }}
                style={{ cursor: 'pointer', userSelect: 'none' }}
              >
                Job Order ID
                {sortField === 'jobOrderId' &&
                  (sortDirection === 'asc' ? (
                    <ArrowDropUp fontSize="small" />
                  ) : (
                    <ArrowDropDown fontSize="small" />
                  ))}
              </TableCell>
              <TableCell>Title</TableCell>
              <TableCell
                onClick={() => {
                  if (sortField === 'customer') {
                    setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
                  } else {
                    setSortField('customer');
                    setSortDirection('asc');
                  }
                }}
                style={{ cursor: 'pointer', userSelect: 'none' }}
              >
                Customer
                {sortField === 'customer' &&
                  (sortDirection === 'asc' ? (
                    <ArrowDropUp fontSize="small" />
                  ) : (
                    <ArrowDropDown fontSize="small" />
                  ))}
              </TableCell>
              <TableCell
                onClick={() => {
                  if (sortField === 'worksite') {
                    setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
                  } else {
                    setSortField('worksite');
                    setSortDirection('asc');
                  }
                }}
                style={{ cursor: 'pointer', userSelect: 'none' }}
              >
                Worksite
                {sortField === 'worksite' &&
                  (sortDirection === 'asc' ? (
                    <ArrowDropUp fontSize="small" />
                  ) : (
                    <ArrowDropDown fontSize="small" />
                  ))}
              </TableCell>
              <TableCell>Type</TableCell>
              <TableCell
                onClick={() => {
                  if (sortField === 'poNum') {
                    setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
                  } else {
                    setSortField('poNum');
                    setSortDirection('asc');
                  }
                }}
                style={{ cursor: 'pointer', userSelect: 'none' }}
              >
                PO Num
                {sortField === 'poNum' &&
                  (sortDirection === 'asc' ? (
                    <ArrowDropUp fontSize="small" />
                  ) : (
                    <ArrowDropDown fontSize="small" />
                  ))}
              </TableCell>
              <TableCell
                onClick={() => {
                  if (sortField === 'startDate') {
                    setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
                  } else {
                    setSortField('startDate');
                    setSortDirection('asc');
                  }
                }}
                style={{ cursor: 'pointer', userSelect: 'none' }}
              >
                Start Date
                {sortField === 'startDate' &&
                  (sortDirection === 'asc' ? (
                    <ArrowDropUp fontSize="small" />
                  ) : (
                    <ArrowDropDown fontSize="small" />
                  ))}
              </TableCell>
              <TableCell
                onClick={() => {
                  if (sortField === 'endDate') {
                    setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
                  } else {
                    setSortField('endDate');
                    setSortDirection('asc');
                  }
                }}
                style={{ cursor: 'pointer', userSelect: 'none' }}
              >
                End Date
                {sortField === 'endDate' &&
                  (sortDirection === 'asc' ? (
                    <ArrowDropUp fontSize="small" />
                  ) : (
                    <ArrowDropDown fontSize="small" />
                  ))}
              </TableCell>
              <TableCell
                onClick={() => {
                  if (sortField === 'createdAt') {
                    setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
                  } else {
                    setSortField('createdAt');
                    setSortDirection('asc');
                  }
                }}
                style={{ cursor: 'pointer', userSelect: 'none' }}
              >
                Created At
                {sortField === 'createdAt' &&
                  (sortDirection === 'asc' ? (
                    <ArrowDropUp fontSize="small" />
                  ) : (
                    <ArrowDropDown fontSize="small" />
                  ))}
              </TableCell>
              <TableCell
                onClick={() => {
                  if (sortField === 'status') {
                    setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
                  } else {
                    setSortField('status');
                    setSortDirection('asc');
                  }
                }}
                style={{ cursor: 'pointer', userSelect: 'none' }}
              >
                Status
                {sortField === 'status' &&
                  (sortDirection === 'asc' ? (
                    <ArrowDropUp fontSize="small" />
                  ) : (
                    <ArrowDropDown fontSize="small" />
                  ))}
              </TableCell>
              <TableCell>Job Titles</TableCell>
              <TableCell>Open</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filteredSortedJobOrders.length === 0 ? (
              <TableRow>
                <TableCell colSpan={12}>No job orders yet.</TableCell>
              </TableRow>
            ) : (
              filteredSortedJobOrders.map((order: any) => (
                <TableRow key={order.id}>
                  <TableCell padding="checkbox">
                    <Checkbox
                      checked={selectedJobOrders.includes(order.id)}
                      onChange={(e) => {
                        e.stopPropagation();
                        handleJobOrderSelection(order.id);
                      }}
                    />
                  </TableCell>
                  <TableCell>{order.jobOrderId}</TableCell>
                  <TableCell>{order.title}</TableCell>
                  <TableCell>
                    {tenants.find((c: any) => c.id === order.tenantId)?.name || '-'}
                  </TableCell>
                  <TableCell>
                    {(() => {
                      const info = worksiteInfo[order.worksiteId];
                      if (info) {
                        if (info.nickname && info.city) return `${info.nickname} (${info.city})`;
                        if (info.nickname) return info.nickname;
                        if (info.city) return info.city;
                      }
                      return '-';
                    })()}
                  </TableCell>
                  <TableCell>{order.type || '-'}</TableCell>
                  <TableCell>{order.poNum || '-'}</TableCell>
                  <TableCell>
                    {order.startDate ? new Date(order.startDate).toLocaleDateString('en-US') : '-'}
                  </TableCell>
                  <TableCell>
                    {order.endDate ? new Date(order.endDate).toLocaleDateString('en-US') : '-'}
                  </TableCell>
                  <TableCell>
                    {order.createdAt?.toDate ? order.createdAt.toDate().toLocaleDateString() : '-'}
                  </TableCell>
                  <TableCell>{order.status || '-'}</TableCell>
                  <TableCell>{(order.jobTitleIds || []).join(', ')}</TableCell>
                  <TableCell>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => navigate(`/tenants/${tenantId}/jobOrders/${order.id}`)}
                    >
                      View
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
          Job order added!
        </Alert>
      </Snackbar>

      <BroadcastDialog
        open={showBroadcastDialog}
        onClose={() => setShowBroadcastDialog(false)}
        tenantId={tenantId}
        senderId="admin" // Replace with actual user ID
        initialAudienceFilter={{
          jobOrderId: selectedJobOrders.length === 1 ? selectedJobOrders[0] : undefined,
        }}
        title={`Send Broadcast to Job Order Workers`}
        onSuccess={handleBroadcastSuccess}
      />
    </Box>
  );
};

export default JobOrdersTab;
