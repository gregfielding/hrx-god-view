import React, { useState, useEffect } from 'react';
import {
  Paper,
  Typography,
  Grid,
  Button,
  Snackbar,
  Alert,
  Tooltip,
  IconButton,
  Box,
  Switch,
  FormControlLabel,
  TextField,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Chip,
  Slider,
  Divider,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import { db } from '../../../../firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { LoggableSlider, LoggableTextField, LoggableSelect, LoggableSwitch } from '../../../../components/LoggableField';
import { useAuth } from '../../../../contexts/AuthContext';

interface Moment {
  id: string;
  title: string;
  description: string;
  category: 'onboarding' | 'wellness' | 'growth' | 'crisis' | 'retention';
  priority: 'low' | 'medium' | 'high' | 'critical';
  status: 'active' | 'inactive';
  eligibilityRule: {
    type: 'tenure' | 'performance_score' | 'custom';
    customCondition?: string;
    min?: number;
  };
  followUp: {
    enabled: boolean;
    delayDays: number;
    prompts: string[];
  };
  traitsTracked: string[];
  outcomeGoals: string[];
  prompts: string[];
  followUpPrompts: string[];
  scoringImpacts: {
    trait: string;
    impact: number;
    condition?: string;
  }[];
  toneOverride: {
    friendliness?: number;
    formality?: number;
    empathy?: number;
    directness?: number;
  };
  aiModifierNotes: string;
  timing: {
    type: 'manual' | 'tenure_based' | 'recurring' | 'trait_decay';
    recurrence?: string;
    followUpDays: number;
    maxRetries: number;
    retryDelayDays: number;
    condition?: {
      field: string;
      operator: string;
      value: number;
    };
  };
}

const defaultMoments: Moment[] = [
  {
    id: 'welcome_checkin',
    title: 'Welcome Check-in',
    description: 'First week check-in to ensure smooth onboarding',
    category: 'onboarding',
    priority: 'high',
    status: 'active',
    eligibilityRule: {
      type: 'tenure',
      min: 7,
    },
    followUp: {
      enabled: true,
      delayDays: 3,
      prompts: ['How are you settling in? Any questions about your role?'],
    },
    traitsTracked: ['reliability', 'communication', 'coachability'],
    outcomeGoals: ['Ensure smooth onboarding', 'Identify early concerns', 'Build rapport'],
    prompts: [
      'How are you feeling about your first week with us?',
      "Is there anything about your role that's unclear?",
      'How can we make your onboarding experience better?',
      'What would help you feel more confident in your role?',
    ],
    followUpPrompts: [],
    scoringImpacts: [
      { trait: 'reliability', impact: 0.2 },
      { trait: 'communication', impact: 0.15 },
      { trait: 'coachability', impact: 0.15 },
    ],
    toneOverride: { friendliness: 0.9, empathy: 0.8 },
    aiModifierNotes:
      'Be very welcoming and supportive. Focus on making them feel comfortable and heard.',
    timing: {
      type: 'tenure_based',
      followUpDays: 3,
      maxRetries: 2,
      retryDelayDays: 2,
    },
  },
  {
    id: 'monthly_wellness',
    title: 'Monthly Wellness Check',
    description: 'Regular wellness and work-life balance assessment',
    category: 'wellness',
    priority: 'medium',
    status: 'active',
    eligibilityRule: {
      type: 'custom',
      customCondition: 'days_since(last_wellness_check) >= 30',
    },
    followUp: {
      enabled: true,
      delayDays: 7,
      prompts: ['How are you feeling after our last conversation?'],
    },
    traitsTracked: ['burnout_risk', 'stress_management', 'work_life_balance'],
    outcomeGoals: ['Monitor wellness', 'Prevent burnout', 'Support work-life balance'],
    prompts: [
      'How has your energy level been lately?',
      'Do you feel like you have a good work-life balance?',
      'What aspects of your work are most challenging right now?',
      'How supported do you feel by your team and management?',
    ],
    followUpPrompts: [],
    scoringImpacts: [
      { trait: 'burnout_risk', impact: 0.3, condition: 'negative_response' },
      { trait: 'stress_management', impact: 0.2 },
    ],
    toneOverride: { empathy: 0.9, directness: 0.4 },
    aiModifierNotes:
      'Be very validating and supportive. If signs of stress detected, offer resources and support.',
    timing: {
      type: 'recurring',
      recurrence: 'monthly',
      followUpDays: 7,
      maxRetries: 2,
      retryDelayDays: 3,
    },
  },
  {
    id: 'quarterly_career',
    title: 'Quarterly Career Check-in',
    description: 'Regular career development and growth assessment',
    category: 'growth',
    priority: 'medium',
    status: 'active',
    eligibilityRule: {
      type: 'custom',
      customCondition: 'days_since(companion_join_date) % 90 == 0',
    },
    followUp: {
      enabled: true,
      delayDays: 14,
      prompts: ['How are your career development goals coming along?'],
    },
    traitsTracked: ['growth_mindset', 'motivation', 'retention_risk', 'career_ambition'],
    outcomeGoals: ['Support career growth', 'Increase retention', 'Identify development needs'],
    prompts: [
      'Are you learning what you want to be learning?',
      'If you could add a skill this year, what would it be?',
      'Are you open to certifications, mentorship, or training?',
      'What would make your role even more fulfilling?',
    ],
    followUpPrompts: [],
    scoringImpacts: [
      { trait: 'growth_mindset', impact: 0.2 },
      { trait: 'motivation', impact: 0.15 },
      { trait: 'retention_risk', impact: -0.2, condition: 'positive_response' },
    ],
    toneOverride: { friendliness: 0.8, formality: 0.6 },
    aiModifierNotes:
      'Focus on growth opportunities and career development. Be encouraging about learning and advancement.',
    timing: {
      type: 'recurring',
      recurrence: 'quarterly',
      followUpDays: 14,
      maxRetries: 2,
      retryDelayDays: 7,
    },
  },
];

interface MomentsEngineSettingsProps {
  tenantId: string;
}

const MomentsEngineSettings: React.FC<MomentsEngineSettingsProps> = ({ tenantId }) => {
  const [moments, setMoments] = useState<Moment[]>(defaultMoments);
  const [originalMoments, setOriginalMoments] = useState<Moment[]>(defaultMoments);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const { currentUser } = useAuth();

  useEffect(() => {
    const fetchMoments = async () => {
      try {
        const momentsRef = doc(db, 'tenants', tenantId, 'aiSettings', 'moments');
        const momentsSnap = await getDoc(momentsRef);
        if (momentsSnap.exists()) {
          setMoments(momentsSnap.data().moments || defaultMoments);
          setOriginalMoments(momentsSnap.data().moments || defaultMoments);
        }
      } catch (err) {
        setError('Failed to fetch moments settings');
      }
    };
    fetchMoments();
  }, [tenantId]);

  const handleMomentChange = (momentId: string, field: string, value: any) => {
    setMoments((prev) =>
      prev.map((moment) => (moment.id === momentId ? { ...moment, [field]: value } : moment)),
    );
  };

  const handleSave = async () => {
    try {
      const ref = doc(db, 'tenants', tenantId, 'aiSettings', 'moments');
      await setDoc(ref, { moments }, { merge: true });
      // Logging hook
      await setDoc(doc(db, 'ai_logs', `${tenantId}_MomentsEngine_${Date.now()}`), {
        tenantId,
        section: 'MomentsEngine',
        changed: 'moments',
        oldValue: originalMoments,
        newValue: moments,
        timestamp: new Date().toISOString(),
        eventType: 'ai_settings_update',
        engineTouched: ['MomentsEngine'],
        userId: currentUser?.uid || null,
        sourceModule: 'MomentsEngine',
      });
      setOriginalMoments([...moments]);
      setSuccess(true);
    } catch (err) {
      setError('Failed to save moments settings');
    }
  };

  const isChanged = JSON.stringify(moments) !== JSON.stringify(originalMoments);

  return (
    <Paper sx={{ p: 3, mb: 4 }}>
      <Typography variant="h6" gutterBottom>
        Moments Engine Settings
        <Tooltip title="Configure when and how the AI should proactively engage with workers.">
          <IconButton size="small" sx={{ ml: 1 }}>
            <HelpOutlineIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Typography>

      <Grid container spacing={3}>
        {moments.map((moment) => (
          <Grid item xs={12} key={moment.id}>
            <Accordion>
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, width: '100%' }}>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={moment.status === 'active'}
                        onChange={(e) =>
                          handleMomentChange(
                            moment.id,
                            'status',
                            e.target.checked ? 'active' : 'inactive',
                          )
                        }
                      />
                    }
                    label=""
                  />
                  <Typography fontWeight={600}>{moment.title}</Typography>
                  <Chip label={moment.category} size="small" color="primary" />
                  <Chip label={moment.priority} size="small" color="secondary" />
                </Box>
              </AccordionSummary>
              <AccordionDetails>
                <Grid container spacing={3}>
                  <Grid item xs={12}>
                    <Typography variant="body2" color="text.secondary" gutterBottom>
                      {moment.description}
                    </Typography>
                  </Grid>

                  {/* Basic Settings */}
                  <Grid item xs={12} md={6}>
                    <LoggableTextField
                      fieldPath={`tenants:${tenantId}.aiSettings.moments.${moment.id}.title`}
                      trigger="update"
                      destinationModules={['MomentsEngine', 'ContextEngine']}
                      value={moment.title}
                      onChange={(value: string) => handleMomentChange(moment.id, 'title', value)}
                      label="Title"
                      placeholder="Moment title"
                      contextType="moments"
                      urgencyScore={3}
                      description={`Agency moment ${moment.id} title`}
                    />
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <LoggableSelect
                      fieldPath={`tenants:${tenantId}.aiSettings.moments.${moment.id}.category`}
                      trigger="update"
                      destinationModules={['MomentsEngine', 'ContextEngine']}
                      value={moment.category}
                      onChange={(value: string) => handleMomentChange(moment.id, 'category', value)}
                      label="Category"
                      options={[
                        { value: 'onboarding', label: 'Onboarding' },
                        { value: 'wellness', label: 'Wellness' },
                        { value: 'growth', label: 'Growth' },
                        { value: 'crisis', label: 'Crisis' },
                        { value: 'retention', label: 'Retention' }
                      ]}
                      contextType="moments"
                      urgencyScore={3}
                      description={`Agency moment ${moment.id} category`}
                    />
                  </Grid>

                  {/* Timing Configuration */}
                  <Grid item xs={12}>
                    <Typography variant="subtitle1" gutterBottom>
                      Timing Configuration
                      <Tooltip title="Configure when this moment should be triggered.">
                        <IconButton size="small" sx={{ ml: 1 }}>
                          <HelpOutlineIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Typography>
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <LoggableSelect
                      fieldPath={`tenants:${tenantId}.aiSettings.moments.${moment.id}.timing.type`}
                      trigger="update"
                      destinationModules={['MomentsEngine', 'ContextEngine']}
                      value={moment.timing.type}
                      onChange={(value: string) =>
                        handleMomentChange(moment.id, 'timing', {
                          ...moment.timing,
                          type: value,
                        })
                      }
                      label="Scheduling Type"
                      options={[
                        { value: 'manual', label: 'Manual Only' },
                        { value: 'tenure_based', label: 'Tenure Based' },
                        { value: 'recurring', label: 'Recurring' },
                        { value: 'trait_decay', label: 'Trait Decay' }
                      ]}
                      contextType="moments"
                      urgencyScore={4}
                      description={`Agency moment ${moment.id} scheduling type`}
                    />
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <LoggableTextField
                      fieldPath={`tenants:${tenantId}.aiSettings.moments.${moment.id}.timing.followUpDays`}
                      trigger="update"
                      destinationModules={['MomentsEngine', 'ContextEngine']}
                      value={moment.timing.followUpDays.toString()}
                      onChange={(value: string) =>
                        handleMomentChange(moment.id, 'timing', {
                          ...moment.timing,
                          followUpDays: parseInt(value),
                        })
                      }
                      label="Follow-up Days"
                      placeholder="Number of days"
                      contextType="moments"
                      urgencyScore={4}
                      description={`Agency moment ${moment.id} follow-up days`}
                    />
                  </Grid>

                  {/* Prompts */}
                  <Grid item xs={12}>
                    <Typography variant="subtitle1" gutterBottom>
                      Prompts
                      <Tooltip title="The main questions the AI will ask during this moment.">
                        <IconButton size="small" sx={{ ml: 1 }}>
                          <HelpOutlineIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Typography>
                    {moment.prompts.map((prompt, idx) => (
                      <TextField
                        key={idx}
                        label={`Prompt ${idx + 1}`}
                        value={prompt}
                        onChange={(e) => {
                          const newPrompts = [...moment.prompts];
                          newPrompts[idx] = e.target.value;
                          handleMomentChange(moment.id, 'prompts', newPrompts);
                        }}
                        fullWidth
                        multiline
                        minRows={2}
                        sx={{ mb: 2 }}
                      />
                    ))}
                  </Grid>

                  {/* Tone Override */}
                  <Grid item xs={12}>
                    <Typography variant="subtitle1" gutterBottom>
                      Tone Override
                      <Tooltip title="Override the default tone for this specific moment.">
                        <IconButton size="small" sx={{ ml: 1 }}>
                          <HelpOutlineIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Typography>
                    <Grid container spacing={2}>
                      <Grid item xs={12} md={3}>
                        <LoggableSlider
                          fieldPath={`tenants:${tenantId}.aiSettings.moments.${moment.id}.toneOverride.friendliness`}
                          trigger="update"
                          destinationModules={['MomentsEngine', 'ContextEngine']}
                          value={moment.toneOverride.friendliness || 0.5}
                          onChange={(valueOrEvent: any, maybeValue?: any) => {
                            const value = typeof valueOrEvent === 'number' ? valueOrEvent : maybeValue;
                            handleMomentChange(moment.id, 'toneOverride', {
                              ...moment.toneOverride,
                              friendliness: value,
                            });
                          }}
                          min={0}
                          max={1}
                          step={0.1}
                          label="Friendliness"
                          contextType="moments"
                          urgencyScore={3}
                          description={`Agency moment ${moment.id} friendliness tone`}
                        />
                      </Grid>
                      <Grid item xs={12} md={3}>
                        <LoggableSlider
                          fieldPath={`tenants:${tenantId}.aiSettings.moments.${moment.id}.toneOverride.empathy`}
                          trigger="update"
                          destinationModules={['MomentsEngine', 'ContextEngine']}
                          value={moment.toneOverride.empathy || 0.5}
                          onChange={(valueOrEvent: any, maybeValue?: any) => {
                            const value = typeof valueOrEvent === 'number' ? valueOrEvent : maybeValue;
                            handleMomentChange(moment.id, 'toneOverride', {
                              ...moment.toneOverride,
                              empathy: value,
                            });
                          }}
                          min={0}
                          max={1}
                          step={0.1}
                          label="Empathy"
                          contextType="moments"
                          urgencyScore={3}
                          description={`Agency moment ${moment.id} empathy tone`}
                        />
                      </Grid>
                    </Grid>
                  </Grid>

                  {/* AI Modifier Notes */}
                  <Grid item xs={12}>
                    <LoggableTextField
                      fieldPath={`tenants:${tenantId}.aiSettings.moments.${moment.id}.aiModifierNotes`}
                      trigger="update"
                      destinationModules={['MomentsEngine', 'ContextEngine']}
                      value={moment.aiModifierNotes}
                      onChange={(value: string) =>
                        handleMomentChange(moment.id, 'aiModifierNotes', value)
                      }
                      label="AI Modifier Notes"
                      multiline
                      rows={3}
                      placeholder="Special instructions for the AI when handling this moment"
                      contextType="moments"
                      urgencyScore={3}
                      description={`Agency moment ${moment.id} AI modifier notes`}
                    />
                  </Grid>
                </Grid>
              </AccordionDetails>
            </Accordion>
          </Grid>
        ))}
      </Grid>

      <Button variant="contained" onClick={handleSave} disabled={!isChanged} sx={{ mt: 3 }}>
        Save Moments Engine Settings
      </Button>

      <Snackbar open={success} autoHideDuration={2000} onClose={() => setSuccess(false)}>
        <Alert severity="success" sx={{ width: '100%' }}>
          Moments engine settings updated!
        </Alert>
      </Snackbar>
      <Snackbar open={!!error} autoHideDuration={4000} onClose={() => setError('')}>
        <Alert severity="error" onClose={() => setError('')} sx={{ width: '100%' }}>
          {error}
        </Alert>
      </Snackbar>
    </Paper>
  );
};

export default MomentsEngineSettings;
