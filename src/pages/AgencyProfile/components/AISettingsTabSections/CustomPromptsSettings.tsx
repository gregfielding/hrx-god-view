import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Paper,
  Grid,
  TextField,
  Button,
  Snackbar,
  Alert,
  Tooltip,
  IconButton,
} from '@mui/material';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import { db } from '../../../../firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../../../../firebase';

interface CustomPromptsSettingsProps {
  tenantId: string;
}

const CustomPromptsSettings: React.FC<CustomPromptsSettingsProps> = ({ tenantId }) => {
  const [customPrompts, setCustomPrompts] = useState<string[]>(['', '', '']);
  const [originalCustomPrompts, setOriginalCustomPrompts] = useState<string[]>(['', '', '']);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchPrompts = async () => {
      try {
        const promptsRef = doc(db, 'tenants', tenantId, 'aiSettings', 'customPrompts');
        const promptsSnap = await getDoc(promptsRef);
        if (promptsSnap.exists()) {
          const arr = promptsSnap.data().prompts || ['', '', ''];
          setCustomPrompts([arr[0] || '', arr[1] || '', arr[2] || '']);
          setOriginalCustomPrompts([arr[0] || '', arr[1] || '', arr[2] || '']);
        }
      } catch (err) {
        setError('Failed to fetch custom prompts');
      }
    };
    fetchPrompts();
  }, [tenantId]);

  const handlePromptChange = (idx: number, value: string) => {
    setCustomPrompts((prev) => prev.map((p, i) => (i === idx ? value : p)));
  };

  const handleSave = async () => {
    try {
      const functions = getFunctions(app, 'us-central1');
      const updateFn = httpsCallable(functions, 'updateAgencyAISettings');
      await updateFn({ tenantId, settingsType: 'customPrompts', settings: { prompts: customPrompts } });
      setOriginalCustomPrompts([...customPrompts]);
      setSuccess(true);
    } catch (err) {
      setError('Failed to save custom prompts');
    }
  };
  const isChanged = JSON.stringify(customPrompts) !== JSON.stringify(originalCustomPrompts);

  return (
    <Paper sx={{ p: 3, mb: 4 }}>
      <Typography variant="h6" gutterBottom>
        Custom Prompts (max 3)
        <Tooltip title="These prompts will be used by the AI when engaging with your workers. Examples: onboarding questions, shift feedback requests, wellness checks, or training follow-ups.">
          <IconButton size="small" sx={{ ml: 1 }}>
            <HelpOutlineIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Typography>
      <Grid container spacing={2}>
        {[0, 1, 2].map((idx) => (
          <Grid item xs={12} key={idx}>
            <TextField
              label={`Prompt ${idx + 1}`}
              value={customPrompts[idx]}
              onChange={(e) => handlePromptChange(idx, e.target.value)}
              fullWidth
              multiline
              minRows={2}
              placeholder={
                idx === 0
                  ? 'How are you feeling about your first week with us? Is there anything we can do to make your onboarding experience better?'
                  : idx === 1
                  ? 'What was the most challenging part of your shift today, and how did you handle it?'
                  : "What's one thing you'd like to learn or improve in your role this month?"
              }
              sx={{ mb: 2 }}
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
        onClick={handleSave}
        disabled={!isChanged}
        sx={{ mt: 2 }}
      >
        Save Custom Prompts
      </Button>
      <Snackbar open={success} autoHideDuration={2000} onClose={() => setSuccess(false)}>
        <Alert severity="success" sx={{ width: '100%' }}>
          Custom prompts updated!
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

export default CustomPromptsSettings;
