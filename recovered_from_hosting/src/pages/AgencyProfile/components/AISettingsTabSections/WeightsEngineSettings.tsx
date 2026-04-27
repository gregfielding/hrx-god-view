import React, { useState, useEffect } from 'react';
import {
  Paper,
  Typography,
  Button,
  Snackbar,
  Alert,
  Tooltip,
  IconButton,
  Box,
  Accordion,
  AccordionSummary,
  AccordionDetails,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import { doc, getDoc } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';

import { db , app } from '../../../../firebase';
import { LoggableSlider } from '../../../../components/LoggableField';

const ADMIN_SLIDERS = [
  {
    key: 'adminInstruction',
    label: 'Admin Instruction Weight',
    help: 'How much should the AI follow administrative rules and policies?',
  },
  {
    key: 'compliance',
    label: 'Compliance Weight',
    help: 'How much should the AI prioritize compliance and regulatory requirements?',
  },
  {
    key: 'riskTolerance',
    label: 'Risk Tolerance Weight',
    help: 'How much should the AI consider risk management and safety protocols?',
  },
  {
    key: 'escalation',
    label: 'Escalation Weight',
    help: 'How much should the AI prioritize escalating issues to management?',
  },
];

const CUSTOMER_SLIDERS = [
  {
    key: 'mission',
    label: 'Customer Mission Weight',
    help: "How much should the AI align with the customer's mission and values?",
  },
  {
    key: 'teamStructure',
    label: 'Team Structure Weight',
    help: "How much should the AI consider the customer's team structure and dynamics?",
  },
  {
    key: 'retentionGoals',
    label: 'Retention Goals Weight',
    help: 'How much should the AI prioritize customer retention objectives?',
  },
  {
    key: 'customPolicies',
    label: 'Custom Policies Weight',
    help: 'How much should the AI follow customer-specific policies and procedures?',
  },
  {
    key: 'cultureFit',
    label: 'Culture Fit Weight',
    help: 'How much should the AI consider cultural alignment with the customer?',
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

interface WeightsEngineSettingsProps {
  tenantId: string;
}

const WeightsEngineSettings: React.FC<WeightsEngineSettingsProps> = ({ tenantId }) => {
  const [weights, setWeights] = useState({
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
  const [originalWeights, setOriginalWeights] = useState(weights);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchWeights = async () => {
      try {
        const weightsRef = doc(db, 'tenants', tenantId, 'aiSettings', 'weights');
        const weightsSnap = await getDoc(weightsRef);
        if (weightsSnap.exists()) {
          const data = weightsSnap.data();
          setWeights((data as typeof weights) || weights);
          setOriginalWeights((data as typeof weights) || weights);
        }
      } catch (err) {
        setError('Failed to fetch weights settings');
      }
    };
    fetchWeights();
  }, [tenantId]);

  const handleSlider = (key: string, value: number) => {
    setWeights((prev: any) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    try {
      const functions = getFunctions(app, 'us-central1');
      const updateFn = httpsCallable(functions, 'updateAgencyAISettings');
      await updateFn({ tenantId, settingsType: 'weights', settings: weights });
      setOriginalWeights({ ...weights });
      setSuccess(true);
    } catch (err: any) {
      setError(err.message || 'Failed to save weights');
    }
  };

  const isChanged = JSON.stringify(weights) !== JSON.stringify(originalWeights);

  return (
    <Paper sx={{ p: 3, mb: 4 }}>
      <Typography variant="h6" gutterBottom>
        Weights Engine Settings
        <Tooltip title="Fine-tune how the AI balances admin rules, customer context, and employee feedback.">
          <IconButton size="small" sx={{ ml: 1 }}>
            <HelpOutlineIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Typography>

      {/* Admin Controls */}
      <Accordion defaultExpanded>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography fontWeight={600} sx={{ color: '#90caf9' }}>
            Admin Controls
          </Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Control how much the AI prioritizes administrative rules, compliance, and risk
            management.
          </Typography>
          {ADMIN_SLIDERS.map((s) => (
            <Box key={s.key} mb={3}>
              <LoggableSlider
                fieldPath={`tenants:${tenantId}.aiSettings.weights.admin.${s.key}`}
                trigger="update"
                destinationModules={['WeightsEngine', 'ContextEngine']}
                value={weights[s.key as keyof typeof weights]}
                onChange={(valueOrEvent: any, maybeValue?: any) => {
                  const value = typeof valueOrEvent === 'number' ? valueOrEvent : maybeValue;
                  handleSlider(s.key, value);
                }}
                min={0}
                max={1}
                step={0.01}
                label={s.label}
                contextType="weights"
                urgencyScore={4}
                description={`Agency admin weight ${s.key}`}
              />
            </Box>
          ))}
        </AccordionDetails>
      </Accordion>

      {/* Customer Context Controls */}
      <Accordion>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography fontWeight={600} sx={{ color: '#66bb6a' }}>
            Customer Context Controls
          </Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Control how much the AI considers customer-specific context, mission, and culture.
          </Typography>
          {CUSTOMER_SLIDERS.map((s) => (
            <Box key={s.key} mb={3}>
              <LoggableSlider
                fieldPath={`tenants:${tenantId}.aiSettings.weights.customer.${s.key}`}
                trigger="update"
                destinationModules={['WeightsEngine', 'ContextEngine']}
                value={weights[s.key as keyof typeof weights]}
                onChange={(valueOrEvent: any, maybeValue?: any) => {
                  const value = typeof valueOrEvent === 'number' ? valueOrEvent : maybeValue;
                  handleSlider(s.key, value);
                }}
                min={0}
                max={1}
                step={0.01}
                label={s.label}
                contextType="weights"
                urgencyScore={4}
                description={`Agency customer weight ${s.key}`}
              />
            </Box>
          ))}
        </AccordionDetails>
      </Accordion>

      {/* Employee Feedback Controls */}
      <Accordion>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography fontWeight={600} sx={{ color: '#ff9800' }}>
            Employee Feedback Controls
          </Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Control how much the AI factors in employee feedback, behaviors, and development needs.
          </Typography>
          {EMPLOYEE_SLIDERS.map((s) => (
            <Box key={s.key} mb={3}>
              <LoggableSlider
                fieldPath={`tenants:${tenantId}.aiSettings.weights.employee.${s.key}`}
                trigger="update"
                destinationModules={['WeightsEngine', 'ContextEngine']}
                value={weights[s.key as keyof typeof weights]}
                onChange={(valueOrEvent: any, maybeValue?: any) => {
                  const value = typeof valueOrEvent === 'number' ? valueOrEvent : maybeValue;
                  handleSlider(s.key, value);
                }}
                min={0}
                max={1}
                step={0.01}
                label={s.label}
                contextType="weights"
                urgencyScore={4}
                description={`Agency employee weight ${s.key}`}
              />
            </Box>
          ))}
        </AccordionDetails>
      </Accordion>

      <Button variant="contained" onClick={handleSave} disabled={!isChanged} sx={{ mt: 3 }}>
        Save Weights Engine Settings
      </Button>

      <Snackbar open={success} autoHideDuration={2000} onClose={() => setSuccess(false)}>
        <Alert severity="success" sx={{ width: '100%' }}>
          Weights engine settings updated!
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

export default WeightsEngineSettings;
