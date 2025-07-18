import React, { useEffect, useState } from 'react';
import {
  Box,
  Typography,
  Button,
  MenuItem,
  TextField,
  Snackbar,
  Alert,
  Link as MuiLink,
  TableContainer,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  Paper,
} from '@mui/material';
import { doc, getDoc, updateDoc, collection, getDocs } from 'firebase/firestore';
import { db } from '../../../firebase';
import { Link, useNavigate } from 'react-router-dom';

interface CustomerWorksiteTabProps {
  userId: string;
}

const CustomerWorksiteTab: React.FC<CustomerWorksiteTabProps> = ({ userId }) => {
  const [customer, setCustomer] = useState<any>(null);
  const [locations, setLocations] = useState<any[]>([]);
  const [selectedLocations, setSelectedLocations] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    fetchCustomerAndLocations();
    // eslint-disable-next-line
  }, [userId]);

  const fetchCustomerAndLocations = async () => {
    try {
      const userRef = doc(db, 'users', userId);
      const userSnap = await getDoc(userRef);
      if (userSnap.exists()) {
        const userData = userSnap.data();
        if (userData.tenantId) {
          const customerRef = doc(db, 'tenants', userData.tenantId);
          const customerSnap = await getDoc(customerRef);
          if (customerSnap.exists()) {
            setCustomer({ id: userData.tenantId, ...customerSnap.data() });
            setSelectedLocations(userData.locationIds || []);
            // Fetch locations
            const locSnap = await getDocs(
              collection(db, 'tenants', userData.tenantId, 'locations'),
            );
            setLocations(locSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
          }
        }
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch customer or locations');
    }
  };

  const handleSave = async () => {
    setLoading(true);
    setError('');
    try {
      const userRef = doc(db, 'users', userId);
      await updateDoc(userRef, { locationIds: selectedLocations });
      setSuccess(true);
    } catch (err: any) {
      setError(err.message || 'Failed to update locations');
    }
    setLoading(false);
  };

  const handleRemoveLocation = async (locId: string) => {
    const newLocations = selectedLocations.filter((id) => id !== locId);
    setSelectedLocations(newLocations);
    setLoading(true);
    setError('');
    try {
      const userRef = doc(db, 'users', userId);
      await updateDoc(userRef, { locationIds: newLocations });
      setSuccess(true);
    } catch (err: any) {
      setError(err.message || 'Failed to remove location');
    }
    setLoading(false);
  };

  if (!customer) {
    return <Typography>No associated customer.</Typography>;
  }

  const assignedLocations = locations.filter((loc: any) => selectedLocations.includes(loc.id));

  return (
    <Box sx={{ p: 2, width: '100%' }}>
      <Typography variant="h6" gutterBottom>
        Customer (Worksite)
      </Typography>
      <Box display="flex" alignItems="center" gap={2} mb={2}>
        <Typography>Customer:</Typography>
        <Typography fontWeight={600}>{customer.name}</Typography>
        <MuiLink component={Link} to={`/tenants/${customer.id}`} underline="hover">
          View Customer
        </MuiLink>
      </Box>
      <TextField
        select
        label="Assigned Locations"
        value={selectedLocations}
        onChange={(e) =>
          setSelectedLocations(
            typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value,
          )
        }
        SelectProps={{ multiple: true }}
        fullWidth
        sx={{ mb: 2 }}
      >
        {locations.map((loc: any) => (
          <MenuItem key={loc.id} value={loc.id}>
            {loc.nickname}
          </MenuItem>
        ))}
      </TextField>
      <Button
        variant="contained"
        onClick={handleSave}
        disabled={loading || !selectedLocations.length}
        sx={{ mb: 3 }}
      >
        Save
      </Button>
      <Typography variant="h6" gutterBottom>
        Assigned Locations
      </Typography>
      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Nickname</TableCell>
              <TableCell>Address</TableCell>
              <TableCell>Remove</TableCell>
              <TableCell>View</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {assignedLocations.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4}>No assigned locations.</TableCell>
              </TableRow>
            ) : (
              assignedLocations.map((loc: any) => (
                <TableRow key={loc.id}>
                  <TableCell>{loc.nickname}</TableCell>
                  <TableCell>{`${loc.street}, ${loc.city}, ${loc.state} ${loc.zip}`}</TableCell>
                  <TableCell>
                    <Button
                      size="small"
                      variant="outlined"
                      color="error"
                      onClick={() => handleRemoveLocation(loc.id)}
                    >
                      Remove
                    </Button>
                  </TableCell>
                  <TableCell>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => navigate(`/tenants/${customer.id}/locations/${loc.id}`)}
                    >
                      View
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>
      <Snackbar open={!!error} autoHideDuration={4000} onClose={() => setError('')}>
        <Alert severity="error" onClose={() => setError('')} sx={{ width: '100%' }}>
          {error}
        </Alert>
      </Snackbar>
      <Snackbar open={success} autoHideDuration={2000} onClose={() => setSuccess(false)}>
        <Alert severity="success" sx={{ width: '100%' }}>
          Locations updated!
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default CustomerWorksiteTab;
