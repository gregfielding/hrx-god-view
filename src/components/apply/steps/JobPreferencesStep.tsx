import React from 'react';
import { Box, Chip, Typography, Alert, Stack, useTheme, useMediaQuery } from '@mui/material';
import { queueProfileUpdate } from '../../../utils/userProfileBatching';
import { useT } from '../../../i18n';

type Props = {
  value: any;
  onChange: (v: any) => void;
  jobPosting?: any;
};

const baseShiftOptions = [
  'Full Time','Part Time','First Shift','Second Shift','Third Shift','Days','Nights','Swing','Some Weekends','Overtime','On Call','Flexible'
];

const shiftOptionKeys: Record<string, string> = {
  'Full Time': 'profile.shiftFullTime', 'Part Time': 'profile.shiftPartTime',
  'First Shift': 'profile.shiftFirst', 'Second Shift': 'profile.shiftSecond', 'Third Shift': 'profile.shiftThird',
  'Days': 'profile.shiftDays', 'Nights': 'profile.shiftNights', 'Swing': 'profile.shiftSwing',
  'Some Weekends': 'profile.shiftSomeWeekends', 'Overtime': 'profile.shiftOvertime',
  'On Call': 'profile.shiftOnCall', 'Flexible': 'profile.shiftFlexible',
};


