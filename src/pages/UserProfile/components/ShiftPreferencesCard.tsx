import React, { useState, useEffect } from 'react';
import { Box, Chip, Typography, Stack, Card, CardContent } from '@mui/material';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../../firebase';
import { queueProfileUpdate } from '../../../utils/userProfileBatching';

type Props = {
  uid: string;
};

const baseShiftOptions = [
  'Full Time', 'Part Time', 'First Shift', 'Second Shift', 'Third Shift', 
  'Days', 'Nights', 'Swing', 'Some Weekends', 'Overtime', 'On Call', 'Flexible'
];

const ShiftPreferencesCard: React.FC<Props> = ({ uid }) => {
  const [selectedShifts, setSelectedShifts] = useState<string[]>([]);

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

  const optionalShifts = selectedShifts;
  const allShiftOptions = baseShiftOptions;

  return (
    <Card variant="outlined" sx={{ bgcolor: 'background.paper', borderRadius: 1 }}>
      <CardContent sx={{ p: { xs: 2, md: 3 } }}>
        <Box>
          <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>
            ⏰ Shift Preferences
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            Select your preferred work schedules
          </Typography>

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
      </CardContent>
    </Card>
  );
};

export default ShiftPreferencesCard;

