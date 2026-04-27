import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Paper,
  Grid,
  Card,
  CardContent,
  CardActions,
  Button,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Divider,
  Alert,
  CircularProgress,
  Avatar,
  Stack,
} from '@mui/material';
import {
  ArrowBack,
  Settings,
  Launch,
  Add,
  Edit,
  Delete,
  VisibilityOff,
  CheckCircle,
  Warning,
  Info,
  Business,
  Psychology,
  Campaign,
  Analytics,
  Assignment,
  People,
  Assessment,
  Star,
  PowerSettingsNew,
  Tune,
  Notifications,
  TrendingUp,
} from '@mui/icons-material';
import { collection, getDocs, doc, setDoc, deleteDoc } from 'firebase/firestore';

import { LoggableTextField, LoggableSwitch } from '../../components/LoggableField';
import { db } from '../../firebase';

interface Module {
  id: string;
  name: string;
  description: string;
  icon?: string;
  status: 'active' | 'inactive' | 'coming-soon' | 'beta';
  category: 'core' | 'optional' | 'insights' | 'productivity' | 'wellness' | 'communication';
  targetRoles: string[];
  globalSettings: Record<string, any>;
  version: string;
  lastUpdated: string;
  isEnabled: boolean;
  aiRecommendsByDefault: boolean;
  dependencies: string[];
  adminNotes?: string;
  isAlwaysOn?: boolean;
  priority?: 'high' | 'medium' | 'low';
}

