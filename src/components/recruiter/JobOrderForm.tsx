import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Button,
  Grid,
  Card,
  CardContent,
  CardHeader,
  Chip,
  Autocomplete,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Switch,
  FormControlLabel,
  Divider,
  IconButton,
  Alert,
  CircularProgress
} from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  Add as AddIcon,
  Delete as DeleteIcon,
  Save as SaveIcon,
  LocationOn as LocationIcon,
  Business as BusinessIcon,
  Person as PersonIcon,
  Work as WorkIcon,
  Visibility as VisibilityIcon,
  Security as SecurityIcon,
  Notes as NotesIcon
} from '@mui/icons-material';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../firebase';
import { JobOrderFormData, JobOrderContact, TimesheetMethod, JobsBoardVisibility } from '../../types/recruiter/jobOrder';
import { JobOrderService } from '../../services/recruiter/jobOrderService';

interface JobOrderFormProps {
  tenantId: string;
  createdBy: string;
  jobOrder?: any; // For editing existing job orders
  dealId?: string;
  initialData?: Partial<JobOrderFormData>;
  onSave: () => void;
  onCancel: () => void;
  loading?: boolean;
  companies?: any[];
  locations?: any[];
  recruiters?: any[];
  jobTitles?: string[];
  groups?: any[];
}

