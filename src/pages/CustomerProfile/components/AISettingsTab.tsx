import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Button,
  Snackbar,
  Alert,
  Paper,
  Grid,
  IconButton,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  Chip,
} from '@mui/material';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import DeleteIcon from '@mui/icons-material/Delete';
import {
  doc,
  getDoc,
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';

import { db , app } from '../../../firebase';
import { LoggableSlider, LoggableTextField, LoggableSelect } from '../../../components/LoggableField';
import { useAuth } from '../../../contexts/AuthContext';

interface AISettingsTabProps {
  tenantId: string;
}

const toneTraits = [
  { id: 'formality', label: 'Formality' },
  { id: 'friendliness', label: 'Friendliness' },
  { id: 'conciseness', label: 'Conciseness' },
  { id: 'assertiveness', label: 'Assertiveness' },
  { id: 'enthusiasm', label: 'Enthusiasm' },
];

const promptFrequencies = ['Low', 'Medium', 'High'];
const goalOptions = ['Engagement', 'Retention', 'Wellness', 'Training'];

const AISettingsTab: React.FC<AISettingsTabProps> = ({ tenantId }) => {
  // Check if customer is managed by an agency
  const [isAgencyManaged, setIsAgencyManaged] = useState(false);
  const [agencyName, setAgencyName] = useState('');

  // Tone sliders
  const [tone, setTone] = useState<any>({
    formality: 0.7,
    friendliness: 0.9,
    conciseness: 0.6,
    assertiveness: 0.5,
    enthusiasm: 0.8,
  });
  const [originalTone, setOriginalTone] = useState<any>(tone);
  const [toneSuccess, setToneSuccess] = useState(false);
  const [toneError, setToneError] = useState('');

  // Custom prompts
  const [customPrompts, setCustomPrompts] = useState<string[]>(['', '', '']);
  const [originalCustomPrompts, setOriginalCustomPrompts] = useState<string[]>(['', '', '']);
  const [promptsSuccess, setPromptsSuccess] = useState(false);

  // Prompt frequency
  const [promptFrequency, setPromptFrequency] = useState('Medium');
  const [originalPromptFrequency, setOriginalPromptFrequency] = useState('Medium');
  const [promptFrequencySuccess, setPromptFrequencySuccess] = useState(false);

  // Goal orientation (ordered)
  const [goalOrder, setGoalOrder] = useState<string[]>(goalOptions);
  const [originalGoalOrder, setOriginalGoalOrder] = useState<string[]>(goalOptions);
  const [goalOrderSuccess, setGoalOrderSuccess] = useState(false);

  // Context fields
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [originalWebsiteUrl, setOriginalWebsiteUrl] = useState('');
  const [sampleSocialPosts, setSampleSocialPosts] = useState<string[]>(['', '', '']);
  const [originalSampleSocialPosts, setOriginalSampleSocialPosts] = useState<string[]>([
    '',
    '',
    '',
  ]);
  const [uploadedDocs, setUploadedDocs] = useState<string[]>([]);
  const [originalUploadedDocs, setOriginalUploadedDocs] = useState<string[]>([]);
  const [contextSuccess, setContextSuccess] = useState(false);

  // Error
  const [error, setError] = useState('');

  const { currentUser } = useAuth();

  // Check if customer is agency managed
  useEffect(() => {
    const checkAgencyStatus = async () => {
      try {
        const customerRef = doc(db, 'tenants', tenantId);
        const customerSnap = await getDoc(customerRef);
        if (customerSnap.exists()) {
          const data = customerSnap.data();
          if (data.tenantId) {
            setIsAgencyManaged(true);
            // Fetch agency name
            const agencyRef = doc(db, 'tenants', data.tenantId);
            const agencySnap = await getDoc(agencyRef);
            if (agencySnap.exists()) {
              setAgencyName(agencySnap.data().name || 'Agency');
            }
          }
        }
      } catch (err) {
        console.error('Error checking agency status:', err);
      }
    };
    checkAgencyStatus();
  }, [tenantId]);

  // Fetch all settings on mount
  useEffect(() => {
    const fetchAll = async () => {
      try {
        // Tone
        const toneRef = doc(db, 'tenants', tenantId, 'aiSettings', 'toneSettings');
        const toneSnap = await getDoc(toneRef);
        if (toneSnap.exists()) {
          setTone(toneSnap.data() || tone);
          setOriginalTone(toneSnap.data() || tone);
        }
        // Custom Prompts
        const promptsRef = doc(db, 'tenants', tenantId, 'aiSettings', 'customPrompts');
        const promptsSnap = await getDoc(promptsRef);
        if (promptsSnap.exists()) {
          const arr = promptsSnap.data().prompts || ['', '', ''];
          setCustomPrompts([arr[0] || '', arr[1] || '', arr[2] || '']);
          setOriginalCustomPrompts([arr[0] || '', arr[1] || '', arr[2] || '']);
        }
        // Prompt Frequency & Goal Order
        const settingsRef = doc(db, 'tenants', tenantId, 'aiSettings', 'settings');
        const settingsSnap = await getDoc(settingsRef);
        if (settingsSnap.exists()) {
          setPromptFrequency(settingsSnap.data().promptFrequency || 'Medium');
          setOriginalPromptFrequency(settingsSnap.data().promptFrequency || 'Medium');
          setGoalOrder(settingsSnap.data().goalOrder || goalOptions);
          setOriginalGoalOrder(settingsSnap.data().goalOrder || goalOptions);
        }
        // Context fields
        const contextRef = doc(db, 'tenants', tenantId, 'aiSettings', 'context');
        const contextSnap = await getDoc(contextRef);
        if (contextSnap.exists()) {
          setWebsiteUrl(contextSnap.data().websiteUrl || '');
          setOriginalWebsiteUrl(contextSnap.data().websiteUrl || '');
          const socialArr = contextSnap.data().sampleSocialPosts || ['', '', ''];
          setSampleSocialPosts([socialArr[0] || '', socialArr[1] || '', socialArr[2] || '']);
          setOriginalSampleSocialPosts([
            socialArr[0] || '',
            socialArr[1] || '',
            socialArr[2] || '',
          ]);
          setUploadedDocs(contextSnap.data().uploadedDocs || []);
          setOriginalUploadedDocs(contextSnap.data().uploadedDocs || []);
        }
      } catch (err) {
        setError('Failed to fetch AI settings');
      }
    };
    fetchAll();
    // eslint-disable-next-line
  }, [tenantId]);

  // Handlers
  const handleToneChange = (trait: string, value: number) => {
    setTone((prev: any) => ({ ...prev, [trait]: value }));
  };
  const handlePromptChange = (idx: number, value: string) => {
    setCustomPrompts((prev) => prev.map((p, i) => (i === idx ? value : p)));
  };
  const handleSocialPostChange = (idx: number, value: string) => {
    setSampleSocialPosts((prev) => prev.map((p, i) => (i === idx ? value : p)));
  };
  const moveGoal = (idx: number, direction: 'up' | 'down') => {
    setGoalOrder((prev) => {
      const arr = [...prev];
      if (direction === 'up' && idx > 0) {
        [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]];
      } else if (direction === 'down' && idx < arr.length - 1) {
        [arr[idx + 1], arr[idx]] = [arr[idx], arr[idx + 1]];
      }
      return arr;
    });
  };

  // Universal AI Settings update function
  const updateAISettings = async (settingsType: string, settings: any, onSuccess: () => void, onError: (msg: string) => void) => {
    try {
      const functions = getFunctions(app, 'us-central1');
      const updateFn = httpsCallable(functions, 'updateCustomerAISettings');
      await updateFn({ tenantId, settingsType, settings });
      onSuccess();
    } catch (err: any) {
      onError(err.message || 'Failed to update AI settings');
    }
  };

  // Save handlers
  const handleToneSave = async () => {
    await updateAISettings('toneSettings', tone, () => {
      setOriginalTone(tone);
      setToneSuccess(true);
    }, (msg) => setToneError(msg));
  };
  const isToneChanged = JSON.stringify(tone) !== JSON.stringify(originalTone);

  const handlePromptsSave = async () => {
    await updateAISettings('customPrompts', { prompts: customPrompts }, () => {
      setOriginalCustomPrompts([...customPrompts]);
      setPromptsSuccess(true);
    }, (msg) => setError(msg));
  };
  const isPromptsChanged = JSON.stringify(customPrompts) !== JSON.stringify(originalCustomPrompts);

  const handlePromptFrequencySave = async () => {
    await updateAISettings('settings', { promptFrequency }, () => {
      setOriginalPromptFrequency(promptFrequency);
      setPromptFrequencySuccess(true);
    }, (msg) => setError(msg));
  };
  const isPromptFrequencyChanged = promptFrequency !== originalPromptFrequency;

  const handleGoalOrderSave = async () => {
    await updateAISettings('settings', { goalOrder }, () => {
      setOriginalGoalOrder([...goalOrder]);
      setGoalOrderSuccess(true);
    }, (msg) => setError(msg));
  };
  const isGoalOrderChanged = JSON.stringify(goalOrder) !== JSON.stringify(originalGoalOrder);

  const handleContextSave = async () => {
    await updateAISettings('context', {
      websiteUrl,
      sampleSocialPosts,
      uploadedDocs,
    }, () => {
      setOriginalWebsiteUrl(websiteUrl);
      setOriginalSampleSocialPosts([...sampleSocialPosts]);
      setOriginalUploadedDocs([...uploadedDocs]);
      setContextSuccess(true);
    }, (msg) => setError(msg));
  };
  const isContextChanged =
    websiteUrl !== originalWebsiteUrl ||
    JSON.stringify(sampleSocialPosts) !== JSON.stringify(originalSampleSocialPosts) ||
    JSON.stringify(uploadedDocs) !== JSON.stringify(originalUploadedDocs);

  return (
    <Box sx={{ p: 2, width: '100%', maxWidth: 900, mx: 'auto' }}>
      {isAgencyManaged && (
        <Paper sx={{ p: 3, mb: 4, bgcolor: 'info.light', color: 'info.main' }}>
          <Typography variant="h6" gutterBottom>
            Managed by {agencyName}
          </Typography>
          <Typography variant="body2">
            This customer is managed by an agency. Tone settings and custom prompts are controlled
            by the agency. You can still configure context information and other settings below.
          </Typography>
        </Paper>
      )}

      {!isAgencyManaged && (
        <Paper sx={{ p: 3, mb: 4 }}>
          <Typography variant="h6" gutterBottom>
            Tone & Style Settings
          </Typography>
          <Grid container spacing={4} mb={2}>
            {toneTraits.map((trait) => (
              <Grid item xs={12} sm={6} md={4} key={trait.id}>
                <LoggableSlider
                  fieldPath={`tenants:${tenantId}.aiSettings.tone.${trait.id}`}
                  trigger="update"
                  destinationModules={['ToneEngine', 'ContextEngine']}
                  value={tone[trait.id] || 0}
                  onChange={(valueOrEvent: any, maybeValue?: any) => {
                    const value = typeof valueOrEvent === 'number' ? valueOrEvent : maybeValue;
                    handleToneChange(trait.id, value);
                  }}
                  min={0}
                  max={1}
                  step={0.01}
                  label={trait.label}
                  contextType="tone"
                  urgencyScore={3}
                  description={`Customer tone ${trait.id} setting`}
                />
              </Grid>
            ))}
          </Grid>
          <Button variant="contained" onClick={handleToneSave} disabled={!isToneChanged}>
            Save Tone & Style
          </Button>
        </Paper>
      )}

      {!isAgencyManaged && (
        <Paper sx={{ p: 3, mb: 4 }}>
          <Typography variant="h6" gutterBottom>
            Custom Prompts (max 3)
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            These prompts will be used by the AI when engaging with your workers. Examples:
            onboarding questions, shift feedback requests, wellness checks, or training follow-ups.
          </Typography>
          <Grid container spacing={2}>
            {[0, 1, 2].map((idx) => (
              <Grid item xs={12} key={idx}>
                <LoggableTextField
                  fieldPath={`tenants:${tenantId}.aiSettings.prompts.custom.${idx}`}
                  trigger="update"
                  destinationModules={['PromptEngine', 'ContextEngine']}
                  value={customPrompts[idx]}
                  onChange={(value: string) => handlePromptChange(idx, value)}
                  label={`Prompt ${idx + 1}`}
                  multiline
                  rows={2}
                  placeholder={
                    idx === 0
                      ? 'How are you feeling about your first week with us? Is there anything we can do to make your onboarding experience better?'
                      : idx === 1
                      ? 'What was the most challenging part of your shift today, and how did you handle it?'
                      : "What's one thing you'd like to learn or improve in your role this month?"
                  }
                  contextType="prompts"
                  urgencyScore={4}
                  description={`Customer custom prompt ${idx + 1}`}
                />
              </Grid>
            ))}
          </Grid>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            💡 Tip: Focus on open-ended questions that encourage meaningful responses and help you
            understand your workers better.
          </Typography>
          <Button
            variant="contained"
            color="secondary"
            onClick={handlePromptsSave}
            disabled={!isPromptsChanged}
          >
            Save Custom Prompts
          </Button>
        </Paper>
      )}

      <Paper sx={{ p: 3, mb: 4 }}>
        <Typography variant="h6" gutterBottom>
          Prompt Frequency
        </Typography>
        <LoggableSelect
          fieldPath={`tenants:${tenantId}.aiSettings.prompts.frequency`}
          trigger="update"
          destinationModules={['PromptEngine', 'Scheduler']}
          value={promptFrequency}
          onChange={(value: string) => setPromptFrequency(value)}
          label="Prompt Frequency"
          options={promptFrequencies.map(freq => ({ value: freq, label: freq }))}
          contextType="prompts"
          urgencyScore={3}
          description="Customer prompt frequency setting"
        />
        <Button
          variant="contained"
          onClick={handlePromptFrequencySave}
          disabled={!isPromptFrequencyChanged}
        >
          Save Prompt Frequency
        </Button>
      </Paper>

      <Paper sx={{ p: 3, mb: 4 }}>
        <Typography variant="h6" gutterBottom>
          Goal Orientation (Preference Order)
        </Typography>
        <List>
          {goalOrder.map((goal, idx) => (
            <ListItem key={goal} sx={{ pl: 0 }}>
              <ListItemText primary={goal} />
              <ListItemSecondaryAction>
                <IconButton
                  edge="end"
                  size="small"
                  onClick={() => moveGoal(idx, 'up')}
                  disabled={idx === 0}
                >
                  <ArrowUpwardIcon />
                </IconButton>
                <IconButton
                  edge="end"
                  size="small"
                  onClick={() => moveGoal(idx, 'down')}
                  disabled={idx === goalOrder.length - 1}
                >
                  <ArrowDownwardIcon />
                </IconButton>
              </ListItemSecondaryAction>
            </ListItem>
          ))}
        </List>
        <Button variant="contained" onClick={handleGoalOrderSave} disabled={!isGoalOrderChanged}>
          Save Goal Orientation
        </Button>
      </Paper>

      <Paper sx={{ p: 3, mb: 4 }}>
        <Typography variant="h6" gutterBottom>
          Context & Branding
        </Typography>
        <Grid container spacing={3}>
          <Grid item xs={12}>
            <LoggableTextField
              fieldPath={`tenants:${tenantId}.aiSettings.context.websiteUrl`}
              trigger="update"
              destinationModules={['ContextEngine', 'BrandingEngine']}
              value={websiteUrl}
              onChange={(value: string) => setWebsiteUrl(value)}
              label="Website URL"
              placeholder="https://example.com"
              contextType="context"
              urgencyScore={2}
              description="Customer website URL for context"
            />
          </Grid>
          <Grid item xs={12}>
            <Typography variant="subtitle1" gutterBottom>
              Sample Social Media Posts (max 3)
            </Typography>
            {[0, 1, 2].map((idx) => (
              <LoggableTextField
                key={idx}
                fieldPath={`tenants:${tenantId}.aiSettings.context.sampleSocialPosts.${idx}`}
                trigger="update"
                destinationModules={['ContextEngine', 'BrandingEngine']}
                value={sampleSocialPosts[idx]}
                onChange={(value: string) => handleSocialPostChange(idx, value)}
                label={`Social Post ${idx + 1}`}
                multiline
                rows={2}
                placeholder="Example: 'Excited to announce our new partnership with...'"
                contextType="context"
                urgencyScore={2}
                description={`Customer sample social post ${idx + 1}`}
              />
            ))}
          </Grid>
          <Grid item xs={12}>
            <Typography variant="subtitle1" gutterBottom>
              Uploaded Documents
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
              <Button variant="outlined" startIcon={<CloudUploadIcon />} component="label">
                Upload Document
                <input
                  type="file"
                  hidden
                  accept=".pdf,.doc,.docx"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      setUploadedDocs((prev) => [...prev, file.name]);
                    }
                  }}
                />
              </Button>
              <Typography variant="caption" color="text.secondary">
                PDF, DOC, DOCX files only
              </Typography>
            </Box>
            {uploadedDocs.length > 0 && (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {uploadedDocs.map((doc, idx) => (
                  <Chip
                    key={idx}
                    label={doc}
                    onDelete={() => setUploadedDocs((prev) => prev.filter((_, i) => i !== idx))}
                    deleteIcon={<DeleteIcon />}
                  />
                ))}
              </Box>
            )}
            <Typography variant="caption" color="text.secondary">
              Upload handbooks, policies, or other documents for worker reference
            </Typography>
          </Grid>
        </Grid>
        <Button
          variant="contained"
          onClick={handleContextSave}
          disabled={!isContextChanged}
          sx={{ mt: 2 }}
        >
          Save Context & Branding
        </Button>
      </Paper>

      <Snackbar open={toneSuccess} autoHideDuration={2000} onClose={() => setToneSuccess(false)}>
        <Alert severity="success" sx={{ width: '100%' }}>
          Tone settings updated!
        </Alert>
      </Snackbar>
      <Snackbar open={toneError !== ''} autoHideDuration={4000} onClose={() => setToneError('')}>
        <Alert severity="error" onClose={() => setToneError('')} sx={{ width: '100%' }}>
          {toneError}
        </Alert>
      </Snackbar>
      <Snackbar
        open={promptsSuccess}
        autoHideDuration={2000}
        onClose={() => setPromptsSuccess(false)}
      >
        <Alert severity="success" sx={{ width: '100%' }}>
          Custom prompts updated!
        </Alert>
      </Snackbar>
      <Snackbar
        open={promptFrequencySuccess}
        autoHideDuration={2000}
        onClose={() => setPromptFrequencySuccess(false)}
      >
        <Alert severity="success" sx={{ width: '100%' }}>
          Prompt frequency updated!
        </Alert>
      </Snackbar>
      <Snackbar
        open={goalOrderSuccess}
        autoHideDuration={2000}
        onClose={() => setGoalOrderSuccess(false)}
      >
        <Alert severity="success" sx={{ width: '100%' }}>
          Goal orientation updated!
        </Alert>
      </Snackbar>
      <Snackbar
        open={contextSuccess}
        autoHideDuration={2000}
        onClose={() => setContextSuccess(false)}
      >
        <Alert severity="success" sx={{ width: '100%' }}>
          Context & branding updated!
        </Alert>
      </Snackbar>
      <Snackbar open={!!error} autoHideDuration={4000} onClose={() => setError('')}>
        <Alert severity="error" onClose={() => setError('')} sx={{ width: '100%' }}>
          {error}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default AISettingsTab;
