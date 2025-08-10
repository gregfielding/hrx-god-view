import React, { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  Grid,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Switch,
  FormControlLabel,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Typography,
  Alert,
  CircularProgress,
} from '@mui/material';
import { ExpandMore as ExpandMoreIcon, Send as SendIcon } from '@mui/icons-material';
import { httpsCallable , getFunctions } from 'firebase/functions';

interface AudienceFilter {
  location: string[];
  jobTitle: string[];
  department: string[];
  costCenter: string[];
  traits: string[];
  tags: string[];
  userIds?: string[];
  jobOrderId?: string;
  userGroupId?: string;
}

interface BroadcastDialogProps {
  open: boolean;
  onClose: () => void;
  tenantId: string;
  senderId: string;
  initialAudienceFilter?: Partial<AudienceFilter>;
  title?: string;
  locations?: string[];
  departments?: string[];
  costCenters?: string[];
  jobTitles?: string[];
  traits?: string[];
  tags?: string[];
  onSuccess?: (result: any) => void;
}

const BroadcastDialog: React.FC<BroadcastDialogProps> = ({
  open,
  onClose,
  tenantId,
  senderId,
  initialAudienceFilter = {},
  title = 'Send Broadcast',
  locations = [],
  departments = [],
  costCenters = [],
  jobTitles = [],
  traits = [],
  tags = [],
  onSuccess,
}) => {
  const [message, setMessage] = useState('');
  const [audienceFilter, setAudienceFilter] = useState<AudienceFilter>({
    location: initialAudienceFilter.location || [],
    jobTitle: initialAudienceFilter.jobTitle || [],
    department: initialAudienceFilter.department || [],
    costCenter: initialAudienceFilter.costCenter || [],
    traits: initialAudienceFilter.traits || [],
    tags: initialAudienceFilter.tags || [],
    userIds: initialAudienceFilter.userIds || [],
    ...(initialAudienceFilter.jobOrderId ? { jobOrderId: initialAudienceFilter.jobOrderId } : {}),
    ...(initialAudienceFilter.userGroupId ? { userGroupId: initialAudienceFilter.userGroupId } : {}),
  });
  const [aiAssistReplies, setAiAssistReplies] = useState(true);
  const [escalationEmail, setEscalationEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const functions = getFunctions();

  const handleSend = async () => {
    if (!message.trim()) {
      setError('Message is required');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const createBroadcast = httpsCallable(functions, 'createBroadcast');
      const result = await createBroadcast({
        senderId,
        tenantId,
        audienceFilter,
        message: message.trim(),
        aiAssistReplies,
        escalationEmail: escalationEmail || undefined,
      });

      setMessage('');
      setAudienceFilter({
        location: [],
        jobTitle: [],
        department: [],
        costCenter: [],
        traits: [],
        tags: [],
        userIds: []
      } as AudienceFilter);

      onSuccess?.(result.data);
      onClose();
    } catch (error: any) {
      setError(error.message || 'Failed to send broadcast');
    } finally {
      setLoading(false);
    }
  };

  const getAudienceSummary = () => {
    const filters: string[] = [];
    if (audienceFilter.location.length > 0)
      filters.push(`${audienceFilter.location.length} location(s)`);
    if (audienceFilter.jobTitle.length > 0)
      filters.push(`${audienceFilter.jobTitle.length} job title(s)`);
    if (audienceFilter.department.length > 0)
      filters.push(`${audienceFilter.department.length} department(s)`);
    if (audienceFilter.costCenter.length > 0)
      filters.push(`${audienceFilter.costCenter.length} cost center(s)`);
    if (audienceFilter.traits.length > 0) filters.push(`${audienceFilter.traits.length} trait(s)`);
    if (audienceFilter.tags.length > 0) filters.push(`${audienceFilter.tags.length} tag(s)`);
    if (audienceFilter.userIds?.length)
      filters.push(`${audienceFilter.userIds.length} specific user(s)`);
    if (audienceFilter.jobOrderId) filters.push('Job Order workers');
    if (audienceFilter.userGroupId) filters.push('User Group members');

    return filters.length > 0 ? filters.join(', ') : 'All workers';
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Grid container spacing={3} sx={{ mt: 1 }}>
          <Grid item xs={12}>
            <TextField
              fullWidth
              multiline
              rows={4}
              label="Message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Enter your broadcast message..."
              error={!!error && !message.trim()}
            />
          </Grid>

          <Grid item xs={12}>
            <Typography variant="subtitle2" gutterBottom>
              Target Audience: {getAudienceSummary()}
            </Typography>

            <Accordion>
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography>Audience Filters</Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Grid container spacing={2}>
                  {locations.length > 0 && (
                    <Grid item xs={12} md={6}>
                      <FormControl fullWidth>
                        <InputLabel>Locations</InputLabel>
                        <Select
                          multiple
                          value={audienceFilter.location}
                          onChange={(e) =>
                            setAudienceFilter({
                              ...audienceFilter,
                              location: e.target.value as string[],
                            })
                          }
                          label="Locations"
                        >
                          {locations.map((location) => (
                            <MenuItem key={location} value={location}>
                              {location}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </Grid>
                  )}

                  {departments.length > 0 && (
                    <Grid item xs={12} md={6}>
                      <FormControl fullWidth>
                        <InputLabel>Departments</InputLabel>
                        <Select
                          multiple
                          value={audienceFilter.department}
                          onChange={(e) =>
                            setAudienceFilter({
                              ...audienceFilter,
                              department: e.target.value as string[],
                            })
                          }
                          label="Departments"
                        >
                          {departments.map((dept) => (
                            <MenuItem key={dept} value={dept}>
                              {dept}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </Grid>
                  )}

                  {costCenters.length > 0 && (
                    <Grid item xs={12} md={6}>
                      <FormControl fullWidth>
                        <InputLabel>Cost Centers</InputLabel>
                        <Select
                          multiple
                          value={audienceFilter.costCenter}
                          onChange={(e) =>
                            setAudienceFilter({
                              ...audienceFilter,
                              costCenter: e.target.value as string[],
                            })
                          }
                          label="Cost Centers"
                        >
                          {costCenters.map((cc) => (
                            <MenuItem key={cc} value={cc}>
                              {cc}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </Grid>
                  )}

                  {jobTitles.length > 0 && (
                    <Grid item xs={12} md={6}>
                      <FormControl fullWidth>
                        <InputLabel>Job Titles</InputLabel>
                        <Select
                          multiple
                          value={audienceFilter.jobTitle}
                          onChange={(e) =>
                            setAudienceFilter({
                              ...audienceFilter,
                              jobTitle: e.target.value as string[],
                            })
                          }
                          label="Job Titles"
                        >
                          {jobTitles.map((title) => (
                            <MenuItem key={title} value={title}>
                              {title}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </Grid>
                  )}

                  {traits.length > 0 && (
                    <Grid item xs={12} md={6}>
                      <FormControl fullWidth>
                        <InputLabel>Traits</InputLabel>
                        <Select
                          multiple
                          value={audienceFilter.traits}
                          onChange={(e) =>
                            setAudienceFilter({
                              ...audienceFilter,
                              traits: e.target.value as string[],
                            })
                          }
                          label="Traits"
                        >
                          {traits.map((trait) => (
                            <MenuItem key={trait} value={trait}>
                              {trait}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </Grid>
                  )}

                  {tags.length > 0 && (
                    <Grid item xs={12} md={6}>
                      <FormControl fullWidth>
                        <InputLabel>Tags</InputLabel>
                        <Select
                          multiple
                          value={audienceFilter.tags}
                          onChange={(e) =>
                            setAudienceFilter({
                              ...audienceFilter,
                              tags: e.target.value as string[],
                            })
                          }
                          label="Tags"
                        >
                          {tags.map((tag) => (
                            <MenuItem key={tag} value={tag}>
                              {tag}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </Grid>
                  )}
                </Grid>
              </AccordionDetails>
            </Accordion>
          </Grid>

          <Grid item xs={12} md={6}>
            <FormControlLabel
              control={
                <Switch
                  checked={aiAssistReplies}
                  onChange={(e) => setAiAssistReplies(e.target.checked)}
                />
              }
              label="Enable AI-Assisted Replies"
            />
          </Grid>

          <Grid item xs={12} md={6}>
            <TextField
              fullWidth
              label="Escalation Email"
              value={escalationEmail}
              onChange={(e) => setEscalationEmail(e.target.value)}
              placeholder="hr@company.com"
            />
          </Grid>

          {error && (
            <Grid item xs={12}>
              <Alert severity="error">{error}</Alert>
            </Grid>
          )}
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={loading}>
          Cancel
        </Button>
        <Button
          onClick={handleSend}
          variant="contained"
          disabled={!message.trim() || loading}
          startIcon={loading ? <CircularProgress size={20} /> : <SendIcon />}
        >
          {loading ? 'Sending...' : 'Send Broadcast'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default BroadcastDialog;
