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
import { collection, getDocs, doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';

interface Location {
  id: string;
  companyId: string;
  companyName?: string;
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
  /** When provided, load locations from all these companies (combines options) */
  companyIds?: string[];
  currentLocationId?: string;
  currentLocationCompanyId?: string;
  onLocationChange: (locationId: string | null, companyId?: string) => void;
}

const ManageLocationDialog: React.FC<ManageLocationDialogProps> = ({
  open,
  onClose,
  tenantId,
  companyId,
  companyIds: companyIdsProp,
  currentLocationId,
  currentLocationCompanyId,
  onLocationChange,
}) => {
  const [availableLocations, setAvailableLocations] = useState<Location[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState<string>('');
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const companyIds = companyIdsProp?.length ? companyIdsProp : (companyId ? [companyId] : []);

  useEffect(() => {
    if (!open || !tenantId || companyIds.length === 0) {
      if (open && (!tenantId || companyIds.length === 0)) {
        setError('Missing tenant or company information');
      }
      return;
    }

    const loadAvailableLocations = async () => {
      setLoading(true);
      setError('');
      const merged: Location[] = [];
      try {
        for (const cid of companyIds) {
          const companyDoc = await getDoc(doc(db, 'tenants', tenantId, 'crm_companies', cid));
          const companyName = companyDoc.exists() ? (companyDoc.data()?.companyName || companyDoc.data()?.name || '') : '';
          const locationsRef = collection(db, 'tenants', tenantId, 'crm_companies', cid, 'locations');
          const snap = await getDocs(locationsRef);
          snap.docs.forEach((d) => {
            const data = d.data();
            merged.push({
              id: d.id,
              companyId: cid,
              companyName,
              name: data.name || 'Unknown Location',
              address: data.address || '',
              city: data.city || '',
              state: data.state || '',
              zipCode: data.zipCode || '',
              nickname: data.nickname || data.name || 'Unknown Location',
            });
          });
        }
        setAvailableLocations(merged);
        if (currentLocationId) {
          const found = currentLocationCompanyId
            ? merged.find((loc) => loc.id === currentLocationId && loc.companyId === currentLocationCompanyId)
            : merged.find((loc) => loc.id === currentLocationId);
          if (found) {
            setSelectedLocationId(found.id);
            setSelectedCompanyId(found.companyId);
          } else {
            setSelectedLocationId('');
            setSelectedCompanyId('');
          }
        } else {
          setSelectedLocationId('');
          setSelectedCompanyId('');
        }
      } catch (err: any) {
        console.error('Error loading available locations:', err);
        setError(`Failed to load available locations: ${err.message}`);
      } finally {
        setLoading(false);
      }
    };

    loadAvailableLocations();
  }, [open, tenantId, companyIds.join(','), currentLocationId, currentLocationCompanyId]);

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
    onLocationChange(selectedLocationId || null, selectedCompanyId || undefined);
    onClose();
  };

  const handleClose = () => {
    setSelectedLocationId(currentLocationId || '');
    setSelectedCompanyId('');
    setError('');
    onClose();
  };

  const getLocationDisplayName = (location: Location) => {
    const base = location.nickname && location.nickname !== location.name
      ? `${location.nickname} (${location.name})`
      : location.name;
    return companyIds.length > 1 && location.companyName
      ? `${location.companyName} – ${base}`
      : base;
  };

  const handleSelectLocation = (loc: Location) => {
    setSelectedLocationId(loc.id);
    setSelectedCompanyId(loc.companyId);
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
                value={selectedLocationId && selectedCompanyId ? `${selectedCompanyId}:${selectedLocationId}` : ''}
                onChange={(e) => {
                  const v = e.target.value as string;
                  if (!v) {
                    setSelectedLocationId('');
                    setSelectedCompanyId('');
                    return;
                  }
                  const [cid, lid] = v.split(':');
                  const loc = availableLocations.find((l) => l.companyId === cid && l.id === lid);
                  if (loc) handleSelectLocation(loc);
                }}
                label="Select Location"
              >
                <MenuItem value="">
                  <em>No location selected</em>
                </MenuItem>
                {availableLocations.map((location) => (
                  <MenuItem key={`${location.companyId}:${location.id}`} value={`${location.companyId}:${location.id}`}>
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
                No locations available for {companyIds.length > 1 ? 'these companies' : 'this company'}
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
