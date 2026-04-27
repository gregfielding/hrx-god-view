import React from 'react';
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
} from '@mui/icons-material';

interface CompanyOption {
  id: string;
  companyName?: string;
  name?: string;
  industry?: string;
}

interface ManageContactCompanyDialogProps {
  open: boolean;
  onClose: () => void;
  currentCompany: { id: string; companyName?: string; name?: string } | null;
  allCompanies: CompanyOption[];
  loadingCompanies: boolean;
  suggestedCompanies: CompanyOption[];
  contactEmail?: string;
  onSave: (companyId: string | null) => void;
}

const ManageContactCompanyDialog: React.FC<ManageContactCompanyDialogProps> = ({
  open,
  onClose,
  currentCompany,
  allCompanies,
  loadingCompanies,
  suggestedCompanies,
  contactEmail,
  onSave,
}) => {
  const [selectedCompany, setSelectedCompany] = React.useState<CompanyOption | null>(null);

  const handleRemove = () => {
    onSave(null);
    setSelectedCompany(null);
    onClose();
  };

  const handleSelectAndClose = (company: CompanyOption) => {
    onSave(company.id);
    setSelectedCompany(null);
    onClose();
  };

  const displayName = (c: CompanyOption) => c.companyName || c.name || 'Unknown Company';

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Box display="flex" alignItems="center" justifyContent="space-between">
          <Typography variant="h6">Company</Typography>
          <IconButton onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>
      <DialogContent>
        <Box sx={{ pt: 1 }}>
          <Typography variant="subtitle1" fontWeight="bold" sx={{ mb: 2 }}>
            Current Company {currentCompany ? '(1)' : '(0)'}
          </Typography>
          {currentCompany ? (
            <List sx={{ bgcolor: 'grey.50', borderRadius: 1 }}>
              <ListItem sx={{ py: 1 }}>
                <ListItemAvatar>
                  <Avatar sx={{ width: 40, height: 40, fontSize: '1rem', bgcolor: 'primary.main' }}>
                    {(currentCompany.companyName || currentCompany.name || 'C').charAt(0).toUpperCase()}
                  </Avatar>
                </ListItemAvatar>
                <ListItemText
                  primary={currentCompany.companyName || currentCompany.name || 'Unknown'}
                  secondary={currentCompany.id}
                />
                <ListItemSecondaryAction>
                  <IconButton edge="end" onClick={handleRemove} color="error">
                    <DeleteIcon />
                  </IconButton>
                </ListItemSecondaryAction>
              </ListItem>
            </List>
          ) : (
            <Box sx={{ py: 2, px: 2, bgcolor: 'grey.50', borderRadius: 1 }}>
              <Typography variant="body2" color="text.secondary">
                No company associated
              </Typography>
            </Box>
          )}

          <Typography variant="subtitle1" fontWeight="bold" sx={{ mt: 3, mb: 2 }}>
            Associate with Company
          </Typography>
          <Autocomplete
            size="small"
            options={allCompanies}
            value={selectedCompany}
            onChange={(_, newValue) => setSelectedCompany(newValue)}
            getOptionLabel={(opt) => displayName(opt)}
            loading={loadingCompanies}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Select Company"
                placeholder="Search companies..."
                InputProps={{
                  ...params.InputProps,
                  startAdornment: <BusinessIcon sx={{ fontSize: 16, mr: 1, color: 'text.secondary' }} />,
                  endAdornment: (
                    <>
                      {loadingCompanies ? <CircularProgress color="inherit" size={20} /> : null}
                      {params.InputProps.endAdornment}
                    </>
                  ),
                }}
              />
            )}
            renderOption={(props, opt) => (
              <li {...props}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <BusinessIcon fontSize="small" color="action" />
                  <Typography variant="body2">{displayName(opt)}</Typography>
                  {opt.industry && (
                    <Typography variant="caption" color="text.secondary">
                      {opt.industry}
                    </Typography>
                  )}
                </Box>
              </li>
            )}
          />
          <Button
            variant="contained"
            size="small"
            disabled={!selectedCompany}
            onClick={() => selectedCompany && handleSelectAndClose(selectedCompany)}
            sx={{ mt: 2 }}
          >
            Add
          </Button>

          {suggestedCompanies.length > 0 && contactEmail?.includes('@') && (
            <Box sx={{ mt: 3 }}>
              <Typography variant="caption" color="text.secondary" display="block" gutterBottom>
                Suggested by email domain ({contactEmail.split('@')[1]}):
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                {suggestedCompanies.map((company) => (
                  <Button
                    key={company.id}
                    variant="outlined"
                    size="small"
                    onClick={() => handleSelectAndClose(company)}
                    sx={{ justifyContent: 'flex-start', textAlign: 'left' }}
                    startIcon={<BusinessIcon fontSize="small" />}
                  >
                    <Typography variant="body2">
                      {displayName(company)}
                    </Typography>
                  </Button>
                ))}
              </Box>
            </Box>
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

export default ManageContactCompanyDialog;
