import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  TextField,
  Button,
  MenuItem,
  Grid,
  Card,
  CardContent,
  CardHeader,
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  FormControl,
  InputLabel,
  Select,
} from '@mui/material';
import { Edit as EditIcon, Save as SaveIcon, Cancel as CancelIcon, Add as AddIcon, Delete as DeleteIcon } from '@mui/icons-material';
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';

import { db } from '../../../../firebase';
import { backgroundCheckOptions, drugScreeningOptions, additionalScreeningOptions } from '../../../../data/screeningsOptions';
import { useAuth } from '../../../../contexts/AuthContext';
import { logCustomActivity } from '../../../../utils/activityLogger';

const orderStatusOptions = ['In-Progress', 'Cancelled', 'Complete'];
const resultOptions = ['Passed', 'Failed'];
const eVerifyResultOptions = [
  'Employment Authorized',
  'E-Verify Needs More Time',
  'Tentative Nonconfirmation',
  'Case in Continuance',
  'Close Case and Resubmit',
  'Final Nonconfirmation',
];

interface ScreeningOrder {
  id: string;
  type: string; // Value from options
  typeLabel: string; // Label for display
  dateOrdered: string;
  status: 'In-Progress' | 'Cancelled' | 'Complete';
  result?: 'Passed' | 'Failed';
  completionDate?: string;
  submittedBy?: string; // Name of person who created the order
}

interface EVerifyOrder {
  id: string;
  dateSubmitted: string;
  status: 'In-Progress' | 'Cancelled' | 'Complete';
  result?: string; // E-Verify specific result
  completionDate?: string;
  submittedBy?: string; // Name of person who created the order
}

