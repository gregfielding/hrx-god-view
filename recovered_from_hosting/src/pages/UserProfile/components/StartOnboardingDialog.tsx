import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
  Alert,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Chip,
  Stack,
} from '@mui/material';
import {
  Close as CloseIcon,
  Person as PersonIcon,
  Work as WorkIcon,
  CheckCircle as CheckCircleIcon,
} from '@mui/icons-material';
import { useAuth } from '../../../contexts/AuthContext';
import { startOnboarding } from '../utils/onboardingHelpers';
import type { OnboardingType } from '../utils/onboardingTasks';

interface StartOnboardingDialogProps {
  open: boolean;
  onClose: () => void;
  userId: string;
  tenantId: string;
  employeeOnboardStatus?: string;
  contractorOnboardStatus?: string;
  onOnboardingStarted?: () => void;
}

const StartOnboardingDialog: React.FC<StartOnboardingDialogProps> = ({
  open,
  onClose,
  userId,
  tenantId,
  employeeOnboardStatus,
  contractorOnboardStatus,
  onOnboardingStarted,
}) => {
  const { currentUser } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [onboardingType, setOnboardingType] = useState<OnboardingType | ''>('');

  const employeeInProgress = employeeOnboardStatus === 'In Progress';
  const contractorInProgress = contractorOnboardStatus === 'In Progress';
  const employeeCompleted = employeeOnboardStatus === 'Completed';
  const contractorCompleted = contractorOnboardStatus === 'Completed';


  const handleStart = async () => {
    if (!onboardingType) {
      setError('Please select an onboarding type');
      return;
    }

    if (onboardingType === 'employee' && employeeInProgress) {
      setError('Employee onboarding is already in progress');
      return;
    }

    if (onboardingType === 'contractor' && contractorInProgress) {
      setError('Contractor onboarding is already in progress');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // Start onboarding (this also initializes tasks)
      await startOnboarding(
        userId,
        tenantId,
        onboardingType,
        undefined, // No job order linking - assignment will handle this
        currentUser?.uid
      );

      // Reset form
      setOnboardingType('');

      // Close and notify parent
      onClose();
      if (onOnboardingStarted) {
        onOnboardingStarted();
      }
    } catch (err: any) {
      console.error('Error starting onboarding:', err);
      setError(err.message || 'Failed to start onboarding. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (!loading) {
      setOnboardingType('');
      setError('');
      onClose();
    }
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Box display="flex" alignItems="center" justifyContent="space-between">
          <Typography variant="h6">Start Onboarding</Typography>
          <IconButton onClick={handleClose} disabled={loading}>
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>

      <DialogContent>
        <Box sx={{ pt: 1 }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Select the type of onboarding to start. A user can have both employee and contractor onboarding processes.
          </Typography>

          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          {/* Current Status Display */}
          {(employeeInProgress || contractorInProgress || employeeCompleted || contractorCompleted) && (
            <Alert severity="info" sx={{ mb: 3 }}>
              <Typography variant="body2" fontWeight={600} sx={{ mb: 1 }}>
                Current Onboarding Status:
              </Typography>
              <Stack spacing={1}>
                {employeeInProgress && (
                  <Chip
                    icon={<PersonIcon />}
                    label="Employee: In Progress"
                    color="warning"
                    size="small"
                  />
                )}
                {employeeCompleted && (
                  <Chip
                    icon={<CheckCircleIcon />}
                    label="Employee: Completed"
                    color="success"
                    size="small"
                  />
                )}
                {contractorInProgress && (
                  <Chip
                    icon={<WorkIcon />}
                    label="Contractor: In Progress"
                    color="warning"
                    size="small"
                  />
                )}
                {contractorCompleted && (
                  <Chip
                    icon={<CheckCircleIcon />}
                    label="Contractor: Completed"
                    color="success"
                    size="small"
                  />
                )}
              </Stack>
            </Alert>
          )}

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {/* Onboarding Type Selection */}
            <FormControl fullWidth>
              <InputLabel>Onboarding Type *</InputLabel>
              <Select
                value={onboardingType}
                onChange={(e) => setOnboardingType(e.target.value as OnboardingType)}
                label="Onboarding Type *"
                disabled={loading}
              >
                <MenuItem value="employee" disabled={employeeInProgress}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <PersonIcon fontSize="small" />
                    <Box>
                      <Typography>Employee (W-2)</Typography>
                      {employeeInProgress && (
                        <Typography variant="caption" color="text.secondary">
                          Already in progress
                        </Typography>
                      )}
                      {employeeCompleted && (
                        <Typography variant="caption" color="success.main">
                          Completed
                        </Typography>
                      )}
                    </Box>
                  </Stack>
                </MenuItem>
                <MenuItem value="contractor" disabled={contractorInProgress}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <WorkIcon fontSize="small" />
                    <Box>
                      <Typography>Contractor (1099)</Typography>
                      {contractorInProgress && (
                        <Typography variant="caption" color="text.secondary">
                          Already in progress
                        </Typography>
                      )}
                      {contractorCompleted && (
                        <Typography variant="caption" color="success.main">
                          Completed
                        </Typography>
                      )}
                    </Box>
                  </Stack>
                </MenuItem>
              </Select>
            </FormControl>
          </Box>
        </Box>
      </DialogContent>

      <DialogActions sx={{ p: 3, pt: 0 }}>
        <Button onClick={handleClose} disabled={loading} variant="outlined">
          Cancel
        </Button>
        <Button
          variant="contained"
          color="primary"
          onClick={handleStart}
          disabled={!onboardingType || loading}
          size="large"
        >
          {loading ? 'Starting...' : 'Start Onboarding'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default StartOnboardingDialog;

