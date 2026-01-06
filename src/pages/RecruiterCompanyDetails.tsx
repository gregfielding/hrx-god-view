import React, { useEffect, useState, useRef, useCallback } from 'react';
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
  Tabs,
  Tab,
  Badge,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Autocomplete,
  Avatar,
  Snackbar,
  Alert,
  FormHelperText,
  TableContainer,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  FormControlLabel,
  Switch,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Collapse,
  Skeleton,
  Checkbox,
  List,
  ListItem,
  ListItemText,
  InputAdornment,
} from '@mui/material';
import {
  Phone as PhoneIcon,
  Add as AddIcon,
  ArrowBack as ArrowBackIcon,
  LocationOn as LocationIcon,
  Language as LanguageIcon,
  Work as WorkIcon,
  AttachMoney as DealIcon,
  Person as PersonIcon,
  Dashboard as DashboardIcon,
  Place as PlaceIcon,
  AttachMoney as OpportunitiesIcon,
  Notes as NotesIcon,
  LinkedIn as LinkedInIcon,
  SmartToy as AIIcon,
  CloudUpload as UploadIcon,
  Delete as DeleteIcon,
  Facebook as FacebookIcon,
  Twitter as TwitterIcon,
  Refresh as RefreshIcon,
  OpenInNew as OpenInNewIcon,
  LocationOn as LocationOnIcon,
  Visibility,
  Security as SecurityIcon,
  AccessTime as TimeClockIcon,
  Receipt as BillingIcon,
  AttachFile as ContractsIcon,
  Edit as EditIcon,
  KeyboardArrowDown as KeyboardArrowDownIcon,
  Business as BusinessIcon,
  Event as EventIcon,
  Email as EmailIcon,
  Close as CloseIcon,
  RocketLaunch as RocketLaunchIcon,
  AccountTree as AccountTreeIcon,
  CheckCircle as CheckCircleIcon,
  Search as SearchIcon,
  Clear as ClearIcon,
  ArrowUpward as ArrowUpwardIcon,
  ArrowDownward as ArrowDownwardIcon,
  Save as SaveIcon,
  BusinessCenter as BusinessCenterIcon,
  Handshake as HandshakeIcon,
} from '@mui/icons-material';
import MUILink from '@mui/material/Link';
import { Autocomplete as GoogleAutocomplete } from '@react-google-maps/api';
import {
  collection,
  doc,
  getDoc,
  query,
  where,
  orderBy,
  getDocs,
  addDoc,
  updateDoc,
  setDoc,
  deleteDoc,
  serverTimestamp,
  arrayUnion,
  arrayRemove,
  limit,
  startAfter,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { httpsCallable } from 'firebase/functions';

import { db, storage, functions } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import IndustrySelector from '../components/IndustrySelector';
import { geocodeAddress } from '../utils/geocodeAddress';
import { INDUSTRIES, getIndustriesByCategory, getIndustryByCode } from '../data/industries';
import AIEnrichmentWidget from '../components/AIEnrichmentWidget';
import DecisionMakersPanel from '../components/DecisionMakersPanel';
import CRMNotesTab from '../components/CRMNotesTab';
import { getStageHexColor, getTextContrastColor } from '../utils/crmStageColors';
import AIAssistantChat from '../components/AIAssistantChat';
import AddNoteDialog from '../components/AddNoteDialog';
import LogActivityDialog from '../components/LogActivityDialog';
import DealAgeChip from '../components/DealAgeChip';
import HealthBadge from '../components/HealthBadge';
import { calculateDealHealth, calculateDealAge } from '../utils/dealHealthCalculator';
import FavoriteButton from '../components/FavoriteButton';
import { useFavorites } from '../hooks/useFavorites';
import PageHeader from '../components/PageHeader';

// Helper function to get sub-industries
const getSubIndustries = (mainIndustryCode: string) => {
  if (!mainIndustryCode) return [];

  // Food Manufacturing (311) — prefer 3111-3119
  if (mainIndustryCode === '311') {
    return INDUSTRIES.filter(ind => ind.code.startsWith('311') && ind.code !== '311');
  }

  // Manufacturing sector (31x): return children where code starts with selected code and is longer
  if (/^\d{3}$/.test(mainIndustryCode) && mainIndustryCode.startsWith('31')) {
    return INDUSTRIES.filter(ind => ind.code.startsWith(mainIndustryCode) && ind.code !== mainIndustryCode);
  }

  // Generic: same category and longer codes, but bias to prefix matches if present
  const main = INDUSTRIES.find(ind => ind.code === mainIndustryCode);
  if (!main) return [];
  const inCategory = getIndustriesByCategory(main.category).filter(ind => ind.code !== mainIndustryCode);
  const prefixed = inCategory.filter(ind => ind.code.startsWith(mainIndustryCode));
  return prefixed.length > 0 ? prefixed : inCategory.filter(ind => ind.code.length > mainIndustryCode.length);
};

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
      id={`company-tabpanel-${index}`}
      aria-labelledby={`company-tab-${index}`}
      {...other}
    >
      {value === index && (
        <Box sx={{ p: 2 }}>
          {children}
        </Box>
      )}
    </div>
  );
}

const AngelListIcon = ({ hasUrl }: { hasUrl: boolean }) => (
  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
    <img
      src={hasUrl ? '/img/angellist-icon-blue.svg' : '/img/angellist-icon-grey.svg'}
      alt="AngelList"
      style={{ width: '16px', height: '16px' }}
    />
  </Box>
);

const CrunchbaseIcon = ({ hasUrl }: { hasUrl: boolean }) => (
  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
    <img
      src={hasUrl ? '/img/crunchbase-icon-blue.svg' : '/img/crunchbase-icon-grey.svg'}
      alt="Crunchbase"
      style={{ width: '18px', height: '18px' }}
    />
  </Box>
);

