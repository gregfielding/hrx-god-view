import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Box,
  Stack,
  Typography,
  Button,
  CircularProgress,
  Chip,
  ToggleButton,
  ToggleButtonGroup,
  Fade,
} from '@mui/material';
import { doc, onSnapshot, updateDoc, serverTimestamp } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';

import { db } from '../../../firebase';
import { useAuth } from '../../../contexts/AuthContext';
import ReadinessEngineCard from '../../../components/worker/jobReadiness/ReadinessEngineCard';
import { buildJobReadinessEngine } from '../../../utils/jobReadinessEngine';
import type { DesiredWorkType, TargetIndustry } from '../../../utils/jobReadinessOpportunityMap';

const JobReadinessFeed: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [userDoc, setUserDoc] = useState<Record<string, unknown> | null>(null);
  const [loadingUser, setLoadingUser] = useState(true);
  const [isCardTransitioning, setIsCardTransitioning] = useState(false);
  const [desiredWorkType, setDesiredWorkType] = useState<DesiredWorkType>('any');
  const [targetIndustries, setTargetIndustries] = useState<TargetIndustry[]>(['hospitality', 'industrial']);
  const [responses, setResponses] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!user?.uid) return;
    const userRef = doc(db, 'users', user.uid);
    const unsub = onSnapshot(userRef, (snap) => {
      setLoadingUser(false);
      if (!snap.exists()) {
        setUserDoc(null);
        return;
      }
      const data = snap.data() as Record<string, unknown>;
      setUserDoc(data);

      const prefs = ((data.workerProfile as Record<string, unknown> | undefined)?.preferences || {}) as Record<string, unknown>;
      const persistedWorkType = String(prefs.desiredWorkType || '').toLowerCase();
      if (persistedWorkType === 'full_time' || persistedWorkType === 'part_time' || persistedWorkType === 'gig' || persistedWorkType === 'any') {
        setDesiredWorkType(persistedWorkType);
      }

      const persistedIndustriesRaw = prefs.targetIndustries;
      if (Array.isArray(persistedIndustriesRaw)) {
        const normalized = persistedIndustriesRaw
          .map((v) => String(v || '').toLowerCase())
          .filter((v): v is TargetIndustry => v === 'hospitality' || v === 'industrial');
        if (normalized.length > 0) setTargetIndustries(normalized);
      }

      const responseMap = (data.jobReadinessEngineResponses || {}) as Record<string, unknown>;
      const nextResponses: Record<string, string> = {};
      for (const [key, row] of Object.entries(responseMap)) {
        if (!row || typeof row !== 'object') continue;
        const value = String((row as Record<string, unknown>).value || '').trim();
        if (value) nextResponses[key] = value;
      }
      setResponses(nextResponses);
    });
    return () => unsub();
  }, [user?.uid]);

  const engine = useMemo(
    () =>
      buildJobReadinessEngine({
        userDoc,
        desiredWorkType,
        targetIndustries,
        responses,
      }),
    [userDoc, desiredWorkType, targetIndustries, responses]
  );
  const persistIntent = useCallback(
    async (nextWorkType: DesiredWorkType, nextIndustries: TargetIndustry[]) => {
      if (!user?.uid) return;
      const userRef = doc(db, 'users', user.uid);
      await updateDoc(userRef, {
        'workerProfile.preferences.desiredWorkType': nextWorkType,
        'workerProfile.preferences.targetIndustries': nextIndustries,
        'jobReadiness.intent.desiredWorkType': nextWorkType, // Compatibility namespace
        'jobReadiness.intent.targetIndustries': nextIndustries, // Compatibility namespace
        updatedAt: serverTimestamp(),
      });
    },
    [user?.uid]
  );

  const persistEngineResponse = useCallback(
    async (requirementId: string, value: string) => {
      if (!user?.uid) return;
      const userRef = doc(db, 'users', user.uid);
      await updateDoc(userRef, {
        [`jobReadinessEngineResponses.${requirementId}.value`]: value,
        [`jobReadinessEngineResponses.${requirementId}.answeredAt`]: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    },
    [user?.uid]
  );

  const handleWorkTypeChange = async (_: React.MouseEvent<HTMLElement>, next: DesiredWorkType | null) => {
    if (!next) return;
    setDesiredWorkType(next);
    await persistIntent(next, targetIndustries);
  };

  const handleIndustryToggle = async (industry: TargetIndustry) => {
    const nextSet = targetIndustries.includes(industry)
      ? targetIndustries.filter((i) => i !== industry)
      : [...targetIndustries, industry];
    const normalized = nextSet.length === 0 ? [industry] : nextSet;
    setTargetIndustries(normalized);
    await persistIntent(desiredWorkType, normalized);
  };

  const handleCardAction = useCallback(
    async (value: string) => {
      const card = engine.nextCard;
      if (!card) return;
      if (value === 'open_profile') {
        const hash = card.profileSectionId ? `#${card.profileSectionId}` : '';
        navigate(`/c1/workers/profile${hash}`);
      }
      if (value === 'open_resource') {
        if (card.profileSectionId) {
          navigate(`/c1/workers/profile#${card.profileSectionId}`);
        }
      }

      if (card.requirementId && ['yes', 'no', 'done', 'continue', 'open_profile', 'open_resource'].includes(value)) {
        const persistedValue =
          value === 'done' || value === 'continue' || value === 'open_profile' || value === 'open_resource'
            ? 'completed'
            : value;
        setIsCardTransitioning(true);
        await persistEngineResponse(card.requirementId, persistedValue);
        setResponses((prev) => ({ ...prev, [card.requirementId]: persistedValue }));
        window.setTimeout(() => setIsCardTransitioning(false), 180);
      }
    },
    [engine.nextCard, navigate, persistEngineResponse]
  );

  if (!user?.uid || loadingUser) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ maxWidth: 700, mx: 'auto', px: 1, py: 2 }}>
      <Stack spacing={2.5}>
        <Typography variant="h4" sx={{ fontWeight: 800 }}>
          Let&apos;s Help You Get Hired
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {engine.summary}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {engine.limitingSummary}
        </Typography>

        <Stack spacing={1.25}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            What kind of work are you looking for?
          </Typography>
          <ToggleButtonGroup
            size="small"
            color="primary"
            exclusive
            value={desiredWorkType}
            onChange={handleWorkTypeChange}
            sx={{ flexWrap: 'wrap', gap: 1 }}
          >
            <ToggleButton value="full_time">Full-Time</ToggleButton>
            <ToggleButton value="part_time">Part-Time</ToggleButton>
            <ToggleButton value="gig">Gig Work</ToggleButton>
            <ToggleButton value="any">Any Work</ToggleButton>
          </ToggleButtonGroup>
        </Stack>

        <Stack spacing={1.25}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            What type of work are you interested in?
          </Typography>
          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
            <Chip
              label="Hospitality"
              clickable
              color={targetIndustries.includes('hospitality') ? 'primary' : 'default'}
              variant={targetIndustries.includes('hospitality') ? 'filled' : 'outlined'}
              onClick={() => handleIndustryToggle('hospitality')}
            />
            <Chip
              label="Industrial"
              clickable
              color={targetIndustries.includes('industrial') ? 'primary' : 'default'}
              variant={targetIndustries.includes('industrial') ? 'filled' : 'outlined'}
              onClick={() => handleIndustryToggle('industrial')}
            />
          </Stack>
        </Stack>

        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
          {engine.topActions.map((a) => (
            <Chip key={a.requirementId} label={`Next: ${a.label}`} size="small" variant="outlined" />
          ))}
        </Stack>

        {engine.nextCard ? (
          <Fade in={!isCardTransitioning} key={engine.nextCard.id} timeout={200}>
            <Box>
              <ReadinessEngineCard card={engine.nextCard} onAction={handleCardAction} />
            </Box>
          </Fade>
        ) : (
          <Box sx={{ p: 2, border: '1px dashed', borderColor: 'divider', borderRadius: 2 }}>
            <Typography variant="body2" color="text.secondary">
              You&apos;re all set for now. Keep your profile current to continue improving job matches.
            </Typography>
          </Box>
        )}

        <Button variant="text" onClick={() => navigate('/c1/workers/profile')}>
          Open Full Profile
        </Button>
      </Stack>
    </Box>
  );
};

export default JobReadinessFeed;
