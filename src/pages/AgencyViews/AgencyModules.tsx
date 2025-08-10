import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
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
  Switch,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  TextField,
  CircularProgress,
  Alert,
} from '@mui/material';
import { Settings, CheckCircle, Warning, Info, VisibilityOff, Block } from '@mui/icons-material';
import { doc, getDoc, setDoc } from 'firebase/firestore';

import { useAuth } from '../../contexts/AuthContext';
import { db } from '../../firebase';

// Copy of defaultModules from ModulesDashboard.tsx
const defaultModules = [
  {
    id: 'job-satisfaction-insights',
    name: 'Job Satisfaction Insights',
    description:
      'AI-powered satisfaction scoring system that establishes baseline, tracks improvement, and identifies risk patterns over time',
    icon: '📊',
    status: 'beta',
    category: 'insights',
    globalSettings: {
      workEngagementWeight: 0.3,
      careerAlignmentWeight: 0.2,
      managerRelationshipWeight: 0.2,
      personalWellbeingWeight: 0.2,
      jobMobilityWeight: 0.1,
      baselineSurveyEnabled: true,
      baselineSurveyDays: 7,
      quarterlyCheckinsEnabled: true,
      ongoingLoggingEnabled: true,
      flaggedFollowupEnabled: true,
      lowScoreThreshold: 50,
      rapidDropThreshold: 20,
      rapidDropDays: 30,
      riskFlagThreshold: 30,
      personalWellbeingPrivate: true,
      anonymizeAggregates: false,
      enableExport: true,
      enablePredictiveAnalytics: true,
      enableRiskAlerts: true,
      enableBenchmarking: true,
      dataRetentionDays: 1095,
      defaultPromptFrequency: 'monthly',
      enableCustomPrompts: true,
      enableSmartTriggers: true,
    },
    version: '1.0.0',
    isEnabled: true,
    aiRecommendsByDefault: true,
    dependencies: [],
  },
  {
    id: 'daily-motivation',
    name: 'Daily Motivation',
    description:
      'AI-powered motivational messaging system that delivers personalized, job-appropriate positive messages to boost morale and engagement',
    icon: '💪',
    status: 'beta',
    category: 'wellness',
    globalSettings: {
      moduleEnabled: true,
      defaultDeliveryTime: '09:00',
      defaultFrequency: 'daily',
      optOutDefault: false,
      themeFocus: ['resilience', 'positivity', 'growth'],
      enableRoleBasedMessaging: true,
      enableTraitBasedMessaging: true,
      enableCustomMessages: true,
      enableAIComposition: true,
      messageLibrarySize: 500,
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
    },
    version: '1.0.0',
    isEnabled: true,
    aiRecommendsByDefault: true,
    dependencies: [],
  },
  {
    id: 'reset-mode',
    name: 'Reset Mode',
    description:
      'Mental/emotional break mechanism for workers feeling overwhelmed, discouraged, or burned out — without triggering formal escalation',
    icon: '🔄',
    status: 'beta',
    category: 'wellness',
    globalSettings: {
      moduleEnabled: true,
      defaultDuration: 2,
      mindfulnessEnabled: true,
      ambientFeaturesEnabled: true,
      enableManualTriggers: true,
      enableAIDetection: true,
      enableManagerSuggestions: true,
      aiConfidenceThreshold: 0.7,
      distressLevelThreshold: 0.6,
      enableEngagementTracking: true,
      lowEngagementThreshold: 0.3,
      burnoutRiskThreshold: 0.8,
      enableDailyCheckIns: true,
      checkInReminders: true,
      wellnessSuggestions: true,
      aggregateDataOnly: true,
      enableOptInSharing: false,
      dataRetentionDays: 365,
      enableToneAnalysis: true,
      enablePatternDetection: true,
      enableHRAlerts: true,
      coolDownThreshold: 3,
    },
    version: '1.0.0',
    isEnabled: true,
    aiRecommendsByDefault: true,
    dependencies: [],
  },
  {
    id: 'mini-learning-boosts',
    name: 'Mini-Learning Boosts',
    description:
      'Lightweight, AI-curated microlearning that aligns with individual goals, job function, and curiosity — boosting engagement without requiring time off-task',
    icon: '📚',
    status: 'beta',
    category: 'productivity',
    globalSettings: {
      moduleEnabled: true,
      defaultDeliveryTime: '09:00',
      defaultFrequency: 'weekly',
      contentDuration: 3,
      enableVideoContent: true,
      enablePodcastClips: true,
      enableInfographics: true,
      enableTips: true,
      enableArticles: true,
      enableRoleBasedContent: true,
      enableInterestMatching: true,
      enableGoalAlignment: true,
      enableSkillLevelMatching: true,
      enableScheduledDelivery: true,
      enableEventTriggered: true,
      enableLowMotivationTriggers: true,
      enableViewTracking: true,
      enableCompletionTracking: true,
      enableRatingCollection: true,
      enableSkipTracking: true,
      enableCustomContent: true,
      enableExternalLinks: true,
      contentApprovalRequired: true,
      maxContentDuration: 5,
      enableContentScoring: true,
      enableEngagementOptimization: true,
      enableLowEngagementAlerts: true,
    },
    version: '1.0.0',
    isEnabled: true,
    aiRecommendsByDefault: true,
    dependencies: ['professional-growth'],
  },
  {
    id: 'professional-growth',
    name: 'Professional Growth',
    description:
      'Help workers clarify, pursue, and progress toward their career goals — and give HR visibility into long-term growth and retention signals',
    icon: '🎯',
    status: 'beta',
    category: 'productivity',
    globalSettings: {
      moduleEnabled: true,
      enableGoalSetting: true,
      enableCareerJournaling: true,
      enableSkillsInventory: true,
      enableShortTermGoals: true,
      enableLongTermGoals: true,
      enableSuggestedGoals: true,
      goalTimelineOptions: ['30_day', '6_month', '1_year', 'long_term'],
      enableWeeklyPrompts: true,
      enableAchievementTracking: true,
      enableReflectionPrompts: true,
      enableAIActionSteps: true,
      enableSkillsAssessment: true,
      enableGapAnalysis: true,
      enableSkillRoadmaps: true,
      enableProgressTracking: true,
      enableRetentionSignals: true,
      enableGrowthAnalytics: true,
      enableOptInSharing: true,
      enableInternalMobility: false,
      enableGoalInsights: true,
      enableStagnationDetection: true,
      enableMotivationalNudges: true,
      enableSkillRecommendations: true,
    },
    version: '1.0.0',
    isEnabled: true,
    aiRecommendsByDefault: true,
    dependencies: [],
  },
  {
    id: 'work-life-balance',
    name: 'Work-Life Balance',
    description:
      'Monitor and support healthy integration of work and life through subtle check-ins, trend detection, and burnout prevention',
    icon: '⚖️',
    status: 'beta',
    category: 'wellness',
    globalSettings: {
      moduleEnabled: true,
      enableWeeklyCheckIns: true,
      enableWellbeingReflections: true,
      enableBurnoutRiskIndex: true,
      checkInFrequency: 'weekly',
      checkInTime: '09:00',
      enableBalanceScore: true,
      enableDetailedMetrics: true,
      enableSleepTracking: true,
      enableStressTracking: true,
      enableEnergyTracking: true,
      enableFamilyTimeTracking: true,
      enablePersonalTimeTracking: true,
      enableHealthTracking: true,
      enableCompositeScoring: true,
      enableChatToneAnalysis: true,
      enableJSIDropTracking: true,
      enableResetModeIntegration: true,
      enableBalanceAlerts: true,
      enableStressAlerts: true,
      enableBurnoutAlerts: true,
      enableSleepAlerts: true,
      enableFamilyTimeAlerts: true,
      enableAggregateData: true,
      enableIndividualInsights: true,
      dataRetentionDays: 730,
      enableTrendAnalysis: true,
      enablePatternDetection: true,
      enablePersonalizedSuggestions: true,
      enableWellnessCampaigns: true,
    },
    version: '1.0.0',
    isEnabled: true,
    aiRecommendsByDefault: true,
    dependencies: ['reset-mode'],
  },
];

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

