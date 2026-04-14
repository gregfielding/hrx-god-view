import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Container,
  FormControl,
  MenuItem,
  Select,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import VisibilityIcon from '@mui/icons-material/Visibility';
import { doc, onSnapshot, serverTimestamp, updateDoc } from 'firebase/firestore';
import { sendPasswordResetEmail } from 'firebase/auth';
import { Navigate, useNavigate, useParams } from 'react-router-dom';

import { db, auth } from '../../../firebase';
import { useAuth } from '../../../contexts/AuthContext';
import { setLanguage, useT } from '../../../i18n';
import WorkerBasicIdentityCard from '../../../components/worker/profile/WorkerBasicIdentityCard';
import WorkEligibilityStep from '../../../components/apply/steps/WorkEligibilityStep';
import { deriveWorkEligibilityFromAttestation } from '../../../types/workEligibility';
import ResumeUpload from '../../../components/ResumeUpload';
import BioStep from '../../../components/apply/steps/BioStep';
import EducationStep from '../../../components/apply/steps/EducationStep';
import WorkExperienceStep from '../../../components/apply/steps/WorkExperienceStep';
import WorkerSkillsEditor from '../../../components/worker/profile/WorkerSkillsEditor';
import { buildReadinessIntentWritePatch } from '../../../utils/workerReadinessWriteModel';
import { openUserResumeInNewTab, pickResumeFromUserDoc } from '../../../utils/userResumeOpen';

type SectionKey =
  | 'personal-details'
  | 'work-authorization'
  | 'preferences'
  | 'resume'
  | 'bio'
  | 'skills'
  | 'certifications'
  | 'work-history'
  | 'education'
  | 'languages'
  | 'app-language'
  | 'reset-password';

type TargetIndustry = 'hospitality' | 'industrial';
type ScheduleIntentOption = 'full_time' | 'part_time' | 'gig';

const ALL_SCHEDULE_OPTIONS: ScheduleIntentOption[] = ['full_time', 'part_time', 'gig'];
const LANGUAGE_OPTIONS = [
  'English',
  'Spanish',
  'Polish',
  'Chinese',
  'Hindi',
  'Arabic',
  'Bengali',
  'Portuguese',
  'Russian',
  'Japanese',
  'Punjabi',
  'German',
  'French',
];

function normalizeLanguage(value: unknown): string {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ');
}

const SECTION_META: Record<SectionKey, { titleKey: string; descriptionKey: string }> = {
  'personal-details': {
    titleKey: 'profile.sectionPersonalDetailsTitle',
    descriptionKey: 'profile.sectionPersonalDetailsDescription',
  },
  'work-authorization': {
    titleKey: 'profile.sectionWorkAuthorizationTitle',
    descriptionKey: 'profile.sectionWorkAuthorizationDescription',
  },
  preferences: {
    titleKey: 'profile.sectionPreferencesTitle',
    descriptionKey: 'profile.sectionPreferencesDescription',
  },
  resume: {
    titleKey: 'profile.sectionResumeTitle',
    descriptionKey: 'profile.sectionResumeDescription',
  },
  bio: {
    titleKey: 'profile.sectionBioTitle',
    descriptionKey: 'profile.sectionBioDescription',
  },
  skills: {
    titleKey: 'profile.sectionSkillsTitle',
    descriptionKey: 'profile.sectionSkillsDescription',
  },
  certifications: {
    titleKey: 'profile.sectionCertificationsTitle',
    descriptionKey: 'profile.sectionCertificationsDescription',
  },
  'work-history': {
    titleKey: 'profile.sectionWorkHistoryTitle',
    descriptionKey: 'profile.sectionWorkHistoryDescription',
  },
  education: {
    titleKey: 'profile.sectionEducationTitle',
    descriptionKey: 'profile.sectionEducationDescription',
  },
  languages: {
    titleKey: 'profile.sectionLanguagesTitle',
    descriptionKey: 'profile.sectionLanguagesDescription',
  },
  'app-language': {
    titleKey: 'profile.sectionAppLanguageTitle',
    descriptionKey: 'profile.sectionAppLanguageDescription',
  },
  'reset-password': {
    titleKey: 'profile.sectionResetPasswordTitle',
    descriptionKey: 'profile.sectionResetPasswordDescription',
  },
};

