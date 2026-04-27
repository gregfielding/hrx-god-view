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
  CircularProgress,
  Alert,
  Autocomplete,
  TextField,
} from '@mui/material';
import {
  Close as CloseIcon,
  Delete as DeleteIcon,
  Business as BusinessIcon,
  Add as AddIcon,
} from '@mui/icons-material';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase';

export interface CompanyOption {
  id: string;
  companyName?: string;
  name?: string;
  industry?: string;
}

interface ManageCompaniesDialogProps {
  open: boolean;
  onClose: () => void;
  tenantId: string;
  currentCompanies: CompanyOption[];
  onCompaniesChange: (companies: CompanyOption[]) => void;
}

const ManageCompaniesDialog: React.FC<ManageCompaniesDialogProps> = ({
  open,
  onClose,
  tenantId,
  currentCompanies,
  onCompaniesChange,
}) => {
  const [availableCompanies, setAvailableCompanies] = useState<CompanyOption[]>([]);
  const [selectedCompany, setSelectedCompany] = useState<CompanyOption | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !tenantId) return;

    const loadCompanies = async () => {
      setLoading(true);
      setError('');
      try {
        const companiesRef = collection(db, 'tenants', tenantId, 'crm_companies');
        const snapshot = await getDocs(companiesRef);
        const list: CompanyOption[] = snapshot.docs.map((d) => {
          const data = d.data();
          const name = data.companyName || data.name || data.displayName || '';
          return {
            id: d.id,
            companyName: name,
            name,
            industry: data.industry || data.sector || '',
          };
        });
        setAvailableCompanies(list);
      } catch (err: any) {
        console.error('Error loading companies:', err);
        setError('Failed to load companies');
      } finally {
        setLoading(false);
      }
    };

    loadCompanies();
  }, [open, tenantId]);

  const availableToAdd = availableCompanies.filter(
    (c) => !currentCompanies.some((cur) => cur.id === c.id)
  );

  const handleAddCompany = (company: CompanyOption) => {
    onCompaniesChange([...currentCompanies, company]);
    setSelectedCompany(null);
  };

  const handleRemoveCompany = (companyId: string) => {
    onCompaniesChange(currentCompanies.filter((c) => c.id !== companyId));
  };

  const handleClose = () => {
    setSelectedCompany(null);
    setError('');
    onClose();
  };

  const displayName = (c: CompanyOption) => c.companyName || c.name || 'Unknown Company';

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Box display="flex" alignItems="center" justifyContent="space-between">
          <Typography variant="h6">Manage Companies</Typography>
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

          <Box sx={{ mb: 3 }}>
            <Typography variant="subtitle1" fontWeight="bold" sx={{ mb: 2 }}>
              Current Companies ({currentCompanies.length})
            </Typography>
            {currentCompanies.length > 0 ? (
              <List sx={{ bgcolor: 'grey.50', borderRadius: 1 }}>
                {currentCompanies.map((company) => (
                  <ListItem key={company.id} sx={{ py: 1 }}>
                    <ListItemAvatar>
                      <Avatar sx={{ width: 40, height: 40, fontSize: '1rem', bgcolor: 'primary.main' }}>
                        {(company.companyName || company.name || 'C').charAt(0).toUpperCase()}
                      </Avatar>
                    </ListItemAvatar>
                    <ListItemText
                      primary={displayName(company)}
                      secondary={company.industry || undefined}
                    />
                    <ListItemSecondaryAction>
                      <IconButton
                        edge="end"
                        onClick={() => handleRemoveCompany(company.id)}
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
                  No companies assigned to this deal
                </Typography>
              </Box>
            )}
          </Box>

          <Typography variant="subtitle1" fontWeight="bold" sx={{ mb: 2 }}>
            Add Companies
          </Typography>
          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
              <CircularProgress />
            </Box>
          ) : (
            <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-end' }}>
              <Autocomplete
                fullWidth
                options={availableToAdd}
                value={selectedCompany}
                onChange={(_, newValue) => setSelectedCompany(newValue)}
                getOptionLabel={(opt) => displayName(opt)}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Select Company"
                    placeholder="Search by name..."
                  />
                )}
                renderOption={(props, opt) => (
                  <li {...props}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Avatar sx={{ width: 24, height: 24, fontSize: '0.75rem', bgcolor: 'primary.main' }}>
                        {(opt.companyName || opt.name || 'C').charAt(0).toUpperCase()}
                      </Avatar>
                      <Box>
                        <Typography variant="body2">{displayName(opt)}</Typography>
                        {opt.industry && (
                          <Typography variant="caption" color="text.secondary">
                            {opt.industry}
                          </Typography>
                        )}
                      </Box>
                    </Box>
                  </li>
                )}
              />
              <Button
                variant="contained"
                onClick={() => selectedCompany && handleAddCompany(selectedCompany)}
                disabled={!selectedCompany}
                startIcon={<AddIcon />}
              >
                Add
              </Button>
            </Box>
          )}
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

export default ManageCompaniesDialog;
