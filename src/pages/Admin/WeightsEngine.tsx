import React, { useState } from 'react';
import { Box, Typography, Paper, Button, Divider } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { useNavigate } from 'react-router-dom';
import { getFunctions, httpsCallable } from 'firebase/functions';
import Snackbar from '@mui/material/Snackbar';
import MuiAlert from '@mui/material/Alert';
import { doc, setDoc } from 'firebase/firestore';

import { useAuth } from '../../contexts/AuthContext';
import { LoggableSlider } from '../../components/LoggableField';
import { db } from '../../firebase';

const ADMIN_SLIDERS = [
  {
    key: 'adminInstruction',
    label: 'Admin Instruction Weight',
    help: 'How much should AI follow system-wide HRX admin rules, guardrails, and tone preferences?',
  },
  {
    key: 'compliance',
    label: 'Compliance Weight',
    help: 'How strictly should AI enforce compliance and legal requirements?',
  },
  {
    key: 'riskTolerance',
    label: 'Risk Tolerance',
    help: 'How much risk is the AI allowed to take in ambiguous situations?',
  },
  {
    key: 'escalation',
    label: 'Escalation Sensitivity',
    help: 'How quickly should AI escalate issues to human admins?',
  },
];

const CUSTOMER_SLIDERS = [
  {
    key: 'mission',
    label: 'Mission Alignment',
    help: "How much should the AI adapt to the customer's mission and values?",
  },
  {
    key: 'teamStructure',
    label: 'Team Structure Weight',
    help: "How much should the AI consider the customer's team structure and hierarchy?",
  },
  {
    key: 'retentionGoals',
    label: 'Retention Goals Weight',
    help: 'How much should the AI prioritize retention and engagement goals?',
  },
  {
    key: 'customPolicies',
    label: 'Custom Policy Weight',
    help: 'How much should the AI follow customer-specific policies and preferences?',
  },
  {
    key: 'cultureFit',
    label: 'Culture Fit Weight',
    help: "How much should the AI adapt to the customer's unique culture?",
  },
];

const EMPLOYEE_SLIDERS = [
  {
    key: 'feedback',
    label: 'Employee Feedback Weight',
    help: 'How much should the AI factor in worker feedback, survey data, and daily interactions?',
  },
  {
    key: 'behavior',
    label: 'Behavioral Signals Weight',
    help: 'How much should the AI consider observed employee behaviors?',
  },
  {
    key: 'performance',
    label: 'Performance Data Weight',
    help: 'How much should the AI factor in employee performance metrics?',
  },
  {
    key: 'wellness',
    label: 'Wellness & Sentiment Weight',
    help: 'How much should the AI consider employee wellness and sentiment data?',
  },
  {
    key: 'growth',
    label: 'Growth & Development Weight',
    help: 'How much should the AI factor in employee learning, upskilling, and growth?',
  },
];

