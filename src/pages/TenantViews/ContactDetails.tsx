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
  Breadcrumbs,
  Link as MUILink,
  Skeleton,
  TableContainer,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
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
  Business as BusinessIcon,
  SmartToy as AIIcon,
  Timeline as TimelineIcon,
  Dashboard as DashboardIcon,
  Add as AddIcon,
  CheckCircle as CheckCircleIcon,
  RocketLaunch as RocketLaunchIcon,
} from '@mui/icons-material';
import { doc, getDoc, updateDoc, collection, getDocs, deleteDoc, query, where, orderBy, limit } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { getFunctions, httpsCallable } from 'firebase/functions';

import { db, storage , functions } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import CRMNotesTab from '../../components/CRMNotesTab';
import SimpleAssociationsCard from '../../components/SimpleAssociationsCard';
import ActivityLogTab from '../../components/ActivityLogTab';
import TasksDashboard from '../../components/TasksDashboard';
import AppointmentsDashboard from '../../components/AppointmentsDashboard';
import { LoggableSlider, LoggableTextField, LoggableSwitch } from '../../components/LoggableField';
import ContactOpportunitiesTab from '../../components/ContactOpportunitiesTab';
import AIAssistantChat from '../../components/AIAssistantChat';
import ContactActivityTab from '../../components/ContactActivityTab';
import SalesCoach from '../../components/SalesCoach';
import CreateTaskDialog from '../../components/CreateTaskDialog';
import { TaskService } from '../../utils/taskService';
import LogActivityDialog from '../../components/LogActivityDialog';

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
  activeSalespeople?: {
    id: string;
    displayName?: string;
    firstName?: string;
    lastName?: string;
    email?: string;
    jobTitle?: string;
    department?: string;
    lastActiveAt?: number;
  }[];
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
  const taskService = TaskService.getInstance();
  
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
  // Company and location are managed via associations; no local pickers
  const [companyLocations, setCompanyLocations] = useState<any[]>([]);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [fixingAssociations, setFixingAssociations] = useState(false);

  // Contact info finding state
  const [findingContactInfo, setFindingContactInfo] = useState(false);
  const [emailOptions, setEmailOptions] = useState<any[]>([]);
  const [showEmailDialog, setShowEmailDialog] = useState(false);
  const [showTaskDialog, setShowTaskDialog] = useState(false);
  const [showAppointmentDialog, setShowAppointmentDialog] = useState(false);
  const [showLogActivityDialog, setShowLogActivityDialog] = useState(false);
  const [logActivityLoading, setLogActivityLoading] = useState(false);
  
  // Salespeople state
  const [salespeople, setSalespeople] = useState<any[]>([]);
  
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

  // Dashboard state
  const [rebuildingActive, setRebuildingActive] = useState(false);
  const [localSuccess, setLocalSuccess] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [aiComponentsLoaded, setAiComponentsLoaded] = useState(false);
  
  // Recent Activity state
  const [recentActivities, setRecentActivities] = useState<any[]>([]);
  const [loadingActivities, setLoadingActivities] = useState(false);

  // Lazy load AI components
  useEffect(() => {
    const timer = setTimeout(() => {
      setAiComponentsLoaded(true);
    }, 1000);
    return () => clearTimeout(timer);
  }, []);

  // Helper function to show toast notifications
  const showToast = (message: string, severity: 'success' | 'error' | 'info' | 'warning' = 'info') => {
    setSnackbarMessage(message);
    setSnackbarSeverity(severity);
    setSnackbarOpen(true);
  };

  // Calculate contact metrics
  const calculateContactMetrics = () => {
    const associatedDeals = associationsData.entities.deals || [];
    const associatedTasks = associationsData.entities.tasks || [];
    
    const totalDealValue = associatedDeals.reduce((sum: number, deal: any) => {
      return sum + (deal.expectedRevenue || 0);
    }, 0);
    
    const activeDeals = associatedDeals.filter((deal: any) => 
      deal.stage !== 'closed_won' && deal.stage !== 'closed_lost'
    ).length;
    
    const completedTasks = associatedTasks.filter((task: any) => 
      task.status === 'completed'
    ).length;
    
    return {
      totalDealValue: totalDealValue.toLocaleString('en-US', { style: 'currency', currency: 'USD' }),
      activeDeals,
      completedTasks,
      totalTasks: associatedTasks.length
    };
  };

  // Generate contact insights
  const generateContactInsights = () => {
    const insights = [];
    const associatedDeals = associationsData.entities.deals || [];
    const associatedTasks = associationsData.entities.tasks || [];
    
    // Deal value analysis
    const totalDealValue = associatedDeals.reduce((sum: number, deal: any) => sum + (deal.expectedRevenue || 0), 0);
    if (totalDealValue > 100000) {
      insights.push({ type: 'success', message: 'High-value contact with significant deal potential' });
    } else if (totalDealValue > 50000) {
      insights.push({ type: 'info', message: 'Medium-value contact with good growth potential' });
    } else if (totalDealValue === 0) {
      insights.push({ type: 'warning', message: 'No associated deals - consider engagement opportunities' });
    }
    
    // Task completion analysis
    const completedTasks = associatedTasks.filter((task: any) => task.status === 'completed').length;
    if (completedTasks > 5) {
      insights.push({ type: 'success', message: 'High engagement - active task completion' });
    } else if (completedTasks === 0 && associatedTasks.length > 0) {
      insights.push({ type: 'warning', message: 'Low task completion - follow-up needed' });
    }
    
    // Contact type analysis
    if (contact?.contactType === 'Decision Maker') {
      insights.push({ type: 'success', message: 'Decision maker identified - high priority contact' });
    } else if (contact?.contactType === 'Unknown') {
      insights.push({ type: 'info', message: 'Contact type not determined - consider classification' });
    }
    
    return insights;
  };

  const metrics = calculateContactMetrics();
  const insights = generateContactInsights();

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
      setAvatarLoading(true);
      
      // For LinkedIn profiles, we need to use a backend service to fetch the profile image
      // due to CORS restrictions and authentication requirements
      if (profileUrl.includes('linkedin.com/in/')) {
        const { httpsCallable } = await import('firebase/functions');
        const { functions } = await import('../../firebase');
        
        const generateProfessionalAvatar = httpsCallable(functions, 'fetchLinkedInAvatar');
        
        const result = await generateProfessionalAvatar({
          profileUrl: profileUrl,
          contactId: contactId,
          tenantId: tenantId
        });
        
        const resultData = result.data as any;
        
        if (resultData.success && resultData.avatarUrl) {
          // Update the contact's avatar in Firestore
          await handleContactUpdate('avatar', resultData.avatarUrl);
          showToast('Avatar updated from LinkedIn profile!', 'success');
        } else {
          showToast('Could not fetch LinkedIn avatar', 'warning');
        }
      } else {
        // For other social platforms, we could implement similar logic
        showToast('Avatar update for this platform not yet implemented', 'info');
      }
    } catch (err) {
      console.error('Error updating avatar from social profile:', err);
      showToast('Failed to update avatar from social profile', 'error');
    } finally {
      setAvatarLoading(false);
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
      const { createUnifiedAssociationService } = await import('../../utils/unifiedAssociationService');
      const associationService = createUnifiedAssociationService(tenantId, user.uid);
      
      const result = await associationService.getEntityAssociations('contact', contactId);
      
      // Fallback: Query deals that reference this contact
      let fallbackDeals: any[] = [];
      try {
        const dealsQuery = query(
          collection(db, 'tenants', tenantId, 'crm_deals'),
          where('contactIds', 'array-contains', contactId)
        );
        const dealsSnapshot = await getDocs(dealsQuery);
        fallbackDeals = dealsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        console.log('Fallback deals found:', fallbackDeals.length);
      } catch (fallbackErr) {
        console.warn('Fallback deals query failed:', fallbackErr);
      }
      
      // Merge fallback deals with existing deals
      const allDeals = [...(result.entities.deals || []), ...fallbackDeals];
      const uniqueDeals = allDeals.filter((deal, index, self) => 
        index === self.findIndex(d => d.id === deal.id)
      );
      
      setAssociationsData({
        associations: {},
        entities: {
          ...result.entities,
          deals: uniqueDeals
        },
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

  // Load salespeople (users with crm_sales: true)
  const loadSalespeople = async () => {
    try {
      const qUsers = query(collection(db, 'users'), where('crm_sales', '==', true));
      const snap = await getDocs(qUsers as any);
      const list = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
      setSalespeople(list);
    } catch (e) {
      console.warn('Failed to load salespeople:', e);
      setSalespeople([]);
    }
  };

  // Load recent activities for the contact
  const loadRecentActivities = async () => {
    if (!contactId || !tenantId) return;
    
    setLoadingActivities(true);
    try {
      const activities: any[] = [];
      
      // Load completed tasks
      try {
        const tasksQuery = query(
          collection(db, 'tenants', tenantId, 'tasks'),
          where('associations.contacts', 'array-contains', contactId),
          where('status', '==', 'completed'),
          orderBy('completedAt', 'desc'),
          limit(5)
        );
        const tasksSnapshot = await getDocs(tasksQuery);
        tasksSnapshot.docs.forEach(doc => {
          const data = doc.data();
          activities.push({
            id: doc.id,
            type: 'task',
            title: data.title || 'Task completed',
            description: data.description || '',
            timestamp: data.completedAt?.toDate?.() || data.updatedAt?.toDate?.() || new Date(),
            salespersonId: data.assignedTo || data.createdBy,
            icon: 'task',
            status: 'completed'
          });
        });
      } catch (e) {
        console.warn('Failed to load tasks:', e);
      }
      
      // Load email logs
      try {
        const emailsQuery = query(
          collection(db, 'tenants', tenantId, 'email_logs'),
          where('contactId', '==', contactId),
          orderBy('timestamp', 'desc'),
          limit(5)
        );
        const emailsSnapshot = await getDocs(emailsQuery);
        emailsSnapshot.docs.forEach(doc => {
          const data = doc.data();
          activities.push({
            id: doc.id,
            type: 'email',
            title: data.subject || 'Email sent',
            description: data.snippet || '',
            timestamp: data.timestamp?.toDate?.() || data.sentAt?.toDate?.() || new Date(),
            salespersonId: data.userId || data.salespersonId,
            icon: 'email',
            direction: data.direction || 'sent'
          });
        });
      } catch (e) {
        console.warn('Failed to load emails:', e);
      }
      
      // Load notes
      try {
        const notesQuery = query(
          collection(db, 'tenants', tenantId, 'contact_notes'),
          where('contactId', '==', contactId),
          orderBy('createdAt', 'desc'),
          limit(5)
        );
        const notesSnapshot = await getDocs(notesQuery);
        notesSnapshot.docs.forEach(doc => {
          const data = doc.data();
          activities.push({
            id: doc.id,
            type: 'note',
            title: 'Note added',
            description: data.content || '',
            timestamp: data.createdAt?.toDate?.() || data.updatedAt?.toDate?.() || new Date(),
            salespersonId: data.createdBy || data.userId,
            icon: 'note'
          });
        });
      } catch (e) {
        console.warn('Failed to load notes:', e);
      }
      
      // Load AI activities - Commented out due to permissions issues
      // AI logs are typically accessed through Cloud Functions, not direct queries
      /*
      try {
        const aiQuery = query(
          collection(db, 'tenants', tenantId, 'ai_logs'),
          where('entityId', '==', contactId),
          where('entityType', '==', 'contact'),
          orderBy('timestamp', 'desc'),
          limit(5)
        );
        const aiSnapshot = await getDocs(aiQuery);
        aiSnapshot.docs.forEach(doc => {
          const data = doc.data();
          activities.push({
            id: doc.id,
            type: 'ai',
            title: data.action || 'AI Activity',
            description: data.reason || '',
            timestamp: data.timestamp?.toDate?.() || new Date(),
            salespersonId: data.userId,
            icon: 'ai'
          });
        });
      } catch (e) {
        console.warn('Failed to load AI activities:', e);
      }
      */
      
      // Sort all activities by timestamp (most recent first) and take top 8
      const sortedActivities = activities
        .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
        .slice(0, 8);
      
      setRecentActivities(sortedActivities);
    } catch (err) {
      console.error('Error loading recent activities:', err);
      setRecentActivities([]);
    } finally {
      setLoadingActivities(false);
    }
  };

  // Handle location association update
  const handleLocationAssociationUpdate = async (locationId: string) => {
    if (!contactId || !tenantId || !contact || !user?.uid) return;

    try {
      // Get the location data
      const assocCompanies = (contact.associations?.companies || []) as any[];
      let primaryCompanyId = assocCompanies.length > 0 ? (typeof assocCompanies[0] === 'string' ? assocCompanies[0] : assocCompanies[0]?.id) : undefined;
      
      // Fallback to legacy companyId if no associations found
      if (!primaryCompanyId && contact.companyId) {
        primaryCompanyId = contact.companyId;
      }
      
      if (!primaryCompanyId) {
        showToast('No associated company found', 'error');
        return;
      }

      // Find the location in companyLocations
      const selectedLocation = companyLocations.find(loc => loc.id === locationId);
      if (!selectedLocation) {
        showToast('Location not found', 'error');
        return;
      }

      // Update associations with the new location
      const currentAssociations = contact.associations || {};
      const updatedAssociations = {
        ...currentAssociations,
        locations: [selectedLocation.id]
      };

      // Update the contact document with both new and legacy formats
      await updateDoc(doc(db, 'tenants', tenantId, 'crm_contacts', contactId), {
        associations: updatedAssociations,
        locationId: selectedLocation.id, // Legacy format
        locationName: selectedLocation.name || selectedLocation.nickname || 'Unknown Location', // Legacy format
        updatedAt: new Date()
      });

      // Update local state with both new and legacy formats
      setContact(prev => prev ? { 
        ...prev, 
        associations: updatedAssociations,
        locationId: selectedLocation.id, // Legacy format
        locationName: selectedLocation.name || selectedLocation.nickname || 'Unknown Location' // Legacy format
      } : null);
      
      // Log the activity
      try {
        const functions = getFunctions();
        const logAIActionCallable = httpsCallable(functions, 'logAIActionCallable');
        await logAIActionCallable({
          action: 'contact_location_updated',
          entityId: contactId,
          entityType: 'contact',
          reason: `Updated work location to: ${selectedLocation.name || selectedLocation.nickname}`,
          tenantId,
          userId: user.uid,
          metadata: { locationId, locationName: selectedLocation.name || selectedLocation.nickname }
        });
      } catch (logError) {
        console.warn('Failed to log activity:', logError);
      }

      showToast(`Work location updated to: ${selectedLocation.name || selectedLocation.nickname}`, 'success');
    } catch (err) {
      console.error('Error updating location association:', err);
      showToast('Failed to update work location', 'error');
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

      // Load associated company via associations.companies if present, or fallback to legacy companyId
      const assocCompanies = (contactData.associations?.companies || []) as any[];
      let primaryCompanyId = assocCompanies.length > 0 ? (typeof assocCompanies[0] === 'string' ? assocCompanies[0] : assocCompanies[0]?.id) : undefined;
      
      // Fallback to legacy companyId if no associations found
      if (!primaryCompanyId && contactData.companyId) {
        primaryCompanyId = contactData.companyId;
      }
      
      if (primaryCompanyId) {
        const companyDoc = await getDoc(doc(db, 'tenants', tenantId, 'crm_companies', primaryCompanyId));
        if (companyDoc.exists()) {
          const companyData = { id: companyDoc.id, ...companyDoc.data() };
          setCompany(companyData);
          await loadCompanyLocations(primaryCompanyId);
        }
      }

      // Load activities (you can implement this based on your activity tracking system)
      setActivities([]);

      // Removed legacy company picker load (associations are the source of truth)
      
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
    loadSalespeople();
    loadRecentActivities();
  }, [contactId, tenantId]);

  const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
  };

  // Removed legacy company picker load; company should be managed via associations only

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

  // No local division/location pickers; associations are the single source of truth

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
      
      // Migrate legacy companyId to associations.companies if not already present
      if (contact.companyId && (!associations.companies || associations.companies.length === 0)) {
        associations.companies = [contact.companyId];
        fixedCount++;
      }
      
      // Migrate legacy locationId to associations.locations if not already present
      if (contact.locationId && (!associations.locations || associations.locations.length === 0)) {
        associations.locations = [contact.locationId];
        fixedCount++;
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
        
        // Reload associations to reflect changes
        await loadAssociations();
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
        
        // Update LinkedIn URL and avatar if social profiles are found
        if (enhancedContactData?.socialProfiles && enhancedContactData.socialProfiles.length > 0) {
          const linkedInProfile = enhancedContactData.socialProfiles.find((profile: any) => profile.platform === 'LinkedIn');
          if (linkedInProfile) {
            // Update LinkedIn URL if not already set
            if (!contact.linkedInUrl && linkedInProfile.url) {
              await handleContactUpdate('linkedInUrl', linkedInProfile.url);
            }
            
            // Update avatar if no avatar exists
            if (!contact.avatar) {
              await updateAvatarFromSocialProfile(linkedInProfile.url);
            }
          }
        }
        
        setAiSuccess('Contact enhanced successfully with AI! Found social profiles, company information, and professional insights. LinkedIn URL and avatar updated.');
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

  // Get activity icon based on type
  const getActivityIcon = (iconType: string) => {
    switch (iconType) {
      case 'task':
        return <TaskIcon sx={{ fontSize: 16 }} />;
      case 'email':
        return <EmailIcon sx={{ fontSize: 16 }} />;
      case 'note':
        return <NotesIcon sx={{ fontSize: 16 }} />;
      case 'ai':
        return <AIIcon sx={{ fontSize: 16 }} />;
      default:
        return <InfoIcon sx={{ fontSize: 16 }} />;
    }
  };

  // Format timestamp for display
  const formatActivityTime = (timestamp: Date) => {
    const now = new Date();
    const diffMs = now.getTime() - timestamp.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return timestamp.toLocaleDateString();
  };

  // Check if Fix Associations button should be shown
  const shouldShowFixAssociationsButton = () => false;

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

  // Log Activity Handler
  const handleLogActivity = async (taskData: any) => {
    setLogActivityLoading(true);
    try {
      // Import TaskService dynamically to avoid circular dependencies
      const { TaskService } = await import('../../utils/taskService');
      const taskService = TaskService.getInstance();
      
      // Create the task as completed
      await taskService.createTask({
        ...taskData,
        tenantId,
        status: 'completed',
        completedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
      });
      
      setShowLogActivityDialog(false);
      // Optionally refresh any task-related data
      console.log('Activity logged successfully:', taskData);
      showToast('Activity logged successfully', 'success');
    } catch (error) {
      console.error('Error logging activity:', error);
      showToast('Failed to log activity', 'error');
    } finally {
      setLogActivityLoading(false);
    }
  };

  return (
    <Box sx={{ p: 0 }}>
      {/* Breadcrumbs */}
      <Box sx={{ mb: 2 }}>
        <Breadcrumbs aria-label="breadcrumb">
          <MUILink underline="hover" color="inherit" href="/contacts" onClick={(e) => { e.preventDefault(); navigate('/crm?tab=contacts'); }}>
            Contacts
          </MUILink>
          <Typography color="text.primary">{contact.fullName || `${contact.firstName || ''} ${contact.lastName || ''}` || 'Contact'}</Typography>
        </Breadcrumbs>
      </Box>
      {/* Header */}
      <Box sx={{ mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 3 }}>
            {/* Contact Avatar */}
            <Box sx={{ position: 'relative' }}>
              <Avatar
                src={contact.avatar}
                sx={{ 
                  width: 128, 
                  height: 128,
                  bgcolor: contact.avatar ? 'transparent' : 'primary.main',
                  fontSize: '2.5rem',
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
                      bgcolor: 'grey.300',
                      color: 'grey.700',
                      '&:hover': {
                        bgcolor: 'grey.400'
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
                      bgcolor: 'grey.300',
                      color: 'grey.700',
                      '&:hover': {
                        bgcolor: 'grey.400'
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

              {/* Company and Location Links (associations are source of truth) */}
              {company && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0 }}>
                  <BusinessIcon fontSize="small" color="primary" />
                  <Typography 
                    variant="body2" 
                    color="primary"
                    sx={{ cursor: 'pointer', textDecoration: 'underline', '&:hover': { color: 'primary.dark' } }}
                    onClick={() => navigate(`/crm/companies/${company.id}`)}
                  >
                    {company.companyName || company.name}
                  </Typography>
                  {(() => {
                    // Check new associations format first
                    if (Array.isArray(contact.associations?.locations) && contact.associations.locations.length > 0) {
                      const locationId = contact.associations.locations[0];
                      const locationName = companyLocations.find((l: any) => l.id === locationId)?.name || '';
                      if (locationId && locationName) {
                        return (
                          <>
                            <Typography variant="body2" color="text.secondary">/</Typography>
                            <Typography 
                              variant="body2" 
                              color="primary"
                              sx={{ cursor: 'pointer', textDecoration: 'underline', '&:hover': { color: 'primary.dark' } }}
                              onClick={() => navigate(`/crm/companies/${company.id}/locations/${locationId}`)}
                            >
                              {locationName}
                            </Typography>
                          </>
                        );
                      }
                    }
                    
                    // Fallback to legacy locationId format
                    if (contact.locationId && contact.locationName) {
                      return (
                        <>
                          <Typography variant="body2" color="text.secondary">/</Typography>
                          <Typography 
                            variant="body2" 
                            color="primary"
                            sx={{ cursor: 'pointer', textDecoration: 'underline', '&:hover': { color: 'primary.dark' } }}
                            onClick={() => navigate(`/crm/companies/${company.id}/locations/${contact.locationId}`)}
                          >
                            {contact.locationName}
                          </Typography>
                        </>
                      );
                    }
                    
                    // Fallback to locationId with name from loaded locations
                    if (contact.locationId) {
                      const locationName = companyLocations.find((l: any) => l.id === contact.locationId)?.name || '';
                      if (locationName) {
                        return (
                          <>
                            <Typography variant="body2" color="text.secondary">/</Typography>
                            <Typography 
                              variant="body2" 
                              color="primary"
                              sx={{ cursor: 'pointer', textDecoration: 'underline', '&:hover': { color: 'primary.dark' } }}
                              onClick={() => navigate(`/crm/companies/${company.id}/locations/${contact.locationId}`)}
                            >
                              {locationName}
                            </Typography>
                          </>
                        );
                      }
                    }
                    
                    return null;
                  })()}
                </Box>
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

              {/* Contact Type and Engagement Level */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500 }}>Type:</Typography>
                  <Chip 
                    label={contact?.contactType || 'Unknown'} 
                    color={contact?.contactType === 'Decision Maker' ? 'success' : 
                           contact?.contactType === 'Unknown' ? 'warning' : 'primary'} 
                    size="small" 
                    sx={{ fontWeight: 500 }}
                  />
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500 }}>Engagement:</Typography>
                  <Chip 
                    label={metrics.completedTasks > 5 ? 'High' : metrics.completedTasks > 2 ? 'Medium' : 'Low'} 
                    color={metrics.completedTasks > 5 ? 'success' : metrics.completedTasks > 2 ? 'warning' : 'error'} 
                    size="small" 
                    sx={{ fontWeight: 500 }}
                  />
                </Box>
                {contact?.inferredSeniority && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500 }}>Seniority:</Typography>
                    <Chip 
                      label={contact.inferredSeniority} 
                      color={contact.inferredSeniority === 'C-Level' || contact.inferredSeniority === 'Executive' ? 'success' : 
                             contact.inferredSeniority === 'Senior' ? 'primary' : 
                             contact.inferredSeniority === 'Mid-Level' ? 'warning' : 'default'} 
                      size="small" 
                      sx={{ fontWeight: 500 }}
                    />
                  </Box>
                )}

              </Box>
            </Box>
          </Box>

          {/* Action Buttons */}
          <Box sx={{ display: 'flex', gap: 2 }}>
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
              variant="outlined"
              startIcon={aiEnhancing ? <CircularProgress size={20} color="inherit" /> : <RocketLaunchIcon />}
              onClick={handleAIEnhancement}
              disabled={aiEnhancing}
              sx={{ 
                color: 'purple.600',
                borderColor: 'purple.600',
                '&:hover': {
                  borderColor: 'purple.700',
                  backgroundColor: 'purple.50'
                }
              }}
            >
              {aiEnhancing ? 'Enhancing...' : 'AI Enhance'}
            </Button>
            <Button
              variant="contained"
              startIcon={<CheckCircleIcon />}
              onClick={() => setShowLogActivityDialog(true)}
              sx={{ 
                bgcolor: 'primary.main',
                '&:hover': {
                  bgcolor: 'primary.dark'
                }
              }}
            >
              Log Activity
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
                <DashboardIcon fontSize="small" />
                Dashboard
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
                Activity
              </Box>
            } 
          />
        </Tabs>
      </Paper>

      {/* Tab Panels */}
      <TabPanel value={tabValue} index={0}>
        <Grid container spacing={3}>
          {/* Left Column - Contact Details & Core Info */}
          <Grid item xs={12} md={4}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {/* AI Summary */}
              <Card>
                <CardHeader 
                  title="AI Summary" 
                  titleTypographyProps={{ variant: 'h6', fontWeight: 'bold' }}
                />
                <CardContent sx={{ p: 2 }}>
                  {contact?.notes ? (
                    <Typography variant="body2" color="text.secondary">
                      {contact.notes.replace(/<[^>]*>/g, '')}
                    </Typography>
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      No AI summary available. Use AI Enhance to generate one.
                    </Typography>
                  )}
                </CardContent>
              </Card>

              {/* Contact Details (Combined Widget) */}
              <Card>
                <CardHeader 
                  title="Contact Details" 
                  titleTypographyProps={{ variant: 'h6', fontWeight: 'bold' }}
                />
                <CardContent sx={{ p: 2 }}>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <TextField
                      label="Full Name"
                      defaultValue={contact.fullName || `${contact.firstName || ''} ${contact.lastName || ''}`}
                      onBlur={(e) => {
                        const next = (e.target.value || '').trim();
                        if ((contact.fullName || `${contact.firstName || ''} ${contact.lastName || ''}`) !== next) {
                          handleContactUpdate('fullName', next);
                        }
                      }}
                      fullWidth
                      size="small"
                    />
                    <TextField
                      label="Email"
                      defaultValue={contact.email || ''}
                      onBlur={(e) => {
                        const next = (e.target.value || '').trim();
                        if ((contact.email || '') !== next) {
                          handleContactUpdate('email', next);
                        }
                      }}
                      fullWidth
                      size="small"
                      InputProps={{ startAdornment: <EmailIcon sx={{ fontSize: 16, mr: 1, color: 'text.secondary' }} /> }}
                    />
                    <TextField
                      label="Phone"
                      defaultValue={contact.phone || contact.workPhone || ''}
                      onBlur={(e) => {
                        const next = (e.target.value || '').trim();
                        if ((contact.phone || contact.workPhone || '') !== next) {
                          handleContactUpdate('phone', next);
                        }
                      }}
                      fullWidth
                      size="small"
                      InputProps={{ startAdornment: <PhoneIcon sx={{ fontSize: 16, mr: 1, color: 'text.secondary' }} /> }}
                    />
                    <TextField
                      label="Mobile"
                      defaultValue={contact.mobilePhone || ''}
                      onBlur={(e) => {
                        const next = (e.target.value || '').trim();
                        if ((contact.mobilePhone || '') !== next) {
                          handleContactUpdate('mobilePhone', next);
                        }
                      }}
                      fullWidth
                      size="small"
                      InputProps={{ startAdornment: <PhoneIcon sx={{ fontSize: 16, mr: 1, color: 'text.secondary' }} /> }}
                    />
                    <TextField
                      label="Job Title"
                      defaultValue={contact.jobTitle || contact.title || ''}
                      onBlur={(e) => {
                        const next = (e.target.value || '').trim();
                        if ((contact.jobTitle || contact.title || '') !== next) {
                          handleContactUpdate('jobTitle', next);
                          handleContactUpdate('title', next);
                        }
                      }}
                      fullWidth
                      size="small"
                    />
                    <TextField
                      label="LinkedIn URL"
                      defaultValue={contact.linkedInUrl || ''}
                      onBlur={(e) => {
                        const next = (e.target.value || '').trim();
                        if ((contact.linkedInUrl || '') !== next) {
                          handleContactUpdate('linkedInUrl', next);
                        }
                      }}
                      fullWidth
                      size="small"
                      InputProps={{ startAdornment: <LinkedInIcon sx={{ fontSize: 16, mr: 1, color: 'text.secondary' }} /> }}
                    />
                    
                    <FormControl fullWidth size="small">
                      <InputLabel>Contact Type</InputLabel>
                      <Select
                        value={contact.contactType || 'Unknown'}
                        label="Contact Type"
                        onChange={(e) => handleContactUpdate('contactType', e.target.value)}
                      >
                        <MenuItem value="Decision Maker">Decision Maker</MenuItem>
                        <MenuItem value="Champion">Champion</MenuItem>
                        <MenuItem value="Influencer">Influencer</MenuItem>
                        <MenuItem value="Gatekeeper">Gatekeeper</MenuItem>
                        <MenuItem value="Referrer">Referrer</MenuItem>
                        <MenuItem value="Evaluator">Evaluator</MenuItem>
                        <MenuItem value="Unknown">Unknown</MenuItem>
                      </Select>
                    </FormControl>

                    <TextField
                      label="Lead Source"
                      defaultValue={contact.leadSource || ''}
                      onBlur={(e) => {
                        const next = (e.target.value || '').trim();
                        if ((contact.leadSource || '') !== next) {
                          handleContactUpdate('leadSource', next);
                        }
                      }}
                      fullWidth
                      size="small"
                    />

                    <FormControl fullWidth size="small">
                      <InputLabel>Work Location</InputLabel>
                      <Select
                        value={(() => {
                          // Check new associations format first
                          const assocLocations = contact.associations?.locations || [];
                          if (assocLocations.length > 0) {
                            const locationId = assocLocations[0];
                            // Only return the value if it exists in companyLocations
                            return companyLocations.some(loc => loc.id === locationId) ? locationId : '';
                          }
                          // Fallback to legacy locationId format
                          const legacyLocationId = contact.locationId || '';
                          return companyLocations.some(loc => loc.id === legacyLocationId) ? legacyLocationId : '';
                        })() || ''}
                        label="Work Location"
                        onChange={(e) => handleLocationAssociationUpdate(e.target.value)}
                        disabled={companyLocations.length === 0}
                      >
                        <MenuItem value="">
                          <em>Select a location</em>
                        </MenuItem>
                        {companyLocations.map((location) => (
                          <MenuItem key={location.id} value={location.id}>
                            {location.nickname || location.name || location.title || 'Unknown Location'}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>



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
                  </Box>
                </CardContent>
              </Card>


            </Box>
          </Grid>

          {/* Center Column - Contact Intelligence */}
          <Grid item xs={12} md={5}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {/* Sales Coach Widget */}
              <Card>
                <CardHeader 
                  title="Sales Coach" 
                  titleTypographyProps={{ variant: 'h6', fontWeight: 'bold' }}
                  action={
                    <IconButton 
                      size="small" 
                      title="Start new conversation"
                      onClick={() => {
                        // This will trigger a new conversation in the SalesCoach component
                        const event = new CustomEvent('startNewSalesCoachConversation', {
                          detail: { entityId: contact.id }
                        });
                        window.dispatchEvent(event);
                      }}
                    >
                      <AddIcon />
                    </IconButton>
                  }
                  sx={{ pb: 1 }}
                />
                <CardContent sx={{ p: 0, pt: 0 }}>
                  <Box sx={{ height: 850 }}>
                    <SalesCoach 
                      entityType="contact"
                      entityId={contact.id}
                      entityName={contact.fullName || contact.firstName || contact.lastName || 'Contact'}
                      tenantId={tenantId}
                      contactCompany={company?.companyName || company?.name}
                      contactTitle={contact.jobTitle || contact.title}
                      associations={contact.associations}
                    />
                  </Box>
                </CardContent>
              </Card>

              {/* Contact Intelligence */}
              {/* Contact Intelligence - Hidden for now */}
              {/* <Card>
                <CardHeader 
                  title="Contact Intelligence" 
                  action={
                    <IconButton size="small">
                      <AutoAwesomeIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                  }
                  titleTypographyProps={{ variant: 'h6', fontWeight: 'bold' }}
                />
                <CardContent sx={{ p: 2 }}>
                  {aiComponentsLoaded ? (
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <Box sx={{ mb: 2 }}>
                        <Typography variant="body2" fontWeight="bold" sx={{ mb: 1 }}>
                          AI Insights
                        </Typography>
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                          {insights.slice(0, 3).map((insight, index) => (
                            <Box key={index} sx={{ 
                              display: 'flex', 
                              alignItems: 'center', 
                              gap: 1, 
                              p: 1, 
                              borderRadius: 1, 
                              bgcolor: insight.type === 'success' ? 'success.50' : 
                                       insight.type === 'warning' ? 'warning.50' : 
                                       insight.type === 'error' ? 'error.50' : 'info.50',
                              border: '1px solid',
                              borderColor: insight.type === 'success' ? 'success.200' : 
                                          insight.type === 'warning' ? 'warning.200' : 
                                          insight.type === 'error' ? 'error.200' : 'info.200'
                            }}>
                              <Box sx={{ 
                                width: 8, 
                                height: 8, 
                                borderRadius: '50%', 
                                bgcolor: insight.type === 'success' ? 'success.main' : 
                                        insight.type === 'warning' ? 'warning.main' : 
                                        insight.type === 'error' ? 'error.main' : 'info.main' 
                              }} />
                              <Typography variant="caption" fontSize="0.75rem">
                                {insight.message}
                              </Typography>
                            </Box>
                          ))}
                        </Box>
                      </Box>
                    </Box>
                  ) : (
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <Skeleton variant="rectangular" height={24} />
                      <Skeleton variant="rectangular" height={24} />
                      <Skeleton variant="rectangular" height={24} />
                    </Box>
                  )}
                </CardContent>
              </Card> */}

              {/* Key Metrics - Hidden for now */}
              {/* <Card>
                <CardHeader 
                  title="Key Metrics" 
                  titleTypographyProps={{ variant: 'h6', fontWeight: 'bold' }}
                />
                <CardContent sx={{ p: 2 }}>
                  <Grid container spacing={2}>
                    <Grid item xs={6}>
                      <Box sx={{ textAlign: 'center', p: 1 }}>
                        <Typography variant="h4" color="primary" fontWeight="bold">
                          {metrics.totalDealValue}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          Total Deal Value
                        </Typography>
                      </Box>
                    </Grid>
                    <Grid item xs={6}>
                      <Box sx={{ textAlign: 'center', p: 1 }}>
                        <Typography variant="h4" color="primary" fontWeight="bold">
                          {metrics.activeDeals}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          Active Deals
                        </Typography>
                      </Box>
                    </Grid>
                    <Grid item xs={6}>
                      <Box sx={{ textAlign: 'center', p: 1 }}>
                        <Typography variant="h4" color="success.main" fontWeight="bold">
                          {metrics.completedTasks}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          Completed Tasks
                        </Typography>
                      </Box>
                    </Grid>
                    <Grid item xs={6}>
                      <Box sx={{ textAlign: 'center', p: 1 }}>
                        <Typography variant="h4" color="info.main" fontWeight="bold">
                          {metrics.totalTasks}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          Total Tasks
                        </Typography>
                      </Box>
                    </Grid>
                  </Grid>

                  <Box sx={{ mt: 2, pt: 2, borderTop: '1px solid', borderColor: 'divider' }}>
                    <Typography variant="body2" fontWeight="bold" sx={{ mb: 1 }}>
                      Task Completion Rate
                    </Typography>
                    <Box sx={{ textAlign: 'center', p: 1 }}>
                      <Typography variant="h6" color="primary" fontWeight="bold">
                        {metrics.totalTasks > 0 ? Math.round((metrics.completedTasks / metrics.totalTasks) * 100) : 0}%
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {metrics.completedTasks} of {metrics.totalTasks} tasks completed
                      </Typography>
                    </Box>
                  </Box>
                </CardContent>
              </Card> */}

              {/* Contact Coach - Hidden for now */}
              {/* <Card>
                <CardHeader 
                  title="Contact Coach" 
                  titleTypographyProps={{ variant: 'h6', fontWeight: 'bold' }}
                />
                <CardContent sx={{ p: 2 }}>
                  {aiComponentsLoaded ? (
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      <Button variant="outlined" size="small" fullWidth sx={{ justifyContent: 'flex-start' }}>
                        Strengthen relationship
                      </Button>
                      <Button variant="outlined" size="small" fullWidth sx={{ justifyContent: 'flex-start' }}>
                        Identify upsell opportunities
                      </Button>
                      <Button variant="outlined" size="small" fullWidth sx={{ justifyContent: 'flex-start' }}>
                        Optimize communication strategy
                      </Button>
                    </Box>
                  ) : (
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      <Skeleton variant="rectangular" height={32} />
                      <Skeleton variant="rectangular" height={32} />
                      <Skeleton variant="rectangular" height={32} />
                    </Box>
                  )}
                </CardContent>
              </Card> */}

              {/* AI Suggestions */}
              <Card>
                <CardHeader 
                  title="Suggested by AI" 
                  titleTypographyProps={{ variant: 'h6', fontWeight: 'bold' }}
                />
                <CardContent sx={{ p: 2 }}>
                  {aiComponentsLoaded ? (
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      <Button variant="outlined" size="small" fullWidth sx={{ justifyContent: 'flex-start' }}>
                        Research contact's company role
                      </Button>
                      <Button variant="outlined" size="small" fullWidth sx={{ justifyContent: 'flex-start' }}>
                        Identify communication preferences
                      </Button>
                      <Button variant="outlined" size="small" fullWidth sx={{ justifyContent: 'flex-start' }}>
                        Find engagement opportunities
                      </Button>
                    </Box>
                  ) : (
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      <Skeleton variant="rectangular" height={32} />
                      <Skeleton variant="rectangular" height={32} />
                      <Skeleton variant="rectangular" height={32} />
                    </Box>
                  )}
                </CardContent>
              </Card>
            </Box>
          </Grid>

          {/* Right Column - Active Salespeople + Recent Activity + Associations */}
          <Grid item xs={12} md={3}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {/* Active Salespeople */}
              <Card>
                <CardHeader 
                  title="Active Salespeople" 
                  titleTypographyProps={{ variant: 'h6', fontWeight: 'bold' }}
                  action={
                    <Button size="small" disabled={rebuildingActive} onClick={async () => {
                      try {
                        console.log('🔍 Starting rebuild for contact:', contactId, 'tenant:', tenantId);
                        console.log('🔍 Available deals from frontend:', associationsData.entities.deals?.length || 0);
                        console.log('🔍 Deal IDs from frontend:', associationsData.entities.deals?.map((d: any) => d.id) || []);
                        
                        setRebuildingActive(true);
                        const fn = httpsCallable(functions, 'rebuildContactActiveSalespeople');
                        
                        // Pass the deal IDs that are already loaded in the frontend
                        const dealIds = associationsData.entities.deals?.map((d: any) => d.id) || [];
                        console.log('🔍 Calling function with params:', { tenantId, contactId, dealIds });
                        
                        // Also log the deal data to see what salespeople are in it
                        if (associationsData.entities.deals && associationsData.entities.deals.length > 0) {
                          const deal = associationsData.entities.deals[0];
                          console.log('🔍 Deal data from frontend:', {
                            id: deal.id,
                            name: deal.name,
                            salespersonIds: deal.salespersonIds,
                            salespeopleIds: deal.salespeopleIds,
                            salesOwnerId: deal.salesOwnerId,
                            associations: deal.associations
                          });
                        }
                        
                        const resp: any = await fn({ tenantId, contactId, dealIds });
                        console.log('🔍 Function response:', resp);
                        const data = resp?.data || {};
                        console.log('🔍 Response data:', data);
                        if (data.ok) {
                          setLocalSuccess(`Active salespeople updated (${data.count ?? data.updated ?? 0})`);
                        } else if (data.error) {
                          setLocalError(`Rebuild failed: ${data.error}`);
                        } else {
                          setLocalSuccess('Rebuild requested');
                        }
                        // Light refresh
                        try {
                          await getDoc(doc(db, 'tenants', tenantId, 'crm_contacts', contactId));
                        } catch {}
                      } catch (e) {
                        console.error('Rebuild active salespeople – error', e);
                        setLocalError('Failed to rebuild active salespeople');
                      } finally {
                        setRebuildingActive(false);
                      }
                    }}>{rebuildingActive ? 'Rebuilding…' : 'Rebuild'}</Button>
                  }
                />
                <CardContent sx={{ p: 2 }}>

                  
                  {contact?.activeSalespeople && Object.keys(contact.activeSalespeople).length > 0 ? (
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      {Object.values(contact.activeSalespeople as any)
                        .sort((a: any, b: any) => (b.lastActiveAt || 0) - (a.lastActiveAt || 0))
                        .slice(0, 5)
                        .map((sp: any) => (
                          <Box key={sp.id} sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1, borderRadius: 1, bgcolor: 'grey.50' }}>
                            <Avatar sx={{ width: 28, height: 28, fontSize: '0.75rem' }}>
                              {(sp.displayName || sp.firstName || 'S').charAt(0)}
                            </Avatar>
                            <Box sx={{ flex: 1 }}>
                              <Typography variant="body2" fontWeight="medium">
                                {sp.displayName || `${sp.firstName || ''} ${sp.lastName || ''}`.trim() || sp.email || 'Unknown'}
                              </Typography>
                              <Typography variant="caption" color="text.secondary">
                                {sp.jobTitle || sp.department || ''}
                              </Typography>
                            </Box>
                          </Box>
                        ))}
                    </Box>
                  ) : (
                    <Box sx={{ textAlign: 'center', py: 2 }}>
                      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                        No active salespeople found
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Click "Rebuild" to scan deals, tasks, and emails
                      </Typography>
                    </Box>
                  )}
                </CardContent>
              </Card>

              {/* Opportunities */}
              <Card>
                <CardHeader 
                  title="Opportunities" 
                  titleTypographyProps={{ variant: 'h6', fontWeight: 'bold' }}
                />
                <CardContent sx={{ p: 2 }}>

                  
                  {associationsData.entities.deals && associationsData.entities.deals.length > 0 ? (
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      {associationsData.entities.deals
                        .sort((a: any, b: any) => (b.expectedRevenue || 0) - (a.expectedRevenue || 0))
                        .slice(0, 5)
                        .map((deal: any) => {
                          // Calculate value range using the same logic as Opportunities tab
                          const calculateExpectedRevenueRange = (deal: any) => {
                            if (!deal.stageData?.qualification) {
                              return { min: 0, max: 0, hasData: false };
                            }

                            const qualData = deal.stageData.qualification;
                            const payRate = qualData.expectedAveragePayRate || 16; // Default to $16
                            const markup = qualData.expectedAverageMarkup || 40; // Default to 40%
                            const timeline = qualData.staffPlacementTimeline;

                            if (!timeline) {
                              return { min: 0, max: 0, hasData: false };
                            }

                            // Calculate bill rate: pay rate + markup
                            const billRate = payRate * (1 + markup / 100);
                            
                            // Annual hours per employee (2080 full-time hours)
                            const annualHoursPerEmployee = 2080;
                            
                            // Calculate annual revenue per employee
                            const annualRevenuePerEmployee = billRate * annualHoursPerEmployee;
                            
                            // Get starting and 180-day numbers
                            const startingCount = timeline.starting || 0;
                            const after180DaysCount = timeline.after180Days || timeline.after90Days || timeline.after30Days || startingCount;
                            
                            // Calculate revenue range
                            const minRevenue = annualRevenuePerEmployee * startingCount;
                            const maxRevenue = annualRevenuePerEmployee * after180DaysCount;
                            
                            return {
                              min: minRevenue,
                              max: maxRevenue,
                              hasData: startingCount > 0 || after180DaysCount > 0
                            };
                          };

                          const revenueRange = calculateExpectedRevenueRange(deal);
                          let valueRange = '$0k';
                          
                          if (revenueRange.hasData) {
                            const minK = (revenueRange.min / 1000).toFixed(0);
                            const maxK = (revenueRange.max / 1000).toFixed(0);
                            valueRange = revenueRange.min === revenueRange.max 
                              ? `$${minK}k`
                              : `$${minK}k - $${maxK}k`;
                          } else {
                            // Fallback to simple fields if no qualification data
                            const lowValue = deal.valueLow || deal.expectedRevenue || 0;
                            const highValue = deal.valueHigh || deal.expectedRevenue || 0;
                            valueRange = lowValue === highValue 
                              ? `$${(lowValue / 1000).toFixed(0)}k`
                              : `$${(lowValue / 1000).toFixed(0)}k - $${(highValue / 1000).toFixed(0)}k`;
                          }
                          
                          return (
                            <Box 
                              key={deal.id} 
                              sx={{ 
                                display: 'flex', 
                                alignItems: 'center', 
                                gap: 1, 
                                p: 1, 
                                borderRadius: 1, 
                                bgcolor: 'grey.50',
                                cursor: 'pointer',
                                '&:hover': {
                                  bgcolor: 'grey.100'
                                }
                              }}
                              onClick={() => navigate(`/crm/deals/${deal.id}`)}
                            >
                              <Avatar sx={{ width: 28, height: 28, fontSize: '0.75rem', bgcolor: 'primary.main' }}>
                                <BusinessIcon sx={{ fontSize: 16 }} />
                              </Avatar>
                              <Box sx={{ flex: 1 }}>
                                <Typography variant="body2" fontWeight="medium">
                                  {deal.name || deal.title || 'Unknown Deal'}
                                </Typography>
                                <Typography variant="caption" color="text.secondary">
                                  {valueRange} • {deal.stage || 'Unknown Stage'}
                                </Typography>
                              </Box>
                            </Box>
                          );
                        })}
                    </Box>
                  ) : (
                    <Typography variant="body2" color="text.secondary">No associated opportunities</Typography>
                  )}
                </CardContent>
              </Card>

              {/* Local snackbars for rebuild feedback */}
              <Snackbar open={!!localSuccess} autoHideDuration={3000} onClose={() => setLocalSuccess(null)}>
                <Alert severity="success" onClose={() => setLocalSuccess(null)} sx={{ width: '100%' }}>
                  {localSuccess}
                </Alert>
              </Snackbar>
              <Snackbar open={!!localError} autoHideDuration={4000} onClose={() => setLocalError(null)}>
                <Alert severity="error" onClose={() => setLocalError(null)} sx={{ width: '100%' }}>
                  {localError}
                </Alert>
              </Snackbar>

              {/* Recent Activity */}
              <Card>
                <CardHeader 
                  title="Recent Activity" 
                  titleTypographyProps={{ variant: 'h6', fontWeight: 'bold' }}
                />
                <CardContent sx={{ p: 2 }}>
                  {loadingActivities ? (
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      <Skeleton variant="rectangular" height={32} />
                      <Skeleton variant="rectangular" height={32} />
                      <Skeleton variant="rectangular" height={32} />
                    </Box>
                  ) : recentActivities.length > 0 ? (
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      {recentActivities.map((activity) => (
                        <Box 
                          key={activity.id} 
                          sx={{ 
                            display: 'flex', 
                            alignItems: 'center', 
                            gap: 1, 
                            p: 1, 
                            borderRadius: 1,
                            cursor: 'pointer',
                            '&:hover': {
                              bgcolor: 'grey.50'
                            }
                          }}
                          onClick={() => {
                            // Navigate to appropriate section based on activity type
                            switch (activity.type) {
                              case 'task':
                                setTabValue(1); // Tasks tab
                                break;
                              case 'note':
                                setTabValue(4); // Notes tab
                                break;
                              case 'email':
                                setTabValue(5); // Activity tab
                                break;
                              default:
                                break;
                            }
                          }}
                        >
                          <Avatar sx={{ width: 24, height: 24, fontSize: '0.75rem', bgcolor: 'primary.main' }}>
                            {getActivityIcon(activity.icon)}
                          </Avatar>
                          <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Typography variant="body2" fontSize="0.75rem" fontWeight="medium" noWrap>
                              {activity.title}
                            </Typography>
                            {activity.description && (
                              <Typography variant="caption" color="text.secondary" noWrap>
                                {activity.description.length > 50 
                                  ? `${activity.description.substring(0, 50)}...` 
                                  : activity.description}
                              </Typography>
                            )}
                          </Box>
                          <Typography variant="caption" color="text.secondary" fontSize="0.7rem">
                            {formatActivityTime(activity.timestamp)}
                          </Typography>
                        </Box>
                      ))}
                    </Box>
                  ) : (
                    <Box sx={{ textAlign: 'center', py: 2 }}>
                      <Typography variant="body2" color="text.secondary">
                        No recent activity
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Activities will appear here as they occur
                      </Typography>
                    </Box>
                  )}
                </CardContent>
              </Card>
            </Box>
          </Grid>
        </Grid>
      </TabPanel>

      <TabPanel value={tabValue} index={1}>
        {/* Tasks - New Balanced Layout matching DealDetails */}
        <Grid container spacing={3}>
          {/* Left Column (35%): Action Focused - To-Dos Only */}
          <Grid item xs={12} md={4}>
            <Card sx={{ minHeight: 600 }}>
              <CardHeader 
                title="To-Dos" 
                subheader="Priority tasks for this contact"
                action={
                  <IconButton 
                    size="small" 
                    title="Add new task"
                    onClick={() => setShowTaskDialog(true)}
                  >
                    <AddIcon />
                  </IconButton>
                }
                sx={{ p: 0, mb: 2 }} 
                titleTypographyProps={{ variant: 'h6', fontWeight: 'bold' }}
                subheaderTypographyProps={{ variant: 'body2', color: 'text.secondary' }}
              />
              <CardContent sx={{ p: 0 }}>
                <TasksDashboard
                  entityId={contact.id}
                  entityType="contact"
                  tenantId={tenantId}
                  entity={contact}
                  preloadedContacts={[contact]}
                  preloadedSalespeople={salespeople}
                  preloadedCompany={company}
                />
              </CardContent>
            </Card>
          </Grid>

          {/* Appointments Widget (Expanded to take up remaining space) */}
          <Grid item xs={12} md={8}>
            <Card sx={{ minHeight: 600 }}>
              <CardHeader 
                title="Appointments" 
                subheader="Upcoming meetings & calls"
                action={
                  <IconButton 
                    size="small" 
                    title="Schedule meeting"
                    onClick={() => setShowAppointmentDialog(true)}
                  >
                    <AddIcon />
                  </IconButton>
                }
                sx={{ p: 0, mb: 2 }} 
                titleTypographyProps={{ variant: 'h6', fontWeight: 'bold' }}
                subheaderTypographyProps={{ variant: 'body2', color: 'text.secondary' }}
              />
              <CardContent sx={{ p: 0 }}>
                <AppointmentsDashboard
                  entityId={contact.id}
                  entityType="contact"
                  tenantId={tenantId}
                  entity={contact}
                  preloadedContacts={[contact]}
                  preloadedSalespeople={salespeople}
                  preloadedCompany={company}
                />
              </CardContent>
            </Card>
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

      <TabPanel value={tabValue} index={3}>
        <ContactActivityTab
          contact={contact}
          tenantId={tenantId}
        />
      </TabPanel>

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
          Delete Contact
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

      {/* Task Creation Dialog */}
      {showTaskDialog && (
        <CreateTaskDialog
          open={showTaskDialog}
          onClose={() => setShowTaskDialog(false)}
          onSubmit={async (taskData) => {
            try {
              await taskService.createTask({
                ...taskData,
                tenantId,
                createdBy: user?.uid || '',
                associations: {
                  companies: Array.isArray(contact?.associations?.companies)
                    ? contact.associations.companies.map((c: any) => (typeof c === 'string' ? c : c?.id)).filter(Boolean)
                    : [],
                  contacts: [contact.id],
                  deals: Array.isArray(contact?.associations?.deals)
                    ? contact.associations.deals.map((d: any) => (typeof d === 'string' ? d : d?.id)).filter(Boolean)
                    : [],
                  salespeople: user?.uid ? [user.uid] : []
                }
              });
              setShowTaskDialog(false);
              setSnackbarMessage('Task created successfully');
              setSnackbarSeverity('success');
              setSnackbarOpen(true);
            } catch (error) {
              console.error('Error creating task:', error);
              setSnackbarMessage('Failed to create task');
              setSnackbarSeverity('error');
              setSnackbarOpen(true);
            }
          }}
          prefilledData={{
            assignedTo: user?.uid || '',
            associations: {
              companies: Array.isArray(contact?.associations?.companies)
                ? contact.associations.companies.map((c: any) => (typeof c === 'string' ? c : c?.id)).filter(Boolean)
                : [],
              contacts: [contact.id],
              deals: Array.isArray(contact?.associations?.deals)
                ? contact.associations.deals.map((d: any) => (typeof d === 'string' ? d : d?.id)).filter(Boolean)
                : [],
              salespeople: user?.uid ? [user.uid] : []
            }
          }}
          contacts={[contact]}
          salespeople={salespeople}
          currentUserId={user?.uid || ''}
        />
      )}

      {/* Appointment Creation Dialog */}
      {showAppointmentDialog && (
        <CreateTaskDialog
          open={showAppointmentDialog}
          onClose={() => setShowAppointmentDialog(false)}
          onSubmit={async (taskData) => {
            try {
              await taskService.createTask({
                ...taskData,
                classification: 'appointment',
                tenantId,
                createdBy: user?.uid || '',
                associations: {
                  companies: Array.isArray(contact?.associations?.companies)
                    ? contact.associations.companies.map((c: any) => (typeof c === 'string' ? c : c?.id)).filter(Boolean)
                    : [],
                  contacts: [contact.id],
                  deals: Array.isArray(contact?.associations?.deals)
                    ? contact.associations.deals.map((d: any) => (typeof d === 'string' ? d : d?.id)).filter(Boolean)
                    : [],
                  salespeople: user?.uid ? [user.uid] : []
                }
              });
              setShowAppointmentDialog(false);
              setSnackbarMessage('Appointment created successfully');
              setSnackbarSeverity('success');
              setSnackbarOpen(true);
            } catch (error) {
              console.error('Error creating appointment:', error);
              setSnackbarMessage('Failed to create appointment');
              setSnackbarSeverity('error');
              setSnackbarOpen(true);
            }
          }}
          prefilledData={{
            classification: 'appointment',
            assignedTo: user?.uid || '',
            associations: {
              companies: Array.isArray(contact?.associations?.companies)
                ? contact.associations.companies.map((c: any) => (typeof c === 'string' ? c : c?.id)).filter(Boolean)
                : [],
              contacts: [contact.id],
              deals: Array.isArray(contact?.associations?.deals)
                ? contact.associations.deals.map((d: any) => (typeof d === 'string' ? d : d?.id)).filter(Boolean)
                : [],
              salespeople: user?.uid ? [user.uid] : []
            }
          }}
          contacts={[contact]}
          salespeople={salespeople}
          currentUserId={user?.uid || ''}
        />
      )}

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

      {/* Log Activity Dialog */}
      <LogActivityDialog
        open={showLogActivityDialog}
        onClose={() => setShowLogActivityDialog(false)}
        onSubmit={handleLogActivity}
        loading={logActivityLoading}
        salespeople={salespeople}
        contacts={[contact]}
        currentUserId={user?.uid || ''}
        tenantId={tenantId}
      />

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