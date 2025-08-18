import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Avatar,
  CircularProgress,
  Alert,
  IconButton,
} from '@mui/material';
import {
  Close as CloseIcon,
  Business as BusinessIcon,
} from '@mui/icons-material';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../firebase';

interface Location {
  id: string;
  name: string;
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  nickname?: string;
}

interface ManageLocationDialogProps {
  open: boolean;
  onClose: () => void;
  tenantId: string;
  companyId: string;
  currentLocationId?: string;
  onLocationChange: (locationId: string | null) => void;
}

const ManageLocationDialog: React.FC<ManageLocationDialogProps> = ({
  open,
  onClose,
  tenantId,
  companyId,
  currentLocationId,
  onLocationChange,
}) => {
  const [availableLocations, setAvailableLocations] = useState<Location[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Load available locations from crm_locations collection
  useEffect(() => {
    if (!open || !tenantId || !companyId) {
      console.log('ManageLocationDialog: Missing required props', { open, tenantId, companyId });
      if (open && (!tenantId || !companyId)) {
        setError('Missing tenant or company information');
      }
      return;
    }

    const loadAvailableLocations = async () => {
      setLoading(true);
      setError('');

      try {
        console.log('Loading locations for tenant:', tenantId, 'and company:', companyId);
        
        // Query locations associated with the specific company
        const locationsRef = collection(db, 'tenants', tenantId, 'crm_companies', companyId, 'locations');
        const locationsQuery = query(locationsRef);
        const locationsSnapshot = await getDocs(locationsQuery);
        console.log('Company locations query results:', locationsSnapshot.size);
        
        const companyLocations: Location[] = [];
        
        locationsSnapshot.docs.forEach(doc => {
          const locationData = doc.data();
          companyLocations.push({
            id: doc.id,
            name: locationData.name || 'Unknown Location',
            address: locationData.address || '',
            city: locationData.city || '',
            state: locationData.state || '',
            zipCode: locationData.zipCode || '',
            nickname: locationData.nickname || locationData.name || 'Unknown Location'
          });
        });
        
        console.log('Company locations found:', companyLocations.length);
        console.log('Company locations:', companyLocations);
        setAvailableLocations(companyLocations);
        
        // Set the current location as selected if it exists in the available locations
        if (currentLocationId && companyLocations.some(loc => loc.id === currentLocationId)) {
          setSelectedLocationId(currentLocationId);
        } else {
          setSelectedLocationId('');
        }
        
      } catch (err: any) {
        console.error('Error loading available locations:', err);
        setError(`Failed to load available locations: ${err.message}`);
      } finally {
        setLoading(false);
      }
    };

    loadAvailableLocations();
  }, [open, tenantId, companyId]);

  // Handle currentLocationId changes after locations are loaded
  useEffect(() => {
    if (availableLocations.length > 0 && currentLocationId) {
      // Check if the current location exists in available locations
      if (availableLocations.some(loc => loc.id === currentLocationId)) {
        setSelectedLocationId(currentLocationId);
      } else {
        setSelectedLocationId('');
      }
    } else if (availableLocations.length > 0) {
      // If no current location, set to empty
      setSelectedLocationId('');
    }
  }, [currentLocationId, availableLocations]);

  const handleSaveLocation = () => {
    onLocationChange(selectedLocationId || null);
    onClose();
  };

  const handleClose = () => {
    setSelectedLocationId(currentLocationId || '');
    setError('');
    onClose();
  };

  const getLocationDisplayName = (location: Location) => {
    if (location.nickname && location.nickname !== location.name) {
      return `${location.nickname} (${location.name})`;
    }
    return location.name;
  };

  const getLocationAddress = (location: Location) => {
    const parts = [location.address, location.city, location.state, location.zipCode].filter(Boolean);
    return parts.length > 0 ? parts.join(', ') : 'No address';
  };

  return (
    <Dialog 
      open={open} 
      onClose={handleClose}
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle>
        <Box display="flex" alignItems="center" justifyContent="space-between">
          <Typography variant="h6">Select Location</Typography>
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

          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Select a location for this deal. Only one location can be associated with a deal.
          </Typography>

          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
              <CircularProgress />
            </Box>
          ) : availableLocations.length > 0 ? (
            <FormControl fullWidth>
              <InputLabel>Select Location</InputLabel>
              <Select
                value={selectedLocationId}
                onChange={(e) => setSelectedLocationId(e.target.value)}
                label="Select Location"
              >
                <MenuItem value="">
                  <em>No location selected</em>
                </MenuItem>
                {availableLocations.map((location) => (
                  <MenuItem key={location.id} value={location.id}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Avatar sx={{ width: 24, height: 24, fontSize: '0.75rem', bgcolor: 'primary.main' }}>
                        <BusinessIcon sx={{ fontSize: 16 }} />
                      </Avatar>
                      <Box>
                        <Typography variant="body2">{getLocationDisplayName(location)}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {getLocationAddress(location)}
                        </Typography>
                      </Box>
                    </Box>
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          ) : (
            <Box sx={{ textAlign: 'center', py: 3, bgcolor: 'grey.50', borderRadius: 1 }}>
              <Typography variant="body2" color="text.secondary">
                No locations available for this company
              </Typography>
            </Box>
          )}
        </Box>
      </DialogContent>

      <DialogActions sx={{ p: 3, pt: 0 }}>
        <Button onClick={handleClose} variant="outlined">
          Cancel
        </Button>
        <Button 
          onClick={handleSaveLocation} 
          variant="contained"
          disabled={loading}
        >
          Save Location
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ManageLocationDialog;
