import React, { useState } from 'react';
import { Box, Chip, Typography, Button, Dialog, DialogTitle, DialogContent, DialogActions } from '@mui/material';
import CheckCircle from '@mui/icons-material/CheckCircle';
import WarningAmber from '@mui/icons-material/WarningAmber';
import Schedule from '@mui/icons-material/Schedule';
import Verified from '@mui/icons-material/Verified';
import type { RequirementItemStatus, RequirementCategory, CertificationVerificationStatus } from '../utils/jobRequirementStatus';
import { useT } from '../i18n';

interface JobRequirementChipProps {
  item: RequirementItemStatus;
  categoryLabel: string;
  category?: RequirementCategory;
  /** When user answers YES/NO, update application and optionally profile. Called with (answer: 'Yes' | 'No') */
  onFix?: (answer: 'Yes' | 'No') => Promise<void>;
  /** When upload-required cert is missing, call this instead of yes/no dialog (e.g. navigate to profile certs). */
  onUploadClick?: () => void;
  /** Only show fix when user is logged in and has an application */
  showFixAction?: boolean;
  /** Show as action button "[ Add skill to qualify ]" instead of chip + Add link */
  variant?: 'chip' | 'actionButton';
  /** In list context: only show the action button (no "Missing" / label block) */
  compact?: boolean;
}

function getActionButtonLabel(category: RequirementCategory | undefined, categoryLabel: string): string {
  if (category === 'skills' || categoryLabel === 'Required Skills') return 'Add skill to qualify';
  if (category === 'licensesCerts' || categoryLabel === 'Licenses & Certifications') return 'Add certification to qualify';
  return 'Add to qualify';
}

function getCertDisplayState(status: CertificationVerificationStatus): { color: 'success' | 'warning' | 'error' | 'default'; icon: React.ReactNode; statusLabelKey: string } {
  switch (status) {
    case 'verified':
      return { color: 'success', icon: <Verified sx={{ fontSize: 16 }} />, statusLabelKey: 'jobs.certStatusVerified' };
    case 'uploaded':
      return { color: 'warning', icon: <Schedule sx={{ fontSize: 16 }} />, statusLabelKey: 'jobs.certStatusUploaded' };
    case 'expired':
      return { color: 'error', icon: <WarningAmber sx={{ fontSize: 16 }} />, statusLabelKey: 'jobs.certStatusExpired' };
    default:
      return { color: 'error', icon: undefined, statusLabelKey: 'jobs.certStatusMissing' };
  }
}

export const JobRequirementChip: React.FC<JobRequirementChipProps> = ({
  item,
  categoryLabel,
  category,
  onFix,
  onUploadClick,
  showFixAction,
  variant = 'chip',
  compact = false,
}) => {
  const t = useT();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const isCertWithUpload = item.requiresUpload && item.certificationVerification != null;
  const certStatus = item.certificationVerification;

  const handleOpen = () => {
    if (item.requiresUpload && certStatus === 'missing' && onUploadClick) {
      onUploadClick();
      return;
    }
    if (showFixAction && onFix && !item.requiresUpload) setDialogOpen(true);
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

  const actionLabel = getActionButtonLabel(category, categoryLabel);

  if (isCertWithUpload && certStatus) {
    const state = getCertDisplayState(certStatus);
    const statusLabel = t(state.statusLabelKey);
    const chipLabel = `${item.label} — ${statusLabel}`;
    return (
      <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
        <Chip
          size="small"
          label={chipLabel}
          variant="outlined"
          color={state.color as any}
          icon={state.icon as any}
          sx={{
            borderColor: `${state.color}.main`,
            ...(state.color === 'success' ? { backgroundColor: 'action.selected' } : {}),
          }}
        />
        {certStatus === 'missing' && showFixAction && (onUploadClick || onFix) && (
          <Button
            size="small"
            variant="outlined"
            color="primary"
            onClick={handleOpen}
            sx={{ textTransform: 'none', fontSize: '0.75rem' }}
          >
            {t('jobs.certUploadToQualify')}
          </Button>
        )}
      </Box>
    );
  }

  return (
    <>
      <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
        {variant === 'actionButton' && !item.met && showFixAction && onFix ? (
          compact ? (
            <Button
              size="small"
              variant="outlined"
              color="primary"
              onClick={handleOpen}
              sx={{ textTransform: 'none', fontSize: '0.8rem' }}
            >
              {actionLabel}
            </Button>
          ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 0.5 }}>
            <Typography variant="caption" color="text.secondary">
              {category === 'skills' || categoryLabel === 'Required Skills' ? 'Missing skill' : 'Missing'}
            </Typography>
            <Typography variant="body2" fontWeight={500}>
              {item.label}
            </Typography>
            <Button
              size="small"
              variant="outlined"
              color="primary"
              onClick={handleOpen}
              sx={{ textTransform: 'none', fontSize: '0.8rem' }}
            >
              {actionLabel}
            </Button>
          </Box>
          )
        ) : (
          <>
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
            {!item.met && showFixAction && onFix && variant === 'chip' && (
              <Button
                size="small"
                variant="text"
                color="primary"
                onClick={handleOpen}
                sx={{ minWidth: 0, px: 0.75, fontSize: '0.75rem' }}
              >
                {actionLabel}
              </Button>
            )}
          </>
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
