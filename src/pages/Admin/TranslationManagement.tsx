import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Button,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Card,
  CardContent,
  Grid,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
  CircularProgress,
  Tabs,
  Tab,
  Switch,
  FormControlLabel,
  Divider,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  IconButton,
  Accordion,
  AccordionSummary,
  AccordionDetails
} from '@mui/material';
import {
  Translate as TranslateIcon,
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  ExpandMore as ExpandMoreIcon,
  Language as LanguageIcon,
  Settings as SettingsIcon
} from '@mui/icons-material';
import { getFunctions, httpsCallable } from 'firebase/functions';

interface TranslationSettings {
  enabled: boolean;
  defaultSourceLanguage: string;
  defaultTargetLanguage: string;
  autoTranslate: boolean;
  supportedLanguages: string[];
  translationProvider: 'openai' | 'google' | 'azure';
  apiKey?: string;
  qualityThreshold: number;
}

interface LanguagePreference {
  language: string;
  name: string;
  nativeName: string;
  enabled: boolean;
  autoTranslate: boolean;
}

interface TranslationTemplate {
  id: string;
  name: string;
  category: string;
  content: {
    en: string;
    es: string;
  };
  usage: number;
  lastUsed?: Date;
}

const TranslationManagement: React.FC = () => {
  const [activeTab, setActiveTab] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  
  // Translation settings state
  const [translationSettings, setTranslationSettings] = useState<TranslationSettings>({
    enabled: true,
    defaultSourceLanguage: 'en',
    defaultTargetLanguage: 'es',
    autoTranslate: true,
    supportedLanguages: ['en', 'es'],
    translationProvider: 'openai',
    qualityThreshold: 0.8
  });
  
  // Language preferences state
  const [languagePreferences, setLanguagePreferences] = useState<LanguagePreference[]>([
    { language: 'en', name: 'English', nativeName: 'English', enabled: true, autoTranslate: true },
    { language: 'es', name: 'Spanish', nativeName: 'Español', enabled: true, autoTranslate: true }
  ]);
  
  // Translation templates state
  const [translationTemplates, setTranslationTemplates] = useState<TranslationTemplate[]>([]);
  
  // Dialog states
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [testTranslationDialogOpen, setTestTranslationDialogOpen] = useState(false);
  
  // Form states
  const [newTemplate, setNewTemplate] = useState({
    name: '',
    category: 'general',
    contentEn: '',
    contentEs: ''
  });
  
  const [testTranslation, setTestTranslation] = useState({
    content: '',
    sourceLanguage: 'en',
    targetLanguage: 'es'
  });
  
  const functions = getFunctions();

  useEffect(() => {
    loadTranslationSettings();
    loadLanguagePreferences();
    loadTranslationTemplates();
  }, []);

  const loadTranslationSettings = async () => {
    setLoading(true);
    try {
      // This would be implemented in the backend
      // For now, we'll use mock data
      console.log('Loading translation settings...');
    } catch (error: any) {
      setError(`Error loading translation settings: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const loadLanguagePreferences = async () => {
    setLoading(true);
    try {
      // This would be implemented in the backend
      console.log('Loading language preferences...');
    } catch (error: any) {
      setError(`Error loading language preferences: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const loadTranslationTemplates = async () => {
    setLoading(true);
    try {
      // Mock data for now
      const mockTemplates: TranslationTemplate[] = [
        {
          id: '1',
          name: 'Welcome Message',
          category: 'greeting',
          content: {
            en: 'Welcome to our platform!',
            es: '¡Bienvenido a nuestra plataforma!'
          },
          usage: 45,
          lastUsed: new Date()
        },
        {
          id: '2',
          name: 'Schedule Update',
          category: 'notification',
          content: {
            en: 'Your schedule has been updated.',
            es: 'Tu horario ha sido actualizado.'
          },
          usage: 23,
          lastUsed: new Date()
        }
      ];
      setTranslationTemplates(mockTemplates);
    } catch (error: any) {
      setError(`Error loading translation templates: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveSettings = async () => {
    setLoading(true);
    try {
      // This would save to the backend
      setSuccess('Translation settings saved successfully!');
      setSettingsDialogOpen(false);
    } catch (error: any) {
      setError(`Error saving translation settings: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveLanguagePreferences = async () => {
    setLoading(true);
    try {
      // This would save to the backend
      setSuccess('Language preferences saved successfully!');
    } catch (error: any) {
      setError(`Error saving language preferences: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateTemplate = async () => {
    setLoading(true);
    try {
      const newTemplateData: TranslationTemplate = {
        id: Date.now().toString(),
        name: newTemplate.name,
        category: newTemplate.category,
        content: {
          en: newTemplate.contentEn,
          es: newTemplate.contentEs
        },
        usage: 0
      };
      
      setTranslationTemplates([...translationTemplates, newTemplateData]);
      setNewTemplate({ name: '', category: 'general', contentEn: '', contentEs: '' });
      setTemplateDialogOpen(false);
      setSuccess('Translation template created successfully!');
    } catch (error: any) {
      setError(`Error creating template: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleTestTranslation = async () => {
    setLoading(true);
    try {
      const translateContent = httpsCallable(functions, 'translateContent');
      const result = await translateContent({
        content: testTranslation.content,
        targetLanguage: testTranslation.targetLanguage,
        sourceLanguage: testTranslation.sourceLanguage
      });
      
      const data = result.data as any;
      if (data.success) {
        setSuccess(`Translation successful: ${data.translatedContent}`);
      } else {
        setError('Translation failed');
      }
    } catch (error: any) {
      setError(`Translation test failed: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleLanguageToggle = (language: string, field: 'enabled' | 'autoTranslate') => {
    setLanguagePreferences(prev => 
      prev.map(lang => 
        lang.language === language 
          ? { ...lang, [field]: !lang[field] }
          : lang
      )
    );
  };

  const getLanguageName = (code: string) => {
    const lang = languagePreferences.find(l => l.language === code);
    return lang ? lang.name : code.toUpperCase();
  };

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'greeting': return 'primary';
      case 'notification': return 'secondary';
      case 'error': return 'error';
      case 'success': return 'success';
      default: return 'default';
    }
  };

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" gutterBottom>
        Translation Management
      </Typography>
      
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      
      {success && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess(null)}>
          {success}
        </Alert>
      )}
      
      <Box sx={{ mb: 3 }}>
        <Tabs value={activeTab} onChange={(_, newValue) => setActiveTab(newValue)}>
          <Tab label="Settings" icon={<SettingsIcon />} />
          <Tab label="Languages" icon={<LanguageIcon />} />
          <Tab label="Templates" icon={<TranslateIcon />} />
          <Tab label="Test Translation" icon={<TranslateIcon />} />
        </Tabs>
      </Box>
      
      {activeTab === 0 && (
        <Card>
          <CardContent>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
              <Typography variant="h6">Translation Settings</Typography>
              <Button
                variant="outlined"
                startIcon={<EditIcon />}
                onClick={() => setSettingsDialogOpen(true)}
              >
                Edit Settings
              </Button>
            </Box>
            
            <Grid container spacing={3}>
              <Grid item xs={12} md={6}>
                <Typography variant="subtitle1" gutterBottom>General Settings</Typography>
                <Box sx={{ mb: 2 }}>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={translationSettings.enabled}
                        disabled
                      />
                    }
                    label="Translation Enabled"
                  />
                </Box>
                <Box sx={{ mb: 2 }}>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={translationSettings.autoTranslate}
                        disabled
                      />
                    }
                    label="Auto-translate Messages"
                  />
                </Box>
                <Typography variant="body2" color="textSecondary">
                  Default Source: {getLanguageName(translationSettings.defaultSourceLanguage)}
                </Typography>
                <Typography variant="body2" color="textSecondary">
                  Default Target: {getLanguageName(translationSettings.defaultTargetLanguage)}
                </Typography>
              </Grid>
              
              <Grid item xs={12} md={6}>
                <Typography variant="subtitle1" gutterBottom>Provider Settings</Typography>
                <Typography variant="body2" color="textSecondary">
                  Provider: {translationSettings.translationProvider.toUpperCase()}
                </Typography>
                <Typography variant="body2" color="textSecondary">
                  Quality Threshold: {translationSettings.qualityThreshold * 100}%
                </Typography>
                <Typography variant="body2" color="textSecondary">
                  Supported Languages: {translationSettings.supportedLanguages.length}
                </Typography>
              </Grid>
            </Grid>
          </CardContent>
        </Card>
      )}
      
      {activeTab === 1 && (
        <Card>
          <CardContent>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
              <Typography variant="h6">Language Preferences</Typography>
              <Button
                variant="contained"
                onClick={handleSaveLanguagePreferences}
                disabled={loading}
              >
                Save Preferences
              </Button>
            </Box>
            
            <List>
              {languagePreferences.map((lang) => (
                <React.Fragment key={lang.language}>
                  <ListItem>
                    <ListItemText
                      primary={`${lang.name} (${lang.nativeName})`}
                      secondary={`Language code: ${lang.language}`}
                    />
                    <ListItemSecondaryAction>
                      <FormControlLabel
                        control={
                          <Switch
                            checked={lang.enabled}
                            onChange={() => handleLanguageToggle(lang.language, 'enabled')}
                          />
                        }
                        label="Enabled"
                        sx={{ mr: 2 }}
                      />
                      <FormControlLabel
                        control={
                          <Switch
                            checked={lang.autoTranslate}
                            onChange={() => handleLanguageToggle(lang.language, 'autoTranslate')}
                          />
                        }
                        label="Auto-translate"
                      />
                    </ListItemSecondaryAction>
                  </ListItem>
                  <Divider />
                </React.Fragment>
              ))}
            </List>
          </CardContent>
        </Card>
      )}
      
      {activeTab === 2 && (
        <Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
            <Typography variant="h6">Translation Templates</Typography>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => setTemplateDialogOpen(true)}
            >
              Create Template
            </Button>
          </Box>
          
          <Grid container spacing={3}>
            {translationTemplates.map((template) => (
              <Grid item xs={12} md={6} lg={4} key={template.id}>
                <Card>
                  <CardContent>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
                      <Typography variant="h6" component="div">
                        {template.name}
                      </Typography>
                      <Chip
                        label={template.category}
                        color={getCategoryColor(template.category) as any}
                        size="small"
                      />
                    </Box>
                    
                    <Typography variant="body2" color="textSecondary" sx={{ mb: 2 }}>
                      <strong>English:</strong> {template.content.en}
                    </Typography>
                    
                    <Typography variant="body2" color="textSecondary" sx={{ mb: 2 }}>
                      <strong>Spanish:</strong> {template.content.es}
                    </Typography>
                    
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Typography variant="caption" color="textSecondary">
                        Used {template.usage} times
                      </Typography>
                      <Box>
                        <IconButton size="small">
                          <EditIcon />
                        </IconButton>
                        <IconButton size="small" color="error">
                          <DeleteIcon />
                        </IconButton>
                      </Box>
                    </Box>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
        </Box>
      )}
      
      {activeTab === 3 && (
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Test Translation
            </Typography>
            
            <Grid container spacing={3}>
              <Grid item xs={12} md={6}>
                <FormControl fullWidth sx={{ mb: 2 }}>
                  <InputLabel>Source Language</InputLabel>
                  <Select
                    value={testTranslation.sourceLanguage}
                    label="Source Language"
                    onChange={(e) => setTestTranslation({
                      ...testTranslation,
                      sourceLanguage: e.target.value
                    })}
                  >
                    {languagePreferences.filter(l => l.enabled).map(lang => (
                      <MenuItem key={lang.language} value={lang.language}>
                        {lang.name}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                
                <TextField
                  fullWidth
                  multiline
                  rows={4}
                  label="Content to Translate"
                  value={testTranslation.content}
                  onChange={(e) => setTestTranslation({
                    ...testTranslation,
                    content: e.target.value
                  })}
                  sx={{ mb: 2 }}
                />
              </Grid>
              
              <Grid item xs={12} md={6}>
                <FormControl fullWidth sx={{ mb: 2 }}>
                  <InputLabel>Target Language</InputLabel>
                  <Select
                    value={testTranslation.targetLanguage}
                    label="Target Language"
                    onChange={(e) => setTestTranslation({
                      ...testTranslation,
                      targetLanguage: e.target.value
                    })}
                  >
                    {languagePreferences.filter(l => l.enabled).map(lang => (
                      <MenuItem key={lang.language} value={lang.language}>
                        {lang.name}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                
                <Button
                  fullWidth
                  variant="contained"
                  startIcon={loading ? <CircularProgress size={20} /> : <TranslateIcon />}
                  onClick={handleTestTranslation}
                  disabled={loading || !testTranslation.content}
                  sx={{ mb: 2 }}
                >
                  {loading ? 'Translating...' : 'Test Translation'}
                </Button>
              </Grid>
            </Grid>
          </CardContent>
        </Card>
      )}
      
      {/* Settings Dialog */}
      <Dialog open={settingsDialogOpen} onClose={() => setSettingsDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Edit Translation Settings</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12} sm={6}>
              <FormControlLabel
                control={
                  <Switch
                    checked={translationSettings.enabled}
                    onChange={(e) => setTranslationSettings({
                      ...translationSettings,
                      enabled: e.target.checked
                    })}
                  />
                }
                label="Enable Translation"
              />
            </Grid>
            
            <Grid item xs={12} sm={6}>
              <FormControlLabel
                control={
                  <Switch
                    checked={translationSettings.autoTranslate}
                    onChange={(e) => setTranslationSettings({
                      ...translationSettings,
                      autoTranslate: e.target.checked
                    })}
                  />
                }
                label="Auto-translate Messages"
              />
            </Grid>
            
            <Grid item xs={12} sm={6}>
              <FormControl fullWidth>
                <InputLabel>Default Source Language</InputLabel>
                <Select
                  value={translationSettings.defaultSourceLanguage}
                  label="Default Source Language"
                  onChange={(e) => setTranslationSettings({
                    ...translationSettings,
                    defaultSourceLanguage: e.target.value
                  })}
                >
                  {languagePreferences.filter(l => l.enabled).map(lang => (
                    <MenuItem key={lang.language} value={lang.language}>
                      {lang.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            
            <Grid item xs={12} sm={6}>
              <FormControl fullWidth>
                <InputLabel>Default Target Language</InputLabel>
                <Select
                  value={translationSettings.defaultTargetLanguage}
                  label="Default Target Language"
                  onChange={(e) => setTranslationSettings({
                    ...translationSettings,
                    defaultTargetLanguage: e.target.value
                  })}
                >
                  {languagePreferences.filter(l => l.enabled).map(lang => (
                    <MenuItem key={lang.language} value={lang.language}>
                      {lang.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            
            <Grid item xs={12} sm={6}>
              <FormControl fullWidth>
                <InputLabel>Translation Provider</InputLabel>
                <Select
                  value={translationSettings.translationProvider}
                  label="Translation Provider"
                  onChange={(e) => setTranslationSettings({
                    ...translationSettings,
                    translationProvider: e.target.value as any
                  })}
                >
                  <MenuItem value="openai">OpenAI</MenuItem>
                  <MenuItem value="google">Google Translate</MenuItem>
                  <MenuItem value="azure">Azure Translator</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                type="number"
                label="Quality Threshold"
                value={translationSettings.qualityThreshold}
                onChange={(e) => setTranslationSettings({
                  ...translationSettings,
                  qualityThreshold: parseFloat(e.target.value)
                })}
                inputProps={{ min: 0, max: 1, step: 0.1 }}
                helperText="Minimum confidence score (0-1)"
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSettingsDialogOpen(false)}>Cancel</Button>
          <Button 
            onClick={handleSaveSettings} 
            variant="contained"
            disabled={loading}
          >
            Save Settings
          </Button>
        </DialogActions>
      </Dialog>
      
      {/* Template Dialog */}
      <Dialog open={templateDialogOpen} onClose={() => setTemplateDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Create Translation Template</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Template Name"
                value={newTemplate.name}
                onChange={(e) => setNewTemplate({ ...newTemplate, name: e.target.value })}
              />
            </Grid>
            
            <Grid item xs={12} sm={6}>
              <FormControl fullWidth>
                <InputLabel>Category</InputLabel>
                <Select
                  value={newTemplate.category}
                  label="Category"
                  onChange={(e) => setNewTemplate({ ...newTemplate, category: e.target.value })}
                >
                  <MenuItem value="general">General</MenuItem>
                  <MenuItem value="greeting">Greeting</MenuItem>
                  <MenuItem value="notification">Notification</MenuItem>
                  <MenuItem value="error">Error</MenuItem>
                  <MenuItem value="success">Success</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            
            <Grid item xs={12}>
              <TextField
                fullWidth
                multiline
                rows={3}
                label="English Content"
                value={newTemplate.contentEn}
                onChange={(e) => setNewTemplate({ ...newTemplate, contentEn: e.target.value })}
              />
            </Grid>
            
            <Grid item xs={12}>
              <TextField
                fullWidth
                multiline
                rows={3}
                label="Spanish Content"
                value={newTemplate.contentEs}
                onChange={(e) => setNewTemplate({ ...newTemplate, contentEs: e.target.value })}
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTemplateDialogOpen(false)}>Cancel</Button>
          <Button 
            onClick={handleCreateTemplate} 
            variant="contained"
            disabled={loading || !newTemplate.name || !newTemplate.contentEn || !newTemplate.contentEs}
          >
            Create Template
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default TranslationManagement; 