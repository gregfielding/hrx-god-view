import React, { useState } from 'react';
import {
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  CircularProgress,
  Alert,
  Box,
  Typography,
  SxProps,
  Theme
} from '@mui/material';
import {
  Work as WorkIcon,
  Add as AddIcon
} from '@mui/icons-material';
import { JobOrderService } from '../services/recruiter/jobOrderService';
import { useAuth } from '../contexts/AuthContext';

interface GenerateJobOrderButtonProps {
  dealId: string;
  dealName: string;
  companyId?: string;
  companyName?: string;
  onJobOrderCreated?: (jobOrderId: string) => void;
  disabled?: boolean;
  variant?: 'contained' | 'outlined' | 'text';
  size?: 'small' | 'medium' | 'large';
  sx?: SxProps<Theme>;
}

const GenerateJobOrderButton: React.FC<GenerateJobOrderButtonProps> = ({
  dealId,
  dealName,
  companyId,
  companyName,
  onJobOrderCreated,
  disabled = false,
  variant = 'contained',
  size = 'medium',
  sx
}) => {
  const { tenantId, user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleGenerateJobOrder = async () => {
    if (!tenantId || !user?.uid) {
      setError('Missing tenant or user information');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const jobOrderService = JobOrderService.getInstance();
      const jobOrderId = await jobOrderService.createJobOrderFromDeal(tenantId, dealId, user.uid);
      
      setSuccess(`Job Order created successfully! Job Order ID: ${jobOrderId}`);
      
      // Call the callback if provided
      if (onJobOrderCreated) {
        onJobOrderCreated(jobOrderId);
      }
      
      // Close dialog after a short delay
      setTimeout(() => {
        setDialogOpen(false);
        setSuccess(null);
      }, 2000);
      
    } catch (err: any) {
      console.error('Error generating job order:', err);
      setError(err.message || 'Failed to generate job order');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenDialog = () => {
    setDialogOpen(true);
    setError(null);
    setSuccess(null);
  };

  const handleCloseDialog = () => {
    if (!loading) {
      setDialogOpen(false);
      setError(null);
      setSuccess(null);
    }
  };

  return (
    <>
      <Button
        variant={variant}
        size={size}
        startIcon={<WorkIcon />}
        onClick={handleOpenDialog}
        disabled={disabled}
        sx={{
          bgcolor: variant === 'contained' ? 'primary.main' : undefined,
          '&:hover': {
            bgcolor: variant === 'contained' ? 'primary.dark' : undefined,
          },
          ...sx
        }}
      >
        Generate Job Order
      </Button>

      <Dialog
        open={dialogOpen}
        onClose={handleCloseDialog}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <WorkIcon color="primary" />
            Generate Job Order from Deal
          </Box>
        </DialogTitle>
        
        <DialogContent>
          <Box sx={{ mb: 2 }}>
            <Typography variant="body1" gutterBottom>
              This will create a new Job Order based on the current deal information:
            </Typography>
            
            <Box sx={{ mt: 2, p: 2, bgcolor: 'grey.50', borderRadius: 1 }}>
              <Typography variant="subtitle2" color="text.secondary">
                Deal: <strong>{dealName}</strong>
              </Typography>
              {companyName && (
                <Typography variant="subtitle2" color="text.secondary">
                  Company: <strong>{companyName}</strong>
                </Typography>
              )}
            </Box>
          </Box>

          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          {success && (
            <Alert severity="success" sx={{ mb: 2 }}>
              {success}
            </Alert>
          )}

          <Typography variant="body2" color="text.secondary">
            The Job Order will be created in draft status and can be edited in the Recruiter module.
            All relevant deal information will be pre-populated to minimize data entry.
          </Typography>
        </DialogContent>

        <DialogActions>
          <Button 
            onClick={handleCloseDialog} 
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            onClick={handleGenerateJobOrder}
            variant="contained"
            disabled={loading}
            startIcon={loading ? <CircularProgress size={20} /> : <AddIcon />}
          >
            {loading ? 'Creating...' : 'Create Job Order'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default GenerateJobOrderButton;
