import React, { useState } from 'react';
import {
  Box,
  TextField,
  Button,
  Typography,
  Alert,
  CircularProgress,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Grid,
  Paper,
  Divider
} from '@mui/material';
import { Send as SendIcon, ContentCopy as CopyIcon } from '@mui/icons-material';
import { useInviteUser } from '../hooks/useInviteUser';
import { useAuth } from '../contexts/AuthContext';
import { ClaimsRole } from '../contexts/AuthContext';

export interface InviteUserFormProps {
  // Form configuration
  title?: string;
  subtitle?: string;
  defaultRole?: ClaimsRole;
  allowedRoles?: ClaimsRole[];
  showRoleSelector?: boolean;
  
  // Flow-specific customization
  flowType?: 'recruiter' | 'workforce' | 'general';
  customMessage?: string;
  
  // Callbacks
  onSuccess?: (result: any) => void;
  onCancel?: () => void;
  
  // UI customization
  showCancelButton?: boolean;
  submitButtonText?: string;
  cancelButtonText?: string;
}

/**
 * Reusable invite user form component
 * Can be used by both Recruiter and Workforce flows
 */
export const InviteUserForm: React.FC<InviteUserFormProps> = ({
  title = 'Invite User',
  subtitle = 'Send an invitation to join your team',
  defaultRole = 'Worker',
  allowedRoles = ['Admin', 'Recruiter', 'Manager', 'Worker', 'Customer'],
  showRoleSelector = true,
  flowType = 'general',
  customMessage,
  onSuccess,
  onCancel,
  showCancelButton = true,
  submitButtonText = 'Send Invitation',
  cancelButtonText = 'Cancel'
}) => {
  const { activeTenant } = useAuth();
  const { loading, error, result, inviteUser, clearError, clearResult } = useInviteUser();
  
  const [formData, setFormData] = useState({
    email: '',
    firstName: '',
    lastName: '',
    role: defaultRole,
    customMessage: customMessage || ''
  });

  const [showInviteLink, setShowInviteLink] = useState(false);

  const handleInputChange = (field: string) => (event: React.ChangeEvent<HTMLInputElement>) => {
    setFormData(prev => ({
      ...prev,
      [field]: event.target.value
    }));
    clearError();
  };

  const handleRoleChange = (event: any) => {
    setFormData(prev => ({
      ...prev,
      role: event.target.value as ClaimsRole
    }));
    clearError();
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    
    if (!activeTenant) {
      return;
    }

    try {
      await inviteUser({
        email: formData.email,
        firstName: formData.firstName,
        lastName: formData.lastName,
        tenantId: activeTenant.id,
        desiredRole: formData.role,
        securityLevel: flowType === 'recruiter' ? '3' : '2',
        sendPasswordReset: true,
        customMessage: formData.customMessage || undefined
      });
      
      setShowInviteLink(true);
      onSuccess?.(result);
    } catch (error) {
      // Error is handled by the hook
    }
  };

  const handleCopyInviteLink = async () => {
    if (result?.inviteLink) {
      try {
        await navigator.clipboard.writeText(result.inviteLink);
        // You could add a toast notification here
      } catch (error) {
        console.error('Failed to copy invite link:', error);
      }
    }
  };

  const handleReset = () => {
    setFormData({
      email: '',
      firstName: '',
      lastName: '',
      role: defaultRole,
      customMessage: customMessage || ''
    });
    setShowInviteLink(false);
    clearError();
    clearResult();
  };

  if (showInviteLink && result) {
    return (
      <Paper sx={{ p: 3 }}>
        <Typography variant="h6" gutterBottom>
          Invitation Sent Successfully!
        </Typography>
        
        <Alert severity="success" sx={{ mb: 2 }}>
          <Typography variant="body2">
            {result.userExists 
              ? 'User already exists and has been added to the tenant.'
              : 'New user account created and invitation sent.'
            }
          </Typography>
        </Alert>

        <Box sx={{ mb: 2 }}>
          <Typography variant="subtitle2" gutterBottom>
            Invite Link:
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
            <TextField
              fullWidth
              value={result.inviteLink}
              InputProps={{ readOnly: true }}
              size="small"
              sx={{ fontFamily: 'monospace', fontSize: '0.875rem' }}
            />
            <Button
              variant="outlined"
              startIcon={<CopyIcon />}
              onClick={handleCopyInviteLink}
              size="small"
            >
              Copy
            </Button>
          </Box>
        </Box>

        <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
          <Button onClick={handleReset}>
            Send Another Invitation
          </Button>
          {onCancel && (
            <Button variant="outlined" onClick={onCancel}>
              Close
            </Button>
          )}
        </Box>
      </Paper>
    );
  }

  return (
    <Paper sx={{ p: 3 }}>
      <Typography variant="h6" gutterBottom>
        {title}
      </Typography>
      
      {subtitle && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          {subtitle}
        </Typography>
      )}

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={clearError}>
          {error}
        </Alert>
      )}

      <form onSubmit={handleSubmit}>
        <Grid container spacing={2}>
          <Grid item xs={12} sm={6}>
            <TextField
              fullWidth
              label="First Name"
              value={formData.firstName}
              onChange={handleInputChange('firstName')}
              required
              disabled={loading}
            />
          </Grid>
          
          <Grid item xs={12} sm={6}>
            <TextField
              fullWidth
              label="Last Name"
              value={formData.lastName}
              onChange={handleInputChange('lastName')}
              required
              disabled={loading}
            />
          </Grid>
          
          <Grid item xs={12}>
            <TextField
              fullWidth
              label="Email Address"
              type="email"
              value={formData.email}
              onChange={handleInputChange('email')}
              required
              disabled={loading}
            />
          </Grid>
          
          {showRoleSelector && (
            <Grid item xs={12}>
              <FormControl fullWidth required disabled={loading}>
                <InputLabel>Role</InputLabel>
                <Select
                  value={formData.role}
                  onChange={handleRoleChange}
                  label="Role"
                >
                  {allowedRoles.map(role => (
                    <MenuItem key={role} value={role}>
                      {role}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
          )}
          
          <Grid item xs={12}>
            <TextField
              fullWidth
              label="Custom Message (Optional)"
              multiline
              rows={3}
              value={formData.customMessage}
              onChange={handleInputChange('customMessage')}
              placeholder="Add a personal message to the invitation..."
              disabled={loading}
            />
          </Grid>
        </Grid>

        <Divider sx={{ my: 3 }} />

        <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
          {showCancelButton && onCancel && (
            <Button
              variant="outlined"
              onClick={onCancel}
              disabled={loading}
            >
              {cancelButtonText}
            </Button>
          )}
          
          <Button
            type="submit"
            variant="contained"
            startIcon={loading ? <CircularProgress size={20} /> : <SendIcon />}
            disabled={loading || !formData.email || !formData.firstName || !formData.lastName}
          >
            {loading ? 'Sending...' : submitButtonText}
          </Button>
        </Box>
      </form>
    </Paper>
  );
};

export default InviteUserForm;