const RecruiterCompanyDetails: React.FC = () => {
  const { companyId } = useParams<{ companyId: string }>();
  const { tenantId, currentUser } = useAuth();
  const navigate = useNavigate();

  // Favorites
  const { isFavorite, toggleFavorite } = useFavorites('companies');

  const [company, setCompany] = useState<any>(null);
  const [contacts, setContacts] = useState<any[]>([]);
  const [deals, setDeals] = useState<any[]>([]);
  const [jobPostings, setJobPostings] = useState<any[]>([]);
  const [jobOrders, setJobOrders] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [notesCount, setNotesCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tabValue, setTabValue] = useState(0);
  
  // Get active tab from URL parameters
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const activeTab = urlParams.get('tab');
    if (activeTab !== null) {
      const tabIndex = parseInt(activeTab);
      if (tabIndex >= 0 && tabIndex <= 9) {
        setTabValue(tabIndex);
      }
    }
  }, []);

  const [salespeople, setSalespeople] = useState<any[]>([]);
  const [salespeopleLoading, setSalespeopleLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [logoLoading, setLogoLoading] = useState(false);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [tenantName, setTenantName] = useState<string>('');
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [companyContextOpen, setCompanyContextOpen] = useState(false);
  const [aiComponentsLoaded, setAiComponentsLoaded] = useState(false);
  const [showAddNoteDialog, setShowAddNoteDialog] = useState(false);
  const [showLogActivityDialog, setShowLogActivityDialog] = useState(false);
  const [logActivityLoading, setLogActivityLoading] = useState(false);
  const [aiEnhancing, setAiEnhancing] = useState(false);

  // Load company data
  useEffect(() => {
    if (companyId && tenantId) {
      loadCompanyData();
    }
  }, [companyId, tenantId]);

  const safeToDate = (value: any): Date | null => {
    try {
      if (!value) return null;
      if (value instanceof Date) return value;
      if (typeof value?.toDate === 'function') return value.toDate();
      if (typeof value?._seconds === 'number') return new Date(value._seconds * 1000);
      if (typeof value?.seconds === 'number') return new Date(value.seconds * 1000);
      const d = new Date(value);
      return isNaN(d.getTime()) ? null : d;
    } catch {
      return null;
    }
  };

  const loadCompanyData = async () => {
    if (!companyId || !tenantId) return;

    try {
      setLoading(true);
      setError(null);

      // Load company
      const companyRef = doc(db, 'tenants', tenantId, 'crm_companies', companyId);
      const companySnap = await getDoc(companyRef);
      
      if (!companySnap.exists()) {
        setError('Company not found');
        return;
      }

      const companyData = {
        id: companySnap.id,
        ...companySnap.data()
      };
      setCompany(companyData);

      // Load related data in parallel (deals loading is optional for recruiters)
      await Promise.all([
        loadContacts(),
        loadJobOrders(),
        loadLocations(),
        loadSalespeople(),
        loadTenantName(),
        loadNotesCount()
      ]);
      
      // Try to load deals, but don't fail if permissions are insufficient
      try {
        await loadDeals();
      } catch (error) {
        console.warn('Could not load deals (insufficient permissions):', error);
        // Continue without deals data
      }

    } catch (error) {
      console.error('Error loading company data:', error);
      setError('Failed to load company data');
    } finally {
      setLoading(false);
    }
  };

  const loadContacts = async () => {
    if (!companyId || !tenantId) return;

    try {
      const contactsRef = collection(db, 'tenants', tenantId, 'crm_contacts');
      const q = query(
        contactsRef,
        where('companyId', '==', companyId),
        orderBy('firstName', 'asc')
      );
      const snapshot = await getDocs(q);
      const contactsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setContacts(contactsData);
    } catch (error) {
      console.error('Error loading contacts:', error);
    }
  };

  const loadLocations = async () => {
    if (!companyId || !tenantId) return;

    try {
      const locationsRef = collection(db, 'tenants', tenantId, 'crm_companies', companyId, 'locations');
      const q = query(locationsRef, orderBy('createdAt', 'desc'));
      const snapshot = await getDocs(q);
      const locationsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setLocations(locationsData);
    } catch (error) {
      console.error('Error loading locations:', error);
    }
  };

  const loadDeals = async () => {
    if (!companyId || !tenantId) return;

    try {
      const dealsRef = collection(db, 'tenants', tenantId, 'crm_deals');
      
      // Query by companyId
      const qByCompanyId = query(
        dealsRef,
        where('companyId', '==', companyId)
      );
      
      // Query by primaryCompanyId
      const qByPrimaryCompanyId = query(
        dealsRef,
        where('primaryCompanyId', '==', companyId)
      );
      
      // Execute both queries
      const [snapshot1, snapshot2] = await Promise.all([
        getDocs(qByCompanyId).catch(err => {
          console.warn('Error loading deals by companyId:', err);
          return { docs: [] } as any;
        }),
        getDocs(qByPrimaryCompanyId).catch(err => {
          console.warn('Error loading deals by primaryCompanyId:', err);
          return { docs: [] } as any;
        })
      ]);
      
      // Combine and deduplicate deals
      const dealsMap = new Map();
      snapshot1.docs.forEach(doc => {
        dealsMap.set(doc.id, { id: doc.id, ...doc.data() });
      });
      snapshot2.docs.forEach(doc => {
        dealsMap.set(doc.id, { id: doc.id, ...doc.data() });
      });
      
      const dealsData = Array.from(dealsMap.values());
      setDeals(dealsData);
    } catch (error) {
      console.error('Error loading deals:', error);
    }
  };

  const loadJobOrders = async () => {
    if (!companyId || !tenantId) return;

    try {
      const jobOrdersRef = collection(db, 'tenants', tenantId, 'job_orders');
      const q = query(
        jobOrdersRef,
        where('companyId', '==', companyId),
        orderBy('createdAt', 'desc')
      );
      const snapshot = await getDocs(q);
      const jobOrdersData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setJobOrders(jobOrdersData);
    } catch (error) {
      console.error('Error loading job orders:', error);
    }
  };

  const loadNotesCount = async () => {
    if (!companyId || !tenantId) return;

    try {
      const notesRef = collection(db, 'tenants', tenantId, 'notes');
      const q = query(
        notesRef,
        where('entityId', '==', companyId),
        where('entityType', '==', 'company')
      );
      const snapshot = await getDocs(q);
      setNotesCount(snapshot.size);
    } catch (error) {
      console.error('Error loading notes count:', error);
    }
  };

  const loadSalespeople = async () => {
    if (!tenantId) return;

    try {
      setSalespeopleLoading(true);
      const usersRef = collection(db, 'users');
      const q = query(
        usersRef,
        where(`tenantIds.${tenantId}.role`, 'in', ['Salesperson', 'Manager', 'Admin'])
      );
      const snapshot = await getDocs(q);
      const salespeopleData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setSalespeople(salespeopleData);
    } catch (error) {
      console.error('Error loading salespeople:', error);
    } finally {
      setSalespeopleLoading(false);
    }
  };

  const loadTenantName = async () => {
    if (!tenantId) return;

    try {
      const tenantRef = doc(db, 'tenants', tenantId);
      const tenantSnap = await getDoc(tenantRef);
      if (tenantSnap.exists()) {
        const tenantData = tenantSnap.data();
        setTenantName(tenantData?.tenantName || '');
      }
    } catch (error) {
      console.error('Error loading tenant name:', error);
    }
  };

  const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
    // Update URL with tab parameter
    const url = new URL(window.location.href);
    url.searchParams.set('tab', newValue.toString());
    window.history.replaceState({}, '', url.toString());
  };

  // AI Enhancement Handler
  const handleEnhanceWithAI = async () => {
    if (!companyId || !tenantId || !company) return;

    setAiEnhancing(true);
    try {
      const companyName = company.companyName || company.name;
      if (!companyName) {
        setError('Company name is required for AI enhancement');
        setAiEnhancing(false);
        return;
      }

      // Use the Apollo-powered company enrichment function
      const { httpsCallable } = await import('firebase/functions');
      const { functions } = await import('../firebase');
      
      const enrichCompanyOnDemand = httpsCallable(functions, 'enrichCompanyOnDemand');
      const result = await enrichCompanyOnDemand({
        tenantId,
        companyId: company.id,
        mode: 'full',
        force: false
      });
      
      const resultData = result.data as any;
      console.log('Apollo company enrichment results:', resultData);
      
      // Check if logo was updated and update local state immediately
      let logoUpdated = false;
      if (resultData.status === 'ok' && resultData.data?.logo) {
        const newLogoUrl = resultData.data.logo;
        if (newLogoUrl && newLogoUrl !== company.logo) {
          setCompany((prev: any) => ({ ...prev, logo: newLogoUrl }));
          logoUpdated = true;
          console.log('[RecruiterCompanyDetails] Logo updated immediately:', newLogoUrl);
        }
      }
      
      // Also try to fetch logo directly if not already updated (parallel approach like CRM version)
      if (!logoUpdated && !company.logo) {
        try {
          // Try multiple logo sources
          const logoSources = [
            `https://logo.clearbit.com/${companyName.toLowerCase().replace(/\s+/g, '')}.com`,
            `https://logo.clearbit.com/${companyName.toLowerCase().replace(/[^a-z0-9]/g, '')}.com`,
            `https://logo.clearbit.com/${companyName.toLowerCase().replace(/\s+/g, '')}.org`,
            `https://logo.clearbit.com/${companyName.toLowerCase().replace(/[^a-z0-9]/g, '')}.org`
          ];

          // Add LinkedIn logo sources if we have a LinkedIn URL
          if (company.linkedin) {
            const linkedinUrl = company.linkedin;
            const linkedinLogoSources = [
              `${linkedinUrl}/logo.png`,
              `${linkedinUrl}/logo.jpg`,
              `${linkedinUrl}/logo.jpeg`,
              `${linkedinUrl}/company-logo.png`,
              `${linkedinUrl}/company-logo.jpg`,
              `${linkedinUrl.replace('/company/', '/')}/logo.png`,
              `${linkedinUrl.replace('/company/', '/')}/logo.jpg`
            ];
            logoSources.push(...linkedinLogoSources);
          }

          // Try each logo source
          for (const logoSource of logoSources) {
            try {
              console.log(`[RecruiterCompanyDetails] Trying logo source: ${logoSource}`);
              
              // Try fetching the logo
              const response = await fetch(logoSource, {
                method: 'GET',
                cache: 'no-cache'
              });
              
              if (response.ok) {
                const blob = await response.blob();
                
                // Check if the blob is actually an image (and not empty)
                if (blob && blob.size > 0 && blob.type.startsWith('image/')) {
                  const file = new File([blob], `${companyName.toLowerCase().replace(/\s+/g, '')}-logo.png`, { type: blob.type });

                  const storageRef = ref(storage, `companies/${tenantId}/${company.id}/ai-logo.png`);
                  await uploadBytes(storageRef, file);
                  const logoUrl = await getDownloadURL(storageRef);
                  
                  // Update Firestore
                  await updateDoc(doc(db, 'tenants', tenantId, 'crm_companies', company.id), {
                    logo: logoUrl,
                    updatedAt: serverTimestamp()
                  });
                  
                  // Update local state immediately
                  setCompany((prev: any) => ({ ...prev, logo: logoUrl }));
                  logoUpdated = true;
                  console.log(`[RecruiterCompanyDetails] Successfully uploaded logo from: ${logoSource}`);
                  break;
                }
              }
            } catch (logoErr: any) {
              // CORS errors are expected for some sources, continue to next
              if (logoErr.name === 'TypeError' && logoErr.message.includes('Failed to fetch')) {
                console.log(`[RecruiterCompanyDetails] CORS error for ${logoSource}, trying next source...`);
              } else {
                console.log(`[RecruiterCompanyDetails] Logo source failed: ${logoSource}`, logoErr);
              }
              // Continue to next logo source
            }
          }
        } catch (logoErr) {
          console.log('[RecruiterCompanyDetails] Logo fetching failed, continuing without logo:', logoErr);
        }
      }
      
      if (resultData.status === 'ok') {
        const successMsg = logoUpdated 
          ? 'Company enhanced with Apollo data successfully! Logo found and uploaded.'
          : 'Company enhanced with Apollo data successfully!';
        setSuccess(successMsg);
        // Reload company data to get any other updates
        await loadCompanyData();
      } else if (resultData.status === 'error') {
        setError(resultData.message || 'Failed to enhance company with Apollo data');
      } else {
        const successMsg = logoUpdated 
          ? `Company enhanced: ${resultData.message || 'Success'}. Logo found and uploaded.`
          : `Company enhanced: ${resultData.message || 'Success'}`;
        setSuccess(successMsg);
      }
      
    } catch (error: any) {
      console.error('Error enhancing company with AI:', error);
      setError('Failed to enhance company with AI. Please try again.');
    } finally {
      setAiEnhancing(false);
    }
  };

  // Log Activity Handler
  const handleLogActivity = async (taskData: any) => {
    setLogActivityLoading(true);
    try {
      // Import TaskService dynamically to avoid circular dependencies
      const { TaskService } = await import('../utils/taskService');
      const taskService = TaskService.getInstance();
      
      // Ensure the company is always associated with the activity
      const activityData = {
        ...taskData,
        tenantId,
        status: 'completed',
        completedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        associations: {
          ...taskData.associations,
          companies: [companyId], // Always associate with the current company
        }
      };
      
      await taskService.createTask(activityData);
      setShowLogActivityDialog(false);
      setSuccess('Activity logged successfully');
      
      // Trigger refresh event for activity data
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('refreshCompanyActivity', { 
          detail: { companyId } 
        }));
      }, 1000);
      
    } catch (error: any) {
      console.error('Error logging activity:', error);
      setError(error.message || 'Failed to log activity');
    } finally {
      setLogActivityLoading(false);
    }
  };

  // Logo upload handler
  const handleLogoUpload = async (url: string) => {
    if (!companyId || !tenantId) return;
    try {
      await updateDoc(doc(db, 'tenants', tenantId, 'crm_companies', companyId), { 
        logo: url,
        updatedAt: serverTimestamp()
      });
      setCompany((prev: any) => ({ ...prev, logo: url }));
      setSuccess('Logo uploaded successfully!');
    } catch (err) {
      console.error('Error updating logo:', err);
      setError('Failed to update logo. Please try again.');
    }
  };

  // Delete company handler
  const handleDeleteCompany = async () => {
    if (!companyId || !tenantId) return;
    
    setDeleting(true);
    try {
      // Delete the company document
      const companyRef = doc(db, 'tenants', tenantId, 'crm_companies', companyId);
      await deleteDoc(companyRef);
      
      // Navigate back to companies list
      navigate('/recruiter/companies');
    } catch (err: any) {
      console.error('Error deleting company:', err);
      setError('Failed to delete company. Please try again.');
    } finally {
      setDeleting(false);
      setDeleteDialogOpen(false);
    }
  };

  // Logo delete handler
  const handleLogoDelete = async () => {
    if (!companyId || !tenantId || !company?.logo) return;
    try {
      // Delete from storage
      const urlParts = company.logo.split('/');
      const fileName = urlParts[urlParts.length - 1];
      const fileExtension = fileName.split('.').pop() || 'png';
      const storageRef = ref(storage, `tenants/${tenantId}/companies/${companyId}/logo/${fileName}`);
      try {
        await deleteObject(storageRef);
      } catch (storageErr) {
        console.warn('Logo not found in storage, continuing with document update:', storageErr);
      }
      
      // Update document
      await updateDoc(doc(db, 'tenants', tenantId, 'crm_companies', companyId), { 
        logo: '',
        updatedAt: serverTimestamp()
      });
      setCompany((prev: any) => ({ ...prev, logo: '' }));
      setSuccess('Logo deleted successfully!');
    } catch (err) {
      console.error('Error deleting logo:', err);
      setError('Failed to delete logo. Please try again.');
    }
  };

  // Memoize related company items - must be before early returns
  const relatedCompanyItems = React.useMemo(() => {
    if (!company) return [];
    const items: Array<{ id: string; relation: 'parent' | 'child' | 'msp' }> = [];
    const parent = company.parentCompany || null;
    if (parent) {
      const id = typeof parent === 'string' ? parent : parent?.id;
      if (id) items.push({ id, relation: 'parent' });
    }
    const children: any[] = Array.isArray(company.childCompanies) ? company.childCompanies : [];
    children.forEach((child) => {
      const id = typeof child === 'string' ? child : child?.id;
      if (id) items.push({ id, relation: 'child' });
    });
    const msp = company.msp || null;
    if (msp) {
      const id = typeof msp === 'string' ? msp : msp?.id;
      if (id) items.push({ id, relation: 'msp' });
    }
    return items;
  }, [company]);

  if (loading) {
    return (
      <Box sx={{ p: 0 }}>
        <Box sx={{ mb: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 3 }}>
            <Skeleton variant="circular" width={128} height={128} />
            <Box sx={{ flex: 1 }}>
              <Skeleton variant="text" width={300} height={40} />
              <Skeleton variant="text" width={200} height={24} />
            </Box>
          </Box>
        </Box>
        <Skeleton variant="rectangular" width="100%" height={400} />
      </Box>
    );
  }

  if (error || !company) {
    return (
      <Box sx={{ p: 0 }}>
        <Alert severity="error">
          {error || 'Company not found'}
        </Alert>
        <Button onClick={() => navigate('/recruiter/companies')} sx={{ mt: 2 }}>
          Back to Companies
        </Button>
      </Box>
    );
  }

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

  const ensureUrlProtocol = (url?: string) => {
    if (!url) return '';
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    return `https://${url}`;
  };

  const companyName = company?.companyName || company?.name || 'Company';
  const companyInitial = String(companyName || 'C').trim().charAt(0).toUpperCase();

  const pipelineLow = Number(company?.pipelineValue?.low ?? 0);
  const pipelineHigh = Number(company?.pipelineValue?.high ?? 0);
  const revenueLine =
    Number.isFinite(pipelineLow) && Number.isFinite(pipelineHigh)
      ? `$${pipelineLow.toLocaleString()} \u2013 $${pipelineHigh.toLocaleString()}`
      : '';

  const employeesCount = company?.estimatedEmployees ?? company?.employees ?? company?.employeeCount ?? null;
  const employeesLine = employeesCount ? `Employees: ${Number(employeesCount).toLocaleString()}` : '';

  const addressParts = [
    company?.address,
    company?.city,
    company?.state,
    company?.zip || company?.zipcode,
  ].filter(Boolean);
  const addressLine = addressParts.join(', ');

  const lastUpdatedDate =
    safeToDate(company?.updatedAt) ||
    safeToDate(company?.lastUpdatedAt) ||
    safeToDate(company?.lastEnrichedAt) ||
    null;
  const lastUpdatedText = lastUpdatedDate ? `Last updated: ${lastUpdatedDate.toLocaleString()}` : '';

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      <PageHeader
        title={
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2.5 }}>
            <Avatar
              src={company?.logo || undefined}
              alt={companyName}
              sx={{
                width: 108,
                height: 108,
                bgcolor: 'primary.main',
                fontSize: '40px',
                fontWeight: 700,
                flexShrink: 0,
              }}
            >
              {companyInitial}
            </Avatar>

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
                  {companyName}
                </Typography>
                <FavoriteButton
                  itemId={company.id}
                  favoriteType="companies"
                  isFavorite={isFavorite}
                  toggleFavorite={toggleFavorite}
                  size="small"
                />
              </Box>

              {/* Line 2: key metadata (keep from screenshot) */}
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.5,
                  mt: 0.75,
                  flexWrap: 'wrap',
                  fontSize: '0.875rem',
                }}
              >
                {revenueLine && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                    <DealIcon sx={{ fontSize: 18, color: '#2E7D32' }} />
                    <Typography sx={{ fontSize: '0.875rem', fontWeight: 600, color: '#2E7D32' }}>
                      {revenueLine}
                    </Typography>
                  </Box>
                )}

                {employeesLine && (
                  <Typography sx={{ fontSize: '0.875rem', color: 'rgba(0,0,0,0.65)', fontWeight: 500 }}>
                    {employeesLine}
                  </Typography>
                )}
              </Box>

              {/* Line 3: address (keep from screenshot) */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mt: 0.75, flexWrap: 'wrap' }}>
                {addressLine && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                    <LocationOnIcon sx={{ fontSize: 18, color: 'rgba(0,0,0,0.55)' }} />
                    <Typography sx={{ fontSize: '0.875rem', color: 'rgba(0,0,0,0.55)', fontWeight: 500 }}>
                      {addressLine}
                    </Typography>
                  </Box>
                )}
              </Box>

              {/* Line 4: Social / contact icons */}
              {(company?.website || company?.linkedin) && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 0.5 }}>
                  {company?.website && (
                    <IconButton
                      size="small"
                      component="a"
                      href={ensureUrlProtocol(company.website)}
                      target="_blank"
                      rel="noopener noreferrer"
                      sx={{ p: 0.75, color: 'rgb(74, 144, 226)' }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <LanguageIcon fontSize="small" />
                    </IconButton>
                  )}
                  {company?.linkedin && (
                    <IconButton
                      size="small"
                      component="a"
                      href={ensureUrlProtocol(company.linkedin)}
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
            </Box>
          </Box>
        }
        filters={
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            {[
              { label: 'Overview', icon: <DashboardIcon fontSize="small" />, index: 0, badge: undefined },
              { label: 'Locations', icon: <PlaceIcon fontSize="small" />, index: 1, badge: locations?.length || 0 },
              { label: 'Contacts', icon: <PersonIcon fontSize="small" />, index: 2, badge: contacts?.length || 0 },
              { label: 'Opportunities', icon: <OpportunitiesIcon fontSize="small" />, index: 3, badge: deals?.length || 0 },
              { label: 'Notes', icon: <NotesIcon fontSize="small" />, index: 4, badge: notesCount || 0 },
              { label: 'Job Orders', icon: <WorkIcon fontSize="small" />, index: 5, badge: jobOrders?.length || 0 },
              { label: 'Defaults', icon: <BillingIcon fontSize="small" />, index: 6, badge: undefined },
            ].map((t) => {
              const isActive = tabValue === t.index;
              const hasBadge = typeof t.badge === 'number' && t.badge > 0;
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
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                    {t.label}
                    {hasBadge && <Badge badgeContent={t.badge} color="primary" />}
                  </Box>
                </Button>
              );
            })}
          </Box>
        }
        rightActions={
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Button
                variant="outlined"
                startIcon={<ArrowBackIcon />}
                onClick={() => navigate('/recruiter/companies')}
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

              {/* Keep these buttons and functions */}
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

              <Button
                variant="contained"
                startIcon={<AIIcon />}
                onClick={handleEnhanceWithAI}
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
            </Box>

            {lastUpdatedText && (
              <Typography sx={{ fontSize: '14px', color: 'rgba(0, 0, 0, 0.55)' }}>
                {lastUpdatedText}
              </Typography>
            )}
          </Box>
        }
      />

      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', pb: 2 }}>

      {/* Tab Panels */}
      <TabPanel value={tabValue} index={0}>
        <CompanyDashboardTab 
          company={company} 
          tenantId={tenantId} 
          contacts={contacts} 
          deals={deals}
        />
      </TabPanel>
      
      <TabPanel value={tabValue} index={1}>
        <LocationsTab company={company} currentTab={tabValue} locations={locations} />
      </TabPanel>
      
      <TabPanel value={tabValue} index={2}>
        <ContactsTab contacts={contacts} company={company} locations={locations} />
      </TabPanel>
      
      <TabPanel value={tabValue} index={3}>
        <OpportunitiesTab deals={deals} company={company} locations={locations} />
      </TabPanel>
      
      <TabPanel value={tabValue} index={4}>
        <NotesTab company={company} tenantId={tenantId} />
      </TabPanel>

      <TabPanel value={tabValue} index={5}>
        <JobOrdersTab jobOrders={jobOrders} routePrefix="recruiter" />
      </TabPanel>
      
      <TabPanel value={tabValue} index={6}>
        <DefaultsTab company={company} tenantId={tenantId} onSaved={() => setSuccess('Defaults saved')} />
      </TabPanel>

      {/* Delete Company Button - Bottom of page */}
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
          Delete Company
        </Button>
      </Box>

      {/* Success Snackbar */}
      <Snackbar
        open={!!success}
        autoHideDuration={6000}
        onClose={() => setSuccess(null)}
      >
        <Alert onClose={() => setSuccess(null)} severity="success">
          {success}
        </Alert>
      </Snackbar>
      <AddNoteDialog
        open={showAddNoteDialog}
        onClose={() => setShowAddNoteDialog(false)}
        entityId={company?.id || ''}
        entityType="company"
        entityName={company?.companyName || company?.name || ''}
        tenantId={tenantId || ''}
        contacts={contacts}
        onNoteAdded={() => setSuccess('Note added')}
      />
      <LogActivityDialog
        open={showLogActivityDialog}
        onClose={() => setShowLogActivityDialog(false)}
        onSubmit={handleLogActivity}
        loading={logActivityLoading}
        salespeople={salespeople}
        contacts={contacts}
        currentUserId={currentUser?.uid || ''}
        tenantId={tenantId || ''}
      />

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
            Are you sure you want to delete this company? This action cannot be undone and will also delete all associated contacts, deals, and locations.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)} color="primary">
            Cancel
          </Button>
          <Button onClick={handleDeleteCompany} color="error" variant="contained" disabled={deleting}>
            {deleting ? <CircularProgress size={24} /> : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
      </Box>
    </Box>
  );
};

const CompanyNameDisplay: React.FC<{ tenantId: string; companyId: string }> = ({ tenantId, companyId }) => {
  const [name, setName] = useState<string>('');

  useEffect(() => {
    if (!tenantId || !companyId || typeof companyId !== 'string') {
      setName('');
      return;
    }

    let isMounted = true;
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'tenants', tenantId, 'crm_companies', companyId));
        const data: any = snap.data() || {};
        const display = data.companyName || data.name || '';
        if (isMounted) setName(String(display || ''));
      } catch {
        if (isMounted) setName('');
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [tenantId, companyId]);

  return <>{name || companyId}</>;
};

