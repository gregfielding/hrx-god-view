/**
 * DashboardFeedComposer Component
 * 
 * Composer for creating feed posts with mentions.
 * Posts can be sent to Slack channels and/or stored internally.
 */

import React, { useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  Avatar,
  TextField,
  Button,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Typography,
  CircularProgress,
  Snackbar,
  Alert,
} from '@mui/material';
import { useAuth } from '../contexts/AuthContext';
import { RichTextInputWithMentions, RichTextValue } from './common/RichTextInputWithMentions';
import { useSlackChannels } from '../hooks/useSlackChannels';
import type { FeedPostVisibility } from '../types/feed';
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
  const [targetChannelId, setTargetChannelId] = useState<string>('');
  const [visibility, setVisibility] = useState<FeedPostVisibility>('tenant');
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Get Slack channels for channel selector
  const { channels: slackChannels } = useSlackChannels(tenantId || null);
  
  // Filter to only active, non-archived channels
  const availableChannels = slackChannels.filter(
    ch => !ch.isArchived && ch.status !== 'setup_needed'
  );

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
      
      const result = await feedCreatePost({
        tenantId,
        body: text,
        targetChannelId: targetChannelId || undefined,
        visibility,
      });

      const data = result.data as any;
      
      if (data.postId) {
        setSuccess(true);
        setText('');
        setMentions([]);
        setTargetChannelId('');
        
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
    setTargetChannelId('');
    setError(null);
  };

  const userDisplayName = user?.displayName || 
    `${(user as any)?.firstName || ''} ${(user as any)?.lastName || ''}`.trim() ||
    user?.email?.split('@')[0] ||
    'You';

  return (
    <>
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Box display="flex" gap={2} mb={2}>
            <Avatar
              src={user?.photoURL || (user as any)?.avatar}
              sx={{ width: 40, height: 40 }}
            >
              {userDisplayName[0]?.toUpperCase() || 'U'}
            </Avatar>
            <Box flex={1}>
              <Typography variant="body2" color="text.secondary" mb={1}>
                What's happening, {userDisplayName}?
              </Typography>
              <RichTextInputWithMentions
                value={text}
                onChange={handleTextChange}
                placeholder="Type @ for users, # for contacts, & for companies, % for deals..."
                fullWidth
                multiline
                rows={3}
                sx={{ mb: 2 }}
              />
              
              <Box display="flex" gap={2} alignItems="center" flexWrap="wrap">
                <FormControl size="small" sx={{ minWidth: 150 }}>
                  <InputLabel>Channel</InputLabel>
                  <Select
                    value={targetChannelId}
                    onChange={(e) => setTargetChannelId(e.target.value)}
                    label="Channel"
                  >
                    <MenuItem value="">None (Internal only)</MenuItem>
                    {availableChannels.map((channel) => (
                      <MenuItem key={channel.id} value={channel.slackChannelId}>
                        {channel.displayName}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>

                <FormControl size="small" sx={{ minWidth: 120 }}>
                  <InputLabel>Visibility</InputLabel>
                  <Select
                    value={visibility}
                    onChange={(e) => setVisibility(e.target.value as FeedPostVisibility)}
                    label="Visibility"
                  >
                    <MenuItem value="tenant">Tenant</MenuItem>
                    <MenuItem value="team">Team</MenuItem>
                    <MenuItem value="private">Private</MenuItem>
                  </Select>
                </FormControl>

                <Box flex={1} />

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
          </Box>
        </CardContent>
      </Card>

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

