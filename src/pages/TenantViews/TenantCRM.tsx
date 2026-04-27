import React, { useEffect, useState, useRef, useCallback, forwardRef, useImperativeHandle } from 'react';
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
  Chip,
  Autocomplete,
  Checkbox,
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
  Badge,
  Avatar,
  Switch,
  FormControlLabel,
  CircularProgress,
  InputAdornment,
  Tooltip,
  Skeleton,
} from '@mui/material';
import {
  collection,
  addDoc,
  getDocs,
  query,
  where,
  serverTimestamp,
  doc,
  getDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  orderBy,
  limit,
  startAfter,
  collectionGroup,
} from 'firebase/firestore';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Person as PersonIcon,
  Business as BusinessIcon,
  AttachMoney as DealIcon,
  Group as GroupIcon,
  Timeline as PipelineIcon,
  Settings as SettingsIcon,
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Search as SearchIcon,
  Phone as PhoneIcon,
  Email as EmailIcon,
  TrendingUp as TrendingUpIcon,
  Visibility as VisibilityIcon,
  Assignment as TaskIcon,
  CheckCircle as CompletedIcon,
  Schedule as PendingIcon,
  PriorityHigh as HighPriorityIcon,
  FiberManualRecord as MediumPriorityIcon,
  RadioButtonUnchecked as LowPriorityIcon,
  Clear as ClearIcon,
  Dashboard as DashboardIcon,
  FilterAlt as FilterAltIcon,
  MoreVert as MoreVertIcon,
  FileDownload as FileDownloadIcon,
  ContentCopy as ContentCopyIcon,
  StarBorder as StarBorderIcon,
  Archive as ArchiveIcon,
  Note as NoteIcon,
} from '@mui/icons-material';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db, functions } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useCRMCache } from '../../contexts/CRMCacheContext';
import { useFavorites } from '../../hooks/useFavorites';
import FavoriteButton from '../../components/FavoriteButton';
import FavoritesFilter from '../../components/FavoritesFilter';
import PageHeader from '../../components/PageHeader';
import InboxSearchBar from '../../components/InboxSearchBar';
import ContactTable from '../../components/ContactTable';
import ContactTableRow from '../../components/ContactTableRow';
import CompanyTable from '../../components/CompanyTable';
import StandardTablePagination from '../../components/StandardTablePagination';
import { getDealCompanyIds, getDealPrimaryCompanyId } from '../../utils/associationsAdapter';
import { AssociationUtils } from '../../utils/associationUtils';
import CRMImportDialog from '../../components/CRMImportDialog';
import DealIntelligenceWizard from '../../components/DealIntelligenceWizard';
import KPIManagement from '../../components/KPIManagement';
import KPIDashboard from '../../components/KPIDashboard';
import NationalAccountManager from '../../components/NationalAccountManager';
import EnhancedContactManager from '../../components/EnhancedContactManager';
import CompanyHierarchyManager from '../../components/CompanyHierarchyManager';
import GoogleIntegration from '../../components/GoogleIntegration';
import StageChip from '../../components/StageChip';
import UserTasksDashboard from '../../components/UserTasksDashboard';
import PipelineFunnel from '../../components/PipelineFunnel';
import PipelineBubbleChart from '../../components/PipelineBubbleChart';
import SalesCoach from '../../components/SalesCoach';
import TasksDashboard from '../../components/TasksDashboard';
import UserAppointmentsDashboard from '../../components/UserAppointmentsDashboard';
import DealAgeChip from '../../components/DealAgeChip';
import HealthBadge from '../../components/HealthBadge';
import { calculateDealHealth, getDealHealthLegacy, calculateDealAge } from '../../utils/dealHealthCalculator';
import CalendarWidget from '../../components/CalendarWidget';
import ProspectingHub from './ProspectingHub';
import SalespersonActivityView from '../../components/SalespersonActivityView';



type TenantCRMStandaloneTab = 'contacts' | 'companies' | 'opportunities';

