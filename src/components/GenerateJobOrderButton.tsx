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
  jobTitles?: string[];
  onJobOrderCreated?: (jobOrderIds: string[]) => void;
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
  jobTitles = [],
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
      const jobOrderIds = await jobOrderService.createJobOrderFromDeal(tenantId, dealId, user.uid);
      
      const jobOrderCount = jobOrderIds.length;
      const jobOrderText = jobOrderCount === 1 ? 'Job Order' : 'Job Orders';
      setSuccess(`${jobOrderCount} ${jobOrderText} created successfully!`);
      
      // Call the callback if provided
      if (onJobOrderCreated) {
        onJobOrderCreated(jobOrderIds);
      }
      
      // Close dialog after a short delay
      setTimeout(() => {
        setDialogOpen(false);
        setSuccess(null);
      }, 3000);
      
    } catch (err: any) {
      console.error('Error generating job orders:', err);
      setError(err.message || 'Failed to generate job orders');
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
              This will create Job Orders based on the current deal information:
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
              {jobTitles.length > 0 && (
                <Box sx={{ mt: 1 }}>
                  <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
                    Job Titles ({jobTitles.length}):
                  </Typography>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                    {jobTitles.map((title, index) => (
                      <Box
                        key={index}
                        sx={{
                          px: 1,
                          py: 0.5,
                          bgcolor: 'primary.light',
                          color: 'primary.contrastText',
                          borderRadius: 0.5,
                          fontSize: '0.75rem',
                          fontWeight: 500
                        }}
                      >
                        {title}
                      </Box>
                    ))}
                  </Box>
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                    One Job Order will be created for each job title above.
                  </Typography>
                </Box>
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
            The Job Orders will be created in draft status and can be edited in the Recruiter module.
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
            {loading ? 'Creating...' : `Create ${jobTitles.length > 0 ? jobTitles.length : ''} Job Order${jobTitles.length > 1 ? 's' : ''}`}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default GenerateJobOrderButton;
