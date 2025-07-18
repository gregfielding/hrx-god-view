import React, { useState, useEffect, useRef } from 'react';
import {
  Box,
  Typography,
  TextField,
  Button,
  Paper,
  List,
  ListItem,
  ListItemText,
  Avatar,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Rating,
  Chip,
  useTheme,
  useMediaQuery,
  Fab,
  Drawer,
  AppBar,
  Toolbar,
  Divider,
  Alert,
  Snackbar,
  CircularProgress,
  Card,
  CardContent,
  Accordion,
  AccordionSummary,
  AccordionDetails,
} from '@mui/material';
import {
  Send as SendIcon,
  ExpandMore as ExpandMoreIcon,
  Close as CloseIcon,
  Chat as ChatIcon,
  ThumbUp as ThumbUpIcon,
  ThumbDown as ThumbDownIcon,
  Help as HelpIcon,
  Person as PersonIcon,
  SmartToy as BotIcon,
} from '@mui/icons-material';
import { httpsCallable } from 'firebase/functions';
import { getFunctions } from 'firebase/functions';

interface Message {
  id: string;
  text: string;
  sender: 'user' | 'bot';
  timestamp: Date;
  satisfactionScore?: number;
  feedback?: string;
}

interface ChatUIProps {
  tenantId?: string;
  workerId?: string;
  onSatisfactionTrack?: (score: number, feedback: string) => void;
  showFAQ?: boolean;
  enableFAQ?: boolean;
  enableCheckins?: boolean;
  context?: {
    logs?: string;
    error?: string;
    filename?: string;
    filetree?: string;
  };
  faqs?: Array<{
    id: string;
    question: string;
    answer: string;
    category: string;
    priority: string;
  }>;
}