const defaultModules: Module[] = [
  {
    id: 'hrx-companion',
    name: 'HRX Companion',
    description: 'Always-on AI companion that provides personalized support, guidance, and engagement through intelligent conversations and contextual assistance.',
    icon: '🤖',
    status: 'active',
    category: 'core',
    targetRoles: ['hrx-admin', 'customer-admin', 'agency-admin'],
    globalSettings: {
      moduleEnabled: true,
      alwaysOnMode: true,
      enableBranding: true,
      enableReflectionPrompts: true,
      enableMessagingFeatures: true,
      enablePersonalization: true,
      enableContextAwareness: true,
      enableMultiLanguage: true,
      enableVoiceInteraction: false,
      enableEmotionDetection: true,
      enableConversationHistory: true,
      enableSmartSuggestions: true,
      enableEscalationLogic: true,
      enableFeedbackCollection: true,
      enableAnalytics: true,
      dataRetentionDays: 1095,
    },
    version: '2.0.0',
    lastUpdated: new Date().toISOString(),
    isEnabled: true,
    aiRecommendsByDefault: true,
    dependencies: [],
    isAlwaysOn: true,
    priority: 'high',
    adminNotes: 'Core AI companion system that provides 24/7 support to workers. Features intelligent conversation capabilities, contextual awareness, and seamless integration with all other HRX modules.',
  },
  {
    id: 'hrx-intelligence',
    name: 'HRX Intelligence',
    description: 'Always-on intelligence engine that continuously monitors, analyzes, and provides risk scoring with configurable alert thresholds and predictive insights.',
    icon: '🧠',
    status: 'active',
    category: 'core',
    targetRoles: ['hrx-admin', 'customer-admin', 'agency-admin'],
    globalSettings: {
      moduleEnabled: true,
      alwaysOnMode: true,
      enableRiskScoring: true,
      enableAlertThresholds: true,
      enablePredictiveAnalytics: true,
      enablePatternDetection: true,
      enableAnomalyDetection: true,
      enableRealTimeMonitoring: true,
      enableHistoricalAnalysis: true,
      enableBenchmarking: true,
      enableCustomAlerts: true,
      enableEscalationWorkflows: true,
      enableDataVisualization: true,
      enableExportCapabilities: true,
      enableAPIIntegration: true,
      dataRetentionDays: 1825,
    },
    version: '2.0.0',
    lastUpdated: new Date().toISOString(),
    isEnabled: true,
    aiRecommendsByDefault: true,
    dependencies: [],
    isAlwaysOn: true,
    priority: 'high',
    adminNotes: 'Core intelligence engine that provides continuous monitoring and risk assessment across all HRX modules. Features advanced analytics, predictive modeling, and configurable alert systems.',
  },
  {
    id: 'hrx-traits-engine',
    name: 'HRX Traits Engine',
    description: 'Always-on behavioral analysis engine that observes, tracks, and configures worker traits, flag logic, and behavioral patterns for personalized experiences.',
    icon: '🎯',
    status: 'active',
    category: 'core',
    targetRoles: ['hrx-admin', 'customer-admin', 'agency-admin'],
    globalSettings: {
      moduleEnabled: true,
      alwaysOnMode: true,
      enableTraitObservation: true,
      enableFlagLogic: true,
      enableBehavioralPatterns: true,
      enablePersonalityMapping: true,
      enableAdaptiveLearning: true,
      enableTraitScoring: true,
      enableCustomTraits: true,
      enableTraitInheritance: true,
      enableCrossModuleIntegration: true,
      enablePrivacyControls: true,
      enableDataAnonymization: true,
      enableTraitAnalytics: true,
      enableExportTraits: true,
      dataRetentionDays: 1095,
    },
    version: '2.0.0',
    lastUpdated: new Date().toISOString(),
    isEnabled: true,
    aiRecommendsByDefault: true,
    dependencies: [],
    isAlwaysOn: true,
    priority: 'high',
    adminNotes: 'Core traits engine that continuously observes and analyzes worker behavior to create personalized experiences. Provides the foundation for all other HRX modules by understanding individual worker characteristics.',
  },
  {
    id: 'hrx-moments-engine',
    name: 'HRX Moments Engine',
    description: 'Intelligent intervention system that delivers personalized nudges, manages 1:1 cadence, and provides manager prompts based on behavioral insights.',
    icon: '⏰',
    status: 'active',
    category: 'optional',
    targetRoles: ['hrx-admin', 'customer-admin', 'agency-admin'],
    globalSettings: {
      moduleEnabled: true,
      enableNudges: true,
      enableOneOnOneCadence: true,
      enableManagerPrompts: true,
      enableSmartTiming: true,
      enablePersonalization: true,
      enableAITriggers: true,
      enableFeedbackCollection: true,
      enableEffectivenessTracking: true,
      enableCustomTemplates: true,
      enableMultiChannelDelivery: true,
      enableEscalationLogic: true,
      enableAnalytics: true,
      enableReporting: true,
      enableIntegration: true,
      dataRetentionDays: 730,
    },
    version: '1.5.0',
    lastUpdated: new Date().toISOString(),
    isEnabled: true,
    aiRecommendsByDefault: true,
    dependencies: ['hrx-traits-engine'],
    priority: 'medium',
    adminNotes: 'Optional moments engine that delivers intelligent interventions and nudges based on behavioral insights. Integrates with Traits Engine for personalized experiences.',
  },
  {
    id: 'hrx-campaigns',
    name: 'HRX Campaigns',
    description: 'Strategic campaign management system for triggering targeted campaigns, viewing engagement metrics, and designing multi-step sequences.',
    icon: '📢',
    status: 'active',
    category: 'optional',
    targetRoles: ['hrx-admin', 'customer-admin', 'agency-admin'],
    globalSettings: {
      moduleEnabled: true,
      enableCampaignTriggers: true,
      enableEngagementTracking: true,
      enableSequenceDesign: true,
      enableAITargeting: true,
      enableMultiStepSequences: true,
      enableABTesting: true,
      enablePerformanceAnalytics: true,
      enableCustomTemplates: true,
      enableScheduling: true,
      enableAutomation: true,
      enableIntegration: true,
      enableReporting: true,
      enableExport: true,
      enableAPIAccess: true,
      dataRetentionDays: 1095,
    },
    version: '1.5.0',
    lastUpdated: new Date().toISOString(),
    isEnabled: true,
    aiRecommendsByDefault: true,
    dependencies: ['hrx-traits-engine', 'hrx-intelligence'],
    priority: 'medium',
    adminNotes: 'Optional campaigns system for creating and managing targeted engagement campaigns. Features AI-powered targeting and multi-step sequence design.',
  },
  {
    id: 'hrx-broadcasts',
    name: 'HRX Broadcasts',
    description: 'Flexible communication system for one-time or recurring nudges, surveys, and pulse checks with intelligent targeting and analytics.',
    icon: '📡',
    status: 'active',
    category: 'optional',
    targetRoles: ['hrx-admin', 'customer-admin', 'agency-admin'],
    globalSettings: {
      moduleEnabled: true,
      enableOneTimeBroadcasts: true,
      enableRecurringBroadcasts: true,
      enableSurveys: true,
      enablePulseChecks: true,
      enableIntelligentTargeting: true,
      enableAnalytics: true,
      enableCustomTemplates: true,
      enableScheduling: true,
      enableAutomation: true,
      enableMultiChannelDelivery: true,
      enableResponseTracking: true,
      enableReporting: true,
      enableIntegration: true,
      enableExport: true,
      dataRetentionDays: 730,
    },
    version: '1.5.0',
    lastUpdated: new Date().toISOString(),
    isEnabled: true,
    aiRecommendsByDefault: true,
    dependencies: ['hrx-traits-engine'],
    priority: 'medium',
    adminNotes: 'Optional broadcast system for targeted communications and surveys. Features intelligent targeting and comprehensive analytics.',
  },
  {
    id: 'hrx-flex',
    name: 'HRX Flex',
    description: 'Flexible workforce management system with configurable job order functionality, visibility rules, and dynamic assignment capabilities.',
    icon: '⚡',
    status: 'active',
    category: 'optional',
    targetRoles: ['hrx-admin', 'customer-admin', 'agency-admin'],
    globalSettings: {
      moduleEnabled: true,
      enableJobOrders: true,
      enableVisibilityRules: true,
      enableDynamicAssignment: true,
      enableSkillMatching: true,
      enableAvailabilityTracking: true,
      enablePerformanceScoring: true,
      enableAutomatedAssignment: true,
      enableCustomRules: true,
      enableAnalytics: true,
      enableReporting: true,
      enableIntegration: true,
      enableMobileAccess: true,
      enableNotifications: true,
      enableExport: true,
      dataRetentionDays: 1095,
    },
    version: '1.5.0',
    lastUpdated: new Date().toISOString(),
    isEnabled: true,
    aiRecommendsByDefault: true,
    dependencies: ['hrx-traits-engine'],
    priority: 'medium',
    adminNotes: 'Optional flex workforce management system with configurable job order functionality and visibility rules.',
  },
  {
    id: 'hrx-recruiter',
    name: 'HRX Recruiter',
    description: 'Intelligent recruitment system with application settings, AI scoring, and internal mobility logic for optimized talent acquisition.',
    icon: '👥',
    status: 'active',
    category: 'optional',
    targetRoles: ['hrx-admin', 'customer-admin', 'agency-admin'],
    globalSettings: {
      moduleEnabled: true,
      enableApplicationSettings: true,
      enableAIScoring: true,
      enableInternalMobility: true,
      enableSkillAssessment: true,
      enableCulturalFit: true,
      enablePredictiveHiring: true,
      enableAutomatedScreening: true,
      enableInterviewScheduling: true,
      enableCandidateTracking: true,
      enableAnalytics: true,
      enableReporting: true,
      enableIntegration: true,
      enableExport: true,
      enableAPIAccess: true,
      dataRetentionDays: 1825,
    },
    version: '1.5.0',
    lastUpdated: new Date().toISOString(),
    isEnabled: true,
    aiRecommendsByDefault: true,
    dependencies: ['hrx-traits-engine', 'hrx-intelligence'],
    priority: 'medium',
    adminNotes: 'Optional recruitment system with AI-powered scoring and internal mobility logic.',
  },
  {
    id: 'hrx-insight-reports',
    name: 'HRX Insight Reports',
    description: 'Comprehensive reporting system with toggleable reports, favorites management, and customizable report templates for data-driven decisions.',
    icon: '📊',
    status: 'active',
    category: 'optional',
    targetRoles: ['hrx-admin', 'customer-admin', 'agency-admin'],
    globalSettings: {
      moduleEnabled: true,
      enableToggleReports: true,
      enableFavorites: true,
      enableCustomTemplates: true,
      enableScheduledReports: true,
      enableDataVisualization: true,
      enableExportOptions: true,
      enableSharing: true,
      enableDrillDown: true,
      enableRealTimeData: true,
      enableHistoricalComparison: true,
      enableBenchmarking: true,
      enableAPIAccess: true,
      enableIntegration: true,
      enableMobileAccess: true,
      dataRetentionDays: 1825,
    },
    version: '1.5.0',
    lastUpdated: new Date().toISOString(),
    isEnabled: true,
    aiRecommendsByDefault: true,
    dependencies: ['hrx-intelligence'],
    priority: 'medium',
    adminNotes: 'Optional insight reporting system with customizable templates and comprehensive analytics.',
  },
];

