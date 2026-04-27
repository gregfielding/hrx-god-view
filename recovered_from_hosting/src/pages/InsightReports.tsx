import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Switch,
  FormControlLabel,
  Card,
  CardContent,
  CardHeader,
  Alert,
  Button,
  Grid,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Chip,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  IconButton,
} from '@mui/material';
import {
  Favorite as FavoriteIcon,
  FavoriteBorder as FavoriteBorderIcon,
  Visibility as VisibilityIcon,
  VisibilityOff as VisibilityOffIcon,
  Edit as EditIcon,
} from '@mui/icons-material';
import { doc, getDoc, updateDoc } from 'firebase/firestore';

import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';

interface ReportTemplate {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  isFavorite: boolean;
  category: string;
  frequency: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'on-demand';
  recipients: string[];
}

const InsightReports: React.FC = () => {
  const { tenantId } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  
  const [settings, setSettings] = useState({
    reportSettings: {
      enableReports: true,
      autoGenerate: true,
      allowCustomization: true,
      dataRetentionDays: 365,
      maxReportsPerUser: 10,
    },
    defaultReports: [
      {
        id: 'workforce-overview',
        name: 'Workforce Overview',
        description: 'Comprehensive view of workforce demographics, skills, and performance',
        enabled: true,
        isFavorite: false,
        category: 'Workforce',
        frequency: 'weekly' as const,
        recipients: ['managers', 'hr'],
      },
      {
        id: 'skill-gap-analysis',
        name: 'Skill Gap Analysis',
        description: 'Identify skill gaps and training needs across the organization',
        enabled: true,
        isFavorite: false,
        category: 'Skills',
        frequency: 'monthly' as const,
        recipients: ['managers', 'hr'],
      },
      {
        id: 'performance-metrics',
        name: 'Performance Metrics',
        description: 'Track individual and team performance indicators',
        enabled: true,
        isFavorite: false,
        category: 'Performance',
        frequency: 'weekly' as const,
        recipients: ['managers'],
      },
      {
        id: 'turnover-analysis',
        name: 'Turnover Analysis',
        description: 'Analyze employee retention and turnover patterns',
        enabled: false,
        isFavorite: false,
        category: 'Retention',
        frequency: 'monthly' as const,
        recipients: ['hr'],
      },
      {
        id: 'diversity-inclusion',
        name: 'Diversity & Inclusion',
        description: 'Monitor diversity metrics and inclusion initiatives',
        enabled: true,
        isFavorite: false,
        category: 'Diversity',
        frequency: 'quarterly' as const,
        recipients: ['hr', 'leadership'],
      },
      {
        id: 'compensation-analysis',
        name: 'Compensation Analysis',
        description: 'Review compensation structures and market competitiveness',
        enabled: false,
        isFavorite: false,
        category: 'Compensation',
        frequency: 'quarterly' as const,
        recipients: ['hr'],
      },
    ],
    notificationSettings: {
      reportReady: true,
      reportDelivery: true,
      customReportAlerts: true,
      dataAnomalies: true,
    },
  });

  useEffect(() => {
    loadSettings();
  }, [tenantId]);

  const loadSettings = async () => {
    if (!tenantId) return;
    
    try {
      const settingsRef = doc(db, 'tenants', tenantId, 'settings', 'insight-reports');
      const settingsDoc = await getDoc(settingsRef);
      
      if (settingsDoc.exists()) {
        setSettings(prev => ({ ...prev, ...settingsDoc.data() }));
      }
    } catch (error) {
      console.error('Error loading insight reports settings:', error);
      setMessage({ type: 'error', text: 'Failed to load settings' });
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!tenantId) return;
    
    setSaving(true);
    try {
      const settingsRef = doc(db, 'tenants', tenantId, 'settings', 'insight-reports');
      await updateDoc(settingsRef, {
        ...settings,
        updatedAt: new Date(),
      });
      
      setMessage({ type: 'success', text: 'Settings saved successfully' });
    } catch (error) {
      console.error('Error saving insight reports settings:', error);
      setMessage({ type: 'error', text: 'Failed to save settings' });
    } finally {
      setSaving(false);
    }
  };

  const handleSettingChange = (key: string, value: any) => {
    setSettings(prev => ({
      ...prev,
      [key]: value,
    }));
  };

  const handleNestedSettingChange = (parentKey: string, childKey: string, value: any) => {
    setSettings(prev => ({
      ...prev,
      [parentKey]: {
        ...(prev as any)[parentKey],
        [childKey]: value,
      },
    }));
  };

  const handleReportToggle = (reportId: string, enabled: boolean) => {
    setSettings(prev => ({
      ...prev,
      defaultReports: prev.defaultReports.map(report =>
        report.id === reportId ? { ...report, enabled } : report
      ),
    }));
  };

  const handleReportFavorite = (reportId: string, isFavorite: boolean) => {
    setSettings(prev => ({
      ...prev,
      defaultReports: prev.defaultReports.map(report =>
        report.id === reportId ? { ...report, isFavorite } : report
      ),
    }));
  };

  const handleReportFrequencyChange = (reportId: string, frequency: string) => {
    setSettings(prev => ({
      ...prev,
      defaultReports: prev.defaultReports.map(report =>
        report.id === reportId ? { ...report, frequency: frequency as any } : report
      ),
    }));
  };

  if (loading) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography>Loading Insight Reports Settings...</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" gutterBottom>
        HRX Insight Reports
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
        Toggle reports, mark favorites, and customize report templates for your organization.
      </Typography>

      {message && (
        <Alert severity={message.type} sx={{ mb: 3 }} onClose={() => setMessage(null)}>
          {message.text}
        </Alert>
      )}

      <Grid container spacing={3}>
        {/* Report Settings */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardHeader title="Report Settings" />
            <CardContent>
              <FormControlLabel
                control={
                  <Switch
                    checked={settings.reportSettings.enableReports}
                    onChange={(e) => handleNestedSettingChange('reportSettings', 'enableReports', e.target.checked)}
                  />
                }
                label="Enable Reports"
              />
              
              <FormControlLabel
                control={
                  <Switch
                    checked={settings.reportSettings.autoGenerate}
                    onChange={(e) => handleNestedSettingChange('reportSettings', 'autoGenerate', e.target.checked)}
                  />
                }
                label="Auto-Generate Reports"
                sx={{ mt: 1, display: 'block' }}
              />

              <FormControlLabel
                control={
                  <Switch
                    checked={settings.reportSettings.allowCustomization}
                    onChange={(e) => handleNestedSettingChange('reportSettings', 'allowCustomization', e.target.checked)}
                  />
                }
                label="Allow Customization"
                sx={{ mt: 1, display: 'block' }}
              />

              <TextField
                fullWidth
                type="number"
                label="Data Retention (days)"
                value={settings.reportSettings.dataRetentionDays}
                onChange={(e) => handleNestedSettingChange('reportSettings', 'dataRetentionDays', parseInt(e.target.value))}
                sx={{ mt: 2 }}
              />

              <TextField
                fullWidth
                type="number"
                label="Max Reports Per User"
                value={settings.reportSettings.maxReportsPerUser}
                onChange={(e) => handleNestedSettingChange('reportSettings', 'maxReportsPerUser', parseInt(e.target.value))}
                sx={{ mt: 2 }}
              />
            </CardContent>
          </Card>
        </Grid>

        {/* Notification Settings */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardHeader title="Notification Settings" />
            <CardContent>
              <FormControlLabel
                control={
                  <Switch
                    checked={settings.notificationSettings.reportReady}
                    onChange={(e) => handleNestedSettingChange('notificationSettings', 'reportReady', e.target.checked)}
                  />
                }
                label="Report Ready Notifications"
              />

              <FormControlLabel
                control={
                  <Switch
                    checked={settings.notificationSettings.reportDelivery}
                    onChange={(e) => handleNestedSettingChange('notificationSettings', 'reportDelivery', e.target.checked)}
                  />
                }
                label="Report Delivery Confirmations"
                sx={{ mt: 1, display: 'block' }}
              />

              <FormControlLabel
                control={
                  <Switch
                    checked={settings.notificationSettings.customReportAlerts}
                    onChange={(e) => handleNestedSettingChange('notificationSettings', 'customReportAlerts', e.target.checked)}
                  />
                }
                label="Custom Report Alerts"
                sx={{ mt: 1, display: 'block' }}
              />

              <FormControlLabel
                control={
                  <Switch
                    checked={settings.notificationSettings.dataAnomalies}
                    onChange={(e) => handleNestedSettingChange('notificationSettings', 'dataAnomalies', e.target.checked)}
                  />
                }
                label="Data Anomaly Alerts"
                sx={{ mt: 1, display: 'block' }}
              />
            </CardContent>
          </Card>
        </Grid>

        {/* Report Templates */}
        <Grid item xs={12}>
          <Card>
            <CardHeader title="Report Templates" />
            <CardContent>
              <List>
                {settings.defaultReports.map((report) => (
                  <ListItem key={report.id} divider>
                    <ListItemText
                      primary={
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Typography variant="h6">{report.name}</Typography>
                          <Chip label={report.category} size="small" color="primary" />
                          {report.isFavorite && <FavoriteIcon color="error" fontSize="small" />}
                        </Box>
                      }
                      secondary={
                        <Box>
                          <Typography variant="body2" color="text.secondary">
                            {report.description}
                          </Typography>
                          <Box sx={{ mt: 1, display: 'flex', gap: 2, alignItems: 'center' }}>
                            <FormControl size="small" sx={{ minWidth: 120 }}>
                              <InputLabel>Frequency</InputLabel>
                              <Select
                                value={report.frequency}
                                onChange={(e) => handleReportFrequencyChange(report.id, e.target.value)}
                                label="Frequency"
                              >
                                <MenuItem value="daily">Daily</MenuItem>
                                <MenuItem value="weekly">Weekly</MenuItem>
                                <MenuItem value="monthly">Monthly</MenuItem>
                                <MenuItem value="quarterly">Quarterly</MenuItem>
                                <MenuItem value="on-demand">On Demand</MenuItem>
                              </Select>
                            </FormControl>
                            <Typography variant="caption" color="text.secondary">
                              Recipients: {report.recipients.join(', ')}
                            </Typography>
                          </Box>
                        </Box>
                      }
                    />
                    <ListItemSecondaryAction>
                      <Box sx={{ display: 'flex', gap: 1 }}>
                        <IconButton
                          onClick={() => handleReportFavorite(report.id, !report.isFavorite)}
                          color={report.isFavorite ? 'error' : 'default'}
                        >
                          {report.isFavorite ? <FavoriteIcon /> : <FavoriteBorderIcon />}
                        </IconButton>
                        <IconButton
                          onClick={() => handleReportToggle(report.id, !report.enabled)}
                          color={report.enabled ? 'primary' : 'default'}
                        >
                          {report.enabled ? <VisibilityIcon /> : <VisibilityOffIcon />}
                        </IconButton>
                        <IconButton>
                          <EditIcon />
                        </IconButton>
                      </Box>
                    </ListItemSecondaryAction>
                  </ListItem>
                ))}
              </List>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Box sx={{ mt: 3, display: 'flex', justifyContent: 'flex-end' }}>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={saving}
          size="large"
        >
          {saving ? 'Saving...' : 'Save Settings'}
        </Button>
      </Box>
    </Box>
  );
};

export default InsightReports; 