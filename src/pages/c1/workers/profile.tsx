import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  Container,
  Typography,
  Box,
  Stack,
  Card,
  CardContent,
  Avatar,
  Chip,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Button,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { doc, onSnapshot, updateDoc, serverTimestamp } from 'firebase/firestore';
import { useNavigate, useLocation } from 'react-router-dom';

import { db } from '../../../firebase';
import { useAuth } from '../../../contexts/AuthContext';
import { useT } from '../../../i18n';
import { userProfileBatcher, flushProfileUpdates } from '../../../utils/userProfileBatching';
import { buildHomeReadinessModel } from '../../../utils/homeReadinessModel';
import WorkerProfileAccordions, { type WorkerProfileEditorSection } from '../../../components/worker/profile/WorkerProfileAccordions';
import WorkerBasicIdentityCard from '../../../components/worker/profile/WorkerBasicIdentityCard';
import WorkEligibilityStep from '../../../components/apply/steps/WorkEligibilityStep';
import { deriveWorkEligibilityFromAttestation } from '../../../types/workEligibility';

type ProfileAccordionSection =
  | 'basic-info'
  | 'work-eligibility'
  | WorkerProfileEditorSection;

const accordionSx = {
  '&:before': { display: 'none' },
  borderColor: 'divider',
  borderRadius: '8px !important',
  boxShadow: 'none',
  '& .MuiAccordionSummary-root': {
    transition: 'background-color 0.2s ease',
    '&:hover': { bgcolor: 'action.hover' },
  },
};

const WorkerProfile: React.FC = () => {
  const { user, avatarUrl, setAvatarUrl } = useAuth();
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const uid = user?.uid;
  const [userDoc, setUserDoc] = useState<Record<string, unknown> | null>(null);
  const [expandedSection, setExpandedSection] = useState<ProfileAccordionSection | false>('basic-info');

  useEffect(() => {
    userProfileBatcher.initialize();
    return () => {
      flushProfileUpdates(true);
    };
  }, []);

  useEffect(() => {
    if (!uid) return;
    const userRef = doc(db, 'users', uid);
    const unsubscribe = onSnapshot(userRef, (snap) => {
      setUserDoc(snap.exists() ? (snap.data() as Record<string, unknown>) : null);
    });
    return () => unsubscribe();
  }, [uid]);

  const readinessModel = useMemo(() => buildHomeReadinessModel(userDoc), [userDoc]);
  const resolvedProfilePhoto = String(
    (userDoc?.workerProfile as Record<string, unknown> | undefined)?.photoUrl ||
      userDoc?.avatar ||
      avatarUrl ||
      ''
  ).trim();
  const fullName = String(
    `${String(userDoc?.firstName || '').trim()} ${String(userDoc?.lastName || '').trim()}`
  ).trim() || 'Your profile';
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
  const locationLabel = city && state ? `${city}, ${state}` : city || state || 'Add your location';

  const profileStatus: 'complete' | 'action_required' | 'recommended' =
    readinessModel.readinessPercent >= 90
      ? 'complete'
      : readinessModel.readinessPercent < 40
        ? 'action_required'
        : 'recommended';
  const profileStatusColor = profileStatus === 'complete' ? 'success' : profileStatus === 'action_required' ? 'warning' : 'default';
  const profileStatusLabel = profileStatus === 'complete' ? 'Complete' : profileStatus === 'action_required' ? 'Action required' : 'Recommended';

  const workEligibilityValueFromDoc = useMemo(() => {
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
  const [workEligibilityLocal, setWorkEligibilityLocal] = useState(workEligibilityValueFromDoc);
  useEffect(() => {
    setWorkEligibilityLocal(workEligibilityValueFromDoc);
  }, [workEligibilityValueFromDoc]);

  const handleWorkEligibilityUpdate = useCallback(async (value: typeof workEligibilityValueFromDoc) => {
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
  }, [uid]);

  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleWorkEligibilityChange = useCallback((value: typeof workEligibilityValueFromDoc) => {
    setWorkEligibilityLocal(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { handleWorkEligibilityUpdate(value); }, 500);
  }, [handleWorkEligibilityUpdate]);
  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

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
          My Profile
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
                  {readinessModel.completedCount} of {readinessModel.requiredCount} key items complete ({readinessModel.readinessPercent}%)
                </Typography>
              </Box>
              <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                <Chip size="small" variant="outlined" color={profileStatusColor} label={profileStatusLabel} />
              </Stack>
            </Stack>
            {location.search.includes('from=readiness') && (
              <Box sx={{ mt: 1.5 }}>
                <Button
                  size="small"
                  variant="text"
                  endIcon={<OpenInNewIcon fontSize="small" />}
                  onClick={() => navigate('/c1/workers/dashboard')}
                >
                  Return to Home
                </Button>
              </Box>
            )}
          </CardContent>
        </Card>

        <Accordion
          id="profile-basic-info"
          expanded={expandedSection === 'basic-info'}
          onChange={(_, expanded) => setExpandedSection(expanded ? 'basic-info' : false)}
          variant="outlined"
          sx={accordionSx}
        >
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography fontWeight={600}>Basic Info</Typography>
          </AccordionSummary>
          <AccordionDetails sx={{ pt: 0 }}>
            <WorkerBasicIdentityCard
              uid={uid}
              userDoc={userDoc}
              avatarUrl={resolvedProfilePhoto}
              onAvatarUpdated={setAvatarUrl}
            />
          </AccordionDetails>
        </Accordion>

        <Accordion
          id="profile-work-eligibility"
          expanded={expandedSection === 'work-eligibility'}
          onChange={(_, expanded) => setExpandedSection(expanded ? 'work-eligibility' : false)}
          variant="outlined"
          sx={accordionSx}
        >
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography fontWeight={600}>Work Eligibility</Typography>
          </AccordionSummary>
          <AccordionDetails sx={{ pt: 0 }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Confirm your authorization details so recruiters can place you in eligible roles.
            </Typography>
            <WorkEligibilityStep
              value={workEligibilityLocal}
              onChange={handleWorkEligibilityChange}
            />
          </AccordionDetails>
        </Accordion>

        <WorkerProfileAccordions
          uid={uid}
          expandedSection={
            expandedSection === 'work-preferences' ||
            expandedSection === 'skills-experience' ||
            expandedSection === 'certifications-documents'
              ? expandedSection
              : false
          }
          onAccordionChange={(section) => setExpandedSection(section)}
        />
      </Stack>
    </Container>
  );
};

export default WorkerProfile;
