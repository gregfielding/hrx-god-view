import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Paper,
  Tabs,
  Tab,
  Avatar,
  Chip,
  Button,
  IconButton,
  Grid,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  CircularProgress,
  Alert,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Autocomplete,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Card,
  CardContent,
  CardHeader,
  Snackbar,
} from '@mui/material';
import {
  Email as EmailIcon,
  Phone as PhoneIcon,
  LinkedIn as LinkedInIcon,
  Twitter as TwitterIcon,
  Facebook as FacebookIcon,
  Instagram as InstagramIcon,
  Notes as NotesIcon,
  List as ListIcon,
  Save as SaveIcon,
  Delete as DeleteIcon,
  Info as InfoIcon,
  Language as LanguageIcon,
  AutoAwesome as AutoAwesomeIcon,
  Task as TaskIcon,
  CloudUpload as UploadIcon,
} from '@mui/icons-material';
import { doc, getDoc, updateDoc, collection, query, getDocs, orderBy, deleteDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { getFunctions, httpsCallable } from 'firebase/functions';

import { db, storage , functions } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import CRMNotesTab from '../../components/CRMNotesTab';
import SimpleAssociationsCard from '../../components/SimpleAssociationsCard';
import ActivityLogTab from '../../components/ActivityLogTab';
import ContactTasksDashboard from '../../components/ContactTasksDashboard';
import { LoggableSlider, LoggableTextField, LoggableSwitch } from '../../components/LoggableField';

interface ContactData {
  id: string;
  fullName?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  workPhone?: string;
  mobilePhone?: string;
  jobTitle?: string;
  title?: string;
  companyId?: string;
  companyName?: string;
  contactType?: string;
  tags?: string[];
  isActive?: boolean;
  notes?: string;
  address?: string;
  city?: string;
  state?: string;
  zipcode?: string;
  country?: string;
  linkedInUrl?: string;
  twitterUrl?: string;
  facebookUrl?: string;
  instagramUrl?: string;
  website?: string;
  birthday?: string;
  lastContactedTime?: any;
  lastContactedMode?: string;
  leadSource?: string;
  leadStatus?: string;
  salesOwnerId?: string;
  salesOwnerName?: string;
  salesOwnerRef?: string;
  locationId?: string;
  locationName?: string;
  avatar?: string;
  createdAt?: any;
  updatedAt?: any;
  
  // AI Enhanced Fields
  enriched?: boolean;
  enrichedAt?: any;
  professionalSummary?: string;
  inferredSeniority?: string;
  inferredIndustry?: string;
  keySkills?: string[];
  professionalInterests?: string[];
  communicationStyle?: string;
  influenceLevel?: string;
  recommendedApproach?: string;
  potentialPainPoints?: string[];
  networkingOpportunities?: string[];
  socialProfiles?: Array<{
    platform: string;
    url: string;
    title: string;
  }>;
  newsMentions?: Array<{
    title: string;
    snippet: string;
    link: string;
    date: string;
  }>;
  jobHistory?: Array<{
    title: string;
    company: string;
    duration: string;
    description: string;
  }>;
  education?: Array<{
    degree: string;
    institution: string;
    year: string;
  }>;
  associations?: {
    companies?: string[];
    deals?: string[];
    contacts?: string[];
    salespeople?: string[];
    tasks?: string[];
    locations?: string[];
  };
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
      id={`contact-tabpanel-${index}`}
      aria-labelledby={`contact-tab-${index}`}
      {...other}
    >
      {value === index && <Box sx={{ p: 0 }}>{children}</Box>}
    </div>
  );
}

