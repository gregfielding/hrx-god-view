import React, { useEffect, useState } from 'react';
import {
  Avatar,
  Box,
  Card,
  CardContent,
  Container,
  Divider,
  List,
  ListItemButton,
  ListItemText,
  Stack,
  Typography,
} from '@mui/material';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { doc, onSnapshot } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';

import { db } from '../../../firebase';
import { useAuth } from '../../../contexts/AuthContext';
import { useT } from '../../../i18n';

const WorkerProfile: React.FC = () => {
  const { user, avatarUrl, logout } = useAuth();
  const t = useT();
  const navigate = useNavigate();
  const uid = user?.uid;
  const [userDoc, setUserDoc] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    if (!uid) return;
    const userRef = doc(db, 'users', uid);
    const unsubscribe = onSnapshot(userRef, (snap) => {
      setUserDoc(snap.exists() ? (snap.data() as Record<string, unknown>) : null);
    });
    return () => unsubscribe();
  }, [uid]);

  const resolvedProfilePhoto = String(
    (userDoc?.workerProfile as Record<string, unknown> | undefined)?.photoUrl ||
      userDoc?.avatar ||
      avatarUrl ||
      ''
  ).trim();
  const fullName = String(
    `${String(userDoc?.firstName || '').trim()} ${String(userDoc?.lastName || '').trim()}`
  ).trim() || t('profile.yourProfile');
  const city = String(
    (userDoc?.addressInfo as Record<string, unknown> | undefined)?.city ||
      userDoc?.city ||
      ''
  ).trim();
  const state = String(
    (userDoc?.addressInfo as Record<string, unknown> | undefined)?.state ||
      userDoc?.state ||
      ''
  ).trim();
  const locationLabel = city && state ? `${city}, ${state}` : city || state || t('profile.addLocation');

  const personalDetailsComplete = Boolean(
    String(userDoc?.firstName || '').trim() &&
      String(userDoc?.lastName || '').trim() &&
      String(userDoc?.email || '').trim() &&
      String(userDoc?.phone || userDoc?.phoneE164 || '').trim()
  );
  const locationComplete = Boolean(city && state);
  const workEligibilityAttestation = (userDoc?.workEligibilityAttestation || {}) as Record<string, unknown>;
  const hasWorkAuth = Boolean(
    (typeof workEligibilityAttestation.authorizedToWorkUS === 'boolean' ||
      typeof userDoc?.workEligibility === 'boolean') &&
      (typeof workEligibilityAttestation.requireSponsorship === 'boolean' ||
        typeof userDoc?.requireSponsorship === 'boolean')
  );
  const resumeObj = (userDoc?.resume || {}) as Record<string, unknown>;
  const resumeComplete = Boolean(
    resumeObj.downloadUrl || resumeObj.fileName || resumeObj.storagePath || userDoc?.resumeStoragePath || userDoc?.resumeUrl
  );
  const certificationsComplete = Boolean(Array.isArray(userDoc?.certifications) && userDoc?.certifications.length > 0);
  const workExperienceComplete = Boolean(
    (Array.isArray(userDoc?.workExperience) && userDoc?.workExperience.length > 0) ||
      (Array.isArray(userDoc?.workHistory) && userDoc?.workHistory.length > 0)
  );
  const educationComplete = Boolean(Array.isArray(userDoc?.education) && userDoc?.education.length > 0);
  const languagesComplete = Boolean(Array.isArray(userDoc?.languages) && userDoc?.languages.length > 0);
  const preferences = ((userDoc?.workerProfile as Record<string, unknown> | undefined)?.preferences ||
    {}) as Record<string, unknown>;
  const availabilityPreferencesPresent = Boolean(
    (Array.isArray(preferences.targetIndustries) && preferences.targetIndustries.length > 0) ||
      (Array.isArray(preferences.scheduleIntentOptions) && preferences.scheduleIntentOptions.length > 0)
  );
  const basicInfoSectionComplete = personalDetailsComplete && locationComplete;
  const workProfileSectionComplete =
    hasWorkAuth &&
    resumeComplete &&
    certificationsComplete &&
    workExperienceComplete &&
    educationComplete &&
    languagesComplete;
  const accountSectionComplete = Boolean(String(userDoc?.email || '').trim());
  const totalSections = 3;
  const completeSectionCount = [
    basicInfoSectionComplete,
    workProfileSectionComplete,
    accountSectionComplete,
  ].filter(Boolean).length;
  const isProfileComplete = completeSectionCount >= totalSections;
  const completionPercent = Math.round((completeSectionCount / totalSections) * 100);

  if (!uid) {
    return (
      <Container maxWidth="md" sx={{ py: 2 }}>
        <Typography variant="body2" color="text.secondary">
          {t('profile.signInToComplete')}
        </Typography>
      </Container>
    );
  }

  return (
    <Container maxWidth="md" sx={{ py: 2 }}>
      <Stack spacing={2}>
        <Typography variant="h4" component="h1" sx={{ fontWeight: 600 }}>
          {t('nav.myProfile')}
        </Typography>

        <Card variant="outlined" sx={{ borderRadius: 2, borderColor: 'divider', boxShadow: 'none' }}>
          <CardContent>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ xs: 'flex-start', sm: 'center' }}>
              <Avatar src={resolvedProfilePhoto || undefined} sx={{ width: 64, height: 64 }} />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="h6" sx={{ fontWeight: 700 }}>
                  {fullName}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {locationLabel}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
                  {isProfileComplete
                    ? 'Profile complete'
                    : `${completeSectionCount} of ${totalSections} sections complete`}
                </Typography>
              </Box>
              <Typography variant="caption" color="text.secondary">
                {`${completionPercent}%`}
              </Typography>
            </Stack>
          </CardContent>
        </Card>

        <Card variant="outlined" sx={{ borderRadius: 2, borderColor: 'divider', boxShadow: 'none' }}>
          <CardContent sx={{ p: 0 }}>
            <Typography sx={{ px: 2, py: 1.5, fontWeight: 700 }}>Basic Info</Typography>
            <Divider />
            <List disablePadding>
              <ListItemButton onClick={() => navigate('/c1/workers/profile/personal-details')}>
                <ListItemText primary="Personal details" secondary="Update your name, email, and phone." />
                <ChevronRightIcon color="action" />
              </ListItemButton>
              <ListItemButton onClick={() => navigate('/c1/workers/profile/location')}>
                <ListItemText primary="City and state" secondary="Keep your location updated for stronger opportunities." />
                <ChevronRightIcon color="action" />
              </ListItemButton>
            </List>
          </CardContent>
        </Card>

        <Card variant="outlined" sx={{ borderRadius: 2, borderColor: 'divider', boxShadow: 'none' }}>
          <CardContent sx={{ p: 0 }}>
            <Typography sx={{ px: 2, py: 1.5, fontWeight: 700 }}>Work Profile</Typography>
            <Divider />
            <List disablePadding>
              <ListItemButton onClick={() => navigate('/c1/workers/profile/work-authorization')}>
                <ListItemText primary="Work authorization" />
                <Stack direction="row" spacing={0.5} alignItems="center">
                  {hasWorkAuth ? <CheckCircleIcon color="success" sx={{ fontSize: 18 }} /> : null}
                  <ChevronRightIcon color="action" />
                </Stack>
              </ListItemButton>
              <ListItemButton onClick={() => navigate('/c1/workers/profile/resume')}>
                <ListItemText primary="Resume" />
                <Stack direction="row" spacing={0.5} alignItems="center">
                  {resumeComplete ? <CheckCircleIcon color="success" sx={{ fontSize: 18 }} /> : null}
                  <ChevronRightIcon color="action" />
                </Stack>
              </ListItemButton>
              <ListItemButton onClick={() => navigate('/c1/workers/profile/certifications')}>
                <ListItemText primary="Certifications & Licenses" />
                <Stack direction="row" spacing={0.5} alignItems="center">
                  {certificationsComplete ? <CheckCircleIcon color="success" sx={{ fontSize: 18 }} /> : null}
                  <ChevronRightIcon color="action" />
                </Stack>
              </ListItemButton>
              <ListItemButton onClick={() => navigate('/c1/workers/profile/work-history')}>
                <ListItemText primary="Work experience" />
                <Stack direction="row" spacing={0.5} alignItems="center">
                  {workExperienceComplete ? <CheckCircleIcon color="success" sx={{ fontSize: 18 }} /> : null}
                  <ChevronRightIcon color="action" />
                </Stack>
              </ListItemButton>
              <ListItemButton onClick={() => navigate('/c1/workers/profile/education')}>
                <ListItemText primary="Education" />
                <Stack direction="row" spacing={0.5} alignItems="center">
                  {educationComplete ? <CheckCircleIcon color="success" sx={{ fontSize: 18 }} /> : null}
                  <ChevronRightIcon color="action" />
                </Stack>
              </ListItemButton>
              <ListItemButton onClick={() => navigate('/c1/workers/profile/languages')}>
                <ListItemText primary="Languages" />
                <Stack direction="row" spacing={0.5} alignItems="center">
                  {languagesComplete ? <CheckCircleIcon color="success" sx={{ fontSize: 18 }} /> : null}
                  <ChevronRightIcon color="action" />
                </Stack>
              </ListItemButton>
              <ListItemButton onClick={() => navigate('/c1/workers/profile/preferences')}>
                <ListItemText primary="Availability and preferences" />
                <Stack direction="row" spacing={0.5} alignItems="center">
                  {availabilityPreferencesPresent ? <CheckCircleIcon color="success" sx={{ fontSize: 18 }} /> : null}
                  <ChevronRightIcon color="action" />
                </Stack>
              </ListItemButton>
            </List>
          </CardContent>
        </Card>

        <Card variant="outlined" sx={{ borderRadius: 2, borderColor: 'divider', boxShadow: 'none' }}>
          <CardContent sx={{ p: 0 }}>
            <Typography sx={{ px: 2, py: 1.5, fontWeight: 700 }}>Employment</Typography>
            <Divider />
            <List disablePadding>
              <ListItemButton onClick={() => navigate('/c1/workers/my-employment')}>
                <ListItemText primary="My Employment" secondary="View your status with each C1 entity." />
                <ChevronRightIcon color="action" />
              </ListItemButton>
            </List>
          </CardContent>
        </Card>

        <Card variant="outlined" sx={{ borderRadius: 2, borderColor: 'divider', boxShadow: 'none' }}>
          <CardContent sx={{ p: 0 }}>
            <Typography sx={{ px: 2, py: 1.5, fontWeight: 700 }}>Account</Typography>
            <Divider />
            <List disablePadding>
              <ListItemButton onClick={() => navigate('/c1/workers/profile/reset-password')}>
                <ListItemText primary="Reset password" secondary="Update your sign-in password." />
                <ChevronRightIcon color="action" />
              </ListItemButton>
              <ListItemButton onClick={() => navigate('/c1/workers/profile/personal-details')}>
                <ListItemText primary="Update phone number" secondary="Update your contact phone number." />
                <ChevronRightIcon color="action" />
              </ListItemButton>
              <ListItemButton onClick={() => navigate('/c1/workers/profile/app-language')}>
                <ListItemText primary="App language" secondary="Manage app language preferences." />
                <ChevronRightIcon color="action" />
              </ListItemButton>
              <ListItemButton onClick={() => void logout()}>
                <ListItemText primary="Log out" secondary="Sign out of this device securely." />
                <ChevronRightIcon color="action" />
              </ListItemButton>
            </List>
          </CardContent>
        </Card>
      </Stack>
    </Container>
  );
};

export default WorkerProfile;
