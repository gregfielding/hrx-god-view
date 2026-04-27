/**
 * Slack Mappings Tab
 * 
 * Admin UI for managing Slack → HRX user and channel mappings
 */

import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Autocomplete,
  Chip,
  Alert,
  Snackbar,
  CircularProgress,
  Tabs,
  Tab,
  IconButton,
  Tooltip,
  Stack,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import LinkIcon from '@mui/icons-material/Link';
import LinkOffIcon from '@mui/icons-material/LinkOff';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';

interface SlackUserMapping {
  id: string;
  slackUserId: string;
  email?: string;
  displayName?: string;
  realName?: string;
  hrxUserId?: string;
  autoLinked?: boolean;
  manualLinked?: boolean;
  createdAt?: any;
  updatedAt?: any;
}

interface SlackChannelMapping {
  id: string;
  slackChannelId: string;
  slackChannelName?: string;
  channelType: 'im' | 'channel' | 'group' | 'mpim';
  hrxConversationType?: 'dm' | 'channel' | 'deal' | 'customer' | 'job';
  hrxConversationId?: string;
  dealId?: string;
  customerId?: string;
  jobId?: string;
  autoLinked?: boolean;
  manualLinked?: boolean;
  createdAt?: any;
  updatedAt?: any;
}

interface HrxUser {
  id: string;
  email: string;
  displayName?: string;
  firstName?: string;
  lastName?: string;
}

interface SlackMappingsTabProps {
  tenantId: string;
}

