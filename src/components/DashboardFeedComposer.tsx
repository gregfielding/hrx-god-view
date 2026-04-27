/**
 * DashboardFeedComposer Component
 * 
 * Composer for creating feed posts with mentions.
 * Posts can be sent to Slack channels and/or stored internally.
 */

import React, { useState, useEffect } from 'react';
import {
  Box,
  Button,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  CircularProgress,
  Snackbar,
  Alert,
} from '@mui/material';
import { useAuth } from '../contexts/AuthContext';
import { RichTextInputWithMentions, RichTextValue } from './common/RichTextInputWithMentions';
import { useSlackChannels } from '../hooks/useSlackChannels';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';

interface DashboardFeedComposerProps {
  onPostCreated?: () => void;
}

export const DashboardFeedComposer: React.FC<DashboardFeedComposerProps> = ({
  onPostCreated,
}) => {
  const { user, activeTenant } = useAuth();
  const tenantId = activeTenant?.id || (user as any)?.activeTenantId || '';
  
  const [text, setText] = useState('');
  const [mentions, setMentions] = useState<RichTextValue['mentions']>([]);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Get Slack channels for channel selector
  const { channels: slackChannels } = useSlackChannels(tenantId || null);
  
  // Filter to only active, non-archived channels
  const availableChannels = slackChannels.filter(
    ch => !ch.isArchived && ch.status !== 'setup_needed'
  );

  const [targetChannelId, setTargetChannelId] = useState<string>('');

  // Find #general channel and set it as default when channels load
  useEffect(() => {
    if (availableChannels.length > 0 && !targetChannelId) {
      const generalChannel = availableChannels.find(
        ch => ch.name === 'general' || ch.displayName === '#general' || ch.displayName === 'general'
      );
      const defaultChannelId = generalChannel?.slackChannelId || availableChannels[0]?.slackChannelId || '';
      if (defaultChannelId) {
        setTargetChannelId(defaultChannelId);
      }
    }
  }, [availableChannels, targetChannelId]);

  const handleTextChange = (value: RichTextValue) => {
    setText(value.text);
    setMentions(value.mentions);
  };

  const handlePost = async () => {
    if (!text.trim() || !tenantId || !user?.uid) {
      setError('Please enter some text to post');
      return;
    }

    setPosting(true);
    setError(null);

    try {
      const feedCreatePost = httpsCallable(functions, 'feedCreatePost');
      
      // Ensure we have a channel selected (should always be #general by default)
      if (!targetChannelId) {
        setError('Please select a channel');
        setPosting(false);
        return;
      }

      const result = await feedCreatePost({
        tenantId,
        body: text,
        targetChannelId: targetChannelId,
        visibility: 'tenant', // All posts are visible to the team
      });

      const data = result.data as any;
      
      if (data.postId) {
        setSuccess(true);
        setText('');
        setMentions([]);
        // Keep the channel selected (will reset to #general via useEffect)
        
        // Notify parent component
        if (onPostCreated) {
          onPostCreated();
        }
      } else {
        throw new Error(data.message || 'Failed to create post');
      }
    } catch (err: any) {
      console.error('Error creating feed post:', err);
      setError(err.message || 'Failed to create post. Please try again.');
    } finally {
      setPosting(false);
    }
  };

  const handleCancel = () => {
    setText('');
    setMentions([]);
    // Reset to default channel (#general) - will be set by useEffect
    if (availableChannels.length > 0) {
      const generalChannel = availableChannels.find(
        ch => ch.name === 'general' || ch.displayName === '#general' || ch.displayName === 'general'
      );
      const defaultChannelId = generalChannel?.slackChannelId || availableChannels[0]?.slackChannelId || '';
      if (defaultChannelId) {
        setTargetChannelId(defaultChannelId);
      }
    }
    setError(null);
  };

  const userDisplayName = user?.displayName || 
    `${(user as any)?.firstName || ''} ${(user as any)?.lastName || ''}`.trim() ||
    user?.email?.split('@')[0] ||
    'You';

  return (
    <>
      <Box>
        <RichTextInputWithMentions
          value={text}
          onChange={handleTextChange}
          placeholder={`What's happening, ${userDisplayName}?`}
          fullWidth
          multiline
          rows={3}
          sx={{ mb: 2 }}
        />
        
        <Box display="flex" gap={2} alignItems="center" flexWrap="wrap" justifyContent="flex-end" sx={{ pb: 1 }}>
          <FormControl size="small" sx={{ minWidth: 150 }}>
            <InputLabel>Channel</InputLabel>
            <Select
              value={targetChannelId}
              onChange={(e) => setTargetChannelId(e.target.value)}
              label="Channel"
            >
              {availableChannels.map((channel) => (
                <MenuItem key={channel.id} value={channel.slackChannelId}>
                  {channel.displayName}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <Button
            variant="outlined"
            onClick={handleCancel}
            disabled={posting || !text.trim()}
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={handlePost}
            disabled={posting || !text.trim()}
            startIcon={posting ? <CircularProgress size={16} /> : null}
          >
            {posting ? 'Posting...' : 'Post'}
          </Button>
        </Box>
      </Box>

      <Snackbar
        open={!!error}
        autoHideDuration={6000}
        onClose={() => setError(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      </Snackbar>

      <Snackbar
        open={success}
        autoHideDuration={3000}
        onClose={() => setSuccess(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert severity="success" onClose={() => setSuccess(false)}>
          Post created successfully!
        </Alert>
      </Snackbar>
    </>
  );
};

