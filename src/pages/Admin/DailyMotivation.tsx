import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Paper,
  Grid,
  Card,
  CardContent,
  Button,
  Chip,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  TextField,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
  CircularProgress,
  Tabs,
  Tab,
  LinearProgress,
  Switch,
  FormControlLabel,
  Snackbar,
  Avatar,
  FormGroup,
  Checkbox,
  Rating,
  SpeedDial,
  SpeedDialAction,
  SpeedDialIcon,
} from '@mui/material';
import { getFunctions, httpsCallable } from 'firebase/functions';
import {
  collection,
  getDocs,
  query,
  where,
} from 'firebase/firestore';
import {
  ArrowBack,
  CheckCircle,
  Settings,
  Refresh,
  Visibility,
  Analytics,
  TrendingFlat,
  Close,
  Add,
  Edit,
  Delete,
  Send,
  ThumbUp,
  ThumbDown,
  Star,
  PsychologyAlt,
  TrendingUp as TrendingUpIcon,
  Visibility as VisibilityIcon,
  Message as MessageIcon,
  ContentCopy,
} from '@mui/icons-material';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
} from 'recharts';
import { Link as RouterLink } from 'react-router-dom';

import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import MotivationMessageDialog from '../../components/MotivationMessageDialog';
import { LoggableSwitch, LoggableTextField, LoggableSelect } from '../../components/LoggableField';


interface MotivationMessage {
  id: string;
  text: string;
  quote?: string; // The actual quote
  author?: string; // Who said the quote
  category:
    | 'sales'
    | 'service'
    | 'general-labor'
    | 'healthcare'
    | 'logistics'
    | 'office'
    | 'general';
  tone: 'energizing' | 'calming' | 'reassuring' | 'reflective' | 'motivational';
  traits: string[];
  tags: string[];
  isActive: boolean;
  usageCount: number;
  averageRating: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

interface MotivationLog {
  id: string;
  workerId: string;
  workerName: string;
  messageId: string;
  messageText: string;
  category: string;
  tone: string;
  sentAt: string;
  delivered: boolean;
  opened: boolean;
  feedback?: 'positive' | 'negative' | 'neutral';
  feedbackText?: string;
  matchedReason: string;
  jobType: string;
  department: string;
  streakCount?: number;
  reactionTime?: number;
  smartDeliveryScore?: number;
  personalizationFactors?: string[];
  messageEffectiveness?: number;
}

interface MotivationSettings {
  tenantId: string;
  moduleEnabled: boolean;
  deliveryTime: string;
  frequency: 'daily' | '3x-week' | 'weekly';
  themeFocus: string[];
  optOutDefault: boolean;
  enableRoleBasedMessaging: boolean;
  enableTraitBasedMessaging: boolean;
  enableCustomMessages: boolean;
  enableAIComposition: boolean;
  enableSmartTiming: boolean;
  enableFeedbackCollection: boolean;
  enableSentimentTracking: boolean;
  enableOptOut: boolean;
  enableFeedback: boolean;
  dataRetentionDays: number;
  enableTraitMatching: boolean;
  enableJobRoleMatching: boolean;
  enableBehavioralMatching: boolean;
  roleCategories: string[];
  traitTags: string[];
  toneTags: string[];
  createdAt: string;
  updatedAt: string;
  enableStreakTracking: boolean;
  enableFeedbackLoop: boolean;
  enableSmartDelivery: boolean;
  enablePersonalizationLearning: boolean;
  streakRewardsEnabled: boolean;
  feedbackLoopSensitivity: number;
  smartDeliveryWindow: number;
  personalizationDepth: 'basic' | 'moderate' | 'advanced';
  themeOfTheMonth?: string;
  customDeliveryRules?: {
    role: string;
    optimalTime: string;
    frequency: string;
    tone: string;
  }[];
}

interface MotivationStats {
  totalMessages: number;
  totalDelivered: number;
  totalOpened: number;
  averageRating: number;
  positiveFeedbackRate: number;
  negativeFeedbackRate: number;
  neutralFeedbackRate: number;
  topCategories: { category: string; count: number }[];
  topTones: { tone: string; count: number }[];
  dailyDeliveryRate: number;
  weeklyDeliveryRate: number;
  monthlyDeliveryRate: number;
  averageStreakLength: number;
  activeStreakUsers: number;
  feedbackLoopAccuracy: number;
  smartDeliverySuccessRate: number;
  personalizationEffectiveness: number;
  topPerformingTraits: { trait: string; effectiveness: number }[];
  workerEngagementTrends: { date: string; engagement: number }[];
}

interface MotivationLibraryItem {
  id: string;
  text: string;
  quote?: string;
  author?: string;
  toneTags: string[];
  roleTags: string[];
  createdBy: string;
  source: string;
  isActive: boolean;
  createdAt: string;
  usageCount: number;
  averageRating: number;
  lastUsed?: string;
}

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;

  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`motivation-tabpanel-${index}`}
      aria-labelledby={`motivation-tab-${index}`}
      {...other}
    >
      {value === index && <Box sx={{ p: 3 }}>{children}</Box>}
    </div>
  );
}

