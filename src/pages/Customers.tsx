import React, { useState, useEffect, useRef } from 'react';
import {
  Box,
  Typography,
  Button,
  Paper,
  TextField,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Chip,
  Avatar,
  Alert,
  Snackbar,
  Tooltip,
  Grid,
} from '@mui/material';
import {
  Add as AddIcon,
  Search as SearchIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Visibility as VisibilityIcon,
  Business as BusinessIcon,
} from '@mui/icons-material';
import {
  collection,
  addDoc,
  getDocs,
  doc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  query,
  orderBy,
  where,
} from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import IndustrySelector from '../components/IndustrySelector';
import CustomerDetailsView from './TenantViews/CustomerDetailsView';
import { Autocomplete } from '@react-google-maps/api';
import { geocodeAddress } from '../utils/geocodeAddress';

interface Customer {
  id: string;
  name: string;
  industry: string;
  address: {
    street: string;
    city: string;
    state: string;
    zip: string;
  };
  customerLat?: number;
  customerLng?: number;
  companyLocationId?: string;
  linkedInUrl?: string;
  avatar?: string;
  status?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const Customers: React.FC = () => {
  const { tenantId, accessRole } = useAuth();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [companyLocationFilter, setCompanyLocationFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sortBy, setSortBy] = useState('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  
  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    industry: '',
    street: '',
    city: '',
    state: '',
    zip: '',
    companyLocationId: '',
    status: true,
  });
  
  // Success/error messages
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  
  // Customer details view state
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [companyLocations, setCompanyLocations] = useState<any[]>([]);
  const autocompleteRef = useRef<any>(null);

  useEffect(() => {
    loadCustomers();
    loadCompanyLocations();
  }, [tenantId]);

