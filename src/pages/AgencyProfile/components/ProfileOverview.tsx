import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  TextField,
  Button,
  Grid,
  Paper,
  Snackbar,
  Alert,
  Divider,
  FormHelperText,
  FormControlLabel,
  Switch,
  Card,
  CardContent,
} from '@mui/material';
import { doc, getDoc, updateDoc, setDoc } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { getFunctions, httpsCallable } from 'firebase/functions';

import { db } from '../../../firebase';

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

const ProfileOverview = ({ tenantId }: { tenantId: string }) => {
  const [tenant, setTenant] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [slugError, setSlugError] = useState('');
  const [checkingSlug, setCheckingSlug] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [hrxFlexEnabled, setHrxFlexEnabled] = useState(false);
  const [flexDivisionExists, setFlexDivisionExists] = useState(false);
  const navigate = useNavigate();

  const [form, setForm] = useState({
    name: '',
    slug: '',
    phone: '',
    email: '',
    website: '',
    street: '',
    city: '',
    state: '',
    zip: '',
  });

  useEffect(() => {
    fetchTenant();
  }, [tenantId]);

  const fetchTenant = async () => {
    try {
      const tenantRef = doc(db, 'tenants', tenantId);
      const tenantSnap = await getDoc(tenantRef);
      if (tenantSnap.exists()) {
        const data = tenantSnap.data();
        setTenant({ id: tenantSnap.id, ...data });
        setHrxFlexEnabled(data.hrxFlex === true);
        setForm({
          name: data.name || '',
          slug: data.slug || '',
          phone: data.contact?.phone || '',
          email: data.contact?.email || '',
          website: data.contact?.website || '',
          street: data.address?.street || '',
          city: data.address?.city || '',
          state: data.address?.state || '',
          zip: data.address?.zip || '',
        });
        
        // Check if Flex division exists
        const flexDivisionRef = doc(db, 'tenants', tenantId, 'divisions', 'auto_flex');
        const flexDivisionSnap = await getDoc(flexDivisionRef);
        setFlexDivisionExists(flexDivisionSnap.exists());
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch tenant');
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (field: string, value: any) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const checkSlugAvailability = async (slug: string, currentSlug?: string) => {
    if (!slug || slug === currentSlug) return;
    
    setCheckingSlug(true);
    try {
      const functions = getFunctions();
      const validateSlug = httpsCallable(functions, 'validateTenantSlug');
      const result = await validateSlug({ 
        slug, 
        excludeTenantId: currentSlug ? tenantId : undefined 
      });
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
    checkSlugAvailability(slug, tenant?.slug);
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    
    // Validate slug
    const validation = validateSlug(form.slug);
    if (!validation.isValid) {
      setError(validation.error || 'Invalid slug');
      setSaving(false);
      return;
    }
    
    // Check if slug is available
    if (slugError) {
      setError('Please fix the slug errors before saving');
      setSaving(false);
      return;
    }
    
    try {
      const tenantRef = doc(db, 'tenants', tenantId);
      await updateDoc(tenantRef, {
        name: form.name,
        slug: form.slug,
        contact: {
          phone: form.phone,
          email: form.email,
          website: form.website,
        },
        address: {
          street: form.street,
          city: form.city,
          state: form.state,
          zip: form.zip,
        },
        updatedAt: new Date(),
      });
      
      setSuccess(true);
      setIsEditing(false);
      fetchTenant(); // Refresh data
    } catch (err: any) {
      setError(err.message || 'Failed to update tenant');
    }
    setSaving(false);
  };

  const handleCancel = () => {
    setIsEditing(false);
    setSlugError('');
    // Reset form to original values
    if (tenant) {
      setForm({
        name: tenant.name || '',
        slug: tenant.slug || '',
        phone: tenant.contact?.phone || '',
        email: tenant.contact?.email || '',
        website: tenant.contact?.website || '',
        street: tenant.address?.street || '',
        city: tenant.address?.city || '',
        state: tenant.address?.state || '',
        zip: tenant.address?.zip || '',
      });
    }
  };

  const handleHrxFlexToggle = async (enabled: boolean) => {
    setSaving(true);
    setError('');
    
    try {
      const tenantRef = doc(db, 'tenants', tenantId);
      
      if (enabled) {
        // Enable hrxFlex and create Flex division
        await updateDoc(tenantRef, {
          hrxFlex: true,
          updatedAt: new Date(),
        });
        
        // Create the Flex division
        const flexDivisionRef = doc(db, 'tenants', tenantId, 'divisions', 'auto_flex');
        await setDoc(flexDivisionRef, {
          name: 'Flex',
          shortcode: 'FLEX',
          type: 'System',
          description: 'System-managed division for workers with securityLevel: "Flex"',
          isSystem: true,
          autoAssignRules: {
            securityLevel: '2'
          },
          status: 'Active',
          tags: ['system', 'flex', 'auto-managed'],
          externalIds: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        
        setFlexDivisionExists(true);
        console.log('Flex division created for tenant', tenantId);
      } else {
        // Disable hrxFlex
        await updateDoc(tenantRef, {
          hrxFlex: false,
          updatedAt: new Date(),
        });
        
        // Note: We don't delete the Flex division as it might have existing members
        // The division will remain but won't auto-assign new workers
      }
      
      setHrxFlexEnabled(enabled);
      setSuccess(true);
      fetchTenant(); // Refresh data
    } catch (err: any) {
      setError(err.message || 'Failed to update HRX Flex setting');
    }
    setSaving(false);
  };

  if (loading) {
    return (
      <Box sx={{ p: 3, textAlign: 'center' }}>
        <Typography>Loading tenant information...</Typography>
      </Box>
    );
  }

  if (!tenant) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography variant="h6" color="error">
          Tenant not found
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 0 }}>
      <Paper sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
          <Typography variant="h5">Tenant Profile</Typography>
          {!isEditing ? (
            <Button variant="outlined" onClick={() => setIsEditing(true)}>
              Edit Profile
            </Button>
          ) : (
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button variant="outlined" onClick={handleCancel}>
                Cancel
              </Button>
              <Button 
                variant="contained" 
                onClick={handleSave}
                disabled={saving || !!slugError || checkingSlug}
              >
                {saving ? 'Saving...' : 'Save Changes'}
              </Button>
            </Box>
          )}
        </Box>

        <Grid container spacing={3}>
          {/* Basic Information */}
          <Grid item xs={12}>
            <Typography variant="h6" gutterBottom>
              Basic Information
            </Typography>
          </Grid>
          
          <Grid item xs={12} md={6}>
            <TextField
              label="Tenant Name"
              fullWidth
              value={form.name}
              onChange={(e) => handleChange('name', e.target.value)}
              disabled={!isEditing}
            />
          </Grid>
          
          <Grid item xs={12} md={6}>
            <TextField
              label="Slug"
              fullWidth
              value={form.slug}
              onChange={handleSlugChange}
              disabled={!isEditing}
              error={!!slugError}
              helperText={
                slugError || 
                (form.slug ? `Accessible at app.hrxone.com/${form.slug}` : '')
              }
              InputProps={{
                startAdornment: <Typography variant="body2" sx={{ mr: 1 }}>app.hrxone.com/</Typography>,
              }}
            />
            {checkingSlug && (
              <FormHelperText>Checking availability...</FormHelperText>
            )}
          </Grid>
          
          <Grid item xs={12} md={4}>
            <TextField
              label="Tenant Type"
              fullWidth
              value={tenant.type || 'agency'}
              disabled
              InputProps={{
                readOnly: true,
              }}
            />
          </Grid>
          
          <Grid item xs={12} md={4}>
            <TextField
              label="Created"
              fullWidth
              value={tenant.createdAt ? new Date(tenant.createdAt.toDate()).toLocaleDateString() : 'N/A'}
              disabled
              InputProps={{
                readOnly: true,
              }}
            />
          </Grid>
          
          <Grid item xs={12} md={4}>
            <TextField
              label="Last Updated"
              fullWidth
              value={tenant.updatedAt ? new Date(tenant.updatedAt.toDate()).toLocaleDateString() : 'N/A'}
              disabled
              InputProps={{
                readOnly: true,
              }}
            />
          </Grid>

          <Grid item xs={12}>
            <Divider sx={{ my: 2 }} />
          </Grid>

          {/* HRX Flex Feature */}
          <Grid item xs={12}>
            <Typography variant="h6" gutterBottom>
              HRX Flex Division
            </Typography>
          </Grid>
          
          <Grid item xs={12}>
            <Card variant="outlined" sx={{ bgcolor: 'grey.50' }}>
              <CardContent>
                <Box display="flex" alignItems="center" justifyContent="space-between" mb={2}>
                  <Box>
                    <Typography variant="subtitle1" fontWeight="bold">
                      Automatic Flex Division Management
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      When enabled, automatically creates and maintains a "Flex" division for workers with securityLevel: "Flex"
                    </Typography>
                  </Box>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={hrxFlexEnabled}
                        onChange={(e) => handleHrxFlexToggle(e.target.checked)}
                        disabled={saving}
                      />
                    }
                    label={hrxFlexEnabled ? 'Enabled' : 'Disabled'}
                  />
                </Box>
                
                {hrxFlexEnabled && (
                  <Box mt={2}>
                    <Typography variant="body2" color="text.secondary">
                      ✅ Flex division is {flexDivisionExists ? 'active' : 'being created...'}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      • Workers with securityLevel: "Flex" will be automatically assigned to this division
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      • The division is system-managed and cannot be deleted or renamed
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      • You can view and manage the division in the Divisions tab
                    </Typography>
                  </Box>
                )}
                
                {!hrxFlexEnabled && flexDivisionExists && (
                  <Box mt={2}>
                    <Typography variant="body2" color="warning.main">
                      ⚠️ Flex division exists but auto-assignment is disabled
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      • Existing Flex division will remain but new workers won't be auto-assigned
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      • Re-enable this feature to resume automatic assignment
                    </Typography>
                  </Box>
                )}
              </CardContent>
            </Card>
          </Grid>

          <Grid item xs={12}>
            <Divider sx={{ my: 2 }} />
          </Grid>

          {/* Contact Information */}
          <Grid item xs={12}>
            <Typography variant="h6" gutterBottom>
              Contact Information
            </Typography>
          </Grid>
          
          <Grid item xs={12} md={4}>
            <TextField
              label="Email"
              fullWidth
              type="email"
              value={form.email}
              onChange={(e) => handleChange('email', e.target.value)}
              disabled={!isEditing}
            />
          </Grid>
          
          <Grid item xs={12} md={4}>
            <TextField
              label="Phone"
              fullWidth
              value={form.phone}
              onChange={(e) => handleChange('phone', e.target.value)}
              disabled={!isEditing}
            />
          </Grid>
          
          <Grid item xs={12} md={4}>
            <TextField
              label="Website"
              fullWidth
              value={form.website}
              onChange={(e) => handleChange('website', e.target.value)}
              disabled={!isEditing}
            />
          </Grid>

          <Grid item xs={12}>
            <Divider sx={{ my: 2 }} />
          </Grid>

          {/* Address Information */}
          <Grid item xs={12}>
            <Typography variant="h6" gutterBottom>
              Address Information
            </Typography>
          </Grid>
          
          <Grid item xs={12}>
            <TextField
              label="Street Address"
              fullWidth
              value={form.street}
              onChange={(e) => handleChange('street', e.target.value)}
              disabled={!isEditing}
            />
          </Grid>
          
          <Grid item xs={12} md={4}>
            <TextField
              label="City"
              fullWidth
              value={form.city}
              onChange={(e) => handleChange('city', e.target.value)}
              disabled={!isEditing}
            />
          </Grid>
          
          <Grid item xs={12} md={4}>
            <TextField
              label="State"
              fullWidth
              value={form.state}
              onChange={(e) => handleChange('state', e.target.value)}
              disabled={!isEditing}
            />
          </Grid>
          
          <Grid item xs={12} md={4}>
            <TextField
              label="Zip Code"
              fullWidth
              value={form.zip}
              onChange={(e) => handleChange('zip', e.target.value)}
              disabled={!isEditing}
            />
          </Grid>

          <Grid item xs={12}>
            <Divider sx={{ my: 2 }} />
          </Grid>

          {/* Statistics */}
          <Grid item xs={12}>
            <Typography variant="h6" gutterBottom>
              Statistics
            </Typography>
          </Grid>
          
          <Grid item xs={12} md={3}>
            <Box sx={{ textAlign: 'center', p: 2, bgcolor: 'grey.50', borderRadius: 1 }}>
              <Typography variant="h4" color="primary">
                {tenant.tenants?.length || 0}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Customers
              </Typography>
            </Box>
          </Grid>
          
          <Grid item xs={12} md={3}>
            <Box sx={{ textAlign: 'center', p: 2, bgcolor: 'grey.50', borderRadius: 1 }}>
              <Typography variant="h4" color="primary">
                {tenant.modules?.length || 0}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Active Modules
              </Typography>
            </Box>
          </Grid>
          
          <Grid item xs={12} md={3}>
            <Box sx={{ textAlign: 'center', p: 2, bgcolor: 'grey.50', borderRadius: 1 }}>
              <Typography variant="h4" color="primary">
                {tenant.settings?.jobTitles?.length || 0}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Job Titles
              </Typography>
            </Box>
          </Grid>
          
          <Grid item xs={12} md={3}>
            <Box sx={{ textAlign: 'center', p: 2, bgcolor: 'grey.50', borderRadius: 1 }}>
              <Typography variant="h4" color="primary">
                {tenant.settings?.uniformDefaults?.length || 0}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Uniform Types
              </Typography>
            </Box>
          </Grid>
        </Grid>
      </Paper>

      <Snackbar open={!!error} autoHideDuration={4000} onClose={() => setError('')}>
        <Alert severity="error" onClose={() => setError('')} sx={{ width: '100%' }}>
          {error}
        </Alert>
      </Snackbar>
      
      <Snackbar open={success} autoHideDuration={2000} onClose={() => setSuccess(false)}>
        <Alert severity="success" sx={{ width: '100%' }}>
          Tenant profile updated successfully!
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default ProfileOverview;
