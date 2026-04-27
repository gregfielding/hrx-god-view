/**
 * Messaging Settings Tab
 * Manage SMS and Email templates and recruiter phone numbers
 */

import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Paper,
  Tabs,
  Tab,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Switch,
  FormControlLabel,
  Chip,
  Alert,
  Snackbar,
  CircularProgress,
  Tooltip,
  Stack,
  FormHelperText,
  Grid,
  Link,
  Autocomplete,
  ToggleButton,
  ToggleButtonGroup,
  ButtonGroup,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import PreviewIcon from '@mui/icons-material/Preview';
import PhoneIcon from '@mui/icons-material/Phone';
import EmailIcon from '@mui/icons-material/Email';
import SmsIcon from '@mui/icons-material/Sms';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import PhoneAndroidIcon from '@mui/icons-material/PhoneAndroid';
import ComputerIcon from '@mui/icons-material/Computer';
import { useAuth } from '../../contexts/AuthContext';
import { collection, getDocs, query, where, limit } from 'firebase/firestore';
import { db } from '../../firebase';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase';
import {
  listTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  getMessageTypes,
  testRenderTemplate,
  extractVariables,
  sendTestMessage,
  type UnifiedMessageTemplate,
  type MessageTypeConfig,
  type Channel,
  type LanguageCode,
} from '../../utils/templateApi';
import EmailTemplateEditor from '../../components/EmailTemplateEditor';

interface MessagingTabProps {
  tenantId: string;
}

