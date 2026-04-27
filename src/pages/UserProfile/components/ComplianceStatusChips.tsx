import React from 'react';
import { Stack, Chip, Box } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import WarningIcon from '@mui/icons-material/Warning';
import ErrorIcon from '@mui/icons-material/Error';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';

interface ComplianceStatusChipsProps {
  workEligibility?: boolean;
  backgroundCheckStatus?: string;
  vaccinationStatus?: string;
  onWorkEligibilityClick?: () => void;
  onBackgroundCheckClick?: () => void;
  onVaccinationClick?: () => void;
  compact?: boolean;
}

type StatusType = 'complete' | 'pending' | 'failed' | 'unknown';

const ComplianceStatusChips: React.FC<ComplianceStatusChipsProps> = ({
  workEligibility,
  backgroundCheckStatus,
  vaccinationStatus,
  onWorkEligibilityClick,
  onBackgroundCheckClick,
  onVaccinationClick,
  compact = false,
}) => {
  const getStatusType = (value: any, positiveValues: string[] = []): StatusType => {
    if (value === undefined || value === null) return 'unknown';
    if (typeof value === 'boolean') {
      return value ? 'complete' : 'failed';
    }
    if (typeof value === 'string') {
      const normalized = value.toLowerCase();
      if (positiveValues.includes(normalized)) return 'complete';
      if (normalized === 'pending') return 'pending';
      if (normalized === 'failed' || normalized === 'expired') return 'failed';
      return 'unknown';
    }
    return 'unknown';
  };

  const workEligibilityStatus = getStatusType(workEligibility);
  const backgroundCheckStatusType = getStatusType(backgroundCheckStatus, ['passed', 'complete']);
  const vaccinationStatusType = (() => {
    if (!vaccinationStatus) return 'unknown' as StatusType;
    const normalized = vaccinationStatus.toLowerCase();
    if (normalized === 'up to date' || normalized === 'complete' || normalized === 'current') return 'complete' as StatusType;
    if (normalized === 'pending') return 'pending' as StatusType;
    if (normalized === 'exempt') return 'complete' as StatusType;
    return 'unknown' as StatusType;
  })();

  const getChipColor = (status: StatusType): 'success' | 'warning' | 'error' | 'default' => {
    switch (status) {
      case 'complete':
        return 'success';
      case 'pending':
        return 'warning';
      case 'failed':
        return 'error';
      default:
        return 'default';
    }
  };

  const getChipLabel = (status: StatusType, defaultLabel: string): string => {
    if (status === 'complete') return defaultLabel;
    if (status === 'pending') return `${defaultLabel} Pending`;
    if (status === 'failed') return `${defaultLabel} Missing`;
    return defaultLabel;
  };

  const chips = [];

  if (workEligibility !== undefined) {
    chips.push({
      id: 'work-eligible',
      status: workEligibilityStatus,
      label: getChipLabel(workEligibilityStatus, 'Work Eligible'),
      onClick: onWorkEligibilityClick,
      icon: workEligibilityStatus === 'complete' ? '🟢' : workEligibilityStatus === 'pending' ? '🟡' : workEligibilityStatus === 'failed' ? '🔴' : '⚪',
    });
  }

  if (backgroundCheckStatus) {
    chips.push({
      id: 'background-check',
      status: backgroundCheckStatusType,
      label: getChipLabel(backgroundCheckStatusType, 'Background Check'),
      onClick: onBackgroundCheckClick,
      icon: backgroundCheckStatusType === 'complete' ? '🟢' : backgroundCheckStatusType === 'pending' ? '🟡' : backgroundCheckStatusType === 'failed' ? '🔴' : '⚪',
    });
  }

  if (vaccinationStatus) {
    chips.push({
      id: 'vaccination',
      status: vaccinationStatusType,
      label: getChipLabel(vaccinationStatusType, 'Vaccination'),
      onClick: onVaccinationClick,
      icon: vaccinationStatusType === 'complete' ? '🟢' : vaccinationStatusType === 'pending' ? '🟡' : vaccinationStatusType === 'failed' ? '🔴' : '⚪',
    });
  }

  if (chips.length === 0) {
    return null;
  }

  return (
    <Stack direction="row" spacing={0.75} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
      {chips.map((chip) => (
        <Chip
          key={chip.id}
          icon={<Box component="span" sx={{ fontSize: '0.875rem' }}>{chip.icon}</Box>}
          label={chip.label}
          size="small"
          color={getChipColor(chip.status)}
          onClick={chip.onClick}
          sx={{
            height: 24,
            fontSize: '0.75rem',
            fontWeight: 600,
            cursor: chip.onClick ? 'pointer' : 'default',
            '& .MuiChip-icon': {
              marginLeft: '6px',
              marginRight: '-4px',
            },
          }}
        />
      ))}
    </Stack>
  );
};

export default ComplianceStatusChips;

