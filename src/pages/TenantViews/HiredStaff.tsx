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

const HiredStaff: React.FC = () => {
  const { tenantId, activeTenant } = useAuth();
  const navigate = useNavigate();
  
  const effectiveTenantId = activeTenant?.id || tenantId;
  
  const [contacts, setContacts] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [divisions, setDivisions] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');

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
        fetchDivisions()
      ]);
    } catch (error) {
      console.error('Error fetching hired staff data:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchContacts = async () => {
    if (!effectiveTenantId) return;
    
    try {
      const functions = getFunctions();
      const getUsersByTenantFn = httpsCallable(functions, 'getUsersByTenant');
      
      const result = await getUsersByTenantFn({ tenantId: effectiveTenantId });
      const data = result.data as { users: any[], count: number };
      
      setContacts(data.users || []);
    } catch (err: any) {
      console.error('Error fetching contacts:', err);
      // Fallback to direct Firestore query
      try {
        const fallbackQuery = query(
          collection(db, 'users'),
          where('tenantId', '==', effectiveTenantId)
        );
        const fallbackSnapshot = await getDocs(fallbackQuery);
        const fallbackUsers = fallbackSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setContacts(fallbackUsers);
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
      setLocations(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
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

  // Filter for hired staff (security level 4)
  const getHiredStaff = () => {
    return contacts.filter((c: any) => {
      let workerLevel: any = null;
      
      // Check tenantIds map first (new structure)
      if (c.tenantIds && c.tenantIds[tenantId]) {
        workerLevel = c.tenantIds[tenantId].securityLevel;
      }
      // Fall back to direct securityLevel field (old structure)
      else if (c.securityLevel) {
        workerLevel = c.securityLevel;
      }
      
      // Check if worker has security level 4
      return workerLevel === 4 || workerLevel === '4';
    });
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 4 }}>
        <CircularProgress />
        <Typography variant="body1" sx={{ ml: 2 }}>
          Loading hired staff...
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 0 }}>
      {/* Header with search */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6">Hired Staff ({getHiredStaff().length})</Typography>
        <TextField
          size="small"
          variant="outlined"
          placeholder="Search hired staff..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          sx={{ width: 300 }}
        />
      </Box>
      
      <WorkersTable
        contacts={getHiredStaff()}
        locations={locations}
        departments={departments}
        divisions={divisions}
        selectedWorkers={[]}
        handleWorkerSelection={() => {}}
        handleSelectAll={() => {}}
        navigateToUser={(userId) => navigate(`/users/${userId}`)}
        contextType="agency"
        loading={false}
        search={search}
        onSearchChange={setSearch}
      />
    </Box>
  );
};

export default HiredStaff;
