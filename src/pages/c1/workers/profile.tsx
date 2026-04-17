import React, { useEffect, useState } from 'react';
import {
  Avatar,
  Box,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Container,
  Divider,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Stack,
  Typography,
} from '@mui/material';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import WorkIcon from '@mui/icons-material/Work';
import VerifiedUserIcon from '@mui/icons-material/VerifiedUser';
import { doc, onSnapshot } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';

import { db } from '../../../firebase';
import { useAuth } from '../../../contexts/AuthContext';
import { useT } from '../../../i18n';
import { userDocHasStoredResume } from '../../../utils/workerProfilePrerequisites';
import { useWorkerMyEmploymentList } from '../../../hooks/useWorkerMyEmploymentList';
import { useWorkerI9SupportingDocumentsRows } from '../../../hooks/useWorkerI9SupportingDocumentsRows';
import { buildI9SupportingDocumentsEmploymentViewModel } from '../../../utils/i9SupportingDocumentsViewModel';
import { buildWorkerMyEmploymentListRowModel } from '../../../utils/workerMyEmploymentListRowModel';
import { filterI9RowsForEntityEmployment } from '../../../utils/workerEmploymentWorkerSurface';
import { C1_WORKER_SCREENING_PATH } from '../../../constants/c1WorkerRoutes';
import { resolveWorkerPreferences } from '../../../utils/workerPreferencesCanonical';

