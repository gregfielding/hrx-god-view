import React, { useEffect, useState } from 'react';
import { Box, Typography, TextField, Button, Grid, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper, Snackbar, Alert, MenuItem, FormControl, InputLabel, Select, OutlinedInput, Chip } from '@mui/material';
import { collection, addDoc, getDocs, doc, getDoc, query, orderBy, limit, serverTimestamp, where } from 'firebase/firestore';
import { db } from '../../../firebase';
import { useNavigate } from 'react-router-dom';
import JobOrderDetails from './JobOrderDetails';
import { ArrowDropUp, ArrowDropDown } from '@mui/icons-material';
import Autocomplete from '@mui/material/Autocomplete';

const JobOrdersTab: React.FC<{ agencyId: string }> = ({ agencyId }) => {
  const [form, setForm] = useState({
    title: '',
    description: '',
    customerId: '',
    worksiteId: '',
    poNum: '',
    type: '',
    startDate: '',
    endDate: '',
    jobTitleIds: [] as string[],
  });
  const [jobOrders, setJobOrders] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [worksites, setWorksites] = useState<any[]>([]);
  const [jobTitles, setJobTitles] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const [agencyCustomerIds, setAgencyCustomerIds] = useState<string[]>([]);
  const [worksiteInfo, setWorksiteInfo] = useState<Record<string, { nickname?: string; city?: string }>>({});
  const [sortField, setSortField] = useState<string>('');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [search, setSearch] = useState('');
  const [hasSearched, setHasSearched] = useState(false);
  const [customerFilter, setCustomerFilter] = useState<string>('');
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    fetchAgencyCustomerIds();
    fetchJobOrders();
    fetchJobTitles();
    // eslint-disable-next-line
  }, [agencyId]);

  useEffect(() => {
    fetchCustomers();
    // eslint-disable-next-line
  }, [agencyCustomerIds]);

  useEffect(() => {
    if (form.customerId) fetchWorksites(form.customerId);
    else setWorksites([]);
  }, [form.customerId]);

  const fetchAgencyCustomerIds = async () => {
    const agencyRef = doc(db, 'agencies', agencyId);
    const agencySnap = await getDoc(agencyRef);
    if (agencySnap.exists()) {
      setAgencyCustomerIds(agencySnap.data().customerIds || []);
    }
  };

  const fetchJobOrders = async () => {
    setLoading(true);
    try {
      const q = query(collection(db, 'jobOrders'), where('agencyId', '==', agencyId));
      const snapshot = await getDocs(q);
      const jobOrdersData: any[] = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setJobOrders(jobOrdersData);

      // Gather all unique {customerId, worksiteId} pairs
      const pairs = jobOrdersData
        .filter(order => order.customerId && order.worksiteId)
        .map(order => ({ customerId: order.customerId, worksiteId: order.worksiteId }));
      const uniquePairs = Array.from(new Set(pairs.map(p => p.customerId + '|' + p.worksiteId)))
        .map(key => {
          const [customerId, worksiteId] = key.split('|');
          return { customerId, worksiteId };
        });

      // Fetch all referenced worksites
      const worksiteMap: Record<string, { nickname?: string; city?: string }> = {};
      await Promise.all(uniquePairs.map(async ({ customerId, worksiteId }) => {
        try {
          const locRef = doc(db, 'customers', customerId, 'locations', worksiteId);
          const locSnap = await getDoc(locRef);
          if (locSnap.exists()) {
            const data = locSnap.data();
            worksiteMap[worksiteId] = { nickname: data.nickname, city: data.city };
          }
        } catch {}
      }));
      setWorksiteInfo(worksiteMap);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch job orders');
    }
    setLoading(false);
  };

  const fetchCustomers = async () => {
    if (agencyCustomerIds.length === 0) {
      setCustomers([]);
      return;
    }
    const customerDocs = await Promise.all(
      agencyCustomerIds.map(async (id) => {
        const snap = await getDoc(doc(db, 'customers', id));
        return snap.exists() ? { id, ...snap.data() } : null;
      })
    );
    setCustomers(customerDocs.filter(Boolean));
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

  const getNextJobOrderId = async () => {
    const q = query(collection(db, 'agencies', agencyId, 'jobOrders'), orderBy('jobOrderId', 'desc'), limit(1));
    const snapshot = await getDocs(q);
    if (!snapshot.empty) {
      const lastId = snapshot.docs[0].data().jobOrderId;
      return lastId + 1;
    }
    return 1000;
  };

  const isFormValid = form.title && form.description && form.customerId && form.worksiteId && form.type && form.startDate && form.endDate && form.jobTitleIds.length > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const jobOrderId = await getNextJobOrderId();
      await addDoc(collection(db, 'agencies', agencyId, 'jobOrders'), {
        ...form,
        jobOrderId,
        createdAt: serverTimestamp(),
        status: 'Active',
      });
      setForm({ title: '', description: '', customerId: '', worksiteId: '', poNum: '', type: '', startDate: '', endDate: '', jobTitleIds: [] });
      setSuccess(true);
      fetchJobOrders();
    } catch (err: any) {
      setError(err.message || 'Failed to add job order');
    }
    setLoading(false);
  };

  const getSortValue = (order: any, field: string): string | number | Date => {
    if (field === 'jobOrderId') return order.jobOrderId ?? 0;
    if (field === 'customer') return customers.find((c: any) => c.id === order.customerId)?.name || '';
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
    if (field === 'createdAt') return order.createdAt?.toDate ? order.createdAt.toDate() : new Date(0);
    if (field === 'startDate') return order.startDate ? new Date(order.startDate) : new Date(0);
    if (field === 'endDate') return order.endDate ? new Date(order.endDate) : new Date(0);
    if (field === 'status') return order.status || '';
    return '';
  };

  const getFilteredSortedJobOrders = () => {
    let filtered = jobOrders;
    if (search.trim()) {
      const searchLower = search.trim().toLowerCase();
      filtered = filtered.filter(order => (order.title || '').toLowerCase().includes(searchLower));
    }
    if (customerFilter) {
      filtered = filtered.filter(order => order.customerId === customerFilter);
    }
    // Now sort
    if (!sortField) return filtered;
    const sorted = [...filtered].sort((a, b) => {
      let aValue = getSortValue(a, sortField);
      let bValue = getSortValue(b, sortField);
      if (aValue instanceof Date && bValue instanceof Date) {
        return sortDirection === 'asc' ? aValue.getTime() - bValue.getTime() : bValue.getTime() - aValue.getTime();
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
    <Box sx={{ p: 2, width: '100%' }}>
      {!showForm && (
        <Button variant="contained" color="primary" sx={{ mb: 2 }} onClick={() => setShowForm(true)}>
          Create New Job Order
        </Button>
      )}
      {showForm && (
        <>
          <Typography variant="h6" gutterBottom>Add Job Order</Typography>
          <form onSubmit={handleSubmit}>
            <Grid container spacing={2} mb={2}>
              <Grid item xs={12} sm={4}>
                <TextField label="Title" fullWidth required value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
              </Grid>
              <Grid item xs={12} sm={8}>
                <TextField label="Description" fullWidth required value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} multiline />
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField
                  select
                  label="Customer"
                  fullWidth
                  required
                  value={form.customerId}
                  onChange={e => setForm(f => ({ ...f, customerId: e.target.value, worksiteId: '' }))}
                >
                  {customers.map((c) => (
                    <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>
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
                  onChange={e => setForm(f => ({ ...f, worksiteId: e.target.value }))}
                  disabled={!form.customerId}
                >
                  {worksites.map((w) => (
                    <MenuItem key={w.id} value={w.id}>{w.nickname}</MenuItem>
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
                  onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
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
                  onChange={e => setForm(f => ({ ...f, poNum: e.target.value }))}
                />
              </Grid>
              <Grid item xs={12} sm={2}>
                <TextField
                  label="Start Date"
                  type="date"
                  fullWidth
                  required
                  value={form.startDate}
                  onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))}
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
                  onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))}
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
                    onChange={e => setForm(f => ({ ...f, jobTitleIds: Array.isArray(e.target.value) ? e.target.value : [e.target.value] }))}
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
                              onDelete={() => setForm(f => ({ ...f, jobTitleIds: f.jobTitleIds.filter((jid: string) => jid !== id) }))}
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
              <Grid item xs={12} display="flex" gap={2}>
                <Button type="submit" variant="contained" color="primary" disabled={loading || !isFormValid}>
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
      <Typography variant="h6" gutterBottom>Job Orders</Typography>
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
          <Button variant="outlined" size="large" onClick={() => { setSearch(''); setCustomerFilter(''); setHasSearched(false); }}>
            CLEAR
          </Button>
        )}
        <Autocomplete
          options={customers}
          getOptionLabel={option => option.name || ''}
          value={customers.find(c => c.id === customerFilter) || null}
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
      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
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
                {sortField === 'jobOrderId' && (
                  sortDirection === 'asc' ? <ArrowDropUp fontSize="small" /> : <ArrowDropDown fontSize="small" />
                )}
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
                {sortField === 'customer' && (
                  sortDirection === 'asc' ? <ArrowDropUp fontSize="small" /> : <ArrowDropDown fontSize="small" />
                )}
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
                {sortField === 'worksite' && (
                  sortDirection === 'asc' ? <ArrowDropUp fontSize="small" /> : <ArrowDropDown fontSize="small" />
                )}
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
                {sortField === 'poNum' && (
                  sortDirection === 'asc' ? <ArrowDropUp fontSize="small" /> : <ArrowDropDown fontSize="small" />
                )}
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
                {sortField === 'startDate' && (
                  sortDirection === 'asc' ? <ArrowDropUp fontSize="small" /> : <ArrowDropDown fontSize="small" />
                )}
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
                {sortField === 'endDate' && (
                  sortDirection === 'asc' ? <ArrowDropUp fontSize="small" /> : <ArrowDropDown fontSize="small" />
                )}
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
                {sortField === 'createdAt' && (
                  sortDirection === 'asc' ? <ArrowDropUp fontSize="small" /> : <ArrowDropDown fontSize="small" />
                )}
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
                {sortField === 'status' && (
                  sortDirection === 'asc' ? <ArrowDropUp fontSize="small" /> : <ArrowDropDown fontSize="small" />
                )}
              </TableCell>
              <TableCell>Job Titles</TableCell>
              <TableCell>Open</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filteredSortedJobOrders.length === 0 ? (
              <TableRow><TableCell colSpan={12}>No job orders yet.</TableCell></TableRow>
            ) : (
              filteredSortedJobOrders.map((order: any) => (
                <TableRow key={order.id}>
                  <TableCell>{order.jobOrderId}</TableCell>
                  <TableCell>{order.title}</TableCell>
                  <TableCell>{customers.find((c: any) => c.id === order.customerId)?.name || '-'}</TableCell>
                  <TableCell>{(() => {
                    const info = worksiteInfo[order.worksiteId];
                    if (info) {
                      if (info.nickname && info.city) return `${info.nickname} (${info.city})`;
                      if (info.nickname) return info.nickname;
                      if (info.city) return info.city;
                    }
                    return '-';
                  })()}</TableCell>
                  <TableCell>{order.type || '-'}</TableCell>
                  <TableCell>{order.poNum || '-'}</TableCell>
                  <TableCell>{order.startDate ? new Date(order.startDate).toLocaleDateString('en-US') : '-'}</TableCell>
                  <TableCell>{order.endDate ? new Date(order.endDate).toLocaleDateString('en-US') : '-'}</TableCell>
                  <TableCell>{order.createdAt?.toDate ? order.createdAt.toDate().toLocaleDateString() : '-'}</TableCell>
                  <TableCell>{order.status || '-'}</TableCell>
                  <TableCell>{(order.jobTitleIds || []).join(', ')}</TableCell>
                  <TableCell>
                    <Button size="small" variant="outlined" onClick={() => navigate(`/agencies/${agencyId}/jobOrders/${order.id}`)}>View</Button>
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
        <Alert severity="success" sx={{ width: '100%' }}>Job order added!</Alert>
      </Snackbar>
    </Box>
  );
};

export default JobOrdersTab; 