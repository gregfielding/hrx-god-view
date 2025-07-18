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
  Tabs,
  Tab,
  Paper,
  TableContainer,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  Avatar,
} from '@mui/material';
import { 
  Settings, 
  Business,
  Psychology,
  Analytics,
  Notifications,
  Campaign,
  TrendingUp,
  Assignment,
  People,
  Assessment,
  Work,
  School,
  Visibility,
} from '@mui/icons-material';
import { useAuth } from '../../contexts/AuthContext';
import { doc, getDoc, setDoc, collection, getDocs, updateDoc, addDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import ModuleDetailsView from './ModuleDetailsView';

// Simplified module definitions - only what's actually functional
const coreModules = [
  {
    id: 'hrx-companion',
    name: 'HRX Companion',
    description: 'AI companion for personalized support and guidance',
    icon: <Business />,
    isEnabled: true,
    isCore: true,
    settings: {
      enablePersonalization: true,
      enableAnalytics: true,
      dataRetentionDays: 1095,
    }
  },
  {
    id: 'hrx-intelligence',
    name: 'HRX Intelligence',
    description: 'Risk scoring and predictive insights',
    icon: <Psychology />,
    isEnabled: true,
    isCore: true,
    settings: {
      enableRiskScoring: true,
      enablePredictiveAnalytics: true,
      dataRetentionDays: 1825,
    }
  },
  {
    id: 'hrx-traits-engine',
    name: 'HRX Traits Engine',
    description: 'Behavioral analysis and trait tracking',
    icon: <Analytics />,
    isEnabled: true,
    isCore: true,
    settings: {
      enableTraitObservation: true,
      enableBehavioralPatterns: true,
      dataRetentionDays: 1095,
    }
  },
];

const optionalModules = [
  {
    id: 'hrx-moments-engine',
    name: 'HRX Moments Engine',
    description: 'Intelligent interventions and nudges',
    icon: <Notifications />,
    isEnabled: false,
    isCore: false,
    settings: {
      enableNudges: true,
      enableOneOnOneCadence: true,
      dataRetentionDays: 730,
    }
  },
  {
    id: 'hrx-campaigns',
    name: 'HRX Campaign Engine',
    description: 'Strategic campaign management',
    icon: <Campaign />,
    isEnabled: false,
    isCore: false,
    settings: {
      enableCampaignTriggers: true,
      enableEngagementTracking: true,
      dataRetentionDays: 1095,
    }
  },
  {
    id: 'hrx-broadcasts',
    name: 'HRX Broadcast Engine',
    description: 'Communication and surveys',
    icon: <TrendingUp />,
    isEnabled: false,
    isCore: false,
    settings: {
      enableOneTimeBroadcasts: true,
      enableSurveys: true,
      dataRetentionDays: 730,
    }
  },
  {
    id: 'hrx-flex',
    name: 'HRX Flex Engine',
    description: 'Flexible workforce management system',
    icon: <Assignment />,
    isEnabled: false,
    isCore: false,
    settings: {
      enableJobOrders: true,
      enableVisibilityRules: true,
      enableTimesheets: false,
      enableJobsBoard: false,
      dataRetentionDays: 1095,
    }
  },
  {
    id: 'hrx-recruiter',
    name: 'HRX Recruiting Engine',
    description: 'Intelligent recruitment system',
    icon: <People />,
    isEnabled: false,
    isCore: false,
    settings: {
      enableApplicationSettings: true,
      enableAIScoring: true,
      dataRetentionDays: 1825,
    }
  },
  {
    id: 'hrx-insight-reports',
    name: 'HRX Reports Engine',
    description: 'Comprehensive reporting system',
    icon: <Assessment />,
    isEnabled: false,
    isCore: false,
    settings: {
      enableToggleReports: true,
      enableFavorites: true,
      dataRetentionDays: 1825,
    }
  },
  {
    id: 'hrx-crm',
    name: 'HRX CRM Engine',
    description: 'Customer relationship management system',
    icon: <Business />,
    isEnabled: false,
    isCore: false,
    settings: {
      enableContactManagement: true,
      enablePipelineTracking: true,
      dataRetentionDays: 1825,
    }
  },
  {
    id: 'hrx-staffing',
    name: 'HRX Staffing Engine',
    description: 'Comprehensive staffing and workforce management',
    icon: <People />,
    isEnabled: false,
    isCore: false,
    settings: {
      enableWorkforcePlanning: true,
      enableTalentManagement: true,
      dataRetentionDays: 1825,
    }
  },
  {
    id: 'hrx-jobs-board',
    name: 'HRX Jobs Board',
    description: 'Public job posting and application management system',
    icon: <Work />,
    isEnabled: false,
    isCore: false,
    settings: {
      enablePublicPostings: true,
      enableApplicationTracking: true,
      enableAutoMatching: false,
      dataRetentionDays: 1095,
    }
  },
  {
    id: 'hrx-customers',
    name: 'HRX Customers',
    description: 'Customer relationship and account management system',
    icon: <Business />,
    isEnabled: false,
    isCore: false,
    settings: {
      enableCustomerProfiles: true,
      enableContractManagement: true,
      enableBillingIntegration: false,
      dataRetentionDays: 1825,
    }
  },
];

const wellnessModules = [
  {
    id: 'job-satisfaction-insights',
    name: 'Job Satisfaction Insights',
    description: 'AI-powered satisfaction scoring',
    icon: <Assessment />,
    isEnabled: false,
    isCore: false,
    settings: {
      baselineSurveyEnabled: true,
      enableRiskAlerts: true,
      dataRetentionDays: 1095,
    }
  },
  {
    id: 'work-life-balance',
    name: 'Work-Life Balance',
    description: 'Wellbeing monitoring and support',
    icon: <Work />,
    isEnabled: false,
    isCore: false,
    settings: {
      enableWeeklyCheckIns: true,
      enableBurnoutRiskIndex: true,
      dataRetentionDays: 730,
    }
  },
  {
    id: 'daily-motivation',
    name: 'Daily Motivation',
    description: 'AI-powered motivational messaging',
    icon: <School />,
    isEnabled: false,
    isCore: false,
    settings: {
      defaultDeliveryTime: '09:00',
      defaultFrequency: 'daily',
      dataRetentionDays: 730,
    }
  },
  {
    id: 'reset-mode',
    name: 'Reset Mode',
    description: 'Mental/emotional break mechanism',
    icon: <Work />,
    isEnabled: false,
    isCore: false,
    settings: {
      defaultDuration: 2,
      mindfulnessEnabled: true,
      dataRetentionDays: 365,
    }
  },
  {
    id: 'mini-learning-boosts',
    name: 'Mini-Learning Boosts',
    description: 'AI-curated microlearning content',
    icon: <School />,
    isEnabled: false,
    isCore: false,
    settings: {
      defaultDeliveryTime: '09:00',
      defaultFrequency: 'weekly',
      dataRetentionDays: 730,
    }
  },
  {
    id: 'professional-growth',
    name: 'Professional Growth',
    description: 'Career goal tracking and development',
    icon: <Work />,
    isEnabled: false,
    isCore: false,
    settings: {
      enableGoalSetting: true,
      enableCareerJournaling: true,
      dataRetentionDays: 1095,
    }
  },
];

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
      id={`modules-tabpanel-${index}`}
      aria-labelledby={`modules-tab-${index}`}
      {...other}
    >
      {value === index && <Box sx={{ pt: 3 }}>{children}</Box>}
    </div>
  );
}