const WeightsEngine: React.FC = () => {
  const [weights, setWeights] = useState<any>({
    // Admin
    adminInstruction: 1,
    compliance: 0.8,
    riskTolerance: 0.5,
    escalation: 0.7,
    // Customer
    mission: 0.7,
    teamStructure: 0.6,
    retentionGoals: 0.6,
    customPolicies: 0.5,
    cultureFit: 0.5,
    // Employee
    feedback: 0.5,
    behavior: 0.5,
    performance: 0.5,
    wellness: 0.5,
    growth: 0.5,
  });
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState('');
  const { currentUser } = useAuth();

  const handleSlider = (key: string, value: number) => {
    setWeights((prev: any) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveSuccess(false);
    setSaveError('');
    try {
      const functions = getFunctions();
      const setWeightsConfig = httpsCallable(functions, 'setWeightsConfig');
      await setWeightsConfig({ weights, userId: currentUser?.uid || null });
      await setDoc(doc(db, 'ai_logs', `admin_WeightsEngine_${Date.now()}`), {
        section: 'WeightsEngine',
        changed: 'weights',
        oldValue: weights,
        newValue: weights,
        timestamp: new Date().toISOString(),
        eventType: 'ai_settings_update',
        engineTouched: ['WeightsEngine'],
        userId: currentUser?.uid || null,
        sourceModule: 'WeightsEngine',
      });
      setSaveSuccess(true);
    } catch (err: any) {
      setSaveError(err.message || 'Failed to save weights');
    }
    setSaving(false);
  };

  return (
    <Box sx={{ p: 0, bgcolor: 'background.default', minHeight: '100vh' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Typography variant="h3">
          Weights Engine
        </Typography>
        <Button
          variant="outlined"
          color="primary"
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate('/admin/ai')}
          sx={{ fontWeight: 600 }}
        >
          Back to Launchpad
        </Button>
      </Box>
      <Typography variant="subtitle1" color="text.secondary" mb={3}>
        Fine-tune how the AI balances admin rules, customer context, and employee feedback.
      </Typography>
      <Paper sx={{ p: 4, mb: 4, bgcolor: 'background.paper', borderRadius: 3, boxShadow: 3 }}>
        <Typography variant="h6" fontWeight={600} mb={2}>
          Weighting Controls
        </Typography>
        {/* Admin Controls */}
        <Typography variant="subtitle1" fontWeight={600} mt={3} mb={1} sx={{ color: '#90caf9' }}>
          Admin Controls
        </Typography>
        {ADMIN_SLIDERS.map((s) => (
          <Box key={s.key} mb={3}>
            <Typography fontWeight={500}>{s.label}</Typography>
            <Typography variant="caption" color="text.secondary">
              {s.help}
            </Typography>
            <LoggableSlider
              fieldPath={`appAiSettings.weights.admin.${s.key}`}
              trigger="update"
              destinationModules={['WeightsEngine', 'ContextEngine']}
              value={weights[s.key]}
              onChange={(valueOrEvent: any, maybeValue?: any) => {
                const value = typeof valueOrEvent === 'number' ? valueOrEvent : maybeValue;
                handleSlider(s.key, value);
              }}
              min={0}
              max={1}
              step={0.01}
              label={s.label}
              contextType="weights"
              urgencyScore={7}
              description={`Admin weights ${s.key} setting`}
            />
            <Typography variant="caption" color="text.secondary">
              Value: {typeof weights[s.key] === 'number' ? weights[s.key].toFixed(2) : 'N/A'}
            </Typography>
          </Box>
        ))}
        <Divider sx={{ my: 3, borderColor: '#388e3c' }} />
        {/* Customer Context Controls */}
        <Typography variant="subtitle1" fontWeight={600} mt={3} mb={1} sx={{ color: '#66bb6a' }}>
          Customer Context Controls
        </Typography>
        {CUSTOMER_SLIDERS.map((s) => (
          <Box key={s.key} mb={3}>
            <Typography fontWeight={500}>{s.label}</Typography>
            <Typography variant="caption" color="text.secondary">
              {s.help}
            </Typography>
            <LoggableSlider
              fieldPath={`appAiSettings.weights.customer.${s.key}`}
              trigger="update"
              destinationModules={['WeightsEngine', 'ContextEngine']}
              value={weights[s.key]}
              onChange={(valueOrEvent: any, maybeValue?: any) => {
                const value = typeof valueOrEvent === 'number' ? valueOrEvent : maybeValue;
                handleSlider(s.key, value);
              }}
              min={0}
              max={1}
              step={0.01}
              label={s.label}
              contextType="weights"
              urgencyScore={6}
              description={`Customer weights ${s.key} setting`}
            />
            <Typography variant="caption" color="text.secondary">
              Value: {typeof weights[s.key] === 'number' ? weights[s.key].toFixed(2) : 'N/A'}
            </Typography>
          </Box>
        ))}
        <Divider sx={{ my: 3, borderColor: '#f57c00' }} />
        {/* Employee Feedback Controls */}
        <Typography variant="subtitle1" fontWeight={600} mt={3} mb={1} sx={{ color: '#ffa726' }}>
          Employee Feedback Controls
        </Typography>
        {EMPLOYEE_SLIDERS.map((s) => (
          <Box key={s.key} mb={3}>
            <Typography fontWeight={500}>{s.label}</Typography>
            <Typography variant="caption" color="text.secondary">
              {s.help}
            </Typography>
            <LoggableSlider
              fieldPath={`appAiSettings.weights.employee.${s.key}`}
              trigger="update"
              destinationModules={['WeightsEngine', 'ContextEngine']}
              value={weights[s.key]}
              onChange={(valueOrEvent: any, maybeValue?: any) => {
                const value = typeof valueOrEvent === 'number' ? valueOrEvent : maybeValue;
                handleSlider(s.key, value);
              }}
              min={0}
              max={1}
              step={0.01}
              label={s.label}
              contextType="weights"
              urgencyScore={5}
              description={`Employee weights ${s.key} setting`}
            />
            <Typography variant="caption" color="text.secondary">
              Value: {typeof weights[s.key] === 'number' ? weights[s.key].toFixed(2) : 'N/A'}
            </Typography>
          </Box>
        ))}
        <Button
          variant="contained"
          color="primary"
          sx={{ mt: 2 }}
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? 'Saving...' : 'Save'}
        </Button>
      </Paper>
      <Snackbar open={saveSuccess} autoHideDuration={3000} onClose={() => setSaveSuccess(false)}>
        <MuiAlert
          elevation={6}
          variant="filled"
          onClose={() => setSaveSuccess(false)}
          severity="success"
        >
          Weights saved and logged!
        </MuiAlert>
      </Snackbar>
      <Snackbar open={!!saveError} autoHideDuration={4000} onClose={() => setSaveError('')}>
        <MuiAlert elevation={6} variant="filled" onClose={() => setSaveError('')} severity="error">
          {saveError}
        </MuiAlert>
      </Snackbar>
    </Box>
  );
};

export default WeightsEngine;