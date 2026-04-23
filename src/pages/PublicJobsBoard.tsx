import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Paper,
  Grid,
  Card,
  CardContent,
  Chip,
  Button,
  TextField,
  InputAdornment,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Autocomplete,
  Alert,
  CircularProgress,
  Container,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Stack,
  Divider,
  Tabs,
  Tab,
  IconButton,
  CardMedia,
  Drawer,
  useMediaQuery,
  useTheme,
  Menu,
  Tooltip,
} from '@mui/material';
import {
  Search,
  LocationOn,
  Business,
  Schedule,
  AttachMoney,
  Work,
  School,
  Person,
  People,
  Security,
  HealthAndSafety,
  Language,
  FitnessCenter,
  Checkroom,
  Build,
  Close,
  Event,
  Warning as WarningIcon,
  FilterList,
  ChevronRight,
} from '@mui/icons-material';
import { collection, query, where, getDocs, orderBy, doc, getDoc } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { useNavigate, useLocation } from 'react-router-dom';
import { JobsBoardService, JobsBoardPost } from '../services/recruiter/jobsBoardService';
import { useAuth } from '../contexts/AuthContext';
import { useGuestLanguage } from '../hooks/useGuestLanguage';
import { useFavorites, useFavoritesFilter } from '../hooks/useFavorites';
import { useT, setLanguage, useLanguage } from '../i18n';
import { getJobPostingDisplayText } from '../utils/jobPostingI18n';
import FavoriteButton from '../components/FavoriteButton';
import FavoritesFilter from '../components/FavoritesFilter';
import Layout from '../components/Layout';
import AuthDialog from '../components/AuthDialog';
import EligibilityModal from '../components/EligibilityModal';
import { checkMissingCertificationsWithEngine } from '../utils/checkMissingCertifications';
import { toChipLabel } from '../utils/chipLabel';
import { getLastShiftDateFromShifts } from '../utils/dateSchedule';
import { formatWorksiteCityStateZip } from '../utils/formatWorksiteAddress';
import { formatHourlyPayRateForDisplay } from '../utils/hourlyPayDisplay';
interface PublicJobPosting {
  id: string;
  tenantId: string;
  postTitle: string;
  jobTitle?: string;
  jobType: 'gig' | 'career';
  jobDescription: string;
  companyName: string;
  worksiteName: string;
  worksiteAddress?: {
    street?: string;
    city: string;
    state: string;
    zipCode?: string;
    coordinates?: {
      lat: number;
      lng: number;
    };
  };
  startDate?: Date;
  endDate?: Date;
  expDate?: Date;
  showStart?: boolean;
  showEnd?: boolean;
  payRate?: number;
  showPayRate: boolean;
  workersNeeded?: number;
  showWorkersNeeded?: boolean; // Whether to show workers needed on public posting
  eVerifyRequired?: boolean;
  screeningPackageName?: string;
  showScreeningPackageOnPost?: boolean;
  screeningPackageServiceNames?: string[];
  backgroundCheckPackages?: string[];
  showBackgroundChecks?: boolean;
  drugScreeningPanels?: string[];
  showDrugScreening?: boolean;
  additionalScreenings?: string[];
  showAdditionalScreenings?: boolean;
  skills?: string[];
  showSkills?: boolean;
  licensesCerts?: string[];
  showLicensesCerts?: boolean;
  experienceLevels?: string[];
  showExperience?: boolean;
  educationLevels?: string[];
  showEducation?: boolean;
  languages?: string[];
  showLanguages?: boolean;
  physicalRequirements?: string[];
  showPhysicalRequirements?: boolean;
  uniformRequirements?: string[];
  showUniformRequirements?: boolean;
  customUniformRequirements?: string;
  showCustomUniformRequirements?: boolean;
  requiredPpe?: string[];
  showRequiredPpe?: boolean;
  shift?: string[];
  showShift: boolean;
  startTime?: string;
  endTime?: string;
  showStartTime?: boolean;
  showEndTime?: boolean;
  status: string;
  visibility: string;
  restrictedGroups?: string[];
  createdAt: Date;
  benefits?: string;
  jobOrderId?: string; // For Gig jobs loaded directly from job_orders
  trustedClient?: boolean;
  popularShift?: boolean;
  highDemand?: boolean;
}

