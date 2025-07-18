import React, { useState } from 'react';
import { Box, Typography, TextField, Button, Grid, Snackbar, Alert, FormHelperText, FormControlLabel, Checkbox } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { collection, addDoc, serverTimestamp, query, where, getDocs } from 'firebase/firestore';
import { db } from '../../firebase';
import { geocodeAddress } from '../../utils/geocodeAddress';
import { getFunctions, httpsCallable } from 'firebase/functions';

function formatPhoneNumber(value: string) {
  // Remove all non-digit characters
  const cleaned = value.replace(/\D/g, '');
  const match = cleaned.match(/^(\d{0,3})(\d{0,3})(\d{0,4})$/);
  if (!match) return value;
  let formatted = '';
  if (match[1]) formatted += `(${match[1]}`;
  if (match[2]) formatted += match[2].length === 3 ? `) ${match[2]}` : match[2];
  if (match[3]) formatted += `-${match[3]}`;
  return formatted;
}

// Function to generate slug from name
function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '') // Remove special characters
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Replace multiple hyphens with single
    .trim()
    .replace(/^-|-$/g, ''); // Remove leading/trailing hyphens
}

// Function to validate slug
function validateSlug(slug: string): { isValid: boolean; error?: string } {
  if (!slug) {
    return { isValid: false, error: 'Slug is required' };
  }
  if (slug.length < 3) {
    return { isValid: false, error: 'Slug must be at least 3 characters long' };
  }
  if (slug.length > 50) {
    return { isValid: false, error: 'Slug must be less than 50 characters' };
  }
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return { isValid: false, error: 'Slug can only contain lowercase letters, numbers, and hyphens' };
  }
  if (slug.startsWith('-') || slug.endsWith('-')) {
    return { isValid: false, error: 'Slug cannot start or end with a hyphen' };
  }
  return { isValid: true };
}

