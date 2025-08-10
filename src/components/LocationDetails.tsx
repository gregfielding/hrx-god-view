import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Grid,
  Chip,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Alert,
  CircularProgress,
  FormControlLabel,
  Switch,
  Snackbar,
  Card,
  CardContent,
} from '@mui/material';
import {
  Delete,
  Add,
  Visibility,
  Save,
  CloudUpload as UploadIcon,
  Delete as DeleteIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { collection, doc, getDocs, query, where, updateDoc, deleteDoc, getDoc, serverTimestamp } from 'firebase/firestore';

import { db } from '../firebase';
import { CRMLocation, CRMContact, CRMDeal } from '../types/CRM';

import CRMNotesTab from './CRMNotesTab';

interface LocationDetailsProps {
  location: CRMLocation;
  companyId: string;
  tenantId: string;
  onBack: () => void;
  onLocationUpdate: (updatedLocation: CRMLocation) => void;
  onLocationDelete: (locationId: string) => void;
}

const LocationDetails: React.FC<LocationDetailsProps> = ({
  location,
  companyId,
  tenantId,
  onBack,
  onLocationUpdate,
  onLocationDelete,
}) => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [associatedContacts, setAssociatedContacts] = useState<CRMContact[]>([]);
  const [associatedDeals, setAssociatedDeals] = useState<CRMDeal[]>([]);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [saving, setSaving] = useState(false);
  const [companyDivisions, setCompanyDivisions] = useState<string[]>([]);
  const [editForm, setEditForm] = useState({
    name: location.name,
    address: location.address,
    city: location.city,
    state: location.state,
    zipCode: location.zipCode,
    country: location.country,
    type: location.type,
    division: location.division || '',
    phone: location.phone || '',
    website: location.website || '',
    headcount: location.headcount || 0,
    isUnionized: location.isUnionized || false,
    hasTempLaborExperience: location.hasTempLaborExperience || false,
    workforceModel: location.workforceModel || 'full_time',
    notes: location.notes || '',
  });

  // Order Defaults state
  const [orderDefaults, setOrderDefaults] = useState<any>({
    backgroundCheckRequired: false,
    backgroundCheckTypes: [],
    drugScreenRequired: false,
    drugScreenTypes: [],
    steelToeRequired: false,
    uniformRequirements: '',
    eVerifyRequired: false,
    badgePPEProvidedBy: '',
    otherSafetyComplianceNotes: '',
    timeClockSystem: '',
    timecardApprovalProcess: '',
    overtimePolicy: '',
    attendanceExpectations: '',
    callOffProcedure: '',
    noCallNoShowPolicy: '',
    injuryReportingContact: '',
    injuryReportingNotes: '',
    performanceMetricsShared: false,
    disciplinaryProcess: '',
    otherTimeAttendanceNotes: '',
    clientBillingTerms: '',
    rateSheet: null,
    rateSheetTitle: '',
    rateSheetDealId: '',
    msaSigned: false,
    msaExpirationDate: null,
    poRequired: false,
    invoiceContact: '',
    invoiceDeliveryMethod: '',
    invoiceFrequency: '',
    contracts: [],
    // Worksite Details
    parkingInfo: '',
    checkInInstructions: '',
    breakroomAvailable: false,
    restroomAccess: '',
    supervisorOnSiteFirstDay: false,
    safetyOrientationProvided: false,
    firstDayInstructions: ''
  });

  const [orderDefaultsLoading, setOrderDefaultsLoading] = useState(true);
  const [orderDefaultsSaving, setOrderDefaultsSaving] = useState(false);
  const [orderDefaultsSuccess, setOrderDefaultsSuccess] = useState<string | null>(null);
  const [orderDefaultsError, setOrderDefaultsError] = useState<string | null>(null);
  const [companyContacts, setCompanyContacts] = useState<any[]>([]);
  const [companyDeals, setCompanyDeals] = useState<any[]>([]);
  const [tenantName, setTenantName] = useState<string>('');
  const [selectedContactToAdd, setSelectedContactToAdd] = useState<string>('');
  const [selectedDealToAdd, setSelectedDealToAdd] = useState<string>('');

  useEffect(() => {
    loadAssociatedData();
    loadCompanyDivisions();
    loadOrderDefaults();
    loadTenantName();
  }, [location.id, tenantId, companyId]);

  const loadTenantName = async () => {
    try {
      const tenantDoc = await getDoc(doc(db, 'tenants', tenantId));
      if (tenantDoc.exists()) {
        setTenantName(tenantDoc.data().name || '');
      }
    } catch (err) {
      console.error('Error loading tenant name:', err);
    }
  };

  const loadOrderDefaults = async () => {
    try {
      setOrderDefaultsLoading(true);
      
      // Load company contacts
      const contactsQuery = query(
        collection(db, 'tenants', tenantId, 'crm_contacts'),
        where('companyId', '==', companyId)
      );
      const contactsSnapshot = await getDocs(contactsQuery);
      const contactsData = contactsSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setCompanyContacts(contactsData);

      // Load company deals
      const dealsQuery = query(
        collection(db, 'tenants', tenantId, 'crm_deals'),
        where('companyId', '==', companyId)
      );
      const dealsSnapshot = await getDocs(dealsQuery);
      const dealsData = dealsSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setCompanyDeals(dealsData);

      // Load existing order defaults from location
      const locationDoc = await getDoc(doc(db, 'tenants', tenantId, 'crm_companies', companyId, 'locations', location.id));
      const locationData = locationDoc.data();
      if (locationData?.orderDefaults) {
        setOrderDefaults(prev => ({ ...prev, ...locationData.orderDefaults }));
      }
    } catch (err) {
      console.error('Error loading order defaults:', err);
      setOrderDefaultsError('Failed to load order defaults');
    } finally {
      setOrderDefaultsLoading(false);
    }
  };

  const handleOrderDefaultsSave = async () => {
    try {
      setOrderDefaultsSaving(true);
      const locationRef = doc(db, 'tenants', tenantId, 'crm_companies', companyId, 'locations', location.id);
      await updateDoc(locationRef, {
        orderDefaults: orderDefaults,
        updatedAt: serverTimestamp()
      });
      setOrderDefaultsSuccess('Order defaults saved successfully');
    } catch (err) {
      console.error('Error saving order defaults:', err);
      setOrderDefaultsError('Failed to save order defaults');
    } finally {
      setOrderDefaultsSaving(false);
    }
  };

  const handleOrderDefaultsFieldChange = (field: string, value: any) => {
    setOrderDefaults(prev => ({ ...prev, [field]: value }));
  };

  const handleBackgroundCheckTypeAdd = () => {
    setOrderDefaults(prev => ({
      ...prev,
      backgroundCheckTypes: [...prev.backgroundCheckTypes, '']
    }));
  };

  const handleBackgroundCheckTypeChange = (index: number, value: string) => {
    setOrderDefaults(prev => ({
      ...prev,
      backgroundCheckTypes: prev.backgroundCheckTypes.map((type: string, i: number) => 
        i === index ? value : type
      )
    }));
  };

  const handleBackgroundCheckTypeRemove = (index: number) => {
    setOrderDefaults(prev => ({
      ...prev,
      backgroundCheckTypes: prev.backgroundCheckTypes.filter((_: string, i: number) => i !== index)
    }));
  };

  const handleDrugScreenTypeAdd = () => {
    setOrderDefaults(prev => ({
      ...prev,
      drugScreenTypes: [...prev.drugScreenTypes, '']
    }));
  };

  const handleDrugScreenTypeChange = (index: number, value: string) => {
    setOrderDefaults(prev => ({
      ...prev,
      drugScreenTypes: prev.drugScreenTypes.map((type: string, i: number) => 
        i === index ? value : type
      )
    }));
  };

  const handleDrugScreenTypeRemove = (index: number) => {
    setOrderDefaults(prev => ({
      ...prev,
      drugScreenTypes: prev.drugScreenTypes.filter((_: string, i: number) => i !== index)
    }));
  };

  const handleContractAdd = () => {
    setOrderDefaults(prev => ({
      ...prev,
      contracts: [...prev.contracts, { name: '', description: '', dealId: '' }]
    }));
  };

  const handleContractChange = (index: number, field: string, value: string) => {
    setOrderDefaults(prev => ({
      ...prev,
      contracts: prev.contracts.map((contract: any, i: number) => 
        i === index ? { ...contract, [field]: value } : contract
      )
    }));
  };

  const handleContractRemove = (index: number) => {
    setOrderDefaults(prev => ({
      ...prev,
      contracts: prev.contracts.filter((_: any, i: number) => i !== index)
    }));
  };

  const loadCompanyDivisions = async () => {
    try {
      const companyDoc = await getDoc(doc(db, 'tenants', tenantId, 'crm_companies', companyId));
      if (companyDoc.exists()) {
        const companyData = companyDoc.data();
        setCompanyDivisions(companyData.divisions || []);
      }
    } catch (err) {
      console.error('Error loading company divisions:', err);
    }
  };

  const loadAssociatedData = async () => {
    try {
      setLoading(true);
      
      // Load associated contacts
      const contactsRef = collection(db, 'tenants', tenantId, 'crm_contacts');
      const contactsQuery = query(contactsRef, where('companyId', '==', companyId), where('locationId', '==', location.id));
      const contactsSnap = await getDocs(contactsQuery);
      const contacts = contactsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as CRMContact));
      setAssociatedContacts(contacts);

      // Load associated deals
      const dealsRef = collection(db, 'tenants', tenantId, 'crm_deals');
      const dealsQuery = query(dealsRef, where('companyId', '==', companyId), where('locationId', '==', location.id));
      const dealsSnap = await getDocs(dealsQuery);
      const deals = dealsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as CRMDeal));
      setAssociatedDeals(deals);

    } catch (err) {
      console.error('Error loading associated data:', err);
      setError('Failed to load associated data');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveLocation = async () => {
    try {
      setSaving(true);
      const locationRef = doc(db, 'tenants', tenantId, 'crm_companies', companyId, 'locations', location.id);
      const updatedLocation = {
        ...editForm,
        updatedAt: new Date().toISOString(),
      };
      
      await updateDoc(locationRef, updatedLocation);
      
      const newLocation = { ...location, ...updatedLocation };
      onLocationUpdate(newLocation);
    } catch (err) {
      console.error('Error updating location:', err);
      setError('Failed to update location');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteLocation = async () => {
    try {
      const locationRef = doc(db, 'tenants', tenantId, 'crm_companies', companyId, 'locations', location.id);
      await deleteDoc(locationRef);
      onLocationDelete(location.id);
      setShowDeleteDialog(false);
    } catch (err) {
      console.error('Error deleting location:', err);
      setError('Failed to delete location');
    }
  };

  const handleViewContact = (contact: CRMContact) => {
    navigate(`/crm/contacts/${contact.id}`);
  };

  const handleViewDeal = (deal: CRMDeal) => {
    navigate(`/crm/deals/${deal.id}`);
  };

  const handleAddContactAssociation = async () => {
    if (!selectedContactToAdd) return;
    
    try {
      const contactRef = doc(db, 'tenants', tenantId, 'crm_contacts', selectedContactToAdd);
      await updateDoc(contactRef, {
        locationId: location.id,
        updatedAt: serverTimestamp()
      });
      
      // Refresh the associated contacts list
      await loadAssociatedData();
      setSelectedContactToAdd('');
    } catch (err) {
      console.error('Error adding contact association:', err);
      setError('Failed to add contact association');
    }
  };

  const handleAddDealAssociation = async () => {
    if (!selectedDealToAdd) return;
    
    try {
      const dealRef = doc(db, 'tenants', tenantId, 'crm_deals', selectedDealToAdd);
      await updateDoc(dealRef, {
        locationId: location.id,
        updatedAt: serverTimestamp()
      });
      
      // Refresh the associated deals list
      await loadAssociatedData();
      setSelectedDealToAdd('');
    } catch (err) {
      console.error('Error adding deal association:', err);
      setError('Failed to add deal association');
    }
  };

  const handleRemoveContactAssociation = async (contactId: string) => {
    try {
      const contactRef = doc(db, 'tenants', tenantId, 'crm_contacts', contactId);
      await updateDoc(contactRef, {
        locationId: null,
        updatedAt: serverTimestamp()
      });
      
      // Refresh the associated contacts list
      await loadAssociatedData();
    } catch (err) {
      console.error('Error removing contact association:', err);
      setError('Failed to remove contact association');
    }
  };

  const handleRemoveDealAssociation = async (dealId: string) => {
    try {
      const dealRef = doc(db, 'tenants', tenantId, 'crm_deals', dealId);
      await updateDoc(dealRef, {
        locationId: null,
        updatedAt: serverTimestamp()
      });
      
      // Refresh the associated deals list
      await loadAssociatedData();
    } catch (err) {
      console.error('Error removing deal association:', err);
      setError('Failed to remove deal association');
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 200 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ p: 0 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h3">
          {editForm.name}
        </Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button
            variant="contained"
            startIcon={saving ? <CircularProgress size={20} /> : <Save />}
            onClick={handleSaveLocation}
            disabled={saving}
          >
            {saving ? 'Saving...' : 'Save'}
          </Button>
          <Button
            variant="outlined"
            onClick={onBack}
          >
            Back to Locations
          </Button>
        </Box>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Grid container spacing={3}>
        {/* Location Details */}
        <Grid item xs={12}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Location Details
              </Typography>
              
              <Grid container spacing={2}>
                {/* Location Name */}
                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    label="Location Name"
                    value={editForm.name}
                    onChange={(e) => setEditForm(prev => ({ ...prev, name: e.target.value }))}
                  />
                </Grid>

                {/* Type */}
                <Grid item xs={12} md={6}>
                  <FormControl fullWidth>
                    <InputLabel>Type</InputLabel>
                    <Select
                      value={editForm.type}
                      onChange={(e) => setEditForm(prev => ({ ...prev, type: e.target.value as any }))}
                      label="Type"
                    >
                      <MenuItem value="Office">Office</MenuItem>
                      <MenuItem value="Manufacturing">Manufacturing</MenuItem>
                      <MenuItem value="Warehouse">Warehouse</MenuItem>
                      <MenuItem value="Retail">Retail</MenuItem>
                      <MenuItem value="Distribution">Distribution</MenuItem>
                      <MenuItem value="Branch">Branch</MenuItem>
                      <MenuItem value="Headquarters">Headquarters</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>

                {/* Division */}
                {companyDivisions.length > 0 && (
                  <Grid item xs={12} md={6}>
                    <FormControl fullWidth>
                      <InputLabel>Division</InputLabel>
                      <Select
                        value={editForm.division}
                        onChange={(e) => setEditForm(prev => ({ ...prev, division: e.target.value }))}
                        label="Division"
                      >
                        <MenuItem value="">No Division</MenuItem>
                        {companyDivisions.map((division) => (
                          <MenuItem key={division} value={division}>
                            {division}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Grid>
                )}

                {/* Phone */}
                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    label="Phone"
                    value={editForm.phone}
                    onChange={(e) => setEditForm(prev => ({ ...prev, phone: e.target.value }))}
                  />
                </Grid>

                {/* Address Fields */}
                <Grid item xs={12}>
                  <TextField
                    fullWidth
                    label="Address"
                    value={editForm.address}
                    onChange={(e) => setEditForm(prev => ({ ...prev, address: e.target.value }))}
                  />
                </Grid>

                <Grid item xs={12} md={4}>
                  <TextField
                    fullWidth
                    label="City"
                    value={editForm.city}
                    onChange={(e) => setEditForm(prev => ({ ...prev, city: e.target.value }))}
                  />
                </Grid>

                <Grid item xs={12} md={4}>
                  <TextField
                    fullWidth
                    label="State"
                    value={editForm.state}
                    onChange={(e) => setEditForm(prev => ({ ...prev, state: e.target.value }))}
                  />
                </Grid>

                <Grid item xs={12} md={4}>
                  <TextField
                    fullWidth
                    label="ZIP Code"
                    value={editForm.zipCode}
                    onChange={(e) => setEditForm(prev => ({ ...prev, zipCode: e.target.value }))}
                  />
                </Grid>

                {/* Headcount */}
                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    label="Headcount"
                    type="number"
                    value={editForm.headcount}
                    onChange={(e) => setEditForm(prev => ({ ...prev, headcount: parseInt(e.target.value) || 0 }))}
                  />
                </Grid>

                {/* Notes */}
                <Grid item xs={12}>
                  <TextField
                    fullWidth
                    label="Notes"
                    multiline
                    rows={3}
                    value={editForm.notes}
                    onChange={(e) => setEditForm(prev => ({ ...prev, notes: e.target.value }))}
                  />
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        </Grid>

        {/* Associated Contacts */}
        <Grid item xs={12}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Associated Contacts ({associatedContacts.length})
              </Typography>
              
              {/* Add Contact Association */}
              <Box sx={{ mb: 3, p: 2, border: '1px solid #e0e0e0', borderRadius: 1, backgroundColor: '#fafafa' }}>
                <Typography variant="body2" color="text.secondary" gutterBottom>
                  Add Contact Association
                </Typography>
                <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                  <FormControl fullWidth size="small">
                    <InputLabel>Select Contact</InputLabel>
                    <Select
                      value={selectedContactToAdd}
                      onChange={(e) => setSelectedContactToAdd(e.target.value)}
                      label="Select Contact"
                    >
                      <MenuItem value="">Choose a contact...</MenuItem>
                      {companyContacts
                        .filter(contact => !associatedContacts.some(ac => ac.id === contact.id))
                        .map((contact) => (
                          <MenuItem key={contact.id} value={contact.id}>
                            {contact.firstName} {contact.lastName} - {contact.title || 'No title'}
                          </MenuItem>
                        ))}
                    </Select>
                  </FormControl>
                  <Button
                    variant="contained"
                    onClick={handleAddContactAssociation}
                    disabled={!selectedContactToAdd}
                    size="small"
                  >
                    Add
                  </Button>
                </Box>
              </Box>
              
              {associatedContacts.length > 0 ? (
                <TableContainer component={Paper} variant="outlined">
                  <Table>
                    <TableHead>
                      <TableRow>
                        <TableCell>Name</TableCell>
                        <TableCell>Title</TableCell>
                        <TableCell>Email</TableCell>
                        <TableCell>Phone</TableCell>
                        <TableCell>Role</TableCell>
                        <TableCell>Actions</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {associatedContacts.map((contact) => (
                        <TableRow key={contact.id}>
                          <TableCell>{contact.fullName}</TableCell>
                          <TableCell>{contact.title}</TableCell>
                          <TableCell>{contact.email}</TableCell>
                          <TableCell>{contact.phone}</TableCell>
                          <TableCell>
                            <Chip label={contact.role} size="small" />
                          </TableCell>
                          <TableCell>
                            <Box sx={{ display: 'flex', gap: 1 }}>
                              <IconButton
                                size="small"
                                onClick={() => handleViewContact(contact)}
                              >
                                <Visibility />
                              </IconButton>
                              <IconButton
                                size="small"
                                onClick={() => handleRemoveContactAssociation(contact.id)}
                                color="error"
                              >
                                <Delete />
                              </IconButton>
                            </Box>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  No contacts associated with this location.
                </Typography>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Associated Deals */}
        <Grid item xs={12}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Associated Deals ({associatedDeals.length})
              </Typography>
              
              {/* Add Deal Association */}
              <Box sx={{ mb: 3, p: 2, border: '1px solid #e0e0e0', borderRadius: 1, backgroundColor: '#fafafa' }}>
                <Typography variant="body2" color="text.secondary" gutterBottom>
                  Add Deal Association
                </Typography>
                <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                  <FormControl fullWidth size="small">
                    <InputLabel>Select Deal</InputLabel>
                    <Select
                      value={selectedDealToAdd}
                      onChange={(e) => setSelectedDealToAdd(e.target.value)}
                      label="Select Deal"
                    >
                      <MenuItem value="">Choose a deal...</MenuItem>
                      {companyDeals
                        .filter(deal => !associatedDeals.some(ad => ad.id === deal.id))
                        .map((deal) => (
                          <MenuItem key={deal.id} value={deal.id}>
                            {deal.name || deal.title || 'Untitled Deal'} - ${deal.estimatedRevenue?.toLocaleString() || '0'}
                          </MenuItem>
                        ))}
                    </Select>
                  </FormControl>
                  <Button
                    variant="contained"
                    onClick={handleAddDealAssociation}
                    disabled={!selectedDealToAdd}
                    size="small"
                  >
                    Add
                  </Button>
                </Box>
              </Box>
              
              {associatedDeals.length > 0 ? (
                <TableContainer component={Paper} variant="outlined">
                  <Table>
                    <TableHead>
                      <TableRow>
                        <TableCell>Deal Name</TableCell>
                        <TableCell>Stage</TableCell>
                        <TableCell>Value</TableCell>
                        <TableCell>Probability</TableCell>
                        <TableCell>Close Date</TableCell>
                        <TableCell>Actions</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {associatedDeals.map((deal) => (
                        <TableRow key={deal.id}>
                          <TableCell>{deal.name}</TableCell>
                          <TableCell>
                            <Chip label={deal.stage} size="small" />
                          </TableCell>
                          <TableCell>${deal.estimatedRevenue?.toLocaleString()}</TableCell>
                          <TableCell>{deal.probability}%</TableCell>
                          <TableCell>{new Date(deal.closeDate).toLocaleDateString()}</TableCell>
                          <TableCell>
                            <Box sx={{ display: 'flex', gap: 1 }}>
                              <IconButton
                                size="small"
                                onClick={() => handleViewDeal(deal)}
                              >
                                <Visibility />
                              </IconButton>
                              <IconButton
                                size="small"
                                onClick={() => handleRemoveDealAssociation(deal.id)}
                                color="error"
                              >
                                <Delete />
                              </IconButton>
                            </Box>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  No deals associated with this location.
                </Typography>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Order Defaults Section */}
      <Grid item xs={12}>
        <Box sx={{ mt: 3 }}>
          <Typography variant="h6" gutterBottom>
            Order Defaults
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Location-specific order defaults that override company defaults. Leave fields empty to inherit from company defaults.
          </Typography>
          
          {orderDefaultsLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress />
            </Box>
          ) : (
            <Grid container spacing={3}>
              {/* Safety & Compliance Section */}
              <Grid item xs={12} md={6}>
                <Card>
                  <CardContent>
                    <Typography variant="h6" gutterBottom>
                      Safety & Compliance
                    </Typography>
                    <Grid container spacing={2}>
                      {/* Background Check */}
                      <Grid item xs={12}>
                        <FormControl component="fieldset">
                          <FormControlLabel
                            control={
                              <Switch
                                checked={orderDefaults.backgroundCheckRequired}
                                onChange={(e) => handleOrderDefaultsFieldChange('backgroundCheckRequired', e.target.checked)}
                              />
                            }
                            label="Background Check Required?"
                          />
                        </FormControl>
                        {orderDefaults.backgroundCheckRequired && (
                          <Box sx={{ mt: 2, ml: 3 }}>
                            <Typography variant="body2" color="text.secondary" gutterBottom>
                              What check(s):
                            </Typography>
                            {orderDefaults.backgroundCheckTypes.map((type: string, index: number) => (
                              <Box key={index} sx={{ display: 'flex', gap: 1, mb: 1 }}>
                                <TextField
                                  size="small"
                                  value={type}
                                  onChange={(e) => handleBackgroundCheckTypeChange(index, e.target.value)}
                                  placeholder="e.g., Criminal background, etc."
                                  fullWidth
                                />
                                <IconButton
                                  size="small"
                                  onClick={() => handleBackgroundCheckTypeRemove(index)}
                                  color="error"
                                >
                                  <DeleteIcon />
                                </IconButton>
                              </Box>
                            ))}
                            <Button
                              size="small"
                              startIcon={<Add />}
                              onClick={handleBackgroundCheckTypeAdd}
                              sx={{ mt: 1 }}
                            >
                              Add Check Type
                            </Button>
                          </Box>
                        )}
                      </Grid>

                      {/* Drug Screen */}
                      <Grid item xs={12}>
                        <FormControl component="fieldset">
                          <FormControlLabel
                            control={
                              <Switch
                                checked={orderDefaults.drugScreenRequired}
                                onChange={(e) => handleOrderDefaultsFieldChange('drugScreenRequired', e.target.checked)}
                              />
                            }
                            label="Drug Screen Required?"
                          />
                        </FormControl>
                        {orderDefaults.drugScreenRequired && (
                          <Box sx={{ mt: 2, ml: 3 }}>
                            <Typography variant="body2" color="text.secondary" gutterBottom>
                              Drug Screen Type(s):
                            </Typography>
                            {orderDefaults.drugScreenTypes.map((type: string, index: number) => (
                              <Box key={index} sx={{ display: 'flex', gap: 1, mb: 1 }}>
                                <TextField
                                  size="small"
                                  value={type}
                                  onChange={(e) => handleDrugScreenTypeChange(index, e.target.value)}
                                  placeholder="e.g., 5-panel, 10-panel, etc."
                                  fullWidth
                                />
                                <IconButton
                                  size="small"
                                  onClick={() => handleDrugScreenTypeRemove(index)}
                                  color="error"
                                >
                                  <DeleteIcon />
                                </IconButton>
                              </Box>
                            ))}
                            <Button
                              size="small"
                              startIcon={<Add />}
                              onClick={handleDrugScreenTypeAdd}
                              sx={{ mt: 1 }}
                            >
                              Add Drug Screen Type
                            </Button>
                          </Box>
                        )}
                      </Grid>

                      {/* Steel Toe */}
                      <Grid item xs={12}>
                        <FormControl component="fieldset">
                          <FormControlLabel
                            control={
                              <Switch
                                checked={orderDefaults.steelToeRequired}
                                onChange={(e) => handleOrderDefaultsFieldChange('steelToeRequired', e.target.checked)}
                              />
                            }
                            label="Steel Toe Required?"
                          />
                        </FormControl>
                      </Grid>

                      {/* Uniform Requirements */}
                      <Grid item xs={12}>
                        <TextField
                          fullWidth
                          label="Uniform Requirements"
                          value={orderDefaults.uniformRequirements}
                          onChange={(e) => handleOrderDefaultsFieldChange('uniformRequirements', e.target.value)}
                          multiline
                          rows={2}
                        />
                      </Grid>

                      {/* E-Verify */}
                      <Grid item xs={12}>
                        <FormControl component="fieldset">
                          <FormControlLabel
                            control={
                              <Switch
                                checked={orderDefaults.eVerifyRequired}
                                onChange={(e) => handleOrderDefaultsFieldChange('eVerifyRequired', e.target.checked)}
                              />
                            }
                            label="E-Verify Required?"
                          />
                        </FormControl>
                      </Grid>

                      {/* Badge/PPE Provided By */}
                      <Grid item xs={12}>
                        <FormControl fullWidth>
                          <InputLabel>Badge/PPE Provided By</InputLabel>
                          <Select
                            value={orderDefaults.badgePPEProvidedBy}
                            onChange={(e) => handleOrderDefaultsFieldChange('badgePPEProvidedBy', e.target.value)}
                            label="Badge/PPE Provided By"
                          >
                            <MenuItem value="">Select provider</MenuItem>
                            <MenuItem value="Company">Company</MenuItem>
                            <MenuItem value={tenantName}>{tenantName}</MenuItem>
                          </Select>
                        </FormControl>
                      </Grid>

                      {/* Other Safety & Compliance Notes */}
                      <Grid item xs={12}>
                        <TextField
                          fullWidth
                          label="Other Safety & Compliance Notes"
                          value={orderDefaults.otherSafetyComplianceNotes}
                          onChange={(e) => handleOrderDefaultsFieldChange('otherSafetyComplianceNotes', e.target.value)}
                          multiline
                          rows={3}
                          placeholder="Additional safety requirements, compliance notes, or special instructions..."
                        />
                      </Grid>
                    </Grid>
                  </CardContent>
                </Card>
              </Grid>

              {/* Time & Attendance Section */}
              <Grid item xs={12} md={6}>
                <Card>
                  <CardContent>
                    <Typography variant="h6" gutterBottom>
                      Time & Attendance
                    </Typography>
                    <Grid container spacing={2}>
                      {/* Time Clock System */}
                      <Grid item xs={12}>
                        <TextField
                          fullWidth
                          label="Time Clock System Used"
                          value={orderDefaults.timeClockSystem}
                          onChange={(e) => handleOrderDefaultsFieldChange('timeClockSystem', e.target.value)}
                        />
                      </Grid>

                      {/* Timecard Approval Process */}
                      <Grid item xs={12}>
                        <TextField
                          fullWidth
                          label="Timecard Approval Process"
                          value={orderDefaults.timecardApprovalProcess}
                          onChange={(e) => handleOrderDefaultsFieldChange('timecardApprovalProcess', e.target.value)}
                          multiline
                          rows={2}
                        />
                      </Grid>

                      {/* Overtime Policy */}
                      <Grid item xs={12}>
                        <TextField
                          fullWidth
                          label="Overtime Policy"
                          value={orderDefaults.overtimePolicy}
                          onChange={(e) => handleOrderDefaultsFieldChange('overtimePolicy', e.target.value)}
                          multiline
                          rows={2}
                        />
                      </Grid>

                      {/* Attendance Expectations */}
                      <Grid item xs={12}>
                        <TextField
                          fullWidth
                          label="Attendance Expectations"
                          value={orderDefaults.attendanceExpectations}
                          onChange={(e) => handleOrderDefaultsFieldChange('attendanceExpectations', e.target.value)}
                          multiline
                          rows={2}
                        />
                      </Grid>

                      {/* Call-Off Procedure */}
                      <Grid item xs={12}>
                        <FormControl fullWidth>
                          <InputLabel>Call-Off Procedure</InputLabel>
                          <Select
                            value={orderDefaults.callOffProcedure}
                            onChange={(e) => handleOrderDefaultsFieldChange('callOffProcedure', e.target.value)}
                            label="Call-Off Procedure"
                          >
                            <MenuItem value="Phone, text, direct supervisor">Phone, text, direct supervisor</MenuItem>
                            <MenuItem value="custom">Custom (specify below)</MenuItem>
                          </Select>
                        </FormControl>
                        {orderDefaults.callOffProcedure === 'custom' && (
                          <TextField
                            fullWidth
                            label="Custom Call-Off Procedure"
                            value={orderDefaults.customCallOffProcedure || ''}
                            onChange={(e) => handleOrderDefaultsFieldChange('customCallOffProcedure', e.target.value)}
                            multiline
                            rows={2}
                            sx={{ mt: 1 }}
                          />
                        )}
                      </Grid>

                      {/* No Call/No Show Policy */}
                      <Grid item xs={12}>
                        <TextField
                          fullWidth
                          label="No Call/No Show Policy"
                          value={orderDefaults.noCallNoShowPolicy}
                          onChange={(e) => handleOrderDefaultsFieldChange('noCallNoShowPolicy', e.target.value)}
                          multiline
                          rows={2}
                        />
                      </Grid>

                      {/* Injury Reporting Contact */}
                      <Grid item xs={12}>
                        <FormControl fullWidth>
                          <InputLabel>Injury Reporting Contact</InputLabel>
                          <Select
                            value={orderDefaults.injuryReportingContact}
                            onChange={(e) => handleOrderDefaultsFieldChange('injuryReportingContact', e.target.value)}
                            label="Injury Reporting Contact"
                          >
                            <MenuItem value="">Select a contact</MenuItem>
                            {companyContacts.map((contact) => (
                              <MenuItem key={contact.id} value={contact.id}>
                                {contact.firstName} {contact.lastName} - {contact.title || 'No title'}
                              </MenuItem>
                            ))}
                          </Select>
                        </FormControl>
                      </Grid>

                      {/* Injury Reporting Notes */}
                      <Grid item xs={12}>
                        <TextField
                          fullWidth
                          label="Injury Reporting Notes"
                          value={orderDefaults.injuryReportingNotes}
                          onChange={(e) => handleOrderDefaultsFieldChange('injuryReportingNotes', e.target.value)}
                          multiline
                          rows={2}
                          placeholder="Additional notes about injury reporting procedures..."
                        />
                      </Grid>

                      {/* Performance Metrics Shared */}
                      <Grid item xs={12}>
                        <FormControl component="fieldset">
                          <FormControlLabel
                            control={
                              <Switch
                                checked={orderDefaults.performanceMetricsShared}
                                onChange={(e) => handleOrderDefaultsFieldChange('performanceMetricsShared', e.target.checked)}
                              />
                            }
                            label="Performance Metrics Shared?"
                          />
                        </FormControl>
                      </Grid>

                      {/* Disciplinary Process */}
                      <Grid item xs={12}>
                        <TextField
                          fullWidth
                          label="Disciplinary Process"
                          value={orderDefaults.disciplinaryProcess}
                          onChange={(e) => handleOrderDefaultsFieldChange('disciplinaryProcess', e.target.value)}
                          multiline
                          rows={2}
                          placeholder="Describe the disciplinary process and procedures..."
                        />
                      </Grid>

                      {/* Other Time & Attendance Notes */}
                      <Grid item xs={12}>
                        <TextField
                          fullWidth
                          label="Other Time & Attendance Notes"
                          value={orderDefaults.otherTimeAttendanceNotes}
                          onChange={(e) => handleOrderDefaultsFieldChange('otherTimeAttendanceNotes', e.target.value)}
                          multiline
                          rows={3}
                          placeholder="Additional time and attendance policies, procedures, or special instructions..."
                        />
                      </Grid>
                    </Grid>
                  </CardContent>
                </Card>
              </Grid>

              {/* Billing & Invoicing Section */}
              <Grid item xs={12} md={6}>
                <Card>
                  <CardContent>
                    <Typography variant="h6" gutterBottom>
                      Billing & Invoicing
                    </Typography>
                    <Grid container spacing={2}>
                      {/* Client Billing Terms */}
                      <Grid item xs={12}>
                        <FormControl fullWidth>
                          <InputLabel>Client Billing Terms</InputLabel>
                          <Select
                            value={orderDefaults.clientBillingTerms}
                            onChange={(e) => handleOrderDefaultsFieldChange('clientBillingTerms', e.target.value)}
                            label="Client Billing Terms"
                          >
                            <MenuItem value="Net 7">Net 7</MenuItem>
                            <MenuItem value="Net 15">Net 15</MenuItem>
                            <MenuItem value="Net 30">Net 30</MenuItem>
                            <MenuItem value="Net 45">Net 45</MenuItem>
                            <MenuItem value="Net 60">Net 60</MenuItem>
                          </Select>
                        </FormControl>
                      </Grid>

                      {/* PO Required */}
                      <Grid item xs={12}>
                        <FormControl component="fieldset">
                          <FormControlLabel
                            control={
                              <Switch
                                checked={orderDefaults.poRequired}
                                onChange={(e) => handleOrderDefaultsFieldChange('poRequired', e.target.checked)}
                              />
                            }
                            label="PO Required?"
                          />
                        </FormControl>
                      </Grid>

                      {/* Invoice Contact */}
                      <Grid item xs={12}>
                        <FormControl fullWidth>
                          <InputLabel>Invoice Contact</InputLabel>
                          <Select
                            value={orderDefaults.invoiceContact}
                            onChange={(e) => handleOrderDefaultsFieldChange('invoiceContact', e.target.value)}
                            label="Invoice Contact"
                          >
                            <MenuItem value="">Select a contact</MenuItem>
                            {companyContacts.map((contact) => (
                              <MenuItem key={contact.id} value={contact.id}>
                                {contact.firstName} {contact.lastName} - {contact.title || 'No title'}
                              </MenuItem>
                            ))}
                          </Select>
                        </FormControl>
                      </Grid>

                      {/* Invoice Delivery Method */}
                      <Grid item xs={12}>
                        <TextField
                          fullWidth
                          label="Invoice Delivery Method"
                          value={orderDefaults.invoiceDeliveryMethod}
                          onChange={(e) => handleOrderDefaultsFieldChange('invoiceDeliveryMethod', e.target.value)}
                          placeholder="e.g., Email, Mail, Portal"
                        />
                      </Grid>

                      {/* Invoice Frequency */}
                      <Grid item xs={12}>
                        <FormControl fullWidth>
                          <InputLabel>Invoice Frequency</InputLabel>
                          <Select
                            value={orderDefaults.invoiceFrequency}
                            onChange={(e) => handleOrderDefaultsFieldChange('invoiceFrequency', e.target.value)}
                            label="Invoice Frequency"
                          >
                            <MenuItem value="Weekly">Weekly</MenuItem>
                            <MenuItem value="Biweekly">Biweekly</MenuItem>
                            <MenuItem value="Monthly">Monthly</MenuItem>
                          </Select>
                        </FormControl>
                      </Grid>
                    </Grid>
                  </CardContent>
                </Card>
              </Grid>

              {/* Contracts and Rate Sheets Section */}
              <Grid item xs={12} md={6}>
                <Card>
                  <CardContent>
                    <Typography variant="h6" gutterBottom>
                      Contracts and Rate Sheets
                    </Typography>
                    <Grid container spacing={2}>
                      {/* Rate Sheet Title */}
                      <Grid item xs={12}>
                        <TextField
                          fullWidth
                          label="Rate Sheet Title"
                          value={orderDefaults.rateSheetTitle}
                          onChange={(e) => handleOrderDefaultsFieldChange('rateSheetTitle', e.target.value)}
                          placeholder="e.g., 2024 Rate Sheet"
                        />
                      </Grid>

                      {/* Rate Sheet Deal */}
                      <Grid item xs={12}>
                        <FormControl fullWidth>
                          <InputLabel>Rate Sheet Deal</InputLabel>
                          <Select
                            value={orderDefaults.rateSheetDealId}
                            onChange={(e) => handleOrderDefaultsFieldChange('rateSheetDealId', e.target.value)}
                            label="Rate Sheet Deal"
                          >
                            <MenuItem value="">Select a deal</MenuItem>
                            {companyDeals.map((deal) => (
                              <MenuItem key={deal.id} value={deal.id}>
                                {deal.name || deal.title || 'Untitled Deal'}
                              </MenuItem>
                            ))}
                          </Select>
                        </FormControl>
                      </Grid>

                      {/* Upload Rate Sheet */}
                      <Grid item xs={12}>
                        <Button
                          variant="outlined"
                          component="label"
                          startIcon={<UploadIcon />}
                          fullWidth
                          sx={{ height: 56 }}
                        >
                          Upload Rate Sheet
                          <input
                            type="file"
                            hidden
                            accept=".pdf,.doc,.docx,.xls,.xlsx"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) {
                                handleOrderDefaultsFieldChange('rateSheet', file.name);
                              }
                            }}
                          />
                        </Button>
                      </Grid>

                      {/* MSA Section */}
                      <Grid item xs={12}>
                        <FormControl component="fieldset">
                          <FormControlLabel
                            control={
                              <Switch
                                checked={orderDefaults.msaSigned}
                                onChange={(e) => handleOrderDefaultsFieldChange('msaSigned', e.target.checked)}
                              />
                            }
                            label="MSA Signed?"
                          />
                        </FormControl>
                      </Grid>

                      <Grid item xs={12}>
                        <TextField
                          fullWidth
                          label="MSA Expiration Date"
                          type="date"
                          value={orderDefaults.msaExpirationDate || ''}
                          onChange={(e) => handleOrderDefaultsFieldChange('msaExpirationDate', e.target.value)}
                          InputLabelProps={{ shrink: true }}
                          disabled={!orderDefaults.msaSigned}
                        />
                      </Grid>

                      {/* Contracts Upload */}
                      <Grid item xs={12}>
                        <Typography variant="h6" gutterBottom>
                          Contracts
                        </Typography>
                        {orderDefaults.contracts.map((contract: any, index: number) => (
                          <Card key={index} sx={{ mb: 2 }}>
                            <CardContent>
                              <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
                                <IconButton
                                  onClick={() => handleContractRemove(index)}
                                  color="error"
                                  size="small"
                                >
                                  <DeleteIcon />
                                </IconButton>
                              </Box>
                              
                              <Grid container spacing={2}>
                                <Grid item xs={12}>
                                  <TextField
                                    fullWidth
                                    label="Contract Name"
                                    value={contract.name}
                                    onChange={(e) => handleContractChange(index, 'name', e.target.value)}
                                    placeholder="e.g., Service Agreement"
                                  />
                                </Grid>
                                <Grid item xs={12}>
                                  <TextField
                                    fullWidth
                                    label="Description"
                                    value={contract.description}
                                    onChange={(e) => handleContractChange(index, 'description', e.target.value)}
                                    placeholder="Brief description"
                                    multiline
                                    rows={2}
                                  />
                                </Grid>
                                <Grid item xs={12}>
                                  <FormControl fullWidth>
                                    <InputLabel>Associated Deal</InputLabel>
                                    <Select
                                      value={contract.dealId}
                                      onChange={(e) => handleContractChange(index, 'dealId', e.target.value)}
                                      label="Associated Deal"
                                    >
                                      <MenuItem value="">Select a deal</MenuItem>
                                      {companyDeals.map((deal) => (
                                        <MenuItem key={deal.id} value={deal.id}>
                                          {deal.name || deal.title || 'Untitled Deal'}
                                        </MenuItem>
                                      ))}
                                    </Select>
                                  </FormControl>
                                </Grid>
                                <Grid item xs={12}>
                                  <Button
                                    variant="outlined"
                                    component="label"
                                    startIcon={<UploadIcon />}
                                    size="small"
                                  >
                                    Upload Contract
                                    <input
                                      type="file"
                                      hidden
                                      accept=".pdf,.doc,.docx"
                                      onChange={(e) => {
                                        const file = e.target.files?.[0];
                                        if (file) {
                                          handleContractChange(index, 'file', file.name);
                                        }
                                      }}
                                    />
                                  </Button>
                                </Grid>
                              </Grid>
                            </CardContent>
                          </Card>
                        ))}
                        <Button
                          startIcon={<Add />}
                          onClick={handleContractAdd}
                          variant="outlined"
                        >
                          Add Contract
                        </Button>
                      </Grid>
                    </Grid>
                  </CardContent>
                </Card>
              </Grid>

              {/* Worksite Details Section */}
              <Grid item xs={12} md={6}>
                <Card>
                  <CardContent>
                    <Typography variant="h6" gutterBottom>
                      Worksite Details
                    </Typography>
                    <Grid container spacing={2}>
                      {/* Parking Info */}
                      <Grid item xs={12}>
                        <TextField
                          fullWidth
                          label="Parking Info"
                          value={orderDefaults.parkingInfo}
                          onChange={(e) => handleOrderDefaultsFieldChange('parkingInfo', e.target.value)}
                          multiline
                          rows={2}
                          placeholder="Parking location, instructions, permits required..."
                        />
                      </Grid>

                      {/* Check-In Instructions */}
                      <Grid item xs={12}>
                        <TextField
                          fullWidth
                          label="Check-In Instructions"
                          value={orderDefaults.checkInInstructions}
                          onChange={(e) => handleOrderDefaultsFieldChange('checkInInstructions', e.target.value)}
                          multiline
                          rows={2}
                          placeholder="Where to check in, who to report to, security procedures..."
                        />
                      </Grid>

                      {/* Breakroom Available */}
                      <Grid item xs={12}>
                        <FormControl component="fieldset">
                          <FormControlLabel
                            control={
                              <Switch
                                checked={orderDefaults.breakroomAvailable}
                                onChange={(e) => handleOrderDefaultsFieldChange('breakroomAvailable', e.target.checked)}
                              />
                            }
                            label="Breakroom Available?"
                          />
                        </FormControl>
                      </Grid>

                      {/* Restroom Access */}
                      <Grid item xs={12}>
                        <TextField
                          fullWidth
                          label="Restroom Access"
                          value={orderDefaults.restroomAccess}
                          onChange={(e) => handleOrderDefaultsFieldChange('restroomAccess', e.target.value)}
                          multiline
                          rows={2}
                          placeholder="Restroom locations, access codes, gender-specific facilities..."
                        />
                      </Grid>

                      {/* Supervisor On-Site 1st Day */}
                      <Grid item xs={12}>
                        <FormControl component="fieldset">
                          <FormControlLabel
                            control={
                              <Switch
                                checked={orderDefaults.supervisorOnSiteFirstDay}
                                onChange={(e) => handleOrderDefaultsFieldChange('supervisorOnSiteFirstDay', e.target.checked)}
                              />
                            }
                            label="Supervisor On-Site 1st Day?"
                          />
                        </FormControl>
                      </Grid>

                      {/* Safety Orientation Provided */}
                      <Grid item xs={12}>
                        <FormControl component="fieldset">
                          <FormControlLabel
                            control={
                              <Switch
                                checked={orderDefaults.safetyOrientationProvided}
                                onChange={(e) => handleOrderDefaultsFieldChange('safetyOrientationProvided', e.target.checked)}
                              />
                            }
                            label="Safety Orientation Provided?"
                          />
                        </FormControl>
                      </Grid>

                      {/* First-Day Instructions */}
                      <Grid item xs={12}>
                        <TextField
                          fullWidth
                          label="First-Day Instructions"
                          value={orderDefaults.firstDayInstructions}
                          onChange={(e) => handleOrderDefaultsFieldChange('firstDayInstructions', e.target.value)}
                          multiline
                          rows={3}
                          placeholder="What to bring, dress code, arrival time, orientation schedule, emergency procedures..."
                        />
                      </Grid>
                    </Grid>
                  </CardContent>
                </Card>
              </Grid>

              {/* Save Button */}
              <Grid item xs={12}>
                <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 2 }}>
                  <Button
                    variant="contained"
                    onClick={handleOrderDefaultsSave}
                    disabled={orderDefaultsSaving}
                    startIcon={orderDefaultsSaving ? <CircularProgress size={20} /> : null}
                  >
                    {orderDefaultsSaving ? 'Saving...' : 'Save Order Defaults'}
                  </Button>
                </Box>
              </Grid>
            </Grid>
          )}
        </Box>
      </Grid>

      {/* Success/Error Snackbars for Order Defaults */}
      <Snackbar open={!!orderDefaultsSuccess} autoHideDuration={4000} onClose={() => setOrderDefaultsSuccess(null)}>
        <Alert severity="success" onClose={() => setOrderDefaultsSuccess(null)} sx={{ width: '100%' }}>
          {orderDefaultsSuccess}
        </Alert>
      </Snackbar>
      <Snackbar open={!!orderDefaultsError} autoHideDuration={4000} onClose={() => setOrderDefaultsError(null)}>
        <Alert severity="error" onClose={() => setOrderDefaultsError(null)} sx={{ width: '100%' }}>
          {orderDefaultsError}
        </Alert>
      </Snackbar>

      {/* Location Notes Section */}
      <Grid item xs={12}>
        <Card sx={{ mt: 3 }}>
          <CardContent>
            <CRMNotesTab
              entityId={location.id}
              entityType="location"
              entityName={location.name}
              tenantId={tenantId}
              companyId={companyId}
            />
          </CardContent>
        </Card>
      </Grid>

      {/* Delete Location Section */}
      <Box sx={{ mt: 4, pt: 3, borderTop: '1px solid #e0e0e0' }}>
        <Typography variant="h6" color="error" gutterBottom>
          Danger Zone
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Deleting this location will permanently remove it and all associated data.
        </Typography>
        
        {/* Show warning if there are associated items */}
        {(associatedContacts.length > 0 || associatedDeals.length > 0 || (location.salespersonCount && location.salespersonCount > 0)) && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            <Typography variant="body2" fontWeight="bold">
              Cannot delete location with associated items
            </Typography>
            <Typography variant="body2">
              This location has:
              {associatedContacts.length > 0 && ` ${associatedContacts.length} contact(s)`}
              {associatedDeals.length > 0 && ` ${associatedDeals.length} deal(s)`}
              {location.salespersonCount && location.salespersonCount > 0 && ` ${location.salespersonCount} salesperson(s)`}
              . Please disassociate these items before deleting the location.
            </Typography>
          </Alert>
        )}
        
        <Button
          variant="contained"
          color="error"
          startIcon={<Delete />}
          onClick={() => setShowDeleteDialog(true)}
          disabled={associatedContacts.length > 0 || associatedDeals.length > 0 || (location.salespersonCount && location.salespersonCount > 0)}
          sx={{ 
            backgroundColor: 'error.main',
            '&:hover': {
              backgroundColor: 'error.dark',
            },
            '&:disabled': {
              backgroundColor: 'grey.400',
              color: 'grey.600'
            }
          }}
        >
          Delete Location
        </Button>
      </Box>



      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onClose={() => setShowDeleteDialog(false)}>
        <DialogTitle>Delete Location</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to delete "{location.name}"? This action cannot be undone.
          </Typography>
          {associatedContacts.length > 0 || associatedDeals.length > 0 ? (
            <Alert severity="warning" sx={{ mt: 2 }}>
              This location has {associatedContacts.length} contacts and {associatedDeals.length} deals associated with it. 
              Deleting the location will remove these associations.
            </Alert>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowDeleteDialog(false)}>Cancel</Button>
          <Button onClick={handleDeleteLocation} color="error" variant="contained">
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default LocationDetails; 