const AgencyModules: React.FC = () => {
  const { tenantId, currentUser } = useAuth();
  const [modules, setModules] = useState(defaultModules);
  const [selectedModule, setSelectedModule] = useState<any>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  // Load agency module settings on component mount
  useEffect(() => {
    const fetchAgencyModules = async () => {
      if (!tenantId) return;
      
      setLoading(true);
      try {
        const modulesRef = doc(db, 'tenants', tenantId, 'aiSettings', 'modules');
        const modulesSnap = await getDoc(modulesRef);
        
        if (modulesSnap.exists()) {
          const savedModules = modulesSnap.data().modules || [];
          // Merge saved settings with default modules
          const mergedModules = defaultModules.map(defaultMod => {
            const savedMod = savedModules.find((m: any) => m.id === defaultMod.id);
            return savedMod ? { ...defaultMod, ...savedMod } : defaultMod;
          });
          setModules(mergedModules);
        } else {
          setModules(defaultModules);
        }
      } catch (err) {
        console.error('Error fetching agency modules:', err);
        setError('Failed to load module settings');
        setModules(defaultModules);
      } finally {
        setLoading(false);
      }
    };

    fetchAgencyModules();
  }, [tenantId]);

  const handleOpenSettings = (module: any) => {
    setSelectedModule({ ...module });
    setSettingsOpen(true);
  };

  const handleCloseSettings = () => {
    setSettingsOpen(false);
    setSelectedModule(null);
  };

  const handleSettingChange = (key: string, value: any) => {
    setSelectedModule((prev: any) => {
      if (key === 'isEnabled') {
        return { ...prev, isEnabled: value };
      }
      return {
        ...prev,
        globalSettings: { ...prev.globalSettings, [key]: value },
      };
    });
    // TODO: Log this change for auditing
  };

  const handleToggleModule = async (id: string) => {
    const updatedModules = modules.map((m) => (m.id === id ? { ...m, isEnabled: !m.isEnabled } : m));
    setModules(updatedModules);
    
    // Save the change to Firestore
    try {
      const modulesRef = doc(db, 'tenants', tenantId, 'aiSettings', 'modules');
      await setDoc(modulesRef, { modules: updatedModules }, { merge: true });
      
      // Log the change
      await setDoc(doc(db, 'ai_logs', `${tenantId}_ModuleToggle_${Date.now()}`), {
        tenantId: tenantId,
        section: 'AgencyModules',
        changed: 'module_toggle',
        moduleId: id,
        newEnabled: !modules.find(m => m.id === id)?.isEnabled,
        timestamp: new Date().toISOString(),
        eventType: 'module_toggle',
        userId: currentUser?.uid || null,
        sourceModule: 'AgencyModules',
      });
    } catch (err) {
      console.error('Error saving module toggle:', err);
      setError('Failed to save module status');
    }
  };

  const handleSaveSettings = async () => {
    if (!selectedModule || !tenantId) return;
    
    setSaving(true);
    setError('');
    setSuccess(false);
    
    try {
      // Update the module in the local state
      const updatedModules = modules.map((m) => 
        m.id === selectedModule.id ? selectedModule : m
      );
      setModules(updatedModules);
      
      // Save to Firestore
      const modulesRef = doc(db, 'tenants', tenantId, 'aiSettings', 'modules');
      await setDoc(modulesRef, { modules: updatedModules }, { merge: true });
      
      // Log the change
      await setDoc(doc(db, 'ai_logs', `${tenantId}_ModuleSettings_${Date.now()}`), {
        tenantId: tenantId,
        section: 'AgencyModules',
        changed: 'module_settings',
        moduleId: selectedModule.id,
        oldValue: modules.find(m => m.id === selectedModule.id),
        newValue: selectedModule,
        timestamp: new Date().toISOString(),
        eventType: 'module_settings_update',
        userId: currentUser?.uid || null,
        sourceModule: 'AgencyModules',
      });
      
      setSuccess(true);
      setSettingsOpen(false);
      setSelectedModule(null);
    } catch (err) {
      console.error('Error saving module settings:', err);
      setError('Failed to save module settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Box sx={{ p: 0, width: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '200px' }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ p: 0, width: '100%' }}>
      <Box display="flex" alignItems="center" justifyContent="space-between" mb={3} mt={0}>
        <Typography variant="h4" component="h1">
          Modules
        </Typography>
      </Box>
      
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      
      {success && (
        <Alert severity="success" sx={{ mb: 2 }}>
          Module settings saved successfully!
        </Alert>
      )}
      <Grid container spacing={3}>
        {modules.map((mod) => (
          <Grid item xs={12} sm={6} md={4} lg={3} key={mod.id}>
            <Card
              sx={{
                height: '100%',
                cursor: 'pointer',
                transition: 'all 0.2s ease-in-out',
                opacity: mod.isEnabled ? 1 : 0.6,
                filter: mod.isEnabled ? 'none' : 'grayscale(0.5)',
                position: 'relative',
                '&:hover': {
                  transform: mod.isEnabled ? 'translateY(-4px)' : 'none',
                  boxShadow: mod.isEnabled ? 4 : 1,
                },
              }}
              onClick={() => handleOpenSettings(mod)}
            >
              {/* Status Icon Overlay */}
              <Box sx={{ position: 'absolute', top: 12, right: 12, zIndex: 2 }}>
                {mod.isEnabled ? (
                  <CheckCircle sx={{ color: 'success.main', fontSize: 32, bgcolor: 'background.paper', borderRadius: '50%' }} />
                ) : (
                  <Block sx={{ color: 'error.main', fontSize: 32, bgcolor: 'background.paper', borderRadius: '50%' }} />
                )}
              </Box>
              <CardContent sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                <Box display="flex" justifyContent="space-between" alignItems="flex-start" mb={2}>
                  <Typography variant="h3" component="div">
                    {mod.icon || '📦'}
                  </Typography>
                  <Chip
                    label={mod.status}
                    color={getStatusColor(mod.status)}
                    size="small"
                    icon={getStatusIcon(mod.status)}
                  />
                </Box>
                <Typography variant="h6" component="h2" gutterBottom>
                  {mod.name}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ flexGrow: 1, mb: 2 }}>
                  {mod.description}
                </Typography>
                {!mod.isEnabled && (
                  <Chip 
                    label="Disabled" 
                    color="error" 
                    size="small" 
                    sx={{ mb: 1 }}
                  />
                )}
                <Box display="flex" gap={1} mb={2} flexWrap="wrap">
                  <Chip label={mod.category} size="small" variant="outlined" />
                  {mod.aiRecommendsByDefault && (
                    <Chip label="AI Recommended" color="success" size="small" />
                  )}
                </Box>
                <Typography variant="caption" color="text.secondary">
                  v{mod.version}
                </Typography>
              </CardContent>
              <CardActions sx={{ p: 2, pt: 0 }}>
                <Switch
                  checked={!!mod.isEnabled}
                  onChange={(e) => {
                    e.stopPropagation();
                    handleToggleModule(mod.id);
                  }}
                  color="primary"
                  inputProps={{ 'aria-label': `toggle ${mod.name}` }}
                />
                <Button
                  size="small"
                  startIcon={<Settings />}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleOpenSettings(mod);
                  }}
                >
                  Settings
                </Button>
              </CardActions>
            </Card>
          </Grid>
        ))}
      </Grid>
      <Dialog open={settingsOpen} onClose={handleCloseSettings} maxWidth="md" fullWidth>
        <DialogTitle>{selectedModule?.name} Settings</DialogTitle>
        <DialogContent>
          {selectedModule && (
            <Box sx={{ pt: 2 }}>
              {/* Module Enabled Toggle */}
              <Box display="flex" alignItems="center" mb={3}>
                <Switch
                  checked={!!selectedModule.isEnabled}
                  onChange={e => handleSettingChange('isEnabled', e.target.checked)}
                  color="primary"
                  inputProps={{ 'aria-label': 'Enable module' }}
                />
                <Typography variant="subtitle1" sx={{ ml: 1 }}>
                  Module Enabled
                </Typography>
              </Box>
              <Grid container spacing={3}>
                {Object.entries(selectedModule.globalSettings).map(([key, value]) => (
                  <Grid item xs={12} sm={6} key={key}>
                    {typeof value === 'boolean' ? (
                      <FormControl fullWidth>
                        <InputLabel>{key}</InputLabel>
                        <Select
                          value={value ? 'true' : 'false'}
                          label={key}
                          onChange={(e) =>
                            handleSettingChange(key, e.target.value === 'true')
                          }
                        >
                          <MenuItem value="true">Enabled</MenuItem>
                          <MenuItem value="false">Disabled</MenuItem>
                        </Select>
                      </FormControl>
                    ) : typeof value === 'string' ? (
                      <TextField
                        label={key}
                        value={value}
                        onChange={(e) => handleSettingChange(key, e.target.value)}
                        fullWidth
                      />
                    ) : typeof value === 'number' ? (
                      <TextField
                        label={key}
                        type="number"
                        value={value}
                        onChange={(e) => handleSettingChange(key, Number(e.target.value))}
                        fullWidth
                      />
                    ) : Array.isArray(value) ? (
                      <TextField
                        label={key}
                        value={value.join(', ')}
                        onChange={(e) => handleSettingChange(key, e.target.value.split(',').map((v) => v.trim()))}
                        fullWidth
                      />
                    ) : null}
                  </Grid>
                ))}
              </Grid>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseSettings}>Cancel</Button>
          <Button onClick={handleSaveSettings} variant="contained" disabled={saving}>
            {saving ? <CircularProgress size={20} /> : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default AgencyModules; 