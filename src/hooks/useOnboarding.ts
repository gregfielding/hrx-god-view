/**
 * Firestore subscription to users/{uid}.onboarding (v1.1).
 * Returns checklist and computed compliance summary for the worker documents page.
 */
import { useState, useEffect, useMemo } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import type { OnboardingChecklist } from '../types/onboarding';
import { computeComplianceSummary } from '../utils/complianceSummary';
import type { ComplianceSummary } from '../types/onboarding';

export interface UseOnboardingResult {
  checklist: OnboardingChecklist;
  summary: ComplianceSummary;
  loading: boolean;
  hasOnboarding: boolean;
}

const EMPTY_CHECKLIST: OnboardingChecklist = {};
const EMPTY_SUMMARY: ComplianceSummary = {
  compliancePercent: 0,
  overallStatus: 'incomplete',
  requiredCount: 0,
  completedCount: 0,
  expiredCount: 0,
  expiringSoonCount: 0,
  lastEvaluatedAt: new Date(),
};

export function useOnboarding(uid: string | undefined): UseOnboardingResult {
  const [checklist, setChecklist] = useState<OnboardingChecklist>(EMPTY_CHECKLIST);
  const [loading, setLoading] = useState(true);
  const [hasOnboarding, setHasOnboarding] = useState(false);

  useEffect(() => {
    if (!uid) {
      setChecklist(EMPTY_CHECKLIST);
      setLoading(false);
      setHasOnboarding(false);
      return;
    }
    setLoading(true);
    const userRef = doc(db, 'users', uid);
    const unsubscribe = onSnapshot(
      userRef,
      (snap) => {
        const data = snap.exists() ? snap.data() : null;
        const onboarding = data?.onboarding;
        if (onboarding && typeof onboarding === 'object' && onboarding.checklist) {
          const cl = onboarding.checklist as OnboardingChecklist;
          setChecklist(cl);
          setHasOnboarding(true);
        } else {
          setChecklist(EMPTY_CHECKLIST);
          setHasOnboarding(false);
        }
        setLoading(false);
      },
      (err) => {
        console.warn('useOnboarding snapshot error:', err);
        setChecklist(EMPTY_CHECKLIST);
        setHasOnboarding(false);
        setLoading(false);
      }
    );
    return () => unsubscribe();
  }, [uid]);

  const summary = useMemo(
    () => (Object.keys(checklist).length > 0 ? computeComplianceSummary(checklist) : EMPTY_SUMMARY),
    [checklist]
  );

  return {
    checklist,
    summary,
    loading,
    hasOnboarding,
  };
}