const CombinedBackgroundAndVaccinationTab = ({ uid }: { uid: string }) => {
  const { currentUser } = useAuth();
  const [currentUserData, setCurrentUserData] = useState<{ firstName?: string; lastName?: string }>({});
  const [eVerifyOrders, setEVerifyOrders] = useState<EVerifyOrder[]>([]);
  const [backgroundCheckOrders, setBackgroundCheckOrders] = useState<ScreeningOrder[]>([]);
  const [drugScreeningOrders, setDrugScreeningOrders] = useState<ScreeningOrder[]>([]);
  const [additionalScreeningOrders, setAdditionalScreeningOrders] = useState<ScreeningOrder[]>([]);
  
  // New order form state
  const [newEVerifyOrder, setNewEVerifyOrder] = useState<{ dateSubmitted: string }>({ dateSubmitted: '' });
  const [newBackgroundCheckOrder, setNewBackgroundCheckOrder] = useState<{ type: string; dateOrdered: string }>({ type: '', dateOrdered: '' });
  const [newDrugScreeningOrder, setNewDrugScreeningOrder] = useState<{ type: string; dateOrdered: string }>({ type: '', dateOrdered: '' });
  const [newAdditionalScreeningOrder, setNewAdditionalScreeningOrder] = useState<{ type: string; dateOrdered: string }>({ type: '', dateOrdered: '' });

  // Load current user's name
  useEffect(() => {
    if (!currentUser?.uid) return;
    const fetchCurrentUserData = async () => {
      const userRef = doc(db, 'users', currentUser.uid);
      const snap = await getDoc(userRef);
      if (snap.exists()) {
        const data = snap.data();
        setCurrentUserData({
          firstName: data.firstName || '',
          lastName: data.lastName || '',
        });
      }
    };
    fetchCurrentUserData();
  }, [currentUser?.uid]);

  const getSubmitterName = (): string => {
    const firstName = currentUserData.firstName || '';
    const lastName = currentUserData.lastName || '';
    if (firstName && lastName) {
      return `${firstName} ${lastName}`;
    }
    // Fallback to displayName or email if firstName/lastName not available
    return currentUser?.displayName || currentUser?.email || 'Unknown';
  };

  useEffect(() => {
    if (!uid) return;
    const fetchData = async () => {
      const userRef = doc(db, 'users', uid);
      const snap = await getDoc(userRef);
      if (snap.exists()) {
        const data = snap.data();
        
        // Load E-Verify orders
        const eVerifyOrdersArray = Array.isArray(data.eVerifyOrders) ? data.eVerifyOrders : [];
        setEVerifyOrders(eVerifyOrdersArray.map((o: any) => ({
          id: o.id || Date.now().toString(),
          dateSubmitted: o.dateSubmitted || '',
          status: o.status || 'In-Progress',
          result: o.result,
          completionDate: o.completionDate,
          submittedBy: o.submittedBy,
        })));
        
        // Load orders arrays, ensuring proper structure
        const bgOrders = Array.isArray(data.backgroundCheckOrders) ? data.backgroundCheckOrders : [];
        const drugOrders = Array.isArray(data.drugScreeningOrders) ? data.drugScreeningOrders : [];
        const addlOrders = Array.isArray(data.additionalScreeningOrders) ? data.additionalScreeningOrders : [];
        
        setBackgroundCheckOrders(bgOrders.map((o: any) => ({
          id: o.id || Date.now().toString(),
          type: o.type || '',
          typeLabel: o.typeLabel || backgroundCheckOptions.find(opt => opt.value === o.type)?.label || o.type,
          dateOrdered: o.dateOrdered || '',
          status: o.status || 'In-Progress',
          result: o.result,
          completionDate: o.completionDate,
          submittedBy: o.submittedBy,
        })));
        
        setDrugScreeningOrders(drugOrders.map((o: any) => ({
          id: o.id || Date.now().toString(),
          type: o.type || '',
          typeLabel: o.typeLabel || drugScreeningOptions.find(opt => opt.value === o.type)?.label || o.type,
          dateOrdered: o.dateOrdered || '',
          status: o.status || 'In-Progress',
          result: o.result,
          completionDate: o.completionDate,
          submittedBy: o.submittedBy,
        })));
        
        setAdditionalScreeningOrders(addlOrders.map((o: any) => ({
          id: o.id || Date.now().toString(),
          type: o.type || '',
          typeLabel: o.typeLabel || additionalScreeningOptions.find(opt => opt.value === o.type)?.label || o.type,
          dateOrdered: o.dateOrdered || '',
          status: o.status || 'In-Progress',
          result: o.result,
          completionDate: o.completionDate,
          submittedBy: o.submittedBy,
        })));
      }
    };
    fetchData();
  }, [uid]);

  // E-Verify order handlers
  const handleCreateEVerifyOrder = async () => {
    if (!newEVerifyOrder.dateSubmitted) return;
    
    const newOrder: EVerifyOrder = {
      id: Date.now().toString(),
      dateSubmitted: newEVerifyOrder.dateSubmitted,
      status: 'In-Progress',
      submittedBy: getSubmitterName(),
    };
    
    const updated = [...eVerifyOrders, newOrder];
    setEVerifyOrders(updated);
    
    const userRef = doc(db, 'users', uid);
    await updateDoc(userRef, {
      eVerifyOrders: updated,
      updatedAt: serverTimestamp(),
    });
    
    setNewEVerifyOrder({ dateSubmitted: '' });
  };

  const handleUpdateEVerifyOrder = async (orderId: string, field: keyof EVerifyOrder, value: any) => {
    const updated = eVerifyOrders.map(order =>
      order.id === orderId ? { ...order, [field]: value } : order
    );
    setEVerifyOrders(updated);
    
    const userRef = doc(db, 'users', uid);
    await updateDoc(userRef, {
      eVerifyOrders: updated,
      updatedAt: serverTimestamp(),
    });
  };

  const handleDeleteEVerifyOrder = async (orderId: string) => {
    if (!confirm('Are you sure you want to delete this E-Verify order?')) return;
    
    const updated = eVerifyOrders.filter(order => order.id !== orderId);
    setEVerifyOrders(updated);
    
    const userRef = doc(db, 'users', uid);
    await updateDoc(userRef, {
      eVerifyOrders: updated,
      updatedAt: serverTimestamp(),
    });
  };

  // Create new order handlers
  const handleCreateBackgroundCheckOrder = async () => {
    if (!newBackgroundCheckOrder.type || !newBackgroundCheckOrder.dateOrdered) return;
    
    const option = backgroundCheckOptions.find(opt => opt.value === newBackgroundCheckOrder.type);
    const newOrder: ScreeningOrder = {
      id: Date.now().toString(),
      type: newBackgroundCheckOrder.type,
      typeLabel: option?.label || newBackgroundCheckOrder.type,
      dateOrdered: newBackgroundCheckOrder.dateOrdered,
      status: 'In-Progress',
      submittedBy: getSubmitterName(),
    };
    
    const updated = [...backgroundCheckOrders, newOrder];
    setBackgroundCheckOrders(updated);
    
    const userRef = doc(db, 'users', uid);
    await updateDoc(userRef, {
      backgroundCheckOrders: updated,
      updatedAt: serverTimestamp(),
    });
    
    setNewBackgroundCheckOrder({ type: '', dateOrdered: '' });
  };

  const handleCreateDrugScreeningOrder = async () => {
    if (!newDrugScreeningOrder.type || !newDrugScreeningOrder.dateOrdered) return;
    
    const option = drugScreeningOptions.find(opt => opt.value === newDrugScreeningOrder.type);
    const newOrder: ScreeningOrder = {
      id: Date.now().toString(),
      type: newDrugScreeningOrder.type,
      typeLabel: option?.label || newDrugScreeningOrder.type,
      dateOrdered: newDrugScreeningOrder.dateOrdered,
      status: 'In-Progress',
      submittedBy: getSubmitterName(),
    };
    
    const updated = [...drugScreeningOrders, newOrder];
    setDrugScreeningOrders(updated);
    
    const userRef = doc(db, 'users', uid);
    await updateDoc(userRef, {
      drugScreeningOrders: updated,
      updatedAt: serverTimestamp(),
    });
    
    setNewDrugScreeningOrder({ type: '', dateOrdered: '' });
  };

  const handleCreateAdditionalScreeningOrder = async () => {
    if (!newAdditionalScreeningOrder.type || !newAdditionalScreeningOrder.dateOrdered) return;
    
    const option = additionalScreeningOptions.find(opt => opt.value === newAdditionalScreeningOrder.type);
    const newOrder: ScreeningOrder = {
      id: Date.now().toString(),
      type: newAdditionalScreeningOrder.type,
      typeLabel: option?.label || newAdditionalScreeningOrder.type,
      dateOrdered: newAdditionalScreeningOrder.dateOrdered,
      status: 'In-Progress',
      submittedBy: getSubmitterName(),
    };
    
    const updated = [...additionalScreeningOrders, newOrder];
    setAdditionalScreeningOrders(updated);
    
    const userRef = doc(db, 'users', uid);
    await updateDoc(userRef, {
      additionalScreeningOrders: updated,
      updatedAt: serverTimestamp(),
    });
    
    setNewAdditionalScreeningOrder({ type: '', dateOrdered: '' });
  };

  // Update order handlers
  const handleUpdateBackgroundCheckOrder = async (orderId: string, field: keyof ScreeningOrder, value: any) => {
    const updated = backgroundCheckOrders.map(order =>
      order.id === orderId ? { ...order, [field]: value } : order
    );
    setBackgroundCheckOrders(updated);
    
    const userRef = doc(db, 'users', uid);
    await updateDoc(userRef, {
      backgroundCheckOrders: updated,
      updatedAt: serverTimestamp(),
    });
  };

  const handleUpdateDrugScreeningOrder = async (orderId: string, field: keyof ScreeningOrder, value: any) => {
    const updated = drugScreeningOrders.map(order =>
      order.id === orderId ? { ...order, [field]: value } : order
    );
    setDrugScreeningOrders(updated);
    
    const userRef = doc(db, 'users', uid);
    await updateDoc(userRef, {
      drugScreeningOrders: updated,
      updatedAt: serverTimestamp(),
    });
  };

  const handleUpdateAdditionalScreeningOrder = async (orderId: string, field: keyof ScreeningOrder, value: any) => {
    const updated = additionalScreeningOrders.map(order =>
      order.id === orderId ? { ...order, [field]: value } : order
    );
    setAdditionalScreeningOrders(updated);
    
    const userRef = doc(db, 'users', uid);
    await updateDoc(userRef, {
      additionalScreeningOrders: updated,
      updatedAt: serverTimestamp(),
    });
  };

  // Delete order handlers
  const handleDeleteBackgroundCheckOrder = async (orderId: string) => {
    if (!confirm('Are you sure you want to delete this background check order?')) return;
    
    const updated = backgroundCheckOrders.filter(order => order.id !== orderId);
    setBackgroundCheckOrders(updated);
    
    const userRef = doc(db, 'users', uid);
    await updateDoc(userRef, {
      backgroundCheckOrders: updated,
      updatedAt: serverTimestamp(),
    });
  };

  const handleDeleteDrugScreeningOrder = async (orderId: string) => {
    if (!confirm('Are you sure you want to delete this drug screening order?')) return;
    
    const updated = drugScreeningOrders.filter(order => order.id !== orderId);
    setDrugScreeningOrders(updated);
    
    const userRef = doc(db, 'users', uid);
    await updateDoc(userRef, {
      drugScreeningOrders: updated,
      updatedAt: serverTimestamp(),
    });
  };

  const handleDeleteAdditionalScreeningOrder = async (orderId: string) => {
    if (!confirm('Are you sure you want to delete this additional screening order?')) return;
    
    const updated = additionalScreeningOrders.filter(order => order.id !== orderId);
    setAdditionalScreeningOrders(updated);
    
    const userRef = doc(db, 'users', uid);
    await updateDoc(userRef, {
      additionalScreeningOrders: updated,
      updatedAt: serverTimestamp(),
    });
  };

  // Render E-Verify order table
  const renderEVerifyOrderTable = () => {
    if (eVerifyOrders.length === 0) {
      return (
        <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic', py: 2 }}>
          No orders yet.
        </Typography>
      );
    }

    return (
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow sx={{ bgcolor: 'grey.50' }}>
              <TableCell sx={{ fontWeight: 600 }}>Date Submitted</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Submitted By</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Result</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Completion Date</TableCell>
              <TableCell sx={{ fontWeight: 600 }} width={60}>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {eVerifyOrders.map((order) => (
              <TableRow key={order.id} sx={{ '&:hover': { bgcolor: 'grey.50' } }}>
                <TableCell>
                  {order.dateSubmitted ? new Date(order.dateSubmitted).toLocaleDateString() : ''}
                </TableCell>
                <TableCell>
                  {order.submittedBy || 'Unknown'}
                </TableCell>
                <TableCell>
                  <FormControl size="small" fullWidth>
                    <Select
                      value={order.status}
                      onChange={(e) => handleUpdateEVerifyOrder(order.id, 'status', e.target.value)}
                      sx={{ fontSize: '0.875rem' }}
                    >
                      {orderStatusOptions.map((opt) => (
                        <MenuItem key={opt} value={opt}>
                          {opt}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </TableCell>
                <TableCell>
                  <FormControl size="small" fullWidth>
                    <Select
                      value={order.result || ''}
                      onChange={(e) => handleUpdateEVerifyOrder(order.id, 'result', e.target.value || undefined)}
                      displayEmpty
                      sx={{ fontSize: '0.875rem' }}
                    >
                      <MenuItem value="">
                        <em>None</em>
                      </MenuItem>
                      {eVerifyResultOptions.map((opt) => (
                        <MenuItem key={opt} value={opt}>
                          {opt}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </TableCell>
                <TableCell>
                  <TextField
                    type="date"
                    size="small"
                    fullWidth
                    value={order.completionDate || ''}
                    onChange={(e) => handleUpdateEVerifyOrder(order.id, 'completionDate', e.target.value || undefined)}
                    InputLabelProps={{ shrink: true }}
                    sx={{ fontSize: '0.875rem' }}
                  />
                </TableCell>
                <TableCell>
                  <IconButton
                    size="small"
                    color="error"
                    onClick={() => handleDeleteEVerifyOrder(order.id)}
                    sx={{ '&:hover': { bgcolor: 'error.lighter' } }}
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    );
  };

  // Render order table component
  const renderOrderTable = (
    orders: ScreeningOrder[],
    onUpdate: (orderId: string, field: keyof ScreeningOrder, value: any) => void,
    onDelete: (orderId: string) => void
  ) => {
    if (orders.length === 0) {
      return (
        <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic', py: 2 }}>
          No orders yet.
        </Typography>
      );
    }

    return (
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow sx={{ bgcolor: 'grey.50' }}>
              <TableCell sx={{ fontWeight: 600 }}>Type</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Date Ordered</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Submitted By</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Result</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Completion Date</TableCell>
              <TableCell sx={{ fontWeight: 600 }} width={60}>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {orders.map((order) => (
              <TableRow key={order.id} sx={{ '&:hover': { bgcolor: 'grey.50' } }}>
                <TableCell>{order.typeLabel}</TableCell>
                <TableCell>
                  {order.dateOrdered ? new Date(order.dateOrdered).toLocaleDateString() : ''}
                </TableCell>
                <TableCell>
                  {order.submittedBy || 'Unknown'}
                </TableCell>
                <TableCell>
                  <FormControl size="small" fullWidth>
                    <Select
                      value={order.status}
                      onChange={(e) => onUpdate(order.id, 'status', e.target.value)}
                      sx={{ fontSize: '0.875rem' }}
                    >
                      {orderStatusOptions.map((opt) => (
                        <MenuItem key={opt} value={opt}>
                          {opt}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </TableCell>
                <TableCell>
                  <FormControl size="small" fullWidth>
                    <Select
                      value={order.result || ''}
                      onChange={(e) => onUpdate(order.id, 'result', e.target.value || undefined)}
                      displayEmpty
                      sx={{ fontSize: '0.875rem' }}
                    >
                      <MenuItem value="">
                        <em>None</em>
                      </MenuItem>
                      {resultOptions.map((opt) => (
                        <MenuItem key={opt} value={opt}>
                          {opt}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </TableCell>
                <TableCell>
                  <TextField
                    type="date"
                    size="small"
                    fullWidth
                    value={order.completionDate || ''}
                    onChange={(e) => onUpdate(order.id, 'completionDate', e.target.value || undefined)}
                    InputLabelProps={{ shrink: true }}
                    sx={{ fontSize: '0.875rem' }}
                  />
                </TableCell>
                <TableCell>
                  <IconButton
                    size="small"
                    color="error"
                    onClick={() => onDelete(order.id)}
                    sx={{ '&:hover': { bgcolor: 'error.lighter' } }}
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    );
  };

  return (
    <Box>
      {/* E-Verify Card */}
      <Card variant="outlined" sx={{ mb: 4, bgcolor: 'background.paper' }}>
        <CardHeader
          title="E-Verify"
          titleTypographyProps={{ variant: 'h6', fontWeight: 700 }}
        />
        <CardContent>
          {/* Add New Order Form */}
          <Box sx={{ mb: 3, p: 2, bgcolor: 'grey.50', borderRadius: 1 }}>
            <Grid container spacing={2} alignItems="flex-end">
              <Grid item xs={12} sm={9}>
                <TextField
                  label="Date Submitted"
                  type="date"
                  fullWidth
                  value={newEVerifyOrder.dateSubmitted}
                  onChange={(e) => setNewEVerifyOrder({ dateSubmitted: e.target.value })}
                  InputLabelProps={{ shrink: true }}
                />
              </Grid>
              <Grid item xs={12} sm={3}>
                <Button
                  variant="contained"
                  startIcon={<AddIcon />}
                  fullWidth
                  onClick={handleCreateEVerifyOrder}
                  disabled={!newEVerifyOrder.dateSubmitted}
                >
                  Add Order
                </Button>
              </Grid>
            </Grid>
          </Box>

          {/* Orders Table */}
          {renderEVerifyOrderTable()}
        </CardContent>
      </Card>

      {/* Background Checks Card */}
      <Card variant="outlined" sx={{ mb: 4, bgcolor: 'background.paper' }}>
        <CardHeader
          title="Background Checks"
          titleTypographyProps={{ variant: 'h6', fontWeight: 700 }}
        />
        <CardContent>
          {/* Add New Order Form */}
          <Box sx={{ mb: 3, p: 2, bgcolor: 'grey.50', borderRadius: 1 }}>
            <Grid container spacing={2} alignItems="flex-end">
              <Grid item xs={12} sm={5}>
                <FormControl fullWidth>
                  <InputLabel>Background Check Type</InputLabel>
                  <Select
                    value={newBackgroundCheckOrder.type}
                    onChange={(e) => setNewBackgroundCheckOrder({ ...newBackgroundCheckOrder, type: e.target.value })}
                    label="Background Check Type"
                  >
                    {backgroundCheckOptions.map((option) => (
                      <MenuItem key={option.value} value={option.value}>
                        {option.label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField
                  label="Date Ordered"
                  type="date"
                  fullWidth
                  value={newBackgroundCheckOrder.dateOrdered}
                  onChange={(e) => setNewBackgroundCheckOrder({ ...newBackgroundCheckOrder, dateOrdered: e.target.value })}
                  InputLabelProps={{ shrink: true }}
                />
              </Grid>
              <Grid item xs={12} sm={3}>
                <Button
                  variant="contained"
                  startIcon={<AddIcon />}
                  fullWidth
                  onClick={handleCreateBackgroundCheckOrder}
                  disabled={!newBackgroundCheckOrder.type || !newBackgroundCheckOrder.dateOrdered}
                >
                  Add Order
                </Button>
              </Grid>
            </Grid>
          </Box>

          {/* Orders Table */}
          {renderOrderTable(backgroundCheckOrders, handleUpdateBackgroundCheckOrder, handleDeleteBackgroundCheckOrder)}
        </CardContent>
      </Card>

      {/* Drug Screenings Card */}
      <Card variant="outlined" sx={{ mb: 4, bgcolor: 'background.paper' }}>
        <CardHeader
          title="Drug Screenings"
          titleTypographyProps={{ variant: 'h6', fontWeight: 700 }}
        />
        <CardContent>
          {/* Add New Order Form */}
          <Box sx={{ mb: 3, p: 2, bgcolor: 'grey.50', borderRadius: 1 }}>
            <Grid container spacing={2} alignItems="flex-end">
              <Grid item xs={12} sm={5}>
                <FormControl fullWidth>
                  <InputLabel>Drug Screening Panel</InputLabel>
                  <Select
                    value={newDrugScreeningOrder.type}
                    onChange={(e) => setNewDrugScreeningOrder({ ...newDrugScreeningOrder, type: e.target.value })}
                    label="Drug Screening Panel"
                  >
                    {drugScreeningOptions.map((option) => (
                      <MenuItem key={option.value} value={option.value}>
                        {option.label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField
                  label="Date Ordered"
                  type="date"
                  fullWidth
                  value={newDrugScreeningOrder.dateOrdered}
                  onChange={(e) => setNewDrugScreeningOrder({ ...newDrugScreeningOrder, dateOrdered: e.target.value })}
                  InputLabelProps={{ shrink: true }}
                />
              </Grid>
              <Grid item xs={12} sm={3}>
                <Button
                  variant="contained"
                  startIcon={<AddIcon />}
                  fullWidth
                  onClick={handleCreateDrugScreeningOrder}
                  disabled={!newDrugScreeningOrder.type || !newDrugScreeningOrder.dateOrdered}
                >
                  Add Order
                </Button>
              </Grid>
            </Grid>
          </Box>

          {/* Orders Table */}
          {renderOrderTable(drugScreeningOrders, handleUpdateDrugScreeningOrder, handleDeleteDrugScreeningOrder)}
        </CardContent>
      </Card>

      {/* Additional Screenings Card */}
      <Card variant="outlined" sx={{ mb: 4, bgcolor: 'background.paper' }}>
        <CardHeader
          title="Additional Screenings"
          titleTypographyProps={{ variant: 'h6', fontWeight: 700 }}
        />
        <CardContent>
          {/* Add New Order Form */}
          <Box sx={{ mb: 3, p: 2, bgcolor: 'grey.50', borderRadius: 1 }}>
            <Grid container spacing={2} alignItems="flex-end">
              <Grid item xs={12} sm={5}>
                <FormControl fullWidth>
                  <InputLabel>Additional Screening Type</InputLabel>
                  <Select
                    value={newAdditionalScreeningOrder.type}
                    onChange={(e) => setNewAdditionalScreeningOrder({ ...newAdditionalScreeningOrder, type: e.target.value })}
                    label="Additional Screening Type"
                  >
                    {additionalScreeningOptions.map((option) => (
                      <MenuItem key={option.value} value={option.value}>
                        {option.label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField
                  label="Date Ordered"
                  type="date"
                  fullWidth
                  value={newAdditionalScreeningOrder.dateOrdered}
                  onChange={(e) => setNewAdditionalScreeningOrder({ ...newAdditionalScreeningOrder, dateOrdered: e.target.value })}
                  InputLabelProps={{ shrink: true }}
                />
              </Grid>
              <Grid item xs={12} sm={3}>
                <Button
                  variant="contained"
                  startIcon={<AddIcon />}
                  fullWidth
                  onClick={handleCreateAdditionalScreeningOrder}
                  disabled={!newAdditionalScreeningOrder.type || !newAdditionalScreeningOrder.dateOrdered}
                >
                  Add Order
                </Button>
              </Grid>
            </Grid>
          </Box>

          {/* Orders Table */}
          {renderOrderTable(additionalScreeningOrders, handleUpdateAdditionalScreeningOrder, handleDeleteAdditionalScreeningOrder)}
        </CardContent>
      </Card>
    </Box>
  );
};

export default CombinedBackgroundAndVaccinationTab;
