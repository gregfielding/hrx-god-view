import React, { useEffect, useState } from 'react';
import { toChipLabel } from '../../../utils/chipLabel';
import {
  Box,
  TextField,
  Typography,
  Button,
  Snackbar,
  Alert,
  Grid,
  MenuItem,
  FormControl,
  InputLabel,
  Select,
  Chip,
  Autocomplete,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  DialogContentText,
  FormControlLabel,
  Switch,
  Card,
  CardContent,
  CardHeader,
  IconButton,
  InputAdornment,
  Stack,
  Link as MUILink,
  Tooltip,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import {
  Person as PersonIcon,
  Work as WorkIcon,
  Business as BusinessIcon,
  ContactEmergency as EmergencyIcon,
  Security as SecurityIcon,
  LocationOnOutlined as LocationOnOutlinedIcon,
  CheckCircle as CheckCircleIcon,
  DirectionsCar,
  DirectionsTransit,
  DirectionsBike,
  DirectionsWalk,
  MoreHoriz,
  Edit as EditIcon,
  Email as EmailIcon,
  Phone as PhoneIcon,
  CalendarToday as CalendarIcon,
  Language as LanguageIcon,
  AccountBox as AccountBoxIcon,
  LocalPhone as LocalPhoneIcon,
  ContentCopy as ContentCopyIcon,
} from '@mui/icons-material';
import type { SvgIconComponent } from '@mui/icons-material';
import { doc, getDoc, onSnapshot, updateDoc, collection, getDocs, query, where } from 'firebase/firestore';
import { sendPasswordResetEmail } from 'firebase/auth';

import { db , auth } from '../../../firebase';
import { formatPhoneNumber } from '../../../utils/formatPhone';
import { logProfileUpdateActivity, logSecurityChangeActivity } from '../../../utils/activityLogger';
import { persistScoreSummaryFromProfile } from '../../../utils/persistScoreSummaryFromProfile';
import { useAuth } from '../../../contexts/AuthContext';
import { UserProfileForm, EmergencyContact } from '../../../types/UserProfile';

import AddressFormFields from './AddressTab/AddressFormFields';
import MapWithMarkers from './AddressTab/MapWithMarkers';
import { EverifyComplianceCard } from './EverifyComplianceCard';

type Props = {
  uid: string;
  onTabChange?: (tab: string) => void;
};

const ProfileOverview: React.FC<Props> = ({ uid, onTabChange }) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const sectionSpacing = isMobile ? 2 : 3;
  const cardPadding = isMobile ? 1 : 3;
  const cardContentPadding = isMobile ? 1.5 : 2;
  const cardHeaderPadding = isMobile ? { px: 1.5, py: 1 } : undefined;
  const coerceToDate = (value: any): Date | null => {
    if (!value) return null;
    try {
      // Firestore Timestamp
      if (typeof value?.toDate === 'function') return value.toDate();
      // ISO string or date string
      if (typeof value === 'string') {
        // NOTE: For date-only strings like YYYY-MM-DD, `new Date("YYYY-MM-DD")` is parsed as UTC,
        // which can display as the previous day in local timezones. Prefer parsing those explicitly
        // when you need a date-only value.
        const d = new Date(value);
        return isNaN(d.getTime()) ? null : d;
      }
      // Milliseconds
      if (typeof value === 'number') {
        const d = new Date(value);
        return isNaN(d.getTime()) ? null : d;
      }
      // Date instance
      if (value instanceof Date) return value;
      return null;
    } catch {
      return null;
    }
  };

  // Normalize any dob value (string, Timestamp, { seconds }, Date) to YYYY-MM-DD for form/display
  const normalizeDobToYyyyMmDd = (v: any): string => {
    if (v == null || v === '') return '';
    if (typeof v === 'string') {
      const s = v.trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
      if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) {
        const [mm, dd, yyyy] = s.split('/');
        return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
      }
      const d = new Date(s);
      return !isNaN(d.getTime()) ? d.toISOString().split('T')[0]! : '';
    }
    if (typeof v?.toDate === 'function') {
      const d = v.toDate();
      return d instanceof Date && !isNaN(d.getTime()) ? d.toISOString().split('T')[0]! : '';
    }
    if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().split('T')[0]!;
    if (typeof v === 'number' && v > 0) {
      const d = new Date(v);
      return !isNaN(d.getTime()) ? d.toISOString().split('T')[0]! : '';
    }
    const sec = (v && (typeof (v as any).seconds === 'number' ? (v as any).seconds : (v as any)._seconds));
    if (typeof sec === 'number') {
      const d = new Date(sec * 1000);
      return !isNaN(d.getTime()) ? d.toISOString().split('T')[0]! : '';
    }
    return '';
  };

  const formatDateOnlyForDisplay = (v: any): string => {
    const normalized = normalizeDobToYyyyMmDd(v);
    if (!normalized) return '-';
    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ];
    const [yyyy, mm, dd] = normalized.split('-');
    const monthIdx = Math.max(0, Math.min(11, parseInt(mm, 10) - 1));
    const dayNum = parseInt(dd, 10);
    return `${monthNames[monthIdx]} ${dayNum}, ${yyyy}`;
  };

  // Helper: valid DOB present (string, Timestamp, { seconds }, Date)
  const hasValidDateOfBirth = (dob: any): boolean => {
    return normalizeDobToYyyyMmDd(dob) !== '';
  };
  const { tenantId: activeTenantId, user, securityLevel, activeTenant } = useAuth();
  const viewerSecurityLevel = parseInt(String(securityLevel || '0'), 10);
  const isOwnProfile = !!user?.uid && user.uid === uid;
  // Only show User Groups on a user's *own* profile, and only for admin security levels 5-7.
  const canViewUserGroupsSection = isOwnProfile && viewerSecurityLevel >= 5 && viewerSecurityLevel <= 7;
  const [form, setForm] = useState<UserProfileForm>({
    firstName: '',
    lastName: '',
    preferredName: '',
    email: '',
    phone: '',
    linkedinUrl: '',
    dateOfBirth: '',
    gender: undefined,
    securityLevel: '5',
    employmentType: 'Full-Time',
    departmentId: '',
    divisionId: '',
    locationId: '',
    regionId: '',
    managerId: '',
    startDate: '',
    workStatus: 'Active',
    workerId: '',
    union: '',
    workEligibility: true,
    languages: [],
    emergencyContact: undefined,
    transportMethod: undefined,
    role: 'Worker',
    jobTitle: '',
    department: '',
  });

  const [originalForm, setOriginalForm] = useState<UserProfileForm>(form);
  const [message, setMessage] = useState('');
  const [showToast, setShowToast] = useState(false);
  const [departments, setDepartments] = useState<any[]>([]);
  const [divisions, setDivisions] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [regions, setRegions] = useState<any[]>([]);
  const [managers, setManagers] = useState<any[]>([]);
  const [tenantId, setTenantId] = useState<string>('');
  const [tenantName, setTenantName] = useState<string>('');
  const [customerName, setCustomerName] = useState<string>('');
  const [userGroups, setUserGroups] = useState<any[]>([]);
  const [userGroupIds, setUserGroupIds] = useState<string[]>([]);
  const [resetPasswordDialogOpen, setResetPasswordDialogOpen] = useState(false);
  const [resetPasswordLoading, setResetPasswordLoading] = useState(false);
  const [addressInfo, setAddressInfo] = useState<any>({
    homeLat: null,
    homeLng: null,
    workLat: 38.8977, // Default: White House
    workLng: -77.0365,
    currentLat: null,
    currentLng: null,
  });

  // System access info (read-only)
  const [systemAccess, setSystemAccess] = useState<{
    loginCount: number | null;
    lastLoginAt: Date | null;
    uid: string;
  }>({ loginCount: null, lastLoginAt: null, uid });

  // Phone verification status
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [isEditingBasicIdentity, setIsEditingBasicIdentity] = useState(false);
  const [isEditingHomeAddress, setIsEditingHomeAddress] = useState(false);
  const [workEligibilityData, setWorkEligibilityData] = useState({
    workAuthorized: false,
    requireSponsorship: false,
    gender: undefined as string | undefined,
    veteranStatus: '',
    disabilityStatus: '',
  });

  // Removed AI insights section

  // Location settings data (read-only)
  const [locationSettings, setLocationSettings] = useState({
    locationSharingEnabled: false,
    locationGranularity: 'disabled' as string,
    lastLocationUpdate: null as Date | null,
  });

  // Language options for autocomplete
  const languageOptions = [
    'English', 'Spanish', 'French', 'German', 'Italian', 'Portuguese', 'Russian', 'Chinese', 'Japanese', 'Korean',
    'Arabic', 'Hindi', 'Bengali', 'Urdu', 'Turkish', 'Dutch', 'Swedish', 'Norwegian', 'Danish', 'Finnish',
    'Polish', 'Czech', 'Hungarian', 'Romanian', 'Bulgarian', 'Greek', 'Hebrew', 'Thai', 'Vietnamese', 'Tagalog'
  ];

