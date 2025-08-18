import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  ListItemSecondaryAction,
  IconButton,
  Avatar,
  Chip,
  TextField,
  InputAdornment,
  CircularProgress,
  Alert,
  Divider,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
} from '@mui/material';
import {
  Close as CloseIcon,
  Delete as DeleteIcon,
  Person as PersonIcon,
  Add as AddIcon,
} from '@mui/icons-material';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../firebase';

interface Salesperson {
  id: string;
  fullName: string;
  firstName?: string;
  lastName?: string;
  displayName?: string;
  email: string;
  phone?: string;
  title?: string;
}

interface ManageSalespeopleDialogProps {
  open: boolean;
  onClose: () => void;
  tenantId: string;
  currentSalespeople: Salesperson[];
  onSalespeopleChange: (salespeople: Salesperson[]) => void;
}

const ManageSalespeopleDialog: React.FC<ManageSalespeopleDialogProps> = ({
  open,
  onClose,
  tenantId,
  currentSalespeople,
  onSalespeopleChange,
}) => {
  const [availableSalespeople, setAvailableSalespeople] = useState<Salesperson[]>([]);
  const [selectedSalespersonId, setSelectedSalespersonId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Load available salespeople from users collection
  useEffect(() => {
    if (!open || !tenantId) return;

    const loadAvailableSalespeople = async () => {
      setLoading(true);
      setError('');

      try {
        console.log('Loading salespeople for tenant:', tenantId);
        const usersRef = collection(db, 'users');
        
        // Try multiple queries to find all available salespeople
        const allSalespeople: any[] = [];
        
        // Query 1: Users with crm_sales: true and active tenant status
        try {
          const activeQuery = query(
            usersRef,
            where('crm_sales', '==', true),
            where(`tenantIds.${tenantId}.status`, '==', 'active')
          );
          const activeSnapshot = await getDocs(activeQuery);
          console.log('Active tenant query results:', activeSnapshot.size);
          
          activeSnapshot.docs.forEach(doc => {
            const userData = doc.data();
            const displayName = userData.firstName && userData.lastName ? 
                               `${userData.firstName} ${userData.lastName}` :
                               userData.displayName || 
                               userData.email?.split('@')[0] || 
                               'Unknown Salesperson';
            
            allSalespeople.push({
              id: userData.uid || doc.id,
              fullName: displayName,
              firstName: userData.firstName || '',
              lastName: userData.lastName || '',
              displayName: displayName,
              email: userData.email || '',
              phone: userData.phone || '',
              title: userData.title || ''
            });
          });
        } catch (err) {
          console.log('Active tenant query failed:', err);
        }
        
        // Query 2: Users with crm_sales: true (broader query)
        try {
          const broadQuery = query(usersRef, where('crm_sales', '==', true));
          const broadSnapshot = await getDocs(broadQuery);
          console.log('Broad query results:', broadSnapshot.size);
          
          broadSnapshot.docs.forEach(doc => {
            const userData = doc.data();
            const displayName = userData.firstName && userData.lastName ? 
                               `${userData.firstName} ${userData.lastName}` :
                               userData.displayName || 
                               userData.email?.split('@')[0] || 
                               'Unknown Salesperson';
            
            const salesperson = {
              id: userData.uid || doc.id,
              fullName: displayName,
              firstName: userData.firstName || '',
              lastName: userData.lastName || '',
              displayName: displayName,
              email: userData.email || '',
              phone: userData.phone || '',
              title: userData.title || ''
            };
            
            // Only add if not already in the list
            if (!allSalespeople.some(sp => sp.id === salesperson.id)) {
              allSalespeople.push(salesperson);
            }
          });
        } catch (err) {
          console.log('Broad query failed:', err);
        }
        
        // Query 3: Users with tenantIds containing this tenant (even if not active)
        try {
          const tenantQuery = query(usersRef, where(`tenantIds.${tenantId}`, '!=', null));
          const tenantSnapshot = await getDocs(tenantQuery);
          console.log('Tenant query results:', tenantSnapshot.size);
          
          tenantSnapshot.docs.forEach(doc => {
            const userData = doc.data();
            // Only include if they have crm_sales: true
            if (userData.crm_sales === true) {
              const displayName = userData.firstName && userData.lastName ? 
                                 `${userData.firstName} ${userData.lastName}` :
                                 userData.displayName || 
                                 userData.email?.split('@')[0] || 
                                 'Unknown Salesperson';
              
              const salesperson = {
                id: userData.uid || doc.id,
                fullName: displayName,
                firstName: userData.firstName || '',
                lastName: userData.lastName || '',
                displayName: displayName,
                email: userData.email || '',
                phone: userData.phone || '',
                title: userData.title || ''
              };
              
              // Only add if not already in the list
              if (!allSalespeople.some(sp => sp.id === salesperson.id)) {
                allSalespeople.push(salesperson);
              }
            }
          });
        } catch (err) {
          console.log('Tenant query failed:', err);
        }
        
        console.log('Total unique salespeople found:', allSalespeople.length);
        console.log('All salespeople:', allSalespeople);
        setAvailableSalespeople(allSalespeople);
        
      } catch (err: any) {
        console.error('Error loading available salespeople:', err);
        setError('Failed to load available salespeople');
      } finally {
        setLoading(false);
      }
    };

    loadAvailableSalespeople();
  }, [open, tenantId]);

  // Filter available salespeople to exclude current ones
  const availableToAdd = availableSalespeople.filter(salesperson => {
    const isAlreadyAssigned = currentSalespeople.some(current => current.id === salesperson.id);
    console.log(`Salesperson ${salesperson.fullName} (${salesperson.id}) - Already assigned: ${isAlreadyAssigned}`);
    return !isAlreadyAssigned;
  });

  const handleAddSalesperson = (salesperson: Salesperson) => {
    const updatedSalespeople = [...currentSalespeople, salesperson];
    onSalespeopleChange(updatedSalespeople);
  };

  const handleRemoveSalesperson = (salespersonId: string) => {
    const updatedSalespeople = currentSalespeople.filter(sp => sp.id !== salespersonId);
    onSalespeopleChange(updatedSalespeople);
  };

  const handleAddSelectedSalesperson = () => {
    if (selectedSalespersonId) {
      const selectedSalesperson = availableSalespeople.find(sp => sp.id === selectedSalespersonId);
      if (selectedSalesperson) {
        handleAddSalesperson(selectedSalesperson);
        setSelectedSalespersonId('');
      }
    }
  };

  const handleClose = () => {
    setSelectedSalespersonId('');
    setError('');
    onClose();
  };

  return (
    <Dialog 
      open={open} 
      onClose={handleClose}
      maxWidth="md"
      fullWidth
    >
      <DialogTitle>
        <Box display="flex" alignItems="center" justifyContent="space-between">
          <Typography variant="h6">Manage Salespeople</Typography>
          <IconButton onClick={handleClose}>
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>
      
      <DialogContent>
        <Box sx={{ pt: 1 }}>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          {/* Current Salespeople */}
          <Box sx={{ mb: 3 }}>
            <Typography variant="subtitle1" fontWeight="bold" sx={{ mb: 2 }}>
              Current Salespeople ({currentSalespeople.length})
            </Typography>
            
            {currentSalespeople.length > 0 ? (
              <List sx={{ bgcolor: 'grey.50', borderRadius: 1 }}>
                {currentSalespeople.map((salesperson) => (
                  <ListItem key={salesperson.id} sx={{ py: 1 }}>
                    <ListItemAvatar>
                      <Avatar sx={{ width: 40, height: 40, fontSize: '1rem' }}>
                        {salesperson.fullName?.charAt(0) || salesperson.firstName?.charAt(0) || 'S'}
                      </Avatar>
                    </ListItemAvatar>
                    <ListItemText
                      primary={salesperson.fullName}
                      secondary={salesperson.email}
                    />
                    <ListItemSecondaryAction>
                      <IconButton
                        edge="end"
                        onClick={() => handleRemoveSalesperson(salesperson.id)}
                        color="error"
                      >
                        <DeleteIcon />
                      </IconButton>
                    </ListItemSecondaryAction>
                  </ListItem>
                ))}
              </List>
            ) : (
              <Box sx={{ textAlign: 'center', py: 3, bgcolor: 'grey.50', borderRadius: 1 }}>
                <Typography variant="body2" color="text.secondary">
                  No salespeople assigned to this deal
                </Typography>
              </Box>
            )}
          </Box>

          <Divider sx={{ my: 2 }} />

                    {/* Add Salespeople */}
          <Box>
            <Typography variant="subtitle1" fontWeight="bold" sx={{ mb: 2 }}>
              Add Salespeople
            </Typography>
            
            {loading && (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
                <CircularProgress />
              </Box>
            )}
            
            {!loading && availableToAdd.length > 0 ? (
              <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-end' }}>
                <FormControl fullWidth>
                  <InputLabel>Select Salesperson</InputLabel>
                  <Select
                    value={selectedSalespersonId}
                    onChange={(e) => setSelectedSalespersonId(e.target.value)}
                    label="Select Salesperson"
                  >
                    {availableToAdd.map((salesperson) => (
                      <MenuItem key={salesperson.id} value={salesperson.id}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Avatar sx={{ width: 24, height: 24, fontSize: '0.75rem' }}>
                            {salesperson.fullName?.charAt(0) || salesperson.firstName?.charAt(0) || 'S'}
                          </Avatar>
                          <Box>
                            <Typography variant="body2">{salesperson.fullName}</Typography>
                            <Typography variant="caption" color="text.secondary">
                              {salesperson.email}
                            </Typography>
                          </Box>
                        </Box>
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <Button
                  variant="contained"
                  onClick={handleAddSelectedSalesperson}
                  disabled={!selectedSalespersonId}
                  startIcon={<AddIcon />}
                >
                  Add
                </Button>
              </Box>
            ) : !loading ? (
              <Box sx={{ textAlign: 'center', py: 3, bgcolor: 'grey.50', borderRadius: 1 }}>
                <Typography variant="body2" color="text.secondary">
                  {availableSalespeople.length > 0 
                    ? 'All available salespeople are already assigned to this deal'
                    : 'No salespeople available to add'
                  }
                </Typography>
              </Box>
            ) : null}
          </Box>
        </Box>
      </DialogContent>

      <DialogActions sx={{ p: 3, pt: 0 }}>
        <Button onClick={handleClose} variant="outlined">
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ManageSalespeopleDialog;
