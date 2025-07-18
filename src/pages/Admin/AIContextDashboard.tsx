import React, { useEffect, useState } from 'react';
import {
  Box,
  Typography,
  TextField,
  Button,
  Grid,
  Snackbar,
  Alert,
  Paper,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  IconButton,
  TableContainer,
  Tabs,
  Tab,
  Slider,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Chip,
  Autocomplete,
} from '@mui/material';
import {
  collection,
  doc,
  getDoc,
  setDoc,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
} from 'firebase/firestore';
import { db } from '../../firebase';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';

const AIContextDashboard: React.FC = () => {
  // Tone & Style
  const toneTraits = [
    { id: 'formality', label: 'Formality' },
    { id: 'friendliness', label: 'Friendliness' },
    { id: 'conciseness', label: 'Conciseness' },
    { id: 'assertiveness', label: 'Assertiveness' },
    { id: 'enthusiasm', label: 'Enthusiasm' },
  ];
  const [customerTone, setCustomerTone] = useState<any>({
    formality: 0.7,
    friendliness: 0.9,
    conciseness: 0.6,
    assertiveness: 0.5,
    enthusiasm: 0.8,
  });
  const [employeeTone, setEmployeeTone] = useState<any>({
    formality: 0.4,
    friendliness: 1.0,
    conciseness: 0.5,
    assertiveness: 0.6,
    enthusiasm: 0.9,
  });
  const [originalCustomerTone, setOriginalCustomerTone] = useState<any>({});
  const [originalEmployeeTone, setOriginalEmployeeTone] = useState<any>({});
  const [toneSuccess, setToneSuccess] = useState(false);
  const [toneError, setToneError] = useState('');

  // Weighting Controls
  const weightControls = [
    { id: 'customer', label: 'Customer Weight' },
    { id: 'employee', label: 'Employee Weight' },
    { id: 'admin', label: 'Admin Weight' },
  ];
  const [weights, setWeights] = useState<any>({ customer: '', employee: '', admin: '' });
  const [originalWeights, setOriginalWeights] = useState<any>({});
  const [weightsSuccess, setWeightsSuccess] = useState(false);
  const [weightsError, setWeightsError] = useState('');

  // Organizational Context
  const [organizationalContext, setOrganizationalContext] = useState<any>({
    regionWeight: 0.3,
    divisionWeight: 0.4,
    departmentWeight: 0.2,
    locationWeight: 0.1,
    enableOrganizationalTargeting: true,
    defaultTargetingScope: 'all',
  });
  const [originalOrganizationalContext, setOriginalOrganizationalContext] = useState<any>({});
  const [organizationalSuccess, setOrganizationalSuccess] = useState(false);
  const [organizationalError, setOrganizationalError] = useState('');

  // Context Journeys
  const [journeys, setJourneys] = useState<any[]>([]);
  const [editJourneyId, setEditJourneyId] = useState<string | null>(null);
  const [journeyForm, setJourneyForm] = useState<any>({
    trait: '',
    definition: '',
    signals: '',
    initialPrompts: '',
    scoringInstructions: '',
    followUpLogic: '',
    maxScore: 10,
    type: 'soft_skills',
    tags: '',
    active: true,
    // Organizational targeting fields
    targetRegions: [],
    targetDivisions: [],
    targetDepartments: [],
    targetLocations: [],
    organizationalScope: 'all', // all, specific, none
  });
  const [journeySuccess, setJourneySuccess] = useState(false);
  const [journeyError, setJourneyError] = useState('');

  // Organizational data for dropdowns
  const [regions, setRegions] = useState<any[]>([]);
  const [divisions, setDivisions] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);

  const [sideTab, setSideTab] = useState(0);

  const traitTypeDescriptions: Record<string, string> = {
    soft_skills: 'e.g., Empathy, Teamwork, Communication, Leadership',
    work_habits: 'e.g., Reliability, Initiative, Punctuality, Focus',
    cognitive_skills: 'e.g., Problem Solving, Adaptability, Decision-Making',
    technical_skills: 'e.g., Forklift Operation, MedPass, Inventory Systems',
    cultural_fit: 'e.g., Alignment with values, Professionalism',
  };

  const organizationalScopeOptions = [
    { value: 'all', label: 'All Organizations', description: 'Apply to all regions, divisions, departments, and locations' },
    { value: 'specific', label: 'Specific Targeting', description: 'Apply only to selected organizational units' },
    { value: 'none', label: 'No Targeting', description: 'Ignore organizational structure' },
  ];

  useEffect(() => {
    fetchToneSettings();
    fetchWeights();
    fetchOrganizationalContext();
    fetchJourneys();
    fetchOrganizationalData();
  }, []);

  // Fetch organizational data for dropdowns
  const fetchOrganizationalData = async () => {
    try {
      // Fetch regions
      const regionsQuery = query(collection(db, 'regions'), where('status', '==', 'active'));
      const regionsSnapshot = await getDocs(regionsQuery);
      setRegions(regionsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));

      // Fetch divisions
      const divisionsQuery = query(collection(db, 'divisions'), where('status', '==', 'active'));
      const divisionsSnapshot = await getDocs(divisionsQuery);
      setDivisions(divisionsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));

      // Fetch departments
      const departmentsQuery = query(collection(db, 'departments'), where('status', '==', 'active'));
      const departmentsSnapshot = await getDocs(departmentsQuery);
      setDepartments(departmentsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));

      // Fetch locations
      const locationsQuery = query(collection(db, 'locations'), where('status', '==', 'active'));
      const locationsSnapshot = await getDocs(locationsQuery);
      setLocations(locationsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    } catch (err: any) {
      console.error('Failed to fetch organizational data:', err);
    }
  };

  // Tone & Style
  const fetchToneSettings = async () => {
    try {
      const ref = doc(db, 'appAiSettings', 'globalToneSettings');
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const data = snap.data();
        setCustomerTone(data.customerTone || customerTone);
        setEmployeeTone(data.employeeTone || employeeTone);
        setOriginalCustomerTone(data.customerTone || customerTone);
        setOriginalEmployeeTone(data.employeeTone || employeeTone);
      }
    } catch (err: any) {
      setToneError(err.message || 'Failed to fetch tone settings');
    }
  };
  const handleToneSave = async () => {
    try {
      const ref = doc(db, 'appAiSettings', 'globalToneSettings');
      await setDoc(ref, { customerTone, employeeTone }, { merge: true });
      setOriginalCustomerTone(customerTone);
      setOriginalEmployeeTone(employeeTone);
      setToneSuccess(true);
    } catch (err: any) {
      setToneError(err.message || 'Failed to save tone settings');
    }
  };
  const isToneChanged =
    JSON.stringify(customerTone) !== JSON.stringify(originalCustomerTone) ||
    JSON.stringify(employeeTone) !== JSON.stringify(originalEmployeeTone);

  // Weights
  const fetchWeights = async () => {
    try {
      const ref = doc(db, 'appAiSettings', 'contextWeights');
      const snap = await getDoc(ref);
      if (snap.exists()) {
        setWeights(snap.data());
        setOriginalWeights(snap.data());
      }
    } catch (err: any) {
      setWeightsError(err.message || 'Failed to fetch weights');
    }
  };
  const handleWeightsSave = async () => {
    try {
      const ref = doc(db, 'appAiSettings', 'contextWeights');
      await setDoc(ref, weights, { merge: true });
      setOriginalWeights(weights);
      setWeightsSuccess(true);
    } catch (err: any) {
      setWeightsError(err.message || 'Failed to save weights');
    }
  };
  const isWeightsChanged = JSON.stringify(weights) !== JSON.stringify(originalWeights);

  // Organizational Context
  const fetchOrganizationalContext = async () => {
    try {
      const ref = doc(db, 'appAiSettings', 'organizationalContext');
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const data = snap.data();
        setOrganizationalContext(data);
        setOriginalOrganizationalContext(data);
      }
    } catch (err: any) {
      setOrganizationalError(err.message || 'Failed to fetch organizational context');
    }
  };

  const handleOrganizationalContextSave = async () => {
    try {
      const ref = doc(db, 'appAiSettings', 'organizationalContext');
      await setDoc(ref, organizationalContext, { merge: true });
      setOriginalOrganizationalContext(organizationalContext);
      setOrganizationalSuccess(true);
    } catch (err: any) {
      setOrganizationalError(err.message || 'Failed to save organizational context');
    }
  };

  const isOrganizationalContextChanged = JSON.stringify(organizationalContext) !== JSON.stringify(originalOrganizationalContext);

  // Context Journeys
  const fetchJourneys = async () => {
    try {
      const q = collection(db, 'appAiSettings', 'global', 'contextJourneys');
      const snapshot = await getDocs(q);
      setJourneys(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    } catch (err: any) {
      setJourneyError(err.message || 'Failed to fetch journeys');
    }
  };
  const handleJourneyChange = (field: string, value: any) => {
    setJourneyForm((prev: any) => ({ ...prev, [field]: value }));
  };
  const handleJourneySave = async () => {
    try {
      // Parse follow-up logic from JSON string to structured array
      let parsedFollowUpLogic = [];
      if (journeyForm.followUpLogic.trim()) {
        try {
          const parsed = JSON.parse(journeyForm.followUpLogic);
          parsedFollowUpLogic = Array.isArray(parsed) ? parsed : [parsed];
        } catch (e) {
          // If not valid JSON, create a simple structure
          parsedFollowUpLogic = [
            { if: 'default', then: journeyForm.followUpLogic, tag: 'general' },
          ];
        }
      }

      const journeyData = {
        ...journeyForm,
        signals: journeyForm.signals
          .split(',')
          .map((s: string) => s.trim())
          .filter(Boolean),
        initialPrompts: journeyForm.initialPrompts
          .split('\n')
          .map((p: string) => p.trim())
          .filter(Boolean),
        followUpLogic: parsedFollowUpLogic,
        tags: journeyForm.tags
          .split(',')
          .map((t: string) => t.trim())
          .filter(Boolean),
        maxScore: parseInt(journeyForm.maxScore) || 10,
        active: Boolean(journeyForm.active),
        updatePath: `/traitScores/${journeyForm.trait.replace(/\s+/g, '_')}`,
        // Organizational targeting data
        targetRegions: journeyForm.targetRegions?.map((r: any) => r.id) || [],
        targetDivisions: journeyForm.targetDivisions?.map((d: any) => d.id) || [],
        targetDepartments: journeyForm.targetDepartments?.map((dept: any) => dept.id) || [],
        targetLocations: journeyForm.targetLocations?.map((l: any) => l.id) || [],
        organizationalScope: journeyForm.organizationalScope || 'all',
      };

      if (editJourneyId) {
        const ref = doc(db, 'appAiSettings', 'global', 'contextJourneys', editJourneyId);
        await updateDoc(ref, journeyData);
      } else {
        await addDoc(collection(db, 'appAiSettings', 'global', 'contextJourneys'), journeyData);
      }

      setJourneyForm({
        trait: '',
        definition: '',
        signals: '',
        initialPrompts: '',
        scoringInstructions: '',
        followUpLogic: '',
        maxScore: 10,
        type: 'soft_skills',
        tags: '',
        active: true,
      });
      setEditJourneyId(null);
      setJourneySuccess(true);
      fetchJourneys();
    } catch (err: any) {
      setJourneyError(err.message || 'Failed to save journey');
    }
  };
  const handleJourneyEdit = (journey: any) => {
    setEditJourneyId(journey.id);
    
    // Map organizational IDs back to objects for the form
    const targetRegions = regions.filter(r => journey.targetRegions?.includes(r.id)) || [];
    const targetDivisions = divisions.filter(d => journey.targetDivisions?.includes(d.id)) || [];
    const targetDepartments = departments.filter(dept => journey.targetDepartments?.includes(dept.id)) || [];
    const targetLocations = locations.filter(l => journey.targetLocations?.includes(l.id)) || [];
    
    setJourneyForm({
      trait: journey.trait || '',
      definition: journey.definition || '',
      signals: journey.signals ? journey.signals.join(', ') : '',
      initialPrompts: journey.initialPrompts ? journey.initialPrompts.join('\n') : '',
      scoringInstructions: journey.scoringInstructions || '',
      followUpLogic: journey.followUpLogic ? JSON.stringify(journey.followUpLogic, null, 2) : '',
      maxScore: journey.maxScore || 10,
      type: journey.type || 'soft_skills',
      tags: journey.tags ? journey.tags.join(', ') : '',
      active: journey.active !== false,
      targetRegions,
      targetDivisions,
      targetDepartments,
      targetLocations,
      organizationalScope: journey.organizationalScope || 'all',
    });
  };
  const handleJourneyDelete = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'appAiSettings', 'global', 'contextJourneys', id));
      fetchJourneys();
    } catch (err: any) {
      setJourneyError(err.message || 'Failed to delete journey');
    }
  };

  return (
    <Box sx={{ p: 2, width: '100%', display: 'flex', alignItems: 'flex-start' }}>
      <Box sx={{ width: 80, mr: 3 }}>
        <Tabs
          orientation="vertical"
          value={sideTab}
          onChange={(_, v) => setSideTab(v)}
          sx={{ borderRight: 1, borderColor: 'divider', width: 80 }}
        >
          <Tab label={<Box sx={{ width: 80, textAlign: 'right', pr: 2 }}>Tone</Box>} />
          <Tab label={<Box sx={{ width: 80, textAlign: 'right', pr: 2 }}>Weights</Box>} />
          <Tab label={<Box sx={{ width: 80, textAlign: 'right', pr: 2 }}>Organizational</Box>} />
          <Tab label={<Box sx={{ width: 80, textAlign: 'right', pr: 2 }}>Context</Box>} />
        </Tabs>
      </Box>
      <Box sx={{ flex: 1 }}>
        {sideTab === 0 && (
          <Paper sx={{ p: 3, mb: 4 }}>
            <Typography variant="h6" gutterBottom>
              Tone & Style Settings
            </Typography>
            <Grid container spacing={4} mb={2}>
              <Grid item xs={12} md={6}>
                <Typography variant="subtitle1" fontWeight={600} mb={2}>
                  Customer Tone
                </Typography>
                {toneTraits.map((trait) => (
                  <Box key={trait.id} sx={{ mb: 2 }}>
                    <Typography>{trait.label}</Typography>
                    <Slider
                      value={customerTone[trait.id]}
                      min={0}
                      max={1}
                      step={0.01}
                      onChange={(_, val) =>
                        setCustomerTone((prev: any) => ({ ...prev, [trait.id]: val as number }))
                      }
                    />
                    <Typography variant="caption" color="text.secondary">
                      Value: {customerTone[trait.id]?.toFixed(2)}
                    </Typography>
                  </Box>
                ))}
              </Grid>
              <Grid item xs={12} md={6}>
                <Typography variant="subtitle1" fontWeight={600} mb={2}>
                  Employee Tone
                </Typography>
                {toneTraits.map((trait) => (
                  <Box key={trait.id} sx={{ mb: 2 }}>
                    <Typography>{trait.label}</Typography>
                    <Slider
                      value={employeeTone[trait.id]}
                      min={0}
                      max={1}
                      step={0.01}
                      onChange={(_, val) =>
                        setEmployeeTone((prev: any) => ({ ...prev, [trait.id]: val as number }))
                      }
                    />
                    <Typography variant="caption" color="text.secondary">
                      Value: {employeeTone[trait.id]?.toFixed(2)}
                    </Typography>
                  </Box>
                ))}
              </Grid>
            </Grid>
            <Button variant="contained" onClick={handleToneSave} disabled={!isToneChanged}>
              Save
            </Button>
          </Paper>
        )}
        {sideTab === 1 && (
          <Paper sx={{ p: 3, mb: 4 }}>
            <Typography variant="h6" gutterBottom>
              Weighting Controls
            </Typography>

            {/* Admin Section */}
            <Box sx={{ mb: 4 }}>
              <Typography variant="h6" sx={{ mb: 2, pb: 1, borderBottom: '2px solid #1976d2' }}>
                Admin Controls
              </Typography>
              <Box sx={{ mb: 3 }}>
                <Typography variant="subtitle1" fontWeight={600}>
                  Admin Instruction Weight
                </Typography>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ mb: 1, display: 'block' }}
                >
                  How much should AI behavior follow system-wide HRX admin rules, guardrails, and
                  tone preferences?
                </Typography>
                <Slider
                  value={
                    typeof weights.adminInstructionWeight === 'number'
                      ? weights.adminInstructionWeight
                      : 1.0
                  }
                  min={0}
                  max={1}
                  step={0.01}
                  onChange={(_, val) =>
                    setWeights((prev: any) => ({ ...prev, adminInstructionWeight: val as number }))
                  }
                />
                <Typography variant="caption" color="text.secondary">
                  Value:{' '}
                  {typeof weights.adminInstructionWeight === 'number'
                    ? weights.adminInstructionWeight.toFixed(2)
                    : '1.00'}
                </Typography>
              </Box>
              {/* Additional admin sliders can be added here */}
            </Box>

            {/* Customer Section */}
            <Box sx={{ mb: 4 }}>
              <Typography variant="h6" sx={{ mb: 2, pb: 1, borderBottom: '2px solid #2e7d32' }}>
                Customer Context Controls
              </Typography>
              <Box sx={{ mb: 3 }}>
                <Typography variant="subtitle1" fontWeight={600}>
                  Customer Context Weight
                </Typography>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ mb: 1, display: 'block' }}
                >
                  How much should the AI adapt to the specific customer's mission, team structure,
                  retention goals, etc?
                </Typography>
                <Slider
                  value={
                    typeof weights.customerContextWeight === 'number'
                      ? weights.customerContextWeight
                      : 0.7
                  }
                  min={0}
                  max={1}
                  step={0.01}
                  onChange={(_, val) =>
                    setWeights((prev: any) => ({ ...prev, customerContextWeight: val as number }))
                  }
                />
                <Typography variant="caption" color="text.secondary">
                  Value:{' '}
                  {typeof weights.customerContextWeight === 'number'
                    ? weights.customerContextWeight.toFixed(2)
                    : '0.70'}
                </Typography>
              </Box>
              {/* Additional customer sliders can be added here */}
            </Box>

            {/* Employee Section */}
            <Box sx={{ mb: 4 }}>
              <Typography variant="h6" sx={{ mb: 2, pb: 1, borderBottom: '2px solid #ed6c02' }}>
                Employee Feedback Controls
              </Typography>
              <Box sx={{ mb: 3 }}>
                <Typography variant="subtitle1" fontWeight={600}>
                  Employee Feedback Weight
                </Typography>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ mb: 1, display: 'block' }}
                >
                  How much should the AI factor in worker behavior, feedback, survey data, and daily
                  interactions?
                </Typography>
                <Slider
                  value={
                    typeof weights.employeeFeedbackWeight === 'number'
                      ? weights.employeeFeedbackWeight
                      : 0.5
                  }
                  min={0}
                  max={1}
                  step={0.01}
                  onChange={(_, val) =>
                    setWeights((prev: any) => ({ ...prev, employeeFeedbackWeight: val as number }))
                  }
                />
                <Typography variant="caption" color="text.secondary">
                  Value:{' '}
                  {typeof weights.employeeFeedbackWeight === 'number'
                    ? weights.employeeFeedbackWeight.toFixed(2)
                    : '0.50'}
                </Typography>
              </Box>
              {/* Additional employee sliders can be added here */}
            </Box>

            <Button variant="contained" onClick={handleWeightsSave} disabled={!isWeightsChanged}>
              Save
            </Button>
          </Paper>
        )}
        {sideTab === 2 && (
          <Paper sx={{ p: 3, mb: 4 }}>
            <Typography variant="h6" gutterBottom>
              Organizational Context
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              Configure how AI behavior is targeted to specific organizational units.
            </Typography>

            <Grid container spacing={3}>
              <Grid item xs={12} md={6}>
                <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 2 }}>
                  Enable Organizational Targeting
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  Should AI behavior be tailored based on the user's organizational context?
                </Typography>
                <Autocomplete
                  options={['true', 'false']}
                  value={organizationalContext.enableOrganizationalTargeting ? 'true' : 'false'}
                  onChange={(_, value) =>
                    setOrganizationalContext((prev: any) => ({
                      ...prev,
                      enableOrganizationalTargeting: value === 'true',
                    }))
                  }
                  renderInput={(params) => (
                    <TextField {...params} label="Enable Organizational Targeting" />
                  )}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 2 }}>
                  Default Targeting Scope
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  What is the default scope for organizational targeting if enabled?
                </Typography>
                <Autocomplete
                  options={organizationalScopeOptions}
                  value={organizationalScopeOptions.find(
                    (option) => option.value === organizationalContext.defaultTargetingScope
                  )}
                  onChange={(_, value) =>
                    setOrganizationalContext((prev: any) => ({
                      ...prev,
                      defaultTargetingScope: value?.value || 'all',
                    }))
                  }
                  renderInput={(params) => (
                    <TextField {...params} label="Default Targeting Scope" />
                  )}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 2 }}>
                  Region Weight
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  How much should AI behavior be influenced by the user's region?
                </Typography>
                <Slider
                  value={organizationalContext.regionWeight}
                  min={0}
                  max={1}
                  step={0.01}
                  onChange={(_, val) =>
                    setOrganizationalContext((prev: any) => ({
                      ...prev,
                      regionWeight: val as number,
                    }))
                  }
                />
                <Typography variant="caption" color="text.secondary">
                  Value: {organizationalContext.regionWeight?.toFixed(2)}
                </Typography>
              </Grid>
              <Grid item xs={12} md={6}>
                <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 2 }}>
                  Division Weight
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  How much should AI behavior be influenced by the user's division?
                </Typography>
                <Slider
                  value={organizationalContext.divisionWeight}
                  min={0}
                  max={1}
                  step={0.01}
                  onChange={(_, val) =>
                    setOrganizationalContext((prev: any) => ({
                      ...prev,
                      divisionWeight: val as number,
                    }))
                  }
                />
                <Typography variant="caption" color="text.secondary">
                  Value: {organizationalContext.divisionWeight?.toFixed(2)}
                </Typography>
              </Grid>
              <Grid item xs={12} md={6}>
                <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 2 }}>
                  Department Weight
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  How much should AI behavior be influenced by the user's department?
                </Typography>
                <Slider
                  value={organizationalContext.departmentWeight}
                  min={0}
                  max={1}
                  step={0.01}
                  onChange={(_, val) =>
                    setOrganizationalContext((prev: any) => ({
                      ...prev,
                      departmentWeight: val as number,
                    }))
                  }
                />
                <Typography variant="caption" color="text.secondary">
                  Value: {organizationalContext.departmentWeight?.toFixed(2)}
                </Typography>
              </Grid>
              <Grid item xs={12} md={6}>
                <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 2 }}>
                  Location Weight
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  How much should AI behavior be influenced by the user's location?
                </Typography>
                <Slider
                  value={organizationalContext.locationWeight}
                  min={0}
                  max={1}
                  step={0.01}
                  onChange={(_, val) =>
                    setOrganizationalContext((prev: any) => ({
                      ...prev,
                      locationWeight: val as number,
                    }))
                  }
                />
                <Typography variant="caption" color="text.secondary">
                  Value: {organizationalContext.locationWeight?.toFixed(2)}
                </Typography>
              </Grid>
            </Grid>
            <Button variant="contained" onClick={handleOrganizationalContextSave} disabled={!isOrganizationalContextChanged}>
              Save Organizational Context
            </Button>
          </Paper>
        )}
        {sideTab === 3 && (
          <Paper sx={{ p: 3, mb: 4 }}>
            <Typography variant="h6" gutterBottom>
              Context Journeys
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              Define AI behavior patterns for assessing worker traits and guiding conversations.
            </Typography>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleJourneySave();
              }}
            >
              {/* Basic Information */}
              <Box sx={{ mb: 4 }}>
                <Typography variant="h6" sx={{ mb: 2, pb: 1, borderBottom: '2px solid #1976d2' }}>
                  Basic Information
                </Typography>
                <Grid container spacing={3}>
                  <Grid item xs={12} md={6}>
                    <TextField
                      label="Trait Name"
                      fullWidth
                      required
                      value={journeyForm.trait}
                      onChange={(e) => handleJourneyChange('trait', e.target.value)}
                      helperText="e.g., Empathy, Communication, Reliability"
                    />
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <FormControl fullWidth>
                      <InputLabel>Type</InputLabel>
                      <Select
                        value={journeyForm.type}
                        label="Type"
                        onChange={(e) => handleJourneyChange('type', e.target.value)}
                      >
                        <MenuItem value="soft_skills">Soft Skills</MenuItem>
                        <MenuItem value="work_habits">Work Habits</MenuItem>
                        <MenuItem value="cognitive_skills">Cognitive Skills</MenuItem>
                        <MenuItem value="technical_skills">Technical Skills</MenuItem>
                        <MenuItem value="cultural_fit">Cultural Fit</MenuItem>
                      </Select>
                    </FormControl>
                    {traitTypeDescriptions[journeyForm.type] && (
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ mt: 0.5, ml: 1.75, display: 'block' }}
                      >
                        {traitTypeDescriptions[journeyForm.type]}
                      </Typography>
                    )}
                  </Grid>
                  <Grid item xs={12}>
                    <TextField
                      label="Definition"
                      fullWidth
                      required
                      multiline
                      minRows={2}
                      value={journeyForm.definition}
                      onChange={(e) => handleJourneyChange('definition', e.target.value)}
                      helperText="Clear definition of what this trait means in the workplace"
                    />
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <TextField
                      label="Tags (comma separated)"
                      fullWidth
                      value={journeyForm.tags}
                      onChange={(e) => handleJourneyChange('tags', e.target.value)}
                      helperText="e.g., customer-facing, teamwork, problem-solving"
                    />
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <TextField
                      label="Max Score"
                      fullWidth
                      type="number"
                      value={journeyForm.maxScore}
                      onChange={(e) => handleJourneyChange('maxScore', e.target.value)}
                      helperText="Maximum score for this trait (1-10)"
                    />
                  </Grid>
                </Grid>
              </Box>

              {/* Organizational Targeting */}
              <Box sx={{ mb: 4 }}>
                <Typography variant="h6" sx={{ mb: 2, pb: 1, borderBottom: '2px solid #1976d2' }}>
                  Organizational Targeting
                </Typography>
                <Grid container spacing={3}>
                  <Grid item xs={12} md={6}>
                    <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 2 }}>
                      Target Regions
                    </Typography>
                    <Autocomplete
                      multiple
                      options={regions}
                      value={journeyForm.targetRegions}
                      onChange={(_, value) => setJourneyForm((prev: any) => ({ ...prev, targetRegions: value }))}
                      getOptionLabel={(option) => option.name}
                      renderTags={(tagValue, getTagProps) =>
                        tagValue.map((option, index) => (
                          <Chip
                            label={option.name}
                            {...getTagProps({ index })}
                            size="small"
                            sx={{ mr: 0.5 }}
                          />
                        ))
                      }
                      renderInput={(params) => (
                        <TextField {...params} label="Select Regions" placeholder="Add regions" />
                      )}
                    />
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 2 }}>
                      Target Divisions
                    </Typography>
                    <Autocomplete
                      multiple
                      options={divisions}
                      value={journeyForm.targetDivisions}
                      onChange={(_, value) => setJourneyForm((prev: any) => ({ ...prev, targetDivisions: value }))}
                      getOptionLabel={(option) => option.name}
                      renderTags={(tagValue, getTagProps) =>
                        tagValue.map((option, index) => (
                          <Chip
                            label={option.name}
                            {...getTagProps({ index })}
                            size="small"
                            sx={{ mr: 0.5 }}
                          />
                        ))
                      }
                      renderInput={(params) => (
                        <TextField {...params} label="Select Divisions" placeholder="Add divisions" />
                      )}
                    />
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 2 }}>
                      Target Departments
                    </Typography>
                    <Autocomplete
                      multiple
                      options={departments}
                      value={journeyForm.targetDepartments}
                      onChange={(_, value) => setJourneyForm((prev: any) => ({ ...prev, targetDepartments: value }))}
                      getOptionLabel={(option) => option.name}
                      renderTags={(tagValue, getTagProps) =>
                        tagValue.map((option, index) => (
                          <Chip
                            label={option.name}
                            {...getTagProps({ index })}
                            size="small"
                            sx={{ mr: 0.5 }}
                          />
                        ))
                      }
                      renderInput={(params) => (
                        <TextField {...params} label="Select Departments" placeholder="Add departments" />
                      )}
                    />
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 2 }}>
                      Target Locations
                    </Typography>
                    <Autocomplete
                      multiple
                      options={locations}
                      value={journeyForm.targetLocations}
                      onChange={(_, value) => setJourneyForm((prev: any) => ({ ...prev, targetLocations: value }))}
                      getOptionLabel={(option) => option.name}
                      renderTags={(tagValue, getTagProps) =>
                        tagValue.map((option, index) => (
                          <Chip
                            label={option.name}
                            {...getTagProps({ index })}
                            size="small"
                            sx={{ mr: 0.5 }}
                          />
                        ))
                      }
                      renderInput={(params) => (
                        <TextField {...params} label="Select Locations" placeholder="Add locations" />
                      )}
                    />
                  </Grid>
                  <Grid item xs={12}>
                    <FormControl fullWidth>
                      <InputLabel>Organizational Scope</InputLabel>
                      <Select
                        value={journeyForm.organizationalScope}
                        label="Organizational Scope"
                        onChange={(e) => handleJourneyChange('organizationalScope', e.target.value)}
                      >
                        {organizationalScopeOptions.map((option) => (
                          <MenuItem key={option.value} value={option.value}>
                            {option.label}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Grid>
                </Grid>
              </Box>

              {/* AI Interaction */}
              <Box sx={{ mb: 4 }}>
                <Typography variant="h6" sx={{ mb: 2, pb: 1, borderBottom: '2px solid #2e7d32' }}>
                  AI Interaction
                </Typography>
                <Grid container spacing={3}>
                  <Grid item xs={12}>
                    <TextField
                      label="Initial Prompts (one per line)"
                      fullWidth
                      multiline
                      minRows={3}
                      value={journeyForm.initialPrompts}
                      onChange={(e) => handleJourneyChange('initialPrompts', e.target.value)}
                      helperText="Questions the AI will ask to start the conversation about this trait"
                    />
                  </Grid>
                  <Grid item xs={12}>
                    <TextField
                      label="Follow-Up Logic (JSON array)"
                      fullWidth
                      multiline
                      minRows={4}
                      value={journeyForm.followUpLogic}
                      onChange={(e) => handleJourneyChange('followUpLogic', e.target.value)}
                      helperText='[{"if": "condition", "then": "response", "tag": "category"}]'
                    />
                  </Grid>
                </Grid>
              </Box>

              {/* Assessment */}
              <Box sx={{ mb: 4 }}>
                <Typography variant="h6" sx={{ mb: 2, pb: 1, borderBottom: '2px solid #ed6c02' }}>
                  Assessment & Scoring
                </Typography>
                <Grid container spacing={3}>
                  <Grid item xs={12}>
                    <TextField
                      label="Behavioral Signals (comma separated)"
                      fullWidth
                      multiline
                      minRows={2}
                      value={journeyForm.signals}
                      onChange={(e) => handleJourneyChange('signals', e.target.value)}
                      helperText="Specific behaviors that indicate this trait (e.g., helps teammates, asks questions, shows patience)"
                    />
                  </Grid>
                  <Grid item xs={12}>
                    <TextField
                      label="Scoring Instructions"
                      fullWidth
                      multiline
                      minRows={3}
                      value={journeyForm.scoringInstructions}
                      onChange={(e) => handleJourneyChange('scoringInstructions', e.target.value)}
                      helperText="Guidelines for how the AI should score responses"
                    />
                  </Grid>
                </Grid>
              </Box>

              <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                <Button variant="contained" type="submit">
                  {editJourneyId ? 'Update' : 'Create'} Journey
                </Button>
                {editJourneyId && (
                  <Button
                    variant="outlined"
                    onClick={() => {
                      setEditJourneyId(null);
                      setJourneyForm({
                        trait: '',
                        definition: '',
                        signals: '',
                        initialPrompts: '',
                        scoringInstructions: '',
                        updatePath: '',
                        followUpLogic: '',
                        maxScore: 10,
                        type: 'soft_skills',
                        tags: '',
                        active: true,
                        targetRegions: [],
                        targetDivisions: [],
                        targetDepartments: [],
                        targetLocations: [],
                        organizationalScope: 'all',
                      });
                    }}
                  >
                    Cancel
                  </Button>
                )}
              </Box>
            </form>

            {/* Journeys Table */}
            <Box sx={{ mt: 4 }}>
              <Typography variant="h6" sx={{ mb: 2 }}>
                Existing Journeys
              </Typography>
              <TableContainer component={Paper}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Trait</TableCell>
                      <TableCell>Type</TableCell>
                      <TableCell>Definition</TableCell>
                      <TableCell>Signals</TableCell>
                      <TableCell>Organizational Scope</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell>Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {journeys.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7}>
                          No journeys yet. Create your first one above.
                        </TableCell>
                      </TableRow>
                    ) : (
                      journeys.map((j) => (
                        <TableRow key={j.id}>
                          <TableCell>
                            <Typography variant="subtitle2">{j.trait}</Typography>
                            {j.tags && j.tags.length > 0 && (
                              <Typography variant="caption" color="text.secondary">
                                {Array.isArray(j.tags) ? j.tags.join(', ') : j.tags}
                              </Typography>
                            )}
                          </TableCell>
                          <TableCell>
                            <Typography
                              variant="body2"
                              sx={{
                                textTransform: 'capitalize',
                                color:
                                  j.type === 'soft_skills'
                                    ? '#2e7d32'
                                    : j.type === 'work_habits'
                                    ? '#ed6c02'
                                    : j.type === 'cognitive_skills'
                                    ? '#9c27b0'
                                    : j.type === 'technical_skills'
                                    ? '#1976d2'
                                    : j.type === 'cultural_fit'
                                    ? '#f57c00'
                                    : '#666',
                              }}
                            >
                              {j.type?.replace('_', ' ')}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Typography
                              variant="body2"
                              sx={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}
                            >
                              {j.definition}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Typography
                              variant="body2"
                              sx={{ maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis' }}
                            >
                              {Array.isArray(j.signals)
                                ? j.signals.slice(0, 2).join(', ')
                                : j.signals}
                              {Array.isArray(j.signals) && j.signals.length > 2 && '...'}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2" sx={{ maxWidth: 120 }}>
                              {j.organizationalScope === 'all' && 'All Organizations'}
                              {j.organizationalScope === 'specific' && 'Specific Targeting'}
                              {j.organizationalScope === 'none' && 'No Targeting'}
                            </Typography>
                            {j.organizationalScope === 'specific' && (
                              <Typography variant="caption" color="text.secondary">
                                {[
                                  j.targetRegions?.length > 0 && `${j.targetRegions.length} regions`,
                                  j.targetDivisions?.length > 0 && `${j.targetDivisions.length} divisions`,
                                  j.targetDepartments?.length > 0 && `${j.targetDepartments.length} depts`,
                                  j.targetLocations?.length > 0 && `${j.targetLocations.length} locations`,
                                ].filter(Boolean).join(', ')}
                              </Typography>
                            )}
                          </TableCell>
                          <TableCell>
                            <Typography
                              variant="caption"
                              sx={{
                                px: 1,
                                py: 0.5,
                                borderRadius: 1,
                                backgroundColor: j.active !== false ? '#e8f5e8' : '#ffebee',
                                color: j.active !== false ? '#2e7d32' : '#d32f2f',
                              }}
                            >
                              {j.active !== false ? 'Active' : 'Inactive'}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <IconButton size="small" onClick={() => handleJourneyEdit(j)}>
                              <EditIcon fontSize="small" />
                            </IconButton>
                            <IconButton
                              size="small"
                              color="error"
                              onClick={() => handleJourneyDelete(j.id)}
                            >
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </Box>
          </Paper>
        )}
      </Box>
      <Snackbar open={!!toneError} autoHideDuration={4000} onClose={() => setToneError('')}>
        <Alert severity="error" onClose={() => setToneError('')} sx={{ width: '100%' }}>
          {toneError}
        </Alert>
      </Snackbar>
      <Snackbar open={toneSuccess} autoHideDuration={2000} onClose={() => setToneSuccess(false)}>
        <Alert severity="success" sx={{ width: '100%' }}>
          Tone settings updated!
        </Alert>
      </Snackbar>
      <Snackbar open={!!weightsError} autoHideDuration={4000} onClose={() => setWeightsError('')}>
        <Alert severity="error" onClose={() => setWeightsError('')} sx={{ width: '100%' }}>
          {weightsError}
        </Alert>
      </Snackbar>
      <Snackbar
        open={weightsSuccess}
        autoHideDuration={2000}
        onClose={() => setWeightsSuccess(false)}
      >
        <Alert severity="success" sx={{ width: '100%' }}>
          Weights updated!
        </Alert>
      </Snackbar>
      <Snackbar open={!!organizationalError} autoHideDuration={4000} onClose={() => setOrganizationalError('')}>
        <Alert severity="error" onClose={() => setOrganizationalError('')} sx={{ width: '100%' }}>
          {organizationalError}
        </Alert>
      </Snackbar>
      <Snackbar
        open={organizationalSuccess}
        autoHideDuration={2000}
        onClose={() => setOrganizationalSuccess(false)}
      >
        <Alert severity="success" sx={{ width: '100%' }}>
          Organizational context updated!
        </Alert>
      </Snackbar>
      <Snackbar open={!!journeyError} autoHideDuration={4000} onClose={() => setJourneyError('')}>
        <Alert severity="error" onClose={() => setJourneyError('')} sx={{ width: '100%' }}>
          {journeyError}
        </Alert>
      </Snackbar>
      <Snackbar
        open={journeySuccess}
        autoHideDuration={2000}
        onClose={() => setJourneySuccess(false)}
      >
        <Alert severity="success" sx={{ width: '100%' }}>
          Journey updated!
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default AIContextDashboard;
