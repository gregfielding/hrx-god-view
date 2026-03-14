import React from 'react';
import { Box, Dialog, DialogContent, DialogTitle } from '@mui/material';
import { Add as AddIcon } from '@mui/icons-material';
import JobOrderForm from '../JobOrderForm';

export interface AddJobOrderModalProps {
  open: boolean;
  onClose: () => void;
  onSaved?: () => void | Promise<void>;
  tenantId: string | null;
  userId: string;
  /** When opening from an account/location, pass the account's Hiring Entity so E-Verify flows from it. */
  defaultHiringEntityId?: string | null;
}

const AddJobOrderModal: React.FC<AddJobOrderModalProps> = ({
  open,
  onClose,
  onSaved,
  tenantId,
  userId,
  defaultHiringEntityId,
}) => {
  const handleSave = async () => {
    onClose();
    await onSaved?.();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <AddIcon />
          New Job Order
        </Box>
      </DialogTitle>
      <DialogContent sx={{ p: 0 }}>
        <JobOrderForm
          onSave={handleSave}
          onCancel={onClose}
          tenantId={tenantId ?? undefined}
          createdBy={userId}
          initialData={defaultHiringEntityId ? { hiringEntityId: defaultHiringEntityId } : undefined}
        />
      </DialogContent>
    </Dialog>
  );
};

export default AddJobOrderModal;
