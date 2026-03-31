import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation, useOutletContext, useSearchParams } from 'react-router-dom';
import {
  Box,
  Typography,
  Paper,
  Grid,
  Chip,
  Button,
  TextField,
  InputAdornment,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Alert,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Stack,
  Autocomplete,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
} from '@mui/material';
import {
  Search,
  LocationOn,
  Business,
  Schedule,
  Work,
  AttachMoney,
  People,
  Add,
  Close as CloseIcon,
  AutoAwesome as AutoAwesomeIcon,
  ContentCopy as ContentCopyIcon,
} from '@mui/icons-material';
import { Autocomplete as GoogleAutocomplete } from '@react-google-maps/api';
import { formatHourlyPayRateForDisplay } from '../../utils/hourlyPayDisplay';
import {
  JobsBoardService,
  JobsBoardPost,
  coerceStringArrayField,
} from '../../services/recruiter/jobsBoardService';
import { useAuth } from '../../contexts/AuthContext';
import { collection, getDocs, query, orderBy as firestoreOrderBy } from 'firebase/firestore';
import { db } from '../../firebase';
import { geocodeAddressDetailed, getGeocodingErrorMessage } from '../../utils/geocodeAddress';
import { useFavorites } from '../../hooks/useFavorites';
import FavoriteButton from '../../components/FavoriteButton';
import FavoritesFilter from '../../components/FavoritesFilter';
import { BreadcrumbNav } from '../../components/BreadcrumbNav';
import StandardTablePagination from '../../components/StandardTablePagination';
import type { RecruiterOutletContext } from '../RecruiterDashboard';
import jobTitlesList from '../../data/onetJobTitles.json';
import onetSkills from '../../data/onetSkills.json';
import credentialsSeed from '../../data/credentialsSeed.json';
import { experienceOptions, educationOptions } from '../../data/experienceOptions';
import { backgroundCheckOptions, drugScreeningOptions, additionalScreeningOptions } from '../../data/screeningsOptions';
import { getOptionsForField } from '../../utils/fieldOptions';
import { autoAddGroupsPickerValue, dedupeUserGroupsForUi } from '../../utils/dedupeUserGroupsForUi';
import { generateJobDescriptionWithAi } from '../../utils/jobDescriptionAiGenerate';
import { formatWorksiteCityStateZip } from '../../utils/formatWorksiteAddress';
import { hasJobBoardSyndicationUrl } from '../../utils/jobBoardSyndicationUrls';
import JobBoardSyndicationIconRow from '../../components/JobBoardSyndicationIconRow';

