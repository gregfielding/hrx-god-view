import React from 'react';
import { Box, Tooltip, Stack, Typography, Chip } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import WarningIcon from '@mui/icons-material/Warning';
import ErrorIcon from '@mui/icons-material/Error';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';

interface ComplianceStatusBarProps {
  workEligibility?: boolean;
  backgroundCheckStatus?: string;
  vaccinationStatus?: string;
  onWorkEligibilityClick?: () => void;
  onBackgroundCheckClick?: () => void;
  onVaccinationClick?: () => void;
  isAdminView?: boolean;
}

type StatusType = 'complete' | 'pending' | 'failed' | 'unknown';

interface StatusItem {
  label: string;
  status: StatusType;
  icon: React.ReactNode;
  color: string;
  tooltip: string;
  onClick?: () => void;
}

const ComplianceStatusBar: React.FC<ComplianceStatusBarProps> = ({
  workEligibility,
  backgroundCheckStatus,
  vaccinationStatus,
  onWorkEligibilityClick,
  onBackgroundCheckClick,
  onVaccinationClick,
  isAdminView = false,
}) => {
  const getStatus = (value: any, positiveValues: string[] = []): StatusType => {
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

  const getWorkEligibilityStatus = (): StatusType => {
    return getStatus(workEligibility);
  };

  const getBackgroundCheckStatusType = (): StatusType => {
    return getStatus(backgroundCheckStatus, ['passed', 'complete']);
  };

  const getVaccinationStatusType = (): StatusType => {
    if (!vaccinationStatus) return 'unknown';
    const normalized = vaccinationStatus.toLowerCase();
    if (normalized === 'up to date' || normalized === 'complete' || normalized === 'current') {
      return 'complete';
    }
    if (normalized === 'pending') return 'pending';
    if (normalized === 'exempt') return 'complete';
    return 'unknown';
  };

  const renderStatusIcon = (status: StatusType) => {
    switch (status) {
      case 'complete':
        return <CheckCircleIcon sx={{ fontSize: 20, color: 'success.main' }} />;
      case 'pending':
        return <WarningIcon sx={{ fontSize: 20, color: 'warning.main' }} />;
      case 'failed':
        return <ErrorIcon sx={{ fontSize: 20, color: 'error.main' }} />;
      default:
        return <HelpOutlineIcon sx={{ fontSize: 20, color: 'text.disabled' }} />;
    }
  };

  const renderStatusChip = (status: StatusType, label: string) => {
    let color: 'success' | 'warning' | 'error' | 'default' = 'default';
    switch (status) {
      case 'complete':
        color = 'success';
        break;
      case 'pending':
        color = 'warning';
        break;
      case 'failed':
        color = 'error';
        break;
      default:
        color = 'default';
    }
    return (
      <Chip
        size="small"
        label={label}
        color={color}
        sx={{ height: 22, fontSize: '0.7rem', fontWeight: 500 }}
      />
    );
  };

  if (!isAdminView) {
    return null;
  }

  const workEligibilityStatus = getWorkEligibilityStatus();
  const backgroundCheckStatusType = getBackgroundCheckStatusType();
  const vaccinationStatusType = getVaccinationStatusType();

  const items: StatusItem[] = [
    {
      label: 'Work Eligibility',
      status: workEligibilityStatus,
      icon: renderStatusIcon(workEligibilityStatus),
      color: workEligibilityStatus === 'complete' ? 'success.main' : workEligibilityStatus === 'pending' ? 'warning.main' : workEligibilityStatus === 'failed' ? 'error.main' : 'text.disabled',
      tooltip: `Work Eligibility: ${workEligibility === true ? 'Eligible' : workEligibility === false ? 'Not Eligible' : 'Unknown'}`,
      onClick: onWorkEligibilityClick,
    },
    {
      label: 'Background Check',
      status: backgroundCheckStatusType,
      icon: renderStatusIcon(backgroundCheckStatusType),
      color: backgroundCheckStatusType === 'complete' ? 'success.main' : backgroundCheckStatusType === 'pending' ? 'warning.main' : backgroundCheckStatusType === 'failed' ? 'error.main' : 'text.disabled',
      tooltip: `Background Check: ${backgroundCheckStatus || 'Not Available'}`,
      onClick: onBackgroundCheckClick,
    },
    {
      label: 'Vaccination',
      status: vaccinationStatusType,
      icon: renderStatusIcon(vaccinationStatusType),
      color: vaccinationStatusType === 'complete' ? 'success.main' : vaccinationStatusType === 'pending' ? 'warning.main' : vaccinationStatusType === 'failed' ? 'error.main' : 'text.disabled',
      tooltip: `Vaccination Status: ${vaccinationStatus || 'Not Available'}`,
      onClick: onVaccinationClick,
    },
  ].filter(item => item.status !== 'unknown' || item.label === 'Work Eligibility'); // Always show work eligibility

  if (items.length === 0) {
    return null;
  }

  return (
    <Box
      sx={{
        mt: 1,
        pt: 1,
        borderTop: '1px solid',
        borderColor: 'divider',
      }}
    >
      <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block', fontSize: '0.7rem', fontWeight: 500 }}>
        COMPLIANCE STATUS
      </Typography>
      <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap', gap: 1 }}>
        {items.map((item) => {
          const content = (
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                cursor: item.onClick ? 'pointer' : 'default',
                '&:hover': item.onClick ? { opacity: 0.7 } : {},
              }}
              onClick={item.onClick}
            >
              {item.icon}
              {renderStatusChip(item.status, item.label)}
            </Box>
          );

          return (
            <Tooltip key={item.label} title={item.tooltip} arrow>
              {content}
            </Tooltip>
          );
        })}
      </Stack>
    </Box>
  );
};

export default ComplianceStatusBar;