const WorkerProfile: React.FC = () => {
  const { user, avatarUrl, logout, tenantId: authTenantId, activeTenant } = useAuth();
  const tenantId = authTenantId || activeTenant?.id || null;
  const t = useT();
  const navigate = useNavigate();
  const uid = user?.uid;
  const [userDoc, setUserDoc] = useState<Record<string, unknown> | null>(null);

  const {
    loading: employmentLoading,
    records: employmentRecords,
    assignmentsByEntityKey,
    stepCounts: employmentStepCounts,
    i9EmployeeSectionVerifiedByPipelineId,
  } = useWorkerMyEmploymentList(tenantId, uid ?? null);

  const { rows: allI9Rows } = useWorkerI9SupportingDocumentsRows(tenantId, uid ?? null, Boolean(tenantId && uid));

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
  const resumeComplete = userDocHasStoredResume(userDoc);
  const bioComplete = Boolean(
    String(userDoc?.professionalBio || userDoc?.bio || '')
      .trim()
      .length > 0
  );
  const skillsList = Array.isArray(userDoc?.skills) ? userDoc.skills : [];
  const skillsComplete = skillsList.length >= 3;
  const certificationsComplete = Boolean(Array.isArray(userDoc?.certifications) && userDoc?.certifications.length > 0);
  const workExperienceComplete = Boolean(
    (Array.isArray(userDoc?.workExperience) && userDoc?.workExperience.length > 0) ||
      (Array.isArray(userDoc?.workHistory) && userDoc?.workHistory.length > 0)
  );
  const educationComplete = Boolean(Array.isArray(userDoc?.education) && userDoc?.education.length > 0);
  const languagesComplete = Boolean(Array.isArray(userDoc?.languages) && userDoc?.languages.length > 0);
  const preferences = ((userDoc?.workerProfile as Record<string, unknown> | undefined)?.preferences ||
    {}) as Record<string, unknown>;
  const resolvedPrefs = resolveWorkerPreferences(preferences);
  const availabilityPreferencesPresent = Boolean(
    resolvedPrefs.legacyTargetIndustriesSubset.length > 0 || resolvedPrefs.legacyScheduleIntentOptions.length > 0
  );
  const basicInfoSectionComplete = personalDetailsComplete && locationComplete;
  const workProfileSectionComplete =
    hasWorkAuth &&
    resumeComplete &&
    bioComplete &&
    certificationsComplete &&
    workExperienceComplete &&
    educationComplete &&
    languagesComplete &&
    skillsComplete;
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
          {t('nav.myAccount')}
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
                    ? t('profile.hubProfileComplete')
                    : t('profile.hubSectionsProgress', {
                        complete: completeSectionCount,
                        total: totalSections,
                      })}
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
            <Typography sx={{ px: 2, py: 1.5, fontWeight: 700 }}>{t('workerAccount.sectionProfile')}</Typography>
            <Divider />
            <List disablePadding>
              <ListItemButton onClick={() => navigate('/c1/workers/profile/personal-details')}>
                <ListItemText
                  primary={t('profile.sectionPersonalDetailsTitle')}
                  secondary={t('profile.sectionPersonalDetailsHubSecondary')}
                />
                <ChevronRightIcon color="action" />
              </ListItemButton>
            </List>
          </CardContent>
        </Card>

        <Card variant="outlined" sx={{ borderRadius: 2, borderColor: 'divider', boxShadow: 'none' }}>
          <CardContent sx={{ p: 0 }}>
            <Typography sx={{ px: 2, py: 1.5, fontWeight: 700 }}>{t('workerAccount.sectionWorkProfile')}</Typography>
            <Divider />
            <List disablePadding>
              <ListItemButton onClick={() => navigate('/c1/workers/profile/work-authorization')}>
                <ListItemText primary={t('profile.sectionWorkAuthorizationTitle')} />
                <Stack direction="row" spacing={0.5} alignItems="center">
                  {hasWorkAuth ? <CheckCircleIcon color="success" sx={{ fontSize: 18 }} /> : null}
                  <ChevronRightIcon color="action" />
                </Stack>
              </ListItemButton>
              <ListItemButton onClick={() => navigate('/c1/workers/profile/resume')}>
                <ListItemText primary={t('profile.sectionResumeTitle')} />
                <Stack direction="row" spacing={0.5} alignItems="center">
                  {resumeComplete ? <CheckCircleIcon color="success" sx={{ fontSize: 18 }} /> : null}
                  <ChevronRightIcon color="action" />
                </Stack>
              </ListItemButton>
              <ListItemButton onClick={() => navigate('/c1/workers/profile/bio')}>
                <ListItemText primary={t('profile.sectionBioTitle')} />
                <Stack direction="row" spacing={0.5} alignItems="center">
                  {bioComplete ? <CheckCircleIcon color="success" sx={{ fontSize: 18 }} /> : null}
                  <ChevronRightIcon color="action" />
                </Stack>
              </ListItemButton>
              <ListItemButton onClick={() => navigate('/c1/workers/profile/certifications')}>
                <ListItemText primary={t('profile.sectionCertificationsTitle')} />
                <Stack direction="row" spacing={0.5} alignItems="center">
                  {certificationsComplete ? <CheckCircleIcon color="success" sx={{ fontSize: 18 }} /> : null}
                  <ChevronRightIcon color="action" />
                </Stack>
              </ListItemButton>
              <ListItemButton onClick={() => navigate('/c1/workers/profile/work-history')}>
                <ListItemText primary={t('profile.sectionWorkHistoryTitle')} />
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
                <ListItemText primary={t('profile.sectionLanguagesTitle')} />
                <Stack direction="row" spacing={0.5} alignItems="center">
                  {languagesComplete ? <CheckCircleIcon color="success" sx={{ fontSize: 18 }} /> : null}
                  <ChevronRightIcon color="action" />
                </Stack>
              </ListItemButton>
              <ListItemButton onClick={() => navigate('/c1/workers/profile/skills')}>
                <ListItemText primary={t('profile.sectionSkillsTitle')} />
                <Stack direction="row" spacing={0.5} alignItems="center">
                  {skillsComplete ? <CheckCircleIcon color="success" sx={{ fontSize: 18 }} /> : null}
                  <ChevronRightIcon color="action" />
                </Stack>
              </ListItemButton>
              <ListItemButton onClick={() => navigate('/c1/workers/profile/preferences')}>
                <ListItemText primary={t('profile.sectionPreferencesTitle')} />
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
            <Typography sx={{ px: 2, py: 1.5, fontWeight: 700 }}>{t('workerAccount.sectionEmployment')}</Typography>
            <Divider />
            {!tenantId ? (
              <Box sx={{ px: 2, py: 2 }}>
                <Typography variant="body2" color="text.secondary">
                  {t('profile.hubEmploymentNeedTenant')}
                </Typography>
              </Box>
            ) : employmentLoading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
                <CircularProgress size={28} />
              </Box>
            ) : employmentRecords.length === 0 ? (
              <Box sx={{ px: 2, py: 2 }}>
                <Typography variant="body2" color="text.secondary">
                  {t('profile.hubEmploymentEmpty')}
                </Typography>
              </Box>
            ) : (
              <List disablePadding>
                {employmentRecords.map((rec) => {
                  const i9Scoped = filterI9RowsForEntityEmployment(
                    allI9Rows,
                    rec,
                    employmentRecords.length,
                  );
                  const i9Vm = buildI9SupportingDocumentsEmploymentViewModel(i9Scoped, {
                    i9SupportingManualComplete: Boolean(rec.i9SupportingDocumentsManualCompleteAt),
                    i9EmployeeSectionComplete: Boolean(
                      rec.onboardingPipelineId &&
                        i9EmployeeSectionVerifiedByPipelineId[rec.onboardingPipelineId],
                    ),
                  });
                  const row = buildWorkerMyEmploymentListRowModel(
                    rec,
                    employmentStepCounts,
                    assignmentsByEntityKey,
                    {
                      i9Substatus: i9Scoped.length ? i9Vm.substatus : null,
                      totalEmploymentRecords: employmentRecords.length,
                      i9EmployeeSectionComplete: Boolean(
                        rec.onboardingPipelineId &&
                          i9EmployeeSectionVerifiedByPipelineId[rec.onboardingPipelineId],
                      ),
                      tr: t,
                    },
                  );
                  return (
                    <ListItemButton
                      key={rec.id}
                      onClick={() =>
                        navigate(`/c1/workers/my-employment/${encodeURIComponent(rec.id)}`)
                      }
                      sx={{ alignItems: 'center', py: 1.25, gap: 1 }}
                    >
                      <ListItemIcon sx={{ minWidth: 40 }}>
                        <WorkIcon sx={{ color: 'text.secondary', fontSize: 22 }} />
                      </ListItemIcon>
                      <ListItemText
                        sx={{ my: 0, mr: 1, flex: 1, minWidth: 0 }}
                        primary={row.entityDisplayName}
                        secondary={row.nextStepLine || row.progressText || undefined}
                        primaryTypographyProps={{ fontWeight: 600, variant: 'body1', noWrap: true }}
                        secondaryTypographyProps={{ variant: 'caption', noWrap: true }}
                      />
                      <Stack direction="row" alignItems="center" spacing={0.75} flexShrink={0}>
                        {row.workerTypeLabel ? (
                          <Chip
                            label={row.workerTypeLabel}
                            size="small"
                            variant="outlined"
                            sx={{ fontWeight: 500 }}
                          />
                        ) : null}
                        <Chip
                          label={row.statusChipLabel}
                          size="small"
                          color={row.listChipColor}
                          variant={row.listHistoricalChip ? 'outlined' : 'filled'}
                        />
                        <ChevronRightIcon color="action" />
                      </Stack>
                    </ListItemButton>
                  );
                })}
              </List>
            )}
          </CardContent>
        </Card>

        {tenantId ? (
          <Card variant="outlined" sx={{ borderRadius: 2, borderColor: 'divider', boxShadow: 'none' }}>
            <CardContent sx={{ p: 0 }}>
              <Typography sx={{ px: 2, py: 1.5, fontWeight: 700 }}>
                {t('workerAccount.sectionPreEmploymentChecks')}
              </Typography>
              <Divider />
              <List disablePadding>
                <ListItemButton onClick={() => navigate(C1_WORKER_SCREENING_PATH)}>
                  <ListItemIcon sx={{ minWidth: 40 }}>
                    <VerifiedUserIcon sx={{ color: 'text.secondary', fontSize: 22 }} />
                  </ListItemIcon>
                  <ListItemText
                    primary={t('workerAccount.preEmploymentChecksPrimary')}
                    secondary={t('workerAccount.preEmploymentChecksSecondary')}
                  />
                  <ChevronRightIcon color="action" />
                </ListItemButton>
              </List>
            </CardContent>
          </Card>
        ) : null}

        <Card variant="outlined" sx={{ borderRadius: 2, borderColor: 'divider', boxShadow: 'none' }}>
          <CardContent sx={{ p: 0 }}>
            <Typography sx={{ px: 2, py: 1.5, fontWeight: 700 }}>{t('workerAccount.sectionAccountSettings')}</Typography>
            <Divider />
            <List disablePadding>
              <ListItemButton onClick={() => navigate('/c1/workers/profile/reset-password')}>
                <ListItemText
                  primary={t('profile.sectionResetPasswordTitle')}
                  secondary={t('profile.sectionResetPasswordDescription')}
                />
                <ChevronRightIcon color="action" />
              </ListItemButton>
              {/* Phone updates live under profile completion / verification flows; keep personal-details routable elsewhere if linked. */}
              {/* <ListItemButton onClick={() => navigate('/c1/workers/profile/personal-details')}>
                <ListItemText primary="Update phone number" secondary="Update your contact phone number." />
                <ChevronRightIcon color="action" />
              </ListItemButton> */}
              <ListItemButton onClick={() => navigate('/c1/workers/profile/app-language')}>
                <ListItemText
                  primary={t('profile.sectionAppLanguageTitle')}
                  secondary={t('profile.sectionAppLanguageDescription')}
                />
                <ChevronRightIcon color="action" />
              </ListItemButton>
              <ListItemButton onClick={() => void logout()}>
                <ListItemText primary={t('nav.logOut')} secondary={t('profile.logOutSecureSecondary')} />
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
