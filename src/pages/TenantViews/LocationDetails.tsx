import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Paper,
  Button,
  IconButton,
  Grid,
  Card,
  CardContent,
  CardHeader,
  Divider,
  CircularProgress,
  Alert,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Autocomplete,
} from '@mui/material';
import SimpleAssociationsCard from '../../components/SimpleAssociationsCard';
import {
  ArrowBack as ArrowBackIcon,
  Edit as EditIcon,
  Save as SaveIcon,
  Cancel as CancelIcon,
  Delete as DeleteIcon,
  LocationOn as LocationIcon,
  Business as BusinessIcon,
  Person as PersonIcon,
  AttachMoney as DealIcon,
  Visibility as VisibilityIcon,
} from '@mui/icons-material';
import { doc, getDoc, collection, query, where, getDocs, updateDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';

interface LocationData {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
  type: string;
  division?: string;
  coordinates?: any;
  contactCount?: number;
  dealCount?: number;
  salespersonCount?: number;
  createdAt?: any;
  updatedAt?: any;
}

const LocationDetails: React.FC = () => {
  const { companyId, locationId } = useParams<{ companyId: string; locationId: string }>();
  const navigate = useNavigate();
  const { tenantId } = useAuth();
  
  const [location, setLocation] = useState<LocationData | null>(null);
  const [company, setCompany] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<Partial<LocationData>>({});

  useEffect(() => {
    console.log('LocationDetails useEffect triggered with:', { companyId, locationId, tenantId });
    
    if (!companyId || !locationId || !tenantId) {
      console.log('Missing required parameters:', { companyId, locationId, tenantId });
      return;
    }
    
    const loadLocationData = async () => {
      try {
        setLoading(true);
        console.log('Loading location data with tenantId:', tenantId, 'companyId:', companyId, 'locationId:', locationId);
        
        // Load company data
        const companyDoc = await getDoc(doc(db, 'tenants', tenantId, 'crm_companies', companyId));
        if (!companyDoc.exists()) {
          console.log('Company document does not exist');
          setError('Company not found');
          return;
        }
        console.log('Company document found:', companyDoc.data());
        setCompany({ id: companyDoc.id, ...companyDoc.data() });
        
        // Load location data
        const locationDoc = await getDoc(doc(db, 'tenants', tenantId, 'crm_companies', companyId, 'locations', locationId));
        if (!locationDoc.exists()) {
          console.log('Location document does not exist');
          setError('Location not found');
          return;
        }
        
        console.log('Location document found:', locationDoc.data());
        const locationData = { id: locationDoc.id, ...locationDoc.data() } as LocationData;
        setLocation(locationData);
        setEditForm(locationData);
        
      } catch (err: any) {
        console.error('Error loading location data:', err);
        console.error('Error details:', {
          code: err.code,
          message: err.message,
          tenantId,
          companyId,
          locationId
        });
        setError(err.message || 'Failed to load location data');
      } finally {
        setLoading(false);
      }
    };

    loadLocationData();
  }, [companyId, locationId, tenantId]);

  const handleEdit = () => {
    setEditing(true);
  };

  const handleCancelEdit = () => {
    setEditing(false);
    setEditForm(location || {});
  };

  const handleSaveEdit = async () => {
    if (!location || !tenantId) return;
    
    try {
      const locationRef = doc(db, 'tenants', tenantId, 'crm_companies', companyId!, 'locations', locationId!);
      await updateDoc(locationRef, {
        ...editForm,
        updatedAt: new Date()
      });
      
      setLocation({ ...location, ...editForm });
      setEditing(false);
    } catch (err: any) {
      console.error('Error updating location:', err);
      setError(err.message || 'Failed to update location');
    }
  };

  const handleDelete = async () => {
    if (!location || !tenantId) return;
    
    if (window.confirm('Are you sure you want to delete this location? This action cannot be undone.')) {
      try {
        const locationRef = doc(db, 'tenants', tenantId, 'crm_companies', companyId!, 'locations', locationId!);
        await deleteDoc(locationRef);
        navigate(`/crm/companies/${companyId}?tab=1`);
      } catch (err: any) {
        console.error('Error deleting location:', err);
        setError(err.message || 'Failed to delete location');
      }
    }
  };

  const handleFieldChange = (field: string, value: any) => {
    setEditForm(prev => ({ ...prev, [field]: value }));
  };

  const navigateBackToCompany = () => {
    // Try to get the source tab from the current URL state
    const currentUrl = new URL(window.location.href);
    const sourceTab = currentUrl.searchParams.get('sourceTab');
    
    if (sourceTab) {
      navigate(`/crm/companies/${companyId}?tab=${sourceTab}`);
      return;
    }
    
    // Fallback: check referrer for tab information
    const referrer = document.referrer;
    if (referrer.includes('/crm/companies/') && referrer.includes('tab=')) {
      try {
        const referrerUrl = new URL(referrer);
        const tab = referrerUrl.searchParams.get('tab');
        if (tab) {
          navigate(`/crm/companies/${companyId}?tab=${tab}`);
          return;
        }
      } catch (err) {
        console.log('Could not parse referrer URL');
      }
    }
    
    // Default to locations tab (tab=1) since this is a location details page
    navigate(`/crm/companies/${companyId}?tab=1`);
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '50vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
        <Button
          variant="outlined"
          startIcon={<ArrowBackIcon />}
          onClick={navigateBackToCompany}
        >
          Back to Company
        </Button>
      </Box>
    );
  }

  if (!location) {
    return (
          <Box sx={{ p: 3 }}>
      <Typography variant="h6" color="error" gutterBottom>
        Location not found
      </Typography>
      <Button
        variant="outlined"
        startIcon={<ArrowBackIcon />}
        onClick={navigateBackToCompany}
      >
        Back to Company
      </Button>
    </Box>
    );
  }

  return (
    <Box sx={{ p: 0 }}>
      {/* Header */}
      <Box sx={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center', 
        mb: 3,
        pb: 2,
        borderBottom: '1px solid',
        borderColor: 'divider'
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Button
            variant="outlined"
            startIcon={<ArrowBackIcon />}
            onClick={navigateBackToCompany}
          >
            Back to Company
          </Button>
          <Divider orientation="vertical" flexItem />
          <Box>
            <Typography variant="h4" fontWeight="bold">
              {location.name}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {company?.name} • {location.type}
            </Typography>
          </Box>
        </Box>
        
        <Box sx={{ display: 'flex', gap: 1 }}>
          {editing ? (
            <>
              <Button
                variant="contained"
                startIcon={<SaveIcon />}
                onClick={handleSaveEdit}
              >
                Save
              </Button>
              <Button
                variant="outlined"
                startIcon={<CancelIcon />}
                onClick={handleCancelEdit}
              >
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outlined"
                startIcon={<EditIcon />}
                onClick={handleEdit}
              >
                Edit
              </Button>
              <Button
                variant="outlined"
                color="error"
                startIcon={<DeleteIcon />}
                onClick={handleDelete}
              >
                Delete
              </Button>
            </>
          )}
        </Box>
      </Box>

      <Grid container spacing={3}>
        {/* Location Information */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardHeader title="Location Information" />
            <CardContent>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <TextField
                  label="Location Name"
                  value={editing ? editForm.name || '' : location.name}
                  onChange={(e) => handleFieldChange('name', e.target.value)}
                  disabled={!editing}
                  fullWidth
                  size="small"
                />
                
                <TextField
                  label="Address"
                  value={editing ? editForm.address || '' : location.address}
                  onChange={(e) => handleFieldChange('address', e.target.value)}
                  disabled={!editing}
                  fullWidth
                  size="small"
                />
                
                <Grid container spacing={2}>
                  <Grid item xs={6}>
                    <TextField
                      label="City"
                      value={editing ? editForm.city || '' : location.city}
                      onChange={(e) => handleFieldChange('city', e.target.value)}
                      disabled={!editing}
                      fullWidth
                      size="small"
                    />
                  </Grid>
                  <Grid item xs={3}>
                    <TextField
                      label="State"
                      value={editing ? editForm.state || '' : location.state}
                      onChange={(e) => handleFieldChange('state', e.target.value)}
                      disabled={!editing}
                      fullWidth
                      size="small"
                    />
                  </Grid>
                  <Grid item xs={3}>
                    <TextField
                      label="ZIP Code"
                      value={editing ? editForm.zipCode || '' : location.zipCode}
                      onChange={(e) => handleFieldChange('zipCode', e.target.value)}
                      disabled={!editing}
                      fullWidth
                      size="small"
                    />
                  </Grid>
                </Grid>
                
                <FormControl fullWidth size="small">
                  <InputLabel>Type</InputLabel>
                  <Select
                    value={editing ? editForm.type || '' : location.type}
                    label="Type"
                    onChange={(e) => handleFieldChange('type', e.target.value)}
                    disabled={!editing}
                  >
                    <MenuItem value="Headquarters">Headquarters</MenuItem>
                    <MenuItem value="Office">Office</MenuItem>
                    <MenuItem value="Warehouse">Warehouse</MenuItem>
                    <MenuItem value="Factory">Factory</MenuItem>
                    <MenuItem value="Store">Store</MenuItem>
                    <MenuItem value="Branch">Branch</MenuItem>
                  </Select>
                </FormControl>
                
                {location.division && (
                  <TextField
                    label="Division"
                    value={editing ? editForm.division || '' : location.division}
                    onChange={(e) => handleFieldChange('division', e.target.value)}
                    disabled={!editing}
                    fullWidth
                    size="small"
                  />
                )}
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Statistics */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardHeader title="Statistics" />
            <CardContent>
              <Grid container spacing={2}>
                <Grid item xs={4}>
                  <Box sx={{ textAlign: 'center' }}>
                    <Typography variant="h4" color="primary" fontWeight="bold">
                      {location.contactCount || 0}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Contacts
                    </Typography>
                  </Box>
                </Grid>
                <Grid item xs={4}>
                  <Box sx={{ textAlign: 'center' }}>
                    <Typography variant="h4" color="primary" fontWeight="bold">
                      {location.dealCount || 0}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Deals
                    </Typography>
                  </Box>
                </Grid>
                <Grid item xs={4}>
                  <Box sx={{ textAlign: 'center' }}>
                    <Typography variant="h4" color="primary" fontWeight="bold">
                      {location.salespersonCount || 0}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Salespeople
                    </Typography>
                  </Box>
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        </Grid>

        {/* Universal Associations */}
        <Grid item xs={12}>
          <SimpleAssociationsCard
            entityType="location"
            entityId={location.id}
            entityName={location.name}
            tenantId={tenantId}
            showAssociations={{
              companies: true,
              contacts: true,
              deals: true,
              salespeople: true,
              locations: false, // Don't show locations for locations
              tasks: false
            }}
            customLabels={{
              companies: "Company",
              contacts: "Staff",
              deals: "Opportunities",
              salespeople: "Account Managers"
            }}
            onAssociationChange={(type, action, entityId) => {
              console.log(`${action} ${type} association: ${entityId}`);
            }}
            onError={(error) => {
              console.error('Association error:', error);
            }}
          />
        </Grid>
      </Grid>
    </Box>
  );
};

export default LocationDetails; 