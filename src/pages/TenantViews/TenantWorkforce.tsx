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
} from '@mui/material';
import { collection, addDoc, getDocs, query, where, serverTimestamp, doc, updateDoc, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import jobTitles from '../../data/onetJobTitles.json';
import { geocodeAddress } from '../../utils/geocodeAddress';
import BroadcastDialog from '../../components/BroadcastDialog';
import AddWorkerForm from '../../componentBlocks/AddWorkerForm';
import CSVUpload from '../../components/CSVUpload';
import WorkersTable from '../../componentBlocks/WorkersTable';
import TenantUserGroups from './TenantUserGroups';
import IntegrationsTab from './IntegrationsTab';
import { CSVWorkerData } from '../../utils/csvUpload';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { isStaffingCompany as checkIfStaffingCompany } from '../../utils/staffingCompanies';

function formatPhoneNumber(value: string) {
  const cleaned = value.replace(/\D/g, '');
  const match = cleaned.match(/^(\d{0,3})(\d{0,3})(\d{0,4})$/);
  if (!match) return value;
  let formatted = '';
  if (match[1]) formatted += `(${match[1]}`;
  if (match[2]) formatted += match[2].length === 3 ? `) ${match[2]}` : match[2];
  if (match[3]) formatted += `-${match[3]}`;
  return formatted;
}

const TenantWorkforce: React.FC = () => {
  const { tenantId } = useAuth();
  const navigate = useNavigate();
  
  const [form, setForm] = useState({
    // Basic Identity
    firstName: '',
    lastName: '',
    preferredName: '',
    email: '',
    phone: '',
    dateOfBirth: '',
    gender: '',
    
    // Employment Classification
    securityLevel: '5',
    employmentType: 'Full-Time',
    jobTitle: '',
    departmentId: '',
    divisionId: '',
    locationId: '',
    managerId: '',
    
    // Metadata & Structure
    startDate: '',
    workStatus: 'Active',
    workerId: '',
    union: '',
    workEligibility: false as boolean,
    languages: [] as string[],
    
    // Legacy fields for backward compatibility
    locationIds: [] as string[],
    street: '',
    city: '',
    state: '',
    zip: '',
    dob: '',
  });
  const [contacts, setContacts] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [locationsLoading, setLocationsLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [departments, setDepartments] = useState<any[]>([]);
  const [divisions, setDivisions] = useState<any[]>([]);
  const [managers, setManagers] = useState<any[]>([]);
  const [userGroups, setUserGroups] = useState<any[]>([]);
  const [selectedUserGroups, setSelectedUserGroups] = useState<string[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [selectedWorkers, setSelectedWorkers] = useState<string[]>([]);
  const [showBroadcastDialog, setShowBroadcastDialog] = useState(false);
  const [tabValue, setTabValue] = useState(0);
  const [search, setSearch] = useState('');
  // Separate search state for Flex Workers
  const [flexSearch, setFlexSearch] = useState('');
  // CSV import state
  const [importMode, setImportMode] = useState<'form' | 'csv'>('form');
  const [showCSVUpload, setShowCSVUpload] = useState(false);
  const [pendingInvites, setPendingInvites] = useState<any[]>([]);
  const [isStaffingCompany, setIsStaffingCompany] = useState(false);
  const [hiredStaffSearch, setHiredStaffSearch] = useState('');
  const [pendingInvitesSearch, setPendingInvitesSearch] = useState('');
  const [pendingInvitesOrderBy, setPendingInvitesOrderBy] = useState<'name' | 'email' | 'department' | 'role' | 'inviteSentAt'>('inviteSentAt');
  const [pendingInvitesOrder, setPendingInvitesOrder] = useState<'asc' | 'desc'>('desc');
  const [flexModuleEnabled, setFlexModuleEnabled] = useState(false);

  // Fetch pending invites
  const fetchPendingInvites = async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const q = query(
        collection(db, 'users'),
        where('tenantId', '==', tenantId),
        where('inviteStatus', '==', 'pending')
      );
      const snapshot = await getDocs(q);
      setPendingInvites(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    } catch (err: any) {
      setError(err.message || 'Failed to fetch pending invites');
    }
    setLoading(false);
  };

  // Real-time listener for flex module status
  useEffect(() => {
    if (!tenantId) return;

    const flexModuleRef = doc(db, 'tenants', tenantId, 'modules', 'hrx-flex');
    const unsubscribe = onSnapshot(flexModuleRef, (doc) => {
      if (doc.exists()) {
        const isEnabled = doc.data()?.isEnabled || false;
        console.log('Flex module status changed:', isEnabled);
        setFlexModuleEnabled(isEnabled);
      } else {
        console.log('Flex module document does not exist, defaulting to disabled');
        setFlexModuleEnabled(false);
      }
    }, (error) => {
      console.error('Error listening to flex module status:', error);
      setFlexModuleEnabled(false);
    });

    return () => unsubscribe();
  }, [tenantId]);

  useEffect(() => {
    if (tenantId) {
      setIsStaffingCompany(checkIfStaffingCompany(tenantId));
      fetchDepartments();
      fetchDivisions();
      fetchLocations().then(fetchContacts);
      fetchUserGroups();
      fetchManagers();
      fetchPendingInvites();
    }
    // eslint-disable-next-line
  }, [tenantId]);

  const fetchContacts = async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      console.log('Fetching contacts for tenantId:', tenantId);
      
      // First, let's see ALL users to understand whats in the database
      console.log('=== DEBUGGING: Checking ALL users first ===');
      const allUsersQuery = query(collection(db, 'users'));
      const allUsersSnapshot = await getDocs(allUsersQuery);
      console.log('ALL users in database:', allUsersSnapshot.docs.length);
      console.log('Sample users:', allUsersSnapshot.docs.slice(0,3).map(doc => ({
        id: doc.id,
        firstName: doc.data().firstName,
        lastName: doc.data().lastName,
        role: doc.data().role,
        inviteStatus: doc.data().inviteStatus,
        email: doc.data().email
      })));
      
      // Now try the original query
      console.log('=== DEBUGGING: Original query ===');
      const q = query(
        collection(db, 'users'),
        where('role', '==', 'Tenant')
        // Removed inviteStatus filter since users have undefined, not null
      );
      console.log('Firestore query:', q);
      
      const snapshot = await getDocs(q);
      console.log('Firestore query result - total docs:', snapshot.docs.length);
      
      console.log('Raw users from Firestore:', snapshot.docs.map(doc => ({
        id: doc.id, 
        firstName: doc.data().firstName,
        lastName: doc.data().lastName,
        role: doc.data().role,
        inviteStatus: doc.data().inviteStatus,
        tenantId: doc.data().tenantId,
        tenantIds: doc.data().tenantIds,
        securityLevel: doc.data().securityLevel
      })));
      
      // Filter users that belong to this tenant (either direct tenantId or in tenantIds map)
      const filteredContacts = snapshot.docs
        .map((doc) => ({ id: doc.id, ...doc.data() }))
        .filter((user: any) => {
          console.log(`Checking user ${user.firstName} ${user.lastName}:`, {
            directTenantId: user.tenantId,
            tenantIds: user.tenantIds,
            matchesDirect: user.tenantId === tenantId,
            matchesTenantIds: user.tenantIds && user.tenantIds[tenantId]
          });
          
          // Check direct tenantId field (old structure)
          if (user.tenantId === tenantId) {
            console.log(`✅ User ${user.firstName} ${user.lastName} matches direct tenantId`);
            return true;
          }
          
          // Check tenantIds map (new structure)
          if (user.tenantIds && user.tenantIds[tenantId]) {
            console.log(`✅ User ${user.firstName} ${user.lastName} matches tenantIds map`);
            return true;
          }
          
          console.log(`❌ User ${user.firstName} ${user.lastName} does not match tenant`);
          return false;
        });
      
      console.log('Filtered contacts:', filteredContacts);
      setContacts(filteredContacts);
    } catch (err: any) {
      console.error('Error fetching contacts:', err);
      setError(err.message || 'Failed to fetch workers');
    }
    setLoading(false);
  };

  const fetchLocations = async () => {
    if (!tenantId) return;
    setLocationsLoading(true);
    try {
      const q = query(collection(db, 'tenants', tenantId, 'locations'));
      const snapshot = await getDocs(q);
      setLocations(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    } catch (err: any) {
      // ignore for now
    }
    setLocationsLoading(false);
  };

  const fetchDepartments = async () => {
    if (!tenantId) return;
    try {
      const q = collection(db, 'tenants', tenantId, 'departments');
      const snapshot = await getDocs(q);
      setDepartments(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    } catch (err: any) {
      // ignore for now
    }
  };

  const fetchDivisions = async () => {
    if (!tenantId) return;
    try {
      const q = collection(db, 'tenants', tenantId, 'divisions');
      const snapshot = await getDocs(q);
      setDivisions(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    } catch (err: any) {
      // ignore for now
    }
  };

  const fetchManagers = async () => {
    if (!tenantId) return;
    try {
      const q = collection(db, 'tenants', tenantId, 'managers');
      const snapshot = await getDocs(q);
      setManagers(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    } catch (err: any) {
      // ignore for now
    }
  };

  const fetchUserGroups = async () => {
    try {
      const q = collection(db, 'tenants', tenantId, 'userGroups');
      const snapshot = await getDocs(q);
      setUserGroups(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    } catch {}
  };

  // Helper functions to filter workers by security level
  const getWorkersBySecurityLevel = (level: string | number) => {
    console.log(`Filtering for security level ${level}, tenantId: ${tenantId}`);
    console.log('All contacts:', contacts);
    
    return contacts.filter((c: any) => {
      console.log(`Checking worker ${c.firstName} ${c.lastName}:`, {
        directSecurityLevel: c.securityLevel,
        tenantIds: c.tenantIds,
        tenantSpecificLevel: c.tenantIds?.[tenantId]?.securityLevel
      });
      
      // Check direct securityLevel field (old structure)
      if (c.securityLevel === level) {
        console.log(`✅ Worker ${c.firstName} ${c.lastName} matches direct securityLevel`);
        return true;
      }
      // Check tenantIds map (new structure)
      if (c.tenantIds && c.tenantIds[tenantId] && c.tenantIds[tenantId].securityLevel === level) {
        console.log(`✅ Worker ${c.firstName} ${c.lastName} matches tenant-specific securityLevel`);
        return true;
      }
      return false;
    });
  };

  const getFlexWorkers = () => {
    console.log(`Filtering for Flex workers, tenantId: ${tenantId}`);
    console.log('All contacts:', contacts);
    
    return contacts.filter((c: any) => {
      console.log(`Checking worker ${c.firstName} ${c.lastName} for Flex:`, {
        directSecurityLevel: c.securityLevel,
        tenantIds: c.tenantIds,
        tenantSpecificLevel: c.tenantIds?.[tenantId]?.securityLevel
      });
      
      // Check direct securityLevel field (old structure)
      if (c.securityLevel === 3 || c.securityLevel === '3' || c.securityLevel === 'Flex') {
        console.log(`✅ Worker ${c.firstName} ${c.lastName} matches direct Flex securityLevel`);
        return true;
      }
      // Check tenantIds map (new structure)
      if (
        c.tenantIds &&
        c.tenantIds[tenantId] &&
        (
          c.tenantIds[tenantId].securityLevel === 3 ||
          c.tenantIds[tenantId].securityLevel === '3' ||
          c.tenantIds[tenantId].securityLevel === 'Flex'
        )
      ) {
        console.log(`✅ Worker ${c.firstName} ${c.lastName} matches tenant-specific Flex securityLevel`);
        return true;
      }
      return false;
    });
  };

  // Helper functions for pending invites sorting and filtering
  const getSortedAndFilteredPendingInvites = () => {
    const filtered = pendingInvites.filter((invite: any) => {
      const fullName = `${invite.firstName || invite.lastName || ''}`.toLowerCase();
      return fullName.includes(pendingInvitesSearch.toLowerCase());
    });

    const sorted = [...filtered].sort((a: any, b: any) => {
      let aValue: any;
      let bValue: any;

      switch (pendingInvitesOrderBy) {
        case 'name':
          aValue = `${a.firstName || ''} ${a.lastName || ''}`.toLowerCase();
          bValue = `${b.firstName || ''} ${b.lastName || ''}`.toLowerCase();
          break;
        case 'email':
          aValue = (a.email || '').toLowerCase();
          bValue = (b.email || '').toLowerCase();
          break;
        case 'department':
          const aDept = departments.find(d => d.id === a.departmentId)?.name || '';
          const bDept = departments.find(d => d.id === b.departmentId)?.name || '';
          aValue = aDept.toLowerCase();
          bValue = bDept.toLowerCase();
          break;
        case 'role':
          aValue = (a.tenantIds && a.tenantIds[tenantId]?.role) || '';
          bValue = (b.tenantIds && b.tenantIds[tenantId]?.role) || '';
          aValue = aValue.toLowerCase();
          bValue = bValue.toLowerCase();
          break;
        case 'inviteSentAt':
          aValue = a.inviteSentAt?.toDate ? a.inviteSentAt.toDate() : new Date(0);
          bValue = b.inviteSentAt?.toDate ? b.inviteSentAt.toDate() : new Date(0);
          break;
        default:
          return 0;
      }

      if (pendingInvitesOrder === 'asc') {
        return aValue < bValue ? -1 : aValue > bValue ? 1 : 0;
      } else {
         return aValue > bValue ? -1 : aValue < bValue ? 1 : 0;;
      }
    });

    return sorted;
  };

  const handlePendingInvitesSort = (property: 'name' | 'email' | 'department' | 'role' | 'inviteSentAt') => {
    const isAsc = pendingInvitesOrderBy === property && pendingInvitesOrder === 'asc';
    setPendingInvitesOrder(isAsc ? 'desc' : 'asc');
    setPendingInvitesOrderBy(property);
  };

  const handleChange = (field: string, value: string | string[] | boolean | Date) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleChange('phone', formatPhoneNumber(e.target.value));
  };

  const isFormValid = Boolean(
    form.firstName && 
    form.lastName && 
    form.email && 
    form.phone && 
    form.securityLevel && 
    form.employmentType && 
    form.workStatus &&
    form.departmentId
  );

  const handleWorkerSelection = (workerId: string) => {
    setSelectedWorkers((prev) =>
      prev.includes(workerId) ? prev.filter((id) => id !== workerId) : [...prev, workerId],
    );
  };

  const handleSelectAll = () => {
    if (selectedWorkers.length === contacts.length) {
      setSelectedWorkers([]);
    } else {
      setSelectedWorkers(contacts.map((contact) => contact.id));
    }
  };

  const handleBroadcastSuccess = (result: any) => {
    setSuccess(true);
    setSelectedWorkers([]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantId) return;
    setLoading(true);
    setError('');
    try {
      // Call the inviteUserV2 function instead of directly adding to Firestore
      const functions = getFunctions();
      const inviteUser = httpsCallable(functions, 'inviteUserV2');
      
      // Build payload with the required structure
      const payload: any = {
        email: form.email,
        firstName: form.firstName,
        lastName: form.lastName,
        phone: form.phone,
        displayName: `${form.firstName} ${form.lastName}`,
        jobTitle: form.jobTitle,
        department: form.departmentId,
        locationIds: form.locationIds,
        securityLevel: form.securityLevel,
        role: 'Tenant',
        tenantId: tenantId,
        // Additional fields for geocoding
        street: form.street,
        city: form.city,
        state: form.state,
        zip: form.zip,
        dateOfBirth: form.dateOfBirth,
        gender: form.gender,
        employmentType: form.employmentType,
        startDate: form.startDate,
        workStatus: form.workStatus,
        workerId: form.workerId,
        union: form.union,
        workEligibility: form.workEligibility,
        languages: form.languages,
        userGroupIds: selectedUserGroups,
      };
      
      console.log('Sending inviteUserV2 payload:', payload);
      const result = await inviteUser(payload);
      console.log('InviteUserV2 result:', result);
      setForm({
        // Basic Identity
        firstName: '',
        lastName: '',
        preferredName: '',
        email: '',
        phone: '',
        dateOfBirth: '',
        gender: '',
        
        // Employment Classification
        securityLevel: '5',
        employmentType: 'Full-Time',
        jobTitle: '',
        departmentId: '',
        divisionId: '',
        locationId: '',
        managerId: '',
        
        // Metadata & Structure
        startDate: '',
        workStatus: 'Active',
        workerId: '',
        union: '',
        workEligibility: false,
        languages: [],
        
        // Legacy fields for backward compatibility
        locationIds: [],
        street: '',
        city: '',
        state: '',
        zip: '',
        dob: '',
      });
      setSelectedUserGroups([]);
      setSuccess(true);
      await fetchDepartments();
      await fetchLocations();
      await fetchContacts();
    } catch (err: any) {
      setError(err.message || 'Failed to add worker');
    }
    setLoading(false);
  };

  const handleCSVImport = async (workers: CSVWorkerData[]) => {
    setLoading(true);
    setError('');
    let successCount = 0;
    let errorCount = 0;
    const errors: string[] = [];

    try {
      const functions = getFunctions();
      const inviteUser = httpsCallable(functions, 'inviteUserV2');
      
      for (const worker of workers) {
        try {
          // Check if email already exists
          const emailQuery = query(collection(db, 'users'), where('email', '==', worker.email));
          const emailSnapshot = await getDocs(emailQuery);
          if (!emailSnapshot.empty) {
            errors.push(`Email ${worker.email} already exists`);
            errorCount++;
            continue;
          }

          // Build payload for inviteUserV2
          const payload: any = {
            email: worker.email,
            firstName: worker.firstName,
            lastName: worker.lastName,
            phone: worker.phone || '',
            displayName: `${worker.firstName} ${worker.lastName}`,
            jobTitle: worker.jobTitle || '',
            department: worker.departmentId || '',
            locationIds: worker.locationId ? [worker.locationId] : [],
            securityLevel: '5',
            role: 'Tenant',
            tenantId: tenantId,
            // Additional fields
            dateOfBirth: worker.dateOfBirth,
            street: '',
            city: '',
            state: '',
            zip: '',
          };

          // Call inviteUserV2 function
          await inviteUser(payload);
          successCount++;
        } catch (err: any) {
          errors.push(`Failed to add ${worker.email}: ${err.message}`);
          errorCount++;
        }
      }

      // Show results
      if (successCount > 0) {
        setSuccess(true);
        await fetchContacts();
      }
      
      if (errorCount > 0) {
        setError(`Import completed with ${errorCount} error(s): ${errors.slice(0, 3).join(', ')}${errors.length > 3 ? '...' : ''}`);
      }

      setShowCSVUpload(false);
    } catch (err: any) {
      setError(err.message || 'Failed to import workers');
    }
    setLoading(false);
  };

  const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
    // Adjust the index for pending invites based on whether it's a staffing company and flex module is enabled
    const pendingInvitesIndex = isStaffingCompany 
      ? (flexModuleEnabled ? 6 : 5) 
      : (flexModuleEnabled ? 5 : 4);
    if (newValue === pendingInvitesIndex) fetchPendingInvites();
  };

  const functions = getFunctions();

  // Resend invite
  const handleResendInvite = async (invite: any) => {
    setLoading(true);
    setError('');
    try {
      const resendInvite = httpsCallable(functions, 'resendInviteV2');
      await resendInvite({ email: invite.email });
      setSuccess(true);
    } catch (err: any) {
      setError(err.message || 'Failed to resend invite');
    }
    setLoading(false);
  };

  // Revoke invite
  const handleRevokeInvite = async (invite: any) => {
    setLoading(true);
    setError('');
    try {
      // Set inviteStatus to 'revoked' in Firestore
      await updateDoc(doc(db, 'users', invite.id), { inviteStatus: 'revoked', inviteRevokedAt: serverTimestamp() });
      setPendingInvites((prev) => prev.filter((i) => i.id !== invite.id));
      setSuccess(true);
    } catch (err: any) {
      setError(err.message || 'Failed to revoke invite');
    }
    setLoading(false);
  };

  if (!tenantId) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <Typography variant="h6" color="error">
          No agency ID found. Please log in as an agency user.
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 0 }}>
      {/* Debug info */}
      {/* <Box sx={{ mb:2, p: 1, bgcolor: 'grey.100', borderRadius: 1 }}>
        <Typography variant="body2" color="text.secondary">
          Debug: Current tenantId = {tenantId}
        </Typography>
      </Box> */}
      
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
        <Typography variant="h3" gutterBottom>
          Workforce Management
        </Typography>
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
          aria-label="workforce management tabs"
        >
          <Tab label="Company Directory" />
          {isStaffingCompany && <Tab label="Hired Staff" />}
          {flexModuleEnabled && <Tab label="Flex Workers" />}
          <Tab label="User Groups" />
          <Tab label="Add Workers" />
          <Tab label="Integrations" />
          <Tab label="Pending Invites" />
        </Tabs>
      </Paper>
      {/* Tab Panels */}
      {tabValue === 0 && (
        <Box>
          {/* Company Directory header with search */}
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="h6">Workers ({getWorkersBySecurityLevel(5).length})</Typography>
            <TextField
              size="small"
              variant="outlined"
              placeholder="Search workers..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              sx={{ width: 300 }}
            />
          </Box>
          <WorkersTable
            contacts={getWorkersBySecurityLevel(5)}
            locations={locations}
            departments={departments}
            selectedWorkers={selectedWorkers}
            handleWorkerSelection={handleWorkerSelection}
            handleSelectAll={handleSelectAll}
            navigateToUser={(userId) => navigate(`/users/${userId}`)}
            contextType="agency"
            loading={locationsLoading}
            search={search}
            onSearchChange={setSearch}
          />
        </Box>
      )}
      {tabValue === 1 && isStaffingCompany && (
        <Box>
          {/* Hired Staff header with search */}
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="h6">Hired Staff ({getWorkersBySecurityLevel(4).length})</Typography>
            <TextField
              size="small"
              variant="outlined"
              placeholder="Search hired staff..."
              value={hiredStaffSearch}
              onChange={e => setHiredStaffSearch(e.target.value)}
              sx={{ width: 300 }}
            />
          </Box>
          <WorkersTable
            contacts={getWorkersBySecurityLevel(4)}
            locations={locations}
            departments={departments}
            selectedWorkers={selectedWorkers}
            handleWorkerSelection={handleWorkerSelection}
            handleSelectAll={handleSelectAll}
            navigateToUser={(userId) => navigate(`/users/${userId}`)}
            contextType="agency"
            loading={locationsLoading}
            search={hiredStaffSearch}
            onSearchChange={setHiredStaffSearch}
          />
        </Box>
      )}
      {tabValue === (isStaffingCompany ? 2 : 1) && flexModuleEnabled && (
        <Box>
          {/* Flex Workers header with search */}
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="h6">Flex Workers ({getFlexWorkers().length})</Typography>
            <TextField
              size="small"
              variant="outlined"
              placeholder="Search flex workers..."
              value={flexSearch}
              onChange={e => setFlexSearch(e.target.value)}
              sx={{ width: 300 }}
            />
          </Box>
          <WorkersTable
            contacts={getFlexWorkers()}
            locations={locations}
            departments={departments}
            selectedWorkers={selectedWorkers}
            handleWorkerSelection={handleWorkerSelection}
            handleSelectAll={handleSelectAll}
            navigateToUser={(userId) => navigate(`/users/${userId}`)}
            contextType="agency"
            loading={locationsLoading}
            search={flexSearch}
            onSearchChange={setFlexSearch}
          />
        </Box>
      )}
      {tabValue === (isStaffingCompany ? (flexModuleEnabled ? 3 : 2) : (flexModuleEnabled ? 2 : 1)) && (
        <Box>
          <TenantUserGroups />
        </Box>
      )}
      {tabValue === (isStaffingCompany ? (flexModuleEnabled ? 4 : 3) : (flexModuleEnabled ? 3 : 2)) && (
        <Box>
          {/* Import Mode Toggle */}
          <Box sx={{ mb: 0 }}>
            <Typography variant="h6" gutterBottom>
              Add Workers
            </Typography>
            <ToggleButtonGroup
              value={importMode}
              exclusive
              onChange={(_, newMode) => newMode && setImportMode(newMode)}
              aria-label="import mode"
              sx={{ mb: 2 }}
            >
              <ToggleButton value="form" aria-label="individual form">
                Individual Form
              </ToggleButton>
              <ToggleButton value="csv" aria-label="csv upload">
                CSV Upload
              </ToggleButton>
            </ToggleButtonGroup>
          </Box>

          {/* Individual Form Mode */}
          {importMode === 'form' && (
            <Box>
              <Button
                variant="contained"
                color="primary"
                onClick={() => setShowForm(true)}
                sx={{ mb: 2 }}
              >
                Add New Worker
              </Button>
              {showForm && (
                <Paper sx={{ p: 3, mb: 3 }}>
                  <AddWorkerForm
                    form={form}
                    onChange={handleChange}
                    onPhoneChange={handlePhoneChange}
                    onSubmit={handleSubmit}
                    loading={loading}
                    departments={departments}
                    locations={locations}
                    divisions={divisions}
                    managers={managers}
                    userGroups={userGroups}
                    selectedUserGroups={selectedUserGroups}
                    setSelectedUserGroups={setSelectedUserGroups}
                    showForm={showForm}
                    setShowForm={setShowForm}
                    isFormValid={isFormValid}
                    jobTitles={jobTitles}
                    error={error}
                    success={success}
                    setError={setError}
                    setSuccess={setSuccess}
                    contextType="agency"
                    isStaffingCompany={isStaffingCompany}
                    flexModuleEnabled={flexModuleEnabled}
                  />
                </Paper>
              )}
            </Box>
          )}

          {/* CSV Upload Mode */}
          {importMode === 'csv' && (
            <Box>
              {!showCSVUpload ? (
                <Button
                  variant="contained"
                  color="primary"
                  onClick={() => setShowCSVUpload(true)}
                  sx={{ mb: 2 }}
                >
                  Upload CSV File
                </Button>
              ) : (
                <CSVUpload
                  onWorkersReady={handleCSVImport}
                  onCancel={() => setShowCSVUpload(false)}
                  departments={departments}
                  locations={locations}
                  divisions={divisions}
                  managers={managers}
                />
              )}
            </Box>
          )}
        </Box>
      )}
      {tabValue === (isStaffingCompany ? (flexModuleEnabled ? 5 : 4) : (flexModuleEnabled ? 4 : 3)) && (
        <Box sx={{ p: 0 }}>
          <IntegrationsTab tenantId={tenantId} />
        </Box>
      )}
      {tabValue === (isStaffingCompany ? (flexModuleEnabled ? 6 : 5) : (flexModuleEnabled ? 5 : 4)) && (
        <Box>
          {/* Pending Invites header with search */}
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="h6">Pending Invites ({getSortedAndFilteredPendingInvites().length})</Typography>
            <TextField
              size="small"
              variant="outlined"
              placeholder="Search by name..."
              value={pendingInvitesSearch}
              onChange={e => setPendingInvitesSearch(e.target.value)}
              sx={{ width: 300 }}
            />
          </Box>
          <TableContainer component={Paper}>
            <Table>
              <TableHead>
                <TableRow sx={{ height: 48 }}>
                  <TableCell sx={{ py: 1, px: 2 }}>
                    <TableSortLabel
                      active={pendingInvitesOrderBy === 'name'}
                      direction={pendingInvitesOrderBy === 'name' ? pendingInvitesOrder : 'asc'}
                      onClick={() => handlePendingInvitesSort('name')}
                    >
                      Name
                    </TableSortLabel>
                  </TableCell>
                  <TableCell sx={{ py: 1, px: 2 }}>
                    <TableSortLabel
                      active={pendingInvitesOrderBy === 'email'}
                      direction={pendingInvitesOrderBy === 'email' ? pendingInvitesOrder : 'asc'}
                      onClick={() => handlePendingInvitesSort('email')}
                    >
                      Email
                    </TableSortLabel>
                  </TableCell>
                  <TableCell sx={{ py: 1, px: 2 }}>
                    <TableSortLabel
                      active={pendingInvitesOrderBy === 'department'}
                      direction={pendingInvitesOrderBy === 'department' ? pendingInvitesOrder : 'asc'}
                      onClick={() => handlePendingInvitesSort('department')}
                    >
                      Department
                    </TableSortLabel>
                  </TableCell>
                  <TableCell sx={{ py: 1, px: 2 }}>
                    <TableSortLabel
                      active={pendingInvitesOrderBy === 'role'}
                      direction={pendingInvitesOrderBy === 'role' ? pendingInvitesOrder : 'asc'}
                      onClick={() => handlePendingInvitesSort('role')}
                    >
                      Role
                    </TableSortLabel>
                  </TableCell>
                  <TableCell sx={{ py: 1, px: 2 }}>
                    <TableSortLabel
                      active={pendingInvitesOrderBy === 'inviteSentAt'}
                      direction={pendingInvitesOrderBy === 'inviteSentAt' ? pendingInvitesOrder : 'asc'}
                      onClick={() => handlePendingInvitesSort('inviteSentAt')}
                    >
                      Invite Sent At
                    </TableSortLabel>
                  </TableCell>
                  <TableCell sx={{ py: 1, px: 2 }}>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {getSortedAndFilteredPendingInvites().map((invite) => (
                  <TableRow key={invite.id}>
                    <TableCell>{invite.firstName} {invite.lastName}</TableCell>
                    <TableCell>{invite.email}</TableCell>
                    <TableCell>{departments.find(d => d.id === invite.departmentId)?.name || ''}</TableCell>
                    <TableCell>{invite.tenantIds && invite.tenantIds[tenantId]?.role}</TableCell>
                    <TableCell>{invite.inviteSentAt?.toDate ? invite.inviteSentAt.toDate().toLocaleString() : ''}</TableCell>
                    <TableCell>
                      <Button size="small" variant="outlined" onClick={() => handleResendInvite(invite)} sx={{ mr: 1 }}>Resend</Button>
                      <Button size="small" variant="outlined" color="error" onClick={() => handleRevokeInvite(invite)}>Revoke</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      )}
      {/* Snackbars and Dialogs remain outside tab panels */}
      <Snackbar open={!!error} autoHideDuration={4000} onClose={() => setError('')}>
        <Alert severity="error" onClose={() => setError('')} sx={{ width: '100%' }}>
          {error}
        </Alert>
      </Snackbar>
      <Snackbar open={success} autoHideDuration={2000} onClose={() => setSuccess(false)}>
        <Alert severity="success" sx={{ width: '100%' }}>
          Worker added!
        </Alert>
      </Snackbar>
      {/* <BroadcastDialog
        open={showBroadcastDialog}
        onClose={() => setShowBroadcastDialog(false)}
        tenantId={tenantId}
        senderId="admin" // Replace with actual user ID
        initialAudienceFilter={{
          userIds: selectedWorkers,
        }}
        title={`Send Broadcast to ${selectedWorkers.length} Worker${
          selectedWorkers.length !== 1 ? 's' : ''
        }`}
        onSuccess={handleBroadcastSuccess}
      /> */}
    </Box>
  );
};

export default TenantWorkforce; 