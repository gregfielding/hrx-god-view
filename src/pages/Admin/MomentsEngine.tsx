import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Paper,
  Grid,
  TextField,
  Button,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  IconButton,
  Switch,
  FormControlLabel,
  Snackbar,
  Alert,
  Chip,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Slider,
  Tabs,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Avatar,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import EditIcon from '@mui/icons-material/Edit';
import SaveIcon from '@mui/icons-material/Save';
import CancelIcon from '@mui/icons-material/Cancel';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import VisibilityIcon from '@mui/icons-material/Visibility';
import CakeIcon from '@mui/icons-material/Cake';
import SendIcon from '@mui/icons-material/Send';
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { getFunctions, httpsCallable } from 'firebase/functions';

import { db } from '../../firebase';

interface EligibilityRule {
  type:
    | 'tenure_days'
    | 'performance_score'
    | 'trait_score'
    | 'schedule'
    | 'inactivity'
    | 'custom'
    | 'companion_join_date'
    | 'first_time_user';
  min?: number;
  max?: number;
  trait?: string;
  threshold?: number;
  schedule?: string;
  inactivityDays?: number;
  customCondition?: string;
  companionJoinDate?: Date;
  firstTimeUser?: boolean;
}

interface FollowUp {
  enabled: boolean;
  delayDays: number;
  prompts: string[];
}

interface ScoringImpact {
  trait: string;
  impact: number;
  condition?: string;
}

interface ToneOverride {
  friendliness?: number;
  formality?: number;
  empathy?: number;
  directness?: number;
}

interface MomentHistory {
  totalFired: number;
  responseRate: number;
  avgTraitShift: Record<string, number>;
  lastFired?: Date;
  recentResponses: string[];
}

interface MomentTiming {
  type: 'tenure_based' | 'recurring' | 'trait_decay' | 'manual';
  condition?: {
    field:
      | 'tenure_days'
      | 'trait:reliability'
      | 'trait:engagement'
      | 'trait:satisfaction'
      | 'trait:learning_engagement'
      | 'trait:growth_mindset'
      | 'trait:motivation'
      | 'trait:retention_risk';
    operator: '>=' | '<=' | '==' | '!=';
    value: number;
  };
  recurrence?: 'monthly' | 'quarterly' | 'custom';
  customDays?: number;
  followUpDays?: number;
  maxRetries?: number;
  retryDelayDays?: number;
}

interface ScheduledMoment {
  id: string;
  workerId: string;
  momentId: string;
  scheduledFor: Date;
  status: 'pending' | 'completed' | 'missed' | 'retry';
  retryCount: number;
  triggeredBy: 'tenure' | 'recurrence' | 'trait_decay' | 'manual';
  lastAttempt?: Date;
  nextRetry?: Date;
  responseData?: {
    traitsUpdated: Record<string, number>;
    notes: string;
    sentiment: 'positive' | 'neutral' | 'negative';
  };
  createdAt: Date;
  updatedAt: Date;
}

interface Moment {
  id?: string;
  title: string;
  description: string;
  category: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  status: 'active' | 'paused';
  statusReason?: string;
  eligibilityRule: EligibilityRule;
  followUp: FollowUp;
  traitsTracked: string[];
  outcomeGoals: string[];
  prompts: string[];
  followUpPrompts: string[];
  scoringImpacts: ScoringImpact[];
  toneOverride?: ToneOverride;
  aiModifierNotes?: string;
  history?: MomentHistory;
  timing?: MomentTiming;
  createdAt?: Date;
  updatedAt?: Date;
}

interface BirthdayUser {
  id: string;
  firstName: string;
  lastName: string;
  dob: any;
  department?: string;
  jobTitle?: string;
  location?: string;
  tenantId?: string;
  wantsBirthdayAcknowledgement?: boolean;
  lastBirthdayAcknowledged?: any;
}

interface BirthdayMessage {
  workerId: string;
  messageText: string;
  giftType: string;
  giftValue?: string;
  tenantId?: string;
}

