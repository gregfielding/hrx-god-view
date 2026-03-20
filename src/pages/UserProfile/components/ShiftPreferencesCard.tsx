import React, { useState, useEffect } from 'react';
import { Box, Chip, Typography, Stack, Card, CardContent } from '@mui/material';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../../firebase';
import { queueProfileUpdate } from '../../../utils/userProfileBatching';
import { useT } from '../../../i18n';

type Props = {
  uid: string;
  titleOverride?: string;
  /** When true (e.g. admin Qualifications panel), only show selected preferences — no subtext, no "add more" options. */
  displayOnly?: boolean;
};

const baseShiftOptions = [
  'Full Time', 'Part Time', 'First Shift', 'Second Shift', 'Third Shift',
  'Days', 'Nights', 'Swing', 'Some Weekends', 'Overtime', 'On Call', 'Flexible'
];

const shiftOptionKeys: Record<string, string> = {
  'Full Time': 'profile.shiftFullTime',
  'Part Time': 'profile.shiftPartTime',
  'First Shift': 'profile.shiftFirst',
  'Second Shift': 'profile.shiftSecond',
  'Third Shift': 'profile.shiftThird',
  'Days': 'profile.shiftDays',
  'Nights': 'profile.shiftNights',
  'Swing': 'profile.shiftSwing',
  'Some Weekends': 'profile.shiftSomeWeekends',
  'Overtime': 'profile.shiftOvertime',
  'On Call': 'profile.shiftOnCall',
  'Flexible': 'profile.shiftFlexible',
};

const ShiftPreferencesCard: React.FC<Props> = ({ uid, titleOverride, displayOnly }) => {
  const t = useT();
  const [selectedShifts, setSelectedShifts] = useState<string[]>([]);
  const shiftLabel = (name: string) => {
    const key = shiftOptionKeys[name] || name;
    const translated = t(key);
    return translated === key ? name : translated;
  };

  useEffect(() => {
    if (!uid) return;

    const userRef = doc(db, 'users', uid);
    const unsubscribe = onSnapshot(userRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        const shiftPreferences = data.preferences?.shiftPreferences || [];
        const shiftValue = data.preferences?.shift || data.shift;
        const initialShifts = Array.isArray(shiftPreferences) && shiftPreferences.length > 0
          ? shiftPreferences
          : (shiftValue ? [String(shiftValue)] : []);
        setSelectedShifts(initialShifts);
      }
    });

    return () => unsubscribe();
  }, [uid]);

  const toggleShift = (name: string) => {
    setSelectedShifts((prev) => {
      const exists = prev.includes(name);
      const next = exists ? prev.filter(s => s !== name) : [...prev, name];
      
      // Update Firestore
      queueProfileUpdate('preferences.shiftPreferences', next);
      
      return next;
    });
  };

  if (displayOnly) {
    return (
      <Box>
        {selectedShifts.length > 0 ? (
          <Stack direction="row" flexWrap="wrap" gap={0.75}>
            {selectedShifts.map((shift: string) => (
              <Chip key={shift} label={shiftLabel(shift)} size="small" variant="outlined" />
            ))}
          </Stack>
        ) : (
          <Typography variant="body2" color="text.secondary">No preferences selected.</Typography>
        )}
      </Box>
    );
  }

  const optionalShifts = selectedShifts;
  const allShiftOptions = baseShiftOptions;
  const titleText = titleOverride || t('profile.shiftPreferences') || 'Availability and preferences';
  const subtext = t('profile.shiftPreferencesSubtext');
  const subtextDisplay = subtext === 'profile.shiftPreferencesSubtext' ? 'Select your preferred work schedules' : subtext;

  return (
    <Card variant="outlined" sx={{ bgcolor: 'background.paper', borderRadius: 1 }}>
      <CardContent sx={{ p: { xs: 2, md: 3 } }}>
        <Box>
          <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>
            ⏰ {titleText}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            {subtextDisplay}
          </Typography>

          <Box sx={{ mb: 2 }}>
            <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>
              ➕ {t('profile.yourShiftPreferences') === 'profile.yourShiftPreferences' ? 'Your shift preferences' : t('profile.yourShiftPreferences')}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {t('profile.addShiftPreferencesSubtext') === 'profile.addShiftPreferencesSubtext' ? 'Add additional shift preferences to qualify for more roles' : t('profile.addShiftPreferencesSubtext')}
            </Typography>

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

            {optionalShifts.length === 0 && (
              <Box sx={{ mb: 2, p: 2, bgcolor: 'grey.50', borderRadius: 1 }}>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                  ⏰ {t('profile.noShiftPreferencesYet') === 'profile.noShiftPreferencesYet' ? "You haven't added any additional shift preferences yet" : t('profile.noShiftPreferencesYet')}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {t('profile.addShiftToQualify') === 'profile.addShiftToQualify' ? 'Add shift preferences to qualify for more roles.' : t('profile.addShiftToQualify')}
                </Typography>
              </Box>
            )}

            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1, fontSize: '0.85rem' }}>
              {t('profile.availableShiftsTap') === 'profile.availableShiftsTap' ? 'Available shifts (tap to add):' : t('profile.availableShiftsTap')}
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
      </CardContent>
    </Card>
  );
};

export default ShiftPreferencesCard;