const ModulesDashboard: React.FC = () => {
  const [modules, setModules] = useState<Module[]>(defaultModules);
  const [loading, setLoading] = useState(true);
  const [selectedModule, setSelectedModule] = useState<Module | null>(null);
  const [isDetailView, setIsDetailView] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingModule, setEditingModule] = useState<Module | null>(null);
  const [saveLoading, setSaveLoading] = useState(false);

  // Helper functions for enterprise styling
  const getModuleIcon = (module: Module) => {
    const iconMap: Record<string, React.ReactElement> = {
      'hrx-companion': <Business sx={{ fontSize: 40, color: 'primary.main' }} />,
      'hrx-intelligence': <Psychology sx={{ fontSize: 40, color: 'primary.main' }} />,
      'hrx-traits-engine': <Analytics sx={{ fontSize: 40, color: 'primary.main' }} />,
      'hrx-moments-engine': <Notifications sx={{ fontSize: 40, color: 'primary.main' }} />,
      'hrx-campaigns': <Campaign sx={{ fontSize: 40, color: 'primary.main' }} />,
      'hrx-broadcasts': <TrendingUp sx={{ fontSize: 40, color: 'primary.main' }} />,
      'hrx-flex': <Assignment sx={{ fontSize: 40, color: 'primary.main' }} />,
      'hrx-recruiter': <People sx={{ fontSize: 40, color: 'primary.main' }} />,
      'hrx-insight-reports': <Assessment sx={{ fontSize: 40, color: 'primary.main' }} />,
    };
    return iconMap[module.id] || <Business sx={{ fontSize: 40, color: 'primary.main' }} />;
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high':
        return 'error';
      case 'medium':
        return 'warning';
      case 'low':
        return 'success';
      default:
        return 'default';
    }
  };

  const getCategoryModules = (category: string) => {
    return modules.filter(module => module.category === category);
  };

  useEffect(() => {
    const fetchModules = async () => {
      setLoading(true);
      try {
        const snapshot = await getDocs(collection(db, 'modules'));
        const fetchedModules = snapshot.docs.map(
          (doc) => ({ id: doc.id, ...doc.data() } as Module),
        );
        if (fetchedModules.length > 0) {
          setModules(fetchedModules);
        } else {
          // Initialize with default modules if none exist
          await initializeDefaultModules();
        }
      } catch (error) {
        console.error('Error fetching modules:', error);
        // Fallback to default modules
        setModules(defaultModules);
      } finally {
        setLoading(false);
      }
    };

    fetchModules();
  }, []);

  const initializeDefaultModules = async () => {
    try {
      for (const module of defaultModules) {
        await setDoc(doc(db, 'modules', module.id), module);
      }
      setModules(defaultModules);
    } catch (error) {
      console.error('Error initializing default modules:', error);
    }
  };

  const handleModuleClick = (module: Module) => {
    // Special handling for JSI module
    if (module.id === 'job-satisfaction-insights') {
      window.location.href = '/admin/job-satisfaction-insights';
      return;
    }

    // Special handling for Daily Motivation module
    if (module.id === 'daily-motivation') {
      window.location.href = '/admin/daily-motivation';
      return;
    }

    setSelectedModule(module);
    setIsDetailView(true);
  };

  const handleBackToModules = () => {
    setIsDetailView(false);
    setSelectedModule(null);
  };

  const handleEditModule = (module: Module) => {
    setEditingModule({ ...module });
    setEditDialogOpen(true);
  };

  const handleSaveModule = async () => {
    if (!editingModule) return;

    setSaveLoading(true);
    try {
      const updatedModule = {
        ...editingModule,
        lastUpdated: new Date().toISOString(),
      };

      await setDoc(doc(db, 'modules', editingModule.id), updatedModule);

      setModules((prev) => prev.map((m) => (m.id === editingModule.id ? updatedModule : m)));

      if (selectedModule?.id === editingModule.id) {
        setSelectedModule(updatedModule);
      }

      setEditDialogOpen(false);
      setEditingModule(null);
    } catch (error) {
      console.error('Error saving module:', error);
    } finally {
      setSaveLoading(false);
    }
  };

  const handleDeleteModule = async (moduleId: string) => {
    if (
      !window.confirm('Are you sure you want to delete this module? This action cannot be undone.')
    ) {
      return;
    }

    try {
      await deleteDoc(doc(db, 'modules', moduleId));
      setModules((prev) => prev.filter((m) => m.id !== moduleId));

      if (selectedModule?.id === moduleId) {
        handleBackToModules();
      }
    } catch (error) {
      console.error('Error deleting module:', error);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'success';
      case 'beta':
        return 'warning';
      case 'coming-soon':
        return 'info';
      case 'inactive':
        return 'default';
      default:
        return 'default';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'active':
        return <CheckCircle />;
      case 'beta':
        return <Warning />;
      case 'coming-soon':
        return <Info />;
      case 'inactive':
        return <VisibilityOff />;
      default:
        return <Info />;
    }
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  if (isDetailView && selectedModule) {
    return (
      <Box sx={{ p: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
          <Typography variant="h4" fontWeight={600}>
            {selectedModule.name}
          </Typography>
          <Button
            variant="outlined"
            color="primary"
            startIcon={<ArrowBack />}
            onClick={handleBackToModules}
            sx={{ fontWeight: 600 }}
          >
            Back to Modules
          </Button>
        </Box>
        <Typography variant="subtitle1" color="text.secondary" mb={3}>
          {selectedModule.description}
        </Typography>

        <Grid container spacing={3}>
          <Grid item xs={12} md={8}>
            <Paper sx={{ p: 3, mb: 3 }}>
              <Typography variant="h6" gutterBottom>
                Module Overview
              </Typography>
              <Typography variant="body1" color="text.secondary" paragraph>
                {selectedModule.description}
              </Typography>

              <Box display="flex" gap={1} mb={2}>
                <Chip label={`v${selectedModule.version}`} size="small" />
                <Chip label={selectedModule.category} size="small" />
                {selectedModule.aiRecommendsByDefault && (
                  <Chip label="AI Recommended" color="success" size="small" />
                )}
              </Box>

              <Typography variant="subtitle2" gutterBottom>
                Target Roles:
              </Typography>
              <Box display="flex" gap={1} mb={3}>
                {selectedModule.targetRoles.map((role) => (
                  <Chip key={role} label={role} size="small" variant="outlined" />
                ))}
              </Box>

              {selectedModule.adminNotes && (
                <Alert severity="info" sx={{ mb: 2 }}>
                  <Typography variant="subtitle2" gutterBottom>
                    Admin Notes:
                  </Typography>
                  <Typography variant="body2">{selectedModule.adminNotes}</Typography>
                </Alert>
              )}
            </Paper>

            <Paper sx={{ p: 3 }}>
              <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                <Typography variant="h6">Global Settings</Typography>
                <Button
                  startIcon={<Edit />}
                  variant="outlined"
                  size="small"
                  onClick={() => handleEditModule(selectedModule)}
                >
                  Edit Settings
                </Button>
              </Box>

              <Grid container spacing={2}>
                {Object.entries(selectedModule.globalSettings).map(([key, value]) => (
                  <Grid item xs={12} sm={6} key={key}>
                    <Box>
                      <Typography variant="subtitle2" color="text.secondary">
                        {key.replace(/([A-Z])/g, ' $1').replace(/^./, (str) => str.toUpperCase())}
                      </Typography>
                      <Typography variant="body1">
                        {typeof value === 'boolean'
                          ? value
                            ? 'Enabled'
                            : 'Disabled'
                          : String(value)}
                      </Typography>
                    </Box>
                  </Grid>
                ))}
              </Grid>
            </Paper>
          </Grid>

          <Grid item xs={12} md={4}>
            <Paper sx={{ p: 3, mb: 3 }}>
              <Typography variant="h6" gutterBottom>
                Module Actions
              </Typography>
              <Box display="flex" flexDirection="column" gap={2}>
                <Button
                  variant="contained"
                  startIcon={<Launch />}
                  fullWidth
                  disabled={selectedModule.status === 'coming-soon'}
                >
                  Launch Module
                </Button>
                <Button
                  variant="outlined"
                  startIcon={<Settings />}
                  fullWidth
                  onClick={() => handleEditModule(selectedModule)}
                >
                  Configure Settings
                </Button>
                <Button
                  variant="outlined"
                  color="error"
                  startIcon={<Delete />}
                  fullWidth
                  onClick={() => handleDeleteModule(selectedModule.id)}
                >
                  Delete Module
                </Button>
              </Box>
            </Paper>

            <Paper sx={{ p: 3 }}>
              <Typography variant="h6" gutterBottom>
                Module Info
              </Typography>
              <Box>
                <Typography variant="body2" color="text.secondary">
                  Last Updated: {new Date(selectedModule.lastUpdated).toLocaleDateString()}
                </Typography>
                {selectedModule.dependencies.length > 0 && (
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                    Dependencies: {selectedModule.dependencies.join(', ')}
                  </Typography>
                )}
              </Box>
            </Paper>
          </Grid>
        </Grid>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 0, bgcolor: 'background.default', minHeight: '100vh' }}>
      {/* Header Section */}
      <Box sx={{ 
        bgcolor: 'white', 
        p: 4, 
        mb: 4, 
        borderRadius: 2, 
        boxShadow: 1,
        border: '1px solid',
        borderColor: 'divider'
      }}>
        <Box display="flex" justifyContent="space-between" alignItems="center">
          <Box>
            <Typography variant="h3" component="h1" gutterBottom sx={{ fontWeight: 600, color: 'text.primary' }}>
              HRX Enterprise Modules
            </Typography>
            <Typography variant="body1" color="text.secondary" sx={{ fontSize: '1.1rem' }}>
              Configure and manage core and optional modules for enterprise workforce management
            </Typography>
          </Box>
          <Button
            variant="contained"
            startIcon={<Add />}
            size="large"
            sx={{ 
              px: 3, 
              py: 1.5, 
              fontWeight: 600,
              borderRadius: 2
            }}
            onClick={() => {
              setEditingModule({
                id: '',
                name: '',
                description: '',
                status: 'inactive',
                category: 'optional',
                targetRoles: [],
                globalSettings: {},
                version: '1.0.0',
                lastUpdated: new Date().toISOString(),
                isEnabled: false,
                aiRecommendsByDefault: false,
                dependencies: [],
              });
              setEditDialogOpen(true);
            }}
          >
            Add Module
          </Button>
        </Box>
      </Box>

      {/* Core Modules Section */}
      <Box sx={{ mb: 6 }}>
        <Box sx={{ 
          display: 'flex', 
          alignItems: 'center', 
          mb: 3,
          p: 2,
          bgcolor: 'primary.main',
          color: 'white',
          borderRadius: 2
        }}>
          <Star sx={{ mr: 2, fontSize: 28 }} />
          <Typography variant="h5" sx={{ fontWeight: 600 }}>
            Core Modules
          </Typography>
          <Chip 
            label="Always On" 
            sx={{ 
              ml: 2, 
              bgcolor: 'rgba(255,255,255,0.2)', 
              color: 'white',
              fontWeight: 600
            }} 
          />
        </Box>
        
        <Grid container spacing={3}>
          {getCategoryModules('core').map((module) => (
            <Grid item xs={12} sm={6} md={4} key={module.id}>
              <Card
                sx={{
                  height: '100%',
                  cursor: 'pointer',
                  transition: 'all 0.3s ease-in-out',
                  border: '2px solid',
                  borderColor: 'primary.main',
                  bgcolor: 'white',
                  '&:hover': {
                    transform: 'translateY(-8px)',
                    boxShadow: 8,
                    borderColor: 'primary.dark',
                  },
                }}
                onClick={() => handleModuleClick(module)}
              >
                <CardContent sx={{ p: 3, height: '100%', display: 'flex', flexDirection: 'column' }}>
                  <Box display="flex" justifyContent="space-between" alignItems="flex-start" mb={3}>
                    <Avatar
                      sx={{
                        width: 60,
                        height: 60,
                        bgcolor: 'primary.main',
                        color: 'white',
                        fontSize: 24,
                        fontWeight: 600
                      }}
                    >
                      {getModuleIcon(module)}
                    </Avatar>
                    <Stack direction="row" spacing={1}>
                      {module.isAlwaysOn && (
                        <Chip
                          label="Always On"
                          color="primary"
                          size="small"
                          icon={<PowerSettingsNew />}
                          sx={{ fontWeight: 600 }}
                        />
                      )}
                      <Chip
                        label={module.priority || 'medium'}
                        color={getPriorityColor(module.priority || 'medium')}
                        size="small"
                        sx={{ fontWeight: 600 }}
                      />
                    </Stack>
                  </Box>

                  <Typography variant="h6" component="h2" gutterBottom sx={{ fontWeight: 600, color: 'text.primary' }}>
                    {module.name}
                  </Typography>

                  <Typography variant="body2" color="text.secondary" sx={{ flexGrow: 1, mb: 3, lineHeight: 1.6 }}>
                    {module.description}
                  </Typography>

                  <Box display="flex" gap={1} mb={2} flexWrap="wrap">
                    <Chip 
                      label="Core" 
                      color="primary" 
                      size="small" 
                      variant="outlined"
                      sx={{ fontWeight: 600 }}
                    />
                    {module.aiRecommendsByDefault && (
                      <Chip 
                        label="AI Powered" 
                        color="success" 
                        size="small"
                        sx={{ fontWeight: 600 }}
                      />
                    )}
                  </Box>

                  <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 500 }}>
                    v{module.version} • {module.targetRoles.length} target roles
                  </Typography>
                </CardContent>

                <CardActions sx={{ p: 3, pt: 0 }}>
                  <Button
                    variant="outlined"
                    size="small"
                    startIcon={<Settings />}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleEditModule(module);
                    }}
                    sx={{ fontWeight: 600 }}
                  >
                    Configure
                  </Button>
                </CardActions>
              </Card>
            </Grid>
          ))}
        </Grid>
      </Box>

      {/* Optional Modules Section */}
      <Box sx={{ mb: 6 }}>
        <Box sx={{ 
          display: 'flex', 
          alignItems: 'center', 
          mb: 3,
          p: 2,
          bgcolor: 'grey.100',
          borderRadius: 2,
          border: '1px solid',
          borderColor: 'grey.300'
        }}>
          <Tune sx={{ mr: 2, fontSize: 28, color: 'grey.700' }} />
          <Typography variant="h5" sx={{ fontWeight: 600, color: 'grey.700' }}>
            Optional / Action Modules
          </Typography>
          <Chip 
            label="Configurable" 
            sx={{ 
              ml: 2, 
              bgcolor: 'grey.300', 
              color: 'grey.700',
              fontWeight: 600
            }} 
          />
        </Box>
        
        <Grid container spacing={3}>
          {getCategoryModules('optional').map((module) => (
            <Grid item xs={12} sm={6} md={4} key={module.id}>
              <Card
                sx={{
                  height: '100%',
                  cursor: 'pointer',
                  transition: 'all 0.3s ease-in-out',
                  border: '1px solid',
                  borderColor: 'grey.300',
                  bgcolor: 'white',
                  '&:hover': {
                    transform: 'translateY(-4px)',
                    boxShadow: 4,
                    borderColor: 'primary.main',
                  },
                }}
                onClick={() => handleModuleClick(module)}
              >
                <CardContent sx={{ p: 3, height: '100%', display: 'flex', flexDirection: 'column' }}>
                  <Box display="flex" justifyContent="space-between" alignItems="flex-start" mb={3}>
                    <Avatar
                      sx={{
                        width: 50,
                        height: 50,
                        bgcolor: 'grey.200',
                        color: 'grey.700',
                        fontSize: 20,
                        fontWeight: 600
                      }}
                    >
                      {getModuleIcon(module)}
                    </Avatar>
                    <Stack direction="row" spacing={1}>
                      <Chip
                        label={module.priority || 'medium'}
                        color={getPriorityColor(module.priority || 'medium')}
                        size="small"
                        sx={{ fontWeight: 600 }}
                      />
                    </Stack>
                  </Box>

                  <Typography variant="h6" component="h2" gutterBottom sx={{ fontWeight: 600, color: 'text.primary' }}>
                    {module.name}
                  </Typography>

                  <Typography variant="body2" color="text.secondary" sx={{ flexGrow: 1, mb: 3, lineHeight: 1.6 }}>
                    {module.description}
                  </Typography>

                  <Box display="flex" gap={1} mb={2} flexWrap="wrap">
                    <Chip 
                      label="Optional" 
                      color="default" 
                      size="small" 
                      variant="outlined"
                      sx={{ fontWeight: 600 }}
                    />
                    {module.aiRecommendsByDefault && (
                      <Chip 
                        label="AI Powered" 
                        color="success" 
                        size="small"
                        sx={{ fontWeight: 600 }}
                      />
                    )}
                  </Box>

                  <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 500 }}>
                    v{module.version} • {module.targetRoles.length} target roles
                  </Typography>
                </CardContent>

                <CardActions sx={{ p: 3, pt: 0 }}>
                  <Button
                    variant="outlined"
                    size="small"
                    startIcon={<Settings />}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleEditModule(module);
                    }}
                    sx={{ fontWeight: 600 }}
                  >
                    Configure
                  </Button>
                </CardActions>
              </Card>
            </Grid>
          ))}
        </Grid>
      </Box>

      {/* Edit Module Dialog */}
      <Dialog
        open={editDialogOpen}
        onClose={() => setEditDialogOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>{editingModule?.id ? 'Edit Module' : 'Add New Module'}</DialogTitle>
        <DialogContent>
          {editingModule && (
            <Box sx={{ pt: 2 }}>
              <Grid container spacing={3}>
                <Grid item xs={12} sm={6}>
                  <LoggableTextField
                    fieldPath={`modules:${editingModule.id}.name`}
                    trigger="update"
                    destinationModules={['ContextEngine']}
                    value={editingModule.name}
                    onChange={(value: string) => setEditingModule({ ...editingModule, name: value })}
                    label="Module Name"
                    contextType="modules"
                    urgencyScore={6}
                    description="Module name setting"
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <LoggableTextField
                    fieldPath={`modules:${editingModule.id}.icon`}
                    trigger="update"
                    destinationModules={['ContextEngine']}
                    value={editingModule.icon || ''}
                    onChange={(value: string) => setEditingModule({ ...editingModule, icon: value })}
                    label="Icon (emoji)"
                    placeholder="📊"
                    contextType="modules"
                    urgencyScore={2}
                    description="Module icon setting"
                  />
                </Grid>
                <Grid item xs={12}>
                  <LoggableTextField
                    fieldPath={`modules:${editingModule.id}.description`}
                    trigger="update"
                    destinationModules={['ContextEngine']}
                    value={editingModule.description}
                    onChange={(value: string) =>
                      setEditingModule({ ...editingModule, description: value })
                    }
                    label="Description"
                    multiline
                    rows={3}
                    contextType="modules"
                    urgencyScore={4}
                    description="Module description setting"
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <FormControl fullWidth>
                    <InputLabel>Status</InputLabel>
                    <Select
                      value={editingModule.status}
                      onChange={(e) =>
                        setEditingModule({ ...editingModule, status: e.target.value as any })
                      }
                    >
                      <MenuItem value="active">Active</MenuItem>
                      <MenuItem value="beta">Beta</MenuItem>
                      <MenuItem value="coming-soon">Coming Soon</MenuItem>
                      <MenuItem value="inactive">Inactive</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <FormControl fullWidth>
                    <InputLabel>Category</InputLabel>
                    <Select
                      value={editingModule.category}
                      onChange={(e) =>
                        setEditingModule({ ...editingModule, category: e.target.value as any })
                      }
                    >
                      <MenuItem value="core">Core</MenuItem>
                      <MenuItem value="optional">Optional</MenuItem>
                      <MenuItem value="insights">Insights</MenuItem>
                      <MenuItem value="productivity">Productivity</MenuItem>
                      <MenuItem value="wellness">Wellness</MenuItem>
                      <MenuItem value="communication">Communication</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12}>
                  <Divider sx={{ my: 2 }} />
                  <Typography variant="h6" gutterBottom>
                    Module Settings
                  </Typography>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <LoggableSwitch
                    fieldPath={`modules:${editingModule.id}.isEnabled`}
                    trigger="update"
                    destinationModules={['ContextEngine']}
                    value={editingModule.isEnabled}
                    onChange={(value: boolean) =>
                      setEditingModule({ ...editingModule, isEnabled: value })
                    }
                    label="Module Enabled"
                    contextType="modules"
                    urgencyScore={7}
                    description="Module enabled setting"
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <LoggableSwitch
                    fieldPath={`modules:${editingModule.id}.aiRecommendsByDefault`}
                    trigger="update"
                    destinationModules={['ContextEngine']}
                    value={editingModule.aiRecommendsByDefault}
                    onChange={(value: boolean) =>
                      setEditingModule({
                        ...editingModule,
                        aiRecommendsByDefault: value,
                      })
                    }
                    label="AI Recommends by Default"
                    contextType="modules"
                    urgencyScore={5}
                    description="Module AI recommendation setting"
                  />
                </Grid>
                <Grid item xs={12}>
                  <LoggableTextField
                    fieldPath={`modules:${editingModule.id}.version`}
                    trigger="update"
                    destinationModules={['ContextEngine']}
                    value={editingModule.version}
                    onChange={(value: string) =>
                      setEditingModule({ ...editingModule, version: value })
                    }
                    label="Version"
                    contextType="modules"
                    urgencyScore={3}
                    description="Module version setting"
                  />
                </Grid>
                <Grid item xs={12}>
                  <LoggableTextField
                    fieldPath={`modules:${editingModule.id}.adminNotes`}
                    trigger="update"
                    destinationModules={['ContextEngine']}
                    value={editingModule.adminNotes || ''}
                    onChange={(value: string) =>
                      setEditingModule({ ...editingModule, adminNotes: value })
                    }
                    label="Admin Notes"
                    multiline
                    rows={2}
                    contextType="modules"
                    urgencyScore={2}
                    description="Module admin notes setting"
                  />
                </Grid>
              </Grid>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditDialogOpen(false)}>Cancel</Button>
          <Button
            onClick={handleSaveModule}
            variant="contained"
            disabled={saveLoading || !editingModule?.name}
          >
            {saveLoading ? <CircularProgress size={20} /> : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default ModulesDashboard;
