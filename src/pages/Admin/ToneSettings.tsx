import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Paper,
  Grid,
  Button,
  Snackbar,
  Alert,
  Card,
  CardContent,
  Divider,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import SaveIcon from '@mui/icons-material/Save';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';

import { db } from '../../firebase';
import { LoggableSlider, LoggableTextField, LoggableSelect, LoggableSwitch } from '../../components/LoggableField';
import { useAuth } from '../../contexts/AuthContext';

interface ToneSettings {
  professional: number;
  friendly: number;
  encouraging: number;
  direct: number;
  empathetic: number;
  authoritative: number;
  conversational: number;
  formal: number;
  customTone: string;
  toneConsistency: 'strict' | 'flexible' | 'adaptive';
  contextAwareness: boolean;
  personalityOverride: boolean;
}

const defaultToneSettings: ToneSettings = {
  professional: 0.7,
  friendly: 0.6,
  encouraging: 0.8,
  direct: 0.5,
  empathetic: 0.7,
  authoritative: 0.4,
  conversational: 0.6,
  formal: 0.3,
  customTone: '',
  toneConsistency: 'flexible',
  contextAwareness: true,
  personalityOverride: false,
};

const ToneSettings: React.FC = () => {
  const [toneSettings, setToneSettings] = useState<ToneSettings>(defaultToneSettings);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const { currentUser } = useAuth();

  useEffect(() => {
    fetchToneSettings();
  }, []);

  const fetchToneSettings = async () => {
    setLoading(true);
    try {
      const toneRef = doc(db, 'appAiSettings', 'tone');
      const toneSnap = await getDoc(toneRef);
      if (toneSnap.exists()) {
        setToneSettings({ ...defaultToneSettings, ...toneSnap.data() });
      } else {
        setToneSettings(defaultToneSettings);
      }
    } catch (err: any) {
      setError('Failed to fetch tone settings');
    }
    setLoading(false);
  };

  const handleSave = async () => {
    try {
      const ref = doc(db, 'appAiSettings', 'tone');
      await setDoc(ref, toneSettings, { merge: true });
      await setDoc(doc(db, 'ai_logs', `admin_ToneSettings_${Date.now()}`), {
        section: 'ToneSettings',
        changed: 'tone',
        oldValue: defaultToneSettings,
        newValue: toneSettings,
        timestamp: new Date().toISOString(),
        eventType: 'ai_settings_update',
        engineTouched: ['ToneEngine'],
        userId: currentUser?.uid || null,
        sourceModule: 'ToneSettings',
      });
      setSuccess(true);
    } catch (err: any) {
      setError('Failed to save tone settings');
    }
  };

  const handleToneChange = (field: keyof ToneSettings, value: any) => {
    setToneSettings((prev) => ({ ...prev, [field]: value }));
  };

  const getToneDescription = (value: number) => {
    if (value <= 0.2) return 'Very Low';
    if (value <= 0.4) return 'Low';
    if (value <= 0.6) return 'Moderate';
    if (value <= 0.8) return 'High';
    return 'Very High';
  };

  const toneSliders = [
    {
      key: 'professional',
      label: 'Professional',
      description: 'Formal, business-like communication',
    },
    { key: 'friendly', label: 'Friendly', description: 'Warm, approachable, and personable' },
    { key: 'encouraging', label: 'Encouraging', description: 'Supportive and motivating language' },
    { key: 'direct', label: 'Direct', description: 'Clear, straightforward communication' },
    { key: 'empathetic', label: 'Empathetic', description: 'Understanding and compassionate' },
    {
      key: 'authoritative',
      label: 'Authoritative',
      description: 'Confident and commanding presence',
    },
    {
      key: 'conversational',
      label: 'Conversational',
      description: 'Casual, chat-like interaction',
    },
    { key: 'formal', label: 'Formal', description: 'Structured and traditional communication' },
  ] as const;

  return (
    <Box sx={{ p: 0, mx: 'auto' }}>
      <Box display="flex" alignItems="center" justifyContent="space-between" mb={3}>
        <Box>
          <Typography variant="h3" gutterBottom>
            Tone Settings
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Configure the global tone and personality of AI interactions across the platform.
          </Typography>
        </Box>
        <Button
          variant="outlined"
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate('/admin/ai')}
          sx={{ height: 40 }}
        >
          Back to Launchpad
        </Button>
      </Box>

      {loading ? (
        <Typography>Loading...</Typography>
      ) : (
        <Grid container spacing={3}>
          <Grid item xs={12} md={8}>
            <Paper sx={{ p: 3, mb: 3 }}>
              <Typography variant="h6" gutterBottom>
                Tone Balance
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                Adjust the balance of different tone characteristics. The AI will blend these to
                create the appropriate tone for each interaction.
              </Typography>

              <Grid container spacing={3}>
                {toneSliders.map(({ key, label, description }) => (
                  <Grid item xs={12} key={key}>
                    <LoggableSlider
                      fieldPath={`appAiSettings.tone.${key}`}
                      trigger="update"
                      destinationModules={['ToneEngine', 'ContextEngine']}
                      value={toneSettings[key]}
                      onChange={(value: number) => handleToneChange(key, value)}
                      min={0}
                      max={1}
                      step={0.01}
                      label={label}
                      contextType="tone"
                      urgencyScore={5}
                      description={`Admin tone ${key} setting`}
                    />
                  </Grid>
                ))}
              </Grid>
            </Paper>

            <Paper sx={{ p: 3, mb: 3 }}>
              <Typography variant="h6" gutterBottom>
                Advanced Settings
              </Typography>

              <Grid container spacing={3}>
                <Grid item xs={12} md={6}>
                  <LoggableSelect
                    fieldPath="appAiSettings.tone.toneConsistency"
                    trigger="update"
                    destinationModules={['ToneEngine', 'ContextEngine']}
                    value={toneSettings.toneConsistency}
                    onChange={(value: string) => handleToneChange('toneConsistency', value)}
                    label="Tone Consistency"
                    options={[
                      { value: 'strict', label: 'Strict - Maintain exact tone' },
                      { value: 'flexible', label: 'Flexible - Allow some variation' },
                      { value: 'adaptive', label: 'Adaptive - Adjust to context' }
                    ]}
                    contextType="tone"
                    urgencyScore={4}
                    description="Admin tone consistency setting"
                  />
                </Grid>

                <Grid item xs={12} md={6}>
                  <LoggableSwitch
                    fieldPath="appAiSettings.tone.contextAwareness"
                    trigger="update"
                    destinationModules={['ToneEngine', 'ContextEngine']}
                    value={toneSettings.contextAwareness}
                    onChange={(value: boolean) => handleToneChange('contextAwareness', value)}
                    label="Context Awareness"
                    contextType="tone"
                    urgencyScore={4}
                    description="Admin tone context awareness setting"
                  />
                  <Typography variant="caption" display="block" color="text.secondary">
                    Allow tone to adapt based on conversation context
                  </Typography>
                </Grid>

                <Grid item xs={12} md={6}>
                  <LoggableSwitch
                    fieldPath="appAiSettings.tone.personalityOverride"
                    trigger="update"
                    destinationModules={['ToneEngine', 'ContextEngine']}
                    value={toneSettings.personalityOverride}
                    onChange={(value: boolean) => handleToneChange('personalityOverride', value)}
                    label="Personality Override"
                    contextType="tone"
                    urgencyScore={4}
                    description="Admin tone personality override setting"
                  />
                  <Typography variant="caption" display="block" color="text.secondary">
                    Allow individual user preferences to override global tone
                  </Typography>
                </Grid>
              </Grid>
            </Paper>

            <Paper sx={{ p: 3 }}>
              <Typography variant="h6" gutterBottom>
                Custom Tone Instructions
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Provide additional instructions for the AI to follow when determining tone.
              </Typography>
              <LoggableTextField
                fieldPath="appAiSettings.tone.customTone"
                trigger="update"
                destinationModules={['ToneEngine', 'ContextEngine']}
                value={toneSettings.customTone}
                onChange={(value: string) => handleToneChange('customTone', value)}
                label="Custom Tone Instructions"
                multiline
                rows={4}
                placeholder="e.g., Always maintain a supportive tone when discussing challenges, but be more direct when giving instructions..."
                contextType="tone"
                urgencyScore={3}
                description="Admin custom tone instructions"
              />
            </Paper>
          </Grid>

          <Grid item xs={12} md={4}>
            <Card sx={{ position: 'sticky', top: 20 }}>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Tone Preview
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  Based on your current settings, the AI will prioritize:
                </Typography>

                <Box sx={{ mb: 2 }}>
                  {toneSliders
                    .filter(({ key }) => toneSettings[key] > 0.6)
                    .sort((a, b) => toneSettings[b.key] - toneSettings[a.key])
                    .slice(0, 3)
                    .map(({ key, label }) => (
                      <Box key={key} display="flex" justifyContent="space-between" mb={1}>
                        <Typography variant="body2">{label}</Typography>
                        <Typography variant="body2" color="primary">
                          {Math.round(toneSettings[key] * 100)}%
                        </Typography>
                      </Box>
                    ))}
                </Box>

                <Divider sx={{ my: 2 }} />

                <Typography variant="subtitle2" gutterBottom>
                  Consistency Level
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  {toneSettings.toneConsistency === 'strict' &&
                    'The AI will maintain very consistent tone across all interactions.'}
                  {toneSettings.toneConsistency === 'flexible' &&
                    'The AI will allow some natural variation while maintaining overall tone.'}
                  {toneSettings.toneConsistency === 'adaptive' &&
                    'The AI will adapt tone based on context and user needs.'}
                </Typography>

                <Button
                  variant="contained"
                  fullWidth
                  startIcon={<SaveIcon />}
                  onClick={handleSave}
                  sx={{ mt: 2 }}
                >
                  Save Tone Settings
                </Button>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}

      <Snackbar open={success} autoHideDuration={3000} onClose={() => setSuccess(false)}>
        <Alert severity="success" sx={{ width: '100%' }}>
          Tone settings saved successfully!
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

export default ToneSettings;
