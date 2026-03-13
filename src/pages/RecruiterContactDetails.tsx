import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Card,
  CardContent,
  CardHeader,
  Grid,
  Chip,
  Button,
  IconButton,
  CircularProgress,
  Paper,
  Avatar,
  Snackbar,
  Alert,
  TableContainer,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  Link as MUILink,
  Skeleton,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Autocomplete,
  Divider,
  Switch,
  FormControlLabel,
} from '@mui/material';
import {
  Phone as PhoneIcon,
  Email as EmailIcon,
  LocationOn as LocationIcon,
  Business as BusinessIcon,
  AttachMoney as DealIcon,
  Dashboard as DashboardIcon,
  Person as PersonIcon,
  Notes as NotesIcon,
  Work as WorkIcon,
  Edit as EditIcon,
  ArrowBack as ArrowBackIcon,
  LinkedIn as LinkedInIcon,
  Twitter as TwitterIcon,
  Facebook as FacebookIcon,
  Instagram as InstagramIcon,
  Language as LanguageIcon,
  Task as TaskIcon,
  Info as InfoIcon,
  Delete as DeleteIcon,
  Timeline as TimelineIcon,
  Add as AddIcon,
  SmartToy as AIIcon,
  CheckCircle as CheckCircleIcon,
} from '@mui/icons-material';
import {
  collection,
  doc,
  getDoc,
  updateDoc,
  query,
  where,
  orderBy,
  limit,
  getDocs,
} from 'firebase/firestore';
import { db, functions } from '../firebase';
import { httpsCallable } from 'firebase/functions';
import { useAuth } from '../contexts/AuthContext';
import CRMNotesTab from '../components/CRMNotesTab';
import ContactActivityTab from '../components/ContactActivityTab';
import { formatDateForDisplay } from '../utils/dateUtils';
import { formatPhoneNumber } from '../utils/formatPhone';
import { toSafeHref } from '../utils/urlUtils';
import { useFavorites } from '../hooks/useFavorites';
import AddNoteDialog from '../components/AddNoteDialog';
import LogActivityDialog from '../components/LogActivityDialog';
import PageHeader from '../components/PageHeader';
import SafeAvatar from '../components/SafeAvatar';
import FavoriteButton from '../components/FavoriteButton';

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
      {value === index && <Box sx={{ p: 2 }}>{children}</Box>}
    </div>
  );
}

