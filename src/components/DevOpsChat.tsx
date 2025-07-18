import React, { useState } from 'react';
import {
  Box,
  IconButton,
  TextField,
  Paper,
  Typography,
  CircularProgress,
  List,
  ListItem,
  ListItemText,
  Button,
} from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import ChatUI from './ChatUI';

interface DevOpsChatProps {
  context: {
    logs?: string;
    error?: string;
    filename?: string;
    filetree?: string;
  };
}

interface Message {
  sender: 'user' | 'ai';
  text: string;
}

interface FAQSuggestion {
  id: string;
  question: string;
}

interface CheckInNotification {
  id: string;
  message: string;
}

interface ChatUIProps {
  context?: any;
  faqSuggestions?: FAQSuggestion[];
  checkInNotification?: CheckInNotification | null;
  onSend?: (message: string) => Promise<string>;
}

const DevOpsChat: React.FC<DevOpsChatProps> = ({ context }) => {
  return <ChatUI context={context} />;
};

export default DevOpsChat;
