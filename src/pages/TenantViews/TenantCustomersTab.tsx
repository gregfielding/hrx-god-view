import React, { useEffect, useState, useRef } from 'react';
import {
  Box,
  Typography,
  Button,
  MenuItem,
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
  FormControl,
  InputLabel,
  Select,
  Chip,
} from '@mui/material';
import {
  doc,
  getDoc,
  updateDoc,
  collection,
  getDocs,
  query,
  where,
  addDoc,
  deleteDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../../firebase';
import { useNavigate } from 'react-router-dom';
import { geocodeAddress } from '../../utils/geocodeAddress';
import { Autocomplete } from '@react-google-maps/api';
import { ArrowDropUp, ArrowDropDown } from '@mui/icons-material';
import IndustrySelector from '../../components/IndustrySelector';
import CustomerDetailsView from './CustomerDetailsView';

interface TenantCustomersTabProps {
  tenantId: string;
}

const TenantCustomersTab: React.FC<TenantCustomersTabProps> = ({ tenantId }) => {
  const [customers, setCustomers] = useState<any[]>([]);
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
    companyLocationId: '',
    status: true, // Add status field with default true
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
  const [selectedCustomerDetails, setSelectedCustomerDetails] = useState<any>(null);
  const [showCustomerDetails, setShowCustomerDetails] = useState(false);
  const [companyLocations, setCompanyLocations] = useState<any[]>([]);
  const [locationNames, setLocationNames] = useState<Record<string, string>>({});
  // Add state for company location filter
  const [companyLocationFilter, setCompanyLocationFilter] = useState('');
  // Add state for status filter
  const [statusFilter, setStatusFilter] = useState('');

  useEffect(() => {
    fetchCustomers();
    fetchCompanyLocations();
    // eslint-disable-next-line
  }, [tenantId]);

  useEffect(() => {
    if (customers.length > 0) {
      customers.forEach(async (customer) => {
        // Logo
        setLogoUrls((prev) => ({
          ...prev,
          [customer.id]: customer.avatar || '/img/default-logo.png',
        }));
      });
    }
  }, [customers]);

  const fetchCustomers = async () => {
    try {
      // Read customers from the customers subcollection
      const customersRef = collection(db, 'tenants', tenantId, 'customers');
      const customersSnap = await getDocs(customersRef);
      const customersData = customersSnap.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setCustomers(customersData);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch customers');
    }
  };

  const fetchCompanyLocations = async () => {
    try {
      const locationsRef = collection(db, 'tenants', tenantId, 'locations');
      const snapshot = await getDocs(locationsRef);
      const locationsData = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      setCompanyLocations(locationsData);
    } catch (err: any) {
      console.error('Failed to fetch company locations:', err);
    }
  };



  const handleRemoveCustomer = async (customerId: string) => {
    setLoading(true);
    setError('');
    try {
      // Delete customer from the customers subcollection
      await deleteDoc(doc(db, 'tenants', tenantId, 'customers', customerId));
      fetchCustomers();
      setSuccess(true);
    } catch (err: any) {
      setError(err.message || 'Failed to remove customer');
    }
    setLoading(false);
  };



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
      // Add customer to the correct subcollection
      const customerData: any = {
        name: form.name,
        address: {
          street: form.street,
          city: form.city,
          state: form.state,
          zip: form.zip,
        },
        industry: form.industry,
        status: form.status, // Add status field
        customerLat: geo.lat,
        customerLng: geo.lng,
        createdAt: serverTimestamp(),
      };
      if (form.companyLocationId) {
        customerData.companyLocationId = form.companyLocationId;
      }
      await addDoc(collection(db, 'tenants', tenantId, 'customers'), customerData);
      setForm({ name: '', street: '', city: '', state: '', zip: '', industry: '', companyLocationId: '', status: true });
      setFormSuccess(true);
      setShowForm(false);
      fetchCustomers();
    } catch (err: any) {
      setFormError(err.message || 'Failed to add customer');
    }
    setFormLoading(false);
  };

  const getSortValue = (customer: any, field: string): string | number => {
    if (field === 'name') return customer.name || '';
    if (field === 'industry') return customer.industry || '';
    if (field === 'city') return customer.address?.city || customer.city || '';
    if (field === 'companyLocation') {
      const location = companyLocations.find(loc => loc.id === customer.companyLocationId);
      return location ? location.nickname : '';
    }
    if (field === 'status') {
      return customer.status ? 'Active' : 'Inactive';
    }
    return '';
  };

  const getSortedCustomers = () => {
    let filtered = customers;
    if (companyLocationFilter) {
      filtered = filtered.filter((c) => c.companyLocationId === companyLocationFilter);
    }
    if (statusFilter !== '') {
      filtered = filtered.filter((c) => c.status === (statusFilter === 'true'));
    }
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

  const getLocationName = (customer: any) => {
    if (!customer.companyLocationId) return '-';
    const location = companyLocations.find(loc => loc.id === customer.companyLocationId);
    return location ? location.nickname : '-';
  };

  const sortedCustomers = getSortedCustomers();

  const handleViewCustomer = (customer: any) => {
    setSelectedCustomerDetails(customer);
    setShowCustomerDetails(true);
  };

  const handleBackToCustomers = () => {
    setShowCustomerDetails(false);
    setSelectedCustomerDetails(null);
  };

  // Customer Details View
  if (showCustomerDetails && selectedCustomerDetails) {
    return (
      <CustomerDetailsView 
        customer={selectedCustomerDetails}
        tenantId={tenantId}
        onBack={handleBackToCustomers}
        onRemoveCustomer={handleRemoveCustomer}
      />
    );
  }

  return (
    <Box sx={{ p: 0, width: '100%' }}>
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
                  label="Industry (Optional)"
                  variant="autocomplete"
                  showCategory={true}
                />
              </Grid>
              <Grid item xs={12}>
                <FormControl fullWidth>
                  <InputLabel>Associate with Company Location (Optional)</InputLabel>
                  <Select
                    value={form.companyLocationId}
                    onChange={(e) => handleFormChange('companyLocationId', e.target.value)}
                    label="Associate with Company Location (Optional)"
                  >
                    <MenuItem value="">
                      <em>No location association</em>
                    </MenuItem>
                    {companyLocations.map((location) => (
                      <MenuItem key={location.id} value={location.id}>
                        {location.nickname} - {location.street}, {location.city}, {location.state}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12}>
                <FormControl fullWidth>
                  <InputLabel>Status</InputLabel>
                  <Select
                    value={form.status ? 'true' : 'false'}
                    onChange={(e) => handleFormChange('status', e.target.value === 'true')}
                    label="Status"
                  >
                    <MenuItem value="true">Active</MenuItem>
                    <MenuItem value="false">Inactive</MenuItem>
                  </Select>
                </FormControl>
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
      <Box display="flex" gap={2} mb={2} alignItems="center" justifyContent="space-between">
        <Box display="flex" gap={2} alignItems="center" flex={1}>
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
          <FormControl size="small" sx={{ minWidth: 220 }}>
            <InputLabel shrink={companyLocationFilter !== ''}>Company Location</InputLabel>
            <Select
              value={companyLocationFilter}
              label="Company Location"
              onChange={(e) => setCompanyLocationFilter(e.target.value)}
              displayEmpty
              sx={{
                '& .MuiSelect-select': {
                  padding: '8px 14px',
                },
              }}
            >
              <MenuItem value="">
                <em>All locations</em>
              </MenuItem>
              {companyLocations.map((location) => (
                <MenuItem key={location.id} value={location.id}>
                  {location.nickname}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 150 }}>
            <InputLabel>Filter by Status</InputLabel>
            <Select
              value={statusFilter}
              label="Filter by Status"
              onChange={(e) => setStatusFilter(e.target.value)}
              displayEmpty
            >
              <MenuItem value="">
                <em>All Statuses</em>
              </MenuItem>
              <MenuItem value="true">Active</MenuItem>
              <MenuItem value="false">Inactive</MenuItem>
            </Select>
          </FormControl>
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
        {!showForm && (
          <Button
            variant="contained"
            color="primary"
            onClick={() => setShowForm(true)}
          >
            Create New Customer
          </Button>
        )}
      </Box>
      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell sx={{ height: 48, py: 0 }}>Logo</TableCell>
              <TableCell
                sx={{ height: 48, py: 0, cursor: 'pointer', userSelect: 'none' }}
                onClick={() => {
                  if (sortField === 'name') {
                    setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
                  } else {
                    setSortField('name');
                    setSortDirection('asc');
                  }
                }}
              >
                Name
                {sortField === 'name' && (sortDirection === 'asc' ? <ArrowDropUp fontSize="small" /> : <ArrowDropDown fontSize="small" />)}
              </TableCell>
              <TableCell
                sx={{ height: 48, py: 0, cursor: 'pointer', userSelect: 'none' }}
                onClick={() => {
                  if (sortField === 'industry') {
                    setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
                  } else {
                    setSortField('industry');
                    setSortDirection('asc');
                  }
                }}
              >
                Industry
                {sortField === 'industry' && (sortDirection === 'asc' ? <ArrowDropUp fontSize="small" /> : <ArrowDropDown fontSize="small" />)}
              </TableCell>
              <TableCell
                sx={{ height: 48, py: 0, cursor: 'pointer', userSelect: 'none' }}
                onClick={() => {
                  if (sortField === 'city') {
                    setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
                  } else {
                    setSortField('city');
                    setSortDirection('asc');
                  }
                }}
              >
                Location
                {sortField === 'city' && (sortDirection === 'asc' ? <ArrowDropUp fontSize="small" /> : <ArrowDropDown fontSize="small" />)}
              </TableCell>
              <TableCell
                sx={{ height: 48, py: 0, cursor: 'pointer', userSelect: 'none' }}
                onClick={() => {
                  if (sortField === 'companyLocation') {
                    setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
                  } else {
                    setSortField('companyLocation');
                    setSortDirection('asc');
                  }
                }}
              >
                Company Location
                {sortField === 'companyLocation' && (sortDirection === 'asc' ? <ArrowDropUp fontSize="small" /> : <ArrowDropDown fontSize="small" />)}
              </TableCell>

              <TableCell sx={{ height: 48, py: 0 }}>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sortedCustomers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6}>No customers associated.</TableCell>
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
                  <TableCell>
                    <Box>
                      <Typography variant="body1" sx={{ fontWeight: 'bold', color: '#333' }}>
                        {customer.name}
                      </Typography>
                      <Typography variant="body2" sx={{ color: '#666', mb: 1 }}>
                        {customer.address?.street && `${customer.address.street}, `}
                        {customer.address?.city || customer.city}
                        {customer.address?.state && `, ${customer.address.state}`}
                        {customer.address?.zip && ` ${customer.address.zip}`}
                      </Typography>
                      <Chip
                        label={customer.status ? 'Active' : 'Inactive'}
                        sx={{
                          backgroundColor: customer.status ? '#4caf50' : '#9e9e9e',
                          color: 'white',
                          fontWeight: 'bold',
                          fontSize: '0.75rem',
                          height: 24,
                        }}
                      />
                    </Box>
                  </TableCell>
                  <TableCell>{customer.industry || '-'}</TableCell>
                  <TableCell>{customer.address?.city || customer.city || '-'}</TableCell>
                  <TableCell>{getLocationName(customer)}</TableCell>
                  <TableCell>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => handleViewCustomer(customer)}
                      sx={{
                        py: 0.25,
                        px: 1,
                        fontSize: '0.7rem',
                        minWidth: 'auto',
                        height: 24,
                        textTransform: 'none',
                      }}
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
          Customer association updated!
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default TenantCustomersTab; 