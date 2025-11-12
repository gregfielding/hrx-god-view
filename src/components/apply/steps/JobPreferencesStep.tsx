import React from 'react';
import { Box, Chip, Grid, TextField, Typography, Card, CardHeader, CardContent, Alert, Stack, useTheme, useMediaQuery } from '@mui/material';
import { doc, updateDoc, serverTimestamp, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../../../firebase';

type Props = {
  value: any;
  onChange: (v: any) => void;
  jobPosting?: any;
};

const baseShiftOptions = [
  'Full Time','Part Time','First Shift','Second Shift','Third Shift','Days','Nights','Swing','Some Weekends','Overtime','On Call','Flexible'
];

const industryOptions = [
  'Technology', 'Healthcare', 'Finance', 'Education', 'Manufacturing',
  'Retail', 'Construction', 'Transportation', 'Energy', 'Government',
  'Non-profit', 'Entertainment', 'Real Estate', 'Consulting', 'Marketing',
  'Hospitality', 'Telecommunications', 'Agriculture', 'Logistics',
  'Pharmaceuticals', 'Insurance'
];

const JobPreferencesStep: React.FC<Props> = ({ value, onChange, jobPosting }) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const handle = (field: string, v: any) => onChange({ ...value, [field]: v });

  // Debounced Firestore updater (avoid excessive writes)
  const debounceRef = React.useRef<any>(null);
  const debouncedUpdate = (data: any) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const uid = auth.currentUser?.uid;
        if (!uid) return;
        await updateDoc(doc(db, 'users', uid), { ...data, updatedAt: serverTimestamp() });
      } catch {}
    }, 400);
  };

  // Live-hydrate availability fields from Firestore
  const [availableToStartDate, setAvailableToStartDate] = React.useState<string>(value?.availableToStartDate || '');
  const [notes, setNotes] = React.useState<string>(value?.availabilityNotes || '');

  React.useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const ref = doc(db, 'users', uid);
    const unsub = onSnapshot(ref, (snap) => {
      const data = snap.data() as any;
      const dbDate = String(data?.availableToStartDate || '');
      const dbNotes = String((data?.preferences?.availabilityNotes ?? data?.availabilityNotes) || '');
      setAvailableToStartDate((prev) => (prev || '') === dbDate ? prev : dbDate);
      setNotes((prev) => (prev || '') === dbNotes ? prev : dbNotes);
      // sync wizard state so review/submit reflects latest
      onChange({ ...value, availableToStartDate: dbDate, availabilityNotes: dbNotes });
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      debouncedUpdate({ 'preferences.shiftPreferences': next });
      return next;
    });
  };

  const shiftHelper = (postingShifts && postingShifts.length)
    ? `Shift Requirements: ${postingShifts.join(', ')}`
    : undefined;

  // Industry preferences
  const [industryPrefs, setIndustryPrefs] = React.useState<string[]>(Array.isArray(value?.industryPreferences) ? value.industryPreferences : []);
  React.useEffect(() => {
    if (Array.isArray(value?.industryPreferences)) setIndustryPrefs(value.industryPreferences);
  }, [value?.industryPreferences]);
  const toggleIndustry = (name: string) => {
    setIndustryPrefs((prev) => {
      const exists = prev.includes(name);
      const next = exists ? prev.filter(s => s !== name) : [...prev, name];
      onChange({ ...value, industryPreferences: next });
      debouncedUpdate({ 'preferences.industryPreferences': next });
      return next;
    });
  };

  const Section = ({
    title,
    children,
    hidden,
    action
  }: {
    title: string;
    children: React.ReactNode;
    hidden?: boolean;
    action?: React.ReactNode;
  }) => {
    if (hidden) return null;
    if (isMobile) {
      return (
        <Box sx={{ mb: 2 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
            <Typography variant="h6" sx={{ fontSize: '1rem', fontWeight: 500 }}>
              {title}
            </Typography>
            {action}
          </Stack>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>{children}</Box>
        </Box>
      );
    }
    return (
      <Card variant="outlined" sx={{ mb: 3 }}>
        <CardHeader title={<Typography variant="h6">{title}</Typography>} action={action} />
        <CardContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>{children}</Box>
        </CardContent>
      </Card>
    );
  };

  return (
    <Box>
      {/* Availability to Start - Only show for Career jobs, not Gig jobs with specific dates */}
      <Section
        title="Availability to Start"
        hidden={jobPosting?.jobType === 'gig'}
      >
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
          <TextField
            label="Available to start"
            type="date"
            value={availableToStartDate || ''}
            onChange={(e) => {
              const v = e.target.value;
              setAvailableToStartDate(v);
              onChange({ ...value, availableToStartDate: v });
              debouncedUpdate({ availableToStartDate: v });
            }}
            onBlur={(e) => debouncedUpdate({ availableToStartDate: e.target.value })}
            InputLabelProps={{ shrink: true }}
            sx={{ width: { xs: '100%', md: 260 } }}
          />
          <TextField
            fullWidth
            label="Availability notes"
            value={notes}
            onChange={(e) => {
              const v = e.target.value;
              setNotes(v);
              onChange({ ...value, availabilityNotes: v });
              debouncedUpdate({ 'preferences.availabilityNotes': v });
            }}
            onBlur={(e) => debouncedUpdate({ 'preferences.availabilityNotes': e.target.value })}
            multiline
            minRows={2}
          />
        </Stack>
      </Section>
      
      {/* Shift Preferences card - Only show for Career jobs, not Gig jobs with specific shifts */}
      <Section title="Shift Preferences" hidden={jobPosting?.jobType === 'gig'}>
        {shiftHelper && (
          <Alert severity="info">{shiftHelper}</Alert>
        )}

        <Grid container spacing={2}>
          <Grid item xs={12} md={8}>
            <Typography variant="subtitle2" gutterBottom>Selected shifts</Typography>
            <Box display="flex" flexWrap="wrap" gap={1}>
              {selectedShifts.map((name) => (
                <Chip key={name} label={name} onDelete={() => toggleShift(name)} color="primary" />
              ))}
              {selectedShifts.length === 0 && (
                <Typography variant="body2" color="text.secondary">No shifts selected</Typography>
              )}
            </Box>
          </Grid>
          <Grid item xs={12} md={4}>
            <Typography variant="subtitle2" gutterBottom>Available shifts (tap to add)</Typography>
            <Box display="flex" flexWrap="wrap" gap={1}>
              {allShiftOptions.map((name) => (
                <Chip
                  key={name}
                  label={name}
                  onClick={() => toggleShift(name)}
                  variant="outlined"
                  sx={{
                    cursor: 'pointer',
                    opacity: selectedShifts.includes(name) ? 0.5 : 1,
                  }}
                />
              ))}
            </Box>
          </Grid>
        </Grid>
      </Section>

      {/* Industry Preferences card */}
      <Section title="Industry Preferences (optional)">
        <Grid container spacing={2}>
          <Grid item xs={12} md={8}>
            <Typography variant="subtitle2" gutterBottom>Selected industries</Typography>
            <Box display="flex" flexWrap="wrap" gap={1}>
              {industryPrefs.map((name) => (
                <Chip key={name} label={name} onDelete={() => toggleIndustry(name)} color="primary" />
              ))}
              {industryPrefs.length === 0 && (
                <Typography variant="body2" color="text.secondary">No industries selected</Typography>
              )}
            </Box>
          </Grid>
          <Grid item xs={12} md={4}>
            <Typography variant="subtitle2" gutterBottom>Available industries (tap to add)</Typography>
            <Box display="flex" flexWrap="wrap" gap={1}>
              {industryOptions.map((name) => (
                <Chip
                  key={name}
                  label={name}
                  onClick={() => toggleIndustry(name)}
                  variant="outlined"
                  sx={{ cursor: 'pointer', opacity: industryPrefs.includes(name) ? 0.5 : 1 }}
                />
              ))}
            </Box>
          </Grid>
        </Grid>
      </Section>

      {/* Pay preferences removed per request */}
    </Box>
  );
};

export default JobPreferencesStep;