const RecruiterContactDetails: React.FC = () => {
  const { contactId } = useParams<{ contactId: string }>();
  const navigate = useNavigate();
  const { tenantId, currentUser } = useAuth();
  
  // Favorites
  const { isFavorite, toggleFavorite } = useFavorites('contacts');

  const [contact, setContact] = useState<any>(null);
  const [company, setCompany] = useState<any>(null);
  const [location, setLocation] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tabValue, setTabValue] = useState(0);
  
  // Dialog and action states
  const [showAddNoteDialog, setShowAddNoteDialog] = useState(false);
  const [showLogActivityDialog, setShowLogActivityDialog] = useState(false);
  const [logActivityLoading, setLogActivityLoading] = useState(false);
  const [aiEnhancing, setAiEnhancing] = useState(false);
  const [salespeople, setSalespeople] = useState<any[]>([]);
  
  // Edit mode state for Contact Details card
  const [isEditingContactDetails, setIsEditingContactDetails] = useState(false);
  
  // Recent Activity state
  const [recentActivities, setRecentActivities] = useState<any[]>([]);
  const [loadingActivities, setLoadingActivities] = useState(false);
  
  // Company locations and associations state
  const [companyLocations, setCompanyLocations] = useState<any[]>([]);
  const [selectedLocations, setSelectedLocations] = useState<any[]>([]);
  const [locationDropdownValue, setLocationDropdownValue] = useState<any>(null);
  const [allCompanies, setAllCompanies] = useState<any[]>([]);
  const [loadingCompanies, setLoadingCompanies] = useState(false);
  const [suggestedCompanies, setSuggestedCompanies] = useState<any[]>([]);
  
  // Associations state
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
  
  // Job Orders state
  const [jobOrders, setJobOrders] = useState<any[]>([]);
  const [loadingJobOrders, setLoadingJobOrders] = useState(false);
  
  // Active Salespeople rebuild state
  const [rebuildingActive, setRebuildingActive] = useState(false);
  const [localSuccess, setLocalSuccess] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!contactId || !tenantId) return;
    loadContactData();
  }, [contactId, tenantId]);

  const loadContactData = async () => {
    if (!contactId || !tenantId) return;

    try {
      setLoading(true);
      
      // Load contact
      const contactRef = doc(db, 'tenants', tenantId, 'crm_contacts', contactId);
      const contactSnap = await getDoc(contactRef);
      
      if (!contactSnap.exists()) {
        setError('Contact not found');
        setLoading(false);
        return;
      }

      const contactData = {
        id: contactSnap.id,
        ...contactSnap.data()
      } as any;
      setContact(contactData);

      // Load related data in parallel
      await Promise.all([
        loadCompany(contactData.companyId)
      ]);

      // Load location after we have the company ID
      if (contactData.locationId && contactData.companyId) {
        await loadLocation(contactData.locationId, contactData.companyId);
      }
      
      // Load company locations if we have a company
      if (contactData.companyId) {
        await loadCompanyLocations(contactData.companyId);
      }

    } catch (error) {
      console.error('Error loading contact data:', error);
      setError('Failed to load contact data');
    } finally {
      setLoading(false);
    }
  };

  const loadCompany = async (companyId?: string) => {
    if (!companyId || !tenantId) return;

    try {
      const companyRef = doc(db, 'tenants', tenantId, 'crm_companies', companyId);
      const companySnap = await getDoc(companyRef);
      if (companySnap.exists()) {
        setCompany({
          id: companySnap.id,
          ...companySnap.data()
        });
      }
    } catch (error) {
      console.error('Error loading company:', error);
    }
  };

  const loadLocation = async (locationId?: string, companyId?: string) => {
    if (!locationId || !tenantId || !companyId) return;

    try {
      const locationRef = doc(db, 'tenants', tenantId, 'crm_companies', companyId, 'locations', locationId);
      const locationSnap = await getDoc(locationRef);
      if (locationSnap.exists()) {
        setLocation({
          id: locationSnap.id,
          ...locationSnap.data()
        });
      }
    } catch (error) {
      console.error('Error loading location:', error);
    }
  };


  const loadSalespeople = async () => {
    if (!tenantId) return;
    
    try {
      const usersRef = collection(db, 'tenants', tenantId, 'users');
      const q = query(usersRef, where('securityLevel', '>=', 1), orderBy('securityLevel', 'desc'));
      const snapshot = await getDocs(q);
      const salespeopleData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setSalespeople(salespeopleData);
    } catch (error) {
      console.error('Error loading salespeople:', error);
    }
  };

  // Load salespeople on mount
  useEffect(() => {
    if (tenantId) {
      loadSalespeople();
      loadRecentActivities();
      loadAllCompanies();
      loadAssociations();
      loadJobOrdersForContact();
    }
  }, [tenantId, contactId]);

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
      
      // Update selected locations based on contact associations
      if (contact) {
        const assocLocations = contact.associations?.locations || [];
        const locations = [];
        for (const locationId of assocLocations) {
          const loc = locationsData.find(l => l.id === locationId);
          if (loc) locations.push(loc);
        }
        if (locations.length === 0 && contact.locationId) {
          const legacyLocation = locationsData.find(l => l.id === contact.locationId);
          if (legacyLocation) locations.push(legacyLocation);
        }
        setSelectedLocations(locations);
      }
    } catch (err) {
      console.error('Error loading company locations:', err);
      setCompanyLocations([]);
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

  // Load associations data
  const loadAssociations = async () => {
    if (!contactId || !tenantId || !currentUser?.uid) return;
    
    try {
      setAssociationsData(prev => ({ ...prev, loading: true, error: null }));
      
      // Use the simple association service
      const { createUnifiedAssociationService } = await import('../utils/unifiedAssociationService');
      const associationService = createUnifiedAssociationService(tenantId, currentUser.uid);
      
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

  // Load recent activities for the contact
  const loadRecentActivities = async () => {
    if (!contactId || !tenantId) return;
    
    setLoadingActivities(true);
    try {
      const { loadContactActivities } = await import('../utils/activityService');
      const activities = await loadContactActivities(tenantId, contactId, {
        limit: 8,
        includeTasks: true,
        includeEmails: true,
        includeNotes: true,
        includeAIActivities: false,
        onlyCompletedTasks: true
      });
      
      // Convert to the format expected by the component
      const formattedActivities = activities.map(activity => ({
        id: activity.id,
        type: activity.type,
        title: activity.title,
        description: activity.description,
        timestamp: activity.timestamp,
        salespersonId: activity.salespersonId,
        icon: activity.type === 'task' ? 'task' : activity.type === 'email' ? 'email' : 'note',
        ...(activity.type === 'email' && { direction: activity.metadata?.direction || 'sent' }),
        ...(activity.type === 'task' && { status: activity.metadata?.status || 'completed' })
      }));
      
      setRecentActivities(formattedActivities);
    } catch (err) {
      console.error('Error loading recent activities:', err);
      setRecentActivities([]);
    } finally {
      setLoadingActivities(false);
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

      try {
        const dealsSnap = await getDocs(
          query(collection(db, 'tenants', tenantId, 'crm_deals'), where('contactIds', 'array-contains', contactId))
        );
        dealsSnap.docs.forEach((d) => associatedDealIds.add(d.id));
      } catch (err) {
        console.warn('Fallback deal query failed while loading contact job orders:', err);
      }

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

      if (companyIds.length > 0) {
        for (let i = 0; i < companyIds.length; i += 10) {
          const chunk = companyIds.slice(i, i + 10);
          const byCompany = await runSafe(query(jobOrdersRef, where('companyId', 'in', chunk)));
          byCompany.docs.forEach((snap: any) => {
            allJobOrders.set(snap.id, { id: snap.id, ...snap.data() });
          });
        }
      }

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

  // Helper functions
  const getActivityIcon = (iconType: string) => {
    switch (iconType) {
      case 'task':
        return <TaskIcon sx={{ fontSize: 16 }} />;
      case 'email':
        return <EmailIcon sx={{ fontSize: 16 }} />;
      case 'note':
        return <NotesIcon sx={{ fontSize: 16 }} />;
      default:
        return <InfoIcon sx={{ fontSize: 16 }} />;
    }
  };

  const formatActivityTime = (timestamp: any) => {
    if (!timestamp) return 'Unknown';
    
    const date = timestamp instanceof Date ? timestamp : (timestamp?.toDate ? timestamp.toDate() : new Date(timestamp));
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  const handleContactUpdate = async (field: string, value: any) => {
    if (!contactId || !tenantId || !contact || !currentUser?.uid) return;

    try {
      // Ensure URL fields have proper protocols
      let processedValue = value;
      if (['linkedInUrl', 'twitterUrl', 'facebookUrl', 'instagramUrl', 'website'].includes(field) && value) {
        processedValue = ensureUrlProtocol(value);
      }

      // Clean undefined values
      processedValue = removeUndefinedValues(processedValue);

      await updateDoc(doc(db, 'tenants', tenantId, 'crm_contacts', contactId), { 
        [field]: processedValue,
        updatedAt: new Date()
      });
      
      // Update local state
      setContact(prev => prev ? { ...prev, [field]: processedValue } : null);
      
      // Reload contact data to ensure consistency
      await loadContactData();
    } catch (err) {
      console.error('Error updating contact:', err);
      setError('Failed to update contact. Please try again.');
    }
  };

  const handleLocationAssociationUpdate = async (locations: any[]) => {
    if (!contactId || !tenantId || !contact || !currentUser?.uid) return;
    
    try {
      const locationIds = locations.map(loc => loc.id);
      const associations = { ...(contact.associations || {}), locations: locationIds };
      
      await updateDoc(doc(db, 'tenants', tenantId, 'crm_contacts', contactId), {
        associations,
        updatedAt: new Date()
      });
      
      setContact(prev => prev ? { ...prev, associations } : null);
      await loadContactData();
    } catch (err) {
      console.error('Error updating location associations:', err);
      setError('Failed to update location associations');
    }
  };

  // Utility functions
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

  const ensureUrlProtocol = (url: string): string => {
    if (!url || typeof url !== 'string') return url;
    const trimmed = url.trim();
    if (!trimmed) return url;
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
    if (/^[\d\s().\-+xX]+$/.test(trimmed) || (trimmed.length <= 20 && !trimmed.includes('.') && /\d{3}/.test(trimmed))) return '';
    return 'https://' + trimmed;
  };

  const removeUndefinedValues = (obj: any): any => {
    if (obj === null || obj === undefined) {
      return null;
    }
    
    if (Array.isArray(obj)) {
      return obj.map(item => removeUndefinedValues(item)).filter(item => item !== null);
    }
    
    if (typeof obj === 'object') {
      const cleaned: any = {};
      for (const [key, value] of Object.entries(obj)) {
        const cleanedValue = removeUndefinedValues(value);
        if (cleanedValue !== null) {
          cleaned[key] = cleanedValue;
        }
      }
      return cleaned;
    }
    
    return obj;
  };

  const handleCompanyAssociation = async (companyId: string) => {
    if (!contactId || !tenantId || !companyId || !currentUser?.uid) return;
    
    try {
      const selectedCompany = allCompanies.find(c => c.id === companyId);
      
      await updateDoc(doc(db, 'tenants', tenantId, 'crm_contacts', contactId), {
        companyId,
        companyName: selectedCompany?.companyName || selectedCompany?.name || '',
        associations: {
          ...(contact.associations || {}),
          companies: [companyId]
        },
        updatedAt: new Date()
      });
      
      await loadContactData();
      await loadCompanyLocations(companyId);
    } catch (error) {
      console.error('Error associating contact with company:', error);
      setError('Failed to associate contact with company');
    }
  };

  const handleAIEnhancement = async () => {
    if (!contactId || !tenantId || !contact) return;

    try {
      setAiEnhancing(true);
      setError(null);

      // Use the Apollo-powered contact enrichment function (same as CRM)
      // Note: getDoc, doc, updateDoc, db, functions, and httpsCallable are already imported at the top
      
      let result;
      let resultData: any;
      
      try {
        console.log('[RecruiterContactDetails] Calling enrichContactOnDemand', {
          tenantId,
          contactId,
          mode: 'full'
        });
        
        const enrichContact = httpsCallable(functions, 'enrichContactOnDemand');
        result = await enrichContact({ 
          tenantId, 
          contactId, 
          mode: 'full', 
          force: false 
        });
        
        resultData = result.data as any;
        console.log('[RecruiterContactDetails] Apollo contact enrichment results:', resultData);
      } catch (firebaseError: any) {
        // Handle Firebase callable function errors
        console.error('[RecruiterContactDetails] Firebase callable error:', {
          code: firebaseError.code,
          message: firebaseError.message,
          details: firebaseError.details,
          stack: firebaseError.stack
        });
        
        // Check if it's a FirebaseError with more details
        if (firebaseError.code === 'internal' || firebaseError.code === 'functions/internal' || firebaseError.code === 'functions/unknown') {
          const errorMessage = firebaseError.message || firebaseError.details || 'Internal server error in enrichment function';
          console.error('[RecruiterContactDetails] Apollo enrichment failed:', errorMessage);
          setError(`Apollo enrichment failed: ${errorMessage}. This may be due to a temporary server issue. Please try again in a moment, or check the function logs in Firebase Console.`);
          setAiEnhancing(false);
          return;
        }
        
        // Handle other Firebase error codes
        if (firebaseError.code === 'functions/not-found') {
          setError('Enrichment function not found. Please contact support.');
          setAiEnhancing(false);
          return;
        }
        
        if (firebaseError.code === 'functions/permission-denied') {
          setError('Permission denied. Please check your access rights.');
          setAiEnhancing(false);
          return;
        }
        
        if (firebaseError.code === 'functions/deadline-exceeded') {
          setError('Enrichment timed out. The process may still be running. Please wait a moment and refresh the page.');
          setAiEnhancing(false);
          return;
        }
        
        // Re-throw other errors to be handled by outer catch
        throw firebaseError;
      }
      
      if (resultData.status === 'ok') {
        // Reload the contact to get the enhanced data (same as CRM)
        const contactDoc = await getDoc(doc(db, 'tenants', tenantId, 'crm_contacts', contactId));
        let enhancedContactData: any = null;
        
        if (contactDoc.exists()) {
          enhancedContactData = { id: contactDoc.id, ...contactDoc.data() };
          
          // Update contact fields with Apollo data if available (same as CRM)
          if (enhancedContactData.apolloEnrichment?.person) {
            const apolloPerson = enhancedContactData.apolloEnrichment.person;
            
            console.log('[RecruiterContactDetails] Apollo Person Data:', apolloPerson);
            
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
              console.log('[RecruiterContactDetails] Applying Apollo updates:', updates);
              try {
                await updateDoc(doc(db, 'tenants', tenantId, 'crm_contacts', contactId), {
                  ...updates,
                  updatedAt: new Date()
                });
                
                // Update local state
                enhancedContactData = { ...enhancedContactData, ...updates };
                console.log('[RecruiterContactDetails] Successfully updated contact with Apollo data');
              } catch (updateError) {
                console.error('[RecruiterContactDetails] Error updating contact with Apollo data:', updateError);
              }
            }
          }
          
          setContact(enhancedContactData);
        }
        
        // Reload contact data to get any other updates
        await loadContactData();
        
        setError(null);
      } else if (resultData.status === 'error') {
        setError(resultData.message || 'Failed to enhance contact with Apollo data');
      } else {
        // Handle other status types (like 'degraded')
        await loadContactData();
        setError(null);
      }
      
    } catch (error: any) {
      console.error('[RecruiterContactDetails] Error enriching contact:', error);
      
      // Provide more specific error messages
      let errorMessage = 'Failed to enhance contact with AI. Please try again.';
      
      if (error?.code === 'functions/not-found') {
        errorMessage = 'Enrichment function not found. Please contact support.';
      } else if (error?.code === 'functions/permission-denied') {
        errorMessage = 'Permission denied. Please check your access rights.';
      } else if (error?.code === 'functions/deadline-exceeded') {
        errorMessage = 'Enrichment timed out. The process may still be running. Please wait a moment and refresh.';
      } else if (error?.message) {
        errorMessage = `Enrichment failed: ${error.message}`;
      }
      
      setError(errorMessage);
    } finally {
      setAiEnhancing(false);
    }
  };

  const handleLogActivity = async (taskData: any) => {
    setLogActivityLoading(true);
    try {
      // Import TaskService dynamically to avoid circular dependencies
      const { TaskService } = await import('../utils/taskService');
      const taskService = TaskService.getInstance();
      
      // Create the task as completed
      await taskService.createTask({
        ...taskData,
        tenantId,
        status: 'completed',
        completedAt: new Date(),
        associations: {
          contacts: [contactId],
          ...taskData.associations
        }
      });

      setShowLogActivityDialog(false);
    } catch (error: any) {
      console.error('Error logging activity:', error);
      setError(error.message || 'Failed to log activity');
    } finally {
      setLogActivityLoading(false);
    }
  };

  const setTabAndPersist = (newValue: number) => {
    setTabValue(newValue);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', String(newValue));
      window.history.replaceState({}, '', url.toString());
    } catch {
      // ignore
    }
  };

  if (loading) {
    return (
      <Box sx={{ p: 3 }}>
        <Skeleton variant="rectangular" width="100%" height={200} sx={{ mb: 3 }} />
        <Skeleton variant="rectangular" width="100%" height={400} />
      </Box>
    );
  }

  if (error || !contact) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error" sx={{ mb: 2 }}>
          {error || 'Contact not found'}
        </Alert>
        <Button onClick={() => navigate('/contacts')} sx={{ mt: 2 }} startIcon={<ArrowBackIcon />}>
          Back to Contacts
        </Button>
      </Box>
    );
  }

  const associatedSalespeople = (() => {
    const ids = (contact?.associations?.salespeople || []) as any[];
    if (ids.length === 0) return [];
    const byId = new Map((salespeople || []).map((sp: any) => [sp.id, sp]));
    return ids.map((id) => byId.get(id)).filter(Boolean);
  })();

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      <PageHeader
        title={
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2.5 }}>
            <SafeAvatar
              src={contact.avatar || undefined}
              alt={contact.fullName || `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || 'Contact'}
              sx={{
                width: 108,
                height: 108,
                bgcolor: 'primary.main',
                fontSize: '40px',
                fontWeight: 700,
                flexShrink: 0,
              }}
            >
              {(contact.fullName || `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || 'C')
                .trim()
                .split(' ')
                .slice(0, 2)
                .map((p: string) => p?.[0])
                .join('')
                .toUpperCase()}
            </SafeAvatar>

            <Box sx={{ flex: 1, minWidth: 0, minHeight: 108, display: 'flex', flexDirection: 'column' }}>
              {/* Line 1: Name + favorite */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                <Typography
                  variant="h6"
                  sx={{
                    fontSize: { xs: '20px', md: '24px' },
                    fontWeight: 600,
                    lineHeight: 1.2,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    minWidth: 0,
                  }}
                >
                  {contact.fullName || `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || 'Contact'}
                </Typography>
                <FavoriteButton
                  itemId={contact.id}
                  favoriteType="contacts"
                  isFavorite={isFavorite}
                  toggleFavorite={toggleFavorite}
                  size="small"
                />
              </Box>

              {/* Line 2: Title */}
              {(contact.title || contact.jobTitle) && (
                <Typography sx={{ fontSize: '0.875rem', color: 'rgba(0,0,0,0.65)', fontWeight: 500, mt: 0.75 }}>
                  {contact.title || contact.jobTitle}
                </Typography>
              )}

              {/* Line 3: Connections (replaces email/company row pattern) */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 0.75, flexWrap: 'wrap' }}>
                {/* Company */}
                {(company?.id || contact.companyId) && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                    <BusinessIcon sx={{ fontSize: 18, color: 'rgba(0,0,0,0.45)' }} />
                    <Typography
                      sx={{
                        fontSize: '0.875rem',
                        color: 'rgb(74, 144, 226)',
                        fontWeight: 600,
                        cursor: 'pointer',
                        textDecoration: 'none',
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
                    <Typography sx={{ fontSize: '0.875rem', color: 'rgba(0,0,0,0.55)', fontWeight: 500 }}>
                      {selectedLocations.slice(0, 2).map((loc: any, idx: number) => (
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
                            {loc.nickname || loc.name || loc.title || 'Location'}
                          </Typography>
                          {idx < Math.min(2, selectedLocations.length) - 1 ? ', ' : ''}
                        </React.Fragment>
                      ))}
                      {selectedLocations.length > 2 ? ` +${selectedLocations.length - 2}` : ''}
                    </Typography>
                  </Box>
                )}

                {/* Deals */}
                {(associationsData.entities.deals || []).length > 0 && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                    <DealIcon sx={{ fontSize: 18, color: 'rgba(0,0,0,0.45)' }} />
                    <Typography sx={{ fontSize: '0.875rem', color: 'rgba(0,0,0,0.55)', fontWeight: 500 }}>
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
                            onClick={() => navigate(`/recruiter/deals/${d.id}`)}
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
                    <Typography sx={{ fontSize: '0.875rem', color: 'rgba(0,0,0,0.55)', fontWeight: 500 }}>
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
                            onClick={() => navigate(`/jobs/job-orders/${jo.id}`)}
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
                    <Typography sx={{ fontSize: '0.875rem', color: 'rgba(0,0,0,0.55)', fontWeight: 500 }}>
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
              </Box>

              {/* Line 4: Social / contact icons - use toSafeHref so phone numbers in website field don't become invalid links */}
              {(toSafeHref(contact.linkedInUrl) || toSafeHref(contact.website)) && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 0.5 }}>
                  {toSafeHref(contact.website) && (
                    <IconButton
                      size="small"
                      component="a"
                      href={toSafeHref(contact.website)}
                      target="_blank"
                      rel="noopener noreferrer"
                      sx={{ p: 0.75, color: 'rgb(74, 144, 226)' }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <LanguageIcon fontSize="small" />
                    </IconButton>
                  )}
                  {toSafeHref(contact.linkedInUrl) && (
                    <IconButton
                      size="small"
                      component="a"
                      href={toSafeHref(contact.linkedInUrl)}
                      target="_blank"
                      rel="noopener noreferrer"
                      sx={{ p: 0.75, color: 'rgb(74, 144, 226)' }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <LinkedInIcon fontSize="small" />
                    </IconButton>
                  )}
                </Box>
              )}

              {/* Line 5: Chips (retain content) */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1, flexWrap: 'wrap' }}>
                <Chip
                  label="Low"
                  size="small"
                  variant="outlined"
                  sx={{
                    borderRadius: '999px',
                    fontSize: '0.75rem',
                    height: 28,
                    color: 'error.main',
                    borderColor: 'rgba(211, 47, 47, 0.35)',
                    bgcolor: 'rgba(211, 47, 47, 0.06)',
                  }}
                />
                {!!contact.inferredSeniority && (
                  <Chip
                    label={String(contact.inferredSeniority).toLowerCase()}
                    size="small"
                    variant="outlined"
                    sx={{
                      borderRadius: '999px',
                      fontSize: '0.75rem',
                      height: 28,
                      color: 'text.secondary',
                      borderColor: 'rgba(0,0,0,0.12)',
                      bgcolor: 'rgba(0,0,0,0.02)',
                      textTransform: 'lowercase',
                    }}
                  />
                )}
              </Box>
            </Box>
          </Box>
        }
        filters={
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            {[
              { label: 'Overview', icon: <DashboardIcon fontSize="small" />, index: 0 },
              { label: 'Notes', icon: <NotesIcon fontSize="small" />, index: 1 },
              { label: 'Activity', icon: <TimelineIcon fontSize="small" />, index: 2 },
            ].map((t) => {
              const isActive = tabValue === t.index;
              return (
                <Button
                  key={t.label}
                  onClick={() => setTabAndPersist(t.index)}
                  variant="text"
                  startIcon={t.icon}
                  sx={{
                    textTransform: 'none',
                    borderRadius: '999px',
                    fontSize: '14px',
                    fontWeight: isActive ? 500 : 400,
                    color: isActive ? 'white' : 'rgba(0, 0, 0, 0.7)',
                    bgcolor: isActive ? '#0057B8' : 'rgba(0, 0, 0, 0.04)',
                    px: 1.5,
                    py: 0.75,
                    minWidth: 'auto',
                    whiteSpace: 'nowrap',
                    '&:hover': {
                      bgcolor: isActive ? '#004a9f' : 'rgba(0, 0, 0, 0.08)',
                    },
                  }}
                >
                  {t.label}
                </Button>
              );
            })}
          </Box>
        }
        rightActions={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Button
              variant="outlined"
              startIcon={<ArrowBackIcon />}
              onClick={() => navigate('/contacts')}
              sx={{
                textTransform: 'none',
                borderRadius: '24px',
                height: '40px',
                px: 2,
                whiteSpace: 'nowrap',
              }}
            >
              Back
            </Button>

            <Button
              variant="outlined"
              startIcon={<AddIcon />}
              onClick={() => setShowAddNoteDialog(true)}
              sx={{
                textTransform: 'none',
                borderRadius: '24px',
                height: '40px',
                px: 2,
                whiteSpace: 'nowrap',
              }}
            >
              Add Note
            </Button>

            <Button
              variant="contained"
              startIcon={<AIIcon />}
              onClick={handleAIEnhancement}
              disabled={aiEnhancing}
              sx={{
                textTransform: 'none',
                borderRadius: '24px',
                height: '40px',
                px: 2,
                whiteSpace: 'nowrap',
                bgcolor: '#4A90E2',
                '&:hover': { bgcolor: '#3a7fcd' },
              }}
            >
              {aiEnhancing ? 'Enhancing…' : 'AI Enhance'}
            </Button>

            <Button
              variant="contained"
              startIcon={<CheckCircleIcon />}
              onClick={() => setShowLogActivityDialog(true)}
              sx={{
                textTransform: 'none',
                borderRadius: '24px',
                height: '40px',
                px: 2,
                whiteSpace: 'nowrap',
                bgcolor: '#0057B8',
                '&:hover': { bgcolor: '#004a9f' },
              }}
            >
              Log Activity
            </Button>
          </Box>
        }
      />

      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', pb: 2 }}>

      {/* Tab Panels */}
      <TabPanel value={tabValue} index={0}>
        <Grid container spacing={3}>
          {/* Left Column - Contact Details */}
          <Grid item xs={12} md={4}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {/* Contact Details Card */}
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
                      
                      {/* Company Association */}
                      <Box>
                        <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                          Company Association
                        </Typography>
                        
                        {contact.companyName && (
                          <Box sx={{ mb: 2, p: 1.5, bgcolor: 'primary.50', borderRadius: 1, border: '1px solid', borderColor: 'primary.200' }}>
                            <Typography variant="body2" fontWeight="medium" color="primary.main">
                              Currently Associated: {contact.companyName}
                            </Typography>
                            {contact.companyId && (
                              <Typography variant="caption" color="text.secondary">
                                Company ID: {contact.companyId}
                              </Typography>
                            )}
                          </Box>
                        )}
                        
                        <Autocomplete
                          options={allCompanies}
                          getOptionLabel={(option) => option.companyName || option.name || ''}
                          value={allCompanies.find(c => c.id === contact.companyId) || null}
                          onChange={(event, newValue) => {
                            if (newValue) {
                              handleCompanyAssociation(newValue.id);
                            }
                          }}
                          loading={loadingCompanies}
                          renderInput={(params) => (
                            <TextField
                              {...params}
                              label="Associate with Company"
                              placeholder="Search companies..."
                              size="small"
                              InputProps={{
                                ...params.InputProps,
                                startAdornment: <BusinessIcon sx={{ fontSize: 16, mr: 1, color: 'text.secondary' }} />,
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
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <BusinessIcon fontSize="small" color="action" />
                                <Typography variant="body2">
                                  {option.companyName || option.name}
                                </Typography>
                                {option.industry && (
                                  <Chip label={option.industry} size="small" variant="outlined" />
                                )}
                              </Box>
                            </Box>
                          )}
                        />
                        
                        {suggestedCompanies.length > 0 && contact.email && contact.email.includes('@') && (
                          <Box sx={{ mt: 1 }}>
                            <Typography variant="caption" color="text.secondary" display="block" gutterBottom>
                              Suggested companies based on email domain ({contact.email.split('@')[1]}):
                            </Typography>
                            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                              {suggestedCompanies.map((company) => (
                                <Button
                                  key={company.id}
                                  variant="outlined"
                                  size="small"
                                  onClick={() => handleCompanyAssociation(company.id)}
                                  sx={{ justifyContent: 'flex-start', textAlign: 'left' }}
                                  startIcon={<BusinessIcon fontSize="small" />}
                                >
                                  <Box>
                                    <Typography variant="body2" fontWeight="medium">
                                      {company.companyName || company.name}
                                    </Typography>
                                    <Typography variant="caption" color="text.secondary">
                                      {company.industry || 'No industry'}
                                    </Typography>
                                  </Box>
                                </Button>
                              ))}
                            </Box>
                          </Box>
                        )}
                      </Box>
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

                      <Box>
                        <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                          Work Locations
                        </Typography>
                        
                        <Autocomplete
                          options={companyLocations.filter(loc => !selectedLocations.some(selected => selected.id === loc.id))}
                          getOptionLabel={(option) => option.nickname || option.name || option.title || 'Unknown Location'}
                          value={locationDropdownValue}
                          onChange={(event, newValue) => {
                            if (newValue) {
                              const newLocations = [...selectedLocations, newValue];
                              setSelectedLocations(newLocations);
                              handleLocationAssociationUpdate(newLocations);
                              setLocationDropdownValue(null);
                            }
                          }}
                          disabled={companyLocations.length === 0}
                          renderInput={(params) => (
                            <TextField
                              {...params}
                              label={selectedLocations.length > 0 ? "Add another location" : "Add work location"}
                              placeholder="Select a location to add..."
                              size="small"
                              InputProps={{
                                ...params.InputProps,
                                startAdornment: <LocationIcon sx={{ fontSize: 16, mr: 1, color: 'text.secondary' }} />,
                              }}
                            />
                          )}
                          renderOption={(props, option) => (
                            <Box component="li" {...props}>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <LocationIcon fontSize="small" color="action" />
                                <Typography variant="body2">
                                  {option.nickname || option.name || option.title || 'Unknown Location'}
                                </Typography>
                                {option.code && (
                                  <Chip label={option.code} size="small" variant="outlined" />
                                )}
                              </Box>
                            </Box>
                          )}
                        />
                        
                        {selectedLocations.length > 0 && (
                          <TableContainer component={Paper} variant="outlined" sx={{ mt: 2, maxHeight: 200 }}>
                            <Table size="small">
                              <TableHead>
                                <TableRow>
                                  <TableCell>Location</TableCell>
                                  <TableCell align="right">Actions</TableCell>
                                </TableRow>
                              </TableHead>
                              <TableBody>
                                {selectedLocations.map((location) => (
                                  <TableRow key={location.id}>
                                    <TableCell>
                                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                        <LocationIcon fontSize="small" color="action" />
                                        <Typography variant="body2">
                                          {location.nickname || location.name || location.title || 'Unknown Location'}
                                        </Typography>
                                        {location.code && (
                                          <Chip label={location.code} size="small" variant="outlined" />
                                        )}
                                      </Box>
                                    </TableCell>
                                    <TableCell align="right">
                                      <IconButton
                                        size="small"
                                        onClick={() => {
                                          const newLocations = selectedLocations.filter(loc => loc.id !== location.id);
                                          setSelectedLocations(newLocations);
                                          handleLocationAssociationUpdate(newLocations);
                                        }}
                                        color="error"
                                      >
                                        <DeleteIcon fontSize="small" />
                                      </IconButton>
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </TableContainer>
                        )}
                        
                        {selectedLocations.length === 0 && (
                          <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                            No work locations assigned. Use the dropdown above to add locations.
                          </Typography>
                        )}
                      </Box>

                      {(contact.address || contact.city || contact.state || contact.country || contact.formattedAddress) && (
                        <Box sx={{ mt: 2, p: 2, bgcolor: 'grey.50', borderRadius: 1 }}>
                          <Typography variant="subtitle2" fontWeight="medium" color="text.primary" gutterBottom>
                            Contact Address
                          </Typography>
                          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                            {contact.formattedAddress && (
                              <Typography variant="body2" color="text.secondary">
                                {contact.formattedAddress}
                              </Typography>
                            )}
                            {!contact.formattedAddress && (
                              <>
                                {contact.address && (
                                  <Typography variant="body2" color="text.secondary">
                                    {contact.address}
                                  </Typography>
                                )}
                                {(contact.city || contact.state || contact.country) && (
                                  <Typography variant="body2" color="text.secondary">
                                    {[contact.city, contact.state, contact.country].filter(Boolean).join(', ')}
                                  </Typography>
                                )}
                                {contact.zipcode && (
                                  <Typography variant="body2" color="text.secondary">
                                    {contact.zipcode}
                                  </Typography>
                                )}
                              </>
                            )}
                            {contact.timeZone && (
                              <Typography variant="caption" color="text.secondary">
                                Time Zone: {contact.timeZone}
                              </Typography>
                            )}
                          </Box>
                        </Box>
                      )}

                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Box>
                          <Typography variant="body2" component="div">
                            Active Contact
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {contact.isActive !== false ? 'Contact is active and available for engagement' : 'Contact is archived or inactive'}
                          </Typography>
                        </Box>
                        <FormControlLabel
                          control={
                            <Switch
                              checked={contact.isActive !== false}
                              onChange={(e) => handleContactUpdate('isActive', e.target.checked)}
                              color="primary"
                            />
                          }
                          label=""
                        />
                      </Box>
                    </Box>
                  ) : (
                    // View Mode - Show as Read-Only Text
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
                                  <Typography variant="body1" sx={{ mt: 0.25 }}>
                                    <MUILink 
                                      href={`mailto:${contact.email}`} 
                                      color="primary" 
                                      underline="hover"
                                      sx={{ wordBreak: 'break-all' }}
                                    >
                                      {contact.email}
                                    </MUILink>
                                  </Typography>
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
                                  <Typography variant="body1" sx={{ mt: 0.25 }}>
                                    {contact.phone || contact.workPhone || '-'}
                                  </Typography>
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
                                  <Typography variant="body1" sx={{ mt: 0.25 }}>
                                    {contact.mobilePhone}
                                  </Typography>
                                </Box>
                              </Box>
                            </Grid>
                          )}
                          {(contact.address || contact.city || contact.state || contact.country || contact.formattedAddress) && (
                            <Grid item xs={12}>
                              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                                <LocationIcon sx={{ fontSize: 18, color: 'text.secondary', mt: 0.5, flexShrink: 0 }} />
                                <Box sx={{ flex: 1, minWidth: 0 }}>
                                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', fontWeight: 500 }}>
                                    Address
                                  </Typography>
                                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
                                    {contact.formattedAddress || 
                                     [contact.address, contact.city, contact.state, contact.country, contact.zipcode]
                                       .filter(Boolean)
                                       .join(', ') || '-'}
                                    {contact.timeZone && ` (${contact.timeZone})`}
                                  </Typography>
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

          {/* Center Column - Professional Summary & Recent Activity */}
          <Grid item xs={12} md={5}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {/* Professional Summary (shows only if content exists) */}
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
                            // Navigate to Notes tab for all activity types
                            setTabValue(1);
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

          {/* Right Column - Connections: Company, Location, Opportunities, Job Orders, Active Salespeople */}
          <Grid item xs={12} md={3}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {/* Company */}
              {company && (
                <Card>
                  <CardHeader 
                    title="Company" 
                    titleTypographyProps={{ variant: 'h6', fontWeight: 'bold' }}
                  />
                  <CardContent sx={{ p: 2 }}>
                    <Box 
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
                      onClick={() => navigate(`/companies/${company.id}`)}
                    >
                      <Avatar sx={{ width: 28, height: 28, fontSize: '0.75rem', bgcolor: 'primary.main' }}>
                        <BusinessIcon sx={{ fontSize: 16 }} />
                      </Avatar>
                      <Box sx={{ flex: 1 }}>
                        <Typography variant="body2" fontWeight="medium">
                          {company.companyName || company.name || 'Unknown Company'}
                        </Typography>
                        {company.industry && (
                          <Typography variant="caption" color="text.secondary">
                            {company.industry}
                          </Typography>
                        )}
                      </Box>
                    </Box>
                  </CardContent>
                </Card>
              )}

              {/* Location */}
              {selectedLocations.length > 0 && selectedLocations.map((location) => (
                <Card key={location.id}>
                  <CardHeader 
                    title="Location" 
                    titleTypographyProps={{ variant: 'h6', fontWeight: 'bold' }}
                  />
                  <CardContent sx={{ p: 2 }}>
                    <Box 
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
                      onClick={() => {
                        if (company?.id) {
                          navigate(`/companies/${company.id}/locations/${location.id}`);
                        }
                      }}
                    >
                      <Avatar sx={{ width: 28, height: 28, fontSize: '0.75rem', bgcolor: 'primary.main' }}>
                        <LocationIcon sx={{ fontSize: 16 }} />
                      </Avatar>
                      <Box sx={{ flex: 1 }}>
                        <Typography variant="body2" fontWeight="medium">
                          {location.nickname || location.name || location.title || 'Unknown Location'}
                        </Typography>
                        {location.code && (
                          <Typography variant="caption" color="text.secondary">
                            {location.code}
                          </Typography>
                        )}
                      </Box>
                    </Box>
                  </CardContent>
                </Card>
              ))}

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
                          const calculateExpectedRevenueRange = (deal: any) => {
                            if (!deal.stageData?.qualification) {
                              return { min: 0, max: 0, hasData: false };
                            }

                            const qualData = deal.stageData.qualification;
                            const payRate = qualData.expectedAveragePayRate || 16;
                            const markup = qualData.expectedAverageMarkup || 40;
                            const timeline = qualData.staffPlacementTimeline;

                            if (!timeline) {
                              return { min: 0, max: 0, hasData: false };
                            }

                            const billRate = payRate * (1 + markup / 100);
                            const annualHoursPerEmployee = 2080;
                            const annualRevenuePerEmployee = billRate * annualHoursPerEmployee;
                            const startingCount = timeline.starting || 0;
                            const after180DaysCount = timeline.after180Days || timeline.after90Days || timeline.after30Days || startingCount;
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
                              onClick={() => navigate(`/recruiter/deals/${deal.id}`)}
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
                          const aDate = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt || 0);
                          const bDate = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt || 0);
                          return bDate.getTime() - aDate.getTime();
                        })
                        .slice(0, 5)
                        .map((jobOrder: any) => {
                          let contactRole = '';
                          if (jobOrder.hrContactId === contactId) contactRole = 'HR Contact';
                          else if (jobOrder.decisionMaker === contactId) contactRole = 'Decision Maker';
                          else if (jobOrder.operationsContactId === contactId) contactRole = 'Operations';
                          else if (jobOrder.procurementContactId === contactId) contactRole = 'Procurement';
                          else if (jobOrder.billingContactId === contactId) contactRole = 'Billing';
                          else if (jobOrder.safetyContactId === contactId) contactRole = 'Safety';
                          else if (jobOrder.invoiceContactId === contactId) contactRole = 'Invoice';
                          
                          const statusLabels: Record<string, string> = {
                            'open': 'Open',
                            'draft': 'Draft',
                            'on_hold': 'On Hold',
                            'filled': 'Filled',
                            'completed': 'Completed',
                            'cancelled': 'Cancelled'
                          };
                          const statusLabel = statusLabels[jobOrder.status] || jobOrder.status || 'Unknown';
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
        <NotesTab contact={contact} tenantId={tenantId} />
      </TabPanel>

      <TabPanel value={tabValue} index={2}>
        {contact && tenantId && (
          <ContactActivityTab contact={contact} tenantId={tenantId} />
        )}
      </TabPanel>
      </Box>

      {/* Add Note Dialog */}
      <AddNoteDialog
        open={showAddNoteDialog}
        onClose={() => setShowAddNoteDialog(false)}
        entityId={contact?.id || ''}
        entityType="contact"
        entityName={contact?.fullName || `${contact?.firstName || ''} ${contact?.lastName || ''}`.trim() || 'Contact'}
        tenantId={tenantId || ''}
        contacts={contact ? [contact] : []}
        onNoteAdded={() => {
          // Optionally refresh notes or trigger any updates
          console.log('Note added successfully');
        }}
      />

      {/* Log Activity Dialog */}
      <LogActivityDialog
        open={showLogActivityDialog}
        onClose={() => setShowLogActivityDialog(false)}
        onSubmit={handleLogActivity}
        loading={logActivityLoading}
        salespeople={salespeople}
        contacts={contact ? [contact] : []}
        preselectContactsFromProps={true}
        currentUserId={currentUser?.uid || ''}
        tenantId={tenantId || ''}
      />
    </Box>
  );
};

// Tab Components
const NotesTab: React.FC<{
  contact: any;
  tenantId: string | null;
}> = ({ contact, tenantId }) => {
  if (!tenantId || !contact) return null;

  return (
    <CRMNotesTab
      entityId={contact.id}
      entityType="contact"
      entityName={contact.fullName || `${contact.firstName} ${contact.lastName}` || 'Contact'}
      tenantId={tenantId}
    />
  );
};

export default RecruiterContactDetails;

