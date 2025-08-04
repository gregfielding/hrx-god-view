import React, { useEffect, useState } from 'react';
import {
  Box,
  Typography,
  TextField,
  Button,
  Grid,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Snackbar,
  Alert,
  MenuItem,
  FormControl,
  InputLabel,
  Select,
  OutlinedInput,
  Chip,
  Autocomplete,
  Checkbox,
  Tooltip,
  Tabs,
  Tab,
  ToggleButton,
  ToggleButtonGroup,
  TableSortLabel,
  Card,
  CardContent,
  CardHeader,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  Divider,
  Badge,
  Avatar,
  Switch,
  FormControlLabel,
  CircularProgress,
  InputAdornment,
} from '@mui/material';
import {
  collection,
  addDoc,
  getDocs,
  query,
  where,
  serverTimestamp,
  doc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  orderBy,
  limit,
  startAfter,
  getDoc,
} from 'firebase/firestore';
import { db } from '../../firebase';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import CRMImportDialog from '../../components/CRMImportDialog';
import DealIntelligenceWizard from '../../components/DealIntelligenceWizard';
import KPIManagement from '../../components/KPIManagement';
import KPIDashboard from '../../components/KPIDashboard';
import NationalAccountManager from '../../components/NationalAccountManager';
import EnhancedContactManager from '../../components/EnhancedContactManager';
import CompanyHierarchyManager from '../../components/CompanyHierarchyManager';
import GmailSettings from '../../components/GmailSettings';
import StageChip from '../../components/StageChip';
import { TasksDashboard } from '../../components/TasksDashboard';
import {
  Person as PersonIcon,
  Business as BusinessIcon,
  AttachMoney as DealIcon,
  People as PeopleIcon,
  Group as GroupIcon,
  AccountTree,
  Timeline as PipelineIcon,
  Assessment as ReportsIcon,
  Settings as SettingsIcon,
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Search as SearchIcon,
  FilterList as FilterIcon,
  MoreVert as MoreIcon,
  Phone as PhoneIcon,
  Email as EmailIcon,
  LocationOn as LocationIcon,
  Work as WorkIcon,
  TrendingUp as TrendingUpIcon,
  CalendarToday as CalendarIcon,
  Star as StarIcon,
  Visibility as VisibilityIcon,
  Assignment as TaskIcon,
  CheckCircle as CompletedIcon,
  Schedule as PendingIcon,
  PriorityHigh as HighPriorityIcon,
  FiberManualRecord as MediumPriorityIcon,
  RadioButtonUnchecked as LowPriorityIcon,
  Assessment as AssessmentIcon,
  Clear as ClearIcon,
  LinkedIn as LinkedInIcon,

} from '@mui/icons-material';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase';

