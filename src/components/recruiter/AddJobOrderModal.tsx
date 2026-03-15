import React from 'react';
import { Box, Dialog, DialogContent, DialogTitle } from '@mui/material';
import { Add as AddIcon } from '@mui/icons-material';
import JobOrderForm from '../JobOrderForm';

/** Company option for account-scoped dropdown (id + display name). */
export type AccountCompanyOption = { id: string; companyName?: string; name?: string; label?: string };

export interface AddJobOrderModalProps {
  open: boolean;
  onClose: () => void;
  onSaved?: () => void | Promise<void>;
  tenantId: string | null;
  userId: string;
  /** When opening from an account/location, pass the account's Hiring Entity so E-Verify flows from it. */
  defaultHiringEntityId?: string | null;
  /** When opening from an account, pass only the account's linked companies (for dropdown). If one company, Company is pre-filled. */
  accountCompanies?: AccountCompanyOption[];
  /** When account has exactly one company, pre-fill the Company field. */
  defaultCompanyId?: string | null;
  /** When opening from Account > Location, pre-fill the Worksite (location) field. */
  defaultWorksiteId?: string | null;
  /** When opening from Account > Location, restrict Job Title dropdown to positions from that location's Pricing page. */
  jobTitleOptions?: string[];
}

const AddJobOrderModal: React.FC<AddJobOrderModalProps> = ({
  open,
  onClose,
  onSaved,
  tenantId,
  userId,
  defaultHiringEntityId,
  accountCompanies,
  defaultCompanyId,
  defaultWorksiteId,
  jobTitleOptions,
}) => {
  const handleSave = async () => {
    onClose();
    await onSaved?.();
  };

  const initialData: { hiringEntityId?: string; companyId?: string; worksiteId?: string } = {};
  if (defaultHiringEntityId) initialData.hiringEntityId = defaultHiringEntityId;
  if (defaultCompanyId) initialData.companyId = defaultCompanyId;
  if (defaultWorksiteId) initialData.worksiteId = defaultWorksiteId;

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
          initialData={Object.keys(initialData).length ? initialData : undefined}
          companies={accountCompanies}
          jobTitles={jobTitleOptions}
        />
      </DialogContent>
    </Dialog>
  );
};

export default AddJobOrderModal;
