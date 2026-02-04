import React, { useState, useEffect } from 'react';
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
} from '@mui/material';
import {
  Add as AddIcon,
  Schedule as ScheduleIcon,
  Person as PersonIcon,
  Delete as DeleteIcon,
} from '@mui/icons-material';
import { doc, collection, addDoc, getDocs, query, orderBy, serverTimestamp, getDoc, updateDoc, deleteDoc } from 'firebase/firestore';

import { db } from '../../../firebase';
import { useAuth } from '../../../contexts/AuthContext';

interface InterviewQuestion {
  id: string;
  question: string;
  answer: string;
  type: 'text';
}

interface Interview {
  id: string;
  createdByName: string;
  createdByUid: string;
  createdAt: Date;
  questions: InterviewQuestion[];
  notes?: string;
  score10?: number;
}

interface InterviewTabProps {
  uid: string;
}

const InterviewTab: React.FC<InterviewTabProps> = ({ uid }) => {
  const { currentUser } = useAuth();
  const [interviews, setInterviews] = useState<Interview[]>([]);
  const [loading, setLoading] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [viewInterviewDialog, setViewInterviewDialog] = useState<{ open: boolean; interview: Interview | null }>({ open: false, interview: null });
  const [submitterName, setSubmitterName] = useState<string>('');
  const [score, setScore] = useState<number>(5);

  // Default interview questions
  const defaultQuestions: InterviewQuestion[] = [
    { id: '1', question: 'Why are you interested in this position?', answer: '', type: 'text' },
    { id: '2', question: 'What relevant experience do you have?', answer: '', type: 'text' },
    { id: '3', question: 'What are your greatest strengths?', answer: '', type: 'text' },
    { id: '4', question: 'Are you able to work the required hours/shift?', answer: '', type: 'text' },
    { id: '5', question: 'How are you planning on getting to work?', answer: '', type: 'text' },
    { id: '6', question: 'Are you confident you would pass a drug screening?', answer: '', type: 'text' },
    { id: '7', question: 'Is there anything in your background that might come up in a background screening?', answer: '', type: 'text' },
    { id: '8', question: 'Additional Notes', answer: '', type: 'text' },
  ];

  const [questions, setQuestions] = useState<InterviewQuestion[]>(defaultQuestions.map(q => ({ ...q })));

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

        interviewsData.push({
          id: doc.id,
          createdByName,
          createdByUid,
          createdAt,
          questions: Array.isArray(data.questions) ? data.questions : [],
          notes: data.notes,
          score10,
        } as Interview);
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
        try {
          const userSnap = await getDoc(doc(db, 'users', uid));
          const ss = (userSnap.data() as any)?.scoreSummary || {};
          const reviewAvg = typeof ss?.reviewAvg === 'number' ? ss.reviewAvg : null;
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

        // NOTE: use dot-path updates to avoid overwriting other scoreSummary fields (e.g. reviews)
        await updateDoc(doc(db, 'users', uid), {
          'scoreSummary.interviewAvg': interviewAvg ?? null,
          'scoreSummary.interviewCount': interviewCount,
          'scoreSummary.interviewLastAt': serverTimestamp(),
          'scoreSummary.interviewLastScore10': score,
          ...(qualityScore !== null ? { 'scoreSummary.qualityScore': qualityScore } : {}),
        } as any);
      } catch {
        // non-fatal
      }

      // Reset form
      setQuestions(defaultQuestions.map(q => ({ ...q })));
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
    try {
      const userSnap = await getDoc(doc(db, 'users', userId));
      const ss = (userSnap.data() as any)?.scoreSummary || {};
      const reviewAvg = typeof ss?.reviewAvg === 'number' ? ss.reviewAvg : null;
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
    await updateDoc(doc(db, 'users', userId), {
      'scoreSummary.interviewAvg': interviewAvg ?? null,
      'scoreSummary.interviewCount': interviewCount,
      'scoreSummary.interviewLastAt': lastAt ?? null,
      'scoreSummary.interviewLastScore10': lastScore10 ?? null,
      ...(qualityScore !== null ? { 'scoreSummary.qualityScore': qualityScore } : {}),
    } as any);
  };

  const [deletingId, setDeletingId] = useState<string | null>(null);
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
            {questions.map((question) => (
              <Grid item xs={12} key={question.id}>
                <TextField
                  label={question.question}
                  multiline
                  rows={question.id === '8' ? 4 : 3}
                  fullWidth
                  value={question.answer}
                  onChange={(e) => handleQuestionChange(question.id, e.target.value)}
                  variant="outlined"
                />
              </Grid>
            ))}

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
                    <TableCell sx={{ fontWeight: 600 }}>Completed By</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Score</TableCell>
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
                        <Box display="flex" alignItems="center" gap={1}>
                          <PersonIcon fontSize="small" color="action" />
                          <Typography variant="body2" fontWeight="medium">
                            {interview.createdByName}
                          </Typography>
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" fontWeight={600} color="primary">
                          {interview.score10 !== undefined ? `${interview.score10}/10` : 'N/A'}
                        </Typography>
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
              <Box display="flex" justifyContent="space-between" alignItems="center">
                <Typography variant="h6">Interview Details</Typography>
                <Typography variant="body2" color="text.secondary">
                  {formatDate(viewInterviewDialog.interview.createdAt)}
                </Typography>
              </Box>
            </DialogTitle>
            <DialogContent>
              <Box mb={2}>
                <Box display="flex" alignItems="center" gap={1} mb={2}>
                  <PersonIcon fontSize="small" color="action" />
                  <Typography variant="body2" fontWeight="medium">
                    Conducted by: {viewInterviewDialog.interview.createdByName}
                  </Typography>
                </Box>
                <Divider />
              </Box>

              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {viewInterviewDialog.interview.questions.map((q) => (
                  <Box key={q.id}>
                    <Typography variant="subtitle2" fontWeight={600} gutterBottom>
                      {q.question}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'pre-wrap' }}>
                      {q.answer || 'No answer provided'}
                    </Typography>
                    {q.id !== viewInterviewDialog.interview!.questions[viewInterviewDialog.interview!.questions.length - 1].id && (
                      <Divider sx={{ mt: 2 }} />
                    )}
                  </Box>
                ))}
                
                {/* Display Score in Dialog */}
                {viewInterviewDialog.interview.score10 !== undefined && (
                  <>
                    <Divider sx={{ my: 2 }} />
                    <Box>
                      <Typography variant="subtitle2" fontWeight={600} gutterBottom>
                        Applicant Score
                      </Typography>
                      <Typography variant="h5" color="primary" fontWeight={700}>
                        {viewInterviewDialog.interview.score10}/10
                      </Typography>
                    </Box>
                  </>
                )}
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
