import React, { useState, useEffect, useMemo } from 'react';
import {
  Box,
  Typography,
  TextField,
  Button,
  Card,
  CardContent,
  CardHeader,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
  Snackbar,
  Grid,
  Divider,
  Slider,
  IconButton,
  Tooltip,
  Chip,
  Stack,
} from '@mui/material';
import {
  Add as AddIcon,
  Schedule as ScheduleIcon,
  Person as PersonIcon,
  Delete as DeleteIcon,
} from '@mui/icons-material';
import { doc, collection, addDoc, getDocs, query, orderBy, serverTimestamp, getDoc, updateDoc, deleteDoc } from 'firebase/firestore';

import { db } from '../../../firebase';
import { computeAiScoreFromComponents } from '../../../utils/scoreSummary';
import { useAuth } from '../../../contexts/AuthContext';
import { DEFAULT_INTERVIEW_QUESTION_TEMPLATES } from '../../../constants/interviewQuestions';
import type {
  WorkerAiPrescreenInterviewKind,
  WorkerInterviewAiBlock,
} from '../../../types/workerAiPrescreenInterview';
import {
  explanationLineForHiringDecision,
  formatHiringDecisionLabel,
  formatScoreRecommendationLabel,
  hiringDecisionChipColor,
  hiringDecisionChipVariant,
  labelForAiHiringReasonCode,
  labelForDynamicAnswerKey,
  labelForInterviewFlag,
  readDynamicAnswersFromAiContext,
  WORKER_AI_INTERVIEW_REC_VS_HIRING_DECISION_HELP,
} from '../../../utils/workerAiHiringDecisionDisplay';
import { buildRecruiterDecisionSummary } from '../../../utils/scoring/recruiterDecisionSummary';
import { formatPrescreenAnswerForRecruiter } from '../../../utils/scoring/prescreenAnswerDisplay';
import {
  RecruiterCategoryScoresInlineChip,
  RecruiterCategoryScoresPanel,
} from '../../../components/recruiter/RecruiterCategoryScoresReadOnly';
import { parsePrescreenCategoryScoresFromFirestore } from '../../../utils/parseRecruiterCategoryScores';
import { useCategoryScoresCurrent } from '../../../hooks/useCategoryScoresCurrent';

interface InterviewQuestion {
  id: string;
  question: string;
  answer: string;
  type: 'text' | 'single_select' | 'multi_select' | string;
  /** Raw value when answer is not a plain string (multi-select, etc.) */
  rawAnswer?: unknown;
}

interface Interview {
  id: string;
  createdByName: string;
  createdByUid: string;
  createdAt: Date;
  questions: InterviewQuestion[];
  notes?: string;
  score10?: number;
  interviewKind?: WorkerAiPrescreenInterviewKind;
  applicationId?: string | null;
  ai?: WorkerInterviewAiBlock;
}

function parseInterviewAi(raw: unknown): WorkerInterviewAiBlock | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const overallScore = typeof o.overallScore === 'number' ? o.overallScore : NaN;
  if (!Number.isFinite(overallScore)) return undefined;
  const rec = o.recommendation;
  const recommendation =
    rec === 'proceed' || rec === 'review' || rec === 'caution' || rec === 'decline' ? rec : 'review';
  const flags = Array.isArray(o.flags) ? o.flags.map((x) => String(x)) : [];
  let subScores: WorkerInterviewAiBlock['subScores'];
  const sub = o.subScores;
  if (sub && typeof sub === 'object') {
    const s = sub as Record<string, unknown>;
    subScores = {
      experience: typeof s.experience === 'number' ? s.experience : undefined,
      reliability: typeof s.reliability === 'number' ? s.reliability : undefined,
      transportation: typeof s.transportation === 'number' ? s.transportation : undefined,
      risk: typeof s.risk === 'number' ? s.risk : undefined,
      physical: typeof s.physical === 'number' ? s.physical : undefined,
      fit: typeof s.fit === 'number' ? s.fit : undefined,
      compliance: typeof s.compliance === 'number' ? s.compliance : undefined,
    };
  }
  const summary = typeof o.summary === 'string' ? o.summary : undefined;
  const model = typeof o.model === 'string' ? o.model : undefined;
  const ct = o.computedAt as { toDate?: () => Date } | undefined;
  const computedAt = ct && typeof ct.toDate === 'function' ? ct.toDate() : undefined;

  let assignmentReadiness: WorkerInterviewAiBlock['assignmentReadiness'];
  const ar = o.assignmentReadiness;
  if (ar && typeof ar === 'object') {
    const s = (ar as Record<string, unknown>).status;
    const status = s === 'ready' || s === 'review' || s === 'blocked' ? s : 'review';
    const reasons = Array.isArray((ar as Record<string, unknown>).reasons)
      ? ((ar as Record<string, unknown>).reasons as unknown[]).map((x) => String(x))
      : [];
    assignmentReadiness = { status, reasons };
  }

  let alternatePaths: WorkerInterviewAiBlock['alternatePaths'];
  const ap = o.alternatePaths;
  if (ap && typeof ap === 'object' && (ap as Record<string, unknown>).gigEligible === true) {
    alternatePaths = { gigEligible: true };
  }

  let aiInterviewContext: Record<string, unknown> | undefined;
  const ctx = o.aiInterviewContext;
  if (ctx && typeof ctx === 'object' && !Array.isArray(ctx)) {
    aiInterviewContext = ctx as Record<string, unknown>;
  }

  let hiringDecision: WorkerInterviewAiBlock['hiringDecision'];
  const hdRaw = o.hiringDecision;
  if (hdRaw && typeof hdRaw === 'object') {
    const hd = hdRaw as Record<string, unknown>;
    const dec = hd.decision;
    if (dec === 'advance' || dec === 'review' || dec === 'hold' || dec === 'reject') {
      hiringDecision = {
        decision: dec,
        eligibleForAutoAdvance: Boolean(hd.eligibleForAutoAdvance),
        reasonCodes: Array.isArray(hd.reasonCodes) ? hd.reasonCodes.map((x) => String(x)) : [],
      };
    }
  }

  const parsedCats = parsePrescreenCategoryScoresFromFirestore(o);

  const baseInterviewScore = typeof o.baseInterviewScore === 'number' ? o.baseInterviewScore : undefined;
  const overrideAdjustedScore = typeof o.overrideAdjustedScore === 'number' ? o.overrideAdjustedScore : undefined;
  const overrideScoreDelta = typeof o.overrideScoreDelta === 'number' ? o.overrideScoreDelta : undefined;
  const softBlocks = Array.isArray(o.softBlocks) ? o.softBlocks.map((x) => String(x)) : undefined;
  const hardBlocks = Array.isArray(o.hardBlocks) ? o.hardBlocks.map((x) => String(x)) : undefined;

  return {
    overallScore,
    baseInterviewScore,
    overrideAdjustedScore,
    overrideScoreDelta,
    softBlocks,
    hardBlocks,
    recommendation,
    flags,
    subScores,
    summary,
    model,
    computedAt,
    assignmentReadiness,
    alternatePaths,
    aiInterviewContext,
    hiringDecision,
    categoryScores: parsedCats.scores ?? undefined,
    categoryEvidence: parsedCats.evidence ?? undefined,
  };
}

