import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Paper,
  Button,
  TextField,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  Divider,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { useNavigate } from 'react-router-dom';
import { getFunctions, httpsCallable } from 'firebase/functions';
import Snackbar from '@mui/material/Snackbar';
import MuiAlert from '@mui/material/Alert';

import { app } from '../../firebase';

const DEFAULT_SCENARIOS = [
  {
    key: 'onboarding',
    name: 'Employee Onboarding',
    goals: '',
    instructions: '',
    sampleLanguage: '',
    escalation: '',
  },
  {
    key: 'feedback',
    name: 'Feedback & Reviews',
    goals: '',
    instructions: '',
    sampleLanguage: '',
    escalation: '',
  },
  {
    key: 'crisis',
    name: 'Crisis Management',
    goals: '',
    instructions: '',
    sampleLanguage: '',
    escalation: '',
  },
];

const ContextEngine: React.FC = () => {
  const [global, setGlobal] = useState({
    mission: '',
    vision: '',
    values: '',
    aiInstructions: '',
    dos: '',
    donts: '',
  });
  const [scenarios, setScenarios] = useState<any[]>(DEFAULT_SCENARIOS);
  const [editScenario, setEditScenario] = useState<any | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [newScenarioName, setNewScenarioName] = useState('');
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [loading, setLoading] = useState(true);

  // Load existing data from Firestore
  useEffect(() => {
    const loadData = async () => {
      try {
        const functions = getFunctions(app, 'us-central1');

        // Load global context
        const getGlobal = httpsCallable(functions, 'getGlobalContext');
        const globalResult = await getGlobal({});
        if (globalResult.data && (globalResult.data as any).context) {
          setGlobal((prev) => ({
            ...prev,
            ...(globalResult.data as any).context,
          }));
        }

        // Load scenarios
        const listScenarios = httpsCallable(functions, 'listScenarios');
        const scenariosResult = await listScenarios({});
        if (scenariosResult.data && (scenariosResult.data as any).scenarios) {
          setScenarios((scenariosResult.data as any).scenarios);
        }
      } catch (error) {
        console.error('Error loading context data:', error);
        setSaveError('Failed to load existing context data');
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);

  const handleEditScenario = (idx: number) => {
    setEditScenario({ ...scenarios[idx] });
    setEditIdx(idx);
    setEditOpen(true);
  };
  const handleAddScenario = () => {
    setEditScenario({ name: '', goals: '', instructions: '', sampleLanguage: '', escalation: '' });
    setEditIdx(null);
    setEditOpen(true);
  };
  const handleSaveScenario = () => {
    if (editIdx !== null) {
      const updated = [...scenarios];
      updated[editIdx] = editScenario;
      setScenarios(updated);
    } else {
      setScenarios([
        ...scenarios,
        { ...editScenario, key: editScenario.name.toLowerCase().replace(/\s+/g, '-') },
      ]);
    }
    setEditOpen(false);
    setEditScenario(null);
    setEditIdx(null);
  };
  const handleDeleteScenario = (idx: number) => {
    setScenarios(scenarios.filter((_, i) => i !== idx));
  };

  const handleSaveAll = async () => {
    setSaving(true);
    setSaveSuccess(false);
    setSaveError('');
    try {
      const functions = getFunctions(app, 'us-central1');
      const setGlobal = httpsCallable(functions, 'setGlobalContext');
      await setGlobal({ context: global, userId: 'hrx-admin' });
      const setScenario = httpsCallable(functions, 'setScenario');
      for (const scenario of scenarios) {
        await setScenario({ scenarioId: scenario.key, scenario, userId: 'hrx-admin' });
      }
      setSaveSuccess(true);
    } catch (err: any) {
      setSaveError(err.message || 'Failed to save context');
    }
    setSaving(false);
  };

  return (
    <Box sx={{ p: 0, bgcolor: 'background.default', minHeight: '100vh' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Typography variant="h3">
          Context Engine
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
        Define and manage the global and scenario-specific context that guides AI behavior across
        the platform.
      </Typography>
      {loading && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Loading existing context data...
        </Typography>
      )}
      <Paper sx={{ p: 4, mb: 4, bgcolor: 'background.paper', borderRadius: 3, boxShadow: 3 }}>
        <Typography variant="h6" fontWeight={600} mb={2}>
          Global Context
        </Typography>
        <TextField
          label="Mission"
          value={global.mission}
          onChange={(e) => setGlobal((g) => ({ ...g, mission: e.target.value }))}
          fullWidth
          multiline
          minRows={2}
          sx={{ mb: 2 }}
        />
        <TextField
          label="Vision"
          value={global.vision}
          onChange={(e) => setGlobal((g) => ({ ...g, vision: e.target.value }))}
          fullWidth
          multiline
          minRows={2}
          sx={{ mb: 2 }}
        />
        <TextField
          label="Values"
          value={global.values}
          onChange={(e) => setGlobal((g) => ({ ...g, values: e.target.value }))}
          fullWidth
          multiline
          minRows={2}
          sx={{ mb: 2 }}
        />
        <TextField
          label="Platform-wide AI Instructions"
          value={global.aiInstructions}
          onChange={(e) => setGlobal((g) => ({ ...g, aiInstructions: e.target.value }))}
          fullWidth
          multiline
          minRows={2}
          sx={{ mb: 2 }}
        />
        <TextField
          label="General Do's"
          value={global.dos}
          onChange={(e) => setGlobal((g) => ({ ...g, dos: e.target.value }))}
          fullWidth
          multiline
          minRows={2}
          sx={{ mb: 2 }}
        />
        <TextField
          label="General Don'ts"
          value={global.donts}
          onChange={(e) => setGlobal((g) => ({ ...g, donts: e.target.value }))}
          fullWidth
          multiline
          minRows={2}
          sx={{ mb: 2 }}
        />
      </Paper>
      <Paper sx={{ p: 4, mb: 4, bgcolor: 'background.paper', borderRadius: 3, boxShadow: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
          <Typography variant="h6" fontWeight={600}>
            Scenario/Module Contexts
          </Typography>
          <Button variant="contained" startIcon={<AddIcon />} onClick={handleAddScenario}>
            Add Scenario
          </Button>
        </Box>
        <List>
          {scenarios.map((s, i) => (
            <React.Fragment key={s.key || i}>
              <ListItem alignItems="flex-start">
                <ListItemText
                  primary={<Typography fontWeight={600}>{s.name}</Typography>}
                  secondary={
                    <>
                      <Typography variant="caption" color="text.secondary">
                        Goals: {s.goals || <em>None</em>}
                      </Typography>
                      <br />
                      <Typography variant="caption" color="text.secondary">
                        Instructions: {s.instructions || <em>None</em>}
                      </Typography>
                    </>
                  }
                />
                <ListItemSecondaryAction>
                  <IconButton onClick={() => handleEditScenario(i)}>
                    <EditIcon />
                  </IconButton>
                  <IconButton onClick={() => handleDeleteScenario(i)}>
                    <DeleteIcon />
                  </IconButton>
                </ListItemSecondaryAction>
              </ListItem>
              <Divider />
            </React.Fragment>
          ))}
        </List>
      </Paper>
      <Dialog open={editOpen} onClose={() => setEditOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editIdx !== null ? 'Edit Scenario' : 'Add Scenario'}</DialogTitle>
        <DialogContent>
          <TextField
            label="Scenario Name"
            value={editScenario?.name || ''}
            onChange={(e) => setEditScenario((s: any) => ({ ...s, name: e.target.value }))}
            fullWidth
            sx={{ mb: 2 }}
          />
          <TextField
            label="Goals"
            value={editScenario?.goals || ''}
            onChange={(e) => setEditScenario((s: any) => ({ ...s, goals: e.target.value }))}
            fullWidth
            multiline
            minRows={2}
            sx={{ mb: 2 }}
          />
          <TextField
            label="Instructions"
            value={editScenario?.instructions || ''}
            onChange={(e) => setEditScenario((s: any) => ({ ...s, instructions: e.target.value }))}
            fullWidth
            multiline
            minRows={2}
            sx={{ mb: 2 }}
          />
          <TextField
            label="Sample Language"
            value={editScenario?.sampleLanguage || ''}
            onChange={(e) =>
              setEditScenario((s: any) => ({ ...s, sampleLanguage: e.target.value }))
            }
            fullWidth
            multiline
            minRows={2}
            sx={{ mb: 2 }}
          />
          <TextField
            label="Escalation Rules"
            value={editScenario?.escalation || ''}
            onChange={(e) => setEditScenario((s: any) => ({ ...s, escalation: e.target.value }))}
            fullWidth
            multiline
            minRows={2}
            sx={{ mb: 2 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditOpen(false)}>Cancel</Button>
          <Button onClick={handleSaveScenario} variant="contained">
            Save
          </Button>
        </DialogActions>
      </Dialog>
      <Button
        variant="contained"
        color="primary"
        sx={{ mt: 2, fontWeight: 600 }}
        onClick={handleSaveAll}
        disabled={saving}
      >
        {saving ? 'Saving...' : 'Save/Publish All Context'}
      </Button>
      <Snackbar open={saveSuccess} autoHideDuration={3000} onClose={() => setSaveSuccess(false)}>
        <MuiAlert
          elevation={6}
          variant="filled"
          onClose={() => setSaveSuccess(false)}
          severity="success"
        >
          Context saved successfully!
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

export default ContextEngine;
