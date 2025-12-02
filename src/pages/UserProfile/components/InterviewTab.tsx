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
} from '@mui/material';
import {
  Add as AddIcon,
  Schedule as ScheduleIcon,
  Person as PersonIcon,
} from '@mui/icons-material';
import { doc, collection, addDoc, getDocs, query, orderBy, serverTimestamp, getDoc } from 'firebase/firestore';

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
  submittedBy: string;
  submittedById: string;
  timestamp: Date;
  questions: InterviewQuestion[];
  notes?: string;
  score?: number;
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
      const q = query(interviewsRef, orderBy('timestamp', 'desc'));
      const querySnapshot = await getDocs(q);
      
      const interviewsData: Interview[] = [];
      querySnapshot.forEach((doc) => {
        const data = doc.data();
        interviewsData.push({
          id: doc.id,
          ...data,
          timestamp: data.timestamp?.toDate() || new Date(),
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
      const interviewData = {
        submittedBy: submitterName || currentUser?.displayName || currentUser?.email || 'Unknown',
        submittedById: currentUser?.uid || '',
        timestamp: serverTimestamp(),
        questions: questions.map(q => ({
          id: q.id,
          question: q.question,
          answer: q.answer,
          type: q.type,
        })),
        score: score,
      };

      const interviewsRef = collection(db, 'users', uid, 'interviews');
      await addDoc(interviewsRef, interviewData);

      // Reset form
      setQuestions(defaultQuestions.map(q => ({ ...q })));
      setScore(5);

      // Reload interviews
      await loadInterviews();

      setSuccessMessage('Interview submitted successfully');
      setShowSuccess(true);
    } catch (error) {
      console.error('Error submitting interview:', error);
      setSuccessMessage('Error submitting interview');
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

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {/* Interview Form Card */}
      <Card variant="outlined">
        <CardHeader 
          title="Conduct Interview" 
          titleTypographyProps={{ variant: 'h6', fontWeight: 700 }}
        />
        <CardContent sx={{ p: { xs: 2, md: 3 } }}>
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
        <CardContent sx={{ p: { xs: 2, md: 3 } }}>
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
                            {formatDate(interview.timestamp)}
                          </Typography>
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Box display="flex" alignItems="center" gap={1}>
                          <PersonIcon fontSize="small" color="action" />
                          <Typography variant="body2" fontWeight="medium">
                            {interview.submittedBy}
                          </Typography>
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" fontWeight={600} color="primary">
                          {interview.score !== undefined ? `${interview.score}/10` : 'N/A'}
                        </Typography>
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
                  {formatDate(viewInterviewDialog.interview.timestamp)}
                </Typography>
              </Box>
            </DialogTitle>
            <DialogContent>
              <Box mb={2}>
                <Box display="flex" alignItems="center" gap={1} mb={2}>
                  <PersonIcon fontSize="small" color="action" />
                  <Typography variant="body2" fontWeight="medium">
                    Conducted by: {viewInterviewDialog.interview.submittedBy}
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
                {viewInterviewDialog.interview.score !== undefined && (
                  <>
                    <Divider sx={{ my: 2 }} />
                    <Box>
                      <Typography variant="subtitle2" fontWeight={600} gutterBottom>
                        Applicant Score
                      </Typography>
                      <Typography variant="h5" color="primary" fontWeight={700}>
                        {viewInterviewDialog.interview.score}/10
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
