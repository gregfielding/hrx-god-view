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
  Collapse,
  Accordion,
  AccordionDetails,
  AccordionSummary,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
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
import { getRecruiterDecisionSummary } from '../../../utils/scoring/recruiterDecisionSummary';
import { parseWorkerInterviewAiBlock } from '../../../utils/scoring/parseWorkerInterviewAiBlock';
import { deriveScoreIntelligence } from '../../../utils/scoring/scoreIntelligence';
import type { ScoreIntelligenceInterviewInput } from '../../../utils/scoring/scoreIntelligence';
import { classifyScoreFreshness } from '../../../utils/scoring/scoreFreshness';
import ScoreProvenanceSummary from '../../../components/scoring/ScoreProvenanceSummary';
import type { ScoreSummary } from '../../../utils/scoreSummary';
import { formatPrescreenAnswerForRecruiter } from '../../../utils/scoring/prescreenAnswerDisplay';
import {
  RecruiterCategoryScoresInlineChip,
  RecruiterCategoryScoresPanel,
} from '../../../components/recruiter/RecruiterCategoryScoresReadOnly';
import { useCategoryScoresCurrent } from '../../../hooks/useCategoryScoresCurrent';
import {
  WorkerAiPrescreenInterviewCardContent,
  type WorkerAiPrescreenInterviewCardModel,
} from './WorkerAiPrescreenInterviewCardContent';

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
  interviewKind?: WorkerAiPrescreenInterviewKind | 'recruiter_live';
  applicationId?: string | null;
  ai?: WorkerInterviewAiBlock;
}

function interviewSourceLabel(kind: Interview['interviewKind']): string {
  return kind === 'worker_ai_prescreen' ? 'Worker AI pre-screen' : 'Recruiter (live)';
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
  scoreSummary?: ScoreSummary;
  scoreFreshnessMeta?: {
    userUpdatedAt?: unknown;
    categoryScoresCurrentUpdatedAt?: unknown;
    riskProfileLastUpdatedAt?: unknown;
    complianceTouchAt?: unknown;
  };
  /** Recruiter / internal view: show Overview scoring guidance and de-emphasize duplicate score blocks. */
  recruiterTrustUi?: boolean;
  /** Navigate to Overview tab where the primary Scoring card lives. */
  onOpenOverviewScore?: () => void;
}

function interviewDocToIntelInput(interview: Interview): ScoreIntelligenceInterviewInput | null {
  if (interview.interviewKind !== 'worker_ai_prescreen') return null;
  return {
    interviewKind: 'worker_ai_prescreen',
    score10: interview.score10,
    ai: interview.ai,
    questions: interview.questions.map((q) => ({
      id: q.id,
      answer: q.rawAnswer !== undefined ? q.rawAnswer : q.answer,
    })),
  };
}

function prescreenAnswerDisplayLine(q: InterviewQuestion): string {
  const raw = q.rawAnswer !== undefined ? q.rawAnswer : q.answer;
  const t = formatPrescreenAnswerForRecruiter(raw);
  if (t === '—' && (!q.answer || !String(q.answer).trim())) return 'No answer provided';
  return t;
}

