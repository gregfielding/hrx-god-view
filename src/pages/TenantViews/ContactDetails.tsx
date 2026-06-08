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
  Link as MUILink,
  Skeleton,
  TableContainer,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  Tooltip,
  Badge,
} from '@mui/material';
import {
  Email as EmailIcon,
  Phone as PhoneIcon,
  LinkedIn as LinkedInIcon,
  Twitter as TwitterIcon,
  Facebook as FacebookIcon,
  Instagram as InstagramIcon,
  Notes as NotesIcon,
  Note as NoteIcon,
  Save as SaveIcon,
  Delete as DeleteIcon,
  Info as InfoIcon,
  Language as LanguageIcon,
  AutoAwesome as AutoAwesomeIcon,
  AddTask as AddTaskIcon,
  CloudUpload as UploadIcon,
  Business as BusinessIcon,
  AttachMoney as DealIcon,
  SmartToy as AIIcon,
  Timeline as TimelineIcon,
  Dashboard as DashboardIcon,
  Add as AddIcon,
  CheckCircle as CheckCircleIcon,
  RocketLaunch as RocketLaunchIcon,
  LocationOn as LocationIcon,
  Edit as EditIcon,
  Work as WorkIcon,
  Person as PersonIcon,
  ContentCopy as ContentCopyIcon,
} from '@mui/icons-material';
import { doc, getDoc, updateDoc, collection, getDocs, deleteDoc, query, where, orderBy, limit, onSnapshot, serverTimestamp } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { getFunctions, httpsCallable } from 'firebase/functions';

import { db, storage , functions } from '../../firebase';
import { getGmailConnectionFromFirestore } from '../../utils/getGmailConnectionFromFirestore';
import { useAuth } from '../../contexts/AuthContext';
import CRMNotesTab from '../../components/CRMNotesTab';
import SimpleAssociationsCard from '../../components/SimpleAssociationsCard';
import ActivityLogTab from '../../components/ActivityLogTab';
import SafeAvatar from '../../components/SafeAvatar';
import { getLastContactActivity, type UnifiedActivityItem } from '../../utils/activityService';
import TasksDashboard from '../../components/TasksDashboard';
import AppointmentsDashboard from '../../components/AppointmentsDashboard';
import { LoggableSlider, LoggableTextField, LoggableSwitch } from '../../components/LoggableField';
import ContactOpportunitiesTab from '../../components/ContactOpportunitiesTab';
import AIAssistantChat from '../../components/AIAssistantChat';
import ContactActivityTab from '../../components/ContactActivityTab';
import { useChatGPT } from '../../contexts/ChatGPTContext';
import CreateTaskDialog from '../../components/CreateTaskDialog';
import { TaskService } from '../../utils/taskService';
import LogActivityDialog from '../../components/LogActivityDialog';
import AddNoteDialog from '../../components/AddNoteDialog';
import { logger } from '../../utils/logger';
import ContactHeader from '../../components/ContactHeader';
import ManageContactCompanyDialog from '../../components/ManageContactCompanyDialog';
import ManageContactLocationsDialog from '../../components/ManageContactLocationsDialog';
import { useFavorites } from '../../hooks/useFavorites';
import { BreadcrumbNav } from '../../components/BreadcrumbNav';
import MessageDrawer, { MessageRecipient } from '../../components/MessageDrawer';
import PageHeader from '../../components/PageHeader';
import FavoriteButton from '../../components/FavoriteButton';
import { Stack } from '@mui/material';
import EmailOutlinedIcon from '@mui/icons-material/EmailOutlined';
import UniversalBackButton from '../../components/common/UniversalBackButton';
import { ContactHeaderMarketing, type CrmContactIndustrySegment } from '../../components/crm/contacts/ContactHeaderMarketing';
import { PipelineStageContainer } from '../../components/crm/contacts/PipelineStageContainer';
import { PIPELINE_STAGES, PIPELINE_STAGE_LABELS, type PipelineStage } from '../../types/CRM';
import { formatPhoneNumber } from '../../utils/formatPhone';
import { toChipLabel } from '../../utils/chipLabel';
import { toSafeHref } from '../../utils/urlUtils';

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
  headline?: string;
  address?: string;
  city?: string;
  state?: string;
  zipcode?: string;
  country?: string;
  formattedAddress?: string;
  timeZone?: string;
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
  /** Pipeline stage: Contact, Prospect, or Lead */
  pipelineStage?: PipelineStage | null;
  prospectFollowPlan?: string;
  leadTiming?: string;
  leadVolume?: string;
  leadNotes?: string;
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
  lastEnrichedAt?: any;
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
  // Apollo enrichment data
  apolloEnrichment?: {
    person?: any;
    company?: any;
    fetchedAt?: any;
  };

  // --- Marketing fields (Mailchimp-ready) ---
  industrySegment?: CrmContactIndustrySegment;
  marketingTags?: string[];
  marketingNotes?: string;
  marketingEnabled?: boolean;
  mailchimp?: {
    subscriberId?: string;
    lastSyncedAt?: any;
    lastStatus?: 'subscribed' | 'unsubscribed' | 'cleaned' | 'pending' | 'archived';
    lastError?: string;
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
      {value === index && <Box sx={{ pt: 0, px: { xs: 2, md: 3 }, pb: 2 }}>{children}</Box>}
    </div>
  );
}