const TenantCRM: React.FC<{ standaloneTab?: TenantCRMStandaloneTab }> = ({ standaloneTab }) => {
  const { tenantId, role, accessRole, orgType, currentUser, activeTenant } = useAuth();
  const { cacheState, updateCacheState, hasCachedState } = useCRMCache();
  const navigate = useNavigate();
  
  // State for tabs - use URL params with fallback to cached state
  const [searchParams, setSearchParams] = useSearchParams();
  const didRestoreTabFromCacheRef = useRef(false);
  const isLockingTabRef = useRef(false);
  const [tabValue, setTabValue] = useState(() => {
    const standaloneTabMap: Record<TenantCRMStandaloneTab, number> = {
      contacts: 1, // Deprecated - will redirect
      companies: 2, // Deprecated - will redirect
      opportunities: 1,
    };
    if (standaloneTab) return standaloneTabMap[standaloneTab];

    // Initialize tab value from URL on first load
    const tabParam = searchParams.get('tab');
    if (tabParam) {
      const tabMap: Record<string, number> = {
        // CRM tab buttons now only show Opportunities + Pipeline + Archive.
        // Hidden tabs map to Opportunities to avoid landing users on hidden views.
        'dashboard': 1,
        'opportunities': 1,
        'pipeline': 2,
        'archive': 3,
        'prospect': 1,
        'activity': 1,
        'reports': 9,
        'kpi-management': 7,
        'kpi-dashboard': 8,
      };
      return tabMap[tabParam] ?? 1;
    }
    // Default active tab: Opportunities
    return 1;
  });
  
  // Track if we're in the middle of a user-initiated tab change to prevent URL override
  const [isUserTabChange, setIsUserTabChange] = useState(false);
  
  // Initialize tab value from URL or cache (only on mount, not on every URL change)
  useEffect(() => {
    if (standaloneTab) return;
    // Only run this on initial mount when we don't have a URL tab param
    const tabParam = searchParams.get('tab');
    // CRM default should always land on Opportunities when no explicit tab is provided.
    if (!tabParam && tabValue !== 1) {
      setTabValue(1);
      updateCacheState({ activeTab: 1 });
    }
  }, []); // Empty dependency array - only run on mount
  
  // State for data
  const [contacts, setContacts] = useState<any[]>([]);
  const [allContacts, setAllContacts] = useState<any[]>([]); // All contacts for TasksDashboard
  const [companies, setCompanies] = useState<any[]>([]);
  const [deals, setDeals] = useState<any[]>([]);
  const [allDeals, setAllDeals] = useState<any[]>([]);
  const [pipelineStages, setPipelineStages] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [crmTasks, setCrmTasks] = useState<any[]>([]);
  const [regularTasks, setRegularTasks] = useState<any[]>([]);
  
  // Pagination state for companies
  const [companiesLoading, setCompaniesLoading] = useState(true); // Start with loading true to prevent flash
  const [companiesLastDoc, setCompaniesLastDoc] = useState<any>(null);
  const [companiesHasMore, setCompaniesHasMore] = useState(true);
  const [companiesPageSize] = useState(20);
  const [companyFilter, setCompanyFilter] = useState<'all' | 'my'>(cacheState.companyFilter);
  const [companyLocationState, setCompanyLocationState] = useState<string>(cacheState.companiesStateFilter || 'all');
  const [contactFilter, setContactFilter] = useState<'all' | 'my'>(cacheState.contactFilter);
  const [dealFilter, setDealFilter] = useState<'all' | 'my'>(cacheState.dealFilter);
  const [contactsStateFilter, setContactsStateFilter] = useState<string>(cacheState.contactsStateFilter || 'all');
  const [contactsShowFavoritesOnly, setContactsShowFavoritesOnly] = useState(false);
  const [companiesShowFavoritesOnly, setCompaniesShowFavoritesOnly] = useState(false);
  const [companyPins, setCompanyPins] = useState<any[]>([]);
  const [infoOpen, setInfoOpen] = useState(false);
  const [infoMessage, setInfoMessage] = useState('');
  const [locations, setLocations] = useState<any[]>([]);
  
  // Pagination state for contacts
  const [contactsLoading, setContactsLoading] = useState(true); // Start with loading true to prevent flash
  const [contactsLastDoc, setContactsLastDoc] = useState<any>(null);
  const [contactsHasMore, setContactsHasMore] = useState(true);
  const [contactsPageSize] = useState(20);
  
  // State for forms and UI
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [search, setSearch] = useState(cacheState.searchTerm);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [dialogType, setDialogType] = useState<'contact' | 'company' | 'deal' | 'task'>('contact');
  const [opportunityDialogOpen, setOpportunityDialogOpen] = useState(false);
  
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
    locationId: '',
    contactType: 'Unknown',
    tags: [] as string[],
    isActive: true,
    notes: ''
  });
  const [savingContact, setSavingContact] = useState(false);
  const [companyLocations, setCompanyLocations] = useState<any[]>([]);
  const [loadingCompanyLocations, setLoadingCompanyLocations] = useState(false);
  
  // Company form state
  const [companyForm, setCompanyForm] = useState({
    name: '',
    website: '',
    industry: '',
    source: '',
    notes: '',
    parentCompany: ''
  });
  const [savingCompany, setSavingCompany] = useState(false);
  
  const [allCompanies, setAllCompanies] = useState<any[]>([]);
  const [loadingAllCompanies, setLoadingAllCompanies] = useState(false);
  const [salesTeam, setSalesTeam] = useState<any[]>([]);
  const [salesTeamLoading, setSalesTeamLoading] = useState(false);
  const [initialDataLoaded, setInitialDataLoaded] = useState(false);
  const companiesLoadSeq = useRef(0);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const dealsTabRef = useRef<{ exportCsv: () => void } | null>(null);
  const [lockHeight, setLockHeight] = useState<number | null>(null);


  // Load companies with pagination
  const loadCompanies = useCallback(async (searchQuery = '', startDoc: any = null, append = false, filterByUser = false, stateOverride?: string) => {
    if (!tenantId) return;
    
    const mySeq = ++companiesLoadSeq.current;
    setCompaniesLoading(true);
    try {
      const selectedState = stateOverride ?? companyLocationState;
      // Advanced filter: Companies with at least one location in selected state
      if (selectedState && selectedState !== 'all') {
        console.log('🔍 Companies state filter active:', { selectedState });
        
        // Query companies with locations subcollection matching the selected state
        const companiesRef = collection(db, 'tenants', tenantId, 'crm_companies');
        
        // Fast path using mirror collection: tenants/{tenantId}/company_locations
        const locationsRef = collection(db, 'tenants', tenantId, 'company_locations');
        const locQ = query(locationsRef, where('stateCode', '==', selectedState));
        const locSnap = await getDocs(locQ);
        const companyIdSet = new Set<string>();
        locSnap.docs.forEach(d => {
          const data: any = d.data();
          if (data?.companyId) companyIdSet.add(data.companyId);
        });

        const ids = Array.from(companyIdSet);

        // Fallback: if mirror has no entries for this state, scan company subcollections directly
        if (ids.length === 0) {
          // Map for full state names by code
          const STATE_BY_CODE: Record<string, string> = {
            AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming'
          };
          const code = selectedState;
          const full = STATE_BY_CODE[code] || code;
          const variants = [code, code.toLowerCase(), (full || '').toString(), (full || '').toString().toLowerCase(), (full || '').toString().toUpperCase()];

          const companiesRef = collection(db, 'tenants', tenantId, 'crm_companies');
          const allCompaniesQuery = query(companiesRef, orderBy('createdAt', 'desc'));
          const allCompaniesSnapshot = await getDocs(allCompaniesQuery);

          const validated: any[] = [];
          for (const companyDoc of allCompaniesSnapshot.docs) {
            try {
              const cData = companyDoc.data();
              const c = { id: companyDoc.id, ...cData } as any;
              const locRef = collection(db, 'tenants', tenantId, 'crm_companies', companyDoc.id, 'locations');
              let exists = false;
              try {
                const s1 = await getDocs(query(locRef, where('stateCode', '==', code), limit(1)));
                exists = !s1.empty;
              } catch {}
              if (!exists) {
                try {
                  const s2 = await getDocs(query(locRef, where('state', 'in', variants.slice(0, 10)), limit(1)));
                  exists = !s2.empty;
                } catch {}
              }
              if (!exists) {
                try {
                  const s3 = await getDocs(query(locRef, where('address.state', 'in', variants.slice(0, 10)), limit(1)));
                  exists = !s3.empty;
                } catch {}
              }
              if (exists) validated.push(c);
            } catch {}
          }

          const searchLower = searchQuery.trim().toLowerCase();
          const companiesData = validated.filter((company: any) => {
            if (filterByUser && currentUser?.uid) {
              const isAssociated = AssociationUtils.isCompanyAssociatedWithUser(company, currentUser.uid);
              if (!isAssociated) return false;
              if (process.env.NODE_ENV === 'development') {
                AssociationUtils.debugAssociation(company, currentUser.uid, 'company');
              }
            }
            if (!searchLower) return true;
            const companyName = (company.companyName || company.name || '').toLowerCase();
            const companyUrl = (company.companyUrl || company.url || '').toLowerCase();
            const city = (company.city || '').toLowerCase();
            const industry = (company.industry || '').toLowerCase();
            return companyName.includes(searchLower) || companyUrl.includes(searchLower) || city.includes(searchLower) || industry.includes(searchLower);
          });

          const resultData = companiesData;
          if (companiesLoadSeq.current !== mySeq) return;
          setCompanies(prev => append ? [...prev, ...resultData] : resultData);
          setCompaniesHasMore(false);
          setCompaniesLastDoc(null);
          setCompaniesLoading(false);
          return;
        }

        // Fetch matching companies then re-validate by checking subcollection (guards against stale mirror)
        const companyDocsRaw = await Promise.all(
          ids.map(async (cid) => {
            const ref = doc(db, 'tenants', tenantId, 'crm_companies', cid);
            const snap = await getDoc(ref);
            return snap.exists() ? { id: snap.id, ...snap.data() } : null;
          })
        );
        const companyDocs = (companyDocsRaw.filter(Boolean) as any[]);
        const validated: any[] = [];

        // Map for full state names by code
        const STATE_BY_CODE: Record<string, string> = {
          AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming'
        };
        const code = selectedState;
        const full = STATE_BY_CODE[code] || code;
        const variants = [code, code.toLowerCase(), (full || '').toString(), (full || '').toString().toLowerCase(), (full || '').toString().toUpperCase()];

        for (const c of companyDocs) {
          try {
            const locRef = collection(db, 'tenants', tenantId, 'crm_companies', c.id, 'locations');
            // Try normalized code first
            let exists = false;
            try {
              const s1 = await getDocs(query(locRef, where('stateCode', '==', code), limit(1)));
              exists = !s1.empty;
            } catch {}
            if (!exists) {
              // Fallback to various 'state' string variants
              try {
                const s2 = await getDocs(query(locRef, where('state', 'in', variants.slice(0, 10)), limit(1)));
                exists = !s2.empty;
              } catch {}
            }
            if (!exists) {
              try {
                const s3 = await getDocs(query(locRef, where('address.state', 'in', variants.slice(0, 10)), limit(1)));
                exists = !s3.empty;
              } catch {}
            }
            if (exists) validated.push(c);
          } catch {
            // skip if any unexpected error
          }
        }

        // Apply search and my filters client-side
        const searchLower = searchQuery.trim().toLowerCase();
        const companiesData = validated.filter((company: any) => {
          if (filterByUser && currentUser?.uid) {
            // Use the new unified association logic
            const isAssociated = AssociationUtils.isCompanyAssociatedWithUser(company, currentUser.uid);
            if (!isAssociated) return false;
            
            // Debug logging in development
            if (process.env.NODE_ENV === 'development') {
              AssociationUtils.debugAssociation(company, currentUser.uid, 'company');
            }
          }
          if (!searchLower) return true;
          const companyName = (company.companyName || company.name || '').toLowerCase();
          const companyUrl = (company.companyUrl || company.url || '').toLowerCase();
          const city = (company.city || '').toLowerCase();
          const industry = (company.industry || '').toLowerCase();
          return companyName.includes(searchLower) || companyUrl.includes(searchLower) || city.includes(searchLower) || industry.includes(searchLower);
        });

        // Note: we already validated via subcollection above; no further filtering needed here

        // When filtering by state, return full results (no pagination cap)
        const resultData = companiesData;
        // Apply results immediately for state-filtered load; avoid cancelling due to concurrent loads
        console.log(`✅ Applying ${resultData.length} companies for state ${code}`);
        setCompanies(prev => append ? [...prev, ...resultData] : resultData);
        setCompaniesHasMore(false);
        setCompaniesLastDoc(null);
        setCompaniesLoading(false);
        return;
      }

      const companiesRef = collection(db, 'tenants', tenantId, 'crm_companies');
      const constraints: any[] = [orderBy('createdAt', 'desc'), limit(companiesPageSize)];

      // If filtering by user associations, load ALL companies and filter client-side
      if (filterByUser && currentUser?.uid) {
        // Load ALL companies to ensure we find all user-associated companies
        const allCompaniesQuery = query(
          companiesRef,
          orderBy('createdAt', 'desc')
        );
        
        try {
          const allSnapshot = await getDocs(allCompaniesQuery);
          const allCompanies = allSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          
          // Filter companies using the new unified association logic
          const companiesData = allCompanies.filter((company: any) => {
            const isAssociated = AssociationUtils.isCompanyAssociatedWithUser(company, currentUser.uid);
            
            // Debug logging in development only
            if (process.env.NODE_ENV === 'development' && isAssociated) {
              AssociationUtils.debugAssociation(company, currentUser.uid, 'company');
            }
            
            return isAssociated;
          });
          
          // Apply pagination to the filtered results
          const limitedData = companiesData.slice(0, companiesPageSize);
          setCompanies(prev => append ? [...prev, ...limitedData] : limitedData);
          setCompaniesHasMore(companiesData.length > companiesPageSize);
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
      if (companiesLoadSeq.current === mySeq) setCompaniesLoading(false);
    }
  }, [tenantId, currentUser?.uid, companyLocationState]);

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
      if (process.env.NODE_ENV === 'development') {
        console.log('Loaded', companiesData.length, 'companies for autocomplete');
      }
    } catch (error) {
      console.error('Error loading all companies:', error);
      setAllCompanies([]);
    } finally {
      setLoadingAllCompanies(false);
    }
  };

  // Load sales team (workforce with crm_sales true)
  // Debounce sales team loading to prevent rapid successive calls
  const [lastSalesTeamLoadTime, setLastSalesTeamLoadTime] = useState(0);
  const SALES_TEAM_DEBOUNCE_DELAY = 10000; // 10 seconds debounce (longer since salespeople don't change often)

  const loadSalesTeam = async () => {
    if (!tenantId) return;
    
    // Debounce rapid load calls
    const now = Date.now();
    if (now - lastSalesTeamLoadTime < SALES_TEAM_DEBOUNCE_DELAY) {
      console.log('Skipping sales team load - too soon since last load');
      return;
    }
    setLastSalesTeamLoadTime(now);
    
    setSalesTeamLoading(true);
    try {
      // First, let's check if there are any workforce members at all
      const workforceRef = collection(db, 'tenants', tenantId, 'workforce');
      const allWorkforceSnapshot = await getDocs(workforceRef);
      if (process.env.NODE_ENV === 'development') {
        console.log(`🔍 Total workforce members in tenant ${tenantId}: ${allWorkforceSnapshot.docs.length}`);
        
        if (allWorkforceSnapshot.docs.length > 0) {
          console.log('🔍 Sample workforce member data:', allWorkforceSnapshot.docs[0].data());
        }
      }
      
      // Use Firebase Function to get salespeople with proper tenant filtering
      const getSalespeople = httpsCallable(functions, 'getSalespeopleForTenant');
      const params = { tenantId, activeTenantId: activeTenant?.id || tenantId };
      const result = await getSalespeople(params);
      const data = result.data as { salespeople: any[] };
      
      // Also try to get users with crm_sales enabled to ensure we have complete coverage
      // Only include users with securityLevel 5-7 and crm_sales: true
      let crmUsers: any[] = [];
      try {
        const usersRef = collection(db, 'users');
        const crmQuery = query(usersRef, where('crm_sales', '==', true));
        const usersSnapshot = await getDocs(crmQuery);
        crmUsers = usersSnapshot.docs
          .map(doc => ({ id: doc.id, ...doc.data() }))
          .filter((user: any) => {
            // Check if user is in this tenant
            const isInTenant = user.tenantIds && user.tenantIds[tenantId];
            if (!isInTenant) return false;
            
            // Check security level (5-7 only)
            const tenantSecLevel = user.tenantIds[tenantId]?.securityLevel;
            const globalSecLevel = user.securityLevel;
            const effectiveSecLevel = tenantSecLevel || globalSecLevel;
            const secLevelNum = typeof effectiveSecLevel === 'string' ? parseInt(effectiveSecLevel, 10) : effectiveSecLevel;
            
            return secLevelNum >= 5 && secLevelNum <= 7;
          });
      } catch (error) {
        console.warn('Could not load CRM users:', error);
      }
      
      // Combine salespeople from function with filtered CRM users, prioritizing function results
      const combinedTeam = [...(data.salespeople || [])];
      crmUsers.forEach(user => {
        if (!combinedTeam.find(sp => sp.id === user.id)) {
          combinedTeam.push(user);
        }
      });
      
      setSalesTeam(combinedTeam);
      if (process.env.NODE_ENV === 'development') {
        console.log('✅ Loaded', combinedTeam.length, 'total team members (salespeople + all users)');
      }
      
    } catch (error: any) {
      console.error('❌ Error loading sales team:', error);
      setSalesTeam([]);
    } finally {
      setSalesTeamLoading(false);
    }
  };

  // Load all user-associated data for dashboard metrics
  const loadUserAssociatedData = useCallback(async () => {
    if (!tenantId || !currentUser?.uid || initialDataLoaded) return;
    
    try {
      // Load all companies to calculate user associations
      const companiesRef = collection(db, 'tenants', tenantId, 'crm_companies');
      const allCompaniesQuery = query(companiesRef, orderBy('createdAt', 'desc'));
      const allCompaniesSnapshot = await getDocs(allCompaniesQuery);
      const allCompaniesData = allCompaniesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      
      // Load all contacts to calculate user associations
      const contactsRef = collection(db, 'tenants', tenantId, 'crm_contacts');
      const allContactsQuery = query(contactsRef, orderBy('createdAt', 'desc'));
      const allContactsSnapshot = await getDocs(allContactsQuery);
      const allContactsData = allContactsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      
      // Load all deals to calculate user associations
      const dealsRef = collection(db, 'tenants', tenantId, 'crm_deals');
      const allDealsQuery = query(dealsRef, orderBy('createdAt', 'desc'));
      const allDealsSnapshot = await getDocs(allDealsQuery);
      const allDealsData = allDealsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      
      // Update state with all data
      setAllCompanies(allCompaniesData);
      setAllDeals(allDealsData);
      setAllContacts(allContactsData); // Set all contacts for TasksDashboard
      
      // Mark initial data as loaded
      setInitialDataLoaded(true);
      
      if (process.env.NODE_ENV === 'development') {
        console.log('✅ Loaded initial data for dashboard metrics:', {
          companies: allCompaniesData.length,
          contacts: allContactsData.length,
          deals: allDealsData.length
        });
      }
    } catch (error) {
      console.error('❌ Error loading initial data for dashboard metrics:', error);
      setInitialDataLoaded(true); // Still mark as loaded to prevent infinite loading
    }
  }, [tenantId, currentUser?.uid, initialDataLoaded]);

  const loadLocations = async () => {
    if (!tenantId) return;
    
    try {
      const locationsRef = collection(db, 'tenants', tenantId, 'locations');
      const locationsSnapshot = await getDocs(locationsRef);
      const locationsData = locationsSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setLocations(locationsData);
    } catch (error) {
      console.error('Error loading locations:', error);
      setLocations([]);
    }
  };
  // Load contacts with pagination
  const loadContacts = useCallback(async (searchQuery = '', startDoc: any = null, append = false, filterByUser = false) => {
    if (!tenantId) return;
    
    setContactsLoading(true);
    try {
      const contactsRef = collection(db, 'tenants', tenantId, 'crm_contacts');
      // Load all contacts for client-side pagination (no limit, or use a very large limit)
      // Firestore max limit is 10,000, but we'll use a reasonable large number
      const constraints: any[] = [orderBy('createdAt', 'desc'), limit(1000)];

      // If a Contacts state filter is active, fetch by state from both direct contact.state AND associated company locations
      if (contactsStateFilter && contactsStateFilter !== 'all') {
        const STATE_BY_CODE: Record<string, string> = {
          AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming'
        };
        const code = contactsStateFilter;
        const full = STATE_BY_CODE[code] || code;
        console.log('🔍 Contacts state filter active:', { code, full, contactsStateFilter });
        
        // Step 1: Get contacts with direct state field matching
        const directStateQuery = query(
          contactsRef,
          where('state', 'in', [full, code]),
          orderBy('createdAt', 'desc')
        );
        const directStateSnapshot = await getDocs(directStateQuery);
        const directStateContacts = directStateSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as any[];
        
        console.log('🔍 Direct state query result:', { 
          stateFilter: contactsStateFilter, 
          queryStates: [full, code], 
          snapshotSize: directStateSnapshot.size,
          docs: directStateContacts.map(d => ({ id: d.id, state: d.state, name: d.fullName }))
        });
        
        // Step 2: Get companies with locations in the target state (optimized)
        const companiesRef = collection(db, 'tenants', tenantId, 'crm_companies');
        
        // Only query companies that have locations (much more efficient)
        const companiesWithLocationsQuery = query(
          companiesRef,
          where('locations', '!=', null)
        );
        const companiesWithLocationsSnapshot = await getDocs(companiesWithLocationsQuery);
        const companiesInState: string[] = [];
        
        console.log(`🔍 Optimized query: checking ${companiesWithLocationsSnapshot.docs.length} companies with locations (filtered from total companies)`);
        
        companiesWithLocationsSnapshot.docs.forEach(doc => {
          const company = doc.data();
          
          if (company.locations && Array.isArray(company.locations)) {
            const matchingLocations = company.locations.filter((location: any) => 
              location.state === code || location.state === full
            );
            
            if (matchingLocations.length > 0) {
              console.log('🎯 Found company with matching state:', {
                companyId: doc.id,
                companyName: company.companyName || company.name,
                targetState: code,
                matchingLocations: matchingLocations.map((loc: any) => ({ name: loc.name, state: loc.state }))
              });
              companiesInState.push(doc.id);
            }
          }
        });
        
        console.log('🔍 Companies with locations in state:', { 
          state: contactsStateFilter, 
          companiesFound: companiesInState.length,
          companyIds: companiesInState 
        });
        
        // Step 3: Get contacts associated with those companies
        let locationBasedContacts: any[] = [];
        if (companiesInState.length > 0) {
          // Load all contacts and filter client-side for company associations
          const allContactsQuery = query(contactsRef, orderBy('createdAt', 'desc'));
          const allContactsSnapshot = await getDocs(allContactsQuery);
          
          locationBasedContacts = allContactsSnapshot.docs
            .map(doc => ({ id: doc.id, ...doc.data() }))
            .filter((contact: any) => {
              // Debug each contact's structure
              console.log('🔍 Checking contact for location associations:', {
                id: contact.id,
                name: contact.fullName || contact.contactName,
                associations: contact.associations,
                hasCompaniesArray: !!contact.associations?.companies,
                companiesArray: contact.associations?.companies
              });
              
              if (!contact.associations?.companies) return false;
              const hasMatchingCompany = contact.associations.companies.some((companyId: string) => 
                companiesInState.includes(companyId)
              );
              
              if (hasMatchingCompany) {
                console.log('🎯 Found matching contact:', {
                  id: contact.id,
                  name: contact.fullName || contact.contactName,
                  matchingCompanies: contact.associations.companies.filter((id: string) => companiesInState.includes(id))
                });
              }
              
              return hasMatchingCompany;
            });
          
          console.log('🔍 Location-based contacts result:', { 
            contactsFound: locationBasedContacts.length,
            contacts: locationBasedContacts.map(c => ({ id: c.id, name: c.fullName || c.contactName, companies: c.associations?.companies }))
          });
        }
        
        // Step 4: Combine and deduplicate results
        const allMatchingContacts = [...directStateContacts];
        locationBasedContacts.forEach(contact => {
          if (!allMatchingContacts.find(existing => existing.id === contact.id)) {
            allMatchingContacts.push(contact);
          }
        });
        
        console.log('🔍 Combined state filter results:', { 
          directStateCount: directStateContacts.length,
          locationBasedCount: locationBasedContacts.length,
          totalUniqueCount: allMatchingContacts.length,
          finalContacts: allMatchingContacts.map(c => ({ id: c.id, name: c.fullName, state: c.state }))
        });
        
        setContacts(prev => append ? [...prev, ...allMatchingContacts] : allMatchingContacts);
        setContactsHasMore(false);
        setContactsLastDoc(null);
        setContactsLoading(false);
        return;
      }

      // If filtering by user associations, show contacts from "My Companies"
      if (filterByUser && currentUser?.uid) {
        console.log('Loading contacts from companies where user is in salespeople array:', currentUser.uid);
        
        // First, get all companies where user is in salespeople array
        const companiesRef = collection(db, 'tenants', tenantId, 'crm_companies');
        
        // Try direct query first
        const directQuery = query(
          companiesRef,
          where('associations.salespeople', 'array-contains', currentUser.uid)
        );
        
        const myCompaniesSnapshot = await getDocs(directQuery);
        let myCompanyIds = myCompaniesSnapshot.docs.map(doc => doc.id);
        
        console.log(`Found ${myCompanyIds.length} companies with direct user ID in salespeople array`);
        
        // If no results, try object-based query
        if (myCompanyIds.length === 0) {
          console.log('No direct matches for contacts, trying object-based query...');
          
          // Load all companies and filter client-side for object-based salespeople
          const allCompaniesQuery = query(
            companiesRef,
            orderBy('createdAt', 'desc'),
            limit(100)
          );
          
          const allSnapshot = await getDocs(allCompaniesQuery);
          const allCompanies = allSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          
          // Filter companies where user ID is in the 'id' field of any salespeople object
          const filteredCompanies = allCompanies.filter((company: any) => {
            if (!company.associations?.salespeople) return false;
            
            return company.associations.salespeople.some((salesperson: any) => {
              if (typeof salesperson === 'string') {
                return salesperson === currentUser.uid;
              } else if (salesperson && typeof salesperson === 'object') {
                return salesperson.id === currentUser.uid;
              }
              return false;
            });
          });
          
          myCompanyIds = filteredCompanies.map(company => company.id);
          console.log(`Found ${myCompanyIds.length} companies with user ID in salespeople object IDs`);
        }
        
        console.log(`Total companies where user is in salespeople array: ${myCompanyIds.length}`);
        
        if (myCompanyIds.length === 0) {
          // No companies found, set empty contacts
          setContacts(prev => append ? [...prev, ...[]] : []);
          setContactsLastDoc(null);
          setContactsHasMore(false);
          setContactsLoading(false);
          return;
        }
        
        // Then, load ALL contacts and filter client-side for association to those companies
        // Note: We avoid legacy companyId queries; associations.companies is the source of truth
        // Load all contacts for client-side pagination
        const q = query(contactsRef, orderBy('createdAt', 'desc'));
        const snapshot = await getDocs(q);
        const allCandidates = snapshot.docs.map(doc => ({ id: doc.id, ...(doc.data() as any) }));
        const filtered = allCandidates.filter((c: any) => {
          // Use the new unified association logic
          const isAssociated = AssociationUtils.isContactAssociatedWithUser(c, currentUser.uid, myCompanyIds);
          
          // Debug logging in development
          if (process.env.NODE_ENV === 'development' && isAssociated) {
            AssociationUtils.debugAssociation(c, currentUser.uid, 'contact');
          }
          
          return isAssociated;
        });
        // No need to slice - return all filtered contacts for client-side pagination
        setContacts(prev => append ? [...prev, ...filtered] : filtered);
        setContactsHasMore(false); // All contacts loaded
        setContactsLastDoc(null); // Not needed for client-side pagination
        
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
          
          // Filter client-side: multi-word search — every token must match at least one field
          const tokens = searchLower.split(/\s+/).filter(Boolean);
          const filteredData = contactsData.filter((contact: any) => {
            const fullName = (contact.fullName || contact.name || `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || '').toLowerCase();
            const firstName = (contact.firstName || '').toLowerCase();
            const lastName = (contact.lastName || '').toLowerCase();
            const email = (contact.email || '').toLowerCase();
            const title = (contact.title || contact.jobTitle || '').toLowerCase();
            const phone = (contact.phone || '').toLowerCase();
            return tokens.every(token =>
              fullName.includes(token) || firstName.includes(token) || lastName.includes(token) ||
              email.includes(token) || title.includes(token) || phone.includes(token)
            );
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
          
          // Return all filtered results for client-side pagination
          setContacts(prev => append ? [...prev, ...filteredData] : filteredData);
          // All search results loaded, no more to fetch
          setContactsHasMore(false);
        } else {
          if (!append) {
            setContacts([]);
          }
          setContactsHasMore(false);
        }
        
      } else {
        // No search query - load ALL contacts for client-side pagination
        // Since we now use frontend pagination, we need all data loaded
        const q = query(contactsRef, orderBy('createdAt', 'desc'));
        const snapshot = await getDocs(q);

        if (!snapshot.empty) {
          const contactsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as any[];
          
          setContacts(prev => append ? [...prev, ...contactsData] : contactsData);
          setContactsLastDoc(null); // Not needed for client-side pagination
          setContactsHasMore(false); // All contacts loaded, no more to fetch
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
  }, [tenantId, currentUser?.uid, contactsStateFilter]);

  const loadMoreContacts = () => {
    if (contactsHasMore && !contactsLoading) {
      loadContacts(search, contactsLastDoc, true);
    }
  };

  const loadDeals = async (searchQuery = '', startDoc: any = null, append = false, filterByUser = false) => {
    if (!tenantId) return;
    
    try {
      const dealsRef = collection(db, 'tenants', tenantId, 'crm_deals');
      
      // Always load all deals first to track total count
      const allDealsQuery = query(dealsRef, orderBy('createdAt', 'desc'));
      const allDealsSnapshot = await getDocs(allDealsQuery);
      const allDealsData = allDealsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setAllDeals(allDealsData);
      
      if (process.env.NODE_ENV === 'development') {
        console.log('🔍 Total deals in database:', allDealsData.length);
      }
      
      // If filtering by user associations, add user-specific constraints
      if (filterByUser && currentUser?.uid) {
        console.log('🔍 Loading deals associated with user via salespeople array:', currentUser.uid);
        console.log('🔍 Current user:', currentUser);
        
        // Try direct query first for deals
        const directQuery = query(
          dealsRef,
          where('associations.salespeople', 'array-contains', currentUser.uid),
          orderBy('createdAt', 'desc')
        );
        
        try {
          const snapshot = await getDocs(directQuery);
          let dealsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          
          console.log('🔍 Found', dealsData.length, 'deals with direct user ID in salespeople array');
          
          // If no results, try object-based query
          if (dealsData.length === 0) {
            console.log('🔍 No direct matches for deals, trying object-based query...');
            
            // Debug: Log a few deals to see their structure
            console.log('🔍 Sample deals structure:', allDealsData.slice(0, 3).map((deal: any) => ({
              id: deal.id,
              name: deal.name,
              associations: deal.associations,
              salespeople: deal.associations?.salespeople
            })));
            
            // Filter all deals using the new unified association logic
            dealsData = allDealsData.filter((deal: any) => {
              const isAssociated = AssociationUtils.isDealAssociatedWithUser(deal, currentUser.uid);
              
              if (isAssociated) {
                console.log('🔍 Deal', deal.id, 'is associated with current user');
                
                // Debug logging in development
                if (process.env.NODE_ENV === 'development') {
                  AssociationUtils.debugAssociation(deal, currentUser.uid, 'deal');
                }
              }
              
              return isAssociated;
            });
            
            console.log('🔍 Found', dealsData.length, 'deals with user ID in salespeople object IDs');
          }
          
          setDeals(prev => append ? [...prev, ...dealsData] : dealsData);
          
        } catch (error) {
          console.error('❌ Error loading user-associated deals:', error);
          // Fallback to loading all deals if query fails
          setDeals(prev => append ? [...prev, ...allDealsData] : allDealsData);
        }
        
        return;
      }

      // For non-filtered queries, use all deals
      setDeals(prev => append ? [...prev, ...allDealsData] : allDealsData);
      
    } catch (error) {
      console.error('❌ Error loading deals:', error);
    }
  };

  // Handle search changes
  const handleSearchChange = (newSearch: string) => {
    setSearch(newSearch);
    updateCacheState({ searchTerm: newSearch });
    // Reset pagination when search changes
    setCompaniesLastDoc(null);
    setCompaniesHasMore(true);
    setContactsLastDoc(null);
    setContactsHasMore(true);
  };

  // Restore cached state on component mount
  useEffect(() => {
    if (hasCachedState) {
      // Restore search term
      if (cacheState.searchTerm && cacheState.searchTerm !== search) {
        setSearch(cacheState.searchTerm);
      }
      
      // Restore filters
      if (cacheState.companyFilter !== companyFilter) {
        setCompanyFilter(cacheState.companyFilter);
      }
      if (cacheState.contactFilter !== contactFilter) {
        setContactFilter(cacheState.contactFilter);
      }
      if (cacheState.dealFilter !== dealFilter) {
        setDealFilter(cacheState.dealFilter);
      }
      
      // Restore active tab - only if we have meaningful cached state and not during user tab changes
      if (cacheState.activeTab !== tabValue && hasCachedState && !isUserTabChange) {
        console.log('🔄 Restoring tab from cache:', { cachedTab: cacheState.activeTab, currentTab: tabValue });
        setTabValue(cacheState.activeTab);
      } else if (isUserTabChange) {
        console.log('🔄 Skipping cache tab restoration - user tab change in progress');
      }
    }
  }, [hasCachedState, isUserTabChange]); // Run when hasCachedState changes

  // Debounced search effect
  useEffect(() => {
    if (isUserTabChange || isLockingTabRef.current) {
      console.log('🔄 Skipping debounced loads - user tab/state change in progress');
      return;
    }
    const timeoutId = setTimeout(() => {
      loadCompanies(search);
      loadContacts(search);
    }, 300);
    
    return () => clearTimeout(timeoutId);
  }, [search, tenantId, loadCompanies, loadContacts, isUserTabChange]);

  // Reload contacts immediately when the Contacts state filter changes
  useEffect(() => {
    // Contacts tab was removed from CRM; only keep this for deprecated standalone contacts mode.
    if (standaloneTab !== 'contacts') return;
    console.log('🔄 Contacts state filter changed, reloading contacts:', { 
      contactsStateFilter, 
      contactFilter,
      willCallLoadContacts: true 
    });
    loadContacts('', null, false, contactFilter === 'my');
  }, [contactsStateFilter, loadContacts, contactFilter]);

  // Handle URL parameter changes (for browser back/forward navigation)
  useEffect(() => {
    console.log('🔄 URL parameter useEffect triggered:', { 
      isUserTabChange, 
      currentTabValue: tabValue,
      searchParams: Object.fromEntries(searchParams.entries())
    });
    
    // Skip if we're in the middle of a user-initiated tab change
    if (isUserTabChange || isLockingTabRef.current) {
      console.log('🔄 Skipping URL parameter handling - user tab change in progress');
      return;
    }
    
    const tabParam = searchParams.get('tab');
    const companyStateParam = searchParams.get('companyState');
    
    if (tabParam && !didRestoreTabFromCacheRef.current) {
      const tabMap: Record<string, number> = {
        // CRM tab buttons now only show Opportunities + Pipeline + Archive.
        // Hidden tabs map to Opportunities to avoid landing users on hidden views.
        'dashboard': 1,
        'opportunities': 1,
        'pipeline': 2,
        'archive': 3,
        'prospect': 1,
        'activity': 1,
        'reports': 9,
        'kpi-management': 7,
        'kpi-dashboard': 8,
      };
      const newTabValue = tabMap[tabParam] ?? 1;
      if (newTabValue !== tabValue) {
        setTabValue(newTabValue);
        updateCacheState({ activeTab: newTabValue });
        didRestoreTabFromCacheRef.current = true;
      }
      
      // Handle company state parameter - DISABLED to prevent override conflicts
      // if (newTabValue === 2 && companyStateParam && companyStateParam !== companyLocationState) {
      //   console.log('🔄 Setting company state from URL:', companyStateParam);
      //   setCompanyLocationState(companyStateParam);
      // }
      
      // Handle contacts state parameter - DISABLED to prevent override conflicts
      const contactStateParam = searchParams.get('contactState');
      // if (newTabValue === 1 && contactStateParam && contactStateParam !== contactsStateFilter) {
      //   console.log('🔄 Setting contact state from URL:', contactStateParam);
      //   setContactsStateFilter(contactStateParam);
      // }
    }
  }, [searchParams, isUserTabChange, companyLocationState, contactsStateFilter, updateCacheState]);

  // Sync Companies state filter into URL when Companies tab is active (deprecated standalone mode only)
  useEffect(() => {
    if (standaloneTab !== 'companies') return;
    // Skip during user tab changes to prevent interference
    if (isUserTabChange) {
      console.log('🔄 Skipping Companies state URL sync - user tab change in progress');
      return;
    }

    const params = new URLSearchParams(searchParams);
    if (companyLocationState && companyLocationState !== 'all') {
      params.set('companyState', companyLocationState);
    } else {
      params.delete('companyState');
    }
    setSearchParams(params);
  }, [companyLocationState, tabValue, isUserTabChange, searchParams]);

  // Sync Contacts state filter into URL when Contacts tab is active (deprecated standalone mode only)
  useEffect(() => {
    if (standaloneTab !== 'contacts') return;
    // Skip during user tab changes to prevent interference
    if (isUserTabChange) {
      console.log('🔄 Skipping Contacts state URL sync - user tab change in progress');
      return;
    }

    const params = new URLSearchParams(searchParams);
    if (contactsStateFilter && contactsStateFilter !== 'all') {
      params.set('contactState', contactsStateFilter);
    } else {
      params.delete('contactState');
    }
    setSearchParams(params);
  }, [contactsStateFilter, tabValue, isUserTabChange, searchParams]);

  // Load initial data for dashboard metrics
  useEffect(() => {
    if (tenantId && currentUser?.uid) {
      loadUserAssociatedData();
    }
  }, [tenantId, currentUser?.uid, loadUserAssociatedData]);

  // Real-time listeners for CRM data
  useEffect(() => {
    if (!tenantId) {
      return;
    }

    // When on Prospecting tab, skip real-time listeners to avoid unnecessary reads
    // Note: Archive is tabValue === 3; Prospecting is tabValue === 4.
    if (tabValue === 4) {
      return;
    }

    if (tenantId) {
      if (isUserTabChange) {
        console.log('🔄 Skipping initial loads - user tab/state change in progress');
        return;
      }
      // Load data based on current filter states
      loadCompanies('', null, false, companyFilter === 'my');
      loadContacts('', null, false, contactFilter === 'my');
      loadDeals('', null, false, dealFilter === 'my');
      loadAllCompanies(); // Load all companies for autocomplete
      loadSalesTeam(); // Load sales team
      loadLocations(); // Load locations for contact location display
    }

    // Listen for deals
    const dealsRef = collection(db, 'tenants', tenantId, 'crm_deals');
    const dealsUnsubscribe = onSnapshot(dealsRef, (snapshot) => {
      const dealsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setDeals(dealsData);
      setAllDeals(dealsData); // Also update allDeals for metrics calculation
    }, (error) => {
      console.error('Error listening to deals:', error);
      // Set empty data on error to prevent UI issues
      setDeals([]);
      setAllDeals([]);
    });

    // Listen for pipeline stages
    const stagesRef = collection(db, 'tenants', tenantId, 'crm_pipeline_stages');
    const stagesUnsubscribe = onSnapshot(
      stagesRef,
      (snapshot) => {
        const stagesData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));
        setPipelineStages(stagesData.sort((a: any, b: any) => (a.order || 0) - (b.order || 0)));
      },
      (error) => {
        console.error('Error listening to pipeline stages:', error);
        setPipelineStages([]);
      }
    );

    // Listen for tasks from both collections
    const crmTasksRef = collection(db, 'tenants', tenantId, 'crm_tasks');
    const tasksRef = collection(db, 'tenants', tenantId, 'tasks');
    
    // Listen for CRM tasks
    const crmTasksUnsubscribe = onSnapshot(
      crmTasksRef,
      (snapshot) => {
        const crmTasksData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));
        // Filter CRM tasks to show only those assigned to the current user
        const userCrmTasks = crmTasksData.filter((task: any) => {
          // Show tasks assigned to the current user
          if (task.assignedTo === currentUser?.uid) {
            return true;
          }
          // Show tasks associated with deals owned by the current user
          if (task.relatedTo?.type === 'deal' && task.relatedTo?.id) {
            const deal = deals.find(d => d.id === task.relatedTo.id);
            if (deal && deal.owner === currentUser?.uid) {
              return true;
            }
          }
          return false;
        });
        
        // Store CRM tasks in state and update combined tasks
        setCrmTasks(userCrmTasks);
        setTasks([...userCrmTasks, ...regularTasks]);
      },
      (error) => {
        console.error('Error listening to CRM tasks:', error);
        setCrmTasks([]);
        setTasks([...regularTasks]);
      }
    );
    
    // Listen for regular tasks
    const tasksUnsubscribe = onSnapshot(
      tasksRef,
      (snapshot) => {
        const tasksData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));
        // Filter tasks to show only those assigned to the current user
        const userTasks = tasksData.filter((task: any) => task.assignedTo === currentUser?.uid);
        
        // Store regular tasks in state and update combined tasks
        setRegularTasks(userTasks);
        setTasks([...crmTasks, ...userTasks]);
      },
      (error) => {
        console.error('Error listening to regular tasks:', error);
        setRegularTasks([]);
      }
    );

    return () => {
      dealsUnsubscribe();
      stagesUnsubscribe();
      crmTasksUnsubscribe();
      tasksUnsubscribe();
    };
  }, [tenantId, companyFilter, contactFilter, dealFilter, tabValue]); // include tabValue to refresh/cleanup when switching tabs

  // Remove the separate useEffects for filter changes - they're now handled in the main useEffect above

  const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
    if (standaloneTab) return;
    console.log('🔄 handleTabChange called:', { newValue, currentTabValue: tabValue, isUserTabChange });
    
    // Lock current content height to prevent layout flash between tabs
    try {
      if (contentRef.current) {
        const rect = contentRef.current.getBoundingClientRect();
        setLockHeight(rect.height);
      }
    } catch {}

    console.log('🔄 Setting tabValue to:', newValue);
    setTabValue(newValue);
    updateCacheState({ activeTab: newValue });
    console.log('🔄 Updated cache state with activeTab:', newValue);
    
    // Set flag to prevent URL-based override and update URL in next tick
    setIsUserTabChange(true);
    console.log('🔄 Set isUserTabChange to true');
    
    // Update URL in the next tick to ensure isUserTabChange is set first
    setTimeout(() => {
      const tabMap: Record<number, string> = {
        // CRM tab buttons now only show Opportunities + Pipeline + Archive.
        1: 'opportunities',
        2: 'pipeline',
        3: 'archive',
        9: 'reports',
        7: 'kpi-management',
        8: 'kpi-dashboard'
      };
      
      const tabName = tabMap[newValue];
      if (tabName) {
        const newSearchParams = new URLSearchParams(searchParams);
        newSearchParams.set('tab', tabName);
        // Clean up deprecated tab-specific state parameters
        newSearchParams.delete('companyState');
        newSearchParams.delete('contactState');
        
        navigate(`?${newSearchParams.toString()}`, { replace: true });
      }
      
      // Clear the flag after URL update (longer delay to prevent race conditions)
      setTimeout(() => {
        console.log('🔄 Clearing isUserTabChange flag');
        setIsUserTabChange(false);
      }, 500);
    }, 0);
  };
  // Release height lock after initial paint of the new tab
  useEffect(() => {
    if (lockHeight == null) return;
    const t = setTimeout(() => setLockHeight(null), 200);
    return () => clearTimeout(t);
  }, [tabValue, companiesLoading, contactsLoading]);

  const handleAddNew = (type: 'contact' | 'company' | 'deal' | 'task') => {
    setDialogType(type);
    setShowAddDialog(true);
  };

  const handleCompanyFilterChange = (newFilter: 'all' | 'my') => {
    setCompanyFilter(newFilter);
    updateCacheState({ companyFilter: newFilter });
    // The useEffect will handle reloading companies with the new filter
  };
  const handleCompanyLocationStateChange = (newState: string) => {
    console.log('🔄 handleCompanyLocationStateChange called:', { newState, currentState: companyLocationState });
    
    // Set flag to prevent URL-based overrides
    setIsUserTabChange(true);
    isLockingTabRef.current = true;
    
    setCompanyLocationState(newState);
    updateCacheState({ companiesStateFilter: newState });
    
    // Immediately reflect loading state in UI
    setCompanies([]);
    setCompaniesHasMore(true);
    setCompaniesLastDoc(null);
    setCompaniesLoading(true);
    setCompanyPins([]);
    
    if (newState !== 'all') {
      setInfoMessage(`Filtering companies by state: ${newState}`);
      setInfoOpen(true);
    }
    
    // Update URL with new state filter
    const searchParams = new URLSearchParams(window.location.search);
    if (newState === 'all') {
      searchParams.delete('companyState');
    } else {
      searchParams.set('companyState', newState);
    }
    
    // Update URL without triggering navigation
    const newUrl = `${window.location.pathname}?${searchParams.toString()}`;
    window.history.replaceState(null, '', newUrl);
    
    // Reload companies using current ownership filter. Delay slightly to let isUserTabChange suppress other effects
    setTimeout(() => {
      loadCompanies('', null, false, companyFilter === 'my', newState);
    }, 50);
    
    // Clear the flag after a delay to allow the change to process
    setTimeout(() => {
      setIsUserTabChange(false);
      isLockingTabRef.current = false;
    }, 600);
  };

  const handleContactFilterChange = (newFilter: 'all' | 'my') => {
    setContactFilter(newFilter);
    updateCacheState({ contactFilter: newFilter });
    // The useEffect will handle reloading contacts with the new filter
  };

  const handleDealFilterChange = (newFilter: 'all' | 'my') => {
    setDealFilter(newFilter);
    updateCacheState({ dealFilter: newFilter });
    // The useEffect will handle reloading deals with the new filter
  };



  const handleCloseDialog = () => {
    setShowAddDialog(false);
    // Reset contact form and locations when dialog closes
    setContactForm({
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      jobTitle: '',
      companyId: '',
      companyName: '',
      linkedinUrl: '',
      locationId: '',
      contactType: 'Unknown',
      tags: [] as string[],
      isActive: true,
      notes: ''
    });
    setCompanyLocations([]);
  };

  const handleContactFormChange = (field: string, value: string | boolean | string[]) => {
    setContactForm(prev => ({ ...prev, [field]: value }));
  };

  // Load company locations when company is selected
  const loadCompanyLocationsForContact = async (companyId: string) => {
    if (!companyId || !tenantId) {
      setCompanyLocations([]);
      setContactForm(prev => ({ ...prev, locationId: '' }));
      return;
    }
    
    setLoadingCompanyLocations(true);
    try {
      const locationsRef = collection(db, 'tenants', tenantId, 'crm_companies', companyId, 'locations');
      const locationsSnapshot = await getDocs(locationsRef);
      const locationsData = locationsSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setCompanyLocations(locationsData);
      // Clear location selection when company changes
      setContactForm(prev => ({ ...prev, locationId: '' }));
    } catch (error) {
      console.error('Error loading company locations:', error);
      setCompanyLocations([]);
    } finally {
      setLoadingCompanyLocations(false);
    }
  };

  const handleTagsChange = (newTags: string[]) => {
    setContactForm(prev => ({ ...prev, tags: newTags }));
  };

  const handleCompanyFormChange = (field: string, value: string) => {
    setCompanyForm(prev => ({ ...prev, [field]: value }));
  };



  const handleSaveContact = async () => {
    if (!contactForm.firstName || !contactForm.lastName) {
      setError('First name and last name are required');
      return;
    }

    setSavingContact(true);
    try {
      const contactsRef = collection(db, 'tenants', tenantId, 'crm_contacts');
      const emailTrimmed = (contactForm.email || '').trim();
      if (emailTrimmed && tenantId) {
        const q = query(contactsRef, where('email', '==', emailTrimmed));
        const existingSnap = await getDocs(q);
        if (!existingSnap.empty) {
          const existing = existingSnap.docs[0].data();
          const name = existing.fullName || [existing.firstName, existing.lastName].filter(Boolean).join(' ') || 'Another contact';
          setError(`A contact with this email already exists in the system: ${name}. Please search for them or use a different email.`);
          setSavingContact(false);
          return;
        }
      }

      const associations: any = {};
      if (contactForm.companyId) associations.companies = [contactForm.companyId];
      
      // Handle location associations (same format as ContactDetails)
      let locationId = '';
      let locationName = '';
      if (contactForm.locationId) {
        const selectedLocation = companyLocations.find(loc => loc.id === contactForm.locationId);
        if (selectedLocation) {
          // Save in associations.locations array (supports multiple locations)
          associations.locations = [contactForm.locationId];
          // Also save in legacy format for backward compatibility
          locationId = contactForm.locationId;
          locationName = selectedLocation.name || selectedLocation.nickname || selectedLocation.title || 'Unknown Location';
        }
      }
      
      const contactData = {
        firstName: contactForm.firstName,
        lastName: contactForm.lastName,
        fullName: `${contactForm.firstName} ${contactForm.lastName}`,
        email: contactForm.email,
        phone: contactForm.phone,
        jobTitle: contactForm.jobTitle,
        linkedinUrl: contactForm.linkedinUrl,
        locationId, // Legacy format - first location
        locationName, // Legacy format - first location name
        contactType: contactForm.contactType,
        tags: contactForm.tags,
        isActive: contactForm.isActive,
        notes: contactForm.notes,
        // Set companyId and companyName directly for queries (CompanyDetails queries by companyId)
        companyId: contactForm.companyId || null,
        companyName: contactForm.companyName || null,
        associations,
        tenantId,
        pipelineStage: 'contact',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        salesOwnerId: currentUser?.uid || null,
        accountOwnerId: currentUser?.uid || null
      } as any;

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
        locationId: '',
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

  const handleSaveCompany = async () => {
    if (!companyForm.name) {
      setError('Company name is required');
      return;
    }

    setSavingCompany(true);
    try {
      const { parentCompany, ...rest } = companyForm as any;
      const companyData = {
        ...rest,
        companyName: companyForm.name || rest.name || '', // Required for /companies search (orderBy companyName)
        tenantId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        // Add the current user as an associated salesperson
        associations: {
          salespeople: [currentUser?.uid]
        },
        parentCompany: parentCompany || null,
        // Legacy fields for backward compatibility
        salesOwnerId: currentUser?.uid || null,
        accountOwnerId: currentUser?.uid || null,
        salesOwnerName: currentUser?.displayName || currentUser?.email || 'Unknown',
        accountOwnerName: currentUser?.displayName || currentUser?.email || 'Unknown'
      };

      const companiesRef = collection(db, 'tenants', tenantId, 'crm_companies');
      const newDocRef = await addDoc(companiesRef, companyData);
      const newCompanyId = newDocRef.id;

      // If parent company selected, call function to register child on parent
      if (parentCompany) {
        try {
          const fn = httpsCallable(getFunctions(), 'registerChildCompany');
          await fn({ tenantId, parentCompanyId: parentCompany, childCompanyId: newCompanyId });
        } catch (e) {
          console.warn('registerChildCompany failed', e);
        }
      }

      // Reset form and close dialog
      setCompanyForm({ name: '', website: '', industry: '', source: '', notes: '', parentCompany: '' });
      setShowAddDialog(false);
      setSuccess(true);
      setSuccessMessage('Company added successfully!');
      
      // Reload companies
      loadCompanies();
    } catch (err: any) {
      console.error('Error adding company:', err);
      setError(err.message || 'Failed to add company');
    } finally {
      setSavingCompany(false);
    }
  };

  const handleUpdatePipelineTotals = async (companyId: string) => {
    try {
      const functions = getFunctions();
      const updatePipelineTotals = httpsCallable(functions, 'updateCompanyPipelineTotals');
      
      await updatePipelineTotals({ tenantId, companyId });
      
      // Refresh companies data to show updated totals
      await loadCompanies();
      
      console.log(`✅ Updated pipeline totals for company ${companyId}`);
    } catch (error) {
      console.error('❌ Error updating pipeline totals:', error);
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
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      <Box sx={{ position: 'sticky', top: 0, zIndex: 20, backgroundColor: 'background.default' }}>
        <PageHeader
          hideHeading
          dense
          title=""
          filters={
            standaloneTab
              ? undefined
              : (
              <Box 
                display="flex" 
                gap={0.35} 
                sx={{ 
                  flexWrap: 'nowrap', 
                  alignItems: 'center',
                  overflowX: 'auto', 
                  overflowY: 'hidden', 
                  WebkitOverflowScrolling: 'touch', 
                  scrollbarWidth: 'thin',
                  '&::-webkit-scrollbar': { height: '6px' },
                  '&::-webkit-scrollbar-track': { 
                    background: 'rgba(0, 0, 0, 0.02)', 
                    borderRadius: '4px' 
                  },
                  '&::-webkit-scrollbar-thumb': { 
                    background: 'rgba(0, 0, 0, 0.15)', 
                    borderRadius: '4px',
                    '&:hover': { background: 'rgba(0, 0, 0, 0.25)' }
                  }
                }}
              >
                {[
                  { label: 'Opportunities', value: 1, icon: <DealIcon fontSize="small" /> },
                  { label: 'Pipeline', value: 2, icon: <PipelineIcon fontSize="small" /> },
                  { label: 'Archive', value: 3, icon: <ArchiveIcon fontSize="small" /> },
                ].map((t) => {
                  const isActive = tabValue === t.value;
                  return (
                    <Button
                      key={t.value}
                      startIcon={t.icon}
                      onClick={() => handleTabChange({} as any, t.value)}
                      variant="text"
                      sx={{
                        textTransform: 'none',
                        borderRadius: '999px',
                        fontSize: '13px',
                        fontWeight: isActive ? 600 : 400,
                        color: isActive ? 'white' : 'rgba(0, 0, 0, 0.7)',
                        bgcolor: isActive ? '#0057B8' : 'rgba(0, 0, 0, 0.04)',
                        px: 1.25,
                        py: 0.5,
                        minHeight: 30,
                        minWidth: 'auto',
                        whiteSpace: 'nowrap',
                        '& .MuiButton-startIcon': {
                          mr: 0.35,
                          '& svg': { fontSize: 16 },
                        },
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
            )
          }
        rightActions={
          standaloneTab === 'contacts' ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexShrink: 0 }}>
              <FavoritesFilter
                favoriteType="contacts"
                showFavoritesOnly={contactsShowFavoritesOnly}
                onToggle={setContactsShowFavoritesOnly}
                showText={false}
                size="small"
                sx={{
                  minWidth: '32px',
                  width: '32px',
                  height: '32px',
                  borderRadius: '50%',
                  '&:hover': {
                    backgroundColor: contactsShowFavoritesOnly ? 'primary.dark' : 'action.hover',
                  },
                }}
              />
              <InboxSearchBar
                value={search}
                onChange={setSearch}
                onSearch={setSearch}
                placeholder="Search contacts..."
              />
              <Button
                variant="contained"
                startIcon={<AddIcon sx={{ fontSize: 16 }} />}
                onClick={() => handleAddNew('contact')}
                sx={{
                  textTransform: 'none',
                  borderRadius: '999px',
                  px: 1.5,
                  py: 0.5,
                  minHeight: 30,
                  height: 30,
                  fontWeight: 600,
                  fontSize: '13px',
                  bgcolor: '#0057B8',
                  boxShadow: 'none',
                  '& .MuiButton-startIcon': { mr: 0.35 },
                  '&:hover': {
                    bgcolor: '#004a9f',
                    boxShadow: '0 2px 8px rgba(0, 87, 184, 0.25)',
                  },
                  whiteSpace: 'nowrap',
                }}
              >
                Add Contact
              </Button>
            </Box>
          ) : (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }} data-testid="crm-header-actions">
              {(tabValue === 1 || tabValue === 3) && (
                <InboxSearchBar
                  value={search}
                  onChange={setSearch}
                  onSearch={setSearch}
                  placeholder={tabValue === 3 ? "Search archived opportunities..." : "Search opportunities..."}
                />
              )}
              {tabValue === 1 && (
                <Button
                  variant="contained"
                  startIcon={<AddIcon sx={{ fontSize: 16 }} />}
                  onClick={() => {
                    setOpportunityDialogOpen(true);
                  }}
                  sx={{
                    textTransform: 'none',
                    borderRadius: '999px',
                    px: 1.5,
                    py: 0.5,
                    minHeight: 30,
                    height: 30,
                    fontWeight: 600,
                    fontSize: '13px',
                    bgcolor: '#0057B8',
                    boxShadow: 'none',
                    '& .MuiButton-startIcon': { mr: 0.35 },
                    '&:hover': {
                      bgcolor: '#004a9f',
                      boxShadow: '0 2px 8px rgba(0, 87, 184, 0.25)',
                    },
                    whiteSpace: 'nowrap',
                  }}
                >
                  Add Opportunity
                </Button>
              )}
            </Box>
          )
        }
      />
      </Box>

      {/* Tab Panels */}
      <Box
        ref={contentRef}
        sx={{
          flex: 1,
          minHeight: lockHeight ? `${Math.max(200, lockHeight)}px` : 0,
          overflowY: 'auto',
          overflowX: 'hidden',
          pb: 2,
          // Inbox-standard lighter, thinner scrollbar
          '&::-webkit-scrollbar': {
            width: '8px',
            height: '8px',
          },
          '&::-webkit-scrollbar-track': {
            background: 'rgba(0, 0, 0, 0.02)',
            borderRadius: '4px',
          },
          '&::-webkit-scrollbar-thumb': {
            background: 'rgba(0, 0, 0, 0.15)',
            borderRadius: '4px',
            '&:hover': {
              background: 'rgba(0, 0, 0, 0.25)',
            },
          },
          scrollbarWidth: 'thin',
          scrollbarColor: 'rgba(0, 0, 0, 0.15) rgba(0, 0, 0, 0.02)',
        }}
      >
      {tabValue === 0 && (
        <Box sx={{ px: 2, pt: 2 }}>
          <SalesDashboard 
            tenantId={tenantId}
            currentUser={currentUser}
            deals={deals}
            companies={companies}
            contacts={contacts}
            tasks={tasks}
            pipelineStages={pipelineStages}
            allCompanies={allCompanies}
            allDeals={allDeals}
            initialDataLoaded={initialDataLoaded}
          />
        </Box>
      )}
      
      {tabValue === 1 && (
        <Box data-testid="deals-panel">
          <DealsTab
            ref={dealsTabRef}
            deals={deals}
            allDeals={allDeals}
            companies={companies}
            allCompanies={allCompanies}
            loadingAllCompanies={loadingAllCompanies}
            contacts={contacts}
            pipelineStages={pipelineStages}
            search={search}
            onSearchChange={setSearch}
            onAddNew={() => setOpportunityDialogOpen(true)}
            dealFilter={dealFilter}
            onDealFilterChange={handleDealFilterChange}
            currentUser={currentUser}
            salesTeam={salesTeam}
            tenantId={tenantId}
            opportunityDialogOpen={opportunityDialogOpen}
            onOpportunityDialogOpenChange={setOpportunityDialogOpen}
            scrollContainerRef={contentRef}
          />
        </Box>
      )}
      
      {tabValue === 2 && (
        <Box sx={{ px: 2, pb: 2 }}>
          <PipelineTab 
            deals={deals}
            companies={companies}
            pipelineStages={pipelineStages}
            salesTeam={salesTeam}
            currentUser={currentUser}
            filters={{...filters, currentUserId: currentUser?.uid}}
            onFiltersChange={setFilters}
          />
        </Box>
      )}
      
      {tabValue === 3 && (
        <Box data-testid="archive-panel">
          <DealsTab
            ref={dealsTabRef}
            deals={deals}
            allDeals={allDeals}
            companies={companies}
            allCompanies={allCompanies}
            loadingAllCompanies={loadingAllCompanies}
            contacts={contacts}
            pipelineStages={pipelineStages}
            search={search}
            onSearchChange={setSearch}
            onAddNew={() => setOpportunityDialogOpen(true)}
            dealFilter={dealFilter}
            onDealFilterChange={handleDealFilterChange}
            currentUser={currentUser}
            salesTeam={salesTeam}
            tenantId={tenantId}
            opportunityDialogOpen={opportunityDialogOpen}
            onOpportunityDialogOpenChange={setOpportunityDialogOpen}
            scrollContainerRef={contentRef}
            showArchived={true}
          />
        </Box>
      )}
      
      {tabValue === 4 && (
        <ProspectingHub />
      )}
      
      {tabValue === 4 && (
        <SalespersonActivityView
          tenantId={tenantId}
          salespersonId={currentUser?.uid || ''}
          salespersonName={currentUser?.displayName || 'Current User'}
          salespersonEmail={currentUser?.email || ''}
          salesTeam={salesTeam}
        />
      )}
      
      {tabValue === 9 && (
        <ReportsTab 
          deals={deals}
          companies={companies}
          contacts={contacts}
        />
      )}
      
      {tabValue === 7 && (
        <KPIManagement tenantId={tenantId} />
      )}
      
      {tabValue === 8 && (
        <KPIDashboard tenantId={tenantId} salespersonId={currentUser?.uid || ''} />
      )}
      </Box>

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
                      key={`${option}-${index}`}
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
                onChange={async (event, newValue) => {
                  handleContactFormChange('companyId', newValue?.id || '');
                  handleContactFormChange('companyName', newValue?.companyName || newValue?.name || '');
                  // Load locations for the selected company
                  if (newValue?.id) {
                    await loadCompanyLocationsForContact(newValue.id);
                  } else {
                    setCompanyLocations([]);
                    handleContactFormChange('locationId', '');
                  }
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
                <InputLabel>Location</InputLabel>
                <Select
                  value={contactForm.locationId}
                  label="Location"
                  onChange={(e) => handleContactFormChange('locationId', e.target.value)}
                  disabled={!contactForm.companyId || loadingCompanyLocations || companyLocations.length === 0}
                >
                  {companyLocations.length === 0 && contactForm.companyId ? (
                    <MenuItem value="" disabled>
                      {loadingCompanyLocations ? 'Loading locations...' : 'No locations found'}
                    </MenuItem>
                  ) : (
                    <MenuItem value="">None</MenuItem>
                  )}
                  {companyLocations.map((location) => (
                    <MenuItem key={location.id} value={location.id}>
                      {location.nickname || location.name || location.title || 'Unnamed Location'}
                    </MenuItem>
                  ))}
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

      {/* Add Company Dialog */}
      <Dialog open={showAddDialog && dialogType === 'company'} onClose={handleCloseDialog} maxWidth="md" fullWidth>
        <DialogTitle>Add New Company</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Company Name"
                value={companyForm.name}
                onChange={(e) => handleCompanyFormChange('name', e.target.value)}
                required
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Website"
                value={companyForm.website}
                onChange={(e) => handleCompanyFormChange('website', e.target.value)}
                placeholder="https://example.com"
              />
            </Grid>
            {/* Removed Industry, Lead Source, and Notes */}
            <Grid item xs={12}>
              <Autocomplete
                options={allCompanies}
                getOptionLabel={(option) => option.companyName || option.name || ''}
                value={allCompanies.find((c) => c.id === companyForm.parentCompany) || null}
                onChange={(event, newValue) => {
                  handleCompanyFormChange('parentCompany', newValue?.id || '');
                }}
                loading={loadingAllCompanies}
                isOptionEqualToValue={(option, value) => option.id === value.id}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Parent Company"
                    placeholder="Select a parent company (optional)"
                  />
                )}
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDialog} disabled={savingCompany}>
            Cancel
          </Button>
          <Button 
            onClick={handleSaveCompany} 
            variant="contained" 
            disabled={savingCompany || !companyForm.name}
          >
            {savingCompany ? <CircularProgress size={20} /> : 'Save Company'}
          </Button>
        </DialogActions>
      </Dialog>

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
      case 'contact': {
        const contact = contacts.find(c => c.id === relatedTo.id);
        return contact?.fullName || '';
      }
      case 'company': {
        const company = companies.find(c => c.id === relatedTo.id);
        return company?.companyName || '';
      }
      case 'deal': {
        const deal = deals.find(d => d.id === relatedTo.id);
        return deal?.title || '';
      }
      default:
        return '';
    }
  };

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Typography variant="h6">Tasks ({filteredTasks.length})</Typography>
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
        <Table sx={{ minWidth: 1200 }}>
          <TableHead>
            <TableRow sx={{ backgroundColor: '#F9FAFB' }}>
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
                      {new Date(task.dueDate + 'T00:00:00').toLocaleDateString()}
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
  locations: any[];
  search: string;
  onSearchChange: (value: string) => void;
  onAddNew: () => void;
  loading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  contactFilter: 'all' | 'my';
  onContactFilterChange: (newFilter: 'all' | 'my') => void;
  locationStateFilter: string;
  showFavoritesOnly: boolean;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  onLocationStateFilterChange: (newFilter: string) => void;
}> = ({ contacts, companies, locations, search, onSearchChange, onAddNew, loading, hasMore, onLoadMore, contactFilter, onContactFilterChange, locationStateFilter, showFavoritesOnly, scrollContainerRef, onLocationStateFilterChange }) => {
  const navigate = useNavigate();
  const { currentUser, tenantId } = useAuth();
  const [selectedCompanyFilter, setSelectedCompanyFilter] = useState<string | null>(null);
  const [allCompanies, setAllCompanies] = useState<any[]>([]);
  const [loadingAllCompanies, setLoadingAllCompanies] = useState(false);
  const [lastActivities, setLastActivities] = useState<{[key: string]: any}>({});
  const [runningCleanup, setRunningCleanup] = useState(false);
  const filtersRef = useRef<HTMLDivElement | null>(null);
  const [filtersHeight, setFiltersHeight] = useState<number>(0);
  const [isScrolled, setIsScrolled] = useState(false);
  
  // Selection state (Inbox standard)
  const [selectedContactIds, setSelectedContactIds] = useState<Set<string>>(new Set());
  
  // Pagination state (Inbox standard)
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(20);

  // Reset pagination when search or filters change
  useEffect(() => {
    setPage(0);
  }, [search, selectedCompanyFilter, locationStateFilter, showFavoritesOnly, contactFilter]);

  // Measure filters height (used to offset sticky table header only when scrolled)
  useEffect(() => {
    const update = () => {
      setFiltersHeight(filtersRef.current?.offsetHeight ?? 0);
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  // Track scroll state so we don't reserve space above the table header at scrollTop=0
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    const onScroll = () => setIsScrolled(el.scrollTop > 0);
    onScroll();
    el.addEventListener('scroll', onScroll, { passive: true } as any);
    return () => el.removeEventListener('scroll', onScroll as any);
  }, [scrollContainerRef]);
  
  // Favorites
  const { isFavorite, toggleFavorite } = useFavorites('contacts');

  // Function to run the cleanup
  const runCleanup = async () => {
    if (!tenantId) return;
    
    setRunningCleanup(true);
    try {
      console.log('🔧 Starting cleanup for tenant:', tenantId);
      
      // Get the current user's ID token for authentication
      const idToken = await currentUser?.getIdToken();
      if (!idToken) {
        throw new Error('User not authenticated');
      }
      
      // Use HTTP function directly (more reliable for CORS)
      const response = await fetch('https://us-central1-hrx1-d3beb.cloudfunctions.net/cleanupContactCompanyAssociationsHttp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify({ tenantId })
      });
      
      if (!response.ok) {
        throw new Error(`HTTP function failed: ${response.status} ${response.statusText}`);
      }
      
      const result = await response.json();
      console.log('✅ HTTP Cleanup result:', result);
      
      // Show success message
      alert('Contact company associations cleanup completed! Check the console for details.');
      
      // Reload contacts to see the changes
      window.location.reload();
    } catch (error: any) {
      console.error('❌ Error running cleanup:', error);
      console.error('❌ Error code:', error.code);
      console.error('❌ Error message:', error.message);
      console.error('❌ Error details:', error.details);
      
      let errorMessage = 'Error running cleanup. ';
      if (error.code === 'functions/unavailable') {
        errorMessage += 'Function is not available. Please try again in a few minutes.';
      } else if (error.code === 'functions/permission-denied') {
        errorMessage += 'Permission denied. Please check your authentication.';
      } else if (error.message?.includes('CORS')) {
        errorMessage += 'CORS error. Please try again or contact support.';
      } else {
        errorMessage += 'Check the console for details.';
      }
      
      alert(errorMessage);
    } finally {
      setRunningCleanup(false);
    }
  };

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

  // Sorting state
  const [sortField, setSortField] = useState<string>('fullName');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  // Handle sorting
  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  // Get sortable value for a contact and field
  const getSortableValue = (contact: any, field: string) => {
    switch (field) {
      case 'fullName':
        return (contact.fullName || contact.name || '').toLowerCase();
      case 'jobTitle':
        return (contact.jobTitle || contact.title || '').toLowerCase();
      case 'email':
        return (contact.email || '').toLowerCase();
      case 'company':
        return (() => {
          // First check for direct companyName field (most reliable)
          if (contact.companyName) {
            return contact.companyName.toLowerCase();
          }
          
          // Second check for legacy companyId field
          if (contact.companyId) {
            const company = companies.find(c => c.id === contact.companyId);
            if (company) {
              return (company.companyName || company.name || '').toLowerCase();
            }
          }
          
          // Third check for associations.companies array
          const assocCompanies = (contact.associations?.companies || []).map((c: any) => (typeof c === 'string' ? c : c?.id)).filter(Boolean);
          const primaryCompanyId = assocCompanies[0];
          const company = companies.find(c => c.id === primaryCompanyId);
          return (company?.companyName || company?.name || '').toLowerCase();
        })();
      case 'location':
        return (() => {
          // First check for legacy locationId field
          if (contact.locationId) {
            const location = locations.find(loc => loc.id === contact.locationId);
            if (location) {
              const locationName = location.name || location.nickname || 'Unknown Location';
              const cityState = [location.city, location.state].filter(Boolean).join(', ');
              return cityState ? `${locationName} (${cityState})` : locationName;
            }
            // If locationId exists but location not found, show locationName if available
            if (contact.locationName) {
              return contact.locationName.toLowerCase();
            }
          }
          
          // Fallback to associations.locations array
          const assocLocs = (contact.associations?.locations || []) as any[];
          const obj = assocLocs.find(l => typeof l === 'object');
          const locName = obj?.snapshot?.name || obj?.name;
          if (locName) return locName.toLowerCase();
          
          // Final fallback to contact city/state
          if (contact.city && contact.state) return `${contact.city}, ${contact.state}`.toLowerCase();
          return '';
        })();
      case 'lastActivity': {
        const activity = lastActivities[contact.id];
        if (!activity) return new Date(0);
        const timestamp = activity.timestamp || activity;
        const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
        return date.getTime();
      }
      default:
        return '';
    }
  };

  // Filter and sort contacts
  const filteredContacts = React.useMemo(() => {
    let filtered = contacts;
    
    // Apply favorites filter
    if (showFavoritesOnly) {
      filtered = filtered.filter(contact => isFavorite(contact.id));
    }
    
    // Apply company filter if selected
    if (selectedCompanyFilter) {
      // Map company names to ids for legacy records that only have companyName
      const nameToId = new Map<string, string>();
      companies.forEach((c: any) => {
        const key = String(c.companyName || c.name || '').toLowerCase();
        if (key) nameToId.set(key, c.id);
      });

      filtered = filtered.filter((contact: any) => {
        // 1) Legacy direct field
        if (contact.companyId && contact.companyId === selectedCompanyFilter) return true;

        // 2) Associations array (ids or objects)
        const assocCompanies = (contact.associations?.companies || []).map((c: any) => {
          if (typeof c === 'string') return c;
          return c?.id || c?.companyId || c?.snapshot?.id || null;
        }).filter(Boolean);
        if (assocCompanies.includes(selectedCompanyFilter)) return true;

        // 3) Legacy name-only matching
        if (contact.companyName) {
          const mappedId = nameToId.get(String(contact.companyName).toLowerCase());
          if (mappedId === selectedCompanyFilter) return true;
        }
        return false;
      });
    }
    
    // Apply state filter if selected (contacts store state on the document itself)
    if (locationStateFilter && locationStateFilter !== 'all') {
      const STATE_BY_CODE: Record<string, string> = {
        AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming'
      };

      const code = locationStateFilter;
      const full = (STATE_BY_CODE[code] || code).toLowerCase();

      filtered = filtered.filter((contact: any) => {
        const contactState = String(contact.state || contact.State || '').toLowerCase().trim();
        if (!contactState) return false;
        // Match by full name (primary) or by code just in case some contacts store code
        return contactState === full || contactState === code.toLowerCase();
      });
    }

    // Sort the filtered contacts
    filtered.sort((a, b) => {
      const aValue = getSortableValue(a, sortField);
      const bValue = getSortableValue(b, sortField);
      
      if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
    
    return filtered;
  }, [contacts, selectedCompanyFilter, locationStateFilter, sortField, sortDirection, companies, locations, lastActivities, showFavoritesOnly, isFavorite]);

  // Paginated contacts (Inbox standard)
  const paginatedContacts = React.useMemo(() => {
    return filteredContacts.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);
  }, [filteredContacts, page, rowsPerPage]);

  // Selection handlers (Inbox standard)
  const handleSelectContact = (contactId: string) => {
    setSelectedContactIds(prev => {
      const next = new Set(prev);
      if (next.has(contactId)) {
        next.delete(contactId);
      } else {
        next.add(contactId);
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    const currentVisibleIds = new Set(paginatedContacts.map(c => c.id));
    const allCurrentVisibleSelected = currentVisibleIds.size > 0 && Array.from(currentVisibleIds).every(id => selectedContactIds.has(id));
    
    if (allCurrentVisibleSelected) {
      // Deselect all visible
      setSelectedContactIds(prev => {
        const next = new Set(prev);
        currentVisibleIds.forEach(id => next.delete(id));
        return next;
      });
    } else {
      // Select all visible
      setSelectedContactIds(prev => {
        const next = new Set(prev);
        currentVisibleIds.forEach(id => next.add(id));
        return next;
      });
    }
  };

  const handleSelectAllContacts = () => {
    if (selectedContactIds.size === filteredContacts.length) {
      setSelectedContactIds(new Set());
    } else {
      setSelectedContactIds(new Set(filteredContacts.map(c => c.id)));
    }
  };

  const handleBulkDelete = async () => {
    if (selectedContactIds.size === 0 || !tenantId) return;
    if (!window.confirm(`Are you sure you want to delete ${selectedContactIds.size} contact(s)?`)) return;
    
    // TODO: Implement bulk delete
    console.log('Bulk delete contacts:', Array.from(selectedContactIds));
    setSelectedContactIds(new Set());
  };

  const handleBulkStar = async () => {
    if (selectedContactIds.size === 0) return;
    
    // TODO: Implement bulk star
    const contactIds = Array.from(selectedContactIds);
    contactIds.forEach(id => {
      if (!isFavorite(id)) {
        toggleFavorite(id);
      }
    });
    setSelectedContactIds(new Set());
  };

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

  // Function to get the last activity for a contact
  const getLastActivity = React.useCallback(async (contactId: string) => {
    if (!tenantId) return;
    
    try {
      const { getLastContactActivity } = await import('../../utils/activityService');
      const lastActivity = await getLastContactActivity(tenantId, contactId);
      
      if (lastActivity) {
        setLastActivities(prev => ({
          ...prev,
          [contactId]: lastActivity
        }));
      }
    } catch (error) {
      console.error('Error loading last activity:', error);
    }
  }, [tenantId]);

  // Load last activities for all contacts
  React.useEffect(() => {
    filteredContacts.forEach(contact => {
      getLastActivity(contact.id);
    });
  }, [filteredContacts, getLastActivity]);

  // Helper function to format relative time
  const formatRelativeTime = (activity: any) => {
    if (!activity) return 'No Activity';
    
    // Handle both old timestamp format and new activity object format
    const timestamp = activity.timestamp || activity;
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    const now = new Date();
    const diffInHours = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60));
    
    if (diffInHours < 1) return 'Just now';
    if (diffInHours < 24) return `${diffInHours}h ago`;
    if (diffInHours < 48) return '1d ago';
    if (diffInHours < 168) return `${Math.floor(diffInHours / 24)}d ago`;
    if (diffInHours < 720) return `${Math.floor(diffInHours / 168)}w ago`;
    return `${Math.floor(diffInHours / 720)}mo ago`;
  };

  // Helper function to get avatar background color - softer pastel palette
  const getAvatarColor = (name: string) => {
    const colors = [
      '#F3F4F6', // Light gray
      '#FEF3C7', // Light yellow
      '#DBEAFE', // Light blue
      '#D1FAE5', // Light green
      '#FCE7F3', // Light pink
      '#EDE9FE', // Light purple
      '#FEE2E2', // Light red
      '#FEF5E7'  // Light orange
    ];
    const index = name.charCodeAt(0) % colors.length;
    return colors[index];
  };

  // Helper function to get avatar text color - darker for contrast
  const getAvatarTextColor = (name: string) => {
    const colors = [
      '#6B7280', // Gray
      '#92400E', // Amber
      '#1E40AF', // Blue
      '#065F46', // Green
      '#BE185D', // Pink
      '#5B21B6', // Purple
      '#DC2626', // Red
      '#EA580C'  // Orange
    ];
    const index = name.charCodeAt(0) % colors.length;
    return colors[index];
  };
  return (
    <Box sx={{ 
      flex: 1, 
      minHeight: 0, 
      display: 'flex', 
      flexDirection: 'column', 
      // Important: avoid overflow:'hidden' here; it breaks position:sticky for descendants
      // because it becomes the nearest "scrolling ancestor" even though it doesn't scroll.
      overflow: 'visible'
    }}>
      {/* Filter & Toolbar Area - Consolidated with card background */}
      <Box ref={filtersRef} sx={{ 
        // Tight layout (no extra outer spacing)
        mt: 0,
        mb: 0,
        // Keep internal padding for controls, but avoid extra vertical whitespace
        px: 1.5,
        py: 1.25,
        backgroundColor: '#F9FAFB',
        borderRadius: 0, // Standard: square / tight (matches Inbox-style tables)
        border: '1px solid #E5E7EB',
        borderBottom: '1px solid #EAEEF4', // Match table border color for seamless connection
        overflowX: 'auto',
        overflowY: 'hidden',
        position: 'sticky',
        top: 0, // Stick to top of scroll container (PageHeader takes its own space above)
        zIndex: 15,
        '&::-webkit-scrollbar': { height: '6px' },
        '&::-webkit-scrollbar-track': { background: 'rgba(0, 0, 0, 0.02)', borderRadius: '4px' },
        '&::-webkit-scrollbar-thumb': { background: 'rgba(0, 0, 0, 0.15)', borderRadius: '4px', '&:hover': { background: 'rgba(0, 0, 0, 0.25)' } },
        scrollbarWidth: 'thin',
        scrollbarColor: 'rgba(0, 0, 0, 0.15) rgba(0, 0, 0, 0.02)',
      }}>
        <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'nowrap', minWidth: 'max-content' }}>
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
              height: 36,
              '& .MuiToggleButton-root': {
                px: 2.5,
                py: 0.75,
                fontSize: '0.8125rem',
                fontWeight: 500,
                borderRadius: '18px',
                border: '1px solid #E5E7EB',
                color: '#6B7280',
                backgroundColor: 'white',
                '&.Mui-selected': {
                  backgroundColor: '#0B63C5',
                  color: 'white',
                  '&:hover': {
                    backgroundColor: '#0B63C5',
                  }
                },
                '&:hover': {
                  backgroundColor: '#F3F4F6',
                }
              }
            }}
          >
            <ToggleButton value="all" sx={{ mr: 1 }}>
              All Contacts
            </ToggleButton>
            <ToggleButton value="my">
              My Contacts
            </ToggleButton>
          </ToggleButtonGroup>
          
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
                sx={{ 
                  width: 180,
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
                InputProps={{
                  ...params.InputProps,
                  endAdornment: (
                    <>
                      {loadingAllCompanies && <CircularProgress size={14} />}
                      {selectedCompanyFilter && (
                        <IconButton
                          size="small"
                          onClick={() => setSelectedCompanyFilter(null)}
                          sx={{ mr: 0.5, p: 0.5 }}
                        >
                          <ClearIcon fontSize="small" />
                        </IconButton>
                      )}
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
            isOptionEqualToValue={(option, value) => option.id === value.id}
            clearOnBlur={false}
          />

          {/* State Filter */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <FormControl size="small" sx={{ minWidth: 160, height: 36 }}>
              <InputLabel sx={{ fontSize: '0.875rem' }}>State Filter</InputLabel>
              <Select
                value={locationStateFilter}
                onChange={(e) => onLocationStateFilterChange(String((e.target as any).value))}
                label="State Filter"
                sx={{
                  height: 36,
                  borderRadius: '6px',
                  backgroundColor: 'white',
                  fontSize: '0.875rem',
                  '& .MuiOutlinedInput-notchedOutline': {
                    borderColor: '#E5E7EB',
                  },
                  '&:hover .MuiOutlinedInput-notchedOutline': {
                    borderColor: '#D1D5DB',
                  },
                }}
              >
                <MenuItem value="all">All States</MenuItem>
                {['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'].map((st) => (
                  <MenuItem key={st} value={st}>{st}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <IconButton
              size="small"
              aria-label="Clear state filter"
              onClick={() => onLocationStateFilterChange('all')}
              disabled={locationStateFilter === 'all'}
              sx={{ height: 36, width: 36, p: 0.75 }}
            >
              <ClearIcon fontSize="small" />
            </IconButton>
          </Box>
          
          <Box sx={{ ml: 'auto', display: 'flex', gap: 1, flexShrink: 0 }}>
            <Button
              variant="outlined"
              color="secondary"
              onClick={runCleanup}
              disabled={runningCleanup}
              sx={{
                height: 36,
                borderRadius: '6px',
                textTransform: 'none',
                fontWeight: 500,
                fontSize: '0.875rem',
                px: 2.5,
                py: 0.75,
                whiteSpace: 'nowrap'
              }}
            >
              {runningCleanup ? 'Running...' : 'Fix Company Links'}
            </Button>
          </Box>
        </Box>
      </Box>
      
      {/* Selection Footer (Inbox standard) */}
      {selectedContactIds.size > 0 && (
        <Box sx={{ 
          px: 2, 
          py: 1.5, 
          bgcolor: 'action.selected', 
          display: 'flex', 
          alignItems: 'center', 
          gap: 1.5,
          flexShrink: 0,
          borderBottom: '1px solid',
          borderColor: 'divider',
        }}>
          <Typography variant="body2" sx={{ fontWeight: 500, mr: 1 }}>
            {selectedContactIds.size} selected
          </Typography>
          {(() => {
            const currentVisibleIds = new Set(paginatedContacts.map(c => c.id));
            return filteredContacts.length > paginatedContacts.length && selectedContactIds.size < filteredContacts.length;
          })() && (
            <Button
              size="small"
              variant="outlined"
              onClick={handleSelectAllContacts}
              sx={{ textTransform: 'none', mr: 1 }}
            >
              Select All {filteredContacts.length}
            </Button>
          )}
          <Button
            size="small"
            variant="outlined"
            color="error"
            startIcon={<DeleteIcon />}
            onClick={handleBulkDelete}
            sx={{ textTransform: 'none' }}
          >
            Delete
          </Button>
          <Button
            size="small"
            variant="outlined"
            startIcon={<StarBorderIcon />}
            onClick={handleBulkStar}
            sx={{ textTransform: 'none' }}
          >
            Star
          </Button>
        </Box>
      )}

      {/* Contacts Table */}
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          // Important: avoid overflow:'hidden' for sticky table header behavior (Inbox standard)
          overflow: 'visible',
          mt: 0,
          pt: 0,
        }}
      >
        <ContactTable
          contacts={paginatedContacts}
          loading={loading}
          columns={{
            favorites: true,
            name: true,
            jobTitle: true,
            contactInfo: true,
            company: true,
            location: true,
            lastActivity: true,
          }}
          sortField={sortField}
          sortDirection={sortDirection}
          onSort={handleSort}
          // Key: avoid "reserved space" above the header at scrollTop=0.
          // Offset the sticky header only after the user scrolls, using the actual filter row height.
          stickyHeaderOffset={isScrolled ? filtersHeight : 0}
          useOuterScroll
          square
          selectedContactIds={selectedContactIds}
          onSelectContact={handleSelectContact}
          onSelectAll={handleSelectAll}
          pagination={{
            count: filteredContacts.length,
            page,
            rowsPerPage,
            onPageChange: (_, newPage) => setPage(newPage),
            onRowsPerPageChange: (e) => {
              setRowsPerPage(parseInt(e.target.value, 10));
              setPage(0);
            },
          }}
          renderRow={(contact, index) => {
          const getInitials = (contact: any) => {
            if (contact.fullName) {
              return contact.fullName.charAt(0).toUpperCase();
            }
            return '?';
          };

          return (
            <ContactTableRow
              key={contact.id}
              contact={contact}
              isFavorite={isFavorite}
              toggleFavorite={toggleFavorite}
              onRowClick={() => navigate(`/contacts/${contact.id}`)}
              getAvatarColor={getAvatarColor}
              getAvatarTextColor={getAvatarTextColor}
              getInitials={getInitials}
              columns={{
                favorites: true,
                name: true,
                jobTitle: true,
                contactInfo: true,
                company: true,
                location: true,
                lastActivity: true,
              }}
              companies={companies}
              locations={locations}
              lastActivity={lastActivities[contact.id] ? { timestamp: lastActivities[contact.id].timestamp } : undefined}
              formatRelativeTime={formatRelativeTime}
              rowIndex={index}
              selected={selectedContactIds.has(contact.id)}
              onSelect={(e) => {
                e.stopPropagation();
                handleSelectContact(contact.id);
              }}
            />
          );
        }}
        />
      </Box>

      {/* Empty State */}
      {filteredContacts.length === 0 && !loading && (
        <Box sx={{ 
          display: 'flex', 
          flexDirection: 'column', 
          alignItems: 'center', 
          justifyContent: 'center', 
          py: 8,
          textAlign: 'center'
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
            <PersonIcon sx={{ fontSize: 48, color: '#9CA3AF' }} />
          </Box>
          <Typography variant="h6" sx={{ fontWeight: 600, color: '#111827', mb: 1 }}>
            No contacts yet
          </Typography>
          <Typography variant="body2" color="#6B7280" sx={{ mb: 3 }}>
            Add your first contact to get started with your CRM
          </Typography>
          <Button
            variant="contained"
            color="primary"
            startIcon={<AddIcon />}
            onClick={onAddNew}
            sx={{
              borderRadius: '8px',
              textTransform: 'none',
              fontWeight: 500
            }}
          >
            Add Your First Contact
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
  salesTeam: any[];
  search: string;
  onSearchChange: (value: string) => void;
  onAddNew: () => void;
  loading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  companyFilter: 'all' | 'my';
  onCompanyFilterChange: (newFilter: 'all' | 'my') => void;
  tenantId: string;
  onUpdatePipelineTotals: (companyId: string) => Promise<void>;
  locationStateFilter: string;
  onLocationStateFilterChange: (state: string) => void;
  showFavoritesOnly: boolean;
  onShowFavoritesOnlyChange: (next: boolean) => void;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
}> = ({ companies, contacts, deals, salesTeam, search, onSearchChange, onAddNew, loading, hasMore, onLoadMore, companyFilter, onCompanyFilterChange, tenantId, onUpdatePipelineTotals, locationStateFilter, onLocationStateFilterChange, showFavoritesOnly, onShowFavoritesOnlyChange, scrollContainerRef }) => {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  
  // Favorites
  const { isFavorite, toggleFavorite } = useFavorites('companies');
  const filtersRef = useRef<HTMLDivElement | null>(null);
  const [filtersHeight, setFiltersHeight] = useState<number>(0);
  const [isScrolled, setIsScrolled] = useState(false);

  // Measure filters height (used to offset sticky table header only when scrolled)
  useEffect(() => {
    const update = () => setFiltersHeight(filtersRef.current?.offsetHeight ?? 0);
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  // Track scroll state so we don't reserve space above the table header at scrollTop=0
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const onScroll = () => setIsScrolled(el.scrollTop > 0);
    onScroll();
    el.addEventListener('scroll', onScroll, { passive: true } as any);
    return () => el.removeEventListener('scroll', onScroll as any);
  }, [scrollContainerRef]);
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

  // Sorting state
  const [sortField, setSortField] = useState<string>('companyName');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  // Handle sorting
  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  // Get sortable value for a company and field
  const getSortableValue = (company: any, field: string) => {
    switch (field) {
      case 'companyName':
        return (company.companyName || company.name || '').toLowerCase();
      case 'contacts':
        return getCompanyContacts(company.id).length;
      case 'deals':
        return getCompanyDeals(company.id).length;
      case 'pipelineValue': {
        const pipeline = getCompanyPipelineValue(company);
        return pipeline.totalLow + pipeline.totalHigh;
      }
      case 'accountOwner':
        return getCompanyAccountOwner(company).toLowerCase();
      default:
        return '';
    }
  };

  // Filter and sort companies
  const filteredCompanies = React.useMemo(() => {
    let filtered = companies;
    
    // Apply favorites filter
    if (showFavoritesOnly) {
      filtered = filtered.filter(company => isFavorite(company.id));
    }
    
    // Apply search filter if search term exists
    if (search.trim()) {
      const searchLower = search.toLowerCase().trim();
      filtered = filtered.filter(company => {
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
    
    // Sort the filtered companies
    filtered.sort((a, b) => {
      const aValue = getSortableValue(a, sortField);
      const bValue = getSortableValue(b, sortField);
      
      if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
    
    return filtered;
  }, [companies, search, sortField, sortDirection, showFavoritesOnly, isFavorite]);

  // Helper function to get account owner for sorting
  const getCompanyAccountOwner = (company: any) => {
    // Get associated salespeople for this company using the associations system
    const salespeople = new Set<string>();
    
    // Check if company has associations data
    if (company.associations && company.associations.salespeople) {
      // If associations are already loaded in the company object
      company.associations.salespeople.forEach((salesperson: any) => {
        if (salesperson.name) {
          salespeople.add(salesperson.name);
        } else if (typeof salesperson === 'string') {
          salespeople.add(getSalespersonName(salesperson));
        }
      });
    }
    
    // Also check for legacy fields
    if (company.salesOwnerId) {
      salespeople.add(getSalespersonName(company.salesOwnerId));
    }
    if (company.accountOwnerId) {
      salespeople.add(getSalespersonName(company.accountOwnerId));
    }
    if (company.salesOwnerName) {
      salespeople.add(company.salesOwnerName);
    }
    if (company.accountOwner) {
      salespeople.add(company.accountOwner);
    }
    
    // Check deals for additional salespeople
    const companyDeals = getCompanyDeals(company.id);
    companyDeals.forEach(deal => {
      if (deal.owner) {
        salespeople.add(getSalespersonName(deal.owner));
      }
    });
    
    const salespeopleList = Array.from(salespeople);
    
    if (salespeopleList.length === 0) {
      return '-';
    }
    
    const primarySalesperson = salespeopleList[0];
    const displayName = primarySalesperson.includes('@') 
      ? primarySalesperson.split('@')[0] 
      : `${primarySalesperson.split(' ')[0]} ${primarySalesperson.split(' ')[1]?.[0] || ''}.`;
    
    return displayName;
  };

  // Helper function to get avatar background color - softer pastel palette
  const getAvatarColor = (name: string) => {
    const colors = [
      '#F3F4F6', // Light gray
      '#FEF3C7', // Light yellow
      '#DBEAFE', // Light blue
      '#D1FAE5', // Light green
      '#FCE7F3', // Light pink
      '#EDE9FE', // Light purple
      '#FEE2E2', // Light red
      '#FEF5E7'  // Light orange
    ];
    const index = name.charCodeAt(0) % colors.length;
    return colors[index];
  };

  // Helper function to get avatar text color - darker for contrast
  const getAvatarTextColor = (name: string) => {
    const colors = [
      '#6B7280', // Gray
      '#92400E', // Amber
      '#1E40AF', // Blue
      '#065F46', // Green
      '#BE185D', // Pink
      '#5B21B6', // Purple
      '#DC2626', // Red
      '#EA580C'  // Orange
    ];
    const index = name.charCodeAt(0) % colors.length;
    return colors[index];
  };

  const handleViewCompany = (company: any) => {
    navigate(`/companies/${company.id}`);
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
    return contacts.filter((contact: any) => {
      // Check new associations format first
      const assocCompanies = (contact.associations?.companies || []).map((c: any) => (typeof c === 'string' ? c : c?.id)).filter(Boolean);
      if (assocCompanies.includes(companyId)) {
        return true;
      }
      // Fallback to legacy companyId field
      if (contact.companyId === companyId) {
        return true;
      }
      return false;
    });
  };

  const getCompanyDeals = (companyId: string) => {
    return deals.filter((deal: any) => {
      const ids = getDealCompanyIds(deal);
      return ids.includes(companyId);
    });
  };

  // Helper function to get salesperson name from ID
  const getSalespersonName = (salespersonId: string) => {
    const salesperson = salesTeam.find(sp => sp.id === salespersonId || sp.uid === salespersonId);
    return salesperson ? (salesperson.name || salesperson.displayName || salesperson.email) : salespersonId;
  };

  // Get pipeline value for a company (from stored hierarchical data or calculate on demand)
  const getCompanyPipelineValue = (company: any) => {
    // Use stored hierarchical values if available
    if (company.pipelineValue) {
      return {
        totalLow: company.pipelineValue.low || 0,
        totalHigh: company.pipelineValue.high || 0,
        dealCount: company.pipelineValue.dealCount || 0
      };
    }
    
    // Fallback to calculation if stored values not available
    const companyDeals = getCompanyDeals(company.id);
    const pipelineDeals = companyDeals.filter(deal => 
      deal.status !== 'closed' && deal.status !== 'lost' && deal.expectedAnnualRevenueRange
    );
    
    let totalLow = 0;
    let totalHigh = 0;
    
    pipelineDeals.forEach(deal => {
      const range = deal.expectedAnnualRevenueRange;
      if (range && typeof range === 'string') {
        // Parse range like "$87,360 - $218,400"
        const match = range.match(/\$([\d,]+)\s*-\s*\$([\d,]+)/);
        if (match) {
          const low = parseInt(match[1].replace(/,/g, ''));
          const high = parseInt(match[2].replace(/,/g, ''));
          totalLow += low;
          totalHigh += high;
        }
      }
    });
    
    return { totalLow, totalHigh, dealCount: pipelineDeals.length };
  };


  // Get division breakdown for a company
  const getCompanyDivisionBreakdown = (company: any) => {
    if (!company.divisionTotals) return null;
    
    return Object.entries(company.divisionTotals).map(([divisionName, division]: [string, any]) => ({
      name: divisionName,
      pipeline: {
        low: division.pipelineValue.low || 0,
        high: division.pipelineValue.high || 0,
        dealCount: division.pipelineValue.dealCount || 0
      },
      closed: {
        total: division.closedValue.total || 0,
        dealCount: division.closedValue.dealCount || 0
      },
      locationCount: division.locations?.length || 0
    }));
  };

  // Format currency for display
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  // Get company salespeople as a reusable function
  const getCompanySalespeople = (company: any): string[] => {
    const names: string[] = [];
    const seen = new Set<string>();
    const addName = (label?: string) => {
      const v = (label || '').trim();
      if (!v) return;
      if (seen.has(v)) return;
      seen.add(v);
      names.push(v);
    };
    const assoc = company.associations?.salespeople || [];
    assoc.forEach((sp: any) => {
      if (typeof sp === 'string') {
        addName(getSalespersonName(sp));
      } else if (sp && typeof sp === 'object') {
        const full = [sp.firstName, sp.lastName].filter(Boolean).join(' ').trim();
        addName(sp.name || sp.displayName || full || sp.email || getSalespersonName(sp.id));
      }
    });
    // Fallbacks to legacy fields if no associations present
    if (names.length === 0) {
      addName(company.salesOwnerName);
      if (company.salesOwnerId) addName(getSalespersonName(company.salesOwnerId));
      if (company.accountOwnerId) addName(getSalespersonName(company.accountOwnerId));
      addName(company.accountOwner);
    }
    return names;
  };
  return (
    <Box>
      {/* Header with search and actions */}
      {/* <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h6" sx={{ fontWeight: 600, color: '#111827' }}>
          Companies ({companies.length})
        </Typography>
      </Box> */}

      {/* Filter & Toolbar Area - Consolidated with card background */}
      <Box
        ref={filtersRef}
        sx={{ 
          // Tight + sticky (Inbox/Contacts standard)
          mt: 0,
          mb: 0,
          px: 1.5,
          py: 1.25,
          backgroundColor: '#F9FAFB',
          borderRadius: 0,
          border: '1px solid #E5E7EB',
          borderBottom: '1px solid #EAEEF4',
          overflowX: 'auto',
          overflowY: 'hidden',
          position: 'sticky',
          top: 0,
          zIndex: 15,
          '&::-webkit-scrollbar': { height: '6px' },
          '&::-webkit-scrollbar-track': { background: 'rgba(0, 0, 0, 0.02)', borderRadius: '4px' },
          '&::-webkit-scrollbar-thumb': { background: 'rgba(0, 0, 0, 0.15)', borderRadius: '4px', '&:hover': { background: 'rgba(0, 0, 0, 0.25)' } },
          scrollbarWidth: 'thin',
          scrollbarColor: 'rgba(0, 0, 0, 0.15) rgba(0, 0, 0, 0.02)',
        }}
      >
        <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'nowrap', minWidth: 'max-content' }}>
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
              height: 36,
              '& .MuiToggleButton-root': {
                px: 2.5,
                py: 0.75,
                fontSize: '0.8125rem',
                fontWeight: 500,
                borderRadius: '18px',
                border: '1px solid #E5E7EB',
                color: '#6B7280',
                backgroundColor: 'white',
                '&.Mui-selected': {
                  backgroundColor: '#0B63C5',
                  color: 'white',
                  '&:hover': {
                    backgroundColor: '#0B63C5',
                  }
                },
                '&:hover': {
                  backgroundColor: '#F3F4F6',
                }
              }
            }}
          >
            <ToggleButton value="all" sx={{ mr: 1 }}>
              All Companies
            </ToggleButton>
            <ToggleButton value="my">
              My Companies
            </ToggleButton>
          </ToggleButtonGroup>

          {/* State Filter */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <FormControl size="small" sx={{ minWidth: 160, height: 36 }}>
              <InputLabel sx={{ fontSize: '0.875rem' }}>State Filter</InputLabel>
              <Select
                value={locationStateFilter}
                onChange={(e) => onLocationStateFilterChange(String((e.target as any).value))}
                label="State Filter"
                sx={{
                  height: 36,
                  borderRadius: '6px',
                  backgroundColor: 'white',
                  fontSize: '0.875rem',
                  '& .MuiOutlinedInput-notchedOutline': {
                    borderColor: '#E5E7EB',
                  },
                  '&:hover .MuiOutlinedInput-notchedOutline': {
                    borderColor: '#D1D5DB',
                  },
                }}
              >
                <MenuItem value="all">All States</MenuItem>
                {['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'].map((st) => (
                  <MenuItem key={st} value={st}>{st}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <IconButton
              size="small"
              aria-label="Clear state filter"
              onClick={() => onLocationStateFilterChange('all')}
              disabled={locationStateFilter === 'all'}
              sx={{ height: 36, width: 36, p: 0.75 }}
            >
              <ClearIcon fontSize="small" />
            </IconButton>
          </Box>
        </Box>
      </Box>
      
      {/* Companies Table */}
      <CompanyTable
        companies={filteredCompanies}
        loading={loading}
        hasMore={hasMore}
        onLoadMore={onLoadMore}
        columns={{
          favorites: true,
          companyName: true,
          contacts: true,
          deals: true,
          pipelineValue: true,
          headquarters: true,
          salespeople: true,
        }}
        sortField={sortField}
        sortDirection={sortDirection}
        onSort={handleSort}
        onRowClick={handleViewCompany}
        isFavorite={isFavorite}
        toggleFavorite={toggleFavorite}
        getAvatarColor={getAvatarColor}
        getAvatarTextColor={getAvatarTextColor}
        getCompanyContacts={getCompanyContacts}
        getCompanyDeals={getCompanyDeals}
        getCompanyPipelineValue={getCompanyPipelineValue}
        getCompanySalespeople={getCompanySalespeople}
        formatCurrency={formatCurrency}
        stickyHeaderOffset={isScrolled ? filtersHeight : 0}
        useOuterScroll
        square
        emptyStateMessage="No companies found"
        emptyStateAction={
          filteredCompanies.length === 0 && !loading ? (
            <Box sx={{ textAlign: 'center' }}>
              <Box
                sx={{
                  width: 120,
                  height: 120,
                  borderRadius: '50%',
                  backgroundColor: '#F3F4F6',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  mb: 3,
                  mx: 'auto',
                }}
              >
                <BusinessIcon sx={{ fontSize: 48, color: '#9CA3AF' }} />
              </Box>
              <Typography variant="h6" sx={{ fontWeight: 600, color: 'text.primary', mb: 1 }}>
                No companies yet
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                Add your first company to start building your CRM
              </Typography>
              <Button
                variant="contained"
                color="primary"
                startIcon={<AddIcon />}
                onClick={onAddNew}
                sx={{
                  borderRadius: 1,
                  textTransform: 'none',
                  fontWeight: 500,
                }}
              >
                Add Your First Company
              </Button>
            </Box>
          ) : undefined
        }
      />

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
// Deals Tab Component (props validated via TypeScript DealsTabProps)
  /* eslint-disable react/prop-types */
  interface DealsTabProps {
    deals: any[];
    allDeals: any[];
    companies: any[];
    allCompanies: any[];
    loadingAllCompanies: boolean;
    contacts: any[];
    pipelineStages: any[];
    search: string;
    onSearchChange: (value: string) => void;
    onAddNew: () => void;
    dealFilter: 'all' | 'my';
    onDealFilterChange: (newFilter: 'all' | 'my') => void;
    currentUser: any;
    salesTeam: any[];
    tenantId: string;
    opportunityDialogOpen: boolean;
    onOpportunityDialogOpenChange: (next: boolean) => void;
    scrollContainerRef: React.RefObject<HTMLDivElement | null>;
    showArchived?: boolean;
  }
  const DealsTab = forwardRef<{ exportCsv: () => void }, DealsTabProps>(function DealsTab(
    { deals, allDeals, companies, allCompanies, loadingAllCompanies, contacts, pipelineStages, search, onSearchChange, onAddNew, dealFilter, onDealFilterChange, currentUser, salesTeam, tenantId, opportunityDialogOpen, onOpportunityDialogOpenChange, scrollContainerRef, showArchived = false },
    ref
  ) {
  const navigate = useNavigate();
  const [showDealDialog, setShowDealDialog] = useState(false);
  const [editingDeal, setEditingDeal] = useState<any>(null);
  const [dealForm, setDealForm] = useState({
    name: '',
    estimatedRevenue: '',
    stage: '',
    companyId: '',
    contactIds: [] as string[],
    description: '',
    closeDate: '',
    probability: 50,
    tags: [] as string[],
    owner: '',
  });

  const [showDealWizard, setShowDealWizard] = useState(false);
  
  const filtersRef = useRef<HTMLDivElement | null>(null);
  const [filtersHeight, setFiltersHeight] = useState<number>(0);
  const [isScrolled, setIsScrolled] = useState(false);
  
  // Pagination state (Inbox standard)
  const [dealPage, setDealPage] = useState(0);
  const [dealRowsPerPage, setDealRowsPerPage] = useState(20);
  const [newOpportunityForm, setNewOpportunityForm] = useState({
    name: '',
    companyId: '',
    divisionId: '',
    locationId: '',
  });
  const [selectedCompany, setSelectedCompany] = useState<any>(null);
  const [companyDivisions, setCompanyDivisions] = useState<any[]>([]);
  const [companyLocations, setCompanyLocations] = useState<any[]>([]);

  // Deal Age & Health Helper Functions (using centralized calculator)
  const getDealAge = useCallback((createdAt: any) => {
    return calculateDealAge(createdAt);
  }, []);

  const getDealHealth = useCallback((deal: any) => {
    return calculateDealHealth(deal);
  }, []);

  const getDealStatus = useCallback((deal: any) => {
    // Check if deal has a status field, otherwise default to 'open'
    const status = deal.status || 'open';
    
    // Debug logging
    console.log('🔍 Deal status debug:', {
      dealId: deal.id,
      dealName: deal.name,
      dealStatus: deal.status,
      resolvedStatus: status,
      dealKeys: Object.keys(deal)
    });
    
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
  const [loadingDivisions, setLoadingDivisions] = useState(false);
  const [loadingLocations, setLoadingLocations] = useState(false);
  
  // Sorting state
  const [sortField, setSortField] = useState<string>('name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  
  // Salesperson filter state
  const [selectedSalesperson, setSelectedSalesperson] = useState<string>('all');

  // Note modal state (most recent note for selected deal)
  const [noteModalOpen, setNoteModalOpen] = useState(false);
  const [noteModalDealName, setNoteModalDealName] = useState('');
  const [noteModalContent, setNoteModalContent] = useState<string | null>(null);
  const [noteModalTimestamp, setNoteModalTimestamp] = useState<Date | null>(null);
  const [noteModalLoading, setNoteModalLoading] = useState(false);
  const [noteModalSnackbar, setNoteModalSnackbar] = useState<string | null>(null);
  const [dealLocationDetailsMap, setDealLocationDetailsMap] = useState<Record<string, { name?: string; nickname?: string; city?: string; state?: string; address?: any; zipCode?: string; zip?: string }>>({});

  const fetchLatestDealNote = useCallback(async (dealId: string): Promise<{ content: string; timestamp?: Date; authorName?: string } | null> => {
    if (!tenantId) return null;
    try {
      const notesRef = collection(db, 'tenants', tenantId, 'deal_notes');
      const nq = query(notesRef, where('entityId', '==', dealId), orderBy('timestamp', 'desc'), limit(1));
      const snap = await getDocs(nq);
      if (snap.empty) return null;
      const d = snap.docs[0].data() as any;
      return {
        content: d.content || '',
        timestamp: d.timestamp?.toDate?.() || (d.timestamp ? new Date(d.timestamp) : undefined),
        authorName: d.authorName
      };
    } catch {
      return null;
    }
  }, [tenantId]);

  const fetchLatestDealNotesMap = useCallback(async (dealIds: string[]): Promise<Map<string, string>> => {
    const notesByDealId = new Map<string, { content: string; timestampMs: number }>();
    if (!tenantId || dealIds.length === 0) return new Map<string, string>();

    try {
      const notesRef = collection(db, 'tenants', tenantId, 'deal_notes');
      const uniqueIds = Array.from(new Set(dealIds.filter(Boolean)));

      for (let i = 0; i < uniqueIds.length; i += 10) {
        const batch = uniqueIds.slice(i, i + 10);
        if (batch.length === 0) continue;

        const nq = query(notesRef, where('entityId', 'in', batch));
        const snap = await getDocs(nq);

        snap.docs.forEach((docSnap) => {
          const d = docSnap.data() as any;
          const entityId = d.entityId as string | undefined;
          if (!entityId) return;

          const timestampMs =
            d.timestamp?.toDate?.()?.getTime?.() ??
            (d.timestamp ? new Date(d.timestamp).getTime() : 0);

          const existing = notesByDealId.get(entityId);
          if (!existing || timestampMs > existing.timestampMs) {
            notesByDealId.set(entityId, {
              content: d.content || '',
              timestampMs: Number.isFinite(timestampMs) ? timestampMs : 0,
            });
          }
        });
      }
    } catch (err) {
      console.warn('Failed to fetch latest deal notes for CSV export', err);
    }

    return new Map<string, string>(
      Array.from(notesByDealId.entries()).map(([dealId, note]) => [dealId, note.content || ''])
    );
  }, [tenantId]);

  const handleNoteIconClick = useCallback(async (e: React.MouseEvent, deal: any) => {
    e.stopPropagation();
    e.preventDefault();
    if (!deal?.id) return;
    setNoteModalDealName(deal.name || 'Deal');
    setNoteModalLoading(true);
    const note = await fetchLatestDealNote(deal.id);
    setNoteModalLoading(false);
    if (note?.content != null && note.content !== '') {
      setNoteModalContent(note.content);
      setNoteModalTimestamp(note.timestamp || null);
      setNoteModalOpen(true);
    } else {
      setNoteModalSnackbar('No notes for this deal');
    }
  }, [fetchLatestDealNote]);

  // Measure filters height (used to offset sticky table header only when scrolled)
  useEffect(() => {
    const update = () => setFiltersHeight(filtersRef.current?.offsetHeight ?? 0);
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  // Track scroll state so we don't reserve space above the table header at scrollTop=0
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const onScroll = () => setIsScrolled(el.scrollTop > 0);
    onScroll();
    el.addEventListener('scroll', onScroll, { passive: true } as any);
    return () => el.removeEventListener('scroll', onScroll as any);
  }, [scrollContainerRef]);

  // Helpers to normalize salesperson identity/display for dropdown + filtering
  const getSalespersonKey = (sp: any): string => {
    return sp?.id || sp?.uid || sp?.userId || sp?.userID || sp?.docId || sp?.email || '';
  };
  const getSalespersonDisplay = (sp: any): string => {
    const fullName = [sp?.firstName, sp?.lastName].filter(Boolean).join(' ').trim();
    return (
      sp?.name ||
      sp?.displayName ||
      (fullName || '') ||
      sp?.email ||
      sp?.username ||
      getSalespersonKey(sp)
    );
  };

  // Helper function to get avatar background color - softer pastel palette
  const getAvatarColor = (name: string) => {
    const colors = [
      '#F3F4F6', // Light gray
      '#FEF3C7', // Light yellow
      '#DBEAFE', // Light blue
      '#D1FAE5', // Light green
      '#FCE7F3', // Light pink
      '#EDE9FE', // Light purple
      '#FEE2E2', // Light red
      '#FEF5E7'  // Light orange
    ];
    const index = name.charCodeAt(0) % colors.length;
    return colors[index];
  };

  // Helper function to get avatar text color - darker for contrast
  const getAvatarTextColor = (name: string) => {
    const colors = [
      '#6B7280', // Gray
      '#92400E', // Amber
      '#1E40AF', // Blue
      '#065F46', // Green
      '#BE185D', // Pink
      '#5B21B6', // Purple
      '#DC2626', // Red
      '#EA580C'  // Orange
    ];
    const index = name.charCodeAt(0) % colors.length;
    return colors[index];
  };

  const getDealContactsFromAssociations = (deal: any) => {
    const assocContacts = (deal?.associations?.contacts || []) as any[];
    const ids = assocContacts.map((c: any) => (typeof c === 'string' ? c : c?.id)).filter(Boolean);
    return contacts.filter((c: any) => ids.includes(c.id));
  };

  // Load company divisions when company is selected
  const loadCompanyDivisions = async (companyId: string) => {
    if (!companyId) {
      setCompanyDivisions([]);
      return;
    }
    
    setLoadingDivisions(true);
    try {
      const divisionsRef = collection(db, `tenants/${tenantId}/crm_companies/${companyId}/divisions`);
      const divisionsSnapshot = await getDocs(divisionsRef);
      const divisions = divisionsSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setCompanyDivisions(divisions);
    } catch (error) {
      console.error('Error loading company divisions:', error);
      setCompanyDivisions([]);
    } finally {
      setLoadingDivisions(false);
    }
  };

  // Load company locations when company is selected
  const loadCompanyLocations = async (companyId: string) => {
    if (!companyId) {
      setCompanyLocations([]);
      return;
    }
    
    setLoadingLocations(true);
    try {
      const locationsRef = collection(db, `tenants/${tenantId}/crm_companies/${companyId}/locations`);
      const locationsSnapshot = await getDocs(locationsRef);
      const locations = locationsSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setCompanyLocations(locations);
    } catch (error) {
      console.error('Error loading company locations:', error);
      setCompanyLocations([]);
    } finally {
      setLoadingLocations(false);
    }
  };

  // Handle company selection in new opportunity form
  const handleCompanySelection = async (company: any) => {
    setSelectedCompany(company);
    setNewOpportunityForm(prev => ({ ...prev, companyId: company.id }));
    
    // Load divisions and locations for the selected company
    await Promise.all([
      loadCompanyDivisions(company.id),
      loadCompanyLocations(company.id)
    ]);
  };

  const getDealCompanyName = (deal: any) => {
    const primaryId = getDealPrimaryCompanyId(deal);
    if (primaryId) {
      // First try to find in the filtered companies array
      let company = companies.find(c => c.id === primaryId);
      // If not found, try in allCompanies (for deals with companies not in current filter)
      if (!company && allCompanies) {
        company = allCompanies.find(c => c.id === primaryId);
      }
      if (company) return company.companyName || company.name || '-';
    }
    if (deal.externalCompanyName) return deal.externalCompanyName;
    return '-';
  };

  const getDealLocationDisplay = (deal: any): { primary: string; secondary: string; fullAddress: string; sortValue: string; cacheKey: string | null } => {
    const locations = (deal?.associations?.locations || []) as any[];
    const locationEntry = locations[0] ?? (deal?.locationId ? { id: deal.locationId } : null);
    if (!locationEntry) {
      return { primary: '-', secondary: '', fullAddress: '', sortValue: '', cacheKey: null };
    }

    const locationId = typeof locationEntry === 'string' ? locationEntry : locationEntry.id;
    const companyId = typeof locationEntry === 'object'
      ? (locationEntry.companyId || getDealPrimaryCompanyId(deal) || deal?.companyId || '')
      : (getDealPrimaryCompanyId(deal) || deal?.companyId || '');
    const cacheKey = locationId ? `${companyId || 'root'}:${locationId}` : null;
    const snapshot = typeof locationEntry === 'object' ? (locationEntry.snapshot || locationEntry) : {};
    const cached = cacheKey ? dealLocationDetailsMap[cacheKey] : undefined;

    const primary = cached?.nickname || cached?.name || snapshot?.nickname || snapshot?.name || deal?.locationName || '-';
    const city = cached?.city || snapshot?.city || snapshot?.address?.city || '';
    const state = cached?.state || snapshot?.state || snapshot?.address?.state || '';
    const secondary = [city, state].filter(Boolean).join(', ');
    const address = cached?.address || snapshot?.address || {};
    const line1 = typeof address === 'string' ? address : (address?.street || address?.line1 || address?.address || '');
    const zip = cached?.zipCode || cached?.zip || snapshot?.zipCode || snapshot?.zip || address?.zipCode || address?.zip || '';
    const addressParts = [
      line1,
      city,
      [state, zip].filter(Boolean).join(' '),
    ].filter(Boolean);
    const fullAddress = addressParts.join(', ');

    return {
      primary,
      secondary,
      fullAddress,
      sortValue: `${primary} ${secondary}`.trim().toLowerCase(),
      cacheKey,
    };
  };

  const getUserDealsCount = () => {
    // Count deals that belong to the current user using unified association logic
    const userDeals = AssociationUtils.getUserAssociatedDeals(allDeals, currentUser?.uid);
    if (process.env.NODE_ENV === 'development') {
      console.log(`🔍 User deals count: ${userDeals.length} for user ${currentUser?.uid}`);
    }
    return userDeals.length;
  };

  const escapeCsv = (v: string): string => {
    const s = String(v ?? '').replace(/"/g, '""');
    return /[",\n\r]/.test(s) ? `"${s}"` : s;
  };

  const handleExportOpportunitiesCsv = async () => {
    const latestNotesByDealId = await fetchLatestDealNotesMap(filteredDeals.map((deal) => deal?.id).filter(Boolean));
    const headers = ['Deal Name', 'Note', 'Company', 'Location', 'Decision maker', 'Stage', 'Initial Value', 'Potential Value', 'Markup %', 'Age', 'Status', 'Health', 'Expected Close', 'Expected Start', 'Actual Close', 'Owner'];
    const rows = filteredDeals.map((deal) => {
      const age = getDealAge(deal?.createdAt);
      const ageStr = age ? `${age.days}d` : '-';
      const status = getDealStatus(deal);
      const health = getDealHealth(deal);
      const dm = getDealDecisionMakerDisplay(deal);
      const location = getDealLocationDisplay(deal);
      const dmCsv = dm.name ? (dm.title ? `${dm.name} (${dm.title})` : dm.name) : '';
      const latestNote = latestNotesByDealId.get(deal.id) ?? '';
      return [
        escapeCsv(deal.name ?? ''),
        escapeCsv(latestNote),
        escapeCsv(getDealCompanyName(deal) ?? ''),
        escapeCsv(location.fullAddress ? `${location.primary} - ${location.fullAddress}` : (location.secondary ? `${location.primary} (${location.secondary})` : location.primary)),
        escapeCsv(dmCsv),
        escapeCsv(deal.stage ?? ''),
        escapeCsv(getDealInitialValue(deal)),
        escapeCsv(getDealPotentialValue(deal)),
        escapeCsv(getDealMarkupPercent(deal)),
        escapeCsv(ageStr),
        escapeCsv(status?.label ?? ''),
        escapeCsv(health?.bucket ?? String(health?.score ?? '')),
        escapeCsv(getDealCloseDate(deal)),
        escapeCsv(getDealExpectedStart(deal)),
        escapeCsv(getDealActualClose(deal)),
        escapeCsv(getDealOwner(deal) ?? ''),
      ];
    });
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `crm-opportunities-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  useImperativeHandle(ref, () => ({ exportCsv: () => { void handleExportOpportunitiesCsv(); } }), [handleExportOpportunitiesCsv]);

  const getDealOwner = (deal: any) => {
    // Helper to resolve a display name from a salesperson object or id
    const resolveFromId = (id: string): string => {
      // Try to find in the salesTeam array with multiple field matches
      const sp = salesTeam.find(s => (
        s.id === id || 
        s.uid === id || 
        s.userId === id || 
        s.userID === id || 
        s.docId === id || 
        s.email === id ||
        s.user_id === id ||
        s.userId === id
      ));
      
      if (sp) {
        const full = [sp.firstName, sp.lastName].filter(Boolean).join(' ').trim();
        return sp.name || sp.displayName || full || sp.email || id;
      }
      
      // If not found, return a more user-friendly version of the ID
      // For Firebase UIDs, show just the first 8 characters
      if (id && id.length > 20) {
        return `User ${id.substring(0, 8)}...`;
      }
      
      return id;
    };

    const names: string[] = [];
    const visited = new Set<string>();

    // Prefer associations.salespeople
    const assoc = (deal.associations?.salespeople || []) as any[];
    assoc.forEach((sp: any) => {
      let label = '';
      if (typeof sp === 'string') {
        label = resolveFromId(sp);
      } else if (sp && typeof sp === 'object') {
        // Check for snapshot data first (new structure)
        if (sp.snapshot) {
          const full = [sp.snapshot.firstName, sp.snapshot.lastName].filter(Boolean).join(' ').trim();
          label = sp.snapshot.displayName || sp.snapshot.name || full || sp.snapshot.email || (sp.id ? resolveFromId(sp.id) : 'Unknown');
        } else {
          // Fallback to direct properties (old structure)
          const full = [sp.firstName, sp.lastName].filter(Boolean).join(' ').trim();
          label = sp.name || sp.displayName || full || sp.email || (sp.id ? resolveFromId(sp.id) : 'Unknown');
        }
      }
      if (label && !visited.has(label)) {
        visited.add(label);
        names.push(label);
      }
    });

    if (names.length > 0) return names.join(', ');

    // Fallbacks
    if (deal.salesOwnerName) return deal.salesOwnerName;
    if (deal.salespeopleNames && deal.salespeopleNames.length > 0) return deal.salespeopleNames.join(', ');

    return '-';
  };

  const getDealCloseDate = (deal: any) => {
    const raw = deal.closeDate || deal.stageData?.qualification?.expectedCloseDate;
    if (!raw) return '-';
    const d = new Date(raw);
    if (isNaN(d.getTime())) return '-';
    // Format with UTC date parts so date-only values (YYYY-MM-DD) display correctly in all timezones
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    const y = d.getUTCFullYear();
    return `${m}/${day}/${y}`;
  };

  const formatDateOnly = (raw: any) => {
    if (!raw) return '-';
    const d = new Date(raw);
    if (isNaN(d.getTime())) return '-';
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    const y = d.getUTCFullYear();
    return `${m}/${day}/${y}`;
  };

  const getDealExpectedStart = (deal: any) => {
    const raw = deal.stageData?.qualification?.expectedStartDate;
    return formatDateOnly(raw);
  };

  const getDealActualClose = (deal: any) => {
    const raw = deal.stageData?.closedWon?.dateSigned;
    return formatDateOnly(raw);
  };

  const getDealDecisionMakerDisplay = (deal: any): { name: string; title: string | null } => {
    const dm = deal.stageData?.qualification?.decisionMaker;
    if (!dm) return { name: '', title: null };
    const name = dm.fullName || `${dm.firstName || ''} ${dm.lastName || ''}`.trim() || dm.name || '';
    const title = dm.title ? String(dm.title).trim() : null;
    return { name, title: title || null };
  };

  // Handle sorting
  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  // Get sortable value for a deal and field
  const getSortableValue = (deal: any, field: string) => {
    switch (field) {
      case 'name':
        return deal.name?.toLowerCase() || '';
      case 'company':
        return getDealCompanyName(deal)?.toLowerCase() || '';
      case 'location':
        return getDealLocationDisplay(deal).sortValue;
      case 'decisionMaker':
        return getDealDecisionMakerDisplay(deal).name.toLowerCase();
      case 'stage':
        return deal.stage?.toLowerCase() || '';
      case 'initialValue': {
        const valueStr = getDealInitialValue(deal);
        const numericValue = valueStr.replace(/[$,]/g, '');
        return parseFloat(numericValue) || 0;
      }
      case 'potentialValue': {
        const valueStr = getDealPotentialValue(deal);
        const numericValue = valueStr.replace(/[$,]/g, '');
        return parseFloat(numericValue) || 0;
      }
      case 'markupPercent': {
        const valueStr = getDealMarkupPercent(deal);
        const numericValue = valueStr.replace(/[%\s,]/g, '');
        return parseFloat(numericValue) || 0;
      }
      case 'createdAt': {
        // Sort by age (days since creation)
        const age = getDealAge(deal?.createdAt);
        return age ? age.days : 0;
      }
      case 'status': {
        const status = getDealStatus(deal);
        return status.label?.toLowerCase() || '';
      }
      case 'health': {
        const health = getDealHealth(deal);
        return health.score;
      }
      case 'closeDate': {
        const raw = deal.closeDate || deal.stageData?.qualification?.expectedCloseDate;
        return !raw ? new Date(0) : new Date(raw);
      }
      case 'expectedStart': {
        const raw = deal.stageData?.qualification?.expectedStartDate;
        return !raw ? new Date(0) : new Date(raw);
      }
      case 'actualClose': {
        const raw = deal.stageData?.closedWon?.dateSigned;
        return !raw ? new Date(0) : new Date(raw);
      }
      case 'owner':
        return getDealOwner(deal)?.toLowerCase() || '';
      default:
        return '';
    }
  };

  // Filter and sort deals
  const filteredDeals = React.useMemo(() => {
    let filtered = deals;
    
    // Filter by archived status
    if (showArchived) {
      // Archive tab: only show archived deals
      filtered = filtered.filter(deal => deal.archived === true);
    } else {
      // Opportunities tab: exclude archived deals
      filtered = filtered.filter(deal => deal.archived !== true);
    }
    
    // Apply deal filter (all vs my)
    if (dealFilter === 'my' && currentUser?.uid) {
      const beforeFilter = filtered.length;
      filtered = filtered.filter(deal => {
        // Use the unified association logic to check if deal is associated with current user
        return AssociationUtils.isDealAssociatedWithUser(deal, currentUser.uid);
      });
      
      if (process.env.NODE_ENV === 'development') {
        console.log(`🔍 Deal filtering: ${beforeFilter} -> ${filtered.length} deals for user ${currentUser.uid}`);
      }
    }
    
    // Apply salesperson filter
    if (selectedSalesperson !== 'all') {
      filtered = filtered.filter(deal => {
        const arr = (deal.associations?.salespeople || []) as any[];
        const matchAssoc = arr.some((sp: any) => {
          if (typeof sp === 'string') return sp === selectedSalesperson;
          return (
            sp?.id === selectedSalesperson ||
            sp?.uid === selectedSalesperson ||
            sp?.userId === selectedSalesperson ||
            sp?.userID === selectedSalesperson ||
            sp?.docId === selectedSalesperson ||
            sp?.email === selectedSalesperson
          );
        });
        // Fallback to legacy owner fields just in case
        const matchLegacy =
          deal.owner === selectedSalesperson ||
          deal.salesOwnerId === selectedSalesperson ||
          deal.accountOwnerId === selectedSalesperson;
        return matchAssoc || matchLegacy;
      });
    }
    
    // Apply search filter if search term exists
    if (search.trim()) {
      const searchLower = search.toLowerCase().trim();
      filtered = filtered.filter(deal => {
        // Search in deal name
        const dealNameMatch = deal.name?.toLowerCase().includes(searchLower);
        
        // Search in company name
        const companyName = getDealCompanyName(deal);
        const companyNameMatch = companyName?.toLowerCase().includes(searchLower);
        
        return dealNameMatch || companyNameMatch;
      });
    }
    
    // Sort the filtered deals
    filtered.sort((a, b) => {
      const aValue = getSortableValue(a, sortField);
      const bValue = getSortableValue(b, sortField);
      
      if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
    
    return filtered;
  }, [deals, dealFilter, currentUser?.uid, search, sortField, sortDirection, selectedSalesperson, showArchived]);

  useEffect(() => {
    if (!tenantId || filteredDeals.length === 0) return;

    const candidates = filteredDeals
      .map((deal) => {
        const locations = (deal?.associations?.locations || []) as any[];
        const locationEntry = locations[0] ?? (deal?.locationId ? { id: deal.locationId } : null);
        if (!locationEntry) return null;

        const locationId = typeof locationEntry === 'string' ? locationEntry : locationEntry.id;
        if (!locationId) return null;

        const companyId = typeof locationEntry === 'object'
          ? (locationEntry.companyId || getDealPrimaryCompanyId(deal) || deal?.companyId || '')
          : (getDealPrimaryCompanyId(deal) || deal?.companyId || '');
        const cacheKey = `${companyId || 'root'}:${locationId}`;
        if (dealLocationDetailsMap[cacheKey]) return null;

        const snapshot = typeof locationEntry === 'object' ? (locationEntry.snapshot || locationEntry) : {};
        const hasEnoughData = (snapshot?.nickname || snapshot?.name || deal?.locationName) && (snapshot?.city || snapshot?.state || snapshot?.address?.city || snapshot?.address?.state);
        if (hasEnoughData) return null;

        return { cacheKey, companyId, locationId };
      })
      .filter(Boolean) as Array<{ cacheKey: string; companyId: string; locationId: string }>;

    if (candidates.length === 0) return;

    let cancelled = false;

    void (async () => {
      const updates: Record<string, { name?: string; nickname?: string; city?: string; state?: string; address?: any; zipCode?: string; zip?: string }> = {};

      await Promise.all(
        candidates.map(async ({ cacheKey, companyId, locationId }) => {
          try {
            let data: any = null;

            if (companyId) {
              const nestedRef = doc(db, `tenants/${tenantId}/crm_companies/${companyId}/locations/${locationId}`);
              const nestedSnap = await getDoc(nestedRef);
              if (nestedSnap.exists()) data = nestedSnap.data();
            }

            if (!data) {
              const topRef = doc(db, `tenants/${tenantId}/crm_locations/${locationId}`);
              const topSnap = await getDoc(topRef);
              if (topSnap.exists()) data = topSnap.data();
            }

            if (data) {
              updates[cacheKey] = {
                name: data.name,
                nickname: data.nickname,
                city: data.city || data.address?.city,
                state: data.state || data.address?.state,
                address: data.address,
                zipCode: data.zipCode || data.address?.zipCode,
                zip: data.zip || data.address?.zip,
              };
            }
          } catch {}
        })
      );

      if (!cancelled && Object.keys(updates).length > 0) {
        setDealLocationDetailsMap((prev) => ({ ...prev, ...updates }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tenantId, filteredDeals, dealLocationDetailsMap]);

  // Reset pagination when search/filters change (Inbox standard)
  useEffect(() => {
    setDealPage(0);
  }, [search, dealFilter, selectedSalesperson, showArchived]);

  const paginatedDeals = React.useMemo(() => {
    return filteredDeals.slice(dealPage * dealRowsPerPage, dealPage * dealRowsPerPage + dealRowsPerPage);
  }, [filteredDeals, dealPage, dealRowsPerPage]);



  const handleEditDeal = (deal: any) => {
    setEditingDeal(deal);
    setDealForm({
      name: deal.name || '',
      estimatedRevenue: deal.estimatedRevenue || '',
      stage: deal.stage || '',
      companyId: getDealPrimaryCompanyId(deal) || '',
      contactIds: (deal.associations?.contacts || []).map((c: any) => typeof c === 'string' ? c : c?.id).filter(Boolean),
      description: deal.description || '',
      closeDate: deal.closeDate || '',
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

  // Handle creating new opportunity
  const handleCreateNewOpportunity = async () => {
    if (!newOpportunityForm.name || !newOpportunityForm.companyId) {
      return; // Basic validation
    }

    try {
      // Create the new opportunity
      const opportunityData = {
        name: newOpportunityForm.name,
        companyId: newOpportunityForm.companyId,
        primaryCompanyId: newOpportunityForm.companyId,
        stage: 'qualification', // Default stage
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        associations: {
          companies: [newOpportunityForm.companyId],
          salespeople: [currentUser?.uid].filter(Boolean),
          locations: newOpportunityForm.locationId ? [newOpportunityForm.locationId] : [],
        },
        // Add location data if selected
        ...(newOpportunityForm.locationId && { locationId: newOpportunityForm.locationId }),
      } as any;

      const opportunitiesRef = collection(db, `tenants/${tenantId}/crm_deals`);
      const docRef = await addDoc(opportunitiesRef, opportunityData);

      // Close dialog and reset form
      onOpportunityDialogOpenChange(false);
      setNewOpportunityForm({
        name: '',
        companyId: '',
        divisionId: '',
        locationId: '',
      });
      setSelectedCompany(null);
      setCompanyDivisions([]);
      setCompanyLocations([]);

      // Navigate to the new opportunity details
      navigate(`/crm/deals/${docRef.id}`);
    } catch (error) {
      console.error('Error creating new opportunity:', error);
      // You might want to show an error message to the user
    }
  };

  const dealHeaderCellSx = {
    padding: '4px 12px',
    fontSize: '11px',
    fontWeight: 500,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
    color: 'rgba(0, 0, 0, 0.85)',
    height: '32px',
    bgcolor: '#FFFFFF',
    borderBottom: '1px solid #E5E7EB',
    whiteSpace: 'nowrap' as const,
  };

  return (
    <Box sx={{ px: 2, pb: 2 }}>
      {/* Header with search and actions */}
      {/* <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h6" sx={{ fontWeight: 600, color: '#111827' }}>
          Opportunities ({filteredDeals.length})
        </Typography>

      </Box> */}

      {/* Filter & Toolbar Area - Consolidated with card background */}
      <Box
        ref={filtersRef}
        sx={{ 
          // Tight + sticky (Inbox/Contacts standard)
          mt: 0,
          mb: 0,
          px: 1.5,
          py: 1.25,
          backgroundColor: '#F9FAFB',
          borderTopLeftRadius: 8,
          borderTopRightRadius: 8,
          border: '1px solid #E5E7EB',
          borderBottom: '1px solid #EAEEF4',
          overflowX: 'auto',
          overflowY: 'hidden',
          position: 'sticky',
          top: 0,
          zIndex: 15,
          '&::-webkit-scrollbar': { height: '6px' },
          '&::-webkit-scrollbar-track': { background: 'rgba(0, 0, 0, 0.02)', borderRadius: '4px' },
          '&::-webkit-scrollbar-thumb': { background: 'rgba(0, 0, 0, 0.15)', borderRadius: '4px', '&:hover': { background: 'rgba(0, 0, 0, 0.25)' } },
          scrollbarWidth: 'thin',
          scrollbarColor: 'rgba(0, 0, 0, 0.15) rgba(0, 0, 0, 0.02)',
        }}
      >
        <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'nowrap', minWidth: 'max-content', width: '100%' }}>
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
            sx={{ 
              height: 36,
              '& .MuiToggleButton-root': {
                px: 2.5,
                py: 0.75,
                fontSize: '0.8125rem',
                fontWeight: 500,
                borderRadius: '18px',
                border: '1px solid #E5E7EB',
                color: '#6B7280',
                backgroundColor: 'white',
                '&.Mui-selected': {
                  backgroundColor: '#0B63C5',
                  color: 'white',
                  '&:hover': {
                    backgroundColor: '#0B63C5',
                  }
                },
                '&:hover': {
                  backgroundColor: '#F3F4F6',
                }
              }
            }}
          >
            <ToggleButton value="all" sx={{ mr: 1 }}>
              {showArchived ? 'All Archive' : 'All Opportunities'}
            </ToggleButton>
            <ToggleButton value="my">
              {showArchived ? 'My Archive' : 'My Opportunities'}
            </ToggleButton>
          </ToggleButtonGroup>
          
          {/* Salesperson Filter */}
          <FormControl size="small" sx={{ minWidth: 220, height: 36 }}>
            <InputLabel sx={{ fontSize: '0.875rem' }}>Salesperson</InputLabel>
            <Select
              value={selectedSalesperson}
              onChange={(e) => setSelectedSalesperson(e.target.value)}
              label="Salesperson"
              sx={{
                height: 36,
                borderRadius: '6px',
                backgroundColor: 'white',
                fontSize: '0.875rem',
                '& .MuiOutlinedInput-notchedOutline': {
                  borderColor: '#E5E7EB',
                },
                '&:hover .MuiOutlinedInput-notchedOutline': {
                  borderColor: '#D1D5DB',
                },
              }}
            >
              <MenuItem value="all">All Salespeople</MenuItem>
              {salesTeam.map((salesperson) => {
                const key = getSalespersonKey(salesperson);
                const label = getSalespersonDisplay(salesperson);
                return (
                  <MenuItem key={key} value={key}>
                    {label}
                  </MenuItem>
                );
              })}
            </Select>
          </FormControl>
          <Box sx={{ marginLeft: 'auto', flexShrink: 0 }}>
            <Button
              variant="outlined"
              size="small"
              startIcon={<FileDownloadIcon />}
              onClick={handleExportOpportunitiesCsv}
              disabled={filteredDeals.length === 0}
              sx={{
                height: 36,
                borderRadius: '6px',
                fontSize: '0.875rem',
                textTransform: 'none',
              }}
            >
              Export CSV
            </Button>
          </Box>
        </Box>
      </Box>
      
      {/* Deals Table */}
        <TableContainer
          component={Paper}
          variant="outlined"
          elevation={0}
          sx={{ 
            borderRadius: 0,
            borderLeft: '1px solid #E5E7EB',
            borderRight: '1px solid #E5E7EB',
            borderBottom: filteredDeals.length > 0 ? 'none' : '1px solid #E5E7EB',
            borderTop: 'none',
            borderBottomLeftRadius: filteredDeals.length > 0 ? 0 : 8,
            borderBottomRightRadius: filteredDeals.length > 0 ? 0 : 8,
            boxShadow: 'none',
            mt: 0,
            pt: 0,
            px: 2, // Inbox padding
            pb: 1,
            overflowX: 'auto',
            overflowY: 'auto',
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            '&::-webkit-scrollbar': { width: '8px', height: '8px' },
            '&::-webkit-scrollbar-track': { background: 'rgba(0, 0, 0, 0.02)', borderRadius: '4px' },
            '&::-webkit-scrollbar-thumb': { background: 'rgba(0, 0, 0, 0.15)', borderRadius: '4px', '&:hover': { background: 'rgba(0, 0, 0, 0.25)' } },
            scrollbarWidth: 'thin',
            scrollbarColor: 'rgba(0, 0, 0, 0.15) rgba(0, 0, 0, 0.02)',
          }}
          data-testid="customers-list"
        >
          <Table size="small" stickyHeader sx={{ minWidth: 1520, width: '100%' }} data-testid="customers-table">
          <TableHead
            sx={{
              '& .MuiTableCell-root': {
                bgcolor: '#FFFFFF',
                position: 'sticky',
                top: isScrolled ? filtersHeight : 0,
                zIndex: 12,
              },
            }}
          >
            <TableRow sx={{ backgroundColor: '#FFFFFF' }}>
              <TableCell sx={{ ...dealHeaderCellSx, width: 250, minWidth: 250 }}>
                <TableSortLabel
                  active={sortField === 'name'}
                  direction={sortField === 'name' ? sortDirection : 'asc'}
                  onClick={() => handleSort('name')}
                  sx={{ 
                    fontSize: '11px',
                    fontWeight: 500,
                    color: 'rgba(0, 0, 0, 0.85)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    '& .MuiTableSortLabel-icon': {
                      fontSize: '1rem',
                      opacity: sortField === 'name' ? 1 : 0.3,
                    },
                  }}
                >
                  Deal Name
                </TableSortLabel>
              </TableCell>
              <TableCell sx={{ ...dealHeaderCellSx, width: 56, minWidth: 56 }}>
                Note
              </TableCell>
              <TableCell sx={{ ...dealHeaderCellSx, width: 150, minWidth: 150 }}>
                <TableSortLabel
                  active={sortField === 'company'}
                  direction={sortField === 'company' ? sortDirection : 'asc'}
                  onClick={() => handleSort('company')}
                  sx={{ 
                    fontSize: '11px',
                    fontWeight: 500,
                    color: 'rgba(0, 0, 0, 0.85)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    '& .MuiTableSortLabel-icon': {
                      fontSize: '1rem',
                      opacity: sortField === 'company' ? 1 : 0.3,
                    },
                  }}
                >
                  Company
                </TableSortLabel>
              </TableCell>
              <TableCell sx={{ ...dealHeaderCellSx, width: 170, minWidth: 170 }}>
                <TableSortLabel
                  active={sortField === 'location'}
                  direction={sortField === 'location' ? sortDirection : 'asc'}
                  onClick={() => handleSort('location')}
                  sx={{
                    fontSize: '11px',
                    fontWeight: 500,
                    color: 'rgba(0, 0, 0, 0.85)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    '& .MuiTableSortLabel-icon': {
                      fontSize: '1rem',
                      opacity: sortField === 'location' ? 1 : 0.3,
                    },
                  }}
                >
                  Location
                </TableSortLabel>
              </TableCell>
              <TableCell sx={{ ...dealHeaderCellSx, width: 140, minWidth: 140 }}>
                <TableSortLabel
                  active={sortField === 'decisionMaker'}
                  direction={sortField === 'decisionMaker' ? sortDirection : 'asc'}
                  onClick={() => handleSort('decisionMaker')}
                  sx={{
                    fontSize: '11px',
                    fontWeight: 500,
                    color: 'rgba(0, 0, 0, 0.85)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    '& .MuiTableSortLabel-icon': {
                      fontSize: '1rem',
                      opacity: sortField === 'decisionMaker' ? 1 : 0.3,
                    },
                  }}
                >
                  Decision maker
                </TableSortLabel>
              </TableCell>
              <TableCell sx={{ ...dealHeaderCellSx, width: 120, minWidth: 120 }}>
                <TableSortLabel
                  active={sortField === 'stage'}
                  direction={sortField === 'stage' ? sortDirection : 'asc'}
                  onClick={() => handleSort('stage')}
                  sx={{ 
                    fontSize: '11px',
                    fontWeight: 500,
                    color: 'rgba(0, 0, 0, 0.85)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    '& .MuiTableSortLabel-icon': {
                      fontSize: '1rem',
                      opacity: sortField === 'stage' ? 1 : 0.3,
                    },
                  }}
                >
                  Stage
                </TableSortLabel>
              </TableCell>
              <TableCell sx={{ ...dealHeaderCellSx, width: 110, minWidth: 110, textAlign: 'right' }}>
                <TableSortLabel
                  active={sortField === 'initialValue'}
                  direction={sortField === 'initialValue' ? sortDirection : 'asc'}
                  onClick={() => handleSort('initialValue')}
                  sx={{ 
                    fontSize: '11px',
                    fontWeight: 500,
                    color: 'rgba(0, 0, 0, 0.85)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    '& .MuiTableSortLabel-icon': {
                      fontSize: '1rem',
                      opacity: sortField === 'initialValue' ? 1 : 0.3,
                    },
                  }}
                >
                  Initial Value
                </TableSortLabel>
              </TableCell>
              <TableCell sx={{ ...dealHeaderCellSx, width: 110, minWidth: 110, textAlign: 'right' }}>
                <TableSortLabel
                  active={sortField === 'potentialValue'}
                  direction={sortField === 'potentialValue' ? sortDirection : 'asc'}
                  onClick={() => handleSort('potentialValue')}
                  sx={{ 
                    fontSize: '11px',
                    fontWeight: 500,
                    color: 'rgba(0, 0, 0, 0.85)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    '& .MuiTableSortLabel-icon': {
                      fontSize: '1rem',
                      opacity: sortField === 'potentialValue' ? 1 : 0.3,
                    },
                  }}
                >
                  Potential Value
                </TableSortLabel>
              </TableCell>
              <TableCell sx={{ ...dealHeaderCellSx, width: 90, minWidth: 90, textAlign: 'right' }}>
                <TableSortLabel
                  active={sortField === 'markupPercent'}
                  direction={sortField === 'markupPercent' ? sortDirection : 'asc'}
                  onClick={() => handleSort('markupPercent')}
                  sx={{
                    fontSize: '11px',
                    fontWeight: 500,
                    color: 'rgba(0, 0, 0, 0.85)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    '& .MuiTableSortLabel-icon': {
                      fontSize: '1rem',
                      opacity: sortField === 'markupPercent' ? 1 : 0.3,
                    },
                  }}
                >
                  Markup %
                </TableSortLabel>
              </TableCell>
              <TableCell sx={{ ...dealHeaderCellSx, width: 100, minWidth: 100 }}>
                <TableSortLabel
                  active={sortField === 'createdAt'}
                  direction={sortField === 'createdAt' ? sortDirection : 'asc'}
                  onClick={() => handleSort('createdAt')}
                  sx={{ 
                    fontSize: '11px',
                    fontWeight: 500,
                    color: 'rgba(0, 0, 0, 0.85)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    '& .MuiTableSortLabel-icon': {
                      fontSize: '1rem',
                      opacity: sortField === 'createdAt' ? 1 : 0.3,
                    },
                  }}
                >
                  Age
                </TableSortLabel>
              </TableCell>
              <TableCell sx={{ ...dealHeaderCellSx, width: 100, minWidth: 100 }}>
                <TableSortLabel
                  active={sortField === 'status'}
                  direction={sortField === 'status' ? sortDirection : 'asc'}
                  onClick={() => handleSort('status')}
                  sx={{ 
                    fontSize: '11px',
                    fontWeight: 500,
                    color: 'rgba(0, 0, 0, 0.85)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    '& .MuiTableSortLabel-icon': {
                      fontSize: '1rem',
                      opacity: sortField === 'status' ? 1 : 0.3,
                    },
                  }}
                >
                  Status
                </TableSortLabel>
              </TableCell>
              <TableCell sx={{ ...dealHeaderCellSx, width: 100, minWidth: 100 }}>
                <TableSortLabel
                  active={sortField === 'health'}
                  direction={sortField === 'health' ? sortDirection : 'asc'}
                  onClick={() => handleSort('health')}
                  sx={{ 
                    fontSize: '11px',
                    fontWeight: 500,
                    color: 'rgba(0, 0, 0, 0.85)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    '& .MuiTableSortLabel-icon': {
                      fontSize: '1rem',
                      opacity: sortField === 'health' ? 1 : 0.3,
                    },
                  }}
                >
                  Health
                </TableSortLabel>
              </TableCell>
              <TableCell sx={{ ...dealHeaderCellSx, width: 120, minWidth: 120 }}>
                <TableSortLabel
                  active={sortField === 'closeDate'}
                  direction={sortField === 'closeDate' ? sortDirection : 'asc'}
                  onClick={() => handleSort('closeDate')}
                  sx={{ 
                    fontSize: '11px',
                    fontWeight: 500,
                    color: 'rgba(0, 0, 0, 0.85)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    '& .MuiTableSortLabel-icon': {
                      fontSize: '1rem',
                      opacity: sortField === 'closeDate' ? 1 : 0.3,
                    },
                  }}
                >
                  Expected Close
                </TableSortLabel>
              </TableCell>
              <TableCell sx={{ ...dealHeaderCellSx, width: 120, minWidth: 120 }}>
                <TableSortLabel
                  active={sortField === 'expectedStart'}
                  direction={sortField === 'expectedStart' ? sortDirection : 'asc'}
                  onClick={() => handleSort('expectedStart')}
                  sx={{
                    fontSize: '11px',
                    fontWeight: 500,
                    color: 'rgba(0, 0, 0, 0.85)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    '& .MuiTableSortLabel-icon': {
                      fontSize: '1rem',
                      opacity: sortField === 'expectedStart' ? 1 : 0.3,
                    },
                  }}
                >
                  Expected Start
                </TableSortLabel>
              </TableCell>
              <TableCell sx={{ ...dealHeaderCellSx, width: 120, minWidth: 120 }}>
                <TableSortLabel
                  active={sortField === 'actualClose'}
                  direction={sortField === 'actualClose' ? sortDirection : 'asc'}
                  onClick={() => handleSort('actualClose')}
                  sx={{
                    fontSize: '11px',
                    fontWeight: 500,
                    color: 'rgba(0, 0, 0, 0.85)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    '& .MuiTableSortLabel-icon': {
                      fontSize: '1rem',
                      opacity: sortField === 'actualClose' ? 1 : 0.3,
                    },
                  }}
                >
                  Actual Close
                </TableSortLabel>
              </TableCell>
              <TableCell sx={{ ...dealHeaderCellSx, width: 100, minWidth: 100 }}>
                <TableSortLabel
                  active={sortField === 'owner'}
                  direction={sortField === 'owner' ? sortDirection : 'asc'}
                  onClick={() => handleSort('owner')}
                  sx={{ 
                    fontSize: '11px',
                    fontWeight: 500,
                    color: 'rgba(0, 0, 0, 0.85)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    '& .MuiTableSortLabel-icon': {
                      fontSize: '1rem',
                      opacity: sortField === 'owner' ? 1 : 0.3,
                    },
                  }}
                >
                  Owner
                </TableSortLabel>
              </TableCell>

            </TableRow>
          </TableHead>
          <TableBody>
            {filteredDeals.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={16}
                  sx={{
                    py: 6,
                    textAlign: 'center',
                    color: 'text.secondary',
                    borderBottom: '1px solid',
                    borderColor: 'divider',
                  }}
                >
                  {showArchived ? 'No archived opportunities' : 'No opportunities'}
                </TableCell>
              </TableRow>
            ) : (
              paginatedDeals.map((deal, index) => (
                <TableRow 
                  key={deal.id} 
                  hover
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (deal.id) {
                      navigate(`/crm/deals/${deal.id}`);
                    }
                  }}
                  sx={{ 
                    height: '36px',
                    cursor: 'pointer',
                    bgcolor: index % 2 === 0 ? 'background.paper' : '#FAFAFA',
                    '& td': {
                      borderBottom: '1px solid',
                      borderColor: 'divider',
                    },
                    '&:hover': {
                      backgroundColor: '#F9FAFB'
                    }
                  }}
                >
                <TableCell sx={{ px: 1.5, py: 0.75 }}>
                  <Typography 
                    variant="body2" 
                    fontWeight={600}
                    sx={{ fontSize: '0.9375rem' }}
                  >
                    {deal.name}
                  </Typography>
                </TableCell>
                <TableCell sx={{ px: 0.5, py: 0.75 }}>
                  <Tooltip title="View most recent note">
                    <span>
                      <IconButton
                        size="small"
                        onClick={(e) => handleNoteIconClick(e, deal)}
                        sx={{ color: 'primary.main' }}
                        aria-label="View note"
                      >
                        <NoteIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                </TableCell>
                <TableCell sx={{ px: 1.5, py: 0.75 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Avatar 
                      src={(() => {
                        const primaryId = getDealPrimaryCompanyId(deal);
                        if (primaryId) {
                          // First try to find in the filtered companies array
                          let company = companies.find(c => c.id === primaryId);
                          // If not found, try in allCompanies (for deals with companies not in current filter)
                          if (!company && allCompanies) {
                            company = allCompanies.find(c => c.id === primaryId);
                          }
                          return company?.logo || company?.logoUrl || company?.logo_url || company?.avatar;
                        }
                        return null;
                      })()}
                      sx={{ 
                        width: 24, 
                        height: 24,
                        backgroundColor: getAvatarColor(getDealCompanyName(deal) || ''),
                        color: getAvatarTextColor(getDealCompanyName(deal) || ''),
                        fontWeight: 600,
                        fontSize: '10px'
                      }}
                    >
                      {getDealCompanyName(deal)?.charAt(0)?.toUpperCase() || '?'}
                    </Avatar>
                    <Typography variant="body2" color="#6B7280" sx={{ fontSize: '0.875rem' }}>
                      {getDealCompanyName(deal)}
                    </Typography>
                  </Box>
                </TableCell>
                <TableCell sx={{ px: 1.5, py: 0.75 }}>
                  {(() => {
                    const location = getDealLocationDisplay(deal);
                    if (!location.primary || location.primary === '-') {
                      return <Typography variant="body2" color="#6B7280" sx={{ fontSize: '0.875rem' }}>—</Typography>;
                    }
                    return (
                      <Box>
                        <Typography variant="body2" color="#374151" sx={{ fontSize: '0.875rem', fontWeight: 500 }}>
                          {location.primary}
                        </Typography>
                        {location.secondary && (
                          <Typography variant="caption" color="text.secondary" display="block" sx={{ fontSize: '0.75rem' }}>
                            {location.secondary}
                          </Typography>
                        )}
                      </Box>
                    );
                  })()}
                </TableCell>
                <TableCell sx={{ px: 1.5, py: 0.75 }}>
                  {(() => {
                    const dm = getDealDecisionMakerDisplay(deal);
                    if (!dm.name) {
                      return <Typography variant="body2" color="#6B7280" sx={{ fontSize: '0.875rem' }}>—</Typography>;
                    }
                    return (
                      <Box>
                        <Typography variant="body2" color="#374151" sx={{ fontSize: '0.875rem', fontWeight: 500 }}>
                          {dm.name}
                        </Typography>
                        {dm.title && (
                          <Typography variant="caption" color="text.secondary" display="block" sx={{ fontSize: '0.75rem' }}>
                            {dm.title}
                          </Typography>
                        )}
                      </Box>
                    );
                  })()}
                </TableCell>
                <TableCell sx={{ px: 1.5, py: 0.75 }}>
                  <StageChip 
                    stage={deal.stage} 
                    size="small" 
                    useCustomColors={true}
                  />
                </TableCell>
                <TableCell sx={{ px: 1.5, py: 0.75, textAlign: 'right' }}>
                  <Typography 
                    variant="body2" 
                    fontWeight={500}
                    color="#374151"
                    sx={{ fontSize: '0.8125rem' }}
                  >
                    {getDealInitialValue(deal)}
                  </Typography>
                </TableCell>
                <TableCell sx={{ px: 1.5, py: 0.75, textAlign: 'right' }}>
                  <Typography 
                    variant="body2" 
                    fontWeight={500}
                    color="#374151"
                    sx={{ fontSize: '0.8125rem' }}
                  >
                    {getDealPotentialValue(deal)}
                  </Typography>
                </TableCell>
                <TableCell sx={{ px: 1.5, py: 0.75, textAlign: 'right' }}>
                  <Typography
                    variant="body2"
                    fontWeight={500}
                    color="#374151"
                    sx={{ fontSize: '0.8125rem' }}
                  >
                    {getDealMarkupPercent(deal)}
                  </Typography>
                </TableCell>
                <TableCell sx={{ px: 1.5, py: 0.75 }}>
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
                <TableCell sx={{ px: 1.5, py: 0.75 }}>
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
                <TableCell sx={{ px: 1.5, py: 0.75 }}>
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
                <TableCell sx={{ px: 1.5, py: 0.75 }}>
                  <Typography variant="body2" color="#6B7280" sx={{ fontSize: '0.875rem' }}>
                    {getDealCloseDate(deal)}
                  </Typography>
                </TableCell>
                <TableCell sx={{ px: 1.5, py: 0.75 }}>
                  <Typography variant="body2" color="#6B7280" sx={{ fontSize: '0.875rem' }}>
                    {getDealExpectedStart(deal)}
                  </Typography>
                </TableCell>
                <TableCell sx={{ px: 1.5, py: 0.75 }}>
                  <Typography variant="body2" color="#6B7280" sx={{ fontSize: '0.875rem' }}>
                    {getDealActualClose(deal)}
                  </Typography>
                </TableCell>
                <TableCell sx={{ px: 1.5, py: 0.75 }}>
                  <Typography variant="body2" color="#6B7280" sx={{ fontSize: '0.875rem' }}>
                    {getDealOwner(deal)}
                  </Typography>
                </TableCell>

                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {filteredDeals.length > 0 && (
        <Box sx={{ 
          borderLeft: '1px solid #E5E7EB',
          borderRight: '1px solid #E5E7EB',
          borderBottom: '1px solid #E5E7EB',
          borderBottomLeftRadius: 8,
          borderBottomRightRadius: 8,
          backgroundColor: '#FFFFFF',
          mt: -1, // Overlap with table container border
        }}>
          <StandardTablePagination
            count={filteredDeals.length}
            page={dealPage}
            onPageChange={(_, newPage) => setDealPage(newPage)}
            rowsPerPage={dealRowsPerPage}
            onRowsPerPageChange={(e) => {
              setDealRowsPerPage(parseInt(e.target.value, 10));
              setDealPage(0);
            }}
          />
        </Box>
      )}

      {/* Note modal – most recent note for selected deal */}
      <Dialog open={noteModalOpen} onClose={() => setNoteModalOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Note – {noteModalDealName}</DialogTitle>
        <DialogContent>
          {noteModalTimestamp != null && (
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
              {noteModalTimestamp.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
            </Typography>
          )}
          {noteModalContent != null && (
            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{noteModalContent}</Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setNoteModalOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={!!noteModalSnackbar}
        autoHideDuration={3000}
        onClose={() => setNoteModalSnackbar(null)}
        message={noteModalSnackbar}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />

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
                label="Estimated Revenue"
                type="number"
                value={dealForm.estimatedRevenue}
                onChange={(e) => setDealForm(prev => ({ ...prev, estimatedRevenue: e.target.value }))}
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
                label="Estimated Close Date"
                type="date"
                value={dealForm.closeDate}
                onChange={(e) => setDealForm(prev => ({ ...prev, closeDate: e.target.value }))}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Salesperson"
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

      {/* New Opportunity Dialog */}
      <Dialog open={opportunityDialogOpen} onClose={() => onOpportunityDialogOpenChange(false)} maxWidth="md" fullWidth>
        <DialogTitle>Create New Opportunity</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Opportunity Name"
                value={newOpportunityForm.name}
                onChange={(e) => setNewOpportunityForm(prev => ({ ...prev, name: e.target.value }))}
                required
              />
            </Grid>
            <Grid item xs={12}>
              <Autocomplete
                options={allCompanies}
                getOptionLabel={(option) => option.companyName || option.name || ''}
                value={selectedCompany}
                onChange={(event, newValue) => {
                  setSelectedCompany(newValue);
                  if (newValue) {
                    handleCompanySelection(newValue);
                  } else {
                    setNewOpportunityForm(prev => ({ ...prev, companyId: '' }));
                    setCompanyDivisions([]);
                    setCompanyLocations([]);
                  }
                }}
                loading={loadingAllCompanies}
                isOptionEqualToValue={(option, value) => option.id === value.id}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Company"
                    required
                  />
                )}
              />
            </Grid>
            {/* Division dropdown removed per request */}
            {companyLocations.length > 0 && (
              <Grid item xs={12}>
                <FormControl fullWidth>
                  <InputLabel>Company Location (Optional)</InputLabel>
                  <Select
                    value={newOpportunityForm.locationId}
                    onChange={(e) => setNewOpportunityForm(prev => ({ ...prev, locationId: e.target.value }))}
                    label="Company Location (Optional)"
                  >
                    <MenuItem value="">Skip Location</MenuItem>
                    {companyLocations.map((location) => (
                      <MenuItem key={location.id} value={location.id}>
                        {location.name}{location.code ? ` [${location.code}]` : ''}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
            )}
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => onOpportunityDialogOpenChange(false)}>Cancel</Button>
          <Button 
            onClick={handleCreateNewOpportunity} 
            variant="contained"
            disabled={!newOpportunityForm.name || !newOpportunityForm.companyId}
          >
            Create Opportunity
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
});
  /* eslint-enable react/prop-types */

// Admin helper: run duplicate cleanup via callable
const DuplicateCleanupButton: React.FC<{ tenantId: string }> = ({ tenantId }) => {
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState<any>(null);
  const handleRun = async (apply: boolean) => {
    try {
      setBusy(true);
      const fn = httpsCallable(getFunctions(), 'deleteDuplicateCompanies');
      const res: any = await fn({ tenantId, apply, mode: 'both' });
      setLastResult(res.data);
    } catch (e) {
      console.error('Duplicate cleanup error', e);
      setLastResult({ ok: false, error: String((e as any)?.message || e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Box sx={{ display: 'flex', gap: 1 }}>
      <Button size="small" variant="outlined" disabled={busy} onClick={() => handleRun(false)}>
        {busy ? 'Running…' : 'Find Duplicates'}
      </Button>
      <Button size="small" variant="outlined" color="error" disabled={busy} onClick={() => handleRun(true)}>
        {busy ? 'Applying…' : 'Delete Duplicates'}
      </Button>
      {lastResult && (
        <Typography variant="caption" color={lastResult.ok ? 'text.secondary' : 'error'} sx={{ ml: 1 }}>
          {lastResult.ok
            ? `Groups: ${lastResult.duplicateGroups}, deletions: ${lastResult.deleted || 0}`
            : `Error: ${lastResult.error}`}
        </Typography>
      )}
    </Box>
  );
};
// Pipeline Tab Component
const PipelineTab: React.FC<{
  deals: any[];
  companies: any[];
  pipelineStages: any[];
  salesTeam: any[];
  currentUser: any;
  filters: any;
  onFiltersChange: (filters: any) => void;
}> = ({ deals, companies, pipelineStages, salesTeam, currentUser, filters, onFiltersChange }) => {
  const navigate = useNavigate();
  // Stage selection disabled - chart should not filter by stage clicks
  const [filteredDeals, setFilteredDeals] = React.useState<any[]>(deals);
  const [viewMode, setViewMode] = React.useState<'funnel' | 'bubble'>('funnel');
  const [bubbleColorMode, setBubbleColorMode] = React.useState<'stage' | 'owner' | 'health'>('stage');
  
  // Helper function to get avatar background color - softer pastel palette
  const getAvatarColor = (name: string) => {
    const colors = [
      '#E3F2FD', '#F3E5F5', '#E8F5E8', '#FFF3E0', '#FCE4EC',
      '#F1F8E9', '#E0F2F1', '#F9FBE7', '#E8EAF6', '#FFF8E1',
      '#F3E5F5', '#E1F5FE', '#F1F8E9', '#FFF3E0', '#E8F5E8'
    ];
    const index = name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) % colors.length;
    return colors[index];
  };

  // Helper function to get avatar text color
  const getAvatarTextColor = (name: string) => {
    const colors = [
      '#1976D2', '#7B1FA2', '#388E3C', '#F57C00', '#C2185B',
      '#689F38', '#009688', '#AFB42B', '#3F51B5', '#FF8F00',
      '#7B1FA2', '#0277BD', '#689F38', '#F57C00', '#388E3C'
    ];
    const index = name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) % colors.length;
    return colors[index];
  };

  // Company logo/name cache fetched from crm_companies for Pipeline view
  const { tenantId } = useAuth();
  const [companyDocCache, setCompanyDocCache] = React.useState<Record<string, { name: string; logo: string | null }>>({});

  React.useEffect(() => {
    if (!tenantId || !Array.isArray(deals) || deals.length === 0) return;
    const ids = new Set<string>();
    deals.forEach((deal: any) => {
      const primaryId = getDealPrimaryCompanyId(deal);
      if (primaryId && !companyDocCache[primaryId]) ids.add(primaryId);
      const assoc = deal.associations?.companies;
      if (!primaryId && Array.isArray(assoc) && assoc.length > 0) {
        const primaryCompany = assoc.find((c: any) => c?.isPrimary || c?.primary || c?.snapshot?.type === 'primary');
        const fc = primaryCompany || assoc[0];
        const assocId = typeof fc === 'string' ? fc : fc?.id;
        if (assocId && !companyDocCache[assocId]) ids.add(assocId);
      }
    });
    if (ids.size === 0) return;
    const fetchAll = async () => {
      const updates: Record<string, { name: string; logo: string | null }> = {};
      await Promise.all(Array.from(ids).map(async (id) => {
        try {
          const snap = await getDoc(doc(db, 'tenants', tenantId, 'crm_companies', id));
          if (snap.exists()) {
            const data: any = snap.data();
            updates[id] = { name: data.companyName || data.name || data.legalName || '', logo: data.logo || data.logoUrl || data.logo_url || data.avatar || null };
          } else {
            updates[id] = { name: '', logo: null };
          }
        } catch {
          updates[id] = { name: '', logo: null };
        }
      }));
      setCompanyDocCache((prev) => ({ ...prev, ...updates }));
    };
    fetchAll();
  }, [tenantId, deals]);

  // Helper function to get company information with fallbacks
  const getDealCompanyInfo = (deal: any) => {
    // First try to get company from primary company ID
    const primaryId = getDealPrimaryCompanyId(deal);
    if (primaryId) {
      const company = companies.find(c => c.id === primaryId);
      if (company) {
        return {
          name: company.companyName || company.name || company.legalName,
          logo: company.logo || company.logoUrl || company.logo_url || company.avatar,
          id: company.id
        };
      }
      // Fallback to cached company doc if not in companies array
      if (companyDocCache[primaryId]) {
        const cached = companyDocCache[primaryId];
        return {
          name: cached.name || deal.externalCompanyName || '-',
          logo: cached.logo || null,
          id: primaryId
        };
      }
    }
    
    // Fallback to company name from deal associations
    if (deal.associations?.companies && Array.isArray(deal.associations.companies)) {
      // Look for primary company first
      const primaryCompany = deal.associations.companies.find((c: any) => c.isPrimary || c.primary || c.type === 'primary' || c.snapshot?.type === 'primary');
      if (primaryCompany) {
        const result = {
          name: primaryCompany.snapshot?.companyName || primaryCompany.snapshot?.name || primaryCompany.name,
          logo: primaryCompany.snapshot?.logo || primaryCompany.logo,
          id: primaryCompany.id
        };
        if (!result.logo && primaryCompany.id && companyDocCache[primaryCompany.id]) {
          result.logo = companyDocCache[primaryCompany.id].logo || null;
        }
        return result;
      }
      
      // If no primary company, try the first one
      const firstCompany = deal.associations.companies[0];
      if (firstCompany) {
        if (typeof firstCompany === 'string') {
          const company = companies.find(c => c.id === firstCompany) || (companyDocCache[firstCompany] ? { id: firstCompany, ...companyDocCache[firstCompany] } as any : undefined);
          if (company) {
            return {
              name: (company as any).companyName || (company as any).name || (company as any).legalName || (company as any).name,
              logo: (company as any).logo || (company as any).logoUrl || (company as any).logo_url || (company as any).avatar || (companyDocCache[firstCompany]?.logo ?? null),
              id: (company as any).id || firstCompany
            };
          }
        } else if (typeof firstCompany === 'object') {
          const result = {
            name: firstCompany.snapshot?.companyName || firstCompany.snapshot?.name || firstCompany.name,
            logo: firstCompany.snapshot?.logo || firstCompany.logo,
            id: firstCompany.id
          };
          if (!result.logo && firstCompany.id && companyDocCache[firstCompany.id]) {
            result.logo = companyDocCache[firstCompany.id].logo || null;
          }
          return result;
        }
      }
    }

    // Fallback to external company name from deal (only if no associations present)
    if (deal.externalCompanyName && !(deal.associations?.companies?.length)) {
      return {
        name: deal.externalCompanyName,
        logo: null,
        id: null
      };
    }

    // Extract company name from deal name if it contains company indicators
    const dealName = deal.name || '';
    const companyIndicators = ['Offer', 'Agreement', 'Contract', 'Deal'];
    for (const indicator of companyIndicators) {
      if (dealName.includes(indicator)) {
        const beforeIndicator = dealName.split(indicator)[0].trim();
        if (beforeIndicator && beforeIndicator.length > 2) {
          return {
            name: beforeIndicator,
            logo: null,
            id: null
          };
        }
      }
    }
    
    return null;
  };

  // Helper function to get deal owner/salesperson names
  const getDealOwner = (deal: any) => {
    // Helper to resolve a display name from a salesperson object or id
    const resolveFromId = (id: string): string => {
      // Try to find in the salesTeam array with multiple field matches
      const sp = salesTeam.find(s => (
        s.id === id || 
        s.uid === id || 
        s.userId === id || 
        s.userID === id || 
        s.docId === id || 
        s.email === id ||
        s.user_id === id ||
        s.userId === id
      ));
      
      if (sp) {
        const full = [sp.firstName, sp.lastName].filter(Boolean).join(' ').trim();
        return sp.name || sp.displayName || full || sp.email || id;
      }
      
      // If not found, return a more user-friendly version of the ID
      // For Firebase UIDs, show just the first 8 characters
      if (id && id.length > 20) {
        return `User ${id.substring(0, 8)}...`;
      }
      
      return id;
    };

    const names: string[] = [];
    const visited = new Set<string>();

    // Prefer associations.salespeople
    const assoc = (deal.associations?.salespeople || []) as any[];
    assoc.forEach((sp: any) => {
      let label = '';
      if (typeof sp === 'string') {
        label = resolveFromId(sp);
      } else if (sp && typeof sp === 'object') {
        // Check for snapshot data first (new structure)
        if (sp.snapshot) {
          const full = [sp.snapshot.firstName, sp.snapshot.lastName].filter(Boolean).join(' ').trim();
          label = sp.snapshot.displayName || sp.snapshot.name || full || sp.snapshot.email || (sp.id ? resolveFromId(sp.id) : 'Unknown');
        } else {
          // Fallback to direct properties (old structure)
          const full = [sp.firstName, sp.lastName].filter(Boolean).join(' ').trim();
          label = sp.name || sp.displayName || full || sp.email || (sp.id ? resolveFromId(sp.id) : 'Unknown');
        }
      }
      if (label && !visited.has(label)) {
        visited.add(label);
        names.push(label);
      }
    });

    if (names.length > 0) return names.join(', ');

    // Fallbacks
    if (deal.salesOwnerName) return deal.salesOwnerName;
    if (deal.salespeopleNames && deal.salespeopleNames.length > 0) return deal.salespeopleNames.join(', ');

    return '-';
  };
  
  // Column visibility state
  const [visibleColumns, setVisibleColumns] = React.useState<string[]>([
    'deal', 'company', 'owner', 'stage', 'value', 'age', 'status', 'probability', 'aiHealth', 'lastActivity'
  ]);
  
  // Sorting state
  const [sortBy, setSortBy] = React.useState<string>('deal');
  const [sortOrder, setSortOrder] = React.useState<'asc' | 'desc'>('asc');
  
  // Column definitions
  const allColumns = [
    { key: 'deal', label: 'Deal' },
    { key: 'company', label: 'Company' },
    { key: 'owner', label: 'Owner' },
    { key: 'stage', label: 'Stage' },
    { key: 'value', label: 'Value' },
    { key: 'valueRange', label: 'Value Range' },
    { key: 'age', label: 'Age' },
    { key: 'status', label: 'Status' },
    { key: 'probability', label: 'Probability' },
    { key: 'aiHealth', label: 'AI Health' },
    { key: 'lastActivity', label: 'Last Activity' }
  ];
  
  // Helper function to get stage config for colors
  const getStageConfig = (stageKey: string) => {
    const configs: Record<string, { color: string }> = {
      'discovery': { color: '#BBDEFB' },
      'qualification': { color: '#64B5F6' },
      'scoping': { color: '#1E88E5' },
      'proposalDrafted': { color: '#FFE082' },
      'proposalReview': { color: '#FFA726' },
      'negotiation': { color: '#F4511E' },
      'verbalAgreement': { color: '#9CCC65' },
      'closedWon': { color: '#2E7D32' },
      'closedLost': { color: '#E53935' },
      'onboarding': { color: '#BA68C8' },
      'liveAccount': { color: '#4527A0' },
      'dormant': { color: '#424242' }
    };
    return configs[stageKey] || { color: '#7f8c8d' };
  };
  
  // Helper function to get deal value range
  const getDealValueRange = (deal: any): string => {
    const value = toNumber(deal.estimatedRevenue);
    if (value === 0) return 'N/A';
    
    // Simple range calculation based on value
    if (value < 50000) return '$0 - $50K';
    if (value < 100000) return '$50K - $100K';
    if (value < 250000) return '$100K - $250K';
    if (value < 500000) return '$250K - $500K';
    if (value < 1000000) return '$500K - $1M';
    return '$1M+';
  };

  // Helper function to get deal value for pipeline display (uses calculated max value)
  const getDealValueForPipeline = (deal: any): number => {
    // Check if we have qualification stage data
    if (deal.stageData?.qualification) {
      const qualData = deal.stageData.qualification;
      const payRate = qualData.expectedAveragePayRate || 16; // Default to $16
      const markup = qualData.expectedAverageMarkup || 40; // Default to 40%
      const timeline = qualData.staffPlacementTimeline;

      if (timeline) {
        // Calculate bill rate: pay rate + markup
        const billRate = payRate * (1 + markup / 100);
        
        // Annual hours per employee (2080 full-time hours)
        const annualHoursPerEmployee = 2080;
        
        // Calculate annual revenue per employee
        const annualRevenuePerEmployee = billRate * annualHoursPerEmployee;
        
        // Get starting and 180-day numbers
        const startingCount = timeline.starting || 0;
        const after180DaysCount = timeline.after180Days || timeline.after90Days || timeline.after30Days || startingCount;
        
        if (startingCount > 0 || after180DaysCount > 0) {
          // Use the maximum value (after180DaysCount) for pipeline display
          const maxRevenue = annualRevenuePerEmployee * after180DaysCount;
          return maxRevenue;
        }
      }
    }
    
    // Fallback to estimatedRevenue if qualification data is not available
    return toNumber(deal.estimatedRevenue);
  };

  const getDealsByStage = (stageName: string) => {
    return deals.filter(deal => deal.stage === stageName);
  };

  const getTotalValue = (stageDeals: any[]) => {
    return stageDeals.reduce((sum, deal) => sum + getDealValueForPipeline(deal), 0);
  };

  // Handle stage selection from funnel – toggles single-stage filter
  const handleStageClick = (stage: string) => {
    const current = new Set<string>(((filters?.stages as string[]) || []));
    const isOnlySelected = current.size === 1 && current.has(stage);
    const nextStages: string[] = isOnlySelected ? [] : [stage];
    onFiltersChange({ ...filters, stages: nextStages });
    // Scroll to table section
    try {
      const el = document.querySelector('[data-testid="customers-table"]');
      el && el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch {}
  };

  // Helper: parse currency-ish to number
  const toNumber = (v: any) => {
    if (typeof v === 'number') return v;
    if (!v) return 0;
    const n = Number(String(v).replace(/[^0-9.-]/g, ''));
    return Number.isFinite(n) ? n : 0;
  };

  // Helper: deal last activity/updated timestamp
  const getDealUpdatedAt = (deal: any): Date | undefined => {
    const d = deal.updatedAt || deal.lastActivityAt || deal.createdAt;
    if (!d) return undefined;
    return d.toDate ? d.toDate() : new Date(d);
  };

  // Sorting helper functions
  const getSortableValue = (deal: any, field: string) => {
    switch (field) {
      case 'deal':
        return deal.name?.toLowerCase() || '';
      case 'company': {
        const cid = getDealPrimaryCompanyId(deal);
        const company = companies.find((c: any) => c.id === cid);
        return (company?.companyName || company?.name || '').toLowerCase();
      }
      case 'owner':
        return (deal.owner || '').toLowerCase();
      case 'stage':
        return deal.stage?.toLowerCase() || '';
      case 'value':
        return getDealValueForPipeline(deal);
      case 'age': {
        const createdAt = deal.createdAt;
        if (!createdAt) return 0;
        const createdDate = createdAt.toDate ? createdAt.toDate() : new Date(createdAt);
        return Date.now() - createdDate.getTime();
      }
      case 'status': {
        const status = deal.status || 'Open';
        const statusOrder = { 'Open': 1, 'On Hold': 2, 'Won': 3, 'Lost': 4, 'Canceled': 5, 'Dormant': 6 };
        return statusOrder[status as keyof typeof statusOrder] || 1;
      }
      case 'probability':
        return getDealProbability(deal);
      case 'aiHealth': {
        const health = getDealHealth(deal);
        return health === 'green' ? 3 : health === 'yellow' ? 2 : 1;
      }
      case 'lastActivity': {
        const date = getDealUpdatedAt(deal);
        return date ? date.getTime() : 0;
      }
      default:
        return '';
    }
  };

  const handleSort = (field: string) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('asc');
    }
  };

  // Sort filtered deals
  const sortedDeals = React.useMemo(() => {
    const sorted = [...filteredDeals].sort((a, b) => {
      const aValue = getSortableValue(a, sortBy);
      const bValue = getSortableValue(b, sortBy);
      
      if (aValue < bValue) return sortOrder === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [filteredDeals, sortBy, sortOrder, companies]);

  // Apply filters including stage, owner, industry, size, and age
  const applyFilters = React.useCallback(() => {
    let data = [...deals];
    // Exclude archived deals from Pipeline view
    data = data.filter((d) => d.archived !== true);
    // Stage filter (from funnel click or stage chips)
    const selectedStages = (filters?.stages as string[]) || [];
    if (selectedStages.length > 0) {
      data = data.filter((d) => selectedStages.includes(d.stage));
    }
    // Owner - Filter by salespeople in associations.salespeople array
    if (filters?.owner === 'me' && filters?.currentUserId) {
      data = data.filter((d) => {
        const salespeople = d.associations?.salespeople || [];
        return salespeople.some((sp: any) => sp.id === filters.currentUserId);
      });
    } else if (filters?.owner && filters.owner !== 'all') {
      data = data.filter((d) => {
        const salespeople = d.associations?.salespeople || [];
        const hasSalesperson = salespeople.some((sp: any) => sp.id === filters.owner);
        
        return hasSalesperson;
      });
    }
    // Industry (by primary company)
    if (filters?.industry && filters.industry !== 'all') {
      data = data.filter((d) => {
        const cid = getDealPrimaryCompanyId(d as any);
        const c = companies.find((x: any) => x.id === cid);
        const industry = (c?.industry || c?.primaryIndustry || '').toString().toLowerCase();
        return industry.includes(String(filters.industry).toLowerCase());
      });
    }
    // Deal size
    const minVal = toNumber(filters?.sizeMin);
    const maxVal = toNumber(filters?.sizeMax) || Number.MAX_SAFE_INTEGER;
    if (minVal > 0 || (filters?.sizeMax && maxVal < Number.MAX_SAFE_INTEGER)) {
      data = data.filter((d) => {
        const val = toNumber(d.estimatedRevenue);
        return val >= minVal && val <= maxVal;
      });
    }
    // Deal age (days since updated)
    const ageDays = Number(filters?.ageDays || 0);
    if (ageDays > 0) {
      const cutoff = Date.now() - ageDays * 24 * 60 * 60 * 1000;
      data = data.filter((d) => {
        const ts = getDealUpdatedAt(d)?.getTime() || 0;
        return ts >= cutoff;
      });
    }
    setFilteredDeals(data);
  }, [deals, companies, filters]);

  // Update filtered deals whenever inputs change
  React.useEffect(() => {
    applyFilters();
  }, [applyFilters]);

  // AI Health heuristic + probability calculation
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

  // Recent activity bonus used to nudge probability and health
  // Uses last updated timestamp as a proxy; also optionally reads common fields if present
  const getActivityBonus = (deal: any): number => {
    const updated = getDealUpdatedAt(deal)?.getTime() || 0;
    const days = updated ? Math.floor((Date.now() - updated) / (24 * 60 * 60 * 1000)) : 999;

    let bonus = 0;
    // Recency tiers
    if (days <= 3) bonus += 15;
    else if (days <= 7) bonus += 10;
    else if (days <= 14) bonus += 5;
    else if (days > 30) bonus -= 10;

    // Optional signals if present on the deal (safe no-ops if missing)
    const activity7d = Number(deal.recentActivityCount || deal.activityCount7d || deal.activity7d || 0);
    if (activity7d >= 10) bonus += 5; else if (activity7d >= 5) bonus += 3;
    const emails7d = Number(deal.emailsLast7Days || deal.recentEmails || 0);
    if (emails7d >= 5) bonus += 3; else if (emails7d === 0 && days > 14) bonus -= 2;

    return bonus;
  };

  const getStageProbability = (deal: any): number => {
    const stage = pipelineStages.find((s: any) => s.name === deal.stage);
    const base = typeof stage?.probability === 'number' ? stage.probability : (typeof deal.probability === 'number' ? deal.probability : 50);
    return Math.max(0, Math.min(100, base));
  };

  const getDealProbability = (deal: any): number => {
    // If deal has explicit probability, use weighted with stage probability
    const stageProb = getStageProbability(deal);
    const dealProb = typeof deal.probability === 'number' ? deal.probability : stageProb;
    // Combine average + recent activity bonus (−10 to +15 typical)
    const avg = Math.round((stageProb + dealProb) / 2);
    const activityBonus = getActivityBonus(deal);
    return clamp(avg + activityBonus, 0, 100);
  };

  const getDealHealth = (deal: any): 'green' | 'yellow' | 'red' => {
    return getDealHealthLegacy(deal);
  };
  return (
    <Box>
      {/* Header with filters */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Typography variant="h6">Sales Pipeline</Typography>
          {/* Stage filtering disabled - chart should not filter by stage clicks */}
        </Box>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          {/* Debug info */}
          {process.env.NODE_ENV === 'development' && (
            <Typography variant="caption" color="text.secondary">
              Sales Team: {salesTeam.length} members | Filter: {filters?.owner || 'all'} | Deals: {filteredDeals.length}
            </Typography>
          )}
          
          {/* Owner filter */}
          <FormControl size="small" sx={{ minWidth: 150 }}>
            <InputLabel>Owner</InputLabel>
            <Select
              value={filters?.owner || 'all'}
              onChange={(e) => onFiltersChange({ ...filters, owner: e.target.value })}
              label="Owner"
            >
              <MenuItem value="all">All Owners</MenuItem>
              <MenuItem value="me">My Deals</MenuItem>
              {(() => {
                const crmSalesMembers = salesTeam.filter((member: any) => 
                  member.crm_sales === true || member.role === 'sales' || member.sales === true
                );
                
                // If no CRM sales members found, show all team members
                const membersToShow = crmSalesMembers.length > 0 ? crmSalesMembers : salesTeam;
                
                // If still no members, show a placeholder
                if (membersToShow.length === 0) {
                  return (
                    <MenuItem value="no-members" disabled>
                      No team members found
                    </MenuItem>
                  );
                }
                
                if (process.env.NODE_ENV === 'development') {
                  console.log('🔍 Sales team members:', salesTeam.length);
                  console.log('🔍 CRM sales members:', crmSalesMembers.length);
                  console.log('🔍 Members to show:', membersToShow.length);
                }
                
                return membersToShow.map((member: any) => {
                  const displayName = member.firstName && member.lastName 
                    ? `${member.firstName} ${member.lastName}`
                    : member.name || member.displayName || member.email || `Member ${member.id}`;
                  
                  if (process.env.NODE_ENV === 'development') {
                    console.log('🔍 Member:', { id: member.id, displayName, uid: member.uid });
                  }
                  
                  return (
                    <MenuItem key={member.id} value={member.uid || member.id}>
                      {displayName}
                    </MenuItem>
                  );
                });
              })()}
            </Select>
          </FormControl>
          
          {/* View toggle */}
          <ToggleButtonGroup size="small" exclusive value={viewMode} onChange={(e, v) => v && setViewMode(v)}>
            <ToggleButton value="funnel">Funnel</ToggleButton>
            <ToggleButton value="bubble">Bubble</ToggleButton>
          </ToggleButtonGroup>

          {/* Color mode toggle removed - always using stage-based coloring */}

          {/* Stage multi-select via chips */}
          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
            {pipelineStages.map((s: any) => {
              const active = ((filters?.stages as string[]) || []).includes(s.name);
              return (
                <Chip
                  key={s.id || s.name}
                  size="small"
                  color={active ? 'primary' : 'default'}
                  label={s.name}
                  onClick={() => {
                    const cur = new Set<string>(((filters?.stages as string[]) || []));
                    if (cur.has(s.name)) cur.delete(s.name); else cur.add(s.name);
                    onFiltersChange({ ...filters, stages: Array.from(cur) });
                  }}
                />
              );
            })}
          </Box>
        </Box>
      </Box>

      {/* Insights Bar */}
      <Box sx={{
        mb: 2,
        p: 1.5,
        borderRadius: 1,
        background: 'linear-gradient(90deg, rgba(11,99,197,0.1) 0%, rgba(16,185,129,0.1) 100%)',
        border: '1px solid #E5E7EB',
        display: 'flex',
        gap: 2,
        flexWrap: 'wrap'
      }}>
        {(() => {
          const totalDeals = filteredDeals.length;
          const totalValue = filteredDeals.reduce((s, d) => s + getDealValueForPipeline(d), 0);
          const byStage = pipelineStages.map((s: any) => ({
            name: s.name,
            count: filteredDeals.filter((d) => d.stage === s.name).length,
                          value: filteredDeals.filter((d) => d.stage === s.name).reduce((sum, d) => sum + getDealValueForPipeline(d), 0)
          }));
          const top = byStage.sort((a, b) => b.value - a.value)[0];
          const atRisk = filteredDeals.filter((d) => getDealHealth(d) !== 'green').length;
          const ownerTotals = filteredDeals.reduce((m: Record<string, number>, d: any) => {
            const key = d.owner || 'Unassigned';
            m[key] = (m[key] || 0) + getDealValueForPipeline(d);
            return m;
          }, {});
          const topOwner = Object.entries(ownerTotals).sort((a, b) => (Number(b[1]) - Number(a[1])))[0];
          return (
            <>
              <Typography variant="body2"><strong>{totalDeals}</strong> deals worth <strong>${totalValue.toLocaleString()}</strong></Typography>
              {top && (
                <Typography variant="body2">Top stage: <strong>{top.name}</strong> ({top.count} deals, ${top.value.toLocaleString()})</Typography>
              )}
              <Typography variant="body2">At risk: <strong>{atRisk}</strong> deals</Typography>
              {topOwner && (
                <Typography variant="body2">Top owner: <strong>{topOwner[0]}</strong> (${Number(topOwner[1]).toLocaleString()})</Typography>
              )}
            </>
          );
        })()}
      </Box>

      {/* Visualization */}
      <Box sx={{ mb: 3 }}>
        {viewMode === 'funnel' ? (
          <PipelineFunnel 
            deals={filteredDeals.map((deal: any) => ({
              ...deal,
              estimatedRevenue: getDealValueForPipeline(deal) // Use calculated value
            }))}
            onStageClick={handleStageClick}
          />
        ) : (
          <PipelineBubbleChart
            deals={filteredDeals.map((deal: any) => {
              const primaryId = getDealPrimaryCompanyId(deal);
              const company = companies.find((c: any) => c.id === primaryId);
              return {
                ...deal,
                estimatedRevenue: getDealValueForPipeline(deal), // Use calculated value
                companyName: company?.companyName || company?.name || '',
                aiHealth: getDealHealth(deal)
              };
            })}
            stages={pipelineStages.map((s: any) => s.name)}
            owners={[...new Set((deals || []).map((d: any) => d.owner))]
              .filter(Boolean)
              .map((id: string) => ({ id, name: id }))}
            colorMode="stage"
            onDealClick={(dealId) => {
              // Navigate to deal details
              navigate(`/crm/deals/${dealId}`);
            }}
          />
        )}
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
                    <Card key={deal.id} variant="outlined" sx={{ p: 1 }} data-testid="deal-card">
                      <Typography variant="body2" fontWeight="medium">
                        {deal.name}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {(() => {
                          const primaryId = getDealPrimaryCompanyId(deal as any);
                          const company = companies.find((c: any) => c.id === primaryId);
                          return company?.companyName || company?.name || '';
                        })()}
                      </Typography>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 1 }}>
                        <Typography variant="caption" fontWeight="medium">
                          ${getDealValueForPipeline(deal).toLocaleString()}
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

      {/* Enhanced Synchronized Table */}
      <Box sx={{ mt: 2 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
          <Typography variant="subtitle2" fontWeight={700}>Deals ({sortedDeals.length})</Typography>
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
            {/* Column visibility toggle */}
            <FormControl size="small" sx={{ minWidth: 120 }}>
              <InputLabel>Columns</InputLabel>
              <Select
                multiple
                value={visibleColumns}
                onChange={(e) => setVisibleColumns(e.target.value as string[])}
                label="Columns"
                renderValue={(selected) => `${selected.length} columns`}
              >
                {allColumns.map((col) => (
                  <MenuItem key={col.key} value={col.key}>
                    <Checkbox checked={visibleColumns.indexOf(col.key) > -1} />
                    <ListItemText primary={col.label} />
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            
            <Button
              size="small"
              variant="outlined"
              startIcon={<FileDownloadIcon />}
              onClick={() => {
                const headers = visibleColumns.map(col => allColumns.find(c => c.key === col)?.label || col);
                const rows = sortedDeals.map((d) => {
                  const cid = getDealPrimaryCompanyId(d as any);
                  const c = companies.find((x: any) => x.id === cid);
                  const val = toNumber(d.estimatedRevenue);
                  const dt = getDealUpdatedAt(d);
                  const health = getDealHealth(d);
                  const prob = getDealProbability(d);
                  
                  return visibleColumns.map(col => {
                    switch (col) {
                      case 'deal': return d.name;
                      case 'company': return c?.companyName || c?.name || '';
                      case 'owner': return d.owner || '';
                      case 'stage': return d.stage;
                      case 'value': return getDealValueForPipeline(d);
                      case 'valueRange': return getDealValueRange(d);
                      case 'age': {
                        const createdAt = d.createdAt;
                        if (!createdAt) return 'N/A';
                        const createdDate = createdAt.toDate ? createdAt.toDate() : new Date(createdAt);
                        const days = Math.floor((Date.now() - createdDate.getTime()) / (24 * 60 * 60 * 1000));
                        return `${days}d`;
                      }
                      case 'status': return d.status || 'Open';
                      case 'probability': return prob;
                      case 'aiHealth': return health;
                      case 'lastActivity': return dt ? dt.toISOString() : '';
                      default: return '';
                    }
                  });
                });
                const csv = [headers.join(','), ...rows.map(r => r.map((v) => `"${String(v).replace(/"/g,'""')}"`).join(','))].join('\n');
                const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `pipeline_deals_${new Date().toISOString().slice(0,10)}.csv`;
                a.click();
                URL.revokeObjectURL(url);
              }}
            >Export CSV</Button>
          </Box>
        </Box>
        
        <Table size="small" sx={{ borderRadius: 1, overflow: 'hidden', boxShadow: 1 }}>
          <TableHead>
            <TableRow sx={{ backgroundColor: 'grey.50' }}>
              {visibleColumns.includes('deal') && (
                <TableCell>
                  <TableSortLabel
                    active={sortBy === 'deal'}
                    direction={sortBy === 'deal' ? sortOrder : 'asc'}
                    onClick={() => handleSort('deal')}
                  >
                    Deal
                  </TableSortLabel>
                </TableCell>
              )}
              {visibleColumns.includes('company') && (
                <TableCell>
                  <TableSortLabel
                    active={sortBy === 'company'}
                    direction={sortBy === 'company' ? sortOrder : 'asc'}
                    onClick={() => handleSort('company')}
                  >
                    Company
                  </TableSortLabel>
                </TableCell>
              )}
              {visibleColumns.includes('owner') && (
                <TableCell>
                  <TableSortLabel
                    active={sortBy === 'owner'}
                    direction={sortBy === 'owner' ? sortOrder : 'asc'}
                    onClick={() => handleSort('owner')}
                  >
                    Salesperson
                  </TableSortLabel>
                </TableCell>
              )}
              {visibleColumns.includes('stage') && (
                <TableCell>
                  <TableSortLabel
                    active={sortBy === 'stage'}
                    direction={sortBy === 'stage' ? sortOrder : 'asc'}
                    onClick={() => handleSort('stage')}
                  >
                    Stage
                  </TableSortLabel>
                </TableCell>
              )}
              {visibleColumns.includes('value') && (
                <TableCell align="right">
                  <TableSortLabel
                    active={sortBy === 'value'}
                    direction={sortBy === 'value' ? sortOrder : 'asc'}
                    onClick={() => handleSort('value')}
                  >
                    Value
                  </TableSortLabel>
                </TableCell>
              )}
              {visibleColumns.includes('valueRange') && (
                <TableCell align="right">
                  <TableSortLabel
                    active={sortBy === 'valueRange'}
                    direction={sortBy === 'valueRange' ? sortOrder : 'asc'}
                    onClick={() => handleSort('valueRange')}
                  >
                    Value Range
                  </TableSortLabel>
                </TableCell>
              )}
              {visibleColumns.includes('age') && (
                <TableCell>
                  <TableSortLabel
                    active={sortBy === 'age'}
                    direction={sortBy === 'age' ? sortOrder : 'asc'}
                    onClick={() => handleSort('age')}
                  >
                    Age
                  </TableSortLabel>
                </TableCell>
              )}
              {visibleColumns.includes('status') && (
                <TableCell>
                  <TableSortLabel
                    active={sortBy === 'status'}
                    direction={sortBy === 'status' ? sortOrder : 'asc'}
                    onClick={() => handleSort('status')}
                  >
                    Status
                  </TableSortLabel>
                </TableCell>
              )}
              {visibleColumns.includes('probability') && (
                <TableCell align="right">
                  <TableSortLabel
                    active={sortBy === 'probability'}
                    direction={sortBy === 'probability' ? sortOrder : 'asc'}
                    onClick={() => handleSort('probability')}
                  >
                    Probability
                  </TableSortLabel>
                </TableCell>
              )}
              {visibleColumns.includes('aiHealth') && (
                <TableCell>
                  <TableSortLabel
                    active={sortBy === 'aiHealth'}
                    direction={sortBy === 'aiHealth' ? sortOrder : 'asc'}
                    onClick={() => handleSort('aiHealth')}
                  >
                    AI Health
                  </TableSortLabel>
                </TableCell>
              )}
              {visibleColumns.includes('lastActivity') && (
                <TableCell>
                  <TableSortLabel
                    active={sortBy === 'lastActivity'}
                    direction={sortBy === 'lastActivity' ? sortOrder : 'asc'}
                    onClick={() => handleSort('lastActivity')}
                  >
                    Last Activity
                  </TableSortLabel>
                </TableCell>
              )}
            </TableRow>
          </TableHead>
          <TableBody>
            {sortedDeals.map((d) => {
              const companyInfo = getDealCompanyInfo(d);
              const health = getDealHealth(d);
              const updated = getDealUpdatedAt(d);
              const prob = getDealProbability(d);
              
              return (
                <TableRow 
                  key={d.id} 
                  hover 
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (d.id) {
                      navigate(`/crm/deals/${d.id}`);
                    }
                  }}
                  sx={{ 
                    cursor: 'pointer',
                    '&:hover': { backgroundColor: 'action.hover' } 
                  }}
                >
                  {visibleColumns.includes('deal') && (
                    <TableCell sx={{ fontWeight: 500 }}>{d.name}</TableCell>
                  )}
                  {visibleColumns.includes('company') && (
                    <TableCell>
                      {companyInfo ? (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                          <Avatar 
                            src={companyInfo.logo}
                            sx={{ 
                              width: 24, 
                              height: 24,
                              backgroundColor: getAvatarColor(companyInfo.name || ''),
                              color: getAvatarTextColor(companyInfo.name || ''),
                              fontWeight: 600,
                              fontSize: '10px'
                            }}
                          >
                            {(companyInfo.name || '?').charAt(0).toUpperCase()}
                          </Avatar>
                          <Typography variant="body2" color="#6B7280" sx={{ fontSize: '0.875rem' }}>
                            {companyInfo.name}
                          </Typography>
                        </Box>
                      ) : (
                        <Typography variant="body2" color="#9CA3AF" sx={{ fontSize: '0.875rem' }}>
                          -
                        </Typography>
                      )}
                    </TableCell>
                  )}
                  {visibleColumns.includes('owner') && (
                    <TableCell>
                      <Typography variant="body2" color="#6B7280" sx={{ fontSize: '0.875rem' }}>
                        {getDealOwner(d)}
                      </Typography>
                    </TableCell>
                  )}
                  {visibleColumns.includes('stage') && (
                    <TableCell>
                      <Chip
                        size="small"
                        label={d.stage}
                        sx={{ 
                          backgroundColor: getStageConfig(d.stage)?.color || 'grey.300',
                          color: 'white',
                          fontWeight: 500
                        }}
                      />
                    </TableCell>
                  )}
                  {visibleColumns.includes('value') && (
                    <TableCell align="right" sx={{ fontWeight: 500 }}>
                      ${getDealValueForPipeline(d).toLocaleString()}
                    </TableCell>
                  )}
                  {visibleColumns.includes('valueRange') && (
                    <TableCell align="right">
                      <Typography variant="body2" color="text.secondary">
                        {getDealValueRange(d)}
                      </Typography>
                    </TableCell>
                  )}
                  {visibleColumns.includes('age') && (
                    <TableCell>
                      {(() => {
                        const createdAt = d.createdAt;
                        if (!createdAt) return <Typography variant="body2">-</Typography>;
                        const createdDate = createdAt.toDate ? createdAt.toDate() : new Date(createdAt);
                        const ageDays = Math.floor((Date.now() - createdDate.getTime()) / (24 * 60 * 60 * 1000));
                        return <DealAgeChip ageDays={ageDays} createdAt={createdDate} />;
                      })()}
                    </TableCell>
                  )}
                  {visibleColumns.includes('status') && (
                    <TableCell>
                      <Chip
                        size="small"
                        label={d.status || 'Open'}
                        color={
                          d.status === 'Won' ? 'success' :
                          d.status === 'Lost' ? 'error' :
                          d.status === 'On Hold' ? 'warning' :
                          d.status === 'Canceled' ? 'default' :
                          d.status === 'Dormant' ? 'secondary' : 'default'
                        }
                        sx={{ 
                          fontWeight: 500,
                          backgroundColor: 
                            d.status === 'Won' ? '#4CAF50' :
                            d.status === 'Lost' ? '#F44336' :
                            d.status === 'On Hold' ? '#FF9800' :
                            d.status === 'Canceled' ? '#424242' :
                            d.status === 'Dormant' ? '#9C27B0' : '#E0E0E0',
                          color: 'white'
                        }}
                      />
                    </TableCell>
                  )}
                  {visibleColumns.includes('probability') && (
                    <TableCell align="right">
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 1 }}>
                        <Typography variant="body2" sx={{ fontWeight: 500 }}>
                          {prob}%
                        </Typography>
                        <Box
                          sx={{
                            width: 40,
                            height: 4,
                            borderRadius: 2,
                            backgroundColor: 'grey.200',
                            overflow: 'hidden'
                          }}
                        >
                          <Box
                            sx={{
                              width: `${prob}%`,
                              height: '100%',
                              background: prob >= 75 ? 'linear-gradient(90deg, #4CAF50, #66BB6A)' :
                                         prob >= 50 ? 'linear-gradient(90deg, #FF9800, #FFB74D)' :
                                         'linear-gradient(90deg, #F44336, #EF5350)'
                            }}
                          />
                        </Box>
                      </Box>
                    </TableCell>
                  )}
                  {visibleColumns.includes('aiHealth') && (
                    <TableCell>
                      <Tooltip
                        title={
                          <Box>
                            <Typography variant="body2" fontWeight="bold">
                              AI Health Assessment
                            </Typography>
                            <Typography variant="body2">
                              {health === 'green' ? '✅ Deal is healthy and progressing well' :
                               health === 'yellow' ? '⚠️ Deal needs attention - consider follow-up' :
                               '❌ Deal may be stalled - requires immediate action'}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              Based on probability ({prob}%) and recent activity
                            </Typography>
                          </Box>
                        }
                        arrow
                      >
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Box
                            sx={{
                              width: 12,
                              height: 12,
                              borderRadius: '50%',
                              backgroundColor: health === 'green' ? '#4CAF50' : 
                                              health === 'yellow' ? '#FF9800' : '#F44336',
                              animation: health === 'yellow' ? 'pulse 2s infinite' : 'none'
                            }}
                          />
                          <Chip
                            size="small"
                            label={health === 'green' ? 'Healthy' : health === 'yellow' ? 'At Risk' : 'Stalled'}
                            color={health === 'green' ? 'success' : health === 'yellow' ? 'warning' : 'error'}
                            sx={{ fontWeight: 500 }}
                          />
                        </Box>
                      </Tooltip>
                    </TableCell>
                  )}
                  {visibleColumns.includes('lastActivity') && (
                    <TableCell>
                      {updated ? (
                        <Tooltip title={updated.toLocaleString()}>
                          <Typography variant="body2">
                            {updated.toLocaleDateString()}
                          </Typography>
                        </Tooltip>
                      ) : (
                        '-'
                      )}
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Box>
    </Box>
  );
};

// Shared utility function for calculating deal estimated value
const getDealEstimatedValue = (deal: any) => {
  // Check if we have qualification stage data
  if (deal.stageData?.qualification) {
    const qualData = deal.stageData.qualification;
    const payRate = qualData.expectedAveragePayRate || 16; // Default to $16
    const markup = qualData.expectedAverageMarkup || 40; // Default to 40%
    const timeline = qualData.staffPlacementTimeline;

    if (timeline) {
      // Calculate bill rate: pay rate + markup
      const billRate = payRate * (1 + markup / 100);
      
      // Annual hours per employee (2080 full-time hours)
      const annualHoursPerEmployee = 2080;
      
      // Calculate annual revenue per employee
      const annualRevenuePerEmployee = billRate * annualHoursPerEmployee;
      
      // Get starting and 180-day numbers
      const startingCount = timeline.starting || 0;
      const after180DaysCount = timeline.after180Days || timeline.after90Days || timeline.after30Days || startingCount;
      
      if (startingCount > 0 || after180DaysCount > 0) {
        // Calculate revenue range
        const minRevenue = annualRevenuePerEmployee * startingCount;
        const maxRevenue = annualRevenuePerEmployee * after180DaysCount;
        
        const result = `$${minRevenue.toLocaleString()} - $${maxRevenue.toLocaleString()}`;
        return result;
      }
    }
  }
  
  // Fallback to estimatedRevenue if qualification data is not available
  if (deal.estimatedRevenue) {
    return `$${Number(deal.estimatedRevenue).toLocaleString()}`;
  }
  
  return '-';
};

const getDealInitialValue = (deal: any) => {
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
      if (startingCount > 0) {
        const minRevenue = annualRevenuePerEmployee * startingCount;
        return `$${minRevenue.toLocaleString()}`;
      }
    }
  }
  if (deal.estimatedRevenue) {
    return `$${Number(deal.estimatedRevenue).toLocaleString()}`;
  }
  return '-';
};

const getDealPotentialValue = (deal: any) => {
  if (deal.stageData?.qualification) {
    const qualData = deal.stageData.qualification;
    const payRate = qualData.expectedAveragePayRate || 16;
    const markup = qualData.expectedAverageMarkup || 40;
    const timeline = qualData.staffPlacementTimeline;
    if (timeline) {
      const billRate = payRate * (1 + markup / 100);
      const annualHoursPerEmployee = 2080;
      const annualRevenuePerEmployee = billRate * annualHoursPerEmployee;
      const after180DaysCount = timeline.after180Days ?? timeline.after90Days ?? timeline.after30Days ?? timeline.starting ?? 0;
      if (after180DaysCount > 0) {
        const maxRevenue = annualRevenuePerEmployee * after180DaysCount;
        return `$${maxRevenue.toLocaleString()}`;
      }
    }
  }
  return '-';
};

const getDealMarkupPercent = (deal: any) => {
  const markup = deal?.stageData?.qualification?.expectedAverageMarkup;
  if (markup == null || markup === '') return '-';
  const n = Number(markup);
  if (Number.isNaN(n)) return '-';
  return `${n}%`;
};

// Sales Dashboard Component
const SalesDashboard: React.FC<{
  tenantId: string;
  currentUser: any;
  deals: any[];
  companies: any[];
  contacts: any[];
  tasks: any[];
  pipelineStages: any[];
  allCompanies: any[];
  allDeals: any[];
  initialDataLoaded: boolean;
}> = ({ tenantId, currentUser, deals, companies, contacts, tasks, pipelineStages, allCompanies, allDeals, initialDataLoaded }) => {
  const navigate = useNavigate();
  const [userData, setUserData] = useState<any>(null);
  const [loadingUser, setLoadingUser] = useState(true);

  // Fetch user data from Users collection
  useEffect(() => {
    const fetchUserData = async () => {
      if (!currentUser?.uid || !tenantId) {
        setLoadingUser(false);
        return;
      }

      try {
        // Try the root users collection first (as shown in the Firestore screenshot)
        const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
        if (userDoc.exists()) {
          setUserData(userDoc.data());
        } else {
          // Fallback to tenant-specific users collection
          const tenantUserDoc = await getDoc(doc(db, 'tenants', tenantId, 'users', currentUser.uid));
          if (tenantUserDoc.exists()) {
            setUserData(tenantUserDoc.data());
          }
        }
      } catch (error) {
        console.error('Error fetching user data:', error);
      } finally {
        setLoadingUser(false);
      }
    };

    fetchUserData();
  }, [currentUser?.uid, tenantId]);
  
  // Calculate dashboard metrics using unified association logic
  const myDeals = React.useMemo(() => 
    AssociationUtils.getUserAssociatedDeals(allDeals, currentUser?.uid), 
    [allDeals, currentUser?.uid]
  );

  const myCompanies = React.useMemo(() => 
    AssociationUtils.getUserAssociatedCompanies(allCompanies, currentUser?.uid), 
    [allCompanies, currentUser?.uid]
  );

  const myContacts = React.useMemo(() => 
    AssociationUtils.getUserAssociatedContacts(contacts, currentUser?.uid, myCompanies.map(c => c.id)), 
    [contacts, myCompanies]
  );

  const myTasks = React.useMemo(() => tasks.filter(task => task.assignedTo === currentUser?.uid), [tasks, currentUser?.uid]);

  // Calculate pipeline value
  const pipelineValue = React.useMemo(() => myDeals.reduce((sum, deal) => {
    const value = getDealEstimatedValue(deal);
    if (value !== '-') {
      const numericValue = value.replace(/[$,]/g, '').replace(/\s*-\s*.*/, '');
      return sum + (parseFloat(numericValue) || 0);
    }
    return sum;
  }, 0), [myDeals]);

  // Get deals by stage
  const dealsByStage = React.useMemo(() => pipelineStages.map(stage => ({
    stage: stage.name,
    count: myDeals.filter(deal => deal.stage === stage.name).length,
    value: myDeals.filter(deal => deal.stage === stage.name).reduce((sum, deal) => {
      const value = getDealEstimatedValue(deal);
      if (value !== '-') {
        const numericValue = value.replace(/[$,]/g, '').replace(/\s*-\s*.*/, '');
        return sum + (parseFloat(numericValue) || 0);
      }
      return sum;
    }, 0)
  })), [pipelineStages, myDeals]);

  // Get recent activity (last 5 tasks)
  const recentTasks = React.useMemo(() => myTasks
    .sort((a, b) => new Date(b.createdAt?.toDate?.() || b.createdAt).getTime() - new Date(a.createdAt?.toDate?.() || a.createdAt).getTime())
    .slice(0, 5), [myTasks]);

  // Get upcoming tasks (due in next 7 days)
  const upcomingTasks = React.useMemo(() => myTasks.filter(task => {
    if (!task.dueDate) return false;
    const dueDate = new Date(task.dueDate);
    const today = new Date();
    const nextWeek = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
    return dueDate >= today && dueDate <= nextWeek;
  }), [myTasks]);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  // Memoize the entity object to prevent unnecessary re-renders
  const tasksEntity = React.useMemo(() => ({
    id: currentUser?.uid || 'dashboard',
    name: 'My Tasks',
    associations: {
      deals: myDeals.map(deal => deal.id),
      companies: myCompanies.map(company => company.id),
      contacts: myContacts.map(contact => contact.id),
      salespeople: [currentUser?.uid]
    }
  }), [currentUser?.uid, myDeals, myCompanies, myContacts]);

  // Memoize the preloaded arrays to prevent unnecessary re-renders
  const memoizedContacts = React.useMemo(() => contacts, [contacts]); // Use contacts for TasksDashboard
  const memoizedMyDeals = React.useMemo(() => myDeals, [myDeals]);
  const memoizedAllCompanies = React.useMemo(() => allCompanies, [allCompanies]);
  const memoizedEmptyArray = React.useMemo(() => [], []);

  return (
    <Box>
      {/* Welcome Header */}
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" gutterBottom>
          Welcome back, {loadingUser ? '...' : (userData?.firstName || 'there')}!
        </Typography>
        {/* <Typography variant="body1" color="text.secondary">
          Here's your sales dashboard overview
        </Typography> */}
      </Box>



      {/* Calendar Widget - Spans Center and Right Columns */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12} md={4}>
          {/* Left Column - Todos & Key Metrics */}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {/* Todos Widget */}
            <Card>
              <CardHeader 
                title="To-Dos" 
                action={
                  <IconButton 
                    size="small" 
                    title="Add new task"
                    onClick={() => {
                      // This will open the task creation dialog
                      // For now, we'll navigate to the tasks tab
                      navigate('/crm?tab=tasks');
                    }}
                  >
                    <AddIcon />
                  </IconButton>
                }
                titleTypographyProps={{ variant: 'h6', fontWeight: 'bold' }}
              />
              <CardContent sx={{ p: 0 }}>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <TasksDashboard
                    entityId={currentUser?.uid || 'dashboard'}
                    entityType="salesperson"
                    tenantId={tenantId}
                    entity={tasksEntity}
                    preloadedContacts={memoizedContacts}
                    preloadedSalespeople={memoizedEmptyArray}
                    preloadedCompany={null}
                    // Pass ALL companies for association resolution (not just myCompanies)
                    preloadedDeals={memoizedMyDeals}
                    preloadedCompanies={memoizedAllCompanies}
                    showOnlyTodos={true}
                    showCompletedInTodos={false}
                  />
                </Box>
              </CardContent>
            </Card>

            {/* Key Metrics */}
            <Card>
              <CardHeader 
                title="Key Metrics" 
                titleTypographyProps={{ variant: 'h6', fontWeight: 'bold' }}
              />
              <CardContent sx={{ p: 2 }}>
                {!initialDataLoaded ? (
                  <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 4 }}>
                    <CircularProgress size={24} />
                    <Typography variant="body2" color="text.secondary" sx={{ ml: 2 }}>
                      Loading metrics...
                    </Typography>
                  </Box>
                ) : (
                  <Grid container spacing={2}>
                    <Grid item xs={6}>
                      <Box sx={{ textAlign: 'center', p: 1 }}>
                        <Typography variant="h4" color="primary" fontWeight="bold">
                          {myDeals.length}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          My Deals
                        </Typography>
                      </Box>
                    </Grid>
                    <Grid item xs={6}>
                      <Box sx={{ textAlign: 'center', p: 1 }}>
                        <Typography variant="h4" color="success.main" fontWeight="bold">
                          {formatCurrency(pipelineValue)}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          Pipeline Value
                        </Typography>
                      </Box>
                    </Grid>
                    <Grid item xs={6}>
                      <Box sx={{ textAlign: 'center', p: 1 }}>
                        <Typography variant="h4" color="info.main" fontWeight="bold">
                          {myCompanies.length}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          My Companies
                        </Typography>
                      </Box>
                    </Grid>
                    <Grid item xs={6}>
                      <Box sx={{ textAlign: 'center', p: 1 }}>
                        <Typography variant="h4" color="warning.main" fontWeight="bold">
                          {myContacts.length}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          My Contacts
                        </Typography>
                      </Box>
                    </Grid>
                  </Grid>
                )}
              </CardContent>
            </Card>
          </Box>
        </Grid>
        <Grid item xs={12} md={8}>
          <CalendarWidget
            userId={currentUser?.uid || ''}
            tenantId={tenantId}
            preloadedContacts={memoizedContacts}
            preloadedSalespeople={memoizedEmptyArray}
            preloadedCompanies={memoizedAllCompanies}
            preloadedDeals={memoizedMyDeals}
          />
        </Grid>
      </Grid>

      {/* Sales Coach temporarily hidden */}


    </Box>
  );
};

// Reports Tab Component
const ReportsTab: React.FC<{
  deals: any[];
  companies: any[];
  contacts: any[];
}> = ({ deals, companies, contacts }) => {
  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="h6" gutterBottom>Sales Reports</Typography>
      <Typography variant="body2" color="text.secondary">
        Reports placeholder. ({deals?.length ?? 0} deals, {companies?.length ?? 0} companies, {contacts?.length ?? 0} contacts)
      </Typography>
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
      {/* <Typography variant="h6" gutterBottom>CRM Settings</Typography> */}
      
      {/* Pipeline Stages */}
      {/* <Card sx={{ mb: 3 }}>
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
      </Card> */}

      {/* Other Settings */}
      {/* <Grid container spacing={3}>
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
      </Grid> */}

              {/* Google Integration Settings */}
        <Box sx={{ mt: 2 }}>
          <GoogleIntegration tenantId={tenantId} />
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