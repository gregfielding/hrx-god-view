import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Button,
  Stack,
  Chip,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  useTheme,
  useMediaQuery,
} from '@mui/material';
import CheckCircle from '@mui/icons-material/CheckCircle';
import WarningAmber from '@mui/icons-material/WarningAmber';
import Schedule from '@mui/icons-material/Schedule';
import Verified from '@mui/icons-material/Verified';
import CameraAlt from '@mui/icons-material/CameraAlt';
import type { RequirementItemStatus, RequirementCategory, CertificationVerificationStatus } from '../utils/jobRequirementStatus';
import { isUploadRequiredCert } from '../utils/certificationVerification';
import { useT } from '../i18n';

export interface RequirementInteractionProps {
  item: RequirementItemStatus;
  categoryLabel: string;
  category: RequirementCategory;
  /** All items in this category (e.g. for education dropdown options). */
  categoryItems?: RequirementItemStatus[];
  onFix?: (answer: 'Yes' | 'No') => Promise<void>;
  onUploadClick?: () => void;
  /** For education: persist selected level to profile + acks. */
  onEducationSelect?: (level: string) => Promise<void>;
  /** For health screening follow-up (e.g. willing to get vaccinated). */
  onFollowUpFix?: (answer: 'Yes' | 'No') => Promise<void>;
  /** Whether the main health screening answer was No (show follow-up). */
  showHealthFollowUp?: boolean;
  /** Only show interaction when user is logged in and has application */
  showInteraction?: boolean;
  /** Pre-selected education level (from profile) for education dropdown */
  initialEducationLevel?: string;
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

/** Extract a number of years from label like "2+ years", "3 years", "5+ years". */
function parseYearsFromLabel(label: string): number | null {
  const m = label.match(/(\d+)\s*\+?\s*years?/i) || label.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

/** Whether this screening uses the COVID vaccine two-step (main + follow-up). */
function isHealthScreeningWithFollowUp(label: string): boolean {
  const n = (label || '').toLowerCase();
  return n.includes('covid') || n.includes('vaccine') || n.includes('vaccination');
}

export const RequirementInteraction: React.FC<RequirementInteractionProps> = ({
  item,
  categoryLabel,
  category,
  categoryItems = [],
  onFix,
  onUploadClick,
  onEducationSelect,
  onFollowUpFix,
  showHealthFollowUp = false,
  showInteraction = true,
  initialEducationLevel = '',
}) => {
  const t = useT();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const [saving, setSaving] = useState(false);
  const [educationValue, setEducationValue] = useState<string>(initialEducationLevel);
  useEffect(() => {
    setEducationValue((prev) => initialEducationLevel || prev);
  }, [initialEducationLevel]);

  const isCertWithUpload = item.requiresUpload && item.certificationVerification != null;
  const certStatus = item.certificationVerification;
  const uploadRequiredCert = category === 'licensesCerts' && isUploadRequiredCert(item.label);
  const isAttestationOnlyCategory =
    category === 'backgroundCheckPackages' ||
    category === 'drugScreeningPanels' ||
    category === 'eVerify' ||
    category === 'additionalScreenings';

  const handleAnswer = async (answer: 'Yes' | 'No') => {
    if (!onFix) return;
    setSaving(true);
    try {
      await onFix(answer);
    } finally {
      setSaving(false);
    }
  };

  const handleFollowUpAnswer = async (answer: 'Yes' | 'No') => {
    if (!onFollowUpFix) return;
    setSaving(true);
    try {
      await onFollowUpFix(answer);
    } finally {
      setSaving(false);
    }
  };

  const handleEducationChange = async (level: string) => {
    if (!onEducationSelect || level === '') return;
    setEducationValue(level);
    setSaving(true);
    try {
      await onEducationSelect(level);
    } finally {
      setSaving(false);
    }
  };

  const renderYesNo = (question: string) => (
    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
      <Button size="small" variant="outlined" color="inherit" onClick={() => handleAnswer('No')} disabled={saving}>
        {t('jobs.no')}
      </Button>
      <Button size="small" variant="contained" color="primary" onClick={() => handleAnswer('Yes')} disabled={saving}>
        {t('jobs.yes')}
      </Button>
    </Stack>
  );

  // ——— Certifications (upload-required): status chip (Missing/Uploaded/Verified/Expired) + [Upload] [Yes — upload later] [No] ———
  if (isCertWithUpload && certStatus) {
    const state = getCertDisplayState(certStatus);
    const statusLabel = t(state.statusLabelKey);
    const chipLabel = `${item.label} — ${statusLabel}`;
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
          <Chip
            size="small"
            label={chipLabel}
            variant="outlined"
            color={state.color as any}
            icon={state.icon as any}
            sx={{ borderColor: `${state.color}.main` }}
          />
        </Box>
        {certStatus === 'missing' && showInteraction && (onUploadClick || onFix) && (
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {onUploadClick && (
              <Button
                size="small"
                variant="outlined"
                color="primary"
                startIcon={isMobile ? <CameraAlt /> : undefined}
                onClick={onUploadClick}
                disabled={saving}
              >
                {t('jobs.requirementsCertUploadCertificate')}
              </Button>
            )}
            {onFix && (
              <>
                <Button size="small" variant="outlined" color="primary" onClick={() => handleAnswer('Yes')} disabled={saving}>
                  {t('jobs.requirementsCertYesUploadLater')}
                </Button>
                <Button size="small" variant="outlined" color="inherit" onClick={() => handleAnswer('No')} disabled={saving}>
                  {t('jobs.no')}
                </Button>
              </>
            )}
          </Stack>
        )}
      </Box>
    );
  }

  // ——— Met: show green check ———
  if (item.met) {
    return (
      <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
        <Chip
          size="small"
          label={item.label}
          variant="filled"
          color="success"
          icon={<CheckCircle sx={{ fontSize: 16, color: 'inherit' }} />}
        />
      </Box>
    );
  }

  // ——— Not met: show contextual question + controls (only when showInteraction) ———
  if (!showInteraction) {
    return (
      <Chip size="small" label={item.label} variant="outlined" color="default" sx={{ borderColor: 'error.light', color: 'error.dark' }} />
    );
  }

  // 1. HEALTH SCREENING (additionalScreenings)
  if (category === 'additionalScreenings') {
    const isCovid = isHealthScreeningWithFollowUp(item.label);
    const mainQuestion = isCovid
      ? 'Willing to meet vaccination requirement?'
      : `Willing to complete ${item.label}?`;
    const attestationLabel = (() => {
      if (item.attestationState === 'willing') {
        return isCovid ? 'Willing to meet vaccination requirement' : `Willing to complete ${item.label}`;
      }
      if (item.attestationState === 'unwilling') {
        return isCovid ? 'Not willing to meet vaccination requirement' : `Not willing to complete ${item.label}`;
      }
      return '';
    })();
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {attestationLabel ? (
          <Chip
            size="small"
            label={attestationLabel}
            variant="outlined"
            color={item.attestationState === 'willing' ? 'warning' : 'default'}
            sx={{ alignSelf: 'flex-start' }}
          />
        ) : null}
        <Typography variant="body2" color="text.secondary">
          {mainQuestion}
        </Typography>
        {renderYesNo(mainQuestion)}
        {isCovid && showHealthFollowUp && onFollowUpFix && (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {t('jobs.requirementsHealthFollowUpCovid')}
            </Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Button size="small" variant="outlined" color="inherit" onClick={() => handleFollowUpAnswer('No')} disabled={saving}>
                {t('jobs.no')}
              </Button>
              <Button size="small" variant="contained" color="primary" onClick={() => handleFollowUpAnswer('Yes')} disabled={saving}>
                {t('jobs.yes')}
              </Button>
            </Stack>
          </>
        )}
      </Box>
    );
  }

