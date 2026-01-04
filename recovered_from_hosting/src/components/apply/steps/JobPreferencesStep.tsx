import React from 'react';
import { Box, Chip, Typography, Alert, Stack, useTheme, useMediaQuery } from '@mui/material';
import { queueProfileUpdate } from '../../../utils/userProfileBatching';

type Props = {
  value: any;
  onChange: (v: any) => void;
  jobPosting?: any;
};

const baseShiftOptions = [
  'Full Time','Part Time','First Shift','Second Shift','Third Shift','Days','Nights','Swing','Some Weekends','Overtime','On Call','Flexible'
];


const JobPreferencesStep: React.FC<Props> = ({ value, onChange, jobPosting }) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
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
            ⏰ Shift Preferences
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            Select your preferred work schedules
          </Typography>

          {/* Required Shifts Section */}
          {requiredShifts.length > 0 && (
            <Box sx={{ mb: 2.5 }}>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                Must confirm before continuing
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
                    🎉 Great — you've met the shift requirements. Add more preferences below.
                  </Alert>
                )}
                
                <Stack direction="row" flexWrap="wrap" gap={1}>
                  {requiredShifts.map((shift: string) => {
                    const hasShift = !missingRequiredShifts.includes(shift);
                    return (
                      <Chip
                        key={shift}
                        label={hasShift ? `✔ ${shift}` : shift}
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
              ➕ Your Shift Preferences
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Add additional shift preferences to qualify for more roles
            </Typography>

            {/* Show added optional shifts */}
            {optionalShifts.length > 0 && (
              <Box sx={{ mb: 2 }}>
                <Stack direction="row" flexWrap="wrap" gap={1}>
                  {optionalShifts.map((shift: string) => (
                    <Chip
                      key={shift}
                      label={shift}
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
                  ⏰ You haven't added any additional shift preferences yet
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Add shift preferences to qualify for more roles.
                </Typography>
              </Box>
            )}

            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1, fontSize: '0.85rem' }}>
              Available shifts (tap to add):
            </Typography>
            <Stack direction="row" flexWrap="wrap" gap={1}>
              {allShiftOptions
                .filter(shift => !selectedShifts.includes(shift))
                .map((name) => (
                  <Chip
                    key={name}
                    label={name}
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


