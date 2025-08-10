import React, { useState, useEffect } from 'react';
import {
  Typography,
  Paper,
  Grid,
  Button,
  IconButton,
  Tooltip,
  Snackbar,
  Alert,
} from '@mui/material';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import { doc, getDoc, collection, addDoc } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';

import { db , app } from '../../../../firebase';
import { LoggableSlider } from '../../../../components/LoggableField';
import { useAuth } from '../../../../contexts/AuthContext';

const toneTraits = [
  {
    id: 'formality',
    label: 'Formality',
    help: 'Controls how formal or casual the AI communication is.',
  },
  {
    id: 'friendliness',
    label: 'Friendliness',
    help: 'Adjusts the warmth and approachability of the AI.',
  },
  {
    id: 'conciseness',
    label: 'Conciseness',
    help: 'Determines how brief or detailed the AI responses are.',
  },
  {
    id: 'assertiveness',
    label: 'Assertiveness',
    help: 'Sets how direct or passive the AI should be.',
  },
  {
    id: 'enthusiasm',
    label: 'Enthusiasm',
    help: 'Controls the level of excitement in the AI tone.',
  },
];

interface ToneStyleSettingsProps {
  tenantId: string;
}

const ToneStyleSettings: React.FC<ToneStyleSettingsProps> = ({ tenantId }) => {
  const [tone, setTone] = useState<any>({
    formality: 0.7,
    friendliness: 0.9,
    conciseness: 0.6,
    assertiveness: 0.5,
    enthusiasm: 0.8,
  });
  const [originalTone, setOriginalTone] = useState<any>(tone);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const { currentUser } = useAuth();

  useEffect(() => {
    const fetchTone = async () => {
      try {
        const toneRef = doc(db, 'tenants', tenantId, 'aiSettings', 'toneSettings');
        const toneSnap = await getDoc(toneRef);
        if (toneSnap.exists()) {
          setTone(toneSnap.data() || tone);
          setOriginalTone(toneSnap.data() || tone);
        }
      } catch (err) {
        setError('Failed to fetch tone settings');
      }
    };
    fetchTone();
  }, [tenantId]);

  const handleToneChange = (trait: string, value: any) => {
    // Only update if value is a number
    if (typeof value === 'number' && !isNaN(value)) {
      setTone((prev: any) => ({ ...prev, [trait]: value }));
    } else {
      console.warn('Ignoring non-numeric value for tone trait:', trait, value);
    }
  };

  const handleSave = async () => {
    setError('');
    setSuccess(false);
    // Log payload for debugging
    console.log('Saving agency tone settings:', { tenantId, settingsType: 'toneSettings', settings: tone });
    try {
      const functions = getFunctions(app, 'us-central1');
      const updateFn = httpsCallable(functions, 'updateAgencyAISettings');
      await updateFn({ tenantId, settingsType: 'toneSettings', settings: tone });
      // --- AI Log for processing ---
      await addDoc(collection(db, 'ai_logs'), {
        tenantId,
        section: 'ToneStyleSettings',
        changed: 'toneSettings',
        oldValue: originalTone,
        newValue: tone,
        timestamp: new Date().toISOString(),
        eventType: 'ai_settings_update',
        contextType: 'tone',
        aiRelevant: true,
        urgencyScore: 3,
        success: true,
        userId: currentUser?.uid || null,
        sourceModule: 'AISettings',
      });
      setOriginalTone(tone);
      setSuccess(true);
    } catch (err: any) {
      // Show actual error message if available
      const msg = err?.message || (err?.code ? `${err.code}: ${err.details}` : 'Failed to save tone settings');
      setError(msg);
      // Log error for debugging
      console.error('Error saving agency tone settings:', err);
    }
  };
  const isChanged = JSON.stringify(tone) !== JSON.stringify(originalTone);

  return (
    <Paper sx={{ p: 3, mb: 4 }}>
      <Typography variant="h6" gutterBottom>
        Tone & Style Settings
        <Tooltip title="Adjust how the AI communicates with your workers. Each slider controls a different aspect of the AI's tone.">
          <IconButton size="small" sx={{ ml: 1 }}>
            <HelpOutlineIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Typography>
      <Grid container spacing={4} mb={2}>
        {toneTraits.map((trait) => (
          <Grid item xs={12} sm={6} md={4} key={trait.id}>
            <LoggableSlider
              fieldPath={`tenants:${tenantId}.aiSettings.tone.${trait.id}`}
              trigger="update"
              destinationModules={['ToneEngine', 'ContextEngine']}
              value={tone[trait.id] || 0}
              onChange={(value: number) => handleToneChange(trait.id, value)}
              min={0}
              max={1}
              step={0.01}
              label={trait.label}
              contextType="tone"
              urgencyScore={3}
              description={`Agency tone ${trait.id} setting`}
            />
          </Grid>
        ))}
      </Grid>
      <Button variant="contained" onClick={handleSave} disabled={!isChanged}>
        Save Tone & Style
      </Button>
      <Snackbar open={success} autoHideDuration={2000} onClose={() => setSuccess(false)}>
        <Alert severity="success" sx={{ width: '100%' }}>
          Tone settings updated!
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

export default ToneStyleSettings;
