import React from 'react';
import {
  Box,
  Checkbox,
  FormControlLabel,
  Grid,
  Typography,
  Card,
  CardHeader,
  CardContent,
  useTheme,
  useMediaQuery,
} from '@mui/material';
import { useT } from '../../../i18n';

type Props = {
  value: any;
  onChange: (v: any) => void;
  /**
   * Legacy prop — historically rendered a "Skip optional EEO" button.
   * Per W.3 the EEO collection (gender / veteranStatus / disabilityStatus)
   * is removed entirely (Greg's 2026-04-29 decision); the prop is kept
   * for source-compat with callers that still pass it (Wizard.tsx) but
   * is now a no-op. Safe to drop in W.6.
   */
  onSkipOptionalEeo?: () => void | Promise<void>;
};

const WorkEligibilityStep: React.FC<Props> = ({ value, onChange }) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const t = useT();
  const handle = (field: string, v: any) => onChange({ ...value, [field]: v });

  const content = (
    <Grid container spacing={2}>
        <Grid item xs={12}>
          <FormControlLabel
            control={<Checkbox checked={!!value.workAuthorized} onChange={(e) => handle('workAuthorized', e.target.checked)} aria-label={t('profile.authorizedToWork')} />}
            label={t('profile.authorizedToWork')}
          />
        </Grid>
        <Grid item xs={12}>
          <FormControlLabel
            control={<Checkbox checked={!!value.requireSponsorship} onChange={(e) => handle('requireSponsorship', e.target.checked)} aria-label={t('profile.requireSponsorship')} />}
            label={t('profile.requireSponsorship')}
          />
        </Grid>

        {value.workAuthorized !== true && (
          <Grid item xs={12}>
            <Typography variant="caption" color="text.secondary">
              {t('profile.confirmAuthorized')}
            </Typography>
          </Grid>
        )}
        {/*
          Optional EEO self-identification (gender / veteranStatus /
          disabilityStatus) was previously collected here. Removed per
          W.3 / Greg's 2026-04-29 decision: HRX is no longer collecting
          EEO data at all. Existing values on user docs are preserved
          server-side and will be cleaned up in W.6.
        */}
    </Grid>
  );

  return (
    <Box>
      {isMobile ? (
        <Box sx={{ mb: 2 }}>
          <Typography variant="h6" sx={{ fontSize: '1rem', fontWeight: 500, mb: 1.5 }}>
            {t('profile.workAuthTitle')}
          </Typography>
          {content}
        </Box>
      ) : (
        <Card variant="outlined" sx={{ mb: 3 }}>
          <CardHeader title={<Typography variant="h6">{t('profile.workAuthTitle')}</Typography>} />
          <CardContent>{content}</CardContent>
        </Card>
      )}
    </Box>
  );
};

export default WorkEligibilityStep;


