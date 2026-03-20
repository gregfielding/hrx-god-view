import React from 'react';
import {
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  Grid,
  MenuItem,
  TextField,
  Typography,
  Card,
  CardHeader,
  CardContent,
  useTheme,
  useMediaQuery,
  Stack,
} from '@mui/material';
import { useT } from '../../../i18n';

type Props = {
  value: any;
  onChange: (v: any) => void;
  onSkipOptionalEeo?: () => void | Promise<void>;
};

const genderLabels: Record<string, string> = { '': 'profile.preferNotToSay', 'Male': 'profile.male', 'Female': 'profile.female', 'Nonbinary': 'profile.nonbinary', 'Other': 'profile.other' };
const veteranLabels: Record<string, string> = { '': 'profile.preferNotToSay', 'Not a veteran': 'profile.notAVeteran', 'Protected veteran': 'profile.protectedVeteran' };
const disabilityLabels: Record<string, string> = { '': 'profile.preferNotToSay', 'No disability': 'profile.noDisability', 'Has disability': 'profile.hasDisability' };

const WorkEligibilityStep: React.FC<Props> = ({ value, onChange, onSkipOptionalEeo }) => {
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
        <Grid item xs={12}>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            alignItems={{ xs: 'stretch', sm: 'center' }}
            justifyContent="space-between"
            spacing={1}
          >
            <Box>
              <Typography variant="subtitle2" component="h3" sx={{ fontWeight: 600 }}>
                {t('apply.optionalEeoTitle')}
              </Typography>
              <Typography variant="caption" color="text.secondary" display="block">
                {t('apply.optionalEeoHint')}
              </Typography>
            </Box>
            {onSkipOptionalEeo ? (
              <Button
                variant="outlined"
                size="small"
                onClick={() => void onSkipOptionalEeo()}
                sx={{ alignSelf: { xs: 'flex-start', sm: 'center' }, flexShrink: 0 }}
              >
                {t('apply.skipOptionalEeo')}
              </Button>
            ) : null}
          </Stack>
        </Grid>
        {/* Optional EEO self-identification (always visible) */}
        <Grid item xs={12} md={4}>
          <TextField
            select
            fullWidth
            label={t('profile.genderOptional')}
            value={value.gender || ''}
            onChange={(e) => handle('gender', e.target.value)}
            SelectProps={{
              displayEmpty: true,
              renderValue: (selected: any) => t(selected === '' ? 'profile.preferNotToSay' : (genderLabels[selected] || selected)),
            }}
            InputLabelProps={{ shrink: true }}
          >
            <MenuItem value="">{t('profile.preferNotToSay')}</MenuItem>
            <MenuItem value="Male">{t('profile.male')}</MenuItem>
            <MenuItem value="Female">{t('profile.female')}</MenuItem>
            <MenuItem value="Nonbinary">{t('profile.nonbinary')}</MenuItem>
            <MenuItem value="Other">{t('profile.other')}</MenuItem>
          </TextField>
        </Grid>
        <Grid item xs={12} md={4}>
          <TextField
            select
            fullWidth
            label={t('profile.veteranOptional')}
            value={value.veteranStatus || ''}
            onChange={(e) => handle('veteranStatus', e.target.value)}
            SelectProps={{
              displayEmpty: true,
              renderValue: (selected: any) => t(selected === '' ? 'profile.preferNotToSay' : (veteranLabels[selected] || selected)),
            }}
            InputLabelProps={{ shrink: true }}
          >
            <MenuItem value="">{t('profile.preferNotToSay')}</MenuItem>
            <MenuItem value="Not a veteran">{t('profile.notAVeteran')}</MenuItem>
            <MenuItem value="Protected veteran">{t('profile.protectedVeteran')}</MenuItem>
          </TextField>
        </Grid>
        <Grid item xs={12} md={4}>
          <TextField
            select
            fullWidth
            label={t('profile.disabilityOptional')}
            value={value.disabilityStatus || ''}
            onChange={(e) => handle('disabilityStatus', e.target.value)}
            SelectProps={{
              displayEmpty: true,
              renderValue: (selected: any) => t(selected === '' ? 'profile.preferNotToSay' : (disabilityLabels[selected] || selected)),
            }}
            InputLabelProps={{ shrink: true }}
          >
            <MenuItem value="">{t('profile.preferNotToSay')}</MenuItem>
            <MenuItem value="No disability">{t('profile.noDisability')}</MenuItem>
            <MenuItem value="Has disability">{t('profile.hasDisability')}</MenuItem>
          </TextField>
        </Grid>
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


