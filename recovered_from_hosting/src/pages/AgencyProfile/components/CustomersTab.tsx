import React, { useEffect, useState, useRef } from 'react';
import {
  Box,
  Typography,
  Button,
  TextField,
  Snackbar,
  Alert,
  TableContainer,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  Paper,
  Grid,
} from '@mui/material';
import {
  doc,
  getDoc,
  updateDoc,
  collection,
  getDocs,
  addDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { Autocomplete } from '@react-google-maps/api';
import { ArrowDropUp, ArrowDropDown } from '@mui/icons-material';

import { geocodeAddress } from '../../../utils/geocodeAddress';
import { db } from '../../../firebase';
import IndustrySelector from '../../../components/IndustrySelector';

interface CustomersTabProps {
  tenantId: string;
}

const CustomersTab: React.FC<CustomersTabProps> = ({ tenantId }) => {
  const [allCustomers, setAllCustomers] = useState<any[]>([]);
  const [associatedCustomers, setAssociatedCustomers] = useState<any[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState('');
  const [currentCustomerIds, setCurrentCustomerIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: '',
    street: '',
    city: '',
    state: '',
    zip: '',
    industry: '',
  });
  const [formLoading, setFormLoading] = useState(false);
  const [formSuccess, setFormSuccess] = useState(false);
  const [formError, setFormError] = useState('');
  const autocompleteRef = useRef<any>(null);
  const [search, setSearch] = useState('');
  const [hasSearched, setHasSearched] = useState(false);
  const [sortField, setSortField] = useState<string>('');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [logoUrls, setLogoUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    fetchAllCustomers();
    fetchAssociatedCustomers();
    // eslint-disable-next-line
  }, [tenantId]);

  useEffect(() => {
    if (associatedCustomers.length > 0) {
      associatedCustomers.forEach(async (customer) => {
        // Logo
        setLogoUrls((prev) => ({
          ...prev,
          [customer.id]: customer.avatar || '/img/default-logo.png',
        }));
      });
    }
  }, [associatedCustomers]);

  const fetchAllCustomers = async () => {
    try {
      const q = collection(db, 'tenants');
      const snapshot = await getDocs(q);
      setAllCustomers(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    } catch (err: any) {
      setError(err.message || 'Failed to fetch tenants');
    }
  };

  const fetchAssociatedCustomers = async () => {
    try {
      const tenantRef = doc(db, 'tenants', tenantId);
      const tenantSnap = await getDoc(tenantRef);
      let tenantIds: string[] = [];
      if (tenantSnap.exists()) {
        const data = tenantSnap.data();
        // Get tenants from subcollection or from tenants array
        if (data.tenants && Array.isArray(data.tenants)) {
          tenantIds = data.tenants;
        } else {
          // Fallback to subcollection
          const tenantsSnap = await getDocs(collection(db, 'tenants', tenantId, 'tenants'));
          tenantIds = tenantsSnap.docs.map(doc => doc.id);
        }
      }
      setCurrentCustomerIds(tenantIds);
      if (tenantIds.length > 0) {
        const tenants = await Promise.all(
          tenantIds.map(async (id) => {
            const customerSnap = await getDoc(doc(db, 'tenants', id));
            return customerSnap.exists() ? { id, ...customerSnap.data() } : null;
          }),
        );
        setAssociatedCustomers(tenants.filter(Boolean));
      } else {
        setAssociatedCustomers([]);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch associated tenants');
    }
  };

  const handleAddCustomer = async () => {
    if (!selectedCustomer) return;
    setLoading(true);
    setError('');
    try {
      const tenantRef = doc(db, 'tenants', tenantId);
      const tenantSnap = await getDoc(tenantRef);
      let tenants: string[] = [];
      if (tenantSnap.exists()) {
        tenants = tenantSnap.data().tenants || [];
      }
      if (!tenants.includes(selectedCustomer)) {
        tenants.push(selectedCustomer);
        await updateDoc(tenantRef, { tenants });
      }
      setSelectedCustomer('');
      fetchAssociatedCustomers();
      setSuccess(true);
    } catch (err: any) {
      setError(err.message || 'Failed to add customer');
    }
    setLoading(false);
  };

  const handleRemoveCustomer = async (tenantId: string) => {
    setLoading(true);
    setError('');
    try {
      const tenantRef = doc(db, 'tenants', tenantId);
      const tenantSnap = await getDoc(tenantRef);
      let tenantIds: string[] = [];
      if (tenantSnap.exists()) {
        tenantIds = tenantSnap.data().tenants || [];
      }
      tenantIds = tenantIds.filter((id) => id !== tenantId);
      await updateDoc(tenantRef, { tenantIds });
      fetchAssociatedCustomers();
      setSuccess(true);
    } catch (err: any) {
      setError(err.message || 'Failed to remove customer');
    }
    setLoading(false);
  };

  // Only show tenants not already associated
  const availableCustomers = allCustomers.filter((c) => !currentCustomerIds.includes(c.id));

  const handleFormChange = (field: string, value: any) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handlePlaceChanged = () => {
    const place = autocompleteRef.current.getPlace();
    if (!place || !place.geometry) return;
    const components = place.address_components || [];
    const getComponent = (types: string[]) =>
      components.find((comp: any) => types.every((t) => comp.types.includes(t)))?.long_name || '';
    setForm((prev) => ({
      ...prev,
      street: `${getComponent(['street_number'])} ${getComponent(['route'])}`.trim(),
      city: getComponent(['locality']),
      state: getComponent(['administrative_area_level_1']),
      zip: getComponent(['postal_code']),
    }));
  };

  const handleCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormLoading(true);
    setFormError('');
    try {
      const fullAddress = `${form.street}, ${form.city}, ${form.state} ${form.zip}`;
      const geo = await geocodeAddress(fullAddress);
      // Add customer with tenantId
      const docRef = await addDoc(collection(db, 'tenants'), {
        name: form.name,
        address: {
          street: form.street,
          city: form.city,
          state: form.state,
          zip: form.zip,
        },
        industry: form.industry,
        customerLat: geo.lat,
        customerLng: geo.lng,
        tenantId,
        createdAt: serverTimestamp(),
      });
      await addDoc(collection(db, 'tenants', docRef.id, 'locations'), {
        nickname: 'Default',
        street: form.street,
        city: form.city,
        state: form.state,
        zip: form.zip,
        createdAt: serverTimestamp(),
      });
      // Add to agency's tenantIds
      const tenantRef = doc(db, 'tenants', tenantId);
      const tenantSnap = await getDoc(tenantRef);
      let tenantIds: string[] = [];
      if (tenantSnap.exists()) {
        tenantIds = tenantSnap.data().tenants || [];
      }
      if (!tenantIds.includes(docRef.id)) {
        tenantIds.push(docRef.id);
        await updateDoc(tenantRef, { tenantIds });
      }
      setForm({ name: '', street: '', city: '', state: '', zip: '', industry: '' });
      setFormSuccess(true);
      setShowForm(false);
      fetchAssociatedCustomers();
    } catch (err: any) {
      setFormError(err.message || 'Failed to add customer');
    }
    setFormLoading(false);
  };

  const getSortValue = (customer: any, field: string): string | number => {
    if (field === 'name') return customer.name || '';
    if (field === 'city') return customer.address?.city || customer.city || '';
    if (field === 'state') return customer.address?.state || customer.state || '';
    return '';
  };

  const getSortedCustomers = () => {
    let filtered = associatedCustomers;
    if (search.trim()) {
      const searchLower = search.trim().toLowerCase();
      filtered = filtered.filter((c) => (c.name || '').toLowerCase().includes(searchLower));
    }
    if (!sortField) return filtered;
    const sorted = [...filtered].sort((a, b) => {
      let aValue = getSortValue(a, sortField);
      let bValue = getSortValue(b, sortField);
      aValue = (aValue as string).toLowerCase();
      bValue = (bValue as string).toLowerCase();
      if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
    return sorted;
  };

  const sortedCustomers = getSortedCustomers();

  return (
    <Box sx={{ p: 2, width: '100%' }}>
      {!showForm && (
        <Button
          variant="contained"
          color="primary"
          sx={{ mb: 2 }}
          onClick={() => setShowForm(true)}
        >
          Create New Customer
        </Button>
      )}
      {showForm && (
        <Box mb={2}>
          <form onSubmit={handleCreateCustomer}>
            <Grid container spacing={2}>
              <Grid item xs={12}>
                <TextField
                  label="Customer Name"
                  fullWidth
                  required
                  value={form.name}
                  onChange={(e) => handleFormChange('name', e.target.value)}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <Autocomplete
                  onLoad={(ref) => (autocompleteRef.current = ref)}
                  onPlaceChanged={handlePlaceChanged}
                >
                  <TextField
                    label="Street Address"
                    fullWidth
                    required
                    value={form.street}
                    onChange={(e) => handleFormChange('street', e.target.value)}
                  />
                </Autocomplete>
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  label="City"
                  fullWidth
                  value={form.city}
                  onChange={(e) => handleFormChange('city', e.target.value)}
                />
              </Grid>
              <Grid item xs={6} sm={3}>
                <TextField
                  label="State"
                  fullWidth
                  value={form.state}
                  onChange={(e) => handleFormChange('state', e.target.value)}
                />
              </Grid>
              <Grid item xs={6} sm={3}>
                <TextField
                  label="Zip"
                  fullWidth
                  value={form.zip}
                  onChange={(e) => handleFormChange('zip', e.target.value)}
                />
              </Grid>
              <Grid item xs={12}>
                <IndustrySelector
                  value={form.industry}
                  onChange={(industryCode) => handleFormChange('industry', industryCode)}
                  label="Industry"
                  required
                  variant="autocomplete"
                  showCategory={true}
                />
              </Grid>
              <Grid item xs={12} display="flex" gap={2}>
                <Button type="submit" variant="contained" color="primary" disabled={formLoading}>
                  {formLoading ? 'Adding...' : 'Add Customer'}
                </Button>
                <Button variant="outlined" color="secondary" onClick={() => setShowForm(false)}>
                  Cancel
                </Button>
              </Grid>
            </Grid>
          </form>
          <Snackbar open={!!formError} autoHideDuration={4000} onClose={() => setFormError('')}>
            <Alert severity="error" onClose={() => setFormError('')} sx={{ width: '100%' }}>
              {formError}
            </Alert>
          </Snackbar>
          <Snackbar
            open={formSuccess}
            autoHideDuration={2000}
            onClose={() => setFormSuccess(false)}
          >
            <Alert severity="success" sx={{ width: '100%' }}>
              Customer added!
            </Alert>
          </Snackbar>
        </Box>
      )}
      <Typography variant="h6" gutterBottom>
        Customers
      </Typography>
      <Box display="flex" gap={2} mb={2} alignItems="center">
        <TextField
          variant="outlined"
          size="medium"
          placeholder="Search"
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
              setHasSearched(false);
            }}
          >
            CLEAR
          </Button>
        )}
      </Box>
      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Logo</TableCell>
              <TableCell
                onClick={() => {
                  if (sortField === 'name') {
                    setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
                  } else {
                    setSortField('name');
                    setSortDirection('asc');
                  }
                }}
                style={{ cursor: 'pointer', userSelect: 'none' }}
              >
                Name
                {sortField === 'name' &&
                  (sortDirection === 'asc' ? (
                    <ArrowDropUp fontSize="small" />
                  ) : (
                    <ArrowDropDown fontSize="small" />
                  ))}
              </TableCell>
              <TableCell>City</TableCell>
              <TableCell>State</TableCell>
              <TableCell>View</TableCell>
              <TableCell>Remove</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sortedCustomers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6}>No tenants associated.</TableCell>
              </TableRow>
            ) : (
              sortedCustomers.map((customer) => (
                <TableRow key={customer.id}>
                  <TableCell>
                    {logoUrls[customer.id] && logoUrls[customer.id] !== '/img/default-logo.png' && (
                      <img
                        src={logoUrls[customer.id]}
                        alt={customer.name}
                        style={{
                          width: 40,
                          height: 40,
                          objectFit: 'cover',
                          borderRadius: 4,
                          border: '1px solid #eee',
                        }}
                        onError={() => {
                          setLogoUrls((prev) => ({
                            ...prev,
                            [customer.id]: '',
                          }));
                        }}
                      />
                    )}
                  </TableCell>
                  <TableCell>{customer.name}</TableCell>
                  <TableCell>{customer.address?.city || customer.city || '-'}</TableCell>
                  <TableCell>{customer.address?.state || customer.state || '-'}</TableCell>
                  <TableCell>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => navigate(`/tenants/${tenantId}/tenants/${customer.id}`)}
                    >
                      View
                    </Button>
                  </TableCell>
                  <TableCell>
                    <Button
                      size="small"
                      variant="outlined"
                      color="error"
                      onClick={() => handleRemoveCustomer(customer.id)}
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
      <Snackbar open={!!error} autoHideDuration={4000} onClose={() => setError('')}>
        <Alert severity="error" onClose={() => setError('')} sx={{ width: '100%' }}>
          {error}
        </Alert>
      </Snackbar>
      <Snackbar open={success} autoHideDuration={2000} onClose={() => setSuccess(false)}>
        <Alert severity="success" sx={{ width: '100%' }}>
          Customer association updated!
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default CustomersTab;