const JobPreferencesStep: React.FC<Props> = ({ value, onChange, jobPosting }) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const t = useT();
  const shiftLabel = (name: string) => t(shiftOptionKeys[name] || name);
  const handle = (field: string, v: any) => onChange({ ...value, [field]: v });

  // Use batched updates instead of immediate writes (imported at top)


  // Shift preferences (chip selector)
  const postingShifts: string[] = Array.isArray(jobPosting?.shift) ? jobPosting.shift.filter(Boolean) : [];
  const allShiftOptions: string[] = Array.from(new Set([...(postingShifts || []), ...baseShiftOptions]));
  const [selectedShifts, setSelectedShifts] = React.useState<string[]>(
    Array.isArray(value?.shiftPreferences)
      ? value.shiftPreferences
      : (value?.shift ? [String(value.shift)] : [])
  );

  React.useEffect(() => {
    if (Array.isArray(value?.shiftPreferences)) setSelectedShifts(value.shiftPreferences);
  }, [value?.shiftPreferences]);

  const toggleShift = (name: string) => {
    setSelectedShifts((prev) => {
      const exists = prev.includes(name);
      const next = exists ? prev.filter(s => s !== name) : [...prev, name];
      onChange({ ...value, shiftPreferences: next });
      queueProfileUpdate('preferences.shiftPreferences', next);
      return next;
    });
  };


  // Get required shifts from job posting
  const requiredShifts = React.useMemo(() => {
    if (!jobPosting || jobPosting.jobType === 'gig') return [];
    return postingShifts || [];
  }, [jobPosting, postingShifts]);

  // Separate required and optional shifts
  const requiredShiftsAdded = React.useMemo(() => {
    return selectedShifts.filter(shift => requiredShifts.includes(shift));
  }, [selectedShifts, requiredShifts]);

  const optionalShifts = React.useMemo(() => {
    return selectedShifts.filter(shift => !requiredShifts.includes(shift));
  }, [selectedShifts, requiredShifts]);

  // Missing required shifts
  const missingRequiredShifts = React.useMemo(() => {
    return requiredShifts.filter((shift: string) => !selectedShifts.includes(shift));
  }, [requiredShifts, selectedShifts]);

  // Check if all required shifts are added
  const allRequiredShiftsAdded = React.useMemo(() => {
    return requiredShifts.length > 0 && missingRequiredShifts.length === 0;
  }, [requiredShifts.length, missingRequiredShifts.length]);

  return (
    <Box>
      {/* Shift Preferences - Only show for Career jobs, not Gig jobs with specific shifts */}
      {jobPosting?.jobType !== 'gig' && (
        <Box sx={{ mb: 2.5 }}>
          <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>
            ⏰ {t('profile.shiftPreferences')}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            {t('profile.shiftPreferencesSubtext')}
          </Typography>

          {/* Required Shifts Section */}
          {requiredShifts.length > 0 && (
            <Box sx={{ mb: 2.5 }}>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                {t('profile.mustConfirmBeforeContinuing')}
              </Typography>
              
              <Box 
                sx={{ 
                  p: 2.5, 
                  bgcolor: 'warning.50',
                  borderRadius: 1,
                  border: '1px solid',
                  borderColor: 'warning.main'
                }}
              >
                {allRequiredShiftsAdded && (
                  <Alert 
                    severity="success" 
                    sx={{ 
                      mb: 2,
                      '& .MuiAlert-message': {
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1
                      }
                    }}
                  >
                    🎉 {t('profile.greatMetRequirements')}
                  </Alert>
                )}
                
                <Stack direction="row" flexWrap="wrap" gap={1}>
                  {requiredShifts.map((shift: string) => {
                    const hasShift = !missingRequiredShifts.includes(shift);
                    return (
                      <Chip
                        key={shift}
                        label={hasShift ? `✔ ${shiftLabel(shift)}` : shiftLabel(shift)}
                        onClick={() => !hasShift && toggleShift(shift)}
                        color={hasShift ? 'success' : 'default'}
                        variant={hasShift ? 'filled' : 'outlined'}
                        sx={{
                          fontWeight: hasShift ? 600 : 500,
                          cursor: hasShift ? 'default' : 'pointer',
                          height: 40,
                          fontSize: '0.95rem',
                          transition: 'all 0.2s ease',
                          '&:hover': hasShift ? {} : {
                            bgcolor: 'warning.main',
                            color: 'white',
                            borderColor: 'warning.main',
                            transform: 'scale(1.02)'
                          }
                        }}
                      />
                    );
                  })}
                </Stack>
                
                {allRequiredShiftsAdded && (
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 2, fontStyle: 'italic' }}>
                    {requiredShifts.length} required shift{requiredShifts.length === 1 ? '' : 's'} confirmed ▸ Great! Add more preferences below
                  </Typography>
                )}
              </Box>
            </Box>
          )}

          {/* Your Shift Preferences Section */}
          <Box sx={{ mb: 2 }}>
            <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>
              ➕ {t('profile.yourShiftPreferences')}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {t('profile.addShiftPreferencesSubtext')}
            </Typography>

            {/* Show added optional shifts */}
            {optionalShifts.length > 0 && (
              <Box sx={{ mb: 2 }}>
                <Stack direction="row" flexWrap="wrap" gap={1}>
                  {optionalShifts.map((shift: string) => (
                    <Chip
                      key={shift}
                      label={shiftLabel(shift)}
                      onDelete={() => toggleShift(shift)}
                      color="default"
                      sx={{
                        transition: 'all 0.2s ease',
                        '&:hover': {
                          transform: 'translateY(-2px)',
                          boxShadow: '0 2px 8px rgba(0,0,0,0.15)'
                        }
                      }}
                    />
                  ))}
                </Stack>
              </Box>
            )}

            {/* Available shifts */}
            {optionalShifts.length === 0 && (
              <Box sx={{ mb: 2, p: 2, bgcolor: 'grey.50', borderRadius: 1 }}>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                  ⏰ {t('profile.noShiftPreferencesYet')}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {t('profile.addShiftToQualify')}
                </Typography>
              </Box>
            )}

            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1, fontSize: '0.85rem' }}>
              {t('profile.availableShiftsTap')}
            </Typography>
            <Stack direction="row" flexWrap="wrap" gap={1}>
              {allShiftOptions
                .filter(shift => !selectedShifts.includes(shift))
                .map((name) => (
                  <Chip
                    key={name}
                    label={shiftLabel(name)}
                    onClick={() => toggleShift(name)}
                    variant="outlined"
                    sx={{
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      '&:hover': {
                        bgcolor: 'primary.main',
                        color: 'white',
                        borderColor: 'primary.main',
                        transform: 'translateY(-2px)',
                        boxShadow: '0 4px 8px rgba(0,0,0,0.15)'
                      }
                    }}
                  />
                ))}
            </Stack>
          </Box>
        </Box>
      )}
    </Box>
  );
};

export default JobPreferencesStep;