// Recent Activity Widget for Dashboard
const RecentActivityWidget: React.FC<{ company: any; tenantId: string }> = ({ company, tenantId }) => {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    const load = async () => {
      if (!company?.id || !tenantId) return;
      setLoading(true);
      try {
        const companyId: string = company.id;
        const contactIds: string[] = Array.isArray(company.associations?.contacts) ? company.associations.contacts : [];
        const dealIds: string[] = Array.isArray(company.associations?.deals) ? company.associations.deals : [];

        const aggregated: any[] = [];

        // Tasks: completed tasks associated to this company (check both collections)
        const taskCollections = [
          { name: 'tasks', ref: collection(db, 'tenants', tenantId, 'tasks') },
          { name: 'crm_tasks', ref: collection(db, 'tenants', tenantId, 'crm_tasks') }
        ];

        for (const taskColl of taskCollections) {
          try {
            const tq = query(
              taskColl.ref,
              where('associations.companies', 'array-contains', companyId),
              where('status', '==', 'completed'),
              orderBy('updatedAt', 'desc'),
              limit(5)
            );
            const ts = await getDocs(tq);
            ts.forEach((docSnap) => {
              const d = docSnap.data() as any;
              aggregated.push({
                id: `${taskColl.name}_${docSnap.id}`,
                type: 'task',
                timestamp: d.completedAt ? new Date(d.completedAt) : (d.updatedAt?.toDate?.() || new Date()),
                title: d.title || 'Task completed',
                description: d.description || '',
                metadata: { priority: d.priority, taskType: d.type, source: taskColl.name }
              });
            });
          } catch {}
        }

        // Notes: company + contact + deal notes
        const notesScopes = [
          { coll: 'company_notes', ids: [companyId] },
          { coll: 'contact_notes', ids: contactIds },
          { coll: 'deal_notes', ids: dealIds },
        ];
        for (const scope of notesScopes) {
          for (const id of scope.ids) {
            try {
              const notesRef = collection(db, 'tenants', tenantId, scope.coll);
              const nq = query(notesRef, where('entityId', '==', id), orderBy('timestamp', 'desc'), limit(5));
              const ns = await getDocs(nq);
              ns.forEach((docSnap) => {
                const d = docSnap.data() as any;
                aggregated.push({
                  id: `note_${scope.coll}_${docSnap.id}`,
                  type: 'note',
                  timestamp: d.timestamp?.toDate?.() || new Date(),
                  title: d.category ? `Note (${d.category})` : 'Note',
                  description: d.content,
                  metadata: { authorName: d.authorName, priority: d.priority, source: d.source }
                });
              });
            } catch {}
          }
        }

        // Deal stage progression
        for (const dealId of dealIds) {
          try {
            const stageRef = collection(db, 'tenants', tenantId, 'crm_deals', dealId, 'stage_history');
            const sq = query(stageRef, orderBy('timestamp', 'desc'), limit(5));
            const ss = await getDocs(sq);
            ss.forEach((docSnap) => {
              const d = docSnap.data() as any;
              aggregated.push({
                id: `dealstage_${dealId}_${docSnap.id}`,
                type: 'deal_stage',
                timestamp: d.timestamp?.toDate?.() || new Date(),
                title: `Deal stage: ${d.fromStage || '?'} → ${d.toStage || d.stage || '?'}`,
                description: d.reason || 'Stage updated',
                metadata: { dealId }
              });
            });
          } catch {}
        }

        // Sort by timestamp and take the most recent 5
        aggregated.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
        setItems(aggregated.slice(0, 5));
      } catch (error) {
        console.error('Error loading recent activity:', error);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [company?.id, tenantId]);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Skeleton variant="rectangular" height={32} />
        <Skeleton variant="rectangular" height={32} />
        <Skeleton variant="rectangular" height={32} />
      </Box>
    );
  }

  if (items.length === 0) {
    return (
      <Box sx={{ textAlign: 'center', py: 2 }}>
        <Typography variant="body2" color="text.secondary">
          No recent activity
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Activities will appear here as they occur
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {items.map((item) => (
        <Box key={item.id} sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1 }}>
          <Avatar sx={{ width: 24, height: 24, fontSize: '0.75rem' }}>
            {item.type === 'task' && <EventIcon sx={{ fontSize: 16 }} />}
            {item.type === 'note' && <NotesIcon sx={{ fontSize: 16 }} />}
            {item.type === 'deal_stage' && <DealIcon sx={{ fontSize: 16 }} />}
            {item.type === 'email' && <EmailIcon sx={{ fontSize: 16 }} />}
          </Avatar>
          <Typography variant="body2" fontSize="0.75rem">
            {item.title}
          </Typography>
        </Box>
      ))}
    </Box>
  );
};

