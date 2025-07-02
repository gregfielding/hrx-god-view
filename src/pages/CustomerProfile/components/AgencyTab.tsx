import React, { useEffect, useState } from 'react';
import { Box, Typography, Button, MenuItem, TextField, Snackbar, Alert } from '@mui/material';
import { doc, getDoc, updateDoc, collection, getDocs } from 'firebase/firestore';
import { db } from '../../../firebase';

interface AgencyTabProps {
  customerId: string;
}

const AgencyTab: React.FC<AgencyTabProps> = ({ customerId }) => {
  const [agencies, setAgencies] = useState<any[]>([]);
  const [selectedAgency, setSelectedAgency] = useState('');
  const [currentAgency, setCurrentAgency] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchAgencies();
    fetchCurrentAgency();
    // eslint-disable-next-line
  }, [customerId]);

  const fetchAgencies = async () => {
    try {
      const q = collection(db, 'agencies');
      const snapshot = await getDocs(q);
      setAgencies(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    } catch (err: any) {
      setError(err.message || 'Failed to fetch agencies');
    }
  };

  const fetchCurrentAgency = async () => {
    try {
      const customerRef = doc(db, 'customers', customerId);
      const snap = await getDoc(customerRef);
      if (snap.exists()) {
        const data = snap.data();
        if (data.agencyId) {
          setSelectedAgency(data.agencyId);
          // Fetch agency name
          const agencyRef = doc(db, 'agencies', data.agencyId);
          const agencySnap = await getDoc(agencyRef);
          if (agencySnap.exists()) {
            setCurrentAgency({ id: data.agencyId, ...agencySnap.data() });
          }
        } else {
          setSelectedAgency('');
          setCurrentAgency(null);
        }
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch current agency');
    }
  };

  const handleSave = async () => {
    setLoading(true);
    setError('');
    try {
      const customerRef = doc(db, 'customers', customerId);
      await updateDoc(customerRef, { agencyId: selectedAgency });
      // Add customerId to agency's customerIds array
      const agencyRef = doc(db, 'agencies', selectedAgency);
      const agencySnap = await getDoc(agencyRef);
      let customerIds: string[] = [];
      if (agencySnap.exists()) {
        customerIds = agencySnap.data().customerIds || [];
      }
      if (!customerIds.includes(customerId)) {
        customerIds.push(customerId);
        await updateDoc(agencyRef, { customerIds });
      }
      setSuccess(true);
      fetchCurrentAgency();
    } catch (err: any) {
      setError(err.message || 'Failed to associate agency');
    }
    setLoading(false);
  };

  const handleRemove = async () => {
    setLoading(true);
    setError('');
    try {
      const customerRef = doc(db, 'customers', customerId);
      await updateDoc(customerRef, { agencyId: null });
      // Remove customerId from agency's customerIds array
      if (currentAgency) {
        const agencyRef = doc(db, 'agencies', currentAgency.id);
        const agencySnap = await getDoc(agencyRef);
        let customerIds: string[] = [];
        if (agencySnap.exists()) {
          customerIds = agencySnap.data().customerIds || [];
        }
        customerIds = customerIds.filter((id) => id !== customerId);
        await updateDoc(agencyRef, { customerIds });
      }
      setSuccess(true);
      setCurrentAgency(null);
      setSelectedAgency('');
    } catch (err: any) {
      setError(err.message || 'Failed to remove agency association');
    }
    setLoading(false);
  };

  return (
    <Box sx={{ p: 2, maxWidth: 500, mx: 'auto' }}>
      <Typography variant="h6" gutterBottom>Associated Agency</Typography>
      {currentAgency ? (
        <Box display="flex" alignItems="center" gap={2} mb={2}>
          <Typography>{currentAgency.name}</Typography>
          <Button variant="outlined" color="error" onClick={handleRemove} disabled={loading}>
            Remove
          </Button>
        </Box>
      ) : (
        <Box display="flex" alignItems="center" gap={2} mb={2}>
          <TextField
            select
            label="Select Agency"
            value={selectedAgency}
            onChange={e => setSelectedAgency(e.target.value)}
            fullWidth
          >
            {agencies.map((agency) => (
              <MenuItem key={agency.id} value={agency.id}>{agency.name}</MenuItem>
            ))}
          </TextField>
          <Button variant="contained" onClick={handleSave} disabled={!selectedAgency || loading}>
            Save
          </Button>
        </Box>
      )}
      <Snackbar open={!!error} autoHideDuration={4000} onClose={() => setError('')}>
        <Alert severity="error" onClose={() => setError('')} sx={{ width: '100%' }}>{error}</Alert>
      </Snackbar>
      <Snackbar open={success} autoHideDuration={2000} onClose={() => setSuccess(false)}>
        <Alert severity="success" sx={{ width: '100%' }}>Agency association updated!</Alert>
      </Snackbar>
    </Box>
  );
};

export default AgencyTab; 