import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  TextField,
  Stack,
  Chip,
  useTheme,
  useMediaQuery,
  Alert
} from '@mui/material';
import { queueProfileUpdate } from '../../../utils/userProfileBatching';
import { useT } from '../../../i18n';

type Props = {
  value: any;
  onChange: (v: any) => void;
  jobPosting?: any;
};

const sampleBios = [
  "I love working in busy kitchens and I'm always the first to jump in and help.",
  "I've been cooking for my family since I was 12 — now I'm turning that passion into my career.",
  "I'm dependable, I work hard, and I'm looking for a place where I can grow."
];

const BioStep: React.FC<Props> = ({ value, onChange, jobPosting }) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const t = useT();
  const [bio, setBio] = useState<string>(value?.professionalBio || value?.bio || '');

  // queueProfileUpdate is imported at top

  // Only hydrate from initial value, don't use onSnapshot (prevents feedback loops)
  useEffect(() => {
    const initialBio = value?.professionalBio || value?.bio || '';
    if (initialBio && !bio) {
      setBio(initialBio);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleBioChange = (newBio: string) => {
    // Only update local state on change, don't save yet
    setBio(newBio);
    onChange({ ...value, professionalBio: newBio });
  };

  const handleBioBlur = (newBio: string) => {
    // Save to Firestore only on blur
    queueProfileUpdate('professionalBio', newBio);
  };

  const handleSampleClick = (sample: string) => {
    setBio(sample);
    onChange({ ...value, professionalBio: sample });
    // Save immediately when clicking a sample
    queueProfileUpdate('professionalBio', sample);
  };

  return (
    <Box>
      <Box sx={{ mb: 2.5 }}>
        <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>
          ✍️ {t('profile.tellUsAboutYourself')}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          {t('profile.bioOptional')}
        </Typography>

        <Alert 
          severity="info" 
          sx={{ 
            mb: 2,
            bgcolor: 'info.50',
            '& .MuiAlert-message': {
              display: 'flex',
              alignItems: 'center',
              gap: 1
            }
          }}
        >
          💡 Candidates with bios get contacted 3× more often.
        </Alert>

        <TextField
          fullWidth
          multiline
          minRows={4}
          maxRows={8}
          value={bio}
          onChange={(e) => handleBioChange(e.target.value)}
          onBlur={(e) => handleBioBlur(e.target.value)}
          placeholder="In 1–3 sentences, tell us something about yourself — your personality, goals, or what you're proud of. (This helps hiring managers remember you.)"
          sx={{ mb: 2 }}
        />

        <Typography variant="body2" color="text.secondary" sx={{ mb: 1, fontStyle: 'italic' }}>
          This isn't a test. Just share something real.
        </Typography>

        <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1, fontSize: '0.85rem' }}>
          Need inspiration? Try one of these:
        </Typography>
        <Stack direction="row" flexWrap="wrap" gap={1} sx={{ mb: 2 }}>
          {sampleBios.map((sample, idx) => (
            <Chip
              key={idx}
              label={sample}
              onClick={() => handleSampleClick(sample)}
              variant="outlined"
              sx={{
                cursor: 'pointer',
                maxWidth: '100%',
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

        {!bio && (
          <Box sx={{ mt: 2, p: 2, bgcolor: 'grey.50', borderRadius: 1 }}>
            <Typography variant="body2" color="text.secondary">
              ⏰ You haven't added a bio yet. Adding one helps you stand out to hiring managers.
            </Typography>
          </Box>
        )}
      </Box>
    </Box>
  );
};

export default BioStep;