const JobOrderForm: React.FC<JobOrderFormProps> = ({
  tenantId,
  createdBy,
  jobOrder,
  dealId,
  initialData,
  onSave,
  onCancel,
  loading = false,
  companies = [],
  locations = [],
  recruiters = [],
  jobTitles = [],
  groups = []
}) => {
  const jobOrderService = JobOrderService.getInstance();
  
  // Local state for loaded data
  const [loadedCompanies, setLoadedCompanies] = useState<any[]>([]);
  const [loadedLocations, setLoadedLocations] = useState<any[]>([]);
  const [loadedContacts, setLoadedContacts] = useState<any[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  
  const [formData, setFormData] = useState<JobOrderFormData>({
    jobOrderName: '',
    jobOrderDescription: '',
    status: 'draft',
    startDate: undefined,
    endDate: undefined,
    poNumber: '',
    companyId: '',
    companyName: '',
    companyContacts: [],
    worksiteId: '',
    worksiteName: '',
    worksiteAddress: {
      street: '',
      city: '',
      state: '',
      zipCode: '',
      country: 'USA'
    },
    jobTitle: '',
    jobDescription: '',
    uniformRequirements: '',
    assignedRecruiters: [],
    payRate: 0,
    billRate: 0,
    workersNeeded: 1,
    workersCompCode: '',
    workersCompRate: 0,
    checkInInstructions: '',
    timesheetCollectionMethod: 'app_clock_in_out',
    jobsBoardVisibility: 'hidden',
    showPayRate: false,
    showStartDate: true,
    showShiftTimes: true,
    restrictedGroups: [],
    requiredLicenses: [],
    requiredCertifications: [],
    drugScreenRequired: false,
    backgroundCheckRequired: false,
    experienceRequired: '',
    educationRequired: '',
    languagesRequired: [],
    skillsRequired: [],
    physicalRequirements: '',
    ppeRequirements: '',
    ppeProvidedBy: 'company',
    additionalTrainingRequired: '',
    competingAgencies: {
      count: 0,
      satisfaction: 'medium',
      mistakesToAvoid: ''
    },
    customerSpecificRules: {
      attendance: '',
      noShows: '',
      overtime: '',
      callOffs: '',
      injuryHandling: ''
    },
    internalNotes: '',
    onboardingRequirements: []
  });

  const [expandedSections, setExpandedSections] = useState<string[]>(['basic', 'company', 'job']);
  const [newContact, setNewContact] = useState<JobOrderContact>({
    id: '',
    name: '',
    email: '',
    phone: '',
    role: 'hiring_manager',
    notes: ''
  });

  // Load data on component mount
  useEffect(() => {
    if (tenantId) {
      loadData();
    }
  }, [tenantId]);

  const loadData = async () => {
    if (!tenantId) return;
    
    setDataLoading(true);
    try {
      // Load companies from crm_companies
      const companiesRef = collection(db, 'tenants', tenantId, 'crm_companies');
      const companiesSnapshot = await getDocs(companiesRef);
      const companiesData = companiesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setLoadedCompanies(companiesData);

      // Load all locations from crm_locations (we'll filter by company when needed)
      const locationsRef = collection(db, 'tenants', tenantId, 'crm_locations');
      const locationsSnapshot = await getDocs(locationsRef);
      const locationsData = locationsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setLoadedLocations(locationsData);

      console.log('✅ Loaded data for JobOrderForm:', {
        companies: companiesData.length,
        locations: locationsData.length
      });
    } catch (error) {
      console.error('Error loading JobOrderForm data:', error);
    } finally {
      setDataLoading(false);
    }
  };

  // Load contacts when company is selected
  const loadCompanyContacts = async (companyId: string) => {
    if (!companyId || !tenantId) return;
    
    try {
      const contactsRef = collection(db, 'tenants', tenantId, 'crm_contacts');
      const contactsQuery = query(contactsRef, where('companyId', '==', companyId));
      const contactsSnapshot = await getDocs(contactsQuery);
      const contactsData = contactsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setLoadedContacts(contactsData);
      
      console.log('✅ Loaded contacts for company:', { companyId, contacts: contactsData.length });
    } catch (error) {
      console.error('Error loading company contacts:', error);
      setLoadedContacts([]);
    }
  };

  useEffect(() => {
    if (initialData) {
      setFormData(prev => ({ ...prev, ...initialData }));
    }
  }, [initialData]);

  useEffect(() => {
    if (jobOrder) {
      // Populate form with existing job order data
      setFormData({
        jobOrderName: jobOrder.jobOrderName || '',
        jobOrderDescription: jobOrder.jobOrderDescription || '',
        status: jobOrder.status || 'draft',
        startDate: jobOrder.startDate ? new Date(jobOrder.startDate) : undefined,
        endDate: jobOrder.endDate ? new Date(jobOrder.endDate) : undefined,
        poNumber: jobOrder.poNumber || '',
        companyId: jobOrder.companyId || '',
        companyName: jobOrder.companyName || '',
        companyContacts: jobOrder.companyContacts || [],
        worksiteId: jobOrder.worksiteId || '',
        worksiteName: jobOrder.worksiteName || '',
        worksiteAddress: jobOrder.worksiteAddress || {
          street: '',
          city: '',
          state: '',
          zipCode: '',
          country: 'USA'
        },
        jobTitle: jobOrder.jobTitle || '',
        jobDescription: jobOrder.jobDescription || '',
        uniformRequirements: jobOrder.uniformRequirements || '',
        assignedRecruiters: jobOrder.assignedRecruiters || [],
        payRate: jobOrder.payRate || 0,
        billRate: jobOrder.billRate || 0,
        workersNeeded: jobOrder.workersNeeded || 1,
        workersCompCode: jobOrder.workersCompCode || '',
        workersCompRate: jobOrder.workersCompRate || 0,
        checkInInstructions: jobOrder.checkInInstructions || '',
        timesheetCollectionMethod: jobOrder.timesheetCollectionMethod || 'app_clock_in_out',
        jobsBoardVisibility: jobOrder.jobsBoardVisibility || 'hidden',
        showPayRate: jobOrder.showPayRate || false,
        showStartDate: jobOrder.showStartDate !== undefined ? jobOrder.showStartDate : true,
        showShiftTimes: jobOrder.showShiftTimes !== undefined ? jobOrder.showShiftTimes : true,
        restrictedGroups: jobOrder.restrictedGroups || [],
        requiredLicenses: jobOrder.requiredLicenses || [],
        requiredCertifications: jobOrder.requiredCertifications || [],
        drugScreenRequired: jobOrder.drugScreenRequired || false,
        backgroundCheckRequired: jobOrder.backgroundCheckRequired || false,
        experienceRequired: jobOrder.experienceRequired || '',
        educationRequired: jobOrder.educationRequired || '',
        languagesRequired: jobOrder.languagesRequired || [],
        skillsRequired: jobOrder.skillsRequired || [],
        physicalRequirements: jobOrder.physicalRequirements || '',
        ppeRequirements: jobOrder.ppeRequirements || '',
        ppeProvidedBy: jobOrder.ppeProvidedBy || 'company',
        additionalTrainingRequired: jobOrder.additionalTrainingRequired || '',
        competingAgencies: jobOrder.competingAgencies || {
          count: 0,
          satisfaction: 'medium',
          mistakesToAvoid: ''
        },
        customerSpecificRules: jobOrder.customerSpecificRules || {
          attendance: '',
          noShows: '',
          overtime: '',
          callOffs: '',
          injuryHandling: ''
        },
        internalNotes: jobOrder.internalNotes || '',
        onboardingRequirements: jobOrder.onboardingRequirements || []
      });
    }
  }, [jobOrder]);

  const handleInputChange = (field: keyof JobOrderFormData, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleNestedInputChange = (field: keyof JobOrderFormData, nestedField: string, value: any) => {
    setFormData(prev => ({
      ...prev,
      [field]: {
        ...(prev[field] as any),
        [nestedField]: value
      }
    }));
  };

  const handleCompanyChange = (companyId: string) => {
    const company = loadedCompanies.find(c => c.id === companyId);
    if (company) {
      setFormData(prev => ({
        ...prev,
        companyId: company.id,
        companyName: company.companyName || company.name
      }));
      
      // Load contacts for this company
      loadCompanyContacts(companyId);
      
      // Clear worksite selection when company changes
      setFormData(prev => ({
        ...prev,
        worksiteId: '',
        worksiteName: '',
        worksiteAddress: {
          street: '',
          city: '',
          state: '',
          zipCode: '',
          country: 'USA'
        }
      }));
    }
  };

  // Filter locations by selected company
  const getFilteredLocations = () => {
    if (!formData.companyId) return [];
    
    // Filter locations that are associated with the selected company
    return loadedLocations.filter(location => {
      // Check if location has companyId field
      if (location.companyId === formData.companyId) return true;
      
      // Check if location is in company's associations
      if (location.associations?.companies?.includes(formData.companyId)) return true;
      
      // Check if company has this location in its associations
      const company = loadedCompanies.find(c => c.id === formData.companyId);
      if (company?.associations?.locations?.includes(location.id)) return true;
      
      return false;
    });
  };

  const handleLocationChange = (locationId: string) => {
    const location = loadedLocations.find(l => l.id === locationId);
    if (location) {
      setFormData(prev => ({
        ...prev,
        worksiteId: location.id,
        worksiteName: location.nickname || location.name || location.title,
        worksiteAddress: {
          street: location.address || '',
          city: location.city || '',
          state: location.state || '',
          zipCode: location.zipCode || '',
          country: location.country || 'USA'
        }
      }));
    }
  };

  const addContact = () => {
    if (newContact.name.trim()) {
      setFormData(prev => ({
        ...prev,
        companyContacts: [...prev.companyContacts, { ...newContact, id: Date.now().toString() }]
      }));
      setNewContact({
        id: '',
        name: '',
        email: '',
        phone: '',
        role: 'hiring_manager',
        notes: ''
      });
    }
  };

  const removeContact = (contactId: string) => {
    setFormData(prev => ({
      ...prev,
      companyContacts: prev.companyContacts.filter(c => c.id !== contactId)
    }));
  };

  const toggleSection = (section: string) => {
    setExpandedSections(prev =>
      prev.includes(section)
        ? prev.filter(s => s !== section)
        : [...prev, section]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (jobOrder) {
        // Update existing job order
        await jobOrderService.updateJobOrder(tenantId, jobOrder.id, formData);
      } else {
        // Create new job order
        await jobOrderService.createJobOrder(tenantId, formData, createdBy, dealId);
      }
      onSave();
    } catch (error) {
      console.error('Error saving job order:', error);
      // You might want to show an error message to the user here
    }
  };

  if (dataLoading) {
    return (
      <Box sx={{ maxWidth: 1200, mx: 'auto', p: 3, textAlign: 'center' }}>
        <CircularProgress />
        <Typography variant="h6" sx={{ mt: 2 }}>
          Loading companies and locations...
        </Typography>
      </Box>
    );
  }

  return (
    <Box component="form" onSubmit={handleSubmit} sx={{ maxWidth: 1200, mx: 'auto', p: 3 }}>
      <Typography variant="h4" gutterBottom>
        {jobOrder ? 'Edit Job Order' : 'Create New Job Order'}
      </Typography>

      {/* Basic Information */}
      <Accordion expanded={expandedSections.includes('basic')} onChange={() => toggleSection('basic')}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="h6">Basic Information</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Grid container spacing={3}>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Job Order Name"
                value={formData.jobOrderName}
                onChange={(e) => handleInputChange('jobOrderName', e.target.value)}
                required
              />
            </Grid>
            <Grid item xs={12} md={3}>
              <FormControl fullWidth>
                <InputLabel>Status</InputLabel>
                <Select
                  value={formData.status}
                  label="Status"
                  onChange={(e) => handleInputChange('status', e.target.value)}
                >
                  <MenuItem value="draft">Draft</MenuItem>
                  <MenuItem value="open">Open</MenuItem>
                  <MenuItem value="on_hold">On Hold</MenuItem>
                  <MenuItem value="cancelled">Cancelled</MenuItem>
                  <MenuItem value="filled">Filled</MenuItem>
                  <MenuItem value="completed">Completed</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} md={3}>
              <TextField
                fullWidth
                label="PO Number"
                value={formData.poNumber}
                onChange={(e) => handleInputChange('poNumber', e.target.value)}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Start Date"
                type="date"
                value={formData.startDate ? formData.startDate.toISOString().split('T')[0] : ''}
                onChange={(e) => handleInputChange('startDate', e.target.value ? new Date(e.target.value) : undefined)}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="End Date"
                type="date"
                value={formData.endDate ? formData.endDate.toISOString().split('T')[0] : ''}
                onChange={(e) => handleInputChange('endDate', e.target.value ? new Date(e.target.value) : undefined)}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Job Order Description"
                multiline
                rows={3}
                value={formData.jobOrderDescription}
                onChange={(e) => handleInputChange('jobOrderDescription', e.target.value)}
              />
            </Grid>
          </Grid>
        </AccordionDetails>
      </Accordion>

      {/* Company & Worksite */}
      <Accordion expanded={expandedSections.includes('company')} onChange={() => toggleSection('company')}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="h6">Company & Worksite</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Grid container spacing={3}>
            <Grid item xs={12} md={6}>
              <Autocomplete
                options={loadedCompanies}
                getOptionLabel={(option) => option.companyName || option.name || ''}
                value={loadedCompanies.find(c => c.id === formData.companyId) || null}
                onChange={(_, newValue) => handleCompanyChange(newValue?.id || '')}
                loading={dataLoading}
                renderInput={(params) => (
                  <TextField {...params} label="Company" required />
                )}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <Autocomplete
                options={getFilteredLocations()}
                getOptionLabel={(option) => option.nickname || option.name || option.title || ''}
                value={getFilteredLocations().find(l => l.id === formData.worksiteId) || null}
                onChange={(_, newValue) => handleLocationChange(newValue?.id || '')}
                loading={dataLoading}
                disabled={!formData.companyId}
                renderInput={(params) => (
                  <TextField {...params} label="Worksite" required />
                )}
              />
            </Grid>
            
            {/* Company Contacts */}
            <Grid item xs={12}>
              <Typography variant="h6" gutterBottom>Company Contacts</Typography>
              
              {/* Existing Company Contacts */}
              {loadedContacts.length > 0 && (
                <Box sx={{ mb: 2 }}>
                  <Typography variant="subtitle2" gutterBottom>
                    Available Contacts from {formData.companyName || 'Selected Company'}:
                  </Typography>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                    {loadedContacts.map((contact) => (
                      <Chip
                        key={contact.id}
                        label={`${contact.fullName || contact.name} (${contact.title || 'No Title'})`}
                        onClick={() => {
                          const jobOrderContact: JobOrderContact = {
                            id: contact.id,
                            name: contact.fullName || contact.name,
                            email: contact.email,
                            phone: contact.phone,
                            role: 'hiring_manager', // Default role
                            notes: contact.title || ''
                          };
                          setFormData(prev => ({
                            ...prev,
                            companyContacts: [...prev.companyContacts, jobOrderContact]
                          }));
                        }}
                        variant="outlined"
                        size="small"
                      />
                    ))}
                  </Box>
                </Box>
              )}
              
              {formData.companyContacts.map((contact) => (
                <Card key={contact.id} sx={{ mb: 2 }}>
                  <CardContent>
                    <Grid container spacing={2} alignItems="center">
                      <Grid item xs={12} md={3}>
                        <TextField
                          fullWidth
                          label="Name"
                          value={contact.name}
                          size="small"
                          disabled
                        />
                      </Grid>
                      <Grid item xs={12} md={2}>
                        <FormControl fullWidth size="small">
                          <InputLabel>Role</InputLabel>
                          <Select value={contact.role} label="Role" disabled>
                            <MenuItem value="hiring_manager">Hiring Manager</MenuItem>
                            <MenuItem value="supervisor">Supervisor</MenuItem>
                            <MenuItem value="hr_contact">HR Contact</MenuItem>
                            <MenuItem value="safety_contact">Safety Contact</MenuItem>
                            <MenuItem value="other">Other</MenuItem>
                          </Select>
                        </FormControl>
                      </Grid>
                      <Grid item xs={12} md={2}>
                        <TextField
                          fullWidth
                          label="Email"
                          value={contact.email}
                          size="small"
                          disabled
                        />
                      </Grid>
                      <Grid item xs={12} md={2}>
                        <TextField
                          fullWidth
                          label="Phone"
                          value={contact.phone}
                          size="small"
                          disabled
                        />
                      </Grid>
                      <Grid item xs={12} md={2}>
                        <IconButton onClick={() => removeContact(contact.id)} color="error">
                          <DeleteIcon />
                        </IconButton>
                      </Grid>
                    </Grid>
                  </CardContent>
                </Card>
              ))}
              
              {/* Add New Contact */}
              <Card sx={{ border: '2px dashed', borderColor: 'grey.300' }}>
                <CardContent>
                  <Grid container spacing={2} alignItems="center">
                    <Grid item xs={12} md={3}>
                      <TextField
                        fullWidth
                        label="Name"
                        value={newContact.name}
                        onChange={(e) => setNewContact(prev => ({ ...prev, name: e.target.value }))}
                        size="small"
                      />
                    </Grid>
                    <Grid item xs={12} md={2}>
                      <FormControl fullWidth size="small">
                        <InputLabel>Role</InputLabel>
                        <Select
                          value={newContact.role}
                          label="Role"
                          onChange={(e) => setNewContact(prev => ({ ...prev, role: e.target.value as any }))}
                        >
                          <MenuItem value="hiring_manager">Hiring Manager</MenuItem>
                          <MenuItem value="supervisor">Supervisor</MenuItem>
                          <MenuItem value="hr_contact">HR Contact</MenuItem>
                          <MenuItem value="safety_contact">Safety Contact</MenuItem>
                          <MenuItem value="other">Other</MenuItem>
                        </Select>
                      </FormControl>
                    </Grid>
                    <Grid item xs={12} md={2}>
                      <TextField
                        fullWidth
                        label="Email"
                        value={newContact.email}
                        onChange={(e) => setNewContact(prev => ({ ...prev, email: e.target.value }))}
                        size="small"
                      />
                    </Grid>
                    <Grid item xs={12} md={2}>
                      <TextField
                        fullWidth
                        label="Phone"
                        value={newContact.phone}
                        onChange={(e) => setNewContact(prev => ({ ...prev, phone: e.target.value }))}
                        size="small"
                      />
                    </Grid>
                    <Grid item xs={12} md={2}>
                      <IconButton onClick={addContact} color="primary">
                        <AddIcon />
                      </IconButton>
                    </Grid>
                  </Grid>
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        </AccordionDetails>
      </Accordion>

      {/* Job Details */}
      <Accordion expanded={expandedSections.includes('job')} onChange={() => toggleSection('job')}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="h6">Job Details</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Grid container spacing={3}>
            <Grid item xs={12} md={6}>
              <Autocomplete
                options={jobTitles}
                value={formData.jobTitle}
                onChange={(_, newValue) => handleInputChange('jobTitle', newValue || '')}
                renderInput={(params) => (
                  <TextField {...params} label="Job Title" required />
                )}
                freeSolo
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Workers Needed"
                type="number"
                value={formData.workersNeeded}
                onChange={(e) => handleInputChange('workersNeeded', parseInt(e.target.value) || 1)}
                required
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Pay Rate ($/hour)"
                type="number"
                value={formData.payRate}
                onChange={(e) => handleInputChange('payRate', parseFloat(e.target.value) || 0)}
                required
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Bill Rate ($/hour)"
                type="number"
                value={formData.billRate}
                onChange={(e) => handleInputChange('billRate', parseFloat(e.target.value) || 0)}
                required
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <Autocomplete
                multiple
                options={recruiters}
                getOptionLabel={(option) => option.displayName || option.name || option.email}
                value={recruiters.filter(r => formData.assignedRecruiters.includes(r.id))}
                onChange={(_, newValue) => handleInputChange('assignedRecruiters', newValue.map(r => r.id))}
                renderInput={(params) => (
                  <TextField {...params} label="Assigned Recruiters" />
                )}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
                <InputLabel>Timesheet Collection</InputLabel>
                <Select
                  value={formData.timesheetCollectionMethod}
                  label="Timesheet Collection"
                  onChange={(e) => handleInputChange('timesheetCollectionMethod', e.target.value)}
                >
                  <MenuItem value="app_clock_in_out">App Clock In/Out</MenuItem>
                  <MenuItem value="physical_sign_in">Physical Sign In</MenuItem>
                  <MenuItem value="supervisor_approval">Supervisor Approval</MenuItem>
                  <MenuItem value="other">Other</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Job Description"
                multiline
                rows={4}
                value={formData.jobDescription}
                onChange={(e) => handleInputChange('jobDescription', e.target.value)}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Uniform Requirements"
                multiline
                rows={2}
                value={formData.uniformRequirements}
                onChange={(e) => handleInputChange('uniformRequirements', e.target.value)}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Check-in Instructions"
                multiline
                rows={2}
                value={formData.checkInInstructions}
                onChange={(e) => handleInputChange('checkInInstructions', e.target.value)}
              />
            </Grid>
          </Grid>
        </AccordionDetails>
      </Accordion>

      {/* Jobs Board Options */}
      <Accordion expanded={expandedSections.includes('jobsboard')} onChange={() => toggleSection('jobsboard')}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="h6">Jobs Board Options</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Grid container spacing={3}>
            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
                <InputLabel>Visibility</InputLabel>
                <Select
                  value={formData.jobsBoardVisibility}
                  label="Visibility"
                  onChange={(e) => handleInputChange('jobsBoardVisibility', e.target.value)}
                >
                  <MenuItem value="hidden">Hidden</MenuItem>
                  <MenuItem value="public">Public</MenuItem>
                  <MenuItem value="group_restricted">Group Restricted</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            {formData.jobsBoardVisibility === 'group_restricted' && (
              <Grid item xs={12} md={6}>
                <Autocomplete
                  multiple
                  options={groups}
                  getOptionLabel={(option) => option.name}
                  value={groups.filter(g => formData.restrictedGroups?.includes(g.id))}
                  onChange={(_, newValue) => handleInputChange('restrictedGroups', newValue.map(g => g.id))}
                  renderInput={(params) => (
                    <TextField {...params} label="Restricted Groups" />
                  )}
                />
              </Grid>
            )}
            <Grid item xs={12} md={4}>
              <FormControlLabel
                control={
                  <Switch
                    checked={formData.showPayRate}
                    onChange={(e) => handleInputChange('showPayRate', e.target.checked)}
                  />
                }
                label="Show Pay Rate"
              />
            </Grid>
            <Grid item xs={12} md={4}>
              <FormControlLabel
                control={
                  <Switch
                    checked={formData.showStartDate}
                    onChange={(e) => handleInputChange('showStartDate', e.target.checked)}
                  />
                }
                label="Show Start Date"
              />
            </Grid>
            <Grid item xs={12} md={4}>
              <FormControlLabel
                control={
                  <Switch
                    checked={formData.showShiftTimes}
                    onChange={(e) => handleInputChange('showShiftTimes', e.target.checked)}
                  />
                }
                label="Show Shift Times"
              />
            </Grid>
          </Grid>
        </AccordionDetails>
      </Accordion>

      {/* Requirements */}
      <Accordion expanded={expandedSections.includes('requirements')} onChange={() => toggleSection('requirements')}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="h6">Requirements</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Grid container spacing={3}>
            <Grid item xs={12} md={6}>
              <FormControlLabel
                control={
                  <Switch
                    checked={formData.drugScreenRequired}
                    onChange={(e) => handleInputChange('drugScreenRequired', e.target.checked)}
                  />
                }
                label="Drug Screen Required"
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <FormControlLabel
                control={
                  <Switch
                    checked={formData.backgroundCheckRequired}
                    onChange={(e) => handleInputChange('backgroundCheckRequired', e.target.checked)}
                  />
                }
                label="Background Check Required"
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <Autocomplete
                multiple
                options={[]}
                value={formData.requiredLicenses}
                onChange={(_, newValue) => handleInputChange('requiredLicenses', newValue)}
                renderInput={(params) => (
                  <TextField {...params} label="Required Licenses" />
                )}
                freeSolo
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <Autocomplete
                multiple
                options={[]}
                value={formData.requiredCertifications}
                onChange={(_, newValue) => handleInputChange('requiredCertifications', newValue)}
                renderInput={(params) => (
                  <TextField {...params} label="Required Certifications" />
                )}
                freeSolo
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Experience Required"
                value={formData.experienceRequired}
                onChange={(e) => handleInputChange('experienceRequired', e.target.value)}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Education Required"
                value={formData.educationRequired}
                onChange={(e) => handleInputChange('educationRequired', e.target.value)}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <Autocomplete
                multiple
                options={[]}
                value={formData.languagesRequired}
                onChange={(_, newValue) => handleInputChange('languagesRequired', newValue)}
                renderInput={(params) => (
                  <TextField {...params} label="Languages Required" />
                )}
                freeSolo
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <Autocomplete
                multiple
                options={[]}
                value={formData.skillsRequired}
                onChange={(_, newValue) => handleInputChange('skillsRequired', newValue)}
                renderInput={(params) => (
                  <TextField {...params} label="Skills Required" />
                )}
                freeSolo
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Physical Requirements"
                multiline
                rows={2}
                value={formData.physicalRequirements}
                onChange={(e) => handleInputChange('physicalRequirements', e.target.value)}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="PPE Requirements"
                multiline
                rows={2}
                value={formData.ppeRequirements}
                onChange={(e) => handleInputChange('ppeRequirements', e.target.value)}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
                <InputLabel>PPE Provided By</InputLabel>
                <Select
                  value={formData.ppeProvidedBy}
                  label="PPE Provided By"
                  onChange={(e) => handleInputChange('ppeProvidedBy', e.target.value)}
                >
                  <MenuItem value="company">Company</MenuItem>
                  <MenuItem value="worker">Worker</MenuItem>
                  <MenuItem value="both">Both</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Additional Training Required"
                multiline
                rows={2}
                value={formData.additionalTrainingRequired}
                onChange={(e) => handleInputChange('additionalTrainingRequired', e.target.value)}
              />
            </Grid>
          </Grid>
        </AccordionDetails>
      </Accordion>

      {/* Customer Context */}
      <Accordion expanded={expandedSections.includes('context')} onChange={() => toggleSection('context')}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="h6">Customer Context & Notes</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Grid container spacing={3}>
            <Grid item xs={12} md={4}>
              <TextField
                fullWidth
                label="Competing Agencies Count"
                type="number"
                value={formData.competingAgencies?.count || 0}
                onChange={(e) => handleNestedInputChange('competingAgencies', 'count', parseInt(e.target.value) || 0)}
              />
            </Grid>
            <Grid item xs={12} md={4}>
              <FormControl fullWidth>
                <InputLabel>Customer Satisfaction</InputLabel>
                <Select
                  value={formData.competingAgencies?.satisfaction || 'medium'}
                  label="Customer Satisfaction"
                  onChange={(e) => handleNestedInputChange('competingAgencies', 'satisfaction', e.target.value)}
                >
                  <MenuItem value="high">High</MenuItem>
                  <MenuItem value="medium">Medium</MenuItem>
                  <MenuItem value="low">Low</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} md={4}>
              <TextField
                fullWidth
                label="Mistakes to Avoid"
                value={formData.competingAgencies?.mistakesToAvoid || ''}
                onChange={(e) => handleNestedInputChange('competingAgencies', 'mistakesToAvoid', e.target.value)}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Attendance Policy"
                multiline
                rows={2}
                value={formData.customerSpecificRules?.attendance || ''}
                onChange={(e) => handleNestedInputChange('customerSpecificRules', 'attendance', e.target.value)}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="No-Show Policy"
                multiline
                rows={2}
                value={formData.customerSpecificRules?.noShows || ''}
                onChange={(e) => handleNestedInputChange('customerSpecificRules', 'noShows', e.target.value)}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Overtime Policy"
                multiline
                rows={2}
                value={formData.customerSpecificRules?.overtime || ''}
                onChange={(e) => handleNestedInputChange('customerSpecificRules', 'overtime', e.target.value)}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Call-off Policy"
                multiline
                rows={2}
                value={formData.customerSpecificRules?.callOffs || ''}
                onChange={(e) => handleNestedInputChange('customerSpecificRules', 'callOffs', e.target.value)}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Injury Handling Policy"
                multiline
                rows={2}
                value={formData.customerSpecificRules?.injuryHandling || ''}
                onChange={(e) => handleNestedInputChange('customerSpecificRules', 'injuryHandling', e.target.value)}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Internal Notes"
                multiline
                rows={4}
                value={formData.internalNotes}
                onChange={(e) => handleInputChange('internalNotes', e.target.value)}
              />
            </Grid>
          </Grid>
        </AccordionDetails>
      </Accordion>

      {/* Form Actions */}
      <Box sx={{ mt: 4, display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
        <Button variant="outlined" onClick={onCancel} disabled={loading}>
          Cancel
        </Button>
        <Button
          type="submit"
          variant="contained"
          startIcon={loading ? <CircularProgress size={20} /> : <SaveIcon />}
          disabled={loading}
        >
          {loading ? 'Saving...' : 'Save Job Order'}
        </Button>
      </Box>
    </Box>
  );
};

export default JobOrderForm;
