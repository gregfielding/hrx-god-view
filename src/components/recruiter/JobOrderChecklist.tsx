import React from 'react';
import { Box, Typography, Stack, Checkbox, Chip, Button, Tooltip } from '@mui/material';
import {
  CheckCircle as CheckCircleIcon,
  RadioButtonUnchecked as RadioButtonUncheckedIcon,
  LocationOn as LocationIcon,
  Contacts as ContactsIcon,
  People as PeopleIcon
} from '@mui/icons-material';
import { JobOrder } from '../../types/recruiter/jobOrder';

interface JobOrderChecklistProps {
  jobOrder: JobOrder | null;
  location: any;
  associatedContacts: any[];
  onEditLocation?: () => void;
  onEditContacts?: () => void;
  recruiterUsers?: Array<{ id: string }>;
  onEditRecruiters?: () => void;
}

type ChecklistStatus = 'complete' | 'missing';

interface ChecklistItem {
  id: string;
  label: string;
  description?: string;
  status: ChecklistStatus;
  auto: boolean;
  icon: React.ReactNode;
  onAction?: () => void;
  actionLabel?: string;
}

const ChecklistRow: React.FC<{ item: ChecklistItem }> = ({ item }) => {
  const isComplete = item.status === 'complete';

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        p: 1.5,
        borderRadius: 1,
        border: '1px solid',
        borderColor: isComplete ? 'success.light' : 'divider',
        bgcolor: isComplete ? 'success.light' : 'background.paper',
        mb: 1.5,
        transition: 'background-color 0.2s ease, border-color 0.2s ease',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flex: 1, minWidth: 0 }}>
        <Checkbox
          checked={isComplete}
          disabled={item.auto}
          icon={<RadioButtonUncheckedIcon sx={{ color: 'grey.400' }} />}
          checkedIcon={<CheckCircleIcon sx={{ color: 'success.main' }} />}
          sx={{ p: 0.5 }}
        />
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0 }}>
          <Box
            sx={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              bgcolor: 'grey.100',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: isComplete ? 'success.main' : 'text.secondary',
              flexShrink: 0,
            }}
          >
            {item.icon}
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography
              variant="body2"
              fontWeight={600}
              sx={{ whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}
            >
              {item.label}
            </Typography>
            {item.description && (
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: 'block' }}
              >
                {item.description}
              </Typography>
            )}
          </Box>
        </Box>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0, ml: 2 }}>
        <Chip
          size="small"
          label={isComplete ? 'Complete' : 'Missing'}
          color={isComplete ? 'success' : 'warning'}
          variant={isComplete ? 'filled' : 'outlined'}
          sx={{ fontWeight: 600, fontSize: '0.7rem' }}
        />
        <Tooltip title={item.auto ? 'This item updates automatically' : 'This item can be checked manually'}>
          <Typography variant="caption" color="text.secondary">
            {item.auto ? 'Auto' : 'Manual'}
          </Typography>
        </Tooltip>
        {item.onAction && !isComplete && (
          <Button
            variant="outlined"
            size="small"
            onClick={item.onAction}
            sx={{ textTransform: 'none', fontSize: '0.75rem' }}
          >
            {item.actionLabel || 'Update'}
          </Button>
        )}
      </Box>
    </Box>
  );
};

const JobOrderChecklist: React.FC<JobOrderChecklistProps> = ({
  jobOrder,
  location,
  associatedContacts,
  onEditLocation,
  onEditContacts,
  recruiterUsers = [],
  onEditRecruiters,
}) => {
  // Auto-computed status: does this job order have a worksite / location?
  const hasLocation = (() => {
    if (!jobOrder) return false;
    const worksiteName = (jobOrder as any).worksiteName;
    const loadedLocationName = location?.nickname || location?.name;
    const dealLocations = (jobOrder.deal as any)?.associations?.locations || [];
    const locationEntry = Array.isArray(dealLocations) && dealLocations.length > 0 ? dealLocations[0] : null;
    const dealLocationName =
      typeof locationEntry === 'string'
        ? ''
        : (locationEntry?.snapshot?.name ||
           locationEntry?.snapshot?.nickname ||
           locationEntry?.name ||
           '');

    const displayLocationName = worksiteName || loadedLocationName || dealLocationName;
    return !!displayLocationName;
  })();

  // Auto-computed status: does this job order have at least one associated deal contact?
  const hasDealContact = Array.isArray(associatedContacts) && associatedContacts.length > 0;

  // Auto-computed status: does this job order have at least one recruiter assigned?
  const hasRecruiterAssigned =
    (Array.isArray((jobOrder as any)?.assignedRecruiters) && (jobOrder as any).assignedRecruiters.length > 0) ||
    (Array.isArray(recruiterUsers) && recruiterUsers.length > 0);

  const items: ChecklistItem[] = [
    {
      id: 'worksite',
      label: 'Worksite location is set',
      description: hasLocation
        ? 'This job order is linked to a worksite location.'
        : 'Add a worksite so staff know where this job is located.',
      status: hasLocation ? 'complete' : 'missing',
      auto: true,
      icon: <LocationIcon sx={{ fontSize: 18 }} />,
      onAction: hasLocation ? undefined : onEditLocation,
      actionLabel: 'Add location',
    },
    {
      id: 'dealContact',
      label: 'Primary deal contact added',
      description: hasDealContact
        ? 'At least one CRM deal contact is associated to this job order.'
        : 'Add a hiring manager or primary contact for this job.',
      status: hasDealContact ? 'complete' : 'missing',
      auto: true,
      icon: <ContactsIcon sx={{ fontSize: 18 }} />,
      onAction: hasDealContact ? undefined : onEditContacts,
      actionLabel: 'Add contact',
    },
    {
      id: 'recruiterAssigned',
      label: 'Recruiter assigned',
      description: hasRecruiterAssigned
        ? 'At least one recruiter is assigned to own this job order.'
        : 'Assign a recruiter so someone is clearly responsible for this job.',
      status: hasRecruiterAssigned ? 'complete' : 'missing',
      auto: true,
      icon: <PeopleIcon sx={{ fontSize: 18 }} />,
      onAction: hasRecruiterAssigned ? undefined : onEditRecruiters,
      actionLabel: 'Assign recruiter',
    },
  ];

  return (
    <Box px={3} py={4}>
      <Typography variant="h6" fontWeight={700} gutterBottom>
        Checklist
      </Typography>
      <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 3 }}>
        Track key launch steps for this job order. Items marked as **Auto** will complete themselves
        as you link locations, contacts, and other required data.
      </Typography>

      <Stack spacing={1.5}>
        {items.map(item => (
          <ChecklistRow key={item.id} item={item} />
        ))}
      </Stack>
    </Box>
  );
};

export default JobOrderChecklist;


