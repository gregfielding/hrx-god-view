import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  TextField,
  Button,
  Grid,
  Card,
  CardContent,
  CardActions,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  IconButton,
  Chip,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Stack,
  Divider,
} from '@mui/material';
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  ContentCopy as DuplicateIcon,
  Visibility as ViewIcon,
} from '@mui/icons-material';
import { collection, addDoc, getDocs, query, where, orderBy, doc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';

import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';

interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  bodyHtml: string;
  ownerUid: string;
  visibility: 'private' | 'team' | 'company';
  tags?: string[];
  variables: string[];
  createdAt: Date;
  updatedAt: Date;
}

interface EmailTemplatesManagerProps {
  open: boolean;
  onClose: () => void;
  onSelectTemplate?: (template: EmailTemplate) => void;
  mode?: 'select' | 'manage';
}

const EmailTemplatesManager: React.FC<EmailTemplatesManagerProps> = ({
  open,
  onClose,
  onSelectTemplate,
  mode = 'manage'
}) => {
  const { tenantId, currentUser } = useAuth();
  const functions = getFunctions();

  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<EmailTemplate | null>(null);
  const [activeTab, setActiveTab] = useState(0);

  const [formData, setFormData] = useState({
    name: '',
    subject: '',
    bodyHtml: '',
    visibility: 'private' as 'private' | 'team' | 'company',
    tags: [] as string[],
  });

  useEffect(() => {
    if (open && tenantId) {
      loadTemplates();
    }
  }, [open, tenantId]);

  const loadTemplates = async () => {
    if (!tenantId) return;

    setLoading(true);
    try {
      const q = query(
        collection(db, 'tenants', tenantId, 'email_templates'),
        orderBy('createdAt', 'desc')
      );
      
      const snapshot = await getDocs(q);
      const loadedTemplates = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        createdAt: doc.data().createdAt?.toDate(),
        updatedAt: doc.data().updatedAt?.toDate(),
      })) as EmailTemplate[];
      
      setTemplates(loadedTemplates);
    } catch (error) {
      console.error('Error loading templates:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveTemplate = async () => {
    if (!tenantId || !currentUser) return;

    try {
      const templateData = {
        ...formData,
        ownerUid: currentUser.uid,
        variables: extractVariables(formData.bodyHtml),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      if (editingTemplate) {
        await updateDoc(
          doc(db, 'tenants', tenantId, 'email_templates', editingTemplate.id),
          {
            ...templateData,
            updatedAt: serverTimestamp(),
          }
        );
      } else {
        await addDoc(
          collection(db, 'tenants', tenantId, 'email_templates'),
          templateData
        );
      }

      setShowAddDialog(false);
      setEditingTemplate(null);
      resetForm();
      loadTemplates();
    } catch (error) {
      console.error('Error saving template:', error);
    }
  };

  const handleDeleteTemplate = async (templateId: string) => {
    if (!tenantId) return;

    try {
      await deleteDoc(doc(db, 'tenants', tenantId, 'email_templates', templateId));
      loadTemplates();
    } catch (error) {
      console.error('Error deleting template:', error);
    }
  };

  const handleEditTemplate = (template: EmailTemplate) => {
    setEditingTemplate(template);
    setFormData({
      name: template.name,
      subject: template.subject,
      bodyHtml: template.bodyHtml,
      visibility: template.visibility,
      tags: template.tags || [],
    });
    setShowAddDialog(true);
  };

  const handleDuplicateTemplate = async (template: EmailTemplate) => {
    if (!tenantId || !currentUser) return;

    try {
      const duplicatedTemplate = {
        ...template,
        name: `${template.name} (Copy)`,
        ownerUid: currentUser.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      delete duplicatedTemplate.id;

      await addDoc(
        collection(db, 'tenants', tenantId, 'email_templates'),
        duplicatedTemplate
      );
      loadTemplates();
    } catch (error) {
      console.error('Error duplicating template:', error);
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      subject: '',
      bodyHtml: '',
      visibility: 'private',
      tags: [],
    });
  };

  const extractVariables = (html: string): string[] => {
    const variableRegex = /\{\{([^}]+)\}\}/g;
    const variables: string[] = [];
    let match;
    
    while ((match = variableRegex.exec(html)) !== null) {
      variables.push(match[1]);
    }
    
    return [...new Set(variables)];
  };

  const filteredTemplates = templates.filter(template => {
    if (activeTab === 0) return template.visibility === 'private' && template.ownerUid === currentUser?.uid;
    if (activeTab === 1) return template.visibility === 'team';
    return template.visibility === 'company';
  });

  const commonVariables = [
    'first_name',
    'last_name',
    'company_name',
    'title',
    'city',
    'state',
    'industry',
    'my_name',
    'my_company',
    'my_title'
  ];

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            Email Templates
          </Typography>
          {mode === 'manage' && (
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => {
                setEditingTemplate(null);
                resetForm();
                setShowAddDialog(true);
              }}
            >
              New Template
            </Button>
          )}
        </Box>
      </DialogTitle>
      <DialogContent>
        <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
          <Stack direction="row" spacing={1}>
            <Button
              variant={activeTab === 0 ? 'contained' : 'text'}
              onClick={() => setActiveTab(0)}
            >
              Mine
            </Button>
            <Button
              variant={activeTab === 1 ? 'contained' : 'text'}
              onClick={() => setActiveTab(1)}
            >
              Team
            </Button>
            <Button
              variant={activeTab === 2 ? 'contained' : 'text'}
              onClick={() => setActiveTab(2)}
            >
              Company
            </Button>
          </Stack>
        </Box>

        <Grid container spacing={2}>
          {filteredTemplates.map((template) => (
            <Grid item xs={12} md={6} key={template.id}>
              <Card variant="outlined" sx={{ height: '100%' }}>
                <CardContent>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
                    <Typography variant="h6" sx={{ fontWeight: 600 }}>
                      {template.name}
                    </Typography>
                    <Chip 
                      label={template.visibility} 
                      size="small" 
                      color="primary" 
                      variant="outlined"
                    />
                  </Box>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    {template.subject}
                  </Typography>
                  <Typography 
                    variant="body2" 
                    sx={{ 
                      mb: 2,
                      display: '-webkit-box',
                      WebkitLineClamp: 3,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden'
                    }}
                  >
                    {template.bodyHtml.replace(/<[^>]*>/g, '')}
                  </Typography>
                  <Stack direction="row" spacing={1} flexWrap="wrap" gap={1}>
                    {template.variables.slice(0, 3).map((variable) => (
                      <Chip key={variable} label={`{{${variable}}}`} size="small" variant="outlined" />
                    ))}
                    {template.variables.length > 3 && (
                      <Chip label={`+${template.variables.length - 3} more`} size="small" variant="outlined" />
                    )}
                  </Stack>
                </CardContent>
                <CardActions>
                  {mode === 'select' ? (
                    <Button
                      size="small"
                      variant="contained"
                      onClick={() => onSelectTemplate?.(template)}
                    >
                      Select Template
                    </Button>
                  ) : (
                    <Stack direction="row" spacing={1}>
                      <IconButton size="small" onClick={() => handleEditTemplate(template)}>
                        <EditIcon fontSize="small" />
                      </IconButton>
                      <IconButton size="small" onClick={() => handleDuplicateTemplate(template)}>
                        <DuplicateIcon fontSize="small" />
                      </IconButton>
                      <IconButton size="small" onClick={() => handleDeleteTemplate(template.id)}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Stack>
                  )}
                </CardActions>
              </Card>
            </Grid>
          ))}
        </Grid>

        {filteredTemplates.length === 0 && (
          <Box sx={{ textAlign: 'center', py: 4 }}>
            <Typography variant="body2" color="text.secondary">
              No templates found. {mode === 'manage' && 'Create your first template to get started.'}
            </Typography>
          </Box>
        )}
      </DialogContent>

      {/* Add/Edit Template Dialog */}
      <Dialog open={showAddDialog} onClose={() => setShowAddDialog(false)} maxWidth="md" fullWidth>
        <DialogTitle>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            {editingTemplate ? 'Edit Template' : 'New Template'}
          </Typography>
        </DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Template Name"
                value={formData.name}
                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                required
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Subject Line"
                value={formData.subject}
                onChange={(e) => setFormData(prev => ({ ...prev, subject: e.target.value }))}
                required
              />
            </Grid>
            <Grid item xs={12}>
              <FormControl fullWidth>
                <InputLabel>Visibility</InputLabel>
                <Select
                  value={formData.visibility}
                  onChange={(e) => setFormData(prev => ({ ...prev, visibility: e.target.value as any }))}
                  label="Visibility"
                >
                  <MenuItem value="private">Private</MenuItem>
                  <MenuItem value="team">Team</MenuItem>
                  <MenuItem value="company">Company</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                multiline
                rows={8}
                label="Email Body (HTML)"
                value={formData.bodyHtml}
                onChange={(e) => setFormData(prev => ({ ...prev, bodyHtml: e.target.value }))}
                required
                helperText="Use {{variable_name}} for dynamic content"
              />
            </Grid>
            <Grid item xs={12}>
              <Typography variant="subtitle2" gutterBottom>
                Available Variables:
              </Typography>
              <Stack direction="row" spacing={1} flexWrap="wrap" gap={1}>
                {commonVariables.map((variable) => (
                  <Chip
                    key={variable}
                    label={`{{${variable}}}`}
                    size="small"
                    variant="outlined"
                    onClick={() => {
                      const textarea = document.querySelector('textarea');
                      if (textarea) {
                        const start = textarea.selectionStart;
                        const end = textarea.selectionEnd;
                        const newValue = formData.bodyHtml.substring(0, start) + `{{${variable}}}` + formData.bodyHtml.substring(end);
                        setFormData(prev => ({ ...prev, bodyHtml: newValue }));
                      }
                    }}
                    sx={{ cursor: 'pointer' }}
                  />
                ))}
              </Stack>
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowAddDialog(false)}>
            Cancel
          </Button>
          <Button 
            variant="contained" 
            onClick={handleSaveTemplate}
            disabled={!formData.name || !formData.subject || !formData.bodyHtml}
          >
            {editingTemplate ? 'Update' : 'Create'} Template
          </Button>
        </DialogActions>
      </Dialog>
    </Dialog>
  );
};

export default EmailTemplatesManager;
