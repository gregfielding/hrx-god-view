import React, { useEffect, useState } from 'react';
import { Box, Typography, Button, MenuItem, TextField, Snackbar, Alert, TableContainer, Table, TableHead, TableBody, TableRow, TableCell, Paper } from '@mui/material';
import { doc, getDoc, updateDoc, collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../../firebase';
import { useNavigate } from 'react-router-dom';

interface CustomersTabProps {
  agencyId: string;
}

const CustomersTab: React.FC<CustomersTabProps> = ({ agencyId }) => {
  const [allCustomers, setAllCustomers] = useState<any[]>([]);
  const [associatedCustomers, setAssociatedCustomers] = useState<any[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState('');
  const [currentCustomerIds, setCurrentCustomerIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    fetchAllCustomers();
    fetchAssociatedCustomers();
    // eslint-disable-next-line
  }, [agencyId]);

  const fetchAllCustomers = async () => {
    try {
      const q = collection(db, 'customers');
      const snapshot = await getDocs(q);
      setAllCustomers(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    } catch (err: any) {
      setError(err.message || 'Failed to fetch customers');
    }
  };

  const fetchAssociatedCustomers = async () => {
    try {
      const agencyRef = doc(db, 'agencies', agencyId);
      const agencySnap = await getDoc(agencyRef);
      let customerIds: string[] = [];
      if (agencySnap.exists()) {
        customerIds = agencySnap.data().customerIds || [];
      }
      setCurrentCustomerIds(customerIds);
      if (customerIds.length > 0) {
        const customers = await Promise.all(
          customerIds.map(async (id) => {
            const customerSnap = await getDoc(doc(db, 'customers', id));
            return customerSnap.exists() ? { id, ...customerSnap.data() } : null;
          })
        );
        setAssociatedCustomers(customers.filter(Boolean));
      } else {
        setAssociatedCustomers([]);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch associated customers');
    }
  };

  const handleAddCustomer = async () => {
    if (!selectedCustomer) return;
    setLoading(true);
    setError('');
    try {
      const agencyRef = doc(db, 'agencies', agencyId);
      const agencySnap = await getDoc(agencyRef);
      let customerIds: string[] = [];
      if (agencySnap.exists()) {
        customerIds = agencySnap.data().customerIds || [];
      }
      if (!customerIds.includes(selectedCustomer)) {
        customerIds.push(selectedCustomer);
        await updateDoc(agencyRef, { customerIds });
      }
      setSelectedCustomer('');
      fetchAssociatedCustomers();
      setSuccess(true);
    } catch (err: any) {
      setError(err.message || 'Failed to add customer');
    }
    setLoading(false);
  };

  const handleRemoveCustomer = async (customerId: string) => {
    setLoading(true);
    setError('');
    try {
      const agencyRef = doc(db, 'agencies', agencyId);
      const agencySnap = await getDoc(agencyRef);
      let customerIds: string[] = [];
      if (agencySnap.exists()) {
        customerIds = agencySnap.data().customerIds || [];
      }
      customerIds = customerIds.filter((id) => id !== customerId);
      await updateDoc(agencyRef, { customerIds });
      fetchAssociatedCustomers();
      setSuccess(true);
    } catch (err: any) {
      setError(err.message || 'Failed to remove customer');
    }
    setLoading(false);
  };

  // Only show customers not already associated
  const availableCustomers = allCustomers.filter(c => !currentCustomerIds.includes(c.id));

  return (
    <Box sx={{ p: 2, width: '100%' }}>
      <Typography variant="h6" gutterBottom>Associated Customers</Typography>
      <Box display="flex" gap={2} mb={2}>
        <TextField
          select
          label="Add Customer"
          value={selectedCustomer}
          onChange={e => setSelectedCustomer(e.target.value)}
          sx={{ minWidth: 250 }}
        >
          {availableCustomers.map((customer) => (
            <MenuItem key={customer.id} value={customer.id}>{customer.name}</MenuItem>
          ))}
        </TextField>
        <Button variant="contained" onClick={handleAddCustomer} disabled={!selectedCustomer || loading}>
          Add
        </Button>
      </Box>
      <Typography variant="h6" gutterBottom>Associated Customers</Typography>
      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Address</TableCell>
              <TableCell>View</TableCell>
              <TableCell>Remove</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {associatedCustomers.length === 0 ? (
              <TableRow><TableCell colSpan={4}>No customers associated.</TableCell></TableRow>
            ) : (
              associatedCustomers.map((customer) => (
                <TableRow key={customer.id}>
                  <TableCell>{customer.name}</TableCell>
                  <TableCell>{customer.address ? `${customer.address.street}, ${customer.address.city}, ${customer.address.state} ${customer.address.zip}` : '-'}</TableCell>
                  <TableCell>
                    <Button size="small" variant="outlined" onClick={() => navigate(`/customers/${customer.id}`)}>View</Button>
                  </TableCell>
                  <TableCell>
                    <Button size="small" variant="outlined" color="error" onClick={() => handleRemoveCustomer(customer.id)}>Remove</Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>
      <Snackbar open={!!error} autoHideDuration={4000} onClose={() => setError('')}>
        <Alert severity="error" onClose={() => setError('')} sx={{ width: '100%' }}>{error}</Alert>
      </Snackbar>
      <Snackbar open={success} autoHideDuration={2000} onClose={() => setSuccess(false)}>
        <Alert severity="success" sx={{ width: '100%' }}>Customer association updated!</Alert>
      </Snackbar>
    </Box>
  );
};

export default CustomersTab; 