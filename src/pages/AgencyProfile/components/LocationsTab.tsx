import React, { useEffect, useState, useRef } from 'react';
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
  TableSortLabel,
  Checkbox,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  DialogContentText,
  IconButton,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Chip,
  Autocomplete,
} from '@mui/material';
import { collection, addDoc, getDocs, query, serverTimestamp, deleteDoc, doc, updateDoc } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { Autocomplete as GoogleAutocomplete } from '@react-google-maps/api';
import { Delete as DeleteIcon, Edit as EditIcon, Save as SaveIcon, Cancel as CancelIcon } from '@mui/icons-material';

import { geocodeAddress } from '../../../utils/geocodeAddress';
import { db } from '../../../firebase';

// Location type options
const locationTypeOptions = [
  'Office',
  'Warehouse',
  'Manufacturing Plant',
  'Distribution Center',
  'Retail Store',
  'Care Facility',
  'Hospital',
  'Clinic',
  'Laboratory',
  'Data Center',
  'Call Center',
  'Training Center',
  'Conference Center',
  'Restaurant',
  'Hotel',
  'Resort',
  'Airport',
  'Port',
  'Railway Station',
  'Bus Terminal',
  'Gas Station',
  'Bank',
  'Post Office',
  'Library',
  'School',
  'University',
  'Government Building',
  'Police Station',
  'Fire Station',
  'Military Base',
  'Construction Site',
  'Mining Site',
  'Oil Rig',
  'Wind Farm',
  'Solar Plant',
  'Power Plant',
  'Water Treatment Plant',
  'Waste Management Facility',
  'Recycling Center',
  'Farm',
  'Greenhouse',
  'Vineyard',
  'Brewery',
  'Distillery',
  'Food Processing Plant',
  'Textile Factory',
  'Automotive Plant',
  'Aerospace Facility',
  'Shipyard',
  'Chemical Plant',
  'Pharmaceutical Plant',
  'Biotech Lab',
  'Research Facility',
  'Testing Center',
  'Quality Control Lab',
  'Maintenance Shop',
  'Repair Facility',
  'Service Center',
  'Showroom',
  'Gallery',
  'Museum',
  'Theater',
  'Stadium',
  'Arena',
  'Gym',
  'Fitness Center',
  'Spa',
  'Salon',
  'Barber Shop',
  'Dry Cleaner',
  'Laundry',
  'Car Wash',
  'Auto Repair',
  'Tire Shop',
  'Hardware Store',
  'Home Improvement',
  'Furniture Store',
  'Electronics Store',
  'Bookstore',
  'Toy Store',
  'Pet Store',
  'Garden Center',
  'Nursery',
  'Veterinary Clinic',
  'Animal Shelter',
  'Zoo',
  'Aquarium',
  'Park',
  'Recreation Center',
  'Community Center',
  'Senior Center',
  'Day Care',
  'Child Care',
  'Elder Care',
  'Assisted Living',
  'Nursing Home',
  'Hospice',
  'Funeral Home',
  'Cemetery',
  'Church',
  'Temple',
  'Mosque',
  'Synagogue',
  'Other'
];

// Country options
const countryOptions = [
  'US', 'CA', 'MX', 'GB', 'DE', 'FR', 'IT', 'ES', 'NL', 'BE', 'CH', 'AT', 'SE', 'NO', 'DK', 'FI', 'PL', 'CZ', 'HU', 'RO', 'BG', 'HR', 'SI', 'SK', 'EE', 'LV', 'LT', 'IE', 'PT', 'GR', 'CY', 'MT', 'LU', 'IS', 'LI', 'MC', 'SM', 'VA', 'AD', 'AU', 'NZ', 'JP', 'KR', 'CN', 'IN', 'BR', 'AR', 'CL', 'PE', 'CO', 'VE', 'EC', 'BO', 'PY', 'UY', 'GY', 'SR', 'GF', 'FK', 'GS', 'AQ'
];

// Status options
const statusOptions = [
  'Active',
  'Inactive',
  'Archived',
];

