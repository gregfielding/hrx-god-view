import React, { useEffect, useState, useRef } from 'react';
import { Box, Typography, TextField, Button, Grid, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper, Snackbar, Alert } from '@mui/material';
import { collection, addDoc, getDocs, query, where, serverTimestamp } from 'firebase/firestore';
import { db } from '../../../firebase';
import { useNavigate } from 'react-router-dom';
import { geocodeAddress } from '../../../utils/geocodeAddress';
import { Autocomplete } from '@react-google-maps/api';

interface LocationsTabProps {
  agencyId: string;
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

const LocationsTab: React.FC<LocationsTabProps> = ({ agencyId }) => {
  const [form, setForm] = useState({
    nickname: '',
    street: '',
    city: '',
    state: '',
    zip: '',
    phone: '',
  });
  const [locations, setLocations] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const autocompleteRef = useRef<any>(null);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    fetchLocations();
    // eslint-disable-next-line
  }, [agencyId]);

  const fetchLocations = async () => {
    setLoading(true);
    try {
      const q = query(collection(db, 'agencies', agencyId, 'locations'));
      const snapshot = await getDocs(q);
      setLocations(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    } catch (err: any) {
      setError(err.message || 'Failed to fetch locations');
    }
    setLoading(false);
  };

  const handleChange = (field: string, value: string) => {
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const fullAddress = `${form.street}, ${form.city}, ${form.state} ${form.zip}`;
      const geo = await geocodeAddress(fullAddress);
      await addDoc(collection(db, 'agencies', agencyId, 'locations'), {
        ...form,
        agencyLat: geo.lat,
        agencyLng: geo.lng,
        createdAt: serverTimestamp(),
      });
      setForm({ nickname: '', street: '', city: '', state: '', zip: '', phone: '' });
      setSuccess(true);
      fetchLocations();
    } catch (err: any) {
      setError(err.message || 'Failed to add location');
    }
    setLoading(false);
  };

  return (
    <Box sx={{ p: 2 }}>
      {!showForm && (
        <Button variant="contained" color="primary" sx={{ mb: 2 }} onClick={() => setShowForm(true)}>
          Add New Location
        </Button>
      )}
      {showForm && (
        <>
          <Typography variant="h6" gutterBottom>Add New Location</Typography>
          <form onSubmit={handleSubmit}>
            <Grid container spacing={2} mb={2}>
              <Grid item xs={12} sm={4}>
                <TextField label="Nickname" fullWidth required value={form.nickname} onChange={e => handleChange('nickname', e.target.value)} />
              </Grid>
              <Grid item xs={12} sm={8}>
                <Autocomplete
                  onLoad={(ref) => (autocompleteRef.current = ref)}
                  onPlaceChanged={handlePlaceChanged}
                >
                  <TextField
                    label="Street Address"
                    fullWidth
                    required
                    value={form.street}
                    onChange={e => handleChange('street', e.target.value)}
                  />
                </Autocomplete>
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField label="City" fullWidth required value={form.city} onChange={e => handleChange('city', e.target.value)} />
              </Grid>
              <Grid item xs={6} sm={2}>
                <TextField label="State" fullWidth required value={form.state} onChange={e => handleChange('state', e.target.value)} />
              </Grid>
              <Grid item xs={6} sm={2}>
                <TextField label="Zip" fullWidth required value={form.zip} onChange={e => handleChange('zip', e.target.value)} />
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField label="Phone (optional)" fullWidth value={form.phone} onChange={e => handleChange('phone', formatPhoneNumber(e.target.value))} />
              </Grid>
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
      <Typography variant="h6" gutterBottom>Locations</Typography>
      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Nickname</TableCell>
              <TableCell>Address</TableCell>
              <TableCell>Phone</TableCell>
              <TableCell>View</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {locations.map((loc) => (
              <TableRow key={loc.id} hover style={{ cursor: 'pointer' }} onClick={() => navigate(`/agencies/${agencyId}/locations/${loc.id}`)}>
                <TableCell>{loc.nickname}</TableCell>
                <TableCell>{`${loc.street}, ${loc.city}, ${loc.state} ${loc.zip}`}</TableCell>
                <TableCell>{loc.phone || '-'}</TableCell>
                <TableCell>
                  <Button size="small" variant="outlined" onClick={e => { e.stopPropagation(); navigate(`/agencies/${agencyId}/locations/${loc.id}`); }}>View</Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <Snackbar open={!!error} autoHideDuration={4000} onClose={() => setError('')}>
        <Alert severity="error" onClose={() => setError('')} sx={{ width: '100%' }}>{error}</Alert>
      </Snackbar>
      <Snackbar open={success} autoHideDuration={2000} onClose={() => setSuccess(false)}>
        <Alert severity="success" sx={{ width: '100%' }}>Location added!</Alert>
      </Snackbar>
    </Box>
  );
};

export default LocationsTab; 