const TenantModules: React.FC = () => {
  const { tenantId, currentUser } = useAuth();
  const [tabValue, setTabValue] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedModule, setSelectedModule] = useState<any>(null);
  const [selectedModuleDetails, setSelectedModuleDetails] = useState<any>(null);
  const [showModuleDetails, setShowModuleDetails] = useState(false);

  // State for actual functional modules
  const [coreModulesState, setCoreModulesState] = useState(coreModules);
  const [optionalModulesState, setOptionalModulesState] = useState(optionalModules);
  const [wellnessModulesState, setWellnessModulesState] = useState(wellnessModules);

  useEffect(() => {
    const fetchTenantModules = async () => {
      if (!tenantId) return;
      
      setLoading(true);
      try {
        // Fetch modules from the subcollection
        const modulesRef = collection(db, 'tenants', tenantId, 'modules');
        const modulesSnap = await getDocs(modulesRef);
        
        // Create a map of saved module settings
        const savedModulesMap: { [key: string]: any } = {};
        modulesSnap.docs.forEach(doc => {
          savedModulesMap[doc.id] = { id: doc.id, ...doc.data() };
        });
        
        // Merge saved settings with defaults for each module type
        const mergedCoreModules = coreModules.map(coreMod => {
          const savedMod = savedModulesMap[coreMod.id];
          if (savedMod) {
            return {
              ...coreMod,
              isEnabled: savedMod.isEnabled !== undefined ? savedMod.isEnabled : coreMod.isEnabled,
              settings: { ...coreMod.settings, ...savedMod.settings },
              customSettings: savedMod.customSettings || {},
            };
          }
          return coreMod;
        });
        setCoreModulesState(mergedCoreModules);
        
        const mergedOptionalModules = optionalModules.map(optionalMod => {
          const savedMod = savedModulesMap[optionalMod.id];
          if (savedMod) {
            return {
              ...optionalMod,
              isEnabled: savedMod.isEnabled !== undefined ? savedMod.isEnabled : optionalMod.isEnabled,
              settings: { ...optionalMod.settings, ...savedMod.settings },
              customSettings: savedMod.customSettings || {},
            };
          }
          return optionalMod;
        });
        setOptionalModulesState(mergedOptionalModules);
        
        const mergedWellnessModules = wellnessModules.map(wellnessMod => {
          const savedMod = savedModulesMap[wellnessMod.id];
          if (savedMod) {
            return {
              ...wellnessMod,
              isEnabled: savedMod.isEnabled !== undefined ? savedMod.isEnabled : wellnessMod.isEnabled,
              settings: { ...wellnessMod.settings, ...savedMod.settings },
              customSettings: savedMod.customSettings || {},
            };
          }
          return wellnessMod;
        });
        setWellnessModulesState(mergedWellnessModules);
      } catch (err) {
        console.error('Error fetching tenant modules:', err);
        setError('Failed to load module settings');
      } finally {
        setLoading(false);
      }
    };

    fetchTenantModules();
  }, [tenantId]);

  const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
  };

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
        settings: { ...prev.settings, [key]: value },
      };
    });
  };

  const handleToggleModule = async (id: string, isCore = false, category = 'optional') => {
    if (isCore) return; // Core modules cannot be disabled
    
    let updatedModules;
    let moduleToToggle;
    
    if (category === 'optional') {
      updatedModules = optionalModulesState.map((m) => 
        m.id === id ? { ...m, isEnabled: !m.isEnabled } : m
      );
      setOptionalModulesState(updatedModules);
      moduleToToggle = updatedModules.find(m => m.id === id);
    } else if (category === 'wellness') {
      updatedModules = wellnessModulesState.map((m) => 
        m.id === id ? { ...m, isEnabled: !m.isEnabled } : m
      );
      setWellnessModulesState(updatedModules);
      moduleToToggle = updatedModules.find(m => m.id === id);
    }
    
    if (!moduleToToggle) return;
    
    // Save to Firestore subcollection
    try {
      const moduleRef = doc(db, 'tenants', tenantId, 'modules', id);
      await setDoc(moduleRef, {
        isEnabled: moduleToToggle.isEnabled,
        settings: moduleToToggle.settings,
        customSettings: moduleToToggle.customSettings || {},
        lastUpdated: new Date().toISOString(),
      }, { merge: true });
      
      // Log the change
      await setDoc(doc(db, 'ai_logs', `${tenantId}_ModuleToggle_${Date.now()}`), {
        tenantId: tenantId,
        section: 'TenantModules',
        changed: 'module_toggle',
        moduleId: id,
        newEnabled: moduleToToggle.isEnabled,
        timestamp: new Date().toISOString(),
        eventType: 'module_toggle',
        userId: currentUser?.uid || null,
        sourceModule: 'TenantModules',
      });
    } catch (err) {
      console.error('Error saving module toggle:', err);
      setError('Failed to save module status');
    }
  };

  const handleViewModule = (module: any) => {
    setSelectedModuleDetails(module);
    setShowModuleDetails(true);
  };

  const handleBackToModules = () => {
    setShowModuleDetails(false);
    setSelectedModuleDetails(null);
  };

  const handleModuleUpdate = (updatedModule: any) => {
    // Update the module in the appropriate state
    if (updatedModule.isCore) {
      const updatedCoreModules = coreModulesState.map((m) => 
        m.id === updatedModule.id ? updatedModule : m
      );
      setCoreModulesState(updatedCoreModules);
    } else if (updatedModule.category === 'wellness') {
      const updatedWellnessModules = wellnessModulesState.map((m) => 
        m.id === updatedModule.id ? updatedModule : m
      );
      setWellnessModulesState(updatedWellnessModules);
    } else {
      const updatedOptionalModules = optionalModulesState.map((m) => 
        m.id === updatedModule.id ? updatedModule : m
      );
      setOptionalModulesState(updatedOptionalModules);
    }
  };

  const getModuleIcon = (moduleId: string) => {
    const iconMap: { [key: string]: any } = {
      'hrx-companion': <Business />,
      'hrx-intelligence': <Psychology />,
      'hrx-traits-engine': <Analytics />,
      'hrx-moments-engine': <Notifications />,
      'hrx-campaigns': <Campaign />,
      'hrx-broadcasts': <TrendingUp />,
      'hrx-flex': <Assignment />,
      'hrx-recruiter': <People />,
      'hrx-insight-reports': <Assessment />,
      'hrx-crm': <Business />,
      'hrx-staffing': <People />,
      'hrx-jobs-board': <Work />,
      'hrx-customers': <Business />,
      'job-satisfaction-insights': <Assessment />,
      'work-life-balance': <Work />,
      'daily-motivation': <School />,
      'reset-mode': <Work />,
      'mini-learning-boosts': <School />,
      'professional-growth': <Work />,
    };
    return iconMap[moduleId] || <Settings />;
  };

  const handleSaveSettings = async () => {
    if (!selectedModule || !tenantId) return;
    
    setSaving(true);
    setError('');
    setSuccess(false);
    
    try {
      // Update the module in the appropriate state
      if (selectedModule.isCore) {
        const updatedCoreModules = coreModulesState.map((m) => 
          m.id === selectedModule.id ? selectedModule : m
        );
        setCoreModulesState(updatedCoreModules);
      } else if (selectedModule.category === 'wellness') {
        const updatedWellnessModules = wellnessModulesState.map((m) => 
          m.id === selectedModule.id ? selectedModule : m
        );
        setWellnessModulesState(updatedWellnessModules);
      } else {
        const updatedOptionalModules = optionalModulesState.map((m) => 
          m.id === selectedModule.id ? selectedModule : m
        );
        setOptionalModulesState(updatedOptionalModules);
      }
      
      // Save to Firestore subcollection
      const moduleRef = doc(db, 'tenants', tenantId, 'modules', selectedModule.id);
      await setDoc(moduleRef, {
        isEnabled: selectedModule.isEnabled,
        settings: selectedModule.settings,
        customSettings: selectedModule.customSettings || {},
        lastUpdated: new Date().toISOString(),
      }, { merge: true });
      
      // Log the change
      await setDoc(doc(db, 'ai_logs', `${tenantId}_ModuleSettings_${Date.now()}`), {
        tenantId: tenantId,
        section: 'TenantModules',
        changed: 'module_settings',
        moduleId: selectedModule.id,
        oldValue: selectedModule.isCore 
          ? coreModulesState.find(m => m.id === selectedModule.id)
          : selectedModule.category === 'wellness'
          ? wellnessModulesState.find(m => m.id === selectedModule.id)
          : optionalModulesState.find(m => m.id === selectedModule.id),
        newValue: selectedModule,
        timestamp: new Date().toISOString(),
        eventType: 'module_settings_update',
        userId: currentUser?.uid || null,
        sourceModule: 'TenantModules',
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

  const renderModuleCard = (mod: any, isCore = false, category = 'optional') => (
    <Grid item xs={12} sm={6} md={4} key={mod.id}>
              <Card
          sx={{
            height: '100%',
            cursor: 'pointer',
            transition: 'all 0.3s ease-in-out',
            border: isCore ? '2px solid' : '1px solid',
            borderColor: isCore ? 'primary.main' : 'grey.300',
            bgcolor: 'white',
            opacity: mod.isEnabled ? 1 : 0.6,
            '&:hover': {
              transform: isCore ? 'translateY(-8px)' : 'translateY(-4px)',
              boxShadow: isCore ? 8 : 4,
              borderColor: 'primary.main',
            },
          }}
          onClick={() => handleOpenSettings(mod)}
        >
        <CardContent sx={{ p: 3, height: '100%', display: 'flex', flexDirection: 'column' }}>
          <Box display="flex" justifyContent="space-between" alignItems="flex-start" mb={3}>
            <Box
              sx={{
                width: isCore ? 60 : 50,
                height: isCore ? 60 : 50,
                bgcolor: isCore ? 'primary.main' : 'grey.200',
                color: isCore ? 'white' : 'grey.700',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: isCore ? 24 : 20,
                fontWeight: 600
              }}
            >
              {mod.icon}
            </Box>
            <Chip
              label={isCore ? "Core" : "Optional"}
              color={isCore ? "primary" : "default"}
              size="small"
              variant="outlined"
              sx={{ fontWeight: 600 }}
            />
          </Box>

          <Typography variant="h6" component="h2" gutterBottom sx={{ fontWeight: 600, color: 'text.primary' }}>
            {mod.name}
          </Typography>

          <Typography variant="body2" color="text.secondary" sx={{ flexGrow: 1, mb: 3, lineHeight: 1.6 }}>
            {mod.description}
          </Typography>

          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 500 }}>
            {Object.keys(mod.settings).length} settings
          </Typography>
        </CardContent>

        <CardActions sx={{ p: 3, pt: 0 }}>
          {!isCore && (
            <Switch
              checked={!!mod.isEnabled}
              onChange={(e) => {
                e.stopPropagation();
                handleToggleModule(mod.id, isCore, category);
              }}
              color="primary"
              inputProps={{ 'aria-label': `toggle ${mod.name}` }}
            />
          )}
          <Button
            variant="outlined"
            size="small"
            startIcon={<Settings />}
            onClick={(e) => {
              e.stopPropagation();
              handleOpenSettings(mod);
            }}
            sx={{ fontWeight: 600 }}
          >
            Settings
          </Button>
        </CardActions>
      </Card>
    </Grid>
  );

  // Module Details View
  if (showModuleDetails && selectedModuleDetails) {
    return (
      <ModuleDetailsView 
        module={selectedModuleDetails}
        tenantId={tenantId}
        onBack={handleBackToModules}
        onModuleUpdate={handleModuleUpdate}
      />
    );
  }

  if (loading) {
    return (
      <Box sx={{ p: 0, width: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '200px' }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ p: 0, width: '100%', pb: 9 }}>
      <Box display="flex" alignItems="center" justifyContent="space-between" mb={2} mt={0}>
        <Typography variant="h3" component="h3">
          Modules & Features
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

      <Paper elevation={1} sx={{ mb: 0, borderRadius: 0 }}>
        <Tabs
          value={tabValue}
          onChange={handleTabChange}
          indicatorColor="primary"
          textColor="primary"
          variant="scrollable"
          scrollButtons="auto"
          aria-label="modules tabs"
        >
          <Tab label="Core Modules" />
          <Tab label="Optional Modules" />
          <Tab label="Wellness Modules" />
        </Tabs>
      </Paper>

      <TabPanel value={tabValue} index={0}>
        <Box sx={{ mb: 2 }}>
          <Typography variant="h6" color="text.secondary" gutterBottom>
            🔒 Core Modules - Always On
          </Typography>
          <Typography variant="body2" color="text.secondary">
            These essential modules provide the foundation for HRX functionality and cannot be disabled.
          </Typography>
        </Box>
        <Grid container spacing={3}>
          {coreModulesState.map((mod) => renderModuleCard(mod, true, 'core'))}
        </Grid>
      </TabPanel>

      <TabPanel value={tabValue} index={1}>
        <Box sx={{ mb: 2 }}>
          <Typography variant="h6" color="text.secondary" gutterBottom>
            🌱 Optional Modules
          </Typography>
          <Typography variant="body2" color="text.secondary">
            These optional modules personalize the Companion experience and can be enabled or disabled based on your needs.
          </Typography>
        </Box>
        <TableContainer component={Paper}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell sx={{ height: 48, py: 0 }}>Module</TableCell>
                <TableCell sx={{ height: 48, py: 0 }}>Description</TableCell>
                <TableCell sx={{ height: 48, py: 0 }}>Status</TableCell>
                <TableCell sx={{ height: 48, py: 0 }}>Settings</TableCell>
                <TableCell sx={{ height: 48, py: 0 }}>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {optionalModulesState.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5}>No optional modules available.</TableCell>
                </TableRow>
              ) : (
                optionalModulesState.map((mod) => (
                  <TableRow key={mod.id}>
                    <TableCell>
                      <Box display="flex" alignItems="center" gap={2}>
                        <Avatar
                          sx={{
                            width: 40,
                            height: 40,
                            bgcolor: 'grey.200',
                            color: 'grey.700',
                          }}
                        >
                          {getModuleIcon(mod.id)}
                        </Avatar>
                        <Box>
                          <Typography variant="body1" sx={{ fontWeight: 'bold', color: '#333' }}>
                            {mod.name}
                          </Typography>
                          <Chip
                            label={mod.isEnabled ? "Active" : "Inactive"}
                            color={mod.isEnabled ? "success" : "default"}
                            size="small"
                            variant={mod.isEnabled ? "filled" : "outlined"}
                            sx={{ 
                              fontSize: '0.7rem', 
                              height: 20,
                              backgroundColor: mod.isEnabled ? '#4caf50' : 'transparent',
                              color: mod.isEnabled ? 'white' : '#9e9e9e',
                              borderColor: mod.isEnabled ? '#4caf50' : '#9e9e9e'
                            }}
                          />
                        </Box>
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary">
                        {mod.description}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={!!mod.isEnabled}
                        onChange={(e) => {
                          e.stopPropagation();
                          handleToggleModule(mod.id, false, 'optional');
                        }}
                        color="primary"
                        inputProps={{ 'aria-label': `toggle ${mod.name}` }}
                      />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary">
                        {Object.keys(mod.settings).length} settings
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={<Visibility />}
                        onClick={() => handleViewModule(mod)}
                        sx={{
                          py: 0.25,
                          px: 1,
                          fontSize: '0.7rem',
                          minWidth: 'auto',
                          height: 24,
                          textTransform: 'none',
                        }}
                      >
                        View
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </TabPanel>

      <TabPanel value={tabValue} index={2}>
        <Box sx={{ mb: 2 }}>
          <Typography variant="h6" color="text.secondary" gutterBottom>
            🌿 Wellness Modules
          </Typography>
          <Typography variant="body2" color="text.secondary">
            These wellness-focused modules support employee wellbeing, growth, and work-life balance.
          </Typography>
        </Box>
        <Grid container spacing={3}>
          {wellnessModulesState.map((mod) => renderModuleCard(mod, false, 'wellness'))}
        </Grid>
      </TabPanel>

      <Dialog open={settingsOpen} onClose={handleCloseSettings} maxWidth="md" fullWidth>
        <DialogTitle>
          {selectedModule?.name} Settings
          {selectedModule?.isCore && (
            <Chip 
              label="Core Module" 
              color="primary" 
              size="small" 
              sx={{ ml: 2 }}
            />
          )}
        </DialogTitle>
        <DialogContent>
          {selectedModule && (
            <Box sx={{ pt: 2 }}>
              {/* Module Enabled Toggle - Only for non-core modules */}
              {!selectedModule.isCore && (
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
              )}
              
              {/* Core module notice */}
              {selectedModule.isCore && (
                <Alert severity="info" sx={{ mb: 3 }}>
                  This is a core module that cannot be disabled. Core modules provide essential HRX functionality.
                </Alert>
              )}
              
              <Grid container spacing={3}>
                {Object.entries(selectedModule.settings).map(([key, value]) => (
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

export default TenantModules; 