  const loadCustomers = async () => {
    if (!tenantId) return;
    
    try {
      setLoading(true);
      const customersRef = collection(db, 'tenants', tenantId, 'customers');
      const q = query(customersRef, orderBy('createdAt', 'desc'));
      const snapshot = await getDocs(q);
      const customersData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        createdAt: doc.data().createdAt?.toDate() || new Date(),
        updatedAt: doc.data().updatedAt?.toDate() || new Date(),
      })) as Customer[];
      setCustomers(customersData);
    } catch (error) {
      console.error('Error loading customers:', error);
      setErrorMessage('Failed to load customers');
    } finally {
      setLoading(false);
    }
  };

  const loadCompanyLocations = async () => {
    if (!tenantId) return;
    
    try {
      const locationsRef = collection(db, 'tenants', tenantId, 'locations');
      const snapshot = await getDocs(locationsRef);
      const locationsData = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      setCompanyLocations(locationsData);
    } catch (error) {
      console.error('Error loading company locations:', error);
    }
  };

  const handlePlaceChanged = () => {
    const place = autocompleteRef.current.getPlace();
    if (!place || !place.geometry) return;
    const components = place.address_components || [];
    const getComponent = (types: string[]) =>
      components.find((comp: any) => types.every((t) => comp.types.includes(t)))?.long_name || '';
    setFormData((prev) => ({
      ...prev,
      street: `${getComponent(['street_number'])} ${getComponent(['route'])}`.trim(),
      city: getComponent(['locality']),
      state: getComponent(['administrative_area_level_1']),
      zip: getComponent(['postal_code']),
    }));
  };

  const handleSubmit = async () => {
    if (!formData.name.trim() || !tenantId) return;
    
    try {
      setLoading(true);
      
      // Geocode the address to get coordinates
      const fullAddress = `${formData.street}, ${formData.city}, ${formData.state} ${formData.zip}`;
      const geo = await geocodeAddress(fullAddress);
      
      const customerData = {
        name: formData.name.trim(),
        industry: formData.industry,
        address: {
          street: formData.street,
          city: formData.city,
          state: formData.state,
          zip: formData.zip,
        },
        customerLat: geo.lat,
        customerLng: geo.lng,
        companyLocationId: formData.companyLocationId || null,
        status: formData.status,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      
      await addDoc(collection(db, 'tenants', tenantId, 'customers'), customerData);
      
      setFormData({
        name: '',
        industry: '',
        street: '',
        city: '',
        state: '',
        zip: '',
        companyLocationId: '',
        status: true,
      });
      setDialogOpen(false);
      setSuccessMessage('Customer created successfully!');
      loadCustomers();
    } catch (error) {
      console.error('Error creating customer:', error);
      setErrorMessage('Failed to create customer');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteCustomer = async (customerId: string) => {
    if (!tenantId) return;
    
    try {
      setLoading(true);
      await deleteDoc(doc(db, 'tenants', tenantId, 'customers', customerId));
      setSuccessMessage('Customer removed successfully!');
      loadCustomers();
    } catch (error) {
      console.error('Error removing customer:', error);
      setErrorMessage('Failed to remove customer');
    } finally {
      setLoading(false);
    }
  };

  const handleSort = (field: string) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('asc');
    }
  };

  const filteredAndSortedCustomers = customers
    .filter(customer => {
      // Search filter
      const searchMatch = 
        customer.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        customer.industry.toLowerCase().includes(searchTerm.toLowerCase()) ||
        customer.address.city.toLowerCase().includes(searchTerm.toLowerCase()) ||
        customer.address.state.toLowerCase().includes(searchTerm.toLowerCase());
      
      // Company location filter
      const locationMatch = !companyLocationFilter || customer.companyLocationId === companyLocationFilter;
      
      // Status filter
      const statusMatch = !statusFilter || 
        (statusFilter === 'active' && customer.status === true) ||
        (statusFilter === 'inactive' && customer.status === false);
      
      return searchMatch && locationMatch && statusMatch;
    })
    .sort((a, b) => {
      let aValue: any;
      let bValue: any;
      
      switch (sortBy) {
        case 'name':
          aValue = a.name;
          bValue = b.name;
          break;
        case 'industry':
          aValue = a.industry;
          bValue = b.industry;
          break;
        case 'city':
          aValue = a.address.city;
          bValue = b.address.city;
          break;
        case 'companyLocation':
          aValue = getLocationNickname(a.companyLocationId || '');
          bValue = getLocationNickname(b.companyLocationId || '');
          break;
        case 'createdAt':
          aValue = a.createdAt;
          bValue = b.createdAt;
          break;
        default:
          aValue = a.name;
          bValue = b.name;
      }
      
      if (sortOrder === 'asc') {
        return aValue < bValue ? -1 : aValue > bValue ? 1 : 0;
      } else {
        return aValue > bValue ? -1 : aValue < bValue ? 1 : 0;
      }
    });

  const getLocationNickname = (locationId: string) => {
    const location = companyLocations.find(loc => loc.id === locationId);
    return location ? location.nickname : 'Unknown Location';
  };

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(word => word[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  if (selectedCustomer) {
    return (
      <CustomerDetailsView
        customer={selectedCustomer}
        tenantId={tenantId!}
        onBack={() => setSelectedCustomer(null)}
        onRemoveCustomer={handleDeleteCustomer}
      />
    );
  }

  return (
    <Box sx={{ p: 0, width: '100%' }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3, mt: 0 }}>
        <Typography variant="h4">Customers</Typography>
      </Box>

      {/* Search and Create */}
      <Box sx={{ display: 'flex', gap: 2, mb: 3, alignItems: 'center' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', flex: 1, gap: 2 }}>
          <TextField
            placeholder="Search customers..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            size="small"
            sx={{ minWidth: 300 }}
            InputProps={{
              startAdornment: <SearchIcon sx={{ mr: 1, color: 'text.secondary' }} />,
            }}
          />
          <FormControl size="small" sx={{ minWidth: 220 }}>
            <InputLabel shrink={true}>Company Location</InputLabel>
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
                All locations
              </MenuItem>
              {companyLocations.map((location) => (
                <MenuItem key={location.id} value={location.id}>
                  {location.nickname}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 150 }}>
            <InputLabel shrink={true}>Status</InputLabel>
            <Select
              value={statusFilter}
              label="Status"
              onChange={(e) => setStatusFilter(e.target.value)}
              displayEmpty
              sx={{
                '& .MuiSelect-select': {
                  padding: '8px 14px',
                },
              }}
            >
              <MenuItem value="">
                All statuses
              </MenuItem>
              <MenuItem value="active">
                Active
              </MenuItem>
              <MenuItem value="inactive">
                Inactive
              </MenuItem>
            </Select>
          </FormControl>
        </Box>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setDialogOpen(true)}
        >
          Create New Customer
        </Button>
      </Box>

      {/* Customers Table */}
      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell 
                onClick={() => handleSort('name')}
                sx={{ cursor: 'pointer', '&:hover': { backgroundColor: 'rgba(0, 0, 0, 0.04)' } }}
              >
                Customer
                {sortBy === 'name' && (
                  <span style={{ marginLeft: 4 }}>
                    {sortOrder === 'asc' ? '↑' : '↓'}
                  </span>
                )}
              </TableCell>
              <TableCell 
                onClick={() => handleSort('industry')}
                sx={{ cursor: 'pointer', '&:hover': { backgroundColor: 'rgba(0, 0, 0, 0.04)' } }}
              >
                Industry
                {sortBy === 'industry' && (
                  <span style={{ marginLeft: 4 }}>
                    {sortOrder === 'asc' ? '↑' : '↓'}
                  </span>
                )}
              </TableCell>
              <TableCell 
                onClick={() => handleSort('city')}
                sx={{ cursor: 'pointer', '&:hover': { backgroundColor: 'rgba(0, 0, 0, 0.04)' } }}
              >
                Location
                {sortBy === 'city' && (
                  <span style={{ marginLeft: 4 }}>
                    {sortOrder === 'asc' ? '↑' : '↓'}
                  </span>
                )}
              </TableCell>
              <TableCell 
                onClick={() => handleSort('companyLocation')}
                sx={{ cursor: 'pointer', '&:hover': { backgroundColor: 'rgba(0, 0, 0, 0.04)' } }}
              >
                Company Location
                {sortBy === 'companyLocation' && (
                  <span style={{ marginLeft: 4 }}>
                    {sortOrder === 'asc' ? '↑' : '↓'}
                  </span>
                )}
              </TableCell>
              <TableCell>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filteredAndSortedCustomers.map((customer) => (
              <TableRow key={customer.id}>
                <TableCell>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <Avatar sx={{ width: 40, height: 40 }}>
                      {customer.avatar ? (
                        <img src={customer.avatar} alt={customer.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        getInitials(customer.name)
                      )}
                    </Avatar>
                    <Box sx={{ flex: 1 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0 }}>
                        <Typography variant="body1" fontWeight="medium">
                          {customer.name}
                        </Typography>
                        <Chip
                          label={customer.status ? 'Active' : 'Inactive'}
                          sx={{
                            backgroundColor: customer.status ? '#4caf50' : '#9e9e9e',
                            color: 'white',
                            fontWeight: 'bold',
                            fontSize: '0.75rem',
                            height: 20,
                          }}
                        />
                      </Box>
                      <Typography variant="body2" color="text.secondary" sx={{ p: 0 }}>
                        {customer.address.street}, {customer.address.city}, {customer.address.state}
                      </Typography>
                    </Box>
                  </Box>
                </TableCell>
                <TableCell>
                  {customer.industry ? (
                    <Chip label={customer.industry} size="small" variant="outlined" />
                  ) : (
                    <Typography variant="body2" color="text.secondary" fontStyle="italic">
                      Not specified
                    </Typography>
                  )}
                </TableCell>
                <TableCell>
                  <Typography variant="body2">
                    {customer.address.city}, {customer.address.state}
                  </Typography>
                </TableCell>
                <TableCell>
                  {customer.companyLocationId ? (
                    <Chip 
                      label={getLocationNickname(customer.companyLocationId)} 
                      size="small" 
                      variant="outlined" 
                      color="success"
                    />
                  ) : (
                    <Typography variant="body2" color="text.secondary" fontStyle="italic">
                      No association
                    </Typography>
                  )}
                </TableCell>
                <TableCell>
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => setSelectedCustomer(customer)}
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
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Create Customer Dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Create New Customer</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12}>
              <TextField
                label="Customer Name"
                fullWidth
                required
                value={formData.name}
                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
              />
            </Grid>
            <Grid item xs={12}>
              <IndustrySelector
                value={formData.industry}
                onChange={(value) => setFormData(prev => ({ ...prev, industry: value }))}
                label="Industry"
                variant="autocomplete"
                showCategory={true}
              />
            </Grid>
            <Grid item xs={12}>
              <Autocomplete
                onLoad={(ref) => (autocompleteRef.current = ref)}
                onPlaceChanged={handlePlaceChanged}
              >
                <TextField
                  label="Street Address"
                  fullWidth
                  value={formData.street}
                  onChange={(e) => setFormData(prev => ({ ...prev, street: e.target.value }))}
                />
              </Autocomplete>
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                label="City"
                fullWidth
                value={formData.city}
                onChange={(e) => setFormData(prev => ({ ...prev, city: e.target.value }))}
              />
            </Grid>
            <Grid item xs={12} sm={3}>
              <TextField
                label="State"
                fullWidth
                value={formData.state}
                onChange={(e) => setFormData(prev => ({ ...prev, state: e.target.value }))}
              />
            </Grid>
            <Grid item xs={12} sm={3}>
              <TextField
                label="ZIP"
                fullWidth
                value={formData.zip}
                onChange={(e) => setFormData(prev => ({ ...prev, zip: e.target.value }))}
              />
            </Grid>
            <Grid item xs={12}>
              <FormControl fullWidth>
                <InputLabel>Associate with Company Location (Optional)</InputLabel>
                <Select
                  value={formData.companyLocationId}
                  onChange={(e) => setFormData(prev => ({ ...prev, companyLocationId: e.target.value }))}
                  label="Associate with Company Location (Optional)"
                >
                  <MenuItem value="">
                    <em>No association</em>
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
                  value={formData.status ? 'true' : 'false'}
                  onChange={(e) => setFormData(prev => ({ ...prev, status: e.target.value === 'true' }))}
                  label="Status"
                >
                  <MenuItem value="true">Active</MenuItem>
                  <MenuItem value="false">Inactive</MenuItem>
                </Select>
              </FormControl>
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button 
            onClick={handleSubmit} 
            variant="contained" 
            disabled={loading || !formData.name.trim()}
          >
            {loading ? 'Creating...' : 'Create Customer'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Success/Error Messages */}
      <Snackbar
        open={!!successMessage}
        autoHideDuration={6000}
        onClose={() => setSuccessMessage('')}
      >
        <Alert onClose={() => setSuccessMessage('')} severity="success">
          {successMessage}
        </Alert>
      </Snackbar>
      
      <Snackbar
        open={!!errorMessage}
        autoHideDuration={6000}
        onClose={() => setErrorMessage('')}
      >
        <Alert onClose={() => setErrorMessage('')} severity="error">
          {errorMessage}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default Customers; 