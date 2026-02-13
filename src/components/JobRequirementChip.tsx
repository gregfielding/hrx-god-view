import React, { useState } from 'react';
import { Box, Chip, Typography, Button, Dialog, DialogTitle, DialogContent, DialogActions } from '@mui/material';
import CheckCircle from '@mui/icons-material/CheckCircle';
import Error from '@mui/icons-material/Error';
import type { RequirementItemStatus } from '../utils/jobRequirementStatus';

interface JobRequirementChipProps {
  item: RequirementItemStatus;
  categoryLabel: string;
  /** When user answers YES/NO, update application and optionally profile. Called with (answer: 'Yes' | 'No') */
  onFix?: (answer: 'Yes' | 'No') => Promise<void>;
  /** Only show fix when user is logged in and has an application */
  showFixAction?: boolean;
}

export const JobRequirementChip: React.FC<JobRequirementChipProps> = ({
  item,
  categoryLabel,
  onFix,
  showFixAction,
}) => {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleOpen = () => {
    if (showFixAction && onFix) setDialogOpen(true);
  };

  const handleAnswer = async (answer: 'Yes' | 'No') => {
    if (!onFix) return;
    setSaving(true);
    try {
      await onFix(answer);
      setDialogOpen(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
        <Chip
          size="small"
          label={item.label}
          variant={item.met ? 'filled' : 'outlined'}
          color={item.met ? 'success' : 'default'}
          icon={item.met ? <CheckCircle sx={{ fontSize: 16, color: 'inherit' }} /> : undefined}
          sx={{
            ...(item.met
              ? { borderColor: 'success.main', backgroundColor: 'action.selected' }
              : {
                  borderColor: 'error.light',
                  color: 'error.dark',
                  '& .MuiChip-label': { fontWeight: 500 },
                }),
          }}
        />
        {!item.met && showFixAction && onFix && (
          <Button
            size="small"
            variant="text"
            color="primary"
            onClick={handleOpen}
            sx={{ minWidth: 0, px: 0.75, fontSize: '0.75rem' }}
          >
            Add
          </Button>
        )}
      </Box>

      <Dialog open={dialogOpen} onClose={() => !saving && setDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Update requirement</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Do you have the {categoryLabel.toLowerCase().replace(/s$/, '')} <strong>{item.label}</strong>?
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 2, pb: 2 }}>
          <Button onClick={() => handleAnswer('No')} disabled={saving} color="inherit">
            No
          </Button>
          <Button variant="contained" onClick={() => handleAnswer('Yes')} disabled={saving} color="primary">
            Yes
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};