const transportOptions: Array<{
  value: NonNullable<UserProfileForm['transportMethod']>;
  label: string;
  icon: SvgIconComponent;
}> = [
  { value: 'Car', label: 'Car', icon: DirectionsCar },
  { value: 'Public Transit', label: 'Public Transit', icon: DirectionsTransit },
  { value: 'Bike', label: 'Bike', icon: DirectionsBike },
  { value: 'Walk', label: 'Walk', icon: DirectionsWalk },
  { value: 'Other', label: 'Other', icon: MoreHoriz },
];

  // Check if user can edit this profile
  const canEditProfile = () => {
    // Users can always edit their own profile
    if (user?.uid === uid) return true;
    
    // Admins and managers can edit any profile (security level 4 or higher)
    const userLevel = parseInt(securityLevel || '0');
    if (userLevel >= 4) return true;
    
    return false;
  };

  // Check if user can see sensitive sections
  const canSeeSensitiveSections = () => {
    // Admins and managers can see all sections (security level 4 or higher)
    const userLevel = parseInt(securityLevel || '0');
    if (userLevel >= 4) return true;
    
    // Workers can only see basic sections
    return false;
  };

  // AI Insights removed

  // Check if user can reset passwords
  const canResetPassword = () => {
    // Users can reset their own password
    if (user?.uid === uid) return true;
    
    // Admins and managers can reset any password (security level 4 or higher)
    const userLevel = parseInt(securityLevel || '0');
    if (userLevel >= 4) return true;
    
    return false;
  };

  useEffect(() => {
    const userRef = doc(db, 'users', uid);
    const unsubscribe =
      onSnapshot(
        userRef,
        async (snapshot) => {
          if (snapshot.exists()) {
            const data = snapshot.data();
            
            // Get effective tenant ID first (same pattern as UserProfilePage)
            const effectiveTenantId = activeTenant?.id || data.activeTenantId || data.tenantId || activeTenantId;
            
            // Fetch tenant-dependent fields from nested structure first, then fallback to direct fields
            const tenantData = effectiveTenantId && data.tenantIds?.[effectiveTenantId] ? data.tenantIds[effectiveTenantId] : {};
            
            // Convert dates to ISO strings for form inputs (string, Timestamp, or plain { seconds })
            const dobValue = data.dob || data.dateOfBirth;
            const dateOfBirth = normalizeDobToYyyyMmDd(dobValue);
            const startDate = data.startDate ? 
              (data.startDate.toDate ? new Date(data.startDate.toDate()).toISOString().split('T')[0] : 
               typeof data.startDate === 'string' ? data.startDate : 
               new Date(data.startDate).toISOString().split('T')[0]) : '';
            
            const newForm: UserProfileForm = {
              firstName: data.firstName || '',
              lastName: data.lastName || '',
              preferredName: data.preferredName || '',
              email: data.email || '',
              phone: data.phone || (data.phoneE164 ? formatPhoneNumber(data.phoneE164.replace('+1', '')) : ''),
              linkedinUrl: data.linkedinUrl || '',
              dateOfBirth,
              gender: data.gender || undefined,
              securityLevel: tenantData.securityLevel || data.securityLevel || '5',
              employmentType: data.employmentType || 'Full-Time',
              departmentId: data.departmentId || '',
              divisionId: data.divisionId || '',
              locationId: data.locationId || '',
              regionId: data.regionId || '',
              managerId: data.managerId || '',
              startDate,
              workStatus: data.workStatus || 'Active',
              workerId: data.workerId || '',
              union: data.union || '',
              workEligibility: data.workEligibility !== false,
              languages: (() => {
                const langs = data.languages || [];
                // Normalize languages - convert objects to strings for the form
                return langs.map((lang: any) => {
                  if (typeof lang === 'string') return lang;
                  if (lang && typeof lang === 'object') {
                    return lang.language || lang.name || String(lang || '');
                  }
                  return String(lang || '');
                }).filter(Boolean);
              })(),
              emergencyContact: data.emergencyContact || undefined,
              transportMethod: data.transportMethod || null,
              role: data.role || 'Worker',
              jobTitle: data.jobTitle || '',
              department: data.department || '',
              crm_sales: !!data.crm_sales,
              recruiter: !!data.recruiter,
              jobsBoard: !!data.jobsBoard,
            };
            
            setForm(newForm);
            setOriginalForm(newForm);

            // Load Work Eligibility data
            setWorkEligibilityData({
              workAuthorized: data.workEligibility !== false,
              requireSponsorship: !!data.requireSponsorship,
              gender: data.gender || undefined,
              veteranStatus: data.veteranStatus || '',
              disabilityStatus: data.disabilityStatus || '',
            });

            // Set phone verification status
            setPhoneVerified(data.phoneVerified === true);

            // AI insights removed
            
            // Load location settings data
            setLocationSettings({
              locationSharingEnabled: data.locationSettings?.locationSharingEnabled || false,
              locationGranularity: data.locationSettings?.locationGranularity || 'disabled',
              lastLocationUpdate: data.locationSettings?.lastLocationUpdate?.toDate ? data.locationSettings.lastLocationUpdate.toDate() : 
                (data.locationSettings?.lastLocationUpdate ? new Date(data.locationSettings.lastLocationUpdate) : null),
            });
            
            // Load addressInfo - check multiple possible locations for address data
            const addressInfoData = data.addressInfo || {};
            const addressData = data.address || {};
            const coordinatesData = addressData.coordinates || {};
            
            // Merge addressInfo with fallbacks from address.coordinates
            setAddressInfo({
              streetAddress: addressInfoData.streetAddress || addressData.street || '',
              unitNumber: addressInfoData.unitNumber || addressData.unit || '',
              city: addressInfoData.city || addressData.city || data.city || '',
              state: addressInfoData.state || addressData.state || data.state || '',
              zip: addressInfoData.zip || addressInfoData.zipCode || addressData.zipCode || addressData.zip || '',
              homeLat: addressInfoData.homeLat ?? coordinatesData.lat ?? null,
              homeLng: addressInfoData.homeLng ?? coordinatesData.lng ?? null,
              workLat: addressInfoData.workLat ?? null,
              workLng: addressInfoData.workLng ?? null,
              currentLat: addressInfoData.currentLat ?? null,
              currentLng: addressInfoData.currentLng ?? null,
            });

            // Populate system access info: prefer lastActiveAt, fallback to lastLoginAt
            setSystemAccess({
              loginCount: typeof data.loginCount === 'number' ? data.loginCount : null,
              lastLoginAt: coerceToDate(data.lastActiveAt) || coerceToDate(data.lastLoginAt),
              uid,
            });
          }
        },
        (error) => {
          console.error('Error fetching user data:', error);
        },
      );

    return () => unsubscribe();
  }, [uid]);

  // Load tenant data when activeTenantId changes
  useEffect(() => {
    if (activeTenantId) {
      setTenantId(activeTenantId);
      loadTenantData(activeTenantId);
    }
  }, [activeTenantId]);

  const loadTenantData = async (tenantId: string) => {
    try {
      console.log('Loading tenant data for tenantId:', tenantId);
      
      // Use tenant name from activeTenant if available, otherwise use tenantId as fallback
      if (activeTenant?.name) {
        setTenantName(activeTenant.name);
        setCustomerName(activeTenant.name);
      } else {
        setTenantName(tenantId);
        setCustomerName(tenantId);
      }
      
      // Fetch departments with error handling
      try {
        const deptQuery = collection(db, 'tenants', tenantId, 'departments');
        const deptSnap = await getDocs(deptQuery);
        const deptData = deptSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        console.log('Fetched departments:', deptData);
        setDepartments(deptData);
      } catch (deptError) {
        console.warn('Could not fetch departments:', deptError);
        setDepartments([]);
      }
      
      // Fetch divisions with error handling
      try {
        const divQuery = collection(db, 'tenants', tenantId, 'divisions');
        const divSnap = await getDocs(divQuery);
        const divData = divSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        console.log('Fetched divisions:', divData);
        setDivisions(divData);
      } catch (divError) {
        console.warn('Could not fetch divisions:', divError);
        setDivisions([]);
      }
      
      // Fetch regions with error handling
      try {
        const regionQuery = collection(db, 'tenants', tenantId, 'regions');
        const regionSnap = await getDocs(regionQuery);
        const regionData = regionSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        console.log('Fetched regions:', regionData);
        setRegions(regionData);
      } catch (regionError) {
        console.warn('Could not fetch regions:', regionError);
        setRegions([]);
      }
      
      // Fetch locations with error handling
      try {
        const locQuery = collection(db, 'tenants', tenantId, 'locations');
        const locSnap = await getDocs(locQuery);
        const locData = locSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        console.log('Fetched locations:', locData);
        setLocations(locData);
      } catch (locError) {
        console.warn('Could not fetch locations:', locError);
        setLocations([]);
      }
      
      // Fetch managers with error handling
      try {
        const usersQuery = query(
          collection(db, 'users'),
          where('tenantId', '==', tenantId),
          where('securityLevel', 'in', ['5', '6', '7'])
        );
        const usersSnap = await getDocs(usersQuery);
        const managerData = usersSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        console.log('Fetched managers:', managerData);
        setManagers(managerData);
      } catch (managerError) {
        console.warn('Could not fetch managers:', managerError);
        setManagers([]);
      }
      
      
    } catch (error) {
      console.error('Error loading tenant data:', error);
      // Set empty arrays as fallbacks
      setDepartments([]);
      setDivisions([]);
      setRegions([]);
      setLocations([]);
      setManagers([]);
    }
  };

  // Load user groups only when viewer is allowed to see them
  useEffect(() => {
    if (!canViewUserGroupsSection) return;
    if (tenantId && uid) {
      loadUserGroups(tenantId);
    }
  }, [tenantId, uid, canViewUserGroupsSection]);

  const loadUserGroups = async (tenantId: string) => {
    try {
      // Fetch user groups
      const gq = collection(db, 'tenants', tenantId, 'userGroups');
      const gSnap = await getDocs(gq);
      const groupData = gSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      setUserGroups(groupData);

      // Fetch current user's group memberships
      const userRef = doc(db, 'users', uid);
      const userSnap = await getDoc(userRef);
      if (userSnap.exists()) {
        const userData = userSnap.data();
        setUserGroupIds(userData.userGroupIds || []);
      }
    } catch (error) {
      console.error('Error loading user groups:', error);
      setUserGroups([]);
    }
  };

  const handleUserGroupsChange = (event: any, newValue: any[]) => {
    const newGroupIds = newValue.map((group: any) => group.id);
    setUserGroupIds(newGroupIds);
    
    // Persist to Firestore
    const userRef = doc(db, 'users', uid);
    updateDoc(userRef, { 
      userGroupIds: newGroupIds,
      updatedAt: new Date()
    }).catch((error) => {
      console.error('Error updating user groups:', error);
    });
  };

  const handleAddressChange = async (updatedAddressInfo: any) => {
    setAddressInfo(updatedAddressInfo);
    const userRef = doc(db, 'users', uid);
    
    // Only update addressInfo - this is now the single source of truth for address data
    await updateDoc(userRef, { 
      addressInfo: updatedAddressInfo
    });
  };

  const hasChanges = JSON.stringify(form) !== JSON.stringify(originalForm);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSelectChange = (e: any) => {
    const { name, value } = e.target;
    setForm({ ...form, [name]: value });
    // Persist Employment Details fields immediately
    const employmentFields = new Set([
      'jobTitle',
      'securityLevel',
      'employmentType',
      'departmentId',
      'divisionId',
      'locationId',
      'regionId',
      'managerId',
      'startDate',
      'workStatus',
      // Also persist identity select fields
      'gender',
      'transportMethod',
    ]);
    if (employmentFields.has(name)) {
      persistEmploymentField(name, value);
    }
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    if (name === 'phone') {
      const formatted = formatPhoneNumber(value);
      setForm((prev) => ({ ...prev, phone: formatted }));
      persistProfileField('phone', formatted);
    }
    // Persist text inputs in Employment Details on blur
    const employmentTextFields = new Set(['jobTitle', 'workerId', 'union']);
    if (employmentTextFields.has(name)) {
      persistEmploymentField(name, value);
    }
    // Persist Basic Identity text fields on blur
    const identityTextFields = new Set(['firstName', 'lastName', 'preferredName', 'email']);
    if (identityTextFields.has(name)) {
      persistProfileField(name, value);
    }
  };


  const handleLanguagesChange = (event: any, newValue: string[]) => {
    setForm({ ...form, languages: newValue });
    persistProfileField('languages', newValue);
  };

  const handleEmergencyContactChange = (field: keyof EmergencyContact, value: string) => {
    const updatedEmergencyContact = {
      ...form.emergencyContact,
      [field]: value
    } as EmergencyContact;
    
    setForm({
      ...form,
      emergencyContact: updatedEmergencyContact
    });
    
    // Persist the emergency contact data immediately
    persistProfileField('emergencyContact', updatedEmergencyContact);
  };

  // Persist a single Employment Details field to Firestore immediately
  const persistEmploymentField = async (field: string, value: any) => {
    try {
      const userRef = doc(db, 'users', uid);
      let toSave: any = value;
      const normalizeDateOnlyToYmd = (v: any): string | null => {
        if (!v) return null;
        if (typeof v === 'string') {
          const s = v.trim();
          if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
          if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) {
            const [mm, dd, yyyy] = s.split('/');
            return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
          }
          // Fall back: try to parse and format in UTC to preserve calendar day
          const d = new Date(s);
          if (!isNaN(d.getTime())) {
            const yyyy = d.getUTCFullYear();
            const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
            const dd = String(d.getUTCDate()).padStart(2, '0');
            return `${yyyy}-${mm}-${dd}`;
          }
          return null;
        }
        if (typeof v?.toDate === 'function') {
          const d = v.toDate();
          const yyyy = d.getUTCFullYear();
          const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
          const dd = String(d.getUTCDate()).padStart(2, '0');
          return `${yyyy}-${mm}-${dd}`;
        }
        if (v instanceof Date) {
          const yyyy = v.getUTCFullYear();
          const mm = String(v.getUTCMonth() + 1).padStart(2, '0');
          const dd = String(v.getUTCDate()).padStart(2, '0');
          return `${yyyy}-${mm}-${dd}`;
        }
        return null;
      };

      // Date-only fields: store as YYYY-MM-DD strings (avoid timezone shifts)
      if (field === 'startDate' || field === 'dateOfBirth') {
        toSave = normalizeDateOnlyToYmd(value);
      }
      
      // List of tenant-dependent fields that need to be stored in nested tenantIds structure
      const tenantDependentFields = [
        'securityLevel', 'regionId', 'jobTitle', 'workStatus', 'employmentType', 
        'departmentId', 'divisionId', 'managerId', 'startDate', 'workerId', 'locationId'
      ];
      
      // Special handling for tenant-dependent fields - update nested tenantIds
      if (tenantDependentFields.includes(field) && activeTenantId) {
        // Get current user document to access tenantIds
        const userDoc = await getDoc(userRef);
        const userData = userDoc.data();
        
        if (userData?.tenantIds?.[activeTenantId]) {
          // Prepare update data with both direct field and nested field
          const updateData: any = { 
            [field]: toSave,
            [`tenantIds.${activeTenantId}.${field}`]: toSave,
            updatedAt: new Date() 
          };
          
          // Clean up old field names to prevent duplication
          const fieldMappings: { [key: string]: string } = {
            'departmentId': 'department',
            'regionId': 'region'
          };
          
          if (fieldMappings[field]) {
            // Remove the old field name from the nested structure
            updateData[`tenantIds.${activeTenantId}.${fieldMappings[field]}`] = null;
            console.log(`🧹 Cleaning up old field: tenantIds.${activeTenantId}.${fieldMappings[field]}`);
          }
          
          await updateDoc(userRef, updateData);
          console.log(`✅ Updated ${field} to ${toSave} in both direct field and tenantIds.${activeTenantId}.${field}`);
        } else {
          // Fallback: just update direct field if tenantIds structure is missing
          await updateDoc(userRef, { [field]: toSave, updatedAt: new Date() });
          console.log(`⚠️ Updated ${field} to ${toSave} in direct field only (tenantIds structure missing)`);
        }
      } else {
        // Normal field update (for non-tenant-dependent fields)
        await updateDoc(userRef, { [field]: toSave, updatedAt: new Date() });
      }
    } catch (err) {
      console.error('Error updating field', field, err);
    }
  };

  const handleTransportMethodToggle = (optionValue: NonNullable<UserProfileForm['transportMethod']>) => {
    setForm((prev) => {
      const nextValue = prev.transportMethod === optionValue ? undefined : optionValue;
      persistEmploymentField('transportMethod', nextValue || '');
      return { ...prev, transportMethod: nextValue };
    });
  };

  // Generic alias for non-employment fields
  const persistProfileField = async (field: string, value: any) => {
    // Special handling for phone field changes
    if (field === 'phone') {
      try {
        const userRef = doc(db, 'users', uid);
        
        // Get current user data to check if phone is changing
        const userDoc = await getDoc(userRef);
        const currentData = userDoc.data();
        
        if (currentData) {
          const currentPhone = currentData.phone || '';
          const newPhone = value || '';
          
          // If phone number is changing, reset verification status
          if (currentPhone !== newPhone && newPhone !== '') {
            // Convert to E.164 format for consistency
            const cleaned = newPhone.replace(/\D/g, '');
            const phoneE164 = cleaned.length === 10 ? `+1${cleaned}` : newPhone;
            
            await updateDoc(userRef, {
              phone: newPhone, // Display format: (925) 448-0579
              phoneE164: phoneE164, // E.164 format: +19254480579
              phoneVerified: false, // Reset verification when phone changes
              workEligibility: false, // Reset work eligibility when phone changes
              updatedAt: new Date()
            });
            
            console.log('Phone number changed, verification status reset');
            return;
          }
        }
      } catch (error) {
        console.error('Error handling phone change:', error);
      }
    }
    
    await persistEmploymentField(field, value);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const userRef = doc(db, 'users', uid);
      
      // Convert form data back to proper format for Firestore
      // Filter out undefined values to prevent Firestore errors
      const cleanForm = Object.fromEntries(
        Object.entries(form).filter(([_, value]) => value !== undefined)
      );
      
      const updateData = {
        ...cleanForm,
        // Store as date-only strings to avoid timezone day-shifts
        dob: form.dateOfBirth || null, // Standard field name
        dateOfBirth: form.dateOfBirth || null, // Backward compatibility: keep same value (string)
        startDate: form.startDate || null,
        updatedAt: new Date()
      };
      
      // Remove null values as well to prevent Firestore errors
      const finalUpdateData = Object.fromEntries(
        Object.entries(updateData).filter(([key, value]) => {
          // Filter out null, undefined, and empty strings for optional fields
          if (value === null || value === undefined) return false;
          if (typeof value === 'string' && value === '' && ['preferredName', 'divisionId', 'locationId', 'managerId', 'workerId', 'union', 'jobTitle', 'department'].includes(key)) return false;
          
          // Handle emergencyContact object - only include if it has valid data
          if (key === 'emergencyContact') {
            if (!value || typeof value !== 'object') return false;
            const contact = value as any;
            // Only include if at least one field has a non-empty value
            return contact.name?.trim() || contact.relationship?.trim() || contact.phone?.trim();
          }
          
          // Handle gender field - only include if it has a valid value
          if (key === 'gender') {
            return value && typeof value === 'string' && value !== '' && value !== 'undefined';
          }
          
          return true;
        })
      );
      
      console.log('Submitting update data:', finalUpdateData);
      await updateDoc(userRef, finalUpdateData);

      await persistScoreSummaryFromProfile(uid).catch((err) =>
        console.warn('ProfileOverview: persist scoreSummary failed', err)
      );

      // Log the profile update activity
      const changes = {
        formChanges: Object.keys(form).reduce((acc, key) => {
          if (form[key as keyof typeof form] !== originalForm[key as keyof typeof originalForm]) {
            acc[key] = {
              old: originalForm[key as keyof typeof originalForm],
              new: form[key as keyof typeof form]
            };
          }
          return acc;
        }, {} as any)
      };
      
      await logProfileUpdateActivity(uid, changes);
      
      setMessage('Profile updated successfully');
      setShowToast(true);
      setOriginalForm(form);
    } catch (error) {
      console.error('Error updating user data:', error);
      setMessage('Failed to update profile');
      setShowToast(true);
    }
  };

  const handleResetPassword = async () => {
    if (!form.email) {
      setMessage('Email address is required to reset password');
      setShowToast(true);
      return;
    }

    setResetPasswordLoading(true);
    try {
      await sendPasswordResetEmail(auth, form.email);
      
      // Log the password reset activity
      await logSecurityChangeActivity(
        uid,
        'password_reset_requested',
        'Password reset email requested',
        { email: form.email }
      );
      
      setMessage('Password reset email sent successfully');
      setShowToast(true);
      setResetPasswordDialogOpen(false);
    } catch (error: any) {
      console.error('Error sending password reset email:', error);
      let errorMessage = 'Failed to send password reset email';
      
      // Handle specific Firebase Auth errors
      if (error.code === 'auth/user-not-found') {
        errorMessage = 'No user found with this email address';
      } else if (error.code === 'auth/invalid-email') {
        errorMessage = 'Invalid email address';
      } else if (error.code === 'auth/too-many-requests') {
        errorMessage = 'Too many password reset attempts. Please try again later';
      }
      
      setMessage(errorMessage);
      setShowToast(true);
    } finally {
      setResetPasswordLoading(false);
    }
  };

  return (
    <Box sx={{ p: 0 }}>
      <Box component="form" onSubmit={handleSubmit} noValidate>
        <Grid container spacing={sectionSpacing}>
          {/* 🧍 Basic Identity Section */}
          <Grid item xs={12}>
            <Card variant="outlined" sx={{ p: cardPadding }}>
              <CardHeader 
                title={
                  <Box sx={{ display: 'flex', alignItems: 'center' }}>
                    <PersonIcon sx={{ mr: 1 }} color="primary" />
                    <Typography variant="h6" sx={{ fontWeight: 700 }}>Basic Identity</Typography>
                  </Box>
                }
                titleTypographyProps={{ component: 'div' }}
                action={
                  canEditProfile() && (
                    <IconButton
                      size="small"
                      onClick={() => setIsEditingBasicIdentity(!isEditingBasicIdentity)}
                      sx={{ 
                        color: isEditingBasicIdentity ? 'primary.main' : 'text.secondary',
                        '&:hover': {
                          bgcolor: 'action.hover'
                        }
                      }}
                    >
                      <EditIcon fontSize="small" />
                    </IconButton>
                  )
                }
                sx={{ pb: 0, ...cardHeaderPadding }}
              />
              <CardContent sx={{ p: cardContentPadding, pt: cardContentPadding }}>
                {/* Missing Items Alerts for Basic Identity */}
                {!isEditingBasicIdentity && (
                  <Box sx={{ mb: 2 }}>
                    {!hasValidDateOfBirth(form.dateOfBirth) && (
                      <Alert 
                        severity="warning" 
                        sx={{ mb: 1 }}
                        action={
                          <Button 
                            size="small" 
                            onClick={() => setIsEditingBasicIdentity(true)}
                            color="inherit"
                          >
                            Add
                          </Button>
                        }
                      >
                        Missing Date of Birth
                      </Alert>
                    )}
                    {!form.phone && (
                      <Alert 
                        severity="warning" 
                        sx={{ mb: 1 }}
                        action={
                          <Button 
                            size="small" 
                            onClick={() => setIsEditingBasicIdentity(true)}
                            color="inherit"
                          >
                            Add
                          </Button>
                        }
                      >
                        Missing Phone Number
                      </Alert>
                    )}
                  </Box>
                )}
                {isEditingBasicIdentity ? (
                  // Edit Mode - Show Input Fields
                  <Grid container spacing={2}>
                    {/* Left Column */}
                    <Grid item xs={12} sm={6}>
                      <Grid container spacing={2}>
                        <Grid item xs={12}>
                          <TextField
                            fullWidth
                            required
                            name="firstName"
                            label="First Name"
                            value={form.firstName}
                            onChange={handleChange}
                            onBlur={handleBlur}
                            size="small"
                          />
                        </Grid>
                        <Grid item xs={12}>
                          <TextField
                            fullWidth
                            required
                            name="lastName"
                            label="Last Name"
                            value={form.lastName}
                            onChange={handleChange}
                            onBlur={handleBlur}
                            size="small"
                          />
                        </Grid>
                        <Grid item xs={12}>
                          <TextField
                            fullWidth
                            name="preferredName"
                            label="Preferred Name"
                            value={form.preferredName}
                            onChange={handleChange}
                            onBlur={handleBlur}
                            helperText="Shown in Companion/chat and dashboards"
                            size="small"
                          />
                        </Grid>
                        <Grid item xs={12}>
                          <TextField
                            fullWidth
                            required
                            name="phone"
                            label="Phone"
                            value={form.phone}
                            onChange={handleChange}
                            onBlur={handleBlur}
                            InputProps={{
                              endAdornment: phoneVerified ? (
                                <InputAdornment position="end">
                                  <CheckCircleIcon color="success" fontSize="small" titleAccess="Phone Verified" />
                                </InputAdornment>
                              ) : null
                            }}
                            helperText={phoneVerified ? "Verified" : ""}
                            size="small"
                          />
                        </Grid>
                        <Grid item xs={12}>
                          <TextField
                            fullWidth
                            required
                            name="email"
                            label="Email"
                            type="email"
                            value={form.email}
                            onChange={handleChange}
                            onBlur={handleBlur}
                            size="small"
                          />
                        </Grid>
                        <Grid item xs={12}>
                          <TextField
                            fullWidth
                            name="dateOfBirth"
                            label="Date of Birth"
                            type="date"
                            required
                            value={form.dateOfBirth}
                            onChange={(e) => {
                              handleChange(e as any);
                              persistProfileField('dateOfBirth', (e.target as HTMLInputElement).value);
                            }}
                            InputLabelProps={{ shrink: true }}
                            helperText="Used for EEO reporting or validation"
                            size="small"
                          />
                        </Grid>
                      </Grid>
                    </Grid>
                    
                    {/* Right Column */}
                    <Grid item xs={12} sm={6}>
                      <Grid container spacing={2}>
                        <Grid item xs={12}>
                          <TextField
                            fullWidth
                            name="linkedinUrl"
                            label="LinkedIn URL"
                            value={form.linkedinUrl || ''}
                            onChange={handleChange}
                            onBlur={(e) => persistProfileField('linkedinUrl', e.target.value)}
                            size="small"
                          />
                        </Grid>
                        <Grid item xs={12}>
                          <Autocomplete
                            multiple
                            options={languageOptions}
                            value={(() => {
                              const langs = form.languages || [];
                              // Normalize to strings - handle both string and object formats
                              return langs.map((lang: any) => {
                                if (typeof lang === 'string') return lang;
                                if (lang && typeof lang === 'object') {
                                  return lang.language || lang.name || String(lang || '');
                                }
                                return String(lang || '');
                              }).filter(Boolean);
                            })()}
                            onChange={handleLanguagesChange}
                            getOptionLabel={(option: string) => option}
                            size="small"
                            renderInput={(params) => (
                              <TextField {...params} label="Languages" placeholder="Select languages" />
                            )}
                            renderTags={(value: string[], getTagProps) =>
                              value.map((option: string, index: number) => (
                                <Chip 
                                  label={toChipLabel(option)} 
                                  {...getTagProps({ index })} 
                                  key={toChipLabel(option) || index} 
                                />
                              ))
                            }
                          />
                        </Grid>
                        <Grid item xs={12}>
                          <TextField
                            fullWidth
                            name="emergencyContactName"
                            label="Emergency Contact Name"
                            value={form.emergencyContact?.name || ''}
                            onChange={(e) => handleEmergencyContactChange('name', e.target.value)}
                            size="small"
                          />
                        </Grid>
                        <Grid item xs={12}>
                          <TextField
                            fullWidth
                            name="emergencyContactRelationship"
                            label="Relationship"
                            value={form.emergencyContact?.relationship || ''}
                            onChange={(e) => handleEmergencyContactChange('relationship', e.target.value)}
                            size="small"
                          />
                        </Grid>
                        <Grid item xs={12}>
                          <TextField
                            fullWidth
                            name="emergencyContactPhone"
                            label="Emergency Contact Phone"
                            value={form.emergencyContact?.phone || ''}
                            onChange={(e) => handleEmergencyContactChange('phone', e.target.value)}
                            size="small"
                          />
                        </Grid>
                        <Grid item xs={12}>
                          <Box>
                            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                              How will you get to work?
                            </Typography>
                            <Stack direction="row" spacing={1} flexWrap="wrap">
                              {transportOptions.map((option) => {
                                const Icon = option.icon;
                                const isSelected = form.transportMethod === option.value;
                                return (
                                  <Chip
                                    key={option.value}
                                    icon={<Icon fontSize="small" />}
                                    label={option.label}
                                    onClick={() => handleTransportMethodToggle(option.value)}
                                    color={isSelected ? 'primary' : 'default'}
                                    variant={isSelected ? 'filled' : 'outlined'}
                                    sx={{
                                      borderRadius: '999px',
                                      px: 1.5,
                                      height: 36,
                                      fontWeight: isSelected ? 600 : 500,
                                      mt: 0.5
                                    }}
                                  />
                                );
                              })}
                            </Stack>
                          </Box>
                        </Grid>
                      </Grid>
                    </Grid>
                  </Grid>
                ) : (
                  // View Mode - Show as Read-Only Text with Better Visual Hierarchy
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {/* Personal Information Section */}
                    <Box>
                      <Typography variant="subtitle2" fontWeight={600} color="text.primary" sx={{ mb: 2, fontSize: '0.875rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        Personal Information
                      </Typography>
                      <Grid container spacing={2}>
                        {(form.firstName || form.lastName) && (
                          <Grid item xs={12} sm={6}>
                            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                              <PersonIcon sx={{ fontSize: 18, color: 'text.secondary', mt: 0.5, flexShrink: 0 }} />
                              <Box sx={{ flex: 1, minWidth: 0 }}>
                                <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', fontWeight: 500 }}>
                                  Full Name
                                </Typography>
                                <Typography variant="body1" sx={{ mt: 0.25, fontWeight: 500 }}>
                                  {`${form.firstName || ''} ${form.lastName || ''}`.trim() || '-'}
                                </Typography>
                              </Box>
                            </Box>
                          </Grid>
                        )}
                        
                        {form.preferredName && (
                          <Grid item xs={12} sm={6}>
                            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                              <AccountBoxIcon sx={{ fontSize: 18, color: 'text.secondary', mt: 0.5, flexShrink: 0 }} />
                              <Box sx={{ flex: 1, minWidth: 0 }}>
                                <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', fontWeight: 500 }}>
                                  Preferred Name
                                </Typography>
                                <Typography variant="body1" sx={{ mt: 0.25 }}>
                                  {form.preferredName}
                                </Typography>
                              </Box>
                            </Box>
                          </Grid>
                        )}
                        
                        {form.email && (
                          <Grid item xs={12} sm={6}>
                            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                              <EmailIcon sx={{ fontSize: 18, color: 'text.secondary', mt: 0.5, flexShrink: 0 }} />
                              <Box sx={{ flex: 1, minWidth: 0 }}>
                                <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', fontWeight: 500 }}>
                                  Email
                                </Typography>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.25 }}>
                                  <Typography variant="body1">
                                    <MUILink 
                                      href={`mailto:${form.email}`} 
                                      color="primary" 
                                      underline="hover"
                                      sx={{ wordBreak: 'break-all' }}
                                    >
                                      {form.email}
                                    </MUILink>
                                  </Typography>
                                  <Tooltip title="Copy email">
                                    <IconButton
                                      size="small"
                                      onClick={async () => {
                                        try {
                                          await navigator.clipboard.writeText(form.email);
                                          setMessage('Email copied to clipboard');
                                          setShowToast(true);
                                        } catch (err) {
                                          console.error('Failed to copy email:', err);
                                          setMessage('Failed to copy email');
                                          setShowToast(true);
                                        }
                                      }}
                                      sx={{ 
                                        p: 0.5,
                                        color: 'text.secondary',
                                        '&:hover': {
                                          color: 'primary.main',
                                          bgcolor: 'action.hover'
                                        }
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
                        
                        {form.phone && (
                          <Grid item xs={12} sm={6}>
                            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                              <PhoneIcon sx={{ fontSize: 18, color: 'text.secondary', mt: 0.5, flexShrink: 0 }} />
                              <Box sx={{ flex: 1, minWidth: 0 }}>
                                <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', fontWeight: 500 }}>
                                  Phone
                                </Typography>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.25 }}>
                                  <Typography variant="body1">
                                    {formatPhoneNumber(form.phone) || form.phone}
                                  </Typography>
                                  {phoneVerified && (
                                    <CheckCircleIcon color="success" fontSize="small" titleAccess="Phone Verified" />
                                  )}
                                  <Tooltip title="Copy phone number">
                                    <IconButton
                                      size="small"
                                      onClick={async () => {
                                        try {
                                          const phoneToCopy = formatPhoneNumber(form.phone) || form.phone;
                                          await navigator.clipboard.writeText(phoneToCopy);
                                          setMessage('Phone number copied to clipboard');
                                          setShowToast(true);
                                        } catch (err) {
                                          console.error('Failed to copy phone number:', err);
                                          setMessage('Failed to copy phone number');
                                          setShowToast(true);
                                        }
                                      }}
                                      sx={{ 
                                        p: 0.5,
                                        color: 'text.secondary',
                                        '&:hover': {
                                          color: 'primary.main',
                                          bgcolor: 'action.hover'
                                        }
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
                        
                        {form.dateOfBirth && (
                          <Grid item xs={12} sm={6}>
                            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                              <CalendarIcon sx={{ fontSize: 18, color: 'text.secondary', mt: 0.5, flexShrink: 0 }} />
                              <Box sx={{ flex: 1, minWidth: 0 }}>
                                <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', fontWeight: 500 }}>
                                  Date of Birth
                                </Typography>
                                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
                                  {formatDateOnlyForDisplay(form.dateOfBirth)}
                                </Typography>
                              </Box>
                            </Box>
                          </Grid>
                        )}
                      </Grid>
                    </Box>

                    {/* Additional Information Section */}
                    {(form.linkedinUrl || (form.languages && form.languages.length > 0)) && (
                      <Box>
                        <Typography variant="subtitle2" fontWeight={600} color="text.primary" sx={{ mb: 2, fontSize: '0.875rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                          Additional Information
                        </Typography>
                        <Grid container spacing={2}>
                          {form.linkedinUrl && (
                            <Grid item xs={12} sm={6}>
                              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                                <LanguageIcon sx={{ fontSize: 18, color: 'text.secondary', mt: 0.5, flexShrink: 0 }} />
                                <Box sx={{ flex: 1, minWidth: 0 }}>
                                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', fontWeight: 500 }}>
                                    LinkedIn
                                  </Typography>
                                  <Typography variant="body1" sx={{ mt: 0.25 }}>
                                    <MUILink 
                                      href={form.linkedinUrl.startsWith('http') ? form.linkedinUrl : `https://${form.linkedinUrl}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      color="primary"
                                      underline="hover"
                                      sx={{ wordBreak: 'break-all' }}
                                    >
                                      {form.linkedinUrl}
                                    </MUILink>
                                  </Typography>
                                </Box>
                              </Box>
                            </Grid>
                          )}
                          
                          {form.languages && form.languages.length > 0 && (
                            <Grid item xs={12}>
                              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                                <LanguageIcon sx={{ fontSize: 18, color: 'text.secondary', mt: 0.5, flexShrink: 0 }} />
                                <Box sx={{ flex: 1, minWidth: 0 }}>
                                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', fontWeight: 500, mb: 0.5, display: 'block' }}>
                                    Languages
                                  </Typography>
                                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mt: 0.25 }}>
                                    {form.languages.map((lang: any, index: number) => {
                                      // Handle both string and object formats
                                      const languageName = typeof lang === 'string' 
                                        ? lang 
                                        : (lang?.language || lang?.name || 'Unknown');
                                      return (
                                        <Chip 
                                          key={index}
                                          label={languageName} 
                                          size="small" 
                                          variant="outlined"
                                        />
                                      );
                                    })}
                                  </Box>
                                </Box>
                              </Box>
                            </Grid>
                          )}
                        </Grid>
                      </Box>
                    )}

                    {/* Emergency Contact Section */}
                    {(form.emergencyContact?.name || form.emergencyContact?.phone) && (
                      <Box>
                        <Typography variant="subtitle2" fontWeight={600} color="text.primary" sx={{ mb: 2, fontSize: '0.875rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                          Emergency Contact
                        </Typography>
                        <Grid container spacing={2}>
                          {form.emergencyContact?.name && (
                            <Grid item xs={12} sm={6}>
                              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                                <EmergencyIcon sx={{ fontSize: 18, color: 'text.secondary', mt: 0.5, flexShrink: 0 }} />
                                <Box sx={{ flex: 1, minWidth: 0 }}>
                                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', fontWeight: 500 }}>
                                    Name
                                  </Typography>
                                  <Typography variant="body1" sx={{ mt: 0.25 }}>
                                    {form.emergencyContact.name}
                                    {form.emergencyContact?.relationship && ` (${form.emergencyContact.relationship})`}
                                  </Typography>
                                </Box>
                              </Box>
                            </Grid>
                          )}
                          
                          {form.emergencyContact?.phone && (
                            <Grid item xs={12} sm={6}>
                              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                                <LocalPhoneIcon sx={{ fontSize: 18, color: 'text.secondary', mt: 0.5, flexShrink: 0 }} />
                                <Box sx={{ flex: 1, minWidth: 0 }}>
                                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', fontWeight: 500 }}>
                                    Phone
                                  </Typography>
                                  <Typography variant="body1" sx={{ mt: 0.25 }}>
                                    {formatPhoneNumber(form.emergencyContact.phone) || form.emergencyContact.phone}
                                  </Typography>
                                </Box>
                              </Box>
                            </Grid>
                          )}
                        </Grid>
                      </Box>
                    )}

                    {/* Transportation Method */}
                    {form.transportMethod && (() => {
                      const transportOption = transportOptions.find(opt => opt.value === form.transportMethod);
                      const TransportIcon = transportOption?.icon || DirectionsCar;
                      return (
                        <Box>
                          <Typography variant="subtitle2" fontWeight={600} color="text.primary" sx={{ mb: 2, fontSize: '0.875rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                            Transportation
                          </Typography>
                          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                            <TransportIcon sx={{ fontSize: 18, color: 'text.secondary', mt: 0.5, flexShrink: 0 }} />
                            <Box sx={{ flex: 1, minWidth: 0 }}>
                              <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', fontWeight: 500 }}>
                                How will you get to work?
                              </Typography>
                              <Typography variant="body1" sx={{ mt: 0.25 }}>
                                {transportOption?.label || form.transportMethod}
                              </Typography>
                            </Box>
                          </Box>
                        </Box>
                      );
                    })()}
                  </Box>
                )}
              </CardContent>
            </Card>
          </Grid>

          {/* Compliance (I-9 + E-Verify) - admin view */}
          {tenantId && (
            <Grid item xs={12} sm={6} md={4}>
              <EverifyComplianceCard tenantId={tenantId} userId={uid} />
            </Grid>
          )}

          {/* Work Eligibility Section */}
          <Grid item xs={12}>
            <Card variant="outlined" sx={{ p: cardPadding }}>
              <CardHeader 
                title={
                  <Box sx={{ display: 'flex', alignItems: 'center' }}>
                    <SecurityIcon sx={{ mr: 1 }} color="primary" />
                    <Typography variant="h6" sx={{ fontWeight: 700 }}>Work Eligibility</Typography>
                  </Box>
                }
                titleTypographyProps={{ component: 'div' }}
                action={
                  canEditProfile() && onTabChange && (
                    <IconButton
                      size="small"
                      onClick={() => onTabChange('Work Eligibility')}
                      sx={{ 
                        color: 'text.secondary',
                        '&:hover': {
                          bgcolor: 'action.hover'
                        }
                      }}
                    >
                      <EditIcon fontSize="small" />
                    </IconButton>
                  )
                }
                sx={{ pb: 0, ...cardHeaderPadding }}
              />
              <CardContent sx={{ p: cardContentPadding, pt: cardContentPadding }}>
                {/* Missing Work Eligibility Alert */}
                {workEligibilityData.workAuthorized === false && (
                  <Alert 
                    severity="error" 
                    sx={{ mb: 2 }}
                    action={
                      onTabChange && (
                        <Button 
                          size="small" 
                          onClick={() => onTabChange('Work Eligibility')}
                          color="inherit"
                        >
                          Add
                        </Button>
                      )
                    }
                  >
                    Missing Work Eligibility Document
                  </Alert>
                )}
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {/* Work Eligibility Information Section */}
                  <Box>
                    <Typography variant="subtitle2" fontWeight={600} color="text.primary" sx={{ mb: 2, fontSize: '0.875rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      WORK AUTHORIZATION & EEO
                    </Typography>
                    <Grid container spacing={2}>
                      <Grid item xs={12} sm={6}>
                        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                          <CheckCircleIcon sx={{ fontSize: 18, color: workEligibilityData.workAuthorized ? 'success.main' : 'text.disabled', mt: 0.5, flexShrink: 0 }} />
                          <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', fontWeight: 500 }}>
                              Work Authorization
                            </Typography>
                            <Typography variant="body1" sx={{ mt: 0.25 }}>
                              {workEligibilityData.workAuthorized 
                                ? 'Authorized to work in the United States' 
                                : 'Not authorized to work in the United States'}
                            </Typography>
                          </Box>
                        </Box>
                      </Grid>
                      
                      {workEligibilityData.requireSponsorship && (
                        <Grid item xs={12} sm={6}>
                          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                            <SecurityIcon sx={{ fontSize: 18, color: 'text.secondary', mt: 0.5, flexShrink: 0 }} />
                            <Box sx={{ flex: 1, minWidth: 0 }}>
                              <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', fontWeight: 500 }}>
                                Sponsorship
                              </Typography>
                              <Typography variant="body1" sx={{ mt: 0.25 }}>
                                Requires employer sponsorship
                              </Typography>
                            </Box>
                          </Box>
                        </Grid>
                      )}
                      
                      {workEligibilityData.gender && (
                        <Grid item xs={12} sm={6}>
                          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                            <PersonIcon sx={{ fontSize: 18, color: 'text.secondary', mt: 0.5, flexShrink: 0 }} />
                            <Box sx={{ flex: 1, minWidth: 0 }}>
                              <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', fontWeight: 500 }}>
                                Gender
                              </Typography>
                              <Typography variant="body1" sx={{ mt: 0.25 }}>
                                {workEligibilityData.gender}
                              </Typography>
                            </Box>
                          </Box>
                        </Grid>
                      )}
                      
                      {workEligibilityData.veteranStatus && (
                        <Grid item xs={12} sm={6}>
                          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                            <AccountBoxIcon sx={{ fontSize: 18, color: 'text.secondary', mt: 0.5, flexShrink: 0 }} />
                            <Box sx={{ flex: 1, minWidth: 0 }}>
                              <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', fontWeight: 500 }}>
                                Veteran Status
                              </Typography>
                              <Typography variant="body1" sx={{ mt: 0.25 }}>
                                {workEligibilityData.veteranStatus}
                              </Typography>
                            </Box>
                          </Box>
                        </Grid>
                      )}
                      
                      {workEligibilityData.disabilityStatus && (
                        <Grid item xs={12} sm={6}>
                          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                            <AccountBoxIcon sx={{ fontSize: 18, color: 'text.secondary', mt: 0.5, flexShrink: 0 }} />
                            <Box sx={{ flex: 1, minWidth: 0 }}>
                              <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', fontWeight: 500 }}>
                                Disability Status
                              </Typography>
                              <Typography variant="body1" sx={{ mt: 0.25 }}>
                                {workEligibilityData.disabilityStatus}
                              </Typography>
                            </Box>
                          </Box>
                        </Grid>
                      )}
                      
                      {!workEligibilityData.workAuthorized && !workEligibilityData.requireSponsorship && !workEligibilityData.gender && !workEligibilityData.veteranStatus && !workEligibilityData.disabilityStatus && (
                        <Grid item xs={12}>
                          <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                            No additional EEO information provided. Click the edit icon to add optional EEO details.
                          </Typography>
                        </Grid>
                      )}
                    </Grid>
                  </Box>
                </Box>
              </CardContent>
            </Card>
          </Grid>

          {/* User Groups Section (admin 5-7 only, and only on own profile) */}
          {canViewUserGroupsSection && (
            <Grid item xs={12}>
              <Card variant="outlined" sx={{ p: cardPadding }}>
                <CardHeader
                  title={
                    <Box sx={{ display: 'flex', alignItems: 'center' }}>
                      <Typography variant="h6" sx={{ fontWeight: 700 }}>
                        User Groups
                      </Typography>
                    </Box>
                  }
                  titleTypographyProps={{ component: 'div' }}
                  sx={cardHeaderPadding}
                />
                <CardContent sx={{ p: cardContentPadding, pt: 0 }}>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                      Manage which user groups this user belongs to. User groups help organize users and control access to specific features.
                    </Typography>
                    <Autocomplete
                      multiple
                      options={userGroups}
                      getOptionLabel={(option) => option.title || option.id}
                      value={userGroups.filter((g) => userGroupIds.includes(g.id))}
                      onChange={handleUserGroupsChange}
                      renderInput={(params) => (
                        <TextField {...params} label="User Groups" placeholder="Select groups" fullWidth />
                      )}
                      renderTags={(value, getTagProps) =>
                        value.map((option, index) => (
                          <Chip label={option.title || option.id} {...getTagProps({ index })} key={option.id} />
                        ))
                      }
                      isOptionEqualToValue={(option, value) => option.id === value.id}
                    />
                  </Box>
                </CardContent>
              </Card>
            </Grid>
          )}

          {/* 📍 Employment Classification Section */}
          {/* Only show Employment Details for internal employees (security levels 5-7) */}
          {(() => {
            const profileSecurityLevel = parseInt(form.securityLevel || '0');
            return profileSecurityLevel >= 5 && profileSecurityLevel <= 7;
          })() && (
            <Grid item xs={12}>
              <Card variant="outlined" sx={{ p: cardPadding }}>
                <CardContent sx={{ p: 0 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                    <WorkIcon sx={{ mr: 1 }} color="primary" />
                    <Typography variant="h6" sx={{ fontWeight: 700 }}>Employment Details</Typography>
                  </Box>
                <Grid container spacing={2}>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      fullWidth
                      name="jobTitle"
                      label="Job Title"
                      value={form.jobTitle}
                      onChange={handleChange}
                      onBlur={handleBlur}
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <FormControl fullWidth required>
                      <InputLabel>Work Status</InputLabel>
                      <Select
                        name="workStatus"
                        value={form.workStatus}
                        onChange={handleSelectChange}
                        label="Work Status *"
                      >
                        <MenuItem value="Active">Active</MenuItem>
                        <MenuItem value="On Leave">On Leave</MenuItem>
                        <MenuItem value="Terminated">Terminated</MenuItem>
                        <MenuItem value="Suspended">Suspended</MenuItem>
                        <MenuItem value="Pending">Pending</MenuItem>
                      </Select>
                    </FormControl>
                  </Grid>
                  
                  <Grid item xs={12} sm={6}>
                    <FormControl fullWidth>
                      <InputLabel>Employment Type</InputLabel>
                      <Select
                        name="employmentType"
                        value={form.employmentType}
                        onChange={handleSelectChange}
                        label="Employment Type *"
                      >
                        <MenuItem value="Full-Time">Full-Time</MenuItem>
                        <MenuItem value="Part-Time">Part-Time</MenuItem>
                        <MenuItem value="Contract">Contract</MenuItem>
                        <MenuItem value="Flex">Flex</MenuItem>
                      </Select>
                    </FormControl>
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    {departments.length === 0 ? (
                      <TextField
                        label="Department"
                        fullWidth
                        disabled
                        value="No departments available"
                        helperText="Please create departments first"
                      />
                    ) : (
                      <FormControl fullWidth>
                        <InputLabel>Department</InputLabel>
                        <Select
                          name="departmentId"
                          value={form.departmentId}
                          onChange={handleSelectChange}
                          label="Department"
                        >
                          <MenuItem value="">None</MenuItem>
                          {departments.map((dept: any) => (
                            <MenuItem key={dept.id} value={dept.id}>
                              {dept.name}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    )}
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    {divisions.length === 0 ? (
                      <TextField
                        label="Division"
                        fullWidth
                        disabled
                        value="No divisions available"
                        helperText="Optional - useful for reporting"
                      />
                    ) : (
                      <FormControl fullWidth>
                        <InputLabel>Division</InputLabel>
                        <Select
                          name="divisionId"
                          value={form.divisionId || ''}
                          onChange={handleSelectChange}
                          label="Division"
                        >
                          <MenuItem value="">None</MenuItem>
                          {divisions.map((div: any) => (
                            <MenuItem key={div.id} value={div.id}>
                              {div.name}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    )}
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    {regions.length === 0 ? (
                      <TextField
                        label="Region"
                        fullWidth
                        disabled
                        value="No regions available"
                        helperText="Optional - geographic region"
                      />
                    ) : (
                      <FormControl fullWidth>
                        <InputLabel>Region</InputLabel>
                        <Select
                          name="regionId"
                          value={form.regionId || ''}
                          onChange={handleSelectChange}
                          label="Region"
                        >
                          <MenuItem value="">None</MenuItem>
                          {regions.map((region: any) => (
                            <MenuItem key={region.id} value={region.id}>
                              {region.name}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    )}
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    {locations.length === 0 ? (
                      <TextField
                        label="Location"
                        fullWidth
                        disabled
                        value="No locations available"
                        helperText="Optional - primary physical location"
                      />
                    ) : (
                      <FormControl fullWidth>
                        <InputLabel>Location</InputLabel>
                        <Select
                          name="locationId"
                          value={form.locationId || ''}
                          onChange={handleSelectChange}
                          label="Location"
                        >
                          <MenuItem value="">None</MenuItem>
                          {locations.map((loc: any) => (
                            <MenuItem key={loc.id} value={loc.id}>
                              {loc.nickname || loc.name}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    )}
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <FormControl fullWidth>
                      <InputLabel>Manager</InputLabel>
                      <Select
                        name="managerId"
                        value={form.managerId || ''}
                        onChange={handleSelectChange}
                        label="Manager"
                      >
                        <MenuItem value="">None</MenuItem>
                        {managers.map((manager: any) => (
                          <MenuItem key={manager.id} value={manager.id}>
                            {manager.firstName} {manager.lastName}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      fullWidth
                      name="startDate"
                      label="Start Date"
                      type="date"
                      value={form.startDate}
                      onChange={(e) => {
                        handleChange(e as any);
                        persistEmploymentField('startDate', (e.target as HTMLInputElement).value);
                      }}
                      InputLabelProps={{ shrink: true }}
                      helperText="Used for tenure calculations"
                    />
                  </Grid>
                  
                  <Grid item xs={12} sm={6}>
                    <TextField
                      fullWidth
                      name="workerId"
                      label="Worker ID"
                      value={form.workerId}
                      onChange={handleChange}
                      onBlur={handleBlur}
                      helperText="Optional custom ID from HRIS"
                    />
                  </Grid>
                  {/* <Grid item xs={12} sm={6}>
                    <TextField
                      fullWidth
                      name="union"
                      label="Union"
                      value={form.union}
                      onChange={handleChange}
                      onBlur={handleBlur}
                      helperText="Union name if exists"
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <FormControlLabel
                      control={
                        <Switch
                          checked={form.workEligibility}
                          onChange={(e) => {
                            setForm({ ...form, workEligibility: e.target.checked });
                            persistEmploymentField('workEligibility', e.target.checked);
                          }}
                        />
                      }
                      label="Work Eligibility"
                    />
                  </Grid> */}
                </Grid>
              </CardContent>
            </Card>
          </Grid>
          )}


          {/* AI Insights section removed */}

          {/* Address Section */}
          <Grid item xs={12}>
            <Card variant="outlined" sx={{ p: cardPadding }}>
              <CardHeader 
                title={
                  <Box sx={{ display: 'flex', alignItems: 'center' }}>
                    <LocationOnOutlinedIcon sx={{ mr: 1 }} color="primary" />
                    <Typography variant="h6" sx={{ fontWeight: 700 }}>Home Address</Typography>
                  </Box>
                }
                titleTypographyProps={{ component: 'div' }}
                action={
                  canEditProfile() && (
                    <IconButton
                      size="small"
                      onClick={() => setIsEditingHomeAddress(!isEditingHomeAddress)}
                      sx={{ 
                        color: isEditingHomeAddress ? 'primary.main' : 'text.secondary',
                        '&:hover': {
                          bgcolor: 'action.hover'
                        }
                      }}
                    >
                      <EditIcon fontSize="small" />
                    </IconButton>
                  )
                }
                sx={{ pb: 0, ...cardHeaderPadding }}
              />
              <CardContent sx={{ p: cardContentPadding, pt: cardContentPadding }}>
                {isEditingHomeAddress ? (
                  // Edit Mode - Show Address Form and Map
                  <Box>
                    <AddressFormFields uid={uid} formData={addressInfo} onFormChange={handleAddressChange} />
                    <Box sx={{ mt: 3 }}>
                      <MapWithMarkers
                        homeLat={addressInfo.homeLat}
                        homeLng={addressInfo.homeLng}
                        workLat={addressInfo.workLat}
                        workLng={addressInfo.workLng}
                        currentLat={addressInfo.currentLat}
                        currentLng={addressInfo.currentLng}
                      />
                    </Box>
                  </Box>
                ) : (
                  // View Mode - Show as Read-Only Text
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {(addressInfo.streetAddress || addressInfo.city || addressInfo.state || addressInfo.zip) && (
                      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                        <LocationOnOutlinedIcon sx={{ fontSize: 18, color: 'text.secondary', mt: 0.5, flexShrink: 0 }} />
                        <Typography variant="body1">
                          {[
                            [addressInfo.streetAddress, addressInfo.unitNumber].filter(Boolean).join(', '),
                            [addressInfo.city, addressInfo.state, addressInfo.zip].filter(Boolean).join(', ')
                          ]
                            .filter(Boolean)
                            .join(', ') || '-'}
                        </Typography>
                      </Box>
                    )}
                    
                    {/* Map in View Mode - Show if coordinates exist */}
                    {((addressInfo.homeLat !== null && addressInfo.homeLat !== undefined && addressInfo.homeLng !== null && addressInfo.homeLng !== undefined) ||
                      (addressInfo.workLat !== null && addressInfo.workLat !== undefined && addressInfo.workLng !== null && addressInfo.workLng !== undefined) ||
                      (addressInfo.currentLat !== null && addressInfo.currentLat !== undefined && addressInfo.currentLng !== null && addressInfo.currentLng !== undefined)) && (
                      <Box>
                        <Typography variant="subtitle2" fontWeight={600} color="text.primary" sx={{ mb: 2, fontSize: '0.875rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                          Location Map
                        </Typography>
                        <MapWithMarkers
                          homeLat={addressInfo.homeLat}
                          homeLng={addressInfo.homeLng}
                          workLat={addressInfo.workLat}
                          workLng={addressInfo.workLng}
                          currentLat={addressInfo.currentLat}
                          currentLng={addressInfo.currentLng}
                        />
                      </Box>
                    )}
                  </Box>
                )}
              </CardContent>
            </Card>
          </Grid>

          {hasChanges && canEditProfile() && (
            <Grid item xs={12}>
              <Button type="submit" variant="contained" size="large">
                Save Changes
              </Button>
            </Grid>
          )}
        </Grid>
      </Box>

      <Snackbar open={showToast} autoHideDuration={3000} onClose={() => setShowToast(false)}>
        <Alert 
          onClose={() => setShowToast(false)} 
          severity={message.includes('successfully') ? 'success' : 'error'} 
          sx={{ width: '100%' }}
        >
          {message}
        </Alert>
      </Snackbar>

      {/* Password Reset Confirmation Dialog */}
      <Dialog
        open={resetPasswordDialogOpen}
        onClose={() => setResetPasswordDialogOpen(false)}
        aria-labelledby="reset-password-dialog-title"
        aria-describedby="reset-password-dialog-description"
      >
        <DialogTitle id="reset-password-dialog-title">
          Reset Password
        </DialogTitle>
        <DialogContent>
          <DialogContentText id="reset-password-dialog-description">
            Are you sure you want to send a password reset email to <strong>{form.email}</strong>?
            <br /><br />
            The user will receive an email with a link to reset their password.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button 
            onClick={() => setResetPasswordDialogOpen(false)} 
            disabled={resetPasswordLoading}
          >
            Cancel
          </Button>
          <Button 
            onClick={handleResetPassword} 
            variant="contained" 
            color="primary"
            disabled={resetPasswordLoading}
          >
            {resetPasswordLoading ? 'Sending...' : 'Send Reset Email'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default ProfileOverview;
