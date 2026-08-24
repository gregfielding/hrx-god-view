/**
 * Experience hub — /c1/workers/profile/experience
 *
 * The ATS-flavored sections (resume, bio, work history, education) collapsed
 * behind one Profile row (worker-app redesign, Greg 2026-08-23): they matter
 * to recruiters, not to a worker's daily use, so they live one level down.
 * Each row routes to the existing profile section editors.
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Card,
  CardContent,
  Divider,
  List,
  ListItemButton,
  ListItemText,
  Stack,
  Typography,
} from '@mui/material';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { useT } from '../../../i18n';

const ROWS = [
  { key: 'resume', titleKey: 'profile.sectionResumeTitle' },
  { key: 'bio', titleKey: 'profile.sectionBioTitle' },
  { key: 'work-history', titleKey: 'profile.sectionWorkHistoryTitle' },
  { key: 'education', titleKey: 'profile.sectionEducationTitle' },
] as const;

const ProfileExperience: React.FC = () => {
  const navigate = useNavigate();
  const t = useT();
  return (
    <Box>
      <Stack spacing={3}>
        <Stack direction="row" spacing={1} alignItems="center">
          <ArrowBackIcon
            sx={{ cursor: 'pointer', color: 'text.secondary' }}
            onClick={() => navigate('/c1/workers/profile')}
          />
          <Typography variant="h5" component="h1">
            {t('profile.sectionExperienceTitle')}
          </Typography>
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mt: -2 }}>
          {t('profile.sectionExperienceDescription')}
        </Typography>
        <Card variant="outlined" sx={{ borderColor: 'divider' }}>
          <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
            <List disablePadding>
              {ROWS.map((row, i) => (
                <React.Fragment key={row.key}>
                  {i > 0 && <Divider component="li" />}
                  <ListItemButton onClick={() => navigate(`/c1/workers/profile/${row.key}`)}>
                    <ListItemText primary={t(row.titleKey)} />
                    <ChevronRightIcon color="action" />
                  </ListItemButton>
                </React.Fragment>
              ))}
            </List>
          </CardContent>
        </Card>
      </Stack>
    </Box>
  );
};

export default ProfileExperience;
