/**
 * Job Readiness — /c1/workers/profile
 *
 * Structural check: /c1/workers/profile does NOT reuse the same component as /users/:id.
 * Admin profile is UserProfile (pages/UserProfile/index.tsx); this is a separate worker-only
 * page. Refactor is done directly within the worker namespace. Existing forms are reused
 * via WorkerProfileAccordions (worker-specific wrapper that embeds apply steps + ShiftPreferencesCard).
 *
 * Phase 2A: Hero uses stored AI score (users/{uid}.scoreSummary.aiScore) via getUserScore().
 * Phase 2B: Unlock prompts are conditional from getReadinessPrompts(userDoc); "Fix now" scrolls and expands accordion.
 * Phase 2C: getUserScore() adapter in utils/scoreSummary.ts; score source-of-truth documented there.
 */

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Container,
  Typography,
  Box,
  Stack,
  Card,
  CardContent,
  LinearProgress,
  Alert,
  Button,
  ToggleButtonGroup,
  ToggleButton,
} from '@mui/material';
import ViewListIcon from '@mui/icons-material/ViewList';
import ViewModuleIcon from '@mui/icons-material/ViewModule';
import { doc, onSnapshot, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../../firebase';
import { useAuth } from '../../../contexts/AuthContext';
import { useT } from '../../../i18n';
import { userProfileBatcher, flushProfileUpdates } from '../../../utils/userProfileBatching';
import { getUserScore } from '../../../utils/scoreSummary';
import WorkerProfileAccordions, { type ReadinessAccordionSection } from '../../../components/worker/profile/WorkerProfileAccordions';
import WorkerBasicIdentityCard from '../../../components/worker/profile/WorkerBasicIdentityCard';
import WorkerProfileCardDeck from '../../../components/worker/profile/WorkerProfileCardDeck';
import {
  getReadinessPrompts,
  READINESS_SECTION_IDS,
} from '../../../components/worker/profile/readinessPrompts';
import WorkEligibilityStep from '../../../components/apply/steps/WorkEligibilityStep';
import { deriveWorkEligibilityFromAttestation } from '../../../types/workEligibility';

const WorkerProfile: React.FC = () => {
  const { user, avatarUrl, setAvatarUrl } = useAuth();
  const t = useT();
  const uid = user?.uid;
  const [userDoc, setUserDoc] = useState<any>(null);
  const [expandedSection, setExpandedSection] = useState<ReadinessAccordionSection | false>('availability');
  const [viewMode, setViewMode] = useState<'sections' | 'cards'>('sections');
  const [deckIndex, setDeckIndex] = useState(0);

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
      setUserDoc(snap.exists() ? snap.data() : null);
    });
    return () => unsubscribe();
  }, [uid]);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.location.hash) return;
    if (window.location.hash === '#work-eligibility') {
      setTimeout(() => document.getElementById('work-eligibility')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    }
  }, []);

  const score = getUserScore(userDoc);
  const hasScore = typeof score === 'number' && Number.isFinite(score);
  const prompts = userDoc ? getReadinessPrompts(userDoc) : [];
  const topImprovements = (userDoc?.scoreSummary?.explainability?.nextActions ?? []).slice(0, 3);

  const handleFixNow = useCallback((sectionId: keyof typeof READINESS_SECTION_IDS) => {
    setExpandedSection(sectionId);
    setViewMode('sections');
    const id = READINESS_SECTION_IDS[sectionId];
    setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  }, []);

  const handleExpandProfileSection = useCallback((sectionId: ReadinessAccordionSection) => {
    setExpandedSection(sectionId);
    const id = READINESS_SECTION_IDS[sectionId];
    setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  }, []);

  const workEligibilityValueFromDoc = useMemo(() => {
    const a = userDoc?.workEligibilityAttestation;
    if (a && typeof a === 'object') {
      return {
        workAuthorized: a.authorizedToWorkUS === true,
        requireSponsorship: !!a.requireSponsorship,
        gender: a.gender ?? '',
        veteranStatus: a.veteranStatus ?? '',
        disabilityStatus: a.disabilityStatus ?? '',
      };
    }
    return {
      workAuthorized: !!userDoc?.workEligibility,
      requireSponsorship: !!userDoc?.requireSponsorship,
      gender: userDoc?.gender ?? '',
      veteranStatus: userDoc?.veteranStatus ?? '',
      disabilityStatus: userDoc?.disabilityStatus ?? '',
    };
  }, [userDoc?.workEligibilityAttestation, userDoc?.workEligibility, userDoc?.requireSponsorship, userDoc?.gender, userDoc?.veteranStatus, userDoc?.disabilityStatus]);

  const [workEligibilityLocal, setWorkEligibilityLocal] = useState(workEligibilityValueFromDoc);
  useEffect(() => { setWorkEligibilityLocal(workEligibilityValueFromDoc); }, [workEligibilityValueFromDoc]);

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
    const workEligibility = deriveWorkEligibilityFromAttestation(attestation as any);
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

  return (
    <Container maxWidth="md" sx={{ py: 2 }}>
      <Stack spacing={4}>
        {/* Page title */}
        <Box>
          <Typography variant="h4" component="h1" sx={{ fontWeight: 600 }}>
            {t('profile.pageTitle')}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {t('profile.pageSubtitle')}
          </Typography>
        </Box>

        {/* 0. Basic Identity — avatar, name, contact, address (replaces separate My Profile for workers) */}
        {uid && (
          <WorkerBasicIdentityCard
            uid={uid}
            userDoc={userDoc}
            avatarUrl={avatarUrl || (userDoc?.avatar as string) || ''}
            onAvatarUpdated={setAvatarUrl}
          />
        )}

        {/* 1. Readiness Hero — same AI score as admin (worker-facing label: Hiring Score) */}
        <Card variant="outlined" sx={{ borderRadius: 2, borderColor: 'divider', boxShadow: 'none' }}>
          <CardContent sx={{ py: 3, px: 3 }}>
            <Box
              sx={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 2,
              }}
            >
              <Box>
                <Typography variant="h5" sx={{ fontWeight: 600 }}>
                  ⭐ {t('profile.readinessTitle')}
                </Typography>
                <Typography variant="overline" color="text.secondary" display="block">
                  {t('profile.hiringScore')}
                </Typography>
                <Typography
                  variant="h5"
                  sx={{
                    fontWeight: 600,
                    color: hasScore ? 'primary.main' : 'text.secondary',
                    mt: 0.5,
                  }}
                >
                  {hasScore ? `${Math.round(score)}%` : t('profile.scorePending')}
                </Typography>
              </Box>
              <Box sx={{ flex: 1, minWidth: 200, maxWidth: 320 }}>
                <LinearProgress
                  variant="determinate"
                  value={hasScore ? Math.min(100, Math.max(0, score)) : 0}
                  sx={{
                    height: 10,
                    borderRadius: 1,
                    bgcolor: hasScore ? undefined : 'action.hover',
                  }}
                />
              </Box>
            </Box>
            {hasScore ? (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                {t('profile.eligibleRoles')}
              </Typography>
            ) : (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                {t('profile.scoreSync')}
              </Typography>
            )}
            {topImprovements.length > 0 && (
              <Box sx={{ mt: 2 }}>
                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, display: 'block', mb: 0.5 }}>
                  {t('profile.topWaysToImprove')}
                </Typography>
                <Stack component="ul" sx={{ m: 0, pl: 2.5 }}>
                  {topImprovements.map((a: { label?: string }, i: number) => (
                    <Typography key={i} component="li" variant="body2" color="text.secondary">
                      {a.label ?? ''}
                    </Typography>
                  ))}
                </Stack>
              </Box>
            )}
          </CardContent>
        </Card>

        {/* 2. Unlock Prompts — conditional; Fix now scrolls and expands accordion */}
        {prompts.length > 0 && (
          <Stack spacing={1.5}>
            {prompts.map((p) => (
              <Alert
                key={p.id}
                variant="outlined"
                severity="info"
                icon={false}
                action={
                  <Button
                    color="inherit"
                    size="small"
                    onClick={() => handleFixNow(p.id)}
                  >
                    {t('profile.fixNow')}
                  </Button>
                }
                sx={{ py: 1.25 }}
              >
                <Typography variant="body2">
                  <Box component="span" sx={{ mr: 1 }}>
                    {p.icon}
                  </Box>
                  {t(p.textKey)}
                </Typography>
              </Alert>
            ))}
          </Stack>
        )}

        {/* Work Eligibility — attestation (deep link target #work-eligibility) */}
        <Card id="work-eligibility" variant="outlined" sx={{ borderRadius: 2, borderColor: 'divider', boxShadow: 'none', scrollMarginTop: 24 }}>
          <CardContent>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 2 }}>
              {t('profile.workEligibility')}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {t('profile.workEligibilityIntro')}
            </Typography>
            {uid ? (
              <WorkEligibilityStep
                value={workEligibilityLocal}
                onChange={handleWorkEligibilityChange}
              />
            ) : null}
          </CardContent>
        </Card>

        {/* 3. View toggle: Sections (accordion) | Cards (deck) */}
        {uid && (
          <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
            <ToggleButtonGroup
              value={viewMode}
              exclusive
              onChange={(_, v) => { if (v != null) setViewMode(v); setDeckIndex(0); }}
              size="small"
              aria-label={t('profile.viewMode')}
            >
              <ToggleButton value="sections" aria-label={t('profile.viewSections')}>
                <ViewListIcon sx={{ mr: 0.5 }} /> {t('profile.viewSections')}
              </ToggleButton>
              <ToggleButton value="cards" aria-label={t('profile.viewCards')}>
                <ViewModuleIcon sx={{ mr: 0.5 }} /> {t('profile.viewCards')}
              </ToggleButton>
            </ToggleButtonGroup>
          </Box>
        )}

        {/* 4. Accordion (sections) or Card deck */}
        {uid ? (
          viewMode === 'cards' ? (
            <WorkerProfileCardDeck
              activeIndex={deckIndex}
              onIndexChange={setDeckIndex}
              onExpandSection={handleExpandProfileSection}
            />
          ) : null
        ) : null}

        {/* 5. Accordion modules (existing forms) — always in DOM so Expand from deck can scroll here */}
        {uid ? (
          <WorkerProfileAccordions
            uid={uid}
            expandedSection={expandedSection}
            onAccordionChange={setExpandedSection}
          />
        ) : (
          <Typography variant="body2" color="text.secondary">
            {t('profile.signInToComplete')}
          </Typography>
        )}
      </Stack>
    </Container>
  );
};

export default WorkerProfile;