const defaultMoments: Moment[] = [
  {
    title: 'First Encounter Calibration',
    description: 'Determine user tenure and set expectations for engagement',
    category: 'onboarding',
    priority: 'critical',
    status: 'active',
    eligibilityRule: {
      type: 'custom',
      customCondition: 'first_time_user == true',
    },
    followUp: {
      enabled: false,
      delayDays: 0,
      prompts: [],
    },
    traitsTracked: ['engagement', 'adaptability', 'communication'],
    outcomeGoals: ['Calibrate engagement pace', 'Set user expectations'],
    prompts: [
      "Hi! I'm here to help you navigate work, growth, and feedback. Just to get started:",
      'How long have you been with [Company Name]?',
      'What brings you to using this platform today?',
    ],
    followUpPrompts: [],
    scoringImpacts: [
      { trait: 'engagement', impact: 0.1 },
      { trait: 'adaptability', impact: 0.05 },
    ],
    toneOverride: { friendliness: 0.9, formality: 0.3 },
    aiModifierNotes:
      'Be welcoming and patient. Use this to determine pacing tier (onboarding_new, onboarding_mid, onboarding_veteran).',
    timing: {
      type: 'manual',
      maxRetries: 2,
      retryDelayDays: 3,
    },
  },
  {
    title: 'First Week Welcome',
    description: 'Warm welcome and initial engagement for new workers',
    category: 'onboarding',
    priority: 'high',
    status: 'active',
    eligibilityRule: {
      type: 'custom',
      customCondition: 'tenure <= 7 && companion_join_date - company_join_date <= 7 days',
    },
    followUp: {
      enabled: true,
      delayDays: 3,
      prompts: ['How has your second week been going? Any challenges or wins to share?'],
    },
    traitsTracked: ['engagement', 'communication', 'adaptability'],
    outcomeGoals: ['Increase early retention', 'Build trust quickly'],
    prompts: [
      'How are you feeling about your first week?',
      'What questions do you have about your role?',
      'Is there anything that would help you feel more comfortable?',
    ],
    followUpPrompts: [],
    scoringImpacts: [
      { trait: 'engagement', impact: 0.2 },
      { trait: 'communication', impact: 0.1 },
    ],
    toneOverride: { friendliness: 0.9, formality: 0.3 },
    aiModifierNotes: 'Be extra welcoming and patient. Focus on building comfort and trust.',
    timing: {
      type: 'tenure_based',
      condition: {
        field: 'tenure_days',
        operator: '<=',
        value: 7,
      },
      followUpDays: 3,
      maxRetries: 2,
      retryDelayDays: 2,
    },
  },
  {
    title: 'Intro for Established Worker',
    description: 'Low-frequency introduction for long-tenure users new to Companion',
    category: 'onboarding',
    priority: 'medium',
    status: 'active',
    eligibilityRule: {
      type: 'custom',
      customCondition: 'tenure > 30 && first_time_user == true',
    },
    followUp: {
      enabled: false,
      delayDays: 0,
      prompts: [],
    },
    traitsTracked: ['engagement', 'openness_to_change'],
    outcomeGoals: ['Introduce Companion value', 'Build initial connection'],
    prompts: [
      "Welcome! I'm here to support your work and growth journey.",
      'What aspects of your role would you like to discuss or improve?',
      'How can I best support you in your work?',
    ],
    followUpPrompts: [],
    scoringImpacts: [
      { trait: 'engagement', impact: 0.1 },
      { trait: 'openness_to_change', impact: 0.05 },
    ],
    toneOverride: { friendliness: 0.7, formality: 0.5 },
    aiModifierNotes:
      'Keep it brief and low-pressure. Focus on value proposition for established workers.',
    timing: {
      type: 'manual',
      maxRetries: 1,
      retryDelayDays: 7,
    },
  },
  {
    title: '30-Day Check-in',
    description: 'Deep dive into worker satisfaction and growth',
    category: 'check-in',
    priority: 'high',
    status: 'active',
    eligibilityRule: {
      type: 'tenure_days',
      min: 25,
      max: 35,
    },
    followUp: {
      enabled: true,
      delayDays: 7,
      prompts: ['Based on our last conversation, how are things progressing?'],
    },
    traitsTracked: ['satisfaction', 'growth_mindset', 'teamwork', 'retention_risk'],
    outcomeGoals: ['Reduce early turnover', 'Identify growth opportunities'],
    prompts: [
      'How has your experience been so far?',
      'What aspects of the role do you enjoy most?',
      "Are there any areas where you'd like more support or training?",
      'How do you feel about your team and work environment?',
    ],
    followUpPrompts: [],
    scoringImpacts: [
      { trait: 'retention_risk', impact: -0.3, condition: 'positive_response' },
      { trait: 'satisfaction', impact: 0.2 },
    ],
    toneOverride: { empathy: 0.8, directness: 0.6 },
    timing: {
      type: 'tenure_based',
      condition: {
        field: 'tenure_days',
        operator: '>=',
        value: 25,
      },
      followUpDays: 7,
      maxRetries: 3,
      retryDelayDays: 3,
    },
  },
  {
    title: 'Quarterly Career Check-in',
    description: 'Regular career development and growth assessment',
    category: 'growth',
    priority: 'medium',
    status: 'active',
    eligibilityRule: {
      type: 'custom',
      customCondition: 'days_since(companion_join_date) % 90 == 0',
    },
    followUp: {
      enabled: true,
      delayDays: 14,
      prompts: ['How are your career development goals coming along?'],
    },
    traitsTracked: ['growth_mindset', 'motivation', 'retention_risk', 'career_ambition'],
    outcomeGoals: ['Support career growth', 'Increase retention', 'Identify development needs'],
    prompts: [
      'Are you learning what you want to be learning?',
      'If you could add a skill this year, what would it be?',
      'Are you open to certifications, mentorship, or training?',
      'What would make your role even more fulfilling?',
    ],
    followUpPrompts: [],
    scoringImpacts: [
      { trait: 'growth_mindset', impact: 0.2 },
      { trait: 'motivation', impact: 0.15 },
      { trait: 'retention_risk', impact: -0.2, condition: 'positive_response' },
    ],
    toneOverride: { friendliness: 0.8, formality: 0.6 },
    aiModifierNotes:
      'Focus on growth opportunities and career development. Be encouraging about learning and advancement.',
    timing: {
      type: 'recurring',
      recurrence: 'quarterly',
      followUpDays: 14,
      maxRetries: 2,
      retryDelayDays: 7,
    },
  },
  {
    title: 'Career Growth & Learning Thread',
    description: 'Continuous async support for career development and learning goals',
    category: 'growth',
    priority: 'low',
    status: 'active',
    eligibilityRule: {
      type: 'custom',
      customCondition: 'opt_in_career_growth == true OR mentions_learning_goals == true',
    },
    followUp: {
      enabled: true,
      delayDays: 30,
      prompts: ["How are your learning goals progressing? Any new skills you're developing?"],
    },
    traitsTracked: ['growth_mindset', 'motivation', 'career_ambition', 'learning_engagement'],
    outcomeGoals: [
      'Support continuous learning',
      'Track career development',
      'Increase engagement',
    ],
    prompts: [
      'What skills are you currently working on?',
      'How can I support your learning journey?',
      'What are your short-term and long-term career goals?',
      "Are there any training programs or certifications you're interested in?",
    ],
    followUpPrompts: [],
    scoringImpacts: [
      { trait: 'growth_mindset', impact: 0.15 },
      { trait: 'learning_engagement', impact: 0.2 },
    ],
    toneOverride: { friendliness: 0.8, empathy: 0.7 },
    aiModifierNotes:
      'Maintain ongoing support for learning goals. Provide encouragement and track progress over time.',
    timing: {
      type: 'trait_decay',
      condition: {
        field: 'trait:learning_engagement',
        operator: '<=',
        value: 3,
      },
      followUpDays: 30,
      maxRetries: 2,
      retryDelayDays: 14,
    },
  },
  {
    title: '6-Month Burnout Scan',
    description: 'Identify early signs of burnout and provide support',
    category: 'crisis',
    priority: 'critical',
    status: 'active',
    eligibilityRule: {
      type: 'custom',
      customCondition:
        'retention_risk > 6 OR (low_engagement == true AND no_feedback_last_30_days == true)',
    },
    followUp: {
      enabled: true,
      delayDays: 5,
      prompts: ["I wanted to check in on how you're feeling after our last conversation."],
    },
    traitsTracked: ['burnout_risk', 'stress_management', 'support_needs'],
    outcomeGoals: ['Prevent burnout', 'Increase retention'],
    prompts: [
      'How has your energy level been lately?',
      'Do you feel like you have a good work-life balance?',
      'What aspects of your work are most challenging right now?',
      'How supported do you feel by your team and management?',
    ],
    followUpPrompts: [],
    scoringImpacts: [
      { trait: 'burnout_risk', impact: 0.4, condition: 'negative_response' },
      { trait: 'support_needs', impact: 0.3 },
    ],
    toneOverride: { empathy: 0.9, directness: 0.4 },
    aiModifierNotes:
      'Be very validating and supportive. If signs of burnout detected, escalate immediately.',
    timing: {
      type: 'trait_decay',
      condition: {
        field: 'trait:retention_risk',
        operator: '>=',
        value: 6,
      },
      followUpDays: 5,
      maxRetries: 3,
      retryDelayDays: 2,
    },
  },
  {
    title: 'Performance Recognition',
    description: 'Acknowledge high performers and identify growth opportunities',
    category: 'growth',
    priority: 'medium',
    status: 'active',
    eligibilityRule: {
      type: 'performance_score',
      min: 8.5,
    },
    followUp: {
      enabled: true,
      delayDays: 14,
      prompts: ['How are your career development goals coming along?'],
    },
    traitsTracked: ['leadership_potential', 'motivation', 'career_ambition'],
    outcomeGoals: ['Retain high performers', 'Identify future leaders'],
    prompts: [
      "I've noticed your excellent performance lately. What's driving your success?",
      'What goals do you have for your career growth?',
      'How can we better support your continued development?',
      'What would make your role even more fulfilling?',
    ],
    followUpPrompts: [],
    scoringImpacts: [
      { trait: 'leadership_potential', impact: 0.3 },
      { trait: 'motivation', impact: 0.2 },
    ],
    toneOverride: { friendliness: 0.8, formality: 0.6 },
    timing: {
      type: 'trait_decay',
      condition: {
        field: 'trait:motivation',
        operator: '>=',
        value: 8.5,
      },
      followUpDays: 14,
      maxRetries: 2,
      retryDelayDays: 7,
    },
  },
];

