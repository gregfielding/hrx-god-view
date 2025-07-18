import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Typography,
  Box,
  Alert,
  CircularProgress,
  Autocomplete,
} from '@mui/material';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase';

interface UserInvitationDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

interface Organization {
  id: string;
  name: string;
  type: 'Agency' | 'Customer';
}

const UserInvitationDialog: React.FC<UserInvitationDialogProps> = ({
  open,
  onClose,
  onSuccess,
}) => {
  const [email, setEmail] = useState('');
  const [selectedOrg, setSelectedOrg] = useState<Organization | null>(null);
  const [orgType, setOrgType] = useState<'Agency' | 'Customer'>('Customer');
  const [role, setRole] = useState<'Worker' | 'Applicant'>('Worker');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [organizations, setOrganizations] = useState<Organization[]>([]);

  useEffect(() => {
    if (open) {
      fetchOrganizations();
    }
  }, [open, orgType]);

  const fetchOrganizations = async () => {
    try {
      const collectionName = 'tenants';
      const snapshot = await getDocs(collection(db, collectionName));
      const orgs = snapshot.docs.map(doc => ({
        id: doc.id,
        name: doc.data().name || doc.data().companyName || 'Unknown Organization',
        type: doc.data().type || 'Tenant'
      }));
      setOrganizations(orgs);
    } catch (error) {
      console.error('Error fetching organizations:', error);
    }
  };

  const handleSubmit = async () => {
    if (!email || !selectedOrg) {
      setError('Please fill in all required fields');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const functions = getFunctions();
      const createInviteToken = httpsCallable(functions, 'createInviteToken');

      const result = await createInviteToken({
        orgId: selectedOrg.id,
        type: selectedOrg.type,
        role,
        email,
        createdBy: 'system', // You might want to get this from auth context
      });

      const data = result.data as any;
      
      if (data.success) {
        setSuccess(true);
        setEmail('');
        setSelectedOrg(null);
        setRole('Worker');
        
        // Show success message and close after delay
        setTimeout(() => {
          setSuccess(false);
          onClose();
          onSuccess?.();
        }, 2000);
      }
    } catch (error: any) {
      setError(error.message || 'Failed to create invitation');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (!loading) {
      setEmail('');
      setSelectedOrg(null);
      setRole('Worker');
      setError('');
      setSuccess(false);
      onClose();
    }
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>Invite User</DialogTitle>
      <DialogContent>
        {success && (
          <Alert severity="success" sx={{ mb: 2 }}>
            Invitation created successfully! The user will receive an email with the invite link.
          </Alert>
        )}
        
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          <TextField
            label="Email Address"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            fullWidth
            required
          />

          <FormControl fullWidth>
            <InputLabel>Organization Type</InputLabel>
            <Select
              value={orgType}
              onChange={(e) => {
                setOrgType(e.target.value as 'Agency' | 'Customer');
                setSelectedOrg(null);
              }}
              label="Organization Type"
            >
              <MenuItem value="Customer">Customer</MenuItem>
              <MenuItem value="Agency">Agency</MenuItem>
            </Select>
          </FormControl>

          <Autocomplete
            options={organizations}
            getOptionLabel={(option) => option.name}
            value={selectedOrg}
            onChange={(_, newValue) => setSelectedOrg(newValue)}
            renderInput={(params) => (
              <TextField
                {...params}
                label={`Select ${orgType}`}
                required
              />
            )}
            isOptionEqualToValue={(option, value) => option.id === value.id}
          />

          <FormControl fullWidth>
            <InputLabel>Role</InputLabel>
            <Select
              value={role}
              onChange={(e) => setRole(e.target.value as 'Worker' | 'Applicant')}
              label="Role"
            >
              <MenuItem value="Worker">Worker</MenuItem>
              <MenuItem value="Applicant">Applicant</MenuItem>
            </Select>
          </FormControl>

          <Box sx={{ bgcolor: 'grey.50', p: 2, borderRadius: 1 }}>
            <Typography variant="body2" color="text.secondary">
              <strong>What happens next:</strong>
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              • An invitation link will be generated
            </Typography>
            <Typography variant="body2" color="text.secondary">
              • The user will receive an email with the invite link
            </Typography>
            <Typography variant="body2" color="text.secondary">
              • The user can complete their profile and join the organization
            </Typography>
          </Box>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={loading}>
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          variant="contained"
          disabled={loading || !email || !selectedOrg}
          startIcon={loading ? <CircularProgress size={20} /> : null}
        >
          {loading ? 'Creating Invitation...' : 'Create Invitation'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default UserInvitationDialog; 