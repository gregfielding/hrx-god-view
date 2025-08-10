import React, { useEffect, useState } from 'react';
import { Box, Typography, Button, MenuItem, TextField, Snackbar, Alert } from '@mui/material';
import { doc, getDoc, updateDoc, collection, getDocs } from 'firebase/firestore';

import { db } from '../../../firebase';

interface AgencyTabProps {
  tenantId: string;
}

const AgencyTab: React.FC<AgencyTabProps> = ({ tenantId }) => {
  const [tenants, setTenants] = useState<any[]>([]);
  const [selectedTenant, setSelectedTenant] = useState('');
  const [currentTenant, setCurrentTenant] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchTenants();
    fetchCurrentTenant();
    // eslint-disable-next-line
  }, [tenantId]);

  const fetchTenants = async () => {
    try {
      const q = collection(db, 'tenants');
      const snapshot = await getDocs(q);
      setTenants(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    } catch (err: any) {
      setError(err.message || 'Failed to fetch tenants');
    }
  };

  const fetchCurrentTenant = async () => {
    try {
      const customerRef = doc(db, 'tenants', tenantId);
      const snap = await getDoc(customerRef);
      if (snap.exists()) {
        const data = snap.data();
        if (data.tenantId) {
          setSelectedTenant(data.tenantId);
          // Fetch tenant name
          const tenantRef = doc(db, 'tenants', data.tenantId);
          const tenantSnap = await getDoc(tenantRef);
          if (tenantSnap.exists()) {
            setCurrentTenant({ id: data.tenantId, ...tenantSnap.data() });
          }
        } else {
          setSelectedTenant('');
          setCurrentTenant(null);
        }
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch current tenant');
    }
  };

  const handleSave = async () => {
    setLoading(true);
    setError('');
    try {
      const customerRef = doc(db, 'tenants', tenantId);
      await updateDoc(customerRef, { tenantId: selectedTenant });
      // Add tenantId to tenant's tenants array
      const tenantRef = doc(db, 'tenants', selectedTenant);
      const tenantSnap = await getDoc(tenantRef);
      let tenants: string[] = [];
      if (tenantSnap.exists()) {
        tenants = tenantSnap.data().tenants || [];
      }
      if (!tenants.includes(tenantId)) {
        tenants.push(tenantId);
        await updateDoc(tenantRef, { tenants });
      }
      setSuccess(true);
      fetchCurrentTenant();
    } catch (err: any) {
      setError(err.message || 'Failed to associate tenant');
    }
    setLoading(false);
  };

  const handleRemove = async () => {
    setLoading(true);
    setError('');
    try {
      const customerRef = doc(db, 'tenants', tenantId);
      await updateDoc(customerRef, { tenantId: null });
      // Remove tenantId from tenant's tenants array
      if (currentTenant) {
        const tenantRef = doc(db, 'tenants', currentTenant.id);
        const tenantSnap = await getDoc(tenantRef);
        let tenants: string[] = [];
        if (tenantSnap.exists()) {
          tenants = tenantSnap.data().tenants || [];
        }
        tenants = tenants.filter((id) => id !== tenantId);
        await updateDoc(tenantRef, { tenants });
      }
      setSuccess(true);
      setCurrentTenant(null);
      setSelectedTenant('');
    } catch (err: any) {
      setError(err.message || 'Failed to remove tenant association');
    }
    setLoading(false);
  };

  return (
    <Box sx={{ p: 2, maxWidth: 500, mx: 'auto' }}>
      <Typography variant="h6" gutterBottom>
        Associated Agency
      </Typography>
      {currentTenant ? (
        <Box display="flex" alignItems="center" gap={2} mb={2}>
          <Typography>{currentTenant.name}</Typography>
          <Button variant="outlined" color="error" onClick={handleRemove} disabled={loading}>
            Remove
          </Button>
        </Box>
      ) : (
        <Box display="flex" alignItems="center" gap={2} mb={2}>
          <TextField
            select
            label="Select Agency"
            value={selectedTenant}
            onChange={(e) => setSelectedTenant(e.target.value)}
            fullWidth
          >
            {tenants.map((tenant) => (
              <MenuItem key={tenant.id} value={tenant.id}>
                {tenant.name}
              </MenuItem>
            ))}
          </TextField>
          <Button variant="contained" onClick={handleSave} disabled={!selectedTenant || loading}>
            Save
          </Button>
        </Box>
      )}
      <Snackbar open={!!error} autoHideDuration={4000} onClose={() => setError('')}>
        <Alert severity="error" onClose={() => setError('')} sx={{ width: '100%' }}>
          {error}
        </Alert>
      </Snackbar>
      <Snackbar open={success} autoHideDuration={2000} onClose={() => setSuccess(false)}>
        <Alert severity="success" sx={{ width: '100%' }}>
          Agency association updated!
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default AgencyTab;
