import React, { useState, useEffect } from 'react';
import {
  Paper,
  Typography,
  TextField,
  MenuItem,
  Button,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  IconButton,
  Snackbar,
  Alert,
  Tooltip,
  Box,
} from '@mui/material';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import { db } from '../../../../firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';

const promptFrequencies = ['Low', 'Medium', 'High'];
const goalOptions = ['Engagement', 'Retention', 'Wellness', 'Training'];

interface PromptFrequencyGoalSettingsProps {
  tenantId: string;
}

const PromptFrequencyGoalSettings: React.FC<PromptFrequencyGoalSettingsProps> = ({ tenantId }) => {
  const [promptFrequency, setPromptFrequency] = useState('Medium');
  const [originalPromptFrequency, setOriginalPromptFrequency] = useState('Medium');
  const [goalOrder, setGoalOrder] = useState<string[]>(goalOptions);
  const [originalGoalOrder, setOriginalGoalOrder] = useState<string[]>(goalOptions);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const settingsRef = doc(db, 'tenants', tenantId, 'aiSettings', 'settings');
        const settingsSnap = await getDoc(settingsRef);
        if (settingsSnap.exists()) {
          setPromptFrequency(settingsSnap.data().promptFrequency || 'Medium');
          setOriginalPromptFrequency(settingsSnap.data().promptFrequency || 'Medium');
          setGoalOrder(settingsSnap.data().goalOrder || goalOptions);
          setOriginalGoalOrder(settingsSnap.data().goalOrder || goalOptions);
        }
      } catch (err) {
        setError('Failed to fetch prompt frequency and goal orientation');
      }
    };
    fetchSettings();
  }, [tenantId]);

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

  const handleSave = async () => {
    try {
      const ref = doc(db, 'tenants', tenantId, 'aiSettings', 'settings');
      await setDoc(ref, { promptFrequency, goalOrder }, { merge: true });
      // Logging hook
      await setDoc(doc(db, 'ai_logs', `${tenantId}_PromptFrequencyGoal_${Date.now()}`), {
        tenantId,
        section: 'PromptFrequencyGoal',
        changed: 'promptFrequency_goalOrder',
        oldValue: { promptFrequency: originalPromptFrequency, goalOrder: originalGoalOrder },
        newValue: { promptFrequency, goalOrder },
        timestamp: new Date().toISOString(),
        eventType: 'ai_settings_update',
        engineTouched: ['PromptEngine'],
      });
      setOriginalPromptFrequency(promptFrequency);
      setOriginalGoalOrder([...goalOrder]);
      setSuccess(true);
    } catch (err) {
      setError('Failed to save prompt frequency and goal orientation');
    }
  };
  const isChanged =
    promptFrequency !== originalPromptFrequency ||
    JSON.stringify(goalOrder) !== JSON.stringify(originalGoalOrder);

  return (
    <Paper sx={{ p: 3, mb: 4 }}>
      <Typography variant="h6" gutterBottom>
        Prompt Frequency & Goal Orientation
        <Tooltip title="Configure how often the AI sends prompts and the order of your agency's goals.">
          <IconButton size="small" sx={{ ml: 1 }}>
            <HelpOutlineIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Typography>
      <Box mb={3}>
        <Typography variant="subtitle1" gutterBottom>
          Prompt Frequency
          <Tooltip title="How often the AI should send prompts to your workers.">
            <IconButton size="small" sx={{ ml: 1 }}>
              <HelpOutlineIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Typography>
        <TextField
          select
          label="Prompt Frequency"
          value={promptFrequency}
          onChange={(e) => setPromptFrequency(e.target.value)}
          fullWidth
          sx={{ mb: 2 }}
        >
          {promptFrequencies.map((freq) => (
            <MenuItem key={freq} value={freq}>
              {freq}
            </MenuItem>
          ))}
        </TextField>
      </Box>
      <Box mb={3}>
        <Typography variant="subtitle1" gutterBottom>
          Goal Orientation (Preference Order)
          <Tooltip title="Set the order of your agency's goals. The AI will prioritize them in this order.">
            <IconButton size="small" sx={{ ml: 1 }}>
              <HelpOutlineIcon fontSize="small" />
            </IconButton>
          </Tooltip>
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
      </Box>
      <Button variant="contained" onClick={handleSave} disabled={!isChanged} sx={{ mt: 2 }}>
        Save Prompt Frequency & Goals
      </Button>
      <Snackbar open={success} autoHideDuration={2000} onClose={() => setSuccess(false)}>
        <Alert severity="success" sx={{ width: '100%' }}>
          Prompt frequency & goals updated!
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

export default PromptFrequencyGoalSettings;