  // 2. SKILLS
  if (category === 'skills') {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
        <Typography variant="body2" color="text.secondary">
          {t('jobs.requirementsSkillQuestion')} <strong>{item.label}</strong>
        </Typography>
        {onFix && renderYesNo('')}
      </Box>
    );
  }

  // 3. EXPERIENCE
  if (category === 'experienceLevels') {
    const years = parseYearsFromLabel(item.label);
    const question = years != null
      ? t('jobs.requirementsExperienceQuestion', { years: String(years) })
      : t('jobs.requirementsExperienceLevelQuestion');
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
        <Typography variant="body2" color="text.secondary">
          {years != null ? question : `${question} (${item.label})`}
        </Typography>
        {onFix && renderYesNo('')}
      </Box>
    );
  }

  // 4. CERTIFICATIONS (default: Yes/No)
  if (category === 'licensesCerts' && !uploadRequiredCert) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
        <Typography variant="body2" color="text.secondary">
          {t('jobs.requirementsCertQuestion')} <strong>{item.label}</strong>?
        </Typography>
        {onFix && renderYesNo('')}
      </Box>
    );
  }

  // 5. LANGUAGE
  if (category === 'languages') {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
        <Typography variant="body2" color="text.secondary">
          {t('jobs.requirementsLanguageQuestion', { language: item.label })}
        </Typography>
        {onFix && renderYesNo('')}
      </Box>
    );
  }

  // 6. EDUCATION: dropdown
  if (category === 'educationLevels') {
    const options = categoryItems.length > 0 ? categoryItems.map((i) => i.label) : [item.label];
    const value = educationValue || initialEducationLevel;
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
        <Typography variant="body2" color="text.secondary" gutterBottom>
          {t('jobs.requirementsEducationQuestion')}
        </Typography>
        {onEducationSelect && (
          <FormControl size="small" sx={{ minWidth: 200 }}>
            <InputLabel id={`education-${item.label}`}>Level</InputLabel>
            <Select
              labelId={`education-${item.label}`}
              value={value}
              label="Level"
              onChange={(e) => handleEducationChange(e.target.value)}
              disabled={saving}
              displayEmpty
            >
              <MenuItem value="">
                <em>Select level</em>
              </MenuItem>
              {options.map((opt) => (
                <MenuItem key={opt} value={opt}>{opt}</MenuItem>
              ))}
            </Select>
          </FormControl>
        )}
      </Box>
    );
  }

  // 7. Default: generic Yes/No (background, drug, eVerify, physical, uniform, requiredPpe)
  if (isAttestationOnlyCategory) {
    const attestationCopy = (() => {
      if (category === 'backgroundCheckPackages') {
        if (item.attestationState === 'willing') return 'Willing to complete background check';
        if (item.attestationState === 'unwilling') return 'Not willing to complete background check';
        return '';
      }
      if (category === 'drugScreeningPanels') {
        if (item.attestationState === 'willing') return 'Willing to complete drug screening';
        if (item.attestationState === 'unwilling') return 'Not willing to complete drug screening';
        return '';
      }
      if (category === 'eVerify') {
        if (item.attestationState === 'willing') return 'Willing to complete E-Verify';
        if (item.attestationState === 'unwilling') return 'Not willing to complete E-Verify';
        return '';
      }
      return '';
    })();
    const question = (() => {
      if (category === 'backgroundCheckPackages') return 'Willing to complete background check?';
      if (category === 'drugScreeningPanels') return 'Willing to complete drug screening?';
      if (category === 'eVerify') return 'Willing to complete E-Verify?';
      return `Willing to complete ${item.label}?`;
    })();
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
        {attestationCopy ? (
          <Chip
            size="small"
            label={attestationCopy}
            variant="outlined"
            color={item.attestationState === 'willing' ? 'warning' : 'default'}
            sx={{ alignSelf: 'flex-start' }}
          />
        ) : null}
        <Typography variant="body2" color="text.secondary">
          {question}
        </Typography>
        {onFix && renderYesNo('')}
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
      <Typography variant="body2" color="text.secondary">
        Do you have / Are you comfortable with <strong>{item.label}</strong>?
      </Typography>
      {onFix && renderYesNo('')}
    </Box>
  );
};