// Tab Components (simplified versions for recruiter context)
const CompanyDashboardTab: React.FC<{ 
  company: any; 
  tenantId: string; 
  contacts: any[]; 
  deals: any[];
}> = ({ company, tenantId, contacts, deals }) => {
  const [isEditingCompanyDetails, setIsEditingCompanyDetails] = useState(false);
  const [jobOrders, setJobOrders] = useState<any[]>([]);
  const [loadingJobOrders, setLoadingJobOrders] = useState(false);
  const [rebuildingActive, setRebuildingActive] = useState(false);
  const [localSuccess, setLocalSuccess] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const navigate = useNavigate();

  // Local helper: URL protocol enforcement
  const ensureUrlProtocol = (url: string): string => {
    if (!url) return url as any;
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    return 'https://' + url;
  };

  // Local helper: update a single company field
  const updateCompanyField = async (field: string, value: any) => {
    try {
      let processed = value;
      if (['website', 'linkedin', 'indeed', 'facebook'].includes(field) && value) {
        processed = ensureUrlProtocol(value as string);
      }
      await updateDoc(doc(db, 'tenants', tenantId, 'crm_companies', company.id), { [field]: processed });
    } catch (e) {
      console.error('Error updating company field', field, e);
    }
  };

  // Load job orders for company
  const loadJobOrdersForCompany = async () => {
    if (!company?.id || !tenantId) {
      setJobOrders([]);
      return;
    }
    
    try {
      setLoadingJobOrders(true);
      const jobOrdersRef = collection(db, 'tenants', tenantId, 'job_orders');
      
      // Query job orders where companyId matches
      const companyQuery = query(jobOrdersRef, where('companyId', '==', company.id));
      const snapshot = await getDocs(companyQuery);
      
      const jobOrdersData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      
      setJobOrders(jobOrdersData);
    } catch (err) {
      console.error('Error loading job orders for company:', err);
      setJobOrders([]);
    } finally {
      setLoadingJobOrders(false);
    }
  };

  // Load job orders when company changes
  useEffect(() => {
    if (company?.id && tenantId) {
      loadJobOrdersForCompany();
    }
  }, [company?.id, tenantId]);

  return (
    <Grid container spacing={3}>
      {/* Left Column - Action Focused */}
      <Grid item xs={12} md={4}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {/* Company Details (Widget) */}
          <Box sx={{ mb: 0, boxShadow: 0 }}>
            <Card>
              <CardHeader 
                title="Company Details"
                titleTypographyProps={{ variant: 'h6', fontWeight: 'bold' }}
                action={
                  <IconButton
                    size="small"
                    onClick={() => setIsEditingCompanyDetails(!isEditingCompanyDetails)}
                    sx={{
                      color: isEditingCompanyDetails ? 'primary.main' : 'text.secondary',
                    }}
                  >
                    <EditIcon fontSize="small" />
                  </IconButton>
                }
              />
              <CardContent sx={{ p: 2 }}>
                {isEditingCompanyDetails ? (
                  // Edit Mode - Show Input Fields
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <TextField
                      label="Company Name"
                      defaultValue={company.companyName || company.name || ''}
                      onBlur={(e) => updateCompanyField('companyName', e.target.value)}
                      size="small"
                      fullWidth
                    />
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={!!company.centralizedVendorProcess}
                          onChange={(e) => updateCompanyField('centralizedVendorProcess', e.target.checked)}
                          size="small"
                        />
                      }
                      label="Centralized Vendor Process"
                    />
                    <TextField
                      label="Website URL"
                      defaultValue={company.website || ''}
                      onBlur={(e) => updateCompanyField('website', e.target.value)}
                      size="small"
                      fullWidth
                      InputProps={{ startAdornment: <LanguageIcon sx={{ fontSize: 16, mr: 1, color: 'text.secondary' }} /> }}
                    />
                    <TextField
                      label="Corporate Phone Number"
                      defaultValue={company.phone || ''}
                      onBlur={(e) => updateCompanyField('phone', e.target.value)}
                      size="small"
                      fullWidth
                      InputProps={{ startAdornment: <PhoneIcon sx={{ fontSize: 16, mr: 1, color: 'text.secondary' }} /> }}
                    />
                    <TextField
                      label="LinkedIn URL"
                      defaultValue={company.linkedin || ''}
                      onBlur={(e) => updateCompanyField('linkedin', e.target.value)}
                      size="small"
                      fullWidth
                      InputProps={{ startAdornment: <LinkedInIcon sx={{ fontSize: 16, mr: 1, color: 'text.secondary' }} /> }}
                    />
                    <TextField
                      label="Indeed Company URL"
                      defaultValue={company.indeed || ''}
                      onBlur={(e) => updateCompanyField('indeed', e.target.value)}
                      size="small"
                      fullWidth
                      InputProps={{ startAdornment: <WorkIcon sx={{ fontSize: 16, mr: 1, color: 'text.secondary' }} /> }}
                    />
                    <TextField
                      label="Facebook Page URL"
                      defaultValue={company.facebook || ''}
                      onBlur={(e) => updateCompanyField('facebook', e.target.value)}
                      size="small"
                      fullWidth
                      InputProps={{ startAdornment: <FacebookIcon sx={{ fontSize: 16, mr: 1, color: 'text.secondary' }} /> }}
                    />
                    <TextField
                      label="Twitter URL"
                      defaultValue={company.twitter || ''}
                      onBlur={(e) => updateCompanyField('twitter', e.target.value)}
                      size="small"
                      fullWidth
                      InputProps={{ startAdornment: <TwitterIcon sx={{ fontSize: 16, mr: 1, color: 'text.secondary' }} /> }}
                    />
                    <TextField
                      label="AngelList URL"
                      defaultValue={company.angellist || ''}
                      onBlur={(e) => updateCompanyField('angellist', e.target.value)}
                      size="small"
                      fullWidth
                      InputProps={{ startAdornment: <AngelListIcon hasUrl={!!company.angellist} /> }}
                    />
                    <TextField
                      label="Crunchbase URL"
                      defaultValue={company.crunchbase || ''}
                      onBlur={(e) => updateCompanyField('crunchbase', e.target.value)}
                      size="small"
                      fullWidth
                      InputProps={{ startAdornment: <CrunchbaseIcon hasUrl={!!company.crunchbase} /> }}
                    />
                    <TextField
                      label="Founded Year"
                      defaultValue={company.foundedYear || ''}
                      onBlur={(e) => updateCompanyField('foundedYear', e.target.value)}
                      size="small"
                      fullWidth
                    />
                    <TextField
                      label="Estimated Employees"
                      defaultValue={company.estimatedEmployees || ''}
                      onBlur={(e) => updateCompanyField('estimatedEmployees', e.target.value)}
                      size="small"
                      fullWidth
                    />
                    <TextField
                      label="Annual Revenue ($)"
                      defaultValue={company.annualRevenue || ''}
                      onBlur={(e) => updateCompanyField('annualRevenue', e.target.value)}
                      size="small"
                      fullWidth
                    />
                    <IndustrySelector
                      value={company.industry || ''}
                      onChange={async (industryCode) => {
                        await updateCompanyField('industry', industryCode);
                        await updateCompanyField('subIndustry', '');
                      }}
                      label="Industry"
                      variant="select"
                      showCategory={false}
                    />
                    <FormControl fullWidth size="small" disabled={!company.industry}>
                      <InputLabel>Sub-Industry</InputLabel>
                      <Select
                        value={(company.subIndustry && getSubIndustries(company.industry).some(si => si.code === company.subIndustry)) ? company.subIndustry : ''}
                        label="Sub-Industry"
                        onChange={(e) => updateCompanyField('subIndustry', e.target.value)}
                      >
                        <MenuItem value="">
                          <em>Select a sub-industry</em>
                        </MenuItem>
                        {(() => {
                          const subIndustries = company.industry ? getSubIndustries(company.industry) : [];
                          return subIndustries.map((industry) => (
                            <MenuItem key={industry.code} value={industry.code}>
                              <Box>
                                <Typography variant="body2">{industry.name}</Typography>
                                <Typography variant="caption" color="text.secondary">
                                  {industry.code}
                                </Typography>
                              </Box>
                            </MenuItem>
                          ));
                        })()}
                      </Select>
                      <FormHelperText>
                        {company.industry 
                          ? `Select a more specific industry classification (${getSubIndustries(company.industry).length} options available)`
                          : 'Select a more specific industry classification'}
                      </FormHelperText>
                    </FormControl>
                  </Box>
                ) : (
                  // View Mode - Show as Read-Only Text with Better Visual Hierarchy
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {/* Basic Information Section */}
                    <Box>
                      <Typography variant="subtitle2" fontWeight={600} color="text.primary" sx={{ mb: 2, fontSize: '0.875rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        Basic Information
                      </Typography>
                      <Grid container spacing={2}>
                        {(company.companyName || company.name) && (
                          <Grid item xs={12} sm={6}>
                            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                              <BusinessIcon sx={{ fontSize: 18, color: 'text.secondary', mt: 0.5, flexShrink: 0 }} />
                              <Box sx={{ flex: 1, minWidth: 0 }}>
                                <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', fontWeight: 500 }}>
                                  Company Name
                                </Typography>
                                <Typography variant="body1" sx={{ mt: 0.25, fontWeight: 500 }}>
                                  {company.companyName || company.name}
                                </Typography>
                              </Box>
                            </Box>
                          </Grid>
                        )}
                        {company.foundedYear && (
                          <Grid item xs={12} sm={6}>
                            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                              <TimeClockIcon sx={{ fontSize: 18, color: 'text.secondary', mt: 0.5, flexShrink: 0 }} />
                              <Box sx={{ flex: 1, minWidth: 0 }}>
                                <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', fontWeight: 500 }}>
                                  Founded Year
                                </Typography>
                                <Typography variant="body1" sx={{ mt: 0.25 }}>
                                  {company.foundedYear}
                                </Typography>
                              </Box>
                            </Box>
                          </Grid>
                        )}
                        {company.estimatedEmployees && (
                          <Grid item xs={12} sm={6}>
                            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                              <PersonIcon sx={{ fontSize: 18, color: 'text.secondary', mt: 0.5, flexShrink: 0 }} />
                              <Box sx={{ flex: 1, minWidth: 0 }}>
                                <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', fontWeight: 500 }}>
                                  Estimated Employees
                                </Typography>
                                <Typography variant="body1" sx={{ mt: 0.25 }}>
                                  {typeof company.estimatedEmployees === 'number' ? company.estimatedEmployees.toLocaleString() : company.estimatedEmployees}
                                </Typography>
                              </Box>
                            </Box>
                          </Grid>
                        )}
                        {company.annualRevenue && (
                          <Grid item xs={12} sm={6}>
                            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                              <DealIcon sx={{ fontSize: 18, color: 'text.secondary', mt: 0.5, flexShrink: 0 }} />
                              <Box sx={{ flex: 1, minWidth: 0 }}>
                                <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', fontWeight: 500 }}>
                                  Annual Revenue
                                </Typography>
                                <Typography variant="body1" sx={{ mt: 0.25 }}>
                                  ${typeof company.annualRevenue === 'number' ? company.annualRevenue.toLocaleString() : company.annualRevenue}
                                </Typography>
                              </Box>
                            </Box>
                          </Grid>
                        )}
                        {company.industry && (
                          <Grid item xs={12} sm={6}>
                            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                              <WorkIcon sx={{ fontSize: 18, color: 'text.secondary', mt: 0.5, flexShrink: 0 }} />
                              <Box sx={{ flex: 1, minWidth: 0 }}>
                                <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', fontWeight: 500 }}>
                                  Industry
                                </Typography>
                                <Typography variant="body1" sx={{ mt: 0.25 }}>
                                  {getIndustryByCode(company.industry)?.name || company.industry}
                                </Typography>
                              </Box>
                            </Box>
                          </Grid>
                        )}
                      </Grid>
                    </Box>

                    {/* Contact Information Section */}
                    {(company.website || company.phone || company.linkedin || company.indeed || company.facebook || company.twitter || company.angellist || company.crunchbase) && (
                      <Box>
                        <Typography variant="subtitle2" fontWeight={600} color="text.primary" sx={{ mb: 2, fontSize: '0.875rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                          Contact & Social Media
                        </Typography>
                        <Grid container spacing={2}>
                          {company.website && (
                            <Grid item xs={12} sm={6}>
                              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                                <LanguageIcon sx={{ fontSize: 18, color: 'text.secondary', mt: 0.5, flexShrink: 0 }} />
                                <Box sx={{ flex: 1, minWidth: 0 }}>
                                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', fontWeight: 500 }}>
                                    Website
                                  </Typography>
                                  <Typography variant="body1" sx={{ mt: 0.25 }}>
                                    <MUILink 
                                      href={company.website.startsWith('http') ? company.website : `https://${company.website}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      color="primary"
                                      underline="hover"
                                      sx={{ wordBreak: 'break-all' }}
                                    >
                                      {company.website}
                                    </MUILink>
                                  </Typography>
                                </Box>
                              </Box>
                            </Grid>
                          )}
                          {company.phone && (
                            <Grid item xs={12} sm={6}>
                              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                                <PhoneIcon sx={{ fontSize: 18, color: 'text.secondary', mt: 0.5, flexShrink: 0 }} />
                                <Box sx={{ flex: 1, minWidth: 0 }}>
                                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', fontWeight: 500 }}>
                                    Corporate Phone
                                  </Typography>
                                  <Typography variant="body1" sx={{ mt: 0.25 }}>
                                    {company.phone}
                                  </Typography>
                                </Box>
                              </Box>
                            </Grid>
                          )}
                          {company.linkedin && (
                            <Grid item xs={12} sm={6}>
                              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                                <LinkedInIcon sx={{ fontSize: 18, color: 'text.secondary', mt: 0.5, flexShrink: 0 }} />
                                <Box sx={{ flex: 1, minWidth: 0 }}>
                                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', fontWeight: 500 }}>
                                    LinkedIn
                                  </Typography>
                                  <Typography variant="body1" sx={{ mt: 0.25 }}>
                                    <MUILink 
                                      href={company.linkedin.startsWith('http') ? company.linkedin : `https://${company.linkedin}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      color="primary"
                                      underline="hover"
                                      sx={{ wordBreak: 'break-all' }}
                                    >
                                      {company.linkedin}
                                    </MUILink>
                                  </Typography>
                                </Box>
                              </Box>
                            </Grid>
                          )}
                          {company.indeed && (
                            <Grid item xs={12} sm={6}>
                              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                                <WorkIcon sx={{ fontSize: 18, color: 'text.secondary', mt: 0.5, flexShrink: 0 }} />
                                <Box sx={{ flex: 1, minWidth: 0 }}>
                                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', fontWeight: 500 }}>
                                    Indeed
                                  </Typography>
                                  <Typography variant="body1" sx={{ mt: 0.25 }}>
                                    <MUILink 
                                      href={company.indeed.startsWith('http') ? company.indeed : `https://${company.indeed}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      color="primary"
                                      underline="hover"
                                      sx={{ wordBreak: 'break-all' }}
                                    >
                                      {company.indeed}
                                    </MUILink>
                                  </Typography>
                                </Box>
                              </Box>
                            </Grid>
                          )}
                          {company.facebook && (
                            <Grid item xs={12} sm={6}>
                              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                                <FacebookIcon sx={{ fontSize: 18, color: 'text.secondary', mt: 0.5, flexShrink: 0 }} />
                                <Box sx={{ flex: 1, minWidth: 0 }}>
                                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', fontWeight: 500 }}>
                                    Facebook
                                  </Typography>
                                  <Typography variant="body1" sx={{ mt: 0.25 }}>
                                    <MUILink 
                                      href={company.facebook.startsWith('http') ? company.facebook : `https://${company.facebook}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      color="primary"
                                      underline="hover"
                                      sx={{ wordBreak: 'break-all' }}
                                    >
                                      {company.facebook}
                                    </MUILink>
                                  </Typography>
                                </Box>
                              </Box>
                            </Grid>
                          )}
                          {company.twitter && (
                            <Grid item xs={12} sm={6}>
                              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                                <TwitterIcon sx={{ fontSize: 18, color: 'text.secondary', mt: 0.5, flexShrink: 0 }} />
                                <Box sx={{ flex: 1, minWidth: 0 }}>
                                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', fontWeight: 500 }}>
                                    Twitter
                                  </Typography>
                                  <Typography variant="body1" sx={{ mt: 0.25 }}>
                                    <MUILink 
                                      href={company.twitter.startsWith('http') ? company.twitter : `https://${company.twitter}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      color="primary"
                                      underline="hover"
                                      sx={{ wordBreak: 'break-all' }}
                                    >
                                      {company.twitter}
                                    </MUILink>
                                  </Typography>
                                </Box>
                              </Box>
                            </Grid>
                          )}
                          {company.angellist && (
                            <Grid item xs={12} sm={6}>
                              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                                <Box sx={{ width: 18, height: 18, mt: 0.5, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                  <img src="/img/angellist-icon-blue.svg" alt="AngelList" style={{ width: '16px', height: '16px' }} />
                                </Box>
                                <Box sx={{ flex: 1, minWidth: 0 }}>
                                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', fontWeight: 500 }}>
                                    AngelList
                                  </Typography>
                                  <Typography variant="body1" sx={{ mt: 0.25 }}>
                                    <MUILink 
                                      href={company.angellist.startsWith('http') ? company.angellist : `https://${company.angellist}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      color="primary"
                                      underline="hover"
                                      sx={{ wordBreak: 'break-all' }}
                                    >
                                      {company.angellist}
                                    </MUILink>
                                  </Typography>
                                </Box>
                              </Box>
                            </Grid>
                          )}
                          {company.crunchbase && (
                            <Grid item xs={12} sm={6}>
                              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                                <Box sx={{ width: 18, height: 18, mt: 0.5, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                  <img src="/img/crunchbase-icon-blue.svg" alt="Crunchbase" style={{ width: '16px', height: '16px' }} />
                                </Box>
                                <Box sx={{ flex: 1, minWidth: 0 }}>
                                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', fontWeight: 500 }}>
                                    Crunchbase
                                  </Typography>
                                  <Typography variant="body1" sx={{ mt: 0.25 }}>
                                    <MUILink 
                                      href={company.crunchbase.startsWith('http') ? company.crunchbase : `https://${company.crunchbase}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      color="primary"
                                      underline="hover"
                                      sx={{ wordBreak: 'break-all' }}
                                    >
                                      {company.crunchbase}
                                    </MUILink>
                                  </Typography>
                                </Box>
                              </Box>
                            </Grid>
                          )}
                        </Grid>
                      </Box>
                    )}

                    {/* Additional Details Section */}
                    {(company.centralizedVendorProcess || company.subIndustry) && (
                      <Box>
                        <Typography variant="subtitle2" fontWeight={600} color="text.primary" sx={{ mb: 2, fontSize: '0.875rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                          Additional Details
                        </Typography>
                        <Grid container spacing={2}>
                          {company.centralizedVendorProcess && (
                            <Grid item xs={12}>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <CheckCircleIcon sx={{ fontSize: 18, color: 'success.main' }} />
                                <Typography variant="body2" color="text.secondary">
                                  Centralized Vendor Process
                                </Typography>
                              </Box>
                            </Grid>
                          )}
                          {company.subIndustry && (
                            <Grid item xs={12} sm={6}>
                              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                                <WorkIcon sx={{ fontSize: 18, color: 'text.secondary', mt: 0.5, flexShrink: 0 }} />
                                <Box sx={{ flex: 1, minWidth: 0 }}>
                                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', fontWeight: 500 }}>
                                    Sub-Industry
                                  </Typography>
                                  <Typography variant="body1" sx={{ mt: 0.25 }}>
                                    {(() => {
                                      const subIndustries = company.industry ? getSubIndustries(company.industry) : [];
                                      const subIndustry = subIndustries.find(si => si.code === company.subIndustry);
                                      return subIndustry?.name || company.subIndustry;
                                    })()}
                                  </Typography>
                                </Box>
                              </Box>
                            </Grid>
                          )}
                        </Grid>
                      </Box>
                    )}
                  </Box>
                )}
              </CardContent>
            </Card>
          </Box>
        </Box>
      </Grid>

      {/* Center Column - Company Intelligence */}
      <Grid item xs={12} md={5}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {/* Company Description Widget */}
          <Box sx={{ mb: 0 }}>
            <Card>
              <CardHeader 
                title="Company Description"
                titleTypographyProps={{ variant: 'h6', fontWeight: 'bold' }}
              />
              <CardContent sx={{ p: 2 }}>
                {company.shortDescription || company.description ? (
                  <Typography variant="body2" color="text.primary" sx={{ lineHeight: 1.6 }}>
                    {company.shortDescription || company.description}
                  </Typography>
                ) : (
                  <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                    No company description available. Use AI Enhance to generate one.
                  </Typography>
                )}
              </CardContent>
            </Card>
          </Box>

          {/* Recent Activity */}
          <Card>
            <CardHeader 
              title="Recent Activity" 
              titleTypographyProps={{ variant: 'h6', fontWeight: 'bold' }}
            />
            <CardContent sx={{ p: 2 }}>
              <RecentActivityWidget company={company} tenantId={tenantId} />
            </CardContent>
          </Card>
        </Box>
      </Grid>

      {/* Right Column - Opportunities + Active Salespeople */}
      <Grid item xs={12} md={3}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {/* Opportunities */}
          <Card>
            <CardHeader 
              title="Opportunities" 
              titleTypographyProps={{ variant: 'h6', fontWeight: 'bold' }}
            />
            <CardContent sx={{ p: 2 }}>
              {deals && deals.length > 0 ? (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {deals
                    .sort((a: any, b: any) => (b.expectedRevenue || 0) - (a.expectedRevenue || 0))
                    .slice(0, 5)
                    .map((deal: any) => {
                      const calculateExpectedRevenueRange = (deal: any) => {
                        if (deal.stageData?.qualification) {
                          const qualData = deal.stageData.qualification;
                          const payRate = qualData.expectedAveragePayRate || 16;
                          const markup = qualData.expectedAverageMarkup || 40;
                          const timeline = qualData.staffPlacementTimeline;

                          if (timeline) {
                            const billRate = payRate * (1 + markup / 100);
                            const annualHoursPerEmployee = 2080;
                            const annualRevenuePerEmployee = billRate * annualHoursPerEmployee;
                            const startingCount = timeline.starting || 0;
                            const after180DaysCount = timeline.after180Days || timeline.after90Days || timeline.after30Days || startingCount;
                            
                            if (startingCount > 0 || after180DaysCount > 0) {
                              const minRevenue = annualRevenuePerEmployee * startingCount;
                              const maxRevenue = annualRevenuePerEmployee * after180DaysCount;
                              return `$${minRevenue.toLocaleString()} - $${maxRevenue.toLocaleString()}`;
                            }
                          }
                        }
                        
                        if (deal.expectedRevenue) {
                          const revenue = deal.expectedRevenue || 0;
                          if (revenue < 10000) return '$0 - $10K';
                          if (revenue < 50000) return '$10K - $50K';
                          if (revenue < 100000) return '$50K - $100K';
                          if (revenue < 500000) return '$100K - $500K';
                          if (revenue < 1000000) return '$500K - $1M';
                          return '$1M+';
                        }
                        
                        return '$0 - $0';
                      };

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
                            cursor: 'pointer' 
                          }}
                          onClick={() => navigate(`/recruiter/deals/${deal.id}`)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => { 
                            if (e.key === 'Enter' || e.key === ' ') { 
                              e.preventDefault(); 
                              navigate(`/recruiter/deals/${deal.id}`); 
                            } 
                          }}
                        >
                          <Avatar sx={{ width: 32, height: 32, fontSize: '0.875rem', bgcolor: getStageHexColor(deal.stage) }}>
                            <DealIcon sx={{ fontSize: 16 }} />
                          </Avatar>
                          <Box sx={{ flex: 1 }}>
                            <Typography variant="body2" fontWeight="medium">
                              {deal.name || 'Unnamed Deal'}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {calculateExpectedRevenueRange(deal)} • {deal.stage || 'Unknown Stage'}
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

          {/* Active Salespeople */}
          <Card>
            <CardHeader 
              title="Active Salespeople" 
              titleTypographyProps={{ variant: 'h6', fontWeight: 'bold' }}
              action={
                <Button size="small" disabled={rebuildingActive} onClick={async () => {
                  try {
                    setRebuildingActive(true);
                    const fn = httpsCallable(functions, 'rebuildCompanyActiveSalespeople');
                    const resp: any = await fn({ tenantId, companyId: company.id });
                    const data = resp?.data || {};
                    if (data.ok) {
                      setLocalSuccess(`Active salespeople updated (${data.count ?? data.updated ?? 0})`);
                    } else if (data.error) {
                      setLocalError(`Rebuild failed: ${data.error}`);
                    } else {
                      setLocalSuccess('Rebuild requested');
                    }
                    try {
                      await getDoc(doc(db, 'tenants', tenantId, 'crm_companies', company.id));
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
              {company?.activeSalespeople && Object.keys(company.activeSalespeople).length > 0 ? (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {Object.values(company.activeSalespeople as any)
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
                <Typography variant="body2" color="text.secondary">No recent salesperson activity</Typography>
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
                          onClick={() => navigate(`/recruiter/job-orders/${jobOrder.id}`)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => { 
                            if (e.key === 'Enter' || e.key === ' ') { 
                              e.preventDefault(); 
                              navigate(`/recruiter/job-orders/${jobOrder.id}`); 
                            } 
                          }}
                        >
                          <Avatar sx={{ width: 28, height: 28, fontSize: '0.75rem', bgcolor: 'primary.main' }}>
                            <WorkIcon sx={{ fontSize: 16 }} />
                          </Avatar>
                          <Box sx={{ flex: 1 }}>
                            <Typography variant="body2" fontWeight="medium">
                              {jobOrder.jobOrderName || jobOrder.jobTitle || 'Unknown Job Order'}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              #{jobOrderNumber} • {statusLabel}
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

          {/* Recent Contacts */}
          <Card>
            <CardHeader 
              title="Recent Contacts" 
              titleTypographyProps={{ variant: 'h6', fontWeight: 'bold' }}
            />
            <CardContent sx={{ p: 2 }}>
              {contacts.length > 0 ? (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {contacts.slice(0, 5).map((contact) => (
                    <Box
                      key={contact.id}
                      sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1, borderRadius: 1, bgcolor: 'grey.50', cursor: 'pointer' }}
                      onClick={() => navigate(`/recruiter/contacts/${contact.id}`)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/recruiter/contacts/${contact.id}`); } }}
                    >
                      <Avatar sx={{ width: 32, height: 32, fontSize: '0.875rem' }}>
                        {contact.firstName?.charAt(0) || contact.name?.charAt(0) || 'C'}
                      </Avatar>
                      <Box sx={{ flex: 1 }}>
                        <Typography variant="body2" fontWeight="medium">
                          {contact.firstName} {contact.lastName}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {contact.title || 'No title'}
                        </Typography>
                      </Box>
                    </Box>
                  ))}
                </Box>
              ) : (
                <Box sx={{ textAlign: 'center', py: 3 }}>
                  <Typography variant="h6" color="text.secondary" sx={{ mb: 1 }}>
                    No contacts yet
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    Add your first contact to get started
                  </Typography>
                </Box>
              )}
            </CardContent>
          </Card>
        </Box>
      </Grid>
    </Grid>
  );
};

const LocationsTab: React.FC<{ company: any; currentTab: number; locations: any[] }> = ({ company, currentTab, locations: initialLocations }) => {
  const { tenantId } = useAuth();
  const navigate = useNavigate();
  const [locations, setLocations] = useState<any[]>(initialLocations);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newLocation, setNewLocation] = useState({
    name: '',
    code: '',
    address: '',
    city: '',
    state: '',
    zipCode: '',
    country: 'USA',
    type: 'Office',
    division: '',
    phone: '',
    coordinates: null
  });
  const autocompleteRef = useRef<any>(null);

  // Filter locations based on search query
  const filteredLocations = React.useMemo(() => {
    if (!searchQuery.trim()) {
      return locations;
    }
    
    const searchLower = searchQuery.toLowerCase();
    return locations.filter((location) => {
      const name = (location.name || location.nickname || '').toLowerCase();
      const code = (location.code || '').toLowerCase();
      const city = (location.city || '').toLowerCase();
      const state = (location.state || '').toLowerCase();
      
      return name.includes(searchLower) || 
             code.includes(searchLower) || 
             city.includes(searchLower) || 
             state.includes(searchLower);
    });
  }, [locations, searchQuery]);

  // Reload locations when company changes
  useEffect(() => {
    loadLocations();
  }, [company?.id, tenantId]);

  const loadLocations = async () => {
    if (!company?.id || !tenantId) return;
    
    try {
      setLoading(true);
      const locationsRef = collection(db, 'tenants', tenantId, 'crm_companies', company.id, 'locations');
      const q = query(locationsRef, orderBy('createdAt', 'desc'));
      const snapshot = await getDocs(q);
      const locationsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setLocations(locationsData);
    } catch (err) {
      console.error('Error loading locations:', err);
      setError('Failed to load locations');
    } finally {
      setLoading(false);
    }
  };

  const handleAddLocation = async () => {
    if (!company?.id || !tenantId) return;
    
    try {
      const locationData = {
        ...newLocation,
        createdAt: new Date().toISOString(),
        discoveredBy: 'Manual',
        contactCount: 0,
        dealCount: 0,
        salespersonCount: 0
      };

      const locationsRef = collection(db, 'tenants', tenantId, 'crm_companies', company.id, 'locations');
      const docRef = await addDoc(locationsRef, locationData);
      
      const addedLocation = { id: docRef.id, ...locationData };
      setLocations(prev => [...prev, addedLocation]);
      
      setNewLocation({
        name: '',
        code: '',
        address: '',
        city: '',
        state: '',
        zipCode: '',
        country: 'USA',
        type: 'Office',
        division: '',
        phone: '',
        coordinates: null
      });
      setShowAddForm(false);
      setError(null);
    } catch (err) {
      console.error('Error adding location:', err);
      setError('Failed to add location');
    }
  };

  if (loading && locations.length === 0) {
    return (
      <Box sx={{ p: 3, textAlign: 'center' }}>
        <CircularProgress />
        <Typography sx={{ mt: 2 }}>Loading locations...</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 0 }}>
      {/* Header with Search and Add Location Button */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 0, mb: 1, py: 0, px: 3, gap: 2 }}>
        <Typography variant="h6" fontWeight={700}>
          Company Locations
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, justifyContent: 'flex-end' }}>
          <TextField
            size="small"
            variant="outlined"
            placeholder="Search by name, code, city, or state..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" sx={{ color: 'text.secondary' }} />
                </InputAdornment>
              ),
              endAdornment: searchQuery && (
                <InputAdornment position="end">
                  <IconButton
                    size="small"
                    onClick={() => setSearchQuery('')}
                    sx={{ p: 0.5 }}
                  >
                    <ClearIcon fontSize="small" />
                  </IconButton>
                </InputAdornment>
              )
            }}
            sx={{ 
              width: 280,
              height: 36,
              '& .MuiOutlinedInput-root': {
                height: 36,
                borderRadius: '6px',
                backgroundColor: 'white',
                fontSize: '0.875rem',
                '& fieldset': {
                  borderColor: '#E5E7EB',
                },
                '&:hover fieldset': {
                  borderColor: '#D1D5DB',
                },
              }
            }}
          />
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setShowAddForm(true)}
          >
            Add Location
          </Button>
        </Box>
      </Box>

      {/* Error Display */}
      {error && (
        <Alert severity="error" sx={{ mb: 2, mx: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Add Location Dialog */}
      <Dialog 
        open={showAddForm} 
        onClose={() => {
          setShowAddForm(false);
          setNewLocation({
            name: '',
            code: '',
            address: '',
            city: '',
            state: '',
            zipCode: '',
            country: 'USA',
            type: 'Office',
            division: '',
            phone: '',
            coordinates: null
          });
        }}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          <Box display="flex" alignItems="center" justifyContent="space-between">
            <Typography variant="h6">Add New Location</Typography>
            <IconButton 
              onClick={() => {
                setShowAddForm(false);
                setNewLocation({
                  name: '',
                  code: '',
                  address: '',
                  city: '',
                  state: '',
                  zipCode: '',
                  country: 'USA',
                  type: 'Office',
                  division: '',
                  phone: '',
                  coordinates: null
                });
              }}
            >
              <CloseIcon />
            </IconButton>
          </Box>
        </DialogTitle>
        
        <DialogContent>
          <Box sx={{ pt: 1 }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              Add a new location for this company. Use the address field to automatically populate city, state, and ZIP code.
            </Typography>

            {error && (
              <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
                {error}
              </Alert>
            )}

            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Grid container spacing={2}>
                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    label="Location Name"
                    value={newLocation.name}
                    onChange={(e) => setNewLocation(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="e.g., Headquarters, Manufacturing Plant"
                  />
                </Grid>
                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    label="Location Code"
                    value={newLocation.code}
                    onChange={(e) => setNewLocation(prev => ({ ...prev, code: e.target.value }))}
                    placeholder="Internal code (e.g., HQ-01)"
                  />
                </Grid>
                <Grid item xs={12} md={6}>
                  <Autocomplete
                    fullWidth
                    freeSolo
                    options={[
                      'Office',
                      'Warehouse',
                      'Plant',
                      'Distribution Center',
                      'Manufacturing',
                      'Retail',
                      'Branch',
                      'Headquarters',
                      'Data Center',
                      'Call Center',
                      'Research & Development',
                      'Training Center',
                      'Service Center',
                      'Showroom',
                      'Storage Facility',
                      'Hotel',
                      'Medical Clinic',
                      'Hospital',
                      'Retirement Home',
                      'Sports Arena',
                      'Sports Stadium',
                      'Golf Course',
                      'Fairgrounds',
                      'Concert Venue',
                      'Convention Center',
                      'College',
                      'High School',
                      'Dining Hall',
                    ]}
                    value={newLocation.type || ''}
                    onChange={(_, newValue) => setNewLocation(prev => ({ ...prev, type: newValue || '' }))}
                    renderInput={(params) => (
                      <TextField {...params} label="Type" />
                    )}
                  />
                </Grid>
                {company.divisions && company.divisions.length > 0 && (
                  <Grid item xs={12} md={6}>
                    <FormControl fullWidth>
                      <InputLabel>Division (Optional)</InputLabel>
                      <Select
                        value={newLocation.division}
                        label="Division (Optional)"
                        onChange={(e) => setNewLocation(prev => ({ ...prev, division: e.target.value }))}
                      >
                        <MenuItem value="">
                          <em>No division</em>
                        </MenuItem>
                        {company.divisions.map((division: string) => (
                          <MenuItem key={division} value={division}>
                            {division}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Grid>
                )}
                <Grid item xs={12}>
                  <GoogleAutocomplete
                    onLoad={(ref) => {
                      autocompleteRef.current = ref;
                    }}
                    onPlaceChanged={() => {
                      const place = autocompleteRef.current?.getPlace();
                      if (place?.geometry?.location) {
                        const lat = place.geometry.location.lat();
                        const lng = place.geometry.location.lng();
                        
                        const addressComponents = place.address_components || [];
                        let streetNumber = '';
                        let route = '';
                        let city = '';
                        let state = '';
                        let zipCode = '';
                        let country = 'USA';

                        addressComponents.forEach((component: any) => {
                          const types = component.types;
                          if (types.includes('street_number')) {
                            streetNumber = component.long_name;
                          } else if (types.includes('route')) {
                            route = component.long_name;
                          } else if (types.includes('locality')) {
                            city = component.long_name;
                          } else if (types.includes('administrative_area_level_1')) {
                            state = component.short_name;
                          } else if (types.includes('postal_code')) {
                            zipCode = component.long_name;
                          } else if (types.includes('country')) {
                            country = component.short_name;
                          }
                        });

                        const fullAddress = streetNumber && route ? `${streetNumber} ${route}` : place.formatted_address || '';

                        setNewLocation(prev => ({
                          ...prev,
                          address: fullAddress,
                          city,
                          state,
                          zipCode,
                          country,
                          coordinates: {
                            lat,
                            lng
                          }
                        }));
                      }
                    }}
                  >
                    <TextField
                      fullWidth
                      label="Address"
                      value={newLocation.address}
                      onChange={(e) => setNewLocation(prev => ({ ...prev, address: e.target.value }))}
                      placeholder="Start typing an address..."
                      InputProps={{
                        endAdornment: newLocation.coordinates && (
                          <Box sx={{ display: 'flex', alignItems: 'center', mr: 1 }}>
                            <Chip 
                              size="small" 
                              label="📍 GPS" 
                              color="success" 
                              variant="outlined"
                            />
                          </Box>
                        )
                      }}
                    />
                  </GoogleAutocomplete>
                </Grid>
                <Grid item xs={12} md={4}>
                  <TextField
                    fullWidth
                    label="City"
                    value={newLocation.city}
                    onChange={(e) => setNewLocation(prev => ({ ...prev, city: e.target.value }))}
                  />
                </Grid>
                <Grid item xs={12} md={4}>
                  <TextField
                    fullWidth
                    label="State"
                    value={newLocation.state}
                    onChange={(e) => setNewLocation(prev => ({ ...prev, state: e.target.value }))}
                  />
                </Grid>
                <Grid item xs={12} md={4}>
                  <TextField
                    fullWidth
                    label="ZIP Code"
                    value={newLocation.zipCode}
                    onChange={(e) => setNewLocation(prev => ({ ...prev, zipCode: e.target.value }))}
                  />
                </Grid>
                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    label="Phone"
                    value={newLocation.phone}
                    onChange={(e) => {
                      const raw = e.target.value.replace(/[^\d]/g, '').slice(0, 10);
                      const pretty = raw.length >= 10
                        ? `(${raw.slice(0,3)}) ${raw.slice(3,6)}-${raw.slice(6,10)}`
                        : raw;
                      setNewLocation(prev => ({ ...prev, phone: pretty }));
                    }}
                    placeholder="(555) 123-4567"
                  />
                </Grid>
                {newLocation.coordinates && (
                  <Grid item xs={12}>
                    <Box sx={{ 
                      p: 2, 
                      bgcolor: 'success.light', 
                      borderRadius: 1, 
                      border: '1px solid',
                      borderColor: 'success.main'
                    }}>
                      <Typography variant="subtitle2" color="success.dark" gutterBottom>
                        📍 GPS Coordinates Captured
                      </Typography>
                      <Typography variant="body2" color="success.dark">
                        Latitude: {newLocation.coordinates.lat.toFixed(6)} | Longitude: {newLocation.coordinates.lng.toFixed(6)}
                      </Typography>
                    </Box>
                  </Grid>
                )}
              </Grid>
            </Box>
          </Box>
        </DialogContent>

        <DialogActions sx={{ p: 3, pt: 0 }}>
          <Button 
            onClick={() => {
              setShowAddForm(false);
              setNewLocation({
                name: '',
                code: '',
                address: '',
                city: '',
                state: '',
                zipCode: '',
                country: 'USA',
                type: 'Office',
                division: '',
                phone: '',
                coordinates: null
              });
            }}
            variant="outlined"
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            color="primary"
            startIcon={<AddIcon />}
            onClick={handleAddLocation}
            disabled={!newLocation.name || !newLocation.address}
            size="large"
          >
            Add Location
          </Button>
        </DialogActions>
      </Dialog>

      {/* Locations Table */}
      {loading && locations.length === 0 ? (
        <Box px={3} pb={3}>
          <TableContainer 
            component={Paper} 
            variant="outlined"
            sx={{ 
              overflowX: 'auto',
              borderRadius: 1,
              border: '1px solid',
              borderColor: 'divider',
              boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)',
              '& .MuiTable-root': {
                borderCollapse: 'separate',
                borderSpacing: 0
              }
            }}
          >
            <Table sx={{ minWidth: 1200 }}>
              <TableHead>
                <TableRow sx={{ 
                  backgroundColor: 'grey.50',
                  borderBottom: '2px solid',
                  borderColor: 'divider',
                  '& th': {
                    borderBottom: '2px solid',
                    borderColor: 'divider',
                    fontWeight: 600
                  }
                }}>
                  <TableCell sx={{ fontSize: '0.75rem', fontWeight: 600, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em', py: 1.75, pl: 2 }}>Location Name</TableCell>
                  <TableCell sx={{
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    color: '#374151',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    borderBottom: '1px solid #E5E7EB',
                    py: 1.5
                  }}>
                    Code
                  </TableCell>
                  <TableCell sx={{
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    color: '#374151',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    borderBottom: '1px solid #E5E7EB',
                    py: 1.5
                  }}>
                    Address
                  </TableCell>
                  <TableCell sx={{
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    color: '#374151',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    borderBottom: '1px solid #E5E7EB',
                    py: 1.5
                  }}>
                    Type
                  </TableCell>
                  <TableCell sx={{
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    color: '#374151',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    borderBottom: '1px solid #E5E7EB',
                    py: 1.5
                  }}>
                    Division
                  </TableCell>
                  <TableCell sx={{
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    color: '#374151',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    borderBottom: '1px solid #E5E7EB',
                    py: 1.5
                  }}>
                    Contacts
                  </TableCell>
                  <TableCell sx={{
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    color: '#374151',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    borderBottom: '1px solid #E5E7EB',
                    py: 1.5
                  }}>
                    Deals
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {Array.from({ length: 5 }).map((_, index) => (
                  <TableRow 
                    key={`skeleton-${index}`} 
                    sx={{ 
                      height: '48px',
                      bgcolor: index % 2 === 0 ? 'background.paper' : '#FAFAFA',
                      '& td': {
                        borderBottom: '1px solid',
                        borderColor: 'divider'
                      }
                    }}
                  >
                    <TableCell sx={{ pl: 2, pr: 2, py: 1.5 }}><Skeleton variant="text" width={140} height={20} /></TableCell>
                    <TableCell sx={{ py: 1 }}><Skeleton variant="text" width={80} height={20} /></TableCell>
                    <TableCell sx={{ py: 1 }}><Skeleton variant="text" width={200} height={20} /></TableCell>
                    <TableCell sx={{ py: 1 }}><Skeleton variant="rectangular" width={80} height={24} sx={{ borderRadius: 1 }} /></TableCell>
                    <TableCell sx={{ py: 1 }}><Skeleton variant="text" width={100} height={20} /></TableCell>
                    <TableCell sx={{ py: 1 }}><Skeleton variant="text" width={60} height={20} /></TableCell>
                    <TableCell sx={{ py: 1 }}><Skeleton variant="text" width={60} height={20} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      ) : filteredLocations.length === 0 && !showAddForm ? (
        <Box px={3} py={4} textAlign="center">
          <LocationIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 2 }} />
          <Typography variant="h6" color="text.secondary" gutterBottom>
            {searchQuery ? 'No locations match your search' : 'No Locations Found'}
          </Typography>
          {searchQuery && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Try adjusting your search terms
            </Typography>
          )}
        </Box>
      ) : filteredLocations.length > 0 ? (
        <TableContainer 
          component={Paper} 
          variant="outlined"
          sx={{
            overflowX: 'auto',
            borderRadius: '8px',
            boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)'
          }}
        >
          <Table sx={{ minWidth: 1200 }}>
            <TableHead>
              <TableRow sx={{ backgroundColor: '#F9FAFB' }}>
                <TableCell sx={{
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  color: '#374151',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  borderBottom: '1px solid #E5E7EB',
                  py: 1.5
                }}>
                  Location Name
                </TableCell>
                  <TableCell sx={{
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    color: '#374151',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    borderBottom: '1px solid #E5E7EB',
                    py: 1.5
                  }}>
                    Code
                  </TableCell>
                  <TableCell sx={{
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    color: '#374151',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    borderBottom: '1px solid #E5E7EB',
                    py: 1.5
                  }}>
                    Address
                  </TableCell>
                  <TableCell sx={{
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    color: '#374151',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    borderBottom: '1px solid #E5E7EB',
                    py: 1.5
                  }}>
                    Type
                  </TableCell>
                  <TableCell sx={{
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    color: '#374151',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    borderBottom: '1px solid #E5E7EB',
                    py: 1.5
                  }}>
                    Division
                  </TableCell>
                  <TableCell sx={{
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    color: '#374151',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    borderBottom: '1px solid #E5E7EB',
                    py: 1.5
                  }}>
                    Contacts
                  </TableCell>
                  <TableCell sx={{
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    color: '#374151',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    borderBottom: '1px solid #E5E7EB',
                    py: 1.5
                  }}>
                    Deals
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filteredLocations.map((location, index) => (
                    <TableRow 
                      key={location.id}
                      onClick={() => navigate(`/recruiter/companies/${company.id}/locations/${location.id}`)}
                      sx={{
                        height: '48px',
                        cursor: 'pointer',
                        '&:hover': {
                          backgroundColor: '#F9FAFB'
                        }
                      }}
                    >
                    <TableCell sx={{ py: 1, px: 2 }}>
                      <Typography sx={{ variant: "body2", fontWeight: 600, color: "#111827", fontSize: '0.9375rem' }}>
                        {location.name || location.nickname || 'Unnamed Location'}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ py: 1 }}>
                        {location.code ? (
                          <Typography sx={{ variant: "body2", color: "#374151", fontSize: '0.875rem', fontWeight: 500, fontFamily: 'monospace' }}>
                            {location.code}
                          </Typography>
                        ) : (
                          <Typography sx={{ variant: "body2", color: "#9CA3AF", fontSize: '0.875rem' }}>
                            -
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell sx={{ py: 1 }}>
                        <Typography sx={{ variant: "body2", color: "#111827", fontSize: '0.875rem' }}>
                          {location.address || location.street || '-'}
                        </Typography>
                        {(location.city || location.state || location.zipCode) && (
                          <Typography sx={{ variant: "body2", color: "#6B7280", fontSize: '0.875rem' }}>
                            {[location.city, location.state, location.zipCode].filter(Boolean).join(', ')}
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell sx={{ py: 1 }}>
                        <Chip 
                          label={location.type || 'Unknown'} 
                          size="small" 
                          color="primary"
                          sx={{ fontSize: '0.75rem', fontWeight: 500 }}
                        />
                      </TableCell>
                      <TableCell sx={{ py: 1 }}>
                        {location.division ? (
                          <Chip 
                            label={location.division} 
                            size="small" 
                            color="secondary"
                            variant="outlined"
                            sx={{ fontSize: '0.75rem', fontWeight: 500 }}
                          />
                        ) : (
                          <Typography sx={{ variant: "body2", color: "#9CA3AF", fontSize: '0.875rem' }}>
                            -
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell sx={{ py: 1 }}>
                        <Typography sx={{ variant: "body2", color: "#374151", fontSize: '0.875rem', fontWeight: 500 }}>
                          {location.contactCount || 0}
                        </Typography>
                      </TableCell>
                      <TableCell sx={{ py: 1 }}>
                        <Typography sx={{ variant: "body2", color: "#374151", fontSize: '0.875rem', fontWeight: 500 }}>
                          {location.dealCount || 0}
                        </Typography>
                      </TableCell>
                    </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        ) : null}
    </Box>
  );
};

// Helper functions for ContactsTab
const getInitials = (name: string) => {
  return name
    .split(' ')
    .map(word => word.charAt(0))
    .join('')
    .toUpperCase()
    .slice(0, 2);
};

const avatarColors = [
  '#F3F4F6', '#FEF3C7', '#DBEAFE', '#D1FAE5',
  '#FCE7F3', '#EDE9FE', '#FEE2E2', '#FEF5E7'
];

const avatarTextColors = [
  '#6B7280', '#92400E', '#1E40AF', '#065F46',
  '#BE185D', '#5B21B6', '#DC2626', '#EA580C'
];

const getAvatarColor = (name: string) => {
  const hash = name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const colorIndex = hash % avatarColors.length;
  return {
    backgroundColor: avatarColors[colorIndex],
    color: avatarTextColors[colorIndex]
  };
};

const formatPhoneNumber = (phone: string): string => {
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length === 10) {
    return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
  } else if (cleaned.length === 11 && cleaned.startsWith('1')) {
    return `1 (${cleaned.slice(1, 4)}) ${cleaned.slice(4, 7)}-${cleaned.slice(7)}`;
  }
  return phone;
};

const ContactsTab: React.FC<{ contacts: any[]; company: any; locations: any[] }> = ({ contacts, company, locations }) => {
  const { tenantId, currentUser } = useAuth();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [loading] = useState(false);
  const [showAddContactDialog, setShowAddContactDialog] = useState(false);
  const [savingContact, setSavingContact] = useState(false);
  const [success, setSuccess] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  
  // Contact form state
  const [contactForm, setContactForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    jobTitle: '',
    contactType: 'Unknown',
    tags: [],
    isActive: true,
    notes: ''
  });
  
  // Load locations if not provided
  const [companyLocations, setCompanyLocations] = useState<any[]>(locations);
  
  const loadLocations = useCallback(async () => {
    if (!company?.id || !tenantId) return;
    try {
      const locationsRef = collection(db, 'tenants', tenantId, 'crm_companies', company.id, 'locations');
      const locationsSnap = await getDocs(locationsRef);
      const locationsData = locationsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setCompanyLocations(locationsData);
    } catch (err) {
      console.error('Error loading locations:', err);
    }
  }, [company?.id, tenantId]);

  useEffect(() => {
    if (locations.length === 0 && company?.id && tenantId) {
      loadLocations();
    } else {
      setCompanyLocations(locations);
    }
  }, [locations, company?.id, tenantId, loadLocations]);

  const handleContactFormChange = (field: string, value: string | boolean | string[]) => {
    setContactForm(prev => ({ ...prev, [field]: value }));
  };

  const handleTagsChange = (newTags: string[]) => {
    setContactForm(prev => ({ ...prev, tags: newTags }));
  };

  const handleSaveContact = async () => {
    if (!contactForm.firstName || !contactForm.lastName) {
      setError('First name and last name are required');
      return;
    }

    setSavingContact(true);
    setError(null);
    try {
      const contactData = {
        ...contactForm,
        fullName: `${contactForm.firstName} ${contactForm.lastName}`,
        tenantId,
        companyId: company.id,
        companyName: company.companyName || company.name,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        salesOwnerId: currentUser?.uid || null,
        accountOwnerId: currentUser?.uid || null
      };

      const contactsRef = collection(db, 'tenants', tenantId, 'crm_contacts');
      await addDoc(contactsRef, contactData);

      // Reset form and close dialog
      setContactForm({
        firstName: '',
        lastName: '',
        email: '',
        phone: '',
        jobTitle: '',
        contactType: 'Unknown',
        tags: [],
        isActive: true,
        notes: ''
      });
      setShowAddContactDialog(false);
      setSuccess(true);
      setSuccessMessage('Contact added successfully!');
      
      // Reload the page to refresh contacts
      setTimeout(() => {
        window.location.reload();
      }, 1000);
    } catch (err: any) {
      console.error('Error adding contact:', err);
      setError(err.message || 'Failed to add contact');
    } finally {
      setSavingContact(false);
    }
  };

  // Filter contacts based on search query
  const filteredContacts = React.useMemo(() => {
    if (!searchQuery.trim()) {
      return contacts;
    }
    
    const searchLower = searchQuery.toLowerCase();
    return contacts.filter((contact: any) => {
      const fullName = (contact.fullName || contact.name || `${contact.firstName || ''} ${contact.lastName || ''}` || '').toLowerCase();
      const firstName = (contact.firstName || '').toLowerCase();
      const lastName = (contact.lastName || '').toLowerCase();
      const email = (contact.email || '').toLowerCase();
      
      return fullName.includes(searchLower) || 
             firstName.includes(searchLower) || 
             lastName.includes(searchLower) || 
             email.includes(searchLower);
    });
  }, [contacts, searchQuery]);

  return (
    <Box sx={{ p: 0 }}>
      {/* Header with Search */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 0, mb: 1, py: 0, px: 3, gap: 2 }}>
        <Typography variant="h6" fontWeight={700}>
          Contacts
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, justifyContent: 'flex-end' }}>
          <TextField
            size="small"
            variant="outlined"
            placeholder="Search by name or email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" sx={{ color: 'text.secondary' }} />
                </InputAdornment>
              ),
              endAdornment: searchQuery && (
                <InputAdornment position="end">
                  <IconButton
                    size="small"
                    onClick={() => setSearchQuery('')}
                    sx={{ p: 0.5 }}
                  >
                    <ClearIcon fontSize="small" />
                  </IconButton>
                </InputAdornment>
              )
            }}
            sx={{ 
              width: 280,
              height: 36,
              '& .MuiOutlinedInput-root': {
                height: 36,
                borderRadius: '6px',
                backgroundColor: 'white',
                fontSize: '0.875rem',
                '& fieldset': {
                  borderColor: '#E5E7EB',
                },
                '&:hover fieldset': {
                  borderColor: '#D1D5DB',
                },
              }
            }}
          />
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setShowAddContactDialog(true)}
          >
            Add Contact
          </Button>
        </Box>
      </Box>

      {/* Error Display */}
      {error && (
        <Alert severity="error" sx={{ mb: 2, mx: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Contacts Table */}
      {loading && contacts.length === 0 ? (
        <Box px={3} pb={3}>
          <TableContainer 
            component={Paper} 
            variant="outlined"
            sx={{ 
              overflowX: 'auto',
              borderRadius: 1,
              border: '1px solid',
              borderColor: 'divider',
              boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)',
              '& .MuiTable-root': {
                borderCollapse: 'separate',
                borderSpacing: 0
              }
            }}
          >
            <Table sx={{ minWidth: 1200 }}>
              <TableHead>
                <TableRow sx={{ 
                  backgroundColor: 'grey.50',
                  borderBottom: '2px solid',
                  borderColor: 'divider'
                }}>
                  <TableCell sx={{ fontSize: '0.75rem', fontWeight: 600, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em', py: 1.75, px: 1.5 }}>Name</TableCell>
                  <TableCell sx={{ fontSize: '0.75rem', fontWeight: 600, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em', py: 1.75, px: 1.5 }}>Title</TableCell>
                  <TableCell sx={{ fontSize: '0.75rem', fontWeight: 600, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em', py: 1.75, px: 1.5 }}>Email</TableCell>
                  <TableCell sx={{ fontSize: '0.75rem', fontWeight: 600, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em', py: 1.75, px: 1.5 }}>Phone</TableCell>
                  <TableCell sx={{ fontSize: '0.75rem', fontWeight: 600, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em', py: 1.75, px: 1.5 }}>Location</TableCell>
                  <TableCell sx={{ fontSize: '0.75rem', fontWeight: 600, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em', py: 1.75, px: 1.5 }}>LinkedIn</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {[1, 2, 3].map((i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton height={20} /></TableCell>
                    <TableCell><Skeleton height={20} /></TableCell>
                    <TableCell><Skeleton height={20} /></TableCell>
                    <TableCell><Skeleton height={20} /></TableCell>
                    <TableCell><Skeleton height={20} /></TableCell>
                    <TableCell><Skeleton height={20} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      ) : filteredContacts.length === 0 ? (
        <Box px={3} py={4} textAlign="center">
          <PersonIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 2 }} />
          <Typography variant="h6" color="text.secondary" gutterBottom>
            {searchQuery ? 'No contacts match your search' : 'No Contacts Found'}
          </Typography>
          {searchQuery && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Try adjusting your search terms
            </Typography>
          )}
        </Box>
      ) : filteredContacts.length > 0 ? (
        <TableContainer 
          component={Paper} 
          variant="outlined"
          sx={{
            overflowX: 'auto',
            borderRadius: '8px',
            boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)'
          }}
        >
          <Table sx={{ minWidth: 1200 }}>
            <TableHead>
              <TableRow sx={{ backgroundColor: '#F9FAFB' }}>
                <TableCell sx={{
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  color: '#374151',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  borderBottom: '1px solid #E5E7EB',
                  py: 1.5
                }}>
                  Name
                </TableCell>
                <TableCell sx={{
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  color: '#374151',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  borderBottom: '1px solid #E5E7EB',
                  py: 1.5
                }}>
                  Title
                </TableCell>
                <TableCell sx={{
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  color: '#374151',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  borderBottom: '1px solid #E5E7EB',
                  py: 1.5
                }}>
                  Email
                </TableCell>
                <TableCell sx={{
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  color: '#374151',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  borderBottom: '1px solid #E5E7EB',
                  py: 1.5
                }}>
                  Phone
                </TableCell>
                <TableCell sx={{
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  color: '#374151',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  borderBottom: '1px solid #E5E7EB',
                  py: 1.5
                }}>
                  Location
                </TableCell>
                <TableCell sx={{
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  color: '#374151',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  borderBottom: '1px solid #E5E7EB',
                  py: 1.5
                }}>
                  LinkedIn
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredContacts.map((contact: any, index: number) => {
                const fullName = contact.fullName || contact.name || `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || 'Unnamed Contact';
                const avatarColor = getAvatarColor(fullName);
                return (
                  <TableRow 
                    key={contact.id}
                    onClick={() => navigate(`/recruiter/contacts/${contact.id}`)}
                    sx={{
                      height: '48px',
                      cursor: 'pointer',
                      '&:hover': {
                        backgroundColor: '#F9FAFB'
                      }
                    }}
                  >
                    <TableCell sx={{ py: 1, px: 2 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                          <Avatar
                            src={contact.avatar}
                            sx={{
                              width: 36,
                              height: 36,
                              fontWeight: 600,
                              fontSize: '0.875rem',
                              ...avatarColor
                            }}
                          >
                            {!contact.avatar && getInitials(fullName)}
                          </Avatar>
                          <Typography sx={{ variant: "body2", fontWeight: 600, color: "#111827", fontSize: '0.9375rem' }}>
                            {fullName}
                          </Typography>
                        </Box>
                      </TableCell>
                      <TableCell sx={{ py: 1 }}>
                        <Typography sx={{ variant: "body2", color: "#374151", fontSize: '0.875rem' }}>
                          {contact.jobTitle || contact.title || '-'}
                        </Typography>
                      </TableCell>
                      <TableCell sx={{ py: 1 }}>
                        <Typography sx={{ variant: "body2", color: "#374151", fontSize: '0.875rem' }}>
                          {contact.email || '-'}
                        </Typography>
                      </TableCell>
                      <TableCell sx={{ py: 1 }}>
                        <Typography sx={{ variant: "body2", color: "#374151", fontSize: '0.875rem' }}>
                          {contact.phone ? formatPhoneNumber(contact.phone) : '-'}
                        </Typography>
                      </TableCell>
                      <TableCell sx={{ py: 1 }}>
                        <Typography sx={{ variant: "body2", color: "#6B7280", fontSize: '0.875rem' }}>
                          {(() => {
                            if (contact.locationId) {
                              const location = locations.find(loc => loc.id === contact.locationId);
                              if (location) {
                                return location?.nickname || location?.name || 'Unknown Location';
                              }
                            }
                            return 'No location';
                          })()}
                        </Typography>
                      </TableCell>
                      <TableCell sx={{ py: 1 }}>
                        {(() => {
                          const linkedinUrl = contact.linkedinUrl || contact.linkedin || contact.linkedInUrl || contact.linkedIn;
                          if (linkedinUrl) {
                            return (
                              <IconButton
                                size="small"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  window.open(linkedinUrl, '_blank');
                                }}
                                color="primary"
                                title="Open LinkedIn Profile"
                                sx={{ fontSize: 16, color: '#0077B5' }}
                              >
                                <LinkedInIcon />
                              </IconButton>
                            );
                          } else {
                            return (
                              <Typography sx={{ variant: "body2", color: "#9CA3AF", fontSize: '0.875rem' }}>
                                -
                              </Typography>
                            );
                          }
                        })()}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        ) : null}

      {/* Add Contact Dialog */}
      <Dialog open={showAddContactDialog} onClose={() => setShowAddContactDialog(false)} maxWidth="md" fullWidth>
        <DialogTitle>
          <Box display="flex" alignItems="center" justifyContent="space-between">
            <Typography variant="h6">Add New Contact</Typography>
            <IconButton onClick={() => setShowAddContactDialog(false)} disabled={savingContact}>
              <CloseIcon />
            </IconButton>
          </Box>
        </DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 1 }}>
            {error && (
              <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
                {error}
              </Alert>
            )}
            <Grid container spacing={2} sx={{ mt: 1 }}>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  label="First Name"
                  value={contactForm.firstName}
                  onChange={(e) => handleContactFormChange('firstName', e.target.value)}
                  required
                  disabled={savingContact}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  label="Last Name"
                  value={contactForm.lastName}
                  onChange={(e) => handleContactFormChange('lastName', e.target.value)}
                  required
                  disabled={savingContact}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  label="Email"
                  type="email"
                  value={contactForm.email}
                  onChange={(e) => handleContactFormChange('email', e.target.value)}
                  disabled={savingContact}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  label="Phone"
                  value={contactForm.phone}
                  onChange={(e) => handleContactFormChange('phone', e.target.value)}
                  disabled={savingContact}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  label="Job Title"
                  value={contactForm.jobTitle}
                  onChange={(e) => handleContactFormChange('jobTitle', e.target.value)}
                  disabled={savingContact}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <FormControl fullWidth>
                  <InputLabel>Contact Type</InputLabel>
                  <Select
                    value={contactForm.contactType}
                    label="Contact Type"
                    onChange={(e) => handleContactFormChange('contactType', e.target.value)}
                    disabled={savingContact}
                  >
                    <MenuItem value="Decision Maker">Decision Maker</MenuItem>
                    <MenuItem value="Influencer">Influencer</MenuItem>
                    <MenuItem value="Gatekeeper">Gatekeeper</MenuItem>
                    <MenuItem value="Referrer">Referrer</MenuItem>
                    <MenuItem value="Evaluator">Evaluator</MenuItem>
                    <MenuItem value="Unknown">Unknown</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={6}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={contactForm.isActive}
                      onChange={(e) => handleContactFormChange('isActive', e.target.checked)}
                      color="primary"
                      disabled={savingContact}
                    />
                  }
                  label="Active Contact"
                />
              </Grid>
              <Grid item xs={12}>
                <Autocomplete
                  multiple
                  freeSolo
                  options={[]}
                  value={contactForm.tags}
                  onChange={(event, newValue) => handleTagsChange(newValue)}
                  disabled={savingContact}
                  renderTags={(value, getTagProps) =>
                    value.map((option, index) => (
                      <Chip
                        variant="outlined"
                        label={option}
                        {...getTagProps({ index })}
                        color="primary"
                      />
                    ))
                  }
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Tags"
                      placeholder="Add tags..."
                    />
                  )}
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Notes"
                  multiline
                  rows={3}
                  value={contactForm.notes}
                  onChange={(e) => handleContactFormChange('notes', e.target.value)}
                  disabled={savingContact}
                />
              </Grid>
              <Grid item xs={12}>
                <Alert severity="info">
                  <Typography variant="body2">
                    This contact will be automatically associated with <strong>{company.companyName || company.name}</strong>.
                  </Typography>
                </Alert>
              </Grid>
            </Grid>
          </Box>
        </DialogContent>
        <DialogActions sx={{ p: 3, pt: 0 }}>
          <Button 
            onClick={() => {
              setShowAddContactDialog(false);
              setContactForm({
                firstName: '',
                lastName: '',
                email: '',
                phone: '',
                jobTitle: '',
                contactType: 'Unknown',
                tags: [],
                isActive: true,
                notes: ''
              });
              setError(null);
            }}
            disabled={savingContact}
            variant="outlined"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSaveContact}
            variant="contained"
            disabled={savingContact || !contactForm.firstName || !contactForm.lastName}
            startIcon={savingContact ? <CircularProgress size={16} /> : <AddIcon />}
            size="large"
          >
            {savingContact ? 'Saving...' : 'Save Contact'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Success Snackbar */}
      <Snackbar
        open={success}
        autoHideDuration={6000}
        onClose={() => setSuccess(false)}
      >
        <Alert onClose={() => setSuccess(false)} severity="success">
          {successMessage}
        </Alert>
      </Snackbar>
    </Box>
  );
};

const OpportunitiesTab: React.FC<{ deals: any[]; company: any; locations: any[] }> = ({ deals, company, locations }) => {
  const navigate = useNavigate();
  const { tenantId } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // New opportunity dialog state
  const [showNewOpportunityDialog, setShowNewOpportunityDialog] = useState(false);
  const [newOpportunityForm, setNewOpportunityForm] = useState({
    name: '',
    divisionId: '',
    locationId: '',
  });
  const [companyDivisions, setCompanyDivisions] = useState<any[]>([]);
  const [companyLocations, setCompanyLocations] = useState<any[]>(locations);
  const [loadingDivisions, setLoadingDivisions] = useState(false);
  const [loadingLocations, setLoadingLocations] = useState(false);

  // Deal Age & Health Helper Functions
  const getDealAge = useCallback((createdAt: any) => {
    return calculateDealAge(createdAt);
  }, []);

  const getDealHealth = useCallback((deal: any) => {
    return calculateDealHealth(deal);
  }, []);

  const getDealStatus = useCallback((deal: any) => {
    const status = deal.status || 'open';
    
    const statusMap = {
      open: { label: 'Open', color: 'default', emoji: '⚪' },
      won: { label: 'Won', color: 'success', emoji: '🟢' },
      lost: { label: 'Lost', color: 'error', emoji: '🔴' },
      on_hold: { label: 'On Hold', color: 'warning', emoji: '⏸️' },
      canceled: { label: 'Canceled', color: 'error', emoji: '⚫' },
      dormant: { label: 'Dormant', color: 'default', emoji: '🟣' }
    };
    
    return statusMap[status as keyof typeof statusMap] || statusMap.open;
  }, []);
  
  // Calculate expected revenue range from qualification data
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
  
  // Load locations function
  const loadLocations = async () => {
    if (!company?.id || !tenantId) return;
    try {
      setLoading(true);
      const locationsRef = collection(db, 'tenants', tenantId, 'crm_companies', company.id, 'locations');
      const locationsSnap = await getDocs(locationsRef);
      const locationsData = locationsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setCompanyLocations(locationsData);
    } catch (err) {
      console.error('Error loading locations:', err);
      setError('Failed to load locations');
    } finally {
      setLoading(false);
    }
  };

  // Load locations if not provided
  useEffect(() => {
    if (locations.length === 0 && company?.id && tenantId) {
      loadLocations();
    } else {
      setCompanyLocations(locations);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locations, company?.id, tenantId]);

  // Load company divisions
  const loadCompanyDivisions = async (companyId: string) => {
    try {
      setLoadingDivisions(true);
      const getCompanyDivisions = httpsCallable(functions, 'getCompanyDivisions');
      const result = await getCompanyDivisions({ tenantId, companyId });
      const data = result.data as { divisions: any[] };
      setCompanyDivisions(data.divisions || []);
    } catch (err) {
      console.error('Error loading company divisions:', err);
      setCompanyDivisions([]);
    } finally {
      setLoadingDivisions(false);
    }
  };

  // Load company locations for the dialog
  const loadCompanyLocationsForDialog = async (companyId: string) => {
    try {
      setLoadingLocations(true);
      const locationsRef = collection(db, 'tenants', tenantId, 'crm_companies', companyId, 'locations');
      const locationsSnap = await getDocs(locationsRef);
      const locationsData = locationsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setCompanyLocations(locationsData);
    } catch (err) {
      console.error('Error loading company locations:', err);
      setCompanyLocations([]);
    } finally {
      setLoadingLocations(false);
    }
  };

  // Handle creating new opportunity
  const handleCreateNewOpportunity = async () => {
    if (!newOpportunityForm.name) {
      return;
    }

    try {
      setLoading(true);
      
      const opportunityData = {
        name: newOpportunityForm.name,
        companyId: company.id,
        stage: 'qualification',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        associations: {
          companies: [company.id],
          salespeople: [],
          divisions: newOpportunityForm.divisionId ? [newOpportunityForm.divisionId] : [],
          locations: newOpportunityForm.locationId ? [newOpportunityForm.locationId] : [],
        },
        ...(newOpportunityForm.divisionId && { divisionId: newOpportunityForm.divisionId }),
        ...(newOpportunityForm.locationId && { locationId: newOpportunityForm.locationId }),
      };

      const opportunitiesRef = collection(db, `tenants/${tenantId}/crm_deals`);
      const docRef = await addDoc(opportunitiesRef, opportunityData);

      setShowNewOpportunityDialog(false);
      setNewOpportunityForm({
        name: '',
        divisionId: '',
        locationId: '',
      });
      setCompanyDivisions([]);
      setCompanyLocations([]);

      navigate(`/recruiter/deals/${docRef.id}`);
    } catch (error) {
      console.error('Error creating new opportunity:', error);
      setError('Failed to create new opportunity');
    } finally {
      setLoading(false);
    }
  };
  
  return (
    <>
      <Box px={0} pb={3}>
        <Box display="flex" justifyContent="space-between" alignItems="center" sx={{ mb: 1, px: 3 }}>
          <Typography variant="h6" fontWeight={700}>Opportunities</Typography>
          <Button 
            variant="contained" 
            startIcon={<AddIcon />} 
            onClick={() => {
              setShowNewOpportunityDialog(true);
              loadCompanyDivisions(company.id);
              loadCompanyLocationsForDialog(company.id);
            }}
            sx={{
              height: 36,
              textTransform: 'none',
              fontWeight: 500,
              fontSize: '0.875rem',
              px: 2.5,
              py: 0.75
            }}
          >
            Add Opportunity
          </Button>
        </Box>
        
        {error && (
          <Alert severity="error" sx={{ mb: 2, mx: 3 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}
        
        {deals.length > 0 ? (
          <TableContainer 
            component={Paper} 
            variant="outlined"
            sx={{
              overflowX: 'auto',
              borderRadius: '8px',
              boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)'
            }}
          >
            <Table sx={{ minWidth: 1400 }}>
              <TableHead>
                <TableRow sx={{ backgroundColor: '#F9FAFB' }}>
                  <TableCell sx={{
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    color: '#374151',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    borderBottom: '1px solid #E5E7EB',
                    py: 1.5
                  }}>
                    Deal Name
                  </TableCell>
                    <TableCell sx={{
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      color: '#374151',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      borderBottom: '1px solid #E5E7EB',
                      py: 1.5
                    }}>
                      Stage
                    </TableCell>
                    <TableCell sx={{
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      color: '#374151',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      borderBottom: '1px solid #E5E7EB',
                      py: 1.5,
                      textAlign: 'right'
                    }}>
                      Value
                    </TableCell>
                    <TableCell sx={{
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      color: '#374151',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      borderBottom: '1px solid #E5E7EB',
                      py: 1.5
                    }}>
                      Age
                    </TableCell>
                    <TableCell sx={{
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      color: '#374151',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      borderBottom: '1px solid #E5E7EB',
                      py: 1.5
                    }}>
                      Status
                    </TableCell>
                    <TableCell sx={{
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      color: '#374151',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      borderBottom: '1px solid #E5E7EB',
                      py: 1.5
                    }}>
                      Health
                    </TableCell>
                    <TableCell sx={{
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      color: '#374151',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      borderBottom: '1px solid #E5E7EB',
                      py: 1.5
                    }}>
                      Location
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {deals.slice(0, 10).map((deal: any, index: number) => (
                    <TableRow 
                      key={deal.id}
                      onClick={() => navigate(`/recruiter/deals/${deal.id}`)}
                      sx={{
                        height: '48px',
                        cursor: 'pointer',
                        '&:hover': {
                          backgroundColor: '#F9FAFB'
                        }
                      }}
                    >
                      <TableCell sx={{ py: 1, px: 2 }}>
                        <Typography
                          sx={{ 
                            fontWeight: 600,
                            color: "#111827",
                            fontSize: '0.9375rem'
                          }}
                        >
                          {deal.name || deal.dealName || '-'}
                        </Typography>
                      </TableCell>
                      <TableCell sx={{ py: 1 }}>
                        <Chip 
                          label={deal.stage || 'Unknown Stage'} 
                          size="small" 
                          sx={{
                            backgroundColor: getStageHexColor(deal.stage || ''),
                            color: getTextContrastColor(getStageHexColor(deal.stage || '')),
                            fontWeight: 600,
                            fontSize: '0.75rem',
                            height: 24
                          }}
                        />
                      </TableCell>
                      <TableCell sx={{ py: 1, textAlign: 'right' }}>
                        <Typography sx={{
                          variant: "body2",
                          fontWeight: 500,
                          color: "#374151",
                          fontSize: '0.8125rem'
                        }}>
                          {(() => {
                            const revenueRange = calculateExpectedRevenueRange(deal);
                            if (revenueRange.hasData) {
                              return `$${revenueRange.min.toLocaleString()} - $${revenueRange.max.toLocaleString()}`;
                            }
                            return deal.estimatedRevenue ? `$${deal.estimatedRevenue.toLocaleString()}` : '-';
                          })()}
                        </Typography>
                      </TableCell>
                      <TableCell sx={{ py: 1 }}>
                        {(() => {
                          const age = getDealAge(deal?.createdAt);
                          if (!age) return <Typography variant="body2" color="#6B7280">-</Typography>;
                          
                          return (
                            <DealAgeChip 
                              ageDays={age.days} 
                              createdAt={age.date}
                              showEmoji={true}
                              variant="compact"
                            />
                          );
                        })()}
                      </TableCell>
                      <TableCell sx={{ py: 1 }}>
                        {(() => {
                          const status = getDealStatus(deal);
                          return (
                            <Chip
                              label={status.label}
                              size="small"
                              sx={{
                                bgcolor: status.color === 'success' ? 'success.light' : 
                                        status.color === 'warning' ? 'warning.light' : 
                                        status.color === 'error' ? 'error.light' : 'default.light',
                                color: status.color === 'success' ? 'success.dark' : 
                                       status.color === 'warning' ? 'warning.dark' : 
                                       status.color === 'error' ? 'error.dark' : 'default.dark',
                                fontWeight: 500,
                                fontSize: '0.75rem'
                              }}
                              icon={<span style={{ fontSize: '0.75rem' }}>{status.emoji}</span>}
                            />
                          );
                        })()}
                      </TableCell>
                      <TableCell sx={{ py: 1 }}>
                        {(() => {
                          const health = getDealHealth(deal);
                          
                          return (
                            <HealthBadge 
                              bucket={health.bucket as any}
                              score={health.score}
                              reasons={health.reasons}
                              showScore={false}
                              variant="compact"
                            />
                          );
                        })()}
                      </TableCell>
                      <TableCell sx={{ py: 1 }}>
                        <Typography sx={{
                          variant: "body2",
                          color: "#6B7280",
                          fontSize: '0.875rem'
                        }}>
                          {(() => {
                            const locs = (deal.associations?.locations || []) as any[];
                            const first = locs.find(l => typeof l === 'object') || locs[0];
                            const locationId = typeof first === 'string' ? first : (first?.id || '');
                            
                            if (locationId) {
                              const location = companyLocations.find(loc => loc.id === locationId);
                              if (location) {
                                const locationName = location?.nickname || location?.name || 'Unknown Location';
                                const locationCode = location.code ? ` [${location.code}]` : '';
                                return `${locationName}${locationCode}`;
                              }
                            }
                            return 'No location';
                          })()}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
        ) : (
          <Box sx={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            py: 8,
            textAlign: 'center',
            px: 3
          }}>
            <Box sx={{
              width: 120,
              height: 120,
              borderRadius: '50%',
              backgroundColor: '#F3F4F6',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              mb: 3
            }}>
              <DealIcon sx={{ fontSize: 48, color: '#9CA3AF' }} />
            </Box>
            <Typography sx={{
              variant: "h6",
              fontWeight: 600,
              color: '#111827',
              mb: 1
            }}>
              No opportunities found
            </Typography>
            <Typography sx={{
              variant: "body2",
              color: "#6B7280",
              mb: 3
            }}>
              No opportunities are associated with this company yet.
            </Typography>
          </Box>
        )}
        
        {deals.length > 10 && (
          <Box sx={{ mt: 2, textAlign: 'center', px: 3 }}>
            <Typography sx={{
              variant: "body2",
              color: "#9CA3AF",
              fontSize: '0.875rem'
            }}>
              +{deals.length - 10} more opportunities
            </Typography>
          </Box>
        )}
      </Box>

      {/* New Opportunity Dialog */}
      <Dialog open={showNewOpportunityDialog} onClose={() => setShowNewOpportunityDialog(false)} maxWidth="md" fullWidth>
        <DialogTitle>
          <Box display="flex" alignItems="center" justifyContent="space-between">
            <Typography variant="h6">Create New Opportunity</Typography>
            <IconButton onClick={() => setShowNewOpportunityDialog(false)} disabled={loading}>
              <CloseIcon />
            </IconButton>
          </Box>
        </DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Opportunity Name"
                value={newOpportunityForm.name}
                onChange={(e) => setNewOpportunityForm(prev => ({ ...prev, name: e.target.value }))}
                required
                placeholder="e.g., New Staffing Contract"
              />
            </Grid>
            <Grid item xs={12}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                Company: {company.companyName || company.name}
              </Typography>
            </Grid>
            <Grid item xs={12} sm={6}>
              <FormControl fullWidth>
                <InputLabel>Division (Optional)</InputLabel>
                <Select
                  value={newOpportunityForm.divisionId}
                  onChange={(e) => setNewOpportunityForm(prev => ({ ...prev, divisionId: e.target.value }))}
                  label="Division (Optional)"
                  disabled={loadingDivisions}
                >
                  <MenuItem value="">
                    <em>No division</em>
                  </MenuItem>
                  {companyDivisions.map((division) => (
                    <MenuItem key={division.id} value={division.id}>
                      {division.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={6}>
              <FormControl fullWidth>
                <InputLabel>Location (Optional)</InputLabel>
                <Select
                  value={newOpportunityForm.locationId}
                  onChange={(e) => setNewOpportunityForm(prev => ({ ...prev, locationId: e.target.value }))}
                  label="Location (Optional)"
                  disabled={loadingLocations}
                >
                  <MenuItem value="">
                    <em>No location</em>
                  </MenuItem>
                  {companyLocations.map((location) => (
                    <MenuItem key={location.id} value={location.id}>
                      {location.name}{location.code ? ` [${location.code}]` : ''}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions sx={{ p: 3, pt: 0 }}>
          <Button onClick={() => setShowNewOpportunityDialog(false)} disabled={loading} variant="outlined">
            Cancel
          </Button>
          <Button 
            onClick={handleCreateNewOpportunity} 
            variant="contained"
            disabled={!newOpportunityForm.name || loading}
            startIcon={loading ? <CircularProgress size={16} /> : <AddIcon />}
          >
            {loading ? 'Creating...' : 'Create Opportunity'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

const NotesTab: React.FC<{ company: any; tenantId: string }> = ({ company, tenantId }) => {
  return (
    <CRMNotesTab
      entityId={company.id}
      entityType="company"
      entityName={company.companyName || company.name || 'Unnamed Company'}
      tenantId={tenantId}
    />
  );
};

const JobOrdersTab: React.FC<{ jobOrders: any[]; routePrefix: 'crm' | 'recruiter' }> = ({ jobOrders, routePrefix }) => {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState<string>('createdAt');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  const formatJobOrderNumber = (number: string | number) => {
    if (typeof number === 'string') return number;
    return number.toString().padStart(4, '0');
  };

  const getJobOrderAge = (createdAt: any) => {
    if (!createdAt) return null;
    const date = createdAt?.toDate ? createdAt.toDate() : new Date(createdAt);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - date.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  const getStatusColor = (status: string) => {
    const statusLower = (status || '').toLowerCase();
    if (statusLower.includes('open') || statusLower === 'active') return 'success';
    if (statusLower.includes('hold') || statusLower === 'on_hold') return 'warning';
    if (statusLower.includes('filled') || statusLower === 'completed') return 'info';
    if (statusLower.includes('cancel')) return 'error';
    return 'default';
  };

  const filteredAndSortedJobOrders = React.useMemo(() => {
    let filtered = jobOrders;

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter((jobOrder: any) => {
        const jobOrderName = (jobOrder.jobOrderName || '').toLowerCase();
        const jobTitle = (jobOrder.jobTitle || '').toLowerCase();
        const jobOrderNumber = formatJobOrderNumber(jobOrder.jobOrderNumber || '').toLowerCase();
        const status = (jobOrder.status || '').toLowerCase();
        const companyName = (jobOrder.companyName || jobOrder.deal?.companyName || '').toLowerCase();
        return jobOrderName.includes(query) || 
               jobTitle.includes(query) || 
               jobOrderNumber.includes(query) ||
               status.includes(query) ||
               companyName.includes(query);
      });
    }

    // Sort
    filtered.sort((a: any, b: any) => {
      let aVal: any;
      let bVal: any;

      if (sortField === 'createdAt') {
        aVal = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt || 0);
        bVal = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt || 0);
      } else if (sortField === 'jobOrderNumber') {
        aVal = formatJobOrderNumber(a.jobOrderNumber || '');
        bVal = formatJobOrderNumber(b.jobOrderNumber || '');
      } else if (sortField === 'status') {
        aVal = (a.status || '').toLowerCase();
        bVal = (b.status || '').toLowerCase();
      } else {
        aVal = a[sortField] || '';
        bVal = b[sortField] || '';
      }

      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    return filtered;
  }, [jobOrders, searchQuery, sortField, sortDirection]);

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  return (
    <Box sx={{ p: 0 }}>
      {/* Header with Search */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 0, mb: 1, py: 0, px: 3, gap: 2 }}>
        <Typography variant="h6" fontWeight={700}>
          Job Orders {jobOrders.length > 0 && `(${jobOrders.length})`}
        </Typography>
        <TextField
          size="small"
          variant="outlined"
          placeholder="Search by order #, title, status..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" sx={{ color: 'text.secondary' }} />
              </InputAdornment>
            ),
            endAdornment: searchQuery && (
              <InputAdornment position="end">
                <IconButton
                  size="small"
                  onClick={() => setSearchQuery('')}
                  sx={{ p: 0.5 }}
                >
                  <ClearIcon fontSize="small" />
                </IconButton>
              </InputAdornment>
            )
          }}
          sx={{ 
            width: 280,
            height: 36,
            '& .MuiOutlinedInput-root': {
              height: 36,
              borderRadius: '6px',
              backgroundColor: 'white',
              fontSize: '0.875rem',
              '& fieldset': {
                borderColor: '#E5E7EB',
              },
              '&:hover fieldset': {
                borderColor: '#D1D5DB',
              },
              '&.Mui-focused fieldset': {
                borderColor: '#3B82F6',
              },
            },
          }}
        />
      </Box>

      {filteredAndSortedJobOrders.length === 0 ? (
        <Box sx={{ textAlign: 'center', py: 8, px: 3 }}>
          {searchQuery ? (
            <>
              <WorkIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
              <Typography variant="h6" color="text.secondary" gutterBottom>
                No job orders found
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Try adjusting your search criteria
              </Typography>
            </>
          ) : (
            <>
              <WorkIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
              <Typography variant="h6" color="text.secondary" gutterBottom>
                No job orders yet
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                Job orders associated with this company will appear here
              </Typography>
            </>
          )}
        </Box>
      ) : (
        <TableContainer 
          component={Paper} 
          variant="outlined"
          sx={{
            overflowX: 'auto',
            borderRadius: '8px',
            boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)'
          }}
        >
          <Table sx={{ minWidth: 1200 }}>
            <TableHead>
              <TableRow sx={{ backgroundColor: '#F9FAFB' }}>
                <TableCell sx={{
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  color: '#374151',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  borderBottom: '1px solid #E5E7EB',
                  py: 1.5,
                  cursor: 'pointer'
                }} onClick={() => handleSort('jobOrderNumber')}>
                  Order #
                </TableCell>
                <TableCell sx={{
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  color: '#374151',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  borderBottom: '1px solid #E5E7EB',
                  py: 1.5,
                  cursor: 'pointer'
                }} onClick={() => handleSort('jobOrderName')}>
                  Title
                </TableCell>
                <TableCell sx={{
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  color: '#374151',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  borderBottom: '1px solid #E5E7EB',
                  py: 1.5
                }}>
                  Job Title
                </TableCell>
                <TableCell sx={{
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  color: '#374151',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  borderBottom: '1px solid #E5E7EB',
                  py: 1.5,
                  cursor: 'pointer'
                }} onClick={() => handleSort('status')}>
                  Status
                </TableCell>
                <TableCell sx={{
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  color: '#374151',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  borderBottom: '1px solid #E5E7EB',
                  py: 1.5
                }}>
                  Workers
                </TableCell>
                <TableCell sx={{
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  color: '#374151',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  borderBottom: '1px solid #E5E7EB',
                  py: 1.5,
                  cursor: 'pointer'
                }} onClick={() => handleSort('createdAt')}>
                  Created
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredAndSortedJobOrders.map((jobOrder: any, index: number) => {
                const age = getJobOrderAge(jobOrder.createdAt);
                return (
                  <TableRow 
                    key={jobOrder.id}
                    onClick={() => navigate(`/${routePrefix}/job-orders/${jobOrder.id}`)}
                    sx={{
                      height: '48px',
                      cursor: 'pointer',
                      '&:hover': {
                        backgroundColor: '#F9FAFB'
                      }
                    }}
                  >
                    <TableCell sx={{ py: 1, px: 2 }}>
                      <Typography sx={{ variant: "body2", fontWeight: 600, color: "#111827", fontSize: '0.9375rem' }}>
                        {formatJobOrderNumber(jobOrder.jobOrderNumber || jobOrder.jobOrderSeq || '')}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ py: 1 }}>
                      <Typography sx={{ variant: "body2", fontWeight: 500, color: "#111827", fontSize: '0.875rem' }}>
                        {jobOrder.jobOrderName || 'Unnamed Job Order'}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ py: 1 }}>
                      <Typography sx={{ variant: "body2", color: "#374151", fontSize: '0.875rem' }}>
                        {jobOrder.jobTitle || '-'}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ py: 1 }}>
                      <Chip
                        label={jobOrder.status || 'Unknown'}
                        size="small"
                        color={getStatusColor(jobOrder.status) as any}
                        sx={{ fontSize: '0.75rem', fontWeight: 500 }}
                      />
                    </TableCell>
                    <TableCell sx={{ py: 1 }}>
                      <Typography sx={{ variant: "body2", color: "#374151", fontSize: '0.875rem' }}>
                        {jobOrder.workersNeeded || jobOrder.headcountRequested || 0} / {jobOrder.headcountFilled || 0}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ py: 1 }}>
                      <Typography sx={{ variant: "body2", color: "#6B7280", fontSize: '0.875rem' }}>
                        {age !== null ? `${age} day${age !== 1 ? 's' : ''} ago` : '-'}
                      </Typography>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
};

const IndeedJobsTab: React.FC<{ 
  company: any; 
  jobPostings: any[]; 
  setJobPostings: (postings: any[]) => void;
  jobsLoading: boolean;
  setJobsLoading: (loading: boolean) => void;
}> = ({ company, jobPostings, setJobPostings, jobsLoading, setJobsLoading }) => {
  return (
    <Card>
      <CardHeader title="Job Postings" />
      <CardContent>
        {jobsLoading ? (
          <CircularProgress />
        ) : jobPostings.length === 0 ? (
          <Typography variant="body1" color="text.secondary">
            No job postings found for this company.
          </Typography>
        ) : (
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Job Title</TableCell>
                  <TableCell>Location</TableCell>
                  <TableCell>Pay Rate</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Posted</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {jobPostings.map((job) => (
                  <TableRow key={job.id}>
                    <TableCell>{job.jobTitle || job.postTitle || '-'}</TableCell>
                    <TableCell>
                      {job.city && job.state ? `${job.city}, ${job.state}` : job.worksiteName || '-'}
                    </TableCell>
                    <TableCell>${job.payRate || 0}/hr</TableCell>
                    <TableCell>
                      <Chip 
                        label={job.status || 'Unknown'} 
                        size="small"
                        color={job.status === 'active' ? 'success' : 'default'}
                      />
                    </TableCell>
                    <TableCell>
                      {job.createdAt?.toDate?.()?.toLocaleDateString() || '-'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </CardContent>
    </Card>
  );
};

export default RecruiterCompanyDetails;

// Defaults Tab - store company-level default Rules and Billing settings
const DefaultsTab: React.FC<{
  company: any;
  tenantId: string;
  onSaved?: () => void;
}> = ({ company, tenantId, onSaved }) => {
  const [saving, setSaving] = useState(false);
  
  const initialRules = {
    replacingExistingAgency: !!company?.defaults?.rules?.replacingExistingAgency,
    rolloverExistingStaff: !!company?.defaults?.rules?.rolloverExistingStaff,
    timeclockSystem: company?.defaults?.rules?.timeclockSystem || '',
    attendancePolicy: company?.defaults?.rules?.attendancePolicy || '',
    noShowPolicy: company?.defaults?.rules?.noShowPolicy || '',
    overtimePolicy: company?.defaults?.rules?.overtimePolicy || '',
    callOffPolicy: company?.defaults?.rules?.callOffPolicy || '',
    injuryHandlingPolicy: company?.defaults?.rules?.injuryHandlingPolicy || '',
    disciplinePolicy: company?.defaults?.rules?.disciplinePolicy || '',
  };
  const initialBilling = {
    poRequired: !!company?.defaults?.billing?.poRequired,
    paymentTerms: company?.defaults?.billing?.paymentTerms || '',
    invoiceDeliveryMethod: company?.defaults?.billing?.invoiceDeliveryMethod || '',
    invoiceFrequency: company?.defaults?.billing?.invoiceFrequency || '',
  };
  const initialEVerify = {
    eVerifyRequired: !!company?.defaults?.eVerify?.eVerifyRequired,
  };
  
  const [rules, setRules] = useState(initialRules);
  const [billing, setBilling] = useState(initialBilling);
  const [eVerify, setEVerify] = useState(initialEVerify);
  
  const handleSave = async () => {
    if (!tenantId || !company?.id) return;
    try {
      setSaving(true);
      const refDoc = doc(db, 'tenants', tenantId, 'crm_companies', company.id);
      await setDoc(refDoc, {
        defaults: {
          rules: { ...rules },
          eVerify: { ...eVerify },
          billing: { ...billing },
        },
        updatedAt: serverTimestamp(),
      }, { merge: true });
      onSaved?.();
    } catch (e) {
      console.error('Failed to save Defaults:', e);
    } finally {
      setSaving(false);
    }
  };
  
  return (
    <Grid container spacing={3}>
      <Grid item xs={12} md={7}>
        <Card>
          <CardHeader title="Customer Rules & Policies (Defaults)" />
          <CardContent>
            <Grid container spacing={2}>
              <Grid item xs={12} md={6}>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={rules.replacingExistingAgency}
                      onChange={(e) => setRules({ ...rules, replacingExistingAgency: e.target.checked })}
                    />
                  }
                  label="Replacing Existing Agency"
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={rules.rolloverExistingStaff}
                      onChange={(e) => setRules({ ...rules, rolloverExistingStaff: e.target.checked })}
                    />
                  }
                  label="Rollover Existing Staff"
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Timeclock System"
                  value={rules.timeclockSystem}
                  onChange={(e) => setRules({ ...rules, timeclockSystem: e.target.value })}
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Attendance Policy"
                  value={rules.attendancePolicy}
                  onChange={(e) => setRules({ ...rules, attendancePolicy: e.target.value })}
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="No-Show Policy"
                  value={rules.noShowPolicy}
                  onChange={(e) => setRules({ ...rules, noShowPolicy: e.target.value })}
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Overtime Policy"
                  value={rules.overtimePolicy}
                  onChange={(e) => setRules({ ...rules, overtimePolicy: e.target.value })}
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Call-Off Policy"
                  value={rules.callOffPolicy}
                  onChange={(e) => setRules({ ...rules, callOffPolicy: e.target.value })}
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Injury Handling Policy"
                  value={rules.injuryHandlingPolicy}
                  onChange={(e) => setRules({ ...rules, injuryHandlingPolicy: e.target.value })}
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Discipline Policy"
                  value={rules.disciplinePolicy}
                  onChange={(e) => setRules({ ...rules, disciplinePolicy: e.target.value })}
                />
              </Grid>
            </Grid>
          </CardContent>
        </Card>
      </Grid>
      
      <Grid item xs={12} md={5}>
        <Card sx={{ mb: 3 }}>
          <CardHeader title="E-Verify (Defaults)" />
          <CardContent>
            <Grid container spacing={2}>
              <Grid item xs={12}>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={eVerify.eVerifyRequired}
                      onChange={(e) => setEVerify({ ...eVerify, eVerifyRequired: e.target.checked })}
                    />
                  }
                  label="E-Verify Required"
                />
              </Grid>
            </Grid>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader title="Billing & Invoicing (Defaults)" />
          <CardContent>
            <Grid container spacing={2}>
              <Grid item xs={12}>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={billing.poRequired}
                      onChange={(e) => setBilling({ ...billing, poRequired: e.target.checked })}
                    />
                  }
                  label="PO Required"
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Payment Terms"
                  value={billing.paymentTerms}
                  onChange={(e) => setBilling({ ...billing, paymentTerms: e.target.value })}
                  placeholder="e.g., Net 30"
                />
              </Grid>
              <Grid item xs={12}>
                <FormControl fullWidth>
                  <InputLabel>Invoice Delivery Method</InputLabel>
                  <Select
                    value={billing.invoiceDeliveryMethod}
                    label="Invoice Delivery Method"
                    onChange={(e) => setBilling({ ...billing, invoiceDeliveryMethod: e.target.value as string })}
                  >
                    <MenuItem value="">—</MenuItem>
                    <MenuItem value="email">Email</MenuItem>
                    <MenuItem value="portal">Portal</MenuItem>
                    <MenuItem value="mail">Mail</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12}>
                <FormControl fullWidth>
                  <InputLabel>Invoice Frequency</InputLabel>
                  <Select
                    value={billing.invoiceFrequency}
                    label="Invoice Frequency"
                    onChange={(e) => setBilling({ ...billing, invoiceFrequency: e.target.value as string })}
                  >
                    <MenuItem value="">—</MenuItem>
                    <MenuItem value="weekly">Weekly</MenuItem>
                    <MenuItem value="biweekly">Bi-weekly</MenuItem>
                    <MenuItem value="monthly">Monthly</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
            </Grid>
          </CardContent>
        </Card>
      </Grid>
      
      <Grid item xs={12}>
        <Box sx={{ display: 'flex', gap: 2, mt: 1 }}>
          <Button variant="contained" startIcon={<SaveIcon />} onClick={handleSave} disabled={saving}>
            {saving ? <CircularProgress size={20} /> : 'Save Defaults'}
          </Button>
        </Box>
      </Grid>
    </Grid>
  );
};
