import React from 'react';
import {
  Box,
  Typography,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
  Chip,
} from '@mui/material';
import {
  Close as CloseIcon,
  Delete as DeleteIcon,
  LocationOn as LocationIcon,
} from '@mui/icons-material';
import { Autocomplete, TextField } from '@mui/material';

interface LocationOption {
  id: string;
  name?: string;
  nickname?: string;
  title?: string;
  code?: string;
}

interface ManageContactLocationsDialogProps {
  open: boolean;
  onClose: () => void;
  companyLocations: LocationOption[];
  selectedLocations: LocationOption[];
  onSave: (locations: LocationOption[]) => void;
}

const ManageContactLocationsDialog: React.FC<ManageContactLocationsDialogProps> = ({
  open,
  onClose,
  companyLocations,
  selectedLocations,
  onSave,
}) => {
  const [addValue, setAddValue] = React.useState<LocationOption | null>(null);

  const availableToAdd = companyLocations.filter(
    (loc) => !selectedLocations.some((s) => s.id === loc.id)
  );

  const handleAdd = () => {
    if (!addValue) return;
    const next = [...selectedLocations, addValue];
    onSave(next);
    setAddValue(null);
  };

  const handleRemove = (locationId: string) => {
    onSave(selectedLocations.filter((loc) => loc.id !== locationId));
  };

  const displayName = (loc: LocationOption) => loc.nickname || loc.name || loc.title || 'Unknown Location';

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Box display="flex" alignItems="center" justifyContent="space-between">
          <Typography variant="h6">Work Locations</Typography>
          <IconButton onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>
      <DialogContent>
        <Box sx={{ pt: 1 }}>
          <Typography variant="subtitle1" fontWeight="bold" sx={{ mb: 2 }}>
            Current Locations ({selectedLocations.length})
          </Typography>
          {selectedLocations.length > 0 ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mb: 3 }}>
              {selectedLocations.map((location) => (
                <Box
                  key={location.id}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    p: 1.5,
                    borderRadius: 1,
                    bgcolor: 'grey.50',
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                    <LocationIcon fontSize="small" color="action" />
                    <Typography variant="body2">{displayName(location)}</Typography>
                    {location.code && (
                      <Chip label={location.code} size="small" variant="outlined" sx={{ flexShrink: 0 }} />
                    )}
                  </Box>
                  <IconButton size="small" onClick={() => handleRemove(location.id)} color="error">
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Box>
              ))}
            </Box>
          ) : (
            <Box sx={{ py: 2, px: 2, bgcolor: 'grey.50', borderRadius: 1, mb: 3 }}>
              <Typography variant="body2" color="text.secondary">
                No work locations assigned
              </Typography>
            </Box>
          )}

          <Typography variant="subtitle1" fontWeight="bold" sx={{ mb: 2 }}>
            Add Location
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
            <Autocomplete
              size="small"
              fullWidth
              options={availableToAdd}
              value={addValue}
              onChange={(_, newValue) => setAddValue(newValue)}
              getOptionLabel={(opt) => displayName(opt)}
              disabled={companyLocations.length === 0}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Select location"
                  placeholder="Select a location to add..."
                  InputProps={{
                    ...params.InputProps,
                    startAdornment: <LocationIcon sx={{ fontSize: 16, mr: 1, color: 'text.secondary' }} />,
                  }}
                />
              )}
              renderOption={(props, option) => (
                <li {...props}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <LocationIcon fontSize="small" color="action" />
                    <Typography variant="body2">{displayName(option)}</Typography>
                    {option.code && <Chip label={option.code} size="small" variant="outlined" />}
                  </Box>
                </li>
              )}
            />
            <Button variant="contained" onClick={handleAdd} disabled={!addValue} sx={{ flexShrink: 0 }}>
              Add
            </Button>
          </Box>
          {companyLocations.length === 0 && (
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
              Associate the contact with a company first to add work locations.
            </Typography>
          )}
        </Box>
      </DialogContent>
      <DialogActions sx={{ p: 3, pt: 0 }}>
        <Button onClick={onClose} variant="outlined">
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ManageContactLocationsDialog;