const MomentsEngine: React.FC = () => {
  const [moments, setMoments] = useState<Moment[]>(defaultMoments);
  const [editingMoment, setEditingMoment] = useState<string | null>(null);
  const [editingData, setEditingData] = useState<Moment | null>(null);
  const [success, setSuccess] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState(0);
  const [previewDialog, setPreviewDialog] = useState(false);
  const [previewMoment, setPreviewMoment] = useState<Moment | null>(null);
  
  // Birthday Manager state
  const [birthdays, setBirthdays] = useState<BirthdayUser[]>([]);
  const [birthdayLoading, setBirthdayLoading] = useState(false);
  const [birthdayDialog, setBirthdayDialog] = useState(false);
  const [selectedBirthdayUser, setSelectedBirthdayUser] = useState<BirthdayUser | null>(null);
  const [birthdayMessage, setBirthdayMessage] = useState<BirthdayMessage>({
    workerId: '',
    messageText: '',
    giftType: 'none',
    giftValue: '',
  });
  
  const navigate = useNavigate();
  const functions = getFunctions();

  useEffect(() => {
    fetchMoments();
    if (activeTab === 4) {
      fetchBirthdays();
    }
  }, [activeTab]);

  const fetchBirthdays = async () => {
    setBirthdayLoading(true);
    try {
      const getUpcomingBirthdays = httpsCallable(functions, 'getUpcomingBirthdays');
      const result = await getUpcomingBirthdays({ daysAhead: 30 });
      const data = result.data as { birthdays: BirthdayUser[] };
      setBirthdays(data.birthdays || []);
    } catch (err: any) {
      setError('Failed to fetch birthdays: ' + err.message);
    } finally {
      setBirthdayLoading(false);
    }
  };

  const handleSendBirthdayMessage = async () => {
    if (!selectedBirthdayUser) return;
    
    try {
      const sendBirthdayMessage = httpsCallable(functions, 'sendBirthdayMessage');
      await sendBirthdayMessage({
        workerId: selectedBirthdayUser.id,
        messageText: birthdayMessage.messageText,
        giftType: birthdayMessage.giftType,
        giftValue: birthdayMessage.giftValue,
        tenantId: selectedBirthdayUser.tenantId,
      });
      
      setSuccessMessage('Birthday message sent successfully!');
      setSuccess(true);
      setBirthdayDialog(false);
      setSelectedBirthdayUser(null);
      setBirthdayMessage({
        workerId: '',
        messageText: '',
        giftType: 'none',
        giftValue: '',
      });
      fetchBirthdays();
    } catch (err: any) {
      setError('Failed to send birthday message: ' + err.message);
    }
  };

  const openBirthdayDialog = (user: BirthdayUser) => {
    setSelectedBirthdayUser(user);
    setBirthdayMessage({
      workerId: user.id,
      messageText: `Hi ${user.firstName}, from all of us at the company — happy birthday! We appreciate all your hard work and hope this brings a smile to your day. 🎂🎁`,
      giftType: 'none',
      giftValue: '',
    });
    setBirthdayDialog(true);
  };

  const getDaysUntilBirthday = (dob: any) => {
    const today = new Date();
    const birthDate = dob.toDate ? dob.toDate() : new Date(dob);
    const birthdayThisYear = new Date(today.getFullYear(), birthDate.getMonth(), birthDate.getDate());
    const birthdayNextYear = new Date(today.getFullYear() + 1, birthDate.getMonth(), birthDate.getDate());
    
    const nextBirthday = birthdayThisYear < today ? birthdayNextYear : birthdayThisYear;
    const daysUntil = Math.ceil((nextBirthday.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    
    return daysUntil;
  };

  const isToday = (dob: any) => {
    const today = new Date();
    const birthDate = dob.toDate ? dob.toDate() : new Date(dob);
    return today.getMonth() === birthDate.getMonth() && today.getDate() === birthDate.getDate();
  };

  const fetchMoments = async (skipInitialization = false) => {
    setLoading(true);
    try {
      const momentsRef = collection(db, 'aiMoments');
      const momentsSnap = await getDocs(momentsRef);
      if (!momentsSnap.empty) {
        const fetchedMoments = momentsSnap.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        })) as Moment[];
        setMoments(fetchedMoments);
      } else if (!skipInitialization) {
        await initializeDefaultMoments();
      }
    } catch (err: any) {
      setError('Failed to fetch moments');
    }
    setLoading(false);
  };

  const initializeDefaultMoments = async () => {
    try {
      const momentsRef = collection(db, 'aiMoments');
      for (const moment of defaultMoments) {
        await addDoc(momentsRef, {
          ...moment,
          history: {
            totalFired: 0,
            responseRate: 0,
            avgTraitShift: {},
            recentResponses: [],
          },
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }
      // Fetch the moments again to get the actual Firestore document IDs
      await fetchMoments(true);
    } catch (err: any) {
      setError('Failed to initialize default moments');
    }
  };

  const addMissingDefaultMoments = async () => {
    try {
      setLoading(true);
      const momentsRef = collection(db, 'aiMoments');
      const existingMoments = await getDocs(momentsRef);
      const existingTitles = existingMoments.docs.map((doc) => doc.data().title);

      const missingMoments = defaultMoments.filter(
        (moment) => !existingTitles.includes(moment.title),
      );

      if (missingMoments.length === 0) {
        setSuccessMessage('All default moments are already present');
        setSuccess(true);
        return;
      }

      for (const moment of missingMoments) {
        await addDoc(momentsRef, {
          ...moment,
          history: {
            totalFired: 0,
            responseRate: 0,
            avgTraitShift: {},
            recentResponses: [],
          },
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }

      setSuccessMessage(`Added ${missingMoments.length} missing default moments`);
      setSuccess(true);
      await fetchMoments(true);
    } catch (err: any) {
      setError('Failed to add missing default moments');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (moment: Moment) => {
    try {
      if (moment.id) {
        const momentRef = doc(db, 'aiMoments', moment.id);
        await updateDoc(momentRef, {
          ...moment,
          updatedAt: new Date(),
        });
      } else {
        const momentsRef = collection(db, 'aiMoments');
        const newMoment = {
          ...moment,
          history: {
            totalFired: 0,
            responseRate: 0,
            avgTraitShift: {},
            recentResponses: [],
          },
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        await addDoc(momentsRef, newMoment);
      }

      setEditingMoment(null);
      setEditingData(null);
      setSuccess(true);
      fetchMoments();
    } catch (err: any) {
      setError('Failed to save moment');
    }
  };

  const handleDelete = async (momentId: string) => {
    try {
      await deleteDoc(doc(db, 'aiMoments', momentId));
      setMoments((prev) => prev.filter((m) => m.id !== momentId));
      setSuccess(true);
    } catch (err: any) {
      setError('Failed to delete moment');
    }
  };

  const handleEdit = (moment: Moment) => {
    setEditingMoment(moment.id || 'new');
    setEditingData({ ...moment });
  };

  const handleCancel = () => {
    setEditingMoment(null);
    setEditingData(null);
  };

  const handlePreview = (moment: Moment) => {
    setPreviewMoment(moment);
    setPreviewDialog(true);
  };

  const handleMomentChange = (field: keyof Moment, value: any) => {
    if (editingData) {
      setEditingData({ ...editingData, [field]: value });
    }
  };

  const handleArrayFieldChange = (field: keyof Moment, value: string) => {
    if (editingData) {
      const arrayValue = value.split('\n').filter((item) => item.trim() !== '');
      setEditingData({ ...editingData, [field]: arrayValue });
    }
  };

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'onboarding':
        return '#1976d2';
      case 'check-in':
        return '#2e7d32';
      case 'milestone':
        return '#ed6c02';
      case 'crisis':
        return '#d32f2f';
      case 'growth':
        return '#7b1fa2';
      case 'custom':
        return '#666';
      default:
        return '#666';
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'low':
        return 'default';
      case 'medium':
        return 'primary';
      case 'high':
        return 'warning';
      case 'critical':
        return 'error';
      default:
        return 'default';
    }
  };

  const getStatusColor = (status: string) => {
    return status === 'active' ? 'success' : 'default';
  };

  const renderEligibilityRule = (rule: EligibilityRule) => {
    switch (rule.type) {
      case 'tenure_days':
        return `${rule.min || 0} - ${rule.max || '∞'} days`;
      case 'performance_score':
        return `Score ≥ ${rule.min}`;
      case 'trait_score':
        return `${rule.trait} ${rule.threshold ? `≥ ${rule.threshold}` : ''}`;
      case 'schedule':
        return rule.schedule || 'Custom schedule';
      case 'inactivity':
        return `No activity for ${rule.inactivityDays} days`;
      case 'companion_join_date':
        return `Every ${rule.min || 90} days since joining Companion`;
      case 'first_time_user':
        return 'First-time Companion user';
      case 'custom':
        return rule.customCondition || 'Custom condition';
      default:
        return 'Unknown rule';
    }
  };

  const renderPreviewDialog = () => (
    <Dialog open={previewDialog} onClose={() => setPreviewDialog(false)} maxWidth="md" fullWidth>
      <DialogTitle>Preview: {previewMoment?.title}</DialogTitle>
      <DialogContent>
        {previewMoment && (
          <Box>
            <Typography variant="h6" gutterBottom>
              Simulated Conversation Flow
            </Typography>
            <Paper sx={{ p: 2, mb: 2, bgcolor: 'grey.50' }}>
              <Typography variant="subtitle2" color="primary" gutterBottom>
                AI (Tone: {previewMoment.toneOverride ? 'Custom' : 'Default'})
              </Typography>
              {previewMoment.prompts.map((prompt, idx) => (
                <Typography key={idx} sx={{ mb: 1, fontStyle: 'italic' }}>
                  "{prompt}"
                </Typography>
              ))}
            </Paper>

            <Typography variant="h6" gutterBottom>
              Traits Being Assessed
            </Typography>
            <Box display="flex" flexWrap="wrap" gap={1} mb={2}>
              {previewMoment.traitsTracked.map((trait, idx) => (
                <Chip key={idx} label={trait} size="small" variant="outlined" />
              ))}
            </Box>

            <Typography variant="h6" gutterBottom>
              Outcome Goals
            </Typography>
            <Box display="flex" flexWrap="wrap" gap={1} mb={2}>
              {previewMoment.outcomeGoals.map((goal, idx) => (
                <Chip key={idx} label={goal} size="small" color="primary" />
              ))}
            </Box>

            {previewMoment.followUp.enabled && (
              <>
                <Typography variant="h6" gutterBottom>
                  Follow-up (After {previewMoment.followUp.delayDays} days)
                </Typography>
                <Paper sx={{ p: 2, bgcolor: 'grey.50' }}>
                  {previewMoment.followUp.prompts.map((prompt, idx) => (
                    <Typography key={idx} sx={{ fontStyle: 'italic' }}>
                      "{prompt}"
                    </Typography>
                  ))}
                </Paper>
              </>
            )}

            {previewMoment.aiModifierNotes && (
              <>
                <Typography variant="h6" gutterBottom>
                  AI Instructions
                </Typography>
                <Paper sx={{ p: 2, bgcolor: 'yellow.50' }}>
                  <Typography variant="body2">{previewMoment.aiModifierNotes}</Typography>
                </Paper>
              </>
            )}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={() => setPreviewDialog(false)}>Close</Button>
      </DialogActions>
    </Dialog>
  );

  return (
    <Box sx={{ p: 0 }}>
      <Box display="flex" alignItems="center" justifyContent="space-between" mb={3}>
        <Box>
          <Typography variant="h3" gutterBottom>
            Moments Engine
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Configure time-aware conversations that engage workers at critical career moments.
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
            <Tab label="All Moments" />
            <Tab label="Active" />
            <Tab label="Paused" />
            <Tab label="Analytics" />
            <Tab label="🎂 Birthday Manager" />
          </Tabs>

          {activeTab === 0 && (
            <Grid container spacing={3}>
              {moments.map((moment) => (
                <Grid item xs={12} key={moment.id || moment.title}>
                  <Paper
                    sx={{
                      p: 3,
                      border:
                        editingMoment === (moment.id || 'new') ? '2px solid #1976d2' : undefined,
                      bgcolor:
                        editingMoment === (moment.id || 'new')
                          ? 'rgba(25, 118, 210, 0.07)'
                          : undefined,
                    }}
                  >
                    {editingMoment === (moment.id || 'new') ? (
                      <Box>
                        <Box
                          display="flex"
                          justifyContent="space-between"
                          alignItems="center"
                          mb={2}
                        >
                          <Typography variant="h6">Edit Moment</Typography>
                          <Box sx={{ display: 'flex', gap: 1 }}>
                            <IconButton
                              color="primary"
                              onClick={() => editingData && handleSave(editingData)}
                            >
                              <SaveIcon />
                            </IconButton>
                            <IconButton onClick={handleCancel}>
                              <CancelIcon />
                            </IconButton>
                          </Box>
                        </Box>

                        <Grid container spacing={3}>
                          <Grid item xs={12} md={6}>
                            <TextField
                              label="Moment Title"
                              fullWidth
                              value={editingData?.title || ''}
                              onChange={(e) => handleMomentChange('title', e.target.value)}
                            />
                          </Grid>
                          <Grid item xs={12} md={6}>
                            <FormControl fullWidth>
                              <InputLabel>Category</InputLabel>
                              <Select
                                value={editingData?.category || 'custom'}
                                label="Category"
                                onChange={(e) => handleMomentChange('category', e.target.value)}
                              >
                                <MenuItem value="onboarding">Onboarding</MenuItem>
                                <MenuItem value="check-in">Check-in</MenuItem>
                                <MenuItem value="milestone">Milestone</MenuItem>
                                <MenuItem value="crisis">Crisis</MenuItem>
                                <MenuItem value="growth">Growth</MenuItem>
                                <MenuItem value="custom">Custom</MenuItem>
                              </Select>
                            </FormControl>
                          </Grid>
                          <Grid item xs={12}>
                            <TextField
                              label="Description"
                              fullWidth
                              value={editingData?.description || ''}
                              onChange={(e) => handleMomentChange('description', e.target.value)}
                            />
                          </Grid>
                          <Grid item xs={12} md={6}>
                            <FormControl fullWidth>
                              <InputLabel>Priority Level</InputLabel>
                              <Select
                                value={editingData?.priority || 'medium'}
                                label="Priority Level"
                                onChange={(e) => handleMomentChange('priority', e.target.value)}
                              >
                                <MenuItem value="low">Low</MenuItem>
                                <MenuItem value="medium">Medium</MenuItem>
                                <MenuItem value="high">High</MenuItem>
                                <MenuItem value="critical">Critical</MenuItem>
                              </Select>
                            </FormControl>
                          </Grid>
                          <Grid item xs={12} md={6}>
                            <FormControlLabel
                              control={
                                <Switch
                                  checked={editingData?.status === 'active'}
                                  onChange={(e) =>
                                    handleMomentChange(
                                      'status',
                                      e.target.checked ? 'active' : 'paused',
                                    )
                                  }
                                />
                              }
                              label="Active"
                            />
                          </Grid>
                          {editingData?.status === 'paused' && (
                            <Grid item xs={12}>
                              <TextField
                                label="Pause Reason"
                                fullWidth
                                value={editingData?.statusReason || ''}
                                onChange={(e) => handleMomentChange('statusReason', e.target.value)}
                                helperText="Why is this moment paused?"
                              />
                            </Grid>
                          )}
                          <Grid item xs={12}>
                            <Accordion>
                              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                                <Typography fontWeight={600}>Eligibility Rules</Typography>
                              </AccordionSummary>
                              <AccordionDetails>
                                <Grid container spacing={3}>
                                  <Grid item xs={12} md={6}>
                                    <FormControl fullWidth>
                                      <InputLabel>Rule Type</InputLabel>
                                      <Select
                                        value={editingData?.eligibilityRule?.type || 'tenure_days'}
                                        label="Rule Type"
                                        onChange={(e) =>
                                          handleMomentChange('eligibilityRule', {
                                            ...editingData?.eligibilityRule,
                                            type: e.target.value,
                                          })
                                        }
                                      >
                                        <MenuItem value="tenure_days">Tenure (Days)</MenuItem>
                                        <MenuItem value="performance_score">
                                          Performance Score
                                        </MenuItem>
                                        <MenuItem value="trait_score">Trait Score</MenuItem>
                                        <MenuItem value="schedule">Schedule</MenuItem>
                                        <MenuItem value="inactivity">Inactivity</MenuItem>
                                        <MenuItem value="companion_join_date">
                                          Companion Join Date
                                        </MenuItem>
                                        <MenuItem value="first_time_user">First-Time User</MenuItem>
                                        <MenuItem value="custom">Custom</MenuItem>
                                      </Select>
                                    </FormControl>
                                  </Grid>
                                  {editingData?.eligibilityRule?.type === 'tenure_days' && (
                                    <>
                                      <Grid item xs={12} md={3}>
                                        <TextField
                                          label="Min Days"
                                          type="number"
                                          fullWidth
                                          value={editingData?.eligibilityRule?.min || ''}
                                          onChange={(e) =>
                                            handleMomentChange('eligibilityRule', {
                                              ...editingData?.eligibilityRule,
                                              min: parseInt(e.target.value) || undefined,
                                            })
                                          }
                                        />
                                      </Grid>
                                      <Grid item xs={12} md={3}>
                                        <TextField
                                          label="Max Days"
                                          type="number"
                                          fullWidth
                                          value={editingData?.eligibilityRule?.max || ''}
                                          onChange={(e) =>
                                            handleMomentChange('eligibilityRule', {
                                              ...editingData?.eligibilityRule,
                                              max: parseInt(e.target.value) || undefined,
                                            })
                                          }
                                        />
                                      </Grid>
                                    </>
                                  )}
                                  {editingData?.eligibilityRule?.type === 'performance_score' && (
                                    <Grid item xs={12} md={6}>
                                      <TextField
                                        label="Min Score"
                                        type="number"
                                        fullWidth
                                        value={editingData?.eligibilityRule?.min || ''}
                                        onChange={(e) =>
                                          handleMomentChange('eligibilityRule', {
                                            ...editingData?.eligibilityRule,
                                            min: parseFloat(e.target.value) || undefined,
                                          })
                                        }
                                      />
                                    </Grid>
                                  )}
                                  {editingData?.eligibilityRule?.type === 'custom' && (
                                    <Grid item xs={12}>
                                      <TextField
                                        label="Custom Condition"
                                        fullWidth
                                        multiline
                                        minRows={2}
                                        value={editingData?.eligibilityRule?.customCondition || ''}
                                        onChange={(e) =>
                                          handleMomentChange('eligibilityRule', {
                                            ...editingData?.eligibilityRule,
                                            customCondition: e.target.value,
                                          })
                                        }
                                        placeholder="e.g., department == 'Sales' AND shift == 'night'"
                                      />
                                    </Grid>
                                  )}
                                </Grid>
                              </AccordionDetails>
                            </Accordion>
                          </Grid>
                          <Grid item xs={12}>
                            <TextField
                              label="Prompts (one per line)"
                              fullWidth
                              multiline
                              minRows={4}
                              value={editingData?.prompts?.join('\n') || ''}
                              onChange={(e) => handleArrayFieldChange('prompts', e.target.value)}
                              helperText="Questions the AI will ask during this moment"
                            />
                          </Grid>
                          <Grid item xs={12}>
                            <TextField
                              label="Traits Tracked (one per line)"
                              fullWidth
                              multiline
                              minRows={2}
                              value={editingData?.traitsTracked?.join('\n') || ''}
                              onChange={(e) =>
                                handleArrayFieldChange('traitsTracked', e.target.value)
                              }
                              helperText="Traits the AI should assess during this conversation"
                            />
                          </Grid>
                          <Grid item xs={12}>
                            <TextField
                              label="Outcome Goals (one per line)"
                              fullWidth
                              multiline
                              minRows={2}
                              value={editingData?.outcomeGoals?.join('\n') || ''}
                              onChange={(e) =>
                                handleArrayFieldChange('outcomeGoals', e.target.value)
                              }
                              helperText="What outcomes should this moment drive?"
                            />
                          </Grid>
                          <Grid item xs={12}>
                            <Accordion>
                              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                                <Typography fontWeight={600}>Follow-Up Configuration</Typography>
                              </AccordionSummary>
                              <AccordionDetails>
                                <Grid container spacing={3}>
                                  <Grid item xs={12}>
                                    <FormControlLabel
                                      control={
                                        <Switch
                                          checked={editingData?.followUp?.enabled || false}
                                          onChange={(e) =>
                                            handleMomentChange('followUp', {
                                              ...editingData?.followUp,
                                              enabled: e.target.checked,
                                            })
                                          }
                                        />
                                      }
                                      label="Enable Follow-Up"
                                    />
                                  </Grid>
                                  {editingData?.followUp?.enabled && (
                                    <>
                                      <Grid item xs={12} md={6}>
                                        <TextField
                                          label="Follow-Up Days"
                                          type="number"
                                          fullWidth
                                          value={editingData?.followUp?.delayDays || 0}
                                          onChange={(e) =>
                                            handleMomentChange('followUp', {
                                              ...editingData?.followUp,
                                              delayDays: parseInt(e.target.value),
                                            })
                                          }
                                          helperText="Days after the initial conversation"
                                        />
                                      </Grid>
                                      <Grid item xs={12}>
                                        <TextField
                                          label="Follow-Up Prompts (one per line)"
                                          fullWidth
                                          multiline
                                          minRows={2}
                                          value={editingData?.followUp?.prompts?.join('\n') || ''}
                                          onChange={(e) =>
                                            handleArrayFieldChange(
                                              'followUpPrompts',
                                              e.target.value,
                                            )
                                          }
                                        />
                                      </Grid>
                                    </>
                                  )}
                                </Grid>
                              </AccordionDetails>
                            </Accordion>
                          </Grid>
                          <Grid item xs={12}>
                            <Accordion>
                              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                                <Typography fontWeight={600}>AI & Tone Settings</Typography>
                              </AccordionSummary>
                              <AccordionDetails>
                                <Grid container spacing={3}>
                                  <Grid item xs={12}>
                                    <TextField
                                      label="AI Modifier Notes"
                                      fullWidth
                                      multiline
                                      minRows={3}
                                      value={editingData?.aiModifierNotes || ''}
                                      onChange={(e) =>
                                        handleMomentChange('aiModifierNotes', e.target.value)
                                      }
                                      placeholder="e.g., 'Be extra validating,' 'use informal tone,' 'probe hard if evasive'"
                                      helperText="Special instructions for how the AI should behave during this moment"
                                    />
                                  </Grid>
                                  <Grid item xs={12} md={6}>
                                    <Typography gutterBottom>Friendliness Override</Typography>
                                    <Slider
                                      value={editingData?.toneOverride?.friendliness || 0.5}
                                      onChange={(_, value) =>
                                        handleMomentChange('toneOverride', {
                                          ...editingData?.toneOverride,
                                          friendliness: value,
                                        })
                                      }
                                      min={0}
                                      max={1}
                                      step={0.1}
                                      marks={[
                                        { value: 0, label: 'Formal' },
                                        { value: 1, label: 'Friendly' },
                                      ]}
                                    />
                                  </Grid>
                                  <Grid item xs={12} md={6}>
                                    <Typography gutterBottom>Empathy Override</Typography>
                                    <Slider
                                      value={editingData?.toneOverride?.empathy || 0.5}
                                      onChange={(_, value) =>
                                        handleMomentChange('toneOverride', {
                                          ...editingData?.toneOverride,
                                          empathy: value,
                                        })
                                      }
                                      min={0}
                                      max={1}
                                      step={0.1}
                                      marks={[
                                        { value: 0, label: 'Direct' },
                                        { value: 1, label: 'Empathetic' },
                                      ]}
                                    />
                                  </Grid>
                                </Grid>
                              </AccordionDetails>
                            </Accordion>
                          </Grid>
                          <Grid item xs={12}>
                            <Accordion>
                              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                                <Typography fontWeight={600}>
                                  AI Scheduling Configuration
                                </Typography>
                              </AccordionSummary>
                              <AccordionDetails>
                                <Grid container spacing={3}>
                                  <Grid item xs={12} md={6}>
                                    <FormControl fullWidth>
                                      <InputLabel>Scheduling Type</InputLabel>
                                      <Select
                                        value={editingData?.timing?.type || 'manual'}
                                        label="Scheduling Type"
                                        onChange={(e) =>
                                          handleMomentChange('timing', {
                                            ...editingData?.timing,
                                            type: e.target.value,
                                          })
                                        }
                                      >
                                        <MenuItem value="manual">Manual Only</MenuItem>
                                        <MenuItem value="tenure_based">Tenure Based</MenuItem>
                                        <MenuItem value="recurring">Recurring</MenuItem>
                                        <MenuItem value="trait_decay">Trait Decay</MenuItem>
                                      </Select>
                                    </FormControl>
                                  </Grid>

                                  {editingData?.timing?.type === 'tenure_based' && (
                                    <>
                                      <Grid item xs={12} md={6}>
                                        <FormControl fullWidth>
                                          <InputLabel>Field</InputLabel>
                                          <Select
                                            value={
                                              editingData?.timing?.condition?.field || 'tenure_days'
                                            }
                                            label="Field"
                                            onChange={(e) =>
                                              handleMomentChange('timing', {
                                                ...editingData?.timing,
                                                condition: {
                                                  ...editingData?.timing?.condition,
                                                  field: e.target.value,
                                                },
                                              })
                                            }
                                          >
                                            <MenuItem value="tenure_days">Tenure Days</MenuItem>
                                          </Select>
                                        </FormControl>
                                      </Grid>
                                      <Grid item xs={12} md={3}>
                                        <FormControl fullWidth>
                                          <InputLabel>Operator</InputLabel>
                                          <Select
                                            value={editingData?.timing?.condition?.operator || '>='}
                                            label="Operator"
                                            onChange={(e) =>
                                              handleMomentChange('timing', {
                                                ...editingData?.timing,
                                                condition: {
                                                  ...editingData?.timing?.condition,
                                                  operator: e.target.value,
                                                },
                                              })
                                            }
                                          >
                                            <MenuItem value=">=">Greater than or equal</MenuItem>
                                            <MenuItem value="<=">Less than or equal</MenuItem>
                                            <MenuItem value="==">Equal to</MenuItem>
                                            <MenuItem value="!=">Not equal to</MenuItem>
                                          </Select>
                                        </FormControl>
                                      </Grid>
                                      <Grid item xs={12} md={3}>
                                        <TextField
                                          label="Value"
                                          type="number"
                                          fullWidth
                                          value={editingData?.timing?.condition?.value || ''}
                                          onChange={(e) =>
                                            handleMomentChange('timing', {
                                              ...editingData?.timing,
                                              condition: {
                                                ...editingData?.timing?.condition,
                                                value: parseInt(e.target.value),
                                              },
                                            })
                                          }
                                        />
                                      </Grid>
                                    </>
                                  )}

                                  {editingData?.timing?.type === 'trait_decay' && (
                                    <>
                                      <Grid item xs={12} md={6}>
                                        <FormControl fullWidth>
                                          <InputLabel>Trait</InputLabel>
                                          <Select
                                            value={
                                              editingData?.timing?.condition?.field ||
                                              'trait:engagement'
                                            }
                                            label="Trait"
                                            onChange={(e) =>
                                              handleMomentChange('timing', {
                                                ...editingData?.timing,
                                                condition: {
                                                  ...editingData?.timing?.condition,
                                                  field: e.target.value,
                                                },
                                              })
                                            }
                                          >
                                            <MenuItem value="trait:engagement">Engagement</MenuItem>
                                            <MenuItem value="trait:satisfaction">
                                              Satisfaction
                                            </MenuItem>
                                            <MenuItem value="trait:retention_risk">
                                              Retention Risk
                                            </MenuItem>
                                            <MenuItem value="trait:motivation">Motivation</MenuItem>
                                            <MenuItem value="trait:learning_engagement">
                                              Learning Engagement
                                            </MenuItem>
                                            <MenuItem value="trait:growth_mindset">
                                              Growth Mindset
                                            </MenuItem>
                                          </Select>
                                        </FormControl>
                                      </Grid>
                                      <Grid item xs={12} md={3}>
                                        <FormControl fullWidth>
                                          <InputLabel>Operator</InputLabel>
                                          <Select
                                            value={editingData?.timing?.condition?.operator || '>='}
                                            label="Operator"
                                            onChange={(e) =>
                                              handleMomentChange('timing', {
                                                ...editingData?.timing,
                                                condition: {
                                                  ...editingData?.timing?.condition,
                                                  operator: e.target.value,
                                                },
                                              })
                                            }
                                          >
                                            <MenuItem value=">=">Greater than or equal</MenuItem>
                                            <MenuItem value="<=">Less than or equal</MenuItem>
                                            <MenuItem value="==">Equal to</MenuItem>
                                            <MenuItem value="!=">Not equal to</MenuItem>
                                          </Select>
                                        </FormControl>
                                      </Grid>
                                      <Grid item xs={12} md={3}>
                                        <TextField
                                          label="Threshold"
                                          type="number"
                                          fullWidth
                                          value={editingData?.timing?.condition?.value || ''}
                                          onChange={(e) =>
                                            handleMomentChange('timing', {
                                              ...editingData?.timing,
                                              condition: {
                                                ...editingData?.timing?.condition,
                                                value: parseFloat(e.target.value),
                                              },
                                            })
                                          }
                                        />
                                      </Grid>
                                    </>
                                  )}

                                  {editingData?.timing?.type === 'recurring' && (
                                    <>
                                      <Grid item xs={12} md={6}>
                                        <FormControl fullWidth>
                                          <InputLabel>Recurrence</InputLabel>
                                          <Select
                                            value={editingData?.timing?.recurrence || 'monthly'}
                                            label="Recurrence"
                                            onChange={(e) =>
                                              handleMomentChange('timing', {
                                                ...editingData?.timing,
                                                recurrence: e.target.value,
                                              })
                                            }
                                          >
                                            <MenuItem value="monthly">Monthly</MenuItem>
                                            <MenuItem value="quarterly">Quarterly</MenuItem>
                                            <MenuItem value="custom">Custom Days</MenuItem>
                                          </Select>
                                        </FormControl>
                                      </Grid>
                                      {editingData?.timing?.recurrence === 'custom' && (
                                        <Grid item xs={12} md={6}>
                                          <TextField
                                            label="Custom Days"
                                            type="number"
                                            fullWidth
                                            value={editingData?.timing?.customDays || ''}
                                            onChange={(e) =>
                                              handleMomentChange('timing', {
                                                ...editingData?.timing,
                                                customDays: parseInt(e.target.value),
                                              })
                                            }
                                            helperText="Days between recurrences"
                                          />
                                        </Grid>
                                      )}
                                    </>
                                  )}

                                  <Grid item xs={12} md={4}>
                                    <TextField
                                      label="Follow-Up Days"
                                      type="number"
                                      fullWidth
                                      value={editingData?.timing?.followUpDays || ''}
                                      onChange={(e) =>
                                        handleMomentChange('timing', {
                                          ...editingData?.timing,
                                          followUpDays: parseInt(e.target.value),
                                        })
                                      }
                                      helperText="Days after completion for follow-up"
                                    />
                                  </Grid>
                                  <Grid item xs={12} md={4}>
                                    <TextField
                                      label="Max Retries"
                                      type="number"
                                      fullWidth
                                      value={editingData?.timing?.maxRetries || ''}
                                      onChange={(e) =>
                                        handleMomentChange('timing', {
                                          ...editingData?.timing,
                                          maxRetries: parseInt(e.target.value),
                                        })
                                      }
                                      helperText="Maximum retry attempts"
                                    />
                                  </Grid>
                                  <Grid item xs={12} md={4}>
                                    <TextField
                                      label="Retry Delay (Days)"
                                      type="number"
                                      fullWidth
                                      value={editingData?.timing?.retryDelayDays || ''}
                                      onChange={(e) =>
                                        handleMomentChange('timing', {
                                          ...editingData?.timing,
                                          retryDelayDays: parseInt(e.target.value),
                                        })
                                      }
                                      helperText="Days between retry attempts"
                                    />
                                  </Grid>
                                </Grid>
                              </AccordionDetails>
                            </Accordion>
                          </Grid>
                        </Grid>
                      </Box>
                    ) : (
                      <Box>
                        <Box
                          display="flex"
                          justifyContent="space-between"
                          alignItems="flex-start"
                          mb={2}
                        >
                          <Box>
                            <Typography variant="h6">{moment.title}</Typography>
                            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                              {moment.description}
                            </Typography>
                            <Box display="flex" gap={1} mb={1}>
                              <Chip
                                label={moment.category}
                                size="small"
                                sx={{
                                  backgroundColor: getCategoryColor(moment.category),
                                  color: 'white',
                                }}
                              />
                              <Chip
                                label={moment.priority}
                                size="small"
                                color={getPriorityColor(moment.priority) as any}
                              />
                              <Chip
                                label={moment.status}
                                size="small"
                                color={getStatusColor(moment.status) as any}
                              />
                              {moment.status === 'paused' && moment.statusReason && (
                                <Chip label={moment.statusReason} size="small" variant="outlined" />
                              )}
                            </Box>
                          </Box>
                          <Box sx={{ display: 'flex', gap: 1 }}>
                            <IconButton onClick={() => handlePreview(moment)}>
                              <VisibilityIcon />
                            </IconButton>
                            <IconButton onClick={() => handleEdit(moment)}>
                              <EditIcon />
                            </IconButton>
                            <IconButton
                              color="error"
                              onClick={() => moment.id && handleDelete(moment.id)}
                            >
                              <DeleteIcon />
                            </IconButton>
                          </Box>
                        </Box>

                        <Grid container spacing={2}>
                          <Grid item xs={12} md={6}>
                            <Typography variant="subtitle2" gutterBottom>
                              Eligibility
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                              {renderEligibilityRule(moment.eligibilityRule)}
                            </Typography>
                          </Grid>
                          <Grid item xs={12} md={6}>
                            <Typography variant="subtitle2" gutterBottom>
                              Prompts
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                              {moment.prompts.length} questions
                            </Typography>
                          </Grid>
                          <Grid item xs={12} md={6}>
                            <Typography variant="subtitle2" gutterBottom>
                              Traits Assessed
                            </Typography>
                            <Box display="flex" flexWrap="wrap" gap={0.5}>
                              {moment.traitsTracked.map((trait, idx) => (
                                <Chip key={idx} label={trait} size="small" variant="outlined" />
                              ))}
                            </Box>
                          </Grid>
                          <Grid item xs={12} md={6}>
                            <Typography variant="subtitle2" gutterBottom>
                              Outcome Goals
                            </Typography>
                            <Box display="flex" flexWrap="wrap" gap={0.5}>
                              {moment.outcomeGoals.map((goal, idx) => (
                                <Chip key={idx} label={goal} size="small" color="primary" />
                              ))}
                            </Box>
                          </Grid>
                          <Grid item xs={12} md={6}>
                            <Typography variant="subtitle2" gutterBottom>
                              Follow-Up
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                              {moment.followUp.enabled
                                ? `${moment.followUp.delayDays} days later`
                                : 'Disabled'}
                            </Typography>
                          </Grid>
                          <Grid item xs={12} md={6}>
                            <Typography variant="subtitle2" gutterBottom>
                              History
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                              {moment.history?.totalFired || 0} times fired
                              {moment.history?.responseRate
                                ? ` • ${Math.round(
                                    moment.history.responseRate * 100,
                                  )}% response rate`
                                : ''}
                            </Typography>
                          </Grid>
                          <Grid item xs={12} md={6}>
                            <Typography variant="subtitle2" gutterBottom>
                              Scheduling
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                              {moment.timing?.type === 'manual'
                                ? 'Manual Only'
                                : moment.timing?.type === 'tenure_based'
                                ? `Tenure: ${moment.timing.condition?.operator} ${moment.timing.condition?.value}`
                                : moment.timing?.type === 'recurring'
                                ? `Recurring: ${moment.timing.recurrence}`
                                : moment.timing?.type === 'trait_decay'
                                ? `Trait Decay: ${moment.timing.condition?.field?.replace(
                                    'trait:',
                                    '',
                                  )} ${moment.timing.condition?.operator} ${
                                    moment.timing.condition?.value
                                  }`
                                : 'Not configured'}
                            </Typography>
                          </Grid>
                        </Grid>
                      </Box>
                    )}
                  </Paper>
                </Grid>
              ))}

              <Grid item xs={12}>
                <Paper
                  sx={{
                    p: 3,
                    border: '2px dashed #ccc',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    '&:hover': { borderColor: 'primary.main' },
                  }}
                  onClick={() =>
                    handleEdit({
                      title: '',
                      description: '',
                      category: 'custom',
                      priority: 'medium',
                      status: 'active',
                      eligibilityRule: { type: 'tenure_days' },
                      followUp: { enabled: false, delayDays: 0, prompts: [] },
                      traitsTracked: [],
                      outcomeGoals: [],
                      prompts: [],
                      followUpPrompts: [],
                      scoringImpacts: [],
                    })
                  }
                >
                  <Box display="flex" alignItems="center" gap={2}>
                    <AddIcon />
                    <Typography variant="h6">Add New Moment</Typography>
                  </Box>
                </Paper>
              </Grid>
            </Grid>
          )}

          {activeTab === 1 && (
            <Grid container spacing={3}>
              {moments
                .filter((m) => m.status === 'active')
                .map((moment) => (
                  <Grid item xs={12} key={moment.id || moment.title}>
                    <Paper sx={{ p: 3 }}>
                      {/* Same content as above but filtered for active moments */}
                      <Box>
                        <Box
                          display="flex"
                          justifyContent="space-between"
                          alignItems="flex-start"
                          mb={2}
                        >
                          <Box>
                            <Typography variant="h6">{moment.title}</Typography>
                            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                              {moment.description}
                            </Typography>
                            <Box display="flex" gap={1} mb={1}>
                              <Chip
                                label={moment.category}
                                size="small"
                                sx={{
                                  backgroundColor: getCategoryColor(moment.category),
                                  color: 'white',
                                }}
                              />
                              <Chip
                                label={moment.priority}
                                size="small"
                                color={getPriorityColor(moment.priority) as any}
                              />
                              <Chip label="Active" size="small" color="success" />
                            </Box>
                          </Box>
                          <Box sx={{ display: 'flex', gap: 1 }}>
                            <IconButton onClick={() => handlePreview(moment)}>
                              <VisibilityIcon />
                            </IconButton>
                            <IconButton onClick={() => handleEdit(moment)}>
                              <EditIcon />
                            </IconButton>
                          </Box>
                        </Box>

                        <Grid container spacing={2}>
                          <Grid item xs={12} md={6}>
                            <Typography variant="subtitle2" gutterBottom>
                              Eligibility
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                              {renderEligibilityRule(moment.eligibilityRule)}
                            </Typography>
                          </Grid>
                          <Grid item xs={12} md={6}>
                            <Typography variant="subtitle2" gutterBottom>
                              History
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                              {moment.history?.totalFired || 0} times fired
                              {moment.history?.responseRate
                                ? ` • ${Math.round(
                                    moment.history.responseRate * 100,
                                  )}% response rate`
                                : ''}
                            </Typography>
                          </Grid>
                        </Grid>
                      </Box>
                    </Paper>
                  </Grid>
                ))}
            </Grid>
          )}

          {activeTab === 2 && (
            <Grid container spacing={3}>
              {moments
                .filter((m) => m.status === 'paused')
                .map((moment) => (
                  <Grid item xs={12} key={moment.id || moment.title}>
                    <Paper sx={{ p: 3 }}>
                      {/* Same content as above but filtered for paused moments */}
                      <Box>
                        <Box
                          display="flex"
                          justifyContent="space-between"
                          alignItems="flex-start"
                          mb={2}
                        >
                          <Box>
                            <Typography variant="h6">{moment.title}</Typography>
                            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                              {moment.description}
                            </Typography>
                            <Box display="flex" gap={1} mb={1}>
                              <Chip
                                label={moment.category}
                                size="small"
                                sx={{
                                  backgroundColor: getCategoryColor(moment.category),
                                  color: 'white',
                                }}
                              />
                              <Chip
                                label={moment.priority}
                                size="small"
                                color={getPriorityColor(moment.priority) as any}
                              />
                              <Chip label="Paused" size="small" color="default" />
                              {moment.statusReason && (
                                <Chip label={moment.statusReason} size="small" variant="outlined" />
                              )}
                            </Box>
                          </Box>
                          <Box sx={{ display: 'flex', gap: 1 }}>
                            <IconButton onClick={() => handleEdit(moment)}>
                              <EditIcon />
                            </IconButton>
                          </Box>
                        </Box>

                        <Grid container spacing={2}>
                          <Grid item xs={12} md={6}>
                            <Typography variant="subtitle2" gutterBottom>
                              Pause Reason
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                              {moment.statusReason || 'No reason provided'}
                            </Typography>
                          </Grid>
                          <Grid item xs={12} md={6}>
                            <Typography variant="subtitle2" gutterBottom>
                              Last Activity
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                              {moment.history?.lastFired
                                ? new Date(moment.history.lastFired).toLocaleDateString()
                                : 'Never fired'}
                            </Typography>
                          </Grid>
                        </Grid>
                      </Box>
                    </Paper>
                  </Grid>
                ))}
            </Grid>
          )}

          {activeTab === 3 && (
            <Grid container spacing={3}>
              <Grid item xs={12} md={6}>
                <Paper sx={{ p: 3 }}>
                  <Typography variant="h6" gutterBottom>
                    Moment Performance
                  </Typography>
                  <Box display="flex" flexDirection="column" gap={2}>
                    {moments.map((moment) => (
                      <Box
                        key={moment.id || moment.title}
                        display="flex"
                        justifyContent="space-between"
                        alignItems="center"
                      >
                        <Typography variant="body2">{moment.title}</Typography>
                        <Box display="flex" gap={2}>
                          <Typography variant="caption" color="text.secondary">
                            {moment.history?.totalFired || 0} fired
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {moment.history?.responseRate
                              ? `${Math.round(moment.history.responseRate * 100)}%`
                              : '0%'}{' '}
                            response
                          </Typography>
                        </Box>
                      </Box>
                    ))}
                  </Box>
                </Paper>
              </Grid>
              <Grid item xs={12} md={6}>
                <Paper sx={{ p: 3 }}>
                  <Typography variant="h6" gutterBottom>
                    Category Breakdown
                  </Typography>
                  <Box display="flex" flexDirection="column" gap={2}>
                    {['onboarding', 'check-in', 'crisis', 'growth'].map((category) => {
                      const categoryMoments = moments.filter((m) => m.category === category);
                      const totalFired = categoryMoments.reduce(
                        (sum, m) => sum + (m.history?.totalFired || 0),
                        0,
                      );
                      const avgResponseRate =
                        categoryMoments.length > 0
                          ? categoryMoments.reduce(
                              (sum, m) => sum + (m.history?.responseRate || 0),
                              0,
                            ) / categoryMoments.length
                          : 0;

                      return (
                        <Box
                          key={category}
                          display="flex"
                          justifyContent="space-between"
                          alignItems="center"
                        >
                          <Chip
                            label={category}
                            size="small"
                            sx={{
                              backgroundColor: getCategoryColor(category),
                              color: 'white',
                            }}
                          />
                          <Box display="flex" gap={2}>
                            <Typography variant="caption" color="text.secondary">
                              {totalFired} total
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {Math.round(avgResponseRate * 100)}% avg
                            </Typography>
                          </Box>
                        </Box>
                      );
                    })}
                  </Box>
                </Paper>
              </Grid>
            </Grid>
          )}

          {activeTab === 4 && (
            <Box>
              <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
                <Typography variant="h5" gutterBottom>
                  🎂 Birthday Recognition Manager
                </Typography>
                <Button
                  variant="outlined"
                  startIcon={<CakeIcon />}
                  onClick={fetchBirthdays}
                  disabled={birthdayLoading}
                >
                  Refresh
                </Button>
              </Box>

              {birthdayLoading ? (
                <Typography>Loading birthdays...</Typography>
              ) : (
                <Grid container spacing={3}>
                  <Grid item xs={12} md={6}>
                    <Paper sx={{ p: 3 }}>
                      <Typography variant="h6" gutterBottom color="primary">
                        🎉 Today's Birthdays ({birthdays.filter(b => isToday(b.dob)).length})
                      </Typography>
                      {birthdays.filter(b => isToday(b.dob)).length === 0 ? (
                        <Typography color="text.secondary">No birthdays today</Typography>
                      ) : (
                        <TableContainer>
                          <Table size="small">
                            <TableHead>
                              <TableRow>
                                <TableCell>Employee</TableCell>
                                <TableCell>Department</TableCell>
                                <TableCell>Action</TableCell>
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {birthdays
                                .filter(b => isToday(b.dob))
                                .map((user) => (
                                  <TableRow key={user.id}>
                                    <TableCell>
                                      <Box display="flex" alignItems="center" gap={1}>
                                        <Avatar sx={{ width: 32, height: 32 }}>
                                          {user.firstName[0]}{user.lastName[0]}
                                        </Avatar>
                                        <Box>
                                          <Typography variant="body2" fontWeight={500}>
                                            {user.firstName} {user.lastName}
                                          </Typography>
                                          <Typography variant="caption" color="text.secondary">
                                            {user.jobTitle || 'No title'}
                                          </Typography>
                                        </Box>
                                      </Box>
                                    </TableCell>
                                    <TableCell>{user.department || 'N/A'}</TableCell>
                                    <TableCell>
                                      <Button
                                        size="small"
                                        variant="contained"
                                        startIcon={<SendIcon />}
                                        onClick={() => openBirthdayDialog(user)}
                                      >
                                        Send Message
                                      </Button>
                                    </TableCell>
                                  </TableRow>
                                ))}
                            </TableBody>
                          </Table>
                        </TableContainer>
                      )}
                    </Paper>
                  </Grid>

                  <Grid item xs={12} md={6}>
                    <Paper sx={{ p: 3 }}>
                      <Typography variant="h6" gutterBottom color="secondary">
                        📅 Upcoming Birthdays (Next 30 Days)
                      </Typography>
                      {birthdays.filter(b => !isToday(b.dob)).length === 0 ? (
                        <Typography color="text.secondary">No upcoming birthdays</Typography>
                      ) : (
                        <TableContainer>
                          <Table size="small">
                            <TableHead>
                              <TableRow>
                                <TableCell>Employee</TableCell>
                                <TableCell>Days Until</TableCell>
                                <TableCell>Action</TableCell>
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {birthdays
                                .filter(b => !isToday(b.dob))
                                .slice(0, 10)
                                .map((user) => (
                                  <TableRow key={user.id}>
                                    <TableCell>
                                      <Box display="flex" alignItems="center" gap={1}>
                                        <Avatar sx={{ width: 32, height: 32 }}>
                                          {user.firstName[0]}{user.lastName[0]}
                                        </Avatar>
                                        <Box>
                                          <Typography variant="body2" fontWeight={500}>
                                            {user.firstName} {user.lastName}
                                          </Typography>
                                          <Typography variant="caption" color="text.secondary">
                                            {user.jobTitle || 'No title'}
                                          </Typography>
                                        </Box>
                                      </Box>
                                    </TableCell>
                                    <TableCell>
                                      <Chip
                                        label={`${getDaysUntilBirthday(user.dob)} days`}
                                        size="small"
                                        color={getDaysUntilBirthday(user.dob) <= 7 ? 'warning' : 'default'}
                                      />
                                    </TableCell>
                                    <TableCell>
                                      <Button
                                        size="small"
                                        variant="outlined"
                                        startIcon={<SendIcon />}
                                        onClick={() => openBirthdayDialog(user)}
                                      >
                                        Send Message
                                      </Button>
                                    </TableCell>
                                  </TableRow>
                                ))}
                            </TableBody>
                          </Table>
                        </TableContainer>
                      )}
                    </Paper>
                  </Grid>
                </Grid>
              )}
            </Box>
          )}
        </>
      )}

      {/* Birthday Message Dialog */}
      <Dialog open={birthdayDialog} onClose={() => setBirthdayDialog(false)} maxWidth="md" fullWidth>
        <DialogTitle>
          <Box display="flex" alignItems="center" gap={1}>
            <CakeIcon color="primary" />
            Send Birthday Message
          </Box>
        </DialogTitle>
        <DialogContent>
          {selectedBirthdayUser && (
            <Box sx={{ mt: 2 }}>
              <Typography variant="h6" gutterBottom>
                To: {selectedBirthdayUser.firstName} {selectedBirthdayUser.lastName}
              </Typography>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                {selectedBirthdayUser.jobTitle} • {selectedBirthdayUser.department || 'No department'}
              </Typography>
              
              <TextField
                label="Birthday Message"
                multiline
                rows={4}
                fullWidth
                value={birthdayMessage.messageText}
                onChange={(e) => setBirthdayMessage({ ...birthdayMessage, messageText: e.target.value })}
                sx={{ mt: 2 }}
              />
              
              <FormControl fullWidth sx={{ mt: 2 }}>
                <InputLabel>Gift Type</InputLabel>
                <Select
                  value={birthdayMessage.giftType}
                  label="Gift Type"
                  onChange={(e) => setBirthdayMessage({ ...birthdayMessage, giftType: e.target.value })}
                >
                  <MenuItem value="none">No gift, message only</MenuItem>
                  <MenuItem value="amazon">$10 Amazon eGift Card</MenuItem>
                  <MenuItem value="doordash">$10 DoorDash</MenuItem>
                  <MenuItem value="starbucks">$10 Starbucks</MenuItem>
                  <MenuItem value="custom">Custom Gift URL</MenuItem>
                </Select>
              </FormControl>
              
              {birthdayMessage.giftType === 'custom' && (
                <TextField
                  label="Custom Gift URL"
                  fullWidth
                  value={birthdayMessage.giftValue}
                  onChange={(e) => setBirthdayMessage({ ...birthdayMessage, giftValue: e.target.value })}
                  sx={{ mt: 2 }}
                  helperText="Enter a URL for a custom gift or reward"
                />
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBirthdayDialog(false)}>Cancel</Button>
          <Button
            onClick={handleSendBirthdayMessage}
            variant="contained"
            startIcon={<SendIcon />}
          >
            Send Birthday Message
          </Button>
        </DialogActions>
      </Dialog>

      {renderPreviewDialog()}

      <Snackbar
        open={success}
        autoHideDuration={3000}
        onClose={() => {
          setSuccess(false);
          setSuccessMessage('');
        }}
      >
        <Alert severity="success" sx={{ width: '100%' }}>
          {successMessage || 'Moment saved successfully!'}
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

export default MomentsEngine;