const PublicJobsBoard: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, securityLevel } = useAuth();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  const [jobs, setJobs] = useState<PublicJobPosting[]>([]);
  const [filteredJobs, setFilteredJobs] = useState<PublicJobPosting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [locationFilter, setLocationFilter] = useState('all');
  const [jobTypeFilter, setJobTypeFilter] = useState('all');
  const [selectedJob, setSelectedJob] = useState<PublicJobPosting | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [activeTab, setActiveTab] = useState(0);
  const [userLocation, setUserLocation] = useState<{lat: number, lng: number} | null>(null);
  const [sortBy, setSortBy] = useState('newest');
  const [locationPermission, setLocationPermission] = useState<'granted' | 'denied' | 'prompt'>('prompt');
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [authDialogOpen, setAuthDialogOpen] = useState(false);
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [eligibilityModalOpen, setEligibilityModalOpen] = useState({
    open: false,
    needDOB: false,
    needPhone: false,
    jobId: null as string | null
  });
  const [languageMenuAnchorEl, setLanguageMenuAnchorEl] = useState<null | HTMLElement>(null);
  const [guestLanguage, setGuestLanguage] = useGuestLanguage();
  const t = useT();
  const displayLanguage = useLanguage();

  // Only sync guest language → i18n when user is NOT logged in. Logged-in language is driven by C1WorkerLayout + WorkerAppBar; never overwrite with localStorage.
  useEffect(() => {
    if (!user) setLanguage(guestLanguage);
  }, [user, guestLanguage]);

  // Favorites system
  const { favorites, isFavorite, toggleFavorite } = useFavorites('jobPosts');
  
  // Track user's application IDs for showing "Application Submitted"
  const [userApplicationIds, setUserApplicationIds] = useState<string[]>([]);
  const [userApplicationStatuses, setUserApplicationStatuses] = useState<Record<string, string>>({}); // Map of applicationId -> status
  /** Map jobOrderId -> assignmentId for jobs where user has an assignment (proposed/confirmed/active) */
  const [userAssignmentIdByJobOrderId, setUserAssignmentIdByJobOrderId] = useState<Record<string, string>>({});
  const [userGroupIds, setUserGroupIds] = useState<string[]>([]);
  const [userCertifications, setUserCertifications] = useState<Array<{ name?: string }>>([]);
  /** Gap list for requirements tab — engine-backed when `REACT_APP_CERT_ENGINE_READINESS` is set. */
  const [profileMissingCertList, setProfileMissingCertList] = useState<string[]>([]);

  // Track shifts for selected job in dialog
  const [selectedJobShifts, setSelectedJobShifts] = useState<any[]>([]);
  const [loadingSelectedJobShifts, setLoadingSelectedJobShifts] = useState(false);

  // Check if we're on the C1 route and should use specific tenantId
  // Also treat /jobs-board (without /c1/) as C1 route for backwards compatibility
  const isC1Route = location.pathname.startsWith('/c1/') || location.pathname === '/jobs-board';
  const specificTenantId = isC1Route ? 'BCiP2bQ9CgVOCTfV6MhD' : null;

  useEffect(() => {
    loadPublicJobs();
    // Don't request location permission automatically - only on user gesture
  }, [specificTenantId]);
  
  // Load user's application IDs and group memberships when logged in
  useEffect(() => {
    const loadUserData = async () => {
      if (!user?.uid) {
        setUserApplicationIds([]);
        setUserApplicationStatuses({});
        setUserGroupIds([]);
        setUserCertifications([]);
        return;
      }
      try {
        const userRef = doc(db, 'users', user.uid);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
          const userData = userSnap.data();
          const applicationIds = Array.isArray(userData?.applicationIds) ? userData.applicationIds : [];
          setUserApplicationIds(applicationIds);
          setUserGroupIds(Array.isArray(userData?.userGroupIds) ? userData.userGroupIds : []);
          
          // Load user certifications
          const certs = Array.isArray(userData?.certifications) 
            ? userData.certifications.filter((c: any) => c && (typeof c === 'object' ? c.name || c.fileUrl : typeof c === 'string'))
            : [];
          setUserCertifications(certs);
          
          // Load application statuses
          // applicationId format is: ${tenantId}_${jobId}
          // Application document ID format is: ${user.uid}_${jobId}
          // Use query-based approach to respect Firestore security rules
          const statusMap: Record<string, string> = {};
          
          // Group applications by tenant to batch queries
          const appsByTenant: Record<string, string[]> = {};
          for (const appId of applicationIds) {
            const firstUnderscoreIndex = appId.indexOf('_');
            if (firstUnderscoreIndex === -1) continue;
            
            const tenantIdFromApp = appId.substring(0, firstUnderscoreIndex);
            const jobId = appId.substring(firstUnderscoreIndex + 1);
            
            if (!tenantIdFromApp || !jobId) continue;
            
            if (!appsByTenant[tenantIdFromApp]) {
              appsByTenant[tenantIdFromApp] = [];
            }
            appsByTenant[tenantIdFromApp].push(jobId);
          }
          
          // Query each tenant's applications
          for (const [tenantIdFromApp, jobIds] of Object.entries(appsByTenant)) {
            try {
              const applicationsRef = collection(db, 'tenants', tenantIdFromApp, 'applications');
              // Query all applications for this user in this tenant
              const q = query(
                applicationsRef,
                where('userId', '==', user.uid)
              );
              const snapshot = await getDocs(q);
              
              snapshot.forEach((docSnap) => {
                const appData = docSnap.data();
                // Extract jobId from document ID (format: ${user.uid}_${jobId})
                const docId = docSnap.id;
                const jobIdFromDoc = docId.replace(`${user.uid}_`, '');
                
                // Check if this jobId is in our list
                if (jobIds.includes(jobIdFromDoc)) {
                  const appId = `${tenantIdFromApp}_${jobIdFromDoc}`;
                  statusMap[appId] = appData.status || 'submitted';
                }
              });
            } catch (err: any) {
              // Silently handle permission errors - this is non-critical
              // Users can still see their applications via other means
              if (err.code !== 'permission-denied') {
                console.error(`Error loading applications for tenant ${tenantIdFromApp}:`, err);
              }
            }
          }
          
          setUserApplicationStatuses(statusMap);
        }

        // Load user's assignments for this tenant (for "View Assignment" on jobs board)
        if (specificTenantId) {
          try {
            const assignmentsRef = collection(db, 'tenants', specificTenantId, 'assignments');
            const assignmentsQuery = query(
              assignmentsRef,
              where('userId', '==', user.uid),
              where('status', 'in', ['proposed', 'confirmed', 'active'])
            );
            const assignmentsSnap = await getDocs(assignmentsQuery);
            const map: Record<string, string> = {};
            assignmentsSnap.forEach((docSnap) => {
              const data = docSnap.data();
              const jobOrderId = data.jobOrderId;
              if (jobOrderId && !map[jobOrderId]) {
                map[jobOrderId] = docSnap.id;
              }
            });
            setUserAssignmentIdByJobOrderId(map);
          } catch (err: any) {
            if (err?.code !== 'permission-denied') {
              console.error('Error loading user assignments:', err);
            }
            setUserAssignmentIdByJobOrderId({});
          }
        } else {
          setUserAssignmentIdByJobOrderId({});
        }
      } catch (error) {
        console.error('Error loading user data:', error);
      }
    };
    loadUserData();
  }, [user?.uid, specificTenantId]);

  const licensesCertsKey =
    selectedJob?.licensesCerts && selectedJob.licensesCerts.length > 0
      ? JSON.stringify(selectedJob.licensesCerts)
      : '';

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!user?.uid || !selectedJob?.licensesCerts?.length) {
        setProfileMissingCertList([]);
        return;
      }
      try {
        const missing = await checkMissingCertificationsWithEngine({
          requiredCerts: selectedJob.licensesCerts,
          userCerts: userCertifications,
          workerUid: user.uid,
          jobPosting: {
            id: selectedJob.id,
            licensesCerts: selectedJob.licensesCerts,
            showLicensesCerts: selectedJob.showLicensesCerts,
          },
        });
        if (!cancelled) setProfileMissingCertList(missing);
      } catch {
        if (!cancelled) setProfileMissingCertList([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.uid, userCertifications, licensesCertsKey, selectedJob?.id]);

  // Request user's location permission and get coordinates
  // Only call this in response to a user gesture (e.g., selecting "Closest to Me")
  const requestLocationPermission = () => {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setUserLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude
          });
          setLocationPermission('granted');
        },
        (error) => {
          // Only log non-permission-denied errors to reduce console noise
          if (error.code !== error.PERMISSION_DENIED) {
            console.warn('Location permission denied or error:', error);
          }
          setLocationPermission('denied');
          // If permission denied, reset sort to newest
          setSortBy('newest');
        }
      );
    }
  };

  // Request location permission when user selects "closest" sort option
  useEffect(() => {
    if (sortBy === 'closest' && locationPermission === 'prompt' && !userLocation) {
      // This is triggered by user selecting "closest" from dropdown, so it's a user gesture
      requestLocationPermission();
    }
  }, [sortBy]);

  // Calculate distance between two points using Haversine formula (in miles)
  const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const R = 3959; // Radius of Earth in miles
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    const distance = R * c;
    return distance;
  };

  const getJobDistanceMiles = (job: PublicJobPosting): number | null => {
    if (!userLocation) return null;
    const lat = job.worksiteAddress?.coordinates?.lat;
    const lng = job.worksiteAddress?.coordinates?.lng;
    if (typeof lat !== 'number' || typeof lng !== 'number') return null;
    return calculateDistance(userLocation.lat, userLocation.lng, lat, lng);
  };

  const getDistanceLabel = (distanceMiles: number | null): string | null => {
    if (distanceMiles === null || !Number.isFinite(distanceMiles)) return null;
    if (distanceMiles < 0.1) return t('jobs.distanceUnderPointOne');
    return t('jobs.distanceMilesAway', { miles: distanceMiles.toFixed(1) } as any);
  };


  // Helper function to convert JobOrder to PublicJobPosting format
  const convertJobOrderToPosting = (jobOrder: any, tenantId: string): PublicJobPosting => {
    // Use first gig position's pay rate if available, otherwise use job order pay rate
    const payRate = (jobOrder.gigPositions?.[0]?.payRate 
      ? parseFloat(String(jobOrder.gigPositions[0].payRate)) 
      : jobOrder.payRate) || undefined;
    
    // Use first gig position's job title if available
    const jobTitle = jobOrder.gigPositions?.[0]?.jobTitle || jobOrder.jobTitle || '';
    
    // Convert shiftType array to shift array
    const shift = Array.isArray(jobOrder.shiftType) 
      ? jobOrder.shiftType 
      : (jobOrder.shiftType ? [jobOrder.shiftType] : []);
    
    // Build requirements array
    const requirements = [
      ...(jobOrder.requiredLicenses || []),
      ...(jobOrder.requiredCertifications || []),
      ...(jobOrder.drugScreenRequired ? ['Drug Screen Required'] : []),
      ...(jobOrder.backgroundCheckRequired ? ['Background Check Required'] : []),
      ...(jobOrder.experienceRequired ? [jobOrder.experienceRequired] : []),
      ...(jobOrder.educationRequired ? [jobOrder.educationRequired] : []),
      ...(jobOrder.languagesRequired || []),
      ...(jobOrder.skillsRequired || [])
    ].filter(Boolean);
    
    // Convert dates
    const startDate = jobOrder.startDate?.toDate ? jobOrder.startDate.toDate() : (jobOrder.startDate ? new Date(jobOrder.startDate) : undefined);
    const endDate = jobOrder.endDate?.toDate ? jobOrder.endDate.toDate() : (jobOrder.endDate ? new Date(jobOrder.endDate) : undefined);
    const createdAt = jobOrder.createdAt?.toDate ? jobOrder.createdAt.toDate() : (jobOrder.createdAt ? new Date(jobOrder.createdAt) : new Date());
    
    // Handle worksiteAddress - use directly from job order
    // Check multiple possible field names for address
    let worksiteAddress = jobOrder.worksiteAddress || jobOrder.address || jobOrder.worksite?.address;
    
    // Debug logging - show the full job order structure
    console.log('Converting job order to posting:', {
      jobOrderId: jobOrder.id,
      jobOrderName: jobOrder.jobOrderName,
      worksiteAddress: jobOrder.worksiteAddress,
      address: jobOrder.address,
      worksite: jobOrder.worksite,
      allKeys: Object.keys(jobOrder)
    });
    
    // Ensure worksiteAddress is an object with proper structure
    if (!worksiteAddress) {
      worksiteAddress = {
        street: '',
        city: '',
        state: '',
        zipCode: '',
        country: 'US'
      };
    } else {
      // Preserve existing values - don't overwrite with empty strings if values exist
      worksiteAddress = {
        street: worksiteAddress.street ?? '',
        city: worksiteAddress.city ?? '',
        state: worksiteAddress.state ?? '',
        zipCode: worksiteAddress.zipCode ?? '',
        country: worksiteAddress.country ?? 'US',
        coordinates: worksiteAddress.coordinates
      };
    }
    
    console.log('Final worksiteAddress:', worksiteAddress);
    
    return {
      id: `job-order-${jobOrder.id}`, // Prefix to distinguish from posting IDs
      tenantId: tenantId,
      postTitle: jobOrder.jobOrderName || jobTitle,
      jobTitle: jobTitle,
      jobType: 'gig' as const,
      jobDescription: jobOrder.jobOrderDescription || jobOrder.jobDescription || '',
      companyName: jobOrder.companyName || '',
      worksiteName: jobOrder.worksiteName || '',
      worksiteAddress: worksiteAddress,
      startDate: startDate,
      endDate: endDate,
      expDate: undefined,
      showStart: jobOrder.showStartDate || false,
      showEnd: false,
      payRate: payRate,
      showPayRate: jobOrder.showPayRate || false,
      workersNeeded: jobOrder.workersNeeded,
      showWorkersNeeded: jobOrder.showWorkersNeeded === true, // Default to false so workers needed is hidden unless explicitly enabled
      eVerifyRequired: jobOrder.eVerifyRequired || false,
      screeningPackageName: (jobOrder as { screeningPackageName?: string }).screeningPackageName,
      showScreeningPackageOnPost: false,
      screeningPackageServiceNames: [],
      backgroundCheckPackages: [],
      showBackgroundChecks: false,
      drugScreeningPanels: [],
      showDrugScreening: false,
      additionalScreenings: jobOrder.additionalScreenings || [],
      showAdditionalScreenings: false,
      skills: jobOrder.skillsRequired || [],
      showSkills: false,
      licensesCerts: [...(jobOrder.requiredLicenses || []), ...(jobOrder.requiredCertifications || [])],
      showLicensesCerts: false,
      experienceLevels: jobOrder.experienceRequired ? [jobOrder.experienceRequired] : [],
      showExperience: false,
      educationLevels: jobOrder.educationRequired ? [jobOrder.educationRequired] : [],
      showEducation: false,
      languages: jobOrder.languagesRequired || [],
      showLanguages: false,
      physicalRequirements: jobOrder.physicalRequirements ? [jobOrder.physicalRequirements] : [],
      showPhysicalRequirements: false,
      uniformRequirements: jobOrder.uniformRequirements ? [jobOrder.uniformRequirements] : [],
      showUniformRequirements: false,
      requiredPpe: jobOrder.ppeRequirements ? [jobOrder.ppeRequirements] : [],
      showRequiredPpe: false,
      shift: shift,
      showShift: shift.length > 0,
      startTime: '',
      endTime: '',
      showStartTime: false,
      showEndTime: false,
      status: 'active', // Gig job orders are considered active if status is 'open'
      visibility: (jobOrder.jobsBoardVisibility || jobOrder.visibility || 'public') as 'public' | 'private' | 'restricted',
      restrictedGroups: jobOrder.restrictedGroups || [],
      createdAt: createdAt,
      benefits: '',
      // Add jobOrderId for reference
      jobOrderId: jobOrder.id,
      trustedClient: !!jobOrder.trustedClient,
      popularShift: !!jobOrder.popularShift,
      highDemand: !!jobOrder.highDemand
    };
  };

  const loadPublicJobs = async () => {
    // Load public jobs for the specified tenant or all tenants
    try {
      setLoading(true);
      const jobsBoardService = JobsBoardService.getInstance();
      
      const allJobs: PublicJobPosting[] = [];

      if (specificTenantId) {
        // If we're on the C1 route, load all jobs from the specific tenant (will filter by visibility client-side)
        try {
          // Load public posts (for unauthenticated users, this will only return public posts)
          // For authenticated users with groups, restricted posts will also be included
          const publicPosts = await jobsBoardService.getPublicPosts(specificTenantId, userGroupIds.length > 0 ? userGroupIds : undefined);
          
          // Filter for active posts only
          const activePosts = publicPosts.filter(post => post.status === 'active');
          
          // Get job order IDs that already have postings (to avoid duplicates)
          const jobOrderIdsWithPostings = new Set(
            activePosts
              .filter(post => post.jobOrderId)
              .map(post => post.jobOrderId!)
          );
          
          // Load Gig job orders that don't have postings
          // Load gig job orders that don't have postings yet
          const gigJobOrdersRef = collection(db, 'tenants', specificTenantId, 'job_orders');
          const gigJobOrdersQuery = query(
            gigJobOrdersRef,
            where('jobType', '==', 'gig'),
            where('status', '==', 'open')
          );
          const gigJobOrdersSnapshot = await getDocs(gigJobOrdersQuery);
          
          const gigJobOrders: PublicJobPosting[] = [];
          // Fetch location data for job orders that need it
          const locationPromises = gigJobOrdersSnapshot.docs.map(async (jobOrderDoc) => {
            const jobOrderData = jobOrderDoc.data();
            const jobOrderId = jobOrderDoc.id;
            // Processing job order for public jobs board
            
            // Skip if this job order already has a posting
            if (jobOrderIdsWithPostings.has(jobOrderId)) {
              return null;
            }
            
            // Check visibility - only include public or restricted
            const visibility = jobOrderData.jobsBoardVisibility || jobOrderData.visibility || 'public';
            if (visibility !== 'public' && visibility !== 'restricted') {
              return null;
            }
            
            // Always try to fetch location data from worksite document if worksiteId exists
            // Path: tenants/{tenantId}/locations/{worksiteId}
            if (jobOrderData.worksiteId) {
              try {
                const locationRef = doc(db, 'tenants', specificTenantId, 'locations', jobOrderData.worksiteId);
                const locationSnap = await getDoc(locationRef);
                
                if (locationSnap.exists()) {
                  const locationData = locationSnap.data() as any;
                  
                  // Initialize worksiteAddress if it doesn't exist
                  if (!jobOrderData.worksiteAddress) {
                    jobOrderData.worksiteAddress = {};
                  }
                  
                  // The location document has an 'address' field with city, state, street, zipCode, and coordinates
                  const locAddress = locationData.address || {};
                  
                  // Merge location address data into job order, preferring existing values
                  if ((!jobOrderData.worksiteAddress.city || !jobOrderData.worksiteAddress.city.trim()) && locAddress.city) {
                    jobOrderData.worksiteAddress.city = locAddress.city;
                  }
                  if ((!jobOrderData.worksiteAddress.state || !jobOrderData.worksiteAddress.state.trim()) && locAddress.state) {
                    jobOrderData.worksiteAddress.state = locAddress.state;
                  }
                  if (!jobOrderData.worksiteAddress.street && locAddress.street) {
                    jobOrderData.worksiteAddress.street = locAddress.street;
                  }
                  if (!jobOrderData.worksiteAddress.zipCode && locAddress.zipCode) {
                    jobOrderData.worksiteAddress.zipCode = locAddress.zipCode;
                  }
                  // Get coordinates from address.coordinates
                  if (!jobOrderData.worksiteAddress.coordinates && locAddress.coordinates) {
                    jobOrderData.worksiteAddress.coordinates = {
                      lat: locAddress.coordinates.latitude || locAddress.coordinates.lat,
                      lng: locAddress.coordinates.longitude || locAddress.coordinates.lng
                    };
                  }
                  // Also update worksiteName if it's empty and location has a name
                  if (!jobOrderData.worksiteName && locationData.name) {
                    jobOrderData.worksiteName = locationData.name;
                  }
                }
                // Silently handle missing locations - this is expected for some job orders
              } catch (locationErr) {
                // Only log actual errors, not missing documents
                console.debug(`Location fetch failed for job order ${jobOrderId}:`, locationErr);
              }
            }
            
            const converted = convertJobOrderToPosting({ ...jobOrderData, id: jobOrderId }, specificTenantId);
            return converted;
          });
          
          const resolvedGigJobOrders = await Promise.all(locationPromises);
          gigJobOrders.push(...resolvedGigJobOrders.filter((job): job is PublicJobPosting => job !== null));
          
                    // Convert postings to PublicJobPosting format
          // Also fetch location data for postings that need it
          const convertedPostsPromises = activePosts.map(async (post) => {
            // If worksiteAddress is missing city/state, try to fetch location
            let worksiteAddress: any = post.worksiteAddress;
            let worksiteId = (post as any).worksiteId;
            // Enrich with current job order dates so board shows latest start/end (e.g. extended dates, new shifts)
            let enrichedStartDate: Date | undefined = post.startDate instanceof Date ? post.startDate : (post.startDate ? new Date(post.startDate) : undefined);
            let enrichedEndDate: Date | undefined = post.endDate instanceof Date ? post.endDate : (post.endDate ? new Date(post.endDate) : undefined);

            // When post is linked to a job order, fetch it for worksiteId and for current start/end dates
            if ((post as any).jobOrderId) {
              try {
                const jobOrderRef = doc(db, 'tenants', specificTenantId, 'job_orders', (post as any).jobOrderId);
                const jobOrderSnap = await getDoc(jobOrderRef);
                if (jobOrderSnap.exists()) {
                  const jobOrderData = jobOrderSnap.data() as Record<string, unknown>;
                  if (!worksiteId && jobOrderData.worksiteId) worksiteId = jobOrderData.worksiteId as string;
                  const toDate = (v: unknown): Date | undefined => {
                    if (v == null) return undefined;
                    if (v instanceof Date) return v;
                    if (typeof (v as { toDate?: () => Date }).toDate === 'function') return (v as { toDate: () => Date }).toDate();
                    if (typeof v === 'string' || typeof v === 'number') return new Date(v);
                    return undefined;
                  };
                  if (jobOrderData.startDate != null) enrichedStartDate = toDate(jobOrderData.startDate);
                  if (jobOrderData.endDate != null) enrichedEndDate = toDate(jobOrderData.endDate);
                  // For gig posts, extend end date to last shift date (worker UI override)
                  if ((post as any).jobType === 'gig') {
                    try {
                      const shiftsRef = collection(db, 'tenants', specificTenantId, 'job_orders', (post as any).jobOrderId, 'shifts');
                      const shiftsSnap = await getDocs(shiftsRef);
                      const shifts = shiftsSnap.docs.map((d) => d.data()).map((data: any) => ({
                        shiftDate: data.shiftDate,
                        endDate: data.endDate,
                        dateSchedule: data.dateSchedule,
                      }));
                      const lastStr = getLastShiftDateFromShifts(shifts);
                      if (lastStr) {
                        const lastDate = new Date(lastStr);
                        if (!enrichedEndDate || lastDate > enrichedEndDate) enrichedEndDate = lastDate;
                      }
                    } catch (e) {
                      console.debug('Failed to fetch shifts for gig post end date', post.id, e);
                    }
                  }
                }
              } catch (err) {
                console.debug('Failed to fetch job order for posting', post.id, ':', err);
              }
            }
            
            // Now fetch location if we have worksiteId and location data is missing
            if ((!worksiteAddress || !worksiteAddress.city || !worksiteAddress.city.trim() || 
                 !worksiteAddress.state || !worksiteAddress.state.trim()) && worksiteId) {
              try {
                const locationRef = doc(db, 'tenants', specificTenantId, 'locations', worksiteId);
                const locationSnap = await getDoc(locationRef);
                
                if (locationSnap.exists()) {
                  const locationData = locationSnap.data() as any;
                  const locAddress = locationData.address || {};
                  if (!worksiteAddress) {
                    worksiteAddress = {};
                  }
                  if (!worksiteAddress.city || !worksiteAddress.city.trim()) {
                    worksiteAddress.city = locAddress.city;
                  }
                  if (!worksiteAddress.state || !worksiteAddress.state.trim()) {
                    worksiteAddress.state = locAddress.state;
                  }
                  if (!worksiteAddress.street && locAddress.street) {
                    worksiteAddress.street = locAddress.street;
                  }
                  if (!worksiteAddress.zipCode && locAddress.zipCode) {
                    worksiteAddress.zipCode = locAddress.zipCode;
                  }
                  if (!worksiteAddress.coordinates && locAddress.coordinates) {
                    worksiteAddress.coordinates = {
                      lat: locAddress.coordinates.latitude || locAddress.coordinates.lat,
                      lng: locAddress.coordinates.longitude || locAddress.coordinates.lng
                    };
                  }
                }
                // Silently handle missing locations - this is expected for some postings
              } catch (err) {
                // Only log actual errors, not missing documents
                console.debug('Location fetch failed for posting', post.id, ':', err);
              }
            }
            
            return {
              id: post.id,
              tenantId: post.tenantId,
              postTitle: post.postTitle,
              jobTitle: post.jobTitle,
              jobType: post.jobType,
              jobDescription: post.jobDescription,
              companyName: post.companyName,
              worksiteName: post.worksiteName,
              worksiteAddress: worksiteAddress || post.worksiteAddress,
              startDate: enrichedStartDate,
              endDate: enrichedEndDate,
              expDate: post.expDate,
            showStart: post.showStart,
            showEnd: post.showEnd,
            payRate: post.payRate,
            showPayRate: post.showPayRate,
            workersNeeded: post.workersNeeded,
            showWorkersNeeded: post.showWorkersNeeded === true, // Default to false so workers needed is hidden unless explicitly enabled
            eVerifyRequired: post.eVerifyRequired,
            screeningPackageName: post.screeningPackageName ?? undefined,
            showScreeningPackageOnPost: post.showScreeningPackageOnPost,
            screeningPackageServiceNames: post.screeningPackageServiceNames,
            backgroundCheckPackages: post.backgroundCheckPackages,
            showBackgroundChecks: post.showBackgroundChecks,
            drugScreeningPanels: post.drugScreeningPanels,
            showDrugScreening: post.showDrugScreening,
            additionalScreenings: post.additionalScreenings,
            showAdditionalScreenings: post.showAdditionalScreenings,
            skills: post.skills,
            showSkills: post.showSkills,
            licensesCerts: post.licensesCerts,
            showLicensesCerts: post.showLicensesCerts,
            experienceLevels: post.experienceLevels,
            showExperience: post.showExperience,
            educationLevels: post.educationLevels,
            showEducation: post.showEducation,
            languages: post.languages,
            showLanguages: post.showLanguages,
            physicalRequirements: post.physicalRequirements,
            showPhysicalRequirements: post.showPhysicalRequirements,
            uniformRequirements: post.uniformRequirements,
            showUniformRequirements: post.showUniformRequirements,
            customUniformRequirements: post.customUniformRequirements,
            showCustomUniformRequirements: post.showCustomUniformRequirements,
            requiredPpe: post.requiredPpe,
            showRequiredPpe: post.showRequiredPpe,
            shift: post.shift,
            showShift: post.showShift,
            startTime: post.startTime,
            endTime: post.endTime,
            showStartTime: post.showStartTime,
            showEndTime: post.showEndTime,
            status: post.status,
            visibility: post.visibility,
            restrictedGroups: (post as any).restrictedGroups,
            createdAt: post.createdAt,
            benefits: post.benefits,
            jobOrderId: post.jobOrderId,
            trustedClient: !!(post as any).trustedClient,
            popularShift: !!(post as any).popularShift,
            highDemand: !!(post as any).highDemand
          };
        });
        
        const convertedPosts = await Promise.all(convertedPostsPromises);
          
        // Combine postings and gig job orders (postings take precedence for duplicates)
        allJobs.push(...convertedPosts, ...gigJobOrders);
        } catch (err) {
          console.error(`Failed to load jobs for specific tenant ${specificTenantId}:`, err);
          // Don't silently fail - show error to user
          if (err instanceof Error) {
            console.error('Error details:', {
              message: err.message,
              code: (err as any).code,
              stack: err.stack
            });
          }
        }
      } else {
        // Original behavior: Query all tenants for public job postings
        const tenantsSnapshot = await getDocs(collection(db, 'tenants'));

        for (const tenantDoc of tenantsSnapshot.docs) {
          const tenantId = tenantDoc.id;
          
          try {
            // Use the JobsBoardService to get public posts
            // For unauthenticated users, this will only return public posts
            const publicPosts = await jobsBoardService.getPublicPosts(tenantId);
            
            // Filter for active posts only
            const activePosts = publicPosts.filter(post => post.status === 'active');
            
            // Get job order IDs that already have postings (to avoid duplicates)
            const jobOrderIdsWithPostings = new Set(
              activePosts
                .filter(post => post.jobOrderId)
                .map(post => post.jobOrderId!)
            );
            
            // Load Gig job orders that don't have postings
            const gigJobOrders: PublicJobPosting[] = [];
            try {
              const gigJobOrdersRef = collection(db, 'tenants', tenantId, 'job_orders');
              const gigJobOrdersQuery = query(
                gigJobOrdersRef,
                where('jobType', '==', 'gig'),
                where('status', '==', 'open')
              );
              const gigJobOrdersSnapshot = await getDocs(gigJobOrdersQuery);
              
              // Fetch location data for job orders that need it
              const locationPromises = gigJobOrdersSnapshot.docs.map(async (jobOrderDoc) => {
                const jobOrderData = jobOrderDoc.data();
                const jobOrderId = jobOrderDoc.id;
                
                // Skip if this job order already has a posting
                if (jobOrderIdsWithPostings.has(jobOrderId)) {
                  return null;
                }
                
                // Check visibility - only include public or restricted
                const visibility = jobOrderData.jobsBoardVisibility || jobOrderData.visibility || 'public';
                if (visibility !== 'public' && visibility !== 'restricted') {
                  return null;
                }
                
                // Always try to fetch location data from worksite document if worksiteId exists
                // Path: tenants/{tenantId}/locations/{worksiteId}
                if (jobOrderData.worksiteId) {
                  try {
                    const locationRef = doc(db, 'tenants', tenantId, 'locations', jobOrderData.worksiteId);
                    const locationSnap = await getDoc(locationRef);
                    
                    if (locationSnap.exists()) {
                      const locationData = locationSnap.data() as any;
                      
                      // Initialize worksiteAddress if it doesn't exist
                      if (!jobOrderData.worksiteAddress) {
                        jobOrderData.worksiteAddress = {};
                      }
                      
                      // The location document has an 'address' field with city, state, street, zipCode, and coordinates
                      const locAddress = locationData.address || {};
                      
                      // Merge location address data into job order, preferring existing values
                      if ((!jobOrderData.worksiteAddress.city || !jobOrderData.worksiteAddress.city.trim()) && locAddress.city) {
                        jobOrderData.worksiteAddress.city = locAddress.city;
                      }
                      if ((!jobOrderData.worksiteAddress.state || !jobOrderData.worksiteAddress.state.trim()) && locAddress.state) {
                        jobOrderData.worksiteAddress.state = locAddress.state;
                      }
                      if (!jobOrderData.worksiteAddress.street && locAddress.street) {
                        jobOrderData.worksiteAddress.street = locAddress.street;
                      }
                      if (!jobOrderData.worksiteAddress.zipCode && locAddress.zipCode) {
                        jobOrderData.worksiteAddress.zipCode = locAddress.zipCode;
                      }
                      // Get coordinates from address.coordinates
                      if (!jobOrderData.worksiteAddress.coordinates && locAddress.coordinates) {
                        jobOrderData.worksiteAddress.coordinates = {
                          lat: locAddress.coordinates.latitude || locAddress.coordinates.lat,
                          lng: locAddress.coordinates.longitude || locAddress.coordinates.lng
                        };
                      }
                      // Also update worksiteName if it's empty and location has a name
                      if (!jobOrderData.worksiteName && locationData.name) {
                        jobOrderData.worksiteName = locationData.name;
                      }
                    }
                    // Silently handle missing locations - this is expected for some job orders
                  } catch (locationErr) {
                    // Only log actual errors, not missing documents
                    console.debug(`Location fetch failed for job order ${jobOrderId}:`, locationErr);
                  }
                }
                
                const converted = convertJobOrderToPosting({ ...jobOrderData, id: jobOrderId }, tenantId);
                return converted;
              });
              
              const resolvedGigJobOrders = await Promise.all(locationPromises);
              gigJobOrders.push(...resolvedGigJobOrders.filter((job): job is PublicJobPosting => job !== null));
            } catch (gigErr) {
              // If gig job orders query fails (e.g., permissions), just continue with postings
              console.warn(`Failed to load gig job orders for tenant ${tenantId}:`, gigErr);
            }
            
            // Convert to PublicJobPosting format; enrich with current job order dates when linked
            const toDate = (v: unknown): Date | undefined => {
              if (v == null) return undefined;
              if (v instanceof Date) return v;
              if (typeof (v as { toDate?: () => Date }).toDate === 'function') return (v as { toDate: () => Date }).toDate();
              if (typeof v === 'string' || typeof v === 'number') return new Date(v);
              return undefined;
            };
            const convertedPostsPromisesAll = activePosts.map(async (post) => {
              let startDate: Date | undefined = post.startDate instanceof Date ? post.startDate : (post.startDate ? new Date(post.startDate) : undefined);
              let endDate: Date | undefined = post.endDate instanceof Date ? post.endDate : (post.endDate ? new Date(post.endDate) : undefined);
              if ((post as any).jobOrderId) {
                try {
                  const jobOrderRef = doc(db, 'tenants', tenantId, 'job_orders', (post as any).jobOrderId);
                  const jobOrderSnap = await getDoc(jobOrderRef);
                  if (jobOrderSnap.exists()) {
                    const jobOrderData = jobOrderSnap.data() as Record<string, unknown>;
                    if (jobOrderData.startDate != null) startDate = toDate(jobOrderData.startDate);
                    if (jobOrderData.endDate != null) endDate = toDate(jobOrderData.endDate);
                    if ((post as any).jobType === 'gig') {
                      try {
                        const shiftsRef = collection(db, 'tenants', tenantId, 'job_orders', (post as any).jobOrderId, 'shifts');
                        const shiftsSnap = await getDocs(shiftsRef);
                        const shifts = shiftsSnap.docs.map((d) => d.data()).map((data: any) => ({
                          shiftDate: data.shiftDate,
                          endDate: data.endDate,
                          dateSchedule: data.dateSchedule,
                        }));
                        const lastStr = getLastShiftDateFromShifts(shifts);
                        if (lastStr) {
                          const lastDate = new Date(lastStr);
                          if (!endDate || lastDate > endDate) endDate = lastDate;
                        }
                      } catch (e) {
                        console.debug('Failed to fetch shifts for gig post end date', post.id, e);
                      }
                    }
                  }
                } catch (err) {
                  console.debug('Failed to fetch job order for posting', post.id, ':', err);
                }
              }
              return {
                id: post.id,
                tenantId: post.tenantId,
                postTitle: post.postTitle,
                jobTitle: post.jobTitle,
                jobType: post.jobType,
                jobDescription: post.jobDescription,
                companyName: post.companyName,
                worksiteName: post.worksiteName,
                worksiteAddress: post.worksiteAddress,
                startDate,
                endDate,
                expDate: post.expDate,
              showStart: post.showStart,
              showEnd: post.showEnd,
              payRate: post.payRate,
              showPayRate: post.showPayRate,
              workersNeeded: post.workersNeeded,
            showWorkersNeeded: post.showWorkersNeeded === true, // Default to false so workers needed is hidden unless explicitly enabled
              eVerifyRequired: post.eVerifyRequired,
              screeningPackageName: post.screeningPackageName ?? undefined,
              showScreeningPackageOnPost: post.showScreeningPackageOnPost,
              screeningPackageServiceNames: post.screeningPackageServiceNames,
              backgroundCheckPackages: post.backgroundCheckPackages,
              showBackgroundChecks: post.showBackgroundChecks,
              drugScreeningPanels: post.drugScreeningPanels,
              showDrugScreening: post.showDrugScreening,
              additionalScreenings: post.additionalScreenings,
              showAdditionalScreenings: post.showAdditionalScreenings,
              skills: post.skills,
              showSkills: post.showSkills,
              licensesCerts: post.licensesCerts,
              showLicensesCerts: post.showLicensesCerts,
              experienceLevels: post.experienceLevels,
              showExperience: post.showExperience,
              educationLevels: post.educationLevels,
              showEducation: post.showEducation,
              languages: post.languages,
              showLanguages: post.showLanguages,
              physicalRequirements: post.physicalRequirements,
              showPhysicalRequirements: post.showPhysicalRequirements,
              uniformRequirements: post.uniformRequirements,
              showUniformRequirements: post.showUniformRequirements,
              requiredPpe: post.requiredPpe,
              showRequiredPpe: post.showRequiredPpe,
              shift: post.shift,
              showShift: post.showShift,
              startTime: post.startTime,
              endTime: post.endTime,
              showStartTime: post.showStartTime,
              showEndTime: post.showEndTime,
              status: post.status,
              visibility: post.visibility,
              restrictedGroups: (post as any).restrictedGroups,
              createdAt: post.createdAt,
              benefits: post.benefits,
              jobOrderId: (post as any).jobOrderId,
              trustedClient: !!(post as any).trustedClient,
              popularShift: !!(post as any).popularShift,
              highDemand: !!(post as any).highDemand
            };
            });
            const convertedPosts = await Promise.all(convertedPostsPromisesAll);

            // Combine postings and gig job orders
            allJobs.push(...convertedPosts, ...gigJobOrders);
          } catch (err) {
            console.warn(`Failed to load jobs for tenant ${tenantId}:`, err);
            // Continue with other tenants
          }
        }
      }

      // Sort by creation date (newest first)
      allJobs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      setJobs(allJobs);
      setFilteredJobs(allJobs);
    } catch (err: any) {
      console.error('Error loading public jobs:', err);
      setError(err.message || 'Failed to load jobs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let filtered = jobs;

    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      const lc = (v: string | null | undefined) => String(v ?? '').toLowerCase();
      filtered = filtered.filter(
        (job) =>
          lc(job.postTitle).includes(q) ||
          lc(job.jobTitle).includes(q) ||
          lc(job.jobDescription).includes(q) ||
          lc(job.worksiteName).includes(q) ||
          lc(job.companyName).includes(q) ||
          (job.skills?.some((skill) => lc(skill).includes(q)) ?? false)
      );
    }

    if (locationFilter !== 'all') {
      filtered = filtered.filter((job) => {
        // Match against city, state format
        if (job.worksiteAddress && job.worksiteAddress.city && job.worksiteAddress.state) {
          return `${job.worksiteAddress.city}, ${job.worksiteAddress.state}` === locationFilter;
        }
        // Or match against worksiteName
        return job.worksiteName === locationFilter;
      });
    }

    if (jobTypeFilter !== 'all') {
      filtered = filtered.filter((job) => job.jobType === jobTypeFilter);
    }

    if (showFavoritesOnly) {
      filtered = filtered.filter((job) => favorites.includes(job.id));
    }
    
    // Apply visibility filtering
    filtered = filtered.filter((job) => {
      // Public jobs are visible to everyone
      if (job.visibility === 'public') return true;
      
      // Private jobs are hidden from job board (only visible in admin/recruiter dashboards)
      if (job.visibility === 'private') return false;
      
      // Restricted jobs are only visible to users in the specified groups
      if (job.visibility === 'restricted') {
        // If user is not logged in, hide restricted jobs
        if (!user?.uid) return false;
        
        // Check if job has restrictedGroups array
        if (!Array.isArray(job.restrictedGroups) || job.restrictedGroups.length === 0) {
          // No groups specified, hide the job
          return false;
        }
        
        // Check if user is a member of at least one of the required groups
        return job.restrictedGroups.some((groupId: string) => userGroupIds.includes(groupId));
      }
      
      // Default: show the job (for backwards compatibility)
      return true;
    });

    // Apply sorting
    if (sortBy === 'closest' && userLocation) {
      console.log('🔍 Closest sorting - User location:', userLocation);
      console.log('🔍 Jobs with coordinates:', filtered.map(job => ({
        id: job.id,
        title: job.postTitle,
        hasCoords: !!(job.worksiteAddress?.coordinates?.lat && job.worksiteAddress?.coordinates?.lng),
        coords: job.worksiteAddress?.coordinates
      })));
      
      // Sort by distance (closest first) - keep all jobs, just sort them
      filtered = filtered.sort((a, b) => {
        const aHasCoords = a.worksiteAddress?.coordinates?.lat && a.worksiteAddress?.coordinates?.lng;
        const bHasCoords = b.worksiteAddress?.coordinates?.lat && b.worksiteAddress?.coordinates?.lng;
        
        // If both have coordinates, sort by distance
        if (aHasCoords && bHasCoords) {
          const distanceA = calculateDistance(
            userLocation.lat,
            userLocation.lng,
            a.worksiteAddress!.coordinates!.lat,
            a.worksiteAddress!.coordinates!.lng
          );
          const distanceB = calculateDistance(
            userLocation.lat,
            userLocation.lng,
            b.worksiteAddress!.coordinates!.lat,
            b.worksiteAddress!.coordinates!.lng
          );
          return distanceA - distanceB;
        }
        
        // If only one has coordinates, prioritize the one with coordinates
        if (aHasCoords && !bHasCoords) return -1;
        if (!aHasCoords && bHasCoords) return 1;
        
        // If neither has coordinates, maintain original order
        return 0;
      });
    } else if (sortBy === 'pay_desc') {
      // Sort by pay rate (high to low), then newest first as tie-breaker
      filtered = filtered.sort((a, b) => {
        const payA = Number.isFinite(Number(a.payRate)) ? Number(a.payRate) : -1;
        const payB = Number.isFinite(Number(b.payRate)) ? Number(b.payRate) : -1;
        if (payB !== payA) return payB - payA;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
    } else {
      // Default sort by newest
      filtered = filtered.sort((a, b) => 
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    }

    setFilteredJobs(filtered);
  }, [jobs, searchTerm, locationFilter, jobTypeFilter, showFavoritesOnly, favorites, sortBy, userLocation, userGroupIds, user?.uid]);

  const getUniqueLocations = () => {
    const locations = new Set<string>();
    jobs.forEach(job => {
      // Always prefer city, state format for dropdown
      if (job.worksiteAddress?.city && job.worksiteAddress?.state &&
          job.worksiteAddress.city.trim() && job.worksiteAddress.state.trim()) {
        locations.add(`${job.worksiteAddress.city}, ${job.worksiteAddress.state}`);
      }
      // Skip jobs without proper city/state (they won't be filterable by location)
    });
    return Array.from(locations).sort();
  };


  const handleApply = async (job: PublicJobPosting) => {
    const jobOrderIdParam = (job as any)?.jobOrderId ? `jobOrderId=${encodeURIComponent(String((job as any).jobOrderId))}` : '';
    if (!user) {
      // Not logged in - navigate to login/signup
      navigate(`/apply/${job.tenantId}/${job.id}?returnTo=/c1/jobs-board/${job.id}${jobOrderIdParam ? `&${jobOrderIdParam}` : ''}`);
      return;
    }

    // Gig jobs: require at least one shift selected (apply-to-shift model; see docs/career-vs-gig-placements-assignments.md)
    if ((job as any).jobType === 'gig' && (!selectedJobShifts || selectedJobShifts.length === 0)) {
      alert('Please select at least one shift to apply to.');
      return;
    }

    try {
      // Check if user has existing application data
      const { hasExistingApplicationData, getMissingRequiredCertifications, submitQuickApplication } = await import('../utils/quickApplicationSubmit');
      
      const hasExistingData = await hasExistingApplicationData(user.uid);
      
      if (hasExistingData) {
        // Check if job requires certifications user doesn't have
        const missingCerts = await getMissingRequiredCertifications(user.uid, job);
        
        if (missingCerts.length === 0) {
          // User has all required certs - submit directly
          // For gig jobs, use selectedJobShifts if available
          const shiftsToUse = (job as any).jobType === 'gig' && selectedJobShifts.length > 0
            ? selectedJobShifts.map((s: any) => s.id || s)
            : [];
          
          const result = await submitQuickApplication(
            user.uid,
            job.tenantId,
            job.id,
            job,
            shiftsToUse,
            `/c1/jobs-board/${job.id}`
          );
          
          if (result.success) {
            handleCloseDialog();
            // Open the job detail page so the worker sees updated status (same as applying from the posting page)
            navigate(`/c1/jobs-board/${job.id}`, { replace: true });
            return;
          } else {
            // Error - show alert and navigate to wizard
            alert(result.error || 'Failed to submit application. Please try again.');
            navigate(`/apply/${job.tenantId}/${job.id}${jobOrderIdParam ? `?${jobOrderIdParam}` : ''}`);
            return;
          }
        } else {
          // Missing certs - navigate to wizard starting at certifications step
          // For gig jobs, include shifts in query params
          const shiftsToUse = (job as any).jobType === 'gig' && selectedJobShifts.length > 0
            ? selectedJobShifts.map((s: any) => s.id || s).filter(Boolean)
            : [];
          const shiftsParam = shiftsToUse.length > 0 ? `shifts=${encodeURIComponent(shiftsToUse.join(','))}` : '';
          const params = [`step=7`, shiftsParam, jobOrderIdParam].filter(Boolean).join('&');
          navigate(`/apply/${job.tenantId}/${job.id}?${params}`);
          handleCloseDialog(); // Close dialog when navigating
          return;
        }
      } else {
        // First time applicant - navigate to full wizard
        const shiftsToUse = (job as any).jobType === 'gig' && selectedJobShifts.length > 0
          ? selectedJobShifts.map((s: any) => s.id || s).filter(Boolean)
          : [];
        const shiftsParam = shiftsToUse.length > 0 ? `shifts=${encodeURIComponent(shiftsToUse.join(','))}` : '';
        const params = [shiftsParam, jobOrderIdParam].filter(Boolean).join('&');
        navigate(`/apply/${job.tenantId}/${job.id}${params ? `?${params}` : ''}`);
        handleCloseDialog(); // Close dialog when navigating
        return;
      }
    } catch (error) {
      console.error('Error in handleApply:', error);
      // Fallback to wizard on error
      const shiftsToUse = (job as any).jobType === 'gig' && selectedJobShifts.length > 0
        ? selectedJobShifts.map((s: any) => s.id || s).filter(Boolean)
        : [];
      const shiftsParam = shiftsToUse.length > 0 ? `shifts=${encodeURIComponent(shiftsToUse.join(','))}` : '';
      const params = [shiftsParam, jobOrderIdParam].filter(Boolean).join('&');
      navigate(`/apply/${job.tenantId}/${job.id}${params ? `?${params}` : ''}`);
    }
  };

  const navigateToJobDetails = (
    job: Pick<PublicJobPosting, 'id' | 'tenantId'>,
    source: 'grid_card' | 'grid_chevron',
    state?: Record<string, unknown>,
  ) => {
    const route = `/c1/jobs-board/${job.id}`;
    console.debug('[JobsBoardNav] navigate', {
      source,
      route,
      params: { postId: job.id, tenantId: job.tenantId },
      state: state ?? null,
    });
    navigate(route, state ? { state } : undefined);
  };

  const handleCardClick = (job: PublicJobPosting) => {
    navigateToJobDetails(job, 'grid_card');
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
    setSelectedJob(null);
    setSelectedJobShifts([]);
    setActiveTab(0); // Reset to first tab
  };

  // Load shifts when a job is selected for dialog
  useEffect(() => {
    const loadShiftsForDialog = async () => {
      if (!selectedJob || selectedJob.jobType !== 'gig' || !(selectedJob as any).jobOrderId) {
        setSelectedJobShifts([]);
        return;
      }

      try {
        setLoadingSelectedJobShifts(true);
        const jobsBoardService = JobsBoardService.getInstance();
        const shifts = await jobsBoardService.fetchActiveShiftsForJobOrder(
          selectedJob.tenantId,
          (selectedJob as any).jobOrderId,
          30,
          (selectedJob as any).positionJobTitle
        );
        setSelectedJobShifts(shifts);
      } catch (err) {
        console.error('Error loading shifts for dialog:', err);
        setSelectedJobShifts([]);
      } finally {
        setLoadingSelectedJobShifts(false);
      }
    };

    loadShiftsForDialog();
  }, [selectedJob]);

  // Helper function to safely format calendar dates for display (avoids UTC→local shift)
  const formatDateForDisplay = (dateValue: any): string => {
    if (!dateValue) return '';
    try {
      let date: Date;
      if (typeof dateValue === 'string') {
        date = new Date(dateValue);
      } else if (dateValue && typeof dateValue.toDate === 'function') {
        date = dateValue.toDate();
      } else if (dateValue && typeof dateValue.toISOString === 'function') {
        date = dateValue;
      } else {
        date = new Date(dateValue);
      }
      if (isNaN(date.getTime())) return '';
      const m = date.getUTCMonth() + 1;
      const d = date.getUTCDate();
      const y = date.getUTCFullYear();
      return `${m}/${d}/${y}`;
    } catch (error) {
      console.warn('Error formatting date for display:', dateValue, error);
      return '';
    }
  };

  // Helper function to get application status button label and styling (labels are translated for display)
  const getApplicationStatusButton = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'hired':
        return {
          label: t('jobs.applicationStatusHired'),
          backgroundColor: '#4CAF50', // Green
          color: '#fff',
          cursor: 'default',
          pointerEvents: 'none' as const
        };
      case 'waitlisted':
        return {
          label: t('jobs.applicationStatusWaitlisted'),
          backgroundColor: '#ED6C02', // Orange
          color: '#fff',
          cursor: 'default',
          pointerEvents: 'none' as const
        };
      case 'rejected':
      case 'not accepted':
        return {
          label: t('jobs.applicationStatusNotAccepted'),
          backgroundColor: '#F44336', // Red
          color: '#fff',
          cursor: 'default',
          pointerEvents: 'none' as const
        };
      case 'withdrawn':
      case 'cancelled':
        return {
          label: t('jobs.applicationStatusCancelled'),
          backgroundColor: '#9E9E9E', // Grey
          color: '#fff',
          cursor: 'default',
          pointerEvents: 'none' as const
        };
      case 'advanced':
      case 'screened':
      case 'offer_pending':
      case 'offer':
      case 'accepted':
        return {
          label: t('jobs.applicationStatusAccepted'),
          backgroundColor: '#2196F3', // Blue
          color: '#fff',
          cursor: 'default',
          pointerEvents: 'none' as const
        };
      case 'submitted':
      case 'new':
      default:
        return {
          label: t('jobs.feed.applicationSubmitted'),
          backgroundColor: '#FFC700', // Yellow (existing color)
          color: '#000',
          cursor: 'default',
          pointerEvents: 'none' as const
        };
    }
  };

  if (loading) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
          <CircularProgress />
        </Box>
      </Container>
    );
  }

  if (error) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Alert severity="error">{error}</Alert>
      </Container>
    );
  }

  // Define the main content
  const mainContent = (
    <>
      {/* Only show header for non-logged-in users */}
      {!user && (
        <Box sx={{ mb: 4 }}>
          {/* Header with logo, title, and auth button */}
          <Box sx={{ mb: 2 }}>
            {/* First row: Logo and Sign In button */}
            <Box sx={{ 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'space-between', 
              mb: isMobile ? 1.5 : 2,
              flexWrap: 'wrap',
              gap: 1
            }}>
              {/* C1 Logo - Left side */}
              {isC1Route && (
                <Box
                  component="img"
                  src="/C1.png" 
                  alt="C1 Staffing" 
                  sx={{ 
                    height: { xs: '36px', sm: '50px', md: '64px' }, // Smaller on mobile
                    width: 'auto',
                    objectFit: 'contain'
                  }}
                  onError={(e: any) => {
                    // Fallback if logo doesn't exist yet
                    e.currentTarget.style.display = 'none';
                  }}
                />
              )}
              
              {/* Language picker + Sign In or Create Account - Top right */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Tooltip title={guestLanguage === 'es' ? 'Idioma: Español' : 'Language: English'}>
                  <Box
                    component="button"
                    onClick={(e) => setLanguageMenuAnchorEl(e.currentTarget)}
                    aria-label={guestLanguage === 'es' ? 'Idioma' : 'Language'}
                    sx={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 0.5,
                      border: '1px solid',
                      borderColor: 'divider',
                      borderRadius: 1,
                      px: 1,
                      py: 0.75,
                      bgcolor: 'background.paper',
                      color: 'text.secondary',
                      cursor: 'pointer',
                      '&:hover': { bgcolor: 'action.hover', color: 'text.primary' },
                    }}
                  >
                    <Language sx={{ fontSize: 20 }} />
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {guestLanguage === 'es' ? 'ES' : 'EN'}
                    </Typography>
                  </Box>
                </Tooltip>
                <Button
                  variant="contained"
                  onClick={() => setAuthDialogOpen(true)}
                  size={isMobile ? 'small' : 'medium'}
                  sx={{
                    px: { xs: 1.5, sm: 3 },
                    py: { xs: 0.75, sm: 1.5 },
                    fontWeight: 600,
                    borderRadius: 2,
                    textTransform: 'none',
                    fontSize: { xs: '0.75rem', sm: '1rem' },
                    whiteSpace: 'nowrap'
                  }}
                >
                  Sign In or Create Account
                </Button>
              </Box>
            </Box>
            <Menu
              anchorEl={languageMenuAnchorEl}
              open={Boolean(languageMenuAnchorEl)}
              onClose={() => setLanguageMenuAnchorEl(null)}
              anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
              transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            >
              <MenuItem
                selected={guestLanguage === 'en'}
                onClick={() => {
                  setLanguageMenuAnchorEl(null);
                  setGuestLanguage('en');
                }}
              >
                English (EN)
              </MenuItem>
              <MenuItem
                selected={guestLanguage === 'es'}
                onClick={() => {
                  setLanguageMenuAnchorEl(null);
                  setGuestLanguage('es');
                }}
              >
                Español (ES)
              </MenuItem>
            </Menu>
            
            {/* Second row: Main Page Title */}
            <Typography 
              variant="h3" 
              sx={{ 
                fontWeight: 700,
                fontSize: { xs: '1.25rem', sm: '2rem', md: '3rem' }, // Smaller on mobile
                lineHeight: { xs: 1.3, sm: 1.2 }
              }}
            >
              {isC1Route ? t('nav.findWork') : t('jobs.findMoreWork')}
            </Typography>
          </Box>
        </Box>
      )}

      {/* Search and Filters */}
      <Paper elevation={1} sx={{ p: 3, mb: 4 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} md={6}>
            <TextField
              fullWidth
              placeholder={t('jobs.searchPlaceholder')}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              size="medium"
              sx={{
                '& .MuiInputBase-root': {
                  minHeight: 52,
                },
              }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <Search />
                  </InputAdornment>
                ),
                endAdornment: (
                  <InputAdornment position="end">
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      {/* Filter icon button - only on mobile */}
                      {isMobile && (
                        <IconButton
                          size="small"
                          onClick={() => setMobileFiltersOpen(!mobileFiltersOpen)}
                          sx={{
                            color: mobileFiltersOpen ? 'primary.main' : 'text.secondary',
                            '&:hover': {
                              backgroundColor: 'action.hover'
                            }
                          }}
                        >
                          <FilterList />
                        </IconButton>
                      )}
                      {/* Favorites filter - only show if user is logged in */}
                      {user && (
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
                              backgroundColor: showFavoritesOnly ? 'primary.dark' : 'action.hover'
                            }
                          }}
                        />
                      )}
                    </Box>
                  </InputAdornment>
                ),
              }}
            />
          </Grid>
          {/* Desktop filters - hidden on mobile; Location is autocomplete for long lists */}
          <Grid item xs={12} md={2} sx={{ display: { xs: 'none', md: 'block' } }}>
            <Autocomplete
              fullWidth
              size="small"
              options={['all', ...getUniqueLocations()]}
              getOptionLabel={(option) => (option === 'all' ? t('jobs.allLocations') : option)}
              value={locationFilter}
              onChange={(_, newValue) => setLocationFilter(newValue ?? 'all')}
              renderInput={(params) => (
                <TextField {...params} label={t('jobs.location')} placeholder={t('jobs.allLocations')} />
              )}
              isOptionEqualToValue={(option, value) => option === value}
            />
          </Grid>
          <Grid item xs={12} md={2} sx={{ display: { xs: 'none', md: 'block' } }}>
            <FormControl fullWidth>
              <InputLabel>{t('jobs.jobType')}</InputLabel>
              <Select
                value={jobTypeFilter}
                label={t('jobs.jobType')}
                onChange={(e) => setJobTypeFilter(e.target.value)}
              >
                <MenuItem value="all">{t('jobs.allTypes')}</MenuItem>
                <MenuItem value="gig">{t('jobs.gig')}</MenuItem>
                <MenuItem value="career">{t('jobs.career')}</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={2} sx={{ display: { xs: 'none', md: 'block' } }}>
            <FormControl fullWidth>
              <InputLabel>{t('jobs.sortBy')}</InputLabel>
              <Select
                value={sortBy}
                label={t('jobs.sortBy')}
                onChange={(e) => {
                  const newSortBy = e.target.value;
                  setSortBy(newSortBy);
                  // If user selects "closest" and we don't have location yet, request it
                  if (newSortBy === 'closest' && !userLocation && locationPermission === 'prompt') {
                    // This onChange is a user gesture, so we can request location here
                    requestLocationPermission();
                  }
                }}
              >
                <MenuItem value="newest">{t('jobs.newestFirst')}</MenuItem>
                <MenuItem value="closest">{t('jobs.closestToMe')}</MenuItem>
                <MenuItem value="pay_desc">{t('jobs.payRateHighToLow')}</MenuItem>
              </Select>
            </FormControl>
          </Grid>
        </Grid>

        {/* Mobile Filter Panel - only shown when mobileFiltersOpen is true */}
        {isMobile && mobileFiltersOpen && (
          <Box sx={{ mt: 2, pt: 2, borderTop: '1px solid', borderColor: 'divider' }}>
            <Grid container spacing={2}>
              <Grid item xs={12}>
                <Autocomplete
                  fullWidth
                  size="small"
                  options={['all', ...getUniqueLocations()]}
                  getOptionLabel={(option) => (option === 'all' ? t('jobs.allLocations') : option)}
                  value={locationFilter}
                  onChange={(_, newValue) => setLocationFilter(newValue ?? 'all')}
                  renderInput={(params) => (
                    <TextField {...params} label={t('jobs.location')} placeholder={t('jobs.allLocations')} />
                  )}
                  isOptionEqualToValue={(option, value) => option === value}
                />
              </Grid>
              <Grid item xs={12}>
                <FormControl fullWidth>
                  <InputLabel>{t('jobs.jobType')}</InputLabel>
                  <Select
                    value={jobTypeFilter}
                    label={t('jobs.jobType')}
                    onChange={(e) => setJobTypeFilter(e.target.value)}
                  >
                    <MenuItem value="all">{t('jobs.allTypes')}</MenuItem>
                    <MenuItem value="gig">{t('jobs.gig')}</MenuItem>
                    <MenuItem value="career">{t('jobs.career')}</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12}>
                <FormControl fullWidth>
                  <InputLabel>{t('jobs.sortBy')}</InputLabel>
                  <Select
                    value={sortBy}
                    label={t('jobs.sortBy')}
                    onChange={(e) => {
                      const newSortBy = e.target.value;
                      setSortBy(newSortBy);
                      // If user selects "closest" and we don't have location yet, request it
                      if (newSortBy === 'closest' && !userLocation && locationPermission === 'prompt') {
                        // This onChange is a user gesture, so we can request location here
                        requestLocationPermission();
                      }
                    }}
                  >
                    <MenuItem value="newest">{t('jobs.newestFirst')}</MenuItem>
                    <MenuItem value="closest">{t('jobs.closestToMe')}</MenuItem>
                    <MenuItem value="pay_desc">{t('jobs.payRateHighToLow')}</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
            </Grid>
          </Box>
        )}

        <Box sx={{ mt: 2, display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
          {(searchTerm || locationFilter !== 'all' || jobTypeFilter !== 'all' || showFavoritesOnly || sortBy !== 'newest') && (
            <Button
              variant="text"
              size="small"
              onClick={() => {
                setSearchTerm('');
                setLocationFilter('all');
                setJobTypeFilter('all');
                setShowFavoritesOnly(false);
                setSortBy('newest');
              }}
            >
              {t('jobs.clearFilters')}
            </Button>
          )}
        </Box>
      </Paper>

      {filteredJobs.length === 0 ? (
        <Alert severity="info">
          {t('jobs.noJobsFound')}
        </Alert>
      ) : (
        <Grid container spacing={3} sx={{ px: 2, pb: 2 }}>
          {filteredJobs.map((job) => (
            <Grid item xs={12} md={6} key={`${job.tenantId}-${job.id}`}>
              {(() => {
                const jobDistanceLabel = getDistanceLabel(getJobDistanceMiles(job));
                const payLabel = formatHourlyPayRateForDisplay(job.payRate);
                return (
              <Card
                elevation={2}
                sx={{
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  transition: 'transform 0.2s, box-shadow 0.2s',
                  cursor: 'pointer',
                  position: 'relative',
                  '&:hover': {
                    transform: 'translateY(-4px)',
                    boxShadow: 4,
                  },
                }}
                onClick={() => handleCardClick(job)}
              >
                <CardContent sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
                  {/* Job Title and Bookmark on same line */}
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.75 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', flex: 1, gap: 1 }}>
                      <Typography
                        variant="h6"
                        component="h3"
                        sx={{
                          fontWeight: 700,
                          lineHeight: 1.25,
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                        }}
                      >
                        {job.postTitle}
                      </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      {user && (
                        <FavoriteButton
                          itemId={job.id}
                          favoriteType="jobPosts"
                          isFavorite={isFavorite}
                          toggleFavorite={toggleFavorite}
                          size="small"
                          tooltipText={{
                            favorited: t('jobs.removeFromFavorites'),
                            notFavorited: t('jobs.addToFavorites')
                          }}
                        />
                      )}
                      <IconButton
                        size="small"
                        aria-label={t('jobs.openJobDetails')}
                        onClick={(e) => {
                          e.stopPropagation();
                          navigateToJobDetails(job, 'grid_chevron');
                        }}
                      >
                        <ChevronRight fontSize="small" />
                      </IconButton>
                    </Box>
                  </Box>

                  {job.showPayRate && payLabel && (
                    <Box sx={{ mb: 1.25 }}>
                      <Typography variant="h6" sx={{ fontWeight: 800, fontSize: '1.2rem', color: 'success.dark' }}>
                        {payLabel}
                      </Typography>
                    </Box>
                  )}

                  <Box sx={{ display: 'flex', alignItems: 'flex-start', mb: 1 }}>
                    <LocationOn sx={{ fontSize: 18, mr: 1, color: 'text.secondary' }} />
                    <Box>
                      <Typography variant="body2" color="text.secondary">
                        {formatWorksiteCityStateZip(job.worksiteAddress) || 'Location TBD'}
                      </Typography>
                      {jobDistanceLabel ? (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
                          {jobDistanceLabel}
                        </Typography>
                      ) : null}
                    </Box>
                  </Box>

                  {(() => {
                    const applicationId = `${job.tenantId}_${job.id}`;
                    const hasApplied = userApplicationIds.includes(applicationId);
                    const isNew = (() => {
                      const createdAt = (job as any).createdAt;
                      if (!createdAt) return false;
                      const createdMs = createdAt?.toDate ? createdAt.toDate().getTime() : new Date(createdAt).getTime();
                      if (!Number.isFinite(createdMs)) return false;
                      return Date.now() - createdMs <= 7 * 24 * 60 * 60 * 1000;
                    })();
                    const tags: string[] = [];
                    if (hasApplied) tags.push(t('jobs.applicationStatusSubmitted'));
                    if (!hasApplied && isNew) tags.push(t('jobs.newLabel'));
                    if (!hasApplied && job.jobType === 'gig') tags.push(t('jobs.gig'));
                    return tags.length > 0 ? (
                      <Stack direction="row" spacing={0.75} sx={{ mb: 1.5 }} flexWrap="wrap" useFlexGap>
                        {tags.slice(0, 2).map((tag) => (
                          <Chip key={tag} label={tag} size="small" variant="outlined" sx={{ height: 24, fontSize: '0.72rem' }} />
                        ))}
                      </Stack>
                    ) : null;
                  })()}

                  {(() => {
                    const applicationId = `${job.tenantId}_${job.id}`;
                    const hasApplied = userApplicationIds.includes(applicationId);
                    const status = userApplicationStatuses[applicationId] || 'submitted';
                    const canReapply =
                      status === 'withdrawn' || status === 'cancelled' || status === 'deleted';
                    if (hasApplied && !canReapply) {
                      const buttonProps = getApplicationStatusButton(status);
                      return (
                        <Button
                          variant="contained"
                          fullWidth
                          onClick={(e) => e.stopPropagation()}
                          sx={{
                            mt: 'auto',
                            fontWeight: 700,
                            py: 1.1,
                            backgroundColor: buttonProps.backgroundColor,
                            color: buttonProps.color,
                            cursor: buttonProps.cursor,
                            pointerEvents: buttonProps.pointerEvents,
                            '&:hover': { backgroundColor: buttonProps.backgroundColor },
                          }}
                        >
                          {buttonProps.label}
                        </Button>
                      );
                    }
                    return (
                      <Button
                        variant="contained"
                        fullWidth
                        onClick={(e) => {
                          e.stopPropagation();
                          navigateToJobDetails(job, 'grid_card');
                        }}
                        sx={{ mt: 'auto', fontWeight: 700, py: 1.1 }}
                      >
                        {t('jobs.viewJob')}
                      </Button>
                    );
                  })()}
                </CardContent>
              </Card>
                );
              })()}
            </Grid>
          ))}
        </Grid>
      )}

      {/* Job Details Dialog */}
      <Dialog 
        open={dialogOpen} 
        onClose={handleCloseDialog}
        maxWidth="lg"
        fullWidth
        scroll="paper"
      >
        {selectedJob && (
          <>
            {/* Dialog Header */}
            <DialogTitle sx={{ pb: 1 }}>
              <Box sx={{ mb: 2, position: 'relative' }}>
                <>
                  <Typography variant="h4" component="h1" sx={{ fontWeight: 700, mb: 1 }}>
                    {selectedJob.postTitle}
                  </Typography>
                  
                  {/* Star Icon - Top Right */}
                  {user && (
                    <Box sx={{ position: 'absolute', top: 0, right: 0 }}>
                      <FavoriteButton
                        itemId={selectedJob.id}
                        favoriteType="jobPosts"
                        isFavorite={isFavorite}
                        toggleFavorite={toggleFavorite}
                        size="small"
                        sx={{
                          backgroundColor: 'background.paper',
                          border: 1,
                          borderColor: 'divider',
                        borderRadius: 1,
                        px: 2,
                        py: 1,
                        '&:hover': {
                          backgroundColor: 'action.hover'
                        }
                      }}
                    />
                    </Box>
                  )}
                  
                  <Stack spacing={1}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Typography variant="body1" sx={{ fontWeight: 500 }}>
                      {selectedJob.companyName}
                    </Typography>
                    {/* Hide pay rate for gig jobs with shifts - it's shown on individual shift cards instead */}
                    {selectedJob.showPayRate && !(selectedJob.jobType === 'gig' && selectedJobShifts.length > 0)
                      ? (() => {
                          const pl = formatHourlyPayRateForDisplay(selectedJob.payRate);
                          return pl ? (
                            <Typography variant="h6" color="primary" sx={{ fontWeight: 700, fontSize: '1.1rem' }}>
                              {pl}
                            </Typography>
                          ) : null;
                        })()
                      : null}
                  </Stack>
                  
                  {selectedJob.jobTitle && (
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Work sx={{ fontSize: 20, color: 'text.secondary' }} />
                      <Typography variant="body1">
                        {selectedJob.jobTitle}
                      </Typography>
                    </Stack>
                  )}
                  
                  <Stack direction="row" spacing={1} alignItems="center">
                    <LocationOn sx={{ fontSize: 20, color: 'text.secondary' }} />
                    <Box>
                      <Typography variant="body1">
                        {formatWorksiteCityStateZip(selectedJob.worksiteAddress) || 'Location TBD'}
                      </Typography>
                      {(() => {
                        const selectedDistanceLabel = getDistanceLabel(getJobDistanceMiles(selectedJob));
                        return selectedDistanceLabel ? (
                          <Typography variant="caption" color="text.secondary">
                            {selectedDistanceLabel}
                          </Typography>
                        ) : null;
                      })()}
                    </Box>
                  </Stack>
                  
                  {/* Schedule in Header */}
                  {(selectedJob.startDate || selectedJob.endDate || selectedJob.startTime || selectedJob.endTime || (selectedJob.jobType === 'gig' && selectedJobShifts.length > 0)) && (
                    <Stack spacing={1}>
                      {(() => {
                        // For gig jobs with shifts, show next shift date
                        if (selectedJob.jobType === 'gig' && selectedJobShifts.length > 0) {
                          const sortedShifts = [...selectedJobShifts].sort((a, b) => 
                            new Date(a.shiftDate).getTime() - new Date(b.shiftDate).getTime()
                          );
                          const nextShift = sortedShifts[0];
                          if (nextShift?.shiftDate) {
                            // Parse date in local time to avoid timezone issues
                            const dateStr = nextShift.shiftDate;
                            let displayDate = dateStr;
                            if (dateStr && dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
                              const [year, month, day] = dateStr.split('-').map(Number);
                              const date = new Date(year, month - 1, day);
                              displayDate = formatDateForDisplay(date);
                            } else {
                              displayDate = formatDateForDisplay(dateStr);
                            }
                            return (
                              <Stack direction="row" spacing={1} alignItems="center">
                                <Schedule sx={{ fontSize: 18, color: 'text.secondary' }} />
                                <Typography variant="body2" color="text.secondary">
                                  Next Shift: {displayDate}
                                </Typography>
                              </Stack>
                            );
                          }
                        }
                        // For non-gig jobs or gigs without shifts, show start date if available
                        if (selectedJob.startDate && selectedJob.showStart) {
                          return (
                            <Stack direction="row" spacing={1} alignItems="center">
                              <Schedule sx={{ fontSize: 18, color: 'text.secondary' }} />
                              <Typography variant="body2" color="text.secondary">
                                Start Date: {formatDateForDisplay(selectedJob.startDate)}
                              </Typography>
                            </Stack>
                          );
                        }
                        return null;
                      })()}
                      {selectedJob.endDate && selectedJob.showEnd && (
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Schedule sx={{ fontSize: 18, color: 'text.secondary' }} />
                          <Typography variant="body2" color="text.secondary">
                            End Date: {formatDateForDisplay(selectedJob.endDate)}
                          </Typography>
                        </Stack>
                      )}
                      {selectedJob.startTime && selectedJob.showStartTime && (
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Schedule sx={{ fontSize: 18, color: 'text.secondary' }} />
                          <Typography variant="body2" color="text.secondary">
                            Start Time: {selectedJob.startTime}
                          </Typography>
                        </Stack>
                      )}
                      {selectedJob.endTime && selectedJob.showEndTime && (
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Schedule sx={{ fontSize: 18, color: 'text.secondary' }} />
                          <Typography variant="body2" color="text.secondary">
                            End Time: {selectedJob.endTime}
                          </Typography>
                        </Stack>
                      )}
                    </Stack>
                  )}
                </Stack>
                </>
              </Box>
            </DialogTitle>

            {/* Tabs */}
            <Box sx={{ borderBottom: 1, borderColor: 'divider', px: 3 }}>
                <Tabs value={activeTab} onChange={(e, newValue) => setActiveTab(newValue)}>
                  <Tab label={t('jobs.jobDescription')} />
                  <Tab label={t('jobs.requirements')} />
                </Tabs>
            </Box>

            {/* Tab Content */}
            <DialogContent sx={{ px: 3, py: 4 }}>
              {/* Job Description Tab */}
              {activeTab === 0 && (
                <Stack spacing={4}>
                  {/* Job Description */}
                  <Box>
                    <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                      {getJobPostingDisplayText(selectedJob as any, 'jobDescription', displayLanguage) || selectedJob.jobDescription}
                    </Typography>
                  </Box>



                  {/* Shift Details */}
                  {selectedJob.shift && selectedJob.shift.length > 0 && selectedJob.showShift && (
                    <Box>
                      <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
                        <Work sx={{ fontSize: 20, mr: 1, verticalAlign: 'middle' }} />
                        Shift Details
                      </Typography>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                        {selectedJob.shift.map((shift, index) => (
                          <Chip key={index} label={shift} size="small" variant="outlined" />
                        ))}
                      </Box>
                    </Box>
                  )}

                  {/* Benefits */}
                  {selectedJob.benefits && (
                    <Box>
                      <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
                        Benefits
                      </Typography>
                      <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>
                        {selectedJob.benefits}
                      </Typography>
                    </Box>
                  )}
                </Stack>
              )}

              {/* Requirements Tab */}
              {activeTab === 1 && (
                <Stack spacing={4}>
                  {/* Skills */}
                  {selectedJob.skills && selectedJob.skills.length > 0 && selectedJob.showSkills && (
                    <Box>
                      <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
                        Required Skills
                      </Typography>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                        {selectedJob.skills.map((skill, index) => (
                          <Chip key={index} label={toChipLabel(skill)} size="small" variant="outlined" />
                        ))}
                      </Box>
                    </Box>
                  )}

                  {/* Licenses & Certifications */}
                  {selectedJob.licensesCerts && selectedJob.licensesCerts.length > 0 && selectedJob.showLicensesCerts && (
                    <Box>
                      <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
                        <Security sx={{ fontSize: 20, mr: 1, verticalAlign: 'middle' }} />
                        Licenses & Certifications
                      </Typography>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2 }}>
                        {selectedJob.licensesCerts.map((license, index) => (
                          <Chip key={index} label={license} size="small" variant="outlined" />
                        ))}
                      </Box>
                      
                      {/* Missing Certifications Warning - Only show after application submission */}
                      {user && (() => {
                        // Check if user has applied to this job
                        const applicationId = `${selectedJob.tenantId}_${selectedJob.id}`;
                        const hasApplied = userApplicationIds.includes(applicationId);
                        
                        // Only show warning if user has applied
                        if (!hasApplied) return null;
                        
                        const missingCerts = profileMissingCertList;
                        if (missingCerts.length > 0) {
                          return (
                            <Alert 
                              severity="warning" 
                              icon={<WarningIcon />}
                              sx={{ mt: 2 }}
                            >
                              <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
                                Missing Required Certification{missingCerts.length > 1 ? 's' : ''}
                              </Typography>
                              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                                Please upload {missingCerts.length === 1 ? 'this certification' : 'these certifications'} to your profile as soon as possible:
                              </Typography>
                              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                                {missingCerts.map((cert, index) => (
                                  <Chip 
                                    key={index} 
                                    label={cert} 
                                    size="small" 
                                    color="warning"
                                    variant="outlined"
                                  />
                                ))}
                              </Box>
                              <Button
                                variant="outlined"
                                size="small"
                                sx={{ mt: 1.5 }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  navigate('/profile?tab=licenses');
                                }}
                              >
                                Upload to Profile
                              </Button>
                            </Alert>
                          );
                        }
                        return null;
                      })()}
                    </Box>
                  )}

                  {/* Experience */}
                  {selectedJob.experienceLevels && selectedJob.experienceLevels.length > 0 && selectedJob.showExperience && (
                    <Box>
                      <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
                        <Person sx={{ fontSize: 20, mr: 1, verticalAlign: 'middle' }} />
                        Experience Requirements
                      </Typography>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                        {selectedJob.experienceLevels.map((experience, index) => (
                          <Chip key={index} label={experience} size="small" variant="outlined" />
                        ))}
                      </Box>
                    </Box>
                  )}

                  {/* Education */}
                  {selectedJob.educationLevels && selectedJob.educationLevels.length > 0 && selectedJob.showEducation && (
                    <Box>
                      <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
                        <School sx={{ fontSize: 20, mr: 1, verticalAlign: 'middle' }} />
                        Education Requirements
                      </Typography>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                        {selectedJob.educationLevels.map((education, index) => (
                          <Chip key={index} label={education} size="small" variant="outlined" />
                        ))}
                      </Box>
                    </Box>
                  )}

                  {/* Languages */}
                  {selectedJob.languages && selectedJob.languages.length > 0 && selectedJob.showLanguages && (
                    <Box>
                      <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
                        <Language sx={{ fontSize: 20, mr: 1, verticalAlign: 'middle' }} />
                        Language Requirements
                      </Typography>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                        {selectedJob.languages.map((language, index) => (
                          <Chip key={index} label={language} size="small" variant="outlined" />
                        ))}
                      </Box>
                    </Box>
                  )}

                  {/* Physical Requirements */}
                  {selectedJob.physicalRequirements && selectedJob.physicalRequirements.length > 0 && selectedJob.showPhysicalRequirements && (
                    <Box>
                      <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
                        <FitnessCenter sx={{ fontSize: 20, mr: 1, verticalAlign: 'middle' }} />
                        Physical Requirements
                      </Typography>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                        {selectedJob.physicalRequirements.map((requirement, index) => (
                          <Chip key={index} label={requirement} size="small" variant="outlined" />
                        ))}
                      </Box>
                    </Box>
                  )}

                  {/* Uniform Requirements */}
                  {selectedJob.uniformRequirements && selectedJob.uniformRequirements.length > 0 && selectedJob.showUniformRequirements && (
                    <Box>
                      <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
                        <Checkroom sx={{ fontSize: 20, mr: 1, verticalAlign: 'middle' }} />
                        Uniform Requirements
                      </Typography>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                        {selectedJob.uniformRequirements.map((uniform, index) => (
                          <Chip key={index} label={uniform} size="small" variant="outlined" />
                        ))}
                      </Box>
                    </Box>
                  )}

                  {/* Custom Uniform Requirements */}
                  {selectedJob.customUniformRequirements && selectedJob.customUniformRequirements.trim() && selectedJob.showCustomUniformRequirements && (
                    <Box>
                      <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
                        <Checkroom sx={{ fontSize: 20, mr: 1, verticalAlign: 'middle' }} />
                        Custom Uniform Requirements
                      </Typography>
                      <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>
                        {selectedJob.customUniformRequirements}
                      </Typography>
                    </Box>
                  )}

                  {/* Required PPE */}
                  {selectedJob.requiredPpe && selectedJob.requiredPpe.length > 0 && selectedJob.showRequiredPpe && (
                    <Box>
                      <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
                        <HealthAndSafety sx={{ fontSize: 20, mr: 1, verticalAlign: 'middle' }} />
                        Required PPE
                      </Typography>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                        {selectedJob.requiredPpe.map((ppe, index) => (
                          <Chip key={index} label={ppe} size="small" variant="outlined" />
                        ))}
                      </Box>
                    </Box>
                  )}

                  {selectedJob.showScreeningPackageOnPost &&
                    (String(selectedJob.screeningPackageName || '').trim() ||
                      (selectedJob.screeningPackageServiceNames &&
                        selectedJob.screeningPackageServiceNames.length > 0)) && (
                    <Box>
                      <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
                        <Security sx={{ fontSize: 20, mr: 1, verticalAlign: 'middle' }} />
                        Required screenings
                      </Typography>
                      {selectedJob.screeningPackageServiceNames &&
                      selectedJob.screeningPackageServiceNames.length > 0 ? (
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                          {selectedJob.screeningPackageServiceNames.map((svc, index) => (
                            <Chip key={index} label={svc} size="small" variant="outlined" />
                          ))}
                        </Box>
                      ) : (
                        <Typography variant="body2" color="text.secondary">
                          Background screening required for this role.
                        </Typography>
                      )}
                    </Box>
                  )}

                  {/* Background Checks (legacy) */}
                  {selectedJob.backgroundCheckPackages && selectedJob.backgroundCheckPackages.length > 0 && selectedJob.showBackgroundChecks && (
                    <Box>
                      <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
                        <Security sx={{ fontSize: 20, mr: 1, verticalAlign: 'middle' }} />
                        Background Check Requirements
                      </Typography>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                        {selectedJob.backgroundCheckPackages.map((check, index) => (
                          <Chip key={index} label={check} size="small" variant="outlined" />
                        ))}
                      </Box>
                    </Box>
                  )}

                  {/* Drug Screening */}
                  {selectedJob.drugScreeningPanels && selectedJob.drugScreeningPanels.length > 0 && selectedJob.showDrugScreening && (
                    <Box>
                      <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
                        <HealthAndSafety sx={{ fontSize: 20, mr: 1, verticalAlign: 'middle' }} />
                        Drug Screening Requirements
                      </Typography>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                        {selectedJob.drugScreeningPanels.map((panel, index) => (
                          <Chip key={index} label={panel} size="small" variant="outlined" />
                        ))}
                      </Box>
                    </Box>
                  )}

                  {/* Additional Screenings */}
                  {selectedJob.additionalScreenings && selectedJob.additionalScreenings.length > 0 && selectedJob.showAdditionalScreenings && (
                    <Box>
                      <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
                        <Build sx={{ fontSize: 20, mr: 1, verticalAlign: 'middle' }} />
                        Additional Screening Requirements
                      </Typography>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                        {selectedJob.additionalScreenings.map((screening, index) => (
                          <Chip key={index} label={screening} size="small" variant="outlined" />
                        ))}
                      </Box>
                    </Box>
                  )}

                  {/* E-Verify */}
                  {selectedJob.eVerifyRequired && (
                    <Box>
                      <Typography variant="body1" sx={{ fontWeight: 500, color: 'warning.main' }}>
                        E-Verify Required
                      </Typography>
                    </Box>
                  )}
                </Stack>
              )}

            </DialogContent>

            {/* Dialog Footer */}
            <DialogActions sx={{ px: 3, py: 2, borderTop: 1, borderColor: 'divider' }}>
              {/* E-Verify Image - Bottom Left */}
              {selectedJob.eVerifyRequired && (
                <Box sx={{ mr: 'auto' }}>
                  <img 
                    src="/img/everify.png" 
                    alt="E-Verify" 
                    style={{ 
                      height: '40px', 
                      width: 'auto',
                      objectFit: 'contain'
                    }} 
                  />
                </Box>
              )}
              
              <Button onClick={handleCloseDialog} sx={{ mr: 1 }}>
                Close
              </Button>
              {(() => {
                const applicationId = selectedJob ? `${selectedJob.tenantId}_${selectedJob.id}` : '';
                const hasApplied = userApplicationIds.includes(applicationId);
                
                if (hasApplied) {
                  const status = userApplicationStatuses[applicationId] || 'submitted';
                  // If application is withdrawn, cancelled, or removed by admin, show "Apply Now" button instead
                  if (status === 'withdrawn' || status === 'cancelled' || status === 'deleted') {
                    return (
                      <Button 
                        variant="contained" 
                        onClick={() => handleApply(selectedJob)}
                        sx={{ 
                          minWidth: 120,
                          backgroundColor: 'success.main',
                          '&:hover': {
                            backgroundColor: 'success.dark',
                          }
                        }}
                      >
                        {t('jobs.applyNow')}
                      </Button>
                    );
                  }
                  
                  const buttonProps = getApplicationStatusButton(status);
                  return (
                    <Button 
                      variant="contained" 
                      sx={{ 
                        minWidth: 120,
                        backgroundColor: buttonProps.backgroundColor,
                        color: buttonProps.color,
                        '&:hover': {
                          backgroundColor: buttonProps.backgroundColor,
                        },
                        cursor: buttonProps.cursor,
                        pointerEvents: buttonProps.pointerEvents,
                      }}
                    >
                      {buttonProps.label}
                    </Button>
                  );
                }
                
                return (
                  <Button 
                    variant="contained" 
                    onClick={() => handleApply(selectedJob)}
                    sx={{ 
                      minWidth: 120,
                      backgroundColor: 'success.main',
                      '&:hover': {
                        backgroundColor: 'success.dark',
                      }
                    }}
                  >
                    {t('jobs.applyNow')}
                  </Button>
                );
              })()}
            </DialogActions>
          </>
        )}
      </Dialog>

      {/* Authentication Dialog */}
      <AuthDialog
        open={authDialogOpen}
        onClose={() => setAuthDialogOpen(false)}
        onAuthSuccess={() => {
          // Page will automatically update due to auth state change
          // No need for manual refresh
        }}
        initialPreferredLanguage={guestLanguage}
      />

      {/* Eligibility Verification Modal */}
      <EligibilityModal
        open={eligibilityModalOpen.open}
        onClose={() => setEligibilityModalOpen({ open: false, needDOB: false, needPhone: false, jobId: null })}
        onComplete={() => {
          // User has completed verification, proceed with application
          const jobId = eligibilityModalOpen.jobId;
          setEligibilityModalOpen({ open: false, needDOB: false, needPhone: false, jobId: null });
          
          if (jobId) {
            // Find the job and navigate to application
            const job = jobs.find(j => j.id === jobId);
            if (job) {
              navigate(`/apply/${job.tenantId}/${job.id}`);
            }
          }
        }}
        needDOB={eligibilityModalOpen.needDOB}
        needPhone={eligibilityModalOpen.needPhone}
        jobId={eligibilityModalOpen.jobId || undefined}
      />
    </>
  );

  // If user is logged in, return content without Container (Layout will handle it)
  // If user is not logged in, wrap in Container for proper spacing
  return user ? mainContent : (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      {mainContent}
    </Container>
  );
};

export default PublicJobsBoard;