const SlackMappingsTab: React.FC<SlackMappingsTabProps> = ({ tenantId }) => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<SlackUserMapping[]>([]);
  const [channels, setChannels] = useState<SlackChannelMapping[]>([]);
  const [hrxUsers, setHrxUsers] = useState<HrxUser[]>([]);
  const [tabValue, setTabValue] = useState(0);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
    open: false,
    message: '',
    severity: 'success',
  });

  // User mapping dialog
  const [userDialogOpen, setUserDialogOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<SlackUserMapping | null>(null);
  const [selectedHrxUser, setSelectedHrxUser] = useState<HrxUser | null>(null);

  // Channel mapping dialog
  const [channelDialogOpen, setChannelDialogOpen] = useState(false);
  const [selectedChannel, setSelectedChannel] = useState<SlackChannelMapping | null>(null);
  const [selectedTargetType, setSelectedTargetType] = useState<'deal' | 'customer' | 'job' | 'team' | 'dm' | 'channel'>('dm');
  const [selectedTargetId, setSelectedTargetId] = useState<string>('');
  const [selectedDealId, setSelectedDealId] = useState<string>('');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [selectedJobId, setSelectedJobId] = useState<string>('');

  // API functions
  const getSlackMappingsApi = httpsCallable(functions, 'getSlackMappingsApi');
  const updateSlackUserMappingApi = httpsCallable(functions, 'updateSlackUserMappingApi');
  const updateSlackChannelMappingApi = httpsCallable(functions, 'updateSlackChannelMappingApi');
  const getUsersByTenantApi = httpsCallable(functions, 'getUsersByTenant');

  useEffect(() => {
    loadMappings();
    loadHrxUsers();
  }, [tenantId]);

  const loadMappings = async () => {
    try {
      setLoading(true);
      const result = await getSlackMappingsApi({ tenantId });
      const data = result.data as { users: SlackUserMapping[]; channels: SlackChannelMapping[] };
      setUsers(data.users || []);
      setChannels(data.channels || []);
    } catch (error: any) {
      console.error('Error loading Slack mappings:', error);
      setSnackbar({
        open: true,
        message: `Error loading mappings: ${error.message}`,
        severity: 'error',
      });
    } finally {
      setLoading(false);
    }
  };

  const loadHrxUsers = async () => {
    try {
      const result = await getUsersByTenantApi({ tenantId });
      const data = result.data as { users: HrxUser[] };
      setHrxUsers(data.users || []);
    } catch (error: any) {
      console.error('Error loading HRX users:', error);
      setSnackbar({
        open: true,
        message: `Error loading HRX users: ${error.message}`,
        severity: 'error',
      });
    }
  };

  const handleUserMapping = (user: SlackUserMapping) => {
    setSelectedUser(user);
    if (user.hrxUserId) {
      // Find the HRX user
      const hrxUser = hrxUsers.find(u => u.id === user.hrxUserId);
      setSelectedHrxUser(hrxUser || null);
    } else {
      setSelectedHrxUser(null);
    }
    setUserDialogOpen(true);
  };

  const handleSaveUserMapping = async () => {
    if (!selectedUser) return;

    try {
      await updateSlackUserMappingApi({
        tenantId,
        slackUserId: selectedUser.slackUserId,
        hrxUserId: selectedHrxUser?.id || null,
      });

      setSnackbar({
        open: true,
        message: selectedHrxUser ? 'User mapping updated successfully' : 'User mapping removed',
        severity: 'success',
      });

      setUserDialogOpen(false);
      loadMappings();
    } catch (error: any) {
      console.error('Error updating user mapping:', error);
      setSnackbar({
        open: true,
        message: `Error updating mapping: ${error.message}`,
        severity: 'error',
      });
    }
  };

  const handleChannelMapping = (channel: SlackChannelMapping) => {
    setSelectedChannel(channel);
    
    // Determine target type from existing mapping
    if (channel.dealId) {
      setSelectedTargetType('deal');
      setSelectedTargetId(channel.dealId);
      setSelectedDealId(channel.dealId);
    } else if (channel.customerId) {
      setSelectedTargetType('customer');
      setSelectedTargetId(channel.customerId);
      setSelectedCustomerId(channel.customerId);
    } else if (channel.jobId) {
      setSelectedTargetType('job');
      setSelectedTargetId(channel.jobId);
      setSelectedJobId(channel.jobId);
    } else if (channel.hrxConversationType === 'channel') {
      setSelectedTargetType('channel');
      setSelectedTargetId(channel.hrxConversationId || '');
    } else {
      setSelectedTargetType('dm');
      setSelectedTargetId(channel.hrxConversationId || '');
    }
    
    setChannelDialogOpen(true);
  };

  const handleSaveChannelMapping = async () => {
    if (!selectedChannel) return;

    try {
      const updateData: any = {
        tenantId,
        channelId: selectedChannel.slackChannelId,
      };

      // Set mapping based on target type
      if (selectedTargetType === 'deal' && selectedDealId) {
        updateData.hrxConversationType = 'deal';
        updateData.hrxConversationId = selectedDealId;
        updateData.dealId = selectedDealId;
      } else if (selectedTargetType === 'customer' && selectedCustomerId) {
        updateData.hrxConversationType = 'customer';
        updateData.hrxConversationId = selectedCustomerId;
        updateData.customerId = selectedCustomerId;
      } else if (selectedTargetType === 'job' && selectedJobId) {
        updateData.hrxConversationType = 'job';
        updateData.hrxConversationId = selectedJobId;
        updateData.jobId = selectedJobId;
      } else if (selectedTargetType === 'team' && selectedTargetId) {
        updateData.hrxConversationType = 'channel';
        updateData.hrxConversationId = selectedTargetId;
      } else if (selectedTargetType === 'dm' && selectedTargetId) {
        updateData.hrxConversationType = 'dm';
        updateData.hrxConversationId = selectedTargetId;
      } else if (selectedTargetType === 'channel' && selectedTargetId) {
        updateData.hrxConversationType = 'channel';
        updateData.hrxConversationId = selectedTargetId;
      } else {
        // Clear mapping
        updateData.hrxConversationType = null;
        updateData.hrxConversationId = null;
        updateData.dealId = null;
        updateData.customerId = null;
        updateData.jobId = null;
      }

      await updateSlackChannelMappingApi(updateData);

      setSnackbar({
        open: true,
        message: selectedTargetId ? 'Channel mapping updated successfully' : 'Channel mapping removed',
        severity: 'success',
      });

      setChannelDialogOpen(false);
      loadMappings();
    } catch (error: any) {
      console.error('Error updating channel mapping:', error);
      setSnackbar({
        open: true,
        message: `Error updating mapping: ${error.message}`,
        severity: 'error',
      });
    }
  };

  const getChannelTypeLabel = (type: string) => {
    const labels: { [key: string]: string } = {
      im: 'Direct Message',
      channel: 'Public Channel',
      group: 'Private Channel',
      mpim: 'Group DM',
    };
    return labels[type] || type;
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="200px">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      <Typography variant="h6" fontWeight={700} mb={2}>
        Slack Mappings
      </Typography>
      <Typography variant="body2" color="text.secondary" mb={3}>
        Manage how Slack users and channels are linked to HRX users and conversations.
      </Typography>

      <Paper elevation={1} sx={{ mb: 3, borderRadius: 0 }}>
        <Tabs
          value={tabValue}
          onChange={(_, newValue) => setTabValue(newValue)}
          indicatorColor="primary"
          textColor="primary"
        >
          <Tab label={`Users (${users.length})`} />
          <Tab label={`Channels (${channels.length})`} />
        </Tabs>
      </Paper>

      {/* Users Tab */}
      {tabValue === 0 && (
        <TableContainer component={Paper} elevation={1} sx={{ borderRadius: 0 }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Slack User</TableCell>
                <TableCell>Email</TableCell>
                <TableCell>HRX User</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {users.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} align="center" sx={{ py: 4 }}>
                    <Typography variant="body2" color="text.secondary">
                      No Slack users found. Slack messages will create user mappings automatically.
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                users.map((user) => (
                  <TableRow key={user.id} hover>
                    <TableCell>
                      <Typography variant="body2" fontWeight={user.hrxUserId ? 600 : 400}>
                        {user.displayName || user.realName || user.slackUserId}
                      </Typography>
                    </TableCell>
                    <TableCell>{user.email || '—'}</TableCell>
                    <TableCell>
                      {user.hrxUserId ? (
                        <Chip label="Linked" size="small" color="success" />
                      ) : (
                        <Chip label="Unlinked" size="small" color="default" />
                      )}
                    </TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={1}>
                        {user.autoLinked && (
                          <Chip label="Auto" size="small" variant="outlined" />
                        )}
                        {user.manualLinked && (
                          <Chip label="Manual" size="small" variant="outlined" />
                        )}
                      </Stack>
                    </TableCell>
                    <TableCell align="right">
                      <Tooltip title={user.hrxUserId ? 'Edit mapping' : 'Link to HRX user'}>
                        <IconButton
                          size="small"
                          onClick={() => handleUserMapping(user)}
                          color={user.hrxUserId ? 'primary' : 'default'}
                        >
                          {user.hrxUserId ? <EditIcon /> : <LinkIcon />}
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Channels Tab */}
      {tabValue === 1 && (
        <TableContainer component={Paper} elevation={1} sx={{ borderRadius: 0 }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Slack Channel</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>HRX Conversation</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {channels.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} align="center" sx={{ py: 4 }}>
                    <Typography variant="body2" color="text.secondary">
                      No Slack channels found. Slack messages will create channel mappings automatically.
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                channels.map((channel) => (
                  <TableRow key={channel.id} hover>
                    <TableCell>
                      <Typography variant="body2" fontWeight={channel.hrxConversationId ? 600 : 400}>
                        {channel.slackChannelName || channel.slackChannelId}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip label={getChannelTypeLabel(channel.channelType)} size="small" />
                    </TableCell>
                    <TableCell>
                      {channel.hrxConversationId ? (
                        <Chip label={channel.hrxConversationType || 'Linked'} size="small" color="success" />
                      ) : (
                        <Chip label="Unlinked" size="small" color="default" />
                      )}
                    </TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={1}>
                        {channel.autoLinked && (
                          <Chip label="Auto" size="small" variant="outlined" />
                        )}
                        {channel.manualLinked && (
                          <Chip label="Manual" size="small" variant="outlined" />
                        )}
                      </Stack>
                    </TableCell>
                    <TableCell align="right">
                      <Tooltip title={channel.hrxConversationId ? 'Edit mapping' : 'Link to HRX conversation'}>
                        <IconButton
                          size="small"
                          onClick={() => handleChannelMapping(channel)}
                          color={channel.hrxConversationId ? 'primary' : 'default'}
                        >
                          {channel.hrxConversationId ? <EditIcon /> : <LinkIcon />}
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* User Mapping Dialog */}
      <Dialog open={userDialogOpen} onClose={() => setUserDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>
          {selectedUser?.hrxUserId ? 'Edit User Mapping' : 'Link Slack User to HRX User'}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 2 }}>
            <Typography variant="body2" color="text.secondary" mb={2}>
              <strong>Slack User:</strong> {selectedUser?.displayName || selectedUser?.realName || selectedUser?.slackUserId}
              {selectedUser?.email && ` (${selectedUser.email})`}
            </Typography>
            <Autocomplete
              options={hrxUsers}
              getOptionLabel={(option) => `${option.displayName || option.firstName || option.email} (${option.email})`}
              value={selectedHrxUser}
              onChange={(_, newValue) => setSelectedHrxUser(newValue)}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="HRX User"
                  placeholder="Search for HRX user..."
                  fullWidth
                />
              )}
            />
            {selectedUser?.hrxUserId && (
              <Button
                startIcon={<LinkOffIcon />}
                onClick={() => setSelectedHrxUser(null)}
                sx={{ mt: 2 }}
                color="error"
                size="small"
              >
                Remove Mapping
              </Button>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setUserDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleSaveUserMapping} variant="contained">
            Save
          </Button>
        </DialogActions>
      </Dialog>

      {/* Channel Mapping Dialog */}
      <Dialog open={channelDialogOpen} onClose={() => setChannelDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>
          {selectedChannel?.hrxConversationId ? 'Edit Channel Mapping' : 'Link Slack Channel to HRX Conversation'}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 2 }}>
            <Typography variant="body2" color="text.secondary" mb={2}>
              <strong>Slack Channel:</strong> {selectedChannel?.slackChannelName || selectedChannel?.slackChannelId}
              <Chip label={getChannelTypeLabel(selectedChannel?.channelType || 'channel')} size="small" sx={{ ml: 1 }} />
            </Typography>
            <TextField
              select
              label="Mapping Type"
              value={selectedTargetType}
              onChange={(e) => {
                const newType = e.target.value as typeof selectedTargetType;
                setSelectedTargetType(newType);
                setSelectedTargetId('');
                setSelectedDealId('');
                setSelectedCustomerId('');
                setSelectedJobId('');
              }}
              fullWidth
              sx={{ mb: 2 }}
              SelectProps={{
                native: true,
              }}
            >
              <option value="dm">Direct Message</option>
              <option value="channel">Internal Channel</option>
              <option value="deal">Deal</option>
              <option value="customer">Customer</option>
              <option value="job">Job Order</option>
              <option value="team">Team Room</option>
            </TextField>
            
            {(selectedTargetType === 'dm' || selectedTargetType === 'channel' || selectedTargetType === 'team') && (
              <TextField
                label="HRX Conversation ID"
                value={selectedTargetId}
                onChange={(e) => setSelectedTargetId(e.target.value)}
                fullWidth
                placeholder="Enter conversation ID..."
                helperText={selectedTargetType === 'dm' ? 'DM ID (e.g., user1_user2)' : 'Channel ID or Team ID'}
              />
            )}
            
            {selectedTargetType === 'deal' && (
              <TextField
                label="Deal ID"
                value={selectedDealId}
                onChange={(e) => {
                  setSelectedDealId(e.target.value);
                  setSelectedTargetId(e.target.value);
                }}
                fullWidth
                placeholder="Enter deal ID..."
                helperText="ID of the CRM deal to link this channel to"
              />
            )}
            
            {selectedTargetType === 'customer' && (
              <TextField
                label="Customer ID"
                value={selectedCustomerId}
                onChange={(e) => {
                  setSelectedCustomerId(e.target.value);
                  setSelectedTargetId(e.target.value);
                }}
                fullWidth
                placeholder="Enter customer ID..."
                helperText="ID of the CRM customer to link this channel to"
              />
            )}
            
            {selectedTargetType === 'job' && (
              <TextField
                label="Job Order ID"
                value={selectedJobId}
                onChange={(e) => {
                  setSelectedJobId(e.target.value);
                  setSelectedTargetId(e.target.value);
                }}
                fullWidth
                placeholder="Enter job order ID..."
                helperText="ID of the job order to link this channel to"
              />
            )}
            
            {(selectedChannel?.hrxConversationId || selectedChannel?.dealId || selectedChannel?.customerId || selectedChannel?.jobId) && (
              <Button
                startIcon={<LinkOffIcon />}
                onClick={() => {
                  setSelectedTargetId('');
                  setSelectedDealId('');
                  setSelectedCustomerId('');
                  setSelectedJobId('');
                  setSelectedTargetType('dm');
                }}
                sx={{ mt: 2 }}
                color="error"
                size="small"
              >
                Remove Mapping
              </Button>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setChannelDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleSaveChannelMapping} variant="contained">
            Save
          </Button>
        </DialogActions>
      </Dialog>

      {/* Snackbar */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
      >
        <Alert severity={snackbar.severity} onClose={() => setSnackbar({ ...snackbar, open: false })}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default SlackMappingsTab;