const DailyMotivation: React.FC = () => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tabValue, setTabValue] = useState(0);
  const [messages, setMessages] = useState<MotivationMessage[]>([]);
  const [logs, setLogs] = useState<MotivationLog[]>([]);
  const [settings, setSettings] = useState<MotivationSettings | null>(null);
  const [stats, setStats] = useState<MotivationStats | null>(null);
  const [snackbar, setSnackbar] = useState<{
    open: boolean;
    message: string;
    severity: 'success' | 'error' | 'info' | 'warning';
  }>({
    open: false,
    message: '',
    severity: 'info',
  });

  // Dialog states
  const [messageDialogOpen, setMessageDialogOpen] = useState(false);
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [statsDialogOpen, setStatsDialogOpen] = useState(false);
  const [editingMessage, setEditingMessage] = useState<MotivationMessage | null>(null);
  
  // Motivation Library state
  const [motivationLibrary, setMotivationLibrary] = useState<MotivationLibraryItem[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [showLibraryDialog, setShowLibraryDialog] = useState(false);
  const [editingLibraryItem, setEditingLibraryItem] = useState<MotivationLibraryItem | null>(null);
  const [libraryFilters, setLibraryFilters] = useState({
    tone: '',
    role: '',
    source: '',
    isActive: true,
  });

  // At the top of the component, after hooks and before mock data:
  const functions = getFunctions();
  const logMotivationEvent = httpsCallable(functions, 'logMotivationEvent');

  // Helper to log motivation actions
  const logMotivationAction = async (action: {
    actionType: string;
    workerId: string;
    workerName?: string;
    messageId: string;
    messageText?: string;
    category?: string;
    tone?: string;
    sentAt?: string;
    delivered?: boolean;
    opened?: boolean;
    dismissed?: boolean;
    feedback?: 'positive' | 'negative' | 'neutral';
    feedbackText?: string;
    matchedReason?: string;
    jobType?: string;
    department?: string;
    streakCount?: number;
    smartDeliveryScore?: number;
    personalizationFactors?: string[];
    messageEffectiveness?: number;
    tenantId?: string;
    reason?: string;
  }) => {
    try {
      await logMotivationEvent(action);
      // Optionally, update local logs state or show a snackbar
    } catch (err) {
      console.error('Failed to log motivation event:', err);
      setSnackbar({ open: true, message: 'Failed to log motivation event', severity: 'error' });
    }
  };

  // Mock data for development
  const mockMessages: MotivationMessage[] = [
    {
      id: '1',
      text: 'Every no gets you closer to a yes. Keep dialing.',
      quote: 'Every no gets you closer to a yes.',
      author: 'Sales Proverb',
      category: 'sales',
      tone: 'energizing',
      traits: ['persistence', 'optimism'],
      tags: ['sales', 'persistence', 'motivation'],
      isActive: true,
      usageCount: 45,
      averageRating: 4.2,
      createdAt: '2024-01-15T10:00:00Z',
      updatedAt: '2024-01-15T10:00:00Z',
      createdBy: 'admin',
    },
    {
      id: '2',
      text: "Patience isn't weakness. It's mastery.",
      quote: "Patience is not the ability to wait, but the ability to keep a good attitude while waiting.",
      author: 'Joyce Meyer',
      category: 'service',
      tone: 'reassuring',
      traits: ['patience', 'wisdom'],
      tags: ['service', 'patience', 'wisdom'],
      isActive: true,
      usageCount: 32,
      averageRating: 4.5,
      createdAt: '2024-01-15T10:00:00Z',
      updatedAt: '2024-01-15T10:00:00Z',
      createdBy: 'admin',
    },
    {
      id: '3',
      text: 'Effort compounds. One box at a time builds strength.',
      category: 'logistics',
      tone: 'motivational',
      traits: ['persistence', 'strength'],
      tags: ['logistics', 'persistence', 'strength'],
      isActive: true,
      usageCount: 28,
      averageRating: 4.1,
      createdAt: '2024-01-15T10:00:00Z',
      updatedAt: '2024-01-15T10:00:00Z',
      createdBy: 'admin',
    },
    {
      id: '4',
      text: 'Your compassion matters more than you know.',
      category: 'healthcare',
      tone: 'reassuring',
      traits: ['compassion', 'empathy'],
      tags: ['healthcare', 'compassion', 'empathy'],
      isActive: true,
      usageCount: 38,
      averageRating: 4.7,
      createdAt: '2024-01-15T10:00:00Z',
      updatedAt: '2024-01-15T10:00:00Z',
      createdBy: 'admin',
    },
    {
      id: '5',
      text: "Small wins count. You're doing better than you think.",
      category: 'general',
      tone: 'reassuring',
      traits: ['optimism', 'self-compassion'],
      tags: ['general', 'optimism', 'self-compassion'],
      isActive: true,
      usageCount: 67,
      averageRating: 4.3,
      createdAt: '2024-01-15T10:00:00Z',
      updatedAt: '2024-01-15T10:00:00Z',
      createdBy: 'admin',
    },
  ];

  const mockLogs: MotivationLog[] = [
    {
      id: '1',
      workerId: 'worker1',
      workerName: 'John Smith',
      messageId: '1',
      messageText: 'Every no gets you closer to a yes. Keep dialing.',
      category: 'sales',
      tone: 'energizing',
      sentAt: '2024-01-20T09:00:00Z',
      delivered: true,
      opened: true,
      feedback: 'positive',
      feedbackText: 'Great motivation!',
      matchedReason: 'Sales role + high persistence trait',
      jobType: 'Sales Representative',
      department: 'Sales',
    },
    {
      id: '2',
      workerId: 'worker2',
      workerName: 'Sarah Johnson',
      messageId: '2',
      messageText: "Patience isn't weakness. It's mastery.",
      category: 'service',
      tone: 'reassuring',
      sentAt: '2024-01-20T09:00:00Z',
      delivered: true,
      opened: true,
      feedback: 'positive',
      feedbackText: 'Very helpful',
      matchedReason: 'Customer service role + patience trait',
      jobType: 'Customer Service Rep',
      department: 'Customer Service',
    },
  ];

  const mockStats: MotivationStats = {
    totalMessages: 5,
    totalDelivered: 156,
    totalOpened: 142,
    averageRating: 4.4,
    positiveFeedbackRate: 0.75,
    negativeFeedbackRate: 0.05,
    neutralFeedbackRate: 0.2,
    topCategories: [
      { category: 'general', count: 67 },
      { category: 'healthcare', count: 38 },
      { category: 'sales', count: 45 },
      { category: 'service', count: 32 },
      { category: 'logistics', count: 28 },
    ],
    topTones: [
      { tone: 'reassuring', count: 89 },
      { tone: 'energizing', count: 45 },
      { tone: 'motivational', count: 28 },
    ],
    dailyDeliveryRate: 0.92,
    weeklyDeliveryRate: 0.89,
    monthlyDeliveryRate: 0.85,
    averageStreakLength: 3.5,
    activeStreakUsers: 12,
    feedbackLoopAccuracy: 0.85,
    smartDeliverySuccessRate: 0.9,
    personalizationEffectiveness: 0.8,
    topPerformingTraits: [
      { trait: 'persistence', effectiveness: 0.95 },
      { trait: 'optimism', effectiveness: 0.85 },
      { trait: 'confidence', effectiveness: 0.8 },
    ],
    workerEngagementTrends: [
      { date: '2024-01-01', engagement: 0.8 },
      { date: '2024-01-02', engagement: 0.85 },
      { date: '2024-01-03', engagement: 0.9 },
    ],
  };

  const mockSettings: MotivationSettings = {
    tenantId: 'global',
    moduleEnabled: true,
    deliveryTime: '09:00',
    frequency: 'daily',
    themeFocus: ['resilience', 'positivity', 'growth'],
    optOutDefault: false,
    enableRoleBasedMessaging: true,
    enableTraitBasedMessaging: true,
    enableCustomMessages: true,
    enableAIComposition: true,
    enableSmartTiming: true,
    enableFeedbackCollection: true,
    enableSentimentTracking: true,
    enableOptOut: true,
    enableFeedback: true,
    dataRetentionDays: 730,
    enableTraitMatching: true,
    enableJobRoleMatching: true,
    enableBehavioralMatching: true,
    roleCategories: ['sales', 'service', 'general-labor', 'healthcare', 'logistics', 'office'],
    traitTags: ['confidence', 'patience', 'grit', 'focus', 'positivity', 'resilience'],
    toneTags: ['energizing', 'calming', 'reassuring', 'reflective', 'motivational'],
    createdAt: '2024-01-15T10:00:00Z',
    updatedAt: '2024-01-15T10:00:00Z',
    enableStreakTracking: true,
    enableFeedbackLoop: true,
    enableSmartDelivery: true,
    enablePersonalizationLearning: true,
    streakRewardsEnabled: true,
    feedbackLoopSensitivity: 0.5,
    smartDeliveryWindow: 15,
    personalizationDepth: 'moderate',
    themeOfTheMonth: 'resilience',
    customDeliveryRules: [
      {
        role: 'sales',
        optimalTime: '09:00',
        frequency: 'daily',
        tone: 'energizing',
      },
      {
        role: 'service',
        optimalTime: '09:00',
        frequency: 'daily',
        tone: 'reassuring',
      },
    ],
  };

  useEffect(() => {
    fetchMotivationData();
  }, []);

  useEffect(() => {
    if (tabValue === 4) {
      fetchMotivationLibrary();
    }
  }, [tabValue]);

  const fetchMotivationData = async () => {
    setLoading(true);
    setError(null);
    try {
      // Fetch real motivational messages from Firestore
      const motivationsQuery = query(collection(db, 'motivations'), where('isActive', '==', true));
      const motivationsSnapshot = await getDocs(motivationsQuery);
      const realMessages: MotivationMessage[] = motivationsSnapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          text: data.text,
          quote: data.quote,
          author: data.author,
          category: data.category || 'general',
          tone: data.tone || 'motivational',
          traits: data.traits || [],
          tags: data.tags || [],
          isActive: data.isActive,
          usageCount: data.usageCount || 0,
          averageRating: data.averageRating || 0,
          createdAt: data.createdAt ? data.createdAt.toDate().toISOString() : '',
          updatedAt: data.updatedAt ? data.updatedAt.toDate().toISOString() : '',
          createdBy: data.createdBy || '',
        };
      });
      setMessages(realMessages);

      // Optionally, fetch stats from Firestore or compute from realMessages
      setStats({
        totalMessages: realMessages.length,
        totalDelivered: 0, // You can fetch or compute this if you have logs
        totalOpened: 0,
        averageRating: realMessages.length > 0 ? realMessages.reduce((sum, m) => sum + (m.averageRating || 0), 0) / realMessages.length : 0,
        positiveFeedbackRate: 0,
        negativeFeedbackRate: 0,
        neutralFeedbackRate: 0,
        topCategories: [],
        topTones: [],
        dailyDeliveryRate: 0,
        weeklyDeliveryRate: 0,
        monthlyDeliveryRate: 0,
        averageStreakLength: 0,
        activeStreakUsers: 0,
        feedbackLoopAccuracy: 0,
        smartDeliverySuccessRate: 0,
        personalizationEffectiveness: 0,
        topPerformingTraits: [],
        workerEngagementTrends: [],
      });
      // You can expand stats logic as needed

      // Optionally, fetch logs and settings as before
      setLogs([]);
      setSettings(mockSettings); // Keep settings logic as is for now
    } catch (error: any) {
      console.error('Error fetching motivation data:', error);
      setError(error.message || 'Failed to fetch motivation data');
    } finally {
      setLoading(false);
    }
  };

  const fetchMotivationLibrary = async () => {
    setLibraryLoading(true);
    try {
      const getMotivations = httpsCallable(functions, 'getMotivations');
      const result = await getMotivations({
        tone: libraryFilters.tone,
        role: libraryFilters.role,
        source: libraryFilters.source,
        isActive: libraryFilters.isActive,
      });
      const data = result.data as { motivations: MotivationLibraryItem[] };
      setMotivationLibrary(data.motivations || []);
    } catch (err: any) {
      setError('Failed to fetch motivation library: ' + err.message);
    } finally {
      setLibraryLoading(false);
    }
  };

  const handleAddLibraryItem = () => {
    setEditingLibraryItem({
      id: '',
      text: '',
      toneTags: [],
      roleTags: [],
      createdBy: user?.uid || 'admin',
      source: 'custom',
      isActive: true,
      createdAt: new Date().toISOString(),
      usageCount: 0,
      averageRating: 0,
    });
    setShowLibraryDialog(true);
  };

  const handleEditLibraryItem = (item: MotivationLibraryItem) => {
    setEditingLibraryItem(item);
    setShowLibraryDialog(true);
  };

  const handleSaveLibraryItem = async (itemData: Partial<MotivationLibraryItem>) => {
    try {
      const addMotivation = httpsCallable(functions, 'addMotivation');
      await addMotivation({
        text: itemData.text,
        toneTags: itemData.toneTags,
        roleTags: itemData.roleTags,
        source: itemData.source,
        isActive: itemData.isActive,
      });
      
      setSnackbar({
        open: true,
        message: 'Motivation added to library successfully!',
        severity: 'success',
      });
      setShowLibraryDialog(false);
      setEditingLibraryItem(null);
      fetchMotivationLibrary();
    } catch (err: any) {
      setSnackbar({
        open: true,
        message: 'Failed to save motivation: ' + err.message,
        severity: 'error',
      });
    }
  };

  const handleAddMessage = () => {
    setEditingMessage(null);
    setMessageDialogOpen(true);
  };

  const handleEditMessage = (message: MotivationMessage) => {
    setEditingMessage(message);
    setMessageDialogOpen(true);
  };

  const handleSaveMessage = async (messageData: Partial<MotivationMessage>) => {
    try {
      if (editingMessage) {
        // Update existing message
        const updatedMessage = {
          ...editingMessage,
          ...messageData,
          updatedAt: new Date().toISOString(),
        };
        setMessages((prev) => prev.map((m) => (m.id === editingMessage.id ? updatedMessage : m)));
      } else {
        // Add new message
        const newMessage: MotivationMessage = {
          id: Date.now().toString(),
          text: messageData.text || '',
          quote: messageData.quote || '',
          author: messageData.author || '',
          category: messageData.category || 'general',
          tone: messageData.tone || 'motivational',
          traits: messageData.traits || [],
          tags: messageData.tags || [],
          isActive: true,
          usageCount: 0,
          averageRating: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          createdBy: user?.uid || 'admin',
        };
        setMessages((prev) => [...prev, newMessage]);
      }
      setMessageDialogOpen(false);
      setSnackbar({
        open: true,
        message: editingMessage ? 'Message updated successfully!' : 'Message added successfully!',
        severity: 'success',
      });
    } catch (error) {
      console.error('Error saving message:', error);
      setSnackbar({
        open: true,
        message: 'Failed to save message',
        severity: 'error',
      });
    }
  };

  const handleDeleteMessage = async (messageId: string) => {
    if (!window.confirm('Are you sure you want to delete this message?')) {
      return;
    }
    try {
      setMessages((prev) => prev.filter((m) => m.id !== messageId));
      setSnackbar({
        open: true,
        message: 'Message deleted successfully!',
        severity: 'success',
      });
    } catch (error) {
      console.error('Error deleting message:', error);
      setSnackbar({
        open: true,
        message: 'Failed to delete message',
        severity: 'error',
      });
    }
  };

  // Example event handlers for motivation logging
  const handleMessageViewed = async (workerId: string, messageId: string, messageText: string) => {
    // This would be called when a worker views a motivation message
    await logMotivationAction({
      actionType: 'motivation.view',
      workerId,
      messageId,
      messageText,
      opened: true,
      delivered: true,
      sentAt: new Date().toISOString(),
      reason: 'Worker opened motivation message',
    });
  };

  const handleMessageDismissed = async (workerId: string, messageId: string, messageText: string) => {
    // This would be called when a worker dismisses a motivation message
    await logMotivationAction({
      actionType: 'motivation.dismiss',
      workerId,
      messageId,
      messageText,
      opened: true,
      delivered: true,
      dismissed: true,
      sentAt: new Date().toISOString(),
      reason: 'Worker dismissed motivation message',
    });
  };

  const handleMessageFeedback = async (
    workerId: string,
    messageId: string,
    messageText: string,
    feedback: 'positive' | 'negative' | 'neutral',
    feedbackText?: string
  ) => {
    // This would be called when a worker provides feedback on a motivation message
    await logMotivationAction({
      actionType: 'motivation.feedback',
      workerId,
      messageId,
      messageText,
      opened: true,
      delivered: true,
      feedback,
      feedbackText,
      sentAt: new Date().toISOString(),
      reason: `Worker provided ${feedback} feedback on motivation message`,
    });
  };

  const handleMessageDelivered = async (workerId: string, messageId: string, messageText: string) => {
    // This would be called when a motivation message is delivered to a worker
    await logMotivationAction({
      actionType: 'motivation.deliver',
      workerId,
      messageId,
      messageText,
      delivered: true,
      sentAt: new Date().toISOString(),
      reason: 'Motivation message delivered to worker',
    });
  };

  const getCategoryColor = (category: string) => {
    const colors: Record<string, string> = {
      sales: '#1976d2',
      service: '#388e3c',
      'general-labor': '#f57c00',
      healthcare: '#d32f2f',
      logistics: '#7b1fa2',
      office: '#455a64',
      general: '#757575',
    };
    return colors[category] || '#757575';
  };

  const getToneColor = (tone: string) => {
    const colors: Record<string, string> = {
      energizing: '#ff9800',
      calming: '#2196f3',
      reassuring: '#4caf50',
      reflective: '#9c27b0',
      motivational: '#f44336',
    };
    return colors[tone] || '#757575';
  };

  const renderOverviewTab = () => (
    <Grid container spacing={3}>
      {/* Key Metrics */}
      <Grid item xs={12} md={2}>
        <Card>
          <CardContent>
            <Box display="flex" alignItems="center" justifyContent="space-between">
              <Box>
                <Typography color="textSecondary" gutterBottom>
                  Total Messages
                </Typography>
                <Typography variant="h4">{stats?.totalMessages || 0}</Typography>
              </Box>
              <MessageIcon color="primary" sx={{ fontSize: 40 }} />
            </Box>
          </CardContent>
        </Card>
      </Grid>

      <Grid item xs={12} md={2}>
        <Card>
          <CardContent>
            <Box display="flex" alignItems="center" justifyContent="space-between">
              <Box>
                <Typography color="textSecondary" gutterBottom>
                  Messages Delivered
                </Typography>
                <Typography variant="h4">{stats?.totalDelivered || 0}</Typography>
              </Box>
              <Send color="success" sx={{ fontSize: 40 }} />
            </Box>
          </CardContent>
        </Card>
      </Grid>

      <Grid item xs={12} md={2}>
        <Card>
          <CardContent>
            <Box display="flex" alignItems="center" justifyContent="space-between">
              <Box>
                <Typography color="textSecondary" gutterBottom>
                  Open Rate
                </Typography>
                <Typography variant="h4">
                  {stats ? Math.round((stats.totalOpened / stats.totalDelivered) * 100) : 0}%
                </Typography>
              </Box>
              <VisibilityIcon color="info" sx={{ fontSize: 40 }} />
            </Box>
          </CardContent>
        </Card>
      </Grid>

      <Grid item xs={12} md={2}>
        <Card>
          <CardContent>
            <Box display="flex" alignItems="center" justifyContent="space-between">
              <Box>
                <Typography color="textSecondary" gutterBottom>
                  Avg Rating
                </Typography>
                <Typography variant="h4">{stats?.averageRating.toFixed(1) || '0.0'}</Typography>
              </Box>
              <Star color="warning" sx={{ fontSize: 40 }} />
            </Box>
          </CardContent>
        </Card>
      </Grid>

      <Grid item xs={12} md={2}>
        <Card>
          <CardContent>
            <Box display="flex" alignItems="center" justifyContent="space-between">
              <Box>
                <Typography color="textSecondary" gutterBottom>
                  Active Streaks
                </Typography>
                <Typography variant="h4">{stats?.activeStreakUsers || 0}</Typography>
              </Box>
              <TrendingUpIcon color="success" sx={{ fontSize: 40 }} />
            </Box>
          </CardContent>
        </Card>
      </Grid>

      <Grid item xs={12} md={2}>
        <Card>
          <CardContent>
            <Box display="flex" alignItems="center" justifyContent="space-between">
              <Box>
                <Typography color="textSecondary" gutterBottom>
                  AI Accuracy
                </Typography>
                <Typography variant="h4">
                  {stats ? Math.round(stats.feedbackLoopAccuracy * 100) : 0}%
                </Typography>
              </Box>
              <PsychologyAlt color="primary" sx={{ fontSize: 40 }} />
            </Box>
          </CardContent>
        </Card>
      </Grid>

      {/* Feedback Distribution */}
      <Grid item xs={12} md={6}>
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Feedback Distribution
            </Typography>
            <Box display="flex" gap={2} alignItems="center">
              <Box flex={1}>
                <Typography variant="body2" color="textSecondary">
                  Positive
                </Typography>
                <LinearProgress
                  variant="determinate"
                  value={stats ? stats.positiveFeedbackRate * 100 : 0}
                  color="success"
                  sx={{ height: 8, borderRadius: 4 }}
                />
                <Typography variant="body2">
                  {stats ? Math.round(stats.positiveFeedbackRate * 100) : 0}%
                </Typography>
              </Box>
              <Box flex={1}>
                <Typography variant="body2" color="textSecondary">
                  Neutral
                </Typography>
                <LinearProgress
                  variant="determinate"
                  value={stats ? stats.neutralFeedbackRate * 100 : 0}
                  color="warning"
                  sx={{ height: 8, borderRadius: 4 }}
                />
                <Typography variant="body2">
                  {stats ? Math.round(stats.neutralFeedbackRate * 100) : 0}%
                </Typography>
              </Box>
              <Box flex={1}>
                <Typography variant="body2" color="textSecondary">
                  Negative
                </Typography>
                <LinearProgress
                  variant="determinate"
                  value={stats ? stats.negativeFeedbackRate * 100 : 0}
                  color="error"
                  sx={{ height: 8, borderRadius: 4 }}
                />
                <Typography variant="body2">
                  {stats ? Math.round(stats.negativeFeedbackRate * 100) : 0}%
                </Typography>
              </Box>
            </Box>
          </CardContent>
        </Card>
      </Grid>

      {/* Top Categories */}
      <Grid item xs={12} md={6}>
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Top Categories
            </Typography>
            <Box display="flex" flexDirection="column" gap={1}>
              {stats?.topCategories.map((cat, index) => (
                <Box
                  key={cat.category}
                  display="flex"
                  justifyContent="space-between"
                  alignItems="center"
                >
                  <Box display="flex" alignItems="center" gap={1}>
                    <Box
                      sx={{
                        width: 12,
                        height: 12,
                        borderRadius: '50%',
                        bgcolor: getCategoryColor(cat.category),
                      }}
                    />
                    <Typography variant="body2" sx={{ textTransform: 'capitalize' }}>
                      {cat.category.replace('-', ' ')}
                    </Typography>
                  </Box>
                  <Typography variant="body2" fontWeight="bold">
                    {cat.count}
                  </Typography>
                </Box>
              ))}
            </Box>
          </CardContent>
        </Card>
      </Grid>

      {/* AI Performance Analytics */}
      <Grid item xs={12} md={6}>
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              AI Performance Analytics
            </Typography>
            <Box display="flex" flexDirection="column" gap={2}>
              <Box>
                <Typography variant="subtitle2" color="textSecondary">
                  Feedback Loop Accuracy
                </Typography>
                <LinearProgress
                  variant="determinate"
                  value={stats ? stats.feedbackLoopAccuracy * 100 : 0}
                  color="primary"
                  sx={{ height: 8, borderRadius: 4 }}
                />
                <Typography variant="body2">
                  {stats ? Math.round(stats.feedbackLoopAccuracy * 100) : 0}% - How well AI
                  predictions match actual feedback
                </Typography>
              </Box>
              <Box>
                <Typography variant="subtitle2" color="textSecondary">
                  Smart Delivery Success Rate
                </Typography>
                <LinearProgress
                  variant="determinate"
                  value={stats ? stats.smartDeliverySuccessRate * 100 : 0}
                  color="success"
                  sx={{ height: 8, borderRadius: 4 }}
                />
                <Typography variant="body2">
                  {stats ? Math.round(stats.smartDeliverySuccessRate * 100) : 0}% - Optimal timing
                  delivery success
                </Typography>
              </Box>
              <Box>
                <Typography variant="subtitle2" color="textSecondary">
                  Personalization Effectiveness
                </Typography>
                <LinearProgress
                  variant="determinate"
                  value={stats ? stats.personalizationEffectiveness * 100 : 0}
                  color="warning"
                  sx={{ height: 8, borderRadius: 4 }}
                />
                <Typography variant="body2">
                  {stats ? Math.round(stats.personalizationEffectiveness * 100) : 0}% - Impact of
                  trait-based matching
                </Typography>
              </Box>
            </Box>
          </CardContent>
        </Card>
      </Grid>

      {/* Top Performing Traits */}
      <Grid item xs={12} md={6}>
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Top Performing Traits
            </Typography>
            <Box display="flex" flexDirection="column" gap={1}>
              {stats?.topPerformingTraits.map((trait, index) => (
                <Box
                  key={trait.trait}
                  display="flex"
                  justifyContent="space-between"
                  alignItems="center"
                >
                  <Box display="flex" alignItems="center" gap={1}>
                    <Typography
                      variant="body2"
                      sx={{ textTransform: 'capitalize', fontWeight: 'bold' }}
                    >
                      {trait.trait}
                    </Typography>
                  </Box>
                  <Box display="flex" alignItems="center" gap={1}>
                    <Typography variant="body2" fontWeight="bold">
                      {Math.round(trait.effectiveness * 100)}%
                    </Typography>
                    <Star color="warning" fontSize="small" />
                  </Box>
                </Box>
              ))}
            </Box>
          </CardContent>
        </Card>
      </Grid>

      {/* Recent Activity */}
      <Grid item xs={12}>
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Recent Activity
            </Typography>
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Worker</TableCell>
                    <TableCell>Message</TableCell>
                    <TableCell>Category</TableCell>
                    <TableCell>Tone</TableCell>
                    <TableCell>Sent</TableCell>
                    <TableCell>Streak</TableCell>
                    <TableCell>Feedback</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {logs.slice(0, 5).map((log) => (
                    <TableRow key={log.id}>
                      <TableCell>
                        <Box display="flex" alignItems="center" gap={1}>
                          <Avatar sx={{ width: 32, height: 32 }}>{log.workerName.charAt(0)}</Avatar>
                          <Typography variant="body2">{log.workerName}</Typography>
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" sx={{ maxWidth: 200 }}>
                          {log.messageText}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={log.category}
                          size="small"
                          sx={{
                            bgcolor: getCategoryColor(log.category),
                            color: 'white',
                          }}
                        />
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={log.tone}
                          size="small"
                          sx={{
                            bgcolor: getToneColor(log.tone),
                            color: 'white',
                          }}
                        />
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">
                          {new Date(log.sentAt).toLocaleDateString()}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        {log.streakCount && (
                          <Chip label={`🔥 ${log.streakCount}`} size="small" color="warning" />
                        )}
                      </TableCell>
                      <TableCell>
                        {log.feedback === 'positive' && <ThumbUp color="success" />}
                        {log.feedback === 'negative' && <ThumbDown color="error" />}
                        {log.feedback === 'neutral' && <TrendingFlat color="action" />}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>
        </Card>
      </Grid>
    </Grid>
  );

  const renderMessagesTab = () => (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h6">Message Library ({messages.length} messages)</Typography>
        <Button variant="contained" startIcon={<Add />} onClick={handleAddMessage}>
          Add Message
        </Button>
      </Box>

      <Grid container spacing={2}>
        {messages.map((message) => (
          <Grid item xs={12} md={6} lg={4} key={message.id}>
            <Card>
              <CardContent>
                <Box display="flex" justifyContent="space-between" alignItems="flex-start" mb={2}>
                  <Box flex={1}>
                    <Typography variant="body1" sx={{ fontStyle: 'italic', mb: 1 }}>
                      "{message.text}"
                    </Typography>
                    {message.quote && message.author && (
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                        Based on: "{message.quote}" — {message.author}
                      </Typography>
                    )}
                    <Box display="flex" gap={1} mb={1}>
                      <Chip
                        label={message.category}
                        size="small"
                        sx={{
                          bgcolor: getCategoryColor(message.category),
                          color: 'white',
                        }}
                      />
                      <Chip
                        label={message.tone}
                        size="small"
                        sx={{
                          bgcolor: getToneColor(message.tone),
                          color: 'white',
                        }}
                      />
                    </Box>
                    <Box display="flex" gap={1} flexWrap="wrap">
                      {message.traits.slice(0, 3).map((trait) => (
                        <Chip key={trait} label={trait} size="small" variant="outlined" />
                      ))}
                    </Box>
                  </Box>
                  <Box display="flex" flexDirection="column" alignItems="flex-end" gap={1}>
                    <Rating value={message.averageRating} readOnly size="small" />
                    <Typography variant="caption" color="textSecondary">
                      {message.usageCount} uses
                    </Typography>
                  </Box>
                </Box>

                <Box display="flex" justifyContent="space-between" alignItems="center">
                  <FormControlLabel
                    control={
                      <Switch
                        checked={message.isActive}
                        onChange={(e) => {
                          setMessages((prev) =>
                            prev.map((m) =>
                              m.id === message.id ? { ...m, isActive: e.target.checked } : m,
                            ),
                          );
                        }}
                        size="small"
                      />
                    }
                    label="Active"
                  />
                  <Box>
                    <IconButton size="small" onClick={() => handleEditMessage(message)}>
                      <Edit />
                    </IconButton>
                    <IconButton
                      size="small"
                      color="error"
                      onClick={() => handleDeleteMessage(message.id)}
                    >
                      <Delete />
                    </IconButton>
                  </Box>
                </Box>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>
    </Box>
  );

  const renderLogsTab = () => (
    <Box>
      <Typography variant="h6" gutterBottom>
        Message Logs ({logs.length} entries)
      </Typography>

      {/* Demonstration of logging integration */}
      <Card sx={{ mb: 3, bgcolor: 'info.50' }}>
        <CardContent>
          <Typography variant="h6" color="primary" gutterBottom>
            📊 Logging Integration Demo
          </Typography>
          <Typography variant="body2" color="textSecondary" paragraph>
            The following buttons demonstrate how motivation events are logged and trigger AI updates:
          </Typography>
          <Box display="flex" gap={2} flexWrap="wrap">
            <Button
              variant="outlined"
              size="small"
              onClick={() => handleMessageDelivered('worker1', '1', 'Every no gets you closer to a yes. Keep dialing.')}
              startIcon={<Send />}
            >
              Log Message Delivered
            </Button>
            <Button
              variant="outlined"
              size="small"
              onClick={() => handleMessageViewed('worker1', '1', 'Every no gets you closer to a yes. Keep dialing.')}
              startIcon={<Visibility />}
            >
              Log Message Viewed
            </Button>
            <Button
              variant="outlined"
              size="small"
              onClick={() => handleMessageDismissed('worker1', '1', 'Every no gets you closer to a yes. Keep dialing.')}
              startIcon={<Close />}
            >
              Log Message Dismissed
            </Button>
            <Button
              variant="outlined"
              size="small"
              onClick={() => handleMessageFeedback('worker1', '1', 'Every no gets you closer to a yes. Keep dialing.', 'positive', 'Great motivation!')}
              startIcon={<ThumbUp />}
            >
              Log Positive Feedback
            </Button>
            <Button
              variant="outlined"
              size="small"
              onClick={() => handleMessageFeedback('worker1', '1', 'Every no gets you closer to a yes. Keep dialing.', 'negative', 'Not helpful')}
              startIcon={<ThumbDown />}
            >
              Log Negative Feedback
            </Button>
          </Box>
          <Typography variant="caption" color="textSecondary" sx={{ mt: 1, display: 'block' }}>
            💡 These events are logged to ai_logs and trigger AI profile updates for the worker
          </Typography>
        </CardContent>
      </Card>

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Worker</TableCell>
              <TableCell>Message</TableCell>
              <TableCell>Category</TableCell>
              <TableCell>Tone</TableCell>
              <TableCell>Sent</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Feedback</TableCell>
              <TableCell>Match Reason</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {logs.map((log) => (
              <TableRow key={log.id}>
                <TableCell>
                  <Box display="flex" alignItems="center" gap={1}>
                    <Avatar sx={{ width: 32, height: 32 }}>{log.workerName.charAt(0)}</Avatar>
                    <Box>
                      <Typography variant="body2">{log.workerName}</Typography>
                      <Typography variant="caption" color="textSecondary">
                        {log.jobType}
                      </Typography>
                    </Box>
                  </Box>
                </TableCell>
                <TableCell>
                  <Typography variant="body2" sx={{ maxWidth: 200 }}>
                    {log.messageText}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Chip
                    label={log.category}
                    size="small"
                    sx={{
                      bgcolor: getCategoryColor(log.category),
                      color: 'white',
                    }}
                  />
                </TableCell>
                <TableCell>
                  <Chip
                    label={log.tone}
                    size="small"
                    sx={{
                      bgcolor: getToneColor(log.tone),
                      color: 'white',
                    }}
                  />
                </TableCell>
                <TableCell>
                  <Typography variant="body2">
                    {new Date(log.sentAt).toLocaleDateString()}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Box display="flex" alignItems="center" gap={1}>
                    {log.delivered && <CheckCircle color="success" fontSize="small" />}
                    {log.opened && <Visibility color="info" fontSize="small" />}
                  </Box>
                </TableCell>
                <TableCell>
                  {log.feedback === 'positive' && <ThumbUp color="success" />}
                  {log.feedback === 'negative' && <ThumbDown color="error" />}
                  {log.feedback === 'neutral' && <TrendingFlat color="action" />}
                </TableCell>
                <TableCell>
                  <Typography variant="caption" color="textSecondary">
                    {log.matchedReason}
                  </Typography>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );

  const renderAILearningTab = () => (
    <Grid container spacing={3}>
      {/* AI Learning Performance */}
      <Grid item xs={12} md={6}>
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              AI Learning Performance
            </Typography>
            <Box display="flex" flexDirection="column" gap={2}>
              <Box>
                <Typography variant="subtitle2" color="textSecondary">
                  Feedback Loop Accuracy
                </Typography>
                <Typography variant="h4" color="primary">
                  {stats ? Math.round(stats.feedbackLoopAccuracy * 100) : 0}%
                </Typography>
                <Typography variant="body2" color="textSecondary">
                  How well AI predictions match actual worker feedback
                </Typography>
              </Box>
              <Box>
                <Typography variant="subtitle2" color="textSecondary">
                  Smart Delivery Success
                </Typography>
                <Typography variant="h4" color="success">
                  {stats ? Math.round(stats.smartDeliverySuccessRate * 100) : 0}%
                </Typography>
                <Typography variant="body2" color="textSecondary">
                  Optimal timing delivery success rate
                </Typography>
              </Box>
              <Box>
                <Typography variant="subtitle2" color="textSecondary">
                  Personalization Effectiveness
                </Typography>
                <Typography variant="h4" color="warning">
                  {stats ? Math.round(stats.personalizationEffectiveness * 100) : 0}%
                </Typography>
                <Typography variant="body2" color="textSecondary">
                  Impact of trait-based message matching
                </Typography>
              </Box>
            </Box>
          </CardContent>
        </Card>
      </Grid>

      {/* Streak Analytics */}
      <Grid item xs={12} md={6}>
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Streak Analytics
            </Typography>
            <Box display="flex" flexDirection="column" gap={2}>
              <Box>
                <Typography variant="subtitle2" color="textSecondary">
                  Active Streak Users
                </Typography>
                <Typography variant="h4" color="success">
                  {stats?.activeStreakUsers || 0}
                </Typography>
                <Typography variant="body2" color="textSecondary">
                  Workers currently maintaining streaks
                </Typography>
              </Box>
              <Box>
                <Typography variant="subtitle2" color="textSecondary">
                  Average Streak Length
                </Typography>
                <Typography variant="h4" color="warning">
                  {stats?.averageStreakLength.toFixed(1) || '0.0'}
                </Typography>
                <Typography variant="body2" color="textSecondary">
                  Average consecutive days of engagement
                </Typography>
              </Box>
            </Box>
          </CardContent>
        </Card>
      </Grid>

      {/* Top Performing Traits */}
      <Grid item xs={12}>
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Top Performing Traits & Patterns
            </Typography>
            <Grid container spacing={2}>
              {stats?.topPerformingTraits.map((trait, index) => (
                <Grid item xs={12} sm={6} md={4} key={trait.trait}>
                  <Box sx={{ p: 2, border: 1, borderColor: 'divider', borderRadius: 1 }}>
                    <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                      <Typography
                        variant="subtitle1"
                        sx={{ textTransform: 'capitalize', fontWeight: 'bold' }}
                      >
                        {trait.trait}
                      </Typography>
                      <Star color="warning" />
                    </Box>
                    <Typography variant="h5" color="primary">
                      {Math.round(trait.effectiveness * 100)}%
                    </Typography>
                    <Typography variant="body2" color="textSecondary">
                      Effectiveness score
                    </Typography>
                  </Box>
                </Grid>
              ))}
            </Grid>
          </CardContent>
        </Card>
      </Grid>

      {/* Engagement Trends */}
      <Grid item xs={12}>
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Worker Engagement Trends
            </Typography>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={stats?.workerEngagementTrends || []}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <RechartsTooltip />
                <Line type="monotone" dataKey="engagement" stroke="#8884d8" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </Grid>
    </Grid>
  );

  const renderMotivationLibraryTab = () => (
    <Grid container spacing={3}>
      {/* Header */}
      <Grid item xs={12}>
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
          <Typography variant="h5" gutterBottom>
            📚 Motivation Library
          </Typography>
          <Box display="flex" gap={2}>
            <Button
              variant="outlined"
              startIcon={<Refresh />}
              onClick={fetchMotivationLibrary}
              disabled={libraryLoading}
            >
              Refresh
            </Button>
            <Button
              variant="contained"
              startIcon={<Add />}
              onClick={handleAddLibraryItem}
            >
              Add Motivation
            </Button>
          </Box>
        </Box>
      </Grid>

      {/* Filters */}
      <Grid item xs={12}>
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Filters
            </Typography>
            <Grid container spacing={2}>
              <Grid item xs={12} md={3}>
                <FormControl fullWidth>
                  <InputLabel>Tone</InputLabel>
                  <Select
                    value={libraryFilters.tone}
                    label="Tone"
                    onChange={(e) => setLibraryFilters({ ...libraryFilters, tone: e.target.value })}
                  >
                    <MenuItem value="">All Tones</MenuItem>
                    <MenuItem value="energizing">Energizing</MenuItem>
                    <MenuItem value="calming">Calming</MenuItem>
                    <MenuItem value="reassuring">Reassuring</MenuItem>
                    <MenuItem value="reflective">Reflective</MenuItem>
                    <MenuItem value="motivational">Motivational</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} md={3}>
                <FormControl fullWidth>
                  <InputLabel>Role</InputLabel>
                  <Select
                    value={libraryFilters.role}
                    label="Role"
                    onChange={(e) => setLibraryFilters({ ...libraryFilters, role: e.target.value })}
                  >
                    <MenuItem value="">All Roles</MenuItem>
                    <MenuItem value="sales">Sales</MenuItem>
                    <MenuItem value="service">Service</MenuItem>
                    <MenuItem value="healthcare">Healthcare</MenuItem>
                    <MenuItem value="logistics">Logistics</MenuItem>
                    <MenuItem value="office">Office</MenuItem>
                    <MenuItem value="general">General</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} md={3}>
                <FormControl fullWidth>
                  <InputLabel>Source</InputLabel>
                  <Select
                    value={libraryFilters.source}
                    label="Source"
                    onChange={(e) => setLibraryFilters({ ...libraryFilters, source: e.target.value })}
                  >
                    <MenuItem value="">All Sources</MenuItem>
                    <MenuItem value="custom">Custom</MenuItem>
                    <MenuItem value="curated">Curated</MenuItem>
                    <MenuItem value="ai-generated">AI Generated</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} md={3}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={libraryFilters.isActive}
                      onChange={(e) => setLibraryFilters({ ...libraryFilters, isActive: e.target.checked })}
                    />
                  }
                  label="Active Only"
                />
              </Grid>
            </Grid>
          </CardContent>
        </Card>
      </Grid>

      {/* Library Items */}
      <Grid item xs={12}>
        {libraryLoading ? (
          <Box display="flex" justifyContent="center" p={4}>
            <CircularProgress />
          </Box>
        ) : (
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Motivation Messages ({motivationLibrary.length})
              </Typography>
              {motivationLibrary.length === 0 ? (
                <Box textAlign="center" py={4}>
                  <Typography color="text.secondary">
                    No motivation messages found. Add your first one!
                  </Typography>
                </Box>
              ) : (
                <TableContainer>
                  <Table>
                                          <TableHead>
                        <TableRow>
                          <TableCell>Message</TableCell>
                          <TableCell>Attribution</TableCell>
                          <TableCell>Tone Tags</TableCell>
                          <TableCell>Role Tags</TableCell>
                          <TableCell>Source</TableCell>
                          <TableCell>Usage</TableCell>
                          <TableCell>Rating</TableCell>
                          <TableCell>Actions</TableCell>
                        </TableRow>
                      </TableHead>
                    <TableBody>
                      {motivationLibrary.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell>
                            <Typography variant="body2" sx={{ maxWidth: 300 }}>
                              {item.text}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2" color="text.secondary">
                              {item.quote && item.author ? `"${item.quote}" — ${item.author}` : '—'}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Box display="flex" gap={0.5} flexWrap="wrap">
                              {item.toneTags.map((tag) => (
                                <Chip
                                  key={tag}
                                  label={tag}
                                  size="small"
                                  color="primary"
                                  variant="outlined"
                                />
                              ))}
                            </Box>
                          </TableCell>
                          <TableCell>
                            <Box display="flex" gap={0.5} flexWrap="wrap">
                              {item.roleTags.map((tag) => (
                                <Chip
                                  key={tag}
                                  label={tag}
                                  size="small"
                                  color="secondary"
                                  variant="outlined"
                                />
                              ))}
                            </Box>
                          </TableCell>
                          <TableCell>
                            <Chip
                              label={item.source}
                              size="small"
                              color={item.source === 'custom' ? 'success' : 'default'}
                            />
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2">
                              {item.usageCount} uses
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Box display="flex" alignItems="center" gap={1}>
                              <Rating value={item.averageRating} readOnly size="small" />
                              <Typography variant="body2">
                                {item.averageRating.toFixed(1)}
                              </Typography>
                            </Box>
                          </TableCell>
                          <TableCell>
                            <Box display="flex" gap={1}>
                              <IconButton
                                size="small"
                                onClick={() => handleEditLibraryItem(item)}
                              >
                                <Edit />
                              </IconButton>
                                                              <IconButton
                                  size="small"
                                  color="primary"
                                  onClick={() => {
                                    // Copy to clipboard
                                    navigator.clipboard.writeText(item.text);
                                    setSnackbar({
                                      open: true,
                                      message: 'Message copied to clipboard!',
                                      severity: 'success',
                                    });
                                  }}
                                >
                                  <ContentCopy />
                                </IconButton>
                            </Box>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </CardContent>
          </Card>
        )}
      </Grid>
    </Grid>
  );

  const renderSettingsTab = () => (
    <Grid container spacing={3}>
      <Grid item xs={12} md={8}>
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Module Settings
            </Typography>

            <Grid container spacing={3}>
              <Grid item xs={12} sm={6}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={settings?.moduleEnabled || false}
                      onChange={(e) => {
                        setSettings((prev) =>
                          prev ? { ...prev, moduleEnabled: e.target.checked } : null,
                        );
                      }}
                    />
                  }
                  label="Module Enabled"
                />
              </Grid>

              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  label="Delivery Time"
                  type="time"
                  value={settings?.deliveryTime || '09:00'}
                  onChange={(e) => {
                    setSettings((prev) =>
                      prev ? { ...prev, deliveryTime: e.target.value } : null,
                    );
                  }}
                  InputLabelProps={{ shrink: true }}
                />
              </Grid>

              <Grid item xs={12} sm={6}>
                <FormControl fullWidth>
                  <InputLabel>Frequency</InputLabel>
                  <Select
                    value={settings?.frequency || 'daily'}
                    onChange={(e) => {
                      setSettings((prev) =>
                        prev ? { ...prev, frequency: e.target.value as any } : null,
                      );
                    }}
                  >
                    <MenuItem value="daily">Daily</MenuItem>
                    <MenuItem value="3x-week">3x Week</MenuItem>
                    <MenuItem value="weekly">Weekly</MenuItem>
                  </Select>
                </FormControl>
              </Grid>

              <Grid item xs={12} sm={6}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={settings?.optOutDefault || false}
                      onChange={(e) => {
                        setSettings((prev) =>
                          prev ? { ...prev, optOutDefault: e.target.checked } : null,
                        );
                      }}
                    />
                  }
                  label="Opt-out Default"
                />
              </Grid>
            </Grid>
          </CardContent>
        </Card>

        <Card sx={{ mt: 3 }}>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              AI Integration Settings
            </Typography>

            <Grid container spacing={3}>
              <Grid item xs={12} sm={6}>
                <LoggableSwitch
                  fieldPath="appAiSettings.motivation.enableRoleBasedMessaging"
                  trigger="update"
                  destinationModules={['MotivationEngine', 'ContextEngine']}
                  value={settings?.enableRoleBasedMessaging || false}
                  onChange={(value: boolean) => {
                    setSettings((prev) =>
                      prev ? { ...prev, enableRoleBasedMessaging: value } : null,
                    );
                  }}
                  label="Role-based Messaging"
                  contextType="motivation"
                  urgencyScore={5}
                  description="Admin motivation role-based messaging setting"
                />
              </Grid>

              <Grid item xs={12} sm={6}>
                <LoggableSwitch
                  fieldPath="appAiSettings.motivation.enableTraitBasedMessaging"
                  trigger="update"
                  destinationModules={['MotivationEngine', 'TraitsEngine']}
                  value={settings?.enableTraitBasedMessaging || false}
                  onChange={(value: boolean) => {
                    setSettings((prev) =>
                      prev ? { ...prev, enableTraitBasedMessaging: value } : null,
                    );
                  }}
                  label="Trait-based Messaging"
                  contextType="motivation"
                  urgencyScore={5}
                  description="Admin motivation trait-based messaging setting"
                />
              </Grid>

              <Grid item xs={12} sm={6}>
                <LoggableSwitch
                  fieldPath="appAiSettings.motivation.enableAIComposition"
                  trigger="update"
                  destinationModules={['MotivationEngine', 'ContextEngine']}
                  value={settings?.enableAIComposition || false}
                  onChange={(value: boolean) => {
                    setSettings((prev) =>
                      prev ? { ...prev, enableAIComposition: value } : null,
                    );
                  }}
                  label="AI Message Composition"
                  contextType="motivation"
                  urgencyScore={6}
                  description="Admin motivation AI composition setting"
                />
              </Grid>

              <Grid item xs={12} sm={6}>
                <LoggableSwitch
                  fieldPath="appAiSettings.motivation.enableSmartTiming"
                  trigger="update"
                  destinationModules={['MotivationEngine', 'ContextEngine']}
                  value={settings?.enableSmartTiming || false}
                  onChange={(value: boolean) => {
                    setSettings((prev) =>
                      prev ? { ...prev, enableSmartTiming: value } : null,
                    );
                  }}
                  label="Smart Timing"
                  contextType="motivation"
                  urgencyScore={4}
                  description="Admin motivation smart timing setting"
                />
              </Grid>

              <Grid item xs={12} sm={6}>
                <LoggableSwitch
                  fieldPath="appAiSettings.motivation.enableStreakTracking"
                  trigger="update"
                  destinationModules={['MotivationEngine', 'ContextEngine']}
                  value={settings?.enableStreakTracking || false}
                  onChange={(value: boolean) => {
                    setSettings((prev) =>
                      prev ? { ...prev, enableStreakTracking: value } : null,
                    );
                  }}
                  label="Streak Tracking"
                  contextType="motivation"
                  urgencyScore={4}
                  description="Admin motivation streak tracking setting"
                />
              </Grid>

              <Grid item xs={12} sm={6}>
                <LoggableSwitch
                  fieldPath="appAiSettings.motivation.enableFeedbackLoop"
                  trigger="update"
                  destinationModules={['MotivationEngine', 'FeedbackEngine']}
                  value={settings?.enableFeedbackLoop || false}
                  onChange={(value: boolean) => {
                    setSettings((prev) =>
                      prev ? { ...prev, enableFeedbackLoop: value } : null,
                    );
                  }}
                  label="Feedback Loop Learning"
                  contextType="motivation"
                  urgencyScore={6}
                  description="Admin motivation feedback loop setting"
                />
              </Grid>

              <Grid item xs={12} sm={6}>
                <LoggableSwitch
                  fieldPath="appAiSettings.motivation.enablePersonalizationLearning"
                  trigger="update"
                  destinationModules={['MotivationEngine', 'ContextEngine']}
                  value={settings?.enablePersonalizationLearning || false}
                  onChange={(value: boolean) => {
                    setSettings((prev) =>
                      prev
                        ? { ...prev, enablePersonalizationLearning: value }
                        : null,
                    );
                  }}
                  label="Personalization Learning"
                  contextType="motivation"
                  urgencyScore={5}
                  description="Admin motivation personalization learning setting"
                />
              </Grid>

              <Grid item xs={12} sm={6}>
                <LoggableSwitch
                  fieldPath="appAiSettings.motivation.streakRewardsEnabled"
                  trigger="update"
                  destinationModules={['MotivationEngine', 'ContextEngine']}
                  value={settings?.streakRewardsEnabled || false}
                  onChange={(value: boolean) => {
                    setSettings((prev) =>
                      prev ? { ...prev, streakRewardsEnabled: value } : null,
                    );
                  }}
                  label="Streak Rewards"
                  contextType="motivation"
                  urgencyScore={3}
                  description="Admin motivation streak rewards setting"
                />
              </Grid>
            </Grid>
          </CardContent>
        </Card>

        <Card sx={{ mt: 3 }}>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Advanced AI Settings
            </Typography>

            <Grid container spacing={3}>
              <Grid item xs={12} sm={6}>
                <LoggableTextField
                  fieldPath="appAiSettings.motivation.feedbackLoopSensitivity"
                  trigger="update"
                  destinationModules={['MotivationEngine', 'FeedbackEngine']}
                  value={(settings?.feedbackLoopSensitivity || 0.5).toString()}
                  onChange={(value: string) => {
                    setSettings((prev) =>
                      prev
                        ? { ...prev, feedbackLoopSensitivity: parseFloat(value) }
                        : null,
                    );
                  }}
                  label="Feedback Loop Sensitivity"
                  placeholder="0.0 to 1.0"
                  contextType="motivation"
                  urgencyScore={6}
                  description="Admin motivation feedback loop sensitivity setting"
                />
              </Grid>

              <Grid item xs={12} sm={6}>
                <LoggableTextField
                  fieldPath="appAiSettings.motivation.smartDeliveryWindow"
                  trigger="update"
                  destinationModules={['MotivationEngine', 'ContextEngine']}
                  value={(settings?.smartDeliveryWindow || 15).toString()}
                  onChange={(value: string) => {
                    setSettings((prev) =>
                      prev ? { ...prev, smartDeliveryWindow: parseInt(value) } : null,
                    );
                  }}
                  label="Smart Delivery Window (minutes)"
                  placeholder="5 to 60"
                  contextType="motivation"
                  urgencyScore={4}
                  description="Admin motivation smart delivery window setting"
                />
              </Grid>

              <Grid item xs={12} sm={6}>
                <LoggableSelect
                  fieldPath="appAiSettings.motivation.personalizationDepth"
                  trigger="update"
                  destinationModules={['MotivationEngine', 'ContextEngine']}
                  value={settings?.personalizationDepth || 'moderate'}
                  onChange={(value: string) => {
                    setSettings((prev) =>
                      prev ? { ...prev, personalizationDepth: value as any } : null,
                    );
                  }}
                  label="Personalization Depth"
                  options={[
                    { value: 'basic', label: 'Basic' },
                    { value: 'moderate', label: 'Moderate' },
                    { value: 'advanced', label: 'Advanced' }
                  ]}
                  contextType="motivation"
                  urgencyScore={5}
                  description="Admin motivation personalization depth setting"
                />
              </Grid>

              <Grid item xs={12} sm={6}>
                <LoggableTextField
                  fieldPath="appAiSettings.motivation.themeOfTheMonth"
                  trigger="update"
                  destinationModules={['MotivationEngine', 'ContextEngine']}
                  value={settings?.themeOfTheMonth || ''}
                  onChange={(value: string) => {
                    setSettings((prev) =>
                      prev ? { ...prev, themeOfTheMonth: value } : null,
                    );
                  }}
                  label="Theme of the Month"
                  placeholder="e.g., resilience, growth, gratitude"
                  contextType="motivation"
                  urgencyScore={3}
                  description="Admin motivation theme of the month setting"
                />
              </Grid>
            </Grid>
          </CardContent>
        </Card>
      </Grid>

      <Grid item xs={12} md={4}>
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Theme Focus
            </Typography>
            <FormGroup>
              {['resilience', 'positivity', 'growth', 'patience', 'confidence'].map((theme) => (
                <FormControlLabel
                  key={theme}
                  control={
                    <Checkbox
                      checked={settings?.themeFocus.includes(theme) || false}
                      onChange={(e) => {
                        if (settings) {
                          const newThemes = e.target.checked
                            ? [...settings.themeFocus, theme]
                            : settings.themeFocus.filter((t) => t !== theme);
                          setSettings({ ...settings, themeFocus: newThemes });
                        }
                      }}
                    />
                  }
                  label={theme.charAt(0).toUpperCase() + theme.slice(1)}
                />
              ))}
            </FormGroup>
          </CardContent>
        </Card>

        <Card sx={{ mt: 3 }}>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Quick Actions
            </Typography>
            <Box display="flex" flexDirection="column" gap={2}>
              <Button variant="outlined" startIcon={<Send />} fullWidth>
                Send Test Message
              </Button>
              <Button variant="outlined" startIcon={<Refresh />} fullWidth>
                Refresh Message Library
              </Button>
              <Button variant="outlined" startIcon={<Analytics />} fullWidth>
                Generate Analytics Report
              </Button>
            </Box>
          </CardContent>
        </Card>
      </Grid>
    </Grid>
  );

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
        <Button variant="contained" onClick={fetchMotivationData}>
          Retry
        </Button>
      </Box>
    );
  }

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, bgcolor: 'background.default', minHeight: '100vh' }}>
      {/* Header */}
      <Box sx={{ mb: 4 }}>
        <Box display="flex" alignItems="center" justifyContent="space-between" mb={2}>
          <Box display="flex" alignItems="center" gap={2}>
            <Button
              variant="outlined"
              startIcon={<ArrowBack />}
              onClick={() => window.history.back()}
            >
              Back
            </Button>
            <Typography variant="h4" fontWeight={600}>
              Daily Motivation
            </Typography>
            <Chip label="Beta" color="warning" size="small" />
          </Box>
          <Box display="flex" gap={2}>
            <Button
              variant="outlined"
              startIcon={<Settings />}
              onClick={() => setSettingsDialogOpen(true)}
            >
              Settings
            </Button>
            <Button variant="contained" startIcon={<Add />} onClick={handleAddMessage}>
              Add Message
            </Button>
          </Box>
          <Button
            component={RouterLink}
            to="/admin/motivation-seeder"
            variant="outlined"
            color="secondary"
          >
            Go to Motivation Seeder
          </Button>
        </Box>
        <Typography variant="body1" color="text.secondary">
          AI-powered motivational messaging system that delivers personalized, job-appropriate
          positive messages to boost morale and engagement
        </Typography>
      </Box>

      {/* Tabs */}
      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
        <Tabs value={tabValue} onChange={(e, newValue) => setTabValue(newValue)}>
          <Tab label="Overview" />
          <Tab label={`Messages (${messages.length})`} />
          <Tab label={`Logs (${logs.length})`} />
          <Tab label="AI Learning" />
          <Tab label={`Library (${motivationLibrary.length})`} />
          <Tab label="Settings" />
        </Tabs>
      </Box>

      {/* Tab Content */}
      <TabPanel value={tabValue} index={0}>
        {renderOverviewTab()}
      </TabPanel>
      <TabPanel value={tabValue} index={1}>
        {renderMessagesTab()}
      </TabPanel>
      <TabPanel value={tabValue} index={2}>
        {renderLogsTab()}
      </TabPanel>
      <TabPanel value={tabValue} index={3}>
        {renderAILearningTab()}
      </TabPanel>
      <TabPanel value={tabValue} index={4}>
        {renderMotivationLibraryTab()}
      </TabPanel>
      <TabPanel value={tabValue} index={5}>
        {renderSettingsTab()}
      </TabPanel>

      {/* Speed Dial for Quick Actions */}
      <SpeedDial
        ariaLabel="Quick actions"
        sx={{ position: 'fixed', bottom: 16, right: 16 }}
        icon={<SpeedDialIcon />}
      >
        <SpeedDialAction icon={<Add />} tooltipTitle="Add Message" onClick={handleAddMessage} />
        <SpeedDialAction
          icon={<Send />}
          tooltipTitle="Send Test"
          onClick={() =>
            setSnackbar({ open: true, message: 'Test message sent!', severity: 'success' })
          }
        />
        <SpeedDialAction
          icon={<Analytics />}
          tooltipTitle="Analytics"
          onClick={() => setStatsDialogOpen(true)}
        />
      </SpeedDial>

      {/* Message Dialog */}
      <MotivationMessageDialog
        open={messageDialogOpen}
        onClose={() => setMessageDialogOpen(false)}
        onSave={handleSaveMessage}
        message={editingMessage}
      />

      {/* Library Dialog */}
      <Dialog open={showLibraryDialog} onClose={() => setShowLibraryDialog(false)} maxWidth="md" fullWidth>
        <DialogTitle>
          {editingLibraryItem?.id ? 'Edit Motivation' : 'Add Motivation to Library'}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ mt: 2 }}>
            <TextField
              label="Motivation Text"
              multiline
              rows={4}
              fullWidth
              value={editingLibraryItem?.text || ''}
              onChange={(e) => setEditingLibraryItem(prev => prev ? { ...prev, text: e.target.value } : null)}
              sx={{ mb: 2 }}
            />
            
            <FormControl fullWidth sx={{ mb: 2 }}>
              <InputLabel>Source</InputLabel>
              <Select
                value={editingLibraryItem?.source || 'custom'}
                label="Source"
                onChange={(e) => setEditingLibraryItem(prev => prev ? { ...prev, source: e.target.value } : null)}
              >
                <MenuItem value="custom">Custom</MenuItem>
                <MenuItem value="curated">Curated</MenuItem>
                <MenuItem value="ai-generated">AI Generated</MenuItem>
              </Select>
            </FormControl>

            <FormControlLabel
              control={
                <Switch
                  checked={editingLibraryItem?.isActive || false}
                  onChange={(e) => setEditingLibraryItem(prev => prev ? { ...prev, isActive: e.target.checked } : null)}
                />
              }
              label="Active"
              sx={{ mb: 2 }}
            />

            <Typography variant="subtitle2" gutterBottom>
              Tone Tags (comma-separated)
            </Typography>
            <TextField
              fullWidth
              value={editingLibraryItem?.toneTags.join(', ') || ''}
              onChange={(e) => {
                const tags = e.target.value.split(',').map(tag => tag.trim()).filter(tag => tag);
                setEditingLibraryItem(prev => prev ? { ...prev, toneTags: tags } : null);
              }}
              placeholder="energizing, motivational, reassuring"
              sx={{ mb: 2 }}
            />

            <Typography variant="subtitle2" gutterBottom>
              Role Tags (comma-separated)
            </Typography>
            <TextField
              fullWidth
              value={editingLibraryItem?.roleTags.join(', ') || ''}
              onChange={(e) => {
                const tags = e.target.value.split(',').map(tag => tag.trim()).filter(tag => tag);
                setEditingLibraryItem(prev => prev ? { ...prev, roleTags: tags } : null);
              }}
              placeholder="sales, service, healthcare, general"
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowLibraryDialog(false)}>Cancel</Button>
          <Button
            onClick={() => editingLibraryItem && handleSaveLibraryItem(editingLibraryItem)}
            variant="contained"
            disabled={!editingLibraryItem?.text}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>

      {/* Snackbar */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
      >
        <Alert
          onClose={() => setSnackbar({ ...snackbar, open: false })}
          severity={snackbar.severity}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default DailyMotivation;
