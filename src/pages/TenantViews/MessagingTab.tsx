/**
 * Messaging Settings Tab
 * Manage SMS templates and recruiter phone numbers
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
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import PreviewIcon from '@mui/icons-material/Preview';
import PhoneIcon from '@mui/icons-material/Phone';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { collection, getDocs, query, where, limit } from 'firebase/firestore';
import { db } from '../../firebase';

interface MessagingTabProps {
  tenantId: string;
}

interface SmsTemplate {
  id: string;
  name: string;
  category: 'application' | 'assignment' | 'shift' | 'bulk' | 'semiAutomated' | 'fullyAutomated';
  triggerType?: 'applicationStatusChange' | 'applicationCreated' | 'assignmentCreated' | 'shiftCreated' | 'manual';
  triggerStatus?: string;
  messageTemplate: string;
  variables: string[];
  enabled: boolean;
}

const categoryLabels: Record<SmsTemplate['category'], string> = {
  application: 'Application',
  assignment: 'Assignment',
  shift: 'Shift',
  bulk: 'Bulk',
  semiAutomated: 'Semi-Automated',
  fullyAutomated: 'Fully-Automated',
};

const triggerTypeLabels: Record<string, string> = {
  applicationStatusChange: 'Application Status Change',
  applicationCreated: 'Application Created',
  assignmentCreated: 'Assignment Created',
  shiftCreated: 'Shift Created',
  manual: 'Manual',
};

const MessagingTab: React.FC<MessagingTabProps> = ({ tenantId }) => {
  const { user } = useAuth();
  const [subTab, setSubTab] = useState(0);
  const [templates, setTemplates] = useState<SmsTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  
  // Template dialog state
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<SmsTemplate | null>(null);
  const [templateForm, setTemplateForm] = useState<Partial<SmsTemplate>>({
    name: '',
    category: 'application',
    triggerType: 'manual',
    messageTemplate: '',
    enabled: true,
  });
  const [previewText, setPreviewText] = useState('');

  // Firebase functions
  const getSmsTemplatesFn = httpsCallable(functions, 'getSmsTemplates');
  const createSmsTemplateFn = httpsCallable(functions, 'createSmsTemplate');
  const updateSmsTemplateFn = httpsCallable(functions, 'updateSmsTemplate');
  const deleteSmsTemplateFn = httpsCallable(functions, 'deleteSmsTemplate');
  const previewSmsTemplateFn = httpsCallable(functions, 'previewSmsTemplate');

  useEffect(() => {
    loadTemplates();
  }, [tenantId]);

  const loadTemplates = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getSmsTemplatesFn({ tenantId });
      const data = result.data as { success: boolean; templates: SmsTemplate[] };
      if (data.success) {
        setTemplates(data.templates);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load templates');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenTemplateDialog = (template?: SmsTemplate) => {
    if (template) {
      setEditingTemplate(template);
      setTemplateForm({
        name: template.name,
        category: template.category,
        triggerType: template.triggerType,
        triggerStatus: template.triggerStatus,
        messageTemplate: template.messageTemplate,
        enabled: template.enabled,
      });
    } else {
      setEditingTemplate(null);
      setTemplateForm({
        name: '',
        category: 'application',
        triggerType: 'manual',
        messageTemplate: '',
        enabled: true,
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
      category: 'application',
      triggerType: 'manual',
      messageTemplate: '',
      enabled: true,
    });
    setPreviewText('');
  };

  const updatePreview = async () => {
    if (!templateForm.messageTemplate) {
      setPreviewText('');
      return;
    }

    try {
      const result = await previewSmsTemplateFn({
        template: templateForm.messageTemplate,
      });
      const data = result.data as { success: boolean; preview: string };
      if (data.success) {
        setPreviewText(data.preview);
      }
    } catch (err) {
      // Preview failed, show template as-is
      setPreviewText(templateForm.messageTemplate);
    }
  };

  useEffect(() => {
    const timeout = setTimeout(() => {
      updatePreview();
    }, 500);
    return () => clearTimeout(timeout);
  }, [templateForm.messageTemplate]);

  const handleSaveTemplate = async () => {
    if (!templateForm.name || !templateForm.messageTemplate) {
      setError('Name and message template are required');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      if (editingTemplate) {
        await updateSmsTemplateFn({
          tenantId,
          templateId: editingTemplate.id,
          updates: templateForm,
        });
        setSuccess(true);
      } else {
        await createSmsTemplateFn({
          tenantId,
          template: {
            ...templateForm,
            createdBy: user?.uid || '',
          },
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
      await deleteSmsTemplateFn({ tenantId, templateId });
      setSuccess(true);
      loadTemplates();
    } catch (err: any) {
      setError(err.message || 'Failed to delete template');
    } finally {
      setLoading(false);
    }
  };

  const handleToggleTemplate = async (template: SmsTemplate) => {
    setLoading(true);
    setError(null);

    try {
      await updateSmsTemplateFn({
        tenantId,
        templateId: template.id,
        updates: { enabled: !template.enabled },
      });
      loadTemplates();
    } catch (err: any) {
      setError(err.message || 'Failed to update template');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box sx={{ width: '100%', p: 0 }}>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Manage SMS message templates and recruiter phone number assignments. Templates support variables like {'{firstName}'}, {'{jobTitle}'}, and {'{locationCity}'}.
      </Typography>

      <Paper elevation={1} sx={{ mb: 3, borderRadius: 0 }}>
        <Tabs
          value={subTab}
          onChange={(e, newValue) => setSubTab(newValue)}
          indicatorColor="primary"
          textColor="primary"
          variant="scrollable"
          scrollButtons="auto"
        >
          <Tab label="SMS Templates" />
          <Tab label="Recruiter Numbers" />
        </Tabs>
      </Paper>

      {/* SMS Templates Tab */}
      {subTab === 0 && (
        <Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="h6">SMS Templates</Typography>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => handleOpenTemplateDialog()}
            >
              Create Template
            </Button>
          </Box>

          {loading && templates.length === 0 ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
              <CircularProgress />
            </Box>
          ) : templates.length === 0 ? (
            <Alert severity="info">No templates found. Create your first template to get started.</Alert>
          ) : (
            <TableContainer component={Paper} variant="outlined">
              <Table size="small" sx={{ '& .MuiTableCell-root': { py: 1 } }}>
                <TableHead>
                  <TableRow>
                    <TableCell>Name</TableCell>
                    <TableCell>Category</TableCell>
                    <TableCell>Trigger</TableCell>
                    <TableCell>Template Preview</TableCell>
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
                        <Chip label={categoryLabels[template.category]} size="small" />
                      </TableCell>
                      <TableCell>
                        {template.triggerType && (
                          <Typography variant="body2" color="text.secondary">
                            {triggerTypeLabels[template.triggerType]}
                            {template.triggerStatus && ` (${template.triggerStatus})`}
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell>
                        <Tooltip title={template.messageTemplate}>
                          <Typography
                            variant="body2"
                            sx={{
                              maxWidth: 300,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {template.messageTemplate.substring(0, 60)}...
                          </Typography>
                        </Tooltip>
                      </TableCell>
                      <TableCell>
                        <FormControlLabel
                          control={
                            <Switch
                              checked={template.enabled}
                              onChange={() => handleToggleTemplate(template)}
                              size="small"
                            />
                          }
                          label={template.enabled ? 'Enabled' : 'Disabled'}
                        />
                      </TableCell>
                      <TableCell align="right">
                        <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                          <Tooltip title="Preview">
                            <IconButton
                              size="small"
                              onClick={() => handleOpenTemplateDialog(template)}
                            >
                              <PreviewIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Edit">
                            <IconButton
                              size="small"
                              onClick={() => handleOpenTemplateDialog(template)}
                            >
                              <EditIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Delete">
                            <IconButton
                              size="small"
                              color="error"
                              onClick={() => handleDeleteTemplate(template.id)}
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

            <FormControl fullWidth>
              <InputLabel>Category</InputLabel>
              <Select
                value={templateForm.category}
                label="Category"
                onChange={(e) =>
                  setTemplateForm({ ...templateForm, category: e.target.value as SmsTemplate['category'] })
                }
              >
                {Object.entries(categoryLabels).map(([value, label]) => (
                  <MenuItem key={value} value={value}>
                    {label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl fullWidth>
              <InputLabel>Trigger Type</InputLabel>
              <Select
                value={templateForm.triggerType || 'manual'}
                label="Trigger Type"
                onChange={(e) =>
                  setTemplateForm({ ...templateForm, triggerType: e.target.value as any })
                }
              >
                {Object.entries(triggerTypeLabels).map(([value, label]) => (
                  <MenuItem key={value} value={value}>
                    {label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            {templateForm.triggerType === 'applicationStatusChange' && (
              <TextField
                label="Trigger Status"
                value={templateForm.triggerStatus || ''}
                onChange={(e) =>
                  setTemplateForm({ ...templateForm, triggerStatus: e.target.value })
                }
                fullWidth
                placeholder="e.g., screened, advanced, hired"
                helperText="Application status that triggers this template"
              />
            )}

            <TextField
              label="Message Template"
              value={templateForm.messageTemplate}
              onChange={(e) =>
                setTemplateForm({ ...templateForm, messageTemplate: e.target.value })
              }
              fullWidth
              required
              multiline
              rows={4}
              helperText="Use variables like {firstName}, {jobTitle}, {locationCity}, etc."
              placeholder="Hi {firstName}. Thank you for applying to be a {jobTitle} in {locationCity}."
            />

            {previewText && (
              <Box>
                <Typography variant="subtitle2" gutterBottom>
                  Preview:
                </Typography>
                <Paper variant="outlined" sx={{ p: 2, bgcolor: 'grey.50' }}>
                  <Typography variant="body2">{previewText}</Typography>
                </Paper>
              </Box>
            )}

            <FormControlLabel
              control={
                <Switch
                  checked={templateForm.enabled ?? true}
                  onChange={(e) =>
                    setTemplateForm({ ...templateForm, enabled: e.target.checked })
                  }
                />
              }
              label="Enabled"
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseTemplateDialog}>Cancel</Button>
          <Button
            onClick={handleSaveTemplate}
            variant="contained"
            disabled={loading || !templateForm.name || !templateForm.messageTemplate}
          >
            {loading ? <CircularProgress size={20} /> : editingTemplate ? 'Update' : 'Create'}
          </Button>
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
  const [selectedRecruiterId, setSelectedRecruiterId] = useState('');
  const [selectedNumberSid, setSelectedNumberSid] = useState('');

  // Firebase functions
  const getRecruiterNumbersFn = httpsCallable(functions, 'getRecruiterNumbers');
  const getAvailableTwilioNumbersFn = httpsCallable(functions, 'getAvailableTwilioNumbers');
  const assignRecruiterNumberFn = httpsCallable(functions, 'assignRecruiterNumber');
  const releaseRecruiterNumberFn = httpsCallable(functions, 'releaseRecruiterNumber');

  useEffect(() => {
    loadData();
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

      // Load recruiters (security level 5+)
      const recruitersQuery = query(
        collection(db, 'users'),
        where(`tenantIds.${tenantId}.securityLevel`, 'in', ['5', '6', '7']),
        limit(100)
      );
      const recruitersSnapshot = await getDocs(recruitersQuery);
      const recruitersList = recruitersSnapshot.docs.map(doc => ({
        id: doc.id,
        name: `${doc.data().firstName || ''} ${doc.data().lastName || ''}`.trim() || doc.data().email,
        email: doc.data().email,
      }));
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
        <Button
          variant="contained"
          startIcon={<PhoneIcon />}
          onClick={() => setAssignDialogOpen(true)}
        >
          Assign Number
        </Button>
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
        <TableContainer component={Paper} variant="outlined">
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
                No available numbers found. You may need to purchase additional numbers in Twilio, or use the main number.
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
    </Box>
  );
};

export default MessagingTab;