// Timezone options
const timezoneOptions = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'America/Phoenix',
  'America/Indiana/Indianapolis',
  'America/Detroit',
  'America/Kentucky/Louisville',
  'America/Boise',
  'America/Regina',
  'America/Edmonton',
  'America/Vancouver',
  'America/Toronto',
  'America/Montreal',
  'America/Halifax',
  'America/St_Johns',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Rome',
  'Europe/Madrid',
  'Europe/Amsterdam',
  'Europe/Brussels',
  'Europe/Vienna',
  'Europe/Zurich',
  'Europe/Stockholm',
  'Europe/Oslo',
  'Europe/Copenhagen',
  'Europe/Helsinki',
  'Europe/Warsaw',
  'Europe/Prague',
  'Europe/Budapest',
  'Europe/Bucharest',
  'Europe/Sofia',
  'Europe/Zagreb',
  'Europe/Ljubljana',
  'Europe/Bratislava',
  'Europe/Tallinn',
  'Europe/Riga',
  'Europe/Vilnius',
  'Europe/Dublin',
  'Europe/Lisbon',
  'Europe/Athens',
  'Europe/Nicosia',
  'Europe/Valletta',
  'Europe/Luxembourg',
  'Europe/Reykjavik',
  'Europe/Vaduz',
  'Europe/Monaco',
  'Europe/San_Marino',
  'Europe/Vatican',
  'Europe/Andorra',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Asia/Shanghai',
  'Asia/Beijing',
  'Asia/Hong_Kong',
  'Asia/Singapore',
  'Asia/Bangkok',
  'Asia/Ho_Chi_Minh',
  'Asia/Jakarta',
  'Asia/Manila',
  'Asia/Kuala_Lumpur',
  'Asia/Dhaka',
  'Asia/Kolkata',
  'Asia/Karachi',
  'Asia/Dubai',
  'Asia/Tel_Aviv',
  'Asia/Riyadh',
  'Asia/Baghdad',
  'Asia/Tehran',
  'Asia/Tashkent',
  'Asia/Almaty',
  'Asia/Novosibirsk',
  'Asia/Yekaterinburg',
  'Asia/Omsk',
  'Asia/Krasnoyarsk',
  'Asia/Irkutsk',
  'Asia/Yakutsk',
  'Asia/Vladivostok',
  'Asia/Magadan',
  'Asia/Kamchatka',
  'Australia/Sydney',
  'Australia/Melbourne',
  'Australia/Brisbane',
  'Australia/Adelaide',
  'Australia/Perth',
  'Australia/Darwin',
  'Australia/Hobart',
  'Pacific/Auckland',
  'Pacific/Fiji',
  'Pacific/Guam',
  'Pacific/Saipan',
  'Pacific/Honolulu',
  'Pacific/Midway',
  'Pacific/Wake',
  'Pacific/Kwajalein',
  'Pacific/Majuro',
  'Pacific/Palau',
  'Pacific/Port_Moresby',
  'Pacific/Guadalcanal',
  'Pacific/Noumea',
  'Pacific/Norfolk',
  'Pacific/Pitcairn',
  'Pacific/Easter',
  'Pacific/Galapagos',
  'Pacific/Marquesas',
  'Pacific/Gambier',
  'Pacific/Tahiti',
  'Pacific/Rarotonga',
  'Pacific/Niue',
  'Pacific/Tongatapu',
  'Pacific/Chatham',
  'Pacific/Kiritimati',
  'Pacific/Apia',
  'Pacific/Pago_Pago',
  'Pacific/Fakaofo',
  'Pacific/Rarotonga',
  'Pacific/Niue',
  'Pacific/Tongatapu',
  'Pacific/Chatham',
  'Pacific/Kiritimati',
  'Pacific/Apia',
  'Pacific/Pago_Pago',
  'Pacific/Fakaofo'
];

interface LocationsTabProps {
  tenantId: string;
}

function formatPhoneNumber(value: string) {
  const cleaned = value.replace(/\D/g, '');
  const match = cleaned.match(/^(\d{0,3})(\d{0,3})(\d{0,4})$/);
  if (!match) return value;
  let formatted = '';
  if (match[1]) formatted += `(${match[1]}`;
  if (match[2]) formatted += match[2].length === 3 ? `) ${match[2]}` : match[2];
  if (match[3]) formatted += `-${match[3]}`;
  return formatted;
}