const ChatUI: React.FC<ChatUIProps> = ({
  tenantId,
  workerId,
  onSatisfactionTrack,
  showFAQ = true,
  faqs = [],
}) => {
  console.log('ChatUI rendered');
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showSatisfaction, setShowSatisfaction] = useState(false);
  const [satisfactionScore, setSatisfactionScore] = useState<number | null>(null);
  const [feedback, setFeedback] = useState('');
  const [showFAQDrawer, setShowFAQDrawer] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [snackbar, setSnackbar] = useState({
    open: false,
    message: '',
    severity: 'success' as any,
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const functions = getFunctions();

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const sendMessage = async () => {
    if (!inputText.trim() || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      text: inputText,
      sender: 'user',
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputText('');
    setIsLoading(true);

    try {
      const sendAIChatMessage = httpsCallable(functions, 'sendAIChatMessage');
      const result = await sendAIChatMessage({
        message: inputText,
        tenantId,
        workerId,
        conversationId,
      });

      const { response, conversationId: newConversationId } = result.data as any;

      if (!conversationId) {
        setConversationId(newConversationId);
      }

      const botMessage: Message = {
        id: (Date.now() + 1).toString(),
        text: response,
        sender: 'bot',
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, botMessage]);

      // Show satisfaction dialog after bot response
      setTimeout(() => {
        setShowSatisfaction(true);
      }, 1000);
    } catch (error) {
      console.error('Error sending message:', error);
      setSnackbar({
        open: true,
        message: 'Failed to send message. Please try again.',
        severity: 'error',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSatisfactionSubmit = async () => {
    if (satisfactionScore === null) return;

    try {
      if (onSatisfactionTrack) {
        onSatisfactionTrack(satisfactionScore, feedback);
      }

      // Track satisfaction in backend
      if (conversationId) {
        const trackSatisfaction = httpsCallable(functions, 'trackSatisfaction');
        await trackSatisfaction({
          conversationId,
          satisfactionScore,
          feedback,
          tenantId,
          workerId,
        });
      }

      setShowSatisfaction(false);
      setSatisfactionScore(null);
      setFeedback('');

      setSnackbar({
        open: true,
        message: 'Thank you for your feedback!',
        severity: 'success',
      });
    } catch (error) {
      console.error('Error tracking satisfaction:', error);
      setSnackbar({
        open: true,
        message: 'Failed to submit feedback.',
        severity: 'error',
      });
    }
  };

  const handleKeyPress = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  };

  const getFAQSuggestions = () => {
    if (!inputText.trim()) return [];

    const query = inputText.toLowerCase();
    return faqs
      .filter(
        (faq) =>
          faq.question.toLowerCase().includes(query) || faq.answer.toLowerCase().includes(query),
      )
      .slice(0, 3);
  };

  const faqSuggestions = getFAQSuggestions();

  const ChatInterface = () => (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        maxWidth: '100%',
        bgcolor: 'background.default',
      }}
    >
      {/* Header */}
      <AppBar position="static" elevation={1}>
        <Toolbar>
          <BotIcon sx={{ mr: 1 }} />
          <Typography variant="h6" sx={{ flexGrow: 1 }}>
            HR Assistant
          </Typography>
          {showFAQ && (
            <IconButton color="inherit" onClick={() => setShowFAQDrawer(true)} size="large">
              <HelpIcon />
            </IconButton>
          )}
        </Toolbar>
      </AppBar>

      {/* Messages */}
      <Box
        sx={{
          flexGrow: 1,
          overflow: 'auto',
          p: { xs: 1, md: 2 },
          bgcolor: 'grey.50',
        }}
      >
        {messages.length === 0 && (
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              textAlign: 'center',
              p: 3,
            }}
          >
            <BotIcon sx={{ fontSize: 64, color: 'primary.main', mb: 2 }} />
            <Typography variant="h6" gutterBottom>
              Welcome to HR Assistant
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              I'm here to help with your HR questions. Ask me anything about policies, benefits,
              scheduling, or other workplace matters.
            </Typography>
            {showFAQ && faqs.length > 0 && (
              <Button
                variant="outlined"
                startIcon={<HelpIcon />}
                onClick={() => setShowFAQDrawer(true)}
              >
                Browse FAQs
              </Button>
            )}
          </Box>
        )}

        <List sx={{ p: 0 }}>
          {messages.map((message) => (
            <ListItem
              key={message.id}
              sx={{
                display: 'flex',
                justifyContent: message.sender === 'user' ? 'flex-end' : 'flex-start',
                px: 0,
                py: 0.5,
              }}
            >
              <Box
                sx={{
                  maxWidth: { xs: '85%', md: '70%' },
                  display: 'flex',
                  flexDirection: message.sender === 'user' ? 'row-reverse' : 'row',
                  alignItems: 'flex-start',
                  gap: 1,
                }}
              >
                <Avatar
                  sx={{
                    bgcolor: message.sender === 'user' ? 'primary.main' : 'secondary.main',
                    width: 32,
                    height: 32,
                  }}
                >
                  {message.sender === 'user' ? <PersonIcon /> : <BotIcon />}
                </Avatar>
                <Paper
                  sx={{
                    p: 2,
                    bgcolor: message.sender === 'user' ? 'primary.main' : 'white',
                    color: message.sender === 'user' ? 'white' : 'text.primary',
                    borderRadius: 2,
                    boxShadow: 1,
                    wordBreak: 'break-word',
                  }}
                >
                  <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>
                    {message.text}
                  </Typography>
                  <Typography
                    variant="caption"
                    sx={{
                      display: 'block',
                      mt: 1,
                      opacity: 0.7,
                      textAlign: message.sender === 'user' ? 'right' : 'left',
                    }}
                  >
                    {message.timestamp.toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </Typography>
                </Paper>
              </Box>
            </ListItem>
          ))}
        </List>

        {isLoading && (
          <Box sx={{ display: 'flex', justifyContent: 'flex-start', p: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Avatar sx={{ bgcolor: 'secondary.main', width: 32, height: 32 }}>
                <BotIcon />
              </Avatar>
              <Paper sx={{ p: 2, borderRadius: 2 }}>
                <CircularProgress size={20} />
              </Paper>
            </Box>
          </Box>
        )}

        <div ref={messagesEndRef} />
      </Box>

      {/* FAQ Suggestions */}
      {faqSuggestions.length > 0 && (
        <Box sx={{ p: 2, bgcolor: 'background.paper', borderTop: 1, borderColor: 'divider' }}>
          <Typography variant="subtitle2" gutterBottom>
            Suggested FAQs:
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {faqSuggestions.map((faq) => (
              <Chip
                key={faq.id}
                label={faq.question}
                size="small"
                onClick={() => setInputText(faq.question)}
                sx={{ cursor: 'pointer' }}
              />
            ))}
          </Box>
        </Box>
      )}

      {/* Input Area */}
      <Box
        sx={{
          p: { xs: 1, md: 2 },
          bgcolor: 'background.paper',
          borderTop: 1,
          borderColor: 'divider',
        }}
      >
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-end' }}>
          <TextField
            fullWidth
            multiline
            maxRows={4}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Type your message..."
            variant="outlined"
            size="small"
            disabled={isLoading}
            sx={{
              '& .MuiOutlinedInput-root': {
                borderRadius: 3,
              },
            }}
          />
          <Button
            variant="contained"
            onClick={sendMessage}
            disabled={!inputText.trim() || isLoading}
            sx={{
              borderRadius: 3,
              minWidth: 48,
              height: 40,
            }}
          >
            <SendIcon />
          </Button>
        </Box>
      </Box>
    </Box>
  );

  return (
    <>
      {isMobile ? (
        <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
          <ChatInterface />
        </Box>
      ) : (
        <Card sx={{ height: 600, display: 'flex', flexDirection: 'column' }}>
          <ChatInterface />
        </Card>
      )}

      {/* FAQ Drawer */}
      <Drawer
        anchor="right"
        open={showFAQDrawer}
        onClose={() => setShowFAQDrawer(false)}
        sx={{
          '& .MuiDrawer-paper': {
            width: { xs: '100%', sm: 400 },
            p: 2,
          },
        }}
      >
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="h6">Frequently Asked Questions</Typography>
          <IconButton onClick={() => setShowFAQDrawer(false)}>
            <CloseIcon />
          </IconButton>
        </Box>
        <Divider sx={{ mb: 2 }} />

        {faqs.length === 0 ? (
          <Typography color="text.secondary">No FAQs available.</Typography>
        ) : (
          <Box sx={{ overflow: 'auto' }}>
            {faqs.map((faq) => (
              <Accordion key={faq.id} sx={{ mb: 1 }}>
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <Typography variant="subtitle2">{faq.question}</Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <Typography variant="body2" sx={{ mb: 1 }}>
                    {faq.answer}
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 1 }}>
                    <Chip label={faq.category} size="small" color="primary" variant="outlined" />
                    <Chip label={faq.priority} size="small" color="secondary" variant="outlined" />
                  </Box>
                </AccordionDetails>
              </Accordion>
            ))}
          </Box>
        )}
      </Drawer>

      {/* Satisfaction Dialog */}
      <Dialog
        open={showSatisfaction}
        onClose={() => setShowSatisfaction(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>How was your experience?</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', justifyContent: 'center', mb: 3 }}>
            <Rating
              value={satisfactionScore}
              onChange={(_, value) => setSatisfactionScore(value)}
              size="large"
            />
          </Box>
          <TextField
            fullWidth
            multiline
            rows={3}
            label="Additional feedback (optional)"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="Tell us how we can improve..."
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowSatisfaction(false)}>Skip</Button>
          <Button
            onClick={handleSatisfactionSubmit}
            variant="contained"
            disabled={satisfactionScore === null}
          >
            Submit
          </Button>
        </DialogActions>
      </Dialog>

      {/* Snackbar */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
      >
        <Alert
          onClose={() => setSnackbar({ ...snackbar, open: false })}
          severity={snackbar.severity}
          sx={{ width: '100%' }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </>
  );
};

export default ChatUI;
export { default as FAQSuggestion } from './FAQSuggestion';
export { default as CheckInNotification } from './CheckInNotification';
