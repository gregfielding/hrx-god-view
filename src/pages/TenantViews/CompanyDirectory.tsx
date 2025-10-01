import React, { useEffect, useState } from 'react';
import {
  Box,
  Typography,
  TextField,
  CircularProgress,
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { collection, getDocs, query, where } from 'firebase/firestore';

import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import WorkersTable from '../../componentBlocks/WorkersTable';

const CompanyDirectory: React.FC = () => {
  const { tenantId, activeTenant } = useAuth();
  const navigate = useNavigate();
  
  const effectiveTenantId = activeTenant?.id || tenantId;
  
  const [contacts, setContacts] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [divisions, setDivisions] = useState<any[]>([]);
  const [regions, setRegions] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');

  // Create breadcrumb path
  const breadcrumbPath = [
    { label: 'Workforce Management', href: '/workforce' },
    { label: 'Company Directory' }
  ];

  useEffect(() => {
    if (effectiveTenantId) {
      fetchData();
    }
  }, [effectiveTenantId]);

  const fetchData = async () => {
    if (!effectiveTenantId) return;
    
    setLoading(true);
    try {
      // Fetch all data in parallel
      await Promise.all([
        fetchContacts(),
        fetchLocations(),
        fetchDepartments(),
        fetchDivisions(),
        fetchRegions()
      ]);
    } catch (error) {
      console.error('Error fetching company directory data:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchContacts = async () => {
    if (!effectiveTenantId) return;
    
    try {
      const functions = getFunctions();
      const getUsersByTenantFn = httpsCallable(functions, 'getUsersByTenant');
      
      const result = await getUsersByTenantFn({ 
        tenantId: effectiveTenantId,
        _cacheBust: Date.now() // Force fresh data
      });
      const data = result.data as { users: any[], count: number };
      
      // Debug: Log all users to see their data structure
      console.log('All users from Cloud Function:', data.users?.map(u => ({
        id: u.id,
        firstName: u.firstName,
        lastName: u.lastName,
        securityLevel: u.securityLevel,
        tenantId: u.tenantId,
        tenantIds: u.tenantIds,
        locationId: u.locationId,
        regionId: u.regionId,
        regionName: u.regionName
      })));
      
      setContacts(data.users || []);
    } catch (err: any) {
      console.error('Error fetching contacts:', err);
      // Fallback to direct Firestore query - get all users and filter in memory
      try {
        console.log('Using fallback query to fetch users...');
        const allUsersSnapshot = await getDocs(collection(db, 'users'));
        const allUsers = allUsersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
        // Filter for users in this tenant (both old and new structures)
        const tenantUsers = allUsers.filter((user: any) => {
          // Check direct tenantId field (old structure)
          if (user.tenantId === effectiveTenantId) return true;
          
          // Check tenantIds map (new structure)
          if (user.tenantIds && user.tenantIds[effectiveTenantId]) return true;
          
          return false;
        });
        
        console.log(`Fallback query found ${tenantUsers.length} users for tenant ${effectiveTenantId}`);
        setContacts(tenantUsers);
      } catch (fallbackErr) {
        console.error('Fallback query also failed:', fallbackErr);
        setContacts([]);
      }
    }
  };

  const fetchLocations = async () => {
    if (!effectiveTenantId) return;
    try {
      const q = query(collection(db, 'tenants', effectiveTenantId, 'locations'));
      const snapshot = await getDocs(q);
      const locationData = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      
      // Debug: Log location data to see the structure
      console.log('Fetched locations:', locationData.map((loc: any) => ({
        id: loc.id,
        nickname: loc.nickname,
        name: loc.name,
        primaryContacts: loc.primaryContacts
      })));
      
      setLocations(locationData);
    } catch (err: any) {
      console.warn('Could not fetch locations:', err);
      setLocations([]);
    }
  };

  const fetchDepartments = async () => {
    if (!effectiveTenantId) return;
    try {
      const q = collection(db, 'tenants', effectiveTenantId, 'departments');
      const snapshot = await getDocs(q);
      setDepartments(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    } catch (err: any) {
      console.warn('Could not fetch departments:', err);
      setDepartments([]);
    }
  };

  const fetchDivisions = async () => {
    if (!effectiveTenantId) return;
    try {
      const q = collection(db, 'tenants', effectiveTenantId, 'divisions');
      const snapshot = await getDocs(q);
      setDivisions(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    } catch (err: any) {
      console.warn('Could not fetch divisions:', err);
      setDivisions([]);
    }
  };

  const fetchRegions = async () => {
    if (!effectiveTenantId) return;
    try {
      const q = collection(db, 'tenants', effectiveTenantId, 'regions');
      const snapshot = await getDocs(q);
      const regionData = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      
      // Debug: Log region data
      console.log('Fetched regions:', regionData.map((region: any) => ({
        id: region.id,
        name: region.name,
        shortcode: region.shortcode
      })));
      
      setRegions(regionData);
    } catch (err: any) {
      console.warn('Could not fetch regions:', err);
      setRegions([]);
    }
  };

  // Filter for company directory workers (security levels 5, 6, 7)
  const getCompanyDirectoryWorkers = () => {
    return contacts.filter((c: any) => {
      let workerLevel: any = null;
      
      // Check tenantIds map first (new structure)
      if (c.tenantIds && c.tenantIds[effectiveTenantId]) {
        workerLevel = c.tenantIds[effectiveTenantId].securityLevel;
      }
      // Fall back to direct securityLevel field (old structure)
      else if (c.securityLevel) {
        workerLevel = c.securityLevel;
      }
      
      // Debug logging
      console.log(`Worker ${c.firstName} ${c.lastName}:`, {
        tenantIds: c.tenantIds,
        effectiveTenantId,
        workerLevel,
        directSecurityLevel: c.securityLevel,
        tenantIdsEntry: c.tenantIds?.[effectiveTenantId],
        included: workerLevel === 5 || workerLevel === 6 || workerLevel === 7 || 
                  workerLevel === '5' || workerLevel === '6' || workerLevel === '7'
      });
      
      // Check if worker has security level 5, 6, or 7
      return workerLevel === 5 || workerLevel === 6 || workerLevel === 7 || 
             workerLevel === '5' || workerLevel === '6' || workerLevel === '7';
    });
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 4 }}>
        <CircularProgress />
        <Typography variant="body1" sx={{ ml: 2 }}>
          Loading company directory...
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 0 }}>
      {/* Header with search */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6">Workers ({getCompanyDirectoryWorkers().length})</Typography>
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
        contacts={getCompanyDirectoryWorkers()}
        locations={locations}
        departments={departments}
        divisions={divisions}
        regions={regions}
        selectedWorkers={[]}
        handleWorkerSelection={() => {}}
        handleSelectAll={() => {}}
        navigateToUser={(userId) => navigate(`/users/${userId}`)}
        contextType="agency"
        loading={false}
        search={search}
        onSearchChange={setSearch}
        effectiveTenantId={effectiveTenantId}
      />
    </Box>
  );
};

export default CompanyDirectory;
