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
} from '@mui/icons-material';
import { collection, query, where, getDocs, orderBy, doc, getDoc } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { useNavigate, useLocation } from 'react-router-dom';
import { JobsBoardService, JobsBoardPost } from '../services/recruiter/jobsBoardService';
import { useAuth } from '../contexts/AuthContext';
import { useFavorites, useFavoritesFilter } from '../hooks/useFavorites';
import FavoriteButton from '../components/FavoriteButton';
import FavoritesFilter from '../components/FavoritesFilter';
import Layout from '../components/Layout';
import AuthDialog from '../components/AuthDialog';
import EligibilityModal from '../components/EligibilityModal';
import { checkMissingCertifications } from '../utils/checkMissingCertifications';

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
  const [eligibilityModalOpen, setEligibilityModalOpen] = useState({
    open: false,
    needDOB: false,
    needPhone: false,
    jobId: null as string | null
  });
  
  // Favorites system
  const { favorites, isFavorite, toggleFavorite } = useFavorites('jobPosts');
  
  // Track user's application IDs for showing "Application Submitted"
  const [userApplicationIds, setUserApplicationIds] = useState<string[]>([]);
  const [userApplicationStatuses, setUserApplicationStatuses] = useState<Record<string, string>>({}); // Map of applicationId -> status
  const [userGroupIds, setUserGroupIds] = useState<string[]>([]);
  const [userCertifications, setUserCertifications] = useState<Array<{ name?: string }>>([]);
  
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
      } catch (error) {
        console.error('Error loading user data:', error);
      }
    };
    loadUserData();
  }, [user?.uid]);

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
      showWorkersNeeded: jobOrder.showWorkersNeeded !== false, // Default to true if not set
      eVerifyRequired: jobOrder.eVerifyRequired || false,
      backgroundCheckPackages: jobOrder.backgroundCheckPackages || [],
      showBackgroundChecks: false,
      drugScreeningPanels: jobOrder.drugScreeningPanels || [],
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
      jobOrderId: jobOrder.id
    };
  };

  const loadPublicJobs = async () => {
    console.log('🚀 loadPublicJobs called, specificTenantId:', specificTenantId);
    try {
      setLoading(true);
      const jobsBoardService = JobsBoardService.getInstance();
      
      const allJobs: PublicJobPosting[] = [];

      if (specificTenantId) {
        console.log('🔍 Loading jobs for specific tenant:', specificTenantId);
        // If we're on the C1 route, load all jobs from the specific tenant (will filter by visibility client-side)
        try {
          // Load public, restricted, and private jobs (client-side filtering will handle visibility)
          console.log('🔍 Loading job_postings for tenant:', specificTenantId);
          const [publicPosts, restrictedPosts] = await Promise.all([
            jobsBoardService.getPostsByVisibility(specificTenantId, 'public'),
            jobsBoardService.getPostsByVisibility(specificTenantId, 'restricted')
          ]);
          
          console.log('🔍 Loaded', publicPosts.length, 'public posts and', restrictedPosts.length, 'restricted posts');
          const allPosts = [...publicPosts, ...restrictedPosts];
          
          // Filter for active posts only
          const activePosts = allPosts.filter(post => post.status === 'active');
          console.log('🔍 Active posts after filtering:', activePosts.length);
          
          // Get job order IDs that already have postings (to avoid duplicates)
          const jobOrderIdsWithPostings = new Set(
            activePosts
              .filter(post => post.jobOrderId)
              .map(post => post.jobOrderId!)
          );
          
          // Load Gig job orders that don't have postings
          console.log('🔍 Loading gig job orders for tenant:', specificTenantId);
          const gigJobOrdersRef = collection(db, 'tenants', specificTenantId, 'job_orders');
          const gigJobOrdersQuery = query(
            gigJobOrdersRef,
            where('jobType', '==', 'gig'),
            where('status', '==', 'open')
          );
          const gigJobOrdersSnapshot = await getDocs(gigJobOrdersQuery);
          console.log('🔍 Found', gigJobOrdersSnapshot.docs.length, 'gig job orders');
          
          const gigJobOrders: PublicJobPosting[] = [];
          // Fetch location data for job orders that need it
          const locationPromises = gigJobOrdersSnapshot.docs.map(async (jobOrderDoc) => {
            const jobOrderData = jobOrderDoc.data();
            const jobOrderId = jobOrderDoc.id;
            console.log('🔍 Processing job order:', jobOrderId, 'Name:', jobOrderData.jobOrderName, 'worksiteId:', jobOrderData.worksiteId);
            
            // Skip if this job order already has a posting
            if (jobOrderIdsWithPostings.has(jobOrderId)) {
              console.log('⏭️ Skipping job order', jobOrderId, 'because it already has a posting');
              return null;
            }
            console.log('✅ Job order', jobOrderId, 'does not have existing posting, continuing...');
            
            // Check visibility - only include public or restricted
            const visibility = jobOrderData.jobsBoardVisibility || jobOrderData.visibility || 'public';
            console.log('🔍 Job order', jobOrderId, 'visibility:', visibility);
            if (visibility !== 'public' && visibility !== 'restricted') {
              console.log('⏭️ Skipping job order', jobOrderId, 'because visibility is', visibility);
              return null;
            }
            console.log('✅ Job order', jobOrderId, 'has valid visibility');
            
            // Log the job order data to debug
            console.log('🔍 Job order data:', {
              id: jobOrderId,
              worksiteAddress: jobOrderData.worksiteAddress,
              worksiteName: jobOrderData.worksiteName,
              worksiteId: jobOrderData.worksiteId,
              companyId: jobOrderData.companyId
            });
            
            // Always try to fetch location data from worksite document if worksiteId exists
            // Path: tenants/{tenantId}/locations/{worksiteId}
            console.log('🔍 Checking if worksiteId exists. Type:', typeof jobOrderData.worksiteId, 'Value:', jobOrderData.worksiteId);
            if (jobOrderData.worksiteId) {
              console.log('✅ WorksiteId exists, fetching location for:', jobOrderData.worksiteId);
              try {
                const locationRef = doc(db, 'tenants', specificTenantId, 'locations', jobOrderData.worksiteId);
                console.log('🔍 Attempting to fetch location at path:', locationRef.path);
                const locationSnap = await getDoc(locationRef);
                console.log('🔍 Location document exists?', locationSnap.exists());
                
                if (locationSnap.exists()) {
                  const locationData = locationSnap.data() as any;
                  console.log('✅ Fetched location document:', locationData);
                  console.log('✅ Location address field:', locationData.address);
                  
                  // Initialize worksiteAddress if it doesn't exist
                  if (!jobOrderData.worksiteAddress) {
                    jobOrderData.worksiteAddress = {};
                  }
                  
                  // The location document has an 'address' field with city, state, street, zipCode, and coordinates
                  const locAddress = locationData.address || {};
                  
                  // Merge location address data into job order, preferring existing values
                  if (!jobOrderData.worksiteAddress.city && locAddress.city) {
                    jobOrderData.worksiteAddress.city = locAddress.city;
                  }
                  if (!jobOrderData.worksiteAddress.state && locAddress.state) {
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
                  
                  console.log('✅ Updated worksiteAddress:', jobOrderData.worksiteAddress);
                } else {
                  console.warn(`❌ Location document not found for worksiteId: ${jobOrderData.worksiteId} at path: tenants/${specificTenantId}/locations/${jobOrderData.worksiteId}`);
                }
              } catch (locationErr) {
                console.error(`❌ Error fetching location for job order ${jobOrderId} (worksiteId: ${jobOrderData.worksiteId}):`, locationErr);
              }
            } else {
              console.warn(`❌ Job order ${jobOrderId} (${jobOrderData.jobOrderName}) missing worksiteId`);
            }
            
            console.log('🔍 Converting job order to posting, final worksiteAddress:', jobOrderData.worksiteAddress);
            const converted = convertJobOrderToPosting({ ...jobOrderData, id: jobOrderId }, specificTenantId);
            console.log('🔍 Converted posting worksiteAddress:', converted.worksiteAddress);
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
            
            // If posting doesn't have worksiteId but has jobOrderId, fetch it from the job order
            if (!worksiteId && (post as any).jobOrderId) {
              try {
                console.log('🔍 Posting', post.id, 'missing worksiteId, fetching from jobOrderId:', (post as any).jobOrderId);
                const jobOrderRef = doc(db, 'tenants', specificTenantId, 'job_orders', (post as any).jobOrderId);
                const jobOrderSnap = await getDoc(jobOrderRef);
                if (jobOrderSnap.exists()) {
                  const jobOrderData = jobOrderSnap.data();
                  worksiteId = jobOrderData.worksiteId;
                  console.log('✅ Got worksiteId from job order:', worksiteId);
                }
              } catch (err) {
                console.warn('❌ Failed to fetch job order for posting', post.id, ':', err);
              }
            }
            
            // Now fetch location if we have worksiteId and location data is missing
            if ((!worksiteAddress || !worksiteAddress.city || !worksiteAddress.state) && worksiteId) {
              try {
                console.log('🔍 Posting', post.id, 'missing location data, fetching from worksiteId:', worksiteId);
                const locationRef = doc(db, 'tenants', specificTenantId, 'locations', worksiteId);
                console.log('🔍 Fetching location from path:', locationRef.path);
                const locationSnap = await getDoc(locationRef);
                console.log('🔍 Location document exists?', locationSnap.exists());
                
                if (locationSnap.exists()) {
                  const locationData = locationSnap.data() as any;
                  console.log('✅ Fetched location document:', locationData);
                  console.log('✅ Location address field:', locationData.address);
                  
                  const locAddress = locationData.address || {};
                  if (!worksiteAddress) {
                    worksiteAddress = {};
                  }
                  if (!worksiteAddress.city && locAddress.city) {
                    worksiteAddress.city = locAddress.city;
                  }
                  if (!worksiteAddress.state && locAddress.state) {
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
                  console.log('✅ Updated posting', post.id, 'worksiteAddress:', worksiteAddress);
                } else {
                  console.warn('❌ Location document not found for worksiteId:', worksiteId, 'at path:', locationRef.path);
                }
              } catch (err) {
                console.error('❌ Error fetching location for posting', post.id, ':', err);
              }
            } else if (!worksiteId) {
              console.warn('⚠️ Posting', post.id, 'has no worksiteId and no jobOrderId to fetch it from');
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
            startDate: post.startDate,
            endDate: post.endDate,
            expDate: post.expDate,
            showStart: post.showStart,
            showEnd: post.showEnd,
            payRate: post.payRate,
            showPayRate: post.showPayRate,
            workersNeeded: post.workersNeeded,
            showWorkersNeeded: post.showWorkersNeeded !== false, // Default to true if not set
            eVerifyRequired: post.eVerifyRequired,
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
            jobOrderId: post.jobOrderId
          };
        });
        
        const convertedPosts = await Promise.all(convertedPostsPromises);
          
        // Combine postings and gig job orders (postings take precedence for duplicates)
        allJobs.push(...convertedPosts, ...gigJobOrders);
        } catch (err) {
          console.error(`Failed to load jobs for specific tenant ${specificTenantId}:`, err);
        }
      } else {
        // Original behavior: Query all tenants for public job postings
        const tenantsSnapshot = await getDocs(collection(db, 'tenants'));

        for (const tenantDoc of tenantsSnapshot.docs) {
          const tenantId = tenantDoc.id;
          
          try {
            // Use the JobsBoardService to get public posts
            const publicPosts = await jobsBoardService.getPostsByVisibility(tenantId, 'public');
            
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
                    console.log('🔍 Job Order worksiteId:', jobOrderData.worksiteId);
                    const locationRef = doc(db, 'tenants', tenantId, 'locations', jobOrderData.worksiteId);
                    console.log('🔍 Location path:', locationRef.path);
                    const locationSnap = await getDoc(locationRef);
                    
                    if (locationSnap.exists()) {
                      const locationData = locationSnap.data() as any;
                      console.log('✅ Fetched location document:', locationData);
                      console.log('✅ Location address field:', locationData.address);
                      
                      // Initialize worksiteAddress if it doesn't exist
                      if (!jobOrderData.worksiteAddress) {
                        jobOrderData.worksiteAddress = {};
                      }
                      
                      // The location document has an 'address' field with city, state, street, zipCode, and coordinates
                      const locAddress = locationData.address || {};
                      
                      // Merge location address data into job order, preferring existing values
                      if (!jobOrderData.worksiteAddress.city && locAddress.city) {
                        jobOrderData.worksiteAddress.city = locAddress.city;
                      }
                      if (!jobOrderData.worksiteAddress.state && locAddress.state) {
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
                      
                      console.log('Updated worksiteAddress:', jobOrderData.worksiteAddress);
                    } else {
                      console.warn(`❌ Location document not found for worksiteId: ${jobOrderData.worksiteId}`);
                    }
                  } catch (locationErr) {
                    console.warn(`❌ Failed to fetch location for job order ${jobOrderId} (worksiteId: ${jobOrderData.worksiteId}):`, locationErr);
                  }
                } else {
                  console.warn(`❌ Job order ${jobOrderId} missing worksiteId`);
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
            
            // Convert to PublicJobPosting format
            const convertedPosts: PublicJobPosting[] = activePosts.map(post => ({
              id: post.id,
              tenantId: post.tenantId,
              postTitle: post.postTitle,
              jobTitle: post.jobTitle,
              jobType: post.jobType,
              jobDescription: post.jobDescription,
              companyName: post.companyName,
              worksiteName: post.worksiteName,
              worksiteAddress: post.worksiteAddress,
              startDate: post.startDate,
              endDate: post.endDate,
              expDate: post.expDate,
              showStart: post.showStart,
              showEnd: post.showEnd,
              payRate: post.payRate,
              showPayRate: post.showPayRate,
              workersNeeded: post.workersNeeded,
            showWorkersNeeded: post.showWorkersNeeded !== false, // Default to true if not set
              eVerifyRequired: post.eVerifyRequired,
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
            }));
            
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
      filtered = filtered.filter(
        (job) =>
          job.postTitle.toLowerCase().includes(searchTerm.toLowerCase()) ||
          (job.jobTitle && job.jobTitle.toLowerCase().includes(searchTerm.toLowerCase())) ||
          job.jobDescription.toLowerCase().includes(searchTerm.toLowerCase()) ||
          job.worksiteName.toLowerCase().includes(searchTerm.toLowerCase()) ||
          job.companyName.toLowerCase().includes(searchTerm.toLowerCase()) ||
          (job.skills && job.skills.some(skill => skill.toLowerCase().includes(searchTerm.toLowerCase())))
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
      if (job.worksiteAddress?.city && job.worksiteAddress?.state) {
        locations.add(`${job.worksiteAddress.city}, ${job.worksiteAddress.state}`);
      }
      // Skip jobs without proper city/state (they won't be filterable by location)
    });
    return Array.from(locations).sort();
  };


  const handleApply = async (job: PublicJobPosting) => {
    // Check if user is logged in
    const currentUser = auth.currentUser;
    if (!currentUser) {
      setAuthDialogOpen(true);
      return;
    }

    try {
      // Check user eligibility
      const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
      const userData = userDoc.data();

      const needDOB = !userData?.dob;
      const needPhone = !userData?.phoneVerified;

      // If either verification is missing or workEligibility is false, show modal
      if (needDOB || needPhone || !userData?.workEligibility) {
        setEligibilityModalOpen({
          open: true,
          needDOB,
          needPhone,
          jobId: job.id
        });
        return;
      }

      // User is eligible, proceed with application
      navigate(`/apply/${job.tenantId}/${job.id}`);
    } catch (error) {
      console.error('Error checking eligibility:', error);
      // Fallback to auth dialog
      setAuthDialogOpen(true);
    }
  };

  const handleCardClick = (job: PublicJobPosting) => {
    // Navigate to dedicated job posting detail page
    navigate(`/c1/jobs-board/${job.id}`);
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
          30
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

  // Helper function to get application status button label and styling
  const getApplicationStatusButton = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'hired':
        return {
          label: 'Hired',
          backgroundColor: '#4CAF50', // Green
          color: '#fff',
          cursor: 'default',
          pointerEvents: 'none' as const
        };
      case 'rejected':
      case 'not accepted':
        return {
          label: 'Not Accepted',
          backgroundColor: '#F44336', // Red
          color: '#fff',
          cursor: 'default',
          pointerEvents: 'none' as const
        };
      case 'withdrawn':
      case 'cancelled':
        return {
          label: 'Cancelled',
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
          label: 'Accepted',
          backgroundColor: '#2196F3', // Blue
          color: '#fff',
          cursor: 'default',
          pointerEvents: 'none' as const
        };
      case 'submitted':
      case 'new':
      default:
        return {
          label: 'Application Submitted',
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
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              {/* C1 Logo - Left side */}
              {isC1Route && (
                <Box
                  component="img"
                  src="/C1.png" 
                  alt="C1 Staffing" 
                  sx={{ 
                    height: { xs: '40px', sm: '50px', md: '64px' }, // Responsive height
                    width: 'auto',
                    objectFit: 'contain'
                  }}
                  onError={(e: any) => {
                    // Fallback if logo doesn't exist yet
                    e.currentTarget.style.display = 'none';
                  }}
                />
              )}
              
              {/* Main Page Title - Next to logo */}
              <Typography 
                variant="h3" 
                sx={{ 
                  fontWeight: 700,
                  fontSize: { xs: '1.5rem', sm: '2rem', md: '3rem' } // Responsive font size
                }}
              >
                {isC1Route ? 'Jobs Board' : 'Find Your Next Opportunity'}
              </Typography>
            </Box>

            {/* Sign In or Create Account Button - Top right */}
            <Button
              variant="contained"
              onClick={() => setAuthDialogOpen(true)}
              sx={{
                px: { xs: 2, sm: 3 }, // Smaller padding on mobile
                py: { xs: 1, sm: 1.5 }, // Smaller padding on mobile
                fontWeight: 600,
                borderRadius: 2,
                textTransform: 'none',
                fontSize: { xs: '0.875rem', sm: '1rem' } // Smaller font on mobile
              }}
            >
              Sign In or Create Account
            </Button>
          </Box>
        </Box>
      )}

      {/* Search and Filters */}
      <Paper elevation={1} sx={{ p: 3, mb: 3 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} md={6}>
            <TextField
              fullWidth
              placeholder="Search jobs by title, location, or description..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <Search />
                  </InputAdornment>
                ),
                endAdornment: user ? (
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
                          backgroundColor: showFavoritesOnly ? 'primary.dark' : 'action.hover'
                        }
                      }}
                    />
                  </InputAdornment>
                ) : undefined,
              }}
            />
          </Grid>
          <Grid item xs={12} md={2}>
            <FormControl fullWidth>
              <InputLabel>Location</InputLabel>
              <Select
                value={locationFilter}
                label="Location"
                onChange={(e) => setLocationFilter(e.target.value)}
              >
                <MenuItem value="all">All Locations</MenuItem>
                {getUniqueLocations().map((location) => (
                  <MenuItem key={location} value={location}>
                    {location}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={2}>
            <FormControl fullWidth>
              <InputLabel>Job Type</InputLabel>
              <Select
                value={jobTypeFilter}
                label="Job Type"
                onChange={(e) => setJobTypeFilter(e.target.value)}
              >
                <MenuItem value="all">All Types</MenuItem>
                <MenuItem value="gig">Gig</MenuItem>
                <MenuItem value="career">Career</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={2}>
            <FormControl fullWidth>
              <InputLabel>Sort By</InputLabel>
              <Select
                value={sortBy}
                label="Sort By"
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
                <MenuItem value="newest">Newest First</MenuItem>
                <MenuItem value="closest">Closest to Me</MenuItem>
              </Select>
            </FormControl>
          </Grid>
        </Grid>
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
              Clear Filters
            </Button>
          )}
        </Box>
      </Paper>

      {/* Jobs Grid */}
      {filteredJobs.length === 0 ? (
        <Alert severity="info">
          No jobs found matching your criteria. Try adjusting your filters or search terms.
        </Alert>
      ) : (
        <Grid container spacing={3}>
          {filteredJobs.map((job) => (
            <Grid item xs={12} md={6} key={`${job.tenantId}-${job.id}`}>
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
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', flex: 1, gap: 1 }}>
                      <Typography variant="h6" component="h3" sx={{ fontWeight: 600 }}>
                        {job.postTitle}
                      </Typography>
                      {job.jobType === 'gig' && (
                        <Chip
                          icon={<Event sx={{ fontSize: 16 }} />}
                          label="Gig"
                          size="small"
                          color="primary"
                          sx={{ 
                            height: 24,
                            fontSize: '0.75rem',
                            fontWeight: 500
                          }}
                        />
                      )}
                    </Box>
                    {user && (
                      <FavoriteButton
                        itemId={job.id}
                        favoriteType="jobPosts"
                        isFavorite={isFavorite}
                        toggleFavorite={toggleFavorite}
                        size="small"
                        tooltipText={{
                          favorited: 'Remove from favorites',
                          notFavorited: 'Add to favorites'
                        }}
                      />
                    )}
                  </Box>

                  {/* Hide pay rate for gig jobs - it's shown on individual shift cards instead */}
                  {job.payRate && job.showPayRate && job.jobType !== 'gig' && (
                    <Box sx={{ mb: 2 }}>
                      <Typography variant="h6" color="primary" sx={{ fontWeight: 700, fontSize: '1.1rem' }}>
                        ${job.payRate}/hr
                      </Typography>
                    </Box>
                  )}

                  <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                    <Typography variant="body2" color="text.secondary">
                      {job.companyName}
                    </Typography>
                  </Box>

                  {job.jobTitle && (
                    <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                      <Work sx={{ fontSize: 18, mr: 1, color: 'text.secondary' }} />
                      <Typography variant="body2" color="text.secondary">
                        {job.jobTitle}
                      </Typography>
                    </Box>
                  )}

                  <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                    <LocationOn sx={{ fontSize: 18, mr: 1, color: 'text.secondary' }} />
                    <Typography variant="body2" color="text.secondary">
                      {job.worksiteAddress?.city && job.worksiteAddress?.state ? (
                        `${job.worksiteAddress.city}, ${job.worksiteAddress.state}${job.worksiteAddress.zipCode ? ` ${job.worksiteAddress.zipCode}` : ''}`
                      ) : job.worksiteName ? (
                        job.worksiteName
                      ) : (
                        'Location TBD'
                      )}
                    </Typography>
                  </Box>

                  {/* For Gig jobs with shifts, show Next Shift; otherwise show Start Date */}
                  {job.jobType === 'gig' && (job as any).nextShiftDate ? (
                    <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                      <Schedule sx={{ fontSize: 18, mr: 1, color: 'text.secondary' }} />
                      <Typography variant="body2" color="text.secondary">
                        Next Shift: {formatDateForDisplay((job as any).nextShiftDate)}
                      </Typography>
                    </Box>
                  ) : (
                    job.startDate && job.showStart && (
                      <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                        <Schedule sx={{ fontSize: 18, mr: 1, color: 'text.secondary' }} />
                        <Typography variant="body2" color="text.secondary">
                          Starts: {formatDateForDisplay(job.startDate)}
                        </Typography>
                      </Box>
                    )
                  )}

                  {job.shift && job.shift.length > 0 && job.showShift && (
                    <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                      <Build sx={{ fontSize: 18, mr: 1, color: 'text.secondary' }} />
                      <Typography variant="body2" color="text.secondary">
                        {job.shift.slice(0, 2).join(', ')}
                        {job.shift.length > 2 && ` +${job.shift.length - 2} more`}
                      </Typography>
                    </Box>
                  )}

                  {/* Missing Certifications Warning - Only show after application submission */}
                  {user && job.licensesCerts && job.licensesCerts.length > 0 && job.showLicensesCerts && (() => {
                    // Check if user has applied to this job
                    const applicationId = `${job.tenantId}_${job.id}`;
                    const hasApplied = userApplicationIds.includes(applicationId);
                    
                    // Only show warning if user has applied
                    if (!hasApplied) return null;
                    
                    const missingCerts = checkMissingCertifications(job.licensesCerts, userCertifications);
                    if (missingCerts.length > 0) {
                      return (
                        <Alert 
                          severity="warning" 
                          icon={<WarningIcon />}
                          sx={{ 
                            mb: 2,
                            mt: 1,
                            '& .MuiAlert-message': {
                              fontSize: '0.875rem',
                              width: '100%'
                            }
                          }}
                          action={
                            <Button
                              size="small"
                              color="inherit"
                              onClick={(e) => {
                                e.stopPropagation();
                                navigate('/profile?tab=licenses');
                              }}
                              sx={{ 
                                textTransform: 'none',
                                fontSize: '0.75rem',
                                minWidth: 'auto',
                                px: 1
                              }}
                            >
                              Upload
                            </Button>
                          }
                        >
                          <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
                            Missing Required Certification{missingCerts.length > 1 ? 's' : ''}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            Please upload {missingCerts.length === 1 ? 'this certification' : 'these certifications'} to your profile: {missingCerts.slice(0, 2).join(', ')}{missingCerts.length > 2 ? ` +${missingCerts.length - 2} more` : ''}
                          </Typography>
                        </Alert>
                      );
                    }
                    return null;
                  })()}



                  <Box sx={{ mt: 'auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    {/* E-Verify in footer (left side) */}
                    {job.eVerifyRequired && (
                      <img 
                        src="/img/everify.png" 
                        alt="E-Verify" 
                        style={{ 
                          height: '30px', 
                          width: 'auto',
                          objectFit: 'contain'
                        }}
                      />
                    )}
                    
                    {/* Apply Now or Application Status button (right side, half width) */}
                    {(() => {
                      // For gig jobs, always show "Apply Now" - status is handled per shift in detail view
                      if (job.jobType === 'gig') {
                        return (
                          <Button 
                            variant="contained" 
                            sx={{ 
                              width: '50%',
                              ml: 'auto'
                            }} 
                            onClick={(e) => {
                              e.stopPropagation(); // Prevent card click
                              handleCardClick(job);
                            }}
                          >
                            Apply Now
                          </Button>
                        );
                      }
                      
                      // For non-gig jobs, show status if user has applied
                      const applicationId = `${job.tenantId}_${job.id}`;
                      const hasApplied = userApplicationIds.includes(applicationId);
                      
                      if (hasApplied) {
                        const status = userApplicationStatuses[applicationId] || 'submitted';
                        // If application is withdrawn or cancelled, show "Apply Now" button instead
                        if (status === 'withdrawn' || status === 'cancelled') {
                          return (
                            <Button 
                              variant="contained" 
                              sx={{ 
                                width: '50%',
                                ml: 'auto'
                              }} 
                              onClick={(e) => {
                                e.stopPropagation(); // Prevent card click
                                handleApply(job);
                              }}
                            >
                              Apply Now
                            </Button>
                          );
                        }
                        
                        const buttonProps = getApplicationStatusButton(status);
                        return (
                          <Button 
                            variant="contained" 
                            sx={{ 
                              width: '50%',
                              ml: 'auto',
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
                          sx={{ 
                            width: '50%',
                            ml: 'auto'
                          }} 
                          onClick={(e) => {
                            e.stopPropagation(); // Prevent card click
                            handleApply(job);
                          }}
                        >
                          Apply Now
                        </Button>
                      );
                    })()}
                  </Box>
                </CardContent>
              </Card>
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
                    {selectedJob.payRate && selectedJob.showPayRate && !(selectedJob.jobType === 'gig' && selectedJobShifts.length > 0) && (
                      <Typography variant="h6" color="primary" sx={{ fontWeight: 700, fontSize: '1.1rem' }}>
                        ${selectedJob.payRate}/hr
                      </Typography>
                    )}
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
                    <Typography variant="body1">
                      {selectedJob.worksiteAddress?.city && selectedJob.worksiteAddress?.state ? (
                        `${selectedJob.worksiteAddress.city}, ${selectedJob.worksiteAddress.state}${selectedJob.worksiteAddress.zipCode ? ` ${selectedJob.worksiteAddress.zipCode}` : ''}`
                      ) : (
                        selectedJob.worksiteName
                      )}
                    </Typography>
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
                  <Tab label="Job Description" />
                  <Tab label="Requirements" />
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
                      {selectedJob.jobDescription}
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
                          <Chip key={index} label={skill} size="small" variant="outlined" />
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
                        
                        const missingCerts = checkMissingCertifications(selectedJob.licensesCerts, userCertifications);
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

                  {/* Background Checks */}
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
                  // If application is withdrawn or cancelled, show "Apply Now" button instead
                  if (status === 'withdrawn' || status === 'cancelled') {
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
                        Apply Now
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
                    Apply Now
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