const MessagingTab: React.FC<MessagingTabProps> = ({ tenantId }) => {
  const { user } = useAuth();
  const [subTab, setSubTab] = useState(0); // 0: Templates, 1: Recruiter Numbers
  const [channelTab, setChannelTab] = useState<Channel>('sms'); // For templates tab
  const [templates, setTemplates] = useState<UnifiedMessageTemplate[]>([]);
  const [messageTypes, setMessageTypes] = useState<MessageTypeConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  
  // Template dialog state
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<UnifiedMessageTemplate | null>(null);
  const [templateForm, setTemplateForm] = useState<Partial<UnifiedMessageTemplate>>({
    name: '',
    messageTypeId: '',
    channel: 'sms',
    language: 'en',
    body: '',
    subject: '',
    htmlBody: '',
    variables: [],
    includeStopFooter: false,
    active: true,
  });
  const [previewText, setPreviewText] = useState('');
  const [previewMode, setPreviewMode] = useState<'desktop' | 'mobile'>('desktop');
  
  // Test send dialog state
  const [testSendDialogOpen, setTestSendDialogOpen] = useState(false);
  const [testRecipients, setTestRecipients] = useState<Array<{ id: string; name: string; email?: string; phone?: string; securityLevel?: number; securityLevelLabel?: string }>>([]);
  const [selectedTestRecipient, setSelectedTestRecipient] = useState<string>('');
  const [testSending, setTestSending] = useState(false);
  const [testSendResult, setTestSendResult] = useState<{ success: boolean; message?: string } | null>(null);

  useEffect(() => {
    if (tenantId) {
    loadTemplates();
      loadMessageTypes();
      loadTestRecipients();
    }
  }, [tenantId, channelTab]);

  const loadTestRecipients = async () => {
    try {
      // Load ALL users from the tenant for test sending (all security levels)
      // Query all users and filter client-side to include all security levels
      const usersQuery = query(
        collection(db, 'users'),
        limit(500) // Increased limit to get more users
      );
      const snapshot = await getDocs(usersQuery);
      
      // Security level labels for display
      const securityLevelLabels: Record<number, string> = {
        0: 'Applicant',
        1: 'Applicant Verified',
        2: 'Candidate',
        3: 'Hired Staff',
        4: 'Worker',
        5: 'Staff Manager',
        6: 'Manager',
        7: 'Admin',
      };
      
      const recipients = snapshot.docs
        .map(doc => {
          const data = doc.data();
          
          // Check if user belongs to this tenant
          if (!data.tenantIds || !data.tenantIds[tenantId]) {
            return null;
          }
          
          const name = `${data.firstName || ''} ${data.lastName || ''}`.trim() || data.displayName || data.email || 'Unknown';
          const tenantData = data.tenantIds[tenantId] || {};
          const securityLevel = parseInt(tenantData.securityLevel || data.securityLevel || '0');
          
          return {
            id: doc.id,
            name,
            email: data.email,
            phone: data.phone || data.phoneE164,
            securityLevel,
            securityLevelLabel: securityLevelLabels[securityLevel] || `Level ${securityLevel}`,
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null && (r.email || r.phone)) // Only include users with email or phone
        .sort((a, b) => {
          // Sort by name, but group by security level
          if (a.securityLevel !== b.securityLevel) {
            return a.securityLevel - b.securityLevel;
          }
          return a.name.localeCompare(b.name);
        });
      
      setTestRecipients(recipients);
    } catch (err) {
      console.error('Failed to load test recipients:', err);
      setTestRecipients([]);
    }
  };

  const loadTemplates = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listTemplates(tenantId, {
        channel: channelTab,
        active: undefined, // Get all templates
      });
      if (result.success) {
        setTemplates(result.data);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load templates');
    } finally {
      setLoading(false);
    }
  };

  const loadMessageTypes = async () => {
    try {
      const result = await getMessageTypes(tenantId);
      if (result.success) {
        // Filter to only types that support the current channel
        const filtered = result.data.filter(type => 
          type.enabled && type.defaultChannels.includes(channelTab)
        );
        setMessageTypes(filtered);
      }
    } catch (err: any) {
      console.error('Failed to load message types:', err);
    }
  };

  const handleOpenTemplateDialog = (template?: UnifiedMessageTemplate) => {
    if (template) {
      setEditingTemplate(template);
      setTemplateForm({
        name: template.name,
        messageTypeId: template.messageTypeId,
        channel: template.channel,
        language: template.language,
        body: template.body,
        subject: template.subject || '',
        htmlBody: template.htmlBody || '',
        variables: template.variables,
        includeStopFooter: template.includeStopFooter,
        active: template.active,
      });
    } else {
      setEditingTemplate(null);
      setTemplateForm({
        name: '',
        messageTypeId: '',
        channel: channelTab,
        language: 'en',
        body: '',
        subject: '',
        htmlBody: '',
        variables: [],
        includeStopFooter: channelTab === 'sms',
        active: true,
      });
    }
    setTemplateDialogOpen(true);
    updatePreview();
  };

  const handleCloseTemplateDialog = () => {
    setTemplateDialogOpen(false);
    setEditingTemplate(null);
    setTemplateForm({
      name: '',
      messageTypeId: '',
      channel: channelTab,
      language: 'en',
      body: '',
      subject: '',
      htmlBody: '',
      variables: [],
      includeStopFooter: channelTab === 'sms',
      active: true,
    });
    setPreviewText('');
  };

  const updatePreview = () => {
    if (!templateForm.messageTypeId || (!templateForm.body && !templateForm.htmlBody)) {
      setPreviewText('');
      return;
    }

    // Enhanced sample data for preview
    const sampleContext: Record<string, any> = {
      firstName: 'John',
      lastName: 'Doe',
      fullName: 'John Doe',
      jobTitle: 'Warehouse Worker',
      locationCity: 'San Francisco',
      locationState: 'CA',
      locationName: 'Main Warehouse',
      shiftDate: '2025-01-15',
      shiftTime: '9:00 AM',
      shiftEndTime: '5:00 PM',
      companyName: 'Acme Corporation',
      email: 'john.doe@example.com',
      phone: '+1 (555) 123-4567',
      applicationStatus: 'Screened',
      assignmentStatus: 'Assigned',
    };

    // Render locally from form data (no API calls for preview)
    // This works immediately and doesn't require the template to be saved
    const renderLocal = (template: string): string => {
      let rendered = template;
      Object.entries(sampleContext).forEach(([key, value]) => {
        rendered = rendered.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(value));
      });
      return rendered;
    };

    // Local rendering from form data
    if (templateForm.channel === 'email' && templateForm.htmlBody) {
      setPreviewText(renderLocal(templateForm.htmlBody));
    } else {
      setPreviewText(renderLocal(templateForm.body || ''));
    }
  };

  useEffect(() => {
    const timeout = setTimeout(() => {
      updatePreview();
    }, 500);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateForm.body, templateForm.htmlBody, templateForm.subject, templateForm.messageTypeId]);

  const handleSaveTemplate = async () => {
    if (!templateForm.name || !templateForm.messageTypeId) {
      setError('Name and message type are required');
      return;
    }

    if (!templateForm.body && !templateForm.htmlBody) {
      setError('Template body is required');
      return;
    }

    if (templateForm.channel === 'email' && !templateForm.subject) {
      setError('Subject is required for email templates');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Extract variables from body, htmlBody, and subject
      const allText = [
        templateForm.body,
        templateForm.htmlBody,
        templateForm.subject,
      ].filter(Boolean).join(' ');
      const variables = extractVariables(allText);

      const templateData: Omit<UnifiedMessageTemplate, 'id' | 'createdAt' | 'updatedAt' | 'version' | 'createdBy'> = {
        messageTypeId: templateForm.messageTypeId,
        channel: templateForm.channel || channelTab,
        language: templateForm.language || 'en',
        name: templateForm.name,
        body: templateForm.body || templateForm.htmlBody || '',
        subject: templateForm.subject,
        htmlBody: templateForm.htmlBody,
        variables,
        includeStopFooter: templateForm.includeStopFooter || false,
        active: templateForm.active !== false,
      };

      if (editingTemplate) {
        await updateTemplate(tenantId, editingTemplate.id!, {
          ...templateData,
          createdBy: editingTemplate.createdBy,
        });
        setSuccess(true);
      } else {
        await createTemplate({
          ...templateData,
          tenantId,
          createdBy: user?.uid || 'system',
        });
        setSuccess(true);
      }
      handleCloseTemplateDialog();
      loadTemplates();
    } catch (err: any) {
      setError(err.message || 'Failed to save template');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteTemplate = async (templateId: string) => {
    if (!confirm('Are you sure you want to delete this template?')) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await deleteTemplate(tenantId, templateId);
      setSuccess(true);
      loadTemplates();
    } catch (err: any) {
      setError(err.message || 'Failed to delete template');
    } finally {
      setLoading(false);
    }
  };

  const handleToggleTemplate = async (template: UnifiedMessageTemplate) => {
    setLoading(true);
    setError(null);

    try {
      await updateTemplate(tenantId, template.id!, {
        active: !template.active,
      });
      loadTemplates();
    } catch (err: any) {
      setError(err.message || 'Failed to update template');
    } finally {
      setLoading(false);
    }
  };

  const handleDuplicateTemplate = async (template: UnifiedMessageTemplate) => {
    try {
      const duplicatedTemplate: Omit<UnifiedMessageTemplate, 'id' | 'createdAt' | 'updatedAt' | 'version' | 'createdBy'> = {
        messageTypeId: template.messageTypeId,
        channel: template.channel,
        language: template.language,
        name: `${template.name} (Copy)`,
        body: template.body,
        subject: template.subject,
        htmlBody: template.htmlBody,
        variables: template.variables,
        includeStopFooter: template.includeStopFooter,
        active: false, // Start as inactive so user can review
      };

      await createTemplate({
        ...duplicatedTemplate,
        tenantId,
        createdBy: user?.uid || 'system',
      });
      setSuccess(true);
      loadTemplates();
    } catch (err: any) {
      setError(err.message || 'Failed to duplicate template');
    }
  };

  const getMessageTypeLabel = (messageTypeId: string): string => {
    const type = messageTypes.find(t => t.id === messageTypeId);
    return type?.label || messageTypeId;
  };

  const handleTestSend = async () => {
    if (!selectedTestRecipient || !templateForm.messageTypeId) {
      setError('Please select a recipient');
      return;
    }

    // Warn if template is not saved yet
    if (!editingTemplate?.id) {
      const shouldContinue = window.confirm(
        'This template has not been saved yet. The test will use the template data from the form. Do you want to continue?'
      );
      if (!shouldContinue) {
        return;
      }
    }

    setTestSending(true);
    setTestSendResult(null);
    setError(null);

    try {
      // Build context with sample data
      const sampleContext: Record<string, any> = {
        firstName: 'John',
        lastName: 'Doe',
        fullName: 'John Doe',
        jobTitle: 'Warehouse Worker',
        locationCity: 'San Francisco',
        locationState: 'CA',
        locationName: 'Main Warehouse',
        shiftDate: '2025-01-15',
        shiftTime: '9:00 AM',
        shiftEndTime: '5:00 PM',
        companyName: 'Test Company',
        email: testRecipients.find(r => r.id === selectedTestRecipient)?.email || '',
        phone: testRecipients.find(r => r.id === selectedTestRecipient)?.phone || '',
      };

      const result = await sendTestMessage(
        tenantId,
        selectedTestRecipient,
        templateForm.messageTypeId,
        sampleContext,
        templateForm.channel ? [templateForm.channel] : undefined
      );

      if (result.success) {
        setTestSendResult({
          success: true,
          message: `Test message sent successfully via ${result.dispatchedChannels?.join(', ') || 'selected channel'}`,
        });
        setSuccess(true);
      } else {
        const errorMsg = result.warnings?.join(', ') || 'Failed to send test message. Please check that the template exists and is active.';
        setTestSendResult({
          success: false,
          message: errorMsg,
        });
        setError(errorMsg);
      }
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to send test message';
      setError(errorMessage);
      setTestSendResult({
        success: false,
        message: errorMessage.includes('index') 
          ? 'Template lookup failed. A Firestore index may need to be created. Check the console for details.'
          : errorMessage,
      });
    } finally {
      setTestSending(false);
    }
  };

  return (
    <Box sx={{ width: '100%', p: 0 }}>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Manage SMS and Email message templates and recruiter phone number assignments. Templates support variables like {'{firstName}'}, {'{jobTitle}'}, and {'{locationCity}'}.
      </Typography>

      {/* Main Section Selector - Using Button Group */}
      <Box sx={{ mb: 3 }}>
        <ButtonGroup variant="outlined" aria-label="main section selector">
          <Button
            variant={subTab === 0 ? 'contained' : 'outlined'}
            startIcon={<SmsIcon />}
            onClick={() => setSubTab(0)}
            sx={{ 
              textTransform: 'none',
              px: 3,
              ...(subTab === 0 && { 
                bgcolor: 'primary.main',
                color: 'white',
                '&:hover': { bgcolor: 'primary.dark' }
              })
            }}
          >
            Templates
          </Button>
          <Button
            variant={subTab === 1 ? 'contained' : 'outlined'}
            startIcon={<PhoneIcon />}
            onClick={() => setSubTab(1)}
            sx={{ 
              textTransform: 'none',
              px: 3,
              ...(subTab === 1 && { 
                bgcolor: 'primary.main',
                color: 'white',
                '&:hover': { bgcolor: 'primary.dark' }
              })
            }}
          >
            Recruiter Numbers
          </Button>
        </ButtonGroup>
      </Box>

      {/* Templates Tab */}
      {subTab === 0 && (
        <Box>
          {/* Channel Selector - Using Toggle Buttons */}
          <Box sx={{ mb: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <ToggleButtonGroup
              value={channelTab}
              exclusive
              onChange={(e, newValue) => {
                if (newValue !== null) {
                  setChannelTab(newValue as Channel);
                }
              }}
              aria-label="channel selector"
              sx={{ height: 40 }}
            >
              <ToggleButton value="sms" aria-label="SMS templates">
                <SmsIcon sx={{ mr: 1 }} />
                SMS Templates
              </ToggleButton>
              <ToggleButton value="email" aria-label="Email templates">
                <EmailIcon sx={{ mr: 1 }} />
                Email Templates
              </ToggleButton>
            </ToggleButtonGroup>
            
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => handleOpenTemplateDialog()}
            >
              Create Template
            </Button>
          </Box>

          <Box sx={{ mb: 2 }}>
            <Typography variant="h6" sx={{ mb: 1 }}>
              {channelTab === 'sms' ? 'SMS' : 'Email'} Templates
            </Typography>
          </Box>

          {loading && templates.length === 0 ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
              <CircularProgress />
            </Box>
          ) : templates.length === 0 ? (
            <Alert severity="info">
              No {channelTab === 'sms' ? 'SMS' : 'email'} templates found. Create your first template to get started.
            </Alert>
          ) : (
            <TableContainer 
              component={Paper} 
              variant="outlined"
              sx={{ overflowX: 'auto' }}
            >
              <Table size="small" sx={{ '& .MuiTableCell-root': { py: 1 } }}>
                <TableHead>
                  <TableRow>
                    <TableCell>Name</TableCell>
                    <TableCell>Message Type</TableCell>
                    <TableCell>Language</TableCell>
                    <TableCell>Preview</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell align="right">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {templates.map((template) => (
                    <TableRow key={template.id}>
                      <TableCell>
                        <Typography variant="body2" fontWeight={500}>
                          {template.name}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Chip 
                          label={getMessageTypeLabel(template.messageTypeId)} 
                          size="small" 
                          variant="outlined"
                        />
                      </TableCell>
                      <TableCell>
                        <Chip label={template.language.toUpperCase()} size="small" />
                      </TableCell>
                      <TableCell>
                        <Tooltip title={template.body || template.htmlBody || ''}>
                          <Typography
                            variant="body2"
                            sx={{
                              maxWidth: 300,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {template.channel === 'email' && template.subject ? (
                              <strong>{template.subject}</strong>
                            ) : (
                              (template.body || template.htmlBody || '').substring(0, 60)
                            )}
                            ...
                          </Typography>
                        </Tooltip>
                      </TableCell>
                      <TableCell>
                        <FormControlLabel
                          control={
                            <Switch
                              checked={template.active}
                              onChange={() => handleToggleTemplate(template)}
                              size="small"
                            />
                          }
                          label={template.active ? 'Active' : 'Inactive'}
                        />
                      </TableCell>
                      <TableCell align="right">
                        <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                          <Tooltip title="Edit">
                            <IconButton
                              size="small"
                              onClick={() => handleOpenTemplateDialog(template)}
                            >
                              <EditIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Duplicate">
                            <IconButton
                              size="small"
                              onClick={() => handleDuplicateTemplate(template)}
                            >
                              <ContentCopyIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Delete">
                            <IconButton
                              size="small"
                              color="error"
                              onClick={() => handleDeleteTemplate(template.id!)}
                            >
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </Stack>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Box>
      )}

      {/* Recruiter Numbers Tab */}
      {subTab === 1 && (
        <RecruiterNumbersTab tenantId={tenantId} />
      )}

      {/* Template Dialog */}
      <Dialog
        open={templateDialogOpen}
        onClose={handleCloseTemplateDialog}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          {editingTemplate ? 'Edit Template' : 'Create Template'}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={3} sx={{ mt: 1 }}>
            <TextField
              label="Template Name"
              value={templateForm.name}
              onChange={(e) => setTemplateForm({ ...templateForm, name: e.target.value })}
              fullWidth
              required
            />

            <FormControl fullWidth required>
              <InputLabel>Message Type</InputLabel>
              <Select
                value={templateForm.messageTypeId}
                label="Message Type"
                onChange={(e) => setTemplateForm({ ...templateForm, messageTypeId: e.target.value })}
              >
                {(() => {
                  // Group message types by category
                  const grouped = messageTypes.reduce((acc, type) => {
                    if (!acc[type.category]) {
                      acc[type.category] = [];
                    }
                    acc[type.category].push(type);
                    return acc;
                  }, {} as Record<string, MessageTypeConfig[]>);

                  const categoryOrder = ['system', 'transactional', 'compliance', 'engagement', 'chat', 'marketing'];
                  const categoryLabels: Record<string, string> = {
                    system: 'System',
                    transactional: 'Transactional',
                    compliance: 'Compliance',
                    engagement: 'Engagement',
                    chat: 'Chat',
                    marketing: 'Marketing',
                  };

                  return categoryOrder.map(category => {
                    const types = grouped[category] || [];
                    if (types.length === 0) return null;
                    
                    return [
                      <MenuItem key={`category-${category}`} disabled sx={{ fontWeight: 600 }}>
                        {categoryLabels[category] || category}
                      </MenuItem>,
                      ...types.map((type) => (
                        <MenuItem key={type.id} value={type.id} sx={{ pl: 3 }}>
                    <Box>
                            <Typography variant="body2">{type.label}</Typography>
                            {type.description && (
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                                {type.description}
                      </Typography>
                            )}
                    </Box>
                  </MenuItem>
                      )),
                    ];
                  }).flat().filter(Boolean);
                })()}
              </Select>
            </FormControl>

            <Grid container spacing={2}>
              <Grid item xs={6}>
              <FormControl fullWidth>
                  <InputLabel>Channel</InputLabel>
                    <Select
                    value={templateForm.channel || channelTab}
                    label="Channel"
                    onChange={(e) => setTemplateForm({ ...templateForm, channel: e.target.value as Channel })}
                  >
                    <MenuItem value="sms">SMS</MenuItem>
                    <MenuItem value="email">Email</MenuItem>
                    </Select>
                </FormControl>
              </Grid>
              <Grid item xs={6}>
                <FormControl fullWidth>
                  <InputLabel>Language</InputLabel>
                  <Select
                    value={templateForm.language || 'en'}
                    label="Language"
                    onChange={(e) => setTemplateForm({ ...templateForm, language: e.target.value as LanguageCode })}
                  >
                    <MenuItem value="en">English</MenuItem>
                    <MenuItem value="es">Spanish</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
            </Grid>

            {/* Email Subject Field */}
            {templateForm.channel === 'email' && (
                  <TextField
                label="Email Subject"
                value={templateForm.subject || ''}
                onChange={(e) => setTemplateForm({ ...templateForm, subject: e.target.value })}
                    fullWidth
                required
                helperText="Subject line for the email"
              />
            )}

            {/* Template Body */}
            {templateForm.channel === 'email' ? (
              /* Email HTML Body with Rich Text Editor */
              <Box>
                <Typography variant="subtitle2" gutterBottom>
                  Email Body
                </Typography>
                <EmailTemplateEditor
                  key={`email-editor-${editingTemplate?.id || 'new'}-${templateForm.htmlBody?.substring(0, 50) || ''}`}
                  htmlBody={templateForm.htmlBody || templateForm.body || ''}
                  onChange={(newHtmlBody) => {
                    setTemplateForm({ ...templateForm, htmlBody: newHtmlBody, body: newHtmlBody });
                    // Auto-extract variables
                    const allText = [newHtmlBody, templateForm.subject].filter(Boolean).join(' ');
                    setTemplateForm(prev => ({ ...prev, variables: extractVariables(allText) }));
                  }}
                  variables={templateForm.variables || []}
                  onVariablesChange={(variables) => {
                    setTemplateForm(prev => ({ ...prev, variables }));
                  }}
                  availableVariables={[
                    'firstName',
                    'lastName',
                    'fullName',
                    'email',
                    'phone',
                    'jobTitle',
                    'locationCity',
                    'locationState',
                    'locationName',
                    'shiftDate',
                    'shiftTime',
                    'shiftEndTime',
                    'companyName',
                    'applicationStatus',
                    'assignmentStatus',
                  ]}
                  onVariableInsert={(variable) => {
                    // Variable inserted, variables already updated via onChange
                  }}
                />
              </Box>
            ) : (
              /* SMS Template Body */
            <TextField
              label="Message Template"
                value={templateForm.body}
                onChange={(e) => {
                  const newBody = e.target.value;
                  setTemplateForm({ ...templateForm, body: newBody });
                  // Auto-extract variables
                  const allText = [newBody, templateForm.subject].filter(Boolean).join(' ');
                  setTemplateForm(prev => ({ ...prev, variables: extractVariables(allText) }));
                }}
              fullWidth
              required
              multiline
              rows={4}
                helperText="Use variables like {{firstName}}, {{jobTitle}}, {{locationCity}}, etc."
                placeholder="Hi {{firstName}}. Thank you for applying to be a {{jobTitle}} in {{locationCity}}."
            />
            )}

            {/* Variables Display */}
            {templateForm.variables && templateForm.variables.length > 0 && (
              <Box>
                <Typography variant="subtitle2" gutterBottom>
                  Detected Variables:
                </Typography>
                <Stack direction="row" spacing={1} flexWrap="wrap" gap={1}>
                  {templateForm.variables.map((variable) => (
                    <Chip
                      key={variable}
                      label={`{{${variable}}}`}
                      size="small"
                      variant="outlined"
                    />
                  ))}
                </Stack>
              </Box>
            )}

            {/* Enhanced Preview */}
            {previewText && (
              <Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                  <Typography variant="subtitle2" fontWeight={600}>
                    Preview
                  </Typography>
                  {templateForm.channel === 'email' && (
                    <Stack direction="row" spacing={1}>
                      <Button
                        size="small"
                        variant={previewMode === 'desktop' ? 'contained' : 'outlined'}
                        startIcon={<ComputerIcon />}
                        onClick={() => setPreviewMode('desktop')}
                      >
                        Desktop
                      </Button>
                      <Button
                        size="small"
                        variant={previewMode === 'mobile' ? 'contained' : 'outlined'}
                        startIcon={<PhoneAndroidIcon />}
                        onClick={() => setPreviewMode('mobile')}
                      >
                        Mobile
                      </Button>
                    </Stack>
                  )}
                </Box>
                <Paper 
                  variant="outlined" 
                  sx={{ 
                    p: 2, 
                    bgcolor: 'grey.50',
                    maxWidth: previewMode === 'mobile' ? '375px' : '100%',
                    mx: previewMode === 'mobile' ? 'auto' : 0,
                    border: previewMode === 'mobile' ? '2px solid #1976d2' : '1px solid #e0e0e0',
                  }}
                >
                  {templateForm.channel === 'email' && templateForm.subject && (
                    <Box sx={{ mb: 2, pb: 1, borderBottom: '1px solid #e0e0e0' }}>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                        Subject:
                      </Typography>
                      <Typography variant="subtitle1" fontWeight={600}>
                        {templateForm.subject}
                      </Typography>
                    </Box>
                  )}
                  <Box
                    sx={{
                      '& *': {
                        maxWidth: '100%',
                      },
                    }}
                    dangerouslySetInnerHTML={
                      templateForm.channel === 'email' && templateForm.htmlBody 
                        ? { __html: previewText } 
                        : undefined
                    }
                  >
                    {templateForm.channel !== 'email' || !templateForm.htmlBody ? (
                      <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                        {previewText}
                      </Typography>
                    ) : null}
                  </Box>
                </Paper>
              </Box>
            )}

            {/* Include STOP Footer (SMS only) */}
            {templateForm.channel === 'sms' && (
            <FormControlLabel
              control={
                <Switch
                    checked={templateForm.includeStopFooter ?? false}
                  onChange={(e) =>
                      setTemplateForm({ ...templateForm, includeStopFooter: e.target.checked })
                    }
                  />
                }
                label="Include STOP/HELP footer"
              />
            )}

            <FormControlLabel
              control={
                <Switch
                  checked={templateForm.active ?? true}
                  onChange={(e) =>
                    setTemplateForm({ ...templateForm, active: e.target.checked })
                  }
                />
              }
              label="Active"
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ gap: 1, justifyContent: 'space-between' }}>
          <Button onClick={handleCloseTemplateDialog}>Cancel</Button>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button
              onClick={() => {
                // Load recipients when opening test dialog
                if (testRecipients.length === 0) {
                  loadTestRecipients();
                }
                setTestSendDialogOpen(true);
              }}
              variant="outlined"
              disabled={
                !templateForm.messageTypeId ||
                (!templateForm.body && !templateForm.htmlBody) ||
                (templateForm.channel === 'email' && !templateForm.subject)
              }
              sx={{ minWidth: 120 }}
            >
              Send Test
            </Button>
          <Button
            onClick={handleSaveTemplate}
            variant="contained"
              disabled={
                loading ||
                !templateForm.name ||
                !templateForm.messageTypeId ||
                (!templateForm.body && !templateForm.htmlBody) ||
                (templateForm.channel === 'email' && !templateForm.subject)
              }
          >
            {loading ? <CircularProgress size={20} /> : editingTemplate ? 'Update' : 'Create'}
          </Button>
          </Box>
        </DialogActions>
      </Dialog>

      <Snackbar open={!!error} autoHideDuration={4000} onClose={() => setError(null)}>
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      </Snackbar>

      <Snackbar open={success} autoHideDuration={2000} onClose={() => setSuccess(false)}>
        <Alert severity="success" onClose={() => setSuccess(false)}>
          Template {editingTemplate ? 'updated' : 'created'} successfully!
        </Alert>
      </Snackbar>

      {/* Test Send Dialog */}
      <Dialog
        open={testSendDialogOpen}
        onClose={() => {
          setTestSendDialogOpen(false);
          setSelectedTestRecipient('');
          setTestSendResult(null);
        }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Send Test Message</DialogTitle>
        <DialogContent>
          <Stack spacing={3} sx={{ mt: 1 }}>
            <Alert severity="info">
              Send a test message to verify your template. The message will use sample data for variables.
            </Alert>

            <Autocomplete
              options={testRecipients}
              getOptionLabel={(option) => option.name || 'Unknown'}
              value={testRecipients.find(r => r.id === selectedTestRecipient) || null}
              onChange={(_, newValue) => setSelectedTestRecipient(newValue?.id || '')}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Recipient *"
                  placeholder="Search by name, email, or phone..."
                  required
                />
              )}
              renderOption={(props, option) => (
                <Box component="li" {...props} key={option.id}>
                  <Box sx={{ width: '100%' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                      <Typography variant="body2" component="span">
                        {option.name}
                      </Typography>
                      {option.securityLevelLabel && (
                        <Chip
                          label={option.securityLevelLabel}
                          size="small"
                          sx={{ height: 20, fontSize: '0.7rem' }}
                        />
                      )}
                    </Box>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                      {option.email && option.phone
                        ? `${option.email} • ${option.phone}`
                        : option.email || option.phone}
                    </Typography>
                  </Box>
                </Box>
              )}
              filterOptions={(options, { inputValue }) => {
                const searchTerm = inputValue.toLowerCase();
                return options.filter(option =>
                  option.name.toLowerCase().includes(searchTerm) ||
                  option.email?.toLowerCase().includes(searchTerm) ||
                  option.phone?.includes(searchTerm) ||
                  option.securityLevelLabel?.toLowerCase().includes(searchTerm)
                );
              }}
              noOptionsText={testRecipients.length === 0 ? "No recipients found. Users must have an email or phone number." : "No matching recipients"}
              loading={testRecipients.length === 0}
            />

            {templateForm.channel && (
              <Box>
                <Typography variant="subtitle2" gutterBottom>
                  Channel
                </Typography>
                <Chip
                  label={templateForm.channel.toUpperCase()}
                  size="small"
                  color="primary"
                  variant="outlined"
                />
              </Box>
            )}

            {testSendResult && (
              <Alert severity={testSendResult.success ? 'success' : 'error'}>
                {testSendResult.message}
              </Alert>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setTestSendDialogOpen(false);
              setSelectedTestRecipient('');
              setTestSendResult(null);
            }}
          >
            Close
          </Button>
          <Button
            onClick={handleTestSend}
            variant="contained"
            disabled={testSending || !selectedTestRecipient || testRecipients.length === 0}
          >
            {testSending ? <CircularProgress size={20} /> : 'Send Test Message'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

/**
 * Recruiter Numbers Tab Component
 */
interface RecruiterNumbersTabProps {
  tenantId: string;
}

interface RecruiterNumberAssignment {
  recruiterId: string;
  recruiterName: string;
  twilioNumber?: string;
  useMainNumber: boolean;
}

const RecruiterNumbersTab: React.FC<RecruiterNumbersTabProps> = ({ tenantId }) => {
  const { user } = useAuth();
  const [assignments, setAssignments] = useState<RecruiterNumberAssignment[]>([]);
  const [availableNumbers, setAvailableNumbers] = useState<Array<{ phoneNumber: string; sid: string; friendlyName: string }>>([]);
  const [recruiters, setRecruiters] = useState<Array<{ id: string; name: string; email: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [purchaseDialogOpen, setPurchaseDialogOpen] = useState(false);
  const [selectedRecruiterId, setSelectedRecruiterId] = useState('');
  const [selectedNumberSid, setSelectedNumberSid] = useState('');
  const [searchAreaCode, setSearchAreaCode] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{ phoneNumber: string; friendlyName: string; locality?: string; region?: string; capabilities: { voice: boolean; sms: boolean; mms: boolean } }>>([]);
  const [searching, setSearching] = useState(false);

  // Firebase functions
  const getRecruiterNumbersFn = httpsCallable(functions, 'getRecruiterNumbers');
  const getAvailableTwilioNumbersFn = httpsCallable(functions, 'getAvailableTwilioNumbers');
  const searchAvailableTwilioNumbersFn = httpsCallable(functions, 'searchAvailableTwilioNumbers');
  const purchaseTwilioNumberFn = httpsCallable(functions, 'purchaseTwilioNumber');
  const assignRecruiterNumberFn = httpsCallable(functions, 'assignRecruiterNumber');
  const releaseRecruiterNumberFn = httpsCallable(functions, 'releaseRecruiterNumber');

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      // Load assignments
      const assignmentsResult = await getRecruiterNumbersFn({ tenantId });
      const assignmentsData = assignmentsResult.data as { success: boolean; assignments: any[] };
      if (assignmentsData.success) {
        setAssignments(assignmentsData.assignments);
      }

      // Load available numbers
      const numbersResult = await getAvailableTwilioNumbersFn({});
      const numbersData = numbersResult.data as { success: boolean; available: any[] };
      if (numbersData.success) {
        setAvailableNumbers(numbersData.available);
      }

      // Load recruiters: must have tenant ID, security level 5-7, and recruiter: true
      // Get all users and filter client-side to avoid index requirements
      const allUsersQuery = query(
        collection(db, 'users'),
        limit(500)
      );
      const allUsersSnapshot = await getDocs(allUsersQuery);
      
      console.log(`Loading recruiters for tenant ${tenantId}, total users: ${allUsersSnapshot.docs.length}`);
      
      // Filter to recruiters with:
      // 1. User has this tenant ID
      // 2. Security level 5-7 (check both root and tenant-specific)
      // 3. recruiter: true
      const recruitersList = allUsersSnapshot.docs
        .filter(doc => {
          const data = doc.data();
          
          // Check if user has access to this tenant
          const hasTenantAccess = 
            data.tenantId === tenantId ||
            data.activeTenantId === tenantId ||
            (data.tenantIds && (
              (Array.isArray(data.tenantIds) && data.tenantIds.includes(tenantId)) ||
              (typeof data.tenantIds === 'object' && tenantId in data.tenantIds)
            ));
          
          if (!hasTenantAccess) {
            return false;
          }
          
          // Check security level (5-7)
          const rootSecurityLevel = parseInt(data.securityLevel || '0');
          const tenantSecurityLevel = data.tenantIds?.[tenantId]?.securityLevel 
            ? parseInt(String(data.tenantIds[tenantId].securityLevel)) 
            : null;
          
          // Include if security level is between 5-7 (either root or tenant-specific)
          const effectiveSecurityLevel = tenantSecurityLevel !== null ? tenantSecurityLevel : rootSecurityLevel;
          const hasValidSecurityLevel = effectiveSecurityLevel >= 5 && effectiveSecurityLevel <= 7;
          
          if (!hasValidSecurityLevel) {
            console.log(`User ${data.email} filtered out: security level ${effectiveSecurityLevel} not in range 5-7`);
            return false;
          }
          
          // Check recruiter flag - must be explicitly true
          // But also check if recruiter field might be stored as string 'true' or boolean true
          const isRecruiter = data.recruiter === true || data.recruiter === 'true';
          
          if (!isRecruiter) {
            console.log(`User ${data.email} filtered out: recruiter flag is ${data.recruiter} (expected true)`);
            return false;
          }
          
          return true;
        })
        .map(doc => {
          const data = doc.data();
          return {
            id: doc.id,
            name: `${data.firstName || ''} ${data.lastName || ''}`.trim() || data.email,
            email: data.email,
          };
        });
      
      console.log(`Found ${recruitersList.length} recruiters for tenant ${tenantId}:`, recruitersList.map(r => `${r.name} (${r.email})`));
      setRecruiters(recruitersList);
    } catch (err: any) {
      setError(err.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const handleAssignNumber = async () => {
    if (!selectedRecruiterId) {
      setError('Please select a recruiter');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await assignRecruiterNumberFn({
        tenantId,
        recruiterId: selectedRecruiterId,
        twilioNumberSid: selectedNumberSid || undefined,
      });
      setSuccess(true);
      setAssignDialogOpen(false);
      setSelectedRecruiterId('');
      setSelectedNumberSid('');
      loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to assign number');
    } finally {
      setLoading(false);
    }
  };

  const handleReleaseNumber = async (recruiterId: string) => {
    if (!confirm('Are you sure you want to release this number?')) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await releaseRecruiterNumberFn({ tenantId, recruiterId });
      setSuccess(true);
      loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to release number');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6">Recruiter Phone Numbers</Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button
            variant="outlined"
            startIcon={<PhoneIcon />}
            onClick={() => setPurchaseDialogOpen(true)}
          >
            Search & Purchase
          </Button>
          <Button
            variant="contained"
            startIcon={<PhoneIcon />}
            onClick={() => setAssignDialogOpen(true)}
          >
            Assign Number
          </Button>
        </Box>
      </Box>

      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Assign dedicated Twilio phone numbers to recruiters for direct SMS messaging. Each recruiter can have their own number for two-way conversations with applicants.
      </Typography>

      {loading && assignments.length === 0 ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
          <CircularProgress />
        </Box>
      ) : assignments.length === 0 ? (
        <Alert severity="info">No number assignments found. Assign a number to get started.</Alert>
      ) : (
        <TableContainer 
          component={Paper} 
          variant="outlined"
          sx={{ overflowX: 'auto' }}
        >
          <Table size="small" sx={{ '& .MuiTableCell-root': { py: 1 } }}>
            <TableHead>
              <TableRow>
                <TableCell>Recruiter</TableCell>
                <TableCell>Phone Number</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {assignments.map((assignment) => (
                <TableRow key={assignment.recruiterId}>
                  <TableCell>
                    <Typography variant="body2" fontWeight={500}>
                      {assignment.recruiterName}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    {assignment.useMainNumber ? (
                      <Chip label="Using Main Number" size="small" color="default" />
                    ) : assignment.twilioNumber ? (
                      <Typography variant="body2">{assignment.twilioNumber}</Typography>
                    ) : (
                      <Typography variant="body2" color="text.secondary">Not assigned</Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={assignment.useMainNumber || assignment.twilioNumber ? 'Active' : 'Not Assigned'}
                      size="small"
                      color={assignment.useMainNumber || assignment.twilioNumber ? 'success' : 'default'}
                    />
                  </TableCell>
                  <TableCell align="right">
                    {!assignment.useMainNumber && assignment.twilioNumber && (
                      <IconButton
                        size="small"
                        color="error"
                        onClick={() => handleReleaseNumber(assignment.recruiterId)}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Assign Number Dialog */}
      <Dialog open={assignDialogOpen} onClose={() => setAssignDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Assign Phone Number</DialogTitle>
        <DialogContent>
          <Stack spacing={3} sx={{ mt: 1 }}>
            <FormControl fullWidth>
              <InputLabel>Recruiter</InputLabel>
              <Select
                value={selectedRecruiterId}
                label="Recruiter"
                onChange={(e) => setSelectedRecruiterId(e.target.value)}
              >
                {recruiters.map((recruiter) => (
                  <MenuItem key={recruiter.id} value={recruiter.id}>
                    {recruiter.name} ({recruiter.email})
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl fullWidth>
              <InputLabel>Phone Number</InputLabel>
              <Select
                value={selectedNumberSid}
                label="Phone Number"
                onChange={(e) => setSelectedNumberSid(e.target.value)}
              >
                <MenuItem value="">Use Main Number</MenuItem>
                {availableNumbers.map((number) => (
                  <MenuItem key={number.sid} value={number.sid}>
                    {number.friendlyName} ({number.phoneNumber})
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            {availableNumbers.length === 0 && (
              <Alert severity="warning">
                No available numbers found. <Link href="#" onClick={(e) => { e.preventDefault(); setPurchaseDialogOpen(true); setAssignDialogOpen(false); }}>Search & Purchase Numbers</Link> or use the main number.
              </Alert>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAssignDialogOpen(false)}>Cancel</Button>
          <Button
            onClick={handleAssignNumber}
            variant="contained"
            disabled={loading || !selectedRecruiterId}
          >
            {loading ? <CircularProgress size={20} /> : 'Assign'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Purchase Number Dialog */}
      <Dialog open={purchaseDialogOpen} onClose={() => { setPurchaseDialogOpen(false); setSearchResults([]); setSearchAreaCode(''); }} maxWidth="md" fullWidth>
        <DialogTitle>Search & Purchase Phone Number</DialogTitle>
        <DialogContent>
          <Stack spacing={3} sx={{ mt: 1 }}>
            <Alert severity="info">
              Search for available phone numbers to purchase from Twilio. Numbers cost approximately $1/month plus per-message fees.
            </Alert>

            <Grid container spacing={2}>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  label="Area Code (Optional)"
                  placeholder="e.g., 415"
                  value={searchAreaCode}
                  onChange={(e) => setSearchAreaCode(e.target.value.replace(/\D/g, '').slice(0, 3))}
                  helperText="Leave empty to search all US numbers"
                  inputProps={{ maxLength: 3, pattern: '[0-9]*' }}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <Button
                  fullWidth
                  variant="contained"
                  onClick={async () => {
                    setSearching(true);
                    setError(null);
                    try {
                      const result = await searchAvailableTwilioNumbersFn({
                        areaCode: searchAreaCode || undefined,
                        country: 'US',
                        limit: 20,
                      });
                      const data = result.data as { success: boolean; numbers: any[] };
                      if (data.success) {
                        setSearchResults(data.numbers);
                      }
                    } catch (err: any) {
                      setError(err.message || 'Failed to search numbers');
                    } finally {
                      setSearching(false);
                    }
                  }}
                  disabled={searching}
                  sx={{ height: '56px' }}
                >
                  {searching ? <CircularProgress size={20} /> : 'Search Numbers'}
                </Button>
              </Grid>
            </Grid>

            {searchResults.length > 0 && (
              <Box>
                <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
                  Available Numbers ({searchResults.length})
                </Typography>
                <TableContainer 
                  component={Paper} 
                  variant="outlined"
                  sx={{ overflowX: 'auto' }}
                >
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Phone Number</TableCell>
                        <TableCell>Location</TableCell>
                        <TableCell>Capabilities</TableCell>
                        <TableCell align="right">Action</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {searchResults.map((number) => (
                        <TableRow key={number.phoneNumber}>
                          <TableCell>
                            <Typography variant="body2" fontWeight={500}>
                              {number.phoneNumber}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            {number.locality && number.region ? (
                              <Typography variant="body2" color="text.secondary">
                                {number.locality}, {number.region}
                              </Typography>
                            ) : (
                              <Typography variant="body2" color="text.secondary">
                                -
                              </Typography>
                            )}
                          </TableCell>
                          <TableCell>
                            <Box sx={{ display: 'flex', gap: 0.5 }}>
                              {number.capabilities.sms && (
                                <Chip label="SMS" size="small" color="primary" variant="outlined" />
                              )}
                              {number.capabilities.voice && (
                                <Chip label="Voice" size="small" color="secondary" variant="outlined" />
                              )}
                              {number.capabilities.mms && (
                                <Chip label="MMS" size="small" color="success" variant="outlined" />
                              )}
                            </Box>
                          </TableCell>
                          <TableCell align="right">
                            <Button
                              size="small"
                              variant="contained"
                              onClick={async () => {
                                setLoading(true);
                                setError(null);
                                try {
                                  await purchaseTwilioNumberFn({ phoneNumber: number.phoneNumber });
                                  setSuccess(true);
                                  setPurchaseDialogOpen(false);
                                  setSearchResults([]);
                                  setSearchAreaCode('');
                                  loadData(); // Reload to show new number
                                } catch (err: any) {
                                  setError(err.message || 'Failed to purchase number');
                                } finally {
                                  setLoading(false);
                                }
                              }}
                              disabled={loading}
                            >
                              {loading ? <CircularProgress size={16} /> : 'Purchase'}
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Box>
            )}

            {searchResults.length === 0 && !searching && (
              <Alert severity="info">
                Enter an area code (optional) and click "Search Numbers" to find available phone numbers.
              </Alert>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setPurchaseDialogOpen(false); setSearchResults([]); setSearchAreaCode(''); }}>
            Close
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default MessagingTab;
