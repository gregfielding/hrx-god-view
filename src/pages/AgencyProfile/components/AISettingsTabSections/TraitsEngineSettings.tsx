import React, { useState, useEffect } from 'react';
import {
  Paper,
  Typography,
  Grid,
  Button,
  Snackbar,
  Alert,
  Tooltip,
  IconButton,
  Box,
  Switch,
  FormControlLabel,
  Accordion,
  AccordionSummary,
  AccordionDetails,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import { doc, getDoc, setDoc } from 'firebase/firestore';

import { db } from '../../../../firebase';
import { LoggableSlider, LoggableTextField, LoggableSelect } from '../../../../components/LoggableField';
import { useAuth } from '../../../../contexts/AuthContext';

interface Trait {
  id: string;
  name: string;
  definition: string;
  category: string;
  weight: number;
  decayType: 'linear' | 'exponential' | 'manual';
  aiGuidance: string;
  starterPrompts: string[];
  signalPrompts: string[];
  followUpPrompts: { text: string; tags: string[] }[];
  active: boolean;
  maxScore: number;
  signals: string[];
  scoringCriteria: string;
  updateFrequency: string;
  decayRate: number;
  conditionalPrompts: any[];
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

interface TraitsEngineSettingsProps {
  tenantId: string;
}

const TraitsEngineSettings: React.FC<TraitsEngineSettingsProps> = ({ tenantId }) => {
  const [traits, setTraits] = useState<Trait[]>(defaultTraits);
  const [originalTraits, setOriginalTraits] = useState<Trait[]>(defaultTraits);
  const [masterRules, setMasterRules] = useState<MasterRules>(defaultMasterRules);
  const [originalMasterRules, setOriginalMasterRules] = useState<MasterRules>(defaultMasterRules);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const { currentUser } = useAuth();

  useEffect(() => {
    const fetchTraits = async () => {
      try {
        const traitsRef = doc(db, 'tenants', tenantId, 'aiSettings', 'traits');
        const traitsSnap = await getDoc(traitsRef);
        if (traitsSnap.exists()) {
          setTraits(traitsSnap.data().traits || defaultTraits);
          setOriginalTraits(traitsSnap.data().traits || defaultTraits);
          setMasterRules(traitsSnap.data().masterRules || defaultMasterRules);
          setOriginalMasterRules(traitsSnap.data().masterRules || defaultMasterRules);
        }
      } catch (err) {
        setError('Failed to fetch traits settings');
      }
    };
    fetchTraits();
  }, [tenantId]);

  const handleTraitChange = (traitId: string, field: keyof Trait, value: any) => {
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      Array.isArray(value) ||
      (typeof value === 'object' && value !== null && !(value instanceof Event) && !(value instanceof HTMLElement))
    ) {
      setTraits((prev) =>
        prev.map((trait) => (trait.id === traitId ? { ...trait, [field]: value } : trait)),
      );
    } else {
      console.warn('Ignoring unserializable value for trait field:', field, value);
    }
  };

  const handleMasterRuleChange = (field: keyof MasterRules, value: any) => {
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      Array.isArray(value) ||
      (typeof value === 'object' && value !== null && !(value instanceof Event) && !(value instanceof HTMLElement))
    ) {
      setMasterRules((prev) => ({ ...prev, [field]: value }));
    } else {
      console.warn('Ignoring unserializable value for master rule field:', field, value);
    }
  };

  const handleSave = async () => {
    try {
      const ref = doc(db, 'tenants', tenantId, 'aiSettings', 'traits');
      await setDoc(ref, { traits, masterRules }, { merge: true });
      // Logging hook
      await setDoc(doc(db, 'ai_logs', `${tenantId}_TraitsEngine_${Date.now()}`), {
        tenantId,
        section: 'TraitsEngine',
        changed: 'traits_masterRules',
        oldValue: { traits: originalTraits, masterRules: originalMasterRules },
        newValue: { traits, masterRules },
        timestamp: new Date().toISOString(),
        eventType: 'ai_settings_update',
        engineTouched: ['TraitsEngine'],
        userId: currentUser?.uid || null,
        sourceModule: 'TraitsEngine',
      });
      setOriginalTraits([...traits]);
      setOriginalMasterRules({ ...masterRules });
      setSuccess(true);
    } catch (err) {
      setError('Failed to save traits settings');
    }
  };

  const isChanged =
    JSON.stringify(traits) !== JSON.stringify(originalTraits) ||
    JSON.stringify(masterRules) !== JSON.stringify(originalMasterRules);

  return (
    <Paper sx={{ p: 3, mb: 4 }}>
      <Typography variant="h6" gutterBottom>
        Traits Engine Settings
        <Tooltip title="Configure which traits the AI tracks and how they are scored and updated.">
          <IconButton size="small" sx={{ ml: 1 }}>
            <HelpOutlineIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Typography>

      {/* Individual Traits */}
      <Accordion defaultExpanded>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography fontWeight={600}>Individual Traits</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Grid container spacing={3}>
            {traits.map((trait) => (
              <Grid item xs={12} key={trait.id}>
                <Accordion>
                  <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, width: '100%' }}>
                      <FormControlLabel
                        control={
                          <Switch
                            checked={trait.active}
                            onChange={(e) =>
                              handleTraitChange(trait.id, 'active', e.target.checked)
                            }
                          />
                        }
                        label=""
                      />
                      <Typography fontWeight={600}>{trait.name}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        ({trait.category})
                      </Typography>
                    </Box>
                  </AccordionSummary>
                  <AccordionDetails>
                    <Grid container spacing={3}>
                      <Grid item xs={12}>
                        <Typography variant="body2" color="text.secondary" gutterBottom>
                          {trait.definition}
                        </Typography>
                      </Grid>
                      <Grid item xs={12} md={6}>
                        <LoggableSlider
                          fieldPath={`tenants:${tenantId}.aiSettings.traits.${trait.id}.weight`}
                          trigger="update"
                          destinationModules={['TraitsEngine', 'ContextEngine']}
                          value={trait.weight}
                          onChange={(valueOrEvent: any, maybeValue?: any) => {
                            const value = typeof valueOrEvent === 'number' ? valueOrEvent : maybeValue;
                            handleTraitChange(trait.id, 'weight', value);
                          }}
                          min={0}
                          max={1}
                          step={0.01}
                          label={`${trait.name} Weight`}
                          contextType="traits"
                          urgencyScore={4}
                          description={`Agency trait ${trait.id} weight setting`}
                        />
                      </Grid>
                      <Grid item xs={12}>
                        <LoggableTextField
                          fieldPath={`tenants:${tenantId}.aiSettings.traits.${trait.id}.aiGuidance`}
                          trigger="update"
                          destinationModules={['TraitsEngine', 'ContextEngine']}
                          value={trait.aiGuidance}
                          onChange={(value: string) =>
                            handleTraitChange(trait.id, 'aiGuidance', value)
                          }
                          label="AI Guidance"
                          multiline
                          rows={2}
                          placeholder="Special instructions to the AI engine when probing this trait"
                          contextType="traits"
                          urgencyScore={3}
                          description={`Agency trait ${trait.id} AI guidance`}
                        />
                      </Grid>
                    </Grid>
                  </AccordionDetails>
                </Accordion>
              </Grid>
            ))}
          </Grid>
        </AccordionDetails>
      </Accordion>

      {/* Master Rules */}
      <Accordion>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography fontWeight={600}>Master Rules</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Grid container spacing={3}>
            <Grid item xs={12} md={6}>
              <LoggableSelect
                fieldPath={`tenants:${tenantId}.aiSettings.traits.masterRules.scoringMethod`}
                trigger="update"
                destinationModules={['TraitsEngine', 'ContextEngine']}
                value={masterRules.scoringMethod}
                onChange={(value: string) => handleMasterRuleChange('scoringMethod', value)}
                label="Scoring Method"
                options={[
                  { value: 'cumulative', label: 'Cumulative' },
                  { value: 'averaged', label: 'Averaged' },
                  { value: 'weighted', label: 'Weighted' }
                ]}
                contextType="traits"
                urgencyScore={4}
                description="Agency traits scoring method"
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <LoggableSelect
                fieldPath={`tenants:${tenantId}.aiSettings.traits.masterRules.updateLogic`}
                trigger="update"
                destinationModules={['TraitsEngine', 'ContextEngine']}
                value={masterRules.updateLogic}
                onChange={(value: string) => handleMasterRuleChange('updateLogic', value)}
                label="Update Logic"
                options={[
                  { value: 'immediate', label: 'Immediate' },
                  { value: 'batch', label: 'Batch' },
                  { value: 'scheduled', label: 'Scheduled' }
                ]}
                contextType="traits"
                urgencyScore={4}
                description="Agency traits update logic"
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <LoggableSelect
                fieldPath={`tenants:${tenantId}.aiSettings.traits.masterRules.decayLogic`}
                trigger="update"
                destinationModules={['TraitsEngine', 'ContextEngine']}
                value={masterRules.decayLogic}
                onChange={(value: string) => handleMasterRuleChange('decayLogic', value)}
                label="Decay Logic"
                options={[
                  { value: 'linear', label: 'Linear' },
                  { value: 'exponential', label: 'Exponential' },
                  { value: 'none', label: 'None' }
                ]}
                contextType="traits"
                urgencyScore={4}
                description="Agency traits decay logic"
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <LoggableTextField
                fieldPath={`tenants:${tenantId}.aiSettings.traits.masterRules.confidenceThreshold`}
                trigger="update"
                destinationModules={['TraitsEngine', 'ContextEngine']}
                value={masterRules.confidenceThreshold.toString()}
                onChange={(value: string) =>
                  handleMasterRuleChange('confidenceThreshold', parseFloat(value))
                }
                label="Confidence Threshold"
                placeholder="0.0 to 1.0"
                contextType="traits"
                urgencyScore={4}
                description="Agency traits confidence threshold"
              />
            </Grid>
            <Grid item xs={12} md={4}>
              <LoggableTextField
                fieldPath={`tenants:${tenantId}.aiSettings.traits.masterRules.minScoreThreshold`}
                trigger="update"
                destinationModules={['TraitsEngine', 'ContextEngine']}
                value={masterRules.minScoreThreshold.toString()}
                onChange={(value: string) =>
                  handleMasterRuleChange('minScoreThreshold', parseInt(value))
                }
                label="Min Score Threshold"
                placeholder="0 to 100"
                contextType="traits"
                urgencyScore={4}
                description="Agency traits min score threshold"
              />
            </Grid>
            <Grid item xs={12} md={4}>
              <LoggableTextField
                fieldPath={`tenants:${tenantId}.aiSettings.traits.masterRules.maxScoreThreshold`}
                trigger="update"
                destinationModules={['TraitsEngine', 'ContextEngine']}
                value={masterRules.maxScoreThreshold.toString()}
                onChange={(value: string) =>
                  handleMasterRuleChange('maxScoreThreshold', parseInt(value))
                }
                label="Max Score Threshold"
                placeholder="0 to 100"
                contextType="traits"
                urgencyScore={4}
                description="Agency traits max score threshold"
              />
            </Grid>
            <Grid item xs={12} md={4}>
              <LoggableTextField
                fieldPath={`tenants:${tenantId}.aiSettings.traits.masterRules.signalWeightMultiplier`}
                trigger="update"
                destinationModules={['TraitsEngine', 'ContextEngine']}
                value={masterRules.signalWeightMultiplier.toString()}
                onChange={(value: string) =>
                  handleMasterRuleChange('signalWeightMultiplier', parseFloat(value))
                }
                label="Signal Weight Multiplier"
                placeholder="0.0 to 10.0"
                contextType="traits"
                urgencyScore={4}
                description="Agency traits signal weight multiplier"
              />
            </Grid>
          </Grid>
        </AccordionDetails>
      </Accordion>

      <Button variant="contained" onClick={handleSave} disabled={!isChanged} sx={{ mt: 3 }}>
        Save Traits Engine Settings
      </Button>

      <Snackbar open={success} autoHideDuration={2000} onClose={() => setSuccess(false)}>
        <Alert severity="success" sx={{ width: '100%' }}>
          Traits engine settings updated!
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

export default TraitsEngineSettings;
