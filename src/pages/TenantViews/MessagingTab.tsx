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
  FormHelperText,
  Grid,
  Link,
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
import { getAvailableTriggersForCategory, getTriggerDefinition } from '../../utils/smsTriggerRegistry';

interface MessagingTabProps {
  tenantId: string;
}

interface SmsTemplate {
  id: string;
  name: string;
  category: 'application' | 'assignment' | 'shift' | 'bulk' | 'semiAutomated' | 'fullyAutomated';
  triggerType?: string; // Flexible - registry handles validation
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

// Trigger labels now come from registry

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
                            {getTriggerDefinition(template.triggerType)?.label || template.triggerType}
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
                onChange={(e) => {
                  const triggerType = e.target.value;
                  const triggerDef = getTriggerDefinition(triggerType);
                  
                  setTemplateForm({ 
                    ...templateForm, 
                    triggerType,
                    // Clear triggerStatus if trigger doesn't require it
                    triggerStatus: triggerDef?.requiresStatus ? templateForm.triggerStatus : undefined
                  });
                }}
              >
                {getAvailableTriggersForCategory(templateForm.category).map((trigger) => (
                  <MenuItem key={trigger.id} value={trigger.id}>
                    <Box>
                      <Typography variant="body2">{trigger.label}</Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                        {trigger.description}
                      </Typography>
                    </Box>
                  </MenuItem>
                ))}
              </Select>
              {templateForm.triggerType && getTriggerDefinition(templateForm.triggerType) && (
                <FormHelperText>
                  {getTriggerDefinition(templateForm.triggerType)!.description}
                </FormHelperText>
              )}
            </FormControl>

            {/* Show status field only if trigger requires it */}
            {templateForm.triggerType && getTriggerDefinition(templateForm.triggerType)?.requiresStatus && (
              <FormControl fullWidth>
                {getTriggerDefinition(templateForm.triggerType)?.statusOptions ? (
                  <>
                    <InputLabel>Trigger Status</InputLabel>
                    <Select
                      label="Trigger Status"
                      value={templateForm.triggerStatus || ''}
                      onChange={(e) =>
                        setTemplateForm({ ...templateForm, triggerStatus: e.target.value })
                      }
                    >
                      {getTriggerDefinition(templateForm.triggerType)!.statusOptions!.map((status) => (
                        <MenuItem key={status} value={status}>
                          {status.charAt(0).toUpperCase() + status.slice(1)}
                        </MenuItem>
                      ))}
                    </Select>
                  </>
                ) : (
                  <TextField
                    label="Trigger Status"
                    value={templateForm.triggerStatus || ''}
                    onChange={(e) =>
                      setTemplateForm({ ...templateForm, triggerStatus: e.target.value })
                    }
                    fullWidth
                    placeholder={getTriggerDefinition(templateForm.triggerType)?.statusPlaceholder || 'e.g., screened, advanced, hired'}
                    helperText={getTriggerDefinition(templateForm.triggerType)?.statusPlaceholder || "Status value that triggers this template"}
                  />
                )}
              </FormControl>
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
                <TableContainer component={Paper} variant="outlined">
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