const InterviewTab: React.FC<InterviewTabProps> = ({
  uid,
  scoreSummary,
  scoreFreshnessMeta,
  recruiterTrustUi,
  onOpenOverviewScore,
}) => {
  const { currentUser } = useAuth();
  const { scores: profileCategoryScores, userDocReady: profileScoresReady } = useCategoryScoresCurrent(uid);
  const [interviews, setInterviews] = useState<Interview[]>([]);
  const [loading, setLoading] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [viewInterviewDialog, setViewInterviewDialog] = useState<{ open: boolean; interview: Interview | null }>({ open: false, interview: null });
  const [interviewDevRawOpen, setInterviewDevRawOpen] = useState(false);
  const [interviewModalRawEvidenceOpen, setInterviewModalRawEvidenceOpen] = useState(false);
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
          data.interviewKind === 'worker_ai_prescreen'
            ? 'worker_ai_prescreen'
            : data.interviewKind === 'recruiter_live'
              ? 'recruiter_live'
              : undefined;
        const applicationId =
          typeof data.applicationId === 'string' || data.applicationId === null
            ? data.applicationId
            : undefined;
        const ai = parseWorkerInterviewAiBlock(data.ai);

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
        /** Distinguish from `worker_ai_prescreen` so scoreSummary proxy does not treat 5/10 as “50/100” hiring score. */
        interviewKind: 'recruiter_live' as const,
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
          'scoreSummary.interviewLastInterviewKind': 'recruiter_live',
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
    const lastInterviewKind =
      lastInterview != null && typeof (lastInterview as { interviewKind?: string }).interviewKind === 'string'
        ? String((lastInterview as { interviewKind?: string }).interviewKind)
        : null;
    await updateDoc(doc(db, 'users', userId), {
      'scoreSummary.interviewAvg': interviewAvg ?? null,
      'scoreSummary.interviewCount': interviewCount,
      'scoreSummary.interviewLastAt': lastAt ?? null,
      'scoreSummary.interviewLastScore10': lastScore10 ?? null,
      'scoreSummary.interviewLastInterviewKind': lastInterviewKind,
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

  const viewIntelInput = useMemo((): ScoreIntelligenceInterviewInput | null => {
    if (!viewInterviewDialog.open || !viewInterviewDialog.interview) return null;
    return interviewDocToIntelInput(viewInterviewDialog.interview);
  }, [viewInterviewDialog.open, viewInterviewDialog.interview]);

  const viewScoreIntelligence = useMemo(
    () => (viewIntelInput ? deriveScoreIntelligence(viewIntelInput, scoreSummary) : null),
    [viewIntelInput, scoreSummary],
  );

  const viewModalSummary = useMemo(() => {
    if (!viewInterviewDialog.interview?.ai) return null;
    return getRecruiterDecisionSummary({ ai: viewInterviewDialog.interview.ai, scoreSummary });
  }, [viewInterviewDialog.interview, scoreSummary]);

  const viewModalFreshness = useMemo(() => {
    if (!viewInterviewDialog.interview) return null;
    const iv = viewInterviewDialog.interview;
    return classifyScoreFreshness({
      interviewAt: iv.createdAt,
      interviewAiComputedAt: iv.ai?.computedAt,
      scoreSummaryAiUpdatedAt: scoreSummary?.aiScoreUpdatedAt,
      scoreSummaryHiringComputedAt: scoreSummary?.hiringScoreComputedAt,
      categoryScoresCurrentUpdatedAt: scoreFreshnessMeta?.categoryScoresCurrentUpdatedAt,
      riskProfileLastUpdatedAt: scoreFreshnessMeta?.riskProfileLastUpdatedAt,
      userUpdatedAt: scoreFreshnessMeta?.userUpdatedAt,
      complianceTouchAt: scoreFreshnessMeta?.complianceTouchAt,
    });
  }, [viewInterviewDialog.interview, scoreSummary, scoreFreshnessMeta]);

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
      {recruiterTrustUi && onOpenOverviewScore ? (
        <Alert severity="info" sx={{ alignItems: 'flex-start' }}>
          <Stack spacing={1}>
            <Typography variant="body2" fontWeight={600}>
              Scoring summary lives on the Overview tab
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Use this tab for raw interview answers, interview history, and full interview detail.
            </Typography>
            <Box>
              <Button variant="outlined" size="small" onClick={onOpenOverviewScore}>
                Open Overview score
              </Button>
            </Box>
          </Stack>
        </Alert>
      ) : null}

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

      {latestWorkerAiPrescreen?.ai &&
        (() => {
          const prescreenCardModel = latestWorkerAiPrescreen as WorkerAiPrescreenInterviewCardModel;
          return recruiterTrustUi ? (
          <Accordion
            defaultExpanded={false}
            disableGutters
            elevation={0}
            sx={{
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 1,
              bgcolor: 'background.paper',
              '&:before': { display: 'none' },
            }}
          >
            <AccordionSummary expandIcon={<ExpandMoreIcon fontSize="small" />} sx={{ px: 2 }}>
              <Stack spacing={0.25} sx={{ pr: 1 }}>
                <Typography variant="subtitle2" fontWeight={600}>
                  Interview-scoped scoring details
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Latest Worker AI pre-screen · {formatDate(latestWorkerAiPrescreen.createdAt)}
                </Typography>
              </Stack>
            </AccordionSummary>
            <AccordionDetails sx={{ px: 1, pt: 0 }}>
              <Card variant="outlined" sx={{ border: 'none', boxShadow: 'none' }}>
                <WorkerAiPrescreenInterviewCardContent
                  interview={prescreenCardModel}
                  demoted
                  formatDateFn={formatDate}
                />
              </Card>
            </AccordionDetails>
          </Accordion>
        ) : (
          <Card variant="outlined" sx={{ borderColor: 'secondary.light' }}>
            <WorkerAiPrescreenInterviewCardContent
              interview={prescreenCardModel}
              demoted={false}
              formatDateFn={formatDate}
            />
          </Card>
        );
        })()}

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
              <Stack spacing={0.5}>
                <Typography variant="overline" color="text.secondary">
                  {interviewSourceLabel(viewInterviewDialog.interview.interviewKind)}
                </Typography>
                <Typography variant="h6">Interview details</Typography>
                <Stack direction="row" alignItems="center" gap={1}>
                  <PersonIcon fontSize="small" color="action" />
                  <Typography variant="body2">
                    Completed by <strong>{viewInterviewDialog.interview.createdByName}</strong>
                  </Typography>
                </Stack>
                <Typography variant="body2" color="text.secondary">
                  {formatDate(viewInterviewDialog.interview.createdAt)}
                </Typography>
                {viewInterviewDialog.interview.applicationId ? (
                  <Typography variant="body2" color="text.secondary">
                    Application / job ref: {viewInterviewDialog.interview.applicationId}
                  </Typography>
                ) : null}
              </Stack>
            </DialogTitle>
            <DialogContent>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
                {viewInterviewDialog.interview.ai && viewModalSummary && viewScoreIntelligence ? (
                  <>
                    {/* 1 — Interview summary */}
                    <Box>
                      <Typography variant="overline" color="text.secondary">
                        Interview summary
                      </Typography>
                      {viewInterviewDialog.interview.ai.summary ? (
                        <Typography variant="body2" sx={{ mt: 1, whiteSpace: 'pre-wrap' }}>
                          {viewInterviewDialog.interview.ai.summary}
                        </Typography>
                      ) : null}
                      <Typography variant="subtitle2" sx={{ mt: 1.5, fontWeight: 700 }}>
                        Strengths
                      </Typography>
                      {viewScoreIntelligence.strengths.length > 0 ? (
                        <Stack component="ul" spacing={0.35} sx={{ m: 0, pl: 2, mt: 0.5 }}>
                          {viewScoreIntelligence.strengths.map((s) => (
                            <Typography key={s} component="li" variant="body2">
                              {s}
                            </Typography>
                          ))}
                        </Stack>
                      ) : (
                        <Typography variant="body2" color="text.secondary">
                          No strengths extracted.
                        </Typography>
                      )}
                      <Typography variant="subtitle2" sx={{ mt: 1.5, fontWeight: 700 }}>
                        Risks / review reasons
                      </Typography>
                      {viewScoreIntelligence.risks.length > 0 ? (
                        <Stack component="ul" spacing={0.35} sx={{ m: 0, pl: 2, mt: 0.5 }}>
                          {viewScoreIntelligence.risks.map((r) => (
                            <Typography key={r} component="li" variant="body2">
                              {r}
                            </Typography>
                          ))}
                        </Stack>
                      ) : (
                        <Typography variant="body2" color="text.secondary">
                          No structured risk lines — see flags on file if any.
                        </Typography>
                      )}
                      <Typography variant="subtitle2" sx={{ mt: 1.5, fontWeight: 700 }}>
                        Next recruiter step
                      </Typography>
                      {viewScoreIntelligence.improvements.length > 0 ? (
                        <Stack component="ul" spacing={0.35} sx={{ m: 0, pl: 2, mt: 0.5 }}>
                          {viewScoreIntelligence.improvements.map((x) => (
                            <Typography key={x} component="li" variant="body2">
                              {x}
                            </Typography>
                          ))}
                        </Stack>
                      ) : (
                        <Typography variant="body2" color="text.secondary">
                          Follow hiring decision and Score tab intelligence for next actions.
                        </Typography>
                      )}
                    </Box>

                    <Divider />

                    {/* 2 — Decision summary */}
                    <Box>
                      <Typography variant="overline" color="text.secondary">
                        Decision summary
                      </Typography>
                      <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5, mb: 1 }}>
                        {WORKER_AI_INTERVIEW_REC_VS_HIRING_DECISION_HELP}
                      </Typography>
                      <Stack spacing={0.75} sx={{ mt: 1 }}>
                        <Typography variant="body2">
                          <strong>Recommendation:</strong> {viewModalSummary.recommendationLabel}
                        </Typography>
                        <Typography variant="body2">
                          <strong>Hiring decision:</strong> {viewModalSummary.hiringDecisionLabel}
                        </Typography>
                        <Typography variant="body2">
                          <strong>Auto-advance eligible:</strong> {viewModalSummary.autoAdvanceLabel}
                        </Typography>
                        {viewModalSummary.autoAdvanceBlockedReasons.length > 0 ? (
                          <Alert severity="info" sx={{ mt: 0.5 }}>
                            <Typography variant="caption" fontWeight={700}>
                              Why not auto-advance?
                            </Typography>
                            <Stack component="ul" spacing={0.25} sx={{ m: 0, mt: 0.5, pl: 2 }}>
                              {viewModalSummary.autoAdvanceBlockedReasons.map((line) => (
                                <Typography key={line} component="li" variant="body2">
                                  {line}
                                </Typography>
                              ))}
                            </Stack>
                          </Alert>
                        ) : null}
                        {viewModalSummary.confidenceLabel ? (
                          <Typography variant="caption" color="text.secondary">
                            {viewModalSummary.confidenceLabel}
                          </Typography>
                        ) : null}
                      </Stack>
                      {viewModalSummary.adjustmentSummaryLines.length > 0 ? (
                        <Box sx={{ mt: 1.5 }}>
                          <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 0.5 }}>
                            Adjustment summary
                          </Typography>
                          <Stack component="ul" spacing={0.25} sx={{ m: 0, pl: 2 }}>
                            {viewModalSummary.adjustmentSummaryLines.map((line) => (
                              <Typography key={line} component="li" variant="body2">
                                {line}
                              </Typography>
                            ))}
                          </Stack>
                        </Box>
                      ) : null}
                      {viewInterviewDialog.interview.ai.hiringDecision
                        ? (() => {
                            const line = explanationLineForHiringDecision({
                              decision: viewInterviewDialog.interview.ai!.hiringDecision!.decision,
                              reasonCodes: viewInterviewDialog.interview.ai!.hiringDecision!.reasonCodes,
                            });
                            return line ? (
                              <Alert severity="info" sx={{ mt: 1 }} variant="outlined">
                                {line}
                              </Alert>
                            ) : null;
                          })()
                        : null}
                    </Box>

                    <Divider />

                    {/* 3 — Score source */}
                    <Box>
                      <Typography variant="overline" color="text.secondary">
                        Score source
                      </Typography>
                      <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5, mb: 1 }}>
                        Operational score is the primary recruiter signal for this pre-screen; profile/composite is
                        secondary when shown.
                      </Typography>
                      <ScoreProvenanceSummary
                        operationalScore100={viewScoreIntelligence.summary.operationalScore}
                        interviewScore100={viewScoreIntelligence.summary.interviewScore}
                        profileComposite100={viewScoreIntelligence.summary.compositeHiringScore100}
                        showComposite={Boolean(viewScoreIntelligence.summary.compositeHiringScoreLabel)}
                        decisionSourceLabel={viewScoreIntelligence.summary.decisionSourceLabel}
                        lastUpdatedLabel={viewScoreIntelligence.summary.lastUpdatedLabel}
                        correctionApplied={viewScoreIntelligence.summary.correctionAppliedDisplay}
                      />
                      {viewModalFreshness ? (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                          Score freshness: <strong>{viewModalFreshness.headline}</strong>
                          {viewModalFreshness.interviewHistoricalHint
                            ? ` · ${viewModalFreshness.interviewHistoricalHint}`
                            : ''}
                        </Typography>
                      ) : null}
                    </Box>
                  </>
                ) : null}

                {/* 4 — Category snapshot */}
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

                {/* 5 — Interview answers */}
                <Box>
                  <Typography variant="overline" color="text.secondary">
                    Interview answers
                  </Typography>
                  <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
                    Historical responses — supporting detail for the summary above.
                  </Typography>
                  <Stack spacing={2} sx={{ mt: 0.5 }}>
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

                {/* 6 — Raw category evidence (collapsed) */}
                {viewInterviewDialog.interview.ai?.categoryEvidence ? (
                  <Box>
                    <Button
                      size="small"
                      onClick={() => setInterviewModalRawEvidenceOpen((v) => !v)}
                      variant="outlined"
                    >
                      {interviewModalRawEvidenceOpen ? 'Hide' : 'Show'} raw category evidence
                    </Button>
                    <Collapse in={interviewModalRawEvidenceOpen}>
                      <Box
                        sx={{
                          mt: 1,
                          p: 1,
                          borderRadius: 1,
                          bgcolor: 'action.hover',
                          maxHeight: 240,
                          overflow: 'auto',
                        }}
                      >
                        <Typography component="pre" variant="caption" sx={{ whiteSpace: 'pre-wrap', m: 0 }}>
                          {JSON.stringify(viewInterviewDialog.interview.ai.categoryEvidence, null, 2)}
                        </Typography>
                      </Box>
                    </Collapse>
                  </Box>
                ) : null}

                {/* 7 — Dev raw JSON */}
                {process.env.NODE_ENV === 'development' && viewInterviewDialog.interview.ai ? (
                  <Box>
                    <Button size="small" onClick={() => setInterviewDevRawOpen((v) => !v)} variant="outlined">
                      {interviewDevRawOpen ? 'Hide' : 'Show'} raw interview AI (dev)
                    </Button>
                    <Collapse in={interviewDevRawOpen}>
                      <Box
                        sx={{
                          mt: 1,
                          p: 1,
                          borderRadius: 1,
                          bgcolor: 'action.hover',
                          maxHeight: 280,
                          overflow: 'auto',
                        }}
                      >
                        <Typography component="pre" variant="caption" sx={{ whiteSpace: 'pre-wrap', m: 0 }}>
                          {JSON.stringify(viewInterviewDialog.interview.ai, null, 2)}
                        </Typography>
                      </Box>
                    </Collapse>
                  </Box>
                ) : null}
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