const ContactDetails: React.FC = () => {
  const { contactId } = useParams<{ contactId: string }>();
  const navigate = useNavigate();
  const { tenantId, user } = useAuth();
  const { openChatGPT } = useChatGPT();
  const taskService = TaskService.getInstance();
  
  // Favorites
  const { isFavorite, toggleFavorite } = useFavorites('contacts');
  
  const [contact, setContact] = useState<ContactData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tabValue, setTabValue] = useState(0);
  const [company, setCompany] = useState<any>(null);
  const [activities, setActivities] = useState<any[]>([]);
  const [lastActivity, setLastActivity] = useState<UnifiedActivityItem | null>(null);
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
  const [selectedLocations, setSelectedLocations] = useState<any[]>([]);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [fixingAssociations, setFixingAssociations] = useState(false);

  // Contact info finding state
  const [findingContactInfo, setFindingContactInfo] = useState(false);
  const [emailOptions, setEmailOptions] = useState<any[]>([]);
  const [showEmailDialog, setShowEmailDialog] = useState(false);
  const [showTaskDialog, setShowTaskDialog] = useState(false);
  const [taskSubmitting, setTaskSubmitting] = useState(false);
  const [showAppointmentDialog, setShowAppointmentDialog] = useState(false);
  const [appointmentSubmitting, setAppointmentSubmitting] = useState(false);
  
  // Company association state
  const [allCompanies, setAllCompanies] = useState<any[]>([]);
  const [loadingCompanies, setLoadingCompanies] = useState(false);
  const [suggestedCompanies, setSuggestedCompanies] = useState<any[]>([]);
  const [showManageCompanyDialog, setShowManageCompanyDialog] = useState(false);
  const [showManageWorkLocationsDialog, setShowManageWorkLocationsDialog] = useState(false);
  const [showLogActivityDialog, setShowLogActivityDialog] = useState(false);
  const [logActivityLoading, setLogActivityLoading] = useState(false);
  
  // Salespeople state
  const [salespeople, setSalespeople] = useState<any[]>([]);
  
  // Avatar upload state
  const [avatarLoading, setAvatarLoading] = useState(false);

  // Gmail connection and message drawer state
  const [gmailConnected, setGmailConnected] = useState<boolean>(false);
  const [messageDrawerOpen, setMessageDrawerOpen] = useState(false);
  const [messageDrawerChannel, setMessageDrawerChannel] = useState<'email' | 'sms'>('email');

  // Check Gmail connection status (Firestore-only — see getGmailConnectionFromFirestore)
  useEffect(() => {
    if (!user?.uid || !tenantId) {
      setGmailConnected(false);
      return;
    }
    let mounted = true;
    getGmailConnectionFromFirestore(user.uid, tenantId).then((status) => {
      if (mounted) setGmailConnected(status.connected);
    });
    return () => { mounted = false; };
  }, [user?.uid, tenantId]);

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
  
  // Recent Activity state (shown at top of right column)
  const [showAddNoteDialog, setShowAddNoteDialog] = useState(false);
  const [notesCount, setNotesCount] = useState<number>(0);
  
  // Edit mode state for Contact Details card
  const [isEditingContactDetails, setIsEditingContactDetails] = useState(false);
  
  // Job Orders state
  const [jobOrders, setJobOrders] = useState<any[]>([]);
  const [loadingJobOrders, setLoadingJobOrders] = useState(false);

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

  // Copy to clipboard function
  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast(`${label} copied to clipboard`, 'success');
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
      showToast(`Failed to copy ${label}`, 'error');
    }
  };

  // Calculate contact metrics
  const calculateContactMetrics = React.useCallback(() => {
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
  }, [associationsData.entities.deals, associationsData.entities.tasks]);

  // Generate contact insights
  const generateContactInsights = React.useCallback(() => {
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
  }, [associationsData.entities.deals, associationsData.entities.tasks, contact?.contactType]);

  const metrics = React.useMemo(() => calculateContactMetrics(), [calculateContactMetrics]);
  const insights = React.useMemo(() => generateContactInsights(), [generateContactInsights]);

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
  const loadAssociations = React.useCallback(async () => {
    if (!contactId || !tenantId || !user?.uid) return;
    
    try {
      setAssociationsData(prev => ({ ...prev, loading: true, error: null }));
      
      // Use the simple association service
      const { createUnifiedAssociationService } = await import('../../utils/unifiedAssociationService');
      const associationService = createUnifiedAssociationService(tenantId, user.uid);
      
      const result = await associationService.getEntityAssociations('contact', contactId);
      
      // Normalize stored id to string (handles string, number, or Firestore ref with .id)
      const toId = (v: any): string => {
        if (v == null) return '';
        if (typeof v === 'string') return v;
        if (typeof v === 'number') return String(v);
        if (typeof v === 'object' && v?.id != null) return String(v.id);
        return String(v);
      };
      const cid = String(contactId);
      const dealHasContact = (deal: any) => {
        if (Array.isArray(deal.contactIds) && deal.contactIds.some((id: any) => toId(id) === cid)) return true;
        if (deal.associations?.contacts?.some((c: any) => toId(typeof c === 'string' ? c : c?.id) === cid)) return true;
        return false;
      };

      // Fallback: Query deals that reference this contact. Run each query in its own try/catch
      // so one failure (e.g. missing Firestore index for contactIds) doesn't skip the batch scan.
      let fallbackDeals: any[] = [];

      // Query 1: contactIds array-contains (may fail if index missing)
      try {
        const q1 = query(
          collection(db, 'tenants', tenantId, 'crm_deals'),
          where('contactIds', 'array-contains', contactId)
        );
        const snap1 = await getDocs(q1);
        fallbackDeals = snap1.docs.map(d => ({ id: d.id, ...d.data() }));
      } catch (e1) {
        console.warn('Contact opportunities: contactIds query failed (index?), using batch fallback', e1);
      }

      // Query 2: Deals by contact's company
      let contactCompanyId: string | undefined;
      try {
        const contactDoc = await getDoc(doc(db, 'tenants', tenantId, 'crm_contacts', contactId));
        if (contactDoc.exists()) {
          const contactData = contactDoc.data();
          const rawCompany = contactData?.companyId ?? contactData?.associations?.companies?.[0];
          contactCompanyId = typeof rawCompany === 'string' ? rawCompany : (rawCompany?.id ?? undefined);
          if (contactCompanyId) {
            const q2 = query(
              collection(db, 'tenants', tenantId, 'crm_deals'),
              where('companyId', '==', contactCompanyId)
            );
            const snap2 = await getDocs(q2);
            const companyDeals = snap2.docs.map(d => ({ id: d.id, ...d.data() }));
            const matching = companyDeals.filter(dealHasContact);
            fallbackDeals = [...fallbackDeals, ...matching.filter(d => !fallbackDeals.some(f => f.id === d.id))];
          }
        }
      } catch (e2) {
        console.warn('Contact opportunities: company deals query failed', e2);
      }

      // Query 3: Batch scan – always run so we find deals even without contactIds index or companyId on deal
      try {
        const batchQuery = query(
          collection(db, 'tenants', tenantId, 'crm_deals'),
          limit(500)
        );
        const batchSnap = await getDocs(batchQuery);
        const batchDeals = batchSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        const byContact = batchDeals.filter((deal: any) => {
          if (!dealHasContact(deal)) return false;
          if (fallbackDeals.some((d: any) => d.id === deal.id)) return false;
          return true;
        });
        fallbackDeals = [...fallbackDeals, ...byContact];
        if (batchDeals.length > 0 && process.env.NODE_ENV === 'development') {
          const withContact = batchDeals.filter(dealHasContact);
          console.log('Contact opportunities: batch scanned', batchDeals.length, 'deals,', withContact.length, 'have this contact, total fallback', fallbackDeals.length);
        }
      } catch (e3) {
        console.warn('Contact opportunities: batch deals query failed', e3);
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
  }, [contactId, tenantId, user?.uid]);

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

  // Load all companies for autocomplete
  const loadAllCompanies = async () => {
    if (!tenantId) return;
    
    try {
      setLoadingCompanies(true);
      const companiesRef = collection(db, 'tenants', tenantId, 'crm_companies');
      const companiesSnapshot = await getDocs(companiesRef);
      const companies = companiesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setAllCompanies(companies);
    } catch (error) {
      console.error('Error loading companies:', error);
      setAllCompanies([]);
    } finally {
      setLoadingCompanies(false);
    }
  };

  // Find companies by email domain
  const findCompaniesByEmailDomain = (email: string) => {
    if (!email || !email.includes('@')) return [];
    
    const domain = email.split('@')[1].toLowerCase();
    const suggestions = allCompanies.filter(company => {
      const companyName = (company.companyName || company.name || '').toLowerCase();
      const companyDomain = companyName.replace(/[^a-z0-9]/g, '');
      
      // Check if domain matches company name pattern
      const domainMatchesCompany = domain.includes(companyDomain) || companyDomain.includes(domain);
      
      // Check if company has a website that matches the domain
      const companyWebsite = (company.website || '').toLowerCase();
      const websiteDomain = companyWebsite.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
      const websiteMatches = websiteDomain === domain;
      
      return domainMatchesCompany || websiteMatches;
    });
    
    return suggestions.slice(0, 5); // Limit to 5 suggestions
  };

  // Handle company association
  const handleCompanyAssociation = async (companyId: string) => {
    if (!contactId || !tenantId || !companyId || !user?.uid) return;
    
    try {
      // Get company name for display
      const selectedCompany = allCompanies.find(c => c.id === companyId);
      
      // Update both legacy fields and new associations format
      const updateData: any = {
        companyId: companyId, // Legacy format
        companyName: selectedCompany?.companyName || selectedCompany?.name || '', // Legacy format
        updatedAt: new Date()
      };
      
      // Update associations map - ensure it exists and add company to companies array
      const currentAssociations = contact?.associations || {};
      const updatedAssociations = {
        ...currentAssociations,
        companies: [companyId] // Replace existing companies with the new one
      };
      
      updateData.associations = updatedAssociations;
      
      // Update the contact document
      await updateDoc(doc(db, 'tenants', tenantId, 'crm_contacts', contactId), updateData);
      
      // Update local state
      setContact(prev => prev ? { 
        ...prev, 
        companyId: companyId,
        companyName: selectedCompany?.companyName || selectedCompany?.name || '',
        associations: updatedAssociations
      } : null);
      
      // Log the activity locally for diagnostics
      await logger.aiEvent({
        eventType: 'contact.company_associated',
        actionType: 'contact_company_associated',
        targetType: 'contact',
        targetId: contactId,
        tenantId,
        userId: user.uid,
        contextType: 'contact_management',
        aiRelevant: true,
        urgencyScore: 7,
        reason: `Associated with company: ${selectedCompany?.companyName || selectedCompany?.name || companyId}`,
        metadata: {
          companyId,
          companyName: selectedCompany?.companyName || selectedCompany?.name || '',
          previousCompanyId: contact?.companyId || null
        }
      });
      
      showToast(`Contact associated with ${selectedCompany?.companyName || selectedCompany?.name || 'company'}`, 'success');
      
      // Refresh associations
      await loadAssociations();
    } catch (error) {
      console.error('Error associating contact with company:', error);
      showToast('Failed to associate contact with company', 'error');
    }
  };

  const handleCompanySaveFromModal = async (companyId: string | null) => {
    if (companyId) {
      await handleCompanyAssociation(companyId);
    } else {
      if (!contactId || !tenantId || !user?.uid) return;
      try {
        const currentAssociations = contact?.associations || {};
        const updatedAssociations = { ...currentAssociations, companies: [] };
        await updateDoc(doc(db, 'tenants', tenantId, 'crm_contacts', contactId), {
          companyId: null,
          companyName: '',
          associations: updatedAssociations,
          updatedAt: new Date(),
        });
        setContact((prev) => (prev ? { ...prev, companyId: undefined, companyName: '', associations: updatedAssociations } : null));
        setCompany(null);
        setCompanyLocations([]);
        setSelectedLocations([]);
        showToast('Company association removed', 'success');
        await loadAssociations();
      } catch (error) {
        console.error('Error clearing company association:', error);
        showToast('Failed to remove company association', 'error');
      }
    }
  };

  // (Removed) Duplicate Recent Activity widget under Contact Details (now shown in right column)

  // Handle location association update (now supports multiple locations)
  const handleLocationAssociationUpdate = async (selectedLocations: any[]) => {
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

      // Extract location IDs from selected locations
      const locationIds = selectedLocations.map(loc => loc.id);
      
      // Update associations with the new locations
      const currentAssociations = contact.associations || {};
      const updatedAssociations = {
        ...currentAssociations,
        locations: locationIds
      };

      // For backward compatibility, set the first location as the primary location
      const primaryLocation = selectedLocations.length > 0 ? selectedLocations[0] : null;
      const primaryLocationId = primaryLocation?.id || '';
      const primaryLocationName = primaryLocation ? (primaryLocation.name || primaryLocation.nickname || 'Unknown Location') : '';

      // Update the contact document with both new and legacy formats
      await updateDoc(doc(db, 'tenants', tenantId, 'crm_contacts', contactId), {
        associations: updatedAssociations,
        locationId: primaryLocationId, // Legacy format - first location
        locationName: primaryLocationName, // Legacy format - first location name
        updatedAt: new Date()
      });

      // Update local state with both new and legacy formats
      setContact(prev => prev ? { 
        ...prev, 
        associations: updatedAssociations,
        locationId: primaryLocationId, // Legacy format
        locationName: primaryLocationName // Legacy format
      } : null);
      
      // Update selected locations state
      setSelectedLocations(selectedLocations);
      
      // Log the activity locally for diagnostics
      const locationNames = selectedLocations.map(loc => loc.name || loc.nickname || 'Unknown Location').join(', ');
      await logger.aiEvent({
        eventType: 'contact.location_updated',
        actionType: 'contact_location_updated',
        targetType: 'contact',
        targetId: contactId,
        tenantId,
        userId: user.uid,
        contextType: 'contact_management',
        aiRelevant: true,
        urgencyScore: 7,
        reason: `Updated work locations to: ${locationNames}`,
        metadata: {
          locationIds,
          locationNames,
          locationCount: selectedLocations.length
        }
      });

      showToast(`Work locations updated to: ${locationNames}`, 'success');
    } catch (err) {
      console.error('Error updating location association:', err);
      showToast('Failed to update work locations', 'error');
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
      
      // Load last activity for Recent Activity card
      const loadLastActivity = async () => {
        try {
          const lastActivityData = await getLastContactActivity(tenantId, contactId);
          setLastActivity(lastActivityData);
        } catch (err) {
          console.error('Error loading last activity:', err);
          setLastActivity(null);
        }
      };
      
      await loadLastActivity();

      // Email log real-time updates are handled by the separate useEffect below (contactId/tenantId).
      // Do not return here or loadAssociations() would never run.

      // Load associations (deals/opportunities, etc.) so the Opportunities widget shows correctly
      await loadAssociations();

    } catch (err) {
      console.error('Error loading contact:', err);
      setError('Failed to load contact');
    } finally {
      setLoading(false);
    }
  };

  // Load job orders associated with this contact
  const loadJobOrdersForContact = async () => {
    if (!contactId || !tenantId) {
      setJobOrders([]);
      return;
    }
    
    try {
      setLoadingJobOrders(true);
      const jobOrdersRef = collection(db, 'tenants', tenantId, 'job_orders');

      const getAssocId = (entry: any): string | null => {
        if (!entry) return null;
        if (typeof entry === 'string') return entry;
        if (typeof entry === 'object' && typeof entry.id === 'string') return entry.id;
        return null;
      };

      const contactRoleFields = [
        'hrContactId',
        'decisionMaker',
        'operationsContactId',
        'procurementContactId',
        'billingContactId',
        'safetyContactId',
        'invoiceContactId',
      ];

      const baseQueries = [
        ...contactRoleFields.map((field) => query(jobOrdersRef, where(field, '==', contactId))),
        query(jobOrdersRef, where('contactIds', 'array-contains', contactId)),
        query(jobOrdersRef, where('associations.contacts', 'array-contains', contactId)),
        query(jobOrdersRef, where('deal.contactIds', 'array-contains', contactId)),
      ];

      const runSafe = async (q: any) =>
        getDocs(q).catch((err) => {
          console.warn('Job orders contact query failed:', err);
          return { docs: [] as any[] };
        });

      const baseSnapshots = await Promise.all(baseQueries.map(runSafe));
      const allJobOrders = new Map<string, any>();

      baseSnapshots.forEach((snapshot: any) => {
        snapshot.docs.forEach((snap: any) => {
          allJobOrders.set(snap.id, { id: snap.id, ...snap.data() });
        });
      });

      // Also include job orders linked to any deal associated with this contact.
      const associatedDealIds = new Set<string>();
      const associatedCompanyIds = new Set<string>();
      try {
        const contactDoc = await getDoc(doc(db, 'tenants', tenantId, 'crm_contacts', contactId));
        if (contactDoc.exists()) {
          const contactData = contactDoc.data() as any;
          const legacyCompanyId = contactData?.companyId;
          if (legacyCompanyId && typeof legacyCompanyId === 'string') {
            associatedCompanyIds.add(legacyCompanyId);
          }
          const assocCompanies = contactData?.associations?.companies;
          if (Array.isArray(assocCompanies)) {
            assocCompanies.forEach((c: any) => {
              const id = getAssocId(c);
              if (id) associatedCompanyIds.add(id);
            });
          }
          const rawDeals = contactData?.associations?.deals;
          if (Array.isArray(rawDeals)) {
            rawDeals.forEach((d: any) => {
              const id = getAssocId(d);
              if (id) associatedDealIds.add(id);
            });
          }
        }
      } catch (err) {
        console.warn('Failed to load contact deal associations for job orders:', err);
      }

      // Fallback deals query for older mappings.
      try {
        const dealsSnap = await getDocs(
          query(collection(db, 'tenants', tenantId, 'crm_deals'), where('contactIds', 'array-contains', contactId))
        );
        dealsSnap.docs.forEach((d) => associatedDealIds.add(d.id));
      } catch (err) {
        console.warn('Fallback deal query failed while loading contact job orders:', err);
      }

      // Also discover deals through company association + associations.contacts object array.
      const companyIds = Array.from(associatedCompanyIds);
      if (companyIds.length > 0) {
        for (let i = 0; i < companyIds.length; i += 10) {
          const chunk = companyIds.slice(i, i + 10);
          try {
            const companyDealsSnap = await getDocs(
              query(collection(db, 'tenants', tenantId, 'crm_deals'), where('companyId', 'in', chunk))
            );
            companyDealsSnap.docs.forEach((d) => {
              const data = d.data() as any;
              const direct = Array.isArray(data?.contactIds) && data.contactIds.includes(contactId);
              const assoc =
                Array.isArray(data?.associations?.contacts) &&
                data.associations.contacts.some((c: any) => getAssocId(c) === contactId);
              if (direct || assoc) associatedDealIds.add(d.id);
            });
          } catch (err) {
            console.warn('Company-scoped deal lookup failed for contact job orders:', err);
          }
        }
      }

      const dealIds = Array.from(associatedDealIds);
      if (dealIds.length > 0) {
        for (let i = 0; i < dealIds.length; i += 10) {
          const chunk = dealIds.slice(i, i + 10);
          const byDealId = await runSafe(query(jobOrdersRef, where('dealId', 'in', chunk)));
          byDealId.docs.forEach((snap: any) => {
            allJobOrders.set(snap.id, { id: snap.id, ...snap.data() });
          });
        }
      }

      // Fallback: company-scoped job orders (some records only embed contact under deal.associations.contacts).
      if (companyIds.length > 0) {
        for (let i = 0; i < companyIds.length; i += 10) {
          const chunk = companyIds.slice(i, i + 10);
          const byCompany = await runSafe(query(jobOrdersRef, where('companyId', 'in', chunk)));
          byCompany.docs.forEach((snap: any) => {
            allJobOrders.set(snap.id, { id: snap.id, ...snap.data() });
          });
        }
      }

      // Final client-side guard to support mixed historical schemas.
      const filtered = Array.from(allJobOrders.values()).filter((jobOrder: any) => {
        const directRoleMatch = contactRoleFields.some((field) => jobOrder?.[field] === contactId);
        if (directRoleMatch) return true;
        if (Array.isArray(jobOrder?.contactIds) && jobOrder.contactIds.includes(contactId)) return true;
        if (Array.isArray(jobOrder?.associations?.contacts)) {
          if (jobOrder.associations.contacts.some((c: any) => getAssocId(c) === contactId)) return true;
        }
        if (Array.isArray(jobOrder?.deal?.contactIds) && jobOrder.deal.contactIds.includes(contactId)) return true;
        if (Array.isArray(jobOrder?.deal?.associations?.contacts)) {
          if (jobOrder.deal.associations.contacts.some((c: any) => getAssocId(c) === contactId)) return true;
        }
        if (jobOrder?.dealId && associatedDealIds.has(jobOrder.dealId)) return true;
        return false;
      });

      setJobOrders(filtered);
    } catch (err) {
      console.error('Error loading job orders for contact:', err);
      setJobOrders([]);
    } finally {
      setLoadingJobOrders(false);
    }
  };

  useEffect(() => {
    loadContact();
    loadSalespeople();
    loadAllCompanies();
    loadJobOrdersForContact();
    
    // Load notes count (use contact_notes collection; Firestore rules allow read)
    if (contactId && tenantId) {
      const notesRef = collection(db, 'tenants', tenantId, 'contact_notes');
      const notesQuery = query(notesRef, where('entityId', '==', contactId));
      const unsubscribeNotes = onSnapshot(notesQuery, (snapshot) => {
        setNotesCount(snapshot.size);
      }, (err) => {
        console.error('Error loading notes count:', err);
      });
      
      return () => {
        unsubscribeNotes();
      };
    }
  }, [contactId, tenantId]);

  // Set up real-time listeners for Recent Activity and Active Salespeople
  useEffect(() => {
    if (!tenantId || !contactId) return;

    // Load last activity function
    const loadLastActivity = async () => {
      try {
        const lastActivityData = await getLastContactActivity(tenantId, contactId);
        setLastActivity(lastActivityData);
      } catch (err) {
        console.error('Error loading last activity:', err);
        setLastActivity(null);
      }
    };

    // Set up real-time listener for email_logs to refresh Recent Activity
    const emailsRef = collection(db, 'tenants', tenantId, 'email_logs');
    const emailsQuery = query(
      emailsRef,
      where('contactId', '==', contactId),
      orderBy('timestamp', 'desc'),
      limit(1)
    );
    
    const unsubscribeEmails = onSnapshot(emailsQuery, async () => {
      // Refresh last activity when new emails are logged
      await loadLastActivity();
    }, (err) => {
      console.warn('Error listening to email_logs:', err);
    });

    // Set up real-time listener for contact document to refresh Active Salespeople
    const contactRef = doc(db, 'tenants', tenantId, 'crm_contacts', contactId);
    const unsubscribeContact = onSnapshot(contactRef, (docSnapshot) => {
      if (docSnapshot.exists()) {
        const contactData = { id: docSnapshot.id, ...docSnapshot.data() } as ContactData;
        setContact(prev => prev ? { ...prev, ...contactData } : contactData);
      }
    }, (err) => {
      console.warn('Error listening to contact document:', err);
    });

    // Cleanup
    return () => {
      unsubscribeEmails();
      unsubscribeContact();
    };
  }, [tenantId, contactId]);

  // Initialize selected locations when contact or companyLocations change
  useEffect(() => {
    console.log('🔍 useEffect triggered - contact:', !!contact, 'companyLocations.length:', companyLocations.length);
    
    if (!contact || companyLocations.length === 0) {
      console.log('🔍 No contact or companyLocations, setting selectedLocations to []');
      setSelectedLocations([]);
      return;
    }

    const assocLocations = contact.associations?.locations || [];
    console.log('🔍 assocLocations:', assocLocations);
    const locations = [];
    
    // First, try to get locations from associations
    for (const locationId of assocLocations) {
      const location = companyLocations.find(loc => loc.id === locationId);
      console.log('🔍 Looking for locationId:', locationId, 'found:', !!location);
      if (location) {
        locations.push(location);
      }
    }
    
    // If no locations found in associations, check legacy locationId
    if (locations.length === 0 && contact.locationId) {
      console.log('🔍 No locations in associations, checking legacy locationId:', contact.locationId);
      const legacyLocation = companyLocations.find(loc => loc.id === contact.locationId);
      console.log('🔍 Legacy location found:', !!legacyLocation);
      if (legacyLocation) {
        locations.push(legacyLocation);
      }
    }
    
    console.log('🔍 Final locations to set:', locations);
    setSelectedLocations(locations);
  }, [contact, companyLocations]);

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

      // Clean undefined values from the processed value (especially important for Apollo enrichment data)
      processedValue = removeUndefinedValues(processedValue);

      // Firestore doesn't allow undefined; for booleans (e.g. isActive) always write true/false
      if (field === 'isActive') {
        processedValue = processedValue === true || processedValue === 'true';
      }

      const updatePayload: Record<string, any> = {
        [field]: processedValue,
        updatedAt: serverTimestamp()
      };

      await updateDoc(doc(db, 'tenants', tenantId, 'crm_contacts', contactId), updatePayload);

      // Log the activity (don't let logging failure mark the contact update as failed)
      try {
        await logger.aiEvent({
          eventType: 'contact.field_updated',
          actionType: 'contact_updated',
          targetType: 'contact',
          targetId: contactId,
          tenantId,
          userId: user.uid,
          contextType: 'contact_management',
          aiRelevant: true,
          urgencyScore: 6,
          reason: `Updated ${field}: ${processedValue}`,
          metadata: { field, value: processedValue }
        });
      } catch (logErr) {
        console.warn('Contact update logging failed:', logErr);
      }

      // Update local state
      setContact(prev => prev ? { ...prev, [field]: processedValue } : null);
      setError(''); // clear any previous error
      setAiSuccess('Contact updated successfully!');

      setTimeout(() => setAiSuccess(null), 3000);
    } catch (err) {
      console.error('Error updating contact:', err);
      setError('Failed to update contact. Please try again.');
    }
  };

  const handlePipelineUpdate = async (updates: Record<string, unknown>) => {
    if (!contactId || !tenantId || !contact || !user?.uid) return;
    try {
      const cleanUpdates = removeUndefinedValues(updates) as Record<string, unknown>;
      await updateDoc(doc(db, 'tenants', tenantId, 'crm_contacts', contactId), {
        ...cleanUpdates,
        updatedAt: new Date(),
      });
      setContact((prev) => (prev ? { ...prev, ...cleanUpdates } : null));
      setAiSuccess('Pipeline updated');
      setTimeout(() => setAiSuccess(null), 3000);
    } catch (err) {
      console.error('Error updating pipeline:', err);
      setError('Failed to update pipeline.');
    }
  };

  const handleCreateOpportunity = () => {
    if (!tenantId || !contact) return;
    const params = new URLSearchParams({
      contactId: contact.id ?? '',
      contactName: (contact.fullName || `${contact.firstName || ''} ${contact.lastName || ''}`.trim()) ?? '',
      companyName: contact.companyName ?? '',
      companyId: contact.companyId ?? '',
      locationId: contact.locationId ?? '',
      worksiteName: (contact as any).worksiteName ?? '',
    });
    navigate(`/crm?tab=1&new=1&${params.toString()}`);
  };

  // Utility function to remove undefined values from objects (Firestore doesn't allow undefined).
  // Primitives and Dates are returned as-is; avoids circular reference stack overflow.
  const removeUndefinedValues = (obj: any, _seen?: WeakSet<object>): any => {
    if (obj === null || obj === undefined) return null;
    // Primitives and Date: return as-is (no recursion)
    const t = typeof obj;
    if (t !== 'object') return obj;
    if (obj instanceof Date) return obj;

    const seen = _seen ?? new WeakSet<object>();
    if (seen.has(obj)) return null; // break circular reference
    seen.add(obj);

    if (Array.isArray(obj)) {
      const out = obj.map((item) => removeUndefinedValues(item, seen)).filter((item) => item !== null);
      return out;
    }

    const cleaned: any = {};
    for (const [key, value] of Object.entries(obj)) {
      const cleanedValue = removeUndefinedValues(value, seen);
      if (cleanedValue !== null) {
        cleaned[key] = cleanedValue;
      }
    }
    return cleaned;
  };

  const ensureUrlProtocol = (url: string): string => {
    if (!url || typeof url !== 'string') return url;
    const trimmed = url.trim();
    if (!trimmed) return url;
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
    if (/^[\d\s().\-+xX]+$/.test(trimmed) || (trimmed.length <= 20 && !trimmed.includes('.') && /\d{3}/.test(trimmed))) return '';
    return 'https://' + trimmed;
  };

  const handleDelete = async () => {
    if (!contactId || !tenantId) return;
    
    setDeleting(true);
    try {
      // Delete the contact document
      const contactRef = doc(db, 'tenants', tenantId, 'crm_contacts', contactId);
      await deleteDoc(contactRef);
      
      // Navigate back to contacts list
      navigate('/contacts');
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

      // Use the Apollo-powered contact enrichment function
      try {
        let resultData: any = null;
        const enrichContact = httpsCallable(functions, 'enrichContactOnDemand');
        const result = await enrichContact({ tenantId, contactId, mode: 'full', force: false });
        resultData = result.data as any;
        
        if (resultData.status === 'ok') {
          // Reload the contact to get the enhanced data
          const contactDoc = await getDoc(doc(db, 'tenants', tenantId, 'crm_contacts', contactId));
          let enhancedContactData: ContactData | null = null;
          if (contactDoc.exists()) {
            enhancedContactData = { id: contactDoc.id, ...contactDoc.data() } as ContactData;
            
            // Update contact fields with Apollo data if available
            if (enhancedContactData.apolloEnrichment?.person) {
              const apolloPerson = enhancedContactData.apolloEnrichment.person;
              
              // Debug: Log the Apollo person data
              console.log('🔍 Apollo Person Data:', apolloPerson);
              console.log('🔍 Available Apollo fields:', {
                photo_url: apolloPerson.photo_url,
                linkedin_url: apolloPerson.linkedin_url,
                email: apolloPerson.email,
                email_status: apolloPerson.email_status,
                headline: apolloPerson.headline,
                twitter_url: apolloPerson.twitter_url,
                facebook_url: apolloPerson.facebook_url,
                seniority: apolloPerson.seniority,
                formatted_address: apolloPerson.formatted_address,
                title: apolloPerson.title,
                city: apolloPerson.city,
                state: apolloPerson.state,
                country: apolloPerson.country,
                time_zone: apolloPerson.time_zone
              });
              
              const updates: any = {};
              
              // Update avatar from photo_url
              if (apolloPerson.photo_url) {
                updates.avatar = apolloPerson.photo_url;
              }
              
              // Update LinkedIn URL
              if (apolloPerson.linkedin_url) {
                updates.linkedInUrl = apolloPerson.linkedin_url;
              }
              
              // Update email if verified
              if (apolloPerson.email && apolloPerson.email_status === 'verified') {
                updates.email = apolloPerson.email;
              }
              
              // Update headline
              if (apolloPerson.headline) {
                updates.headline = apolloPerson.headline;
              }
              
              // Update Twitter URL
              if (apolloPerson.twitter_url) {
                updates.twitterUrl = apolloPerson.twitter_url;
              }
              
              // Update Facebook URL
              if (apolloPerson.facebook_url) {
                updates.facebookUrl = apolloPerson.facebook_url;
              }
              
              // Update inferred seniority
              if (apolloPerson.seniority) {
                updates.inferredSeniority = apolloPerson.seniority;
              }
              
              // Update location fields
              if (apolloPerson.formatted_address) {
                updates.formattedAddress = apolloPerson.formatted_address;
              }
              if (apolloPerson.city) {
                updates.city = apolloPerson.city;
              }
              if (apolloPerson.state) {
                updates.state = apolloPerson.state;
              }
              if (apolloPerson.country) {
                updates.country = apolloPerson.country;
              }
              if (apolloPerson.time_zone) {
                updates.timeZone = apolloPerson.time_zone;
              }
              
              // Update job title
              if (apolloPerson.title) {
                updates.jobTitle = apolloPerson.title;
                updates.title = apolloPerson.title;
              }
              
              // Apply updates if any
              if (Object.keys(updates).length > 0) {
                console.log('🔧 Applying Apollo updates:', updates);
                try {
                  await updateDoc(doc(db, 'tenants', tenantId, 'crm_contacts', contactId), {
                    ...updates,
                    updatedAt: new Date()
                  });
                  
                  // Update local state
                  enhancedContactData = { ...enhancedContactData, ...updates };
                  console.log('✅ Successfully updated contact with Apollo data:', updates);
                } catch (updateError) {
                  console.error('❌ Error updating contact with Apollo data:', updateError);
                }
              } else {
                console.log('ℹ️ No Apollo updates to apply - all fields already have data or Apollo data is missing');
              }
            }
            
            setContact(enhancedContactData);
          }
          
          // Log the AI enhancement activity
          try {
            const logContactEnhanced = httpsCallable(functions, 'logContactEnhanced');
            await logContactEnhanced({
              contactId: contactId,
              reason: 'Apollo AI enhancement completed',
              tenantId,
              userId: user?.uid || '',
              metadata: { 
                enhancedFields: enhancedContactData ? Object.keys(enhancedContactData) : [],
                hasProfessionalSummary: !!(enhancedContactData?.professionalSummary),
                hasInferredData: !!(enhancedContactData?.inferredSeniority || enhancedContactData?.inferredIndustry),
                hasApolloData: !!(enhancedContactData?.apolloEnrichment)
              }
            });
          } catch (logError) {
            console.warn('Failed to log AI enhancement activity:', logError);
          }
          
          // Count the number of fields that were updated
          const updatedFields = enhancedContactData?.apolloEnrichment?.person ? [
            enhancedContactData.apolloEnrichment.person.photo_url ? 'avatar' : null,
            enhancedContactData.apolloEnrichment.person.linkedin_url ? 'LinkedIn profile' : null,
            enhancedContactData.apolloEnrichment.person.email && enhancedContactData.apolloEnrichment.person.email_status === 'verified' ? 'email' : null,
            enhancedContactData.apolloEnrichment.person.headline ? 'professional headline' : null,
            enhancedContactData.apolloEnrichment.person.twitter_url ? 'Twitter profile' : null,
            enhancedContactData.apolloEnrichment.person.facebook_url ? 'Facebook profile' : null,
            enhancedContactData.apolloEnrichment.person.seniority ? 'seniority level' : null,
            enhancedContactData.apolloEnrichment.person.formatted_address ? 'location' : null,
            enhancedContactData.apolloEnrichment.person.title ? 'job title' : null
          ].filter(Boolean) : [];
          
          const fieldCount = updatedFields.length;
          const fieldList = updatedFields.join(', ');
          
          setAiSuccess(`Contact enhanced successfully with Apollo data! ${fieldCount > 0 ? `Updated: ${fieldList}` : 'No new fields to update'}.`);
        } else if (resultData.status === 'error') {
          setError(resultData.message || 'Failed to enhance contact with Apollo data');
        } else {
          // Handle other status types (like 'degraded')
          setAiSuccess(`Contact enhanced: ${resultData.message || 'Success'}`);
        }
        
      } catch (enrichError: any) {
        console.error('Apollo enrichment failed:', enrichError);
        
        // Handle specific error types
        if (enrichError.code === 'functions/unavailable') {
          setError('Service temporarily unavailable. Please try again in a moment.');
        } else if (enrichError.code === 'functions/deadline-exceeded') {
          setError('Request timed out. The enhancement is still processing in the background.');
        } else if (enrichError.message?.includes('timeout')) {
          setError('Request timed out. The enhancement may still be processing.');
        } else {
          setError('Failed to enhance contact with Apollo data. Please try again.');
        }
      }
      
    } catch (error) {
      console.error('Error enhancing with AI:', error);
      setError('Failed to enhance contact with AI. Please try again.');
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

  // Helper function to format location for display
  const getFormattedLocation = () => {
    // Priority: Apollo formatted address, then individual fields, then Apollo data
    if (contact?.formattedAddress) {
      return contact.formattedAddress;
    }
    
    if (contact?.apolloEnrichment?.person?.formatted_address) {
      return contact.apolloEnrichment.person.formatted_address;
    }
    
    // Build from individual fields
    const locationParts = [];
    if (contact?.city) locationParts.push(contact.city);
    if (contact?.state) locationParts.push(contact.state);
    if (contact?.country) locationParts.push(contact.country);
    
    if (locationParts.length > 0) {
      return locationParts.join(', ');
    }
    
    return null;
  };

  // Format timestamp for display
  const formatActivityTime = (timestamp: Date) => {
    const now = new Date();
    const diffMs = now.getTime() - timestamp.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} minute${diffMins !== 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
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
      const contactIds = Array.isArray(taskData.associations?.contacts)
        ? taskData.associations.contacts.map((c: any) => (typeof c === 'string' ? c : c?.id)).filter(Boolean)
        : [];
      const ensureContactId = contact?.id && !contactIds.includes(contact.id)
        ? [contact.id, ...contactIds]
        : contactIds.length ? contactIds : (contact?.id ? [contact.id] : []);

      // Create the task as completed; associate with this contact so it appears in Activity tab
      await taskService.createTask({
        ...taskData,
        tenantId,
        status: 'completed',
        completedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        associations: {
          ...taskData.associations,
          contacts: ensureContactId
        }
      });

      setShowLogActivityDialog(false);
      showToast('Activity logged successfully', 'success');
    } catch (error) {
      console.error('Error logging activity:', error);
      showToast('Failed to log activity', 'error');
    } finally {
      setLogActivityLoading(false);
    }
  };

  // Helper functions for contact display
  const getContactDisplayName = () => {
    if (contact?.fullName) return contact.fullName;
    if (contact?.firstName || contact?.lastName) {
      return `${contact.firstName || ''} ${contact.lastName || ''}`.trim();
    }
    return 'Unnamed Contact';
  };

  const getContactInitials = () => {
    const name = getContactDisplayName();
    if (!name) return '?';
    const parts = name.trim().split(' ');
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
    }
    return name[0].toUpperCase();
  };

  // Build associated salespeople list (prefer explicit associations, fallback to activeSalespeople)
  const associatedSalespeople = (() => {
    const ids = (contact?.associations?.salespeople || []) as any[];
    if (ids.length > 0) {
      const byId = new Map((salespeople || []).map((sp: any) => [sp.id, sp]));
      return ids.map((id) => byId.get(id)).filter(Boolean);
    }
    return (contact?.activeSalespeople || []) as any[];
  })();

  const handleUpdateMarketing = async (update: {
    industrySegment?: CrmContactIndustrySegment;
    marketingTags?: string[];
    marketingEnabled?: boolean;
  }) => {
    if (!tenantId || !contact) return;
    try {
      const contactRef = doc(db, 'tenants', tenantId, 'crm_contacts', contact.id);
      await updateDoc(contactRef, update as any);
      setContact((prev) => (prev ? ({ ...prev, ...update } as any) : prev));
      logger.info('contact_marketing_updated', { contactId: contact.id, ...update });
    } catch (e) {
      console.error('Failed to update marketing fields', e);
      setLocalError('Failed to update marketing fields');
    }
  };

  if (loading) {
    return (
      <Box sx={{ p: 3, display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '400px' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error || !contact) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">{error || 'Contact not found'}</Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* PageHeader with Record redesign */}
      <PageHeader
        title={
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2.5 }}>
              {/* Avatar - 108px × 108px */}
              <SafeAvatar
                src={contact.avatar || undefined}
                sx={{
                  width: 108,
                  height: 108,
                  bgcolor: contact.avatar ? 'transparent' : 'primary.main',
                  fontSize: '40px',
                  fontWeight: 600,
                  flexShrink: 0,
                }}
              >
                {getContactInitials()}
              </SafeAvatar>
              
              {/* Three-line content area - matches avatar height */}
              <Box sx={{ 
                flex: 1, 
                minWidth: 0, 
                display: 'flex', 
                flexDirection: 'column', 
                justifyContent: 'space-between', 
                minHeight: 108 
              }}>
                {/* Line 1: Name + Contact Type + Favorite Star */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 0, flexWrap: 'wrap' }}>
                  <Typography
                    variant="h6"
                    sx={{
                      fontSize: { xs: '20px', md: '24px' },
                      fontWeight: 700,
                      lineHeight: 1.2,
                    }}
                  >
                    {getContactDisplayName()}
                  </Typography>
                  {contact.contactType && (
                    <Chip
                      label={contact.contactType}
                      size="small"
                      color={contact.contactType === 'Decision Maker' ? 'success' : contact.contactType === 'Champion' ? 'primary' : 'default'}
                      sx={{
                        fontWeight: 500,
                        fontSize: '0.8125rem',
                        height: '28px',
                        borderRadius: 1,
                        // Match the green styling from Additional Details section
                        borderColor: contact.contactType === 'Decision Maker'
                          ? 'rgba(76, 175, 80, 0.3)'
                          : contact.contactType === 'Unknown'
                          ? 'rgba(255, 152, 0, 0.3)'
                          : 'rgba(33, 150, 243, 0.3)',
                        bgcolor: contact.contactType === 'Decision Maker'
                          ? 'rgba(76, 175, 80, 0.08)'
                          : contact.contactType === 'Unknown'
                          ? 'rgba(255, 152, 0, 0.08)'
                          : 'rgba(33, 150, 243, 0.08)',
                        color: contact.contactType === 'Decision Maker'
                          ? '#4CAF50'
                          : contact.contactType === 'Unknown'
                          ? '#FF9800'
                          : '#2196F3',
                        '&:hover': {
                          borderColor: contact.contactType === 'Decision Maker'
                            ? 'rgba(76, 175, 80, 0.5)'
                            : contact.contactType === 'Unknown'
                            ? 'rgba(255, 152, 0, 0.5)'
                            : 'rgba(33, 150, 243, 0.5)',
                          bgcolor: contact.contactType === 'Decision Maker'
                            ? 'rgba(76, 175, 80, 0.12)'
                            : contact.contactType === 'Unknown'
                            ? 'rgba(255, 152, 0, 0.12)'
                            : 'rgba(33, 150, 243, 0.12)',
                        }
                      }}
                    />
                  )}
                  <FormControl size="small" sx={{ minWidth: 140 }}>
                    <InputLabel>Pipeline</InputLabel>
                    <Select
                      value={(contact.pipelineStage ?? 'contact') as PipelineStage}
                      label="Pipeline"
                      onChange={(e) => handlePipelineUpdate({ pipelineStage: e.target.value as PipelineStage })}
                      sx={{
                        height: 32,
                        borderRadius: 1,
                        fontSize: '0.875rem',
                      }}
                    >
                      {PIPELINE_STAGES.map((s) => (
                        <MenuItem key={s} value={s}>
                          {PIPELINE_STAGE_LABELS[s]}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  <FavoriteButton
                    itemId={contact.id}
                    favoriteType="contacts"
                    isFavorite={isFavorite}
                    toggleFavorite={toggleFavorite}
                    size="medium"
                  />
                </Box>
                
                {/* Line 2: Contact Action Icons */}
                <Stack 
                  direction="row" 
                  spacing={0.5} 
                  alignItems="center" 
                  flexWrap="wrap" 
                  sx={{ mb: 0.5 }}
                >
                  {contact.email && (
                    <Tooltip title={gmailConnected ? `Email ${contact.email} (send via HRX)` : `Email ${contact.email} (open mail app)`}>
                      <IconButton
                        size="small"
                        onClick={() => {
                          if (gmailConnected) {
                            setMessageDrawerChannel('email');
                            setMessageDrawerOpen(true);
                          } else {
                            window.open(`mailto:${contact.email}`, '_blank');
                          }
                        }}
                        sx={{ 
                          p: 1,
                          color: 'primary.main',
                          bgcolor: 'action.hover',
                          borderRadius: 1,
                          '&:hover': {
                            color: 'primary.dark',
                            bgcolor: 'primary.light',
                            transform: 'translateY(-1px)',
                            boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                          },
                          transition: 'all 0.2s ease'
                        }}
                      >
                        <EmailOutlinedIcon sx={{ fontSize: 20 }} />
                      </IconButton>
                    </Tooltip>
                  )}
                  {(contact.phone || contact.workPhone) && (
                    <Tooltip title={`Call ${formatPhoneNumber(contact.phone || contact.workPhone || '')}`}>
                      <IconButton
                        size="small"
                        onClick={() => {
                          if (contact.phone || contact.workPhone) {
                            // Use cleaned phone number (digits only) for tel: link
                            const phoneDigits = (contact.phone || contact.workPhone || '').replace(/\D/g, '');
                            window.open(`tel:${phoneDigits}`, '_blank');
                          }
                        }}
                        sx={{ 
                          p: 1,
                          color: 'primary.main',
                          bgcolor: 'action.hover',
                          borderRadius: 1,
                          '&:hover': {
                            color: 'primary.dark',
                            bgcolor: 'primary.light',
                            transform: 'translateY(-1px)',
                            boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                          },
                          transition: 'all 0.2s ease'
                        }}
                      >
                        <PhoneIcon sx={{ fontSize: 20 }} />
                      </IconButton>
                    </Tooltip>
                  )}
                  {contact.linkedInUrl && (
                    <Tooltip title="View LinkedIn Profile">
                      <IconButton
                        size="small"
                        onClick={() => {
                          let url = contact.linkedInUrl!;
                          if (!url.startsWith('http://') && !url.startsWith('https://')) {
                            url = 'https://' + url;
                          }
                          window.open(url, '_blank');
                        }}
                        sx={{ 
                          p: 1,
                          color: 'primary.main',
                          bgcolor: 'action.hover',
                          borderRadius: 1,
                          '&:hover': {
                            color: 'primary.dark',
                            bgcolor: 'primary.light',
                            transform: 'translateY(-1px)',
                            boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                          },
                          transition: 'all 0.2s ease'
                        }}
                      >
                        <LinkedInIcon sx={{ fontSize: 20 }} />
                      </IconButton>
                    </Tooltip>
                  )}
                  {/* Website icon (right after LinkedIn per spec) */}
                  {contact.website && (
                    <Tooltip title={`Visit ${contact.website}`}>
                      <IconButton
                        size="small"
                        onClick={() => {
                          let url = contact.website!;
                          if (!url.startsWith('http://') && !url.startsWith('https://')) {
                            url = 'https://' + url;
                          }
                          window.open(url, '_blank');
                        }}
                        sx={{ 
                          p: 1,
                          color: 'primary.main',
                          bgcolor: 'action.hover',
                          borderRadius: 1,
                          '&:hover': {
                            color: 'primary.dark',
                            bgcolor: 'primary.light',
                            transform: 'translateY(-1px)',
                            boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                          },
                          transition: 'all 0.2s ease'
                        }}
                      >
                        <LanguageIcon sx={{ fontSize: 20 }} />
                      </IconButton>
                    </Tooltip>
                  )}
                  {/* Add Note Icon Button */}
                  <Tooltip title={notesCount > 0 ? `${notesCount} note${notesCount !== 1 ? 's' : ''}` : 'Add note'}>
                    <Badge badgeContent={notesCount > 0 ? notesCount : undefined} color="primary">
                      <IconButton
                        size="small"
                        onClick={() => setShowAddNoteDialog(true)}
                        sx={{ 
                          p: 1,
                          color: 'primary.main',
                          bgcolor: 'action.hover',
                          borderRadius: 1,
                          '&:hover': {
                            color: 'primary.dark',
                            bgcolor: 'primary.light',
                            transform: 'translateY(-1px)',
                            boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                          },
                          transition: 'all 0.2s ease'
                        }}
                      >
                        <NoteIcon sx={{ fontSize: 20 }} />
                      </IconButton>
                    </Badge>
                  </Tooltip>
                  {/* AI Enhance Icon Button */}
                  <Tooltip title={aiEnhancing ? 'Enhancing...' : 'AI Enhance'}>
                    {/* Tooltip won't trigger on disabled buttons; wrap in span per MUI guidance */}
                    <span style={{ display: 'inline-flex' }}>
                      <IconButton
                        size="small"
                        onClick={handleAIEnhancement}
                        disabled={aiEnhancing}
                        sx={{ 
                          p: 1,
                          color: 'primary.main',
                          bgcolor: 'action.hover',
                          borderRadius: 1,
                          '&:hover': {
                            color: 'primary.dark',
                            bgcolor: 'primary.light',
                            transform: 'translateY(-1px)',
                            boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                          },
                          '&:disabled': {
                            opacity: 0.6
                          },
                          transition: 'all 0.2s ease'
                        }}
                      >
                        {aiEnhancing ? (
                          <CircularProgress size={16} sx={{ color: 'primary.main' }} />
                        ) : (
                          <AutoAwesomeIcon sx={{ fontSize: 20 }} />
                        )}
                      </IconButton>
                    </span>
                  </Tooltip>
                  {/* Add Task Icon Button */}
                  <Tooltip title="Add Task">
                    <IconButton
                      size="small"
                      onClick={() => setShowTaskDialog(true)}
                      sx={{ 
                        p: 1,
                        color: 'primary.main',
                        bgcolor: 'action.hover',
                        borderRadius: 1,
                        '&:hover': {
                          color: 'primary.dark',
                          bgcolor: 'primary.light',
                          transform: 'translateY(-1px)',
                          boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                        },
                        transition: 'all 0.2s ease'
                      }}
                    >
                      <AddTaskIcon sx={{ fontSize: 20 }} />
                    </IconButton>
                  </Tooltip>
                  {/* Log Activity Icon Button */}
                  <Tooltip title="Log Activity">
                    <IconButton
                      size="small"
                      onClick={() => setShowLogActivityDialog(true)}
                      sx={{ 
                        p: 1,
                        color: 'primary.main',
                        bgcolor: 'action.hover',
                        borderRadius: 1,
                        '&:hover': {
                          color: 'primary.dark',
                          bgcolor: 'primary.light',
                          transform: 'translateY(-1px)',
                          boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                        },
                        transition: 'all 0.2s ease'
                      }}
                    >
                      <CheckCircleIcon sx={{ fontSize: 20 }} />
                    </IconButton>
                  </Tooltip>
                </Stack>
                
                {/* Address line (City, State) */}
                {(() => {
                  const direct = [contact.city, contact.state].filter(Boolean).join(', ');
                  if (direct) {
                    return (
                      <Typography
                        variant="body2"
                        sx={{
                          fontSize: '14px',
                          fontWeight: 400,
                          color: 'rgba(0, 0, 0, 0.55)',
                          mt: 0,
                          mb: 0.5,
                        }}
                      >
                        {direct}
                      </Typography>
                    );
                  }

                  const fallback = contact.formattedAddress || contact.address || '';
                  const parts = fallback
                    .split(',')
                    .map((p) => p.trim())
                    .filter(Boolean);
                  const guess = parts.length >= 2 ? `${parts[0]}, ${parts[1]}` : '';
                  if (!guess) return null;

                  return (
                    <Typography
                      variant="body2"
                      sx={{
                        fontSize: '14px',
                        fontWeight: 400,
                        color: 'rgba(0, 0, 0, 0.55)',
                        mt: 0,
                        mb: 0.5,
                      }}
                    >
                      {guess}
                    </Typography>
                  );
                })()}

                {/* Line 3: Connections (replaces email/ID/date row) */}
                <Stack
                  direction="row"
                  spacing={2}
                  alignItems="center"
                  flexWrap="wrap"
                  sx={{ mt: 0 }}
                >
                  {/* Company */}
                  {(company?.id || contact.companyId) && (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <BusinessIcon sx={{ fontSize: 18, color: 'rgba(0,0,0,0.45)' }} />
                      <Typography
                        variant="body2"
                        sx={{
                          fontSize: '14px',
                          fontWeight: 600,
                          color: 'rgb(74, 144, 226)',
                          cursor: 'pointer',
                          '&:hover': { textDecoration: 'underline' },
                        }}
                        onClick={() => {
                          const id = company?.id || contact.companyId;
                          if (id) navigate(`/companies/${id}`);
                        }}
                      >
                        {company?.companyName || company?.name || contact.companyName || 'Company'}
                      </Typography>
                    </Box>
                  )}

                  {/* Locations */}
                  {selectedLocations.length > 0 && (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <LocationIcon sx={{ fontSize: 18, color: 'rgba(0,0,0,0.45)' }} />
                      <Typography variant="body2" sx={{ fontSize: '14px', color: 'rgba(0,0,0,0.55)', fontWeight: 500 }}>
                        {selectedLocations.slice(0, 2).map((loc: any, idx: number) => {
                          const locationName = loc.nickname || loc.name || loc.title || 'Location';
                          const cityState = [loc.city, loc.state].filter(Boolean).join(', ');
                          const displayText = cityState ? `${locationName} - ${cityState}` : locationName;
                          
                          return (
                            <React.Fragment key={loc.id || idx}>
                              <Typography
                                component="span"
                                sx={{
                                  color: 'rgb(74, 144, 226)',
                                  cursor: company?.id ? 'pointer' : 'default',
                                  fontWeight: 600,
                                  '&:hover': company?.id ? { textDecoration: 'underline' } : undefined,
                                }}
                                onClick={() => {
                                  if (company?.id) navigate(`/companies/${company.id}/locations/${loc.id}`);
                                }}
                              >
                                {displayText}
                              </Typography>
                              {idx < Math.min(2, selectedLocations.length) - 1 ? ', ' : ''}
                            </React.Fragment>
                          );
                        })}
                        {selectedLocations.length > 2 ? ` +${selectedLocations.length - 2}` : ''}
                      </Typography>
                    </Box>
                  )}

                  {/* Deals */}
                  {(associationsData.entities.deals || []).length > 0 && (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <DealIcon sx={{ fontSize: 18, color: 'rgba(0,0,0,0.45)' }} />
                      <Typography variant="body2" sx={{ fontSize: '14px', color: 'rgba(0,0,0,0.55)', fontWeight: 500 }}>
                        {(associationsData.entities.deals || []).slice(0, 2).map((d: any, idx: number) => (
                          <React.Fragment key={d.id || idx}>
                            <Typography
                              component="span"
                              sx={{
                                color: 'rgb(74, 144, 226)',
                                cursor: 'pointer',
                                fontWeight: 600,
                                '&:hover': { textDecoration: 'underline' },
                              }}
                              onClick={() => navigate(`/crm/deals/${d.id}`)}
                            >
                              {d.name || d.title || 'Deal'}
                            </Typography>
                            {idx < Math.min(2, (associationsData.entities.deals || []).length) - 1 ? ', ' : ''}
                          </React.Fragment>
                        ))}
                        {(associationsData.entities.deals || []).length > 2 ? ` +${(associationsData.entities.deals || []).length - 2}` : ''}
                      </Typography>
                    </Box>
                  )}

                  {/* Job Orders */}
                  {jobOrders.length > 0 && (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <WorkIcon sx={{ fontSize: 18, color: 'rgba(0,0,0,0.45)' }} />
                      <Typography variant="body2" sx={{ fontSize: '14px', color: 'rgba(0,0,0,0.55)', fontWeight: 500 }}>
                        {jobOrders.slice(0, 2).map((jo: any, idx: number) => (
                          <React.Fragment key={jo.id || idx}>
                            <Typography
                              component="span"
                              sx={{
                                color: 'rgb(74, 144, 226)',
                                cursor: 'pointer',
                                fontWeight: 600,
                                '&:hover': { textDecoration: 'underline' },
                              }}
                              onClick={() => navigate(`/crm/job-orders/${jo.id}`)}
                            >
                              {jo.jobOrderName || jo.jobTitle || 'Job Order'}
                            </Typography>
                            {idx < Math.min(2, jobOrders.length) - 1 ? ', ' : ''}
                          </React.Fragment>
                        ))}
                        {jobOrders.length > 2 ? ` +${jobOrders.length - 2}` : ''}
                      </Typography>
                    </Box>
                  )}

                  {/* Salespeople */}
                  {associatedSalespeople.length > 0 && (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <PersonIcon sx={{ fontSize: 18, color: 'rgba(0,0,0,0.45)' }} />
                      <Typography variant="body2" sx={{ fontSize: '14px', color: 'rgba(0,0,0,0.55)', fontWeight: 500 }}>
                        {associatedSalespeople.slice(0, 2).map((sp: any, idx: number) => (
                          <React.Fragment key={sp.id || idx}>
                            <Typography component="span" sx={{ fontWeight: 600 }}>
                              {sp.displayName || `${sp.firstName || ''} ${sp.lastName || ''}`.trim() || sp.email || 'Salesperson'}
                            </Typography>
                            {idx < Math.min(2, associatedSalespeople.length) - 1 ? ', ' : ''}
                          </React.Fragment>
                        ))}
                        {associatedSalespeople.length > 2 ? ` +${associatedSalespeople.length - 2}` : ''}
                      </Typography>
                    </Box>
                  )}
                </Stack>

                {/* Line 4: Marketing (tags + segment) */}
                <ContactHeaderMarketing
                  contact={{
                    companyName: contact.companyName,
                    jobTitle: contact.jobTitle || contact.title,
                    marketingTags: contact.marketingTags || [],
                    industrySegment: contact.industrySegment,
                    marketingEnabled: contact.marketingEnabled,
                  }}
                  onUpdateMarketing={handleUpdateMarketing}
                />

                {/* Line 5: Professional Headline */}
                {contact.headline && (
                  <Typography 
                    variant="body2" 
                    color="text.secondary" 
                    sx={{ 
                      fontStyle: 'italic',
                      mt: 1,
                      fontSize: '0.875rem',
                      lineHeight: 1.5,
                    }}
                  >
                    {contact.headline}
                  </Typography>
                )}
              </Box>
            </Box>
          </Box>
        }
        filters={
          <Box
            sx={{
              px: 2,
              py: 1.25,
              backgroundColor: '#F9FAFB',
              borderRadius: 2,
              border: '1px solid #EAEEF4',
              overflowX: 'auto',
              overflowY: 'hidden',
              '&::-webkit-scrollbar': { height: '6px' },
              '&::-webkit-scrollbar-track': { background: 'rgba(0, 0, 0, 0.02)', borderRadius: '4px' },
              '&::-webkit-scrollbar-thumb': {
                background: 'rgba(0, 0, 0, 0.15)',
                borderRadius: '4px',
                '&:hover': { background: 'rgba(0, 0, 0, 0.25)' },
              },
              scrollbarWidth: 'thin',
              scrollbarColor: 'rgba(0, 0, 0, 0.15) rgba(0, 0, 0, 0.02)',
            }}
          >
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'nowrap', minWidth: 'max-content' }}>
              <Button
                variant={tabValue === 0 ? 'contained' : 'text'}
                onClick={() => setTabValue(0)}
                startIcon={<DashboardIcon fontSize="small" />}
                sx={{
                  borderRadius: '18px',
                  textTransform: 'none',
                  fontWeight: 500,
                  px: 2.5,
                  py: 0.75,
                  height: 36,
                  ...(tabValue === 0 ? { backgroundColor: '#0B63C5', color: 'white', '&:hover': { backgroundColor: '#0B63C5' } } : { color: '#6B7280', backgroundColor: 'white', border: '1px solid #E5E7EB', '&:hover': { backgroundColor: '#F3F4F6' } }),
                }}
              >
                Overview
              </Button>
              <Button
                variant={tabValue === 1 ? 'contained' : 'text'}
                onClick={() => setTabValue(1)}
                startIcon={<AddTaskIcon fontSize="small" />}
                sx={{
                  borderRadius: '18px',
                  textTransform: 'none',
                  fontWeight: 500,
                  px: 2.5,
                  py: 0.75,
                  height: 36,
                  ...(tabValue === 1 ? { backgroundColor: '#0B63C5', color: 'white', '&:hover': { backgroundColor: '#0B63C5' } } : { color: '#6B7280', backgroundColor: 'white', border: '1px solid #E5E7EB', '&:hover': { backgroundColor: '#F3F4F6' } }),
                }}
              >
                Tasks
              </Button>
              <Button
                variant={tabValue === 2 ? 'contained' : 'text'}
                onClick={() => setTabValue(2)}
                startIcon={<NotesIcon fontSize="small" />}
                sx={{
                  borderRadius: '18px',
                  textTransform: 'none',
                  fontWeight: 500,
                  px: 2.5,
                  py: 0.75,
                  height: 36,
                  ...(tabValue === 2 ? { backgroundColor: '#0B63C5', color: 'white', '&:hover': { backgroundColor: '#0B63C5' } } : { color: '#6B7280', backgroundColor: 'white', border: '1px solid #E5E7EB', '&:hover': { backgroundColor: '#F3F4F6' } }),
                }}
              >
                Notes
              </Button>
              <Button
                variant={tabValue === 3 ? 'contained' : 'text'}
                onClick={() => setTabValue(3)}
                startIcon={<TimelineIcon fontSize="small" />}
                sx={{
                  borderRadius: '18px',
                  textTransform: 'none',
                  fontWeight: 500,
                  px: 2.5,
                  py: 0.75,
                  height: 36,
                  ...(tabValue === 3 ? { backgroundColor: '#0B63C5', color: 'white', '&:hover': { backgroundColor: '#0B63C5' } } : { color: '#6B7280', backgroundColor: 'white', border: '1px solid #E5E7EB', '&:hover': { backgroundColor: '#F3F4F6' } }),
                }}
              >
                Activity
              </Button>
            </Box>
          </Box>
        }
        showDivider={false}
        rightActions={
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
            <UniversalBackButton
              onClick={() => navigate(company ? `/companies/${company.id}?tab=2` : '/contacts')}
            />
            <Tooltip title="Open Sales Coach">
              <IconButton
                onClick={() => {
                  if (contact && tenantId) {
                    const contactName = contact.fullName || contact.firstName || contact.lastName || 'Contact';
                    console.log('[ContactDetails] Opening Sales Coach for:', contactName, contact.id);
                    openChatGPT({
                      type: 'sales_coach',
                      entityType: 'contact',
                      entityId: contact.id,
                      entityName: contactName,
                      tenantId: tenantId,
                      contactCompany: company?.companyName || company?.name,
                      contactTitle: contact.jobTitle || contact.title,
                      associations: contact.associations,
                    });
                  }
                }}
                sx={{
                  backgroundColor: 'transparent !important',
                  color: 'rgba(255,255,255,.8)',
                  '&:hover': { 
                    backgroundColor: 'transparent !important',
                    color: '#FFFFFF',
                  },
                }}
              >
                <RocketLaunchIcon sx={{ fontSize: 20 }} />
              </IconButton>
            </Tooltip>
          </Box>
        }
      />

      {/* Success/Error Alerts */}
      {aiSuccess && (
        <Box sx={{ px: { xs: 2, md: 3 }, pt: 2 }}>
          <Alert severity="success" onClose={() => setAiSuccess(null)}>
            {aiSuccess}
          </Alert>
        </Box>
      )}

      {/* Tab Panels */}
      <TabPanel value={tabValue} index={0}>
        <Grid container spacing={3}>
          {/* Left Column - Contact Details & Core Info */}
          <Grid item xs={12} md={8}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {/* Pipeline Stage: Prospect/Lead notes and actions */}
              <PipelineStageContainer
                contact={{
                  id: contact.id,
                  contactName: contact.fullName || `${contact.firstName || ''} ${contact.lastName || ''}`.trim(),
                  fullName: contact.fullName,
                  companyName: contact.companyName,
                  companyId: contact.companyId,
                  locationId: contact.locationId,
                  pipelineStage: contact.pipelineStage ?? 'contact',
                  prospectFollowPlan: contact.prospectFollowPlan,
                  leadTiming: contact.leadTiming,
                  leadVolume: contact.leadVolume,
                  leadNotes: contact.leadNotes,
                }}
                onUpdate={handlePipelineUpdate}
                onCreateOpportunity={handleCreateOpportunity}
              />

              {/* AI Summary */}
              {/* <Card>
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
              </Card> */}

              {/* Professional Headline */}
              {/* <Card>
                <CardHeader 
                  title="Professional Headline" 
                  titleTypographyProps={{ variant: 'h6', fontWeight: 'bold' }}
                  action={
                    <Chip 
                      label="Apollo" 
                      size="small" 
                      color="primary" 
                      variant="outlined"
                    />
                  }
                />
                <CardContent sx={{ p: 2 }}>
                  {contact?.headline ? (
                    <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.4 }}>
                      {contact.headline}
                    </Typography>
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      No professional headline available. Use AI Enhance to fetch from Apollo.
                    </Typography>
                  )}
                </CardContent>
              </Card> */}

              {/* Apollo Enrichment Data */}
              {/* {contact?.apolloEnrichment && (
                <Card>
                  <CardHeader 
                    title="Apollo Data" 
                    titleTypographyProps={{ variant: 'h6', fontWeight: 'bold' }}
                    action={
                      <Chip 
                        label="Apollo" 
                        size="small" 
                        color="primary" 
                        variant="outlined"
                      />
                    }
                  />
                  <CardContent sx={{ p: 2 }}>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>

              
                      {contact.apolloEnrichment.person?.formatted_address && (
                        <Box>
                          <Typography variant="subtitle2" fontWeight="medium" color="text.primary" gutterBottom>
                            Location
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            {contact.apolloEnrichment.person.formatted_address}
                          </Typography>
                        </Box>
                      )}

             
                      {contact.apolloEnrichment.person?.linkedin_url && (
                        <Box>
                          <Typography variant="subtitle2" fontWeight="medium" color="text.primary" gutterBottom>
                            Social Profiles
                          </Typography>
                          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                            <MUILink href={contact.apolloEnrichment.person.linkedin_url} target="_blank" rel="noopener noreferrer">
                              <Typography variant="body2" color="primary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                <LinkedInIcon fontSize="small" />
                                LinkedIn Profile
                              </Typography>
                            </MUILink>
                            {contact.apolloEnrichment.person.twitter_url && (
                              <MUILink href={contact.apolloEnrichment.person.twitter_url} target="_blank" rel="noopener noreferrer">
                                <Typography variant="body2" color="primary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                  <TwitterIcon fontSize="small" />
                                  Twitter Profile
                                </Typography>
                              </MUILink>
                            )}
                          </Box>
                        </Box>
                      )}
                      {contact.apolloEnrichment.person?.employment_history && contact.apolloEnrichment.person.employment_history.length > 0 && (
                        <Box>
                          <Typography variant="subtitle2" fontWeight="medium" color="text.primary" gutterBottom>
                            Recent Experience
                          </Typography>
                          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                            {contact.apolloEnrichment.person.employment_history.slice(0, 2).map((job: any, index: number) => (
                              <Box key={index} sx={{ p: 1, bgcolor: 'grey.50', borderRadius: 1 }}>
                                <Typography variant="body2" fontWeight="medium">
                                  {toChipLabel(job.title)} at {toChipLabel(job.organization_name)}
                                </Typography>
                                <Typography variant="caption" color="text.secondary">
                                  {toChipLabel(job.start_date)} - {job.current ? 'Present' : toChipLabel(job.end_date) || 'Unknown'}
                                </Typography>
                              </Box>
                            ))}
                          </Box>
                        </Box>
                      )}

        
                      {contact.apolloEnrichment.company && (
                        <Box>
                          <Typography variant="subtitle2" fontWeight="medium" color="text.primary" gutterBottom>
                            Company Details
                          </Typography>
                          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                            {contact.apolloEnrichment.company.industry && (
                              <Typography variant="body2" color="text.secondary">
                                <strong>Industry:</strong> {contact.apolloEnrichment.company.industry}
                              </Typography>
                            )}
                            {contact.apolloEnrichment.company.employeeCount && (
                              <Typography variant="body2" color="text.secondary">
                                <strong>Employees:</strong> {contact.apolloEnrichment.company.employeeCount.toLocaleString()}
                              </Typography>
                            )}
                            {contact.apolloEnrichment.company.revenueRange && (
                              <Typography variant="body2" color="text.secondary">
                                <strong>Revenue:</strong> {contact.apolloEnrichment.company.revenueRange}
                              </Typography>
                            )}
                          </Box>
                        </Box>
                      )}

         
                      <Box sx={{ mt: 1, pt: 1, borderTop: '1px solid', borderColor: 'divider' }}>
                        <Typography variant="caption" color="text.secondary">
                          Data provided by Apollo.io
                          {contact.apolloEnrichment.fetchedAt && (
                            <span> • Fetched {new Date(contact.apolloEnrichment.fetchedAt.toDate()).toLocaleDateString()}</span>
                          )}
                        </Typography>
                      </Box>
                    </Box>
                  </CardContent>
                </Card>
              )} */}

              {/* Professional Summary (moved from center column) */}
              {contact?.professionalSummary && String(contact.professionalSummary).trim() !== '' && (
                <Card>
                  <CardHeader 
                    title="Professional Summary" 
                    titleTypographyProps={{ variant: 'h6', fontWeight: 'bold' }}
                  />
                  <CardContent sx={{ p: 2 }}>
                    <Typography 
                      variant="body2" 
                      color="text.secondary" 
                      sx={{ lineHeight: 1.5, whiteSpace: 'pre-wrap' }}
                    >
                      {String(contact.professionalSummary)}
                    </Typography>
                  </CardContent>
                </Card>
              )}

              {/* Contact Details (Combined Widget) */}
              <Card>
                <CardHeader 
                  title="Contact Details" 
                  titleTypographyProps={{ variant: 'h6', fontWeight: 'bold' }}
                  action={
                    <IconButton
                      size="small"
                      onClick={() => setIsEditingContactDetails(!isEditingContactDetails)}
                      sx={{ 
                        color: isEditingContactDetails ? 'primary.main' : 'text.secondary',
                        '&:hover': {
                          bgcolor: 'action.hover'
                        }
                      }}
                    >
                      <EditIcon fontSize="small" />
                    </IconButton>
                  }
                />
                <CardContent sx={{ p: 2 }}>
                  {isEditingContactDetails ? (
                    // Edit Mode - Show Input Fields
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
                          // Update company suggestions based on email domain
                          if (next && next.includes('@')) {
                            const suggestions = findCompaniesByEmailDomain(next);
                            setSuggestedCompanies(suggestions);
                          }
                        }
                      }}
                      fullWidth
                      size="small"
                      InputProps={{ startAdornment: <EmailIcon sx={{ fontSize: 16, mr: 1, color: 'text.secondary' }} /> }}
                    />
                    
                    <TextField
                      label="Phone"
                      defaultValue={formatPhoneNumber(contact.phone || contact.workPhone || '')}
                      onBlur={(e) => {
                        const next = (e.target.value || '').trim();
                        // Store cleaned version (digits only) but display formatted
                        const cleaned = next.replace(/\D/g, '');
                        if ((contact.phone || contact.workPhone || '').replace(/\D/g, '') !== cleaned) {
                          handleContactUpdate('phone', cleaned);
                        }
                      }}
                      fullWidth
                      size="small"
                      InputProps={{ startAdornment: <PhoneIcon sx={{ fontSize: 16, mr: 1, color: 'text.secondary' }} /> }}
                    />
                    <TextField
                      label="Mobile"
                      defaultValue={formatPhoneNumber(contact.mobilePhone || '')}
                      onBlur={(e) => {
                        const next = (e.target.value || '').trim();
                        // Store cleaned version (digits only) but display formatted
                        const cleaned = next.replace(/\D/g, '');
                        if ((contact.mobilePhone || '').replace(/\D/g, '') !== cleaned) {
                          handleContactUpdate('mobilePhone', cleaned);
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
                    <TextField
                      label="Website"
                      defaultValue={contact.website || ''}
                      onBlur={(e) => {
                        const next = (e.target.value || '').trim();
                        if ((contact.website || '') !== next) {
                          handleContactUpdate('website', next);
                        }
                      }}
                      fullWidth
                      size="small"
                      InputProps={{ startAdornment: <LanguageIcon sx={{ fontSize: 16, mr: 1, color: 'text.secondary' }} /> }}
                    />
                    <TextField
                      label="Twitter URL"
                      defaultValue={contact.twitterUrl || ''}
                      onBlur={(e) => {
                        const next = (e.target.value || '').trim();
                        if ((contact.twitterUrl || '') !== next) {
                          handleContactUpdate('twitterUrl', next);
                        }
                      }}
                      fullWidth
                      size="small"
                      InputProps={{ startAdornment: <TwitterIcon sx={{ fontSize: 16, mr: 1, color: 'text.secondary' }} /> }}
                    />
                    <TextField
                      label="Facebook URL"
                      defaultValue={contact.facebookUrl || ''}
                      onBlur={(e) => {
                        const next = (e.target.value || '').trim();
                        if ((contact.facebookUrl || '') !== next) {
                          handleContactUpdate('facebookUrl', next);
                        }
                      }}
                      fullWidth
                      size="small"
                      InputProps={{ startAdornment: <FacebookIcon sx={{ fontSize: 16, mr: 1, color: 'text.secondary' }} /> }}
                    />
                    <TextField
                      label="Instagram URL"
                      defaultValue={contact.instagramUrl || ''}
                      onBlur={(e) => {
                        const next = (e.target.value || '').trim();
                        if ((contact.instagramUrl || '') !== next) {
                          handleContactUpdate('instagramUrl', next);
                        }
                      }}
                      fullWidth
                      size="small"
                      InputProps={{ startAdornment: <InstagramIcon sx={{ fontSize: 16, mr: 1, color: 'text.secondary' }} /> }}
                    />
                    <TextField
                      label="Professional Headline"
                      defaultValue={contact.headline || ''}
                      onBlur={(e) => {
                        const next = (e.target.value || '').trim();
                        if ((contact.headline || '') !== next) {
                          handleContactUpdate('headline', next);
                        }
                      }}
                      fullWidth
                      size="small"
                      multiline
                      rows={2}
                      placeholder="e.g., Bilingual HR Business Partner | Client Services | Passionate about customer service..."
                    />
                    <TextField
                      label="Birthday"
                      type="date"
                      defaultValue={contact.birthday ? new Date(contact.birthday).toISOString().split('T')[0] : ''}
                      onBlur={(e) => {
                        const next = (e.target.value || '').trim();
                        if ((contact.birthday ? new Date(contact.birthday).toISOString().split('T')[0] : '') !== next) {
                          handleContactUpdate('birthday', next || null);
                        }
                      }}
                      fullWidth
                      size="small"
                      InputLabelProps={{ shrink: true }}
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

                    {/* Contact Address Information */}
                    {selectedLocations.length > 0 ? (
                      // Show address from worksite locations
                      <Box>
                        <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                          Address (from Work Locations)
                        </Typography>
                        {selectedLocations.map((location, idx) => (
                          <Box key={location.id} sx={{ mb: 2, p: 1.5, bgcolor: 'grey.50', borderRadius: 1, border: '1px solid', borderColor: 'divider' }}>
                            <Typography variant="body2" fontWeight="medium" color="text.primary" gutterBottom>
                              {location.nickname || location.name || location.title || 'Location'} {selectedLocations.length > 1 && `(${idx + 1})`}
                            </Typography>
                            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                              {location.address && (
                                <Typography variant="body2" color="text.secondary">
                                  {location.address}
                                </Typography>
                              )}
                              {(location.city || location.state || location.country) && (
                                <Typography variant="body2" color="text.secondary">
                                  {[location.city, location.state, location.country].filter(Boolean).join(', ')}
                                </Typography>
                              )}
                              {location.zipcode && (
                                <Typography variant="body2" color="text.secondary">
                                  {location.zipcode}
                                </Typography>
                              )}
                            </Box>
                            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block', fontStyle: 'italic' }}>
                              Address is managed via the work location above. Edit the location to change this address.
                            </Typography>
                          </Box>
                        ))}
                        <TextField
                          label="Time Zone"
                          defaultValue={contact.timeZone || ''}
                          onBlur={(e) => {
                            const next = (e.target.value || '').trim();
                            if ((contact.timeZone || '') !== next) {
                              handleContactUpdate('timeZone', next);
                            }
                          }}
                          fullWidth
                          size="small"
                          placeholder="e.g., America/Los_Angeles"
                          sx={{ mt: 1 }}
                        />
                      </Box>
                    ) : (
                      // Show editable address fields when no worksite locations
                      <Box>
                        <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                          Contact Address
                        </Typography>
                        <TextField
                          label="Street Address"
                          defaultValue={contact.address || ''}
                          onBlur={(e) => {
                            const next = (e.target.value || '').trim();
                            if ((contact.address || '') !== next) {
                              handleContactUpdate('address', next);
                            }
                          }}
                          fullWidth
                          size="small"
                          sx={{ mb: 1 }}
                          InputProps={{ startAdornment: <LocationIcon sx={{ fontSize: 16, mr: 1, color: 'text.secondary' }} /> }}
                        />
                        <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
                          <TextField
                            label="City"
                            defaultValue={contact.city || ''}
                            onBlur={(e) => {
                              const next = (e.target.value || '').trim();
                              if ((contact.city || '') !== next) {
                                handleContactUpdate('city', next);
                              }
                            }}
                            fullWidth
                            size="small"
                          />
                          <TextField
                            label="State"
                            defaultValue={contact.state || ''}
                            onBlur={(e) => {
                              const next = (e.target.value || '').trim();
                              if ((contact.state || '') !== next) {
                                handleContactUpdate('state', next);
                              }
                            }}
                            fullWidth
                            size="small"
                          />
                          <TextField
                            label="Zip Code"
                            defaultValue={contact.zipcode || ''}
                            onBlur={(e) => {
                              const next = (e.target.value || '').trim();
                              if ((contact.zipcode || '') !== next) {
                                handleContactUpdate('zipcode', next);
                              }
                            }}
                            fullWidth
                            size="small"
                          />
                        </Box>
                        <TextField
                          label="Country"
                          defaultValue={contact.country || ''}
                          onBlur={(e) => {
                            const next = (e.target.value || '').trim();
                            if ((contact.country || '') !== next) {
                              handleContactUpdate('country', next);
                            }
                          }}
                          fullWidth
                          size="small"
                          sx={{ mb: 1 }}
                        />
                        <TextField
                          label="Time Zone"
                          defaultValue={contact.timeZone || ''}
                          onBlur={(e) => {
                            const next = (e.target.value || '').trim();
                            if ((contact.timeZone || '') !== next) {
                              handleContactUpdate('timeZone', next);
                            }
                          }}
                          fullWidth
                          size="small"
                          placeholder="e.g., America/Los_Angeles"
                        />
                        {contact.formattedAddress && (
                          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                            Formatted: {contact.formattedAddress}
                          </Typography>
                        )}
                      </Box>
                    )}



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
                  ) : (
                    // View Mode - Show as Read-Only Text with Better Visual Hierarchy
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      {/* Contact Information Section */}
                      <Box>
                        <Typography variant="subtitle2" fontWeight={600} color="text.primary" sx={{ mb: 2, fontSize: '0.875rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                          Contact Information
                        </Typography>
                        <Grid container spacing={2}>
                          {(contact.fullName || contact.firstName || contact.lastName) && (
                            <Grid item xs={12} sm={6}>
                              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                                <PersonIcon sx={{ fontSize: 18, color: 'text.secondary', mt: 0.5, flexShrink: 0 }} />
                                <Box sx={{ flex: 1, minWidth: 0 }}>
                                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', fontWeight: 500 }}>
                                    Full Name
                                  </Typography>
                                  <Typography variant="body1" sx={{ mt: 0.25, fontWeight: 500 }}>
                                    {contact.fullName || `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || '-'}
                                  </Typography>
                                </Box>
                              </Box>
                            </Grid>
                          )}
                          {contact.email && (
                            <Grid item xs={12} sm={6}>
                              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                                <EmailIcon sx={{ fontSize: 18, color: 'text.secondary', mt: 0.5, flexShrink: 0 }} />
                                <Box sx={{ flex: 1, minWidth: 0 }}>
                                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', fontWeight: 500 }}>
                                    Email
                                  </Typography>
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.25 }}>
                                    <Typography variant="body1" sx={{ flex: 1 }}>
                                      <MUILink 
                                        onClick={(e) => {
                                          e.preventDefault();
                                          if (gmailConnected) {
                                            setMessageDrawerChannel('email');
                                            setMessageDrawerOpen(true);
                                          } else {
                                            window.open(`mailto:${contact.email}`, '_blank');
                                          }
                                        }}
                                        color="primary" 
                                        underline="hover"
                                        sx={{ wordBreak: 'break-all', cursor: 'pointer' }}
                                      >
                                        {contact.email}
                                      </MUILink>
                                    </Typography>
                                    <Tooltip title="Copy email to clipboard">
                                      <IconButton
                                        size="small"
                                        onClick={() => copyToClipboard(contact.email || '', 'Email')}
                                        sx={{ 
                                          p: 0.5,
                                          color: 'text.secondary',
                                          '&:hover': { color: 'primary.main' }
                                        }}
                                      >
                                        <ContentCopyIcon sx={{ fontSize: 16 }} />
                                      </IconButton>
                                    </Tooltip>
                                  </Box>
                                </Box>
                              </Box>
                            </Grid>
                          )}
                          {(contact.phone || contact.workPhone) && (
                            <Grid item xs={12} sm={6}>
                              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                                <PhoneIcon sx={{ fontSize: 18, color: 'text.secondary', mt: 0.5, flexShrink: 0 }} />
                                <Box sx={{ flex: 1, minWidth: 0 }}>
                                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', fontWeight: 500 }}>
                                    Phone
                                  </Typography>
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.25 }}>
                                    <Typography variant="body1" sx={{ flex: 1 }}>
                                      {formatPhoneNumber(contact.phone || contact.workPhone || '') || '-'}
                                    </Typography>
                                    <Tooltip title="Copy phone number to clipboard">
                                      <IconButton
                                        size="small"
                                        onClick={() => {
                                          const phoneValue = contact.phone || contact.workPhone || '';
                                          copyToClipboard(formatPhoneNumber(phoneValue), 'Phone number');
                                        }}
                                        sx={{ 
                                          p: 0.5,
                                          color: 'text.secondary',
                                          '&:hover': { color: 'primary.main' }
                                        }}
                                      >
                                        <ContentCopyIcon sx={{ fontSize: 16 }} />
                                      </IconButton>
                                    </Tooltip>
                                  </Box>
                                </Box>
                              </Box>
                            </Grid>
                          )}
                          {contact.mobilePhone && (
                            <Grid item xs={12} sm={6}>
                              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                                <PhoneIcon sx={{ fontSize: 18, color: 'text.secondary', mt: 0.5, flexShrink: 0 }} />
                                <Box sx={{ flex: 1, minWidth: 0 }}>
                                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', fontWeight: 500 }}>
                                    Mobile
                                  </Typography>
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.25 }}>
                                    <Typography variant="body1" sx={{ flex: 1 }}>
                                      {formatPhoneNumber(contact.mobilePhone)}
                                    </Typography>
                                    <Tooltip title="Copy mobile number to clipboard">
                                      <IconButton
                                        size="small"
                                        onClick={() => copyToClipboard(formatPhoneNumber(contact.mobilePhone || ''), 'Mobile number')}
                                        sx={{ 
                                          p: 0.5,
                                          color: 'text.secondary',
                                          '&:hover': { color: 'primary.main' }
                                        }}
                                      >
                                        <ContentCopyIcon sx={{ fontSize: 16 }} />
                                      </IconButton>
                                    </Tooltip>
                                  </Box>
                                </Box>
                              </Box>
                            </Grid>
                          )}
                          {(selectedLocations.length > 0 || contact.address || contact.city || contact.state || contact.country || contact.formattedAddress) && (
                            <Grid item xs={12}>
                              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                                <LocationIcon sx={{ fontSize: 18, color: 'text.secondary', mt: 0.5, flexShrink: 0 }} />
                                <Box sx={{ flex: 1, minWidth: 0 }}>
                                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', fontWeight: 500 }}>
                                    Address
                                  </Typography>
                                  <Box sx={{ mt: 0.25 }}>
                                    {selectedLocations.length > 0 ? (
                                      // Show worksite location address
                                      selectedLocations.map((location, idx) => (
                                        <Box key={location.id} sx={{ mb: idx < selectedLocations.length - 1 ? 1 : 0 }}>
                                          <Typography variant="body2" fontWeight="medium" color="text.primary">
                                            {location.nickname || location.name || location.title || 'Location'}
                                          </Typography>
                                          <Typography variant="body2" color="text.secondary">
                                            {location.address || '-'}
                                            {location.address && (location.city || location.state || location.zipcode || location.country) && ', '}
                                            {[location.city, location.state, location.zipcode, location.country].filter(Boolean).join(', ')}
                                          </Typography>
                                          {contact.timeZone && idx === 0 && (
                                            <Typography variant="caption" color="text.secondary">
                                              {contact.timeZone}
                                            </Typography>
                                          )}
                                        </Box>
                                      ))
                                    ) : (
                                      // Fallback to contact address fields
                                      <>
                                        <Typography variant="body2" color="text.secondary">
                                          {contact.formattedAddress || 
                                           [contact.address, contact.city, contact.state, contact.country, contact.zipcode]
                                             .filter(Boolean)
                                             .join(', ') || '-'}
                                        </Typography>
                                        {contact.timeZone && (
                                          <Typography variant="caption" color="text.secondary">
                                            {contact.timeZone}
                                          </Typography>
                                        )}
                                      </>
                                    )}
                                  </Box>
                                </Box>
                              </Box>
                            </Grid>
                          )}
                        </Grid>
                      </Box>

                      {/* Professional Information Section */}
                      <Box>
                        <Typography variant="subtitle2" fontWeight={600} color="text.primary" sx={{ mb: 2, fontSize: '0.875rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                          Professional Information
                        </Typography>
                        <Grid container spacing={2}>
                          {(contact.jobTitle || contact.title) && (
                            <Grid item xs={12} sm={6}>
                              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                                <WorkIcon sx={{ fontSize: 18, color: 'text.secondary', mt: 0.5, flexShrink: 0 }} />
                                <Box sx={{ flex: 1, minWidth: 0 }}>
                                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', fontWeight: 500 }}>
                                    Job Title
                                  </Typography>
                                  <Typography variant="body1" sx={{ mt: 0.25, fontWeight: 500 }}>
                                    {contact.jobTitle || contact.title || '-'}
                                  </Typography>
                                </Box>
                              </Box>
                            </Grid>
                          )}
                          {contact.headline && (
                            <Grid item xs={12}>
                              <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', fontWeight: 500 }}>
                                Professional Headline
                              </Typography>
                              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25, fontStyle: 'italic' }}>
                                {contact.headline}
                              </Typography>
                            </Grid>
                          )}
                          {contact.companyName && (
                            <Grid item xs={12} sm={6}>
                              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                                <BusinessIcon sx={{ fontSize: 18, color: 'text.secondary', mt: 0.5, flexShrink: 0 }} />
                                <Box sx={{ flex: 1, minWidth: 0 }}>
                                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', fontWeight: 500 }}>
                                    Company
                                  </Typography>
                                  <Typography variant="body1" sx={{ mt: 0.25 }}>
                                    {contact.companyId ? (
                                      <MUILink
                                        href={`/companies/${contact.companyId}`}
                                        onClick={(e) => {
                                          e.preventDefault();
                                          navigate(`/companies/${contact.companyId}`);
                                        }}
                                        color="primary"
                                        underline="hover"
                                        sx={{ fontWeight: 500 }}
                                      >
                                        {contact.companyName}
                                      </MUILink>
                                    ) : (
                                      <span style={{ fontWeight: 500 }}>{contact.companyName}</span>
                                    )}
                                  </Typography>
                                </Box>
                              </Box>
                            </Grid>
                          )}
                          {selectedLocations.length > 0 && (
                            <Grid item xs={12} sm={6}>
                              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                                <LocationIcon sx={{ fontSize: 18, color: 'text.secondary', mt: 0.5, flexShrink: 0 }} />
                                <Box sx={{ flex: 1, minWidth: 0 }}>
                                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', fontWeight: 500, mb: 0.5, display: 'block' }}>
                                    Work Locations
                                  </Typography>
                                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mt: 0.25 }}>
                                    {selectedLocations.map((location) => (
                                      <Chip
                                        key={location.id}
                                        label={location.nickname || location.name || location.title || 'Location'}
                                        size="small"
                                        variant="outlined"
                                        sx={{ height: 24, fontSize: '0.75rem' }}
                                      />
                                    ))}
                                  </Box>
                                </Box>
                              </Box>
                            </Grid>
                          )}
                        </Grid>
                      </Box>

                      {/* Additional Details Section */}
                      {(contact.contactType || contact.leadSource || contact.linkedInUrl || contact.twitterUrl || contact.facebookUrl || contact.instagramUrl || contact.website || contact.birthday || contact.salesOwnerName) && (
                        <Box>
                          <Typography variant="subtitle2" fontWeight={600} color="text.primary" sx={{ mb: 2, fontSize: '0.875rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                            Additional Details
                          </Typography>
                          <Grid container spacing={2}>
                            {contact.contactType && (
                              <Grid item xs={12} sm={6}>
                                <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', fontWeight: 500 }}>
                                  Contact Type
                                </Typography>
                                <Box sx={{ mt: 0.5 }}>
                                  <Chip 
                                    label={contact.contactType} 
                                    size="small" 
                                    color={contact.contactType === 'Decision Maker' ? 'success' : contact.contactType === 'Champion' ? 'primary' : 'default'}
                                    sx={{ height: 24, fontSize: '0.75rem', fontWeight: 500 }}
                                  />
                                </Box>
                              </Grid>
                            )}
                            {contact.leadSource && (
                              <Grid item xs={12} sm={6}>
                                <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', fontWeight: 500 }}>
                                  Lead Source
                                </Typography>
                                <Typography variant="body2" sx={{ mt: 0.5 }}>
                                  {contact.leadSource}
                                </Typography>
                              </Grid>
                            )}
                            {contact.salesOwnerName && (
                              <Grid item xs={12} sm={6}>
                                <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', fontWeight: 500 }}>
                                  Sales Owner
                                </Typography>
                                <Typography variant="body2" sx={{ mt: 0.5 }}>
                                  {contact.salesOwnerName}
                                </Typography>
                              </Grid>
                            )}
                            {contact.birthday && (
                              <Grid item xs={12} sm={6}>
                                <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', fontWeight: 500 }}>
                                  Birthday
                                </Typography>
                                <Typography variant="body2" sx={{ mt: 0.5 }}>
                                  {contact.birthday}
                                </Typography>
                              </Grid>
                            )}
                            {(toSafeHref(contact.linkedInUrl) || toSafeHref(contact.twitterUrl) || toSafeHref(contact.facebookUrl) || toSafeHref(contact.instagramUrl) || toSafeHref(contact.website)) && (
                              <Grid item xs={12}>
                                <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', fontWeight: 500, mb: 1, display: 'block' }}>
                                  Social Profiles & Website
                                </Typography>
                                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5 }}>
                                  {toSafeHref(contact.linkedInUrl) && (
                                    <MUILink
                                      href={toSafeHref(contact.linkedInUrl)}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      color="primary"
                                      underline="hover"
                                      sx={{ display: 'flex', alignItems: 'center', gap: 0.5, fontSize: '0.875rem' }}
                                    >
                                      <LinkedInIcon sx={{ fontSize: 18 }} />
                                      LinkedIn
                                    </MUILink>
                                  )}
                                  {toSafeHref(contact.twitterUrl) && (
                                    <MUILink
                                      href={toSafeHref(contact.twitterUrl)}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      color="primary"
                                      underline="hover"
                                      sx={{ display: 'flex', alignItems: 'center', gap: 0.5, fontSize: '0.875rem' }}
                                    >
                                      <TwitterIcon sx={{ fontSize: 18 }} />
                                      Twitter
                                    </MUILink>
                                  )}
                                  {toSafeHref(contact.facebookUrl) && (
                                    <MUILink
                                      href={toSafeHref(contact.facebookUrl)}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      color="primary"
                                      underline="hover"
                                      sx={{ display: 'flex', alignItems: 'center', gap: 0.5, fontSize: '0.875rem' }}
                                    >
                                      <FacebookIcon sx={{ fontSize: 18 }} />
                                      Facebook
                                    </MUILink>
                                  )}
                                  {toSafeHref(contact.instagramUrl) && (
                                    <MUILink
                                      href={toSafeHref(contact.instagramUrl)}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      color="primary"
                                      underline="hover"
                                      sx={{ display: 'flex', alignItems: 'center', gap: 0.5, fontSize: '0.875rem' }}
                                    >
                                      <InstagramIcon sx={{ fontSize: 18 }} />
                                      Instagram
                                    </MUILink>
                                  )}
                                  {toSafeHref(contact.website) && (
                                    <MUILink
                                      href={toSafeHref(contact.website)}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      color="primary"
                                      underline="hover"
                                      sx={{ display: 'flex', alignItems: 'center', gap: 0.5, fontSize: '0.875rem' }}
                                    >
                                      <LanguageIcon sx={{ fontSize: 18 }} />
                                      Website
                                    </MUILink>
                                  )}
                                </Box>
                              </Grid>
                            )}
                          </Grid>
                        </Box>
                      )}

                      {/* Status Section */}
                      <Box sx={{ pt: 2, borderTop: '1px solid', borderColor: 'divider' }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <Box>
                            <Typography variant="body2" fontWeight={500} component="div">
                              Contact Status
                            </Typography>
                            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.25, display: 'block' }}>
                              {contact.isActive !== false ? 'Active and available for engagement' : 'Archived or inactive'}
                            </Typography>
                          </Box>
                          <Chip
                            label={contact.isActive !== false ? 'Active' : 'Inactive'}
                            size="small"
                            color={contact.isActive !== false ? 'success' : 'default'}
                            sx={{ fontWeight: 500, height: 24 }}
                          />
                        </Box>
                      </Box>
                    </Box>
                  )}
                </CardContent>
              </Card>

            </Box>
          </Grid>

          {/* Right Column - Connections: Company, Location, Opportunities, Job Orders, Active Salespeople */}
          <Grid item xs={12} md={4}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {/* Recent Activity */}
              <Card>
                <CardHeader 
                  title="Recent Activity" 
                  titleTypographyProps={{ variant: 'h6', fontWeight: 'bold' }}
                />
                <CardContent sx={{ p: 2 }}>
                  {lastActivity ? (
                    <Box>
                      <Typography variant="body2" fontWeight="medium" color="text.primary" sx={{ mb: 1 }}>
                        Last Touch
                      </Typography>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                        <Typography variant="body2" color="text.secondary">
                          📅 {lastActivity.timestamp.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </Typography>
                      </Box>
                      <Typography variant="body2" color="text.primary" sx={{ mb: 0.5 }}>
                        {lastActivity.type === 'email' && lastActivity.metadata?.direction === 'sent' 
                          ? `Email sent by ${lastActivity.salespersonName || 'User'}`
                          : lastActivity.type === 'email' && lastActivity.metadata?.direction === 'received'
                          ? `Email received from ${lastActivity.metadata?.from || 'Contact'}`
                          : lastActivity.type === 'task'
                          ? `Task: ${lastActivity.title}`
                          : lastActivity.type === 'note'
                          ? `Note added by ${lastActivity.salespersonName || 'User'}`
                          : lastActivity.title || 'Activity'}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        ⏱ {formatActivityTime(lastActivity.timestamp)}
                      </Typography>
                    </Box>
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      No recent activity
                    </Typography>
                  )}
                </CardContent>
              </Card>

              {/* Company */}
              <Card>
                <CardHeader
                  title="Company"
                  titleTypographyProps={{ variant: 'h6', fontWeight: 'bold' }}
                  action={
                    <Button
                      variant="outlined"
                      size="small"
                      startIcon={<EditIcon fontSize="small" />}
                      onClick={() => setShowManageCompanyDialog(true)}
                      sx={{ minWidth: 'auto', px: 1, py: 0.5, fontSize: '0.75rem', textTransform: 'none' }}
                    >
                      Edit
                    </Button>
                  }
                />
                <CardContent sx={{ p: 2 }}>
                  {contact?.companyName ? (
                    <Box
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1,
                        p: 1,
                        borderRadius: 1,
                        bgcolor: 'grey.50',
                        cursor: contact?.companyId ? 'pointer' : undefined,
                        '&:hover': contact?.companyId ? { bgcolor: 'grey.100' } : undefined,
                      }}
                      onClick={() => contact?.companyId && navigate(`/companies/${contact.companyId}`)}
                      role={contact?.companyId ? 'button' : undefined}
                      tabIndex={contact?.companyId ? 0 : undefined}
                      onKeyDown={(e) => {
                        if (contact?.companyId && (e.key === 'Enter' || e.key === ' ')) {
                          e.preventDefault();
                          navigate(`/companies/${contact.companyId}`);
                        }
                      }}
                    >
                      <Avatar
                        sx={{ width: 32, height: 32, fontSize: '0.875rem', bgcolor: 'primary.main' }}
                      >
                        {(contact.companyName || 'C').charAt(0).toUpperCase()}
                      </Avatar>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="body2" fontWeight="medium" color="text.primary">
                          {contact.companyName}
                        </Typography>
                        {contact.companyId && (
                          <Typography variant="caption" color="text.secondary" display="block">
                            {contact.companyId}
                          </Typography>
                        )}
                      </Box>
                    </Box>
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      No company associated
                    </Typography>
                  )}
                </CardContent>
              </Card>

              {/* Work Locations */}
              <Card>
                <CardHeader
                  title="Work Locations"
                  titleTypographyProps={{ variant: 'h6', fontWeight: 'bold' }}
                  action={
                    <Button
                      variant="outlined"
                      size="small"
                      startIcon={<EditIcon fontSize="small" />}
                      onClick={() => setShowManageWorkLocationsDialog(true)}
                      sx={{ minWidth: 'auto', px: 1, py: 0.5, fontSize: '0.75rem', textTransform: 'none' }}
                    >
                      Edit
                    </Button>
                  }
                />
                <CardContent sx={{ p: 2 }}>
                  {selectedLocations.length > 0 ? (
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      {selectedLocations.map((location) => {
                        const companyId = contact?.companyId;
                        const isClickable = !!(companyId && location.id);
                        return (
                          <Box
                            key={location.id}
                            sx={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 1,
                              p: 1,
                              borderRadius: 1,
                              bgcolor: 'grey.50',
                              cursor: isClickable ? 'pointer' : undefined,
                              '&:hover': isClickable ? { bgcolor: 'grey.100' } : undefined,
                            }}
                            onClick={() => isClickable && navigate(`/companies/${companyId}/locations/${location.id}`)}
                            role={isClickable ? 'button' : undefined}
                            tabIndex={isClickable ? 0 : undefined}
                            onKeyDown={(e) => {
                              if (isClickable && (e.key === 'Enter' || e.key === ' ')) {
                                e.preventDefault();
                                navigate(`/companies/${companyId}/locations/${location.id}`);
                              }
                            }}
                          >
                            <Avatar sx={{ width: 32, height: 32, fontSize: '0.875rem', bgcolor: 'primary.main' }}>
                              <LocationIcon sx={{ fontSize: 16 }} />
                            </Avatar>
                            <Box sx={{ flex: 1, minWidth: 0 }}>
                              <Typography variant="body2" fontWeight="medium" noWrap>
                                {location.nickname || location.name || location.title || 'Unknown Location'}
                              </Typography>
                              {location.code && (
                                <Typography variant="caption" color="text.secondary" display="block">
                                  {location.code}
                                </Typography>
                              )}
                            </Box>
                          </Box>
                        );
                      })}
                    </Box>
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      No work locations assigned
                    </Typography>
                  )}
                </CardContent>
              </Card>

              <ManageContactCompanyDialog
                open={showManageCompanyDialog}
                onClose={() => setShowManageCompanyDialog(false)}
                currentCompany={
                  contact?.companyId
                    ? {
                        id: contact.companyId,
                        companyName: contact.companyName,
                        name: contact.companyName,
                      }
                    : null
                }
                allCompanies={allCompanies}
                loadingCompanies={loadingCompanies}
                suggestedCompanies={suggestedCompanies}
                contactEmail={contact?.email}
                onSave={handleCompanySaveFromModal}
              />
              <ManageContactLocationsDialog
                open={showManageWorkLocationsDialog}
                onClose={() => setShowManageWorkLocationsDialog(false)}
                companyLocations={companyLocations}
                selectedLocations={selectedLocations}
                onSave={(locations) => {
                  setSelectedLocations(locations);
                  handleLocationAssociationUpdate(locations);
                }}
              />

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

              {/* Job Orders */}
              <Card>
                <CardHeader 
                  title="Job Orders" 
                  titleTypographyProps={{ variant: 'h6', fontWeight: 'bold' }}
                />
                <CardContent sx={{ p: 2 }}>
                  {loadingJobOrders ? (
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      <Skeleton variant="rectangular" height={32} />
                      <Skeleton variant="rectangular" height={32} />
                      <Skeleton variant="rectangular" height={32} />
                    </Box>
                  ) : jobOrders.length > 0 ? (
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      {jobOrders
                        .sort((a: any, b: any) => {
                          // Sort by status priority (open > draft > on_hold > filled > cancelled)
                          const statusPriority: Record<string, number> = {
                            'open': 5,
                            'draft': 4,
                            'on_hold': 3,
                            'filled': 2,
                            'completed': 2,
                            'cancelled': 1
                          };
                          const aPriority = statusPriority[a.status] || 0;
                          const bPriority = statusPriority[b.status] || 0;
                          if (aPriority !== bPriority) {
                            return bPriority - aPriority;
                          }
                          // Then sort by created date (newest first)
                          const aDate = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt || 0);
                          const bDate = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt || 0);
                          return bDate.getTime() - aDate.getTime();
                        })
                        .slice(0, 5)
                        .map((jobOrder: any) => {
                          // Determine contact's role in this job order
                          let contactRole = '';
                          if (jobOrder.hrContactId === contactId) contactRole = 'HR Contact';
                          else if (jobOrder.decisionMaker === contactId) contactRole = 'Decision Maker';
                          else if (jobOrder.operationsContactId === contactId) contactRole = 'Operations';
                          else if (jobOrder.procurementContactId === contactId) contactRole = 'Procurement';
                          else if (jobOrder.billingContactId === contactId) contactRole = 'Billing';
                          else if (jobOrder.safetyContactId === contactId) contactRole = 'Safety';
                          else if (jobOrder.invoiceContactId === contactId) contactRole = 'Invoice';
                          
                          // Format status
                          const statusLabels: Record<string, string> = {
                            'open': 'Open',
                            'draft': 'Draft',
                            'on_hold': 'On Hold',
                            'filled': 'Filled',
                            'completed': 'Completed',
                            'cancelled': 'Cancelled'
                          };
                          const statusLabel = statusLabels[jobOrder.status] || jobOrder.status || 'Unknown';
                          
                          // Format job order number
                          const jobOrderNumber = jobOrder.jobOrderNumber || jobOrder.jobOrderSeq?.toString().padStart(4, '0') || 'N/A';
                          
                          return (
                            <Box 
                              key={jobOrder.id} 
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
                              onClick={() => navigate(`/jobs/job-orders/${jobOrder.id}`)}
                            >
                              <Avatar sx={{ width: 28, height: 28, fontSize: '0.75rem', bgcolor: 'primary.main' }}>
                                <WorkIcon sx={{ fontSize: 16 }} />
                              </Avatar>
                              <Box sx={{ flex: 1 }}>
                                <Typography variant="body2" fontWeight="medium">
                                  {jobOrder.jobOrderName || jobOrder.jobTitle || 'Unknown Job Order'}
                                </Typography>
                                <Typography variant="caption" color="text.secondary">
                                  #{jobOrderNumber} • {statusLabel}{contactRole ? ` • ${contactRole}` : ''}
                                </Typography>
                              </Box>
                            </Box>
                          );
                        })}
                    </Box>
                  ) : (
                    <Typography variant="body2" color="text.secondary">No associated job orders</Typography>
                  )}
                </CardContent>
              </Card>

              {/* Active Salespeople */}
              <Card>
                <CardHeader 
                  title="Active Salespeople" 
                  titleTypographyProps={{ variant: 'h6', fontWeight: 'bold' }}
                  action={
                    <Button size="small" disabled={rebuildingActive} onClick={async () => {
                      try {
                        setRebuildingActive(true);
                        const fn = httpsCallable(functions, 'rebuildContactActiveSalespeople');
                        
                        // Pass the deal IDs that are already loaded in the frontend
                        const dealIds = associationsData.entities.deals?.map((d: any) => d.id) || [];
                        
                        const resp: any = await fn({ tenantId, contactId, dealIds });
                        const data = resp?.data || {};
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
                  showOnlyTodos
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
            if (taskSubmitting) return;
            setTaskSubmitting(true);
            setShowTaskDialog(false);
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
            } finally {
              setTaskSubmitting(false);
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
          loading={taskSubmitting}
        />
      )}

      {/* Appointment Creation Dialog */}
      {showAppointmentDialog && (
        <CreateTaskDialog
          open={showAppointmentDialog}
          onClose={() => setShowAppointmentDialog(false)}
          onSubmit={async (taskData) => {
            if (appointmentSubmitting) return;
            setAppointmentSubmitting(true);
            setShowAppointmentDialog(false);
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
            } finally {
              setAppointmentSubmitting(false);
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
          loading={appointmentSubmitting}
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

      {/* Add Note Dialog */}
      <AddNoteDialog
        open={showAddNoteDialog}
        onClose={() => setShowAddNoteDialog(false)}
        entityId={contact?.id || ''}
        entityType="contact"
        entityName={contact?.fullName || contact?.firstName || contact?.lastName || ''}
        tenantId={tenantId}
        contacts={contact ? [{
          id: contact.id,
          fullName: contact.fullName || `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || 'Unknown Contact',
          email: contact.email || '',
          title: contact.jobTitle || contact.title || ''
        }] : []}
        onNoteAdded={() => {
          // Optionally refresh notes or trigger any updates
        }}
      />

      {/* Log Activity Dialog */}
      <LogActivityDialog
        open={showLogActivityDialog}
        onClose={() => setShowLogActivityDialog(false)}
        onSubmit={handleLogActivity}
        loading={logActivityLoading}
        salespeople={salespeople}
        contacts={[contact]}
        preselectContactsFromProps={true}
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

      {/* Message Drawer */}
      <MessageDrawer
        open={messageDrawerOpen}
        onClose={() => setMessageDrawerOpen(false)}
        recipients={(() => {
          const recipients: MessageRecipient[] = [];
          if (messageDrawerChannel === 'email' && contact?.email) {
            recipients.push({
              userId: '',
              name: contact.fullName || `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || contact.email.split('@')[0],
              email: contact.email,
            });
          } else if (messageDrawerChannel === 'sms' && (contact?.phone || contact?.workPhone)) {
            recipients.push({
              userId: '',
              name: contact.fullName || `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || (contact.phone || contact.workPhone),
              phone: contact.phone || contact.workPhone,
            });
          }
          return recipients;
        })()}
        crmContactIds={contact?.id ? [contact.id] : undefined}
        tenantId={tenantId || ''}
        defaultChannels={[messageDrawerChannel]}
        onSend={() => {
          setMessageDrawerOpen(false);
        }}
      />
    </Box>
  );
};

export default ContactDetails; 