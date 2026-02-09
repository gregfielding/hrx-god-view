/**
 * Test component for worker messaging functionality
 * This component can be used to test the Twilio worker messaging system
 */

import React, { useState } from 'react';
import {
  Box,
  Button,
  TextField,
  Typography,
  Paper,
  Alert,
  CircularProgress,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Stack,
} from '@mui/material';
import { useWorkerMessaging, messageTemplates } from '../hooks/useWorkerMessaging';

interface WorkerMessagingTestProps {
  onClose?: () => void;
}

export const WorkerMessagingTest: React.FC<WorkerMessagingTestProps> = ({ onClose }) => {
  const [recipientPhone, setRecipientPhone] = useState('');
  const [message, setMessage] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState<string>('');
  const [customMessage, setCustomMessage] = useState('');
  
  const { sendMessage, isLoading, error, clearError } = useWorkerMessaging();
  const [result, setResult] = useState<{ messageId: string; status: string } | null>(null);

  const handleSendMessage = async () => {
    if (!recipientPhone.trim()) {
      alert('Please enter a recipient phone number');
      return;
    }

    if (!message.trim() && !selectedTemplate) {
      alert('Please enter a message or select a template');
      return;
    }

    try {
      clearError();
      setResult(null);

      const messageContent = selectedTemplate ? undefined : message;
      const template = selectedTemplate as any;

      const result = await sendMessage(recipientPhone, messageContent, template);
      setResult(result);
    } catch (err: any) {
      console.error('Failed to send message:', err);
    }
  };

  const handleTemplateChange = (template: string) => {
    setSelectedTemplate(template);
    if (template && messageTemplates[template as keyof typeof messageTemplates]) {
      setMessage(messageTemplates[template as keyof typeof messageTemplates].defaultMessage);
    }
  };

  return (
    <Paper sx={{ p: 3, maxWidth: 600, mx: 'auto', mt: 2 }}>
      <Typography variant="h5" gutterBottom>
        Worker Messaging Test
      </Typography>
      
      <Stack spacing={3}>
        <TextField
          label="Recipient Phone Number"
          value={recipientPhone}
          onChange={(e) => setRecipientPhone(e.target.value)}
          placeholder="+18888058650"
          fullWidth
          helperText="Enter phone number in E.164 format (e.g., +18888058650)"
        />

        <FormControl fullWidth>
          <InputLabel>Message Template</InputLabel>
          <Select
            value={selectedTemplate}
            onChange={(e) => handleTemplateChange(e.target.value)}
          >
            <MenuItem value="">Custom Message</MenuItem>
            {Object.entries(messageTemplates).map(([key, template]) => (
              <MenuItem key={key} value={key}>
                {template.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <TextField
          label="Message Content"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          multiline
          rows={3}
          fullWidth
          placeholder="Enter your message here..."
          disabled={!!selectedTemplate}
        />

        {error && (
          <Alert severity="error" onClose={clearError}>
            {error}
          </Alert>
        )}

        {result && (
          <Alert severity="success">
            Message sent successfully!<br />
            Message ID: {result.messageId}<br />
            Status: {result.status}
          </Alert>
        )}

        <Box sx={{ display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
          {onClose && (
            <Button onClick={onClose} variant="outlined">
              Close
            </Button>
          )}
          <Button
            onClick={handleSendMessage}
            variant="contained"
            disabled={isLoading}
            startIcon={isLoading ? <CircularProgress size={20} /> : null}
          >
            {isLoading ? 'Sending...' : 'Send Message'}
          </Button>
        </Box>
      </Stack>
    </Paper>
  );
};

export default WorkerMessagingTest;
