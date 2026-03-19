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
import { doc, onSnapshot, serverTimestamp, updateDoc } from 'firebase/firestore';
import { sendPasswordResetEmail } from 'firebase/auth';
import { useNavigate, useParams } from 'react-router-dom';

import { db, auth } from '../../../firebase';
import { useAuth } from '../../../contexts/AuthContext';
import { setLanguage, useT } from '../../../i18n';
import WorkerBasicIdentityCard from '../../../components/worker/profile/WorkerBasicIdentityCard';
import WorkEligibilityStep from '../../../components/apply/steps/WorkEligibilityStep';
import { deriveWorkEligibilityFromAttestation } from '../../../types/workEligibility';
import ResumeUpload from '../../../components/ResumeUpload';
import EducationStep from '../../../components/apply/steps/EducationStep';
import WorkExperienceStep from '../../../components/apply/steps/WorkExperienceStep';
import { buildReadinessIntentWritePatch } from '../../../utils/workerReadinessWriteModel';

type SectionKey =
  | 'personal-details'
  | 'location'
  | 'work-authorization'
  | 'preferences'
  | 'resume'
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

const SECTION_META: Record<SectionKey, { title: string; description: string }> = {
  'personal-details': {
    title: 'Personal details',
    description: 'Update your name, email, phone, and profile photo.',
  },
  location: {
    title: 'City and state',
    description: 'Keep your location updated for stronger opportunities.',
  },
  'work-authorization': {
    title: 'Work authorization',
    description: 'Confirm your work authorization and optional self-identification details.',
  },
  preferences: {
    title: 'Availability and preferences',
    description: 'Set your target work types and schedule preferences.',
  },
  resume: {
    title: 'Resume',
    description: 'Upload, replace, or review your resume.',
  },
  certifications: {
    title: 'Certifications & Licenses',
    description: 'Manage certifications and licenses.',
  },
  'work-history': {
    title: 'Work experience',
    description: 'Add or update your recent work experience.',
  },
  education: {
    title: 'Education',
    description: 'Keep your education entries up to date.',
  },
  languages: {
    title: 'Languages',
    description: 'Add languages once and avoid duplicates.',
  },
  'app-language': {
    title: 'App language',
    description: 'Manage app language and notification preferences.',
  },
  'reset-password': {
    title: 'Reset password',
    description: 'Update your sign-in password.',
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

  const [locationForm, setLocationForm] = useState({ city: '', state: '' });
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
      const addressInfo = (data.addressInfo || {}) as Record<string, unknown>;
      setLocationForm({
        city: String(addressInfo.city || data.city || ''),
        state: String(addressInfo.state || data.state || ''),
      });

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

  const saveLocation = async () => {
    if (!uid) return;
    setSaveError(null);
    setSaveMessage(null);
    try {
      await updateDoc(doc(db, 'users', uid), {
        city: locationForm.city.trim(),
        state: locationForm.state.trim(),
        addressInfo: {
          ...(((userDoc?.addressInfo || {}) as Record<string, unknown>) || {}),
          city: locationForm.city.trim(),
          state: locationForm.state.trim(),
        },
        updatedAt: serverTimestamp(),
      });
      setSaveMessage('Location saved');
    } catch {
      setSaveError('Unable to save location right now.');
    }
  };

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
      setSaveMessage('Languages saved');
    } catch {
      setSaveError('Unable to save languages right now.');
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
      setSaveError('No email found on your profile.');
      return;
    }
    setSaveError(null);
    setSaveMessage(null);
    try {
      await sendPasswordResetEmail(auth, email);
      setSaveMessage(`Password reset email sent to ${email}`);
    } catch {
      setSaveError('Unable to send password reset email.');
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
      setSaveMessage('Account settings saved');
      setSaveError(null);
    } catch {
      setSaveError('Unable to save preferred language.');
    }
  };

  const toggleNotificationSetting = async (
    field: 'emailNotifications' | 'pushNotifications' | 'smsNotifications' | 'marketingEmails'
  ) => {
    const next = { ...notificationSettings, [field]: !notificationSettings[field] };
    setNotificationSettings(next);
    try {
      await updateAccountSettings({ notificationSettings: next });
      setSaveMessage('Account settings saved');
      setSaveError(null);
    } catch {
      setSaveError('Unable to save notification preference.');
    }
  };

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
          Back to profile
        </Button>
        <Alert severity="warning">That profile section is not available.</Alert>
      </Container>
    );
  }

  return (
    <Container maxWidth="md" sx={{ py: 2 }}>
      <Stack spacing={2}>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/c1/workers/profile')} sx={{ alignSelf: 'flex-start' }}>
          Back to profile
        </Button>

        <Card variant="outlined" sx={{ borderRadius: 2, borderColor: 'divider', boxShadow: 'none' }}>
          <CardContent>
            <Typography variant="h5" sx={{ fontWeight: 700 }}>
              {sectionMeta.title}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {sectionMeta.description}
            </Typography>
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

        {activeSection === 'location' && (
          <Card variant="outlined" sx={{ borderRadius: 2, borderColor: 'divider', boxShadow: 'none' }}>
            <CardContent>
              <Stack spacing={2}>
                <TextField
                  label="City"
                  value={locationForm.city}
                  onChange={(e) => setLocationForm((prev) => ({ ...prev, city: e.target.value }))}
                  fullWidth
                />
                <TextField
                  label="State"
                  value={locationForm.state}
                  onChange={(e) => setLocationForm((prev) => ({ ...prev, state: e.target.value }))}
                  fullWidth
                />
                <Button variant="contained" onClick={saveLocation} sx={{ alignSelf: 'flex-start' }}>
                  Save location
                </Button>
              </Stack>
            </CardContent>
          </Card>
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
                    Target work types
                  </Typography>
                  <Stack direction="row" spacing={1}>
                    <Button variant={industryPrefs.includes('hospitality') ? 'contained' : 'outlined'} onClick={() => void toggleIndustry('hospitality')}>
                      Hospitality
                    </Button>
                    <Button variant={industryPrefs.includes('industrial') ? 'contained' : 'outlined'} onClick={() => void toggleIndustry('industrial')}>
                      Industrial
                    </Button>
                  </Stack>
                </Box>
                <Box>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
                    Schedule preference
                  </Typography>
                  <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                    <Button variant={schedulePrefs.includes('full_time') ? 'contained' : 'outlined'} onClick={() => void toggleSchedule('full_time')}>
                      Full-Time
                    </Button>
                    <Button variant={schedulePrefs.includes('part_time') ? 'contained' : 'outlined'} onClick={() => void toggleSchedule('part_time')}>
                      Part-Time
                    </Button>
                    <Button variant={schedulePrefs.includes('gig') ? 'contained' : 'outlined'} onClick={() => void toggleSchedule('gig')}>
                      Gig Work
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
          />
        )}

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
                  Select all that apply
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
                    App language
                  </Typography>
                  <FormControl size="small" sx={{ minWidth: 160 }}>
                    <Select
                      value={preferredLanguage}
                      onChange={(e) => void handlePreferredLanguageChange(e.target.value as 'en' | 'es')}
                    >
                      <MenuItem value="en">English</MenuItem>
                      <MenuItem value="es">Español</MenuItem>
                    </Select>
                  </FormControl>
                </Box>

                <Box>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.75 }}>
                    Notifications
                  </Typography>
                  <Stack spacing={0.5}>
                    <Stack direction="row" alignItems="center" justifyContent="space-between">
                      <Typography variant="body2">Email notifications</Typography>
                      <Switch checked={notificationSettings.emailNotifications} onChange={() => void toggleNotificationSetting('emailNotifications')} />
                    </Stack>
                    <Stack direction="row" alignItems="center" justifyContent="space-between">
                      <Typography variant="body2">Push notifications</Typography>
                      <Switch checked={notificationSettings.pushNotifications} onChange={() => void toggleNotificationSetting('pushNotifications')} />
                    </Stack>
                    <Stack direction="row" alignItems="center" justifyContent="space-between">
                      <Typography variant="body2">SMS notifications</Typography>
                      <Switch checked={notificationSettings.smsNotifications} onChange={() => void toggleNotificationSetting('smsNotifications')} />
                    </Stack>
                    <Stack direction="row" alignItems="center" justifyContent="space-between">
                      <Typography variant="body2">Marketing emails</Typography>
                      <Switch checked={notificationSettings.marketingEmails} onChange={() => void toggleNotificationSetting('marketingEmails')} />
                    </Stack>
                  </Stack>
                </Box>

                <Box>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                    Phone verification
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {userDoc?.phoneVerified ? 'Verified' : 'Not verified'}
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
                  Send a secure password reset email to your account.
                </Typography>
                <Button variant="contained" onClick={handlePasswordReset} sx={{ alignSelf: 'flex-start' }}>
                  Send reset email
                </Button>
                <Button color="error" variant="outlined" onClick={() => void logout()} sx={{ alignSelf: 'flex-start' }}>
                  Log out
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
