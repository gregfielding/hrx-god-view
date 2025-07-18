import React, { useState, useEffect } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../../firebase';
import {
  Box,
  Paper,
  Typography,
  Button,
  TextField,
  Checkbox,
  FormControlLabel,
  Grid,
  IconButton,
  Chip,
  LinearProgress,
  Card,
  CardContent,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import { useNavigate } from 'react-router-dom';

const FeedbackEngine: React.FC = () => {
  const [campaignName, setCampaignName] = useState('');
  const [audience, setAudience] = useState('');
  const [promptSet, setPromptSet] = useState([{ prompt: '', type: 'text' }]);
  const [scoring, setScoring] = useState(false);
  const [managerAccess, setManagerAccess] = useState(false);
  const [managerAccessOptIn, setManagerAccessOptIn] = useState(false);
  const [followUpOptIn, setFollowUpOptIn] = useState(false);
  const [aiFollowUp, setAIFollowUp] = useState(false);
  const [phase2, setPhase2] = useState(false);
  const [anonymity, setAnonymity] = useState(false);
  const [hrReviewOnly, setHRReviewOnly] = useState(false);
  const [isTemplate, setIsTemplate] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [recurrence, setRecurrence] = useState('');
  const [reminderInterval, setReminderInterval] = useState('');
  const [activeCampaigns, setActiveCampaigns] = useState<any[]>([]);
  const [showPromptBank, setShowPromptBank] = useState(false);
  const [showAIPrompt, setShowAIPrompt] = useState(false);
  const [aiPromptTopic, setAIPromptTopic] = useState('');
  const [aiPromptSuggestions, setAIPromptSuggestions] = useState<string[]>([]);
  const [aiPromptLoading, setAIPromptLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [promptAddedMsg, setPromptAddedMsg] = useState('');
  const [selectedCampaign, setSelectedCampaign] = useState<string>('');
  const [aiSummary, setAISummary] = useState<any>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const navigate = useNavigate();

  // Fetch active campaigns on mount
  useEffect(() => {
    const fetchCampaigns = async () => {
      try {
        const functions = getFunctions(app, 'us-central1');
        const getCampaigns = httpsCallable(functions, 'listFeedbackCampaigns');
        const res: any = await getCampaigns();
        setActiveCampaigns(res.data.campaigns || []);
      } catch (err: any) {
        // Ignore for now
      }
    };
    fetchCampaigns();
  }, []);

  // Fetch AI summary when campaign is selected
  useEffect(() => {
    if (selectedCampaign) {
      fetchAISummary(selectedCampaign);
    }
  }, [selectedCampaign]);

  const fetchAISummary = async (campaignId: string) => {
    setSummaryLoading(true);
    try {
      const functions = getFunctions(app, 'us-central1');
      const getSummary = httpsCallable(functions, 'getFeedbackAISummary');
      const res: any = await getSummary({ campaignId });
      setAISummary(res.data);
    } catch (err: any) {
      console.error('Error fetching AI summary:', err);
      setAISummary({
        summary: 'Error loading analysis.',
        keyThemes: [],
        sentimentTrend: [],
        actionableInsights: [],
        responseCount: 0,
        avgSentiment: 0,
      });
    }
    setSummaryLoading(false);
  };

  const handleCreateCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    setSuccessMsg('');
    setErrorMsg('');
    try {
      const functions = getFunctions(app, 'us-central1');
      const createCampaign = httpsCallable(functions, 'createFeedbackCampaign');
      const data = {
        name: campaignName,
        audience,
        promptSet,
        scoring,
        managerAccess,
        managerAccessOptIn,
        followUpLogic: { optIn: followUpOptIn, aiFollowUp, phase2 },
        anonymity,
        hrReviewOnly,
        isTemplate,
        templateName,
        startDate,
        endDate,
        recurrence,
        reminderInterval,
      };
      await createCampaign(data);
      setSuccessMsg('Campaign created!');
      setCampaignName('');
      setAudience('');
      setPromptSet([{ prompt: '', type: 'text' }]);
      setScoring(false);
      setManagerAccess(false);
      setManagerAccessOptIn(false);
      setFollowUpOptIn(false);
      setAIFollowUp(false);
      setPhase2(false);
      setAnonymity(false);
      setHRReviewOnly(false);
      setIsTemplate(false);
      setTemplateName('');
      setStartDate('');
      setEndDate('');
      setRecurrence('');
      setReminderInterval('');
      // Optionally refetch campaigns
    } catch (err: any) {
      setErrorMsg(err.message || 'Error creating campaign');
    }
  };

  const handleAIGeneratePrompts = async () => {
    setAIPromptSuggestions([]);
    setAIPromptLoading(true);
    try {
      const functions = getFunctions(app, 'us-central1');
      const generatePrompts = httpsCallable(functions, 'generateFeedbackPrompts');
      const res: any = await generatePrompts({ topic: aiPromptTopic });
      const suggestions = (res.data.prompts || '').split(/\n|\r/).filter((s: string) => s.trim());
      setAIPromptSuggestions(suggestions);
    } catch (err: any) {
      setAIPromptSuggestions(['Error generating prompts.']);
    }
    setAIPromptLoading(false);
  };

  const getSentimentColor = (sentiment: number) => {
    if (sentiment >= 0.3) return '#4caf50';
    if (sentiment >= -0.3) return '#ff9800';
    return '#f44336';
  };

  const getSentimentIcon = (sentiment: number) => {
    if (sentiment >= 0.3) return <TrendingUpIcon sx={{ color: '#4caf50' }} />;
    if (sentiment >= -0.3) return <TrendingUpIcon sx={{ color: '#ff9800' }} />;
    return <TrendingDownIcon sx={{ color: '#f44336' }} />;
  };

  return (
    <Box sx={{ p: 0, bgcolor: 'background.default', minHeight: '100vh' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Box>
          <Typography variant="h3" color="text.primary" gutterBottom>
            Feedback Engine
          </Typography>
          <Typography variant="subtitle1" color="text.secondary">
            Launch targeted, AI-powered feedback campaigns for workers and teams.
          </Typography>
        </Box>
        <Button
          variant="outlined"
          color="primary"
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate('/admin/ai')}
          sx={{ fontWeight: 600 }}
        >
          BACK TO LAUNCHPAD
        </Button>
      </Box>
      <Grid container spacing={4}>
        <Grid item xs={12} md={7}>
          <Paper sx={{ p: 4, bgcolor: 'background.paper', borderRadius: 3, boxShadow: 3 }}>
            <form onSubmit={handleCreateCampaign}>
              <Typography variant="h6" color="text.primary" fontWeight={500} mb={2}>
                Create New Feedback Campaign
              </Typography>
              {successMsg && (
                <Typography color="success.main" mb={1}>
                  {successMsg}
                </Typography>
              )}
              {errorMsg && (
                <Typography color="error.main" mb={1}>
                  {errorMsg}
                </Typography>
              )}
              <TextField
                label="Campaign Name"
                value={campaignName}
                onChange={(e) => setCampaignName(e.target.value)}
                required
                fullWidth
                margin="normal"
                variant="outlined"
              />
              <TextField
                label="Audience (departments/roles)"
                value={audience}
                onChange={(e) => setAudience(e.target.value)}
                fullWidth
                margin="normal"
                variant="outlined"
              />
              <Box mb={2}>
                <Typography variant="subtitle2" color="text.secondary" mb={1}>
                  Prompts
                  <Button size="small" sx={{ ml: 1 }} onClick={() => setShowPromptBank(true)}>
                    + Browse Library
                  </Button>
                  <Button size="small" sx={{ ml: 1 }} onClick={() => setShowAIPrompt(true)}>
                    ✨ Generate with AI
                  </Button>
                </Typography>
                {promptSet.map((p, i) => (
                  <Box key={i} sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                    <TextField
                      value={p.prompt}
                      onChange={(e) => {
                        const newSet = [...promptSet];
                        newSet[i].prompt = e.target.value;
                        setPromptSet(newSet);
                      }}
                      placeholder="Prompt text"
                      required
                      size="small"
                      sx={{ flex: 1, mr: 1 }}
                    />
                    <TextField
                      select
                      SelectProps={{ native: true }}
                      value={p.type}
                      onChange={(e) => {
                        const newSet = [...promptSet];
                        newSet[i].type = e.target.value;
                        setPromptSet(newSet);
                      }}
                      size="small"
                      sx={{ width: 100 }}
                    >
                      <option value="text">Text</option>
                      <option value="scale">Scale</option>
                    </TextField>
                    {i === promptSet.length - 1 && (
                      <Button
                        type="button"
                        size="small"
                        sx={{ ml: 1 }}
                        onClick={() => setPromptSet([...promptSet, { prompt: '', type: 'text' }])}
                      >
                        +
                      </Button>
                    )}
                  </Box>
                ))}
              </Box>
              <Grid container spacing={2}>
                <Grid item xs={6}>
                  <TextField
                    label="Start Date"
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    fullWidth
                    InputLabelProps={{ shrink: true }}
                    margin="normal"
                  />
                </Grid>
                <Grid item xs={6}>
                  <TextField
                    label="End Date"
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    fullWidth
                    InputLabelProps={{ shrink: true }}
                    margin="normal"
                  />
                </Grid>
                <Grid item xs={6}>
                  <TextField
                    label="Recurrence"
                    value={recurrence}
                    onChange={(e) => setRecurrence(e.target.value)}
                    fullWidth
                    margin="normal"
                  />
                </Grid>
                <Grid item xs={6}>
                  <TextField
                    label="Reminder Interval (days)"
                    type="number"
                    value={reminderInterval}
                    onChange={(e) => setReminderInterval(e.target.value)}
                    fullWidth
                    margin="normal"
                  />
                </Grid>
              </Grid>
              <Box mt={2}>
                <FormControlLabel
                  control={
                    <Checkbox checked={scoring} onChange={(e) => setScoring(e.target.checked)} />
                  }
                  label="Enable Sentiment/Scoring"
                />
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={managerAccess}
                      onChange={(e) => setManagerAccess(e.target.checked)}
                    />
                  }
                  label="Manager Access to Results"
                />
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={managerAccessOptIn}
                      onChange={(e) => setManagerAccessOptIn(e.target.checked)}
                    />
                  }
                  label="Only if worker opts in"
                />
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={followUpOptIn}
                      onChange={(e) => setFollowUpOptIn(e.target.checked)}
                    />
                  }
                  label="Follow-Up Opt-In"
                />
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={aiFollowUp}
                      onChange={(e) => setAIFollowUp(e.target.checked)}
                    />
                  }
                  label="AI-Managed Follow-Up"
                />
                <FormControlLabel
                  control={
                    <Checkbox checked={phase2} onChange={(e) => setPhase2(e.target.checked)} />
                  }
                  label="Enable Phase 2 (triggered follow-up)"
                />
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={anonymity}
                      onChange={(e) => setAnonymity(e.target.checked)}
                    />
                  }
                  label="Make responses anonymous to employer"
                />
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={hrReviewOnly}
                      onChange={(e) => setHRReviewOnly(e.target.checked)}
                    />
                  }
                  label="HR Review Only"
                />
                <Box sx={{ color: 'text.secondary', fontStyle: 'italic', my: 1 }}>
                  Worker Preview: This feedback will be seen by{' '}
                  {hrReviewOnly ? 'HR only' : anonymity ? 'employer (anonymized)' : 'employer'}.
                </Box>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={isTemplate}
                      onChange={(e) => setIsTemplate(e.target.checked)}
                    />
                  }
                  label="Save this campaign as a template"
                />
                {isTemplate && (
                  <TextField
                    value={templateName}
                    onChange={(e) => setTemplateName(e.target.value)}
                    placeholder="Template Name"
                    size="small"
                    sx={{ ml: 2, mt: 1 }}
                  />
                )}
              </Box>
              <Button
                type="submit"
                variant="contained"
                color="primary"
                sx={{ mt: 2, fontWeight: 600 }}
              >
                Create Campaign
              </Button>
            </form>
          </Paper>
        </Grid>
        <Grid item xs={12} md={5}>
          <Paper
            sx={{
              p: 4,
              bgcolor: 'background.paper',
              borderRadius: 3,
              boxShadow: 3,
              minHeight: 300,
            }}
          >
            <Typography variant="h6" color="text.primary" fontWeight={500} mb={2}>
              Active Campaigns
            </Typography>
            {activeCampaigns.length === 0 && (
              <Typography color="text.secondary">No active campaigns yet.</Typography>
            )}
            {activeCampaigns.map((c, i) => (
              <Button
                key={i}
                variant={selectedCampaign === c.id ? 'contained' : 'outlined'}
                size="small"
                onClick={() => setSelectedCampaign(c.id)}
                sx={{ mb: 1, mr: 1, textTransform: 'none' }}
              >
                {c.name}
              </Button>
            ))}

            {selectedCampaign && (
              <>
                <Typography variant="h6" color="text.primary" fontWeight={500} mt={4} mb={2}>
                  AI Results Dashboard
                </Typography>
                {summaryLoading ? (
                  <Box>
                    <LinearProgress sx={{ mb: 2 }} />
                    <Typography color="text.secondary">Analyzing feedback responses...</Typography>
                  </Box>
                ) : aiSummary ? (
                  <Box>
                    {/* Summary */}
                    <Card sx={{ mb: 2, bgcolor: 'background.default' }}>
                      <CardContent>
                        <Typography
                          variant="subtitle2"
                          color="text.primary"
                          fontWeight={600}
                          mb={1}
                        >
                          AI Summary
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          {aiSummary.summary}
                        </Typography>
                      </CardContent>
                    </Card>

                    {/* Response Stats */}
                    <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
                      <Chip
                        label={`${aiSummary.responseCount} responses`}
                        size="small"
                        color="primary"
                      />
                      {aiSummary.avgSentiment !== 0 && (
                        <Chip
                          icon={getSentimentIcon(aiSummary.avgSentiment)}
                          label={`${aiSummary.avgSentiment > 0 ? '+' : ''}${
                            aiSummary.avgSentiment
                          } sentiment`}
                          size="small"
                          sx={{
                            bgcolor: getSentimentColor(aiSummary.avgSentiment),
                            color: 'white',
                          }}
                        />
                      )}
                    </Box>

                    {/* Key Themes */}
                    {aiSummary.keyThemes.length > 0 && (
                      <Box mb={2}>
                        <Typography
                          variant="subtitle2"
                          color="text.primary"
                          fontWeight={600}
                          mb={1}
                        >
                          Key Themes
                        </Typography>
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                          {aiSummary.keyThemes.map((theme: any, i: number) => (
                            <Chip
                              key={i}
                              label={`${theme.theme} (${theme.frequency})`}
                              size="small"
                              variant="outlined"
                            />
                          ))}
                        </Box>
                      </Box>
                    )}

                    {/* Sentiment Trend */}
                    {aiSummary.sentimentTrend.length > 0 && (
                      <Box mb={2}>
                        <Typography
                          variant="subtitle2"
                          color="text.primary"
                          fontWeight={600}
                          mb={1}
                        >
                          Sentiment Trend (7 days)
                        </Typography>
                        <Box
                          sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}
                        >
                          {aiSummary.sentimentTrend.map((day: any, i: number) => (
                            <Box key={i} sx={{ textAlign: 'center' }}>
                              <Typography variant="caption" color="text.secondary">
                                {new Date(day.date).toLocaleDateString('en-US', {
                                  month: 'short',
                                  day: 'numeric',
                                })}
                              </Typography>
                              <Box
                                sx={{
                                  width: 20,
                                  height: 20,
                                  borderRadius: '50%',
                                  bgcolor:
                                    day.avgSentiment !== null
                                      ? getSentimentColor(day.avgSentiment)
                                      : '#ccc',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  fontSize: '10px',
                                  color: 'white',
                                  fontWeight: 'bold',
                                }}
                              >
                                {day.avgSentiment !== null
                                  ? Math.round(day.avgSentiment * 10)
                                  : '-'}
                              </Box>
                            </Box>
                          ))}
                        </Box>
                      </Box>
                    )}

                    {/* Actionable Insights */}
                    {aiSummary.actionableInsights.length > 0 && (
                      <Box>
                        <Typography
                          variant="subtitle2"
                          color="text.primary"
                          fontWeight={600}
                          mb={1}
                        >
                          Actionable Insights
                        </Typography>
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                          {aiSummary.actionableInsights.map((insight: string, i: number) => (
                            <Typography
                              key={i}
                              variant="body2"
                              color="text.secondary"
                              sx={{ pl: 1, borderLeft: '2px solid #1976d2' }}
                            >
                              • {insight}
                            </Typography>
                          ))}
                        </Box>
                      </Box>
                    )}
                  </Box>
                ) : (
                  <Typography color="text.secondary">
                    Select a campaign to view AI analysis.
                  </Typography>
                )}
              </>
            )}
          </Paper>
        </Grid>
      </Grid>
      {/* Prompt Bank Modal Placeholder */}
      {showPromptBank && (
        <Box
          sx={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            bgcolor: 'rgba(20,20,20,0.85)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Paper sx={{ p: 4, borderRadius: 2, minWidth: 400, bgcolor: '#222', color: '#fff' }}>
            <Typography variant="h6">Prompt Bank (Coming Soon)</Typography>
            <Button
              onClick={() => setShowPromptBank(false)}
              sx={{ mt: 2, bgcolor: '#444', color: '#fff' }}
            >
              Close
            </Button>
          </Paper>
        </Box>
      )}
      {/* AI Prompt Modal */}
      {showAIPrompt && (
        <Box
          sx={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            bgcolor: 'rgba(20,20,20,0.85)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Paper
            sx={{
              p: 4,
              borderRadius: 2,
              minWidth: 400,
              bgcolor: '#222',
              color: '#fff',
              boxShadow: 8,
            }}
          >
            <Typography variant="h6" color="#fff" mb={2}>
              AI Prompt Generator
            </Typography>
            <TextField
              value={aiPromptTopic}
              onChange={(e) => setAIPromptTopic(e.target.value)}
              placeholder="Enter topic or goal (e.g. onboarding feedback)"
              fullWidth
              size="small"
              sx={{ mb: 2, bgcolor: '#111', color: '#fff', input: { color: '#fff' } }}
            />
            <Button
              onClick={handleAIGeneratePrompts}
              disabled={aiPromptLoading}
              variant="contained"
              color="primary"
              sx={{ mb: 2 }}
            >
              {aiPromptLoading ? 'Generating...' : 'Generate Prompts'}
            </Button>
            <Box sx={{ mt: 2 }}>
              {aiPromptSuggestions.map((s, i) => (
                <Paper
                  key={i}
                  sx={{
                    mb: 1,
                    p: 2,
                    bgcolor: '#333',
                    color: '#fff',
                    borderRadius: 2,
                    cursor: 'pointer',
                    border: '1px solid #444',
                    '&:hover': { bgcolor: '#1976d2' },
                  }}
                  onClick={() => {
                    setPromptSet([...promptSet, { prompt: s, type: 'text' }]);
                    setPromptAddedMsg('Prompt added!');
                    setTimeout(() => setPromptAddedMsg(''), 1200);
                  }}
                  title="Click to add this prompt to your campaign"
                >
                  {s}
                </Paper>
              ))}
              {promptAddedMsg && (
                <Typography color="#90ee90" mt={1}>
                  {promptAddedMsg}
                </Typography>
              )}
            </Box>
            <Button
              onClick={() => setShowAIPrompt(false)}
              sx={{ mt: 2, bgcolor: '#444', color: '#fff' }}
            >
              Close
            </Button>
          </Paper>
        </Box>
      )}
    </Box>
  );
};

export default FeedbackEngine;
