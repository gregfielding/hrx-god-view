import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Button,
  Grid,
  Card,
  CardContent,
  CardHeader,
  Divider,
  CircularProgress,
  Alert,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Avatar,
  IconButton,
  Chip,
  Breadcrumbs,
  Link as MUILink,
  Paper,
  Tabs,
  Tab,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';
import {
  ArrowBack as ArrowBackIcon,
  Edit as EditIcon,
  Save as SaveIcon,
  Cancel as CancelIcon,
  Delete as DeleteIcon,
  Add as AddIcon,
  Business as BusinessIcon,
  LocationOn as LocationIcon,
  Language as LanguageIcon,
  LinkedIn as LinkedInIcon,
  Work as WorkIcon,
  Facebook as FacebookIcon,
  Dashboard as DashboardIcon,
  Notes as NotesIcon,
  Timeline as TimelineIcon,
  Phone as PhoneIcon,
} from '@mui/icons-material';
import { doc, getDoc, updateDoc, deleteDoc, collection, getDocs, query, where } from 'firebase/firestore';


import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import AddNoteDialog from '../../components/AddNoteDialog';
import CRMNotesTab from '../../components/CRMNotesTab';
import ActivityLogTab from '../../components/ActivityLogTab';

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
  phone?: string;
  coordinates?: any;
  contactCount?: number;
  dealCount?: number;
  salespersonCount?: number;
  createdAt?: any;
  updatedAt?: any;
}

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;

  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`location-tabpanel-${index}`}
      aria-labelledby={`location-tab-${index}`}
      {...other}
    >
      {value === index && <Box sx={{ p: 0 }}>{children}</Box>}
    </div>
  );
}

