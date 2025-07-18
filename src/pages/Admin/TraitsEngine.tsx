import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Paper,
  Grid,
  TextField,
  Button,
  Slider,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  TableContainer,
  IconButton,
  Tabs,
  Tab,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Switch,
  FormControlLabel,
  Snackbar,
  Alert,
  Chip,
  Divider,
  Card,
  CardContent,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import EditIcon from '@mui/icons-material/Edit';
import SaveIcon from '@mui/icons-material/Save';
import CancelIcon from '@mui/icons-material/Cancel';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { doc, getDoc, setDoc, collection, getDocs, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { useNavigate } from 'react-router-dom';

interface ConditionalPrompt {
  condition: string;
  prompt: string;
}

interface Trait {
  id: string;
  name: string;
  definition: string;
  category: 'Core' | 'Soft Skill' | 'Behavioral' | 'Leadership' | 'Technical' | 'Custom';
  weight: number;
  decayType: 'linear' | 'exponential' | 'manual' | 'pause';
  aiGuidance: string;
  starterPrompts: string[];
  signalPrompts: string[];
  followUpPrompts: { text: string; tags: string[] }[];
  active: boolean;
  maxScore: number;
  signals: string[];
  scoringCriteria: string;
  updateFrequency: 'daily' | 'weekly' | 'monthly';
  decayRate: number;
  conditionalPrompts?: ConditionalPrompt[];
}

interface MasterRules {
  scoringMethod: 'cumulative' | 'averaged' | 'weighted';
  updateLogic: 'immediate' | 'batch' | 'scheduled';
  decayLogic: 'linear' | 'exponential' | 'none';
  minScoreThreshold: number;
  maxScoreThreshold: number;
  confidenceThreshold: number;
  signalWeightMultiplier: number;
  promptWeightMultiplier: number;
  behaviorWeightMultiplier: number;
}

const defaultTraits: Trait[] = [
  {
    id: 'reliability',
    name: 'Reliability',
    definition: 'Consistency in showing up on time, completing tasks, and following through.',
    category: 'Core',
    weight: 0.8,
    decayType: 'linear',
    aiGuidance: 'This trait is crucial for maintaining trust and consistency in your work.',
    starterPrompts: [
      "How do you ensure you're always on time for your shifts?",
      'Tell me about a time when you had to complete a task under pressure.',
    ],
    signalPrompts: ['attendance patterns', 'deadline follow-through', 'proactive updates'],
    followUpPrompts: [
      { text: 'What steps do you take when you realize you might miss a deadline?', tags: [] },
      { text: 'How do you communicate when you need to adjust your schedule?', tags: [] },
    ],
    active: true,
    maxScore: 10,
    signals: ['on-time arrival', 'task completion', 'proactive communication'],
    scoringCriteria:
      'Score based on attendance consistency, task completion rate, and proactive communication frequency.',
    updateFrequency: 'daily',
    decayRate: 0.1,
    conditionalPrompts: [],
  },
  {
    id: 'empathy',
    name: 'Empathy',
    definition: 'Awareness of and sensitivity to the emotions of others.',
    category: 'Soft Skill',
    weight: 0.7,
    decayType: 'exponential',
    aiGuidance: 'Empathy helps build stronger relationships and improves team cohesion.',
    starterPrompts: [
      'Tell me about a time you helped a teammate who was struggling.',
      'How do you handle situations where someone is upset or frustrated?',
    ],
    signalPrompts: ['helping others', 'emotional awareness', 'supportive language'],
    followUpPrompts: [
      { text: 'What do you do when you notice someone having a difficult day?', tags: [] },
      { text: 'How do you show support to colleagues going through challenges?', tags: [] },
    ],
    active: true,
    maxScore: 10,
    signals: ['offers help', 'emotional support', 'inclusive language'],
    scoringCriteria:
      'Score based on frequency of helping behaviors, emotional support offered, and inclusive communication.',
    updateFrequency: 'weekly',
    decayRate: 0.05,
    conditionalPrompts: [],
  },
  {
    id: 'communication',
    name: 'Communication',
    definition: 'Ability to clearly share thoughts, ask questions, and listen actively.',
    category: 'Behavioral',
    weight: 0.9,
    decayType: 'manual',
    aiGuidance: 'Effective communication is key to success in any role.',
    starterPrompts: [
      'How do you ensure you understand instructions before starting a task?',
      'Tell me about a time when clear communication helped solve a problem.',
    ],
    signalPrompts: ['asking questions', 'active listening', 'clear explanations'],
    followUpPrompts: [
      { text: "What do you do if you don't understand a supervisor's request?", tags: [] },
      { text: 'How do you handle misunderstandings in the workplace?', tags: [] },
    ],
    active: true,
    maxScore: 10,
    signals: ['asks clarifying questions', 'provides clear updates', 'listens attentively'],
    scoringCriteria:
      'Score based on question-asking frequency, clarity of communication, and active listening behaviors.',
    updateFrequency: 'daily',
    decayRate: 0.08,
    conditionalPrompts: [],
  },
  {
    id: 'teamwork',
    name: 'Teamwork',
    definition: 'Willingness to collaborate, help others, and avoid drama.',
    category: 'Behavioral',
    weight: 0.8,
    decayType: 'linear',
    aiGuidance:
      'Teamwork is essential for achieving goals and fostering a positive work environment.',
    starterPrompts: [
      'How do you contribute to a positive team environment?',
      'Tell me about a time when you had to work through a conflict with a coworker.',
    ],
    signalPrompts: ['inclusive language', 'conflict resolution', 'collaboration'],
    followUpPrompts: [
      { text: 'How do you handle disagreements with team members?', tags: [] },
      { text: 'What do you do to support your teammates?', tags: [] },
    ],
    active: true,
    maxScore: 10,
    signals: ['collaborative behavior', 'conflict resolution', 'team support'],
    scoringCriteria:
      'Score based on collaborative behaviors, conflict resolution effectiveness, and team support offered.',
    updateFrequency: 'weekly',
    decayRate: 0.06,
    conditionalPrompts: [],
  },
  {
    id: 'leadership',
    name: 'Leadership',
    definition: 'Taking initiative, influencing others positively, and modeling good behavior.',
    category: 'Leadership',
    weight: 0.9,
    decayType: 'exponential',
    aiGuidance: 'Leadership is about inspiring and guiding others to achieve great results.',
    starterPrompts: [
      'Describe a time you took charge or helped a group succeed.',
      'How do you motivate others to do their best work?',
    ],
    signalPrompts: ['taking initiative', 'positive influence', 'role modeling'],
    followUpPrompts: [
      { text: 'What leadership opportunities have you taken on?', tags: [] },
      { text: 'How do you inspire others to improve?', tags: [] },
    ],
    active: true,
    maxScore: 10,
    signals: ['initiative taking', 'positive influence', 'role modeling'],
    scoringCriteria:
      'Score based on initiative frequency, positive influence on others, and role modeling behaviors.',
    updateFrequency: 'weekly',
    decayRate: 0.04,
    conditionalPrompts: [],
  },
  {
    id: 'coachability',
    name: 'Coachability',
    definition: 'Openness to feedback, learning, and trying new approaches.',
    category: 'Behavioral',
    weight: 0.7,
    decayType: 'linear',
    aiGuidance: 'Being coachable is about continuously improving and adapting to new situations.',
    starterPrompts: [
      'How do you handle constructive feedback?',
      'Tell me about a time when you learned something new on the job.',
    ],
    signalPrompts: ['positive feedback reactions', 'learning behavior', 'adaptation to change'],
    followUpPrompts: [
      { text: 'What do you do when someone points out an area for improvement?', tags: [] },
      { text: 'How do you approach learning new skills?', tags: [] },
    ],
    active: true,
    maxScore: 10,
    signals: [
      'accepts feedback positively',
      'seeks learning opportunities',
      'adapts to new methods',
    ],
    scoringCriteria:
      'Score based on feedback acceptance, learning initiative, and adaptation to new approaches.',
    updateFrequency: 'weekly',
    decayRate: 0.05,
    conditionalPrompts: [],
  },
  {
    id: 'commitment',
    name: 'Commitment',
    definition: 'Dedication to the job, even during difficult or repetitive tasks.',
    category: 'Behavioral',
    weight: 0.8,
    decayType: 'linear',
    aiGuidance: 'Commitment is about being dedicated and persevering through challenges.',
    starterPrompts: [
      'How do you stay motivated during challenging or repetitive work?',
      'Tell me about a time when you had to persevere through difficulties.',
    ],
    signalPrompts: ['perseverance', 'long-term thinking', 'goal orientation'],
    followUpPrompts: [
      { text: 'What keeps you committed to your work?', tags: [] },
      { text: 'How do you handle periods of high stress or difficulty?', tags: [] },
    ],
    active: true,
    maxScore: 10,
    signals: ['perseverance', 'goal orientation', 'stress management'],
    scoringCriteria:
      'Score based on perseverance through challenges, goal orientation, and stress management effectiveness.',
    updateFrequency: 'weekly',
    decayRate: 0.03,
    conditionalPrompts: [],
  },
  {
    id: 'adaptability',
    name: 'Adaptability',
    definition: 'Flexibility when plans change or new expectations arise.',
    category: 'Behavioral',
    weight: 0.7,
    decayType: 'exponential',
    aiGuidance: 'Adaptability is about being flexible and open to change.',
    starterPrompts: [
      'Tell me about a time you had to change your approach quickly.',
      'How do you handle unexpected changes in your work schedule?',
    ],
    signalPrompts: ['flexibility', 'change acceptance', 'quick adaptation'],
    followUpPrompts: [
      { text: 'How do you adjust when plans change at the last minute?', tags: [] },
      { text: 'What strategies do you use to adapt to new situations?', tags: [] },
    ],
    active: true,
    maxScore: 10,
    signals: ['flexibility', 'change acceptance', 'quick adaptation'],
    scoringCriteria:
      'Score based on flexibility demonstrated, change acceptance, and speed of adaptation.',
    updateFrequency: 'daily',
    decayRate: 0.07,
    conditionalPrompts: [],
  },
  {
    id: 'integrity',
    name: 'Integrity',
    definition: 'Honesty, ethics, and doing the right thing when no one is watching.',
    category: 'Behavioral',
    weight: 0.9,
    decayType: 'manual',
    aiGuidance: 'Integrity is about being honest and ethical in all your actions.',
    starterPrompts: [
      'Tell me about a time when you had to make an ethical decision.',
      'How do you ensure you always do the right thing?',
    ],
    signalPrompts: ['honest behavior', 'ethical decisions', 'transparency'],
    followUpPrompts: [
      { text: 'What would you do if you saw someone doing something wrong?', tags: [] },
      { text: "How do you handle situations where the right choice isn't clear?", tags: [] },
    ],
    active: true,
    maxScore: 10,
    signals: ['honest behavior', 'ethical decisions', 'transparency'],
    scoringCriteria:
      'Score based on honest behavior, ethical decision-making, and transparency in actions.',
    updateFrequency: 'monthly',
    decayRate: 0.02,
    conditionalPrompts: [],
  },
  {
    id: 'initiative',
    name: 'Initiative',
    definition: 'Willingness to go above and beyond without being told.',
    category: 'Behavioral',
    weight: 0.8,
    decayType: 'linear',
    aiGuidance: 'Initiative is about taking action and going beyond basic duties.',
    starterPrompts: [
      'When have you noticed a problem and taken action to fix it?',
      'Tell me about a time when you went beyond your basic job duties.',
    ],
    signalPrompts: ['proactive behavior', 'problem identification', 'extra effort'],
    followUpPrompts: [
      { text: 'How do you identify opportunities to improve your work?', tags: [] },
      { text: 'What motivates you to go above and beyond?', tags: [] },
    ],
    active: true,
    maxScore: 10,
    signals: ['proactive behavior', 'problem identification', 'extra effort'],
    scoringCriteria:
      'Score based on proactive behaviors, problem identification, and willingness to go beyond basic duties.',
    updateFrequency: 'weekly',
    decayRate: 0.04,
    conditionalPrompts: [],
  },
];

const defaultMasterRules: MasterRules = {
  scoringMethod: 'weighted',
  updateLogic: 'immediate',
  decayLogic: 'exponential',
  minScoreThreshold: 1,
  maxScoreThreshold: 10,
  confidenceThreshold: 0.7,
  signalWeightMultiplier: 1.0,
  promptWeightMultiplier: 0.8,
  behaviorWeightMultiplier: 1.2,
};

const TraitsEngine: React.FC = () => {
  const [traits, setTraits] = useState<Trait[]>(defaultTraits);
  const [masterRules, setMasterRules] = useState<MasterRules>(defaultMasterRules);
  const [editingTrait, setEditingTrait] = useState<string | null>(null);
  const [editingRules, setEditingRules] = useState(false);
  const [activeTab, setActiveTab] = useState(0);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    fetchTraitsAndRules();
  }, []);

  const fetchTraitsAndRules = async () => {
    setLoading(true);
    try {
      // Fetch traits
      const traitsRef = doc(db, 'appAiSettings', 'traitsEngine');
      const traitsSnap = await getDoc(traitsRef);
      if (traitsSnap.exists()) {
        setTraits(traitsSnap.data().traits || defaultTraits);
      } else {
        setTraits(defaultTraits);
      }

      // Fetch master rules
      const rulesRef = doc(db, 'appAiSettings', 'masterRules');
      const rulesSnap = await getDoc(rulesRef);
      if (rulesSnap.exists()) {
        setMasterRules((rulesSnap.data() as MasterRules) || defaultMasterRules);
      } else {
        setMasterRules(defaultMasterRules);
      }
    } catch (err: any) {
      setError('Failed to fetch traits and rules');
    }
    setLoading(false);
  };

  const handleTraitSave = async () => {
    try {
      const ref = doc(db, 'appAiSettings', 'traitsEngine');
      await setDoc(ref, { traits }, { merge: true });
      setEditingTrait(null);
      setSuccess(true);
    } catch (err: any) {
      setError('Failed to save traits');
    }
  };

  const handleRulesSave = async () => {
    try {
      const ref = doc(db, 'appAiSettings', 'masterRules');
      await setDoc(ref, masterRules, { merge: true });
      setEditingRules(false);
      setSuccess(true);
    } catch (err: any) {
      setError('Failed to save master rules');
    }
  };

  const handleTraitChange = (traitId: string, field: keyof Trait, value: any) => {
    setTraits((prev) =>
      prev.map((trait) => (trait.id === traitId ? { ...trait, [field]: value } : trait)),
    );
  };

  const handleArrayFieldChange = (traitId: string, field: keyof Trait, value: string) => {
    const arrayValue = value
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean);
    handleTraitChange(traitId, field, arrayValue);
  };

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'Core':
        return '#1976d2';
      case 'Soft Skill':
        return '#2e7d32';
      case 'Behavioral':
        return '#ed6c02';
      case 'Leadership':
        return '#2e7d32';
      case 'Technical':
        return '#ed6c02';
      case 'Custom':
        return '#666';
      default:
        return '#666';
    }
  };

  return (
    <Box sx={{ p: 0, maxWidth: 1400, mx: 'auto' }}>
      <Box display="flex" alignItems="center" justifyContent="space-between" mb={2}>
        <Box>
          <Typography variant="h3" gutterBottom>
            Traits Engine
          </Typography>
          <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
            Configure the 10 core traits that the AI uses to assess and engage with workers.
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
        <>
          <Tabs value={activeTab} onChange={(_, newValue) => setActiveTab(newValue)} sx={{ mb: 3 }}>
            <Tab label="Traits Configuration" />
            <Tab label="Master Rules" />
            <Tab label="Overview" />
          </Tabs>
          {activeTab === 0 && (
            <Grid container spacing={3}>
              {traits.map((trait) => (
                <Grid item xs={12} key={trait.id}>
                  <Paper sx={{ p: 3 }}>
                    <Box
                      sx={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        mb: 2,
                      }}
                    >
                      <Box>
                        <Typography variant="h6">{trait.name}</Typography>
                        <Typography variant="body2" color="text.secondary">
                          {trait.definition}
                        </Typography>
                        <Chip
                          label={trait.category}
                          size="small"
                          sx={{
                            mt: 1,
                            backgroundColor: getCategoryColor(trait.category),
                            color: 'white',
                          }}
                        />
                      </Box>
                      <Box sx={{ display: 'flex', gap: 1 }}>
                        <FormControlLabel
                          control={
                            <Switch
                              checked={trait.active}
                              onChange={(e) =>
                                handleTraitChange(trait.id, 'active', e.target.checked)
                              }
                            />
                          }
                          label="Active"
                        />
                        {editingTrait === trait.id ? (
                          <>
                            <IconButton color="primary" onClick={handleTraitSave}>
                              <SaveIcon />
                            </IconButton>
                            <IconButton onClick={() => setEditingTrait(null)}>
                              <CancelIcon />
                            </IconButton>
                          </>
                        ) : (
                          <IconButton onClick={() => setEditingTrait(trait.id)}>
                            <EditIcon />
                          </IconButton>
                        )}
                      </Box>
                    </Box>

                    {editingTrait === trait.id ? (
                      <Box>
                        <Accordion defaultExpanded>
                          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                            <Typography fontWeight={600}>Overview</Typography>
                          </AccordionSummary>
                          <AccordionDetails>
                            <Grid container spacing={3}>
                              <Grid item xs={12} md={6}>
                                <FormControl fullWidth>
                                  <InputLabel>Category</InputLabel>
                                  <Select
                                    value={trait.category}
                                    label="Category"
                                    onChange={(e) =>
                                      handleTraitChange(trait.id, 'category', e.target.value)
                                    }
                                  >
                                    <MenuItem value="Core">Core</MenuItem>
                                    <MenuItem value="Soft Skill">Soft Skill</MenuItem>
                                    <MenuItem value="Behavioral">Behavioral</MenuItem>
                                    <MenuItem value="Leadership">Leadership</MenuItem>
                                    <MenuItem value="Technical">Technical</MenuItem>
                                    <MenuItem value="Custom">Custom</MenuItem>
                                  </Select>
                                </FormControl>
                              </Grid>
                              <Grid item xs={12} md={6}>
                                <Typography gutterBottom>Weight: {trait.weight}</Typography>
                                <Slider
                                  value={trait.weight}
                                  min={0}
                                  max={1}
                                  step={0.01}
                                  onChange={(_, value) =>
                                    handleTraitChange(trait.id, 'weight', value)
                                  }
                                />
                              </Grid>
                              <Grid item xs={12}>
                                <TextField
                                  label="AI Guidance"
                                  fullWidth
                                  multiline
                                  minRows={2}
                                  value={trait.aiGuidance}
                                  onChange={(e) =>
                                    handleTraitChange(trait.id, 'aiGuidance', e.target.value)
                                  }
                                  helperText="Special instructions to the AI engine when probing this trait"
                                />
                              </Grid>
                            </Grid>
                          </AccordionDetails>
                        </Accordion>
                        <Accordion>
                          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                            <Typography fontWeight={600}>Prompts & Signals</Typography>
                          </AccordionSummary>
                          <AccordionDetails>
                            <Grid container spacing={3}>
                              <Grid item xs={12}>
                                <TextField
                                  label="Starter Prompts (one per line)"
                                  fullWidth
                                  multiline
                                  minRows={3}
                                  value={trait.starterPrompts.join('\n')}
                                  onChange={(e) =>
                                    handleArrayFieldChange(
                                      trait.id,
                                      'starterPrompts',
                                      e.target.value,
                                    )
                                  }
                                  helperText="Initial questions the AI asks to assess this trait"
                                />
                              </Grid>
                              <Grid item xs={12}>
                                <TextField
                                  label="Signal Prompts (one per line)"
                                  fullWidth
                                  multiline
                                  minRows={3}
                                  value={trait.signalPrompts.join('\n')}
                                  onChange={(e) =>
                                    handleArrayFieldChange(
                                      trait.id,
                                      'signalPrompts',
                                      e.target.value,
                                    )
                                  }
                                  helperText="Keywords and phrases the AI looks for to detect this trait"
                                />
                              </Grid>
                              <Grid item xs={12}>
                                <TextField
                                  label="Follow-up Prompts (one per line)"
                                  fullWidth
                                  multiline
                                  minRows={3}
                                  value={trait.followUpPrompts.map((p) => p.text).join('\n')}
                                  onChange={(e) =>
                                    handleArrayFieldChange(
                                      trait.id,
                                      'followUpPrompts',
                                      e.target.value,
                                    )
                                  }
                                  helperText="Additional questions to dig deeper into this trait (tags coming soon)"
                                />
                              </Grid>
                              <Grid item xs={12}>
                                <TextField
                                  label="Behavioral Signals (one per line)"
                                  fullWidth
                                  multiline
                                  minRows={2}
                                  value={trait.signals.join('\n')}
                                  onChange={(e) =>
                                    handleArrayFieldChange(trait.id, 'signals', e.target.value)
                                  }
                                  helperText="Specific behaviors that indicate this trait"
                                />
                              </Grid>
                            </Grid>
                          </AccordionDetails>
                        </Accordion>
                        <Accordion>
                          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                            <Typography fontWeight={600}>Scoring Rules</Typography>
                          </AccordionSummary>
                          <AccordionDetails>
                            <Grid container spacing={3}>
                              <Grid item xs={12} md={6}>
                                <TextField
                                  label="Max Score"
                                  type="number"
                                  fullWidth
                                  value={trait.maxScore}
                                  onChange={(e) =>
                                    handleTraitChange(
                                      trait.id,
                                      'maxScore',
                                      parseInt(e.target.value),
                                    )
                                  }
                                  inputProps={{ min: 1, max: 10 }}
                                />
                              </Grid>
                              <Grid item xs={12} md={6}>
                                <FormControl fullWidth>
                                  <InputLabel>Update Frequency</InputLabel>
                                  <Select
                                    value={trait.updateFrequency}
                                    label="Update Frequency"
                                    onChange={(e) =>
                                      handleTraitChange(trait.id, 'updateFrequency', e.target.value)
                                    }
                                  >
                                    <MenuItem value="daily">Daily</MenuItem>
                                    <MenuItem value="weekly">Weekly</MenuItem>
                                    <MenuItem value="monthly">Monthly</MenuItem>
                                  </Select>
                                </FormControl>
                              </Grid>
                              <Grid item xs={12} md={6}>
                                <FormControl fullWidth>
                                  <InputLabel>Decay Type</InputLabel>
                                  <Select
                                    value={trait.decayType}
                                    label="Decay Type"
                                    onChange={(e) =>
                                      handleTraitChange(trait.id, 'decayType', e.target.value)
                                    }
                                  >
                                    <MenuItem value="linear">Linear</MenuItem>
                                    <MenuItem value="exponential">Exponential</MenuItem>
                                    <MenuItem value="manual">Manual Reset on Trigger</MenuItem>
                                    <MenuItem value="pause">Pause During Leave</MenuItem>
                                  </Select>
                                </FormControl>
                              </Grid>
                              <Grid item xs={12} md={6}>
                                <Typography gutterBottom>Decay Rate: {trait.decayRate}</Typography>
                                <Slider
                                  value={trait.decayRate}
                                  min={0}
                                  max={0.5}
                                  step={0.01}
                                  onChange={(_, value) =>
                                    handleTraitChange(trait.id, 'decayRate', value)
                                  }
                                />
                              </Grid>
                              <Grid item xs={12}>
                                <TextField
                                  label="Scoring Criteria"
                                  fullWidth
                                  multiline
                                  minRows={2}
                                  value={trait.scoringCriteria}
                                  onChange={(e) =>
                                    handleTraitChange(trait.id, 'scoringCriteria', e.target.value)
                                  }
                                  helperText="Guidelines for how the AI should score this trait"
                                />
                              </Grid>
                            </Grid>
                          </AccordionDetails>
                        </Accordion>
                        <Accordion>
                          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                            <Typography fontWeight={600}>Advanced AI Settings</Typography>
                          </AccordionSummary>
                          <AccordionDetails>
                            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                              Define conditional prompts for dynamic journeys (e.g., "if
                              worker.tenure &gt; 6 months: ask ...").
                            </Typography>
                            {trait.conditionalPrompts &&
                              trait.conditionalPrompts.length > 0 &&
                              trait.conditionalPrompts.map((cp, idx) => (
                                <Box key={idx} display="flex" alignItems="center" gap={2} mb={1}>
                                  <TextField
                                    label="Condition"
                                    value={cp.condition}
                                    onChange={(e) => {
                                      const newPrompts = [...(trait.conditionalPrompts || [])];
                                      newPrompts[idx].condition = e.target.value;
                                      handleTraitChange(trait.id, 'conditionalPrompts', newPrompts);
                                    }}
                                    size="small"
                                    sx={{ flex: 2 }}
                                  />
                                  <TextField
                                    label="Prompt"
                                    value={cp.prompt}
                                    onChange={(e) => {
                                      const newPrompts = [...(trait.conditionalPrompts || [])];
                                      newPrompts[idx].prompt = e.target.value;
                                      handleTraitChange(trait.id, 'conditionalPrompts', newPrompts);
                                    }}
                                    size="small"
                                    sx={{ flex: 3 }}
                                  />
                                  <IconButton
                                    color="error"
                                    onClick={() => {
                                      const newPrompts = [...(trait.conditionalPrompts || [])];
                                      newPrompts.splice(idx, 1);
                                      handleTraitChange(trait.id, 'conditionalPrompts', newPrompts);
                                    }}
                                  >
                                    <CancelIcon />
                                  </IconButton>
                                </Box>
                              ))}
                            <Button
                              variant="outlined"
                              size="small"
                              onClick={() => {
                                const newPrompts = [...(trait.conditionalPrompts || [])];
                                newPrompts.push({ condition: '', prompt: '' });
                                handleTraitChange(trait.id, 'conditionalPrompts', newPrompts);
                              }}
                              sx={{ mt: 1 }}
                            >
                              Add Conditional Prompt
                            </Button>
                          </AccordionDetails>
                        </Accordion>
                      </Box>
                    ) : (
                      <Box>
                        <Typography variant="subtitle2" gutterBottom>
                          Current Configuration:
                        </Typography>
                        <Grid container spacing={2}>
                          <Grid item xs={3}>
                            <Typography variant="caption" color="text.secondary">
                              Max Score
                            </Typography>
                            <Typography>{trait.maxScore}</Typography>
                          </Grid>
                          <Grid item xs={3}>
                            <Typography variant="caption" color="text.secondary">
                              Update Frequency
                            </Typography>
                            <Typography sx={{ textTransform: 'capitalize' }}>
                              {trait.updateFrequency}
                            </Typography>
                          </Grid>
                          <Grid item xs={3}>
                            <Typography variant="caption" color="text.secondary">
                              Decay Rate
                            </Typography>
                            <Typography>{trait.decayRate}</Typography>
                          </Grid>
                          <Grid item xs={3}>
                            <Typography variant="caption" color="text.secondary">
                              Prompts
                            </Typography>
                            <Typography>
                              {trait.starterPrompts.length +
                                trait.signalPrompts.length +
                                trait.followUpPrompts.length}
                            </Typography>
                          </Grid>
                        </Grid>
                      </Box>
                    )}
                  </Paper>
                </Grid>
              ))}
            </Grid>
          )}
          {activeTab === 1 && (
            <Paper sx={{ p: 3, mb: 4 }}>
              <Typography variant="h6">Master Rules</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                Configure the rules for how the AI should evaluate the traits.
              </Typography>
              <Grid container spacing={3}>
                <Grid item xs={12} md={6}>
                  <FormControl fullWidth>
                    <InputLabel>Scoring Method</InputLabel>
                    <Select
                      value={masterRules.scoringMethod}
                      label="Scoring Method"
                      onChange={(e) => handleRulesSave()}
                    >
                      <MenuItem value="cumulative">Cumulative</MenuItem>
                      <MenuItem value="averaged">Averaged</MenuItem>
                      <MenuItem value="weighted">Weighted</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12} md={6}>
                  <FormControl fullWidth>
                    <InputLabel>Update Logic</InputLabel>
                    <Select
                      value={masterRules.updateLogic}
                      label="Update Logic"
                      onChange={(e) => handleRulesSave()}
                    >
                      <MenuItem value="immediate">Immediate</MenuItem>
                      <MenuItem value="batch">Batch</MenuItem>
                      <MenuItem value="scheduled">Scheduled</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12} md={6}>
                  <FormControl fullWidth>
                    <InputLabel>Decay Logic</InputLabel>
                    <Select
                      value={masterRules.decayLogic}
                      label="Decay Logic"
                      onChange={(e) => handleRulesSave()}
                    >
                      <MenuItem value="linear">Linear</MenuItem>
                      <MenuItem value="exponential">Exponential</MenuItem>
                      <MenuItem value="none">None</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12} md={6}>
                  <TextField
                    label="Min Score Threshold"
                    type="number"
                    fullWidth
                    value={masterRules.minScoreThreshold}
                    onChange={(e) => handleRulesSave()}
                    inputProps={{ min: 1, max: 10 }}
                  />
                </Grid>
                <Grid item xs={12} md={6}>
                  <TextField
                    label="Max Score Threshold"
                    type="number"
                    fullWidth
                    value={masterRules.maxScoreThreshold}
                    onChange={(e) => handleRulesSave()}
                    inputProps={{ min: 1, max: 10 }}
                  />
                </Grid>
                <Grid item xs={12} md={6}>
                  <TextField
                    label="Confidence Threshold"
                    type="number"
                    fullWidth
                    value={masterRules.confidenceThreshold}
                    onChange={(e) => handleRulesSave()}
                    inputProps={{ min: 0, max: 1 }}
                  />
                </Grid>
                <Grid item xs={12} md={6}>
                  <TextField
                    label="Signal Weight Multiplier"
                    type="number"
                    fullWidth
                    value={masterRules.signalWeightMultiplier}
                    onChange={(e) => handleRulesSave()}
                    inputProps={{ min: 0, max: 2 }}
                  />
                </Grid>
                <Grid item xs={12} md={6}>
                  <TextField
                    label="Prompt Weight Multiplier"
                    type="number"
                    fullWidth
                    value={masterRules.promptWeightMultiplier}
                    onChange={(e) => handleRulesSave()}
                    inputProps={{ min: 0, max: 1 }}
                  />
                </Grid>
                <Grid item xs={12} md={6}>
                  <TextField
                    label="Behavior Weight Multiplier"
                    type="number"
                    fullWidth
                    value={masterRules.behaviorWeightMultiplier}
                    onChange={(e) => handleRulesSave()}
                    inputProps={{ min: 0, max: 2 }}
                  />
                </Grid>
              </Grid>
              <Box mt={4}>
                <Typography variant="subtitle1" gutterBottom>
                  What do these settings mean?
                </Typography>
                <ul style={{ marginLeft: 20 }}>
                  <li>
                    <b>Scoring Method</b>: How trait scores are calculated (cumulative, averaged, or
                    weighted).
                  </li>
                  <li>
                    <b>Update Logic</b>: When trait scores are updated (immediately, in batches, or
                    on a schedule).
                  </li>
                  <li>
                    <b>Decay Logic</b>: How scores decrease over time if not reinforced (linear,
                    exponential, or none).
                  </li>
                  <li>
                    <b>Min Score Threshold</b>: The minimum score required for a trait to be
                    considered significant.
                  </li>
                  <li>
                    <b>Max Score Threshold</b>: The maximum possible score for a trait.
                  </li>
                  <li>
                    <b>Confidence Threshold</b>: The minimum confidence required before the AI
                    updates a trait score.
                  </li>
                  <li>
                    <b>Signal Weight Multiplier</b>: How much detected signals (keywords/behaviors)
                    influence the score.
                  </li>
                  <li>
                    <b>Prompt Weight Multiplier</b>: How much responses to AI prompts influence the
                    score.
                  </li>
                  <li>
                    <b>Behavior Weight Multiplier</b>: How much observed behaviors (actions)
                    influence the score.
                  </li>
                </ul>
              </Box>
            </Paper>
          )}
          {activeTab === 2 && (
            <Box>
              <Grid container spacing={3} mb={3}>
                <Grid item xs={12} md={4}>
                  <Paper sx={{ p: 3 }}>
                    <Typography variant="subtitle1" gutterBottom>
                      Active Traits
                    </Typography>
                    <Typography variant="h3" color="primary.main">
                      {traits.filter((t) => t.active).length}/{traits.length}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Currently active traits in the system
                    </Typography>
                  </Paper>
                </Grid>
                <Grid item xs={12} md={4}>
                  <Paper sx={{ p: 3 }}>
                    <Typography variant="subtitle1" gutterBottom>
                      Total Prompts
                    </Typography>
                    <Typography variant="h3" color="secondary.main">
                      {traits.reduce(
                        (sum, trait) =>
                          sum +
                          trait.starterPrompts.length +
                          trait.signalPrompts.length +
                          trait.followUpPrompts.length,
                        0,
                      )}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Total AI prompts across all traits
                    </Typography>
                  </Paper>
                </Grid>
                <Grid item xs={12} md={4}>
                  <Paper sx={{ p: 3 }}>
                    <Typography variant="subtitle1" gutterBottom>
                      Last Updated
                    </Typography>
                    <Typography variant="h5">
                      {/* Placeholder: You can wire this up to a real timestamp if you store it */}
                      --
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Last time traits or rules were updated
                    </Typography>
                  </Paper>
                </Grid>
              </Grid>
              <Paper sx={{ p: 3, mb: 3 }}>
                <Typography variant="h6" gutterBottom>
                  Trait Configuration
                </Typography>
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Trait</TableCell>
                        <TableCell>Category</TableCell>
                        <TableCell>Status</TableCell>
                        <TableCell>Max Score</TableCell>
                        <TableCell>Update Frequency</TableCell>
                        <TableCell>Decay Rate</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {traits.map((trait) => (
                        <TableRow key={trait.id}>
                          <TableCell>
                            <Typography variant="subtitle2">{trait.name}</Typography>
                            <Typography variant="caption" color="text.secondary">
                              {trait.definition}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Chip
                              label={trait.category}
                              size="small"
                              sx={{
                                backgroundColor: getCategoryColor(trait.category),
                                color: 'white',
                              }}
                            />
                          </TableCell>
                          <TableCell>
                            <Chip
                              label={trait.active ? 'Active' : 'Inactive'}
                              size="small"
                              color={trait.active ? 'success' : 'default'}
                            />
                          </TableCell>
                          <TableCell>{trait.maxScore}</TableCell>
                          <TableCell sx={{ textTransform: 'capitalize' }}>
                            {trait.updateFrequency}
                          </TableCell>
                          <TableCell>{trait.decayRate}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Paper>
              <Paper sx={{ p: 3, mb: 3 }}>
                <Typography variant="h6" gutterBottom>
                  Master Rules Snapshot
                </Typography>
                <Grid container spacing={2}>
                  <Grid item xs={12} md={4}>
                    <b>Scoring Method:</b> {masterRules.scoringMethod}
                  </Grid>
                  <Grid item xs={12} md={4}>
                    <b>Update Logic:</b> {masterRules.updateLogic}
                  </Grid>
                  <Grid item xs={12} md={4}>
                    <b>Decay Logic:</b> {masterRules.decayLogic}
                  </Grid>
                  <Grid item xs={12} md={4}>
                    <b>Min Score Threshold:</b> {masterRules.minScoreThreshold}
                  </Grid>
                  <Grid item xs={12} md={4}>
                    <b>Max Score Threshold:</b> {masterRules.maxScoreThreshold}
                  </Grid>
                  <Grid item xs={12} md={4}>
                    <b>Confidence Threshold:</b> {masterRules.confidenceThreshold}
                  </Grid>
                  <Grid item xs={12} md={4}>
                    <b>Signal Weight Multiplier:</b> {masterRules.signalWeightMultiplier}
                  </Grid>
                  <Grid item xs={12} md={4}>
                    <b>Prompt Weight Multiplier:</b> {masterRules.promptWeightMultiplier}
                  </Grid>
                  <Grid item xs={12} md={4}>
                    <b>Behavior Weight Multiplier:</b> {masterRules.behaviorWeightMultiplier}
                  </Grid>
                </Grid>
              </Paper>
              <Box display="flex" gap={2}>
                <Button variant="contained" color="primary" onClick={() => setActiveTab(0)}>
                  Edit Traits
                </Button>
                <Button variant="outlined" color="primary" onClick={() => setActiveTab(1)}>
                  Edit Master Rules
                </Button>
              </Box>
            </Box>
          )}
        </>
      )}
      <Snackbar open={success} autoHideDuration={3000} onClose={() => setSuccess(false)}>
        <Alert severity="success" sx={{ width: '100%' }}>
          Settings saved successfully!
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

export default TraitsEngine;
