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

import React, { useEffect, useState, useCallback } from 'react';
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
} from '@mui/material';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../../firebase';
import { useAuth } from '../../../contexts/AuthContext';
import { userProfileBatcher, flushProfileUpdates } from '../../../utils/userProfileBatching';
import { getUserScore } from '../../../utils/scoreSummary';
import WorkerProfileAccordions, { type ReadinessAccordionSection } from '../../../components/worker/profile/WorkerProfileAccordions';
import {
  getReadinessPrompts,
  READINESS_SECTION_IDS,
} from '../../../components/worker/profile/readinessPrompts';

const WorkerProfile: React.FC = () => {
  const { user } = useAuth();
  const uid = user?.uid;
  const [userDoc, setUserDoc] = useState<any>(null);
  const [expandedSection, setExpandedSection] = useState<ReadinessAccordionSection | false>('availability');

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

  const score = getUserScore(userDoc);
  const hasScore = typeof score === 'number' && Number.isFinite(score);
  const prompts = userDoc ? getReadinessPrompts(userDoc) : [];

  const handleFixNow = useCallback((sectionId: keyof typeof READINESS_SECTION_IDS) => {
    setExpandedSection(sectionId);
    const id = READINESS_SECTION_IDS[sectionId];
    setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  }, []);

  return (
    <Container maxWidth="md" sx={{ py: 2 }}>
      <Stack spacing={4}>
        {/* Page title */}
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 600 }}>
            Job Readiness
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Complete your profile to unlock more shifts and higher-paying roles.
          </Typography>
        </Box>

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
                  ⭐ Job Readiness
                </Typography>
                <Typography variant="overline" color="text.secondary" display="block">
                  Hiring Score
                </Typography>
                <Typography
                  variant="h5"
                  sx={{
                    fontWeight: 600,
                    color: hasScore ? 'primary.main' : 'text.secondary',
                    mt: 0.5,
                  }}
                >
                  {hasScore ? `${Math.round(score)}%` : '—'}
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
                You&apos;re eligible for 14 roles. Add more to your profile to unlock additional shifts.
              </Typography>
            ) : (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                Score will update after your profile syncs.
              </Typography>
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
                    Fix now
                  </Button>
                }
                sx={{ py: 1.25 }}
              >
                <Typography variant="body2">
                  <Box component="span" sx={{ mr: 1 }}>
                    {p.icon}
                  </Box>
                  {p.text}
                </Typography>
              </Alert>
            ))}
          </Stack>
        )}

        {/* 3. Accordion modules (existing forms) */}
        {uid ? (
          <WorkerProfileAccordions
            uid={uid}
            expandedSection={expandedSection}
            onAccordionChange={setExpandedSection}
          />
        ) : (
          <Typography variant="body2" color="text.secondary">
            Sign in to complete your profile.
          </Typography>
        )}
      </Stack>
    </Container>
  );
};

export default WorkerProfile;