const SectionCard: React.FC<{ title: string; action?: React.ReactNode; children: React.ReactNode }> = ({ title, action, children }) => (
  <Card sx={{ mb: 3 }}>
    <CardHeader title={title} action={action} titleTypographyProps={{ variant: 'h6' }} sx={{ pb: 0 }} />
    <CardContent sx={{ pt: 2 }}>{children}</CardContent>
  </Card>
);

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
  const [showAddNoteDialog, setShowAddNoteDialog] = useState(false);
  const [locationContacts, setLocationContacts] = useState<any[]>([]);
  const [locationDeals, setLocationDeals] = useState<any[]>([]);
  const [tabValue, setTabValue] = useState(0);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!companyId || !locationId || !tenantId) {
      return;
    }
    
    const loadLocationData = async () => {
      try {
        setLoading(true);
        
        // Load company data
        const companyDoc = await getDoc(doc(db, 'tenants', tenantId, 'crm_companies', companyId));
        if (!companyDoc.exists()) {
          setError('Company not found');
          return;
        }
        setCompany({ id: companyDoc.id, ...companyDoc.data() });
        
        // Load location data
        const locationDoc = await getDoc(doc(db, 'tenants', tenantId, 'crm_companies', companyId, 'locations', locationId));
        if (!locationDoc.exists()) {
          setError('Location not found');
          return;
        }
        
        const locationData = { id: locationDoc.id, ...locationDoc.data() } as LocationData;
        setLocation(locationData);
        setEditForm(locationData);

        // Load location-scoped contacts
        try {
          const contactsRef = collection(db, 'tenants', tenantId, 'crm_contacts');
          let contactsList: any[] = [];
          try {
            const q1 = query(contactsRef, where('associations.locations', 'array-contains', locationId));
            const snap1 = await getDocs(q1 as any);
            contactsList = snap1.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
          } catch {}
          if (contactsList.length === 0) {
            try {
              const q2 = query(contactsRef, where('locationId', '==', locationId));
              const snap2 = await getDocs(q2 as any);
              contactsList = snap2.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
            } catch {}
          }
          setLocationContacts(contactsList);
        } catch (contactsErr) {
          console.warn('Failed to load location contacts:', contactsErr);
          setLocationContacts([]);
        }

        // Load location-scoped deals/opportunities
        try {
          const dealsRef = collection(db, 'tenants', tenantId, 'crm_deals');
          let dealsList: any[] = [];
          try {
            const q1 = query(dealsRef, where('associations.locations', 'array-contains', locationId));
            const snap1 = await getDocs(q1 as any);
            dealsList = snap1.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
          } catch {}
          if (dealsList.length === 0) {
            try {
              const q2 = query(dealsRef, where('locationId', '==', locationId));
              const snap2 = await getDocs(q2 as any);
              dealsList = snap2.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
            } catch {}
          }
          setLocationDeals(dealsList);
        } catch (dealsErr) {
          console.warn('Failed to load location deals:', dealsErr);
          setLocationDeals([]);
        }
        
      } catch (err: any) {
        console.error('Error loading location data:', err);
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
    
    setDeleting(true);
    try {
      const locationRef = doc(db, 'tenants', tenantId, 'crm_companies', companyId!, 'locations', locationId!);
      await deleteDoc(locationRef);
      navigate(`/crm/companies/${companyId}?tab=1`);
    } catch (err: any) {
      console.error('Error deleting location:', err);
      setError(err.message || 'Failed to delete location');
    } finally {
      setDeleting(false);
      setDeleteDialogOpen(false);
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
        // Could not parse referrer URL
      }
    }
    
    // Default to locations tab (tab=1) since this is a location details page
    navigate(`/crm/companies/${companyId}?tab=1`);
  };

  const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
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
      {/* Breadcrumbs */}
      <Box sx={{ mb: 2 }}>
        <Breadcrumbs aria-label="breadcrumb">
          <MUILink underline="hover" color="inherit" href="/companies" onClick={(e) => { e.preventDefault(); navigate('/crm?tab=companies'); }}>
            Companies
          </MUILink>
          <MUILink underline="hover" color="inherit" href={`/crm/companies/${companyId}`} onClick={(e) => { e.preventDefault(); navigate(`/crm/companies/${companyId}`); }}>
            {company?.companyName || company?.name || 'Company'}
          </MUILink>
          <Typography color="text.primary">{location.name}</Typography>
        </Breadcrumbs>
      </Box>

      {/* Enhanced Header - Persistent Location Information */}
      <Box sx={{ mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 3 }}>
            {/* Company Logo/Avatar */}
            <Box sx={{ position: 'relative' }}>
              <Avatar
                src={company?.logo}
                alt={company?.companyName || company?.name}
                sx={{ 
                  width: 128, 
                  height: 128,
                  bgcolor: 'primary.main',
                  fontSize: '2rem',
                  fontWeight: 'bold'
                }}
              >
                {(company?.companyName || company?.name || 'C').charAt(0).toUpperCase()}
              </Avatar>
            </Box>

            {/* Location Information */}
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                <Typography variant="h4" sx={{ fontWeight: 'bold', color: 'text.primary' }}>
                  {location.name}
                </Typography>
              </Box>
              
              {/* Company Name */}
              <Typography variant="body1" color="text.secondary" sx={{ fontWeight: 500, display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <BusinessIcon sx={{ fontSize: 16, color: 'primary.main' }} />
                <MUILink
                  underline="hover"
                  color="primary"
                  href={`/crm/companies/${companyId}`}
                  onClick={(e) => {
                    e.preventDefault();
                    navigate(`/crm/companies/${companyId}`);
                  }}
                  sx={{ cursor: 'pointer', fontWeight: 'normal' }}
                >
                  {company?.companyName || company?.name}
                </MUILink>
              </Typography>

              {/* Location Type */}
              <Chip
                label={location.type}
                size="small"
                sx={{
                  bgcolor: 'primary.50',
                  color: 'text.primary',
                  fontWeight: 500,
                  fontSize: '0.75rem',
                  height: 20,
                  maxWidth: 'fit-content',
                  '& .MuiChip-label': {
                    px: 0.5,
                    py: 0.25
                  }
                }}
              />

              {/* Location Address */}
              {(location.address || location.city || location.state) && (
                <Typography variant="body2" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <LocationIcon sx={{ fontSize: 16 }} />
                  {[
                    location.address,
                    location.city,
                    location.state,
                    location.zipCode
                  ].filter(Boolean).join(', ')}
                </Typography>
              )}

              {/* Company Social Media Icons */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0 }}>
                <IconButton
                  size="small"
                  sx={{ 
                    p: 0.5,
                    color: company?.website ? 'primary.main' : 'text.disabled',
                    bgcolor: company?.website ? 'primary.50' : 'transparent',
                    borderRadius: 1,
                    '&:hover': {
                      color: company?.website ? 'primary.dark' : 'text.disabled',
                      bgcolor: company?.website ? 'primary.100' : 'transparent'
                    }
                  }}
                  onClick={() => {
                    if (company?.website) {
                      let url = company.website;
                      if (!url.startsWith('http://') && !url.startsWith('https://')) {
                        url = 'https://' + url;
                      }
                      window.open(url, '_blank');
                    }
                  }}
                  title={company?.website ? 'Visit Website' : 'Add Website URL'}
                >
                  <LanguageIcon sx={{ fontSize: 20 }} />
                </IconButton>
                
                <IconButton
                  size="small"
                  sx={{ 
                    p: 0.5,
                    color: company?.linkedin ? 'primary.main' : 'text.disabled',
                    bgcolor: company?.linkedin ? 'primary.50' : 'transparent',
                    borderRadius: 1,
                    '&:hover': {
                      color: company?.linkedin ? 'primary.dark' : 'text.disabled',
                      bgcolor: company?.linkedin ? 'primary.100' : 'transparent'
                    }
                  }}
                  onClick={() => {
                    if (company?.linkedin) {
                      let url = company.linkedin;
                      if (!url.startsWith('http://') && !url.startsWith('https://')) {
                        url = 'https://' + url;
                      }
                      window.open(url, '_blank');
                    }
                  }}
                  title={company?.linkedin ? 'Open LinkedIn' : 'Add LinkedIn URL'}
                >
                  <LinkedInIcon sx={{ fontSize: 20 }} />
                </IconButton>
                
                <IconButton
                  size="small"
                  sx={{ 
                    p: 0.5,
                    color: company?.indeed ? 'primary.main' : 'text.disabled',
                    bgcolor: company?.indeed ? 'primary.50' : 'transparent',
                    borderRadius: 1,
                    '&:hover': {
                      color: company?.indeed ? 'primary.dark' : 'text.disabled',
                      bgcolor: company?.indeed ? 'primary.100' : 'transparent'
                    }
                  }}
                  onClick={() => {
                    if (company?.indeed) {
                      let url = company.indeed;
                      if (!url.startsWith('http://') && !url.startsWith('https://')) {
                        url = 'https://' + url;
                      }
                      window.open(url, '_blank');
                    }
                  }}
                  title={company?.indeed ? 'View Jobs on Indeed' : 'Add Indeed URL'}
                >
                  <WorkIcon sx={{ fontSize: 20 }} />
                </IconButton>
                
                <IconButton
                  size="small"
                  sx={{ 
                    p: 0.5,
                    color: company?.facebook ? 'primary.main' : 'text.disabled',
                    bgcolor: company?.facebook ? 'primary.50' : 'transparent',
                    borderRadius: 1,
                    '&:hover': {
                      color: company?.facebook ? 'primary.dark' : 'text.disabled',
                      bgcolor: company?.facebook ? 'primary.100' : 'transparent'
                    }
                  }}
                  onClick={() => {
                    if (company?.facebook) {
                      let url = company.facebook;
                      if (!url.startsWith('http://') && !url.startsWith('https://')) {
                        url = 'https://' + url;
                      }
                      window.open(url, '_blank');
                    }
                  }}
                  title={company?.facebook ? 'View Facebook Page' : 'Add Facebook URL'}
                >
                  <FacebookIcon sx={{ fontSize: 20 }} />
                </IconButton>
              </Box>

              {/* Location Stats */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 0 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500 }}>Contacts:</Typography>
                  <Typography variant="body2" color="primary" sx={{ fontWeight: 500 }}>
                    {locationContacts.length}
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500 }}>Opportunities:</Typography>
                  <Typography variant="body2" color="primary" sx={{ fontWeight: 500 }}>
                    {locationDeals.length}
                  </Typography>
                </Box>
              </Box>
            </Box>
          </Box>

          {/* Action Buttons */}
          <Box sx={{ display: 'flex', alignItems: 'flex-end' }}>
            <Button 
              variant="outlined" 
              startIcon={<AddIcon />}
              onClick={() => setShowAddNoteDialog(true)}
              size="small"
            >
              Add Note
            </Button>
          </Box>
        </Box>
      </Box>

      {/* Tabs Navigation */}
      <Paper elevation={1} sx={{ mb: 3, borderRadius: 1 }}>
        <Tabs
          value={tabValue}
          onChange={handleTabChange}
          indicatorColor="primary"
          textColor="primary"
          variant="scrollable"
          scrollButtons="auto"
          aria-label="Location details tabs"
        >
          <Tab 
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <DashboardIcon fontSize="small" />
                Dashboard
              </Box>
            } 
          />
          <Tab 
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <NotesIcon fontSize="small" />
                Notes
              </Box>
            } 
          />
          <Tab 
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <TimelineIcon fontSize="small" />
                Activity
              </Box>
            } 
          />
        </Tabs>
      </Paper>

      {/* Tab Panels */}
            <TabPanel value={tabValue} index={0}>
        <Grid container spacing={3}>
          {/* Left Column - Location Details */}
          <Grid item xs={12} md={4}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {/* Location Details */}
              <SectionCard 
                title="Location Details" 
                action={
                  <Box sx={{ display: 'flex', gap: 1 }}>
                    {editing ? (
                      <>
                        <Button
                          size="small"
                          variant="contained"
                          startIcon={<SaveIcon />}
                          onClick={handleSaveEdit}
                        >
                          Save
                        </Button>
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={<CancelIcon />}
                          onClick={handleCancelEdit}
                        >
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={<EditIcon />}
                        onClick={handleEdit}
                      >
                        Edit
                      </Button>
                    )}
                  </Box>
                }
              >
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <TextField
                    label="Location Name"
                    defaultValue={location.name}
                    onBlur={(e) => handleFieldChange('name', e.target.value)}
                    size="small"
                    fullWidth
                  />
                  
                  <TextField
                    label="Address"
                    defaultValue={location.address}
                    onBlur={(e) => handleFieldChange('address', e.target.value)}
                    size="small"
                    fullWidth
                  />
                  
                  <Grid container spacing={2}>
                    <Grid item xs={6}>
                      <TextField
                        label="City"
                        defaultValue={location.city}
                        onBlur={(e) => handleFieldChange('city', e.target.value)}
                        size="small"
                        fullWidth
                      />
                    </Grid>
                    <Grid item xs={3}>
                      <TextField
                        label="State"
                        defaultValue={location.state}
                        onBlur={(e) => handleFieldChange('state', e.target.value)}
                        size="small"
                        fullWidth
                      />
                    </Grid>
                    <Grid item xs={3}>
                      <TextField
                        label="ZIP Code"
                        defaultValue={location.zipCode}
                        onBlur={(e) => handleFieldChange('zipCode', e.target.value)}
                        size="small"
                        fullWidth
                      />
                    </Grid>
                  </Grid>
                  
                  <TextField
                    label="Phone Number"
                    defaultValue={location.phone || ''}
                    onBlur={(e) => handleFieldChange('phone', e.target.value)}
                    size="small"
                    fullWidth
                    InputProps={{ startAdornment: <PhoneIcon sx={{ fontSize: 16, mr: 1, color: 'text.secondary' }} /> }}
                  />
                  
                  <FormControl fullWidth size="small">
                    <InputLabel>Type</InputLabel>
                    <Select
                      value={location.type}
                      label="Type"
                      onChange={(e) => handleFieldChange('type', e.target.value)}
                    >
                      <MenuItem value="Headquarters">Headquarters</MenuItem>
                      <MenuItem value="Office">Office</MenuItem>
                      <MenuItem value="Warehouse">Warehouse</MenuItem>
                      <MenuItem value="Factory">Factory</MenuItem>
                      <MenuItem value="Store">Store</MenuItem>
                      <MenuItem value="Branch">Branch</MenuItem>
                    </Select>
                  </FormControl>
                  
                  <TextField
                    label="Division"
                    defaultValue={location.division || ''}
                    onBlur={(e) => handleFieldChange('division', e.target.value)}
                    size="small"
                    fullWidth
                  />
                </Box>
              </SectionCard>
            </Box>
          </Grid>

          {/* Center Column - Location Intelligence */}
          <Grid item xs={12} md={5}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>

              {/* Location Map */}
              <Card>
                <CardHeader title="Location Map" />
                <CardContent>
                  <Box sx={{ 
                    height: 200, 
                    bgcolor: 'grey.100', 
                    borderRadius: 1, 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'center' 
                  }}>
                    <Typography variant="body2" color="text.secondary">
                      Map view coming soon
                    </Typography>
                  </Box>
                </CardContent>
              </Card>

              {/* Location Insights */}
              <Card>
                <CardHeader title="Location Insights" />
                <CardContent>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <Box sx={{ 
                      display: 'flex', 
                      justifyContent: 'space-between', 
                      alignItems: 'center' 
                    }}>
                      <Typography variant="body2" color="text.secondary">Contact Density</Typography>
                      <Chip 
                        label={locationContacts.length > 5 ? 'High' : locationContacts.length > 2 ? 'Medium' : 'Low'} 
                        color={locationContacts.length > 5 ? 'success' : locationContacts.length > 2 ? 'warning' : 'error'} 
                        size="small" 
                      />
                    </Box>
                    <Box sx={{ 
                      display: 'flex', 
                      justifyContent: 'space-between', 
                      alignItems: 'center' 
                    }}>
                      <Typography variant="body2" color="text.secondary">Opportunity Value</Typography>
                      <Chip 
                        label={locationDeals.length > 3 ? 'High' : locationDeals.length > 1 ? 'Medium' : 'Low'} 
                        color={locationDeals.length > 3 ? 'success' : locationDeals.length > 1 ? 'warning' : 'error'} 
                        size="small" 
                      />
                    </Box>
                  </Box>
                </CardContent>
              </Card>
            </Box>
          </Grid>

          {/* Right Column - Recent Activity + Contacts + Opportunities */}
          <Grid item xs={12} md={3}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {/* Contacts at this Location */}
              <Card>
                <CardHeader 
                  title="Contacts at this Location" 
                  titleTypographyProps={{ variant: 'h6', fontWeight: 'bold' }}
                />
                <CardContent sx={{ p: 2 }}>
                  {locationContacts && locationContacts.length > 0 ? (
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      {locationContacts.slice(0, 5).map((c: any) => (
                        <Box
                          key={c.id}
                          sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1, borderRadius: 1, bgcolor: 'grey.50', cursor: 'pointer' }}
                          onClick={() => navigate(`/crm/contacts/${c.id}`)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/crm/contacts/${c.id}`); } }}
                        >
                          <Avatar sx={{ width: 32, height: 32, fontSize: '0.875rem' }}>
                            {c.firstName?.charAt(0) || c.name?.charAt(0) || 'C'}
                          </Avatar>
                          <Box sx={{ flex: 1 }}>
                            <Typography variant="body2" fontWeight="medium">
                              {c.fullName || `${c.firstName || ''} ${c.lastName || ''}`.trim() || 'Unknown Contact'}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {c.jobTitle || c.title || ''}
                            </Typography>
                          </Box>
                        </Box>
                      ))}
                    </Box>
                  ) : (
                    <Typography variant="body2" color="text.secondary">No contacts associated to this location</Typography>
                  )}
                </CardContent>
              </Card>

              {/* Opportunities (location-scoped) */}
              <Card>
                <CardHeader 
                  title="Opportunities" 
                  titleTypographyProps={{ variant: 'h6', fontWeight: 'bold' }}
                />
                <CardContent sx={{ p: 2 }}>
                  {locationDeals && locationDeals.length > 0 ? (
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      {locationDeals
                        .slice()
                        .sort((a: any, b: any) => (b.expectedRevenue || 0) - (a.expectedRevenue || 0))
                        .slice(0, 5)
                        .map((deal: any) => (
                          <Box
                            key={deal.id}
                            sx={{ 
                              display: 'flex', 
                              alignItems: 'center', 
                              gap: 1, 
                              p: 1, 
                              borderRadius: 1, 
                              bgcolor: 'grey.50', 
                              cursor: 'pointer' 
                            }}
                            onClick={() => navigate(`/crm/deals/${deal.id}`)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => { 
                              if (e.key === 'Enter' || e.key === ' ') { 
                                e.preventDefault(); 
                                navigate(`/crm/deals/${deal.id}`); 
                              } 
                            }}
                          >
                            <Avatar sx={{ width: 32, height: 32, fontSize: '0.875rem', bgcolor: 'primary.main' }}>
                              <BusinessIcon sx={{ fontSize: 16 }} />
                            </Avatar>
                            <Box sx={{ flex: 1 }}>
                              <Typography variant="body2" fontWeight="medium">
                                {deal.name || deal.title || 'Unknown Deal'}
                              </Typography>
                              <Typography variant="caption" color="text.secondary">
                                {(deal.expectedRevenue ? `$${Number(deal.expectedRevenue).toLocaleString()}` : '')}{deal.stage ? ` • ${deal.stage}` : ''}
                              </Typography>
                            </Box>
                          </Box>
                        ))}
                    </Box>
                  ) : (
                    <Typography variant="body2" color="text.secondary">No location-specific opportunities</Typography>
                  )}
                </CardContent>
              </Card>
            </Box>
          </Grid>
        </Grid>
      </TabPanel>

      <TabPanel value={tabValue} index={1}>
        <CRMNotesTab
          entityId={location.id}
          entityType="location"
          entityName={`${company?.name || ''} - ${location.name}`.trim()}
          tenantId={tenantId}
        />
      </TabPanel>

      <TabPanel value={tabValue} index={2}>
        <ActivityLogTab
          entityId={location.id}
          entityType="location"
          entityName={`${company?.name || ''} - ${location.name}`.trim()}
          tenantId={tenantId}
        />
      </TabPanel>

      {/* Add Note Dialog */}
      <AddNoteDialog
        open={showAddNoteDialog}
        onClose={() => setShowAddNoteDialog(false)}
        entityId={location.id}
        entityType="location"
        entityName={`${company?.name || ''} - ${location.name}`.trim()}
        tenantId={tenantId}
        contacts={locationContacts.map((c: any) => ({
          id: c.id,
          fullName: c.fullName || `${c.firstName || ''} ${c.lastName || ''}`.trim() || 'Unknown Contact',
          email: c.email || '',
          title: c.jobTitle || c.title || ''
        }))}
      />

      {/* Delete Contact Button - Bottom of page */}
      <Box sx={{ 
        display: 'flex', 
        justifyContent: 'center', 
        mt: 9,
        pb: 3 
      }}>
        <Button 
          variant="outlined" 
          color="error"
          sx={{ 
            borderColor: 'error.main',
            '&:hover': {
              borderColor: 'error.dark',
              backgroundColor: 'error.light'
            }
          }}
          startIcon={<DeleteIcon />}
          onClick={() => setDeleteDialogOpen(true)}
        >
          Delete Location
        </Button>
      </Box>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        aria-labelledby="delete-dialog-title"
        aria-describedby="delete-dialog-description"
      >
        <DialogTitle id="delete-dialog-title">Confirm Deletion</DialogTitle>
        <DialogContent>
          <Typography id="delete-dialog-description">
            Are you sure you want to delete this location? This action cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)} color="primary">
            Cancel
          </Button>
          <Button onClick={handleDelete} color="error" variant="contained" disabled={deleting}>
            {deleting ? <CircularProgress size={24} /> : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default LocationDetails; 