const WorkerProfileSection: React.FC = () => {
  const { section } = useParams<{ section?: string }>();
  const navigate = useNavigate();
  const { user, avatarUrl, setAvatarUrl, logout } = useAuth();
  const t = useT();
  const uid = user?.uid;
  const normalizedSection = section === 'settings' ? 'app-language' : section;
  const activeSection = (normalizedSection || 'personal-details') as SectionKey;

  const [userDoc, setUserDoc] = useState<Record<string, unknown> | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [selectedLanguages, setSelectedLanguages] = useState<string[]>([]);
  const [industryPrefs, setIndustryPrefs] = useState<TargetIndustry[]>([]);
  const [schedulePrefs, setSchedulePrefs] = useState<ScheduleIntentOption[]>([]);
  const [preferredLanguage, setPreferredLanguageState] = useState<'en' | 'es'>('en');
  const [notificationSettings, setNotificationSettings] = useState({
    emailNotifications: true,
    pushNotifications: true,
    smsNotifications: false,
    marketingEmails: false,
  });

  useEffect(() => {
    if (!uid) return;
    const userRef = doc(db, 'users', uid);
    const unsubscribe = onSnapshot(userRef, (snap) => {
      if (!snap.exists()) {
        setUserDoc(null);
        return;
      }
      const data = snap.data() as Record<string, unknown>;
      setUserDoc(data);
      const prefs = ((data.workerProfile || {}) as Record<string, unknown>).preferences as Record<string, unknown> | undefined;
      const industries = Array.isArray(prefs?.targetIndustries)
        ? prefs?.targetIndustries.map((v) => String(v || '').toLowerCase()).filter((v): v is TargetIndustry => v === 'hospitality' || v === 'industrial')
        : [];
      const schedule = Array.isArray(prefs?.scheduleIntentOptions)
        ? prefs?.scheduleIntentOptions.map((v) => String(v || '').toLowerCase()).filter((v): v is ScheduleIntentOption => v === 'full_time' || v === 'part_time' || v === 'gig')
        : [];
      setIndustryPrefs(Array.from(new Set(industries)));
      setSchedulePrefs(Array.from(new Set(schedule)));

      const lang = data.preferredLanguage;
      if (lang === 'en' || lang === 'es') setPreferredLanguageState(lang);
      const existingLanguages = Array.isArray(data.languages)
        ? data.languages.map(normalizeLanguage).filter(Boolean)
        : [];
      const dedupedLanguages = Array.from(
        new Map(existingLanguages.map((v) => [v.toLowerCase(), v])).values()
      );
      setSelectedLanguages(dedupedLanguages);

      const savedNotificationSettings = (data.notificationSettings || {}) as Record<string, unknown>;
      const smsEnabled = data.smsOptIn !== false && data.smsBlockedSystem !== true;
      setNotificationSettings({
        emailNotifications:
          typeof savedNotificationSettings.emailNotifications === 'boolean'
            ? savedNotificationSettings.emailNotifications
            : true,
        pushNotifications:
          typeof savedNotificationSettings.pushNotifications === 'boolean'
            ? savedNotificationSettings.pushNotifications
            : true,
        smsNotifications: smsEnabled,
        marketingEmails:
          typeof savedNotificationSettings.marketingEmails === 'boolean'
            ? savedNotificationSettings.marketingEmails
            : false,
      });
    });
    return () => unsubscribe();
  }, [uid]);

  const sectionMeta = SECTION_META[activeSection];

  const resumeOnFile = useMemo(
    () => (activeSection === 'resume' ? pickResumeFromUserDoc(userDoc) : null),
    [activeSection, userDoc]
  );

  const skillsCount = useMemo(() => {
    const s = userDoc?.skills;
    if (!Array.isArray(s)) return 0;
    return s.length;
  }, [userDoc?.skills]);

  const workEligibilityValue = useMemo(() => {
    const a = userDoc?.workEligibilityAttestation as Record<string, unknown> | undefined;
    if (a && typeof a === 'object') {
      return {
        workAuthorized: a.authorizedToWorkUS === true,
        requireSponsorship: !!a.requireSponsorship,
        gender: String(a.gender || ''),
        veteranStatus: String(a.veteranStatus || ''),
        disabilityStatus: String(a.disabilityStatus || ''),
      };
    }
    return {
      workAuthorized: !!userDoc?.workEligibility,
      requireSponsorship: !!userDoc?.requireSponsorship,
      gender: String(userDoc?.gender || ''),
      veteranStatus: String(userDoc?.veteranStatus || ''),
      disabilityStatus: String(userDoc?.disabilityStatus || ''),
    };
  }, [userDoc]);
  const [workEligibilityLocal, setWorkEligibilityLocal] = useState(workEligibilityValue);
  useEffect(() => setWorkEligibilityLocal(workEligibilityValue), [workEligibilityValue]);

  const persistWorkEligibility = useCallback(
    async (value: typeof workEligibilityValue) => {
      if (!uid) return;
      const attestation = {
        authorizedToWorkUS: !!value.workAuthorized,
        requireSponsorship: !!value.requireSponsorship,
        attestedAt: serverTimestamp(),
        gender: value.gender || null,
        veteranStatus: value.veteranStatus || null,
        disabilityStatus: value.disabilityStatus || null,
      };
      const workEligibility = deriveWorkEligibilityFromAttestation(attestation as never);
      await updateDoc(doc(db, 'users', uid), {
        workEligibilityAttestation: attestation,
        workEligibility,
        requireSponsorship: !!value.requireSponsorship,
        gender: value.gender || null,
        veteranStatus: value.veteranStatus || null,
        disabilityStatus: value.disabilityStatus || null,
        updatedAt: serverTimestamp(),
      });
    },
    [uid]
  );

  const saveLanguages = async (languagesToSave = selectedLanguages) => {
    if (!uid) return;
    setSaveError(null);
    setSaveMessage(null);
    try {
      const deduped = Array.from(
        new Map(
          languagesToSave
            .map(normalizeLanguage)
            .filter(Boolean)
            .map((v) => [v.toLowerCase(), v])
        ).values()
      );
      await updateDoc(doc(db, 'users', uid), {
        languages: deduped,
        updatedAt: serverTimestamp(),
      });
      setSaveMessage(t('profile.languagesSaved'));
    } catch {
      setSaveError(t('profile.unableToSaveLanguages'));
    }
  };

  const toggleLanguage = async (language: string) => {
    const normalized = normalizeLanguage(language);
    const exists = selectedLanguages.some((v) => v.toLowerCase() === normalized.toLowerCase());
    const next = exists
      ? selectedLanguages.filter((v) => v.toLowerCase() !== normalized.toLowerCase())
      : [...selectedLanguages, normalized];
    setSelectedLanguages(next);
    await saveLanguages(next);
  };

  const persistPreferences = async (nextIndustries: TargetIndustry[], nextSchedule: ScheduleIntentOption[]) => {
    if (!uid) return;
    const desiredWorkType = nextSchedule.length === 1 ? nextSchedule[0] : 'any';
    await updateDoc(doc(db, 'users', uid), buildReadinessIntentWritePatch(desiredWorkType, nextIndustries, nextSchedule));
  };

  const toggleIndustry = async (industry: TargetIndustry) => {
    const next = industryPrefs.includes(industry)
      ? industryPrefs.filter((i) => i !== industry)
      : [...industryPrefs, industry];
    const normalized = Array.from(new Set(next));
    setIndustryPrefs(normalized);
    await persistPreferences(normalized, schedulePrefs);
  };

  const toggleSchedule = async (option: ScheduleIntentOption) => {
    const next = schedulePrefs.includes(option)
      ? schedulePrefs.filter((s) => s !== option)
      : Array.from(new Set([...schedulePrefs, option]));
    setSchedulePrefs(next);
    await persistPreferences(industryPrefs, next);
  };

  const handlePasswordReset = async () => {
    const email = String(userDoc?.email || user?.email || '').trim();
    if (!email) {
      setSaveError(t('profile.noEmailFound'));
      return;
    }
    setSaveError(null);
    setSaveMessage(null);
    try {
      await sendPasswordResetEmail(auth, email);
      setSaveMessage(t('profile.passwordResetEmailSent', { email }));
    } catch {
      setSaveError(t('profile.unableToSendPasswordReset'));
    }
  };

  const updateAccountSettings = async (next: {
    preferredLanguage?: 'en' | 'es';
    notificationSettings?: {
      emailNotifications: boolean;
      pushNotifications: boolean;
      smsNotifications: boolean;
      marketingEmails: boolean;
    };
  }) => {
    if (!uid) return;
    const current = next.notificationSettings || notificationSettings;
    const payload: Record<string, unknown> = {
      updatedAt: serverTimestamp(),
      notificationSettings: current,
    };
    if (typeof next.preferredLanguage === 'string') {
      payload.preferredLanguage = next.preferredLanguage;
    }
    payload.smsOptIn = current.smsNotifications;
    if (current.smsNotifications) payload.smsBlockedSystem = false;
    await updateDoc(doc(db, 'users', uid), payload);
  };

  const handlePreferredLanguageChange = async (lang: 'en' | 'es') => {
    setPreferredLanguageState(lang);
    setLanguage(lang);
    try {
      await updateAccountSettings({ preferredLanguage: lang });
      setSaveMessage(t('profile.accountSettingsSaved'));
      setSaveError(null);
    } catch {
      setSaveError(t('profile.unableToSavePreferredLanguage'));
    }
  };

  const toggleNotificationSetting = async (
    field: 'emailNotifications' | 'pushNotifications' | 'smsNotifications' | 'marketingEmails'
  ) => {
    const next = { ...notificationSettings, [field]: !notificationSettings[field] };
    setNotificationSettings(next);
    try {
      await updateAccountSettings({ notificationSettings: next });
      setSaveMessage(t('profile.accountSettingsSaved'));
      setSaveError(null);
    } catch {
      setSaveError(t('profile.unableToSaveNotificationPreference'));
    }
  };

  if (normalizedSection === 'location') {
    return <Navigate to="/c1/workers/profile/personal-details" replace />;
  }

  if (!uid) {
    return (
      <Container maxWidth="md" sx={{ py: 2 }}>
        <Typography variant="body2" color="text.secondary">
          {t('profile.signInToComplete')}
        </Typography>
      </Container>
    );
  }

  if (!SECTION_META[activeSection]) {
    return (
      <Container maxWidth="md" sx={{ py: 2 }}>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/c1/workers/profile')} sx={{ mb: 2 }}>
          {t('profile.backToProfile')}
        </Button>
        <Alert severity="warning">{t('profile.sectionUnavailable')}</Alert>
      </Container>
    );
  }

  return (
    <Container maxWidth="md" sx={{ py: 2 }}>
      <Stack spacing={2}>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/c1/workers/profile')} sx={{ alignSelf: 'flex-start' }}>
          {t('profile.backToProfile')}
        </Button>

        <Card variant="outlined" sx={{ borderRadius: 2, borderColor: 'divider', boxShadow: 'none' }}>
          <CardContent>
            <Typography variant="h5" sx={{ fontWeight: 700 }}>
              {t(sectionMeta.titleKey)}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {activeSection === 'skills' ? t('profile.workerSkillsPageHelper') : t(sectionMeta.descriptionKey)}
            </Typography>
            {activeSection === 'skills' ? (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                {skillsCount === 0
                  ? t('profile.skillsSummaryNone')
                  : skillsCount === 1
                    ? t('profile.skillsSummaryOne')
                    : t('profile.skillsSummaryMany', { count: skillsCount })}
              </Typography>
            ) : null}
            {activeSection === 'resume' && resumeOnFile ? (
              <Stack spacing={1} sx={{ mt: 1.5 }}>
                <Typography variant="body2" color="text.secondary">
                  {t('profile.resumeCurrentLabel')} <strong>{resumeOnFile.fileName}</strong>
                </Typography>
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<VisibilityIcon />}
                  onClick={() => openUserResumeInNewTab(resumeOnFile)}
                  sx={{ alignSelf: 'flex-start' }}
                >
                  {t('profile.viewResumeButton')}
                </Button>
              </Stack>
            ) : null}
          </CardContent>
        </Card>

        {saveMessage ? <Alert severity="success">{saveMessage}</Alert> : null}
        {saveError ? <Alert severity="error">{saveError}</Alert> : null}

        {activeSection === 'personal-details' && (
          <WorkerBasicIdentityCard
            uid={uid}
            userDoc={userDoc}
            avatarUrl={String((userDoc?.workerProfile as Record<string, unknown> | undefined)?.photoUrl || userDoc?.avatar || avatarUrl || '')}
            onAvatarUpdated={setAvatarUrl}
          />
        )}

        {activeSection === 'work-authorization' && (
          <WorkEligibilityStep
            value={workEligibilityLocal}
            onChange={(nextValue) => {
              setWorkEligibilityLocal(nextValue);
              void persistWorkEligibility(nextValue);
            }}
          />
        )}

        {activeSection === 'preferences' && (
          <Card variant="outlined" sx={{ borderRadius: 2, borderColor: 'divider', boxShadow: 'none' }}>
            <CardContent>
              <Stack spacing={2}>
                <Box>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
                    {t('profile.targetWorkTypes')}
                  </Typography>
                  <Stack direction="row" spacing={1}>
                    <Button variant={industryPrefs.includes('hospitality') ? 'contained' : 'outlined'} onClick={() => void toggleIndustry('hospitality')}>
                      {t('readiness.hospitality')}
                    </Button>
                    <Button variant={industryPrefs.includes('industrial') ? 'contained' : 'outlined'} onClick={() => void toggleIndustry('industrial')}>
                      {t('readiness.industrial')}
                    </Button>
                  </Stack>
                </Box>
                <Box>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
                    {t('profile.schedulePreference')}
                  </Typography>
                  <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                    <Button variant={schedulePrefs.includes('full_time') ? 'contained' : 'outlined'} onClick={() => void toggleSchedule('full_time')}>
                      {t('readiness.fullTime')}
                    </Button>
                    <Button variant={schedulePrefs.includes('part_time') ? 'contained' : 'outlined'} onClick={() => void toggleSchedule('part_time')}>
                      {t('readiness.partTime')}
                    </Button>
                    <Button variant={schedulePrefs.includes('gig') ? 'contained' : 'outlined'} onClick={() => void toggleSchedule('gig')}>
                      {t('readiness.gigWork')}
                    </Button>
                  </Stack>
                </Box>
              </Stack>
            </CardContent>
          </Card>
        )}

        {activeSection === 'resume' && (
          <ResumeUpload
            userId={uid}
            tenantId={typeof userDoc?.tenantId === 'string' ? userDoc.tenantId : undefined}
            compact
            hideStoredResumeAlert
          />
        )}

        {activeSection === 'bio' && (
          <Card variant="outlined" sx={{ borderRadius: 2, borderColor: 'divider', boxShadow: 'none' }}>
            <CardContent>
              <BioStep
                value={{
                  professionalBio: String(userDoc?.professionalBio ?? userDoc?.bio ?? ''),
                  bio: String(userDoc?.bio ?? ''),
                }}
                onChange={() => {}}
                hideIntro
              />
            </CardContent>
          </Card>
        )}

        {activeSection === 'skills' && uid ? <WorkerSkillsEditor uid={uid} /> : null}

        {activeSection === 'certifications' && (
          <EducationStep
            value={{
              education: Array.isArray(userDoc?.education) ? userDoc.education : [],
              certifications: Array.isArray(userDoc?.certifications) ? userDoc.certifications : [],
            }}
            onChange={() => {}}
            context="profile"
            showOnly="certifications"
          />
        )}

        {activeSection === 'work-history' && (
          <WorkExperienceStep
            value={{
              workExperience: Array.isArray(userDoc?.workExperience) ? userDoc.workExperience : [],
              workHistory: Array.isArray(userDoc?.workHistory) ? userDoc.workHistory : [],
            }}
            onChange={() => {}}
            context="profile"
          />
        )}

        {activeSection === 'education' && (
          <EducationStep
            value={{
              education: Array.isArray(userDoc?.education) ? userDoc.education : [],
              certifications: Array.isArray(userDoc?.certifications) ? userDoc.certifications : [],
            }}
            onChange={() => {}}
            context="profile"
            showOnly="education"
          />
        )}

        {activeSection === 'languages' && (
          <Card variant="outlined" sx={{ borderRadius: 2, borderColor: 'divider', boxShadow: 'none' }}>
            <CardContent>
              <Stack spacing={1.5}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
                  {t('readiness.selectAllThatApply')}
                </Typography>
                <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                  {LANGUAGE_OPTIONS.map((language) => {
                    const isSelected = selectedLanguages.some(
                      (v) => v.toLowerCase() === language.toLowerCase()
                    );
                    return (
                      <Button
                        key={language}
                        variant={isSelected ? 'contained' : 'outlined'}
                        onClick={() => void toggleLanguage(language)}
                      >
                        {language}
                      </Button>
                    );
                  })}
                </Stack>
              </Stack>
            </CardContent>
          </Card>
        )}

        {activeSection === 'app-language' && (
          <Card variant="outlined" sx={{ borderRadius: 2, borderColor: 'divider', boxShadow: 'none' }}>
            <CardContent>
              <Stack spacing={2}>
                <Box>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.75 }}>
                    {t('profile.sectionAppLanguageTitle')}
                  </Typography>
                  <FormControl size="small" sx={{ minWidth: 160 }}>
                    <Select
                      value={preferredLanguage}
                      onChange={(e) => void handlePreferredLanguageChange(e.target.value as 'en' | 'es')}
                    >
                      <MenuItem value="en">{t('workerSettings.english')}</MenuItem>
                      <MenuItem value="es">{t('workerSettings.spanish')}</MenuItem>
                    </Select>
                  </FormControl>
                </Box>

                <Box>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.75 }}>
                    {t('common.notifications')}
                  </Typography>
                  <Stack spacing={0.5}>
                    <Stack direction="row" alignItems="center" justifyContent="space-between">
                      <Typography variant="body2">{t('workerSettings.emailNotifications')}</Typography>
                      <Switch checked={notificationSettings.emailNotifications} onChange={() => void toggleNotificationSetting('emailNotifications')} />
                    </Stack>
                    <Stack direction="row" alignItems="center" justifyContent="space-between">
                      <Typography variant="body2">{t('workerSettings.pushNotifications')}</Typography>
                      <Switch checked={notificationSettings.pushNotifications} onChange={() => void toggleNotificationSetting('pushNotifications')} />
                    </Stack>
                    <Stack direction="row" alignItems="center" justifyContent="space-between">
                      <Typography variant="body2">{t('workerSettings.smsNotifications')}</Typography>
                      <Switch checked={notificationSettings.smsNotifications} onChange={() => void toggleNotificationSetting('smsNotifications')} />
                    </Stack>
                    <Stack direction="row" alignItems="center" justifyContent="space-between">
                      <Typography variant="body2">{t('workerSettings.marketingEmails')}</Typography>
                      <Switch checked={notificationSettings.marketingEmails} onChange={() => void toggleNotificationSetting('marketingEmails')} />
                    </Stack>
                  </Stack>
                </Box>

                <Box>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                    {t('profile.phoneVerification')}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {userDoc?.phoneVerified ? t('profile.verified') : t('profile.notVerified')}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.75, maxWidth: 480 }}>
                    {t('profile.phoneVerificationSmsNote')}
                  </Typography>
                </Box>
              </Stack>
            </CardContent>
          </Card>
        )}

        {activeSection === 'reset-password' && (
          <Card variant="outlined" sx={{ borderRadius: 2, borderColor: 'divider', boxShadow: 'none' }}>
            <CardContent>
              <Stack spacing={1.5}>
                <Typography variant="body2" color="text.secondary">
                  {t('profile.resetPasswordEmailHelp')}
                </Typography>
                <Button variant="contained" onClick={handlePasswordReset} sx={{ alignSelf: 'flex-start' }}>
                  {t('profile.sendPasswordResetEmailButton')}
                </Button>
                <Button color="error" variant="outlined" onClick={() => void logout()} sx={{ alignSelf: 'flex-start' }}>
                  {t('nav.logOut')}
                </Button>
              </Stack>
            </CardContent>
          </Card>
        )}
      </Stack>
    </Container>
  );
};

export default WorkerProfileSection;
