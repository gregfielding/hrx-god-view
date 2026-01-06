/**
 * Email Signature Tab Component
 * 
 * Allows users to configure their email signature for all emails sent through the app.
 */

import React, { useState, useEffect } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Switch,
  FormControlLabel,
  Button,
  Stack,
  Alert,
  Divider,
  Paper,
} from '@mui/material';
import EmailIcon from '@mui/icons-material/Email';
import SaveIcon from '@mui/icons-material/Save';
import PreviewIcon from '@mui/icons-material/Preview';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../../../firebase';
import { useAuth } from '../../../contexts/AuthContext';
import {
  EmailSignatureSettings,
  SignatureTemplate,
  generateEmailSignature,
  EmailSignatureData,
} from '../../../utils/emailSignature';

interface Props {
  uid: string;
}

const EmailSignatureTab: React.FC<Props> = ({ uid }) => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  const [settings, setSettings] = useState<EmailSignatureSettings>({
    template: 'default',
    enabled: true,
    data: {
      fullName: '',
      jobTitle: '',
      phone: '',
      email: '',
      officeLocation: '',
      pronouns: '',
      schedulingLink: '',
      applicationPortal: '',
      includeConfidentialityNotice: false,
    },
  });

  useEffect(() => {
    loadSignatureSettings();
  }, [uid]);

  const loadSignatureSettings = async () => {
    setLoading(true);
    try {
      const userRef = doc(db, 'users', uid);
      const userSnap = await getDoc(userRef);
      
      if (userSnap.exists()) {
        const userData = userSnap.data();
        const signatureSettings = userData?.emailSignature as EmailSignatureSettings | undefined;
        
        if (signatureSettings) {
          setSettings(signatureSettings);
        } else {
          // Initialize with user data
          const defaultData: EmailSignatureData = {
            fullName: userData?.displayName || `${userData?.firstName || ''} ${userData?.lastName || ''}`.trim() || '',
            jobTitle: userData?.jobTitle || '',
            phone: userData?.phone || '',
            email: userData?.email || '',
            officeLocation: userData?.city && userData?.state 
              ? `${userData.city}, ${userData.state}` 
              : '',
            pronouns: '',
            schedulingLink: '',
            applicationPortal: '',
            includeConfidentialityNotice: false,
          };
          
          setSettings({
            template: 'default',
            enabled: true,
            data: defaultData,
          });
        }
      }
    } catch (error) {
      console.error('Error loading email signature settings:', error);
      setMessage({ type: 'error', text: 'Failed to load signature settings' });
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    
    try {
      const userRef = doc(db, 'users', uid);
      await setDoc(userRef, { emailSignature: settings }, { merge: true });
      
      setMessage({ type: 'success', text: 'Email signature saved successfully' });
    } catch (error) {
      console.error('Error saving email signature:', error);
      setMessage({ type: 'error', text: 'Failed to save signature settings' });
    } finally {
      setSaving(false);
    }
  };

  const handleTemplateChange = (template: SignatureTemplate) => {
    setSettings({ ...settings, template });
  };

  const handleDataChange = (field: keyof EmailSignatureData, value: string | boolean) => {
    setSettings({
      ...settings,
      data: {
        ...settings.data,
        [field]: value,
      },
    });
  };

  const previewHtml = generateEmailSignature(settings);

  return (
    <Box sx={{ p: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Card variant="outlined">
        <CardContent sx={{ px: 3, py: 4 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
            <EmailIcon sx={{ mr: 1 }} color="primary" />
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              Email Signature
            </Typography>
          </Box>

          {message && (
            <Alert severity={message.type} sx={{ mb: 3 }} onClose={() => setMessage(null)}>
              {message.text}
            </Alert>
          )}

          <FormControlLabel
            control={
              <Switch
                checked={settings.enabled}
                onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })}
              />
            }
            label="Enable email signature"
            sx={{ mb: 3 }}
          />

          {settings.enabled && (
            <>
              <Box sx={{ mb: 3 }}>
                <FormControl fullWidth>
                  <InputLabel>Signature Template</InputLabel>
                  <Select
                    value={settings.template}
                    onChange={(e) => handleTemplateChange(e.target.value as SignatureTemplate)}
                    label="Signature Template"
                  >
                    <MenuItem value="default">Default</MenuItem>
                    <MenuItem value="sales">Sales</MenuItem>
                    <MenuItem value="recruiter">Recruiter</MenuItem>
                    <MenuItem value="executive">Executive</MenuItem>
                  </Select>
                </FormControl>
                <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                  {settings.template === 'sales' && 'Includes scheduling link'}
                  {settings.template === 'recruiter' && 'Includes application portal link'}
                  {settings.template === 'executive' && 'Simplified format with tagline'}
                  {settings.template === 'default' && 'Standard format with regional coverage'}
                </Typography>
              </Box>

              <Divider sx={{ my: 3 }} />

              <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 2 }}>
                Contact Information
              </Typography>

              <Stack spacing={2}>
                <TextField
                  fullWidth
                  label="Full Name"
                  value={settings.data.fullName}
                  onChange={(e) => handleDataChange('fullName', e.target.value)}
                  required
                />

                <TextField
                  fullWidth
                  label="Job Title"
                  value={settings.data.jobTitle}
                  onChange={(e) => handleDataChange('jobTitle', e.target.value)}
                  required
                />

                <TextField
                  fullWidth
                  label="Phone Number"
                  value={settings.data.phone}
                  onChange={(e) => handleDataChange('phone', e.target.value)}
                  required
                  helperText="Will be formatted as (XXX) XXX-XXXX"
                />

                <TextField
                  fullWidth
                  label="Email Address"
                  value={settings.data.email}
                  onChange={(e) => handleDataChange('email', e.target.value)}
                  required
                  type="email"
                />

                <TextField
                  fullWidth
                  label="Office Location (City, State)"
                  value={settings.data.officeLocation}
                  onChange={(e) => handleDataChange('officeLocation', e.target.value)}
                  placeholder="e.g., Danville, California"
                />

                <TextField
                  fullWidth
                  label="Pronouns (Optional)"
                  value={settings.data.pronouns}
                  onChange={(e) => handleDataChange('pronouns', e.target.value)}
                  placeholder="e.g., he/him, she/her, they/them"
                />
              </Stack>

              {(settings.template === 'sales' || settings.template === 'recruiter') && (
                <>
                  <Divider sx={{ my: 3 }} />
                  <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 2 }}>
                    Template-Specific Links
                  </Typography>

                  {settings.template === 'sales' && (
                    <TextField
                      fullWidth
                      label="Scheduling Link"
                      value={settings.data.schedulingLink}
                      onChange={(e) => handleDataChange('schedulingLink', e.target.value)}
                      placeholder="https://calendly.com/your-link"
                      sx={{ mb: 2 }}
                    />
                  )}

                  {settings.template === 'recruiter' && (
                    <TextField
                      fullWidth
                      label="Application Portal Link"
                      value={settings.data.applicationPortal}
                      onChange={(e) => handleDataChange('applicationPortal', e.target.value)}
                      placeholder="https://c1staffing.com/apply"
                      sx={{ mb: 2 }}
                    />
                  )}
                </>
              )}

              <Divider sx={{ my: 3 }} />

              <FormControlLabel
                control={
                  <Switch
                    checked={settings.data.includeConfidentialityNotice}
                    onChange={(e) => handleDataChange('includeConfidentialityNotice', e.target.checked)}
                  />
                }
                label="Include Confidentiality Notice"
                sx={{ mb: 3 }}
              />
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 3 }}>
                Recommended for HR matters, payroll, contracts, employee data, and disciplinary topics
              </Typography>

              <Divider sx={{ my: 3 }} />

              <Stack direction="row" spacing={2} justifyContent="flex-end">
                <Button
                  variant="outlined"
                  startIcon={<PreviewIcon />}
                  onClick={() => setShowPreview(!showPreview)}
                >
                  {showPreview ? 'Hide Preview' : 'Show Preview'}
                </Button>
                <Button
                  variant="contained"
                  startIcon={<SaveIcon />}
                  onClick={handleSave}
                  disabled={saving || !settings.data.fullName || !settings.data.jobTitle || !settings.data.phone || !settings.data.email}
                >
                  {saving ? 'Saving...' : 'Save Signature'}
                </Button>
              </Stack>

              {showPreview && (
                <Paper
                  variant="outlined"
                  sx={{
                    mt: 3,
                    p: 3,
                    bgcolor: 'grey.50',
                    border: '1px solid',
                    borderColor: 'divider',
                  }}
                >
                  <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 2 }}>
                    Preview
                  </Typography>
                  <Box
                    sx={{
                      border: '1px solid',
                      borderColor: 'divider',
                      borderRadius: 1,
                      p: 2,
                      bgcolor: 'white',
                    }}
                    dangerouslySetInnerHTML={{ __html: previewHtml }}
                  />
                </Paper>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </Box>
  );
};

export default EmailSignatureTab;