const ContactDetails: React.FC = () => {
  const { contactId } = useParams<{ contactId: string }>();
  const navigate = useNavigate();
  const { tenantId, user } = useAuth();
  
  const [contact, setContact] = useState<ContactData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tabValue, setTabValue] = useState(0);
  const [company, setCompany] = useState<any>(null);
  const [activities, setActivities] = useState<any[]>([]);
  const [aiEnhancing, setAiEnhancing] = useState(false);
  const [aiSuccess, setAiSuccess] = useState<string | null>(null);
  const [snackbarOpen, setSnackbarOpen] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState('');
  const [snackbarSeverity, setSnackbarSeverity] = useState<'success' | 'error' | 'info' | 'warning'>('info');
  
  // Associations state to prevent reloading
  const [associationsData, setAssociationsData] = useState<{
    associations: any;
    entities: any;
    loading: boolean;
    error: string | null;
  }>({
    associations: {},
    entities: {
      companies: [],
      deals: [],
      contacts: [],
      salespeople: [],
      tasks: [],
      locations: []
    },
    loading: false,
    error: null
  });
  
  // Company linking state
  const [companies, setCompanies] = useState<any[]>([]);
  const [selectedCompany, setSelectedCompany] = useState<any>(null);
  const [selectedDivision, setSelectedDivision] = useState<string>('');
  const [selectedLocation, setSelectedLocation] = useState<string>('');
  const [companyLocations, setCompanyLocations] = useState<any[]>([]);
  const [loadingCompanies, setLoadingCompanies] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [fixingAssociations, setFixingAssociations] = useState(false);

  // Contact info finding state
  const [findingContactInfo, setFindingContactInfo] = useState(false);
  const [emailOptions, setEmailOptions] = useState<any[]>([]);
  const [showEmailDialog, setShowEmailDialog] = useState(false);
  
  // Avatar upload state
  const [avatarLoading, setAvatarLoading] = useState(false);

  // Tone settings state
  const [toneSettings, setToneSettings] = useState({
    professional: 0.7,
    friendly: 0.6,
    encouraging: 0.8,
    direct: 0.5,
    empathetic: 0.7,
  });

  // Helper function to show toast notifications
  const showToast = (message: string, severity: 'success' | 'error' | 'info' | 'warning' = 'info') => {
    setSnackbarMessage(message);
    setSnackbarSeverity(severity);
    setSnackbarOpen(true);
  };

  // Avatar upload function
  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!contactId || !tenantId || !e.target.files || !e.target.files[0]) return;
    
    const file = e.target.files[0];
    
    if (file.size > 2 * 1024 * 1024) {
      showToast('Avatar file size must be less than 2MB', 'error');
      return;
    }

    const validTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/svg+xml'];
    if (!validTypes.includes(file.type)) {
      showToast('Please upload a PNG, JPG, or SVG file', 'error');
      return;
    }

    setAvatarLoading(true);
    try {
      const storageRef = ref(storage, `contacts/${tenantId}/${contactId}/avatar.${file.name.split('.').pop()}`);
      await uploadBytes(storageRef, file);
      const downloadURL = await getDownloadURL(storageRef);
      
      await handleContactUpdate('avatar', downloadURL);
      showToast('Avatar uploaded successfully!', 'success');
    } catch (err) {
      console.error('Error uploading avatar:', err);
      showToast('Failed to upload avatar. Please try again.', 'error');
    } finally {
      setAvatarLoading(false);
    }
  };

  // Avatar delete function
  const handleAvatarDelete = async () => {
    if (!contactId || !tenantId || !contact?.avatar) return;
    
    setAvatarLoading(true);
    try {
      // Delete from storage
      const urlParts = contact.avatar.split('/');
      const fileName = urlParts[urlParts.length - 1];
      const fileExtension = fileName.split('.').pop() || 'png';
      const storageRef = ref(storage, `contacts/${tenantId}/${contactId}/avatar.${fileExtension}`);
      await deleteObject(storageRef);
      
      // Update contact record
      await handleContactUpdate('avatar', '');
      showToast('Avatar deleted successfully!', 'success');
    } catch (err) {
      console.error('Error deleting avatar:', err);
      showToast('Failed to delete avatar. Please try again.', 'error');
    } finally {
      setAvatarLoading(false);
    }
  };

  // Function to update avatar from social profile
  const updateAvatarFromSocialProfile = async (profileUrl: string) => {
    if (!contactId || !tenantId) return;
    
    try {
      // This would typically involve fetching the profile image from the social platform
      // For now, we'll simulate this by using a placeholder
      // In a real implementation, you'd need to:
      // 1. Fetch the profile image from LinkedIn/Twitter/etc.
      // 2. Upload it to Firebase Storage
      // 3. Update the contact record
      
      console.log('Would update avatar from social profile:', profileUrl);
      showToast('Avatar update from social profile not yet implemented', 'info');
    } catch (err) {
      console.error('Error updating avatar from social profile:', err);
      showToast('Failed to update avatar from social profile', 'error');
    }
  };

  const handleToneChange = (tone: string, value: number) => {
    setToneSettings(prev => ({
      ...prev,
      [tone]: value
    }));
  };

  // Individual tone change handlers for LoggableSlider compatibility
  const handleProfessionalTone = (value: number) => handleToneChange('professional', value);
  const handleFriendlyTone = (value: number) => handleToneChange('friendly', value);
  const handleEncouragingTone = (value: number) => handleToneChange('encouraging', value);
  const handleDirectTone = (value: number) => handleToneChange('direct', value);
  const handleEmpatheticTone = (value: number) => handleToneChange('empathetic', value);

  const handleAutoAdjustTone = () => {
    // AI could analyze the contact's communication style and adjust tone settings
    // For now, we'll use some basic logic based on the contact's inferred characteristics
    const newToneSettings = {
      professional: contact?.inferredSeniority === 'Senior' ? 0.8 : 0.6,
      friendly: contact?.communicationStyle === 'Casual' ? 0.8 : 0.5,
      encouraging: 0.7,
      direct: contact?.influenceLevel === 'High' ? 0.7 : 0.4,
      empathetic: contact?.communicationStyle === 'Supportive' ? 0.8 : 0.6,
    };
    setToneSettings(newToneSettings);
  };

  const handleSaveToneSettings = async () => {
    try {
      // Save tone settings to the contact record
      await handleContactUpdate('toneSettings', toneSettings);
      setAiSuccess('Tone settings saved successfully!');
      setTimeout(() => setAiSuccess(null), 3000);
    } catch (err) {
      setError('Failed to save tone settings');
    }
  };

  // Load associations data
  const loadAssociations = async () => {
    if (!contactId || !tenantId || !user?.uid) return;
    
    try {
      setAssociationsData(prev => ({ ...prev, loading: true, error: null }));
      
      // Use the simple association service
      const { createSimpleAssociationService } = await import('../../utils/simpleAssociationService');
      const associationService = createSimpleAssociationService(tenantId, user.uid);
      
      const result = await associationService.getAssociations('contact', contactId);
      
      setAssociationsData({
        associations: result.associations,
        entities: result.entities,
        loading: false,
        error: null
      });
      
    } catch (err: any) {
      console.error('Error loading associations:', err);
      setAssociationsData(prev => ({
        ...prev,
        loading: false,
        error: err.message || 'Failed to load associations'
      }));
    }
  };

  // Load contact data
  const loadContact = async () => {
    if (!contactId || !tenantId) return;
    
    try {
      setLoading(true);
      const contactDoc = await getDoc(doc(db, 'tenants', tenantId, 'crm_contacts', contactId));
      
      if (!contactDoc.exists()) {
        setError('Contact not found');
        return;
      }

      const contactData = { id: contactDoc.id, ...contactDoc.data() } as ContactData;
      setContact(contactData);

      // Load associated company if contact has companyId
      if (contactData.companyId) {
        const companyDoc = await getDoc(doc(db, 'tenants', tenantId, 'crm_companies', contactData.companyId));
        if (companyDoc.exists()) {
          const companyData = { id: companyDoc.id, ...companyDoc.data() };
          setCompany(companyData);
          setSelectedCompany(companyData);
          
          // Load company locations
          await loadCompanyLocations(contactData.companyId);
          
          // Set selected location if contact has one
          if (contactData.locationId) {
            setSelectedLocation(contactData.locationId);
          }
        }
      }

      // Load activities (you can implement this based on your activity tracking system)
      setActivities([]);

      // Load companies for autocomplete
      await loadCompanies();
      
      // Load associations
      await loadAssociations();

    } catch (err) {
      console.error('Error loading contact:', err);
      setError('Failed to load contact');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadContact();
  }, [contactId, tenantId]);

  const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
  };

  // Load companies for autocomplete
  const loadCompanies = async () => {
    if (!tenantId) return;
    
    try {
      setLoadingCompanies(true);
      const companiesRef = collection(db, 'tenants', tenantId, 'crm_companies');
      const companiesQuery = query(companiesRef, orderBy('companyName', 'asc'));
      const companiesSnapshot = await getDocs(companiesQuery);
      const companiesData = companiesSnapshot.docs.map(doc => ({ 
        id: doc.id, 
        ...doc.data() 
      }));
      setCompanies(companiesData);
    } catch (err) {
      console.error('Error loading companies:', err);
    } finally {
      setLoadingCompanies(false);
    }
  };

  // Load company locations
  const loadCompanyLocations = async (companyId: string) => {
    if (!tenantId || !companyId) return;
    
    try {
      const locationsRef = collection(db, 'tenants', tenantId, 'crm_companies', companyId, 'locations');
      const locationsSnapshot = await getDocs(locationsRef);
      const locationsData = locationsSnapshot.docs.map(doc => ({ 
        id: doc.id, 
        ...doc.data() 
      }));
      setCompanyLocations(locationsData);
    } catch (err) {
      console.error('Error loading company locations:', err);
      setCompanyLocations([]);
    }
  };

  // Handle company selection
  const handleCompanySelect = async (company: any) => {
    setSelectedCompany(company);
    setSelectedDivision('');
    setSelectedLocation('');
    
    if (company) {
      await loadCompanyLocations(company.id);
      await handleContactUpdate('companyId', company.id);
      await handleContactUpdate('companyName', company.companyName || company.name);
      
      // Add company to associations
      if (contact && contact.associations) {
        const updatedAssociations = { ...contact.associations };
        if (!updatedAssociations.companies) {
          updatedAssociations.companies = [];
        }
        if (!updatedAssociations.companies.includes(company.id)) {
          updatedAssociations.companies.push(company.id);
          await handleContactUpdate('associations', updatedAssociations);
        }
      }
    } else {
      setCompanyLocations([]);
      await handleContactUpdate('companyId', null);
      await handleContactUpdate('companyName', '');
    }
  };

  // Handle division selection
  const handleDivisionSelect = (division: string) => {
    setSelectedDivision(division);
    setSelectedLocation('');
  };

  // Handle location selection (standardize on callable function)
  const handleLocationSelect = async (locationId: string) => {
    setSelectedLocation(locationId);
    const location = companyLocations.find(loc => loc.id === locationId);
    try {
      const updateLocationAssociation = httpsCallable(functions, 'updateLocationAssociation');
      await updateLocationAssociation({
        tenantId,
        entityType: 'contact',
        entityId: contactId,
        locationId,
        companyId: selectedCompany?.id || contact?.companyId || '',
        locationName: location?.name || null
      });
      // Optimistically update local state
      setContact(prev => prev ? { ...prev, locationId, locationName: location?.name || '' } : prev);
    } catch (err) {
      console.error('Error updating location association via function:', err);
      setError('Failed to update work location');
    }
  };

  // Filter locations by division
  const getFilteredLocations = () => {
    if (!selectedDivision) {
      return companyLocations;
    }
    return companyLocations.filter(location => location.division === selectedDivision);
  };

  const handleContactUpdate = async (field: string, value: any) => {
    if (!contactId || !tenantId || !contact || !user?.uid) return;

    try {
      // Ensure URL fields have proper protocols
      let processedValue = value;
      if (['linkedInUrl', 'twitterUrl', 'facebookUrl', 'instagramUrl', 'website'].includes(field) && value) {
        processedValue = ensureUrlProtocol(value);
      }

      await updateDoc(doc(db, 'tenants', tenantId, 'crm_contacts', contactId), { 
        [field]: processedValue,
        updatedAt: new Date()
      });
      
      // Log the activity using the existing AI logging system
      try {
        const functions = getFunctions();
        const logAIActionCallable = httpsCallable(functions, 'logAIActionCallable');
        await logAIActionCallable({
          action: 'contact_updated',
          entityId: contactId,
          entityType: 'contact',
          reason: `Updated ${field}: ${processedValue}`,
          tenantId,
          userId: user.uid,
          metadata: { field, value: processedValue }
        });
      } catch (logError) {
        console.warn('Failed to log activity:', logError);
        // Don't fail the main operation if logging fails
      }
      
      // Update local state
      setContact(prev => prev ? { ...prev, [field]: processedValue } : null);
      setAiSuccess('Contact updated successfully!');
      
      // Clear success message after 3 seconds
      setTimeout(() => setAiSuccess(null), 3000);
    } catch (err) {
      console.error('Error updating contact:', err);
      setError('Failed to update contact. Please try again.');
    }
  };

  const ensureUrlProtocol = (url: string): string => {
    if (!url) return url;
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return 'https://' + url;
    }
    return url;
  };

  const handleDelete = async () => {
    if (!contactId || !tenantId) return;
    
    setDeleting(true);
    try {
      // Delete the contact document
      const contactRef = doc(db, 'tenants', tenantId, 'crm_contacts', contactId);
      await deleteDoc(contactRef);
      
      // Navigate back to contacts list
      navigate('/crm?tab=contacts');
    } catch (err: any) {
      console.error('Error deleting contact:', err);
      setError('Failed to delete contact. Please try again.');
    } finally {
      setDeleting(false);
      setDeleteDialogOpen(false);
    }
  };

  const handleFixAssociations = async () => {
    if (!contactId || !tenantId || !contact) return;
    
    setFixingAssociations(true);
    try {
      const associations = { ...(contact.associations || {}) };
      let fixedCount = 0;
      
      // Check if contact has companyId but no associations.companies
      const hasCompanyId = contact.companyId && contact.companyId.trim() !== '';
      const hasCompanyAssociations = associations.companies && associations.companies.length > 0;
      
      if (hasCompanyId && !hasCompanyAssociations) {
        associations.companies = [...(associations.companies || [])];
        if (!associations.companies.includes(contact.companyId)) {
          associations.companies.push(contact.companyId);
          fixedCount++;
        }
      }
      
      // Check if contact has locationId but no associations.locations
      const hasLocationId = contact.locationId && contact.locationId.trim() !== '';
      const hasLocationAssociations = associations.locations && associations.locations.length > 0;
      
      if (hasLocationId && !hasLocationAssociations) {
        associations.locations = [...(associations.locations || [])];
        if (!associations.locations.includes(contact.locationId)) {
          associations.locations.push(contact.locationId);
          fixedCount++;
        }
      }
      
      if (fixedCount > 0) {
        // Update the contact document
        await updateDoc(doc(db, 'tenants', tenantId, 'crm_contacts', contactId), {
          associations: associations,
          updatedAt: new Date()
        });
        
        // Update local state
        setContact(prev => prev ? { ...prev, associations } : null);
        setAiSuccess(`Fixed ${fixedCount} association(s) successfully!`);
      } else {
        setAiSuccess('No associations to fix for this contact.');
      }
    } catch (err: any) {
      console.error('Error fixing associations:', err);
      setError('Failed to fix associations. Please try again.');
    } finally {
      setFixingAssociations(false);
    }
  };

  const handleAIEnhancement = async () => {
    if (!contactId || !tenantId || !contact) return;

    try {
      setAiEnhancing(true);
      setAiSuccess(null);
      setError('');

      const functions = getFunctions();
      const enhanceContact = httpsCallable(functions, 'enhanceContactWithAI');
      
      const result = await enhanceContact({
        contactId,
        tenantId,
        contactData: contact
      });

      const resultData = result.data as any;
      
      if (resultData.success) {
        // Reload the contact to get the enhanced data
        const contactDoc = await getDoc(doc(db, 'tenants', tenantId, 'crm_contacts', contactId));
        let enhancedContactData: ContactData | null = null;
        if (contactDoc.exists()) {
          enhancedContactData = { id: contactDoc.id, ...contactDoc.data() } as ContactData;
          setContact(enhancedContactData);
        }
        
        // Log the AI enhancement activity
        try {
          const logContactEnhanced = httpsCallable(functions, 'logContactEnhanced');
          await logContactEnhanced({
            contactId: contactId,
            reason: 'AI enhancement completed',
            tenantId,
            userId: user?.uid || '',
            metadata: { 
              enhancedFields: enhancedContactData ? Object.keys(enhancedContactData) : [],
              hasProfessionalSummary: !!(enhancedContactData?.professionalSummary),
              hasInferredData: !!(enhancedContactData?.inferredSeniority || enhancedContactData?.inferredIndustry)
            }
          });
        } catch (logError) {
          console.warn('Failed to log AI enhancement activity:', logError);
        }
        
        // Update avatar if social profiles are found and no avatar exists
        if (enhancedContactData?.socialProfiles && enhancedContactData.socialProfiles.length > 0 && !contact.avatar) {
          const linkedInProfile = enhancedContactData.socialProfiles.find((profile: any) => profile.platform === 'LinkedIn');
          if (linkedInProfile) {
            await updateAvatarFromSocialProfile(linkedInProfile.url);
          }
        }
        
        setAiSuccess('Contact enhanced successfully with AI! Found social profiles, company information, and professional insights.');
      } else {
        setError(resultData.message || 'Failed to enhance contact');
      }
    } catch (err: any) {
      console.error('Error enhancing contact:', err);
      setError(err.message || 'Failed to enhance contact with AI');
    } finally {
      setAiEnhancing(false);
    }
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  if (error || !contact) {
    return (
      <Box p={3}>
        <Alert severity="error">{error || 'Contact not found'}</Alert>
      </Box>
    );
  }

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(word => word.charAt(0))
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  // Check if Fix Associations button should be shown
  const shouldShowFixAssociationsButton = () => {
    // Show if contact has a companyId but no company associations
    const hasCompanyId = contact?.companyId && contact.companyId.trim() !== '';
    const hasCompanyAssociations = contact?.associations?.companies && contact.associations.companies.length > 0;
    
    return hasCompanyId && !hasCompanyAssociations;
  };

  // Check if Find Contact Info button should be shown
  const shouldShowFindContactInfoButton = () => {
    // Show if contact has name and company but missing email or phone
    const hasName = contact?.firstName || contact?.lastName || contact?.fullName;
    const hasCompany = contact?.companyName;
    const hasEmail = contact?.email && contact.email.trim() !== '';
    const hasPhone = contact?.phone && contact.phone.trim() !== '';
    
    return hasName && hasCompany && (!hasEmail || !hasPhone);
  };

  // Extract domain from company name
  const extractDomain = (companyName: string) => {
    // Simple domain extraction - you might want to enhance this
    const cleanName = companyName.toLowerCase().replace(/[^a-z0-9]/g, '');
    return `${cleanName}.com`;
  };

  // Handle Find Email
  
  const handleFindContactInfo = async () => {
    if (!contact || !tenantId || !contactId) return;
    
    setFindingContactInfo(true);
    try {
      const findContactInfo = httpsCallable(functions, 'findContactInfo');
      const result = await findContactInfo({
        firstName: contact.firstName || contact.fullName?.split(' ')[0] || '',
        lastName: contact.lastName || contact.fullName?.split(' ').slice(1).join(' ') || '',
        companyDomain: extractDomain(contact.companyName || ''),
        tenantId,
        contactId
      });
      
      const resultData = result.data as any;
      if (resultData.success) {
        let successMessage = '';
        
        if (resultData.email) {
          successMessage += `Found email: ${resultData.email} (${resultData.confidence}% confidence)`;
        }
        
        if (resultData.phone) {
          if (successMessage) successMessage += '\n';
          successMessage += `Found phone: ${resultData.phone}`;
        }
        
        // If multiple emails found, show dialog
        if (resultData.alternatives && resultData.alternatives.length > 0) {
          setEmailOptions([
            { email: resultData.email, confidence: resultData.confidence, isPrimary: true },
            ...resultData.alternatives.map((alt: any) => ({ 
              email: alt.email, 
              confidence: alt.confidence, 
              isPrimary: false 
            }))
          ]);
          setShowEmailDialog(true);
        } else {
          // Single result found, auto-save
          showToast(successMessage, 'success');
          await loadContact();
        }
      } else {
        showToast('No contact information found for this contact', 'info');
      }
    } catch (err: any) {
      console.error('Error finding contact info:', err);
      showToast(err.message || 'Failed to find contact information', 'error');
    } finally {
      setFindingContactInfo(false);
    }
  };

  // Handle email selection
  const handleSelectEmail = async (selectedEmail: string) => {
    try {
      await handleContactUpdate('email', selectedEmail);
      showToast(`Email updated: ${selectedEmail}`, 'success');
      setShowEmailDialog(false);
      setEmailOptions([]);
    } catch (err: any) {
      showToast('Failed to update email', 'error');
    }
  };



  return (
    <Box sx={{ p: 0 }}>
      {/* Header */}
      <Box sx={{ mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 3 }}>
            {/* Contact Avatar */}
            <Box sx={{ position: 'relative' }}>
              <Avatar
                src={contact.avatar}
                sx={{ 
                  width: 80, 
                  height: 80,
                  bgcolor: contact.avatar ? 'transparent' : 'primary.main',
                  fontSize: '1.5rem',
                  fontWeight: 'bold'
                }}
              >
                {getInitials(contact.fullName || `${contact.firstName || ''} ${contact.lastName || ''}`)}
              </Avatar>
              
              {/* Avatar Upload/Delete Buttons */}
              <Box sx={{ 
                position: 'absolute', 
                bottom: -8, 
                right: -8,
                display: 'flex',
                gap: 0.5
              }}>
                <input
                  accept="image/*"
                  style={{ display: 'none' }}
                  id="avatar-upload"
                  type="file"
                  onChange={handleAvatarUpload}
                  disabled={avatarLoading}
                />
                <label htmlFor="avatar-upload">
                  <IconButton
                    component="span"
                    size="small"
                    sx={{
                      bgcolor: 'primary.main',
                      color: 'white',
                      '&:hover': {
                        bgcolor: 'primary.dark'
                      },
                      width: 28,
                      height: 28
                    }}
                    disabled={avatarLoading}
                  >
                    {avatarLoading ? (
                      <CircularProgress size={16} color="inherit" />
                    ) : (
                      <UploadIcon sx={{ fontSize: 16 }} />
                    )}
                  </IconButton>
                </label>
                
                {contact.avatar && (
                  <IconButton
                    size="small"
                    onClick={handleAvatarDelete}
                    disabled={avatarLoading}
                    sx={{
                      bgcolor: 'error.main',
                      color: 'white',
                      '&:hover': {
                        bgcolor: 'error.dark'
                      },
                      width: 28,
                      height: 28
                    }}
                  >
                    {avatarLoading ? (
                      <CircularProgress size={16} color="inherit" />
                    ) : (
                      <DeleteIcon sx={{ fontSize: 16 }} />
                    )}
                  </IconButton>
                )}
              </Box>
            </Box>

            {/* Contact Information */}
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              <Typography variant="h4" sx={{ fontWeight: 'bold', color: 'text.primary' }}>
                {contact.fullName || `${contact.firstName || ''} ${contact.lastName || ''}`}
              </Typography>
              
              {/* Job Title */}
              <Typography variant="body2" color="text.secondary">
                {contact.jobTitle || contact.title || 'No title'}
              </Typography>
              
              {/* Company */}
              {company && (
                <Typography 
                  variant="body2" 
                  color="primary"
                  sx={{ 
                    cursor: 'pointer',
                    textDecoration: 'underline',
                    '&:hover': {
                      color: 'primary.dark'
                    }
                  }}
                  onClick={() => navigate(`/crm/companies/${company.id}`)}
                >
                  {company.companyName || company.name}
                </Typography>
              )}
              
              {/* Contact Icons */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0, mt: 0 }}>
                <IconButton
                  size="small"
                  sx={{ 
                    p: 0.5,
                    color: contact.email ? 'primary.main' : 'text.disabled',
                    bgcolor: contact.email ? 'primary.50' : 'transparent',
                    borderRadius: 1,
                    '&:hover': {
                      color: contact.email ? 'primary.dark' : 'text.disabled',
                      bgcolor: contact.email ? 'primary.100' : 'transparent'
                    }
                  }}
                  onClick={() => {
                    if (contact.email) {
                      window.open(`mailto:${contact.email}`, '_blank');
                    }
                  }}
                  title={contact.email ? 'Send Email' : 'No email'}
                >
                  <EmailIcon sx={{ fontSize: 20 }} />
                </IconButton>
                
                <IconButton
                  size="small"
                  sx={{ 
                    p: 0.5,
                    color: contact.phone || contact.workPhone ? 'primary.main' : 'text.disabled',
                    bgcolor: contact.phone || contact.workPhone ? 'primary.50' : 'transparent',
                    borderRadius: 1,
                    '&:hover': {
                      color: contact.phone || contact.workPhone ? 'primary.dark' : 'text.disabled',
                      bgcolor: contact.phone || contact.workPhone ? 'primary.100' : 'transparent'
                    }
                  }}
                  onClick={() => {
                    if (contact.phone || contact.workPhone) {
                      window.open(`tel:${contact.phone || contact.workPhone}`, '_blank');
                    }
                  }}
                  title={contact.phone || contact.workPhone ? 'Call Phone' : 'No phone'}
                >
                  <PhoneIcon sx={{ fontSize: 20 }} />
                </IconButton>
                
                <IconButton
                  size="small"
                  sx={{ 
                    p: 0.5,
                    color: contact.linkedInUrl ? 'primary.main' : 'text.disabled',
                    bgcolor: contact.linkedInUrl ? 'primary.50' : 'transparent',
                    borderRadius: 1,
                    '&:hover': {
                      color: contact.linkedInUrl ? 'primary.dark' : 'text.disabled',
                      bgcolor: contact.linkedInUrl ? 'primary.100' : 'transparent'
                    }
                  }}
                  onClick={() => {
                    if (contact.linkedInUrl) {
                      let url = contact.linkedInUrl;
                      if (!url.startsWith('http://') && !url.startsWith('https://')) {
                        url = 'https://' + url;
                      }
                      window.open(url, '_blank');
                    }
                  }}
                  title={contact.linkedInUrl ? 'View LinkedIn' : 'No LinkedIn'}
                >
                  <LinkedInIcon sx={{ fontSize: 20 }} />
                </IconButton>
                
                <IconButton
                  size="small"
                  sx={{ 
                    p: 0.5,
                    color: contact.twitterUrl ? 'primary.main' : 'text.disabled',
                    bgcolor: contact.twitterUrl ? 'primary.50' : 'transparent',
                    borderRadius: 1,
                    '&:hover': {
                      color: contact.twitterUrl ? 'primary.dark' : 'text.disabled',
                      bgcolor: contact.twitterUrl ? 'primary.100' : 'transparent'
                    }
                  }}
                  onClick={() => {
                    if (contact.twitterUrl) {
                      let url = contact.twitterUrl;
                      if (!url.startsWith('http://') && !url.startsWith('https://')) {
                        url = 'https://' + url;
                      }
                      window.open(url, '_blank');
                    }
                  }}
                  title={contact.twitterUrl ? 'View Twitter' : 'No Twitter'}
                >
                  <TwitterIcon sx={{ fontSize: 20 }} />
                </IconButton>
                
                <IconButton
                  size="small"
                  sx={{ 
                    p: 0.5,
                    color: contact.facebookUrl ? 'primary.main' : 'text.disabled',
                    bgcolor: contact.facebookUrl ? 'primary.50' : 'transparent',
                    borderRadius: 1,
                    '&:hover': {
                      color: contact.facebookUrl ? 'primary.dark' : 'text.disabled',
                      bgcolor: contact.facebookUrl ? 'primary.100' : 'transparent'
                    }
                  }}
                  onClick={() => {
                    if (contact.facebookUrl) {
                      let url = contact.facebookUrl;
                      if (!url.startsWith('http://') && !url.startsWith('https://')) {
                        url = 'https://' + url;
                      }
                      window.open(url, '_blank');
                    }
                  }}
                  title={contact.facebookUrl ? 'View Facebook' : 'No Facebook'}
                >
                  <FacebookIcon sx={{ fontSize: 20 }} />
                </IconButton>
                
                <IconButton
                  size="small"
                  sx={{ 
                    p: 0.5,
                    color: contact.instagramUrl ? 'primary.main' : 'text.disabled',
                    bgcolor: contact.instagramUrl ? 'primary.50' : 'transparent',
                    borderRadius: 1,
                    '&:hover': {
                      color: contact.instagramUrl ? 'primary.dark' : 'text.disabled',
                      bgcolor: contact.instagramUrl ? 'primary.100' : 'transparent'
                    }
                  }}
                  onClick={() => {
                    if (contact.instagramUrl) {
                      let url = contact.instagramUrl;
                      if (!url.startsWith('http://') && !url.startsWith('https://')) {
                        url = 'https://' + url;
                      }
                      window.open(url, '_blank');
                    }
                  }}
                  title={contact.instagramUrl ? 'View Instagram' : 'No Instagram'}
                >
                  <InstagramIcon sx={{ fontSize: 20 }} />
                </IconButton>
                
                <IconButton
                  size="small"
                  sx={{ 
                    p: 0.5,
                    color: contact.website ? 'primary.main' : 'text.disabled',
                    bgcolor: contact.website ? 'primary.50' : 'transparent',
                    borderRadius: 1,
                    '&:hover': {
                      color: contact.website ? 'primary.dark' : 'text.disabled',
                      bgcolor: contact.website ? 'primary.100' : 'transparent'
                    }
                  }}
                  onClick={() => {
                    if (contact.website) {
                      let url = contact.website;
                      if (!url.startsWith('http://') && !url.startsWith('https://')) {
                        url = 'https://' + url;
                      }
                      window.open(url, '_blank');
                    }
                  }}
                  title={contact.website ? 'Visit Website' : 'No Website'}
                >
                  <LanguageIcon sx={{ fontSize: 20 }} />
                </IconButton>
              </Box>
            </Box>
          </Box>

          {/* Action Buttons */}
          <Box sx={{ display: 'flex', gap: 2 }}>
            <Button
              variant="outlined"
              onClick={() => navigate('/crm')}
            >
              Back to Contacts
            </Button>
            {shouldShowFindContactInfoButton() && (
              <Button
                variant="outlined"
                color="primary"
                startIcon={findingContactInfo ? <CircularProgress size={20} color="inherit" /> : <EmailIcon />}
                onClick={handleFindContactInfo}
                disabled={findingContactInfo}
              >
                {findingContactInfo ? 'Finding...' : 'Find Contact Info'}
              </Button>
            )}
            <Button
              variant="contained"
              color="secondary"
              startIcon={aiEnhancing ? <CircularProgress size={20} color="inherit" /> : <AutoAwesomeIcon />}
              onClick={handleAIEnhancement}
              disabled={aiEnhancing}
            >
              {aiEnhancing ? 'Enhancing...' : 'AI Enhance'}
            </Button>
            <Button
              variant="outlined"
              color="error"
              startIcon={<DeleteIcon />}
              onClick={() => setDeleteDialogOpen(true)}
            >
              Delete
            </Button>
          </Box>
        </Box>
      </Box>

      {/* Success/Error Alerts */}
      {aiSuccess && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setAiSuccess(null)}>
          {aiSuccess}
        </Alert>
      )}

      {/* Tabs Navigation */}
      <Paper elevation={1} sx={{ mb: 3, borderRadius: 0 }}>
        <Tabs
          value={tabValue}
          onChange={handleTabChange}
          indicatorColor="primary"
          textColor="primary"
          variant="scrollable"
          scrollButtons="auto"
          aria-label="Contact details tabs"
        >
          <Tab 
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <InfoIcon fontSize="small" />
                Overview
              </Box>
            } 
          />
          <Tab 
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <TaskIcon fontSize="small" />
                Tasks
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
                <ListIcon fontSize="small" />
                Activity Log
              </Box>
            } 
          />
        </Tabs>
      </Paper>

      {/* Tab Panels */}
      <TabPanel value={tabValue} index={0}>
        <Grid container spacing={3}>
          {/* Contact Details */}
          <Grid item xs={12} md={6}>
            <Card>
              <CardHeader title="Contact Details" />
              <CardContent>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <LoggableTextField
                    fieldPath={`tenants:${tenantId}.crm_contacts.${contactId}.fullName`}
                    trigger="update"
                    destinationModules={['ContactEngine', 'ToneEngine']}
                    value={contact.fullName || ''}
                    onChange={(value) => handleContactUpdate('fullName', value)}
                    label="Full Name"
                    contextType="contact"
                    urgencyScore={5}
                    description="Contact full name"
                  />
                  <LoggableTextField
                    fieldPath={`tenants:${tenantId}.crm_contacts.${contactId}.email`}
                    trigger="update"
                    destinationModules={['ContactEngine', 'ToneEngine']}
                    value={contact.email || ''}
                    onChange={(value) => handleContactUpdate('email', value)}
                    label="Email"
                    contextType="contact"
                    urgencyScore={5}
                    description="Contact email address"
                  />
                  <LoggableTextField
                    fieldPath={`tenants:${tenantId}.crm_contacts.${contactId}.phone`}
                    trigger="update"
                    destinationModules={['ContactEngine', 'ToneEngine']}
                    value={contact.phone || contact.workPhone || ''}
                    onChange={(value) => handleContactUpdate('phone', value)}
                    label="Phone"
                    contextType="contact"
                    urgencyScore={4}
                    description="Contact phone number"
                  />
                  <LoggableTextField
                    fieldPath={`tenants:${tenantId}.crm_contacts.${contactId}.mobilePhone`}
                    trigger="update"
                    destinationModules={['ContactEngine', 'ToneEngine']}
                    value={contact.mobilePhone || ''}
                    onChange={(value) => handleContactUpdate('mobilePhone', value)}
                    label="Mobile"
                    contextType="contact"
                    urgencyScore={4}
                    description="Contact mobile phone"
                  />
                  <LoggableTextField
                    fieldPath={`tenants:${tenantId}.crm_contacts.${contactId}.jobTitle`}
                    trigger="update"
                    destinationModules={['ContactEngine', 'ToneEngine']}
                    value={contact.jobTitle || contact.title || ''}
                    onChange={(value) => {
                      handleContactUpdate('jobTitle', value);
                      handleContactUpdate('title', value);
                    }}
                    label="Job Title"
                    contextType="contact"
                    urgencyScore={4}
                    description="Contact job title"
                  />
                  <LoggableTextField
                    fieldPath={`tenants:${tenantId}.crm_contacts.${contactId}.linkedInUrl`}
                    trigger="update"
                    destinationModules={['ContactEngine', 'ToneEngine']}
                    value={contact.linkedInUrl || ''}
                    onChange={(value) => handleContactUpdate('linkedInUrl', value)}
                    label="LinkedIn URL"
                    contextType="contact"
                    urgencyScore={3}
                    description="Contact LinkedIn profile"
                  />
                  
                  {/* Company Autocomplete */}
                  <Autocomplete
                    options={companies}
                    getOptionLabel={(option) => option.companyName || option.name || ''}
                    value={selectedCompany}
                    onChange={(event, newValue) => handleCompanySelect(newValue)}
                    loading={loadingCompanies}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label="Company"
                        size="small"
                        InputProps={{
                          ...params.InputProps,
                          endAdornment: (
                            <>
                              {loadingCompanies ? <CircularProgress color="inherit" size={20} /> : null}
                              {params.InputProps.endAdornment}
                            </>
                          ),
                        }}
                      />
                    )}
                    renderOption={(props, option) => (
                      <Box component="li" {...props}>
                        <Box>
                          <Typography variant="body2">
                            {option.companyName || option.name}
                          </Typography>
                          {option.industry && (
                            <Typography variant="caption" color="text.secondary">
                              {option.industry}
                            </Typography>
                          )}
                        </Box>
                      </Box>
                    )}
                  />
                  
                  <LoggableTextField
                    fieldPath={`tenants:${tenantId}.crm_contacts.${contactId}.leadSource`}
                    trigger="update"
                    destinationModules={['ContactEngine', 'ToneEngine']}
                    value={contact.leadSource || ''}
                    onChange={(value) => handleContactUpdate('leadSource', value)}
                    label="Lead Source"
                    contextType="contact"
                    urgencyScore={3}
                    description="Contact lead source"
                  />

                  {/* Contact Type Dropdown */}
                  <FormControl fullWidth size="small">
                    <InputLabel>Contact Type</InputLabel>
                    <Select
                      value={contact.contactType || 'Unknown'}
                      label="Contact Type"
                      onChange={(e) => handleContactUpdate('contactType', e.target.value)}
                    >
                      <MenuItem value="Decision Maker">Decision Maker</MenuItem>
                      <MenuItem value="Influencer">Influencer</MenuItem>
                      <MenuItem value="Gatekeeper">Gatekeeper</MenuItem>
                      <MenuItem value="Referrer">Referrer</MenuItem>
                      <MenuItem value="Evaluator">Evaluator</MenuItem>
                      <MenuItem value="Unknown">Unknown</MenuItem>
                    </Select>
                  </FormControl>

                  {/* Tags Field */}
                  <Autocomplete
                    multiple
                    freeSolo
                    options={[]}
                    value={contact.tags || []}
                    onChange={(event, newValue) => {
                      // Handle both string and array values
                      const tags = newValue.map(item => typeof item === 'string' ? item : (item as any).inputValue || '');
                      handleContactUpdate('tags', tags);
                    }}
                    renderTags={(value, getTagProps) =>
                      value.map((option, index) => {
                        const { key, ...chipProps } = getTagProps({ index });
                        return (
                          <Chip
                            key={key}
                            variant="outlined"
                            label={option}
                            {...chipProps}
                            size="small"
                          />
                        );
                      })
                    }
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label="Tags"
                        size="small"
                        placeholder="Add tags..."
                        helperText="Press Enter to add a new tag"
                      />
                    )}
                  />

                  {/* isActive Toggle */}
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Box>
                      <Typography variant="body2" component="div">
                        Active Contact
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {contact.isActive ? 'Contact is active and available for engagement' : 'Contact is archived or inactive'}
                      </Typography>
                    </Box>
                    <LoggableSwitch
                      fieldPath={`tenants:${tenantId}.crm_contacts.${contactId}.isActive`}
                      trigger="update"
                      destinationModules={['ContactEngine']}
                      value={contact.isActive !== false}
                      onChange={(value) => handleContactUpdate('isActive', value)}
                      contextType="contact"
                      urgencyScore={4}
                      description="Contact active status"
                    />
                  </Box>

                  {/* Division Dropdown - Only show if company has divisions */}
                  {selectedCompany && selectedCompany.divisions && selectedCompany.divisions.length > 0 && (
                    <FormControl fullWidth size="small">
                      <InputLabel>Division</InputLabel>
                      <Select
                        value={selectedDivision}
                        label="Division"
                        onChange={(e) => handleDivisionSelect(e.target.value)}
                      >
                        <MenuItem value="">
                          <em>No division</em>
                        </MenuItem>
                        {selectedCompany.divisions.map((division: string) => (
                          <MenuItem key={division} value={division}>
                            {division}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  )}

                  {/* Location Dropdown - Only show if company has locations */}
                  {selectedCompany && companyLocations.length > 0 && (
                    <FormControl fullWidth size="small">
                      <InputLabel>Location</InputLabel>
                      <Select
                        value={selectedLocation}
                        label="Location"
                        onChange={(e) => handleLocationSelect(e.target.value)}
                      >
                        <MenuItem value="">
                          <em>No location</em>
                        </MenuItem>
                        {getFilteredLocations().map((location) => (
                          <MenuItem key={location.id} value={location.id}>
                            {location.name} - {location.address}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  )}
                </Box>
              </CardContent>
            </Card>
          </Grid>

          {/* Associations */}
          <Grid item xs={12} md={6}>
            <Card>
              <CardHeader 
                title="Associations" 
                action={
                  shouldShowFixAssociationsButton() ? (
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={handleFixAssociations}
                      disabled={fixingAssociations}
                    >
                      {fixingAssociations ? 'Fixing...' : 'Fix Associations'}
                    </Button>
                  ) : null
                }
                sx={{
                  '& .MuiCardHeader-action': {
                    marginRight: 0
                  }
                }}
              />
              <CardContent>
                <SimpleAssociationsCard
                  entityType="contact"
                  entityId={contact.id}
                  entityName={contact.fullName || `${contact.firstName} ${contact.lastName}`}
                  tenantId={tenantId}
                  showAssociations={{
                    companies: true,
                    locations: true,
                    deals: true,
                    salespeople: true,
                    contacts: false, // Don't show contacts for contacts
                    tasks: false
                  }}
                  customLabels={{
                    companies: "Company",
                    locations: "Work Location",
                    deals: "Opportunities",
                    salespeople: "Account Managers"
                  }}
                  onAssociationChange={(type, action, entityId) => {
                    console.log(`${action} ${type} association: ${entityId}`);
                    // Reload associations after change
                    loadAssociations();
                  }}
                  onError={(error) => {
                    console.error('Association error:', error);
                  }}
                  // Pass cached data to prevent reloading
                  cachedAssociations={associationsData.associations}
                  cachedEntities={associationsData.entities}
                  isLoading={associationsData.loading}
                  error={associationsData.error}
                />
              </CardContent>
            </Card>
          </Grid>

          {/* AI Insights */}
          <Grid item xs={12}>
            <Grid container spacing={3}>
              {/* Professional Summary with AI Notes */}
              <Grid item xs={12} md={6}>
                <Card>
                  <CardHeader title="Professional Summary" />
                  <CardContent>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                      {contact?.professionalSummary || 'No professional summary available. Use AI Enhance to generate one.'}
                    </Typography>
                    
                    {contact?.notes && (
                      <Box sx={{ mt: 2 }}>
                        <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                          AI Notes
                        </Typography>
                        <Box 
                          sx={{ 
                            p: 2, 
                            bgcolor: 'grey.50', 
                            borderRadius: 1,
                            border: '1px solid',
                            borderColor: 'grey.200'
                          }}
                          dangerouslySetInnerHTML={{ __html: contact.notes }}
                        />
                      </Box>
                    )}
                  </CardContent>
                </Card>
              </Grid>

              {/* AI Insights */}
              <Grid item xs={12} md={6}>
                <Card>
                  <CardHeader title="AI Insights" />
                  <CardContent>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <Box>
                        <Typography variant="subtitle2" color="text.secondary">Seniority Level</Typography>
                        <Typography variant="body2">
                          {contact?.inferredSeniority || 'Not determined'}
                        </Typography>
                      </Box>
                      <Box>
                        <Typography variant="subtitle2" color="text.secondary">Industry</Typography>
                        <Typography variant="body2">
                          {contact?.inferredIndustry || 'Not determined'}
                        </Typography>
                      </Box>
                      <Box>
                        <Typography variant="subtitle2" color="text.secondary">Influence Level</Typography>
                        <Typography variant="body2">
                          {contact?.influenceLevel || 'Not determined'}
                        </Typography>
                      </Box>
                      <Box>
                        <Typography variant="subtitle2" color="text.secondary">Communication Style</Typography>
                        <Typography variant="body2">
                          {contact?.communicationStyle || 'Not determined'}
                        </Typography>
                      </Box>
                    </Box>
                  </CardContent>
                </Card>
              </Grid>

              {/* Key Skills */}
              <Grid item xs={12} md={6}>
                <Card>
                  <CardHeader title="Key Skills" />
                  <CardContent>
                    {contact?.keySkills && contact.keySkills.length > 0 ? (
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                        {contact.keySkills.map((skill: string, index: number) => (
                          <Chip key={index} label={skill} size="small" variant="outlined" />
                        ))}
                      </Box>
                    ) : (
                      <Typography color="text.secondary">No skills identified. Use AI Enhance to discover skills.</Typography>
                    )}
                  </CardContent>
                </Card>
              </Grid>

              {/* Professional Interests */}
              <Grid item xs={12} md={6}>
                <Card>
                  <CardHeader title="Professional Interests" />
                  <CardContent>
                    {contact?.professionalInterests && contact.professionalInterests.length > 0 ? (
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                        {contact.professionalInterests.map((interest: string, index: number) => (
                          <Chip key={index} label={interest} size="small" variant="outlined" color="primary" />
                        ))}
                      </Box>
                    ) : (
                      <Typography color="text.secondary">No interests identified. Use AI Enhance to discover interests.</Typography>
                    )}
                  </CardContent>
                </Card>
              </Grid>

              {/* Social Profiles */}
              <Grid item xs={12} md={6}>
                <Card>
                  <CardHeader title="Social Profiles" />
                  <CardContent>
                    {contact?.socialProfiles && contact.socialProfiles.length > 0 ? (
                      <List dense>
                        {contact.socialProfiles.map((profile: any, index: number) => (
                          <ListItem key={index}>
                            <ListItemIcon>
                              {profile.platform === 'LinkedIn' && <LinkedInIcon />}
                              {profile.platform === 'Twitter' && <TwitterIcon />}
                              {profile.platform === 'Facebook' && <FacebookIcon />}
                              {profile.platform === 'Instagram' && <InstagramIcon />}
                            </ListItemIcon>
                            <ListItemText
                              primary={profile.platform}
                              secondary={
                                <a href={profile.url} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit' }}>
                                  {profile.title}
                                </a>
                              }
                            />
                          </ListItem>
                        ))}
                      </List>
                    ) : (
                      <Typography color="text.secondary">No social profiles found. Use AI Enhance to discover profiles.</Typography>
                    )}
                  </CardContent>
                </Card>
              </Grid>

              {/* News Mentions */}
              <Grid item xs={12} md={6}>
                <Card>
                  <CardHeader title="Recent News Mentions" />
                  <CardContent>
                    {contact?.newsMentions && contact.newsMentions.length > 0 ? (
                      <List dense>
                        {contact.newsMentions.slice(0, 3).map((news: any, index: number) => (
                          <ListItem key={index}>
                            <ListItemText
                              primary={
                                <a href={news.link} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit' }}>
                                  {news.title}
                                </a>
                              }
                              secondary={news.snippet}
                            />
                          </ListItem>
                        ))}
                      </List>
                    ) : (
                      <Typography color="text.secondary">No recent news mentions found. Use AI Enhance to discover mentions.</Typography>
                    )}
                  </CardContent>
                </Card>
              </Grid>

              {/* Contact Recommendations */}
              <Grid item xs={12}>
                <Card>
                  <CardHeader title="Contact Recommendations" />
                  <CardContent>
                    <Grid container spacing={2}>
                      <Grid item xs={12} md={6}>
                        <Box>
                          <Typography variant="subtitle2" color="text.secondary">Recommended Approach</Typography>
                          <Typography variant="body2">
                            {contact?.recommendedApproach || 'No recommendations available. Use AI Enhance to get personalized contact strategies.'}
                          </Typography>
                        </Box>
                      </Grid>
                      <Grid item xs={12} md={6}>
                        <Box>
                          <Typography variant="subtitle2" color="text.secondary">Potential Pain Points</Typography>
                          <Typography variant="body2">
                            {contact?.potentialPainPoints && contact.potentialPainPoints.length > 0 
                              ? contact.potentialPainPoints.join(', ')
                              : 'No pain points identified. Use AI Enhance to discover potential challenges.'}
                          </Typography>
                        </Box>
                      </Grid>
                      <Grid item xs={12} md={6}>
                        <Box>
                          <Typography variant="subtitle2" color="text.secondary">Networking Opportunities</Typography>
                          <Typography variant="body2">
                            {contact?.networkingOpportunities && contact.networkingOpportunities.length > 0 
                              ? contact.networkingOpportunities.join(', ')
                              : 'No networking opportunities identified. Use AI Enhance to discover connection points.'}
                          </Typography>
                        </Box>
                      </Grid>
                    </Grid>
                  </CardContent>
                </Card>
              </Grid>

              {/* Tone Settings */}
              <Grid item xs={12}>
                <Card>
                  <CardHeader 
                    title="Communication Tone Settings" 
                    subheader="Customize how AI communicates with this contact based on their communication style and preferences"
                  />
                  <CardContent>
                    <Grid container spacing={3}>
                      {/* Tone Balance */}
                      <Grid item xs={12} md={8}>
                        <Typography variant="h6" gutterBottom>Contact-Specific Tone</Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                          Adjust the tone characteristics for AI communications with this contact. The AI will blend these to create the most effective communication style.
                        </Typography>
                        
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                          <Box>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                              <Typography variant="body2">Professional</Typography>
                              <Typography variant="body2" color="primary">{toneSettings.professional}</Typography>
                            </Box>
                            <LoggableSlider
                              fieldPath={`tenants:${tenantId}.crm_contacts.${contactId}.toneSettings.professional`}
                              trigger="update"
                              destinationModules={['ToneEngine']}
                              value={toneSettings.professional}
                              onChange={handleProfessionalTone}
                              min={0}
                              max={1}
                              step={0.1}
                              label="Professional"
                              contextType="contact"
                              urgencyScore={4}
                              description="Contact professional tone setting"
                            />
                          </Box>
                          
                          <Box>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                              <Typography variant="body2">Friendly</Typography>
                              <Typography variant="body2" color="primary">{toneSettings.friendly}</Typography>
                            </Box>
                            <LoggableSlider
                              fieldPath={`tenants:${tenantId}.crm_contacts.${contactId}.toneSettings.friendly`}
                              trigger="update"
                              destinationModules={['ToneEngine']}
                              value={toneSettings.friendly}
                              onChange={handleFriendlyTone}
                              min={0}
                              max={1}
                              step={0.1}
                              label="Friendly"
                              contextType="contact"
                              urgencyScore={4}
                              description="Contact friendly tone setting"
                            />
                          </Box>
                          
                          <Box>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                              <Typography variant="body2">Encouraging</Typography>
                              <Typography variant="body2" color="primary">{toneSettings.encouraging}</Typography>
                            </Box>
                            <LoggableSlider
                              fieldPath={`tenants:${tenantId}.crm_contacts.${contactId}.toneSettings.encouraging`}
                              trigger="update"
                              destinationModules={['ToneEngine']}
                              value={toneSettings.encouraging}
                              onChange={handleEncouragingTone}
                              min={0}
                              max={1}
                              step={0.1}
                              label="Encouraging"
                              contextType="contact"
                              urgencyScore={4}
                              description="Contact encouraging tone setting"
                            />
                          </Box>
                          
                          <Box>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                              <Typography variant="body2">Direct</Typography>
                              <Typography variant="body2" color="primary">{toneSettings.direct}</Typography>
                            </Box>
                            <LoggableSlider
                              fieldPath={`tenants:${tenantId}.crm_contacts.${contactId}.toneSettings.direct`}
                              trigger="update"
                              destinationModules={['ToneEngine']}
                              value={toneSettings.direct}
                              onChange={handleDirectTone}
                              min={0}
                              max={1}
                              step={0.1}
                              label="Direct"
                              contextType="contact"
                              urgencyScore={4}
                              description="Contact direct tone setting"
                            />
                          </Box>
                          
                          <Box>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                              <Typography variant="body2">Empathetic</Typography>
                              <Typography variant="body2" color="primary">{toneSettings.empathetic}</Typography>
                            </Box>
                            <LoggableSlider
                              fieldPath={`tenants:${tenantId}.crm_contacts.${contactId}.toneSettings.empathetic`}
                              trigger="update"
                              destinationModules={['ToneEngine']}
                              value={toneSettings.empathetic}
                              onChange={handleEmpatheticTone}
                              min={0}
                              max={1}
                              step={0.1}
                              label="Empathetic"
                              contextType="contact"
                              urgencyScore={4}
                              description="Contact empathetic tone setting"
                            />
                          </Box>
                        </Box>
                      </Grid>

                      {/* Tone Preview */}
                      <Grid item xs={12} md={4}>
                        <Typography variant="h6" gutterBottom>AI Communication Preview</Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                          Based on your settings, the AI will prioritize:
                        </Typography>
                        
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mb: 3 }}>
                          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Typography variant="body2">Encouraging</Typography>
                            <Typography variant="body2" color="primary" fontWeight="bold">
                              {Math.round(toneSettings.encouraging * 100)}%
                            </Typography>
                          </Box>
                          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Typography variant="body2">Professional</Typography>
                            <Typography variant="body2" color="primary" fontWeight="bold">
                              {Math.round(toneSettings.professional * 100)}%
                            </Typography>
                          </Box>
                          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Typography variant="body2">Empathetic</Typography>
                            <Typography variant="body2" color="primary" fontWeight="bold">
                              {Math.round(toneSettings.empathetic * 100)}%
                            </Typography>
                          </Box>
                          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Typography variant="body2">Friendly</Typography>
                            <Typography variant="body2" color="primary" fontWeight="bold">
                              {Math.round(toneSettings.friendly * 100)}%
                            </Typography>
                          </Box>
                          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Typography variant="body2">Direct</Typography>
                            <Typography variant="body2" color="primary" fontWeight="bold">
                              {Math.round(toneSettings.direct * 100)}%
                            </Typography>
                          </Box>
                        </Box>
                        
                        <Box sx={{ p: 2, bgcolor: 'grey.50', borderRadius: 1, mb: 2 }}>
                          <Typography variant="subtitle2" gutterBottom>Communication Style</Typography>
                          <Typography variant="body2" color="text.secondary">
                            {toneSettings.professional > 0.7 && toneSettings.encouraging > 0.7 
                              ? "The AI will maintain a highly professional and encouraging tone, perfect for senior executives and decision-makers."
                              : toneSettings.friendly > 0.7 && toneSettings.empathetic > 0.7
                              ? "The AI will use a warm, friendly, and empathetic approach, ideal for building relationships and trust."
                              : toneSettings.direct > 0.7
                              ? "The AI will be direct and to-the-point, focusing on efficiency and clear communication."
                              : "The AI will balance professionalism with approachability, adapting to the contact's communication preferences."}
                          </Typography>
                        </Box>
                        
                        <Box sx={{ display: 'flex', gap: 1 }}>
                          <Button
                            variant="outlined"
                            size="small"
                            startIcon={<AutoAwesomeIcon />}
                            onClick={handleAutoAdjustTone}
                          >
                            Auto-Adjust
                          </Button>
                          <Button
                            variant="contained"
                            size="small"
                            startIcon={<SaveIcon />}
                            onClick={handleSaveToneSettings}
                          >
                            Save Settings
                          </Button>
                        </Box>
                      </Grid>
                    </Grid>
                  </CardContent>
                </Card>
              </Grid>
            </Grid>
          </Grid>
        </Grid>
      </TabPanel>

      <TabPanel value={tabValue} index={2}>
        {contact && (
          <CRMNotesTab
            entityId={contact.id}
            entityType="contact"
            entityName={contact.fullName || contact.firstName || contact.lastName || 'Contact'}
            tenantId={tenantId}
          />
        )}
      </TabPanel>

      <TabPanel value={tabValue} index={1}>
        {contact && (
          <ContactTasksDashboard
            contactId={contact.id}
            tenantId={tenantId}
            contact={contact}
          />
        )}
      </TabPanel>

      <TabPanel value={tabValue} index={3}>
        <ActivityLogTab
          entityId={contactId}
          entityType="contact"
          entityName={contact.fullName || contact.firstName || contact.lastName || 'Contact'}
          tenantId={tenantId}
        />
      </TabPanel>

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
            Are you sure you want to delete this contact? This action cannot be undone.
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

      {/* Email Selection Dialog */}
      <Dialog open={showEmailDialog} onClose={() => setShowEmailDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Select Email Address</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Multiple email addresses found. Select the one you'd like to use:
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {emailOptions.map((option, index) => (
              <Button
                key={index}
                variant={option.isPrimary ? "contained" : "outlined"}
                onClick={() => handleSelectEmail(option.email)}
                sx={{ justifyContent: 'space-between', textAlign: 'left' }}
                startIcon={option.isPrimary ? <EmailIcon /> : null}
              >
                <Box>
                  <Typography variant="body2" fontWeight="medium">
                    {option.email}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {option.confidence}% confidence
                    {option.isPrimary && ' (Recommended)'}
                  </Typography>
                </Box>
              </Button>
            ))}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowEmailDialog(false)}>Cancel</Button>
        </DialogActions>
      </Dialog>

      {/* Toast Notifications */}
      <Snackbar
        open={snackbarOpen}
        autoHideDuration={6000}
        onClose={() => setSnackbarOpen(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert 
          onClose={() => setSnackbarOpen(false)} 
          severity={snackbarSeverity}
          sx={{ width: '100%' }}
        >
          {snackbarMessage}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default ContactDetails; 