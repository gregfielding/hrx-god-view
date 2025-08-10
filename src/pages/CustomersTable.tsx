import React, { useEffect, useState, useRef } from 'react';
import {
  Box,
  Typography,
  TextField,
  Button,
  Paper,
  Grid,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Autocomplete as MUIAutocomplete,
} from '@mui/material';
import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  where,
  doc,
  getDoc,
  addDoc,
} from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { Autocomplete as GoogleMapsAutocomplete } from '@react-google-maps/api';

import { db } from '../firebase';
import CustomersTableBlock from '../componentBlocks/CustomersTableBlock';
import { useAuth } from '../contexts/AuthContext';
import { INDUSTRIES } from '../data/industries';
import { geocodeAddress } from '../utils/geocodeAddress';

const PAGE_SIZE = 10;

type Customer = {
  id: string;
  name: string;
  avatar?: string;
  city?: string;
  state?: string;
  status?: boolean;
  companyLocationId?: string;
  createdAt?: any;
};

const CustomersTable: React.FC = () => {
  const [tenants, setCustomers] = useState<Customer[]>([]);
  const [workforceCounts, setWorkforceCounts] = useState<Record<string, number>>({});
  const [logoUrls, setLogoUrls] = useState<Record<string, string>>({});
  const [agencyNames, setAgencyNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [agencyFilter, setAgencyFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [availableAgencies, setAvailableAgencies] = useState<string[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [lastDoc, setLastDoc] = useState<any>(null);
  const [isEnd, setIsEnd] = useState(false);
  const firstLoadRef = useRef(true);
  const navigate = useNavigate();
  const [sortField, setSortField] = useState<string>('');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const { tenantId, orgType, accessRole } = useAuth();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: '',
    street: '',
    city: '',
    state: '',
    zip: '',
    industryCategory: '',
    industry: '',
    status: true, // Add status field to form
  });
  const [formError, setFormError] = useState('');
  const [formLoading, setFormLoading] = useState(false);
  const autocompleteRef = useRef<any>(null);
  const [companyLocations, setCompanyLocations] = useState<any[]>([]);
  const [companyLocationFilter, setCompanyLocationFilter] = useState('');

  const handleFormChange = (field: string, value: string) => {
    setForm((prev) => ({
      ...prev,
      [field]: value,
      ...(field === 'industryCategory' ? { industry: '' } : {}),
    }));
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

  const handleAddCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    if (!form.name || !form.street || !form.industry) {
      setFormError('Customer Name, Street Address, and Industry are required.');
      return;
    }
    setFormLoading(true);
    try {
      const fullAddress = `${form.street}, ${form.city}, ${form.state} ${form.zip}`;
      const geo = await geocodeAddress(fullAddress);
      const customerData: any = {
        name: form.name,
        address: {
          street: form.street,
          city: form.city,
          state: form.state,
          zip: form.zip,
        },
        industryCategory: form.industryCategory,
        industry: form.industry,
        customerLat: geo.lat,
        customerLng: geo.lng,
        createdAt: new Date(),
      };
      if (orgType === 'Tenant' && tenantId) customerData.tenantId = tenantId;
      await addDoc(collection(db, 'tenants'), customerData);
      setShowForm(false);
      setForm({ name: '', street: '', city: '', state: '', zip: '', industryCategory: '', industry: '', status: true });
      fetchCustomers();
    } catch (err: any) {
      setFormError(err.message || 'Failed to add customer');
    }
    setFormLoading(false);
  };

  useEffect(() => {
    fetchCustomers();
  }, []);

  useEffect(() => {
    if (tenantId) {
      fetchCompanyLocations();
    }
  }, [tenantId]);

  const fetchCompanyLocations = async () => {
    try {
      const locationsRef = collection(db, 'tenants', tenantId, 'locations');
      const snapshot = await getDocs(locationsRef);
      const locationsData = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      setCompanyLocations(locationsData);
    } catch (err) {
      console.error('Failed to fetch company locations:', err);
    }
  };

  const fetchCustomers = async (
    searchQuery = '',
    startDoc: any = null,
    agencyFilterValue = agencyFilter,
  ) => {
    setLoading(true);
    try {
      const baseRef = collection(db, 'tenants');
      const constraints: any[] = [orderBy('createdAt', 'desc'), limit(PAGE_SIZE)];

      if (startDoc) {
        constraints.push(startAfter(startDoc));
      }

      const q = query(baseRef, ...constraints);
      const snapshot = await getDocs(q);

      if (!snapshot.empty) {
        const results = snapshot.docs.map((doc) => {
          const data = doc.data();
          return {
            id: doc.id,
            ...data,
            city: data.address?.city || data.city,
            state: data.address?.state || data.state,
          };
        }) as Customer[];

        // Fetch agency names and workforce counts for all tenants
        const tenantsWithAgencyData = await Promise.all(
          results.map(async (customer) => {
            let workforceCount = 0;
            let agencyName = '-';

            try {
              const usersSnap = await getDocs(
                query(
                  collection(db, 'users'),
                  where('tenantId', '==', customer.id),
                  where('role', '==', 'Worker'),
                ),
              );
              workforceCount = usersSnap.size;
            } catch {
              workforceCount = 0;
            }

            if ((customer as any).tenantId) {
              try {
                const agencyRef = doc(db, 'tenants', (customer as any).tenantId);
                const agencySnap = await getDoc(agencyRef);
                if (agencySnap.exists()) {
                  agencyName = agencySnap.data().name || '-';
                }
              } catch {
                agencyName = '-';
              }
            }

            return {
              ...customer,
              workforceCount,
              agencyName,
            };
          }),
        );

        // Filter by search query if provided
        let filteredResults = tenantsWithAgencyData;
        if (searchQuery.trim()) {
          const searchTerms = searchQuery
            .toLowerCase()
            .split(' ')
            .filter((term) => term.length > 0);
          filteredResults = filteredResults.filter((customer) => {
            const customerNameLower = customer.name.toLowerCase();
            const agencyNameLower = customer.agencyName.toLowerCase();
            return searchTerms.some(
              (term) => customerNameLower.includes(term) || agencyNameLower.includes(term),
            );
          });
        }

        // Filter by agency if provided
        if (agencyFilterValue) {
          filteredResults = filteredResults.filter(
            (customer) => customer.agencyName.toLowerCase() === agencyFilterValue.toLowerCase(),
          );
        }

        // Filter by status if provided
        if (statusFilter) {
          const statusBool = statusFilter === 'true';
          filteredResults = filteredResults.filter(
            (customer) => customer.status === statusBool,
          );
        }

        // Filter by company location if provided
        if (companyLocationFilter) {
          filteredResults = filteredResults.filter(
            (customer) => customer.companyLocationId === companyLocationFilter
          );
        }

        // Update available tenants for filter dropdown
        const uniqueAgencies = Array.from(
          new Set(tenantsWithAgencyData.map((c) => c.agencyName)),
        ).filter((name) => name !== '-');
        setAvailableAgencies(uniqueAgencies);

        setCustomers((prev) => (startDoc ? [...prev, ...filteredResults] : filteredResults));
        setLastDoc(snapshot.docs[snapshot.docs.length - 1]);
        setIsEnd(snapshot.size < PAGE_SIZE);

        // Update workforce counts and agency names for display
        filteredResults.forEach((customer) => {
          setWorkforceCounts((prev) => ({ ...prev, [customer.id]: customer.workforceCount }));
          setAgencyNames((prev) => ({ ...prev, [customer.id]: customer.agencyName }));
          setLogoUrls((prev) => ({
            ...prev,
            [customer.id]: customer.avatar || '/img/default-logo.png',
          }));
        });
      } else {
        if (!startDoc) setCustomers([]);
        setIsEnd(true);
      }
    } catch (error) {
      console.error('Error fetching tenants:', error);
    }
    setLoading(false);
  };

  const handleSearch = () => {
    setHasSearched(true);
    fetchCustomers(search, null);
  };

  const handleClearSearch = () => {
    setSearch('');
    setAgencyFilter('');
    setHasSearched(false);
    fetchCustomers('', null);
  };

  // Sorting logic
  const getSortValue = (
    customer: Customer & { workforceCount?: number; agencyName?: string },
    field: string,
  ): string | number => {
    if (field === 'name') return customer.name || '';
    if (field === 'workforce') return customer.workforceCount ?? 0;
    if (field === 'agencyName') return customer.agencyName || '';
    if (field === 'companyLocation') {
      if (!customer.companyLocationId) return '';
      const location = companyLocations.find(loc => loc.id === customer.companyLocationId);
      return location ? location.nickname || location.name || location.id : '';
    }
    return '';
  };
  const getSortedCustomers = () => {
    if (!sortField) return tenants;
    const sorted = [...tenants].sort((a, b) => {
      let aValue = getSortValue(a, sortField);
      let bValue = getSortValue(b, sortField);
      if (sortField === 'workforce') {
        // Numeric sort
        return sortDirection === 'asc'
          ? (aValue as number) - (bValue as number)
          : (bValue as number) - (aValue as number);
      } else {
        // String sort
        aValue = (aValue as string).toLowerCase();
        bValue = (bValue as string).toLowerCase();
        if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
        if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
        return 0;
      }
    });
    return sorted;
  };
  const sortedCustomers = getSortedCustomers();

  const industryCategories = Array.from(new Set(INDUSTRIES.map(i => i.category))).sort();
  const industriesForCategory = form.industryCategory
    ? INDUSTRIES.filter(i => i.category === form.industryCategory)
    : [];

  return (
    <Box sx={{ p: 0 }}>
      <Box display="flex" alignItems="center" justifyContent="space-between" mb={2}>
        <Typography variant="h4" gutterBottom>
          Customers
        </Typography>
        {!showForm && (
          <Button variant="contained" color="primary" onClick={() => setShowForm(true)}>
            Add Customer
          </Button>
        )}
      </Box>
      {showForm && (
        <Paper sx={{ p: 3, mb: 3, boxShadow: 1 }}>
          <form onSubmit={handleAddCustomer}>
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
              <Grid item xs={12} sm={8}>
                <GoogleMapsAutocomplete
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
                </GoogleMapsAutocomplete>
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField
                  label="City"
                  fullWidth
                  value={form.city}
                  onChange={(e) => handleFormChange('city', e.target.value)}
                />
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <TextField
                  label="State"
                  fullWidth
                  value={form.state}
                  onChange={(e) => handleFormChange('state', e.target.value)}
                />
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <TextField
                  label="Zip"
                  fullWidth
                  value={form.zip}
                  onChange={(e) => handleFormChange('zip', e.target.value)}
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  select
                  label="Industry Category"
                  fullWidth
                  value={form.industryCategory}
                  onChange={(e) => handleFormChange('industryCategory', e.target.value)}
                  SelectProps={{ native: true }}
                >
                  <option value="">Select Category</option>
                  {industryCategories.map((cat) => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </TextField>
              </Grid>
              <Grid item xs={12}>
                <TextField
                  select
                  label="Industry"
                  fullWidth
                  required
                  value={form.industry}
                  onChange={(e) => handleFormChange('industry', e.target.value)}
                  SelectProps={{ native: true }}
                  disabled={!form.industryCategory}
                >
                  <option value="">Select Industry</option>
                  {industriesForCategory.map((ind) => (
                    <option key={ind.code} value={ind.name}>{ind.name}</option>
                  ))}
                </TextField>
              </Grid>
            </Grid>
            {formError && (
              <Typography color="error" sx={{ mt: 2 }}>{formError}</Typography>
            )}
            <Box mt={3} display="flex" justifyContent="flex-end" gap={2}>
              <Button variant="contained" color="primary" type="submit" disabled={formLoading}>
                Add Customer
              </Button>
              <Button variant="outlined" onClick={() => setShowForm(false)} disabled={formLoading}>
                Cancel
              </Button>
            </Box>
          </form>
        </Paper>
      )}
      <Box display="flex" gap={2} mb={2} alignItems="center">
        <TextField
          variant="outlined"
          size="medium"
          placeholder="Search"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            if (hasSearched) {
              setHasSearched(false);
            }
          }}
        />
        {search.trim() && !hasSearched && (
          <Button variant="contained" size="large" onClick={handleSearch}>
            SEARCH
          </Button>
        )}
        {hasSearched && (
          <Button variant="outlined" size="large" onClick={handleClearSearch}>
            CLEAR
          </Button>
        )}
        {(orgType !== 'Tenant' || accessRole.startsWith('hrx_')) && (
          <MUIAutocomplete
            options={availableAgencies}
            value={agencyFilter}
            onChange={(_, newValue) => {
              setAgencyFilter(newValue || '');
              // Always trigger fetchCustomers when agency filter changes, even if cleared
              setTimeout(() => fetchCustomers(search, null, newValue || ''), 0);
            }}
            renderInput={(params) => (
              <TextField
                {...params}
                variant="outlined"
                size="medium"
                placeholder="Filter by Agency"
                sx={{ minWidth: 200 }}
              />
            )}
            clearOnEscape
          />
        )}
        <FormControl size="small" sx={{ minWidth: 180 }}>
          <InputLabel>Filter by Company Location</InputLabel>
          <Select
            value={companyLocationFilter}
            label="Filter by Company Location"
            onChange={(e) => setCompanyLocationFilter(e.target.value)}
            displayEmpty
          >
            <MenuItem value="">
              <em>All Locations</em>
            </MenuItem>
            {companyLocations.map((location) => (
              <MenuItem key={location.id} value={location.id}>
                {location.nickname || location.name || location.id}
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
      </Box>

      <CustomersTableBlock
        tenants={getSortedCustomers()}
        loading={loading}
        onView={(id) => navigate(`/tenants/${id}`)}
        tenantId={orgType === 'Tenant' && !accessRole.startsWith('hrx_') ? tenantId : undefined}
        companyLocations={companyLocations}
      />

      {!isEnd && (
        <Box mt={2}>
          <Button onClick={() => fetchCustomers(search, lastDoc, agencyFilter)} disabled={loading}>
            Load More
          </Button>
        </Box>
      )}
    </Box>
  );
};

export default CustomersTable;