const TenantCRM: React.FC = () => {
  const { tenantId, role, accessRole, orgType, currentUser, activeTenant } = useAuth();
  const navigate = useNavigate();
  
  // State for tabs
  const [searchParams] = useSearchParams();
  const [tabValue, setTabValue] = useState(() => {
    const tabParam = searchParams.get('tab');
    if (tabParam === 'companies') return 2;
    if (tabParam === 'contacts') return 1;
    if (tabParam === 'deals') return 3;
    if (tabParam === 'tasks') return 0;
    return 0;
  });
  
  // State for data
  const [contacts, setContacts] = useState<any[]>([]);
  const [companies, setCompanies] = useState<any[]>([]);
  const [deals, setDeals] = useState<any[]>([]);
  const [pipelineStages, setPipelineStages] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  
  // Pagination state for companies
  const [companiesLoading, setCompaniesLoading] = useState(false);
  const [companiesLastDoc, setCompaniesLastDoc] = useState<any>(null);
  const [companiesHasMore, setCompaniesHasMore] = useState(true);
  const [companiesPageSize] = useState(20);
  const [companyFilter, setCompanyFilter] = useState<'all' | 'my'>('all');
  const [contactFilter, setContactFilter] = useState<'all' | 'my'>('all');
  const [dealFilter, setDealFilter] = useState<'all' | 'my'>('all');
  
  // Pagination state for contacts
  const [contactsLoading, setContactsLoading] = useState(false);
  const [contactsLastDoc, setContactsLastDoc] = useState<any>(null);
  const [contactsHasMore, setContactsHasMore] = useState(true);
  const [contactsPageSize] = useState(20);
  
  // State for forms and UI
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [search, setSearch] = useState('');
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [dialogType, setDialogType] = useState<'contact' | 'company' | 'deal' | 'task'>('contact');
  
  // State for filters
  const [filters, setFilters] = useState({
    status: 'all',
    owner: 'all',
    industry: 'all',
    stage: 'all',
  });

  // Contact form state
  const [contactForm, setContactForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    jobTitle: '',
    companyId: '',
    companyName: '',
    linkedinUrl: '',
    leadSource: '',
    contactType: 'Unknown',
    tags: [] as string[],
    isActive: true,
    notes: ''
  });
  const [savingContact, setSavingContact] = useState(false);
  const [allCompanies, setAllCompanies] = useState<any[]>([]);
  const [loadingAllCompanies, setLoadingAllCompanies] = useState(false);
  const [salesTeam, setSalesTeam] = useState<any[]>([]);
  const [salesTeamLoading, setSalesTeamLoading] = useState(false);
  const [fixingAllAssociations, setFixingAllAssociations] = useState(false);

  // Load companies with pagination
  const loadCompanies = async (searchQuery = '', startDoc: any = null, append = false, filterByUser = false) => {
    if (!tenantId) return;
    
    setCompaniesLoading(true);
    try {
      const companiesRef = collection(db, 'tenants', tenantId, 'crm_companies');
      const constraints: any[] = [orderBy('createdAt', 'desc'), limit(companiesPageSize)];

      // If filtering by user associations, add user-specific constraints
      if (filterByUser && currentUser?.uid) {
        console.log('Loading companies where user is in salespeople array:', currentUser.uid);
        
        // Query companies where user is in salespeople array in associations map
        const salespeopleAssociationsQuery = query(
          companiesRef,
          where('associations.salespeople', 'array-contains', currentUser.uid),
          orderBy('createdAt', 'desc'),
          limit(companiesPageSize)
        );
        
        try {
          const salespeopleAssociationsSnapshot = await getDocs(salespeopleAssociationsQuery);
          
          const companiesData = salespeopleAssociationsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          console.log('Found', companiesData.length, 'companies where user is in salespeople array');
          
          setCompanies(prev => append ? [...prev, ...companiesData] : companiesData);
          setCompaniesHasMore(companiesData.length === companiesPageSize);
          setCompaniesLastDoc(companiesData[companiesData.length - 1]);
          
        } catch (error) {
          console.error('Error loading companies with salespeople associations:', error);
          // Fallback to loading all companies if query fails
          const q = query(companiesRef, orderBy('createdAt', 'desc'), limit(companiesPageSize));
          const snapshot = await getDocs(q);
          const companiesData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          setCompanies(prev => append ? [...prev, ...companiesData] : companiesData);
          setCompaniesHasMore(snapshot.docs.length === companiesPageSize);
          setCompaniesLastDoc(snapshot.docs[snapshot.docs.length - 1]);
        }
        
        setCompaniesLoading(false);
        return;
      }

      if (searchQuery.trim()) {
        // For search queries, fetch ALL companies and filter client-side
        // Firestore can handle large datasets efficiently
        const searchLower = searchQuery.toLowerCase();
        console.log('Searching for:', searchLower);
        
        // Query ALL companies without limit for comprehensive search
        const q = query(
          companiesRef,
          orderBy('createdAt', 'desc')
        );
        
        const snapshot = await getDocs(q);
        console.log('Found', snapshot.size, 'companies in database (searching through ALL companies)');
        
        if (!snapshot.empty) {
          const companiesData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as any[];
          console.log('Companies data sample:', companiesData.slice(0, 5).map((c: any) => ({ 
            id: c.id, 
            name: c.companyName || c.name, 
            url: c.companyUrl || c.url, 
            city: c.city,
            industry: c.industry
          })));
          
          // Filter client-side for substring matching
          const filteredData = companiesData.filter((company: any) => {
            const companyName = (company.companyName || company.name || '').toLowerCase();
            const companyUrl = (company.companyUrl || company.url || '').toLowerCase();
            const city = (company.city || '').toLowerCase();
            const industry = (company.industry || '').toLowerCase();
            
            // Debug: Only log if it might be a match
            if ((company.companyName || company.name || '').toLowerCase().includes(searchLower)) {
              console.log('Potential match:', {
                id: company.id,
                companyName: company.companyName || company.name,
                searchLower: searchLower
              });
            }
            
            const matches = companyName.includes(searchLower) ||
                           companyUrl.includes(searchLower) ||
                           city.includes(searchLower) ||
                           industry.includes(searchLower);
            
            if (matches) {
              console.log('✅ Match found:', { 
                id: company.id,
                name: company.companyName || company.name, 
                url: company.companyUrl || company.url, 
                city: company.city, 
                industry: company.industry 
              });
            }
            
            return matches;
          });
          
          console.log('Filtered to', filteredData.length, 'companies');
          
          // Sort by relevance (exact matches first, then prefix matches, then substring matches)
          filteredData.sort((a: any, b: any) => {
            const aName = (a.companyName || a.name || '').toLowerCase();
            const bName = (b.companyName || b.name || '').toLowerCase();
            
            // Exact match gets highest priority
            if (aName === searchLower && bName !== searchLower) return -1;
            if (bName === searchLower && aName !== searchLower) return 1;
            
            // Prefix match gets second priority
            if (aName.startsWith(searchLower) && !bName.startsWith(searchLower)) return -1;
            if (bName.startsWith(searchLower) && !aName.startsWith(searchLower)) return 1;
            
            // Then sort by creation date
            const aDate = a.createdAt?.toDate?.() || a.createdAt || new Date(0);
            const bDate = b.createdAt?.toDate?.() || b.createdAt || new Date(0);
            return bDate.getTime() - aDate.getTime();
          });
          
          const limitedData = filteredData.slice(0, companiesPageSize);
          
          setCompanies(prev => append ? [...prev, ...limitedData] : limitedData);
          // For search results, we don't have a proper lastDoc since we're using merged data
          // Set hasMore based on whether we found all results
          setCompaniesHasMore(filteredData.length > companiesPageSize);
        } else {
          if (!append) {
            setCompanies([]);
          }
          setCompaniesHasMore(false);
        }
        
      } else {
        // No search query - use normal pagination
        if (startDoc) {
          constraints.push(startAfter(startDoc));
        }

        const q = query(companiesRef, ...constraints);
        const snapshot = await getDocs(q);

        if (!snapshot.empty) {
          const companiesData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as any[];
          
          setCompanies(prev => append ? [...prev, ...companiesData] : companiesData);
          setCompaniesLastDoc(snapshot.docs[snapshot.docs.length - 1]);
          setCompaniesHasMore(snapshot.size === companiesPageSize);
        } else {
          if (!append) {
            setCompanies([]);
          }
          setCompaniesHasMore(false);
        }
      }
    } catch (error) {
      console.error('Error fetching companies:', error);
      // Fallback to simple search if compound query fails
      try {
        const companiesRef = collection(db, 'tenants', tenantId, 'crm_companies');
        const constraints: any[] = [orderBy('createdAt', 'desc'), limit(companiesPageSize)];
        
        if (startDoc) {
          constraints.push(startAfter(startDoc));
        }

        const q = query(companiesRef, ...constraints);
        const snapshot = await getDocs(q);

        if (!snapshot.empty) {
          const companiesData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as any[];
          
          // Filter client-side for search
          let filteredData = companiesData;
          if (searchQuery.trim()) {
            const searchLower = searchQuery.toLowerCase();
            filteredData = companiesData.filter((company: any) => {
              const companyName = (company.companyName || company.name || '').toLowerCase();
              const companyUrl = (company.companyUrl || company.url || '').toLowerCase();
              const city = (company.city || '').toLowerCase();
              const industry = (company.industry || '').toLowerCase();
              
              return companyName.includes(searchLower) ||
                     companyUrl.includes(searchLower) ||
                     city.includes(searchLower) ||
                     industry.includes(searchLower);
            });
          }
          
          setCompanies(prev => append ? [...prev, ...filteredData] : filteredData);
          setCompaniesLastDoc(snapshot.docs[snapshot.docs.length - 1]);
          setCompaniesHasMore(snapshot.size === companiesPageSize);
        } else {
          if (!append) {
            setCompanies([]);
          }
          setCompaniesHasMore(false);
        }
      } catch (fallbackError) {
        console.error('Fallback search also failed:', fallbackError);
        setCompanies([]);
        setCompaniesHasMore(false);
      }
    } finally {
      setCompaniesLoading(false);
    }
  };

  const loadMoreCompanies = () => {
    if (companiesHasMore && !companiesLoading) {
      loadCompanies(search, companiesLastDoc, true);
    }
  };

  // Load all companies for autocomplete (no pagination)
  const loadAllCompanies = async () => {
    if (!tenantId) return;
    
    setLoadingAllCompanies(true);
    try {
      const companiesRef = collection(db, 'tenants', tenantId, 'crm_companies');
      const q = query(companiesRef, orderBy('companyName', 'asc'));
      const snapshot = await getDocs(q);
      const companiesData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setAllCompanies(companiesData);
      console.log('Loaded', companiesData.length, 'companies for autocomplete');
    } catch (error) {
      console.error('Error loading all companies:', error);
      setAllCompanies([]);
    } finally {
      setLoadingAllCompanies(false);
    }
  };

  // Load sales team (workforce with crm_sales true)
  const loadSalesTeam = async () => {
    if (!tenantId) return;
    
    setSalesTeamLoading(true);
    try {
      // First, let's check if there are any workforce members at all
      const workforceRef = collection(db, 'tenants', tenantId, 'workforce');
      const allWorkforceSnapshot = await getDocs(workforceRef);
      console.log(`🔍 Total workforce members in tenant ${tenantId}: ${allWorkforceSnapshot.docs.length}`);
      
      if (allWorkforceSnapshot.docs.length > 0) {
        console.log('🔍 Sample workforce member data:', allWorkforceSnapshot.docs[0].data());
      }
      
      // Use Firebase Function to get salespeople with proper tenant filtering
      const getSalespeople = httpsCallable(functions, 'getSalespeople');
      
      const params = { 
        tenantId,
        activeTenantId: activeTenant?.id || tenantId
      };
      
      console.log('🔍 Calling getSalespeople with params:', params);
      console.log('🔍 activeTenant:', activeTenant);
      
      const result = await getSalespeople(params);
      const data = result.data as { salespeople: any[] };
      setSalesTeam(data.salespeople || []);
      console.log('✅ Loaded', data.salespeople?.length || 0, 'sales team members');
      
    } catch (error: any) {
      console.error('❌ Error loading sales team:', error);
      setSalesTeam([]);
    } finally {
      setSalesTeamLoading(false);
    }
  };

  // Load contacts with pagination
  const loadContacts = async (searchQuery = '', startDoc: any = null, append = false, filterByUser = false) => {
    if (!tenantId) return;
    
    setContactsLoading(true);
    try {
      const contactsRef = collection(db, 'tenants', tenantId, 'crm_contacts');
      const constraints: any[] = [orderBy('createdAt', 'desc'), limit(contactsPageSize)];

      // If filtering by user associations, show contacts from "My Companies"
      if (filterByUser && currentUser?.uid) {
        console.log('Loading contacts from companies where user is in salespeople array:', currentUser.uid);
        
        // First, get all companies where user is in salespeople array
        const companiesRef = collection(db, 'tenants', tenantId, 'crm_companies');
        const myCompaniesQuery = query(
          companiesRef,
          where('associations.salespeople', 'array-contains', currentUser.uid)
        );
        
        const myCompaniesSnapshot = await getDocs(myCompaniesQuery);
        const myCompanyIds = myCompaniesSnapshot.docs.map(doc => doc.id);
        
        console.log(`Found ${myCompanyIds.length} companies where user is in salespeople array`);
        
        if (myCompanyIds.length === 0) {
          // No companies found, set empty contacts
          setContacts(prev => append ? [...prev, ...[]] : []);
          setContactsLastDoc(null);
          setContactsHasMore(false);
          setContactsLoading(false);
          return;
        }
        
        // Then, get contacts that belong to these companies
        const contactsQuery = query(
          contactsRef,
          where('companyId', 'in', myCompanyIds),
          orderBy('createdAt', 'desc'),
          limit(contactsPageSize)
        );
        
        try {
          const snapshot = await getDocs(contactsQuery);
          const contactsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          
          console.log('Found', contactsData.length, 'contacts from user\'s companies');
          
          setContacts(prev => append ? [...prev, ...contactsData] : contactsData);
          setContactsHasMore(snapshot.docs.length === contactsPageSize);
          setContactsLastDoc(snapshot.docs[snapshot.docs.length - 1]);
          
        } catch (error) {
          console.error('Error loading contacts from user\'s companies:', error);
          // Fallback to loading all contacts if query fails
          const q = query(contactsRef, orderBy('createdAt', 'desc'), limit(contactsPageSize));
          const snapshot = await getDocs(q);
          const contactsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          setContacts(prev => append ? [...prev, ...contactsData] : contactsData);
          setContactsHasMore(snapshot.docs.length === contactsPageSize);
          setContactsLastDoc(snapshot.docs[snapshot.docs.length - 1]);
        }
        
        setContactsLoading(false);
        return;
      }

      if (searchQuery.trim()) {
        // For search queries, fetch ALL contacts and filter client-side
        // Firestore can handle large datasets efficiently
        const searchLower = searchQuery.toLowerCase();
        console.log('Searching contacts for:', searchLower);
        
        // Query ALL contacts without limit for comprehensive search
        const q = query(
          contactsRef,
          orderBy('createdAt', 'desc')
        );
        
        const snapshot = await getDocs(q);
        console.log('Found', snapshot.size, 'contacts in database (searching through ALL contacts)');
        
        if (!snapshot.empty) {
          const contactsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as any[];
          console.log('Contacts data sample:', contactsData.slice(0, 5).map((c: any) => ({ 
            id: c.id, 
            name: c.fullName || c.name, 
            email: c.email,
            title: c.title || c.jobTitle
          })));
          
          // Filter client-side for substring matching
          const filteredData = contactsData.filter((contact: any) => {
            const fullName = (contact.fullName || contact.name || '').toLowerCase();
            const email = (contact.email || '').toLowerCase();
            const title = (contact.title || contact.jobTitle || '').toLowerCase();
            const phone = (contact.phone || '').toLowerCase();
            
            // Debug: Only log if it might be a match
            if (fullName.includes(searchLower)) {
              console.log('Potential contact match:', {
                id: contact.id,
                fullName: contact.fullName || contact.name,
                searchLower: searchLower
              });
            }
            
            const matches = fullName.includes(searchLower) ||
                           email.includes(searchLower) ||
                           title.includes(searchLower) ||
                           phone.includes(searchLower);
            
            if (matches) {
              console.log('✅ Contact match found:', { 
                id: contact.id,
                name: contact.fullName || contact.name, 
                email: contact.email, 
                title: contact.title || contact.jobTitle
              });
            }
            
            return matches;
          });
          
          console.log('Filtered to', filteredData.length, 'contacts');
          
          // Sort by relevance (exact matches first, then prefix matches, then substring matches)
          filteredData.sort((a: any, b: any) => {
            const aName = (a.fullName || a.name || '').toLowerCase();
            const bName = (b.fullName || b.name || '').toLowerCase();
            
            // Exact match gets highest priority
            if (aName === searchLower && bName !== searchLower) return -1;
            if (bName === searchLower && aName !== searchLower) return 1;
            
            // Prefix match gets second priority
            if (aName.startsWith(searchLower) && !bName.startsWith(searchLower)) return -1;
            if (bName.startsWith(searchLower) && !aName.startsWith(searchLower)) return 1;
            
            // Then sort by creation date
            const aDate = a.createdAt?.toDate?.() || a.createdAt || new Date(0);
            const bDate = b.createdAt?.toDate?.() || b.createdAt || new Date(0);
            return bDate.getTime() - aDate.getTime();
          });
          
          const limitedData = filteredData.slice(0, contactsPageSize);
          
          setContacts(prev => append ? [...prev, ...limitedData] : limitedData);
          // For search results, we don't have a proper lastDoc since we're using merged data
          // Set hasMore based on whether we found all results
          setContactsHasMore(filteredData.length > contactsPageSize);
        } else {
          if (!append) {
            setContacts([]);
          }
          setContactsHasMore(false);
        }
        
      } else {
        // No search query - use normal pagination
        if (startDoc) {
          constraints.push(startAfter(startDoc));
        }

        const q = query(contactsRef, ...constraints);
        const snapshot = await getDocs(q);

        if (!snapshot.empty) {
          const contactsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as any[];
          
          setContacts(prev => append ? [...prev, ...contactsData] : contactsData);
          setContactsLastDoc(snapshot.docs[snapshot.docs.length - 1]);
          setContactsHasMore(snapshot.size === contactsPageSize);
        } else {
          if (!append) {
            setContacts([]);
          }
          setContactsHasMore(false);
        }
      }
    } catch (error) {
      console.error('Error fetching contacts:', error);
      setContacts([]);
      setContactsHasMore(false);
    } finally {
      setContactsLoading(false);
    }
  };

  const loadMoreContacts = () => {
    if (contactsHasMore && !contactsLoading) {
      loadContacts(search, contactsLastDoc, true);
    }
  };

  const loadDeals = async (searchQuery = '', startDoc: any = null, append = false, filterByUser = false) => {
    if (!tenantId) return;
    
    try {
      const dealsRef = collection(db, 'tenants', tenantId, 'crm_deals');
      
      // If filtering by user associations, add user-specific constraints
      if (filterByUser && currentUser?.uid) {
        console.log('Loading deals associated with user via salespeople array:', currentUser.uid);
        
        // Query deals where user is in the salespeople array in associations map
        const salespeopleAssociationsQuery = query(
          dealsRef,
          where('associations.salespeople', 'array-contains', currentUser.uid),
          orderBy('createdAt', 'desc')
        );
        
        try {
          const snapshot = await getDocs(salespeopleAssociationsQuery);
          const dealsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          
          console.log('Found', dealsData.length, 'deals associated with user via salespeople array');
          
          setDeals(prev => append ? [...prev, ...dealsData] : dealsData);
          
        } catch (error) {
          console.error('Error loading user-associated deals:', error);
          // Fallback to loading all deals if query fails
          const q = query(dealsRef, orderBy('createdAt', 'desc'));
          const snapshot = await getDocs(q);
          const dealsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          setDeals(prev => append ? [...prev, ...dealsData] : dealsData);
        }
        
        return;
      }

      // For non-filtered or search queries, use the existing onSnapshot approach
      // This maintains real-time updates for the main deals list
      const q = query(dealsRef, orderBy('createdAt', 'desc'));
      const snapshot = await getDocs(q);
      const dealsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setDeals(prev => append ? [...prev, ...dealsData] : dealsData);
      
    } catch (error) {
      console.error('Error loading deals:', error);
    }
  };

  // Handle search changes
  const handleSearchChange = (newSearch: string) => {
    setSearch(newSearch);
    // Reset pagination when search changes
    setCompaniesLastDoc(null);
    setCompaniesHasMore(true);
    setContactsLastDoc(null);
    setContactsHasMore(true);
  };

  // Debounced search effect
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      loadCompanies(search);
      loadContacts(search);
    }, 300);
    
    return () => clearTimeout(timeoutId);
  }, [search, tenantId]);

  // Real-time listeners for CRM data
  useEffect(() => {
    console.log('TenantCRM Debug:', { tenantId, role, accessRole, orgType });
    
    if (!tenantId) {
      console.log('No tenantId, skipping CRM data fetch');
      return;
    }

    if (tenantId) {
      loadCompanies();
      loadContacts();
      loadDeals();
      loadAllCompanies(); // Load all companies for autocomplete
      loadSalesTeam(); // Load sales team
    }

    // Listen for deals
    const dealsRef = collection(db, 'tenants', tenantId, 'crm_deals');
    const dealsUnsubscribe = onSnapshot(dealsRef, (snapshot) => {
      const dealsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setDeals(dealsData);
    });

    // Listen for pipeline stages
    const stagesRef = collection(db, 'tenants', tenantId, 'crm_pipeline_stages');
    const stagesUnsubscribe = onSnapshot(stagesRef, (snapshot) => {
      const stagesData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));
      setPipelineStages(stagesData.sort((a: any, b: any) => (a.order || 0) - (b.order || 0)));
    });

    // Listen for tasks
    const tasksRef = collection(db, 'tenants', tenantId, 'crm_tasks');
    const tasksUnsubscribe = onSnapshot(tasksRef, (snapshot) => {
      const tasksData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setTasks(tasksData);
    });

    return () => {
      dealsUnsubscribe();
      stagesUnsubscribe();
      tasksUnsubscribe();
    };
  }, [tenantId]);

  const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
  };

  const handleAddNew = (type: 'contact' | 'company' | 'deal' | 'task') => {
    setDialogType(type);
    setShowAddDialog(true);
  };

  const handleCompanyFilterChange = (newFilter: 'all' | 'my') => {
    setCompanyFilter(newFilter);
    // Reload companies with the new filter
    loadCompanies('', null, false, newFilter === 'my');
  };

  const handleContactFilterChange = (newFilter: 'all' | 'my') => {
    setContactFilter(newFilter);
    // Reload contacts with the new filter
    loadContacts('', null, false, newFilter === 'my');
  };

  const handleDealFilterChange = (newFilter: 'all' | 'my') => {
    setDealFilter(newFilter);
    // Reload deals with the new filter
    loadDeals('', null, false, newFilter === 'my');
  };



  const handleCloseDialog = () => {
    setShowAddDialog(false);
  };

  const handleContactFormChange = (field: string, value: string | boolean | string[]) => {
    setContactForm(prev => ({ ...prev, [field]: value }));
  };

  const handleTagsChange = (newTags: string[]) => {
    setContactForm(prev => ({ ...prev, tags: newTags }));
  };

  const handleFixAllAssociations = async () => {
    if (!tenantId) return;
    
    setFixingAllAssociations(true);
    try {
      const fixContactAssociations = httpsCallable(functions, 'fixContactAssociations');
      
      const result = await fixContactAssociations({
        tenantId
      });

      const resultData = result.data as any;
      
      if (resultData.success) {
        setSuccess(true);
        setSuccessMessage(`Fixed ${resultData.fixedCount} contact associations!`);
        
        // Reload contacts to show updated associations
        loadContacts();
      } else {
        setError(resultData.message || 'Failed to fix associations');
      }
    } catch (err: any) {
      console.error('Error fixing associations:', err);
      setError(err.message || 'Failed to fix associations');
    } finally {
      setFixingAllAssociations(false);
    }
  };

  const handleSaveContact = async () => {
    if (!contactForm.firstName || !contactForm.lastName) {
      setError('First name and last name are required');
      return;
    }

    setSavingContact(true);
    try {
      const contactData = {
        ...contactForm,
        fullName: `${contactForm.firstName} ${contactForm.lastName}`,
        tenantId,
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
        companyId: '',
        companyName: '',
        linkedinUrl: '',
        leadSource: '',
        contactType: 'Unknown',
        tags: [],
        isActive: true,
        notes: ''
      });
      setShowAddDialog(false);
      setSuccess(true);
      setSuccessMessage('Contact added successfully!');
      
      // Reload contacts
      loadContacts();
    } catch (err: any) {
      console.error('Error adding contact:', err);
      setError(err.message || 'Failed to add contact');
    } finally {
      setSavingContact(false);
    }
  };

  if (!tenantId) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <Typography variant="h6" color="error">
          No tenant ID found. Please log in as a tenant user.
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
        <Typography variant="h3" gutterBottom>
          Sales CRM
        </Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button
            variant="outlined"
            color="secondary"
            onClick={handleFixAllAssociations}
            disabled={fixingAllAssociations}
          >
            {fixingAllAssociations ? 'Fixing...' : 'Fix Contact Associations'}
          </Button>
          {/* <Button
            variant="outlined"
            color="primary"
            onClick={() => setShowImportDialog(true)}
          >
            Import Freshsales Data
          </Button>
          <Button
            variant="contained"
            color="primary"
            startIcon={<AddIcon />}
            onClick={() => handleAddNew('contact')}
          >
            Add New
          </Button> */}
        </Box>
      </Box>

      {/* Tabs Navigation */}
      <Paper elevation={1} sx={{ mb: 3, borderRadius: 0 }}>
        <Tabs
          value={tabValue}
          onChange={handleTabChange}
          indicatorColor="primary"
          textColor="primary"
          variant="scrollable"
          scrollButtons="auto"
          aria-label="CRM management tabs"
        >
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
                <PersonIcon fontSize="small" />
                Contacts
              </Box>
            } 
          />
          <Tab 
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <BusinessIcon fontSize="small" />
                Companies
              </Box>
            } 
          />
          <Tab 
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <DealIcon fontSize="small" />
                Opportunities
              </Box>
            } 
          />
          <Tab 
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <GroupIcon fontSize="small" />
                Sales Team
              </Box>
            } 
          />
          <Tab 
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <PipelineIcon fontSize="small" />
                Pipeline
              </Box>
            } 
          />
          {/* <Tab 
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <BusinessIcon fontSize="small" />
                National Accounts
              </Box>
            } 
          />
          <Tab 
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <PeopleIcon fontSize="small" />
                Enhanced Contacts
              </Box>
            } 
          />
          <Tab 
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <BusinessIcon fontSize="small" />
                Company Hierarchy
              </Box>
            } 
          />
          <Tab 
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <ReportsIcon fontSize="small" />
                Reports
              </Box>
            } 
          /> */}
          <Tab 
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <SettingsIcon fontSize="small" />
                Settings
              </Box>
            } 
          />
          <Tab 
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <AssessmentIcon fontSize="small" />
                KPIs
              </Box>
            } 
          />
          <Tab 
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <TrendingUpIcon fontSize="small" />
                My KPIs
              </Box>
            } 
          />
        </Tabs>
      </Paper>

      {/* Tab Panels */}
      {tabValue === 0 && (
        <TasksDashboard 
          salespersonId={currentUser?.uid || ''} 
          tenantId={tenantId}
        />
      )}
      
      {tabValue === 1 && (
        <ContactsTab 
          contacts={contacts}
          companies={companies}
          search={search}
          onSearchChange={setSearch}
          onAddNew={() => handleAddNew('contact')}
          loading={contactsLoading}
          hasMore={contactsHasMore}
          onLoadMore={loadMoreContacts}
          contactFilter={contactFilter}
          onContactFilterChange={handleContactFilterChange}
        />
      )}
      
      {tabValue === 2 && (
        <CompaniesTab 
          companies={companies}
          contacts={contacts}
          deals={deals}
          search={search}
          onSearchChange={handleSearchChange}
          onAddNew={() => handleAddNew('company')}
          loading={companiesLoading}
          hasMore={companiesHasMore}
          onLoadMore={loadMoreCompanies}
          companyFilter={companyFilter}
          onCompanyFilterChange={handleCompanyFilterChange}
        />
      )}
      
      {tabValue === 3 && (
        <DealsTab 
          deals={deals}
          companies={companies}
          contacts={contacts}
          pipelineStages={pipelineStages}
          search={search}
          onSearchChange={setSearch}
          onAddNew={() => handleAddNew('deal')}
          dealFilter={dealFilter}
          onDealFilterChange={handleDealFilterChange}
        />
      )}
      
      {tabValue === 4 && (
        <SalesTeamTab 
          salesTeam={salesTeam}
          search={search}
          onSearchChange={setSearch}
          loading={salesTeamLoading}
          tenantId={tenantId}
        />
      )}
      
      {tabValue === 5 && (
        <PipelineTab 
          deals={deals}
          companies={companies}
          pipelineStages={pipelineStages}
          filters={filters}
          onFiltersChange={setFilters}
        />
      )}
      
      {tabValue === 10 && (
        <NationalAccountManager tenantId={tenantId} />
      )}
      
      {tabValue === 7 && (
        <EnhancedContactManager tenantId={tenantId} />
      )}
      
      {tabValue === 8 && (
        <CompanyHierarchyManager tenantId={tenantId} />
      )}
      
      {tabValue === 9 && (
        <ReportsTab 
          deals={deals}
          companies={companies}
          contacts={contacts}
        />
      )}
      
      {tabValue === 6 && (
        <SettingsTab 
          pipelineStages={pipelineStages}
          tenantId={tenantId}
        />
      )}
      
      {/* {tabValue === 8 && (
        <SettingsTab 
          pipelineStages={pipelineStages}
          tenantId={tenantId}
        />
      )} */}
      
      {tabValue === 7 && (
        <KPIManagement tenantId={tenantId} />
      )}
      
      {tabValue === 8 && (
        <KPIDashboard tenantId={tenantId} salespersonId={currentUser?.uid || ''} />
      )}

      {/* Snackbars */}
      <Snackbar open={!!error} autoHideDuration={4000} onClose={() => setError('')}>
        <Alert severity="error" onClose={() => setError('')} sx={{ width: '100%' }}>
          {error}
        </Alert>
      </Snackbar>
      <Snackbar open={success} autoHideDuration={2000} onClose={() => setSuccess(false)}>
        <Alert severity="success" sx={{ width: '100%' }}>
          {successMessage}
        </Alert>
      </Snackbar>

      {/* Import Dialog */}
      <CRMImportDialog
        open={showImportDialog}
        onClose={() => setShowImportDialog(false)}
        onSuccess={() => {
          setSuccess(true);
          setShowImportDialog(false);
        }}
      />

      {/* Add Contact Dialog */}
      <Dialog open={showAddDialog && dialogType === 'contact'} onClose={handleCloseDialog} maxWidth="md" fullWidth>
        <DialogTitle>Add New Contact</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="First Name"
                value={contactForm.firstName}
                onChange={(e) => handleContactFormChange('firstName', e.target.value)}
                required
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Last Name"
                value={contactForm.lastName}
                onChange={(e) => handleContactFormChange('lastName', e.target.value)}
                required
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Email"
                type="email"
                value={contactForm.email}
                onChange={(e) => handleContactFormChange('email', e.target.value)}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Phone"
                value={contactForm.phone}
                onChange={(e) => handleContactFormChange('phone', e.target.value)}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Job Title"
                value={contactForm.jobTitle}
                onChange={(e) => handleContactFormChange('jobTitle', e.target.value)}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <FormControl fullWidth>
                <InputLabel>Contact Type</InputLabel>
                <Select
                  value={contactForm.contactType}
                  label="Contact Type"
                  onChange={(e) => handleContactFormChange('contactType', e.target.value)}
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
                    placeholder="Add tags (e.g., Hospitality, Seasonal Hiring, Not price sensitive)"
                    helperText="Press Enter to add a new tag"
                  />
                )}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <Autocomplete
                options={allCompanies}
                getOptionLabel={(option) => option.companyName || option.name || ''}
                value={allCompanies.find(c => c.id === contactForm.companyId) || null}
                onChange={(event, newValue) => {
                  handleContactFormChange('companyId', newValue?.id || '');
                  handleContactFormChange('companyName', newValue?.companyName || newValue?.name || '');
                }}
                loading={loadingAllCompanies}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Company"
                    placeholder="Search companies..."
                    InputProps={{
                      ...params.InputProps,
                      endAdornment: (
                        <>
                          {loadingAllCompanies ? <CircularProgress color="inherit" size={20} /> : null}
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
                    </Box>
                  </Box>
                )}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <FormControl fullWidth>
                <InputLabel>Lead Source</InputLabel>
                <Select
                  value={contactForm.leadSource}
                  label="Lead Source"
                  onChange={(e) => handleContactFormChange('leadSource', e.target.value)}
                >
                  <MenuItem value="">None</MenuItem>
                  <MenuItem value="website">Website</MenuItem>
                  <MenuItem value="referral">Referral</MenuItem>
                  <MenuItem value="cold_call">Cold Call</MenuItem>
                  <MenuItem value="email">Email</MenuItem>
                  <MenuItem value="social_media">Social Media</MenuItem>
                  <MenuItem value="trade_show">Trade Show</MenuItem>
                  <MenuItem value="other">Other</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="LinkedIn URL"
                value={contactForm.linkedinUrl}
                onChange={(e) => handleContactFormChange('linkedinUrl', e.target.value)}
                placeholder="https://linkedin.com/in/..."
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
                placeholder="Additional notes about this contact..."
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDialog} disabled={savingContact}>
            Cancel
          </Button>
          <Button 
            onClick={handleSaveContact} 
            variant="contained" 
            disabled={savingContact || !contactForm.firstName || !contactForm.lastName}
          >
            {savingContact ? <CircularProgress size={20} /> : 'Save Contact'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

// Sales Team Tab Component
const SalesTeamTab: React.FC<{
  salesTeam: any[];
  search: string;
  onSearchChange: (value: string) => void;
  loading: boolean;
  tenantId: string;
}> = ({ salesTeam, search, onSearchChange, loading, tenantId }) => {
  const navigate = useNavigate();

  const filteredSalesTeam = salesTeam.filter(member => {
    if (!search) return true;
    const searchLower = search.toLowerCase();
    return (
      member.firstName?.toLowerCase().includes(searchLower) ||
      member.lastName?.toLowerCase().includes(searchLower) ||
      member.email?.toLowerCase().includes(searchLower) ||
      member.jobTitle?.toLowerCase().includes(searchLower) ||
      member.department?.toLowerCase().includes(searchLower)
    );
  });

  const handleViewMember = (memberId: string) => {
    navigate(`/tenant/salesperson/${memberId}`);
  };

  const getMemberAvatar = (member: any) => {
    if (member.profilePicture) {
      return member.profilePicture;
    }
    const initials = `${member.firstName?.[0] || ''}${member.lastName?.[0] || ''}`.toUpperCase();
    return initials;
  };

  const getMemberStatus = (member: any) => {
    if (member.status === 'active') return 'Active';
    if (member.status === 'inactive') return 'Inactive';
    if (member.status === 'on_leave') return 'On Leave';
    return 'Unknown';
  };

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Typography variant="h5" gutterBottom>
          Sales Team ({filteredSalesTeam.length})
        </Typography>
        <Box sx={{ display: 'flex', gap: 2 }}>
          <TextField
            size="small"
            placeholder="Search sales team..."
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon />
                </InputAdornment>
              ),
            }}
            sx={{ minWidth: 300 }}
          />
        </Box>
      </Box>

      {/* Sales Team Table */}
      <Card>
        <CardContent sx={{ p: 0 }}>
          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
              <CircularProgress />
            </Box>
          ) : filteredSalesTeam.length === 0 ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
              <Box textAlign="center">
                <Typography variant="body1" color="text.secondary" gutterBottom>
                  {search ? 'No sales team members found matching your search.' : 'No sales team members found.'}
                </Typography>
                {!search && (
                  <Typography variant="body2" color="text.secondary">
                    To add salespeople to the Sales Team, update workforce members with <code>crm_sales: true</code> in their profile.
                  </Typography>
                )}
              </Box>
            </Box>
          ) : (
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Member</TableCell>
                    <TableCell>Email</TableCell>
                    <TableCell>Job Title</TableCell>
                    <TableCell>Department</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {filteredSalesTeam.map((member) => (
                    <TableRow key={member.id} hover>
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                          <Avatar sx={{ bgcolor: 'primary.main' }}>
                            {getMemberAvatar(member)}
                          </Avatar>
                          <Box>
                            <Typography variant="body2" fontWeight="medium">
                              {member.firstName} {member.lastName}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {member.employeeId || 'No ID'}
                            </Typography>
                          </Box>
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">
                          {member.email || 'No email'}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">
                          {member.jobTitle || 'No title'}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">
                          {member.department || 'No department'}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={getMemberStatus(member)}
                          color={member.status === 'active' ? 'success' : 'default'}
                          size="small"
                        />
                      </TableCell>
                      <TableCell>
                        <IconButton
                          size="small"
                          onClick={() => handleViewMember(member.id)}
                          title="View Details"
                        >
                          <VisibilityIcon fontSize="small" />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </CardContent>
      </Card>
    </Box>
  );
};

// Tasks Tab Component
const TasksTab: React.FC<{
  tasks: any[];
  contacts: any[];
  companies: any[];
  deals: any[];
  search: string;
  onSearchChange: (value: string) => void;
  onAddNew: () => void;
  tenantId: string;
}> = ({ tasks, contacts, companies, deals, search, onSearchChange, onAddNew, tenantId }) => {
  const [selectedTasks, setSelectedTasks] = useState<string[]>([]);
  const [showTaskDialog, setShowTaskDialog] = useState(false);
  const [editingTask, setEditingTask] = useState<any>(null);
  const [taskForm, setTaskForm] = useState({
    title: '',
    description: '',
    priority: 'medium',
    status: 'pending',
    dueDate: '',
    assignedTo: '',
    relatedTo: {
      type: '',
      id: ''
    },
    tags: [] as string[],
  });

  const filteredTasks = tasks.filter(task =>
    task.title?.toLowerCase().includes(search.toLowerCase()) ||
    task.description?.toLowerCase().includes(search.toLowerCase()) ||
    task.status?.toLowerCase().includes(search.toLowerCase())
  );

  const handleTaskSelection = (taskId: string) => {
    setSelectedTasks(prev =>
      prev.includes(taskId) 
        ? prev.filter(id => id !== taskId) 
        : [...prev, taskId]
    );
  };

  const handleEditTask = (task: any) => {
    setEditingTask(task);
    setTaskForm({
      title: task.title || '',
      description: task.description || '',
      priority: task.priority || 'medium',
      status: task.status || 'pending',
      dueDate: task.dueDate || '',
      assignedTo: task.assignedTo || '',
      relatedTo: task.relatedTo || { type: '', id: '' },
      tags: task.tags || [],
    });
    setShowTaskDialog(true);
  };

  const handleSaveTask = async () => {
    try {
      const taskData = {
        ...taskForm,
        updatedAt: serverTimestamp(),
      };

      if (editingTask) {
        await updateDoc(doc(db, 'tenants', tenantId, 'crm_tasks', editingTask.id), taskData);
      } else {
        await addDoc(collection(db, 'tenants', tenantId, 'crm_tasks'), {
          ...taskData,
          createdAt: serverTimestamp(),
        });
      }

      setShowTaskDialog(false);
      setEditingTask(null);
      setTaskForm({
        title: '',
        description: '',
        priority: 'medium',
        status: 'pending',
        dueDate: '',
        assignedTo: '',
        relatedTo: { type: '', id: '' },
        tags: [],
      });
    } catch (error) {
      console.error('Error saving task:', error);
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    if (window.confirm('Are you sure you want to delete this task?')) {
      try {
        await deleteDoc(doc(db, 'tenants', tenantId, 'crm_tasks', taskId));
      } catch (error) {
        console.error('Error deleting task:', error);
      }
    }
  };

  const getPriorityIcon = (priority: string) => {
    switch (priority) {
      case 'high':
        return <HighPriorityIcon color="error" fontSize="small" />;
      case 'medium':
        return <MediumPriorityIcon color="warning" fontSize="small" />;
      case 'low':
        return <LowPriorityIcon color="success" fontSize="small" />;
      default:
        return <MediumPriorityIcon color="warning" fontSize="small" />;
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CompletedIcon color="success" fontSize="small" />;
      case 'pending':
        return <PendingIcon color="warning" fontSize="small" />;
      default:
        return <PendingIcon color="warning" fontSize="small" />;
    }
  };

  const getRelatedEntityName = (relatedTo: any) => {
    if (!relatedTo || !relatedTo.type || !relatedTo.id) return '';
    
    switch (relatedTo.type) {
      case 'contact':
        const contact = contacts.find(c => c.id === relatedTo.id);
        return contact?.fullName || '';
      case 'company':
        const company = companies.find(c => c.id === relatedTo.id);
        return company?.companyName || '';
      case 'deal':
        const deal = deals.find(d => d.id === relatedTo.id);
        return deal?.title || '';
      default:
        return '';
    }
  };

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Typography variant="h6">
          Tasks ({filteredTasks.length})
        </Typography>
        <Button
          variant="contained"
          color="primary"
          startIcon={<AddIcon />}
          onClick={onAddNew}
        >
          Add Task
        </Button>
      </Box>

      {/* Search and Filters */}
      <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
        <TextField
          size="small"
          placeholder="Search tasks..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          InputProps={{
            startAdornment: <SearchIcon sx={{ mr: 1, color: 'text.secondary' }} />,
            endAdornment: search && (
              <IconButton
                size="small"
                onClick={() => onSearchChange('')}
                sx={{ mr: 1 }}
              >
                <ClearIcon fontSize="small" />
              </IconButton>
            ),
          }}
          sx={{ minWidth: 300 }}
        />
      </Box>

      {/* Tasks Table */}
      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell padding="checkbox">
                <Checkbox
                  checked={selectedTasks.length === filteredTasks.length && filteredTasks.length > 0}
                  indeterminate={selectedTasks.length > 0 && selectedTasks.length < filteredTasks.length}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelectedTasks(filteredTasks.map(task => task.id));
                    } else {
                      setSelectedTasks([]);
                    }
                  }}
                />
              </TableCell>
              <TableCell>Task</TableCell>
              <TableCell>Priority</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Due Date</TableCell>
              <TableCell>Assigned To</TableCell>
              <TableCell>Related To</TableCell>
              <TableCell>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filteredTasks.map((task) => (
              <TableRow key={task.id} hover>
                <TableCell padding="checkbox">
                  <Checkbox
                    checked={selectedTasks.includes(task.id)}
                    onChange={() => handleTaskSelection(task.id)}
                  />
                </TableCell>
                <TableCell>
                  <Box>
                    <Typography variant="body2" fontWeight="medium">
                      {task.title}
                    </Typography>
                    {task.description && (
                      <Typography variant="caption" color="text.secondary">
                        {task.description.substring(0, 50)}...
                      </Typography>
                    )}
                  </Box>
                </TableCell>
                <TableCell>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    {getPriorityIcon(task.priority)}
                    <Typography variant="body2" sx={{ textTransform: 'capitalize' }}>
                      {task.priority}
                    </Typography>
                  </Box>
                </TableCell>
                <TableCell>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    {getStatusIcon(task.status)}
                    <Typography variant="body2" sx={{ textTransform: 'capitalize' }}>
                      {task.status}
                    </Typography>
                  </Box>
                </TableCell>
                <TableCell>
                  {task.dueDate ? (
                    <Typography variant="body2">
                      {new Date(task.dueDate).toLocaleDateString()}
                    </Typography>
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      No due date
                    </Typography>
                  )}
                </TableCell>
                <TableCell>
                  <Typography variant="body2">
                    {task.assignedTo || 'Unassigned'}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="body2">
                    {getRelatedEntityName(task.relatedTo)}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Box sx={{ display: 'flex', gap: 1 }}>
                    <IconButton size="small" onClick={() => handleEditTask(task)}>
                      <EditIcon fontSize="small" />
                    </IconButton>
                    <IconButton size="small" onClick={() => handleDeleteTask(task.id)}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Box>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Task Dialog */}
      <Dialog open={showTaskDialog} onClose={() => setShowTaskDialog(false)} maxWidth="md" fullWidth>
        <DialogTitle>
          {editingTask ? 'Edit Task' : 'Add New Task'}
        </DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Task Title"
                value={taskForm.title}
                onChange={(e) => setTaskForm({ ...taskForm, title: e.target.value })}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                multiline
                rows={3}
                label="Description"
                value={taskForm.description}
                onChange={(e) => setTaskForm({ ...taskForm, description: e.target.value })}
              />
            </Grid>
            <Grid item xs={6}>
              <FormControl fullWidth>
                <InputLabel>Priority</InputLabel>
                <Select
                  value={taskForm.priority}
                  onChange={(e) => setTaskForm({ ...taskForm, priority: e.target.value })}
                  label="Priority"
                >
                  <MenuItem value="low">Low</MenuItem>
                  <MenuItem value="medium">Medium</MenuItem>
                  <MenuItem value="high">High</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={6}>
              <FormControl fullWidth>
                <InputLabel>Status</InputLabel>
                <Select
                  value={taskForm.status}
                  onChange={(e) => setTaskForm({ ...taskForm, status: e.target.value })}
                  label="Status"
                >
                  <MenuItem value="pending">Pending</MenuItem>
                  <MenuItem value="in_progress">In Progress</MenuItem>
                  <MenuItem value="completed">Completed</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={6}>
              <TextField
                fullWidth
                type="date"
                label="Due Date"
                value={taskForm.dueDate}
                onChange={(e) => setTaskForm({ ...taskForm, dueDate: e.target.value })}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            <Grid item xs={6}>
              <TextField
                fullWidth
                label="Assigned To"
                value={taskForm.assignedTo}
                onChange={(e) => setTaskForm({ ...taskForm, assignedTo: e.target.value })}
              />
            </Grid>
            <Grid item xs={6}>
              <FormControl fullWidth>
                <InputLabel>Related To Type</InputLabel>
                <Select
                  value={taskForm.relatedTo.type}
                  onChange={(e) => setTaskForm({ 
                    ...taskForm, 
                    relatedTo: { ...taskForm.relatedTo, type: e.target.value, id: '' }
                  })}
                  label="Related To Type"
                >
                  <MenuItem value="">None</MenuItem>
                  <MenuItem value="contact">Contact</MenuItem>
                  <MenuItem value="company">Company</MenuItem>
                  <MenuItem value="deal">Deal</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={6}>
              <FormControl fullWidth>
                <InputLabel>Related Entity</InputLabel>
                <Select
                  value={taskForm.relatedTo.id}
                  onChange={(e) => setTaskForm({ 
                    ...taskForm, 
                    relatedTo: { ...taskForm.relatedTo, id: e.target.value }
                  })}
                  label="Related Entity"
                  disabled={!taskForm.relatedTo.type}
                >
                  {taskForm.relatedTo.type === 'contact' && contacts.map(contact => (
                    <MenuItem key={contact.id} value={contact.id}>
                      {contact.fullName}
                    </MenuItem>
                  ))}
                  {taskForm.relatedTo.type === 'company' && companies.map(company => (
                    <MenuItem key={company.id} value={company.id}>
                      {company.companyName}
                    </MenuItem>
                  ))}
                  {taskForm.relatedTo.type === 'deal' && deals.map(deal => (
                    <MenuItem key={deal.id} value={deal.id}>
                      {deal.title}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowTaskDialog(false)}>Cancel</Button>
          <Button onClick={handleSaveTask} variant="contained">
            {editingTask ? 'Update' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

// Contacts Tab Component
const ContactsTab: React.FC<{
  contacts: any[];
  companies: any[];
  search: string;
  onSearchChange: (value: string) => void;
  onAddNew: () => void;
  loading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  contactFilter: 'all' | 'my';
  onContactFilterChange: (newFilter: 'all' | 'my') => void;
}> = ({ contacts, companies, search, onSearchChange, onAddNew, loading, hasMore, onLoadMore, contactFilter, onContactFilterChange }) => {
  const navigate = useNavigate();
  const { currentUser, tenantId } = useAuth();
  const [selectedContacts, setSelectedContacts] = useState<string[]>([]);
  const [selectedCompanyFilter, setSelectedCompanyFilter] = useState<string | null>(null);
  const [allCompanies, setAllCompanies] = useState<any[]>([]);
  const [loadingAllCompanies, setLoadingAllCompanies] = useState(false);

  // Function to get companies the current user is associated with
  const getMyCompanies = React.useCallback(() => {
    if (!currentUser?.uid) return [];
    
    return allCompanies.filter(company => {
      return company.salesOwnerId === currentUser.uid ||
             company.accountOwnerId === currentUser.uid ||
             company.salesOwnerId === currentUser.email ||
             company.accountOwnerId === currentUser.email ||
             (company.associatedUsers && company.associatedUsers.includes(currentUser.uid)) ||
             (company.associatedUsers && company.associatedUsers.includes(currentUser.email)) ||
             (company.associatedEmails && company.associatedEmails.includes(currentUser.email));
    });
  }, [allCompanies, currentUser]);

  // Calculate my contacts count separately
  const myContactsCount = React.useMemo(() => {
    // Since we're now using Firestore queries, the contacts prop already contains the filtered data
    // We just need to count the contacts that are currently loaded
    return contacts.length;
  }, [contacts]);

  // Filter contacts based on the selected filter and company filter
  const filteredContacts = React.useMemo(() => {
    let filtered = contacts;
    
    // Apply company filter if selected
    if (selectedCompanyFilter) {
      filtered = filtered.filter(contact => contact.companyId === selectedCompanyFilter);
    }
    
    return filtered;
  }, [contacts, selectedCompanyFilter]);

  // Load all companies for the filter dropdown
  const loadAllCompanies = React.useCallback(async () => {
    if (!tenantId) return;
    
    setLoadingAllCompanies(true);
    try {
      const { collection, query, orderBy, getDocs } = await import('firebase/firestore');
      const { db } = await import('../../firebase');
      
      const companiesRef = collection(db, 'tenants', tenantId, 'crm_companies');
      const q = query(companiesRef, orderBy('companyName', 'asc'));
      const snapshot = await getDocs(q);
      
      const allCompaniesData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setAllCompanies(allCompaniesData);
    } catch (error) {
      console.error('Error loading all companies:', error);
      // Fallback to using the companies from props if loading fails
      setAllCompanies(companies);
    } finally {
      setLoadingAllCompanies(false);
    }
  }, [tenantId, companies]);

  // Load all companies when component mounts or companies change
  React.useEffect(() => {
    loadAllCompanies();
  }, [loadAllCompanies]);

  const handleContactSelection = (contactId: string) => {
    setSelectedContacts(prev =>
      prev.includes(contactId) 
        ? prev.filter(id => id !== contactId) 
        : [...prev, contactId]
    );
  };

  return (
    <Box>
      {/* Header with search and actions */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6">Contacts ({filteredContacts.length})</Typography>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          {/* Contact Filter Toggle */}
          <ToggleButtonGroup
            value={contactFilter}
            exclusive
            onChange={(event, newFilter) => {
              if (newFilter !== null) {
                onContactFilterChange(newFilter);
              }
            }}
            size="small"
            sx={{ 
              '& .MuiToggleButton-root': {
                px: 2,
                py: 0.5,
                fontSize: '0.875rem'
              }
            }}
          >
            <ToggleButton value="all">
              All Contacts
            </ToggleButton>
            <ToggleButton value="my">
              My Contacts
            </ToggleButton>
          </ToggleButtonGroup>
          
          {/* Removed setup button - using existing associations */}
          
          {/* Company Filter */}
          <Autocomplete
            size="small"
            options={allCompanies}
            getOptionLabel={(option) => option.companyName || option.name || ''}
            value={allCompanies.find(c => c.id === selectedCompanyFilter) || null}
            onChange={(event, newValue) => {
              setSelectedCompanyFilter(newValue ? newValue.id : null);
            }}
            loading={loadingAllCompanies}
            renderInput={(params) => (
              <TextField
                {...params}
                placeholder={loadingAllCompanies ? "Loading companies..." : "Filter by company..."}
                variant="outlined"
                size="small"
                sx={{ width: 200 }}
                InputProps={{
                  ...params.InputProps,
                  endAdornment: (
                    <>
                      {loadingAllCompanies && <CircularProgress size={16} />}
                      {selectedCompanyFilter && (
                        <IconButton
                          size="small"
                          onClick={() => setSelectedCompanyFilter(null)}
                          sx={{ mr: 1 }}
                        >
                          <ClearIcon fontSize="small" />
                        </IconButton>
                      )}
                    </>
                  ),
                }}
              />
            )}
                            renderOption={(props, option) => {
                  const { key, ...otherProps } = props;
                  return (
                    <Box component="li" key={option.id} {...otherProps}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <BusinessIcon fontSize="small" color="action" />
                        <Typography variant="body2">
                          {option.companyName || option.name}
                        </Typography>
                      </Box>
                    </Box>
                  );
                }}
            isOptionEqualToValue={(option, value) => option.id === value.id}
            clearOnBlur={false}
            sx={{ width: 200 }}
          />
          
          <TextField
            size="small"
            variant="outlined"
            placeholder="Search contacts..."
            value={search}
            onChange={e => onSearchChange(e.target.value)}
            sx={{ width: 300 }}
            InputProps={{
              startAdornment: <SearchIcon sx={{ mr: 1, color: 'text.secondary' }} />,
              endAdornment: search && (
                <IconButton
                  size="small"
                  onClick={() => onSearchChange('')}
                  sx={{ mr: 1 }}
                >
                  <ClearIcon fontSize="small" />
                </IconButton>
              ),
            }}
          />
          <Button
            variant="contained"
            color="primary"
            startIcon={<AddIcon />}
            onClick={onAddNew}
          >
            Add Contact
          </Button>
        </Box>
      </Box>

      {/* Contacts Table */}
      <TableContainer component={Paper} sx={{ overflowX: 'auto' }}>
        <Table sx={{ minWidth: 1200 }}>
          <TableHead>
            <TableRow>
              <TableCell padding="checkbox" sx={{ width: 50 }}>
                <Checkbox
                  checked={selectedContacts.length === filteredContacts.length}
                  indeterminate={selectedContacts.length > 0 && selectedContacts.length < filteredContacts.length}
                  onChange={() => {
                    if (selectedContacts.length === filteredContacts.length) {
                      setSelectedContacts([]);
                    } else {
                      setSelectedContacts(filteredContacts.map(c => c.id));
                    }
                  }}
                />
              </TableCell>
              <TableCell sx={{ width: 200 }}>Name</TableCell>
              <TableCell sx={{ width: 150 }}>Job Title</TableCell>
              <TableCell sx={{ width: 150 }}>Company</TableCell>
              <TableCell sx={{ width: 200 }}>Email</TableCell>
              <TableCell sx={{ width: 120 }}>Phone</TableCell>
              <TableCell sx={{ width: 120 }}>Location</TableCell>
              <TableCell sx={{ width: 120 }}>Last Contacted</TableCell>
              <TableCell sx={{ width: 100 }}>Status</TableCell>
              <TableCell sx={{ width: 100 }}>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filteredContacts.map((contact) => (
              <TableRow key={contact.id} hover>
                <TableCell padding="checkbox">
                  <Checkbox
                    checked={selectedContacts.includes(contact.id)}
                    onChange={() => handleContactSelection(contact.id)}
                  />
                </TableCell>
                <TableCell>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Avatar sx={{ width: 32, height: 32 }}>
                      {contact.fullName?.charAt(0)}
                    </Avatar>
                    <Typography variant="body2" fontWeight="medium">
                      {contact.fullName}
                    </Typography>
                  </Box>
                </TableCell>
                <TableCell>{contact.jobTitle || contact.title || '-'}</TableCell>
                <TableCell>
                  {contact.companyName || companies.find(c => c.id === contact.companyId)?.companyName || '-'}
                </TableCell>
                <TableCell>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <EmailIcon fontSize="small" color="action" />
                    {contact.email}
                  </Box>
                </TableCell>
                <TableCell>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <PhoneIcon fontSize="small" color="action" />
                    {contact.phone || contact.workPhone || '-'}
                  </Box>
                </TableCell>
                <TableCell>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                    {contact.city && contact.state && (
                      <Typography variant="caption">
                        {contact.city}, {contact.state}
                      </Typography>
                    )}
                    {contact.linkedInUrl && (
                      <a href={contact.linkedInUrl} target="_blank" rel="noopener noreferrer">
                        <LinkedInIcon fontSize="small" color="primary" />
                      </a>
                    )}
                  </Box>
                </TableCell>
                <TableCell>
                  {contact.lastContactedTime ? (
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                      <Typography variant="caption">
                        {new Date(contact.lastContactedTime).toLocaleDateString()}
                      </Typography>
                      {contact.lastContactedMode && (
                        <Chip label={contact.lastContactedMode} size="small" variant="outlined" />
                      )}
                    </Box>
                  ) : '-'}
                </TableCell>
                <TableCell>
                  <Chip 
                    label={contact.status} 
                    size="small" 
                    color={contact.status === 'active' ? 'success' : 'default'}
                  />
                </TableCell>
                <TableCell>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<VisibilityIcon />}
                    onClick={() => navigate(`/crm/contacts/${contact.id}`)}
                    sx={{ minWidth: 80 }}
                  >
                    View
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Load More Button */}
      {hasMore && (
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
          <Button
            variant="outlined"
            onClick={onLoadMore}
            disabled={loading}
            startIcon={loading ? <CircularProgress size={16} /> : null}
          >
            {loading ? 'Loading...' : 'Load More Contacts'}
          </Button>
        </Box>
      )}


    </Box>
  );
};

// Companies Tab Component
const CompaniesTab: React.FC<{
  companies: any[];
  contacts: any[];
  deals: any[];
  search: string;
  onSearchChange: (value: string) => void;
  onAddNew: () => void;
  loading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  companyFilter: 'all' | 'my';
  onCompanyFilterChange: (newFilter: 'all' | 'my') => void;
}> = ({ companies, contacts, deals, search, onSearchChange, onAddNew, loading, hasMore, onLoadMore, companyFilter, onCompanyFilterChange }) => {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const [selectedCompanies, setSelectedCompanies] = useState<string[]>([]);
  const [showCompanyDialog, setShowCompanyDialog] = useState(false);
  const [editingCompany, setEditingCompany] = useState<any>(null);
  const [companyForm, setCompanyForm] = useState({
    name: '',
    status: 'lead',
    industry: '',
    tier: 'C',
    tags: [] as string[],
    accountOwner: '',
    source: '',
    address: '',
    notes: '',
  });

  // Reload companies when filter changes
  React.useEffect(() => {
    // This will trigger the parent component to reload companies with the new filter
    // We need to pass this information up to the parent component
  }, [companyFilter]);

  // Since filtering is now handled at the database level, we just use the companies as-is
  const filteredCompanies = companies;

  const handleCompanySelection = (companyId: string) => {
    setSelectedCompanies(prev =>
      prev.includes(companyId) 
        ? prev.filter(id => id !== companyId) 
        : [...prev, companyId]
    );
  };

  const handleViewCompany = (company: any) => {
    navigate(`/crm/companies/${company.id}`);
  };

  const handleEditCompany = (company: any) => {
    setEditingCompany(company);
    setCompanyForm({
      name: company.companyName || '',
      status: company.status || 'lead',
      industry: company.industry || '',
      tier: company.tier || 'C',
      tags: company.tags || [],
      accountOwner: company.accountOwner || '',
      source: company.source || '',
      address: company.address || '',
      notes: company.notes || '',
    });
    setShowCompanyDialog(true);
  };

  const handleSaveCompany = async () => {
    // Implementation for saving company
    setShowCompanyDialog(false);
    setEditingCompany(null);
  };

  const getCompanyContacts = (companyId: string) => {
    return contacts.filter(contact => contact.companyId === companyId);
  };

  const getCompanyDeals = (companyId: string) => {
    return deals.filter(deal => deal.companyId === companyId);
  };

  return (
    <Box>
      {/* Header with search and actions */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6">Companies ({filteredCompanies.length})</Typography>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          {/* Company Filter Toggle */}
          <ToggleButtonGroup
            value={companyFilter}
            exclusive
            onChange={(event, newFilter) => {
              if (newFilter !== null) {
                onCompanyFilterChange(newFilter);
              }
            }}
            size="small"
            sx={{ 
              '& .MuiToggleButton-root': {
                px: 2,
                py: 0.5,
                fontSize: '0.875rem'
              }
            }}
          >
            <ToggleButton value="all">
              All Companies
            </ToggleButton>
            <ToggleButton value="my">
              My Companies
            </ToggleButton>
          </ToggleButtonGroup>

          <TextField
            size="small"
            variant="outlined"
            placeholder="Search by company name, URL, or city..."
            value={search}
            onChange={e => onSearchChange(e.target.value)}
            sx={{ width: 300 }}
            InputProps={{
              startAdornment: <SearchIcon sx={{ mr: 1, color: 'text.secondary' }} />,
              endAdornment: search && (
                <IconButton
                  size="small"
                  onClick={() => onSearchChange('')}
                  sx={{ mr: 1 }}
                >
                  <ClearIcon fontSize="small" />
                </IconButton>
              ),
            }}
          />

          <Button
            variant="contained"
            color="primary"
            startIcon={<AddIcon />}
            onClick={onAddNew}
          >
            Add Company
          </Button>
        </Box>
      </Box>

      {/* Companies Table */}
      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell padding="checkbox">
                <Checkbox
                  checked={selectedCompanies.length === filteredCompanies.length}
                  indeterminate={selectedCompanies.length > 0 && selectedCompanies.length < filteredCompanies.length}
                  onChange={() => {
                    if (selectedCompanies.length === filteredCompanies.length) {
                      setSelectedCompanies([]);
                    } else {
                      setSelectedCompanies(filteredCompanies.map(c => c.id));
                    }
                  }}
                />
              </TableCell>
              <TableCell>Company Name</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Industry</TableCell>
              <TableCell>Tier</TableCell>
              <TableCell>Contacts</TableCell>
              <TableCell>Deals</TableCell>
              <TableCell>Tags</TableCell>
              <TableCell>Account Owner</TableCell>
              <TableCell>Source</TableCell>
              <TableCell>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filteredCompanies.map((company) => (
              <TableRow key={company.id} hover>
                <TableCell padding="checkbox">
                  <Checkbox
                    checked={selectedCompanies.includes(company.id)}
                    onChange={() => handleCompanySelection(company.id)}
                  />
                </TableCell>
                <TableCell>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <BusinessIcon color="primary" />
                    <Typography variant="body2" fontWeight="medium">
                      {company.companyName}
                    </Typography>
                  </Box>
                </TableCell>
                <TableCell>
                  <Chip 
                    label={company.status} 
                    size="small" 
                    color={
                      company.status === 'active' ? 'success' : 
                      company.status === 'lead' ? 'primary' : 
                      company.status === 'lost' ? 'error' : 'default'
                    }
                  />
                </TableCell>
                <TableCell>{company.industry}</TableCell>
                <TableCell>
                  <Chip 
                    label={company.tier} 
                    size="small" 
                    color={company.tier === 'A' ? 'primary' : company.tier === 'B' ? 'secondary' : 'default'}
                  />
                </TableCell>
                <TableCell>
                  <Badge badgeContent={getCompanyContacts(company.id).length} color="primary">
                    <PersonIcon />
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge badgeContent={getCompanyDeals(company.id).length} color="secondary">
                    <DealIcon />
                  </Badge>
                </TableCell>
                <TableCell>
                  <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                    {company.tags?.slice(0, 2).map((tag: string, index: number) => (
                      <Chip key={index} label={tag} size="small" />
                    ))}
                    {company.tags?.length > 2 && (
                      <Chip label={`+${company.tags.length - 2}`} size="small" variant="outlined" />
                    )}
                  </Box>
                </TableCell>
                <TableCell>{company.accountOwner}</TableCell>
                <TableCell>{company.source}</TableCell>
                <TableCell>
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => handleViewCompany(company)}
                    sx={{ minWidth: 'auto', px: 1 }}
                  >
                    View
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Pagination Controls */}
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2, gap: 2 }}>
        {loading && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <CircularProgress size={20} />
            <Typography variant="body2">Loading companies...</Typography>
          </Box>
        )}
        {hasMore && !loading && (
          <Button
            variant="outlined"
            onClick={onLoadMore}
            disabled={loading}
          >
            Load More Companies
          </Button>
        )}
        {!hasMore && companies.length > 0 && (
          <Typography variant="body2" color="text.secondary">
            All companies loaded ({companies.length} total)
          </Typography>
        )}
        {!hasMore && companies.length === 0 && !loading && (
          <Typography variant="body2" color="text.secondary">
            No companies found
          </Typography>
        )}
      </Box>

      {/* Company Dialog */}
      <Dialog open={showCompanyDialog} onClose={() => setShowCompanyDialog(false)} maxWidth="md" fullWidth>
        <DialogTitle>
          {editingCompany ? 'Edit Company' : 'Add New Company'}
        </DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Company Name"
                value={companyForm.name}
                onChange={(e) => setCompanyForm(prev => ({ ...prev, name: e.target.value }))}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <FormControl fullWidth>
                <InputLabel>Status</InputLabel>
                <Select
                  value={companyForm.status}
                  onChange={(e) => setCompanyForm(prev => ({ ...prev, status: e.target.value }))}
                  label="Status"
                >
                  <MenuItem value="lead">Lead</MenuItem>
                  <MenuItem value="active">Active</MenuItem>
                  <MenuItem value="inactive">Inactive</MenuItem>
                  <MenuItem value="lost">Lost</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Industry"
                value={companyForm.industry}
                onChange={(e) => setCompanyForm(prev => ({ ...prev, industry: e.target.value }))}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <FormControl fullWidth>
                <InputLabel>Tier</InputLabel>
                <Select
                  value={companyForm.tier}
                  onChange={(e) => setCompanyForm(prev => ({ ...prev, tier: e.target.value }))}
                  label="Tier"
                >
                  <MenuItem value="A">A</MenuItem>
                  <MenuItem value="B">B</MenuItem>
                  <MenuItem value="C">C</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Account Owner"
                value={companyForm.accountOwner}
                onChange={(e) => setCompanyForm(prev => ({ ...prev, accountOwner: e.target.value }))}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Source"
                value={companyForm.source}
                onChange={(e) => setCompanyForm(prev => ({ ...prev, source: e.target.value }))}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Address"
                value={companyForm.address}
                onChange={(e) => setCompanyForm(prev => ({ ...prev, address: e.target.value }))}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Notes"
                multiline
                rows={3}
                value={companyForm.notes}
                onChange={(e) => setCompanyForm(prev => ({ ...prev, notes: e.target.value }))}
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowCompanyDialog(false)}>Cancel</Button>
          <Button onClick={handleSaveCompany} variant="contained">
            {editingCompany ? 'Update' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>


    </Box>
  );
};

// Deals Tab Component
const DealsTab: React.FC<{
  deals: any[];
  companies: any[];
  contacts: any[];
  pipelineStages: any[];
  search: string;
  onSearchChange: (value: string) => void;
  onAddNew: () => void;
  dealFilter: 'all' | 'my';
  onDealFilterChange: (newFilter: 'all' | 'my') => void;
}> = ({ deals, companies, contacts, pipelineStages, search, onSearchChange, onAddNew, dealFilter, onDealFilterChange }) => {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const [selectedDeals, setSelectedDeals] = useState<string[]>([]);
  const [showDealDialog, setShowDealDialog] = useState(false);
  const [editingDeal, setEditingDeal] = useState<any>(null);
  const [dealForm, setDealForm] = useState({
    name: '',
    value: '',
    stage: '',
    companyId: '',
    contactIds: [] as string[],
    description: '',
    expectedCloseDate: '',
    probability: 50,
    tags: [] as string[],
    owner: '',
  });

  const [showDealWizard, setShowDealWizard] = useState(false);

  // Calculate my deals count
  const myDealsCount = React.useMemo(() => {
    // Since we're now using Firestore queries, the deals prop already contains the filtered data
    // We just need to count the deals that are currently loaded
    return deals.length;
  }, [deals]);

  // Filter deals based on the selected filter
  const filteredDeals = React.useMemo(() => {
    return deals;
  }, [deals]);

  const handleDealSelection = (dealId: string) => {
    setSelectedDeals(prev =>
      prev.includes(dealId) 
        ? prev.filter(id => id !== dealId) 
        : [...prev, dealId]
    );
  };

  const handleEditDeal = (deal: any) => {
    setEditingDeal(deal);
    setDealForm({
      name: deal.name || '',
      value: deal.value || '',
      stage: deal.stage || '',
      companyId: deal.companyId || '',
      contactIds: deal.contactIds || [],
      description: deal.description || '',
      expectedCloseDate: deal.expectedCloseDate || '',
      probability: deal.probability || 50,
      tags: deal.tags || [],
      owner: deal.owner || '',
    });
    setShowDealDialog(true);
  };

  const handleSaveDeal = async () => {
    // Implementation for saving deal
    setShowDealDialog(false);
    setEditingDeal(null);
  };

  const getDealContacts = (contactIds: string[]) => {
    return contacts.filter(contact => contactIds.includes(contact.id));
  };

  return (
    <Box>
      {/* Header with search and actions */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6">Opportunities ({filteredDeals.length})</Typography>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          {/* Deal Filter Toggle */}
          <ToggleButtonGroup
            value={dealFilter}
            exclusive
            onChange={(event, newFilter) => {
              if (newFilter !== null) {
                onDealFilterChange(newFilter);
              }
            }}
            size="small"
            sx={{ mr: 2 }}
          >
            <ToggleButton value="all">
              All Opportunities
            </ToggleButton>
            <ToggleButton value="my">
              My Opportunities ({myDealsCount})
            </ToggleButton>
          </ToggleButtonGroup>
          
          <TextField
            placeholder="Search opportunities..."
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            size="small"
            sx={{ minWidth: 300 }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon />
                </InputAdornment>
              ),
            }}
          />
          <Button
            variant="contained"
            color="primary"
            startIcon={<AddIcon />}
            onClick={onAddNew}
          >
            Add New Opportunity
          </Button>
        </Box>
      </Box>

      {/* Deals Table */}
      <TableContainer component={Paper} sx={{ overflowX: 'auto' }}>
        <Table sx={{ minWidth: 1400 }}>
          <TableHead>
            <TableRow>
              <TableCell padding="checkbox" sx={{ width: 50 }}>
                <Checkbox
                  checked={selectedDeals.length === filteredDeals.length}
                  indeterminate={selectedDeals.length > 0 && selectedDeals.length < filteredDeals.length}
                  onChange={() => {
                    if (selectedDeals.length === filteredDeals.length) {
                      setSelectedDeals([]);
                    } else {
                      setSelectedDeals(filteredDeals.map(d => d.id));
                    }
                  }}
                />
              </TableCell>
              <TableCell sx={{ width: 250 }}>Deal Name</TableCell>
              <TableCell sx={{ width: 150 }}>Company</TableCell>
              <TableCell sx={{ width: 120 }}>Stage</TableCell>
              <TableCell sx={{ width: 120 }}>Value</TableCell>
              <TableCell sx={{ width: 120 }}>Probability</TableCell>
              <TableCell sx={{ width: 120 }}>Close Date</TableCell>
              <TableCell sx={{ width: 100 }}>Owner</TableCell>
              <TableCell sx={{ width: 100 }}>Contacts</TableCell>
              <TableCell sx={{ width: 150 }}>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filteredDeals.map((deal) => (
              <TableRow key={deal.id} hover>
                <TableCell padding="checkbox">
                  <Checkbox
                    checked={selectedDeals.includes(deal.id)}
                    onChange={() => handleDealSelection(deal.id)}
                  />
                </TableCell>
                <TableCell>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <DealIcon color="primary" />
                    <Typography variant="body2" fontWeight="medium">
                      {deal.name}
                    </Typography>
                  </Box>
                </TableCell>
                <TableCell>
                  {companies.find(c => c.id === deal.companyId)?.name || '-'}
                </TableCell>
                <TableCell>
                  <StageChip 
                    stage={deal.stage} 
                    size="small" 
                    useCustomColors={true}
                  />
                </TableCell>
                <TableCell>
                  <Typography variant="body2" fontWeight="medium">
                    ${deal.value ? Number(deal.value).toLocaleString() : '0'}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="body2">{deal.probability}%</Typography>
                    <Box sx={{ width: 50, height: 4, bgcolor: 'grey.200', borderRadius: 2 }}>
                      <Box 
                        sx={{ 
                          width: `${deal.probability}%`, 
                          height: '100%', 
                          bgcolor: 'primary.main', 
                          borderRadius: 2 
                        }} 
                      />
                    </Box>
                  </Box>
                </TableCell>
                <TableCell>{deal.expectedCloseDate ? new Date(deal.expectedCloseDate).toLocaleDateString() : '-'}</TableCell>
                <TableCell>{deal.owner || '-'}</TableCell>
                <TableCell>
                  <Badge badgeContent={getDealContacts(deal.contactIds || []).length} color="primary">
                    <PersonIcon />
                  </Badge>
                </TableCell>
                <TableCell>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<VisibilityIcon />}
                    onClick={() => navigate(`/crm/deals/${deal.id}`)}
                    sx={{ minWidth: 80 }}
                  >
                    View
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Deal Dialog */}
      <Dialog open={showDealDialog} onClose={() => setShowDealDialog(false)} maxWidth="md" fullWidth>
        <DialogTitle>
          {editingDeal ? 'Edit Deal' : 'Add New Deal'}
        </DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Deal Name"
                value={dealForm.name}
                onChange={(e) => setDealForm(prev => ({ ...prev, name: e.target.value }))}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <FormControl fullWidth>
                <InputLabel>Company</InputLabel>
                <Select
                  value={dealForm.companyId}
                  onChange={(e) => setDealForm(prev => ({ ...prev, companyId: e.target.value }))}
                  label="Company"
                >
                  {companies.map((company) => (
                    <MenuItem key={company.id} value={company.id}>
                      {company.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={6}>
              <FormControl fullWidth>
                <InputLabel>Stage</InputLabel>
                <Select
                  value={dealForm.stage}
                  onChange={(e) => setDealForm(prev => ({ ...prev, stage: e.target.value }))}
                  label="Stage"
                >
                  {pipelineStages.map((stage) => (
                    <MenuItem key={stage.id} value={stage.name}>
                      {stage.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Value"
                type="number"
                value={dealForm.value}
                onChange={(e) => setDealForm(prev => ({ ...prev, value: e.target.value }))}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Probability (%)"
                type="number"
                value={dealForm.probability}
                onChange={(e) => setDealForm(prev => ({ ...prev, probability: Number(e.target.value) }))}
                inputProps={{ min: 0, max: 100 }}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Expected Close Date"
                type="date"
                value={dealForm.expectedCloseDate}
                onChange={(e) => setDealForm(prev => ({ ...prev, expectedCloseDate: e.target.value }))}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Owner"
                value={dealForm.owner}
                onChange={(e) => setDealForm(prev => ({ ...prev, owner: e.target.value }))}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Description"
                multiline
                rows={3}
                value={dealForm.description}
                onChange={(e) => setDealForm(prev => ({ ...prev, description: e.target.value }))}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Tags"
                value={dealForm.tags.join(', ')}
                onChange={(e) => setDealForm(prev => ({ ...prev, tags: e.target.value.split(',').map(tag => tag.trim()) }))}
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowDealDialog(false)}>Cancel</Button>
          <Button onClick={handleSaveDeal} variant="contained">
            {editingDeal ? 'Update' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Deal Intelligence Wizard */}
      <DealIntelligenceWizard
        open={showDealWizard}
        onClose={() => setShowDealWizard(false)}
        onSuccess={(dealId) => {
          console.log('Deal Intelligence Wizard completed:', dealId);
          setShowDealWizard(false);
          // Optionally refresh deals or navigate to the new deal
        }}
      />
    </Box>
  );
};

// Pipeline Tab Component
const PipelineTab: React.FC<{
  deals: any[];
  companies: any[];
  pipelineStages: any[];
  filters: any;
  onFiltersChange: (filters: any) => void;
}> = ({ deals, companies, pipelineStages, filters, onFiltersChange }) => {
  const getDealsByStage = (stageName: string) => {
    return deals.filter(deal => deal.stage === stageName);
  };

  const getTotalValue = (stageDeals: any[]) => {
    return stageDeals.reduce((sum, deal) => sum + (Number(deal.estimatedRevenue) || 0), 0);
  };

  return (
    <Box>
      {/* Header with filters */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6">Sales Pipeline</Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <FormControl size="small" sx={{ minWidth: 120 }}>
            <InputLabel>Owner</InputLabel>
            <Select
              value={filters.owner}
              onChange={(e) => onFiltersChange({ ...filters, owner: e.target.value })}
              label="Owner"
            >
              <MenuItem value="all">All Owners</MenuItem>
              <MenuItem value="me">My Deals</MenuItem>
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 120 }}>
            <InputLabel>Industry</InputLabel>
            <Select
              value={filters.industry}
              onChange={(e) => onFiltersChange({ ...filters, industry: e.target.value })}
              label="Industry"
            >
              <MenuItem value="all">All Industries</MenuItem>
              <MenuItem value="warehouse">Warehouse</MenuItem>
              <MenuItem value="events">Events</MenuItem>
              <MenuItem value="cannabis">Cannabis</MenuItem>
            </Select>
          </FormControl>
        </Box>
      </Box>

      {/* Pipeline Board */}
      <Box sx={{ display: 'flex', gap: 2, overflowX: 'auto', pb: 2 }}>
        {pipelineStages.map((stage) => {
          const stageDeals = getDealsByStage(stage.name);
          const totalValue = getTotalValue(stageDeals);
          
          return (
            <Card key={stage.id} sx={{ minWidth: 300, flexShrink: 0 }}>
              <CardHeader
                title={
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Typography variant="h6">{stage.name}</Typography>
                    <Badge badgeContent={stageDeals.length} color="primary">
                      <Typography variant="body2">{stageDeals.length}</Typography>
                    </Badge>
                  </Box>
                }
                subheader={`$${totalValue.toLocaleString()}`}
                action={
                  <IconButton size="small">
                    <AddIcon />
                  </IconButton>
                }
              />
              <CardContent sx={{ pt: 0 }}>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {stageDeals.map((deal) => (
                    <Card key={deal.id} variant="outlined" sx={{ p: 1 }}>
                      <Typography variant="body2" fontWeight="medium">
                        {deal.name}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {companies.find(c => c.id === deal.companyId)?.name}
                      </Typography>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 1 }}>
                        <Typography variant="caption" fontWeight="medium">
                          ${Number(deal.estimatedRevenue).toLocaleString()}
                        </Typography>
                        <Chip 
                          label={`${deal.probability}%`} 
                          size="small" 
                          color={deal.probability > 50 ? 'success' : 'default'}
                        />
                      </Box>
                    </Card>
                  ))}
                </Box>
              </CardContent>
            </Card>
          );
        })}
      </Box>
    </Box>
  );
};

// Reports Tab Component
const ReportsTab: React.FC<{
  deals: any[];
  companies: any[];
  contacts: any[];
}> = ({ deals, companies, contacts }) => {
  const getDealWinRate = () => {
    const closedWon = deals.filter(d => d.stage === 'closed-won').length;
    const closedLost = deals.filter(d => d.stage === 'closed-lost').length;
    const total = closedWon + closedLost;
    return total > 0 ? Math.round((closedWon / total) * 100) : 0;
  };

  const getTotalPipelineValue = () => {
    return deals.reduce((sum, deal) => sum + (Number(deal.estimatedRevenue) || 0), 0);
  };

  const getAverageDealSize = () => {
    const activeDeals = deals.filter(d => d.stage !== 'closed-won' && d.stage !== 'closed-lost');
    const totalValue = activeDeals.reduce((sum, deal) => sum + (Number(deal.estimatedRevenue) || 0), 0);
    return activeDeals.length > 0 ? Math.round(totalValue / activeDeals.length) : 0;
  };

  return (
    <Box>
      <Typography variant="h6" gutterBottom>Sales Reports</Typography>
      
      {/* Key Metrics */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <TrendingUpIcon color="primary" />
                <Typography variant="h6">{getDealWinRate()}%</Typography>
              </Box>
              <Typography variant="body2" color="text.secondary">Win Rate</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <DealIcon color="primary" />
                <Typography variant="h6">${getTotalPipelineValue().toLocaleString()}</Typography>
              </Box>
              <Typography variant="body2" color="text.secondary">Pipeline Value</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <BusinessIcon color="primary" />
                <Typography variant="h6">{companies.length}</Typography>
              </Box>
              <Typography variant="body2" color="text.secondary">Total Companies</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <PersonIcon color="primary" />
                <Typography variant="h6">{contacts.length}</Typography>
              </Box>
              <Typography variant="body2" color="text.secondary">Total Contacts</Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Detailed Reports */}
      <Grid container spacing={3}>
        <Grid item xs={12} md={6}>
          <Card>
            <CardHeader title="Deals by Stage" />
            <CardContent>
              <List>
                {['lead', 'qualified', 'proposal', 'negotiation', 'closed-won', 'closed-lost'].map((stage) => {
                  const stageDeals = deals.filter(d => d.stage === stage);
                  return (
                    <ListItem key={stage}>
                      <ListItemText 
                        primary={stage.replace('-', ' ').toUpperCase()} 
                        secondary={`${stageDeals.length} deals`}
                      />
                      <ListItemSecondaryAction>
                        <Typography variant="body2" fontWeight="medium">
                          ${getTotalValue(stageDeals).toLocaleString()}
                        </Typography>
                      </ListItemSecondaryAction>
                    </ListItem>
                  );
                })}
              </List>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} md={6}>
          <Card>
            <CardHeader title="Recent Activity" />
            <CardContent>
              <Typography variant="body2" color="text.secondary">
                Activity tracking will be implemented in future updates.
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
};

// Settings Tab Component
const SettingsTab: React.FC<{
  pipelineStages: any[];
  tenantId: string;
}> = ({ pipelineStages, tenantId }) => {
  const [showStageDialog, setShowStageDialog] = useState(false);
  const [editingStage, setEditingStage] = useState<any>(null);
  const [stageForm, setStageForm] = useState({
    name: '',
    probability: 0,
    color: '#1976d2',
  });

  const handleEditStage = (stage: any) => {
    setEditingStage(stage);
    setStageForm({
      name: stage.name || '',
      probability: stage.probability || 0,
      color: stage.color || '#1976d2',
    });
    setShowStageDialog(true);
  };

  const handleSaveStage = async () => {
    // Implementation for saving stage
    setShowStageDialog(false);
    setEditingStage(null);
  };

  return (
    <Box>
      <Typography variant="h6" gutterBottom>CRM Settings</Typography>
      
      {/* Pipeline Stages */}
      <Card sx={{ mb: 3 }}>
        <CardHeader 
          title="Pipeline Stages" 
          action={
            <Button 
              variant="outlined" 
              size="small"
              onClick={() => setShowStageDialog(true)}
            >
              Add Stage
            </Button>
          }
        />
        <CardContent>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Stage Name</TableCell>
                  <TableCell>Probability</TableCell>
                  <TableCell>Color</TableCell>
                  <TableCell>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {pipelineStages.map((stage) => (
                  <TableRow key={stage.id}>
                    <TableCell>{stage.name}</TableCell>
                    <TableCell>{stage.probability}%</TableCell>
                    <TableCell>
                      <Box sx={{ width: 20, height: 20, bgcolor: stage.color, borderRadius: 1 }} />
                    </TableCell>
                    <TableCell>
                      <IconButton size="small" onClick={() => handleEditStage(stage)}>
                        <EditIcon />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>

      {/* Other Settings */}
      <Grid container spacing={3}>
        <Grid item xs={12} md={6}>
          <Card>
            <CardHeader title="Contact Roles" />
            <CardContent>
              <List>
                {['decision_maker', 'influencer', 'finance', 'operations', 'hr'].map((role) => (
                  <ListItem key={role}>
                    <ListItemText 
                      primary={role.replace('_', ' ').toUpperCase()} 
                    />
                  </ListItem>
                ))}
              </List>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} md={6}>
          <Card>
            <CardHeader title="Lead Sources" />
            <CardContent>
              <List>
                {['website', 'referral', 'cold_call', 'email', 'social_media'].map((source) => (
                  <ListItem key={source}>
                    <ListItemText 
                      primary={source.replace('_', ' ').toUpperCase()} 
                    />
                  </ListItem>
                ))}
              </List>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Gmail Integration Settings */}
      <Box sx={{ mt: 4 }}>
        <GmailSettings tenantId={tenantId} />
      </Box>

      {/* Stage Dialog */}
      <Dialog open={showStageDialog} onClose={() => setShowStageDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>
          {editingStage ? 'Edit Pipeline Stage' : 'Add Pipeline Stage'}
        </DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Stage Name"
                value={stageForm.name}
                onChange={(e) => setStageForm(prev => ({ ...prev, name: e.target.value }))}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Probability (%)"
                type="number"
                value={stageForm.probability}
                onChange={(e) => setStageForm(prev => ({ ...prev, probability: Number(e.target.value) }))}
                inputProps={{ min: 0, max: 100 }}
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowStageDialog(false)}>Cancel</Button>
          <Button onClick={handleSaveStage} variant="contained">
            {editingStage ? 'Update' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

// Helper function for calculating total value
const getTotalValue = (deals: any[]) => {
  return deals.reduce((sum, deal) => sum + (Number(deal.estimatedRevenue) || 0), 0);
};

export default TenantCRM; 