const AddAgencyForm = () => {
  const [form, setForm] = useState({
    name: '',
    slug: '',
    street: '',
    city: '',
    state: '',
    zip: '',
    phone: '',
    email: '',
    website: '',
    type: 'agency', // 'agency' or 'customer'
    hrxFlex: false, // NEW: Enable Flex division feature
  });
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [slugError, setSlugError] = useState('');
  const [checkingSlug, setCheckingSlug] = useState(false);
  const navigate = useNavigate();

  const handleChange = (field: string, value: any) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    
    // Auto-generate slug when name changes
    if (field === 'name') {
      const generatedSlug = generateSlug(value);
      setForm((prev) => ({ ...prev, slug: generatedSlug }));
    }
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatPhoneNumber(e.target.value);
    handleChange('phone', formatted);
  };

  const checkSlugAvailability = async (slug: string) => {
    if (!slug) return;
    
    setCheckingSlug(true);
    try {
      const functions = getFunctions();
      const validateSlug = httpsCallable(functions, 'validateTenantSlug');
      const result = await validateSlug({ slug });
      const data = result.data as any;
      
      if (!data.available) {
        setSlugError(data.message || 'This slug is already taken. Please choose a different one.');
      } else {
        setSlugError('');
      }
    } catch (err: any) {
      console.error('Error checking slug availability:', err);
      setSlugError(err.message || 'Error checking slug availability');
    }
    setCheckingSlug(false);
  };

  const handleSlugChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const slug = e.target.value.toLowerCase();
    handleChange('slug', slug);
    
    // Validate slug format
    const validation = validateSlug(slug);
    if (!validation.isValid) {
      setSlugError(validation.error || '');
      return;
    }
    
    // Check availability
    checkSlugAvailability(slug);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    
    // Validate slug
    const validation = validateSlug(form.slug);
    if (!validation.isValid) {
      setError(validation.error || 'Invalid slug');
      setLoading(false);
      return;
    }
    
    // Check if slug is available
    if (slugError) {
      setError('Please fix the slug errors before submitting');
      setLoading(false);
      return;
    }
    
    try {
      const fullAddress = `${form.street}, ${form.city}, ${form.state} ${form.zip}`;
      const geo = await geocodeAddress(fullAddress);
      
      const tenantData = {
        name: form.name,
        slug: form.slug,
        type: form.type,
        hrxFlex: form.hrxFlex, // NEW: Include hrxFlex field
        address: {
          street: form.street,
          city: form.city,
          state: form.state,
          zip: form.zip,
          lat: geo.lat,
          lng: geo.lng,
        },
        contact: {
          phone: form.phone,
          email: form.email,
          website: form.website,
        },
        tenants: [], // Initialize empty tenants array
        modules: [], // Initialize empty modules array
        settings: {
          jobTitles: [],
          uniformDefaults: [],
        },
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      
      const docRef = await addDoc(collection(db, 'tenants'), tenantData);
      setSuccess(true);
      setTimeout(() => {
        navigate(`/tenants/${docRef.id}`);
      }, 1000);
    } catch (err: any) {
      setError(err.message || 'Failed to add tenant');
    }
    setLoading(false);
  };

  const isFormValid = form.name && form.slug && !slugError && !checkingSlug;

  return (
    <Box sx={{ p: 2, maxWidth: 800, mx: 'auto' }}>
      <Box display="flex" justifyContent="flex-end" mb={2}>
        <Button variant="outlined" onClick={() => navigate('/tenants')}>
          &larr; Back
        </Button>
      </Box>
      <Typography variant="h5" gutterBottom>
        Add New Tenant
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Create a new tenant that will be accessible at app.hrxone.com/{form.slug || 'tenant-slug'}
      </Typography>
      
      <form onSubmit={handleSubmit}>
        <Grid container spacing={3}>
          <Grid item xs={12} sm={6}>
            <TextField
              fullWidth
              label="Tenant Name"
              value={form.name}
              onChange={(e) => handleChange('name', e.target.value)}
              required
              error={!form.name}
              helperText={!form.name ? 'Tenant name is required' : ''}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              fullWidth
              label="Slug"
              value={form.slug}
              onChange={handleSlugChange}
              required
              error={!!slugError}
              helperText={slugError || (checkingSlug ? 'Checking availability...' : 'Unique identifier for the tenant')}
              disabled={checkingSlug}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              fullWidth
              label="Street Address"
              value={form.street}
              onChange={(e) => handleChange('street', e.target.value)}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              fullWidth
              label="City"
              value={form.city}
              onChange={(e) => handleChange('city', e.target.value)}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              fullWidth
              label="State"
              value={form.state}
              onChange={(e) => handleChange('state', e.target.value)}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              fullWidth
              label="ZIP Code"
              value={form.zip}
              onChange={(e) => handleChange('zip', e.target.value)}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              fullWidth
              label="Phone"
              value={form.phone}
              onChange={handlePhoneChange}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              fullWidth
              label="Email"
              type="email"
              value={form.email}
              onChange={(e) => handleChange('email', e.target.value)}
            />
          </Grid>
          <Grid item xs={12}>
            <TextField
              fullWidth
              label="Website"
              value={form.website}
              onChange={(e) => handleChange('website', e.target.value)}
            />
          </Grid>
          <Grid item xs={12}>
            <FormControlLabel
              control={
                <Checkbox
                  checked={form.hrxFlex}
                  onChange={(e) => handleChange('hrxFlex', e.target.checked)}
                />
              }
              label="Enable HRX Flex Division (Automatically creates and manages a 'Flex' division for workers with securityLevel: 'Flex')"
            />
            <FormHelperText>
              When enabled, a system-managed "Flex" division will be automatically created and maintained. 
              Any worker with securityLevel: "Flex" will be automatically assigned to this division.
            </FormHelperText>
          </Grid>
          <Grid item xs={12}>
            <Button
              type="submit"
              variant="contained"
              disabled={!isFormValid || loading}
              sx={{ mt: 2 }}
            >
              {loading ? 'Creating...' : 'Create Tenant'}
            </Button>
          </Grid>
        </Grid>
      </form>
      
      <Snackbar open={success} autoHideDuration={6000} onClose={() => setSuccess(false)}>
        <Alert onClose={() => setSuccess(false)} severity="success">
          Tenant created successfully! Redirecting...
        </Alert>
      </Snackbar>
      
      <Snackbar open={!!error} autoHideDuration={6000} onClose={() => setError('')}>
        <Alert onClose={() => setError('')} severity="error">
          {error}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default AddAgencyForm;
