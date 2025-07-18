import React, { useEffect, useState, useRef } from 'react';
import { Box, TextField, Typography, Button, Snackbar, Alert, Grid, MenuItem } from '@mui/material';
import { db } from '../../../firebase';
import { doc, onSnapshot, updateDoc, collection, getDocs, getDoc, serverTimestamp } from 'firebase/firestore';
import IndustrySelector from '../../../components/IndustrySelector';
import { geocodeAddress } from '../../../utils/geocodeAddress';
import { Autocomplete } from '@react-google-maps/api';

type Props = {
  tenantId: string;
};

const CustomerOverview: React.FC<Props> = ({ tenantId }) => {
  const [form, setForm] = useState({
    name: '',
    street: '',
    city: '',
    state: '',
    zip: '',
    industry: '',
  });
  const [originalForm, setOriginalForm] = useState(form);
  const [message, setMessage] = useState('');
  const [showToast, setShowToast] = useState(false);
  const [tenants, setTenants] = useState<any[]>([]);
  const [selectedTenant, setSelectedTenant] = useState('');
  const [currentTenant, setCurrentTenant] = useState<any>(null);
  const [tenantLoading, setTenantLoading] = useState(false);
  const [tenantSuccess, setTenantSuccess] = useState(false);
  const [tenantError, setTenantError] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const autocompleteRef = useRef<any>(null);

  useEffect(() => {
    if (!tenantId) return;
    const customerRef = doc(db, 'tenants', tenantId);
    const unsubscribe = onSnapshot(
      customerRef,
      (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data();
          setForm({
            name: data.name || '',
            street: data.address?.street || '',
            city: data.address?.city || '',
            state: data.address?.state || '',
            zip: data.address?.zip || '',
            industry: data.industry || '',
          });
          setOriginalForm({
            name: data.name || '',
            street: data.address?.street || '',
            city: data.address?.city || '',
            state: data.address?.state || '',
            zip: data.address?.zip || '',
            industry: data.industry || '',
          });
        }
      },
      (error) => {
        console.error('Error fetching customer data in real-time:', error);
      },
    );
    return () => unsubscribe();
  }, [tenantId]);

  useEffect(() => {
    const fetchTenants = async () => {
      try {
        const q = collection(db, 'tenants');
        const snapshot = await getDocs(q);
        setTenants(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
      } catch (err: any) {
        setTenantError(err.message || 'Failed to fetch tenants');
      }
    };
    const fetchCurrentTenant = async () => {
      try {
        const customerRef = doc(db, 'tenants', tenantId);
        const snap = await getDoc(customerRef);
        if (snap.exists()) {
          const data = snap.data();
          if (data.tenantId) {
            setSelectedTenant(data.tenantId);
            // Fetch tenant name
            const tenantRef = doc(db, 'tenants', data.tenantId);
            const tenantSnap = await getDoc(tenantRef);
            if (tenantSnap.exists()) {
              setCurrentTenant({ id: data.tenantId, ...tenantSnap.data() });
            }
          } else {
            setSelectedTenant('');
            setCurrentTenant(null);
          }
        }
      } catch (err: any) {
        setTenantError(err.message || 'Failed to fetch current tenant');
      }
    };
    fetchTenants();
    fetchCurrentTenant();
  }, [tenantId]);

  const hasChanges = JSON.stringify(form) !== JSON.stringify(originalForm);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleIndustryChange = (industryCode: string) => {
    setForm({ ...form, industry: industryCode });
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

  const handleTenantSave = async () => {
    setTenantLoading(true);
    setTenantError('');
    try {
      const customerRef = doc(db, 'tenants', tenantId);
      await updateDoc(customerRef, { tenantId: selectedTenant });
      // Add tenantId to tenant's tenants array
      const tenantRef = doc(db, 'tenants', selectedTenant);
      const tenantSnap = await getDoc(tenantRef);
      let tenants: string[] = [];
      if (tenantSnap.exists()) {
        tenants = tenantSnap.data().tenants || [];
      }
      if (!tenants.includes(tenantId)) {
        tenants.push(tenantId);
        await updateDoc(tenantRef, { tenants });
      }
      setTenantSuccess(true);
      // Refresh current tenant
      const tenantSnap2 = await getDoc(tenantRef);
      if (tenantSnap2.exists()) {
        setCurrentTenant({ id: selectedTenant, ...tenantSnap2.data() });
      }
    } catch (err: any) {
      setTenantError(err.message || 'Failed to associate tenant');
    }
    setTenantLoading(false);
  };

  const handleTenantRemove = async () => {
    setTenantLoading(true);
    setTenantError('');
    try {
      const customerRef = doc(db, 'tenants', tenantId);
      await updateDoc(customerRef, { tenantId: null });
      // Remove tenantId from tenant's tenants array
      if (currentTenant) {
        const tenantRef = doc(db, 'tenants', currentTenant.id);
        const tenantSnap = await getDoc(tenantRef);
        let tenants: string[] = [];
        if (tenantSnap.exists()) {
          tenants = tenantSnap.data().tenants || [];
        }
        tenants = tenants.filter((id) => id !== tenantId);
        await updateDoc(tenantRef, { tenants });
      }
      setTenantSuccess(true);
      setCurrentTenant(null);
      setSelectedTenant('');
    } catch (err: any) {
      setTenantError(err.message || 'Failed to remove tenant association');
    }
    setTenantLoading(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const fullAddress = `${form.street}, ${form.city}, ${form.state} ${form.zip}`;
      const geo = await geocodeAddress(fullAddress);
      const customerRef = doc(db, 'tenants', tenantId);
      await updateDoc(customerRef, {
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
        updatedAt: serverTimestamp(),
      });
      setOriginalForm(form);
      setMessage('Profile updated successfully');
      setShowToast(true);
    } catch (err: any) {
      setError(err.message || 'Failed to update profile');
    }
    setLoading(false);
  };

  return (
    <Box sx={{ p: 0 }}>
      <Typography variant="h6" mb={2}>
        Account Overview
      </Typography>
      <Box component="form" onSubmit={handleSubmit} noValidate>
        <Grid container spacing={2}>
          <Grid item xs={12}>
            <TextField
              fullWidth
              name="name"
              label="Customer Name"
              value={form.name}
              onChange={handleChange}
            />
          </Grid>
          <Grid item xs={12}>
            <Autocomplete
              onLoad={(ref) => (autocompleteRef.current = ref)}
              onPlaceChanged={handlePlaceChanged}
            >
              <TextField
                fullWidth
                name="street"
                label="Street Address"
                value={form.street}
                onChange={handleChange}
              />
            </Autocomplete>
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              fullWidth
              name="city"
              label="City"
              value={form.city}
              onChange={handleChange}
            />
          </Grid>
          <Grid item xs={6} sm={3}>
            <TextField
              fullWidth
              name="state"
              label="State"
              value={form.state}
              onChange={handleChange}
            />
          </Grid>
          <Grid item xs={6} sm={3}>
            <TextField fullWidth name="zip" label="Zip" value={form.zip} onChange={handleChange} />
          </Grid>
          <Grid item xs={12}>
            <IndustrySelector
              value={form.industry}
              onChange={handleIndustryChange}
              label="Industry"
              variant="autocomplete"
              showCategory={true}
            />
          </Grid>
          {hasChanges && (
            <Grid item xs={12}>
              <Button type="submit" variant="contained">
                Save Changes
              </Button>
            </Grid>
          )}
        </Grid>
      </Box>
      <Snackbar open={showToast} autoHideDuration={3000} onClose={() => setShowToast(false)}>
        <Alert onClose={() => setShowToast(false)} severity="success" sx={{ width: '100%' }}>
          {message}
        </Alert>
      </Snackbar>
      <Box mt={4}>
        <Typography variant="h6" gutterBottom>
          Associated Tenant
        </Typography>
        {currentTenant ? (
          <Box display="flex" alignItems="center" gap={2} mb={2}>
            <Typography>{currentTenant.name}</Typography>
            <Button variant="outlined" color="error" onClick={handleTenantRemove} disabled={tenantLoading}>
              Remove
            </Button>
          </Box>
        ) : (
          <Box display="flex" alignItems="center" gap={2} mb={2}>
            <TextField
              select
              label="Select Tenant"
              value={selectedTenant}
              onChange={(e) => setSelectedTenant(e.target.value)}
              fullWidth
            >
              {tenants.map((tenant) => (
                <MenuItem key={tenant.id} value={tenant.id}>
                  {tenant.name}
                </MenuItem>
              ))}
            </TextField>
            <Button variant="contained" onClick={handleTenantSave} disabled={!selectedTenant || tenantLoading}>
              Save
            </Button>
          </Box>
        )}
        <Snackbar open={!!tenantError} autoHideDuration={4000} onClose={() => setTenantError('')}>
          <Alert severity="error" onClose={() => setTenantError('')} sx={{ width: '100%' }}>
            {tenantError}
          </Alert>
        </Snackbar>
        <Snackbar open={tenantSuccess} autoHideDuration={2000} onClose={() => setTenantSuccess(false)}>
          <Alert severity="success" sx={{ width: '100%' }}>
            Tenant association updated!
          </Alert>
        </Snackbar>
      </Box>
    </Box>
  );
};

export default CustomerOverview;