const LocationsTab: React.FC<LocationsTabProps> = ({ tenantId }) => {
  const [form, setForm] = useState({
    nickname: '',
    cid: '',
    street: '',
    city: '',
    state: '',
    zip: '',
    country: 'US',
    phone: '',
    timezone: '',
    latitude: 0,
    longitude: 0,
    region: '',
    division: '',
    locationType: '',
    primaryContacts: [] as string[],
    status: 'Active',
    tags: [] as string[],
    externalIds: {} as Record<string, string>,
    notes: '',
  });
  const [locations, setLocations] = useState<any[]>([]);
  const [regions, setRegions] = useState<any[]>([]);
  const [divisions, setDivisions] = useState<any[]>([]);
  const [workforce, setWorkforce] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const autocompleteRef = useRef<any>(null);
  const [showForm, setShowForm] = useState(false);
  const [order, setOrder] = useState<'asc' | 'desc'>('asc');
  const [orderBy, setOrderBy] = useState<string>('nickname');
  const [selectedRows, setSelectedRows] = useState<string[]>([]);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    nickname: '',
    customId: '',
    streetAddress: '',
    city: '',
    stateProvince: '',
    zipPostalCode: '',
    country: 'US',
    phoneNumber: '',
    timezone: '',
    latitude: '',
    longitude: '',
    region: '',
    division: '',
    locationType: '',
    primaryContacts: [] as string[],
    status: 'Active',
    tags: [] as string[],
    externalIds: {} as Record<string, string>,
    notes: '',
  });
  const [externalIdKey, setExternalIdKey] = useState('');
  const [externalIdValue, setExternalIdValue] = useState('');

  const handleRequestSort = (property: string) => {
    const isAsc = orderBy === property && order === 'asc';
    setOrder(isAsc ? 'desc' : 'asc');
    setOrderBy(property);
  };

  const sortedLocations = React.useMemo(() => {
    const data = [...locations];
    data.sort((a, b) => {
      let aValue = a[orderBy] || '';
      let bValue = b[orderBy] || '';
      if (orderBy === 'city') {
        aValue = a.city || '';
        bValue = b.city || '';
      }
      if (orderBy === 'state') {
        aValue = a.state || '';
        bValue = b.state || '';
      }
      if (orderBy === 'cid') {
        aValue = a.cid || '';
        bValue = b.cid || '';
      }
      if (orderBy === 'nickname') {
        aValue = a.nickname || '';
        bValue = b.nickname || '';
      }
      if (aValue < bValue) return order === 'asc' ? -1 : 1;
      if (aValue > bValue) return order === 'asc' ? 1 : -1;
      return 0;
    });
    return data;
  }, [locations, order, orderBy]);

  useEffect(() => {
    fetchLocations();
    fetchRegions();
    fetchDivisions();
    fetchWorkforce();
    // eslint-disable-next-line
  }, [tenantId]);

  const fetchLocations = async () => {
    setLoading(true);
    try {
      const q = query(collection(db, 'tenants', tenantId, 'locations'));
      const snapshot = await getDocs(q);
      setLocations(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    } catch (err: any) {
      setError(err.message || 'Failed to fetch locations');
    }
    setLoading(false);
  };

  const fetchRegions = async () => {
    try {
      const q = query(collection(db, 'tenants', tenantId, 'regions'));
      const snapshot = await getDocs(q);
      setRegions(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    } catch (err: any) {
      console.error('Failed to fetch regions:', err);
    }
  };

  const fetchDivisions = async () => {
    try {
      const q = query(collection(db, 'tenants', tenantId, 'divisions'));
      const snapshot = await getDocs(q);
      setDivisions(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    } catch (err: any) {
      console.error('Failed to fetch divisions:', err);
    }
  };

  const fetchWorkforce = async () => {
    try {
      const q = query(collection(db, 'tenants', tenantId, 'workforce'));
      const snapshot = await getDocs(q);
      setWorkforce(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    } catch (err: any) {
      console.error('Failed to fetch workforce:', err);
    }
  };

  const handleChange = (field: string, value: any) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleEditChange = (field: string, value: any) => {
    setEditForm((prev) => ({ ...prev, [field]: value }));
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
      country: getComponent(['country']) || 'US',
    }));
  };

  const handleAddExternalId = () => {
    if (externalIdKey && externalIdValue) {
      setForm(prev => ({
        ...prev,
        externalIds: { ...prev.externalIds, [externalIdKey]: externalIdValue }
      }));
      setExternalIdKey('');
      setExternalIdValue('');
    }
  };

  const handleRemoveExternalId = (key: string) => {
    setForm(prev => {
      const newExternalIds = { ...prev.externalIds };
      delete newExternalIds[key];
      return { ...prev, externalIds: newExternalIds };
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const fullAddress = `${form.street}, ${form.city}, ${form.state} ${form.zip}, ${form.country}`;
      const geo = await geocodeAddress(fullAddress);
      await addDoc(collection(db, 'tenants', tenantId, 'locations'), {
        ...form,
        latitude: geo.lat,
        longitude: geo.lng,
        createdAt: serverTimestamp(),
      });
      setForm({ 
        nickname: '', 
        cid: '', 
        street: '', 
        city: '', 
        state: '', 
        zip: '', 
        country: 'US',
        phone: '', 
        timezone: '',
        latitude: 0,
        longitude: 0,
        region: '',
        division: '',
        locationType: '',
        primaryContacts: [],
        status: 'Active',
        tags: [],
        externalIds: {},
        notes: ''
      });
      setExternalIdKey('');
      setExternalIdValue('');
      setSuccess(true);
      fetchLocations();
    } catch (err: any) {
      setError(err.message || 'Failed to add location');
    }
    setLoading(false);
  };

  const handleEdit = (location: any) => {
    setEditingId(location.id);
    setEditForm({
      nickname: location.nickname || '',
      customId: location.cid || '',
      streetAddress: location.street || '',
      city: location.city || '',
      stateProvince: location.state || '',
      zipPostalCode: location.zip || '',
      country: location.country || 'US',
      phoneNumber: location.phone || '',
      timezone: location.timezone || '',
      latitude: location.latitude || '',
      longitude: location.longitude || '',
      region: location.region || '',
      division: location.division || '',
      locationType: location.locationType || '',
      primaryContacts: location.primaryContacts || [],
      status: location.status || 'Active',
      tags: location.tags || [],
      externalIds: location.externalIds || {},
      notes: location.notes || '',
    });
  };

  const handleSaveEdit = async (locationId: string) => {
    setLoading(true);
    setError('');
    try {
      const updateData = {
        nickname: editForm.nickname,
        cid: editForm.customId,
        street: editForm.streetAddress,
        city: editForm.city,
        state: editForm.stateProvince,
        zip: editForm.zipPostalCode,
        country: editForm.country,
        phone: editForm.phoneNumber,
        timezone: editForm.timezone,
        latitude: editForm.latitude,
        longitude: editForm.longitude,
        region: editForm.region,
        division: editForm.division,
        locationType: editForm.locationType,
        primaryContacts: editForm.primaryContacts,
        status: editForm.status,
        tags: editForm.tags,
        externalIds: editForm.externalIds,
        notes: editForm.notes,
        updatedAt: serverTimestamp(),
      };
      
      await updateDoc(doc(db, 'tenants', tenantId, 'locations', locationId), updateData);
      setEditingId(null);
      setSuccess(true);
      fetchLocations();
    } catch (err: any) {
      setError(err.message || 'Failed to update location');
    }
    setLoading(false);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditForm({
      nickname: '',
      customId: '',
      streetAddress: '',
      city: '',
      stateProvince: '',
      zipPostalCode: '',
      country: 'US',
      phoneNumber: '',
      timezone: '',
      latitude: '',
      longitude: '',
      region: '',
      division: '',
      locationType: '',
      primaryContacts: [],
      status: 'Active',
      tags: [],
      externalIds: {},
      notes: '',
    });
  };

  const handleEditAddExternalId = () => {
    if (externalIdKey && externalIdValue) {
      setEditForm(prev => ({
        ...prev,
        externalIds: { ...prev.externalIds, [externalIdKey]: externalIdValue }
      }));
      setExternalIdKey('');
      setExternalIdValue('');
    }
  };

  const handleEditRemoveExternalId = (key: string) => {
    setEditForm(prev => {
      const newExternalIds = { ...prev.externalIds };
      delete newExternalIds[key];
      return { ...prev, externalIds: newExternalIds };
    });
  };

  const handleRowSelect = (id: string) => {
    setSelectedRows(prev => 
      prev.includes(id) 
        ? prev.filter(rowId => rowId !== id)
        : [...prev, id]
    );
  };

  const handleSelectAll = () => {
    if (selectedRows.length === locations.length) {
      setSelectedRows([]);
    } else {
      setSelectedRows(locations.map(location => location.id));
    }
  };

  const handleDelete = (id: string) => {
    setDeleteTarget(id);
    setDeleteDialogOpen(true);
  };

  const handleDeleteSelected = () => {
    setDeleteTarget('selected');
    setDeleteDialogOpen(true);
  };

  const confirmDelete = async () => {
    setLoading(true);
    setError('');
    try {
      if (deleteTarget === 'selected') {
        // Delete multiple selected rows
        for (const id of selectedRows) {
          await deleteDoc(doc(db, 'tenants', tenantId, 'locations', id));
        }
        setSelectedRows([]);
      } else if (deleteTarget) {
        // Delete single row
        await deleteDoc(doc(db, 'tenants', tenantId, 'locations', deleteTarget));
      }
      setSuccess(true);
      fetchLocations();
    } catch (err: any) {
      setError(err.message || 'Failed to delete location(s)');
    }
    setLoading(false);
    setDeleteDialogOpen(false);
    setDeleteTarget(null);
  };

  return (
    <Box sx={{ p: 0 }}>
      <Box display="flex" alignItems="center" justifyContent="space-between" mb={2}>
        <Typography variant="h6">Locations ({locations.length})</Typography>
        <Box display="flex" gap={1}>
          {selectedRows.length > 0 && (
            <Button
              variant="outlined"
              color="error"
              startIcon={<DeleteIcon />}
              onClick={handleDeleteSelected}
            >
              Delete Selected ({selectedRows.length})
            </Button>
          )}
          <Button
            variant="contained"
            color="primary"
            onClick={() => setShowForm(true)}
          >
            ADD NEW LOCATION
          </Button>
        </Box>
      </Box>
      {showForm && (
        <>
          <Typography variant="h6" gutterBottom>
            Add New Location
          </Typography>
          <form onSubmit={handleSubmit}>
            <Grid container spacing={2} mb={2}>
              {/* Basic Information */}
              <Grid item xs={12} sm={6}>
                <TextField
                  label="Nickname"
                  fullWidth
                  required
                  value={form.nickname}
                  onChange={(e) => handleChange('nickname', e.target.value)}
                  placeholder="e.g., LA HQ, Nursing Unit B, Phx Warehouse"
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  label="Custom ID (optional)"
                  fullWidth
                  value={form.cid}
                  onChange={(e) => handleChange('cid', e.target.value)}
                  placeholder="External reference code for syncing"
                />
              </Grid>

              {/* Address Information */}
              <Grid item xs={12}>
                <GoogleAutocomplete
                  onLoad={(ref) => (autocompleteRef.current = ref)}
                  onPlaceChanged={handlePlaceChanged}
                >
                  <TextField
                    label="Street Address"
                    fullWidth
                    required
                    value={form.street}
                    onChange={(e) => handleChange('street', e.target.value)}
                  />
                </GoogleAutocomplete>
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  label="City"
                  fullWidth
                  required
                  value={form.city}
                  onChange={(e) => handleChange('city', e.target.value)}
                />
              </Grid>
              <Grid item xs={12} sm={3}>
                <TextField
                  label="State / Province"
                  fullWidth
                  required
                  value={form.state}
                  onChange={(e) => handleChange('state', e.target.value)}
                />
              </Grid>
              <Grid item xs={12} sm={3}>
                <TextField
                  label="ZIP / Postal Code"
                  fullWidth
                  required
                  value={form.zip}
                  onChange={(e) => handleChange('zip', e.target.value)}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <FormControl fullWidth required>
                  <InputLabel>Country</InputLabel>
                  <Select
                    value={form.country}
                    label="Country"
                    onChange={(e) => handleChange('country', e.target.value)}
                  >
                    {countryOptions.map((country) => (
                      <MenuItem key={country} value={country}>
                        {country}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  label="Phone Number (optional)"
                  fullWidth
                  value={form.phone}
                  onChange={(e) => handleChange('phone', formatPhoneNumber(e.target.value))}
                />
              </Grid>

              {/* Time Zone and Location Type */}
              <Grid item xs={12} sm={6}>
                <FormControl fullWidth required>
                  <InputLabel>Time Zone</InputLabel>
                  <Select
                    value={form.timezone}
                    label="Time Zone"
                    onChange={(e) => handleChange('timezone', e.target.value)}
                  >
                    <MenuItem value="">Select Time Zone</MenuItem>
                    {timezoneOptions.map((tz) => (
                      <MenuItem key={tz} value={tz}>
                        {tz}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={6}>
                <FormControl fullWidth>
                  <InputLabel>Location Type</InputLabel>
                  <Select
                    value={form.locationType}
                    label="Location Type"
                    onChange={(e) => handleChange('locationType', e.target.value)}
                  >
                    <MenuItem value="">Select Type</MenuItem>
                    {locationTypeOptions.map((type) => (
                      <MenuItem key={type} value={type}>
                        {type}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>

              {/* References */}
              <Grid item xs={12} sm={6}>
                <FormControl fullWidth>
                  <InputLabel>Region</InputLabel>
                  <Select
                    value={form.region}
                    label="Region"
                    onChange={(e) => handleChange('region', e.target.value)}
                  >
                    <MenuItem value="">Select Region</MenuItem>
                    {regions.map((region) => (
                      <MenuItem key={region.id} value={region.id}>
                        {region.name}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={6}>
                <FormControl fullWidth>
                  <InputLabel>Division</InputLabel>
                  <Select
                    value={form.division}
                    label="Division"
                    onChange={(e) => handleChange('division', e.target.value)}
                  >
                    <MenuItem value="">Select Division</MenuItem>
                    {divisions.map((division) => (
                      <MenuItem key={division.id} value={division.id}>
                        {division.name}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>

              {/* Primary Contacts */}
              <Grid item xs={12}>
                <Autocomplete
                  multiple
                  options={workforce}
                  getOptionLabel={(option) => `${option.firstName} ${option.lastName}`}
                  value={form.primaryContacts}
                  onChange={(_, newValue) => handleChange('primaryContacts', newValue.map(c => c.id))}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Primary Contact(s)"
                      placeholder="Select contacts responsible for operations"
                    />
                  )}
                  renderTags={(value, getTagProps) =>
                    value.map((contactId, index) => {
                      const contact = workforce.find(w => w.id === contactId);
                      return (
                        <Chip
                          key={contactId}
                          label={contact ? `${contact.firstName} ${contact.lastName}` : contactId}
                          {...getTagProps({ index })}
                        />
                      );
                    })
                  }
                />
              </Grid>

              {/* Status and Tags */}
              <Grid item xs={12} sm={6}>
                <FormControl fullWidth required>
                  <InputLabel>Active Status</InputLabel>
                  <Select
                    value={form.status}
                    label="Active Status"
                    onChange={(e) => handleChange('status', e.target.value)}
                  >
                    {statusOptions.map((status) => (
                      <MenuItem key={status} value={status}>
                        {status}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={6}>
                <Autocomplete
                  multiple
                  freeSolo
                  options={[]}
                  value={form.tags}
                  onChange={(_, newValue) => handleChange('tags', newValue)}
                  renderTags={(value, getTagProps) =>
                    value.map((option, index) => (
                      <Chip
                        variant="outlined"
                        label={option}
                        {...getTagProps({ index })}
                      />
                    ))
                  }
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Tags"
                      placeholder="e.g., union, 24/7 ops, onsite only"
                    />
                  )}
                />
              </Grid>

              {/* External Sync IDs */}
              <Grid item xs={12}>
                <Box>
                  <Typography variant="subtitle2" gutterBottom>
                    External Sync IDs
                  </Typography>
                  <Grid container spacing={1}>
                    {Object.entries(form.externalIds).map(([key, value]) => (
                      <Grid item xs={12} key={key}>
                        <Box display="flex" gap={1}>
                          <TextField
                            size="small"
                            label="System"
                            value={key}
                            disabled
                            sx={{ flex: 1 }}
                          />
                          <TextField
                            size="small"
                            label="ID"
                            value={value}
                            disabled
                            sx={{ flex: 1 }}
                          />
                          <IconButton
                            size="small"
                            onClick={() => handleRemoveExternalId(key)}
                            color="error"
                          >
                            ×
                          </IconButton>
                        </Box>
                      </Grid>
                    ))}
                    <Grid item xs={12}>
                      <Box display="flex" gap={1}>
                        <TextField
                          size="small"
                          label="System"
                          value={externalIdKey}
                          onChange={(e) => setExternalIdKey(e.target.value)}
                          placeholder="e.g., workdayLocationId"
                          sx={{ flex: 1 }}
                        />
                        <TextField
                          size="small"
                          label="ID"
                          value={externalIdValue}
                          onChange={(e) => setExternalIdValue(e.target.value)}
                          placeholder="e.g., WD123"
                          sx={{ flex: 1 }}
                        />
                        <Button
                          size="small"
                          onClick={handleAddExternalId}
                          disabled={!externalIdKey || !externalIdValue}
                        >
                          Add
                        </Button>
                      </Box>
                    </Grid>
                  </Grid>
                </Box>
              </Grid>

              {/* Notes */}
              <Grid item xs={12}>
                <TextField
                  label="Notes / Description"
                  fullWidth
                  multiline
                  rows={3}
                  value={form.notes}
                  onChange={(e) => handleChange('notes', e.target.value)}
                  placeholder="Freeform notes or internal memo"
                />
              </Grid>

              {/* Submit Buttons */}
              <Grid item xs={12} display="flex" gap={2}>
                <Button type="submit" variant="contained" color="primary" disabled={loading}>
                  {loading ? 'Adding...' : 'Add Location'}
                </Button>
                <Button variant="outlined" color="secondary" onClick={() => setShowForm(false)}>
                  Cancel
                </Button>
              </Grid>
            </Grid>
          </form>
        </>
      )}
      {/* <Typography variant="h6">Locations</Typography> */}
      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell padding="checkbox">
                <Checkbox
                  indeterminate={selectedRows.length > 0 && selectedRows.length < locations.length}
                  checked={selectedRows.length === locations.length && locations.length > 0}
                  onChange={handleSelectAll}
                />
              </TableCell>
              {/* Nickname */}
              <TableCell sortDirection={orderBy === 'nickname' ? order : false}>
                <TableSortLabel
                  active={orderBy === 'nickname'}
                  direction={orderBy === 'nickname' ? order : 'asc'}
                  onClick={() => handleRequestSort('nickname')}
                >
                  Nickname
                </TableSortLabel>
              </TableCell>
              {/* Custom ID */}
              <TableCell sortDirection={orderBy === 'cid' ? order : false}>
                <TableSortLabel
                  active={orderBy === 'cid'}
                  direction={orderBy === 'cid' ? order : 'asc'}
                  onClick={() => handleRequestSort('cid')}
                >
                  Custom ID
                </TableSortLabel>
              </TableCell>
              {/* Location Type */}
              <TableCell>Location Type</TableCell>
              {/* Address */}
              <TableCell>Address</TableCell>
              {/* Region */}
              <TableCell>Region</TableCell>
              {/* Division */}
              <TableCell>Division</TableCell>
              {/* Status */}
              <TableCell>Status</TableCell>
              {/* Actions */}
              <TableCell>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sortedLocations.map((loc) => (
              <TableRow
                key={loc.id}
                hover
                style={{ cursor: 'pointer' }}
                onClick={() => {
                  if (editingId !== loc.id) {
                    navigate(`/tenants/${tenantId}/locations/${loc.id}`);
                  }
                }}
              >
                <TableCell padding="checkbox">
                  <Checkbox
                    checked={selectedRows.includes(loc.id)}
                    onChange={(e) => {
                      e.stopPropagation();
                      handleRowSelect(loc.id);
                    }}
                  />
                </TableCell>
                <TableCell>
                  {editingId === loc.id ? (
                    <TextField
                      size="small"
                      value={editForm.nickname}
                      onChange={(e) => handleEditChange('nickname', e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    loc.nickname
                  )}
                </TableCell>
                <TableCell>
                  {editingId === loc.id ? (
                    <TextField
                      size="small"
                      value={editForm.customId}
                      onChange={(e) => handleEditChange('customId', e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    loc.cid || '-'
                  )}
                </TableCell>
                <TableCell>
                  {editingId === loc.id ? (
                    <TextField
                      size="small"
                      value={editForm.locationType}
                      onChange={(e) => handleEditChange('locationType', e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    loc.locationType || '-'
                  )}
                </TableCell>
                <TableCell>
                  {editingId === loc.id ? (
                    <Box onClick={(e) => e.stopPropagation()}>
                      <TextField
                        size="small"
                        label="Street"
                        value={editForm.streetAddress}
                        onChange={(e) => handleEditChange('streetAddress', e.target.value)}
                        sx={{ mb: 1 }}
                        fullWidth
                      />
                      <TextField
                        size="small"
                        label="City"
                        value={editForm.city}
                        onChange={(e) => handleEditChange('city', e.target.value)}
                        sx={{ mb: 1 }}
                        fullWidth
                      />
                      <Box display="flex" gap={1}>
                        <TextField
                          size="small"
                          label="State"
                          value={editForm.stateProvince}
                          onChange={(e) => handleEditChange('stateProvince', e.target.value)}
                          sx={{ flex: 1 }}
                        />
                        <TextField
                          size="small"
                          label="Zip"
                          value={editForm.zipPostalCode}
                          onChange={(e) => handleEditChange('zipPostalCode', e.target.value)}
                          sx={{ flex: 1 }}
                        />
                      </Box>
                    </Box>
                  ) : (
                    loc.street ? (
                      <Box>
                        <Typography variant="body2">{loc.street}</Typography>
                        <Typography variant="caption" color="textSecondary">
                          {loc.city}, {loc.state} {loc.zip}
                        </Typography>
                      </Box>
                    ) : '-'
                  )}
                </TableCell>
                <TableCell>
                  {editingId === loc.id ? (
                    <FormControl size="small" fullWidth>
                      <Select
                        value={editForm.region}
                        onChange={(e) => handleEditChange('region', e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <MenuItem value="">Select Region</MenuItem>
                        {regions.map((region) => (
                          <MenuItem key={region.id} value={region.id}>
                            {region.name}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  ) : (
                    loc.region ? regions.find(r => r.id === loc.region)?.name || '-' : '-'
                  )}
                </TableCell>
                <TableCell>
                  {editingId === loc.id ? (
                    <FormControl size="small" fullWidth>
                      <Select
                        value={editForm.division}
                        onChange={(e) => handleEditChange('division', e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <MenuItem value="">Select Division</MenuItem>
                        {divisions.map((division) => (
                          <MenuItem key={division.id} value={division.id}>
                            {division.name}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  ) : (
                    loc.division ? divisions.find(d => d.id === loc.division)?.name || '-' : '-'
                  )}
                </TableCell>
                <TableCell>
                  {editingId === loc.id ? (
                    <FormControl size="small" fullWidth>
                      <Select
                        value={editForm.status}
                        onChange={(e) => handleEditChange('status', e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <MenuItem value="Active">Active</MenuItem>
                        <MenuItem value="Inactive">Inactive</MenuItem>
                        <MenuItem value="Archived">Archived</MenuItem>
                      </Select>
                    </FormControl>
                  ) : (
                    <Chip
                      label={loc.status || 'Active'}
                      color={
                        loc.status === 'Active' ? 'success' :
                        loc.status === 'Inactive' ? 'warning' : 'default'
                      }
                      size="small"
                    />
                  )}
                </TableCell>
                <TableCell>
                  {editingId === loc.id ? (
                    <Box display="flex" gap={1}>
                      <IconButton
                        size="small"
                        color="primary"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSaveEdit(loc.id);
                        }}
                        disabled={loading}
                      >
                        <SaveIcon />
                      </IconButton>
                      <IconButton
                        size="small"
                        color="secondary"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCancelEdit();
                        }}
                      >
                        <CancelIcon />
                      </IconButton>
                    </Box>
                  ) : (
                    <Box display="flex" gap={1}>
                      <IconButton
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleEdit(loc);
                        }}
                      >
                        <EditIcon />
                      </IconButton>
                      <IconButton
                        size="small"
                        color="error"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(loc.id);
                        }}
                      >
                        <DeleteIcon />
                      </IconButton>
                    </Box>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
      >
        <DialogTitle>Confirm Delete</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {deleteTarget === 'selected' 
              ? `Are you sure you want to delete ${selectedRows.length} selected location(s)? This action cannot be undone.`
              : 'Are you sure you want to delete this location? This action cannot be undone.'
            }
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
          <Button onClick={confirmDelete} color="error" variant="contained">
            Delete
          </Button>
        </DialogActions>
      </Dialog>
      <Snackbar open={!!error} autoHideDuration={4000} onClose={() => setError('')}>
        <Alert severity="error" onClose={() => setError('')} sx={{ width: '100%' }}>
          {error}
        </Alert>
      </Snackbar>
      <Snackbar open={success} autoHideDuration={2000} onClose={() => setSuccess(false)}>
        <Alert severity="success" sx={{ width: '100%' }}>
          Location added!
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default LocationsTab;