/**
 * Worker AI pre-screen — saves to users/{uid}/interviews via submitWorkerAiPrescreenInterview callable.
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  FormControl,
  FormControlLabel,
  LinearProgress,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../../contexts/AuthContext';
import WorkerQuickNav from '../../../components/worker/WorkerQuickNav';
import {
  WORKER_AI_PRESCREEN_STEPS,
  type WorkerAiPrescreenStep,
} from '../../../constants/workerAiPrescreenQuestions';
import { submitWorkerAiPrescreenInterview } from '../../../services/workerAiPrescreenCallable';
import { formatFirebaseHttpsError } from '../../../utils/firebaseHttpsErrors';
import type { WorkerAiPrescreenAnswers } from '../../../utils/workerAiPrescreenScore';

function emptyAnswers(): WorkerAiPrescreenAnswers {
  return {
    motivation: '',
    similar_experience: '',
    experience_details: '',
    work_confidence: [],
    attendance_issues: '',
    attendance_explanation: '',
    transportation_plan: '',
    backup_transportation: '',
    physical_comfort: '',
    drug_screen: '',
    background_check: '',
    supervisor_feedback: '',
    additional_notes: '',
  };
}

function stepValid(step: WorkerAiPrescreenStep, a: WorkerAiPrescreenAnswers): boolean {
  switch (step.type) {
    case 'text': {
      const v = String((a as Record<string, unknown>)[step.id] ?? '').trim();
      if (step.id === 'motivation' || step.id === 'supervisor_feedback') return v.length >= 2;
      return true;
    }
    case 'single_select': {
      const v = String((a as Record<string, unknown>)[step.id] ?? '').trim();
      return v.length > 0;
    }
    case 'multi_select': {
      const arr = a.work_confidence || [];
      return arr.length > 0;
    }
    default:
      return true;
  }
}

const WorkerAiPrescreenPage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const applicationId = searchParams.get('applicationId');

  const [stepIndex, setStepIndex] = useState(0);
  const [answers, setAnswers] = useState<WorkerAiPrescreenAnswers>(() => emptyAnswers());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const total = WORKER_AI_PRESCREEN_STEPS.length;
  const step = WORKER_AI_PRESCREEN_STEPS[stepIndex];
  const progress = ((stepIndex + 1) / total) * 100;

  const setText = useCallback((id: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [id]: value }));
  }, []);

  const toggleMulti = useCallback((value: string) => {
    setAnswers((prev) => {
      const cur = new Set(prev.work_confidence || []);
      if (cur.has(value)) cur.delete(value);
      else cur.add(value);
      return { ...prev, work_confidence: Array.from(cur) };
    });
  }, []);

  const canNext = useMemo(() => stepValid(step, answers), [step, answers]);

  const goNext = () => {
    if (!canNext) return;
    if (stepIndex < total - 1) setStepIndex((i) => i + 1);
  };

  const goBack = () => {
    setError(null);
    if (stepIndex > 0) setStepIndex((i) => i - 1);
  };

  const handleSubmit = async () => {
    if (!user?.uid) return;
    if (!canNext) return;
    setSubmitting(true);
    setError(null);
    try {
      await submitWorkerAiPrescreenInterview({
        answers,
        applicationId: applicationId || null,
      });
      setDone(true);
    } catch (e) {
      setError(formatFirebaseHttpsError(e) || 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!user) {
    return (
      <Box sx={{ p: 2 }}>
        <Typography variant="body1">Sign in to complete the pre-screen questionnaire.</Typography>
        <Button sx={{ mt: 2 }} variant="contained" onClick={() => navigate('/c1/workers/dashboard')}>
          Back to dashboard
        </Button>
      </Box>
    );
  }

  if (done) {
    return (
      <Box sx={{ p: 2, maxWidth: 560, mx: 'auto' }}>
        <WorkerQuickNav />
        <Alert severity="success" sx={{ mt: 2 }}>
          <Typography variant="subtitle1" fontWeight={700} gutterBottom>
            Thank you
          </Typography>
          <Typography variant="body2">
            Your responses were submitted. Our team will review them and follow up shortly if needed.
          </Typography>
        </Alert>
        <Button fullWidth variant="contained" sx={{ mt: 2 }} onClick={() => navigate('/c1/workers/dashboard')}>
          Back to dashboard
        </Button>
      </Box>
    );
  }

  const isLast = stepIndex === total - 1;

  return (
    <Box sx={{ p: 2, pb: 10, maxWidth: 560, mx: 'auto' }}>
      <WorkerQuickNav />
      <Typography variant="h6" fontWeight={700} sx={{ mt: 1 }}>
        Quick pre-screen
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        A few questions to help us match you with the right opportunities. This takes about 5 minutes.
      </Typography>
      <LinearProgress variant="determinate" value={progress} sx={{ mb: 2, borderRadius: 1 }} />
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 2 }}>
        Question {stepIndex + 1} of {total}
      </Typography>

      {error ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      ) : null}

      <Box sx={{ minHeight: 220 }}>
        <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 2 }}>
          {step.prompt}
        </Typography>

        {step.type === 'text' && (
          <TextField
            fullWidth
            multiline
            minRows={step.id === 'motivation' || step.id === 'additional_notes' ? 4 : 3}
            value={String((answers as Record<string, string>)[step.id] ?? '')}
            onChange={(e) => setText(step.id, e.target.value)}
            placeholder="Your answer"
          />
        )}

        {step.type === 'single_select' && step.options && (
          <FormControl component="fieldset" fullWidth>
            <RadioGroup
              value={String((answers as Record<string, string>)[step.id] ?? '')}
              onChange={(_, v) => setText(step.id, v)}
            >
              {step.options.map((o) => (
                <FormControlLabel key={o.value} value={o.value} control={<Radio />} label={o.label} />
              ))}
            </RadioGroup>
          </FormControl>
        )}

        {step.type === 'multi_select' && step.options && (
          <Stack spacing={1}>
            {step.options.map((o) => (
              <FormControlLabel
                key={o.value}
                control={
                  <Checkbox
                    checked={(answers.work_confidence || []).includes(o.value)}
                    onChange={() => toggleMulti(o.value)}
                  />
                }
                label={o.label}
              />
            ))}
            {(answers.work_confidence || []).length > 0 && (
              <Stack direction="row" gap={0.5} flexWrap="wrap" sx={{ mt: 1 }}>
                {(answers.work_confidence || []).map((v) => (
                  <Chip key={v} size="small" label={step.options!.find((x) => x.value === v)?.label || v} />
                ))}
              </Stack>
            )}
          </Stack>
        )}
      </Box>

      <Stack direction="row" spacing={1} sx={{ mt: 3 }}>
        <Button variant="outlined" onClick={goBack} disabled={stepIndex === 0 || submitting} fullWidth>
          Back
        </Button>
        {!isLast ? (
          <Button variant="contained" onClick={goNext} disabled={!canNext || submitting} fullWidth>
            Next
          </Button>
        ) : (
          <Button
            variant="contained"
            onClick={() => void handleSubmit()}
            disabled={!canNext || submitting}
            fullWidth
          >
            {submitting ? <CircularProgress size={22} color="inherit" /> : 'Submit'}
          </Button>
        )}
      </Stack>
    </Box>
  );
};

export default WorkerAiPrescreenPage;