/** Firestore Timestamp, {seconds}, Date, or ISO string → ms for sorting/display */
function toMillisFromUnknown(value: unknown): number {
  if (value == null || value === '') return 0;
  const v = value as { toDate?: () => Date; seconds?: number; nanoseconds?: number };
  if (typeof v.toDate === 'function') {
    const d = v.toDate();
    return d instanceof Date && !isNaN(d.getTime()) ? d.getTime() : 0;
  }
  if (typeof v === 'object' && v !== null && typeof v.seconds === 'number') {
    return v.seconds * 1000 + (typeof v.nanoseconds === 'number' ? v.nanoseconds / 1e6 : 0);
  }
  if (value instanceof Date) return isNaN(value.getTime()) ? 0 : value.getTime();
  if (typeof value === 'number' && !isNaN(value)) return value;
  const d = new Date(value as string);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

function formatCreatedAtCell(...candidates: unknown[]): string {
  let ms = 0;
  for (const c of candidates) {
    ms = toMillisFromUnknown(c);
    if (ms) break;
  }
  if (!ms) return '—';
  return new Date(ms).toLocaleString(undefined, {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

const JobsBoard: React.FC = () => {
  const { tenantId, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  
  // Check if we're accessing from the recruiter module
  const isFromRecruiter = location.pathname.includes('/jobs/jobs-board');
  
  const [posts, setPosts] = useState<JobsBoardPost[]>([]);
  const [filteredJobs, setFilteredJobs] = useState<JobsBoardPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [locationFilter, setLocationFilter] = useState('all');
  const [companyFilter, setCompanyFilter] = useState('all');
  const [openNewPostModal, setOpenNewPostModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const normalizeGroupIds = (value?: string | string[] | null): string[] => {
    if (Array.isArray(value)) {
      return value
        .map((id) => (typeof id === 'string' ? id.trim() : ''))
        .filter((id): id is string => Boolean(id));
    }
    if (typeof value === 'string' && value.trim()) {
      return [value.trim()];
    }
    return [];
  };
  
  // Sorting state
  const [sortField, setSortField] = useState<string>('createdAt');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  // Company and location data for dropdowns
  const [companies, setCompanies] = useState<Array<{ id: string; name: string }>>([]);
  const [locations, setLocations] = useState<Array<{ id: string; name: string; nickname?: string; address: any }>>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>('');
  const [selectedLocationId, setSelectedLocationId] = useState<string>('');
  const [loadingCompanies, setLoadingCompanies] = useState(false);
  const [loadingLocations, setLoadingLocations] = useState(false);
  
  // Company names cache for displaying in table
  const [companyNamesCache, setCompanyNamesCache] = useState<Record<string, string>>({});
  
  // Inline editing state
  const [editingStatus, setEditingStatus] = useState<string | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState<string | null>(null);
  
  // Favorites state using universal system (local fallback when not in recruiter module)
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const { favorites, isFavorite, toggleFavorite } = useFavorites('jobPosts');
  const [useCompanyLocation, setUseCompanyLocation] = useState(true);
  const [cityAutocomplete, setCityAutocomplete] = useState<google.maps.places.Autocomplete | null>(null);
  const cityInputRef = useRef<HTMLInputElement | null>(null);

  const outletCtx = useOutletContext<RecruiterOutletContext | null>();
  const headerSearch = outletCtx?.search ?? '';
  const headerShowFavoritesOnly = outletCtx?.showFavoritesOnly ?? false;
  const effectiveSearch = isFromRecruiter ? headerSearch : searchTerm;
  const effectiveShowFavoritesOnly = isFromRecruiter ? headerShowFavoritesOnly : showFavoritesOnly;

  const [debouncedSearch, setDebouncedSearch] = useState(effectiveSearch);
  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedSearch(effectiveSearch), 300);
    return () => clearTimeout(id);
  }, [effectiveSearch]);

  const [searchParams, setSearchParams] = useSearchParams();
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(20);

  // Job orders for connection
  const [jobOrders, setJobOrders] = useState<Array<{ id: string; jobOrderName: string; status: string }>>([]);
  const [loadingJobOrders, setLoadingJobOrders] = useState(false);
  
  // User groups for restricted visibility
  const [userGroups, setUserGroups] = useState<Array<{ id: string; name: string }>>([]);
  const [loadingUserGroups, setLoadingUserGroups] = useState(false);
  
  // Company defaults for background checks
  const [companyDefaults, setCompanyDefaults] = useState<any>(null);
  const [loadingCompanyDefaults, setLoadingCompanyDefaults] = useState(false);
  
  // Track original form values before job order connection
  const [originalFormValues, setOriginalFormValues] = useState<{
    postTitle: string;
    jobType: 'gig' | 'career' | '';
    jobTitle: string;
    jobDescription: string;
    jobDescriptionPrompt: string;
    companyId: string;
    companyName: string;
    worksiteId: string;
    worksiteName: string;
    street: string;
    city: string;
    state: string;
    zipCode: string;
    startDate: string;
    endDate: string;
    showStart: boolean;
    showEnd: boolean;
    payRate: string;
    workersNeeded: number;
    eVerifyRequired: boolean;
    backgroundCheckPackages: string[];
    showBackgroundChecks: boolean;
    drugScreeningPanels: string[];
    showDrugScreening: boolean;
    additionalScreenings: string[];
    showAdditionalScreenings: boolean;
    skills: string[];
    showSkills: boolean;
    licensesCerts: string[];
    showLicensesCerts: boolean;
    experienceLevels: string[];
    showExperience: boolean;
    educationLevels: string[];
    showEducation: boolean;
    languages: string[];
    showLanguages: boolean;
    physicalRequirements: string[];
    showPhysicalRequirements: boolean;
    uniformRequirements: string[];
    showUniformRequirements: boolean;
    customUniformRequirements: string;
    showCustomUniformRequirements: boolean;
    requiredPpe: string[];
    showRequiredPpe: boolean;
    shift: string[];
    showShift: boolean;
    startTime: string;
    endTime: string;
    showStartTime: boolean;
    showEndTime: boolean;
    restrictedGroups: string[];
    craigslistUrl: string;
    indeedUrl: string;
  } | null>(null);

  const jobsBoardService = JobsBoardService.getInstance();
  const [generatingDescription, setGeneratingDescription] = useState(false);

  // Sorting functionality
  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  // Helper function to safely format dates for display
  const formatDateForDisplay = (dateValue: any): string => {
    if (!dateValue) return '';
    
    try {
      let date: Date;
      
      if (typeof dateValue === 'string') {
        date = new Date(dateValue);
      } else if (dateValue && typeof dateValue.toDate === 'function') {
        // Firestore Timestamp
        date = dateValue.toDate();
      } else if (dateValue && typeof dateValue.toISOString === 'function') {
        // Date object
        date = dateValue;
      } else {
        date = new Date(dateValue);
      }
      
      return isNaN(date.getTime()) ? '' : date.toLocaleDateString();
    } catch (error) {
      console.warn('Error formatting date for display:', dateValue, error);
      return '';
    }
  };

  const getSortedJobs = () => {
    return [...filteredJobs].sort((a, b) => {
      let aValue: any = a[sortField as keyof JobsBoardPost];
      let bValue: any = b[sortField as keyof JobsBoardPost];

      if (sortField === 'createdAt') {
        const am = toMillisFromUnknown(a.createdAt ?? a.postedAt) || toMillisFromUnknown(a.updatedAt);
        const bm = toMillisFromUnknown(b.createdAt ?? b.postedAt) || toMillisFromUnknown(b.updatedAt);
        return sortDirection === 'asc' ? am - bm : bm - am;
      }

      if (aValue === undefined) aValue = '';
      if (bValue === undefined) bValue = '';

      if (sortField === 'startDate' || sortField === 'endDate') {
        const am = toMillisFromUnknown(aValue);
        const bm = toMillisFromUnknown(bValue);
        return sortDirection === 'asc' ? am - bm : bm - am;
      }

      aValue = (aValue || '').toString().toLowerCase();
      bValue = (bValue || '').toString().toLowerCase();

      if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  };

  const handleRowClick = (post: JobsBoardPost) => {
    if (isFromRecruiter) {
      navigate(`/jobs/jobs-board/edit/${post.id}`);
    } else {
      navigate(`/jobs-dashboard/edit/${post.id}`);
    }
  };

  const handleStatusUpdate = async (postId: string, newStatus: 'draft' | 'active' | 'paused' | 'cancelled' | 'expired') => {
    if (!tenantId) return;
    
    try {
      setUpdatingStatus(postId);
      await jobsBoardService.updatePostStatus(tenantId, postId, newStatus);
      
      // Update local state
      setPosts(prev => prev.map(post => 
        post.id === postId ? { ...post, status: newStatus } : post
      ));
      setFilteredJobs(prev => prev.map(post => 
        post.id === postId ? { ...post, status: newStatus } : post
      ));
      
      setEditingStatus(null);
    } catch (err: any) {
      console.error('Error updating status:', err);
      // Could show a toast notification here
    } finally {
      setUpdatingStatus(null);
    }
  };


  // Shift options for Career job type
  const shiftOptions = [
    'Full Time',
    'Part Time',
    'Temporary',
    'On Call',
    'First Shift',
    'Second Shift', 
    'Third Shift',
    'Day Shift',
    'Night Shift',
    'Swing Shift',
    'Weekends',
    'Some Weekends',
    'Some Nights',
    '8 Hour',
    '10 Hour',
    '12 Hour'
  ];

  // New post form state
  const [newPost, setNewPost] = useState({
    postTitle: '',
    jobType: '' as 'gig' | 'career' | '',
    jobTitle: '',
    jobDescription: '',
    jobDescriptionPrompt: '',
    craigslistUrl: '',
    indeedUrl: '',
    companyId: '',
    companyName: '',
    worksiteId: '',
    worksiteName: '',
    street: '',
    city: '',
    state: '',
    zipCode: '',
    startDate: '',
    endDate: '',
    expDate: '',
    showStart: false,
    showEnd: false,
    payRate: '',
    showPayRate: true,
    workersNeeded: 1,
    eVerifyRequired: false,
    backgroundCheckPackages: [],
    showBackgroundChecks: false,
    drugScreeningPanels: [],
    showDrugScreening: false,
    additionalScreenings: [],
    showAdditionalScreenings: false,
    visibility: 'public' as 'public' | 'private' | 'restricted',
    restrictedGroups: [] as string[],
    status: 'draft' as 'draft' | 'active' | 'paused' | 'cancelled' | 'expired',
    jobOrderId: '',
    skills: [] as string[],
    showSkills: false,
    licensesCerts: [] as string[],
    showLicensesCerts: false,
    experienceLevels: [] as string[],
    showExperience: false,
    educationLevels: [] as string[],
    showEducation: false,
    languages: [] as string[],
    showLanguages: false,
    physicalRequirements: [] as string[],
    showPhysicalRequirements: false,
    uniformRequirements: [] as string[],
    showUniformRequirements: false,
    customUniformRequirements: '',
    showCustomUniformRequirements: false,
    requiredPpe: [] as string[],
    showRequiredPpe: false,
    shift: [] as string[],
    showShift: false,
    startTime: '',
    endTime: '',
    showStartTime: false,
    showEndTime: false,
    autoAddToUserGroups: [] as string[],
    coordinates: undefined as { lat: number; lng: number } | undefined,
  });

  const userGroupsForUi = useMemo(() => dedupeUserGroupsForUi(userGroups), [userGroups]);

  const autoAddGroupsAutocompleteValue = useMemo(
    () => autoAddGroupsPickerValue(newPost.autoAddToUserGroups, userGroups, userGroupsForUi),
    [newPost.autoAddToUserGroups, userGroups, userGroupsForUi]
  );

  const canonicalAutoAddGroupIds = useMemo(
    () => autoAddGroupsAutocompleteValue.map((g) => g.id),
    [autoAddGroupsAutocompleteValue]
  );

  useEffect(() => {
    if (userGroups.length === 0) return;
    const a = [...newPost.autoAddToUserGroups].sort().join('\0');
    const b = [...canonicalAutoAddGroupIds].sort().join('\0');
    if (a === b) return;
    setNewPost((prev) => ({ ...prev, autoAddToUserGroups: [...canonicalAutoAddGroupIds] }));
  }, [userGroups.length, canonicalAutoAddGroupIds, newPost.autoAddToUserGroups]);

  // Load jobs board posts from Firestore
  useEffect(() => {
    loadPosts();
    loadJobOrders();
    loadUserGroups();
    loadCompanyDefaults();
  }, [tenantId]);

  const loadPosts = async () => {
    if (!tenantId) return;

    try {
      setLoading(true);
      // Use getAllPosts to show all job posts regardless of status/visibility for internal management
      const postsData = await jobsBoardService.getAllPosts(tenantId);
      setPosts(postsData);
      setFilteredJobs(postsData);

      // Load company names for posts that have companyId but empty companyName
      await loadCompanyNamesForPosts(postsData);
    } catch (err: any) {
      console.error('Error loading jobs board posts:', err);
      setError(err.message || 'Failed to load jobs board posts');
    } finally {
      setLoading(false);
    }
  };

  const loadCompanyNamesForPosts = async (posts: JobsBoardPost[]) => {
    if (!tenantId) return;
    
    try {
      // Get unique company IDs that need names
      const companyIdsToLoad = [...new Set(
        posts
          .filter(post => post.companyId && (!post.companyName || post.companyName.trim() === ''))
          .map(post => post.companyId)
      )].filter(Boolean);
      
      if (companyIdsToLoad.length === 0) return;
      
      // Fetch company names in batch
      const companyPromises = companyIdsToLoad.map(async (companyId) => {
        try {
          const { doc, getDoc } = await import('firebase/firestore');
          const { db } = await import('../../firebase');
          
          const companyRef = doc(db, 'tenants', tenantId, 'crm_companies', companyId);
          const companyDoc = await getDoc(companyRef);
          
          if (companyDoc.exists()) {
            const companyData = companyDoc.data();
            return {
              id: companyId,
              name: companyData.companyName || companyData.name || 'Unknown Company'
            };
          }
          return {
            id: companyId,
            name: 'Unknown Company'
          };
        } catch (err) {
          console.warn(`Failed to load company name for ${companyId}:`, err);
          return {
            id: companyId,
            name: 'Unknown Company'
          };
        }
      });
      
      const companyResults = await Promise.all(companyPromises);
      
      // Update the cache
      const newCache: Record<string, string> = {};
      companyResults.forEach(company => {
        newCache[company.id] = company.name;
      });
      
      setCompanyNamesCache(prev => ({ ...prev, ...newCache }));
    } catch (err) {
      console.error('Error loading company names:', err);
    }
  };

  const loadJobOrders = async () => {
    if (!tenantId) return;
    
    try {
      setLoadingJobOrders(true);
      const { collection, query, where, getDocs } = await import('firebase/firestore');
      const { db } = await import('../../firebase');
      
      const jobOrdersRef = collection(db, 'tenants', tenantId, 'job_orders');
      const q = query(jobOrdersRef, where('status', 'in', ['draft', 'open', 'interviewing', 'offer', 'partially_filled']));
      const querySnapshot = await getDocs(q);
      
      const jobOrdersData = querySnapshot.docs.map(doc => ({
        id: doc.id,
        jobOrderName: doc.data().jobOrderName || 'Unnamed Job Order',
        status: doc.data().status || 'Unknown'
      }));
      
      setJobOrders(jobOrdersData);
    } catch (err: any) {
      // Handle permissions error gracefully - job orders connection is optional
      if (err.code === 'permission-denied') {
        console.warn('Job orders not accessible - continuing without job order connections');
        setJobOrders([]);
      } else {
        console.error('Error loading job orders:', err);
      }
    } finally {
      setLoadingJobOrders(false);
    }
  };

  const loadUserGroups = async () => {
    if (!tenantId) return;
    
    try {
      setLoadingUserGroups(true);
      const { collection, getDocs } = await import('firebase/firestore');
      const { db } = await import('../../firebase');
      
      const userGroupsRef = collection(db, 'tenants', tenantId, 'userGroups');
      const querySnapshot = await getDocs(userGroupsRef);
      
      const userGroupsData = querySnapshot.docs.map(doc => ({
        id: doc.id,
        name: doc.data().title || doc.data().name || 'Unnamed Group'
      }));
      
      setUserGroups(userGroupsData);
    } catch (err: any) {
      // Handle permissions error gracefully - user groups are optional for restricted visibility
      if (err.code === 'permission-denied') {
        console.warn('User groups not accessible - restricted visibility options will be limited');
        setUserGroups([]);
      } else {
        console.error('Error loading user groups:', err);
      }
    } finally {
      setLoadingUserGroups(false);
    }
  };

  const loadCompanyDefaults = async () => {
    if (!tenantId) return;
    
    try {
      setLoadingCompanyDefaults(true);
      const { doc, getDoc } = await import('firebase/firestore');
      const { db } = await import('../../firebase');
      
      const defaultsRef = doc(db, 'tenants', tenantId, 'companyDefaults', 'defaults');
      const defaultsDoc = await getDoc(defaultsRef);
      
      if (defaultsDoc.exists()) {
        setCompanyDefaults(defaultsDoc.data());
      }
    } catch (err: any) {
      // Handle permissions error gracefully - company defaults are optional
      if (err.code === 'permission-denied') {
        console.warn('Company defaults not accessible - continuing without defaults');
      } else {
        console.error('Error loading company defaults:', err);
      }
      // Don't set companyDefaults to anything - keep it null
    } finally {
      setLoadingCompanyDefaults(false);
    }
  };

  // Filter jobs based on search and filters
  useEffect(() => {
    let filtered = posts;

    const q = debouncedSearch.trim().toLowerCase();
    if (q) {
      filtered = filtered.filter((post) => {
        const companyLabel =
          (post.companyName && post.companyName.trim() !== ''
            ? post.companyName
            : post.companyId && companyNamesCache[post.companyId]
              ? companyNamesCache[post.companyId]
              : '') || '';
        const haystack = [
          post.postTitle,
          post.jobTitle,
          post.jobDescription,
          post.worksiteName,
          post.companyName,
          companyLabel,
          post.jobPostId,
        ]
          .map((p) => (p == null ? '' : String(p)))
          .join(' ')
          .toLowerCase();
        return haystack.includes(q);
      });
    }

    // Location filter
    if (locationFilter !== 'all') {
      filtered = filtered.filter(post => post.worksiteName === locationFilter);
    }

    // Company filter
    if (companyFilter !== 'all') {
      filtered = filtered.filter(post => getDisplayCompanyName(post) === companyFilter);
    }

    // Favorites filter
    if (effectiveShowFavoritesOnly) {
      filtered = filtered.filter(post => favorites.includes(post.id));
    }

    setFilteredJobs(filtered);
  }, [posts, locationFilter, companyFilter, companyNamesCache, favorites, debouncedSearch, effectiveShowFavoritesOnly]);

  useEffect(() => {
    setPage(0);
  }, [debouncedSearch, locationFilter, companyFilter, effectiveShowFavoritesOnly, sortField, sortDirection]);

  useEffect(() => {
    if (!isFromRecruiter) return;
    if (searchParams.get('new') !== '1') return;
    handleOpenNewPostModal();
    // keep param until close, so refresh doesn't lose state
  }, [isFromRecruiter, searchParams]);

  const getUniqueLocations = () => {
    return Array.from(new Set(posts.map(post => post.worksiteName))).sort();
  };

  const getUniqueCompanies = () => {
    return Array.from(new Set(posts.map(post => getDisplayCompanyName(post)))).sort();
  };

  // Helper function to get the display company name
  const getDisplayCompanyName = (post: JobsBoardPost): string => {
    // If companyName is not empty, use it
    if (post.companyName && post.companyName.trim() !== '') {
      return post.companyName;
    }
    
    // If we have a companyId, try to get the name from cache
    if (post.companyId && companyNamesCache[post.companyId]) {
      return companyNamesCache[post.companyId];
    }
    
    // Fallback to empty string if no company info available
    return '';
  };

  const handleOpenNewPostModal = async () => {
    setOpenNewPostModal(true);
    setSubmitError(null);
    // Load companies when modal opens
    await loadCompanies();
  };

  const loadCompanies = async () => {
    if (!tenantId) return;
    try {
      setLoadingCompanies(true);
      const companiesRef = collection(db, 'tenants', tenantId, 'crm_companies');
      const q = query(companiesRef, firestoreOrderBy('companyName', 'asc'));
      const snapshot = await getDocs(q);
      const companiesData = snapshot.docs.map(doc => ({
        id: doc.id,
        name: doc.data().companyName || doc.data().name || 'Unnamed Company'
      }));
      setCompanies(companiesData);
    } catch (err: any) {
      console.error('Error loading companies:', err);
      setSubmitError('Failed to load companies');
    } finally {
      setLoadingCompanies(false);
    }
  };

  const loadLocationsForCompany = async (companyId: string) => {
    if (!tenantId || !companyId) return;
    try {
      setLoadingLocations(true);
      const locationsRef = collection(db, 'tenants', tenantId, 'crm_companies', companyId, 'locations');
      const snapshot = await getDocs(locationsRef);
      const locationsData = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          name: data.name || 'Unnamed Location',
          nickname: data.nickname,
          address: {
            street: data.address || '',
            city: data.city || '',
            state: data.state || '',
            zipCode: data.zipcode || data.zipCode || '',
            coordinates: data.latitude && data.longitude ? {
              lat: data.latitude,
              lng: data.longitude
            } : undefined
          }
        };
      });
      setLocations(locationsData);
    } catch (err: any) {
      console.error('Error loading locations:', err);
      setSubmitError('Failed to load locations for selected company');
    } finally {
      setLoadingLocations(false);
    }
  };

  const handleCompanyChange = async (companyId: string) => {
    setSelectedCompanyId(companyId);
    setSelectedLocationId('');
    setLocations([]);
    
    const selectedCompany = companies.find(c => c.id === companyId);
    if (selectedCompany) {
      setNewPost({
        ...newPost,
        companyId,
        companyName: selectedCompany.name,
        worksiteId: '',
        worksiteName: '',
        street: '',
        city: '',
        state: '',
        zipCode: ''
      });
      await loadLocationsForCompany(companyId);
    }
  };

  const handleLocationChange = (locationId: string) => {
    setSelectedLocationId(locationId);
    const selectedLocation = locations.find(l => l.id === locationId);
    if (selectedLocation) {
      setNewPost({
        ...newPost,
        worksiteId: locationId,
        worksiteName: selectedLocation.nickname || selectedLocation.name,
        street: selectedLocation.address.street,
        city: selectedLocation.address.city,
        state: selectedLocation.address.state,
        zipCode: selectedLocation.address.zipCode,
        // Store coordinates for distance calculations
        coordinates: selectedLocation.address.coordinates
      });
    }
  };

  // Helper function to safely convert dates to YYYY-MM-DD format for date inputs
  const formatDateForInput = (dateValue: any): string => {
    if (!dateValue) return '';
    
    try {
      if (typeof dateValue === 'string') {
        // If it's already a string, check if it's in the right format
        if (dateValue.match(/^\d{4}-\d{2}-\d{2}$/)) {
          return dateValue;
        }
        // Try to parse and format
        const date = new Date(dateValue);
        return isNaN(date.getTime()) ? '' : date.toISOString().split('T')[0];
      } else if (dateValue && typeof dateValue.toDate === 'function') {
        // Firestore Timestamp
        return dateValue.toDate().toISOString().split('T')[0];
      } else if (dateValue && typeof dateValue.toISOString === 'function') {
        // Date object
        return dateValue.toISOString().split('T')[0];
      } else {
        // Try to create a Date object
        const date = new Date(dateValue);
        return isNaN(date.getTime()) ? '' : date.toISOString().split('T')[0];
      }
    } catch (error) {
      console.warn('Error formatting date:', dateValue, error);
      return '';
    }
  };

  const handleJobOrderChange = async (jobOrderId: string) => {
    if (jobOrderId) {
      // Save current form values before populating from job order
      setOriginalFormValues({
        postTitle: newPost.postTitle,
        jobType: newPost.jobType,
        jobTitle: newPost.jobTitle,
        jobDescription: newPost.jobDescription,
        jobDescriptionPrompt: newPost.jobDescriptionPrompt,
        craigslistUrl: newPost.craigslistUrl,
        indeedUrl: newPost.indeedUrl,
        companyId: newPost.companyId,
        companyName: newPost.companyName,
        worksiteId: newPost.worksiteId,
        worksiteName: newPost.worksiteName,
        street: newPost.street,
        city: newPost.city,
        state: newPost.state,
        zipCode: newPost.zipCode,
        startDate: newPost.startDate,
        endDate: newPost.endDate,
        showStart: newPost.showStart,
        showEnd: newPost.showEnd,
        payRate: newPost.payRate,
        workersNeeded: newPost.workersNeeded,
        eVerifyRequired: newPost.eVerifyRequired,
        backgroundCheckPackages: newPost.backgroundCheckPackages,
        showBackgroundChecks: newPost.showBackgroundChecks,
        drugScreeningPanels: newPost.drugScreeningPanels,
        showDrugScreening: newPost.showDrugScreening,
        additionalScreenings: newPost.additionalScreenings,
        showAdditionalScreenings: newPost.showAdditionalScreenings,
        skills: newPost.skills,
        showSkills: newPost.showSkills,
        licensesCerts: newPost.licensesCerts,
        showLicensesCerts: newPost.showLicensesCerts,
        experienceLevels: newPost.experienceLevels,
        showExperience: newPost.showExperience,
        educationLevels: newPost.educationLevels,
        showEducation: newPost.showEducation,
        languages: newPost.languages,
        showLanguages: newPost.showLanguages,
        physicalRequirements: newPost.physicalRequirements,
        showPhysicalRequirements: newPost.showPhysicalRequirements,
        uniformRequirements: newPost.uniformRequirements,
        showUniformRequirements: newPost.showUniformRequirements,
        customUniformRequirements: newPost.customUniformRequirements,
        showCustomUniformRequirements: newPost.showCustomUniformRequirements,
        requiredPpe: newPost.requiredPpe,
        showRequiredPpe: newPost.showRequiredPpe,
        shift: newPost.shift,
        showShift: newPost.showShift,
        startTime: newPost.startTime,
        endTime: newPost.endTime,
        showStartTime: newPost.showStartTime,
        showEndTime: newPost.showEndTime,
        restrictedGroups: newPost.restrictedGroups
      });
      
      try {
        // Load job order data to pre-fill form
        const { doc, getDoc } = await import('firebase/firestore');
        const { db } = await import('../../firebase');
        
        const jobOrderRef = doc(db, 'tenants', tenantId, 'job_orders', jobOrderId);
        const jobOrderDoc = await getDoc(jobOrderRef);
        
        if (jobOrderDoc.exists()) {
          const jobOrderData = jobOrderDoc.data();
          
          // Pre-fill form with job order data
          setNewPost(prev => ({
            ...prev,
            jobOrderId,
            postTitle: prev.postTitle || jobOrderData.jobOrderName || '',
            jobType: jobOrderData.jobType || 'career', // Copy job type from job order
            jobTitle: prev.jobTitle || jobOrderData.jobTitle || '',
            jobDescription: prev.jobDescription,
            jobDescriptionPrompt: prev.jobDescriptionPrompt || '',
            craigslistUrl: '',
            indeedUrl: '',
            companyId: jobOrderData.companyId || '',
            companyName: jobOrderData.companyName || '',
            worksiteId: jobOrderData.worksiteId || '',
            worksiteName: jobOrderData.worksiteName || '',
            street: jobOrderData.worksiteAddress?.street || '',
            city: jobOrderData.worksiteAddress?.city || '',
            state: jobOrderData.worksiteAddress?.state || '',
            zipCode: jobOrderData.worksiteAddress?.zipCode || '',
            startDate: formatDateForInput(jobOrderData.startDate),
            endDate: formatDateForInput(jobOrderData.endDate),
            payRate: jobOrderData.payRate?.toString() || '',
            workersNeeded: jobOrderData.workersNeeded || 1,
            eVerifyRequired: jobOrderData.eVerifyRequired || false,
            backgroundCheckPackages: jobOrderData.backgroundCheckPackages || [],
            drugScreeningPanels: jobOrderData.drugScreeningPanels || [],
            additionalScreenings: jobOrderData.additionalScreenings || [],
            // Copy requirements from job order; keep draft post values when the order has none
            licensesCerts: (() => {
              const fromJo = coerceStringArrayField(
                jobOrderData.licensesCerts?.length
                  ? jobOrderData.licensesCerts
                  : [...(jobOrderData.requiredLicenses || []), ...(jobOrderData.requiredCertifications || [])]
              );
              return fromJo.length > 0 ? fromJo : prev.licensesCerts;
            })(),
            showLicensesCerts:
              coerceStringArrayField(
                jobOrderData.licensesCerts?.length
                  ? jobOrderData.licensesCerts
                  : [...(jobOrderData.requiredLicenses || []), ...(jobOrderData.requiredCertifications || [])]
              ).length > 0
                ? true
                : prev.showLicensesCerts,
            skills: (() => {
              const fromJo = coerceStringArrayField(jobOrderData.skillsRequired);
              return fromJo.length > 0 ? fromJo : prev.skills;
            })(),
            showSkills:
              coerceStringArrayField(jobOrderData.skillsRequired).length > 0 ? true : prev.showSkills,
            languages: (() => {
              const fromJo = coerceStringArrayField(jobOrderData.languagesRequired);
              return fromJo.length > 0 ? fromJo : prev.languages;
            })(),
            showLanguages:
              coerceStringArrayField(jobOrderData.languagesRequired).length > 0 ? true : prev.showLanguages,
            experienceLevels: jobOrderData.experienceRequired
              ? (() => {
                  const expMap: Record<string, string> = {
                    none: 'No Experience Required',
                    entry: 'Entry-Level (0–1 year)',
                    '1-2': '1–2 Years',
                    '3-5': '3–5 Years (Mid-Level)',
                    '5-7': '5–7 Years (Advanced)',
                    '8-10': '8–10 Years (Senior-Level)',
                    '10+': '10+ Years (Expert / Executive)',
                  };
                  return [expMap[jobOrderData.experienceRequired] || jobOrderData.experienceRequired];
                })()
              : prev.experienceLevels,
            showExperience: jobOrderData.experienceRequired
              ? true
              : prev.showExperience,
            educationLevels: jobOrderData.educationRequired
              ? (() => {
                  const eduMap: Record<string, string> = {
                    none: 'No Formal Education Required',
                    highschool: 'High School Diploma or Equivalent',
                    associate: 'Associate Degree',
                    bachelor: "Bachelor's Degree",
                    master: "Master's Degree",
                    doctorate: 'Doctorate / PhD',
                  };
                  return [eduMap[jobOrderData.educationRequired] || jobOrderData.educationRequired];
                })()
              : prev.educationLevels,
            showEducation: jobOrderData.educationRequired ? true : prev.showEducation,
            physicalRequirements: (() => {
              const fromJo = coerceStringArrayField(jobOrderData.physicalRequirements);
              return fromJo.length > 0 ? fromJo : prev.physicalRequirements;
            })(),
            showPhysicalRequirements:
              coerceStringArrayField(jobOrderData.physicalRequirements).length > 0
                ? true
                : prev.showPhysicalRequirements,
            uniformRequirements: (() => {
              const fromJo = coerceStringArrayField(jobOrderData.uniformRequirements);
              return fromJo.length > 0 ? fromJo : prev.uniformRequirements;
            })(),
            showUniformRequirements:
              coerceStringArrayField(jobOrderData.uniformRequirements).length > 0
                ? true
                : prev.showUniformRequirements,
            customUniformRequirements:
              jobOrderData.customUniformRequirements != null &&
              String(jobOrderData.customUniformRequirements).trim() !== ''
                ? String(jobOrderData.customUniformRequirements)
                : prev.customUniformRequirements,
            showCustomUniformRequirements:
              jobOrderData.customUniformRequirements != null &&
              String(jobOrderData.customUniformRequirements).trim() !== ''
                ? true
                : prev.showCustomUniformRequirements,
            requiredPpe: (() => {
              const fromJo = coerceStringArrayField(jobOrderData.ppeRequirements);
              return fromJo.length > 0 ? fromJo : prev.requiredPpe;
            })(),
            showRequiredPpe:
              coerceStringArrayField(jobOrderData.ppeRequirements).length > 0
                ? true
                : prev.showRequiredPpe,
          }));
          
          // Set company and location if available
          if (jobOrderData.companyId) {
            setSelectedCompanyId(jobOrderData.companyId);
            await loadLocationsForCompany(jobOrderData.companyId);
            if (jobOrderData.worksiteId) {
              setSelectedLocationId(jobOrderData.worksiteId);
              
              // Fetch the actual worksite details to populate address fields
              try {
                const worksiteRef = doc(db, 'tenants', tenantId, 'crm_companies', jobOrderData.companyId, 'locations', jobOrderData.worksiteId);
                const worksiteDoc = await getDoc(worksiteRef);
                
                if (worksiteDoc.exists()) {
                  const worksiteData = worksiteDoc.data();
                  setNewPost(prev => ({
                    ...prev,
                    worksiteId: jobOrderData.worksiteId,
                    worksiteName: worksiteData.nickname || worksiteData.name || jobOrderData.worksiteName || '',
                    street: worksiteData.address || worksiteData.street || '',
                    city: worksiteData.city || '',
                    state: worksiteData.state || '',
                    zipCode: worksiteData.zipcode || worksiteData.zipCode || ''
                  }));
                }
              } catch (worksiteErr) {
                console.warn('Failed to load worksite details:', worksiteErr);
                // Fallback to job order data if worksite fetch fails
                setNewPost(prev => ({
                  ...prev,
                  worksiteId: jobOrderData.worksiteId,
                  worksiteName: jobOrderData.worksiteName || '',
                  street: jobOrderData.worksiteAddress?.street || '',
                  city: jobOrderData.worksiteAddress?.city || '',
                  state: jobOrderData.worksiteAddress?.state || '',
                  zipCode: jobOrderData.worksiteAddress?.zipCode || ''
                }));
              }
            }
          }
        }
      } catch (err) {
        console.error('Error loading job order data:', err);
      }
    } else {
      // Clear job order connection
      setNewPost({ ...newPost, jobOrderId: '' });
    }
  };

  const onCityAutocompleteLoad = (autocomplete: google.maps.places.Autocomplete) => {
    setCityAutocomplete(autocomplete);
  };

  const onCityPlaceChanged = () => {
    if (!cityAutocomplete) return;
    const place = cityAutocomplete.getPlace();
    if (!place.geometry?.location) return;

    let city = '';
    let state = '';
    let zipCode = '';

    place.address_components?.forEach((component) => {
      if (component.types.includes('locality')) {
        city = component.long_name;
      }
      if (component.types.includes('administrative_area_level_1')) {
        state = component.short_name;
      }
      if (component.types.includes('postal_code')) {
        zipCode = component.long_name;
      }
    });

    const ac = place.address_components || [];
    const pick = (t: string) => ac.find((c) => c.types.includes(t))?.long_name || '';
    if (!city) {
      city =
        pick('sublocality') ||
        pick('sublocality_level_1') ||
        pick('administrative_area_level_3') ||
        pick('postal_town') ||
        '';
    }
    if (!city && place.name) {
      city = place.name.replace(/,.*$/, '').trim();
    }

    const coordinates = {
      lat: place.geometry.location.lat(),
      lng: place.geometry.location.lng(),
    };

    setNewPost((prev) => ({
      ...prev,
      worksiteName: place.formatted_address || `${city}, ${state}`.trim(),
      street: '',
      city,
      state,
      zipCode,
      coordinates,
    }));
  };

  /** If the user typed an address but did not pick a suggestion, geocode on blur so city/state/coords persist. */
  const onNewPostCityBlur = () => {
    const raw = (cityInputRef.current?.value || '').trim();
    if (!raw) return;
    void (async () => {
      try {
        const d = await geocodeAddressDetailed(raw);
        setNewPost((prev) => {
          if (prev.city?.trim() && prev.state?.trim() && prev.coordinates) {
            return prev;
          }
          const st = (d.stateCode || '').toUpperCase();
          const cityName = (d.city || '').trim();
          if (!cityName || !st) return prev;
          return {
            ...prev,
            worksiteName: d.formattedAddress || raw,
            street: d.street || '',
            city: cityName,
            state: st,
            zipCode: (d.zip || '').trim(),
            coordinates: { lat: d.lat, lng: d.lng },
          };
        });
      } catch (e) {
        console.warn('[JobsBoard] City blur geocode:', getGeocodingErrorMessage(e, { hasAutocomplete: true }));
      }
    })();
  };

  const handleCloseNewPostModal = () => {
    setOpenNewPostModal(false);
    setNewPost({
      postTitle: '',
      jobType: 'gig',
      jobTitle: '',
      jobDescription: '',
      jobDescriptionPrompt: '',
      craigslistUrl: '',
      indeedUrl: '',
      companyId: '',
      companyName: '',
      worksiteId: '',
      worksiteName: '',
      street: '',
      city: '',
      state: '',
      zipCode: '',
      startDate: '',
      endDate: '',
      expDate: '',
      showStart: false,
      showEnd: false,
      payRate: '',
      showPayRate: true,
      workersNeeded: 1,
      eVerifyRequired: false,
      backgroundCheckPackages: [],
      showBackgroundChecks: false,
      drugScreeningPanels: [],
      showDrugScreening: false,
      additionalScreenings: [],
      showAdditionalScreenings: false,
      visibility: 'public',
      restrictedGroups: [],
      status: 'draft',
      jobOrderId: '',
      skills: [],
      showSkills: false,
      licensesCerts: [],
      showLicensesCerts: false,
      experienceLevels: [],
      showExperience: false,
      educationLevels: [],
      showEducation: false,
      languages: [],
      showLanguages: false,
      physicalRequirements: [],
      showPhysicalRequirements: false,
      uniformRequirements: [],
      showUniformRequirements: false,
      customUniformRequirements: '',
      showCustomUniformRequirements: false,
      requiredPpe: [],
      showRequiredPpe: false,
      shift: [],
      showShift: false,
      startTime: '',
      endTime: '',
      showStartTime: false,
      showEndTime: false,
    autoAddToUserGroups: [],
      coordinates: undefined,
    });
    setSelectedCompanyId('');
    setSelectedLocationId('');
    setCompanies([]);
    setLocations([]);
    setUseCompanyLocation(true);
    setSubmitError(null);
    setOriginalFormValues(null);
    if (isFromRecruiter && searchParams.get('new') === '1') {
      setSearchParams({});
    }
  };

  // Check if form is valid for submission
  const handleGenerateJobDescription = async () => {
    if (!tenantId) return;
    setGeneratingDescription(true);
    setSubmitError(null);
    try {
      const text = await generateJobDescriptionWithAi({
        tenantId,
        formData: newPost as Record<string, any>,
        jobOrderData: undefined,
      });
      if (text) {
        setNewPost((prev) => ({ ...prev, jobDescription: text }));
      } else {
        setSubmitError('Failed to generate job description');
      }
    } catch (e: any) {
      setSubmitError(e?.message || 'Failed to generate job description');
    } finally {
      setGeneratingDescription(false);
    }
  };

  const isFormValid = () => {
    // Required fields
    if (!newPost.postTitle.trim()) return false;
    if (!newPost.jobType) return false;
    if (!newPost.jobDescription.trim()) return false;
    
    // Location validation
    if (useCompanyLocation) {
      if (!selectedCompanyId || !selectedLocationId) return false;
    } else {
      if (!newPost.city.trim() || !newPost.state.trim()) return false;
    }
    
    return true;
  };

  const handleSubmitNewPost = async () => {
    if (!tenantId) return;

    // Validation
    if (!newPost.postTitle.trim()) {
      setSubmitError('Post title is required');
      return;
    }
    if (!newPost.jobType) {
      setSubmitError('Job type is required');
      return;
    }
    if (!newPost.jobDescription.trim()) {
      setSubmitError('Job description is required');
      return;
    }
    
    if (useCompanyLocation) {
      if (!selectedCompanyId) {
        setSubmitError('Please select a company');
        return;
      }
      if (!selectedLocationId) {
        setSubmitError('Please select a worksite location');
        return;
      }
    } else {
      if (!newPost.city.trim() || !newPost.state.trim()) {
        setSubmitError('Please select a city and state');
        return;
      }
    }

    try {
      setSubmitting(true);
      setSubmitError(null);

      await jobsBoardService.createPost(
        tenantId,
        {
          postTitle: newPost.postTitle.trim(),
          jobType: newPost.jobType,
          jobTitle: newPost.jobTitle.trim(),
          jobDescription: newPost.jobDescription.trim(),
          ...(newPost.jobDescriptionPrompt.trim()
            ? { jobDescriptionPrompt: newPost.jobDescriptionPrompt.trim() }
            : {}),
          ...(newPost.craigslistUrl.trim() ? { craigslistUrl: newPost.craigslistUrl.trim() } : {}),
          ...(newPost.indeedUrl.trim() ? { indeedUrl: newPost.indeedUrl.trim() } : {}),
          companyId: newPost.companyId || undefined,
          companyName: newPost.companyName.trim(),
          worksiteId: newPost.worksiteId || undefined,
          worksiteName: newPost.worksiteName.trim(),
          worksiteAddress: {
            street: newPost.street.trim(),
            city: newPost.city.trim(),
            state: newPost.state.trim(),
            zipCode: newPost.zipCode.trim(),
            coordinates: newPost.coordinates || undefined,
          },
          startDate: newPost.startDate || null,
          endDate: newPost.endDate || null,
          expDate: newPost.expDate || null,
          showStart: newPost.showStart,
          showEnd: newPost.showEnd,
          payRate: newPost.payRate ? parseFloat(newPost.payRate) : null,
          showPayRate: newPost.showPayRate,
          workersNeeded: newPost.workersNeeded,
          eVerifyRequired: newPost.eVerifyRequired,
          backgroundCheckPackages: newPost.backgroundCheckPackages,
          showBackgroundChecks: newPost.showBackgroundChecks,
          drugScreeningPanels: newPost.drugScreeningPanels,
          showDrugScreening: newPost.showDrugScreening,
          additionalScreenings: newPost.additionalScreenings,
          showAdditionalScreenings: newPost.showAdditionalScreenings,
          skills: newPost.skills,
          showSkills: newPost.showSkills,
          licensesCerts: newPost.licensesCerts,
          showLicensesCerts: newPost.showLicensesCerts,
          experienceLevels: newPost.experienceLevels,
          showExperience: newPost.showExperience,
          educationLevels: newPost.educationLevels,
          showEducation: newPost.showEducation,
          languages: newPost.languages,
          showLanguages: newPost.showLanguages,
          physicalRequirements: newPost.physicalRequirements,
          showPhysicalRequirements: newPost.showPhysicalRequirements,
          uniformRequirements: newPost.uniformRequirements,
          showUniformRequirements: newPost.showUniformRequirements,
          customUniformRequirements: newPost.customUniformRequirements,
          showCustomUniformRequirements: newPost.showCustomUniformRequirements,
          requiredPpe: newPost.requiredPpe,
          showRequiredPpe: newPost.showRequiredPpe,
          shift: newPost.shift,
          showShift: newPost.showShift,
          startTime: newPost.startTime,
          endTime: newPost.endTime,
          showStartTime: newPost.showStartTime,
          showEndTime: newPost.showEndTime,
          visibility: newPost.visibility,
          restrictedGroups: newPost.restrictedGroups,
          status: newPost.status,
          jobOrderId: newPost.jobOrderId || undefined,
          autoAddToUserGroups: newPost.autoAddToUserGroups,
          autoAddToUserGroup: newPost.autoAddToUserGroups.length === 1 ? newPost.autoAddToUserGroups[0] : undefined,
        },
        user?.uid || 'system'
      );

      handleCloseNewPostModal();
      loadPosts(); // Reload posts
    } catch (err: any) {
      console.error('Error creating job post:', err);
      setSubmitError(err.message || 'Failed to create job post');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Alert severity="error" sx={{ mb: 2 }}>
        {error}
      </Alert>
    );
  }

  const sortedJobs = getSortedJobs();
  const paginatedJobs = sortedJobs.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);

  return (
    <Box
      sx={{
        p: 0,
        width: '100%',
        ...(isFromRecruiter
          ? {
              flex: 1,
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              px: { xs: 2, md: 3 },
              pt: 2,
            }
          : {
              // User view: 32px padding on left, right, and bottom for better spacing
              px: 4,
              pt: 3,
              pb: 4,
            }),
      }}
    >
      {!isFromRecruiter && (
        <BreadcrumbNav
          items={[
            { label: 'Recruiter', href: '/recruiter' },
            { label: 'Jobs Board' },
          ]}
        />
      )}

      {/* Filters (search + favorites + new post are in header for Recruiter) */}
      <Paper
        elevation={0}
        sx={{
          mb: 2,
          p: 1.5,
          backgroundColor: '#F9FAFB',
          borderRadius: '8px',
          border: '1px solid #E5E7EB',
          borderBottom: '1px solid #D1D5DB',
        }}
      >
        <Grid container spacing={2} alignItems="center">
          {!isFromRecruiter && (
            <Grid item xs={12} md={3}>
              <TextField
                fullWidth
                placeholder="Search jobs..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <Search />
                    </InputAdornment>
                  ),
                  endAdornment: (
                    <InputAdornment position="end">
                      <FavoritesFilter
                        favoriteType="jobPosts"
                        showFavoritesOnly={showFavoritesOnly}
                        onToggle={setShowFavoritesOnly}
                        showText={false}
                        size="small"
                        sx={{
                          minWidth: '32px',
                          width: '32px',
                          height: '32px',
                          borderRadius: '50%',
                          '&:hover': {
                            backgroundColor: showFavoritesOnly ? 'primary.dark' : 'action.hover',
                          },
                        }}
                      />
                    </InputAdornment>
                  ),
                }}
              />
            </Grid>
          )}
          <Grid item xs={12} md={3}>
            <FormControl fullWidth>
              <InputLabel>Location</InputLabel>
              <Select
                value={locationFilter}
                label="Location"
                onChange={(e) => setLocationFilter(e.target.value)}
              >
                <MenuItem key="filter-location-all" value="all">
                  All Locations
                </MenuItem>
                {getUniqueLocations().map((location, idx) => (
                  <MenuItem key={`filter-location-${location || 'empty'}-${idx}`} value={location}>
                    {location}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={3}>
            <FormControl fullWidth>
              <InputLabel>Company</InputLabel>
              <Select
                value={companyFilter}
                label="Company"
                onChange={(e) => setCompanyFilter(e.target.value)}
              >
                <MenuItem key="filter-company-all" value="all">
                  All Companies
                </MenuItem>
                {getUniqueCompanies().map((company, idx) => (
                  <MenuItem key={`filter-company-${company || 'empty'}-${idx}`} value={company}>
                    {company}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          {!isFromRecruiter && (
            <Grid item xs={12} md={3}>
              <Button
                variant="contained"
                startIcon={<Add />}
                onClick={handleOpenNewPostModal}
                fullWidth
              >
                New Post
              </Button>
            </Grid>
          )}
        </Grid>
      </Paper>

      {/* Jobs Table */}
      {filteredJobs.length === 0 ? (
        <Alert severity="info">
          No jobs found matching your criteria. Try adjusting your filters or search terms.
        </Alert>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: isFromRecruiter ? 1 : undefined }}>
          <TableContainer
            component={Paper}
            elevation={0}
            sx={{
              borderRadius: 2,
              border: '1px solid #EAEEF4',
              position: 'relative',
              flex: isFromRecruiter ? 1 : undefined,
              display: isFromRecruiter ? 'flex' : undefined,
              flexDirection: isFromRecruiter ? 'column' : undefined,
              minHeight: isFromRecruiter ? 0 : undefined,
              overflowY: 'auto',
              overflowX: 'auto',
              width: '100%',
              '&::-webkit-scrollbar': { width: '8px', height: '8px' },
              '&::-webkit-scrollbar-track': {
                background: 'rgba(0, 0, 0, 0.02)',
                borderRadius: '4px',
              },
              '&::-webkit-scrollbar-thumb': {
                background: 'rgba(0, 0, 0, 0.15)',
                borderRadius: '4px',
                '&:hover': { background: 'rgba(0, 0, 0, 0.25)' },
              },
              scrollbarWidth: 'thin',
              scrollbarColor: 'rgba(0, 0, 0, 0.15) rgba(0, 0, 0, 0.02)',
            }}
          >
            <Table stickyHeader size="small" sx={{ width: '100%' }}>
              <TableHead sx={{ position: 'sticky', top: 0, zIndex: 10, backgroundColor: '#FFFFFF' }}>
                <TableRow sx={{ backgroundColor: '#FFFFFF' }}>
                  <TableCell sx={{ width: 60, bgcolor: '#FFFFFF', textAlign: 'center' }} />
                <TableCell sx={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '0.75rem' }}>
                  <TableSortLabel
                    active={sortField === 'postTitle'}
                    direction={sortField === 'postTitle' ? sortDirection : 'asc'}
                    onClick={() => handleSort('postTitle')}
                  >
                    Post Title
                  </TableSortLabel>
                </TableCell>
                <TableCell sx={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '0.75rem' }}>
                  <TableSortLabel
                    active={sortField === 'jobType'}
                    direction={sortField === 'jobType' ? sortDirection : 'asc'}
                    onClick={() => handleSort('jobType')}
                  >
                    Type
                  </TableSortLabel>
                </TableCell>
                <TableCell sx={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '0.75rem' }}>
                  <TableSortLabel
                    active={sortField === 'companyName'}
                    direction={sortField === 'companyName' ? sortDirection : 'asc'}
                    onClick={() => handleSort('companyName')}
                  >
                    Company
                  </TableSortLabel>
                </TableCell>
                <TableCell sx={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '0.75rem' }}>
                  <TableSortLabel
                    active={sortField === 'worksiteName'}
                    direction={sortField === 'worksiteName' ? sortDirection : 'asc'}
                    onClick={() => handleSort('worksiteName')}
                  >
                    Location
                  </TableSortLabel>
                </TableCell>
                <TableCell sx={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '0.75rem' }}>
                  <TableSortLabel
                    active={sortField === 'startDate'}
                    direction={sortField === 'startDate' ? sortDirection : 'asc'}
                    onClick={() => handleSort('startDate')}
                  >
                    Start Date
                  </TableSortLabel>
                </TableCell>
                <TableCell sx={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '0.75rem' }}>
                  <TableSortLabel
                    active={sortField === 'payRate'}
                    direction={sortField === 'payRate' ? sortDirection : 'asc'}
                    onClick={() => handleSort('payRate')}
                  >
                    Pay Rate
                  </TableSortLabel>
                </TableCell>
                <TableCell sx={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '0.75rem' }}>
                  <TableSortLabel
                    active={sortField === 'status'}
                    direction={sortField === 'status' ? sortDirection : 'asc'}
                    onClick={() => handleSort('status')}
                  >
                    Status
                  </TableSortLabel>
                </TableCell>
                <TableCell sx={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '0.75rem' }}>
                  <TableSortLabel
                    active={sortField === 'createdAt'}
                    direction={sortField === 'createdAt' ? sortDirection : 'asc'}
                    onClick={() => handleSort('createdAt')}
                  >
                    Created
                  </TableSortLabel>
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {paginatedJobs.map((post) => {
                const worksiteLocationLine = formatWorksiteCityStateZip(post.worksiteAddress);
                const payDisplay = formatHourlyPayRateForDisplay(post.payRate);
                return (
                <TableRow 
                  key={post.id}
                  hover
                  onClick={() => handleRowClick(post)}
                  sx={{ 
                    cursor: 'pointer',
                    '&:hover': {
                      backgroundColor: 'action.hover'
                    }
                  }}
                >
                  <TableCell sx={{ textAlign: 'center' }}>
                    <FavoriteButton
                      itemId={post.id}
                      favoriteType="jobPosts"
                      isFavorite={isFavorite}
                      toggleFavorite={toggleFavorite}
                      size="small"
                      tooltipText={{
                        favorited: 'Remove from favorites',
                        notFavorited: 'Add to favorites'
                      }}
                    />
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.primary' }}>
                      {post.postTitle}
                    </Typography>
                    {(post.jobTitle ||
                      hasJobBoardSyndicationUrl(post.indeedUrl, post.craigslistUrl)) && (
                      <Box
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          flexWrap: 'wrap',
                          gap: 0.75,
                          mt: 0.25,
                        }}
                      >
                        {post.jobTitle ? (
                          <Typography variant="caption" color="text.secondary" component="span">
                            {post.jobTitle}
                          </Typography>
                        ) : null}
                        {hasJobBoardSyndicationUrl(post.indeedUrl, post.craigslistUrl) ? (
                          <JobBoardSyndicationIconRow
                            indeedUrl={post.indeedUrl}
                            craigslistUrl={post.craigslistUrl}
                            inline
                            sx={{ mt: 0 }}
                          />
                        ) : null}
                      </Box>
                    )}
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={post.jobType === 'career' ? 'Career' : 'Gig'}
                      size="small"
                      color={post.jobType === 'career' ? 'primary' : 'secondary'}
                      variant="outlined"
                    />
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.primary">
                      {getDisplayCompanyName(post)}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.primary">
                      {post.worksiteName}
                    </Typography>
                    {worksiteLocationLine ? (
                      <Typography variant="caption" color="text.secondary" display="block">
                        {worksiteLocationLine}
                      </Typography>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    {post.startDate ? (
                      <Typography variant="body2" color="text.primary">
                        {formatDateForDisplay(post.startDate)}
                      </Typography>
                    ) : (
                      <Typography variant="body2" color="text.secondary">
                        -
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    {post.showPayRate && payDisplay ? (
                      <Typography variant="body2" color="text.primary" sx={{ fontWeight: 500 }}>
                        {payDisplay}
                      </Typography>
                    ) : (
                      <Typography variant="body2" color="text.secondary">
                        -
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    {editingStatus === post.id ? (
                      <FormControl 
                        size="small" 
                        sx={{ minWidth: 120 }}
                        onClick={(e) => e.stopPropagation()} // Prevent row click
                      >
                        <Select
                          value={post.status || 'draft'}
                          onChange={(e) => {
                            e.stopPropagation(); // Prevent row click
                            handleStatusUpdate(post.id, e.target.value as 'draft' | 'active' | 'paused' | 'cancelled' | 'expired');
                          }}
                          onBlur={() => setEditingStatus(null)}
                          autoFocus
                          size="small"
                          MenuProps={{
                            sx: { zIndex: 9999 } // Ensure dropdown appears above other elements
                          }}
                        >
                          <MenuItem key={`${post.id}-status-draft`} value="draft">
                            Draft
                          </MenuItem>
                          <MenuItem key={`${post.id}-status-active`} value="active">
                            Active
                          </MenuItem>
                          <MenuItem key={`${post.id}-status-paused`} value="paused">
                            Paused
                          </MenuItem>
                          <MenuItem key={`${post.id}-status-cancelled`} value="cancelled">
                            Cancelled
                          </MenuItem>
                          <MenuItem key={`${post.id}-status-expired`} value="expired">
                            Expired
                          </MenuItem>
                        </Select>
                      </FormControl>
                    ) : (
                      <Chip
                        label={updatingStatus === post.id ? 'Updating...' : (post.status?.toUpperCase() || 'DRAFT')}
                        size="small"
                        color={
                          post.status === 'active' ? 'success' :
                          post.status === 'draft' ? 'default' :
                          post.status === 'paused' ? 'warning' :
                          post.status === 'cancelled' ? 'error' :
                          'secondary'
                        }
                        variant="filled"
                        onClick={(e) => {
                          e.stopPropagation(); // Prevent row click
                          setEditingStatus(post.id);
                        }}
                        sx={{ 
                          cursor: 'pointer',
                          '&:hover': {
                            opacity: 0.8
                          }
                        }}
                        disabled={updatingStatus === post.id}
                      />
                    )}
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {formatCreatedAtCell(post.createdAt, post.postedAt, post.updatedAt)}
                    </Typography>
                  </TableCell>
                </TableRow>
              );
              })}
            </TableBody>
          </Table>
        </TableContainer>
          <StandardTablePagination
            count={sortedJobs.length}
            page={page}
            onPageChange={(_e, newPage) => setPage(newPage)}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={(e) => {
              setRowsPerPage(parseInt(e.target.value, 10));
              setPage(0);
            }}
          />
        </Box>
      )}

      {/* New Post Modal */}
      <Dialog 
        open={openNewPostModal} 
        onClose={handleCloseNewPostModal}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>Create New Job Post</DialogTitle>
        <DialogContent>
          {submitError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {submitError}
            </Alert>
          )}
          
          <Box sx={{ mt: 2 }}>
            <Grid container spacing={2}>
              <Grid item xs={12} sm={6}>
                <TextField
                  label="Post Title"
                  value={newPost.postTitle}
                  onChange={(e) => setNewPost({ ...newPost, postTitle: e.target.value })}
                  fullWidth
                  required
                  helperText="Title for the job posting (may differ from actual job title)"
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <FormControl fullWidth required>
                  <InputLabel>Job Type</InputLabel>
                  <Select
                    value={newPost.jobType}
                    label="Job Type"
                    onChange={(e) => setNewPost({ ...newPost, jobType: e.target.value as 'gig' | 'career' })}
                  >
                    <MenuItem key="newpost-jobtype-gig" value="gig">
                      Gig
                    </MenuItem>
                    <MenuItem key="newpost-jobtype-career" value="career">
                      Career
                    </MenuItem>
                  </Select>
                </FormControl>
              </Grid>
            </Grid>
          </Box>

          <Stack spacing={3} sx={{ mt: 3 }}>

            <Box sx={{ mt: 2 }}>
              <Grid container spacing={2}>
                <Grid item xs={12} sm={6}>
                  <Autocomplete
                    fullWidth
                    freeSolo
                    options={jobTitlesList}
                    value={newPost.jobTitle}
                    onChange={(event, newValue) => {
                      setNewPost({ ...newPost, jobTitle: newValue || '' });
                    }}
                    onInputChange={(event, newInputValue) => {
                      setNewPost({ ...newPost, jobTitle: newInputValue });
                    }}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label="Job Title (Optional)"
                        helperText="Search or enter a job title - leave blank for generic multi-role postings"
                      />
                    )}
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <FormControl fullWidth>
                    <InputLabel>Status</InputLabel>
                    <Select
                      value={newPost.status}
                      label="Status"
                      onChange={(e) => setNewPost({ ...newPost, status: e.target.value as any })}
                    >
                      <MenuItem key="newpost-status-draft" value="draft">
                        Draft
                      </MenuItem>
                      <MenuItem key="newpost-status-active" value="active">
                        Active
                      </MenuItem>
                      <MenuItem key="newpost-status-paused" value="paused">
                        Paused
                      </MenuItem>
                      <MenuItem key="newpost-status-cancelled" value="cancelled">
                        Cancelled
                      </MenuItem>
                      <MenuItem key="newpost-status-expired" value="expired">
                        Expired
                      </MenuItem>
                      <MenuItem key="newpost-status-complete" value="complete">
                        Complete
                      </MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
              </Grid>
            </Box>

            <Box sx={{ mt: 2 }}>
              <Grid container spacing={2}>
                <Grid item xs={12} sm={6}>
                  <TextField
                    label="Expiration Date"
                    type="date"
                    value={newPost.expDate || ''}
                    onChange={(e) => setNewPost({ ...newPost, expDate: e.target.value })}
                    fullWidth
                    InputLabelProps={{ shrink: true }}
                    helperText="When this posting will automatically expire"
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField
                    label="Workers Needed"
                    type="number"
                    value={newPost.workersNeeded}
                    onChange={(e) => setNewPost({ ...newPost, workersNeeded: parseInt(e.target.value) || 1 })}
                    fullWidth
                    inputProps={{ min: 1 }}
                    helperText="Number of workers needed"
                  />
                </Grid>
              </Grid>
            </Box>

            <Box sx={{ mt: 2 }}>
              <Grid container spacing={2} alignItems="center">
                <Grid item xs={12} sm={8}>
                  <FormControl fullWidth>
                    <InputLabel>Connect with Job Order</InputLabel>
                    <Select
                      value={newPost.jobOrderId}
                      label="Connect with Job Order"
                      onChange={(e) => handleJobOrderChange(e.target.value)}
                      disabled={loadingJobOrders}
                    >
                      <MenuItem key="newpost-joborder-none" value="">
                        <em>No Job Order Connection</em>
                      </MenuItem>
                      {loadingJobOrders ? (
                        <MenuItem key="newpost-joborder-loading" value="" disabled>
                          Loading job orders...
                        </MenuItem>
                      ) : jobOrders.length === 0 ? (
                        <MenuItem key="newpost-joborder-empty" value="" disabled>
                          No available job orders to connect
                        </MenuItem>
                      ) : (
                        jobOrders.map((jobOrder) => (
                          <MenuItem key={jobOrder.id} value={jobOrder.id}>
                            {jobOrder.jobOrderName}
                          </MenuItem>
                        ))
                      )}
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12} sm={4}>
                  <Button
                    variant="outlined"
                    color="error"
                    size="small"
                    onClick={() => {
                      // Clear job order connection and restore original form values
                      if (originalFormValues) {
                        setNewPost(prev => ({
                          ...prev,
                          jobOrderId: '',
                          // Restore original values
                          postTitle: originalFormValues.postTitle,
                          jobType: originalFormValues.jobType,
                          jobTitle: originalFormValues.jobTitle,
                          jobDescription: originalFormValues.jobDescription,
                          jobDescriptionPrompt: originalFormValues.jobDescriptionPrompt,
                          craigslistUrl: originalFormValues.craigslistUrl,
                          indeedUrl: originalFormValues.indeedUrl,
                          companyId: originalFormValues.companyId,
                          companyName: originalFormValues.companyName,
                          worksiteId: originalFormValues.worksiteId,
                          worksiteName: originalFormValues.worksiteName,
                          street: originalFormValues.street,
                          city: originalFormValues.city,
                          state: originalFormValues.state,
                          zipCode: originalFormValues.zipCode,
                          startDate: originalFormValues.startDate,
                          endDate: originalFormValues.endDate,
                          showStart: originalFormValues.showStart,
                          showEnd: originalFormValues.showEnd,
                          payRate: originalFormValues.payRate,
                          workersNeeded: originalFormValues.workersNeeded,
                          eVerifyRequired: originalFormValues.eVerifyRequired,
                          backgroundCheckPackages: originalFormValues.backgroundCheckPackages,
                          showBackgroundChecks: originalFormValues.showBackgroundChecks,
                          drugScreeningPanels: originalFormValues.drugScreeningPanels,
                          showDrugScreening: originalFormValues.showDrugScreening,
                          additionalScreenings: originalFormValues.additionalScreenings,
                          showAdditionalScreenings: originalFormValues.showAdditionalScreenings,
                          skills: originalFormValues.skills,
                          showSkills: originalFormValues.showSkills,
                          licensesCerts: originalFormValues.licensesCerts,
                          showLicensesCerts: originalFormValues.showLicensesCerts,
                          experienceLevels: originalFormValues.experienceLevels,
                          showExperience: originalFormValues.showExperience,
                          educationLevels: originalFormValues.educationLevels,
                          showEducation: originalFormValues.showEducation,
                          languages: originalFormValues.languages,
                          showLanguages: originalFormValues.showLanguages,
                          physicalRequirements: originalFormValues.physicalRequirements,
                          showPhysicalRequirements: originalFormValues.showPhysicalRequirements,
                          uniformRequirements: originalFormValues.uniformRequirements,
                          showUniformRequirements: originalFormValues.showUniformRequirements,
                          customUniformRequirements: originalFormValues.customUniformRequirements,
                          showCustomUniformRequirements: originalFormValues.showCustomUniformRequirements,
                          requiredPpe: originalFormValues.requiredPpe,
                          showRequiredPpe: originalFormValues.showRequiredPpe,
                          shift: originalFormValues.shift,
                          showShift: originalFormValues.showShift,
                          startTime: originalFormValues.startTime,
                          endTime: originalFormValues.endTime,
                          showStartTime: originalFormValues.showStartTime,
                          showEndTime: originalFormValues.showEndTime,
                          restrictedGroups: originalFormValues.restrictedGroups
                        }));
                      } else {
                        // Fallback: clear job order connection only
                        setNewPost(prev => ({ ...prev, jobOrderId: '' }));
                      }
                      
                      // Clear company and location selections
                      setSelectedCompanyId('');
                      setSelectedLocationId('');
                      setLocations([]);
                      setOriginalFormValues(null);
                    }}
                    disabled={!newPost.jobOrderId}
                    startIcon={<CloseIcon />}
                    fullWidth
                  >
                    Clear Connection
                  </Button>
                </Grid>
              </Grid>
            </Box>

            <TextField
              label="Job Description Prompt"
              value={newPost.jobDescriptionPrompt}
              onChange={(e) => setNewPost({ ...newPost, jobDescriptionPrompt: e.target.value })}
              fullWidth
              multiline
              minRows={3}
              helperText="Extra instructions for AI: used when there is no job order, or combined with the job order description when one is connected."
            />

            <Box sx={{ mt: 2 }}>
              <Grid container spacing={2}>
                <Grid item xs={12} sm={6}>
                  <TextField
                    label="Pay Rate ($/hr)"
                    type="number"
                    value={newPost.payRate}
                    onChange={(e) => setNewPost({ ...newPost, payRate: e.target.value })}
                    fullWidth
                    inputProps={{ min: 0, step: 0.01 }}
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '100%' }}>
                    <Typography variant="body1">Show Pay Rate</Typography>
                    <Switch
                      checked={newPost.showPayRate}
                      onChange={(e) => setNewPost({ ...newPost, showPayRate: e.target.checked })}
                    />
                  </Box>
                </Grid>
              </Grid>
            </Box>

            <Box sx={{ mt: 2 }}>
              <Grid container spacing={2}>
                <Grid item xs={12} sm={4}>
                  <TextField
                    label="Start Date"
                    type="date"
                    value={newPost.startDate}
                    onChange={(e) => setNewPost({ ...newPost, startDate: e.target.value })}
                    fullWidth
                    InputLabelProps={{ shrink: true }}
                  />
                </Grid>
                <Grid item xs={12} sm={2}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '100%' }}>
                    <Typography variant="body1">Show Start</Typography>
                    <Switch
                      checked={newPost.showStart || false}
                      onChange={(e) => setNewPost({ ...newPost, showStart: e.target.checked })}
                    />
                  </Box>
                </Grid>
                <Grid item xs={12} sm={4}>
                  <TextField
                    label="End Date"
                    type="date"
                    value={newPost.endDate}
                    onChange={(e) => setNewPost({ ...newPost, endDate: e.target.value })}
                    fullWidth
                    InputLabelProps={{ shrink: true }}
                  />
                </Grid>
                <Grid item xs={12} sm={2}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '100%' }}>
                    <Typography variant="body1">Show End</Typography>
                    <Switch
                      checked={newPost.showEnd || false}
                      onChange={(e) => setNewPost({ ...newPost, showEnd: e.target.checked })}
                    />
                  </Box>
                </Grid>
              </Grid>
            </Box>

            {/* Shift Section - Only show for Career job type */}
            {newPost.jobType === 'career' && (
              <Box sx={{ mt: 2 }}>
                <Grid container spacing={2} alignItems="center">
                  <Grid item xs={12} sm={6}>
                    <Autocomplete
                      multiple
                      fullWidth
                      options={shiftOptions}
                      value={newPost.shift}
                      onChange={(event, newValue) => {
                        setNewPost({ ...newPost, shift: newValue });
                      }}
                      renderInput={(params) => (
                        <TextField
                          {...params}
                          label="Shift Details"
                          helperText="Select shift requirements for this position"
                        />
                      )}
                      renderTags={(value, getTagProps) =>
                        value.map((option, index) => (
                          <Chip
                            variant="outlined"
                            label={option}
                            {...getTagProps({ index })}
                            key={option}
                          />
                        ))
                      }
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '100%' }}>
                      <Typography variant="body1">Show Shift Details on Post</Typography>
                      <Switch
                        checked={newPost.showShift}
                        onChange={(e) => setNewPost({ ...newPost, showShift: e.target.checked })}
                      />
                    </Box>
                  </Grid>
                </Grid>
              </Box>
            )}

            {/* Time Section - Only show for Career job type; GIG uses per-shift times */}
            {newPost.jobType === 'career' && (
              <Box sx={{ mt: 2 }}>
                <Grid container spacing={2} alignItems="center">
                  <Grid item xs={12} sm={3}>
                    <TextField
                      label="Start Time"
                      type="time"
                      value={newPost.startTime}
                      onChange={(e) => setNewPost({ ...newPost, startTime: e.target.value })}
                      fullWidth
                      InputLabelProps={{ shrink: true }}
                      helperText="Job start time"
                    />
                  </Grid>
                  <Grid item xs={12} sm={3}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '100%' }}>
                      <Typography variant="body1">Show Start Time</Typography>
                      <Switch
                        checked={newPost.showStartTime}
                        onChange={(e) => setNewPost({ ...newPost, showStartTime: e.target.checked })}
                      />
                    </Box>
                  </Grid>
                  <Grid item xs={12} sm={3}>
                    <TextField
                      label="End Time"
                      type="time"
                      value={newPost.endTime}
                      onChange={(e) => setNewPost({ ...newPost, endTime: e.target.value })}
                      fullWidth
                      InputLabelProps={{ shrink: true }}
                      helperText="Job end time"
                    />
                  </Grid>
                  <Grid item xs={12} sm={3}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '100%' }}>
                      <Typography variant="body1">Show End Time</Typography>
                      <Switch
                        checked={newPost.showEndTime}
                        onChange={(e) => setNewPost({ ...newPost, showEndTime: e.target.checked })}
                      />
                    </Box>
                  </Grid>
                </Grid>
              </Box>
            )}

            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography variant="body1">Use Company Location</Typography>
              <Switch
                checked={useCompanyLocation}
                onChange={(e) => {
                  setUseCompanyLocation(e.target.checked);
                  if (!e.target.checked) {
                    // Clear company/location when switching to generic location
                    setSelectedCompanyId('');
                    setSelectedLocationId('');
                    setLocations([]);
                    setNewPost({
                      ...newPost,
                      companyId: '',
                      companyName: '',
                      worksiteId: '',
                      worksiteName: '',
                      street: '',
                      city: '',
                      state: '',
                      zipCode: ''
                    });
                  }
                }}
              />
            </Box>

            {useCompanyLocation ? (
              <>
                <Box sx={{ mt: 2 }}>
                  <Grid container spacing={2}>
                  <Grid item xs={12} sm={6}>
                    <Autocomplete
                      fullWidth
                      options={companies}
                      getOptionLabel={(option) => option.name}
                      value={companies.find(c => c.id === selectedCompanyId) || null}
                      onChange={(event, newValue) => {
                        if (newValue) {
                          handleCompanyChange(newValue.id);
                        } else {
                          setSelectedCompanyId('');
                          setSelectedLocationId('');
                          setLocations([]);
                          setNewPost({
                            ...newPost,
                            companyId: '',
                            companyName: '',
                            worksiteId: '',
                            worksiteName: '',
                            street: '',
                            city: '',
                            state: '',
                            zipCode: ''
                          });
                        }
                      }}
                      loading={loadingCompanies}
                      disabled={loadingCompanies}
                      renderInput={(params) => (
                        <TextField
                          {...params}
                          label="Company"
                          required
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
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <FormControl fullWidth required disabled={!selectedCompanyId}>
                      <InputLabel>Worksite</InputLabel>
                      <Select
                        value={selectedLocationId}
                        label="Worksite"
                        onChange={(e) => handleLocationChange(e.target.value)}
                        disabled={loadingLocations || !selectedCompanyId}
                      >
                        {loadingLocations ? (
                          <MenuItem key="newpost-worksite-loading" value="">
                            Loading locations...
                          </MenuItem>
                        ) : locations.length === 0 ? (
                          <MenuItem key="newpost-worksite-empty" value="">
                            No locations available
                          </MenuItem>
                        ) : (
                          locations.map((location) => (
                            <MenuItem key={location.id} value={location.id}>
                              {location.nickname || location.name}
                            </MenuItem>
                          ))
                        )}
                      </Select>
                    </FormControl>
                  </Grid>
                </Grid>
                </Box>

                {selectedLocationId && (
                  <Box sx={{ p: 2, bgcolor: 'grey.50', borderRadius: 1 }}>
                    <Typography variant="caption" color="text.secondary" display="block" gutterBottom>
                      Selected Location Details:
                    </Typography>
                    <Typography variant="body2">
                      {newPost.street && `${newPost.street}, `}
                      {newPost.city}, {newPost.state} {newPost.zipCode}
                    </Typography>
                  </Box>
                )}
              </>
            ) : (
              <GoogleAutocomplete
                onLoad={onCityAutocompleteLoad}
                onPlaceChanged={onCityPlaceChanged}
                options={{
                  types: ['(cities)'],
                  componentRestrictions: { country: 'us' }
                }}
              >
                <TextField
                  fullWidth
                  label="City, State"
                  placeholder="Search for a city..."
                  required
                  helperText="Pick a suggestion for best results, or type e.g. Orlando, FL and tab out — we geocode on blur."
                  inputRef={cityInputRef}
                  onBlur={onNewPostCityBlur}
                />
              </GoogleAutocomplete>
            )}

            <Box sx={{ mt: 2 }}>
              <Grid container spacing={2}>
                <Grid item xs={12} sm={6}>
                  <FormControl fullWidth>
                    <InputLabel>Visibility</InputLabel>
                    <Select
                      value={newPost.visibility}
                      label="Visibility"
                      onChange={(e) => {
                        const visibility = e.target.value as any;
                        setNewPost({
                          ...newPost,
                          visibility,
                          // Clear restricted groups if not restricted
                          restrictedGroups: visibility === 'restricted' ? newPost.restrictedGroups : [],
                          // Clear auto-add groups if restricted
                          autoAddToUserGroups: visibility === 'restricted' ? [] : newPost.autoAddToUserGroups,
                        });
                      }}
                    >
                      <MenuItem key="newpost-vis-public" value="public">
                        Public - Visible to everyone
                      </MenuItem>
                      <MenuItem key="newpost-vis-restricted" value="restricted">
                        Restricted - Visible to specific user groups
                      </MenuItem>
                      <MenuItem key="newpost-vis-private" value="private">
                        Private - Internal only
                      </MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <FormControl fullWidth>
                    <InputLabel>User Groups</InputLabel>
                    <Select
                      value={newPost.restrictedGroups}
                      label="User Groups"
                      onChange={(e) => setNewPost({ ...newPost, restrictedGroups: e.target.value as string[] })}
                      disabled={newPost.visibility !== 'restricted' || loadingUserGroups}
                      multiple
                    >
                      {loadingUserGroups ? (
                        <MenuItem key="newpost-groups-loading" value="" disabled>
                          Loading user groups...
                        </MenuItem>
                      ) : userGroupsForUi.length === 0 ? (
                        <MenuItem key="newpost-groups-empty" value="" disabled>
                          No user groups available
                        </MenuItem>
                      ) : (
                        userGroupsForUi.map((group) => (
                          <MenuItem key={group.id} value={group.id}>
                            {group.name}
                          </MenuItem>
                        ))
                      )}
                    </Select>
                  </FormControl>
                </Grid>
              </Grid>
            </Box>

            {/* E-Verify Required Section */}
            <Box sx={{ mt: 2 }}>
              <Grid container spacing={2} alignItems="center">
                <Grid item xs={12} sm={6}>
                  {/* Empty left column for spacing */}
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '100%' }}>
                    <Typography variant="body1">E-Verify Required</Typography>
                    <Switch
                      checked={newPost.eVerifyRequired}
                      onChange={(e) => setNewPost({ ...newPost, eVerifyRequired: e.target.checked })}
                    />
                  </Box>
                </Grid>
              </Grid>
            </Box>

            {/* Background Checks Section */}
            <Box sx={{ mt: 2 }}>
              <Grid container spacing={2} alignItems="center">
                <Grid item xs={12} sm={6}>
                  <Autocomplete
                    multiple
                    fullWidth
                    options={backgroundCheckOptions.map(option => option.label)}
                    value={newPost.backgroundCheckPackages}
                    onChange={(event, newValue) => {
                      setNewPost({ ...newPost, backgroundCheckPackages: newValue });
                    }}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label="Background Check Packages"
                        helperText="Select required background check packages"
                      />
                    )}
                    renderTags={(value, getTagProps) =>
                      value.map((option, index) => (
                        <Chip
                          variant="outlined"
                          label={option}
                          {...getTagProps({ index })}
                          key={option}
                        />
                      ))
                    }
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '100%' }}>
                    <Typography variant="body1">Show Background Requirements</Typography>
                    <Switch
                      checked={newPost.showBackgroundChecks}
                      onChange={(e) => setNewPost({ ...newPost, showBackgroundChecks: e.target.checked })}
                    />
                  </Box>
                </Grid>
              </Grid>
            </Box>

            {/* Drug Screening Section */}
            <Box sx={{ mt: 2 }}>
              <Grid container spacing={2} alignItems="center">
                <Grid item xs={12} sm={6}>
                  <Autocomplete
                    multiple
                    fullWidth
                    options={drugScreeningOptions.map(option => option.label)}
                    value={newPost.drugScreeningPanels}
                    onChange={(event, newValue) => {
                      setNewPost({ ...newPost, drugScreeningPanels: newValue });
                    }}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label="Drug Screening Panels"
                        helperText="Select required drug screening panels"
                      />
                    )}
                    renderTags={(value, getTagProps) =>
                      value.map((option, index) => (
                        <Chip
                          variant="outlined"
                          label={option}
                          {...getTagProps({ index })}
                          key={option}
                        />
                      ))
                    }
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '100%' }}>
                    <Typography variant="body1">Show Drug Screening Requirements</Typography>
                    <Switch
                      checked={newPost.showDrugScreening}
                      onChange={(e) => setNewPost({ ...newPost, showDrugScreening: e.target.checked })}
                    />
                  </Box>
                </Grid>
              </Grid>
            </Box>

            {/* Additional Screenings Section */}
            <Box sx={{ mt: 2 }}>
              <Grid container spacing={2} alignItems="center">
                <Grid item xs={12} sm={6}>
                  <Autocomplete
                    multiple
                    fullWidth
                    options={additionalScreeningOptions.map(option => option.label)}
                    value={newPost.additionalScreenings}
                    onChange={(event, newValue) => {
                      setNewPost({ ...newPost, additionalScreenings: newValue });
                    }}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label="Additional Screenings"
                        helperText="Select required additional screening types"
                      />
                    )}
                    renderTags={(value, getTagProps) =>
                      value.map((option, index) => (
                        <Chip
                          variant="outlined"
                          label={option}
                          {...getTagProps({ index })}
                          key={option}
                        />
                      ))
                    }
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '100%' }}>
                    <Typography variant="body1">Show Additional Screenings on Post</Typography>
                    <Switch
                      checked={newPost.showAdditionalScreenings}
                      onChange={(e) => setNewPost({ ...newPost, showAdditionalScreenings: e.target.checked })}
                    />
                  </Box>
                </Grid>
              </Grid>
            </Box>

            {/* Skills Section */}
            <Box sx={{ mt: 2 }}>
              <Grid container spacing={2} alignItems="center">
                <Grid item xs={12} sm={6}>
                  <Autocomplete
                    multiple
                    fullWidth
                    options={onetSkills.map(skill => skill.name)}
                    value={newPost.skills}
                    onChange={(event, newValue) => {
                      setNewPost({ ...newPost, skills: newValue });
                    }}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label="Required Skills"
                        helperText="Select skills required for this position"
                      />
                    )}
                    renderTags={(value, getTagProps) =>
                      value.map((option, index) => (
                        <Chip
                          variant="outlined"
                          label={option}
                          {...getTagProps({ index })}
                          key={option}
                        />
                      ))
                    }
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '100%' }}>
                    <Typography variant="body1">Show Skills on Post</Typography>
                    <Switch
                      checked={newPost.showSkills}
                      onChange={(e) => setNewPost({ ...newPost, showSkills: e.target.checked })}
                    />
                  </Box>
                </Grid>
              </Grid>
            </Box>

            {/* Licenses & Certifications Section */}
            <Box sx={{ mt: 2 }}>
              <Grid container spacing={2} alignItems="center">
                <Grid item xs={12} sm={6}>
                  <Autocomplete
                    multiple
                    fullWidth
                    options={credentialsSeed
                      .filter(cred => cred.is_active)
                      .map(cred => `${cred.name} (${cred.type})`)
                    }
                    value={newPost.licensesCerts}
                    onChange={(event, newValue) => {
                      setNewPost({ ...newPost, licensesCerts: newValue });
                    }}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label="Licenses & Certifications"
                        helperText="Select required licenses and certifications"
                      />
                    )}
                    renderTags={(value, getTagProps) =>
                      value.map((option, index) => (
                        <Chip
                          variant="outlined"
                          label={option}
                          {...getTagProps({ index })}
                          key={option}
                        />
                      ))
                    }
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '100%' }}>
                    <Typography variant="body1">Show Licenses & Certifications on Post</Typography>
                    <Switch
                      checked={newPost.showLicensesCerts}
                      onChange={(e) => setNewPost({ ...newPost, showLicensesCerts: e.target.checked })}
                    />
                  </Box>
                </Grid>
              </Grid>
            </Box>

            {/* Experience Section */}
            <Box sx={{ mt: 2 }}>
              <Grid container spacing={2} alignItems="center">
                <Grid item xs={12} sm={6}>
                  <Autocomplete
                    multiple
                    fullWidth
                    options={experienceOptions.map(exp => exp.label)}
                    value={newPost.experienceLevels}
                    onChange={(event, newValue) => {
                      setNewPost({ ...newPost, experienceLevels: newValue });
                    }}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label="Experience Levels"
                        helperText="Select required experience levels"
                      />
                    )}
                    renderTags={(value, getTagProps) =>
                      value.map((option, index) => (
                        <Chip
                          variant="outlined"
                          label={option}
                          {...getTagProps({ index })}
                          key={option}
                        />
                      ))
                    }
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '100%' }}>
                    <Typography variant="body1">Show Experience on Post</Typography>
                    <Switch
                      checked={newPost.showExperience}
                      onChange={(e) => setNewPost({ ...newPost, showExperience: e.target.checked })}
                    />
                  </Box>
                </Grid>
              </Grid>
            </Box>

            {/* Education Section */}
            <Box sx={{ mt: 2 }}>
              <Grid container spacing={2} alignItems="center">
                <Grid item xs={12} sm={6}>
                  <Autocomplete
                    multiple
                    fullWidth
                    options={educationOptions.map(edu => edu.label)}
                    value={newPost.educationLevels}
                    onChange={(event, newValue) => {
                      setNewPost({ ...newPost, educationLevels: newValue });
                    }}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label="Education Levels"
                        helperText="Select required education levels"
                      />
                    )}
                    renderTags={(value, getTagProps) =>
                      value.map((option, index) => (
                        <Chip
                          variant="outlined"
                          label={option}
                          {...getTagProps({ index })}
                          key={option}
                        />
                      ))
                    }
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '100%' }}>
                    <Typography variant="body1">Show Education on Post</Typography>
                    <Switch
                      checked={newPost.showEducation}
                      onChange={(e) => setNewPost({ ...newPost, showEducation: e.target.checked })}
                    />
                  </Box>
                </Grid>
              </Grid>
            </Box>

            {/* Languages Section */}
            <Box sx={{ mt: 2 }}>
              <Grid container spacing={2} alignItems="center">
                <Grid item xs={12} sm={6}>
                  <Autocomplete
                    multiple
                    fullWidth
                    options={['English', 'Spanish', 'French', 'German', 'Italian', 'Portuguese', 'Chinese', 'Japanese', 'Korean', 'Arabic', 'Russian', 'Hindi', 'Dutch', 'Swedish', 'Norwegian', 'Danish', 'Finnish', 'Polish', 'Czech', 'Hungarian', 'Greek', 'Turkish', 'Hebrew', 'Thai', 'Vietnamese', 'Indonesian', 'Malay', 'Tagalog', 'Other']}
                    value={newPost.languages}
                    onChange={(event, newValue) => {
                      setNewPost({ ...newPost, languages: newValue });
                    }}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label="Language Requirements"
                        helperText="Select required languages for this position"
                      />
                    )}
                    renderTags={(value, getTagProps) =>
                      value.map((option, index) => (
                        <Chip
                          variant="outlined"
                          label={option}
                          {...getTagProps({ index })}
                          key={option}
                        />
                      ))
                    }
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '100%' }}>
                    <Typography variant="body1">Show Languages on Post</Typography>
                    <Switch
                      checked={newPost.showLanguages}
                      onChange={(e) => setNewPost({ ...newPost, showLanguages: e.target.checked })}
                    />
                  </Box>
                </Grid>
              </Grid>
            </Box>

            {/* Physical Requirements Section */}
            <Box sx={{ mt: 2 }}>
              <Grid container spacing={2} alignItems="center">
                <Grid item xs={12} sm={6}>
                  <Autocomplete
                    multiple
                    fullWidth
                    options={[
                      'Standing',
                      'Walking',
                      'Sitting',
                      'Lifting 25 lbs',
                      'Lifting 50 lbs',
                      'Lifting 75 lbs',
                      'Lifting 100+ lbs',
                      'Carrying 25 lbs',
                      'Carrying 50 lbs',
                      'Carrying 75 lbs',
                      'Carrying 100+ lbs',
                      'Pushing',
                      'Pulling',
                      'Climbing',
                      'Balancing',
                      'Stooping',
                      'Kneeling',
                      'Crouching',
                      'Crawling',
                      'Reaching',
                      'Handling',
                      'Fingering',
                      'Feeling',
                      'Talking',
                      'Hearing',
                      'Seeing',
                      'Color Vision',
                      'Depth Perception',
                      'Field of Vision',
                      'Driving',
                      'Operating Machinery',
                      'Working at Heights',
                      'Confined Spaces',
                      'Outdoor Work',
                      'Indoor Work',
                      'Temperature Extremes',
                      'Noise',
                      'Vibration',
                      'Fumes/Odors',
                      'Dust',
                      'Chemicals',
                      'Radiation',
                      'Other'
                    ]}
                    value={newPost.physicalRequirements}
                    onChange={(event, newValue) => {
                      setNewPost({ ...newPost, physicalRequirements: newValue });
                    }}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label="Physical Requirements"
                        helperText="Select physical requirements for this position"
                      />
                    )}
                    renderTags={(value, getTagProps) =>
                      value.map((option, index) => (
                        <Chip
                          variant="outlined"
                          label={option}
                          {...getTagProps({ index })}
                          key={option}
                        />
                      ))
                    }
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '100%' }}>
                    <Typography variant="body1">Show Physical Requirements on Post</Typography>
                    <Switch
                      checked={newPost.showPhysicalRequirements}
                      onChange={(e) => setNewPost({ ...newPost, showPhysicalRequirements: e.target.checked })}
                    />
                  </Box>
                </Grid>
              </Grid>
            </Box>

            {/* Uniform Requirements Section */}
            <Box sx={{ mt: 2 }}>
              <Grid container spacing={2} alignItems="center">
                <Grid item xs={12} sm={6}>
                  <Autocomplete
                    multiple
                    fullWidth
                    options={[
                      'Business Casual',
                      'Business Professional',
                      'Black Bistro',
                      'Casual',
                      'Scrubs',
                      'Uniform Provided',
                      'Black Pants',
                      'White Shirt',
                      'Polo Shirt',
                      'Button-Down Shirt',
                      'Black Button-Down Shirt',
                      'Dress Shirt',
                      'Khaki Pants',
                      'Dress Pants',
                      'Jeans (Dark)',
                      'Jeans (No Holes)',
                      'Slacks',
                      'Skirt/Dress',
                      'Blouse',
                      'Sweater',
                      'Cardigan',
                      'Blazer',
                      'Suit',
                      'Tie Required',
                      'No Tie',
                      'Closed-Toe Shoes',
                      'Steel-Toe Boots',
                      'Non-Slip Shoes',
                      'Dress Shoes',
                      'Sneakers',
                      'Boots',
                      'Sandals Allowed',
                      'No Sandals',
                      'No Flip-Flops',
                      'No Shorts',
                      'No Tank Tops',
                      'No Graphic Tees',
                      'No Hoodies',
                      'No Sweatpants',
                      'No Leggings',
                      'No Yoga Pants',
                      'No Athletic Wear',
                      'No Ripped Clothing',
                      'No Visible Tattoos',
                      'No Facial Piercings',
                      'Minimal Jewelry',
                      'No Jewelry',
                      'Hair Tied Back',
                      'Clean Shaven',
                      'Facial Hair Allowed',
                      'Hair Color Restrictions',
                      'No Hair Color Restrictions',
                      'Coveralls',
                      'Safety Vest',
                      'Hard Hat',
                      'Reflective Clothing',
                      'Weather-Appropriate',
                      'Seasonal Attire',
                      'Formal Occasions',
                      'Customer-Facing',
                      'Back Office',
                      'Laboratory',
                      'Kitchen',
                      'Warehouse',
                      'Construction',
                      'Healthcare',
                      'Food Service',
                      'Retail',
                      'Office',
                      'Other'
                    ]}
                    value={newPost.uniformRequirements}
                    onChange={(event, newValue) => {
                      setNewPost({ ...newPost, uniformRequirements: newValue });
                    }}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label="Uniform Requirements"
                        helperText="Select dress code and uniform requirements"
                      />
                    )}
                    renderTags={(value, getTagProps) =>
                      value.map((option, index) => (
                        <Chip
                          variant="outlined"
                          label={option}
                          {...getTagProps({ index })}
                          key={option}
                        />
                      ))
                    }
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '100%' }}>
                    <Typography variant="body1">Show Uniform Requirements on Post</Typography>
                    <Switch
                      checked={newPost.showUniformRequirements}
                      onChange={(e) => setNewPost({ ...newPost, showUniformRequirements: e.target.checked })}
                    />
                  </Box>
                </Grid>
              </Grid>
            </Box>

            {/* Custom Uniform Requirements Section */}
            <Box sx={{ mt: 2 }}>
              <Grid container spacing={2} alignItems="center">
                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    label="Custom Uniform Requirements"
                    multiline
                    rows={3}
                    value={newPost.customUniformRequirements}
                    onChange={(e) => setNewPost({ ...newPost, customUniformRequirements: e.target.value })}
                    placeholder="Enter custom uniform requirements text..."
                    helperText="Enter any additional or custom uniform requirements"
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '100%' }}>
                    <Typography variant="body1">Show Custom Uniform Requirements on Post</Typography>
                    <Switch
                      checked={newPost.showCustomUniformRequirements}
                      onChange={(e) => setNewPost({ ...newPost, showCustomUniformRequirements: e.target.checked })}
                    />
                  </Box>
                </Grid>
              </Grid>
            </Box>

            {/* Required PPE Section */}
            <Box sx={{ mt: 2 }}>
              <Grid container spacing={2} alignItems="center">
                <Grid item xs={12} sm={6}>
                  <Autocomplete
                    multiple
                    fullWidth
                    options={[
                      'Hard Hat',
                      'Safety Glasses',
                      'Safety Goggles',
                      'Face Shield',
                      'Respirator',
                      'Dust Mask',
                      'N95 Mask',
                      'Hearing Protection',
                      'Ear Plugs',
                      'Ear Muffs',
                      'High-Visibility Vest',
                      'Reflective Clothing',
                      'Safety Boots',
                      'Steel-Toe Boots',
                      'Non-Slip Shoes',
                      'Cut-Resistant Gloves',
                      'Chemical-Resistant Gloves',
                      'Heat-Resistant Gloves',
                      'Fall Protection Harness',
                      'Safety Lanyard',
                      'Lifeline',
                      'Confined Space Equipment',
                      'Gas Monitor',
                      'Air Purifying Respirator',
                      'Self-Contained Breathing Apparatus',
                      'First Aid Kit',
                      'Emergency Shower',
                      'Eye Wash Station',
                      'Fire Extinguisher',
                      'Safety Data Sheets',
                      'Lockout/Tagout Devices',
                      'Barricades',
                      'Warning Signs',
                      'Personal Alarm',
                      'Two-Way Radio',
                      'Flashlight',
                      'Headlamp',
                      'Protective Coveralls',
                      'Disposable Suits',
                      'Chemical Apron',
                      'Lab Coat',
                      'Hair Net',
                      'Beard Cover',
                      'Disposable Gloves',
                      'Nitrile Gloves',
                      'Latex Gloves',
                      'Vinyl Gloves',
                      'Insulated Gloves',
                      'Electrical Gloves',
                      'Welding Helmet',
                      'Welding Gloves',
                      'Welding Apron',
                      'Welding Boots',
                      'Welding Jacket',
                      'Chainsaw Chaps',
                      'Cutting Gloves',
                      'Abrasion-Resistant Clothing',
                      'Flame-Resistant Clothing',
                      'Arc Flash Protection',
                      'Voltage-Rated Gloves',
                      'Rubber Insulating Gloves',
                      'Leather Protectors',
                      'Insulating Blankets',
                      'Insulating Covers',
                      'Hot Sticks',
                      'Voltage Detectors',
                      'Ground Fault Circuit Interrupters',
                      'Other'
                    ]}
                    value={newPost.requiredPpe}
                    onChange={(event, newValue) => {
                      setNewPost({ ...newPost, requiredPpe: newValue });
                    }}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label="Required PPE"
                        helperText="Select required personal protective equipment"
                      />
                    )}
                    renderTags={(value, getTagProps) =>
                      value.map((option, index) => (
                        <Chip
                          variant="outlined"
                          label={option}
                          {...getTagProps({ index })}
                          key={option}
                        />
                      ))
                    }
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '100%' }}>
                    <Typography variant="body1">Show Required PPE on Post</Typography>
                    <Switch
                      checked={newPost.showRequiredPpe}
                      onChange={(e) => setNewPost({ ...newPost, showRequiredPpe: e.target.checked })}
                    />
                  </Box>
                </Grid>
              </Grid>
            </Box>

            <Autocomplete
              multiple
              options={userGroupsForUi}
              getOptionLabel={(option) => option.name || 'Unnamed Group'}
              isOptionEqualToValue={(opt, val) => opt.id === val.id}
              value={autoAddGroupsAutocompleteValue}
              onChange={(_, newValue) =>
                setNewPost({ ...newPost, autoAddToUserGroups: newValue.map((group) => group.id) })
              }
              disabled={newPost.visibility === 'restricted' || loadingUserGroups}
              renderTags={(value, getTagProps) =>
                value.map((option, index) => (
                  <Chip
                    {...getTagProps({ index })}
                    key={option.id}
                    label={option.name || 'Unnamed Group'}
                    size="small"
                  />
                ))
              }
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Auto-Add to User Groups"
                  placeholder="Search user groups..."
                  helperText={
                    newPost.visibility === 'restricted'
                      ? 'Auto-add to group is not available when visibility is restricted'
                      : 'Automatically add applicants to these user groups'
                  }
                />
              )}
              loading={loadingUserGroups}
              noOptionsText={loadingUserGroups ? 'Loading...' : 'No user groups available'}
            />

            {!(newPost.jobOrderId && String(newPost.jobOrderId).trim()) && (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <TextField
                  label="Craigslist URL"
                  value={newPost.craigslistUrl}
                  onChange={(e) => setNewPost({ ...newPost, craigslistUrl: e.target.value })}
                  fullWidth
                  placeholder="https://…"
                  helperText="Optional. Shown in headers when this post is not linked to a job order."
                />
                <TextField
                  label="Indeed URL"
                  value={newPost.indeedUrl}
                  onChange={(e) => setNewPost({ ...newPost, indeedUrl: e.target.value })}
                  fullWidth
                  placeholder="https://…"
                  helperText="Optional. Shown in headers when this post is not linked to a job order."
                />
              </Box>
            )}

            <Box sx={{ mb: 1, mt: 1, display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
              <Button
                variant="outlined"
                startIcon={generatingDescription ? <CircularProgress size={16} /> : <AutoAwesomeIcon />}
                onClick={handleGenerateJobDescription}
                disabled={generatingDescription || submitting}
                size="small"
              >
                {generatingDescription ? 'Generating...' : 'Generate Job Description'}
              </Button>
              <Button
                variant="outlined"
                startIcon={<ContentCopyIcon />}
                onClick={() => {
                  const text = newPost.jobDescription?.trim();
                  if (text) navigator.clipboard.writeText(text);
                }}
                disabled={!newPost.jobDescription?.trim()}
                size="small"
              >
                Copy to clipboard
              </Button>
            </Box>

            <TextField
              label="Job Description"
              value={newPost.jobDescription}
              onChange={(e) => setNewPost({ ...newPost, jobDescription: e.target.value })}
              fullWidth
              required
              multiline
              minRows={6}
              helperText="Public posting text. With a connected job order, client notes come from the order for AI; use Generate to draft."
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseNewPostModal} disabled={submitting}>
            Cancel
          </Button>
          <Button 
            onClick={handleSubmitNewPost} 
            variant="contained" 
            disabled={submitting || !isFormValid()}
          >
            {submitting 
              ? (newPost.status === 'draft' ? 'Saving...' : 'Creating...') 
              : (newPost.status === 'draft' ? 'Save Draft' : 'Create Post')
            }
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default JobsBoard; 