function interviewSourceLabel(kind: Interview['interviewKind']): string {
  return kind === 'worker_ai_prescreen' ? 'Worker AI pre-screen' : 'Recruiter (live)';
}

function recommendationChipColor(
  r: WorkerInterviewAiBlock['recommendation'],
): 'success' | 'warning' | 'error' {
  if (r === 'proceed') return 'success';
  if (r === 'caution' || r === 'decline') return 'error';
  return 'warning';
}

function historyFlagsSummary(interview: Interview): string {
  if (interview.interviewKind !== 'worker_ai_prescreen' || !interview.ai) return '—';
  const flags = interview.ai.flags;
  if (!flags.length) return '—';
  const parts = flags.slice(0, 2).map(labelForInterviewFlag);
  const extra = flags.length > 2 ? ` +${flags.length - 2}` : '';
  return parts.join(', ') + extra;
}

interface InterviewTabProps {
  uid: string;
}

function prescreenAnswerDisplayLine(q: InterviewQuestion): string {
  const raw = q.rawAnswer !== undefined ? q.rawAnswer : q.answer;
  const t = formatPrescreenAnswerForRecruiter(raw);
  if (t === '—' && (!q.answer || !String(q.answer).trim())) return 'No answer provided';
  return t;
}

const InterviewTab: React.FC<InterviewTabProps> = ({ uid }) => {
  const { currentUser } = useAuth();
  const { scores: profileCategoryScores, userDocReady: profileScoresReady } = useCategoryScoresCurrent(uid);
  const [interviews, setInterviews] = useState<Interview[]>([]);
  const [loading, setLoading] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [viewInterviewDialog, setViewInterviewDialog] = useState<{ open: boolean; interview: Interview | null }>({ open: false, interview: null });
  const [submitterName, setSubmitterName] = useState<string>('');
  const [score, setScore] = useState<number>(5);

  const seedQuestionsFromTemplates = (): InterviewQuestion[] =>
    DEFAULT_INTERVIEW_QUESTION_TEMPLATES.map((q) => ({
      id: q.id,
      question: q.question,
      answer: '',
      type: q.type,
    }));

  const [questions, setQuestions] = useState<InterviewQuestion[]>(() => seedQuestionsFromTemplates());

  useEffect(() => {
    loadInterviews();
    loadSubmitterName();
  }, [uid, currentUser]);

  const loadSubmitterName = async () => {
    if (!currentUser?.uid) return;
    
    try {
      const userRef = doc(db, 'users', currentUser.uid);
      const userSnap = await getDoc(userRef);
      if (userSnap.exists()) {
        const data = userSnap.data();
        const firstName = data.firstName || '';
        const lastName = data.lastName || '';
        if (firstName || lastName) {
          setSubmitterName(`${firstName} ${lastName}`.trim());
        } else {
          setSubmitterName(currentUser.displayName || currentUser.email || 'Unknown');
        }
      } else {
        setSubmitterName(currentUser.displayName || currentUser.email || 'Unknown');
      }
    } catch (error) {
      console.error('Error loading submitter name:', error);
      setSubmitterName(currentUser.displayName || currentUser.email || 'Unknown');
    }
  };

  const loadInterviews = async () => {
    setLoading(true);
    try {
      const interviewsRef = collection(db, 'users', uid, 'interviews');
      // New schema uses createdAt; legacy uses timestamp. Prefer createdAt ordering,
      // but fall back to timestamp if needed (e.g. index/rules/schema differences).
      let querySnapshot;
      try {
        querySnapshot = await getDocs(query(interviewsRef, orderBy('createdAt', 'desc')));
      } catch {
        querySnapshot = await getDocs(query(interviewsRef, orderBy('timestamp', 'desc')));
      }
      
      const interviewsData: Interview[] = [];
      querySnapshot.forEach((doc) => {
        const data = doc.data();
        const createdAt: Date =
          data.createdAt?.toDate?.() ||
          data.timestamp?.toDate?.() ||
          new Date();
        const createdByName: string =
          data.createdByName ||
          data.submittedBy ||
          data.createdBy ||
          'Unknown';
        const createdByUid: string =
          data.createdByUid ||
          data.submittedById ||
          '';
        const score10: number | undefined =
          typeof data.score10 === 'number'
            ? data.score10
            : typeof data.score === 'number'
            ? data.score
            : undefined;

        const interviewKind =
          data.interviewKind === 'worker_ai_prescreen' ? 'worker_ai_prescreen' : undefined;
        const applicationId =
          typeof data.applicationId === 'string' || data.applicationId === null
            ? data.applicationId
            : undefined;
        const ai = parseInterviewAi(data.ai);

        const rawQs = Array.isArray(data.questions) ? data.questions : [];
        const questionsNorm: InterviewQuestion[] = rawQs.map((q: Record<string, unknown>) => ({
          id: String(q.id ?? ''),
          question: String(q.question ?? ''),
          type: (typeof q.type === 'string' ? q.type : 'text') as InterviewQuestion['type'],
          answer: typeof q.answer === 'string' ? q.answer : '',
          rawAnswer: q.answer,
        }));

        interviewsData.push({
          id: doc.id,
          createdByName,
          createdByUid,
          createdAt,
          questions: questionsNorm,
          notes: data.notes,
          score10,
          interviewKind,
          applicationId: applicationId ?? undefined,
          ai,
        });
      });
      
      setInterviews(interviewsData);
    } catch (error: any) {
      // Silently handle permission errors for lower-level users
      if (error?.code === 'permission-denied' || 
          error?.code === 'PERMISSION_DENIED' || 
          error?.message?.includes('Missing or insufficient permissions')) {
        setInterviews([]);
      } else {
        console.error('Error loading interviews:', error);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleQuestionChange = (id: string, value: string) => {
    setQuestions(prev => prev.map(q => {
      if (q.id === id) {
        return { ...q, answer: value };
      }
      return q;
    }));
  };

  const handleSubmitInterview = async () => {
    // Validate that at least some questions are answered
    const hasAnswers = questions.some(q => q.answer.trim() !== '');

    if (!hasAnswers) {
      setSuccessMessage('Please answer at least one interview question');
      setShowSuccess(true);
      return;
    }

    setLoading(true);
    try {
      const createdByName = submitterName || currentUser?.displayName || currentUser?.email || 'Unknown';
      const interviewData = {
        // Legacy fields (keep for backwards compatibility + rules)
        submittedBy: createdByName,
        submittedById: currentUser?.uid || '',
        timestamp: serverTimestamp(),
        score: score,

        // New schema (per spec)
        createdAt: serverTimestamp(),
        createdByUid: currentUser?.uid || '',
        createdByName,
        // optional future links
        jobId: null,
        assignmentId: null,
        companyId: null,
        questions: questions.map(q => ({
          id: q.id,
          question: q.question,
          answer: q.answer,
          type: q.type,
        })),
        notes: '',
        score10: score,
        isArchived: false,
      };

      const interviewsRef = collection(db, 'users', uid, 'interviews');
      await addDoc(interviewsRef, interviewData);

      // Update denormalized scoreSummary on the user doc (MVP: interviews only)
      try {
        const snap = await getDocs(query(interviewsRef));
        const scored = snap.docs
          .map((d) => d.data() as any)
          .filter((d) => d && d.isArchived !== true)
          .map((d) => (typeof d.score10 === 'number' ? d.score10 : typeof d.score === 'number' ? d.score : null))
          .filter((n): n is number => typeof n === 'number');
        const interviewCount = scored.length;
        const interviewAvg = interviewCount
          ? Math.round(((scored.reduce((a, b) => a + b, 0) / interviewCount) * 10)) / 10
          : undefined;
        // Also compute qualityScore so header "Score" reflects interviews + reviews.
        let qualityScore: number | null = null;
        let scoreSummary: any = {};
        try {
          const userSnap = await getDoc(doc(db, 'users', uid));
          scoreSummary = (userSnap.data() as any)?.scoreSummary || {};
          const reviewAvg = typeof scoreSummary?.reviewAvg === 'number' ? scoreSummary.reviewAvg : null;
          const hasInterview = typeof interviewAvg === 'number' && Number.isFinite(interviewAvg);
          const hasReview = typeof reviewAvg === 'number' && Number.isFinite(reviewAvg);
          if (hasInterview || hasReview) {
            const interviewScore100 = hasInterview ? (interviewAvg! / 10) * 100 : 0;
            const reviewScore100 = hasReview ? ((reviewAvg! - 1) / 4) * 100 : 0;
            const iw = hasInterview && hasReview ? 0.5 : hasInterview ? 1 : 0;
            const rw = hasInterview && hasReview ? 0.5 : hasReview ? 1 : 0;
            const raw = interviewScore100 * iw + reviewScore100 * rw;
            qualityScore = Math.round(Math.max(0, Math.min(100, raw)));
          }
        } catch {
          // non-fatal
        }

        // Recompute and persist AI score when quality (or other components) change
        const completeness = typeof scoreSummary?.completenessScore === 'number' ? scoreSummary.completenessScore : 0;
        const responsiveness = typeof scoreSummary?.responsivenessScore === 'number' ? scoreSummary.responsivenessScore : 50;
        const newAiScore = computeAiScoreFromComponents(completeness, responsiveness, qualityScore ?? undefined);

        // NOTE: use dot-path updates to avoid overwriting other scoreSummary fields (e.g. reviews)
        await updateDoc(doc(db, 'users', uid), {
          'scoreSummary.interviewAvg': interviewAvg ?? null,
          'scoreSummary.interviewCount': interviewCount,
          'scoreSummary.interviewLastAt': serverTimestamp(),
          'scoreSummary.interviewLastScore10': score,
          ...(qualityScore !== null ? { 'scoreSummary.qualityScore': qualityScore } : {}),
          ...(newAiScore !== null ? { 'scoreSummary.aiScore': newAiScore, 'scoreSummary.aiScoreUpdatedAt': serverTimestamp() } : {}),
        } as any);
      } catch {
        // non-fatal
      }

      // Reset form
      setQuestions(seedQuestionsFromTemplates());
      setScore(5);

      // Reload interviews
      await loadInterviews();

      setSuccessMessage('Interview submitted successfully');
      setShowSuccess(true);
    } catch (error: any) {
      console.error('Error submitting interview:', error);
      const code = error?.code ? String(error.code) : '';
      const msg = error?.message ? String(error.message) : '';
      setSuccessMessage(`Error submitting interview${code ? ` (${code})` : ''}${msg ? `: ${msg}` : ''}`);
      setShowSuccess(true);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  };

  const updateScoreSummaryFromInterviews = async (userId: string) => {
    const interviewsRef = collection(db, 'users', userId, 'interviews');
    let snap;
    try {
      snap = await getDocs(query(interviewsRef, orderBy('createdAt', 'desc')));
    } catch {
      snap = await getDocs(query(interviewsRef, orderBy('timestamp', 'desc')));
    }
    const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() } as any)).filter((d) => d && d.isArchived !== true);
    const scored = docs
      .map((d) => (typeof d.score10 === 'number' ? d.score10 : typeof d.score === 'number' ? d.score : null))
      .filter((n): n is number => typeof n === 'number');
    const interviewCount = docs.length;
    const interviewAvg = interviewCount
      ? Math.round((scored.reduce((a, b) => a + b, 0) / interviewCount) * 10) / 10
      : undefined;
    const lastInterview = docs[0];
    const lastAt = lastInterview?.createdAt?.toDate?.() ?? lastInterview?.timestamp?.toDate?.() ?? null;
    const lastScore10 = lastInterview != null && (typeof lastInterview.score10 === 'number' || typeof lastInterview.score === 'number')
      ? (typeof lastInterview.score10 === 'number' ? lastInterview.score10 : lastInterview.score)
      : null;
    let qualityScore: number | null = null;
    let scoreSummary: any = {};
    try {
      const userSnap = await getDoc(doc(db, 'users', userId));
      scoreSummary = (userSnap.data() as any)?.scoreSummary || {};
      const reviewAvg = typeof scoreSummary?.reviewAvg === 'number' ? scoreSummary.reviewAvg : null;
      const hasInterview = typeof interviewAvg === 'number' && Number.isFinite(interviewAvg);
      const hasReview = typeof reviewAvg === 'number' && Number.isFinite(reviewAvg);
      if (hasInterview || hasReview) {
        const interviewScore100 = hasInterview ? (interviewAvg! / 10) * 100 : 0;
        const reviewScore100 = hasReview ? ((reviewAvg! - 1) / 4) * 100 : 0;
        const iw = hasInterview && hasReview ? 0.5 : hasInterview ? 1 : 0;
        const rw = hasInterview && hasReview ? 0.5 : hasReview ? 1 : 0;
        const raw = interviewScore100 * iw + reviewScore100 * rw;
        qualityScore = Math.round(Math.max(0, Math.min(100, raw)));
      }
    } catch {
      // non-fatal
    }
    const completeness = typeof scoreSummary.completenessScore === 'number' ? scoreSummary.completenessScore : 0;
    const responsiveness = typeof scoreSummary.responsivenessScore === 'number' ? scoreSummary.responsivenessScore : 50;
    const newAiScore = qualityScore !== null ? computeAiScoreFromComponents(completeness, responsiveness, qualityScore) : null;
    await updateDoc(doc(db, 'users', userId), {
      'scoreSummary.interviewAvg': interviewAvg ?? null,
      'scoreSummary.interviewCount': interviewCount,
      'scoreSummary.interviewLastAt': lastAt ?? null,
      'scoreSummary.interviewLastScore10': lastScore10 ?? null,
      ...(qualityScore !== null ? { 'scoreSummary.qualityScore': qualityScore } : {}),
      ...(newAiScore !== null ? { 'scoreSummary.aiScore': newAiScore, 'scoreSummary.aiScoreUpdatedAt': serverTimestamp() } : {}),
    } as any);
  };

  const [deletingId, setDeletingId] = useState<string | null>(null);

  const latestWorkerAiPrescreen = useMemo(() => {
    const prescreens = interviews.filter((i) => i.interviewKind === 'worker_ai_prescreen');
    if (prescreens.length === 0) return null;
    return prescreens.reduce((latest, cur) =>
      cur.createdAt.getTime() > latest.createdAt.getTime() ? cur : latest,
    prescreens[0]);
  }, [interviews]);

  const handleDeleteInterview = async (e: React.MouseEvent, interviewId: string) => {
    e.stopPropagation();
    if (!uid || !window.confirm('Delete this interview? This cannot be undone.')) return;
    setDeletingId(interviewId);
    try {
      const interviewRef = doc(db, 'users', uid, 'interviews', interviewId);
      await deleteDoc(interviewRef);
      await updateScoreSummaryFromInterviews(uid);
      await loadInterviews();
      setSuccessMessage('Interview deleted');
      setShowSuccess(true);
    } catch (error: any) {
      console.error('Error deleting interview:', error);
      setSuccessMessage(error?.message || 'Failed to delete interview');
      setShowSuccess(true);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Card variant="outlined">
        <CardHeader
          title="Current category scores (worker profile)"
          subheader="Evolving scores on this worker profile — not the same as historical interview rows below."
          titleTypographyProps={{ variant: 'h6', fontWeight: 700 }}
          subheaderTypographyProps={{ variant: 'caption', color: 'text.secondary' }}
        />
        <CardContent sx={{ pt: 0 }}>
          {!profileScoresReady ? (
            <Typography variant="body2" color="text.secondary">
              Loading…
            </Typography>
          ) : profileCategoryScores ? (
            <RecruiterCategoryScoresPanel
              scores={profileCategoryScores}
              evidence={null}
              showHeading={false}
              scoreKind="profile_current"
            />
          ) : (
            <Typography variant="body2" color="text.secondary">
              No evolving profile scores yet. Category chips in the interview history table are historical interview
              snapshots.
            </Typography>
          )}
        </CardContent>
      </Card>

      {latestWorkerAiPrescreen?.ai && (
        <Card variant="outlined" sx={{ borderColor: 'secondary.light' }}>
          <CardHeader
            title={
              <Stack direction="row" alignItems="center" flexWrap="wrap" gap={1}>
                <Typography component="span" variant="h6" fontWeight={700}>
                  AI pre-screen
                </Typography>
                <Chip size="small" label="Worker AI" color="secondary" variant="outlined" />
                {latestWorkerAiPrescreen.applicationId ? (
                  <Chip size="small" label={`Application ${latestWorkerAiPrescreen.applicationId}`} variant="outlined" />
                ) : null}
              </Stack>
            }
            subheader={formatDate(latestWorkerAiPrescreen.createdAt)}
          />
          <CardContent sx={{ pt: 0 }}>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.5 }}>
              {WORKER_AI_INTERVIEW_REC_VS_HIRING_DECISION_HELP}
            </Typography>

            <Stack spacing={1.25} sx={{ mb: 1.5 }}>
              <Stack direction="row" flexWrap="wrap" gap={1} alignItems="center">
                <Typography variant="body2" color="text.secondary">
                  Score
                </Typography>
                <Typography variant="h6" fontWeight={700} color="primary">
                  {(typeof latestWorkerAiPrescreen.ai.overrideAdjustedScore === 'number'
                    ? latestWorkerAiPrescreen.ai.overrideAdjustedScore
                    : latestWorkerAiPrescreen.ai.overallScore) ?? '—'}
                  /100
                </Typography>
                {latestWorkerAiPrescreen.score10 !== undefined && (
                  <Chip size="small" label={`${latestWorkerAiPrescreen.score10}/10 (mapped)`} variant="outlined" />
                )}
              </Stack>
              {typeof latestWorkerAiPrescreen.ai.overrideAdjustedScore === 'number' &&
              typeof latestWorkerAiPrescreen.ai.baseInterviewScore === 'number' &&
              latestWorkerAiPrescreen.ai.overrideAdjustedScore !== latestWorkerAiPrescreen.ai.baseInterviewScore ? (
                <Typography variant="caption" color="text.secondary" display="block">
                  Base {latestWorkerAiPrescreen.ai.baseInterviewScore} → Adjusted {latestWorkerAiPrescreen.ai.overrideAdjustedScore}
                  {typeof latestWorkerAiPrescreen.ai.overrideScoreDelta === 'number'
                    ? ` (${latestWorkerAiPrescreen.ai.overrideScoreDelta >= 0 ? '+' : ''}${latestWorkerAiPrescreen.ai.overrideScoreDelta})`
                    : ''}
                  {latestWorkerAiPrescreen.ai.recruiterTrustLevel
                    ? ` · Trust: ${latestWorkerAiPrescreen.ai.recruiterTrustLevel}`
                    : ''}
                </Typography>
              ) : null}

              <Stack direction="row" flexWrap="wrap" gap={1} alignItems="center">
                <Typography variant="body2" color="text.secondary">
                  Interview recommendation
                </Typography>
                <Chip
                  size="small"
                  label={formatScoreRecommendationLabel(latestWorkerAiPrescreen.ai.recommendation)}
                  color={recommendationChipColor(latestWorkerAiPrescreen.ai.recommendation)}
                />
              </Stack>

              <Stack direction="row" flexWrap="wrap" gap={1} alignItems="center">
                <Typography variant="body2" color="text.secondary">
                  Hiring decision
                </Typography>
                {latestWorkerAiPrescreen.ai.hiringDecision ? (
                  <Chip
                    size="small"
                    label={formatHiringDecisionLabel(latestWorkerAiPrescreen.ai.hiringDecision.decision)}
                    color={hiringDecisionChipColor(latestWorkerAiPrescreen.ai.hiringDecision.decision)}
                    variant={hiringDecisionChipVariant(latestWorkerAiPrescreen.ai.hiringDecision.decision)}
                  />
                ) : (
                  <Chip size="small" label="Not evaluated" variant="outlined" />
                )}
                {latestWorkerAiPrescreen.ai.hiringDecision?.eligibleForAutoAdvance ? (
                  <Chip size="small" label="Eligible for auto-advance (rules)" color="info" variant="outlined" />
                ) : null}
              </Stack>
            </Stack>

            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
              {latestWorkerAiPrescreen.ai.hiringDecision
                ? explanationLineForHiringDecision({
                    decision: latestWorkerAiPrescreen.ai.hiringDecision.decision,
                    reasonCodes: latestWorkerAiPrescreen.ai.hiringDecision.reasonCodes,
                  })
                : 'Hiring decision has not been computed for this record yet.'}
            </Typography>

            {latestWorkerAiPrescreen.ai.hiringDecision && latestWorkerAiPrescreen.ai.hiringDecision.reasonCodes.length > 0 ? (
              <Stack direction="row" flexWrap="wrap" gap={0.5} sx={{ mb: 1.5 }}>
                {latestWorkerAiPrescreen.ai.hiringDecision.reasonCodes.map((code) => (
                  <Chip
                    key={code}
                    size="small"
                    label={labelForAiHiringReasonCode(code)}
                    variant="outlined"
                    color="default"
                  />
                ))}
              </Stack>
            ) : null}

            {latestWorkerAiPrescreen.ai.summary ? (
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5, whiteSpace: 'pre-wrap' }}>
                {latestWorkerAiPrescreen.ai.summary}
              </Typography>
            ) : null}

            {latestWorkerAiPrescreen.ai.flags.length > 0 ? (
              <Stack direction="row" flexWrap="wrap" gap={0.5} sx={{ mb: 1 }}>
                {latestWorkerAiPrescreen.ai.flags.map((f) => (
                  <Chip key={f} size="small" label={labelForInterviewFlag(f)} variant="outlined" />
                ))}
              </Stack>
            ) : (
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
                No risk flags
              </Typography>
            )}

            {(() => {
              const dyn = readDynamicAnswersFromAiContext(latestWorkerAiPrescreen.ai.aiInterviewContext);
              if (!dyn) return null;
              return (
                <Box sx={{ mb: 1 }}>
                  <Typography variant="caption" color="text.secondary" fontWeight={600} display="block" sx={{ mb: 0.5 }}>
                    Job-specific answers
                  </Typography>
                  <Stack spacing={0.25}>
                    {Object.entries(dyn).map(([k, v]) => (
                      <Typography key={k} variant="caption" color="text.secondary">
                        {labelForDynamicAnswerKey(k)}: <strong>{v}</strong>
                      </Typography>
                    ))}
                  </Stack>
                </Box>
              );
            })()}

            {(latestWorkerAiPrescreen.ai.hiringDecision?.reasonCodes.includes('gig_path_eligible') ||
              latestWorkerAiPrescreen.ai.alternatePaths?.gigEligible) && (
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
                Gig path may be available as an alternate path when the primary role is not a fit.
              </Typography>
            )}

            {latestWorkerAiPrescreen.applicationId ? (
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                Application ID: {latestWorkerAiPrescreen.applicationId}
              </Typography>
            ) : null}
          </CardContent>
        </Card>
      )}

      {/* Interview Form Card */}
      <Card variant="outlined">
        <CardHeader 
          title="Conduct Interview" 
          titleTypographyProps={{ variant: 'h6', fontWeight: 700 }}
        />
        <CardContent sx={{ p: { xs: 0, md: 1 } }}>
          <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 3 }}>
            Complete the interview form below. All answers will be saved and visible in the interview history.
          </Typography>
          
          <Grid container spacing={3}>
            {questions.map((question) => {
              const template = DEFAULT_INTERVIEW_QUESTION_TEMPLATES.find((t) => t.id === question.id);
              const rows = template?.multilineRows ?? 3;
              return (
                <Grid item xs={12} key={question.id}>
                  <TextField
                    label={question.question}
                    multiline
                    rows={rows}
                    fullWidth
                    value={question.answer}
                    onChange={(e) => handleQuestionChange(question.id, e.target.value)}
                    variant="outlined"
                    helperText={template?.helperText}
                  />
                </Grid>
              );
            })}

            {/* Applicant Score Slider */}
            <Grid item xs={12}>
              <Box sx={{ mt: 2, mb: 1 }}>
                <Typography variant="subtitle2" gutterBottom>
                  Applicant Score: {score}/10
                </Typography>
                <Slider
                  value={score}
                  onChange={(_, newValue) => setScore(newValue as number)}
                  min={0}
                  max={10}
                  step={1}
                  marks={[
                    { value: 0, label: '0' },
                    { value: 5, label: '5' },
                    { value: 10, label: '10' },
                  ]}
                  valueLabelDisplay="auto"
                />
              </Box>
            </Grid>

            <Grid item xs={12}>
              <Divider sx={{ my: 2 }} />
              <Button
                variant="contained"
                onClick={handleSubmitInterview}
                disabled={loading}
                startIcon={<AddIcon />}
                size="large"
                fullWidth
              >
                {loading ? 'Submitting Interview...' : 'Submit Interview'}
              </Button>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {/* Interviews History Card */}
      <Card variant="outlined">
        <CardHeader 
          title={`Interview History (${interviews.length})`}
          titleTypographyProps={{ variant: 'h6', fontWeight: 700 }}
        />
        <CardContent sx={{ p: { xs: 0, md: 1 } }}>
          {loading ? (
            <Typography>Loading interviews...</Typography>
          ) : interviews.length === 0 ? (
            <Typography color="text.secondary" sx={{ fontStyle: 'italic' }}>
              No interviews yet. Conduct the first interview using the form above.
            </Typography>
          ) : (
            <TableContainer component={Paper} variant="outlined">
              <Table>
                <TableHead>
                  <TableRow sx={{ bgcolor: 'grey.50' }}>
                    <TableCell sx={{ fontWeight: 600 }}>Date</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Source</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Completed By</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Score</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>
                      <Tooltip title="Interview recommendation (answer quality & scoring signals)">
                        <span>Interview rec.</span>
                      </Tooltip>
                    </TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>
                      <Tooltip title="Hiring decision (policy, capacity, thresholds, automation)">
                        <span>Hiring decision</span>
                      </Tooltip>
                    </TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Flags</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>
                      <Tooltip title="Historical interview snapshot (six 0–100 scores) from that interview record — not the evolving worker profile score.">
                        <span>Categories</span>
                      </Tooltip>
                    </TableCell>
                    <TableCell sx={{ fontWeight: 600 }} align="right">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {interviews.map((interview) => (
                    <TableRow 
                      key={interview.id}
                      hover
                      sx={{ 
                        cursor: 'pointer',
                        '&:hover': {
                          backgroundColor: 'action.hover'
                        }
                      }}
                      onClick={() => setViewInterviewDialog({ open: true, interview })}
                    >
                      <TableCell>
                        <Box display="flex" alignItems="center" gap={1}>
                          <ScheduleIcon fontSize="small" color="action" />
                          <Typography variant="body2">
                            {formatDate(interview.createdAt)}
                          </Typography>
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          label={interview.interviewKind === 'worker_ai_prescreen' ? 'Worker AI' : 'Recruiter'}
                          color={interview.interviewKind === 'worker_ai_prescreen' ? 'secondary' : 'default'}
                          variant="outlined"
                        />
                      </TableCell>
                      <TableCell>
                        <Box display="flex" alignItems="center" gap={1}>
                          <PersonIcon fontSize="small" color="action" />
                          <Typography variant="body2" fontWeight="medium">
                            {interview.createdByName}
                          </Typography>
                        </Box>
                      </TableCell>
                      <TableCell>
                        {interview.interviewKind === 'worker_ai_prescreen' && interview.ai ? (
                          <Box>
                            <Typography variant="body2" fontWeight={600} color="primary">
                              {typeof interview.ai.overrideAdjustedScore === 'number'
                                ? `${Math.round(interview.ai.overrideAdjustedScore)}/100`
                                : interview.score10 !== undefined
                                  ? `${interview.score10}/10`
                                  : 'N/A'}
                            </Typography>
                            {typeof interview.ai.overrideAdjustedScore === 'number' && interview.score10 !== undefined ? (
                              <Typography variant="caption" color="text.secondary" display="block">
                                Scale {interview.score10}/10
                              </Typography>
                            ) : null}
                          </Box>
                        ) : (
                          <Typography variant="body2" fontWeight={600} color="primary">
                            {interview.score10 !== undefined ? `${interview.score10}/10` : 'N/A'}
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" color="text.secondary">
                          {interview.interviewKind === 'worker_ai_prescreen' && interview.ai
                            ? formatScoreRecommendationLabel(interview.ai.recommendation)
                            : '—'}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" color="text.secondary">
                          {interview.interviewKind === 'worker_ai_prescreen' && interview.ai
                            ? interview.ai.hiringDecision
                              ? formatHiringDecisionLabel(interview.ai.hiringDecision.decision)
                              : 'Not evaluated'
                            : '—'}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 220 }} noWrap title={historyFlagsSummary(interview)}>
                          {historyFlagsSummary(interview)}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        {interview.interviewKind === 'worker_ai_prescreen' &&
                        interview.ai?.categoryScores ? (
                          <RecruiterCategoryScoresInlineChip
                            scores={interview.ai.categoryScores}
                            evidence={interview.ai.categoryEvidence ?? null}
                            scoreContext="interview_snapshot"
                          />
                        ) : (
                          <Typography variant="caption" color="text.secondary">
                            —
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                        <Tooltip title="Delete interview">
                          <IconButton
                            size="small"
                            color="error"
                            onClick={(e) => handleDeleteInterview(e, interview.id)}
                            disabled={deletingId === interview.id}
                            aria-label="Delete interview"
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </CardContent>
      </Card>

      {/* View Interview Dialog */}
      <Dialog
        open={viewInterviewDialog.open}
        onClose={() => setViewInterviewDialog({ open: false, interview: null })}
        maxWidth="md"
        fullWidth
        PaperProps={{
          sx: {
            maxHeight: '90vh',
          }
        }}
      >
        {viewInterviewDialog.interview && (
          <>
            <DialogTitle>
              <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={1}>
                <Typography variant="h6">Interview Details</Typography>
                <Typography variant="body2" color="text.secondary">
                  {formatDate(viewInterviewDialog.interview.createdAt)}
                </Typography>
              </Box>
            </DialogTitle>
            <DialogContent>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
                {/* A — Interview summary */}
                <Box>
                  <Typography variant="overline" color="text.secondary">
                    Interview summary
                  </Typography>
                  <Stack direction="row" flexWrap="wrap" spacing={1} alignItems="center" sx={{ mt: 0.5, mb: 1 }}>
                    <Chip
                      size="small"
                      label={interviewSourceLabel(viewInterviewDialog.interview.interviewKind)}
                      color={viewInterviewDialog.interview.interviewKind === 'worker_ai_prescreen' ? 'secondary' : 'default'}
                      variant="outlined"
                    />
                    {viewInterviewDialog.interview.score10 !== undefined ? (
                      <Chip size="small" variant="outlined" label={`Recorded ${viewInterviewDialog.interview.score10}/10`} />
                    ) : null}
                  </Stack>
                  <Box display="flex" alignItems="center" gap={1}>
                    <PersonIcon fontSize="small" color="action" />
                    <Typography variant="body2" fontWeight="medium">
                      Completed by {viewInterviewDialog.interview.createdByName}
                    </Typography>
                  </Box>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    {formatDate(viewInterviewDialog.interview.createdAt)}
                  </Typography>
                  {viewInterviewDialog.interview.applicationId ? (
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                      Application reference: {viewInterviewDialog.interview.applicationId}
                    </Typography>
                  ) : null}
                </Box>

                <Divider />

                {/* B — Decision summary + C — Why (worker AI) */}
                {viewInterviewDialog.interview.ai ? (
                  <>
                    {(() => {
                      const summary = buildRecruiterDecisionSummary({ ai: viewInterviewDialog.interview.ai! });
                      const ai = viewInterviewDialog.interview.ai!;
                      const plainWhy = ai.hiringDecision
                        ? explanationLineForHiringDecision({
                            decision: ai.hiringDecision.decision,
                            reasonCodes: ai.hiringDecision.reasonCodes,
                          })
                        : null;
                      return (
                        <>
                          <Box>
                            <Typography variant="overline" color="text.secondary">
                              Decision summary
                            </Typography>
                            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5, mb: 1 }}>
                              {WORKER_AI_INTERVIEW_REC_VS_HIRING_DECISION_HELP}
                            </Typography>
                            <Stack spacing={0.75} sx={{ mt: 0.5 }}>
                              <Typography variant="body2">
                                <strong>Interview score (base):</strong> {summary.baseScoreLabel}
                              </Typography>
                              <Typography variant="body2" color="primary">
                                <strong>Operational score (adjusted):</strong> {summary.adjustedScoreLabel}
                              </Typography>
                              <Typography variant="body2">
                                <strong>Recommendation:</strong> {summary.recommendationLabel}
                              </Typography>
                              <Typography variant="body2">
                                <strong>Hiring decision:</strong> {summary.hiringDecisionLabel}
                              </Typography>
                              <Typography variant="body2">
                                <strong>Auto-advance eligible:</strong> {summary.autoAdvanceLabel}
                              </Typography>
                              {summary.confidenceLabel ? (
                                <Typography variant="caption" color="text.secondary">
                                  {summary.confidenceLabel}
                                </Typography>
                              ) : null}
                              {plainWhy ? (
                                <Alert severity="info" sx={{ mt: 1 }}>
                                  {plainWhy}
                                </Alert>
                              ) : null}
                            </Stack>
                          </Box>

                          <Box>
                            <Typography variant="overline" color="text.secondary">
                              Why
                            </Typography>
                            <Typography variant="subtitle2" sx={{ mt: 1, fontWeight: 700 }}>
                              Strengths
                            </Typography>
                            <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'pre-wrap' }}>
                              {ai.summary ? ai.summary : 'No narrative summary stored for this interview.'}
                            </Typography>
                            <Typography variant="subtitle2" sx={{ mt: 1.5, fontWeight: 700 }}>
                              Risks / concerns
                            </Typography>
                            {ai.flags.length > 0 ? (
                              <Stack direction="row" flexWrap="wrap" gap={0.5} sx={{ mt: 0.5 }}>
                                {ai.flags.map((f) => (
                                  <Chip key={f} size="small" label={labelForInterviewFlag(f)} variant="outlined" />
                                ))}
                              </Stack>
                            ) : (
                              <Typography variant="body2" color="text.secondary">
                                None flagged.
                              </Typography>
                            )}
                            <Typography variant="subtitle2" sx={{ mt: 1.5, fontWeight: 700 }}>
                              Override / gate reasons
                            </Typography>
                            {(ai.hiringDecision?.reasonCodes?.length &&
                              ai.hiringDecision.reasonCodes.length > 0) ||
                            (ai.softBlocks ?? []).length ||
                            (ai.hardBlocks ?? []).length ? (
                              <Stack direction="row" flexWrap="wrap" gap={0.5} sx={{ mt: 0.5 }}>
                                {ai.hiringDecision?.reasonCodes?.map((code) => (
                                  <Chip key={code} size="small" label={labelForAiHiringReasonCode(code)} variant="outlined" />
                                ))}
                                {(ai.softBlocks ?? []).map((b) => (
                                  <Chip key={`s-${b}`} size="small" label={b.replace(/_/g, ' ')} variant="outlined" />
                                ))}
                                {(ai.hardBlocks ?? []).map((b) => (
                                  <Chip key={`h-${b}`} size="small" color="warning" label={b.replace(/_/g, ' ')} variant="outlined" />
                                ))}
                              </Stack>
                            ) : (
                              <Typography variant="body2" color="text.secondary">
                                None listed.
                              </Typography>
                            )}
                          </Box>
                        </>
                      );
                    })()}
                  </>
                ) : null}

                {/* D — Category snapshot */}
                {viewInterviewDialog.interview.ai?.categoryScores ? (
                  <Box>
                    <Typography variant="overline" color="text.secondary">
                      Category snapshot
                    </Typography>
                    <RecruiterCategoryScoresPanel
                      scores={viewInterviewDialog.interview.ai.categoryScores}
                      evidence={viewInterviewDialog.interview.ai.categoryEvidence ?? null}
                      scoreKind="interview_snapshot"
                      showHeading={false}
                      description={null}
                      collapsibleEvidence
                    />
                  </Box>
                ) : null}

                <Divider />

                {/* E — Answers */}
                <Box>
                  <Typography variant="overline" color="text.secondary">
                    Answers
                  </Typography>
                  <Stack spacing={2} sx={{ mt: 1 }}>
                    {viewInterviewDialog.interview.questions.map((q) => (
                      <Box key={q.id}>
                        <Typography variant="subtitle2" fontWeight={600} gutterBottom>
                          {q.question}
                        </Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'pre-wrap' }}>
                          {prescreenAnswerDisplayLine(q)}
                        </Typography>
                      </Box>
                    ))}
                  </Stack>
                </Box>
              </Box>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setViewInterviewDialog({ open: false, interview: null })}>
                Close
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>

      <Snackbar
        open={showSuccess}
        autoHideDuration={6000}
        onClose={() => setShowSuccess(false)}
      >
        <Alert onClose={() => setShowSuccess(false)} severity={successMessage.includes('Error') ? 'error' : 'success'}>
          {successMessage}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default InterviewTab;
